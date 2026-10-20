import { describe, expect, it } from "vitest";
import type { RoutingModel } from "@waitron/venue-service/routing";
import type { CategorySummary } from "../api/client.js";
import { folderMadeAt, isRouted, type FolderMaker } from "./folder-made-at.js";

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

const STATIONS: RoutingModel["stations"] = [
  { id: "bar", name: "Bar", active: true, colour: "blue" },
  { id: "kitchen", name: "Kitchen", active: true, colour: "orange" },
  { id: "cocktail", name: "Cocktail bar", active: false, colour: "purple" },
  { id: "terrace", name: "Terrace bar", active: true, colour: "teal" },
];

function routing(overrides: Partial<RoutingModel> = {}): RoutingModel {
  return {
    stationTimes: [],
    periods: [],
    todayEnds: null,
    clockReadable: true,
    zones: [{ id: "terrace-zone", name: "Terrace", departmentId: null }],
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
  fields: Partial<RoutingModel["stationTimes"][number]> & {
    fallbackStationId?: string | null;
    hours?: { weekday: number; opensAt: string; closesAt: string }[];
    weekSet?: boolean;
    specialDateRestricts?: boolean;
  } = {},
): RoutingModel["stationTimes"][number] => ({
  stationId,
  status: { open: true, why: "open" },
  today: null,
  closedSendsTo: null,
  ...fields,
});

const madeAt = (model: RoutingModel) => folderMadeAt(model, CATEGORIES);

describe("folderMadeAt — the category's own baseline", () => {
  it("names the station the category's Every zone cell sends its dishes to, as set on that category", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("bar"))] }));
    expect(result.get("drinks")).toEqual({ maker: { kind: "station", stationName: "Bar" } });
  });

  it("inherits a cell from a category two levels up and names that category", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("bar"))] }));
    expect(result.get("craft")).toEqual({ maker: { kind: "station", stationName: "Bar" } });
  });

  it("prefers the nearest cell: a cell on the middle category wins over the top one", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("bar")), onCategory("beer", station("kitchen"))],
      }),
    );
    expect(result.get("craft")).toEqual({ maker: { kind: "station", stationName: "Kitchen" } });
  });

  it("falls to the venue's default station when no cell covers the category", () => {
    const result = madeAt(routing({ defaultStationId: "kitchen" }));
    expect(result.get("food")).toEqual({ maker: { kind: "station", stationName: "Kitchen" } });
  });

  it("reads a category's own cell naming the default station, and the default for a category with no cell", () => {
    const result = madeAt(
      routing({ cells: [onCategory("food", station("kitchen"))], defaultStationId: "kitchen" }),
    );
    expect(result.get("food")).toEqual({ maker: { kind: "station", stationName: "Kitchen" } });
    expect(result.get("drinks")).toEqual({ maker: { kind: "station", stationName: "Kitchen" } });
  });

  it("reports no preparation from a No preparation cell", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", { kind: "no_preparation" })] }));
    expect(result.get("drinks")).toEqual({ maker: { kind: "no_preparation" } });
    expect(result.get("beer")?.maker).toEqual({ kind: "no_preparation" });
  });

  it("reports nowhere, with no source, when no cell or default covers the category", () => {
    const result = madeAt(routing());
    expect(result.get("food")).toEqual({ maker: { kind: "nowhere" } });
  });

  it("names the disabled station when the cell's station has no replacement", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("cocktail"))] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "no_replacement", stationName: "Cocktail bar" },
    });
  });

  it("sends a switched-off station's work to the default, as product rows do", () => {
    const result = madeAt(
      routing({
        cells: [onCategory("drinks", station("cocktail"))],
        defaultStationId: "bar",
        stationTimes: [times("cocktail", { fallbackStationId: "terrace" })],
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
    expect(result.get("beer")).toEqual({ maker: { kind: "station", stationName: "Kitchen" } });
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
  });

  it("a No category cell changes no category's Made at", () => {
    const result = madeAt(
      routing({
        cells: [
          cell({ kind: "no_category" }, station("kitchen")),
          cell({ kind: "no_category" }, station("terrace"), "terrace-zone"),
        ],
      }),
    );
    for (const id of ["drinks", "beer", "craft", "food"])
      expect(result.get(id)).toEqual({ maker: { kind: "nowhere" } });
  });

  it("gives every category an entry, and none to an unknown one", () => {
    const result = madeAt(routing());
    expect([...result.keys()].sort()).toEqual(["beer", "craft", "drinks", "food"]);
  });
});

describe("folderMadeAt — whether the baseline holds for everything inside", () => {
  it("keeps a category's own station as its baseline when a period line sends its dishes elsewhere", () => {
    const lunch = [{ periodId: "lunch", target: station("kitchen") }];
    const result = madeAt(
      routing({ cells: [{ ...onCategory("drinks", station("bar")), periods: lunch }] }),
    );
    expect(result.get("drinks")).toEqual({ maker: { kind: "station", stationName: "Bar" } });
  });
});

describe("folderMadeAt — names it cannot find", () => {
  it("names no switched-off station when the routing model does not list it", () => {
    const result = madeAt(routing({ cells: [onCategory("drinks", station("ghost"))] }));
    expect(result.get("drinks")?.maker).toEqual({ kind: "no_replacement", stationName: null });
  });

  it("names no category for a cell on a parent the category list does not hold", () => {
    const result = folderMadeAt(routing({ cells: [onCategory("missing", station("bar"))] }), [
      folder("orphan", "Orphan", "missing"),
    ]);
    expect(result.get("orphan")).toEqual({ maker: { kind: "station", stationName: "Bar" } });
  });
});

describe("isRouted — what the category tree's asterisk reads", () => {
  const made = (maker: FolderMaker) => ({ maker });
  const bar = { kind: "station", stationName: "Bar" } as const;

  it("counts a route that reaches a station or no preparation", () => {
    expect(isRouted(made(bar))).toBe(true);
    expect(isRouted(made({ kind: "no_preparation" }))).toBe(true);
  });

  it("does not count no rule, or a rule whose station has no replacement", () => {
    expect(isRouted(made({ kind: "nowhere" }))).toBe(false);
    expect(isRouted(made({ kind: "no_replacement", stationName: "Bar" }))).toBe(false);
  });
});

describe("folderMadeAt — station schedules no longer change the baseline", () => {
  it.each([
    { hours: [{ weekday: 1, opensAt: "18:00", closesAt: "23:00" }] },
    { weekSet: true },
    { specialDateRestricts: true },
    { today: "closed" as const, closedSendsTo: "kitchen" },
  ])("keeps a category made in one place with retired timing %j", (fields) => {
    const result = madeAt(
      routing({
        defaultStationId: "kitchen",
        cells: [onCategory("drinks", station("bar"))],
        stationTimes: [times("bar", fields)],
      }),
    );
    expect(result.get("drinks")).toEqual({ maker: { kind: "station", stationName: "Bar" } });
  });
});
