import { describe, expect, it } from "vitest";
import {
  chooseMaker,
  folderAncestors,
  unreachableExceptions,
  type RouteTarget,
  type RoutingRules,
} from "./routing.js";

const station = (stationId: string) => ({ kind: "station" as const, stationId });
const parentOf = new Map<string, string | null>([
  ["drinks", null],
  ["cocktails", "drinks"],
  ["beer", "drinks"],
  ["food", null],
]);
const base: RoutingRules = {
  exceptions: [],
  claims: new Map([
    ["drinks", station("bar")],
    ["cocktails", station("cocktailBar")],
  ]),
  parentOf,
  activeStationIds: new Set(["bar", "cocktailBar", "mainBar", "terraceBar", "kitchen"]),
  defaultStationId: "kitchen",
};
const mojito = { productId: "mojito", routedProductId: "mojito", categoryId: "cocktails" };
const lager = { productId: "lager", routedProductId: "lager", categoryId: "beer" };
const bread = { productId: "bread", routedProductId: "bread", categoryId: null };

describe("chooseMaker", () => {
  it("gives the nearest claimed folder, and an unclaimed subfolder its parent's claim", () => {
    expect(chooseMaker(base, mojito, null)).toEqual({
      route: station("cocktailBar"),
      decidedBy: { kind: "claim", categoryId: "cocktails" },
      skipped: [],
    });
    expect(chooseMaker(base, lager, "indoors").decidedBy).toEqual({
      kind: "claim",
      categoryId: "drinks",
    });
    expect(chooseMaker(base, bread, "indoors")).toEqual({
      route: station("kitchen"),
      decidedBy: { kind: "default" },
      skipped: [],
    });
  });

  it("tries exceptions first, in position order, and the first match wins", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "e2",
          position: 2,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "e1",
          position: 1,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(chooseMaker(rules, mojito, "terrace").route).toEqual(station("mainBar"));
    expect(chooseMaker(rules, lager, "terrace").route).toEqual(station("terraceBar"));
    expect(chooseMaker(rules, mojito, "indoors").decidedBy).toEqual({
      kind: "claim",
      categoryId: "cocktails",
    });
    expect(chooseMaker(rules, mojito, null).decidedBy).toEqual({
      kind: "claim",
      categoryId: "cocktails",
    });
  });

  it("matches an exception with no zone on any order, and one naming a product on its variants", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "e1",
          position: 1,
          zoneId: null,
          categoryId: null,
          productId: "lager",
          target: { kind: "no_preparation" },
        },
      ],
    };
    const lagerPint = { productId: "lager-pint", routedProductId: "lager", categoryId: "beer" };
    expect(chooseMaker(rules, lagerPint, null)).toEqual({
      route: { kind: "no_preparation" },
      decidedBy: { kind: "exception", exceptionId: "e1" },
      skipped: [],
    });
  });

  it("routes a variant with a folder of its own by that folder", () => {
    const mocktail = { productId: "virgin", routedProductId: "mojito", categoryId: "food" };
    expect(chooseMaker(base, mocktail, null).decidedBy).toEqual({ kind: "default" });
  });

  it("skips a rule whose station is switched off, and records it", () => {
    const rules = { ...base, activeStationIds: new Set(["bar", "kitchen"]) };
    expect(chooseMaker(rules, mojito, null)).toEqual({
      route: station("bar"),
      decidedBy: { kind: "claim", categoryId: "drinks" },
      skipped: [{ decision: { kind: "claim", categoryId: "cocktails" }, stationId: "cocktailBar" }],
    });
  });

  it("never skips a no-preparation target", () => {
    const rules = { ...base, claims: new Map([["drinks", { kind: "no_preparation" as const }]]) };
    expect(chooseMaker(rules, lager, null).route).toEqual({ kind: "no_preparation" });
  });

  it("returns no route when nothing matches and there is no active default", () => {
    expect(chooseMaker({ ...base, defaultStationId: null }, bread, null)).toEqual({
      route: null,
      decidedBy: null,
      skipped: [],
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

describe("unreachableExceptions", () => {
  it("flags an exception an earlier, wider one always catches", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "wide",
          position: 1,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "narrow",
          position: 2,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
        {
          id: "other-zone",
          position: 3,
          zoneId: "indoors",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
        {
          id: "any-zone",
          position: 4,
          zoneId: null,
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["narrow"]));
  });

  it("flags a duplicate product exception, and everything after a catch-all for its zone", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "all-terrace",
          position: 1,
          zoneId: "terrace",
          categoryId: null,
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "p1",
          position: 2,
          zoneId: "terrace",
          categoryId: null,
          productId: "lager",
          target: station("bar"),
        },
        {
          id: "p2",
          position: 3,
          zoneId: null,
          categoryId: null,
          productId: "lager",
          target: station("bar"),
        },
        {
          id: "p3",
          position: 4,
          zoneId: null,
          categoryId: null,
          productId: "lager",
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["p1", "p3"]));
  });

  it("does not flag an exception behind one whose station is switched off", () => {
    const rules: RoutingRules = {
      ...base,
      activeStationIds: new Set(["bar", "mainBar", "kitchen"]),
      exceptions: [
        {
          id: "off",
          position: 1,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "on",
          position: 2,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set());
  });
});

describe("the design's terrace example, written in the wrong order", () => {
  it("flags the cocktails exception and sends a terrace mojito to the terrace bar", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "drinks",
          position: 1,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "cocktails",
          position: 2,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["cocktails"]));
    expect(chooseMaker(rules, mojito, "terrace").route).toEqual(station("terraceBar"));
  });
});

describe("routing edge cases", () => {
  it("breaks equal positions by id without changing the supplied exceptions", () => {
    const exceptions = [
      {
        id: "z",
        position: 1,
        zoneId: null,
        categoryId: null,
        productId: null,
        target: station("bar"),
      },
      {
        id: "a",
        position: 1,
        zoneId: null,
        categoryId: null,
        productId: null,
        target: station("mainBar"),
      },
    ];
    const rules = { ...base, exceptions };
    expect(chooseMaker(rules, bread, null).decidedBy).toEqual({
      kind: "exception",
      exceptionId: "a",
    });
    expect(unreachableExceptions(rules)).toEqual(new Set(["z"]));
    expect(exceptions.map(({ id }) => id)).toEqual(["z", "a"]);
  });

  it("requires both product and folder when an exception gives both", () => {
    const rules = {
      ...base,
      exceptions: [
        {
          id: "both",
          position: 1,
          zoneId: null,
          categoryId: "cocktails",
          productId: "mojito",
          target: station("mainBar"),
        },
      ],
    };
    expect(chooseMaker(rules, mojito, null).decidedBy).toEqual({
      kind: "exception",
      exceptionId: "both",
    });
    expect(chooseMaker(rules, { ...mojito, categoryId: "food" }, null).decidedBy).toEqual({
      kind: "default",
    });
    expect(chooseMaker(rules, { ...mojito, routedProductId: "different" }, null).decidedBy).toEqual(
      { kind: "claim", categoryId: "cocktails" },
    );
    expect(chooseMaker(rules, bread, null).decidedBy).toEqual({ kind: "default" });
  });

  it("records every inactive match in search order before accepting no preparation", () => {
    const rules = {
      ...base,
      activeStationIds: new Set<string>(),
      claims: new Map<string, RouteTarget>([
        ["cocktails", station("cocktailBar")],
        ["drinks", { kind: "no_preparation" as const }],
      ]),
      exceptions: [
        {
          id: "second",
          position: 2,
          zoneId: null,
          categoryId: null,
          productId: null,
          target: station("bar"),
        },
        {
          id: "first",
          position: 1,
          zoneId: null,
          categoryId: null,
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(chooseMaker(rules, mojito, null)).toEqual({
      route: { kind: "no_preparation" },
      decidedBy: { kind: "claim", categoryId: "drinks" },
      skipped: [
        { decision: { kind: "exception", exceptionId: "first" }, stationId: "mainBar" },
        { decision: { kind: "exception", exceptionId: "second" }, stationId: "bar" },
        { decision: { kind: "claim", categoryId: "cocktails" }, stationId: "cocktailBar" },
      ],
    });
  });

  it("rejects a switched-off default instead of routing work to it", () => {
    expect(chooseMaker({ ...base, activeStationIds: new Set() }, bread, null)).toEqual({
      route: null,
      decidedBy: null,
      skipped: [],
    });
  });

  it("keeps a missing category as the leaf and stops at a missing parent", () => {
    expect(folderAncestors(parentOf, "missing")).toEqual(["missing"]);
    expect(folderAncestors(new Map([["leaf", "missing"]]), "leaf")).toEqual(["leaf", "missing"]);
    expect(folderAncestors(new Map([["self", "self"]]), "self")).toEqual(["self"]);
    expect(folderAncestors(new Map([["", null]]), "")).toEqual([""]);
  });

  it.each([
    {
      name: "different products",
      aCategory: null,
      aProduct: "mojito",
      bCategory: null,
      bProduct: "lager",
      unreachable: false,
    },
    {
      name: "product before folder",
      aCategory: null,
      aProduct: "mojito",
      bCategory: "cocktails",
      bProduct: null,
      unreachable: false,
    },
    {
      name: "folder before product of unknown folder",
      aCategory: "drinks",
      aProduct: null,
      bCategory: null,
      bProduct: "mojito",
      unreachable: false,
    },
    {
      name: "different folders",
      aCategory: "food",
      aProduct: null,
      bCategory: "drinks",
      bProduct: null,
      unreachable: false,
    },
    {
      name: "narrow folder before parent",
      aCategory: "cocktails",
      aProduct: null,
      bCategory: "drinks",
      bProduct: null,
      unreachable: false,
    },
    {
      name: "folder before catch-all",
      aCategory: "drinks",
      aProduct: null,
      bCategory: null,
      bProduct: null,
      unreachable: false,
    },
    {
      name: "same folder",
      aCategory: "drinks",
      aProduct: null,
      bCategory: "drinks",
      bProduct: null,
      unreachable: true,
    },
  ])(
    "detects coverage accurately for $name",
    ({ aCategory, aProduct, bCategory, bProduct, unreachable }) => {
      const rules = {
        ...base,
        exceptions: [
          {
            id: "a",
            position: 1,
            zoneId: null,
            categoryId: aCategory,
            productId: aProduct,
            target: { kind: "no_preparation" as const },
          },
          {
            id: "b",
            position: 2,
            zoneId: "terrace",
            categoryId: bCategory,
            productId: bProduct,
            target: station("bar"),
          },
        ],
      };
      expect(unreachableExceptions(rules)).toEqual(new Set(unreachable ? ["b"] : []));
    },
  );
});
