import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { renderCorrectionsWorkbook } from "../corrections-report.js";
import type { FreeItem } from "../free-items.js";
import { row } from "../testing/xlsx-rows.js";

const item = (overrides: Partial<FreeItem>): FreeItem => ({
  adjustmentId: "a",
  date: "2026-04-03",
  invoice: { seriesCode: "A", number: 12 },
  item: "Burger",
  quantity: decimal("1.000"),
  kind: "comp",
  department: "Bar",
  menuPrice: decimal("11.00"),
  amountTakenOff: decimal("11.00"),
  estimatedCost: null,
  reason: "Casa",
  note: null,
  ...overrides,
});

describe("the Given free sheet's Spanish wording", () => {
  it("names the sheet, its columns, its kinds and a whole bill", async () => {
    const files = unzipSync(
      await renderCorrectionsWorkbook(
        { madeIn: "2026-2T", summary: [], rows: [] },
        [item({}), item({ adjustmentId: "b", item: null, quantity: null, kind: "discount" })],
        "es",
      ),
    );
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('<sheet name="Invitaciones"');
    const sheet = strFromU8(files["xl/worksheets/sheet3.xml"]!);
    expect(row(sheet, 1)).toEqual([
      "Fecha",
      "Número de factura",
      "Artículo",
      "Cantidad",
      "Tipo",
      "Departamento",
      "Precio de carta (EUR)",
      "Importe descontado (EUR)",
      "Coste estimado (EUR)",
      "Motivo",
      "Nota",
    ]);
    expect(row(sheet, 2)[4]).toBe("Invitación");
    expect(row(sheet, 3).slice(2, 5)).toEqual(["Toda la cuenta", "", "Descuento hasta cero"]);
    // The same number's column on the Corrections sheet.
    expect(row(strFromU8(files["xl/worksheets/sheet2.xml"]!), 1)[2]).toBe("Número de factura");
  });
});
