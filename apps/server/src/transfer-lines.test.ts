import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locations, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToVenue,
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
  thousandthsToDecimal,
  type ExtraSelection,
  jobOrigin,
} from "@waitron/shared";
import type { OriginConfig } from "./trading-context.js";
import { createTable } from "./testing/live-table.js";
import { parkOrder, moveOrderLines } from "./working-order.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { openGroupedCounterOrder, writeGroupedLines } from "./testing/grouped-counter-order.js";
import { transferItems } from "./testing/bill-action-fixture.js";
import { partyRevisionOfOrder } from "./parties.js";
import { VENUE_SERVICE } from "./modules.js";

// The WRITE behaviour of a transfer between two bills of one party, and of `moveOrderLines` given a
// subset of lines — the split arithmetic, the guards, the line renumbering, the price-lock. The
// per-bill fiscal filing is `transfer-lines.filing.test.ts`'s job.
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
  cfg: OriginConfig;
  coffeeId: string;
  waterId: string;
  hamId: string;
  /** "Bacon" — each, 0.50 gross, reduced(10%). Sold only as another dish's extra here, so a child
   *  line's product id can never be mistaken for a dish's. */
  baconId: string;
  tableAId: string;
  zoneId: string;
  coffeeOffer: string;
  waterOffer: string;
  hamOffer: string;
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
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const drinks = await createCategory(tx, { name: "Bebidas" });
    const coffee = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const water = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    const ham = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Jamón",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const bacon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Bacon",
      pricingUnit: "each",
      unitPrice: "0.50",
      vatClass: "reduced",
    });
    await assignCatalogueToVenue(tx, cat.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const a = await createTable(tx, cfg, { label: "A", zoneId: offers.zoneId });
    return {
      coffeeId: coffee.id,
      waterId: water.id,
      hamId: ham.id,
      baconId: bacon.id,
      tableAId: a.id,
      zoneId: offers.zoneId,
      coffeeOffer: offers.offerFor(coffee.id),
      waterOffer: offers.offerFor(water.id),
      hamOffer: offers.offerFor(ham.id),
    };
  });
  return { cfg, ...seeded };
}

/** Run `fn` on a fresh transaction, like production. */
function asApp<T>(cfg: OriginConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
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

/**
 * Open a tab on `tableId` with an initial round, returning its tab id. Its lines are stored grouped,
 * as a line written before portions holds them: this file moves part of a line.
 */
async function openTabWith(
  cfg: OriginConfig,
  tableId: string,
  lines: { menuItemId: string; quantity: string }[],
): Promise<string> {
  return asApp(cfg, async (tx) => {
    const { tabId } = await openPartyTab(tx, cfg, { tableId });
    await writeGroupedLines(tx, cfg, tabId, lines);
    return tabId;
  });
}

/** A second bill of `tabId`'s party with `lines`, in its service context unless `zoneless`. */
async function openBeside(
  cfg: OriginConfig,
  tabId: string,
  lines: { menuItemId: string; quantity: string }[],
  zoneless = false,
): Promise<string> {
  return asApp(cfg, async (tx) => {
    const party = (await partyRevisionOfOrder(tx, tabId))!;
    const context = await VENUE_SERVICE.findOrderContext(tx, cfg, tabId);
    const id = randomUUID();
    await openGroupedCounterOrder(tx, cfg, id, lines, {
      partyId: party.id,
      zoneId: context!.zoneId,
    });
    if (zoneless) {
      await tx.run(sql`delete from order_service_contexts where working_order_id = ${id}`);
    }
    return id;
  });
}

/** A transfer between two bills, sent with the source bill's party's revision as it stands. */
async function transfer(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  toBillId: string,
  transfers: { lineNo: number; quantity?: string }[],
): Promise<void> {
  const party = await partyRevisionOfOrder(tx, fromBillId);
  await transferItems(tx, cfg, fromBillId, toBillId, transfers, {
    expectedPartyRevision: party!.revision,
    operatorId: randomUUID(),
  });
}

describe("moveOrderLines — subset", () => {
  it("moves ONLY the named lines, leaves the rest on the source, renumbers on the destination", async () => {
    const { cfg, coffeeId, waterId, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [
      { menuItemId: coffeeOffer, quantity: "2" },
      { menuItemId: waterOffer, quantity: "1" },
    ]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "3" }]);

    await asApp(cfg, (tx) => moveOrderLines(tx, cfg, tabA, tabB, [1]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a.map((l) => l.productId)).toEqual([waterId]);
    expect(b.map((l) => l.productId)).toEqual([waterId, coffeeId]);
    expect(b[1]).toMatchObject({
      lineNo: 2,
      quantity: "2.000",
      unitPriceGross: "1.50",
      lineTotal: "3.00",
    });
  });
});

describe("transfer — whole line", () => {
  it("moves an entire line to the other tab, keeping its locked unit_price_gross, source line gone", async () => {
    const { cfg, coffeeId, waterId, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);

    // Whole line = `quantity` omitted.
    await asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1 }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([]);
    expect(b.map((l) => l.productId)).toEqual([waterId, coffeeId]);
    expect(b[1]).toMatchObject({
      lineNo: 2,
      quantity: "2.000",
      unitPriceGross: "1.50",
      lineTotal: "3.00",
    });
  });

  it("refuses transferring a tab to ITSELF (tab.transfer_self), changing nothing", async () => {
    const { cfg, tableAId, coffeeOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabA, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.transfer_self", params: { tabId: tabA } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  it("refuses when the destination is not an open tab (tab.not_open)", async () => {
    const { cfg, tableAId, coffeeOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const notATab = randomUUID(); // no working_orders row
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, notATab, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open", params: { tabId: notATab } });
    expect(await linesOf(tabA)).toHaveLength(1); // untouched
  });

  // A PARKED walk-up IS an open working order, but it belongs to no party.
  it("refuses transferring INTO an open order of no party — a parked walk-up (bill.other_party)", async () => {
    const { cfg, tableAId, zoneId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const parkedId = randomUUID();
    // Parked in the tabs' own zone, so the two orders' service modes agree and only the party
    // check stands between the transfer and the parked order.
    await parkOrder({ db }, cfg, {
      id: parkedId,
      zoneId,
      lines: [{ menuItemId: waterOffer, quantity: "1" }],
    });
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, parkedId, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "bill.other_party", params: { workingOrderId: parkedId } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(parkedId)).toHaveLength(1);
  });
});

describe("transfer — partial split", () => {
  it("splits a line: source quantity drops, a destination line appears at the SAME locked gross, quantity conserved", async () => {
    const { cfg, waterId, tableAId, coffeeOffer, waterOffer, coffeeId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "3" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);

    // Move 1 of the 3 coffees.
    await asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([
      expect.objectContaining({
        lineNo: 1,
        productId: coffeeId,
        quantity: "2.000",
        unitPriceGross: "1.50",
        lineTotal: "3.00",
      }),
    ]);
    expect(b).toEqual([
      expect.objectContaining({ lineNo: 1, productId: waterId }),
      expect.objectContaining({
        lineNo: 2,
        productId: coffeeId,
        quantity: "1.000",
        unitPriceGross: "1.50",
        lineTotal: "1.50",
        unitName: { es: "ud" },
        unitPrecision: 0,
      }),
    ]);
    // Quantity conserved: 2 + 1 = the original 3. Money conserved for `each`: 3.00 + 1.50 = 4.50.
  });

  it("PRICE LOCK: a catalogue price change between ring and transfer re-prices NEITHER line", async () => {
    const { cfg, coffeeId, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "3" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);

    // If the transfer re-consulted the catalogue, the moved/kept line would jump to 9.99.
    await db.execute(sql`update products set unit_price = 999 where id = ${coffeeId}`);

    await asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Both keep the ORIGINAL locked 1.50 — never 9.99. line_totals derived from 1.50, not the catalogue.
    expect(a[0]).toMatchObject({ unitPriceGross: "1.50", quantity: "2.000", lineTotal: "3.00" });
    expect(b[1]).toMatchObject({ unitPriceGross: "1.50", quantity: "1.000", lineTotal: "1.50" });
  });

  it("splits a WEIGHED (decimal-quantity) line the same way, conserving the weight", async () => {
    const { cfg, hamId, tableAId, waterOffer, hamOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: hamOffer, quantity: "0.320" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);

    await asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.120" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    // Source: 0.320 − 0.120 = 0.200 kg, line_total round(0.200×24.90)=4.98.
    expect(a[0]).toMatchObject({
      productId: hamId,
      quantity: "0.200",
      unitPriceGross: "24.90",
      lineTotal: "4.98",
    });
    // Destination: 0.120 kg at the SAME 24.90/kg, line_total round(0.120×24.90)=2.99.
    expect(b[1]).toMatchObject({
      productId: hamId,
      quantity: "0.120",
      unitPriceGross: "24.90",
      lineTotal: "2.99",
    });
    // Weight conserved: 0.200 + 0.120 = 0.320. (Money 4.98+2.99=7.97 == original — exact here.)
  });
});

describe("transfer — full-quantity partial is a whole-line move", () => {
  it("moving quantity EQUAL to the line's quantity leaves no zero remnant on the source", async () => {
    const { cfg, coffeeId, waterId, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);

    // Explicit quantity "2" == the whole line — must behave exactly like an omitted quantity.
    await asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "2" }]));

    const a = await linesOf(tabA);
    const b = await linesOf(tabB);
    expect(a).toEqual([]); // NO zero-quantity remnant left behind
    expect(b.map((l) => l.productId)).toEqual([waterId, coffeeId]);
    expect(b[1]).toMatchObject({
      lineNo: 2,
      quantity: "2.000",
      unitPriceGross: "1.50",
      lineTotal: "3.00",
    });
  });
});

describe("transfer — guards", () => {
  it("throws tab.line_not_found for a line_no not on the source tab, changing nothing", async () => {
    const { cfg, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 99, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // The presence check on its own: a WHOLE-line transfer (`quantity` omitted) never reaches the
  // quantity guard, which the other tab.line_not_found cases here would also trip.
  it("throws tab.line_not_found for a WHOLE-line transfer (quantity omitted) naming an unknown line_no", async () => {
    const { cfg, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 99 }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found", params: { tabId: tabA, lineNo: 99 } });
    expect(await linesOf(tabA)).toHaveLength(1);
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  it("throws tab.transfer_quantity_invalid for zero, negative, over-quantity, or malformed", async () => {
    const { cfg, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "3" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    for (const bad of ["0", "-1", "4", "0.000", "abc", "1.0004"]) {
      await expect(
        asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: bad }])),
      ).rejects.toMatchObject({
        code: "tab.transfer_quantity_invalid",
        params: { tabId: tabA, lineNo: 1, quantity: bad },
      });
    }
    // Nothing moved on any of the rejections.
    expect((await linesOf(tabA))[0]).toMatchObject({ quantity: "3.000" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  it("throws tab.transfer_quantity_invalid for a fraction of a line counted in whole units", async () => {
    const { cfg, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.5" }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_quantity_invalid",
      params: { tabId: tabA, lineNo: 1, quantity: "0.5" },
    });
    expect((await linesOf(tabA))[0]).toMatchObject({ quantity: "2.000" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // Over-quantity at DECIMAL scale, not just whole numbers: the comparison must be value-wise.
  it("throws tab.transfer_quantity_invalid for a decimal-scale over-quantity on a WEIGHED line", async () => {
    const { cfg, tableAId, waterOffer, hamOffer, hamId } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: hamOffer, quantity: "0.500" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "0.600" }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_quantity_invalid",
      params: { tabId: tabA, lineNo: 1, quantity: "0.600" },
    });
    expect((await linesOf(tabA))[0]).toMatchObject({ productId: hamId, quantity: "0.500" });
    expect(await linesOf(tabB)).toHaveLength(1);
  });

  // Validate-before-mutate. The valid entry comes FIRST, so a loop that validated and wrote entry by
  // entry would already have split it when the second entry is refused.
  it("validates every transfer before moving/splitting any of them — a bad entry leaves BOTH tabs unchanged", async () => {
    const { cfg, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [
      { menuItemId: coffeeOffer, quantity: "3" },
      { menuItemId: waterOffer, quantity: "2" },
    ]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) =>
        transfer(tx, cfg, tabA, tabB, [
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

  it("refuses a transfer onto an empty bill of the party with no service zone (service_zone.mode_incompatible), whole line or part", async () => {
    const { cfg, coffeeId, tableAId, coffeeOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "2" }]);
    const empty = await openBeside(cfg, tabA, [], true);
    for (const item of [{ lineNo: 1, quantity: "1" }, { lineNo: 1 }]) {
      await expect(
        asApp(cfg, (tx) => transfer(tx, cfg, tabA, empty, [item])),
      ).rejects.toMatchObject({
        code: "service_zone.mode_incompatible",
        params: { zoneId: "unscoped", expected: "table_tab", actual: "unscoped" },
      });
    }
    expect(await linesOf(tabA)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: coffeeId, quantity: "2.000" }),
    ]);
    expect(await linesOf(empty)).toEqual([]);
  });
});

describe("transfer — duplicate line_no in the batch", () => {
  // A batch naming the SAME source line_no twice cannot conserve quantity — see
  // `assertDistinctTransferLines` — so it is refused before any write, naming the first repeat.
  it("rejects a partial+partial batch repeating a line_no (tab.transfer_duplicate_line), conserving quantity", async () => {
    const { cfg, coffeeId, waterId, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "3" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) =>
        transfer(tx, cfg, tabA, tabB, [
          { lineNo: 1, quantity: "1" },
          { lineNo: 1, quantity: "1" },
        ]),
      ),
    ).rejects.toMatchObject({
      code: "tab.transfer_duplicate_line",
      params: { tabId: tabA, lineNo: 1 },
    });
    expect(await linesOf(tabA)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: coffeeId, quantity: "3.000" }),
    ]);
    expect(await linesOf(tabB)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: waterId }),
    ]);
  });

  // A whole-line + partial pair on one line is contradictory, and refused by the same guard.
  it("rejects a whole-line+partial batch repeating a line_no (tab.transfer_duplicate_line), conserving quantity", async () => {
    const { cfg, coffeeId, waterId, tableAId, coffeeOffer, waterOffer } = await setupVenue();
    const tabA = await openTabWith(cfg, tableAId, [{ menuItemId: coffeeOffer, quantity: "3" }]);
    const tabB = await openBeside(cfg, tabA, [{ menuItemId: waterOffer, quantity: "1" }]);
    await expect(
      asApp(cfg, (tx) =>
        transfer(tx, cfg, tabA, tabB, [{ lineNo: 1 }, { lineNo: 1, quantity: "1" }]),
      ),
    ).rejects.toMatchObject({
      code: "tab.transfer_duplicate_line",
      params: { tabId: tabA, lineNo: 1 },
    });
    expect(await linesOf(tabA)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: coffeeId, quantity: "3.000" }),
    ]);
    expect(await linesOf(tabB)).toEqual([
      expect.objectContaining({ lineNo: 1, productId: waterId }),
    ]);
  });
});

describe("transfer — extras children (FIX 2 cascade / FIX 4 split)", () => {
  /** Offer `extraProductId` as an extra of `dishId` through a one-item list, returning the list id a
   *  line names. `minPicks: 0` leaves the list optional, so the dish still orders on its own. */
  async function addExtra(
    tx: Transaction,
    cfg: OriginConfig,
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

  /** An OPEN bill of `partyId` with extras lines, stored grouped. No fire. */
  async function openExtrasTab(
    cfg: OriginConfig,
    zoneId: string,
    partyId: string,
    lines: { menuItemId: string; quantity: string; extras?: ExtraSelection[] }[],
  ): Promise<string> {
    return asApp(cfg, async (tx) => {
      const id = randomUUID();
      await openGroupedCounterOrder(tx, cfg, id, lines, { zoneId, partyId });
      return id;
    });
  }

  /** A party seated at `tableId`, whose bills the extras cases open. */
  async function partyAt(cfg: OriginConfig, tableId: string): Promise<string> {
    return (await asApp(cfg, (tx) => openPartyTab(tx, cfg, { tableId }))).partyId;
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
    const { cfg, coffeeId, waterId, baconId, tableAId, zoneId, coffeeOffer, waterOffer } =
      await setupVenue();
    const extraListId = await asApp(cfg, (tx) => addExtra(tx, cfg, coffeeId, baconId));
    const partyId = await partyAt(cfg, tableAId);
    const tabA = await openExtrasTab(cfg, zoneId, partyId, [
      {
        menuItemId: coffeeOffer,
        quantity: "1",
        extras: [{ listId: extraListId, picks: [{ productId: baconId, quantity: 1 }] }],
      },
    ]);
    const tabB = await openExtrasTab(cfg, zoneId, partyId, [
      { menuItemId: waterOffer, quantity: "1" },
    ]);

    // Transfer the PARENT dish (line 1) whole — its child must follow, not orphan on the source.
    await asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1 }]));

    expect(await modLinesOf(tabA)).toEqual([]); // both left the source
    const b = await modLinesOf(tabB);
    expect(b.map((l) => l.productId)).toEqual([waterId, coffeeId, baconId]);
    const parent = b.find((l) => l.productId === coffeeId)!;
    const child = b.find((l) => l.productId === baconId)!;
    // The moved child points at the moved dish's NEW id (remapped), never null.
    expect(child.parentLineId).toBe(parent.id);
    expect(child.parentLineId).not.toBeNull();
  });

  it("refuses transferring an extra's CHILD line on its own (tab.transfer_modifier_line)", async () => {
    const { cfg, coffeeId, waterId, baconId, tableAId, zoneId, coffeeOffer, waterOffer } =
      await setupVenue();
    const extraListId = await asApp(cfg, (tx) => addExtra(tx, cfg, coffeeId, baconId));
    const partyId = await partyAt(cfg, tableAId);
    const tabA = await openExtrasTab(cfg, zoneId, partyId, [
      {
        menuItemId: coffeeOffer,
        quantity: "1",
        extras: [{ listId: extraListId, picks: [{ productId: baconId, quantity: 1 }] }],
      },
    ]);
    const tabB = await openExtrasTab(cfg, zoneId, partyId, [
      { menuItemId: waterOffer, quantity: "1" },
    ]);

    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 2 }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_modifier_line",
      params: { tabId: tabA, lineNo: 2 },
    });
    // Source untouched — the whole dish + child are still on A.
    expect((await modLinesOf(tabA)).map((l) => l.lineNo)).toEqual([1, 2]);
    expect((await modLinesOf(tabB)).map((l) => l.productId)).toEqual([waterId]);
  });

  it("refuses a partial split of a dish that carries extras (tab.transfer_modifier_line)", async () => {
    const { cfg, coffeeId, waterId, baconId, tableAId, zoneId, coffeeOffer, waterOffer } =
      await setupVenue();
    const extraListId = await asApp(cfg, (tx) => addExtra(tx, cfg, coffeeId, baconId));
    const partyId = await partyAt(cfg, tableAId);
    const tabA = await openExtrasTab(cfg, zoneId, partyId, [
      {
        menuItemId: coffeeOffer,
        quantity: "2",
        extras: [{ listId: extraListId, picks: [{ productId: baconId, quantity: 1 }] }],
      },
    ]);
    const tabB = await openExtrasTab(cfg, zoneId, partyId, [
      { menuItemId: waterOffer, quantity: "1" },
    ]);

    await expect(
      asApp(cfg, (tx) => transfer(tx, cfg, tabA, tabB, [{ lineNo: 1, quantity: "1" }])),
    ).rejects.toMatchObject({
      code: "tab.transfer_modifier_line",
      params: { tabId: tabA, lineNo: 1 },
    });
    // Nothing split or moved.
    expect((await modLinesOf(tabA)).map((l) => l.lineNo)).toEqual([1, 2]);
    expect((await modLinesOf(tabB)).map((l) => l.productId)).toEqual([waterId]);
  });
});
