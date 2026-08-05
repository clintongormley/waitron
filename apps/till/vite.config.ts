import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5190,
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
});
