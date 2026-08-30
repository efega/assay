/**
 * Empaqueta, instala en un VS Code limpio y ejercita la extension instalada.
 *
 * Es la unica prueba que ve lo mismo que vera un usuario: los demas tests
 * cargan `src/` por extensionDevelopmentPath, asi que no detectarian que
 * .vscodeignore excluyo un fichero necesario.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const perfil = mkdtempSync(join(tmpdir(), "roost-perfil-"));
const extDir = join(perfil, "ext");
const vsix = join(perfil, "roost.vsix");
const code = join(raiz, ".vscode-test", "vscode-win32-x64-archive-1.135.0", "bin", "code.cmd");
const node = join(raiz, ".node", "node-v22.14.0-win-x64", "node.exe");

const corre = (cmd, args, extra = {}) =>
  execFileSync(cmd, args, { cwd: raiz, stdio: "inherit", shell: true, ...extra });

const ruido = /^\[(AgentHost|ChatModelSelection|AccountPolicyGate|main)\]|DeprecationWarning|Unknown channel|ProviderCatalogUnavailable|^\s+(at|code:|message:|'\s)/;

try {
  console.log("\n1/4  Compilando");
  corre(node, ["node_modules/typescript/lib/tsc.js", "-p", "."]);
  const compilado = join(raiz, "out", "test", "instalada", "instalada.test.js");
  if (!existsSync(compilado)) {
    throw new Error(`No se genero ${compilado}. Revisa errores de tipos.`);
  }

  console.log("\n2/4  Empaquetando");
  corre("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies", "--out", vsix]);

  console.log("\n3/4  Instalando en un perfil limpio");
  corre(code, ["--user-data-dir", join(perfil, "datos"), "--extensions-dir", extDir,
               "--install-extension", vsix]);

  console.log("\n4/4  Ejercitando la extension instalada");
  // Se captura la salida para poder exigir que hayan corrido tests: sin esto,
  // vscode-test sale con codigo 0 aunque no encuentre ninguno, y un verde
  // falso es peor que un fallo.
  let salida = "";
  try {
    salida = execFileSync("npx", ["vscode-test", "--config", ".vscode-test-instalada.mjs"], {
      cwd: raiz, shell: true, encoding: "utf8",
      env: { ...process.env, ROOST_EXT_DIR: extDir },
    });
  } catch (error) {
    salida = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  for (const linea of salida.split("\n")) {
    if (linea.trim() && !ruido.test(linea)) console.log(linea);
  }

  const pasan = Number(/(\d+) passing/.exec(salida)?.[1] ?? 0);
  const fallan = Number(/(\d+) failing/.exec(salida)?.[1] ?? 0);

  if (pasan === 0) {
    throw new Error(
      "No se ejecuto ningun test contra la extension instalada. " +
      "Comprueba que .vscode-test-instalada.mjs encuentra out/test/instalada/.",
    );
  }
  if (fallan > 0) {
    throw new Error(`${fallan} tests fallan sobre la extension instalada.`);
  }

  console.log(`\nOK: ${pasan} tests pasan sobre exactamente lo que se publica.`);
} finally {
  rmSync(perfil, { recursive: true, force: true });
}
