import faviconSource from "../brand/public/favicon.svg?raw";
import { subscribeThemeChoice } from "./theme-choice.js";
import { subscribeVenueTheme } from "./venue-theme.js";

const STYLE = /<style>[\s\S]*?<\/style>/;

/** `--wt-color-primary` as `root` resolves it, through the browser's colour parser, so only a
 * colour the browser accepts reaches the drawing; an empty value gives "". */
function primaryOf(root: HTMLElement): string {
  const value = getComputedStyle(root).getPropertyValue("--wt-color-primary").trim();
  if (value === "") return "";
  const probe = document.createElement("span");
  probe.style.color = value;
  if (probe.style.color === "") return "";
  root.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/** The SVG favicon's drawing with its cloche in `colour`. */
export function faviconFor(colour: string): string {
  return faviconSource.replace(STYLE, `<style>.m{fill:${colour}}</style>`);
}

/**
 * Keeps the page's SVG favicon (`link[rel=icon][type="image/svg+xml"]`) painted with the
 * `--wt-color-primary` that `root` resolves: the Theme setting, the device's light or dark
 * preference and a venue's own colours all reach it. A browser reads a favicon as a separate image,
 * which cannot see the page's tokens, so the drawing is rebuilt with the colour written in. The
 * `.ico` and the PNG icons stay the fixed blue. Returns a stop function.
 */
export function startThemedFavicon(
  root: HTMLElement = document.documentElement,
  head: HTMLElement = document.head,
): () => void {
  const link = head.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (link === null) return () => {};
  let shown = "";
  const repaint = (): void => {
    const colour = primaryOf(root);
    if (colour === "" || colour === shown) return;
    shown = colour;
    link.href = `data:image/svg+xml,${encodeURIComponent(faviconFor(colour))}`;
  };
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", repaint);
  const stopChoice = subscribeThemeChoice(repaint);
  const stopVenue = subscribeVenueTheme(repaint);
  repaint();
  return () => {
    dark.removeEventListener("change", repaint);
    stopChoice();
    stopVenue();
  };
}
