import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { devCrossAppLinks, devPort, devServerProxy } from "../../scripts/dev-server-proxy.js";
import { viteNpmNotices } from "../../scripts/npm-bundle-notices.mjs";

export default defineConfig(({ command }) => ({
  plugins: [devCrossAppLinks("setup"), viteNpmNotices()],
  // Shared brand assets — see the till config for the full rationale.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  base: command === "serve" ? "/setup/" : "./",
  server: {
    port: devPort("WAITRON_SETUP_VITE_PORT", 5192),
    // Fail loudly rather than bump to a surprise port whose proxy no longer matches the browser —
    // see the till config for the full rationale.
    strictPort: true,
    proxy: {
      "/setup-api": devServerProxy(),
      "/setup/trust": devServerProxy(),
      "/setup/connection": devServerProxy(),
      "/ca.crt": devServerProxy(),
      "/help": devServerProxy(),
      "/api/node/handover": devServerProxy(),
      "/legal": devServerProxy(),
    },
  },
}));
