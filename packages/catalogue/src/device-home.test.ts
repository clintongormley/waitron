import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOME_COLUMN_RANGE,
  HOME_DISPLAY_DEFAULTS,
  arrangeHome,
  foldForSearch,
  homeDisplayProblem,
  indexDocument,
  openedSection,
  shownMembers,
  tileFill,
} from "./device-home.js";
import type { DocumentMember } from "./menu-document-types.js";

describe("display settings", () => {
  it("defaults a handheld to three columns and a till to six, colours, Device Home Page first", () => {
    expect(HOME_DISPLAY_DEFAULTS).toEqual({
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 6, tiles: "colours", order: "home_first" },
    });
    expect(HOME_COLUMN_RANGE).toEqual({ handheld: { min: 2, max: 6 }, till: { min: 6, max: 10 } });
  });
  it.each([
    ["handheld", 2, null],
    ["handheld", 6, null],
    ["handheld", 1, "columns"],
    ["handheld", 7, "columns"],
    ["till", 6, null],
    ["till", 10, null],
    ["till", 5, "columns"],
    ["till", 11, "columns"],
    ["till", 6.5, "columns"],
    ["till", "8", "columns"],
    ["till", null, "columns"],
  ] as const)("on a %s, %j columns is %s", (device, columns, problem) =>
    expect(homeDisplayProblem(device, { columns })).toBe(problem),
  );
  it("refuses a tile mode or an order outside its list, and checks no absent key", () => {
    expect(homeDisplayProblem("till", { tiles: "pictures" })).toBe("tiles");
    expect(homeDisplayProblem("till", { order: "first" })).toBe("order");
    expect(homeDisplayProblem("handheld", { tiles: "thumbnails", order: "menu_first" })).toBeNull();
    expect(homeDisplayProblem("handheld", {})).toBeNull();
  });
});

describe("arrangeHome", () => {
  it("swaps the two whole blocks, with a divider between them", () => {
    expect(arrangeHome("home_first", true, true)).toEqual({
      blocks: ["shortcuts", "menu"],
      divider: true,
    });
    expect(arrangeHome("menu_first", true, true)).toEqual({
      blocks: ["menu", "shortcuts"],
      divider: true,
    });
  });
  it("leaves out a block with nothing to show, and the divider with it, in either order", () => {
    for (const order of ["home_first", "menu_first"] as const) {
      expect(arrangeHome(order, false, true)).toEqual({ blocks: ["menu"], divider: false });
      expect(arrangeHome(order, true, false)).toEqual({ blocks: ["shortcuts"], divider: false });
      expect(arrangeHome(order, false, false)).toEqual({ blocks: [], divider: false });
    }
  });
});

describe("tileFill", () => {
  it("paints a stored colour in Colours mode and never shows an image there", () => {
    expect(tileFill("colours", "a.webp", "#256bb1")).toEqual({ kind: "color", color: "#256bb1" });
    expect(tileFill("colours", "a.webp", null)).toEqual({ kind: "neutral" });
  });
  it("shows the image in Thumbnails mode, else the colour, else neutral", () => {
    expect(tileFill("thumbnails", "a.webp", "#256bb1")).toEqual({ kind: "image", image: "a.webp" });
    expect(tileFill("thumbnails", null, "#256bb1")).toEqual({ kind: "color", color: "#256bb1" });
    expect(tileFill("thumbnails", "", undefined)).toEqual({ kind: "neutral" });
  });
  it("draws a malformed colour neutral, because it would land in a style attribute", () => {
    for (const color of ["red", "#B12525", "#b12", "x;background:url(y)"])
      expect(tileFill("colours", null, color)).toEqual({ kind: "neutral" });
  });
});

it("folds case and accents, so jamon finds Jamón", () => {
  expect(foldForSearch("Jamón Ibérico")).toBe("jamon iberico");
});

describe("indexDocument", () => {
  const product = (id: string): Extract<DocumentMember, { kind: "product" }> => ({
    kind: "product",
    menuItemId: `mi-${id}`,
    productId: `p-${id}`,
  });
  const section = (id: string, members: DocumentMember[]): DocumentMember => ({
    kind: "section",
    sectionId: id,
    internalName: id,
    names: {},
    image: null,
    color: null,
    members,
  });
  it("keeps each product at its first place and only sections with something to order", () => {
    const index = indexDocument(
      [section("drinks", [product("cola"), section("empty", [product("ghost")])]), product("cola")],
      (menuItemId) => (menuItemId === "mi-ghost" ? undefined : menuItemId),
    );
    expect([...index.products]).toEqual([["p-cola", "mi-cola"]]);
    expect([...index.sections.keys()]).toEqual(["drinks"]);
  });
  it("keeps a product at its first place but answers the offer met last, as the till's indexMenu does", () => {
    // Two menu-item ids for one product cannot come from one published menu; they are here only
    // to tell first-wins from last-wins apart.
    const index = indexDocument(
      [product("cola"), product("water"), { ...product("cola"), menuItemId: "mi-cola-2" }],
      (menuItemId) => menuItemId,
    );
    expect([...index.products]).toEqual([
      ["p-cola", "mi-cola-2"],
      ["p-water", "mi-water"],
    ]);
  });
  it("still indexes a direct node, so a shortcut can open it", () => {
    const direct: DocumentMember = {
      ...(section("bar", [product("cola")]) as Extract<DocumentMember, { kind: "section" }>),
      direct: true,
    };
    const index = indexDocument([direct], (menuItemId) => menuItemId);
    expect(index.sections.get("bar")).toBe(direct);
    expect([...index.products.keys()]).toEqual(["p-cola"]);
  });
});

describe("shownMembers", () => {
  const product = (id: string): DocumentMember => ({
    kind: "product",
    menuItemId: `mi-${id}`,
    productId: `p-${id}`,
  });
  const section = (id: string, members: DocumentMember[], direct = false): DocumentMember => ({
    kind: "section",
    sectionId: id,
    internalName: id,
    names: {},
    image: null,
    color: null,
    ...(direct ? { direct: true as const } : {}),
    members,
  });
  const ids = (members: DocumentMember[]) =>
    members.map((member) => (member.kind === "section" ? member.sectionId : member.productId));
  it("puts a direct node's members in its place, one level at a time", () => {
    const folderB = section("folderB", [product("b1")]);
    const directC = section("directC", [product("c1")], true);
    const direct = section("direct", [product("a"), folderB, directC], true);
    const shown = shownMembers([product("x"), direct, product("y")]);
    expect(ids(shown)).toEqual(["p-x", "p-a", "folderB", "p-c1", "p-y"]);
    expect(shown[2]).toBe(folderB);
  });
});

describe("openedSection", () => {
  const product = (id: string): DocumentMember => ({
    kind: "product",
    menuItemId: `mi-${id}`,
    productId: `p-${id}`,
  });
  const section = (
    id: string,
    name: string,
    members: DocumentMember[],
    direct = false,
  ): DocumentMember => ({
    kind: "section",
    sectionId: id,
    internalName: name,
    names: {},
    image: null,
    color: null,
    ...(direct ? { direct: true as const } : {}),
    members,
  });
  const offer = (menuItemId: string) => menuItemId;
  it("opens the copy home draws, else the copy the index holds", () => {
    const top = section("drinks", "bar", [product("cola")]);
    const nested = section("drinks", "drinks", [product("cola")]);
    const home = [top, section("food", "food", [nested])];
    const index = indexDocument(home, offer);
    expect(index.sections.get("drinks")).toBe(nested);
    expect(openedSection("drinks", index, home)).toBe(top);

    const directTop = section("drinks", "bar", [product("cola")], true);
    const directHome = [directTop, section("food", "food", [nested])];
    expect(openedSection("drinks", indexDocument(directHome, offer), directHome)).toBe(nested);
  });
  it("looks through a direct node on home, and answers nothing for a section the index lacks", () => {
    const beer = section("beer", "beer", [product("cana")]);
    const home = [section("drinks", "drinks", [beer], true)];
    const index = indexDocument(home, offer);
    expect(openedSection("beer", index, home)).toBe(beer);
    const empty = indexDocument(home, () => undefined);
    expect(openedSection("beer", empty, home)).toBeUndefined();
  });
});

// Reads the file as TEXT: a dynamic `import()` or a `require` would pass it.
it("imports nothing but the colour rule and the document types, so a browser app can deep-import it", () => {
  const source = readFileSync(join(import.meta.dirname, "device-home.ts"), "utf8");
  const specifiers = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)].map(
    ([, type, from]) => `${type ? "type " : ""}${from}`,
  );
  expect(specifiers).toEqual(["./color-inheritance.js", "type ./menu-document-types.js"]);
  expect(source).not.toMatch(/^import\s+"/m);
});
