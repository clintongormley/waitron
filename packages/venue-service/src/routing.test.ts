import { describe, expect, it } from "vitest";
import { getCountryPack } from "@waitron/country-packs";
import {
  cellKey,
  changeReach,
  chooseMaker,
  chooseExtraMaker,
  chooseExtraMakerBeside,
  closedSendsTo,
  followFallbacks,
  folderAncestors,
  rowKey,
  selectRoutingCell,
  stationStatus,
  parseTargetKey,
  targetKey,
  type CellAddress,
  type MakerChoice,
  type ProductFacts,
  type RouteTarget,
  type RoutingCell,
  type RoutingMoment,
  type RoutingRow,
  type RoutingRules,
  type StationTiming,
} from "./routing.js";

const station = (stationId: string) => ({ kind: "station" as const, stationId });
const noPreparation = { kind: "no_preparation" as const };
const all: RoutingRow = { kind: "all" };
const category = (categoryId: string): RoutingRow => ({ kind: "category", categoryId });
const product = (productId: string): RoutingRow => ({ kind: "product", productId });
/** Each cell names its own coordinate; the order of the list never decides anything. */
const cells = (
  ...entries: readonly (readonly [RoutingRow, string | null, RouteTarget])[]
): RoutingCell[] => entries.map(([row, zoneId, target]) => ({ row, zoneId, target }));
const decidedByCell = (row: RoutingRow, zoneId: string | null) => ({
  kind: "cell" as const,
  address: { row, zoneId },
});
const without = (rules: RoutingRules, row: RoutingRow, zoneId: string | null): RoutingRules => ({
  ...rules,
  cells: rules.cells.filter(
    (cell) => !(JSON.stringify(cell.row) === JSON.stringify(row) && cell.zoneId === zoneId),
  ),
});

const parentOf = new Map<string, string | null>([
  ["drinks", null],
  ["cocktails", "drinks"],
  ["beer", "drinks"],
  ["food", null],
]);
const base: RoutingRules = {
  cells: cells(
    [category("drinks"), null, station("bar")],
    [category("cocktails"), null, station("cocktailBar")],
  ),
  parentOf,
  activeStationIds: new Set(["bar", "cocktailBar", "mainBar", "terraceBar", "kitchen"]),
  defaultStationId: "kitchen",
  timing: new Map(),
};
const mojito = { productId: "mojito", routedProductId: "mojito", categoryId: "cocktails" };
const lager = { productId: "lager", routedProductId: "lager", categoryId: "beer" };
const bread = { productId: "bread", routedProductId: "bread", categoryId: null };

describe("chooseMaker", () => {
  it("gives the nearest category's Every zone cell, and an unset subcategory its parent's", () => {
    expect(chooseMaker(base, mojito, null, null)).toEqual({
      route: station("cocktailBar"),
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(base, lager, "indoors", null).decidedBy).toEqual(
      decidedByCell(category("drinks"), null),
    );
    expect(chooseMaker(base, bread, "indoors", null)).toEqual({
      route: station("kitchen"),
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
    });
  });

  describe("row-first selection", () => {
    const drinksCategoryId = "0b8f2a52-6c1e-4f0e-9a51-2d7c1f3e9a01";
    const cocktailsCategoryId = "0b8f2a52-6c1e-4f0e-9a51-2d7c1f3e9a02";
    const coffeeCategoryId = "0b8f2a52-6c1e-4f0e-9a51-2d7c1f3e9a03";
    const terraceId = "5d1a7c40-8e2b-4b7a-a3f6-0c9e4d2b7f11";
    const barId = "a7e3c1d9-2f4b-4e8a-9c6d-1b0f5e7a3c21";
    const terraceBarId = "a7e3c1d9-2f4b-4e8a-9c6d-1b0f5e7a3c22";
    const kitchenId = "a7e3c1d9-2f4b-4e8a-9c6d-1b0f5e7a3c23";
    const rules: RoutingRules = {
      cells: cells(
        [category(drinksCategoryId), null, station(barId)],
        [category(drinksCategoryId), terraceId, station(terraceBarId)],
        [category(coffeeCategoryId), null, station(kitchenId)],
      ),
      parentOf: new Map([
        [drinksCategoryId, null],
        [cocktailsCategoryId, drinksCategoryId],
        [coffeeCategoryId, drinksCategoryId],
      ]),
      activeStationIds: new Set([barId, terraceBarId, kitchenId]),
      defaultStationId: null,
      timing: new Map(),
    };
    const coffee = {
      productId: "flat-white",
      routedProductId: "flat-white",
      categoryId: coffeeCategoryId,
    };
    const cocktail = {
      productId: "mojito",
      routedProductId: "mojito",
      categoryId: cocktailsCategoryId,
    };

    it("a category's own Every zone beats its parent's zone cell; an unset child inherits the parent's zone cell", () => {
      expect(chooseMaker(rules, coffee, terraceId, null)).toEqual({
        route: { kind: "station", stationId: kitchenId },
        decidedBy: {
          kind: "cell",
          address: {
            row: { kind: "category", categoryId: coffeeCategoryId },
            zoneId: null,
          },
        },
        fallbacks: [],
        noReplacement: false,
      });
      expect(chooseMaker(rules, cocktail, terraceId, null)).toEqual({
        route: { kind: "station", stationId: terraceBarId },
        decidedBy: decidedByCell(category(drinksCategoryId), terraceId),
        fallbacks: [],
        noReplacement: false,
      });
      const reversed = { ...rules, cells: [...rules.cells].reverse() };
      expect(chooseMaker(reversed, coffee, terraceId, null)).toEqual(
        chooseMaker(rules, coffee, terraceId, null),
      );
      expect(chooseMaker(reversed, cocktail, terraceId, null)).toEqual(
        chooseMaker(rules, cocktail, terraceId, null),
      );
    });

    it("leaves a product outside the conflicting category on its own row's cells", () => {
      const water = { productId: "water", routedProductId: "water", categoryId: drinksCategoryId };
      expect(chooseMaker(rules, water, null, null).decidedBy).toEqual(
        decidedByCell(category(drinksCategoryId), null),
      );
      expect(chooseMaker(rules, water, terraceId, null).route).toEqual(station(terraceBarId));
    });
  });

  it("a product's Every zone beats its category's zone cell", () => {
    const rules: RoutingRules = {
      ...base,
      cells: cells(
        [category("cocktails"), "terrace", station("terraceBar")],
        [product("mojito"), null, station("mainBar")],
      ),
    };
    expect(chooseMaker(rules, mojito, "terrace", null)).toEqual({
      route: station("mainBar"),
      decidedBy: decidedByCell(product("mojito"), null),
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("a product's zone cell beats its own Every zone cell", () => {
    const rules: RoutingRules = {
      ...base,
      cells: cells(
        [product("mojito"), null, station("mainBar")],
        [product("mojito"), "terrace", station("terraceBar")],
      ),
    };
    expect(chooseMaker(rules, mojito, "terrace", null)).toEqual({
      route: station("terraceBar"),
      decidedBy: decidedByCell(product("mojito"), "terrace"),
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(rules, mojito, "indoors", null).decidedBy).toEqual(
      decidedByCell(product("mojito"), null),
    );
  });

  it("clearing the winning cell exposes the next exact coordinate", () => {
    const ladder: [RoutingRow, string | null][] = [
      [product("mojito"), "terrace"],
      [product("mojito"), null],
      [category("cocktails"), "terrace"],
      [category("cocktails"), null],
      [category("drinks"), "terrace"],
      [category("drinks"), null],
      [all, "terrace"],
    ];
    let rules: RoutingRules = {
      ...base,
      cells: cells(...ladder.map(([row, zoneId]) => [row, zoneId, station("bar")] as const)),
    };
    for (const [row, zoneId] of ladder) {
      expect(chooseMaker(rules, mojito, "terrace", null).decidedBy).toEqual(
        decidedByCell(row, zoneId),
      );
      rules = without(rules, row, zoneId);
    }
    expect(chooseMaker(rules, mojito, "terrace", null).decidedBy).toEqual({ kind: "default" });
  });

  it("walks five category depths in order", () => {
    const depths = ["l1", "l2", "l3", "l4", "l5"];
    const deep: RoutingRules = {
      ...base,
      parentOf: new Map(depths.map((id, i) => [id, i === 0 ? null : depths[i - 1]!])),
      cells: cells(
        [category("l1"), "terrace", station("terraceBar")],
        [category("l2"), null, station("bar")],
        [category("l4"), "terrace", station("mainBar")],
      ),
    };
    const shot = { productId: "shot", routedProductId: "shot", categoryId: "l5" };
    expect(chooseMaker(deep, shot, "terrace", null).decidedBy).toEqual(
      decidedByCell(category("l4"), "terrace"),
    );
    expect(chooseMaker(deep, shot, "indoors", null).decidedBy).toEqual(
      decidedByCell(category("l2"), null),
    );
    const l2Cleared = without(deep, category("l2"), null);
    expect(chooseMaker(l2Cleared, shot, "indoors", null).decidedBy).toEqual({ kind: "default" });
    expect(
      chooseMaker(without(deep, category("l4"), "terrace"), shot, "terrace", null).decidedBy,
    ).toEqual(decidedByCell(category("l2"), null));
    expect(
      chooseMaker(without(l2Cleared, category("l4"), "terrace"), shot, "terrace", null).decidedBy,
    ).toEqual(decidedByCell(category("l1"), "terrace"));
  });

  it("terminates on a category cycle", () => {
    const loop: RoutingRules = {
      ...base,
      parentOf: new Map([
        ["a", "b"],
        ["b", "a"],
      ]),
      cells: cells([category("b"), null, station("bar")]),
    };
    const item = { productId: "item", routedProductId: "item", categoryId: "a" };
    expect(chooseMaker(loop, item, "terrace", null).decidedBy).toEqual(
      decidedByCell(category("b"), null),
    );
    expect(chooseMaker({ ...loop, cells: [] }, item, "terrace", null).decidedBy).toEqual({
      kind: "default",
    });
  });

  it("routes a variant by its parent's product cell and its effective category", () => {
    const rules: RoutingRules = {
      ...base,
      cells: cells(
        [product("lager"), "terrace", noPreparation],
        [product("lager-pint"), null, station("mainBar")],
      ),
    };
    const lagerPint = { productId: "lager-pint", routedProductId: "lager", categoryId: "beer" };
    expect(chooseMaker(rules, lagerPint, "terrace", null)).toEqual({
      route: noPreparation,
      decidedBy: decidedByCell(product("lager"), "terrace"),
      fallbacks: [],
      noReplacement: false,
    });
    expect(
      chooseMaker({ ...rules, cells: [...rules.cells, ...base.cells] }, lagerPint, "indoors", null)
        .decidedBy,
    ).toEqual(decidedByCell(category("drinks"), null));
    expect(chooseMaker(rules, lagerPint, "indoors", null).decidedBy).toEqual({ kind: "default" });
  });

  it("routes by the category the facts carry, not by the routed product's", () => {
    const mocktail = { productId: "virgin", routedProductId: "mojito", categoryId: "food" };
    expect(chooseMaker(base, mocktail, null, null).decidedBy).toEqual({ kind: "default" });
  });

  it("a null-category product tries its product cells, then All categories × the zone, then the default", () => {
    const rules: RoutingRules = {
      ...base,
      cells: cells(
        [product("bread"), "terrace", station("bar")],
        [all, "terrace", station("terraceBar")],
        [all, "indoors", station("mainBar")],
      ),
    };
    expect(chooseMaker(rules, bread, "terrace", null).decidedBy).toEqual(
      decidedByCell(product("bread"), "terrace"),
    );
    expect(
      chooseMaker(without(rules, product("bread"), "terrace"), bread, "terrace", null),
    ).toEqual({
      route: station("terraceBar"),
      decidedBy: decidedByCell(all, "terrace"),
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(rules, bread, "garden", null)).toEqual({
      route: station("kitchen"),
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("a null zone tries only Every zone cells", () => {
    const rules: RoutingRules = {
      ...base,
      cells: cells(
        [product("mojito"), "terrace", station("terraceBar")],
        [category("cocktails"), "terrace", station("mainBar")],
        [category("drinks"), null, station("bar")],
        [all, "terrace", station("terraceBar")],
      ),
    };
    expect(chooseMaker(rules, mojito, null, null).decidedBy).toEqual(
      decidedByCell(category("drinks"), null),
    );
    expect(chooseMaker(rules, bread, null, null).decidedBy).toEqual({ kind: "default" });
  });

  it("explicit No preparation stops the walk with no fallback", () => {
    const rules: RoutingRules = {
      ...base,
      cells: cells(
        [category("cocktails"), null, noPreparation],
        [category("drinks"), null, station("bar")],
        [all, "terrace", noPreparation],
      ),
    };
    expect(chooseMaker(rules, mojito, "terrace", null)).toEqual({
      route: noPreparation,
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(rules, bread, "terrace", null)).toEqual({
      route: noPreparation,
      decidedBy: decidedByCell(all, "terrace"),
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("a closed or disabled chosen station follows its fallback chain, never the next routing row", () => {
    const rules: RoutingRules = {
      ...base,
      activeStationIds: new Set(["bar", "mainBar", "kitchen"]),
      cells: cells(
        [category("cocktails"), null, station("cocktailBar")],
        [category("drinks"), null, noPreparation],
      ),
    };
    expect(chooseMaker(rules, mojito, null, null)).toEqual({
      route: null,
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [{ stationId: "cocktailBar", why: "switched_off" }],
      noReplacement: true,
    });
    const withFallback = {
      ...rules,
      timing: new Map([["cocktailBar", { fallbackId: "mainBar", hours: [], today: null }]]),
    };
    expect(chooseMaker(withFallback, mojito, null, null)).toEqual({
      route: station("mainBar"),
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [{ stationId: "cocktailBar", why: "switched_off" }],
      noReplacement: false,
    });
    const closedByHand: RoutingRules = {
      ...rules,
      activeStationIds: new Set(["bar", "cocktailBar", "mainBar", "kitchen"]),
      timing: new Map([
        ["cocktailBar", { fallbackId: "mainBar", hours: [], today: "closed" as const }],
        ["mainBar", { fallbackId: "cocktailBar", hours: [], today: "closed" as const }],
      ]),
    };
    expect(chooseMaker(closedByHand, mojito, null, at(FRI, "20:00"))).toEqual({
      route: null,
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [
        { stationId: "cocktailBar", why: "closed_by_hand" },
        { stationId: "mainBar", why: "closed_by_hand" },
      ],
      noReplacement: true,
    });
  });

  it("follows a switched-off station's fallback", () => {
    const rules = {
      ...base,
      activeStationIds: new Set(["bar", "mainBar", "kitchen"]),
      timing: new Map([["cocktailBar", { fallbackId: "mainBar", hours: [], today: null }]]),
    };
    expect(chooseMaker(rules, mojito, null, null)).toEqual({
      route: station("mainBar"),
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [{ stationId: "cocktailBar", why: "switched_off" }],
      noReplacement: false,
    });
    expect(chooseMaker({ ...rules, timing: new Map() }, mojito, null, null)).toEqual({
      route: null,
      decidedBy: decidedByCell(category("cocktails"), null),
      fallbacks: [{ stationId: "cocktailBar", why: "switched_off" }],
      noReplacement: true,
    });
  });

  it("never walks a no-preparation target", () => {
    const rules = { ...base, cells: cells([category("drinks"), null, noPreparation]) };
    expect(chooseMaker(rules, lager, null, null).route).toEqual(noPreparation);
  });

  it("returns no route when nothing matches and there is no active default", () => {
    expect(chooseMaker({ ...base, defaultStationId: null }, bread, null, null)).toEqual({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
    });
  });
});

describe("selectRoutingCell", () => {
  const rules: RoutingRules = {
    ...base,
    cells: cells(
      [category("drinks"), "terrace", station("terraceBar")],
      [category("cocktails"), null, station("cocktailBar")],
      [all, "garden", station("mainBar")],
    ),
  };

  it("reads the cell list once per rules object, however many products and zones it routes", () => {
    let scans = 0;
    // Every scan of a non-empty list reads its first element; a lookup by coordinate does not.
    const counted = new Proxy(Object.freeze([...rules.cells]), {
      get(target, property, receiver) {
        if (property === "0") scans++;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const countedRules: RoutingRules = { ...rules, cells: counted };
    const routed = [mojito, lager, bread].flatMap((facts) =>
      ["terrace", "garden", "indoors", null].map(
        (zoneId) => chooseMaker(countedRules, facts, zoneId, null).route,
      ),
    );
    expect(routed).toEqual(
      [mojito, lager, bread].flatMap((facts) =>
        ["terrace", "garden", "indoors", null].map(
          (zoneId) => chooseMaker(rules, facts, zoneId, null).route,
        ),
      ),
    );
    expect(scans).toBe(1);
  });

  it("routes a list changed in place by the cells it holds now", () => {
    const list = cells([category("beer"), null, station("bar")]);
    const changing: RoutingRules = { ...base, cells: list };
    const route = () => selectRoutingCell(changing, product("lager"), null, "beer").target;
    expect(route()).toEqual(station("bar"));
    list.push({ row: product("lager"), zoneId: null, target: station("mainBar") });
    expect(route()).toEqual(station("mainBar"));
    list[1] = { row: product("lager"), zoneId: null, target: noPreparation };
    expect(route()).toEqual(noPreparation);
    list.splice(1, 1);
    expect(route()).toEqual(station("bar"));
    list.splice(0, 1);
    expect(route()).toEqual(station("kitchen"));
  });

  it("selects All categories × the zone, then the implicit default, for the All row", () => {
    expect(selectRoutingCell(rules, all, "garden")).toEqual({
      target: station("mainBar"),
      decidedBy: decidedByCell(all, "garden"),
    });
    expect(selectRoutingCell(rules, all, "terrace")).toEqual({
      target: station("kitchen"),
      decidedBy: { kind: "default" },
    });
    expect(selectRoutingCell({ ...rules, defaultStationId: null }, all, "terrace")).toEqual({
      target: null,
      decidedBy: null,
    });
    expect(
      selectRoutingCell({ ...rules, activeStationIds: new Set(["bar"]) }, all, "terrace"),
    ).toEqual({ target: null, decidedBy: null });
  });

  it("never treats a supplied All categories × Every zone cell as a stored cell", () => {
    const stray = { ...rules, cells: cells([all, null, station("bar")]) };
    expect(selectRoutingCell(stray, all, null)).toEqual({
      target: station("kitchen"),
      decidedBy: { kind: "default" },
    });
    expect(selectRoutingCell(stray, category("food"), "terrace").decidedBy).toEqual({
      kind: "default",
    });
  });

  it("selects for a category row with no product, falling to All categories × the zone", () => {
    expect(selectRoutingCell(rules, category("food"), "garden")).toEqual({
      target: station("mainBar"),
      decidedBy: decidedByCell(all, "garden"),
    });
    expect(selectRoutingCell(rules, category("food"), "terrace").decidedBy).toEqual({
      kind: "default",
    });
  });

  it("prefers the same row's Every zone over an ancestor's zone cell", () => {
    expect(selectRoutingCell(rules, category("cocktails"), "terrace")).toEqual({
      target: station("cocktailBar"),
      decidedBy: decidedByCell(category("cocktails"), null),
    });
  });

  it("takes an ancestor's zone cell when the row has no cell of its own", () => {
    expect(selectRoutingCell(rules, category("beer"), "terrace")).toEqual({
      target: station("terraceBar"),
      decidedBy: decidedByCell(category("drinks"), "terrace"),
    });
    expect(selectRoutingCell(rules, category("beer"), "indoors").decidedBy).toEqual({
      kind: "default",
    });
  });

  it("selects for a product row through the effective category it is given", () => {
    expect(selectRoutingCell(rules, product("mojito"), "terrace", "cocktails").decidedBy).toEqual(
      decidedByCell(category("cocktails"), null),
    );
    expect(selectRoutingCell(rules, product("mojito"), "terrace").decidedBy).toEqual({
      kind: "default",
    });
  });

  it("reports the target before any fallback walk", () => {
    const off = { ...rules, activeStationIds: new Set(["kitchen"]) };
    expect(selectRoutingCell(off, category("cocktails"), null)).toEqual({
      target: station("cocktailBar"),
      decidedBy: decidedByCell(category("cocktails"), null),
    });
  });
});

describe("selectRoutingCell with skipOwn", () => {
  const noCategory: RoutingRow = { kind: "no_category" };
  const rules: RoutingRules = {
    ...base,
    cells: cells(
      [product("mojito"), "terrace", station("terraceBar")],
      [product("mojito"), null, station("mainBar")],
      [category("cocktails"), "terrace", station("cocktailBar")],
      [category("drinks"), null, station("bar")],
      [noCategory, "terrace", station("terraceBar")],
      [all, "terrace", station("mainBar")],
    ),
  };
  const skipOwn = (from: RoutingRules, row: RoutingRow, zoneId: string | null) =>
    selectRoutingCell(from, row, zoneId, row.kind === "product" ? "cocktails" : null, {
      skipOwn: true,
    });

  it("skips the cell at the asked coordinate, then finds Every zone, parent rows and the default", () => {
    const walk: [RoutingRow, string | null][] = [
      [product("mojito"), null],
      [category("cocktails"), "terrace"],
      [category("drinks"), null],
      [all, "terrace"],
    ];
    let remaining = rules;
    for (const [row, zoneId] of walk) {
      expect(skipOwn(remaining, product("mojito"), "terrace").decidedBy).toEqual(
        decidedByCell(row, zoneId),
      );
      remaining = without(remaining, row, zoneId);
    }
    expect(skipOwn(remaining, product("mojito"), "terrace")).toEqual({
      target: station("kitchen"),
      decidedBy: { kind: "default" },
    });
  });

  it("answers what plain selection gives once the coordinate's own cell is gone", () => {
    const rows = [product("mojito"), category("cocktails"), category("drinks"), noCategory, all];
    for (const row of rows) {
      for (const zoneId of ["terrace", "garden", null]) {
        const plain = selectRoutingCell(
          without(rules, row, zoneId),
          row,
          zoneId,
          row.kind === "product" ? "cocktails" : null,
        );
        expect(skipOwn(rules, row, zoneId)).toEqual(plain);
        expect(skipOwn(without(rules, row, zoneId), row, zoneId)).toEqual(plain);
      }
    }
  });

  it("reads a frozen cell list once, however many coordinates it skips", () => {
    let scans = 0;
    const counted = new Proxy(Object.freeze([...rules.cells]), {
      get(target, property, receiver) {
        if (property === "0") scans++;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const countedRules: RoutingRules = { ...rules, cells: counted };
    for (const row of [product("mojito"), category("cocktails"), category("drinks")]) {
      for (const zoneId of ["terrace", null]) skipOwn(countedRules, row, zoneId);
    }
    expect(scans).toBe(1);
  });
});

describe("the No category row", () => {
  const noCategory: RoutingRow = { kind: "no_category" };
  const rules: RoutingRules = {
    ...base,
    cells: cells(
      [product("bread"), "terrace", station("bar")],
      [noCategory, "terrace", station("terraceBar")],
      [noCategory, null, station("mainBar")],
      [all, "terrace", station("cocktailBar")],
      [all, "inside", station("cocktailBar")],
    ),
  };

  it("an uncategorised product tries its product row, then No category, then All categories, zone before Every zone at each row", () => {
    const walk: [RoutingRow, string | null][] = [
      [product("bread"), "terrace"],
      [noCategory, "terrace"],
      [noCategory, null],
      [all, "terrace"],
    ];
    let remaining = rules;
    for (const [row, zoneId] of walk) {
      expect(chooseMaker(remaining, bread, "terrace", null).decidedBy).toEqual(
        decidedByCell(row, zoneId),
      );
      remaining = without(remaining, row, zoneId);
    }
    expect(chooseMaker(remaining, bread, "terrace", null)).toEqual({
      route: station("kitchen"),
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(rules, bread, "inside", null)).toEqual({
      route: station("mainBar"),
      decidedBy: decidedByCell(noCategory, null),
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("a variant of an uncategorised product follows No category, not the category it stores", () => {
    const withStored: RoutingRules = {
      ...rules,
      cells: [...rules.cells, ...cells([category("drinks"), null, station("bar")])],
    };
    const roll = { productId: "bread-roll", routedProductId: "bread", categoryId: null };
    expect(chooseMaker(withStored, roll, "inside", null).decidedBy).toEqual(
      decidedByCell(noCategory, null),
    );
    expect(chooseMaker(withStored, roll, "terrace", null).decidedBy).toEqual(
      decidedByCell(product("bread"), "terrace"),
    );
  });

  it("a No category cell never decides for a categorised product, nor for a category row", () => {
    const drinksOnly: RoutingRules = { ...rules, cells: rules.cells.slice(1) };
    for (const zoneId of ["terrace", "inside"]) {
      expect(chooseMaker(drinksOnly, lager, zoneId, null).decidedBy).toEqual(
        decidedByCell(all, zoneId),
      );
      expect(selectRoutingCell(drinksOnly, category("food"), zoneId).decidedBy).toEqual(
        decidedByCell(all, zoneId),
      );
    }
    expect(chooseMaker(drinksOnly, lager, null, null).decidedBy).toEqual({ kind: "default" });
  });

  it("selectRoutingCell for the No category row: its zone cell, its Every zone, then All × zone, then the default", () => {
    const row = rules.cells.slice(1);
    expect(selectRoutingCell({ ...rules, cells: row }, noCategory, "terrace")).toEqual({
      target: station("terraceBar"),
      decidedBy: decidedByCell(noCategory, "terrace"),
    });
    const noZoneCell = without({ ...rules, cells: row }, noCategory, "terrace");
    expect(selectRoutingCell(noZoneCell, noCategory, "terrace")).toEqual({
      target: station("mainBar"),
      decidedBy: decidedByCell(noCategory, null),
    });
    const noRowCells = without(noZoneCell, noCategory, null);
    expect(selectRoutingCell(noRowCells, noCategory, "terrace")).toEqual({
      target: station("cocktailBar"),
      decidedBy: decidedByCell(all, "terrace"),
    });
    expect(selectRoutingCell(noRowCells, noCategory, "garden")).toEqual({
      target: station("kitchen"),
      decidedBy: { kind: "default" },
    });
  });

  it("explicit No preparation on No category × Every zone stops the walk", () => {
    const stops: RoutingRules = {
      ...extrasRules,
      cells: cells([noCategory, null, noPreparation], [all, "terrace", station("fryer")]),
    };
    expect(chooseMaker(stops, bread, "terrace", null)).toEqual({
      route: noPreparation,
      decidedBy: decidedByCell(noCategory, null),
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseExtraMaker(stops, bread, "terrace", null, "grill")).toEqual({
      outcome: { kind: "follows_dish", why: "no_preparation" },
      decidedBy: decidedByCell(noCategory, null),
      fallbacks: [],
    });
  });
});

describe("folderAncestors", () => {
  it("walks up to the top, and stops at a loop", () => {
    expect(folderAncestors(parentOf, "cocktails")).toEqual(["cocktails", "drinks"]);
    expect(folderAncestors(parentOf, null)).toEqual([]);
    const loop = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(folderAncestors(loop, "a")).toEqual(["a", "b"]);
  });
});

describe("the text keys", () => {
  const rows: RoutingRow[] = [
    { kind: "all" },
    { kind: "no_category" },
    { kind: "category", categoryId: "x" },
    { kind: "product", productId: "x" },
  ];

  it("gives every row kind its own key, No category apart from All categories, and keeps the grid's spellings", () => {
    expect(rows.map(rowKey)).toEqual(["all", "no_category", "c:x", "p:x"]);
  });

  it("gives every row in Every zone and in a zone its own cell key", () => {
    const keys = rows.flatMap((row) => [null, "z"].map((zoneId) => cellKey({ row, zoneId })));
    expect(new Set(keys).size).toBe(8);
    expect(cellKey({ row: { kind: "all" }, zoneId: null })).toBe("all|every");
    expect(cellKey({ row: { kind: "category", categoryId: "x" }, zoneId: "z" })).toBe("c:x|z");
  });

  it("gives no target, No preparation and each station its own key", () => {
    expect([null, noPreparation, station("a"), station("b")].map(targetKey)).toEqual([
      "",
      "no_preparation",
      "station:a",
      "station:b",
    ]);
  });

  it("reads each target key back as the target it was made from", () => {
    const targets = [null, noPreparation, station("a"), station("b:c")];
    expect(targets.map((target) => parseTargetKey(targetKey(target)))).toEqual(targets);
  });

  it("refuses a key no target makes", () => {
    expect(() => parseTargetKey("kitchen")).toThrow("kitchen");
  });
});

describe("routing edge cases", () => {
  it("rejects a switched-off default instead of routing work to it", () => {
    expect(chooseMaker({ ...base, activeStationIds: new Set() }, bread, null, null)).toEqual({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("keeps a missing category as the leaf and stops at a missing parent", () => {
    expect(folderAncestors(parentOf, "missing")).toEqual(["missing"]);
    expect(folderAncestors(new Map([["leaf", "missing"]]), "leaf")).toEqual(["leaf", "missing"]);
    expect(folderAncestors(new Map([["self", "self"]]), "self")).toEqual(["self"]);
    expect(folderAncestors(new Map([["", null]]), "")).toEqual([""]);
  });
});

const at = (weekday: number, timeOfDay: string): RoutingMoment => ({ weekday, timeOfDay });
const FRI = 5,
  SAT = 6;

describe("opening hours", () => {
  const rules: RoutingRules = {
    ...base,
    activeStationIds: new Set([
      ...base.activeStationIds,
      "upstairs",
      "downstairs",
      "late",
      "midnight",
    ]),
    timing: new Map([
      [
        "upstairs",
        {
          fallbackId: "downstairs",
          hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
          today: null,
        },
      ],
      [
        "late",
        {
          fallbackId: null,
          hours: [{ weekday: FRI, opensAt: "22:00:00", closesAt: "02:00:00" }],
          today: null,
        },
      ],
      [
        "midnight",
        {
          fallbackId: null,
          hours: [{ weekday: FRI, opensAt: "20:00", closesAt: "00:00" }],
          today: null,
        },
      ],
    ]),
  };
  const open = (id: string, m: RoutingMoment | null) => stationStatus(rules, id, m);

  it("includes the opening minute and excludes the closing minute", () => {
    expect(open("upstairs", at(FRI, "19:00"))).toEqual({ open: true, why: "in_hours" });
    expect(open("upstairs", at(FRI, "20:59"))).toEqual({ open: true, why: "in_hours" });
    expect(open("upstairs", at(FRI, "21:00"))).toEqual({ open: false, why: "out_of_hours" });
    expect(open("upstairs", at(SAT, "20:00"))).toEqual({ open: false, why: "out_of_hours" });
  });

  it("keeps past-midnight hours open on the next day up to closing", () => {
    expect(open("late", at(FRI, "21:59")).open).toBe(false);
    expect(open("late", at(FRI, "23:30")).open).toBe(true);
    expect(open("late", at(SAT, "01:59")).open).toBe(true);
    expect(open("late", at(SAT, "02:00")).open).toBe(false);
    expect(open("midnight", at(FRI, "23:59")).open).toBe(true);
    expect(open("midnight", at(SAT, "00:00")).open).toBe(false);
    const saturday = {
      ...rules,
      timing: new Map([
        [
          "late",
          {
            fallbackId: null,
            hours: [{ weekday: SAT, opensAt: "22:00", closesAt: "02:00" }],
            today: null,
          },
        ],
      ]),
    };
    expect(stationStatus(saturday, "late", at(0, "01:00")).open).toBe(true);
  });

  it("uses no hours and the default before schedule closures", () => {
    expect(open("downstairs", at(FRI, "04:00"))).toEqual({ open: true, why: "no_hours" });
    const kitchenHours = {
      ...rules,
      timing: new Map([
        [
          "kitchen",
          {
            fallbackId: "bar",
            hours: [{ weekday: 1, opensAt: "09:00", closesAt: "10:00" }],
            today: "closed" as const,
          },
        ],
      ]),
    };
    expect(stationStatus(kitchenHours, "kitchen", at(FRI, "20:00"))).toEqual({
      open: true,
      why: "default",
    });
  });

  it("uses today's by-hand change, except when time does not apply", () => {
    const closed = {
      ...rules,
      timing: new Map([
        [
          "upstairs",
          {
            fallbackId: "downstairs",
            hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
            today: "closed" as const,
          },
        ],
      ]),
    };
    expect(stationStatus(closed, "upstairs", at(FRI, "20:00"))).toEqual({
      open: false,
      why: "closed_by_hand",
    });
    const opened = {
      ...rules,
      timing: new Map([
        [
          "upstairs",
          {
            fallbackId: "downstairs",
            hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
            today: "open" as const,
          },
        ],
      ]),
    };
    expect(stationStatus(opened, "upstairs", at(SAT, "12:00"))).toEqual({
      open: true,
      why: "opened_by_hand",
    });
    expect(stationStatus(closed, "upstairs", null)).toEqual({
      open: true,
      why: "time_not_applied",
    });
    expect(stationStatus(base, "retired", null)).toEqual({ open: false, why: "switched_off" });
  });
});

describe("opening hours by calendar date", () => {
  const MON = 1,
    TUE = 2;
  const schedule = (timing: Partial<StationTiming>): RoutingRules => ({
    ...base,
    activeStationIds: new Set([...base.activeStationIds, "late"]),
    timing: new Map([["late", { fallbackId: null, hours: [], today: null, ...timing }]]),
  });
  const on = (civilDate: string, weekday: number, timeOfDay: string): RoutingMoment => ({
    civilDate,
    weekday,
    timeOfDay,
  });
  const status = (rules: RoutingRules, moment: RoutingMoment | null) =>
    stationStatus(rules, "late", moment);
  const inHours = { open: true, why: "in_hours" };
  const outOfHours = { open: false, why: "out_of_hours" };
  const noHours = { open: true, why: "no_hours" };
  // Monday 22:00 to Tuesday 02:00 in a configured week where every other day is Closed.
  const mondayNight = {
    weekSet: true,
    hours: [{ weekday: MON, opensAt: "22:00", closesAt: "02:00" }],
  };
  // Tuesday 6 October 2026, the day after Monday 5 October.
  const tuesday = (time: string) => on("2026-10-06", TUE, time);

  it("keeps Monday's overnight tail on Tuesday, even when Tuesday is Closed", () => {
    expect(status(schedule(mondayNight), tuesday("00:30"))).toEqual(inHours);
    const closedTuesday = schedule({ ...mondayNight, dates: new Map([["2026-10-06", []]]) });
    expect(status(closedTuesday, tuesday("00:30"))).toEqual(inHours);
    expect(status(closedTuesday, tuesday("01:59"))).toEqual(inHours);
    expect(status(closedTuesday, tuesday("02:00"))).toEqual(outOfHours);
  });

  it("drops Monday's tail when Monday itself is Closed or has other hours", () => {
    expect(
      status(schedule({ ...mondayNight, dates: new Map([["2026-10-05", []]]) }), tuesday("00:30")),
    ).toEqual(outOfHours);
    const earlyMonday = schedule({
      ...mondayNight,
      dates: new Map([["2026-10-05", [{ opensAt: "12:00", closesAt: "16:00" }]]]),
    });
    expect(status(earlyMonday, tuesday("00:30"))).toEqual(outOfHours);
    expect(status(earlyMonday, on("2026-10-05", MON, "15:59"))).toEqual(inHours);
    expect(status(earlyMonday, on("2026-10-05", MON, "22:00"))).toEqual(outOfHours);
  });

  it("reads each date's own hours across a month end, a year end and Sunday into Monday", () => {
    const rules = schedule({
      weekSet: true,
      hours: [],
      dates: new Map([
        ["2026-10-31", [{ opensAt: "23:00", closesAt: "01:00" }]],
        ["2026-11-01", [{ opensAt: "12:00", closesAt: "13:00" }]],
        ["2026-12-31", [{ opensAt: "22:00", closesAt: "03:00" }]],
        ["2027-01-01", []],
        ["2026-10-11", [{ opensAt: "23:00", closesAt: "02:00" }]],
      ]),
    });
    expect(status(rules, on("2026-11-01", 0, "00:30"))).toEqual(inHours);
    expect(status(rules, on("2026-11-01", 0, "01:00"))).toEqual(outOfHours);
    expect(status(rules, on("2026-11-01", 0, "12:30"))).toEqual(inHours);
    expect(status(rules, on("2027-01-01", 5, "02:59"))).toEqual(inHours);
    expect(status(rules, on("2027-01-01", 5, "03:00"))).toEqual(outOfHours);
    expect(status(rules, on("2026-10-12", MON, "01:30"))).toEqual(inHours);
    expect(status(rules, on("2026-10-13", TUE, "01:30"))).toEqual(outOfHours);
  });

  it("includes the opening minute and excludes the closing minute of a special date", () => {
    const rules = schedule({
      dates: new Map([["2026-10-09", [{ opensAt: "12:00", closesAt: "14:00" }]]]),
    });
    expect(status(rules, on("2026-10-09", 5, "11:59"))).toEqual(outOfHours);
    expect(status(rules, on("2026-10-09", 5, "12:00"))).toEqual(inHours);
    expect(status(rules, on("2026-10-09", 5, "13:59"))).toEqual(inHours);
    expect(status(rules, on("2026-10-09", 5, "14:00"))).toEqual(outOfHours);
  });

  it("tells a week with no hours set from a week that is Closed every day", () => {
    expect(status(schedule({ weekSet: false, hours: [] }), tuesday("12:00"))).toEqual(noHours);
    expect(status(schedule({ weekSet: true, hours: [] }), tuesday("12:00"))).toEqual(outOfHours);
  });

  it("applies a special date to a station with no weekly hours on that date only", () => {
    const rules = schedule({
      weekSet: false,
      dates: new Map([["2026-10-09", [{ opensAt: "22:00", closesAt: "01:00" }]]]),
    });
    expect(status(rules, on("2026-10-09", 5, "12:00"))).toEqual(outOfHours);
    expect(status(rules, on("2026-10-10", 6, "00:30"))).toEqual(inHours);
    expect(status(rules, on("2026-10-10", 6, "01:00"))).toEqual(noHours);
    expect(status(rules, on("2026-10-08", 4, "12:00"))).toEqual(noHours);
  });

  it("opens all day from midnight up to the next midnight", () => {
    const rules = schedule({
      weekSet: true,
      dates: new Map([["2026-10-09", [{ opensAt: "00:00", closesAt: "00:00" }]]]),
    });
    expect(status(rules, on("2026-10-09", 5, "00:00"))).toEqual(inHours);
    expect(status(rules, on("2026-10-09", 5, "23:59"))).toEqual(inHours);
    expect(status(rules, on("2026-10-10", 6, "00:00"))).toEqual(outOfHours);
  });

  it("previews the standard week alone for a moment that names no date", () => {
    const rules = schedule({ ...mondayNight, dates: new Map([["2026-10-05", []]]) });
    expect(status(rules, { weekday: TUE, timeOfDay: "00:30" })).toEqual(inHours);
  });

  it("keeps the switch, the default, an unreadable clock and today's by-hand change ahead of a special date", () => {
    const closedDate = new Map([["2026-10-06", []]]);
    expect(
      status(schedule({ weekSet: true, dates: closedDate, today: "open" }), tuesday("12:00")),
    ).toEqual({ open: true, why: "opened_by_hand" });
    expect(
      status(
        schedule({
          dates: new Map([["2026-10-06", [{ opensAt: "00:00", closesAt: "00:00" }]]]),
          today: "closed",
        }),
        tuesday("12:00"),
      ),
    ).toEqual({ open: false, why: "closed_by_hand" });
    expect(status(schedule({ weekSet: true, dates: closedDate }), null)).toEqual({
      open: true,
      why: "time_not_applied",
    });
    const asDefault = {
      ...schedule({ weekSet: true, dates: closedDate }),
      defaultStationId: "late",
    };
    expect(status(asDefault, tuesday("12:00"))).toEqual({ open: true, why: "default" });
    const switchedOff = { ...asDefault, activeStationIds: new Set<string>() };
    expect(status(switchedOff, tuesday("12:00"))).toEqual({ open: false, why: "switched_off" });
  });
});

describe("fallbacks", () => {
  const rules: RoutingRules = {
    ...base,
    cells: cells([category("drinks"), null, station("upstairs")]),
    activeStationIds: new Set(["upstairs", "downstairs", "kitchen", "a", "b"]),
    timing: new Map([
      [
        "upstairs",
        {
          fallbackId: "downstairs",
          hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
          today: null,
        },
      ],
      ["downstairs", { fallbackId: null, hours: [], today: null }],
      ["a", { fallbackId: "b", hours: [], today: "closed" }],
      ["b", { fallbackId: "a", hours: [], today: "closed" }],
    ]),
  };

  it("sends work from an out-of-hours station to its first open fallback", () => {
    expect(chooseMaker(rules, lager, null, at(FRI, "22:00"))).toEqual({
      route: station("downstairs"),
      decidedBy: decidedByCell(category("drinks"), null),
      fallbacks: [{ stationId: "upstairs", why: "out_of_hours" }],
      noReplacement: false,
    });
    expect(chooseMaker(rules, lager, null, at(FRI, "20:00")).route).toEqual(station("upstairs"));
  });

  it("returns a dead end when every fallback is closed", () => {
    const closed = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        ["downstairs", { fallbackId: null, hours: [], today: "closed" as const }],
      ]),
    };
    expect(chooseMaker(closed, lager, null, at(FRI, "22:00"))).toEqual({
      route: null,
      decidedBy: decidedByCell(category("drinks"), null),
      fallbacks: [
        { stationId: "upstairs", why: "out_of_hours" },
        { stationId: "downstairs", why: "closed_by_hand" },
      ],
      noReplacement: true,
    });
  });

  it("stops a fallback loop before revisiting a station", () => {
    expect(followFallbacks(rules, "a", at(FRI, "20:00"))).toEqual({
      stationId: null,
      steps: [
        { stationId: "a", why: "closed_by_hand" },
        { stationId: "b", why: "closed_by_hand" },
      ],
    });
  });

  it("reaches the default only through an explicit fallback", () => {
    const toKitchen = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        ["a", { fallbackId: "kitchen", hours: [], today: "closed" as const }],
      ]),
    };
    expect(followFallbacks(toKitchen, "a", at(FRI, "20:00")).stationId).toBe("kitchen");
  });

  it("keeps a missing default distinct from a closed chain", () => {
    expect(
      chooseMaker({ ...rules, defaultStationId: null }, bread, null, at(FRI, "20:00")),
    ).toEqual({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("does not walk a no-preparation route", () => {
    const np = { ...rules, cells: cells([category("drinks"), null, noPreparation]) };
    expect(chooseMaker(np, lager, null, at(FRI, "22:00"))).toEqual({
      route: { kind: "no_preparation" },
      decidedBy: decidedByCell(category("drinks"), null),
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("finds where a station's work would go if it closed", () => {
    expect(closedSendsTo(rules, "upstairs", at(FRI, "20:00"))).toBe("downstairs");
    expect(closedSendsTo(rules, "downstairs", at(FRI, "20:00"))).toBeNull();
    expect(closedSendsTo(rules, "a", at(FRI, "20:00"))).toBeNull();
    expect(closedSendsTo(rules, "kitchen", at(FRI, "20:00"))).toBe("kitchen");
  });
});

describe("today's chosen station destination", () => {
  const rules: RoutingRules = {
    ...base,
    cells: cells([category("drinks"), null, station("grill")]),
    activeStationIds: new Set(["grill", "bar", "pastry", "kitchen"]),
    timing: new Map([
      ["grill", { fallbackId: "pastry", hours: [], today: "closed", todaySendsTo: "bar" }],
      ["bar", { fallbackId: null, hours: [], today: null }],
    ]),
  };

  it("sends work to today's choice ahead of the configured fallback", () => {
    expect(chooseMaker(rules, lager, null, at(FRI, "20:00"))).toEqual({
      route: station("bar"),
      decidedBy: decidedByCell(category("drinks"), null),
      fallbacks: [{ stationId: "grill", why: "closed_by_hand" }],
      noReplacement: false,
    });
    expect(closedSendsTo(rules, "grill", at(FRI, "20:00"))).toBe("bar");
  });

  it("continues through the chosen destination's scheduled fallback", () => {
    const closedBar: RoutingRules = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        [
          "bar",
          {
            fallbackId: "pastry",
            hours: [],
            weekSet: true,
            today: null,
            todaySendsTo: "grill",
          },
        ],
      ]),
    };
    expect(followFallbacks(closedBar, "grill", at(FRI, "20:00"))).toEqual({
      stationId: "pastry",
      steps: [
        { stationId: "grill", why: "closed_by_hand" },
        { stationId: "bar", why: "out_of_hours" },
      ],
    });
    expect(closedSendsTo(closedBar, "grill", at(FRI, "20:00"))).toBe("pastry");
  });

  it("uses the active default when today's destination is switched off with no fallback", () => {
    const off: RoutingRules = {
      ...rules,
      activeStationIds: new Set(["grill", "pastry", "kitchen"]),
    };
    expect(chooseMaker(off, lager, null, at(FRI, "20:00"))).toEqual({
      route: station("kitchen"),
      decidedBy: decidedByCell(category("drinks"), null),
      fallbacks: [
        { stationId: "grill", why: "closed_by_hand" },
        { stationId: "bar", why: "switched_off" },
      ],
      noReplacement: false,
    });
    expect(closedSendsTo(off, "grill", at(FRI, "20:00"))).toBe("kitchen");
  });

  it("ends a cycle of today's destinations at the active default", () => {
    const cycle: RoutingRules = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        ["bar", { fallbackId: null, hours: [], today: "closed", todaySendsTo: "grill" }],
      ]),
    };
    expect(followFallbacks(cycle, "grill", at(FRI, "20:00"))).toEqual({
      stationId: "kitchen",
      steps: [
        { stationId: "grill", why: "closed_by_hand" },
        { stationId: "bar", why: "closed_by_hand" },
      ],
    });
  });

  it.each([null, "kitchen"])(
    "keeps a dead end when default %s is unavailable",
    (defaultStationId) => {
      const off: RoutingRules = {
        ...rules,
        defaultStationId,
        activeStationIds: new Set(["grill", "pastry"]),
      };
      expect(chooseMaker(off, lager, null, at(FRI, "20:00"))).toMatchObject({
        route: null,
        noReplacement: true,
      });
      expect(closedSendsTo(off, "grill", at(FRI, "20:00"))).toBeNull();
    },
  );

  it("keeps the configured fallback for a close without a destination", () => {
    const legacy: RoutingRules = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        ["grill", { fallbackId: "pastry", hours: [], today: "closed", todaySendsTo: null }],
      ]),
    };
    expect(chooseMaker(legacy, lager, null, at(FRI, "20:00")).route).toEqual(station("pastry"));
    expect(closedSendsTo(legacy, "grill", at(FRI, "20:00"))).toBe("pastry");
  });

  it("does not apply today's destination while the clock cannot be read", () => {
    expect(chooseMaker(rules, lager, null, null)).toMatchObject({
      route: station("grill"),
      fallbacks: [],
    });
    expect(closedSendsTo(rules, "grill", null)).toBe("pastry");
  });
});

const extrasRules: RoutingRules = {
  ...base,
  parentOf: new Map([
    ...parentOf,
    ["extras", null],
    ["sides", "extras"],
    ["toppings", "extras"],
    ["sauces", "extras"],
  ]),
  activeStationIds: new Set([...base.activeStationIds, "grill", "fryer", "terraceKitchen"]),
  cells: cells(
    [category("sides"), null, station("fryer")],
    [category("sauces"), null, noPreparation],
  ),
};
const chips = { productId: "chips", routedProductId: "chips", categoryId: "sides" };
const cheese = { productId: "cheese", routedProductId: "cheese", categoryId: "toppings" };
const sauce = { productId: "sauce", routedProductId: "sauce", categoryId: "sauces" };

describe("chooseExtraMakerBeside", () => {
  const dishAt = (route: RouteTarget | null) => ({
    route,
    decidedBy: null,
    fallbacks: [],
    noReplacement: route === null,
  });
  it("gives no extra a maker while its dish has no route", () => {
    expect(chooseExtraMakerBeside(extrasRules, dishAt(null), chips, null, null)).toBeNull();
  });
  it("compares the extra's station with its dish's", () => {
    expect(
      chooseExtraMakerBeside(extrasRules, dishAt(station("fryer")), chips, null, null)?.outcome,
    ).toEqual({ kind: "follows_dish", why: "same_station" });
    expect(
      chooseExtraMakerBeside(extrasRules, dishAt(station("grill")), chips, null, null),
    ).toEqual({
      outcome: { kind: "made", stationId: "fryer" },
      decidedBy: decidedByCell(category("sides"), null),
      fallbacks: [],
    });
  });
  it("makes an extra at its own station beside a dish with no preparation", () => {
    expect(
      chooseExtraMakerBeside(extrasRules, dishAt(noPreparation), chips, null, null)?.outcome,
    ).toEqual({ kind: "made", stationId: "fryer" });
  });
});

describe("chooseExtraMaker", () => {
  it("splits an extra off when its category's cell names another station", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, "grill")).toEqual({
      outcome: { kind: "made", stationId: "fryer" },
      decidedBy: decidedByCell(category("sides"), null),
      fallbacks: [],
    });
  });
  it("keeps an extra no cell decides with its dish, with or without an active default", () => {
    expect(chooseExtraMaker(extrasRules, cheese, null, null, "grill").outcome).toEqual({
      kind: "follows_dish",
      why: "no_rule",
    });
    expect(
      chooseExtraMaker({ ...extrasRules, defaultStationId: null }, cheese, null, null, "grill")
        .outcome,
    ).toEqual({ kind: "follows_dish", why: "no_rule" });
  });
  it("keeps a no-preparation extra with its dish", () => {
    expect(chooseExtraMaker(extrasRules, sauce, null, null, "grill").outcome).toEqual({
      kind: "follows_dish",
      why: "no_preparation",
    });
  });
  it("keeps an extra with its dish when both are made at one station", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, "fryer").outcome).toEqual({
      kind: "follows_dish",
      why: "same_station",
    });
  });
  it("lets an All categories × zone cell decide for an extra as for a dish", () => {
    const rules = {
      ...extrasRules,
      cells: cells([all, "terrace", station("terraceKitchen")]),
    };
    expect(chooseExtraMaker(rules, chips, "terrace", null, "terraceKitchen")).toEqual({
      outcome: { kind: "follows_dish", why: "same_station" },
      decidedBy: decidedByCell(all, "terrace"),
      fallbacks: [],
    });
  });
  it("makes an extra where an All categories × zone cell names the default station", () => {
    const rules = { ...extrasRules, cells: cells([all, "terrace", station("kitchen")]) };
    expect(chooseExtraMaker(rules, cheese, "terrace", null, "grill")).toEqual({
      outcome: { kind: "made", stationId: "kitchen" },
      decidedBy: decidedByCell(all, "terrace"),
      fallbacks: [],
    });
    expect(chooseExtraMaker(rules, cheese, "indoors", null, "grill")).toEqual({
      outcome: { kind: "follows_dish", why: "no_rule" },
      decidedBy: { kind: "default" },
      fallbacks: [],
    });
  });
  it("keeps a category or product cell that names the default station a cell decision", () => {
    const byCategory = {
      ...extrasRules,
      cells: cells([category("toppings"), null, station("kitchen")]),
    };
    expect(chooseExtraMaker(byCategory, cheese, null, null, "grill")).toEqual({
      outcome: { kind: "made", stationId: "kitchen" },
      decidedBy: decidedByCell(category("toppings"), null),
      fallbacks: [],
    });
    expect(chooseExtraMaker(byCategory, cheese, null, null, "kitchen").outcome).toEqual({
      kind: "follows_dish",
      why: "same_station",
    });
    const byProduct = {
      ...extrasRules,
      cells: cells([product("cheese"), "terrace", station("kitchen")]),
    };
    expect(chooseExtraMaker(byProduct, cheese, "terrace", null, "grill")).toEqual({
      outcome: { kind: "made", stationId: "kitchen" },
      decidedBy: decidedByCell(product("cheese"), "terrace"),
      fallbacks: [],
    });
  });
  it("walks the extra's fallbacks before comparing its station with its dish's", () => {
    const rules = {
      ...extrasRules,
      timing: new Map([["fryer", { fallbackId: "kitchen", hours: [], today: "closed" as const }]]),
    };
    expect(chooseExtraMaker(rules, chips, null, at(FRI, "20:00"), "grill")).toEqual({
      outcome: { kind: "made", stationId: "kitchen" },
      decidedBy: decidedByCell(category("sides"), null),
      fallbacks: [{ stationId: "fryer", why: "closed_by_hand" }],
    });
    expect(chooseExtraMaker(rules, chips, null, at(FRI, "20:00"), "kitchen").outcome).toEqual({
      kind: "follows_dish",
      why: "same_station",
    });
  });
  it("keeps an extra with its dish when none of its stations is open", () => {
    const rules = {
      ...extrasRules,
      timing: new Map([["fryer", { fallbackId: null, hours: [], today: "closed" as const }]]),
    };
    expect(chooseExtraMaker(rules, chips, null, at(FRI, "20:00"), "grill")).toEqual({
      outcome: { kind: "follows_dish", why: "no_replacement" },
      decidedBy: decidedByCell(category("sides"), null),
      fallbacks: [{ stationId: "fryer", why: "closed_by_hand" }],
    });
  });
  it("splits an extra off a dish that needs no preparation when its category's cell names a station", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, null).outcome).toEqual({
      kind: "made",
      stationId: "fryer",
    });
  });
});

describe("a public holiday", () => {
  const MON = 1;
  // Monday 12 October 2026 is Spain's national day; Monday 5 October is an ordinary Monday.
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";
  const on = (civilDate: string, timeOfDay: string): RoutingMoment => ({
    civilDate,
    weekday: MON,
    timeOfDay,
  });
  const timing: StationTiming = {
    fallbackId: "mainBar",
    hours: [{ weekday: MON, opensAt: "18:00", closesAt: "23:00" }],
    today: null,
    weekSet: true,
  };
  const rules: RoutingRules = { ...base, timing: new Map([["cocktailBar", timing]]) };

  it("is a national holiday in Seville through the real Spanish pack, and the ordinary Monday is not", () => {
    const spain = getCountryPack("ES")!.holidayCalendar!;
    const facts = (date: string) =>
      spain.read({ provinceCode: "41", areaKey: null, from: date, to: date }).facts;
    expect(facts(HOLIDAY)).toEqual([expect.objectContaining({ date: HOLIDAY, scope: "national" })]);
    expect(facts(ORDINARY)).toEqual([]);
  });

  it("leaves a station on its Monday hours, and every route as on an ordinary Monday", () => {
    for (const time of ["12:00", "18:00", "22:59", "23:00"]) {
      expect(stationStatus(rules, "cocktailBar", on(HOLIDAY, time))).toEqual(
        stationStatus(rules, "cocktailBar", on(ORDINARY, time)),
      );
      expect(chooseMaker(rules, mojito, "terrace", on(HOLIDAY, time))).toEqual(
        chooseMaker(rules, mojito, "terrace", on(ORDINARY, time)),
      );
    }
    expect(stationStatus(rules, "cocktailBar", on(HOLIDAY, "20:00"))).toEqual({
      open: true,
      why: "in_hours",
    });
    expect(chooseMaker(rules, mojito, null, on(HOLIDAY, "20:00")).route).toEqual(
      station("cocktailBar"),
    );
    expect(chooseMaker(rules, mojito, null, on(HOLIDAY, "12:00")).route).toEqual(
      station("mainBar"),
    );
  });

  it("closes a station on the holiday only through a special date the venue saved", () => {
    const closedHoliday: RoutingRules = {
      ...base,
      timing: new Map([["cocktailBar", { ...timing, dates: new Map([[HOLIDAY, []]]) }]]),
    };
    expect(stationStatus(closedHoliday, "cocktailBar", on(HOLIDAY, "20:00"))).toEqual({
      open: false,
      why: "out_of_hours",
    });
    expect(chooseMaker(closedHoliday, mojito, null, on(HOLIDAY, "20:00")).route).toEqual(
      station("mainBar"),
    );
    expect(stationStatus(closedHoliday, "cocktailBar", on(ORDINARY, "20:00"))).toEqual({
      open: true,
      why: "in_hours",
    });
  });
});

describe("changeReach", () => {
  const tree = new Map<string, string | null>([
    ["a", null],
    ["a1", "a"],
    ["a2", "a"],
    ["a1x", "a1"],
    ["b", null],
    ["b1", "b"],
  ]);
  const facts = (productId: string, categoryId: string | null, routedProductId = productId) => ({
    productId,
    routedProductId,
    categoryId,
  });
  const catalogue: readonly ProductFacts[] = [
    facts("p1", "a1x"),
    facts("p2", "a1"),
    facts("p3", "a2"),
    facts("p4", "b1"),
    facts("p5", "b"),
    facts("p6", null),
    facts("p7", null),
    facts("v1", "a1x", "p1"),
    // A variant that stores a category of its own still has its parent's effective one.
    facts("v6", null, "p6"),
  ];
  const zones = ["z1", "z2", "z3"];
  const columns = [...zones, null];
  const rows: RoutingRow[] = [
    all,
    { kind: "no_category" },
    ...[...tree.keys()].map(category),
    ...catalogue.filter((p) => p.productId === p.routedProductId).map((p) => product(p.productId)),
  ];
  const addresses: CellAddress[] = rows.flatMap((row) =>
    [...zones, null].flatMap((zoneId) =>
      row.kind === "all" && zoneId === null ? [] : [{ row, zoneId }],
    ),
  );
  const targets: (RouteTarget | null)[] = [
    station("s1"),
    station("s2"),
    station("offWithFallback"),
    station("offAlone"),
    noPreparation,
    null,
  ];
  const stationRules = {
    parentOf: tree,
    activeStationIds: new Set(["s1", "s2"]),
    defaultStationId: "s1",
    timing: new Map<string, StationTiming>([
      ["offWithFallback", { fallbackId: "s2", hours: [], today: null }],
      ["offAlone", { fallbackId: null, hours: [], today: null }],
    ]),
  };
  /** A fixed-seed generator (mulberry32), so a failure replays. */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const savedCells = (seed: number): RoutingCell[] => {
    const next = random(seed);
    return addresses.flatMap((address) => {
      if (next() > 0.25) return [];
      const target = targets[Math.floor(next() * (targets.length - 1))]!;
      return [{ ...address, target: target! }];
    });
  };
  const withChange = (rules: RoutingRules, address: CellAddress, target: RouteTarget | null) => {
    const key = cellKey(address);
    const cells = rules.cells.filter((cell) => cellKey(cell) !== key);
    if (target !== null) cells.push({ ...address, target });
    return { ...rules, cells };
  };
  const sameChoice = (a: MakerChoice, b: MakerChoice) =>
    targetKey(a.route) === targetKey(b.route) && a.noReplacement === b.noReplacement;
  const placement = (
    rules: RoutingRules,
    dish: MakerChoice,
    extra: ProductFacts,
    zoneId: string | null,
  ) => {
    const made = chooseExtraMakerBeside(rules, dish, extra, zoneId, null)?.outcome;
    return made?.kind === "made" ? `made:${made.stationId}` : `follows:${targetKey(dish.route)}`;
  };

  it("holds every choice a change can move, for every address and target", () => {
    let dishMoves = 0;
    let extraMoves = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const before: RoutingRules = { ...stationRules, cells: savedCells(seed) };
      for (const address of addresses) {
        const reach = changeReach(tree, address);
        for (const target of targets) {
          const after = withChange(before, address, target);
          for (const zoneId of columns) {
            const choices = new Map(
              catalogue.map((p) => [
                p.productId,
                {
                  before: chooseMaker(before, p, zoneId, null),
                  after: chooseMaker(after, p, zoneId, null),
                },
              ]),
            );
            for (const p of catalogue) {
              const choice = choices.get(p.productId)!;
              if (sameChoice(choice.before, choice.after)) continue;
              dishMoves++;
              expect([address, p.productId, zoneId, reach.reachesZone(zoneId)]).toEqual([
                address,
                p.productId,
                zoneId,
                true,
              ]);
              expect([address, p.productId, zoneId, reach.covers(p)]).toEqual([
                address,
                p.productId,
                zoneId,
                true,
              ]);
            }
            for (const dish of catalogue)
              for (const extra of catalogue) {
                const dishChoice = choices.get(dish.productId)!;
                if (
                  placement(before, dishChoice.before, extra, zoneId) ===
                  placement(after, dishChoice.after, extra, zoneId)
                )
                  continue;
                extraMoves++;
                expect([
                  address,
                  dish.productId,
                  extra.productId,
                  zoneId,
                  reach.reachesZone(zoneId) && (reach.covers(dish) || reach.covers(extra)),
                ]).toEqual([address, dish.productId, extra.productId, zoneId, true]);
              }
          }
        }
      }
    }
    expect(dishMoves).toBeGreaterThan(1000);
    expect(extraMoves).toBeGreaterThan(1000);
  });

  it("does not reach a sibling product, another zone, or another branch of the tree", () => {
    const p1InZ1 = changeReach(tree, { row: product("p1"), zoneId: "z1" });
    expect(catalogue.filter((p) => p1InZ1.covers(p)).map((p) => p.productId)).toEqual(["p1", "v1"]);
    expect(columns.filter((zoneId) => p1InZ1.reachesZone(zoneId))).toEqual(["z1"]);
    const a1 = changeReach(tree, { row: category("a1"), zoneId: null });
    expect(catalogue.filter((p) => a1.covers(p)).map((p) => p.productId)).toEqual([
      "p1",
      "p2",
      "v1",
    ]);
    expect(columns.filter((zoneId) => a1.reachesZone(zoneId))).toEqual(columns);
    const loose = changeReach(tree, { row: { kind: "no_category" }, zoneId: "z2" });
    expect(catalogue.filter((p) => loose.covers(p)).map((p) => p.productId)).toEqual([
      "p6",
      "p7",
      "v6",
    ]);
    const everything = changeReach(tree, { row: all, zoneId: "z3" });
    expect(catalogue.every((p) => everything.covers(p))).toBe(true);
    expect(columns.filter((zoneId) => everything.reachesZone(zoneId))).toEqual(["z3"]);
  });
});

describe("a cell's period lines", () => {
  const cocktailsEverywhere: CellAddress = { row: category("cocktails"), zoneId: null };
  const periodRules: RoutingRules = {
    ...base,
    cells: cells(
      [category("cocktails"), null, station("upstairs")],
      [category("cocktails"), "garden", station("pastry")],
    ),
    activeStationIds: new Set(["upstairs", "downstairs", "pastry", "patioBar", "kitchen"]),
    cellPeriods: new Map([
      [
        cellKey(cocktailsEverywhere),
        new Map<string, RouteTarget>([
          ["lunch", station("downstairs")],
          ["patioLunch", station("patioBar")],
        ]),
      ],
    ]),
    zoneDepartment: new Map([
      ["dining", "restaurant"],
      ["terrace", "restaurant"],
      ["garden", "restaurant"],
      ["patio", "bar"],
    ]),
  };
  const during = (periods: Record<string, string | null>, timeOfDay = "13:00"): RoutingMoment => ({
    weekday: FRI,
    timeOfDay,
    periods: new Map(Object.entries(periods)),
  });
  const byLunch = { ...decidedByCell(category("cocktails"), null), periodId: "lunch" };

  it("sends a cocktail where the running period's line says, and elsewhere where the cell does", () => {
    expect(chooseMaker(periodRules, mojito, "dining", during({ restaurant: "lunch" }))).toEqual({
      route: station("downstairs"),
      decidedBy: byLunch,
      fallbacks: [],
      noReplacement: false,
    });
    for (const moment of [
      during({ restaurant: "afternoon" }, "14:10"),
      during({ restaurant: null }, "17:00"),
      at(FRI, "13:00"),
      null,
    ]) {
      const choice = chooseMaker(periodRules, mojito, "dining", moment);
      expect(choice.route).toEqual(station("upstairs"));
      expect(choice.decidedBy).toStrictEqual(decidedByCell(category("cocktails"), null));
    }
  });

  it("uses Any other time for a dish with no zone", () => {
    expect(chooseMaker(periodRules, mojito, null, during({ restaurant: "lunch" })).route).toEqual(
      station("upstairs"),
    );
  });

  it("lets a zone that sets nothing inherit the line, and a zone with its own setting keep it", () => {
    expect(chooseMaker(periodRules, mojito, "terrace", during({ restaurant: "lunch" }))).toEqual({
      route: station("downstairs"),
      decidedBy: byLunch,
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(periodRules, mojito, "garden", during({ restaurant: "lunch" }))).toEqual({
      route: station("pastry"),
      decidedBy: decidedByCell(category("cocktails"), "garden"),
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("applies each department's period only in that department's zones", () => {
    const both = during({ restaurant: "lunch", bar: "patioLunch" });
    expect(chooseMaker(periodRules, mojito, "dining", both).route).toEqual(station("downstairs"));
    expect(chooseMaker(periodRules, mojito, "patio", both)).toMatchObject({
      route: station("patioBar"),
      decidedBy: { ...decidedByCell(category("cocktails"), null), periodId: "patioLunch" },
    });
    const barOnly = during({ restaurant: null, bar: "patioLunch" });
    expect(chooseMaker(periodRules, mojito, "dining", barOnly).route).toEqual(station("upstairs"));
    const restaurantOnly = during({ restaurant: "lunch", bar: null });
    expect(chooseMaker(periodRules, mojito, "patio", restaurantOnly).route).toEqual(
      station("upstairs"),
    );
  });

  it("tells selectRoutingCell the period line, and the cell's own target without periods", () => {
    const periods = new Map([["restaurant", "lunch"]]);
    expect(
      selectRoutingCell(periodRules, product("mojito"), "dining", "cocktails", { periods }),
    ).toEqual({ target: station("downstairs"), decidedBy: byLunch });
    expect(selectRoutingCell(periodRules, product("mojito"), "dining", "cocktails")).toStrictEqual({
      target: station("upstairs"),
      decidedBy: decidedByCell(category("cocktails"), null),
    });
  });

  it("sends an extra on a cell with a Lunch line where the line says during Lunch", () => {
    expect(
      chooseExtraMaker(periodRules, mojito, "dining", during({ restaurant: "lunch" }), "kitchen"),
    ).toEqual({
      outcome: { kind: "made", stationId: "downstairs" },
      decidedBy: byLunch,
      fallbacks: [],
    });
    expect(
      chooseExtraMaker(periodRules, mojito, "dining", during({ restaurant: null }), "kitchen")
        .outcome,
    ).toEqual({ kind: "made", stationId: "upstairs" });
  });

  it("follows a closed-for-today station's destination when a period line names it", () => {
    const closedDownstairs: RoutingRules = {
      ...periodRules,
      timing: new Map([
        [
          "downstairs",
          { fallbackId: "pastry", hours: [], today: "closed", todaySendsTo: "patioBar" },
        ],
      ]),
    };
    expect(
      chooseMaker(closedDownstairs, mojito, "dining", during({ restaurant: "lunch" })),
    ).toEqual({
      route: station("patioBar"),
      decidedBy: byLunch,
      fallbacks: [{ stationId: "downstairs", why: "closed_by_hand" }],
      noReplacement: false,
    });
  });
});
