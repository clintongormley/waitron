import { resolveEnabledContentText, resolveSnapshotText } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { currentLocale } from "./t.js";

/** Content uses the requested translation, then the configured site default. */
export function localizedName(map: Record<string, string>): string {
  return resolveEnabledContentText(map, currentLocale(), currentContentLanguages());
}

/** Historical order and sale names retain their recorded receipt languages. */
export function localizedSnapshotName(map: Record<string, string>): string {
  return resolveSnapshotText(map, currentLocale(), currentContentLanguages().defaultLanguage);
}
