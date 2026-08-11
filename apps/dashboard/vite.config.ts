import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5191,
    proxy: {
      "/management-api": "http://127.0.0.1:8080",
      // Product images the catalogue screens render (`<img src="/media/<sha256>.<ext>">`) are served
      // same-origin in production; in dev the app runs on its own port, so proxy `/media` to the API.
      "/media": "http://127.0.0.1:8080",
    },
  },
});
