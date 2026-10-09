import { page } from "vitest/browser";
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
it("keeps disabled stations at the bottom and marks Default and Disabled", async () => {
  const el = await mount({
    ...health,
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
] as const)("keeps the table inside %s %s %ipx", async (locale, theme, width) => {
  const frame = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 844);
  try {
    setLocale(locale);
    const el = await mount(health, theme);
    const summary = el.shadowRoot!.querySelector("wt-data-table")!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(summary.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  } finally {
    await page.viewport(frame.width, frame.height);
  }
});
