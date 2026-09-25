import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  locations,
  nowIso,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { departments, preparationRoutes } from "@waitron/venue-service";
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
  createOpenOrder,
  fireLines,
  listTablesWithState,
  markLineServed,
  openTab,
  readTabLines,
  unmarkLineServed,
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
