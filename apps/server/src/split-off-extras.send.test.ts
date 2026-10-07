import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  diningTables,
  kitchenStations,
  printJobs,
  products,
  stationPrinters,
  watcherPrinters,
  watcherStations,
  watchers,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCategory, createProduct, getExtraList, readCategory } from "@waitron/catalogue";
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
import { addTabRound, fireLines, unsentDishLines } from "./working-order.js";
import { routingCells, setRoutingCell } from "@waitron/venue-service";
import { setStationFallback, setStationToday } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { fireGroup, placeGroups } from "./order-groups.js";
import { OPERATOR, seat, setupPartyVenue } from "./testing/party-venue.js";
import { republishMenus } from "./testing/publish-menu.js";
import * as splitVenue from "./testing/split-extras-venue.js";
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
afterEach(async () => {
  const rows = await db
    .select({
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
    })
    .from(products);
  for (const row of rows) {
    expect(row.kitchenName).not.toBeNull();
    const customer = Object.values(row.customerName ?? {})[0];
    expect(customer).toBeDefined();
    expect(new Set([row.name, customer, row.kitchenName]).size).toBe(3);
  }
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
  it("requires three distinct names for new split-extra products", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      await expect(
        addExtras(tx, cfg, catalogueId, burger.id, [{ name: "Chips" } as never]),
      ).rejects.toThrow("three distinct names");
      await expect(
        addExtras(tx, cfg, catalogueId, burger.id, [
          { name: "Chips", customerName: "Chips", kitchenName: "CHIPS" },
        ]),
      ).rejects.toThrow("three distinct names");
    });
  });

  it("builds the named reusable venue with separate kitchen, customer and staff names", async () => {
    const venue = await splitVenue.setupSplitExtrasVenue();
    expect(venue).toMatchObject({
      stations: {
        grill: expect.any(String),
        fryer: expect.any(String),
        kitchen: expect.any(String),
        bar: expect.any(String),
      },
      printers: {
        grill: expect.any(String),
        fryer: expect.any(String),
        kitchen: expect.any(String),
        bar: expect.any(String),
        pass: expect.any(String),
      },
      folders: {
        food: expect.any(String),
        burgers: expect.any(String),
        extras: expect.any(String),
        sides: expect.any(String),
        toppings: expect.any(String),
        sauces: expect.any(String),
        drinks: expect.any(String),
        bottled: expect.any(String),
      },
      products: {
        burger: expect.any(String),
        chips: expect.any(String),
        cheese: expect.any(String),
        sauce: expect.any(String),
        water: expect.any(String),
        onionRings: expect.any(String),
      },
      lists: { burger: expect.any(String), water: expect.any(String) },
      party: {
        partyId: expect.any(String),
        tabId: expect.any(String),
        tableId: expect.any(String),
        zoneId: expect.any(String),
      },
      counter: { zoneId: expect.any(String) },
    });
    const names = [
      ["burger", "Burger", "Hamburguesa clásica", "BURG"],
      ["chips", "Chips", "Patatas fritas", "CHIPS"],
      ["cheese", "Cheese", "Queso extra", "QUESO"],
      ["sauce", "Sauce", "Salsa brava", "SALSA"],
      ["water", "Water", "Agua mineral", "AGUA"],
      ["onionRings", "Onion rings", "Aros de cebolla", "AROS"],
    ] as const;
    await withTransaction(db, async (tx) => {
      for (const [key, staff, customer, kitchen] of names) {
        const [row] = await tx
          .select({
            name: products.name,
            customerName: products.customerName,
            kitchenName: products.kitchenName,
            allergens: products.allergens,
          })
          .from(products)
          .where(eq(products.id, venue.products[key]));
        expect(row?.name).toBe(staff);
        expect(Object.values(row?.customerName ?? {})).toContain(customer);
        expect(row?.kitchenName).toBe(kitchen);
        expect(new Set([row!.name, customer, row!.kitchenName]).size).toBe(3);
        if (key === "chips")
          expect(row?.allergens).toMatchObject({ gluten: { presence: "contains" } });
      }
      for (const station of ["grill", "fryer", "kitchen", "bar"] as const) {
        const attached = await tx
          .select()
          .from(stationPrinters)
          .where(
            and(
              eq(stationPrinters.stationId, venue.stations[station]),
              eq(stationPrinters.printerId, venue.printers[station]),
            ),
          );
        expect(attached).toHaveLength(1);
      }
      const pass = await tx
        .select({ name: watchers.name, stationId: watcherStations.stationId })
        .from(watcherPrinters)
        .innerJoin(watchers, eq(watchers.id, watcherPrinters.watcherId))
        .innerJoin(watcherStations, eq(watcherStations.watcherId, watchers.id))
        .where(eq(watcherPrinters.printerId, venue.printers.pass));
      expect(pass.map((row) => row.name)).toEqual(["Pase", "Pase"]);
      expect(new Set(pass.map((row) => row.stationId))).toEqual(
        new Set([venue.stations.grill, venue.stations.fryer]),
      );
      const [table] = await tx
        .select({ zoneId: diningTables.zoneId })
        .from(diningTables)
        .where(eq(diningTables.id, venue.party.tableId));
      expect(table?.zoneId).toBe(venue.party.zoneId);
      for (const [child, parent] of [
        ["burgers", "food"],
        ["sides", "extras"],
        ["toppings", "extras"],
        ["sauces", "extras"],
        ["bottled", "drinks"],
      ] as const) {
        expect((await readCategory(tx, venue.folders[child])).parentId).toBe(venue.folders[parent]);
      }
      const claims = await tx
        .select({
          categoryId: routingCells.categoryId,
          productId: routingCells.productId,
          zoneId: routingCells.zoneId,
          stationId: routingCells.stationId,
          noPreparation: routingCells.noPreparation,
        })
        .from(routingCells)
        .where(eq(routingCells.locationId, venue.cfg.locationId));
      expect(claims).toHaveLength(4);
      expect(claims).toEqual(
        expect.arrayContaining([
          {
            categoryId: venue.folders.burgers,
            productId: null,
            zoneId: null,
            stationId: venue.stations.grill,
            noPreparation: false,
          },
          {
            categoryId: venue.folders.sides,
            productId: null,
            zoneId: null,
            stationId: venue.stations.fryer,
            noPreparation: false,
          },
          {
            categoryId: venue.folders.sauces,
            productId: null,
            zoneId: null,
            stationId: null,
            noPreparation: true,
          },
          {
            categoryId: venue.folders.bottled,
            productId: null,
            zoneId: null,
            stationId: null,
            noPreparation: true,
          },
        ]),
      );
      for (const listId of [venue.lists.burger, venue.lists.water]) {
        const list = await getExtraList(tx, listId);
        expect(list.items.map((item) => [item.productId, item.maxQuantity])).toEqual([
          [venue.products.chips, 2],
          [venue.products.onionRings, 2],
          [venue.products.cheese, 2],
          [venue.products.sauce, 2],
        ]);
      }
    });
  });

  it("gives claimed chips their own record, with the extra line's quantity and the dish's fire time", async () => {
    const venue = await splitVenue.setupSplitExtrasVenue();
    const result = await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        {
          menuItemId: venue.tables.offerFor(venue.products.burger),
          quantity: "2",
          extras: [
            {
              listId: venue.lists.burger,
              picks: [
                { productId: venue.products.chips, quantity: 2 },
                { productId: venue.products.cheese, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          parentLineId: workingOrderLines.parentLineId,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, venue.party.tabId));
      const records = await tx
        .select({
          lineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          quantity: ticketItems.quantity,
          courseId: ticketItems.courseId,
          firedAt: ticketItems.firedAt,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, venue.party.tabId));
      return { lines, records };
    });
    const dish = result.lines.find((line) => line.parentLineId === null)!;
    const extra = result.lines.find((line) => line.productId === venue.products.chips)!;
    const cheese = result.lines.find((line) => line.productId === venue.products.cheese)!;
    const dishRecord = result.records.find((record) => record.lineId === dish.id)!;
    const extraRecord = result.records.find((record) => record.lineId === extra.id);
    expect(dishRecord.stationId).toBe(venue.stations.grill);
    expect(extraRecord).toMatchObject({
      stationId: venue.stations.fryer,
      courseId: dishRecord.courseId,
      firedAt: dishRecord.firedAt,
      quantity: extra.quantity,
    });
    expect(extra.quantity).toBe(4000);
    expect(result.records.some((record) => record.lineId === cheese.id)).toBe(false);
  });

  it("does not give an unclaimed extra a separate record", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const grill = await createStation(tx, cfg, { name: "Grill", isDefault: true });
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Burger",
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [cheese],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        { name: "Cheese", customerName: "Queso extra", kitchenName: "QUESO" },
      ]);
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
      await setRoutingCell(
        tx,
        cfg,
        { row: { kind: "category", categoryId: drinks.id }, zoneId: null },
        { kind: "no_preparation" },
      );
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
        customerName: { "es-ES": "Agua mineral" },
        kitchenName: "AGUA",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, water.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
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
      await setRoutingCell(
        tx,
        cfg,
        { row: { kind: "category", categoryId: drinks.id }, zoneId: null },
        { kind: "no_preparation" },
      );
      const water = await createProduct(tx, {
        catalogueId,
        categoryId: drinks.id,
        name: "Water",
        customerName: { "es-ES": "Agua mineral" },
        kitchenName: "AGUA",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [cheese],
      } = await addExtras(tx, cfg, catalogueId, water.id, [
        { name: "Cheese", customerName: "Queso extra", kitchenName: "QUESO" },
      ]);
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

  it("keeps an extra claimed as no preparation on its burger's ticket", async () => {
    const venue = await splitVenue.setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        {
          menuItemId: venue.tables.offerFor(venue.products.burger),
          quantity: "1",
          extras: [
            {
              listId: venue.lists.burger,
              picks: [{ productId: venue.products.sauce, quantity: 1 }],
            },
          ],
        },
      ]);
      const records = await recordsFor(tx, venue.party.tabId);
      expect(records).toHaveLength(1);
      expect(records[0]!.stationId).toBe(venue.stations.grill);
    });
  });

  it("releases an existing held extra when a no-preparation dish is sent again", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const fryer = await createStation(tx, cfg, { name: "Fryer" });
      const printer = await createPrinter(
        tx,
        { locationId: cfg.locationId },
        { name: "Fryer printer", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
      );
      await attachPrinterToStation(tx, { stationId: fryer.id, printerId: printer.id });
      const drinks = await createCategory(tx, { name: "Drinks" });
      const sides = await createCategory(tx, { name: "Sides" });
      await setRoutingCell(
        tx,
        cfg,
        { row: { kind: "category", categoryId: drinks.id }, zoneId: null },
        { kind: "no_preparation" },
      );
      await claimFolderFor(tx, cfg, sides.id, fryer.id);
      const water = await createProduct(tx, {
        catalogueId,
        categoryId: drinks.id,
        name: "Water",
        customerName: { "es-ES": "Agua mineral" },
        kitchenName: "AGUA",
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
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
      ]);
      const { orderId, lines } = await sendWithHold(tx, cfg, water.id, listId, chips!, true);
      expect((await recordsFor(tx, orderId))[0]!.courseId).toBe(later.id);
      expect((await recordsFor(tx, orderId)).map((row) => row.firedAt)).toEqual([null]);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, printer.id)),
      ).toHaveLength(0);
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
      const [waterLine] = await tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, lines.find((line) => line.parentLineId === null)!.id));
      expect(records[0]!.firedAt).toBe(waterLine!.sentAt);
      const jobs = await tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printer.id));
      expect(jobs).toHaveLength(1);
      expect(decodeTicket(jobs[0]!.payload)).toContain("CHIPS");
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
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
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
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
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
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
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
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
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
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
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
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
      ]);
      await republishMenus(tx);
      const line = {
        menuItemId: venue.item("Burger"),
        quantity: "1",
        extras: [{ listId, picks: [{ productId: chips!, quantity: 1 }] }],
      };
      const opened = vi.spyOn(VENUE_SERVICE, "routingAt");
      const dishes = vi.spyOn(VENUE_SERVICE, "resolveMakers");
      const extras = vi.spyOn(VENUE_SERVICE, "resolveExtraMakers");
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
        expect(extras).not.toHaveBeenCalled();
        expect(await recordsFor(tx, placed.tabId)).toHaveLength(4);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  it("loads one routing snapshot for a table round of two burgers with chips and cheese", async () => {
    const venue = await splitVenue.setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const line = {
        menuItemId: venue.tables.offerFor(venue.products.burger),
        quantity: "1",
        extras: [
          {
            listId: venue.lists.burger,
            picks: [
              { productId: venue.products.chips, quantity: 1 },
              { productId: venue.products.cheese, quantity: 1 },
            ],
          },
        ],
      };
      const opened = vi.spyOn(VENUE_SERVICE, "routingAt");
      const dishes = vi.spyOn(VENUE_SERVICE, "resolveMakers");
      const extras = vi.spyOn(VENUE_SERVICE, "resolveExtraMakers");
      try {
        await addTabRound(tx, venue.cfg, venue.party.tabId, [line, line]);
        expect(opened).toHaveBeenCalledTimes(1);
        expect(dishes).not.toHaveBeenCalled();
        expect(extras).not.toHaveBeenCalled();
        const records = await recordsFor(tx, venue.party.tabId);
        expect(records.filter((row) => row.stationId === venue.stations.grill)).toHaveLength(2);
        expect(records.filter((row) => row.stationId === venue.stations.fryer)).toHaveLength(2);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  it("loads one routing snapshot for a table round without extras", async () => {
    const venue = await splitVenue.setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const opened = vi.spyOn(VENUE_SERVICE, "routingAt");
      const dishes = vi.spyOn(VENUE_SERVICE, "resolveMakers");
      const extras = vi.spyOn(VENUE_SERVICE, "resolveExtraMakers");
      try {
        await addTabRound(tx, venue.cfg, venue.party.tabId, [
          { menuItemId: venue.tables.offerFor(venue.products.burger), quantity: "1" },
        ]);
        expect(opened).toHaveBeenCalledTimes(1);
        expect(dishes).not.toHaveBeenCalled();
        expect(extras).not.toHaveBeenCalled();
        expect(await recordsFor(tx, venue.party.tabId)).toHaveLength(1);
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
        customerName: { "es-ES": "Hamburguesa clásica" },
        kitchenName: "BURG",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      const {
        listId,
        productIds: [chips],
      } = await addExtras(tx, cfg, catalogueId, burger.id, [
        {
          name: "Chips",
          customerName: "Patatas fritas",
          kitchenName: "CHIPS",
          categoryId: sides.id,
        },
      ]);
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Bar till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id });
      const [device] = await tx
        .insert(devices)
        .values({
          locationId: cfg.locationId,
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

  it("keeps a made-here extra ready through a held group's release, while another device holds it", async () => {
    const venue = await splitVenue.setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Bar till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id });
      const [here] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          deviceProfileId: profile!.id,
          label: "Here",
          tokenHash: `here-${randomUUID()}`,
        })
        .returning({ id: devices.id });
      const [elsewhere] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          deviceProfileId: profile!.id,
          label: "Elsewhere",
          tokenHash: `elsewhere-${randomUUID()}`,
        })
        .returning({ id: devices.id });
      await tx
        .insert(deviceMadeHereStations)
        .values({ deviceId: here!.id, stationId: venue.stations.fryer });
      const groupLine = {
        menuItemId: venue.tables.offerFor(venue.products.burger),
        quantity: "1",
        extras: [
          { listId: venue.lists.burger, picks: [{ productId: venue.products.chips, quantity: 1 }] },
        ],
      };
      const sink = new Set<string>();
      const placed = await placeGroups(
        tx,
        { ...venue.cfg, sendingDeviceId: here!.id, madeHereSink: sink },
        venue.party.partyId,
        { operatorId: OPERATOR, groups: [{ lines: [groupLine], release: "hold" }] },
      );
      const before = await tx
        .select({
          lineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          firedAt: ticketItems.firedAt,
          madeHere: ticketItems.madeHere,
          state: ticketItems.state,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, placed.tabId));
      const grill = before.find((row) => row.stationId === venue.stations.grill)!;
      const chips = before.find((row) => row.stationId === venue.stations.fryer)!;
      expect(grill.firedAt).toBeNull();
      expect(chips).toMatchObject({ madeHere: true, state: "ready", firedAt: expect.any(String) });
      expect(sink.has(chips.lineId)).toBe(true);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, venue.printers.fryer)),
      ).toHaveLength(0);

      await fireGroup(tx, venue.cfg, venue.party.partyId, placed.groups[0]!.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: placed.revision,
      });
      const after = await tx
        .select({
          lineId: ticketItems.workingOrderLineId,
          firedAt: ticketItems.firedAt,
          madeHere: ticketItems.madeHere,
          state: ticketItems.state,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, placed.tabId));
      expect(after.find((row) => row.lineId === chips.lineId)).toEqual({
        lineId: chips.lineId,
        firedAt: chips.firedAt,
        madeHere: true,
        state: "ready",
      });
      expect(after.find((row) => row.lineId === grill.lineId)!.firedAt).not.toBeNull();
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, venue.printers.grill)),
      ).not.toHaveLength(0);
      expect(
        await tx.select().from(printJobs).where(eq(printJobs.printerId, venue.printers.fryer)),
      ).toHaveLength(0);

      const peer = await placeGroups(
        tx,
        { ...venue.cfg, sendingDeviceId: elsewhere!.id },
        venue.party.partyId,
        { operatorId: OPERATOR, groups: [{ lines: [groupLine], release: "hold" }] },
      );
      const peerItems = await tx
        .select({
          stationId: ticketItems.stationId,
          firedAt: ticketItems.firedAt,
          madeHere: ticketItems.madeHere,
        })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, peer.tabId));
      const heldChips = peerItems.filter((row) => row.stationId === venue.stations.fryer);
      expect(heldChips).toContainEqual({
        stationId: venue.stations.fryer,
        firedAt: null,
        madeHere: false,
      });
    });
  });
});
