import { readVenue } from "@waitron/db";
import type { FiscalCertificateSeat } from "@waitron/fiscal";
import { cloudEmailLocale } from "./cloud-email.js";
import { readManagerEmailRecipient } from "./manager-email-recipients.js";
import type { MailKindOwner } from "./mail-sender.js";

const DAY_MS = 86_400_000;
type ReminderWords = { language: "en" | "es"; now: Date; venue: string };

export function certificateReminderMail(deps: {
  seat: Pick<FiscalCertificateSeat, "reminders">;
  nodeId: string;
  venueLanguage: "en" | "es";
}): MailKindOwner<ReminderWords> {
  return {
    kind: "certificate_reminder",
    deliveryRule: "notice",
    retryDelaysMs: Array<number>(6).fill(DAY_MS),
    longestWaitMs: DAY_MS,
    async claim(tx, mail, now) {
      if (mail.personId === null || mail.subjectId === null) return null;
      const recipient = await readManagerEmailRecipient(tx, mail.personId, deps.venueLanguage);
      if (!recipient || (await deps.seat.reminders.current(tx, deps.nodeId)) !== mail.subjectId)
        return null;
      return {
        recipient: recipient.email,
        prepared: { language: recipient.language, now, venue: (await readVenue(tx)).name },
      };
    },
    async compose({ language, now, venue }, mail) {
      const { notice, ...words } = deps.seat.reminders.word({ params: mail.params, language, now });
      return {
        ...words,
        staffNotice: {
          class: "certificate_reminder",
          displayName: venue,
          locale: cloudEmailLocale(notice.language),
          timeZone: notice.timeZone,
          expiresAt: notice.expiresAt,
          facts: notice.facts,
        },
      };
    },
    async settle() {},
  };
}
