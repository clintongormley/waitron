import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteNpmNotices } from "../../scripts/npm-bundle-notices.mjs";

export default defineConfig({
  base: "/_customer-menu/",
  publicDir: fileURLToPath(new URL("../../packages/ui/brand/public", import.meta.url)),
  plugins: [viteNpmNotices()],
});
