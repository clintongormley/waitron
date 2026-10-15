import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  jobOrigin,
  locationId as brandLocationId,
  type RecordExportDocument,
  type RecordExportInput,
} from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  closePayPeriod,
  type TimeRecord,
} from "@waitron/workforce";
import * as api from "./index.js";

const prepare = (
  api as typeof api & {
    prepareTimeRecordExport: (
      tx: Transaction,
      input: RecordExportInput,
    ) => Promise<() => Promise<RecordExportDocument>>;
  }
).prepareTimeRecordExport;
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
afterEach(() => vi.useRealTimers());
const origin = jobOrigin("dashboard");
const period = { start: "2026-01-01", end: "2026-02-01" };
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
let worker: string, other: string, manager: string, nodeId: string, locationId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Deli", invoiceLocales: ["en"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  locationId = location!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      {
        displayName: "María Worker",
        role: "staff",
        email: "worker-canary@example.test",
        telephone: "+34900000001",
      },
      { displayName: "Other worker", role: "staff", email: "other-canary@example.test" },
      { displayName: "José Manager", role: "manager", email: "manager-canary@example.test" },
    ])
    .returning({ id: persons.id });
  [worker, other, manager] = rows.map((r) => r.id) as [string, string, string];
});
const event = (at: string, personId = worker) => ({
  nodeId,
  locationId,
  personId,
  at,
  offsetMinutes: 0,
  origin,
});
const input = (patch: Partial<RecordExportInput> = {}): RecordExportInput => ({
  locationId,
  period,
  audience: "standard",
  locale: "en",
  ...patch,
});
const doc = async (patch: Partial<RecordExportInput> = {}) => {
  const format = await run((tx) => prepare(tx, input(patch)));
  return format();
};
const cells = (d: RecordExportDocument, key: string) =>
  d.sections.find((s) => s.key === key)!.rows.map((r) => r.cells);
const rows = (d: RecordExportDocument) => d.sections.flatMap((s) => s.rows.map((r) => r.cells));
const read = () => run((tx) => backend.timeRecord(tx, { period, locationId, personId: worker }));
async function day(automatic = false, personId = worker) {
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z", personId)));
  const entries = await run((tx) => backend.timeRecord(tx, { period, personId, locationId }));
  const openEntryId = entries.entries[0]!.entry.entryId;
  if (automatic)
    return run((tx) =>
      backend.recordAutomaticClose(tx, { ...event("2026-01-05T17:00:00Z", personId), openEntryId }),
    );
  await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z", personId)));
  return (await run((tx) => backend.timeRecord(tx, { period, personId, locationId }))).entries[1]!
    .entry.entryId;
}
const close = () =>
  run((tx) =>
    closePayPeriod(tx, {
      nodeId,
      locationId,
      period,
      clock: { timeZone: "UTC", dayCutover: "06:00", cutoverChanges: [] },
      now: "2026-02-01T06:00:00Z",
      ruleset: { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
      origin,
    }),
  );
async function request(
  target: string,
  reason = "Later finish",
  actorPersonId = worker,
  at = "2026-01-05T18:00:00Z",
) {
  return run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      correctsEntryId: target,
      at,
      offsetMinutes: 0,
      reason,
      actorPersonId,
      origin,
    }),
  );
}

it("keeps automatic ends counted and worker acknowledgment separate", async () => {
  const target = await day(true);
  const before = await doc();
  expect(cells(before, "sessions")[0]).toMatchObject({
    personId: worker,
    personName: "María Worker",
    date: "2026-01-05",
    startedAtLocal: "2026-01-05T09:00:00+00:00",
    endedAtLocal: "2026-01-05T17:00:00+00:00",
    workedMinutes: 480,
    breakMinutes: 0,
    startOffsetMinutes: 0,
    endOffsetMinutes: 0,
  });
  expect(cells(before, "history").find((r) => r.entryId === target)).toMatchObject({
    automatic: true,
    unconfirmed: false,
    confirmedByWorker: false,
    authorKind: "automatic",
    authorPersonId: null,
    effective: true,
  });
  await run((tx) =>
    backend.confirmAutomaticEntry(tx, { nodeId, entryId: target, workerPersonId: worker, origin }),
  );
  expect(cells(await doc(), "history").find((r) => r.entryId === target)).toMatchObject({
    automatic: true,
    unconfirmed: false,
    confirmedByWorker: true,
  });
});
it("keeps originals, requests, approvals, reasons and stored self approval", async () => {
  const target = await day();
  await suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, worker));
  const change = await request(target, '= later, "reason"\nnew line');
  const answer = await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: change, approverPersonId: worker }),
  );
  await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, worker));
  const exported = await doc();
  expect(cells(exported, "sessions")[0]!.workedMinutes).toBe(540);
  expect(cells(exported, "history").map((r) => r.entryId)).toEqual(
    expect.arrayContaining([target, change, answer]),
  );
  expect(cells(exported, "history").find((r) => r.entryId === answer)).toMatchObject({
    selfApproved: true,
    corrected: true,
    respondsToEntryId: change,
    correctsEntryId: target,
    authorPersonId: worker,
    authorName: "María Worker",
    reason: '= later, "reason"\nnew line',
  });
});
it("retains disputed manager changes without counting the proposed time", async () => {
  const target = await day();
  const change = await request(target, "Manager proposal", manager);
  const answer = await run((tx) =>
    backend.disagreeCorrection(tx, {
      nodeId,
      correctionId: change,
      actorPersonId: worker,
      reason: "Worker disagrees",
      origin,
    }),
  );
  const exported = await doc();
  expect(cells(exported, "sessions")[0]!.workedMinutes).toBe(480);
  expect(cells(exported, "history").find((r) => r.entryId === change)).toMatchObject({
    authorKind: "manager",
    authorName: "José Manager",
    disputed: true,
  });
  expect(cells(exported, "history").find((r) => r.entryId === answer)).toMatchObject({
    correctionStatus: "disputed",
    respondsToEntryId: change,
    authorName: "María Worker",
  });
});
it("preserves frozen 480, late current 540 and person isolation", async () => {
  const target = await day();
  await day(false, other);
  await close();
  const before = (await read()).closures[0]!;
  const change = await request(target);
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: change, approverPersonId: manager }),
  );
  const own = await doc({ personId: worker });
  expect(cells(own, "sessions").map((r) => r.workedMinutes)).toEqual([540]);
  expect(cells(own, "frozen-sessions").map((r) => r.workedMinutes)).toEqual([480]);
  expect(cells(own, "impacts")[0]).toMatchObject({
    personId: worker,
    beforeWorkedMinutes: 480,
    afterWorkedMinutes: 540,
    deltaWorkedMinutes: 60,
  });
  expect(cells(own, "closures")[0]).toMatchObject({
    closureId: before.closureId,
    closureHash: before.closureHash,
    periodStart: "2026-01-01",
    periodEnd: "2026-02-01",
  });
  expect(
    rows(own)
      .filter((r) => r.personId !== undefined)
      .every((r) => r.personId === worker),
  ).toBe(true);
  expect(
    cells(await doc(), "frozen-sessions")
      .map((r) => r.personId)
      .sort(),
  ).toEqual([worker, other].sort());
});
it("minimizes representatives live and frozen reasons and preserves authors", async () => {
  const target = await day();
  const change = await request(target, "ID-NUMBER-CANARY worker-canary@example.test");
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: change, approverPersonId: manager }),
  );
  await close();
  const standard = await doc();
  const reps = await doc({ audience: "representatives", locale: "es" });
  expect(JSON.stringify(standard)).toContain("ID-NUMBER-CANARY");
  const text = JSON.stringify(reps);
  for (const forbidden of [
    "ID-NUMBER-CANARY",
    "worker-canary@example.test",
    "manager-canary@example.test",
    "+34900000001",
  ]) {
    expect(text).not.toContain(forbidden);
  }
  expect(text).toContain("María Worker");
  expect(text).toContain("José Manager");
  for (const section of reps.sections) {
    expect(section.columns.some((c) => c.key === "reason")).toBe(false);
    for (const r of section.rows) expect(Object.keys(r.cells)).not.toContain("reason");
  }
});
it("keeps the captured record, names and input after later writes", async () => {
  await day();
  const sent = input();
  const format = await run((tx) => prepare(tx, sent));
  sent.audience = "representatives";
  sent.period = { start: "2030-01-01", end: "2030-02-01" };
  await suite.db.update(persons).set({ displayName: "Changed name" }).where(eq(persons.id, worker));
  const target = (await read()).entries.find((r) => r.entry.entryKind === "out")!.entry.entryId;
  const change = await request(target);
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: change, approverPersonId: manager }),
  );
  const captured = await format();
  expect(captured.audience).toBe("standard");
  expect(captured.period).toEqual(period);
  expect(cells(captured, "sessions")[0]).toMatchObject({
    personName: "María Worker",
    workedMinutes: 480,
  });
  expect(cells(await doc(), "sessions")[0]).toMatchObject({
    personName: "Changed name",
    workedMinutes: 540,
  });
});
it("exports empty and open history without inventing a completed session", async () => {
  const empty = await doc();
  expect(cells(empty, "sessions")).toEqual([]);
  expect(cells(empty, "totals")[0]!.workedMinutes).toBe(0);
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  await run((tx) => backend.breakStart(tx, event("2026-01-05T12:00:00Z")));
  const open = await doc();
  expect(cells(open, "sessions")).toEqual([]);
  expect(cells(open, "history").map((r) => r.entryKind)).toEqual(["in", "break_start"]);
  expect(cells(open, "totals")[0]!.workedMinutes).toBe(0);
});

it("follows a retimed shift out of January into February without duplicate totals", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-31T17:01:00Z"));
  await run((tx) => backend.clockIn(tx, event("2026-01-31T09:00:00Z")));
  await run((tx) => backend.clockOut(tx, event("2026-01-31T17:00:00Z")));
  const original = await read();
  const first = original.entries.find((r) => r.entry.entryKind === "in")!.entry.entryId;
  const last = original.entries.find((r) => r.entry.entryKind === "out")!.entry.entryId;
  vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));
  for (const [target, at] of [
    [last, "2026-02-01T17:00:00Z"],
    [first, "2026-02-01T09:00:00Z"],
  ]) {
    const change = await request(target!, "Boundary correction", worker, at!);
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId: change, approverPersonId: manager }),
    );
  }
  const january = await doc();
  const february = await doc({ period: { start: "2026-02-01", end: "2026-03-01" } });
  expect(cells(january, "totals")[0]!.workedMinutes).toBe(0);
  expect(cells(february, "totals")[0]!.workedMinutes).toBe(480);
  expect(cells(february, "sessions").map((r) => r.date)).toEqual(["2026-02-01"]);
  const decisions = cells(february, "history").filter((r) => r.entryKind === "correction");
  expect(decisions).toHaveLength(4);
  expect(decisions.map((r) => r.recordedAt)).toEqual(Array(4).fill("2026-03-05T12:00:00.000Z"));
  expect(decisions.map((r) => r.nodeId)).toEqual(Array(4).fill(nodeId));
  for (const exported of [january, february])
    expect(cells(exported, "history").map((r) => r.entryId)).toEqual(
      expect.arrayContaining([first, last]),
    );
});
it("keeps recorded DST offsets and elapsed minutes after subtracting a break", async () => {
  await run((tx) => backend.clockIn(tx, { ...event("2026-10-25T00:30:00Z"), offsetMinutes: 120 }));
  await run((tx) =>
    backend.breakStart(tx, { ...event("2026-10-25T01:00:00Z"), offsetMinutes: 60 }),
  );
  await run((tx) => backend.breakEnd(tx, { ...event("2026-10-25T01:30:00Z"), offsetMinutes: 60 }));
  await run((tx) => backend.clockOut(tx, { ...event("2026-10-25T02:30:00Z"), offsetMinutes: 60 }));
  const exported = await doc({ period: { start: "2026-10-01", end: "2026-11-01" } });
  expect(cells(exported, "sessions")[0]).toMatchObject({
    date: "2026-10-25",
    startedAtLocal: "2026-10-25T02:30:00+02:00",
    endedAtLocal: "2026-10-25T03:30:00+01:00",
    startOffsetMinutes: 120,
    endOffsetMinutes: 60,
    breakMinutes: 30,
    workedMinutes: 90,
  });
});
it("keeps the full frozen period and explicit null and populated summary values", async () => {
  const { seedEmployment } = await import("../test/fixtures.js");
  await seedEmployment(suite.db, { personId: worker, contractedMinutesPerWeek: 1200 });
  const automaticId = await day(true);
  await day(false, other);
  await run((tx) => backend.clockIn(tx, event("2026-01-07T09:00:00Z")));
  await run((tx) => backend.clockOut(tx, event("2026-01-07T17:00:00Z")));
  await close();
  await run((tx) =>
    backend.confirmAutomaticEntry(tx, {
      nodeId,
      entryId: automaticId,
      workerPersonId: worker,
      origin,
    }),
  );
  const exported = await doc({ period: { start: "2026-01-05", end: "2026-01-06" } });
  expect(cells(exported, "closures")[0]).toMatchObject({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-01",
  });
  expect(cells(exported, "frozen-summaries").find((r) => r.personId === worker)).toMatchObject({
    summaryAvailable: true,
    workedMinutes: 960,
    contractedMinutes: 5314,
    dailyAccrualOvertimeMinutes: 480,
    periodNetOvertimeMinutes: 0,
    overtimeMinutes: 480,
  });
  expect(cells(exported, "frozen-summaries").find((r) => r.personId === other)).toMatchObject({
    summaryAvailable: false,
    workedMinutes: null,
    contractedMinutes: null,
  });
  expect(cells(exported, "frozen-days").find((r) => r.personId === worker)).toMatchObject({
    date: "2026-01-05",
    workedMinutes: 480,
    contractedTargetMinutes: 240,
    overtimeMinutes: 240,
  });
  expect(cells(exported, "automatic-marks")).toHaveLength(1);
  expect(cells(exported, "automatic-marks")[0]!.entryId).toBe(automaticId);
  expect(cells(exported, "frozen-history").find((r) => r.entryId === automaticId)).toMatchObject({
    automatic: true,
    unconfirmed: false,
    confirmedByWorker: false,
  });
  expect(cells(exported, "history").find((r) => r.entryId === automaticId)).toMatchObject({
    automatic: true,
    unconfirmed: false,
    confirmedByWorker: true,
  });
  expect(
    cells(exported, "frozen-sessions")
      .filter((r) => r.personId === worker)
      .map((r) => r.date),
  ).toEqual(["2026-01-05", "2026-01-07"]);
  expect(
    cells(exported, "sessions")
      .filter((r) => r.personId === worker)
      .map((r) => r.date),
  ).toEqual(["2026-01-05"]);
});
it("selects only declared scalar keys even when live and frozen objects gain data", async () => {
  await day();
  await close();
  const captured: TimeRecord = structuredClone(await read());
  const extra = {
    email: "EXTRA-EMAIL-CANARY",
    nationalId: "EXTRA-ID-CANARY",
    profile: { telephone: "EXTRA-PHONE-CANARY" },
  };
  for (const value of [captured, ...captured.closures.map((c) => c.snapshot)]) {
    Object.assign(value, extra);
    for (const row of value.entries) {
      Object.assign(row, extra);
      Object.assign(row.entry, extra);
      Object.assign(row.author, extra);
    }
  }
  const { formatTimeRecordExport } = await import("./record-export.js");
  const exported = formatTimeRecordExport(
    captured,
    input({ audience: "representatives" }),
    new Map([[worker, "María Worker"]]),
    "Deli",
  );
  const text = JSON.stringify(exported);
  for (const value of ["EXTRA-EMAIL-CANARY", "EXTRA-ID-CANARY", "EXTRA-PHONE-CANARY"])
    expect(text).not.toContain(value);
  for (const section of exported.sections) {
    for (const row of section.rows)
      expect(Object.keys(row.cells).sort()).toEqual(section.columns.map((c) => c.key).sort());
    expect(new Set(section.rows.map((r) => r.key)).size).toBe(section.rows.length);
  }
  expect(cells(exported, "history")[0]).toMatchObject({
    personName: "María Worker",
    entryKind: "in",
    eventAtLocal: "2026-01-05T09:00:00+00:00",
  });
});
it("retains unknown actor references instead of dropping their decisions", async () => {
  const target = await day();
  const change = await request(target);
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: change, approverPersonId: manager }),
  );
  const { formatTimeRecordExport } = await import("./record-export.js");
  const exported = formatTimeRecordExport(
    await read(),
    input({ locale: "es" }),
    new Map([[worker, "María Worker"]]),
    "Deli",
  );
  expect(cells(exported, "history").find((r) => r.authorPersonId === manager)).toMatchObject({
    authorName: "Persona desconocida",
    correctsEntryId: target,
  });
});
