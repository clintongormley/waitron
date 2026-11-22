import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { VatCorrections } from "@waitron/reporting";
import { decimal } from "@waitron/shared";
import { renderCorrectionsWorkbook } from "./corrections-report.js";
import type { FreeItem } from "./free-items.js";
import { CORRECTIONS_REPORT_WORDS } from "./i18n/corrections-report.js";
import { row } from "./testing/xlsx-rows.js";

function xmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");
}

async function sheets(
  corrections: VatCorrections,
  language: "en" | "es",
  free: FreeItem[] = [],
): Promise<{ workbook: string; summary: string; rows: string; free: string }> {
  const files = unzipSync(await renderCorrectionsWorkbook(corrections, free, language));
  return {
    workbook: strFromU8(files["xl/workbook.xml"]!),
    summary: strFromU8(files["xl/worksheets/sheet1.xml"]!),
    rows: strFromU8(files["xl/worksheets/sheet2.xml"]!),
    free: strFromU8(files["xl/worksheets/sheet3.xml"]!),
  };
}

const LATE: VatCorrections = {
  madeIn: "2026-2T",
  rows: [
    {
      madeDay: "2026-04-01",
      kind: "issued_late",
      invoice: { seriesCode: "A", number: 7, issueDate: "2026-04-01" },
      corrects: null,
      belongsTo: "2026-1T",
      rate: decimal("10.00"),
      base: decimal("11.00"),
      tax: decimal("1.10"),
      direction: "addition",
    },
    {
      madeDay: "2026-05-02",
      kind: "void",
      invoice: { seriesCode: "R", number: 3, issueDate: "2026-03-30" },
      corrects: { seriesCode: "A", number: 5, issueDate: "2026-03-20" },
      belongsTo: "2026-1T",
      rate: decimal("21.00"),
      base: decimal("-10.00"),
      tax: decimal("-2.10"),
      direction: "reduction",
    },
  ],
  summary: [
    {
      belongsTo: "2026-1T",
      rate: decimal("10.00"),
      direction: "addition",
      base: decimal("11.00"),
      tax: decimal("1.10"),
    },
    {
      belongsTo: "2026-1T",
      rate: decimal("21.00"),
      direction: "reduction",
      base: decimal("-10.00"),
      tax: decimal("-2.10"),
    },
  ],
};

describe("corrections workbook", () => {
  it.each([
    [
      "en",
      ["Summary", "Corrections"],
      "Issued after its sale&apos;s period",
      "Void",
      "Addition",
      "Reduction",
    ],
    [
      "es",
      [CORRECTIONS_REPORT_WORDS.es.summarySheet, CORRECTIONS_REPORT_WORDS.es.rowsSheet],
      CORRECTIONS_REPORT_WORDS.es.kinds.issued_late,
      CORRECTIONS_REPORT_WORDS.es.kinds.void,
      CORRECTIONS_REPORT_WORDS.es.directions.addition,
      CORRECTIONS_REPORT_WORDS.es.directions.reduction,
    ],
  ] as const)(
    "names each row's kind and direction, with formatted invoice numbers (%s)",
    async (language, [summaryName, rowsName], late, voided, addition, reduction) => {
      const { workbook, summary, rows } = await sheets(LATE, language);
      expect(workbook).toMatch(
        new RegExp(`<sheet name="${summaryName}"[^>]*/><sheet name="${rowsName}"`),
      );
      expect(row(summary, 1)).toHaveLength(6);
      expect(row(summary, 1)).toEqual(
        CORRECTIONS_REPORT_WORDS[language].summaryColumns.map(xmlText),
      );
      expect(row(summary, 2)).toEqual(["2026-2T", "2026-1T", "10.00", addition, "11.00", "1.10"]);
      expect(row(summary, 3)).toEqual([
        "2026-2T",
        "2026-1T",
        "21.00",
        reduction,
        "-10.00",
        "-2.10",
      ]);
      expect(row(rows, 1)).toHaveLength(10);
      expect(row(rows, 1)).toEqual(CORRECTIONS_REPORT_WORDS[language].rowColumns.map(xmlText));
      expect(row(rows, 1)[0]).toBe(
        language === "en" ? "Made on" : CORRECTIONS_REPORT_WORDS.es.rowColumns[0],
      );
      expect(row(rows, 2)).toEqual([
        "2026-04-01",
        late,
        "A/7",
        "",
        "",
        "2026-1T",
        "10.00",
        "11.00",
        "1.10",
        addition,
      ]);
      expect(row(rows, 3)).toEqual([
        "2026-05-02",
        voided,
        "R/3",
        "A/5",
        "2026-03-20",
        "2026-1T",
        "21.00",
        "-10.00",
        "-2.10",
        reduction,
      ]);
      expect(rows).toContain('<c r="H3" t="n" s="1"><v>-10.00</v></c>');
    },
  );

  it.each([
    ["correction", "Corrective", CORRECTIONS_REPORT_WORDS.es.kinds.correction],
    ["date_moved_out", "Date moved out", CORRECTIONS_REPORT_WORDS.es.kinds.date_moved_out],
    ["date_moved_in", "Date moved in", CORRECTIONS_REPORT_WORDS.es.kinds.date_moved_in],
  ] as const)("labels a %s row in English and Spanish", async (kind, english, spanish) => {
    const data: VatCorrections = { ...LATE, rows: [{ ...LATE.rows[0]!, kind }] };
    expect(row((await sheets(data, "en")).rows, 2)[1]).toBe(english);
    expect(row((await sheets(data, "es")).rows, 2)[1]).toBe(spanish);
  });

  it.each([
    ["en", "No corrections"],
    ["es", "Sin correcciones"],
  ] as const)(
    "writes one line saying so when the period corrected nothing (%s)",
    async (language, nothing) => {
      const { summary, rows } = await sheets(
        { madeIn: "2026-2T", summary: [], rows: [] },
        language,
      );
      expect(summary.match(/<row /g)).toHaveLength(2);
      expect(row(summary, 2)).toEqual([nothing]);
      expect(rows.match(/<row /g)).toHaveLength(1);
    },
  );

  const FREE: FreeItem[] = [
    {
      adjustmentId: "a",
      date: "2026-04-03",
      invoice: { seriesCode: "A", number: 12 },
      item: "Burger",
      quantity: decimal("1.000"),
      kind: "comp",
      department: "Bar",
      menuPrice: decimal("11.00"),
      amountTakenOff: decimal("11.00"),
      estimatedCost: decimal("7.00"),
      reason: "Complaint",
      note: "Cold",
    },
    {
      adjustmentId: "b",
      date: "2026-04-04",
      invoice: null,
      item: null,
      quantity: null,
      kind: "discount",
      department: null,
      menuPrice: decimal("23.10"),
      amountTakenOff: decimal("23.10"),
      estimatedCost: null,
      reason: "House",
      note: null,
    },
  ];

  it.each(["en", "es"] as const)(
    "lists what was given free on a third sheet, with formatted ticket numbers (%s)",
    async (language) => {
      const words = CORRECTIONS_REPORT_WORDS[language];
      const { workbook, free } = await sheets(LATE, language, FREE);
      expect(workbook).toMatch(
        new RegExp(`<sheet name="${words.rowsSheet}"[^>]*/><sheet name="${words.freeSheet}"`),
      );
      expect(row(free, 1)).toEqual(words.freeColumns.map(xmlText));
      expect(row(free, 2)).toEqual([
        "2026-04-03",
        "A/12",
        "Burger",
        "1.000",
        words.freeKinds.comp,
        "Bar",
        "11.00",
        "11.00",
        "7.00",
        "Complaint",
        "Cold",
      ]);
      expect(row(free, 3)).toEqual([
        "2026-04-04",
        "",
        words.wholeBill,
        "",
        words.freeKinds.discount,
        "",
        "23.10",
        "23.10",
        "",
        "House",
        "",
      ]);
      expect(free.match(/<row /g)).toHaveLength(3);
    },
  );

  it("names the free sheet's words in English and Spanish", () => {
    expect(CORRECTIONS_REPORT_WORDS.en.freeSheet).toBe("Given free");
    expect(CORRECTIONS_REPORT_WORDS.en.wholeBill).toBe("Whole bill");
    expect(CORRECTIONS_REPORT_WORDS.en.freeKinds).toEqual({
      comp: "Comp",
      discount: "Discount to zero",
    });
    expect(CORRECTIONS_REPORT_WORDS.es.freeColumns).toHaveLength(11);
    expect(CORRECTIONS_REPORT_WORDS.es.freeSheet).not.toBe(CORRECTIONS_REPORT_WORDS.en.freeSheet);
  });
});
