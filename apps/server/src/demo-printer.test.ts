import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  kitchenStations,
  locations,
  printAgents,
  printJobs,
  printers,
  stationPrinters,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { readProfilePrinterLists, setProfilePrinterLists } from "@waitron/layouts";
import { enqueuePrintJob, esc } from "@waitron/printing";
import {
  configureDemoPrinter,
  deliverDemoPrinterJobs,
  startDemoPrinterLoop,
} from "./demo-printer.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function venue(): Promise<{ locationId: string; deviceId: string; profileId: string }> {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["en-GB"], operationDescription: "Restaurant sale" })
    .returning({ id: locations.id });
  const { deviceId, profileId } = await seedDevice(suite.db, {
    locationId: location!.id,
    label: "Counter",
  });
  return { locationId: location!.id, deviceId, profileId };
}

async function realPrinter(locationId: string, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({ locationId, name, transport: "usb", localKey: name.toUpperCase() })
    .returning({ id: printers.id });
  return row!.id;
}

async function devicePrinters(deviceId: string) {
  const [row] = await suite.db
    .select({ receipt: devices.receiptPrinterId, paymentSlip: devices.paymentSlipPrinterId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row;
}

function profileLists(profileId: string) {
  return withTransaction(suite.db, (tx) => readProfilePrinterLists(tx, profileId));
}

describe("the Demo printer", () => {
  it("delivers its receipt and drawer jobs without claiming an unrelated printer's job", async () => {
    const { locationId, deviceId, profileId } = await venue();
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
    expect(await devicePrinters(deviceId)).toEqual({
      receipt: demo!.printerId,
      paymentSlip: demo!.printerId,
    });
    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [demo!.printerId],
      paymentSlipPrinterIds: [demo!.printerId],
    });
  });

  it("deactivates the pretend printer in Live mode and cannot claim its waiting jobs", async () => {
    const { locationId, deviceId, profileId } = await venue();
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
    expect(await devicePrinters(deviceId)).toEqual({ receipt: null, paymentSlip: null });
    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
    });
    expect(
      await suite.db
        .select()
        .from(deviceProfilePrinters)
        .where(eq(deviceProfilePrinters.printerId, demo!.printerId)),
    ).toEqual([]);
    expect(
      await suite.db
        .select()
        .from(stationPrinters)
        .where(eq(stationPrinters.stationId, station!.id)),
    ).toEqual([]);
    const [job] = await suite.db.select({ status: printJobs.status }).from(printJobs);
    expect(job?.status).toBe("queued");
  });

  it("adds itself after a profile's real printers, leaving held printers and revoked devices alone", async () => {
    const { locationId, deviceId, profileId } = await venue();
    const bar = await realPrinter(locationId, "Bar");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [bar],
        paymentSlipPrinterIds: [bar],
      }),
    );
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: bar, paymentSlipPrinterId: bar })
      .where(eq(devices.id, deviceId));
    const { deviceId: revokedId } = await seedDevice(suite.db, { locationId, profileId });
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, revokedId));

    await configureDemoPrinter(suite.db, locationId, true);
    // Every boot in Demo runs it again.
    const demo = await configureDemoPrinter(suite.db, locationId, true);

    expect(await devicePrinters(deviceId)).toEqual({ receipt: bar, paymentSlip: bar });
    expect(await devicePrinters(revokedId)).toEqual({ receipt: null, paymentSlip: null });
    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [bar, demo!.printerId],
      paymentSlipPrinterIds: [bar, demo!.printerId],
    });
  });

  it("leaves a retired profile off, so it gains no printer list", async () => {
    const { locationId, profileId } = await venue();
    const { deviceId: revokedId, profileId: retiredId } = await seedDevice(suite.db, {
      locationId,
    });
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, revokedId));
    await suite.db
      .update(deviceProfiles)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, retiredId));

    const demo = await configureDemoPrinter(suite.db, locationId, true);

    expect(await profileLists(retiredId)).toEqual({
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
    });
    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [demo!.printerId],
      paymentSlipPrinterIds: [demo!.printerId],
    });
  });

  it("moves a device off it in Live mode to the first printer still listed", async () => {
    const { locationId, deviceId, profileId } = await venue();
    const bar = await realPrinter(locationId, "Bar");
    // Listed after the device paired, so the device still holds none.
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [bar],
        paymentSlipPrinterIds: [bar],
      }),
    );
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    expect(await devicePrinters(deviceId)).toEqual({
      receipt: demo!.printerId,
      paymentSlip: demo!.printerId,
    });

    await configureDemoPrinter(suite.db, locationId, false);

    expect(await devicePrinters(deviceId)).toEqual({ receipt: bar, paymentSlip: bar });
    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [bar],
      paymentSlipPrinterIds: [bar],
    });
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
