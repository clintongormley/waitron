import { persons, readVenue } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { MailKindOwner } from "./mail-sender.js";
import { EMAIL_CHANGED_WORDS } from "./i18n/email-changed-email.js";

interface EmailChangedWords {
  locale: string;
  venue: string;
  editorName: string;
  at: string;
}
export function emailChangedMail(deps: {
  venueLocale: string;
  readTimeZone(): Promise<string>;
}): MailKindOwner<EmailChangedWords> {
  return {
    kind: "email_changed",
    deliveryRule: "notice",
    retryDelaysMs: [60000, 120000, 240000, 600000],
    longestWaitMs: 600000,
    async claim(tx, mail) {
      const [person] = await tx
        .select({ locale: persons.locale })
        .from(persons)
        .where(eq(persons.id, mail.personId!));
      return {
        recipient: mail.params.oldEmail as string,
        prepared: {
          locale: person!.locale ?? deps.venueLocale,
          venue: (await readVenue(tx)).name,
          editorName: mail.params.editorName as string,
          at: mail.params.at as string,
        },
      };
    },
    async compose(words) {
      const copy = EMAIL_CHANGED_WORDS[words.locale === "es-ES" ? "es" : "en"];
      const when = new Intl.DateTimeFormat(words.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: await deps.readTimeZone(),
      }).format(new Date(words.at));
      return { subject: copy.subject, text: copy.text(words.editorName, words.venue, when) };
    },
    async settle() {},
  };
}
