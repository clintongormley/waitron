import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  kitchenStations,
  printJobs,
  ticketItems,
  workingOrderLines,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { createCourse, createStation } from "./kitchen.js";
import { readMadeHereStations, listMadeHereStations, setMadeHereStations } from "./made-here.js";
import { createOpenOrder, fireCourse, fireLines } from "./working-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import { routeProductTo } from "./testing/zone-offers.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function stationPrinter(
  tx: Transaction,
  locationId: string,
  stationId: string,
): Promise<string> {
  const { id } = await createPrinter(
    tx,
    { locationId },
    { name: `Printer ${randomUUID()}`, transport: "cloud_poll", pollId: randomUUID() },
  );
  await attachPrinterToStation(tx, { stationId, printerId: id });
  return id;
}

async function rawLine(
  tx: Transaction,
  orderId: string,
  productId: string,
  lineNo: number,
  courseId: string | null = null,
) {
  const [line] = await tx
    .insert(workingOrderLines)
    .values({
      workingOrderId: orderId,
      lineNo,
      productId,
      name: "Dish",
      descriptions: { "es-ES": "Dish" },
      quantity: 1000,
      unitPriceGross: 150,
      vatClass: "general",
      lineTotal: 150,
      courseId,
    })
    .returning();
  return { id: line!.id, productId, parentLineId: null, courseId, note: null, quantity: 1000 };
}

async function deviceAt(
  tx: Transaction,
  locationId: string,
  tillId: string,
  stationId: string,
): Promise<string> {
  const [profile] = await tx
    .insert(deviceProfiles)
    .values({ name: "Till", formFactor: "till", capabilities: [] })
    .returning();
  const [device] = await tx
    .insert(devices)
    .values({
      locationId,
      tillId,
      deviceProfileId: profile!.id,
      label: "Bar till",
      tokenHash: "test",
    })
    .returning();
  await tx.insert(deviceMadeHereStations).values({ deviceId: device!.id, stationId });
  return device!.id;
}

describe("device made-here stations", () => {
  it("makes Bar work here and prints Grill work in the same send", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, venue.aguaId, grill.id);
      const barPrinter = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, venue.cfg.locationId, grill.id);
      const deviceId = await deviceAt(
        tx,
        venue.cfg.locationId,
        venue.cfg.tillId,
        venue.defaultStationId,
      );
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const bar = await rawLine(tx, orderId, venue.cafeId, 1);
      const food = await rawLine(tx, orderId, venue.aguaId, 2);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [bar, food]);
      const items = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(items.find((item) => item.workingOrderLineId === bar.id)).toMatchObject({
        madeHere: true,
        state: "ready",
        stationId: venue.defaultStationId,
      });
      expect(items.find((item) => item.workingOrderLineId === food.id)).toMatchObject({
        madeHere: false,
        state: "queued",
        stationId: grill.id,
      });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinter)),
      ).toHaveLength(0);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinter)),
      ).toHaveLength(1);
    });
  });

  it("uses the final routed station and the device list for a new item", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const downstairs = await createStation(tx, venue.cfg, { name: "Downstairs bar" });
      await routeProductTo(tx, venue.cfg, venue.cafeId, downstairs.id);
      const printer = await stationPrinter(tx, venue.cfg.locationId, downstairs.id);
      const deviceId = await deviceAt(
        tx,
        venue.cfg.locationId,
        venue.cfg.tillId,
        venue.defaultStationId,
      );
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.cafeId, 1);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [line]);
      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, line.id));
      expect(item).toMatchObject({ madeHere: false, stationId: downstairs.id });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer)),
      ).toHaveLength(1);
    });
  });

  it("keeps an earlier dish decision and rejects one kept for a different station", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const printer = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const deviceId = await deviceAt(
        tx,
        venue.cfg.locationId,
        venue.cfg.tillId,
        venue.defaultStationId,
      );
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const ordinary = await rawLine(tx, orderId, venue.cafeId, 1);
      const changed = await rawLine(tx, orderId, venue.cafeId, 2);
      await fireLines(
        tx,
        { ...venue.cfg, sendingDeviceId: deviceId },
        orderId,
        [ordinary, changed],
        {
          keepMadeHere: new Map([
            [ordinary.id, { madeHere: false, stationId: venue.defaultStationId }],
            [changed.id, { madeHere: true, stationId: randomUUID() }],
          ]),
        },
      );
      const items = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(items.map((item) => item.madeHere)).toEqual([false, false]);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer)),
      ).toHaveLength(1);
    });
  });

  it("applies a kept made-here decision even when the sending device lists nothing", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const printer = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Other till", formFactor: "till", capabilities: [] })
        .returning();
      const [device] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          tillId: venue.cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Other",
          tokenHash: "test",
        })
        .returning();
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.cafeId, 1);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: device!.id }, orderId, [line], {
        keepMadeHere: new Map([[line.id, { madeHere: true, stationId: venue.defaultStationId }]]),
      });
      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, line.id));
      expect(item).toMatchObject({ madeHere: true, state: "ready" });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer)),
      ).toHaveLength(0);
    });
  });

  it("prints a station item when there is no sending device", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const printer = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.cafeId, 1);
      await fireLines(tx, venue.cfg, orderId, [line]);
      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, line.id));
      expect(item).toMatchObject({ madeHere: false, state: "queued" });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer)),
      ).toHaveLength(1);
    });
  });

  it("keeps a made-here first course ahead of a later course", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, venue.aguaId, grill.id);
      const first = await createCourse(tx, venue.cfg, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, venue.cfg, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(
        tx,
        venue.cfg.locationId,
        venue.cfg.tillId,
        venue.defaultStationId,
      );
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const drink = await rawLine(tx, orderId, venue.cafeId, 1, first.id);
      const burger = await rawLine(tx, orderId, venue.aguaId, 2, second.id);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [drink, burger]);
      const initial = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(initial.find((item) => item.workingOrderLineId === drink.id)).toMatchObject({
        madeHere: true,
        state: "ready",
      });
      expect(initial.find((item) => item.workingOrderLineId === burger.id)!.firedAt).toBeNull();
      await fireCourse(tx, venue.cfg, orderId, second.id, randomUUID());
      const [released] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, burger.id));
      expect(released!.firedAt).toEqual(expect.any(String));
    });
  });

  it("does not count a made-here later course as started for a later round", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, venue.aguaId, grill.id);
      const first = await createCourse(tx, venue.cfg, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, venue.cfg, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(
        tx,
        venue.cfg.locationId,
        venue.cfg.tillId,
        venue.defaultStationId,
      );
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const burger = await rawLine(tx, orderId, venue.aguaId, 1, first.id);
      const drink = await rawLine(tx, orderId, venue.cafeId, 2, second.id);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [burger, drink]);
      const steak = await rawLine(tx, orderId, venue.aguaId, 3, second.id);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [steak]);
      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, steak.id));
      expect(item).toMatchObject({ madeHere: false, firedAt: null });
    });
  });
  it("records a held dish at its final made-here station as ready without a print job", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Till", formFactor: "till", capabilities: [] })
        .returning();
      const [device] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          tillId: venue.cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Bar till",
          tokenHash: "test",
        })
        .returning();
      await setMadeHereStations(tx, venue.cfg, device!.id, [venue.defaultStationId]);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const [line] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: orderId,
          lineNo: 1,
          productId: venue.cafeId,
          name: "Café",
          descriptions: { "es-ES": "Café" },
          quantity: 1000,
          unitPriceGross: 150,
          vatClass: "general",
          lineTotal: 150,
        })
        .returning();
      const before = await tx.select({ id: printJobs.id }).from(printJobs);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: device!.id }, orderId, [
        {
          id: line!.id,
          productId: venue.cafeId,
          parentLineId: null,
          courseId: null,
          note: null,
          quantity: 1000,
          hold: true,
        },
      ]);
      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, line!.id));
      const [sent] = await tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, line!.id));
      expect(item).toMatchObject({
        madeHere: true,
        state: "ready",
        stationId: venue.defaultStationId,
      });
      expect(item!.readyAt).toBe(item!.firedAt);
      expect(item!.firedAt).toEqual(expect.any(String));
      expect(sent!.sentAt).toEqual(expect.any(String));
      expect(await tx.select({ id: printJobs.id }).from(printJobs)).toHaveLength(before.length);
    });
  });
  it("replaces and deduplicates a device's list, ordered by station id", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Till", formFactor: "till", capabilities: [] })
        .returning();
      const [device] = await tx
        .insert(devices)
        .values({
          id: randomUUID(),
          locationId: venue.cfg.locationId,
          tillId: venue.cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Counter",
          tokenHash: "test",
          active: true,
        })
        .returning();
      const bar = await createStation(tx, venue.cfg, { name: "Bar" });
      await setMadeHereStations(tx, venue.cfg, device!.id, [
        bar.id,
        venue.defaultStationId,
        bar.id,
      ]);
      expect(await readMadeHereStations(tx, device!.id)).toEqual(
        new Set([bar.id, venue.defaultStationId]),
      );
      expect((await listMadeHereStations(tx)).get(device!.id)).toEqual(
        [bar.id, venue.defaultStationId].sort(),
      );
      await setMadeHereStations(tx, venue.cfg, device!.id, [bar.id]);
      expect(await readMadeHereStations(tx, device!.id)).toEqual(new Set([bar.id]));
      expect(await readMadeHereStations(tx, undefined)).toEqual(new Set());
    });
  });

  it("refuses switched-off and foreign-location stations with station.not_found", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Till", formFactor: "till", capabilities: [] })
        .returning();
      const [device] = await tx
        .insert(devices)
        .values({
          id: randomUUID(),
          locationId: venue.cfg.locationId,
          tillId: venue.cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Counter",
          tokenHash: "test",
          active: true,
        })
        .returning();
      const off = await createStation(tx, venue.cfg, { name: "Off" });
      await setMadeHereStations(tx, venue.cfg, device!.id, [venue.defaultStationId]);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, off.id));
      await expect(setMadeHereStations(tx, venue.cfg, device!.id, [off.id])).rejects.toMatchObject({
        code: "station.not_found",
      });
      expect(await readMadeHereStations(tx, device!.id)).toEqual(new Set([venue.defaultStationId]));
      await expect(
        setMadeHereStations(
          tx,
          { ...venue.cfg, locationId: randomUUID() as typeof venue.cfg.locationId },
          device!.id,
          [venue.defaultStationId],
        ),
      ).rejects.toMatchObject({ code: "station.not_found" });
      expect(await readMadeHereStations(tx, device!.id)).toEqual(new Set([venue.defaultStationId]));
    });
  });

  it("keeps two devices on the same profile independent", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Shared", formFactor: "till", capabilities: [] })
        .returning();
      const [a, b] = await tx
        .insert(devices)
        .values(
          ["A", "B"].map((label) => ({
            id: randomUUID(),
            locationId: venue.cfg.locationId,
            tillId: venue.cfg.tillId,
            deviceProfileId: profile!.id,
            label,
            tokenHash: "test",
            active: true,
          })),
        )
        .returning();
      await setMadeHereStations(tx, venue.cfg, a!.id, [venue.defaultStationId]);
      expect(await readMadeHereStations(tx, a!.id)).toEqual(new Set([venue.defaultStationId]));
      expect(await readMadeHereStations(tx, b!.id)).toEqual(new Set());
    });
  });
});
