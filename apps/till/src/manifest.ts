// The till's web-app manifest. `start_url`/`scope` are "/" because the box serves the till
// same-origin at the root; the icons resolve to the shared brand PNGs served from `publicDir`.
// `theme_color` mirrors the brand primary token (`--wt-color-primary`, packages/ui/src/tokens/colors.css)
// so the OS chrome matches the app; `purpose: "any"` because the mark has no maskable safe zone.
export function buildManifest() {
  return {
    name: "Waitron Till",
    short_name: "Waitron",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f6feb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
