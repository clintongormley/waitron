import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  products,
  productTakeawayVatRates,
  readVenueClock,
  sales,
  taxpayer,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { createPinThrottle } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { setTakeawayVatRate } from "@waitron/menu";
import {
  decimal,
  decimalToCents,
  saleId as brandSaleId,
  sumDecimals,
  type Dining,
} from "@waitron/shared";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import { closeOfDayConfig, issueBillAtClose } from "./close-of-day.js";
import { closeBillDeferredTx } from "./deferred-close.js";
import { splitAfterPrint } from "./split-after-print.js";
import { recordUnpaidDeparture } from "./unpaid-departure.js";
import { issueIfFullyPaid, type BillPaymentRequest } from "./bill-payments.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { readBillEditState } from "./bill-editing.js";
import { setOrderInvoiceChoice } from "./working-order-invoice.js";
import { priceStoredOrderForIssuance } from "./stored-order-lines.js";
import { readOrderRevision } from "./working-order-context.js";
import { takeBillPayment, takeReaderBillPayment } from "./testing/bill-payment-fixture.js";
import {
  cashContribution,
  billRow,
  inTx,
  order,
  paymentsOf,
  placeByHand,
  revisionOf,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  capturedCardPayment,
  saveSetMenuDraft,
  seedBillSetMenu,
} from "./testing/set-menu-bill-fixture.js";
import { RECIPIENT } from "./testing/deferred-close-fixture.js";
import {
  addSpecLunch,
  saveSpecDishes,
  sendSpecDraft,
  serveSpecBill,
  specDeps,
  printSpecBill,
  setupSetMenuSpecVenue,
  specBill,
  specRows,
  specSaleLines,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { cancelItemForTest, cancelLine } from "./testing/cancel-line.js";
import { REASONS } from "./testing/adjustment-venue.js";

let spec: SpecVenue;
let venue: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

const deps = () => ({
  db: venue.db,
  backend: venue.backend,
  clock: venue.clock,
  admission: testTradingAdmission(),
});

async function seatedBill(dining: Dining = "eat_in") {
  const seated = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  if (dining === "takeaway")
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, seated.tabId)),
    );
  return seated;
}

/** A Burger, and a Daily menu at line 2 unless `withSetMenu` is false: 26.00. */
async function bill(withSetMenu = true, dining: Dining = "eat_in") {
  const { tabId } = await seatedBill(dining);
  await order(venue, tabId, "Burger");
  if (withSetMenu) await inTx(venue, (tx) => seedBillSetMenu(tx, tabId, spec.daily, 2));
  return tabId;
}

function setMenuRows(billId: string) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, billId), isNotNull(workingOrderLines.setMenuRole)),
    )
    .orderBy(workingOrderLines.lineNo);
}

function wholePayment(applied = "26.00") {
  return {
    submissionId: crypto.randomUUID(),
    kind: "share",
    shareOf: 1,
    applied,
    tip: "0.00",
  } as const;
}

function printBill(partyId: string, billId: string) {
  return printSpecBill(spec, partyId, billId);
}

async function adjustmentArgs(
  id: string,
  lineNo: number,
  action: "comp" | "discount_percent" | "discount_amount",
) {
  const reason = await inTx(venue, (tx) =>
    createAdjustmentReason(tx, { ...REASONS.house, name: `House ${crypto.randomUUID()}` }),
  );
  return inTx(venue, async (tx) => {
    const [line] = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, lineNo)));
    return {
      orderId: id,
      expectedEdit: await readBillEditState(tx, id),
      submissionId: crypto.randomUUID(),
      expectedRevision: await readOrderRevision(tx, id),
      lineId: line!.id,
      reasonId: reason.id,
      note: null,
      operatorId: venue.operator.personId,
      action,
      ...(action === "discount_percent" ? { percentBp: 1000 } : {}),
      ...(action === "discount_amount" ? { amount: decimal("2.00") } : {}),
    };
  });
}

function applyArgs(args: Awaited<ReturnType<typeof adjustmentArgs>>) {
  return inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...args, admission: testTradingAdmission() },
      venue.cfg.locale,
    ),
  );
}

it("builds the spec bill: 3 Daily and 1 Special with their dishes placed, 72.00 in all", async () => {
  const tab = await specBill(spec);
  const rows = await specRows(spec, tab.tabId);
  const dishes = rows.filter(({ setMenuRole }) => setMenuRole === "dish");
  expect(
    dishes.map(({ name, setMenuLineId, setMenuPlace, unitPriceGross }) => [
      name,
      setMenuLineId,
      setMenuPlace,
      unitPriceGross,
    ]),
  ).toEqual([
    ["Soup", tab.daily[0], 0, 0],
    ["Soup", tab.daily[1], 0, 0],
    ["Soup", tab.daily[2], 0, 0],
    ["Soup", tab.special[0], 0, 0],
    ["Hake", tab.daily[0], 1, 0],
    ["Sea bass", tab.special[0], 1, 0],
    ["Sirloin", tab.daily[1], 1, 500],
    ["Sirloin", tab.daily[2], 1, 500],
  ]);
  expect(
    rows
      .filter(({ setMenuRole }) => setMenuRole === "set_menu")
      .map(({ name, unitPriceGross }) => [name, unitPriceGross]),
  ).toEqual([
    ["Daily menu", 1400],
    ["Daily menu", 1400],
    ["Daily menu", 1400],
    ["Special menu", 2000],
  ]);
  expect(rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(7200);
});

type Ask = Omit<BillPaymentRequest, "submissionId" | "tip" | "expectedEdit">;

const kinds: Record<"items" | "contribution" | "share" | "cash" | "card", (lineNo: number) => Ask> =
  {
    items: (lineNo: number) => ({
      kind: "items",
      lines: [{ lineNo }],
      method: "cash",
      tendered: "14.00",
      applied: "14.00",
    }),
    contribution: () => ({
      kind: "contribution",
      amount: "10.00",
      method: "cash",
      tendered: "10.00",
      applied: "10.00",
    }),
    share: () => ({
      kind: "share",
      shareOf: 2,
      method: "cash",
      tendered: "36.00",
      applied: "36.00",
    }),
    cash: () => ({ ...wholePayment("72.00"), method: "cash", tendered: "72.00" }),
    card: () => ({ ...wholePayment("72.00"), method: "card", entry: "manual" }),
  };

it.each(Object.keys(kinds) as (keyof typeof kinds)[])(
  "a set-menu bill takes each kind of bill payment: %s",
  async (kind) => {
    const tab = await specBill(spec);
    const before = await setMenuRows(tab.tabId);
    const dailyLineNo = before.find(({ id }) => id === tab.daily[0])!.lineNo;
    const request = kinds[kind](dailyLineNo);
    await takeBillPayment(
      deps(),
      venue.cfg,
      tab.tabId,
      { submissionId: crypto.randomUUID(), tip: "0.00", ...request },
      venue.operator,
    );
    expect(await paymentsOf(venue, tab.tabId)).toMatchObject([
      { state: "received", applied: Math.round(Number(request.applied) * 100) },
    ]);
    expect(await setMenuRows(tab.tabId)).toEqual(before);
  },
);

it("a part payment on a printed set-menu bill is taken and writes no line", async () => {
  const tab = await specBill(spec);
  await printBill(tab.partyId, tab.tabId);
  const before = await specRows(spec, tab.tabId);
  const paymentId = await cashContribution(venue, tab.tabId, "10.00");
  expect(await paymentsOf(venue, tab.tabId)).toMatchObject([
    { id: paymentId, applied: 1000, state: "received" },
  ]);
  expect(await specRows(spec, tab.tabId)).toEqual(before);
});

it("a dish added after a payment is placed as any dish is", async () => {
  const tab = await specBill(spec);
  await cashContribution(venue, tab.tabId, "10.00");
  const draft = await saveSpecDishes(spec, tab, [
    { dish: "Soup", from: spec.special },
    { dish: "Sea bass", from: spec.special },
  ]);
  const before = await specRows(spec, tab.tabId);
  await sendSpecDraft(spec, tab.partyId, draft.id);
  const after = await specRows(spec, tab.tabId);
  expect(after.slice(0, before.length)).toEqual(before);
  const added = after.slice(before.length);
  const second = added.find(({ setMenuRole }) => setMenuRole === "set_menu")?.id;
  expect(added).toMatchObject([
    {
      name: "Soup",
      setMenuRole: "dish",
      setMenuLineId: second,
      setMenuPlace: 0,
      unitPriceGross: 0,
      lineTotal: 0,
    },
    {
      name: "Sea bass",
      setMenuRole: "dish",
      setMenuLineId: second,
      setMenuPlace: 1,
      unitPriceGross: 0,
      lineTotal: 0,
    },
    {
      setMenuRole: "set_menu",
      setMenuId: spec.special.menuId,
      unitPriceGross: 2000,
      lineTotal: 2000,
    },
  ]);
  expect(second).toBeDefined();
  expect(after.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(9200);
});

it.each(["takeaway", "eat_in"] as const)(
  "a takeaway set-menu bill takes money, as the same bill eaten here does: %s",
  async (dining) => {
    const daily = async () => {
      const seated = await seatedBill(dining);
      await order(venue, seated.tabId, "Burger");
      await inTx(venue, (tx) => seedBillSetMenu(tx, seated.tabId, spec.daily, 2));
      return seated;
    };
    const outcome = (attempt: Promise<unknown>) =>
      attempt.then(
        () => "accepted",
        (error: { code?: string }) => error.code,
      );
    const paid = await daily();
    expect(await outcome(cashContribution(venue, paid.tabId, "5.00"))).toBe("accepted");
    const comped = await daily();
    expect(await outcome(applyArgs(await adjustmentArgs(comped.tabId, 1, "comp")))).toBe(
      "accepted",
    );
    const printed = await daily();
    expect(await outcome(printBill(printed.partyId, printed.tabId))).toBe("accepted");

    expect(await paymentsOf(venue, paid.tabId)).toHaveLength(1);
    expect(
      await venue.db
        .select({ id: adjustments.id })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, comped.tabId)),
    ).toHaveLength(1);
    expect((await billRow(venue, printed.tabId)).status).toBe("placed");
  },
);

it("can still price money already captured", async () => {
  const id = await bill();
  const { gross } = await inTx(venue, (tx) =>
    priceStoredOrderForIssuance(tx, id, { refuseUnsentUnavailable: false }),
  );
  expect(gross.total).toBe("26.00");
});

it("still accepts a contribution on a bill without set menus", async () => {
  const id = await bill(false);
  const paymentId = await cashContribution(venue, id, "5.00");
  expect(await paymentsOf(venue, id)).toMatchObject([
    { id: paymentId, applied: 500, state: "received" },
  ]);
});

/** Each stored line of the bill against each line of the sale it filed: name, quantity, gross and
 * set-menu role; and the sale's total, 72.00. */
async function expectFiledAsStored(billId: string) {
  const stored = (await specRows(spec, billId)).map(
    ({ name, quantity, lineTotal, setMenuRole }) => [name, quantity, lineTotal, setMenuRole],
  );
  const filed = (await specSaleLines(spec, billId)).map(
    ({ name, quantity, lineGross, setMenuRole }) => [name, quantity, lineGross, setMenuRole],
  );
  expect(stored).toHaveLength(12);
  expect(filed).toEqual(stored);
  const [sale] = await venue.db
    .select({ total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, billId));
  expect(sale!.total).toBe(7200);
}

async function payAtReader(
  billId: string,
  total = "72.00",
  provider = new FakePaymentProvider(venue.db),
) {
  await takeReaderBillPayment(
    { ...deps(), provider },
    venue.cfg,
    billId,
    { ...wholePayment(total), method: "card", entry: "reader" },
    venue.operator,
  );
  expect(provider.collectCalls).toHaveLength(1);
}

async function payWhole(
  billId: string,
  total = "72.00",
  request: Parameters<typeof takeBillPayment>[3] = {
    ...wholePayment(total),
    method: "cash",
    tendered: total,
  },
) {
  await takeBillPayment(deps(), venue.cfg, billId, request, venue.operator);
  expect(await paymentsOf(venue, billId)).toMatchObject([
    { applied: decimalToCents(decimal(total)), state: "received" },
  ]);
}

type Path = (tab: { partyId: string; tabId: string }, total: string) => Promise<void>;

const paths: Record<string, Path> = {
  "whole by cash": ({ tabId }, total) => payWhole(tabId, total),
  "whole by hand-keyed card": ({ tabId }, total) =>
    payWhole(tabId, total, { ...wholePayment(total), method: "card", entry: "manual" }),
  "whole at the reader": ({ tabId }, total) => payAtReader(tabId, total),
  "placed, then collected": async ({ tabId }, total) => {
    await placeByHand(venue, tabId);
    await payWhole(tabId, total);
  },
  "placed, then collected at the reader": async ({ tabId }, total) => {
    await placeByHand(venue, tabId);
    await payAtReader(tabId, total);
  },
  "unpaid departure": async ({ partyId, tabId }) => {
    const expectedPartyRevision = await revisionOf(venue, partyId);
    await inTx(venue, async (tx) =>
      recordUnpaidDeparture(
        tx,
        deps(),
        venue.cfg,
        partyId,
        {
          billId: tabId,
          expectedPartyRevision,
          expectedEdits: [await readBillEditState(tx, tabId)],
          reason: "Left before paying",
        },
        { ...venue.operator, attempts: { throttle: createPinThrottle(), slot: "departure" } },
      ),
    );
    expect(await revisionOf(venue, partyId)).toBeGreaterThan(expectedPartyRevision);
  },
  "deferred close": ({ tabId }, total) => closeDeferred(tabId, total, "F2"),
  "Print the bill": async ({ partyId, tabId }) => {
    await printBill(partyId, tabId);
    expect((await billRow(venue, tabId)).status).toBe("placed");
  },
};

async function closeDeferred(tabId: string, total: string, invoiceType: "F1" | "F2") {
  if (invoiceType === "F1")
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, tabId, {
      revision: await inTx(venue, (tx) => readOrderRevision(tx, tabId)),
      invoiceType,
      recipient: RECIPIENT,
      operatorId: venue.operator.personId,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, tabId)),
    });
  await inTx(venue, async (tx) =>
    closeBillDeferredTx(
      tx,
      { ...deps(), admitPartyRelease: async () => "allowed" },
      venue.cfg,
      {
        id: tabId,
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, tabId),
        expectedEdit: await readBillEditState(tx, tabId),
        expectedTotal: total,
        invoiceType,
        recipient: invoiceType === "F1" ? RECIPIENT : null,
        receiptLanguage: venue.cfg.locale,
        delivery: null,
        partyFinish: null,
      },
      venue.operator.personId,
    ),
  );
  expect((await billRow(venue, tabId)).status).not.toBe("open");
}

/** {@link paths}, and the paths that issue a bill without a payment taken at the till. */
const issuingPaths: Record<string, Path> = {
  ...paths,
  "close of day": async ({ tabId }) => {
    const outcome = await inTx(venue, async (tx) =>
      issueBillAtClose(
        tx,
        deps(),
        closeOfDayConfig(venue.cfg),
        tabId,
        // Every bill opened so far counts as due.
        { dayStartedAt: new Date("2999-01-01T00:00:00Z"), venueClock: await readVenueClock(tx) },
      ),
    );
    expect(outcome.kind).toBe("issued");
  },
  "deferred close with a full invoice": ({ tabId }, total) => closeDeferred(tabId, total, "F1"),
  "a captured card": async ({ tabId }, total) => {
    await inTx(venue, (tx) => capturedCardPayment(tx, venue, tabId, total));
    const result = await settlePendingBillPayments({ ...deps(), cfg: venue.cfg });
    expect(result).toMatchObject({ received: 1, pending: 0, errors: [] });
  },
};

it.each(Object.keys(paths))(
  "a set-menu bill is paid whole or issued through each path: %s",
  async (path) => {
    const tab = await specBill(spec, "fire");
    await paths[path]!(tab, "72.00");
    await expectFiledAsStored(tab.tabId);
  },
);

it.each(["comp", "discount_percent", "discount_amount"] as const)(
  "previews and applies %s on a set-menu bill",
  async (action) => {
    const id = await bill();
    const args = await adjustmentArgs(id, 1, action);
    await inTx(venue, (tx) => previewAdjustment(tx, args, venue.cfg.locale));
    await applyArgs(args);
    expect(
      await venue.db
        .select({ id: adjustments.id })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, id)),
    ).toHaveLength(1);
  },
);

it("still lets staff cancel a dish on a set-menu bill", async () => {
  const id = await bill();
  const { adjustmentIds } = await inTx(venue, (tx) =>
    cancelLine(tx, venue.cfg, id, 1, undefined, venue.operator.personId),
  );
  expect(adjustmentIds).toHaveLength(1);
});

it("keeps the cancellation when what a takeaway bill keeps, its set menu worked out away, matches cash already received", async () => {
  const id = await bill(false, "takeaway");
  await order(venue, id, "Paella");
  // The cancel works the bill out again, and the Burger alone fills no set menu.
  const paymentId = await cashContribution(venue, id, "12.00");
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, spec.daily, 3));

  const invoice = await inTx(venue, async (tx) => {
    await cancelItemForTest(tx, venue.cfg, id, 2, undefined, venue.operator.personId);
    return issueIfFullyPaid(tx, deps(), venue.cfg, id, venue.operator.personId);
  });
  expect(invoice).toMatchObject({ total: "12.00" });
  expect((await billRow(venue, id)).status).toBe("settled");
  expect(await paymentsOf(venue, id)).toMatchObject([
    { id: paymentId, applied: 1200, state: "received" },
  ]);
  const lines = await venue.db
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  expect(lines).toEqual([{ lineNo: 1 }]);
  expect(
    await venue.db.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, id)),
  ).toEqual([{ total: 1200 }]);
});

it("recovers a captured card payment that covers the whole set-menu bill without another charge", async () => {
  const id = await bill();
  const paymentId = await inTx(venue, (tx) => capturedCardPayment(tx, venue, id));
  const result = await settlePendingBillPayments({ ...deps(), cfg: venue.cfg });
  expect(result).toMatchObject({ received: 1, pending: 0, errors: [] });
  expect(await paymentsOf(venue, id)).toMatchObject([
    { id: paymentId, state: "received", applied: 2600 },
  ]);
  const billed = await venue.db
    .select({ id: sales.id, total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, id));
  expect(billed).toEqual([{ id: expect.any(String), total: 2600 }]);
  expect(
    await venue.db
      .select({ state: payments.state, saleId: payments.saleId })
      .from(payments)
      .where(eq(payments.workingOrderId, id)),
  ).toEqual([{ state: "captured", saleId: billed[0]!.id }]);
});

describe("a takeaway set menu whose dishes' rates differ", () => {
  let lunch: SpecLunch;
  let saved: {
    rates: (typeof productTakeawayVatRates.$inferSelect)[];
    domicile: string | null;
  };
  const dishIds = () => [spec.productIds.Soup, spec.productIds.Hake];
  beforeAll(async () => {
    saved = await inTx(venue, async (tx) => ({
      rates: await tx
        .select()
        .from(productTakeawayVatRates)
        .where(inArray(productTakeawayVatRates.productId, dishIds())),
      domicile: (await tx.select({ domicile: taxpayer.taxpayerDomicile }).from(taxpayer))[0]!
        .domicile,
    }));
    lunch = await addSpecLunch(spec);
    // A full invoice names the seller's domicile.
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
  });
  afterAll(() =>
    inTx(venue, async (tx) => {
      await tx
        .delete(productTakeawayVatRates)
        .where(inArray(productTakeawayVatRates.productId, dishIds()));
      if (saved.rates.length > 0) await tx.insert(productTakeawayVatRates).values(saved.rates);
      await tx.update(taxpayer).set({ taxpayerDomicile: saved.domicile });
    }),
  );
  beforeEach(() => pricedAt({ Soup: 550, Hake: 1250 }));
  afterEach(async () => {
    await pricedAt({ Soup: 600, Hake: 1600 });
    await lemonadeAt("21.00");
  });

  function pricedAt(prices: Record<"Soup" | "Hake", number>) {
    return inTx(venue, async (tx) => {
      for (const dish of ["Soup", "Hake"] as const)
        await tx
          .update(products)
          .set({ unitPrice: prices[dish] })
          .where(eq(products.id, spec.productIds[dish]));
    });
  }

  function lemonadeAt(rate: string | null) {
    return inTx(venue, async (tx) => {
      if (rate === null)
        await tx
          .delete(productTakeawayVatRates)
          .where(eq(productTakeawayVatRates.productId, lunch.lemonadeId));
      else await setTakeawayVatRate(tx, lunch.lemonadeId, rate);
    });
  }

  /** A bill set to take away as it is seated, holding a Lunch menu with Soup, Hake and Lemonade
   * sent from it, fired unless told: 14.00. */
  async function lunchBill(release: "hold" | "fire" = "fire") {
    const bill = await seatedBill("takeaway");
    const draft = await saveSetMenuDraft(
      venue,
      bill,
      ...(["Soup", "Hake", "Lemonade"] as const).map((dish) => ({
        menuItemId: lunch.items[dish],
        menuVersionId: lunch.versionId,
        setMenuId: lunch.menuId,
        quantity: "1",
      })),
    );
    await sendSpecDraft(spec, bill.partyId, draft.id, release);
    return bill;
  }

  /** The sale's lines (name, gross, rate, set-menu part), its total, the VAT breakdown it filed and
   * its record's VAT. */
  async function filed(billId: string, saleId?: string) {
    const lines = await specSaleLines(spec, billId, saleId);
    const [sale] = await venue.db
      .select({ total: sales.total, vat: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, lines[0]!.saleId));
    const id = brandSaleId(lines[0]!.saleId);
    // Readable only while the record's VAT and total fields agree with its breakdown.
    const record = (await inTx(venue, (tx) => venue.backend.filedFiguresFor!(tx, [id]))).get(id);
    expect(record?.readable).toBe(true);
    if (record?.readable !== true) throw new Error("the sale's record is unreadable");
    return {
      rows: lines.map(({ name, lineGross, vatRate, setMenuPart }) => [
        name,
        lineGross,
        vatRate,
        setMenuPart,
      ]),
      total: sale!.total,
      vat: sale!.vat,
      recordVat: sumDecimals(record.newest.vatBreakdown.map((line) => line.tax)),
    };
  }

  // The plan's worked example.
  const DIVIDED = {
    rows: [
      ["Lunch menu", 0, 1000, -1400],
      ["Soup", 358, 1000, 358],
      ["Hake", 814, 1000, 814],
      ["Lemonade", 228, 2100, 228],
    ],
    total: 1400,
    vat: [
      { rate: "10.00", base: "10.65", tax: "1.07" },
      { rate: "21.00", base: "1.88", tax: "0.40" },
    ],
    recordVat: "1.47",
  };
  // S3: every dish at 10%, so the set menu files its whole price.
  const WHOLE = {
    rows: [
      ["Lunch menu", 1400, 1000, null],
      ["Soup", 0, 1000, null],
      ["Hake", 0, 1000, null],
      ["Lemonade", 0, 1000, null],
    ],
    total: 1400,
    vat: [{ rate: "10.00", base: "12.73", tax: "1.27" }],
    recordVat: "1.27",
  };

  describe.each([
    ["21.00", DIVIDED],
    ["10.00", WHOLE],
  ])("with Lemonade taken away at %s", (rate, expected) => {
    it.each(Object.keys(issuingPaths))("is issued through each path: %s", async (path) => {
      await lemonadeAt(rate);
      const tab = await lunchBill();
      await issuingPaths[path]!(tab, "14.00");
      expect(await filed(tab.tabId)).toEqual(expected);
    });
  });

  it.each(["cash", "hand-keyed", "reader"] as const)(
    "a bill printed before its rates changed is paid as printed: %s",
    async (method) => {
      await lemonadeAt("10.00");
      const tab = await lunchBill();
      await printBill(tab.partyId, tab.tabId);
      expect(await filed(tab.tabId)).toEqual(WHOLE);
      await lemonadeAt("21.00");

      if (method === "reader") await payAtReader(tab.tabId, "14.00");
      else
        await payWhole(
          tab.tabId,
          "14.00",
          method === "cash"
            ? { ...wholePayment("14.00"), method: "cash", tendered: "14.00" }
            : { ...wholePayment("14.00"), method: "card", entry: "manual" },
        );

      expect((await billRow(venue, tab.tabId)).status).toBe("settled");
      expect(await filed(tab.tabId)).toEqual(WHOLE);
    },
  );

  it("a split after printing credits what was filed and divides the new bill at its own rates", async () => {
    await lemonadeAt("10.00");
    const tab = await lunchBill();
    await serveSpecBill(spec, tab.partyId, tab.tabId);
    const { saleId } = await printBill(tab.partyId, tab.tabId);
    await lemonadeAt("21.00");

    const { billId } = await splitAfterPrint(specDeps(spec), venue.cfg, tab.tabId, {
      ...venue.operator,
      attempts: { throttle: createPinThrottle(), slot: "split" },
    });
    const [credit] = await venue.db
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.correctsSaleId, saleId!));
    expect(await filed(tab.tabId, credit!.id)).toEqual({
      rows: [
        ["Lunch menu", -1400, 1000, null],
        ["Soup", 0, 1000, null],
        ["Hake", 0, 1000, null],
        ["Lemonade", 0, 1000, null],
      ],
      total: -1400,
      vat: [{ rate: "10.00", base: "-12.73", tax: "-1.27" }],
      recordVat: "-1.27",
    });

    await payWhole(billId, "14.00");
    expect(await filed(billId)).toEqual(DIVIDED);
  });

  it("a covered dish whose set menu is on another bill files at a rate the ticket pays", async () => {
    const lunchTab = await lunchBill();
    const paying = await seatedBill("takeaway");
    await order(venue, paying.tabId, "Burger");
    const lemonade = (await specRows(spec, lunchTab.tabId)).find(
      ({ name }) => name === "Lemonade",
    )!;
    const [burger] = await specRows(spec, paying.tabId);
    // No staff action found leaves this state: the link is set directly.
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ workingOrderId: paying.tabId, lineNo: burger!.lineNo + 1 })
        .where(eq(workingOrderLines.id, lemonade.id)),
    );
    await payWhole(paying.tabId, "12.00");
    expect(await filed(paying.tabId)).toEqual({
      rows: [
        ["Burger", 1200, 1000, null],
        ["Lemonade", 0, 1000, null],
      ],
      total: 1200,
      vat: [{ rate: "10.00", base: "10.91", tax: "1.09" }],
      recordVat: "1.09",
    });
  });

  it("a set menu none of whose dishes has a rate refuses on its first dish's row", async () => {
    await lemonadeAt(null);
    await inTx(venue, (tx) =>
      tx
        .delete(productTakeawayVatRates)
        .where(inArray(productTakeawayVatRates.productId, dishIds())),
    );
    try {
      const tab = await lunchBill();
      await expect(
        takeBillPayment(
          deps(),
          venue.cfg,
          tab.tabId,
          { ...wholePayment("14.00"), method: "cash", tendered: "14.00" },
          venue.operator,
        ),
      ).rejects.toMatchObject({ code: "vat_rate.unavailable", params: { lineNo: 2 } });
    } finally {
      await inTx(venue, (tx) => tx.insert(productTakeawayVatRates).values(saved.rates));
    }
  });

  it("part paid, then a rate changed, then paid, issues the division at the new rate", async () => {
    await lemonadeAt("10.00");
    const tab = await lunchBill();
    await cashContribution(venue, tab.tabId, "5.00");
    await lemonadeAt("21.00");
    await cashContribution(venue, tab.tabId, "9.00");
    expect((await billRow(venue, tab.tabId)).status).toBe("settled");
    expect(await filed(tab.tabId)).toEqual(DIVIDED);
  });

  it("cash that covers the bill after a cancel issues it", async () => {
    const tab = await lunchBill();
    await order(venue, tab.tabId, "Burger");
    const burger = (await specRows(spec, tab.tabId)).find(({ name }) => name === "Burger")!;
    await cashContribution(venue, tab.tabId, "14.00");
    const invoice = await inTx(venue, async (tx) => {
      await cancelItemForTest(
        tx,
        venue.cfg,
        tab.tabId,
        burger.lineNo,
        undefined,
        venue.operator.personId,
      );
      return issueIfFullyPaid(tx, deps(), venue.cfg, tab.tabId, venue.operator.personId);
    });
    expect(invoice).not.toBeNull();
    expect(await filed(tab.tabId)).toEqual(DIVIDED);
  });

  it("a rate saved while the reader collects files the division", async () => {
    await lemonadeAt("10.00");
    const tab = await lunchBill();
    const provider = new FakePaymentProvider(venue.db);
    const release = provider.holdNextCollect();
    const paid = payAtReader(tab.tabId, "14.00", provider);
    await vi.waitFor(() => expect(provider.collectCalls).toHaveLength(1));
    await lemonadeAt("21.00");
    release();
    await paid;
    expect(await filed(tab.tabId)).toEqual(DIVIDED);
  });

  it("a product with no rate refuses as any line does", async () => {
    await lemonadeAt(null);
    const tab = await lunchBill();
    await expect(
      takeBillPayment(
        deps(),
        venue.cfg,
        tab.tabId,
        { ...wholePayment("14.00"), method: "cash", tendered: "14.00" },
        venue.operator,
      ),
    ).rejects.toMatchObject({ code: "vat_rate.unavailable", params: { lineNo: 4 } });
    expect(await paymentsOf(venue, tab.tabId)).toEqual([]);

    const paymentId = await inTx(venue, (tx) => capturedCardPayment(tx, venue, tab.tabId, "14.00"));
    const left = await settlePendingBillPayments({ ...deps(), cfg: venue.cfg });
    expect(left).toMatchObject({ received: 0, pending: 1 });
    expect(await paymentsOf(venue, tab.tabId)).toMatchObject([{ id: paymentId, state: "pending" }]);

    // Settled once the rate is back, so no later case's settlement finds it pending.
    await lemonadeAt("21.00");
    expect(await settlePendingBillPayments({ ...deps(), cfg: venue.cfg })).toMatchObject({
      received: 1,
      pending: 0,
    });
    expect(await filed(tab.tabId)).toEqual(DIVIDED);
  });
});
