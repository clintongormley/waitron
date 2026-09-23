import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { claimPrintJobs, runAgentOnce } from "./runtime.js";
import type { ClaimedJob } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "@waitron/print-agent";
import type { PrinterTarget, Transport } from "@waitron/print-agent";
import type { PrintConfig } from "./printers.js";

/**
 * Two agents pulling one venue's queue deliver each job at most once.
 *
 * ## What replaced the lock observation
 *
 * This suite used to take TWO PostgreSQL backends, park the first mid-push holding its claimed
 * row's lock, and poll `pg_stat_activity` until the second showed up as a lock WAITER. None of
 * that exists here: one connection per venue file, no row locks, and no `pg_stat_activity`. What
 * the engine has instead is the file's write queue — `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
 * `packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body, then `commit`, so
 * the next caller's `begin` does not run until that `commit` has returned.
 *
 * So the thing observed moved: not "agent B is BLOCKED", but "agent B has not STARTED". Each case
 * below parks agent A inside its push, with A's transaction open, and asserts B's transaction body
 * has not run a statement — `parkedThenRelease` below, the same shape
 * `packages/catalogue/test/fixtures.ts`'s `racePair` uses. That is the receipt for the
 * `for update … skip locked` this claim dropped.
 *
 * The observation was taken with a control in the other direction, 2026-09-22 on Node v26.7.0:
 * with `withTransaction` removed from `parkedThenRelease`'s second body and nothing else changed,
 * both cases failed on `expected true to be false`; restored, both pass. So the `false` is not a
 * reading that could never have been anything else (CLAUDE.md §1).
 *
 * ## What this suite does NOT show, unchanged from the PostgreSQL version
 *
 * It shows the PROPERTY — two agents contending over one queue claim each job at most once — not
 * what the property rests on. Measured 2026-09-21 on the PostgreSQL version: with
 * `for update … skip locked` taken out of `packages/db/src/job-claim.ts` and nothing else changed,
 * this suite and runtime.reclaim.test.ts both still PASSED. The clause is gone from the tree now;
 * what holds the property on this engine — one writer at a time, plus `claimPrintJobs`'s own
 * refusal to re-select a LIVE claim — has its own receipts in `packages/db/src/job-claim.sqlite.test.ts`
 * and in runtime.reclaim.test.ts's third case. See docs/developers/testing-guide.md, "A
 * proof-by-deletion belongs to the SHAPE of the code it was taken against".
 *
 * ## What is LOST outright
 *
 * Two distinct backends, and the deployment role: this engine has no roles. Nothing replaces
 * either.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
  // Through the table definition, not raw SQL: `locations.id` comes from `$defaultFn(newId)` in
  // JavaScript, and `invoiceLocales` reaches its column's JSON mapping where `array['es-ES']` used
  // to be SQL this engine does not have.
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return { locationId: row!.id };
}

async function seedAgent(cfg: PrintConfig, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId: cfg.locationId, name, tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

/**
 * A sink that PARKS the agent mid-push, holding its transaction open until the test releases it.
 * `entered` resolves the instant `send` is reached, so the test stages the second agent's pull with
 * certainty rather than by timing luck (CLAUDE.md §1 — a race asserted without staged contention
 * proves nothing).
 */
class GatedSink implements Transport {
  readonly written: { printerId: string; bytes: Uint8Array }[] = [];
  private markEntered!: () => void;
  readonly entered = new Promise<void>((resolve) => (this.markEntered = resolve));
  release!: () => void;
  private readonly gate = new Promise<void>((resolve) => (this.release = resolve));
  async send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    this.written.push({ printerId: printer.id, bytes });
    this.markEntered();
    await this.gate;
  }
}

/**
 * Runs `second` while `first`'s transaction is parked open, and asserts it did not start.
 *
 * `parked` is what tells the helper the first transaction is open and stuck — the gated sink's
 * `entered` for a push, a latch the body opens for a claim. The pause afterwards is a real timer,
 * not a microtask turn: it has to give the second transaction every chance to run a statement it
 * must not run.
 */
async function parkedThenRelease<A, B>(
  first: (tx: Transaction) => Promise<A>,
  parked: Promise<void>,
  release: () => void,
  second: (tx: Transaction) => Promise<B>,
): Promise<[A, B]> {
  let secondStarted = false;
  const one = withTransaction(suite.db, first);
  await parked;
  // Started without awaiting `one`. Nothing but the write queue keeps it out.
  const two = withTransaction(suite.db, (tx: Transaction) => {
    secondStarted = true;
    return second(tx);
  });
  const settled = Promise.all([one, two]);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondStarted, "the second transaction started while the first was still open").toBe(
      false,
    );
  } finally {
    release();
  }
  return settled;
}

describe("double-pull race", () => {
  it("marks printing atomically so two agents don't double-print", async () => {
    const cfg = await setup();
    // One agent, one printer, one queued job. Two agent RUNS will both try to pull it — the
    // reimaged-agent / two-boxes topology.
    const agentId = await seedAgent(cfg, "Kitchen");
    const printerId = await withTransaction(suite.db, (tx: Transaction) =>
      createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        host: "10.0.0.9",
      }).then((p) => p.id),
    );
    const { jobId } = await withTransaction(suite.db, (tx: Transaction) =>
      enqueuePrintJob(tx, cfg, printerId, new Uint8Array([0x41])),
    );

    const gated = new GatedSink();
    const sinkB = new FakeSink();

    // Agent A claims the job and PARKS mid-push, its transaction still open. Agent B's whole run is
    // attempted while A is parked.
    const [aResult, bResult] = await parkedThenRelease(
      (tx) =>
        runAgentOnce({
          tx,
          agentId,
          locationId: cfg.locationId,
          visibleKeys: [],
          transport: gated,
        }),
      gated.entered,
      () => gated.release(),
      (tx) =>
        runAgentOnce({
          tx,
          agentId,
          locationId: cfg.locationId,
          visibleKeys: [],
          transport: sinkB,
        }),
    );

    // The assertion that matters: the job was delivered EXACTLY ONCE across both agents.
    expect(gated.written.length + sinkB.written.length).toBe(1);
    expect(gated.written).toHaveLength(1);
    expect(sinkB.written).toHaveLength(0);
    expect(aResult).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(bResult).toEqual({ claimed: 0, delivered: 0, failed: 0 });

    // The database agrees: the single job is done, claimed once.
    const [row] = await suite.db
      .select({ status: printJobs.status, attempts: printJobs.attempts })
      .from(printJobs)
      .where(eq(printJobs.id, jobId));
    expect(row!.status).toBe("done");
    expect(row!.attempts).toBe(0);
  });

  it("two DISTINCT agents claiming one network printer's queue never double-claim a job", async () => {
    // The two-boxes / reimaged-agent topology under the NEW eligibility: a network printer carries no
    // agent binding, so BOTH agents in the venue are eligible for the same queue. The claim is what
    // keeps each job to one claimer. Distinct agentIds (not the same one twice) so the claim's
    // `claimed_by` stamp differs per winner — the union of what each claims must still be disjoint.
    const cfg = await setup();
    const agentA = await seedAgent(cfg, "Kitchen A");
    const agentB = await seedAgent(cfg, "Kitchen B");
    const printerId = await withTransaction(suite.db, (tx: Transaction) =>
      createPrinter(tx, cfg, { name: "Kitchen", transport: "network_tcp", host: "10.0.0.9" }).then(
        (p) => p.id,
      ),
    );
    const N = 8;
    await withTransaction(suite.db, async (tx: Transaction) => {
      for (let i = 0; i < N; i++) await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([i]));
    });

    // Agent A claims the whole batch and PARKS its transaction OPEN, so B's contending pull is
    // attempted while A's claim is still uncommitted.
    let releaseA!: () => void;
    const gate = new Promise<void>((resolve) => (releaseA = resolve));
    let aClaimedResolve!: () => void;
    const aClaimed = new Promise<void>((resolve) => (aClaimedResolve = resolve));

    const [aResult, bResult] = await parkedThenRelease<ClaimedJob[], ClaimedJob[]>(
      async (tx) => {
        const claimed = await claimPrintJobs(tx, agentA, {
          locationId: cfg.locationId,
          visibleKeys: [],
        });
        aClaimedResolve();
        await gate; // hold the transaction open until the test releases it
        return claimed;
      },
      aClaimed,
      () => releaseA(),
      (tx) => claimPrintJobs(tx, agentB, { locationId: cfg.locationId, visibleKeys: [] }),
    );

    // The assertion that matters: across both agents every job was claimed AT MOST once, and all
    // N were claimed. Duplicate ids here, length 2N, would be a double claim — which is what the
    // two-statement pull this replaced produced when its lock clause was deleted.
    const claimedIds = [...aResult.map((j) => j.id), ...bResult.map((j) => j.id)];
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // no duplicate claim
    expect(claimedIds).toHaveLength(N); // and the whole queue was claimed
    expect(aResult).toHaveLength(N); // A ran first, so A won the whole batch
    expect(bResult).toHaveLength(0);

    // The database agrees: every job is claimed exactly once (claimed_by set), none double-stamped.
    const rows = await suite.db
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    expect(rows).toHaveLength(N);
    const stamped = await suite.db
      .select({ id: printJobs.id, claimedBy: printJobs.claimedBy, status: printJobs.status })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    expect(stamped.filter((r) => r.status === "printing" && r.claimedBy !== null)).toHaveLength(N);
  });
});
