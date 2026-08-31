/**
 * Integridad de lo que se publica.
 *
 * Existe por un fallo real: un `sed` de renombrado corrio sobre todos los
 * ficheros versionados, PNG incluidos, y les quito el `\r` de la firma. Los
 * 167 tests siguieron en verde, porque ninguno miraba los binarios, y el
 * paquete se genero con el icono y la captura rotos. En el Marketplace eso es
 * una ficha sin icono.
 *
 * La firma PNG lleva `\r\n` a proposito, justo para delatar ese destrozo. Aqui
 * se comprueba, junto con que todo lo que el manifiesto y el README prometen
 * exista de verdad.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

const RAIZ = path.join(__dirname, "..", "..", "..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel));
const manifiesto = JSON.parse(leer("package.json").toString("utf8"));

/** Firma completa, con el CRLF que detecta la corrupcion de saltos de linea. */
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const IMAGENES = ["icon.png", "media/hero.png"];

for (const rel of IMAGENES) {
  test(`${rel} sigue siendo un PNG valido`, () => {
    const datos = leer(rel);
    assert.ok(datos.length > 0, `${rel} esta vacio`);
    assert.ok(
      datos.subarray(0, 8).equals(FIRMA_PNG),
      `${rel} tiene la firma ${JSON.stringify(datos.subarray(0, 8).toString("latin1"))}. ` +
      `Si le falta el \\r, algo trato el binario como texto.`,
    );
    // IEND cierra todo PNG bien formado: descarta un fichero truncado.
    assert.ok(
      datos.subarray(-8).includes(Buffer.from("IEND")),
      `${rel} no termina en IEND: esta truncado`,
    );
  });
}

test("el icono del manifiesto existe y es el que se comprueba", () => {
  assert.ok(manifiesto.icon, "el manifiesto no declara icono");
  assert.ok(
    fs.existsSync(path.join(RAIZ, manifiesto.icon)),
    `el icono declarado (${manifiesto.icon}) no existe`,
  );
  assert.ok(
    IMAGENES.includes(manifiesto.icon.replace(/\\/g, "/")),
    `el icono declarado (${manifiesto.icon}) no esta en la lista que valida este test`,
  );
});

test("las imagenes que enseña el README existen", () => {
  const readme = leer("README.md").toString("utf8");
  const rutas = [...readme.matchAll(/(?:!\[[^\]]*\]\(|<img[^>]*src=")([^)"\s]+)/g)]
    .map((m) => m[1])
    .filter((r) => !r.startsWith("http"));
  assert.ok(rutas.length > 0, "el README no enseña ninguna imagen local");
  for (const rel of rutas) {
    assert.ok(fs.existsSync(path.join(RAIZ, rel)), `el README enseña ${rel}, que no existe`);
  }
});

test("no queda ningun rastro del nombre viejo", () => {
  for (const rel of ["package.json", "README.md"]) {
    assert.ok(
      !/roost/i.test(leer(rel).toString("utf8")),
      `${rel} todavia menciona el nombre anterior`,
    );
  }
});

test("el manifiesto no promete capacidades que no existen", () => {
  // Anunciar graphql o grpc en las palabras clave trae instalaciones de gente
  // que busca otra cosa, y esas se van dejando una estrella.
  const prohibidas = ["graphql", "grpc", "websocket", "soap"];
  const claves: string[] = (manifiesto.keywords ?? []).map((k: string) => k.toLowerCase());
  for (const mala of prohibidas) {
    assert.ok(!claves.includes(mala), `keyword "${mala}" sin soporte real detras`);
  }
});

test("el fichero de secretos no puede colarse en el paquete", () => {
  const ignore = leer(".vscodeignore").toString("utf8");
  assert.ok(
    ignore.includes("http-client.private.env.json"),
    ".vscodeignore ya no excluye el fichero de entorno privado",
  );
});
