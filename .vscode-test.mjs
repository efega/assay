import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: ["out/test/integration/**/*.test.js", "out/test/estres/editor.test.js"],
  version: "stable",
  mocha: { ui: "tdd", timeout: 150000 },
});
