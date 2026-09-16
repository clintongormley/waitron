import { esc, prepareText, wrapText } from "@waitron/printing";
import {
  characterCalibration,
  characterEncodingName,
} from "@waitron/printing/src/test-page-samples.js";
import type { SupportedLocale } from "@waitron/shared";

const CAPTIONS: Readonly<Record<SupportedLocale, { title: string; instruction: string }>> = {
  "en-GB": {
    title: "CHARACTER TABLE FINDER",
    instruction: "Choose a fully correct line.",
  },
  "es-ES": {
    title: "BUSCADOR DE TABLAS",
    instruction: "Elige una linea correcta.",
  },
};

/** Print a human-readable probe for the sixteen-table block containing `startTable`. */
export function formatCharacterTableTest({
  startTable,
  locale,
  calibrationLocale = locale,
}: {
  startTable: number;
  locale: SupportedLocale;
  calibrationLocale?: SupportedLocale;
}): Uint8Array {
  if (!Number.isInteger(startTable) || startTable < 0 || startTable > 0xff) {
    throw new RangeError(`start table must be an integer in [0, 255], got ${startTable}`);
  }
  const firstTable = Math.min(startTable, 0xf0);
  const captions = CAPTIONS[locale];
  const calibration = characterCalibration(calibrationLocale);
  const b = esc("plain").init();
  const legend = calibration.finderEncodings
    .map(({ label, characterSet }) => `${label} = ${characterEncodingName(characterSet)}`)
    .join("; ");
  for (const caption of [captions.title, captions.instruction, legend]) {
    for (const line of wrapText(caption, 30)) b.line(line);
  }
  b.line();
  for (let table = firstTable; table < firstTable + 16; table++) {
    const label = `T${String(table).padStart(3, "0")}`;
    for (const encoding of calibration.finderEncodings) {
      b.charset(encoding.characterSet, table).line(
        `${label} ${encoding.label}: ${prepareText(calibration.finderSampleText, encoding.characterSet)}`,
      );
    }
  }
  return b.feedAndCut().bytes();
}
