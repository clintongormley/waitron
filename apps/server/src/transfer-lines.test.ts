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
import {
  createOpenOrder,
  moveTabLines,
  openTab,
  parkOrder,
  transferLines,
} from "./working-order.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the WRITE behaviour of `transferLines` and
// `moveTabLines` — the split arithmetic, the guards, the line renumbering, the price-lock — all plain
// SQL a single backend proves. The concurrency race and the per-tab fiscal filing as the app role
// (which PGlite's superuser single-backend connection CANNOT show) are `transfer-lines.pg.test.ts`'s job.
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
    const jamon = await createProduct(tx, tenantId, {
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

/** Run `fn` on a fresh app-scoped transaction (`app_user` role), like production. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** The lines on a tab, owner-read, by `line_no`. */
async function linesOf(tabId: string): Promise<
  {
    lineNo: number;
    productId: string | null;
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
    expect(b[1]).toMatchObject({
      lineNo: 2,
      quantity: "2.000",
      unitPriceGross: "1.50",
      lineTotal: "3.00",
    });
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

describe("transferLines — partial split", () => {
  it("splits a line: source quantity drops, a destination line appears at the SAME locked gross, quantity conserved", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    // Tab A: café×3 (line 1). Tab B: agua×1 (line 1) → the split lands at B line 2.
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Move 1 of the 3 coffees.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Source: café line still present, quantity 3 → 2, line_total recomputed round(2×1.50)=3.00.
    expect(a).toEqual([
      expect.objectContaining({
        lineNo: 1,
        productId: cafeId,
        quantity: "2.000",
        unitPriceGross: "1.50",
        lineTotal: "3.00",
      }),
    ]);
    // Destination: NEW café line at B line 2, SAME locked gross 1.50, quantity 1, round(1×1.50)=1.50.
    expect(b).toEqual([
      expect.objectContaining({ lineNo: 1, productId: aguaId }),
      expect.objectContaining({
        lineNo: 2,
        productId: cafeId,
        quantity: "1.000",
        unitPriceGross: "1.50",
        lineTotal: "1.50",
      }),
    ]);
    // Quantity conserved: 2 + 1 = the original 3. Money conserved for `each`: 3.00 + 1.50 = 4.50.
  });

  it("PRICE LOCK: a catalogue price change between ring and transfer re-prices NEITHER line", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Change the catalogue's café price AFTER the ring, BEFORE the transfer (owner write).
    // If `transferLines` re-consulted the catalogue, the moved/kept line would jump to 9.99.
    await db.execute(sql`update products set unit_price = '9.99' where id = ${cafeId}`);

    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Both keep the ORIGINAL locked 1.50 — never 9.99. line_totals derived from 1.50, not the catalogue.
    expect(a[0]).toMatchObject({ unitPriceGross: "1.50", quantity: "2.000", lineTotal: "3.00" });
    expect(b[1]).toMatchObject({ unitPriceGross: "1.50", quantity: "1.000", lineTotal: "1.50" });
  });

  it("splits a WEIGHED (decimal-quantity) line the same way, conserving the weight", async () => {
    const { cfg, jamonId, aguaId, tableAId, tableBId } = await setupVenue();
    // Jamón 24.90/kg, 0.320 kg on tab A. Locked gross unit = 24.90; line_total round(0.320×24.90)=7.97.
    const tabA = await openTabWith(cfg, tableAId, [{ productId: jamonId, quantity: "0.320" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Move 0.120 kg of the jamón.
    await asApp(cfg, (tx) =>
      transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.120" }]),
    );

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Source: 0.320 − 0.120 = 0.200 kg, line_total round(0.200×24.90)=4.98.
    expect(a[0]).toMatchObject({
      productId: jamonId,
      quantity: "0.200",
      unitPriceGross: "24.90",
      lineTotal: "4.98",
    });
    // Destination: 0.120 kg at the SAME 24.90/kg, line_total round(0.120×24.90)=2.99.
    expect(b[1]).toMatchObject({
      productId: jamonId,
      quantity: "0.120",
      unitPriceGross: "24.90",
      lineTotal: "2.99",
    });
    // Weight conserved: 0.200 + 0.120 = 0.320. (Money 4.98+2.99=7.97 == original — exact here; a
    // sub-céntimo split difference would be harmless pre-fiscal, design §3.)
  });
});

describe("transferLines — full-quantity partial is a whole-line move", () => {
  it("moving quantity EQUAL to the line's quantity leaves no zero remnant on the source", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Explicit quantity "2" == the whole line — must behave exactly like an omitted quantity.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "2" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([]); // NO zero-quantity remnant left behind
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId]);
    expect(b[1]).toMatchObject({
      lineNo: 2,
      quantity: "2.000",
      unitPriceGross: "1.50",
      lineTotal: "3.00",
    });
  });
});

describe("transferLines — guards", () => {
  it("throws tab.line_not_found for a line_no not on the source tab, changing nothing", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 99, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // The presence check as the SOLE gate: every other tab.line_not_found test in this file pairs the
  // unknown lineNo with a `quantity`, so the quantity guard ALSO fires if the presence check is
  // deleted (`decimal(line.quantity)` on `undefined` throws, caught, reported as
  // tab.transfer_quantity_invalid — a wrong shape, not silence). A WHOLE-line transfer (`quantity`
  // omitted) takes a different path: it never reaches `decimal()` at all, so `t.lineNo` is pushed
  // straight onto `wholeLineNos` with no check on `line`. Without the presence check, `moveTabLines`
  // then runs with `lineNos: [99]`, matches ZERO rows on `fromTab`, inserts nothing (guarded on
  // `source.length > 0`) and deletes nothing — the whole call RESOLVES, moving nothing, silently.
  // This is the ONLY case in the suite where deleting the presence check produces a silent no-op
  // rather than a differently-shaped throw (see the deletion-proof in the task report).
  it("throws tab.line_not_found for a WHOLE-line transfer (quantity omitted) naming an unknown line_no", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 99 }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  it("throws tab.transfer_quantity_invalid for zero, negative, over-quantity, or malformed", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    for (const bad of ["0", "-1", "4", "0.000", "abc"]) {
      await expect(
        asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: bad }])),
      ).rejects.toMatchObject({
        code: "tab.transfer_quantity_invalid",
        params: { tabId: tabA, lineNo: 1, quantity: bad },
      });
    }
    // Nothing moved on any of the rejections.
    expect((await linesOf(tabA))[0]).toMatchObject({ quantity: "3.000" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // Over-quantity at DECIMAL scale, not just whole numbers: pins `compareDecimal`'s value-wise
  // comparison against the recurring string-vs-decimal defect class this codebase guards against
  // elsewhere (a naive string/lexical compare of "0.600" vs "0.500" would still happen to order
  // correctly here, but this fixture exists so a future rewrite that compares scale-mismatched
  // strings, e.g. "0.60" vs "0.500", is caught).
  it("throws tab.transfer_quantity_invalid for a decimal-scale over-quantity on a WEIGHED line", async () => {
    const { cfg, jamonId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: jamonId, quantity: "0.500" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.600" }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_quantity_invalid",
      params: { tabId: tabA, lineNo: 1, quantity: "0.600" },
    });
    expect((await linesOf(tabA))[0]).toMatchObject({ productId: jamonId, quantity: "0.500" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // Validate-before-mutate: the guard loop only classifies transfers into wholeLineNos/partials — it
  // performs no write — so a bad entry ANYWHERE in the batch throws before the whole-line move or the
  // split loop (both AFTER the guard loop) ever runs. Puts the valid entry FIRST, so this also proves
  // that queuing it (pushing onto `partials`) is not itself a write: were the loop instead validating
  // and writing entry-by-entry, this transfer's split would already have landed by the time the second
  // entry's tab.line_not_found fires.
  it("validates every transfer before moving/splitting any of them — a bad entry leaves BOTH tabs unchanged", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [
      { productId: cafeId, quantity: "3" },
      { productId: aguaId, quantity: "2" },
    ]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) =>
        transferLines(tx, cfg, tabA, tabB, [
          { lineNo: 1, quantity: "1" }, // valid partial split
          { lineNo: 99, quantity: "1" }, // unknown line_no
        ]),
      ),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    const a = await linesOf(tabA);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ quantity: "3.000" }); // NOT split down to 2.000
    expect(a[1]).toMatchObject({ quantity: "2.000" });
    expect(await linesOf(tabB)).toHaveLength(1); // no new line appended
  });
});

describe("transferLines — duplicate line_no in the batch", () => {
  // A batch naming the SAME source line_no twice does NOT conserve quantity, because every entry is
  // validated against the STATIC pre-batch snapshot of `line.quantity` (never updated between entries)
  // and the split write sets the source to `original − q` (a plain set, NOT a cumulative decrement).
  // Two partial "1"s off a café×3 line both pass (each ≤ the stale 3), the source ends at 3−1=2, and
  // TWO 1-unit destination lines are inserted → 4 cafés from an original 3. Rejected UP FRONT, before
  // any lock or write, so both tabs are untouched. Reported with the first line_no that repeats. The
  // deletion-proof (remove the guard, rerun, watch this RED with dest gaining 1.000+1.000) is in the
  // fix report.
  it("rejects a partial+partial batch repeating a line_no (tab.transfer_duplicate_line), conserving quantity", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) =>
        transferLines(tx, cfg, tabA, tabB, [
          { lineNo: 1, quantity: "1" },
          { lineNo: 1, quantity: "1" },
        ]),
      ),
    ).rejects.toMatchObject({
      code: "tab.transfer_duplicate_line",
      params: { tabId: tabA, lineNo: 1 },
    });
    // Both tabs UNCHANGED — the café×3 stayed whole on the source and the destination kept only its
    // original agua line (no fabricated 1.000+1.000 café).
    expect(await linesOf(tabA)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: cafeId, quantity: "3.000" }),
    ]);
    expect(await linesOf(tabB)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: aguaId }),
    ]);
  });

  // The whole-line + partial pair on one line is CONTRADICTORY ("move the whole line" AND "move part
  // of it"), which a cumulative-decrement fold cannot express — moveTabLines DELETEs source line 1
  // (moving it whole), then the split's `UPDATE ... WHERE line_no=1` matches ZERO rows while its
  // INSERT still fires → a fabricated destination line. The up-front duplicate guard refuses the batch
  // before EITHER path runs, which is why the guard rejects a repeated line_no uniformly rather than
  // trying to reconcile the two shapes.
  it("rejects a whole-line+partial batch repeating a line_no (tab.transfer_duplicate_line), conserving quantity", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ productId: cafeId, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) =>
        transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1 }, { lineNo: 1, quantity: "1" }]),
      ),
    ).rejects.toMatchObject({
      code: "tab.transfer_duplicate_line",
      params: { tabId: tabA, lineNo: 1 },
    });
    expect(await linesOf(tabA)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: cafeId, quantity: "3.000" }),
    ]);
    expect(await linesOf(tabB)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: aguaId }),
    ]);
  });
});

describe("transferLines — ordering modifiers (FIX 2 cascade / FIX 4 split)", () => {
  /** Attach a single-item option group to `productId`, returning the item id. */
  async function addOption(
    tx: Transaction,
    tenantId: TillConfig["tenantId"],
    productId: string,
    name: string,
  ): Promise<string> {
    const [group] = await tx
      .insert(optionGroups)
      .values({
        tenantId,
        name: { [LOCALE]: `${name} group` },
        minSelect: 0,
        maxSelect: 1,
        required: false,
        sort: 0,
      })
      .returning({ id: optionGroups.id });
    const [item] = await tx
      .insert(optionGroupItems)
      .values({
        tenantId,
        groupId: group!.id,
        name: { [LOCALE]: name },
        priceDelta: "0.50",
        vatClass: "reduced",
        sort: 0,
      })
      .returning({ id: optionGroupItems.id });
    await tx.insert(productOptionGroups).values({
      tenantId,
      productId,
      groupId: group!.id,
      sort: 0,
    });
    return item!.id;
  }

  /** Open an OPEN order with modifier lines and point `tableId` at it → a real tab (`lockOpenTab` needs
   *  the back-pointer). `openTab` does not thread `options`, so build the tab directly here. No fire. */
  async function openModifierTab(
    cfg: TillConfig,
    tableId: string,
    lines: { productId: string; quantity: string; options?: { optionGroupItemId: string }[] }[],
  ): Promise<string> {
    return asApp(cfg, async (tx) => {
      const id = randomUUID();
      await createOpenOrder(tx, cfg, id, lines, null);
      await tx.execute(sql`update dining_tables set tab_id = ${id} where id = ${tableId}`);
      return id;
    });
  }

  /** Lines of a tab with the modifier-linkage columns, owner-read, by `line_no`. */
  async function modLinesOf(tabId: string): Promise<
    {
      id: string;
      lineNo: number;
      productId: string | null;
      parentLineId: string | null;
      optionGroupItemId: string | null;
    }[]
  > {
    return db
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        productId: workingOrderLines.productId,
        parentLineId: workingOrderLines.parentLineId,
        optionGroupItemId: workingOrderLines.optionGroupItemId,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
  }

  it("carries a parent dish's modifier children along on a whole-line transfer", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const bacon = await asApp(cfg, (tx) => addOption(tx, cfg.tenantId, cafeId, "Bacon"));
    // Tab A: café (parent, line 1) + bacon child (line 2). Tab B: agua (line 1).
    const tabA = await openModifierTab(cfg, tableAId, [
      { productId: cafeId, quantity: "1", options: [{ optionGroupItemId: bacon }] },
    ]);
    const tabB = await openModifierTab(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    // Transfer the PARENT dish (line 1) whole — its child must follow, not orphan on the source.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1 }]));

    expect(await modLinesOf(tabA)).toEqual([]); // both left the source
    const b = await modLinesOf(tabB);
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId, null]);
    const parent = b.find((l) => l.productId === cafeId)!;
    const child = b.find((l) => l.optionGroupItemId === bacon)!;
    // The moved child points at the moved dish's NEW id (remapped), never null.
    expect(child.parentLineId).toBe(parent.id);
    expect(child.parentLineId).not.toBeNull();
  });

  it("refuses transferring a modifier CHILD line on its own (tab.transfer_modifier_line)", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const bacon = await asApp(cfg, (tx) => addOption(tx, cfg.tenantId, cafeId, "Bacon"));
    const tabA = await openModifierTab(cfg, tableAId, [
      { productId: cafeId, quantity: "1", options: [{ optionGroupItemId: bacon }] },
    ]);
    const tabB = await openModifierTab(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 2 }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_modifier_line",
      params: { tabId: tabA, lineNo: 2 },
    });
    // Source untouched — the whole dish + child are still on A.
    expect((await modLinesOf(tabA)).map((l) => l.lineNo)).toEqual([1, 2]);
    expect((await modLinesOf(tabB)).map((l) => l.productId)).toEqual([aguaId]);
  });

  it("refuses a partial split of a dish that carries modifiers (tab.transfer_modifier_line)", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId } = await setupVenue();
    const bacon = await asApp(cfg, (tx) => addOption(tx, cfg.tenantId, cafeId, "Bacon"));
    // café ×2 (parent, line 1) + bacon child (line 2).
    const tabA = await openModifierTab(cfg, tableAId, [
      { productId: cafeId, quantity: "2", options: [{ optionGroupItemId: bacon }] },
    ]);
    const tabB = await openModifierTab(cfg, tableBId, [{ productId: aguaId, quantity: "1" }]);

    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_modifier_line",
      params: { tabId: tabA, lineNo: 1 },
    });
    // Nothing split or moved.
    expect((await modLinesOf(tabA)).map((l) => l.lineNo)).toEqual([1, 2]);
    expect((await modLinesOf(tabB)).map((l) => l.productId)).toEqual([aguaId]);
  });
});
