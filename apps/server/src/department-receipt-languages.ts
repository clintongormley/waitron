import type { Transaction } from "@waitron/db";
import { readContentLanguages, readReceiptLanguage } from "@waitron/catalogue";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import { contentLanguageCode, type LocationId } from "@waitron/shared";

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
  const content = await readContentLanguages(tx, receiptLanguage);
  const labelled = [
    ...new Set(COUNTRY_PACKS.flatMap((pack) => Object.keys(pack.receiptLabels ?? {}))),
  ];
  return {
    receiptLanguage,
    languages: [
      ...new Set([
        receiptLanguage,
        ...labelled.filter((locale) => content.languages.includes(contentLanguageCode(locale))),
      ]),
    ],
    storageLanguages: [...new Set([receiptLanguage, ...labelled])],
  };
}
