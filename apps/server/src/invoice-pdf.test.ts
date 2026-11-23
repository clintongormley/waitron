import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";
import type { InvoicePageElement } from "./invoice-page.js";

describe("A4 weights, tones and shaded boxes in the PDF", () => {
  /** Renders a page of exactly these elements. */
  const pdfOf = async (elements: InvoicePageElement[]): Promise<Buffer> => {
    vi.resetModules();
    vi.doMock("./invoice-layout.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./invoice-layout.js")>()),
      layoutA4Invoice: () => [{ elements }],
    }));
    try {
      const { renderInvoicePdf } = await import("./invoice-pdf.js");
      return await renderInvoicePdf(fixture);
    } finally {
      vi.doUnmock("./invoice-layout.js");
      vi.resetModules();
    }
  };
  /** The page painted at two pixels per point. */
  const painted = async (bytes: Buffer) => {
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    const pdf = await loading.promise;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
      const rgb = (x: number, y: number) => {
        const at = (Math.round(y * 2) * width + Math.round(x * 2)) * 4;
        return [data[at]!, data[at + 1]!, data[at + 2]!];
      };
      /** The darkest red channel inside a box given in points. */
      const darkest = (x: number, y: number, w: number, h: number) => {
        let min = 255;
        for (let row = y * 2; row < (y + h) * 2; row++)
          for (let col = x * 2; col < (x + w) * 2; col++)
            min = Math.min(min, data[(row * width + col) * 4]!);
        return min;
      };
      return { rgb, darkest };
    } finally {
      await loading.destroy();
    }
  };
  const text = (
    value: string,
    x: number,
    y: number,
    style: Partial<Extract<InvoicePageElement, { kind: "text" }>> = {},
  ): InvoicePageElement => ({
    kind: "text",
    text: value,
    x,
    y,
    size: 40,
    weight: "regular",
    tone: "ink",
    ...style,
  });

  it("embeds the bold face only for bold text", async () => {
    const bold = (await pdfOf([text("Total", 36, 36, { weight: "bold" })])).toString("latin1");
    expect(bold).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Bold\b/u);
    const regular = (await pdfOf([text("Total", 36, 36)])).toString("latin1");
    expect(regular).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular\b/u);
    expect(regular).not.toContain("NotoSans-Bold");
  });

  it("draws muted text #6b6b6b and ink text black", async () => {
    const page = await painted(
      await pdfOf([text("HHH", 36, 36, { tone: "muted" }), text("HHH", 36, 136)]),
    );
    expect(page.darkest(36, 36, 200, 60)).toBe(0x6b);
    expect(page.darkest(36, 136, 200, 60)).toBe(0);
  });

  it("fills a heading box #e4e4e8 and a panel box #f2f2f4", async () => {
    const page = await painted(
      await pdfOf([
        { kind: "box", x: 36, y: 36, width: 200, height: 40, fill: "heading" },
        { kind: "box", x: 36, y: 136, width: 200, height: 40, fill: "panel" },
      ]),
    );
    expect(page.rgb(136, 56)).toEqual([0xe4, 0xe4, 0xe8]);
    expect(page.rgb(136, 156)).toEqual([0xf2, 0xf2, 0xf4]);
  });

  it.each([
    {
      name: "a box",
      before: (y: number): InvoicePageElement => ({
        kind: "box",
        x: 300,
        y,
        width: 200,
        height: 40,
        fill: "heading",
      }),
    },
    {
      name: "a muted label",
      before: (y: number): InvoicePageElement => text("HHH", 300, y, { tone: "muted" }),
    },
  ])("draws a QR, a rule, a logo and ink text pure black after $name", async ({ before }) => {
    const page = await painted(
      await pdfOf([
        before(36),
        { kind: "qr", modules: [[true]], x: 36, y: 36, moduleSize: 30 },
        before(136),
        { kind: "rule", x: 36, y: 136, width: 200, thickness: 6 },
        before(236),
        {
          kind: "logo",
          raster: { widthDots: 8, heightDots: 8, bits: new Uint8Array(8).fill(255) },
          x: 36,
          y: 236,
          width: 30,
          height: 30,
        },
        before(336),
        text("HHH", 36, 336),
      ]),
    );
    expect(page.rgb(51, 51)).toEqual([0, 0, 0]);
    expect(page.rgb(136, 139)).toEqual([0, 0, 0]);
    expect(page.rgb(51, 251)).toEqual([0, 0, 0]);
    expect(page.darkest(36, 336, 200, 60)).toBe(0);
  });
});
