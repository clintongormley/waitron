import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  locations,
  printAgents,
  printJobs,
  printers,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  PRINT_JOB_LEASE_MS,
  PULL_BATCH_LIMIT,
  claimPrintJobs,
  endUnpairedPrinterJobs,
  failUnprintableBluetoothJobs,
  reportPrintJob,
} from "./runtime.js";
import {
  PRINTER_DELETED,
  endDeletedPrinterJobs,
  readPrinterDeleteJobIds,
} from "./printer-delete-jobs.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const USB_KEY = "USB-SERIAL-1";
const MAC = "5A:4A:45:D4:FB:BB";
const NOW = new Date();
const FRESH = NOW.toISOString();
const EXPIRED = new Date(NOW.getTime() - PRINT_JOB_LEASE_MS - 1_000).toISOString();
const DELETED_AT = "2026-10-10T09:00:00.000Z";

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

async function printer(
  cfg: PrintConfig,
  localKey = USB_KEY,
  transport: "usb" | "bluetooth" = "usb",
): Promise<string> {
  return withTransaction(
    suite.db,
    async (tx) => (await createPrinter(tx, cfg, { name: localKey, transport, localKey })).id,
  );
}

async function job(
  cfg: PrintConfig,
  printerId: string,
  kind: "document" | "drawer" = "document",
): Promise<string> {
  return withTransaction(
    suite.db,
    async (tx) => (await enqueuePrintJob(tx, cfg, printerId, new Uint8Array([0x41]), kind)).jobId,
  );
}

async function setJob(jobId: string, values: Partial<typeof printJobs.$inferInsert>) {
  await suite.db.update(printJobs).set(values).where(eq(printJobs.id, jobId));
}

async function rows(jobIds: string[]) {
  const all = await suite.db.select().from(printJobs).where(inArray(printJobs.id, jobIds));
  return Object.fromEntries(all.map((row) => [row.id, row]));
}

/** What the delete does before its own route exists: end the jobs and switch the row off, together. */
async function deletePrinterRow(printerId: string): Promise<string[]> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    const ended = await endDeletedPrinterJobs(tx, printerId);
    await tx
      .update(printers)
      .set({ active: false, deletedAt: DELETED_AT })
      .where(eq(printers.id, printerId));
    return ended;
  });
}

const ENDED = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: PRINTER_DELETED };

describe("endDeletedPrinterJobs", () => {
  it("ends every live job of the printer, whoever claimed it and however old the claim, and leaves finished jobs as they were", async () => {
    const cfg = await setup();
    const agent = await seedAgent(cfg, "Box");
    const other = await seedAgent(cfg, "Other box");
    const printerId = await printer(cfg);
    const keptPrinter = await printer(cfg, "USB-SERIAL-2");

    const queued = await job(cfg, printerId);
    const queuedDrawer = await job(cfg, printerId, "drawer");
    const freshLease = await job(cfg, printerId);
    const expiredLease = await job(cfg, printerId);
    const nullLease = await job(cfg, printerId);
    const otherAgentLease = await job(cfg, printerId, "drawer");
    const failedNone = await job(cfg, printerId);
    const failedFour = await job(cfg, printerId, "drawer");
    const exhausted = await job(cfg, printerId);
    const done = await job(cfg, printerId);
    const doneDrawer = await job(cfg, printerId, "drawer");
    const keptQueued = await job(cfg, keptPrinter);
    await setJob(freshLease, { status: "printing", claimedBy: agent, claimedAt: FRESH });
    await setJob(expiredLease, { status: "printing", claimedBy: agent, claimedAt: EXPIRED });
    await setJob(nullLease, { status: "printing", claimedBy: null, claimedAt: null });
    await setJob(otherAgentLease, { status: "printing", claimedBy: other, claimedAt: FRESH });
    await setJob(failedNone, { status: "failed", attempts: 0, lastError: "paper" });
    await setJob(failedFour, {
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS - 1,
      lastError: "paper",
      claimedBy: agent,
      claimedAt: EXPIRED,
    });
    await setJob(exhausted, {
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      lastError: "paper",
    });
    await setJob(done, { status: "done", deliveredAt: FRESH, claimedBy: agent, claimedAt: FRESH });
    await setJob(doneDrawer, { status: "done", deliveredAt: FRESH });

    const live = [
      queued,
      queuedDrawer,
      freshLease,
      expiredLease,
      nullLease,
      otherAgentLease,
      failedNone,
      failedFour,
    ];
    const finished = [exhausted, done, doneDrawer, keptQueued];
    const before = await rows([...live, ...finished]);

    const read = await withTransaction(suite.db, (tx) => readPrinterDeleteJobIds(tx, printerId));
    expect([...read].sort()).toEqual([...live].sort());

    const ended = await deletePrinterRow(printerId);

    expect([...ended].sort()).toEqual([...live].sort());
    const after = await rows([...live, ...finished]);
    for (const id of live) {
      // Claim identity and time stay as the facts they were; only the outcome changes.
      expect(after[id]).toEqual({ ...before[id], ...ENDED });
    }
    for (const id of finished) expect(after[id]).toEqual(before[id]);
    expect(await withTransaction(suite.db, (tx) => readPrinterDeleteJobIds(tx, printerId))).toEqual(
      [],
    );
  });

  it("ends more jobs than one pull's batch in one call", async () => {
    const cfg = await setup();
    const printerId = await printer(cfg);
    const queued: string[] = [];
    for (let i = 0; i < PULL_BATCH_LIMIT + 5; i += 1) queued.push(await job(cfg, printerId));

    const ended = await deletePrinterRow(printerId);

    expect([...ended].sort()).toEqual([...queued].sort());
    const after = await rows(queued);
    for (const id of queued) expect(after[id]).toMatchObject(ENDED);
  });
});

describe("a deleted printer's late work", () => {
  it("refuses every late report on an ended job, and a live printer's job is claimed and reported as usual", async () => {
    const cfg = await setup();
    const agent = await seedAgent(cfg, "Box");
    const other = await seedAgent(cfg, "Other box");
    const printerId = await printer(cfg);
    const livePrinter = await printer(cfg, "USB-SERIAL-2");
    const deletedJob = await job(cfg, printerId);
    const liveJob = await job(cfg, livePrinter);

    const claimed = await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, agent, { locationId: cfg.locationId, visibleKeys: [USB_KEY] }),
    );
    expect(claimed.map((row) => row.id)).toEqual([deletedJob]);
    await deletePrinterRow(printerId);
    const ended = (await rows([deletedJob]))[deletedJob];
    expect(ended).toMatchObject({ ...ENDED, claimedBy: agent });

    for (const outcome of [{ status: "done" }, { status: "failed", error: "paper" }] as const) {
      for (const agentId of [agent, other]) {
        expect(
          await withTransaction(suite.db, (tx) =>
            reportPrintJob(tx, { agentId, jobId: deletedJob, outcome }),
          ),
        ).toEqual({ updated: false });
      }
    }
    expect((await rows([deletedJob]))[deletedJob]).toEqual(ended);

    const live = await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, agent, {
        locationId: cfg.locationId,
        visibleKeys: [USB_KEY, "USB-SERIAL-2"],
      }),
    );
    expect(live.map((row) => row.id)).toEqual([liveJob]);
    expect(
      await withTransaction(suite.db, (tx) =>
        reportPrintJob(tx, { agentId: agent, jobId: liveJob, outcome: { status: "done" } }),
      ),
    ).toEqual({ updated: true });
    expect((await rows([liveJob]))[liveJob]).toMatchObject({ status: "done", claimedBy: agent });
  });

  it("hands out only the new registration's jobs once the same device key is added again, and an old report touches neither", async () => {
    const cfg = await setup();
    const agent = await seedAgent(cfg, "Box");
    const oldPrinter = await printer(cfg);
    const oldJob = await job(cfg, oldPrinter);
    await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, agent, { locationId: cfg.locationId, visibleKeys: [USB_KEY] }),
    );
    await deletePrinterRow(oldPrinter);
    const newPrinter = await printer(cfg);
    expect(newPrinter).not.toBe(oldPrinter);
    const newJob = await job(cfg, newPrinter);

    const pulled = await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, agent, { locationId: cfg.locationId, visibleKeys: [USB_KEY] }),
    );
    expect(pulled.map((row) => [row.id, row.printer_id])).toEqual([[newJob, newPrinter]]);

    const before = await rows([oldJob, newJob]);
    expect(
      await withTransaction(suite.db, (tx) =>
        reportPrintJob(tx, { agentId: agent, jobId: oldJob, outcome: { status: "done" } }),
      ),
    ).toEqual({ updated: false });
    expect(await rows([oldJob, newJob])).toEqual(before);
  });

  it("never claims a deleted printer's job, even one left waiting on a row still marked active", async () => {
    const cfg = await setup();
    const agent = await seedAgent(cfg, "Box");
    const printerId = await printer(cfg);
    await deletePrinterRow(printerId);
    // Neither state is one the delete leaves; each isolates the deleted-row predicate.
    await suite.db.update(printers).set({ active: true }).where(eq(printers.id, printerId));
    const [seeded] = await suite.db
      .insert(printJobs)
      .values({ locationId: cfg.locationId, printerId, payload: new Uint8Array([0x41]) })
      .returning({ id: printJobs.id });

    expect(
      await withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, agent, { locationId: cfg.locationId, visibleKeys: [USB_KEY] }),
      ),
    ).toEqual([]);
    expect((await rows([seeded!.id]))[seeded!.id]).toMatchObject({ status: "queued" });
  });

  it("leaves a deleted Bluetooth printer's jobs alone when its address is reported unprintable or unpaired", async () => {
    const cfg = await setup();
    const agent = await seedAgent(cfg, "Box");
    const oldPrinter = await printer(cfg, MAC, "bluetooth");
    await deletePrinterRow(oldPrinter);
    await suite.db.update(printers).set({ active: true }).where(eq(printers.id, oldPrinter));
    const [seeded] = await suite.db
      .insert(printJobs)
      .values({
        locationId: cfg.locationId,
        printerId: oldPrinter,
        payload: new Uint8Array([0x41]),
      })
      .returning({ id: printJobs.id });
    const newPrinter = await printer(cfg, MAC, "bluetooth");
    const unprintable = await job(cfg, newPrinter);
    const before = await rows([seeded!.id]);

    expect(
      await withTransaction(suite.db, (tx) => failUnprintableBluetoothJobs(tx, agent, [MAC])),
    ).toEqual([unprintable]);
    const unpaired = await job(cfg, newPrinter);
    expect(
      await withTransaction(suite.db, (tx) => endUnpairedPrinterJobs(tx, agent, [MAC])),
    ).toEqual([unpaired]);
    expect(await rows([seeded!.id])).toEqual(before);
  });
});
