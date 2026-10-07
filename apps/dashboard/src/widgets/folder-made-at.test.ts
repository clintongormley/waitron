import { describe, expect, it } from "vitest";
import type { RoutingModel } from "@waitron/venue-service/routing";
import type { CategorySummary, Product } from "../api/client.js";
import {
  folderMadeAt,
  isRouted,
  type FolderMaker,
  type FolderMakerSource,
} from "./folder-made-at.js";

type Target = { kind: "station"; stationId: string } | { kind: "no_preparation" };
const station = (stationId: string): Target => ({ kind: "station", stationId });

const folder = (id: string, name: string, parentId: string | null): CategorySummary => ({
  id,
  name,
  parentId,
  color: null,
});
/** Drinks > Beer > Craft, and Food beside them. */
const CATEGORIES = [
  folder("drinks", "Drinks", null),
  folder("beer", "Beer", "drinks"),
  folder("craft", "Craft", "beer"),
  folder("food", "Food", null),
];

const product = (
  id: string,
  primaryCategoryId: string | null,
  active = true,
  variants: Product["variants"] = [],
): Product =>
  ({
    id,
    name: id,
    primaryCategoryId,
    categoryId: primaryCategoryId,
    active,
    variants,
  }) as unknown as Product;

const STATIONS = [
  { id: "bar", name: "Bar", active: true },
  { id: "kitchen", name: "Kitchen", active: true },
  { id: "cocktail", name: "Cocktail bar", active: false },
  { id: "terrace", name: "Terrace bar", active: true },
];

function routing(overrides: Partial<RoutingModel> = {}): RoutingModel {
  return {
    stationTimes: [],
    todayEnds: null,
    clockReadable: true,
    zones: [{ id: "terrace-zone", name: "Terrace" }],
    categories: CATEGORIES.map(({ id, name, parentId }) => ({ id, name, parentId })),
    products: [],
    cells: [],
    defaultStationId: null,
    stations: STATIONS,
    ...overrides,
  };
}
type Row = RoutingModel["cells"][number]["row"];
const category = (categoryId: string): Row => ({ kind: "category", categoryId });
const productRow = (productId: string): Row => ({ kind: "product", productId });
const cell = (row: Row, target: Target, zoneId: string | null = null) => ({ row, zoneId, target });
/** The category's Every zone cell. */
const onCategory = (categoryId: string, target: Target) => cell(category(categoryId), target);
const times = (
  stationId: string,
  fields: Partial<RoutingModel["stationTimes"][number]> = {},
): RoutingModel["stationTimes"][number] => ({
  stationId,
  status: { open: true, why: "no_hours" },
  hours: [],
  fallbackStationId: null,
  today: null,
  closedSendsTo: null,
  nextTransition: null,
  ...fields,
});

const madeAt = (model: RoutingModel, products: Product[] = []) =>
  folderMadeAt(model, CATEGORIES, products);

describe("folderMadeAt — the category's own baseline", () => {
  it("names the station the category's Every zone cell sends its dishes to, as set on that category", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("bar"))] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "station", stationName: "Bar" },
      source: { kind: "own" },
      someElsewhere: false,
    });
  });

  it("inherits a cell from a category two levels up and names that category", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("bar"))] }));
    expect(result.get("craft")).toEqual({
      maker: { kind: "station", stationName: "Bar" },
      source: { kind: "inherited", name: "Drinks" },
      someElsewhere: false,
    });
    expect(result.get("beer")?.source).toEqual({ kind: "inherited", name: "Drinks" });
  });

  it("prefers the nearest cell: a cell on the middle category wins over the top one", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("bar")), onCategory("beer", station("kitchen"))],
      }),
    );
    expect(result.get("craft")).toMatchObject({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "inherited", name: "Beer" },
    });
  });

  it("falls to the venue's default station when no cell covers the category", () => {
    const result = madeAt(routing({ defaultStationId: "kitchen" }));
    expect(result.get("food")).toEqual({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "default" },
      someElsewhere: false,
    });
  });

  it("reads a category's own cell naming the default station as its own, not as the default", () => {
    const result = madeAt(
      routing({ cells: [onCategory("food", station("kitchen"))], defaultStationId: "kitchen" }),
    );
    expect(result.get("food")).toEqual({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "own" },
      someElsewhere: false,
    });
    expect(result.get("drinks")).toEqual({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "default" },
      someElsewhere: false,
    });
  });

  it("reports no preparation from a No preparation cell", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", { kind: "no_preparation" })] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "no_preparation" },
      source: { kind: "own" },
      someElsewhere: false,
    });
    expect(result.get("beer")?.maker).toEqual({ kind: "no_preparation" });
  });

  it("reports nowhere, with no source, when no cell or default covers the category", () => {
    const result = madeAt(routing());
    expect(result.get("food")).toEqual({
      maker: { kind: "nowhere" },
      source: null,
      someElsewhere: false,
    });
  });

  it("names the disabled station when the cell's station has no replacement", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("cocktail"))] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "no_replacement", stationName: "Cocktail bar" },
      source: { kind: "own" },
      someElsewhere: false,
    });
  });

  it("follows a switched-off station's fallback, as product rows do", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("cocktail"))],
        stationTimes: [times("cocktail", { fallbackStationId: "bar" })],
      }),
    );
    expect(result.get("drinks")?.maker).toEqual({ kind: "station", stationName: "Bar" });
  });

  it("is decided by the category's Every zone cell", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("bar")), onCategory("beer", station("kitchen"))],
      }),
    );
    expect(result.get("beer")).toMatchObject({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "own" },
    });
    expect(result.get("drinks")?.source).toEqual({ kind: "own" });
  });

  it("does not let a zone's or a product's cell decide the baseline", () => {
    const result = madeAt(
      routing({
        cells: [
          onCategory("drinks", station("bar")),
          cell(category("drinks"), station("terrace"), "terrace-zone"),
          cell({ kind: "all" }, station("terrace"), "terrace-zone"),
          cell(productRow("cola"), station("kitchen")),
        ],
      }),
    );
    expect(result.get("drinks")?.maker).toEqual({ kind: "station", stationName: "Bar" });
    expect(result.get("drinks")?.source).toEqual({ kind: "own" });
  });

  it("a No category cell changes no category's Made at", () => {
    const result = madeAt(
      routing({
        cells: [
          cell({ kind: "no_category" }, station("kitchen")),
          cell({ kind: "no_category" }, station("terrace"), "terrace-zone"),
        ],
      }),
      [product("loose", null)],
    );
    for (const id of ["drinks", "beer", "craft", "food"])
      expect(result.get(id)).toEqual({
        maker: { kind: "nowhere" },
        source: null,
        someElsewhere: false,
      });
  });

  it("gives every category an entry, and none to an unknown one", () => {
    const result = madeAt(routing());
    expect([...result.keys()].sort()).toEqual(["beer", "craft", "drinks", "food"]);
  });
});

describe("folderMadeAt — whether the baseline holds for everything inside", () => {
  const barOnDrinks = { cells: [onCategory("drinks", station("bar"))] };

  it("says some items are made elsewhere when a product's cell sends a contained dish elsewhere", () => {
    const result = madeAt(
      routing({
        cells: [...barOnDrinks.cells, cell(productRow("ipa"), station("kitchen"))],
      }),
      [product("ipa", "craft"), product("cola", "drinks")],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("beer")?.someElsewhere).toBe(true);
    expect(result.get("craft")?.someElsewhere).toBe(true);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });

  it("does not qualify the baseline for a cell that sends the dish to the same station", () => {
    const result = madeAt(
      routing({ cells: [...barOnDrinks.cells, cell(productRow("ipa"), station("bar"))] }),
      [product("ipa", "craft")],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("ignores inactive products, as product rows' routing does", () => {
    const result = madeAt(
      routing({
        cells: [...barOnDrinks.cells, cell(productRow("ipa"), station("kitchen"))],
      }),
      [product("ipa", "craft", false)],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("qualifies the baseline when a zone cell sends the category's dishes elsewhere in one zone", () => {
    const result = madeAt(
      routing({
        cells: [...barOnDrinks.cells, cell(category("beer"), station("terrace"), "terrace-zone")],
      }),
      [product("cola", "drinks")],
    );
    expect(result.get("beer")?.someElsewhere).toBe(true);
    expect(result.get("craft")?.someElsewhere).toBe(true);
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });

  it("qualifies the baseline when a zone cell sends one contained product elsewhere", () => {
    const result = madeAt(
      routing({
        cells: [...barOnDrinks.cells, cell(productRow("cola"), station("terrace"), "terrace-zone")],
      }),
      [product("cola", "drinks"), product("ipa", "craft")],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("beer")?.someElsewhere).toBe(false);
  });

  it("qualifies a category that an All categories zone cell sends elsewhere in one zone", () => {
    const result = madeAt(
      routing({
        ...barOnDrinks,
        defaultStationId: "kitchen",
        cells: [...barOnDrinks.cells, cell({ kind: "all" }, station("terrace"), "terrace-zone")],
      }),
    );
    expect(result.get("food")?.someElsewhere).toBe(true);
    // Drinks' own Every zone cell comes before All categories in the row order.
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("among several zones where only some have cells, qualifies by the zones with cells and ignores an inactive one", () => {
    const sides = folder("sides", "Sides", null);
    const result = folderMadeAt(
      routing({
        zones: [
          { id: "terrace-zone", name: "Terrace" },
          { id: "patio-zone", name: "Patio" },
          { id: "hall-zone", name: "Hall" },
        ],
        cells: [
          onCategory("drinks", station("bar")),
          cell(category("beer"), station("kitchen"), "patio-zone"),
          cell({ kind: "all" }, station("terrace"), "terrace-zone"),
          onCategory("food", station("kitchen")),
          cell(category("food"), station("bar"), "old-zone"),
        ],
        defaultStationId: "kitchen",
      }),
      [...CATEGORIES, sides],
      [product("chips", "sides"), product("bread", null)],
    );
    expect(
      Object.fromEntries([...result].map(([id, { someElsewhere }]) => [id, someElsewhere])),
    ).toEqual({ drinks: true, beer: true, craft: true, food: false, sides: true });
  });

  it("ignores a cell on a zone that is not an active zone", () => {
    const result = madeAt(
      routing({
        cells: [...barOnDrinks.cells, cell(category("beer"), station("terrace"), "closed-zone")],
      }),
    );
    expect(result.get("beer")?.someElsewhere).toBe(false);
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("qualifies a parent whose subcategory's cell names another station, but not the subcategory", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("bar")), onCategory("craft", station("kitchen"))],
      }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("beer")?.someElsewhere).toBe(true);
    expect(result.get("craft")?.someElsewhere).toBe(false);
  });

  it("does not qualify a parent whose subcategory's cell names the same station", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("bar")), onCategory("craft", station("bar"))],
      }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("qualifies a station that opening hours can close", () => {
    const result = madeAt(
      routing({
        ...barOnDrinks,
        stationTimes: [
          times("bar", { hours: [{ weekday: 1, opensAt: "18:00", closesAt: "23:00" }] }),
        ],
      }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
  });

  it("qualifies a station whose standard week is Closed every day", () => {
    const result = madeAt(
      routing({ ...barOnDrinks, stationTimes: [times("bar", { hours: [], weekSet: true })] }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
  });

  it("does not qualify a station opened by hand today that keeps no hours", () => {
    const result = madeAt(
      routing({ ...barOnDrinks, stationTimes: [times("bar", { today: "open" })] }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("qualifies a station with no weekly hours that a current or future special date closes", () => {
    const restricted = madeAt(
      routing({
        ...barOnDrinks,
        stationTimes: [times("bar", { weekSet: false, specialDateRestricts: true })],
      }),
    );
    expect(restricted.get("drinks")?.someElsewhere).toBe(true);
    const unrestricted = madeAt(
      routing({
        ...barOnDrinks,
        stationTimes: [times("bar", { weekSet: false, specialDateRestricts: false })],
      }),
    );
    expect(unrestricted.get("drinks")?.someElsewhere).toBe(false);
  });

  it("qualifies a station closed by hand today", () => {
    const result = madeAt(
      routing({ ...barOnDrinks, stationTimes: [times("bar", { today: "closed" })] }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
  });

  it("does not qualify the default station, which is always open, nor a station with no hours", () => {
    const hours = [{ weekday: 1, opensAt: "18:00", closesAt: "23:00" }];
    const result = madeAt(
      routing({
        cells: [onCategory("food", station("bar"))],
        defaultStationId: "kitchen",
        stationTimes: [times("kitchen", { hours }), times("bar")],
      }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });

  it("does not qualify a no-preparation or nowhere baseline for timing", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", { kind: "no_preparation" })] }));
    expect(result.get("drinks")?.someElsewhere).toBe(false);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });
});

describe("folderMadeAt — names it cannot find", () => {
  it("names no switched-off station when the routing model does not list it", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("ghost"))] }));
    expect(result.get("drinks")?.maker).toEqual({ kind: "no_replacement", stationName: null });
  });

  it("names no category for a cell on a parent the category list does not hold", () => {
    const result = folderMadeAt(
      routing({ cells: [onCategory("missing", station("bar"))] }),
      [folder("orphan", "Orphan", "missing")],
      [product("cola", "elsewhere")],
    );
    expect(result.get("orphan")).toEqual({
      maker: { kind: "station", stationName: "Bar" },
      source: { kind: "inherited", name: null },
      someElsewhere: false,
    });
  });
});

describe("isRouted — what the category tree's asterisk reads", () => {
  const made = (maker: FolderMaker, source: FolderMakerSource | null) => ({
    maker,
    source,
    someElsewhere: false,
  });
  const bar = { kind: "station", stationName: "Bar" } as const;

  it("counts a route that reaches a station or no preparation, whatever decided it", () => {
    expect(isRouted(made(bar, { kind: "own" }))).toBe(true);
    expect(isRouted(made(bar, { kind: "inherited", name: "Drinks" }))).toBe(true);
    expect(isRouted(made(bar, { kind: "inherited", name: null }))).toBe(true);
    expect(isRouted(made(bar, { kind: "default" }))).toBe(true);
    expect(isRouted(made({ kind: "no_preparation" }, { kind: "inherited", name: "Drinks" }))).toBe(
      true,
    );
  });

  it("does not count no rule, or a rule whose station has no replacement", () => {
    expect(isRouted(made({ kind: "nowhere" }, null))).toBe(false);
    expect(isRouted(made({ kind: "no_replacement", stationName: "Bar" }, { kind: "own" }))).toBe(
      false,
    );
  });

  it("does not count a maker that reaches nowhere, whatever the source", () => {
    expect(isRouted(made({ kind: "nowhere" }, { kind: "own" }))).toBe(false);
    expect(isRouted(made({ kind: "nowhere" }, { kind: "inherited", name: "Drinks" }))).toBe(false);
    expect(isRouted(made({ kind: "nowhere" }, { kind: "default" }))).toBe(false);
  });
});
