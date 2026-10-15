import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";
import { INVOICE_PAGE_WIDTH, layoutInvoicePages, type InvoicePageElement } from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { sampleDocument } from "./sample-receipt.js";

async function rendered(input: ReceiptDocumentInput = fixture) {
  const { renderInvoicePdf } = await import("./invoice-pdf.js");
  const bytes = await renderInvoicePdf(input);
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      pages.push({
        text,
        viewport,
        qr: jsQR(pixels.data, canvas.width, canvas.height),
        content,
        pixels,
      });
    }
    return { bytes, pages, metadata: await pdf.getMetadata() };
  } finally {
    await loading.destroy();
  }
}

describe("A4 invoice PDF", () => {
  it("carries the saved identity, dates, discounted amounts and cent-exact VAT summary", async () => {
    const { pages, metadata } = await rendered();
    expect((metadata.info as { CreationDate: string; ModDate: string }).CreationDate).toBe(
      "D:20260817223400Z",
    );
    expect((metadata.info as { CreationDate: string; ModDate: string }).ModDate).toBe(
      "D:20260817223400Z",
    );
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.viewport.width / 2).toBeCloseTo(595.28, 2);
    expect(page.viewport.height / 2).toBeCloseTo(841.89, 2);
    for (const text of [
      "Charcutería La Buena SL",
      "B12345678",
      "Calle del domicilio fiscal original número 27, edificio de la plaza mayor, segunda planta, Madrid 28001",
      "Cliente de nombre largo y completo Sociedad Limitada",
      "B11223344",
      "Avenida del cliente original número 123, edificio de la estación, tercera planta, Madrid 28002",
      "Factura FF/1",
      "Fecha 18 ago 2026, 0:34",
      "Fecha de operación 17 ago 2026",
      "Menú del día con un nombre especialmente largo",
      "Precio sin IVA 10,00 € / 1",
      "Descuento 10% (IVA incluido) -1,21 €",
      "Base 21% 9,00 € IVA 21% 1,89 € Base 10% 8,00 € IVA 10% 0,80 €",
      "TOTAL 19,69 €",
      "Efectivo 20,00 €",
      "Cambio 0,31 €",
    ])
      expect(page.text).toContain(text);
    expect(page.text).not.toContain("Current mutable");
    expect(page.text).not.toContain("DUPLICADO");
    expect(page.text).not.toContain("PRUEBA - SIN COBRO REAL");
    expect((await rendered()).bytes).toEqual((await rendered()).bytes);
  });

  it("draws a centred 35 mm filed QR on the first page with its body-size legend", async () => {
    const { pages } = await rendered();
    const page = pages[0]!;
    expect(page.qr?.data).toBe(fixture.result.qr);
    const qr = page.qr!;
    // jsQR's corners bound the modules.
    const modules = qr.version * 4 + 17;
    const dark = (row: number, col: number): boolean => {
      const x = Math.floor(
        qr.location.topLeftCorner.x +
          ((col + 0.5) * (qr.location.topRightCorner.x - qr.location.topLeftCorner.x)) / modules,
      );
      const y = Math.floor(
        qr.location.topLeftCorner.y +
          ((row + 0.5) * (qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y)) / modules,
      );
      return page.pixels.data[(y * page.pixels.width + x) * 4]! < 128;
    };
    let format = 0;
    for (let bit = 0; bit < 15; bit++) {
      const row = bit < 6 ? bit : bit < 8 ? bit + 1 : modules - 15 + bit;
      if (dark(row, 8)) format |= 1 << bit;
    }
    expect((format ^ 0b101010000010010) >> 13, "drawn QR correction level M").toBe(0);

    const moduleWidth = (qr.location.topRightCorner.x - qr.location.topLeftCorner.x) / modules;
    expect((moduleWidth * modules) / 2).toBeCloseTo((35 * 72) / 25.4, 0);
    expect((qr.location.topLeftCorner.x + qr.location.topRightCorner.x) / 2).toBeCloseTo(
      page.viewport.width / 2,
      0,
    );
    const legend = page.content.items.find((item) => "str" in item && item.str === "VERI*FACTU");
    expect(legend).toBeDefined();
    expect("height" in legend! ? legend.height : undefined).toBeCloseTo(10, 1);
  });

  it("wraps long unbroken names, paginates without clipping and never repeats the QR", async () => {
    const marker = "ABCDEFGHIJ".repeat(25);
    const input = {
      ...fixture,
      result: {
        ...fixture.result,
        lines: Array.from({ length: 35 }, (_, index) => ({
          ...fixture.result.lines[0]!,
          descriptions: { "es-ES": `Dish ${index} ${marker}` },
        })),
      },
    };
    const { pages } = await rendered(input);
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.map((page) => page.text).join(" ");
    expect(text).toContain("Dish 34");
    expect(text).toContain("Cambio 0,31 €");
    expect(text.replace(/\s/g, "").split(marker)).toHaveLength(36);
    expect(pages.filter((page) => page.qr !== null)).toHaveLength(1);
    expect(pages[0]!.qr?.data).toBe(fixture.result.qr);
    for (const page of pages) {
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(35);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(561);
        expect(item.transform[5]).toBeGreaterThan(35);
        expect(item.transform[5] + item.height).toBeLessThan(807);
      }
    }
  });

  it("keeps an unbroken customer name and ignores a whitespace-only optional subtitle", async () => {
    const name = "ABCDEFGHIJ".repeat(90);
    const input = {
      ...fixture,
      receipt: { ...fixture.receipt, headerSubtitle: " " },
      result: { ...fixture.result, recipient: { ...fixture.result.recipient!, legalName: name } },
    };
    const { pages, bytes } = await rendered(input);
    expect(
      pages
        .map((page) => page.text)
        .join("")
        .replace(/\s/g, ""),
    ).toContain(name);
    expect(bytes).toEqual(
      (await rendered({ ...input, receipt: { ...input.receipt, headerSubtitle: "" } })).bytes,
    );
    for (const page of pages)
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(561);
      }
  });

  it("marks a practice duplicate and omits a QR when the stored invoice has none", async () => {
    const { pages } = await rendered({
      ...fixture,
      duplicate: true,
      simulated: true,
      result: { ...fixture.result, qr: "" },
    });
    expect(pages[0]!.text).toContain("DUPLICADO");
    expect(pages[0]!.text).toContain("PRUEBA - SIN COBRO REAL");
    expect(pages[0]!.text).not.toContain("VERI*FACTU");
    expect(pages[0]!.qr).toBeNull();
  });
});

describe("department A4 presentation", () => {
  it("draws the stored mono logo centered and proportionate before the trading name and subtitle", async () => {
    const input = {
      ...fixture,
      logo: { widthDots: 80, heightDots: 40, bits: new Uint8Array(400).fill(255) },
      receiptHeader: { tradingName: "Recorded dining name", printTradingName: true },
      receipt: { headerSubtitle: "Department subtitle" },
      venueAddress: ["Optional current street must not print"],
    };
    const { pages } = await rendered(input);
    const page = pages[0]!;
    expect(page.text.indexOf("Recorded dining name")).toBeLessThan(
      page.text.indexOf("Department subtitle"),
    );
    expect(page.text.indexOf("Department subtitle")).toBeLessThan(
      page.text.indexOf("Charcutería La Buena SL"),
    );
    expect(page.text).not.toContain("Optional current street");
    expect(page.text).toContain("Calle del domicilio fiscal original");
    expect(page.qr?.data).toBe(fixture.result.qr);
    const logo = layoutInvoicePages(input)[0]!.elements.find((element) => element.kind === "logo");
    expect(logo).toBeDefined();
    if (!logo || logo.kind !== "logo") throw new Error("Missing logo");
    expect(logo.width).toBeCloseTo(28.37, 2);
    expect(logo.height).toBeCloseTo(14.19, 2);
    const dark: { x: number; y: number }[] = [];
    for (let y = Math.floor(logo.y * 2); y < Math.ceil((logo.y + logo.height) * 2); y++)
      for (let x = 520; x < 670; x++)
        if (page.pixels.data[(y * page.pixels.width + x) * 4]! < 128) dark.push({ x, y });
    expect(dark.length).toBeGreaterThan(1000);
    const xs = dark.map((p) => p.x),
      ys = dark.map((p) => p.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(page.viewport.width / 2, 0);
    expect(
      (Math.max(...xs) - Math.min(...xs) + 1) / (Math.max(...ys) - Math.min(...ys) + 1),
    ).toBeCloseTo(2, 1);
  });
});

describe("A4 optional address and logo controls", () => {
  it.each(["Filed fiscal street", undefined])(
    "omits current address with filed domicile %s",
    async (domicile) => {
      const { pages } = await rendered({
        ...fixture,
        venueAddress: ["Optional current street"],
        receipt: {},
        result: { ...fixture.result, issuer: { ...fixture.result.issuer!, domicile } },
      });
      expect(pages[0]!.text).not.toContain("Optional current street");
      if (domicile) expect(pages[0]!.text).toContain("Filed fiscal street");
      else expect(pages[0]!.text).not.toContain("Filed fiscal street");
      expect(pages[0]!.qr?.data).toBe(fixture.result.qr);
    },
  );
  it("has no logo element without a selected printable picture", () => {
    expect(
      layoutInvoicePages(fixture)
        .flatMap((page) => page.elements)
        .filter((element) => element.kind === "logo"),
    ).toEqual([]);
  });
});

describe("A4 line above the total and space around the logo", () => {
  const LINE = 14;
  const logo = { widthDots: 80, heightDots: 40, bits: new Uint8Array(400).fill(255) };
  const textAt = (elements: InvoicePageElement[], start: string) =>
    elements.find((element) => element.kind === "text" && element.text.startsWith(start));

  it("puts a rule across the content width directly above TOTAL, and rules between sections", () => {
    const elements = layoutInvoicePages(fixture)[0]!.elements;
    const total = elements.findIndex(
      (element) => element.kind === "text" && element.text.startsWith("TOTAL"),
    );
    const rule = elements[total - 1];
    const rules = elements.filter(
      (element): element is Extract<InvoicePageElement, { kind: "rule" }> =>
        element.kind === "rule",
    );
    if (rule?.kind !== "rule") throw new Error(`expected a rule before TOTAL, got ${rule?.kind}`);
    expect(rules.length).toBeGreaterThan(1);
    for (const each of rules) expect([each.x, each.width]).toEqual([rule.x, rule.width]);
    expect(rule.x).toBe(36);
    expect(rule.width).toBeCloseTo(595.28 - 72, 2);
    expect(rule.thickness).toBeGreaterThan(0);
    expect(rule.thickness).toBeLessThanOrEqual(1);
    const above = elements[total - 2]!;
    expect(above.kind).toBe("text");
    expect(rule.y).toBeCloseTo(above.y + LINE + (LINE / 2 - rule.thickness) / 2, 5);
    expect(rule.y + rule.thickness).toBeLessThan(elements[total]!.y);
  });

  it("keeps the rule on the same page as TOTAL when the invoice runs onto a second page", () => {
    const ruleThenTotal = (input: ReceiptDocumentInput) => {
      const pages = layoutInvoicePages(input);
      const page = pages.findIndex((candidate) =>
        candidate.elements.some(
          (element) => element.kind === "text" && element.text.startsWith("TOTAL"),
        ),
      );
      const elements = pages[page]!.elements;
      const total = elements.findIndex(
        (element) => element.kind === "text" && element.text.startsWith("TOTAL"),
      );
      return { page, before: elements[total - 1]?.kind };
    };
    const longInvoice = (count: number, simulated: boolean, qr: string) => ({
      ...fixture,
      simulated,
      receipt: { ...fixture.receipt, headerSubtitle: undefined },
      result: {
        ...fixture.result,
        qr,
        lines: Array.from({ length: count }, () => fixture.result.lines[1]!),
      },
    });

    expect(ruleThenTotal(longInvoice(20, false, fixture.result.qr))).toEqual({
      page: 2,
      before: "rule",
    });
    // Each count leaves room for the rule but not for TOTAL at the foot of a page.
    for (const [count, simulated, qr] of [
      [9, false, ""],
      [6, true, fixture.result.qr],
      [22, true, ""],
    ] as const)
      expect(
        ruleThenTotal(longInvoice(count, simulated, qr)).before,
        `${count} lines, simulated ${simulated}, QR ${qr !== ""}`,
      ).toBe("rule");
  });

  it("moves the rule onto the next page with a double-size TOTAL that does not fit below it", () => {
    const repeated = (count: number) => ({
      ...fixture,
      result: {
        ...fixture.result,
        lines: Array.from({ length: count }, () => fixture.result.lines[0]!),
      },
    });
    const pages = layoutInvoicePages(repeated(37));
    expect(pages.length).toBeGreaterThan(1);
    for (const [index, page] of pages.slice(0, -1).entries())
      expect(page.elements.at(-1)?.kind, `page ${index + 1} ends with`).not.toBe("rule");
    const page = pages.find((candidate) =>
      candidate.elements.some((e) => e.kind === "text" && e.text.startsWith("TOTAL")),
    )!;
    const total = page.elements.findIndex(
      (element) => element.kind === "text" && element.text.startsWith("TOTAL"),
    );
    const rule = page.elements[total - 1]!;
    if (rule.kind !== "rule") throw new Error(`expected a rule before TOTAL, got ${rule.kind}`);
    expect(page.elements[total]!.y).toBeCloseTo(rule.y + (LINE / 2 + rule.thickness) / 2, 5);
  });

  it("moves every rule in a row onto the next page with the element after them", async () => {
    vi.resetModules();
    vi.doMock("./receipt-document.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./receipt-document.js")>()),
      buildReceiptDocument: (input: { result: { lines: unknown[] } }) => ({
        duplicate: false,
        practice: false,
        elements: [
          ...input.result.lines.map((_, index) => ({
            kind: "text",
            text: `Line ${index}`,
            indent: 0,
          })),
          { kind: "rule" },
          { kind: "rule" },
          { kind: "text", text: "TOTAL", indent: 0, style: { double: true } },
        ],
      }),
    }));
    try {
      const { layoutInvoicePages: layout } = await import("./invoice-page.js");
      for (let count = 40; count <= 70; count++) {
        const pages = layout({
          ...fixture,
          result: { ...fixture.result, lines: Array(count).fill(fixture.result.lines[0]) },
        });
        for (const [index, page] of pages.slice(0, -1).entries())
          expect(
            page.elements.at(-1)?.kind,
            `${count} lines: page ${index + 1} ends with`,
          ).not.toBe("rule");
        expect(
          pages
            .at(-1)!
            .elements.slice(-3)
            .map((element) => element.kind),
          `${count} lines`,
        ).toEqual(["rule", "rule", "text"]);
      }
    } finally {
      vi.doUnmock("./receipt-document.js");
      vi.resetModules();
    }
  });

  it("draws the rule as a dark line in the PDF and never as a QR", async () => {
    const input = { ...fixture, result: { ...fixture.result, qr: "" } };
    const rule = layoutInvoicePages(input)[0]!.elements.find((element) => element.kind === "rule");
    if (rule?.kind !== "rule") throw new Error("Missing rule");
    const { pages } = await rendered(input);
    const page = pages[0]!;
    expect(page.qr).toBeNull();
    const row = Math.floor((rule.y + rule.thickness / 2) * 2);
    const dark = (x: number) => page.pixels.data[(row * page.pixels.width + x) * 4]! < 128;
    let drawn = 0;
    for (let x = 36 * 2 + 2; x < (595.28 - 36) * 2 - 2; x++) if (dark(x)) drawn++;
    expect(drawn).toBe(Math.ceil((595.28 - 36) * 2 - 2) - (36 * 2 + 2));
    expect(dark(36 * 2 - 3)).toBe(false);
    expect(dark(Math.ceil((595.28 - 36) * 2) + 3)).toBe(false);
  });

  it("leaves half a line above and below a drawn logo, and no extra space without one", () => {
    const withLogo = layoutInvoicePages({ ...fixture, logo })[0]!.elements;
    const index = withLogo.findIndex((element) => element.kind === "logo");
    const drawn = withLogo[index]!;
    if (drawn.kind !== "logo") throw new Error("Missing logo");
    const before = withLogo[index - 1]!;
    expect(before.kind === "text" && before.text).toBe("Factura completa");
    expect(drawn.y - (before.y + LINE)).toBeCloseTo(LINE / 2, 5);
    const after = withLogo[index + 1]!;
    expect(after.y - (drawn.y + drawn.height)).toBeCloseTo(LINE / 2, 5);

    const without = layoutInvoicePages(fixture)[0]!.elements;
    const name = "Charcutería La Buena SL";
    expect(textAt(withLogo, name)!.y - textAt(without, name)!.y).toBeCloseTo(
      drawn.height + LINE,
      5,
    );
  });

  it("does not stack the logo's space on the rule after the QR", () => {
    const elements = layoutInvoicePages({
      ...fixture,
      logo,
      result: { ...fixture.result, invoiceType: "F2" },
    })[0]!.elements;
    const index = elements.findIndex((element) => element.kind === "logo");
    const drawn = elements[index]!;
    expect(elements[index - 1]!.kind).toBe("rule");
    const legend = elements[index - 2]!;
    expect(legend.kind === "text" && legend.text).toBe("VERI*FACTU");
    expect(drawn.y - (legend.y + LINE)).toBeCloseTo(LINE / 2, 5);
  });
});

describe("A4 QR black square", () => {
  const MM = 72 / 25.4;
  const LINE = 14;
  const codes = [
    {
      name: "sample sale",
      input: sampleDocument({ caption: "QR tributario:", legend: "VERI*FACTU" }),
      modules: 33,
    },
    { name: "AEAT validation URL", input: fixture, modules: 45 },
  ];

  it.each(codes)(
    "lays out a 35 mm square of modules with a four-module quiet zone for the $name",
    ({ input, modules }) => {
      const elements = layoutInvoicePages(input)[0]!.elements;
      const index = elements.findIndex((element) => element.kind === "qr");
      const qr = elements[index]!;
      if (qr.kind !== "qr") throw new Error("Missing QR");
      expect(qr.modules).toHaveLength(modules);
      const side = qr.modules.length * qr.moduleSize;
      expect(Math.abs(side - 35 * MM)).toBeLessThanOrEqual(qr.moduleSize / 2);
      expect(qr.x + side / 2).toBeCloseTo(INVOICE_PAGE_WIDTH / 2, 5);
      const caption = elements[index - 1]!;
      const legend = elements[index + 1]!;
      expect(caption.kind === "text" && caption.text).toBe("QR tributario:");
      expect(legend.kind === "text" && legend.text).toBe("VERI*FACTU");
      expect(qr.y - 4 * qr.moduleSize).toBeGreaterThanOrEqual(caption.y + LINE - 1e-9);
      expect(legend.y).toBeGreaterThanOrEqual(qr.y + side + 4 * qr.moduleSize - 1e-9);
    },
  );

  it.each(codes)("draws a 35 mm black square in the PDF for the $name", async ({ input }) => {
    const { pages } = await rendered(input);
    const page = pages[0]!;
    const qr = page.qr!;
    expect(qr.data).toBe(input.result.qr);
    const modules = qr.version * 4 + 17;
    const pitch = (qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y) / modules;
    const row = Math.floor(qr.location.topLeftCorner.y + 3.5 * pitch);
    const dark: number[] = [];
    for (let x = 0; x < page.pixels.width; x++)
      if (page.pixels.data[(row * page.pixels.width + x) * 4]! < 128) dark.push(x);
    const millimetres = (dark.at(-1)! - dark[0]! + 1) / 2 / MM;
    expect(Math.abs(millimetres - 35), `${millimetres} mm`).toBeLessThanOrEqual(35 / modules / 2);
  });
});

describe("A4 TOTAL size", () => {
  it("draws TOTAL at twice the body size", () => {
    const total = layoutInvoicePages(fixture)[0]!.elements.find(
      (element) => element.kind === "text" && element.text.startsWith("TOTAL"),
    );
    expect(total).toMatchObject({ kind: "text", size: 20 });
  });
});
