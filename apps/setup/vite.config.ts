import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import { devServerProxy } from "../../scripts/dev-server-proxy.js";

export default defineConfig({
  // Shared brand assets — see the till config for the full rationale.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  // Setup mode serves the wizard at the origin ROOT (`mountSpa` with basePath ""), unlike the
  // dashboard's `/manage/` — so `base` stays the default `/`.
  base: "/",
  server: {
    port: 5192,
    // Fail loudly if 5192 is taken rather than bumping to a surprise port whose proxy no longer
    // matches the browser — see the till config for the full rationale (a bump most often means a
    // duplicate `pnpm dev`, which also collides 8080).
    strictPort: true,
    proxy: {
      // Match the server protocol selected from the shared box state; setup mode has a self-signed
      // leaf, while an inactive setup app may also run beside a leaf-less HTTP demo.
      "/setup-api": devServerProxy(),
    },
  },
});
