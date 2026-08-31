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

/**
 * Idioma. La regla del proyecto: lo que ve el usuario va en ingles, los
 * comentarios y los nombres internos en castellano. Se colo un `(ausente)` en
 * la salida en su dia, y habia alias de aserto en castellano que no
 * documentaba nadie.
 */
const FUENTES = ["src/asserts.ts", "src/cadena.ts", "src/cookies.ts",
                 "src/diagnosticos.ts", "src/entornos.ts", "src/entornosEditor.ts",
                 "src/extension.ts", "src/http.ts", "src/parser.ts",
                 "src/respuesta.ts", "src/rutas.ts"];

/** Quita // y comentarios de bloque sin tocar el interior de las cadenas. */
function sinComentarios(src: string): string {
  const salida: string[] = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      salida.push(c); i++;
      while (i < src.length) {
        if (src[i] === "\\") { salida.push(src.slice(i, i + 2)); i += 2; continue; }
        salida.push(src[i]);
        if (src[i] === c) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i + 1 < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2; continue;
    }
    salida.push(c); i++;
  }
  return salida.join("");
}

test("no hay rayas largas en nada de lo que se publica", () => {
  // Son un tic reconocible y el proyecto las evita a proposito.
  const RAYA = String.fromCharCode(0x2014), SEMI = String.fromCharCode(0x2013);
  for (const rel of [...FUENTES, "README.md", "CHANGELOG.md", "package.json"]) {
    const texto = leer(rel).toString("utf8");
    assert.ok(!texto.includes(RAYA), `${rel} contiene una raya larga`);
    assert.ok(!texto.includes(SEMI), `${rel} contiene una semirraya`);
  }
});

test("los objetivos de aserto solo existen en ingles", () => {
  const fuente = sinComentarios(leer("src/asserts.ts").toString("utf8"));
  for (const alias of ["estado", "tiempo", "cabecera.", "cuerpo."]) {
    assert.ok(
      !fuente.includes(`"${alias}"`),
      `sigue aceptandose el alias en castellano "${alias}"`,
    );
  }
  // Y los de verdad siguen ahi, para que este test no pase por vaciarlo todo.
  for (const bueno of ["status", "time", "bytes", "header.", "body."]) {
    assert.ok(fuente.includes(`"${bueno}"`), `falta el objetivo "${bueno}"`);
  }
});

test("los identificadores que ve el usuario estan en ingles", () => {
  // Los ids de comando salen en keybindings.json y en la pantalla de atajos.
  // Los titulos ya estaban en ingles y los ids no, que es lo peor de los dos.
  const castellano = /(enviar|fichero|cadena|entorno|aserto|peticion|limpiar|nuevo|seleccionar|empezar|primera)/i;
  for (const c of manifiesto.contributes.commands as { command: string }[]) {
    assert.ok(!castellano.test(c.command), `el comando ${c.command} sigue en castellano`);
  }
  for (const k of Object.keys(manifiesto.contributes.configuration.properties)) {
    assert.ok(!castellano.test(k), `el ajuste ${k} sigue en castellano`);
  }
  for (const w of manifiesto.contributes.walkthroughs as
       { id: string; steps: { id: string; media: { markdown: string } }[] }[]) {
    assert.ok(!castellano.test(w.id), `el tutorial ${w.id} sigue en castellano`);
    for (const s of w.steps) {
      assert.ok(!castellano.test(s.id), `el paso ${s.id} sigue en castellano`);
      assert.ok(!castellano.test(s.media.markdown),
        `${s.media.markdown} sigue en castellano`);
    }
  }
});

test("el compilado no publica los comentarios internos", () => {
  // Estan en castellano a proposito, y DESARROLLO.md dice que no los ve nadie
  // de fuera. Eso solo es cierto si se compilan fuera.
  const tsconfig = JSON.parse(
    leer("tsconfig.json").toString("utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(tsconfig.compilerOptions.removeComments, true,
    "sin removeComments, todo el comentario en castellano viaja dentro del .vsix");
});

test("el fichero de ejemplo que se publica esta en ingles", () => {
  // Se empaqueta en el .vsix y es de lo primero que abre quien evalua la
  // extension. Estuvo entero en castellano, y hasta decia Pulsa "Enviar"
  // cuando el boton pone "Send".
  const texto = leer("samples/example.http").toString("utf8").toLowerCase();
  const castellano = ["fichero", "peticion", "cabecera", "envio", "enviar",
                      "pulsa", "ejemplo", "consulta", "asertos", "encadenado",
                      "nombre", "parametros", "codigo", "respuesta"];
  const halladas = castellano.filter((p) => texto.includes(p));
  assert.deepEqual(halladas, [], `el ejemplo tiene castellano: ${halladas}`);
});

test("el fichero de secretos no puede colarse en el paquete", () => {
  const ignore = leer(".vscodeignore").toString("utf8");
  assert.ok(
    ignore.includes("http-client.private.env.json"),
    ".vscodeignore ya no excluye el fichero de entorno privado",
  );
});
