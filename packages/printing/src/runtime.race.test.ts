import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { runAgentOnce } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "./transport.js";
import type { PrinterTarget, Transport } from "./transport.js";
import type { PrintConfig } from "./printers.js";

// Real Postgres (a `core` template clone), NOT PGlite: the "two agents don't double-print" guarantee
// is a CONCURRENCY property of the locking pull, and PGlite serialises every query onto one backend,
// so two agent instances never truly contend there — a false pass, not a weak one (CLAUDE.md §4).
// The locking clause (`for update ... skip locked` in runtime.ts's pull) is PROVEN LOAD-BEARING by
// deletion: with it, agent B skips agent A's in-flight row and the job prints exactly once; delete it
// and B re-claims the same row after A commits, printing it twice (total 2 → this test's `toBe(1)`
// fails). See task-5-report.md for the recorded RED/GREEN of that deletion.
const suite = useTemplateDb({ template: "core" });

async function setup(): Promise<PrintConfig> {
  const admin = suite.admin;
  const tenantId = await seedTenant(admin);
  const { rows } = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

/** Run `fn` as the real deployment role — a tenant-scoped tx that switches to `app_user` first, the
 * shape the Task-6 route wraps every runtime call in. */
function asApp<T>(db: Database, cfg: PrintConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/**
 * A sink that PARKS the agent mid-push, holding its claim transaction (and the claimed row's lock)
 * open until the test releases it. `entered` resolves the instant `send` is reached, so the test can
 * stage the second agent's contending pull with certainty rather than by timing luck (CLAUDE.md §1 —
 * a race asserted without staged contention proves nothing).
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

/** Count backends (in this clone db) currently WAITING on a lock — the tell that agent B's pull is
 * blocked on agent A's claimed row (the state the deleted-lock variant reaches). */
async function lockWaiters(admin: Database): Promise<number> {
  const { rows } = await admin.execute<{ n: number }>(sql`
    select count(*)::int as n from pg_stat_activity
    where datname = current_database() and wait_event_type = 'Lock'`);
  return rows[0]!.n;
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor: condition not met within timeout");
}

describe("double-pull race (real Postgres)", () => {
  it("marks printing atomically so two agents don't double-print", async () => {
    const cfg = await setup();
    // One agent, one printer, one queued job. Two agent INSTANCES (distinct backends) will both try
    // to pull it — the reimaged-agent / two-boxes topology.
    const agentId = (
      await suite.admin.execute<{ id: string }>(sql`
        insert into print_agents (tenant_id, location_id, name, token_hash)
        values (${cfg.tenantId}, ${cfg.locationId}, 'Cocina', 'scrypt$fixture') returning id`)
    ).rows[0]!.id;
    const printerId = await asApp(suite.admin, cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Cocina",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.9",
      }).then((p) => p.id),
    );
    const { jobId } = await asApp(suite.admin, cfg, (tx) =>
      enqueuePrintJob(tx, cfg, printerId, new Uint8Array([0x41])),
    );

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      const pids = await Promise.all(
        [connA, connB].map(async (db) => {
          const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          return rows[0]!.pid;
        }),
      );
      expect(new Set(pids).size).toBe(2); // genuinely distinct backends

      const gated = new GatedSink();
      const sinkB = new FakeSink();

      // Agent A claims the job and PARKS mid-push, holding its row lock (tx still open).
      const aDone = asApp(connA, cfg, (tx) => runAgentOnce({ tx, cfg, agentId, transport: gated }));
      await gated.entered;

      // Agent B now pulls WHILE A holds the row. With the lock, B skips A's row and claims nothing —
      // it settles quickly. WITHOUT the lock (proof-by-deletion), B blocks on A's row and shows up as
      // a lock waiter. Release A the moment EITHER is observed, so neither variant deadlocks.
      let bSettled = false;
      const bDone = asApp(connB, cfg, (tx) =>
        runAgentOnce({ tx, cfg, agentId, transport: sinkB }),
      ).then((r) => {
        bSettled = true;
        return r;
      });
      await waitFor(async () => bSettled || (await lockWaiters(suite.admin)) >= 1);
      gated.release();

      const [aResult, bResult] = await Promise.all([aDone, bDone]);

      // The load-bearing assertion: the job was delivered EXACTLY ONCE across both agents.
      expect(gated.written.length + sinkB.written.length).toBe(1);
      expect(gated.written).toHaveLength(1);
      expect(sinkB.written).toHaveLength(0);
      expect(aResult).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      expect(bResult).toEqual({ claimed: 0, delivered: 0, failed: 0 });

      // The database agrees: the single job is done, claimed once.
      const { rows } = await suite.admin.execute<{ status: string; attempts: number }>(
        sql`select status, attempts from print_jobs where id = ${jobId}`,
      );
      expect(rows[0]!.status).toBe("done");
      expect(rows[0]!.attempts).toBe(0);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
