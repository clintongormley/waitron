import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { recordReplacement } from "@waitron/core";
import { readLiveSeriesIdTx, saleLines, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { addProducts, createProduct, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId, seriesId as brandSeriesId, type SaleId } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { correctiveLinesInPart } from "./corrective-lines-in-part.js";
import { readReceiptEmailDocument } from "./invoice-document.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readOrderRevision } from "./working-order-context.js";
import { GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { giveBackCash } from "./testing/give-back-cash.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import {
  cashContribution,
  inTx,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  addSpecLunch,
  lunchBill,
  printSpecBill,
  serveSpecBill,
  specDeps,
  specRows,
  setupSetMenuSpecVenue,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

// Plan section 6: a filed corrective row is given back in part when minus its line_gross differs
// from the line_gross of the line it corrects.
let spec: SpecVenue;
let venue: PartyVenue;
let lunch: SpecLunch;
let cheeseItem: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

beforeAll(async () => {
  cheeseItem = await inTx(venue, async (tx) => {
    const cheese = await createProduct(tx, {
      categoryId: null,
      name: "Cheese",
      pricingUnit: "weight",
      unitPrice: "5.20",
      vatClass: "reduced",
    });
    await addProducts(tx, await requireMenuRoot(tx, venue.tables.menuId), [cheese.id]);
    await publishWorkingMenu(tx, venue.tables.menuId);
    const [item] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, venue.tables.menuId), eq(menuItems.productId, cheese.id)));
    return item!.id;
  });
  lunch = await addSpecLunch(spec);
});

/** A bill eaten here holding `lines`, paid in cash: its sale's filed rows. */
async function paidBill(lines: { menuItemId: string; quantity: string }[], amount: string) {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await inTx(venue, (tx) => addTabRound(tx, venue.cfg, bill.tabId, lines));
  await cashContribution(venue, bill.tabId, amount);
  return filedOf(bill.tabId);
}

async function filedOf(tabId: string) {
  const [sale] = await venue.db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, tabId));
  const rows = await venue.db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, sale!.id))
    .orderBy(saleLines.lineNo);
  return { saleId: brandSaleId(sale!.id), rows };
}

const giveBack = (saleId: SaleId, gross: string, lineId: string) =>
  giveBackCash(venue, saleId, gross, [lineId]);

/**
 * The corrective's rows given back in part, by name: as the function answers them, and as the
 * receipt and the emailed document carry them.
 */
async function inPart(correctiveId: string) {
  const rows = await venue.db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, correctiveId))
    .orderBy(saleLines.lineNo);
  const ids = await inTx(venue, (tx) => correctiveLinesInPart(tx, rows));
  const answered = rows.filter((row) => ids.has(row.id)).map((row) => row.name);
  // Both documents answer one line per filed row, in order; these correctives take no advance off.
  const flagged = (lines: readonly { givenBackInPart?: true }[]) =>
    rows.filter((_, i) => lines[i]?.givenBackInPart === true).map((row) => row.name);
  const receipt = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, correctiveId),
  );
  const emailed = await inTx(venue, (tx) =>
    readReceiptEmailDocument(venue.backend, tx, venue.cfg, correctiveId),
  );
  return { answered, receipt: flagged(receipt.lines), emailed: flagged(emailed.result.lines) };
}

const both = (names: string[]) => ({ answered: names, receipt: names, emailed: names });

describe("a corrective row given back", () => {
  it("as 6.82 of a paella of one is in part", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      "20.00",
    );
    expect(await inPart(await giveBack(saleId, "6.82", rows[0]!.id))).toEqual(both(["Paella"]));
  });

  it("as one burger's money of a row of three is in part", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Burger"), quantity: "3" }],
      "36.00",
    );
    expect(rows[0]).toMatchObject({ quantity: 3000, lineGross: 3600 });
    expect(await inPart(await giveBack(saleId, "12.00", rows[0]!.id))).toEqual(both(["Burger"]));
  });

  it("as two halves of one paella is in part, each time", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      "20.00",
    );
    const first = await giveBack(saleId, "10.00", rows[0]!.id);
    const second = await giveBack(saleId, "10.00", rows[0]!.id);
    expect(await inPart(first)).toEqual(both(["Paella"]));
    expect(await inPart(second)).toEqual(both(["Paella"]));
  });

  it("as the whole of 350 g at 5.20/kg is whole", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: cheeseItem, quantity: "0.350" }],
      "1.82",
    );
    expect(rows[0]).toMatchObject({ quantity: 350, lineGross: 182 });
    expect(await inPart(await giveBack(saleId, "1.82", rows[0]!.id))).toEqual(both([]));
  });

  // The lemonade's filed gross, 1.92, is all its set menu's part; giving back all of it negates
  // the stored gross, so the row is whole though its sold amount, gross less part, is 0.00.
  it("as the whole filed gross of a divided set menu's lemonade is whole", async () => {
    const bill = await lunchBill(spec, lunch);
    await cashContribution(venue, bill.tabId, "14.00");
    const { saleId, rows } = await filedOf(bill.tabId);
    const lemonade = rows.find((row) => row.name === "Lemonade")!;
    expect(lemonade).toMatchObject({ lineGross: 192, setMenuPart: 192 });
    const correctiveId = await giveBack(saleId, "1.92", lemonade.id);
    const [row] = await venue.db
      .select({ lineGross: saleLines.lineGross, correctsLineId: saleLines.correctsLineId })
      .from(saleLines)
      .where(eq(saleLines.saleId, correctiveId));
    expect(row).toEqual({ lineGross: -192, correctsLineId: lemonade.id });
    expect(await inPart(correctiveId)).toEqual(both([]));
  });
});

describe("no row is given back in part", () => {
  it("on a whole credit of a bill with a shared free item and a divided set menu", async () => {
    const bill = await lunchBill(spec, lunch);
    await inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, bill.tabId, [
        { menuItemId: venue.item("Paella"), quantity: "1" },
        { menuItemId: venue.item("Water"), quantity: "1" },
      ]),
    );
    const water = (await specRows(spec, bill.tabId)).find((line) => line.name === "Water")!;
    await inTx(venue, async (tx) =>
      applyAdjustment(
        tx,
        venue.cfg,
        {
          admission: testTradingAdmission(),
          orderId: bill.tabId,
          expectedEdit: await readBillEditState(tx, bill.tabId),
          submissionId: crypto.randomUUID(),
          expectedRevision: await readOrderRevision(tx, bill.tabId),
          reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON),
          lineId: water.id,
          action: "comp",
          note: null,
          operatorId: venue.operator.personId,
        },
        venue.cfg.locale,
      ),
    );
    await serveSpecBill(spec, bill.partyId, bill.tabId);
    const { saleId } = await printSpecBill(spec, bill.partyId, bill.tabId);
    const filed = await venue.db
      .select({
        name: saleLines.name,
        lineGross: saleLines.lineGross,
        setMenuPart: saleLines.setMenuPart,
      })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId!));
    // The free water took its share of the price paid; the set menu's dishes their parts.
    expect(filed.find((row) => row.name === "Water")!.lineGross).toBeGreaterThan(0);
    const lemonade = filed.find((row) => row.name === "Lemonade")!;
    expect(lemonade.setMenuPart).toBe(lemonade.lineGross);
    expect(lemonade.lineGross).toBeGreaterThan(0);

    await splitAfterPrint(specDeps(spec), venue.cfg, bill.tabId, venue.operator);
    const [credit] = await venue.db
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.correctsSaleId, saleId!));
    expect(await inPart(credit!.id)).toEqual(both([]));
  });

  it("on a row with no stored gross, whatever line it names", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      "20.00",
    );
    const [row] = await venue.db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, await giveBack(saleId, "6.82", rows[0]!.id)));
    const unstored = { ...row!, lineGross: null };
    expect(await inTx(venue, (tx) => correctiveLinesInPart(tx, [unstored]))).toEqual(new Set());
  });

  it("on a replacement, which names no line", async () => {
    const lunchSale = await lunchBill(spec, lunch);
    await cashContribution(venue, lunchSale.tabId, "14.00");
    const { saleId } = await filedOf(lunchSale.tabId);
    const replacementId = await inTx(venue, async (tx) => {
      await refusedByAeat(tx, saleId);
      const { saleId: id } = await recordReplacement(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "corrective")),
        correctsSaleId: saleId,
        authz: { sessionId: venue.operator.sessionId },
        clock: venue.clock,
      });
      return id;
    });
    expect(await inPart(replacementId)).toEqual(both([]));
  });
});
