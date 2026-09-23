import { CORE_MIGRATIONS, captureError, newId, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

// A venue database, not real Postgres: the request→approve flow, the supervisor gate and
// reprojection are all LOGIC — no privilege set, no concurrency (CLAUDE.md §4, plan §7). The
// append-only floor that stops a correction being UPDATE-d covers every row of `time_entries`,
// corrections included, and is not re-proven here. It is proven at the product's own migrate path
// by `packages/migrations/src/apply-append-only.test.ts`, which names `time_entries` and carries a
// control in the other direction; this package's own `immutability.test.ts` was deleted by task F1
// (2026-09-22) — it rested on the app role's PRIVILEGES, and this engine has no roles.
const backend = new WorkforceBackend();

let locationId: string;
let nodeId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
    nodeId = await seedNode(db, brandLocationId(locationId));
  },
});

function event(personId: string, at: string): ClockEventInput {
  return { nodeId, personId, locationId, at, offsetMinutes: 0 };
}

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

/** Clocks a 09:00→17:00 day for a fresh person and returns their id plus the `out` entry's id. */
async function nineToFive(name: string): Promise<{ personId: string; outEntryId: string }> {
  const personId = await seedPerson(suite.db, name);
  await run((tx) => backend.clockIn(tx, event(personId, "2026-01-05T09:00:00Z")));
  await run((tx) => backend.clockOut(tx, event(personId, "2026-01-05T17:00:00Z")));
  const rows = await suite.db.execute<{ id: string }>(sql`
    select id from time_entries where person_id = ${personId} and entry_kind = 'out'`);
  return { personId, outEntryId: rows.rows[0]!.id };
}

/** Through the `persons` table definition, not raw SQL: `persons.id` and `persons.created_at` are
 * `$defaultFn` generators, which only the insert BUILDER runs — the same reason
 * `../test/fixtures.ts`'s `seedPerson` inserts that way. */
async function supervisor(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: name, pinHash: "scrypt$00$00", role: "supervisor" })
    .returning({ id: persons.id });
  return row!.id;
}

/**
 * Inserts an APPROVED correction row directly, bypassing `appendToChain` and `approveCorrection`.
 *
 * §4.2's cross-node precedence needs a state the backend cannot reach through its own verbs: two
 * chains each holding an approved correction of ONE target. `approveCorrection` refuses a second
 * approval per target (the DB-wide `hasApprovedCorrection` guard, until it becomes per-chain in a
 * later step), so the second chain's approval is injected here instead. The hashes are placeholders
 * (a mid-chain entry — `isFirstEntry` false with a non-null `prevEntryHash`) — the projection reads
 * `corrects_entry_id`, `correction_status`, `recorded_at`, `node_id` and `event_at`, never the hash —
 * and the row still satisfies every CHECK on the table (shape, whole-second, hash-regex, chaining,
 * chain-position).
 */
async function insertApprovedCorrection(row: {
  node: string;
  correctsEntryId: string;
  personId: string;
  actorId: string;
  eventAt: string;
  recordedAt: string;
  sequenceNo: number;
}): Promise<void> {
  // `id` comes from the table's `$defaultFn` generator, which drizzle runs for a builder insert and
  // never for raw SQL, and the generated DDL declares no SQL default for it — without it the
  // statement is refused `NOT NULL constraint failed: time_entries.id`. The insert stays raw
  // because what it is building is a row the chain append path would never write: a SECOND node's
  // correction of one target.
  await suite.db.execute(sql`
    insert into time_entries (
      id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id, recorded_at, corrects_entry_id, correction_reason, correction_status,
      correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry)
    values (${newId()}, ${row.personId}, ${locationId}, ${row.node}, 'correction', ${row.eventAt}, 0,
      ${row.actorId}, ${row.recordedAt}, ${row.correctsEntryId}, 'cross-node merge', 'approved',
      ${row.actorId}, ${"A".repeat(64)}, ${"B".repeat(64)}, ${row.sequenceNo}, false)`);
}

async function workedMinutes(personId: string): Promise<number> {
  await seedEmployment(suite.db, { personId });
  const summary = await run((tx) =>
    backend.workSummary(
      tx,
      {
        personId,
        period: { start: "2026-01-05", end: "2026-01-12" },
      },
      { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
    ),
  );
  return summary.workedMinutes;
}

describe("requestCorrection", () => {
  it("appends a requested correction that does not yet change the projection", async () => {
    const { personId, outEntryId } = await nineToFive("req-1");
    const actor = await supervisor("req-1-sup");
    await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: actor,
      }),
    );
    // The correction row is present, `requested`, and the ORIGINAL out is untouched.
    const rows = await suite.db.execute<{
      entry_kind: string;
      correction_status: string | null;
    }>(sql`
      select entry_kind, correction_status from time_entries
      where person_id = ${personId} order by recorded_at, sequence_no`);
    expect(rows.rows.map((r) => [r.entry_kind, r.correction_status])).toEqual([
      ["in", null],
      ["out", null],
      ["correction", "requested"],
    ]);
    // Pending: worked minutes still reflect the 17:00 out (8h), not the requested 18:00 (9h).
    expect(await workedMinutes(personId)).toBe(480);
  });

  it("throws correction.target_not_found for an entry that does not exist", async () => {
    const actor = await supervisor("req-2-sup");
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.requestCorrection(tx, {
          nodeId,
          correctsEntryId: crypto.randomUUID(),
          at: "2026-01-05T18:00:00Z",
          offsetMinutes: 0,
          reason: "no such entry",
          actorPersonId: actor,
        }),
      ),
    );
    expect(code).toBe("correction.target_not_found");
  });
});

describe("approveCorrection", () => {
  it("reprojects the work session while the original entry stays visible (teeth-test)", async () => {
    const { personId, outEntryId } = await nineToFive("appr-1");
    const sup = await supervisor("appr-1-sup");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: sup }),
    );

    // Reprojected: the corrected 18:00 end makes it a 9h day.
    expect(await workedMinutes(personId)).toBe(540);
    // History retained: the original 17:00 out row is STILL there, unmodified — nothing was updated
    // or deleted, the correction is a separate append. `event_at` is a text column read back as the
    // stored string, and `time_entries_event_at_second_ck` admits exactly one spelling of a whole
    // second, so the expected value carries the zero fractional second `appendToChain` writes.
    const original = await suite.db.execute<{ at: string }>(sql`
      select event_at as at from time_entries where id = ${outEntryId}`);
    expect(original.rows[0]!.at).toBe("2026-01-05T17:00:00.000Z");
  });

  it("refuses approval by a non-supervisor with correction.not_permitted", async () => {
    const { personId, outEntryId } = await nineToFive("appr-2");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    // `personId` is a plain staff member (seedPerson defaults role to staff).
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.approveCorrection(tx, {
          nodeId,
          correctionId,
          approverPersonId: personId,
        }),
      ),
    );
    expect(code).toBe("correction.not_permitted");
    // And the projection is unchanged — a refused approval takes no effect.
    expect(await workedMinutes(personId)).toBe(480);
  });

  it("throws correction.target_not_found approving a correction id that does not exist", async () => {
    const sup = await supervisor("appr-3-sup");
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.approveCorrection(tx, {
          nodeId,
          correctionId: crypto.randomUUID(),
          approverPersonId: sup,
        }),
      ),
    );
    expect(code).toBe("correction.target_not_found");
  });

  it("refuses a SECOND approval of the same request and appends no duplicate approved row", async () => {
    const { personId, outEntryId } = await nineToFive("appr-4");
    const sup = await supervisor("appr-4-sup");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    // First approval takes effect (the request row stays `requested` — approval is a second append,
    // never a mutation, so the id passed the second time still names a `requested` row).
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: sup }),
    );
    // Second approval of the SAME request is refused: the target already carries an approved
    // correction, so re-approving would append a duplicate `approved` row (the request→approve-once
    // invariant). Restricting the lookup to `requested` would NOT catch this — the request is still
    // `requested` — so the guard is on the target's existing approval.
    const code = await codeOfRejection(() =>
      run((tx) => backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: sup })),
    );
    expect(code).toBe("correction.not_pending");
    // Exactly ONE approved correction row exists — the refused approval appended nothing.
    const approved = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from time_entries
      where person_id = ${personId} and entry_kind = 'correction'
        and correction_status = 'approved'`);
    expect(approved.rows[0]!.n).toBe(1);
    // And the projection is exactly the single approved value (9h), not doubled or re-applied.
    expect(await workedMinutes(personId)).toBe(540);
  });
});

describe("cross-node correction precedence (§4.2, reprojection)", () => {
  it("reprojects the later recorded_at approved correction when two chains correct one target", async () => {
    // Once corrections chain per node, sync can leave ONE `out` with an approved correction in the
    // box's chain AND in a promoted cloud's — the state the DB-wide approve guard forbids through the
    // backend, so both are inserted directly (insertApprovedCorrection). `entriesInPeriod` fetches by
    // person, never by chain (§4.3), so reprojection sees both and must pick the greatest
    // (recorded_at, node_id, sequence_no). The cloud row was RECORDED LATER (10:06) though it carries
    // the LOWER sequence_no (2 vs 5), so its 18:30 corrected time wins over the box's 18:00 — a
    // sequence_no-max rule would instead land on 540 (18:00), so the two rules disagree here.
    const { personId, outEntryId } = await nineToFive("xnode-1");
    // Two distinct chains (distinct nodes), neither the setup node whose chain already carries this
    // person's live in/out. The base `out` chains under the setup node; a correction chains under its
    // OWN recording node (§4.2), so all three differ.
    const boxNode = await seedNode(suite.db, brandLocationId(locationId));
    const cloudNode = await seedNode(suite.db, brandLocationId(locationId));
    const actor = await supervisor("xnode-1-sup");
    await insertApprovedCorrection({
      node: boxNode, // "the box"
      correctsEntryId: outEntryId,
      personId,
      actorId: actor,
      // The canonical whole-second spelling `appendToChain` writes: this helper inserts RAW, so
      // nothing truncates for it and `time_entries_event_at_second_ck` admits no other form.
      eventAt: "2026-01-05T18:00:00.000Z",
      recordedAt: "2026-01-05T10:05:00.000Z",
      sequenceNo: 5,
    });
    await insertApprovedCorrection({
      node: cloudNode, // the promoted cloud
      correctsEntryId: outEntryId,
      personId,
      actorId: actor,
      eventAt: "2026-01-05T18:30:00.000Z",
      recordedAt: "2026-01-05T10:06:00.000Z",
      sequenceNo: 2,
    });
    // 09:00 → corrected 18:30 = 9.5h.
    expect(await workedMinutes(personId)).toBe(570);
  });
});
