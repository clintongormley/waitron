import { describe, expect, it } from "vitest";
import { taxTableLines, type TaxTableRow } from "./receipt-tax-table.js";

const HEADER: TaxTableRow = { rate: "Tipo", base: "Base", tax: "IVA", total: "Total" };

describe("taxTableLines", () => {
  it("right-aligns three amount columns after the rate", () => {
    const lines = taxTableLines(
      HEADER,
      [{ rate: "10%", base: "24,09", tax: "2,41", total: "26,50" }],
      42,
    );
    expect(lines).toEqual([
      { text: "Tipo         Base         IVA        Total", header: true },
      { text: "10%         24,09        2,41        26,50", header: false },
    ]);
  });

  it("fits 32 columns with two rates and four-figure amounts", () => {
    const lines = taxTableLines(
      HEADER,
      [
        { rate: "A 10%", base: "1234,56", tax: "123,46", total: "1358,02" },
        { rate: "B 21%", base: "1000,00", tax: "210,00", total: "1210,00" },
      ],
      32,
    );
    expect(lines.map(({ text }) => text)).toEqual([
      "Tipo       Base     IVA    Total",
      "A 10%   1234,56  123,46  1358,02",
      "B 21%   1000,00  210,00  1210,00",
    ]);
    for (const { text } of lines) expect(text.length).toBeLessThanOrEqual(32);
  });
});
