/**
 * Ejecucion de peticiones.
 *
 * Todo ocurre en la maquina del usuario: no hay cuenta, no hay nube, no hay
 * telemetria. Es la regla 3 del posicionamiento, y responde al 51 % de las
 * quejas de la extension oficial de Postman ("requires an account to work").
 *
 * Usa el fetch global de Node 18+, asi que no arrastra dependencias.
 */

import type { HttpRequest } from "./parser";
import type { Tarro } from "./cookies";

export interface HttpResponse {
  estado: number;
  textoEstado: string;
  cabeceras: Record<string, string>;
  cuerpo: string;
  /** Milisegundos hasta tener el cuerpo completo. */
  ms: number;
  /** Bytes del cuerpo. */
  bytes: number;
}

export class HttpError extends Error {
  constructor(mensaje: string, readonly causa?: unknown) {
    super(mensaje);
    this.name = "HttpError";
  }
}

/** Nombre de cabecera valido segun RFC 7230. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const SIN_CUERPO = new Set(["GET", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);

export async function ejecutar(
  peticion: HttpRequest,
  opciones: { timeoutMs?: number; señal?: AbortSignal; tarro?: Tarro } = {},
): Promise<HttpResponse> {
  const { timeoutMs = 30_000, tarro } = opciones;

  let url: URL;
  try {
    url = new URL(peticion.url);
  } catch {
    throw new HttpError(
      `Invalid URL: ${peticion.url}. ` +
      `If you are using variables, check they are declared with @name = value.`,
    );
  }

  // Se comprueba aqui para poder decir cual es la cabecera mala. fetch lanza
  // un TypeError generico que no dice cual, y el usuario se queda a ciegas.
  for (const nombre of Object.keys(peticion.cabeceras)) {
    if (!TOKEN.test(nombre)) {
      throw new HttpError(
        `Invalid header name: "${nombre}". Header names can only contain ` +
        `letters, digits and the characters !#$%&'*+-.^_\`|~ (no spaces or ` +
        `accented characters).`,
      );
    }
  }

  // La sesion se anyade sola, pero una cabecera Cookie escrita a mano gana:
  // lo explicito manda sobre lo implicito.
  const cabecerasEnvio = { ...peticion.cabeceras };
  if (tarro) {
    const yaPuesta = Object.keys(cabecerasEnvio)
      .some((n) => n.toLowerCase() === "cookie");
    if (!yaPuesta) {
      const galletas = tarro.cabeceraPara(url);
      if (galletas) cabecerasEnvio["Cookie"] = galletas;
    }
  }

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), timeoutMs);
  if (opciones.señal) {
    opciones.señal.addEventListener("abort", () => control.abort(), { once: true });
  }

  const inicio = Date.now();
  try {
    const respuesta = await fetch(url, {
      method: peticion.metodo,
      headers: cabecerasEnvio,
      body: SIN_CUERPO.has(peticion.metodo) ? undefined : peticion.cuerpo,
      signal: control.signal,
      redirect: "follow",
    });

    const cuerpo = await respuesta.text();
    const ms = Date.now() - inicio;

    // getSetCookie y no forEach: cuando hay varias Set-Cookie, forEach las
    // junta en una sola cadena separada por comas, y como las fechas Expires
    // llevan comas, esa cadena ya no se puede volver a partir sin romperla.
    if (tarro) tarro.guardar(respuesta.headers.getSetCookie(), url);

    const cabeceras: Record<string, string> = {};
    respuesta.headers.forEach((valor, clave) => { cabeceras[clave] = valor; });

    return {
      estado: respuesta.status,
      textoEstado: respuesta.statusText,
      cabeceras,
      cuerpo,
      ms,
      bytes: Buffer.byteLength(cuerpo, "utf8"),
    };
  } catch (error) {
    if (control.signal.aborted) {
      throw new HttpError(`Request timed out after ${timeoutMs / 1000}s.`, error);
    }
    const causa = error instanceof Error ? error.message : String(error);
    throw new HttpError(`Could not reach ${url.host}: ${causa}`, error);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Nombres de parametro cuyo valor no debe verse nunca en un panel ni en un
 * registro. La respuesta se abre como documento y el usuario puede guardarla
 * o capturarla; un token encadenado no puede acabar ahi en claro.
 */
const SENSIBLES =
  /^(.*[-_.])?(token|secret|key|apikey|password|passwd|pwd|auth|authorization|signature|sig|credential|session|cookie|bearer|jwt)([-_.].*)?$/i;

/** Enmascara los valores sensibles de la query. No toca el resto de la URL. */
export function redactarUrl(url: string): string {
  try {
    const u = new URL(url);
    let tocada = false;
    for (const clave of [...u.searchParams.keys()]) {
      if (SENSIBLES.test(clave)) {
        u.searchParams.set(clave, "***");
        tocada = true;
      }
    }
    return tocada ? u.toString() : url;
  } catch {
    return url;   // no es una URL absoluta: se deja como esta
  }
}

/** Enmascara las cabeceras sensibles. */
export function redactarCabeceras(
  cabeceras: Record<string, string>,
): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(cabeceras)) {
    salida[clave] = SENSIBLES.test(clave) ? "***" : valor;
  }
  return salida;
}

/**
 * Enmascara valores secretos concretos alla donde aparezcan, incluido el
 * cuerpo. Hace falta porque un servidor puede devolverte lo que le mandaste:
 * httpbin lo hace, y muchos endpoints de depuracion tambien.
 *
 * Solo enmascara coincidencias exactas de valores que ya sabemos secretos
 * -los del fichero privado de entorno-, nunca por heuristica sobre el cuerpo:
 * adivinar que es un secreto dentro de un JSON corrompe datos legitimos.
 *
 * El minimo de 6 caracteres evita destrozar la salida cuando alguien tiene
 * una variable con valor "1" o "dev".
 */
export function redactarValores(texto: string, secretos: readonly string[]): string {
  let salida = texto;
  for (const secreto of secretos) {
    if (secreto && secreto.length >= 6) {
      salida = salida.split(secreto).join("***");
    }
  }
  return salida;
}

/** Formatea la respuesta como texto, al estilo de un fichero .http. */
export function formatear(
  respuesta: HttpResponse,
  peticion: HttpRequest,
  redactar = true,
): string {
  const lineas: string[] = [];
  lineas.push(`${peticion.metodo} ${redactar ? redactarUrl(peticion.url) : peticion.url}`);
  lineas.push("");
  lineas.push(`HTTP ${respuesta.estado} ${respuesta.textoEstado}`.trim());
  // Las cabeceras de respuesta tambien: set-cookie lleva la sesion.
  const cabeceras = redactar
    ? redactarCabeceras(respuesta.cabeceras)
    : respuesta.cabeceras;
  for (const [clave, valor] of Object.entries(cabeceras)) {
    lineas.push(`${clave}: ${valor}`);
  }
  lineas.push("");
  lineas.push(embellecer(respuesta.cuerpo, respuesta.cabeceras["content-type"] ?? ""));
  lineas.push("");
  lineas.push(`# ${respuesta.ms} ms · ${formatearBytes(respuesta.bytes)}`);
  return lineas.join("\n");
}

function embellecer(cuerpo: string, contentType: string): string {
  if (!cuerpo) return "";
  if (contentType.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(cuerpo), null, 2);
    } catch {
      return cuerpo;   // JSON invalido: mejor enseñarlo tal cual que ocultarlo
    }
  }
  return cuerpo;
}

export function formatearBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
