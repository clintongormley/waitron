import { describe, expect, it, vi } from "vitest";
import { invoiceBoldFont } from "./invoice-font.js";
import {
  INVOICE_PAGE_HEIGHT,
  INVOICE_PAGE_WIDTH,
  type InvoicePageElement,
} from "./invoice-page.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";

describe("A4 office raster weights, tones and shaded boxes", () => {
  /** A 300 dpi page of exactly these elements. */
  const rasterOf = async (elements: InvoicePageElement[]) => {
    vi.resetModules();
    vi.doMock("./invoice-layout.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./invoice-layout.js")>()),
      layoutA4Invoice: () => [{ elements }],
    }));
    try {
      const { renderInvoiceRaster } = await import("./invoice-raster.js");
      const [page] = await renderInvoiceRaster(fixture, 300);
      const dots = 300 / 72;
      const at = (x: number, y: number) =>
        page!.pixels[Math.round(y * dots) * page!.width + Math.round(x * dots)]!;
      /** The darkest grey inside a box given in points. */
      const darkest = (x: number, y: number, w: number, h: number) => {
        let min = 255;
        for (let row = Math.round(y * dots); row < Math.round((y + h) * dots); row++)
          for (let col = Math.round(x * dots); col < Math.round((x + w) * dots); col++)
            min = Math.min(min, page!.pixels[row * page!.width + col]!);
        return min;
      };
      let ink = 0;
      for (const value of page!.pixels) if (value < 128) ink++;
      return { at, darkest, ink };
    } finally {
      vi.doUnmock("./invoice-layout.js");
      vi.resetModules();
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
  /** The grey sharp's greyscale gives an sRGB colour, Rec. 709 luma. */
  const grey = (red: number, green: number, blue: number) =>
    0.2126 * red + 0.7152 * green + 0.0722 * blue;

  it("draws bold text in the bold face, with more ink than the same text regular", async () => {
    const regular = await rasterOf([text("Total", 36, 36)]);
    const bold = await rasterOf([text("Total", 36, 36, { weight: "bold" })]);
    expect(regular.ink).toBeGreaterThan(0);
    expect(bold.ink).toBeGreaterThan(regular.ink * 1.1);
  });

  it("draws bold text as the bold face's outlines filled, with no stroke around them", async () => {
    const { default: sharp } = await import("sharp");
    const size = 40 / invoiceBoldFont().unitsPerEm;
    const run = invoiceBoldFont().layout("Total");
    let x = 36;
    const paths = run.glyphs.map((glyph, index) => {
      const drawn = `<path transform="translate(${x} ${36 + invoiceBoldFont().ascent * size}) scale(${size} ${-size})" d="${glyph.path.toSVG()}" fill="#000000"/>`;
      x += run.positions[index]!.xAdvance * size;
      return drawn;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2480" height="3508" viewBox="0 0 ${INVOICE_PAGE_WIDTH} ${INVOICE_PAGE_HEIGHT}"><rect width="${INVOICE_PAGE_WIDTH}" height="${INVOICE_PAGE_HEIGHT}" fill="white"/>${paths.join("")}</svg>`;
    const outlines = await sharp(Buffer.from(svg)).greyscale().removeAlpha().raw().toBuffer();
    let expected = 0;
    for (const value of outlines) if (value < 128) expected++;
    const bold = await rasterOf([text("Total", 36, 36, { weight: "bold" })]);
    expect(expected).toBeGreaterThan(0);
    expect(Math.abs(bold.ink - expected)).toBeLessThanOrEqual(expected * 0.01);
  });

  it("draws muted text in the grey of #6b6b6b and ink text black", async () => {
    const page = await rasterOf([text("HHH", 36, 36, { tone: "muted" }), text("HHH", 36, 136)]);
    expect(Math.abs(page.darkest(36, 36, 200, 60) - grey(0x6b, 0x6b, 0x6b))).toBeLessThanOrEqual(2);
    expect(page.darkest(36, 136, 200, 60)).toBe(0);
  });

  it("fills a heading box and a panel box in the greys of their fills", async () => {
    const page = await rasterOf([
      { kind: "box", x: 36, y: 36, width: 200, height: 40, fill: "heading" },
      { kind: "box", x: 36, y: 136, width: 200, height: 40, fill: "panel" },
    ]);
    expect(Math.abs(page.at(136, 56) - grey(0xe4, 0xe4, 0xe8))).toBeLessThanOrEqual(2);
    expect(Math.abs(page.at(136, 156) - grey(0xf2, 0xf2, 0xf4))).toBeLessThanOrEqual(2);
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
  ])(
    "still draws a QR, a rule, a logo and ink text black when each follows $name on the office image",
    async ({ before }) => {
      const page = await rasterOf([
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
      ]);
      expect(page.at(51, 51)).toBe(0);
      expect(page.at(136, 139)).toBe(0);
      expect(page.at(51, 251)).toBe(0);
      expect(page.darkest(36, 336, 200, 60)).toBe(0);
    },
  );
});
