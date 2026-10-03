import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  printAgents,
  printJobs,
  printers,
  stationPrinters,
  tills,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { enqueuePrintJob, esc } from "@waitron/printing";
import {
  configureDemoPrinter,
  deliverDemoPrinterJobs,
  startDemoPrinterLoop,
} from "./demo-printer.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function venue(): Promise<{ locationId: string; tillId: string }> {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["en-GB"], operationDescription: "Restaurant sale" })
    .returning({ id: locations.id });
  const [till] = await suite.db
    .insert(tills)
    .values({ locationId: location!.id, name: "Counter" })
    .returning({ id: tills.id });
  return { locationId: location!.id, tillId: till!.id };
}

describe("the Demo printer", () => {
  it("delivers its receipt and drawer jobs without claiming an unrelated printer's job", async () => {
    const { locationId, tillId } = await venue();
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    expect(demo).not.toBeNull();
    const otherId = await withTransaction(suite.db, async (tx) => {
      const [other] = await tx
        .insert(printers)
        .values({ locationId, name: "Other", transport: "usb", localKey: "OTHER" })
        .returning({ id: printers.id });
      await enqueuePrintJob(
        tx,
        { locationId },
        demo!.printerId,
        esc({ paperWidth: "80mm", resolution: "180dpi" }).line("Receipt").bytes(),
      );
      await enqueuePrintJob(tx, { locationId }, demo!.printerId, esc().kick().bytes(), "drawer");
      await enqueuePrintJob(
        tx,
        { locationId },
        other!.id,
        esc({ paperWidth: "80mm", resolution: "180dpi" }).line("Other").bytes(),
      );
      return other!.id;
    });

    expect(await deliverDemoPrinterJobs(suite.db, locationId, demo!)).toBe(2);
    const jobs = await suite.db
      .select({ printerId: printJobs.printerId, kind: printJobs.kind, status: printJobs.status })
      .from(printJobs);
    expect(jobs.filter((job) => job.printerId === demo!.printerId)).toEqual([
      { printerId: demo!.printerId, kind: "document", status: "done" },
      { printerId: demo!.printerId, kind: "drawer", status: "done" },
    ]);
    expect(jobs.find((job) => job.printerId === otherId)?.status).toBe("queued");
    const [till] = await suite.db
      .select({ printerId: tills.receiptPrinterId })
      .from(tills)
      .where(eq(tills.id, tillId));
    expect(till?.printerId).toBe(demo!.printerId);
  });

  it("deactivates the pretend printer in Live mode and cannot claim its waiting jobs", async () => {
    const { locationId, tillId } = await venue();
    const [station] = await suite.db
      .insert(kitchenStations)
      .values({ locationId, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(
        tx,
        { locationId },
        demo!.printerId,
        esc({ paperWidth: "80mm", resolution: "180dpi" }).line("Old").bytes(),
      ),
    );

    expect(await configureDemoPrinter(suite.db, locationId, false)).toBeNull();
    expect(await deliverDemoPrinterJobs(suite.db, locationId, demo!)).toBe(0);
    const [printer] = await suite.db
      .select({ active: printers.active })
      .from(printers)
      .where(eq(printers.id, demo!.printerId));
    expect(printer?.active).toBe(false);
    const [till] = await suite.db
      .select({ printerId: tills.receiptPrinterId })
      .from(tills)
      .where(eq(tills.id, tillId));
    expect(till?.printerId).toBeNull();
    expect(
      await suite.db
        .select()
        .from(stationPrinters)
        .where(eq(stationPrinters.stationId, station!.id)),
    ).toEqual([]);
    const [job] = await suite.db.select({ status: printJobs.status }).from(printJobs);
    expect(job?.status).toBe("queued");
  });

  it("uses its own inactive agent even when a real agent has the same display name", async () => {
    const { locationId } = await venue();
    const [realAgent] = await suite.db
      .insert(printAgents)
      .values({ locationId, name: "Demo printer", tokenHash: "real-agent-hash" })
      .returning({ id: printAgents.id });
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    expect(demo?.agentId).not.toBe(realAgent!.id);
    const [agent] = await suite.db
      .select({ active: printAgents.active })
      .from(printAgents)
      .where(eq(printAgents.id, demo!.agentId));
    expect(agent?.active).toBe(false);
  });

  it("waits for an in-flight delivery when stopping", async () => {
    const { locationId } = await venue();
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    const job = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, { locationId }, demo!.printerId, esc().kick().bytes(), "drawer"),
    );
    const loop = startDemoPrinterLoop(suite.db, locationId, demo!, 10);
    await loop.stop();
    const [row] = await suite.db
      .select({ status: printJobs.status })
      .from(printJobs)
      .where(eq(printJobs.id, job.jobId));
    expect(row?.status).toBe("done");
  });

  it("delivers after the sale enqueues, and stops before closing the store", async () => {
    const { locationId } = await venue();
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    const loop = startDemoPrinterLoop(suite.db, locationId, demo!, 10);
    try {
      const first = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, { locationId }, demo!.printerId, esc().kick().bytes(), "drawer"),
      );
      await vi.waitFor(async () => {
        const [job] = await suite.db
          .select({ status: printJobs.status })
          .from(printJobs)
          .where(eq(printJobs.id, first.jobId));
        expect(job?.status).toBe("done");
      });
    } finally {
      await loop.stop();
    }
    const second = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, { locationId }, demo!.printerId, esc().kick().bytes(), "drawer"),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const [job] = await suite.db
      .select({ status: printJobs.status })
      .from(printJobs)
      .where(eq(printJobs.id, second.jobId));
    expect(job?.status).toBe("queued");
  });
});
