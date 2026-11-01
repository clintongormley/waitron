import { StatementSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons, sessions } from "@waitron/identity";
import { jobOrigin } from "@waitron/shared";
import { attendanceDayWork, timeEntries, WorkforceBackend } from "@waitron/workforce";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import type { TillClockState } from "./till-clock-state.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const backend = new WorkforceBackend();
let venue: ClockVenue, instant: Date;
beforeEach(async () => {
  instant = new Date("2026-01-05T08:00:00Z");
  venue = await createClockVenue(suite.db, () => instant);
  await suite.db
    .update(sessions)
    .set({ openedAt: instant.toISOString() })
    .where(eq(sessions.id, venue.sessionId));
});

function request(path: string, expectedEntryId: string | null = null) {
  return venue.app.request(`/api/clock/${path}`, {
    method: path === "state" ? "GET" : "POST",
    headers: { cookie: venue.cookie, "Content-Type": "application/json" },
    ...(path === "state" ? {} : { body: JSON.stringify({ expectedEntryId }) }),
  });
}
async function state(): Promise<TillClockState> {
  const response = await request("state");
  expect(response.status).toBe(200);
  return (await response.json()) as TillClockState;
}
async function act(path: string, at: string) {
  const expected = (await state()).lastEntryId;
  instant = new Date(at);
  return request(path, expected);
}
async function latestReads(body: () => unknown) {
  const all = StatementSync.prototype.all;
  let reads = 0;
  const spy = vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (
    this: StatementSync,
    ...args
  ) {
    // readLatestLiveEntry's chain-head lookup.
    if (/select head\.id from time_entries head/.test(this.sourceSQL)) reads++;
    return Reflect.apply(all, this, args) as ReturnType<typeof all>;
  });
  try {
    await body();
    return reads;
  } finally {
    spy.mockRestore();
  }
}
async function rows() {
  return suite.db.select().from(timeEntries).orderBy(timeEntries.sequenceNo);
}

// The venue is Europe/Madrid (UTC+1 in January) with its day changing at 05:00 local, 04:00Z.
describe("the till's clock across a backward step of the box's clock", () => {
  it("reads a clock-out dated before its clock-in as out, refuses a second clock-out and lets the person clock in again", async () => {
    instant = new Date("2026-01-05T20:00:00Z");
    expect((await request("in")).status).toBe(200);
    expect((await act("out", "2026-01-05T19:30:00Z")).status).toBe(200);
    const out = (await rows()).at(-1)!;
    expect(out.entryKind).toBe("out");

    expect(await state()).toMatchObject({
      state: "out",
      activeLocationId: null,
      lastEntryId: out.id,
    });

    const before = await rows();
    const again = await request("out", out.id);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "attendance.no_open_entry" } });
    expect(await rows()).toEqual(before);

    instant = new Date("2026-01-05T19:45:00Z");
    const back = await request("in", out.id);
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ state: "working" });
  });

  it("reads an ordinary day as before (control)", async () => {
    instant = new Date("2026-01-05T08:00:00Z");
    expect((await request("in")).status).toBe(200);
    expect(await state()).toMatchObject({ state: "working" });
    expect((await act("out", "2026-01-05T16:00:00Z")).status).toBe(200);
    expect(await state()).toMatchObject({ state: "out", activeLocationId: null });
  });

  it("reads the later-dated location's entry when the person moved location (control)", async () => {
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Other venue",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00:00",
      })
      .returning({ id: locations.id });
    instant = new Date("2026-01-05T08:00:00Z");
    expect((await request("in")).status).toBe(200);
    expect((await act("out", "2026-01-05T12:00:00Z")).status).toBe(200);
    await withTransaction(suite.db, (tx) =>
      backend.clockIn(tx, {
        personId: venue.personId,
        nodeId: venue.cfg.nodeId,
        locationId: other!.id,
        at: "2026-01-05T13:00:00.000Z",
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
      }),
    );
    const atOther = (await rows()).find((row) => row.locationId === other!.id)!;
    instant = new Date("2026-01-05T13:30:00Z");
    expect(await state()).toMatchObject({
      state: "working",
      activeLocationId: other!.id,
      lastEntryId: atOther.id,
    });
  });

  it("reconciles the business day of the clock-in written after the step", async () => {
    instant = new Date("2026-01-06T04:30:00Z");
    expect((await request("in")).status).toBe(200);
    expect((await act("out", "2026-01-06T03:35:00Z")).status).toBe(200);
    expect((await act("in", "2026-01-06T03:40:00Z")).status).toBe(200);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);

    instant = new Date("2026-01-06T04:10:00Z");
    await state();
    expect((await suite.db.select().from(attendanceDayWork)).map((row) => row.businessDay)).toEqual(
      ["2026-01-05"],
    );
  });

  it("lets the person clock in again after clocking out of an approved later-dated clock-in", async () => {
    const [admin] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const correctionId = await withTransaction(suite.db, (tx) =>
      backend.requestCorrection(tx, {
        nodeId: venue.cfg.nodeId,
        personId: venue.personId,
        locationId: venue.cfg.locationId,
        missingEntryKind: "in",
        at: "2026-01-06T09:00:00.000Z",
        offsetMinutes: 60,
        reason: "Forgot",
        actorPersonId: venue.personId,
        origin: jobOrigin("dashboard"),
      }),
    );
    await withTransaction(suite.db, (tx) =>
      backend.approveCorrection(tx, {
        nodeId: venue.cfg.nodeId,
        correctionId,
        approverPersonId: admin!.id,
      }),
    );
    // The clock is stepped back to the day before.
    instant = new Date("2026-01-05T10:00:00Z");
    expect(await state()).toMatchObject({ state: "working" });
    expect((await act("out", "2026-01-05T10:00:00Z")).status).toBe(200);
    const out = (await rows()).at(-1)!;
    expect(out.entryKind).toBe("out");
    expect(await state()).toMatchObject({
      state: "out",
      activeLocationId: null,
      lastEntryId: out.id,
    });
    const back = await act("in", "2026-01-05T11:00:00Z");
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ state: "working" });
  });

  it("reads the person's latest entry once for the state when nothing needs reconciling", async () => {
    instant = new Date("2026-01-05T08:00:00Z");
    expect((await request("in")).status).toBe(200);
    instant = new Date("2026-01-05T09:00:00Z");
    // The reconcile's state read and its clock-in read; the answer reuses the first.
    expect(await latestReads(() => request("state"))).toBe(2);
    const expected = (await state()).lastEntryId;
    // As above, then the clock-out's own check and the state after it.
    expect(await latestReads(() => request("out", expected))).toBe(4);
  });
});
