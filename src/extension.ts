/**
 * Integracion con VS Code: un CodeLens "Enviar" sobre cada peticion, y la
 * respuesta en un panel al lado.
 *
 * Deliberadamente no hay: cuenta, sincronizacion, telemetria ni limite de
 * peticiones guardadas. Los ficheros .http son del usuario y viven en su
 * repositorio.
 */

import * as vscode from "vscode";
import { parse, resolver, type HttpFile, type HttpRequest } from "./parser";
import { ejecutar, formatear, redactarUrl, HttpError } from "./http";
import { evaluarTodos, resumir } from "./asserts";
import { Almacen, ErrorDeCadena, aplicar, resolverDependencias } from "./cadena";

const LENGUAJES = [
  { language: "http", scheme: "file" },
  { language: "plaintext", pattern: "**/*.{http,rest}" },
];

/**
 * Un almacen de respuestas por documento. Se vacia cuando el fichero cambia:
 * si el usuario edita la peticion de login, el token viejo deja de valer y no
 * queremos arrastrarlo sin que se note.
 */
const almacenes = new Map<string, Almacen>();

function almacenDe(uri: vscode.Uri): Almacen {
  const clave = uri.toString();
  let almacen = almacenes.get(clave);
  if (!almacen) {
    almacen = new Almacen();
    almacenes.set(clave, almacen);
  }
  return almacen;
}

export function activate(contexto: vscode.ExtensionContext): void {
  const salida = vscode.window.createOutputChannel("Roost", "http");
  contexto.subscriptions.push(salida);

  contexto.subscriptions.push(
    vscode.languages.registerCodeLensProvider(LENGUAJES, new ProveedorDeLentes()),
  );

  contexto.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((evento) => {
      if (evento.document.languageId === "http") {
        almacenes.get(evento.document.uri.toString())?.limpiar();
      }
    }),
  );
  contexto.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((documento) => {
      almacenes.delete(documento.uri.toString());
    }),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand(
      "roost.enviar",
      (peticion?: HttpRequest, fichero?: HttpFile, uri?: vscode.Uri) =>
        enviar(peticion, fichero, uri, salida),
    ),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand("roost.enviarBajoCursor", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const fichero = parse(editor.document.getText());
      const linea = editor.selection.active.line;
      // La peticion activa es la ultima que empieza en o antes del cursor.
      const peticion = [...fichero.peticiones].reverse().find((p) => p.linea <= linea);
      if (!peticion) {
        void vscode.window.showWarningMessage("No hay ninguna peticion en el cursor.");
        return;
      }
      void enviar(peticion, fichero, editor.document.uri, salida);
    }),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand("roost.limpiarCadena", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      almacenes.get(editor.document.uri.toString())?.limpiar();
      salida.appendLine("Respuestas encadenadas descartadas.");
      void vscode.window.showInformationMessage("Roost: cadena reiniciada.");
    }),
  );
}

class ProveedorDeLentes implements vscode.CodeLensProvider {
  provideCodeLenses(documento: vscode.TextDocument): vscode.CodeLens[] {
    const fichero = parse(documento.getText());
    return fichero.peticiones.map((peticion) => {
      const linea = Math.min(peticion.lineaPeticion, documento.lineCount - 1);
      const rango = documento.lineAt(linea).range;
      return new vscode.CodeLens(rango, {
        title: `$(play) Enviar`,
        tooltip: `${peticion.metodo} ${peticion.url}`,
        command: "roost.enviar",
        arguments: [peticion, fichero, documento.uri],
      });
    });
  }
}

async function enviar(
  peticion: HttpRequest | undefined,
  fichero: HttpFile | undefined,
  uri: vscode.Uri | undefined,
  salida: vscode.OutputChannel,
): Promise<void> {
  if (!peticion || !fichero) return;
  const almacen = uri ? almacenDe(uri) : new Almacen();
  const conVariables = (p: HttpRequest) => resolver(p, fichero.variables);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `${peticion.metodo} ${acortar(redactarUrl(peticion.url))}`,
    },
    async () => {
      try {
        // Las dependencias primero. Se registran los nombres, nunca los valores:
        // un token en el panel acaba en una captura o en un fichero commiteado.
        const { ejecutadas } = await resolverDependencias(
          peticion, fichero, almacen, (p) => ejecutar(p), conVariables,
        );
        if (ejecutadas.length > 0) {
          salida.appendLine(`  cadena: ${ejecutadas.join(" -> ")}`);
        }

        const resuelta = aplicar(conVariables(peticion), almacen);
        const respuesta = await ejecutar(resuelta);

        if (peticion.nombre) almacen.guardar(peticion.nombre, respuesta);

        const resultados = evaluarTodos(peticion.asertos, respuesta);
        const fallan = resultados.filter((r) => !r.ok).length;
        const informe = resumir(resultados);

        const documento = await vscode.workspace.openTextDocument({
          content: informe
            ? `${formatear(respuesta, resuelta)}\n\n# ${informe.split("\n").join("\n# ")}`
            : formatear(respuesta, resuelta),
          language: "http",
        });
        await vscode.window.showTextDocument(documento, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
          preview: true,
        });

        salida.appendLine(
          `${resuelta.metodo} ${redactarUrl(resuelta.url)} -> ${respuesta.estado} ` +
          `(${respuesta.ms} ms)` +
          (resultados.length ? ` · ${resultados.length - fallan}/${resultados.length} asertos` : ""),
        );
        if (informe) salida.appendLine(informe);
        if (fallan > 0) {
          void vscode.window.showWarningMessage(
            `${fallan} de ${resultados.length} asertos fallan en ` +
            `${peticion.nombre ?? acortar(redactarUrl(peticion.url), 40)}.`,
          );
        }
      } catch (error) {
        const mensaje =
          error instanceof ErrorDeCadena || error instanceof HttpError
            ? error.message
            : `Fallo inesperado: ${String(error)}`;
        salida.appendLine(`${peticion.metodo} ${redactarUrl(peticion.url)} -> ${mensaje}`);
        void vscode.window.showErrorMessage(mensaje);
      }
    },
  );
}

function acortar(url: string, max = 60): string {
  return url.length <= max ? url : `${url.slice(0, max - 1)}…`;
}

export function deactivate(): void {
  almacenes.clear();
}
