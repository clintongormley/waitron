import {
  DOTS_PER_COLUMN,
  SETTING_WIDTHS,
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
    widthQuestion: "¿Cuál es el último número de la regla que se ve entero?",
    qrQuestion:
      "Mida con una regla el cuadrado negro del QR. Ignore el borde blanco. ¿Mide más cerca de 40 mm o de 45 mm? No hace falta escanear el código.",
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

const NARROWEST_FIRST = [...SETTING_WIDTHS].sort((a, b) => a.widthDots - b.widthDots);

/**
 * The dot widths the paper-width and resolution settings draw, each with the row its label sits on.
 * 360's label and 384's overlap across, so neighbours alternate rows. The top row's long ticks run
 * down past the bottom row's labels, so the wider label of an overlapping pair sits on the top row:
 * its tick passes right of the narrower label, which ends at its own tick.
 */
export const RULER_WIDTHS: readonly { widthDots: number; row: 0 | 1 }[] = NARROWEST_FIRST.map(
  ({ widthDots }, i) => ({ widthDots, row: (NARROWEST_FIRST.length - 1 - i) % 2 === 0 ? 0 : 1 }),
);
const RULER_WIDTH = NARROWEST_FIRST.at(-1)!.widthDots;
const TICK_HEIGHT = 8;
const BASE_HEIGHT = 2;
const RULER_HEIGHT = 2 * TEXT_BAND_HEIGHT + 10 + TICK_HEIGHT + BASE_HEIGHT;
const LONG_TICK_DOTS = 2;

/**
 * A short tick ending every 8 dots, and at each width a setting draws a long tick with its number
 * ending just before it: on a printer that prints `n` dots, the last number fully visible is the
 * widest setting that fits. A base line runs the whole width. Rows packed as `GS v 0` expects.
 */
function rulerRows(): Uint8Array {
  const stride = RULER_WIDTH / 8;
  const data = new Uint8Array(stride * RULER_HEIGHT);
  const set = (x: number, y: number): void => {
    data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
  };
  const ticks = RULER_HEIGHT - BASE_HEIGHT - TICK_HEIGHT;
  for (let y = ticks; y < RULER_HEIGHT; y++) {
    for (let x = 0; x < RULER_WIDTH; x++) {
      if (y >= RULER_HEIGHT - BASE_HEIGHT || x % 8 === 7) set(x, y);
    }
  }
  for (const { widthDots, row } of RULER_WIDTHS) {
    const text = String(widthDots);
    const right = widthDots - LONG_TICK_DOTS;
    const top = row * TEXT_BAND_HEIGHT;
    for (let y = top; y < RULER_HEIGHT; y++) for (let x = right; x < widthDots; x++) set(x, y);
    const left = right - text.length * DOTS_PER_COLUMN;
    const label = drawTextBand(text, {
      widthDots: RULER_WIDTH,
      columns: text.length,
      offsetDots: left,
    });
    for (let i = 0; i < label.length; i++) data[top * stride + i]! |= label[i]!;
  }
  return data;
}

const RULER_ROWS = rulerRows();

export function formatTestPage({ locale }: { locale: SupportedLocale }): Uint8Array {
  const c = CAPTIONS[locale];
  const { columns } = textGrid(CAPTION_SETTING.paperWidth, CAPTION_SETTING.resolution);
  const b = esc(CAPTION_SETTING).init().printArea(RULER_WIDTH);
  const caption = (text: string): void => {
    for (const line of wrapText(text, columns)) b.line(line);
  };

  caption(c.widthQuestion);
  b.line();
  b.raster(
    RULER_WIDTH,
    RULER_HEIGHT,
    (x, y) => (RULER_ROWS[y * (RULER_WIDTH / 8) + (x >> 3)]! & (0x80 >> (x & 7))) !== 0,
  );
  b.line();
  caption(c.qrQuestion);
  // 53 squares at 6 dots: 39.8 mm at 203 dpi. A 3-square border keeps it at 354 dots, within 360.
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 9 }), 3), { moduleSize: 6 }).line();
  b.line();

  return b.feedAndCut().bytes();
}
