import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { locations, newId } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { persons } from "@waitron/identity";
import { locationId as brandLocationId, type BusinessDayClock } from "@waitron/shared";
import { attendanceFixture } from "../test/attendance-fixture.js";
import * as api from "./index.js";
import { readAttendanceRevision } from "./attendance-responses.js";
import type { AttendanceCommandPayload, HoursSelection } from "./attendance-contract.js";

const f = attendanceFixture();
const clock: BusinessDayClock = {
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  cutoverChanges: [],
};
const now = new Date("2026-10-31T23:30:00Z");
afterEach(() => vi.useRealTimers());

function read(
  selection: HoursSelection = { kind: "month", date: "2026-01-05" },
  subject = f.personId,
  at = now,
  venueClock = clock,
  locationId = f.locationId,
) {
  expect(api).toHaveProperty("readPersonHours", expect.any(Function));
  return f.run((tx) =>
    api.readPersonHours(tx, {
      personId: subject,
      locationId,
      selection,
      clock: venueClock,
      now: at,
    }),
  );
}
function manager(
  selection: HoursSelection = { kind: "pay-period", date: "2026-01-05" },
  venueClock = clock,
) {
  expect(api).toHaveProperty("readManagerHours", expect.any(Function));
  return f.run((tx) =>
    api.readManagerHours(tx, { locationId: f.locationId, selection, clock: venueClock, now }),
  );
}
async function event(
  kind: "clockIn" | "clockOut" | "breakStart" | "breakEnd",
  at: string,
  offsetMinutes = 0,
  personId = f.personId,
  locationId = f.locationId,
) {
  await f.run((tx) => f.backend[kind](tx, { ...f.event(at), offsetMinutes, personId, locationId }));
  return (await f.entries()).at(-1)!.id;
}
async function shift(date = "2026-01-05", personId = f.personId, locationId = f.locationId) {
  const start = await event("clockIn", `${date}T09:00:00Z`, 0, personId, locationId);
  const end = await event("clockOut", `${date}T17:00:00Z`, 0, personId, locationId);
  return { start, end };
}
async function send(
  payload: AttendanceCommandPayload,
  requester = f.personId,
  subject = f.personId,
  nodeId = f.nodeId,
) {
  const expectedRevision = await f.run((tx) => readAttendanceRevision(tx, subject));
  return f.run((tx) =>
    api.executeAttendanceCommand(tx, {
      nodeId,
      requestedByPersonId: requester,
      authorizedByPersonId: requester,
      origin: f.event("").origin,
      command: { ...payload, commandId: newId(), expectedRevision },
      now,
    }),
  );
}
function request(target: string, at = "2026-01-05T18:00:00Z", questionId: string | null = null) {
  return send({
    action: "request",
    questionId,
    locationId: f.locationId,
    changes: [{ target: { entryId: target }, at, offsetMinutes: 0 }],
    reason: "I left later",
  });
}
async function automatic() {
  const start = await f.open();
  const end = await f.run((tx) =>
    f.backend.recordAutomaticClose(tx, { ...f.event("2026-01-05T17:00:00Z"), openEntryId: start }),
  );
  const questionId = await f.run((tx) =>
    api.upsertAttendanceQuestion(
      tx,
      {
        personId: f.personId,
        day: f.day(),
        shiftKey: `open:${start}`,
        kind: "automatic-out",
        missingKinds: [],
        openEntryId: start,
        automaticEntryId: end,
        evidenceKeys: ["order:last"],
      },
      now,
    ),
  );
  return { start, end, questionId };
}
function freeze() {
  return f.run((tx) =>
    api.closePayPeriod(tx, {
      nodeId: f.nodeId,
      locationId: f.locationId,
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock,
      now: "2026-02-01T04:00:00Z",
      origin: f.event("").origin,
      ruleset: { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
    }),
  );
}

it("defaults the window to the venue business date while the local calendar is in November", async () => {
  const value = await read({ kind: "month" });
  expect(value).toMatchObject({
    personId: f.personId,
    locationId: f.locationId,
    selection: { kind: "month" },
    businessDay: "2026-10-31",
    period: { start: "2026-10-01", end: "2026-11-01" },
    clock,
    asOf: "2026-10-31T23:30:00.000Z",
    workedMinutes: 0,
  });
  expect(value.days).toHaveLength(31);
  expect(value.days[0]).toEqual({ date: "2026-10-01", sessions: [], workedMinutes: 0 });
  expect(value.days.at(-1)).toEqual({ date: "2026-10-31", sessions: [], workedMinutes: 0 });
});
it.each([
  ["week", "2027-01-01", "2026-12-28", "2027-01-04", 7],
  ["week", "2026-01-05", "2026-01-05", "2026-01-12", 7],
  ["month", "2024-02-29", "2024-02-01", "2024-03-01", 29],
] as const)("resolves %s around %s with exclusive end", async (kind, date, start, end, count) => {
  const value = await read({ kind, date });
  expect(value.period).toEqual({ start, end });
  expect(value.days).toHaveLength(count);
  expect(value.days.some((d) => d.date === end)).toBe(false);
});
it("the default business date can differ from UTC today", async () => {
  const value = await read({ kind: "week" }, f.personId, new Date("2026-01-05T01:00:00Z"));
  expect(value.businessDay).toBe("2026-01-04");
  expect(value.period).toEqual({ start: "2025-12-29", end: "2026-01-05" });
});
it("keeps an overnight 210-minute shift and both end dates on its stored local start date", async () => {
  await event("clockIn", "2026-01-31T21:00:00Z", 60);
  await event("breakStart", "2026-01-31T22:00:00Z", 60);
  await event("breakEnd", "2026-01-31T22:30:00Z", 60);
  await event("clockOut", "2026-02-01T01:00:00Z", 60);
  await f.suite.db
    .update(locations)
    .set({ timeZone: "America/New_York" })
    .where(eq(locations.id, f.locationId));
  const value = await read(undefined, f.personId, now, { ...clock, timeZone: "America/New_York" });
  expect(value.workedMinutes).toBe(210);
  expect(value.days.at(-1)).toMatchObject({
    date: "2026-01-31",
    workedMinutes: 210,
    sessions: [
      {
        workDate: "2026-01-31",
        startedAt: "2026-01-31T21:00:00.000Z",
        endedAt: "2026-02-01T01:00:00.000Z",
        startOffsetMinutes: 60,
        endOffsetMinutes: 60,
        breakMinutes: 30,
        workedMinutes: 210,
      },
    ],
  });
  expect(value.record.entries.map((e) => e.entry.offsetMinutes)).toEqual([60, 60, 60, 60]);
  expect((await read({ kind: "month", date: "2026-02-01" })).workedMinutes).toBe(0);
});
it("retains different DST offsets and 120 actual minutes", async () => {
  await event("clockIn", "2026-10-25T00:30:00Z", 120);
  await event("clockOut", "2026-10-25T02:30:00Z", 60);
  const value = await read({ kind: "month", date: "2026-10-25" });
  expect(value.workedMinutes).toBe(120);
  expect(value.days[24]!.sessions[0]).toMatchObject({
    startOffsetMinutes: 120,
    endOffsetMinutes: 60,
    workedMinutes: 120,
  });
});
it("sums split shifts once and leaves zero days and exclusive-end work out", async () => {
  await shift();
  await event("clockIn", "2026-01-05T19:00:00Z");
  await event("clockOut", "2026-01-05T21:00:00Z");
  await shift("2026-02-01");
  const value = await read();
  expect(value.workedMinutes).toBe(600);
  expect(value.days[4]!.workedMinutes).toBe(600);
  expect(value.days[4]!.sessions.map((s) => s.workedMinutes)).toEqual([480, 120]);
  expect(value.days[5]).toEqual({ date: "2026-01-06", sessions: [], workedMinutes: 0 });
});
it("shows old open work and its current break without inventing a completed session", async () => {
  const start = await f.open();
  let value = await read({ kind: "week", date: "2026-10-31" });
  expect(value.openShifts).toMatchObject([{ start: { entryId: start }, breakStart: null }]);
  const pause = await event("breakStart", "2026-01-05T12:00:00Z");
  value = await read({ kind: "week", date: "2026-10-31" });
  expect(value.workedMinutes).toBe(0);
  expect(value.record.sessions).toEqual([]);
  expect(value.openShifts).toMatchObject([
    { start: { entryId: start }, breakStart: { entryId: pause } },
  ]);
  expect(value.record.entries.map((e) => e.entry.entryId)).toEqual([start, pause]);
  await event("breakEnd", "2026-01-05T12:30:00Z");
  expect((await read()).openShifts[0]!.breakStart).toBeNull();
});
it("counts an unacknowledged automatic end and keeps it visible while a retime awaits approval", async () => {
  const { end, questionId } = await automatic();
  let value = await read();
  expect(value.workedMinutes).toBe(480);
  expect(value.openShifts).toEqual([]);
  expect(value.pending.automaticEntryIds).toEqual([end]);
  expect(value.pending.prompts.map((p) => p.id)).toEqual([questionId]);
  expect(value.record.entries.find((e) => e.entry.entryId === end)).toMatchObject({
    author: { kind: "automatic", personId: null },
    effective: true,
    confirmed: true,
    confirmedByWorker: false,
  });
  const requested = await request(end, undefined, questionId);
  value = await read();
  expect(value.pending.prompts).toEqual([]);
  expect(value.pending.items.map((i) => [i.id, i.status])).toEqual([
    [requested.entryIds[0], "waiting-manager"],
  ]);
  expect(value.pending.automaticEntryIds).toEqual([end]);
  expect(value.workedMinutes).toBe(480);
  await send({ action: "approve", itemId: requested.entryIds[0]! }, f.manager);
  value = await read();
  expect(value.workedMinutes).toBe(540);
  expect(value.pending.automaticEntryIds).toEqual([]);
  expect(value.pending.items).toEqual([]);
  expect(value.record.entries.find((e) => e.entry.entryId === end)).toMatchObject({
    effective: false,
    corrected: true,
  });
  expect(value.record.entries.at(-1)).toMatchObject({
    effective: true,
    entry: { eventAt: "2026-01-05T18:00:00.000Z" },
  });
});
it("worker acknowledgement changes no minutes and is separate from an automatic closure marker", async () => {
  const { end, questionId } = await automatic();
  await freeze();
  expect((await read()).pending.automaticEntryIds).toEqual([end]);
  await send({ action: "confirm", questionId });
  const value = await read();
  expect(value.workedMinutes).toBe(480);
  expect(value.pending).toEqual({ prompts: [], items: [], automaticEntryIds: [] });
  expect(value.record.entries.find((e) => e.entry.entryId === end)).toMatchObject({
    confirmed: true,
    confirmedByWorker: true,
  });
});
it("a proposal and then dispute retain 480 and old outstanding history in an empty selected week", async () => {
  const { end } = await shift();
  const proposed = await send(
    {
      action: "propose",
      personId: f.personId,
      locationId: f.locationId,
      changes: [{ target: { entryId: end }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 }],
      reason: "Check finish",
    },
    f.manager,
  );
  expect((await read()).workedMinutes).toBe(480);
  expect((await read()).pending.prompts.map((p) => p.itemId)).toEqual([proposed.entryIds[0]]);
  const disputed = await send({
    action: "disagree",
    itemId: proposed.entryIds[0]!,
    reason: "I left at five",
  });
  const value = await read({ kind: "week", date: "2026-10-31" });
  expect(value.workedMinutes).toBe(0);
  expect(value.pending.prompts).toEqual([]);
  expect(value.pending.items.map((i) => [i.id, i.status])).toEqual([
    [proposed.entryIds[0], "disputed"],
  ]);
  expect(value.record.entries.map((e) => e.entry.entryId)).toEqual(
    expect.arrayContaining([end, proposed.entryIds[0]!, disputed.entryIds[0]!]),
  );
  expect((await read()).workedMinutes).toBe(480);
});
it("keeps old missing questions and unacknowledged automatic history outside a selected empty month", async () => {
  const { start, end, questionId } = await automatic();
  const value = await read({ kind: "month", date: "2026-10-31" });
  expect(value.workedMinutes).toBe(0);
  expect(value.pending.automaticEntryIds).toEqual([end]);
  expect(value.pending.prompts.map((p) => p.id)).toEqual([questionId]);
  expect(value.record.entries.map((e) => e.entry.entryId)).toEqual([start, end]);
});
it("keeps stored self-approval after the administrator becomes staff", async () => {
  await f.suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, f.personId));
  const { end } = await shift();
  const requested = await request(end);
  const approval = await send({ action: "approve", itemId: requested.entryIds[0]! });
  await f.suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, f.personId));
  const value = await read();
  expect(value.workedMinutes).toBe(540);
  expect(value.record.entries.find((e) => e.entry.entryId === approval.entryIds[0])).toMatchObject({
    selfApproved: true,
    author: { kind: "manager", personId: f.personId },
  });
});
it("keeps frozen 480, scoped snapshots and late 540 distinct after cadence and zone change", async () => {
  const { end } = await shift();
  await shift(undefined, f.other);
  const closed = await freeze();
  const requested = await request(end);
  await send({ action: "approve", itemId: requested.entryIds[0]! }, f.manager);
  await f.run((tx) => api.setPayPeriodSettings(tx, { frequency: "weekly", anchorDate: null }));
  const changedClock = { ...clock, timeZone: "America/New_York", dayCutover: "07:00" };
  const value = await read({ kind: "week", date: "2026-01-05" }, f.personId, now, changedClock);
  expect(value.period).toEqual({ start: "2026-01-05", end: "2026-01-12" });
  expect(value.workedMinutes).toBe(540);
  expect(value.closures).toEqual([
    {
      closureId: closed.id,
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock,
      scheduledCloseAt: closed.scheduledCloseAt,
      closedAt: closed.closedAt,
      closureHash: closed.closureHash,
      frozenWorkedMinutes: 480,
    },
  ]);
  const snapshot = value.record.closures[0]!.snapshot;
  expect(snapshot.sessions.map((s) => s.personId)).toEqual([f.personId]);
  expect(snapshot.entries.map((e) => e.entry.personId)).toEqual([f.personId, f.personId]);
  expect(snapshot.summaries.map((s) => s.personId)).toEqual([f.personId]);
  expect(value.record.closedPeriodImpacts).toEqual([
    {
      closureId: closed.id,
      personId: f.personId,
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ]);
  const listed = await manager(undefined, changedClock);
  expect(listed.period).toEqual({ start: "2026-01-01", end: "2026-02-01" });
  expect(listed.people.find((p) => p.personId === f.personId)!.hours.closures[0]!.closureHash).toBe(
    closed.closureHash,
  );
  expect((await f.suite.db.select().from(api.payPeriodClosures))[0]!.snapshot).toEqual(
    closed.snapshot,
  );
});
it("follows late other-node corrections moving a whole shift across a closed month", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T20:00:00Z"));
  const { start, end } = await shift();
  const closed = await freeze();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  const second = await seedNode(f.suite.db, brandLocationId(f.locationId));
  for (const [target, at] of [
    [end, "2026-02-05T17:00:00Z"],
    [start, "2026-02-05T09:00:00Z"],
  ]) {
    const proposed = await send(
      {
        action: "propose",
        personId: f.personId,
        locationId: f.locationId,
        changes: [{ target: { entryId: target! }, at: at!, offsetMinutes: 0 }],
        reason: "February shift",
      },
      f.manager,
      f.personId,
      second,
    );
    await send({ action: "accept", itemId: proposed.entryIds[0]! });
  }
  const jan = await read();
  const feb = await read({ kind: "month", date: "2026-02-05" });
  expect(jan.workedMinutes).toBe(0);
  expect(feb.workedMinutes).toBe(480);
  expect(jan.record.closedPeriodImpacts).toEqual([
    {
      closureId: closed.id,
      personId: f.personId,
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 0,
      deltaWorkedMinutes: -480,
    },
  ]);
  for (const value of [jan, feb]) {
    expect(value.record.entries).toHaveLength(6);
    expect(value.record.entries.filter((e) => e.entry.nodeId === second)).toHaveLength(2);
    expect(
      value.record.entries
        .filter((e) => e.entry.correctsEntryId)
        .every((e) => e.entry.recordedAt === "2026-03-10T12:00:00.000Z"),
    ).toBe(true);
    expect(value.record.entries.map((e) => e.entry.entryId)).toEqual(
      expect.arrayContaining([start, end]),
    );
  }
  expect(jan.closures[0]!.frozenWorkedMinutes).toBe(480);
});
it("never leaks another person or location through own open/pending/history/closures", async () => {
  const own = await shift();
  await shift(undefined, f.other);
  const ownRequest = await request(own.end);
  await event("clockIn", "2026-01-06T09:00:00Z", 0, f.personId, f.elsewhere);
  await event("clockOut", "2026-01-06T17:00:00Z", 0, f.personId, f.elsewhere);
  const value = await read();
  expect(value.workedMinutes).toBe(480);
  expect(value.pending.items.map((i) => i.id)).toEqual([ownRequest.entryIds[0]]);
  expect(
    value.record.entries.every(
      (e) => e.entry.personId === f.personId && e.entry.locationId === f.locationId,
    ),
  ).toBe(true);
  expect(value.openShifts).toEqual([]);
});
it("manager includes minimal names, zero-hour people and suspended history without mutating any attendance facts", async () => {
  await shift(undefined, f.other);
  await f.suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, f.other));
  await automatic();
  const closed = await freeze();
  const state = await f.state();
  const closures = await f.suite.db.select().from(api.payPeriodClosures);
  const value = await manager();
  expect(value.people.map((p) => p.displayName)).toEqual(["Manager", "Other", "Worker"]);
  expect(value.people.map((p) => Object.keys(p).sort())).toEqual([
    ["displayName", "hours", "personId"],
    ["displayName", "hours", "personId"],
    ["displayName", "hours", "personId"],
  ]);
  expect(value.people.find((p) => p.personId === f.manager)!.hours.workedMinutes).toBe(0);
  expect(value.people.find((p) => p.personId === f.other)!.hours.workedMinutes).toBe(480);
  expect(value.people.find((p) => p.personId === f.personId)!.hours.closures[0]!.closureHash).toBe(
    closed.closureHash,
  );
  await read();
  expect(await f.state()).toEqual(state);
  expect(await f.suite.db.select().from(api.payPeriodClosures)).toEqual(closures);
});
it.each(["", "bad", "2026-02-30", "9999-12-31", null])(
  "refuses invalid or unrepresentable date %s",
  async (date) => {
    await expect(read({ kind: "month", date } as HoursSelection)).rejects.toMatchObject({
      code: "attendance.invalid",
    });
  },
);
it("refuses empty scopes and unknown window kinds instead of reading the venue", async () => {
  await expect(read(undefined, "")).rejects.toMatchObject({ code: "attendance.invalid" });
  await expect(read(undefined, f.personId, now, clock, "")).rejects.toMatchObject({
    code: "attendance.invalid",
  });
  await expect(read({ kind: "fortnight" } as unknown as HoursSelection)).rejects.toMatchObject({
    code: "attendance.invalid",
  });
});
