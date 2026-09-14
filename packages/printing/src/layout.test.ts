import { describe, expect, it } from "vitest";
import {
  chooseQrDots,
  columnsFor,
  dpiValue,
  labelAmountLines,
  safeWidthDots,
  withQuietZone,
  wrapText,
} from "./layout.js";

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

  it("caps the first-line indent when it exceeds the column count", () => {
    expect(wrapText("      abc", 3)).toEqual(["  a", "bc"]);
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
    expect(labelAmountLines("Invoice", "ORDER-REFERENCE-2026/000123", 20)).toEqual([
      "Invoice",
      "ORDER-REFERENCE-2026",
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

  it("drops the amount to its own line when label and amount fill the row exactly", () => {
    expect(labelAmountLines("12345", "12345", 10)).toEqual(["12345", "     12345"]);
  });
});

const mm = (squares: number, dots: number, dpi: number): number => (squares * dots * 25.4) / dpi;

describe("chooseQrDots", () => {
  it("chooses the dot size closest to 35 mm within 30-40 mm (measured cases)", () => {
    expect(chooseQrDots(41, 180, 504)).toBe(6); // 34.7 mm
    expect(chooseQrDots(41, 203, 504)).toBe(7); // 35.9 mm
    expect(chooseQrDots(45, 180, 504)).toBe(6); // 38.1 mm (5 dots: 31.75, further from 35)
    expect(chooseQrDots(45, 203, 504)).toBe(6); // 33.8 mm
    expect(chooseQrDots(49, 180, 504)).toBe(5); // 34.6 mm (6 dots: 41.5, over 40)
    expect(chooseQrDots(49, 203, 504)).toBe(6); // 36.8 mm
    expect(chooseQrDots(53, 203, 504)).toBe(5); // 33.2 mm (6 dots: 39.8, further from 35)
    expect(chooseQrDots(65, 180, 360)).toBe(4); // 36.7 mm (5 dots: 45.9 mm, over 40)
    expect(chooseQrDots(25, 203, 360)).toBe(10); // 31.3 mm; 330 dots, without border would pick 11
  });

  it("keeps every grid size 37-77 within 30-40 mm at both resolutions and both widths", () => {
    for (let squares = 37; squares <= 77; squares++) {
      for (const dpi of [180, 203]) {
        for (const width of [360, 504]) {
          const dots = chooseQrDots(squares, dpi, width);
          const label = `${squares} squares, ${dpi} dpi, ${width} dots`;
          expect(mm(squares, dots, dpi), label).toBeGreaterThanOrEqual(30);
          expect(mm(squares, dots, dpi), label).toBeLessThanOrEqual(40);
          expect((squares + 8) * dots, label).toBeLessThanOrEqual(width);
          for (let other = 1; (squares + 8) * other <= width; other++) {
            const size = mm(squares, other, dpi);
            if (size >= 30 && size <= 40) {
              expect(Math.abs(size - 35), label).toBeGreaterThanOrEqual(
                Math.abs(mm(squares, dots, dpi) - 35) - 1e-9,
              );
            }
          }
        }
      }
    }
  });

  it("takes the smaller dot size on a tie", () => {
    // 50 squares at 127 dpi: 3 dots = 30 mm and 4 dots = 40 mm, both 5 mm from 35.
    expect(chooseQrDots(50, 127, 504)).toBe(3);
  });

  it("falls back without throwing when no size is legal", () => {
    expect(chooseQrDots(177, 180, 360)).toBe(1); // 25 mm, the only size that fits
    expect(chooseQrDots(400, 180, 360)).toBe(1); // nothing fits
  });
});

describe("withQuietZone", () => {
  it("pads a matrix with light modules on every side", () => {
    expect(
      withQuietZone(
        [
          [true, false],
          [false, true],
        ],
        1,
      ),
    ).toEqual([
      [false, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, false],
    ]);
  });
});
