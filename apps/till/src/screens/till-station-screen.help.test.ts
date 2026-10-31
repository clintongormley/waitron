import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import type { DeviceStationScreen, StationQueueGroup, TillApi } from "../api/client.js";
import { helpBadgeLabel, helpEn, helpEs } from "../i18n/help-strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, resetPage } from "../widgets/test-helpers.js";
import "./till-station-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
const SENT = "2026-08-17T10:00:00.000Z";

function queue(orderId: string, itemId: string, name: string): StationQueueGroup[] {
  return [
    {
      kitchenNote: null,
      orderId,
      orderNumber: 5,
      label: null,
      queuedAt: SENT,
      status: "placed",
      thresholds: THRESHOLDS,
      bumpMode: "line",
      items: [
        {
          allergy: null,
          id: itemId,
          workingOrderLineId: `wol-${itemId}`,
          state: "queued",
          name,
          quantity: "1.000",
          course: null,
          firedAt: SENT,
          queuedAt: SENT,
        },
      ],
    },
  ];
}

const station = (id: string, name: string, groups: StationQueueGroup[]) => ({
  id,
  name,
  available: true as const,
  today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" as const },
  queue: groups,
  notices: [],
  printersDown: [],
});

const twoStations: DeviceStationScreen = {
  stations: [
    station("st-1", "Cocina", queue("wo-1", "ti-1", "Paella")),
    station("st-2", "Barra", queue("wo-2", "ti-2", "Vino")),
  ],
};
const oneStation: DeviceStationScreen = { stations: [twoStations.stations[0]!] };

const DEVICE = "dev-help";
const viewKey = `waitron.stationScreenView.${DEVICE}`;

let locale = currentLocale();
beforeEach(async () => {
  locale = currentLocale();
  setLocale("en");
  localStorage.removeItem(viewKey);
  await page.viewport(1280, 900);
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  localStorage.removeItem(viewKey);
  setLocale(locale);
  await resetPage();
});

async function mount(screen: DeviceStationScreen = twoStations) {
  const api = {
    getDeviceStationScreen: vi.fn().mockResolvedValue(screen),
    deviceAdvance: vi.fn().mockResolvedValue(undefined),
  } as unknown as TillApi;
  const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", {
    api,
    deviceMode: true,
    deviceId: DEVICE,
    initialDeviceStation: screen,
  });
  // The till's shell sets the badge's size; a screen mounted alone takes the dashboard's.
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  await settle(el);
  return el;
}

const shadow = (el: TillStationScreen) => el.shadowRoot!;
const toggle = (el: TillStationScreen) =>
  shadow(el).querySelector<HTMLElement>("[data-merge-toggle]");
/** The screen's own badges, not the ones inside its boards. */
const screenBadges = (el: TillStationScreen) => [
  ...shadow(el).querySelectorAll<WtHelpTooltip>("wt-help-tooltip"),
];
const mergeBadge = (el: TillStationScreen, label: string) =>
  shadow(el).querySelector<WtHelpTooltip>(`wt-help-tooltip[aria-label="${helpBadgeLabel(label)}"]`);
const isOpen = (badge: WtHelpTooltip) =>
  badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");
const rect = (box: Element) => {
  const { left, top, width, height } = box.getBoundingClientRect();
  return { left, top, width, height };
};
const stacked = (el: TillStationScreen) =>
  shadow(el).querySelectorAll("[data-device-station]").length > 0;

async function settle(el: TillStationScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  for (const badge of screenBadges(el)) await badge.updateComplete;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function helpOn(el: TillStationScreen): Promise<void> {
  setHelpMode(true);
  await settle(el);
}

describe("the station screen's Merged / Stacked badge", () => {
  it.each([
    { lang: "en", text: helpEn },
    { lang: "es", text: helpEs },
  ])(
    "with help on, Merged has a badge on a kitchen screen with two stations, and its box says what it does ($lang)",
    async ({ lang, text }) => {
      setLocale(lang);
      const el = await mount();
      await helpOn(el);
      expect(stacked(el)).toBe(true);
      const badge = mergeBadge(el, t("station.view_merged"))!;
      expect(badge).not.toBeNull();
      expect(badge.mode).toBe("help-mode");
      expect(badge.getAttribute("aria-label")).toBe(
        text["help.badge_label"].replace("{part}", t("station.view_merged")),
      );
      expect(badge.textContent).toBe(text["help.kitchen.merge"]);
      expect(toggle(el)!.contains(badge)).toBe(false);
      // Hangs over the toggle's top trailing corner.
      const at = badge.getBoundingClientRect();
      const box = toggle(el)!.getBoundingClientRect();
      expect(at.width).toBeGreaterThan(0);
      expect(at.left).toBeLessThan(box.right);
      expect(at.right).toBeGreaterThan(box.right);
      expect(at.top).toBeLessThan(box.top);
      expect(at.bottom).toBeGreaterThan(box.top);
      await userEvent.click(badge.shadowRoot!.querySelector("button")!);
      expect(isOpen(badge)).toBe(true);
    },
  );

  it("none with one station", async () => {
    const el = await mount(oneStation);
    await helpOn(el);
    expect(toggle(el)).toBeNull();
    expect(screenBadges(el)).toEqual([]);
  });

  it("a tap on the badge does not switch the view", async () => {
    const el = await mount();
    await helpOn(el);
    const badge = mergeBadge(el, t("station.view_merged"))!;
    await userEvent.click(badge.shadowRoot!.querySelector("button")!);
    await settle(el);
    expect(isOpen(badge)).toBe(true);
    expect(stacked(el)).toBe(true);
    expect(toggle(el)!.textContent!.trim()).toBe(t("station.view_merged"));
  });

  it("the toggle still switches with help on, and its badge then names Stacked", async () => {
    const el = await mount();
    await helpOn(el);
    await userEvent.click(toggle(el)!);
    await settle(el);
    expect(stacked(el)).toBe(false);
    expect(toggle(el)!.textContent!.trim()).toBe(t("station.view_stacked"));
    expect(mergeBadge(el, t("station.view_stacked"))).not.toBeNull();
    expect(mergeBadge(el, t("station.view_merged"))).toBeNull();
  });

  it("the toggle is the same size and place with help off and on", async () => {
    const el = await mount();
    const off = rect(toggle(el)!);
    for (const badge of screenBadges(el)) expect(badge.getBoundingClientRect().width).toBe(0);
    await helpOn(el);
    expect(rect(toggle(el)!)).toEqual(off);
  });
});
