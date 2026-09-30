import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_UNPAIRED,
  PRINT_JOB_LEASE_MS,
  PULL_BATCH_LIMIT,
  claimPrintJobs,
  endUnpairedPrinterJobs,
} from "./runtime.js";
import { createPrinter, deactivatePrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const MAC = "5A:4A:45:D4:FB:BB";

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return { locationId: row!.id };
}

async function seedAgent(cfg: PrintConfig, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId: cfg.locationId, name, tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

async function jobRow(jobId: string) {
  const [row] = await suite.db
    .select({
      status: printJobs.status,
      attempts: printJobs.attempts,
      lastError: printJobs.lastError,
      claimedBy: printJobs.claimedBy,
      claimedAt: printJobs.claimedAt,
    })
    .from(printJobs)
    .where(eq(printJobs.id, jobId));
  return row!;
}

async function printer(
  cfg: PrintConfig,
  localKey = MAC,
  transport: "bluetooth" | "usb" = "bluetooth",
): Promise<string> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    return (await createPrinter(tx, cfg, { name: localKey, transport, localKey })).id;
  });
}

async function job(
  cfg: PrintConfig,
  printerId: string,
  kind: "document" | "drawer" = "document",
): Promise<string> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    return (await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([0x41]), kind)).jobId;
  });
}

function end(agentId: string, addresses: string[]): Promise<string[]> {
  return withTransaction(suite.db, (tx) => endUnpairedPrinterJobs(tx, agentId, addresses));
}

const ENDED = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: PRINTER_UNPAIRED };

describe("endUnpairedPrinterJobs", () => {
  it("ends every waiting job of the unpaired printer, and this agent's own claims, failed with no attempts left", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const printerId = await printer(cfg);
    const queued = await job(cfg, printerId);
    const failedUnderCap = await job(cfg, printerId);
    const lapsed = await job(cfg, printerId);
    const unstamped = await job(cfg, printerId);
    const ownLive = await job(cfg, printerId);
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: 2, lastError: "device gone" })
      .where(eq(printJobs.id, failedUnderCap));
    await suite.db
      .update(printJobs)
      .set({
        status: "printing",
        claimedAt: new Date(Date.now() - PRINT_JOB_LEASE_MS - 1_000).toISOString(),
      })
      .where(eq(printJobs.id, lapsed));
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedAt: null })
      .where(eq(printJobs.id, unstamped));
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedBy: agentId, claimedAt: new Date().toISOString() })
      .where(eq(printJobs.id, ownLive));
    const all = [queued, failedUnderCap, lapsed, unstamped, ownLive];

    const ended = await end(agentId, [MAC]);

    expect(ended.sort()).toEqual([...all].sort());
    for (const jobId of all) {
      expect(await jobRow(jobId)).toMatchObject({ ...ENDED, claimedBy: agentId });
    }
    // Final: an agent that can print to the address again claims none of them.
    expect(
      await withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [MAC] }),
      ),
    ).toEqual([]);
  });

  it("leaves another agent's live claim, printed jobs, jobs already given up, and other printers' jobs", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const otherAgent = await seedAgent(cfg, "Other box");
    const printerId = await printer(cfg);
    const othersLive = await job(cfg, printerId);
    const done = await job(cfg, printerId);
    const givenUp = await job(cfg, printerId);
    const otherAddress = await job(cfg, await printer(cfg, "11:22:33:44:55:66"));
    // A USB printer whose key is given as an address is not a Bluetooth printer.
    const usb = await job(cfg, await printer(cfg, "BB:BB:BB:BB:BB:BB", "usb"));
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedBy: otherAgent, claimedAt: new Date().toISOString() })
      .where(eq(printJobs.id, othersLive));
    await suite.db.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, done));
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: "device gone" })
      .where(eq(printJobs.id, givenUp));
    const untouched = [othersLive, done, givenUp, otherAddress, usb];
    const before = await Promise.all(untouched.map(jobRow));

    const ended = await end(agentId, [MAC, "BB:BB:BB:BB:BB:BB"]);

    expect(ended).toEqual([]);
    expect(await Promise.all(untouched.map(jobRow))).toEqual(before);
    expect((await jobRow(givenUp)).lastError).toBe("device gone");
  });

  // A drawer kick left waiting would open the cash drawer when the printer is added again; its
  // `drawer_opens` audit row carries no job id, so ending the kick leaves the audit unchanged.
  it("ends a waiting drawer kick", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const kick = await job(cfg, await printer(cfg), "drawer");

    expect(await end(agentId, [MAC])).toEqual([kick]);
    expect(await jobRow(kick)).toMatchObject(ENDED);
  });

  it("ends the jobs of a printer already switched off", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const jobId = await withTransaction(suite.db, async (tx: Transaction) => {
      const created = await createPrinter(tx, cfg, {
        name: "Off",
        transport: "bluetooth",
        localKey: MAC,
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, created.id, new Uint8Array([0x41]));
      await deactivatePrinter(tx, cfg, created.id);
      return jobId;
    });

    expect(await end(agentId, [MAC])).toEqual([jobId]);
    expect(await jobRow(jobId)).toMatchObject(ENDED);
  });

  it("ends more waiting jobs than one pull claims, in one call", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const printerId = await printer(cfg);
    const jobs: string[] = [];
    for (let i = 0; i <= PULL_BATCH_LIMIT; i++) jobs.push(await job(cfg, printerId));

    const ended = await end(agentId, [MAC]);

    expect(ended.sort()).toEqual([...jobs].sort());
  });

  it("changes nothing when no address is given", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const jobId = await job(cfg, await printer(cfg));

    expect(await end(agentId, [])).toEqual([]);
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 0, lastError: null });
  });
});
