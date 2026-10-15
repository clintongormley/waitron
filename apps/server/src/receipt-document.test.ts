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
    expect(
      document.elements.flatMap((element) => (element.kind === "table" ? element.table.rows : [])),
    ).toContainEqual(
      expect.objectContaining({
        units: "1",
        item: "Menú del día con un nombre especialmente largo",
      }),
    );
    expect(text).not.toContain("Current mutable issuer");
    expect(text).not.toContain("Current mutable domicile");
    expect(text).not.toContain("Current mutable location address");
    expect(rows).toEqual([
      ["FACTURA", "FF/1"],
      ["Mesa 6 · Pedido 41", "18 ago 2026, 0:34"],
      ["Fecha de operación", "17 ago 2026"],
      ["Base imponible 21%", "9,00 €"],
      ["IVA 21%", "1,89 €"],
      ["Base imponible 10%", "8,00 €"],
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
      expect.arrayContaining([
        "Base imponible 21%",
        "IVA 21%",
        "Base imponible 17,5%",
        "IVA 17,5%",
      ]),
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
      ["Base imponible 10%", "17,90 €"],
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
      expect(text.some((line) => line.endsWith("Filed domicile"))).toBe(domicile !== undefined);
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
      t("Domicilio fiscal: Filed domicile"),
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

  it("separates every section with a rule", () => {
    const kinds = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements.map((e) => e.kind);
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

  const withAddresses = (venueAddress: string[], domicile: string) =>
    buildReceiptDocument({
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      surface: "thermal",
      venueAddress,
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        issuer: { venueName: "Santet SL", nif: "B00000000", domicile },
      },
    }).elements.flatMap((e) => (e.kind === "text" ? [e.text] : []));

  it("prints a matching address once, ignoring case, commas and spacing", () => {
    const text = withAddresses(
      ["Avinguda d'Icària 215, Bajos", "08005 Barcelona"],
      "AVINGUDA D'ICÀRIA 215 BAJOS,  08005 Barcelona",
    );
    expect(text.filter((t) => /Icària/i.test(t))).toEqual(["Avinguda d'Icària 215, Bajos"]);
    expect(text.some((t) => t.startsWith("Domicilio fiscal:"))).toBe(false);
  });

  it("prints both, the registered one labelled, when they differ by one real character", () => {
    const text = withAddresses(
      ["Avinguda d'Icària 215, Bajos", "08005 Barcelona"],
      "Avinguda d'Icària 217, Bajos, 08005 Barcelona",
    );
    expect(text).toContain("Avinguda d'Icària 215, Bajos");
    expect(text).toContain("Domicilio fiscal: Avinguda d'Icària 217, Bajos, 08005 Barcelona");
  });

  it("prints the registered address unlabelled when it is the only one", () => {
    const text = withAddresses([], "Avinguda d'Icària 215, Bajos, 08005 Barcelona");
    expect(text).toContain("Avinguda d'Icària 215, Bajos, 08005 Barcelona");
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
      ["Base imponible 21%", "9,00 €", undefined],
      ["IVA 21%", "1,89 €", undefined],
      ["Base imponible 10%", "8,00 €", undefined],
      ["IVA 10%", "0,80 €", undefined],
      "rule",
      ["Efectivo", "20,00 €", undefined],
      ["Cambio", "0,31 €", undefined],
      "rule",
    ]);
  });

  it("prints the base and the VAT under TOTAL for a single rate, in the receipt's language", () => {
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
    expect(es.slice(es.indexOf("rule", 5) + 1, es.indexOf("rule", 5) + 5)).toEqual([
      ["TOTAL", "19,69 €", { double: true }],
      ["Base imponible 10%", "17,90 €", undefined],
      ["IVA 10%", "1,79 €", undefined],
      "rule",
    ]);
    const ca = oneRate("ca-ES");
    expect(ca).toContainEqual(["Base imposable 10%", "17,90 €", undefined]);
    expect(ca).toContainEqual(["IVA 10%", "1,79 €", undefined]);
    const captions = [...es, ...ca].flatMap((row) => (Array.isArray(row) ? [String(row[0])] : []));
    expect(captions.filter((caption) => /incluido|inclòs/u.test(caption))).toEqual([]);
  });

  it("prints a dish priced per pack by its quantity and unit, not its count of packs", () => {
    const input = structuredClone(SIMPLIFIED);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Jamón ibérico" },
        unitName: { es: "kg" },
        quantity: "0.300",
        gross: "9.00",
        net: { unitPrice: "2.73", priceQuantity: "0.100", base: "8.18", tax: "0.82", rate: "10" },
      },
    ];
    expect(rows(input)).toContainEqual(["0.300 kg  Jamón ibérico", "9,00", undefined]);
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

describe("the full invoice's heading, customer block, table and totals (A663)", () => {
  const tableOf = (document: ReturnType<typeof buildReceiptDocument>) => {
    const table = document.elements.find((e) => e.kind === "table");
    if (table?.kind !== "table") throw new Error("no table");
    return table.table;
  };
  const amountRows = (document: ReturnType<typeof buildReceiptDocument>) =>
    document.elements.flatMap((e) => (e.kind === "amount" ? [[e.caption.trim(), e.amount]] : []));
  const ownerMenu = (vatBreakdown: { rate: string; base: string; tax: string }[]) => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Menú del día" },
        unitName: { es: "ud" },
        quantity: "1",
        gross: "9.00",
        listGross: "10.00",
        net: {
          unitPrice: "8.18",
          priceQuantity: "1.000",
          base: "8.18",
          tax: "0.82",
          rate: "10.00",
        },
        adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.00" }],
      },
    ];
    input.result.vatBreakdown = vatBreakdown;
    input.result.total = "9.00";
    return buildReceiptDocument(input);
  };

  it("heads a full invoice with FACTURA and its number, in bold", () => {
    const elements = buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE).elements;
    expect(elements).toContainEqual({
      kind: "amount",
      caption: "FACTURA",
      amount: "FF/1",
      indent: 0,
      style: { bold: true },
    });
    expect(elements.some((e) => e.kind === "text" && e.text === "Factura completa")).toBe(false);
  });

  it("lists a full invoice's items one row each, before VAT, with the discount as its own row", () => {
    const table = tableOf(buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE));
    expect(table.header).toEqual({
      units: "Uds",
      item: "Concepto",
      price: "Precio",
      amount: "Importe",
      rate: "IVA",
    });
    expect(table.withRate).toBe(true);
    expect(table.rows).toEqual([
      {
        units: "1",
        item: "Menú del día con un nombre especialmente largo",
        price: "10,00",
        amount: "10,00",
        rate: "21%",
      },
      { units: "", item: "Descuento 10%", itemIndent: 2, price: "", amount: "-1,00", rate: "21%" },
      { units: "2", item: "Agua mineral", price: "4,00", amount: "8,00", rate: "10%" },
    ]);
  });

  it("prints the owner's menu del día: 9,09, less 0,91, base imponible 8,18, IVA 0,82", () => {
    const document = ownerMenu([{ rate: "10.00", base: "8.18", tax: "0.82" }]);
    expect(tableOf(document).withRate).toBe(false);
    expect(tableOf(document).rows).toMatchObject([
      { units: "1", item: "Menú del día", price: "9,09", amount: "9,09" },
      { units: "", item: "Descuento 10%", price: "", amount: "-0,91" },
    ]);
    expect(amountRows(document)).toEqual(
      expect.arrayContaining([
        ["Base imponible 10%", "8,18 €"],
        ["IVA 10%", "0,82 €"],
      ]),
    );
    expect(JSON.stringify(document.elements)).not.toContain("IVA incluido");
  });

  it("prints the record's base and VAT, not the table's, when the two differ", () => {
    // No till path files this record; it pins that the totals are never a sum of the table.
    const document = ownerMenu([{ rate: "10.00", base: "8.19", tax: "0.81" }]);
    expect(amountRows(document)).toEqual(
      expect.arrayContaining([
        ["Base imponible 10%", "8,19 €"],
        ["IVA 10%", "0,81 €"],
      ]),
    );
    expect(tableOf(document).rows[1]).toMatchObject({ amount: "-0,91" });
  });

  it("prints a count in «ud» bare and keeps any other unit's name", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines[0]!.unitName = { es: "ud" };
    input.result.lines[1] = {
      descriptions: { "es-ES": "Jamón ibérico" },
      unitName: { es: "kg" },
      quantity: "0.35",
      gross: "42.00",
      net: { unitPrice: "109.09", priceQuantity: "1.000", base: "38.18", tax: "3.82", rate: "10" },
    };
    const rows = tableOf(buildReceiptDocument(input)).rows;
    expect(rows[0]).toMatchObject({ units: "1" });
    expect(rows.find((r) => r.item === "Jamón ibérico")).toMatchObject({
      units: "0.35 kg",
      price: "109,09",
      amount: "38,18",
    });
  });

  it("prints an extra priced per portion at its price per portion and nothing after it", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines.push({
      descriptions: { "es-ES": "Queso extra" },
      parentLineNo: 2,
      unitName: { es: "kg" },
      quantity: "0.100",
      gross: "3.00",
      net: { unitPrice: "1.24", priceQuantity: "0.050", base: "2.48", tax: "0.52", rate: "21" },
    });
    const rows = tableOf(buildReceiptDocument(input)).rows;
    expect(rows.find((r) => r.item === "Queso extra")).toMatchObject({
      units: "2",
      itemIndent: 2,
      price: "1,24",
      amount: "2,48",
    });
    expect(rows.some((r) => r.price.includes("/"))).toBe(false);
  });

  it("prints a whole-bill discount once per rate at the end of the table (owner, Q10)", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Rioja crianza" },
        quantity: "1",
        gross: "27.00",
        listGross: "30.00",
        net: {
          unitPrice: "22.31",
          priceQuantity: "1.000",
          base: "22.31",
          tax: "4.69",
          rate: "21.00",
        },
      },
      {
        descriptions: { "es-ES": "Pan de pueblo" },
        quantity: "1",
        gross: "2.25",
        listGross: "2.50",
        net: {
          unitPrice: "2.05",
          priceQuantity: "1.000",
          base: "2.05",
          tax: "0.20",
          rate: "10.00",
        },
      },
    ];
    input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "3.25" }];
    input.result.vatBreakdown = [
      { rate: "21.00", base: "22.31", tax: "4.69" },
      { rate: "10.00", base: "2.05", tax: "0.20" },
    ];
    input.result.total = "29.25";
    const document = buildReceiptDocument(input);
    const rows = tableOf(document).rows;
    expect(rows.map((r) => [r.item, r.amount, r.rate])).toEqual([
      ["Rioja crianza", "24,79", "21%"],
      ["Pan de pueblo", "2,27", "10%"],
      ["Descuento 10%", "-2,48", "21%"],
      ["Descuento 10%", "-0,22", "10%"],
    ]);
    expect(rows.slice(2).map((r) => r.itemIndent)).toEqual([undefined, undefined]);
    expect(amountRows(document).some(([caption]) => caption!.startsWith("Descuento"))).toBe(false);
  });

  const burgerAndBread = () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Hamburguesa" },
        quantity: "1",
        gross: "9.72",
        listGross: "12.00",
        net: {
          unitPrice: "8.03",
          priceQuantity: "1.000",
          base: "8.03",
          tax: "1.69",
          rate: "21.00",
        },
        adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
      },
      {
        descriptions: { "es-ES": "Pan de pueblo" },
        quantity: "1",
        gross: "2.25",
        listGross: "2.50",
        net: {
          unitPrice: "2.05",
          priceQuantity: "1.000",
          base: "2.05",
          tax: "0.20",
          rate: "10.00",
        },
      },
    ];
    input.result.vatBreakdown = [
      { rate: "21.00", base: "8.03", tax: "1.69" },
      { rate: "10.00", base: "2.05", tax: "0.20" },
    ];
    input.result.total = "11.97";
    return input;
  };

  it("keeps a dish's own discount under it and its bill share at the end", () => {
    const input = burgerAndBread();
    input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "1.33" }];
    expect(
      tableOf(buildReceiptDocument(input)).rows.map((r) => [r.item, r.amount, r.rate]),
    ).toEqual([
      ["Hamburguesa", "9,92", "21%"],
      ["Descuento 10%", "-0,99", "21%"],
      ["Pan de pueblo", "2,27", "10%"],
      ["Descuento 10%", "-0,90", "21%"],
      ["Descuento 10%", "-0,22", "10%"],
    ]);
  });

  it("prints one plain discount for everything a dish lost when the records could not be placed", () => {
    const input = burgerAndBread();
    input.result.lines[0]!.adjustments = [{ kind: "discount", amount: "2.28" }];
    delete input.result.lines[1]!.listGross;
    delete input.result.billAdjustments;
    expect(tableOf(buildReceiptDocument(input)).rows.map((r) => [r.item, r.amount])).toEqual([
      ["Hamburguesa", "9,92"],
      ["Descuento", "-1,89"],
      ["Pan de pueblo", "2,05"],
    ]);
  });

  const jamon = (comped: boolean) => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Jamón ibérico" },
        unitName: { es: "kg" },
        quantity: "0.123",
        gross: comped ? "0.00" : "2.65",
        listGross: "2.95",
        listUnitPriceGross: "24.00",
        net: comped
          ? { unitPrice: "0.00", priceQuantity: "1.000", base: "0.00", tax: "0.00", rate: "10.00" }
          : {
              unitPrice: "19.62",
              priceQuantity: "1.000",
              base: "2.41",
              tax: "0.24",
              rate: "10.00",
            },
        adjustments: [
          comped
            ? { kind: "comp", amount: "2.95" }
            : { kind: "discount", percentBp: 1000, amount: "0.30" },
        ],
      },
    ];
    input.result.vatBreakdown = [
      comped
        ? { rate: "10.00", base: "0.00", tax: "0.00" }
        : { rate: "10.00", base: "2.41", tax: "0.24" },
    ];
    input.result.total = comped ? "0.00" : "2.65";
    return tableOf(buildReceiptDocument(input)).rows;
  };

  it("prints the jamón under a kilo at its price, with its own discount (owner, Q9)", () => {
    expect(jamon(false)).toMatchObject([
      { units: "0.123 kg", item: "Jamón ibérico", price: "21,82", amount: "2,68" },
      { item: "Descuento 10%", amount: "-0,27" },
    ]);
  });

  it("prints a comped jamón's value and an invitation", () => {
    expect(jamon(true)).toMatchObject([
      { units: "0.123 kg", item: "Jamón ibérico", price: "21,82", amount: "2,68" },
      { item: "Invitación", amount: "-2,68" },
    ]);
  });

  it("prints no «Precio sin IVA» line and no per-item Base or IVA line", () => {
    const captions = amountRows(buildReceiptDocument(FULL_INVOICE_DOCUMENT_FIXTURE)).map(
      ([c]) => c,
    );
    expect(captions).not.toContain("Precio sin IVA");
    expect(captions.filter((c) => c!.startsWith("Base"))).toEqual([
      "Base imponible 21%",
      "Base imponible 10%",
    ]);
  });

  it("prints only the dish with no filed net figures as a with-VAT row, the rest as a table", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    delete input.result.lines[0]!.net;
    const document = buildReceiptDocument(input);
    expect(amountRows(document)).toEqual(
      expect.arrayContaining([
        ["1  Menú del día con un nombre especialmente largo (IVA incluido)", "12,10 €"],
        ["Descuento 10% (IVA incluido)", "-1,21 €"],
      ]),
    );
    const tables = document.elements.flatMap((e) => (e.kind === "table" ? [e.table] : []));
    expect(tables.flatMap((t) => t.rows.map((r) => r.item))).toEqual(["Agua mineral"]);
  });

  it("prints a with-VAT dish priced per pack by its quantity and unit, not its count of packs", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Jamón ibérico" },
        unitName: { es: "kg" },
        quantity: "0.300",
        gross: "9.00",
        net: { unitPrice: "2.73", priceQuantity: "0.100", base: "8.18", tax: "0.82", rate: "10" },
      },
      {
        descriptions: { "es-ES": "Pan" },
        parentLineNo: 1,
        unitName: { es: "ud" },
        quantity: "1",
        gross: "1.00",
      },
    ];
    expect(amountRows(buildReceiptDocument(input))).toContainEqual([
      "0.300 kg  Jamón ibérico (IVA incluido)",
      "9,00 €",
    ]);
  });

  it("prints a with-VAT group's extra as the dish prints its quantity: a count in Each is bare", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.result.lines = [
      {
        descriptions: { "es-ES": "Tostada" },
        unitName: { es: "ud" },
        quantity: "1",
        gross: "3.00",
      },
      {
        descriptions: { "es-ES": "Pan" },
        parentLineNo: 1,
        unitName: { es: "ud" },
        quantity: "2",
        gross: "1.00",
      },
      {
        descriptions: { "es-ES": "Jamón" },
        parentLineNo: 1,
        unitName: { es: "kg" },
        quantity: "0.050",
        gross: "2.00",
      },
    ];
    expect(amountRows(buildReceiptDocument(input))).toEqual(
      expect.arrayContaining([
        ["Pan 2", "1,00 €"],
        ["Jamón 0.050 kg", "2,00 €"],
      ]),
    );
  });
});
