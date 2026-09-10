import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  for (const host of hosts.splice(0)) host.remove();
});

const model: VenueServiceView = {
  readiness: [
    {
      code: "zone.route_missing",
      zoneId: "z1",
      zoneName: "Dining room",
      productId: "p1",
      productName: "Negroni",
    },
  ],
  departments: [
    {
      id: "d1",
      name: "Restaurant and bar",
      tradingName: "Casa Delgado",
      defaultServiceMode: "table_tab",
      active: true,
    },
    {
      id: "d2",
      name: "Deli",
      tradingName: "Casa Delgado Deli",
      defaultServiceMode: "prepay",
      active: true,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Dining room",
      departmentId: "d1",
      departmentName: "Restaurant and bar",
      serviceMode: "prepay",
      serviceModeOverride: "prepay",
    },
  ],
  routes: [
    {
      id: "r1",
      zoneId: "z1",
      categoryId: "c1",
      productId: null,
      stationId: "s1",
      noPreparation: false,
    },
  ],
  hours: [{ departmentId: "d2", weekday: 1, opensAt: "09:00:00", closesAt: "18:00:00" }],
  zoneMenus: [{ zoneId: "z1", menuId: "m1", displayOrder: 0, isDefault: true }],
  menus: [
    { id: "m1", name: "Casa Delgado", active: true },
    { id: "m2", name: "Deli takeaway", active: true },
  ],
  categories: [{ id: "c1", name: "Cocktails" }],
  stations: [{ id: "s1", name: "Bar" }],
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Deli counter" },
  ],
  products: [{ id: "p1", descriptions: { en: "Negroni" }, pricingUnit: "each", active: true }],
  offers: [
    {
      id: "i1",
      menuId: "m1",
      productId: "p1",
      sectionId: "sec1",
      sectionName: { en: "Cocktails" },
      descriptions: { en: "Negroni" },
      grossPrice: "11.00",
    },
  ],
};

async function mount(api: VenueServiceApi): Promise<VenueOperationsScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
  el.api = api;
  host.appendChild(el);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return el;
}

describe("venue operations screen", () => {
  it("shows a summary and a message beside every missing required department field", async () => {
    const api = { load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi;
    const el = await mount(api);

    (el.shadowRoot!.querySelector('[data-test="add-department"]') as HTMLElement).click();
    await el.updateComplete;

    const summary = el.shadowRoot!.querySelector("wt-form-error-summary")!;
    expect(summary.shadowRoot!.textContent).toContain("problem with this form");
    expect(summary.shadowRoot!.textContent).toContain("Department name");
    expect(summary.shadowRoot!.textContent).toContain("Trading name");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="department-name"]')?.textContent,
    ).toContain("Department name");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="trading-name"]')?.textContent,
    ).toContain("Trading name");
  });

  it("uses localized weekday names", async () => {
    setLocale("es");
    const api = { load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi;
    const el = await mount(api);
    expect(el.shadowRoot!.textContent).toContain("Lunes 09:00–18:00");
    expect(el.shadowRoot!.querySelector('[name="hours-weekday"]')?.textContent).toContain(
      "Domingo",
    );
  });

  it("shows departments, trading names, zones, menu defaults and hours", async () => {
    const api = { load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi;
    const el = await mount(api);
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("Restaurant and bar");
    expect(text).toContain("Casa Delgado Deli");
    expect(text).toContain("Deli counter");
    expect(text).toContain("Deli takeaway");
    expect(text).toContain("Monday 09:00–18:00");
    expect(text).toContain("Negroni");
    expect(
      (
        el
          .shadowRoot!.querySelector('[data-test="menu-offers-m1"]')!
          .shadowRoot!.querySelector('[name="offer-price-i1"]') as HTMLInputElement
      ).value,
    ).toBe("11.00");
    expect(text).toContain("Dining room");
    expect(
      el.shadowRoot!.querySelector('[name="zone-mode-z1"]') as HTMLSelectElement,
    ).toHaveProperty("value", "prepay");
    expect(el.shadowRoot!.querySelector('[data-test="readiness-issue-0"]')!.textContent).toContain(
      "Negroni",
    );
  });

  it("deactivates a department that has no active zones", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    (el.shadowRoot!.querySelector('[data-test="deactivate-department-d2"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.deactivateDepartment).toHaveBeenCalledWith("d2");
  });

  it("creates a second department from the required management fields", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    (el.shadowRoot!.querySelector('[name="department-name"]') as HTMLInputElement).value = "Events";
    (el.shadowRoot!.querySelector('[name="trading-name"]') as HTMLInputElement).value =
      "Casa Delgado Events";
    (el.shadowRoot!.querySelector('[name="department-mode"]') as HTMLSelectElement).value =
      "invoice_first";
    (el.shadowRoot!.querySelector('[data-test="add-department"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.createDepartment).toHaveBeenCalledWith({
      name: "Events",
      tradingName: "Casa Delgado Events",
      defaultServiceMode: "invoice_first",
    });
  });

  it("creates a menu and adds an existing product with a menu-specific price", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createMenu: vi.fn().mockResolvedValue({ id: "m3" }),
      createMenuSection: vi.fn().mockResolvedValue({ id: "sec2" }),
      createMenuItem: vi.fn().mockResolvedValue({ id: "i2" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);

    (el.shadowRoot!.querySelector('[name="menu-name"]') as HTMLInputElement).value =
      "Upstairs cocktails";
    (el.shadowRoot!.querySelector('[data-test="add-menu"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.createMenu).toHaveBeenCalledWith("Upstairs cocktails");

    const deli = el.shadowRoot!.querySelector('[data-menu="m2"]')!;
    (deli.querySelector('[name="offer-section-m2"]') as HTMLInputElement).value = "Cocktails";
    (deli.querySelector('[name="offer-price-m2"]') as HTMLInputElement).value = "9.00";
    (deli.querySelector("wt-button:last-of-type") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.createMenuSection).toHaveBeenCalledWith("m2", {
      name: { en: "Cocktails", es: "Cocktails" },
      displayOrder: 0,
    });
    expect(api.createMenuItem).toHaveBeenCalledWith("m2", {
      productId: "p1",
      sectionId: "sec2",
      grossPrice: "9.00",
      displayOrder: 0,
    });
  });

  it("reuses an existing named section when adding another product", async () => {
    const sectionModel: VenueServiceView = {
      ...model,
      products: [
        ...model.products,
        { id: "p2", descriptions: { en: "Olives" }, pricingUnit: "each", active: true },
      ],
      offers: [
        ...model.offers,
        {
          id: "i2",
          menuId: "m2",
          productId: "p2",
          sectionId: "sec2",
          sectionName: { en: "Snacks" },
          descriptions: { en: "Olives" },
          grossPrice: "4.00",
        },
      ],
    };
    const api = {
      load: vi.fn().mockResolvedValue(sectionModel),
      createMenuSection: vi.fn(),
      createMenuItem: vi.fn().mockResolvedValue({ id: "i3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const deli = el.shadowRoot!.querySelector('[data-menu="m2"]')!;
    (deli.querySelector('[name="offer-section-m2"]') as HTMLInputElement).value = "Snacks";
    (deli.querySelector('[name="offer-price-m2"]') as HTMLInputElement).value = "5.00";
    (deli.querySelector("wt-button:last-of-type") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.createMenuSection).not.toHaveBeenCalled();
    expect(api.createMenuItem).toHaveBeenCalledWith("m2", {
      productId: "p1",
      sectionId: "sec2",
      grossPrice: "5.00",
      displayOrder: 0,
    });
  });

  it("edits and removes an offer from the shared data table", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      deactivateMenuItem: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const table = el.shadowRoot!.querySelector('[data-test="menu-offers-m1"]');
    expect(table?.tagName).toBe("WT-DATA-TABLE");
    const price = table!.shadowRoot!.querySelector('[name="offer-price-i1"]') as HTMLInputElement;
    price.value = "12.50";
    (table!.shadowRoot!.querySelector('[data-test="save-offer-i1"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.updateMenuItem).toHaveBeenCalledWith("m1", "i1", { grossPrice: "12.50" });

    (table!.shadowRoot!.querySelector('[data-test="remove-offer-i1"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.deactivateMenuItem).toHaveBeenCalledWith("m1", "i1");
  });

  it("routes a product exception for one zone", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createRoute: vi.fn().mockResolvedValue({ id: "r1" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    (el.shadowRoot!.querySelector('[name="route-subject"]') as HTMLSelectElement).value =
      "product:p1";
    (el.shadowRoot!.querySelector('[name="route-zone"]') as HTMLSelectElement).value = "z1";
    (el.shadowRoot!.querySelector('[name="route-target"]') as HTMLSelectElement).value = "s1";
    (el.shadowRoot!.querySelector('[data-test="add-route"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.createRoute).toHaveBeenCalledWith({
      productId: "p1",
      zoneId: "z1",
      stationId: "s1",
    });
  });

  it("removes a preparation route from the shared data table", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deleteRoute: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    const table = el.shadowRoot!.querySelector('[data-test="preparation-routes"]')!;
    expect(table.tagName).toBe("WT-DATA-TABLE");
    (table.shadowRoot!.querySelector('[data-test="remove-route-r1"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.deleteRoute).toHaveBeenCalledWith("r1");
  });
});
