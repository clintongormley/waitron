import { AppError, contentLanguageCode, type ContentLanguages } from "@waitron/shared";
import "./errors.js";

export function validateOptionalTranslations(value: unknown): Record<string, string> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new AppError("content.translation_invalid", {});
  }
  const entries: [string, string][] = [];
  for (const [language, text] of Object.entries(value)) {
    let canonical: string;
    try {
      canonical = contentLanguageCode(language);
    } catch {
      throw new AppError("content.translation_invalid", {});
    }
    if (canonical !== language || typeof text !== "string")
      throw new AppError("content.translation_invalid", {});
    const trimmed = text.trim();
    if (new TextEncoder().encode(trimmed).byteLength > 4096)
      throw new AppError("content.translation_invalid", {});
    if (trimmed !== "") entries.push([language, trimmed]);
  }
  return Object.fromEntries(entries);
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
