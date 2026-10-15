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
    expect(text).toContain("Charcutería La Buena SL · NIF: B12345678");
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

  it("writes a filed line's two-decimal rate with significant digits only", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines[0]!.net!.rate = "21.00";
    input.result.lines[1]!.net!.rate = "17.50";
    input.result.vatBreakdown = [
      { rate: "21.00", base: "9.00", tax: "1.89" },
      { rate: "17.50", base: "8.00", tax: "0.80" },
    ];
    const captions = buildReceiptDocument(input).elements.flatMap((e) =>
      e.kind === "amount" ? [e.caption] : [],
    );
    expect(captions).toEqual(
      expect.arrayContaining(["Base 21%", "IVA 21%", "Base 17,5%", "IVA 17,5%"]),
    );
    expect(captions.some((c) => c.includes(".00%") || c.includes("17.5"))).toBe(false);
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
      expect(text).toContain("Filed issuer · NIF: B12345678");
      expect(text).not.toContain("Current mutable issuer");
      expect(text).not.toContain("Current mutable domicile");
    }
  },
);

describe("the top block (A497)", () => {
  const SIMPLIFIED = {
    ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
    invoiceType: "F2" as const,
    qr: "",
    issuer: { venueName: "Charcutería La Buena SL", nif: "B12345678", domicile: "Filed domicile" },
  };
  const FULL = { ...SIMPLIFIED, invoiceType: "F1" as const };

  /** The elements from the logo up to the blank line that closes the block. */
  function topBlock(document: ReturnType<typeof buildReceiptDocument>): unknown[] {
    const start = document.elements.findIndex((e) => e.kind === "logo");
    const end = document.elements.findIndex((e, i) => i > start && e.kind === "break");
    return document.elements.slice(start, end);
  }

  const input = {
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    surface: "thermal" as const,
    receiptHeader: { tradingName: "Bar La Buena", printTradingName: true },
    receipt: { headerSubtitle: "Desde 1952", phone: "912 345 678", email: "hola@labuena.es" },
    venueAddress: ["Calle Mayor 1, Local 2", "03001 Alicante, Alicante/Alacant"],
    duplicate: true,
  };
  const t = (text: string) => ({ kind: "text", text, indent: 0 });
  const joined = (...parts: string[]) => ({ ...t(parts.join(" · ")), parts });

  it("prints a simplified invoice's block in order, the legal name and tax ID on one line, in the language's own labels", () => {
    expect(
      topBlock(buildReceiptDocument({ ...input, result: SIMPLIFIED, invoiceLocale: "eu-ES" })),
    ).toEqual([
      { kind: "logo" },
      t("Bar La Buena"),
      t("Desde 1952"),
      joined("Charcutería La Buena SL", "IFZ: B12345678"),
      t("Calle Mayor 1, Local 2"),
      t("03001 Alicante, Alicante/Alacant"),
      joined("Tel. 912 345 678", "hola@labuena.es"),
      t("BIKOIZKARIA"),
    ]);
  });

  it("prints a full invoice's filed domicile after the contact line and before the duplicate mark", () => {
    expect(
      topBlock(buildReceiptDocument({ ...input, result: FULL, invoiceLocale: "es-ES" })),
    ).toEqual([
      { kind: "logo" },
      t("Bar La Buena"),
      t("Desde 1952"),
      joined("Charcutería La Buena SL", "NIF: B12345678"),
      t("Calle Mayor 1, Local 2"),
      t("03001 Alicante, Alicante/Alacant"),
      joined("Tel. 912 345 678", "hola@labuena.es"),
      t("Filed domicile"),
      t("DUPLICADO"),
    ]);
  });

  it.each([
    { receipt: { phone: "912 345 678" }, want: "Tel. 912 345 678" },
    { receipt: { email: "hola@labuena.es" }, want: "hola@labuena.es" },
  ])("prints the contact line with only the part that is set: $want", ({ receipt, want }) => {
    const block = topBlock(
      buildReceiptDocument({
        ...input,
        receiptHeader: undefined,
        receipt,
        venueAddress: [],
        duplicate: false,
        result: SIMPLIFIED,
        invoiceLocale: "es-ES",
      }),
    );
    expect(block).toEqual([
      { kind: "logo" },
      joined("Charcutería La Buena SL", "NIF: B12345678"),
      t(want),
    ]);
  });

  it.each(["thermal", "a4"] as const)(
    "draws a rule, not a blank line, directly above TOTAL on %s",
    (surface) => {
      const { elements } = buildReceiptDocument({ ...FULL_INVOICE_DOCUMENT_FIXTURE, surface });
      const total = elements.findIndex((e) => e.kind === "amount" && e.caption === "TOTAL");
      expect(elements[total - 1]).toEqual({ kind: "rule" });
      expect(elements.filter((e) => e.kind === "rule")).toHaveLength(1);
    },
  );
});
