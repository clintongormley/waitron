import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  BLUETOOTH_PRINTING_UNAVAILABLE,
  MAX_DELIVERY_ATTEMPTS,
  PRINT_JOB_LEASE_MS,
  claimPrintJobs,
  failUnprintableBluetoothJobs,
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

async function bluetoothPrinter(cfg: PrintConfig, localKey = MAC): Promise<string> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    return (await createPrinter(tx, cfg, { name: localKey, transport: "bluetooth", localKey })).id;
  });
}

async function job(cfg: PrintConfig, printerId: string): Promise<string> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    return (await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([0x41]))).jobId;
  });
}

describe("failUnprintableBluetoothJobs", () => {
  it("ends a queued job of a Bluetooth printer at the given address failed, with its reason and no attempts left", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const jobId = await job(cfg, await bluetoothPrinter(cfg));

    const ended = await withTransaction(suite.db, (tx) =>
      failUnprintableBluetoothJobs(tx, agentId, [MAC]),
    );

    expect(ended).toEqual([jobId]);
    expect(await jobRow(jobId)).toMatchObject({
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      lastError: BLUETOOTH_PRINTING_UNAVAILABLE,
      claimedBy: agentId,
    });
    // Final: an agent that later can print to it does not claim it again.
    expect(
      await withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [MAC] }),
      ),
    ).toEqual([]);
  });

  it("ends a failed job with attempts left, and a printing job whose claim has lapsed", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const printerId = await bluetoothPrinter(cfg);
    const failedJob = await job(cfg, printerId);
    const lapsedJob = await job(cfg, printerId);
    const lapsed = new Date(Date.now() - PRINT_JOB_LEASE_MS - 1_000).toISOString();
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: 2, lastError: "device gone" })
      .where(eq(printJobs.id, failedJob));
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedAt: lapsed })
      .where(eq(printJobs.id, lapsedJob));

    const ended = await withTransaction(suite.db, (tx) =>
      failUnprintableBluetoothJobs(tx, agentId, [MAC]),
    );

    expect(ended.sort()).toEqual([failedJob, lapsedJob].sort());
    for (const jobId of [failedJob, lapsedJob]) {
      expect(await jobRow(jobId)).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
        lastError: BLUETOOTH_PRINTING_UNAVAILABLE,
      });
    }
  });

  it("leaves every job that is not a due job of an active Bluetooth printer at the given address", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const otherAddress = await job(cfg, await bluetoothPrinter(cfg, "11:22:33:44:55:66"));
    const inactive = await withTransaction(suite.db, async (tx: Transaction) => {
      const printer = await createPrinter(tx, cfg, {
        name: "Off",
        transport: "bluetooth",
        localKey: "AA:AA:AA:AA:AA:AA",
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([0x41]));
      await deactivatePrinter(tx, cfg, printer.id);
      return jobId;
    });
    // A USB printer whose key is given as an address is not a Bluetooth printer.
    const usb = await withTransaction(suite.db, async (tx: Transaction) => {
      const printer = await createPrinter(tx, cfg, {
        name: "USB",
        transport: "usb",
        localKey: "BB:BB:BB:BB:BB:BB",
      });
      return (await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([0x41]))).jobId;
    });
    const printerId = await bluetoothPrinter(cfg);
    const done = await job(cfg, printerId);
    const exhausted = await job(cfg, printerId);
    const live = await job(cfg, printerId);
    await suite.db.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, done));
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: "device gone" })
      .where(eq(printJobs.id, exhausted));
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedAt: new Date().toISOString() })
      .where(eq(printJobs.id, live));
    const before = await Promise.all(
      [otherAddress, inactive, usb, done, exhausted, live].map(jobRow),
    );

    const ended = await withTransaction(suite.db, (tx) =>
      failUnprintableBluetoothJobs(tx, agentId, [MAC, "AA:AA:AA:AA:AA:AA", "BB:BB:BB:BB:BB:BB"]),
    );

    expect(ended).toEqual([]);
    expect(
      await Promise.all([otherAddress, inactive, usb, done, exhausted, live].map(jobRow)),
    ).toEqual(before);
  });

  it("changes nothing when no address is given", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Box");
    const jobId = await job(cfg, await bluetoothPrinter(cfg));

    expect(
      await withTransaction(suite.db, (tx) => failUnprintableBluetoothJobs(tx, agentId, [])),
    ).toEqual([]);
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 0, lastError: null });
  });
});
