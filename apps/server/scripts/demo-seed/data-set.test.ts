import { describe, expect, it } from "vitest";
import { resolveFiscalJurisdiction } from "@waitron/country";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import { CASA_DELGADO, DELI_TAKEAWAY, MENU_DEL_DIA, PRODUCT_OPTION_LISTS } from "./menu.js";
import { DEMO_STATUSES, DEMO_TABLES, DEMO_ZONES } from "./floor.js";
import { DEMO_STAFF } from "./staff.js";
import { DEMO_ADJUSTMENT_REASONS } from "./seed-adjustments.js";
import {
  DEMO_DATA_SETS,
  demoContentLanguages,
  demoDataSet,
  inLanguages,
  type DemoDataSet,
} from "./data-set.js";
import { CASA_DELGADO_ES, CASA_DELGADO_LANGUAGES } from "./data-sets/casa-delgado-es.js";

type Text = Readonly<Record<string, string>>;

/** Every customer-facing text a data set carries, each with where it sits. */
function customerTexts(set: DemoDataSet): [string, Text][] {
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
  for (const reason of set.adjustmentReasons)
    texts.push([`adjustment reason ${reason.names.en}`, reason.names]);
  return texts;
}

/** Catalan or Galician values a speaker writes exactly as in Spanish or English: proper names, a
 * dish known by its own name, and words both languages spell alike. */
const SAME_AS_SPANISH_OR_ENGLISH: Readonly<Record<string, readonly string[]>> = {
  ca: [
    "Casa Delgado",
    "Negroni",
    "Crema catalana",
    "Torta del Casar (per kg)",
    "Conserves",
    "Postres",
    "rac",
  ],
  gl: [
    "Casa Delgado",
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
    "Bebidas",
    "Café",
    "ración",
    "rac",
    "Cambio de opinión",
  ],
};

describe("demo data sets", () => {
  it("resolves every country pack's demo data set", () => {
    const named = COUNTRY_PACKS.flatMap((pack) => {
      const id = pack.demo?.dataSet;
      return id === undefined ? [] : [id];
    });
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(demoDataSet(id).id).toBe(id);
  });

  it("refuses an id no data set has", () => {
    expect(() => demoDataSet("no-such-set")).toThrow(/no-such-set/);
  });

  it("refuses an id an object inherits rather than one a data set has", () => {
    for (const id of ["toString", "constructor", "__proto__"]) {
      expect(() => demoDataSet(id)).toThrow(`demoDataSet: no demo data set "${id}"`);
    }
  });

  it("holds Casa Delgado's existing data unchanged", () => {
    const set = DEMO_DATA_SETS["casa-delgado-es"]!;
    expect(set.menus.restaurant).toBe(CASA_DELGADO);
    expect(set.menus.deli).toBe(DELI_TAKEAWAY);
    expect(set.menus.lunch).toBe(MENU_DEL_DIA);
    expect(set.productOptionLists).toBe(PRODUCT_OPTION_LISTS);
    expect(set.floor.zones).toBe(DEMO_ZONES);
    expect(set.floor.tables).toBe(DEMO_TABLES);
    expect(set.floor.statuses).toBe(DEMO_STATUSES);
    expect(set.staff).toBe(DEMO_STAFF);
    expect(set.adjustmentReasons).toBe(DEMO_ADJUSTMENT_REASONS);
    expect(set.menus.drinksName).toEqual({ en: "Drinks", es: "Bebidas" });
    expect(set.watcherName).toEqual({ en: "Pass", es: "Pase" });
    expect(set.floor.departmentNames).toEqual({
      restaurant: { en: "Restaurant and bar", es: "Restaurante y bar" },
      deli: { en: "Deli", es: "Charcutería" },
    });
    expect(set.floor.upstairsBarZone).toEqual({ en: "Upstairs bar", es: "Bar de arriba" });
    expect(set.floor.deliCounterZone).toEqual({
      en: "Deli counter",
      es: "Mostrador de charcutería",
    });
  });

  it("keeps only the venue's languages", () => {
    expect(inLanguages({ es: "Pan", en: "Bread", ca: "Pa" }, ["es", "en"])).toEqual({
      es: "Pan",
      en: "Bread",
    });
    expect(inLanguages({ es: "Pan" }, ["es", "gl"])).toEqual({ es: "Pan" });
  });

  it("keeps the text's own key order, which the stored JSON follows", () => {
    expect(Object.keys(inLanguages({ en: "Bread", es: "Pan" }, ["es", "en"]))).toEqual([
      "en",
      "es",
    ]);
  });

  it.each([
    ["Madrid", { defaultLanguage: "es", languages: ["es", "en"], required: ["es"] }],
    // The Balearic Islands
    ["07", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }],
    // Barcelona
    ["08", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }],
    // Valencia
    ["46", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }],
    // A Coruña
    ["15", { defaultLanguage: "gl", languages: ["gl", "es", "en"], required: ["gl", "es"] }],
  ])("gives a demo in %s these content languages", (area, expected) => {
    expect(demoContentLanguages({ country: "ES", area })).toEqual(expected);
  });

  it("carries every language the demo can enable where a venue can be set up", () => {
    for (const pack of COUNTRY_PACKS) {
      const id = pack.demo?.dataSet;
      if (id === undefined) continue;
      const set = demoDataSet(id);
      for (const area of pack.administrativeAreas) {
        if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
        const { languages } = demoContentLanguages({ country: pack.countryCode, area: area.code });
        const missing = languages.filter((language) => !set.contentLanguages.includes(language));
        expect.soft(missing, `${pack.countryCode} ${area.name}`).toEqual([]);
      }
    }
  });

  it("gives every Casa Delgado customer-facing text a value of its own in every language", () => {
    expect(CASA_DELGADO_ES.contentLanguages).toEqual(CASA_DELGADO_LANGUAGES);
    const texts = customerTexts(CASA_DELGADO_ES);
    expect(texts.length).toBeGreaterThan(70);
    for (const [where, text] of texts) {
      for (const language of CASA_DELGADO_LANGUAGES) {
        expect(text[language]?.trim(), `${where} in ${language}`).toBeTruthy();
      }
      for (const language of CASA_DELGADO_LANGUAGES.filter((l) => l !== "en" && l !== "es")) {
        const value = text[language]!;
        if (SAME_AS_SPANISH_OR_ENGLISH[language]!.includes(value)) continue;
        expect([text.en, text.es], `${where} in ${language} copies another language`).not.toContain(
          value,
        );
      }
    }
  });

  it("allows only copies the data set actually makes", () => {
    const values = customerTexts(CASA_DELGADO_ES).flatMap(([, text]) => [
      ...(text.ca === text.en || text.ca === text.es ? [`ca:${text.ca}`] : []),
      ...(text.gl === text.en || text.gl === text.es ? [`gl:${text.gl}`] : []),
    ]);
    const allowed = Object.entries(SAME_AS_SPANISH_OR_ENGLISH).flatMap(([language, list]) =>
      list.map((value) => `${language}:${value}`),
    );
    expect(allowed.filter((entry) => !values.includes(entry))).toEqual([]);
  });
});
