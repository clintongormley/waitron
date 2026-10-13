import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandedLocationId } from "@waitron/shared";
import { seedLocation, seedEmployment } from "../test/fixtures.js";
import * as api from "./index.js";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, api.WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new api.WorkforceBackend();
const origin = jobOrigin("dashboard");
const period = { start: "2026-10-01", end: "2026-11-01" };
const clock = { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] };
const ruleset = {
  workingDaysPerWeek: 5,
  overtimeModel: "daily-accrual" as const,
  dailyTargetMinutes: null,
};
let nodeId: string, locationId: string, worker: string, manager: string, other: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandedLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
      { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
    ])
    .returning({ id: persons.id });
  [worker, manager, other] = rows.map((r) => r.id) as [string, string, string];
  await seedEmployment(suite.db, { personId: worker });
});
const event = (at: string, personId = worker) => ({
  nodeId,
  locationId,
  personId,
  at,
  offsetMinutes: 0,
  origin,
});
const close = (patch: Partial<Parameters<typeof api.closePayPeriod>[1]> = {}) =>
  run((tx) =>
    api.closePayPeriod(tx, {
      nodeId,
      locationId,
      period,
      clock,
      now: "2026-11-01T05:00:00Z",
      ruleset,
      origin,
      ...patch,
    }),
  );
it("counts a next-month local-day automatic end only when that next month closes", async () => {
  await run((tx) => backend.clockIn(tx, { ...event("2026-10-31T23:30:00Z"), offsetMinutes: 60 }));
  const openEntryId = (await suite.db.select().from(api.timeEntries))[0]!.id;
  const entryId = await run((tx) =>
    backend.recordAutomaticClose(tx, {
      ...event("2026-11-01T04:00:00Z"),
      offsetMinutes: 60,
      openEntryId,
    }),
  );
  const october = await close();
  expect(october.snapshot.countedAutomaticEntryIds).toEqual([]);
  expect(october.snapshot.sessions).toEqual([]);
  expect(
    (await suite.db.select().from(api.timeEntries)).filter((e) => e.entryKind === "confirmation"),
  ).toEqual([]);
  const november = await close({
    period: { start: "2026-11-01", end: "2026-12-01" },
    now: "2026-12-01T05:00:00Z",
  });
  expect(november.snapshot.countedAutomaticEntryIds).toEqual([entryId]);
  expect(november.snapshot.sessions.map((s) => [s.workDate, s.workedMinutes])).toEqual([
    ["2026-11-01", 270],
  ]);
  const markers = (await suite.db.select().from(api.timeEntries)).filter(
    (e) => e.entryKind === "confirmation",
  );
  expect(markers).toHaveLength(1);
  expect(markers[0]).toMatchObject({ respondsToEntryId: entryId, payPeriodClosureId: november.id });
});
async function open(personId = worker) {
  await run((tx) => backend.clockIn(tx, event("2026-10-05T09:00:00Z", personId)));
  return (
    await suite.db.select().from(api.timeEntries).where(eq(api.timeEntries.personId, personId))
  ).at(-1)!.id;
}
async function automatic(personId = worker) {
  const openEntryId = await open(personId);
  return run((tx) =>
    backend.recordAutomaticClose(tx, { ...event("2026-10-05T17:00:00Z", personId), openEntryId }),
  );
}
it("refuses one second before Madrid cutover and writes at the exact boundary", async () => {
  await expect(close({ now: "2026-11-01T04:59:59Z" })).rejects.toMatchObject({
    code: "pay_period.not_due",
    params: { closeAt: "2026-11-01T05:00:00.000Z" },
  });
  expect(await suite.db.select().from(api.payPeriodClosures)).toEqual([]);
  expect((await close()).scheduledCloseAt).toBe("2026-11-01T05:00:00.000Z");
});
it("resolves a boundary on the DST change day", async () => {
  const dstClock = { ...clock, timeZone: "America/Havana" };
  await expect(close({ clock: dstClock, now: "2026-11-01T10:59:59Z" })).rejects.toMatchObject({
    code: "pay_period.not_due",
    params: { closeAt: "2026-11-01T11:00:00.000Z" },
  });
  expect((await close({ clock: dstClock, now: "2026-11-01T11:00:00Z" })).scheduledCloseAt).toBe(
    "2026-11-01T11:00:00.000Z",
  );
});
it("uses a dated cutover change stored with the frozen closure", async () => {
  const changed = {
    ...clock,
    cutoverChanges: [{ effectiveBusinessDay: "2026-11-01", dayCutover: "07:00" }],
  };
  await expect(close({ clock: changed })).rejects.toMatchObject({
    code: "pay_period.not_due",
    params: { closeAt: "2026-11-01T06:00:00.000Z" },
  });
  const result = await close({ clock: changed, now: "2026-11-01T06:00:00Z" });
  expect(result.clock).toEqual(changed);
});
it("counts an unanswered automatic end once without confirming or changing its author", async () => {
  const entryId = await automatic();
  expect(
    (await run((tx) => backend.timeRecord(tx, { period, personId: worker }))).sessions,
  ).toEqual([]);
  const frozen = await close();
  expect(frozen.snapshot.sessions[0]!.workedMinutes).toBe(480);
  expect(frozen.snapshot.countedAutomaticEntryIds).toEqual([entryId]);
  expect(frozen.snapshot.entries.find((e) => e.entry.entryId === entryId)).toMatchObject({
    author: { kind: "automatic", personId: null },
    confirmed: false,
    effective: true,
  });
  expect(frozen.snapshot.summaries[0]!.summary).toMatchObject({ workedMinutes: 480 });
  const record = await run((tx) => backend.timeRecord(tx, { period, personId: worker }));
  expect(record.sessions[0]!.workedMinutes).toBe(480);
  expect(record.closedPeriodImpacts).toEqual([]);
  expect(record.entries.find((e) => e.entry.entryId === entryId)).toMatchObject({
    confirmed: false,
    author: { kind: "automatic", personId: null },
  });
  expect(
    (await run((tx) => backend.getPlannedVsActual(tx, { locationId, period })))[0]!.workedMinutes,
  ).toBe(480);
  expect(api.verifyChain(await api.readChain(suite.db, { nodeId, locationId }))).toEqual({
    ok: true,
  });
  expect(api.verifyPayPeriodClosures([frozen])).toEqual({ ok: true });
});
it("keeps open no-activity shifts uncounted and visible", async () => {
  const entryId = await open();
  const frozen = await close();
  expect(frozen.snapshot.sessions).toEqual([]);
  expect(frozen.snapshot.entries.map((e) => e.entry.entryId)).toEqual([entryId]);
  expect(frozen.snapshot.countedAutomaticEntryIds).toEqual([]);
});
it("retains actual time without an employment and uses a null summary", async () => {
  await automatic(other);
  const frozen = await close();
  expect(frozen.snapshot.sessions[0]!.workedMinutes).toBe(480);
  expect(frozen.snapshot.summaries).toEqual([{ personId: other, summary: null }]);
  await expect(
    run((tx) => backend.workSummary(tx, { personId: other, period }, ruleset)),
  ).rejects.toMatchObject({ code: "employment.not_found" });
});
it("does not append another marker for an already confirmed automatic end", async () => {
  const entryId = await automatic();
  await run((tx) =>
    backend.confirmAutomaticEntry(tx, { nodeId, entryId, workerPersonId: worker, origin }),
  );
  const frozen = await close();
  expect(frozen.snapshot.sessions[0]!.workedMinutes).toBe(480);
  expect(frozen.snapshot.countedAutomaticEntryIds).toEqual([]);
  expect(
    (await suite.db.select().from(api.timeEntries)).filter((e) => e.entryKind === "confirmation"),
  ).toHaveLength(1);
});
it("replays the original snapshot after clock settings and rules change without appending", async () => {
  await automatic();
  const frozen = await close();
  const rows = await suite.db.select().from(api.timeEntries);
  await run((tx) => api.setPayPeriodSettings(tx, { frequency: "weekly", anchorDate: null }));
  expect(
    await close({
      clock: { ...clock, dayCutover: "08:00" },
      ruleset: { ...ruleset, dailyTargetMinutes: 1 },
    }),
  ).toEqual(frozen);
  expect(await suite.db.select().from(api.timeEntries)).toEqual(rows);
});
it("serialises simultaneous closes into one closure and one marker", async () => {
  await automatic();
  const [first, second] = await Promise.all([close(), close()]);
  expect(second).toEqual(first);
  expect(await suite.db.select().from(api.payPeriodClosures)).toHaveLength(1);
  expect(
    (await suite.db.select().from(api.timeEntries)).filter((e) => e.entryKind === "confirmation"),
  ).toHaveLength(1);
});
it("rolls back closure, markers and time-chain head when a second marker is refused", async () => {
  await automatic();
  await automatic(other);
  const entries = await suite.db.select().from(api.timeEntries),
    heads = await suite.db.select().from(api.workforceChains);
  await suite.db.execute(sql`CREATE TRIGGER test_refuse_second_marker BEFORE INSERT ON time_entries
    WHEN NEW.entry_kind = 'confirmation' AND (SELECT count(*) FROM time_entries WHERE entry_kind = 'confirmation') > 0
    BEGIN SELECT RAISE(ABORT, 'test marker failure'); END`);
  try {
    await expect(close()).rejects.toThrow(/test marker failure/);
  } finally {
    await suite.db.execute(sql`DROP TRIGGER test_refuse_second_marker`);
  }
  expect(await suite.db.select().from(api.payPeriodClosures)).toEqual([]);
  expect(await suite.db.select().from(api.timeEntries)).toEqual(entries);
  expect(await suite.db.select().from(api.workforceChains)).toEqual(heads);
});
it("records a late automatic end and counting marker against the unchanged closure", async () => {
  const openEntryId = await open();
  const frozen = await close();
  const entryId = await run((tx) =>
    backend.recordAutomaticClose(tx, { ...event("2026-10-05T17:00:00Z"), openEntryId }),
  );
  const rows = await suite.db.select().from(api.timeEntries);
  expect(rows).toHaveLength(3);
  expect(rows[2]).toMatchObject({
    entryKind: "confirmation",
    respondsToEntryId: entryId,
    payPeriodClosureId: frozen.id,
    authorKind: "automatic",
  });
  const record = await run((tx) => backend.timeRecord(tx, { period, personId: worker }));
  expect(record.sessions[0]!.workedMinutes).toBe(480);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: frozen.id,
      personId: worker,
      beforeWorkedMinutes: 0,
      afterWorkedMinutes: 480,
      deltaWorkedMinutes: 480,
    },
  ]);
  await expect(
    run((tx) =>
      backend.recordAutomaticClose(tx, { ...event("2026-10-05T17:00:00Z"), openEntryId }),
    ),
  ).rejects.toMatchObject({ code: "attendance.not_pending" });
  expect(await suite.db.select().from(api.timeEntries)).toEqual(rows);
  expect(await close()).toEqual(frozen);
});
it("rolls back a late automatic end when its marker is refused", async () => {
  const openEntryId = await open();
  const frozen = await close();
  const entries = await suite.db.select().from(api.timeEntries),
    heads = await suite.db.select().from(api.workforceChains);
  await suite.db.execute(
    sql`CREATE TRIGGER test_refuse_late_marker BEFORE INSERT ON time_entries WHEN NEW.entry_kind='confirmation' BEGIN SELECT RAISE(ABORT,'test late marker failure'); END`,
  );
  try {
    await expect(
      run((tx) =>
        backend.recordAutomaticClose(tx, { ...event("2026-10-05T17:00:00Z"), openEntryId }),
      ),
    ).rejects.toThrow(/test late marker failure/);
  } finally {
    await suite.db.execute(sql`DROP TRIGGER test_refuse_late_marker`);
  }
  expect(await suite.db.select().from(api.timeEntries)).toEqual(entries);
  expect(await suite.db.select().from(api.workforceChains)).toEqual(heads);
  expect(await close()).toEqual(frozen);
});
it("keeps a closed 480 frozen after a later accepted 540 and worker confirmation", async () => {
  const entryId = await automatic();
  const frozen = await close();
  const request = await run((tx) =>
    backend.proposeCorrection(tx, {
      nodeId,
      correctsEntryId: entryId,
      at: "2026-10-05T18:00:00Z",
      offsetMinutes: 0,
      reason: "Later departure",
      actorPersonId: manager,
      origin,
    }),
  );
  await run((tx) =>
    backend.acceptCorrection(tx, { nodeId, correctionId: request, actorPersonId: worker, origin }),
  );
  await run((tx) =>
    backend.confirmAutomaticEntry(tx, { nodeId, entryId, workerPersonId: worker, origin }),
  );
  const record = await run((tx) => backend.timeRecord(tx, { period, personId: worker }));
  expect(record.sessions[0]!.workedMinutes).toBe(540);
  expect(record.closures[0]!.snapshot.sessions[0]!.workedMinutes).toBe(480);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: frozen.id,
      personId: worker,
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ]);
  expect(await close()).toEqual(frozen);
});
it.each([
  { start: "2026-10-02", end: "2026-11-01" },
  { start: "2026-10-01", end: "2026-10-15" },
  { start: "bad", end: "2026-11-01" },
  null,
])("refuses a non-cadence or malformed period %j", async (bad) => {
  await expect(close({ period: bad as typeof period })).rejects.toMatchObject({
    code: "pay_period.invalid",
  });
  expect(await suite.db.select().from(api.payPeriodClosures)).toEqual([]);
});
it("refuses a newly configured period overlapping an already closed month", async () => {
  await close();
  await run((tx) => api.setPayPeriodSettings(tx, { frequency: "weekly", anchorDate: null }));
  await expect(close({ period: { start: "2026-10-05", end: "2026-10-12" } })).rejects.toMatchObject(
    { code: "pay_period.invalid" },
  );
});
it("freezes missing-entry requests and competing disputes without inventing a session", async () => {
  const missing = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      personId: worker,
      locationId,
      missingEntryKind: "in",
      at: "2026-10-05T09:00:00Z",
      offsetMinutes: 0,
      reason: "Forgot to clock in",
      actorPersonId: worker,
      origin,
    }),
  );
  const proposal = await run((tx) =>
    backend.proposeCorrection(tx, {
      nodeId,
      personId: other,
      locationId,
      missingEntryKind: "in",
      at: "2026-10-05T10:00:00Z",
      offsetMinutes: 0,
      reason: "Worked that morning",
      actorPersonId: manager,
      origin,
    }),
  );
  const dispute = await run((tx) =>
    backend.disagreeCorrection(tx, {
      nodeId,
      correctionId: proposal,
      actorPersonId: other,
      origin,
      reason: "I did not work then",
    }),
  );
  const frozen = await close();
  expect(frozen.snapshot.sessions).toEqual([]);
  expect(frozen.snapshot.entries.map((e) => e.entry.entryId)).toEqual([missing, proposal, dispute]);
  expect(frozen.snapshot.entries.find((e) => e.entry.entryId === missing)).toMatchObject({
    effective: false,
    entry: { correctionStatus: "requested", extension: { missingEntryKind: "in" } },
  });
  expect(frozen.snapshot.entries.find((e) => e.entry.entryId === dispute)).toMatchObject({
    effective: false,
    disputed: true,
    entry: { correctionReason: "I did not work then" },
  });
});
it("freezes accepted missing clock-in and clock-out entries with their requests", async () => {
  for (const [missingEntryKind, at] of [
    ["in", "2026-10-05T09:00:00Z"],
    ["out", "2026-10-05T17:00:00Z"],
  ] as const) {
    const request = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        personId: worker,
        locationId,
        missingEntryKind,
        at,
        offsetMinutes: 0,
        reason: "Forgot",
        actorPersonId: worker,
        origin,
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
    );
  }
  const frozen = await close();
  expect(frozen.snapshot.sessions.map((s) => s.workedMinutes)).toEqual([480]);
  expect(frozen.snapshot.entries).toHaveLength(4);
  expect(frozen.snapshot.countedAutomaticEntryIds).toEqual([]);
});
it.each([null, "", []])("refuses a malformed closure read location %j", async (bad) => {
  await expect(
    api.readPayPeriodClosures(suite.db, { locationId: bad as string, period }),
  ).rejects.toMatchObject({ code: "pay_period.invalid" });
});
it("reads overlapping closures and verifies successive months on the same chain", async () => {
  const first = await close();
  const nextPeriod = { start: "2026-11-01", end: "2026-12-01" };
  const second = await close({ period: nextPeriod, now: "2026-12-01T05:00:00Z" });
  expect(second.sequenceNo).toBe(2);
  expect(second.prevClosureHash).toBe(first.closureHash);
  expect(api.verifyPayPeriodClosures([second, first])).toEqual({ ok: true });
  expect(
    await api.readPayPeriodClosures(suite.db, {
      locationId,
      period: { start: "2026-10-15", end: "2026-11-15" },
    }),
  ).toEqual([first, second]);
  expect(await api.readPayPeriodClosures(suite.db, { locationId, period: nextPeriod })).toEqual([
    second,
  ]);
  expect(
    await api.readPayPeriodClosures(suite.db, {
      locationId,
      period: { start: "2026-12-01", end: "2027-01-01" },
    }),
  ).toEqual([]);
});
it("filters counted automatic ids and frozen histories to the queried worker", async () => {
  const own = await automatic();
  const foreign = await automatic(other);
  await close();
  const record = await run((tx) => backend.timeRecord(tx, { period, personId: worker }));
  expect(record.closures[0]!.snapshot.countedAutomaticEntryIds).toEqual([own]);
  expect(record.closures[0]!.snapshot.entries.some((e) => e.entry.entryId === foreign)).toBe(false);
  expect(record.closures[0]!.snapshot.summaries.map((s) => s.personId)).toEqual([worker]);
  expect(record.closedPeriodImpacts).toEqual([]);
});
it.each([
  null,
  { source: "device", deviceId: null },
  { source: "dashboard", deviceId: "a" },
  { source: "invalid", deviceId: null },
])("refuses a non-job closure origin %j", async (bad) => {
  await expect(close({ origin: bad as typeof origin })).rejects.toMatchObject({
    code: "pay_period.invalid",
  });
});
it.each([null, "bad"])("refuses a malformed closure instant %j", async (bad) => {
  await expect(close({ now: bad as string })).rejects.toMatchObject({ code: "pay_period.invalid" });
});
