import { defineConfig } from "vite";
import { viteNpmNotices } from "../../scripts/npm-bundle-notices.mjs";

export default defineConfig({
  base: "/_customer-menu/",
  plugins: [viteNpmNotices()],
});
