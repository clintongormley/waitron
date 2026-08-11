import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5190,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      // Product images (`<img src="/media/<sha256>.<ext>">`) are served same-origin in production; in
      // dev the till runs on its own port, so proxy `/media` to the API. Till-side image rendering is
      // a later slice, but the proxy entry is cheap and keeps both apps' dev configs consistent.
      "/media": "http://127.0.0.1:8080",
    },
  },
});
