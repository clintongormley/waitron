import { describe, expect, it } from "vitest";
import {
  buildSectionGraph,
  menusContaining,
  placementsByProduct,
  reachableFrom,
  reachableProducts,
  wouldCreateCycle,
  type MemberRow,
  type SectionRow,
} from "./section-graph.js";

const owned = (id: string): SectionRow => ({ id, role: "section", ownerMenuId: "menu-lunch" });
const root = (id: string, menu: string): SectionRow => ({
  id,
  role: "menu_root",
  ownerMenuId: menu,
});

let next = 0;
/** One list's members in the order given, as rows with positions 0..n-1. */
function list(sectionId: string, refs: string[]): MemberRow[] {
  return refs.map((ref, position) => ({
    id: `m${String(next++).padStart(4, "0")}`,
    sectionId,
    position,
    productId: ref.startsWith("p:") ? ref.slice(2) : null,
    childSectionId: ref.startsWith("s:") ? ref.slice(2) : null,
  }));
}

/**
 * Lunch-root [Favourites[Lemonade], Drinks[Lemonade, Water, Beer[Lager]]], Dinner-root [Drinks],
 * Brunch-root [Favourites], and a Specials list no menu reaches.
 */
function lunch() {
  return buildSectionGraph(
    [
      root("lunch", "menu-lunch"),
      root("dinner", "menu-dinner"),
      root("brunch", "menu-brunch"),
      owned("favourites"),
      owned("drinks"),
      owned("beer"),
      owned("specials"),
    ],
    [
      ...list("lunch", ["s:favourites", "s:drinks"]),
      ...list("dinner", ["s:drinks"]),
      ...list("brunch", ["s:favourites"]),
      ...list("favourites", ["p:lemonade"]),
      ...list("drinks", ["p:lemonade", "p:water", "s:beer"]),
      ...list("beer", ["p:lager"]),
      ...list("specials", ["s:beer"]),
    ],
  );
}

describe("wouldCreateCycle", () => {
  it("is true for a section containing itself", () => {
    expect(wouldCreateCycle(lunch(), "drinks", "drinks")).toBe(true);
  });

  it("is true for a direct back edge", () => {
    // Drinks holds Beer, so Beer holding Drinks closes a loop.
    expect(wouldCreateCycle(lunch(), "beer", "drinks")).toBe(true);
  });

  it("is true for an indirect back edge", () => {
    // Lunch ∋ Drinks ∋ Beer, so Beer holding Lunch closes a loop two steps long.
    expect(wouldCreateCycle(lunch(), "beer", "lunch")).toBe(true);
  });

  it("is false for one child reused under two unrelated parents", () => {
    // Drinks is already under Lunch; Favourites holding it too is sharing, not a loop.
    expect(wouldCreateCycle(lunch(), "favourites", "drinks")).toBe(false);
    expect(wouldCreateCycle(lunch(), "specials", "drinks")).toBe(false);
  });
});

describe("reachableFrom", () => {
  it("names every section below the root once, however many paths lead to it, and not the root", () => {
    const graph = buildSectionGraph(
      [root("brunch", "menu-brunch"), owned("drinks"), owned("beer"), owned("specials")],
      [
        ...list("brunch", ["s:drinks", "s:beer"]),
        ...list("drinks", ["s:beer"]),
        ...list("beer", ["p:lager"]),
        ...list("specials", ["s:beer"]),
      ],
    );
    expect([...reachableFrom(graph, "brunch").sections].sort()).toEqual(["beer", "drinks"]);
    expect([...reachableFrom(lunch(), "dinner").sections].sort()).toEqual(["beer", "drinks"]);
  });

  it("lists the products in reachableProducts' order beside the sections", () => {
    expect(reachableFrom(lunch(), "lunch").products).toEqual(["lemonade", "water", "lager"]);
    expect([...reachableFrom(lunch(), "lunch").sections].sort()).toEqual([
      "beer",
      "drinks",
      "favourites",
    ]);
  });
});

describe("reachableProducts", () => {
  it("lists every product a root reaches, depth first, each at its first occurrence", () => {
    expect(reachableProducts(lunch(), "lunch")).toEqual(["lemonade", "water", "lager"]);
  });

  it("follows the order the members are stored in, not the order they were written", () => {
    const graph = buildSectionGraph(
      [owned("drinks")],
      [
        { id: "b", sectionId: "drinks", position: 1, productId: "water", childSectionId: null },
        { id: "a", sectionId: "drinks", position: 0, productId: "tea", childSectionId: null },
        // A tie on position sorts by id: "c" before "d".
        { id: "d", sectionId: "drinks", position: 2, productId: "juice", childSectionId: null },
        { id: "c", sectionId: "drinks", position: 2, productId: "cola", childSectionId: null },
      ],
    );
    expect(reachableProducts(graph, "drinks")).toEqual(["tea", "water", "cola", "juice"]);
  });

  it("is empty for a section with no members and for one the graph does not hold", () => {
    expect(reachableProducts(buildSectionGraph([owned("empty")], []), "empty")).toEqual([]);
    expect(reachableProducts(lunch(), "absent")).toEqual([]);
  });
});

describe("placements", () => {
  it("names every path from the root to a list holding the product", () => {
    expect(placementsByProduct(lunch(), "lunch").get("lemonade") ?? []).toEqual([
      ["lunch", "favourites"],
      ["lunch", "drinks"],
    ]);
    expect(placementsByProduct(lunch(), "lunch").get("lager") ?? []).toEqual([
      ["lunch", "drinks", "beer"],
    ]);
  });

  it("names the root alone for a product it holds directly, and nothing for one it cannot reach", () => {
    const graph = buildSectionGraph([root("lunch", "menu-lunch")], list("lunch", ["p:bread"]));
    expect(placementsByProduct(graph, "lunch").get("bread") ?? []).toEqual([["lunch"]]);
    expect(placementsByProduct(lunch(), "lunch").get("bread") ?? []).toEqual([]);
  });
});

describe("menusContaining", () => {
  it("names every menu whose root reaches the section, however deep", () => {
    // Beer is under Drinks, which Lunch and Dinner hold; Brunch reaches only Favourites, and
    // Specials holds Beer but no menu holds Specials.
    expect(menusContaining(lunch(), "beer")).toEqual(["menu-dinner", "menu-lunch"]);
    expect(menusContaining(lunch(), "favourites")).toEqual(["menu-brunch", "menu-lunch"]);
  });

  it("names a root's own menu for the root itself, and none for a list no menu reaches", () => {
    expect(menusContaining(lunch(), "lunch")).toEqual(["menu-lunch"]);
    expect(menusContaining(lunch(), "specials")).toEqual([]);
    expect(menusContaining(lunch(), "absent")).toEqual([]);
  });

  it("does not count a Device Home Page holding the section as the menu containing it", () => {
    const graph = buildSectionGraph(
      [{ id: "layout", role: "home_layout", ownerMenuId: "menu-lunch" }, owned("drinks")],
      list("layout", ["s:drinks"]),
    );
    expect(menusContaining(graph, "drinks")).toEqual([]);
  });
});

describe("a section reached along two paths", () => {
  // Lunch ∋ Drinks, Favourites; both hold Beer ∋ Lager.
  const diamond = () =>
    buildSectionGraph(
      [root("lunch", "menu-lunch"), owned("drinks"), owned("favourites"), owned("beer")],
      [
        ...list("lunch", ["s:drinks", "s:favourites"]),
        ...list("drinks", ["s:beer"]),
        ...list("favourites", ["s:beer"]),
        ...list("beer", ["p:lager"]),
      ],
    );

  it("is walked once for products and menus, and once per path for placements", () => {
    const graph = diamond();
    expect(reachableProducts(graph, "lunch")).toEqual(["lager"]);
    expect(menusContaining(graph, "beer")).toEqual(["menu-lunch"]);
    expect(wouldCreateCycle(graph, "beer", "lunch")).toBe(true);
    expect(wouldCreateCycle(graph, "favourites", "drinks")).toBe(false);
    expect(placementsByProduct(graph, "lunch").get("lager") ?? []).toEqual([
      ["lunch", "drinks", "beer"],
      ["lunch", "favourites", "beer"],
    ]);
  });

  it("does not loop on stored rows that hold a cycle", () => {
    // The writes refuse a cycle; this graph is built by hand to hold one anyway.
    const graph = buildSectionGraph(
      [root("lunch", "menu-lunch"), owned("a"), owned("b")],
      [...list("lunch", ["s:a"]), ...list("a", ["s:b", "p:tea"]), ...list("b", ["s:a"])],
    );
    expect(reachableProducts(graph, "lunch")).toEqual(["tea"]);
    expect([...reachableFrom(graph, "lunch").sections].sort()).toEqual(["a", "b"]);
    expect(placementsByProduct(graph, "lunch").get("tea") ?? []).toEqual([["lunch", "a"]]);
    expect(menusContaining(graph, "b")).toEqual(["menu-lunch"]);
  });
});

describe("the graph's own reads", () => {
  it("answers a section's role, owner, members and parents", () => {
    const graph = lunch();
    expect(graph.role("lunch")).toBe("menu_root");
    expect(graph.role("drinks")).toBe("section");
    expect(graph.role("absent")).toBeUndefined();
    expect(graph.ownerMenu("lunch")).toBe("menu-lunch");
    expect(graph.ownerMenu("drinks")).toBe("menu-lunch");
    expect(graph.ownerMenu("absent")).toBeNull();
    expect(graph.children("drinks").map((member) => member.ref)).toEqual([
      { kind: "product", productId: "lemonade" },
      { kind: "product", productId: "water" },
      { kind: "section", sectionId: "beer" },
    ]);
    expect(graph.children("absent")).toEqual([]);
    expect([...graph.parents("beer")].sort()).toEqual(["drinks", "specials"]);
    expect(graph.parents("lunch")).toEqual([]);
  });
});

it("reads missing rows only as layout tiles, keeping structural walks and placements unchanged", () => {
  const graph = buildSectionGraph(
    [root("lunch", "menu-lunch"), { id: "layout", role: "home_layout", ownerMenuId: "menu-lunch" }],
    [
      ...list("lunch", ["p:soup"]),
      {
        id: "missing",
        sectionId: "layout",
        position: 0,
        productId: null,
        childSectionId: null,
        missingName: "Drinks › Beer",
      },
    ],
  );
  expect(graph.tiles("layout")).toEqual([
    { id: "missing", position: 0, ref: { kind: "missing", name: "Drinks › Beer" } },
  ]);
  expect(graph.children("layout")).toEqual([]);
  expect(reachableFrom(graph, "lunch")).toEqual({ products: ["soup"], sections: new Set() });
  expect(placementsByProduct(graph, "lunch")).toEqual(new Map([["soup", [["lunch"]]]]));
});

describe("folder", () => {
  it("answers a following folder for a member with no stored setting", () => {
    const rows = list("lunch", ["s:drinks"]);
    const graph = buildSectionGraph(
      [root("lunch", "menu-lunch"), root("drinks", "menu-drinks")],
      rows,
    );
    expect(graph.folder(rows[0]!.id)).toEqual({ showAsFolder: true, overrides: {} });
  });

  it("answers the stored setting for an include", () => {
    const [row] = list("lunch", ["s:drinks"]);
    const graph = buildSectionGraph(
      [root("lunch", "menu-lunch"), root("drinks", "menu-drinks")],
      [{ ...row!, showAsFolder: false, folderOverrides: { color: "#112233" } }],
    );
    expect(graph.folder(row!.id)).toEqual({
      showAsFolder: false,
      overrides: { color: "#112233" },
    });
  });
});
