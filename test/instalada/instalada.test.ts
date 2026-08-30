/**
 * Comprobacion sobre la extension instalada desde el .vsix.
 *
 * Responde a la pregunta que los demas tests no pueden responder: lo que se
 * publica, ¿funciona? Si .vscodeignore excluye un fichero necesario, esto es
 * lo unico que lo detecta.
 */

import * as assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

let servidor: http.Server;
let base = "";

suite("Roost instalado desde el .vsix", () => {
  suiteSetup(async () => {
    servidor = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ruta: req.url }));
    });
    await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  suiteTeardown(() => servidor.close());

  test("la extension esta instalada, no en modo desarrollo", async () => {
    const ext = vscode.extensions.getExtension("efega.roost");
    assert.ok(ext, "no aparece efega.roost entre las instaladas");
    assert.equal(
      ext.extensionKind === vscode.ExtensionKind.UI ||
      ext.extensionKind === vscode.ExtensionKind.Workspace,
      true,
    );
    assert.doesNotMatch(
      ext.extensionPath.split(String.fromCharCode(92)).join("/"),
      /44_NpP\/extension$/,
      "se ha cargado el codigo fuente, no el paquete instalado",
    );
  });

  test("el manifiesto publicado declara lo que promete", async () => {
    const ext = vscode.extensions.getExtension("efega.roost")!;
    const p = ext.packageJSON;
    assert.equal(p.main, "./out/src/extension.js");
    assert.deepEqual(p.activationEvents, ["onLanguage:http"]);
    assert.equal(p.icon, "icon.png");
    assert.equal(p.license, "MIT");
    assert.ok(p.keywords.includes("curl"), "faltan las keywords elegidas");
    assert.ok(p.contributes.languages.some((l: { id: string }) => l.id === "http"));
  });

  test("activa al abrir un .http y registra sus comandos", async () => {
    const ext = vscode.extensions.getExtension("efega.roost")!;
    const documento = await vscode.workspace.openTextDocument({
      language: "http",
      content: `GET ${base}/ping`,
    });
    await vscode.window.showTextDocument(documento);
    await ext.activate();
    assert.equal(ext.isActive, true, "no llego a activarse");

    const comandos = await vscode.commands.getCommands(true);
    for (const c of ["roost.enviar", "roost.enviarBajoCursor",
                     "roost.limpiarCadena", "roost.seleccionarEntorno"]) {
      assert.ok(comandos.includes(c), `falta ${c}`);
    }
  });

  test("envia de verdad y devuelve la respuesta", async () => {
    const documento = await vscode.workspace.openTextDocument({
      language: "http",
      content: [`GET ${base}/instalada`, "# @assert status 200",
                "# @assert body.$.ok true"].join("\n"),
    });
    await vscode.window.showTextDocument(documento);

    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri,
    );
    const envio = (lentes ?? []).filter((l) => l.command?.title.includes("Send"));
    assert.equal(envio.length, 1, "sin CodeLens: la extension no esta activa");

    const orden = envio[0].command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));

    const limite = Date.now() + 15000;
    let texto = "";
    while (Date.now() < limite && !texto.includes("HTTP 200")) {
      for (const e of vscode.window.visibleTextEditors) {
        const t = e.document.getText();
        if (t.includes("HTTP 200")) { texto = t; break; }
      }
      if (!texto) await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(texto, "la respuesta nunca aparecio");
    assert.match(texto, /"ruta": "\/instalada"/);
    assert.match(texto, /2\/2 assertions passed/);
  });
});
