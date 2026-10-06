// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { getCountryPack } from "@waitron/country-packs";
import type { Counterparty, FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";

/**
 * The customer a full invoice names, as its record will carry it, or `counterparty.invalid` naming
 * the field that cannot be filed. The tax ID is checked by its country's own checker, where the
 * installed packs have one, and returned in that checker's written form; the legal name is held to
 * the regime's `recipientNameMaxLength`, counted in characters (code points).
 */
export function checkedCounterparty(
  backend: FiscalBackend,
  counterparty: Counterparty,
): Counterparty {
  if (counterparty.legalName.trim() === "") {
    throw new AppError("counterparty.invalid", { field: "legalName" });
  }
  const checked = getCountryPack(counterparty.countryCode)?.taxIdentifier?.validate(
    counterparty.taxId,
  );
  if (checked?.valid === false) {
    throw new AppError("counterparty.invalid", { field: "taxId" });
  }
  const cap = backend.recipientNameMaxLength;
  if (cap !== null && Array.from(counterparty.legalName).length > cap) {
    throw new AppError("counterparty.invalid", { field: "legalName" });
  }
  return checked === undefined ? counterparty : { ...counterparty, taxId: checked.normalized };
}

export function requireRecipientAddress(address: string | null | undefined): void {
  if (!address?.trim()) {
    throw new AppError("counterparty.invalid", { field: "address" });
  }
}
