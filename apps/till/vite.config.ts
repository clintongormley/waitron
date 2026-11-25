import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, type PluginOption } from "vite";
import {
  devCrossAppLinks,
  devLoopbackTwin,
  devPort,
  devServerProxy,
} from "../../scripts/dev-server-proxy.js";
import { viteNpmNotices } from "../../scripts/npm-bundle-notices.mjs";
// By path: Vite bundles a relative import, but hands `@waitron/ui-core/theme` to Node, which
// cannot resolve that package's `.js` specifiers to its `.ts` sources.
import { parseBlock, readDefaults } from "../../packages/ui-core/src/theme/defaults.js";

import { buildManifest } from "./src/manifest.js";
import { buildOfflineWorker } from "./src/offline-worker.js";

const colorsCss = readFileSync(
  new URL("../../packages/ui-core/src/tokens/colors.css", import.meta.url),
  "utf8",
);

function lightPrimary(): string {
  const value = parseBlock(colorsCss, ':where([data-wt-theme-root][data-theme="light"])')[
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
      server.middlewares.use("/till/manifest.webmanifest", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(json);
      });
    },
  };
}

function offlinePageStyles(): string {
  const structureCss = readFileSync(
    new URL("../../packages/ui-core/src/tokens/structure.css", import.meta.url),
    "utf8",
  );
  const tokens = readDefaults(colorsCss, structureCss);
  const palette = ["--wt-color-bg", "--wt-color-text", "--wt-color-primary-text"];
  const layout = ["--wt-space-5", "--wt-space-6", "--wt-font-family", "--wt-font-size-xl"];
  const css = (names: string[], values: Readonly<Record<string, string>>) =>
    names.map((name) => `${name}: ${values[name]};`).join("\n");
  return `
:root {
  ${css(palette, tokens.light)}
  ${css(layout, tokens.structure)}
  color-scheme: light dark;
  background: var(--wt-color-bg);
  color: var(--wt-color-text);
  font-family: var(--wt-font-family);
}
@media (prefers-color-scheme: dark) {
  :root { ${css(palette, tokens.dark)} }
}
main {
  max-width: calc(var(--wt-space-6) * 16);
  margin: calc(var(--wt-space-6) * 2) auto;
  padding-inline: var(--wt-space-5);
}
h1 { font-size: var(--wt-font-size-xl); }
a { color: var(--wt-color-primary-text); }
`;
}

function tillOfflineWorker(): PluginOption {
  return {
    name: "waitron-till-offline-worker",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "offline-worker.js",
        source: buildOfflineWorker(offlinePageStyles()),
      });
    },
  };
}

export default defineConfig({
  base: "/till/",
  plugins: [
    devCrossAppLinks("till"),
    devLoopbackTwin(),
    webManifest(),
    tillOfflineWorker(),
    viteNpmNotices(),
  ],
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
