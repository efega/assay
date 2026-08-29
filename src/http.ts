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

const SIN_CUERPO = new Set(["GET", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);

export async function ejecutar(
  peticion: HttpRequest,
  opciones: { timeoutMs?: number; señal?: AbortSignal } = {},
): Promise<HttpResponse> {
  const { timeoutMs = 30_000 } = opciones;

  let url: URL;
  try {
    url = new URL(peticion.url);
  } catch {
    throw new HttpError(
      `URL no valida: ${peticion.url}. ` +
      `Si usas variables, comprueba que estan declaradas con @nombre = valor.`,
    );
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
      headers: peticion.cabeceras,
      body: SIN_CUERPO.has(peticion.metodo) ? undefined : peticion.cuerpo,
      signal: control.signal,
      redirect: "follow",
    });

    const cuerpo = await respuesta.text();
    const ms = Date.now() - inicio;

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
      throw new HttpError(`La peticion supero el limite de ${timeoutMs / 1000} s.`, error);
    }
    const causa = error instanceof Error ? error.message : String(error);
    throw new HttpError(`No se pudo conectar con ${url.host}: ${causa}`, error);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Formatea la respuesta como texto, al estilo de un fichero .http. */
export function formatear(respuesta: HttpResponse, peticion: HttpRequest): string {
  const lineas: string[] = [];
  lineas.push(`${peticion.metodo} ${peticion.url}`);
  lineas.push("");
  lineas.push(`HTTP ${respuesta.estado} ${respuesta.textoEstado}`.trim());
  for (const [clave, valor] of Object.entries(respuesta.cabeceras)) {
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
