import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { appendToChain, readChain, type ChainKey, type TimeEntryAppend } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

/**
 * Real PostgreSQL via the shared container (same template as chain.concurrency.test.ts). Real PG,
 * not PGlite, because the load-bearing assertion is that `time_entries_chain_position_uq` REFUSES a
 * forked row as the deployment enforces it — the unique index fires under the app's own grants, not
 * a PGlite superuser bypass. The continuation half needs no contention, but it rides the same clone
 * so both halves see one enforced schema.
 *
 * What this file documents (spec §2 decision 3, §5.1): `packages/workforce` declares NO
 * `backup.restore` hook. A cold-restored box keeps its `node_id` and the backup's chain head
 * (pointing at row M with M's stored hash) and rows 1..M; its next append CONTINUES that chain at
 * M+1, chaining onto M's hash. There is no reset and no clock-floor — the fiscal restore's pointer
 * reset was dropped because a mid-chain genesis would weaken the strict verifier (spec §5.1 history).
 * A survivor that holds a longer copy of the chain collides LOUDLY at drain rather than merging
 * silently.
 */
const suite = useTemplateDb({ template: "core_identity_workforce" });

let tenantId: string;
let personId: string;
let locationId: string;
let nodeId: string;

// A FRESH tenant per test, as chain.concurrency.test.ts does: time_entries' block-truncate trigger
// makes the table un-wipeable even by its owner, so each test mints new rows in a new tenant and
// relies on the location scope to keep a previous test's committed rows out of view.
beforeEach(async () => {
  tenantId = await seedTenant(suite.admin);
  personId = await seedPerson(suite.admin, tenantId);
  locationId = await seedLocation(suite.admin, tenantId);
  nodeId = await seedNode(suite.admin, brandTenantId(tenantId), brandLocationId(locationId));
});

/** The chain key for this suite's default (tenant, node, location). */
function key(): ChainKey {
  return { tenantId, nodeId, locationId };
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

/** Reads the (tenant, node, location) chain head — what a backup carries verbatim into the restore. */
async function readHead(): Promise<{
  sequence_no: number;
  last_entry_id: string | null;
  last_entry_hash: string | null;
}> {
  const { rows } = await suite.admin.execute<{
    sequence_no: number;
    last_entry_id: string | null;
    last_entry_hash: string | null;
  }>(sql`
    select sequence_no, last_entry_id, last_entry_hash from workforce_chains
    where tenant_id = ${tenantId} and node_id = ${nodeId} and location_id = ${locationId}`);
  return rows[0]!;
}

/**
 * A raw insert claiming `position` on this (tenant, node, location) chain — the survivor's copy
 * arriving at drain. Every column but the position is a valid non-genesis row (prev_entry_hash set,
 * whole-second timestamps, hex hash), so the ONLY constraint it can trip is the chain-position uq.
 */
function rawForkInsertAt(position: number): Promise<unknown> {
  return suite.admin.execute(sql`
    insert into time_entries (
      tenant_id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id, recorded_at, entry_hash, prev_entry_hash, sequence_no, is_first_entry
    ) values (
      ${tenantId}, ${personId}, ${locationId}, ${nodeId}, 'in', '2026-01-05T20:00:00Z', 0,
      ${personId}, '2026-01-05T20:00:00Z', ${"B".repeat(64)}, ${"A".repeat(64)}, ${position}, false)`);
}

describe("cold restore continues the working-time chain (no hook)", () => {
  it("continues the chain at M+1 after a restore, one strict segment, no reset", async () => {
    const k = key();
    // Seed the chain to M = 3 — the rows and head a backup captures.
    for (const at of ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z", "2026-01-05T17:00:00Z"]) {
      await suite.admin.transaction((tx) => appendToChain(tx, k, inputAt(at)));
    }

    // The restore is a NO-OP by design: the restored DB holds exactly rows 1..M and a head pointing
    // at row M with M's stored hash. That is precisely the state M appends leave behind, so we assert
    // it and then continue — there is no hook to invoke, no pointer to reset, no counter to floor.
    const restored = await readChain(suite.admin, k);
    const head = await readHead();
    const rowM = restored[restored.length - 1]!;
    expect(restored.map((e) => e.sequenceNo)).toEqual([1, 2, 3]);
    expect(head.sequence_no).toBe(3);
    expect(head.last_entry_hash).toBe(rowM.entryHash);

    // Continue: the next append reads the restored head, computes M+1, and chains onto row M's hash.
    const appended = await suite.admin.transaction((tx) =>
      appendToChain(tx, k, inputAt("2026-01-06T09:00:00Z")),
    );
    expect(appended.sequenceNo).toBe(4);

    const chain = await readChain(suite.admin, k);
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

  it("refuses a survivor's forked row loudly on the chain-position uq (23505)", async () => {
    const k = key();
    // The returning box restores to M = 3 and continues to position 4 (its own lineage).
    for (const at of ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z", "2026-01-05T17:00:00Z"]) {
      await suite.admin.transaction((tx) => appendToChain(tx, k, inputAt(at)));
    }
    await suite.admin.transaction((tx) => appendToChain(tx, k, inputAt("2026-01-06T09:00:00Z")));

    // A survivor (a promoted cloud) also wrote position 4 on this same (tenant, node, location)
    // lineage. Its copy arriving at drain lands on a position the box already holds and is refused
    // LOUDLY — never merged into a fork. This is the local proxy for the replication drain the swap
    // S1 two-node fixture proves end to end (spec §6).
    const error = await captureError(() => rawForkInsertAt(4));
    expect(pgErrorCode(error)).toBe("23505");
    expect(pgErrorMessage(error)).toContain("time_entries_chain_position_uq");
  });
});
