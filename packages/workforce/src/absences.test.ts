import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAbsence, setAbsenceStatus } from "./absences.js";
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
  it("moves a requested absence to approved", async () => {
    const id = await insertAbsence(suite.db, { tenantId, personId });
    await run((tx) => setAbsenceStatus(tx, { tenantId, absenceId: id, status: "approved" }));
    const rows = await suite.db.execute<{ status: string }>(
      sql`select status from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.status).toBe("approved");
  });

  it("throws absence.not_found for an absence that does not exist under the tenant", async () => {
    const code = await codeOfRejection(() =>
      run((tx) =>
        setAbsenceStatus(tx, { tenantId, absenceId: crypto.randomUUID(), status: "rejected" }),
      ),
    );
    expect(code).toBe("absence.not_found");
  });
});
