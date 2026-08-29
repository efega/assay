import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Almacen, ErrorDeCadena, MAX_PROFUNDIDAD, aplicar, referencias,
  referenciasDe, resolverDependencias, sustituirReferencias, valorDe,
} from "../../src/cadena";
import { parse, resolver as aplicarVariables } from "../../src/parser";
import type { HttpResponse } from "../../src/http";
import type { HttpRequest } from "../../src/parser";

function respuesta(cuerpo: string, extra: Partial<HttpResponse> = {}): HttpResponse {
  return {
    estado: 200,
    textoEstado: "OK",
    cabeceras: { "content-type": "application/json", "x-pista": "hola" },
    cuerpo,
    ms: 10,
    bytes: cuerpo.length,
    ...extra,
  };
}

function almacenCon(nombre: string, cuerpo: string): Almacen {
  const a = new Almacen();
  a.guardar(nombre, respuesta(cuerpo));
  return a;
}

test("detecta referencias en un texto", () => {
  const refs = referencias(
    "Bearer {{login.response.body.$.token}} y {{login.response.status}}",
  );
  assert.equal(refs.length, 2);
  assert.equal(refs[0].peticion, "login");
  assert.equal(refs[0].parte, "body");
  assert.equal(refs[0].ruta, "$.token");
  assert.equal(refs[1].parte, "status");
});

test("una variable normal no es una referencia de cadena", () => {
  assert.equal(referencias("{{base}}/users").length, 0);
});

test("recoge referencias de url, cabeceras y cuerpo", () => {
  const { peticiones } = parse([
    "GET https://x.dev/{{a.response.body.$.id}}",
    "Authorization: Bearer {{b.response.body.$.tok}}",
    "",
    '{"eco": "{{c.response.status}}"}',
  ].join("\n"));
  const refs = referenciasDe(peticiones[0]);
  assert.deepEqual(refs.map((r) => r.peticion).sort(), ["a", "b", "c"]);
});

test("resuelve body, ruta, cabecera y status", () => {
  const a = almacenCon("login", '{"token":"abc","user":{"id":7}}');
  assert.equal(valorDe(referencias("{{login.response.body.$.token}}")[0], a), "abc");
  assert.equal(valorDe(referencias("{{login.response.body.$.user.id}}")[0], a), "7");
  assert.equal(valorDe(referencias("{{login.response.status}}")[0], a), "200");
  assert.equal(valorDe(referencias("{{login.response.headers.x-pista}}")[0], a), "hola");
});

test("body sin ruta devuelve el cuerpo entero", () => {
  const a = almacenCon("x", '{"a":1}');
  assert.equal(valorDe(referencias("{{x.response.body}}")[0], a), '{"a":1}');
});

test("errores utiles cuando algo no esta", () => {
  const a = almacenCon("login", '{"token":"abc"}');

  assert.throws(
    () => valorDe(referencias("{{otra.response.body.$.x}}")[0], a),
    (e: Error) => e instanceof ErrorDeCadena && /has not run yet/.test(e.message),
  );
  assert.throws(
    () => valorDe(referencias("{{login.response.body.$.noexiste}}")[0], a),
    (e: Error) => e instanceof ErrorDeCadena && /not found in the response/.test(e.message),
  );
  assert.throws(
    () => valorDe(referencias("{{login.response.headers.x-falta}}")[0], a),
    (e: Error) => e instanceof ErrorDeCadena && /did not return header/.test(e.message),
  );
});

test("aplica referencias a la peticion completa", () => {
  const a = almacenCon("login", '{"token":"T0K3N","id":42}');
  const { peticiones } = parse([
    "GET https://x.dev/users/{{login.response.body.$.id}}",
    "Authorization: Bearer {{login.response.body.$.token}}",
  ].join("\n"));

  const p = aplicar(peticiones[0], a);
  assert.equal(p.url, "https://x.dev/users/42");
  assert.equal(p.cabeceras["Authorization"], "Bearer T0K3N");
});

test("sustituye la misma referencia varias veces", () => {
  const a = almacenCon("x", '{"v":"Z"}');
  assert.equal(
    sustituirReferencias("{{x.response.body.$.v}}-{{x.response.body.$.v}}", a),
    "Z-Z",
  );
});

// --- ejecucion de dependencias, con ejecutor simulado -----------------------

function ejecutorSimulado(respuestas: Record<string, string>, registro: string[]) {
  return async (p: HttpRequest): Promise<HttpResponse> => {
    registro.push(p.url);
    const clave = Object.keys(respuestas).find((k) => p.url.includes(k));
    return respuesta(clave ? respuestas[clave] : "{}");
  };
}

test("ejecuta la dependencia que falta, una sola vez", async () => {
  const fichero = parse([
    "### Login",
    "# @name login",
    "POST https://x.dev/login",
    "",
    "### Perfil",
    "GET https://x.dev/me",
    "Authorization: Bearer {{login.response.body.$.token}}",
  ].join("\n"));

  const registro: string[] = [];
  const almacen = new Almacen();
  const ejecutar = ejecutorSimulado({ login: '{"token":"T"}' }, registro);

  const r1 = await resolverDependencias(
    fichero.peticiones[1], fichero, almacen, ejecutar, (p) => p);
  assert.deepEqual(r1.ejecutadas, ["login"]);
  assert.deepEqual(registro, ["https://x.dev/login"]);

  // Segunda vez: ya esta en el almacen, no se repite la llamada.
  const r2 = await resolverDependencias(
    fichero.peticiones[1], fichero, almacen, ejecutar, (p) => p);
  assert.deepEqual(r2.ejecutadas, []);
  assert.equal(registro.length, 1);

  assert.equal(
    aplicar(fichero.peticiones[1], almacen).cabeceras["Authorization"],
    "Bearer T",
  );
});

test("cadena de tres eslabones se ejecuta en orden", async () => {
  const fichero = parse([
    "### A", "# @name a", "GET https://x.dev/a", "",
    "### B", "# @name b", "GET https://x.dev/b/{{a.response.body.$.v}}", "",
    "### C", "GET https://x.dev/c/{{b.response.body.$.v}}",
  ].join("\n"));

  const registro: string[] = [];
  const ejecutar = ejecutorSimulado({ "/a": '{"v":"1"}', "/b": '{"v":"2"}' }, registro);
  const r = await resolverDependencias(
    fichero.peticiones[2], fichero, new Almacen(), ejecutar, (p) => p);

  assert.deepEqual(r.ejecutadas, ["a", "b"]);
  assert.deepEqual(registro, ["https://x.dev/a", "https://x.dev/b/1"]);
});

test("dependencia circular falla nombrando el ciclo, sin colgarse", async () => {
  const fichero = parse([
    "### A", "# @name a", "GET https://x.dev/a/{{b.response.body.$.v}}", "",
    "### B", "# @name b", "GET https://x.dev/b/{{a.response.body.$.v}}",
  ].join("\n"));

  await assert.rejects(
    () => resolverDependencias(
      fichero.peticiones[0], fichero, new Almacen(), ejecutorSimulado({}, []), (p) => p),
    (e: Error) => e instanceof ErrorDeCadena && /[Cc]ircular/.test(e.message),
  );
});

test("una peticion que se referencia a si misma tambien es ciclo", async () => {
  const fichero = parse([
    "### A", "# @name a", "GET https://x.dev/a/{{a.response.body.$.v}}",
  ].join("\n"));

  await assert.rejects(
    () => resolverDependencias(
      fichero.peticiones[0], fichero, new Almacen(), ejecutorSimulado({}, []), (p) => p),
    (e: Error) => e instanceof ErrorDeCadena && /[Cc]ircular/.test(e.message),
  );
});

test("cadena mas larga que el limite se corta", async () => {
  const eslabones = MAX_PROFUNDIDAD + 3;
  const lineas: string[] = [];
  for (let n = 0; n < eslabones; n++) {
    lineas.push(`### P${n}`, `# @name p${n}`);
    lineas.push(n === 0
      ? "GET https://x.dev/p0"
      : `GET https://x.dev/p${n}/{{p${n - 1}.response.body.$.v}}`);
    lineas.push("");
  }
  const fichero = parse(lineas.join("\n"));

  await assert.rejects(
    () => resolverDependencias(
      fichero.peticiones[eslabones - 1], fichero, new Almacen(),
      ejecutorSimulado({}, []), (p) => p),
    (e: Error) => e instanceof ErrorDeCadena && /too long/.test(e.message),
  );
});

test("referencia a una peticion sin nombre da un mensaje accionable", async () => {
  const fichero = parse("GET https://x.dev/me/{{login.response.body.$.id}}");
  await assert.rejects(
    () => resolverDependencias(
      fichero.peticiones[0], fichero, new Almacen(), ejecutorSimulado({}, []), (p) => p),
    (e: Error) => e instanceof ErrorDeCadena && /@name login/.test(e.message),
  );
});

test("las variables del fichero se aplican a la dependencia antes de lanzarla", async () => {
  const fichero = parse([
    "@base = https://api.dev",
    "",
    "### Login", "# @name login", "POST {{base}}/login", "",
    "### Perfil", "GET {{base}}/me",
    "Authorization: Bearer {{login.response.body.$.token}}",
  ].join("\n"));

  const registro: string[] = [];
  await resolverDependencias(
    fichero.peticiones[1], fichero, new Almacen(),
    ejecutorSimulado({ login: '{"token":"T"}' }, registro),
    (p) => aplicarVariables(p, fichero.variables),
  );
  assert.deepEqual(registro, ["https://api.dev/login"]);
});

test("el almacen se vacia del todo al limpiarlo", () => {
  const a = almacenCon("x", '{"v":1}');
  assert.equal(a.tiene("x"), true);
  a.limpiar();
  assert.equal(a.tiene("x"), false);
});
