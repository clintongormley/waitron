import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const model: VenueServiceView = {
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
      serviceMode: "table_tab",
    },
  ],
  routes: [],
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
    expect(text).toContain("11.00");
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
});
