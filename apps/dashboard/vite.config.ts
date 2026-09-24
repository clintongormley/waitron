import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { devServerProxy } from "../../scripts/dev-server-proxy.js";

export default defineConfig({
  // Shared brand assets — see apps/till/vite.config.ts.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  base: "/manage/",
  server: {
    port: 5191,
    // A surprise port would no longer match the browser's proxy — see apps/till/vite.config.ts.
    strictPort: true,
    proxy: {
      "/api": devServerProxy(),
      "/management-api": devServerProxy(),
      "/media": devServerProxy(),
    },
  },
});
