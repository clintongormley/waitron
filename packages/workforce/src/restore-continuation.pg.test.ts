/**
 * A cold restore CONTINUES the working-time chain, and a survivor's forked row is refused loudly.
 *
 * CLAUDE.md §5 names this file as the guard for both halves, so the filename stays as it is even
 * though `.pg` now names an engine this suite does not touch: the pointer in CLAUDE.md is checked
 * by `scripts/claude-md-pointers.test.ts` and renaming the file means editing CLAUDE.md, which is a
 * separate change. Two other converted suites on this branch kept the same suffix for the same
 * reason (`packages/db/src/schema/tenants.singleton.pg.test.ts`,
 * `packages/fiscal-verifactu/src/restore.pg.test.ts`).
 *
 * ## What this suite documents (spec §2 decision 3, §5.1)
 *
 * `packages/workforce` declares NO `backup.restore` hook. A cold-restored box keeps its `node_id`
 * and the backup's chain head (pointing at row M with M's stored hash) and rows 1..M; its next
 * append CONTINUES that chain at M+1, chaining onto M's hash. There is no reset and no clock-floor
 * — UNLIKE the fiscal chain, whose restore mints a fresh SIF for AEAT. A survivor holding a forked
 * copy of the chain is refused by `time_entries_chain_position_uq` rather than merged into a fork,
 * however its rows reach this database; nothing carries rows between nodes today.
 *
 * ## What converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb`. Nothing here ever needed a second
 * connection or a lock — the header said so, and gave spec §6's naming convention as the only
 * reason for real Postgres — so the conversion is the harness and the two refusal assertions, not
 * the subject.
 *
 * **The one assertion that could not be carried over verbatim is the second case's, and it is the
 * guard CLAUDE.md §5 names, so here is exactly what changed.** On PostgreSQL the refusal was
 * asserted as SQLSTATE `23505` plus a message containing the index's NAME,
 * `time_entries_chain_position_uq`. SQLite does not report a constraint's name for a unique index
 * over plain columns; it reports the table and the columns that collided. Measured 2026-09-22 on
 * Node v26.7.0, a real collision on a two-column index: errcode `2067`, message
 * `UNIQUE constraint failed: <table>.<col>, <table>.<col>`. The assertion below therefore names the
 * SAME index by its columns instead of by its name — `(node_id, location_id, sequence_no)`, which
 * is `time_entries_chain_position_uq`'s declaration and nothing else's. The refusal is still
 * asserted as a uniqueness violation, and a row count confirms the fork did not land.
 */
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, constraintTarget, isUniqueViolation } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { appendToChain, readChain, type ChainKey, type TimeEntryAppend } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { workforceChains } from "./schema/workforce-chains.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

let personId: string;
let locationId: string;
let nodeId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  personId = await seedPerson(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
});

/** The chain key for this suite's default (node, location). */
function key(): ChainKey {
  return { nodeId, locationId };
}

/** A base `in` clock event's append input at a given instant. */
function inputAt(at: string): TimeEntryAppend {
  return {
    personId,
    entryKind: "in",
    eventAt: at,
    eventOffsetMinutes: 0,
    recordedByPersonId: personId,
  };
}

/** Reads the (node, location) chain head — what a backup carries verbatim into the restore. */
async function readHead() {
  const [row] = await suite.db
    .select({
      sequenceNo: workforceChains.sequenceNo,
      lastEntryId: workforceChains.lastEntryId,
      lastEntryHash: workforceChains.lastEntryHash,
    })
    .from(workforceChains)
    .where(and(eq(workforceChains.nodeId, nodeId), eq(workforceChains.locationId, locationId)));
  return row!;
}

/**
 * A raw insert claiming `position` on this (node, location) chain — the survivor's copy arriving at
 * drain. Every column but the position is a valid non-genesis row (prev_entry_hash set, whole-second
 * timestamps, hex hash), so the ONLY constraint it can trip is the chain-position uq.
 *
 * `id` is stated rather than left out. On PostgreSQL the column had a server-side default; on this
 * engine it is a Drizzle `$defaultFn` that only the insert BUILDER runs, so a raw insert omitting it
 * is refused `NOT NULL constraint failed: time_entries.id` — a refusal on the WRONG constraint,
 * which would make this case pass for a reason that has nothing to do with the chain position.
 * A fresh uuid is also what a survivor's row would genuinely carry.
 *
 * The two timestamps carry `.000` for the same reason, and it was measured here rather than
 * assumed: `'2026-01-05T20:00:00Z'` — the exact literal this fixture used on PostgreSQL — is
 * refused `CHECK constraint failed: time_entries_event_at_second_ck` (errcode 275, 2026-09-22), so
 * the case would have gone green on the WRONG constraint. The check is a `glob` admitting exactly
 * `…T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z` (`drizzle/0000_baseline.sql:163`), which is what
 * `truncateToWholeSecond` (`./chain.ts`) emits, since `toISOString` always writes the milliseconds
 * field.
 */
function rawForkInsertAt(position: number): Promise<unknown> {
  return suite.db.run(sql`
    insert into time_entries (
      id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id, recorded_at, entry_hash, prev_entry_hash, sequence_no, is_first_entry
    ) values (${globalThis.crypto.randomUUID()}, ${personId}, ${locationId}, ${nodeId}, 'in',
      '2026-01-05T20:00:00.000Z', 0,
      ${personId}, '2026-01-05T20:00:00.000Z', ${"B".repeat(64)}, ${"A".repeat(64)}, ${position}, 0)`);
}

describe("cold restore continues the working-time chain (no hook)", () => {
  it("continues the chain at M+1 after a restore, one strict segment, no reset", async () => {
    const k = key();
    // Seed the chain to M = 3 — the rows and head a backup captures.
    for (const at of ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z", "2026-01-05T17:00:00Z"]) {
      await suite.db.transaction((tx) => appendToChain(tx, k, inputAt(at)));
    }

    // The restore is a NO-OP by design: the restored DB holds exactly rows 1..M and a head pointing
    // at row M with M's stored hash. That is precisely the state M appends leave behind, so we
    // assert it and then continue — there is no hook to invoke, no pointer to reset, no counter to
    // floor.
    const restored = await readChain(suite.db, k);
    const head = await readHead();
    const rowM = restored[restored.length - 1]!;
    expect(restored.map((e) => e.sequenceNo)).toEqual([1, 2, 3]);
    expect(head.sequenceNo).toBe(3);
    expect(head.lastEntryHash).toBe(rowM.entryHash);

    // Continue: the next append reads the restored head, computes M+1, and chains onto row M's hash.
    const appended = await suite.db.transaction((tx) =>
      appendToChain(tx, k, inputAt("2026-01-06T09:00:00Z")),
    );
    expect(appended.sequenceNo).toBe(4);

    const chain = await readChain(suite.db, k);
    const rowMPlus1 = chain[chain.length - 1]!;
    expect(rowMPlus1.sequenceNo).toBe(4);
    expect(rowMPlus1.isFirstEntry).toBe(false);
    expect(rowMPlus1.prevEntryHash).toBe(rowM.entryHash);

    // ONE strict segment 1..4: genesis stays at position 1 (no mid-chain genesis a reset would have
    // planted), contiguous, and every hash recomputes — the strict verifier is untouched (spec §5.2).
    expect(chain.map((e) => e.sequenceNo)).toEqual([1, 2, 3, 4]);
    expect(chain.filter((e) => e.isFirstEntry).map((e) => e.sequenceNo)).toEqual([1]);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it("refuses a survivor's forked row loudly on the chain-position uq", async () => {
    const k = key();
    // The returning box restores to M = 3 and continues to position 4 (its own lineage).
    for (const at of ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z", "2026-01-05T17:00:00Z"]) {
      await suite.db.transaction((tx) => appendToChain(tx, k, inputAt(at)));
    }
    await suite.db.transaction((tx) => appendToChain(tx, k, inputAt("2026-01-06T09:00:00Z")));

    // A survivor (a promoted cloud) also wrote position 4 on this same (node, location) lineage.
    // However its copy ever reaches this database, it lands on a position the box already holds and
    // is refused LOUDLY — never merged into a fork. The insert here is the local proxy for that
    // arrival; nothing carries rows between nodes today.
    const error = await captureError(() => rawForkInsertAt(4));
    expect(isUniqueViolation(error)).toBe(true);
    // The header records why this names the index's COLUMNS rather than its name. These three are
    // `time_entries_chain_position_uq`'s declaration, so a refusal naming any other key — the
    // primary key, say — fails here rather than being read as this one.
    expect(constraintTarget(error)).toEqual({
      table: "time_entries",
      columns: ["node_id", "location_id", "sequence_no"],
    });
    // Control in the other direction, run 2026-09-22: the SAME row at `rawForkInsertAt(5)` — a
    // position the box does not hold — is ACCEPTED, and `captureError` fails with `expected the
    // operation to be rejected, but it succeeded`. So what refuses position 4 is the position, not
    // some other constraint this fixture trips on the way past.
    // And the fork did not land: the box's own four rows are all that is there.
    expect(await readChain(suite.db, k)).toHaveLength(4);
  });
});
