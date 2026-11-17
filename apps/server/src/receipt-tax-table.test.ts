import { receiptLabelsFor } from "@waitron/country-packs";
import { gridForWidth, SETTING_WIDTHS } from "@waitron/printing";
import { describe, expect, it } from "vitest";
import { formatAmount, formatVatRate } from "./receipt-money.js";
import { taxTableLines, type TaxTableRow } from "./receipt-tax-table.js";

const HEADER: TaxTableRow = { rate: "Tipo", base: "Base", tax: "IVA", total: "Total" };

/** The text grid's column counts of every printer setting: 30 on 58 mm, 42 on 80 mm. */
const ROLL_COLUMNS = [
  ...new Set(SETTING_WIDTHS.map(({ widthDots }) => gridForWidth(widthDots).columns)),
];

describe("taxTableLines", () => {
  it("prints for 30 and 42 columns, the two rolls' widths", () => {
    expect(ROLL_COLUMNS).toEqual([30, 42]);
  });

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

  it("fits 30 columns with two rates and four-figure amounts on one row each", () => {
    const lines = taxTableLines(
      HEADER,
      [
        { rate: "A 10%", base: "1234,56", tax: "123,46", total: "1358,02" },
        { rate: "B 21%", base: "1000,00", tax: "210,00", total: "1210,00" },
      ],
      30,
    );
    expect(lines.map(({ text }) => text)).toEqual([
      "Tipo       Base    IVA   Total",
      "A 10%   1234,56 123,46 1358,02",
      "B 21%   1000,00 210,00 1210,00",
    ]);
  });

  const REFUND: TaxTableRow[] = [
    { rate: "A 10%", base: "-2727,27", tax: "-272,73", total: "-3000,00" },
    { rate: "B 21%", base: "-2479,34", tax: "-520,66", total: "-3000,00" },
  ];

  it("puts each rate on its own line above its amounts when a row does not fit 30 columns", () => {
    const lines = taxTableLines(HEADER, REFUND, 30);
    expect(lines).toEqual([
      { text: "Tipo", header: true },
      { text: "       Base      IVA     Total", header: true },
      { text: "A 10%", header: false },
      { text: "   -2727,27  -272,73  -3000,00", header: false },
      { text: "B 21%", header: false },
      { text: "   -2479,34  -520,66  -3000,00", header: false },
    ]);
  });

  it("keeps the one-row layout on 42 columns for the same refund", () => {
    const lines = taxTableLines(HEADER, REFUND, 42);
    expect(lines).toHaveLength(3);
    expect(lines[1]!.text).toBe("A 10%      -2727,27    -272,73    -3000,00");
  });

  it("puts each figure on its own line beside its heading when even the amounts do not fit", () => {
    const lines = taxTableLines(
      HEADER,
      [{ rate: "A 10%", base: "-12.345,67", tax: "-1.234,57", total: "-13.580,24" }],
      30,
    );
    expect(lines).toEqual([
      { text: "A 10%", header: false },
      { text: `${"Base".padEnd(20)}-12.345,67`, header: false },
      { text: `${"IVA".padEnd(21)}-1.234,57`, header: false },
      { text: `${"Total".padEnd(20)}-13.580,24`, header: false },
    ]);
  });

  it("leaves two spaces between amounts that hold a space themselves", () => {
    const lines = taxTableLines(
      { rate: "Tipo", base: "Base", tax: "IVE", total: "Total" },
      [{ rate: "A 10%", base: "1 234,56", tax: "123,46", total: "1 358,02" }],
      30,
    );
    expect(lines.map(({ text }) => text)).toContain("    1 234,56  123,46  1 358,02");
  });

  it("keeps two spaces between such amounts when they nearly fill the line on their own", () => {
    const lines = taxTableLines(
      { rate: "Tipo", base: "Base", tax: "IVE", total: "Total" },
      [{ rate: "21%", base: "-4 132,23", tax: "-867,77", total: "-5 000,00" }],
      30,
    );
    expect(lines.map(({ text }) => text)).toContain(" -4 132,23  -867,77  -5 000,00");
  });

  describe.each(["en-GB", "es-ES", "ca-ES", "gl-ES", "eu-ES"])("in %s", (locale) => {
    const labels = receiptLabelsFor(locale);
    const header: TaxTableRow = {
      rate: labels.taxRateColumn,
      base: labels.taxBaseColumn,
      tax: labels.taxAmountColumn,
      total: labels.taxTotalColumn,
    };
    const row = (letter: string, rate: string, base: string, tax: string, total: string) => ({
      rate: `${letter} ${formatVatRate(rate, locale)}`,
      base: formatAmount(base, locale),
      tax: formatAmount(tax, locale),
      total: formatAmount(total, locale),
    });
    const refund = [
      row("A", "10", "-2727.27", "-272.73", "-3000.00"),
      row("B", "21", "-2479.34", "-520.66", "-3000.00"),
    ];

    it.each(ROLL_COLUMNS)(
      "keeps a mixed-rate refund of 3,000 a rate inside %i columns, every cell whole",
      (columns) => {
        const lines = taxTableLines(header, refund, columns);
        for (const { text } of lines) expect(text.length).toBeLessThanOrEqual(columns);
        for (const cell of [header, ...refund].flatMap((each) => Object.values(each))) {
          expect(
            lines.some(({ text }) => ` ${text} `.includes(` ${cell} `)),
            cell,
          ).toBe(true);
        }
      },
    );
  });
});
