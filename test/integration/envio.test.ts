/**
 * El camino completo dentro del editor: abrir un .http, lanzar el comando y
 * comprobar que la respuesta aparece.
 *
 * Es el hueco que dejaban los demas tests. Los unitarios prueban las piezas y
 * el otro fichero de integracion prueba que la extension carga, pero nadie
 * comprobaba que al pulsar "Send" pase algo. Servidor local, sin red.
 */

import * as assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

let servidor: http.Server;
let base = "";

suite("Roost · envio real", () => {
  suiteSetup(async () => {
    servidor = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/login") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token: "T0KEN-DE-PRUEBA", id: 7 }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ruta: url.pathname,
        auth: req.headers.authorization ?? null,
      }));
    });
    await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  suiteTeardown(() => servidor.close());

  async function abrirConContenido(texto: string): Promise<vscode.TextDocument> {
    const documento = await vscode.workspace.openTextDocument({
      language: "http",
      content: texto,
    });
    await vscode.window.showTextDocument(documento);
    return documento;
  }

  /** Espera a que aparezca un editor cuyo texto cumpla la condicion. */
  async function esperarRespuesta(
    cumple: (texto: string) => boolean,
    ms = 10000,
  ): Promise<string> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      for (const editor of vscode.window.visibleTextEditors) {
        const texto = editor.document.getText();
        if (cumple(texto)) return texto;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    const vistos = vscode.window.visibleTextEditors
      .map((e) => e.document.getText().slice(0, 120));
    throw new Error(`No aparecio la respuesta esperada. Visibles: ${JSON.stringify(vistos)}`);
  }

  test("enviar una peticion abre la respuesta con estado y cuerpo", async () => {
    const documento = await abrirConContenido(`GET ${base}/hola`);
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri,
    );
    const envio = (lentes ?? []).filter((l) => l.command?.title.includes("Send"));
    assert.equal(envio.length, 1);

    const orden = envio[0].command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));

    const texto = await esperarRespuesta((t) => t.includes("HTTP 200"));
    assert.match(texto, /HTTP 200 OK/);
    assert.match(texto, /"ruta": "\/hola"/);
    assert.match(texto, /# \d+ ms/);
  });

  test("los asertos se evaluan y se anyaden a la respuesta", async () => {
    const documento = await abrirConContenido([
      `GET ${base}/hola`,
      "# @assert status 200",
      "# @assert body.$.ruta /hola",
      "# @assert status 500",
    ].join("\n"));

    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri,
    );
    const orden = lentes!.find((l) => l.command?.title.includes("Send"))!.command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));

    const texto = await esperarRespuesta((t) => t.includes("assertions"));
    assert.match(texto, /1 of 3 assertions failed/);
    assert.match(texto, /PASS {2}status 200/);
    assert.match(texto, /FAIL {2}status 500/);
  });

  test("la cadena lanza la dependencia sola y usa su token", async () => {
    const documento = await abrirConContenido([
      "### Login",
      "# @name login",
      `POST ${base}/login`,
      "",
      "### Perfil",
      `GET ${base}/me`,
      "Authorization: Bearer {{login.response.body.$.token}}",
      "# @assert status 200",
    ].join("\n"));

    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri,
    );
    const envio = (lentes ?? []).filter((l) => l.command?.title.includes("Send"));
    assert.equal(envio.length, 2, "una lente de envio por peticion");
    assert.ok(
      (lentes ?? []).some((l) => l.command?.title.includes("runs login first")),
      "deberia anunciarse la dependencia en el editor",
    );

    // Solo se pide la segunda: la primera debe lanzarse sola.
    const orden = envio[1].command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));

    const texto = await esperarRespuesta((t) => t.includes('"auth"'));
    assert.match(texto, /HTTP 200 OK/);
    assert.match(texto, /Bearer T0KEN-DE-PRUEBA/, "el token encadenado llego al servidor");
    assert.match(texto, /1\/1 assertions passed/);
  });

  test("el panel de respuesta no lleva su propio boton Send", async () => {
    const documento = await abrirConContenido(`GET ${base}/hola`);
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri,
    );
    const orden = lentes!.find((l) => l.command?.title.includes("Send"))!.command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));
    await esperarRespuesta((t) => t.includes("HTTP 200"));

    const panel = vscode.window.visibleTextEditors
      .find((e) => e.document.uri.scheme === "roost-response");
    assert.ok(panel, "no se abrio el panel de respuesta");
    assert.equal(panel.document.isUntitled, false, "no debe ser un buffer sin guardar");

    const suyas = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", panel.document.uri,
    );
    assert.equal((suyas ?? []).length, 0,
      "el panel de respuesta no debe tener CodeLens");
  });

  test("un host inalcanzable no rompe la extension", async () => {
    const documento = await abrirConContenido("GET http://127.0.0.1:1/nada");
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri,
    );
    const orden = lentes!.find((l) => l.command?.title.includes("Send"))!.command!;
    // No debe lanzar: el error se comunica por interfaz, no por excepcion.
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));

    // Y la extension sigue viva.
    const comandos = await vscode.commands.getCommands(true);
    assert.ok(comandos.includes("roost.enviar"));
  });
});
