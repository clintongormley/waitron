import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { recordReplacement } from "@waitron/core";
import { invoiceSeries, readLiveSeriesIdTx, saleLines, sales, taxpayer } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { addProducts, createProduct, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { saleId as brandSaleId, seriesId as brandSeriesId, type SaleId } from "@waitron/shared";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { correctiveLinesInPart } from "./corrective-lines-in-part.js";
import { readReceiptEmailDocument } from "./invoice-document.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readOrderRevision } from "./working-order-context.js";
import { BAR_SOL, fullInvoice } from "./testing/bill-invoice-fixture.js";
import { GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { giveBackCash } from "./testing/invoice-correction.js";
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
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
  },
});

beforeAll(async () => {
  cheeseItem = await inTx(venue, async (tx) => {
    const cheese = await createProduct(tx, {
      categoryId: null,
      name: "Cheese",
      pricingUnit: "weight",
      unitPrice: "5.20",
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

const giveBack = async (saleId: SaleId, gross: string, lineIds?: string[]) =>
  (await giveBackCash(venue, saleId, gross, lineIds)).correction.correctiveSaleId!;

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

/** A full invoice to Bar Sol holding `lines`, paid in cash: its sale's filed rows. */
async function paidFullInvoice(lines: { menuItemId: string; quantity: string }[], amount: string) {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await inTx(venue, (tx) => addTabRound(tx, venue.cfg, bill.tabId, lines));
  await fullInvoice(venue, bill.tabId, BAR_SOL);
  await cashContribution(venue, bill.tabId, amount);
  return filedOf(bill.tabId);
}

type Printed = { quantity: string; unitPrice?: string; inPart: boolean };
/** How the receipt and the emailed document print the corrective's one row. */
async function printedRow(correctiveId: string): Promise<{ receipt: Printed; emailed: Printed }> {
  const shown = (line: {
    quantity: string;
    net?: { unitPrice: string };
    givenBackInPart?: true;
  }): Printed => ({
    quantity: line.quantity,
    ...(line.net === undefined ? {} : { unitPrice: line.net.unitPrice }),
    inPart: line.givenBackInPart === true,
  });
  const receipt = await inTx(venue, (tx) =>
    readTransactionReceipt(venue.backend, tx, venue.cfg, correctiveId),
  );
  const emailed = await inTx(venue, (tx) =>
    readReceiptEmailDocument(venue.backend, tx, venue.cfg, correctiveId),
  );
  expect(receipt.lines).toHaveLength(1);
  expect(emailed.result.lines).toHaveLength(1);
  return { receipt: shown(receipt.lines[0]!), emailed: shown(emailed.result.lines[0]!) };
}

const onBoth = (printed: Printed) => ({ receipt: printed, emailed: printed });

describe("whole dishes given back from a full invoice's row of three burgers at 12.00", () => {
  const threeBurgers = async () => {
    const filed = await paidFullInvoice(
      [{ menuItemId: venue.item("Burger"), quantity: "3" }],
      "36.00",
    );
    expect(filed.rows[0]).toMatchObject({ quantity: 3000, lineGross: 3600, unitPrice: 1091 });
    return filed;
  };

  it("as one burger's money prints -1 at the burger's price", async () => {
    const { saleId, rows } = await threeBurgers();
    const correctiveId = await giveBack(saleId, "12.00", [rows[0]!.id]);
    expect(await inPart(correctiveId)).toEqual(both([]));
    expect(await printedRow(correctiveId)).toEqual(
      onBoth({ quantity: "-1", unitPrice: "10.91", inPart: false }),
    );
  });

  it("as two burgers' money prints -2 at the burger's price", async () => {
    const { saleId, rows } = await threeBurgers();
    const correctiveId = await giveBack(saleId, "24.00", [rows[0]!.id]);
    expect(await printedRow(correctiveId)).toEqual(
      onBoth({ quantity: "-2", unitPrice: "10.91", inPart: false }),
    );
  });

  it("as all three burgers' money prints -3, the whole row", async () => {
    const { saleId, rows } = await threeBurgers();
    const correctiveId = await giveBack(saleId, "36.00", [rows[0]!.id]);
    expect(await printedRow(correctiveId)).toEqual(
      onBoth({ quantity: "-3", unitPrice: "10.91", inPart: false }),
    );
  });

  it("as half of one burger's money is in part", async () => {
    const { saleId, rows } = await threeBurgers();
    const correctiveId = await giveBack(saleId, "6.00", [rows[0]!.id]);
    expect(await inPart(correctiveId)).toEqual(both(["Burger"]));
    expect((await printedRow(correctiveId)).receipt.inPart).toBe(true);
  });

  it("as one burger and a cent is in part", async () => {
    const { saleId, rows } = await threeBurgers();
    const correctiveId = await giveBack(saleId, "12.01", [rows[0]!.id]);
    expect(await inPart(correctiveId)).toEqual(both(["Burger"]));
  });
});

describe("a dish on its own row given back whole", () => {
  it("prints -1 at its price", async () => {
    const { saleId, rows } = await paidFullInvoice(
      [{ menuItemId: venue.item("Burger"), quantity: "1" }],
      "12.00",
    );
    const correctiveId = await giveBack(saleId, "12.00", [rows[0]!.id]);
    expect(await printedRow(correctiveId)).toEqual(
      onBoth({ quantity: "-1", unitPrice: "10.91", inPart: false }),
    );
  });
});

describe("a corrective row given back", () => {
  it("as 6.82 of a paella of one is in part", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      "20.00",
    );
    expect(await inPart(await giveBack(saleId, "6.82", [rows[0]!.id]))).toEqual(both(["Paella"]));
  });

  it("as one burger's money of a row of three is whole", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Burger"), quantity: "3" }],
      "36.00",
    );
    expect(rows[0]).toMatchObject({ quantity: 3000, lineGross: 3600 });
    const correctiveId = await giveBack(saleId, "12.00", [rows[0]!.id]);
    expect(await inPart(correctiveId)).toEqual(both([]));
    expect(await printedRow(correctiveId)).toEqual(onBoth({ quantity: "-1", inPart: false }));
  });

  it("as two halves of one paella is in part, each time", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      "20.00",
    );
    const first = await giveBack(saleId, "10.00", [rows[0]!.id]);
    const second = await giveBack(saleId, "10.00", [rows[0]!.id]);
    expect(await inPart(first)).toEqual(both(["Paella"]));
    expect(await inPart(second)).toEqual(both(["Paella"]));
  });

  it("as the whole of 350 g at 5.20/kg is whole", async () => {
    const { saleId, rows } = await paidBill(
      [{ menuItemId: cheeseItem, quantity: "0.350" }],
      "1.82",
    );
    expect(rows[0]).toMatchObject({ quantity: 350, lineGross: 182 });
    expect(await inPart(await giveBack(saleId, "1.82", [rows[0]!.id]))).toEqual(both([]));
  });

  it("as one kilo's money of 2 kg at 5.20/kg is in part", async () => {
    const { saleId, rows } = await paidBill([{ menuItemId: cheeseItem, quantity: "2" }], "10.40");
    expect(rows[0]).toMatchObject({ quantity: 2000, lineGross: 1040 });
    expect(await inPart(await giveBack(saleId, "5.20", [rows[0]!.id]))).toEqual(both(["Cheese"]));
  });

  // The lemonade's filed gross, 1.92, is all its set menu's part; giving back all of it negates
  // the stored gross, so the row is whole though its sold amount, gross less part, is 0.00.
  it("as the whole filed gross of a divided set menu's lemonade is whole", async () => {
    const bill = await lunchBill(spec, lunch);
    await cashContribution(venue, bill.tabId, "14.00");
    const { saleId, rows } = await filedOf(bill.tabId);
    const lemonade = rows.find((row) => row.name === "Lemonade")!;
    expect(lemonade).toMatchObject({ lineGross: 192, setMenuPart: 192 });
    const correctiveId = await giveBack(saleId, "1.92", [lemonade.id]);
    const [row] = await venue.db
      .select({ lineGross: saleLines.lineGross, correctsLineId: saleLines.correctsLineId })
      .from(saleLines)
      .where(eq(saleLines.saleId, correctiveId));
    expect(row).toEqual({ lineGross: -192, correctsLineId: lemonade.id });
    expect(await inPart(correctiveId)).toEqual(both([]));
  });

  it("as 10.00 of a 37.00 full invoice is in part, on every line", async () => {
    const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    await inTx(venue, (tx) =>
      addTabRound(tx, venue.cfg, bill.tabId, [
        { menuItemId: venue.item("Paella"), quantity: "1" },
        { menuItemId: venue.item("Burger"), quantity: "1" },
        { menuItemId: venue.item("Flan"), quantity: "1" },
      ]),
    );
    await fullInvoice(venue, bill.tabId, BAR_SOL);
    await cashContribution(venue, bill.tabId, "37.00");
    const { saleId } = await filedOf(bill.tabId);
    const correctiveId = await giveBack(saleId, "10.00");
    const [corrective] = await venue.db
      .select({ seriesPurpose: invoiceSeries.purpose, customer: sales.counterpartyTaxId })
      .from(sales)
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
      .where(eq(sales.id, correctiveId));
    expect(corrective).toEqual({ seriesPurpose: "full_corrective", customer: BAR_SOL.taxId });
    expect(await inPart(correctiveId)).toEqual(both(["Paella", "Burger", "Flan"]));
  });

  it("in a corrective of more rows than one statement may bind, each as its own gross says", async () => {
    const { rows } = await paidBill([{ menuItemId: venue.item("Paella"), quantity: "1" }], "20.00");
    const paella = rows[0]!;
    const many = Array.from({ length: SQL_VARIABLE_LIMIT + 1 }, (_, i) => ({
      id: `row-${i}`,
      correctsLineId: paella.id,
      lineGross: i % 2 === 0 ? -paella.lineGross! : -682,
    }));
    const expected = new Set(many.filter((_, i) => i % 2 === 1).map((row) => row.id));
    expect(await inTx(venue, (tx) => correctiveLinesInPart(tx, many))).toEqual(expected);
  });
});

describe("no row is given back in part", () => {
  // Reopen to split, like Cancel and credit, files its credit through `reversedLines`, which
  // negates each row's stored gross.
  it("on Reopen to split's credit of a bill with a shared free item and a divided set menu", async () => {
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
      .where(eq(saleLines.saleId, await giveBack(saleId, "6.82", [rows[0]!.id])));
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
