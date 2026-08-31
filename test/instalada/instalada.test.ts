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

suite("Assay instalado desde el .vsix", () => {
  suiteSetup(async () => {
    servidor = http.createServer((req, res) => {
      if ((req.url ?? "").startsWith("/entrar")) {
        res.setHeader("set-cookie", ["sid=SESION-DEL-VSIX-4242; Path=/"]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true, ruta: req.url, cookie: req.headers.cookie ?? null,
      }));
    });
    await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  suiteTeardown(() => servidor.close());

  test("la extension esta instalada, no en modo desarrollo", async () => {
    const ext = vscode.extensions.getExtension("efega.assay");
    assert.ok(ext, "no aparece efega.assay entre las instaladas");
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
    const ext = vscode.extensions.getExtension("efega.assay")!;
    const p = ext.packageJSON;
    assert.equal(p.main, "./out/src/extension.js");
    assert.deepEqual(p.activationEvents, ["onLanguage:http"]);
    assert.equal(p.icon, "icon.png");
    assert.equal(p.license, "MIT");
    assert.ok(p.keywords.includes("curl"), "faltan las keywords elegidas");
    // El paquete no puede anunciar lo que no hace: trae instalaciones de gente
    // que busca otra cosa y esas se van dejando una estrella.
    for (const mala of ["graphql", "grpc", "websocket"]) {
      assert.ok(!p.keywords.includes(mala), `keyword "${mala}" sin soporte detras`);
    }
    assert.match(p.description, /^No account, no cloud/,
      "la promesa ya no va por delante en la descripcion");
    assert.ok(p.contributes.languages.some((l: { id: string }) => l.id === "http"));
  });

  test("activa al abrir un .http y registra sus comandos", async () => {
    const ext = vscode.extensions.getExtension("efega.assay")!;
    const documento = await vscode.workspace.openTextDocument({
      language: "http",
      content: `GET ${base}/ping`,
    });
    await vscode.window.showTextDocument(documento);
    await ext.activate();
    assert.equal(ext.isActive, true, "no llego a activarse");

    const comandos = await vscode.commands.getCommands(true);
    for (const c of ["assay.send", "assay.sendUnderCursor",
                     "assay.resetChain", "assay.selectEnvironment"]) {
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

  test("las cookies llegan empaquetadas y la sesion funciona", async () => {
    // cookies.js es un fichero nuevo. Si .vscodeignore lo dejara fuera, todo lo
    // demas seguiria pasando y esta prueba seria la unica en enterarse.
    const documento = await vscode.workspace.openTextDocument({
      language: "http",
      content: [`POST ${base}/entrar`, "", "###", `GET ${base}/quien-soy`]
        .join(String.fromCharCode(10)),
    });
    await vscode.window.showTextDocument(documento);

    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider", documento.uri) ?? [];
    const envios = lentes.filter((l) => l.command?.title.includes("Send"));
    assert.equal(envios.length, 2, "no salieron los dos botones Send");

    for (const indice of [0, 1]) {
      const orden = envios[indice].command!;
      await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));
      await new Promise((r) => setTimeout(r, 900));
    }

    const limite = Date.now() + 15000;
    let panel = "";
    while (Date.now() < limite && !panel) {
      for (const e of vscode.window.visibleTextEditors) {
        const t = e.document.getText();
        if (t.includes("/quien-soy") && t.includes("HTTP 200")) { panel = t; break; }
      }
      if (!panel) await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(panel, "no aparecio la respuesta de /quien-soy");

    // El servidor devuelve la cookie que recibio. Si la sesion viajo, aqui hay
    // algo; y si viajo, tiene que salir enmascarada y no en claro.
    assert.doesNotMatch(panel, /"cookie": null/,
      "la sesion no viajo: cookies.js no esta haciendo su trabajo en el .vsix");
    assert.ok(!panel.includes("SESION-DEL-VSIX-4242"),
      `el valor de sesion se ve en claro en el panel:
${panel}`);
  });
});
