/**
 * Entornos: alternar entre desarrollo, staging y produccion.
 *
 * Formato `http-client.env.json`, el mismo que usan REST Client e IntelliJ,
 * asi que un fichero existente funciona sin tocarlo:
 *
 *     {
 *       "dev":  { "base": "https://api.dev.example.com" },
 *       "prod": { "base": "https://api.example.com" }
 *     }
 *
 * Los secretos van aparte, en `http-client.private.env.json`, que se ignora
 * en git. Esa separacion es la regla 3 del posicionamiento hecha fichero: las
 * credenciales no viven en la herramienta ni en ninguna nube, viven en un
 * fichero local que no se sube.
 */

export type Entorno = Record<string, string>;
export type Entornos = Record<string, Entorno>;

export const FICHERO_PUBLICO = "http-client.env.json";
export const FICHERO_PRIVADO = "http-client.private.env.json";

export class ErrorDeEntorno extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeEntorno";
  }
}

/**
 * Parsea un fichero de entornos. Solo admite valores escalares: un objeto
 * anidado casi siempre es un error de quien lo escribe, y fallar aqui con un
 * mensaje claro es mejor que sustituir "[object Object]" en una URL.
 */
export function parsearEntornos(texto: string, procedencia: string): Entornos {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch (error) {
    const causa = error instanceof Error ? error.message : String(error);
    throw new ErrorDeEntorno(`${procedencia} no es JSON valido: ${causa}`);
  }

  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) {
    throw new ErrorDeEntorno(
      `${procedencia} deberia ser un objeto de entornos, como ` +
      `{ "dev": { "base": "..." } }.`,
    );
  }

  const salida: Entornos = {};
  for (const [nombre, valores] of Object.entries(bruto as Record<string, unknown>)) {
    if (valores === null || typeof valores !== "object" || Array.isArray(valores)) {
      throw new ErrorDeEntorno(
        `El entorno "${nombre}" de ${procedencia} deberia ser un objeto de ` +
        `variables.`,
      );
    }
    const entorno: Entorno = {};
    for (const [clave, valor] of Object.entries(valores as Record<string, unknown>)) {
      if (valor === null || typeof valor === "object") {
        throw new ErrorDeEntorno(
          `La variable "${clave}" del entorno "${nombre}" (${procedencia}) ` +
          `deberia ser un texto o un numero, no un objeto.`,
        );
      }
      entorno[clave] = String(valor);
    }
    salida[nombre] = entorno;
  }
  return salida;
}

/** Nombres de entorno disponibles, de ambos ficheros, sin repetir. */
export function nombresDe(publico: Entornos, privado: Entornos): string[] {
  return [...new Set([...Object.keys(publico), ...Object.keys(privado)])].sort();
}

/**
 * Variables efectivas de un entorno. El fichero privado pisa al publico:
 * es donde vive el token de verdad frente al de ejemplo.
 */
export function variablesDe(
  publico: Entornos,
  privado: Entornos,
  nombre: string | undefined,
): Entorno {
  if (!nombre) return {};
  return { ...(publico[nombre] ?? {}), ...(privado[nombre] ?? {}) };
}

/**
 * Combina entorno y variables del propio fichero. Las del fichero ganan,
 * que es como se comporta REST Client; asi un `.http` existente sigue
 * funcionando igual al seleccionar un entorno.
 */
export function combinar(
  delEntorno: Entorno,
  delFichero: Record<string, string>,
): Record<string, string> {
  return { ...delEntorno, ...delFichero };
}

/**
 * Comprueba si un .gitignore cubre el fichero de secretos.
 *
 * Deliberadamente conservador: ante la duda dice que NO esta cubierto, porque
 * el fallo caro es callarse cuando alguien esta a punto de commitear un token.
 */
export function estaIgnorado(gitignore: string, fichero: string): boolean {
  for (const cruda of gitignore.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith("#") || linea.startsWith("!")) continue;

    const patron = linea.replace(/^\/+/, "").replace(/\/+$/, "");
    if (patron === fichero) return true;

    // Comodines simples: *.json, http-client.*.json
    if (patron.includes("*")) {
      const regex = new RegExp(
        `^${patron.split("*").map(escapar).join("[^/]*")}$`,
      );
      if (regex.test(fichero)) return true;
    }
  }
  return false;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
