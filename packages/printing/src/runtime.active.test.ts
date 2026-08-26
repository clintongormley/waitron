import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { claimPrintJobs } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";

// Real Postgres (a `core` template clone), NOT PGlite: the "deactivated printer is not lease-reclaimed"
// case depends on the claim being COMMITTED and the stuck `printing` row UNLOCKED between transactions —
// the "an agent claimed, committed, then died" shape PGlite (one serialised backend) cannot exercise
// (CLAUDE.md §4). The `p.active = true` conjunct on the pull predicate (runtime.ts) is PROVEN
// load-bearing by deletion: remove it and the deactivated printer's queued job below is claimed and its
// stuck `printing` job is reclaimed; keep it and both are left untouched until the printer is reactivated.
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
 * and UNLOCKED to the next (the reclaim test's `asApp`, the committed-then-died shape). */
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

/** Observe one outbox row's status directly as the (superuser) admin, bypassing RLS. */
async function jobStatus(jobId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ status: string }>(
    sql`select status from print_jobs where id = ${jobId}`,
  );
  return rows[0]!.status;
}

/** Deactivate a printer directly as the admin — a plain arrange step (`active := false`), not the
 * behaviour under test, matching how the reclaim test ages `claimed_at` via the admin connection. */
async function deactivate(printerId: string): Promise<void> {
  await suite.admin.execute(sql`update printers set active = false where id = ${printerId}`);
}

describe("claimPrintJobs respects printers.active (real Postgres)", () => {
  it("does NOT claim a queued job for a DEACTIVATED printer, but DOES for an active one", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);

    // Two printers on the same agent — both jobs enqueued while ACTIVE (enqueue itself now rejects an
    // inactive printer), then one printer is deactivated.
    const seeded = await asApp(suite.admin, cfg, async (tx) => {
      const active = await createPrinter(tx, cfg, {
        name: "Active",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.1",
      });
      const dead = await createPrinter(tx, cfg, {
        name: "Dead",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.2",
      });
      const { jobId: activeJobId } = await enqueuePrintJob(tx, cfg, active.id, new Uint8Array([1]));
      const { jobId: deadJobId } = await enqueuePrintJob(tx, cfg, dead.id, new Uint8Array([2]));
      return { dead: dead.id, activeJobId, deadJobId };
    });
    await deactivate(seeded.dead);

    const claimed = await asApp(suite.admin, cfg, (tx) => claimPrintJobs(tx, cfg, agentId));

    // The active printer's job is claimed; the deactivated printer's queued job is left untouched — the
    // agent stops pulling for a disabled printer, so the job simply waits for reactivation.
    expect(claimed.map((j) => j.id)).toEqual([seeded.activeJobId]);
    expect(await jobStatus(seeded.activeJobId)).toBe("printing");
    expect(await jobStatus(seeded.deadJobId)).toBe("queued");
  });

  it("does NOT lease-reclaim a stuck printing job for a DEACTIVATED printer", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);

    const jobId = await asApp(suite.admin, cfg, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.9",
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([0x41]));
      return jobId;
    });

    // The agent CLAIMS the job (queued → printing, claimed_at stamped) in its own committed transaction,
    // then "dies": the row is left committed-and-unlocked in `printing`.
    const claimed = await asApp(suite.admin, cfg, (tx) => claimPrintJobs(tx, cfg, agentId));
    expect(claimed).toHaveLength(1);
    const printerId = claimed[0]!.printer_id;

    // Age the claim well past the lease (a dropped claim the pull would normally reclaim) AND deactivate
    // the printer.
    await suite.admin.execute(
      sql`update print_jobs set claimed_at = now() - interval '2 minutes' where id = ${jobId}`,
    );
    await deactivate(printerId);

    // A later pull must NOT reclaim the stuck job: the printer is deactivated, so the lease reclaim is
    // suppressed and the job stays stranded in `printing` until the printer is reactivated.
    const reclaimed = await asApp(suite.admin, cfg, (tx) => claimPrintJobs(tx, cfg, agentId));
    expect(reclaimed).toEqual([]);
    expect(await jobStatus(jobId)).toBe("printing");
  });
});
