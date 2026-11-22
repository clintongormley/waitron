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
import { roleMembershipMail } from "./role-membership-mail.js";
import { ROLE_MEMBERSHIP_EMAIL_WORDS } from "./i18n/role-membership-email.js";
import { runMailPass } from "./mail-sender.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-13T12:00:00Z");
const cloudRole = "Night service ".repeat(5) + "Late crew\u{1F37D}";
const fullRole = cloudRole + "2 and close";
it.each([
  {
    locale: "en-GB",
    venueLocale: "es-ES",
    change: "added",
    builtInKey: "manager",
    roleName: null,
    subject: "Role added: Manager",
    text: "Editor added you to Manager on 13 Nov 2026, 13:00.",
  },
  {
    locale: "es-ES",
    venueLocale: "en-GB",
    change: "removed",
    builtInKey: "admin",
    roleName: null,
    subject: () =>
      ROLE_MEMBERSHIP_EMAIL_WORDS.es.removed.subject(ROLE_MEMBERSHIP_EMAIL_WORDS.es.roles.admin),
    text: () =>
      ROLE_MEMBERSHIP_EMAIL_WORDS.es.removed.text(
        "Editor",
        ROLE_MEMBERSHIP_EMAIL_WORDS.es.roles.admin,
        "13 nov 2026, 13:00",
      ),
  },
  {
    locale: null,
    venueLocale: "es-ES",
    change: "added",
    builtInKey: null,
    roleName: fullRole,
    subject: () => ROLE_MEMBERSHIP_EMAIL_WORDS.es.added.subject(fullRole),
    text: () => ROLE_MEMBERSHIP_EMAIL_WORDS.es.added.text("Editor", fullRole, "13 nov 2026, 13:00"),
  },
])(
  "sends $change to the current address using $locale before $venueLocale",
  async ({ locale, venueLocale, change, builtInKey, roleName, subject, text }) => {
    await seedVenue(suite.db, { name: "Corner Bistro" });
    const editor = builtInKey === null ? "E".repeat(79) + "\u{1F37D}" : "Editor";
    const fullEditor = builtInKey === null ? editor + "2 long name" : editor;
    const [person] = await seedPersons(suite.db, {
      displayName: "Waiter",
      email: "old@example.test",
      locale,
    });
    await withTransaction(suite.db, (tx) =>
      enqueueMail(tx, {
        kind: "role_membership_changed",
        dedupeKey: "membership",
        personId: person!.id,
        params: { change, builtInKey, roleName, editorName: fullEditor, at: now.toISOString() },
        now,
        notAfter: new Date(now.getTime() + 86400000),
      }),
    );
    await suite.db
      .update(persons)
      .set(withFoldedPersonChanges({ email: "current@example.test" }))
      .where(eq(persons.id, person!.id));
    const send = vi.fn(async () => ({ status: "sent" as const }));
    const owner = roleMembershipMail({ venueLocale, readTimeZone: async () => "Europe/Madrid" });
    const compose = vi.spyOn(owner, "compose");
    await runMailPass({
      db: suite.db,
      owners: [owner],
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
      to: "current@example.test",
      subject: typeof subject === "function" ? subject() : subject,
      text: (typeof text === "function" ? text() : text).replace("Editor", fullEditor),
    });
    expect((await compose.mock.results[0]!.value).staffNotice).toEqual({
      class: "role_membership_changed",
      displayName: "Corner Bistro",
      locale: locale ?? venueLocale,
      timeZone: "Europe/Madrid",
      expiresAt: "2026-11-14T12:00:00.000Z",
      facts: {
        change,
        editorName: editor,
        at: "2026-11-13T12:00:00.000Z",
        ...(builtInKey === null ? { roleName: cloudRole } : { builtInKey }),
      },
    });
    expect((await suite.db.select().from(outgoingMail))[0]).toMatchObject({
      status: "sent",
      recipient: "current@example.test",
      attempts: 1,
    });
  },
);

it("cancels delivery if the person no longer has an email", async () => {
  const [person] = await seedPersons(suite.db, {
    displayName: "Waiter",
    email: "old@example.test",
  });
  await withTransaction(suite.db, (tx) =>
    enqueueMail(tx, {
      kind: "role_membership_changed",
      dedupeKey: "membership",
      personId: person!.id,
      params: {
        change: "added",
        builtInKey: "staff",
        roleName: null,
        editorName: "Editor",
        at: now.toISOString(),
      },
      now,
      notAfter: new Date(now.getTime() + 86400000),
    }),
  );
  await suite.db
    .update(persons)
    .set(withFoldedPersonChanges({ email: null }))
    .where(eq(persons.id, person!.id));
  const send = vi.fn(async () => ({ status: "sent" as const }));
  const result = await runMailPass({
    db: suite.db,
    owners: [
      roleMembershipMail({ venueLocale: "en-GB", readTimeZone: async () => "Europe/Madrid" }),
    ],
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
  expect(result.processed).toBe(true);
  expect(send).not.toHaveBeenCalled();
  expect((await suite.db.select().from(outgoingMail))[0]!.status).toBe("cancelled");
});
