import type { LegalAbout } from "@waitron/shared";
import { fill, t } from "./i18n/t.js";

/** The release this box runs, or `null` when the box refuses or cannot be reached. */
export async function readLegalAbout(fetchImpl: typeof fetch = fetch): Promise<LegalAbout | null> {
  try {
    const response = await fetchImpl("/legal/about", { method: "GET" });
    if (!response.ok) return null;
    return (await response.json()) as LegalAbout;
  } catch {
    return null;
  }
}

export function aboutHeading(about: LegalAbout | null): string {
  const version = about?.release?.version;
  return version === undefined ? t("about.title") : fill(t("about.title_version"), { version });
}
