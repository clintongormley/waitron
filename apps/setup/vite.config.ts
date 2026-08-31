import { defineConfig } from "vite";

export default defineConfig({
  // Setup mode serves the wizard at the origin ROOT (`mountSpa` with basePath ""), unlike the
  // dashboard's `/manage/` — so `base` stays the default `/`.
  base: "/",
  server: {
    port: 5192,
    // Fail loudly if 5192 is taken rather than bumping to a surprise port whose proxy no longer
    // matches the browser — see the till config for the full rationale (a bump most often means a
    // duplicate `pnpm dev`, which also collides 8080).
    strictPort: true,
    proxy: {
      // The setup box serves its `/setup-api` routes over HTTPS with a SELF-SIGNED certificate
      // (apps/server/scripts/dev-onboard.ts), so the dev proxy target is `https://` and needs
      // `secure: false` to accept that self-signed leaf. till/dashboard proxy plain-HTTP boxes and
      // so use bare string targets; setup needs Vite's proxy OBJECT form for the `secure` flag.
      "/setup-api": { target: "https://127.0.0.1:8080", secure: false },
    },
  },
});
