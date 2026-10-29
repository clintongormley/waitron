import type { Transaction } from "@waitron/db";
import { readContentLanguages } from "@waitron/catalogue";
import { FALLBACK_LOCALE } from "@waitron/shared";
import { kitchenLanguageFor, type KitchenLanguage } from "./i18n/kitchen-ticket.js";

export async function readKitchenLanguage(tx: Transaction): Promise<KitchenLanguage> {
  return kitchenLanguageFor((await readContentLanguages(tx, FALLBACK_LOCALE)).defaultLanguage);
}
