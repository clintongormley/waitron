import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, printJobs, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { esc } from "./escpos.js";
import { MAX_DELIVERY_ATTEMPTS, runAgentOnce } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "./transport.js";
import type { PrinterTarget, Transport } from "./transport.js";
import type { PrintConfig } from "./printers.js";

// PGlite is the right target for the runtime's LOGIC — the happy pull→push→report path, per-printer
// failure isolation, the retry cap, and the agent-scope filter — none of which depend on concurrency
// or the deployment role. The one property PGlite CANNOT show is the double-pull race (it serialises
// every query onto one backend, so two agents never truly contend): that lives in runtime.race.test.ts
// against real Postgres, proven by deletion of the locking pull (CLAUDE.md §4).
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintConfig> {
  const tenantId = await seedTenant(suite.db);
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Bar', array['es-ES'], 'Sale on premises') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

async function seedAgent(cfg: PrintConfig, name = "Kitchen agent"): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${cfg.tenantId}, ${cfg.locationId}, ${name}, 'scrypt$fixture') returning id`);
  return rows[0]!.id;
}

async function seedPrinter(tx: Transaction, cfg: PrintConfig, agentId: string): Promise<string> {
  const { id } = await createPrinter(tx, cfg, {
    name: "Kitchen",
    transport: "network_tcp",
    agentId,
    host: "10.0.0.9",
    port: 9100,
  });
  return id;
}

async function jobRow(
  tx: Transaction,
  jobId: string,
): Promise<{
  status: string;
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
}> {
  const [row] = await tx
    .select({
      status: printJobs.status,
      attempts: printJobs.attempts,
      lastError: printJobs.lastError,
      deliveredAt: printJobs.deliveredAt,
    })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!;
}

/** A sink that FAILS for one nominated printer and records the rest — the down-printer double. */
class FlakySink implements Transport {
  readonly written: { printerId: string; bytes: Uint8Array }[] = [];
  constructor(private readonly downPrinterId: string) {}
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    if (printer.id === this.downPrinterId) return Promise.reject(new Error("printer offline"));
    this.written.push({ printerId: printer.id, bytes });
    return Promise.resolve();
  }
}

describe("runAgentOnce (pull → push → report)", () => {
  it("pulls a queued job, pushes the exact bytes, and reports done", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const printerId = await seedPrinter(tx, cfg, agentId);
      const { jobId } = await enqueuePrintJob(
        tx,
        cfg,
        printerId,
        esc().text("Table 4").cut().bytes(),
      );

      const sink = new FakeSink();
      const result = await runAgentOnce({ tx, cfg, agentId, transport: sink });

      expect(sink.written).toEqual([{ printerId, bytes: esc().text("Table 4").cut().bytes() }]);
      expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      const row = await jobRow(tx, jobId);
      expect(row.status).toBe("done");
      expect(row.deliveredAt).not.toBeNull();
    });
  });

  it("isolates a down printer: it fails that job (attempts++) without blocking another printer's job", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const down = await createPrinter(tx, cfg, {
        name: "Down",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.1",
      });
      const up = await createPrinter(tx, cfg, {
        name: "Up",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.2",
      });
      const { jobId: downJob } = await enqueuePrintJob(tx, cfg, down.id, new Uint8Array([1]));
      const { jobId: upJob } = await enqueuePrintJob(tx, cfg, up.id, new Uint8Array([2]));

      const sink = new FlakySink(down.id);
      const result = await runAgentOnce({ tx, cfg, agentId, transport: sink });

      expect(result).toEqual({ claimed: 2, delivered: 1, failed: 1 });
      // The up printer's job still printed — the down printer never blocked its queue.
      expect(sink.written).toEqual([{ printerId: up.id, bytes: new Uint8Array([2]) }]);
      expect((await jobRow(tx, upJob)).status).toBe("done");
      // The down printer's job is failed, attempts bumped, last_error captured.
      const failed = await jobRow(tx, downJob);
      expect(failed.status).toBe("failed");
      expect(failed.attempts).toBe(1);
      expect(failed.lastError).toBe("printer offline");
      expect(failed.deliveredAt).toBeNull();
    });
  });

  it("records a non-Error push rejection as its stringified form in last_error", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const printerId = await seedPrinter(tx, cfg, agentId);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([1]));
      // A transport that rejects with a bare string, not an Error — the non-Error branch of the
      // report path (String(error)), so last_error is still a readable message.
      const rejecting: Transport = { send: () => Promise.reject("drawer jammed") };
      const result = await runAgentOnce({ tx, cfg, agentId, transport: rejecting });
      expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
      const row = await jobRow(tx, jobId);
      expect(row.status).toBe("failed");
      expect(row.lastError).toBe("drawer jammed");
    });
  });

  it("retries a failed job on a later run, up to the attempt cap", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const printerId = await seedPrinter(tx, cfg, agentId);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([7]));

      // Run 1: the printer is down → failed, attempts 1.
      await runAgentOnce({ tx, cfg, agentId, transport: new FlakySink(printerId) });
      expect(await jobRow(tx, jobId).then((r) => r.status)).toBe("failed");
      expect(await jobRow(tx, jobId).then((r) => r.attempts)).toBe(1);

      // Run 2: the printer recovers → the failed job is re-claimed and delivered.
      const sink = new FakeSink();
      const result = await runAgentOnce({ tx, cfg, agentId, transport: sink });
      expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      expect(sink.written).toEqual([{ printerId, bytes: new Uint8Array([7]) }]);
      expect((await jobRow(tx, jobId)).status).toBe("done");
    });
  });

  it("stops retrying once a job has reached the attempt cap (bounded)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const printerId = await seedPrinter(tx, cfg, agentId);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([9]));
      // Drive the job straight to the cap so it is no longer claimable.
      await tx
        .update(printJobs)
        .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(printJobs.id, jobId));

      const sink = new FakeSink();
      const result = await runAgentOnce({ tx, cfg, agentId, transport: sink });
      expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
      expect(sink.written).toEqual([]);
      expect((await jobRow(tx, jobId)).status).toBe("failed"); // still failed — not re-claimed
    });
  });

  it("pulls ONLY the calling agent's own printers' jobs (authorization scope)", async () => {
    const cfg = await setup();
    const mine = await seedAgent(cfg, "Mine");
    const other = await seedAgent(cfg, "Other");
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const otherPrinter = await seedPrinter(tx, cfg, other);
      const { jobId } = await enqueuePrintJob(tx, cfg, otherPrinter, new Uint8Array([1]));

      // MY runtime must see nothing — the job belongs to another agent's printer.
      const sink = new FakeSink();
      const result = await runAgentOnce({ tx, cfg, agentId: mine, transport: sink });
      expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
      expect(sink.written).toEqual([]);
      expect((await jobRow(tx, jobId)).status).toBe("queued"); // untouched, still the other agent's
    });
  });

  it("reports an empty batch when the agent has no queued work", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      await seedPrinter(tx, cfg, agentId); // a printer, but no jobs
      const sink = new FakeSink();
      expect(await runAgentOnce({ tx, cfg, agentId, transport: sink })).toEqual({
        claimed: 0,
        delivered: 0,
        failed: 0,
      });
      expect(sink.written).toEqual([]);
    });
  });
});
