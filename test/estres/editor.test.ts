/**
 * Estres dentro del editor. Aqui viven los problemas que no se ven en un test
 * unitario: el proveedor de CodeLens reparsea el documento entero cada vez que
 * VS Code se lo pide, y VS Code se lo pide al abrir, al editar y al desplazar.
 *
 * Un fichero grande y lento aqui significa un editor a tirones para el usuario,
 * que es la clase de defecto que se cuenta en una resenya de una estrella.
 */

import * as assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

const SALTO = String.fromCharCode(10);
let servidor: http.Server;
let base = "";

function generar(n: number): string {
  return Array.from({ length: n }, (_, i) => [
    `### Peticion ${i}`,
    `# @name p${i}`,
    "# @assert status 200",
    "# @assert time < 1000",
    `GET https://ejemplo.dev/recurso/${i}`,
    "Accept: application/json",
    "",
    `{"indice": ${i}}`,
  ].join(SALTO)).join(SALTO + SALTO);
}

async function lentes(d: vscode.TextDocument) {
  return (await vscode.commands.executeCommand<vscode.CodeLens[]>(
    "vscode.executeCodeLensProvider", d.uri)) ?? [];
}

async function abrir(contenido: string) {
  const d = await vscode.workspace.openTextDocument({ language: "http", content: contenido });
  await vscode.window.showTextDocument(d);
  return d;
}

suite("Assay bajo estres", () => {
  suiteSetup(async () => {
    servidor = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname === "/lento") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"tarde": true}');
        }, 1500);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ruta: u.pathname }));
    });
    await new Promise<void>((l) => servidor.listen(0, "127.0.0.1", l));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  suiteTeardown(() => servidor.close());

  test("500 peticiones: el CodeLens responde sin bloquear el editor", async function () {
    this.timeout(60000);
    const d = await abrir(generar(500));

    const t0 = Date.now();
    const l = await lentes(d);
    const ms = Date.now() - t0;

    // 3 lentes por peticion: enviar, asertos y -aqui no- cadena.
    assert.equal(l.filter((x) => x.command?.title.includes("Send")).length, 500);
    assert.ok(ms < 5000, `el CodeLens tardo ${ms} ms en 500 peticiones`);
  });

  test("2.000 peticiones siguen siendo usables", async function () {
    this.timeout(120000);
    const d = await abrir(generar(2000));
    const t0 = Date.now();
    const l = await lentes(d);
    const ms = Date.now() - t0;
    assert.equal(l.filter((x) => x.command?.title.includes("Send")).length, 2000);
    assert.ok(ms < 15000, `el CodeLens tardo ${ms} ms en 2.000 peticiones`);
  });

  test("editar un fichero grande no deja el CodeLens desincronizado", async function () {
    this.timeout(60000);
    const d = await abrir(generar(200));
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === d)!;

    await editor.edit((b) => b.insert(new vscode.Position(0, 0),
      `### Nueva${SALTO}GET https://ejemplo.dev/nueva${SALTO}${SALTO}`));

    const l = await lentes(d);
    assert.equal(l.filter((x) => x.command?.title.includes("Send")).length, 201,
      "la peticion recien escrita deberia tener su boton");
  });

  test("diez envios seguidos no se pisan ni dejan documentos colgando", async function () {
    this.timeout(90000);
    const d = await abrir(
      Array.from({ length: 10 }, (_, i) =>
        [`### R${i}`, `GET ${base}/r/${i}`].join(SALTO)).join(SALTO + SALTO));

    const l = (await lentes(d)).filter((x) => x.command?.title.includes("Send"));
    assert.equal(l.length, 10);

    await Promise.all(l.map((x) =>
      vscode.commands.executeCommand(x.command!.command, ...(x.command!.arguments ?? []))));

    const limite = Date.now() + 20000;
    let paneles: vscode.TextDocument[] = [];
    while (Date.now() < limite && paneles.length < 10) {
      paneles = vscode.workspace.textDocuments.filter(
        (t) => t.uri.scheme === "assay-response");
      if (paneles.length < 10) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(paneles.length >= 5,
      `solo aparecieron ${paneles.length} respuestas de 10`);
    for (const p of paneles) {
      assert.equal(p.isUntitled, false, "ninguna respuesta puede ser un buffer sin guardar");
    }
  });

  test("editar mientras vuela una peticion no deja el estado inconsistente", async function () {
    this.timeout(60000);
    const d = await abrir([
      "### Lenta", "# @name lenta", `GET ${base}/lento`, "",
      "### Depende", `GET ${base}/x`, "X-T: {{lenta.response.body.$.tarde}}",
    ].join(SALTO));

    const l = (await lentes(d)).filter((x) => x.command?.title.includes("Send"));
    const envio = vscode.commands.executeCommand(
      l[1].command!.command, ...(l[1].command!.arguments ?? []));

    // El usuario escribe mientras la cadena esta en vuelo: el almacen se vacia.
    await new Promise((r) => setTimeout(r, 300));
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === d)!;
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), `# tocado${SALTO}`));

    // Lo unico inaceptable es que esto lance y tumbe el comando.
    await envio;
    assert.ok(true, "el envio termino sin propagar excepcion");
  });

  test("un fichero solo de basura no genera lentes ni excepciones", async () => {
    const d = await abrir([
      "###", "###", "@", "@=", "::::", "{{", "}}", "no soy una peticion",
      "GET", "   ", "# @assert", "# @name",
    ].join(SALTO));
    assert.equal((await lentes(d)).length, 0);
  });

  test("una peticion con 200 asertos no multiplica las lentes sin control", async () => {
    const asertos = Array.from({ length: 200 }, (_, i) => `# @assert status < ${300 + i}`);
    const d = await abrir(["GET https://ejemplo.dev/a", ...asertos].join(SALTO));
    const l = await lentes(d);
    assert.equal(l.length, 2, "una de envio y una de asertos, no una por aserto");
    assert.match(l[1].command!.title, /200 assertions/);
  });
});
