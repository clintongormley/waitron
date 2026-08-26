import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, printJobs, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";
import "./errors.js";

// PGlite is the right target here: `enqueuePrintJob` is a single INSERT plus a not_found pre-check
// SELECT — no concurrency, no deployment-role privilege behaviour (both proven on real Postgres in
// Task 1/3: packages/db printing.rls.test.ts + agent.test.ts). The load-bearing assertion is the
// NEVER-BLOCK invariant (CLAUDE.md §5 / design §5): enqueue opens NO socket. PGlite is in-process
// WASM, so the DB access itself opens no socket either — which makes "Socket.prototype.connect was
// never called" a clean structural proof rather than one muddied by driver traffic.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(): Promise<PrintConfig> {
  const tenantId = await seedTenant(suite.db);
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Bar', array['es-ES'], 'Sale on premises') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

async function seedAgent(cfg: PrintConfig): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${cfg.tenantId}, ${cfg.locationId}, 'Kitchen agent', 'scrypt$fixture') returning id`);
  return rows[0]!.id;
}

/** Read one job row back (the brief's `jobRow`). Uses the drizzle `printJobs` model so `payload`
 * decodes through the bytea customType to a Buffer. */
async function jobRow(
  tx: Transaction,
  jobId: string,
): Promise<{ status: string; payload: Buffer }> {
  const [row] = await tx
    .select({ status: printJobs.status, payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!;
}

/**
 * Spy the SINGLE chokepoint every outbound TCP open funnels through. `net.connect` and
 * `net.createConnection` each construct a `net.Socket` and call `.connect()` on it, so one spy on
 * `Socket.prototype.connect` proves no socket was opened by ANY of the three entry points a
 * network_tcp transport could use. Restored in `afterEach` via `vi.restoreAllMocks()`.
 */
function spyOnNoSocketOpened() {
  // `Socket.prototype.connect` is overloaded, which `vi.spyOn` cannot type directly; cast to a single
  // call signature. The cast is type-level ONLY — the runtime target is still the real prototype, so
  // the spy replaces the method every outbound TCP open funnels through.
  return vi.spyOn(
    net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown },
    "connect",
  );
}

describe("enqueuePrintJob (never-block outbox)", () => {
  it("enqueues a queued job with no socket I/O", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.9",
        port: 9100,
      });
      const noNet = spyOnNoSocketOpened(); // assert node:net never opened a socket
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([1, 2, 3]));

      const row = await jobRow(tx, jobId);
      expect(row.status).toBe("queued");
      expect([...row.payload]).toEqual([1, 2, 3]); // the opaque bytes round-trip verbatim
      expect(noNet).not.toHaveBeenCalled(); // the never-block invariant
    });
  });

  it("throws printer.not_found for an absent printer, still opening no socket", async () => {
    const cfg = await setup();
    const noNet = spyOnNoSocketOpened();
    const code = await withTenant(suite.db, cfg.tenantId, async (tx) => {
      try {
        // A well-formed uuid that names no printer: the DB-only pre-check SELECT finds nothing and
        // throws BEFORE any insert, so the caller's transaction is never poisoned.
        await enqueuePrintJob(tx, cfg, randomUUID(), new Uint8Array([9]));
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    expect(code).toBe("printer.not_found");
    expect(noNet).not.toHaveBeenCalled();
  });
});
