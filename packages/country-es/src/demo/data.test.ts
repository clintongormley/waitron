import type { CountryDemoData } from "@waitron/country";
import { CASA_DELGADO_ES } from "./index.js";
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

async function demo() {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.exports["./demo"], "country-es secondary demo entry").toBeTypeOf("string");
  return import(new URL(manifest.exports["./demo"], new URL("../../", import.meta.url)).href);
}

function keys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]);
}

describe("pack-owned Spanish demo", () => {
  it("provides menus, people, floor and reason records without login secrets", async () => {
    const { CASA_DELGADO_ES: set } = await demo();
    expect(set.id).toBe("casa-delgado-es");
    expect(set.contentLanguages).toEqual(["es", "en", "ca", "ca-ES-valencia", "gl"]);
    expect(Object.keys(set.menus)).toEqual([
      "restaurant",
      "deli",
      "lunch",
      "drinksName",
      "drinksCustomerName",
    ]);
    expect(
      set.menus.restaurant.categories.flatMap((c: { products: unknown[] }) => c.products).length,
    ).toBeGreaterThan(20);
    expect(set.productOptionLists.length).toBeGreaterThan(0);
    expect(set.productExtraLists.length).toBeGreaterThan(0);
    expect(set.floor.tables).toHaveLength(16);
    expect(set.floor.tables[0]).not.toHaveProperty("placement");
    expect(set.staff).toHaveLength(5);
    expect(set.staff.map((p: { dashboardLogin: boolean }) => p.dashboardLogin)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(set.adjustmentReasons).toHaveLength(9);
    expect(
      set.adjustmentReasons.find((r: { names: { en: string } }) => r.names.en === "Complaint")
        .maxAmount,
    ).toBe("30.00");
    expect(keys(set).filter((key) => /password|pin|token|secret|credential/i.test(key))).toEqual(
      [],
    );
    expect(JSON.stringify(set)).not.toContain("dashPass123");
    expect(set.stations).toEqual({
      kitchen: "Kitchen",
      downstairsBar: "Downstairs bar",
      upstairsBar: "Upstairs bar",
      deli: "Deli counter",
    });
    expect(set.menuPriceOverrides).toEqual([
      { menu: "drinks", productImage: "cana-cerveza.png", grossPrice: "3.00" },
      { menu: "lunch", productImage: "negroni.png", grossPrice: "9.00" },
    ]);
  });

  it("resolves every product picture from a registered dataset root", async () => {
    const { CASA_DELGADO_ES: set, DEMO_MEDIA_ROOTS } = await demo();
    const url = DEMO_MEDIA_ROOTS[set.mediaDataSet];
    expect(url).toBeInstanceOf(URL);
    expect(url.pathname).toMatch(/demo-media\/casa-delgado-es\/$/);
    for (const menu of [set.menus.restaurant, set.menus.deli, set.menus.lunch]) {
      for (const category of menu.categories) {
        for (const product of category.products)
          expect(existsSync(new URL(product.image, url)), product.image).toBe(true);
      }
    }
  });

  it("provides the complete Madrid developer geography without importing server defaults", async () => {
    const { DEMO_DEVELOPER_PRESETS } = await demo();
    expect(DEMO_DEVELOPER_PRESETS.madrid).toEqual({
      country: "ES",
      dataSet: "casa-delgado-es",
      locationName: "Casa Delgado",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      addressLine1: "1 Main Street",
      addressLine2: null,
      dayCutover: "05:00",
      receiptLocale: "es-ES",
    });
  });
});

type Text = Readonly<Record<string, string>>;

/** Every customer-facing text a data set carries, each with where it sits. */
function customerTexts(set: CountryDemoData): [string, Text][] {
  const texts: [string, Text][] = [];
  const { restaurant, deli, lunch, drinksCustomerName } = set.menus;
  texts.push(["drinks menu", drinksCustomerName]);
  for (const [menuName, menu] of Object.entries({ restaurant, deli, lunch })) {
    texts.push([`${menuName} menu`, menu.customerName]);
    for (const category of menu.categories) {
      texts.push([`${menuName} section ${category.name.en}`, category.name]);
      for (const product of category.products) {
        const where = `${menuName} ${product.image}`;
        texts.push([where, product.customerName]);
        if (product.description !== undefined)
          texts.push([`${where} description`, product.description]);
        if (product.unit !== undefined) {
          texts.push([`${where} unit name`, product.unit.name]);
          texts.push([`${where} unit abbreviation`, product.unit.abbreviation]);
        }
        for (const variant of product.variants ?? [])
          texts.push([`${where} variant ${variant.customerName.en}`, variant.customerName]);
      }
    }
  }
  for (const { productImage, lists } of set.productOptionLists) {
    for (const list of lists) {
      texts.push([`${productImage} option list ${list.name}`, list.customerName]);
      for (const label of list.labels)
        texts.push([`${productImage} option ${list.name}/${label.name}`, label.customerName]);
    }
  }
  for (const { productImage, lists } of set.productExtraLists)
    for (const list of lists)
      texts.push([`${productImage} extras list ${list.name}`, list.customerName]);
  for (const reason of set.adjustmentReasons)
    texts.push([`adjustment reason ${reason.names.en}`, reason.names]);
  return texts;
}

const SAME_AS_SPANISH_OR_ENGLISH: Readonly<Record<string, readonly string[]>> = {
  ca: [
    "Negroni",
    "Crema catalana",
    "Torta del Casar (per kg)",
    "Conserves",
    "Postres",
    "Refrescos",
    "rac",
  ],
  "ca-ES-valencia": [
    "Negroni",
    "Crema catalana",
    "Torta del Casar (per kg)",
    "Conserves",
    "Postres",
    "Refrescos",
    "rac",
    "Café",
  ],
  gl: [
    "Negroni",
    "Torta del Casar (por kg)",
    "Cecina de León (por kg)",
    "Gazpacho andaluz",
    "Paella de marisco",
    "Salchichón (por kg)",
    "Sobrasada (por kg)",
    "Pan con tomate",
    "Ensalada mixta",
    "Refresco de cola",
    "Conservas",
    "Tapas",
    "Segundos",
    "Cócteles",
    "Refrescos",
    "Carta de bebidas",
    "Café",
    "ración",
    "rac",
  ],
};

describe("Casa Delgado customer text", () => {
  it("gives every Casa Delgado customer-facing text a value of its own in every language", () => {
    const texts = customerTexts(CASA_DELGADO_ES);
    expect(texts.length).toBeGreaterThan(70);
    for (const [where, text] of texts) {
      for (const language of CASA_DELGADO_ES.contentLanguages) {
        expect(text[language]?.trim(), `${where} in ${language}`).toBeTruthy();
      }
      for (const language of CASA_DELGADO_ES.contentLanguages.filter(
        (l) => l !== "en" && l !== "es",
      )) {
        const value = text[language]!;
        if (SAME_AS_SPANISH_OR_ENGLISH[language]!.includes(value)) continue;
        expect([text.en, text.es], `${where} in ${language} copies another language`).not.toContain(
          value,
        );
      }
    }
  });
  it("gives every Casa Delgado menu a customer name that differs from its staff name", () => {
    const { restaurant, deli, lunch, drinksName, drinksCustomerName } = CASA_DELGADO_ES.menus;
    const menus: [string, Text, Text][] = [
      ["restaurant", restaurant.name, restaurant.customerName],
      ["deli", deli.name, deli.customerName],
      ["lunch", lunch.name, lunch.customerName],
      ["drinks", drinksName, drinksCustomerName],
    ];
    for (const [menu, staff, customer] of menus) {
      for (const language of ["en", "es"] as const) {
        expect
          .soft(customer[language]!.toLowerCase(), `${menu} menu in ${language}`)
          .not.toBe(staff[language]!.toLowerCase());
      }
    }
  });
  it("allows only copies the data set actually makes", () => {
    const values = customerTexts(CASA_DELGADO_ES).flatMap(([, text]) =>
      Object.keys(SAME_AS_SPANISH_OR_ENGLISH).flatMap((language) => {
        const value = text[language];
        return value === text.en || value === text.es ? [`${language}:${value}`] : [];
      }),
    );
    const allowed = Object.entries(SAME_AS_SPANISH_OR_ENGLISH).flatMap(([language, list]) =>
      list.map((value) => `${language}:${value}`),
    );
    expect(allowed.filter((entry) => !values.includes(entry))).toEqual([]);
  });
});
