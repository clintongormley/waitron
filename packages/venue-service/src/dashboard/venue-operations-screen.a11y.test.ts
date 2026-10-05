import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, formMessageOf, host } from "@waitron/ui/src/test-helpers.js";
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
        salePolicies: { departments: [], zones: [] },
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
        salePolicies: { departments: [], zones: [] },
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
    ["the menu editor", "zones", ["menus-tree-zone-z1", "new-assignment-z1"], false],
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
        salePolicies: { departments: [], zones: [] },
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
