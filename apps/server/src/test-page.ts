import { esc, withQuietZone, wrapText } from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

/**
 * Captions use ASCII and wrap at 30 columns so the resolution measurement fits uncalibrated paper.
 */
interface Captions {
  widthQuestion: string;
  qrQuestion: string;
}

const CAPTIONS: Readonly<Record<SupportedLocale, Captions>> = {
  "es-ES": {
    widthQuestion: "Cual es la linea mas larga cuyo | queda en la misma fila?",
    qrQuestion:
      "Mida con una regla el cuadrado negro del QR. Ignore el borde blanco. Mide mas cerca de 40 mm o de 45 mm? No hace falta escanear el codigo.",
  },
  "en-GB": {
    widthQuestion: "Which is the longest line whose | is on the same row?",
    qrQuestion:
      "Measure the black square of the QR with a ruler. Ignore the white border. Is it closer to 40 mm or 45 mm? No need to scan the code.",
  },
};

/** The narrowest paper's column count: every caption fits it. */
const CAPTION_COLUMNS = 30;
/** Fixed sample content, not a tax-agency link, so scanning a sample submits nothing. */
const SAMPLE_QR_TEXT = "Waitron 30-40 mm";

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
    b.line(`${label} ${"-".repeat(length - 3)}|`);
  }
  b.line();
  caption(c.qrQuestion);
  // 53 squares at 6 dots: 39.8 mm at 203 dpi. A 3-square border keeps it at 354 dots, within 360.
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 9 }), 3), { moduleSize: 6 }).line();
  b.line();

  return b.feedAndCut().bytes();
}
