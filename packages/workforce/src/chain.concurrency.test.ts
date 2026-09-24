/**
 * Concurrent callers of `appendToChain` leave ONE contiguous, re-verifying chain per (node,
 * location).
 *
 * Weaker than its name: nothing here checks that the writers actually overlap, and it does not show
 * that the venue file's write queue is what keeps positions distinct. `racePair`
 * (`packages/catalogue/test/fixtures.ts`) measures that a second writer has not started while the
 * first is open.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { appendToChain, readChain, type ChainKey, type TimeEntryAppend } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

const WRITERS = 20;

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

function key(location = locationId, node = nodeId): ChainKey {
  return { nodeId: node, locationId: location };
}

function inputAt(at: string): TimeEntryAppend {
  return {
    personId,
    entryKind: "in",
    eventAt: at,
    eventOffsetMinutes: 0,
    recordedByPersonId: personId,
  };
}

function instant(i: number): string {
  return `2026-01-05T${String(6 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`;
}

/**
 * Starts `count` appends WITHOUT awaiting each other, each in its own `withTransaction` (the product's
 * shape for a write). `Promise.all`, not `allSettled`: every one must commit.
 */
function appendAll(chains: (i: number) => ChainKey, count = WRITERS) {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      withTransaction(suite.db, (tx) => appendToChain(tx, chains(i), inputAt(instant(i)))),
    ),
  );
}

describe("appendToChain under concurrent callers", () => {
  it("commits all 20 concurrent appends to one location chain", async () => {
    const results = await appendAll(() => key());
    expect(results).toHaveLength(WRITERS);
    expect(await readChain(suite.db, key())).toHaveLength(WRITERS);
  });

  it("assigns every concurrent append a distinct position with no gaps", async () => {
    await appendAll(() => key());
    const chain = await readChain(suite.db, key());
    expect(chain.map((e) => e.sequenceNo)).toEqual(
      Array.from({ length: WRITERS }, (_, i) => i + 1),
    );
  });

  it("leaves every entry correctly chained into one gap-free, verifiable chain", async () => {
    await appendAll(() => key());
    const chain = await readChain(suite.db, key());
    expect(chain[0]?.isFirstEntry).toBe(true);
    // Walk the WHOLE chain: a single crossed pair in the middle is what a lost race produces.
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]?.prevEntryHash).toBe(chain[i - 1]?.entryHash);
    }
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it("never collides between two nodes on the SAME location — independent heads", async () => {
    // Both nodes claim the same sequence_no values at one location; they cannot collide only because
    // `node_id` is in `time_entries_chain_position_uq`.
    const nodeB = await seedNode(suite.db, brandLocationId(locationId));
    const perNode = WRITERS / 2;
    // Interleaved, so each node produces sequence_no 1..perNode.
    await appendAll((i) => key(locationId, i % 2 === 0 ? nodeId : nodeB));

    const chainA = await readChain(suite.db, key(locationId, nodeId));
    const chainB = await readChain(suite.db, key(locationId, nodeB));
    const expectedPositions = Array.from({ length: perNode }, (_, i) => i + 1);
    expect(chainA.map((e) => e.sequenceNo)).toEqual(expectedPositions);
    expect(chainB.map((e) => e.sequenceNo)).toEqual(expectedPositions);
    expect(verifyChain(chainA)).toEqual({ ok: true });
    expect(verifyChain(chainB)).toEqual({ ok: true });
    expect(chainA.length + chainB.length).toBe(WRITERS);
  });
});
