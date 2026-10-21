import {
  THEME_NAME_MAX_LENGTH,
  type ThemeNameRefusal,
  type ThemeNameResult,
} from "@waitron/ui-core/theme";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";

const REFUSAL_KEYS: Record<ThemeNameRefusal, StringKey> = {
  empty: "appearance.name_required",
  too_long: "appearance.name_too_long",
  reserved: "appearance.name_reserved",
};

/** Counted in NFC code points, as `checkThemeName` counts, so the proposal always fits. */
export function copyName(name: string): string {
  const room = THEME_NAME_MAX_LENGTH - [...fill("appearance.copy_name", { name: "" })].length;
  const kept = [...name.normalize("NFC").trim()].slice(0, room).join("").trimEnd();
  return fill("appearance.copy_name", { name: kept });
}

export function nameCheckText(result: ThemeNameResult): string {
  return result.ok ? "" : t(REFUSAL_KEYS[result.reason]);
}

export function nameRefusalText(code: string, reason: unknown): string {
  if (code === "theme.name_taken") return t("appearance.name_taken");
  if (
    code === "theme.invalid" &&
    typeof reason === "string" &&
    Object.hasOwn(REFUSAL_KEYS, reason)
  ) {
    return t(REFUSAL_KEYS[reason as ThemeNameRefusal]);
  }
  return "";
}
