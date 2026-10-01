import { describe, expect, it } from "vitest";
import { TEXT_BAND_HEIGHT, readRasterText } from "@waitron/printing";
import { RULER_WIDTHS, formatTestPage } from "./test-page.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

interface Picture {
  widthDots: number;
  heightDots: number;
  dot: (x: number, y: number) => boolean;
  data: Uint8Array;
}

/** Every `GS v 0` image in the page that is not a drawn line of text, in order. */
function pictures(bytes: Uint8Array): Picture[] {
  return printedCommands(bytes)
    .filter((command) => command.name === "GS v 0" && command.text === undefined)
    .map(({ bytes: image, widthDots, heightDots }) => {
      const stride = widthDots! / 8;
      const data = image.subarray(8);
      return {
        widthDots: widthDots!,
        heightDots: heightDots!,
        data,
        dot: (x, y) => (data[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0,
      };
    });
}

/** The `width` × {@link TEXT_BAND_HEIGHT} part of `picture` from (`left`, `top`), read as text. */
function readAt(picture: Picture, left: number, top: number, width: number): string | undefined {
  const stride = Math.ceil(width / 8);
  const data = new Uint8Array(stride * TEXT_BAND_HEIGHT);
  for (let y = 0; y < TEXT_BAND_HEIGHT; y++) {
    for (let x = 0; x < width; x++) {
      if (picture.dot(left + x, top + y)) data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return readRasterText(width, TEXT_BAND_HEIGHT, data);
}

const ruler = (): Picture => pictures(formatTestPage({ locale: "en-GB" }))[0]!;

describe("formatTestPage", () => {
  it("opens with a 576-dot print area, the widest any paper width and resolution draws", () => {
    const names = printedCommands(formatTestPage({ locale: "en-GB" })).map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(["ESC @", "GS L", "GS W"]);
    const bytes = formatTestPage({ locale: "en-GB" });
    expect([...bytes.subarray(6, 10)]).toEqual([0x1d, 0x57, 576 & 0xff, 576 >> 8]);
  });

  it("asks for the last number on the ruler that is fully visible", () => {
    const en = printedLines(formatTestPage({ locale: "en-GB" })).join(" ");
    const es = printedLines(formatTestPage({ locale: "es-ES" })).join(" ");
    expect(en).toContain("last number");
    expect(es).toContain("¿Cuál es el último número de la regla");
  });

  it("draws a ruler 576 dots wide with a short tick every 8 dots", () => {
    const r = ruler();
    expect(r.widthDots).toBe(576);
    const long = new Set(RULER_WIDTHS.flatMap(({ widthDots }) => [widthDots - 2, widthDots - 1]));
    const bottom = r.heightDots - 4;
    for (let x = 0; x < 576; x++) {
      expect(r.dot(x, bottom), `dot ${x}`).toBe(x % 8 === 7 || long.has(x));
    }
  });

  it("draws a long tick at each of the four widths a paper setting can draw", () => {
    expect(RULER_WIDTHS.map(({ widthDots }) => widthDots)).toEqual([360, 384, 512, 576]);
    const r = ruler();
    const longTicks = Array.from({ length: 576 }, (_, x) => x).filter((x) =>
      r.dot(x, r.heightDots - 14),
    );
    expect(longTicks).toEqual([358, 359, 382, 383, 510, 511, 574, 575]);
  });

  it("labels each long tick with its number, ending at the tick, the labels of one row apart", () => {
    const r = ruler();
    const rows = new Map<number, [number, number][]>();
    for (const { widthDots, row } of RULER_WIDTHS) {
      const label = String(widthDots);
      const right = widthDots - 2;
      const left = right - label.length * 12;
      expect(readAt(r, left, row * TEXT_BAND_HEIGHT, right - left), label).toBe(label);
      rows.set(row, [...(rows.get(row) ?? []), [left, right]]);
    }
    expect([...rows.keys()].sort()).toEqual([0, 1]);
    for (const spans of rows.values()) {
      const sorted = spans.sort(([a], [b]) => a - b);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]![0]).toBeGreaterThanOrEqual(sorted[i - 1]![1]);
    }
  });

  it("wraps every caption to 30 columns on a 360-dot image, so it fits the narrowest paper", () => {
    for (const locale of ["es-ES", "en-GB"] as const) {
      const bytes = formatTestPage({ locale });
      for (const line of printedLines(bytes)) expect(line.length, line).toBeLessThanOrEqual(30);
      const captions = printedCommands(bytes).filter((command) => command.text !== undefined);
      expect(captions.length).toBeGreaterThan(0);
      for (const { widthDots } of captions) expect(widthDots).toBe(360);
    }
  });

  it("prints one QR sample whose measurement distinguishes 180 from 203 dpi", () => {
    const [, qr, ...rest] = pictures(formatTestPage({ locale: "es-ES" }));
    expect(rest).toEqual([]);
    expect([qr!.widthDots / 8, qr!.heightDots]).toEqual([45, (53 + 6) * 6]);
    expect(qr!.widthDots).toBeLessThanOrEqual(360);
  });

  it("prints its captions in the requested language, and no text as text", () => {
    const es = printedLines(formatTestPage({ locale: "es-ES" })).join(" ");
    const en = printedLines(formatTestPage({ locale: "en-GB" })).join(" ");
    expect(en).toContain("Measure the black square");
    expect(en).toContain("Is it closer to 40 mm or 45 mm");
    expect(en).toContain("Ignore the white border");
    expect(en).toContain("No need to scan");
    expect(es).toContain("Mida con una regla el cuadrado negro");
    expect(es).toContain("¿Mide más cerca de 40 mm o de 45 mm?");
    expect(es).toContain("Ignore el borde blanco");
    expect(es).toContain("No hace falta escanear");
    const names = printedCommands(formatTestPage({ locale: "es-ES" })).map((c) => c.name);
    for (const name of ["text", "ESC t", "FS ."]) expect(names).not.toContain(name);
  });
});
