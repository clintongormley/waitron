import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PrepStationsApi } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";
afterEach(cleanup);
const empty = {
  routing: {
    claims: [],
    exceptions: [],
    unassigned: { folders: [], products: [] },
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
};
describe.each(["light", "dark"] as const)("prep stations accessibility (%s)", (theme) => {
  it.each([
    "empty",
    "station",
    "station-rest-on",
    "editor",
    "claim",
    "invalid",
    "exception",
    "exception-editor",
    "exception-delete",
    "watcher",
    "watcher-form",
    "watcher-remove",
  ] as const)("checks %s state", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue(
        state === "empty"
          ? empty
          : {
              ...empty,
              routing: state.startsWith("exception")
                ? {
                    ...empty.routing,
                    exceptions: [
                      {
                        id: "e1",
                        position: 1,
                        zoneId: "terrace",
                        categoryId: null,
                        productId: null,
                        target: { kind: "station", stationId: "bar" },
                        neverMatches: true,
                        stationOff: false,
                      },
                    ],
                    stations: [{ id: "bar", name: "Bar", active: true }],
                    stationTimes: [
                      {
                        stationId: "bar",
                        status: { open: true, why: "default" },
                        hours: [],
                        fallbackStationId: null,
                        today: null,
                        closedSendsTo: "bar",
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
                  showsRestOfOrder: state === "station-rest-on",
                },
              ],
              watchers: state.startsWith("watcher")
                ? [
                    {
                      id: "pass",
                      name: "Pass",
                      active: true,
                      displayOrder: 0,
                      everyStation: true,
                      stationIds: [],
                      everyZone: true,
                      zoneIds: [],
                      runsPass: true,
                      printerIds: [],
                    },
                  ]
                : [],
            },
      ),
    } as unknown as PrepStationsApi;
    host.append(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    if (state === "station" || state === "station-rest-on") {
      const input = el
        .shadowRoot!.querySelector('wt-switch[name="showsRestOfOrder"]')!
        .shadowRoot!.querySelector<HTMLInputElement>('input[role="switch"]')!;
      expect(input.checked).toBe(state === "station-rest-on");
    }
    if (state === "editor" || state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-bar"]')!.click();
      await el.updateComplete;
    }
    if (state === "claim") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="claim-bar"]')!.click();
      await el.updateComplete;
    }
    if (state === "exception-editor") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-exception-e1"]')!.click();
      await el.updateComplete;
    }
    if (state === "exception-delete") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-e1"]')!.click();
      await el.updateComplete;
    }
    if (state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="overdue"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "5" } }),
      );
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-station"]')!.click();
      await el.updateComplete;
    }
    if (state === "watcher-form") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-watcher-pass"]')!.click();
      await el.updateComplete;
      const form = el.shadowRoot!.querySelector<HTMLElement>("watcher-form")!;
      (form as HTMLElement & { refusal: object }).refusal = { code: "watcher.name_taken" };
      await (form as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    }
    if (state === "watcher-remove") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-watcher-pass"]')!.click();
      await el.updateComplete;
    }
    expect(el.shadowRoot!.querySelector("h1")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("station timing accessibility (%s)", (theme) => {
  it.each([
    "closed",
    "warnings",
    "hours",
    "invalid-hours",
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
    "refused-hours",
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
                  closesAt: state === "invalid-hours" ? "22:00" : "02:00",
                },
              ],
              fallbackStationId: "kitchen",
              today:
                state === "opened-by-hand" ? "open" : state === "closed-by-hand" ? "closed" : null,
              closedSendsTo: state === "no-replacement" ? null : "kitchen",
            },
          ],
        },
      }),
      setStationToday: vi.fn().mockRejectedValue({ code: "time_zone.unreadable" }),
      setStationFallback: vi.fn().mockRejectedValue({ code: "station.fallback_loop" }),
      deactivateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
      setStationHours: vi
        .fn()
        .mockRejectedValue({ code: "station.invalid", params: { field: "hours.0" } }),
      listOutputsDown: vi.fn().mockResolvedValue({
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
      }),
    } as unknown as PrepStationsApi;
    host.append(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const action = state.includes("hours")
      ? "edit-hours"
      : state.includes("fallback")
        ? "change-fallback"
        : state === "close-confirmation" || state === "refused-close"
          ? "close-today"
          : state === "switch-off" || state === "refused-switch-off"
            ? "switch-off"
            : null;
    if (action) {
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}-bar"]`)!.click();
      await el.updateComplete;
      if (state === "fallback-confirmation") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-station-action"]')!.click();
        await el.updateComplete;
      }
      if (state === "invalid-hours" || state === "refused-hours") {
        const form = el.shadowRoot!.querySelector("station-hours-form")!;
        await (form as unknown as { updateComplete: Promise<boolean> }).updateComplete;
        form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
        await (form as unknown as { updateComplete: Promise<boolean> }).updateComplete;
      }
    }
    if (state.startsWith("refused-")) {
      if (state === "refused-fallback") {
        el.shadowRoot!.querySelector('[data-test="station-fallback"]')!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "" } }),
        );
        await el.updateComplete;
      }
      if (state !== "refused-hours") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-station-action"]')!.click();
        await el.updateComplete;
        if (state === "refused-fallback" || state === "refused-switch-off")
          el.shadowRoot!.querySelector<HTMLElement>(
            '[data-test="confirm-station-action"]',
          )!.click();
      }
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
      const form = el.shadowRoot!.querySelector("station-hours-form");
      expect((form?.shadowRoot ?? el.shadowRoot)!.querySelector('[role="alert"]')).not.toBeNull();
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
          load: vi.fn().mockResolvedValue({
            ...empty,
            testProducts: [
              { id: "mojito", name: "Mojito" },
              { id: "chips", name: "Chips" },
            ],
          }),
          explain: vi.fn().mockResolvedValue({
            route: { kind: "station", stationId: "downstairs" },
            decidedBy: { kind: "exception", exceptionId: "rule" },
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
                decidedBy: { kind: "claim", categoryId: "sides" },
                fallbacks: [],
              },
            ],
          }),
        } as unknown as PrepStationsApi;
        host.append(el);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        const root = el.shadowRoot!;
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
        await expectNoA11yViolations(host);
        const time = root.querySelector('[data-test="test-time"]')!;
        time.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
        await el.updateComplete;
        await expectNoA11yViolations(host);
      } finally {
        await page.viewport(previous.width, previous.height);
      }
    });
  });
});
