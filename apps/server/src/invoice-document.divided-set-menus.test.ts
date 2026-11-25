import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { kitchenCourses, printers, printJobs, products, taxpayer } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { addSetMenuDishes, createProduct, menuItems, setTakeawayVatRate } from "@waitron/menu";
import { saleId as brandSaleId } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { closeBillDeferredTx } from "./deferred-close.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { receiptFigures } from "./receipt-facts.js";
import { enqueueReceiptCopy } from "./receipt-print.js";
import { readSettledTicket, type TillSaleResult } from "./till-sale.js";
import { readOrderRevision } from "./working-order-context.js";
import { pageRows } from "./testing/invoice-page-rows.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { COMP_BILL_REASON, GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { RECIPIENT } from "./testing/deferred-close-fixture.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { inTx, type PartyVenue } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  addSpecLunch,
  groupLunchBillByHand,
  lunchBill,
  sendSpecDishes,
  setupSetMenuSpecVenue,
  specDeps,
  specRows,
  specSaleLines,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

// VAT rates piece B, S9: the full invoice of a takeaway set menu whose price was divided between
// dishes at 10% and 21% (the plan's worked example) prints the filed figures.
let spec: SpecVenue;
let venue: PartyVenue;
let lunch: SpecLunch;
/** The Lunch menu's Bread roll: a dish at 0.00, so with no weight, taken away at 21%. */
let rollItem: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

beforeAll(async () => {
  lunch = await addSpecLunch(spec);
  await inTx(venue, async (tx) => {
    for (const [dish, price] of [
      ["Soup", 550],
      ["Hake", 1250],
    ] as const)
      await tx
        .update(products)
        .set({ unitPrice: price })
        .where(eq(products.id, spec.productIds[dish]));
    // A full invoice names the seller's domicile.
    await tx
      .update(taxpayer)
      .set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" })
      .where(eq(taxpayer.id, 1));
    const roll = await createProduct(tx, {
      categoryId: null,
      name: "Bread roll",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "reduced",
      takeawayVatRate: "21.00",
    });
    const [{ id: bread }] = await tx
      .insert(kitchenCourses)
      .values({ name: "Bread", displayOrder: 40 })
      .returning({ id: kitchenCourses.id });
    await tx.update(products).set({ courseId: bread }).where(eq(products.id, roll.id));
    await addSetMenuDishes(tx, lunch.menuId, [{ productId: roll.id, excludedVariantIds: [] }]);
    const [item] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, lunch.menuId), eq(menuItems.productId, roll.id)));
    rollItem = item!.id;
    lunch.versionId = await publishWorkingMenu(tx, venue.tables.menuId);
  });
});

/** Reduces the bill's line of that name, or the whole bill for `null`. */
async function reduce(
  billId: string,
  name: string | null,
  ask: { action: "comp" } | { action: "discount_percent"; percentBp: number },
) {
  const rows = await specRows(spec, billId);
  const lineId = name === null ? null : rows.find((candidate) => candidate.name === name)!.id;
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        note: null,
        reasonId: await reasonIdOf(tx, ask.action === "comp" ? GIVE_AWAY_REASON : COMP_BILL_REASON),
        ...ask,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
}

/** A Lunch menu, with `moreItems` of it, and a Daily menu taken away: 28.00. */
async function lunchAndDailyBill(moreItems: readonly string[] = []) {
  const bill = await lunchBill(spec, lunch, lunch.versionId, moreItems);
  const daily = { ...spec.daily, versionId: lunch.versionId };
  await sendSpecDishes(spec, bill, [
    { dish: "Soup", from: daily },
    { dish: "Hake", from: daily },
  ]);
  // The grouping picks two Lunch menus, and leaves a dish at 0.00 out of both.
  await groupLunchBillByHand(spec, lunch, bill.tabId);
  return bill;
}

async function chooseFullInvoice(billId: string) {
  await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
    revision: await inTx(venue, (tx) => readOrderRevision(tx, billId)),
    invoiceType: "F1",
    recipient: RECIPIENT,
  });
}

async function payWhole(billId: string, amount: string) {
  await chooseFullInvoice(billId);
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    billId,
    {
      submissionId: crypto.randomUUID(),
      kind: "share",
      shareOf: 1,
      applied: amount,
      tip: "0.00",
      method: "cash",
      tendered: amount,
    },
    venue.operator,
  );
}

async function closeDeferred(billId: string, amount: string) {
  await chooseFullInvoice(billId);
  await inTx(venue, async (tx) =>
    closeBillDeferredTx(
      tx,
      { ...specDeps(spec), admitPartyRelease: async () => "allowed" },
      venue.cfg,
      {
        id: billId,
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        expectedEdit: await readBillEditState(tx, billId),
        expectedTotal: amount,
        invoiceType: "F1",
        recipient: RECIPIENT,
        receiptLanguage: venue.cfg.locale,
        delivery: null,
        partyFinish: null,
      },
      venue.operator.personId,
    ),
  );
}

/** A filed table's rows as the full invoice states them: item, units, price, amount, rate and
 * amount with VAT, each "" where the row has none. */
function filedRows(ticket: TillSaleResult) {
  const figures = receiptFigures({
    result: ticket,
    issuer: { venueName: "Venue", nif: "B12345678" },
    receipt: {},
    invoiceLocale: "en-GB",
  });
  expect(figures.simplified).toBe(false);
  return figures.sections.flatMap((section) =>
    section.kind === "filed"
      ? section.rows.map((row) => [
          row.item,
          row.units,
          row.unitPrice ?? "",
          row.amountExVat ?? "",
          row.rate ?? "",
          row.chargedWithVat ?? "",
        ])
      : [[section.kind]],
  );
}

/** The 80 mm full invoice's item lines, spaces collapsed: the unbroken run of lines starting with
 * a quantity, under the item table's headings. */
function itemLines(text: string): string[] {
  const lines = text.split("\n").map((line) => line.replace(/\s+/gu, " ").trim());
  const first = lines.findIndex((line) => /^Uds Concepto/u.test(line)) + 1;
  const end = lines.findIndex((line, at) => at > first && !/^\d+ /u.test(line));
  return lines.slice(first, end === -1 ? undefined : end);
}

/** The A4 page's item rows, without the euro sign. */
function a4Rows(document: Parameters<typeof pageRows>[0]): string[][] {
  return pageRows(document).map((cells) => cells.map((cell) => cell.replace(/ €$/u, "")));
}

async function both(billId: string) {
  const saleId = brandSaleId((await specSaleLines(spec, billId))[0]!.saleId);
  const settled = await inTx(venue, (tx) =>
    readSettledTicket(venue.backend, tx, venue.cfg, billId),
  );
  const document = await inTx(venue, (tx) =>
    readInvoiceDocument(venue.backend, tx, venue.cfg, saleId),
  );
  const [{ id: printerId }] = await venue.db.select({ id: printers.id }).from(printers);
  const queued = await inTx(venue, (tx) =>
    enqueueReceiptCopy(tx, venue.cfg, settled, saleId, {
      id: printerId!,
      paperWidth: "80mm",
      resolution: "203dpi",
    }),
  );
  const [job] = await venue.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.id, queued!.jobId));
  return { settled, document, printed: decodeTicket(job!.payload) };
}

const DIVIDED_FIGURES = [
  ["Soup", "1", "3.25", "3.25", "10.00", "3.58"],
  ["Hake", "1", "7.40", "7.40", "10.00", "8.14"],
  ["Lemonade", "1", "1.88", "1.88", "21.00", "2.28"],
  ["Lunch menu", "1", "", "", "", ""],
];
const DIVIDED_PAGE = [
  ["Soup", "1", "3,25", "3,25", "10%", "3,58"],
  ["Hake", "1", "7,40", "7,40", "10%", "8,14"],
  ["Lemonade", "1", "1,88", "1,88", "21%", "2,28"],
  ["Lunch menu", "1", "", "", "", ""],
];
const DIVIDED_VAT = [
  { rate: "10.00", base: "10.65", tax: "1.07" },
  { rate: "21.00", base: "1.88", tax: "0.40" },
];

describe("the full invoice of a takeaway set menu divided between 10% and 21%", () => {
  it.each([
    ["issued at payment", payWhole],
    ["issued at a deferred close", closeDeferred],
  ] as const)(
    "prints the set menu as a heading and each dish's part, base and rate: %s",
    async (_path, issue) => {
      const bill = await lunchBill(spec, lunch);
      await issue(bill.tabId, "14.00");
      const { settled, document, printed } = await both(bill.tabId);
      expect(itemLines(printed)).toEqual([
        "1 Soup 3,25 3,25 10%",
        "1 Hake 7,40 7,40 10%",
        "1 Lemonade 1,88 1,88 21%",
        "1 Lunch menu",
      ]);
      expect(settled.invoiceType).toBe("F1");
      expect(filedRows(settled)).toEqual(DIVIDED_FIGURES);
      expect(settled.vatBreakdown).toEqual(DIVIDED_VAT);
      expect(settled.total).toBe("14.00");
      expect(filedRows(document.result as TillSaleResult)).toEqual(DIVIDED_FIGURES);
      expect(a4Rows(document)).toEqual(DIVIDED_PAGE);
    },
  );

  it("with 10% off the set menu, prints no discount row and parts of the 12.60 charged", async () => {
    const bill = await lunchBill(spec, lunch);
    await reduce(bill.tabId, "Lunch menu", { action: "discount_percent", percentBp: 1000 });
    await payWhole(bill.tabId, "12.60");
    const { settled, document } = await both(bill.tabId);
    const expected = [
      ["Soup", "1", "2.93", "2.93", "10.00", "3.22"],
      ["Hake", "1", "6.66", "6.66", "10.00", "7.33"],
      ["Lemonade", "1", "1.69", "1.69", "21.00", "2.05"],
      ["Lunch menu", "1", "", "", "", ""],
    ];
    expect(filedRows(settled)).toEqual(expected);
    expect(filedRows(document.result as TillSaleResult)).toEqual(expected);
    expect(a4Rows(document)).toEqual([
      ["Soup", "1", "2,93", "2,93", "10%", "3,22"],
      ["Hake", "1", "6,66", "6,66", "10%", "7,33"],
      ["Lemonade", "1", "1,69", "1,69", "21%", "2,05"],
      ["Lunch menu", "1", "", "", "", ""],
    ]);
    expect(settled.total).toBe("12.60");
  });

  it("prints one plain discount under a soup whose 21% bread extra is made free", async () => {
    const breadId = spec.bread.picks[0]!.productId;
    await inTx(venue, (tx) => setTakeawayVatRate(tx, breadId, "21.00"));
    try {
      const bill = await lunchBill(spec, lunch, lunch.versionId, [], [spec.bread]);
      await reduce(bill.tabId, "Bread", { action: "comp" });
      await payWhole(bill.tabId, "14.00");
      const { settled, document } = await both(bill.tabId);
      expect(a4Rows(document)).toEqual([
        ["Soup", "1", "2,95", "2,95", "10%", "3,24"],
        ["Bread", "1", "1,24", "1,24", "21%", "1,50"],
        ["Descuento", "", "", "-0,12", "21%", "-0,15"],
        ["Hake", "1", "6,68", "6,68", "10%", "7,35"],
        ["Lemonade", "1", "1,70", "1,70", "21%", "2,06"],
        ["Lunch menu", "1", "", "", "", ""],
      ]);
      expect(settled.total).toBe("14.00");
    } finally {
      await inTx(venue, (tx) => setTakeawayVatRate(tx, breadId, "10.00"));
    }
  });

  // The free Lunch menu holds half the 12.60 paid, so the Daily menu loses 7.70 of its 14.00.
  it("made free, leaves 10% off the bill plain", async () => {
    const bill = await lunchAndDailyBill();
    await reduce(bill.tabId, "Lunch menu", { action: "comp" });
    await reduce(bill.tabId, null, { action: "discount_percent", percentBp: 1000 });
    await payWhole(bill.tabId, "12.60");
    const { settled, document, printed } = await both(bill.tabId);
    const expected = [
      ["Soup", "1", "1.46", "1.46", "10.00", "1.61"],
      ["Hake", "1", "3.33", "3.33", "10.00", "3.66"],
      ["Lemonade", "1", "0.85", "0.85", "21.00", "1.03"],
      ["Lunch menu", "1", "", "", "", ""],
      ["Daily menu", "1", "12.73", "12.73", "10.00", "14.00"],
      ["Discount", "", "", "-7.00", "10.00", "-7.70"],
    ];
    expect(filedRows(document.result as TillSaleResult)).toEqual(expected);
    expect(filedRows(settled)).toEqual(expected);
    expect(a4Rows(document)).toEqual([
      ["Soup", "1", "1,46", "1,46", "10%", "1,61"],
      ["Hake", "1", "3,33", "3,33", "10%", "3,66"],
      ["Lemonade", "1", "0,85", "0,85", "21%", "1,03"],
      ["Lunch menu", "1", "", "", "", ""],
      ["Daily menu", "1", "12,73", "12,73", "10%", "14,00"],
      ["Descuento", "", "", "-7,00", "10%", "-7,70"],
    ]);
    expect(printed.replace(/\s+/gu, " ")).toContain("Descuento -7,00 10%");
    expect(settled.total).toBe("12.60");
  });

  it("made free with nothing off the bill, prints the Daily menu's loss under it", async () => {
    const bill = await lunchAndDailyBill();
    await reduce(bill.tabId, "Lunch menu", { action: "comp" });
    await payWhole(bill.tabId, "14.00");
    const { settled, document } = await both(bill.tabId);
    const expected = [
      ["Soup", "1", "1.63", "1.63", "10.00", "1.79"],
      ["Hake", "1", "3.70", "3.70", "10.00", "4.07"],
      ["Lemonade", "1", "0.94", "0.94", "21.00", "1.14"],
      ["Lunch menu", "1", "", "", "", ""],
      ["Daily menu", "1", "12.73", "12.73", "10.00", "14.00"],
      ["Discount", "", "", "-6.37", "10.00", "-7.00"],
    ];
    expect(filedRows(document.result as TillSaleResult)).toEqual(expected);
    expect(filedRows(settled)).toEqual(expected);
  });

  it.each([
    ["half off", 5000, "18.90"],
    ["at its full price", undefined, "25.20"],
  ] as const)("%s, keeps 10% off the bill's words", async (_name, percentBp, amount) => {
    const bill = await lunchAndDailyBill();
    if (percentBp !== undefined)
      await reduce(bill.tabId, "Lunch menu", { action: "discount_percent", percentBp });
    await reduce(bill.tabId, null, { action: "discount_percent", percentBp: 1000 });
    await payWhole(bill.tabId, amount);
    const { settled, document } = await both(bill.tabId);
    for (const ticket of [settled, document.result as TillSaleResult])
      expect(filedRows(ticket).slice(-2)).toEqual([
        ["Daily menu", "1", "12.73", "12.73", "10.00", "14.00"],
        ["Discount 10%", "", "", "-1.28", "10.00", "-1.40"],
      ]);
  });

  it("leaves out a dish that files 0.00 in its divided set menu when a one-rate set menu is on the same bill", async () => {
    const bill = await lunchAndDailyBill([rollItem]);
    await payWhole(bill.tabId, "28.00");
    const { settled, document } = await both(bill.tabId);
    const expected = [...DIVIDED_FIGURES, ["Daily menu", "1", "12.73", "12.73", "10.00", "14.00"]];
    expect(filedRows(settled)).toEqual(expected);
    expect(filedRows(document.result as TillSaleResult)).toEqual(expected);
  });

  it("prints a set menu whose dishes share one rate as today (control)", async () => {
    await inTx(venue, (tx) => setTakeawayVatRate(tx, lunch.lemonadeId, "10.00"));
    try {
      const bill = await lunchBill(spec, lunch);
      await payWhole(bill.tabId, "14.00");
      const { settled, document } = await both(bill.tabId);
      const expected = [["Lunch menu", "1", "12.73", "12.73", "10.00", "14.00"]];
      expect(filedRows(settled)).toEqual(expected);
      expect(filedRows(document.result as TillSaleResult)).toEqual(expected);
    } finally {
      await inTx(venue, (tx) => setTakeawayVatRate(tx, lunch.lemonadeId, "21.00"));
    }
  });
});
