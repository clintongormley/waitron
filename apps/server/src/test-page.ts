import { esc, withQuietZone, wrapText } from "@waitron/printing";
import { testCharsetSamples } from "@waitron/printing/src/test-page-samples.js";
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
  charsetQuestion: string;
}

const CAPTIONS: Readonly<Record<SupportedLocale, Captions>> = {
  "es-ES": {
    widthQuestion: "Cual es la linea mas larga cuyo | queda en la misma fila?",
    qrQuestion:
      "Mida con una regla el cuadrado negro del QR. Ignore el borde blanco. Mide mas cerca de 40 mm o de 45 mm? No hace falta escanear el codigo.",
    charsetQuestion: "Elija la primera linea que se lea bien. La linea 4 siempre se lee bien.",
  },
  "en-GB": {
    widthQuestion: "Which is the longest line whose | is on the same row?",
    qrQuestion:
      "Measure the black square of the QR with a ruler. Ignore the white border. Is it closer to 40 mm or 45 mm? No need to scan the code.",
    charsetQuestion: "Choose the first line that reads correctly. Line 4 always does.",
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

export function formatTestPage({
  locale,
  calibrationLocale = locale,
}: {
  locale: SupportedLocale;
  calibrationLocale?: SupportedLocale;
}): Uint8Array {
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
  // 53 squares at 6 dots: 39.8 mm at 203 dpi. A 3-square border keeps it at 354 dots, within 360.
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 9 }), 3), { moduleSize: 6 }).line();
  b.line();

  caption(c.charsetQuestion);
  for (const { value, characterSet, characterTable, text } of testCharsetSamples(
    calibrationLocale,
  )) {
    b.charset(characterSet, characterSet === "plain" ? undefined : characterTable).line(
      `${value}: ${text}`,
    );
  }

  return b.feedAndCut().bytes();
}
