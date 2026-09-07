import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  AppError,
  locationId as brandLocationId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: the request→approve flow, the supervisor gate and reprojection are all
// LOGIC — no privilege set, no concurrency (CLAUDE.md §4, plan §7). The append-only floor
// that stops a correction being UPDATE-d is proven as the app role in immutability.test.ts, which
// covers every row of `time_entries`, corrections included; it is not re-proven here.
const backend = new WorkforceBackend();

let tenantId: string;
let locationId: string;
let nodeId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    locationId = await seedLocation(db, tenantId);
    nodeId = await seedNode(db, brandTenantId(tenantId), brandLocationId(locationId));
  },
});

function event(personId: string, at: string): ClockEventInput {
  return { tenantId, nodeId, personId, locationId, at, offsetMinutes: 0 };
}

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

/** Clocks a 09:00→17:00 day for a fresh person and returns their id plus the `out` entry's id. */
async function nineToFive(name: string): Promise<{ personId: string; outEntryId: string }> {
  const personId = await seedPerson(suite.db, tenantId, name);
  await run((tx) => backend.clockIn(tx, event(personId, "2026-01-05T09:00:00Z")));
  await run((tx) => backend.clockOut(tx, event(personId, "2026-01-05T17:00:00Z")));
  const rows = await suite.db.execute<{ id: string }>(sql`
    select id from time_entries where person_id = ${personId} and entry_kind = 'out'`);
  return { personId, outEntryId: rows.rows[0]!.id };
}

async function supervisor(name: string): Promise<string> {
  const rows = await suite.db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, ${name}, 'scrypt$00$00', 'supervisor') returning id`);
  return rows.rows[0]!.id;
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
  await suite.db.execute(sql`
    insert into time_entries (
      tenant_id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id, recorded_at, corrects_entry_id, correction_reason, correction_status,
      correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry)
    values (
      ${tenantId}, ${row.personId}, ${locationId}, ${row.node}, 'correction', ${row.eventAt}, 0,
      ${row.actorId}, ${row.recordedAt}, ${row.correctsEntryId}, 'cross-node merge', 'approved',
      ${row.actorId}, ${"A".repeat(64)}, ${"B".repeat(64)}, ${row.sequenceNo}, false)`);
}

async function workedMinutes(personId: string): Promise<number> {
  await seedEmployment(suite.db, { tenantId, personId });
  const summary = await run((tx) =>
    backend.workSummary(
      tx,
      {
        tenantId,
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
        tenantId,
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
          tenantId,
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
        tenantId,
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { tenantId, nodeId, correctionId, approverPersonId: sup }),
    );

    // Reprojected: the corrected 18:00 end makes it a 9h day.
    expect(await workedMinutes(personId)).toBe(540);
    // History retained: the original 17:00 out row is STILL there, unmodified — nothing was updated
    // or deleted, the correction is a separate append. Normalised to UTC (the raw column reads back
    // in the session zone) so the stored instant, not its display offset, is what is asserted.
    const original = await suite.db.execute<{ at: string }>(sql`
      select to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from time_entries where id = ${outEntryId}`);
    expect(original.rows[0]!.at).toBe("2026-01-05T17:00:00Z");
  });

  it("refuses approval by a non-supervisor with correction.not_permitted", async () => {
    const { personId, outEntryId } = await nineToFive("appr-2");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        tenantId,
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
          tenantId,
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
          tenantId,
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
        tenantId,
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
      backend.approveCorrection(tx, { tenantId, nodeId, correctionId, approverPersonId: sup }),
    );
    // Second approval of the SAME request is refused: the target already carries an approved
    // correction, so re-approving would append a duplicate `approved` row (the request→approve-once
    // invariant). Restricting the lookup to `requested` would NOT catch this — the request is still
    // `requested` — so the guard is on the target's existing approval.
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.approveCorrection(tx, { tenantId, nodeId, correctionId, approverPersonId: sup }),
      ),
    );
    expect(code).toBe("correction.not_pending");
    // Exactly ONE approved correction row exists — the refused approval appended nothing.
    const approved = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from time_entries
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
    // tenant+person, never by chain (§4.3), so reprojection sees both and must pick the greatest
    // (recorded_at, node_id, sequence_no). The cloud row was RECORDED LATER (10:06) though it carries
    // the LOWER sequence_no (2 vs 5), so its 18:30 corrected time wins over the box's 18:00 — a
    // sequence_no-max rule would instead land on 540 (18:00), so the two rules disagree here.
    const { personId, outEntryId } = await nineToFive("xnode-1");
    // Two distinct chains (distinct nodes), neither the setup node whose chain already carries this
    // person's live in/out. The base `out` chains under the setup node; a correction chains under its
    // OWN recording node (§4.2), so all three differ.
    const boxNode = await seedNode(suite.db, brandTenantId(tenantId), brandLocationId(locationId));
    const cloudNode = await seedNode(
      suite.db,
      brandTenantId(tenantId),
      brandLocationId(locationId),
    );
    const actor = await supervisor("xnode-1-sup");
    await insertApprovedCorrection({
      node: boxNode, // "the box"
      correctsEntryId: outEntryId,
      personId,
      actorId: actor,
      eventAt: "2026-01-05T18:00:00Z",
      recordedAt: "2026-01-05T10:05:00Z",
      sequenceNo: 5,
    });
    await insertApprovedCorrection({
      node: cloudNode, // the promoted cloud
      correctsEntryId: outEntryId,
      personId,
      actorId: actor,
      eventAt: "2026-01-05T18:30:00Z",
      recordedAt: "2026-01-05T10:06:00Z",
      sequenceNo: 2,
    });
    // 09:00 → corrected 18:30 = 9.5h.
    expect(await workedMinutes(personId)).toBe(570);
  });
});
