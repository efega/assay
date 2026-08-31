import { strict as assert } from "node:assert";
import { test } from "node:test";

import { Tarro, parsearSetCookie } from "../../src/cookies";

const U = (s: string) => new URL(s);

test("guarda una cookie y la manda al mismo host", () => {
  const t = new Tarro();
  t.guardar(["sesion=abc123"], U("https://api.example.com/auth"));
  assert.equal(t.cabeceraPara(U("https://api.example.com/me")), "sesion=abc123");
});

test("no la manda a otro host", () => {
  const t = new Tarro();
  t.guardar(["sesion=abc123"], U("https://api.example.com/auth"));
  assert.equal(t.cabeceraPara(U("https://otra.com/me")), "");
});

test("sin atributo Domain la cookie es solo del host exacto", () => {
  const t = new Tarro();
  t.guardar(["s=1"], U("https://api.example.com/"));
  assert.equal(t.cabeceraPara(U("https://otro.example.com/")), "");
  assert.equal(t.cabeceraPara(U("https://api.example.com/")), "s=1");
});

test("con Domain valido cubre los subdominios", () => {
  const t = new Tarro();
  t.guardar(["s=1; Domain=example.com"], U("https://api.example.com/"));
  assert.equal(t.cabeceraPara(U("https://otro.example.com/")), "s=1");
});

test("SEGURIDAD: rechaza un Domain de otro dominio", () => {
  const t = new Tarro();
  t.guardar(["robada=1; Domain=banco.com"], U("https://malicioso.com/"));
  assert.equal(t.tamano, 0);
  assert.equal(t.cabeceraPara(U("https://banco.com/")), "");
});

test("SEGURIDAD: rechaza un Domain que sea un sufijo generico", () => {
  const t = new Tarro();
  t.guardar(["ancha=1; Domain=com"], U("https://api.example.com/"));
  assert.equal(t.tamano, 0);
});

test("SEGURIDAD: una cookie Secure no viaja por http", () => {
  const t = new Tarro();
  t.guardar(["s=1; Secure"], U("https://api.example.com/"));
  assert.equal(t.cabeceraPara(U("http://api.example.com/")), "");
  assert.equal(t.cabeceraPara(U("https://api.example.com/")), "s=1");
});

test("respeta Path", () => {
  const t = new Tarro();
  t.guardar(["s=1; Path=/admin"], U("https://x.com/"));
  assert.equal(t.cabeceraPara(U("https://x.com/admin/panel")), "s=1");
  assert.equal(t.cabeceraPara(U("https://x.com/publico")), "");
  // /admin no debe cubrir /administracion
  assert.equal(t.cabeceraPara(U("https://x.com/administracion")), "");
});

test("path por defecto: el directorio de la peticion", () => {
  const t = new Tarro();
  t.guardar(["s=1"], U("https://x.com/api/v1/login"));
  assert.equal(t.cabeceraPara(U("https://x.com/api/v1/me")), "s=1");
  assert.equal(t.cabeceraPara(U("https://x.com/otro")), "");
});

test("Max-Age en el pasado borra la cookie", () => {
  const t = new Tarro();
  t.guardar(["s=1"], U("https://x.com/"));
  assert.equal(t.tamano, 1);
  t.guardar(["s=; Max-Age=0"], U("https://x.com/"));
  assert.equal(t.tamano, 0);
});

test("Max-Age manda sobre Expires", () => {
  const t = new Tarro();
  t.guardar(
    ["s=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=3600"],
    U("https://x.com/"),
  );
  assert.equal(t.cabeceraPara(U("https://x.com/")), "s=1");
});

test("una cookie caducada no se manda", () => {
  const t = new Tarro();
  t.guardar(["s=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT"], U("https://x.com/"));
  assert.equal(t.cabeceraPara(U("https://x.com/")), "");
});

test("varias Set-Cookie, que es lo que forEach rompia", () => {
  const t = new Tarro();
  t.guardar(
    ["a=1; Expires=Wed, 09 Jun 2100 10:18:14 GMT", "b=2", "c=3"],
    U("https://x.com/"),
  );
  assert.equal(t.tamano, 3);
  const cabecera = t.cabeceraPara(U("https://x.com/"));
  for (const par of ["a=1", "b=2", "c=3"]) assert.ok(cabecera.includes(par));
});

test("la cookie mas especifica va primero", () => {
  const t = new Tarro();
  t.guardar(["ancha=1; Path=/"], U("https://x.com/"));
  t.guardar(["estrecha=2; Path=/a/b"], U("https://x.com/"));
  assert.equal(t.cabeceraPara(U("https://x.com/a/b")), "estrecha=2; ancha=1");
});

test("reescribir la misma cookie la actualiza, no la duplica", () => {
  const t = new Tarro();
  t.guardar(["s=viejo"], U("https://x.com/"));
  t.guardar(["s=nuevo"], U("https://x.com/"));
  assert.equal(t.tamano, 1);
  assert.equal(t.cabeceraPara(U("https://x.com/")), "s=nuevo");
});

test("un valor con signos igual se conserva entero", () => {
  const t = new Tarro();
  t.guardar(["jwt=aaa.bbb.ccc==; Path=/"], U("https://x.com/"));
  assert.equal(t.cabeceraPara(U("https://x.com/")), "jwt=aaa.bbb.ccc==");
});

test("una Set-Cookie sin nombre se ignora", () => {
  const t = new Tarro();
  t.guardar(["=solovalor", "", "   ", "sinigual"], U("https://x.com/"));
  assert.equal(t.tamano, 0);
});

test("limpiar vacia la sesion", () => {
  const t = new Tarro();
  t.guardar(["s=1"], U("https://x.com/"));
  t.limpiar();
  assert.equal(t.tamano, 0);
  assert.equal(t.cabeceraPara(U("https://x.com/")), "");
});

test("valores() devuelve lo que hay que enmascarar", () => {
  const t = new Tarro();
  t.guardar(["s=secretisimo", "otra=tambien"], U("https://x.com/"));
  assert.deepEqual(t.valores().sort(), ["secretisimo", "tambien"]);
});

test("localhost funciona, que es el caso de desarrollo", () => {
  const t = new Tarro();
  t.guardar(["s=1"], U("http://localhost:3000/api/login"));
  assert.equal(t.cabeceraPara(U("http://localhost:3000/api/me")), "s=1");
});

test("parsearSetCookie devuelve null si no hay par nombre=valor", () => {
  assert.equal(parsearSetCookie("solotexto", U("https://x.com/")), null);
  assert.equal(parsearSetCookie("", U("https://x.com/")), null);
});

test("mayusculas y minusculas en los atributos dan igual", () => {
  const t = new Tarro();
  t.guardar(["s=1; PATH=/a; SECURE; DOMAIN=x.com"], U("https://api.x.com/"));
  assert.equal(t.cabeceraPara(U("https://api.x.com/a/b")), "s=1");
  assert.equal(t.cabeceraPara(U("http://api.x.com/a/b")), "");
});
