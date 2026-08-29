import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAserto, evaluar, evaluarTodos, resumir } from "../../src/asserts";
import { resolver as resolverRuta, AUSENTE, comoJson } from "../../src/rutas";
import { parse } from "../../src/parser";
import type { HttpResponse } from "../../src/http";

const RESP: HttpResponse = {
  estado: 200,
  textoEstado: "OK",
  cabeceras: { "content-type": "application/json; charset=utf-8" },
  cuerpo: JSON.stringify({
    token: "abc123",
    items: [{ id: 1, nombre: "uno" }, { id: 2, nombre: "dos" }],
    vacio: [],
    nulo: null,
  }),
  ms: 250,
  bytes: 120,
};

test("parsea igualdad implicita", () => {
  const a = parseAserto("# @assert status 200");
  assert.equal(a?.objetivo, "status");
  assert.equal(a?.operador, "=");
  assert.equal(a?.esperado, "200");
});

test("parsea operadores explicitos", () => {
  assert.equal(parseAserto("# @assert time < 1000")?.operador, "<");
  assert.equal(parseAserto("// @assert status >= 200")?.operador, ">=");
  assert.equal(parseAserto("# @assert status == 201")?.operador, "=");
  assert.equal(parseAserto("# @assert body.$.token exists")?.operador, "exists");
});

test("una linea que no es aserto devuelve null", () => {
  assert.equal(parseAserto("# comentario normal"), null);
  assert.equal(parseAserto("GET https://x.dev/"), null);
});

test("status y time", () => {
  assert.equal(evaluar(parseAserto("# @assert status 200")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert status 404")!, RESP).ok, false);
  assert.equal(evaluar(parseAserto("# @assert time < 1000")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert time < 100")!, RESP).ok, false);
});

test("rutas dentro del cuerpo JSON", () => {
  assert.equal(evaluar(parseAserto("# @assert body.$.token abc123")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert body.$.token exists")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert body.$.noexiste exists")!, RESP).ok, false);
  assert.equal(evaluar(parseAserto("# @assert body.$.items[1].nombre dos")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert body.$.items.length > 1")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert body.$.items.length > 5")!, RESP).ok, false);
});

test("empty distingue lista vacia de ausente", () => {
  assert.equal(evaluar(parseAserto("# @assert body.$.vacio empty")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert body.$.items empty")!, RESP).ok, false);
});

test("cabeceras, sin importar mayusculas", () => {
  assert.equal(
    evaluar(parseAserto("# @assert header.content-type contains json")!, RESP).ok, true);
  assert.equal(
    evaluar(parseAserto("# @assert header.Content-Type contains JSON")!, RESP).ok, true);
  assert.equal(
    evaluar(parseAserto("# @assert header.x-falta exists")!, RESP).ok, false);
});

test("matches con expresion regular", () => {
  assert.equal(evaluar(parseAserto("# @assert body.$.token matches ^abc")!, RESP).ok, true);
  assert.equal(evaluar(parseAserto("# @assert body.$.token matches ^zzz")!, RESP).ok, false);
});

test("regex invalida no revienta, falla con motivo", () => {
  const r = evaluar(parseAserto("# @assert body.$.token matches [")!, RESP);
  assert.equal(r.ok, false);
  assert.match(r.motivo ?? "", /no valida/);
});

test("comparar algo no numerico da motivo claro", () => {
  const r = evaluar(parseAserto("# @assert body.$.token < 10")!, RESP);
  assert.equal(r.ok, false);
  assert.match(r.motivo ?? "", /numeros/);
});

test("el parser recoge los asertos del bloque", () => {
  const { peticiones } = parse([
    "### Login",
    "# @name login",
    "# @assert status 200",
    "# @assert body.$.token exists",
    "POST https://api.example.com/login",
  ].join("\n"));

  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].nombre, "login");
  assert.equal(peticiones[0].asertos.length, 2);
  assert.equal(peticiones[0].metodo, "POST");
});

test("los asertos no se confunden con comentarios ni rompen el cuerpo", () => {
  const { peticiones } = parse([
    "### Crear",
    "# @assert status 201",
    "# un comentario cualquiera",
    "POST https://api.example.com/users",
    "Content-Type: application/json",
    "",
    '{"a": 1}',
  ].join("\n"));

  assert.equal(peticiones[0].asertos.length, 1);
  assert.equal(peticiones[0].cuerpo, '{"a": 1}');
  assert.equal(peticiones[0].cabeceras["Content-Type"], "application/json");
});

test("resumen legible", () => {
  const asertos = [
    parseAserto("# @assert status 200")!,
    parseAserto("# @assert status 500")!,
  ];
  const texto = resumir(evaluarTodos(asertos, RESP));
  assert.match(texto, /1 de 2 asertos fallan/);
  assert.match(texto, /PASA {2}status 200/);
  assert.match(texto, /FALLA {2}status 500/);
});

test("rutas: indices, comillas y length", () => {
  const dato = comoJson('{"a": {"b c": [10, 20]}}');
  assert.equal(resolverRuta(dato, "$.a['b c'][1]"), 20);
  assert.equal(resolverRuta(dato, "$.a['b c'].length"), 2);
  assert.equal(resolverRuta(dato, "$.a.noexiste"), AUSENTE);
  assert.equal(resolverRuta(dato, "$.a['b c'][9]"), AUSENTE);
});

test("los asertos valen antes, entre cabeceras y despues del cuerpo", () => {
  const { peticiones } = parse([
    "### Mixto",
    "# @assert status 200",          // preambulo
    "POST https://x.dev/a",
    "Content-Type: application/json",
    "# @assert time < 5000",         // entre cabeceras
    "",
    '{"a": 1}',
    "# @assert body.$.ok exists",    // tras el cuerpo
  ].join("\n"));

  assert.equal(peticiones[0].asertos.length, 3);
  assert.equal(peticiones[0].cuerpo, '{"a": 1}', "el cuerpo no debe llevar el aserto");
  assert.equal(peticiones[0].cabeceras["Content-Type"], "application/json");
});

test("un aserto tras el cuerpo no se cuela como texto del cuerpo", () => {
  const { peticiones } = parse([
    "POST https://x.dev/a",
    "",
    "linea de cuerpo",
    "# @assert status 201",
  ].join("\n"));
  assert.equal(peticiones[0].cuerpo, "linea de cuerpo");
  assert.equal(peticiones[0].asertos.length, 1);
});
