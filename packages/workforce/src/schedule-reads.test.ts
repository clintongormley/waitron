import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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

// PGlite, not real Postgres: these are person-scoped READ models over mutable planning rows — the
// scoping predicate is application-code (RLS is tenant-only, plan fact 3), so there is no privilege
// set and no RLS decision to prove here. The app role's grants on shifts/shift_swaps/absences are
// proven against real Postgres elsewhere (scheduling-planning.rls.test.ts); the ROUTE that passes the
// session's personId is proven against real Postgres in schedule-api.pg.test.ts.

let tenantId: string;
let locationId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    locationId = await seedLocation(db, tenantId);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

describe("listShiftsForPerson", () => {
  it("returns only the requester's shifts in the window (never a second person's), ordered by starts_at", async () => {
    // Person-scoping is application code (RLS is tenant-only). Prove by deletion — drop the
    // `person_id = ${personId}` predicate and the OTHER person's shift (seeded under the same tenant)
    // leaks into the result, reddening the `map((r) => r.id)` assertion.
    const me = await seedPerson(suite.db, tenantId, `me-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, tenantId, `other-${crypto.randomUUID()}`);
    // Two of MINE, seeded OUT of starts_at order, plus one of the OTHER person's in the same window.
    const late = await insertDraftShift(suite.db, {
      tenantId,
      personId: me,
      locationId,
      startsAt: "2026-01-06T09:00:00Z",
      endsAt: "2026-01-06T17:00:00Z",
      role: "bar",
      rosterVersionId: null,
    });
    const early = await insertDraftShift(suite.db, {
      tenantId,
      personId: me,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
      role: "kitchen",
    });
    await insertDraftShift(suite.db, {
      tenantId,
      personId: other,
      locationId,
      startsAt: "2026-01-05T10:00:00Z",
      endsAt: "2026-01-05T18:00:00Z",
    });
    const rows = await run((tx) =>
      listShiftsForPerson(tx, { tenantId, personId: me, from: "2026-01-05", to: "2026-01-08" }),
    );
    // Only mine, and in starts_at ASC order (the reverse of insertion order above).
    expect(rows.map((r) => r.id)).toEqual([early, late]);
    // Field mapping on the head row (the earlier shift).
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
    // Prove by deletion of EACH bound: drop `>= from` and the 04-Jan shift (before the window) leaks in;
    // drop `< to` and the 06-Jan shift (at the exclusive upper bound) leaks in.
    const me = await seedPerson(suite.db, tenantId, `me-${crypto.randomUUID()}`);
    const before = await insertDraftShift(suite.db, {
      tenantId,
      personId: me,
      locationId,
      startsAt: "2026-01-04T09:00:00Z",
      endsAt: "2026-01-04T17:00:00Z",
    });
    const atFrom = await insertDraftShift(suite.db, {
      tenantId,
      personId: me,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
    });
    const atTo = await insertDraftShift(suite.db, {
      tenantId,
      personId: me,
      locationId,
      startsAt: "2026-01-06T09:00:00Z",
      endsAt: "2026-01-06T17:00:00Z",
    });
    const rows = await run((tx) =>
      listShiftsForPerson(tx, { tenantId, personId: me, from: "2026-01-05", to: "2026-01-06" }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([atFrom]);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(atTo);
  });

  it("compares the LOCAL wall date (offset-aware), not the raw UTC instant", async () => {
    // A shift at 2026-01-05T23:30Z with a +60-minute offset is LOCAL 2026-01-06T00:30 → local date
    // 2026-01-06, so a [2026-01-05, 2026-01-06) window EXCLUDES it, even though its UTC date is 05-Jan.
    // Delete the `+ starts_offset_minutes * interval '1 minute'` term and the raw UTC date (05-Jan)
    // would fall inside, leaking it in — the offset-awareness this window shares with publishRoster.
    const me = await seedPerson(suite.db, tenantId, `me-${crypto.randomUUID()}`);
    const rollsOver = await insertDraftShift(suite.db, {
      tenantId,
      personId: me,
      locationId,
      startsAt: "2026-01-05T23:30:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-01-06T03:30:00Z",
      endsOffsetMinutes: 60,
    });
    const rows = await run((tx) =>
      listShiftsForPerson(tx, { tenantId, personId: me, from: "2026-01-05", to: "2026-01-06" }),
    );
    expect(rows.map((r) => r.id)).not.toContain(rollsOver);
  });
});

describe("listSwapsForPerson", () => {
  async function twoPeople(): Promise<{ me: string; other: string }> {
    const me = await seedPerson(suite.db, tenantId, `me-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, tenantId, `other-${crypto.randomUUID()}`);
    return { me, other };
  }

  it("returns swaps I REQUESTED and swaps OFFERED TO ME with the right direction, and nobody else's", async () => {
    // A swap matches on `requested_by_person_id = me` OR `to_person_id = me`. Person-scoping is
    // application code — prove by deletion: drop that predicate and a swap between two OTHER people
    // (below) leaks into my list, reddening the `not.toContain` assertion. `direction` is derived from
    // which column matched.
    const { me, other } = await twoPeople();
    const third = await seedPerson(suite.db, tenantId, `third-${crypto.randomUUID()}`);
    const myShift = await insertDraftShift(suite.db, { tenantId, personId: me, locationId });
    const theirShift = await insertDraftShift(suite.db, { tenantId, personId: other, locationId });
    const othersShift = await insertDraftShift(suite.db, { tenantId, personId: other, locationId });
    // One I requested (me → other), one offered to me (other → me), one between two other people.
    const requestedByMe = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: me,
      fromShiftId: myShift,
      toPersonId: other,
      createdAt: "2026-03-01T10:00:00Z",
    });
    const offeredToMe = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: other,
      fromShiftId: theirShift,
      toPersonId: me,
      createdAt: "2026-03-02T10:00:00Z",
    });
    const notMine = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: other,
      fromShiftId: othersShift,
      toPersonId: third,
    });
    const rows = await run((tx) => listSwapsForPerson(tx, { tenantId, personId: me }));
    const ids = rows.map((r) => r.id);
    // created_at DESC → the later-created (offeredToMe) first.
    expect(ids).toEqual([offeredToMe, requestedByMe]);
    expect(ids).not.toContain(notMine);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(requestedByMe)!.direction).toBe("requested_by_me");
    expect(byId.get(offeredToMe)!.direction).toBe("offered_to_me");
    // Field mapping on the offered-to-me row.
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
    // Person-scoping is application code — prove by deletion: drop the `person_id = ${personId}`
    // predicate and the OTHER person's absence leaks in, reddening the `not.toContain`.
    const me = await seedPerson(suite.db, tenantId, `me-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, tenantId, `other-${crypto.randomUUID()}`);
    // Two of mine (a requested and a rejected, so ALL statuses show — not just requested like the
    // manager queue), seeded out of starts_on order, plus one of the other person's.
    const mineEarly = await insertAbsence(suite.db, {
      tenantId,
      personId: me,
      startsOn: "2026-02-01",
      endsOn: "2026-02-03",
      status: "requested",
    });
    const mineLate = await insertAbsence(suite.db, {
      tenantId,
      personId: me,
      startsOn: "2026-03-10",
      endsOn: "2026-03-12",
      status: "rejected",
    });
    const theirs = await insertAbsence(suite.db, {
      tenantId,
      personId: other,
      startsOn: "2026-02-15",
      endsOn: "2026-02-16",
    });
    const rows = await run((tx) => listAbsencesForPerson(tx, { tenantId, personId: me }));
    const ids = rows.map((r) => r.id);
    // starts_on DESC → the later-starting absence first.
    expect(ids).toEqual([mineLate, mineEarly]);
    expect(ids).not.toContain(theirs);
    expect(rows.map((r) => r.status)).toEqual(["rejected", "requested"]);
    // Field mapping on the head row.
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
