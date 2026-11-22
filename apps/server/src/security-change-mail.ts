import { persons, readVenue } from "@waitron/db";
import { eq } from "drizzle-orm";
import { cloudEmailLocale } from "./cloud-email.js";
import type { MailKindOwner } from "./mail-sender.js";
import { SECURITY_CHANGE_EMAIL_WORDS } from "./i18n/security-change-email.js";

interface SecurityChangeWords {
  locale: string;
  venue: string;
  change: keyof typeof SECURITY_CHANGE_EMAIL_WORDS.en.changes;
}

export function securityChangeMail(deps: {
  venueLocale: string;
  readTimeZone(): Promise<string>;
}): MailKindOwner<SecurityChangeWords> {
  return {
    kind: "security_change",
    deliveryRule: "notice",
    retryDelaysMs: [60000, 120000, 240000, 600000],
    longestWaitMs: 600000,
    async claim(tx, mail) {
      const [person] = await tx
        .select({ email: persons.email, locale: persons.locale })
        .from(persons)
        .where(eq(persons.id, mail.personId!));
      if (person?.email == null) return null;
      return {
        recipient: person.email,
        prepared: {
          locale: person.locale ?? deps.venueLocale,
          venue: (await readVenue(tx)).name,
          change: mail.params.change as SecurityChangeWords["change"],
        },
      };
    },
    async compose(words, mail) {
      const timeZone = await deps.readTimeZone();
      const copy = SECURITY_CHANGE_EMAIL_WORDS[words.locale === "es-ES" ? "es" : "en"];
      const when = new Intl.DateTimeFormat(words.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }).format(new Date(mail.queuedAt));
      return {
        subject: copy.subject,
        text: copy.text(words.venue, copy.changes[words.change], when),
        staffNotice: {
          class: "security_change",
          displayName: words.venue,
          locale: cloudEmailLocale(words.locale),
          timeZone,
          expiresAt: mail.notAfter,
          facts: { change: words.change, at: mail.queuedAt },
        },
      };
    },
    async settle() {},
  };
}
