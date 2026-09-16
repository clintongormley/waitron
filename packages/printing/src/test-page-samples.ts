import { prepareText, type CharacterSet } from "./charset.js";

const SAMPLE_TEXT = "Café jamón Ñ ¿¡ ç ü 5 €";

/** The printed samples and their matching setup-dialog answers share one order and text. */
type TestCharacterSample = {
  value: string;
  characterSet: CharacterSet;
  characterTable: number;
  text: string;
};

const TEST_CHARACTER_PROFILES: readonly {
  characterSet: CharacterSet;
  characterTable: number;
}[] = [
  { characterSet: "wpc1252", characterTable: 6 },
  { characterSet: "wpc1252", characterTable: 16 },
  { characterSet: "pc858", characterTable: 19 },
  { characterSet: "plain", characterTable: 0 },
];

export const TEST_CHARSET_SAMPLES: readonly TestCharacterSample[] = TEST_CHARACTER_PROFILES.map(
  ({ characterSet, characterTable }, index) => ({
    value: String(index + 1),
    characterSet,
    characterTable,
    text: prepareText(SAMPLE_TEXT, characterSet),
  }),
);
