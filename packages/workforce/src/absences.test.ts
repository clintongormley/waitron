import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAbsence, listPendingAbsences, setAbsenceStatus } from "./absences.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { insertAbsence, seedPerson } from "../test/fixtures.js";

let personId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    personId = await seedPerson(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

describe("createAbsence", () => {
  // A fresh person per test: the suite shares one database and the overlap guard is per person.
  it("inserts a requested absence with no note by default", async () => {
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    const id = await run((tx) =>
      createAbsence(tx, {
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
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    const id = await run((tx) =>
      createAbsence(tx, {
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
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    await insertAbsence(suite.db, {
      personId: p,
      startsOn: "2026-02-10",
      endsOn: "2026-02-15",
    });
    const code = await codeOfRejection(() =>
      run((tx) =>
        createAbsence(tx, {
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
    // Adjacent, not overlapping: a guard that dropped the date predicate would wrongly reject this.
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    await insertAbsence(suite.db, {
      personId: p,
      startsOn: "2026-02-10",
      endsOn: "2026-02-15",
    });
    const id = await run((tx) =>
      createAbsence(tx, {
        personId: p,
        kind: "leave",
        startsOn: "2026-02-16",
        endsOn: "2026-02-20",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects an INVERTED date range (ends_on < starts_on) — absence.invalid", async () => {
    // Each day is valid alone, so only createAbsence's own ordering guard turns this into
    // `absence.invalid` rather than a raw `absences_range_ck` refusal.
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    const code = await codeOfRejection(() =>
      run((tx) =>
        createAbsence(tx, {
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
    // A one-day absence is starts_on = ends_on, which the ordering guard must accept.
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    const id = await run((tx) =>
      createAbsence(tx, {
        personId: p,
        kind: "leave",
        startsOn: "2026-04-20",
        endsOn: "2026-04-20",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("does not treat another person's overlapping absence as a conflict", async () => {
    const p = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    const other = await seedPerson(suite.db, `abs-${crypto.randomUUID()}`);
    await insertAbsence(suite.db, {
      personId: other,
      startsOn: "2026-02-10",
      endsOn: "2026-02-15",
    });
    const id = await run((tx) =>
      createAbsence(tx, {
        personId: p,
        kind: "holiday",
        startsOn: "2026-02-11",
        endsOn: "2026-02-14",
        note: null,
      }),
    );
    const rows = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from absences where id = ${id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });
});

describe("setAbsenceStatus", () => {
  it("moves a requested absence to approved and stamps the decider + decided_at", async () => {
    const id = await insertAbsence(suite.db, { personId });
    const decider = await seedPerson(suite.db, `mgr-${crypto.randomUUID()}`);
    await run((tx) =>
      setAbsenceStatus(tx, {
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

  it("throws absence.not_found for an absence that does not exist", async () => {
    const code = await codeOfRejection(() =>
      run((tx) =>
        setAbsenceStatus(tx, {
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
  it("returns only requested absences, ordered by created_at", async () => {
    // The queue reads every absence in the shared database, so clear the earlier tests' rows.
    await suite.db.execute(sql`delete from absences`);
    const p = await seedPerson(suite.db, `la-${crypto.randomUUID()}`);
    // Inserted out of created_at order, so `order by created_at` is what puts sick_leave first.
    const requestedLate = await insertAbsence(suite.db, {
      personId: p,
      kind: "holiday",
      startsOn: "2026-06-10",
      endsOn: "2026-06-12",
      status: "requested",
      note: null,
      createdAt: "2026-03-02T10:00:00Z",
    });
    const requestedEarly = await insertAbsence(suite.db, {
      personId: p,
      kind: "sick_leave",
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      status: "requested",
      note: "flu",
      createdAt: "2026-03-01T10:00:00Z",
    });
    await insertAbsence(suite.db, {
      personId: p,
      startsOn: "2026-07-01",
      endsOn: "2026-07-02",
      status: "approved",
    });
    const rows = await withTransaction(suite.db, (tx) => listPendingAbsences(tx));
    expect(rows.map((r) => r.id)).toEqual([requestedEarly, requestedLate]);
    expect(rows.map((r) => r.createdAt)).toEqual(["2026-03-01T10:00:00Z", "2026-03-02T10:00:00Z"]);
    expect(rows.map((r) => r.status)).toEqual(["requested", "requested"]);
    // Every mapped column, so a snake_case→camelCase mis-wire cannot pass unasserted.
    expect(rows[0]!.personId).toBe(p);
    expect(rows[0]!.kind).toBe("sick_leave");
    expect(rows[0]!.startsOn).toBe("2026-06-01");
    expect(rows[0]!.endsOn).toBe("2026-06-03");
    expect(rows[0]!.note).toBe("flu");
  });
});
