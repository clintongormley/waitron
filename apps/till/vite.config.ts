import { defineConfig } from "vite";

export default defineConfig({
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
      "/api": "http://127.0.0.1:8080",
      // Product images (`<img src="/media/<sha256>.<ext>">`) are served same-origin in production; in
      // dev the till runs on its own port, so proxy `/media` to the API. Till-side image rendering is
      // a later slice, but the proxy entry is cheap and keeps both apps' dev configs consistent.
      "/media": "http://127.0.0.1:8080",
    },
  },
});
