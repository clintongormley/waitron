import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, printJobs, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { createPrinter, deactivatePrinter } from "./printers.js";
import { enqueuePrintJob, resendPrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";
import "./errors.js";

// PGlite is the right target here: `enqueuePrintJob` is a single INSERT plus a not_found pre-check
// SELECT — no concurrency, and `app_user`'s privileges on the printing tables are pinned by the
// matrix in packages/fiscal-verifactu (the enrol race is agent.test.ts's). The load-bearing assertion is the
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
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
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

  it("throws printer.not_found for a DEACTIVATED printer (disabled, not merely soft-hidden)", async () => {
    // A deactivated printer (`active = false`) is unavailable to the outbox: enqueue treats it exactly
    // like an absent printer (`printer.not_found`), never a new code. The active-printer enqueue in the
    // same block is the control — the ONLY difference between the two calls is the `active` flag, so a
    // pass here means the `active = true` pre-check conjunct (not some unrelated reason) is doing the
    // work. Without that conjunct the deactivated enqueue succeeds and this test goes red.
    const cfg = await setup();
    const code = await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        host: "10.0.0.9",
      });
      // Control: while ACTIVE the printer enqueues a queued job.
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([1]));
      expect((await jobRow(tx, jobId)).status).toBe("queued");

      // Deactivating the SAME printer makes it unavailable to the next enqueue.
      await deactivatePrinter(tx, cfg, p.id);
      try {
        await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([2]));
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    });
    expect(code).toBe("printer.not_found");
  });
});

describe("resendPrintJob", () => {
  it.each(["done", "failed"] as const)(
    "copies a terminal %s job byte-for-byte into a new queue entry",
    async (status) => {
      const cfg = await setup();
      await withTenant(suite.db, cfg.tenantId, async (tx) => {
        const printer = await createPrinter(tx, cfg, {
          name: "Resend",
          transport: "network_tcp",
          host: "printer.local",
        });
        const payload = new Uint8Array([0, 27, 64, 255, 29, 86, 0]);
        const original = await enqueuePrintJob(tx, cfg, printer.id, payload);
        await tx
          .update(printJobs)
          .set({
            status,
            attempts: 5,
            lastError: "paper",
            deliveredAt: status === "done" ? new Date().toISOString() : null,
          })
          .where(eq(printJobs.id, original.jobId));
        const [before] = await tx.select().from(printJobs).where(eq(printJobs.id, original.jobId));
        const otherLocation = await tx.execute<{ id: string }>(
          sql`insert into locations (tenant_id, name, invoice_locales, operation_description) values (${cfg.tenantId}, 'Other', array['es-ES'], 'Sale') returning id`,
        );
        const result = await resendPrintJob(
          tx,
          { ...cfg, locationId: otherLocation.rows[0]!.id },
          original.jobId,
        );
        expect(result.jobId).not.toBe(original.jobId);
        const [copy] = await tx.select().from(printJobs).where(eq(printJobs.id, result.jobId));
        expect(copy).toMatchObject({
          tenantId: cfg.tenantId,
          locationId: cfg.locationId,
          printerId: printer.id,
          status: "queued",
          attempts: 0,
          lastError: null,
          deliveredAt: null,
          claimedAt: null,
          claimedBy: null,
        });
        expect([...copy!.payload]).toEqual([...payload]);
        expect(
          (await tx.select().from(printJobs).where(eq(printJobs.id, original.jobId)))[0],
        ).toEqual(before);
      });
    },
  );

  it.each([
    ["queued", 0],
    ["printing", 0],
    ["failed", 4],
  ] as const)("refuses a %s job that can still print automatically", async (status, attempts) => {
    const cfg = await setup();
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Pending",
        transport: "network_tcp",
        host: "printer.local",
      });
      const original = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]));
      await tx.update(printJobs).set({ status, attempts }).where(eq(printJobs.id, original.jobId));
      await expect(resendPrintJob(tx, cfg, original.jobId)).rejects.toMatchObject({
        code: "print_job.not_resendable",
      });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer.id)),
      ).toHaveLength(1);
    });
  });

  it("refuses unknown and foreign-tenant jobs, and disabled printers", async () => {
    const cfg = await setup();
    const foreign = await setup();
    await withTenant(suite.db, cfg.tenantId, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Disabled",
        transport: "network_tcp",
        host: "printer.local",
      });
      const original = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]));
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, original.jobId));
      await expect(resendPrintJob(tx, cfg, randomUUID())).rejects.toMatchObject({
        code: "print_job.not_found",
      });
      await expect(resendPrintJob(tx, foreign, original.jobId)).rejects.toMatchObject({
        code: "print_job.not_found",
      });
      await deactivatePrinter(tx, cfg, printer.id);
      await expect(resendPrintJob(tx, cfg, original.jobId)).rejects.toMatchObject({
        code: "printer.not_found",
      });
    });
  });
});
