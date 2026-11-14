import { describe, expect, it } from "vitest";
import { firstNewClash, foldName } from "./name-uniqueness.js";

describe("foldName", () => {
  it("folds a non-ASCII case pair and surrounding whitespace to one form", () => {
    expect(foldName("  Ñoquis\t")).toBe(foldName("ñoquis"));
  });
  it("brings a precomposed and a combining accent together", () => {
    expect(foldName("Café")).toBe(foldName("CAFÉ"));
  });
  it("keeps interior whitespace and accents apart", () => {
    expect(foldName("Café solo")).not.toBe(foldName("Café  solo"));
    expect(foldName("Cafe")).not.toBe(foldName("Café"));
  });
});

describe("firstNewClash", () => {
  const entry = (name: string, changed: boolean, field = name) => ({ name, changed, field });

  it("finds nothing among distinct names", () => {
    expect(firstNewClash([entry("A", true), entry("B", true)])).toBeUndefined();
  });
  it("leaves a clash between two rows the write leaves alone", () => {
    expect(firstNewClash([entry("A", false), entry(" a ", false)])).toBeUndefined();
  });
  it("names the changed entry when it meets an unchanged one before it", () => {
    expect(firstNewClash([entry("A", false, "old"), entry("a", true, "new")])?.field).toBe("new");
  });
  it("names the changed entry when it meets an unchanged one after it", () => {
    expect(firstNewClash([entry("A", true, "new"), entry("a", false, "old")])?.field).toBe("new");
  });
  it("names the later of two changed entries", () => {
    expect(firstNewClash([entry("A", true, "first"), entry("a", true, "second")])?.field).toBe(
      "second",
    );
  });
  it("finds a changed entry clashing with the second of an unchanged pair", () => {
    expect(
      firstNewClash([
        entry("A", false),
        entry("a", false),
        entry("B", true),
        entry("A ", true, "x"),
      ])?.field,
    ).toBe("x");
  });
});
