import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedEmployment } from "../test/fixtures.js";
import { WorkforceBackend } from "./clocking.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { timeEntries } from "./schema/time-entries.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";
import { computeClosureHash } from "./pay-period-chain.js";
import type { PayPeriodClosure } from "./record-types.js";
const backend = new WorkforceBackend(),
  origin = jobOrigin("dashboard");
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
let personId: string, manager: string, other: string, locationId: string, nodeId: string;
const january = { start: "2026-01-01", end: "2026-02-01" };
const rules = {
  workingDaysPerWeek: 5,
  overtimeModel: "daily-accrual" as const,
  dailyTargetMinutes: null,
};
const event = (at: string, subject = personId, location = locationId) => ({
  nodeId,
  personId: subject,
  locationId: location,
  at,
  offsetMinutes: 0,
  origin,
});
const query = () => run((tx) => backend.timeRecord(tx, { period: january, personId }));
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
      { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
    ])
    .returning({ id: persons.id });
  [personId, manager, other] = rows.map((r) => r.id) as [string, string, string];
  await seedEmployment(suite.db, { personId });
});
afterEach(() => vi.useRealTimers());
async function day() {
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
  return (await suite.db.select().from(timeEntries).where(eq(timeEntries.entryKind, "out")))[0]!.id;
}
async function correct(target: string, at: string) {
  const request = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      correctsEntryId: target,
      at,
      offsetMinutes: 0,
      reason: "Correct departure",
      actorPersonId: personId,
      origin,
    }),
  );
  const answer = await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
  );
  return { request, answer };
}
async function freezeJanuary() {
  const record = await run((tx) => backend.timeRecord(tx, { period: january, locationId }));
  const row: Omit<PayPeriodClosure, "closureHash"> = {
    id: "018ee400-0000-7000-8000-000000000001",
    nodeId,
    locationId,
    period: january,
    clock: { timeZone: "UTC", dayCutover: "06:00", cutoverChanges: [] },
    scheduledCloseAt: "2026-02-01T06:00:00.000Z",
    closedAt: "2026-02-01T06:00:00.000Z",
    sequenceNo: 1,
    prevClosureHash: null,
    snapshot: {
      sessions: record.sessions,
      entries: record.entries,
      summaries: [
        { personId, summary: null },
        { personId: other, summary: null },
      ],
      markedAutomaticEntryIds: [],
    },
  };
  await suite.db.insert(payPeriodClosures).values({
    ...row,
    periodStart: january.start,
    periodEnd: january.end,
    closureHash: computeClosureHash(row),
  });
  return row.id;
}
it("returns a worker-scoped frozen snapshot without the other worker's entries or summaries", async () => {
  await day();
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z", other)));
  await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z", other)));
  const closureId = await freezeJanuary();
  const record = await query();
  expect(record.closures).toHaveLength(1);
  expect(record.closures[0]!.closureId).toBe(closureId);
  const snapshot = record.closures[0]!.snapshot;
  expect(snapshot.sessions.map((s) => s.personId)).toEqual([personId]);
  expect(snapshot.entries.map((e) => e.entry.personId)).toEqual([personId, personId]);
  expect(snapshot.summaries).toEqual([{ personId, summary: null }]);
  expect(snapshot.markedAutomaticEntryIds).toEqual([]);
  expect(record.closedPeriodImpacts).toEqual([]);
  const stored = (await suite.db.select().from(payPeriodClosures))[0]!.snapshot;
  expect(stored.sessions.map((s) => s.personId).sort()).toEqual([personId, other].sort());
});
it("reads the frozen snapshot and scoped impact after a correction recorded later", async () => {
  const target = await day();
  const closureId = await freezeJanuary();
  await correct(target, "2026-01-05T18:00:00Z");
  const record = await query();
  expect(record.closures[0]!.snapshot.sessions[0]!.workedMinutes).toBe(480);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId,
      personId,
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ]);
  const unrelated = await run((tx) =>
    backend.timeRecord(tx, { period: { start: "2026-03-01", end: "2026-04-01" }, personId }),
  );
  expect(unrelated.closures).toEqual([]);
  expect(unrelated.closedPeriodImpacts).toEqual([]);
});
it("reads a January target answered in March with the actual recorder metadata", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T20:00:00Z"));
  const target = await day();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  const ids = await correct(target, "2026-01-05T18:00:00Z");
  const record = await query();
  expect(record.sessions[0]!.workedMinutes).toBe(540);
  expect(record.entries.map((e) => e.entry.entryId)).toContain(ids.answer);
  expect(record.entries.find((e) => e.entry.entryId === ids.answer)).toMatchObject({
    author: { kind: "manager", personId: manager },
    entry: { recordedAt: "2026-03-10T12:00:00.000Z" },
  });
});
it("does not lose a correction that moves an end outside the requested window", async () => {
  const target = await day();
  const ids = await correct(target, "2026-02-02T18:00:00Z");
  const summary = await run((tx) => backend.workSummary(tx, { personId, period: january }, rules));
  expect(summary.workedMinutes).toBe(40860);
  const actual = await run((tx) => backend.getPlannedVsActual(tx, { locationId, period: january }));
  expect(actual.find((r) => r.personId === personId)?.workedMinutes).toBe(40860);
  const record = await query();
  expect(record.sessions[0]!.workedMinutes).toBe(40860);
  expect(record.entries.map((e) => e.entry.entryId)).toContain(ids.answer);
});
it("follows both versions when a whole session moves into the next month", async () => {
  const target = await day();
  await correct(target, "2026-02-05T17:00:00Z");
  const start = (
    await suite.db.select().from(timeEntries).where(eq(timeEntries.entryKind, "in"))
  )[0]!.id;
  await correct(start, "2026-02-05T09:00:00Z");
  const record = await query();
  expect(record.sessions).toEqual([]);
  expect(record.entries).toHaveLength(6);
  expect(
    (
      await run((tx) =>
        backend.timeRecord(tx, { period: { start: "2026-02-01", end: "2026-03-01" }, personId }),
      )
    ).sessions[0]!.workedMinutes,
  ).toBe(480);
  expect(
    (await run((tx) => backend.workSummary(tx, { personId, period: january }, rules)))
      .workedMinutes,
  ).toBe(0);
});
it("keeps another node's proposal and answer attached to the original worker day", async () => {
  const target = await day();
  const second = await seedNode(suite.db, brandLocationId(locationId));
  const request = await run((tx) =>
    backend.proposeCorrection(tx, {
      nodeId: second,
      correctsEntryId: target,
      at: "2026-01-05T18:00:00Z",
      offsetMinutes: 0,
      reason: "Later departure",
      actorPersonId: manager,
      origin,
    }),
  );
  await run((tx) =>
    backend.acceptCorrection(tx, {
      nodeId,
      correctionId: request,
      actorPersonId: personId,
      origin,
    }),
  );
  const record = await query();
  expect(record.sessions[0]!.workedMinutes).toBe(540);
  expect(record.entries.find((e) => e.entry.entryId === request)!.entry.nodeId).toBe(second);
});
it("keeps split shifts and two locations scoped without another worker's entries", async () => {
  await day();
  const second = await seedLocation(suite.db);
  await run((tx) => backend.clockIn(tx, event("2026-01-05T18:00:00Z", personId, second)));
  await run((tx) => backend.clockOut(tx, event("2026-01-05T20:00:00Z", personId, second)));
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z", other)));
  await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z", other)));
  const record = await query();
  expect(record.sessions.map((s) => s.workedMinutes)).toEqual([480, 120]);
  expect(record.entries.every((e) => e.entry.personId === personId)).toBe(true);
  const scoped = await run((tx) =>
    backend.timeRecord(tx, { period: january, personId, locationId: second }),
  );
  expect(scoped.sessions.map((s) => s.workedMinutes)).toEqual([120]);
  expect(scoped.entries).toHaveLength(2);
});
it("rejects an unscoped record query", async () => {
  await expect(run((tx) => backend.timeRecord(tx, { period: january }))).rejects.toMatchObject({
    code: "attendance.invalid",
  });
});
it("includes the end of a session starting in the period and ending in the next month", async () => {
  await run((tx) => backend.clockIn(tx, event("2026-01-31T23:00:00Z")));
  await run((tx) => backend.clockOut(tx, event("2026-02-01T02:00:00Z")));
  const record = await query();
  expect(record.sessions.map((s) => s.workedMinutes)).toEqual([180]);
  expect(record.entries.map((e) => e.entry.entryKind)).toEqual(["in", "out"]);
});
it.each([
  { period: null },
  { period: { start: "bad", end: "2026-02-01" } },
  { period: { start: "2026-02-31", end: "2026-04-01" } },
  { period: { start: "2026-02-01", end: "2026-02-01" } },
  { personId: null },
  { personId: [] },
])("refuses a malformed explicit record query %j", async (patch) => {
  await expect(
    run((tx) =>
      backend.timeRecord(tx, { period: january, personId, locationId, ...patch } as Parameters<
        WorkforceBackend["timeRecord"]
      >[1]),
    ),
  ).rejects.toMatchObject({ code: "attendance.invalid" });
});
it("does not automatically close a live in already closed by an approved missing out", async () => {
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  const openEntryId = (await suite.db.select().from(timeEntries))[0]!.id;
  const request = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      personId,
      locationId,
      missingEntryKind: "out",
      at: "2026-01-05T17:00:00Z",
      offsetMinutes: 0,
      reason: "Forgot",
      actorPersonId: personId,
      origin,
    }),
  );
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
  );
  await expect(
    run((tx) =>
      backend.recordAutomaticClose(tx, {
        nodeId,
        personId,
        locationId,
        openEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        origin,
      }),
    ),
  ).rejects.toMatchObject({ code: "attendance.not_pending" });
});
it("lets an approved missing end close the prior live shift and permits the next real in", async () => {
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  const request = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      personId,
      locationId,
      missingEntryKind: "out",
      at: "2026-01-05T17:00:00Z",
      offsetMinutes: 0,
      reason: "Forgot",
      actorPersonId: personId,
      origin,
    }),
  );
  await expect(
    run((tx) => backend.clockIn(tx, event("2026-01-06T09:00:00Z"))),
  ).rejects.toMatchObject({ code: "attendance.already_open" });
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
  );
  await run((tx) => backend.clockIn(tx, event("2026-01-06T09:00:00Z")));
  await expect(
    run((tx) => backend.clockIn(tx, event("2026-01-06T10:00:00Z"))),
  ).rejects.toMatchObject({ code: "attendance.already_open" });
  expect((await query()).sessions[0]!.workedMinutes).toBe(480);
});
