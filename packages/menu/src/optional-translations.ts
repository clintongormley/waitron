import { AppError, normalizeOptionalTranslations, type ContentLanguages } from "@waitron/shared";
import "./errors.js";

export function validateOptionalTranslations(value: unknown): Record<string, string> {
  const names = normalizeOptionalTranslations(value);
  if (names === null) throw new AppError("content.translation_invalid", {});
  return names;
}

export function mergeOptionalTranslations(
  stored: Readonly<Record<string, string>> | null,
  supplied: Readonly<Record<string, string>> | null,
  config: ContentLanguages,
): Record<string, string> | null {
  const normalized = supplied === null ? {} : validateOptionalTranslations(supplied);
  const enabled = new Set(config.languages);
  for (const [language, text] of Object.entries(supplied ?? {})) {
    if (
      !enabled.has(language) &&
      (!Object.hasOwn(stored ?? {}, language) || stored?.[language] !== text)
    )
      throw new AppError("content.translation_invalid", {});
  }
  const merged = Object.fromEntries([
    ...Object.entries(stored ?? {}).filter(([language]) => !enabled.has(language)),
    ...Object.entries(normalized).filter(([language]) => enabled.has(language)),
  ]);
  return Object.keys(merged).length === 0 ? null : merged;
}
