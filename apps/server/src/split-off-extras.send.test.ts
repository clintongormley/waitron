import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  kitchenStations,
  printJobs,
  products,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCategory, createProduct } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import {
  addExtras,
  createOfferedOrder,
  fireNewOrder,
  setupVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { claimFolderFor } from "./testing/zone-offers.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { fireLines, unsentDishLines } from "./working-order.js";
import { setClaim } from "@waitron/venue-service";
import { setStationFallback, setStationToday } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { placeGroups } from "./order-groups.js";
import { OPERATOR, seat, setupPartyVenue } from "./testing/party-venue.js";
import { republishMenus } from "./testing/publish-menu.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});

async function recordsFor(tx: Transaction, orderId: string) {
  return tx
    .select({
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
      courseId: ticketItems.courseId,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, orderId));
}

async function sendWithHold(
  tx: Transaction,
  cfg: Awaited<ReturnType<typeof setupVenue>>["cfg"],
  productId: string,
  listId: string,
  extraId: string,
  hold: boolean,
) {
  const orderId = randomUUID();
  await createOfferedOrder(tx, cfg, orderId, [
    {
      productId,
      quantity: "1",
      extras: [{ listId, picks: [{ productId: extraId, quantity: 1 }] }],
    },
  ]);
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId));
  await fireLines(
    tx,
    cfg,
    orderId,
    lines.map((line) => ({ ...line, hold })),
  );
  return { orderId, lines };
}

describe("sending split-off extras", () => {
  it("gives claimed chips their own record, with the extra line's quantity and the dish's fire time", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id, maxQuantity: 2 },
      ]);
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: burger.id,
          quantity: "2",
          extras: [{ listId, picks: [{ productId: chips!, quantity: 2 }] }],
        },
      ]);
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          parentLineId: workingOrderLines.parentLineId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      const records = await tx
        .select({
          lineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          quantity: ticketItems.quantity,
          courseId: ticketItems.courseId,
          firedAt: ticketItems.firedAt,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      return { lines, records, grill: grill.id, fryer: fryer.id };
    });
    const dish = result.lines.find((line) => line.parentLineId === null)!;
    const extra = result.lines.find((line) => line.parentLineId === dish.id)!;
    const dishRecord = result.records.find((record) => record.lineId === dish.id)!;
    const extraRecord = result.records.find((record) => record.lineId === extra.id);
    expect(dishRecord.stationId).toBe(result.grill);
    expect(extraRecord).toMatchObject({
      stationId: result.fryer,
      courseId: dishRecord.courseId,
      firedAt: dishRecord.firedAt,
      quantity: extra.quantity,
    });
    expect(extra.quantity).toBe(4000);
  });

  it("does not give an unclaimed extra a separate record", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [cheese],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [{ name: "Cheese" }]);
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: burger.id,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: cheese!, quantity: 1 }] }],
        },
      ]);
      expect(await recordsFor(tx, orderId)).toEqual([
        expect.objectContaining({ stationId: grill.id }),
      ]);
    });
  });

  it("prints a claimed extra when its no-preparation dish has no kitchen record", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const sides = await createCategory(tx, { name: "Sides" });
      await setClaim(tx, cfg, drinks.id, { kind: "no_preparation" });
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const printer = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        { name: "Fryer printer", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
      );
      await attachPrinterToStation(tx, { stationId: fryer.id, printerId: printer.id });
      const water = await createProduct(tx, {
        catalogueId,
        categoryId: drinks.id,
        name: "Water",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, water.id, [
        { name: "Chips", kitchenName: "CHIPS", categoryId: sides.id },
      ]);
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: water.id,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
        },
      ]);
      expect(await recordsFor(tx, orderId)).toEqual([
        expect.objectContaining({ stationId: fryer.id, firedAt: expect.any(String) }),
      ]);
      const jobs = await tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printer.id));
      expect(jobs).toHaveLength(1);
      expect(decodeTicket(jobs[0]!.payload)).toContain("CHIPS");
    });
  });

  it("gives a no-preparation dish with an unclaimed extra no kitchen records", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const drinks = await createCategory(tx, { name: "Drinks" });
      await setClaim(tx, cfg, drinks.id, { kind: "no_preparation" });
      const water = await createProduct(tx, {
        catalogueId,
        categoryId: drinks.id,
        name: "Water",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [cheese],
      } = await addExtras(tx, cfg, catalogueId, water.id, [{ name: "Cheese" }]);
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: water.id,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: cheese!, quantity: 1 }] }],
        },
      ]);
      expect(await recordsFor(tx, orderId)).toEqual([]);
    });
  });

  it("releases an existing held extra when a no-preparation dish is sent again", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const sides = await createCategory(tx, { name: "Sides" });
      await setClaim(tx, cfg, drinks.id, { kind: "no_preparation" });
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const water = await createProduct(tx, {
        catalogueId,
        categoryId: drinks.id,
        name: "Water",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      const later = await createCourse(tx, cfg, { name: "Later", displayOrder: 2 });
      await setProductCourse(tx, cfg, water.id, later.id);
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, water.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const { orderId, lines } = await sendWithHold(tx, cfg, water.id, listId, chips!, true);
      expect((await recordsFor(tx, orderId))[0]!.courseId).toBe(later.id);
      expect((await recordsFor(tx, orderId)).map((row) => row.firedAt)).toEqual([null]);
      const fresh = await unsentDishLines(tx, orderId);
      await fireLines(
        tx,
        cfg,
        orderId,
        fresh.map((line) => ({ ...line, hold: true })),
      );
      expect((await recordsFor(tx, orderId)).map((row) => row.firedAt)).toEqual([null]);
      await fireLines(
        tx,
        cfg,
        orderId,
        fresh.map((line) => ({ ...line, release: true })),
      );
      const records = await recordsFor(tx, orderId);
      expect(records).toHaveLength(1);
      expect(records.every((row) => row.firedAt !== null)).toBe(true);
      expect(
        records.find((row) => row.lineId === lines.find((line) => line.parentLineId !== null)!.id)!
          .stationId,
      ).toBe(fryer.id);
    });
  });

  it("opens one routing snapshot to decide both dish and extra, without the wrappers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const opened = vi.spyOn(VENUE_SERVICE, "routingAt");
      const dishes = vi.spyOn(VENUE_SERVICE, "resolveMakers");
      const extras = vi.spyOn(VENUE_SERVICE, "resolveExtraMakers");
      try {
        await fireNewOrder(tx, cfg, [
          {
            productId: burger.id,
            quantity: "1",
            extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
          },
        ]);
        expect(opened).toHaveBeenCalledTimes(1);
        expect(dishes).not.toHaveBeenCalled();
        expect(extras).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  it("omits an extra at a closed station, then sends it to that station's fallback", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const kitchen = await createStation(tx, cfg, { name: "Kitchen" });
      const burgers = await createCategory(tx, { name: "Burgers" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, burgers.id, grill.id);
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: burgers.id,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const order = () =>
        fireNewOrder(tx, cfg, [
          {
            productId: burger.id,
            quantity: "1",
            extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
          },
        ]);
      await setStationToday(tx, cfg, fryer.id, "closed", new Date());
      const without = await order();
      expect((await recordsFor(tx, without)).map((row) => row.stationId)).toEqual([grill.id]);
      await setStationFallback(tx, cfg, fryer.id, kitchen.id);
      const withFallback = await order();
      expect((await recordsFor(tx, withFallback)).map((row) => row.stationId).sort()).toEqual(
        [grill.id, kitchen.id].sort(),
      );
    });
  });

  it("uses the dish's chosen station when deciding whether chips split off", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const sendAt = async (stationId: string) => {
        const orderId = randomUUID();
        await createOfferedOrder(tx, cfg, orderId, [
          {
            productId: burger.id,
            quantity: "1",
            extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
          },
        ]);
        await tx
          .update(workingOrderLines)
          .set({ makeAtStationId: stationId })
          .where(
            and(
              eq(workingOrderLines.workingOrderId, orderId),
              isNull(workingOrderLines.parentLineId),
            ),
          );
        await fireLines(tx, cfg, orderId, await unsentDishLines(tx, orderId));
        return recordsFor(tx, orderId);
      };
      expect((await sendAt(bar.id)).map((row) => row.stationId).sort()).toEqual(
        [bar.id, fryer.id].sort(),
      );
      expect((await sendAt(fryer.id)).map((row) => row.stationId)).toEqual([fryer.id]);
    });
  });

  it("sets aside an unroutable dish with its otherwise routable extra", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchen = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [
        {
          productId: burger.id,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
        },
      ]);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, kitchen.id));
      const unsent = await unsentDishLines(tx, orderId);
      const setAside = await fireLines(tx, cfg, orderId, unsent, { unroutable: "skip" });
      expect(setAside.map((line) => line.productId)).toEqual([burger.id]);
      expect(await recordsFor(tx, orderId)).toEqual([]);
    });
  });

  it("refuses a dish with no replacement before writing its extra's record", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const grill = await createStation(tx, cfg, { name: "Grill" });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const burgers = await createCategory(tx, { name: "Burgers" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, burgers.id, grill.id);
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: burgers.id,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const orderId = randomUUID();
      await createOfferedOrder(tx, cfg, orderId, [
        {
          productId: burger.id,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
        },
      ]);
      await setStationToday(tx, cfg, grill.id, "closed", new Date());
      await expect(
        fireLines(tx, cfg, orderId, await unsentDishLines(tx, orderId)),
      ).rejects.toMatchObject({ code: "station.no_replacement" });
      expect(await recordsFor(tx, orderId)).toEqual([]);
    });
  });

  it("shares one routing snapshot across a fired and a held group in one submission", async () => {
    const venue = await setupPartyVenue(db);
    const tableId = await venue.table(`T-${randomUUID().slice(0, 6)}`);
    const { partyId } = await seat(venue, tableId);
    await withTransaction(db, async (tx) => {
      const fryer = await createStation(tx, venue.cfg, { name: "Fryer" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, venue.cfg, sides.id, fryer.id);
      const [burger] = await tx
        .select({ catalogueId: products.catalogueId })
        .from(products)
        .where(eq(products.id, venue.productId("Burger")));
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, venue.cfg, burger!.catalogueId, venue.productId("Burger"), [
        { name: "Chips", categoryId: sides.id },
      ]);
      await republishMenus(tx);
      const line = {
        menuItemId: venue.item("Burger"),
        quantity: "1",
        extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
      };
      const opened = vi.spyOn(VENUE_SERVICE, "routingAt");
      const dishes = vi.spyOn(VENUE_SERVICE, "resolveMakers");
      try {
        const placed = await placeGroups(tx, venue.cfg, partyId, {
          operatorId: OPERATOR,
          groups: [
            { release: "fire", lines: [line] },
            { release: "hold", lines: [line] },
          ],
        });
        expect(opened).toHaveBeenCalledTimes(1);
        expect(dishes).not.toHaveBeenCalled();
        expect(await recordsFor(tx, placed.tabId)).toHaveLength(4);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  it("makes a split-off extra here immediately even while its dish is held", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const sides = await createCategory(tx, { name: "Sides" });
      await claimFolderFor(tx, cfg, sides.id, bar.id);
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Chips", categoryId: sides.id },
      ]);
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Bar till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id });
      const [device] = await tx
        .insert(devices)
        .values({
          locationId: cfg.locationId,
          tillId: cfg.tillId,
          deviceProfileId: profile!.id,
          label: "Bar till",
          tokenHash: "test",
        })
        .returning({ id: devices.id });
      await tx.insert(deviceMadeHereStations).values({ deviceId: device!.id, stationId: bar.id });
      const sink = new Set<string>();
      const { orderId, lines } = await sendWithHold(
        tx,
        { ...cfg, sendingDeviceId: device!.id, madeHereSink: sink },
        burger.id,
        listId,
        chips!,
        true,
      );
      const records = await tx
        .select({
          lineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          firedAt: ticketItems.firedAt,
          madeHere: ticketItems.madeHere,
          state: ticketItems.state,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      const dish = records.find((row) => row.stationId === grill.id)!;
      const extra = records.find((row) => row.stationId === bar.id)!;
      expect(dish.firedAt).toBeNull();
      expect(extra).toMatchObject({ madeHere: true, state: "ready", firedAt: expect.any(String) });
      expect(sink.has(lines.find((line) => line.parentLineId !== null)!.id)).toBe(true);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.locationId, cfg.locationId)),
      ).toEqual([]);
    });
  });
});
