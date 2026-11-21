import { isValidVenueTelephone } from "@waitron/country-packs";
import { readTaxpayer, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

export async function checkedPersonTelephone(
  tx: Transaction,
  value: string | null | undefined,
  saved: string | null = null,
): Promise<string | null> {
  if (value === undefined) return saved;
  const telephone = value?.trim() || null;
  if (telephone === (saved?.trim() || null)) return saved;
  if (telephone !== null && !isValidVenueTelephone(telephone, (await readTaxpayer(tx))?.country))
    throw new AppError("person.telephone_invalid", {});
  return telephone;
}
