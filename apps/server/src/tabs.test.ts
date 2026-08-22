import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  withTenant,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
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
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  cafeId: string;
  aguaId: string;
  tableId: string;
}

async function setupVenue(): Promise<Seeded> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  // KDS-1: a default kitchen station so addTabRound's fire (→ fireLines) has a fallback. Seeded as the
  // superuser here, as the surrounding venue rows are (RLS bypassed in this pure setup).
  await seedKitchenStation(db, { tenantId, locationId });
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const cfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const { cafeId, aguaId, tableId } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const table = await createTable(tx, cfg, { label: "T1" });
    return { cafeId: cafe.id, aguaId: agua.id, tableId: table.id };
  });
  return { cfg, cafeId, aguaId, tableId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
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
      .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await fireLines(tx, cfg, id, lines);
    await tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`);
  });
  return id;
}

/** The dining table's current tab_id — owner read (bypasses RLS). */
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
    // Settle the first tab (owner write — RLS bypassed, pure setup). tab_id STILL points at it (no
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
    // Deactivate the real table (owner write, RLS bypassed — pure setup), then a tab is refused.
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
    insert into working_orders (id, tenant_id, till_id, node_id, order_number, status)
    values (${id}, ${cfg.tenantId}, ${cfg.tillId}, ${cfg.nodeId}, 999, 'open')`);
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
      tx.execute(sql`update products set unit_price = '9.99' where id = ${cafeId}`),
    );
    // Round 3 prices at the NEW 9.99 — but rounds 1 & 2 are UNTOUCHED (the load-bearing behaviour; a
    // full-basket replace like updateHeldOrder would re-price ALL to 9.99).
    await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ productId: cafeId, quantity: "1" }]));

    const lines = await db
      .select({ lineNo: workingOrderLines.lineNo, gross: workingOrderLines.unitPriceGross })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toEqual([
      { lineNo: 1, gross: "1.50" },
      { lineNo: 2, gross: "1.50" },
      { lineNo: 3, gross: "9.99" },
    ]);
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
  /** served_at per line_no — owner read (RLS bypassed). NULL until a runner marks the line served. */
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
    // numeric(_,3) quantity, numeric(_,2) gross unit, product id (no name — the screen resolves it).
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

  it("returns the STORED locked gross price, never a re-price after the catalogue changes", async () => {
    const { cfg, cafeId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: cafeId, quantity: "1" }] }),
    );
    // Change the catalogue price AFTER the line locked its gross at 1.50 (a tab does NOT re-price —
    // addTabRound/openTab stamp unit_price_gross at add-time). A read that recomputed from the
    // catalogue would report 9.99 and misreport the locked tab; readTabLines must return the LOCK.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update products set unit_price = '9.99' where id = ${cafeId}`),
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
    // Settled → not open (owner write, RLS bypassed — pure setup).
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
    const { cfg, cafeId, aguaId, tableId } = await setupVenue();
    const zone = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" }));
    // A SECOND table with no tab — exercises the LEFT-join-reads-0 branch for a free table.
    const freeTable = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "T2" }));
    await asApp(cfg, (tx) => updateTable(tx, cfg, tableId, { zoneId: zone.id }));

    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
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
