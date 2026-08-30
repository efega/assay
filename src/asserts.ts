/**
 * Asertos sobre la respuesta.
 *
 * Sintaxis declarativa, en metadatos del propio fichero:
 *
 *     # @assert status 200
 *     # @assert status < 300
 *     # @assert body.$.token exists
 *     # @assert body.$.items.length > 0
 *     # @assert header.content-type contains json
 *     # @assert time < 1000
 *
 * Declarativa a proposito, no un bloque de script: sin sandbox que asegurar,
 * sin dependencias, y el diff en git se lee de un vistazo.
 */

import type { HttpResponse } from "./http";
import { AUSENTE, aTexto, comoJson, resolver, type Resultado } from "./rutas";

export type Operador =
  | "=" | "!=" | "<" | "<=" | ">" | ">="
  | "contains" | "matches" | "exists" | "empty";

export interface Aserto {
  objetivo: string;
  operador: Operador;
  esperado?: string;
  /** Texto original, para el mensaje de error. */
  origen: string;
}

export interface ResultadoAserto {
  aserto: Aserto;
  ok: boolean;
  obtenido: string;
  motivo?: string;
}

const OPERADORES = new Set<string>([
  "=", "==", "!=", "<", "<=", ">", ">=", "contains", "matches", "exists", "empty",
]);

/** `# @assert status < 300` -> Aserto. Devuelve null si la linea no lo es. */
export function parseAserto(linea: string): Aserto | null {
  const m = /^\s*(?:#|\/\/)\s*@assert\s+(.+?)\s*$/.exec(linea);
  if (!m) return null;

  const cuerpo = m[1];
  const trozos = cuerpo.split(/\s+/);
  if (trozos.length === 0) return null;

  const objetivo = trozos[0];

  // `# @assert status 200` -> igualdad implicita
  if (trozos.length === 2 && !OPERADORES.has(trozos[1])) {
    return { objetivo, operador: "=", esperado: trozos[1], origen: cuerpo };
  }
  if (trozos.length < 2) return null;

  const bruto = trozos[1];
  if (!OPERADORES.has(bruto)) {
    // `# @assert body.$.msg hola que tal` -> igualdad con valor con espacios
    return { objetivo, operador: "=", esperado: trozos.slice(1).join(" "), origen: cuerpo };
  }

  const operador = (bruto === "==" ? "=" : bruto) as Operador;
  const esperado = trozos.slice(2).join(" ") || undefined;
  return { objetivo, operador, esperado, origen: cuerpo };
}

function valorDe(objetivo: string, respuesta: HttpResponse): Resultado {
  const bajo = objetivo.toLowerCase();

  if (bajo === "status" || bajo === "estado") return respuesta.estado;
  if (bajo === "time" || bajo === "ms" || bajo === "tiempo") return respuesta.ms;
  if (bajo === "bytes") return respuesta.bytes;

  if (bajo.startsWith("header.") || bajo.startsWith("cabecera.")) {
    const nombre = objetivo.slice(objetivo.indexOf(".") + 1).toLowerCase();
    const valor = respuesta.cabeceras[nombre];
    return valor === undefined ? AUSENTE : valor;
  }

  if (bajo === "body" || bajo === "cuerpo") return respuesta.cuerpo;

  if (bajo.startsWith("body.") || bajo.startsWith("cuerpo.")) {
    const ruta = objetivo.slice(objetivo.indexOf(".") + 1);
    return resolver(comoJson(respuesta.cuerpo), ruta);
  }

  return AUSENTE;
}

function comparaNumeros(a: Resultado, b: string | undefined): [number, number] | null {
  const x = typeof a === "number" ? a : Number(aTexto(a));
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function evaluar(aserto: Aserto, respuesta: HttpResponse): ResultadoAserto {
  const valor = valorDe(aserto.objetivo, respuesta);
  const obtenido = valor === AUSENTE ? "(ausente)" : aTexto(valor);
  const base = { aserto, obtenido };

  switch (aserto.operador) {
    case "exists":
      return { ...base, ok: valor !== AUSENTE };

    case "empty": {
      const vacio =
        valor === AUSENTE || valor === null || valor === "" ||
        (Array.isArray(valor) && valor.length === 0);
      return { ...base, ok: vacio };
    }

    case "=":
      return { ...base, ok: aTexto(valor) === (aserto.esperado ?? "") };

    case "!=":
      return { ...base, ok: aTexto(valor) !== (aserto.esperado ?? "") };

    case "contains":
      return {
        ...base,
        ok: aTexto(valor).toLowerCase().includes((aserto.esperado ?? "").toLowerCase()),
      };

    case "matches": {
      try {
        return { ...base, ok: new RegExp(aserto.esperado ?? "").test(aTexto(valor)) };
      } catch {
        return { ...base, ok: false, motivo: `invalid regular expression: ${aserto.esperado}` };
      }
    }

    case "<": case "<=": case ">": case ">=": {
      const par = comparaNumeros(valor, aserto.esperado);
      if (!par) {
        return { ...base, ok: false, motivo: "expected two numbers" };
      }
      const [x, y] = par;
      const ok =
        aserto.operador === "<" ? x < y :
        aserto.operador === "<=" ? x <= y :
        aserto.operador === ">" ? x > y : x >= y;
      return { ...base, ok };
    }
  }
}

export function evaluarTodos(
  asertos: Aserto[],
  respuesta: HttpResponse,
): ResultadoAserto[] {
  return asertos.map((a) => evaluar(a, respuesta));
}

/** Resumen legible para el panel de salida. */
export function resumir(resultados: ResultadoAserto[]): string {
  if (resultados.length === 0) return "";
  const fallan = resultados.filter((r) => !r.ok);
  const lineas = resultados.map((r) => {
    const marca = r.ok ? "PASS" : "FAIL";
    const detalle = r.ok ? "" : `  -> ${r.obtenido}${r.motivo ? ` (${r.motivo})` : ""}`;
    return `  ${marca}  ${r.aserto.origen}${detalle}`;
  });
  const cabecera = fallan.length === 0
    ? `${resultados.length}/${resultados.length} assertions passed`
    : `${fallan.length} of ${resultados.length} assertions failed`;
  return [cabecera, ...lineas].join("\n");
}
