import { describe, expect, it } from "vitest";
import { columnsFor, dpiValue, labelAmountLines, safeWidthDots, wrapText } from "./layout.js";

describe("settings mapping", () => {
  it("maps paper width to columns and dots, resolution to dpi", () => {
    expect(columnsFor("58mm")).toBe(30);
    expect(columnsFor("80mm")).toBe(42);
    expect(safeWidthDots("58mm")).toBe(360);
    expect(safeWidthDots("80mm")).toBe(504);
    expect(dpiValue("180dpi")).toBe(180);
    expect(dpiValue("203dpi")).toBe(203);
  });
});

describe("wrapText", () => {
  it("keeps a line of exactly the column count on one line", () => {
    expect(wrapText("x".repeat(30), 30)).toEqual(["x".repeat(30)]);
    expect(wrapText("aaaa bbbb cccc dddd eeee fff g", 30)).toEqual([
      "aaaa bbbb cccc dddd eeee fff g",
    ]);
  });

  it("wraps at spaces and indents continuation lines", () => {
    expect(wrapText("Tostada con tomate y jamon iberico", 20, 2)).toEqual([
      "Tostada con tomate y",
      "  jamon iberico",
    ]);
  });

  it("splits a single word longer than the line", () => {
    expect(wrapText("y".repeat(25), 10)).toEqual(["y".repeat(10), "y".repeat(10), "y".repeat(5)]);
  });

  it.each([30, 42])("keeps the leading-space indent of sub-lines at %i columns", (columns) => {
    expect(wrapText("  + Grande", columns, 4)).toEqual(["  + Grande"]);
    expect(wrapText("  Extra queso", columns, 2)).toEqual(["  Extra queso"]);
    expect(wrapText("  * sin sal muy hecho", columns, 4)).toEqual(["  * sin sal muy hecho"]);
  });

  it("indents the continuation of a sub-line under its text", () => {
    expect(wrapText("  + Salsa de setas silvestres con trufa negra", 30, 4)).toEqual([
      "  + Salsa de setas silvestres",
      "    con trufa negra",
    ]);
  });

  it("never lets a word that follows a break overrun the indented line", () => {
    expect(wrapText("ab cdefghijk", 10, 2)).toEqual(["ab", "  cdefghij", "  k"]);
    expect(wrapText(`1  ${"x".repeat(28)}`, 30, 3)).toEqual(["1", `   ${"x".repeat(27)}`, "   x"]);
  });

  it("keeps runs of spaces inside a line and drops spaces at a break", () => {
    expect(wrapText("1  Cafe", 30)).toEqual(["1  Cafe"]);
    expect(wrapText("abc   def", 5)).toEqual(["abc", "def"]);
    expect(wrapText("abc ", 3)).toEqual(["abc"]);
  });

  it("returns one empty line for empty text and terminates when the indent fills the line", () => {
    expect(wrapText("", 30)).toEqual([""]);
    expect(wrapText("aaaa bbbb", 4, 9)).toEqual(["aaaa", "   b", "   b", "   b", "   b"]);
  });

  it("never returns a line longer than the column count", () => {
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let trial = 0; trial < 2000; trial++) {
      const columns = 5 + next(40);
      const words = Array.from({ length: 1 + next(12) }, () => "w".repeat(next(columns + 6)));
      const text = " ".repeat(next(4)) + words.join(" ".repeat(1 + next(2)));
      const indent = next(6);
      for (const l of wrapText(text, columns, indent))
        expect(l.length).toBeLessThanOrEqual(columns);
      for (const l of labelAmountLines(text, "w".repeat(next(columns + 10)), columns, indent)) {
        expect(l.length).toBeLessThanOrEqual(columns);
      }
    }
  });
});

describe("labelAmountLines", () => {
  it("puts the amount at the right of the last line when it fits", () => {
    expect(labelAmountLines("1  Cafe con leche", "1,80 EUR", 30)).toEqual([
      "1  Cafe con leche     1,80 EUR",
    ]);
  });

  it("drops the amount to its own right-aligned line when the label leaves no space", () => {
    expect(labelAmountLines("x".repeat(28), "1,80 EUR", 30)).toEqual([
      "x".repeat(28),
      " ".repeat(22) + "1,80 EUR",
    ]);
  });

  it("indents an item's continuation under its product name", () => {
    expect(
      labelAmountLines("1  Tostada con tomate y jamón ibérico de bellota", "12,50 €", 30, 3),
    ).toEqual(["1  Tostada con tomate y jamón", "   ibérico de bellota  12,50 €"]);
  });

  it.each([30, 42])("keeps an option's leading indent at %i columns", (columns) => {
    const [line] = labelAmountLines("  Extra queso ×2", "1,50 €", columns, 2);
    expect(line).toBe("  Extra queso ×2" + " ".repeat(columns - 22) + "1,50 €");
  });

  it("wraps an amount wider than the paper onto right-aligned lines of its own", () => {
    expect(labelAmountLines("Factura", "SERIE-MUY-LARGA-2026/000123", 20)).toEqual([
      "Factura",
      "SERIE-MUY-LARGA-2026",
      "             /000123",
    ]);
    expect(labelAmountLines("TOTAL", "-123.456.789.012,34 EUR", 20)).toEqual([
      "TOTAL",
      " -123.456.789.012,34",
      "                 EUR",
    ]);
  });

  it("right-aligns an amount with an empty label", () => {
    expect(labelAmountLines("", "1,00 €", 10)).toEqual(["    1,00 €"]);
  });
});
