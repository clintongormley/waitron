import { createJobRunner, type JobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";
import type { ResourceChange } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  kitchenStations,
  pagePrinters,
  printAgents,
  printJobs,
  printers,
  stationPrinterPairs,
  withTransaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedVenue } from "@waitron/db/testing/seed.js";
import {
  emptyPrinterLists,
  readProfilePrinterLists,
  resolveDevicePrinterId,
  setProfilePrinterLists,
} from "@waitron/layouts";
import { listPrinters, enqueuePrintJob, esc, updatePrinter } from "@waitron/printing";
import {
  configureDemoPrinter,
  deliverDemoPrinterJobs,
  routeToDemoPrinter,
  demoPrinterJob,
} from "./demo-printer.js";
import { deletePrinter } from "./printer-delete.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function venue(): Promise<{ locationId: string; deviceId: string; profileId: string }> {
  await seedVenue(suite.db, {
    name: "Bar",
    invoiceLocales: ["en-GB"],
    operationDescription: "Restaurant sale",
  });
  const venueId = await venueLocationId(suite.db);
  const { deviceId, profileId } = await seedDevice(suite.db, { label: "Counter" });
  return { locationId: venueId, deviceId, profileId };
}

async function realPrinter(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({ name, transport: "usb", localKey: name.toUpperCase() })
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

async function pagePrinter(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(pagePrinters)
    .values({
      name,
      host: "10.0.0.9",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
    })
    .returning({ id: pagePrinters.id });
  return row!.id;
}

/** The lists of a profile that had none, once the Demo printer listed itself on every role. */
function demoEverywhere(printerId: string) {
  return {
    receiptPrinterIds: [printerId],
    paymentSlipPrinterIds: [printerId],
    cashDrawerPrinterIds: [printerId],
    invoicePrinterIds: [printerId],
    receiptPrinterDefaultId: printerId,
    paymentSlipPrinterDefaultId: printerId,
    cashDrawerPrinterDefaultId: printerId,
    invoicePrinterDefaultId: printerId,
  };
}

function profileLists(profileId: string) {
  return withTransaction(suite.db, (tx) => readProfilePrinterLists(tx, profileId));
}

describe("the Demo printer", () => {
  it("delivers its receipt and drawer jobs without claiming an unrelated printer's job", async () => {
    const { deviceId, profileId } = await venue();
    const demo = await configureDemoPrinter(suite.db, true);
    expect(demo).not.toBeNull();
    const otherId = await withTransaction(suite.db, async (tx) => {
      const [other] = await tx
        .insert(printers)
        .values({ name: "Other", transport: "usb", localKey: "OTHER" })
        .returning({ id: printers.id });
      await enqueuePrintJob(
        tx,
        demo!.printerId,
        esc({ paperWidth: "80mm", resolution: "180dpi" }).line("Receipt").bytes(),
      );
      await enqueuePrintJob(tx, demo!.printerId, esc().kick().bytes(), "drawer");
      await enqueuePrintJob(
        tx,
        other!.id,
        esc({ paperWidth: "80mm", resolution: "180dpi" }).line("Other").bytes(),
      );
      return other!.id;
    });

    expect(await deliverDemoPrinterJobs(suite.db, demo!)).toBe(2);
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

  it("removes the pretend printer in Live mode and cannot claim its waiting jobs", async () => {
    const { deviceId, profileId } = await venue();
    const [station] = await suite.db
      .insert(kitchenStations)
      .values([{ name: "Grill" }, { name: "Bar" }])
      .returning({ id: kitchenStations.id });
    const demo = await configureDemoPrinter(suite.db, true);
    expect(
      await suite.db
        .select({ name: kitchenStations.name, printerIds: kitchenStations.printerIds })
        .from(kitchenStations)
        .orderBy(kitchenStations.name),
    ).toEqual([
      { name: "Bar", printerIds: [demo!.printerId] },
      { name: "Grill", printerIds: [demo!.printerId] },
    ]);
    await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(
        tx,
        demo!.printerId,
        esc({ paperWidth: "80mm", resolution: "180dpi" }).line("Old").bytes(),
      ),
    );

    expect(await configureDemoPrinter(suite.db, false)).toBeNull();
    expect(await deliverDemoPrinterJobs(suite.db, demo!)).toBe(0);
    const [printer] = await suite.db
      .select({ active: printers.active })
      .from(printers)
      .where(eq(printers.id, demo!.printerId));
    expect(printer?.active).toBe(false);
    expect(await withTransaction(suite.db, (tx) => listPrinters(tx))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: demo!.printerId })]),
    );
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
        .select({
          stationId: stationPrinterPairs.stationId,
          printerId: stationPrinterPairs.printerId,
        })
        .from(stationPrinterPairs)
        .where(eq(stationPrinterPairs.stationId, station!.id)),
    ).toEqual([]);
    const [job] = await suite.db.select({ status: printJobs.status }).from(printJobs);
    expect(job?.status).toBe("failed");
  });

  it("finds its printer on the local-key index, not a scan", async () => {
    await venue();
    await configureDemoPrinter(suite.db, true);
    const session = (
      suite.db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }
    ).session;
    const prepare = session.prepareQuery.bind(session);
    const lookups: { sql: string; params: unknown[] }[] = [];
    const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
      const query = args[0] as { sql: string; params: unknown[] };
      if (/^select .* from "printers" where .*"local_key"/.test(query.sql)) lookups.push(query);
      return prepare(...args);
    });
    try {
      await configureDemoPrinter(suite.db, true);
    } finally {
      spy.mockRestore();
    }
    expect(lookups).toHaveLength(1);
    const parts = lookups[0]!.sql.split("?");
    const statement = sql.raw(`explain query plan ${parts[0]}`);
    lookups[0]!.params.forEach((param, i) => {
      statement.append(sql`${param}`);
      statement.append(sql.raw(parts[i + 1]!));
    });
    const plan = await withTransaction(suite.db, (tx) => tx.execute<{ detail: string }>(statement));
    expect(plan.rows.map((row) => row.detail)).toEqual([
      expect.stringContaining("SEARCH printers USING INDEX printers_local_key_key (local_key=?)"),
    ]);
  });

  it("after its printer is deleted, a Demo boot restores its identity and saved settings", async () => {
    const { deviceId, profileId } = await venue();
    const first = await configureDemoPrinter(suite.db, true);
    await withTransaction(suite.db, (tx) => deletePrinter(tx, first!.printerId));
    const deletedRow = await suite.db
      .select()
      .from(printers)
      .where(eq(printers.id, first!.printerId));

    const second = await configureDemoPrinter(suite.db, true);

    expect(second!.printerId).toBe(first!.printerId);
    expect(second!.agentId).toBe(first!.agentId);
    expect(await suite.db.select().from(printers).where(eq(printers.id, first!.printerId))).toEqual(
      [{ ...deletedRow[0], active: true, deletedAt: null }],
    );
    expect(deletedRow[0]).toMatchObject({ active: false, deletedAt: expect.any(String) });
    expect(await profileLists(profileId)).toEqual(demoEverywhere(second!.printerId));
    expect(
      await withTransaction(suite.db, (tx) => resolveDevicePrinterId(tx, deviceId, "receipt")),
    ).toBe(second!.printerId);
  });

  it("refuses to route to a deleted printer itself, before anything that would also refuse it", async () => {
    await seedVenue(suite.db, {
      name: "Empty",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant sale",
    });

    const gone = await realPrinter("Gone");
    await withTransaction(suite.db, (tx) => deletePrinter(tx, gone));

    await expect(
      withTransaction(suite.db, (tx) => routeToDemoPrinter(tx, gone)),
    ).rejects.toMatchObject({ code: "printer.not_found" });
  });

  it("a deleted printer's route writes no list, default or station link", async () => {
    const { profileId } = await venue();
    await suite.db.insert(kitchenStations).values({ name: "Grill" });
    const gone = await realPrinter("Gone");
    await withTransaction(suite.db, (tx) => deletePrinter(tx, gone));
    const lists = await profileLists(profileId);

    await expect(
      withTransaction(suite.db, (tx) => routeToDemoPrinter(tx, gone)),
    ).rejects.toMatchObject({ code: "printer.not_found" });

    expect(await profileLists(profileId)).toEqual(lists);
    expect(
      await suite.db
        .select({
          stationId: stationPrinterPairs.stationId,
          printerId: stationPrinterPairs.printerId,
        })
        .from(stationPrinterPairs)
        .where(eq(stationPrinterPairs.printerId, gone)),
    ).toEqual([]);
  });

  it("a Live boot after its printer is deleted leaves the deleted row as it is", async () => {
    await venue();
    const first = await configureDemoPrinter(suite.db, true);
    await withTransaction(suite.db, (tx) => deletePrinter(tx, first!.printerId));
    const before = await suite.db.select().from(printers);

    expect(await configureDemoPrinter(suite.db, false)).toBeNull();

    expect(await suite.db.select().from(printers)).toEqual(before);
  });

  it("adds itself after a profile's real printers, leaving held printers and revoked devices alone", async () => {
    const { deviceId, profileId } = await venue();
    const bar = await realPrinter("Bar");
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
    const { deviceId: revokedId } = await seedDevice(suite.db, { profileId });
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, revokedId));

    await configureDemoPrinter(suite.db, true);
    // Every boot in Demo runs it again.
    const demo = await configureDemoPrinter(suite.db, true);

    expect(await devicePrinters(deviceId)).toEqual({ receipt: bar, paymentSlip: bar });
    expect(await devicePrinters(revokedId)).toEqual({ receipt: null, paymentSlip: null });
    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [bar, demo!.printerId],
      paymentSlipPrinterIds: [bar, demo!.printerId],
      cashDrawerPrinterIds: [demo!.printerId],
      invoicePrinterIds: [demo!.printerId],
      receiptPrinterDefaultId: demo!.printerId,
      paymentSlipPrinterDefaultId: demo!.printerId,
      cashDrawerPrinterDefaultId: demo!.printerId,
      invoicePrinterDefaultId: demo!.printerId,
    });
  });

  it("leaves a retired profile off, so it gains no printer list", async () => {
    const { profileId } = await venue();
    const { deviceId: revokedId, profileId: retiredId } = await seedDevice(suite.db);
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, revokedId));
    await suite.db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, retiredId));

    const demo = await configureDemoPrinter(suite.db, true);

    expect(await profileLists(retiredId)).toEqual({
      ...emptyPrinterLists(),
      receiptPrinterIds: [],
      paymentSlipPrinterIds: [],
    });
    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
  });

  it("becomes each role's default where the profile had none, and devices on Use default resolve to it", async () => {
    const { deviceId, profileId } = await venue();

    const demo = await configureDemoPrinter(suite.db, true);

    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
    for (const role of ["receipt", "payment_slip", "cash_drawer"] as const) {
      expect(
        await withTransaction(suite.db, (tx) => resolveDevicePrinterId(tx, deviceId, role)),
      ).toBe(demo!.printerId);
    }
  });

  it("leaves a profile's own default in place", async () => {
    const { profileId } = await venue();
    const bar = await realPrinter("Bar");
    await suite.db.update(printers).set({ hasCashDrawer: true }).where(eq(printers.id, bar));
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        receiptPrinterIds: [bar],
        paymentSlipPrinterIds: [bar],
        cashDrawerPrinterIds: [bar],
        invoicePrinterIds: [],
        receiptPrinterDefaultId: bar,
        paymentSlipPrinterDefaultId: null,
        cashDrawerPrinterDefaultId: bar,
        invoicePrinterDefaultId: null,
      }),
    );

    const demo = await configureDemoPrinter(suite.db, true);

    expect(await profileLists(profileId)).toEqual({
      receiptPrinterIds: [bar, demo!.printerId],
      paymentSlipPrinterIds: [bar, demo!.printerId],
      cashDrawerPrinterIds: [bar, demo!.printerId],
      invoicePrinterIds: [demo!.printerId],
      receiptPrinterDefaultId: bar,
      paymentSlipPrinterDefaultId: demo!.printerId,
      cashDrawerPrinterDefaultId: bar,
      invoicePrinterDefaultId: demo!.printerId,
    });
  });

  it("puts a device back on Use default when Live mode takes it off the list", async () => {
    const { deviceId, profileId } = await venue();
    const bar = await realPrinter("Bar");
    // Listed after the device paired, so the device still holds none.
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        ...emptyPrinterLists(),
        receiptPrinterIds: [bar],
        paymentSlipPrinterIds: [bar],
      }),
    );
    const demo = await configureDemoPrinter(suite.db, true);
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: demo!.printerId, paymentSlipPrinterId: demo!.printerId })
      .where(eq(devices.id, deviceId));

    await configureDemoPrinter(suite.db, false);

    expect(await devicePrinters(deviceId)).toEqual({ receipt: null, paymentSlip: null });
    expect(await profileLists(profileId)).toEqual({
      ...emptyPrinterLists(),
      receiptPrinterIds: [bar],
      paymentSlipPrinterIds: [bar],
    });
  });

  it("starts again with its drawer switched off, staying off the drawer list and default", async () => {
    const { profileId } = await venue();
    const demo = await configureDemoPrinter(suite.db, true);
    await withTransaction(suite.db, (tx) =>
      updatePrinter(tx, demo!.printerId, { hasCashDrawer: false }),
    );
    await configureDemoPrinter(suite.db, false);

    expect(await configureDemoPrinter(suite.db, true)).toEqual(demo);

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
    const { profileId } = await venue();
    const demo = await configureDemoPrinter(suite.db, true);
    await withTransaction(suite.db, (tx) =>
      updatePrinter(tx, demo!.printerId, { hasCashDrawer: false }),
    );

    expect(await configureDemoPrinter(suite.db, true)).toEqual(demo);

    expect(await profileLists(profileId)).toEqual(demoEverywhere(demo!.printerId));
  });

  it("keeps a profile's invoice list and its page printer default, listing itself after them", async () => {
    const { profileId } = await venue();
    const office = await pagePrinter("Office");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        ...emptyPrinterLists(),
        invoicePrinterIds: [office],
        invoicePrinterDefaultId: office,
      }),
    );

    const demo = await configureDemoPrinter(suite.db, true);

    expect(await profileLists(profileId)).toEqual({
      ...demoEverywhere(demo!.printerId),
      invoicePrinterIds: [office, demo!.printerId],
      invoicePrinterDefaultId: office,
    });
  });

  it("joins every live profile's invoice list, as its default only where there was none", async () => {
    const { profileId } = await venue();
    const { profileId: otherId } = await seedDevice(suite.db);
    const office = await pagePrinter("Office");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, otherId, {
        ...emptyPrinterLists(),
        invoicePrinterIds: [office],
      }),
    );

    const demo = await configureDemoPrinter(suite.db, true);

    expect((await profileLists(profileId)).invoicePrinterIds).toEqual([demo!.printerId]);
    expect((await profileLists(profileId)).invoicePrinterDefaultId).toBe(demo!.printerId);
    expect((await profileLists(otherId)).invoicePrinterIds).toEqual([office, demo!.printerId]);
    expect((await profileLists(otherId)).invoicePrinterDefaultId).toBe(demo!.printerId);
  });

  it("takes itself off the invoice list and default in Live mode, keeping a page printer listed", async () => {
    const { profileId } = await venue();
    const office = await pagePrinter("Office");
    await withTransaction(suite.db, (tx) =>
      setProfilePrinterLists(tx, profileId, {
        ...emptyPrinterLists(),
        invoicePrinterIds: [office],
      }),
    );
    const demo = await configureDemoPrinter(suite.db, true);
    expect((await profileLists(profileId)).invoicePrinterDefaultId).toBe(demo!.printerId);

    await configureDemoPrinter(suite.db, false);

    expect(await profileLists(profileId)).toEqual({
      ...emptyPrinterLists(),
      invoicePrinterIds: [office],
    });
  });

  it("uses its own inactive agent even when a real agent has the same display name", async () => {
    await venue();
    const [realAgent] = await suite.db
      .insert(printAgents)
      .values({ name: "Demo printer", tokenHash: "real-agent-hash" })
      .returning({ id: printAgents.id });
    const demo = await configureDemoPrinter(suite.db, true);
    expect(demo?.agentId).not.toBe(realAgent!.id);
    const [agent] = await suite.db
      .select({ active: printAgents.active })
      .from(printAgents)
      .where(eq(printAgents.id, demo!.agentId));
    expect(agent?.active).toBe(false);
  });

  describe("the runner job", () => {
    let runner: JobRunner;
    let emit: (change: ResourceChange) => void;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    });
    afterEach(async () => {
      await runner?.stopJobs();
      vi.useRealTimers();
    });
    function start(identity: NonNullable<Awaited<ReturnType<typeof configureDemoPrinter>>>) {
      runner = createJobRunner({
        now: () => new Date(),
        log: () => {},
        delay: fakeTimerDelay,
        subscribe: (fn) => {
          emit = fn;
          return () => {};
        },
      });
      const job = demoPrinterJob(suite.db, identity, () => {});
      const pass = vi.spyOn(job, "pass");
      runner.add(job);
      return pass;
    }
    const status = async (id: string) =>
      (
        await suite.db
          .select({ status: printJobs.status })
          .from(printJobs)
          .where(eq(printJobs.id, id))
      )[0]?.status;

    it("waits for an in-flight delivery when stopping", async () => {
      await venue();
      const demo = await configureDemoPrinter(suite.db, true);
      const job = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, demo!.printerId, esc().kick().bytes(), "drawer"),
      );
      start(demo!);
      await runner.stopJobs();
      expect(await status(job.jobId)).toBe("done");
    });

    it("delivers within a second of a print-job wake without a half-second poll, and stops before closing the store", async () => {
      await venue();
      const demo = await configureDemoPrinter(suite.db, true);
      const began = Date.now();
      const pass = start(demo!);
      await vi.waitFor(() => expect(runner.views()["demo.printer"]?.state).toBe("waiting"));
      const first = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, demo!.printerId, esc().kick().bytes(), "drawer"),
      );
      emit({ resources: [{ type: "print_jobs" }] });
      await vi.advanceTimersByTimeAsync(499 - (Date.now() - began));
      expect(await status(first.jobId)).toBe("queued");
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(async () => expect(await status(first.jobId)).toBe("done"));
      expect(Date.now() - began).toBeLessThan(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pass).toHaveBeenCalledTimes(2);
      await runner.stopJobs();
      const second = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, demo!.printerId, esc().kick().bytes(), "drawer"),
      );
      emit({ resources: [{ type: "print_jobs" }] });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await status(second.jobId)).toBe("queued");
    });

    it("delivers many print jobs written together in one pass", async () => {
      await venue();
      const demo = await configureDemoPrinter(suite.db, true);
      const pass = start(demo!);
      await vi.waitFor(() => expect(runner.views()["demo.printer"]?.state).toBe("waiting"));
      const ids = await withTransaction(suite.db, async (tx) => {
        const ids: string[] = [];
        for (let i = 0; i < 4; i++)
          ids.push(
            (await enqueuePrintJob(tx, demo!.printerId, esc().kick().bytes(), "drawer")).jobId,
          );
        return ids;
      });
      emit({ resources: [{ type: "print_jobs" }] });
      await vi.advanceTimersByTimeAsync(500);
      await vi.waitFor(() => expect(runner.views()["demo.printer"]?.state).toBe("waiting"));
      for (const id of ids) expect(await status(id)).toBe("done");
      expect(pass).toHaveBeenCalledTimes(2);
    });
  });
});
