import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PrepStationsApi } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";
// The screen opens on the tab its URL names, so each test starts from the page's own URL.
const startUrl = location.href;
afterEach(() => {
  cleanup();
  history.replaceState(null, "", startUrl);
});
const empty = {
  routing: {
    periods: [],
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
  printers: [],
  stationPrinters: [],
  devices: [],
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
  ] as const)("checks %s state", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
    el.api = {
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
            },
      ),
    } as unknown as PrepStationsApi;
    host.append(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    if (state === "station" || state === "station-rest-on") {
      const table = el
        .shadowRoot!.querySelector("prep-station-table")!
        .shadowRoot!.querySelector("wt-data-table")!;
      await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
      table.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-bar"]')!.click();
      await el.updateComplete;
      const editor = el.shadowRoot!.querySelector("prep-station-editor")!;
      await editor.updateComplete;
      const rest = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
        "wt-switch[name=showsRestOfOrder]",
      )!;
      await rest.updateComplete;
      expect(rest.checked).toBe(state === "station-rest-on");
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
      expect(el.shadowRoot!.querySelector('[data-test="route-tester"]')).toBeNull();
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
    expect(el.shadowRoot!.querySelector("h1")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("station timing accessibility (%s)", (theme) => {
  it.each([
    "closed",
    "switch-off",
    "inactive",
    "clock-unreadable",
    "opened-by-hand",
    "closed-by-hand",
    "no-replacement",
    "refused-rest",
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
                open: state === "opened-by-hand",
                why:
                  state === "opened-by-hand"
                    ? "open"
                    : state === "closed-by-hand"
                      ? "closed_by_hand"
                      : "closed_by_hand",
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
      updateStation: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "showsRestOfOrder" },
      }),
      readStationClosing: vi.fn().mockResolvedValue({ openDishCount: 0, destinations: [] }),
      deactivateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
    } as unknown as PrepStationsApi;
    host.append(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "stations" } }),
    );
    await el.updateComplete;
    let restEditor: HTMLElementTagNameMap["prep-station-editor"] | undefined;
    if (state === "refused-rest") {
      const table = el
        .shadowRoot!.querySelector("prep-station-table")!
        .shadowRoot!.querySelector("wt-data-table")!;
      await (table as HTMLElementTagNameMap["wt-data-table"]).updateComplete;
      table.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-bar"]')!.click();
      await el.updateComplete;
      restEditor =
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["prep-station-editor"]>(
          "prep-station-editor",
        )!;
      await restEditor.updateComplete;
    }
    const action = state === "switch-off" || state === "refused-switch-off" ? "disable" : null;
    if (action) {
      const selector = `[data-test="${action}-bar"]`;
      const summary = el
        .shadowRoot!.querySelector("prep-station-table")!
        .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
      (el.shadowRoot!.querySelector<HTMLElement>(selector) ??
        summary.querySelector<HTMLElement>(selector))!.click();
      await el.updateComplete;
    }
    if (state.startsWith("refused-")) {
      if (state === "refused-rest") {
        restEditor!
          .shadowRoot!.querySelector("wt-switch[name=showsRestOfOrder]")!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
        await restEditor!.updateComplete;
        restEditor!
          .shadowRoot!.querySelector<HTMLElement>('[data-test="save-station-edit"]')!
          .click();
      } else {
        const dialog = el.shadowRoot!.querySelector<
          HTMLElement & { updateComplete: Promise<boolean> }
        >("station-disable-dialog")!;
        await dialog.updateComplete;
        await expect
          .poll(() =>
            dialog
              .shadowRoot!.querySelector("[data-test=disable-confirm]")
              ?.hasAttribute("disabled"),
          )
          .toBe(false);
        dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=disable-confirm]")!.click();
      }
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
      if (state === "refused-rest") {
        await restEditor!.updateComplete;
        expect(
          restEditor!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            "wt-form-actions",
          )!.error,
        ).toContain("could not be saved");
        expect(
          restEditor!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
            "wt-switch[name=showsRestOfOrder]",
          )!.checked,
        ).toBe(true);
        expect(
          restEditor!
            .shadowRoot!.querySelector('[data-test="save-station-edit"]')!
            .hasAttribute("disabled"),
        ).toBe(false);
      } else {
        expect(
          el
            .shadowRoot!.querySelector("station-disable-dialog")!
            .shadowRoot!.querySelector('[role="alert"]'),
        ).not.toBeNull();
      }
    }
    await expectNoA11yViolations(host);
  });
});
