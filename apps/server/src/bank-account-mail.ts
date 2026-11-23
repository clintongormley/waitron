import { enqueueMail, MAIL_LIFETIME_MS, type BankAccount, type Transaction } from "@waitron/db";
import { maskIban } from "@waitron/shared";
import { BANK_ACCOUNT_CHANGED_EMAIL_CODE } from "./box-alert-email.js";
import { readManagerEmailRecipients } from "./manager-email-recipients.js";

function accountLine(account: BankAccount | null): string | null {
  if (account === null) return null;
  const masked = maskIban(account.iban);
  return account.bankName === null ? masked : `${masked} (${account.bankName})`;
}

/** Holds only masked accounts: the full IBAN never reaches the mail queue. The editor's name is
 * read when the mail is claimed. */
export async function queueBankAccountChangedMail(
  tx: Transaction,
  input: {
    editorId: string;
    at: string;
    offsetMinutes: number;
    before: BankAccount | null;
    after: BankAccount | null;
    activityId: string;
    now: Date;
  },
): Promise<void> {
  const wording = JSON.stringify({
    editorId: input.editorId,
    changedAt: input.at,
    changedAtOffset: input.offsetMinutes,
    previousAccount: accountLine(input.before),
    newAccount: accountLine(input.after),
  });
  const notAfter = new Date(input.now.getTime() + MAIL_LIFETIME_MS.box_alert);
  // Only the person ids are kept: each mail's language is resolved when it is sent.
  for (const recipient of await readManagerEmailRecipients(tx, "en"))
    await enqueueMail(tx, {
      kind: "box_alert",
      dedupeKey: `bank-account:${input.activityId}:${recipient.personId}`,
      subjectId: null,
      personId: recipient.personId,
      params: { code: BANK_ACCOUNT_CHANGED_EMAIL_CODE, wording },
      now: input.now,
      notAfter,
    });
}
