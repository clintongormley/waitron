import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import type { DeviceStationScreen, StationQueueGroup, TillApi } from "../api/client.js";
import { helpBadgeLabel } from "../i18n/help-strings.js";
import { t } from "../i18n/t.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  pageAt,
  resetPage,
} from "../widgets/test-helpers.js";
import "./till-station-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
const SENT = "2026-08-17T10:00:00.000Z";

const queue = (orderId: string, itemId: string, name: string): StationQueueGroup[] => [
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

const DEVICE = "dev-help-a11y";
const viewKey = `waitron.stationScreenView.${DEVICE}`;

beforeEach(() => localStorage.removeItem(viewKey));
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  localStorage.removeItem(viewKey);
  await resetPage();
});

const mergeBadge = (el: TillStationScreen) =>
  el.shadowRoot!.querySelector<WtHelpTooltip>(
    `wt-help-tooltip[aria-label="${helpBadgeLabel(t("station.view_merged"))}"]`,
  );

describe.each(["light", "dark"] as const)(
  "the station screen's Merged / Stacked badge a11y (%s theme)",
  (theme) => {
    async function mount(width: number) {
      await pageAt(width, width === 390 ? 844 : 900);
      setHelpMode(true);
      const api = {
        getDeviceStationScreen: vi.fn().mockResolvedValue(twoStations),
        deviceAdvance: vi.fn().mockResolvedValue(undefined),
      } as unknown as TillApi;
      const mounted = await mountWidget<TillStationScreen>(
        "till-station-screen",
        { api, deviceMode: true, deviceId: DEVICE, initialDeviceStation: twoStations },
        theme,
      );
      mounted.host.style.setProperty("--wt-help-badge-target", "32px");
      mounted.host.style.setProperty("--wt-help-badge-size", "24px");
      await new Promise((resolve) => setTimeout(resolve, 0));
      await mounted.el.updateComplete;
      const badge = mergeBadge(mounted.el);
      expect(badge).not.toBeNull();
      await badge!.updateComplete;
      expect(badge!.getBoundingClientRect().width).toBeGreaterThan(0);
      return { ...mounted, badge: badge! };
    }

    it.each([1280, 390])("help on at %i has no violations", async (width) => {
      const { host } = await mount(width);
      await expectNoA11yViolations(host);
    });

    it.each([1280, 390])(
      "help on with the badge's box open at %i has no violations",
      async (width) => {
        const { host, badge } = await mount(width);
        await userEvent.click(badge.shadowRoot!.querySelector("button")!);
        expect(
          badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open"),
        ).toBe(true);
        await expectNoA11yViolations(host);
      },
    );
  },
);
