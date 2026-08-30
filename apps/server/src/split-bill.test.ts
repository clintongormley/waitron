import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  diningTables,
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
import { createTable, setTableStatus } from "./tables.js";
import { joinTable, openTab, splitOffCheck, unjoinTable } from "./working-order.js";
import "./errors.js";

// PGlite is enough HERE: the check being table-less and the line partition are plain row state a single
// backend proves. The FISCAL filing (exactly-one-registro per check, desglose, contiguity, RLS) is the
// real-Postgres job of the split-bill fiscal suite (Tasks 2–4, CLAUDE.md §4).
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  /** "Agua" — each, 1.50 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  tableId: string;
  /** A second table — unused by Task 1's asserts, seeded so the fixture is stable for later tasks. */
  tableId2: string;
  /** An ACTIVE `table_service_statuses` row, so a test can give a table a non-null manual status. */
  activeStatusId: string;
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
  const seeded = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Jamón" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const t1 = await createTable(tx, cfg, { label: "T1" });
    const t2 = await createTable(tx, cfg, { label: "T2" });
    const status = await tx.execute<{ id: string }>(
      sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, 'Bill requested', '#ef4444') returning id`,
    );
    return {
      aguaId: agua.id,
      jamonId: jamon.id,
      tableId: t1.id,
      tableId2: t2.id,
      activeStatusId: status.rows[0]!.id,
    };
  });
  return { cfg, ...seeded };
}

/** Run `fn` on a fresh app-scoped transaction (RLS in force, `app_user` role), like production. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

describe("splitOffCheck", () => {
  it("spins selected items into a NEW open check that no table points at (detached)", async () => {
    const { cfg, aguaId, jamonId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: aguaId, quantity: "3" },
          { productId: jamonId, quantity: "0.300" },
        ],
      }),
    );

    // Move 1 of the 3 aguas (partial split of line 1) + the whole jamón (line 2) onto a check.
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [check] = await tx
        .select({
          status: workingOrders.status,
          nodeId: workingOrders.nodeId,
          tillId: workingOrders.tillId,
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
      const anchoring = await tx
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(eq(diningTables.tabId, checkId));
      return { check, checkLines, originLines, anchoring };
    });

    expect(state.check?.status).toBe("open");
    // Inherits the origin's node/till (createOpenOrder stamps them from cfg).
    expect(state.check?.nodeId).toBe(cfg.nodeId);
    expect(state.check?.tillId).toBe(cfg.tillId);
    // A check is a payment unit, NOT a seat: no dining_tables row points at it (design §2).
    expect(state.anchoring).toEqual([]);
    // The check holds the moved items. Order follows the landed move/split core (TS-4): WHOLE lines are
    // moved first (moveTabLines appends the whole jamón at check line 1), THEN partial splits (the 1 agua
    // appended at check line 2) — not the transfers-array order.
    expect(state.checkLines).toEqual([
      { productId: jamonId, quantity: "0.300" },
      { productId: aguaId, quantity: "1.000" },
    ]);
    // …and the origin holds only the remainder (quantity conserved: 3 − 1 = 2 aguas; jamón moved whole).
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: "2.000" }]);
  });

  it("refuses to split off a check from a non-open tab (tab.not_open)", async () => {
    const { cfg } = await setupVenue();
    const MISSING = "00000000-0000-0000-0000-000000000000";
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, MISSING, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open" });
  });

  it("rejects a batch repeating a lineNo (tab.transfer_duplicate_line), minting nothing and conserving quantity", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "3" }] }),
    );
    // Two partial "1"s off the SAME line 1: without the guard each validates against the static 3 and the
    // source is set to 3−1 twice (non-cumulative), so the check would gain 1.000+1.000 and the origin drop
    // to 2.000 — 4 aguas from an original 3. Refused UP FRONT, before the check is minted.
    await expect(
      asApp(cfg, (tx) =>
        splitOffCheck(tx, cfg, tabId, [
          { lineNo: 1, quantity: "1" },
          { lineNo: 1, quantity: "1" },
        ]),
      ),
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
    // Origin untouched — still the whole agua×3, quantity conserved (NOT split down to 2.000).
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: "3.000" }]);
    // No stray check minted — only the origin tab exists.
    expect(state.orderCount).toBe(1);
  });

  it("inherits TS-4's move guards (tab.transfer_quantity_invalid, tab.line_not_found)", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "5" }])),
    ).rejects.toMatchObject({ code: "tab.transfer_quantity_invalid" });
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 99 }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found" });
  });

  it("refuses an EMPTY transfers array (sale.empty_basket), minting nothing", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "3" }] }),
    );
    // An empty `transfers` array makes carveOffLines' `inArray(col, [])` render `false` — a no-op WHERE
    // clause — so without an up-front guard the call would SUCCEED after createOpenOrder had already
    // minted a check: a table-less `open` working order, zero lines, a consumed order_number. An orphan.
    // Refused before anything is minted, same "nothing to work with" shape as the walk-up/park/round
    // paths' `sale.empty_basket` (see working-order.ts:221-227).
    await expect(asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, []))).rejects.toMatchObject({
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
    // Origin untouched — still the whole agua×3.
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: "3.000" }]);
    // No orphan check minted — only the origin tab exists.
    expect(state.orderCount).toBe(1);
  });
});

describe("unjoinTable", () => {
  it("with items: anchors a NEW open tab to the detached table and moves the items onto it", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2)); // both tables now point at tabId

    const { tabId: newTabId } = await asApp(cfg, (tx) =>
      unjoinTable(tx, cfg, tabId, tableId2, [{ lineNo: 1, quantity: "1" }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [detached] = await tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId2));
      const [stillJoined] = await tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId));
      const [newTab] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, newTabId!));
      const newTabLines = await tx
        .select({ productId: workingOrderLines.productId, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, newTabId!));
      return { detached, stillJoined, newTab, newTabLines };
    });

    expect(newTabId).toBeDefined();
    expect(state.detached?.tabId).toBe(newTabId); // the table now runs its OWN bill (re-anchored)
    expect(state.stillJoined?.tabId).toBe(tabId); // the origin table is unaffected
    expect(state.newTab?.status).toBe("open");
    expect(state.newTabLines).toEqual([{ productId: aguaId, quantity: "1.000" }]);
  });

  it("without items: frees the table (tab_id → NULL) and clears its TS-2 status", async () => {
    const { cfg, aguaId, tableId, tableId2, activeStatusId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2));
    // Give the joined table a NON-NULL manual status FIRST, so the post-unjoin null assertion below can
    // tell "unjoinTable cleared it" apart from "it was never set". joinTable sets only tab_id and never a
    // status, so without this the clear would be untested (a §4 pass-for-the-wrong-reason).
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId2, activeStatusId));
    const [before] = await asApp(cfg, (tx) =>
      tx
        .select({ statusId: diningTables.statusId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId2)),
    );
    expect(before?.statusId).toBe(activeStatusId); // pre-condition: the status IS set going in.

    const result = await asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2));

    const [row] = await asApp(cfg, (tx) =>
      tx
        .select({ tabId: diningTables.tabId, statusId: diningTables.statusId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId2)),
    );
    expect(result).toEqual({});
    expect(row?.tabId).toBeNull();
    expect(row?.statusId).toBeNull(); // turnover: the manual TS-2 status clears (design §3, TS-3 pattern)
  });

  it("refuses to un-join a table that isn't part of the tab (table.not_joined)", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    // tableId2 is FREE (never joined) → not part of tabId.
    await expect(asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2))).rejects.toMatchObject({
      code: "table.not_joined",
    });
  });

  it("refuses to un-join from a tab whose shared order is no longer open (tab.not_open)", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2));
    // Abandon the shared order WITHOUT clearing the tables' tab_id — a STALE pointer, exactly the state
    // openTab documents (a settled/abandoned tab leaves its tables pointing at it). tableId2.tab_id still
    // equals tabId, so it passes the table.not_joined guard and reaches the shared-tab open check.
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${tabId}`);
    await expect(asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2))).rejects.toMatchObject({
      code: "tab.not_open",
    });
  });
});
