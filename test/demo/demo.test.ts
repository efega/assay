/**
 * No es un test: es el guion de la captura de pantalla del Marketplace.
 *
 * Abre un .http real, envia de verdad y deja la ventana quieta el tiempo
 * suficiente para fotografiarla. La imagen que vera la gente es el producto
 * funcionando, no una maqueta.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

const ESPERA_MS = Number(process.env.ROOST_DEMO_ESPERA ?? 25000);

suite("demo", () => {
  test("deja la ventana lista para la captura", async function () {
    this.timeout(ESPERA_MS + 30000);

    const servidor = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.writeHead(200, { "content-type": "application/json" });
      if (url.pathname === "/auth") {
        res.end(JSON.stringify({ token: "eyJhbGciOiJIUzI1NiJ9.demo", expiresIn: 3600 }));
        return;
      }
      res.end(JSON.stringify({
        id: "usr_4f2a",
        email: "ana@acme.dev",
        name: "Ana Ferrer",
        roles: ["admin", "billing"],
        createdAt: "2024-11-03T09:12:44Z",
      }));
    });
    await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
    const puerto = (servidor.address() as AddressInfo).port;

    const plantilla = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "scripts", "demo", "demo.http"), "utf8");
    const destino = path.join(os.tmpdir(), "roost-demo", "requests.http");
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, plantilla.replace("PUERTO", String(puerto)), "utf8");

    const documento = await vscode.workspace.openTextDocument(destino);
    await vscode.window.showTextDocument(documento, { viewColumn: vscode.ViewColumn.One });

    // La activacion es onLanguage:http y tarda un poco: sin esperar, el
    // proveedor de CodeLens todavia no esta registrado.
    await vscode.extensions.getExtension("roost.roost")?.activate();

    let lentes: vscode.CodeLens[] = [];
    const limite = Date.now() + 15000;
    while (Date.now() < limite && lentes.length === 0) {
      lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        "vscode.executeCodeLensProvider", documento.uri) ?? [];
      if (lentes.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    if (lentes.length === 0) throw new Error("El CodeLens no llego a aparecer.");

    const orden = lentes[lentes.length - 1].command!;
    await vscode.commands.executeCommand(orden.command, ...(orden.arguments ?? []));

    // Limpieza de cromo para la captura: nada de esto afecta al producto.
    for (const orden of ["workbench.action.closeAuxiliaryBar",
                         "workbench.action.closePanel",
                         "workbench.action.focusFirstEditorGroup"]) {
      try { await vscode.commands.executeCommand(orden); } catch { /* da igual */ }
    }

    await new Promise((r) => setTimeout(r, ESPERA_MS));
    servidor.close();
  });
});
