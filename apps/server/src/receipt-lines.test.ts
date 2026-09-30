import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { ticketLinesFrom } from "./receipt-lines.js";

// The receipt's line list, projected from the lines a sale filed (ruling R13's list prices).
function filed(quantity: string, lineGross: string) {
  return {
    descriptions: { "es-ES": "Merluza" },
    variantDescriptions: null,
    variantName: null,
    optionSnapshots: [],
    quantity,
    unitName: null,
    unitPrecision: 3,
    lineGross: decimal(lineGross),
    parentLineNo: null,
  };
}

describe("ticketLinesFrom", () => {
  it("carries a line's total at its list price only where a comp or a discount changed it", () => {
    const lines = ticketLinesFrom(
      { lines: [filed("1.000", "3.00"), filed("1.000", "3.33"), filed("2.500", "29.23")] },
      [null, decimal("3.33"), decimal("12.99")],
    );

    expect(lines.map((line) => [line.gross, line.listGross])).toEqual([
      ["3.00", undefined],
      ["3.33", undefined],
      // 2.5 kg at €12.99 is €32.475, rounded as a line total is.
      ["29.23", "32.48"],
    ]);
    expect(lines.map((line) => Object.hasOwn(line, "listGross"))).toEqual([false, false, true]);
  });

  it("refuses list prices that do not line up with the lines", () => {
    expect(() => ticketLinesFrom({ lines: [filed("1.000", "3.00")] }, [])).toThrow(
      "ticketLinesFrom: 0 list prices for 1 lines",
    );
  });
});
