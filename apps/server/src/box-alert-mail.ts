import { eq } from "drizzle-orm";
import { cancelMail, incidents, persons, readVenue } from "@waitron/db";
import {
  BANK_ACCOUNT_CHANGED_EMAIL_CODE,
  boxEmailMessage,
  type BoxAlertCode,
} from "./box-alert-email.js";
import { cloudEmailLocale, cloudNoticeLabel, type CloudBoxAlertFacts } from "./cloud-email.js";
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
  timeZone: string;
  params?: Readonly<Record<string, unknown>>;
}

function cloudFacts(
  code: BoxAlertCode,
  params: Readonly<Record<string, unknown>> = {},
): CloudBoxAlertFacts | undefined {
  switch (code) {
    case "storage.space_low":
      return { code };
    case "backup.archives_deleted": {
      const { count, date, lastDate } = params;
      if (typeof count === "number" && typeof date === "string" && typeof lastDate === "string")
        return { code, count, date, lastDate };
      break;
    }
    case "backup.run_stopped": {
      const { neededBytes, availableBytes } = params;
      if (typeof neededBytes === "number" && typeof availableBytes === "number")
        return { code, neededBytes, availableBytes };
      break;
    }
    case "upgrade.rolled_back": {
      const { fromVersion, toVersion } = params;
      if (typeof fromVersion === "string" && typeof toVersion === "string")
        return { code, fromVersion, toVersion };
      break;
    }
    case "clock.corrected": {
      const { before, after, beforeOffsetMinutes, afterOffsetMinutes, stepMs, source, unverified } =
        params;
      if (
        typeof before !== "string" ||
        typeof after !== "string" ||
        typeof beforeOffsetMinutes !== "number" ||
        typeof afterOffsetMinutes !== "number" ||
        typeof stepMs !== "number" ||
        (source !== "admin" && source !== "staff" && source !== "setup") ||
        typeof unverified !== "boolean"
      )
        break;
      const person =
        !unverified && typeof params.person === "string" && cloudNoticeLabel(params.person);
      const device =
        !unverified &&
        source === "staff" &&
        typeof params.device === "string" &&
        cloudNoticeLabel(params.device);
      return {
        code,
        before,
        after,
        beforeOffsetMinutes,
        afterOffsetMinutes,
        stepMs: Math.round(stepMs),
        source,
        unverified,
        ...(person && { person }),
        ...(device && { device }),
      };
    }
  }
  return undefined;
}

export function boxAlertMail(deps: {
  previousEpisodeMailIds: ReadonlySet<string>;
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
      if (deps.previousEpisodeMailIds.has(mail.id)) return null;
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
        const editorId = params?.["editorId"];
        if (code === BANK_ACCOUNT_CHANGED_EMAIL_CODE && typeof editorId === "string") {
          const [editor] = await tx
            .select({ name: persons.displayName })
            .from(persons)
            .where(eq(persons.id, editorId));
          if (editor) params = { ...params, editorName: editor.name };
        }
      }
      const venue = await readVenue(tx);
      return {
        recipient: recipient.email,
        prepared: {
          code,
          language: recipient.language,
          venue: venue.name,
          timeZone: venue.timeZone,
          params,
        },
      };
    },
    async compose(words, mail) {
      const facts = cloudFacts(words.code, words.params ?? undefined);
      return {
        ...boxEmailMessage(words.code, words.language, words.venue, words.params),
        ...(facts && {
          staffNotice: {
            class: "box_alert",
            displayName: words.venue,
            locale: cloudEmailLocale(words.language),
            timeZone: words.timeZone,
            expiresAt: mail.notAfter,
            facts,
          },
        }),
      };
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
