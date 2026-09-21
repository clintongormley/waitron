import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createMenuItem,
  createMenuSection,
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
// The whole manifest (`manifestSets()`), applied in order — the tables here belong to modules (e.g.
// bookings) that FK into core, so the shared ordered set is the fixture.
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
}

async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values ('Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  // KDS-1: a default kitchen station so addTabRound's fire (→ fireLines) has a fallback. Seeded as the
  // superuser here, as the surrounding venue rows are (fixture setup).
  await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (location_id, name) values (${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const { cafeId, aguaId, cafeMenuItemId, aguaMenuItemId, menuId, categoryId, tableId } =
    await withTransaction(db, async (tx) => {
      await asAppUser(tx);
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
      const section = await createMenuSection(tx, {
        menuId: cat.id,
        name: { [LOCALE]: "Bebidas" },
      });
      const cafeMenuItem = await createMenuItem(tx, {
        menuId: cat.id,
        productId: cafe.id,
        sectionId: section.id,
        grossPrice: "1.50",
      });
      const aguaMenuItem = await createMenuItem(tx, {
        menuId: cat.id,
        productId: agua.id,
        sectionId: section.id,
        grossPrice: "2.00",
      });
      const table = await createTable(tx, cfg, { label: "T1" });
      return {
        cafeId: cafe.id,
        aguaId: agua.id,
        cafeMenuItemId: cafeMenuItem.id,
        aguaMenuItemId: aguaMenuItem.id,
        menuId: cat.id,
        categoryId: bebidas.id,
        tableId: table.id,
      };
    });
  return { cfg, cafeId, aguaId, cafeMenuItemId, aguaMenuItemId, menuId, categoryId, tableId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Offer `extraProductId` as an extra of `dishId` through a one-item list, returning the list id a
 *  round line names. `minPicks: 0` leaves the list optional, so the dish still orders on its own.
 *  The list's customer and kitchen names are left to fall back to its staff name: no assertion in
 *  this file reads a list name, only the picked PRODUCT a child line carries. */
async function attachExtras(
  tx: Transaction,
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
  return list.id;
}

/** A PLACED counter delivery to `tableId`, FIRED to the kitchen (one ticket item), not yet collected —
 *  the KDS-1 successor to the old "delivery with an uncollected order_prep row". Created OPEN (so the line
 *  insert satisfies `require_open_parent`), fired via the real resolver into a `ticket_items` row at the
 *  venue's default station, then transitioned open → placed (the Mode-T counter path: a placed delivery is
 *  in the kitchen awaiting collection). Returns its id so a test can COLLECT it via the legal placed →
 *  settled + `collected_at` transition (a settled → settled update is rejected by `enforce_transition`, so
 *  `collected_at` is set AS the order settles, mirroring the real collectOrder Task 6 wires). An instant
 *  handover with NO ticket item leaves no occupancy — the `EXISTS(ticket_items)` branch of
 *  `listTablesWithState`'s pending-deliveries count. */
async function seedFiredDelivery(
  cfg: TillConfig,
  cafeId: string,
  tableId: string,
): Promise<string> {
  const id = randomUUID();
  await asApp(cfg, async (tx) => {
    await createOpenOrder(tx, cfg, id, [{ productId: cafeId, quantity: "1" }], null, {
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

/** The dining table's current tab_id — owner read. */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

describe("openTab", () => {
  it("opens a tab, points the table's tab_id at it, with an initial round", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId, orderNumber } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
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
    const { cfg, cafeId, tableId } = await setupVenue();
    await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId }))).rejects.toMatchObject({
      code: "tab.already_open",
      params: { tableId },
    });
  });

  it("treats a STALE tab_id (pointing at a settled order) as free and overwrites it", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId: firstTab } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Settle the first tab (owner write — fixture setup). tab_id STILL points at it (no
    // settle-time write, design §2b), but it is now stale.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${firstTab}`,
    );
    // A fresh tab is fine — the stale pointer reads free and is overwritten to the new order.
    const { tabId: secondTab } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
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
    // Deactivate the real table (owner write, fixture setup), then a tab is refused.
    await db.execute(sql`update dining_tables set active = false where id = ${tableId}`);
    await expect(asApp(cfg, (tx) => openTab(tx, cfg, { tableId }))).rejects.toMatchObject({
      code: "table.inactive",
      params: { tableId },
    });
  });
});

/** Insert a bare OPEN working order that NO table points at (a walk-up) — for the "not a tab" case. */
async function bareOpenOrder(cfg: TillConfig, id: string): Promise<void> {
  await db.execute(sql`
    insert into working_orders (id, till_id, node_id, order_number, status)
    values (${id}, ${cfg.tillId}, ${cfg.nodeId}, 999, 'open')`);
}

describe("addTabRound (append-only, no re-price)", () => {
  it("appends a round with the NEXT line_no, without deleting or re-pricing existing lines", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Round 2 at the current 1.50.
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }]));
    // Change the catalogue price AFTER two rounds are locked.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update products set unit_price = 999 where id = ${cafeId}`),
    );
    // Round 3 prices at the NEW 9.99 — but rounds 1 & 2 are UNTOUCHED (the load-bearing behaviour; a
    // full-basket replace like updateHeldOrder would re-price ALL to 9.99).
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }]));

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo, gross: workingOrderLines.unitPriceGross })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    // Read straight off the column, which counts whole cents: 150 is the locked 1.50 and 999 the
    // new 9.99.
    expect(lines).toEqual([
      { lineNo: 1, gross: 150 },
      { lineNo: 2, gross: 150 },
      { lineNo: 3, gross: 999 },
    ]);
  });

  it("appends a round with extras as parent + child lines, firing ONLY the parent", async () => {
    // Extras on the tab round-send path: a round line carrying `extras` expands into a parent dish
    // line plus one child line per pick, and only the PARENT is fired to the kitchen (an extra is
    // part of its dish, not its own ticket item).
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    // The café offers the agua as a +0.50 extra. Two DIFFERENT products, so an assertion about which
    // one a row carries can fail.
    const extraListId = await asApp(cfg, (tx) => attachExtras(tx, cafeId, aguaId));

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          productId: cafeId,
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
    // The child IS the picked product, and it hangs off the dish line.
    expect(child!.productId).toBe(aguaId);
    expect(child!.parentLineId).toBe(parent!.id);

    // Exactly ONE ticket item — the parent dish; the child modifier was filtered out of the fire.
    const fired = await db
      .select({ workingOrderLineId: ticketItems.workingOrderLineId })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    expect(fired).toEqual([{ workingOrderLineId: parent!.id }]);
  });

  it("refuses a round on a settled tab, a walk-up (not a tab), and an absent id (tab.not_open)", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Settled tab → not open.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId } });

    // A bare open walk-up (no table points at it) is not a tab.
    const walkUp = randomUUID();
    await bareOpenOrder(cfg, walkUp);
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, walkUp, [{ productId: cafeId, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: walkUp } });

    // An absent id names nothing.
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, missing, [{ productId: cafeId, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
  });

  it("refuses an empty round (sale.empty_basket)", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, []))).rejects.toMatchObject({
      code: "sale.empty_basket",
    });
  });
});

describe("addTabRound per-line note (NON-FISCAL, spec §2/§3)", () => {
  it("persists a TRIMMED note on the working_order_lines row AND snapshots it onto ticket_items at fire", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1", note: "  sin sal  " }]),
    );

    // Draft line carries the validated (trimmed) note.
    const [line] = await db
      .select({ id: workingOrderLines.id, note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(line!.note).toBe("sin sal");

    // Fire SNAPSHOTTED it onto the ticket item (like station_id/course_id).
    const [item] = await db
      .select({ note: ticketItems.note })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, line!.id));
    expect(item!.note).toBe("sin sal");
  });

  it("stores NULL for an absent note and for a whitespace-only note", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { productId: cafeId, quantity: "1", note: "   " },
        { productId: cafeId, quantity: "1" },
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
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const note = "x".repeat(201);
    await expect(
      asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1", note }])),
    ).rejects.toMatchObject({
      code: "working_order.note_too_long",
      params: { length: 201, limit: 200 },
    });
  });

  it("rejects a non-string note with a clean 400 screen (management.request_invalid), not a 500", async () => {
    // A crafted body could send `note: 123` (the wire type `note?: string` is a JSON lie). It must be
    // type-screened to a structured 400 rather than reaching `.trim()` as a TypeError → an opaque 500.
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await expect(
      asApp(cfg, (tx) =>
        addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1", note: 123 as never }]),
      ),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "note" } });
  });
});

describe("voidTabLine", () => {
  it("deletes one line from an open tab and leaves the rest", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: aguaId, quantity: "1" }])); // line 2
    await asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1));

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toEqual([{ lineNo: 2 }]);
  });

  it("throws tab.line_not_found for a line_no that matches nothing", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 99))).rejects.toMatchObject({
      code: "tab.line_not_found",
      params: { tabId, lineNo: 99 },
    });
  });

  it("throws tab.not_open for a settled order", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    await expect(asApp(cfg, (tx) => voidTabLine(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });
});

describe("markLineServed / unmarkLineServed", () => {
  /** served_at per line_no — owner read. NULL until a runner marks the line served. */
  async function servedAtByLine(tabId: string): Promise<Map<number, string | null>> {
    const rows = await db
      .select({ lineNo: workingOrderLines.lineNo, servedAt: workingOrderLines.servedAt })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    return new Map(rows.map((r) => [r.lineNo, r.servedAt]));
  }

  it("marks one line served, unmarks it, and refuses an unknown line (tab.line_not_found)", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ],
      }),
    );

    // Mark line 1 served — only line 1 gets a timestamp; line 2 stays NULL.
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    let served = await servedAtByLine(tabId);
    expect(served.get(1)).not.toBeNull();
    expect(served.get(2)).toBeNull();

    // Unmark line 1 — cleared back to NULL.
    await asApp(cfg, (tx) => unmarkLineServed(tx, cfg, tabId, 1));
    served = await servedAtByLine(tabId);
    expect(served.get(1)).toBeNull();

    // An absent line_no on the tab → tab.line_not_found, for both verbs.
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
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Settled order → not open. lockOpenTab's STATUS check refuses it — but strip that check and the DB
    // `require_open_parent` trigger still rejects a served write on a non-open parent (a different wrong
    // shape, but a refusal). So this branch alone does NOT isolate the domain guard; the next test does.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    await expect(asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });

  it("refuses an open order no table points at, carrying a real line — lockOpenTab's back-pointer is the sole gate (tab.not_open)", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Orphan the tab: clear the dining_tables back-pointer while the order stays OPEN and keeps line 1.
    // No DB trigger fires (the parent is still open) and the UPDATE would match a real row, so
    // lockOpenTab's BACK-POINTER check is the ONLY thing that can refuse this — the isolating
    // deletion-proof for it. Strip that check and the served write silently succeeds (verified: the
    // guard-removed run resolves instead of rejecting). The zero-line walk-up used elsewhere cannot
    // isolate it — a guard-removed UPDATE there matches 0 rows and errors tab.line_not_found regardless.
    await db.execute(sql`update dining_tables set tab_id = null where id = ${tableId}`);
    await expect(asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });
});

describe("readTabLines", () => {
  it("reads an open tab's lines in line_no order with locked gross price, quantity and served state", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "2" },
        ],
      }),
    );
    // Serve line 1 — its served_at becomes a timestamp; line 2 stays NULL (the two floor states the
    // table-order screen renders "Servido" vs "Pendiente de servir").
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    expect(lines).toHaveLength(2);
    // Quantities and gross prices retain their database scales.
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
    // cafe → Entrantes (earliest course, auto-fires on send); agua → Postres (a later course, HELD until
    // fired). `addTabRound` fires the round via `fireLines`, which stamps `fired_at` on the earliest
    // course and leaves the later one null. `readTabLines` LEFT-joins the ticket item so the tab screen
    // can group its "Fire <course>" actions by held course.
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
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
        { productId: cafeId, quantity: "1" },
        { productId: aguaId, quantity: "1" },
      ]),
    );

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    const cafe = lines.find((l) => l.productId === cafeId)!;
    const agua = lines.find((l) => l.productId === aguaId)!;
    // cafe's Entrantes is the earliest course → auto-fired (fired_at set); agua's Postres is later → held.
    expect(cafe.courseId).toBe(entrantes.id);
    expect(cafe.firedAt).not.toBeNull();
    expect(agua.courseId).toBe(postres.id);
    expect(agua.firedAt).toBeNull();
    // Coursing corrections (C1): both lines already have a ticket item (fireLines inserts one per fired
    // OR held parent line), so both carry the fresh row's `state`, always "queued" at insert time
    // (working-order.ts ~1041) — HELD vs FIRED is `firedAt`, not `state`; `state` only advances once the
    // kitchen screen bumps it (preparing/ready), which this fixture never does.
    expect(cafe.state).toBe("queued");
    expect(agua.state).toBe("queued");
  });

  it("carries state: null for an extra's child line, which has no ticket item of its own", async () => {
    // A round line with `extras` expands into a parent dish line plus one child line per pick; only
    // the PARENT is fired to the kitchen (`fireLines` filters children out), so the child never gets
    // a `ticket_items` row at all — `readTabLines`'s LEFT JOIN then reports `state: null` for it,
    // distinct from a HELD parent (which has a row, state "queued", firedAt null).
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const extraListId = await asApp(cfg, (tx) => attachExtras(tx, cafeId, aguaId));

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          productId: cafeId,
          quantity: "1",
          extras: [{ listId: extraListId, picks: [{ productId: aguaId, quantity: 1 }] }],
        },
      ]),
    );

    const lines = await asApp(cfg, (tx) => readTabLines(tx, cfg, tabId));
    expect(lines).toHaveLength(2);
    const parent = lines.find((l) => l.productId === cafeId)!;
    // The child carries the PICKED product, so it is told apart from the dish by product id.
    const child = lines.find((l) => l.productId === aguaId)!;
    // Null course → auto-fires (§2b): the parent gets a fresh "queued" ticket item.
    expect(parent.firedAt).not.toBeNull();
    expect(parent.state).toBe("queued");
    // The extra's child line has no ticket item of its own — null firedAt AND null state.
    expect(child.firedAt).toBeNull();
    expect(child.state).toBeNull();
  });

  it("names a child extras line's parent by LINE NUMBER, and leaves the dish's own null", async () => {
    // The only marker on the tab wire that tells a child extras line from a dish. A child carries the
    // PICKED product (spec §3.4), so `productId` cannot do it, and the two products here are different
    // rows so a test reading the wrong one fails. The parent is named by its `lineNo`, the same shape
    // `TillSaleLine.parentLineNo` uses on the settled-sale wire (`apps/server/src/till-sale.ts`), so a
    // screen groups children under dishes without a second lookup.
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const extraListId = await asApp(cfg, (tx) => attachExtras(tx, cafeId, aguaId));

    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          productId: cafeId,
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
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Change the catalogue price AFTER the line locked its gross at 1.50 (a tab does NOT re-price —
    // addTabRound/openTab stamp unit_price_gross at add-time). A read that recomputed from the
    // catalogue would report 9.99 and misreport the locked tab; readTabLines must return the LOCK.
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
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Settled → not open (owner write, fixture setup).
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    await expect(asApp(cfg, (tx) => readTabLines(tx, cfg, tabId))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
    // An absent id names nothing.
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => readTabLines(tx, cfg, missing))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId: missing },
    });
  });
});

describe("listTablesWithState (occupancy)", () => {
  it("reflects free → open-tab → free as a tab opens and pays", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();

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
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "2" }] }),
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

    // Settle the tab (tab_id still points at it, now stale); the table frees.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    const freed = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(freed[0]).toMatchObject({ state: "free", hasOpenTab: false });
  });

  it("shows delivery-pending while a fired delivery is uncollected, and free once collected", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    // A settled counter delivery FIRED to the kitchen (a ticket item), not yet collected — the KDS-1
    // successor to the old uncollected order_prep row.
    const orderId = await seedFiredDelivery(cfg, cafeId, tableId);

    const pending = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(pending[0]).toMatchObject({
      state: "delivery-pending",
      hasOpenTab: false,
      pendingDeliveries: 1,
    });

    // Collected → the Mode-T collect transition placed → settled sets `working_orders.collected_at` (the
    // §3e successor to order_prep's `collected` state); no lingering occupancy.
    await asApp(cfg, (tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now(), collected_at = now() where id = ${orderId}`,
      ),
    );
    const cleared = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(cleared[0]).toMatchObject({ state: "free", pendingDeliveries: 0 });
  });

  it("reports pendingToServe (unserved tab lines), 0 for a free table, and carries zoneId", async () => {
    const { cfg, cafeMenuItemId, aguaMenuItemId, menuId, categoryId, tableId } = await setupVenue();
    const zone = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" }));
    await asApp(cfg, async (tx) => {
      const department = await tx.execute<{ id: string }>(sql`
        insert into departments
          (location_id, name, trading_name, default_service_mode)
        values (${cfg.locationId}, 'Restaurant', 'Restaurant', 'table_tab')
        returning id`);
      await tx.execute(sql`
        insert into zone_service_policies
          (location_id, zone_id, department_id, service_mode, default_menu_id)
        values (
          ${cfg.locationId}, ${zone.id}, ${department.rows[0]!.id},
          'table_tab', ${menuId}
        )`);
      await tx.execute(sql`
        insert into zone_menus (zone_id, menu_id)
        values (${zone.id}, ${menuId})`);
      await tx.execute(sql`
        insert into preparation_routes
          (location_id, category_id, station_id, no_preparation)
        values (${cfg.locationId}, ${categoryId}, null, true)`);
    });
    // A SECOND table with no tab — exercises the LEFT-join-reads-0 branch for a free table.
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

    // Two unserved lines → pendingToServe 2; zoneId carried through; the FREE table reads 0 (LEFT-join).
    let rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)).toMatchObject({
      zoneId: zone.id,
      pendingToServe: 2,
    });
    expect(rows.find((t) => t.id === freeTable.id)).toMatchObject({
      state: "free",
      pendingToServe: 0,
    });

    // Serve one → N-1.
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)!.pendingToServe).toBe(1);

    // Serve the rest → 0.
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 2));
    rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)!.pendingToServe).toBe(0);
  });

  it("open-tab dominates delivery-pending in the rolled-up state", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // A fired, uncollected counter delivery to the SAME table — pendingDeliveries counts it, but the open
    // tab dominates the rolled-up state.
    await seedFiredDelivery(cfg, cafeId, tableId);
    const rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows[0]).toMatchObject({ state: "open-tab", hasOpenTab: true, pendingDeliveries: 1 });
  });
});

// KDS-2 ring-time course resolution (design §2b). PGlite, not real Postgres: this is resolver/CRUD logic
// (a plain read-then-insert of a nullable column), no privilege or concurrency dimension — the lighter
// target per CLAUDE.md §4, as the surrounding tab suite already uses.
type RoundLine = { productId: string; quantity: string; courseId?: string | null };
/** A round line for `addTabRoundWith`; `courseId` OPTIONAL — absent = no override (fall to the product
 *  default), present (incl. `null`) = the line-level override the resolver honours. */
function line(productId: string, opts?: { courseId?: string | null }): RoundLine {
  return { productId, quantity: "1", ...opts };
}
/** Ring a round, then read each resulting line's resolved `course_id` back (the load-bearing assertion —
 *  a null-only check would prove nothing about the resolver). Runs inside the caller's tx, so it reads its
 *  own writes. */
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
    // The verbatim task-3 brief test: steak carries a product default (no override → default wins);
    // bread has no product default, so it resolves to null. NB under `override ?? product.course_id`
    // the `courseId: null` on bread is indistinguishable from no override — it is the absent default,
    // not the null override, that makes bread null here. Whether an explicit null should FORCE "no
    // course" over a product default is deferred to Task 7's picker; this test does not turn on it.
    const { cfg, cafeId: steak, aguaId: bread, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const c = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales", displayOrder: 1 }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, steak, c.id));
    const o = await asApp(cfg, (tx) =>
      addTabRoundWith(tx, cfg, tabId, [line(steak), line(bread, { courseId: null })]),
    );
    expect(lineCourse(o, steak)).toBe(c.id); // product default (no override)
    expect(lineCourse(o, bread)).toBeNull(); // no product default → null
  });

  it("a non-null line override WINS over the product's default course", async () => {
    const { cfg, cafeId: prod, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const def = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 }),
    );
    const override = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Postres", displayOrder: 2 }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, prod, def.id));
    const o = await asApp(cfg, (tx) =>
      addTabRoundWith(tx, cfg, tabId, [line(prod, { courseId: override.id })]),
    );
    expect(lineCourse(o, prod)).toBe(override.id);
  });

  it("resolves null when the line has no override AND the product no default course", async () => {
    const { cfg, cafeId: prod, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    const o = await asApp(cfg, (tx) => addTabRoundWith(tx, cfg, tabId, [line(prod)]));
    expect(lineCourse(o, prod)).toBeNull();
  });
});

it("returns a tab line's stored staff names and options answers", async () => {
  const { cfg, cafeId, tableId } = await setupVenue();
  await asApp(cfg, async (tx) => {
    const { tabId } = await openTab(tx, cfg, {
      tableId,
      lines: [{ productId: cafeId, quantity: "1" }],
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
    // The customer-facing map is planted alongside the staff names and must NOT come back: a tab's
    // line list is what a waiter reads, so it shows the staff pair.
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
      name: "Recorded coffee · Large",
      optionSnapshots,
    });
  });
});
