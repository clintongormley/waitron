import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  enqueueMail,
  incidents,
  outgoingMail,
  persons,
  readMail,
  withTransaction,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { boxAlertMail } from "./box-alert-mail.js";
import { boxEmailMessage, type BoxAlertCode } from "./box-alert-email.js";
import { runMailPass, type MailSenderDeps } from "./mail-sender.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-09T12:00:00.000Z");
let personId: string;
let deps: MailSenderDeps;
const log = vi.fn();
beforeEach(async () => {
  log.mockClear();
  await seedVenue(suite.db, { name: "Corner Bistro" });
  const [person] = await suite.db
    .insert(persons)
    .values({
      displayName: "Private manager",
      role: "manager",
      email: "  manager@example.test ",
      locale: "es-ES",
    })
    .returning();
  personId = person!.id;
  await suite.db.insert(persons).values({
    displayName: "Other manager",
    role: "admin",
    email: "other@example.test",
    locale: "en-GB",
  });
  deps = {
    db: suite.db,
    owners: [boxAlertMail({ previousEpisodeMailIds: new Set(), venueLanguage: "en", log })],
    now: () => now,
    isPrimary: () => true,
    signal: new AbortController().signal,
    log: () => {},
    resolveDelivery: async () => ({
      mode: "smtp",
      smtp: { url: "smtp://mail.test", from: "from@example.test" },
    }),
    send: vi.fn(async () => ({ status: "sent" as const })),
  };
});
async function queue(
  code: BoxAlertCode,
  options: { handled?: boolean; incident?: boolean; params?: Record<string, unknown> } = {},
) {
  let subjectId: string | null = null;
  if (options.incident !== false) {
    const [incident] = await suite.db
      .insert(incidents)
      .values({
        source: "dashboard",
        code,
        params: options.params ?? {},
        severity: "warning",
        detectedAt: now.toISOString(),
        acknowledgedAt: options.handled ? now.toISOString() : null,
      })
      .returning();
    subjectId = incident!.id;
  }
  await withTransaction(suite.db, (tx) =>
    enqueueMail(tx, {
      kind: "box_alert",
      dedupeKey: "notice",
      personId,
      subjectId,
      params: { code, wording: subjectId ? null : JSON.stringify(options.params ?? {}) },
      now,
      notAfter: new Date(now.getTime() + 86400000),
    }),
  );
  return subjectId;
}
const row = () => readMail(suite.db, "notice");

it("sends an open alert in the manager's own language without personal log fields", async () => {
  const params = { count: 2, unconfirmed: true };
  await queue("clock.records_misdated", { params });
  await runMailPass(deps);
  expect(deps.send).toHaveBeenCalledWith(expect.anything(), {
    to: "manager@example.test",
    ...boxEmailMessage("clock.records_misdated", "es", "Corner Bistro", params),
  });
  expect(await row()).toMatchObject({ status: "sent" });
  expect(log.mock.calls).toEqual([["info", "box_email.sent", { code: "clock.records_misdated" }]]);
});

it.each(["handled", "gone"])("cancels an ordinary alert whose row is %s", async (state) => {
  const id = await queue("clock.records_misdated", { handled: state === "handled" });
  if (state === "gone") await suite.db.delete(incidents).where(eq(incidents.id, id!));
  await runMailPass(deps);
  expect(await row()).toMatchObject({ status: "cancelled", attempts: 0 });
  expect(deps.send).not.toHaveBeenCalled();
});

it.each([
  { role: "staff" as const },
  { status: "suspended" as const },
  { email: "   " },
  { email: null },
])("cancels mail for an inadmissible recipient %o", async (patch) => {
  await queue("clock.records_misdated");
  await suite.db.update(persons).set(patch).where(eq(persons.id, personId));
  await runMailPass(deps);
  expect(await row()).toMatchObject({ status: "cancelled", attempts: 0 });
  expect(deps.send).not.toHaveBeenCalled();
});

it.each([0, 1])("sends a handled clock change with %i prior attempts", async (attempts) => {
  await queue("clock.corrected", { handled: true });
  if (attempts)
    await suite.db
      .update(outgoingMail)
      .set({ status: "rejected", attempts })
      .where(eq(outgoingMail.dedupeKey, "notice"));
  await runMailPass(deps);
  expect(await row()).toMatchObject({ status: "sent", attempts: attempts + 1 });
  expect(deps.send).toHaveBeenCalledOnce();
});

it.each([
  { handled: true, serverRefused: true, status: "cancelled" },
  { handled: true, serverRefused: false, status: "rejected" },
  { handled: false, serverRefused: true, status: "rejected" },
])("settles a clock-change refusal %o", async ({ handled, serverRefused, status }) => {
  const id = await queue("clock.corrected");
  deps.send = async () => {
    if (handled)
      await withTransaction(suite.db, (tx) =>
        tx
          .update(incidents)
          .set({ acknowledgedAt: now.toISOString() })
          .where(eq(incidents.id, id!)),
      );
    return { status: "rejected", reason: "email.test_connection_refused", serverRefused };
  };
  await runMailPass(deps);
  expect(await row()).toMatchObject({ status, attempts: 1 });
});

it.each([
  ["storage.space_low", {}],
  ["backup.run_stopped", { neededBytes: 1024, availableBytes: 512 }],
  [
    "clock.behind_chain",
    {
      clockAt: "2026-11-09T11:00:00.000Z",
      offsetMinutes: 60,
      lastRecordAt: "2026-11-09T12:00:00.000Z",
      lastRecordOffsetMinutes: 60,
    },
  ],
] as const)(
  "words %s from its queued params using the venue language fallback",
  async (code, params) => {
    await suite.db.update(persons).set({ locale: null }).where(eq(persons.id, personId));
    await queue(code, { incident: false, params });
    await runMailPass(deps);
    expect(deps.send).toHaveBeenCalledWith(expect.anything(), {
      to: "manager@example.test",
      ...boxEmailMessage(code, "en", "Corner Bistro", params),
    });
  },
);

it("logs each failed outcome once per row, then its successful send", async () => {
  await queue("storage.space_low", { incident: false });
  deps.send = async () => ({
    status: "rejected",
    reason: "email.test_connection_refused",
    serverRefused: true,
  });
  let time = now;
  deps.now = () => time;
  await runMailPass(deps);
  time = new Date(now.getTime() + 60000);
  await runMailPass(deps);
  deps.send = async () => ({
    status: "rejected",
    reason: "email.test_connection_refused",
    serverRefused: false,
  });
  time = new Date(now.getTime() + 120000);
  await runMailPass(deps);
  deps.send = async () => ({ status: "sent" });
  time = new Date(now.getTime() + 420000);
  await runMailPass(deps);
  expect(log.mock.calls).toEqual([
    ["warn", "box_email.send_failed", { code: "storage.space_low", outcome: "rejected" }],
    ["warn", "box_email.send_failed", { code: "storage.space_low", outcome: "unknown" }],
    ["info", "box_email.sent", { code: "storage.space_low" }],
  ]);
  expect(await row()).toMatchObject({ status: "sent", attempts: 4 });
});

it("expires an old alert email without a sent or failed line", async () => {
  await queue("storage.space_low", { incident: false });
  deps.now = () => new Date(now.getTime() + 86400001);
  await runMailPass(deps);
  expect(await row()).toMatchObject({ status: "expired" });
  expect(log).not.toHaveBeenCalled();
});
