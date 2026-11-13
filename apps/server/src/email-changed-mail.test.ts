import { CORE_MIGRATIONS, enqueueMail, outgoingMail, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { expect, it, vi } from "vitest";
import { EMAIL_CHANGED_WORDS } from "./i18n/email-changed-email.js";
import { emailChangedMail } from "./email-changed-mail.js";
import { runMailPass } from "./mail-sender.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-13T12:00:00Z");
it.each([
  {
    locale: "en-GB",
    venueLocale: "es-ES",
    subject: "Your sign-in email was changed",
    text: "Editor changed the email address you sign in with at Corner Bistro on 13 Nov 2026, 13:00. Messages for your account now go to the new address.",
  },
  {
    locale: "es-ES",
    venueLocale: "en-GB",
    subject: EMAIL_CHANGED_WORDS.es.subject,
    text: EMAIL_CHANGED_WORDS.es.text("Editor", "Corner Bistro", "13 nov 2026, 13:00"),
  },
  {
    locale: null,
    venueLocale: "es-ES",
    subject: EMAIL_CHANGED_WORDS.es.subject,
    text: EMAIL_CHANGED_WORDS.es.text("Editor", "Corner Bistro", "13 nov 2026, 13:00"),
  },
])(
  "sends to the old address using person $locale before venue $venueLocale",
  async ({ locale, venueLocale, subject, text }) => {
    await seedVenue(suite.db, { name: "Corner Bistro" });
    const [person] = await seedPersons(suite.db, {
      displayName: "Waiter",
      email: "new@example.test",
      locale,
    });
    await withTransaction(suite.db, (tx) =>
      enqueueMail(tx, {
        kind: "email_changed",
        dedupeKey: "change",
        subjectId: "activity",
        personId: person!.id,
        params: { oldEmail: "old@example.test", editorName: "Editor", at: now.toISOString() },
        now,
        notAfter: new Date(now.getTime() + 86400000),
      }),
    );
    const send = vi.fn(async () => ({ status: "sent" as const }));
    await runMailPass({
      db: suite.db,
      owners: [emailChangedMail({ venueLocale, readTimeZone: async () => "Europe/Madrid" })],
      now: () => now,
      isPrimary: () => true,
      signal: new AbortController().signal,
      resolveDelivery: async () => ({
        mode: "smtp",
        smtp: { url: "smtp://mail.test", from: "from@example.test" },
      }),
      send,
      log: () => {},
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      to: "old@example.test",
      subject,
      text,
    });
    const [mail] = await suite.db.select().from(outgoingMail);
    expect(mail).toMatchObject({ status: "sent", recipient: "old@example.test", attempts: 1 });
  },
);
