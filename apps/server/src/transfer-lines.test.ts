import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locations, tills, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  centsToDecimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  thousandthsToDecimal,
  tillId as brandTillId,
  type ExtraSelection,
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
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The WRITE behaviour of `transferLines`, and of `moveTabLines` given a subset of lines — the split
// arithmetic, the guards, the line renumbering, the price-lock. The per-tab fiscal filing is
// `transfer-lines.filing.test.ts`'s job.
const LOCALE = "es-ES";
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
  /** "Café" — each, 1.50 gross, general(21%). */
  cafeId: string;
  /** "Agua" — each, 2.00 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  /** "Bacon" — each, 0.50 gross, reduced(10%). Sold only as another dish's extra here, so a child
   *  line's product id can never be mistaken for a dish's. */
  baconId: string;
  tableAId: string;
  tableBId: string;
  /** The zone both tables sit in, and the café's, agua's and jamón's offers there. */
  zoneId: string;
  cafeOffer: string;
  aguaOffer: string;
  jamonOffer: string;
}

async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  // Through the table definitions rather than raw SQL: `invoice_locales` is a JSON array in a text
  // column on this engine (`labelList`, packages/db/src/schema/columns.ts), so there is no array
  // constructor to write, and `id` is a `$defaultFn` a raw insert would never reach.
  const locationId = randomUUID();
  await db.insert(locations).values({
    id: locationId,
    name: "Barra",
    invoiceLocales: [LOCALE],
    operationDescription: "Venta en establecimiento",
  });
  const tillId = randomUUID();
  await db.insert(tills).values({ id: tillId, locationId, name: "Caja 1" });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
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
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Jamón",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const bacon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Bacon",
      pricingUnit: "each",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const a = await createTable(tx, cfg, { label: "A", zoneId: offers.zoneId });
    const b = await createTable(tx, cfg, { label: "B", zoneId: offers.zoneId });
    return {
      cafeId: cafe.id,
      aguaId: agua.id,
      jamonId: jamon.id,
      baconId: bacon.id,
      tableAId: a.id,
      tableBId: b.id,
      zoneId: offers.zoneId,
      cafeOffer: offers.offerFor(cafe.id),
      aguaOffer: offers.offerFor(agua.id),
      jamonOffer: offers.offerFor(jamon.id),
    };
  });
  return { cfg, ...seeded };
}

/** Run `fn` on a fresh transaction, like production. */
function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
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
    unitName: Record<string, string> | null;
    unitPrecision: number | null;
  }[]
> {
  const rows = await db
    .select({
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  // Three scaled-integer columns, handed back as DECIMAL LITERALS, each at its own scale.
  return rows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
    unitPriceGross: centsToDecimal(row.unitPriceGross),
    lineTotal: centsToDecimal(row.lineTotal),
  }));
}

/** Open a tab on `tableId` with an initial round, returning its tab id. */
async function openTabWith(
  cfg: TillConfig,
  tableId: string,
  lines: { menuItemId: string; quantity: string }[],
): Promise<string> {
  const { tabId } = await asApp(cfg, (tx) => openTab(tx, cfg, { tableId, lines }));
  return tabId;
}

describe("moveTabLines — subset", () => {
  it("moves ONLY the named lines, leaves the rest on the source, renumbers on the destination", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    // Tab A: line 1 = café×2, line 2 = agua×1. Tab B: line 1 = agua×3 (so the moved line lands at 2).
    const tabA = await openTabWith(cfg, tableAId, [
      { menuItemId: cafeOffer, quantity: "2" },
      { menuItemId: aguaOffer, quantity: "1" },
    ]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "3" }]);

    // Move ONLY line 1 (café) from A to B.
    await asApp(cfg, (tx) => moveTabLines(tx, cfg, tabA, tabB, [1]));

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
    const { cfg, cafeId, aguaId, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);

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
    const { cfg, tableAId, cafeOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabA, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.transfer_self", params: { tabId: tabA } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  it("refuses when the destination is not an open tab (tab.not_open)", async () => {
    const { cfg, tableAId, cafeOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const notATab = randomUUID(); // no working_orders row, no dining_tables back-pointer
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, notATab, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: notATab } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  // A PARKED walk-up IS an open working order, but no dining_tables row points at it, so only
  // assertAnchoredTabOpen's back-pointer check refuses it: a transfer moves items between two TABS.
  it("refuses transferring INTO an open order no table points at — a parked walk-up (tab.not_open)", async () => {
    const { cfg, tableAId, zoneId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const parkedId = randomUUID();
    // Parked in the tabs' own zone, so the two orders' service modes agree and only the
    // back-pointer check stands between the transfer and the parked order.
    await parkOrder({ db }, cfg, {
      id: parkedId,
      zoneId,
      lines: [{ menuItemId: aguaOffer, quantity: "1" }],
    });
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, parkedId, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: parkedId } });
    expect(await linesOf(tabA)).toHaveLength(1); // café line untouched on A
    expect(await linesOf(parkedId)).toHaveLength(1); // parked order still holds only its agua line
  });
});

describe("transferLines — partial split", () => {
  it("splits a line: source quantity drops, a destination line appears at the SAME locked gross, quantity conserved", async () => {
    const { cfg, aguaId, tableAId, tableBId, cafeOffer, aguaOffer, cafeId } = await setupVenue();
    // Tab A: café×3 (line 1). Tab B: agua×1 (line 1) → the split lands at B line 2.
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);

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
        unitName: expect.objectContaining({ en: "ea" }),
        unitPrecision: 0,
      }),
    ]);
    // Quantity conserved: 2 + 1 = the original 3. Money conserved for `each`: 3.00 + 1.50 = 4.50.
  });

  it("PRICE LOCK: a catalogue price change between ring and transfer re-prices NEITHER line", async () => {
    const { cfg, cafeId, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);

    // Change the catalogue's café price AFTER the ring, BEFORE the transfer (owner write).
    // If `transferLines` re-consulted the catalogue, the moved/kept line would jump to 9.99.
    await db.execute(sql`update products set unit_price = 999 where id = ${cafeId}`);

    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Both keep the ORIGINAL locked 1.50 — never 9.99. line_totals derived from 1.50, not the catalogue.
    expect(a[0]).toMatchObject({ unitPriceGross: "1.50", quantity: "2.000", lineTotal: "3.00" });
    expect(b[1]).toMatchObject({ unitPriceGross: "1.50", quantity: "1.000", lineTotal: "1.50" });
  });

  it("splits a WEIGHED (decimal-quantity) line the same way, conserving the weight", async () => {
    const { cfg, jamonId, tableAId, tableBId, aguaOffer, jamonOffer } = await setupVenue();
    // Jamón 24.90/kg, 0.320 kg on tab A. Locked gross unit = 24.90; line_total round(0.320×24.90)=7.97.
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: jamonOffer, quantity: "0.320" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);

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
    // Weight conserved: 0.200 + 0.120 = 0.320. (Money 4.98+2.99=7.97 == original — exact here.)
  });
});

describe("transferLines — full-quantity partial is a whole-line move", () => {
  it("moving quantity EQUAL to the line's quantity leaves no zero remnant on the source", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);

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
    const { cfg, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 99, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // The presence check on its own: a WHOLE-line transfer (`quantity` omitted) never reaches the
  // quantity guard, which the other tab.line_not_found cases here would also trip.
  it("throws tab.line_not_found for a WHOLE-line transfer (quantity omitted) naming an unknown line_no", async () => {
    const { cfg, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 99 }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  it("throws tab.transfer_quantity_invalid for zero, negative, over-quantity, or malformed", async () => {
    const { cfg, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
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

  // Over-quantity at DECIMAL scale, not just whole numbers: the comparison must be value-wise.
  it("throws tab.transfer_quantity_invalid for a decimal-scale over-quantity on a WEIGHED line", async () => {
    const { cfg, tableAId, tableBId, aguaOffer, jamonOffer, jamonId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: jamonOffer, quantity: "0.500" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.600" }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_quantity_invalid",
      params: { tabId: tabA, lineNo: 1, quantity: "0.600" },
    });
    expect((await linesOf(tabA))[0]).toMatchObject({ productId: jamonId, quantity: "0.500" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // Validate-before-mutate. The valid entry comes FIRST, so a loop that validated and wrote entry by
  // entry would already have split it when the second entry is refused.
  it("validates every transfer before moving/splitting any of them — a bad entry leaves BOTH tabs unchanged", async () => {
    const { cfg, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [
      { menuItemId: cafeOffer, quantity: "3" },
      { menuItemId: aguaOffer, quantity: "2" },
    ]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
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

  it("refuses a transfer onto an empty tab on a table in no zone (service_zone.mode_incompatible), whole line or part", async () => {
    const { cfg, cafeId, tableAId, cafeOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "2" }]);
    const zoneless = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "No zone" }));
    const empty = await openTabWith(cfg, zoneless.id, []);
    for (const transfer of [{ lineNo: 1, quantity: "1" }, { lineNo: 1 }]) {
      await expect(
        asApp(cfg, (tx) => transferLines(tx, cfg, tabA, empty, [transfer])),
      ).rejects.toMatchObject({
        code: "service_zone.mode_incompatible",
        params: { zoneId: "unscoped", expected: "table_tab", actual: "unscoped" },
      });
    }
    expect(await linesOf(tabA)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: cafeId, quantity: "2.000" }),
    ]);
    expect(await linesOf(empty)).toEqual([]);
  });
});

describe("transferLines — duplicate line_no in the batch", () => {
  // A batch naming the SAME source line_no twice cannot conserve quantity — see
  // `assertDistinctTransferLines` — so it is refused before any write, naming the first repeat.
  it("rejects a partial+partial batch repeating a line_no (tab.transfer_duplicate_line), conserving quantity", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
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

  // A whole-line + partial pair on one line is contradictory, and refused by the same guard.
  it("rejects a whole-line+partial batch repeating a line_no (tab.transfer_duplicate_line), conserving quantity", async () => {
    const { cfg, cafeId, aguaId, tableAId, tableBId, cafeOffer, aguaOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: cafeOffer, quantity: "3" }]);
    const tabB = await openTabWith(cfg, tableBId, [{ menuItemId: aguaOffer, quantity: "1" }]);
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

describe("transferLines — extras children (FIX 2 cascade / FIX 4 split)", () => {
  /** Offer `extraProductId` as an extra of `dishId` through a one-item list, returning the list id a
   *  line names. `minPicks: 0` leaves the list optional, so the dish still orders on its own. */
  async function addExtra(
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
        maxPicks: 1,
        active: true,
        items: [{ productId: extraProductId, maxQuantity: 1, preselected: false, price: "0.50" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, dishId, [{ kind: "extras", id: list.id }]);
    // An offer carries only the extras lists published on it, so re-offer to publish this one.
    await offerProducts(tx, cfg, { zone: "tables" });
    return list.id;
  }

  /** Open an OPEN order with extras lines and point `tableId` at it → a real tab (`assertAnchoredTabOpen` needs
   *  the back-pointer). `openTab` does not thread `extras`, so build the tab directly here. No fire. */
  async function openExtrasTab(
    cfg: TillConfig,
    zoneId: string,
    tableId: string,
    lines: { menuItemId: string; quantity: string; extras?: ExtraSelection[] }[],
  ): Promise<string> {
    return asApp(cfg, async (tx) => {
      const id = randomUUID();
      await createOpenOrder(tx, cfg, id, lines, null, { zoneId });
      await tx.execute(sql`update dining_tables set tab_id = ${id} where id = ${tableId}`);
      return id;
    });
  }

  /** Lines of a tab with the parent↔child linkage columns, owner-read, by `line_no`. A child line is
   *  the one carrying the PICKED extra product and a parent link. */
  async function modLinesOf(tabId: string): Promise<
    {
      id: string;
      lineNo: number;
      productId: string | null;
      parentLineId: string | null;
    }[]
  > {
    return db
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        productId: workingOrderLines.productId,
        parentLineId: workingOrderLines.parentLineId,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
  }

  it("carries a parent dish's extras children along on a whole-line transfer", async () => {
    const { cfg, cafeId, aguaId, baconId, tableAId, tableBId, zoneId, cafeOffer, aguaOffer } =
      await setupVenue();
    const extraListId = await asApp(cfg, (tx) => addExtra(tx, cfg, cafeId, baconId));
    // Tab A: café (parent, line 1) + bacon child (line 2). Tab B: agua (line 1).
    const tabA = await openExtrasTab(cfg, zoneId, tableAId, [
      {
        menuItemId: cafeOffer,
        quantity: "1",
        extras: [{ listId: extraListId, picks: [{ productId: baconId, quantity: 1 }] }],
      },
    ]);
    const tabB = await openExtrasTab(cfg, zoneId, tableBId, [
      { menuItemId: aguaOffer, quantity: "1" },
    ]);

    // Transfer the PARENT dish (line 1) whole — its child must follow, not orphan on the source.
    await asApp(cfg, (tx) => transferLines(tx, cfg, tabA, tabB, [{ lineNo: 1 }]));

    expect(await modLinesOf(tabA)).toEqual([]); // both left the source
    const b = await modLinesOf(tabB);
    expect(b.map((l) => l.productId)).toEqual([aguaId, cafeId, baconId]);
    const parent = b.find((l) => l.productId === cafeId)!;
    const child = b.find((l) => l.productId === baconId)!;
    // The moved child points at the moved dish's NEW id (remapped), never null.
    expect(child.parentLineId).toBe(parent.id);
    expect(child.parentLineId).not.toBeNull();
  });

  it("refuses transferring an extra's CHILD line on its own (tab.transfer_modifier_line)", async () => {
    const { cfg, cafeId, aguaId, baconId, tableAId, tableBId, zoneId, cafeOffer, aguaOffer } =
      await setupVenue();
    const extraListId = await asApp(cfg, (tx) => addExtra(tx, cfg, cafeId, baconId));
    const tabA = await openExtrasTab(cfg, zoneId, tableAId, [
      {
        menuItemId: cafeOffer,
        quantity: "1",
        extras: [{ listId: extraListId, picks: [{ productId: baconId, quantity: 1 }] }],
      },
    ]);
    const tabB = await openExtrasTab(cfg, zoneId, tableBId, [
      { menuItemId: aguaOffer, quantity: "1" },
    ]);

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

  it("refuses a partial split of a dish that carries extras (tab.transfer_modifier_line)", async () => {
    const { cfg, cafeId, aguaId, baconId, tableAId, tableBId, zoneId, cafeOffer, aguaOffer } =
      await setupVenue();
    const extraListId = await asApp(cfg, (tx) => addExtra(tx, cfg, cafeId, baconId));
    // café ×2 (parent, line 1) + bacon child (line 2).
    const tabA = await openExtrasTab(cfg, zoneId, tableAId, [
      {
        menuItemId: cafeOffer,
        quantity: "2",
        extras: [{ listId: extraListId, picks: [{ productId: baconId, quantity: 1 }] }],
      },
    ]);
    const tabB = await openExtrasTab(cfg, zoneId, tableBId, [
      { menuItemId: aguaOffer, quantity: "1" },
    ]);

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
