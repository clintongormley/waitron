import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { esc } from "./escpos.js";
import {
  claimPrintJobs,
  MAX_DELIVERY_ATTEMPTS,
  PRINT_JOB_LEASE_MS,
  runAgentOnce,
} from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { FakeSink } from "@waitron/print-agent";
import type { PrinterTarget, Transport } from "@waitron/print-agent";
import type { PrintConfig } from "./printers.js";

// PGlite is the right target for the runtime's LOGIC — the happy pull→push→report path, per-printer
// failure isolation, the retry cap, and the venue-scope filter — none of which depend on concurrency
// or the deployment role. The one property PGlite CANNOT show is the double-pull race (it serialises
// every query onto one backend, so two agents never truly contend): that lives in runtime.race.test.ts
// against real Postgres (CLAUDE.md §4).
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/** Insert one venue. Through the table definition rather than raw SQL: `locations.id` and
 * `print_agents.id` are supplied by `$defaultFn(newId)` in JavaScript, so a raw INSERT that names
 * no id is refused `NOT NULL constraint failed: locations.id`. */
async function seedLocation(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name, invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return row!.id;
}

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
  return { locationId: await seedLocation("Bar") };
}

async function seedAgent(cfg: PrintConfig, name = "Kitchen agent"): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId: cfg.locationId, name, tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

async function seedPrinter(tx: Transaction, cfg: PrintConfig): Promise<string> {
  const { id } = await createPrinter(tx, cfg, {
    name: "Kitchen",
    transport: "network_tcp",
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
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId } = await enqueuePrintJob(
        tx,
        cfg,
        printerId,
        esc().text("Table 4").cut().bytes(),
      );

      const sink = new FakeSink();
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      });

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
    await withTransaction(suite.db, async (tx) => {
      const down = await createPrinter(tx, cfg, {
        name: "Down",
        transport: "network_tcp",
        host: "10.0.0.1",
      });
      const up = await createPrinter(tx, cfg, {
        name: "Up",
        transport: "network_tcp",
        host: "10.0.0.2",
      });
      const { jobId: downJob } = await enqueuePrintJob(tx, cfg, down.id, new Uint8Array([1]));
      const { jobId: upJob } = await enqueuePrintJob(tx, cfg, up.id, new Uint8Array([2]));

      const sink = new FlakySink(down.id);
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      });

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
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([1]));
      // A transport that rejects with a bare string, not an Error — the non-Error branch of the
      // report path (String(error)), so last_error is still a readable message.
      const rejecting: Transport = { send: () => Promise.reject("drawer jammed") };
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: rejecting,
      });
      expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
      const row = await jobRow(tx, jobId);
      expect(row.status).toBe("failed");
      expect(row.lastError).toBe("drawer jammed");
    });
  });

  it("retries a failed job on a later run, up to the attempt cap", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([7]));

      // Run 1: the printer is down → failed, attempts 1.
      await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: new FlakySink(printerId),
      });
      expect(await jobRow(tx, jobId).then((r) => r.status)).toBe("failed");
      expect(await jobRow(tx, jobId).then((r) => r.attempts)).toBe(1);

      // Run 2: the printer recovers → the failed job is re-claimed and delivered.
      const sink = new FakeSink();
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      });
      expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      expect(sink.written).toEqual([{ printerId, bytes: new Uint8Array([7]) }]);
      expect((await jobRow(tx, jobId)).status).toBe("done");
    });
  });

  // The lease cutoff is now a bound ISO-8601 string compared against `claimed_at`, not the
  // database's `now()` minus an interval, so BOTH directions of the comparison are pinned here: the
  // side that must still be claimed and the side that must not. A cutoff that is wrong in either
  // direction moves exactly one of these two expectations.
  it("reclaims a claim whose lease has EXPIRED and leaves one still INSIDE the lease alone", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const deadAgentId = await seedAgent(cfg, "Crashed agent");
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId: live } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([1]));
      const { jobId: stale } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([2]));
      // Both rows sit in `printing`, claimed by ANOTHER agent. One second either side of the lease,
      // so the two cases differ only in which side of the cutoff they fall.
      const claimedAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
      const held = { status: "printing" as const, claimedBy: deadAgentId };
      await tx
        .update(printJobs)
        .set({ ...held, claimedAt: claimedAgo(PRINT_JOB_LEASE_MS - 1_000) })
        .where(eq(printJobs.id, live));
      await tx
        .update(printJobs)
        .set({ ...held, claimedAt: claimedAgo(PRINT_JOB_LEASE_MS + 1_000) })
        .where(eq(printJobs.id, stale));

      const sink = new FakeSink();
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      });

      // OUTSIDE the lease — reclaimed and delivered.
      expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
      expect(sink.written).toEqual([{ printerId, bytes: new Uint8Array([2]) }]);
      expect((await jobRow(tx, stale)).status).toBe("done");
      // INSIDE the lease — still held by the agent that claimed it, not reprinted.
      expect((await jobRow(tx, live)).status).toBe("printing");
      expect((await jobRow(tx, live)).deliveredAt).toBeNull();
    });
  });

  // The other half of the lease: the cutoff can only be compared against what the claim WROTE, and
  // `claimed_at` is a text column, so a stamp in any spelling other than the cutoff's sorts against
  // it as plain characters. A `datetime('now')` stamp ('2026-09-22 08:00:00') sorts BEFORE every
  // 'T'-separated cutoff, so a job claimed a moment ago would read as lease-expired and be reprinted
  // on the very next batch. This case is what notices; the lease case above does not, because it
  // writes `claimed_at` itself.
  it("does not re-claim a job it claimed moments ago (the stamp is in the cutoff's own spelling)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([3]));

      // Claim WITHOUT reporting — the job is left `printing`, holding the stamp the claim wrote.
      const claimed = await claimPrintJobs(tx, agentId, {
        locationId: cfg.locationId,
        visibleKeys: [],
      });
      expect(claimed.map((j) => j.id)).toEqual([jobId]);

      // A second batch must find nothing: the claim is seconds old, well inside the lease.
      const sink = new FakeSink();
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      });
      expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
      expect(sink.written).toEqual([]);
      expect((await jobRow(tx, jobId)).status).toBe("printing");
    });
  });

  it("stops retrying once a job has reached the attempt cap (bounded)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([9]));
      // Drive the job straight to the cap so it is no longer claimable.
      await tx
        .update(printJobs)
        .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(printJobs.id, jobId));

      const sink = new FakeSink();
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: cfg.locationId,
        visibleKeys: [],
        transport: sink,
      });
      expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
      expect(sink.written).toEqual([]);
      expect((await jobRow(tx, jobId)).status).toBe("failed"); // still failed — not re-claimed
    });
  });

  it("does NOT pull a network printer's job for an agent serving a DIFFERENT venue (venue scope)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    // A second venue in the same tenant. Printers carry no agent binding now, so venue membership is
    // what scopes a network printer's job — an agent reporting the OTHER venue must claim nothing.
    const otherLocationId = await seedLocation("Terrace");
    await withTransaction(suite.db, async (tx) => {
      const printerId = await seedPrinter(tx, cfg);
      const { jobId } = await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([1]));

      // The agent serves a different venue, so the network printer's `location_id` conjunct excludes it.
      const sink = new FakeSink();
      const result = await runAgentOnce({
        tx,
        agentId,
        locationId: otherLocationId,
        visibleKeys: [],
        transport: sink,
      });
      expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
      expect(sink.written).toEqual([]);
      expect((await jobRow(tx, jobId)).status).toBe("queued"); // untouched, wrong venue
    });
  });

  it("reports an empty batch when the agent has no queued work", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTransaction(suite.db, async (tx) => {
      await seedPrinter(tx, cfg); // a printer, but no jobs
      const sink = new FakeSink();
      expect(
        await runAgentOnce({
          tx,
          agentId,
          locationId: cfg.locationId,
          visibleKeys: [],
          transport: sink,
        }),
      ).toEqual({
        claimed: 0,
        delivered: 0,
        failed: 0,
      });
      expect(sink.written).toEqual([]);
    });
  });
});
