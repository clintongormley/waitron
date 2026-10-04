import { describe, expect, it } from "vitest";
import type { RoutingModel } from "@waitron/venue-service/routing";
import type { CategorySummary, Product } from "../api/client.js";
import { folderMadeAt } from "./folder-made-at.js";

type Target = { kind: "station"; stationId: string } | { kind: "no_preparation" };
const station = (stationId: string): Target => ({ kind: "station", stationId });

const folder = (id: string, name: string, parentId: string | null): CategorySummary => ({
  id,
  name,
  parentId,
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
    claims: [],
    exceptions: [],
    unassigned: { folders: [], products: [] },
    defaultStationId: null,
    stations: STATIONS,
    ...overrides,
  };
}
const claim = (categoryId: string, target: Target) => ({ categoryId, target, stationOff: false });
let nextId = 0;
const exception = (
  fields: { zoneId?: string | null; categoryId?: string | null; productId?: string | null },
  target: Target,
) => ({
  id: `e${nextId++}`,
  position: nextId,
  zoneId: null,
  categoryId: null,
  productId: null,
  ...fields,
  target,
  neverMatches: false,
  stationOff: false,
});
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
  ...fields,
});

const madeAt = (model: RoutingModel, products: Product[] = []) =>
  folderMadeAt(model, CATEGORIES, products);

describe("folderMadeAt — the category's own baseline", () => {
  it("names the station a claim on the category sends its dishes to, as set on that category", () => {
    const result = madeAt(routing({ claims: [claim("drinks", station("bar"))] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "station", stationName: "Bar" },
      source: { kind: "own" },
      someElsewhere: false,
    });
  });

  it("inherits a claim from a category two levels up and names that category", () => {
    const result = madeAt(routing({ claims: [claim("drinks", station("bar"))] }));
    expect(result.get("craft")).toEqual({
      maker: { kind: "station", stationName: "Bar" },
      source: { kind: "inherited", name: "Drinks" },
      someElsewhere: false,
    });
    expect(result.get("beer")?.source).toEqual({ kind: "inherited", name: "Drinks" });
  });

  it("prefers the nearest claim: a claim on the middle category wins over the top one", () => {
    const result = madeAt(
      routing({ claims: [claim("drinks", station("bar")), claim("beer", station("kitchen"))] }),
    );
    expect(result.get("craft")).toMatchObject({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "inherited", name: "Beer" },
    });
  });

  it("falls to the venue's default station when nothing claims the category", () => {
    const result = madeAt(routing({ defaultStationId: "kitchen" }));
    expect(result.get("food")).toEqual({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "default" },
      someElsewhere: false,
    });
  });

  it("reports no preparation from a no-preparation claim", () => {
    const result = madeAt(routing({ claims: [claim("drinks", { kind: "no_preparation" })] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "no_preparation" },
      source: { kind: "own" },
      someElsewhere: false,
    });
    expect(result.get("beer")?.maker).toEqual({ kind: "no_preparation" });
  });

  it("reports nowhere, with no source, when no claim, exception or default covers the category", () => {
    const result = madeAt(routing());
    expect(result.get("food")).toEqual({
      maker: { kind: "nowhere" },
      source: null,
      someElsewhere: false,
    });
  });

  it("names the switched-off station when the claimed station has no replacement", () => {
    const result = madeAt(routing({ claims: [claim("drinks", station("cocktail"))] }));
    expect(result.get("drinks")).toEqual({
      maker: { kind: "no_replacement", stationName: "Cocktail bar" },
      source: { kind: "own" },
      someElsewhere: false,
    });
  });

  it("follows a switched-off station's fallback, as product rows do", () => {
    const result = madeAt(
      routing({
        claims: [claim("drinks", station("cocktail"))],
        stationTimes: [times("cocktail", { fallbackStationId: "bar" })],
      }),
    );
    expect(result.get("drinks")?.maker).toEqual({ kind: "station", stationName: "Bar" });
  });

  it("is decided by an exception that covers the category for every dish in every zone", () => {
    const result = madeAt(
      routing({
        claims: [claim("drinks", station("bar"))],
        exceptions: [exception({ categoryId: "beer" }, station("kitchen"))],
      }),
    );
    expect(result.get("craft")).toMatchObject({
      maker: { kind: "station", stationName: "Kitchen" },
      source: { kind: "exception" },
    });
    expect(result.get("drinks")?.source).toEqual({ kind: "own" });
  });

  it("does not let a zone's or a product's exception decide the baseline", () => {
    const result = madeAt(
      routing({
        claims: [claim("drinks", station("bar"))],
        exceptions: [
          exception({ zoneId: "terrace-zone", categoryId: "drinks" }, station("terrace")),
          exception({ productId: "cola" }, station("kitchen")),
        ],
      }),
    );
    expect(result.get("drinks")?.maker).toEqual({ kind: "station", stationName: "Bar" });
    expect(result.get("drinks")?.source).toEqual({ kind: "own" });
  });

  it("gives every category an entry, and none to an unknown one", () => {
    const result = madeAt(routing());
    expect([...result.keys()].sort()).toEqual(["beer", "craft", "drinks", "food"]);
  });
});

describe("folderMadeAt — whether the baseline holds for everything inside", () => {
  const barOnDrinks = { claims: [claim("drinks", station("bar"))] };

  it("says some items are made elsewhere when a product exception sends a contained dish elsewhere", () => {
    const result = madeAt(
      routing({
        ...barOnDrinks,
        exceptions: [exception({ productId: "ipa" }, station("kitchen"))],
      }),
      [product("ipa", "craft"), product("cola", "drinks")],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("beer")?.someElsewhere).toBe(true);
    expect(result.get("craft")?.someElsewhere).toBe(true);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });

  it("does not qualify the baseline for an exception that sends the dish to the same station", () => {
    const result = madeAt(
      routing({ ...barOnDrinks, exceptions: [exception({ productId: "ipa" }, station("bar"))] }),
      [product("ipa", "craft")],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("ignores inactive products, as product rows' routing does", () => {
    const result = madeAt(
      routing({
        ...barOnDrinks,
        exceptions: [exception({ productId: "ipa" }, station("kitchen"))],
      }),
      [product("ipa", "craft", false)],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
  });

  it("qualifies the baseline when a zone exception sends the category's dishes elsewhere in one zone", () => {
    const result = madeAt(
      routing({
        ...barOnDrinks,
        exceptions: [exception({ zoneId: "terrace-zone", categoryId: "beer" }, station("terrace"))],
      }),
      [product("cola", "drinks")],
    );
    expect(result.get("beer")?.someElsewhere).toBe(true);
    expect(result.get("craft")?.someElsewhere).toBe(true);
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });

  it("qualifies the baseline when a zone exception sends one contained product elsewhere", () => {
    const result = madeAt(
      routing({
        ...barOnDrinks,
        exceptions: [exception({ zoneId: "terrace-zone", productId: "cola" }, station("terrace"))],
      }),
      [product("cola", "drinks"), product("ipa", "craft")],
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("beer")?.someElsewhere).toBe(false);
  });

  it("qualifies a parent whose subcategory claims another station, but not the subcategory", () => {
    const result = madeAt(
      routing({ claims: [claim("drinks", station("bar")), claim("craft", station("kitchen"))] }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(true);
    expect(result.get("beer")?.someElsewhere).toBe(true);
    expect(result.get("craft")?.someElsewhere).toBe(false);
  });

  it("does not qualify a parent whose subcategory claims the same station", () => {
    const result = madeAt(
      routing({ claims: [claim("drinks", station("bar")), claim("craft", station("bar"))] }),
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

  it("does not qualify a station opened by hand today that keeps no hours", () => {
    const result = madeAt(
      routing({ ...barOnDrinks, stationTimes: [times("bar", { today: "open" })] }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
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
        claims: [claim("food", station("bar"))],
        defaultStationId: "kitchen",
        stationTimes: [times("kitchen", { hours }), times("bar")],
      }),
    );
    expect(result.get("drinks")?.someElsewhere).toBe(false);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });

  it("does not qualify a no-preparation or nowhere baseline for timing", () => {
    const result = madeAt(routing({ claims: [claim("drinks", { kind: "no_preparation" })] }));
    expect(result.get("drinks")?.someElsewhere).toBe(false);
    expect(result.get("food")?.someElsewhere).toBe(false);
  });
});

describe("folderMadeAt — names it cannot find", () => {
  it("names no switched-off station when the routing model does not list it", () => {
    const result = madeAt(routing({ claims: [claim("drinks", station("ghost"))] }));
    expect(result.get("drinks")?.maker).toEqual({ kind: "no_replacement", stationName: null });
  });

  it("names no category for a claim on a parent the category list does not hold", () => {
    const result = folderMadeAt(
      routing({ claims: [claim("missing", station("bar"))] }),
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
