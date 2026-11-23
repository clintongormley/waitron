import { and, eq, isNotNull } from "drizzle-orm";
import { expect, it } from "vitest";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { createPinThrottle } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { decimal, type Dining } from "@waitron/shared";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import { closeBillDeferredTx } from "./deferred-close.js";
import { recordUnpaidDeparture } from "./unpaid-departure.js";
import { issueIfFullyPaid, type BillPaymentRequest } from "./bill-payments.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { readBillEditState } from "./bill-editing.js";
import { priceStoredOrderForIssuance, readOrderRevision } from "./working-order.js";
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
import { capturedCardPayment, seedBillSetMenu } from "./testing/set-menu-bill-fixture.js";
import {
  saveSpecDishes,
  sendSpecDraft,
  setSpecCount,
  printSpecBill,
  setupSetMenuSpecVenue,
  specBill,
  specRows,
  specSaleLines,
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

it("builds the plan's bill: the places piece 2 gives, 73.00 in all", async () => {
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
    ["Soup", tab.special[0], 0, 0],
    ["Soup", tab.special[1], 0, 0],
    ["Hake", tab.daily[0], 1, 0],
    ["Sea bass", tab.special[0], 1, 0],
    ["Sirloin", tab.special[1], 1, 0],
    ["Sirloin", tab.daily[1], 1, 500],
  ]);
  expect(rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(7300);
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
      tendered: "36.50",
      applied: "36.50",
    }),
    cash: () => ({ ...wholePayment("73.00"), method: "cash", tendered: "73.00" }),
    card: () => ({ ...wholePayment("73.00"), method: "card", entry: "manual" }),
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
  const draft = await saveSpecDishes(spec, tab, [{ dish: "Sea bass", from: spec.special }]);
  await expect(sendSpecDraft(spec, tab.partyId, draft.id)).rejects.toMatchObject({
    code: "set_menu.no_place",
    params: { dishName: "Sea bass" },
  });

  const { setMenus } = await setSpecCount(spec, tab.tabId, spec.special, 3);
  const third = setMenus.at(-1)!.lineId;
  const before = await specRows(spec, tab.tabId);
  await sendSpecDraft(spec, tab.partyId, draft.id);
  const after = await specRows(spec, tab.tabId);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.slice(before.length)).toMatchObject([
    {
      name: "Sea bass",
      setMenuRole: "dish",
      setMenuLineId: third,
      setMenuPlace: 1,
      unitPriceGross: 0,
      lineTotal: 0,
    },
  ]);
});

it.each(["takeaway", "eat_in"] as const)(
  "a takeaway set-menu bill still refuses money, and the same bill eaten here takes it: %s",
  async (dining) => {
    const daily = async () => {
      const seated = await seatedBill(dining);
      await setSpecCount(spec, seated.tabId, spec.daily, 1);
      await order(venue, seated.tabId, "Burger");
      return seated;
    };
    const outcome = (attempt: Promise<unknown>) =>
      attempt.then(
        () => "accepted",
        (error: { code?: string }) => error.code,
      );
    const expected = dining === "takeaway" ? "set_menu.payment_not_ready" : "accepted";

    const paid = await daily();
    expect(await outcome(cashContribution(venue, paid.tabId, "5.00"))).toBe(expected);
    const comped = await daily();
    expect(await outcome(applyArgs(await adjustmentArgs(comped.tabId, 2, "comp")))).toBe(expected);
    const printed = await daily();
    expect(await outcome(printBill(printed.partyId, printed.tabId))).toBe(expected);

    const taken = dining === "takeaway" ? 0 : 1;
    expect(await paymentsOf(venue, paid.tabId)).toHaveLength(taken);
    expect(
      await venue.db
        .select({ id: adjustments.id })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, comped.tabId)),
    ).toHaveLength(taken);
    expect((await billRow(venue, printed.tabId)).status).toBe(
      dining === "takeaway" ? "open" : "placed",
    );
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
 * set-menu role; and the sale's total, 73.00. */
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
  expect(sale!.total).toBe(7300);
}

async function payAtReader(billId: string) {
  const provider = new FakePaymentProvider(venue.db);
  await takeReaderBillPayment(
    { ...deps(), provider },
    venue.cfg,
    billId,
    { ...wholePayment("73.00"), method: "card", entry: "reader" },
    venue.operator,
  );
  expect(provider.collectCalls).toHaveLength(1);
}

async function payWhole(
  billId: string,
  request: Parameters<typeof takeBillPayment>[3] = {
    ...wholePayment("73.00"),
    method: "cash",
    tendered: "73.00",
  },
) {
  await takeBillPayment(deps(), venue.cfg, billId, request, venue.operator);
  expect(await paymentsOf(venue, billId)).toMatchObject([{ applied: 7300, state: "received" }]);
}

const paths: Record<string, (tab: { partyId: string; tabId: string }) => Promise<void>> = {
  "whole by cash": ({ tabId }) => payWhole(tabId),
  "whole by hand-keyed card": ({ tabId }) =>
    payWhole(tabId, { ...wholePayment("73.00"), method: "card", entry: "manual" }),
  "whole at the reader": ({ tabId }) => payAtReader(tabId),
  "placed, then collected": async ({ tabId }) => {
    await placeByHand(venue, tabId);
    await payWhole(tabId);
  },
  "placed, then collected at the reader": async ({ tabId }) => {
    await placeByHand(venue, tabId);
    await payAtReader(tabId);
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
  "deferred close": async ({ tabId }) => {
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
          expectedTotal: "73.00",
          invoiceType: "F2",
          recipient: null,
          receiptLanguage: venue.cfg.locale,
          delivery: null,
          partyFinish: null,
        },
        venue.operator.personId,
      ),
    );
    expect((await billRow(venue, tabId)).status).not.toBe("open");
  },
  "Print the bill": async ({ partyId, tabId }) => {
    await printBill(partyId, tabId);
    expect((await billRow(venue, tabId)).status).toBe("placed");
  },
};

it.each(Object.keys(paths))(
  "a set-menu bill is paid whole or issued through each path: %s",
  async (path) => {
    const tab = await specBill(spec, "fire");
    await paths[path]!(tab);
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

it("keeps the cancellation when the remaining takeaway set-menu bill matches cash already received", async () => {
  const id = await bill(false, "takeaway");
  await order(venue, id, "Paella");
  const paymentId = await cashContribution(venue, id, "26.00");
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, spec.daily, 3));

  const invoice = await inTx(venue, async (tx) => {
    await cancelItemForTest(tx, venue.cfg, id, 2, undefined, venue.operator.personId);
    return issueIfFullyPaid(tx, deps(), venue.cfg, id, venue.operator.personId);
  });
  expect(invoice).toBeNull();
  expect((await billRow(venue, id)).status).toBe("open");
  expect(await paymentsOf(venue, id)).toMatchObject([
    { id: paymentId, applied: 2600, state: "received" },
  ]);
  const lines = await venue.db
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  expect(lines).toEqual([{ lineNo: 1 }, { lineNo: 3 }]);
  expect(
    await venue.db.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, id)),
  ).toEqual([]);
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
