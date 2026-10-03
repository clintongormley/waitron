import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption, cleanup, formMessageOf, host } from "@waitron/ui/src/test-helpers.js";
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
        deviceZones: [],
        devices: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        floorZones: [],
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
        deviceZones: [],
        devices: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        floorZones: [],
        settings: { editSentLines: true },
      }),
      saveSettings: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="kitchen"]')!.click();
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
          deviceZones: [],
          devices: [],
          hours: [],
          zoneMenus: [],
          menus: [],
          floorZones: [],
          settings: { editSentLines: true },
          kitchenTicketGrouping: "combined",
        }),
        saveKitchenTicketGrouping: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
      } as unknown as VenueServiceApi;
      host.append(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="kitchen"]')!.click();
      await el.updateComplete;
      const select = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        'wt-combobox[name="kitchenTicketGrouping"]',
      )!;
      expect(select).not.toBeNull();
      if (refusal) {
        await chooseOption(select, "separate");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(select.error).not.toBe("");
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
        deviceZones: [],
        devices: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        floorZones: [],
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
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="kitchen"]')!.click();
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
          deviceZones: [],
          devices: [],
          hours: [],
          zoneMenus: [],
          menus: [],
          floorZones: [],
          settings: { editSentLines: true },
          kitchenTicketGrouping: "combined",
          printHeldWork: false,
          releaseReminderMinutes: 10,
          clearingWorkflow: false,
        }),
        saveReleaseReminderMinutes: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
      } as unknown as VenueServiceApi;
      host.append(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="kitchen"]')!.click();
      await el.updateComplete;
      const select = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        'wt-combobox[name="releaseReminderMinutes"]',
      )!;
      expect(select).not.toBeNull();
      if (refusal) {
        await chooseOption(select, "5");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        expect(select.error).not.toBe("");
      }
      await expectNoA11yViolations(host);
    });
  },
);

describe.each(["light", "dark"] as const)("department editor accessibility (%s)", (theme) => {
  test("after a failed press: the marked fields and the message above Save", async () => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [],
        departments: [],
        zones: [],
        deviceZones: [],
        devices: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        floorZones: [],
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
    expect(await formMessageOf(actions)).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        'wt-input[name="department-name"]',
      )!.error,
    ).not.toBe("");
    await expectNoA11yViolations(host);
  });
});

function findDeep(root: ParentNode, selector: string): HTMLElement | null {
  const match = root.querySelector<HTMLElement>(selector);
  if (match) return match;
  for (const child of root.querySelectorAll("*")) {
    const found = child.shadowRoot ? findDeep(child.shadowRoot, selector) : null;
    if (found) return found;
  }
  return null;
}

describe.each(["light", "dark"] as const)("venue editors' fields accessibility (%s)", (theme) => {
  test.each([
    ["the hours editor, after a failed press", "departments", ["new-hours"], true],
    ["the zone editor", "zones", ["edit-zone-z1"], false],
    ["the menu editor", "zones", ["zone-menus-z1", "new-assignment-z1"], false],
    ["the tills' starting zones", "zones", [], false],
  ] as const)("%s", async (_name, tab, steps, press) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [],
        departments: [
          {
            id: "d1",
            name: "Restaurant",
            tradingName: "Casa",
            defaultServiceMode: "table_tab",
            active: true,
          },
        ],
        zones: [
          {
            id: "z1",
            name: "Dining room",
            departmentId: "d1",
            departmentName: "Restaurant",
            serviceMode: "table_tab",
            serviceModeOverride: null,
          },
        ],
        deviceZones: [],
        devices: [{ id: "t1", label: "Front till", kind: "till", active: true }],
        hours: [],
        zoneMenus: [{ zoneId: "z1", menuId: "m1", displayOrder: 0, isDefault: true }],
        menus: [
          { id: "m1", name: "Lunch", active: true },
          { id: "m2", name: "Dinner", active: true },
        ],
        floorZones: [{ id: "z1", name: "Dining room" }],
        settings: { editSentLines: true },
      }),
      replaceHours: vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${tab}"]`)!.click();
    await el.updateComplete;
    for (const step of steps) {
      findDeep(el.shadowRoot!, `[data-test="${step}"]`)!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }
    if (press) {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
          'wt-input[name="hours-opens"]',
        )!.error,
      ).not.toBe("");
    }
    expect(findDeep(el.shadowRoot!, "wt-combobox")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
