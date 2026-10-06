import { describe, expect, it } from "vitest";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import { CASA_DELGADO, DELI_TAKEAWAY, MENU_DEL_DIA, PRODUCT_OPTION_LISTS } from "./menu.js";
import { DEMO_STATUSES, DEMO_TABLES, DEMO_ZONES } from "./floor.js";
import { DEMO_STAFF } from "./staff.js";
import { DEMO_ADJUSTMENT_REASONS } from "./seed-adjustments.js";
import { DEMO_DATA_SETS, demoDataSet, inLanguages } from "./data-set.js";

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
});
