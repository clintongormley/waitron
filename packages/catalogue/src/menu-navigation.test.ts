import { describe, expect, it } from "vitest";
import type { DocumentMember, MenuDocument } from "./menu-document-types.js";
import { diffMenuDocuments } from "./menu-document.js";
import { indexMenuOccurrences, menuTargetKey } from "./menu-navigation.js";

function section(id: string, members: DocumentMember[] = []): DocumentMember {
  return {
    kind: "section",
    sectionId: id,
    internalName: "Same staff heading",
    names: { en: "Same customer heading" },
    image: null,
    color: null,
    members,
  };
}

function document(members: DocumentMember[]): MenuDocument {
  return {
    format: 3,
    menuId: "lunch",
    menuName: "Lunch",
    root: { members },
    offers: {},
    home: {
      shortcuts: [],
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 4, tiles: "thumbnails", order: "menu_first" },
    },
  };
}

const dish: DocumentMember = { kind: "product", menuItemId: "mi-soup", productId: "soup" };

describe("indexMenuOccurrences", () => {
  it("keeps every nested occurrence of a repeated included root in document order", () => {
    const beer = section("beer", [dish]);
    const drinks = section("drinks", [beer]);
    const proposed = document([drinks, section("favourites", [drinks])]);
    const before = structuredClone(proposed);
    expect(indexMenuOccurrences(proposed)).toEqual([
      {
        target: { kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } },
        ancestorSectionIds: [],
      },
      {
        target: { kind: "section", sectionIds: ["drinks", "beer"], field: { kind: "summary" } },
        ancestorSectionIds: ["drinks"],
      },
      {
        target: {
          kind: "product",
          sectionIds: ["drinks", "beer"],
          menuItemId: "mi-soup",
          productId: "soup",
          field: { kind: "summary" },
        },
        ancestorSectionIds: ["drinks", "beer"],
      },
      {
        target: { kind: "section", sectionIds: ["favourites"], field: { kind: "summary" } },
        ancestorSectionIds: [],
      },
      {
        target: {
          kind: "section",
          sectionIds: ["favourites", "drinks"],
          field: { kind: "summary" },
        },
        ancestorSectionIds: ["favourites"],
      },
      {
        target: {
          kind: "section",
          sectionIds: ["favourites", "drinks", "beer"],
          field: { kind: "summary" },
        },
        ancestorSectionIds: ["favourites", "drinks"],
      },
      {
        target: {
          kind: "product",
          sectionIds: ["favourites", "drinks", "beer"],
          menuItemId: "mi-soup",
          productId: "soup",
          field: { kind: "summary" },
        },
        ancestorSectionIds: ["favourites", "drinks", "beer"],
      },
    ]);
    expect(proposed).toEqual(before);
  });

  it("keeps empty and identically named sections addressable by their IDs", () => {
    expect(indexMenuOccurrences(document([section("empty-a"), section("empty-b"), dish]))).toEqual([
      {
        target: { kind: "section", sectionIds: ["empty-a"], field: { kind: "summary" } },
        ancestorSectionIds: [],
      },
      {
        target: { kind: "section", sectionIds: ["empty-b"], field: { kind: "summary" } },
        ancestorSectionIds: [],
      },
      {
        target: {
          kind: "product",
          sectionIds: [],
          menuItemId: "mi-soup",
          productId: "soup",
          field: { kind: "summary" },
        },
        ancestorSectionIds: [],
      },
    ]);
  });

  it("cuts only a cycle on the current path while retaining a sibling occurrence", () => {
    const loop = section("loop", [dish]);
    if (loop.kind !== "section") throw new Error("fixture is a section");
    loop.members.push(loop);
    expect(indexMenuOccurrences(document([loop, section("other", [loop])]))).toEqual([
      {
        target: { kind: "section", sectionIds: ["loop"], field: { kind: "summary" } },
        ancestorSectionIds: [],
      },
      {
        target: {
          kind: "product",
          sectionIds: ["loop"],
          menuItemId: "mi-soup",
          productId: "soup",
          field: { kind: "summary" },
        },
        ancestorSectionIds: ["loop"],
      },
      {
        target: { kind: "section", sectionIds: ["other"], field: { kind: "summary" } },
        ancestorSectionIds: [],
      },
      {
        target: { kind: "section", sectionIds: ["other", "loop"], field: { kind: "summary" } },
        ancestorSectionIds: ["other"],
      },
      {
        target: {
          kind: "product",
          sectionIds: ["other", "loop"],
          menuItemId: "mi-soup",
          productId: "soup",
          field: { kind: "summary" },
        },
        ancestorSectionIds: ["other", "loop"],
      },
    ]);
  });

  it("keeps target keys stable when names and list order change", () => {
    const original = document([section("a", [dish]), section("b", [dish])]);
    const renamed = structuredClone(original);
    renamed.root.members.reverse();
    for (const member of renamed.root.members)
      if (member.kind === "section") member.internalName = "Renamed";
    expect(
      indexMenuOccurrences(renamed)
        .map(({ target }) => menuTargetKey(target))
        .sort(),
    ).toEqual(
      indexMenuOccurrences(original)
        .map(({ target }) => menuTargetKey(target))
        .sort(),
    );
  });
});

describe("menuTargetKey", () => {
  it("distinguishes separator-containing IDs and nested subjects", () => {
    const base = {
      kind: "product" as const,
      sectionIds: ["a/b", "c"],
      menuItemId: "mi-soup",
      productId: "soup",
      field: { kind: "summary" as const },
    };
    const keys = [
      base,
      { ...base, sectionIds: ["a", "b/c"] },
      { ...base, menuItemId: "mi-other" },
      { ...base, variantId: "small" },
      { ...base, variantId: "large" },
      { ...base, listId: "extras-a", extraProductId: "lemon" },
      { ...base, listId: "extras-b", extraProductId: "lemon" },
      { ...base, listId: "options", optionLabelId: "no-ice" },
      { ...base, listId: "options", optionLabelId: "ice" },
      { ...base, field: { kind: "name" as const, audience: "customer" as const, language: "es" } },
      { ...base, field: { kind: "name" as const, audience: "customer" as const, language: "en" } },
      { ...base, field: { kind: "name" as const, audience: "kitchen" as const } },
      { ...base, field: { kind: "description" as const, language: "es" } },
    ].map(menuTargetKey);
    expect(new Set(keys).size).toBe(13);
    expect(JSON.parse(keys[0]!)).toEqual([
      "product",
      ["a/b", "c"],
      "mi-soup",
      "soup",
      null,
      null,
      null,
      null,
      ["summary"],
    ]);
  });

  it("normalises object property order and optional name language", () => {
    expect(
      menuTargetKey({
        kind: "section",
        sectionIds: ["a"],
        field: { kind: "name", audience: "staff" },
      }),
    ).toBe(
      menuTargetKey({
        field: { audience: "staff", kind: "name", language: undefined },
        sectionIds: ["a"],
        kind: "section",
      }),
    );
  });

  it("separates title, list, section and Home identities", () => {
    expect([
      menuTargetKey({ kind: "title", menuId: "lunch" }),
      menuTargetKey({ kind: "list", sectionIds: [] }),
      menuTargetKey({ kind: "section", sectionIds: ["drinks"], field: { kind: "image" } }),
      menuTargetKey({ kind: "home", device: "till", field: "columns" }),
      menuTargetKey({ kind: "home", device: "handheld", field: "columns" }),
      menuTargetKey({ kind: "home", device: "till", field: "tiles" }),
    ]).toEqual([
      '["title","lunch"]',
      '["list",[]]',
      '["section",["drinks"],["image"]]',
      '["home","till","columns"]',
      '["home","handheld","columns"]',
      '["home","till","tiles"]',
    ]);
  });
});

describe("diff identity paths", () => {
  it("records every added descendant beneath repeated included roots using ID paths", () => {
    const drinks = section("drinks", [section("beer")]);
    expect(
      diffMenuDocuments(document([]), document([drinks, section("favourites", [drinks])])),
    ).toEqual([
      {
        kind: "section_added",
        sectionId: "drinks",
        parentSectionIds: [],
        name: "Same staff heading",
        under: [],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "drinks",
        parentSectionIds: ["favourites"],
        name: "Same staff heading",
        under: ["Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "beer",
        parentSectionIds: ["drinks"],
        name: "Same staff heading",
        under: ["Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "beer",
        parentSectionIds: ["favourites", "drinks"],
        name: "Same staff heading",
        under: ["Same staff heading", "Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "favourites",
        parentSectionIds: [],
        name: "Same staff heading",
        under: [],
        source: "this_menu",
      },
    ]);
  });

  it("keeps removed occurrences distinct even when both parents have identical names", () => {
    const live = document([section("a", [section("child")]), section("b", [section("child")])]);
    const proposed = document([section("a"), section("b")]);
    expect(diffMenuDocuments(live, proposed)).toEqual([
      {
        kind: "section_removed",
        sectionId: "child",
        parentSectionIds: ["a"],
        name: "Same staff heading",
        under: ["Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_removed",
        sectionId: "child",
        parentSectionIds: ["b"],
        name: "Same staff heading",
        under: ["Same staff heading"],
        source: "this_menu",
      },
    ]);
  });

  it("identifies root and nested reorder lists independently of their names", () => {
    const live = document([section("a", [section("x"), section("y")]), section("b")]);
    const proposed = document([section("b"), section("a", [section("y"), section("x")])]);
    expect(diffMenuDocuments(live, proposed)).toEqual([
      { kind: "order_changed", listSectionId: null, list: [], source: "this_menu" },
      {
        kind: "order_changed",
        listSectionId: "a",
        list: ["Same staff heading"],
        source: "this_menu",
      },
    ]);
  });
});

describe("diff path comparisons", () => {
  it("does not merge different ID paths that contain separators", () => {
    const live = document([
      section("a/b", [section("c", [section("child")])]),
      section("a", [section("b/c")]),
    ]);
    const proposed = document([
      section("a/b", [section("c")]),
      section("a", [section("b/c", [section("child")])]),
    ]);
    expect(diffMenuDocuments(live, proposed)).toEqual([
      {
        kind: "section_removed",
        sectionId: "child",
        parentSectionIds: ["a/b", "c"],
        name: "Same staff heading",
        under: ["Same staff heading", "Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "child",
        parentSectionIds: ["a", "b/c"],
        name: "Same staff heading",
        under: ["Same staff heading", "Same staff heading"],
        source: "this_menu",
      },
    ]);
  });
});

describe("diff cyclic paths", () => {
  it("cuts a current-path cycle without losing another occurrence of its descendants", () => {
    const loop = section("loop", [section("child")]);
    if (loop.kind !== "section") throw new Error("fixture is a section");
    loop.members.push(section("loop", [section("hidden")]));
    expect(diffMenuDocuments(document([]), document([loop, section("other", [loop])]))).toEqual([
      {
        kind: "section_added",
        sectionId: "loop",
        parentSectionIds: [],
        name: "Same staff heading",
        under: [],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "loop",
        parentSectionIds: ["other"],
        name: "Same staff heading",
        under: ["Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "child",
        parentSectionIds: ["loop"],
        name: "Same staff heading",
        under: ["Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "child",
        parentSectionIds: ["other", "loop"],
        name: "Same staff heading",
        under: ["Same staff heading", "Same staff heading"],
        source: "this_menu",
      },
      {
        kind: "section_added",
        sectionId: "other",
        parentSectionIds: [],
        name: "Same staff heading",
        under: [],
        source: "this_menu",
      },
    ]);
  });
});
