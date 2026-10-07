import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { ticketLinesFrom, withReceiptListPrices } from "./receipt-lines.js";

// The receipt's line list, projected from the lines a sale filed (ruling R13's list prices).
function filed(quantity: string, lineGross: string) {
  return {
    lineNo: 1,
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

describe("withReceiptListPrices", () => {
  it("snapshots weighted and portion-priced list totals while leaving unadjusted lines absent", () => {
    const lines = [
      filed("1.000", "3.00"),
      filed("2.500", "29.23"),
      { ...filed("0.150", "0.02"), priceQuantity: "0.050" },
    ];
    const saved = withReceiptListPrices(
      lines,
      [null, decimal("12.99"), decimal("0.01")].map((listUnitGross) => ({ listUnitGross })),
    );
    expect(saved.map((line) => line.listGross)).toEqual([undefined, "32.48", "0.03"]);
    expect(saved.map((line) => line.lineGross)).toEqual(["3.00", "29.23", "0.02"]);
  });
});

describe("ticketLinesFrom", () => {
  it("joins frozen parent and relative variant names without consulting live names", () => {
    const lines = ticketLinesFrom(
      {
        lines: [
          {
            ...filed("1.000", "2.00"),
            descriptions: { en: "Customer gin", es: "Ginebra cliente" },
            variantDescriptions: { en: "Customer single", es: "Copa cliente" },
            variantName: "Single",
          },
        ],
      },
      [{ listUnitGross: null }],
    );
    expect(lines[0]!.descriptions).toEqual({
      en: "Customer gin (Customer single)",
      es: "Ginebra cliente (Copa cliente)",
    });
  });
  it("keeps a weighted extra's filed thousandths for the amount printed beneath its dish", () => {
    const dish = filed("1.000", "2.00");
    const child = {
      ...filed("0.150", "0.03"),
      descriptions: { "es-ES": "Jamón" },
      unitName: { es: "kg" },
      parentLineNo: 1,
    };
    const lines = ticketLinesFrom({ lines: [dish, child] }, [
      { listUnitGross: null },
      { listUnitGross: null },
    ]);

    expect(lines[1]).toMatchObject({ quantity: "0.150", unitName: { es: "kg" } });
  });

  it("prints a whole-unit extra without thousandths", () => {
    const child = {
      ...filed("3.000", "0.90"),
      descriptions: { "es-ES": "Aceitunas" },
      unitName: { es: "ud" },
      unitPrecision: 0,
      parentLineNo: 1,
    };
    const lines = ticketLinesFrom({ lines: [filed("1.000", "2.00"), child] }, [
      { listUnitGross: null },
      { listUnitGross: null },
    ]);

    expect(lines[1]).toMatchObject({ quantity: "3", unitName: { es: "ud" } });
  });

  it("carries a line's total at its list price only where a comp or a discount changed it", () => {
    const lines = ticketLinesFrom(
      { lines: [filed("1.000", "3.00"), filed("1.000", "3.33"), filed("2.500", "29.23")] },
      [null, decimal("3.33"), decimal("12.99")].map((listUnitGross) => ({ listUnitGross })),
    );

    expect(lines.map((line) => [line.gross, line.listGross])).toEqual([
      ["3.00", undefined],
      ["3.33", undefined],
      // 2.5 kg at €12.99 is €32.475, rounded as a line total is.
      ["29.23", "32.48"],
    ]);
    expect(lines.map((line) => Object.hasOwn(line, "listGross"))).toEqual([false, false, true]);
  });

  it("shows the list total for a discounted extra priced by frozen portions", () => {
    const child = {
      ...filed("0.150", "0.02"),
      descriptions: { "es-ES": "Jamón" },
      unitName: { "es-ES": "kg" },
      priceQuantity: "0.050",
      parentLineNo: 1,
    };
    const [line] = ticketLinesFrom({ lines: [child] }, [{ listUnitGross: decimal("0.01") }]);

    expect(line).toMatchObject({ quantity: "0.150", gross: "0.02", listGross: "0.03" });
  });
});
