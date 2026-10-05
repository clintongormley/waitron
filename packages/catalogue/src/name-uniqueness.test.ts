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
  const entry = (name: string, group: string | null, field = name) => ({ name, group, field });

  it("finds nothing among distinct names", () => {
    expect(firstNewClash([entry("A", "1"), entry("B", "2")])).toBeUndefined();
  });
  it("leaves a clash between two rows the write leaves alone", () => {
    expect(firstNewClash([entry("A", null), entry(" a ", null)])).toBeUndefined();
  });
  it("leaves a clash between two rows that arrive together from one place", () => {
    expect(firstNewClash([entry("A", "p"), entry("a", "p")])).toBeUndefined();
  });
  it("names the arriving entry when it meets a staying one before it", () => {
    expect(firstNewClash([entry("A", null, "old"), entry("a", "1", "new")])?.field).toBe("new");
  });
  it("names the arriving entry when it meets a staying one after it", () => {
    expect(firstNewClash([entry("A", "1", "new"), entry("a", null, "old")])?.field).toBe("new");
  });
  it("names the later of two arriving entries", () => {
    expect(firstNewClash([entry("A", "1", "first"), entry("a", "2", "second")])?.field).toBe(
      "second",
    );
  });
  it("finds an arriving entry clashing with the second of a staying pair", () => {
    expect(
      firstNewClash([entry("A", null), entry("a", null), entry("B", "1"), entry("A ", "2", "x")])
        ?.field,
    ).toBe("x");
  });
  it("finds a clash with a group arriving after two of another", () => {
    expect(
      firstNewClash([entry("A", "p", "p1"), entry("a", "p", "p2"), entry("A", "q", "q1")])?.field,
    ).toBe("q1");
  });
});
