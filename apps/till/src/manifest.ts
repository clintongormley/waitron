// `purpose: "any"` because the mark has no maskable safe zone.
export function buildManifest(themeColor: string) {
  return {
    name: "Waitron Till",
    short_name: "Waitron",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: themeColor,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
