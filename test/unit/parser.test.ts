import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, sustituir, resolver } from "../../src/parser";

test("peticion minima sin separador", () => {
  const { peticiones } = parse("GET https://api.example.com/users");
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].metodo, "GET");
  assert.equal(peticiones[0].url, "https://api.example.com/users");
  assert.deepEqual(peticiones[0].cabeceras, {});
  assert.equal(peticiones[0].cuerpo, undefined);
});

test("separa varias peticiones por ### y toma el titulo", () => {
  const { peticiones } = parse([
    "### Listar",
    "GET https://api.example.com/users",
    "",
    "### Crear",
    "POST https://api.example.com/users",
  ].join("\n"));

  assert.equal(peticiones.length, 2);
  assert.equal(peticiones[0].nombre, "Listar");
  assert.equal(peticiones[1].nombre, "Crear");
  assert.equal(peticiones[1].metodo, "POST");
});

test("cabeceras y cuerpo JSON", () => {
  const { peticiones } = parse([
    "POST https://api.example.com/users",
    "Content-Type: application/json",
    "Authorization: Bearer xyz",
    "",
    '{ "nombre": "Ana" }',
  ].join("\n"));

  const p = peticiones[0];
  assert.equal(p.cabeceras["Content-Type"], "application/json");
  assert.equal(p.cabeceras["Authorization"], "Bearer xyz");
  assert.equal(p.cuerpo, '{ "nombre": "Ana" }');
});

test("variables de fichero y sustitucion", () => {
  const fichero = parse([
    "@host = https://api.example.com",
    "@token = abc123",
    "",
    "GET {{host}}/users",
    "Authorization: Bearer {{token}}",
  ].join("\n"));

  assert.equal(fichero.variables.host, "https://api.example.com");
  const p = resolver(fichero.peticiones[0], fichero.variables);
  assert.equal(p.url, "https://api.example.com/users");
  assert.equal(p.cabeceras["Authorization"], "Bearer abc123");
});

test("variables encadenadas", () => {
  const vars = { base: "https://api.example.com", url: "{{base}}/v2" };
  assert.equal(sustituir("{{url}}/users", vars), "https://api.example.com/v2/users");
});

test("variable inexistente se deja tal cual, no se traga", () => {
  assert.equal(sustituir("{{falta}}/x", {}), "{{falta}}/x");
});

test("# @name da nombre a la peticion", () => {
  const { peticiones } = parse([
    "###",
    "# @name login",
    "POST https://api.example.com/login",
  ].join("\n"));
  assert.equal(peticiones[0].nombre, "login");
});

test("sin metodo explicito asume GET", () => {
  const { peticiones } = parse("https://api.example.com/ping");
  assert.equal(peticiones[0].metodo, "GET");
});

test("HTTP/1.1 al final no contamina la URL", () => {
  const { peticiones } = parse("GET https://api.example.com/users HTTP/1.1");
  assert.equal(peticiones[0].url, "https://api.example.com/users");
  assert.equal(peticiones[0].version, "HTTP/1.1");
});

test("continuacion de URL en lineas sangradas", () => {
  const { peticiones } = parse([
    "GET https://api.example.com/users",
    "  ?rol=admin",
    "  &activo=true",
  ].join("\n"));
  assert.equal(peticiones[0].url, "https://api.example.com/users?rol=admin&activo=true");
});

test("comentarios no rompen el parseo", () => {
  const { peticiones } = parse([
    "### Buscar",
    "# esto es un comentario",
    "// y esto tambien",
    "GET https://api.example.com/users",
    "# comentario entre cabeceras",
    "Accept: application/json",
  ].join("\n"));
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].cabeceras["Accept"], "application/json");
});

test("cuerpo multilinea conserva saltos internos y quita los finales", () => {
  const { peticiones } = parse([
    "POST https://api.example.com/users",
    "Content-Type: application/json",
    "",
    "{",
    '  "a": 1',
    "}",
    "",
    "",
  ].join("\n"));
  assert.equal(peticiones[0].cuerpo, '{\n  "a": 1\n}');
});

test("bloque vacio entre separadores no genera peticion", () => {
  const { peticiones } = parse("### uno\n\n###\n\n### dos\nGET https://x.dev/");
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].nombre, "dos");
});

test("fichero vacio no revienta", () => {
  const fichero = parse("");
  assert.deepEqual(fichero.peticiones, []);
  assert.deepEqual(fichero.variables, {});
});

test("las peticiones apuntan a la linea correcta para el CodeLens", () => {
  const texto = [
    "@host = https://x.dev",   // 0
    "",                        // 1
    "### Uno",                 // 2
    "GET {{host}}/a",          // 3
    "",                        // 4
    "### Dos",                 // 5
    "GET {{host}}/b",          // 6
  ].join("\n");
  const { peticiones } = parse(texto);
  const lineas = texto.split("\n");
  assert.equal(peticiones.length, 2);
  for (const p of peticiones) {
    assert.match(lineas[p.lineaPeticion], /^GET /,
      `lineaPeticion=${p.lineaPeticion} apunta a "${lineas[p.lineaPeticion]}"`);
  }
});

// --- finales de linea de Windows -------------------------------------------
// El proyecto se desarrolla en Windows y git normaliza a CRLF al hacer
// checkout, asi que los .http reales llegaran con \r\n. Si el \r se cuela en
// una cabecera o en el cuerpo, la peticion sale mal por la red.

const CRLF = String.fromCharCode(13, 10);

test("CRLF: cabeceras y cuerpo salen sin retorno de carro", () => {
  const { peticiones } = parse([
    "### Crear",
    "# @name crear",
    "# @assert status 201",
    "POST https://x.dev/users",
    "Content-Type: application/json",
    "Authorization: Bearer abc",
    "",
    '{"a": 1}',
  ].join(CRLF));

  const p = peticiones[0];
  assert.equal(p.metodo, "POST");
  assert.equal(p.url, "https://x.dev/users", "la URL no puede llevar \r");
  assert.equal(p.cabeceras["Content-Type"], "application/json");
  assert.equal(p.cabeceras["Authorization"], "Bearer abc");
  assert.equal(p.cuerpo, '{"a": 1}');
  assert.equal(p.nombre, "crear");
  assert.equal(p.asertos.length, 1);

  for (const [clave, valor] of Object.entries(p.cabeceras)) {
    assert.doesNotMatch(clave, /\r/, "clave de cabecera con \r");
    assert.doesNotMatch(valor, /\r/, "valor de cabecera con \r");
  }
  assert.doesNotMatch(p.cuerpo ?? "", /\r/);
});

test("CRLF: variables y separadores", () => {
  const fichero = parse([
    "@base = https://x.dev",
    "",
    "### Uno",
    "GET {{base}}/a",
    "",
    "### Dos",
    "GET {{base}}/b",
  ].join(CRLF));

  assert.equal(fichero.variables.base, "https://x.dev", "la variable no puede llevar \r");
  assert.equal(fichero.peticiones.length, 2);
  assert.equal(resolver(fichero.peticiones[0], fichero.variables).url, "https://x.dev/a");
});

test("CRLF: cuerpo multilinea conserva la forma", () => {
  const { peticiones } = parse([
    "POST https://x.dev/a",
    "Content-Type: application/json",
    "",
    "{",
    '  "a": 1',
    "}",
  ].join(CRLF));
  assert.equal(peticiones[0].cuerpo, '{\n  "a": 1\n}');
});
