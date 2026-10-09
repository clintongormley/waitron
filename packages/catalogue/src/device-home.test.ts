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
  searchFor,
  sectionTrail,
  shownMembers,
  tileFill,
  tilePaths,
} from "./device-home.js";
import type { DocumentMember } from "./menu-document-types.js";

describe("display settings", () => {
  it("defaults a handheld to three columns and a till to six, colours, Device Home Page first", () => {
    expect(HOME_DISPLAY_DEFAULTS).toEqual({
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 6, tiles: "colours", order: "home_first" },
    });
    expect(HOME_COLUMN_RANGE).toEqual({ handheld: { min: 2, max: 3 }, till: { min: 4, max: 10 } });
  });
  it.each([
    ["handheld", 2, null],
    ["handheld", 3, null],
    ["handheld", 1, "columns"],
    ["handheld", 4, "columns"],
    ["till", 4, null],
    ["till", 10, null],
    ["till", 3, "columns"],
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

describe("searchFor", () => {
  const find = (query: string, ...names: string[]) =>
    searchFor(query)(names.map((name) => [name, foldForSearch(name)] as const));
  it("finds a name holding every typed word, whatever lies between them", () => {
    expect(find("gin tonic", "Gin & Tónic", "Gin")).toEqual(["Gin & Tónic"]);
  });
  it("finds a name whatever order the words are typed in", () => {
    expect(find("TONIC  gin", "Gin & Tónic")).toEqual(["Gin & Tónic"]);
  });
  it("finds a name from the middle of the word still being typed", () => {
    expect(find("onic", "Gin & Tónic")).toEqual(["Gin & Tónic"]);
  });
  it("finds only a whole word once the word is followed by a space", () => {
    expect(find("gin ", "Ginger Ale", "Gin & Tónic")).toEqual(["Gin & Tónic"]);
    expect(find("ginger ale", "Ginger Ale")).toEqual(["Ginger Ale"]);
    expect(find("ton gin", "Gin & Tónic")).toEqual([]);
  });
  it("treats punctuation like a space, in what is typed and in the name", () => {
    expect(find("gin&ton", "Gin & Tónic")).toEqual(["Gin & Tónic"]);
    expect(find("gin & tonic", "Gin & Tónic")).toEqual(["Gin & Tónic"]);
    expect(find("gin-", "Ginger Ale")).toEqual([]);
  });
  it("does not find a name missing one of the typed words", () => {
    expect(find("gin lemon", "Gin & Tónic")).toEqual([]);
  });
  it("needs every word typed, not only the last two", () => {
    const names = ["Lemon Tonic", "Gin Tonic", "Gin Lemon", "Gin Lemon Tonic"];
    expect(find("gin lemon ton", ...names)).toEqual(["Gin Lemon Tonic"]);
    expect(find("gin lemon tonic ", ...names)).toEqual(["Gin Lemon Tonic"]);
  });
  it("finds every name, in the order given, when nothing is typed", () => {
    expect(find("  ", "Virgin Mary", "Gin")).toEqual(["Virgin Mary", "Gin"]);
  });
  it("lists a whole word first, then the start of a word, then the middle of one", () => {
    expect(find("gin", "Virgin Mary", "Ginger Ale", "Gin & Tonic")).toEqual([
      "Gin & Tonic",
      "Ginger Ale",
      "Virgin Mary",
    ]);
  });
  it("among equal matches, lists the earlier match first, then the shorter name", () => {
    expect(find("gin", "Tonic Gin", "Gin & Tonic", "Gin")).toEqual([
      "Gin",
      "Gin & Tonic",
      "Tonic Gin",
    ]);
  });
  it("keeps the order given for names that match equally well", () => {
    expect(find("cola", "Cola Zero", "Cola Lite")).toEqual(["Cola Zero", "Cola Lite"]);
    expect(find("cola", "Cola Lite", "Cola Zero")).toEqual(["Cola Lite", "Cola Zero"]);
  });
  it("orders by the last word typed", () => {
    expect(find("tonic gin", "Virgin Tonic", "Gin & Tonic")).toEqual([
      "Gin & Tonic",
      "Virgin Tonic",
    ]);
  });
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
    expect(openedSection("drinks", index)).toBe(top);

    const directTop = section("drinks", "bar", [product("cola")], true);
    const directHome = [directTop, section("food", "food", [nested])];
    expect(openedSection("drinks", indexDocument(directHome, offer))).toBe(nested);
  });
  it("looks through a direct node on home, and answers nothing for a section the index lacks", () => {
    const beer = section("beer", "beer", [product("cana")]);
    const home = [section("drinks", "drinks", [beer], true)];
    const index = indexDocument(home, offer);
    expect(openedSection("beer", index)).toBe(beer);
    const empty = indexDocument(home, () => undefined);
    expect(openedSection("beer", empty)).toBeUndefined();
  });
});

describe("sectionTrail", () => {
  type Section = Extract<DocumentMember, { kind: "section" }>;
  const product = (id: string): DocumentMember => ({
    kind: "product",
    menuItemId: `mi-${id}`,
    productId: `p-${id}`,
  });
  const section = (id: string, name: string, members: DocumentMember[]): Section => ({
    kind: "section",
    sectionId: id,
    internalName: name,
    names: {},
    image: null,
    color: null,
    members,
  });
  const offer = (menuItemId: string) => menuItemId;
  const beer = section("beer", "beer", [product("cana")]);
  const first = section("drinks", "first bar", [beer]);
  const second = section("drinks", "second bar", [beer]);
  const home = [
    { ...section("left", "left", [first]), direct: true as const },
    { ...section("right", "right", [product("cola"), second]), direct: true as const },
  ];
  const internalNames = (trail: Section[] | null) => trail?.map((each) => each.internalName);

  it("numbers each copy a drawn list holds of one section, and leaves a product no path", () => {
    const drawn = indexDocument(home, offer).home;
    expect(tilePaths(drawn, [{ sectionId: "food", copy: 0 }])).toEqual([
      [
        { sectionId: "food", copy: 0 },
        { sectionId: "drinks", copy: 0 },
      ],
      [],
      [
        { sectionId: "food", copy: 0 },
        { sectionId: "drinks", copy: 1 },
      ],
    ]);
  });
  it("opens the copy a tile was drawn from, and the steps beneath it", () => {
    const index = indexDocument(home, offer);
    const [toFirst, , toSecond] = tilePaths(index.home, []);
    expect(internalNames(sectionTrail(toFirst!, index))).toEqual(["first bar"]);
    expect(internalNames(sectionTrail(toSecond!, index))).toEqual(["second bar"]);
    const toBeer = tilePaths(second.members, toSecond!)[0]!;
    expect(internalNames(sectionTrail(toBeer, index))).toEqual(["second bar", "beer"]);
  });
  it("answers null for a copy its list no longer draws, or a section the index lacks", () => {
    const index = indexDocument(home, offer);
    expect(sectionTrail([{ sectionId: "drinks", copy: 2 }], index)).toBeNull();
    expect(
      sectionTrail(
        [
          { sectionId: "drinks", copy: 0 },
          { sectionId: "beer", copy: 1 },
        ],
        index,
      ),
    ).toBeNull();
    expect(
      sectionTrail(
        [{ sectionId: "drinks", copy: 0 }],
        indexDocument(home, () => undefined),
      ),
    ).toBeNull();
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
