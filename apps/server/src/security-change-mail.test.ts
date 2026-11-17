import {
  CORE_MIGRATIONS,
  enqueueMail,
  outgoingMail,
  persons,
  withTransaction,
  withFoldedPersonChanges,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { SECURITY_CHANGE_EMAIL_WORDS } from "./i18n/security-change-email.js";
import { securityChangeMail } from "./security-change-mail.js";
import { runMailPass } from "./mail-sender.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const queuedAt = new Date("2026-11-13T12:00:00Z");
const changes = [
  ["password_changed", "Your password was changed."],
  ["passkey_added", "A passkey was added to your account."],
  ["passkey_removed", "A passkey was removed from your account."],
  ["authenticator_set_up", "An authenticator was set up for your account."],
  ["authenticator_removed", "The authenticator was removed from your account."],
  ["recovery_codes_regenerated", "Your recovery codes were regenerated."],
  ["email_changed", "Your sign-in email address was changed."],
  ["google_connected", "Google sign-in was connected to your account."],
  ["google_disconnected", "Google sign-in was disconnected from your account."],
] as const;

async function queue(change: string, locale: string | null = "en-GB") {
  await seedVenue(suite.db, { name: "Corner Bistro" });
  const [person] = await seedPersons(suite.db, {
    displayName: "Recipient",
    email: "original@example.test",
    locale,
  });
  const mail = await withTransaction(suite.db, (tx) =>
    enqueueMail(tx, {
      kind: "security_change",
      dedupeKey: "security-change",
      personId: person!.id,
      params: { change },
      now: queuedAt,
      notAfter: new Date(queuedAt.getTime() + 86400000),
    }),
  );
  return { personId: person!.id, mailId: mail.id };
}

async function deliver(venueLocale = "en-GB") {
  const send = vi.fn(async () => ({ status: "sent" as const }));
  await runMailPass({
    db: suite.db,
    owners: [securityChangeMail({ venueLocale, readTimeZone: async () => "Europe/Madrid" })],
    now: () => new Date("2026-11-13T13:00:00Z"),
    isPrimary: () => true,
    signal: new AbortController().signal,
    resolveDelivery: async () => ({
      mode: "smtp",
      smtp: { url: "smtp://mail.test", from: "from@example.test" },
    }),
    send,
    log: () => {},
  });
  return send;
}

it.each(
  changes.flatMap(([change, en]) => [
    {
      change,
      locale: "en-GB",
      subject: "Your account security changed",
      text: `Corner Bistro: ${en} Changed on 13 Nov 2026, 13:00.\n\nIf this was not you, sign in, remove any login method you don't recognise and change your password; if you can't sign in, ask a venue administrator to reset your login.`,
    },
    {
      change,
      locale: "es-ES",
      subject: SECURITY_CHANGE_EMAIL_WORDS.es.subject,
      text: SECURITY_CHANGE_EMAIL_WORDS.es.text(
        "Corner Bistro",
        SECURITY_CHANGE_EMAIL_WORDS.es.changes[change],
        "13 nov 2026, 13:00",
      ),
    },
  ]),
)(
  "delivers $change in $locale at the original change time",
  async ({ change, locale, subject, text }) => {
    await queue(change, locale);
    const send = await deliver(locale === "es-ES" ? "en-GB" : "es-ES");
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      to: "original@example.test",
      subject,
      text,
    });
    const [saved] = await suite.db.select().from(outgoingMail);
    expect(saved).toMatchObject({
      status: "sent",
      recipient: "original@example.test",
      params: { change },
    });
  },
);

it("uses the current address and venue language at claim, without sending to a stale address", async () => {
  const f = await queue("password_changed", null);
  await withTransaction(suite.db, (tx) =>
    tx
      .update(persons)
      .set(
        withFoldedPersonChanges({
          email: "current@example.test",
          emailFolded: "current@example.test",
        }),
      )
      .where(eq(persons.id, f.personId)),
  );
  const send = await deliver("es-ES");
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    to: "current@example.test",
    subject: SECURITY_CHANGE_EMAIL_WORDS.es.subject,
    text: expect.stringContaining(SECURITY_CHANGE_EMAIL_WORDS.es.changes.password_changed),
  });
});

it("cancels a notice with no current address", async () => {
  const f = await queue("password_changed");
  await withTransaction(suite.db, (tx) =>
    tx
      .update(persons)
      .set(withFoldedPersonChanges({ email: null, emailFolded: null }))
      .where(eq(persons.id, f.personId)),
  );
  const send = await deliver();
  expect(send).not.toHaveBeenCalled();
  expect((await suite.db.select().from(outgoingMail))[0]).toMatchObject({
    status: "cancelled",
    attempts: 0,
    recipient: null,
  });
});
