import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { claimPrintJobs, runAgentOnce } from "./runtime.js";
import type { ClaimedJob } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "@waitron/print-agent";
import type { PrinterTarget, Transport } from "@waitron/print-agent";
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
    values (${tenantId}, 'Bar', array['es-ES'], 'Sale on premises') returning id`);
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
        values (${cfg.tenantId}, ${cfg.locationId}, 'Kitchen', 'scrypt$fixture') returning id`)
    ).rows[0]!.id;
    const printerId = await asApp(suite.admin, cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
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
      const aDone = asApp(connA, cfg, (tx) =>
        runAgentOnce({
          tx,
          cfg,
          agentId,
          locationId: cfg.locationId,
          visibleKeys: [],
          transport: gated,
        }),
      );
      await gated.entered;

      // Agent B now pulls WHILE A holds the row. With the lock, B skips A's row and claims nothing —
      // it settles quickly. WITHOUT the lock (proof-by-deletion), B blocks on A's row and shows up as
      // a lock waiter. Release A the moment EITHER is observed, so neither variant deadlocks.
      let bSettled = false;
      const bDone = asApp(connB, cfg, (tx) =>
        runAgentOnce({
          tx,
          cfg,
          agentId,
          locationId: cfg.locationId,
          visibleKeys: [],
          transport: sinkB,
        }),
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

  it("two DISTINCT agents claiming one network printer's queue never double-claim a job", async () => {
    // The two-boxes / reimaged-agent topology under the NEW eligibility: a network printer carries no
    // agent binding, so BOTH agents in the venue are eligible for the same queue. Only the locking pull
    // keeps each job to one claimer. Distinct agentIds (not the same one twice) so the claim's
    // `claimed_by` stamp differs per winner — the union of what each claims must still be disjoint.
    const cfg = await setup();
    const [agentA, agentB] = await Promise.all(
      ["A", "B"].map(async (name) => {
        const { rows } = await suite.admin.execute<{ id: string }>(sql`
          insert into print_agents (tenant_id, location_id, name, token_hash)
          values (${cfg.tenantId}, ${cfg.locationId}, ${"Kitchen " + name}, 'scrypt$fixture')
          returning id`);
        return rows[0]!.id;
      }),
    );
    const printerId = await asApp(suite.admin, cfg, (tx) =>
      createPrinter(tx, cfg, { name: "Kitchen", transport: "network_tcp", host: "10.0.0.9" }).then(
        (p) => p.id,
      ),
    );
    const N = 8;
    await asApp(suite.admin, cfg, async (tx) => {
      for (let i = 0; i < N; i++) await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([i]));
    });

    const [connA, connB] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
    try {
      // Agent A claims the whole batch and PARKS its transaction OPEN, holding the claimed rows' locks
      // (an uncommitted UPDATE). This stages guaranteed contention rather than trusting timing luck
      // (CLAUDE.md §1): B's contending pull runs while A still holds every row.
      let releaseA!: () => void;
      const gate = new Promise<void>((resolve) => (releaseA = resolve));
      let aClaimedResolve!: (v: ClaimedJob[]) => void;
      const aClaimed = new Promise<ClaimedJob[]>((resolve) => (aClaimedResolve = resolve));
      const aDone = withTenant(connA, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const claimed = await claimPrintJobs(tx, cfg, agentA, {
          locationId: cfg.locationId,
          visibleKeys: [],
        });
        aClaimedResolve(claimed);
        await gate; // hold the tx (and its row locks) open until the test releases it
        return claimed;
      });
      await aClaimed; // A has claimed and is parked, holding the locks

      // Agent B pulls the SAME queue concurrently. WITH the lock, B's SELECT skips A's locked rows and
      // claims nothing — it settles fast. WITHOUT `for update … skip locked` (proof-by-deletion), B's
      // unlocked SELECT re-reads the still-`queued` rows (A's UPDATE is uncommitted, invisible under
      // READ COMMITTED) and blocks at its own id-keyed UPDATE — a lock waiter — then re-marks every row
      // once A commits, a double claim. Release A the moment EITHER is observed so neither deadlocks.
      let bSettled = false;
      const bDone = withTenant(connB, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return claimPrintJobs(tx, cfg, agentB, { locationId: cfg.locationId, visibleKeys: [] });
      }).then((r) => {
        bSettled = true;
        return r;
      });
      await waitFor(async () => bSettled || (await lockWaiters(suite.admin)) >= 1);
      releaseA();

      const [aResult, bResult] = await Promise.all([aDone, bDone]);

      // The load-bearing assertion: across both agents every job was claimed AT MOST once, and all N
      // were claimed. Deleting the lock makes B re-claim A's rows → duplicate ids, length 2N.
      const claimedIds = [...aResult.map((j) => j.id), ...bResult.map((j) => j.id)];
      expect(new Set(claimedIds).size).toBe(claimedIds.length); // no duplicate claim
      expect(claimedIds).toHaveLength(N); // and the whole queue was claimed
      expect(aResult).toHaveLength(N); // A held all the locks, so A won the whole batch
      expect(bResult).toHaveLength(0);

      // The database agrees: every job is claimed exactly once (claimed_by set), none double-stamped.
      const { rows } = await suite.admin.execute<{ n: number }>(
        sql`select count(*)::int as n from print_jobs
            where printer_id = ${printerId} and status = 'printing' and claimed_by is not null`,
      );
      expect(rows[0]!.n).toBe(N);
    } finally {
      await Promise.all([connA.close(), connB.close()]);
    }
  });
});
