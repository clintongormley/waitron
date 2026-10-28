import { describe, expect, it } from "vitest";
import type { CountryDemoData } from "@waitron/country";
import * as demos from "./index.js";

function regional(): CountryDemoData {
  expect(demos).toHaveProperty("CASA_DELGADO_CA");
  return demos.CASA_DELGADO_CA;
}
const images = [
  "catalonia-escalivada.png",
  "catalonia-esqueixada.png",
  "catalonia-botifarra.png",
  "catalonia-fideua.png",
  "catalonia-mel-mato.png",
  "catalonia-canelons.png",
  "catalonia-suquet.png",
  "catalonia-cava.png",
];
describe("Catalan practice restaurant", () => {
  it("adds seven kitchen dishes and a bar wine without replacing inherited customer maps", () => {
    const set = regional();
    expect(set.id).toBe("casa-delgado-ca");
    expect(set.mediaDataSet).toBe(set.id);
    expect(set.contentLanguages).toEqual(["ca", "es", "en"]);
    expect(set.plainNameLanguage).toBe("ca");
    const products = [set.menus.restaurant, set.menus.deli, set.menus.lunch].flatMap((m) =>
      m.categories.flatMap((c) => c.products),
    );
    const baseSet: CountryDemoData = demos.CASA_DELGADO_ES;
    const base = [baseSet.menus.restaurant, baseSet.menus.deli, baseSet.menus.lunch].flatMap((m) =>
      m.categories.flatMap((c) => c.products),
    );
    expect(products).toHaveLength(base.length + 8);
    for (const original of base) {
      const row = products.find((p) => p.image === original.image)!;
      expect(row.customerName).toStrictEqual(original.customerName);
      expect(row.description).toStrictEqual(original.description);
      expect(row.variants?.map((v) => v.customerName)).toStrictEqual(
        original.variants?.map((v) => v.customerName),
      );
    }
    expect(set.menus.restaurant.categories).toHaveLength(
      demos.CASA_DELGADO_ES.menus.restaurant.categories.length + 1,
    );
    expect(
      set.menus.restaurant.categories.find((c) => c.products.some((p) => p.image === images[7]))
        ?.station,
    ).toBe("bar");
    expect(new Set(products.map((p) => p.image)).size).toBe(products.length);
    const section = set.menus.restaurant.categories.find((c) =>
      c.products.some((p) => p.image === images[0]),
    )!;
    expect(section.station).toBe("kitchen");
    expect(section.name.ca).toBe("Especialitats de la casa");
    expect(demos.CASA_DELGADO_ES.menus.restaurant.categories.map((c) => c.color)).not.toContain(
      section.color,
    );
    const added = images.map((image) => products.find((p) => p.image === image)!);
    expect(added.map((p) => p.unitPrice)).toEqual([
      "8.50",
      "11.50",
      "13.50",
      "15.50",
      "5.50",
      "12.50",
      "17.50",
      "4.50",
    ]);
    expect(added.map((p) => p.vatClass)).toEqual([...Array(7).fill("reduced"), "general"]);
    for (const p of added) {
      expect(Object.keys(p.customerName).sort()).toEqual(["ca", "en", "es"]);
      expect(p.pricingUnit).toBe("each");
      expect(p.variants).toBeUndefined();
      expect(p.dietaryDeclarations).toBeUndefined();
      expect(new Set([p.staffName!.ca, p.kitchenName!.ca, p.customerName.ca]).size).toBe(3);
    }
    expect(added[2]).toMatchObject({
      staffName: { ca: "Botifarra amb mongetes" },
      kitchenName: { ca: "Botifarra amb mongetes · cuina" },
      customerName: {
        ca: "Botifarra amb mongetes de la casa",
        es: "Butifarra con judías de la casa",
        en: "House Catalan sausage with white beans",
      },
    });
  });
  it("provides every plain field in Catalan with separate staff and kitchen wording", () => {
    const set = regional();
    let pairs = 0;
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const v = value as Record<string, unknown>;
      if (typeof v.en === "string" && typeof v.es === "string") {
        expect(v.ca, v.en).toBeTypeOf("string");
        pairs++;
      } else for (const child of Object.values(v)) visit(child);
    }
    visit(set);
    expect(pairs).toBeGreaterThan(150);
    for (const m of [set.menus.restaurant, set.menus.deli, set.menus.lunch])
      for (const c of m.categories)
        for (const p of c.products) {
          expect(p.staffName?.ca).toBeTruthy();
          expect(p.kitchenName?.ca).toBeTruthy();
          expect(
            new Set([
              p.staffName!.ca!.toLowerCase(),
              p.kitchenName!.ca!.toLowerCase(),
              p.customerName.ca!.toLowerCase(),
            ]).size,
            p.image,
          ).toBe(3);
          for (const v of p.variants ?? [])
            expect(new Set([v.staffName!.ca, v.kitchenName!.ca, v.customerName.ca]).size).toBe(3);
        }
  });
  it("keeps regional people and account capabilities distinct from credentials", () => {
    const set = regional();
    expect(set.staff.map((p) => p.displayName)).toEqual([
      "Jordi Puig",
      "Montse Vila",
      "Núria Soler",
      "Pau Ferrer",
      "Laia Roca",
    ]);
    expect(set.staff.map((p) => p.role)).toEqual([
      "manager",
      "supervisor",
      "staff",
      "staff",
      "staff",
    ]);
    expect(set.staff.map((p) => p.dashboardLogin)).toEqual([true, false, false, false, false]);
    expect(set.staff.map((p) => p.email)).toEqual(
      ["manager", "montse", "nuria", "pau", "laia"].map((n) => `${n}@demo.waitron.local`),
    );
    for (const person of set.staff) {
      expect(person).not.toHaveProperty("password");
      expect(person).not.toHaveProperty("pin");
    }
  });
});

describe("Valencian practice restaurant", () => {
  function valencian(): CountryDemoData {
    expect(demos).toHaveProperty("CASA_DELGADO_VALENCIA");
    return (demos as unknown as Record<string, CountryDemoData>).CASA_DELGADO_VALENCIA!;
  }
  it("adds regional dishes and wine while preserving inherited customer wording", () => {
    const set = valencian();
    expect(set.id).toBe("casa-delgado-valencia");
    expect(set.mediaDataSet).toBe("casa-delgado-valencia");
    expect(set.plainNameLanguage).toBe("ca-ES-valencia");
    expect(set.contentLanguages).toEqual(["ca-ES-valencia", "es", "en"]);
    const all = (data: CountryDemoData) =>
      [data.menus.restaurant, data.menus.deli, data.menus.lunch].flatMap((m) =>
        m.categories.flatMap((c) => c.products),
      );
    const products = all(set);
    const originals = all(demos.CASA_DELGADO_ES);
    expect(products).toHaveLength(originals.length + 8);
    for (const original of originals) {
      const actual = products.find((p) => p.image === original.image)!;
      expect(actual.customerName).toStrictEqual(original.customerName);
      expect(actual.description).toStrictEqual(original.description);
      expect(actual.variants?.map((v) => v.customerName)).toStrictEqual(
        original.variants?.map((v) => v.customerName),
      );
    }
    const names = [
      "All i pebre",
      "Esgarraet",
      "Paella valenciana",
      "Orxata amb fartons",
      "Arròs al forn",
      "Titaina",
      "Arnadí",
      "Copa de vi de Requena",
    ];
    const images = [
      "all-pebre",
      "esgarraet",
      "paella",
      "orxata",
      "arros-forn",
      "titaina",
      "arnadi",
      "wine",
    ];
    const added = images.map((image) => products.find((p) => p.image === `valencia-${image}.png`)!);
    expect(added.map((p) => p.staffName?.["ca-ES-valencia"])).toEqual(names);
    expect(added.map((p) => p.unitPrice)).toEqual([
      "14.50",
      "8.50",
      "16.50",
      "5.50",
      "13.50",
      "9.50",
      "5.50",
      "4.00",
    ]);
    expect(added.map((p) => p.vatClass)).toEqual([...Array(7).fill("reduced"), "general"]);
    const section = set.menus.restaurant.categories.at(-1)!;
    expect(section.name["ca-ES-valencia"]).toBe("Especialitats de l'Horta");
    expect(section.station).toBe("kitchen");
    expect(set.menus.restaurant.categories).toHaveLength(
      demos.CASA_DELGADO_ES.menus.restaurant.categories.length + 1,
    );
    expect(demos.CASA_DELGADO_ES.menus.restaurant.categories.map((c) => c.color)).not.toContain(
      section.color,
    );
    expect(
      set.menus.restaurant.categories.find((c) => c.products.includes(added[7]!))?.station,
    ).toBe("bar");
    expect(new Set(products.map((p) => p.image)).size).toBe(products.length);
    for (const product of added) {
      expect(Object.keys(product.customerName).sort()).toEqual(["ca-ES-valencia", "en", "es"]);
      expect(product.pricingUnit).toBe("each");
      expect(product.variants).toBeUndefined();
      expect(product.dietaryDeclarations).toBeUndefined();
    }
  });
  it("provides complete Valencian plain maps and distinct product names", () => {
    const set = valencian();
    let pairs = 0;
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const map = value as Record<string, unknown>;
      if (typeof map.en === "string" && typeof map.es === "string") {
        expect(map["ca-ES-valencia"], map.en).toBeTypeOf("string");
        pairs++;
      } else for (const child of Object.values(map)) visit(child);
    }
    visit(set);
    expect(pairs).toBeGreaterThan(150);
    for (const m of [set.menus.restaurant, set.menus.deli, set.menus.lunch])
      for (const c of m.categories)
        for (const p of c.products) {
          expect(
            new Set([
              p.staffName?.["ca-ES-valencia"]?.toLowerCase(),
              p.kitchenName?.["ca-ES-valencia"]?.toLowerCase(),
              p.customerName["ca-ES-valencia"]?.toLowerCase(),
            ]).size,
            p.image,
          ).toBe(3);
          for (const v of p.variants ?? [])
            expect(
              new Set([
                v.staffName?.["ca-ES-valencia"],
                v.kitchenName?.["ca-ES-valencia"],
                v.customerName["ca-ES-valencia"],
              ]).size,
            ).toBe(3);
        }
  });
  it("provides regional people and unchanged account capabilities without credentials", () => {
    const people = valencian().staff;
    expect(people.map((p) => p.displayName)).toEqual([
      "Vicent Ferrer",
      "Amparo Soler",
      "Neus Martí",
      "Pau Sanchis",
      "Clara Peris",
    ]);
    expect(people.map((p) => p.email)).toEqual(
      ["manager", "amparo", "neus", "pau", "clara"].map((n) => `${n}@demo.waitron.local`),
    );
    expect(people.map((p) => p.role)).toEqual(["manager", "supervisor", "staff", "staff", "staff"]);
    expect(people.map((p) => p.dashboardLogin)).toEqual([true, false, false, false, false]);
    for (const p of people) {
      expect(p).not.toHaveProperty("pin");
      expect(p).not.toHaveProperty("password");
    }
  });
});
