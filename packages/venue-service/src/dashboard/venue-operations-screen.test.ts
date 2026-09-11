import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;
beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  for (const host of hosts.splice(0)) host.remove();
  history.replaceState(originalHistoryState, "", originalUrl);
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

function find(el: VenueOperationsScreen, selector: string): HTMLElement | null {
  function search(root: ParentNode): HTMLElement | null {
    const match = root.querySelector<HTMLElement>(selector);
    if (match) return match;
    for (const child of root.querySelectorAll("*")) {
      if (child.shadowRoot) {
        const found = search(child.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }
  return search(el.shadowRoot!);
}

async function settle(el: VenueOperationsScreen) {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function selectTab(el: VenueOperationsScreen, key: string) {
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!.click();
  await settle(el);
  await tabs.updateComplete;
}

async function action(el: VenueOperationsScreen, name: string) {
  const button = find(el, `[data-test="${name}"]`)!;
  expect(button, name).not.toBeNull();
  const menu = button.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await settle(el);
}

function field(el: VenueOperationsScreen, name: string) {
  return el.shadowRoot!.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
}
function table(el: VenueOperationsScreen, name: string) {
  const result = el.shadowRoot!.querySelector(`[data-test="${name}"]`)!;
  expect(result.tagName).toBe("WT-DATA-TABLE");
  return result;
}
function tableText(el: VenueOperationsScreen, name: string) {
  return table(el, name).shadowRoot!.querySelector("table")!.textContent!;
}
function summary(el: VenueOperationsScreen) {
  return el.shadowRoot!.querySelector("wt-form-error-summary")!.shadowRoot!.textContent!;
}

describe("venue operations screen", () => {
  it("shows a load error when the venue configuration request fails", async () => {
    const api = {
      load: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    expect(summary(el)).toContain("could not be loaded");
  });

  it("shows a summary and a message beside every missing required department field", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    await action(el, "save-editor");
    expect(summary(el)).toContain("problem with this form");
    expect(summary(el)).toContain("Department name");
    expect(summary(el)).toContain("Trading name");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="department-name"]')?.textContent,
    ).toContain("Department name");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="trading-name"]')?.textContent,
    ).toContain("Trading name");
    expect(api.createDepartment).not.toHaveBeenCalled();
  });

  it("uses localized weekday names", async () => {
    setLocale("es");
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(tableText(el, "hours")).toContain("Lunes");
    expect(tableText(el, "hours")).toContain("09:00");
    expect(tableText(el, "hours")).toContain("18:00");
    await action(el, "new-hours");
    expect(field(el, "hours-weekday").textContent).toContain("Domingo");
  });

  it("shows departments, trading names, zones, menu defaults and hours", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    expect(el.shadowRoot!.querySelector('[data-test="readiness-issue-0"]')!.textContent).toContain(
      "Negroni",
    );
    await selectTab(el, "departments");
    expect(tableText(el, "departments")).toContain("Restaurant and bar");
    expect(tableText(el, "departments")).toContain("Casa Delgado Deli");
    expect(tableText(el, "hours")).toContain("Monday");
    expect(tableText(el, "hours")).toContain("09:00");
    expect(tableText(el, "hours")).toContain("18:00");
    await selectTab(el, "menus");
    expect(tableText(el, "menus")).toContain("Deli takeaway");
    expect(tableText(el, "menu-offers-m1")).toContain("Negroni");
    expect(tableText(el, "menu-offers-m1")).toContain("11.00");
    await selectTab(el, "zones");
    expect(tableText(el, "zones")).toContain("Dining room");
    expect(tableText(el, "zones")).toContain("Deli counter");
    expect(tableText(el, "zones")).toContain("Casa Delgado");
    await action(el, "edit-zone-z1");
    expect(field(el, "zone-mode-z1").value).toBe("prepay");
  });

  it("deactivates a department that has no active zones", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "deactivate-department-d2");
    expect(api.deactivateDepartment).not.toHaveBeenCalled();
    await action(el, "save-editor");
    expect(api.deactivateDepartment).toHaveBeenCalledWith("d2");
  });

  it("shows a save error and prevents a second save while the first is pending", async () => {
    let rejectSave!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    });
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockReturnValue(pending),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "deactivate-department-d2");
    const button = find(el, '[data-test="save-editor"]')!;
    button.click();
    button.click();
    expect(api.deactivateDepartment).toHaveBeenCalledTimes(1);
    await el.updateComplete;
    expect(button.hasAttribute("disabled")).toBe(true);
    rejectSave(new Error("write failed"));
    await settle(el);
    expect(summary(el)).toContain("could not be saved");
    expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  });

  it("creates a second department from the required management fields", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-department");
    field(el, "department-name").value = "Events";
    field(el, "trading-name").value = "Casa Delgado Events";
    field(el, "department-mode").value = "invoice_first";
    await action(el, "save-editor");
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
    await selectTab(el, "menus");
    await action(el, "new-menu");
    field(el, "menu-name").value = "Upstairs cocktails";
    await action(el, "save-editor");
    expect(api.createMenu).toHaveBeenCalledWith("Upstairs cocktails");
    await action(el, "new-offer-m2");
    field(el, "offer-section-m2").value = "Cocktails";
    field(el, "offer-price-m2").value = "9.00";
    await action(el, "save-editor");
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
    await selectTab(el, "menus");
    await action(el, "new-offer-m2");
    field(el, "offer-section-m2").value = "Snacks";
    field(el, "offer-price-m2").value = "5.00";
    await action(el, "save-editor");
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
    await selectTab(el, "menus");
    table(el, "menu-offers-m1");
    await action(el, "edit-offer-i1");
    expect(field(el, "offer-price-i1").value).toBe("11.00");
    field(el, "offer-price-i1").value = "12.50";
    await action(el, "save-editor");
    expect(api.updateMenuItem).toHaveBeenCalledWith("m1", "i1", { grossPrice: "12.50" });
    await action(el, "remove-offer-i1");
    expect(api.deactivateMenuItem).not.toHaveBeenCalled();
    await action(el, "save-editor");
    expect(api.deactivateMenuItem).toHaveBeenCalledWith("m1", "i1");
  });

  it("routes a product exception for one zone", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createRoute: vi.fn().mockResolvedValue({ id: "r1" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "routing");
    await action(el, "new-route");
    field(el, "route-subject").value = "product:p1";
    field(el, "route-zone").value = "z1";
    field(el, "route-target").value = "s1";
    await action(el, "save-editor");
    expect(api.createRoute).toHaveBeenCalledWith({
      productId: "p1",
      zoneId: "z1",
      stationId: "s1",
    });
  });

  it("routes a category across all zones without preparation", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createRoute: vi.fn().mockResolvedValue({ id: "r2" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "routing");
    await action(el, "new-route");
    field(el, "route-subject").value = "category:c1";
    field(el, "route-zone").value = "";
    field(el, "route-target").value = "none";
    await action(el, "save-editor");
    expect(api.createRoute).toHaveBeenCalledWith({
      categoryId: "c1",
      zoneId: null,
      noPreparation: true,
    });
  });

  it("renders every readiness issue and both preparation-route shapes", async () => {
    const variedModel: VenueServiceView = {
      ...model,
      readiness: [
        { code: "venue.department_missing" },
        { code: "zone.department_missing", zoneId: "z1", zoneName: "Dining room" },
        { code: "zone.menu_missing", zoneId: "z2", zoneName: "Deli counter" },
        {
          code: "zone.menu_empty",
          zoneId: "z1",
          zoneName: "Dining room",
          menuId: "m1",
          menuName: "Casa Delgado",
        },
      ],
      routes: [
        {
          id: "r1",
          zoneId: null,
          categoryId: "c1",
          productId: null,
          stationId: null,
          noPreparation: true,
        },
        {
          id: "r2",
          zoneId: "z1",
          categoryId: null,
          productId: "p1",
          stationId: "s1",
          noPreparation: false,
        },
      ],
    };
    const el = await mount({
      load: vi.fn().mockResolvedValue(variedModel),
    } as unknown as VenueServiceApi);
    const text = el.shadowRoot!.querySelector('[data-test="readiness"]')!.textContent!;
    expect(text).toContain("Create an active department");
    expect(text).toContain("Dining room needs an active department");
    expect(text).toContain("Deli counter needs a default menu");
    expect(text).toContain("Casa Delgado has no products for Dining room");
    await selectTab(el, "routing");
    expect(tableText(el, "preparation-routes")).toContain("All service zones");
    expect(tableText(el, "preparation-routes")).toContain("No preparation");
    expect(tableText(el, "preparation-routes")).toContain("Negroni");
    expect(tableText(el, "preparation-routes")).toContain("Bar");
  });

  it("removes a preparation route from the shared data table", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deleteRoute: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "routing");
    table(el, "preparation-routes");
    await action(el, "remove-route-r1");
    expect(api.deleteRoute).not.toHaveBeenCalled();
    await action(el, "save-editor");
    expect(api.deleteRoute).toHaveBeenCalledWith("r1");
  });
});
it("shows five tabs, read-only tables, and creates departments in a cancellable modal", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    createDepartment: vi.fn(),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  expect(
    el.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
  ).toHaveLength(5);
  expect(
    el.shadowRoot!.querySelector('[data-test="readiness"]')!.getBoundingClientRect().height,
  ).toBeGreaterThan(0);
  await selectTab(el, "departments");
  const table = el.shadowRoot!.querySelector('[data-test="departments"]')!;
  expect(table.tagName).toBe("WT-DATA-TABLE");
  expect(table.shadowRoot!.querySelector("input")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  await action(el, "new-department");
  expect(el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open).toBe(
    true,
  );
  (el.shadowRoot!.querySelector('[name="department-name"]') as HTMLInputElement).value = "Draft";
  await action(el, "cancel-editor");
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(api.createDepartment).not.toHaveBeenCalled();
});

it("edits a department and retains its draft when saving fails", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    updateDepartment: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "edit-department-d2");
  expect(field(el, "department-name").value).toBe("Deli");
  expect(field(el, "trading-name").value).toBe("Casa Delgado Deli");
  expect(field(el, "department-mode").value).toBe("prepay");
  field(el, "department-name").value = "Takeaway";
  field(el, "trading-name").value = "Casa Delgado To Go";
  field(el, "department-mode").value = "ticket_then_pay";
  await action(el, "save-editor");
  expect(summary(el)).toContain("could not be saved");
  expect(field(el, "department-name").value).toBe("Takeaway");
  expect(field(el, "trading-name").value).toBe("Casa Delgado To Go");
  expect(field(el, "department-mode").value).toBe("ticket_then_pay");
  await action(el, "save-editor");
  expect(api.updateDepartment).toHaveBeenLastCalledWith("d2", {
    name: "Takeaway",
    tradingName: "Casa Delgado To Go",
    defaultServiceMode: "ticket_then_pay",
  });
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("edits a menu name without changing which menu owns its products", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    updateMenu: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "menus");
  await action(el, "edit-menu-m2");
  expect(field(el, "menu-name").value).toBe("Deli takeaway");
  field(el, "menu-name").value = "Deli lunch";
  await action(el, "save-editor");
  expect(api.updateMenu).toHaveBeenCalledWith("m2", "Deli lunch");
  await action(el, "products-m2");
  table(el, "menu-offers-m2");
  expect(el.shadowRoot!.querySelector('[data-test="menu-offers-m1"]')).toBeNull();
});

it("edits a preparation route from a category station to a product without preparation", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    updateRoute: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "routing");
  await action(el, "edit-route-r1");
  expect(field(el, "route-subject").value).toBe("category:c1");
  expect(field(el, "route-zone").value).toBe("z1");
  expect(field(el, "route-target").value).toBe("s1");
  field(el, "route-subject").value = "product:p1";
  field(el, "route-zone").value = "";
  field(el, "route-target").value = "none";
  await action(el, "save-editor");
  expect(api.updateRoute).toHaveBeenCalledWith("r1", {
    productId: "p1",
    zoneId: null,
    noPreparation: true,
  });
});

it("creates, edits and deletes hours while preserving other intervals in the department", async () => {
  const hoursModel: VenueServiceView = {
    ...model,
    hours: [
      ...model.hours,
      { departmentId: "d2", weekday: 2, opensAt: "10:00:00", closesAt: "19:00:00" },
      { departmentId: "d1", weekday: 1, opensAt: "12:00:00", closesAt: "23:00:00" },
    ],
  };
  const api = {
    load: vi.fn().mockResolvedValue(hoursModel),
    replaceHours: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "new-hours");
  field(el, "hours-department").value = "d2";
  field(el, "hours-weekday").value = "3";
  field(el, "hours-opens").value = "11:00";
  field(el, "hours-closes").value = "20:00";
  await action(el, "save-editor");
  expect(api.replaceHours).toHaveBeenLastCalledWith("d2", [
    { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
    { weekday: 2, opensAt: "10:00", closesAt: "19:00" },
    { weekday: 3, opensAt: "11:00", closesAt: "20:00" },
  ]);
  await action(el, "edit-hours-0");
  expect(field(el, "hours-department").value).toBe("d2");
  expect(field(el, "hours-department").disabled).toBe(true);
  expect(field(el, "hours-weekday").value).toBe("1");
  expect(field(el, "hours-opens").value).toBe("09:00");
  expect(field(el, "hours-closes").value).toBe("18:00");
  field(el, "hours-opens").value = "08:30";
  await action(el, "save-editor");
  expect(api.replaceHours).toHaveBeenLastCalledWith("d2", [
    { weekday: 2, opensAt: "10:00", closesAt: "19:00" },
    { weekday: 1, opensAt: "08:30", closesAt: "18:00" },
  ]);
  await action(el, "delete-hours-0");
  await action(el, "save-editor");
  expect(api.replaceHours).toHaveBeenLastCalledWith("d2", [
    { weekday: 2, opensAt: "10:00", closesAt: "19:00" },
  ]);
});

it("edits a zone policy and can return it to the department's service mode", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    configureZone: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "zones");
  await action(el, "edit-zone-z1");
  expect(field(el, "zone-department-z1").value).toBe("d1");
  expect(field(el, "zone-mode-z1").value).toBe("prepay");
  field(el, "zone-department-z1").value = "d2";
  field(el, "zone-mode-z1").value = "";
  await action(el, "save-editor");
  expect(api.configureZone).toHaveBeenCalledWith("z1", { departmentId: "d2", serviceMode: null });
  await action(el, "edit-zone-z2");
  field(el, "zone-department-z2").value = "d1";
  field(el, "zone-mode-z2").value = "invoice_first";
  await action(el, "save-editor");
  expect(api.configureZone).toHaveBeenLastCalledWith("z2", {
    departmentId: "d1",
    serviceMode: "invoice_first",
  });
});

it("creates and edits zone menu assignments and preserves a current default", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    allowMenu: vi.fn().mockResolvedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "zones");
  await action(el, "zone-menus-z1");
  expect(tableText(el, "zone-menus")).toContain("Casa Delgado");
  await action(el, "new-assignment-z1");
  expect(field(el, "assignment-menu").value).toBe("m2");
  expect(field(el, "assignment-menu").textContent).not.toContain("Casa Delgado");
  field(el, "assignment-order").value = "2";
  (field(el, "assignment-default") as HTMLInputElement).checked = true;
  await action(el, "save-editor");
  expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 2, makeDefault: true });
  await action(el, "edit-assignment-m1");
  expect(field(el, "assignment-menu").value).toBe("m1");
  expect(field(el, "assignment-menu").disabled).toBe(true);
  expect((field(el, "assignment-default") as HTMLInputElement).checked).toBe(true);
  expect(field(el, "assignment-default").disabled).toBe(true);
  field(el, "assignment-order").value = "3";
  await action(el, "save-editor");
  expect(api.allowMenu).toHaveBeenLastCalledWith("z1", "m1", {
    displayOrder: 3,
    makeDefault: true,
  });
});

it("closes a successfully saved editor when refreshing the list fails", async () => {
  const api = {
    load: vi.fn().mockResolvedValueOnce(model).mockRejectedValue(new Error("offline")),
    createDepartment: vi.fn().mockResolvedValue({ id: "d3" }),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "new-department");
  field(el, "department-name").value = "Events";
  field(el, "trading-name").value = "Casa Events";
  await action(el, "save-editor");
  expect(api.createDepartment).toHaveBeenCalledTimes(1);
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")!.shadowRoot!.textContent).toContain(
    "could not be loaded",
  );
});

it("ignores change events from controls inside a tab panel", async () => {
  const el = await mount({ load: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi);
  await selectTab(el, "menus");
  const url = location.href;
  const input = document.createElement("wt-input");
  input.name = "panel-filter";
  input.label = "Filter menus";
  el.shadowRoot!.querySelector('[slot="menus"]')!.append(input);
  await input.updateComplete;
  const native = input.shadowRoot!.querySelector("input")!;
  native.value = "search text";
  native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await settle(el);
  expect(location.href).toBe(url);
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("menus");
});

it("explains a duplicate route and keeps the edit open", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    updateRoute: vi.fn().mockRejectedValue({ code: "route.duplicate" }),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "routing");
  await action(el, "edit-route-r1");
  await action(el, "save-editor");
  expect(summary(el)).toContain("A route already exists");
  expect(field(el, "route-subject").value).toBe("category:c1");
});

it("explains why a department with active zones cannot be deactivated", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    deactivateDepartment: vi.fn().mockRejectedValue({ code: "department.has_active_zones" }),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "deactivate-department-d1");
  await action(el, "save-editor");
  expect(summary(el)).toContain("Move its active service zones");
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
});

it("updates venue rows from external changes without replacing a modal draft", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(structuredClone(model));
  const el = await mount({ load, liveData } as unknown as VenueServiceApi);
  await selectTab(el, "departments");
  await action(el, "edit-department-d2");
  field(el, "department-name").value = "Unsaved";
  const updated = structuredClone(model);
  updated.departments[0]!.name = "Updated elsewhere";
  load.mockResolvedValue(updated);
  liveData.invalidate([{ type: "departments", id: "d1" }]);
  await vi.waitFor(() => expect(tableText(el, "departments")).toContain("Updated elsewhere"));
  expect(field(el, "department-name").value).toBe("Unsaved");
});
