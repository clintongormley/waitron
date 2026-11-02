import type { Transaction } from "@waitron/db";
import { readReceiptLanguage } from "@waitron/catalogue";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import { readOfferedReceiptLanguages } from "./venue-locale.js";

export interface DepartmentReceiptLanguages {
  receiptLanguage: string;
  languages: string[];
  storageLanguages: string[];
}

export async function departmentReceiptLanguages(
  tx: Transaction,
): Promise<DepartmentReceiptLanguages> {
  const { locale: receiptLanguage } = await readReceiptLanguage(tx);
  const labelled = [
    ...new Set(
      COUNTRY_PACKS.flatMap((pack) =>
        pack.invoiceLocales.filter((locale) => pack.receiptLabels?.[locale] !== undefined),
      ),
    ),
  ];
  return {
    receiptLanguage,
    languages: await readOfferedReceiptLanguages(tx),
    storageLanguages: [...new Set([receiptLanguage, ...labelled])],
  };
}
