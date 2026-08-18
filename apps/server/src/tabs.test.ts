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
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
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
import { createTable } from "./tables.js";
import { addTabRound, openTab } from "./working-order.js";
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
