import { randomUUID } from "node:crypto";
import { Hono } from "hono";
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
import { deviceOrigin } from "@waitron/shared";
import { createPrinter } from "@waitron/printing";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { createCourse, createStation } from "./kitchen.js";
import {
  readMadeHereStations,
  listMadeHereStations,
  setMadeHereStations,
  readMadeHereItems,
  madeHereAnswer,
  madeHereSinkFor,
} from "./made-here.js";
import { createOpenOrder, fireCourse, fireLines, listStationQueue } from "./working-order.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { attachPrinterToStation } from "./station-printers.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { setStationFallback, setStationToday } from "@waitron/venue-service";

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

async function deviceAt(tx: Transaction, locationId: string, stationId: string): Promise<string> {
  const [profile] = await tx
    .insert(deviceProfiles)
    .values({ name: "Till", formFactor: "till", capabilities: [] })
    .returning();
  const [device] = await tx
    .insert(devices)
    .values({
      locationId,
      deviceProfileId: profile!.id,
      label: "Bar till",
      tokenHash: "test",
    })
    .returning();
  await tx.insert(deviceMadeHereStations).values({ deviceId: device!.id, stationId });
  return device!.id;
}

describe("device made-here stations", () => {
  it("prints at the fallback when a made-here station closes by hand", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const bar = await createStation(tx, venue.cfg, { name: "Bar" });
      const downstairs = await createStation(tx, venue.cfg, { name: "Downstairs bar" });
      await routeProductTo(tx, venue.cfg, venue.cafeId, bar.id);
      await setStationFallback(tx, venue.cfg, bar.id, downstairs.id);
      const downstairsPrinter = await stationPrinter(tx, venue.cfg.locationId, downstairs.id);
      const deviceId = await deviceAt(tx, venue.cfg.locationId, bar.id);
      await setStationToday(tx, venue.cfg, bar.id, "closed", new Date());
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const lager = await rawLine(tx, orderId, venue.cafeId, 1);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [lager]);

      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, lager.id));
      expect(item).toMatchObject({ stationId: downstairs.id, madeHere: false, state: "queued" });
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, downstairsPrinter)),
      ).toHaveLength(1);
    });
  });

  it("releases a made-here later-course drink immediately and never prints it on course fire or reprint", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, venue.aguaId, grill.id);
      const barPrinter = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, venue.cfg.locationId, grill.id);
      const first = await createCourse(tx, venue.cfg, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, venue.cfg, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
      const cfg = { ...venue.cfg, sendingDeviceId: deviceId };
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const burger = await rawLine(tx, orderId, venue.aguaId, 1, first.id);
      const drink = await rawLine(tx, orderId, venue.cafeId, 2, second.id);
      await fireLines(tx, cfg, orderId, [burger, drink]);
      const [made] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, drink.id));
      expect(made).toMatchObject({ madeHere: true, state: "ready", firedAt: expect.any(String) });
      expect(await listStationQueue(tx, venue.defaultStationId)).toEqual([]);
      const barBefore = await tx
        .select()
        .from(printJobs)
        .where(eq(printJobs.printerId, barPrinter));
      await fireCourse(
        tx,
        { ...venue.cfg, origin: deviceOrigin(deviceId) },
        orderId,
        second.id,
        randomUUID(),
      );
      await reprintOrderTickets(tx, venue.cfg, orderId);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinter)),
      ).toHaveLength(barBefore.length);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinter)),
      ).toHaveLength(2);
      const [after] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, drink.id));
      expect(after).toEqual(made);
      const allMade = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      for (const item of allMade.filter((item) => item.madeHere)) {
        expect(item.firedAt).toEqual(expect.any(String));
        expect(item.state).toBe("ready");
      }
    });
  });

  it("adds committed items to JSON while retaining the cookie and leaves text untouched", async () => {
    const venue = await setupVenue(suite.db);
    let lineId = "";
    await withTransaction(suite.db, async (tx) => {
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.cafeId, 1);
      lineId = line.id;
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [line]);
    });
    const app = new Hono();
    app.use("/api/*", madeHereAnswer(suite.db, "es-ES"));
    app.get("/api/json", (c) => {
      madeHereSinkFor(c).add(lineId);
      c.header("Set-Cookie", "session=test; HttpOnly");
      return c.json({ ok: true });
    });
    app.get("/api/text", (c) => {
      madeHereSinkFor(c).add(lineId);
      c.header("Set-Cookie", "session=test; HttpOnly");
      return c.text("ready");
    });
    const json = await app.request("/api/json");
    expect(json.headers.get("set-cookie")).toBe("session=test; HttpOnly");
    expect(await json.json()).toMatchObject({ ok: true, madeHere: [{ lineId }] });
    const text = await app.request("/api/text");
    expect(text.headers.get("set-cookie")).toBe("session=test; HttpOnly");
    expect(await text.text()).toBe("ready");
  });

  it("drops an id without a committed made-here record", async () => {
    expect(await readMadeHereItems(suite.db, new Set([randomUUID()]), "es-ES")).toEqual([]);
  });
  it("shows a made-here weighted extra's saved physical amount and unit", async () => {
    const venue = await setupVenue(suite.db);
    const drinkId = await withTransaction(suite.db, async (tx) => {
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const drink = await rawLine(tx, orderId, venue.cafeId, 1);
      await tx.insert(workingOrderLines).values({
        workingOrderId: orderId,
        parentLineId: drink.id,
        lineNo: 2,
        productId: venue.aguaId,
        name: "Jamón",
        descriptions: { "es-ES": "Jamón" },
        quantity: 150,
        priceQuantity: 50,
        unitName: { es: "kg" },
        unitPriceGross: 1,
        vatClass: "general",
        lineTotal: 3,
      });
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [drink]);
      return drink.id;
    });
    const items = await readMadeHereItems(suite.db, new Set([drinkId]), "es");
    expect(items).toHaveLength(1);
    expect(items[0]!.extras).toEqual(["Jamón 0.150 kg"]);
  });
  it("makes Bar work here and prints Grill work in the same send", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, venue.aguaId, grill.id);
      const barPrinter = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, venue.cfg.locationId, grill.id);
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
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
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
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
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
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

  it("prints an unkept Bar item sent by a different device whose list is empty", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const printer = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const barDeviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Other till", formFactor: "till", capabilities: [] })
        .returning();
      const [other] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          deviceProfileId: profile!.id,
          label: "Other",
          tokenHash: "test",
        })
        .returning();
      expect(other!.id).not.toBe(barDeviceId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.cafeId, 1);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: other!.id }, orderId, [line]);
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
      const barPrinter = await stationPrinter(tx, venue.cfg.locationId, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, venue.cfg.locationId, grill.id);
      const first = await createCourse(tx, venue.cfg, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, venue.cfg, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
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
        firedAt: expect.any(String),
      });
      expect(initial.find((item) => item.workingOrderLineId === burger.id)!.firedAt).toBeNull();
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinter)),
      ).toHaveLength(0);
      await fireCourse(
        tx,
        { ...venue.cfg, origin: deviceOrigin(deviceId) },
        orderId,
        second.id,
        randomUUID(),
      );
      const [released] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, burger.id));
      expect(released!.firedAt).toEqual(expect.any(String));
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinter)),
      ).toHaveLength(0);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, grillPrinter)),
      ).toHaveLength(1);
    });
  });

  it("does not count a made-here later course as started for a later round", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, venue.aguaId, grill.id);
      const first = await createCourse(tx, venue.cfg, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, venue.cfg, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(tx, venue.cfg.locationId, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const burger = await rawLine(tx, orderId, venue.aguaId, 1, first.id);
      const drink = await rawLine(tx, orderId, venue.cafeId, 2, second.id);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [burger, drink]);
      const [madeDrink] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, drink.id));
      expect(madeDrink).toMatchObject({ madeHere: true, state: "ready" });
      expect(madeDrink!.firedAt).toEqual(expect.any(String));
      expect(madeDrink!.readyAt).toBe(madeDrink!.firedAt);
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
