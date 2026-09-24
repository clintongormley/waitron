import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { devServerProxy } from "../../scripts/dev-server-proxy.js";

export default defineConfig({
  // Shared brand assets — see the till config for the full rationale.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  // Setup mode serves the wizard at the origin root (`mountSpa` with basePath "").
  base: "/",
  server: {
    port: 5192,
    // Fail loudly rather than bump to a surprise port whose proxy no longer matches the browser —
    // see the till config for the full rationale.
    strictPort: true,
    proxy: {
      "/setup-api": devServerProxy(),
    },
  },
});
