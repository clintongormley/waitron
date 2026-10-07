import { expect, it } from "vitest";
import { compareLabels } from "./compare-labels.js";

it.each([",", "."])("orders decimal weights by value with a %s separator", (separator) => {
  const names = [`0${separator}5 kg`, `1${separator}2 kg`, `0${separator}25 kg`];
  expect(names.sort(compareLabels)).toEqual([
    `0${separator}25 kg`,
    `0${separator}5 kg`,
    `1${separator}2 kg`,
  ]);
});

it.each([",", "."])(
  "compares mixed names containing several numbers with %s decimals",
  (separator) => {
    expect(
      [
        `Pack 10 / 0${separator}25 kg`,
        `Pack 2 / 0${separator}5 kg`,
        `Pack 2 / 0${separator}25 kg`,
      ].sort(compareLabels),
    ).toEqual([
      `Pack 2 / 0${separator}25 kg`,
      `Pack 2 / 0${separator}5 kg`,
      `Pack 10 / 0${separator}25 kg`,
    ]);
  },
);

it("keeps integer names in number order and text insensitive to case and accents", () => {
  expect(["Table 10", "Table 2", "Table 1"].sort(compareLabels)).toEqual([
    "Table 1",
    "Table 2",
    "Table 10",
  ]);
  expect(compareLabels("CAFÉ", "cafe")).toBe(0);
  expect(compareLabels("", "")).toBe(0);
  expect(compareLabels("", "Table 2")).toBeLessThan(0);
  expect(compareLabels("Table 2", "")).toBeGreaterThan(0);
});

it("preserves punctuation order when one name's text run is a prefix of another", () => {
  expect(["Menu 2", "Menu (old)", "Menu 10"].sort(compareLabels)).toEqual([
    "Menu (old)",
    "Menu 2",
    "Menu 10",
  ]);
  expect(compareLabels("Pack 0.50 Menu 2", "Pack 0,5 Menu (old)")).toBeGreaterThan(0);
  expect(compareLabels("Pack 0,5 Menu (old)", "Pack 0.50 Menu 2")).toBeLessThan(0);
});

it("compares equal decimal values by the remaining text, including leading and trailing zeros", () => {
  expect(compareLabels("Pack 00,50 A", "Pack 0.5 B")).toBeLessThan(0);
  expect(compareLabels("Pack 00,50", "Pack 0.5")).toBe(0);
  expect(compareLabels("Pack 2", "Pack 2.0")).toBe(0);
  expect(compareLabels("Pack 2.5", "Pack 2.5 kg")).toBeLessThan(0);
});

it("keeps decimal differences smaller than floating-point precision in the name order", () => {
  expect(compareLabels("0.10000000000000001 kg", "0,10000000000000002 kg")).toBeLessThan(0);
  expect(compareLabels("9007199254740993.0 kg", "9007199254740992,9 kg")).toBeGreaterThan(0);
});

it("reads dotted version and address names as decimal runs without special numbering rules", () => {
  expect(["v2.9.0", "v2.10.0"].sort(compareLabels)).toEqual(["v2.10.0", "v2.9.0"]);
  expect(
    ["Printer 192.168.1.9", "Printer 192.168.1.20", "Printer 192.168.1.100"].sort(compareLabels),
  ).toEqual(["Printer 192.168.1.100", "Printer 192.168.1.20", "Printer 192.168.1.9"]);
});
