import { describe, expect, it } from "vitest";
import {
  selectRoutingCell,
  selectionRulesFromModel,
  type GridCategory,
  type GridProduct,
  type GridRow,
  type RouteTarget,
  type RoutingCell,
  type RoutingModel,
  type RoutingRow,
  type RoutingSelectionRules,
} from "../routing.js";
import {
  collapseAll,
  collapseCategory,
  expandAll,
  expandCategory,
  pruneExpanded,
  rowInModel,
  visibleRoutingRows,
} from "./routing-grid-model.js";

const kitchen: RouteTarget = { kind: "station", stationId: "kitchen" };
const bar: RouteTarget = { kind: "station", stationId: "bar" };
const noPreparation: RouteTarget = { kind: "no_preparation" };

const folder = (id: string, parentId: string | null = null, name = id): GridCategory => ({
  id,
  name,
  parentId,
});
const item = (id: string, categoryId: string | null, name = id): GridProduct => ({
  id,
  name,
  categoryId,
});
const categoryCell = (
  categoryId: string,
  target: RouteTarget = bar,
  zoneId: string | null = null,
): RoutingCell => ({ row: { kind: "category", categoryId }, zoneId, target });
const productCell = (
  productId: string,
  target: RouteTarget = bar,
  zoneId: string | null = null,
): RoutingCell => ({ row: { kind: "product", productId }, zoneId, target });

function model(
  categories: GridCategory[],
  products: GridProduct[],
  cells: RoutingCell[] = [],
): RoutingModel {
  return {
    stationTimes: [],
    todayEnds: null,
    clockReadable: true,
    zones: [{ id: "terrace", name: "Terrace" }],
    categories,
    products,
    cells,
    defaultStationId: "kitchen",
    stations: [
      { id: "kitchen", name: "Kitchen", active: true },
      { id: "bar", name: "Bar", active: true },
    ],
  };
}

/** One line per entry: indentation is depth, then the label, path and hidden counts. */
function outline(entries: GridRow[]): string[] {
  return entries.map((entry) => {
    if (entry.row.kind === "no_category") return "[No category]";
    const label =
      entry.row.kind === "all"
        ? "[All]"
        : entry.row.kind === "category"
          ? `C:${entry.name}`
          : `P:${entry.name}`;
    const path = entry.path.length > 0 ? ` <${entry.path.join("/")}>` : "";
    const counts =
      entry.hiddenCategories + entry.hiddenProducts > 0
        ? ` {${entry.hiddenCategories},${entry.hiddenProducts}}`
        : "";
    return `${"  ".repeat(entry.depth)}${label}${path}${counts}`;
  });
}

const none: ReadonlySet<string> = new Set();

describe("visibleRoutingRows", () => {
  it("pins independently overlapping summaries", () => {
    const chain = model(
      [folder("root"), folder("a", "root"), folder("b", "a"), folder("c", "b")],
      [item("p-root", "root"), item("p-a", "a"), item("p-b", "b"), item("p-c", "c")],
      [categoryCell("b"), productCell("p-c")],
    );
    expect(outline(visibleRoutingRows(chain, none))).toEqual([
      "[All]",
      "  C:root {2,3}",
      "      C:b <root/a> {1,1}",
      "          P:p-c <root/a/b/c>",
    ]);
  });

  it("an explicit No preparation cell and an explicit-equal-to-inherited cell both keep their rows visible", () => {
    const venue = model(
      [folder("food")],
      [item("bread", "food"), item("soup", "food"), item("stew", "food")],
      [productCell("bread", noPreparation), productCell("soup", kitchen, "terrace")],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:food {0,1}",
      "    P:bread <food>",
      "    P:soup <food>",
    ]);
  });

  it("a cell for a product the model does not list counts zero; each product counts once", () => {
    const venue = model(
      [folder("drinks"), folder("wine")],
      [item("cola", "drinks"), item("lemonade", "drinks"), item("red", "wine")],
      [
        productCell("red"),
        productCell("red", kitchen, "terrace"),
        productCell("red-glass", kitchen),
      ],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:drinks {0,2}",
      "  C:wine",
      "    P:red <wine>",
    ]);
  });

  it("path labels disambiguate identical leaf names", () => {
    const venue = model(
      [
        folder("bar"),
        folder("dining"),
        folder("wine-1", "bar", "Wine"),
        folder("wine-2", "dining", "Wine"),
      ],
      [item("red-1", "wine-1", "House red"), item("red-2", "wine-2", "House red")],
      [productCell("red-1"), productCell("red-2")],
    );
    const rows = visibleRoutingRows(venue, none).filter((entry) => entry.row.kind === "product");
    expect(rows.map((entry) => entry.path)).toEqual([
      ["bar", "Wine"],
      ["dining", "Wine"],
    ]);
  });

  it("a visible exceptional category does not expand its descendants", () => {
    const venue = model(
      [folder("root"), folder("x", "root"), folder("y", "x")],
      [item("p-x", "x"), item("p-y", "y")],
      [categoryCell("x")],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:root {1,2}",
      "    C:x <root> {1,2}",
    ]);
  });

  it("an explicitly expanded exceptional category under a collapsed ancestor shows its children, and the ancestor's counts no longer include them", () => {
    const venue = model(
      [folder("root"), folder("x", "root"), folder("y", "x")],
      [item("p-x", "x"), item("p-y", "y")],
      [categoryCell("x")],
    );
    expect(outline(visibleRoutingRows(venue, new Set(["x"])))).toEqual([
      "[All]",
      "  C:root {0,1}",
      "    C:x <root>",
      "      C:y <root/x> {0,1}",
      "      P:p-x <root/x>",
    ]);
    expect(outline(visibleRoutingRows(venue, new Set(["y"])))).toEqual([
      "[All]",
      "  C:root {1,2}",
      "    C:x <root> {1,2}",
    ]);
  });

  it("expand one, expand all, collapse all change the rows and counts exactly", () => {
    const venue = model([folder("root"), folder("a", "root")], [item("p", "root"), item("q", "a")]);
    expect(outline(visibleRoutingRows(venue, none))).toEqual(["[All]", "  C:root {1,2}"]);
    const one = expandCategory(none, "root");
    expect(outline(visibleRoutingRows(venue, one))).toEqual([
      "[All]",
      "  C:root",
      "    C:a <root> {0,1}",
      "    P:p <root>",
    ]);
    expect(outline(visibleRoutingRows(venue, collapseCategory(one, "root")))).toEqual([
      "[All]",
      "  C:root {1,2}",
    ]);
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:root",
      "    C:a <root>",
      "      P:q <root/a>",
      "    P:p <root>",
    ]);
    expect(outline(visibleRoutingRows(venue, collapseAll()))).toEqual(["[All]", "  C:root {1,2}"]);
  });

  it("refresh keeps expansion, prunes removed ids, and starts new categories collapsed", () => {
    const before = model([folder("root"), folder("gone", "root")], [item("p", "root")]);
    const expanded = expandAll(before);
    const after = model(
      [folder("root"), folder("fresh", "root")],
      [item("p", "root"), item("q", "fresh")],
    );
    const kept = pruneExpanded(after, expanded);
    expect([...kept]).toEqual(["root"]);
    expect(outline(visibleRoutingRows(after, kept))).toEqual([
      "[All]",
      "  C:root",
      "    C:fresh <root> {0,1}",
      "    P:p <root>",
    ]);
  });

  it("the No category row lists every active uncategorised product at the bottom, carries the no_category address and counts nothing", () => {
    const venue = model(
      [folder("food")],
      [item("bread", "food"), item("menu-card", null), item("water", null)],
    );
    const entries = visibleRoutingRows(venue, none);
    expect(outline(entries)).toEqual([
      "[All]",
      "  C:food {0,1}",
      "[No category]",
      "  P:menu-card",
      "  P:water",
    ]);
    const noCategory: GridRow = {
      row: { kind: "no_category" },
      name: "",
      path: [],
      depth: 0,
      hiddenProducts: 0,
      hiddenCategories: 0,
    };
    expect(entries.at(-3)).toEqual(noCategory);
    expect(entries.filter((entry) => entry.row.kind === "all")).toHaveLength(1);
    expect(outline(visibleRoutingRows(venue, expandAll(venue))).slice(-3)).toEqual([
      "[No category]",
      "  P:menu-card",
      "  P:water",
    ]);
    expect(visibleRoutingRows(venue, expandAll(venue)).at(-3)).toEqual(noCategory);
    const filed = model([folder("food")], [item("bread", "food")]);
    expect(visibleRoutingRows(filed, none).some((entry) => entry.row.kind === "no_category")).toBe(
      false,
    );
    // A stored No category cell does not bring the row back without an uncategorised product.
    const storedOnly = model(
      [folder("food")],
      [item("bread", "food")],
      [{ row: { kind: "no_category" }, zoneId: "terrace", target: bar }],
    );
    expect(outline(visibleRoutingRows(storedOnly, none))).toEqual(["[All]", "  C:food {0,1}"]);
  });

  it("a product cell five category levels down stays visible under a collapsed root, once, with its path", () => {
    const venue = model(
      [
        folder("l1"),
        folder("l2", "l1"),
        folder("l3", "l2"),
        folder("l4", "l3"),
        folder("l5", "l4"),
      ],
      [item("deep", "l5")],
      [productCell("deep"), productCell("deep", kitchen, "terrace")],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:l1 {4,0}",
      "            P:deep <l1/l2/l3/l4/l5>",
    ]);
  });

  it("a disabled product's cell is neither shown nor counted, and returns when the model lists the product again", () => {
    const folders = [folder("food")];
    const enabled = model(folders, [item("bread", "food")], [productCell("bread")]);
    expect(outline(visibleRoutingRows(enabled, none))).toEqual([
      "[All]",
      "  C:food",
      "    P:bread <food>",
    ]);
    const disabled = model(folders, [], []);
    expect(outline(visibleRoutingRows(disabled, none))).toEqual(["[All]", "  C:food"]);
    const stray = model(folders, [], [productCell("bread")]);
    expect(outline(visibleRoutingRows(stray, none))).toEqual(["[All]", "  C:food"]);
    const again = model(folders, [item("bread", "food")], [productCell("bread")]);
    expect(outline(visibleRoutingRows(again, none))).toEqual([
      "[All]",
      "  C:food",
      "    P:bread <food>",
    ]);
  });

  it("terminates on a category parent cycle", () => {
    const venue = model(
      [folder("a", "b"), folder("b", "a"), folder("self", "self"), folder("root")],
      [item("p", "b")],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:self",
      "  C:root",
      "  C:a {1,1}",
    ]);
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:self",
      "  C:root",
      "  C:a",
      "    C:b <a>",
      "      P:p <a/b>",
    ]);
  });

  it("places a cycle member's descendants under it, once, even when listed before the cycle", () => {
    const venue = model(
      [folder("c", "b"), folder("a", "b"), folder("b", "a")],
      [item("p", "c")],
      [productCell("p")],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:b {2,0}",
      "      P:p <b/c>",
    ]);
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:b",
      "    C:c <b>",
      "      P:p <b/c>",
      "    C:a <b>",
    ]);
  });

  it("treats a category whose parent the model does not list as a root", () => {
    const venue = model([folder("orphan", "missing")], [item("p", "orphan")]);
    expect(outline(visibleRoutingRows(venue, none))).toEqual(["[All]", "  C:orphan {0,1}"]);
  });

  it("lists a product whose category the model does not list under No category", () => {
    const venue = model([folder("food")], [item("stray", "missing")]);
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:food",
      "[No category]",
      "  P:stray",
    ]);
  });
});

describe("selectionRulesFromModel", () => {
  type Station = { id: string; name: string; active: boolean; isDefault: boolean };

  // `server` is a hand copy of the rules `snapshot` (routing-store.ts) derives from these rows.
  function both(stations: Station[], extra: RoutingCell[] = []) {
    const folders = [folder("drinks"), folder("cocktails", "drinks"), folder("food")];
    const cells = [
      ...extra,
      categoryCell("drinks", bar),
      categoryCell("drinks", kitchen, "terrace"),
      categoryCell("food", noPreparation, "garden"),
      productCell("mojito", kitchen),
      productCell("loose", bar, "terrace"),
      { row: { kind: "all" }, zoneId: "garden", target: bar } satisfies RoutingCell,
    ];
    const server: RoutingSelectionRules = {
      cells: Object.freeze([...cells]),
      parentOf: new Map(folders.map((row) => [row.id, row.parentId])),
      activeStationIds: new Set(stations.filter((row) => row.active).map((row) => row.id)),
      defaultStationId: stations.find((row) => row.active && row.isDefault)?.id ?? null,
    };
    const wire: RoutingModel = JSON.parse(
      JSON.stringify({
        ...model(
          folders,
          [item("mojito", "cocktails"), item("loose", null), item("soup", "food")],
          cells,
        ),
        defaultStationId: server.defaultStationId,
        stations: stations.map(({ id, name, active }) => ({ id, name, active })),
      }),
    );
    return { server, wire };
  }

  const rows: [RoutingRow, string | null][] = [
    [{ kind: "all" }, null],
    [{ kind: "category", categoryId: "drinks" }, null],
    [{ kind: "category", categoryId: "cocktails" }, null],
    [{ kind: "category", categoryId: "food" }, null],
    [{ kind: "product", productId: "mojito" }, "cocktails"],
    [{ kind: "product", productId: "soup" }, "food"],
    [{ kind: "product", productId: "loose" }, null],
    [{ kind: "no_category" }, null],
  ];
  const zones = [null, "terrace", "garden"];

  function expectSameSelection(server: RoutingSelectionRules, wire: RoutingModel) {
    const browser = selectionRulesFromModel(wire);
    for (const [row, categoryId] of rows) {
      for (const zoneId of zones) {
        expect(
          selectRoutingCell(browser, row, zoneId, categoryId),
          `${JSON.stringify(row)} × ${zoneId}`,
        ).toEqual(selectRoutingCell(server, row, zoneId, categoryId));
      }
    }
    return browser;
  }

  it("selectionRulesFromModel equals server selection", () => {
    const active = both([
      { id: "kitchen", name: "Kitchen", active: true, isDefault: true },
      { id: "bar", name: "Bar", active: true, isDefault: false },
    ]);
    const browser = expectSameSelection(active.server, active.wire);
    const mojito: RoutingRow = { kind: "product", productId: "mojito" };
    const cocktails: RoutingRow = { kind: "category", categoryId: "cocktails" };
    const loose: RoutingRow = { kind: "product", productId: "loose" };
    // Same-row Every zone beats the parent's Terrace cell.
    expect(selectRoutingCell(browser, mojito, "terrace", "cocktails").decidedBy).toEqual({
      kind: "cell",
      address: { row: mojito, zoneId: null },
    });
    // An ancestor's zone cell.
    expect(selectRoutingCell(browser, cocktails, "terrace")).toEqual({
      target: kitchen,
      decidedBy: {
        kind: "cell",
        address: { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
      },
    });
    // Explicit No preparation.
    expect(
      selectRoutingCell(browser, { kind: "product", productId: "soup" }, "garden", "food").target,
    ).toEqual(noPreparation);
    // A product with no category owns its own cell, then All categories, then the default.
    expect(selectRoutingCell(browser, loose, "terrace").decidedBy).toEqual({
      kind: "cell",
      address: { row: loose, zoneId: "terrace" },
    });
    expect(selectRoutingCell(browser, loose, "garden").target).toEqual(bar);
    expect(selectRoutingCell(browser, loose, null)).toEqual({
      target: kitchen,
      decidedBy: { kind: "default" },
    });

    // No category's cells decide an uncategorised product before All categories, row first.
    const noCategory: RoutingRow = { kind: "no_category" };
    const sorted = both(
      [
        { id: "kitchen", name: "Kitchen", active: true, isDefault: true },
        { id: "bar", name: "Bar", active: true, isDefault: false },
      ],
      [
        { row: noCategory, zoneId: "terrace", target: kitchen },
        { row: noCategory, zoneId: null, target: noPreparation },
      ],
    );
    const withNoCategory = expectSameSelection(sorted.server, sorted.wire);
    expect(selectRoutingCell(withNoCategory, noCategory, "terrace")).toEqual({
      target: kitchen,
      decidedBy: { kind: "cell", address: { row: noCategory, zoneId: "terrace" } },
    });
    // No category × Every zone beats All categories × Garden.
    expect(selectRoutingCell(withNoCategory, loose, "garden")).toEqual({
      target: noPreparation,
      decidedBy: { kind: "cell", address: { row: noCategory, zoneId: null } },
    });
    expect(selectRoutingCell(withNoCategory, loose, null)).toEqual({
      target: noPreparation,
      decidedBy: { kind: "cell", address: { row: noCategory, zoneId: null } },
    });
    // The product's own cell still comes first.
    expect(selectRoutingCell(withNoCategory, loose, "terrace").decidedBy).toEqual({
      kind: "cell",
      address: { row: loose, zoneId: "terrace" },
    });
    // A product with a category never reads No category.
    expect(
      selectRoutingCell(withNoCategory, { kind: "product", productId: "soup" }, "terrace", "food"),
    ).toEqual({ target: kitchen, decidedBy: { kind: "default" } });

    const inactiveDefault = both([
      { id: "kitchen", name: "Kitchen", active: false, isDefault: true },
      { id: "bar", name: "Bar", active: true, isDefault: false },
    ]);
    const withoutDefault = expectSameSelection(inactiveDefault.server, inactiveDefault.wire);
    expect(selectRoutingCell(withoutDefault, loose, null)).toEqual({
      target: null,
      decidedBy: null,
    });
    // An out-of-date model can name a default its station list says is inactive.
    const staleDefault = { ...inactiveDefault.wire, defaultStationId: "kitchen" };
    expect(selectRoutingCell(selectionRulesFromModel(staleDefault), loose, null)).toEqual({
      target: null,
      decidedBy: null,
    });
  });

  it("freezes its own copy of the model's cells", () => {
    const { wire } = both([{ id: "kitchen", name: "Kitchen", active: true, isDefault: true }]);
    const rules = selectionRulesFromModel(wire);
    expect(Object.isFrozen(rules.cells)).toBe(true);
    expect(rules.cells).not.toBe(wire.cells);
    expect(rules.cells).toEqual(wire.cells);
    expect(Object.isFrozen(wire.cells)).toBe(false);
  });
});

describe("rowInModel", () => {
  const rowKey = (row: RoutingRow) => JSON.stringify(row);
  const nested = [
    folder("drinks"),
    folder("cocktails", "drinks"),
    folder("sours", "cocktails"),
    folder("orphan", "gone"),
    folder("loop-a", "loop-b"),
    folder("loop-b", "loop-a"),
  ];
  const candidates: RoutingRow[] = [
    { kind: "all" },
    { kind: "no_category" },
    ...[...nested.map((c) => c.id), "missing"].map((categoryId): RoutingRow => ({
      kind: "category",
      categoryId,
    })),
    ...["sour", "bread", "stray", "looped", "missing"].map((productId): RoutingRow => ({
      kind: "product",
      productId,
    })),
  ];

  it("answers whether the row appears with every category expanded, for every row kind", () => {
    const models = [
      model(nested, [item("sour", "sours"), item("bread", null), item("stray", "gone")]),
      model(nested, [item("sour", "sours"), item("bread", null)]),
      model(nested, [item("sour", "sours"), item("stray", "gone")]),
      model(nested, [item("sour", "sours"), item("looped", "loop-b")]),
      model([], []),
    ];
    for (const routing of models) {
      const shown = new Set(
        visibleRoutingRows(routing, expandAll(routing)).map((entry) => rowKey(entry.row)),
      );
      for (const row of candidates) {
        expect([rowKey(row), rowInModel(routing, row)]).toEqual([
          rowKey(row),
          shown.has(rowKey(row)),
        ]);
      }
    }
    expect(rowInModel(models[3]!, { kind: "no_category" })).toBe(false);
    expect(rowInModel(models[1]!, { kind: "no_category" })).toBe(true);
    expect(rowInModel(models[2]!, { kind: "no_category" })).toBe(true);
  });
});
