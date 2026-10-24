import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { applyTokens, startVenueTheme, VENUE_THEME_STORAGE_KEY } from "@waitron/ui";
import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import { stubShellApi } from "./testing/venue-logo-fixture.js";

const never = () => new Promise<Response>(() => {});

const ANSWER: Record<number, typeof FIXTURE_ANSWER> = {
  100: FIXTURE_ANSWER,
  130: {
    hash: "text-130-hash",
    css: themeSheet(deriveTheme({ ...WAITRON_CHOICES, textScale: 130 })),
    logo: null,
  },
};

/** The legal name's computed size at each scale, read from the drawn shell. */
const NAME_SIZE: Record<number, string> = { 100: "14px", 130: "18px" };

/** The section with the most pages a manager with no modules sees. */
const OPEN_GROUP = "configuration";
const OPEN_GROUP_ITEMS = [
  "Devices",
  "Printers",
  "Card payments",
  "Device profiles",
  "Diagnostics",
  "Backups",
  "Cloud services",
];

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** The signed-in shell, its theme the stored answer a start applies. */
async function mountShell(scale: number): Promise<DashboardApp> {
  const answer = ANSWER[scale]!;
  localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
  startVenueTheme(document.documentElement, { fetchImpl: never });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubShellApi(true, "en-GB"),
  });
  await flush(el);
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=account-menu]")).not.toBeNull();
  await expect.poll(() => el.shadowRoot!.querySelector("aside.sidebar .nav-item")).not.toBeNull();
  await flush(el);
  await document.fonts.ready;
  return el;
}

const rect = (node: Element) => node.getBoundingClientRect();

/** Names each box in `boxes` that does not lie wholly inside `outer`. */
function outside(outer: DOMRect, boxes: Record<string, Element>): string[] {
  return Object.entries(boxes)
    .filter(([, node]) => {
      const box = rect(node);
      return (
        box.left < outer.left - 0.5 ||
        box.right > outer.right + 0.5 ||
        box.top < outer.top - 0.5 ||
        box.bottom > outer.bottom + 0.5
      );
    })
    .map(([name, node]) => {
      const box = rect(node);
      return `${name} ${box.left},${box.top},${box.right},${box.bottom}`;
    });
}

let width = 0;
let height = 0;

beforeEach(() => {
  width = window.innerWidth;
  height = window.innerHeight;
  applyTokens(document.documentElement);
  setLocale("en-GB");
});

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(width, height);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, {
    fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  sessionStorage.clear();
  setLocale("es-ES");
});

it.each([
  [1280, 800, 100],
  [1280, 800, 130],
  [390, 844, 100],
  [390, 844, 130],
] as const)(
  "at %i × %i and %i%, the signed-in shell keeps the banner's controls and the open menu group whole",
  async (viewportWidth, viewportHeight, scale) => {
    await page.viewport(viewportWidth, viewportHeight);
    const el = await mountShell(scale);
    const root = el.shadowRoot!;
    const banner = root.querySelector("[data-test=brand-banner]")!;
    const name = root.querySelector("[data-test=venue-name]")!;
    expect(getComputedStyle(name).fontSize, `legal name at ${scale}%`).toBe(NAME_SIZE[scale]);

    const viewport = new DOMRect(0, 0, viewportWidth, viewportHeight);
    const parts = { "account menu": root.querySelector("[data-test=account-menu]")!, name };
    expect(outside(rect(banner), parts)).toEqual([]);
    expect(outside(viewport, parts)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewportWidth);

    if (viewportWidth < 768) {
      root.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
      await el.updateComplete;
    }
    const sidebar = root.querySelector("aside.sidebar")!;
    await expect.poll(() => rect(sidebar).left).toBeGreaterThanOrEqual(0);
    root.querySelector<HTMLElement>(`[data-test=nav-group-${OPEN_GROUP}]`)!.click();
    await el.updateComplete;
    const items = [...root.querySelectorAll(`#nav-group-panel-${OPEN_GROUP} .nav-item`)];
    expect(items.map((item) => item.textContent!.trim())).toEqual(OPEN_GROUP_ITEMS);
    expect(
      items
        .filter((item) => item.scrollWidth > item.clientWidth + 1)
        .map((item) => `${item.textContent!.trim()} ${item.scrollWidth}/${item.clientWidth}`),
    ).toEqual([]);
    expect(sidebar.scrollWidth).toBeLessThanOrEqual(sidebar.clientWidth);
  },
);
