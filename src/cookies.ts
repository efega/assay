/**
 * Sesion por cookies.
 *
 * Sin esto, cualquier API que autentique con sesion en vez de con token en el
 * cuerpo es inusable: haces login, funciona, y la siguiente peticion de la
 * cadena vuelve 401 sin explicacion. Es el fallo que mas rapido se encuentra
 * quien prueba la extension contra su API de trabajo.
 *
 *     ### Login, responde con Set-Cookie: sesion=...
 *     # @name login
 *     POST {{base}}/auth
 *
 *     ### Esta ya va autenticada, sin escribir nada
 *     GET {{base}}/me
 *
 * DECISIONES, deliberadas:
 *
 *  1. El tarro vive y muere con el documento, igual que las respuestas
 *     guardadas. Una sesion que sobrevive a cerrar el fichero es una sesion
 *     que acaba usandose contra el entorno equivocado.
 *  2. Una cabecera `Cookie:` escrita a mano gana siempre. Lo explicito manda
 *     sobre lo implicito, igual que las variables del fichero ganan al entorno.
 *  3. No se acepta un `Domain` que amplie el alcance. Un servidor no puede
 *     ponerte una cookie para un dominio que no sea el suyo, porque si no
 *     cualquier endpoint de pruebas podria robar la sesion de produccion.
 *  4. Los valores no se registran nunca. Una cookie de sesion es exactamente
 *     igual de sensible que un token.
 *
 * LIMITACION CONOCIDA: las peticiones siguen redirecciones automaticamente, asi
 * que una cookie puesta en un 302 intermedio no se ve. Afecta a los logins de
 * formulario web; las APIs JSON, que son las que interesan aqui, responden 200
 * con Set-Cookie y funcionan.
 */

export interface Cookie {
  nombre: string;
  valor: string;
  /** En minusculas y sin punto inicial. */
  dominio: string;
  ruta: string;
  seguro: boolean;
  /** Epoch en ms. Ausente para cookies de sesion. */
  expira?: number;
  /** Sin atributo Domain: solo vale para ese host exacto. */
  soloHost: boolean;
}

/** Atributos que no llevan valor. */
const BANDERAS = new Set(["secure", "httponly"]);

/**
 * "Default-path" de RFC 6265: el directorio de la peticion. `/a/b` da `/a`,
 * `/a/` da `/a`, y cualquier cosa sin barra da `/`.
 */
function rutaPorDefecto(camino: string): string {
  if (!camino.startsWith("/")) return "/";
  const ultima = camino.lastIndexOf("/");
  if (ultima <= 0) return "/";
  return camino.slice(0, ultima);
}

/** RFC 6265: igual, o sufijo precedido de punto. */
function dominioCasa(host: string, dominio: string): boolean {
  if (host === dominio) return true;
  return host.endsWith("." + dominio);
}

function rutaCasa(camino: string, ruta: string): boolean {
  if (camino === ruta) return true;
  if (!camino.startsWith(ruta)) return false;
  // `/foo` cubre `/foo/bar` pero no `/foobar`.
  return ruta.endsWith("/") || camino[ruta.length] === "/";
}

/**
 * Interpreta una cabecera Set-Cookie. Devuelve null si esta mal formada o si
 * intenta ampliar su alcance a otro dominio.
 */
export function parsearSetCookie(linea: string, url: URL): Cookie | null {
  const partes = linea.split(";");
  const primera = partes.shift();
  if (!primera) return null;

  const igual = primera.indexOf("=");
  if (igual < 1) return null;   // sin nombre no hay cookie
  const nombre = primera.slice(0, igual).trim();
  const valor = primera.slice(igual + 1).trim();
  if (!nombre) return null;

  const host = url.hostname.toLowerCase();
  let dominio = host;
  let soloHost = true;
  let ruta = rutaPorDefecto(url.pathname);
  let seguro = false;
  let expira: number | undefined;
  let maxEdad: number | undefined;

  for (const cruda of partes) {
    const trozo = cruda.trim();
    if (!trozo) continue;
    const i = trozo.indexOf("=");
    const clave = (i < 0 ? trozo : trozo.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? "" : trozo.slice(i + 1).trim();

    if (BANDERAS.has(clave)) {
      if (clave === "secure") seguro = true;
      continue;
    }
    switch (clave) {
      case "domain": {
        const pedido = v.replace(/^\./, "").toLowerCase();
        if (!pedido) break;
        // Solo se acepta si no amplia el alcance: o es el host exacto, o es un
        // sufijo real -con punto, para que "com" no cuele- del host.
        if (pedido === host) break;
        if (pedido.includes(".") && dominioCasa(host, pedido)) {
          dominio = pedido;
          soloHost = false;
        } else {
          return null;   // intento de poner cookie en dominio ajeno
        }
        break;
      }
      case "path":
        if (v.startsWith("/")) ruta = v;
        break;
      case "expires": {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) expira = t;
        break;
      }
      case "max-age": {
        const n = Number(v);
        if (Number.isFinite(n)) maxEdad = n;
        break;
      }
    }
  }

  // Max-Age manda sobre Expires, dice la norma.
  if (maxEdad !== undefined) expira = Date.now() + maxEdad * 1000;

  return { nombre, valor, dominio, ruta, seguro, expira, soloHost };
}

export class Tarro {
  /** Clave: dominio\0ruta\0nombre, la identidad que define RFC 6265. */
  private readonly galletas = new Map<string, Cookie>();

  private static clave(c: Cookie): string {
    return `${c.dominio}\0${c.ruta}\0${c.nombre}`;
  }

  /** Guarda las cabeceras Set-Cookie de una respuesta. */
  guardar(cabeceras: readonly string[], url: URL): void {
    for (const linea of cabeceras) {
      const galleta = parsearSetCookie(linea, url);
      if (!galleta) continue;
      const clave = Tarro.clave(galleta);
      // Expirada o vaciada: el servidor esta cerrando la sesion.
      if (galleta.expira !== undefined && galleta.expira <= Date.now()) {
        this.galletas.delete(clave);
        continue;
      }
      this.galletas.set(clave, galleta);
    }
  }

  /** Cookies aplicables a una URL, ya ordenadas como manda la norma. */
  aplicables(url: URL): Cookie[] {
    const host = url.hostname.toLowerCase();
    const camino = url.pathname || "/";
    const httpsOno = url.protocol === "https:";
    const ahora = Date.now();

    const salida: Cookie[] = [];
    for (const [clave, c] of this.galletas) {
      if (c.expira !== undefined && c.expira <= ahora) {
        this.galletas.delete(clave);
        continue;
      }
      if (c.seguro && !httpsOno) continue;
      if (c.soloHost ? host !== c.dominio : !dominioCasa(host, c.dominio)) continue;
      if (!rutaCasa(camino, c.ruta)) continue;
      salida.push(c);
    }
    // Ruta mas larga primero: es lo que espera un servidor que distingue.
    return salida.sort((a, b) => b.ruta.length - a.ruta.length);
  }

  /** Valor de la cabecera Cookie, o "" si no hay ninguna aplicable. */
  cabeceraPara(url: URL): string {
    return this.aplicables(url).map((c) => `${c.nombre}=${c.valor}`).join("; ");
  }

  /** Los valores, para poder enmascararlos en la salida. */
  valores(): string[] {
    return [...this.galletas.values()].map((c) => c.valor);
  }

  get tamano(): number {
    return this.galletas.size;
  }

  limpiar(): void {
    this.galletas.clear();
  }
}
