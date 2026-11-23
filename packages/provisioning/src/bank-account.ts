import {
  readSettings,
  recordActivity,
  saveSettings,
  VENUE_SETTINGS,
  type BankAccount,
  type Transaction,
} from "@waitron/db";
import { AppError, bankNameProblem, ibanProblem, normalizeIban } from "@waitron/shared";
import "./errors.js";

export async function readBankAccount(tx: Transaction): Promise<BankAccount | null> {
  return (await readSettings(tx, VENUE_SETTINGS)).doc.bankAccount;
}

/**
 * Saves the venue's bank account while the stored one still matches `expected` (`""` for none);
 * `saved: false` writes nothing and the caller names that refusal. An empty `iban` clears it.
 */
export async function saveBankAccount(
  tx: Transaction,
  change: {
    readonly expected: { readonly iban: string; readonly bankName: string };
    readonly iban: string;
    readonly bankName: string;
    readonly personId: string;
  },
): Promise<{
  saved: boolean;
  activityId?: string;
  before: BankAccount | null;
  after: BankAccount | null;
}> {
  const refuse = (reason: string) =>
    new AppError("venue.detail_invalid", { field: "iban", reason });
  const iban = normalizeIban(change.iban);
  const bankName = change.bankName.normalize("NFC").trim() || null;
  if (iban === "" && bankName !== null) throw refuse("required");
  const nameProblem = bankName === null ? undefined : bankNameProblem(bankName);
  if (nameProblem !== undefined)
    throw new AppError("venue.detail_invalid", { field: "bankName", reason: nameProblem });
  if (iban !== "") {
    const problem = ibanProblem(iban);
    if (problem !== undefined) throw refuse(problem);
  }
  const after: BankAccount | null = iban === "" ? null : { iban, bankName };
  const saved = await readSettings(tx, VENUE_SETTINGS);
  const before = saved.doc.bankAccount;
  if (
    change.expected.iban !== (before?.iban ?? "") ||
    change.expected.bankName !== (before?.bankName ?? "")
  )
    return { saved: false, before, after: before };
  if (after?.iban === before?.iban && after?.bankName === before?.bankName)
    throw refuse("unchanged");
  await saveSettings(tx, VENUE_SETTINGS, {
    doc: { ...saved.doc, bankAccount: after },
    expectedRevision: saved.revision,
    personId: change.personId,
  });
  const { id } = await recordActivity(tx, {
    kind: "venue.bank_account_changed",
    subjectId: VENUE_SETTINGS.module,
    personId: change.personId,
    data: {},
  });
  return { saved: true, activityId: id, before, after };
}
