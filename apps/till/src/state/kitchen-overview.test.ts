import { describe, expect, it } from "vitest";
import {
  dishThousandths,
  overviewRows,
  rowsToMake,
  type OverviewDish,
  type OverviewRow,
} from "./kitchen-overview.js";

const making = (name: string, thousandths = 1000): OverviewDish => ({
  name,
  thousandths,
  stage: "making",
});
const held = (name: string, thousandths = 1000): OverviewDish => ({
  name,
  thousandths,
  stage: "held",
});

describe("the kitchen Overview's counts", () => {
  it("one row per name, making and held apart", () => {
    expect(
      overviewRows([making("Pork shoulder"), held("Pork shoulder", 2000), making("Sirloin")]),
    ).toEqual([
      { name: "Pork shoulder", making: 1000, held: 2000 },
      { name: "Sirloin", making: 1000, held: 0 },
    ]);
  });

  it("rows with something to make come first, each group in first-appearance order", () => {
    const rows = overviewRows([
      held("Rib steak"),
      making("Spicy potatoes"),
      held("Pork shoulder"),
      making("Pork shoulder"),
      making("Sirloin"),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      "Spicy potatoes",
      "Pork shoulder",
      "Sirloin",
      "Rib steak",
    ]);
  });

  it("a held dish counts as its name's first appearance", () => {
    const rows = overviewRows([held("A"), making("B"), making("A")]);
    expect(rows.map((row) => row.name)).toEqual(["A", "B"]);
  });

  it("the same name with different quantities adds up exactly", () => {
    expect(overviewRows([making("Burger", 1500), making("Burger", 1000)])).toEqual([
      { name: "Burger", making: 2500, held: 0 },
    ]);
  });

  it("no dishes, no rows; a dish of 0 thousandths makes no row", () => {
    expect(overviewRows([])).toEqual([]);
    expect(overviewRows([making("Sirloin", 0), held("Rib steak", 0)])).toEqual([]);
  });

  it("rowsToMake counts the rows with something to make", () => {
    const rows: OverviewRow[] = [
      { name: "Sirloin", making: 1000, held: 0 },
      { name: "Burger", making: 1000, held: 0 },
      { name: "Spicy potatoes", making: 3000, held: 1000 },
      { name: "Pork shoulder", making: 1000, held: 2000 },
      { name: "Rib steak", making: 0, held: 1000 },
    ];
    expect(rowsToMake(rows)).toBe(4);
  });

  it.each([
    ["a plain quantity", "2.000", undefined, undefined, 2000],
    ["a fraction stays exact", "1.500", null, undefined, 1500],
    ["a dish whose unit shows counts one", "0.350", { en: "kg" }, undefined, 1000],
    ["sold in Each counts by quantity", "3.000", { en: "each" }, true, 3000],
  ] as const)("dishThousandths: %s", (_label, quantity, unitName, soldInEach, expected) => {
    expect(dishThousandths(quantity, unitName, soldInEach)).toBe(expected);
  });

  it("does not change its input", () => {
    const dishes = Object.freeze([
      Object.freeze(making("Sirloin")),
      Object.freeze(held("Sirloin", 2000)),
      Object.freeze(held("Rib steak")),
    ]);
    expect(overviewRows(dishes)).toEqual([
      { name: "Sirloin", making: 1000, held: 2000 },
      { name: "Rib steak", making: 0, held: 1000 },
    ]);
    expect(dishes.map((dish) => ({ ...dish }))).toEqual([
      making("Sirloin"),
      held("Sirloin", 2000),
      held("Rib steak"),
    ]);
  });
});
