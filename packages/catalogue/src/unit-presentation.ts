import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import type { Unit } from "./product-types.js";
import type { UnitSnapshot } from "./pricing.js";

export function prepareUnitSnapshot(unit: UnitSnapshot, config: ContentLanguages): UnitSnapshot {
  return {
    ...unit,
    abbreviation: {
      [config.defaultLanguage]: unitPresentation(unit, config.defaultLanguage, config).abbreviation,
    },
  };
}

export function unitPresentation(
  unit: Pick<Unit, "name" | "abbreviation" | "staffName" | "staffAbbreviation">,
  language: string,
  config: ContentLanguages,
): { name: string; abbreviation: string } {
  return {
    name: resolveEnabledContentText(unit.name, language, config) || unit.staffName,
    abbreviation:
      resolveEnabledContentText(unit.abbreviation, language, config) || unit.staffAbbreviation,
  };
}
