import { describe, expect, it } from "vitest";
import { capitaliseFirst } from "./capitalise.js";

describe("capitaliseFirst", () => {
  it("capitalises a lower-case Spanish language name and leaves the rest of it alone", () => {
    expect(capitaliseFirst("inglés", "es-ES")).toBe("Inglés");
    expect(capitaliseFirst("inglés antiguo", "es-ES")).toBe("Inglés antiguo");
  });

  it("capitalises an accented first letter", () => {
    expect(capitaliseFirst("árabe", "es-ES")).toBe("Árabe");
  });

  it("leaves a name that already starts with a capital as it is", () => {
    expect(capitaliseFirst("English", "en-GB")).toBe("English");
    expect(capitaliseFirst("ÁRABE", "es-ES")).toBe("ÁRABE");
  });

  it("returns an empty string unchanged", () => {
    expect(capitaliseFirst("", "es-ES")).toBe("");
  });

  it("uses the display language's own upper case", () => {
    expect(capitaliseFirst("istanbul", "tr")).toBe("İstanbul");
    expect(capitaliseFirst("istanbul", "en-GB")).toBe("Istanbul");
  });

  it("capitalises a first letter written as two UTF-16 units", () => {
    expect(capitaliseFirst("\u{10428}x", "en-GB")).toBe("\u{10400}x");
  });
});
