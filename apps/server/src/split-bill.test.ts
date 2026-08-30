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
import { createTable } from "./tables.js";
import { openTab, splitOffCheck } from "./working-order.js";
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
    return { aguaId: agua.id, jamonId: jamon.id, tableId: t1.id, tableId2: t2.id };
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
});
