import { defineConfig } from "@vscode/test-cli";

/**
 * Ejercita la extension EMPAQUETADA E INSTALADA, no el codigo fuente.
 *
 * Los tests normales cargan src/ via extensionDevelopmentPath, asi que no
 * verian un fallo causado por .vscodeignore: algo excluido del paquete
 * funciona en desarrollo y revienta en cuanto alguien lo instala.
 *
 * Aqui el extensionDevelopmentPath es un arnes vacio y Roost se carga desde
 * el perfil donde se instalo el .vsix.
 */
export default defineConfig({
  files: "out/test/instalada/**/*.test.js",
  version: "stable",
  extensionDevelopmentPath: "test/arnes",
  launchArgs: ["--extensions-dir", process.env.ROOST_EXT_DIR ?? ""],
  mocha: { ui: "tdd", timeout: 30000 },
});
