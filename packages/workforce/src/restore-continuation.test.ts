/**
 * A cold restore CONTINUES the working-time chain, and a survivor's forked row is refused loudly.
 * CLAUDE.md §5 names this file as the guard for both halves.
 *
 * `packages/workforce` declares NO `backup.restore` hook: the restored box keeps its `node_id`, the
 * backup's chain head and rows 1..M, and its next append continues at M+1. No reset, unlike the
 * fiscal chain. A forked copy of position M+1 is refused by `time_entries_chain_position_uq`.
 * SQLite names a unique index's columns, not the index, so the refusal is asserted by those columns.
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
 * A raw insert claiming `position` on this (node, location) chain — the survivor's copy arriving.
 * Every other column is valid, so the ONLY constraint it can trip is the chain-position uq: `id` is
 * stated because its default is a Drizzle `$defaultFn` a raw insert does not run, and the
 * timestamps carry `.000` because the whole-second checks on both columns demand it.
 */
function rawForkInsertAt(position: number) {
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

    // The restore is a no-op: the restored DB is exactly the state M appends leave behind.
    const restored = await readChain(suite.db, k);
    const head = await readHead();
    const rowM = restored[restored.length - 1]!;
    expect(restored.map((e) => e.sequenceNo)).toEqual([1, 2, 3]);
    expect(head.sequenceNo).toBe(3);
    expect(head.lastEntryHash).toBe(rowM.entryHash);

    const appended = await suite.db.transaction((tx) =>
      appendToChain(tx, k, inputAt("2026-01-06T09:00:00Z")),
    );
    expect(appended.sequenceNo).toBe(4);

    const chain = await readChain(suite.db, k);
    const rowMPlus1 = chain[chain.length - 1]!;
    expect(rowMPlus1.sequenceNo).toBe(4);
    expect(rowMPlus1.isFirstEntry).toBe(false);
    expect(rowMPlus1.prevEntryHash).toBe(rowM.entryHash);

    // One strict segment: a reset would have planted a second genesis mid-chain.
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

    // A survivor also wrote position 4 on this lineage; nothing carries rows between nodes today, so
    // a raw insert stands in for its arrival.
    const error = await captureError(() => rawForkInsertAt(4));
    expect(isUniqueViolation(error)).toBe(true);
    // `time_entries_chain_position_uq`'s columns, so a refusal on any other key fails here.
    expect(constraintTarget(error)).toEqual({
      table: "time_entries",
      columns: ["node_id", "location_id", "sequence_no"],
    });
    expect(await readChain(suite.db, k)).toHaveLength(4);
  });
});
