import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { FloorZone } from "../api/client.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";

const originalLocale = currentLocale();
const originalWidth = innerWidth,
  originalHeight = innerHeight;
const zone = (id: string, over: Partial<FloorZone> = {}): FloorZone => ({
  id,
  name: id,
  displayOrder: 0,
  active: true,
  closed: false,
  closesAt: null,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
  ...over,
});
afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(originalWidth, originalHeight);
});

it("a single table zone has no pills and a zone without a plan stays in list view", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone("Terrace")],
  });
  expect(el.shadowRoot!.querySelector(".tabs")).toBeNull();
  // At this file's phone width the toggle is the zone menu's first item.
  const menu = el.shadowRoot!.querySelector("till-floor-zone-menu")!;
  await menu.updateComplete;
  expect(menu.shadowRoot!.querySelector('[data-menu-item="view"]')?.textContent?.trim()).toBe(
    "Map",
  );
  expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
});

it("starts on the selected table zone, rejects a counter URL, and follows an explicit new start", async () => {
  setLocale("en-GB");
  history.replaceState(null, "", "/tabs/floor/zone/Counter");
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone("Room"), zone("Terrace", { closed: true })],
    ...{ selectedZoneId: "Terrace" },
  });
  const picked = () =>
    el.shadowRoot!.querySelector('[data-zone][variant="primary"]')?.getAttribute("data-zone");
  expect(
    [...el.shadowRoot!.querySelectorAll("[data-zone]")].map((e) => e.getAttribute("data-zone")),
  ).toEqual(["Room", "Terrace"]);
  expect(picked()).toBe("Terrace");
  expect(el.shadowRoot!.querySelector('[data-zone="Terrace"]')!.textContent).toContain("Closed");
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('[data-zone="Room"]')!);
  expect(picked()).toBe("Room");
  Object.assign(el, { selectedZoneId: "Room" });
  await el.updateComplete;
  Object.assign(el, { selectedZoneId: "Terrace" });
  await el.updateComplete;
  expect(picked()).toBe("Terrace");
  el.zones = [zone("Room")];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".tabs")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
});

it("keeps List and the zone menu on the pills' row without clipping at phone width", async () => {
  await page.viewport(390, 844);
  expect(innerWidth).toBe(390);
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [
      zone("A long main dining room", { hasPlan: true }),
      zone("A long outside terrace", { hasPlan: true }),
    ],
    canChangeToday: true,
  });
  const tabs = el.shadowRoot!.querySelector<HTMLElement>(".tabs")!;
  const actions = el.shadowRoot!.querySelector<HTMLElement>(".actions")!;
  const strip = tabs.parentElement!;
  expect(strip).toBe(actions.parentElement);
  const a = actions.getBoundingClientRect(),
    b = tabs.getBoundingClientRect();
  expect(Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2)).toBeLessThan(1);
  expect(a.right).toBeLessThanOrEqual(innerWidth);
  expect(a.left).toBeGreaterThanOrEqual(0);
  expect(tabs.scrollWidth).toBeGreaterThan(tabs.clientWidth);
});
