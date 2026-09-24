/**
 * Every case has its opposite beside it: a fold that returned a constant would satisfy half of
 * these, and a fold that returned its argument unchanged would satisfy the other half.
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
    // A plain e followed by a combining acute (U+0065 U+0301), and a precomposed é (U+00E9).
    expect(foldForUniqueness("José")).toBe(foldForUniqueness("José"));
    expect("José".toLowerCase()).not.toBe("José".toLowerCase());
  });

  it("strips the spaces around the value, matching the trim inside the index", () => {
    expect(foldForUniqueness("  Ada  ")).toBe("ada");
  });

  it("keeps an accent rather than stripping it", () => {
    expect(foldForUniqueness("López")).not.toBe(foldForUniqueness("Lopez"));
  });

  it("keeps two different names apart", () => {
    expect(foldForUniqueness("Ana")).not.toBe(foldForUniqueness("Anna"));
  });

  it("does not fold a dotted capital I the way Turkish would", () => {
    // The fold is STORED, so it must not depend on the running process's locale.
    expect(foldForUniqueness("ISABEL")).toBe("isabel");
    expect("ISABEL".toLocaleLowerCase("tr")).toBe("ısabel");
  });
});
