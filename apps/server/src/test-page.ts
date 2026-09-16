import { esc, withQuietZone, wrapText } from "@waitron/printing";
import { TEST_CHARSET_SAMPLES } from "@waitron/printing/src/test-page-samples.js";
import type { SupportedLocale } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

/**
 * The printer setup test page (design 2026-09-14, "The test page"). It is the same for every printer
 * and uses the requesting user's dashboard language. Captions are plain ASCII so they read before
 * a character set is chosen, and wrap at 30 columns, the narrowest paper. Images fit in 360 dots.
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
    qrQuestion:
      "Mida el cuadrado negro del QR de su linea. Ignore el borde blanco. Debe medir entre 30 y 40 mm. No hace falta escanear el codigo.",
    qrForAC: "Para A o C:",
    qrForBD: "Para B o D:",
    charsetQuestion: "Elija la primera linea que se lea bien. La linea 3 siempre se lee bien.",
  },
  "en-GB": {
    widthQuestion: "Which is the longest line whose | is on the same row?",
    qrQuestion:
      "Measure the black square of the QR for your line. Ignore the white border. It must be between 30 and 40 mm. No need to scan the code.",
    qrForAC: "For A or C:",
    qrForBD: "For B or D:",
    charsetQuestion: "Choose the first line that reads correctly. Line 3 always does.",
  },
};

/** The narrowest paper's column count: every caption fits it. */
const CAPTION_COLUMNS = 30;
/** Fixed sample content, not a tax-agency link, so scanning a sample submits nothing. */
const SAMPLE_QR_TEXT = "Waitron 30-40 mm";

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
  for (const { value, characterSet, text } of TEST_CHARSET_SAMPLES) {
    b.charset(characterSet).line(`${value}: ${text}`);
  }

  return b.feedAndCut().bytes();
}
