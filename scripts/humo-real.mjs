/**
 * Prueba de humo contra APIs publicas de verdad.
 *
 * NO forma parte de `npm test` a proposito: un test que depende de httpbin
 * falla cuando falla httpbin, y un test que falla por causas ajenas deja de
 * creerse. Esto se lanza a mano, cuando quieres saber si la extension aguanta
 * fuera del servidor de laboratorio.
 *
 *     node scripts/humo-real.mjs
 *
 * Ejercita el nucleo entero -parser, entornos, cadena, cookies, asertos- por
 * las mismas funciones que usa la extension, contra servidores reales con TLS,
 * gzip, chunked, redirecciones y latencia de verdad.
 */

import { parse } from "../out/src/parser.js";
import { ejecutar } from "../out/src/http.js";
import { Tarro } from "../out/src/cookies.js";
import { Almacen, aplicar, resolverDependencias } from "../out/src/cadena.js";
import { evaluarTodos } from "../out/src/asserts.js";

const VERDE = "\x1b[32m", ROJO = "\x1b[31m", GRIS = "\x1b[90m", FIN = "\x1b[0m";
let bien = 0, mal = 0;
const fallos = [];

async function caso(nombre, fn) {
  const t0 = Date.now();
  try {
    await fn();
    bien++;
    console.log(`  ${VERDE}PASS${FIN}  ${nombre} ${GRIS}${Date.now() - t0}ms${FIN}`);
  } catch (e) {
    mal++;
    fallos.push([nombre, e.message]);
    console.log(`  ${ROJO}FAIL${FIN}  ${nombre}`);
    console.log(`        ${ROJO}${e.message}${FIN}`);
  }
}

const afirmar = (cond, msg) => { if (!cond) throw new Error(msg); };
const primera = (texto) => parse(texto).peticiones[0];

/** Envia una peticion suelta escrita en sintaxis .http. */
const enviar = (texto, opciones = {}) => ejecutar(primera(texto), { timeoutMs: 25000, ...opciones });

console.log("\nHumo contra APIs reales\n");

// ---------------------------------------------------------------- basico
console.log("Basico");

await caso("GET con TLS y JSON", async () => {
  const r = await enviar("GET https://httpbin.org/get");
  afirmar(r.estado === 200, `estado ${r.estado}`);
  afirmar(JSON.parse(r.cuerpo).url.includes("httpbin.org"), "el cuerpo no es el esperado");
});

await caso("POST con cuerpo JSON que el servidor devuelve", async () => {
  const r = await enviar(`POST https://httpbin.org/post
Content-Type: application/json

{ "hola": "mundo" }`);
  afirmar(r.estado === 200, `estado ${r.estado}`);
  afirmar(JSON.parse(r.cuerpo).json.hola === "mundo", "el JSON no llego entero");
});

await caso("gzip se descomprime solo", async () => {
  const r = await enviar("GET https://httpbin.org/gzip");
  afirmar(r.estado === 200, `estado ${r.estado}`);
  afirmar(JSON.parse(r.cuerpo).gzipped === true, "no venia comprimido");
});

await caso("404 se entrega, no se convierte en error", async () => {
  const r = await enviar("GET https://httpbin.org/status/404");
  afirmar(r.estado === 404, `estado ${r.estado}`);
});

await caso("respuesta grande, 100 KB", async () => {
  const r = await enviar("GET https://httpbin.org/bytes/102400");
  afirmar(r.estado === 200, `estado ${r.estado}`);
  afirmar(r.bytes > 50000, `solo ${r.bytes} bytes`);
});

await caso("timeout corta de verdad", async () => {
  const t0 = Date.now();
  try {
    await enviar("GET https://httpbin.org/delay/10", { timeoutMs: 2000 });
    throw new Error("deberia haber cortado");
  } catch (e) {
    afirmar(/timed out/i.test(e.message), `mensaje inesperado: ${e.message}`);
    afirmar(Date.now() - t0 < 6000, "tardo mas de la cuenta en cortar");
  }
});

await caso("un host que no existe da un error legible", async () => {
  try {
    await enviar("GET https://no-existe-esto-de-verdad-12345.dev/");
    throw new Error("deberia haber fallado");
  } catch (e) {
    afirmar(/Could not reach/.test(e.message), `mensaje inesperado: ${e.message}`);
  }
});

// ---------------------------------------------------------------- asertos
console.log("\nAsertos");

await caso("los asertos se evaluan contra una respuesta real", async () => {
  const p = primera(`GET https://httpbin.org/json

# @assert status 200
# @assert time < 20000
# @assert header.content-type contains json
# @assert body.$.slideshow.title exists`);
  const r = await ejecutar(p, { timeoutMs: 25000 });
  const res = evaluarTodos(p.asertos, r);
  const fallan = res.filter((x) => !x.ok);
  afirmar(fallan.length === 0, `fallaron: ${fallan.map((f) => f.texto).join(", ")}`);
});

await caso("un aserto falso falla, que es lo que hay que comprobar", async () => {
  const p = primera(`GET https://httpbin.org/status/200

# @assert status 500`);
  const r = await ejecutar(p, { timeoutMs: 25000 });
  afirmar(evaluarTodos(p.asertos, r).filter((x) => !x.ok).length === 1,
    "un aserto imposible deberia fallar");
});

// ---------------------------------------------------------------- cadena
console.log("\nCadena");

await caso("token real de una peticion a la siguiente", async () => {
  const fichero = parse(`@base = https://httpbin.org

### Pide algo que devuelve un valor
# @name origen
POST {{base}}/post
Content-Type: application/json

{ "token": "TOKEN-DE-VERDAD-123" }

### Usa ese valor en una cabecera
GET {{base}}/bearer
Authorization: Bearer {{origen.response.body.$.json.token}}`);

  const objetivo = fichero.peticiones[1];
  const almacen = new Almacen();
  const vars = (p) => {
    const sust = (t) => t.replaceAll("{{base}}", fichero.variables.base);
    const cab = {};
    for (const [k, v] of Object.entries(p.cabeceras)) cab[sust(k)] = sust(v);
    return { ...p, url: sust(p.url), cabeceras: cab,
             cuerpo: p.cuerpo ? sust(p.cuerpo) : undefined };
  };

  const { ejecutadas } = await resolverDependencias(
    objetivo, fichero, almacen, (p) => ejecutar(p, { timeoutMs: 25000 }), vars);
  afirmar(ejecutadas.includes("origen"), `no lanzo la dependencia: ${ejecutadas}`);

  const r = await ejecutar(aplicar(vars(objetivo), almacen), { timeoutMs: 25000 });
  afirmar(r.estado === 200, `estado ${r.estado}`);
  afirmar(JSON.parse(r.cuerpo).token === "TOKEN-DE-VERDAD-123",
    "el servidor no recibio el token encadenado");
});

// ---------------------------------------------------------------- cookies
console.log("\nCookies");

// /cookies/set redirige, tanto en httpbin como en postman-echo, asi que no
// sirve para esto. /response-headers devuelve 200 con la cabecera que le pidas,
// que es un login real en miniatura.
const PONER = "https://httpbin.org/response-headers?Set-Cookie=sesion%3DABC123";

await caso("una cookie real se guarda y vuelve al servidor", async () => {
  const tarro = new Tarro();
  await enviar(`GET ${PONER}`, { tarro });
  afirmar(tarro.tamano > 0, "no se guardo ninguna cookie");
  const r = await enviar("GET https://httpbin.org/cookies", { tarro });
  const vistas = JSON.parse(r.cuerpo).cookies;
  afirmar(vistas.sesion === "ABC123", `el servidor vio ${JSON.stringify(vistas)}`);
});

await caso("sin tarro, la sesion no viaja", async () => {
  const tarro = new Tarro();
  await enviar(`GET ${PONER}`, { tarro });
  const r = await enviar("GET https://httpbin.org/cookies");   // sin tarro
  afirmar(Object.keys(JSON.parse(r.cuerpo).cookies).length === 0,
    "viajo una cookie que no deberia");
});

await caso("una cabecera Cookie a mano gana al tarro", async () => {
  const tarro = new Tarro();
  await enviar(`GET ${PONER}`, { tarro });
  const r = await enviar(`GET https://httpbin.org/cookies
Cookie: sesion=AMANO`, { tarro });
  afirmar(JSON.parse(r.cuerpo).cookies.sesion === "AMANO",
    "el tarro piso una cabecera escrita a mano");
});

await caso("las cookies solo van a su propio host", async () => {
  const tarro = new Tarro();
  await enviar(`GET ${PONER}`, { tarro });
  const r = await enviar("GET https://postman-echo.com/get", { tarro });
  const enviadas = JSON.parse(r.cuerpo).headers.cookie ?? "";
  afirmar(!enviadas.includes("ABC123"),
    `una cookie de httpbin viajo a postman-echo: ${enviadas}`);
});

await caso("LIMITACION DOCUMENTADA: cookie puesta en un 302 no se captura", async () => {
  const tarro = new Tarro();
  // httpbin responde 302 con Set-Cookie y redirige. Como se siguen las
  // redirecciones, esa cabecera no la vemos. Si algun dia esto empieza a
  // pasar, es que se arreglo la limitacion y hay que actualizar el README.
  await enviar("GET https://httpbin.org/cookies/set?a=1", { tarro });
  afirmar(tarro.tamano === 0,
    `se capturo una cookie del 302: la limitacion del README ya no es cierta`);
});

// ---------------------------------------------------------------- final
console.log(`\n${bien} pasan, ${mal} fallan\n`);
if (mal > 0) {
  console.log("Fallos:");
  for (const [n, m] of fallos) console.log(`  ${ROJO}${n}${FIN}: ${m}`);
}
process.exit(mal > 0 ? 1 : 0);
