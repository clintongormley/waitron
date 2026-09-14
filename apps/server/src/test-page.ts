import { esc, withQuietZone, wrapText } from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

/**
 * The printer setup test page (design 2026-09-14, "The test page"). It is the same for every printer
 * and depends only on the venue language. Captions are plain ASCII so they read correctly before a
 * character set is chosen, and wrap at 30 columns, the narrowest paper. Images fit in 360 dots.
 */
interface Captions {
  widthQuestion: string;
  qrQuestion: string;
  qrForAC: string;
  qrForBD: string;
  charsetQuestion: string;
}

const CAPTIONS: Readonly<Record<SupportedLocale, Captions>> = {
  "es-ES": {
    widthQuestion: "Cual es la linea mas larga cuyo | queda en la misma fila?",
    qrQuestion: "Mida el codigo QR de su linea. Debe medir entre 30 y 40 mm.",
    qrForAC: "Para A o C:",
    qrForBD: "Para B o D:",
    charsetQuestion: "Elija la primera linea que se lea bien. La linea 3 siempre se lee bien.",
  },
  "en-GB": {
    widthQuestion: "Which is the longest line whose | is on the same row?",
    qrQuestion: "Measure the QR code for your line. It must be between 30 and 40 mm.",
    qrForAC: "For A or C:",
    qrForBD: "For B or D:",
    charsetQuestion: "Choose the first line that reads correctly. Line 3 always does.",
  },
};

/** The narrowest paper's column count: every caption fits it. */
const CAPTION_COLUMNS = 30;
/** Fixed sample content, not a tax-agency link, so scanning a sample submits nothing. */
const SAMPLE_QR_TEXT = "Waitron 30-40 mm";
const SAMPLE_LINE = "Café jamón Ñ ¿¡ ç ü 5 €";

/** `label`, a space, dashes, and `|` as the last of exactly `length` characters. */
function widthLine(label: string, length: number): string {
  return `${label} ${"-".repeat(length - 3)}|`;
}

export function formatTestPage({ locale }: { locale: SupportedLocale }): Uint8Array {
  const c = CAPTIONS[locale];
  const b = esc("plain").init();
  const caption = (text: string): void => {
    for (const line of wrapText(text, CAPTION_COLUMNS)) b.line(line);
  };

  caption(c.widthQuestion);
  for (const [label, length] of [
    ["A", 30],
    ["B", 32],
    ["C", 42],
    ["D", 48],
  ] as const) {
    b.line(widthLine(label, length));
  }
  b.line();

  caption(c.qrQuestion);
  // 45 squares at 5 dots: 31.8 mm at 180 dpi. With its full border it is 265 dots wide.
  caption(c.qrForAC);
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 7 }), 4), { moduleSize: 5 }).line();
  // 53 squares at 6 dots: 39.8 mm at 203 dpi. A 3-square border keeps it at 354 dots, within 360.
  caption(c.qrForBD);
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 9 }), 3), { moduleSize: 6 }).line();
  b.line();

  caption(c.charsetQuestion);
  b.charset("wpc1252").line(`1: ${SAMPLE_LINE}`);
  b.charset("pc858").line(`2: ${SAMPLE_LINE}`);
  b.charset("plain").line(`3: ${SAMPLE_LINE}`);

  return b.feedAndCut().bytes();
}
