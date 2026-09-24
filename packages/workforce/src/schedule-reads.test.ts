import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { describe, expect, it } from "vitest";
import {
  listAbsencesForPerson,
  listShiftsForPerson,
  listSwapsForPerson,
} from "./schedule-reads.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import {
  insertAbsence,
  insertDraftShift,
  insertShiftSwap,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

let locationId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

describe("listShiftsForPerson", () => {
  it("returns only the requester's shifts in the window (never a second person's), ordered by starts_at", async () => {
    const me = await seedPerson(suite.db, `me-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, `other-${crypto.randomUUID()}`);
    // Two of mine, seeded out of starts_at order, plus one of the other person's in the same window.
    const late = await insertDraftShift(suite.db, {
      personId: me,
      locationId,
      startsAt: "2026-01-06T09:00:00Z",
      endsAt: "2026-01-06T17:00:00Z",
      role: "bar",
      rosterVersionId: null,
    });
    const early = await insertDraftShift(suite.db, {
      personId: me,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
      role: "kitchen",
    });
    await insertDraftShift(suite.db, {
      personId: other,
      locationId,
      startsAt: "2026-01-05T10:00:00Z",
      endsAt: "2026-01-05T18:00:00Z",
    });
    const rows = await run((tx) =>
      listShiftsForPerson(tx, { personId: me, from: "2026-01-05", to: "2026-01-08" }),
    );
    expect(rows.map((r) => r.id)).toEqual([early, late]);
    expect(rows[0]).toEqual({
      id: early,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-01-05T17:00:00Z",
      endsOffsetMinutes: 0,
      role: "kitchen",
      rosterVersionId: null,
    });
  });

  it("uses a HALF-OPEN [from, to) local-date window — a shift at `from` is in, one at `to` is out", async () => {
    const me = await seedPerson(suite.db, `me-${crypto.randomUUID()}`);
    const before = await insertDraftShift(suite.db, {
      personId: me,
      locationId,
      startsAt: "2026-01-04T09:00:00Z",
      endsAt: "2026-01-04T17:00:00Z",
    });
    const atFrom = await insertDraftShift(suite.db, {
      personId: me,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
    });
    const atTo = await insertDraftShift(suite.db, {
      personId: me,
      locationId,
      startsAt: "2026-01-06T09:00:00Z",
      endsAt: "2026-01-06T17:00:00Z",
    });
    const rows = await run((tx) =>
      listShiftsForPerson(tx, { personId: me, from: "2026-01-05", to: "2026-01-06" }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([atFrom]);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(atTo);
  });

  it("compares the LOCAL wall date (offset-aware), not the raw UTC instant", async () => {
    // 23:30Z at +60 is local 01-06, outside the window, though its UTC date is 01-05.
    const me = await seedPerson(suite.db, `me-${crypto.randomUUID()}`);
    const rollsOver = await insertDraftShift(suite.db, {
      personId: me,
      locationId,
      startsAt: "2026-01-05T23:30:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-01-06T03:30:00Z",
      endsOffsetMinutes: 60,
    });
    const rows = await run((tx) =>
      listShiftsForPerson(tx, { personId: me, from: "2026-01-05", to: "2026-01-06" }),
    );
    expect(rows.map((r) => r.id)).not.toContain(rollsOver);
  });
});

describe("listSwapsForPerson", () => {
  async function twoPeople(): Promise<{ me: string; other: string }> {
    const me = await seedPerson(suite.db, `me-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, `other-${crypto.randomUUID()}`);
    return { me, other };
  }

  it("returns swaps I REQUESTED and swaps OFFERED TO ME with the right direction, and nobody else's", async () => {
    const { me, other } = await twoPeople();
    const third = await seedPerson(suite.db, `third-${crypto.randomUUID()}`);
    const myShift = await insertDraftShift(suite.db, { personId: me, locationId });
    const theirShift = await insertDraftShift(suite.db, { personId: other, locationId });
    const othersShift = await insertDraftShift(suite.db, { personId: other, locationId });
    const requestedByMe = await insertShiftSwap(suite.db, {
      requestedByPersonId: me,
      fromShiftId: myShift,
      toPersonId: other,
      createdAt: "2026-03-01T10:00:00Z",
    });
    const offeredToMe = await insertShiftSwap(suite.db, {
      requestedByPersonId: other,
      fromShiftId: theirShift,
      toPersonId: me,
      createdAt: "2026-03-02T10:00:00Z",
    });
    const notMine = await insertShiftSwap(suite.db, {
      requestedByPersonId: other,
      fromShiftId: othersShift,
      toPersonId: third,
    });
    const rows = await run((tx) => listSwapsForPerson(tx, { personId: me }));
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([offeredToMe, requestedByMe]);
    expect(ids).not.toContain(notMine);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(requestedByMe)!.direction).toBe("requested_by_me");
    expect(byId.get(offeredToMe)!.direction).toBe("offered_to_me");
    expect(byId.get(offeredToMe)).toEqual({
      id: offeredToMe,
      requestedByPersonId: other,
      fromShiftId: theirShift,
      toPersonId: me,
      toShiftId: null,
      status: "requested",
      createdAt: "2026-03-02T10:00:00Z",
      direction: "offered_to_me",
    });
  });
});

describe("listAbsencesForPerson", () => {
  it("returns only the requester's absences (all statuses), ordered by starts_on desc", async () => {
    const me = await seedPerson(suite.db, `me-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, `other-${crypto.randomUUID()}`);
    // A requested and a rejected: every status shows, unlike the manager queue.
    const mineEarly = await insertAbsence(suite.db, {
      personId: me,
      startsOn: "2026-02-01",
      endsOn: "2026-02-03",
      status: "requested",
    });
    const mineLate = await insertAbsence(suite.db, {
      personId: me,
      startsOn: "2026-03-10",
      endsOn: "2026-03-12",
      status: "rejected",
    });
    const theirs = await insertAbsence(suite.db, {
      personId: other,
      startsOn: "2026-02-15",
      endsOn: "2026-02-16",
    });
    const rows = await run((tx) => listAbsencesForPerson(tx, { personId: me }));
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([mineLate, mineEarly]);
    expect(ids).not.toContain(theirs);
    expect(rows.map((r) => r.status)).toEqual(["rejected", "requested"]);
    expect(rows[0]).toEqual({
      id: mineLate,
      personId: me,
      kind: "holiday",
      startsOn: "2026-03-10",
      endsOn: "2026-03-12",
      status: "rejected",
      note: null,
      createdAt: expect.any(String),
    });
  });
});
