import { esc, prepareText, wrapText } from "@waitron/printing";
import {
  characterCalibration,
  characterEncodingName,
  characterFinderOptions,
} from "@waitron/printing/src/test-page-samples.js";
import type { SupportedLocale } from "@waitron/shared";

const CAPTIONS: Readonly<Record<SupportedLocale, { title: string; instruction: string }>> = {
  "en-GB": {
    title: "CHARACTER TABLE FINDER",
    instruction: "Choose the first code whose two lines match the screen.",
  },
  "es-ES": {
    title: "BUSCADOR DE TABLAS",
    instruction: "Elige el primer codigo cuyas dos lineas coincidan con la pantalla.",
  },
};

/** Print sixteen table numbers from `startTable`, capped at the final complete range. */
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
  for (const { code, characterSet, characterTable } of characterFinderOptions(
    calibrationLocale,
    startTable,
  )) {
    for (const [index, sample] of calibration.finderSampleLines.entries()) {
      const prefix = index === 0 ? code : " ".repeat(code.length);
      b.charset("plain")
        .init()
        .charset(characterSet, characterTable)
        .line(`${prefix} ${prepareText(sample, characterSet)}`);
    }
  }
  return b.feedAndCut().bytes();
}
