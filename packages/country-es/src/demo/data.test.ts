import type { CountryDemoData } from "@waitron/country";
import {
  CASA_DELGADO_CA,
  CASA_DELGADO_ES,
  CASA_DELGADO_GL,
  CASA_DELGADO_VALENCIA,
  DEMO_MEDIA_ROOTS,
} from "./index.js";
import { SPAIN } from "../spain.js";
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
      "drinksImage",
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
      kitchen: {
        en: "Kitchen",
        es: "Cocina",
        ca: "Cuina",
        "ca-ES-valencia": "Cuina",
        gl: "Cociña",
      },
      downstairsBar: {
        en: "Downstairs bar prep",
        es: "Preparación del bar de abajo",
        ca: "Preparació del bar de baix",
        "ca-ES-valencia": "Preparació del bar de baix",
        gl: "Preparación do bar de abaixo",
      },
      upstairsBar: {
        en: "Upstairs bar prep",
        es: "Preparación del bar de arriba",
        ca: "Preparació del bar de dalt",
        "ca-ES-valencia": "Preparació del bar de dalt",
        gl: "Preparación do bar de arriba",
      },
      deli: {
        en: "Deli prep",
        es: "Preparación de charcutería",
        ca: "Preparació de xarcuteria",
        "ca-ES-valencia": "Preparació de xarcuteria",
        gl: "Preparación de charcutaría",
      },
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

  it.each([CASA_DELGADO_ES, CASA_DELGADO_CA, CASA_DELGADO_GL, CASA_DELGADO_VALENCIA])(
    "$id ships a photo for each menu section",
    ({ mediaDataSet, menus }) => {
      const url = DEMO_MEDIA_ROOTS[mediaDataSet]!;
      const categories = [menus.restaurant, menus.deli, menus.lunch].flatMap((menu) => [
        ...menu.categories,
      ]);
      for (const category of categories) {
        expect(category.sectionImage, category.name.en).toMatch(/^section-.+\.png$/);
        expect(existsSync(new URL(category.sectionImage, url)), category.sectionImage).toBe(true);
      }
      for (const image of [menus.drinksImage, menus.deli.listedSection.image]) {
        expect(image).toMatch(/^section-.+\.png$/);
        expect(existsSync(new URL(image, url)), image).toBe(true);
      }
    },
  );

  it("provides the complete Madrid developer geography without importing server defaults", async () => {
    const { DEMO_DEVELOPER_PRESETS } = await demo();
    expect(DEMO_DEVELOPER_PRESETS.madrid).toEqual({
      country: "ES",
      dataSet: "casa-delgado-es",
      venueName: "Casa Delgado",
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

it("provides English and Spanish for every authored staff and kitchen field", () => {
  const set: CountryDemoData = CASA_DELGADO_ES;
  const texts: (readonly [string, Readonly<Record<string, string | undefined>> | undefined])[] = [
    ...Object.entries(set.stations),
    ["printer", set.printerName],
    ["special day", set.specialDayName],
    ["deli period", set.deliPeriodName],
    ...Object.entries(set.restaurantPeriodNames),
    ["drinks menu", set.menus.drinksName],
    ["floor set", set.floor.setName],
    ...Object.entries(set.floor.departmentNames),
    ["upstairs bar zone", set.floor.upstairsBarZone],
    ["deli counter zone", set.floor.deliCounterZone],
    ...set.floor.zones.map((zone) => [zone.key, zone.name] as const),
  ];
  for (const [id, menu] of Object.entries({
    restaurant: set.menus.restaurant,
    deli: set.menus.deli,
    lunch: set.menus.lunch,
  })) {
    texts.push([id, menu.name]);
    for (const category of menu.categories) {
      texts.push([`${id} category`, category.categoryName ?? category.name]);
      for (const product of category.products) {
        texts.push(
          [`${product.image} staff`, product.staffName],
          [`${product.image} kitchen`, product.kitchenName],
        );
        if (product.unit)
          texts.push(
            [`${product.image} unit`, product.unit.staffName],
            [`${product.image} abbreviation`, product.unit.staffAbbreviation],
          );
        for (const [i, variant] of (product.variants ?? []).entries())
          texts.push(
            [`${product.image} variant ${i} staff`, variant.staffName],
            [`${product.image} variant ${i} kitchen`, variant.kitchenName],
          );
      }
    }
  }
  for (const { lists } of set.productOptionLists)
    for (const list of lists) {
      texts.push(["options staff", list.name], ["options kitchen", list.kitchenName]);
      for (const label of list.labels)
        texts.push(["label staff", label.name], ["label kitchen", label.kitchenName]);
    }
  for (const { lists } of set.productExtraLists)
    for (const list of lists)
      texts.push(["extras staff", list.name], ["extras kitchen", list.kitchenName]);
  for (const reason of set.adjustmentReasons) texts.push(["reason", reason.names]);
  for (const [where, text] of texts)
    for (const language of ["en", "es"])
      expect(text?.[language]?.trim(), `${where} ${language}`).toBeTruthy();
});

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

describe("Casa Delgado courses", () => {
  const sets: CountryDemoData[] = [
    CASA_DELGADO_ES,
    CASA_DELGADO_CA,
    CASA_DELGADO_VALENCIA,
    CASA_DELGADO_GL,
  ];

  it.each(sets)("defines every course used in $id in firing order", (set) => {
    expect(set.courses?.map((course) => course.key)).toEqual([
      "sharing",
      "starters",
      "mains",
      "desserts",
      "coffee",
      "drinks",
      "bread",
    ]);
    expect(set.courses?.slice(0, 4).map((course) => "starter" in course && course.starter)).toEqual(
      SPAIN.starterCourses?.map(({ name }) => name),
    );
    expect(set.courses?.slice(4).map((course) => "fireNow" in course && course.fireNow)).toEqual([
      false,
      true,
      true,
    ]);
    const available = new Set(set.courses?.map(({ key }) => key));
    for (const menu of [set.menus.restaurant, set.menus.lunch]) {
      for (const category of menu.categories) {
        for (const product of category.products) {
          expect(available.has((product.course ?? category.course)!), product.image).toBe(true);
        }
      }
    }
  });

  it("assigns each Madrid dish to its course and leaves deli food without one", () => {
    const expected = {
      sharing: [
        "patatas-bravas",
        "croquetas",
        "gambas-al-ajillo",
        "tortilla",
        "pan-con-tomate",
        "pulpo-a-la-gallega",
        "pimientos-de-padron",
        "calamares",
        "tabla-de-quesos",
      ],
      starters: ["gazpacho", "ensalada-mixta", "lentejas"],
      mains: ["paella", "solomillo", "bacalao", "merluza", "pollo-asado", "merluza-rebozada"],
      desserts: ["crema-catalana", "tarta-de-santiago", "flan", "arroz-con-leche"],
      coffee: ["cafe-solo"],
      drinks: [
        "negroni",
        "vino-tinto",
        "cana-cerveza",
        "botellin-cerveza",
        "refresco-cola",
        "agua-mineral",
        "zumo-naranja",
        "coca-cola-zero-lata",
      ],
      bread: ["pan-de-la-casa"],
    };
    const { restaurant, lunch, deli } = sets[0]!.menus;
    const assignments = [restaurant, lunch].flatMap((menu) =>
      menu.categories.flatMap((category) =>
        category.products.map((product) => [product.image, product.course ?? category.course]),
      ),
    );
    expect(Object.fromEntries(assignments)).toEqual(
      Object.fromEntries(
        Object.entries(expected).flatMap(([course, images]) =>
          images.map((image) => [image + ".png", course]),
        ),
      ),
    );
    for (const category of deli.categories) {
      for (const product of category.products) {
        expect(product.course ?? category.course, product.image).toBeUndefined();
      }
    }
  });
});

describe("Casa Delgado VAT classes", () => {
  const sets: CountryDemoData[] = [
    CASA_DELGADO_ES,
    CASA_DELGADO_CA,
    CASA_DELGADO_VALENCIA,
    CASA_DELGADO_GL,
  ];

  // LIVA art. 91.Uno.2.2.º: food and drink served to consume on the spot is taxed at the reduced rate.
  it("puts every product sold to eat or drink in at the reduced rate, in every regional variant", () => {
    const offenders = sets.flatMap((set) =>
      [set.menus.restaurant, set.menus.lunch].flatMap((menu) =>
        menu.categories.flatMap((category) =>
          category.products
            .filter((product) => product.vatClass !== "reduced")
            .map((product) => `${set.id}: ${product.staffName?.en ?? product.image}`),
        ),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // LIVA art. 91.Dos.1.1.º d puts cheese sold as goods at 4%; the deli's other food is at 10% (art. 91.Uno.1.1.º).
  it("sells the takeaway cheeses at 4% and the other deli goods at the area's takeaway rate, 10%", () => {
    const areaDefault = SPAIN.fiscalJurisdictions.find(
      ({ id }) => id === "ES-common",
    )?.defaultTakeawayVatRate;
    expect(areaDefault).toBe("10.00");
    const expected = {
      "Iberian ham": ["reduced", "10.00"],
      Chorizo: ["reduced", "10.00"],
      "Pork loin": ["reduced", "10.00"],
      Salchichón: ["reduced", "10.00"],
      Cecina: ["reduced", "10.00"],
      Sobrasada: ["reduced", "10.00"],
      Manchego: ["super_reduced", "4.00"],
      Cabrales: ["super_reduced", "4.00"],
      Idiazábal: ["super_reduced", "4.00"],
      "Torta cheese": ["super_reduced", "4.00"],
      Mahón: ["super_reduced", "4.00"],
      Anchovies: ["reduced", "10.00"],
      Olives: ["reduced", "10.00"],
      "Octopus in oil": ["reduced", "10.00"],
      "Tuna belly": ["reduced", "10.00"],
    };
    for (const set of sets)
      expect(
        Object.fromEntries(
          set.menus.deli.categories.flatMap((category) =>
            category.products.map((product) => [
              product.staffName?.en ?? product.image,
              [product.vatClass, product.takeawayVatRate ?? areaDefault],
            ]),
          ),
        ),
        set.id,
      ).toEqual(expected);
  });
  // Art. 91.Uno.1.1.º excludes alcoholic drinks and sweetened soft drinks from the reduced rate for
  // goods, so taken away they take the general 21% (art. 90.Uno).
  it("lists the restaurant's cola, Coca-Cola Zero and bottled beer in the deli, served at the reduced rate and taken away at 21%", () => {
    const drinks = ["refresco-cola.png", "coca-cola-zero-lata.png", "botellin-cerveza.png"];
    for (const set of sets) {
      const restaurant = set.menus.restaurant.categories.flatMap((category) => category.products);
      expect(
        drinks.map((image) => {
          const product = restaurant.find((candidate) => candidate.image === image);
          return [image, product?.vatClass, product?.takeawayVatRate];
        }),
        set.id,
      ).toEqual(drinks.map((image) => [image, "reduced", "21.00"]));
      expect(set.menus.deli.listedSection?.productImages, set.id).toEqual(drinks);
      expect(set.menus.deli.listedSection?.name.en, set.id).toBe("Drinks");
      const deliOwn = set.menus.deli.categories.flatMap((category) => category.products);
      expect(
        deliOwn.filter(
          (product) =>
            product.vatClass === "general" ||
            /cola|beer/i.test(product.staffName?.en ?? product.image),
        ),
        set.id,
      ).toEqual([]);
    }
  });

  it("gives a takeaway rate only to the deli's cheeses and the drinks the deli lists", () => {
    for (const set of sets)
      expect(
        [set.menus.restaurant, set.menus.deli, set.menus.lunch]
          .flatMap((menu) => menu.categories)
          .flatMap((category) => category.products)
          .filter((product) => product.takeawayVatRate !== undefined)
          .map((product) => [product.image, product.takeawayVatRate])
          .sort(),
        set.id,
      ).toEqual([
        ["botellin-cerveza.png", "21.00"],
        ["cabrales.png", "4.00"],
        ["coca-cola-zero-lata.png", "21.00"],
        ["idiazabal.png", "4.00"],
        ["mahon.png", "4.00"],
        ["manchego-curado.png", "4.00"],
        ["refresco-cola.png", "21.00"],
        ["torta-del-casar.png", "4.00"],
      ]);
  });
});

it("keeps demo prep-station names distinct from zones in every demo language", () => {
  const set = CASA_DELGADO_ES;
  const zones = [
    ...set.floor.zones.map((zone) => zone.name),
    set.floor.upstairsBarZone,
    set.floor.deliCounterZone,
  ];
  for (const locale of set.contentLanguages) {
    const zoneNames = zones.map((name) => name[locale]);
    for (const station of Object.values(set.stations))
      expect(zoneNames, `${locale}: ${station[locale]}`).not.toContain(station[locale]);
  }
});
