import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { outgoingMail, saveSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { dailyReportMail, queueDailyReportMail } from "./daily-report-mail.js";
import { DAILY_REPORT_MAIL_SETTINGS } from "./daily-report-mail-settings.js";
import { runMailPass } from "./mail-sender.js";
import { provisionBillVenue } from "./testing/bill-venue.js";
import { recordSyntheticInvoice } from "./testing/synthetic-invoice.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const now = new Date("2026-10-13T06:00:00Z");
// The synthetic invoice is issued on this business day.
const businessDay = "2026-10-12";

it("queues a report once per day and recipient and rechecks each recipient at send time", async () => {
  const venue = await provisionBillVenue(suite.db);
  await recordSyntheticInvoice(suite.db, venue.cfg.nodeId, {
    full: false,
    operationDescription: "Coffee sale",
    quantity: "1.5",
  });
  const [retained, revoked] = await withTransaction(suite.db, async (tx) => {
    const people = await seedPersons(tx, [
      { displayName: "Alex", email: "alex@example.test", role: "supervisor" },
      { displayName: "Sam", email: "sam@example.test", role: "manager" },
    ]);
    await tx.update(persons).set({ locale: "es-ES" }).where(eq(persons.id, people[0]!.id));
    await saveSettings(tx, DAILY_REPORT_MAIL_SETTINGS, {
      doc: { enabled: true, recipientIds: people.map(({ id }) => id) },
      expectedRevision: 0,
      personId: null,
    });
    await queueDailyReportMail(tx, businessDay, now);
    await queueDailyReportMail(tx, businessDay, now);
    await setBuiltInRoleForTest(tx, people[1]!.id, "staff");
    return people;
  });
  const queued = () =>
    suite.db.select().from(outgoingMail).where(eq(outgoingMail.kind, "daily_report"));
  expect((await queued()).map(({ personId }) => personId).sort()).toEqual(
    [retained!.id, revoked!.id].sort(),
  );
  const sent: { to: unknown; subject: unknown; text: unknown }[] = [];
  const deps = {
    db: suite.db,
    owners: [dailyReportMail({ venueLanguage: "en", nodeId: venue.cfg.nodeId })],
    now: () => now,
    isPrimary: () => true,
    signal: new AbortController().signal,
    resolveDelivery: async () => ({
      mode: "smtp" as const,
      smtp: { url: "smtps://smtp.example.test", from: "admin@example.test" },
    }),
    send: async (
      _smtp: unknown,
      { to, subject, text }: { to?: unknown; subject?: unknown; text?: unknown },
    ) => {
      sent.push({ to, subject, text });
      return { status: "sent" as const };
    },
    log: () => {},
  };
  for (let pass = 0; pass < 2; pass++) await runMailPass(deps);
  expect(await runMailPass(deps)).toEqual({ processed: false });
  expect(sent).toEqual([
    {
      to: "alex@example.test",
      subject: expect.stringContaining("2026-10-12"),
      text: expect.stringContaining("0,00"),
    },
  ]);
  expect(sent[0]?.text).toContain("Coffee  1,5  ");
  expect(sent[0]?.text).toContain("\n0%  ");
  expect(await queued()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ personId: retained!.id, status: "sent" }),
      expect.objectContaining({ personId: revoked!.id, status: "cancelled" }),
    ]),
  );
});
