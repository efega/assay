/**
 * Capa de editor para los entornos: buscar los ficheros, elegir uno, y
 * avisar si los secretos estan a punto de subirse a git.
 *
 * La logica pura vive en `entornos.ts`; aqui solo esta lo que necesita a
 * vscode. Asi lo importante se prueba sin abrir un editor.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import {
  ErrorDeEntorno, FICHERO_PRIVADO, FICHERO_PUBLICO, type Entorno, type Entornos,
  estaIgnorado, nombresDe, parsearEntornos, variablesDe,
} from "./entornos";

const CLAVE_SELECCION = "roost.entorno";
const MAX_NIVELES = 6;

interface Cargados {
  publico: Entornos;
  privado: Entornos;
  /** Carpeta donde se encontraron, para el aviso de .gitignore. */
  carpeta?: vscode.Uri;
}

async function leer(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Busca los ficheros de entorno subiendo desde el .http hasta la raiz. */
export async function cargar(documento: vscode.Uri): Promise<Cargados> {
  const raiz = vscode.workspace.getWorkspaceFolder(documento)?.uri.fsPath;
  let dir = path.dirname(documento.fsPath);

  for (let nivel = 0; nivel < MAX_NIVELES; nivel++) {
    const carpeta = vscode.Uri.file(dir);
    const textoPublico = await leer(vscode.Uri.joinPath(carpeta, FICHERO_PUBLICO));
    const textoPrivado = await leer(vscode.Uri.joinPath(carpeta, FICHERO_PRIVADO));

    if (textoPublico !== undefined || textoPrivado !== undefined) {
      return {
        publico: textoPublico ? parsearEntornos(textoPublico, FICHERO_PUBLICO) : {},
        privado: textoPrivado ? parsearEntornos(textoPrivado, FICHERO_PRIVADO) : {},
        carpeta,
      };
    }

    const padre = path.dirname(dir);
    if (padre === dir || (raiz && !dir.startsWith(raiz))) break;
    dir = padre;
  }
  return { publico: {}, privado: {} };
}

export class GestorDeEntornos {
  private readonly barra: vscode.StatusBarItem;
  private seleccion: string | undefined;
  private avisados = new Set<string>();

  constructor(
    private readonly contexto: vscode.ExtensionContext,
    private readonly salida: vscode.OutputChannel,
  ) {
    this.seleccion = contexto.workspaceState.get<string>(CLAVE_SELECCION);
    this.barra = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 100);
    this.barra.command = "roost.seleccionarEntorno";
    this.barra.tooltip = "Roost: active environment";
    contexto.subscriptions.push(this.barra);
    this.refrescarBarra();
  }

  get nombre(): string | undefined {
    return this.seleccion;
  }

  /** Variables del entorno activo para un documento concreto. */
  async variablesPara(documento: vscode.Uri): Promise<Entorno> {
    try {
      const { publico, privado, carpeta } = await cargar(documento);
      if (carpeta) void this.avisarSiSecretosSinIgnorar(carpeta, privado);
      return variablesDe(publico, privado, this.seleccion);
    } catch (error) {
      if (error instanceof ErrorDeEntorno) {
        this.salida.appendLine(error.message);
        void vscode.window.showErrorMessage(error.message);
        return {};
      }
      throw error;
    }
  }

  async seleccionar(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let cargados: Cargados;
    try {
      cargados = await cargar(editor.document.uri);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(mensaje);
      return;
    }

    const nombres = nombresDe(cargados.publico, cargados.privado);
    if (nombres.length === 0) {
      const crear = "Create http-client.env.json";
      const respuesta = await vscode.window.showInformationMessage(
        `No environments found. Declare them in ${FICHERO_PUBLICO}, next to your .http file.`,
        crear,
      );
      if (respuesta === crear) await this.crearPlantilla(editor.document.uri);
      return;
    }

    const NINGUNO = "$(circle-slash) None";
    const opciones = [
      NINGUNO,
      ...nombres.map((n) => (n === this.seleccion ? `$(check) ${n}` : `$(globe) ${n}`)),
    ];
    const elegido = await vscode.window.showQuickPick(opciones, {
      title: "Roost: active environment",
      placeHolder: "Variables in the .http file still take precedence",
    });
    if (elegido === undefined) return;

    this.seleccion = elegido === NINGUNO
      ? undefined
      : elegido.replace(/^\$\([\w-]+\)\s*/, "");
    await this.contexto.workspaceState.update(CLAVE_SELECCION, this.seleccion);
    this.refrescarBarra();
    this.salida.appendLine(`Environment: ${this.seleccion ?? "none"}`);
  }

  private refrescarBarra(): void {
    this.barra.text = this.seleccion
      ? `$(globe) ${this.seleccion}`
      : "$(globe) no environment";
    this.barra.show();
  }

  private async crearPlantilla(documento: vscode.Uri): Promise<void> {
    const carpeta = vscode.Uri.file(path.dirname(documento.fsPath));
    const destino = vscode.Uri.joinPath(carpeta, FICHERO_PUBLICO);
    const plantilla = {
      dev: { base: "http://localhost:3000" },
      prod: { base: "https://api.example.com" },
    };
    await vscode.workspace.fs.writeFile(
      destino, Buffer.from(JSON.stringify(plantilla, null, 2) + "\n", "utf8"));
    await vscode.window.showTextDocument(destino);
    void vscode.window.showInformationMessage(
      `Put secrets in ${FICHERO_PRIVADO} and add it to .gitignore.`,
    );
  }

  /**
   * Si hay secretos y el .gitignore no los cubre, avisa una vez por carpeta y
   * ofrece arreglarlo. Es barato y evita el peor fallo posible de una
   * herramienta que presume de guardar tus credenciales en local.
   */
  private async avisarSiSecretosSinIgnorar(
    carpeta: vscode.Uri, privado: Entornos,
  ): Promise<void> {
    if (Object.keys(privado).length === 0) return;
    const clave = carpeta.toString();
    if (this.avisados.has(clave)) return;
    this.avisados.add(clave);

    const raiz = vscode.workspace.getWorkspaceFolder(carpeta)?.uri;
    if (!raiz) return;

    const gitignore = vscode.Uri.joinPath(raiz, ".gitignore");
    const texto = await leer(gitignore) ?? "";
    if (estaIgnorado(texto, FICHERO_PRIVADO)) return;

    const anyadir = "Add to .gitignore";
    const respuesta = await vscode.window.showWarningMessage(
      `${FICHERO_PRIVADO} contains secrets and is not in .gitignore.`,
      anyadir, "Not now",
    );
    if (respuesta !== anyadir) return;

    const sufijo = texto.length > 0 && !texto.endsWith("\n") ? "\n" : "";
    await vscode.workspace.fs.writeFile(
      gitignore,
      Buffer.from(`${texto}${sufijo}${FICHERO_PRIVADO}\n`, "utf8"),
    );
    this.salida.appendLine(`${FICHERO_PRIVADO} added to .gitignore`);
  }
}
