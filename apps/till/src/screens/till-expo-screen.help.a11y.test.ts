import { afterEach, describe, expect, it, vi } from "vitest";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import type { ExpoItem, ExpoOrder, TillApi, WatcherOrder } from "../api/client.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  pageAt,
  resetPage,
} from "../widgets/test-helpers.js";
import "./till-expo-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
const FIRED = "2026-08-17T10:00:00.000Z";

const item = (id: string, name: string): ExpoItem => ({
  allergy: null,
  id,
  name,
  qty: "1.000",
  stationName: "Cocina",
  state: "preparing",
  firedAt: FIRED,
  queuedAt: FIRED,
  thresholds: THRESHOLDS,
  band: "fresh",
});

const orders: ExpoOrder[] = [5, 6].map((orderNumber) => ({
  kitchenNote: null,
  orderId: `wo-${orderNumber}`,
  orderNumber,

  openedMinutes: 3,
  worstBand: "fresh",
  courses: [
    {
      courseId: `co-${orderNumber}`,
      courseName: "Entrantes",
      displayOrder: 0,
      fired: true,
      items: [item(`ti-${orderNumber}`, "Croquetas")],
    },
  ],
}));

const asPassOrder = (order: ExpoOrder): WatcherOrder => ({
  ...order,
  courses: order.courses.map((course) => ({ ...course, allReady: false })),
  groups: [],
});

afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  await resetPage();
});

describe.each(["light", "dark"] as const)("the pass's help badges a11y (%s theme)", (theme) => {
  async function mount(width: number, monitor: boolean) {
    await pageAt(width, width === 390 ? 844 : 900);
    setHelpMode(true);
    const api = {
      getDevicePassScreen: vi.fn(),
      getDevicePassMonitor: vi.fn(),
    } as unknown as TillApi;
    const mounted = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      {
        api,
        deviceMode: true,
        monitor,
        deviceName: "Pase",
        runsPass: true,
        now: Date.parse(FIRED) + 2 * 60_000,
        reducedMotion: true,
        ...(monitor
          ? { initialDevicePassMonitor: { orders, stations: [], zones: null } }
          : {
              initialDevicePass: { orders: orders.map(asPassOrder), stations: [], zones: null },
            }),
      },
      theme,
    );
    mounted.host.style.setProperty("--wt-help-badge-target", "32px");
    mounted.host.style.setProperty("--wt-help-badge-size", "24px");
    await mounted.el.updateComplete;
    return mounted;
  }

  const shown = async (el: TillExpoScreen) => {
    const badges = [...el.shadowRoot!.querySelectorAll<WtHelpTooltip>("wt-help-tooltip")];
    for (const badge of badges) await badge.updateComplete;
    return badges.filter((badge) => badge.getBoundingClientRect().width > 0);
  };

  it.each([
    [1280, "a pass with levers", false, 2],
    [390, "a pass with levers", false, 2],
    [1280, "a monitor", true, 1],
    [390, "a monitor", true, 1],
  ] as const)("help on at %i on %s has no violations", async (width, _, monitor, badges) => {
    const { el, host } = await mount(width, monitor);
    expect(await shown(el)).toHaveLength(badges);
    await expectNoA11yViolations(host);
  });
});
