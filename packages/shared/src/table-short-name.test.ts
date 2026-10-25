import { describe, expect, it } from "vitest";
import {
  proposeShortName,
  SHORT_NAME_MAX,
  shortNameKey,
  shortNameLength,
} from "./table-short-name.js";

describe("proposeShortName", () => {
  it.each([
    ["12", "12"],
    ["B2", "B2"],
    ["t1", "t1"],
    ["Bar", "Bar"],
    ["Window", "Win"],
    ["Patio", "Pat"],
    ["Terrace 1", "T1"],
    ["Top floor 12", "TF12"],
    ["Table12", "T12"],
    ["Window seat", "WS"],
    ["(VIP) 3", "V3"],
    ["Café 3", "C3"],
    ["Top floor 1234", "T1234"],
    ["The very long garden terrace 7", "TVLG7"],
    ["Room 123456", "23456"],
    ["-- --", "--"],
    ["Terrace 1A", "T1"],
    ["  terrace   7 ", "T7"],
    ["T1", "T1"],
    ["ß ß ß 7", "SSSS7"],
    ["éclair 2", "É2"],
    ["e\u0301clair 2", "\u00c92"],
    [" Bar ", "Bar"],
    ["B  2", "B 2"],
    ["-- 123", "123"],
  ])("proposes %s as %s", (label, expected) => {
    const proposed = proposeShortName(label);
    expect(proposed).toBe(expected);
    expect(shortNameLength(proposed)).toBeLessThanOrEqual(SHORT_NAME_MAX);
  });

  it("keeps a name of four characters or fewer exactly, and shortens one of five", () => {
    expect(proposeShortName("Bar 2")).toBe("B2");
    expect(proposeShortName("Bar2")).toBe("Bar2");
  });

  it("drops initials before digits, and keeps a long number's last five", () => {
    expect(proposeShortName("A B C D 12")).toBe("ABC12");
    expect(proposeShortName("A B 1234")).toBe("A1234");
    expect(proposeShortName("A 12345")).toBe("12345");
    expect(proposeShortName("A 123456")).toBe("23456");
  });

  it("counts a composed and a decomposed é as one character and one key", () => {
    expect(shortNameLength("e\u0301")).toBe(1);
    expect(shortNameKey("T\u00e9")).toBe(shortNameKey("Te\u0301"));
    expect(shortNameKey("T\u00e9")).toBe(shortNameKey("T\u00c9"));
  });

  it("folds case for the key, keeping the short name as given", () => {
    expect(shortNameKey("T1")).toBe("t1");
    expect(shortNameKey("t1")).toBe("t1");
  });
});

it("holds a short name to five characters", () => {
  expect(SHORT_NAME_MAX).toBe(5);
});
