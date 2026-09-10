import { fileURLToPath } from "node:url";

import { defineConfig, type PluginOption } from "vite";
import { devServerProxy } from "../../scripts/dev-server-proxy.js";

import { buildManifest } from "./src/manifest.js";

// The till's manifest is a build asset, not a `publicDir` file: `publicDir` is the SHARED brand
// directory in packages/ui, so a till-specific manifest cannot live there without leaking into the
// dashboard. Emit it into the bundle for prod (mountSpa serves `.webmanifest` as
// application/manifest+json) and serve the same bytes in dev over Vite's middleware.
function webManifest(): PluginOption {
  const json = JSON.stringify(buildManifest(), null, 2);
  return {
    name: "waitron-webmanifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: json });
    },
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(json);
      });
    },
  };
}

export default defineConfig({
  plugins: [webManifest()],
  // Favicons and app icons are served from the ONE brand directory in packages/ui, so a redrawn
  // mark cannot go stale in two apps. A relative filesystem path deliberately, and not the
  // `import.meta.resolve("@waitron/migrations/…")` shape the copy-migrations scripts use to reach
  // a sibling package's asset: `publicDir` wants a directory, and `@waitron/ui` has no `exports`
  // map to add a seat to — adding one would have to enumerate every
  // `@waitron/ui/src/components/*.js` the apps already deep-import. `scripts/brand-icons.test.ts`
  // reads this line as text and fails if it stops naming that directory.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  server: {
    port: 5190,
    // Fail loudly if 5190 is taken instead of silently bumping to the next free port: a bump would
    // serve the till on a surprise port whose `/api` proxy no longer matches where you point the
    // browser. Something holds 5190 — most often a SECOND `pnpm dev` (or a leftover dev server from
    // another worktree), which ALSO collides the server's 8080 listener; that one hard-fails with
    // EADDRINUSE (boot.ts's `startListening` does not retry or bump), so the whole `pnpm dev` is
    // already broken and failing here too is the honest outcome. (An unrelated process on 5190 with
    // 8080 free is possible; the fix — a deterministic port, no surprise — is right either way.)
    // Matches the server's own no-bump behaviour.
    strictPort: true,
    proxy: {
      "/api": devServerProxy(),
      // Product images (`<img src="/media/<sha256>.<ext>">`) are served same-origin in production; in
      // dev the till runs on its own port, so proxy `/media` to the API. Till-side image rendering is
      // a later slice, but the proxy entry is cheap and keeps both apps' dev configs consistent.
      "/media": devServerProxy(),
    },
  },
});
