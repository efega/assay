/**
 * Tests de integracion: se ejecutan dentro de un VS Code real, con la
 * extension cargada. Es lo que verifica F5, pero automatizado y repetible.
 *
 * Comprueban que la extension activa, que los comandos quedan registrados y
 * que el CodeLens aparece sobre cada peticion de un fichero .http. Nada de
 * red: eso ya se cubre en los tests unitarios y en el humo manual.
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const EJEMPLO = path.join(RAIZ, "samples", "ejemplo.http");

async function abrirEjemplo(): Promise<vscode.TextDocument> {
  const documento = await vscode.workspace.openTextDocument(EJEMPLO);
  await vscode.window.showTextDocument(documento);
  return documento;
}

suite("Roost", () => {
  test("la extension se activa", async () => {
    const ext = vscode.extensions.getExtension("roost.roost");
    assert.ok(ext, "no se encuentra la extension en el host");
    await ext.activate();
    assert.equal(ext.isActive, true);
  });

  test("registra sus comandos", async () => {
    const comandos = await vscode.commands.getCommands(true);
    assert.ok(comandos.includes("roost.enviar"), "falta roost.enviar");
    assert.ok(
      comandos.includes("roost.enviarBajoCursor"),
      "falta roost.enviarBajoCursor",
    );
  });

  test("los .http se reconocen como lenguaje http", async () => {
    const documento = await abrirEjemplo();
    assert.equal(documento.languageId, "http");
  });

  test("aparece un CodeLens por cada peticion del ejemplo", async () => {
    const documento = await abrirEjemplo();
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      documento.uri,
    );
    assert.ok(lentes, "el proveedor no devolvio nada");

    // samples/ejemplo.http tiene 5 peticiones.
    assert.equal(lentes.length, 5, `se esperaban 5 lentes, hay ${lentes.length}`);

    for (const lente of lentes) {
      assert.equal(lente.command?.command, "roost.enviar");
      const texto = documento.lineAt(lente.range.start.line).text;
      assert.match(
        texto,
        /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/,
        `el CodeLens de la linea ${lente.range.start.line} cae sobre "${texto}" ` +
        `en vez de sobre una linea de peticion`,
      );
    }
  });

  test("el CodeLens lleva metodo y URL en el tooltip", async () => {
    const documento = await abrirEjemplo();
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      documento.uri,
    );
    const tooltips = (lentes ?? []).map((l) => l.command?.tooltip ?? "");
    assert.ok(
      tooltips.some((t) => t.startsWith("POST ")),
      `ningun tooltip empieza por POST: ${JSON.stringify(tooltips)}`,
    );
    assert.ok(
      tooltips.every((t) => /\{\{base\}\}|https?:\/\//.test(t)),
      "algun tooltip no lleva URL",
    );
  });

  test("los asertos del ejemplo llegan al CodeLens", async () => {
    const documento = await abrirEjemplo();
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      documento.uri,
    );
    const conAsertos = (lentes ?? []).filter(
      (l) => (l.command?.arguments?.[0] as { asertos?: unknown[] })?.asertos?.length,
    );
    assert.equal(conAsertos.length, 1, "el bloque con # @assert deberia llevarlos");
    const peticion = conAsertos[0].command!.arguments![0] as { asertos: unknown[] };
    assert.equal(peticion.asertos.length, 4);
  });

  test("un fichero sin peticiones no genera lentes", async () => {
    const documento = await vscode.workspace.openTextDocument({
      language: "http",
      content: "# solo un comentario\n\n### bloque vacio\n",
    });
    await vscode.window.showTextDocument(documento);
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      documento.uri,
    );
    assert.equal((lentes ?? []).length, 0);
  });
});
