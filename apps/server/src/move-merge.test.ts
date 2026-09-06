import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  optionGroupItems,
  optionGroups,
  productOptionGroups,
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
  updateProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import {
  addTabRound,
  joinTable,
  mergeTabs,
  moveTab,
  moveTabLines,
  openTab,
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
}

/** A fresh tenant/location/till/node + a two-product catalogue (Café 1.50, Agua 2.00, both general). */
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
  const { cafeId, aguaId } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, tenantId, { name: "Carta" });
    const bebidas = await createCategory(tx, tenantId, { name: "Bebidas" });
    const cafe = await createProduct(tx, tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    return { cafeId: cafe.id, aguaId: agua.id };
  });
  return { cfg, cafeId, aguaId };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Create one active dining table as the app role; returns its id. */
async function seedTable(cfg: TillConfig, label: string): Promise<string> {
  return asApp(cfg, (tx) => createTable(tx, cfg, { label }).then((r) => r.id));
}

/** Open a tab on a table with the given lines; returns the tab (working_order) id. */
async function openTabOn(
  cfg: TillConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines }).then((r) => r.tabId));
}

/** The dining table's current tab_id — owner read. */
async function tabIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ tab_id: string | null }>(
    sql`select tab_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.tab_id;
}

/** The dining table's current status_id — owner read. Consumes TS-2's status_id column. */
async function statusIdOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

/** Seed one active table_service_statuses row (TS-2 schema) as the owner; returns its id. */
async function seedStatus(cfg: TillConfig, label: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into table_service_statuses (tenant_id, label, color)
    values (${cfg.tenantId}, ${label}, '#ff0000') returning id`);
  return rows[0]!.id;
}

/** A tab's lines as { lineNo, productId, unitPriceGross }, in line_no order — owner read. */
async function linesOf(
  tabId: string,
): Promise<{ lineNo: number; productId: string | null; gross: string }[]> {
  const rows = await db
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      gross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  return rows;
}

describe("moveTabLines", () => {
  it("moves ALL lines from one open tab to another, appended at the next line_no, source emptied", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "M1");
    const t2 = await seedTable(cfg, "M2");
    const from = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, [{ productId: aguaId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveTabLines(tx, from, to));

    // Destination now carries both lines; the café keeps its own locked gross; source is empty.
    const dest = await linesOf(to);
    expect(dest).toHaveLength(2);
    expect(dest.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(dest.find((l) => l.productId === cafeId)?.gross).toBe("1.50");
    expect(await linesOf(from)).toHaveLength(0);
  });

  it("moves only the NAMED subset (the TS-4 shape), leaving the rest on the source", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "S1");
    const t2 = await seedTable(cfg, "S2");
    const from = await openTabOn(cfg, t1, [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "1" },
    ]);
    const to = await openTabOn(cfg, t2, []);

    await asApp(cfg, (tx) => moveTabLines(tx, from, to, [2])); // move only line 2 (agua)

    expect(await linesOf(to)).toHaveLength(1);
    expect((await linesOf(to))[0]!.productId).toBe(aguaId);
    const remaining = await linesOf(from);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.productId).toBe(cafeId);
  });

  it("moving from an EMPTY tab is a no-op (the empty-source guard), no error", async () => {
    const { cfg, aguaId } = await setupVenue();
    const t1 = await seedTable(cfg, "E1");
    const t2 = await seedTable(cfg, "E2");
    const from = await openTabOn(cfg, t1, []); // empty tab
    const to = await openTabOn(cfg, t2, [{ productId: aguaId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveTabLines(tx, from, to));
    expect(await linesOf(to)).toHaveLength(1); // unchanged
  });

  it("refuses a non-open source or destination (tab.not_open)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "N1");
    const t2 = await seedTable(cfg, "N2");
    const from = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const to = await openTabOn(cfg, t2, []);
    // Abandon the destination (owner write, fixture setup).
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${to}`);
    await expect(asApp(cfg, (tx) => moveTabLines(tx, from, to))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId: to },
    });
  });

  it("refuses a self-transfer (fromTabId === toTabId) with tab.merge_self and leaves the lines intact", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const t = await seedTable(cfg, "ST");
    const tab = await openTabOn(cfg, t, [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "1" },
    ]);
    // The exported primitive TS-4 (transfer) calls directly; mergeTabs guards this at its own top, but
    // moveTabLines must self-guard. Without it, the "move all" shape (no lineNos) appends both lines as
    // duplicates then deletes BOTH copies (the trailing delete matches workingOrderId = fromTabId, now
    // also toTabId), wiping the tab.
    await expect(asApp(cfg, (tx) => moveTabLines(tx, tab, tab))).rejects.toMatchObject({
      code: "tab.merge_self",
      params: { tabId: tab },
    });
    // The guard fires BEFORE any read/write, so the tab still holds both original lines — the data-loss
    // footgun did not fire. Proven by deletion (guard removed → this drops to 0; see the finish-fix report).
    expect(await linesOf(tab)).toHaveLength(2);
  });
});

describe("moveTab", () => {
  it("relocates a tab to a free table: source freed + its status cleared, target points at the tab", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "Src");
    const dst = await seedTable(cfg, "Dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    // A manual "bill requested" status on the source (TS-2 schema) must NOT linger onto the next party.
    const status = await seedStatus(cfg, "Bill requested");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${src}`);

    await asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst));

    expect(await tabIdOf(src)).toBeNull();
    expect(await statusIdOf(src)).toBeNull(); // freed → status cleared (design §4)
    expect(await tabIdOf(dst)).toBe(tabId);
    // No line-move, no fiscal effect: the tab still carries its one line and stays open.
    expect(await linesOf(tabId)).toHaveLength(1);
  });

  it("clears a manual status on the TARGET table: the moved-in party turns it over", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "T-src");
    const dst = await seedTable(cfg, "T-dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    // A stale manual status left on the free DESTINATION (TS-2 schema) — from its previous party —
    // must NOT linger onto the moved-in party; the move turns the target over, exactly as openTab does.
    const status = await seedStatus(cfg, "Needs cleaning");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${dst}`);

    await asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst));

    expect(await tabIdOf(dst)).toBe(tabId);
    expect(await statusIdOf(dst)).toBeNull(); // target turned over → status cleared (design §4)
  });

  it("refuses a target that already has an OPEN tab (table.occupied)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "O-src");
    const dst = await seedTable(cfg, "O-dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    await openTabOn(cfg, dst, [{ productId: cafeId, quantity: "1" }]); // dst now occupied
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst))).rejects.toMatchObject({
      code: "table.occupied",
      params: { tableId: dst },
    });
  });

  it("treats a target with a STALE tab_id (settled order) as free and moves onto it", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "St-src");
    const dst = await seedTable(cfg, "St-dst");
    const oldTab = await openTabOn(cfg, dst, [{ productId: cafeId, quantity: "1" }]);
    // Settle dst's tab (owner write) — tab_id STILL points at it, but it is now stale/free (TS-1 §2b).
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${oldTab}`,
    );
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst));
    expect(await tabIdOf(dst)).toBe(tabId); // stale pointer overwritten
    expect(await tabIdOf(src)).toBeNull();
  });

  it("refuses an unknown/inactive target and a non-open tab", async () => {
    const { cfg, cafeId } = await setupVenue();
    const src = await seedTable(cfg, "G-src");
    const dst = await seedTable(cfg, "G-dst");
    const tabId = await openTabOn(cfg, src, [{ productId: cafeId, quantity: "1" }]);
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, missing))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
    await db.execute(sql`update dining_tables set active = false where id = ${dst}`);
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst))).rejects.toMatchObject({
      code: "table.inactive",
      params: { tableId: dst },
    });
    // A settled tab cannot be moved.
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    const dst2 = await seedTable(cfg, "G-dst2");
    await expect(asApp(cfg, (tx) => moveTab(tx, cfg, tabId, dst2))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });
});

describe("joinTable", () => {
  it("extends a tab's coverage to a free table: BOTH tables point at the one tab, no line-move", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "J1");
    const t2 = await seedTable(cfg, "J2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2));

    expect(await tabIdOf(t1)).toBe(tabId);
    expect(await tabIdOf(t2)).toBe(tabId); // both point at the one tab — a join
    expect(await linesOf(tabId)).toHaveLength(1); // the free table added no lines
  });

  it("refuses a target that already has an OPEN tab (table.occupied)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "JO1");
    const t2 = await seedTable(cfg, "JO2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    await openTabOn(cfg, t2, [{ productId: cafeId, quantity: "1" }]);
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2))).rejects.toMatchObject({
      code: "table.occupied",
      params: { tableId: t2 },
    });
  });

  it("treats a target with a STALE tab_id (settled order) as free and joins onto it", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "JS1");
    const t2 = await seedTable(cfg, "JS2");
    const oldTab = await openTabOn(cfg, t2, [{ productId: cafeId, quantity: "1" }]);
    // Settle t2's tab (owner write) — tab_id STILL points at it, but it is now stale/free (TS-1 §2b).
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${oldTab}`,
    );
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2));
    expect(await tabIdOf(t2)).toBe(tabId); // stale pointer overwritten by the join
    expect(await tabIdOf(t1)).toBe(tabId); // t1 still covered — a join adds, it does not free
  });

  it("refuses an unknown/inactive target and a non-open tab", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t1 = await seedTable(cfg, "JG1");
    const t2 = await seedTable(cfg, "JG2");
    const tabId = await openTabOn(cfg, t1, [{ productId: cafeId, quantity: "1" }]);
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, missing))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
    await db.execute(sql`update dining_tables set active = false where id = ${t2}`);
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t2))).rejects.toMatchObject({
      code: "table.inactive",
      params: { tableId: t2 },
    });
    await db.execute(
      sql`update working_orders set status = 'settled', settled_at = now() where id = ${tabId}`,
    );
    const t3 = await seedTable(cfg, "JG3");
    await expect(asApp(cfg, (tx) => joinTable(tx, cfg, tabId, t3))).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId },
    });
  });
});

describe("mergeTabs consolidate (freeSourceTable: true)", () => {
  it("combines fromTab's lines onto intoTab with LOCKED prices preserved, abandons+empties fromTab, frees the source", async () => {
    const { cfg, cafeId } = await setupVenue();
    const tInto = await seedTable(cfg, "C-into");
    const tFrom = await seedTable(cfg, "C-from");
    // intoTab: café at 1.50. Then raise the catalogue price and open fromTab: café at 9.99. A re-price
    // would make both 9.99; the move must keep each line's OWN locked gross (the load-bearing check).
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    await asApp(cfg, (tx) => updateProduct(tx, cafeId, { unitPrice: "9.99" }));
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: cafeId, quantity: "1" }]);
    // A manual status on the source (TS-2 schema) must clear when it is freed.
    const status = await seedStatus(cfg, "Needs cleaning");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${tFrom}`);

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true }));

    // intoTab holds both café lines, EACH at its own locked gross (1.50 and 9.99).
    const dest = await linesOf(intoTab);
    expect(dest.map((l) => l.gross).sort()).toEqual(["1.50", "9.99"]);
    // fromTab is abandoned and empty; the source table is freed and its status cleared.
    const [{ status: fromStatus }] = await db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, fromTab));
    expect(fromStatus).toBe("abandoned");
    expect(await linesOf(fromTab)).toHaveLength(0);
    expect(await tabIdOf(tFrom)).toBeNull();
    expect(await statusIdOf(tFrom)).toBeNull();
    expect(await tabIdOf(tInto)).toBe(intoTab); // intoTab's own table unchanged
  });

  it("preserves a moved modifier line's parent linkage on merge (child points at the moved parent, not NULL)", async () => {
    const { cfg, cafeId } = await setupVenue();
    // addTabRound fires the round (→ fireLines), which needs a default kitchen station to route to.
    await seedKitchenStation(db, { tenantId: cfg.tenantId, locationId: cfg.locationId });
    const tInto = await seedTable(cfg, "MOD-into");
    const tFrom = await seedTable(cfg, "MOD-from");

    // Attach an "Extras" group with a "Bacon" item to the café so the source tab can carry a parent
    // dish line + a child modifier line (parent_line_id set) — the same shape tabs.test.ts builds.
    const baconId = await asApp(cfg, async (tx) => {
      const [group] = await tx
        .insert(optionGroups)
        .values({
          tenantId: cfg.tenantId,
          name: { [LOCALE]: "Extras" },
          minSelect: 0,
          maxSelect: 2,
          required: false,
          sort: 0,
        })
        .returning({ id: optionGroups.id });
      const [bacon] = await tx
        .insert(optionGroupItems)
        .values({
          tenantId: cfg.tenantId,
          groupId: group!.id,
          name: { [LOCALE]: "Bacon" },
          priceDelta: "0.50",
          vatClass: "reduced",
          sort: 0,
        })
        .returning({ id: optionGroupItems.id });
      await tx.insert(productOptionGroups).values({
        tenantId: cfg.tenantId,
        productId: cafeId,
        groupId: group!.id,
        sort: 0,
      });
      return bacon!.id;
    });

    // intoTab: a plain café. fromTab: a café WITH the Bacon modifier (added via a round, the path that
    // takes `options`) → a parent dish line + a child modifier line pointing at it.
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, []);
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, fromTab, [
        { productId: cafeId, quantity: "1", options: [{ optionGroupItemId: baconId }] },
      ]),
    );

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true }));

    // The moved child modifier line must point at the MOVED parent's NEW id — not NULL. Without the
    // parent_line_id remap in moveTabLines the child lands orphaned (parent_line_id NULL) and renders
    // ungrouped.
    const dest = await db
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        parentLineId: workingOrderLines.parentLineId,
        optionGroupItemId: workingOrderLines.optionGroupItemId,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, intoTab))
      .orderBy(workingOrderLines.lineNo);
    const child = dest.find((l) => l.optionGroupItemId === baconId);
    expect(child).toBeDefined();
    expect(child!.parentLineId).not.toBeNull();
    // Its parent is another MOVED line on the destination: a top-level café dish (product set,
    // parent_line_id null).
    const parent = dest.find((l) => l.id === child!.parentLineId);
    expect(parent).toBeDefined();
    expect(parent!.productId).toBe(cafeId);
    expect(parent!.parentLineId).toBeNull();
    expect(parent!.optionGroupItemId).toBeNull();
  });

  it("the join branch (freeSourceTable: false) re-points the source table at intoTab (covered for branch)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const tInto = await seedTable(cfg, "CB-into");
    const tFrom = await seedTable(cfg, "CB-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: cafeId, quantity: "1" }]);

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: false }));

    expect(await tabIdOf(tFrom)).toBe(intoTab); // source table now covered by intoTab (a join)
    expect(await tabIdOf(tInto)).toBe(intoTab);
  });
});

describe("mergeTabs join (freeSourceTable: false)", () => {
  it("keeps BOTH tables pointing at intoTab and PRESERVES a manual status on the joined table", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const tInto = await seedTable(cfg, "JN-into");
    const tFrom = await seedTable(cfg, "JN-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: aguaId, quantity: "1" }]);
    // A status on the source table (TS-2 schema): a JOINED table keeps its status (design §4).
    const status = await seedStatus(cfg, "VIP");
    await db.execute(sql`update dining_tables set status_id = ${status} where id = ${tFrom}`);

    await asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: false }));

    expect(await tabIdOf(tInto)).toBe(intoTab);
    expect(await tabIdOf(tFrom)).toBe(intoTab); // both covered by the one bill
    expect(await statusIdOf(tFrom)).toBe(status); // joined table KEEPS its status
    expect(await linesOf(intoTab)).toHaveLength(2); // café + agua combined onto intoTab
  });
});

describe("mergeTabs guards", () => {
  it("refuses merging a tab into itself (tab.merge_self)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const t = await seedTable(cfg, "MS");
    const tab = await openTabOn(cfg, t, [{ productId: cafeId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => mergeTabs(tx, cfg, tab, tab, { freeSourceTable: true })),
    ).rejects.toMatchObject({ code: "tab.merge_self", params: { tabId: tab } });
  });

  it("refuses when either tab is not open (tab.not_open)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const tInto = await seedTable(cfg, "NO-into");
    const tFrom = await seedTable(cfg, "NO-from");
    const intoTab = await openTabOn(cfg, tInto, [{ productId: cafeId, quantity: "1" }]);
    const fromTab = await openTabOn(cfg, tFrom, [{ productId: cafeId, quantity: "1" }]);
    // Abandon fromTab (owner write) → merge is refused, naming fromTab.
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${fromTab}`);
    await expect(
      asApp(cfg, (tx) => mergeTabs(tx, cfg, intoTab, fromTab, { freeSourceTable: true })),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: fromTab } });
  });
});
