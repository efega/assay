/**
 * Sesiones por cookie, dentro del editor de verdad.
 *
 * Las cookies tenian 27 pruebas de modulo y ninguna aqui. Ese hueco es
 * exactamente el que dejo pasar en su dia un `main` mal apuntado y unos
 * `activationEvents` vacios: el modulo funcionaba y la extension no lo usaba.
 * Aqui se pulsa el boton de verdad y se mira lo que el servidor recibe.
 *
 * Se comprueban ademas las dos decisiones de ciclo de vida, que son las que
 * nadie recuerda al refactorizar: editar el fichero tira la sesion, y el
 * comando de reinicio tambien.
 */

import * as assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

const SALTO = String.fromCharCode(10);

let servidor: http.Server;
let base = "";
/** Ultima cabecera Cookie que ha visto el servidor en /me. */
let vistaEnMe: string | null = null;
/** Cuantas veces se ha pedido /me. Separado del valor a proposito: la
 *  ausencia de cookie tambien es un resultado, y usar null como senyal de
 *  "todavia no ha llegado" hacia que los casos negativos no terminaran. */
let golpesEnMe = 0;
/** Todo lo que ha pedido el editor, para poder diagnosticar un fallo. */
let recibidas: string[] = [];

suite("Assay · sesion por cookie en el editor", () => {
  suiteSetup(async () => {
    servidor = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      recibidas.push(`${req.method} ${url.pathname}`);

      if (url.pathname === "/login") {
        res.setHeader("set-cookie", [
          "sid=SESION-SECRETISIMA-123; Path=/",
          "csrf=CSRF-987654; Path=/",
        ]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/me") {
        vistaEnMe = req.headers.cookie ?? null;
        golpesEnMe++;
        const autenticado = (req.headers.cookie ?? "").includes("sid=");
        res.writeHead(autenticado ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify(
          autenticado ? { nombre: "Ana", cookie: req.headers.cookie } : { error: "sin sesion" },
        ));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"no existe"}');
    });
    await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  suiteTeardown(() => servidor.close());

  setup(() => { vistaEnMe = null; golpesEnMe = 0; recibidas = []; });

  async function abrir(texto: string): Promise<vscode.TextDocument> {
    const documento = await vscode.workspace.openTextDocument({
      language: "http", content: texto,
    });
    await vscode.window.showTextDocument(documento);
    return documento;
  }

  /** Pulsa el CodeLens de envio numero `indice` (0 = el primero del fichero). */
  async function enviar(documento: vscode.TextDocument, indice: number): Promise<void> {
    const limite = Date.now() + 10000;
    let envios: vscode.CodeLens[] = [];
    while (Date.now() < limite) {
      const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider", documento.uri) ?? [];
      envios = lentes.filter((l) => l.command?.title.includes("Send"));
      if (envios.length > indice) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(envios.length > indice,
      `no aparecio el boton Send numero ${indice}, solo ${envios.length}`);
    const orden = envios[indice].command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));
  }

  /** Espera a que el servidor haya atendido /me y devuelve lo que vio. */
  async function esperarMe(ms = 10000): Promise<string | null> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (golpesEnMe > 0) return vistaEnMe;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `el servidor nunca recibio /me. Si recibio: ${JSON.stringify(recibidas)}`);
  }

  // Funcion y no constante: el cuerpo del suite se evalua al DEFINIRLO, antes
  // de que suiteSetup asigne `base`. Como constante, las URLs salian sin host
  // y ejecutar() las rechazaba sin llegar a tocar la red.
  const ficheroDemo = () => [
    "### Entrar",
    "# @name login",
    `POST ${base}/login`,
    "",
    "### Quien soy",
    `GET ${base}/me`,
    "",
    "# @assert status 200",
  ].join(SALTO);

  test("la sesion del login viaja a la peticion siguiente", async () => {
    const documento = await abrir(ficheroDemo());
    await enviar(documento, 0);                 // login
    await new Promise((r) => setTimeout(r, 600));
    await enviar(documento, 1);                 // /me
    const cookie = await esperarMe();
    assert.ok(cookie, "no llego ninguna cookie");
    assert.ok(cookie!.includes("sid=SESION-SECRETISIMA-123"), cookie!);
    assert.ok(cookie!.includes("csrf=CSRF-987654"), cookie!);
  });

  test("sin login, la peticion va sin sesion y el aserto falla", async () => {
    const documento = await abrir(ficheroDemo());
    await enviar(documento, 1);                 // /me directamente
    const cookie = await esperarMe();
    assert.equal(cookie, null, `viajo una cookie que no deberia: ${cookie}`);
  });

  test("editar el fichero tira la sesion", async () => {
    const documento = await abrir(ficheroDemo());
    await enviar(documento, 0);
    await new Promise((r) => setTimeout(r, 600));

    // Un cambio real en el documento, que es lo que vacia el almacen.
    const edicion = new vscode.WorkspaceEdit();
    edicion.insert(documento.uri, new vscode.Position(0, 0), `# nota${SALTO}`);
    assert.ok(await vscode.workspace.applyEdit(edicion), "no se pudo editar");
    await new Promise((r) => setTimeout(r, 400));

    await enviar(documento, 1);
    const cookie = await esperarMe();
    assert.equal(cookie, null,
      `la sesion sobrevivio a una edicion del fichero: ${cookie}`);
  });

  test("el comando de reinicio tira la sesion", async () => {
    const documento = await abrir(ficheroDemo());
    await enviar(documento, 0);
    await new Promise((r) => setTimeout(r, 600));

    await vscode.window.showTextDocument(documento);
    await vscode.commands.executeCommand("assay.limpiarCadena");
    await new Promise((r) => setTimeout(r, 300));

    await enviar(documento, 1);
    const cookie = await esperarMe();
    assert.equal(cookie, null, `la sesion sobrevivio al reinicio: ${cookie}`);
  });

  test("una cabecera Cookie escrita a mano gana a la sesion", async () => {
    const texto = [
      "### Entrar",
      `POST ${base}/login`,
      "",
      "### Con cookie propia",
      `GET ${base}/me`,
      "Cookie: sid=LA-MIA-A-MANO",
    ].join(SALTO);
    const documento = await abrir(texto);
    await enviar(documento, 0);
    await new Promise((r) => setTimeout(r, 600));
    await enviar(documento, 1);
    const cookie = await esperarMe();
    assert.equal(cookie, "sid=LA-MIA-A-MANO",
      `la sesion piso una cabecera escrita a mano: ${cookie}`);
  });

  test("SEGURIDAD: el valor de sesion no aparece en el panel de respuesta", async () => {
    const documento = await abrir(ficheroDemo());
    await enviar(documento, 0);
    await new Promise((r) => setTimeout(r, 600));
    await enviar(documento, 1);
    await esperarMe();

    // El panel enseña el eco del servidor, que devuelve la cookie recibida.
    const limite = Date.now() + 10000;
    let panel: string | undefined;
    while (Date.now() < limite && panel === undefined) {
      for (const editor of vscode.window.visibleTextEditors) {
        const t = editor.document.getText();
        if (t.includes("HTTP 200") && t.includes("Ana")) { panel = t; break; }
      }
      if (panel === undefined) await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(panel, "no aparecio el panel de respuesta de /me");
    assert.ok(!panel!.includes("SESION-SECRETISIMA-123"),
      `el valor de sesion se ve en el panel:${SALTO}${panel}`);
    assert.ok(!panel!.includes("CSRF-987654"),
      `el csrf se ve en el panel:${SALTO}${panel}`);
  });
});
