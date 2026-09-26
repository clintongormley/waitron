import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  locations,
  nowIso,
  printJobs,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  departments,
  listStationNotices,
  preparationRoutes,
  writeEditSentLines,
} from "@waitron/venue-service";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  addProductToMenu,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { createTable, createZone, updateTable } from "./tables.js";
import {
  addTabRound,
  advanceTicketItem,
  createOpenOrder,
  fireCourse,
  fireLines,
  listExpoQueue,
  listStationQueue,
  listTablesWithState,
  markLineServed,
  mergeTabs,
  moveTabLines,
  openTab,
  readTabLines,
  recallLines,
  sendLines,
  setLineCourse,
  splitOffCheck,
  transferLines,
  unmarkLineServed,
  updateHeldOrder,
  updateOrderLine,
  voidTabLine,
} from "./working-order.js";
import "./errors.js";

const LOCALE = "es-ES";
// The whole manifest: the tables here belong to several modules.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  cafeId: string;
  aguaId: string;
  cafeMenuItemId: string;
  aguaMenuItemId: string;
  menuId: string;
  categoryId: string;
  tableId: string;
  /** The café's and the agua's offers in the table's zone, which is what a round sells. */
  cafeOffer: string;
  aguaOffer: string;
  offerFor: (productId: string) => string;
}

async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  // Through the table definitions: `locations.id`, `tills.id` and `tills.created_at` are
  // `$defaultFn` generators, which a raw insert does not reach.
  const [location] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = location!.id;
  await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const { cafeId, aguaId, cafeMenuItemId, aguaMenuItemId, menuId, categoryId, tableId, offers } =
    await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
      const cafe = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        name: "Café",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      const agua = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        name: "Agua",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const cafeMenuItem = await addProductToMenu(tx, {
        menuId: cat.id,
        productId: cafe.id,
        grossPrice: "1.50",
      });
      const aguaMenuItem = await addProductToMenu(tx, {
        menuId: cat.id,
        productId: agua.id,
        grossPrice: "2.00",
      });
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const table = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
      return {
        cafeId: cafe.id,
        aguaId: agua.id,
        cafeMenuItemId: cafeMenuItem.id,
        aguaMenuItemId: aguaMenuItem.id,
        menuId: cat.id,
        categoryId: bebidas.id,
        tableId: table.id,
        offers,
      };
    });
  return {
    cfg,
    cafeId,
    aguaId,
    cafeMenuItemId,
    aguaMenuItemId,
    menuId,
    categoryId,
    tableId,
    cafeOffer: offers.offerFor(cafeId),
    aguaOffer: offers.offerFor(aguaId),
    offerFor: offers.offerFor,
  };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** `minPicks: 0` leaves the list optional, so the dish still orders on its own. */
async function attachExtras(
  tx: Transaction,
  cfg: TillConfig,
  dishId: string,
  extraProductId: string,
): Promise<string> {
  const list = await createExtraList(
    tx,
    {
      name: "Extras",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 2,
      active: true,
      items: [{ productId: extraProductId, maxQuantity: 2, preselected: false, price: "0.50" }],
    },
    LOCALE,
  );
  await writeProductModifiers(tx, dishId, [{ kind: "extras", id: list.id }]);
  // An offer carries only the extras lists published on it, so re-offer to publish this one.
  await offerProducts(tx, cfg, { zone: "tables" });
  return list.id;
}

/** A placed counter delivery to `tableId`, fired to the kitchen and not yet collected. Created open
 *  first, because the line insert needs an open parent (`require_open_parent`). */
async function seedFiredDelivery(
  cfg: TillConfig,
  cafeOffer: string,
  tableId: string,
): Promise<string> {
  const id = randomUUID();
  await asApp(cfg, async (tx) => {
    await createOpenOrder(tx, cfg, id, [{ menuItemId: cafeOffer, quantity: "1" }], null, {
      deliveryTableId: tableId,
    });
    const lines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await fireLines(tx, cfg, id, lines);
    await tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`);
  });
  return id;
}

async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

describe("openTab", () => {
  it("opens a tab, points the table's tab_id at it, with an initial round", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId, orderNumber } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    expect(orderNumber).toBe(1);
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, tabId));
    expect(wo).toMatchObject({ status: "open", deliveryTableId: null });
    expect(await tabIdOf(tableId)).toBe(tabId);
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(lines).toHaveLength(1);
  });

  it("opens a tab with NO initial round (empty tab)", async () => {
    const { cfg, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    expect(await tabIdOf(tableId)).toBe(tabId);
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(lines).toHaveLength(0);
  });

  it("refuses a second tab on a table that already has an OPEN one (tab.already_open)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId }))).rejects.toMatchObject({
      code: "tab.already_open",
      params: { tableId },
    });
  });

  it("treats a STALE tab_id (pointing at a settled order) as free and overwrites it", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId: firstTab } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    // `tab_id` is left pointing at a settled order.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${firstTab}`,
    );
    const { tabId: secondTab } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    expect(secondTab).not.toBe(firstTab);
    expect(await tabIdOf(tableId)).toBe(secondTab);
  });

  it("refuses an unknown table (table.not_found) and a deactivated one (table.inactive)", async () => {
    const { cfg, tableId } = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId: missing }))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
    await db.execute(sql`update dining_tables set active = false where id = ${tableId}`);
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId }))).rejects.toMatchObject({
      code: "table.inactive",
      params: { tableId },
    });
  });
});

/** An open walk-up order that no table points at. */
async function bareOpenOrder(cfg: TillConfig, id: string): Promise<void> {
  // Through the table definition: `working_orders.opened_at` is a `$defaultFn` generator.
  await db
    .insert(workingOrders)
    .values({ id, tillId: cfg.tillId, nodeId: cfg.nodeId, orderNumber: 999, status: "open" });
}

describe("addTabRound (append-only, no re-price)", () => {
  it("appends a round with the NEXT line_no, without deleting or re-pricing existing lines", async () => {
    const { cfg, cafeId, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    await asApp(cfg, (tx) =>
      tx.execute(sql`update products set unit_price = 999 where id = ${cafeId}`),
    );
    // Unlike a full-basket replace such as updateHeldOrder, earlier rounds keep their price.
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo, gross: workingOrderLines.unitPriceGross })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    // The column counts whole cents.
    expect(lines).toEqual([
      { lineNo: 1, gross: 150 },
      { lineNo: 2, gross: 150 },
      { lineNo: 3, gross: 999 },
    ]);
  });

  it("appends a round with extras as parent + child lines, firing ONLY the parent", async () => {
    const { cfg, cafeId, aguaId, tableId, cafeOffer } = await setupVenue();
    // Two different products, so an assertion about which one a row carries can fail.
    const extraListId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId: extraListId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );

    const lines = await db
      .select({
        lineNo: workingOrderLines.lineNo,
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        parentLineId: workingOrderLines.parentLineId,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    const [parent, child] = lines;
    expect(parent!.productId).toBe(cafeId);
    expect(parent!.parentLineId).toBeNull();
    expect(child!.productId).toBe(aguaId);
    expect(child!.parentLineId).toBe(parent!.id);

    const fired = await db
      .select({ workingOrderLineId: ticketItems.workingOrderLineId })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    expect(fired).toEqual([{ workingOrderLineId: parent!.id }]);
  });

  it("refuses a round on a settled tab, a walk-up (not a tab), and an absent id (tab.not_open)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${tabId}`,
    );
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId } });

    const walkUp = randomUUID();
    await bareOpenOrder(cfg, walkUp);
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, walkUp, [{ menuItemId: cafeOffer, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: walkUp } });

    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, missing, [{ menuItemId: cafeOffer, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
  });

  it("refuses an empty round (sale.empty_basket)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, []))).rejects.toMatchObject({
      code: "sale.empty_basket",
    });
  });
});

describe("addTabRound per-line note (NON-FISCAL, spec §2/§3)", () => {
  it("persists a TRIMMED note on the working_order_lines row AND snapshots it onto ticket_items at fire", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", note: "  sin sal  " }]),
    );

    const [line] = await db
      .select({ id: workingOrderLines.id, note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(line!.note).toBe("sin sal");

    const [item] = await db
      .select({ note: ticketItems.note })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, line!.id));
    expect(item!.note).toBe("sin sal");
  });

  it("stores NULL for an absent note and for a whitespace-only note", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", note: "   " },
        { menuItemId: cafeOffer, quantity: "1" },
      ]),
    );
    const lines = await db
      .select({ note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines.map((line) => line.note)).toEqual([null, null]);
  });

  it("rejects a note longer than 200 chars (working_order.note_too_long)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const note = "x".repeat(201);
    await expect(
      asApp(cfg, (tx) =>
        addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", note }]),
      ),
    ).rejects.toMatchObject({
      code: "working_order.note_too_long",
      params: { length: 201, limit: 200 },
    });
  });

  it("rejects a non-string note with a clean 400 screen (management.request_invalid), not a 500", async () => {
    // The wire type says string, but a crafted body can send anything.
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await expect(
      asApp(cfg, (tx) =>
        addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", note: 123 as never }]),
      ),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "note" } });
  });
});

describe("voidTabLine", () => {
  it("deletes one line from an open tab and leaves the rest", async () => {
    const { cfg, tableId, cafeOffer, aguaOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: aguaOffer, quantity: "1" }]),
    ); // line 2
    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1));

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toEqual([{ lineNo: 2 }]);
  });

  it("throws tab.line_not_found for a line_no that matches nothing", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 99))).rejects.toMatchObject({
      code: "tab.line_not_found",
      params: { tabId, lineNo: 99 },
    });
  });

  it("throws tab.not_open for a settled order", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${tabId}`,
    );
    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });
});

describe("markLineServed / unmarkLineServed", () => {
  async function servedAtByLine(tabId: string): Promise<Map<number, string | null>> {
    const rows = await db
      .select({ lineNo: workingOrderLines.lineNo, servedAt: workingOrderLines.servedAt })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    return new Map(rows.map((r) => [r.lineNo, r.servedAt]));
  }

  it("marks one line served, unmarks it, and refuses an unknown line (tab.line_not_found)", async () => {
    const { cfg, tableId, cafeOffer, aguaOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { menuItemId: cafeOffer, quantity: "1" },
          { menuItemId: aguaOffer, quantity: "1" },
        ],
      }),
    );

    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    let served = await servedAtByLine(tabId);
    expect(served.get(1)).not.toBeNull();
    expect(served.get(2)).toBeNull();

    await asApp(cfg, (tx) => unmarkLineServed(tx, cfg, tabId, 1));
    served = await servedAtByLine(tabId);
    expect(served.get(1)).toBeNull();

    await expect(asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 99))).rejects.toMatchObject({
      code: "tab.line_not_found",
      params: { tabId, lineNo: 99 },
    });
    await expect(asApp(cfg, (tx) => unmarkLineServed(tx, cfg, tabId, 99))).rejects.toMatchObject({
      code: "tab.line_not_found",
      params: { tabId, lineNo: 99 },
    });
  });

  it("refuses a settled tab (tab.not_open — the require_open_parent trigger is the DB backstop)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    // The `require_open_parent` trigger would also refuse this, so this case does not isolate the
    // status check; the next case isolates the back-pointer check.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${tabId}`,
    );
    await expect(asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });

  it("refuses an open order no table points at, carrying a real line — the back-pointer check is the sole gate (tab.not_open)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    // The order stays open with a real line, so no trigger fires and the update would match a row:
    // only assertAnchoredTabOpen's back-pointer check can refuse it.
    await db.execute(sql`update dining_tables set tab_id = null where id = ${tableId}`);
    await expect(asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });
});

describe("readTabLines", () => {
  it("reads an open tab's lines in line_no order with locked gross price, quantity and served state", async () => {
    const { cfg, cafeId, aguaId, tableId, cafeOffer, aguaOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { menuItemId: cafeOffer, quantity: "1" },
          { menuItemId: aguaOffer, quantity: "2" },
        ],
      }),
    );
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      lineNo: 1,
      productId: cafeId,
      quantity: "1.000",
      unitPriceGross: "1.50",
    });
    expect(lines[0]!.servedAt).not.toBeNull();
    expect(lines[1]).toMatchObject({
      lineNo: 2,
      productId: aguaId,
      quantity: "2.000",
      unitPriceGross: "2.00",
      servedAt: null,
    });
  });

  it("carries each line's course + fired/held state (KDS-2 §5b) for the tab's waiter-fire", async () => {
    const { cfg, cafeId, aguaId, tableId, cafeOffer, aguaOffer } = await setupVenue();
    const entrantes = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 }),
    );
    const postres = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 1 }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, cafeId, entrantes.id));
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, aguaId, postres.id));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1" },
        { menuItemId: aguaOffer, quantity: "1" },
      ]),
    );

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    const cafe = lines.find((l) => l.productId === cafeId)!;
    const agua = lines.find((l) => l.productId === aguaId)!;
    // The earliest course fires on send; a later one is held.
    expect(cafe.courseId).toBe(entrantes.id);
    expect(cafe.firedAt).not.toBeNull();
    expect(agua.courseId).toBe(postres.id);
    expect(agua.firedAt).toBeNull();
    // Held versus fired is `firedAt`: a held line has a ticket item too, still "queued".
    expect(cafe.state).toBe("queued");
    expect(agua.state).toBe("queued");
  });

  it("carries state: null for an extra's child line, which has no ticket item of its own", async () => {
    // Distinct from a held parent, which has a ticket item in state "queued".
    const { cfg, cafeId, aguaId, tableId, cafeOffer } = await setupVenue();
    const extraListId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId: extraListId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    expect(lines).toHaveLength(2);
    const parent = lines.find((l) => l.productId === cafeId)!;
    const child = lines.find((l) => l.productId === aguaId)!;
    expect(parent.firedAt).not.toBeNull();
    expect(parent.state).toBe("queued");
    expect(child.firedAt).toBeNull();
    expect(child.state).toBeNull();
  });

  it("names a child extras line's parent by LINE NUMBER, and leaves the dish's own null", async () => {
    // A child carries the picked product, so `productId` cannot tell it from a dish.
    const { cfg, cafeId, aguaId, tableId, cafeOffer } = await setupVenue();
    const extraListId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId: extraListId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    expect(lines).toHaveLength(2);
    const parent = lines.find((l) => l.productId === cafeId)!;
    const child = lines.find((l) => l.productId === aguaId)!;
    expect(parent.parentLineNo).toBeNull();
    expect(child.parentLineNo).toBe(parent.lineNo);
  });

  it("returns the STORED locked gross price, never a re-price after the catalogue changes", async () => {
    const { cfg, cafeId, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) =>
      tx.execute(sql`update products set unit_price = 999 where id = ${cafeId}`),
    );
    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    expect(lines[0]!.unitPriceGross).toBe("1.50");
  });

  it("returns [] for an open tab with no lines", async () => {
    const { cfg, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    expect(await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId))).toEqual([]);
  });

  it("refuses a settled tab and an absent id (tab.not_open — assertTabOpen, an UNLOCKED read)", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${tabId}`,
    );
    await expect(asApp(cfg, (tx) => readTabLines(tx, cfg, tabId))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => readTabLines(tx, cfg, missing))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId: missing },
    });
  });
});

describe("listTablesWithState (occupancy)", () => {
  it("reflects free → open-tab → free as a tab opens and pays", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();

    const free = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(free).toEqual([
      expect.objectContaining({
        id: tableId,
        state: "free",
        hasOpenTab: false,
        pendingDeliveries: 0,
      }),
    ]);

    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "2" }] }),
    );
    const busy = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(busy[0]).toMatchObject({
      state: "open-tab",
      hasOpenTab: true,
      tabId,
      tabLineCount: 1,
      tabTotal: "3.00",
      pendingDeliveries: 0,
    });

    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${tabId}`,
    );
    const freed = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(freed[0]).toMatchObject({ state: "free", hasOpenTab: false });
  });

  it("shows delivery-pending while a fired delivery is uncollected, and free once collected", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const orderId = await seedFiredDelivery(cfg, cafeOffer, tableId);

    const pending = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(pending[0]).toMatchObject({
      state: "delivery-pending",
      hasOpenTab: false,
      pendingDeliveries: 1,
    });

    const settledAt = nowIso();
    await asApp(cfg, (tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = ${settledAt}, collected_at = ${settledAt} where id = ${orderId}`,
      ),
    );
    const cleared = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(cleared[0]).toMatchObject({ state: "free", pendingDeliveries: 0 });
  });

  it("reports pendingToServe (unserved tab lines), 0 for a free table, and carries zoneId", async () => {
    const { cfg, cafeMenuItemId, aguaMenuItemId, menuId, categoryId, tableId } = await setupVenue();
    const zone = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" }));
    await asApp(cfg, async (tx) => {
      // Through the table definition: `departments.id` and `.created_at` are `$defaultFn` generators.
      const [department] = await tx
        .insert(departments)
        .values({
          locationId: cfg.locationId,
          name: "Restaurant",
          tradingName: "Restaurant",
          defaultServiceMode: "table_tab",
        })
        .returning({ id: departments.id });
      // Insert order: see `zone_service_policies_default_allowed_fk` in
      // `packages/venue-service/src/schema/service.ts`.
      await tx.execute(sql`
        insert into zone_service_policies
          (location_id, zone_id, department_id, service_mode, default_menu_id)
        values (
          ${cfg.locationId}, ${zone.id}, ${department!.id},
          'table_tab', null
        )`);
      await tx.execute(sql`
        insert into zone_menus (zone_id, menu_id)
        values (${zone.id}, ${menuId})`);
      await tx.execute(sql`
        update zone_service_policies set default_menu_id = ${menuId} where zone_id = ${zone.id}`);
      // `preparation_routes.id` is a `$defaultFn` generator.
      await tx.insert(preparationRoutes).values({
        locationId: cfg.locationId,
        categoryId,
        stationId: null,
        noPreparation: true,
      });
    });
    const freeTable = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "T2" }));
    await asApp(cfg, (tx) => updateTable(tx, cfg, tableId, { zoneId: zone.id }));

    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { menuItemId: cafeMenuItemId, quantity: "1" },
          { menuItemId: aguaMenuItemId, quantity: "1" },
        ],
      }),
    );

    let rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)).toMatchObject({
      zoneId: zone.id,
      pendingToServe: 2,
    });
    expect(rows.find((t) => t.id === freeTable.id)).toMatchObject({
      state: "free",
      pendingToServe: 0,
    });

    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)!.pendingToServe).toBe(1);

    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 2));
    rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)!.pendingToServe).toBe(0);
  });

  it("open-tab dominates delivery-pending in the rolled-up state", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await seedFiredDelivery(cfg, cafeOffer, tableId);
    const rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows[0]).toMatchObject({ state: "open-tab", hasOpenTab: true, pendingDeliveries: 1 });
  });
});

type RoundLine = { menuItemId: string; quantity: string; courseId?: string | null };
/** A `courseId` that is null or absent falls to the product's default course. */
function line(menuItemId: string, opts?: { courseId?: string | null }): RoundLine {
  return { menuItemId, quantity: "1", ...opts };
}
async function addTabRoundWith(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lines: RoundLine[],
): Promise<{ productId: string | null; courseId: string | null }[]> {
  await addTabRound(tx, cfg, tabId, lines);
  return tx
    .select({ productId: workingOrderLines.productId, courseId: workingOrderLines.courseId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
}
function lineCourse(
  rows: { productId: string | null; courseId: string | null }[],
  productId: string,
): string | null {
  return rows.find((r) => r.productId === productId)!.courseId;
}

describe("addTabRound ring-time course resolution (override ?? product default ?? null)", () => {
  it("resolves a line's course: override > product default > null", async () => {
    // Bread's `courseId: null` is the same as no override: it is null because it has no default.
    const { cfg, cafeId: steak, aguaId: bread, tableId, offerFor } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const c = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales", displayOrder: 1 }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, steak, c.id));
    const o = await asApp(cfg, (tx) =>
      addTabRoundWith(tx, cfg, tabId, [
        line(offerFor(steak)),
        line(offerFor(bread), { courseId: null }),
      ]),
    );
    expect(lineCourse(o, steak)).toBe(c.id);
    expect(lineCourse(o, bread)).toBeNull();
  });

  it("a non-null line override WINS over the product's default course", async () => {
    const { cfg, cafeId: prod, tableId, offerFor } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const def = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 }),
    );
    const override = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 2 }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, prod, def.id));
    const o = await asApp(cfg, (tx) =>
      addTabRoundWith(tx, cfg, tabId, [line(offerFor(prod), { courseId: override.id })]),
    );
    expect(lineCourse(o, prod)).toBe(override.id);
  });

  it("resolves null when the line has no override AND the product no default course", async () => {
    const { cfg, cafeId: prod, tableId, offerFor } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const o = await asApp(cfg, (tx) => addTabRoundWith(tx, cfg, tabId, [line(offerFor(prod))]));
    expect(lineCourse(o, prod)).toBeNull();
  });
});

it("returns a tab line's stored staff names and options answers", async () => {
  const { cfg, tableId, cafeOffer } = await setupVenue();
  await asApp(cfg, async (tx) => {
    const { tabId } = await openTab(tx, cfg, {
      tableId,
      lines: [{ menuItemId: cafeOffer, quantity: "1" }],
    });
    // Each of the six frozen names carries its own text, so a read of the wrong one fails.
    const optionSnapshots = [
      {
        listName: { [LOCALE]: "Cooked staff" },
        listCustomerName: { [LOCALE]: "Cooked customer" },
        listKitchenName: "Cooked kitchen",
        labelName: { [LOCALE]: "Rare staff" },
        labelCustomerName: { [LOCALE]: "Rare customer" },
        labelKitchenName: "Rare kitchen",
      },
    ];
    // A waiter reads a tab's lines, so a line shows the variant's staff name.
    await tx
      .update(workingOrderLines)
      .set({
        name: "Recorded coffee",
        variantName: "Large",
        descriptions: { [LOCALE]: "Café recién molido" },
        variantDescriptions: { [LOCALE]: "Taza grande" },
        optionSnapshots,
      })
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect((await readTabLines(tx, cfg, tabId))[0]).toMatchObject({
      name: "Large",
      optionSnapshots,
    });
  });
});

/** Route `productId` to no station: a bottled drink handed over at the bar. */
async function routeToNoPreparation(productId: string): Promise<void> {
  await db.execute(sql`
    update preparation_routes set station_id = null, no_preparation = 1
    where product_id = ${productId}`);
}

/** Each line of an order in `line_no` order: its product, when it was sent, and its ticket, if any. */
async function sentState(orderId: string): Promise<
  {
    lineNo: number;
    productId: string | null;
    sentAt: string | null;
    ticket: { quantity: number | null; firedAt: string | null } | null;
  }[]
> {
  const lines = await db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      sentAt: workingOrderLines.sentAt,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
  const tickets = await db
    .select({
      lineId: ticketItems.workingOrderLineId,
      quantity: ticketItems.quantity,
      firedAt: ticketItems.firedAt,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, orderId));
  const ticketByLine = new Map(tickets.map((t) => [t.lineId, t]));
  return lines.map((line) => {
    const ticket = ticketByLine.get(line.id);
    return {
      lineNo: line.lineNo,
      productId: line.productId,
      sentAt: line.sentAt,
      ticket: ticket === undefined ? null : { quantity: ticket.quantity, firedAt: ticket.firedAt },
    };
  });
}

describe("sent_at: when a line is sent, and what the kitchen was asked to make", () => {
  it("stamps a routed line and a no-preparation line sent in one round; only the routed one has a ticket, at the quantity fired", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "2" },
        { menuItemId: aguaOffer, quantity: "1" },
      ]),
    );

    const state = await sentState(tabId);
    expect(state.map((line) => [line.productId, line.sentAt !== null])).toEqual([
      [cafeId, true],
      [aguaId, true],
    ]);
    // The ticket's quantity is a count of thousandths off the column: two cafés.
    expect(state.map((line) => line.ticket?.quantity ?? null)).toEqual([2000, null]);
  });

  it("stamps neither line of a held course until the course fires, then both", async () => {
    const { cfg, tableId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const course = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 3 }),
    );
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", courseId: course.id, hold: true },
        { menuItemId: aguaOffer, quantity: "1", courseId: course.id, hold: true },
      ]),
    );
    expect((await sentState(tabId)).map((line) => line.sentAt)).toEqual([null, null]);

    await asApp(cfg, (tx) => fireCourse(tx, cfg, tabId, course.id));

    const fired = await sentState(tabId);
    expect(fired.map((line) => line.sentAt !== null)).toEqual([true, true]);
    expect(fired[0]!.ticket).toMatchObject({ quantity: 1000 });
  });

  it("stamps a held course's no-route line when its routed line is sent by sendLines", async () => {
    const { cfg, tableId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const course = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 3 }),
    );
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", courseId: course.id, hold: true },
        { menuItemId: aguaOffer, quantity: "1", courseId: course.id, hold: true },
      ]),
    );

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, [1]));

    expect((await sentState(tabId)).map((line) => line.sentAt !== null)).toEqual([true, true]);
  });

  it("sending everything held stamps a held no-route line even when nothing routed is held beside it", async () => {
    const { cfg, tableId, aguaId, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const course = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 3 }),
    );
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: aguaOffer, quantity: "1", courseId: course.id, hold: true },
        { menuItemId: aguaOffer, quantity: "1", hold: true },
      ]),
    );
    expect((await sentState(tabId)).map((line) => line.sentAt)).toEqual([null, null]);

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, []));

    expect((await sentState(tabId)).map((line) => line.sentAt !== null)).toEqual([true, true]);
  });

  it("sending one held line of a course stamps the course's no-route line only once nothing routed in it is still held", async () => {
    const { cfg, tableId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const course = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 3 }),
    );
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", courseId: course.id, hold: true },
        { menuItemId: cafeOffer, quantity: "1", courseId: course.id, hold: true },
        { menuItemId: aguaOffer, quantity: "1", courseId: course.id, hold: true },
      ]),
    );

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, [1]));
    expect((await sentState(tabId)).map((line) => line.sentAt !== null)).toEqual([
      true,
      false,
      false,
    ]);

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, [2]));
    expect((await sentState(tabId)).map((line) => line.sentAt !== null)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("stamps a no-route line with no course at the round even when the round holds another line", async () => {
    const { cfg, tableId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", hold: true },
        { menuItemId: aguaOffer, quantity: "1" },
      ]),
    );

    expect((await sentState(tabId)).map((line) => line.sentAt !== null)).toEqual([false, true]);
  });

  it("does not stamp a routed line that was never fired when a held line beside it is sent", async () => {
    const { cfg, tableId, cafeOffer, aguaOffer } = await setupVenue();
    // `openTab`'s initial lines are stored without being fired, so this one has no ticket item.
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ menuItemId: cafeOffer, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: aguaOffer, quantity: "1", hold: true }]),
    );

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, []));

    expect((await sentState(tabId)).map((line) => [line.sentAt !== null, line.ticket])).toEqual([
      [false, null],
      [true, expect.objectContaining({ quantity: 1000 })],
    ]);
  });

  it("sends nothing, and counts no write, for a line number the tab does not hold", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", hold: true }]),
    );
    const before = { lines: await sentState(tabId), revision: await revisionOf(tabId) };

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, [9]));

    expect({ lines: await sentState(tabId), revision: await revisionOf(tabId) }).toEqual(before);
  });

  it("sends nothing and stamps nothing when no line is held", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    const before = await sentState(tabId);

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, []));

    expect(await sentState(tabId)).toEqual(before);
  });

  it("keeps a recalled line's sent_at", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    const [sent] = await sentState(tabId);
    expect(sent!.sentAt).not.toBeNull();

    await asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1]));

    const [recalled] = await sentState(tabId);
    expect(recalled!.ticket!.firedAt).toBeNull();
    expect(recalled!.sentAt).toBe(sent!.sentAt);
  });

  it("reports the ticket's fired quantity on the station and expo queues, and the line's for an older ticket with none", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "2" }]),
    );
    // The line now bills three while the kitchen was asked for two.
    await db.execute(sql`
      update working_order_lines set quantity = 3000 where working_order_id = ${tabId}`);
    const [{ stationId }] = await db
      .select({ stationId: ticketItems.stationId })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    const queued = async () =>
      asApp(cfg, async (tx) => ({
        station: (await listStationQueue(tx, stationId!))[0]!.items[0]!.quantity,
        expo: (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!.qty,
      }));

    expect(await queued()).toEqual({ station: "2.000", expo: "2.000" });

    // A ticket fired before the column existed carries no quantity.
    await db.execute(
      sql`update ticket_items set quantity = null where working_order_id = ${tabId}`,
    );
    expect(await queued()).toEqual({ station: "3.000", expo: "3.000" });
  });
});

/** The one ticket item of a tab's line, and the station it went to. */
async function ticketOfLine(
  tabId: string,
  lineNo: number,
): Promise<{ id: string; stationId: string; quantity: number | null }> {
  const [row] = await db
    .select({
      id: ticketItems.id,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  return { id: row!.id, stationId: row!.stationId!, quantity: row!.quantity };
}

/** A station's notices, as the fields a cook reads. */
async function noticesAt(cfg: TillConfig, stationId: string) {
  return (await asApp(cfg, (tx) => listStationNotices(tx, cfg, stationId))).map((notice) => ({
    kind: notice.kind,
    lineName: notice.lineName,
    quantity: notice.quantity,
    wasStarted: notice.wasStarted,
  }));
}

async function linesOf(tabId: string) {
  return db
    .select({
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

describe("corrections to sent work reach the kitchen as notices, printer or not", () => {
  it("voiding a started item records a VOID notice marked started, then removes the line, with no printer", async () => {
    const { cfg, tableId, cafeId, cafeOffer } = await setupVenue();
    // The three names differ, so the notice is seen to carry the one a cook reads.
    await db.execute(sql`
      update products
      set kitchen_name = 'Café de cocina', customer_name = ${JSON.stringify({ es: "Café del cliente" })}
      where id = ${cafeId}`);
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    const ticket = await ticketOfLine(tabId, 1);
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, ticket.id, "preparing"));

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1));

    expect(await linesOf(tabId)).toEqual([]);
    // The notice keeps the line's name after the line is gone.
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café de cocina", quantity: "1.000", wasStarted: true },
    ]);
    // This venue's station has no printer: the notice is the only correction.
    expect(await db.select({ id: printJobs.id }).from(printJobs)).toEqual([]);
  });

  it("voiding a held line records no notice: the kitchen was never asked for it", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", hold: true }]),
    );
    const ticket = await ticketOfLine(tabId, 1);

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1));

    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("a partial void removes that quantity only, from the line, its extras and its ticket, and says so", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "3",
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 2 }] }],
        },
      ]),
    );
    const ticket = await ticketOfLine(tabId, 1);
    expect(ticket.quantity).toBe(3000);

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1, "1"));

    // The café at 1.50 for two dishes, and its extra at 0.50, two per dish, for four: each column
    // in its own scale, quantities in thousandths and money in cents.
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: 2000, lineTotal: 300 }),
      expect.objectContaining({ lineNo: 2, quantity: 4000, lineTotal: 200 }),
    ]);
    expect((await ticketOfLine(tabId, 1)).quantity).toBe(2000);
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
  });

  it("voids the whole line when the quantity given is the line's own", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "2" }]),
    );
    const ticket = await ticketOfLine(tabId, 1);

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1, "2"));

    expect(await linesOf(tabId)).toEqual([]);
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café", quantity: "2.000", wasStarted: false },
    ]);
  });

  it.each(["0", "-1", "3", "abc", ""])(
    "refuses to void a quantity of %j from a line of two, changing nothing",
    async (quantity) => {
      const { cfg, tableId, cafeOffer } = await setupVenue();
      const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
      await asApp(cfg, (tx) =>
        addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "2" }]),
      );
      const ticket = await ticketOfLine(tabId, 1);

      await expect(
        asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1, quantity)),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "quantity" },
      });
      expect(await linesOf(tabId)).toEqual([expect.objectContaining({ quantity: 2000 })]);
      expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
    },
  );

  it("refuses to void a fraction of a line counted in whole units, changing nothing", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "2" }]),
    );
    const ticket = await ticketOfLine(tabId, 1);

    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1, "0.5"))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "quantity" },
    });
    expect(await linesOf(tabId)).toEqual([expect.objectContaining({ quantity: 2000 })]);
    expect((await ticketOfLine(tabId, 1)).quantity).toBe(2000);
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("refuses to void part of an extras line, whose quantity follows its dish", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "2",
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );

    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 2, "1"))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "quantity" },
    });
    expect((await linesOf(tabId)).map((line) => line.quantity)).toEqual([2000, 2000]);
  });

  it("a recall records a RECALLED notice for the fired line only", async () => {
    const { cfg, tableId, cafeOffer, aguaOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "2" },
        { menuItemId: aguaOffer, quantity: "1", hold: true },
      ]),
    );
    const ticket = await ticketOfLine(tabId, 1);

    await asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1, 2]));

    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "recalled", lineName: "Café", quantity: "2.000", wasStarted: false },
    ]);
  });
});

describe("with changes to sent items switched off", () => {
  it("refuses to recall a line that was sent to a station, and changes nothing", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    await asApp(cfg, (tx) => writeEditSentLines(tx, false));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    const ticket = await ticketOfLine(tabId, 1);

    await expect(asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1]))).rejects.toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: tabId },
    });
    const [state] = await sentState(tabId);
    expect(state!.ticket!.firedAt).not.toBeNull();
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("still recalls a held line that was never sent", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    await asApp(cfg, (tx) => writeEditSentLines(tx, false));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", hold: true }]),
    );

    await expect(asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1]))).resolves.toBeUndefined();
  });

  it("still voids a sent line: the notice is recorded and the line leaves the bill", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    await asApp(cfg, (tx) => writeEditSentLines(tx, false));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    const ticket = await ticketOfLine(tabId, 1);

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1));

    expect(await linesOf(tabId)).toEqual([]);
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
  });

  it("recalls a sent line once the setting is back on", async () => {
    const { cfg, tableId, cafeOffer } = await setupVenue();
    await asApp(cfg, (tx) => writeEditSentLines(tx, false));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    await asApp(cfg, (tx) => writeEditSentLines(tx, true));

    await asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1]));

    const [state] = await sentState(tabId);
    expect(state!.ticket!.firedAt).toBeNull();
  });
});

describe("a line with no fired ticket whose product sold out cannot be sent", () => {
  it("refuses to send a recalled line again once its product is unavailable, changing nothing", async () => {
    const { cfg, tableId, cafeId, cafeOffer } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1" }]),
    );
    await asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1]));
    await db.execute(sql`update products set available = 0 where id = ${cafeId}`);

    await expect(asApp(cfg, (tx) => sendLines(tx, cfg, tabId, [1]))).rejects.toMatchObject({
      code: "product.unavailable",
      params: { productId: cafeId },
    });
    const [state] = await sentState(tabId);
    expect(state!.ticket!.firedAt).toBeNull();
  });

  it("refuses to fire a held course whose line sold out, and one whose extra did", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const course = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 3 }),
    );
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          courseId: course.id,
          hold: true,
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );
    await db.execute(sql`update products set available = 0 where id = ${aguaId}`);

    await expect(asApp(cfg, (tx) => fireCourse(tx, cfg, tabId, course.id))).rejects.toMatchObject({
      code: "product.unavailable",
      params: { productId: aguaId },
    });
    expect((await sentState(tabId)).map((line) => line.sentAt)).toEqual([null, null]);
  });

  it("sends a held line whose product is still available", async () => {
    const { cfg, tableId, cafeOffer, aguaId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", hold: true }]),
    );
    // Another product selling out does not matter.
    await db.execute(sql`update products set available = 0 where id = ${aguaId}`);

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, []));

    expect((await sentState(tabId))[0]!.ticket!.firedAt).not.toBeNull();
  });
});

/** The order's revision as stored: what a till's copy of it carries back. */
async function revisionOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.revision;
}

/** One line's ticket item, whole, or `null` when it has none. */
async function ticketRow(tabId: string, lineNo: number) {
  const [row] = await db
    .select({
      id: ticketItems.id,
      firedAt: ticketItems.firedAt,
      note: ticketItems.note,
      quantity: ticketItems.quantity,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  return row ?? null;
}

/** A tab with one café line fired to the default station at `quantity`, and that station's id. */
async function tabWithFiredCafe(quantity = "1") {
  const venue = await setupVenue();
  const { cfg, tableId, cafeOffer } = venue;
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
  await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity }]));
  const ticket = await ticketOfLine(tabId, 1);
  const [line] = await db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  return { ...venue, tabId, ticket, lineId: line!.id };
}

describe("editing a line the kitchen has and has not started (plan D10, spec §10.3)", () => {
  it("a change to a sent, not-started line recalls the old item with a notice and fires the changed line as a new item, price unchanged", async () => {
    const { cfg, tabId, ticket } = await tabWithFiredCafe();
    const before = await linesOf(tabId);

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { note: "no onions" }, await revisionOf(tabId)),
    );

    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "recalled", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
    const fresh = await ticketRow(tabId, 1);
    expect(fresh).toMatchObject({ note: "no onions", quantity: 1000, state: "queued" });
    expect(fresh!.id).not.toBe(ticket.id);
    expect(fresh!.firedAt).not.toBeNull();
    expect(await linesOf(tabId)).toEqual(before);
  });

  it("the same change through the whole-order save is never a silent delete", async () => {
    const { cfg, tabId, ticket, lineId, cafeOffer } = await tabWithFiredCafe();

    await updateHeldOrder({ db }, cfg, tabId, {
      revision: await revisionOf(tabId),
      lines: [
        { workingOrderLineId: lineId, menuItemId: cafeOffer, quantity: "1", note: "no onions" },
      ],
    });

    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "recalled", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
    const fresh = await ticketRow(tabId, 1);
    expect(fresh).toMatchObject({ note: "no onions", quantity: 1000 });
    expect(fresh!.id).not.toBe(ticket.id);
  });

  it("a quantity rise leaves the fired item as it was and sends the difference as a new line", async () => {
    const { cfg, tabId, ticket, cafeId } = await tabWithFiredCafe();
    await db.execute(sql`update products set unit_price = 175 where id = ${cafeId}`);

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { quantity: "2" }, await revisionOf(tabId)),
    );

    // The first café at the 1.50 it was sold at; the second at today's 1.75.
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: 1000, lineTotal: 150 }),
      expect.objectContaining({ lineNo: 2, quantity: 1000, lineTotal: 175 }),
    ]);
    expect(await ticketRow(tabId, 1)).toMatchObject({ id: ticket.id, quantity: 1000 });
    const added = await ticketRow(tabId, 2);
    expect(added).toMatchObject({ quantity: 1000, state: "queued" });
    expect(added!.firedAt).not.toBeNull();
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("a quantity drop is a void of the difference: a VOID notice, and the ticket's quantity follows", async () => {
    const { cfg, tabId, ticket } = await tabWithFiredCafe("2");

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { quantity: "1" }, await revisionOf(tabId)),
    );

    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: 1000, lineTotal: 150 }),
    ]);
    expect(await ticketRow(tabId, 1)).toMatchObject({ id: ticket.id, quantity: 1000 });
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
  });

  it("removing a sent, not-started line from the whole-order save voids it with a notice", async () => {
    const { cfg, tabId, ticket, aguaOffer } = await tabWithFiredCafe();

    await updateHeldOrder({ db }, cfg, tabId, {
      revision: await revisionOf(tabId),
      lines: [{ menuItemId: aguaOffer, quantity: "1" }],
    });

    expect((await linesOf(tabId)).map((line) => line.lineNo)).toEqual([2]);
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
    // The tab has work sent, so the new line goes to the kitchen as a round's would.
    expect((await ticketRow(tabId, 2))!.firedAt).not.toBeNull();
  });

  it("refuses any edit of a started line, and its removal, changing nothing", async () => {
    const { cfg, tabId, ticket, aguaOffer } = await tabWithFiredCafe();
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, ticket.id, "preparing"));
    const before = await linesOf(tabId);

    for (const patch of [{ note: "no onions" }, { quantity: "2" }]) {
      await expect(
        asApp(cfg, async (tx) =>
          updateOrderLine(tx, cfg, tabId, 1, patch, await revisionOf(tabId)),
        ),
      ).rejects.toMatchObject({
        code: "ticket.already_started",
        params: { ticketItemId: ticket.id },
      });
    }
    await expect(
      updateHeldOrder({ db }, cfg, tabId, {
        revision: await revisionOf(tabId),
        lines: [{ menuItemId: aguaOffer, quantity: "1" }],
      }),
    ).rejects.toMatchObject({ code: "ticket.already_started" });

    expect(await linesOf(tabId)).toEqual(before);
    expect(await ticketRow(tabId, 1)).toMatchObject({ id: ticket.id, state: "preparing" });
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("with changes to sent items switched off, refuses an edit of a sent line, changing nothing", async () => {
    const { cfg, tabId, ticket, lineId, cafeOffer } = await tabWithFiredCafe();
    await asApp(cfg, (tx) => writeEditSentLines(tx, false));
    const before = await linesOf(tabId);

    await expect(
      asApp(cfg, async (tx) =>
        updateOrderLine(tx, cfg, tabId, 1, { note: "no onions" }, await revisionOf(tabId)),
      ),
    ).rejects.toMatchObject({ code: "ticket.already_fired", params: { workingOrderId: tabId } });
    await expect(
      updateHeldOrder({ db }, cfg, tabId, {
        revision: await revisionOf(tabId),
        lines: [{ workingOrderLineId: lineId, menuItemId: cafeOffer, quantity: "2" }],
      }),
    ).rejects.toMatchObject({ code: "ticket.already_fired" });

    expect(await linesOf(tabId)).toEqual(before);
    expect(await ticketRow(tabId, 1)).toMatchObject({ id: ticket.id });
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("edits a recalled line freely: no notice, and its held item carries the change when sent again", async () => {
    const { cfg, tabId, ticket } = await tabWithFiredCafe();
    await asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [1]));
    const recallNotices = await noticesAt(cfg, ticket.stationId);

    await asApp(cfg, async (tx) =>
      updateOrderLine(
        tx,
        cfg,
        tabId,
        1,
        { note: "no onions", quantity: "3" },
        await revisionOf(tabId),
      ),
    );

    expect(await noticesAt(cfg, ticket.stationId)).toEqual(recallNotices);
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: 3000, lineTotal: 450 }),
    ]);
    expect(await ticketRow(tabId, 1)).toMatchObject({
      id: ticket.id,
      firedAt: null,
      note: "no onions",
      quantity: 3000,
    });
  });

  it("edits a held-course line and a no-route line freely, with no notice", async () => {
    const { cfg, tableId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    await routeToNoPreparation(aguaId);
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", hold: true },
        { menuItemId: aguaOffer, quantity: "1" },
      ]),
    );
    const held = await ticketOfLine(tabId, 1);

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { note: "later" }, await revisionOf(tabId)),
    );
    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 2, { quantity: "2" }, await revisionOf(tabId)),
    );

    expect(await ticketRow(tabId, 1)).toMatchObject({ id: held.id, firedAt: null, note: "later" });
    expect(await ticketRow(tabId, 2)).toBeNull();
    expect((await linesOf(tabId)).map((line) => line.quantity)).toEqual([1000, 2000]);
    expect(await noticesAt(cfg, held.stationId)).toEqual([]);
  });

  it("refuses an edit made from a copy another edit has since changed, changing nothing", async () => {
    const { cfg, tabId } = await tabWithFiredCafe("3");
    const copy = await revisionOf(tabId);

    await asApp(cfg, (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { quantity: "3", note: "a" }, copy),
    );
    const landed = await linesOf(tabId);

    await expect(
      asApp(cfg, (tx) => updateOrderLine(tx, cfg, tabId, 1, { quantity: "2" }, copy)),
    ).rejects.toMatchObject({
      code: "working_order.out_of_date",
      params: { workingOrderId: tabId },
    });
    expect(await linesOf(tabId)).toEqual(landed);
  });

  it("refuses to send a changed line again once its dish sold out, changing nothing", async () => {
    const { cfg, tabId, ticket, cafeId } = await tabWithFiredCafe();
    await db.execute(sql`update products set available = 0 where id = ${cafeId}`);

    await expect(
      asApp(cfg, async (tx) =>
        updateOrderLine(tx, cfg, tabId, 1, { note: "no onions" }, await revisionOf(tabId)),
      ),
    ).rejects.toMatchObject({ code: "product.unavailable", params: { productId: cafeId } });
    expect(await ticketRow(tabId, 1)).toMatchObject({ id: ticket.id, note: null });
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([]);
  });

  it("refuses a quantity the line's unit cannot take, and one that is not positive", async () => {
    const { cfg, tabId } = await tabWithFiredCafe();
    const before = await linesOf(tabId);

    for (const [quantity, reason] of [
      ["1.5", "precision"],
      ["0", "positive"],
    ]) {
      await expect(
        asApp(cfg, async (tx) =>
          updateOrderLine(tx, cfg, tabId, 1, { quantity }, await revisionOf(tabId)),
        ),
      ).rejects.toMatchObject({ code: "quantity.invalid", params: { reason } });
    }
    expect(await linesOf(tabId)).toEqual(before);
  });

  it("an extra added to a sent line is priced now, and the line moves after the highest number with its extras", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer, aguaOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
        { menuItemId: aguaOffer, quantity: "1" },
      ]),
    );
    const ticket = await ticketOfLine(tabId, 1);
    await db.execute(sql`update extra_list_items set price = 80 where list_id = ${listId}`);

    await asApp(cfg, async (tx) =>
      updateOrderLine(
        tx,
        cfg,
        tabId,
        1,
        { extras: [{ listId, picks: [{ productId: aguaId, quantity: 2 }] }] },
        await revisionOf(tabId),
      ),
    );

    // The water extra taken twice is a new pick: the one at 0.50 goes, two at 0.80 come.
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 3, parentLineId: null, quantity: 1000 }),
      expect.objectContaining({ lineNo: 4, parentLineId: null, quantity: 1000, lineTotal: 150 }),
      expect.objectContaining({ lineNo: 5, quantity: 2000, lineTotal: 160 }),
    ]);
    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "recalled", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
    expect((await ticketRow(tabId, 4))!.firedAt).not.toBeNull();
  });

  it("changing a sent line's dish voids it with a notice and sends the new dish", async () => {
    const { cfg, tabId, ticket, lineId, aguaOffer } = await tabWithFiredCafe();

    await updateHeldOrder({ db }, cfg, tabId, {
      revision: await revisionOf(tabId),
      lines: [{ workingOrderLineId: lineId, menuItemId: aguaOffer, quantity: "1" }],
    });

    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "void", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
    expect(await linesOf(tabId)).toEqual([expect.objectContaining({ lineNo: 2, lineTotal: 200 })]);
    expect((await ticketRow(tabId, 2))!.firedAt).not.toBeNull();
  });

  it("a change with a rise to a sent line recalls it, sends it again at its own quantity, and adds the difference", async () => {
    const { cfg, tabId, ticket } = await tabWithFiredCafe();

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { note: "tibio", quantity: "2" }, await revisionOf(tabId)),
    );

    expect(await noticesAt(cfg, ticket.stationId)).toEqual([
      { kind: "recalled", lineName: "Café", quantity: "1.000", wasStarted: false },
    ]);
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: 1000, lineTotal: 150 }),
      expect.objectContaining({ lineNo: 2, quantity: 1000, lineTotal: 150 }),
    ]);
    for (const lineNo of [1, 2]) {
      const item = await ticketRow(tabId, lineNo);
      expect(item).toMatchObject({ note: "tibio", quantity: 1000 });
      expect(item!.firedAt).not.toBeNull();
    }
    expect((await ticketRow(tabId, 1))!.id).not.toBe(ticket.id);
  });

  it("a sent line's extras follow it: kept through a change, and copied onto a rise's new line at today's price", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );
    await db.execute(sql`update extra_list_items set price = 80 where list_id = ${listId}`);

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { note: "solo" }, await revisionOf(tabId)),
    );
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: 1000, lineTotal: 150 }),
      expect.objectContaining({ lineNo: 2, quantity: 1000, lineTotal: 50 }),
    ]);

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 1, { quantity: "2" }, await revisionOf(tabId)),
    );
    // The stored café and its extra as sold; the second café new, its extra at today's 0.80.
    expect(await linesOf(tabId)).toEqual([
      expect.objectContaining({ lineNo: 1, parentLineId: null, lineTotal: 150 }),
      expect.objectContaining({ lineNo: 2, lineTotal: 50 }),
      expect.objectContaining({ lineNo: 3, parentLineId: null, lineTotal: 150 }),
      expect.objectContaining({ lineNo: 4, lineTotal: 80 }),
    ]);
    expect((await ticketRow(tabId, 3))!.firedAt).not.toBeNull();
  });

  it("refuses to copy an extra that records no list onto a rise's new line", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );
    // As a child stored before lines recorded their list.
    await db.execute(sql`
      update working_order_lines set extra_list_id = null
      where working_order_id = ${tabId} and parent_line_id is not null`);
    const before = await linesOf(tabId);

    await expect(
      asApp(cfg, async (tx) =>
        updateOrderLine(tx, cfg, tabId, 1, { quantity: "2" }, await revisionOf(tabId)),
      ),
    ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "listId" } });
    expect(await linesOf(tabId)).toEqual(before);
  });

  it("keeps an extra whose product sold out on a line the kitchen does not have, and refuses to send it again on one it has", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const withWater = [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }];
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    // Dishes at lines 1 (held), 3 (two, fired) and 5 (fired, then recalled), each followed by its
    // extra.
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: cafeOffer, quantity: "1", extras: withWater, hold: true },
        { menuItemId: cafeOffer, quantity: "2", extras: withWater },
        { menuItemId: cafeOffer, quantity: "1", extras: withWater },
      ]),
    );
    await asApp(cfg, (tx) => recallLines(tx, cfg, tabId, [5]));
    await db.execute(sql`update products set available = 0 where id = ${aguaId}`);
    const edit = (lineNo: number, patch: { note?: string; quantity?: string }) =>
      asApp(cfg, async (tx) =>
        updateOrderLine(tx, cfg, tabId, lineNo, patch, await revisionOf(tabId)),
      );

    await edit(1, { note: "later" });
    await edit(5, { note: "later" });
    // A drop sends nothing again: it is a void of the difference.
    await edit(3, { quantity: "1" });
    expect(
      (await linesOf(tabId)).map((line) => [
        line.lineNo,
        line.parentLineId !== null,
        line.quantity,
      ]),
    ).toEqual([
      [1, false, 1000],
      [2, true, 1000],
      [3, false, 1000],
      [4, true, 1000],
      [5, false, 1000],
      [6, true, 1000],
    ]);

    await expect(edit(3, { note: "now" })).rejects.toMatchObject({
      code: "product.unavailable",
      params: { productId: aguaId },
    });
    for (const lineNo of [1, 3]) {
      await expect(edit(lineNo, { quantity: "2" })).rejects.toMatchObject({
        code: "extras.invalid",
        params: { field: "productId" },
      });
    }
  });

  it("refuses an unknown line, and an extras line, which follows its dish", async () => {
    const { cfg, tableId, cafeId, aguaId, cafeOffer } = await setupVenue();
    const listId = await asApp(cfg, (tx) => attachExtras(tx, cfg, cafeId, aguaId));
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: cafeOffer,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );

    await expect(
      asApp(cfg, async (tx) =>
        updateOrderLine(tx, cfg, tabId, 9, { note: "x" }, await revisionOf(tabId)),
      ),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId, lineNo: 9 } });
    await expect(
      asApp(cfg, async (tx) =>
        updateOrderLine(tx, cfg, tabId, 2, { note: "x" }, await revisionOf(tabId)),
      ),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "lineNo" } });
  });
});

/** Each line's number and whether its ticket item has fired; `null` for a line with no item. */
async function firedByLine(orderId: string): Promise<[number, boolean | null][]> {
  return (await sentState(orderId)).map((line) => [
    line.lineNo,
    line.ticket === null ? null : line.ticket.firedAt !== null,
  ]);
}

/** A tab whose water (starters, the earliest course) fired at its round and whose café (mains, a
 * later course) was then fired with `fireCourse`: the café is the only fired dish of its course. */
async function tabWithFiredMains() {
  const venue = await setupVenue();
  const { cfg, cafeId, aguaId, tableId, cafeOffer, aguaOffer } = venue;
  const starters = await asApp(cfg, (tx) =>
    createCourse(tx, cfg, { name: "Entrantes", displayOrder: 1 }),
  );
  const mains = await asApp(cfg, (tx) =>
    createCourse(tx, cfg, { name: "Principales", displayOrder: 2 }),
  );
  await asApp(cfg, (tx) => setProductCourse(tx, cfg, aguaId, starters.id));
  await asApp(cfg, (tx) => setProductCourse(tx, cfg, cafeId, mains.id));
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
  await asApp(cfg, (tx) =>
    addTabRound(tx, cfg, tabId, [
      { menuItemId: aguaOffer, quantity: "1" },
      { menuItemId: cafeOffer, quantity: "1" },
    ]),
  );
  expect(await firedByLine(tabId)).toEqual([
    [1, true],
    [2, false],
  ]);
  await asApp(cfg, (tx) => fireCourse(tx, cfg, tabId, mains.id));
  const [water, cafe] = await db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  return { ...venue, tabId, waterLineId: water!.id, cafeLineId: cafe!.id };
}

/** A tab whose only round was held: one café, with a held ticket item and nothing sent. */
async function tabWithHeldCafe() {
  const venue = await setupVenue();
  const { cfg, tableId, cafeOffer } = venue;
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
  await asApp(cfg, (tx) =>
    addTabRound(tx, cfg, tabId, [{ menuItemId: cafeOffer, quantity: "1", hold: true }]),
  );
  const [line] = await db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  return { ...venue, tabId, lineId: line!.id };
}

describe("new work an edit adds reaches the kitchen as a round's would (plan D10)", () => {
  it("a change with a rise to the only fired dish of a later course sends the added unit at once", async () => {
    const { cfg, tabId } = await tabWithFiredMains();

    await asApp(cfg, async (tx) =>
      updateOrderLine(tx, cfg, tabId, 2, { note: "tibio", quantity: "2" }, await revisionOf(tabId)),
    );

    expect(await firedByLine(tabId)).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);
  });

  it("a whole-order save that changes the only fired dish of a later course sends a new dish of that course at once", async () => {
    const { cfg, tabId, waterLineId, cafeLineId, cafeOffer, aguaOffer } = await tabWithFiredMains();

    await updateHeldOrder({ db }, cfg, tabId, {
      lines: [
        { workingOrderLineId: waterLineId, menuItemId: aguaOffer, quantity: "1" },
        { workingOrderLineId: cafeLineId, menuItemId: cafeOffer, quantity: "1", note: "tibio" },
        { menuItemId: cafeOffer, quantity: "1" },
      ],
      revision: await revisionOf(tabId),
    });

    expect(await firedByLine(tabId)).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);
  });

  it("a line a whole-order save adds to a tab whose every line is held is held too, and Send releases it", async () => {
    const { cfg, tabId, lineId, cafeOffer, aguaOffer } = await tabWithHeldCafe();

    await updateHeldOrder({ db }, cfg, tabId, {
      lines: [
        { workingOrderLineId: lineId, menuItemId: cafeOffer, quantity: "1" },
        { menuItemId: aguaOffer, quantity: "1" },
      ],
      revision: await revisionOf(tabId),
    });
    expect(await firedByLine(tabId)).toEqual([
      [1, false],
      [2, false],
    ]);

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, []));
    expect(await firedByLine(tabId)).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it("replacing the dish of a held line on a tab whose every line is held keeps the new dish held for Send", async () => {
    const { cfg, tabId, lineId, aguaId, aguaOffer } = await tabWithHeldCafe();

    await updateHeldOrder({ db }, cfg, tabId, {
      lines: [{ workingOrderLineId: lineId, menuItemId: aguaOffer, quantity: "1" }],
      revision: await revisionOf(tabId),
    });
    expect(await firedByLine(tabId)).toEqual([[2, false]]);

    await asApp(cfg, (tx) => sendLines(tx, cfg, tabId, []));
    expect(await sentState(tabId)).toEqual([
      expect.objectContaining({
        lineNo: 2,
        productId: aguaId,
        ticket: expect.objectContaining({ firedAt: expect.any(String) }),
      }),
    ]);
  });
});

/** Two open tabs at their own tables: `tabId` with a café line of 3 and a held one in a course,
 * `otherId` with one café line. */
async function twoTabs() {
  const venue = await setupVenue();
  const { cfg, tableId, cafeOffer } = venue;
  const course = await asApp(cfg, (tx) =>
    createCourse(tx, cfg, { name: "Postres", displayOrder: 3 }),
  );
  const otherTable = await asApp(cfg, async (tx) => {
    const { zoneId } = await offerProducts(tx, cfg, { zone: "tables" });
    return (await createTable(tx, cfg, { label: "T2", zoneId })).id;
  });
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
  const { tabId: otherId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId: otherTable }));
  await asApp(cfg, (tx) =>
    addTabRound(tx, cfg, tabId, [
      { menuItemId: cafeOffer, quantity: "3" },
      { menuItemId: cafeOffer, quantity: "1", courseId: course.id, hold: true },
    ]),
  );
  await asApp(cfg, (tx) =>
    addTabRound(tx, cfg, otherId, [{ menuItemId: cafeOffer, quantity: "1" }]),
  );
  return { ...venue, tabId, otherId, courseId: course.id };
}
type Tabs = Awaited<ReturnType<typeof twoTabs>>;

describe("every write to an open order's lines counts on its revision (plan D10)", () => {
  it.each<[string, (tx: Transaction, tabs: Tabs) => Promise<unknown>, ("tab" | "other")[]]>([
    [
      "a round",
      (tx, t) => addTabRound(tx, t.cfg, t.tabId, [{ menuItemId: t.cafeOffer, quantity: "1" }]),
      ["tab"],
    ],
    ["a void", (tx, t) => voidTabLine(tx, t.cfg, t.tabId, 1, "1"), ["tab"]],
    ["a recall", (tx, t) => recallLines(tx, t.cfg, t.tabId, [1]), ["tab"]],
    ["a send", (tx, t) => sendLines(tx, t.cfg, t.tabId, [2]), ["tab"]],
    ["a course fired", (tx, t) => fireCourse(tx, t.cfg, t.tabId, t.courseId), ["tab"]],
    ["a course change", (tx, t) => setLineCourse(tx, t.cfg, t.tabId, 2, null), ["tab"]],
    ["a served mark", (tx, t) => markLineServed(tx, t.cfg, t.tabId, 1), ["tab"]],
    ["a served mark cleared", (tx, t) => unmarkLineServed(tx, t.cfg, t.tabId, 1), ["tab"]],
    [
      "a transfer",
      (tx, t) => transferLines(tx, t.cfg, t.tabId, t.otherId, [{ lineNo: 1, quantity: "1" }]),
      ["tab", "other"],
    ],
    [
      "a split",
      (tx, t) => splitOffCheck(tx, t.cfg, t.tabId, [{ lineNo: 1, quantity: "1" }]),
      ["tab"],
    ],
    ["a move of lines", (tx, t) => moveTabLines(tx, t.cfg, t.otherId, t.tabId), ["tab", "other"]],
    [
      "a merge",
      (tx, t) => mergeTabs(tx, t.cfg, t.tabId, t.otherId, { freeSourceTable: true }),
      ["tab"],
    ],
    [
      "a line edit",
      async (tx, t) =>
        updateOrderLine(tx, t.cfg, t.tabId, 1, { note: "x" }, await revisionOf(t.tabId)),
      ["tab"],
    ],
  ])("%s", async (_name, write, counted) => {
    const tabs = await twoTabs();
    const before = { tab: await revisionOf(tabs.tabId), other: await revisionOf(tabs.otherId) };

    await asApp(tabs.cfg, (tx) => write(tx, tabs));

    for (const which of counted) {
      const id = which === "tab" ? tabs.tabId : tabs.otherId;
      expect(await revisionOf(id)).toBe(before[which] + 1);
    }
  });

  it("does not count a write refused as out of date, nor one that changes nothing", async () => {
    const { cfg, tabId, cafeOffer } = await twoTabs();
    const copy = await revisionOf(tabId);
    await asApp(cfg, (tx) => updateOrderLine(tx, cfg, tabId, 1, { note: "a" }, copy));

    await expect(
      asApp(cfg, (tx) => updateOrderLine(tx, cfg, tabId, 1, { note: "b" }, copy)),
    ).rejects.toMatchObject({ code: "working_order.out_of_date", params: { revision: copy + 1 } });
    expect(await revisionOf(tabId)).toBe(copy + 1);

    // An empty patch, a note the line already carries, and the whole order saved as it stands.
    await asApp(cfg, (tx) => updateOrderLine(tx, cfg, tabId, 1, {}, copy + 1));
    await asApp(cfg, (tx) => updateOrderLine(tx, cfg, tabId, 1, { note: "a" }, copy + 1));
    const lines = await db
      .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    await updateHeldOrder({ db }, cfg, tabId, {
      lines: [
        { workingOrderLineId: lines[0]!.id, menuItemId: cafeOffer, quantity: "3", note: "a" },
        { workingOrderLineId: lines[1]!.id, menuItemId: cafeOffer, quantity: "1" },
      ],
      revision: copy + 1,
    });
    expect(await revisionOf(tabId)).toBe(copy + 1);
  });

  it("counts a whole-order save whose only change is the label", async () => {
    const { cfg, tabId, cafeOffer } = await twoTabs();
    const lines = await db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    const copy = await revisionOf(tabId);

    await updateHeldOrder({ db }, cfg, tabId, {
      lines: [
        { workingOrderLineId: lines[0]!.id, menuItemId: cafeOffer, quantity: "3" },
        { workingOrderLineId: lines[1]!.id, menuItemId: cafeOffer, quantity: "1" },
      ],
      label: "Ventana",
      revision: copy,
    });

    expect(await revisionOf(tabId)).toBe(copy + 1);
    const [order] = await db
      .select({ label: workingOrders.label })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId));
    expect(order!.label).toBe("Ventana");
  });
});

describe("a line write on an order whose card payment is in flight is refused (plan D22)", () => {
  const MARK = "2026-09-26T10:00:00.000Z";

  async function markPaying(orderId: string, at: string | null = MARK): Promise<void> {
    await db
      .update(workingOrders)
      .set({ paymentAttemptAt: at })
      .where(eq(workingOrders.id, orderId));
  }

  /** Everything a refused write could have changed on either tab. */
  async function snapshot(t: Tabs) {
    const lines = await db
      .select({
        orderId: workingOrderLines.workingOrderId,
        lineNo: workingOrderLines.lineNo,
        quantity: workingOrderLines.quantity,
        note: workingOrderLines.note,
        servedAt: workingOrderLines.servedAt,
        courseId: workingOrderLines.courseId,
        sentAt: workingOrderLines.sentAt,
        firedAt: ticketItems.firedAt,
      })
      .from(workingOrderLines)
      .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(inArray(workingOrderLines.workingOrderId, [t.tabId, t.otherId]))
      .orderBy(workingOrderLines.workingOrderId, workingOrderLines.lineNo);
    const orders = await db
      .select({
        id: workingOrders.id,
        status: workingOrders.status,
        revision: workingOrders.revision,
      })
      .from(workingOrders)
      .where(inArray(workingOrders.id, [t.tabId, t.otherId]))
      .orderBy(workingOrders.id);
    return { lines, orders };
  }

  // Each write, and every order it writes lines on: a mark on any of them refuses it.
  it.each<[string, (tx: Transaction, tabs: Tabs) => Promise<unknown>, ("tab" | "other")[]]>([
    [
      "a round",
      (tx, t) => addTabRound(tx, t.cfg, t.tabId, [{ menuItemId: t.cafeOffer, quantity: "1" }]),
      ["tab"],
    ],
    ["a void", (tx, t) => voidTabLine(tx, t.cfg, t.tabId, 1), ["tab"]],
    ["a part void", (tx, t) => voidTabLine(tx, t.cfg, t.tabId, 1, "1"), ["tab"]],
    ["a recall", (tx, t) => recallLines(tx, t.cfg, t.tabId, [1]), ["tab"]],
    ["a send", (tx, t) => sendLines(tx, t.cfg, t.tabId, [2]), ["tab"]],
    ["a course fired", (tx, t) => fireCourse(tx, t.cfg, t.tabId, t.courseId), ["tab"]],
    ["a course change", (tx, t) => setLineCourse(tx, t.cfg, t.tabId, 2, null), ["tab"]],
    ["a served mark", (tx, t) => markLineServed(tx, t.cfg, t.tabId, 1), ["tab"]],
    [
      "a transfer",
      (tx, t) => transferLines(tx, t.cfg, t.tabId, t.otherId, [{ lineNo: 1, quantity: "1" }]),
      ["tab", "other"],
    ],
    [
      "a split",
      (tx, t) => splitOffCheck(tx, t.cfg, t.tabId, [{ lineNo: 1, quantity: "1" }]),
      ["tab"],
    ],
    ["a move of lines", (tx, t) => moveTabLines(tx, t.cfg, t.otherId, t.tabId), ["tab", "other"]],
    [
      "a merge",
      (tx, t) => mergeTabs(tx, t.cfg, t.tabId, t.otherId, { freeSourceTable: true }),
      ["tab", "other"],
    ],
    [
      "a line edit",
      async (tx, t) =>
        updateOrderLine(tx, t.cfg, t.tabId, 1, { note: "x" }, await revisionOf(t.tabId)),
      ["tab"],
    ],
  ])("%s", async (_name, write, touched) => {
    const tabs = await twoTabs();
    for (const which of touched) {
      const paying = which === "tab" ? tabs.tabId : tabs.otherId;
      await markPaying(paying, MARK);
      const before = await snapshot(tabs);

      await expect(asApp(tabs.cfg, (tx) => write(tx, tabs))).rejects.toMatchObject({
        code: "order.payment_in_flight",
        params: { workingOrderId: paying },
      });
      expect(await snapshot(tabs)).toEqual(before);
      await markPaying(paying, null);
    }
  });

  it("refuses even an edit that changes nothing, one line or the whole order", async () => {
    const tabs = await twoTabs();
    const lines = await db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabs.tabId))
      .orderBy(workingOrderLines.lineNo);
    await markPaying(tabs.tabId);
    const revision = await revisionOf(tabs.tabId);

    await expect(
      asApp(tabs.cfg, (tx) => updateOrderLine(tx, tabs.cfg, tabs.tabId, 1, {}, revision)),
    ).rejects.toMatchObject({ code: "order.payment_in_flight" });
    await expect(
      updateHeldOrder({ db }, tabs.cfg, tabs.tabId, {
        lines: [
          { workingOrderLineId: lines[0]!.id, menuItemId: tabs.cafeOffer, quantity: "3" },
          { workingOrderLineId: lines[1]!.id, menuItemId: tabs.cafeOffer, quantity: "1" },
        ],
        revision,
      }),
    ).rejects.toMatchObject({ code: "order.payment_in_flight" });
  });

  it("never blocks a different order", async () => {
    const tabs = await twoTabs();
    await markPaying(tabs.otherId);
    const before = await revisionOf(tabs.tabId);

    await asApp(tabs.cfg, (tx) =>
      addTabRound(tx, tabs.cfg, tabs.tabId, [{ menuItemId: tabs.cafeOffer, quantity: "1" }]),
    );
    await asApp(tabs.cfg, (tx) => voidTabLine(tx, tabs.cfg, tabs.tabId, 1, "1"));
    await asApp(tabs.cfg, async (tx) =>
      updateOrderLine(tx, tabs.cfg, tabs.tabId, 1, { note: "x" }, await revisionOf(tabs.tabId)),
    );

    expect(await revisionOf(tabs.tabId)).toBe(before + 3);
  });
});
