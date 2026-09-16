import { prepareText, type CharacterSet } from "./charset.js";

const SAMPLE_TEXT = "Café jamón Ñ ¿¡ ç ü 5 €";

/** The printed samples and their matching setup-dialog answers share one order and text. */
export const TEST_CHARSET_SAMPLES: readonly {
  value: string;
  characterSet: CharacterSet;
  text: string;
}[] = (["wpc1252", "pc858", "plain"] as const).map((characterSet, index) => ({
  value: String(index + 1),
  characterSet,
  text: prepareText(SAMPLE_TEXT, characterSet),
}));
