import { describe, expect, it } from "vitest";
import { GLYPHS } from "./glyphs.js";
import { glyphRows, prepareText } from "./text.js";

describe("prepareText", () => {
  it("keeps every character the glyph table draws", () => {
    for (const [codePoint] of GLYPHS) {
      const ch = String.fromCodePoint(codePoint);
      expect(prepareText(ch)).toBe(ch);
    }
    expect(prepareText("Café 5 € ñÑ ¿¡ “ok” – … œ Ÿ ő")).toBe("Café 5 € ñÑ ¿¡ “ok” – … œ Ÿ ő");
  });

  it("composes accents first, so a decomposed é prints as one character", () => {
    expect(prepareText("Cafe\u0301")).toBe("Café");
  });

  it("turns every control character into a space", () => {
    expect(prepareText("a\tb\nc\u001bd\u007fe")).toBe("a b c d e");
  });

  it("uses a fixed replacement for a character the table lacks", () => {
    expect(prepareText("5\u202f€")).toBe("5 €");
  });

  it("drops the accents of a character the table lacks when what is left prints", () => {
    expect(prepareText("ș")).toBe("s");
  });

  it("prints ? when neither the character nor its unaccented form is in the table", () => {
    expect(prepareText("日本")).toBe("??");
    expect(prepareText("🍕")).toBe("?");
    // Greek alpha with psili: without its accent it is still a letter the table lacks.
    expect(prepareText("\u1f00")).toBe("?");
    // A combining accent with nothing to sit on leaves nothing once accents are dropped.
    expect(prepareText(" \u0301")).toBe(" ?");
  });
});

describe("glyphRows", () => {
  it("gives the 28 rows of a character in the table and nothing for one outside it", () => {
    expect(glyphRows(" ")).toEqual(new Array(28).fill(0));
    expect(glyphRows("!")).toHaveLength(28);
    expect(glyphRows("日")).toBeUndefined();
  });
});
