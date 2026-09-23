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
        offers: [],
        sections: [],
      }),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("labels each variant's menu price and Offered switch in the offer editor", async () => {
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
        menus: [{ id: "m1", name: "Bar", active: true }],
        categories: [],
        stations: [],
        floorZones: [],
        products: [
          {
            id: "p1",
            name: "Wine by the glass",
            customerName: null,
            pricingUnit: "each",
            unitPrice: "4.00",
            active: true,
            variants: [
              {
                id: "v1",
                name: "Wine 125",
                customerName: null,
                unitPrice: null,
                available: true,
                active: true,
              },
              {
                id: "v2",
                name: "Wine 175",
                customerName: null,
                unitPrice: "5.50",
                available: true,
                active: true,
              },
            ],
          },
        ],
        offers: [
          {
            id: "i1",
            menuId: "m1",
            productId: "p1",
            sectionId: "s1",
            sectionName: { en: "Wine" },
            name: "Wine by the glass",
            customerName: null,
            grossPrice: "4.50",
            variants: [
              {
                id: "v2",
                name: "Wine 175",
                customerName: null,
                unitPrice: "6.00",
                menuPrice: "6.00",
                offered: false,
                available: false,
              },
            ],
          },
        ],
        sections: [],
      }),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="menus"]')!.click();
    await el.updateComplete;
    const edit = findDeep(el.shadowRoot!, '[data-test="edit-offer-i1"]')!;
    edit.closest("wt-row-actions")?.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    edit.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[name="offer-variant-offered-v2"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

function findDeep(root: ParentNode, selector: string): HTMLElement | null {
  const match = root.querySelector<HTMLElement>(selector);
  if (match) return match;
  for (const child of root.querySelectorAll("*")) {
    if (child.shadowRoot) {
      const found = findDeep(child.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}
