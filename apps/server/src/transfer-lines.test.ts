import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant, workingOrderLines } from "@waitron/db";
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
import { moveTabLines, openTab, parkOrder, transferLines } from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the WRITE behaviour of `transferLines` and
// `moveTabLines` — the split arithmetic, the guards, the line renumbering, the price-lock — all plain
// SQL a single backend proves. The concurrency race and the RLS cross-tenant isolation (which PGlite's
// superuser single-backend connection CANNOT show) are `transfer-lines.rls.test.ts`'s real-Postgres job.
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  /** "Café" — each, 1.50 gross, general(21%). */
  cafeId: string;
  /** "Agua" — each, 2.00 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  tableAId: string;
  tableBId: string;
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
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Jamón" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const a = await createTable(tx, cfg, { label: "A" });
    const b = await createTable(tx, cfg, { label: "B" });
    return { cafeId: cafe.id, aguaId: agua.id, jamonId: jamon.id, tableAId: a.id, tableBId: b.id };
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

/** The lines on a tab, owner-read (bypasses RLS), by `line_no`. */
async function linesOf(tabId: string): Promise<
  {
    lineNo: number;
    productId: string;
    quantity: string;
    unitPriceGross: string;
    lineTotal: string;
  }[]
> {
  return db
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

/** Open a tab on `tableId` with an initial round, returning its tab id. */
async function openTabWith(
  cfg: TillConfig,
  tableId: string,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines }));
  return tabId;
}

describe("moveTabLines — subset", () => {
  it("moves ONLY the named lines, leaves the rest on the source, renumbers on the destination", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    // Tab A: line 1 = café×2, line 2 = agua×1. Tab B: line 1 = agua×3 (so the moved line lands at 2).
    const tabA = await openTabWith(cfg, tableAId, [
      { productId: cafeId, quantity: "2" },
      { productId: aguaId, quantity: "1" },
    ]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "3" }]);

    // Move ONLY line 1 (café) from A to B.
    await asApp(cfg, (tx) => moveTabLines(tx, tabA, tabB, [1]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // A keeps only the agua line (its line_no is unchanged — a subset move renumbers the DESTINATION only).
    expect(a.map((l) => l.productId)).toEqual([aguaId]);
    // B gained the café line at the next line_no (2), locked price kept.
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId]);
    expect(b[1]).toMatchObject({
      lineNo: 2,
      quantity: "2.000",
      unitPriceGross: "1.50",
      lineTotal: "3.00",
    });
  });
});

describe("transferLines — whole line", () => {
  it("moves an entire line to the other tab, keeping its locked unit_price_gross, source line gone", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Whole line = `quantity` omitted.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1 }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([]); // the café line left A entirely
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId]);
    // Locked price preserved (café 1.50 gross → 2×1.50 = 3.00), NOT re-priced.
    expect(b[1]).toMatchObject({ lineNo: 2, quantity: "2.000", unitPriceGross: "1.50", lineTotal: "3.00" });
  });

  it("refuses transferring a tab to ITSELF (tab.transfer_self), changing nothing", async () => {
    const { cfg, cafeId, tableAId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabA, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.transfer_self", params: { tabId: tabA } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  it("refuses when the destination is not an open tab (tab.not_open)", async () => {
    const { cfg, cafeId, tableAId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const notATab = randomUUID(); // no working_orders row, no dining_tables back-pointer
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, notATab, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: notATab } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  // Isolates transferLines' OWN lock-loop guard from moveTabLines' backstop. The absent-destination
  // test above passes even with the lock loop deleted, because moveTabLines' own status read throws
  // tab.not_open for a missing working_orders row too. A PARKED walk-up is the discriminating case: it
  // IS an open working order (moveTabLines would happily move lines INTO it), but NO dining_tables row
  // points at it, so it is not a TAB — only lockOpenTab's back-pointer check rejects it. Delete the lock
  // loop and THIS test fails (the café line lands in the parked order); keep it and the transfer is
  // refused tab.not_open. Design §3: a transfer moves items between two TABS, never into a walk-up.
  it("refuses transferring INTO an open order no table points at — a parked walk-up (tab.not_open)", async () => {
    const { cfg, cafeId, aguaId, tableAId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const parkedId = randomUUID();
    await parkOrder({ db }, cfg, { id: parkedId, lines: [{ productId: aguaId, quantity: "1" }] });
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, parkedId, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: parkedId } });
    expect(await linesOf(tabA)).toHaveLength(1); // café line untouched on A
    expect(await linesOf(parkedId)).toHaveLength(1); // parked order still holds only its agua line
  });
});
