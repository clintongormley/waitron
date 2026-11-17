import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { devCrossAppLinks, devPort, devServerProxy } from "../../scripts/dev-server-proxy.js";
import { viteNpmNotices } from "../../scripts/npm-bundle-notices.mjs";

export default defineConfig(({ command, mode }) => ({
  plugins: [devCrossAppLinks("setup"), viteNpmNotices()],
  ...(mode === "emergency"
    ? {
        build: {
          outDir: "emergency/dist",
          rollupOptions: { input: fileURLToPath(new URL("emergency.html", import.meta.url)) },
        },
      }
    : {}),
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
