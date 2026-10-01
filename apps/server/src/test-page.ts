import {
  DOTS_PER_COLUMN,
  TEXT_BAND_HEIGHT,
  drawTextBand,
  esc,
  textGrid,
  withQuietZone,
  wrapText,
  type EscSetting,
} from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

interface Captions {
  widthQuestion: string;
  qrQuestion: string;
}

const CAPTIONS: Readonly<Record<SupportedLocale, Captions>> = {
  "es-ES": {
    widthQuestion: "Cual es el ultimo numero de la regla que se ve entero?",
    qrQuestion:
      "Mida con una regla el cuadrado negro del QR. Ignore el borde blanco. Mide mas cerca de 40 mm o de 45 mm? No hace falta escanear el codigo.",
  },
  "en-GB": {
    widthQuestion: "Which is the last number on the ruler that you can see in full?",
    qrQuestion:
      "Measure the black square of the QR with a ruler. Ignore the white border. Is it closer to 40 mm or 45 mm? No need to scan the code.",
  },
};

/** The narrowest paper's setting: every caption is drawn to it, so it fits any roll. */
const CAPTION_SETTING: EscSetting = { paperWidth: "58mm", resolution: "180dpi" };
/** Fixed sample content, not a tax-agency link, so scanning a sample submits nothing. */
const SAMPLE_QR_TEXT = "Waitron 30-40 mm";

/**
 * The dot widths the paper-width and resolution settings draw, each with the row its label sits on.
 * 360's label and 384's overlap across, so neighbours alternate rows; the top row's long ticks
 * run down past the bottom row's labels, so the top row holds the labels whose ticks miss them.
 */
export const RULER_WIDTHS: readonly { widthDots: number; row: 0 | 1 }[] = [
  { widthDots: 360, row: 1 },
  { widthDots: 384, row: 0 },
  { widthDots: 512, row: 1 },
  { widthDots: 576, row: 0 },
];
const RULER_WIDTH = 576;
const TICK_HEIGHT = 8;
const BASE_HEIGHT = 2;
const RULER_HEIGHT = 2 * TEXT_BAND_HEIGHT + 10 + TICK_HEIGHT + BASE_HEIGHT;
const LONG_TICK_DOTS = 2;

/** `text` drawn on a grid exactly as wide as it, as a dot lookup. */
function label(text: string): (x: number, y: number) => boolean {
  const widthDots = text.length * DOTS_PER_COLUMN;
  const data = drawTextBand(text, { widthDots, columns: text.length, offsetDots: 0 });
  const stride = Math.ceil(widthDots / 8);
  return (x, y) => (data[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
}

const LABELS = RULER_WIDTHS.map(({ widthDots, row }) => {
  const text = String(widthDots);
  const right = widthDots - LONG_TICK_DOTS;
  return { widthDots, row, right, left: right - text.length * DOTS_PER_COLUMN, dot: label(text) };
});

/**
 * A short tick ending every 8 dots, and at each width a setting draws a long tick with its number
 * ending just before it: on a printer that prints `n` dots, the last number fully visible is the
 * widest setting that fits. A base line runs the whole width.
 */
function rulerDot(x: number, y: number): boolean {
  if (y >= RULER_HEIGHT - BASE_HEIGHT) return true;
  const ticks = RULER_HEIGHT - BASE_HEIGHT - TICK_HEIGHT;
  if (y >= ticks && x % 8 === 7) return true;
  for (const { row, right, left, dot } of LABELS) {
    const top = row * TEXT_BAND_HEIGHT;
    if (x >= right && x < right + LONG_TICK_DOTS && y >= top) return true;
    if (x >= left && x < right && y >= top && y < top + TEXT_BAND_HEIGHT) {
      return dot(x - left, y - top);
    }
  }
  return false;
}

export function formatTestPage({ locale }: { locale: SupportedLocale }): Uint8Array {
  const c = CAPTIONS[locale];
  const { columns } = textGrid(CAPTION_SETTING.paperWidth, CAPTION_SETTING.resolution);
  const b = esc(CAPTION_SETTING).init().printArea(RULER_WIDTH);
  const caption = (text: string): void => {
    for (const line of wrapText(text, columns)) b.line(line);
  };

  caption(c.widthQuestion);
  b.line();
  b.raster(RULER_WIDTH, RULER_HEIGHT, rulerDot);
  b.line();
  caption(c.qrQuestion);
  // 53 squares at 6 dots: 39.8 mm at 203 dpi. A 3-square border keeps it at 354 dots, within 360.
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 9 }), 3), { moduleSize: 6 }).line();
  b.line();

  return b.feedAndCut().bytes();
}
