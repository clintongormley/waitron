import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  locations,
  printAgents,
  printers,
  printJobs,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { claimPrintJobs } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
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

async function jobStatus(jobId: string): Promise<string> {
  const [row] = await suite.db
    .select({ status: printJobs.status })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!.status;
}

/** Through the table so drizzle's `flag` mapping converts the JavaScript boolean to the 0 the
 * driver can bind; `node:sqlite` refuses a bound `false` outright. */
async function deactivate(printerId: string): Promise<void> {
  await suite.db.update(printers).set({ active: false }).where(eq(printers.id, printerId));
}

describe("claimPrintJobs respects printers.active", () => {
  it("does NOT claim a queued job for a DEACTIVATED printer, but DOES for an active one", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);

    // Both jobs are enqueued while ACTIVE (enqueue itself rejects an inactive printer), then one
    // printer is deactivated.
    const seeded = await withTransaction(suite.db, async (tx: Transaction) => {
      const active = await createPrinter(tx, cfg, {
        name: "Active",
        transport: "network_tcp",
        host: "10.0.0.1",
      });
      const dead = await createPrinter(tx, cfg, {
        name: "Dead",
        transport: "network_tcp",
        host: "10.0.0.2",
      });
      const { jobId: activeJobId } = await enqueuePrintJob(tx, cfg, active.id, new Uint8Array([1]));
      const { jobId: deadJobId } = await enqueuePrintJob(tx, cfg, dead.id, new Uint8Array([2]));
      return { dead: dead.id, activeJobId, deadJobId };
    });
    await deactivate(seeded.dead);

    const claimed = await withTransaction(suite.db, (tx: Transaction) =>
      claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
    );

    expect(claimed.map((j) => j.id)).toEqual([seeded.activeJobId]);
    expect(await jobStatus(seeded.activeJobId)).toBe("printing");
    expect(await jobStatus(seeded.deadJobId)).toBe("queued");
  });

  it("does NOT lease-reclaim a stuck printing job for a DEACTIVATED printer", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);

    const jobId = await withTransaction(suite.db, async (tx: Transaction) => {
      const p = await createPrinter(tx, cfg, {
        name: "Kitchen",
        transport: "network_tcp",
        host: "10.0.0.9",
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([0x41]));
      return jobId;
    });

    // The agent CLAIMS the job (queued → printing, claimed_at stamped) in its own committed transaction,
    // then "dies": the row is left committed in `printing`.
    const claimed = await withTransaction(suite.db, (tx: Transaction) =>
      claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
    );
    expect(claimed).toHaveLength(1);
    const printerId = claimed[0]!.printer_id;

    // Age the claim well past the lease (a dropped claim the pull would normally reclaim) AND deactivate
    // the printer. `claimPrintJobs` compares `claimed_at` as a STRING against a cutoff in the ISO-8601
    // spelling `nowIso` produces, so the aged value is written in that spelling.
    await suite.db
      .update(printJobs)
      .set({ claimedAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(printJobs.id, jobId));
    await deactivate(printerId);

    const reclaimed = await withTransaction(suite.db, (tx: Transaction) =>
      claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
    );
    expect(reclaimed).toEqual([]);
    expect(await jobStatus(jobId)).toBe("printing");
  });
});
