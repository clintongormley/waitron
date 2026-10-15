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
    expect(text[text.indexOf("Charcutería La Buena SL") + 1]).toBe("NIF: B12345678");
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

  it("keeps a full invoice's base and VAT lines when it has only one rate", () => {
    const rows = buildReceiptDocument({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        vatBreakdown: [{ rate: "10.00", base: "17.90", tax: "1.79" }],
      },
    }).elements.flatMap((e): unknown[] =>
      e.kind === "amount" ? [[e.caption, e.amount]] : e.kind === "rule" ? ["rule"] : [],
    );
    const totalAt = rows.findIndex((row) => Array.isArray(row) && row[0] === "TOTAL");
    expect(rows.slice(totalAt - 4, totalAt + 1)).toEqual([
      "rule",
      ["Base 10%", "17,90 €"],
      ["IVA 10%", "1,79 €"],
      "rule",
      ["TOTAL", "19,69 €"],
    ]);
    expect(rows).not.toContainEqual(["IVA 10% incluido", "1,79 €"]);
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
      expect(text[text.indexOf("Filed issuer") + 1]).toBe("NIF: B12345678");
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

  /** The elements from the logo up to the rule that closes the block. */
  function topBlock(document: ReturnType<typeof buildReceiptDocument>): unknown[] {
    const start = document.elements.findIndex((e) => e.kind === "logo");
    const end = document.elements.findIndex((e, i) => i > start && e.kind === "rule");
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
  const bold = (text: string) => ({ ...t(text), style: { bold: true } });

  it("prints a simplified invoice's block in order, one fact a line, in the language's own labels", () => {
    expect(
      topBlock(buildReceiptDocument({ ...input, result: SIMPLIFIED, invoiceLocale: "eu-ES" })),
    ).toEqual([
      { kind: "logo" },
      bold("Bar La Buena"),
      t("Desde 1952"),
      t("Charcutería La Buena SL"),
      t("IFZ: B12345678"),
      t("Calle Mayor 1, Local 2"),
      t("03001 Alicante, Alicante/Alacant"),
      t("Tel. 912 345 678"),
      t("hola@labuena.es"),
      t("BIKOIZKARIA"),
    ]);
  });

  it("prints a full invoice's filed domicile after the contact lines and before the duplicate mark", () => {
    expect(
      topBlock(buildReceiptDocument({ ...input, result: FULL, invoiceLocale: "es-ES" })),
    ).toEqual([
      { kind: "logo" },
      bold("Bar La Buena"),
      t("Desde 1952"),
      t("Charcutería La Buena SL"),
      t("NIF: B12345678"),
      t("Calle Mayor 1, Local 2"),
      t("03001 Alicante, Alicante/Alacant"),
      t("Tel. 912 345 678"),
      t("hola@labuena.es"),
      t("Filed domicile"),
      t("DUPLICADO"),
    ]);
  });

  it.each([
    { receipt: { phone: "912 345 678" }, want: "Tel. 912 345 678" },
    { receipt: { email: "hola@labuena.es" }, want: "hola@labuena.es" },
  ])("prints only the contact line that is set: $want", ({ receipt, want }) => {
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
      bold("Charcutería La Buena SL"),
      t("NIF: B12345678"),
      t(want),
    ]);
  });

  it.each(["thermal", "a4"] as const)(
    "draws a rule, not a blank line, directly above TOTAL on %s",
    (surface) => {
      const { elements } = buildReceiptDocument({ ...FULL_INVOICE_DOCUMENT_FIXTURE, surface });
      const total = elements.findIndex((e) => e.kind === "amount" && e.caption === "TOTAL");
      expect(elements[total - 1]).toEqual({ kind: "rule" });
      expect(elements[total - 2]).not.toEqual({ kind: "rule" });
    },
  );
});

describe("the business block, one fact per line, and ruled sections (A663)", () => {
  it("puts one fact on each line of the business block, the first one bold", () => {
    const document = buildReceiptDocument({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      surface: "thermal",
      receiptHeader: { tradingName: "Santet Deli Co", printTradingName: true },
      receipt: { phone: "910000000", email: "hola@santet.example" },
      venueAddress: ["Avinguda d'Icària 215, Bajos", "08005 Barcelona"],
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        invoiceType: "F2",
        issuer: { venueName: "SANTET DELI CO S.L.", nif: "B00000000" },
      },
    });
    const start = document.elements.findIndex((e) => e.kind === "logo");
    const end = document.elements.findIndex((e, i) => i > start && e.kind === "rule");
    expect(document.elements.slice(start + 1, end).filter((e) => e.kind === "text")).toEqual([
      { kind: "text", text: "Santet Deli Co", indent: 0, style: { bold: true } },
      { kind: "text", text: "SANTET DELI CO S.L.", indent: 0 },
      { kind: "text", text: "NIF: B00000000", indent: 0 },
      { kind: "text", text: "Avinguda d'Icària 215, Bajos", indent: 0 },
      { kind: "text", text: "08005 Barcelona", indent: 0 },
      { kind: "text", text: "Tel. 910000000", indent: 0 },
      { kind: "text", text: "hola@santet.example", indent: 0 },
    ]);
  });

  it("bolds the legal name when no trading name prints", () => {
    const document = buildReceiptDocument({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      receiptHeader: undefined,
    });
    const first = document.elements.find(
      (e) => e.kind === "text" && e.text.includes("Charcutería"),
    );
    expect(first).toMatchObject({ text: "Charcutería La Buena SL", style: { bold: true } });
  });

  /** The kinds of the elements that draw something, alignment changes left out. */
  const drawn = (input: Parameters<typeof buildReceiptDocument>[0]) =>
    buildReceiptDocument(input)
      .elements.filter((e) => e.kind !== "align")
      .map((e) => (e.kind === "text" ? e.text : e.kind));

  it("separates every section with a rule and leaves no blank-line breaks", () => {
    const kinds = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements.map((e) => e.kind);
    expect(kinds).not.toContain("break");
    expect(kinds.filter((k) => k === "rule").length).toBeGreaterThanOrEqual(5);
  });

  it("never draws two rules in a row, or a rule first or last, whichever sections are empty", () => {
    const fixture = FULL_INVOICE_DOCUMENT_FIXTURE;
    let inputs = 0;
    for (const simulated of [false, true])
      for (const footerMessage of [undefined, "Hasta pronto"])
        for (const qr of ["", fixture.result.qr])
          for (const tender of [{ method: "unpaid" as const }, fixture.result.tender])
            for (const lines of [[], fixture.result.lines])
              for (const vatBreakdown of [[], fixture.result.vatBreakdown]) {
                const kinds = drawn({
                  ...fixture,
                  simulated,
                  receipt: { ...fixture.receipt, footerMessage },
                  result: { ...fixture.result, qr, tender, lines, vatBreakdown },
                });
                const input = JSON.stringify({
                  simulated,
                  footerMessage,
                  qr: qr !== "",
                  tender: tender.method,
                  lines: lines.length,
                  vat: vatBreakdown.length,
                });
                expect(kinds[0], input).not.toBe("rule");
                expect(kinds.at(-1), input).not.toBe("rule");
                for (const [at, kind] of kinds.entries())
                  if (kind === "rule") expect(kinds[at + 1], `${input} at ${at}`).not.toBe("rule");
                inputs++;
              }
    expect(inputs).toBe(64);
  });

  it("draws one rule, not two, above a practice receipt's closing mark when there is no footer", () => {
    const kinds = drawn({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      simulated: true,
      receipt: { ...FULL_INVOICE_DOCUMENT_FIXTURE.receipt, footerMessage: undefined },
      result: { ...FULL_INVOICE_DOCUMENT_FIXTURE.result, qr: "" },
    });
    expect(kinds.slice(-4)).toEqual(["amount", "amount", "rule", "PRUEBA - SIN COBRO REAL"]);
  });
});

describe("the simplified receipt's own layout (A663)", () => {
  const SIMPLIFIED = {
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    result: { ...FULL_INVOICE_DOCUMENT_FIXTURE.result, invoiceType: "F2" as const },
  };
  const rows = (input: Parameters<typeof buildReceiptDocument>[0]) =>
    buildReceiptDocument(input).elements.flatMap((e): unknown[] =>
      e.kind === "amount" ? [[e.caption, e.amount, e.style]] : e.kind === "rule" ? ["rule"] : [],
    );

  it("heads with the order and date, then the number, and prints TOTAL before each rate's base and VAT", () => {
    expect(rows(SIMPLIFIED)).toEqual([
      "rule",
      "rule",
      ["Mesa 6 · Pedido 41", expect.stringMatching(/^1[78] ago 2026, \d+:34$/u), undefined],
      ["Factura simplificada", "FF/1", undefined],
      "rule",
      ["1  Menú del día con un nombre especialmente largo", "12,10", undefined],
      ["  Descuento 10%", "-1,21", undefined],
      ["2  Agua mineral", "8,80", undefined],
      "rule",
      ["TOTAL", "19,69 €", { double: true }],
      ["Base 21%", "9,00 €", undefined],
      ["IVA 21%", "1,89 €", undefined],
      ["Base 10%", "8,00 €", undefined],
      ["IVA 10%", "0,80 €", undefined],
      "rule",
      ["Efectivo", "20,00 €", undefined],
      ["Cambio", "0,31 €", undefined],
      "rule",
    ]);
  });

  it("prints one VAT-included line for a single rate, in the receipt's language", () => {
    const oneRate = (invoiceLocale: string) =>
      rows({
        ...SIMPLIFIED,
        invoiceLocale,
        result: {
          ...SIMPLIFIED.result,
          vatBreakdown: [{ rate: "10.00", base: "17.90", tax: "1.79" }],
        },
      });
    const es = oneRate("es-ES");
    expect(es.slice(es.indexOf("rule", 5) + 1, es.indexOf("rule", 5) + 4)).toEqual([
      ["TOTAL", "19,69 €", { double: true }],
      ["IVA 10% incluido", "1,79 €", undefined],
      "rule",
    ]);
    expect(oneRate("ca-ES")).toContainEqual(["IVA 10% inclòs", "1,79 €", undefined]);
  });

  it("never draws two rules in a row, or a rule first or last, on a simplified receipt", () => {
    for (const vatBreakdown of [[], SIMPLIFIED.result.vatBreakdown.slice(0, 1)])
      for (const lines of [[], SIMPLIFIED.result.lines])
        for (const tender of [{ method: "unpaid" as const }, SIMPLIFIED.result.tender]) {
          const kinds = buildReceiptDocument({
            ...SIMPLIFIED,
            receipt: { ...SIMPLIFIED.receipt, footerMessage: undefined },
            result: { ...SIMPLIFIED.result, vatBreakdown, lines, tender },
          }).elements.flatMap((e) => (e.kind === "align" ? [] : [e.kind]));
          const input = JSON.stringify({ vat: vatBreakdown.length, lines: lines.length, tender });
          expect(kinds[0], input).not.toBe("rule");
          expect(kinds.at(-1), input).not.toBe("rule");
          for (const [at, kind] of kinds.entries())
            if (kind === "rule") expect(kinds[at + 1], `${input} at ${at}`).not.toBe("rule");
        }
  });
});
