/**
 * Integracion con VS Code: un CodeLens "Enviar" sobre cada peticion, y la
 * respuesta en un panel al lado.
 *
 * Deliberadamente no hay: cuenta, sincronizacion, telemetria ni limite de
 * peticiones guardadas. Los ficheros .http son del usuario y viven en su
 * repositorio.
 */

import * as vscode from "vscode";
import { parse, resolver, type HttpRequest } from "./parser";
import { ejecutar, formatear, HttpError } from "./http";

const LENGUAJES = [
  { language: "http", scheme: "file" },
  { language: "plaintext", pattern: "**/*.{http,rest}" },
];

export function activate(contexto: vscode.ExtensionContext): void {
  const salida = vscode.window.createOutputChannel("HTTP", "http");
  contexto.subscriptions.push(salida);

  contexto.subscriptions.push(
    vscode.languages.registerCodeLensProvider(LENGUAJES, new ProveedorDeLentes()),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand(
      "restfile.enviar",
      (peticion?: HttpRequest, variables?: Record<string, string>) =>
        enviar(peticion, variables, salida),
    ),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand("restfile.enviarBajoCursor", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const fichero = parse(editor.document.getText());
      const linea = editor.selection.active.line;
      // La peticion activa es la ultima que empieza en o antes del cursor.
      const peticion = [...fichero.peticiones]
        .reverse()
        .find((p) => p.linea <= linea);
      if (!peticion) {
        vscode.window.showWarningMessage("No hay ninguna peticion en el cursor.");
        return;
      }
      void enviar(peticion, fichero.variables, salida);
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
        command: "restfile.enviar",
        arguments: [peticion, fichero.variables],
      });
    });
  }
}

async function enviar(
  peticion: HttpRequest | undefined,
  variables: Record<string, string> | undefined,
  salida: vscode.OutputChannel,
): Promise<void> {
  if (!peticion) return;
  const resuelta = resolver(peticion, variables ?? {});

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `${resuelta.metodo} ${acortar(resuelta.url)}`,
    },
    async () => {
      try {
        const respuesta = await ejecutar(resuelta);
        const documento = await vscode.workspace.openTextDocument({
          content: formatear(respuesta, resuelta),
          language: "http",
        });
        await vscode.window.showTextDocument(documento, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
          preview: true,
        });
        salida.appendLine(
          `${resuelta.metodo} ${resuelta.url} -> ${respuesta.estado} ` +
          `(${respuesta.ms} ms)`,
        );
      } catch (error) {
        const mensaje = error instanceof HttpError
          ? error.message
          : `Fallo inesperado: ${String(error)}`;
        salida.appendLine(`${resuelta.metodo} ${resuelta.url} -> ${mensaje}`);
        void vscode.window.showErrorMessage(mensaje);
      }
    },
  );
}

function acortar(url: string, max = 60): string {
  return url.length <= max ? url : `${url.slice(0, max - 1)}…`;
}

export function deactivate(): void {
  // Nada que limpiar: no hay procesos ni conexiones persistentes.
}
