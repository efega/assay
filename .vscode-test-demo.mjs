import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/demo/**/*.test.js",
  version: "stable",
  launchArgs: [
    "--user-data-dir", process.env.ROOST_DEMO_PERFIL ?? "",
    "--disable-workspace-trust",
  ],
  mocha: { ui: "tdd", timeout: 120000 },
});
