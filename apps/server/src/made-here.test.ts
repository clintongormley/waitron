import { setMadeHere } from "./testing/made-here-fixture.js";
import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { createTableKitchenOrder } from "./testing/kitchen-table-order.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
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
import { seedDevice, seedDeviceProfiles, seedActivityActor } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { createCourse, createStation } from "./kitchen.js";
import {
  readMadeHereStations,
  listMadeHereStations,
  requireMadeHereStations,
  readMadeHereItems,
  madeHereAnswer,
  madeHereSinkFor,
} from "./made-here.js";
import { createOpenOrder, fireOrderLines, fireLines, listStationQueue } from "./working-order.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { attachPrinterToStation } from "./station-printers.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { setStationToday } from "@waitron/venue-service";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function stationPrinter(tx: Transaction, stationId: string): Promise<string> {
  const { id } = await createPrinter(tx, {
    name: `Printer ${randomUUID()}`,
    transport: "cloud_poll",
    pollId: randomUUID(),
  });
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
      takeawayVatClass: "general",
      lineTotal: 150,
      courseId,
    })
    .returning();
  return { id: line!.id, productId, parentLineId: null, courseId, note: null, quantity: 1000 };
}

async function deviceAt(tx: Transaction, stationId: string): Promise<string> {
  const [profile] = await seedDeviceProfiles(tx, {
    name: "Till",
    formFactor: "till",
    capabilities: [],
  });
  const { deviceId } = await seedDevice(tx, { profileId: profile!.id, label: "Bar till" });
  await setMadeHere(tx, deviceId, [stationId]);
  return deviceId;
}

async function saveMadeHere(tx: Transaction, deviceId: string, stationIds: string[]) {
  await requireMadeHereStations(tx, stationIds);
  await setMadeHere(tx, deviceId, stationIds);
}

describe("device made-here stations", () => {
  it("prints at today's chosen destination when a made-here station closes by hand", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const bar = await createStation(tx, { name: "Bar" });
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      await routeProductTo(tx, venue.coffeeId, bar.id);
      const downstairsPrinter = await stationPrinter(tx, downstairs.id);
      const deviceId = await deviceAt(tx, bar.id);
      await setStationToday(
        tx,
        bar.id,
        "closed",
        new Date(),
        await seedActivityActor(tx),
        downstairs.id,
      );
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const lager = await rawLine(tx, orderId, venue.coffeeId, 1);
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

  it("releases a made-here later-course drink immediately and never prints it on line release or reprint", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, { name: "Grill" });
      await routeProductTo(tx, venue.waterId, grill.id);
      const barPrinter = await stationPrinter(tx, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, grill.id);
      const first = await createCourse(tx, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const cfg = { ...venue.cfg, sendingDeviceId: deviceId };
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const burger = await rawLine(tx, orderId, venue.waterId, 1, first.id);
      const drink = await rawLine(tx, orderId, venue.coffeeId, 2, second.id);
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
      await fireOrderLines(tx, { ...venue.cfg, origin: deviceOrigin(deviceId) }, orderId, [
        drink.id,
      ]);
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
      const allMade = await ticketItemsWithBill(tx).where(
        eq(workingOrderLines.workingOrderId, orderId),
      );
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
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.coffeeId, 1);
      lineId = line.id;
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [line]);
    });
    const app = new Hono();
    app.use("/api/*", madeHereAnswer(suite.db));
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
    expect(await readMadeHereItems(suite.db, new Set([randomUUID()]))).toEqual([]);
  });
  // The till writes these in its own screen language, as it writes the dish above them.
  it("answers each extra as data: its saved amount and unit names, and its count per dish", async () => {
    const venue = await setupVenue(suite.db);
    const drinkId = await withTransaction(suite.db, async (tx) => {
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const drink = await rawLine(tx, orderId, venue.coffeeId, 1);
      const extra = {
        workingOrderId: orderId,
        parentLineId: drink.id,
        productId: venue.waterId,
        priceQuantity: 50,
        unitPriceGross: 1,
        vatClass: "general",
        takeawayVatClass: "general",
        lineTotal: 3,
      };
      await tx.insert(workingOrderLines).values([
        {
          ...extra,
          lineNo: 2,
          name: "Jamón",
          descriptions: { "es-ES": "Jamón" },
          quantity: 150,
          unitName: { en: "srv", es: "rac" },
        },
        {
          ...extra,
          lineNo: 3,
          name: "Lima",
          descriptions: { "es-ES": "Lima" },
          quantity: 2000,
        },
      ]);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [drink]);
      return drink.id;
    });
    const items = await readMadeHereItems(suite.db, new Set([drinkId]));
    expect(items).toHaveLength(1);
    expect(items[0]!.extras).toEqual([
      {
        name: "Jamón",
        quantity: "0.150",
        unitName: { en: "srv", es: "rac" },
        soldInEach: false,
        perDish: 1,
      },
      { name: "Lima", quantity: "2.000", unitName: null, soldInEach: false, perDish: 2 },
    ]);
  });
  it("makes Bar work here and prints Grill work in the same send", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const grill = await createStation(tx, { name: "Grill" });
      await routeProductTo(tx, venue.waterId, grill.id);
      const barPrinter = await stationPrinter(tx, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, grill.id);
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const bar = await rawLine(tx, orderId, venue.coffeeId, 1);
      const food = await rawLine(tx, orderId, venue.waterId, 2);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [bar, food]);
      const items = await ticketItemsWithBill(tx).where(
        eq(workingOrderLines.workingOrderId, orderId),
      );
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
      const downstairs = await createStation(tx, { name: "Downstairs bar" });
      await routeProductTo(tx, venue.coffeeId, downstairs.id);
      const printer = await stationPrinter(tx, downstairs.id);
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.coffeeId, 1);
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
      const printer = await stationPrinter(tx, venue.defaultStationId);
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const ordinary = await rawLine(tx, orderId, venue.coffeeId, 1);
      const changed = await rawLine(tx, orderId, venue.coffeeId, 2);
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
      const items = await ticketItemsWithBill(tx).where(
        eq(workingOrderLines.workingOrderId, orderId),
      );
      expect(items.map((item) => item.madeHere)).toEqual([false, false]);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer)),
      ).toHaveLength(1);
    });
  });

  it("applies a kept made-here decision even when the sending device lists nothing", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const printer = await stationPrinter(tx, venue.defaultStationId);
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Other till",
        formFactor: "till",
        capabilities: [],
      });
      const device = {
        id: (await seedDevice(tx, { profileId: profile!.id, label: "Other" })).deviceId,
      };
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.coffeeId, 1);
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
      const printer = await stationPrinter(tx, venue.defaultStationId);
      const barDeviceId = await deviceAt(tx, venue.defaultStationId);
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Other till",
        formFactor: "till",
        capabilities: [],
      });
      const other = {
        id: (await seedDevice(tx, { profileId: profile!.id, label: "Other" })).deviceId,
      };
      expect(other!.id).not.toBe(barDeviceId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.coffeeId, 1);
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
      const printer = await stationPrinter(tx, venue.defaultStationId);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const line = await rawLine(tx, orderId, venue.coffeeId, 1);
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
      const grill = await createStation(tx, { name: "Grill" });
      await routeProductTo(tx, venue.waterId, grill.id);
      const barPrinter = await stationPrinter(tx, venue.defaultStationId);
      const grillPrinter = await stationPrinter(tx, grill.id);
      const first = await createCourse(tx, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = await createTableKitchenOrder(tx, venue.cfg);
      const drink = await rawLine(tx, orderId, venue.coffeeId, 1, first.id);
      const burger = await rawLine(tx, orderId, venue.waterId, 2, second.id);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [drink, burger]);
      const initial = await ticketItemsWithBill(tx).where(
        eq(workingOrderLines.workingOrderId, orderId),
      );
      expect(initial.find((item) => item.workingOrderLineId === drink.id)).toMatchObject({
        madeHere: true,
        state: "ready",
        firedAt: expect.any(String),
      });
      expect(initial.find((item) => item.workingOrderLineId === burger.id)!.firedAt).toBeNull();
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, barPrinter)),
      ).toHaveLength(0);
      await fireOrderLines(tx, { ...venue.cfg, origin: deviceOrigin(deviceId) }, orderId, [
        burger.id,
      ]);
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
      const grill = await createStation(tx, { name: "Grill" });
      await routeProductTo(tx, venue.waterId, grill.id);
      const first = await createCourse(tx, { name: "First", displayOrder: 1 });
      const second = await createCourse(tx, { name: "Second", displayOrder: 2 });
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const orderId = await createTableKitchenOrder(tx, venue.cfg);
      const burger = await rawLine(tx, orderId, venue.waterId, 1, first.id);
      const drink = await rawLine(tx, orderId, venue.coffeeId, 2, second.id);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [burger, drink]);
      const [madeDrink] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, drink.id));
      expect(madeDrink).toMatchObject({ madeHere: true, state: "ready" });
      expect(madeDrink!.firedAt).toEqual(expect.any(String));
      expect(madeDrink!.readyAt).toBe(madeDrink!.firedAt);
      const steak = await rawLine(tx, orderId, venue.waterId, 3, second.id);
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
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Till",
        formFactor: "till",
        capabilities: [],
      });
      const device = {
        id: (await seedDevice(tx, { profileId: profile!.id, label: "Bar till" })).deviceId,
      };
      await saveMadeHere(tx, device!.id, [venue.defaultStationId]);
      const orderId = randomUUID();
      await createOpenOrder(tx, venue.cfg, orderId, [], null);
      const [line] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: orderId,
          lineNo: 1,
          productId: venue.coffeeId,
          name: "Coffee",
          descriptions: { "es-ES": "Café" },
          quantity: 1000,
          unitPriceGross: 150,
          vatClass: "general",
          takeawayVatClass: "general",
          lineTotal: 150,
        })
        .returning();
      const before = await tx.select({ id: printJobs.id }).from(printJobs);
      await fireLines(tx, { ...venue.cfg, sendingDeviceId: device!.id }, orderId, [
        {
          id: line!.id,
          productId: venue.coffeeId,
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
  it("replaces one station, refuses several without losing it, and clears to Nowhere", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const deviceId = await deviceAt(tx, venue.defaultStationId);
      const bar = await createStation(tx, { name: "Bar" });
      await expect(
        saveMadeHere(tx, deviceId, [bar.id, venue.defaultStationId]),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "madeHereStationIds" },
      });
      expect(await readMadeHereStations(tx, deviceId)).toEqual(new Set([venue.defaultStationId]));
      await saveMadeHere(tx, deviceId, [bar.id]);
      expect(await readMadeHereStations(tx, deviceId)).toEqual(new Set([bar.id]));
      expect((await listMadeHereStations(tx)).get(deviceId)).toEqual([bar.id]);
      await saveMadeHere(tx, deviceId, []);
      expect(await readMadeHereStations(tx, deviceId)).toEqual(new Set());
      expect((await listMadeHereStations(tx)).has(deviceId)).toBe(false);
      expect(await readMadeHereStations(tx, undefined)).toEqual(new Set());
    });
  });

  it.each(["phone-portrait", "kds"] as const)(
    "a saved station on a %s profile does not suppress kitchen output",
    async (formFactor) => {
      const venue = await setupVenue(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const [profile] = await seedDeviceProfiles(tx, {
          name: "Portable",
          formFactor,
          capabilities: [],
        });
        const { deviceId } = await seedDevice(tx, { profileId: profile!.id, label: "Device" });
        await setMadeHere(tx, deviceId, [venue.defaultStationId]);
        const printerId = await stationPrinter(tx, venue.defaultStationId);
        const orderId = randomUUID();
        await createOpenOrder(tx, venue.cfg, orderId, [], null);
        const drink = await rawLine(tx, orderId, venue.coffeeId, 1);
        await fireLines(tx, { ...venue.cfg, sendingDeviceId: deviceId }, orderId, [drink]);
        expect(await readMadeHereStations(tx, deviceId)).toEqual(new Set());
        expect((await listMadeHereStations(tx)).has(deviceId)).toBe(false);
        const [item] = await tx
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, drink.id));
        expect(item).toMatchObject({
          stationId: venue.defaultStationId,
          madeHere: false,
          state: "queued",
        });
        expect(
          await tx.select().from(printJobs).where(eq(printJobs.printerId, printerId)),
        ).toHaveLength(1);
      });
    },
  );

  it("refuses switched-off stations with station.not_found", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Till",
        formFactor: "till",
        capabilities: [],
      });
      const device = {
        id: (await seedDevice(tx, { profileId: profile!.id, label: "Counter" })).deviceId,
      };
      const off = await createStation(tx, { name: "Off" });
      await saveMadeHere(tx, device!.id, [venue.defaultStationId]);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, off.id));
      await expect(saveMadeHere(tx, device!.id, [off.id])).rejects.toMatchObject({
        code: "station.not_found",
      });
      expect(await readMadeHereStations(tx, device!.id)).toEqual(new Set([venue.defaultStationId]));
    });
  });

  it("keeps two devices on the same profile independent", async () => {
    const venue = await setupVenue(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Shared",
        formFactor: "till",
        capabilities: [],
      });
      const [a, b] = [
        { id: (await seedDevice(tx, { profileId: profile!.id, label: "A" })).deviceId },
        { id: (await seedDevice(tx, { profileId: profile!.id, label: "B" })).deviceId },
      ];
      const bar = await createStation(tx, { name: "Other bar" });
      await saveMadeHere(tx, b!.id, [bar.id]);
      await saveMadeHere(tx, a!.id, [venue.defaultStationId]);
      expect(await readMadeHereStations(tx, a!.id)).toEqual(new Set([venue.defaultStationId]));
      expect(await readMadeHereStations(tx, b!.id)).toEqual(new Set([bar.id]));
    });
  });
});
