/**
 * Resolucion de rutas sobre JSON: `$.datos.items[0].nombre`.
 *
 * Subconjunto deliberado de JSONPath, sin dependencias y sin evaluacion de
 * codigo. Cubre lo que se necesita para afirmar sobre una respuesta y para
 * encadenar peticiones, que es el 99 % del uso real.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Marca de "la ruta no existe", distinta de un valor nulo legitimo. */
export const AUSENTE = Symbol("ausente");
export type Resultado = Json | typeof AUSENTE;

/** `$.a.b[0]` -> ["a", "b", 0]. Tolera `a.b`, `$['a b']` y `[0]`. */
export function trocear(ruta: string): (string | number)[] {
  const limpia = ruta.trim().replace(/^\$\.?/, "");
  if (!limpia) return [];

  const partes: (string | number)[] = [];
  const patron = /\[\s*(\d+)\s*\]|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|([^.[\]]+)/g;

  let m: RegExpExecArray | null;
  while ((m = patron.exec(limpia)) !== null) {
    if (m[1] !== undefined) partes.push(Number(m[1]));
    else if (m[2] !== undefined) partes.push(m[2]);
    else if (m[3] !== undefined) partes.push(m[3]);
    else if (m[4] !== undefined) partes.push(m[4].trim());
  }
  return partes;
}

export function resolver(valor: Json, ruta: string): Resultado {
  let actual: Resultado = valor;
  // Anotaciones explicitas mas abajo: sin ellas, TS ve `actual` en su propio
  // inicializador a traves del bucle y lo degrada a any.

  for (const parte of trocear(ruta)) {
    if (actual === AUSENTE || actual === null || actual === undefined) return AUSENTE;

    // `.length` funciona sobre listas y cadenas, que es lo que la gente espera.
    if (parte === "length") {
      if (Array.isArray(actual)) { actual = actual.length; continue; }
      if (typeof actual === "string") { actual = actual.length; continue; }
    }

    if (typeof parte === "number") {
      if (!Array.isArray(actual)) return AUSENTE;
      const elemento: Json | undefined = actual[parte];
      actual = elemento === undefined ? AUSENTE : elemento;
      continue;
    }

    if (typeof actual !== "object" || Array.isArray(actual)) return AUSENTE;
    const campo: Json | undefined = (actual as Record<string, Json>)[parte];
    actual = campo === undefined ? AUSENTE : campo;
  }

  return actual;
}

/** Parsea si puede; si no, devuelve el texto tal cual como cadena. */
export function comoJson(texto: string): Json {
  try {
    return JSON.parse(texto) as Json;
  } catch {
    return texto;
  }
}

export function aTexto(valor: Resultado): string {
  if (valor === AUSENTE) return "";
  if (valor === null) return "null";
  if (typeof valor === "string") return valor;
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}
