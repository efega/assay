/**
 * Los asertos que fallan se marcan en el editor, no solo en el panel lateral.
 *
 * Razon de diseno: cuando algo falla, la mirada del usuario esta en su fichero
 * de peticiones, no en la respuesta. Un subrayado en la linea del aserto que
 * fallo, con el valor obtenido en el mensaje, le dice que pasa sin cambiar de
 * sitio. Ademas aparece en el panel de Problemas, se navega con F8 y sale en
 * el minimapa: mecanica nativa que el usuario ya sabe usar.
 *
 * Se usa Warning y no Error a proposito: un aserto que falla es informacion
 * sobre un servidor, no un error del fichero. Marcarlo en rojo pondria el
 * icono de error del editor en un fichero perfectamente valido.
 */

import * as vscode from "vscode";
import type { HttpRequest } from "./parser";
import type { ResultadoAserto } from "./asserts";

export class Diagnosticos {
  private readonly coleccion: vscode.DiagnosticCollection;

  constructor() {
    this.coleccion = vscode.languages.createDiagnosticCollection("roost");
  }

  /**
   * Sustituye los avisos de las lineas de esta peticion. No se tocan los de
   * otras peticiones del mismo fichero: cada envio solo sabe de lo suyo.
   */
  publicar(
    uri: vscode.Uri,
    documento: vscode.TextDocument | undefined,
    peticion: HttpRequest,
    resultados: ResultadoAserto[],
  ): void {
    const mias = new Set(peticion.asertos.map((a) => a.linea));
    const otras = (this.coleccion.get(uri) ?? [])
      .filter((d) => !mias.has(d.range.start.line));

    const nuevas: vscode.Diagnostic[] = [];
    for (const r of resultados) {
      if (r.ok) continue;
      const linea = r.aserto.linea;
      const texto = documento && linea < documento.lineCount
        ? documento.lineAt(linea).text
        : "";
      const desde = Math.max(texto.indexOf("@assert"), 0);
      const rango = new vscode.Range(
        linea, desde, linea, Math.max(texto.length, desde + 1));

      const d = new vscode.Diagnostic(
        rango,
        r.motivo
          ? `Assertion failed: ${r.aserto.origen} (${r.motivo})`
          : `Assertion failed: ${r.aserto.origen} — got ${r.obtenido}`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.source = "Roost";
      nuevas.push(d);
    }

    this.coleccion.set(uri, [...otras, ...nuevas]);
  }

  /** Al editar el fichero, los avisos dejan de ser fiables. */
  limpiar(uri: vscode.Uri): void {
    this.coleccion.delete(uri);
  }

  dispose(): void {
    this.coleccion.dispose();
  }
}
