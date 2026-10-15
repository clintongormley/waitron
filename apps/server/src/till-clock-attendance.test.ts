import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { billPayments, newId, workingOrders, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons, sessions } from "@waitron/identity";
import {
  attendanceDayWork,
  attendanceQuestions,
  attendanceSourceState,
  appendToChain,
  readChain,
  timeEntries,
  verifyChain,
  WorkforceBackend,
} from "@waitron/workforce";
import { jobOrigin } from "@waitron/shared";
import { payments } from "@waitron/payments";
import { recordAttendanceFact } from "./attendance-capture.js";
import { beginIntegratedAttendance } from "./attendance-integrated.js";
import { beginAttendanceDiscovery } from "./attendance-discovery.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import type { TillClockState } from "./till-clock-state.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const backend = new WorkforceBackend();
let venue: ClockVenue, instant: Date;
beforeEach(async () => {
  instant = new Date("2026-01-05T09:00:00Z");
  venue = await createClockVenue(suite.db, () => instant);
  await suite.db
    .update(sessions)
    .set({ openedAt: instant.toISOString() })
    .where(eq(sessions.id, venue.sessionId));
});
function request(path = "state", expectedEntryId: string | null = null) {
  return venue.app.request(`/api/clock/${path}`, {
    method: path === "state" ? "GET" : "POST",
    headers: { cookie: venue.cookie, "Content-Type": "application/json" },
    ...(path === "state" ? {} : { body: JSON.stringify({ expectedEntryId }) }),
  });
}
async function rows() {
  return suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
}
async function open() {
  expect((await request("in")).status).toBe(200);
  return (await rows()).at(-1)!.id;
}
async function fact(at = "2026-01-05T16:40:00Z", personId = venue.personId, key = at) {
  await withTransaction(suite.db, (tx) =>
    recordAttendanceFact(tx, {
      source: "order",
      key,
      personId,
      locationId: venue.cfg.locationId,
      kind: "order",
      at,
      offsetMinutes: 60,
      outcome: "qualified",
    }),
  );
}
async function validChain() {
  expect(verifyChain(await readChain(suite.db, venue.cfg))).toEqual({ ok: true });
}
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("own clock reconciliation at the business-day boundary", () => {
  it.each([false, true])(
    "resolves an approved missing start while keeping targeted retimes separate (retimed=%s)",
    async (retimed) => {
      const append = (at: string, target: string | null = null) =>
        withTransaction(suite.db, (tx) =>
          appendToChain(tx, venue.cfg, {
            personId: venue.personId,
            entryKind: "correction",
            eventAt: at,
            eventOffsetMinutes: 60,
            recordedByPersonId: venue.personId,
            origin: jobOrigin("dashboard"),
            correctsEntryId: target,
            correctionReason: "Missing start",
            correctionStatus: "approved",
            correctionActorId: venue.personId,
            extension: {
              authorKind: "worker",
              direction: "worker_request",
              missingEntryKind: target === null ? "in" : null,
              respondsToEntryId: null,
              payPeriodClosureId: null,
            },
          }),
        );
      const missing = await append("2026-01-05T09:00:00.000Z");
      if (retimed) await append("2026-01-06T08:00:00.000Z", missing.id);
      await fact();
      const before = await rows();
      instant = new Date("2026-01-06T09:00:00Z");
      expect(await (await request()).json()).toMatchObject({ state: retimed ? "working" : "out" });
      const entries = await rows();
      expect(entries.slice(0, before.length)).toEqual(before);
      expect(entries).toHaveLength(before.length + (retimed ? 0 : 1));
      expect(await suite.db.select().from(attendanceQuestions)).toMatchObject([
        { openEntryId: missing.id, kind: retimed ? "missing-times" : "automatic-out" },
      ]);
      await validChain();
    },
  );
  it("refuses changed saved day bounds before appending anything", async () => {
    await open();
    await fact();
    await suite.db.update(attendanceDayWork).set({ endAt: "2026-01-06T05:00:00.000Z" });
    const before = await rows();
    instant = new Date("2026-01-06T09:00:00Z");
    const response = await request();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "attendance.invalid" } });
    expect(await rows()).toEqual(before);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([]);
  });
  it.each(["bill", "whole"] as const)(
    "rechecks a pending %s payment's accepted outcome before choosing the last instant",
    async (kind) => {
      await open();
      await fact("2026-01-05T12:00:00Z");
      const orderId = newId();
      await suite.db
        .insert(workingOrders)
        .values({ id: orderId, ...venue.cfg, source: "dashboard", orderNumber: 1 });
      if (kind === "whole") {
        await withTransaction(suite.db, (tx) =>
          beginIntegratedAttendance(
            tx,
            recordAttendanceFact,
            { id: orderId, provider: "fake", personId: venue.personId },
            () => new Date("2026-01-05T17:00:00Z"),
          ),
        );
        await suite.db.insert(payments).values({
          workingOrderId: orderId,
          provider: "fake",
          paymentRef: "accepted",
          source: "operator_script",
          amount: 100,
          state: "captured",
          settledAt: "2026-01-06T07:00:00Z",
        });
      } else {
        const id = newId();
        await suite.db.insert(billPayments).values({
          id,
          workingOrderId: orderId,
          submissionId: "one",
          fingerprint: "one",
          kind: "contribution",
          method: "card",
          applied: 100,
          state: "received",
          requestedBy: venue.personId,
          source: "device",
          deviceId: venue.deviceId,
          createdAt: "2026-01-05T18:00:00Z",
          receivedAt: "2026-01-06T07:00:00Z",
        });
        await withTransaction(suite.db, (tx) =>
          recordAttendanceFact(tx, {
            source: "bill-payment",
            key: id,
            personId: venue.personId,
            locationId: venue.cfg.locationId,
            kind: "payment",
            at: "2026-01-05T17:00:00Z",
            offsetMinutes: 60,
            outcome: "pending",
          }),
        );
      }
      instant = new Date("2026-01-06T09:00:00Z");
      expect(await (await request()).json()).toMatchObject({ state: "out" });
      expect((await rows()).at(-1)).toMatchObject({
        entryKind: "out",
        eventAt: "2026-01-05T17:00:00.000Z",
        authorKind: "automatic",
      });
      await validChain();
    },
  );
  it("reads complete accepted facts despite an unfinished bootstrap and preserves shared work", async () => {
    const start = await open();
    await fact("2026-01-05T10:00:00Z");
    await fact();
    const [other] = await suite.db
      .insert(persons)
      .values({ displayName: "Other", pinHash: "scrypt$00$00", role: "staff" })
      .returning();
    await fact("2026-01-05T18:00:00Z", other!.id);
    await withTransaction(suite.db, (tx) =>
      beginAttendanceDiscovery(tx, {
        locationId: venue.cfg.locationId,
        generation: "partly-scanned",
      }),
    );
    const work = await suite.db.select().from(attendanceDayWork);
    const scans = await suite.db.select().from(attendanceSourceState);
    expect(scans.some((s) => s.completed === false)).toBe(true);
    instant = new Date("2026-01-06T09:00:00Z");
    const response = await request();
    expect(response.status).toBe(200);
    const state = (await response.json()) as TillClockState;
    const entries = await rows();
    expect(entries).toMatchObject([
      { id: start, entryKind: "in" },
      {
        id: state.lastEntryId,
        entryKind: "out",
        eventAt: "2026-01-05T16:40:00.000Z",
        authorKind: "automatic",
        recordedByPersonId: null,
      },
    ]);
    expect(state).toMatchObject({ state: "out", firstClockIn: true, businessDay: "2026-01-06" });
    expect(await suite.db.select().from(attendanceDayWork)).toEqual(work);
    expect(await suite.db.select().from(attendanceSourceState)).toEqual(scans);
    expect(await suite.db.select().from(attendanceQuestions)).toMatchObject([
      { personId: venue.personId, automaticEntryId: state.lastEntryId },
    ]);
    expect((await suite.db.select().from(attendanceQuestions)).map((q) => q.personId)).toEqual([
      venue.personId,
    ]);
    await request();
    expect(await rows()).toEqual(entries);
    await validChain();
  });
  it.each(["in", "out", "break-start", "break-end"])(
    "commits the automatic end before refusing a stale %s",
    async (action) => {
      const start = await open();
      await fact();
      instant = new Date("2026-01-06T09:00:00Z");
      const response = await request(action, start);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "attendance.state_changed" } });
      expect((await rows()).map((e) => e.entryKind)).toEqual(["in", "out"]);
      expect((await rows()).at(-1)).toMatchObject({
        authorKind: "automatic",
        eventAt: "2026-01-05T16:40:00.000Z",
      });
      expect(await suite.db.select().from(attendanceQuestions)).toHaveLength(1);
      const last = (await rows()).at(-1)!.id;
      expect((await request("in", last)).status).toBe(200);
      expect((await rows()).map((e) => e.entryKind)).toEqual(["in", "out", "in"]);
      await validChain();
    },
  );
  it("finds retained sign-in evidence when no attendance day was discovered", async () => {
    await open();
    await suite.db
      .update(sessions)
      .set({ openedAt: "2026-01-05T17:00:00Z" })
      .where(eq(sessions.id, venue.sessionId));
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
    instant = new Date("2026-01-06T09:00:00Z");
    expect((await request()).status).toBe(200);
    expect((await rows()).at(-1)).toMatchObject({
      entryKind: "out",
      eventAt: "2026-01-05T17:00:00.000Z",
      authorKind: "automatic",
    });
    expect(await suite.db.select().from(attendanceDayWork)).toMatchObject([
      { evaluatedRevision: 0 },
    ]);
  });
  it("waits until the exact cutover instead of closing a still-current day", async () => {
    await open();
    await fact();
    const before = await rows();
    instant = new Date("2026-01-06T03:59:59Z");
    expect(await (await request()).json()).toMatchObject({ state: "working" });
    expect(await rows()).toEqual(before);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([]);
    instant = new Date("2026-01-06T04:00:00Z");
    expect(await (await request()).json()).toMatchObject({ state: "out" });
  });
  it("retains a missing-out question without fabricating an end for a start-only day", async () => {
    const start = await open();
    const before = await rows();
    instant = new Date("2026-01-06T09:00:00Z");
    expect(await (await request()).json()).toMatchObject({ state: "working", lastEntryId: start });
    expect(await rows()).toEqual(before);
    expect(await suite.db.select().from(attendanceQuestions)).toMatchObject([
      { openEntryId: start, kind: "missing-times", missingKinds: ["out"] },
    ]);
    const response = await request("in", start);
    expect(await response.json()).toMatchObject({ error: { code: "attendance.already_open" } });
    expect(await rows()).toEqual(before);
  });
  it("preserves a next-day break already in the legal record", async () => {
    await open();
    await fact();
    await withTransaction(suite.db, (tx) =>
      backend.breakStart(tx, {
        ...venue.cfg,
        personId: venue.personId,
        at: "2026-01-06T08:00:00Z",
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
      }),
    );
    const before = await rows();
    instant = new Date("2026-01-06T09:00:00Z");
    expect(await (await request()).json()).toMatchObject({ state: "on_break" });
    expect(await rows()).toEqual(before);
    expect(await suite.db.select().from(attendanceQuestions)).toMatchObject([
      { kind: "missing-times", missingKinds: ["out"] },
    ]);
    await validChain();
  });
  it("queues a stale break and own-state read behind a held writer and commits one end", async () => {
    const start = await open();
    await fact();
    const entered = gate(),
      held = gate(),
      queued = gate();
    const holder = withTransaction(suite.db, async () => {
      entered.release();
      await held.promise;
    });
    await entered.promise;
    const realLock = suite.db.withWriteLock.bind(suite.db);
    const spy = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>) => {
        queued.release();
        return realLock(body);
      });
    instant = new Date("2026-01-06T09:00:00Z");
    let read!: ReturnType<typeof request>, write!: ReturnType<typeof request>;
    try {
      write = request("break-start", start);
      read = request();
      await queued.promise;
    } finally {
      spy.mockRestore();
      held.release();
    }
    await holder;
    expect((await write).status).toBe(409);
    expect(await (await read).json()).toMatchObject({ state: "out" });
    expect((await rows()).map((e) => e.entryKind)).toEqual(["in", "out"]);
    expect(await suite.db.select().from(attendanceQuestions)).toHaveLength(1);
    await validChain();
  });
  it("rolls the legal append back when its question cannot be retained", async () => {
    await open();
    await fact();
    const before = await rows();
    await suite.db.execute(
      sql`create trigger refuse_attendance_question before insert on attendance_questions begin select raise(abort, 'question refused'); end`,
    );
    instant = new Date("2026-01-06T09:00:00Z");
    expect((await request()).status).toBe(500);
    expect(await rows()).toEqual(before);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([]);
    await validChain();
  });
});
