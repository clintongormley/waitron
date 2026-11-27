import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { currentLocale } from "./t.js";

/** The language of setup's screen, as the shared recovery words name it. */
export function wordsLanguage(): "es" | "en" {
  return currentLocale().startsWith("es") ? "es" : "en";
}

export function masterKeyFieldWords(): (typeof MASTER_KEY_FIELD_WORDS)["en"] {
  return MASTER_KEY_FIELD_WORDS[wordsLanguage()];
}

/** The key a box named when it refused a master key, or undefined when it named none. */
export function refusedKeyName(
  refusal: { code?: unknown; params?: Record<string, unknown> } | undefined,
): string | undefined {
  const keyName = refusal?.params?.keyName;
  return refusal?.code === "promotion.break_glass_invalid" && typeof keyName === "string"
    ? keyName
    : undefined;
}
