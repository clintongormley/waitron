import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAbsence, listPendingAbsences, setAbsenceStatus } from "./absences.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { insertAbsence, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: createAbsence / setAbsenceStatus are LOGIC over mutable planning rows
// (an overlap query, a status flip) — there is no privilege set and no RLS decision to prove here.
// The app role's grants on `absences` (that it CAN be INSERTed/UPDATEd/DELETEd) are proven against
// real Postgres in scheduling-planning.rls.test.ts, not re-proven here.

let tenantId: string;
let personId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    personId = await seedPerson(db, tenantId);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

describe("createAbsence", () => {
  // A FRESH person per test: the suite shares one PGlite db, and the overlap guard is scoped per
  // (tenant, person), so a person reused across tests would carry an earlier test's absence and make
  // these order-dependent (CLAUDE.md §4). Seeding a new person is cheaper than an afterEach cleanup
  // and cannot be forgotten.
  it("inserts a requested absence with no note by default", async () => {
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    const id = await run((tx) =>
      createAbsence(tx, {
        tenantId,
        personId: p,
        kind: "holiday",
        startsOn: "2026-02-10",
        endsOn: "2026-02-15",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ status: string; note: string | null; kind: string }>(sql`
      select status, note, absence_kind as kind from absences where id = ${id}`);
    expect(rows.rows[0]).toEqual({ status: "requested", note: null, kind: "holiday" });
  });

  it("stores a supplied note", async () => {
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    const id = await run((tx) =>
      createAbsence(tx, {
        tenantId,
        personId: p,
        kind: "sick_leave",
        startsOn: "2026-05-01",
        endsOn: "2026-05-03",
        note: "flu",
      }),
    );
    const rows = await suite.db.execute<{ note: string | null }>(
      sql`select note from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.note).toBe("flu");
  });

  it("rejects an absence overlapping an existing one for the same person", async () => {
    // Existing 10–15 Feb. New 12–18 Feb overlaps it (12 ≤ 15 and 10 ≤ 18) → absence.overlaps.
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    await insertAbsence(suite.db, {
      tenantId,
      personId: p,
      startsOn: "2026-02-10",
      endsOn: "2026-02-15",
    });
    const code = await codeOfRejection(() =>
      run((tx) =>
        createAbsence(tx, {
          tenantId,
          personId: p,
          kind: "leave",
          startsOn: "2026-02-12",
          endsOn: "2026-02-18",
          note: null,
        }),
      ),
    );
    expect(code).toBe("absence.overlaps");
  });

  it("allows an absence that is merely ADJACENT to an existing one (starts the day after it ends)", async () => {
    // The negative control the overlap test needs: existing 10–15 Feb, new 16–20 Feb. These dates
    // genuinely distinguish overlap from adjacency — a guard that dropped the date predicate (any
    // same-person absence blocks) would wrongly reject THIS, and a guard whose overlap was too loose
    // would wrongly accept the 12–18 case above. 16 > 15, so there is no shared day.
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    await insertAbsence(suite.db, {
      tenantId,
      personId: p,
      startsOn: "2026-02-10",
      endsOn: "2026-02-15",
    });
    const id = await run((tx) =>
      createAbsence(tx, {
        tenantId,
        personId: p,
        kind: "leave",
        startsOn: "2026-02-16",
        endsOn: "2026-02-20",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects an INVERTED date range (ends_on < starts_on) — absence.invalid", async () => {
    // The cross-field ordering guard: 10 May starts, 1 May ends — end before start. Both are real
    // calendar days (so the route's requirePeriod screen passes each in isolation), but the interval
    // is malformed. createAbsence must refuse it here with `absence.invalid` BEFORE the insert, not
    // let it reach the `absences_range_ck` (ends_on >= starts_on) 23514 → a raw driver error. Delete
    // the guard in createAbsence and this reddens: the code becomes the raw PGlite constraint error,
    // not `absence.invalid` (CLAUDE.md §4 prove-by-deletion).
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    const code = await codeOfRejection(() =>
      run((tx) =>
        createAbsence(tx, {
          tenantId,
          personId: p,
          kind: "holiday",
          startsOn: "2026-05-10",
          endsOn: "2026-05-01",
          note: null,
        }),
      ),
    );
    expect(code).toBe("absence.invalid");
  });

  it("allows a single-day absence (ends_on == starts_on) — the range is inclusive", async () => {
    // The boundary the ordering guard must NOT reject: a one-day absence is starts_on = ends_on, which
    // the `absences_range_ck` (>=) allows. A guard written `endsOn <= startsOn` would wrongly reject
    // this; `endsOn < startsOn` accepts it.
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    const id = await run((tx) =>
      createAbsence(tx, {
        tenantId,
        personId: p,
        kind: "leave",
        startsOn: "2026-04-20",
        endsOn: "2026-04-20",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("does not treat another person's overlapping absence as a conflict", async () => {
    // The overlap is scoped to the SAME person: a second person's absence over the same days must not
    // block this one. Dropping the person_id predicate from the guard fails this.
    const p = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, tenantId, `abs-${crypto.randomUUID()}`);
    await insertAbsence(suite.db, {
      tenantId,
      personId: other,
      startsOn: "2026-02-10",
      endsOn: "2026-02-15",
    });
    const id = await run((tx) =>
      createAbsence(tx, {
        tenantId,
        personId: p,
        kind: "holiday",
        startsOn: "2026-02-11",
        endsOn: "2026-02-14",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });
});

describe("setAbsenceStatus", () => {
  it("moves a requested absence to approved and stamps the decider + decided_at", async () => {
    const id = await insertAbsence(suite.db, { tenantId, personId });
    const decider = await seedPerson(suite.db, tenantId, `mgr-${crypto.randomUUID()}`);
    await run((tx) =>
      setAbsenceStatus(tx, {
        tenantId,
        absenceId: id,
        status: "approved",
        decidedByPersonId: decider,
      }),
    );
    const rows = await suite.db.execute<{
      status: string;
      decided_by_person_id: string | null;
      decided_at: string | null;
    }>(sql`select status, decided_by_person_id, decided_at from absences where id = ${id}`);
    expect(rows.rows[0]!.status).toBe("approved");
    expect(rows.rows[0]!.decided_by_person_id).toBe(decider);
    expect(rows.rows[0]!.decided_at).not.toBeNull();
  });

  it("throws absence.not_found for an absence that does not exist under the tenant", async () => {
    const code = await codeOfRejection(() =>
      run((tx) =>
        setAbsenceStatus(tx, {
          tenantId,
          absenceId: crypto.randomUUID(),
          status: "rejected",
          decidedByPersonId: null,
        }),
      ),
    );
    expect(code).toBe("absence.not_found");
  });
});

describe("listPendingAbsences", () => {
  it("returns only requested absences for the tenant, ordered by created_at", async () => {
    // A FRESH tenant, isolated from the sibling suites above: the shared PGlite DB persists across the
    // file, and the `createAbsence` tests leave several `requested` absences on the module-level
    // `tenantId`. Querying its own tenant keeps the ordered assertion below order-independent
    // (CLAUDE.md §4) — mirrors listPendingSwaps' fresh-tenant isolation in shift-swaps.test.ts.
    const listTenant = await seedTenant(suite.db);
    const p = await seedPerson(suite.db, listTenant, `la-${crypto.randomUUID()}`);
    // TWO requested absences seeded OUT OF created_at ORDER: the FIRST-inserted (the holiday) carries
    // the LATER timestamp, the SECOND-inserted (the sick_leave) the EARLIER one, so insertion order and
    // created_at order DISAGREE. `order by created_at` must return [sick_leave, holiday]; delete it and
    // the query falls back to physical/insert order [holiday, sick_leave] and the toEqual below reddens
    // (CLAUDE.md §4 prove-by-deletion).
    const requestedLate = await insertAbsence(suite.db, {
      tenantId: listTenant,
      personId: p,
      kind: "holiday",
      startsOn: "2026-06-10",
      endsOn: "2026-06-12",
      status: "requested",
      note: null,
      createdAt: "2026-03-02T10:00:00Z",
    });
    const requestedEarly = await insertAbsence(suite.db, {
      tenantId: listTenant,
      personId: p,
      kind: "sick_leave",
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      status: "requested",
      note: "flu",
      createdAt: "2026-03-01T10:00:00Z",
    });
    // An already-approved absence must NOT appear (the status filter).
    await insertAbsence(suite.db, {
      tenantId: listTenant,
      personId: p,
      startsOn: "2026-07-01",
      endsOn: "2026-07-02",
      status: "approved",
    });
    const rows = await withTenant(suite.db, listTenant, (tx) =>
      listPendingAbsences(tx, { tenantId: listTenant }),
    );
    // created_at ASC → [early, late], the REVERSE of insertion order; the approved absence is excluded.
    expect(rows.map((r) => r.id)).toEqual([requestedEarly, requestedLate]);
    expect(rows.map((r) => r.createdAt)).toEqual(["2026-03-01T10:00:00Z", "2026-03-02T10:00:00Z"]);
    expect(rows.map((r) => r.status)).toEqual(["requested", "requested"]);
    // Field mapping on the head row (the earlier-created sick_leave absence). Assert EVERY mapped
    // column so a snake_case→camelCase mis-wire on an unasserted column cannot pass silently
    // (CLAUDE.md §4 toMatchObject-gap / Task 3 review). `createdAt` is now pinned to its exact seeded
    // instant by the ordered assertion above — a mis-wire to a date column (e.g. starts_on) would not
    // carry the "T…Z" instant.
    expect(rows[0]!.personId).toBe(p);
    expect(rows[0]!.kind).toBe("sick_leave");
    expect(rows[0]!.startsOn).toBe("2026-06-01");
    expect(rows[0]!.endsOn).toBe("2026-06-03");
    expect(rows[0]!.note).toBe("flu");
  });
});
