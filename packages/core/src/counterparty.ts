// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { recipientIdentifierResult } from "@waitron/country-packs";
import type { Counterparty, FiscalBackend } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";

export function checkedCounterparty(
  backend: FiscalBackend,
  counterparty: Counterparty,
): Counterparty {
  if (counterparty.legalName.trim() === "") {
    throw new AppError("counterparty.invalid", { field: "legalName" });
  }
  const checked = recipientIdentifierResult(counterparty);
  if (!checked.valid) {
    throw new AppError("counterparty.invalid", { field: checked.field });
  }
  const cap = backend.recipientNameMaxLength;
  if (cap !== null && Array.from(counterparty.legalName).length > cap) {
    throw new AppError("counterparty.invalid", { field: "legalName" });
  }
  return {
    legalName: counterparty.legalName,
    countryCode: counterparty.countryCode,
    ...checked.value,
  };
}

export function requireRecipientAddress(address: string | null | undefined): void {
  if (!address?.trim()) {
    throw new AppError("counterparty.invalid", { field: "address" });
  }
}
