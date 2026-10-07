import { describe, expect, it } from "vitest";
import { resolveFiscalJurisdiction } from "@waitron/country";
import type { CountryDemoIdentity, CountryPack } from "@waitron/country";
import { COUNTRY_PACKS, VENUE_SETUP_COUNTRY_PACKS, getCountryPack } from "@waitron/country-packs";
import { ALL_MODULES } from "../../src/modules.js";
import { CASA_DELGADO, DELI_TAKEAWAY, MENU_DEL_DIA, PRODUCT_OPTION_LISTS } from "./menu.js";
import { DEMO_STATUSES, DEMO_TABLES, DEMO_ZONES } from "./floor.js";
import { DEMO_STAFF } from "./staff.js";
import { DEMO_ADJUSTMENT_REASONS } from "./seed-adjustments.js";
import {
  DEMO_DATA_SETS,
  demoContentLanguages,
  demoDataSet,
  demoDataSetFor,
  demoLanguagesFor,
  inLanguages,
  type DemoDataSet,
} from "./data-set.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";

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

/** Catalan or Galician values this data set writes the same as in Spanish or English: proper names,
 * a dish known by its own name, and words both languages spell alike. */
const SAME_AS_SPANISH_OR_ENGLISH: Readonly<Record<string, readonly string[]>> = {
  ca: ["Negroni", "Crema catalana", "Torta del Casar (per kg)", "Conserves", "Postres", "rac"],
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
    "Bebidas",
    "Carta de bebidas",
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
    expect(VENUE_SETUP_COUNTRY_PACKS.length).toBeGreaterThan(0);
    for (const pack of VENUE_SETUP_COUNTRY_PACKS) {
      expect(pack.demo, `${pack.countryCode} demo identity`).toBeDefined();
      const set = demoDataSetFor(pack.demo!);
      const areas =
        pack.administrativeAreas.length === 0
          ? [{ code: null, name: "no administrative area" }]
          : pack.administrativeAreas;
      for (const area of areas) {
        if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
        const { languages } = demoLanguagesFor(set, { country: pack.countryCode, area: area.code });
        const missing = languages.filter((language) => !set.contentLanguages.includes(language));
        expect.soft(missing, `${pack.countryCode} ${area.name}`).toEqual([]);
        for (const [where, text] of customerTexts(set)) {
          for (const language of languages) {
            expect
              .soft(
                text[language]?.trim(),
                `${pack.countryCode} ${area.name}: ${where} in ${language}`,
              )
              .toBeTruthy();
          }
        }
      }
    }
  });

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

/** What stops `pack` being offered at setup, in any mode: the venue screen has one country list.
 * A Demo needs the pack's identity, and the operation description its hidden field is filled
 * from, which is the filing module's default. */
function setupProblems(pack: CountryPack): string[] {
  const problems: string[] = [];
  if (pack.demo === undefined) problems.push(`${pack.countryCode}: no demo identity`);
  for (const jurisdiction of pack.fiscalJurisdictions) {
    if (!jurisdiction.supported || jurisdiction.modules === undefined) continue;
    const filing = jurisdiction.modules.filing;
    const fiscal = ALL_MODULES.find((module) => module.fiscal?.id === filing)?.fiscal;
    if (fiscal?.venueFields?.defaults?.operationDescription === undefined) {
      problems.push(
        `${pack.countryCode} ${jurisdiction.id}: ${filing} has no operation description`,
      );
    }
  }
  return problems;
}

describe("a country with no demo data", () => {
  it("writes a United Kingdom demo in English alone", () => {
    expect(
      demoLanguagesFor(DEMO_DATA_SETS["casa-delgado-es"]!, { country: "GB", area: null }),
    ).toEqual({ defaultLanguage: "en", languages: ["en"], required: [] });
  });

  it("writes a set that is not the pack's own in English, keeping the area's required languages on", () => {
    expect(
      demoLanguagesFor(
        { ...DEMO_DATA_SETS["casa-delgado-es"]!, id: "not-spains" },
        { country: "ES", area: "08" },
      ),
    ).toEqual({ defaultLanguage: "en", languages: ["en", "ca", "es"], required: ["ca", "es"] });
    expect(
      demoLanguagesFor(DEMO_DATA_SETS["casa-delgado-es"]!, { country: "ES", area: "08" }),
    ).toEqual({ defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] });
  });

  it("seeds the pack's own data set, or Casa Delgado when the identity names none", () => {
    const spain = getCountryPack("ES")!.demo!;
    const identity: CountryDemoIdentity = {
      legalName: spain.legalName,
      taxId: spain.taxId,
      locationName: spain.locationName,
      departmentTradingNames: spain.departmentTradingNames,
    };
    expect(demoDataSetFor(spain)).toBe(DEMO_DATA_SETS["casa-delgado-es"]);
    expect(demoDataSetFor(identity)).toBe(DEMO_DATA_SETS["casa-delgado-es"]);
  });

  it("offers at setup only packs a Demo can be seeded for", () => {
    expect(VENUE_SETUP_COUNTRY_PACKS.length).toBeGreaterThan(0);
    expect(VENUE_SETUP_COUNTRY_PACKS.flatMap(setupProblems)).toEqual([]);
  });

  it("names both problems of a United Kingdom pack offered at setup", () => {
    expect(setupProblems({ ...getCountryPack("GB")!, availableForVenueSetup: true })).toEqual([
      "GB: no demo identity",
      "GB GB-vat: none has no operation description",
    ]);
  });
});
