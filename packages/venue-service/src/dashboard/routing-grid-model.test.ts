import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { foldForSearch, textSearch } from "@waitron/shared";
import {
  selectRoutingCell,
  selectionRulesFromModel,
  type GridCategory,
  type GridProduct,
  type GridRow,
  type RouteTarget,
  type RoutingCell,
  type RoutingModel,
  type RoutingPeriod,
  type RoutingRow,
  type RoutingSelectionRules,
} from "../routing.js";
import {
  blankZoneCell,
  cellPeriodLines,
  collapseCategory,
  expandAll,
  expandCategory,
  matchRanges,
  pruneExpanded,
  rowInModel,
  searchRows,
  stationDuring,
  usedStations,
  visibleRoutingRows,
  type SearchRow,
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
    periods: [],
    todayEnds: null,
    clockReadable: true,
    zones: [{ id: "terrace", name: "Terrace", departmentId: "dining" }],
    categories,
    products,
    cells,
    defaultStationId: "kitchen",
    stations: [
      { id: "kitchen", name: "Kitchen", active: true, colour: "orange" },
      { id: "bar", name: "Bar", active: true, colour: "blue" },
    ],
  };
}

/** One line per entry: indentation is depth, then the label and path. */
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
    return `${"  ".repeat(entry.depth)}${label}${path}`;
  });
}

const none: ReadonlySet<string> = new Set();

describe("visibleRoutingRows own-routing rows", () => {
  const deep = (): RoutingModel =>
    model(
      [
        folder("l1"),
        folder("l2", "l1"),
        folder("l3", "l2"),
        folder("l4", "l3"),
        folder("l5", "l4"),
        folder("side", "l2"),
        folder("other"),
      ],
      [item("deep", "l5"), item("sibling", "l5"), item("near", "l3"), item("top", "l1")],
      [productCell("deep")],
    );

  it("shows a deep product with its own cell under each of its five ancestors, once, closed, and no sibling of theirs", () => {
    const labels = outline(visibleRoutingRows(deep(), none)).map((line) =>
      line.replace(/ <.*>$/, ""),
    );
    expect(labels).toEqual([
      "[All]",
      "  C:l1",
      "    C:l2",
      "      C:l3",
      "        C:l4",
      "          C:l5",
      "            P:deep",
      "  C:other",
    ]);
  });

  it("shows a category with its own cell under a closed parent, with the parent as a row", () => {
    const venue = model(
      [folder("drinks"), folder("cocktails", "drinks"), folder("wine", "drinks")],
      [item("mojito", "cocktails"), item("cola", "drinks")],
      [categoryCell("cocktails", bar, "terrace")],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "  C:drinks",
      "    C:cocktails <drinks>",
    ]);
  });

  it("opening an ancestor of an own-routing row shows all its children", () => {
    expect(outline(visibleRoutingRows(deep(), new Set(["l2"])))).toEqual([
      "[All]",
      "  C:l1",
      "    C:l2 <l1>",
      "      C:l3 <l1/l2>",
      "        C:l4 <l1/l2/l3>",
      "          C:l5 <l1/l2/l3/l4>",
      "            P:deep <l1/l2/l3/l4/l5>",
      "      C:side <l1/l2>",
      "  C:other",
    ]);
  });
});

describe("visibleRoutingRows", () => {
  it("pins independently overlapping summaries", () => {
    const chain = model(
      [folder("root"), folder("a", "root"), folder("b", "a"), folder("c", "b")],
      [item("p-root", "root"), item("p-a", "a"), item("p-b", "b"), item("p-c", "c")],
      [categoryCell("b"), productCell("p-c")],
    );
    expect(outline(visibleRoutingRows(chain, none))).toEqual([
      "[All]",
      "  C:root",
      "    C:a <root>",
      "      C:b <root/a>",
      "        C:c <root/a/b>",
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
      "  C:food",
      "    P:bread <food>",
      "    P:soup <food>",
    ]);
  });

  it("a cell for a product the model does not list adds no row; each product shows once", () => {
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
      "  C:drinks",
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
      "  C:root",
      "    C:x <root>",
    ]);
  });

  it("an explicitly expanded exceptional category under a collapsed ancestor shows its children", () => {
    const venue = model(
      [folder("root"), folder("x", "root"), folder("y", "x")],
      [item("p-x", "x"), item("p-y", "y")],
      [categoryCell("x")],
    );
    expect(outline(visibleRoutingRows(venue, new Set(["x"])))).toEqual([
      "[All]",
      "  C:root",
      "    C:x <root>",
      "      C:y <root/x>",
      "      P:p-x <root/x>",
    ]);
    expect(outline(visibleRoutingRows(venue, new Set(["y"])))).toEqual([
      "[All]",
      "  C:root",
      "    C:x <root>",
    ]);
  });

  it("expand one, expand all, collapse all change the rows exactly", () => {
    const venue = model([folder("root"), folder("a", "root")], [item("p", "root"), item("q", "a")]);
    expect(outline(visibleRoutingRows(venue, none))).toEqual(["[All]", "  C:root"]);
    const one = expandCategory(none, "root");
    expect(outline(visibleRoutingRows(venue, one))).toEqual([
      "[All]",
      "  C:root",
      "    C:a <root>",
      "    P:p <root>",
    ]);
    expect(outline(visibleRoutingRows(venue, collapseCategory(venue, one, "root")))).toEqual([
      "[All]",
      "  C:root",
    ]);
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:root",
      "    C:a <root>",
      "      P:q <root/a>",
      "    P:p <root>",
    ]);
    expect(outline(visibleRoutingRows(venue, new Set()))).toEqual(["[All]", "  C:root"]);
  });

  describe("collapsing a category closes every arrow inside it", () => {
    // The owner's example: Santet Deli Co holds AGAVE, whose products inherit except two with
    // routes of their own; MEZCAL sits two levels down, under CLANDESTINA.
    const deli = () =>
      model(
        [
          folder("santet", null, "Santet Deli Co"),
          folder("agave", "santet", "AGAVE"),
          folder("clandestina", "agave", "CLANDESTINA"),
          folder("mezcal", "clandestina", "MEZCAL"),
          folder("food", null, "Food"),
        ],
        [
          item("clandestina-p", "agave", "Clandestina"),
          item("corralejo", "agave", "Corralejo Blue"),
          item("blanco", "agave", "Tequila Blanco"),
          item("shot", "clandestina", "Shot"),
          item("smoke", "mezcal", "Smoke"),
          item("burger", "food", "Burger"),
        ],
        [productCell("clandestina-p"), productCell("corralejo")],
      );

    it("hides the inherited rows at every depth and keeps own-route rows with their path", () => {
      const venue = deli();
      let open = expandCategory(none, "santet");
      open = expandCategory(open, "agave");
      open = expandCategory(open, "clandestina");
      open = expandCategory(open, "mezcal");
      const closed = collapseCategory(venue, open, "santet");
      expect([...closed]).toEqual([]);
      expect(outline(visibleRoutingRows(venue, closed))).toEqual([
        "[All]",
        "  C:Food",
        "  C:Santet Deli Co",
        "    C:AGAVE <Santet Deli Co>",
        "      P:Clandestina <Santet Deli Co/AGAVE>",
        "      P:Corralejo Blue <Santet Deli Co/AGAVE>",
      ]);
    });

    it("re-opening a child under the closed parent lists all its products, its own children closed", () => {
      const venue = deli();
      const open = collapseCategory(
        venue,
        new Set(["santet", "agave", "clandestina", "mezcal"]),
        "santet",
      );
      expect(outline(visibleRoutingRows(venue, expandCategory(open, "agave")))).toEqual([
        "[All]",
        "  C:Food",
        "  C:Santet Deli Co",
        "    C:AGAVE <Santet Deli Co>",
        "      C:CLANDESTINA <Santet Deli Co/AGAVE>",
        "      P:Clandestina <Santet Deli Co/AGAVE>",
        "      P:Corralejo Blue <Santet Deli Co/AGAVE>",
        "      P:Tequila Blanco <Santet Deli Co/AGAVE>",
      ]);
    });

    it("leaves the parent, the siblings and other trees open", () => {
      const venue = deli();
      const open = new Set(["santet", "agave", "clandestina", "mezcal", "food"]);
      expect([...collapseCategory(venue, open, "clandestina")].sort()).toEqual([
        "agave",
        "food",
        "santet",
      ]);
    });

    it("follows a parent cycle as the tree draws it, without looping", () => {
      const venue = model([folder("a", "b"), folder("b", "a"), folder("c", "b")], []);
      expect([...collapseCategory(venue, new Set(["a", "b", "c"]), "b")]).toEqual(["a"]);
    });

    it("a refresh that moves an open category under a closed one closes it and the arrows inside", () => {
      const before = model(
        [folder("p"), folder("q"), folder("c", "q"), folder("d", "c")],
        [item("x", "c"), item("y", "d")],
      );
      const after = model(
        [folder("p"), folder("q"), folder("c", "p"), folder("d", "c")],
        [item("x", "c"), item("y", "d")],
      );
      const kept = pruneExpanded(before, after, new Set(["q", "c", "d"]));
      expect([...kept]).toEqual(["q"]);
      expect(outline(visibleRoutingRows(after, kept))).toEqual(["[All]", "  C:p", "  C:q"]);
    });

    it("a refresh that moves an open category under an open one keeps it open", () => {
      const before = model([folder("p"), folder("q"), folder("c", "q")], [item("x", "c")]);
      const after = model([folder("p"), folder("q"), folder("c", "p")], [item("x", "c")]);
      expect([...pruneExpanded(before, after, new Set(["p", "c"]))].sort()).toEqual(["c", "p"]);
    });

    it("a refresh that moves an open category to the top level keeps it open", () => {
      const before = model(
        [folder("q"), folder("c", "q"), folder("d", "q"), folder("e", "q")],
        [item("x", "c")],
      );
      const after = model(
        [folder("q"), folder("c"), folder("d", "d"), folder("e", "gone")],
        [item("x", "c")],
      );
      expect([...pruneExpanded(before, after, new Set(["c", "d", "e"]))].sort()).toEqual([
        "c",
        "d",
        "e",
      ]);
    });

    it("a refresh keeps a category opened under a closed parent open while its parent stays", () => {
      const venue = model([folder("p"), folder("c", "p")], [item("x", "c")]);
      expect([...pruneExpanded(venue, venue, new Set(["c"]))]).toEqual(["c"]);
    });
  });

  it("refresh keeps expansion, prunes removed ids, and starts new categories collapsed", () => {
    const before = model([folder("root"), folder("gone", "root")], [item("p", "root")]);
    const expanded = expandAll(before);
    const after = model(
      [folder("root"), folder("fresh", "root")],
      [item("p", "root"), item("q", "fresh")],
    );
    const kept = pruneExpanded(before, after, expanded);
    expect([...kept]).toEqual(["root"]);
    expect(outline(visibleRoutingRows(after, kept))).toEqual([
      "[All]",
      "  C:root",
      "    C:fresh <root>",
      "    P:p <root>",
    ]);
  });

  it("the No category row lists every active uncategorised product at the bottom, carries the no_category address, and a saved No category cell keeps it with no products", () => {
    const venue = model(
      [folder("food")],
      [item("bread", "food"), item("menu-card", null), item("water", null)],
    );
    const entries = visibleRoutingRows(venue, none);
    expect(outline(entries)).toEqual([
      "[All]",
      "  C:food",
      "[No category]",
      "  P:menu-card",
      "  P:water",
    ]);
    const noCategory: GridRow = {
      row: { kind: "no_category" },
      name: "",
      path: [],
      depth: 0,
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
    // A stored No category cell keeps the row, with no products under it.
    const storedOnly = model(
      [folder("food")],
      [item("bread", "food")],
      [{ row: { kind: "no_category" }, zoneId: "terrace", target: bar }],
    );
    expect(outline(visibleRoutingRows(storedOnly, none))).toEqual([
      "[All]",
      "  C:food",
      "[No category]",
    ]);
    expect(visibleRoutingRows(storedOnly, none).at(-1)).toEqual(noCategory);
    expect(outline(visibleRoutingRows(storedOnly, expandAll(storedOnly)))).toEqual([
      "[All]",
      "  C:food",
      "    P:bread <food>",
      "[No category]",
    ]);
  });

  it("a product cell five category levels down stays visible under a collapsed root, once, with its five ancestors as rows", () => {
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
      "  C:l1",
      "    C:l2 <l1>",
      "      C:l3 <l1/l2>",
      "        C:l4 <l1/l2/l3>",
      "          C:l5 <l1/l2/l3/l4>",
      "            P:deep <l1/l2/l3/l4/l5>",
    ]);
  });

  it("a disabled product's cell is not shown, and returns when the model lists the product again", () => {
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
      "  C:root",
      "  C:self",
      "  C:a",
    ]);
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:root",
      "  C:self",
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
      "  C:b",
      "    C:c <b>",
      "      P:p <b/c>",
    ]);
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:b",
      "    C:a <b>",
      "    C:c <b>",
      "      P:p <b/c>",
    ]);
  });

  it("treats a category whose parent the model does not list as a root", () => {
    const venue = model([folder("orphan", "missing")], [item("p", "orphan")]);
    expect(outline(visibleRoutingRows(venue, none))).toEqual(["[All]", "  C:orphan"]);
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

describe("visibleRoutingRows name order", () => {
  // Given in the server's binary order, as `snapshot` and `routingModel` send them.
  const binary = ["Mesa 10", "Mesa 2", "Zumos", "bebidas", "Árboles"];
  const labelOrder = ["Árboles", "bebidas", "Mesa 2", "Mesa 10", "Zumos"];

  it("sorts root categories by label, not by binary order", () => {
    const venue = model(
      binary.map((name) => folder(name)),
      [],
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      ...labelOrder.map((name) => `  C:${name}`),
    ]);
  });

  it("sorts an expanded parent's child categories by label", () => {
    const venue = model(
      [folder("bar", null, "Bar"), ...binary.map((name) => folder(name, "bar"))],
      [],
    );
    expect(outline(visibleRoutingRows(venue, new Set(["bar"])))).toEqual([
      "[All]",
      "  C:Bar",
      ...labelOrder.map((name) => `    C:${name} <Bar>`),
    ]);
  });

  it("sorts an expanded category's products by label", () => {
    const venue = model(
      [folder("bar", null, "Bar")],
      binary.map((name) => item(name, "bar")),
    );
    expect(outline(visibleRoutingRows(venue, new Set(["bar"])))).toEqual([
      "[All]",
      "  C:Bar",
      ...labelOrder.map((name) => `    P:${name} <Bar>`),
    ]);
  });

  it("sorts the products under No category by label", () => {
    const venue = model(
      [],
      binary.map((name) => item(name, null)),
    );
    expect(outline(visibleRoutingRows(venue, none))).toEqual([
      "[All]",
      "[No category]",
      ...labelOrder.map((name) => `  P:${name}`),
    ]);
  });

  it("keeps the incoming order for equal names", () => {
    const venue = model(
      [folder("bar", null, "Bar")],
      [
        item("p2", "bar", "Caña"),
        item("p1", "bar", "Caña"),
        item("u2", null, "Agua"),
        item("u1", null, "Agua"),
      ],
    );
    const productIds = visibleRoutingRows(venue, new Set(["bar"])).flatMap((entry) =>
      entry.row.kind === "product" ? [entry.row.productId] : [],
    );
    expect(productIds).toEqual(["p2", "p1", "u2", "u1"]);
  });

  it("keeps a child category under its parent, after it and before the parent's products", () => {
    const venue = model(
      [
        folder("zumos", null, "Zumos"),
        folder("agua", null, "Agua"),
        folder("mesa", "zumos", "Mesa"),
      ],
      [
        item("p-b", "zumos", "Batido"),
        item("p-a", "zumos", "Arándano"),
        item("p-m", "mesa", "Menta"),
      ],
    );
    expect(outline(visibleRoutingRows(venue, expandAll(venue)))).toEqual([
      "[All]",
      "  C:Agua",
      "  C:Zumos",
      "    C:Mesa <Zumos>",
      "      P:Menta <Zumos/Mesa>",
      "    P:Arándano <Zumos>",
      "    P:Batido <Zumos>",
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
      model(
        nested,
        [item("sour", "sours")],
        [{ row: { kind: "no_category" }, zoneId: "terrace", target: bar }],
      ),
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
    expect(rowInModel(models[5]!, { kind: "no_category" })).toBe(true);
    expect(rowInModel(models[4]!, { kind: "no_category" })).toBe(false);
  });
});

describe("cellPeriodLines", () => {
  const period = (id: string, departmentId = "dining", name = id): RoutingPeriod => ({
    id,
    departmentId,
    departmentName: departmentId,
    name,
    colour: "red",
    productIds: [],
  });
  // The model's order (decision 15), which is neither the names' nor the ids' order.
  const PERIODS = [
    period("p-breakfast", "dining", "Breakfast"),
    period("p-lunch", "dining", "Lunch"),
    period("p-afternoon", "dining", "Afternoon"),
    period("p-dinner", "dining", "Dinner"),
    period("p-supper", "dining", "Supper"),
    period("p-aperitivo", "bar", "Aperitivo"),
  ];
  const downstairs: RouteTarget = { kind: "station", stationId: "downstairs" };
  const names: Record<string, string> = {
    kitchen: "Kitchen",
    bar: "Bar",
    downstairs: "Downstairs bar",
  };
  const targetText = (target: RouteTarget) =>
    target.kind === "station" ? names[target.stationId]! : "No preparation";
  const withLines = (
    cell: RoutingCell,
    lines: [string, RouteTarget][],
  ): RoutingModel["cells"][number] => ({
    ...cell,
    periods: lines.map(([periodId, target]) => ({ periodId, target })),
  });
  const routing = (cells: RoutingModel["cells"][number][]): RoutingModel => ({
    ...model([folder("drinks")], [item("mojito", "drinks")]),
    cells,
    periods: PERIODS,
  });
  const drinks: RoutingRow = { kind: "category", categoryId: "drinks" };
  const textsAt = (cells: RoutingModel["cells"][number][], row: RoutingRow = drinks) =>
    cellPeriodLines(routing(cells), targetText)(row, null).lines.map((line) => line.text);

  it("joins one or two periods' names with a comma, in the model's period order", () => {
    expect(textsAt([withLines(categoryCell("drinks"), [["p-lunch", downstairs]])])).toEqual([
      "Lunch: Downstairs bar",
    ]);
    expect(
      textsAt([
        withLines(categoryCell("drinks"), [
          ["p-afternoon", downstairs],
          ["p-lunch", downstairs],
        ]),
      ]),
    ).toEqual(["Lunch, Afternoon: Downstairs bar"]);
  });

  it("writes three or more periods running on in their department's order as first–last", () => {
    expect(
      textsAt([
        withLines(categoryCell("drinks"), [
          ["p-dinner", downstairs],
          ["p-breakfast", downstairs],
          ["p-afternoon", downstairs],
          ["p-lunch", downstairs],
        ]),
      ]),
    ).toEqual(["Breakfast–Dinner: Downstairs bar"]);
  });

  it("writes three or more periods with a gap, or from two departments, as the first and a count", () => {
    expect(
      textsAt([
        withLines(categoryCell("drinks"), [
          ["p-breakfast", downstairs],
          ["p-lunch", downstairs],
          ["p-dinner", downstairs],
          ["p-supper", downstairs],
        ]),
      ]),
    ).toEqual(["Breakfast +3: Downstairs bar"]);
    expect(
      textsAt([
        withLines(categoryCell("drinks"), [
          ["p-dinner", downstairs],
          ["p-supper", downstairs],
          ["p-aperitivo", downstairs],
        ]),
      ]),
    ).toEqual(["Dinner +2: Downstairs bar"]);
  });

  it("gives each target its own line, ordered by its first period, and its periods and target", () => {
    const lines = cellPeriodLines(
      routing([
        withLines(categoryCell("drinks"), [
          ["p-dinner", noPreparation],
          ["p-lunch", downstairs],
          ["p-breakfast", noPreparation],
        ]),
      ]),
      targetText,
    )(drinks, null);
    expect(lines).toEqual({
      inherited: false,
      lines: [
        {
          periodIds: ["p-breakfast", "p-dinner"],
          target: noPreparation,
          text: "Breakfast, Dinner: No preparation",
        },
        { periodIds: ["p-lunch"], target: downstairs, text: "Lunch: Downstairs bar" },
      ],
    });
  });

  it("gives an inherited zone cell the Every zone cell's lines, marked as inherited", () => {
    const every = withLines(categoryCell("drinks"), [["p-lunch", downstairs]]);
    const lines = cellPeriodLines(routing([every]), targetText);
    expect(lines(drinks, "terrace")).toEqual({
      inherited: true,
      lines: [{ periodIds: ["p-lunch"], target: downstairs, text: "Lunch: Downstairs bar" }],
    });
    expect(lines({ kind: "product", productId: "mojito" }, null)).toEqual({
      inherited: true,
      lines: [{ periodIds: ["p-lunch"], target: downstairs, text: "Lunch: Downstairs bar" }],
    });
    expect(lines(drinks, null).inherited).toBe(false);
  });

  it("gives a cell with its own choice and no lines none, even under a parent with lines", () => {
    const lines = cellPeriodLines(
      routing([
        withLines(categoryCell("drinks"), [["p-lunch", downstairs]]),
        categoryCell("drinks", kitchen, "terrace"),
      ]),
      targetText,
    );
    expect(lines(drinks, "terrace")).toEqual({ inherited: false, lines: [] });
    expect(lines({ kind: "all" }, "terrace")).toEqual({ inherited: true, lines: [] });
  });

  it("gives an inherited zone cell only its department's lines from an Every zone cell", () => {
    const every = withLines(categoryCell("drinks"), [
      ["p-lunch", downstairs],
      ["p-aperitivo", kitchen],
    ]);
    const lines = cellPeriodLines(
      {
        ...routing([every]),
        zones: [
          { id: "terrace", name: "Terrace", departmentId: "dining" },
          { id: "counter", name: "Counter", departmentId: "bar" },
          { id: "garden", name: "Garden", departmentId: null },
        ],
      },
      targetText,
    );
    const texts = (row: RoutingRow, zoneId: string | null) =>
      lines(row, zoneId).lines.map((line) => line.text);
    expect(texts(drinks, null)).toEqual(["Lunch: Downstairs bar", "Aperitivo: Kitchen"]);
    expect(lines(drinks, "terrace")).toEqual({
      inherited: true,
      lines: [{ periodIds: ["p-lunch"], target: downstairs, text: "Lunch: Downstairs bar" }],
    });
    expect(texts({ kind: "product", productId: "mojito" }, "terrace")).toEqual([
      "Lunch: Downstairs bar",
    ]);
    expect(texts(drinks, "counter")).toEqual(["Aperitivo: Kitchen"]);
    expect(lines(drinks, "garden")).toEqual({ inherited: true, lines: [] });
  });

  it("names each period's department in brackets only where its name repeats", () => {
    const named = (id: string, departmentName: string, name: string): RoutingPeriod => ({
      ...period(id, departmentName.toLowerCase(), name),
      departmentName,
    });
    const lines = cellPeriodLines(
      {
        ...routing([
          withLines(categoryCell("drinks"), [
            ["dining-lunch", downstairs],
            ["bar-lunch", downstairs],
            ["dining-dinner", kitchen],
            ["bar-aperitivo", kitchen],
          ]),
        ]),
        periods: [
          named("dining-lunch", "Dining", "Lunch"),
          named("dining-dinner", "Dining", "Dinner"),
          named("bar-aperitivo", "Bar", "Aperitivo"),
          named("bar-lunch", "Bar", "Lunch"),
        ],
      },
      targetText,
    );
    expect(lines(drinks, null).lines.map((line) => line.text)).toEqual([
      "Lunch (Dining), Lunch (Bar): Downstairs bar",
      "Dinner, Aperitivo: Kitchen",
    ]);
  });

  it("names a period's department wherever its name repeats among the cell's lines", () => {
    const named = (id: string, departmentName: string, name: string): RoutingPeriod => ({
      ...period(id, departmentName.toLowerCase(), name),
      departmentName,
    });
    const lines = cellPeriodLines(
      {
        ...routing([
          withLines(categoryCell("drinks"), [
            ["dining-lunch", downstairs],
            ["bar-lunch", kitchen],
            ["dining-dinner", kitchen],
          ]),
        ]),
        periods: [
          named("dining-lunch", "Dining", "Lunch"),
          named("dining-dinner", "Dining", "Dinner"),
          named("bar-lunch", "Bar", "Lunch"),
        ],
      },
      targetText,
    );
    expect(lines(drinks, null).lines.map((line) => line.text)).toEqual([
      "Lunch (Dining): Downstairs bar",
      "Dinner, Lunch (Bar): Kitchen",
    ]);
  });

  it("draws a waiting choice's own lines, and for a waiting Clear the lines it would inherit", () => {
    const parent = withLines(categoryCell("drinks"), [["p-lunch", downstairs]]);
    const mojito = withLines(
      { row: { kind: "product", productId: "mojito" }, zoneId: null, target: kitchen },
      [["p-dinner", kitchen]],
    );
    const of = cellPeriodLines(routing([parent, mojito]), targetText);
    const row: RoutingRow = { kind: "product", productId: "mojito" };
    expect(of(row, null)).toMatchObject({ inherited: false, lines: [{ text: "Dinner: Kitchen" }] });
    expect(
      of(row, null, { target: kitchen, periods: [{ periodId: "p-supper", target: downstairs }] }),
    ).toEqual({
      inherited: false,
      lines: [{ periodIds: ["p-supper"], target: downstairs, text: "Supper: Downstairs bar" }],
    });
    expect(of(row, null, { target: kitchen })).toEqual({ inherited: false, lines: [] });
    expect(of(row, null, { target: null })).toEqual({
      inherited: true,
      lines: [{ periodIds: ["p-lunch"], target: downstairs, text: "Lunch: Downstairs bar" }],
    });
  });

  describe("a stored line whose period's menus no longer offer the row", () => {
    const startLocale = currentLocale();
    beforeEach(() => setLocale("en"));
    afterEach(() => setLocale(startLocale));
    const flagged = (
      cell: RoutingCell,
      lines: [string, RouteTarget, boolean][],
    ): RoutingModel["cells"][number] => ({
      ...cell,
      periods: lines.map(([periodId, target, notOffered]) =>
        notOffered ? { periodId, target, notOffered: true } : { periodId, target },
      ),
    });

    it("marks the line, naming its flagged periods in its order as the line does", () => {
      const lines = cellPeriodLines(
        routing([
          flagged(categoryCell("drinks"), [
            ["p-dinner", downstairs, true],
            ["p-afternoon", downstairs, false],
            ["p-lunch", downstairs, true],
            ["p-supper", kitchen, false],
          ]),
        ]),
        targetText,
      )(drinks, null);
      expect(lines).toEqual({
        inherited: false,
        lines: [
          {
            periodIds: ["p-lunch", "p-afternoon", "p-dinner"],
            target: downstairs,
            text: "Lunch–Dinner: Downstairs bar",
            flagText: "Not on Lunch, Dinner menus",
          },
          { periodIds: ["p-supper"], target: kitchen, text: "Supper: Kitchen" },
        ],
      });
    });

    it("names a flagged period's department where its name repeats among the cell's lines", () => {
      const named = (id: string, departmentName: string, name: string): RoutingPeriod => ({
        ...period(id, departmentName.toLowerCase(), name),
        departmentName,
      });
      const lines = cellPeriodLines(
        {
          ...routing([
            flagged(categoryCell("drinks"), [
              ["dining-lunch", downstairs, false],
              ["bar-lunch", kitchen, true],
            ]),
          ]),
          periods: [named("dining-lunch", "Dining", "Lunch"), named("bar-lunch", "Bar", "Lunch")],
        },
        targetText,
      )(drinks, null);
      expect(lines.lines.map((line) => line.flagText)).toEqual([
        undefined,
        "Not on Lunch (Bar) menus",
      ]);
    });

    it("says the mark in Spanish", () => {
      setLocale("es");
      const lines = cellPeriodLines(
        routing([
          flagged(categoryCell("drinks"), [
            ["p-lunch", downstairs, true],
            ["p-dinner", downstairs, true],
          ]),
        ]),
        targetText,
      )(drinks, null);
      expect(lines.lines[0]!.flagText).toBe("No está en los menús de Lunch, Dinner");
    });

    it("gives a line inherited from that cell no mark", () => {
      const of = cellPeriodLines(
        routing([flagged(categoryCell("drinks"), [["p-lunch", downstairs, true]])]),
        targetText,
      );
      expect(of(drinks, null).lines[0]!.flagText).toBe("Not on Lunch menus");
      for (const inherited of [
        of(drinks, "terrace"),
        of({ kind: "product", productId: "mojito" }, null),
      ]) {
        expect(inherited).toEqual({
          inherited: true,
          lines: [{ periodIds: ["p-lunch"], target: downstairs, text: "Lunch: Downstairs bar" }],
        });
      }
    });
  });

  it("leaves out a line whose period the model does not list", () => {
    expect(
      textsAt([
        withLines(categoryCell("drinks"), [
          ["p-gone", downstairs],
          ["p-lunch", downstairs],
        ]),
      ]),
    ).toEqual(["Lunch: Downstairs bar"]);
  });
});

describe("blankZoneCell", () => {
  const at = (zoneId: string | null, target: RouteTarget, row: RoutingRow): RoutingCell => ({
    row,
    zoneId,
    target,
  });
  const drinks: RoutingRow = { kind: "category", categoryId: "drinks" };
  const cocktails: RoutingRow = { kind: "category", categoryId: "cocktails" };
  const food: RoutingRow = { kind: "category", categoryId: "food" };
  const all: RoutingRow = { kind: "all" };
  const product = (productId: string): RoutingRow => ({ kind: "product", productId });
  const terraceBar: RouteTarget = { kind: "station", stationId: "tbar" };
  const old: RouteTarget = { kind: "station", stationId: "old" };

  // The routing-grid.test.ts fixture: Drinks to the Bar everywhere, Cocktails to the Terrace bar
  // on the Terrace, Burger set to Kitchen, Food on the Inside to the disabled Old kitchen, and
  // nothing on the Terrace prepared unless a row says otherwise.
  const grid = (): RoutingModel => ({
    ...model(
      [folder("drinks"), folder("cocktails", "drinks"), folder("food")],
      [
        item("mojito", "cocktails"),
        item("cola", "drinks"),
        item("burger", "food"),
        item("bread", null),
      ],
      [
        at(null, bar, drinks),
        at("terrace", terraceBar, cocktails),
        at(null, kitchen, product("burger")),
        at("inside", old, food),
        at("terrace", noPreparation, all),
      ],
    ),
    zones: [
      { id: "terrace", name: "Terrace", departmentId: null },
      { id: "inside", name: "Inside", departmentId: null },
    ],
  });

  it("is blank where the zone and the row's Every zone are decided by the same cell", () => {
    expect(blankZoneCell(grid())(product("cola"), "terrace")).toBe(true);
  });

  it("is not blank where a parent's zone cell differs from the row's Every zone", () => {
    expect(blankZoneCell(grid())(product("mojito"), "terrace")).toBe(false);
  });

  it("is blank where the row's own Every zone decides the zone", () => {
    expect(blankZoneCell(grid())(product("burger"), "terrace")).toBe(true);
  });

  it("is not blank where All categories' zone cell differs from the default station", () => {
    expect(blankZoneCell(grid())(product("bread"), "terrace")).toBe(false);
  });

  it("is blank on an unset All categories zone cell, which inherits the default", () => {
    expect(blankZoneCell(grid())(all, "inside")).toBe(true);
  });

  it("judges what the coordinate inherits, setting aside its own cell", () => {
    // Food × Inside holds Old kitchen; without it, both sides fall to the default Kitchen.
    expect(blankZoneCell(grid())(food, "inside")).toBe(true);
  });

  it("a row's own Every zone beats a parent's zone cell (the CLANDESTINA case)", () => {
    const venue: RoutingModel = {
      ...model(
        [folder("agave"), folder("clandestina", "agave")],
        [],
        [
          at("front", bar, { kind: "category", categoryId: "agave" }),
          at(null, kitchen, { kind: "category", categoryId: "clandestina" }),
        ],
      ),
      zones: [{ id: "front", name: "Front Bar", departmentId: null }],
    };
    const blank = blankZoneCell(venue);
    expect(blank({ kind: "category", categoryId: "clandestina" }, "front")).toBe(true);
    expect(blank({ kind: "category", categoryId: "agave" }, "front")).toBe(true);
  });

  describe("period lines", () => {
    const period = (id: string, departmentId: string): RoutingPeriod => ({
      id,
      departmentId,
      departmentName: departmentId,
      name: id,
      colour: "red",
      productIds: [],
    });
    const downstairs: RouteTarget = { kind: "station", stationId: "downstairs" };
    const lined = (
      cell: RoutingCell,
      lines: [string, RouteTarget][],
    ): RoutingModel["cells"][number] => ({
      ...cell,
      periods: lines.map(([periodId, target]) => ({ periodId, target })),
    });
    // Drinks × Terrace and Drinks × Every zone both send to the Bar, so only their lines can
    // make Cola × Terrace differ.
    const venue = (
      zoneLines: [string, RouteTarget][],
      everyLines: [string, RouteTarget][],
    ): RoutingModel => ({
      ...model(
        [folder("drinks")],
        [item("cola", "drinks")],
        [lined(at("terrace", bar, drinks), zoneLines), lined(at(null, bar, drinks), everyLines)],
      ),
      periods: [period("lunch", "dining"), period("aperitivo", "bar")],
    });
    const blank = (model: RoutingModel) => blankZoneCell(model)(product("cola"), "terrace");

    it("an Every-zone line for another department's period leaves the zone blank", () => {
      expect(blank(venue([], [["aperitivo", downstairs]]))).toBe(true);
    });

    it("a line the model does not list leaves the zone blank", () => {
      expect(blank(venue([], [["gone", downstairs]]))).toBe(true);
    });

    it("the same lines in the zone's department leave the zone blank", () => {
      expect(blank(venue([["lunch", downstairs]], [["lunch", downstairs]]))).toBe(true);
    });

    it("the same station with a different line in the zone's department is not blank", () => {
      expect(blank(venue([["lunch", downstairs]], [["lunch", kitchen]]))).toBe(false);
      expect(blank(venue([], [["lunch", kitchen]]))).toBe(false);
      expect(blank(venue([["lunch", kitchen]], []))).toBe(false);
    });

    it("a zone the model does not list inherits the row's Every zone, so it is blank", () => {
      expect(blankZoneCell(venue([], [["lunch", kitchen]]))(product("cola"), "nowhere")).toBe(true);
    });

    it("the default station has no lines, so a zone cell's line on the same station differs from it", () => {
      const lunchOnAll: RoutingModel = {
        ...model(
          [folder("drinks")],
          [item("cola", "drinks")],
          [lined(at("terrace", kitchen, all), [["lunch", downstairs]])],
        ),
        periods: [period("lunch", "dining")],
      };
      expect(blankZoneCell(lunchOnAll)(product("cola"), "terrace")).toBe(false);
    });
  });
});

describe("matchRanges", () => {
  const marked = (name: string, query: string) =>
    matchRanges(name, query).map(({ start, end }) => name.slice(start, end));

  it("marks nothing for a blank query or one with no words", () => {
    expect(matchRanges("Café con leche", "  ")).toEqual([]);
    expect(matchRanges("Café con leche", "!!")).toEqual([]);
  });

  it("marks the word being typed anywhere, accent- and case-blind, in the original text", () => {
    expect(matchRanges("Café con leche", "cafe")).toEqual([{ start: 0, end: 4 }]);
    expect(marked("Decafeinado", "CAFÉ")).toEqual(["cafe"]);
    expect(marked("Clandestina Reposado", "clan")).toEqual(["Clan"]);
  });

  it("marks a finished last word only where it is whole", () => {
    expect(marked("Café con leche", "café ")).toEqual(["Café"]);
    expect(matchRanges("Decafeinado", "café ")).toEqual([]);
    expect(marked("Rojo y rojos", "rojo ")).toEqual(["Rojo"]);
  });

  it("marks every word but the last only where it is whole, so a part of a word marks nothing", () => {
    expect(matchRanges("Clandestina Reposado", "clan d")).toEqual([]);
    expect(marked("Clandestina Reposado", "reposado clan")).toEqual(["Clan", "Reposado"]);
  });

  it("counts a digit as part of a word", () => {
    expect(matchRanges("Mesa 12", "2 ")).toEqual([]);
    expect(marked("Mesa 12", "2")).toEqual(["2"]);
  });

  it("marks every occurrence, merging ranges that overlap or touch", () => {
    expect(marked("Rojo y rojo", "rojo ")).toEqual(["Rojo", "rojo"]);
    expect(matchRanges("aaa", "aa")).toEqual([{ start: 0, end: 3 }]);
    expect(matchRanges("abab", "ab")).toEqual([{ start: 0, end: 4 }]);
  });

  it("maps folded positions back through decomposed accents, final sigma and surrogate pairs", () => {
    expect(marked("Café solo", "cafe")).toEqual(["Café"]);
    expect(marked("ΟΔΟΣ", "οδος")).toEqual(["ΟΔΟΣ"]);
    expect(marked("🍔 Burger", "burger")).toEqual(["Burger"]);
    expect(marked("\u0301abc", "abc")).toEqual(["abc"]);
  });

  it("marks something exactly when textSearch matches the folded name", () => {
    const names = [
      "Clandestina Reposado",
      "CLANDESTINA",
      "Café con leche",
      "Decafeinado",
      "Café solo",
      "Mesa 12",
      "ΟΔΟΣ",
      "🍔 Burger",
      "Rojo y rojo",
    ];
    const queries = [
      "clan",
      "clan ",
      "clan d",
      "reposado clan",
      "clandestina repo",
      "café",
      "café ",
      "cafe solo",
      "12",
      "2 ",
      "οδοσ",
      "rojo rojo",
      "!!",
      "zzz",
    ];
    for (const name of names) {
      for (const query of queries) {
        const matches = textSearch(query)?.rank(foldForSearch(name)) !== undefined;
        expect([name, query, matchRanges(name, query).length > 0]).toEqual([name, query, matches]);
      }
    }
  });
});

describe("searchRows", () => {
  const deli = (): RoutingModel =>
    model(
      [
        folder("santet", null, "Santet Deli Co"),
        folder("agave", "santet", "AGAVE"),
        folder("clandestina", "agave", "CLANDESTINA"),
        folder("mezcal", "agave", "MEZCAL"),
        folder("food", null, "Food"),
      ],
      [
        item("reposado", "agave", "Clandestina Reposado"),
        item("blanco", "agave", "Tequila Blanco"),
        item("shot", "clandestina", "Shot"),
        item("burger", "food", "Burger"),
        item("coffee", null, "Café con leche"),
        item("water", null, "Water"),
      ],
    );
  /** One line per row: indentation is depth, then the label, then match or parent. */
  const lines = (rows: readonly SearchRow[]) =>
    outline(rows.map((row) => row.entry)).map(
      (line, i) => `${line}${rows[i]!.match ? " match" : ""}${rows[i]!.parent ? " parent" : ""}`,
    );

  it("is undefined for a blank query: no search", () => {
    expect(searchRows(deli(), "")).toBeUndefined();
    expect(searchRows(deli(), "   ")).toBeUndefined();
  });

  it("lists each match under every ancestor, in tree order; ancestors open, matches closed", () => {
    const found = searchRows(deli(), "clan")!;
    expect(lines(found.rows)).toEqual([
      "[All] parent",
      "  C:Santet Deli Co parent",
      "    C:AGAVE <Santet Deli Co> parent",
      "      C:CLANDESTINA <Santet Deli Co/AGAVE> match",
      "      P:Clandestina Reposado <Santet Deli Co/AGAVE> match",
    ]);
    expect(found.count).toBe(2);
    expect([...found.open].sort()).toEqual(["agave", "santet"]);
    expect(found.rows.map((row) => row.ranges)).toEqual([
      [],
      [],
      [],
      [{ start: 0, end: 4 }],
      [{ start: 0, end: 4 }],
    ]);
  });

  it("an opened match lists all its children; an open ancestor only the way to a match", () => {
    const opened = new Set([...searchRows(deli(), "clan")!.open, "clandestina"]);
    expect(lines(searchRows(deli(), "clan", opened)!.rows)).toEqual([
      "[All] parent",
      "  C:Santet Deli Co parent",
      "    C:AGAVE <Santet Deli Co> parent",
      "      C:CLANDESTINA <Santet Deli Co/AGAVE> match",
      "        P:Shot <Santet Deli Co/AGAVE/CLANDESTINA>",
      "      P:Clandestina Reposado <Santet Deli Co/AGAVE> match",
    ]);
  });

  it("a closed ancestor hides the matches under it, and the count still includes them", () => {
    const found = searchRows(deli(), "clan", new Set())!;
    expect(lines(found.rows)).toEqual(["[All] parent", "  C:Santet Deli Co parent"]);
    expect(found.count).toBe(2);
    expect(found.open.size).toBe(0);
  });

  it("every word must match", () => {
    const found = searchRows(deli(), "clandestina repo")!;
    expect(lines(found.rows).at(-1)).toBe(
      "      P:Clandestina Reposado <Santet Deli Co/AGAVE> match",
    );
    expect(found.count).toBe(1);
    expect(found.rows.filter((row) => row.match)).toHaveLength(1);
  });

  it("lists an uncategorised match under No category, with its accent-blind range", () => {
    const found = searchRows(deli(), "cafe")!;
    expect(lines(found.rows)).toEqual([
      "[All] parent",
      "[No category] parent",
      "  P:Café con leche match",
    ]);
    expect(found.rows.at(-1)!.ranges).toEqual([{ start: 0, end: 4 }]);
    expect(found.count).toBe(1);
  });

  it("with no match lists All categories alone", () => {
    const found = searchRows(deli(), "zzz")!;
    expect(lines(found.rows)).toEqual(["[All] parent"]);
    expect(found.count).toBe(0);
  });

  it("adds no rows for a cell of a row's own", () => {
    const routed = { ...deli(), cells: [categoryCell("food"), productCell("water")] };
    expect(lines(searchRows(routed, "zzz")!.rows)).toEqual(["[All] parent"]);
  });
});

describe("usedStations", () => {
  it("usedStations: the default station, then every active station a stored cell or line names, in the model's order", () => {
    const stations: RoutingModel["stations"] = [
      { id: "bar", name: "Bar", active: true, colour: "blue" },
      { id: "coffee", name: "Coffee", active: true, colour: "brown" },
      { id: "grill", name: "Grill", active: true, colour: "red" },
      { id: "kitchen", name: "Kitchen", active: true, colour: "orange" },
      { id: "old", name: "Old kitchen", active: false, colour: "green" },
      { id: "pizza", name: "Pizza oven", active: true, colour: "amber" },
      { id: "unused", name: "Unused", active: true, colour: "teal" },
    ];
    const at = (stationId: string): RouteTarget => ({ kind: "station", stationId });
    const used = usedStations({
      ...model([folder("drinks"), folder("food")], [], []),
      stations,
      cells: [
        categoryCell("drinks", at("pizza")),
        categoryCell("food", noPreparation, "terrace"),
        {
          ...categoryCell("drinks", at("old"), "terrace"),
          periods: [
            { periodId: "lunch", target: at("bar") },
            { periodId: "dinner", target: noPreparation },
            { periodId: "brunch", target: at("pizza") },
          ],
        },
        productCell("ghost", at("gone")),
      ],
    });
    expect(used.map((station) => station.name)).toEqual(["Bar", "Kitchen", "Pizza oven"]);
    expect(usedStations({ ...model([], []), defaultStationId: null })).toEqual([]);
    expect(usedStations({ ...model([], []), defaultStationId: "kitchen" })).toEqual([
      { id: "kitchen", name: "Kitchen", active: true, colour: "orange" },
    ]);
  });
});

describe("stationDuring", () => {
  it("stationDuring takes the line holding the period, else the plain station", () => {
    const kitchen: RouteTarget = { kind: "station", stationId: "kitchen" };
    const oven: RouteTarget = { kind: "station", stationId: "oven" };
    const lines = [
      { periodIds: ["lunch", "dinner"], target: oven, text: "Lunch, Dinner: Pizza oven" },
      { periodIds: ["late"], target: { kind: "no_preparation" } as const, text: "" },
    ];
    expect(stationDuring(lines, "dinner", kitchen)).toEqual(oven);
    expect(stationDuring(lines, "late", kitchen)).toEqual({ kind: "no_preparation" });
    expect(stationDuring(lines, "breakfast", kitchen)).toBe(kitchen);
    expect(stationDuring([], "lunch", null)).toBeNull();
  });
});
