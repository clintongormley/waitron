import { fileURLToPath } from "node:url";

import { defineConfig, type PluginOption } from "vite";
import { devServerProxy } from "../../scripts/dev-server-proxy.js";

import { buildManifest } from "./src/manifest.js";

// Emitted rather than placed in `publicDir`, which is the brand directory shared with the other
// front-ends.
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
  // mark cannot go stale. A relative path, not `import.meta.resolve`: `@waitron/ui` has no
  // `exports` map. This line is read as text by `scripts/brand-icons.test.ts`.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  server: {
    port: 5190,
    // A silently bumped port would serve the till where nobody points a browser.
    strictPort: true,
    proxy: {
      "/api": devServerProxy(),
      // Product images are served same-origin in production.
      "/media": devServerProxy(),
    },
  },
});
