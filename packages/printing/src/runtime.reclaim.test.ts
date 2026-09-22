import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { claimPrintJobs, runAgentOnce } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "@waitron/print-agent";
import type { PrintConfig } from "./printers.js";

// The lease reclaim, on the venue file. These cases use sequential transactions; competing agents
// are covered by runtime.race.test.ts.
//
// WHAT THIS SUITE NO LONGER SHOWS. It used to run every write after `set local role app_user`
// against a real PostgreSQL cluster, so the deployment role's grants on `print_jobs` were
// exercised. This engine has no roles and `asAppUser` is an empty body
// (`packages/db/src/testing/roles.ts`). The second thing that went with PostgreSQL is `now()`: the
// lease cutoff was the SERVER's clock, and it is now the process holding the venue file
// (`claimPrintJobs`'s own comment records what that gives up). Every `now() - interval '2 minutes'`
// below is therefore computed in JavaScript, in the one ISO-8601 spelling `claimed_at` is compared
// in.
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

async function seedAgent(cfg: PrintConfig): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId: cfg.locationId, name: "Kitchen", tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

/** Read the outbox row's lease columns directly — a plain observation, not the behaviour under
 * test. Through the table, so the column mapping runs. */
async function jobRow(jobId: string): Promise<{
  status: string;
  claimedAt: string | null;
  deliveredAt: string | null;
  attempts: number;
}> {
  const [row] = await suite.db
    .select({
      status: printJobs.status,
      claimedAt: printJobs.claimedAt,
      deliveredAt: printJobs.deliveredAt,
      attempts: printJobs.attempts,
    })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!;
}

async function seedPrinterAndJob(cfg: PrintConfig): Promise<string> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    const printer = await createPrinter(tx, cfg, {
      name: "Kitchen",
      transport: "network_tcp",
      host: "10.0.0.9",
    });
    const { jobId } = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([0x41]));
    return jobId;
  });
}

describe("print-job lease reclaim", () => {
  it("stamps claimed_at on claim, then RECLAIMS a stuck printing job once the lease has expired", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const jobId = await seedPrinterAndJob(cfg);

    // The agent CLAIMS the job (queued → printing, claimed_at stamped) in its own committed transaction,
    // then "dies": it never reports, so the row is left committed in `printing`.
    const claimed = await withTransaction(suite.db, (tx: Transaction) =>
      claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(jobId);
    const afterClaim = await jobRow(jobId);
    expect(afterClaim.status).toBe("printing");
    expect(afterClaim.claimedAt).not.toBeNull(); // the lease anchor was stamped

    // Simulate the lease elapsing: age the claim well past PRINT_JOB_LEASE_MS (60s). The stamp is
    // real wall-clock, so the row is now `printing` with a claim two minutes old — a dropped claim.
    await suite.db
      .update(printJobs)
      .set({ claimedAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(printJobs.id, jobId));

    // A SECOND run (a surviving agent's pull, or the same agent rebooted) re-selects the stuck job —
    // the committed printing row is held by nobody, so nothing passes over it once the lease
    // predicate makes it eligible — and delivers it.
    const sink = new FakeSink();
    const result = await withTransaction(suite.db, (tx: Transaction) =>
      runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      }),
    );
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(sink.written).toEqual([
      { printerId: claimed[0]!.printer_id, bytes: new Uint8Array([0x41]) },
    ]);

    const afterReclaim = await jobRow(jobId);
    expect(afterReclaim.status).toBe("done");
    expect(afterReclaim.deliveredAt).not.toBeNull();
  });

  it("RECLAIMS an anomalous printing job whose claimed_at is NULL (no live lease)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const jobId = await seedPrinterAndJob(cfg);

    // Force the row into the anomalous state the lease's own guarantee must cover: `printing` with NO
    // `claimed_at`. The claim UPDATE stamps `status='printing'` and `claimed_at` atomically and is
    // the only writer of `status='printing'`, so this cannot arise today — but a `printing` row with no
    // lease timestamp is, by definition, not a live claim, so the pull must treat it as stuck and reclaim
    // it immediately rather than strand it forever (`claimed_at < …` is UNKNOWN for NULL).
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedAt: null })
      .where(eq(printJobs.id, jobId));
    const beforeReclaim = await jobRow(jobId);
    expect(beforeReclaim.status).toBe("printing");
    expect(beforeReclaim.claimedAt).toBeNull();
    const [printerRow] = await suite.db
      .select({ printerId: printJobs.printerId })
      .from(printJobs)
      .where(eq(printJobs.id, jobId));
    const printerId = printerRow!.printerId;

    // The pull reclaims and delivers it — the `claimed_at IS NULL` alternative in the reclaim conjunct is
    // PROVEN load-bearing by deletion: remove it and this row is never re-selected and stays stuck in
    // `printing`; restore it and the run reclaims and delivers it. Re-taken on THIS engine,
    // 2026-09-22 on Node v26.7.0: with `j.claimed_at is null or ` removed from `claimPrintJobs`'s
    // reclaim conjunct (`packages/printing/src/runtime.ts`) and nothing else changed, this was the
    // ONLY one of the three cases in this file that failed; restored, all three pass.
    const sink = new FakeSink();
    const result = await withTransaction(suite.db, (tx: Transaction) =>
      runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      }),
    );
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(sink.written).toEqual([{ printerId, bytes: new Uint8Array([0x41]) }]);

    const afterReclaim = await jobRow(jobId);
    expect(afterReclaim.status).toBe("done");
    expect(afterReclaim.deliveredAt).not.toBeNull();
  });

  it("does NOT steal a live claim: a freshly-claimed printing job (lease not expired) is not re-selected", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const jobId = await seedPrinterAndJob(cfg);

    // The agent claims the job and is STILL WORKING — a slow-but-live push. The claim is committed
    // (printing, claimed_at = now) but the lease has NOT expired.
    const claimed = await withTransaction(suite.db, (tx: Transaction) =>
      claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
    );
    expect(claimed).toHaveLength(1);
    const firstClaimedAt = (await jobRow(jobId)).claimedAt;
    expect(firstClaimedAt).not.toBeNull();

    // A later claim (a second agent, or the same agent's next batch) must NOT reclaim it: the
    // visibility timeout does not fire on a live claim, so the fresh printing row is left alone.
    const second = await withTransaction(suite.db, (tx: Transaction) =>
      claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
    );
    expect(second).toEqual([]);

    const row = await jobRow(jobId);
    expect(row.status).toBe("printing"); // still the first claimer's, untouched
    expect(row.claimedAt).toBe(firstClaimedAt); // lease anchor not refreshed
  });
});
