import type { Transaction } from "@waitron/db";
import { readReceiptLanguage } from "@waitron/catalogue";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import type { LocationId } from "@waitron/shared";
import { readOfferedReceiptLanguages } from "./venue-locale.js";

export interface DepartmentReceiptLanguages {
  receiptLanguage: string;
  languages: string[];
  storageLanguages: string[];
}

export async function departmentReceiptLanguages(
  tx: Transaction,
  cfg: { locationId: LocationId },
): Promise<DepartmentReceiptLanguages> {
  const { locale: receiptLanguage } = await readReceiptLanguage(tx, cfg.locationId);
  const labelled = [
    ...new Set(COUNTRY_PACKS.flatMap((pack) => Object.keys(pack.receiptLabels ?? {}))),
  ];
  return {
    receiptLanguage,
    languages: await readOfferedReceiptLanguages(tx, cfg),
    storageLanguages: [...new Set([receiptLanguage, ...labelled])],
  };
}
