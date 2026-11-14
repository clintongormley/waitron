import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, type PluginOption } from "vite";
import { devPort, devServerProxy } from "../../scripts/dev-server-proxy.js";
import { viteNpmNotices } from "../../scripts/npm-bundle-notices.mjs";
// By path: Vite bundles a relative import, but hands `@waitron/ui-core/theme` to Node, which
// cannot resolve that package's `.js` specifiers to its `.ts` sources.
import { parseBlock } from "../../packages/ui-core/src/theme/defaults.js";

import { buildManifest } from "./src/manifest.js";

function lightPrimary(): string {
  const colors = readFileSync(
    new URL("../../packages/ui-core/src/tokens/colors.css", import.meta.url),
    "utf8",
  );
  const value = parseBlock(colors, ':where([data-wt-theme-root][data-theme="light"])')[
    "--wt-color-primary"
  ];
  if (value === undefined) throw new Error("colors.css declares no light --wt-color-primary");
  return value;
}

const BRAND_PRIMARY_HEX = lightPrimary();

// Emitted rather than placed in `publicDir`, which is the brand directory shared with the other
// front-ends.
function webManifest(): PluginOption {
  const json = JSON.stringify(buildManifest(BRAND_PRIMARY_HEX), null, 2);
  return {
    name: "waitron-webmanifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: json });
    },
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `  <meta name="theme-color" content="${BRAND_PRIMARY_HEX}" />\n  </head>`,
      );
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
  plugins: [webManifest(), viteNpmNotices()],
  // Favicons and app icons are served from the ONE brand directory in packages/ui, so a redrawn
  // mark cannot go stale. A relative path, not `import.meta.resolve`: `@waitron/ui` has no
  // `exports` map. This line is read as text by `scripts/brand-icons.test.ts`.
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  server: {
    port: devPort("WAITRON_TILL_VITE_PORT", 5190),
    // A silently bumped port would serve the till where nobody points a browser.
    strictPort: true,
    proxy: {
      "/api": devServerProxy(),
      // The guide sheet's frame loads the box's guide pages.
      "/help": devServerProxy(),
      "/legal": devServerProxy(),
      // Product images are served same-origin in production.
      "/media": devServerProxy(),
    },
  },
});
