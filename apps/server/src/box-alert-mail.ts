import { eq } from "drizzle-orm";
import { cancelMail, incidents, readVenue } from "@waitron/db";
import { boxEmailMessage, type BoxAlertCode } from "./box-alert-email.js";
import type { Logger } from "./logger.js";
import { readManagerEmailRecipient } from "./manager-email-recipients.js";
import type { MailKindOwner } from "./mail-sender.js";

export const BOX_ALERT_RETRY_DELAYS_MS: readonly number[] = [
  60000,
  60000,
  300000,
  900000,
  ...Array<number>(24).fill(3600000),
];
export interface BoxAlertWords {
  code: BoxAlertCode;
  language: "en" | "es";
  venue: string;
  params?: Readonly<Record<string, unknown>>;
}
export function boxAlertMail(deps: {
  venueLanguage: "en" | "es";
  log: Logger;
}): MailKindOwner<BoxAlertWords> {
  const logged = new Map<string, Set<string>>();
  return {
    kind: "box_alert",
    deliveryRule: "notice",
    retryDelaysMs: BOX_ALERT_RETRY_DELAYS_MS,
    longestWaitMs: 3600000,
    async claim(tx, mail) {
      if (mail.personId === null) return null;
      const recipient = await readManagerEmailRecipient(tx, mail.personId, deps.venueLanguage);
      if (!recipient) return null;
      const code = mail.params.code as BoxAlertCode;
      let params: Readonly<Record<string, unknown>> | undefined;
      if (mail.subjectId !== null) {
        const [incident] = await tx
          .select()
          .from(incidents)
          .where(eq(incidents.id, mail.subjectId));
        if (!incident || (incident.acknowledgedAt !== null && code !== "clock.corrected"))
          return null;
        params = incident.params;
      } else {
        params =
          typeof mail.params.wording === "string" ? JSON.parse(mail.params.wording) : undefined;
      }
      return {
        recipient: recipient.email,
        prepared: { code, language: recipient.language, venue: (await readVenue(tx)).name, params },
      };
    },
    async compose(words) {
      return boxEmailMessage(words.code, words.language, words.venue, words.params);
    },
    async settle(tx, mail, outcome, now) {
      if (outcome.status === "expired") return;
      const code = mail.params.code as BoxAlertCode;
      if (outcome.status === "sent") {
        deps.log("info", "box_email.sent", { code });
      } else {
        const status =
          outcome.status === "rejected" && outcome.serverRefused ? "rejected" : "unknown";
        const said = logged.get(mail.id) ?? new Set<string>();
        if (!said.has(status)) {
          deps.log("warn", "box_email.send_failed", { code, outcome: status });
          said.add(status);
          logged.set(mail.id, said);
        }
      }
      if (
        code === "clock.corrected" &&
        mail.subjectId !== null &&
        outcome.status === "rejected" &&
        outcome.serverRefused
      ) {
        const [incident] = await tx
          .select({ handled: incidents.acknowledgedAt })
          .from(incidents)
          .where(eq(incidents.id, mail.subjectId));
        if (incident?.handled != null) await cancelMail(tx, mail.dedupeKey, now);
      }
    },
  };
}
