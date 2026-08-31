import { defineConfig } from "vite";

export default defineConfig({
  base: "/manage/",
  server: {
    port: 5191,
    // Fail loudly if 5191 is taken rather than bumping to a surprise port whose proxy no longer
    // matches the browser — see the till config for the full rationale (a bump most often means a
    // duplicate `pnpm dev`, which also collides 8080).
    strictPort: true,
    proxy: {
      "/management-api": "http://127.0.0.1:8080",
      // Product images the catalogue screens render (`<img src="/media/<sha256>.<ext>">`) are served
      // same-origin in production; in dev the app runs on its own port, so proxy `/media` to the API.
      "/media": "http://127.0.0.1:8080",
    },
  },
});
