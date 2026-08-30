/**
 * Tests de integracion: se ejecutan dentro de un VS Code real, con la
 * extension cargada. Es lo que verifica F5, pero automatizado y repetible.
 *
 * Comprueban que la extension activa, que los comandos quedan registrados y
 * que el CodeLens aparece sobre cada peticion de un fichero .http. Nada de
 * red: eso ya se cubre en los tests unitarios y en el humo manual.
 */

import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const EJEMPLO = path.join(RAIZ, "samples", "ejemplo.http");
const METODO = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/;

/** Solo las lentes de envio: ahora tambien hay de asertos y de cadena. */
const soloEnvio = (lentes: vscode.CodeLens[] | undefined) =>
  (lentes ?? []).filter((l) => l.command?.title.includes("Send"));

async function abrirEjemplo(): Promise<vscode.TextDocument> {
  const documento = await vscode.workspace.openTextDocument(EJEMPLO);
  await vscode.window.showTextDocument(documento);
  return documento;
}

suite("Roost", () => {
  test("la extension se activa", async () => {
    const ext = vscode.extensions.getExtension("efega.roost");
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
    assert.ok(
      comandos.includes("roost.limpiarCadena"),
      "falta roost.limpiarCadena",
    );
    assert.ok(
      comandos.includes("roost.seleccionarEntorno"),
      "falta roost.seleccionarEntorno",
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

    // Se deriva del propio fichero: si el ejemplo crece, el test no se rompe.
    const lineasDePeticion = Array.from(
      { length: documento.lineCount },
      (_, n) => documento.lineAt(n).text,
    ).filter((l) => METODO.test(l)).length;
    assert.ok(lineasDePeticion > 0, "el ejemplo deberia tener peticiones");
    const envio = soloEnvio(lentes);
    assert.equal(
      envio.length,
      lineasDePeticion,
      `${lineasDePeticion} peticiones pero ${envio.length} lentes de envio`,
    );

    for (const lente of envio) {
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
    const tooltips = soloEnvio(lentes).map((l) => l.command?.tooltip ?? "");
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
    assert.ok(
      conAsertos.length > 0,
      "algun bloque del ejemplo lleva # @assert y no llego al CodeLens",
    );
    for (const lente of conAsertos) {
      const peticion = lente.command!.arguments![0] as {
        asertos: { objetivo: string; operador: string }[];
      };
      for (const aserto of peticion.asertos) {
        assert.ok(aserto.objetivo, "un aserto llego sin objetivo");
        assert.ok(aserto.operador, "un aserto llego sin operador");
      }
    }
  });

  test("las peticiones encadenadas llegan con su nombre", async () => {
    const documento = await abrirEjemplo();
    const lentes = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      documento.uri,
    );
    const nombradas = (lentes ?? [])
      .map((l) => (l.command?.arguments?.[0] as { nombre?: string })?.nombre)
      .filter(Boolean);
    assert.ok(
      nombradas.includes("origen"),
      `el ejemplo define "# @name origen"; llegaron: ${JSON.stringify(nombradas)}`,
    );
  });

  test("los entornos se cargan del disco y el privado pisa al publico", async () => {
    const { cargar } = await import("../../src/entornosEditor");
    const { nombresDe, variablesDe } = await import("../../src/entornos");

    // Los ficheros se crean aqui a proposito. El de secretos esta en
    // .gitignore -como debe-, asi que un test que dependiera del de samples/
    // fallaria en cualquier clon recien hecho del repositorio.
    const dir = path.join(os.tmpdir(), `roost-env-${Date.now()}`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    const escribir = (nombre: string, datos: unknown) =>
      vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(dir, nombre)),
        Buffer.from(JSON.stringify(datos), "utf8"),
      );
    await escribir("http-client.env.json", {
      dev: { base: "https://dev.example.com", token: "de-ejemplo" },
      prod: { base: "https://example.com" },
    });
    await escribir("http-client.private.env.json", {
      dev: { token: "el-de-verdad" },
    });

    const { publico, privado, carpeta } = await cargar(
      vscode.Uri.file(path.join(dir, "peticiones.http")));
    assert.ok(carpeta, "no encontro la carpeta con los ficheros de entorno");
    assert.deepEqual(nombresDe(publico, privado), ["dev", "prod"]);

    const dev = variablesDe(publico, privado, "dev");
    assert.equal(dev.base, "https://dev.example.com", "hereda del publico");
    assert.equal(dev.token, "el-de-verdad", "el privado debe pisar al publico");

    const prod = variablesDe(publico, privado, "prod");
    assert.equal(prod.base, "https://example.com");
    assert.equal(prod.token, undefined, "prod no define token");
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
