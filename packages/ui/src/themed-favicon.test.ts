import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { applyTokens } from "./tokens/index.js";
import { THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "./theme-choice.js";
import { VENUE_THEME_STORAGE_KEY, applyVenueTheme, startVenueTheme } from "./venue-theme.js";
import { faviconFor, startThemedFavicon } from "./themed-favicon.js";
import faviconSource from "../brand/public/favicon.svg?raw";
import { FIXTURE_ANSWER as GREEN } from "../test/venue-theme-fixture.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const never = vi.fn(() => new Promise<Response>(() => {}));

let root: HTMLElement;
let head: HTMLElement;
let link: HTMLLinkElement;
let stop: () => void = () => {};

/** The colour written into the favicon the link now points at, or null for a plain address. */
function drawnColour(): string | null {
  const prefix = "data:image/svg+xml,";
  if (!link.href.startsWith(prefix)) return null;
  const svg = decodeURIComponent(link.href.slice(prefix.length));
  return /<style>\.m\{fill:([^}]*)\}<\/style>/.exec(svg)?.[1] ?? null;
}

/** `--wt-color-primary` on the theme root, as computed styles spell a colour. */
function primary(): string {
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-primary)";
  root.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

beforeEach(async () => {
  await commands.emulateColorScheme("light");
  root = document.createElement("div");
  applyTokens(root);
  document.body.append(root);
  startThemeChoice(root);
  head = document.createElement("div");
  link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = "/favicon.svg";
  head.append(link);
});

afterEach(async () => {
  stop();
  stop = () => {};
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: never });
  startThemeChoice(document.documentElement);
  await commands.emulateColorScheme(null);
  root.remove();
});

describe("faviconFor", () => {
  it("keeps the favicon's drawing and paints only its cloche, with no dark rule left", () => {
    const svg = faviconFor("rgb(1, 2, 3)");
    expect(svg).toContain("<style>.m{fill:rgb(1, 2, 3)}</style>");
    expect(svg).not.toContain("prefers-color-scheme");
    const after = (text: string) => text.slice(text.indexOf("</style>"));
    expect(after(svg)).toBe(after(faviconSource));
  });
});

describe("startThemedFavicon", () => {
  it("paints the favicon with the theme's primary at once", () => {
    stop = startThemedFavicon(root, head);
    expect(drawnColour()).toBe(primary());
  });

  it("follows the Theme setting", () => {
    stop = startThemedFavicon(root, head);
    const light = drawnColour();
    chooseTheme("dark");
    expect(drawnColour()).toBe(primary());
    expect(drawnColour()).not.toBe(light);
    chooseTheme("light");
    expect(drawnColour()).toBe(light);
  });

  it("follows the device on Follow device", async () => {
    stop = startThemedFavicon(root, head);
    const light = drawnColour();
    await commands.emulateColorScheme("dark");
    await vi.waitFor(() => expect(drawnColour()).not.toBe(light));
    expect(drawnColour()).toBe(primary());
  });

  it("follows a venue's own colours when they arrive", () => {
    startVenueTheme(document.documentElement, { fetchImpl: never });
    stop = startThemedFavicon(root, head);
    const waitron = drawnColour();
    applyVenueTheme(GREEN);
    expect(drawnColour()).toBe(primary());
    expect(drawnColour()).not.toBe(waitron);
  });

  it("writes only a colour the browser parsed into the drawing", () => {
    root.style.setProperty("--wt-color-primary", "url(x) <script>");
    expect(getComputedStyle(root).getPropertyValue("--wt-color-primary")).toContain("<script>");
    stop = startThemedFavicon(root, head);
    expect(link.getAttribute("href")).toBe("/favicon.svg");
    root.style.setProperty("--wt-color-primary", "#010203");
    chooseTheme("dark");
    expect(drawnColour()).toBe("rgb(1, 2, 3)");
  });

  it("leaves the favicon alone while the primary is unset", () => {
    root.style.setProperty("--wt-color-primary", " ");
    stop = startThemedFavicon(root, head);
    expect(link.getAttribute("href")).toBe("/favicon.svg");
  });

  it("does nothing on a page with no SVG favicon", () => {
    link.remove();
    stop = startThemedFavicon(root, head);
    chooseTheme("dark");
    expect(head.children).toHaveLength(0);
  });

  it("stops following once stopped", async () => {
    stop = startThemedFavicon(root, head);
    stop();
    const before = link.href;
    chooseTheme("dark");
    await commands.emulateColorScheme("dark");
    applyVenueTheme(GREEN);
    expect(link.href).toBe(before);
  });

  it("rewrites the address only when the colour changes", () => {
    stop = startThemedFavicon(root, head);
    const set = vi.spyOn(link, "href", "set");
    chooseTheme("light");
    chooseTheme("device");
    expect(set).not.toHaveBeenCalled();
  });
});
