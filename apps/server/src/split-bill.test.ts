import { cancelItemForTest } from "./testing/cancel-line.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { sendLines } from "./testing/order-writer-fixture.js";
// The domain outcomes of un-joining a table and settling a tab, single-threaded.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  venueLocationId,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedKitchenStation, seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { listStationNotices } from "@waitron/venue-service";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
  EACH_UNIT,
} from "@waitron/catalogue";
import { nodeId as brandNodeId, thousandthsToDecimal } from "@waitron/shared";
import type { DeviceRequestConfig, OriginConfig } from "./trading-context.js";
import type { WithVenueRowId } from "./testing/venue-row-id.js";
import { deviceRequestCfg } from "./testing/session-device.js";
import { createTable } from "./testing/live-table.js";
import { advanceTicketItem, createOpenOrder, listStationQueue } from "./working-order.js";
import { readScopedPassBoard } from "./pass-board.js";
import { boardCards, EVERY } from "./testing/pass-board-probe.js";
import { createPrinter } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { readReceiptOrder } from "./receipt-order.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { writeGroupedLines } from "./testing/grouped-counter-order.js";
import "./errors.js";
import { splitBill, mergeBills, transferItems } from "./testing/bill-action-fixture.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { moveGuests } from "./testing/table-action-fixture.js";
import { partyRevisionOfOrder } from "./parties.js";
import { cancelLine } from "./testing/cancel-line.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: WithVenueRowId<DeviceRequestConfig>;
  waterId: string;
  hamId: string;
  tableId: string;
  tableId2: string;
}

async function setupVenue(): Promise<Seeded> {
  await seedVenue(db, {
    name: "Barra",
    invoiceLocales: [LOCALE],
    operationDescription: "Venta en establecimiento",
  });
  await seedLegacySellingUnits(db);
  const locationId = await venueLocationId(db);
  const nodeId = await seedNode(db);
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(nodeId),
    locationId: locationId,
    locale: LOCALE,
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  } satisfies WithVenueRowId);
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Daily menu" });
    const drinks = await createCategory(tx, { name: "Drinks" });
    const water = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const ham = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Jamón",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await assignCatalogueToVenue(tx, cat.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    offersByCfg.set(cfg, offers);
    const t1 = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
    const t2 = await createTable(tx, cfg, { label: "T2", zoneId: offers.zoneId });
    return {
      waterId: water.id,
      hamId: ham.id,
      tableId: t1.id,
      tableId2: t2.id,
    };
  });
  return { cfg, ...seeded };
}

/** Each venue's offers in its tables zone, keyed by the venue's config so call sites pass only `cfg`. */
const offersByCfg = new WeakMap<OriginConfig, ZoneOffers>();

/**
 * `openTab`, selling each line through the venue's offer for its product. Its lines are stored
 * grouped, as lines written before portions.
 */
async function openTabWith(
  tx: Transaction,
  cfg: OriginConfig,
  req: { tableId: string; lines?: { productId: string; quantity: string }[] },
) {
  const opened = await openPartyTab(tx, cfg, { tableId: req.tableId });
  const lines = offersByCfg.get(cfg)!.toOfferLines(req.lines ?? []);
  if (lines.length > 0) await writeGroupedLines(tx, cfg, opened.tabId, lines);
  return opened;
}

function asApp<T>(cfg: OriginConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

describe("receipt order grouping", () => {
  it("uses a detached order's label and number, including an absent label", async () => {
    const { cfg } = await setupVenue();
    for (const label of ["Blue umbrella", null]) {
      await asApp(cfg, async (tx) => {
        const id = randomUUID();
        const { orderNumber } = await createOpenOrder(tx, cfg, id, [], label, {
          zoneId: offersByCfg.get(cfg)!.zoneId,
        });
        expect(await readReceiptOrder(tx, id)).toEqual({ orderLabel: label, orderNumber });
      });
    }
  });

  it("uses a delivery table", async () => {
    const { cfg, tableId } = await setupVenue();
    await asApp(cfg, async (tx) => {
      const id = randomUUID();
      const { orderNumber } = await createOpenOrder(tx, cfg, id, [], "Operator label", {
        deliveryTableId: tableId,
      });
      expect(await readReceiptOrder(tx, id)).toEqual({ orderLabel: "T1", orderNumber });
    });
  });

  it("refuses a missing order", async () => {
    const { cfg } = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => readReceiptOrder(tx, missing))).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: missing },
    });
  });
});

describe("splitBill", () => {
  it("spins selected items onto a NEW open bill of the party", async () => {
    const { cfg, waterId, hamId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, {
        tableId,
        lines: [
          { productId: waterId, quantity: "3" },
          { productId: hamId, quantity: "0.300" },
        ],
      }),
    );

    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 2 }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [check] = await tx
        .select({
          status: workingOrders.status,
          label: workingOrders.label,
          nodeId: workingOrders.nodeId,
          source: workingOrders.source,
          deviceId: workingOrders.deviceId,
          locationId: workingOrders.locationId,
        })
        .from(workingOrders)
        .where(eq(workingOrders.id, checkId));
      const checkLines = await tx
        .select({
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, checkId))
        .orderBy(workingOrderLines.lineNo);
      const originLines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      return { check, checkLines, originLines };
    });

    expect(state.check?.status).toBe("open");
    expect(state.check?.label).toBe("T1");
    // Opened on the splitting device's node and location (createOpenOrder stamps them from cfg).
    expect(state.check?.nodeId).toBe(cfg.nodeId);
    expect(state.check).toMatchObject({
      source: "device",
      deviceId: cfg.origin.deviceId,
      locationId: cfg.locationId,
    });
    expect(state.checkLines).toEqual([{ productId: hamId, quantity: 300 }]);
    expect(state.originLines).toEqual([{ lineNo: 1, productId: waterId, quantity: 3000 }]);
  });

  it("refuses to split off a check from a non-open tab (tab.not_open)", async () => {
    const { cfg } = await setupVenue();
    const MISSING = "00000000-0000-0000-0000-000000000000";
    await expect(
      asApp(cfg, (tx) =>
        splitBill(tx, cfg, MISSING, [{ lineNo: 1 }], { operatorId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "tab.not_open" });
  });

  it("rejects a batch repeating a lineNo (tab.transfer_duplicate_line), minting nothing and conserving quantity", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: waterId, quantity: "3" }] }),
    );
    await expect(
      asApp(cfg, (tx) => splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }, { lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.transfer_duplicate_line" });

    const state = await asApp(cfg, async (tx) => {
      const originLines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      const orders = await tx.select({ id: workingOrders.id }).from(workingOrders);
      return { originLines, orderCount: orders.length };
    });
    expect(state.originLines).toEqual([{ lineNo: 1, productId: waterId, quantity: 3000 }]);
    // No stray check minted — only the origin tab exists.
    expect(state.orderCount).toBe(1);
  });

  it("refuses an EMPTY transfers array (sale.empty_basket), minting nothing", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: waterId, quantity: "3" }] }),
    );
    // Refused before anything is minted, or the call would leave an orphan check: a table-less
    // `open` working order with zero lines and a consumed order_number.
    await expect(asApp(cfg, (tx) => splitPartyBill(tx, cfg, tabId, []))).rejects.toMatchObject({
      code: "sale.empty_basket",
    });

    const state = await asApp(cfg, async (tx) => {
      const originLines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      const orders = await tx.select({ id: workingOrders.id }).from(workingOrders);
      return { originLines, orderCount: orders.length };
    });
    expect(state.originLines).toEqual([{ lineNo: 1, productId: waterId, quantity: 3000 }]);
    // No orphan check minted — only the origin tab exists.
    expect(state.orderCount).toBe(1);
  });
});

/** A default kitchen station, with each product's route re-pointed at it, so a round fires there. */
async function withKitchen(cfg: WithVenueRowId<OriginConfig>): Promise<string> {
  const stationId = await seedKitchenStation(db, {});
  const offers = await asApp(cfg, (tx) => offerProducts(tx, cfg, { zone: "tables" }));
  offersByCfg.set(cfg, offers);
  return stationId;
}

/** Each line of an order in `line_no` order, with its ticket item, if any. */
async function linesWithTickets(orderId: string) {
  return db
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
      courseId: workingOrderLines.courseId,
      note: workingOrderLines.note,
      extraListId: workingOrderLines.extraListId,
      ticketId: ticketItems.id,
      ticketOrderId: ticketItems.workingOrderId,
      ticketQuantity: ticketItems.quantity,
      ticketState: ticketItems.state,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

/** Every column of a line's ticket item, or `undefined` when it has none. */
async function ticketOf(lineId: string) {
  const [row] = await db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row;
}

/** A cloud-poll printer attached to the station, so a fire or a correction there prints. */
async function printerAt(cfg: OriginConfig, stationId: string): Promise<string> {
  return asApp(cfg, async (tx) => {
    const { id } = await createPrinter(tx, {
      name: `P-${randomUUID().slice(0, 8)}`,
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await attachPrinterToStation(tx, { stationId, printerId: id });
    return id;
  });
}

/** What each job enqueued for the printer prints, oldest first. */
async function printedBy(printerId: string): Promise<string[][]> {
  const jobs = await db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId))
    .orderBy(sql`rowid`);
  return jobs.map((job) => printedLines(job.payload));
}

/** The kitchen notices recorded against the orders, oldest first. */
async function noticesOn(...orderIds: string[]) {
  const { rows } = await db.execute<{ working_order_id: string; kind: string; quantity: number }>(
    sql`select working_order_id, kind, quantity from kitchen_notices
      where working_order_id in (${sql.join(
        orderIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
  return rows.map((row) => ({
    orderId: row.working_order_id,
    kind: row.kind,
    quantity: row.quantity,
  }));
}

/** Each order at the station, with the quantities its items ask for. */
async function queueAt(cfg: OriginConfig, stationId: string) {
  const groups = await asApp(cfg, (tx) => listStationQueue(tx, stationId));
  return Object.fromEntries(
    groups.map((group) => [group.orderId, group.items.map((item) => item.quantity)]),
  );
}

/** Two bills of one party; `from` gets a round of `dishes` lines of `round.quantity` each. */
async function twoTabs(
  seeded: Seeded,
  round: { quantity: string; hold?: boolean },
  dishes = 1,
): Promise<{ from: string; to: string }> {
  const { cfg, waterId, tableId } = seeded;
  const { tabId: from, partyId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
  const to = randomUUID();
  await asApp(cfg, async (tx) => {
    await createOpenOrder(tx, cfg, to, [], null, {
      partyId,
      existingService: true,
      copyServiceContextFrom: from,
    });
  });
  await asApp(cfg, (tx) =>
    addTabRound(
      tx,
      cfg,
      from,
      Array.from({ length: dishes }, () => ({
        menuItemId: offersByCfg.get(cfg)!.offerFor(waterId),
        quantity: round.quantity,
        ...(round.hold === true ? { hold: true } : {}),
      })),
    ),
  );
  return { from, to };
}

async function splitToT2(
  seeded: Seeded,
  from: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<string> {
  const { cfg, tableId2 } = seeded;
  const { billId } = await asApp(cfg, (tx) => splitPartyBill(tx, cfg, from, transfers));
  await asApp(cfg, async (tx) => {
    const party = (await partyRevisionOfOrder(tx, from))!;
    await moveBill(
      tx,
      cfg,
      billId,
      { tableId: tableId2 },
      {
        partyId: party.id,
        expectedPartyRevision: party.revision,
        otherPartyId: null,
        operatorId: randomUUID(),
      },
    );
  });
  return billId;
}

describe("splitting a line the kitchen has", () => {
  it("moves a whole line the kitchen has started with its ticket", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "2" },
      ]),
    );
    const [line] = await linesWithTickets(tabId);
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, line!.ticketId!, "preparing"));

    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }]),
    );

    expect(await linesWithTickets(tabId)).toEqual([]);
    expect((await linesWithTickets(checkId))[0]).toMatchObject({
      id: line!.id,
      quantity: 2000,
      ticketId: line!.ticketId,
      ticketOrderId: checkId,
      ticketState: "preparing",
    });
  });

  it("tells the kitchen of a dish split onto a check that it is on another order: one notice and one MOVED slip", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { from } = await twoTabs(seeded, { quantity: "4" });
    const [line] = await linesWithTickets(from);
    const printed = await printedBy(printerId);
    expect(printed).toHaveLength(1);

    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, line!.ticketId!, "preparing"));
    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, from, [{ lineNo: 1 }]),
    );

    const numbers = `${await orderNumberOf(from)} -> ${await orderNumberOf(checkId)}`;
    expect(await printedBy(printerId)).toEqual([
      ...printed,
      movedSlip("T1", "T1", numbers, "4 x Agua"),
    ]);
    expect(await noticesOn(from, checkId)).toEqual([
      { orderId: checkId, kind: "moved", quantity: 4000 },
    ]);
    expect(await queueAt(cfg, stationId)).toEqual({
      [checkId]: [thousandthsToDecimal(4000)],
    });
  });

  it("voids the dish moved to another table at the kitchen, leaving the original's", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { from } = await twoTabs(seeded, { quantity: "1" }, 2);
    const to = await splitToT2(seeded, from, [{ lineNo: 1 }]);

    await asApp(cfg, (tx) => cancelLine(tx, cfg, to, 1));

    expect(await noticesOn(from, to)).toEqual([
      { orderId: to, kind: "moved", quantity: 1000 },
      { orderId: to, kind: "moved", quantity: 1000 },
      { orderId: to, kind: "void", quantity: 1000 },
    ]);
    const slip = (await printedBy(printerId)).at(-1)!;
    expect(slip).toContain("*** VOID ***");
    expect(slip).toContain("1 x Agua");
    expect(await queueAt(cfg, stationId)).toEqual({ [from]: [thousandthsToDecimal(1000)] });
  });

  it("voids only what the original bill still asks for, leaving the dish moved to another table", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const { from } = await twoTabs(seeded, { quantity: "1" }, 2);
    const to = await splitToT2(seeded, from, [{ lineNo: 1 }]);

    await asApp(cfg, (tx) => cancelLine(tx, cfg, from, 2));

    expect(await noticesOn(from, to)).toEqual([
      { orderId: to, kind: "moved", quantity: 1000 },
      { orderId: to, kind: "moved", quantity: 1000 },
      { orderId: from, kind: "void", quantity: 1000 },
    ]);
    expect((await linesWithTickets(to))[0]).toMatchObject({ ticketQuantity: 1000 });
    expect(await queueAt(cfg, stationId)).toEqual({ [to]: [thousandthsToDecimal(1000)] });
  });

  it("moves one of two held dishes so each bill's Send fires its own", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { from, to } = await twoTabs(seeded, { quantity: "1", hold: true }, 2);
    await asApp(cfg, async (tx) => {
      const party = (await partyRevisionOfOrder(tx, from))!;
      await transferItems(tx, cfg, from, to, [{ lineNo: 1 }], {
        expectedPartyRevision: party.revision,
        operatorId: randomUUID(),
      });
    });
    expect(await printedBy(printerId)).toEqual([]);

    await asApp(cfg, (tx) => sendLines(tx, cfg, to, []));

    const [moved] = await linesWithTickets(to);
    expect(moved!.sentAt).not.toBeNull();
    expect((await ticketOf(moved!.id))!.firedAt).not.toBeNull();
    const [kept] = await linesWithTickets(from);
    expect(kept!.sentAt).toBeNull();
    expect((await ticketOf(kept!.id))!.firedAt).toBeNull();
    expect(await printedBy(printerId)).toHaveLength(1);
    expect((await printedBy(printerId))[0]).toContain("1 x Agua");

    await asApp(cfg, (tx) => sendLines(tx, cfg, from, []));

    expect((await linesWithTickets(from))[0]!.sentAt).not.toBeNull();
    expect(await ticketOf(kept!.id)).toMatchObject({ quantity: 1000 });
    expect((await ticketOf(kept!.id))!.firedAt).not.toBeNull();
    const printed = await printedBy(printerId);
    expect(printed).toHaveLength(2);
    expect(printed[1]).toContain("1 x Agua");
    expect(printed[1]).not.toContain("2 x Agua");
  });

  it("names the origin's table on the slip voiding part of a dish moved to a check", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "2" },
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "1" },
      ]),
    );
    const [ticket] = await printedBy(printerId);
    expect(ticket).toContain("T1");
    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }]),
    );

    await asApp(cfg, (tx) => cancelItemForTest(tx, cfg, checkId, 1, "1"));

    const slip = (await printedBy(printerId)).at(-1)!;
    expect(slip).toContain("*** VOID ***");
    expect(slip).toContain("T1");
    expect(slip).toContain("1 x Agua");
    expect(await noticesOn(checkId)).toEqual([
      { orderId: checkId, kind: "moved", quantity: 2000 },
      { orderId: checkId, kind: "void", quantity: 1000 },
    ]);
  });

  it("names the origin's table for the check on the pass board", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "1" },
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "1" },
      ]),
    );
    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }]),
    );
    // The party's table wins over the order's own label.
    await db.update(workingOrders).set({ label: "Terraza" }).where(eq(workingOrders.id, tabId));

    const board = await asApp(cfg, (tx) => readScopedPassBoard(tx, EVERY));
    const orders = boardCards(board).flatMap((card) => card.orders);

    expect(Object.fromEntries(orders.map((order) => [order.orderId, order.tableLabel]))).toEqual({
      [tabId]: "T1",
      [checkId]: "T1",
    });
  });

  it("splits off a dish the kitchen does not have without making a ticket", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, {
        tableId,
        lines: [
          { productId: waterId, quantity: "2" },
          { productId: waterId, quantity: "1" },
        ],
      }),
    );

    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 2 }]),
    );

    expect(await linesWithTickets(tabId)).toMatchObject([{ quantity: 2000, ticketId: null }]);
    expect(await linesWithTickets(checkId)).toMatchObject([{ quantity: 1000, ticketId: null }]);
  });
});

/** A station's notices, every field a cook reads, oldest first. */
async function kitchenNoticesAt(cfg: OriginConfig, stationId: string) {
  return (await asApp(cfg, (tx) => listStationNotices(tx, stationId))).map((notice) => ({
    stationId: notice.stationId,
    workingOrderId: notice.workingOrderId,
    orderLabel: notice.orderLabel,
    kind: notice.kind,
    lineName: notice.lineName,
    quantity: notice.quantity,
    unitName: notice.unitName,
    note: notice.note,
    wasStarted: notice.wasStarted,
    movedTo: notice.movedTo,
  }));
}

async function orderNumberOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ orderNumber: workingOrders.orderNumber })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.orderNumber;
}

/** A MOVED slip's printed lines, its time matched by shape. */
function movedSlip(from: string, to: string, orderNumber: string, item: string): unknown[] {
  return [
    `*** ${kitchenTicketWords("en").moved} ***`,
    "Cocina",
    `${kitchenTicketWords("en").order} ${orderNumber}`,
    `${kitchenTicketWords("en").fromPlace}${from}`,
    `${kitchenTicketWords("en").toPlace}${to}`,
    expect.stringMatching(/^\d\d:\d\d$/),
    item,
    "",
  ];
}

describe("moving sent work to another table tells the kitchen", () => {
  it("tells the kitchen, when a check merges back into the tab it was split from, that its dishes are on another order", async () => {
    const { cfg, waterId, tableId } = await setupVenue();
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "1" },
        { menuItemId: offersByCfg.get(cfg)!.offerFor(waterId), quantity: "1" },
      ]),
    );
    const { billId: checkId } = await asApp(cfg, (tx) =>
      splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }]),
    );
    const printed = await printedBy(printerId);

    await asApp(cfg, async (tx) => {
      const party = (await partyRevisionOfOrder(tx, tabId))!;
      await mergeBills(tx, cfg, tabId, checkId, {
        expectedPartyRevision: party.revision,
        operatorId: randomUUID(),
      });
    });

    const [tabNumber, checkNumber] = [await orderNumberOf(tabId), await orderNumberOf(checkId)];
    const notice = {
      stationId,
      kind: "moved",
      lineName: "Agua",
      quantity: thousandthsToDecimal(1000),
      unitName: { es: EACH_UNIT.abbreviation.es },
      note: null,
      wasStarted: false,
      movedTo: "T1",
    };
    expect(await kitchenNoticesAt(cfg, stationId)).toEqual([
      { ...notice, workingOrderId: checkId, orderLabel: `#${tabNumber} → #${checkNumber} · T1` },
      { ...notice, workingOrderId: tabId, orderLabel: `#${checkNumber} → #${tabNumber}` },
    ]);
    expect(await printedBy(printerId)).toEqual([
      ...printed,
      movedSlip("T1", "T1", `${checkNumber} -> ${tabNumber}`, "1 x Agua"),
    ]);
    expect(await queueAt(cfg, stationId)).toEqual({
      [tabId]: [thousandthsToDecimal(1000), thousandthsToDecimal(1000)],
    });
  });

  it("records a moved notice and slip for each sent item of a party moved to another table, and none for held work", async () => {
    const { cfg, waterId, tableId, tableId2 } = await setupVenue();
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const offer = offersByCfg.get(cfg)!.offerFor(waterId);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ menuItemId: offer, quantity: "2" }]));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: offer, quantity: "5", hold: true }]),
    );

    await asApp(cfg, async (tx) => {
      const party = (await partyRevisionOfOrder(tx, tabId))!;
      await moveGuests(tx, cfg, party.id, tableId2, {
        expectedPartyRevision: party.revision,
        otherPartyId: null,
        operatorId: randomUUID(),
      });
    });

    const number = await orderNumberOf(tabId);
    expect(await kitchenNoticesAt(cfg, stationId)).toEqual([
      {
        stationId,
        workingOrderId: tabId,
        orderLabel: `#${number}`,
        kind: "moved",
        lineName: "Agua",
        quantity: thousandthsToDecimal(2000),
        unitName: { es: EACH_UNIT.abbreviation.es },
        note: null,
        wasStarted: false,
        movedTo: "T2",
      },
    ]);
    const printed = await printedBy(printerId);
    expect(printed).toHaveLength(2);
    expect(printed[1]).toEqual(movedSlip("T1", "T2", `${number}`, "2 x Agua"));
  });
});
