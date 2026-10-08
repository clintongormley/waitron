import { afterEach, describe, expect, it } from "vitest";
import type { DocumentMember } from "@waitron/catalogue/src/menu-document-types.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, type Theme } from "./test-helpers.js";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./menu-browser.js";
import type { TillMenuBrowser } from "./menu-browser.js";
import type { TillProduct, TillZoneMenu } from "../api/client.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

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
    unit: {
      id: "unit-each",
      name: { en: "Each", es: "Unidad" },
      abbreviation: { en: "ea", es: "ud" },
      precision: 0,
      hardwareUnit: null,
    },
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
  names: { en: "Beer (EN)", es: "Cervezas" },
  image: null,
  color: null,
  members: [member("cana")],
};

const drinks: DocumentMember = {
  kind: "section",
  sectionId: "sec-drinks",
  internalName: "drinks-internal",
  names: { en: "Drinks (EN)", es: "Bebidas" },
  image: null,
  color: null,
  members: [member("cola"), member("burger"), beer],
};

// Painted in a stored colour, so the scan's contrast check reads each tile's labels on its colour.
const red: DocumentMember = {
  kind: "section",
  sectionId: "sec-red",
  internalName: "red-internal",
  names: { en: "Red (EN)", es: "Rojo" },
  image: null,
  color: "#b12525",
  members: [member("cafe")],
};

const menu: TillZoneMenu = {
  id: "menu-lunch",
  name: "Lunch",
  isDefault: true,
  orderable: true,
  audience: "customer",
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
  home: {
    shortcuts: [
      { kind: "product", productId: "p-cafe" },
      { kind: "product", productId: "p-burger" },
      { kind: "section", sectionId: "sec-drinks" },
    ],
    handheld: HOME_DISPLAY_DEFAULTS.handheld,
    till: HOME_DISPLAY_DEFAULTS.till,
  },
};

const products = [
  product("cafe", "Café"),
  product("cola", "Cola"),
  product("cana", "Caña"),
  product("burger", "Burger", false),
  // Sold by weight, so its tile's price reads per kilo.
  {
    ...product("jamon", "Jamón"),
    pricingUnit: "weight" as const,
    unit: {
      id: "unit-kg",
      name: { en: "Kilogram", es: "Kilogramo" },
      abbreviation: { en: "kg", es: "kg" },
      precision: 3,
      hardwareUnit: "kg" as const,
    },
  },
  { ...product("blue", "Blue"), color: "#256bb1" },
  { ...product("pink", "Pink"), color: "#edabab" },
  { ...product("bluegone", "Blue gone", false), color: "#256bb1" },
  { ...product("pinkgone", "Pink gone", false), color: "#edabab" },
];

async function mount(theme: Theme, props: Partial<TillMenuBrowser> = { columns: 3 }) {
  return mountWidget<TillMenuBrowser>(
    "till-menu-browser",
    { menu, products, store: new WorkingOrderStore(), ...props },
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

/** A menu served beside Lunch, naming its own offer of each of `offered`. */
function servedMenu(key: string, name: string, offered: TillProduct[]): TillZoneMenu {
  return {
    id: `menu-${key}`,
    name,
    isDefault: false,
    orderable: true,
    audience: "customer",
    versionId: `v-${key}`,
    structure: {
      members: offered.map((each) => ({
        kind: "product",
        menuItemId: `mi-${key}-${each.id.slice(2)}`,
        productId: each.id,
      })),
    },
    home: { ...menu.home, shortcuts: [] },
  };
}

function offersOn(key: string, offered: TillProduct[]): TillProduct[] {
  return offered.map((each) => ({
    ...each,
    menuItemId: `mi-${key}-${each.id.slice(2)}`,
    catalogueId: `menu-${key}`,
  }));
}

const drinksOffered = [
  { ...product("cola", "Cola"), unitPrice: "2.20" },
  product("coconut", "Coconut water", false),
];
const brunchOffered = [product("porridge", "Porridge")];

async function mountServed(theme: Theme, others: TillZoneMenu[], otherProducts: TillProduct[]) {
  return mount(theme, {
    columns: 3,
    menus: [menu, ...others],
    servedProducts: [...products, ...otherProducts],
  });
}

async function search(el: TillMenuBrowser, text: string): Promise<void> {
  const input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

function groupHeadings(el: TillMenuBrowser): string[] {
  return [
    ...el.shadowRoot!.querySelectorAll('[data-region="results"] section[data-menu] > :first-child'),
  ].map((heading) => heading.textContent!.trim());
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-menu-browser a11y (%s theme)", (theme) => {
  it.each([
    ["en-GB", 390],
    ["en-GB", 1280],
    ["es-ES", 390],
    ["es-ES", 1280],
  ] as const)(
    "hovered plain and painted tiles are accessible in %s at %i px",
    async (locale, width) => {
      const previous = currentLocale();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setLocale(locale);
      await page.viewport(width, 900);
      try {
        expect(window.innerWidth).toBe(width);
        const { el, host } = await mount(theme);
        const tiles = el.shadowRoot!.querySelectorAll("wt-button[data-kind]");
        expect(tiles.length).toBeGreaterThanOrEqual(9);
        for (const tile of tiles) {
          const inner = tile.shadowRoot!.querySelector("button")!;
          await userEvent.hover(inner);
          expect(inner.matches(":hover")).toBe(true);
          await expectNoA11yViolations(host);
        }
        await userEvent.hover(button(el, "Blue").shadowRoot!.querySelector("button")!);
        await page.screenshot({
          element: host,
          path: `__screenshots__/look/a319-tiles-${locale}-${theme}-${width}.png`,
        });
      } finally {
        setLocale(previous);
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  it("home, with a plain and two painted (dark and pale) sold-out tiles and a weighed product's tile, has no violations", async () => {
    const { el, host } = await mount(theme);
    expect(button(el, "Jamón").querySelector(".price")!.textContent).toContain("/kg");
    for (const name of ["Burger", "Blue gone", "Pink gone"]) {
      expect((button(el, name) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
      expect(button(el, name).querySelector(".sold-out")!.textContent!.trim()).toBe("Sold out");
    }
    await expectNoA11yViolations(host);
  });

  it("home with a plain and a painted section the diet filter empties, greyed between products, has no violations", async () => {
    const hidden = ["p-cola", "p-cana", "p-burger", "p-cafe"];
    const { el, host } = await mount(theme, {
      columns: 3,
      products: products.filter((each) => !hidden.includes(each.id)),
      unfilteredProducts: products,
      menu: {
        ...menu,
        structure: { members: [member("jamon"), drinks, member("blue"), red, member("pink")] },
      },
    });
    const greyed = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
        '[data-region="structure"] wt-button[data-filtered]',
      ),
    ];
    expect(greyed.map((each) => each.querySelector(".name")!.textContent!.trim())).toEqual([
      "Drinks (EN)",
      "Red (EN)",
    ]);
    for (const tile of greyed) {
      expect(tile.disabled).toBe(true);
      expect(tile.querySelector(".kind")!.textContent!.trim()).toBe("Nothing matches the filter");
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
      home: {
        shortcuts: [
          { kind: "product", productId: "p-cafe" },
          { kind: "empty" },
          { kind: "product", productId: "p-missing" },
          { kind: "product", productId: "p-cola" },
          { kind: "section", sectionId: "sec-empty" },
          { kind: "product", productId: "p-burger" },
        ],
        handheld: HOME_DISPLAY_DEFAULTS.handheld,
        till: HOME_DISPLAY_DEFAULTS.till,
      },
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

  it("Menu first, with the divider naming the shortcuts, has no violations", async () => {
    const { el, host } = await mount(theme, {
      columns: 3,
      menu: { ...menu, home: { ...menu.home, till: { ...menu.home.till, order: "menu_first" } } },
    });
    expect(el.shadowRoot!.querySelector("h2.divider")!.textContent!.trim()).toBe("Shortcuts");
    await expectNoA11yViolations(host);
  });

  it("Thumbnails, with an imaged product, an imaged section and a neutral tile, has no violations", async () => {
    const pictured: DocumentMember = {
      kind: "section",
      sectionId: "sec-pictured",
      internalName: "pictured-internal",
      names: { en: "Pictured (EN)" },
      image: "drinks.webp",
      color: null,
      members: [member("cola")],
    };
    const { el, host } = await mount(theme, {
      columns: 3,
      menu: {
        ...menu,
        structure: { members: [member("photo"), pictured, member("cana")] },
        home: {
          ...menu.home,
          shortcuts: [],
          till: { ...menu.home.till, tiles: "thumbnails" },
        },
      },
      products: [...products, { ...product("photo", "Photo"), image: "cafe.webp" }],
    });
    expect(button(el, "Photo").querySelector("img")).not.toBeNull();
    expect(button(el, "Pictured (EN)").querySelector("img")).not.toBeNull();
    expect(button(el, "Caña").querySelector("img")).toBeNull();
    await expectNoA11yViolations(host);
  });

  it("a handheld at 3 columns has no violations", async () => {
    const { el, host } = await mount(theme, {
      handheld: true,
      menu: { ...menu, home: { ...menu.home, handheld: { ...menu.home.handheld, columns: 3 } } },
    });
    expect(
      getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>(".grid")!)
        .getPropertyValue("--columns")
        .trim(),
    ).toBe("3");
    await expectNoA11yViolations(host);
  });

  it("search results grouped by menu, with a sold-out tile in another menu's group and a heading drawn for screen readers only, have no violations", async () => {
    const { el, host } = await mountServed(
      theme,
      [servedMenu("drinks", "Drinks", drinksOffered)],
      offersOn("drinks", drinksOffered),
    );
    await search(el, "co");
    expect(groupHeadings(el)).toEqual(["Lunch (this menu)", "Drinks"]);
    expect(
      el.shadowRoot!.querySelector('[data-menu="menu-drinks"] .sold-out')!.textContent!.trim(),
    ).toBe("Sold out");
    const results = el.shadowRoot!.querySelector('[data-region="results"]')!;
    const heading = el.shadowRoot!.getElementById(results.getAttribute("aria-labelledby")!)!;
    expect(heading.textContent!.trim()).toBe("Search results");
    expect(heading.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expectNoA11yViolations(host);
  });

  it("no match in this menu, followed by another menu's group, has no violations", async () => {
    const { el, host } = await mountServed(
      theme,
      [servedMenu("brunch", "Brunch", brunchOffered)],
      offersOn("brunch", brunchOffered),
    );
    await search(el, "porridge");
    expect(groupHeadings(el)).toEqual(["Lunch (this menu)", "Brunch"]);
    expect(el.shadowRoot!.querySelector('[data-menu="menu-lunch"] .empty')!.textContent).toBe(
      "No products match in this menu",
    );
    await expectNoA11yViolations(host);
  });

  it("two other served menus sharing one name have no violations", async () => {
    const { el, host } = await mountServed(
      theme,
      [servedMenu("bar-1", "Bar", drinksOffered), servedMenu("bar-2", "Bar", brunchOffered)],
      [...offersOn("bar-1", drinksOffered), ...offersOn("bar-2", brunchOffered)],
    );
    await search(el, "o");
    expect(groupHeadings(el)).toEqual(["Lunch (this menu)", "Bar", "Bar"]);
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
