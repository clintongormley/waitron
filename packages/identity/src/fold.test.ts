/**
 * `foldForUniqueness` — the one form a display name or an address is compared in.
 *
 * Each case names the property rather than a value, and every one has its opposite beside it: a
 * fold that returned a constant would satisfy half of these, and a fold that returned its argument
 * unchanged would satisfy the other half.
 */
import { describe, expect, it } from "vitest";
import { foldForUniqueness } from "./fold.js";

describe("foldForUniqueness", () => {
  it("folds the case of an accented letter, which SQLite's own lower() does not", () => {
    expect(foldForUniqueness("JOSÉ GARCÍA")).toBe("josé garcía");
    expect(foldForUniqueness("BEGOÑA")).toBe("begoña");
    expect(foldForUniqueness("MARTÍN")).toBe("martín");
    expect(foldForUniqueness("NUÑO")).toBe("nuño");
  });

  it("folds the case of a plain letter", () => {
    expect(foldForUniqueness("ANA LOPEZ")).toBe("ana lopez");
  });

  it("brings the two spellings of one accent together", () => {
    // A precomposed é (U+00E9) and a plain e followed by a combining acute (U+0065 U+0301) render
    // identically and are different strings.
    expect(foldForUniqueness("José")).toBe(foldForUniqueness("José"));
    expect("José".toLowerCase()).not.toBe("José".toLowerCase());
  });

  it("strips the spaces around the value, matching the trim inside the index", () => {
    expect(foldForUniqueness("  Ada  ")).toBe("ada");
  });

  it("keeps an accent rather than stripping it", () => {
    // The control in the other direction. Lopez and López are two people.
    expect(foldForUniqueness("López")).not.toBe(foldForUniqueness("Lopez"));
  });

  it("keeps two different names apart", () => {
    // The other control: a fold that returned a constant would pass every case above.
    expect(foldForUniqueness("Ana")).not.toBe(foldForUniqueness("Anna"));
  });

  it("does not fold a dotted capital I the way Turkish would", () => {
    // Stated because the fold is STORED: `toLocaleLowerCase()` with no argument asks the running
    // process's default locale, so on a Turkish-locale machine it would write a different value
    // into the column for the same name. `toLowerCase` is the same everywhere.
    expect(foldForUniqueness("ISABEL")).toBe("isabel");
    expect("ISABEL".toLocaleLowerCase("tr")).toBe("ısabel");
  });
});
