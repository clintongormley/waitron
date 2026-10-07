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

describe.each(["light", "dark"] as const)("a disabled department's Enable (%s)", (theme) => {
  test("the policy tree and the departments tab, each with a disabled department's menu open", async () => {
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
          {
            id: "d2",
            name: "Events",
            tradingName: "Casa Events",
            defaultServiceMode: "prepay",
            active: false,
          },
        ],
        zones: [],
        salePolicies: { departments: [], zones: [] },
        hours: [],
        menus: [],
        floorZones: [],
        settings: { editSentLines: true },
      }),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    async function openMenuOf(name: string) {
      const button = findDeep(el.shadowRoot!, `[data-test="${name}"]`)!;
      expect(button, name).not.toBeNull();
      button
        .closest("wt-row-actions")!
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!
        .click();
      await el.updateComplete;
    }
    await openMenuOf("enable-tree-department-d2");
    await expectNoA11yViolations(host);
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="departments"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await openMenuOf("enable-department-d2");
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
  test.each([["the zone editor", "zones", ["edit-zone-z1"]]] as const)(
    "%s",
    async (_name, tab, steps) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = document.createElement(
        "dashboard-venue-operations-screen",
      ) as VenueOperationsScreen;
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
          menus: [
            { id: "m1", name: "Lunch", active: true },
            { id: "m2", name: "Dinner", active: true },
          ],
          floorZones: [{ id: "z1", name: "Dining room" }],
          settings: { editSentLines: true },
        }),
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
      expect(findDeep(el.shadowRoot!, "wt-combobox")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});
