/**
 * Pruebas de `ejecutar()` y `formatear()` contra un servidor local.
 *
 * Local a proposito: un test que depende de httpbin falla cuando falla
 * httpbin, y entonces deja de creerse. Aqui se controlan las respuestas, los
 * retrasos y los cortes.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpError, ejecutar, formatear, redactarValores } from "../../src/http";
import { parse } from "../../src/parser";

let servidor: http.Server;
let base = "";

before(async () => {
  servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/lento") {
      setTimeout(() => { res.writeHead(200); res.end("tarde"); }, 3000);
      return;
    }
    if (url.pathname === "/corta") {
      res.destroy();          // conexion cortada a media respuesta
      return;
    }
    if (url.pathname === "/eco") {
      let cuerpo = "";
      req.on("data", (c) => { cuerpo += c; });
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({
          metodo: req.method,
          cuerpo,
          cabeceraRecibida: req.headers["x-prueba"] ?? null,
        }));
      });
      return;
    }
    if (url.pathname === "/cookie") {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "sid=SECRETO-DE-SESION; HttpOnly",
        "x-api-key": "CLAVE-SECRETA",
        "x-normal": "visible",
      });
      res.end('{"ok":true}');
      return;
    }
    if (url.pathname === "/texto") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hola\nmundo");
      return;
    }
    if (url.pathname === "/jsonroto") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{esto no es json");
      return;
    }
    if (url.pathname === "/404") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"no existe"}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ruta: url.pathname, query: url.search }));
  });

  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => servidor.close());

function peticionDe(texto: string) {
  return parse(texto).peticiones[0];
}

test("GET devuelve estado, cuerpo, tiempo y tamanyo", async () => {
  const r = await ejecutar(peticionDe(`GET ${base}/hola`));
  assert.equal(r.estado, 200);
  assert.equal(r.textoEstado, "OK");
  assert.match(r.cuerpo, /"ruta":"\/hola"/);
  assert.ok(r.ms >= 0 && r.ms < 5000);
  assert.equal(r.bytes, Buffer.byteLength(r.cuerpo, "utf8"));
  assert.equal(r.cabeceras["content-type"], "application/json");
});

test("POST envia cuerpo y cabeceras", async () => {
  const r = await ejecutar(peticionDe([
    `POST ${base}/eco`,
    "Content-Type: application/json",
    "X-Prueba: valor-enviado",
    "",
    '{"a":1}',
  ].join("\n")));

  assert.equal(r.estado, 201);
  const datos = JSON.parse(r.cuerpo);
  assert.equal(datos.metodo, "POST");
  assert.equal(datos.cuerpo, '{"a":1}');
  assert.equal(datos.cabeceraRecibida, "valor-enviado");
});

test("un GET no manda cuerpo aunque el fichero lo traiga", async () => {
  const p = { ...peticionDe(`GET ${base}/eco`), cuerpo: '{"no":"deberia"}' };
  const r = await ejecutar(p);
  assert.equal(r.estado, 201, "fetch reventaria si se enviara cuerpo en un GET");
  assert.equal(JSON.parse(r.cuerpo).cuerpo, "", "el servidor no debe recibir cuerpo");
});

test("un 404 es una respuesta, no un error", async () => {
  const r = await ejecutar(peticionDe(`GET ${base}/404`));
  assert.equal(r.estado, 404);
  assert.match(r.cuerpo, /no existe/);
});

test("el timeout corta y lo dice en segundos", async () => {
  await assert.rejects(
    () => ejecutar(peticionDe(`GET ${base}/lento`), { timeoutMs: 300 }),
    (e: Error) => e instanceof HttpError && /timed out after 0\.3s/.test(e.message),
  );
});

test("una conexion cortada da un error con el host", async () => {
  await assert.rejects(
    () => ejecutar(peticionDe(`GET ${base}/corta`)),
    (e: Error) => e instanceof HttpError && /Could not reach 127\.0\.0\.1/.test(e.message),
  );
});

test("una URL invalida se explica antes de salir a la red", async () => {
  await assert.rejects(
    () => ejecutar(peticionDe("GET {{sinresolver}}/x")),
    (e: Error) => e instanceof HttpError && /@name = value/.test(e.message),
  );
});

test("un host que no existe no cuelga el proceso", async () => {
  await assert.rejects(
    () => ejecutar(peticionDe("GET http://no.existe.invalido.test/x"), { timeoutMs: 4000 }),
    (e: Error) => e instanceof HttpError,
  );
});

// --- formateo ---------------------------------------------------------------

test("formatear embellece el JSON y anyade tiempo y tamanyo", async () => {
  const p = peticionDe(`GET ${base}/hola`);
  const salida = formatear(await ejecutar(p), p);
  assert.match(salida, /^GET http:\/\/127\.0\.0\.1/);
  assert.match(salida, /HTTP 200 OK/);
  assert.match(salida, /\n {2}"ruta": "\/hola"/, "deberia venir indentado");
  assert.match(salida, /# \d+ ms · \d+ B/);
});

test("un JSON roto se muestra tal cual, no se oculta", async () => {
  const p = peticionDe(`GET ${base}/jsonroto`);
  const salida = formatear(await ejecutar(p), p);
  assert.match(salida, /\{esto no es json/);
});

test("el texto plano se respeta", async () => {
  const p = peticionDe(`GET ${base}/texto`);
  const salida = formatear(await ejecutar(p), p);
  assert.match(salida, /hola\nmundo/);
});

test("las cabeceras de respuesta sensibles se ocultan", async () => {
  const p = peticionDe(`GET ${base}/cookie`);
  const respuesta = await ejecutar(p);
  const salida = formatear(respuesta, p);

  assert.doesNotMatch(salida, /SECRETO-DE-SESION/, "set-cookie no puede verse");
  assert.doesNotMatch(salida, /CLAVE-SECRETA/, "x-api-key no puede verse");
  assert.match(salida, /set-cookie: \*\*\*/);
  assert.match(salida, /x-normal: visible/, "lo que no es secreto sigue viendose");

  // El objeto de la respuesta conserva el valor: la redaccion es de
  // presentacion, para que el encadenamiento siga funcionando.
  assert.match(respuesta.cabeceras["set-cookie"], /SECRETO-DE-SESION/);
});

test("con la redaccion desactivada se ve todo", async () => {
  const p = peticionDe(`GET ${base}/cookie`);
  const salida = formatear(await ejecutar(p), p, false);
  assert.match(salida, /SECRETO-DE-SESION/);
});

test("la URL con secretos se oculta en la primera linea", async () => {
  const p = peticionDe(`GET ${base}/hola?access_token=NO-MOSTRAR&page=2`);
  const salida = formatear(await ejecutar(p), p);
  const [primera] = salida.split(String.fromCharCode(10));
  assert.doesNotMatch(primera, /NO-MOSTRAR/);
  assert.match(primera, /access_token=\*\*\*/);
  assert.match(primera, /page=2/, "lo que no es secreto sigue viendose");
});

test("un secreto devuelto por el servidor en el cuerpo tambien se enmascara", async () => {
  // El caso que destapo el test anterior: redactar la URL no basta, porque el
  // servidor puede devolverte lo que le mandaste.
  const p = peticionDe(`GET ${base}/hola?access_token=VALOR-SECRETO-LARGO`);
  const salida = formatear(await ejecutar(p), p);
  assert.match(salida, /VALOR-SECRETO-LARGO/, "sin la lista de secretos, sigue ahi");

  const protegida = redactarValores(salida, ["VALOR-SECRETO-LARGO"]);
  assert.doesNotMatch(protegida, /VALOR-SECRETO-LARGO/);
  assert.match(protegida, /\*\*\*/);
});

test("no enmascara valores cortos, que destrozarian la salida", () => {
  const texto = 'usuario dev en modo dev con id 1';
  assert.equal(redactarValores(texto, ["dev", "1"]), texto);
});

test("enmascara todas las apariciones de un secreto", () => {
  const salida = redactarValores("a=SECRETO-LARGO b=SECRETO-LARGO", ["SECRETO-LARGO"]);
  assert.equal(salida, "a=*** b=***");
});
