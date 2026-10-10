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
import {
  emptyPrinterLists,
  readProfilePrinterLists,
  resolveDevicePrinterId,
  setProfilePrinterLists,
} from "@waitron/layouts";
import { enqueuePrintJob, esc, updatePrinter } from "@waitron/printing";
import {
  configureDemoPrinter,
  deliverDemoPrinterJobs,
  routeToDemoPrinter,
  startDemoPrinterLoop,
} from "./demo-printer.js";
import { deletePrinter } from "./printer-delete.js";

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

/** The lists of a profile that had none, once the Demo printer listed itself on every role. */
function demoEverywhere(printerId: string) {
  return {
    receiptPrinterIds: [printerId],
    paymentSlipPrinterIds: [printerId],
    cashDrawerPrinterIds: [printerId],
    receiptPrinterDefaultId: printerId,
    paymentSlipPrinterDefaultId: printerId,
    cashDrawerPrinterDefaultId: printerId,
  };
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
    expect(await devicePrinters(deviceId)).toEqual({ receipt: null, paymentSlip: null });
    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
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
      ...emptyPrinterLists(),
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

  it("after its printer is deleted, a Demo boot adds a new one rather than bringing it back", async () => {
    const { locationId, deviceId, profileId } = await venue();
    const first = await configureDemoPrinter(suite.db, locationId, true);
    await withTransaction(suite.db, (tx) => deletePrinter(tx, { locationId }, first!.printerId));
    const deletedRow = await suite.db
      .select()
      .from(printers)
      .where(eq(printers.id, first!.printerId));

    const second = await configureDemoPrinter(suite.db, locationId, true);

    expect(second!.printerId).not.toBe(first!.printerId);
    expect(second!.agentId).toBe(first!.agentId);
    expect(await suite.db.select().from(printers).where(eq(printers.id, first!.printerId))).toEqual(
      deletedRow,
    );
    expect(deletedRow[0]).toMatchObject({ active: false, deletedAt: expect.any(String) });
    expect(await profileLists(profileId)).toEqual(demoEverywhere(second!.printerId));
    expect(
      await withTransaction(suite.db, (tx) => resolveDevicePrinterId(tx, deviceId, "receipt")),
    ).toBe(second!.printerId);
  });

  it("refuses to route to a deleted printer itself, before anything that would also refuse it", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Empty", invoiceLocales: ["en-GB"], operationDescription: "Restaurant sale" })
      .returning({ id: locations.id });
    const locationId = location!.id;
    const gone = await realPrinter(locationId, "Gone");
    await withTransaction(suite.db, (tx) => deletePrinter(tx, { locationId }, gone));

    await expect(
      withTransaction(suite.db, (tx) => routeToDemoPrinter(tx, locationId, gone)),
    ).rejects.toMatchObject({ code: "printer.not_found" });
  });

  it("a deleted printer's route writes no list, default or station link", async () => {
    const { locationId, profileId } = await venue();
    await suite.db.insert(kitchenStations).values({ locationId, name: "Grill" });
    const gone = await realPrinter(locationId, "Gone");
    await withTransaction(suite.db, (tx) => deletePrinter(tx, { locationId }, gone));
    const lists = await profileLists(profileId);

    await expect(
      withTransaction(suite.db, (tx) => routeToDemoPrinter(tx, locationId, gone)),
    ).rejects.toMatchObject({ code: "printer.not_found" });

    expect(await profileLists(profileId)).toEqual(lists);
    expect(
      await suite.db.select().from(stationPrinters).where(eq(stationPrinters.printerId, gone)),
    ).toEqual([]);
  });

  it("a Live boot after its printer is deleted leaves the deleted row as it is", async () => {
    const { locationId } = await venue();
    const first = await configureDemoPrinter(suite.db, locationId, true);
    await withTransaction(suite.db, (tx) => deletePrinter(tx, { locationId }, first!.printerId));
    const before = await suite.db.select().from(printers);

    expect(await configureDemoPrinter(suite.db, locationId, false)).toBeNull();

    expect(await suite.db.select().from(printers)).toEqual(before);
  });

  it("adds itself after a profile's real printers, leaving held printers and revoked devices alone", async () => {
    const { locationId, deviceId, profileId } = await venue();
    const bar = await realPrinter(locationId, "Bar");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        ...emptyPrinterLists(),
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
      cashDrawerPrinterIds: [demo!.printerId],
      receiptPrinterDefaultId: demo!.printerId,
      paymentSlipPrinterDefaultId: demo!.printerId,
      cashDrawerPrinterDefaultId: demo!.printerId,
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
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, retiredId));

    const demo = await configureDemoPrinter(suite.db, locationId, true);

    expect(await profileLists(retiredId)).toEqual({
      ...emptyPrinterLists(),
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
    });
    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
  });

  it("becomes each role's default where the profile had none, and devices on Use default resolve to it", async () => {
    const { locationId, deviceId, profileId } = await venue();

    const demo = await configureDemoPrinter(suite.db, locationId, true);

    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
    for (const role of ["receipt", "payment_slip", "cash_drawer"] as const) {
      expect(
        await withTransaction(suite.db, (tx) => resolveDevicePrinterId(tx, deviceId, role)),
      ).toBe(demo!.printerId);
    }
  });

  it("leaves a profile's own default in place", async () => {
    const { locationId, profileId } = await venue();
    const bar = await realPrinter(locationId, "Bar");
    await suite.db.update(printers).set({ hasCashDrawer: true }).where(eq(printers.id, bar));
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [bar],
        paymentSlipPrinterIds: [bar],
        cashDrawerPrinterIds: [bar],
        receiptPrinterDefaultId: bar,
        paymentSlipPrinterDefaultId: null,
        cashDrawerPrinterDefaultId: bar,
      }),
    );

    const demo = await configureDemoPrinter(suite.db, locationId, true);

    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [bar, demo!.printerId],
      paymentSlipPrinterIds: [bar, demo!.printerId],
      cashDrawerPrinterIds: [bar, demo!.printerId],
      receiptPrinterDefaultId: bar,
      paymentSlipPrinterDefaultId: demo!.printerId,
      cashDrawerPrinterDefaultId: bar,
    });
  });

  it("puts a device back on Use default when Live mode takes it off the list", async () => {
    const { locationId, deviceId, profileId } = await venue();
    const bar = await realPrinter(locationId, "Bar");
    // Listed after the device paired, so the device still holds none.
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        ...emptyPrinterLists(),
        receiptPrinterIds: [bar],
        paymentSlipPrinterIds: [bar],
      }),
    );
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: demo!.printerId, paymentSlipPrinterId: demo!.printerId })
      .where(eq(devices.id, deviceId));

    await configureDemoPrinter(suite.db, locationId, false);

    expect(await devicePrinters(deviceId)).toEqual({ receipt: null, paymentSlip: null });
    expect(await profileLists(profileId)).toEqual({
      ...emptyPrinterLists(),
      receiptPrinterIds: [bar],
      paymentSlipPrinterIds: [bar],
    });
  });

  it("starts again with its drawer switched off, staying off the drawer list and default", async () => {
    const { locationId, profileId } = await venue();
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    await withTransaction(suite.db, (tx) =>
      updatePrinter(tx, { locationId }, demo!.printerId, { hasCashDrawer: false }),
    );
    await configureDemoPrinter(suite.db, locationId, false);

    expect(await configureDemoPrinter(suite.db, locationId, true)).toEqual(demo);

    const [printer] = await suite.db
      .select({ hasCashDrawer: printers.hasCashDrawer })
      .from(printers)
      .where(eq(printers.id, demo!.printerId));
    expect(printer?.hasCashDrawer).toBe(false);
    expect(await profileLists(profileId)).toEqual({
      ...demoEverywhere(demo!.printerId),
      cashDrawerPrinterIds: [],
      cashDrawerPrinterDefaultId: null,
    });
  });

  it("runs again in practice after its drawer was switched off, keeping the lists it already had", async () => {
    const { locationId, profileId } = await venue();
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    await withTransaction(suite.db, (tx) =>
      updatePrinter(tx, { locationId }, demo!.printerId, { hasCashDrawer: false }),
    );

    expect(await configureDemoPrinter(suite.db, locationId, true)).toEqual(demo);

    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
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
