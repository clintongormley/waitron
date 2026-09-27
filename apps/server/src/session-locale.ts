import type { Transaction } from "@waitron/db";
import { resolveManagementSession } from "@waitron/identity";
import { resolveActiveLocale, type SupportedLocale } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";

/** The signed-in person's saved language, else the browser's, else the venue's. */
export async function resolveSessionLocale(
  tx: Transaction,
  sessionId: string,
  acceptLanguage: string | undefined,
  venueLocale: SupportedLocale,
): Promise<SupportedLocale> {
  const session = await resolveManagementSession(tx, sessionId, { touch: false });
  return resolveActiveLocale(session.locale, resolveLoginLocale(acceptLanguage, venueLocale));
}
