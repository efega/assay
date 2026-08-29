/**
 * Encadenamiento de peticiones.
 *
 * Segunda peticion mas votada de REST Client (54 votos, 5,7 anyos). Sin esto
 * los asertos solo sirven para endpoints publicos: cualquier API real exige
 * autenticarse primero, y eso es login -> token -> usar el token.
 *
 * Sintaxis compatible con REST Client:
 *
 *     ### Login
 *     # @name login
 *     POST {{base}}/login
 *
 *     ### Usar el token
 *     GET {{base}}/me
 *     Authorization: Bearer {{login.response.body.$.token}}
 *
 * DECISIONES DE SEGURIDAD, deliberadas:
 *
 *  1. Deteccion de ciclos. A que depende de B que depende de A falla con un
 *     mensaje que nombra el ciclo, en vez de colgarse o agotar la pila.
 *  2. Profundidad maxima. Una cadena no puede disparar mas de MAX_PROFUNDIDAD
 *     peticiones en cascada, para que un fichero mal escrito no genere trafico
 *     sin limite.
 *  3. Los valores resueltos NO se registran nunca. Un token que aparece en el
 *     canal de salida acaba en una captura de pantalla o en un fichero que
 *     alguien commitea. Se registra la referencia (`login.response.body.$.token`),
 *     nunca su valor.
 */

import type { HttpRequest, HttpFile } from "./parser";
import type { HttpResponse } from "./http";
import { AUSENTE, aTexto, comoJson, resolver as resolverRuta } from "./rutas";

export const MAX_PROFUNDIDAD = 5;

export interface RespuestaGuardada {
  estado: number;
  cabeceras: Record<string, string>;
  cuerpo: string;
}

/** Referencia `{{nombre.response.body.$.ruta}}` encontrada en un texto. */
export interface Referencia {
  /** Texto completo, `{{...}}` incluido, para sustituirlo tal cual. */
  bruto: string;
  peticion: string;
  parte: "body" | "headers" | "status";
  ruta?: string;
}

const REFERENCIA =
  /\{\{\s*([A-Za-z_][\w-]*)\s*\.\s*response\s*\.\s*(body|headers|status)((?:\s*\.\s*[^}\s]+)?)\s*\}\}/g;

export class Almacen {
  private readonly datos = new Map<string, RespuestaGuardada>();

  guardar(nombre: string, respuesta: HttpResponse): void {
    this.datos.set(nombre, {
      estado: respuesta.estado,
      cabeceras: respuesta.cabeceras,
      cuerpo: respuesta.cuerpo,
    });
  }

  obtener(nombre: string): RespuestaGuardada | undefined {
    return this.datos.get(nombre);
  }

  tiene(nombre: string): boolean {
    return this.datos.has(nombre);
  }

  /** Se vacia al reabrir o modificar el fichero: no queremos tokens viejos. */
  limpiar(): void {
    this.datos.clear();
  }
}

export function referencias(texto: string): Referencia[] {
  const salida: Referencia[] = [];
  for (const m of texto.matchAll(REFERENCIA)) {
    salida.push({
      bruto: m[0],
      peticion: m[1],
      parte: m[2] as Referencia["parte"],
      ruta: m[3] ? m[3].replace(/^\s*\.\s*/, "") : undefined,
    });
  }
  return salida;
}

/** Todas las referencias de una peticion: URL, cabeceras y cuerpo. */
export function referenciasDe(peticion: HttpRequest): Referencia[] {
  const textos = [
    peticion.url,
    ...Object.keys(peticion.cabeceras),
    ...Object.values(peticion.cabeceras),
    peticion.cuerpo ?? "",
  ];
  const vistas = new Set<string>();
  const salida: Referencia[] = [];
  for (const texto of textos) {
    for (const ref of referencias(texto)) {
      if (!vistas.has(ref.bruto)) {
        vistas.add(ref.bruto);
        salida.push(ref);
      }
    }
  }
  return salida;
}

export class ErrorDeCadena extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeCadena";
  }
}

/** Valor de una referencia. Lanza si la respuesta no esta o la ruta no existe. */
export function valorDe(ref: Referencia, almacen: Almacen): string {
  const guardada = almacen.obtener(ref.peticion);
  if (!guardada) {
    throw new ErrorDeCadena(
      `La peticion "${ref.peticion}" no se ha ejecutado todavia.`,
    );
  }

  if (ref.parte === "status") return String(guardada.estado);

  if (ref.parte === "headers") {
    if (!ref.ruta) {
      throw new ErrorDeCadena(
        `Falta el nombre de la cabecera en ${ref.bruto}.`,
      );
    }
    const valor = guardada.cabeceras[ref.ruta.toLowerCase()];
    if (valor === undefined) {
      throw new ErrorDeCadena(
        `"${ref.peticion}" no devolvio la cabecera "${ref.ruta}".`,
      );
    }
    return valor;
  }

  // body
  if (!ref.ruta || ref.ruta === "*") return guardada.cuerpo;
  const valor = resolverRuta(comoJson(guardada.cuerpo), ref.ruta);
  if (valor === AUSENTE) {
    throw new ErrorDeCadena(
      `La ruta "${ref.ruta}" no existe en la respuesta de "${ref.peticion}".`,
    );
  }
  return aTexto(valor);
}

export function sustituirReferencias(texto: string, almacen: Almacen): string {
  let salida = texto;
  for (const ref of referencias(texto)) {
    salida = salida.split(ref.bruto).join(valorDe(ref, almacen));
  }
  return salida;
}

/** Aplica las referencias ya resueltas a una peticion completa. */
export function aplicar(peticion: HttpRequest, almacen: Almacen): HttpRequest {
  const cabeceras: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(peticion.cabeceras)) {
    cabeceras[sustituirReferencias(clave, almacen)] =
      sustituirReferencias(valor, almacen);
  }
  return {
    ...peticion,
    url: sustituirReferencias(peticion.url, almacen),
    cabeceras,
    cuerpo: peticion.cuerpo ? sustituirReferencias(peticion.cuerpo, almacen) : undefined,
  };
}

export type Ejecutor = (peticion: HttpRequest) => Promise<HttpResponse>;

export interface ResultadoCadena {
  /** Nombres de las dependencias ejecutadas, en orden. Sin valores. */
  ejecutadas: string[];
}

/**
 * Ejecuta las dependencias que falten, en orden, antes de la peticion pedida.
 * No ejecuta la peticion en si: eso lo hace quien llama.
 */
export async function resolverDependencias(
  peticion: HttpRequest,
  fichero: HttpFile,
  almacen: Almacen,
  ejecutar: Ejecutor,
  aplicarVariables: (p: HttpRequest) => HttpRequest,
  camino: string[] = [],
): Promise<ResultadoCadena> {
  if (camino.length > MAX_PROFUNDIDAD) {
    throw new ErrorDeCadena(
      `Cadena demasiado larga (mas de ${MAX_PROFUNDIDAD} peticiones): ` +
      `${camino.join(" -> ")}. Revisa las dependencias del fichero.`,
    );
  }

  const ejecutadas: string[] = [];

  for (const ref of referenciasDe(peticion)) {
    if (almacen.tiene(ref.peticion)) continue;

    if (camino.includes(ref.peticion)) {
      throw new ErrorDeCadena(
        `Dependencia circular: ${[...camino, ref.peticion].join(" -> ")}.`,
      );
    }

    const dependencia = fichero.peticiones.find((p) => p.nombre === ref.peticion);
    if (!dependencia) {
      throw new ErrorDeCadena(
        `No hay ninguna peticion llamada "${ref.peticion}" en este fichero. ` +
        `Ponle nombre con "# @name ${ref.peticion}".`,
      );
    }

    const anidadas = await resolverDependencias(
      dependencia, fichero, almacen, ejecutar, aplicarVariables,
      [...camino, ref.peticion],
    );
    ejecutadas.push(...anidadas.ejecutadas);

    if (!almacen.tiene(ref.peticion)) {
      const lista = aplicar(aplicarVariables(dependencia), almacen);
      const respuesta = await ejecutar(lista);
      almacen.guardar(ref.peticion, respuesta);
      ejecutadas.push(ref.peticion);
    }
  }

  return { ejecutadas };
}
