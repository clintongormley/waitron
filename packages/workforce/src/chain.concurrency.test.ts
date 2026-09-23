/**
 * Concurrent callers of `appendToChain` leave ONE contiguous, re-verifying chain per (node,
 * location).
 *
 * ## What this suite was, and what converting it cost
 *
 * It ran against real PostgreSQL through `useTemplateDb`, opened one backend per writer, and
 * watched a `select … for update` on the `workforce_chains` head row make a second appender wait.
 * None of that exists now: `selectHead` (`./chain.ts`) takes no lock, SQLite has no row locks, and
 * a venue file has one write connection. What serialises writers is the venue file's write queue —
 * `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
 * `packages/store/src/write-queue.ts` issues `begin immediate` / `commit` around it. The
 * measurement that the SECOND caller has not even STARTED while the first is open, with its
 * control in the other direction, is recorded once on `racePair`
 * (`packages/catalogue/test/fixtures.ts`); it is not re-taken here.
 *
 * **The control that WAS run here, and what it does not show.** Replacing each
 * `withTransaction(suite.db, (tx) => appendToChain(tx, …))` below with a bare
 * `appendToChain(suite.db, …)` turns all four cases red (measured 2026-09-22, Node v26.7.0). The
 * first failure reads `no such savepoint: wt_sp_2`, from the adapter's nested-transaction handling
 * — NOT a lost update. So that control establishes that these appends do not work outside
 * `withTransaction`; it does NOT establish that the queue is what keeps the positions distinct.
 * The reading for that claim is `racePair`'s, taken where the two answers differ.
 *
 * **Three cases did not survive, and each is a real loss, not a rewording:**
 *
 * 1. `runs its writers on distinct backend processes` — `pg_backend_pid()` has no counterpart and
 *    there are no backends. Nothing now confirms the writers below are genuinely separate callers;
 *    what they are is separate `withTransaction` calls started without awaiting each other.
 * 2. `blocks a second appender on the same location chain` — it asserted SQLSTATE `55P03` from a
 *    `lock_timeout` while the head row was held. There is no lock to hold and no `lock_timeout`.
 * 3. `does not block an appender on a different location` — PER-LOCATION PARALLELISM IS GONE. The
 *    row lock let a busy location write while a quiet one wrote; the write queue is per FILE, so a
 *    busy location now does stall a quiet one. That is a property of the engine this branch chose,
 *    and no test here can restore it.
 *
 * What still has to hold, and is what remains below: every concurrent append commits, positions are
 * distinct and gap-free, the links hold, and two NODES writing one location never collide — the
 * last of those because `node_id` is in `time_entries_chain_position_uq`, which is an index, not a
 * lock, and is untouched.
 *
 * ## A FOURTH LOSS: the suite that stood beside this one is deleted
 *
 * `chain.pglite-cannot-test-contention.test.ts` was this suite's counter-example — an executable
 * demonstration that PGlite serialises every query onto one backend, so a green contention run on
 * it proved nothing. Its whole subject was a property of a database this branch removes, and its
 * purpose was to stop someone dropping the Testcontainers dependency, which no longer exists
 * either. It went red on `no such function: pg_backend_pid`. Deleted rather than reworded: a suite
 * whose subject is gone cannot be repointed at a different one without becoming a test of
 * something nobody decided to test. The twin in `packages/fiscal-verifactu/src` went for the same
 * reason earlier on this branch, and `docs/developers/testing-guide.md` carries the disposition.
 *
 * What is no longer checked, in this package, by anything: that a "concurrent" run which comes
 * back green had any concurrency in it at all. There is no engine-level premise check to replace
 * `pg_backend_pid()` with. The nearest thing is `racePair`
 * (`packages/catalogue/test/fixtures.ts`), which measures that a second writer has not STARTED
 * while the first is open — a different question, taken in a different package, and the reason
 * this file does not re-take it.
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

// A fresh tenant, person, location and node per test. On PostgreSQL this had to mint a NEW tenant
// each time, because `time_entries`' block-truncate trigger made the table un-wipeable even by its
// owner; `useVenueDb`'s reset drops each append-only trigger, empties the table and recreates the
// trigger from its own stored text (`packages/db/src/testing/venue-db.ts`), so the seeds below
// start from an empty database rather than from a new tenant inside a shared one.
beforeEach(async () => {
  await seedTenant(suite.db);
  personId = await seedPerson(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
});

/** The chain key for this suite's default (node, location). */
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

/** N distinct instants, one per concurrent writer. */
function instant(i: number): string {
  return `2026-01-05T${String(6 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`;
}

/**
 * Starts `count` appends WITHOUT awaiting each other, and settles them together.
 *
 * Each one is its own `withTransaction`, which is the product's own shape for a write — so what
 * they queue on here is what a till's two simultaneous requests queue on. `Promise.all` rather than
 * `allSettled`: every one of them must commit, and a rejection failing the test with its own reason
 * is more useful than a settled array to pick apart.
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
    // A naive read-then-write loses this race on an engine that admits two writers (fiscal measured
    // 3 of 20 surviving on PostgreSQL without the head lock). Anything below 20 is that failure.
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
    // Walk the WHOLE chain, not just the ends — a single crossed pair in the middle is exactly
    // what a lost race produces.
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]?.prevEntryHash).toBe(chain[i - 1]?.entryHash);
    }
    // And the whole thing re-verifies: hashes recompute, links hold, positions are contiguous.
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it("never collides between two nodes on the SAME location — independent heads", async () => {
    // The rekey's whole point (spec §2.1): a promoted cloud and a returning box write ONE location
    // through two chains keyed by node_id, so their positions live in disjoint spaces and cannot
    // collide. Both nodes claim the same sequence_no VALUES (1, 2, 3 …) at one location — the exact
    // clash a (location, sequence_no) position uq would force — and with node_id in that uq none of
    // them collide. This case passes only because `node_id` is in
    // `time_entries_chain_position_uq`: drop it and the two nodes' equal sequence_no values collide
    // on (location, sequence_no). That index, unlike the head lock, survived the storage switch
    // untouched, so this is the one case here whose subject is exactly what it always was.
    const nodeB = await seedNode(suite.db, brandLocationId(locationId));
    const perNode = WRITERS / 2;
    // Interleave A and B so the two nodes' appends are started against each other, each producing
    // sequence_no 1..perNode.
    await appendAll((i) => key(locationId, i % 2 === 0 ? nodeId : nodeB));

    const chainA = await readChain(suite.db, key(locationId, nodeId));
    const chainB = await readChain(suite.db, key(locationId, nodeB));
    const expectedPositions = Array.from({ length: perNode }, (_, i) => i + 1);
    // Two heads, two contiguous position spaces from 1, each independently verifiable.
    expect(chainA.map((e) => e.sequenceNo)).toEqual(expectedPositions);
    expect(chainB.map((e) => e.sequenceNo)).toEqual(expectedPositions);
    expect(verifyChain(chainA)).toEqual({ ok: true });
    expect(verifyChain(chainB)).toEqual({ ok: true });
    // Nothing was lost or forked: every append survived, split across the two chains.
    expect(chainA.length + chainB.length).toBe(WRITERS);
  });
});
