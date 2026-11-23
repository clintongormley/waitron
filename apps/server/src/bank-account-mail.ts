import { enqueueMail, MAIL_LIFETIME_MS, type BankAccount, type Transaction } from "@waitron/db";
import { maskIban } from "@waitron/shared";
import { BANK_ACCOUNT_CHANGED_EMAIL_CODE } from "./box-alert-email.js";
import { readManagerEmailRecipients } from "./manager-email-recipients.js";

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
    venueLanguage: "en" | "es";
    activityId: string;
    now: Date;
  },
): Promise<void> {
  const wording = JSON.stringify({
    editorId: input.editorId,
    changedAt: input.at,
    changedAtOffset: input.offsetMinutes,
    previousAccount: input.before === null ? null : maskIban(input.before.iban),
    newAccount: input.after === null ? null : maskIban(input.after.iban),
  });
  const notAfter = new Date(input.now.getTime() + MAIL_LIFETIME_MS.box_alert);
  for (const recipient of await readManagerEmailRecipients(tx, input.venueLanguage))
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
