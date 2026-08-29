/**
 * Parser del formato .http / .rest.
 *
 * Compatible con la sintaxis de REST Client (humao), que es un estandar de
 * facto con 7,5 millones de instalaciones. Esa compatibilidad es la baza
 * principal del producto: coste de migracion cero, y los ficheros son texto
 * plano versionable en git, que es justo lo que los usuarios de Thunder
 * Client echaron de menos cuando les cerraron sus colecciones.
 *
 * Sin dependencias de vscode a proposito: asi se puede probar sin editor.
 */

import { parseAserto, type Aserto } from "./asserts";

export interface HttpRequest {
  /** Nombre del bloque: del separador `### nombre` o de `# @name nombre`. */
  nombre?: string;
  metodo: string;
  url: string;
  version?: string;
  cabeceras: Record<string, string>;
  cuerpo?: string;
  /** Asertos declarados con `# @assert ...` en el preambulo del bloque. */
  asertos: Aserto[];
  /** Linea 0-indexada donde empieza el bloque, para el CodeLens. */
  linea: number;
  /** Linea 0-indexada de la linea de peticion (METODO URL). */
  lineaPeticion: number;
}

export interface HttpFile {
  /** Variables de fichero declaradas con `@nombre = valor`. */
  variables: Record<string, string>;
  peticiones: HttpRequest[];
}

const SEPARADOR = /^###\s*(.*)$/;
const VARIABLE = /^@([A-Za-z_][\w.-]*)\s*=\s*(.*)$/;
const META_NOMBRE = /^\s*(?:#|\/\/)\s*@name\s+(.+?)\s*$/;
const COMENTARIO = /^\s*(?:#|\/\/)/;
const CABECERA = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s*:\s*(.*)$/;
const METODOS = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD",
  "OPTIONS", "TRACE", "CONNECT",
]);

/** `GET https://x HTTP/1.1` -> partes. Sin metodo explicito asume GET. */
function parseLineaPeticion(linea: string): Pick<HttpRequest, "metodo" | "url" | "version"> | null {
  const t = linea.trim();
  if (!t) return null;

  const partes = t.split(/\s+/);
  const primera = partes[0].toUpperCase();

  if (METODOS.has(primera)) {
    if (partes.length < 2) return null;
    const ultima = partes[partes.length - 1];
    const tieneVersion = /^HTTP\/\d(?:\.\d)?$/i.test(ultima) && partes.length > 2;
    return {
      metodo: primera,
      url: partes.slice(1, tieneVersion ? -1 : undefined).join(" "),
      version: tieneVersion ? ultima : undefined,
    };
  }

  // Sin metodo: REST Client asume GET si parece una URL.
  if (/^(https?:\/\/|\/|\{\{)/.test(t)) {
    return { metodo: "GET", url: t };
  }
  return null;
}

export function parse(texto: string): HttpFile {
  const lineas = texto.split(/\r?\n/);
  const variables: Record<string, string> = {};
  const peticiones: HttpRequest[] = [];

  // Trocea por `###`. El primer bloque puede no llevar separador.
  const bloques: { inicio: number; titulo?: string; lineas: string[] }[] = [];
  let actual: { inicio: number; titulo?: string; lineas: string[] } = { inicio: 0, lineas: [] };

  lineas.forEach((linea, i) => {
    const sep = SEPARADOR.exec(linea);
    if (sep) {
      bloques.push(actual);
      actual = { inicio: i, titulo: sep[1].trim() || undefined, lineas: [] };
    } else {
      actual.lineas.push(linea);
    }
  });
  bloques.push(actual);

  for (const bloque of bloques) {
    let nombre = bloque.titulo;
    const asertos: Aserto[] = [];
    let i = 0;

    // Preambulo: variables, metadatos y comentarios antes de la peticion.
    while (i < bloque.lineas.length) {
      const linea = bloque.lineas[i];
      if (!linea.trim()) { i++; continue; }

      const meta = META_NOMBRE.exec(linea);
      if (meta) { nombre = meta[1]; i++; continue; }

      const aserto = parseAserto(linea);
      if (aserto) { asertos.push(aserto); i++; continue; }

      const variable = VARIABLE.exec(linea.trim());
      if (variable) { variables[variable[1]] = variable[2].trim(); i++; continue; }

      if (COMENTARIO.test(linea)) { i++; continue; }
      break;
    }

    if (i >= bloque.lineas.length) continue;

    const lineaPeticionIdx = i;
    const partes = parseLineaPeticion(bloque.lineas[i]);
    if (!partes) continue;
    i++;

    // Continuacion de URL: lineas siguientes sangradas que empiezan por ? o &
    while (i < bloque.lineas.length && /^\s+[?&]/.test(bloque.lineas[i])) {
      partes.url += bloque.lineas[i].trim();
      i++;
    }

    // Cabeceras hasta linea en blanco.
    const cabeceras: Record<string, string> = {};
    while (i < bloque.lineas.length) {
      const linea = bloque.lineas[i];
      if (!linea.trim()) { i++; break; }
      if (COMENTARIO.test(linea)) {
        // Los asertos son igual de validos antes que despues de la peticion:
        // unos vienen del estilo de REST Client y otros del de IntelliJ.
        const tardio = parseAserto(linea);
        if (tardio) asertos.push(tardio);
        i++;
        continue;
      }
      const cab = CABECERA.exec(linea);
      if (!cab) break;
      cabeceras[cab[1]] = cab[2].trim();
      i++;
    }

    // Cuerpo: el resto, sin comentarios sueltos ni lineas en blanco finales.
    // Los asertos que aparezcan aqui tambien cuentan, y no ensucian el cuerpo.
    for (const linea of bloque.lineas.slice(i)) {
      const tardio = parseAserto(linea);
      if (tardio) asertos.push(tardio);
    }
    const cuerpoLineas = bloque.lineas.slice(i).filter((l) => !COMENTARIO.test(l));
    while (cuerpoLineas.length && !cuerpoLineas[cuerpoLineas.length - 1].trim()) {
      cuerpoLineas.pop();
    }
    const cuerpo = cuerpoLineas.join("\n").trim() || undefined;

    peticiones.push({
      nombre,
      metodo: partes.metodo,
      url: partes.url,
      version: partes.version,
      cabeceras,
      cuerpo,
      asertos,
      linea: bloque.inicio,
      lineaPeticion: bloque.inicio + lineaPeticionIdx + (bloque.titulo !== undefined || bloque.inicio > 0 ? 1 : 0),
    });
  }

  return { variables, peticiones };
}

/**
 * Sustituye `{{variable}}`. Resuelve encadenados hasta `profundidad` niveles,
 * porque una variable puede referirse a otra.
 */
export function sustituir(
  texto: string,
  variables: Record<string, string>,
  profundidad = 5,
): string {
  let salida = texto;
  for (let n = 0; n < profundidad; n++) {
    const previo = salida;
    salida = salida.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (coincidencia, nombre) => {
      const valor = variables[nombre];
      return valor === undefined ? coincidencia : valor;
    });
    if (salida === previo) break;
  }
  return salida;
}

/** Aplica las variables del fichero (y las del entorno) a una peticion. */
export function resolver(
  peticion: HttpRequest,
  variables: Record<string, string>,
): HttpRequest {
  const cabeceras: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(peticion.cabeceras)) {
    cabeceras[sustituir(clave, variables)] = sustituir(valor, variables);
  }
  return {
    ...peticion,
    url: sustituir(peticion.url, variables),
    cabeceras,
    cuerpo: peticion.cuerpo ? sustituir(peticion.cuerpo, variables) : undefined,
  };
}
