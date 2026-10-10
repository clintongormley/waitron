import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatReceipt } from "./receipt-ticket.js";
import { buildReceiptDocument } from "./receipt-document.js";
import {
  FULL_INVOICE_FIXTURE,
  FULL_INVOICE_DOCUMENT_FIXTURE,
} from "./testing/full-invoice-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";

describe("format-neutral invoice content", () => {
  it.each(["58mm", "80mm"] as const)("keeps the captured F1 paper bytes on %s", (paperWidth) => {
    const bytes = formatReceipt({
      ...FULL_INVOICE_FIXTURE,
      printer: { paperWidth, resolution: "180dpi" },
    });
    expect(Buffer.from(bytes)).toEqual(
      readFileSync(new URL(`./testing/full-invoice-${paperWidth}.bin`, import.meta.url)),
    );
    const text = printedLines(bytes).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Charcutería La Buena SL");
    expect(text).toContain("Cliente de nombre largo y completo Sociedad Limitada");
    expect(text).toContain("segunda planta, Madrid 28001");
    expect(text).toContain("tercera planta, Madrid 28002");
    expect(text).toContain("19,69");
    expect(text).not.toContain("Current mutable issuer");
    expect(text).not.toContain("Current mutable domicile");
    expect(text).toContain("Current mutable location address");
  });

  it("exposes the saved invoice figures and names without choosing a printer or wrapping the text", () => {
    const document = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE);
    const text = document.elements.flatMap((element) =>
      element.kind === "text" ? [element.text] : [],
    );
    const rows = document.elements.flatMap((element) =>
      element.kind === "amount" ? [[element.caption, element.amount]] : [],
    );
    expect(text).toContain("Charcutería La Buena SL");
    expect(text).toContain(
      "Calle del domicilio fiscal original número 27, edificio de la plaza mayor, segunda planta, Madrid 28001",
    );
    expect(text).toContain("Cliente de nombre largo y completo Sociedad Limitada");
    expect(text).toContain(
      "Avenida del cliente original número 123, edificio de la estación, tercera planta, Madrid 28002",
    );
    expect(text).toContain("1  Menú del día con un nombre especialmente largo");
    expect(text).not.toContain("Current mutable issuer");
    expect(text).not.toContain("Current mutable domicile");
    expect(text).not.toContain("Current mutable location address");
    expect(rows).toEqual([
      ["Factura", "FF/1"],
      ["Fecha", "18 ago 2026, 0:34"],
      ["Fecha de operación", "17 ago 2026"],
      ["Precio sin IVA", "10,00 € / 1"],
      ["Base 21%", "9,00 €"],
      ["IVA 21%", "1,89 €"],
      ["  Descuento 10% (IVA incluido)", "-1,21 €"],
      ["Precio sin IVA", "4,00 € / 1"],
      ["Base 10%", "8,00 €"],
      ["IVA 10%", "0,80 €"],
      ["Base 21%", "9,00 €"],
      ["IVA 21%", "1,89 €"],
      ["Base 10%", "8,00 €"],
      ["IVA 10%", "0,80 €"],
      ["TOTAL", "19,69 €"],
      ["Efectivo", "20,00 €"],
      ["Cambio", "0,31 €"],
    ]);
    expect(document.elements.filter((element) => element.kind === "qr")).toEqual([
      { kind: "qr", text: FULL_INVOICE_FIXTURE.result.qr },
    ]);
  });
});

it.each(["thermal", "a4"] as const)(
  "keeps filed domicile separate from optional current address on %s",
  (surface) => {
    for (const domicile of ["Filed domicile", undefined]) {
      const document = buildReceiptDocument({
        ...FULL_INVOICE_DOCUMENT_FIXTURE,
        surface,
        result: {
          ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
          issuer: {
            venueName: "Filed issuer",
            nif: "B12345678",
            ...(domicile === undefined ? {} : { domicile }),
          },
        },
        venueAddress: ["Current address"],
      });
      const text = document.elements.flatMap((e) => (e.kind === "text" ? [e.text] : []));
      expect(text.includes("Current address")).toBe(surface === "thermal");
      expect(text.includes("Filed domicile")).toBe(domicile !== undefined);
      expect(text).toContain("Filed issuer");
      expect(text).not.toContain("Current mutable issuer");
      expect(text).not.toContain("Current mutable domicile");
    }
  },
);
