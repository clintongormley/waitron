import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceApi } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

afterEach(cleanup);
describe.each(["light", "dark"] as const)("venue status accessibility (%s)", (theme) => {
  test("announces readiness problems as a correctly structured list", async () => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [{ code: "venue.department_missing" }],
        departments: [],
        zones: [],
        routes: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        categories: [],
        stations: [],
        floorZones: [],
        products: [],
        settings: { editSentLines: true },
      }),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("kitchen changes setting accessibility (%s)", (theme) => {
  test.each([
    ["stored", undefined],
    ["refused", new Error("offline")],
  ] as const)("the switch and its hint, %s", async (_state, refusal) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [],
        departments: [],
        zones: [],
        routes: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        categories: [],
        stations: [],
        floorZones: [],
        products: [],
        settings: { editSentLines: true },
      }),
      saveSettings: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
    await el.updateComplete;
    if (refusal) {
      el.shadowRoot!.querySelector("wt-switch")!.shadowRoot!.querySelector("input")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-field-error="editSentLines"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "kitchen ticket grouping setting accessibility (%s)",
  (theme) => {
    test.each([
      ["stored", undefined],
      ["refused", new Error("refused")],
    ] as const)("the select and its hint, %s", async (_state, refusal) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = document.createElement(
        "dashboard-venue-operations-screen",
      ) as VenueOperationsScreen;
      el.api = {
        load: vi.fn().mockResolvedValue({
          readiness: [],
          departments: [],
          zones: [],
          routes: [],
          hours: [],
          zoneMenus: [],
          menus: [],
          categories: [],
          stations: [],
          floorZones: [],
          products: [],
          settings: { editSentLines: true },
          kitchenTicketGrouping: "combined",
        }),
        saveKitchenTicketGrouping: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
      } as unknown as VenueServiceApi;
      host.append(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
      await el.updateComplete;
      const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
        'select[name="kitchenTicketGrouping"]',
      )!;
      expect(select).not.toBeNull();
      if (refusal) {
        select.value = "separate";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(
          el.shadowRoot!.querySelector('[data-field-error="kitchenTicketGrouping"]'),
        ).not.toBeNull();
      }
      await expectNoA11yViolations(host);
    });
  },
);

describe.each(["light", "dark"] as const)("print held work setting accessibility (%s)", (theme) => {
  test.each([
    ["stored", undefined],
    ["refused", new Error("offline")],
  ] as const)("the switch and its hint, %s", async (_state, refusal) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [],
        departments: [],
        zones: [],
        routes: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        categories: [],
        stations: [],
        floorZones: [],
        products: [],
        settings: { editSentLines: true },
        kitchenTicketGrouping: "combined",
        printHeldWork: false,
      }),
      savePrintHeldWork: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
    await el.updateComplete;
    const toggle = el.shadowRoot!.querySelector('wt-switch[name="printHeldWork"]');
    expect(toggle).not.toBeNull();
    if (refusal) {
      toggle!.shadowRoot!.querySelector("input")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-field-error="printHeldWork"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "release reminder setting accessibility (%s)",
  (theme) => {
    test.each([
      ["stored", undefined],
      ["refused", new Error("offline")],
    ] as const)("the select and its hint, %s", async (_state, refusal) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = document.createElement(
        "dashboard-venue-operations-screen",
      ) as VenueOperationsScreen;
      el.api = {
        load: vi.fn().mockResolvedValue({
          readiness: [],
          departments: [],
          zones: [],
          routes: [],
          hours: [],
          zoneMenus: [],
          menus: [],
          categories: [],
          stations: [],
          floorZones: [],
          products: [],
          settings: { editSentLines: true },
          kitchenTicketGrouping: "combined",
          printHeldWork: false,
          releaseReminderMinutes: 10,
        }),
        saveReleaseReminderMinutes: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
      } as unknown as VenueServiceApi;
      host.append(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
      await el.updateComplete;
      const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
        'select[name="releaseReminderMinutes"]',
      )!;
      expect(select).not.toBeNull();
      if (refusal) {
        select.value = "5";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(
          el.shadowRoot!.querySelector('[data-field-error="releaseReminderMinutes"]'),
        ).not.toBeNull();
      }
      await expectNoA11yViolations(host);
    });
  },
);

describe.each(["light", "dark"] as const)("department editor accessibility (%s)", (theme) => {
  test("after a failed press: the marked fields and the message beside Save", async () => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [],
        departments: [],
        zones: [],
        routes: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        categories: [],
        stations: [],
        floorZones: [],
        products: [],
        settings: { editSentLines: true },
      }),
      createDepartment: vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="departments"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="new-department"]')!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    await actions.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector(".body [data-error]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-field-error="department-name"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
