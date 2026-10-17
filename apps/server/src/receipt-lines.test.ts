import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { groupByParent, ticketLinesFrom, withReceiptListPrices } from "./receipt-lines.js";

describe("groupByParent", () => {
  it("keeps a later added extra under its recorded parent instead of the intervening dish", () => {
    const first = { descriptions: { en: "First dish" }, quantity: "1", gross: "10.00" };
    const second = { descriptions: { en: "Second dish" }, quantity: "1", gross: "20.00" };
    const extra = {
      descriptions: { en: "First dish extra" },
      quantity: "1",
      gross: "4.00",
      parentLineNo: 1,
    };
    expect(groupByParent([first, second, extra])).toEqual([
      { dish: first, options: [extra] },
      { dish: second, options: [] },
    ]);
  });
  it("retains a leading orphan as a separate charged line", () => {
    const extra = {
      descriptions: { en: "Unmatched extra" },
      quantity: "1",
      gross: "4.00",
      parentLineNo: 99,
    };
    const dish = { descriptions: { en: "Dish" }, quantity: "1", gross: "10.00" };
    expect(groupByParent([extra, dish])).toEqual([
      { dish: extra, options: [] },
      { dish, options: [] },
    ]);
  });
});

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

  it("hands over the unit price before any discount exactly where it hands over the list total", () => {
    const [discounted, unchanged, unadjusted] = withReceiptListPrices(
      [filed("0.123", "2.66"), filed("1.000", "3.33"), filed("1.000", "3.00")],
      [decimal("24.00"), decimal("3.33"), null].map((listUnitGross) => ({ listUnitGross })),
    );

    expect(discounted).toMatchObject({ listGross: "2.95", listUnitPriceGross: "24.00" });
    expect(unchanged).not.toHaveProperty("listGross");
    expect(unchanged).not.toHaveProperty("listUnitPriceGross");
    expect(unadjusted).not.toHaveProperty("listGross");
    expect(unadjusted).not.toHaveProperty("listUnitPriceGross");
  });
  it("hands over both on a comped line charged nothing", () => {
    const [comped] = withReceiptListPrices(
      [filed("1.000", "0.00")],
      [{ listUnitGross: decimal("12.00") }],
    );

    expect(comped).toMatchObject({ listGross: "12.00", listUnitPriceGross: "12.00" });
  });

  it("hands over the price per price unit on a line priced by portions, its total scaled by them", () => {
    // 0.150 kg at €0.01 per 0.050 kg is €0.03 before the discount, charged €0.02.
    const [portioned] = withReceiptListPrices(
      [{ ...filed("0.150", "0.02"), priceQuantity: "0.050" }],
      [{ listUnitGross: decimal("0.01") }],
    );

    expect(portioned).toMatchObject({ listGross: "0.03", listUnitPriceGross: "0.01" });
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

  it("gives the screen and the simplified receipt the list total but not the unit price behind it", () => {
    const [line] = ticketLinesFrom({ lines: [filed("0.123", "2.66")] }, [
      { listUnitGross: decimal("24.00") },
    ]);

    expect(line).toMatchObject({ listGross: "2.95" });
    expect(line).not.toHaveProperty("listUnitPriceGross");
  });
});
