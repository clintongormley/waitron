import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { VatCorrections } from "@waitron/reporting";
import { decimal } from "@waitron/shared";
import { renderCorrectionsWorkbook } from "./corrections-report.js";
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
): Promise<{ workbook: string; summary: string; rows: string }> {
  const files = unzipSync(await renderCorrectionsWorkbook(corrections, language));
  return {
    workbook: strFromU8(files["xl/workbook.xml"]!),
    summary: strFromU8(files["xl/worksheets/sheet1.xml"]!),
    rows: strFromU8(files["xl/worksheets/sheet2.xml"]!),
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
      ["Resumen", "Correcciones"],
      "Emitida después del periodo de su venta",
      "Anulación",
      "Aumento",
      "Reducción",
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
      expect(row(rows, 1)[0]).toBe(language === "en" ? "Made on" : "Fecha en que se hizo");
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
    ["correction", "Correction", "Rectificativa"],
    ["date_moved_out", "Date moved out", "Fecha trasladada (salida)"],
    ["date_moved_in", "Date moved in", "Fecha trasladada (entrada)"],
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
});
