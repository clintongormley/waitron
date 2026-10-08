import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PrepStationsApi } from "./routing-client.js";
import type { RouteExplanation } from "../routing-types.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";
afterEach(cleanup);
const empty = {
  routing: {
    zones: [],
    categories: [],
    products: [],
    cells: [],
    canMakeDefault: true,
    defaultStationId: null,
    stations: [],
    stationTimes: [],
    todayEnds: { timeOfDay: "06:00", tomorrow: true },
    clockReadable: true,
  },
  stations: [],
  categories: [],
  zones: [],
  products: [],
  testProducts: [],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
  disabledWatchers: [],
};
const watcher = {
  displayOrder: 0,
  everyStation: true,
  stationIds: [],
  everyZone: true,
  zoneIds: [],
  runsPass: true,
  printerIds: [],
};
describe.each(["light", "dark"] as const)("prep stations accessibility (%s)", (theme) => {
  it.each([
    "empty",
    "station",
    "station-rest-on",
    "editor",
    "invalid",
    "grid",
    "grid-preview",
    "grid-refusal",
    "grid-disabled-target",
    "grid-dropped",
    "watcher",
    "watcher-rename",
    "watcher-remove",
    "watcher-delete",
    "watcher-disabled",
    "watcher-disabled-menu",
    "watcher-enable-refused",
  ] as const)("checks %s state", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
    el.api = {
      updateWatcher: vi.fn().mockRejectedValue({ code: "watcher.name_taken" }),
      preview: vi.fn().mockResolvedValue(
        state === "grid-dropped"
          ? []
          : [
              {
                productId: "cola",
                productName: "Cola",
                zoneId: "terrace",
                zoneName: "Terrace",
                from: { kind: "station", stationId: "bar" },
                to: { kind: "no_preparation" },
              },
              {
                productId: "ice",
                productName: "Ice",
                zoneId: "terrace",
                zoneName: "Terrace",
                from: { kind: "station", stationId: "bar" },
                to: { kind: "no_preparation" },
                dish: { productId: "cola", productName: "Cola" },
              },
            ],
      ),
      setCell: vi.fn().mockRejectedValue({ code: "route.station_inactive" }),
      enableWatcher: vi.fn().mockRejectedValue({ code: "watcher.name_taken" }),
      readStationHealth: vi.fn().mockResolvedValue({
        capturedAt: "2026-10-05T12:00:00Z",
        stations: [],
        outputsDown: { printersDown: [], screensDark: [] },
      }),
      load: vi.fn().mockResolvedValue(
        state === "empty"
          ? empty
          : {
              ...empty,
              routing: state.startsWith("grid")
                ? {
                    ...empty.routing,
                    zones: [{ id: "terrace", name: "Terrace" }],
                    categories: [{ id: "drinks", name: "Drinks", parentId: null }],
                    products: [{ id: "cola", name: "Cola", categoryId: "drinks" }],
                    cells: [
                      {
                        row: { kind: "category", categoryId: "drinks" },
                        zoneId: null,
                        target: {
                          kind: "station",
                          stationId: state === "grid-disabled-target" ? "old" : "bar",
                        },
                      },
                    ],
                    defaultStationId: "bar",
                    stations: [
                      { id: "bar", name: "Bar", active: true },
                      { id: "old", name: "Old bar", active: false },
                    ],
                    stationTimes: [
                      {
                        stationId: "bar",
                        status: { open: true, why: "default" },
                        hours: [],
                        fallbackStationId: null,
                        today: null,
                        closedSendsTo: "bar",
                        nextTransition: null,
                      },
                    ],
                  }
                : empty.routing,
              zones: [{ id: "terrace", name: "Terrace" }],
              stations: [
                {
                  id: "bar",
                  name: "Bar",
                  active: true,
                  isDefault: true,
                  displayOrder: 0,
                  warmAfterMinutes: 5,
                  overdueAfterMinutes: 10,
                  forgottenAfterMinutes: 15,
                  timingDefaults: {
                    warmAfterMinutes: 5,
                    overdueAfterMinutes: 10,
                    forgottenAfterMinutes: 15,
                  },
                  timingOverrides: {
                    warmAfterMinutes: null,
                    overdueAfterMinutes: null,
                    forgottenAfterMinutes: null,
                  },
                  showsRestOfOrder: state === "station-rest-on",
                },
              ],
              watchers: state.startsWith("watcher")
                ? [
                    { ...watcher, id: "pass", name: "Pass", active: true, inUse: true },
                    { ...watcher, id: "runner", name: "Runner", active: true, inUse: false },
                  ]
                : [],
              disabledWatchers: state.startsWith("watcher")
                ? [
                    { ...watcher, id: "old", name: "Old pass", active: false, inUse: true },
                    { ...watcher, id: "spare", name: "Spare", active: false, inUse: false },
                  ]
                : [],
            },
      ),
    } as unknown as PrepStationsApi;
    host.append(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    if (state === "station" || state === "station-rest-on") {
      el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
        new CustomEvent("wt-tab-change", { detail: { value: "settings" } }),
      );
      await el.updateComplete;
      const table = el.shadowRoot!.querySelector('[data-test="settings-table"]')!;
      await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
      const button = table.shadowRoot!.querySelector<HTMLElement>(
        '[data-test="edit-settings-rest-bar"]',
      )!;
      expect(button.textContent?.trim()).toBe(state === "station-rest-on" ? "Yes" : "No");
      button.click();
      await el.updateComplete;
      const choice = table.shadowRoot!.querySelector('[data-test="settings-choice"]')!;
      await (choice as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
      expect(choice.shadowRoot!.querySelector(".trigger .value")!.textContent?.trim()).toBe(
        state === "station-rest-on" ? "Yes" : "No",
      );
    }
    if (state === "editor" || state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="new-station"]')!.click();
      await el.updateComplete;
    }
    if (state.startsWith("grid")) {
      el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
        new CustomEvent("wt-tab-change", { detail: { value: "routing" } }),
      );
      await el.updateComplete;
      const grid = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        "venue-routing-grid",
      )!;
      await grid.updateComplete;
      if (state === "grid-disabled-target")
        expect(grid.shadowRoot!.querySelector('[data-test="disabled-target"]')).not.toBeNull();
      if (state === "grid-preview" || state === "grid-refusal") {
        grid.dispatchEvent(
          new CustomEvent("routing-cell-change", {
            detail: {
              address: { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
              target: { kind: "no_preparation" },
            },
          }),
        );
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector('[data-test="routing-preview"]')).not.toBeNull(),
        );
      }
      if (state === "grid-dropped") {
        // A zone the grid no longer draws, as when a refresh removed it during the preview.
        grid.dispatchEvent(
          new CustomEvent("routing-cell-change", {
            detail: {
              address: { row: { kind: "category", categoryId: "drinks" }, zoneId: "gone" },
              target: { kind: "no_preparation" },
            },
          }),
        );
        await vi.waitFor(() =>
          expect(
            grid.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
              .error,
          ).toBe("Your choice was not saved: its zone is no longer in the grid."),
        );
        await grid.updateComplete;
        expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      }
      if (state === "grid-refusal") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-routing"]')!.click();
        await vi.waitFor(() =>
          expect(
            grid.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
              .error,
          ).toContain("This station is disabled"),
        );
        await grid.updateComplete;
      }
    }
    if (state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="overdue"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "5" } }),
      );
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-station"]')!.click();
      await el.updateComplete;
    }
    if (state === "watcher-rename") {
      el.shadowRoot!.querySelector('[data-test="watchers-table"]')!
        .shadowRoot!.querySelector<HTMLElement>('[data-test="rename-watcher-pass"]')!
        .click();
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="watcher-rename-name"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "Expo" } }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-watcher-name"]')!.click();
      await vi.waitFor(() =>
        expect(
          el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
            '[data-test="watcher-rename-name"]',
          )?.error,
        ).toBe("A watcher already has this name."),
      );
      await el.updateComplete;
    }
    const watcherTable = () =>
      el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        '[data-test="watchers-table"]',
      )!;
    if (state === "watcher-remove" || state === "watcher-delete") {
      watcherTable()
        .shadowRoot!.querySelector<HTMLElement>(
          `[data-test="remove-watcher-${state === "watcher-remove" ? "pass" : "runner"}"]`,
        )!
        .click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector('[data-test="remove-watcher-modal"]')!.textContent,
      ).toContain(state === "watcher-remove" ? "Disable Pass?" : "This cannot be undone.");
    }
    if (state.startsWith("watcher-disabled") || state === "watcher-enable-refused") {
      await watcherTable().updateComplete;
      expect(
        watcherTable().shadowRoot!.querySelector('[data-test="watcher-status-old"]')!.textContent,
      ).toContain("Disabled");
    }
    if (state === "watcher-disabled-menu") {
      el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
        new CustomEvent("wt-tab-change", { detail: { value: "watchers" } }),
      );
      await el.updateComplete;
      const menu = watcherTable().shadowRoot!.querySelector('[data-test="watcher-actions-spare"]')!;
      await page.elementLocator(menu.shadowRoot!.querySelector("button")!).click();
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    }
    if (state === "watcher-enable-refused") {
      watcherTable()
        .shadowRoot!.querySelector<HTMLElement>('[data-test="enable-watcher-old"]')!
        .click();
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
          "Rename that watcher first",
        ),
      );
    }
    expect(el.shadowRoot!.querySelector("h1")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("station timing accessibility (%s)", (theme) => {
  it.each([
    "closed",
    "warnings",
    "fallback",
    "fallback-confirmation",
    "close-confirmation",
    "switch-off",
    "inactive",
    "clock-unreadable",
    "opened-by-hand",
    "closed-by-hand",
    "no-replacement",
    "refused-close",
    "refused-fallback",
    "refused-switch-off",
  ] as const)("checks %s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
    const stations = [
      {
        id: "kitchen",
        name: "Kitchen",
        active: true,
        isDefault: true,
        displayOrder: 0,
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
        timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        timingOverrides: {
          warmAfterMinutes: null,
          overdueAfterMinutes: null,
          forgottenAfterMinutes: null,
        },
      },
      {
        id: "bar",
        name: "Upstairs bar",
        active: state !== "inactive",
        isDefault: false,
        displayOrder: 1,
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
        timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        timingOverrides: {
          warmAfterMinutes: null,
          overdueAfterMinutes: null,
          forgottenAfterMinutes: null,
        },
      },
    ];
    el.api = {
      updateWatcher: vi.fn().mockRejectedValue({ code: "watcher.name_taken" }),
      readStationHealth: vi.fn().mockResolvedValue({
        capturedAt: "2026-10-05T12:00:00Z",
        stations: stations.map((station) => ({
          id: station.id,
          name: station.name,
          hasScreen: false,
          waiting: 0,
          preparing: null,
          ready: null,
          late: { warm: 0, overdue: 0, forgotten: 0 },
          oldestMinutes: null,
          items: [],
        })),
        outputsDown: {
          printersDown: [
            {
              stationId: "bar",
              stationName: "Upstairs bar",
              printerId: "epson",
              printerName: "Epson",
              since: "2026-10-01T20:14:00",
            },
          ],
          screensDark: [{ stationId: "bar", stationName: "Upstairs bar", lastSeenAt: null }],
        },
      }),
      load: vi.fn().mockResolvedValue({
        ...empty,
        stations,
        routing: {
          ...empty.routing,
          defaultStationId: "kitchen",
          clockReadable: state !== "clock-unreadable",
          stations,
          stationTimes: [
            {
              stationId: "kitchen",
              status: { open: true, why: "default" },
              hours: [],
              fallbackStationId: null,
              today: null,
              closedSendsTo: "kitchen",
              nextTransition: null,
            },
            {
              stationId: "bar",
              status: {
                open: ["close-confirmation", "refused-close", "opened-by-hand"].includes(state),
                why:
                  state === "opened-by-hand"
                    ? "opened_by_hand"
                    : state === "closed-by-hand"
                      ? "closed_by_hand"
                      : ["close-confirmation", "refused-close"].includes(state)
                        ? "in_hours"
                        : "out_of_hours",
              },
              hours: [
                {
                  weekday: 5,
                  opensAt: "22:00",
                  closesAt: "02:00",
                },
              ],
              fallbackStationId: "kitchen",
              today:
                state === "opened-by-hand" ? "open" : state === "closed-by-hand" ? "closed" : null,
              closedSendsTo: state === "no-replacement" ? null : "kitchen",
              nextTransition: null,
            },
          ],
        },
      }),
      setStationToday: vi.fn().mockRejectedValue({ code: "time_zone.unreadable" }),
      setStationFallback: vi.fn().mockRejectedValue({ code: "station.fallback_loop" }),
      deactivateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
    } as unknown as PrepStationsApi;
    host.append(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const settingsTable = el.shadowRoot!.querySelector('[data-test="settings-table"]')!;
    const settingsQ = (selector: string) =>
      settingsTable.shadowRoot!.querySelector<HTMLElement>(selector)!;
    const fallbackState = state.includes("fallback");
    if (!fallbackState) {
      el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
        new CustomEvent("wt-tab-change", { detail: { value: "stations" } }),
      );
      await el.updateComplete;
      if (state === "warnings") {
        const table = el.shadowRoot!.querySelector("prep-station-health-table")!;
        await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
        const summary = table.shadowRoot!.querySelector("wt-data-table")!;
        await (summary as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
        expect(summary.shadowRoot!.textContent).toContain("Printer Epson");
        expect(summary.shadowRoot!.textContent).toContain("has ever checked in");
      }
    }
    if (fallbackState) {
      el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
        new CustomEvent("wt-tab-change", { detail: { value: "settings" } }),
      );
      await el.updateComplete;
      await (settingsTable as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
      settingsQ('[data-test="edit-settings-fallback-bar"]').click();
      await el.updateComplete;
      if (state === "fallback-confirmation") {
        settingsQ('[data-test="settings-choice"]').dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "" } }),
        );
        await el.updateComplete;
        settingsQ('[data-test="save-settings-cell"]').click();
        await el.updateComplete;
        expect(settingsQ('[data-test="settings-fallback-confirmation"]')).not.toBeNull();
      }
    }
    const action =
      state === "close-confirmation" || state === "refused-close"
        ? "close-today"
        : state === "switch-off" || state === "refused-switch-off"
          ? "disable"
          : null;
    if (action) {
      const selector = `[data-test="${action}-bar"]`;
      const summary = el
        .shadowRoot!.querySelector("prep-station-health-table")!
        .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
      (el.shadowRoot!.querySelector<HTMLElement>(selector) ??
        summary.querySelector<HTMLElement>(selector))!.click();
      await el.updateComplete;
    }
    if (state.startsWith("refused-")) {
      if (state === "refused-fallback") {
        settingsQ('[data-test="settings-choice"]').dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "" } }),
        );
        await el.updateComplete;
        settingsQ('[data-test="save-settings-cell"]').click();
        await el.updateComplete;
        settingsQ('[data-test="save-settings-cell"]').click();
      } else {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-station-action"]')!.click();
        await el.updateComplete;
        if (state === "refused-switch-off")
          el.shadowRoot!.querySelector<HTMLElement>(
            '[data-test="confirm-station-action"]',
          )!.click();
      }
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
      if (state === "refused-fallback") {
        const choice = settingsQ('[data-test="settings-choice"]') as HTMLElement & {
          error: string;
          value: string;
        };
        expect(choice.error).toContain("loop");
        expect(choice.value).toBe("");
        expect(settingsQ('[data-test="save-settings-cell"]').hasAttribute("disabled")).toBe(false);
      } else {
        expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
      }
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["en", "es"])("timed routing tester (%s)", (locale) => {
  describe.each(["light", "dark"] as const)("theme %s", (theme) => {
    it.each([390, 1280])("keeps controls and fallback answer readable at %s px", async (width) => {
      const previous = { width: window.innerWidth, height: window.innerHeight };
      setLocale(locale);
      try {
        await page.viewport(width, 900);
        await mountThemed("<div></div>", theme);
        host.style.width = `${width}px`;
        expect(host.getBoundingClientRect().width).toBe(width);
        host.style.boxSizing = "border-box";
        const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
        el.api = {
          updateWatcher: vi.fn().mockRejectedValue({ code: "watcher.name_taken" }),
          readStationHealth: vi.fn().mockResolvedValue({
            capturedAt: "2026-10-05T12:00:00Z",
            stations: [],
            outputsDown: { printersDown: [], screensDark: [] },
          }),
          load: vi.fn().mockResolvedValue({
            ...empty,
            testProducts: [
              { id: "mojito", name: "Mojito" },
              { id: "chips", name: "Chips" },
            ],
            categories: [{ id: "sides", name: "Sides", parentId: null }],
          }),
          explain: vi.fn().mockResolvedValue({
            route: { kind: "station", stationId: "downstairs" },
            decidedBy: {
              kind: "cell",
              address: { row: { kind: "product", productId: "mojito" }, zoneId: null },
            },
            fallbacks: [{ stationId: "upstairs", why: "out_of_hours" }],
            noReplacement: false,
            clockReadable: true,
            stations: [
              { id: "upstairs", name: "Upstairs bar", active: true },
              { id: "downstairs", name: "Downstairs bar", active: true },
            ],
            extrasWaitOnDish: false,
            extras: [
              {
                productId: "chips",
                outcome: { kind: "made", stationId: "upstairs" },
                decidedBy: {
                  kind: "cell",
                  address: { row: { kind: "category", categoryId: "sides" }, zoneId: null },
                },
                fallbacks: [],
              },
            ],
          } satisfies RouteExplanation),
        } as unknown as PrepStationsApi;
        host.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        const root = el.shadowRoot!;
        const tabs = root.querySelector("wt-tabs")!;
        await tabs.updateComplete;
        tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
        await el.updateComplete;
        await tabs.updateComplete;
        root
          .querySelector('[data-test="test-product"]')!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "mojito" } }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        await expectNoA11yViolations(host);
        root
          .querySelector('[data-test="test-extra"]')!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "chips" } }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(root.querySelector('[data-test="remove-extra-chips"]')).not.toBeNull();
        await expectNoA11yViolations(host);
        const when = root.querySelector('[data-test="test-when"]')!;
        when.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "at" } }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        for (const selector of [
          '[data-test="test-when"]',
          '[data-test="test-weekday"]',
          '[data-test="test-time"]',
        ]) {
          const box = root.querySelector(selector)!.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(host.getBoundingClientRect().left);
          expect(box.right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        const answer = root.querySelector('[data-test="test-answer"]')!.textContent!;
        expect(answer).toContain(
          locale === "en" ? "so its work goes to Downstairs bar" : "su trabajo va a Downstairs bar",
        );
        expect(answer).toContain(
          locale === "en"
            ? "Because: Upstairs bar: Mojito, in every zone"
            : "Porque: Upstairs bar: Mojito, en todas las zonas",
        );
        expect(answer).toContain(
          locale === "en"
            ? "Chips: made separately at Upstairs bar, as set for Sides, in every zone"
            : "Chips: se prepara aparte en Upstairs bar, como está indicado para Sides, en todas las zonas",
        );
        await expectNoA11yViolations(host);
        const time = root.querySelector('[data-test="test-time"]')!;
        time.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
        await el.updateComplete;
        await expectNoA11yViolations(host);

        // The date-and-time preview: first with no date chosen, then answered, then a time the
        // clocks skip on that date.
        when.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "date" } }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(root.querySelector("#test-date-error")!.textContent!.trim()).not.toBe("");
        await expectNoA11yViolations(host);
        root
          .querySelector('[data-test="test-date"]')!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2026-10-09" } }));
        root
          .querySelector('[data-test="test-time"]')!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "22:00" } }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        for (const selector of [
          '[data-test="test-when"]',
          '[data-test="test-date"]',
          '[data-test="test-time"]',
        ]) {
          const box = root.querySelector(selector)!.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(host.getBoundingClientRect().left);
          expect(box.right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        expect(root.querySelector('[data-test="test-answer"]')!.textContent).toContain(
          locale === "en" ? "so its work goes to Downstairs bar" : "su trabajo va a Downstairs bar",
        );
        await expectNoA11yViolations(host);
        vi.mocked(el.api.explain).mockRejectedValueOnce({
          code: "management.request_invalid",
          params: { field: "time" },
        });
        root
          .querySelector('[data-test="test-time"]')!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "02:30" } }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(root.querySelector("#test-time-error")!.textContent!.trim()).not.toBe("");
        await expectNoA11yViolations(host);
      } finally {
        await page.viewport(previous.width, previous.height);
      }
    });
  });
});
