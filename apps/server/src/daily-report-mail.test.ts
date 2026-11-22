import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  appendDrawerEntry,
  finishDrawerClose,
  outgoingMail,
  saveDrawerCount,
  saveSettings,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { dailyReportMail, queueDailyReportMail } from "./daily-report-mail.js";
import { DAILY_REPORT_MAIL_SETTINGS } from "./daily-report-mail-settings.js";
import { runMailPass } from "./mail-sender.js";
import { provisionBillVenue } from "./testing/bill-venue.js";
import { decimal } from "@waitron/shared";
import { recordSyntheticInvoice } from "./testing/synthetic-invoice.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const now = new Date("2026-10-13T06:00:00Z");
// The synthetic invoice is issued on this business day.
const businessDay = "2026-10-12";

function mailPass(nodeIdForMail: string, sendAt = now) {
  const sent: { to: unknown; subject: unknown; text: unknown }[] = [];
  const deps = {
    db: suite.db,
    owners: [
      dailyReportMail({
        venueLanguage: "en",
        nodeId: nodeIdForMail,
        managementOrigin: "https://box.test",
      }),
    ],
    now: () => sendAt,
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
  return { deps, sent };
}

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
  const { deps, sent } = mailPass(venue.cfg.nodeId);
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
  expect(sent[0]?.text).not.toContain("Cierres de caja");
  expect(sent[0]?.text).toContain("\n0%  ");
  expect(await queued()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ personId: retained!.id, status: "sent" }),
      expect.objectContaining({ personId: revoked!.id, status: "cancelled" }),
    ]),
  );
});

it("emails drawer counts and differences even on a day without sales", async () => {
  const venue = await provisionBillVenue(suite.db);
  await withTransaction(suite.db, async (tx) => {
    const people = await seedPersons(tx, [
      { displayName: "Alex", email: "alex@example.test", role: "manager" },
      { displayName: "Sam", email: "sam@example.test", role: "manager" },
    ]);
    await tx.update(persons).set({ locale: "es-ES" }).where(eq(persons.id, people[0]!.id));
    await tx.update(persons).set({ locale: "en-GB" }).where(eq(persons.id, people[1]!.id));
    const actor = {
      nodeId: venue.cfg.nodeId,
      personId: people[0]!.id,
      recordedAt: "2026-10-12T15:00:00.000Z",
    };
    const drawer = await createPrinter(tx, {
      name: "History drawer",
      transport: "network_tcp",
      host: "history-drawer.test",
      hasCashDrawer: true,
    });
    const onDrawer = { ...actor, printerId: drawer.id, deviceId: null };
    const movement = await appendDrawerEntry(tx, { ...onDrawer, kind: "cash_in", amount: 1000 });
    const count = await saveDrawerCount(tx, onDrawer, {
      startSequence: movement.sequence,
      counted: decimal("8.00"),
    });
    await finishDrawerClose(tx, onDrawer, {
      firstCountId: count.first.id,
      confirmSequence: count.confirmSequence,
      amountLeft: decimal("0.00"),
    });
    const late = await createPrinter(tx, {
      name: "Back bar",
      transport: "network_tcp",
      host: "back-bar.test",
      hasCashDrawer: true,
    });
    await appendDrawerEntry(tx, { ...actor, printerId: late.id, kind: "cash_in", amount: 1000 });
    await saveSettings(tx, DAILY_REPORT_MAIL_SETTINGS, {
      doc: { enabled: true, recipientIds: people.map(({ id }) => id) },
      expectedRevision: 0,
      personId: null,
    });
    await queueDailyReportMail(tx, businessDay, now);
    const later = await createPrinter(tx, {
      name: "Later drawer",
      transport: "network_tcp",
      host: "later-drawer.test",
      hasCashDrawer: true,
    });
    await appendDrawerEntry(tx, {
      ...actor,
      printerId: later.id,
      recordedAt: "2026-10-13T07:00:00.000Z",
      kind: "cash_in",
      amount: 1000,
    });
  });
  const { deps, sent } = mailPass(venue.cfg.nodeId, new Date("2026-10-14T03:00:00Z"));
  await runMailPass(deps);
  await runMailPass(deps);
  expect(await runMailPass(deps)).toEqual({ processed: false });
  const es = sent.find(({ to }) => to === "alex@example.test")?.text;
  const en = sent.find(({ to }) => to === "sam@example.test")?.text;
  expect(en).toMatch(
    /Sales +0.*\n[\s\S]*Drawer closes\nHistory drawer.*Counted.*8\.00.*Difference.*-€2\.00/,
  );
  expect(es).toMatch(
    /Ventas +0.*\n[\s\S]*Cierres de caja\nHistory drawer.*Recuento.*8,00.*Diferencia.*-2,00/,
  );
  expect(en).toContain("Back bar needs a close. Assign it to a till so staff can close it.");
  expect(es).toContain(
    "Falta cerrar Back bar. Asígnalo a un TPV para que el personal pueda cerrarlo.",
  );
  expect(en).not.toContain("Later drawer");
  expect(en).toContain("https://box.test/sales");
  expect(es).toContain("https://box.test/sales");
});
