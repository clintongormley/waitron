import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES, type SupportedLocale } from "@waitron/shared";
import { prepareText, type CharacterSet } from "./charset.js";

export interface TestCharacterEncoding {
  label: string;
  characterSet: CharacterSet;
}

interface CharacterEncodingDefinition {
  technicalName: string;
  settingLabels: Readonly<Record<SupportedLocale, string>>;
}

const CHARACTER_ENCODING_DEFINITIONS: Readonly<Record<CharacterSet, CharacterEncodingDefinition>> =
  {
    wpc1252: {
      technicalName: "Windows-1252",
      settingLabels: {
        "en-GB": "Western Latin with Spanish and € (WPC1252)",
        "es-ES": "Latino occidental con español y € (WPC1252)",
      },
    },
    pc858: {
      technicalName: "PC858",
      settingLabels: {
        "en-GB": "Multilingual with Spanish and € (PC858)",
        "es-ES": "Multilingüe con español y € (PC858)",
      },
    },
    plain: {
      technicalName: "Plain",
      settingLabels: {
        "en-GB": "Plain letters, no accents",
        "es-ES": "Letras sin acentos",
      },
    },
  };

export interface CharacterCalibration {
  testPageSampleText: string;
  finderSampleText: string;
  finderEncodings: readonly TestCharacterEncoding[];
  commonProfiles: readonly {
    characterSet: CharacterSet;
    characterTable: number;
  }[];
}

export interface TestCharacterSample {
  value: string;
  characterSet: CharacterSet;
  characterTable: number;
  text: string;
}

const WESTERN_EUROPEAN_CALIBRATION: CharacterCalibration = {
  testPageSampleText: "Café jamón Ñ ¿¡ ç ü 5 €",
  finderSampleText: "Café niño pingüino 5 €",
  finderEncodings: [
    { label: "W", characterSet: "wpc1252" },
    { label: "8", characterSet: "pc858" },
  ],
  commonProfiles: [
    { characterSet: "wpc1252", characterTable: 6 },
    { characterSet: "wpc1252", characterTable: 16 },
    { characterSet: "pc858", characterTable: 19 },
    { characterSet: "plain", characterTable: 0 },
  ],
};

/**
 * Every shipped UI locale must name the encodings and glyph sample needed to calibrate its receipts.
 * Adding a locale to `SUPPORTED_LOCALES` therefore fails typechecking until this record is extended.
 */
const CHARACTER_CALIBRATION_BY_LOCALE: Readonly<Record<SupportedLocale, CharacterCalibration>> = {
  "es-ES": WESTERN_EUROPEAN_CALIBRATION,
  "en-GB": WESTERN_EUROPEAN_CALIBRATION,
};

function supportedCalibrationLocale(locale: string): SupportedLocale {
  const exact = SUPPORTED_LOCALE_CODES.find((candidate) => candidate === locale);
  if (exact !== undefined) return exact;
  const language = locale.split("-")[0];
  return (
    SUPPORTED_LOCALE_CODES.find((candidate) => candidate.split("-")[0] === language) ??
    FALLBACK_LOCALE
  );
}

export function characterCalibration(locale: string): CharacterCalibration {
  return CHARACTER_CALIBRATION_BY_LOCALE[supportedCalibrationLocale(locale)];
}

export function characterEncodingName(characterSet: CharacterSet): string {
  return CHARACTER_ENCODING_DEFINITIONS[characterSet].technicalName;
}

export function characterSetOptions(
  locale: string,
): readonly { value: CharacterSet; label: string }[] {
  const supportedLocale = supportedCalibrationLocale(locale);
  return (
    Object.entries(CHARACTER_ENCODING_DEFINITIONS) as [CharacterSet, CharacterEncodingDefinition][]
  ).map(([value, definition]) => ({
    value,
    label: definition.settingLabels[supportedLocale],
  }));
}

/** Printed samples and matching setup-dialog answers for the venue's receipt locale. */
export function testCharsetSamples(locale: string): readonly TestCharacterSample[] {
  const calibration = characterCalibration(locale);
  return calibration.commonProfiles.map(({ characterSet, characterTable }, index) => ({
    value: String(index + 1),
    characterSet,
    characterTable,
    text: prepareText(calibration.testPageSampleText, characterSet),
  }));
}
