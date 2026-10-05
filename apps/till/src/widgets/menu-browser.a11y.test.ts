import { afterEach, describe, expect, it } from "vitest";
import type { DocumentMember } from "@waitron/catalogue/src/menu-document-types.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, type Theme } from "./test-helpers.js";
import "./menu-browser.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import type { TillProduct, TillZoneMenu } from "../api/client.js";

function product(key: string, name: string, available = true): TillProduct {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-${key}`,
    available,
    name,
    customerName: { es: `${name} carta` },
    kitchenName: `${name} KDS`,
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
  };
}

const member = (key: string): DocumentMember => ({
  kind: "product",
  menuItemId: `mi-${key}`,
  productId: `p-${key}`,
});

const beer: DocumentMember = {
  kind: "section",
  sectionId: "sec-beer",
  internalName: "beer-internal",
  names: { en: "Beer (EN)" },
  image: null,
  color: null,
  members: [member("cana")],
};

const drinks: DocumentMember = {
  kind: "section",
  sectionId: "sec-drinks",
  internalName: "drinks-internal",
  names: { en: "Drinks (EN)" },
  image: null,
  color: null,
  members: [member("cola"), member("burger"), beer],
};

// Painted in a stored colour, so the scan's contrast check reads each tile's labels on its colour.
const red: DocumentMember = {
  kind: "section",
  sectionId: "sec-red",
  internalName: "red-internal",
  names: { en: "Red (EN)" },
  image: null,
  color: "#b12525",
  members: [member("cafe")],
};

const menu: TillZoneMenu = {
  id: "menu-lunch",
  name: "Lunch",
  isDefault: true,
  versionId: "v1",
  structure: {
    members: [
      drinks,
      member("cafe"),
      member("jamon"),
      member("blue"),
      member("pink"),
      member("bluegone"),
      member("pinkgone"),
      red,
    ],
  },
  homeLayouts: [
    {
      id: "lay-home",
      name: "Home",
      tiles: [
        { kind: "product", productId: "p-cafe" },
        { kind: "product", productId: "p-burger" },
        { kind: "section", sectionId: "sec-drinks" },
      ],
    },
  ],
  defaultHomeLayoutId: "lay-home",
  homeLayoutId: "lay-home",
  layoutFallback: null,
};

const products = [
  product("cafe", "Café"),
  product("cola", "Cola"),
  product("cana", "Caña"),
  product("burger", "Burger", false),
  // Sold by weight, so its tile's price reads per kilo.
  { ...product("jamon", "Jamón"), pricingUnit: "weight" as const },
  { ...product("blue", "Blue"), color: "#256bb1" },
  { ...product("pink", "Pink"), color: "#edabab" },
  { ...product("bluegone", "Blue gone", false), color: "#256bb1" },
  { ...product("pinkgone", "Pink gone", false), color: "#edabab" },
];

async function mount(theme: Theme) {
  return mountWidget<TillMenuBrowser>(
    "till-menu-browser",
    { menu, products, store: new WorkingOrderStore(), columns: 3 },
    theme,
  );
}

function button(el: TillMenuBrowser, name: string): HTMLElement {
  const found = [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-button[data-kind]")].find(
    (each) => each.querySelector(".name")!.textContent!.trim() === name,
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-menu-browser a11y (%s theme)", (theme) => {
  it("home, with a greyed, unavailable tile and a weighed product's tile, has no violations", async () => {
    const { el, host } = await mount(theme);
    expect((button(el, "Burger") as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    expect(button(el, "Jamón").querySelector(".price")!.textContent).toContain("/kg");
    expect(button(el, "Burger").querySelector(".sold-out")!.textContent!.trim()).toBe("Sold out");
    await expectNoA11yViolations(host);
  });

  it("home, with a dark and a pale painted tile sold out, has no violations", async () => {
    const { el, host } = await mount(theme);
    for (const name of ["Blue gone", "Pink gone"]) {
      expect((button(el, name) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
      expect(button(el, name).querySelector(".sold-out")!.textContent!.trim()).toBe("Sold out");
    }
    await expectNoA11yViolations(host);
  });

  it("home blanks for empty and undrawable targets have no violations", async () => {
    const { el, host } = await mount(theme);
    el.menu = {
      ...menu,
      structure: {
        members: [
          ...menu.structure.members,
          {
            kind: "section",
            sectionId: "sec-empty",
            internalName: "Empty",
            names: {},
            image: null,
            color: null,
            members: [member("missing")],
          },
        ],
      },
      homeLayouts: [
        {
          id: "lay-home",
          name: "Home",
          tiles: [
            { kind: "product", productId: "p-cafe" },
            { kind: "empty" },
            { kind: "product", productId: "p-missing" },
            { kind: "product", productId: "p-cola" },
            { kind: "section", sectionId: "sec-empty" },
            { kind: "product", productId: "p-burger" },
          ],
        },
      ],
    };
    el.products = products.map((each) =>
      each.productId === "p-cola" ? { ...each, ordering: "not_sold_separately" } : each,
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('[data-region="shortcuts"] .slot')).toHaveLength(4);
    expect((button(el, "Burger") as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("search results holding an unavailable product have no violations", async () => {
    const { el, host } = await mount(theme);
    const input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
    input.value = "u";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-region="results"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-region="results"] .name')!.textContent!.trim()).toBe(
      "Burger",
    );
    expect(
      el.shadowRoot!.querySelector('[data-region="results"] .sold-out')!.textContent!.trim(),
    ).toBe("Sold out");
    await expectNoA11yViolations(host);
  });

  it("a section view holding a sold-out product has no violations", async () => {
    const { el, host } = await mount(theme);
    button(el, "Drinks (EN)").click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector('[data-region="section"] .sold-out')!.textContent!.trim(),
    ).toBe("Sold out");
    await expectNoA11yViolations(host);
  });

  it("a nested section view, with its breadcrumb, has no violations", async () => {
    const { el, host } = await mount(theme);
    button(el, "Drinks (EN)").click();
    await el.updateComplete;
    button(el, "Beer (EN)").click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("nav.breadcrumb [aria-current]")!.textContent).toBe(
      "Beer (EN)",
    );
    await expectNoA11yViolations(host);
  });

  it("the Not found notice has no violations", async () => {
    const { el, host } = await mount(theme);
    button(el, "Drinks (EN)").click();
    await el.updateComplete;
    el.menu = { ...menu, structure: { members: [member("cafe")] } };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role='alert']")!.textContent).toBe("Not found");
    await expectNoA11yViolations(host);
  });
});
