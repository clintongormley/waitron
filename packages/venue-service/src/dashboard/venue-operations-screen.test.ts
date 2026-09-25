import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;
beforeEach(() => {
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});
afterEach(() => {
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
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
  categories: [{ id: "c1", name: { en: "Cocktails" } }],
  stations: [{ id: "s1", name: "Bar" }],
  floorZones: [
    { id: "z1", name: "Dining room" },
    { id: "z2", name: "Deli counter" },
  ],
  products: [
    {
      id: "p1",
      name: "Negroni",
      customerName: { en: "House Aperitivo" },
      pricingUnit: "each",
      unitPrice: "10.00",
      active: true,
      variants: [
        {
          id: "v1",
          name: "Double",
          customerName: { en: "Generous Pour" },
          unitPrice: "13.00",
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
      name: "Negroni",
      customerName: { en: "House Aperitivo" },
      grossPrice: "11.00",
      unitPrice: "11.00",
      active: true,
      placements: [[]],
      topLevelMember: { sectionId: "root-m1", memberId: "member-p1" },
      variants: [
        {
          id: "v1",
          name: "Double",
          customerName: { en: "Generous Pour" },
          unitPrice: "15.00",
          menuPrice: "15.00",
          offered: true,
          available: true,
        },
      ],
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
function input(el: VenueOperationsScreen, name: string) {
  return el.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
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
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i2" }),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-menu");
    field(el, "menu-name").value = "Upstairs cocktails";
    await action(el, "save-editor");
    expect(api.createMenu).toHaveBeenCalledWith("Upstairs cocktails");
    await action(el, "new-offer-m2");
    field(el, "offer-price-m2").value = "9.00";
    await action(el, "save-editor");
    expect(api.addProductToMenu).toHaveBeenCalledWith("m2", {
      productId: "p1",
      grossPrice: "9.00",
    });
    // A new offer overrides nothing: every variant follows the product onto the menu.
    expect(api.setMenuVariants).toHaveBeenCalledWith("m2", "i2", [
      { variantId: "v1", price: null, offered: true },
    ]);
  });

  it("shows the staff name, never the customer-facing one, on every product surface", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "menus");
    expect(tableText(el, "menu-offers-m1")).toContain("Negroni");
    expect(tableText(el, "menu-offers-m1")).not.toContain("House Aperitivo");
    await action(el, "edit-offer-i1");
    // The variant's price field is labelled with the variant's staff name, whole, not its first letter.
    expect(field(el, "offer-variant-price-v1").closest("label")!.textContent).toContain("Double");
    expect(field(el, "offer-variant-price-v1").closest("label")!.textContent).not.toContain(
      "Generous Pour",
    );
    await action(el, "cancel-editor");
    await selectTab(el, "routing");
    await action(el, "new-route");
    expect(field(el, "route-subject").textContent).toContain("Negroni");
    expect(field(el, "route-subject").textContent).not.toContain("House Aperitivo");
  });

  // Two products whose staff name, customer-facing name and variant set all differ, so an assertion
  // can tell which product a saved offer and its variants belong to. Bravas is already on
  // menu m1, which is what takes it out of that menu's dropdown.
  const twoProductModel: VenueServiceView = {
    ...model,
    products: [
      {
        id: "p-bravas",
        name: "Bravas",
        customerName: { en: "Patatas bravas" },
        pricingUnit: "each",
        unitPrice: "5.00",
        active: true,
        variants: [
          {
            id: "v-half",
            name: "Half portion",
            customerName: { en: "Media racion" },
            unitPrice: "4.00",
            available: true,
            active: true,
          },
          {
            id: "v-full",
            name: "Full portion",
            customerName: { en: "Racion" },
            unitPrice: "7.00",
            available: true,
            active: true,
          },
        ],
      },
      {
        id: "p-lentils",
        name: "Stewed lentils",
        customerName: { en: "Lentejas de la casa" },
        pricingUnit: "each",
        unitPrice: "6.00",
        active: true,
        variants: [
          {
            id: "v-bowl",
            name: "Bowl",
            customerName: { en: "Cuenco" },
            unitPrice: "6.50",
            available: false,
            active: true,
          },
        ],
      },
    ],
    offers: [
      {
        id: "i-bravas",
        menuId: "m1",
        productId: "p-bravas",
        name: "Bravas",
        customerName: { en: "Patatas bravas" },
        grossPrice: "5.00",
        unitPrice: "5.00",
        active: true,
        placements: [[]],
        topLevelMember: { sectionId: "root-m1", memberId: "member-bravas" },
        variants: [],
      },
    ],
  };

  it("offers every variant of the product a new offer is saved for, dropdown untouched", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(twoProductModel),
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i-lentils" }),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-offer-m1");
    // Nobody touches the dropdown: the product it shows is the one the fieldset and the save use.
    expect(field(el, "offer-product-m1").value).toBe("p-lentils");
    expect(field(el, "offer-product-m1").textContent).not.toContain("Bravas");
    // Left empty, with the variant's own price as the hint: nothing is overridden yet.
    expect(field(el, "offer-variant-price-v-bowl").value).toBe("");
    expect(input(el, "offer-variant-price-v-bowl").placeholder).toBe("6.50");
    expect((field(el, "offer-variant-offered-v-bowl") as HTMLInputElement).checked).toBe(true);
    expect(el.shadowRoot!.querySelector('[name="offer-variant-price-v-half"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[name="offer-variant-price-v-full"]')).toBeNull();
    field(el, "offer-price-m1").value = "8.00";
    await action(el, "save-editor");
    expect(api.addProductToMenu).toHaveBeenCalledWith("m1", {
      productId: "p-lentils",
      grossPrice: "8.00",
    });
    expect(api.setMenuVariants).toHaveBeenCalledWith("m1", "i-lentils", [
      { variantId: "v-bowl", price: null, offered: true },
    ]);
  });

  it("creates an offer with no menu price, hinting the picked product's own price", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(twoProductModel),
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i-new" }),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-offer-m2");
    expect(field(el, "offer-price-m2").value).toBe("");
    expect(input(el, "offer-price-m2").placeholder).toBe("5.00");
    const select = field(el, "offer-product-m2") as HTMLSelectElement;
    select.value = "p-lentils";
    select.dispatchEvent(new Event("change"));
    await settle(el);
    expect(input(el, "offer-price-m2").placeholder).toBe("6.00");
    await action(el, "save-editor");
    expect(api.addProductToMenu).toHaveBeenCalledWith("m2", {
      productId: "p-lentils",
      grossPrice: null,
    });
  });

  it("follows the dropdown to the picked product's variants", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(twoProductModel),
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i-new" }),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-offer-m2");
    expect(field(el, "offer-product-m2").value).toBe("p-bravas");
    expect(input(el, "offer-variant-price-v-half").placeholder).toBe("4.00");
    const select = field(el, "offer-product-m2") as HTMLSelectElement;
    select.value = "p-lentils";
    select.dispatchEvent(new Event("change"));
    await settle(el);
    expect(input(el, "offer-variant-price-v-bowl").placeholder).toBe("6.50");
    expect(el.shadowRoot!.querySelector('[name="offer-variant-price-v-half"]')).toBeNull();
    field(el, "offer-price-m2").value = "8.00";
    await action(el, "save-editor");
    expect(api.addProductToMenu).toHaveBeenCalledWith("m2", {
      productId: "p-lentils",
      grossPrice: "8.00",
    });
    expect(api.setMenuVariants).toHaveBeenCalledWith("m2", "i-new", [
      { variantId: "v-bowl", price: null, offered: true },
    ]);
  });

  it("shows a refused variant override on the form, not only in the console", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(twoProductModel),
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i-lentils" }),
      setMenuVariants: vi
        .fn()
        .mockRejectedValue({ code: "product.variant_not_found", status: 400 }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-offer-m1");
    field(el, "offer-price-m1").value = "8.00";
    await action(el, "save-editor");
    expect(api.setMenuVariants).toHaveBeenCalledTimes(1);
    expect(summary(el)).toContain("could not be saved");
    expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  });

  it("asks for a product when the menu already offers every one of them", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...twoProductModel,
        products: [twoProductModel.products[0]!],
      }),
      addProductToMenu: vi.fn(),
      setMenuVariants: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-offer-m1");
    expect(field(el, "offer-product-m1").value).toBe("");
    expect(el.shadowRoot!.querySelector('[name="offer-variant-price-v-half"]')).toBeNull();
    field(el, "offer-price-m1").value = "8.00";
    await action(el, "save-editor");
    expect(api.addProductToMenu).not.toHaveBeenCalled();
    expect(api.setMenuVariants).not.toHaveBeenCalled();
    expect(summary(el)).toContain("Product");
    expect(el.shadowRoot!.querySelector('[data-field-error="offer-product-m1"]')).not.toBeNull();
  });
  it("clears a variant's menu price and switches it off on this menu", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "edit-offer-i1");
    field(el, "offer-variant-price-v1").value = "";
    (field(el, "offer-variant-offered-v1") as HTMLInputElement).checked = false;
    await action(el, "save-editor");
    expect(api.setMenuVariants).toHaveBeenCalledWith("m1", "i1", [
      { variantId: "v1", price: null, offered: false },
    ]);
  });

  it("hints the parent's price on this menu for a variant with no price of its own", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        products: [
          {
            ...model.products[0]!,
            variants: [
              {
                id: "v1",
                name: "Double",
                customerName: { en: "Generous Pour" },
                unitPrice: null,
                available: true,
                active: true,
              },
              // Removed from the product: never listed on a menu.
              {
                id: "v-gone",
                name: "Triple",
                customerName: null,
                unitPrice: "20.00",
                available: true,
                active: false,
              },
            ],
          },
        ],
        offers: [{ ...model.offers[0]!, variants: [] }],
      }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "edit-offer-i1");
    expect(field(el, "offer-variant-price-v1").value).toBe("");
    expect(input(el, "offer-variant-price-v1").placeholder).toBe("11.00");
    // Typing a new price for the parent on this menu moves the hint with it.
    field(el, "offer-price-i1").value = "12.50";
    field(el, "offer-price-i1").dispatchEvent(new Event("input"));
    await settle(el);
    expect(input(el, "offer-variant-price-v1").placeholder).toBe("12.50");
    expect(el.shadowRoot!.querySelector('[name="offer-variant-price-v-gone"]')).toBeNull();
  });

  // The product's own price (10.00), the menu's stored price (blank) and every other price in play
  // differ, so a field hinting or listing the wrong one fails.
  const blankPriceModel: VenueServiceView = {
    ...model,
    products: [
      {
        ...model.products[0]!,
        variants: [{ ...model.products[0]!.variants![0]!, unitPrice: null }],
      },
    ],
    offers: [{ ...model.offers[0]!, grossPrice: null, unitPrice: "10.00", variants: [] }],
  };

  it("leaves a blank menu price empty, hints the product's own price, and keeps it blank", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(blankPriceModel),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    // The list shows the price the offer is charged at, never an empty cell.
    expect(tableText(el, "menu-offers-m1")).toContain("10.00");
    await action(el, "edit-offer-i1");
    expect(field(el, "offer-price-i1").value).toBe("");
    expect(input(el, "offer-price-i1").placeholder).toBe("10.00");
    // Optional, so neither required nor marked as required.
    expect(field(el, "offer-price-i1").hasAttribute("required")).toBe(false);
    expect(field(el, "offer-price-i1").closest("label")!.querySelector(".required")).toBeNull();
    // A placeholder reads like a value, so the form also says what an empty price means, and the
    // input is described by that line: the id it names resolves to the hint itself.
    const describedBy = field(el, "offer-price-i1").getAttribute("aria-describedby")!;
    expect(el.shadowRoot!.getElementById(describedBy)?.textContent).toContain(
      "Leave the price empty to charge the product's own price.",
    );
    // A variant with no price of its own falls to the parent's RESOLVED price here.
    expect(input(el, "offer-variant-price-v1").placeholder).toBe("10.00");
    await action(el, "save-editor");
    expect(api.updateMenuItem).toHaveBeenCalledWith("m1", "i1", { grossPrice: null });
  });

  it("saves a cleared menu price as blank, moving the variant hint to the product's price", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...blankPriceModel,
        offers: [{ ...model.offers[0]!, variants: [] }],
      }),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "edit-offer-i1");
    expect(field(el, "offer-price-i1").value).toBe("11.00");
    expect(input(el, "offer-variant-price-v1").placeholder).toBe("11.00");
    field(el, "offer-price-i1").value = "";
    field(el, "offer-price-i1").dispatchEvent(new Event("input"));
    await settle(el);
    expect(input(el, "offer-variant-price-v1").placeholder).toBe("10.00");
    await action(el, "save-editor");
    expect(api.updateMenuItem).toHaveBeenCalledWith("m1", "i1", { grossPrice: null });
  });

  it("refuses a malformed offer price beside its field", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      setMenuVariants: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "edit-offer-i1");
    field(el, "offer-price-i1").value = "1.234";
    await action(el, "save-editor");
    expect(api.updateMenuItem).not.toHaveBeenCalled();
    expect(summary(el)).toContain("Enter a non-negative price with up to two decimal places.");
    expect(el.shadowRoot!.querySelector('[data-field-error="offer-price-i1"]')).not.toBeNull();
  });

  it("refuses a malformed variant price beside its field", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      setMenuVariants: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "edit-offer-i1");
    field(el, "offer-variant-price-v1").value = "1.234";
    await action(el, "save-editor");
    expect(api.setMenuVariants).not.toHaveBeenCalled();
    expect(summary(el)).toContain("Enter a non-negative price with up to two decimal places.");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="offer-variant-price-v1"]'),
    ).not.toBeNull();
  });

  it("edits an offer and removes it from the menu's top level", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
      removeMenuMember: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    table(el, "menu-offers-m1");
    await action(el, "edit-offer-i1");
    expect(field(el, "offer-price-i1").value).toBe("11.00");
    // The menu's own price for the variant, with the variant's own price as the hint beneath it.
    expect(field(el, "offer-variant-price-v1").value).toBe("15.00");
    expect(input(el, "offer-variant-price-v1").placeholder).toBe("13.00");
    field(el, "offer-price-i1").value = "12.50";
    field(el, "offer-variant-price-v1").value = "16.50";
    await action(el, "save-editor");
    expect(api.setMenuVariants).toHaveBeenCalledWith("m1", "i1", [
      { variantId: "v1", price: "16.50", offered: true },
    ]);
    expect(api.updateMenuItem).toHaveBeenCalledWith("m1", "i1", { grossPrice: "12.50" });
    expect(find(el, '[data-test="switch-offer-i1"]')).toBeNull();
    await action(el, "remove-offer-i1");
    expect(api.removeMenuMember).not.toHaveBeenCalled();
    // Only the top level holds it, so taking it off clears what this menu set for it.
    expect(modal(el)!.textContent).toContain("Its menu price and variant settings are cleared.");
    await action(el, "save-editor");
    expect(api.removeMenuMember).toHaveBeenCalledWith("root-m1", "member-p1");
    expect(api.updateMenuItem).toHaveBeenCalledTimes(1);
  });

  it("adds a product again after it was removed from the menu's top level", async () => {
    const removed: VenueServiceView = { ...model, offers: [] };
    const api = {
      load: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(removed),
      removeMenuMember: vi.fn().mockResolvedValue(undefined),
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i1" }),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "remove-offer-i1");
    await action(el, "save-editor");
    expect(api.removeMenuMember).toHaveBeenCalledWith("root-m1", "member-p1");
    await settle(el);
    expect(table(el, "menu-offers-m1").shadowRoot!.textContent).not.toContain("Negroni");
    expect(table(el, "menu-offers-m1").shadowRoot!.textContent).toContain("No entries yet.");
    await action(el, "new-offer-m1");
    expect(field(el, "offer-product-m1").value).toBe("p1");
    await action(el, "save-editor");
    expect(api.addProductToMenu).toHaveBeenCalledWith("m1", { productId: "p1", grossPrice: null });
    expect(api.setMenuVariants).toHaveBeenCalledWith("m1", "i1", [
      { variantId: "v1", price: null, offered: true },
    ]);
    expect(modal(el)).toBeNull();
  });

  // Negroni sits on the top level AND in Cocktails; Olives only in Cocktails, switched off here.
  const nestedModel: VenueServiceView = {
    ...model,
    products: [
      ...model.products,
      {
        id: "p2",
        name: "Olives",
        customerName: { en: "Manzanilla Olives" },
        pricingUnit: "each",
        unitPrice: "3.00",
        active: true,
      },
    ],
    offers: [
      { ...model.offers[0]!, placements: [[], ["sec-cocktails"]] },
      {
        id: "i2",
        menuId: "m1",
        productId: "p2",
        name: "Olives",
        customerName: { en: "Manzanilla Olives" },
        grossPrice: null,
        unitPrice: "3.00",
        active: false,
        placements: [["sec-cocktails"]],
        topLevelMember: null,
        variants: [],
      },
    ],
  };

  it("says where each product sits, and whether it is switched off on this menu", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(nestedModel),
    } as unknown as VenueServiceApi);
    await selectTab(el, "menus");
    const rows = [...table(el, "menu-offers-m1").shadowRoot!.querySelectorAll("tbody tr")].map(
      (row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent!.trim()),
    );
    expect(rows.map((cells) => cells.slice(0, 1).concat(cells.slice(2, 4)))).toEqual([
      ["Negroni", "Top level and in a section", "On"],
      ["Olives", "In a section", "Switched off"],
    ]);
  });

  it("switches a product reached through a section off and on, and never removes it", async () => {
    const on: VenueServiceView = {
      ...nestedModel,
      offers: [nestedModel.offers[0]!, { ...nestedModel.offers[1]!, active: true }],
    };
    const api = {
      load: vi.fn().mockResolvedValueOnce(on).mockResolvedValue(nestedModel),
      updateMenuItem: vi.fn().mockResolvedValue(undefined),
      removeMenuMember: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    expect(find(el, '[data-test="remove-offer-i2"]')).toBeNull();
    expect(find(el, '[data-test="switch-offer-i2"]')!.textContent).toContain(
      "Switch off on this menu",
    );
    await action(el, "switch-offer-i2");
    expect(api.updateMenuItem).toHaveBeenCalledWith("m1", "i2", { active: false });
    await settle(el);
    expect(find(el, '[data-test="switch-offer-i2"]')!.textContent).toContain(
      "Switch back on for this menu",
    );
    await action(el, "switch-offer-i2");
    expect(api.updateMenuItem).toHaveBeenLastCalledWith("m1", "i2", { active: true });
    expect(api.removeMenuMember).not.toHaveBeenCalled();
  });

  // A real click lets the screen re-render between its own click handler and the menu's: the
  // save it starts disables every action, which the menu must not read as a disabled click.
  it.each([
    ["menus", "switch-offer-i2"],
    ["zones", "default-assignment-m2"],
  ])("closes the row menu when a %s action saves straight away", async (tab, key) => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...nestedModel,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
        ],
      }),
      // Still in flight, as a real request is while the menu decides whether to close.
      updateMenuItem: vi.fn(() => new Promise(() => {})),
      allowMenu: vi.fn(() => new Promise(() => {})),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, tab);
    if (tab === "zones") await action(el, "zone-menus-z1");
    const button = find(el, `[data-test="${key}"]`)!;
    const menu = button.closest("wt-row-actions")!;
    const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    expect(popup.matches(":popover-open")).toBe(true);
    await userEvent.click(button);
    await settle(el);
    expect(
      vi.mocked(api.updateMenuItem).mock.calls.length + vi.mocked(api.allowMenu).mock.calls.length,
    ).toBe(1);
    expect(popup.matches(":popover-open")).toBe(false);
  });

  it("says a product removed from the top level stays on the menu through its section", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(nestedModel),
      removeMenuMember: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "remove-offer-i1");
    expect(modal(el)!.textContent).toContain("It stays on this menu through its section.");
    expect(modal(el)!.textContent).not.toContain("cleared");
    await action(el, "save-editor");
    expect(api.removeMenuMember).toHaveBeenCalledWith("root-m1", "member-p1");
  });

  it("adds a product with no variants without carrying another product's variants", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        products: [
          ...model.products,
          {
            id: "p2",
            name: "Olives",
            customerName: { en: "Manzanilla Olives" },
            pricingUnit: "each",
            unitPrice: "3.00",
            active: true,
          },
        ],
      }),
      addProductToMenu: vi.fn().mockResolvedValue({ id: "i2" }),
      setMenuVariants: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-offer-m1");
    expect(field(el, "offer-product-m1").value).toBe("p2");
    field(el, "offer-price-m1").value = "5.00";
    await action(el, "save-editor");
    expect(api.addProductToMenu).toHaveBeenCalledWith("m1", {
      productId: "p2",
      grossPrice: "5.00",
    });
    // Olives has no variants of its own, so the menu overrides nothing — least of all for the
    // Negroni variant the same model carries.
    expect(api.setMenuVariants).toHaveBeenCalledWith("m1", "i2", []);
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

describe("the menu offers list's price cell", () => {
  // The product's own price (10.00), its variant's price (13.00), the menu's price (11.00) and the
  // variant's menu price (15.00) all differ, so a cell reading the wrong one fails.
  function offerModel(
    offer: Partial<VenueServiceView["offers"][number]>,
    products = model.products,
  ) {
    return { ...model, products, offers: [{ ...model.offers[0]!, ...offer }] };
  }
  async function priceCell(view: VenueServiceView) {
    const el = await mount({ load: vi.fn().mockResolvedValue(view) } as unknown as VenueServiceApi);
    await selectTab(el, "menus");
    const root = table(el, "menu-offers-m1").shadowRoot!;
    const header = root.querySelector('[data-sort="price"]')!.closest("th")!;
    const column = [...root.querySelectorAll("thead th")].indexOf(header);
    expect(column).toBeGreaterThanOrEqual(0);
    const cell = root.querySelectorAll("tbody tr")[0]!.querySelectorAll("td")[column]!;
    return { el, cell };
  }
  function visibleText(node: Element) {
    const clone = node.cloneNode(true) as Element;
    for (const hidden of clone.querySelectorAll('[part~="visually-hidden"]')) hidden.remove();
    return clone.textContent!.replace(/\s+/g, " ").trim();
  }
  // Hidden text a screen reader reads must still be clipped out of sight, not merely marked.
  function expectClipped(hidden: Element) {
    const style = getComputedStyle(hidden);
    expect([style.position, style.width, style.height, style.overflow, style.clip]).toEqual([
      "absolute",
      "1px",
      "1px",
      "hidden",
      "rect(0px, 0px, 0px, 0px)",
    ]);
  }

  it("strikes out the product's own price beside a menu price that differs from it", async () => {
    const { cell } = await priceCell(offerModel({ grossPrice: "11.00", unitPrice: "11.00" }));
    const struck = cell.querySelector("s")!;
    expect(struck.textContent!.trim()).toBe("10.00");
    expect(getComputedStyle(struck).textDecorationLine).toBe("line-through");
    expect(visibleText(cell)).toBe("10.00 11.00");
    // A strikethrough alone says nothing to a screen reader.
    const hidden = cell.querySelector('[part~="visually-hidden"]')!;
    expect(hidden.textContent!.trim()).toBe("Was");
    expectClipped(hidden);
    expect(cell.querySelector('[part~="price-inherited"]')).toBeNull();
  });

  it("greys out a blank menu price, which charges the product's own price", async () => {
    const { el, cell } = await priceCell(offerModel({ grossPrice: null, unitPrice: "10.00" }));
    const inherited = cell.querySelector<HTMLElement>('[part~="price-inherited"]')!;
    expect(visibleText(inherited)).toBe("10.00");
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    el.parentElement!.append(probe);
    expect(getComputedStyle(inherited).color).toBe(getComputedStyle(probe).color);
    expect(getComputedStyle(inherited).color).not.toBe(getComputedStyle(cell).color);
    const hidden = inherited.querySelector('[part~="visually-hidden"]')!;
    expect(hidden.textContent!.trim()).toBe("(product's own price)");
    expectClipped(hidden);
    expect(cell.querySelector("s")).toBeNull();
  });

  it("shows a menu price equal to the product's own price plainly", async () => {
    const { cell } = await priceCell(offerModel({ grossPrice: "10.00", unitPrice: "10.00" }));
    expect(visibleText(cell)).toBe("10.00");
    expect(cell.querySelector("s")).toBeNull();
    expect(cell.querySelector('[part~="price-inherited"]')).toBeNull();
    expect(cell.querySelector('[part~="visually-hidden"]')).toBeNull();
  });

  it("shows a price the menu sets plainly when the product is not in the loaded list", async () => {
    const { cell } = await priceCell(offerModel({ grossPrice: "11.00", unitPrice: "11.00" }, []));
    expect(visibleText(cell)).toBe("11.00");
    expect(cell.querySelector("s")).toBeNull();
  });

  it("still greys out a blank menu price when the product is not in the loaded list", async () => {
    const { cell } = await priceCell(offerModel({ grossPrice: null, unitPrice: "10.00" }, []));
    const inherited = cell.querySelector('[part~="price-inherited"]')!;
    expect(visibleText(inherited)).toBe("10.00");
    expect(inherited.querySelector('[part~="visually-hidden"]')!.textContent!.trim()).toBe(
      "(product's own price)",
    );
  });

  it("announces the struck and inherited prices in Spanish", async () => {
    setLocale("es");
    const struck = await priceCell(offerModel({ grossPrice: "11.00", unitPrice: "11.00" }));
    expect(struck.cell.querySelector('[part~="visually-hidden"]')!.textContent!.trim()).toBe(
      "Antes",
    );
    const inherited = await priceCell(offerModel({ grossPrice: null, unitPrice: "10.00" }));
    expect(inherited.cell.querySelector('[part~="visually-hidden"]')!.textContent!.trim()).toBe(
      "(precio propio del producto)",
    );
  });

  it("sorts by the price charged, not the struck-out one", async () => {
    const cheap = { id: "p2", name: "Spritz", unitPrice: "20.00" };
    const view = {
      ...model,
      products: [...model.products, { ...model.products[0]!, ...cheap, variants: [] }],
      offers: [
        { ...model.offers[0]!, grossPrice: "11.00", unitPrice: "11.00" },
        {
          ...model.offers[0]!,
          id: "i2",
          productId: "p2",
          name: "Spritz",
          grossPrice: "9.00",
          unitPrice: "9.00",
          variants: [],
        },
      ],
    };
    const el = await mount({ load: vi.fn().mockResolvedValue(view) } as unknown as VenueServiceApi);
    await selectTab(el, "menus");
    const offers = table(el, "menu-offers-m1") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    offers.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="price"]')!.click();
    await offers.updateComplete;
    const names = [...offers.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
      row.querySelectorAll("td")[0]!.textContent!.trim(),
    );
    // Charged 9.00 against 11.00; by the struck-out prices (20.00 against 10.00) it would reverse.
    expect(names).toEqual(["Spritz", "Negroni"]);
  });
});

function column(el: VenueOperationsScreen, name: string, index: number): string[] {
  return [...table(el, name).shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.querySelectorAll("td")[index]!.textContent!.trim(),
  );
}
async function sortBy(el: VenueOperationsScreen, name: string, key: string) {
  const list = table(el, name) as HTMLElement & { updateComplete: Promise<unknown> };
  list.shadowRoot!.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)!.click();
  await list.updateComplete;
}
function fieldError(el: VenueOperationsScreen, name: string) {
  return el.shadowRoot!.querySelector(`[data-field-error="${name}"]`)?.textContent?.trim();
}
function modal(el: VenueOperationsScreen) {
  return el.shadowRoot!.querySelector("wt-modal");
}

describe("the venue lists", () => {
  // Every sort below starts from an order other than its result, so a column that stopped sorting
  // would leave the rows where they were. Department and zone ids sort against their names, so a
  // column sorting by id fails too; menu ids happen to sort WITH their names, so the menus sort
  // does not catch that.
  const unsorted: VenueServiceView = {
    ...model,
    menus: [
      { id: "m2", name: "Deli takeaway", active: true },
      { id: "m1", name: "Casa Delgado", active: true },
    ],
    offers: [
      {
        ...model.offers[0]!,
        id: "i1",
        menuId: "m2",
      },
      {
        ...model.offers[0]!,
        id: "i2",
        menuId: "m2",
        productId: "p2",
        name: "Bravas",
      },
    ],
  };

  it("sorts every name column alphabetically", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(unsorted),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(column(el, "departments", 0)).toEqual(["Restaurant and bar", "Deli"]);
    await sortBy(el, "departments", "name");
    expect(column(el, "departments", 0)).toEqual(["Deli", "Restaurant and bar"]);

    await selectTab(el, "menus");
    expect(column(el, "menus", 0)).toEqual(["Deli takeaway", "Casa Delgado"]);
    await sortBy(el, "menus", "name");
    expect(column(el, "menus", 0)).toEqual(["Casa Delgado", "Deli takeaway"]);
    expect(column(el, "menu-offers-m2", 0)).toEqual(["Negroni", "Bravas"]);
    await sortBy(el, "menu-offers-m2", "product");
    expect(column(el, "menu-offers-m2", 0)).toEqual(["Bravas", "Negroni"]);

    await selectTab(el, "zones");
    expect(column(el, "zones", 0)).toEqual(["Dining room", "Deli counter"]);
    await sortBy(el, "zones", "name");
    expect(column(el, "zones", 0)).toEqual(["Deli counter", "Dining room"]);
  });

  it("marks inactive departments and menus, and names a zone's non-default menus", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: [model.departments[0]!, { ...model.departments[1]!, active: false }],
        menus: [model.menus[0]!, { ...model.menus[1]!, active: false }],
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
        ],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "departments");
    expect(column(el, "departments", 3)).toEqual(["Active", "Inactive"]);
    await selectTab(el, "menus");
    expect(column(el, "menus", 1)).toEqual(["Active", "Inactive"]);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(column(el, "zone-menus", 1)).toEqual(["Yes", "No"]);
  });

  it("labels a zone-menu row's actions with the stored menu id, and shows a route's stored category or product id, when they are not loaded", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m-gone", displayOrder: 1, isDefault: false },
        ],
        routes: [
          { ...model.routes[0]!, id: "r1", categoryId: "c-gone" },
          {
            ...model.routes[0]!,
            id: "r2",
            categoryId: null,
            productId: "p-gone",
          },
        ],
      }),
    } as unknown as VenueServiceApi);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(
      [...table(el, "zone-menus").shadowRoot!.querySelectorAll("wt-row-actions")].map((menu) =>
        menu.getAttribute("label"),
      ),
    ).toEqual(["Actions: Casa Delgado", "Actions: m-gone"]);
    await selectTab(el, "routing");
    expect(column(el, "preparation-routes", 0)).toEqual(["c-gone", "p-gone"]);
  });

  it("makes another of a zone's menus its default straight from the list", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 4, isDefault: false },
        ],
      }),
      allowMenu: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    expect(find(el, '[data-test="default-assignment-m1"]')!.hasAttribute("disabled")).toBe(true);
    await action(el, "default-assignment-m2");
    expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 4, makeDefault: true });
    expect(modal(el)).toBeNull();
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  it("adds a product to the menu the offers list is showing, from its toolbar", async () => {
    const el = await mount({
      load: vi.fn().mockResolvedValue(model),
    } as unknown as VenueServiceApi);
    await selectTab(el, "menus");
    await action(el, "new-offer");
    expect(modal(el)!.getAttribute("heading")).toBe("Casa Delgado: Add product to menu");
    expect(el.shadowRoot!.querySelector('[name="offer-product-m1"]')).not.toBeNull();
    await action(el, "cancel-editor");
    await action(el, "products-m2");
    await action(el, "new-offer");
    expect(modal(el)!.getAttribute("heading")).toBe("Deli takeaway: Add product to menu");
    expect(el.shadowRoot!.querySelector('[name="offer-product-m2"]')).not.toBeNull();
  });
});

describe("the venue editors refuse an incomplete form", () => {
  it("requires a menu name", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createMenu: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-menu");
    await action(el, "save-editor");
    expect(fieldError(el, "menu-name")).toBe("Menu name: This field is required.");
    expect(summary(el)).toContain("Menu name: This field is required.");
    expect(api.createMenu).not.toHaveBeenCalled();
  });

  it("requires opening and closing times, and refuses them equal", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      replaceHours: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "new-hours");
    await action(el, "save-editor");
    expect(fieldError(el, "hours-opens")).toBe("Opens: This field is required.");
    expect(fieldError(el, "hours-closes")).toBe("Closes: This field is required.");
    expect(summary(el)).toContain("Opens: This field is required.");
    expect(summary(el)).toContain("Closes: This field is required.");
    field(el, "hours-opens").value = "10:00";
    field(el, "hours-closes").value = "10:00";
    await action(el, "save-editor");
    expect(fieldError(el, "hours-opens")).toBe("Opening and closing times must differ.");
    expect(fieldError(el, "hours-closes")).toBe("Opening and closing times must differ.");
    expect(summary(el)).toContain("Opening and closing times must differ.");
    expect(summary(el)).not.toContain("This field is required.");
    expect(api.replaceHours).not.toHaveBeenCalled();
  });

  it("requires a department for a zone when none is active", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        departments: model.departments.map((department) => ({ ...department, active: false })),
      }),
      configureZone: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "edit-zone-z2");
    await action(el, "save-editor");
    expect(fieldError(el, "zone-department-z2")).toBe("Department: This field is required.");
    expect(summary(el)).toContain("Department: This field is required.");
    expect(api.configureZone).not.toHaveBeenCalled();
  });

  it("requires a menu for a zone that already has every active one", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({
        ...model,
        zoneMenus: [
          ...model.zoneMenus,
          { zoneId: "z1", menuId: "m2", displayOrder: 1, isDefault: false },
        ],
      }),
      allowMenu: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    expect(field(el, "assignment-menu").value).toBe("");
    await action(el, "save-editor");
    expect(fieldError(el, "assignment-menu")).toBe("Menu name: This field is required.");
    expect(summary(el)).toContain("Menu name: This field is required.");
    expect(api.allowMenu).not.toHaveBeenCalled();
  });

  it("refuses a display order that is not a whole number of zero or more", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      allowMenu: vi.fn().mockResolvedValue(undefined),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "zones");
    await action(el, "zone-menus-z1");
    await action(el, "new-assignment-z1");
    for (const order of ["-1", "1.5"]) {
      field(el, "assignment-order").value = order;
      await action(el, "save-editor");
      expect(fieldError(el, "assignment-order")).toBe("Enter a whole number of zero or more.");
      expect(summary(el)).toContain("Enter a whole number of zero or more.");
    }
    expect(api.allowMenu).not.toHaveBeenCalled();
    field(el, "assignment-order").value = "0";
    await action(el, "save-editor");
    expect(api.allowMenu).toHaveBeenCalledWith("z1", "m2", { displayOrder: 0, makeDefault: false });
  });

  it("requires a product or category to route when the venue has neither", async () => {
    const api = {
      load: vi.fn().mockResolvedValue({ ...model, categories: [], products: [] }),
      createRoute: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "routing");
    await action(el, "new-route");
    await action(el, "save-editor");
    expect(fieldError(el, "route-subject")).toBe("Product or category: This field is required.");
    expect(summary(el)).toContain("Product or category: This field is required.");
    expect(fieldError(el, "route-target")).toBeUndefined();
    expect(api.createRoute).not.toHaveBeenCalled();
  });
});

it("opens a product route that needs no preparation on that product and on no station", async () => {
  const el = await mount({
    load: vi.fn().mockResolvedValue({
      ...model,
      routes: [
        {
          id: "r2",
          zoneId: null,
          categoryId: null,
          productId: "p1",
          stationId: null,
          noPreparation: true,
        },
      ],
    }),
  } as unknown as VenueServiceApi);
  await selectTab(el, "routing");
  await action(el, "edit-route-r2");
  expect(field(el, "route-subject").value).toBe("product:p1");
  expect(field(el, "route-zone").value).toBe("");
  expect(field(el, "route-target").value).toBe("none");
});

it("shows the general save error when a write is refused without a reason", async () => {
  const api = {
    load: vi.fn().mockResolvedValue(model),
    deactivateDepartment: vi.fn().mockRejectedValue(undefined),
  } as unknown as VenueServiceApi;
  const el = await mount(api);
  await selectTab(el, "departments");
  await action(el, "deactivate-department-d2");
  await action(el, "save-editor");
  expect(summary(el)).toContain("The change could not be saved.");
  expect(modal(el)).not.toBeNull();
});

describe("the editor's keyboard", () => {
  it("closes on Escape", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createMenu: vi.fn(),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-menu");
    input(el, "menu-name").focus();
    await userEvent.keyboard("{Escape}");
    // Escape closes the native dialog at once, but the modal leaves only when its close event
    // arrives, which the HTML spec's dialog-closing steps queue as a later task.
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(api.createMenu).not.toHaveBeenCalled();
  });

  it("stays open on Escape while a save is still pending", async () => {
    let finish!: () => void;
    const api = {
      load: vi.fn().mockResolvedValue(model),
      deactivateDepartment: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "departments");
    await action(el, "deactivate-department-d2");
    find(el, '[data-test="save-editor"]')!.click();
    await el.updateComplete;
    modal(el)!.shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
    await userEvent.keyboard("{Escape}");
    await settle(el);
    expect(modal(el)).not.toBeNull();
    expect(modal(el)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    finish();
    await vi.waitFor(() => expect(modal(el)).toBeNull());
  });

  it("saves on Enter in a text field", async () => {
    const api = {
      load: vi.fn().mockResolvedValue(model),
      createMenu: vi.fn().mockResolvedValue({ id: "m3" }),
    } as unknown as VenueServiceApi;
    const el = await mount(api);
    await selectTab(el, "menus");
    await action(el, "new-menu");
    input(el, "menu-name").focus();
    await userEvent.keyboard("Brunch{Enter}");
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(api.createMenu).toHaveBeenCalledWith("Brunch");
  });
});

it("returns focus to the row that opened an editor, or to the tabs once that row is gone", async () => {
  const liveData = new LiveData();
  const load = vi.fn().mockResolvedValue(structuredClone(model));
  const el = await mount({ load, liveData } as unknown as VenueServiceApi);
  await selectTab(el, "departments");
  await action(el, "edit-department-d1");
  await action(el, "cancel-editor");
  const menu = table(el, "departments").shadowRoot!.activeElement as HTMLElement;
  expect(menu.getAttribute("label")).toBe("Actions: Restaurant and bar");
  expect(menu.shadowRoot!.activeElement).toBe(menu.shadowRoot!.querySelector("button"));

  await action(el, "edit-department-d2");
  const updated = structuredClone(model);
  updated.departments = [updated.departments[0]!];
  updated.hours = [];
  load.mockResolvedValue(updated);
  liveData.invalidate([{ type: "departments", id: "d2" }]);
  await vi.waitFor(() => expect(column(el, "departments", 0)).toEqual(["Restaurant and bar"]));
  await action(el, "cancel-editor");
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("wt-tabs"));
});
