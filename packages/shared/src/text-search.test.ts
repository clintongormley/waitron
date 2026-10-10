import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  compareSearchRanks,
  foldCache,
  foldForSearch,
  searchBy,
  searchFor,
  searchRankKey,
  textSearch,
  type SearchRank,
} from "./text-search.js";

const find = (query: string, ...names: string[]) =>
  searchFor(query)(names.map((name) => [name, foldForSearch(name)] as const));
const findParts = (query: string, ...rows: string[][]) =>
  searchFor(query)(rows.map((parts) => [parts.join("|"), parts.map(foldForSearch)] as const));

it("folds case and accents, so jamon finds Jamón", () => {
  expect(foldForSearch("Jamón Ibérico")).toBe("jamon iberico");
});

it("folds a capital I the same whatever language the process runs in", () => {
  const original = String.prototype.toLocaleLowerCase;
  // Stands in for a process whose language is Turkish, where a capital I lowercases to a dotless ı.
  vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (
    this: string,
    locale?: Intl.LocalesArgument,
  ) {
    return original.call(this, locale ?? "tr");
  });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  expect(foldForSearch("ISABEL İBIZA €5")).toBe("isabel ibiza €5");
});

describe("searchFor", () => {
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

describe("a query with no words", () => {
  it("finds nothing when it is only punctuation", () => {
    expect(find("&", "Gin & Tonic", "Fish-and-chips")).toEqual([]);
    expect(find(" - ", "Fish-and-chips")).toEqual([]);
  });
  it("is no search at all when it is blank", () => {
    expect(textSearch("")).toBeUndefined();
    expect(textSearch("   ")).toBeUndefined();
    expect(textSearch("&")).toBeDefined();
    expect(textSearch("&")!.rank("gin & tonic")).toBeUndefined();
  });
});

describe("text in several parts", () => {
  it("finds each word in any part", () => {
    expect(findParts("tonic drinks", ["Gin & Tonic", "Drinks"], ["Tonic", "Mixers"])).toEqual([
      "Gin & Tonic|Drinks",
    ]);
  });
  it("never lets a word span two parts", () => {
    expect(findParts("gintonic", ["Gin", "Tonic"])).toEqual([]);
  });
  it("finds the word being typed inside any part", () => {
    expect(findParts("drinks onic", ["Gin & Tonic", "Drinks"])).toEqual(["Gin & Tonic|Drinks"]);
  });
  it("orders an earlier part's match before a later part's of the same kind", () => {
    expect(findParts("gin", ["Mixers", "Gin"], ["Gin", "Mixers"])).toEqual([
      "Gin|Mixers",
      "Mixers|Gin",
    ]);
  });
  it("orders by kind before part", () => {
    expect(findParts("gin", ["Ginger", "Spirits"], ["Spirits", "Gin"])).toEqual([
      "Spirits|Gin",
      "Ginger|Spirits",
    ]);
  });
  it("keeps the best part when the last word matches in more than one", () => {
    expect(findParts("gin", ["Mixers", "Gin"], ["Gin", "Ginger"])).toEqual([
      "Gin|Ginger",
      "Mixers|Gin",
    ]);
  });
  it("treats one string as one part", () => {
    const search = textSearch("gin")!;
    expect(search.rank("gin & tonic")).toEqual(search.rank(["gin & tonic"]));
  });
});

describe("rank", () => {
  const rankOf = (query: string, ...parts: string[]) =>
    textSearch(query)!.rank(parts.map(foldForSearch));
  it("reports kind, part, position and total length", () => {
    expect(rankOf("ton", "Gin & Tonic", "Mixers")).toEqual({
      kind: 1,
      part: 0,
      position: 6,
      length: 17,
    });
    expect(rankOf("onic", "Gin & Tonic")).toEqual({ kind: 2, part: 0, position: 7, length: 11 });
    expect(rankOf("tonic", "Mixers", "Gin & Tonic")).toEqual({
      kind: 0,
      part: 1,
      position: 6,
      length: 17,
    });
  });
  it("keeps a later part's better match over an earlier part's weaker one", () => {
    expect(rankOf("gin", "Ginger", "Gin")).toEqual({ kind: 0, part: 1, position: 0, length: 9 });
  });
  it("ranks a completed last word by where it is whole", () => {
    expect(rankOf("gin ", "Ginger Gin")).toEqual({ kind: 0, part: 0, position: 7, length: 10 });
  });
});

describe("compareSearchRanks and searchRankKey agree", () => {
  const ranks: SearchRank[] = [
    { kind: 0, part: 0, position: 0, length: 3 },
    { kind: 0, part: 0, position: 0, length: 11 },
    { kind: 0, part: 0, position: 6, length: 9 },
    { kind: 0, part: 1, position: 0, length: 9 },
    { kind: 1, part: 0, position: 0, length: 10 },
    { kind: 2, part: 0, position: 3, length: 11 },
  ];
  it("orders kind, then part, then position, then length", () => {
    for (let i = 0; i < ranks.length - 1; i += 1) {
      expect(compareSearchRanks(ranks[i]!, ranks[i + 1]!)).toBeLessThan(0);
      expect(compareSearchRanks(ranks[i + 1]!, ranks[i]!)).toBeGreaterThan(0);
      expect(searchRankKey(ranks[i]!)).toBeLessThan(searchRankKey(ranks[i + 1]!));
    }
    expect(compareSearchRanks(ranks[0]!, { ...ranks[0]! })).toBe(0);
  });
  it("stays a safe integer and keeps order for very large values", () => {
    const big = { kind: 2, part: 5000, position: 5_000_000, length: 5_000_000 } as const;
    expect(Number.isSafeInteger(searchRankKey(big))).toBe(true);
    expect(searchRankKey({ ...big, kind: 1 })).toBeLessThan(searchRankKey(big));
    expect(searchRankKey({ kind: 0, part: 5000, position: 0, length: 0 })).toBeLessThan(
      searchRankKey({ kind: 1, part: 0, position: 0, length: 0 }),
    );
  });
});

describe("searchBy", () => {
  const drinks = [{ name: "Café con leche" }, { name: "Té" }, { name: "Caffè latte" }];
  it("folds each item's text, so cafe finds Café", () => {
    expect(searchBy("cafe", drinks, (drink) => drink.name)).toEqual([drinks[0]]);
  });
  it("folds each part, and finds the words across parts", () => {
    const rows = [
      { name: "Tónic", group: "Mezcladores" },
      { name: "Gin", group: "Licores" },
    ];
    expect(searchBy("mezcladores tonic", rows, (row) => [row.name, row.group])).toEqual([rows[0]]);
  });
  it("gives every item, in the order given, when nothing is typed", () => {
    const textOf = vi.fn((drink: { name: string }) => drink.name);
    expect(searchBy("  ", drinks, textOf)).toEqual(drinks);
    expect(textOf).not.toHaveBeenCalled();
  });
  it("gives no item when only punctuation is typed", () => {
    expect(searchBy("&", drinks, (drink) => drink.name)).toEqual([]);
  });
});

describe("foldCache", () => {
  it("folds an item's text once while it is unchanged, and again once it changes", () => {
    const fold = foldCache<{ id: string }>();
    const item = { id: "a" };
    const first = fold(item, "Café");
    expect(first).toBe("cafe");
    const folding = vi.spyOn(String.prototype, "normalize");
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    expect(fold(item, "Café")).toBe(first);
    expect(folding).not.toHaveBeenCalled();
    expect(fold(item, "Té")).toBe("te");
    expect(folding).toHaveBeenCalledTimes(1);
  });
  it("keeps each item's text apart", () => {
    const fold = foldCache<{ id: string }>();
    expect(fold({ id: "a" }, "Café")).toBe("cafe");
    expect(fold({ id: "b" }, "Té")).toBe("te");
  });
});
