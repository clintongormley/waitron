import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  printJobs,
  sales,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { createPrinter, deactivatePrinter } from "./printers.js";
import { canResendPrintJob, enqueuePrintJob, resendPrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";
import "./errors.js";

// The central assertion is the NEVER-BLOCK invariant (CLAUDE.md §5): enqueue opens NO socket.
// `node:sqlite` reaches the venue file in-process, so the database work inside the spy's window
// opens no socket of its own.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return { locationId: row!.id };
}

async function jobRow(
  tx: Transaction,
  jobId: string,
): Promise<{ status: string; payload: Uint8Array }> {
  const [row] = await tx
    .select({ status: printJobs.status, payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!;
}

/**
 * Spy the SINGLE chokepoint every outbound TCP open funnels through. `net.connect` and
 * `net.createConnection` each construct a `net.Socket` and call `.connect()` on it, so one spy on
 * `Socket.prototype.connect` covers all three entry points a network_tcp transport could use.
 */
function spyOnNoSocketOpened() {
  // `Socket.prototype.connect` is overloaded, which `vi.spyOn` cannot type directly.
  return vi.spyOn(
    net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown },
    "connect",
  );
}

describe("enqueuePrintJob (never-block outbox)", () => {
  it("enqueues a queued job with no socket I/O", async () => {
    const cfg = await setup();
    await withTransaction(suite.db, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        host: "10.0.0.9",
        port: 9100,
      });
      const noNet = spyOnNoSocketOpened();
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([1, 2, 3]));

      const row = await jobRow(tx, jobId);
      expect(row.status).toBe("queued");
      expect([...row.payload]).toEqual([1, 2, 3]);
      expect(noNet).not.toHaveBeenCalled(); // the never-block invariant
    });
  });

  it("throws printer.not_found for an absent printer, still opening no socket", async () => {
    const cfg = await setup();
    const noNet = spyOnNoSocketOpened();
    const code = await withTransaction(suite.db, async (tx) => {
      try {
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
    // The active-printer enqueue in the same block is the control: the ONLY difference between the
    // two calls is the `active` flag.
    const cfg = await setup();
    const code = await withTransaction(suite.db, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        host: "10.0.0.9",
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([1]));
      expect((await jobRow(tx, jobId)).status).toBe("queued");

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
  it.each(["done", "failed"] as const)("refuses a terminal %s drawer command", async (status) => {
    const cfg = await setup();
    await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Drawer",
        transport: "network_tcp",
        host: "printer.local",
      });
      const original = await enqueuePrintJob(
        tx,
        cfg,
        printer.id,
        new Uint8Array([27, 112, 0, 25, 250]),
        "drawer",
      );
      await tx
        .update(printJobs)
        .set({ status, attempts: 5 })
        .where(eq(printJobs.id, original.jobId));
      await expect(resendPrintJob(tx, original.jobId)).rejects.toMatchObject({
        code: "print_job.not_resendable",
      });
      const jobs = await tx.select().from(printJobs).where(eq(printJobs.printerId, printer.id));
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.kind).toBe("drawer");
      expect(canResendPrintJob(jobs[0]!)).toBe(false);
    });
  });

  it.each(["done", "failed"] as const)(
    "copies a terminal %s job byte-for-byte into a new queue entry",
    async (status) => {
      const cfg = await setup();
      await withTransaction(suite.db, async (tx) => {
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
        // The copy goes back to the ORIGINAL job's location, which `resendPrintJob` reads off the
        // job row itself.
        const result = await resendPrintJob(tx, original.jobId);
        expect(result.jobId).not.toBe(original.jobId);
        const [copy] = await tx.select().from(printJobs).where(eq(printJobs.id, result.jobId));
        expect(copy).toMatchObject({
          kind: "document",
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

  it("names the original job a resend copies, and a resend of that resend names the same original", async () => {
    const cfg = await setup();
    await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Resend",
        transport: "network_tcp",
        host: "printer.local",
      });
      const original = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]));
      const exhausted = { status: "failed", attempts: 5 } as const;
      await tx.update(printJobs).set(exhausted).where(eq(printJobs.id, original.jobId));
      const first = await resendPrintJob(tx, original.jobId);
      await tx.update(printJobs).set(exhausted).where(eq(printJobs.id, first.jobId));
      const second = await resendPrintJob(tx, first.jobId);

      const resendOf = async (jobId: string) =>
        (await tx.select().from(printJobs).where(eq(printJobs.id, jobId)))[0]!.resendOf;
      expect(await resendOf(original.jobId)).toBeNull();
      expect(await resendOf(first.jobId)).toBe(original.jobId);
      expect(await resendOf(second.jobId)).toBe(original.jobId);
    });
  });

  it.each([false, true, null] as const)(
    "preserves receiptCopy=%s across two queue resends",
    async (receiptCopy) => {
      const cfg = await setup();
      await withTransaction(suite.db, async (tx) => {
        const printer = await createPrinter(tx, cfg, {
          name: "Receipts",
          transport: "network_tcp",
          host: "printer.local",
        });
        const payload = new Uint8Array([27, 64, 29, 86, 0]);
        const first = await enqueuePrintJob(tx, cfg, printer.id, payload, "document", {
          receiptCopy,
        });
        const exhausted = { status: "failed", attempts: 5 } as const;
        await tx.update(printJobs).set(exhausted).where(eq(printJobs.id, first.jobId));
        const second = await resendPrintJob(tx, first.jobId);
        await tx.update(printJobs).set(exhausted).where(eq(printJobs.id, second.jobId));
        const third = await resendPrintJob(tx, second.jobId);
        for (const { jobId } of [first, second, third]) {
          const [row] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
          expect(row!.receiptCopy).toBe(receiptCopy);
          expect([...row!.payload]).toEqual([...payload]);
        }
        const unrelated = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]));
        const [row] = await tx.select().from(printJobs).where(eq(printJobs.id, unrelated.jobId));
        expect(row!.receiptCopy).toBeNull();
      });
    },
  );

  it("stores the sale a job is enqueued with, and every resend in its chain carries it", async () => {
    const cfg = await setup();
    const nodeId = await seedNode(suite.db, brandLocationId(cfg.locationId));
    const { deviceId } = await seedDevice(suite.db, {
      locationId: brandLocationId(cfg.locationId),
    });
    await withTransaction(suite.db, async (tx) => {
      const [series] = await tx
        .insert(invoiceSeries)
        .values({ nodeId, code: "A" })
        .returning({ id: invoiceSeries.id });
      const [sale] = await tx
        .insert(sales)
        .values({
          source: "device",
          deviceId,
          nodeId,
          seriesId: series!.id,
          invoiceNumber: 1,
          issuedAt: "2026-10-01T12:00:00.000Z",
          issuedOffsetMinutes: 120,
          total: 1000,
          vatBreakdown: [],
          locale: "es",
          invoiceLocales: ["es"],
          fiscalBackend: "fake",
          fiscalState: "not_applicable",
        })
        .returning({ id: sales.id });
      const printer = await createPrinter(tx, cfg, {
        name: "Receipts",
        transport: "network_tcp",
        host: "printer.local",
      });
      const receipt = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]), "document", {
        saleId: sale!.id,
      });
      const unlinked = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([2]));
      const exhausted = { status: "failed", attempts: 5 } as const;
      await tx.update(printJobs).set(exhausted).where(eq(printJobs.id, receipt.jobId));
      const first = await resendPrintJob(tx, receipt.jobId);
      await tx.update(printJobs).set(exhausted).where(eq(printJobs.id, first.jobId));
      const second = await resendPrintJob(tx, first.jobId);

      const saleId = async (jobId: string) =>
        (await tx.select().from(printJobs).where(eq(printJobs.id, jobId)))[0]!.saleId;
      expect(await saleId(receipt.jobId)).toBe(sale!.id);
      expect(await saleId(first.jobId)).toBe(sale!.id);
      expect(await saleId(second.jobId)).toBe(sale!.id);
      expect(await saleId(unlinked.jobId)).toBeNull();
    });
  });

  it.each([
    ["queued", 0],
    ["printing", 0],
    ["failed", 4],
  ] as const)("refuses a %s job that can still print automatically", async (status, attempts) => {
    const cfg = await setup();
    await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Pending",
        transport: "network_tcp",
        host: "printer.local",
      });
      const original = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]));
      await tx.update(printJobs).set({ status, attempts }).where(eq(printJobs.id, original.jobId));
      await expect(resendPrintJob(tx, original.jobId)).rejects.toMatchObject({
        code: "print_job.not_resendable",
      });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer.id)),
      ).toHaveLength(1);
    });
  });

  it("refuses unknown jobs and disabled printers", async () => {
    const cfg = await setup();
    await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Disabled",
        transport: "network_tcp",
        host: "printer.local",
      });
      const original = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]));
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, original.jobId));
      await expect(resendPrintJob(tx, randomUUID())).rejects.toMatchObject({
        code: "print_job.not_found",
      });
      await deactivatePrinter(tx, cfg, printer.id);
      await expect(resendPrintJob(tx, original.jobId)).rejects.toMatchObject({
        code: "printer.not_found",
      });
    });
  });
});
