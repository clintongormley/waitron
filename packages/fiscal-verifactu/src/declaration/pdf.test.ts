import { afterEach, describe, expect, it, vi } from "vitest";
import { declarationSource as source, testProducer as producer } from "../../test/declaration.js";
import { pdfPages as pages } from "../../test/declaration-pdf.js";
import { renderDeclarationPdf } from "./pdf.js";

const missing = vi.hoisted(() => new Set<number>());

// The package font draws every character the declaration uses, so a test hides some of them.
vi.mock("fontkit", async (importOriginal) => {
  const fontkit = await importOriginal<typeof import("fontkit")>();
  return {
    ...fontkit,
    create: (...args: Parameters<typeof fontkit.create>) => {
      const font = fontkit.create(...args) as import("fontkit").Font;
      const has = font.hasGlyphForCodePoint.bind(font);
      font.hasGlyphForCodePoint = (point) => !missing.has(point) && has(point);
      return font;
    },
  };
});

afterEach(() => missing.clear());

describe("renderDeclarationPdf", () => {
  it("draws the real template on A4 pages with the producer's values", async () => {
    const read = await pages(await renderDeclarationPdf(source, producer));
    for (const page of read) {
      expect(page.width).toBeCloseTo(595.28, 1);
      expect(page.height).toBeCloseTo(841.89, 1);
    }
    const text = read.map((page) => page.text).join(" ");
    expect(text).toContain("DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN");
    expect(text).toContain("00000000T");
    expect(text).toContain("España");
  });

  it("refuses a character the font cannot draw, naming its code point", async () => {
    await expect(
      renderDeclarationPdf(source, { ...producer, name: "PRODUCER 漢 PERSON" }),
    ).rejects.toThrow("U+6F22");
  });

  it("refuses a font that cannot draw the list's bullet", async () => {
    missing.add(0x2022);

    await expect(renderDeclarationPdf(source, producer)).rejects.toThrow("U+2022");
  });
});
