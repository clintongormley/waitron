import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PrepStationsApi, PrepStationsView, StationHealthSnapshot } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
const view: PrepStationsView = {
  routing: {
    zones: [],
    categories: [],
    products: [],
    cells: [],
    canMakeDefault: false,
    defaultStationId: "bar",
    stations: [{ id: "bar", name: "Bar", active: true }],
    stationTimes: [
      {
        stationId: "bar",
        nextTransition: null,
        status: { open: true, why: "default" },
        hours: [],
        fallbackStationId: null,
        today: null,
        closedSendsTo: "bar",
      },
    ],
    todayEnds: { timeOfDay: "06:00", tomorrow: true },
    clockReadable: true,
  },
  stations: [
    {
      id: "bar",
      name: "Bar",
      active: true,
      isDefault: true,
      displayOrder: 1,
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
      showsRestOfOrder: false,
      timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
      timingOverrides: {
        warmAfterMinutes: null,
        overdueAfterMinutes: null,
        forgottenAfterMinutes: null,
      },
    },
  ],
  categories: [],
  zones: [],
  products: [],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
  disabledWatchers: [],
};
const snapshot: StationHealthSnapshot = {
  capturedAt: "2026-10-05T12:00:00Z",
  outputsDown: {
    printersDown: [],
    screensDark: [{ stationId: "bar", stationName: "Bar", lastSeenAt: null }],
  },
  stations: [
    {
      id: "bar",
      name: "Bar",
      hasScreen: true,
      waiting: 1,
      preparing: 0,
      ready: 0,
      late: { warm: 0, overdue: 1, forgotten: 0 },
      oldestMinutes: 12,
      items: [
        {
          id: "soup",
          name: "KITCHEN SOUP",
          orderId: "order",
          orderNumber: 7,
          label: "Terrace",
          tableNames: ["Table 5"],
          state: "queued",
          queuedAt: "2026-10-05T11:48:00Z",
          remainingQuantity: "1.000",
          band: "overdue",
        },
      ],
    },
  ],
};
it.each([
  { locale: "en", theme: "light", width: 390 },
  { locale: "en", theme: "dark", width: 390 },
  { locale: "es", theme: "light", width: 390 },
  { locale: "es", theme: "dark", width: 390 },
  { locale: "en", theme: "light", width: 1280 },
  { locale: "en", theme: "dark", width: 1280 },
  { locale: "es", theme: "light", width: 1280 },
  { locale: "es", theme: "dark", width: 1280 },
] as const)(
  "renders the supervisor overview and keyboard drilldown ($locale/$theme/$width)",
  async ({ locale, theme, width }) => {
    const previous = {
      width: window.innerWidth,
      height: window.innerHeight,
      background: document.body.style.background,
      canvas: document.documentElement.style.background,
    };
    try {
      await page.viewport(width, 900);
      setLocale(locale);
      history.replaceState(null, "", "/manage/prep-stations/view/stations");
      await mountThemed("<div></div>", theme);
      host.style.background = "var(--wt-color-bg)";
      document.body.style.background = getComputedStyle(host).backgroundColor;
      document.documentElement.style.background = getComputedStyle(host).backgroundColor;
      const screen = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
      screen.readOnly = true;
      screen.api = {
        load: vi.fn().mockResolvedValue(view),
        readStationHealth: vi.fn().mockResolvedValue(snapshot),
      } as unknown as PrepStationsApi;
      host.append(screen);
      await vi.waitFor(() =>
        expect(
          screen
            .shadowRoot!.querySelector("prep-station-health-table")
            ?.shadowRoot?.querySelector("wt-data-table")
            ?.shadowRoot?.querySelector('[data-test="overdue-bar"]'),
        ).toBeTruthy(),
      );
      const health = screen.shadowRoot!.querySelector("prep-station-health-table")!;
      const table = health.shadowRoot!.querySelector("wt-data-table")!;
      const button = table.shadowRoot!.querySelector<HTMLButtonElement>(
        '[data-test="overdue-bar"]',
      )!;
      expect(table.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
      expect(screen.shadowRoot!.querySelector('[data-test="new-station"]')).toBeNull();
      expect(screen.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/overview-${locale}-${theme}-${width}-page.png`,
      });
      button.focus();
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() =>
        expect(
          health.shadowRoot!.querySelector('[data-test="health-details"]')?.shadowRoot?.textContent,
        ).toContain("KITCHEN SOUP"),
      );
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/overview-${locale}-${theme}-${width}-details.png`,
      });
      const closed = new Promise((resolve) =>
        health
          .shadowRoot!.querySelector("wt-modal")!
          .addEventListener("wt-close", resolve, { once: true }),
      );
      await userEvent.keyboard("{Escape}");
      await closed;
      await vi.waitFor(() => expect(health.shadowRoot!.querySelector("wt-modal")).toBeNull());
    } finally {
      document.body.style.background = previous.background;
      document.documentElement.style.background = previous.canvas;
      await page.viewport(previous.width, previous.height);
    }
  },
);
