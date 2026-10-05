import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { StationHealthSnapshot } from "./routing-client.js";
import "./prep-stations-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});
const health: StationHealthSnapshot = {
  capturedAt: "2026-10-05T12:00:00.000Z",
  outputsDown: { printersDown: [], screensDark: [] },
  stations: [
    {
      id: "bar",
      name: "Bar",
      hasScreen: true,
      waiting: 1,
      preparing: 1,
      ready: 1,
      late: { warm: 1, overdue: 1, forgotten: 0 },
      oldestMinutes: 12,
      items: [
        {
          id: "soup",
          name: "SOPA COCINA",
          orderId: "o1",
          orderNumber: 42,
          label: null,
          tableNames: ["Terrace 3"],
          state: "queued",
          queuedAt: "2026-10-05T11:48:00Z",
          remainingQuantity: "1.500",
          band: "overdue",
        },
        {
          id: "fish",
          name: "FISH KITCHEN",
          orderId: "o2",
          orderNumber: 43,
          label: "Round two",
          tableNames: [],
          state: "preparing",
          queuedAt: "2026-10-05T11:53:00Z",
          remainingQuantity: "2.000",
          band: "warm",
        },
        {
          id: "tea",
          name: "TEA KITCHEN",
          orderId: "o3",
          orderNumber: 44,
          label: null,
          tableNames: [],
          state: "ready",
          queuedAt: "2026-10-05T11:59:00Z",
          remainingQuantity: "1.000",
          band: "fresh",
        },
      ],
    },
  ],
};
type HealthTable = HTMLElement & { snapshot: StationHealthSnapshot; today: Record<string, string> };
async function mount(snapshot = health, theme: "light" | "dark" = "light") {
  const host = document.createElement("div");
  applyTokens(host);
  host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  host.style.color = "var(--wt-color-text)";
  hosts.push(host);
  document.body.append(host);
  const el = document.createElement("prep-station-health-table") as HealthTable;
  el.snapshot = snapshot;
  el.today = { bar: "Always open" };
  host.append(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}
function table(el: HTMLElement) {
  return el.shadowRoot?.querySelector("wt-data-table")?.shadowRoot;
}
async function click(el: HTMLElement, selector: string) {
  const button = table(el)?.querySelector<HTMLButtonElement>(selector);
  expect(button).toBeTruthy();
  button!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function details(el: HTMLElement) {
  return (
    el.shadowRoot?.querySelector('[data-test="health-details"]')?.shadowRoot?.textContent ?? ""
  );
}
it("renders dish-row counts and seven columns; the late cell separates bands", async () => {
  const el = await mount();
  expect(
    [...(table(el)?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent?.trim()),
  ).toEqual(["Name", "Today", "Waiting", "Being made", "Ready", "Late", "Oldest"]);
  expect(table(el)?.querySelector('[data-test="waiting-bar"]')?.textContent?.trim()).toBe("1");
  expect(table(el)?.querySelector('[data-test="warm-bar"]')?.textContent?.trim()).toBe("1");
  expect(table(el)?.querySelector('[data-test="overdue-bar"]')?.textContent?.trim()).toBe("1");
  expect(table(el)?.querySelector('[data-test="forgotten-bar"]')?.textContent?.trim()).toBe("0");
  expect(table(el)?.querySelector('[data-test="oldest-bar"]')?.textContent?.trim()).toBe("12 min");
});
it("opens station/state and band drilldowns with kitchen wording and remaining quantities", async () => {
  const el = await mount();
  await click(el, '[data-test="preparing-bar"]');
  expect(details(el)).toContain("FISH KITCHEN");
  expect(details(el)).toContain("2.000");
  expect(details(el)).toContain("Round two");
  expect(details(el)).not.toContain("SOPA COCINA");
  await click(el, '[data-test="overdue-bar"]');
  expect(details(el)).toContain("SOPA COCINA");
  expect(details(el)).toContain("Terrace 3");
  expect(details(el)).toContain("1.500");
  expect(details(el)).not.toContain("FISH KITCHEN");
  await click(el, '[data-test="oldest-bar"]');
  expect(details(el)!.indexOf("SOPA COCINA")).toBeLessThan(details(el)!.indexOf("FISH KITCHEN"));
  expect(details(el)!.indexOf("FISH KITCHEN")).toBeLessThan(details(el)!.indexOf("TEA KITCHEN"));
});
it("without a screen all states stay in Waiting; no-screen cells open no state action", async () => {
  const el = await mount({
    ...health,
    stations: [
      { ...health.stations[0]!, hasScreen: false, waiting: 3, preparing: null, ready: null },
    ],
  });
  expect(table(el)?.querySelector('[data-test="preparing-bar"]') ?? null).toBeNull();
  expect(table(el)?.textContent ?? "").toContain("No screen");
  await click(el, '[data-test="waiting-bar"]');
  expect(details(el)).toContain("SOPA COCINA");
  expect(details(el)).toContain("FISH KITCHEN");
  expect(details(el)).toContain("TEA KITCHEN");
});
it("an open band drilldown follows new snapshots without changing the selected band", async () => {
  const el = await mount();
  await click(el, '[data-test="overdue-bar"]');
  el.snapshot = {
    ...health,
    stations: [
      {
        ...health.stations[0]!,
        late: { warm: 0, overdue: 2, forgotten: 0 },
        items: health.stations[0]!.items.map((item) =>
          item.id === "fish" ? { ...item, band: "overdue" } : item,
        ),
      },
    ],
  };
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(details(el)).toContain("FISH KITCHEN");
  expect(details(el)).not.toContain("TEA KITCHEN");
});
it("Spanish labels identify the same populations", async () => {
  setLocale("es");
  const el = await mount();
  expect(table(el)?.textContent ?? "").toContain("En preparación");
  await click(el, '[data-test="ready-bar"]');
  expect(details(el)).toContain("TEA KITCHEN");
  expect(details(el)).not.toContain("FISH KITCHEN");
});
it("keeps disabled stations at the bottom with historical work and reports printer and screen problems separately", async () => {
  const el = await mount({
    ...health,
    outputsDown: {
      printersDown: [
        {
          stationId: "bar",
          stationName: "Bar",
          printerId: "p1",
          printerName: "Bar printer",
          since: "2026-10-05T11:40:00Z",
        },
      ],
      screensDark: [{ stationId: "bar", stationName: "Bar", lastSeenAt: null }],
    },
    stations: [{ ...health.stations[0]!, id: "disabled", name: "Old kitchen" }, ...health.stations],
  });
  Object.assign(el, {
    stations: [
      { id: "disabled", name: "Old kitchen", active: false, isDefault: false, displayOrder: 0 },
      { id: "bar", name: "Bar", active: true, isDefault: true, displayOrder: 1 },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    [...table(el)!.querySelectorAll("tbody tr")].map((row) => row.textContent?.trim()),
  ).toEqual([expect.stringContaining("Bar"), expect.stringContaining("Old kitchen")]);
  expect(table(el)?.textContent).toContain("Default");
  expect(table(el)?.textContent).toContain("Disabled");
  expect(table(el)?.textContent).toContain("Printer Bar printer");
  expect(table(el)?.textContent).toContain("no kitchen screen here has ever checked in");
  expect(table(el)?.querySelector('[data-test="waiting-disabled"]')?.textContent?.trim()).toBe("1");
});
it("a number is reachable by keyboard and Escape closes the read-only drilldown", async () => {
  const el = await mount();
  const button = table(el)!.querySelector<HTMLButtonElement>('[data-test="waiting-bar"]')!;
  button.focus();
  expect(table(el)?.activeElement).toBe(button);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  expect(modal.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(table(el)?.activeElement?.getAttribute("data-test")).toBe("waiting-bar");
});

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "paints health tokens and keeps the table inside %s %s %ipx",
  async (locale, theme, width) => {
    const frame = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 844);
    try {
      setLocale(locale);
      const el = await mount(health, theme);
      const summary = el.shadowRoot!.querySelector("wt-data-table")!;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(summary.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      const swatch = document.createElement("span");
      el.parentElement!.append(swatch);
      for (const [part, token] of [
        ["warm", "warning"],
        ["overdue", "danger"],
        ["forgotten", "danger"],
      ]) {
        swatch.style.color = `var(--wt-color-${token})`;
        const button = table(el)!.querySelector<HTMLButtonElement>(`[data-test="${part}-bar"]`)!;
        expect(getComputedStyle(button).color).toBe(getComputedStyle(swatch).color);
        expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      await click(el, '[data-test="oldest-bar"]');
    } finally {
      await page.viewport(frame.width, frame.height);
    }
  },
);
it("each station's number opens only that station's dishes, including the second station", async () => {
  const el = await mount({
    ...health,
    stations: [
      ...health.stations,
      {
        ...health.stations[0]!,
        id: "kitchen",
        name: "Kitchen",
        items: [{ ...health.stations[0]!.items[0]!, id: "other", name: "OTHER STATION DISH" }],
      },
    ],
  });
  await click(el, '[data-test="waiting-bar"]');
  expect(details(el)).toContain("SOPA COCINA");
  expect(details(el)).not.toContain("OTHER STATION DISH");
  await click(el, '[data-test="waiting-kitchen"]');
  expect(details(el)).toContain("OTHER STATION DISH");
  expect(details(el)).not.toContain("SOPA COCINA");
});
it("a snapshot not read yet says it is loading instead of claiming there is no work", async () => {
  const el = await mount();
  Object.assign(el, { snapshot: undefined });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(el.shadowRoot?.textContent).toContain("Loading station health");
  expect(table(el)?.textContent ?? "").not.toContain("No unserved dishes");
});
