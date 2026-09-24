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
 * One writer holds the venue file at a time, so contention shows as the second agent's transaction
 * not STARTING while the first is open — which `parkedThenRelease` asserts.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
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
 * certainty rather than by timing luck.
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
    // Two agent RUNS will both try to pull it — the reimaged-agent / two-boxes topology.
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

    expect(gated.written.length + sinkB.written.length).toBe(1);
    expect(gated.written).toHaveLength(1);
    expect(sinkB.written).toHaveLength(0);
    expect(aResult).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(bResult).toEqual({ claimed: 0, delivered: 0, failed: 0 });

    const [row] = await suite.db
      .select({ status: printJobs.status, attempts: printJobs.attempts })
      .from(printJobs)
      .where(eq(printJobs.id, jobId));
    expect(row!.status).toBe("done");
    expect(row!.attempts).toBe(0);
  });

  it("two DISTINCT agents claiming one network printer's queue never double-claim a job", async () => {
    // A network printer carries no agent binding, so BOTH agents in the venue are eligible for the
    // same queue. Distinct agentIds so the claim's `claimed_by` stamp differs per winner.
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
        await gate;
        return claimed;
      },
      aClaimed,
      () => releaseA(),
      (tx) => claimPrintJobs(tx, agentB, { locationId: cfg.locationId, visibleKeys: [] }),
    );

    const claimedIds = [...aResult.map((j) => j.id), ...bResult.map((j) => j.id)];
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds).toHaveLength(N);
    expect(aResult).toHaveLength(N); // A ran first, so A won the whole batch
    expect(bResult).toHaveLength(0);

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
