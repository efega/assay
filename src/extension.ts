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
import { ejecutar, redactarUrl, HttpError } from "./http";
import { evaluarTodos, resumir } from "./asserts";
import { ESQUEMA, ProveedorDeRespuestas } from "./respuesta";
import { Diagnosticos } from "./diagnosticos";
import {
  Almacen, ErrorDeCadena, aplicar, referenciasDe, resolverDependencias,
} from "./cadena";
import { combinar } from "./entornos";
import { GestorDeEntornos } from "./entornosEditor";

const SALTO = String.fromCharCode(10);

/** Fichero de ejemplo del comando "New request file" y del walkthrough. */
const PLANTILLA = [
  "@base = https://api.github.com",
  "",
  "### A request is one line. Press Send above it.",
  "GET {{base}}/zen",
  "",
  "### Assertions run on every send.",
  "GET {{base}}/repos/microsoft/vscode",
  "Accept: application/vnd.github+json",
  "",
  "# @assert status 200",
  "# @assert time < 2000",
  "# @assert body.$.name vscode",
  "",
  "### Name a request to reuse its response.",
  "# @name repo",
  "GET {{base}}/repos/microsoft/vscode",
  "",
  "### Roost sends the one above first, on its own.",
  "GET {{base}}/repos/microsoft/vscode/contributors",
  "X-Repo-Id: {{repo.response.body.$.id}}",
  "",
  "# @assert status 200",
  "",
].join(SALTO);

interface Ajustes {
  timeoutMs: number;
  redactar: boolean;
}

/** Se lee en cada envio: cambiar el ajuste surte efecto sin recargar. */
function ajustes(): Ajustes {
  const c = vscode.workspace.getConfiguration("roost");
  return {
    timeoutMs: c.get<number>("timeoutMs", 30_000),
    redactar: c.get<boolean>("redactSecrets", true),
  };
}

// Sin restringir el esquema a "file": si no, un buffer sin guardar no
// tiene boton Send, y abrir un fichero nuevo para probar es justo lo primero
// que hace alguien que evalua la herramienta.
const LENGUAJES = [
  { language: "http" },
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

  const entornos = new GestorDeEntornos(contexto, salida);

  // Documentos de respuesta virtuales y de solo lectura: sin buffers sin
  // guardar que el usuario tenga que ir cerrando.
  const respuestas = new ProveedorDeRespuestas();
  contexto.subscriptions.push(respuestas);

  // Los asertos que fallan se marcan en la propia linea del fichero.
  const diagnosticos = new Diagnosticos();
  contexto.subscriptions.push(diagnosticos);
  contexto.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(ESQUEMA, respuestas),
  );
  contexto.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (d.uri.scheme === ESQUEMA) respuestas.olvidar(d.uri);
    }),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand("roost.seleccionarEntorno", () =>
      entornos.seleccionar()),
  );

  contexto.subscriptions.push(
    vscode.languages.registerCodeLensProvider(LENGUAJES, new ProveedorDeLentes()),
  );

  contexto.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((evento) => {
      if (evento.document.languageId === "http") {
        almacenes.get(evento.document.uri.toString())?.limpiar();
        // Al editar, los avisos de asertos dejan de corresponder a lo que hay.
        diagnosticos.limpiar(evento.document.uri);
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
        enviar(peticion, fichero, uri, salida, entornos, respuestas, diagnosticos),
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
        void vscode.window.showWarningMessage("No request found at the cursor.");
        return;
      }
      void enviar(peticion, fichero, editor.document.uri, salida, entornos,
                  respuestas, diagnosticos);
    }),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand("roost.nuevoFichero", async () => {
      // Un fichero de arranque con las tres cosas que hay que entender:
      // una peticion, un aserto y una cadena. Sin guardar todavia: el usuario
      // decide donde vive.
      const documento = await vscode.workspace.openTextDocument({
        language: "http",
        content: PLANTILLA,
      });
      await vscode.window.showTextDocument(documento);
    }),
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand("roost.limpiarCadena", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      almacenes.get(editor.document.uri.toString())?.limpiar();
      salida.appendLine("Chained responses cleared.");
      void vscode.window.showInformationMessage("Roost: chain reset.");
    }),
  );
}

/**
 * Ademas del boton, anota lo que la peticion va a hacer: cuantos asertos se
 * comprobaran y que dependencias se lanzaran antes.
 *
 * No es decoracion. Las dos funciones que diferencian a Roost -asertos y
 * cadena- son invisibles en un fichero de texto; anunciarlas donde el usuario
 * ya esta mirando es lo que convierte "otro cliente HTTP" en "ah, esto hace
 * tests".
 */
class ProveedorDeLentes implements vscode.CodeLensProvider {
  provideCodeLenses(documento: vscode.TextDocument): vscode.CodeLens[] {
    // El panel de respuesta tambien es lenguaje http y contiene la linea de
    // peticion: sin esto le saldria su propio boton Send, que no hace nada
    // util y ensucia la lectura.
    if (documento.uri.scheme === ESQUEMA) return [];

    const fichero = parse(documento.getText());
    const lentes: vscode.CodeLens[] = [];

    for (const peticion of fichero.peticiones) {
      const linea = Math.min(peticion.lineaPeticion, documento.lineCount - 1);
      const rango = documento.lineAt(linea).range;

      lentes.push(new vscode.CodeLens(rango, {
        title: "$(play) Send",
        tooltip: `${peticion.metodo} ${peticion.url}`,
        command: "roost.enviar",
        arguments: [peticion, fichero, documento.uri],
      }));

      if (peticion.asertos.length > 0) {
        const n = peticion.asertos.length;
        lentes.push(new vscode.CodeLens(rango, {
          title: `$(beaker) ${n} ${n === 1 ? "assertion" : "assertions"}`,
          tooltip: peticion.asertos.map((a) => a.origen).join(SALTO),
          command: "roost.enviar",
          arguments: [peticion, fichero, documento.uri],
        }));
      }

      const dependencias = [...new Set(
        referenciasDe(peticion).map((r) => r.peticion),
      )];
      if (dependencias.length > 0) {
        lentes.push(new vscode.CodeLens(rango, {
          title: `$(link) runs ${dependencias.join(", ")} first`,
          tooltip: "Roost sends these automatically if they have not run yet",
          command: "roost.enviar",
          arguments: [peticion, fichero, documento.uri],
        }));
      }
    }
    return lentes;
  }
}

async function enviar(
  peticion: HttpRequest | undefined,
  fichero: HttpFile | undefined,
  uri: vscode.Uri | undefined,
  salida: vscode.OutputChannel,
  entornos: GestorDeEntornos,
  respuestas: ProveedorDeRespuestas,
  diagnosticos: Diagnosticos,
): Promise<void> {
  if (!peticion || !fichero) return;
  const almacen = uri ? almacenDe(uri) : new Almacen();
  const { timeoutMs, redactar } = ajustes();
  const oculta = (url: string) => (redactar ? redactarUrl(url) : url);

  // Entorno primero, fichero despues: las variables del .http mandan, que es
  // como se comporta REST Client.
  const delEntorno = uri ? await entornos.variablesPara(uri) : {};
  const variables = combinar(delEntorno, fichero.variables);
  const conVariables = (p: HttpRequest) => resolver(p, variables);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `${peticion.metodo} ${acortar(oculta(peticion.url))}`,
    },
    async () => {
      try {
        // Las dependencias primero. Se registran los nombres, nunca los valores:
        // un token en el panel acaba en una captura o en un fichero commiteado.
        const { ejecutadas } = await resolverDependencias(
          peticion, fichero, almacen, (p) => ejecutar(p, { timeoutMs }), conVariables,
        );
        if (ejecutadas.length > 0) {
          salida.appendLine(`  cadena: ${ejecutadas.join(" -> ")}`);
        }

        const resuelta = aplicar(conVariables(peticion), almacen);
        const respuesta = await ejecutar(resuelta, { timeoutMs });

        if (peticion.nombre) almacen.guardar(peticion.nombre, respuesta);

        const resultados = evaluarTodos(peticion.asertos, respuesta);
        const fallan = resultados.filter((r) => !r.ok).length;
        const informe = resumir(resultados);

        if (uri) {
          diagnosticos.publicar(
            uri,
            vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString()),
            peticion, resultados,
          );
        }

        // Un servidor puede devolverte el secreto que le mandaste: httpbin lo
        // hace, y muchos endpoints de depuracion tambien.
        const secretos = redactar && uri ? await entornos.secretosPara(uri) : [];

        const destino = respuestas.publicar(resuelta, respuesta, resultados,
                                            { redactar, secretos });
        const documento = await vscode.workspace.openTextDocument(destino);
        await vscode.languages.setTextDocumentLanguage(documento, "http");
        await vscode.window.showTextDocument(documento, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
          preview: true,
        });

        salida.appendLine(
          `${resuelta.metodo} ${oculta(resuelta.url)} -> ${respuesta.estado} ` +
          `(${respuesta.ms} ms)` +
          (resultados.length ? ` · ${resultados.length - fallan}/${resultados.length} assertions` : ""),
        );
        if (informe) salida.appendLine(informe);
        // Sin ventana emergente: el fallo ya se ve subrayado en la linea del
        // aserto y en el panel de Problemas. Un aviso modal encima seria
        // ruido para algo que el usuario ya esta viendo.
      } catch (error) {
        const mensaje =
          error instanceof ErrorDeCadena || error instanceof HttpError
            ? error.message
            : `Unexpected failure: ${String(error)}`;
        salida.appendLine(`${peticion.metodo} ${oculta(peticion.url)} -> ${mensaje}`);
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
