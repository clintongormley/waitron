// `theme_color` mirrors `--wt-color-primary` (packages/ui-core/src/tokens/colors.css). `purpose: "any"`
// because the mark has no maskable safe zone.
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
