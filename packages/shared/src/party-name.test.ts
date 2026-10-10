import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  PARTY_NAME_MAX,
  normalisePartyName,
  partyDisplayName,
  partyReceiptLabel,
  partyTablesName,
} from "./party-name.js";

describe("partyTablesName", () => {
  it.each([
    [["Table 4"], "Table 4"],
    [["Table 4", "Table 5", "Table 7"], "Table 4, 5, 7"],
    [["Table 7", "Table 4"], "Table 7, 4"],
    [["Table 4", "Terrace 2"], "Table 4, Terrace 2"],
    [["Table 4", "Table 5", "Terrace 2"], "Table 4, Table 5, Terrace 2"],
    [["12", "14"], "12, 14"],
    [["Bar", "Bar 2"], "Bar, Bar 2"],
    [[" 4", " 5"], " 4,  5"],
    [[], ""],
  ])("names %j as %s", (labels, expected) => {
    expect(partyTablesName(labels)).toBe(expected);
  });

  it("joins with the separator it is given", () => {
    expect(partyTablesName(["Terrace 4", "Terrace 5", "Terrace 7"], "+")).toBe("Terrace 4+5+7");
    expect(partyTablesName(["4", "10"], "+")).toBe("4+10");
    expect(partyTablesName(["Bar 1", "Stool 2"], "+")).toBe("Bar 1+Stool 2");
  });
});

describe("partyDisplayName and partyReceiptLabel", () => {
  it("prefer the party's own name, and add the tables on a receipt", () => {
    expect(partyDisplayName("Ana", ["Table 4", "Table 5"])).toBe("Ana");
    expect(partyDisplayName(null, ["Table 4", "Table 5"])).toBe("Table 4, 5");
    expect(partyReceiptLabel("Ana", ["Table 4", "Table 5"])).toBe("Ana · Table 4, 5");
    expect(partyReceiptLabel(null, ["Table 4"])).toBe("Table 4");
  });
});

describe("normalisePartyName", () => {
  it("trims, and stores an empty name as none", () => {
    expect(normalisePartyName("  Ana ")).toBe("Ana");
    expect(normalisePartyName("   ")).toBeNull();
    expect(normalisePartyName(null)).toBeNull();
    expect(normalisePartyName(undefined)).toBeNull();
  });

  it("refuses a name longer than the limit, or one that is not text", () => {
    for (const bad of ["x".repeat(PARTY_NAME_MAX + 1), 7, {}]) {
      let caught: unknown;
      try {
        normalisePartyName(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe("management.request_invalid");
      expect((caught as AppError).params).toEqual({ field: "name" });
    }
    expect(normalisePartyName("x".repeat(PARTY_NAME_MAX))).toHaveLength(PARTY_NAME_MAX);
  });
});
