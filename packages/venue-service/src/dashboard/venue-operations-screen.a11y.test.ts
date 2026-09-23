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
            unitPrice: "4.50",
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

  test("describes a blank menu price by its hint, with the product's price as placeholder", async () => {
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
            name: "Olives",
            customerName: null,
            pricingUnit: "each",
            unitPrice: "3.00",
            active: true,
            variants: [],
          },
        ],
        offers: [
          {
            id: "i1",
            menuId: "m1",
            productId: "p1",
            sectionId: "s1",
            sectionName: { en: "Snacks" },
            name: "Olives",
            customerName: null,
            grossPrice: null,
            unitPrice: "3.00",
            variants: [],
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
    const price = el.shadowRoot!.querySelector<HTMLInputElement>('[name="offer-price-i1"]')!;
    expect(price.value).toBe("");
    expect(price.placeholder).toBe("3.00");
    expect(el.shadowRoot!.querySelector('[data-hint="offer-price-i1"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("keeps a struck-out and a greyed-out price in the offers list readable", async () => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    const product = (id: string, name: string, unitPrice: string) => ({
      id,
      name,
      customerName: null,
      pricingUnit: "each",
      unitPrice,
      active: true,
      variants: [],
    });
    const offer = (id: string, productId: string, name: string, grossPrice: string | null) => ({
      id,
      menuId: "m1",
      productId,
      sectionId: "s1",
      sectionName: { en: "Snacks" },
      name,
      customerName: null,
      grossPrice,
      unitPrice: grossPrice ?? "3.00",
      variants: [],
    });
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
        products: [product("p1", "Olives", "3.00"), product("p2", "Almonds", "4.00")],
        offers: [offer("i1", "p1", "Olives", null), offer("i2", "p2", "Almonds", "3.50")],
        sections: [],
      }),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="menus"]')!.click();
    await el.updateComplete;
    expect(findDeep(el.shadowRoot!, '[part~="price-inherited"]')).not.toBeNull();
    expect(findDeep(el.shadowRoot!, "s")!.textContent).toBe("4.00");
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
