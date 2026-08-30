/**
 * El documento de respuesta.
 *
 * Se sirve como documento virtual de solo lectura con esquema propio, no
 * como fichero sin titulo. La diferencia se nota en el uso: un `openTextDocument`
 * con contenido crea un buffer Untitled-1 que queda sucio, aparece en la lista
 * de sin guardar y pide confirmacion al cerrarlo. Despues de veinte peticiones
 * son veinte buffers que el usuario tiene que ir cerrando a mano.
 *
 * Ademas permite ponerle un titulo util en la pestanya -metodo, ruta, estado y
 * tiempo- en vez de "Untitled-1".
 */

import * as vscode from "vscode";
import type { HttpRequest } from "./parser";
import type { HttpResponse } from "./http";
import { formatear, redactarValores } from "./http";
import { resumir, type ResultadoAserto } from "./asserts";

export const ESQUEMA = "roost-response";

/** Trocito de ruta para la pestanya: `/api/users/42` -> `/users/42`. */
function rutaCorta(url: string, max = 28): string {
  let ruta = url;
  try {
    ruta = new URL(url).pathname || "/";
  } catch {
    /* URL relativa o sin resolver: se usa tal cual */
  }
  return ruta.length <= max ? ruta : `…${ruta.slice(-(max - 1))}`;
}

export class ProveedorDeRespuestas implements vscode.TextDocumentContentProvider {
  private readonly contenidos = new Map<string, string>();
  private readonly cambio = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.cambio.event;
  private secuencia = 0;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contenidos.get(uri.toString()) ?? "";
  }

  /**
   * Publica una respuesta y devuelve su uri. El nombre del fichero es lo que
   * se ve en la pestanya, asi que lleva la informacion que importa de un
   * vistazo: si fallo un aserto, si no el estado y el tiempo.
   */
  publicar(
    peticion: HttpRequest,
    respuesta: HttpResponse,
    resultados: ResultadoAserto[],
    opciones: { redactar: boolean; secretos: readonly string[] },
  ): vscode.Uri {
    const fallan = resultados.filter((r) => !r.ok).length;
    const marca = resultados.length === 0
      ? `${respuesta.estado}`
      : fallan > 0
        ? `${fallan} failed`
        : `${resultados.length} passed`;

    const nombre =
      `${peticion.metodo} ${rutaCorta(peticion.url)} · ${marca} · ${respuesta.ms}ms`
        .replace(/[\\/:*?"<>|]/g, (c) => (c === "/" ? "/" : "-"));

    const uri = vscode.Uri.parse(
      `${ESQUEMA}:${nombre}?n=${++this.secuencia}`,
    );

    const cuerpo = formatear(respuesta, peticion, opciones.redactar);
    const informe = resumir(resultados);
    // El resumen va ARRIBA: en una herramienta de tests, lo primero que se
    // mira es si pasa, no las cabeceras.
    const texto = informe
      ? `# ${informe.split("\n").join("\n# ")}\n\n${cuerpo}`
      : cuerpo;

    this.contenidos.set(
      uri.toString(),
      opciones.redactar ? redactarValores(texto, opciones.secretos) : texto,
    );
    this.cambio.fire(uri);
    return uri;
  }

  /** Se llama al cerrar un documento nuestro: no acumulamos contenido. */
  olvidar(uri: vscode.Uri): void {
    this.contenidos.delete(uri.toString());
  }

  dispose(): void {
    this.contenidos.clear();
    this.cambio.dispose();
  }
}
