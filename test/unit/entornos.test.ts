import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ErrorDeEntorno, FICHERO_PRIVADO, combinar, estaIgnorado, nombresDe,
  parsearEntornos, variablesDe,
} from "../../src/entornos";

const PUBLICO = JSON.stringify({
  dev: { base: "https://api.dev.example.com", token: "token-de-ejemplo" },
  prod: { base: "https://api.example.com" },
});
const PRIVADO = JSON.stringify({
  dev: { token: "el-de-verdad" },
  local: { base: "http://localhost:3000" },
});

test("parsea un fichero de entornos", () => {
  const e = parsearEntornos(PUBLICO, "http-client.env.json");
  assert.equal(e.dev.base, "https://api.dev.example.com");
  assert.equal(e.prod.base, "https://api.example.com");
});

test("convierte numeros y booleanos a texto", () => {
  const e = parsearEntornos('{"dev":{"puerto":8080,"debug":true}}', "x");
  assert.equal(e.dev.puerto, "8080");
  assert.equal(e.dev.debug, "true");
});

test("JSON invalido da un error que nombra el fichero", () => {
  assert.throws(
    () => parsearEntornos("{no json", "http-client.env.json"),
    (e: Error) => e instanceof ErrorDeEntorno && /http-client\.env\.json/.test(e.message),
  );
});

test("rechaza formas que no son objetos de entornos", () => {
  assert.throws(() => parsearEntornos("[1,2]", "x"), ErrorDeEntorno);
  assert.throws(() => parsearEntornos('"texto"', "x"), ErrorDeEntorno);
  assert.throws(() => parsearEntornos('{"dev": "no-objeto"}', "x"), ErrorDeEntorno);
});

test("rechaza valores anidados con un mensaje accionable", () => {
  assert.throws(
    () => parsearEntornos('{"dev":{"auth":{"token":"x"}}}', "env.json"),
    (e: Error) => e instanceof ErrorDeEntorno && /"auth".*"dev"/s.test(e.message),
  );
});

test("lista los nombres de ambos ficheros, sin repetir y ordenados", () => {
  const nombres = nombresDe(parsearEntornos(PUBLICO, "a"), parsearEntornos(PRIVADO, "b"));
  assert.deepEqual(nombres, ["dev", "local", "prod"]);
});

test("el fichero privado pisa al publico", () => {
  const vars = variablesDe(
    parsearEntornos(PUBLICO, "a"), parsearEntornos(PRIVADO, "b"), "dev");
  assert.equal(vars.base, "https://api.dev.example.com", "hereda lo publico");
  assert.equal(vars.token, "el-de-verdad", "el secreto real gana");
});

test("un entorno solo privado tambien funciona", () => {
  const vars = variablesDe(
    parsearEntornos(PUBLICO, "a"), parsearEntornos(PRIVADO, "b"), "local");
  assert.equal(vars.base, "http://localhost:3000");
});

test("sin entorno seleccionado no hay variables", () => {
  assert.deepEqual(
    variablesDe(parsearEntornos(PUBLICO, "a"), parsearEntornos(PRIVADO, "b"), undefined),
    {},
  );
});

test("las variables del fichero .http ganan al entorno", () => {
  const combinadas = combinar({ base: "https://del-entorno" }, { base: "https://del-fichero" });
  assert.equal(combinadas.base, "https://del-fichero");
});

test("el entorno aporta lo que el fichero no declara", () => {
  const combinadas = combinar({ base: "https://e", token: "T" }, { extra: "x" });
  assert.equal(combinadas.base, "https://e");
  assert.equal(combinadas.token, "T");
  assert.equal(combinadas.extra, "x");
});

// --- proteccion de secretos ------------------------------------------------

test("reconoce el fichero de secretos ignorado", () => {
  assert.equal(estaIgnorado(FICHERO_PRIVADO, FICHERO_PRIVADO), true);
  assert.equal(estaIgnorado(`node_modules/\n${FICHERO_PRIVADO}\n`, FICHERO_PRIVADO), true);
  assert.equal(estaIgnorado(`/${FICHERO_PRIVADO}`, FICHERO_PRIVADO), true);
});

test("reconoce comodines que lo cubren", () => {
  assert.equal(estaIgnorado("*.private.env.json", FICHERO_PRIVADO), true);
  assert.equal(estaIgnorado("http-client.*.json", FICHERO_PRIVADO), true);
});

test("no lo da por ignorado cuando no lo esta", () => {
  assert.equal(estaIgnorado("node_modules/\nout/\n", FICHERO_PRIVADO), false);
  assert.equal(estaIgnorado("", FICHERO_PRIVADO), false);
  assert.equal(estaIgnorado("http-client.env.json", FICHERO_PRIVADO), false,
    "el publico ignorado no cubre al privado");
});

test("los comentarios y las negaciones no cuentan como cobertura", () => {
  assert.equal(estaIgnorado(`# ${FICHERO_PRIVADO}`, FICHERO_PRIVADO), false);
  assert.equal(estaIgnorado(`!${FICHERO_PRIVADO}`, FICHERO_PRIVADO), false);
});
