import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { claimPrintJobs, runAgentOnce } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "./transport.js";
import type { PrintConfig } from "./printers.js";

// Real PostgreSQL exercises claims and lease updates after SET ROLE app_user.
// These cases use sequential transactions; competing agents are covered by runtime.race.test.ts.
const suite = useTemplateDb({ template: "core" });

async function setup(): Promise<PrintConfig> {
  const tenantId = await seedTenant(suite.admin);
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Bar', array['es-ES'], 'Sale on premises') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

/** Run `fn` as the real deployment role — a tenant-scoped tx that switches to `app_user` first, then
 * COMMITS when it returns. Each call is its own committed transaction, so a claim in one call is visible
 * and UNLOCKED to the next — the "claimed, committed, then the agent died" state the lease reclaims. */
function asApp<T>(db: Database, cfg: PrintConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function seedAgent(cfg: PrintConfig): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${cfg.tenantId}, ${cfg.locationId}, 'Kitchen', 'scrypt$fixture') returning id`);
  return rows[0]!.id;
}

/**
 * Read the outbox row directly as the (superuser) admin — a plain observation of the lease
 * columns, not part of the behaviour under test.
 */
async function jobRow(jobId: string): Promise<{
  status: string;
  claimed_at: string | null;
  delivered_at: string | null;
  attempts: number;
}> {
  const { rows } = await suite.admin.execute<{
    status: string;
    claimed_at: string | null;
    delivered_at: string | null;
    attempts: number;
  }>(sql`select status, claimed_at, delivered_at, attempts from print_jobs where id = ${jobId}`);
  return rows[0]!;
}

async function seedPrinterAndJob(cfg: PrintConfig, agentId: string): Promise<string> {
  return asApp(suite.admin, cfg, async (tx) => {
    const printer = await createPrinter(tx, cfg, {
      name: "Kitchen",
      transport: "network_tcp",
      agentId,
      host: "10.0.0.9",
    });
    const { jobId } = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([0x41]));
    return jobId;
  });
}

describe("print-job lease reclaim (real Postgres)", () => {
  it("stamps claimed_at on claim, then RECLAIMS a stuck printing job once the lease has expired", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const jobId = await seedPrinterAndJob(cfg, agentId);

    // The agent CLAIMS the job (queued → printing, claimed_at stamped) in its own committed transaction,
    // then "dies": it never reports, so the row is left committed-and-unlocked in `printing`.
    const claimed = await asApp(suite.admin, cfg, (tx) => claimPrintJobs(tx, cfg, agentId));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(jobId);
    const afterClaim = await jobRow(jobId);
    expect(afterClaim.status).toBe("printing");
    expect(afterClaim.claimed_at).not.toBeNull(); // the lease anchor was stamped

    // Simulate the lease elapsing: age the claim well past PRINT_JOB_LEASE_MS (60s). now() here is real
    // wall-clock, so the row is now `printing` with a claim two minutes old — a dropped claim.
    await suite.admin.execute(
      sql`update print_jobs set claimed_at = now() - interval '2 minutes' where id = ${jobId}`,
    );

    // A SECOND run (a surviving agent's pull, or the same agent rebooted) re-selects the stuck job — the
    // committed printing row is unlocked, so SKIP LOCKED does not skip it once the lease predicate makes
    // it eligible — and delivers it.
    const sink = new FakeSink();
    const result = await asApp(suite.admin, cfg, (tx) =>
      runAgentOnce({ tx, cfg, agentId, transport: sink }),
    );
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(sink.written).toEqual([
      { printerId: claimed[0]!.printer_id, bytes: new Uint8Array([0x41]) },
    ]);

    const afterReclaim = await jobRow(jobId);
    expect(afterReclaim.status).toBe("done");
    expect(afterReclaim.delivered_at).not.toBeNull();
  });

  it("RECLAIMS an anomalous printing job whose claimed_at is NULL (no live lease)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const jobId = await seedPrinterAndJob(cfg, agentId);

    // Force the row into the anomalous state the lease's own guarantee must cover: `printing` with NO
    // `claimed_at`. The claim UPDATE stamps `status='printing'` and `claimed_at=now()` atomically and is
    // the only writer of `status='printing'`, so this cannot arise today — but a `printing` row with no
    // lease timestamp is, by definition, not a live claim, so the pull must treat it as stuck and reclaim
    // it immediately rather than strand it forever (`claimed_at < now() - lease` is UNKNOWN for NULL).
    await suite.admin.execute(
      sql`update print_jobs set status = 'printing', claimed_at = null where id = ${jobId}`,
    );
    const beforeReclaim = await jobRow(jobId);
    expect(beforeReclaim.status).toBe("printing");
    expect(beforeReclaim.claimed_at).toBeNull();
    const { rows: prows } = await suite.admin.execute<{ printer_id: string }>(
      sql`select printer_id from print_jobs where id = ${jobId}`,
    );
    const printerId = prows[0]!.printer_id;

    // The pull reclaims and delivers it — the `claimed_at IS NULL` alternative in the reclaim conjunct is
    // PROVEN load-bearing by deletion: remove it and this row is never re-selected and stays stuck in
    // `printing`; restore it and the run reclaims and delivers it (see copilot-null-claimedat-fix-report.md).
    const sink = new FakeSink();
    const result = await asApp(suite.admin, cfg, (tx) =>
      runAgentOnce({ tx, cfg, agentId, transport: sink }),
    );
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(sink.written).toEqual([{ printerId, bytes: new Uint8Array([0x41]) }]);

    const afterReclaim = await jobRow(jobId);
    expect(afterReclaim.status).toBe("done");
    expect(afterReclaim.delivered_at).not.toBeNull();
  });

  it("does NOT steal a live claim: a freshly-claimed printing job (lease not expired) is not re-selected", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const jobId = await seedPrinterAndJob(cfg, agentId);

    // The agent claims the job and is STILL WORKING — a slow-but-live push. The claim is committed
    // (printing, claimed_at = now()) but the lease has NOT expired.
    const claimed = await asApp(suite.admin, cfg, (tx) => claimPrintJobs(tx, cfg, agentId));
    expect(claimed).toHaveLength(1);
    const firstClaimedAt = (await jobRow(jobId)).claimed_at;
    expect(firstClaimedAt).not.toBeNull();

    // A concurrent claim (a second agent, or the same agent's next batch) must NOT reclaim it: the
    // visibility timeout does not fire on a live claim, so the fresh printing row is left alone.
    const second = await asApp(suite.admin, cfg, (tx) => claimPrintJobs(tx, cfg, agentId));
    expect(second).toEqual([]);

    const row = await jobRow(jobId);
    expect(row.status).toBe("printing"); // still the first claimer's, untouched
    expect(row.claimed_at).toBe(firstClaimedAt); // lease anchor not refreshed
  });
});
