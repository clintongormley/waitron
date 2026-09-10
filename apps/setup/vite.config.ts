import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

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
      // The box serves its API over HTTPS with a self-signed certificate in development, so every
      // app's Vite proxy uses `secure: false` to accept that leaf.
      "/setup-api": { target: "https://127.0.0.1:8080", secure: false },
    },
  },
});
