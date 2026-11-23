import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { createPinThrottle } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { decimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import { closeBillDeferredTx } from "./deferred-close.js";
import { recordUnpaidDeparture } from "./unpaid-departure.js";
import { issueIfFullyPaid } from "./bill-payments.js";
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
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  capturedCardPayment,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { cancelItemForTest, cancelLine } from "./testing/cancel-line.js";
import { REASONS } from "./testing/adjustment-venue.js";

let venue: PartyVenue;
let copy: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    copy = await inTx(venue, (tx) =>
      setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan")),
    );
  },
});

const deps = () => ({
  db: venue.db,
  backend: venue.backend,
  clock: venue.clock,
  admission: testTradingAdmission(),
});

async function bill(withSetMenu = true) {
  const { tabId } = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await order(venue, tabId, "Burger");
  if (withSetMenu) await inTx(venue, (tx) => seedBillSetMenu(tx, tabId, copy, 2));
  return tabId;
}

it.each(["items", "contribution"] as const)("refuses a new %s payment", async (kind) => {
  const id = await bill();
  await expect(
    takeBillPayment(
      deps(),
      venue.cfg,
      id,
      {
        submissionId: crypto.randomUUID(),
        ...(kind === "items" ? { kind, lines: [{ lineNo: 1 }] } : { kind, amount: "12.00" }),
        method: "cash",
        tendered: "12.00",
        applied: "12.00",
        tip: "0.00",
      },
      venue.operator,
    ),
  ).rejects.toMatchObject({ code: "set_menu.payment_not_ready" });
  expect(await paymentsOf(venue, id)).toEqual([]);
});

function wholePayment() {
  return {
    submissionId: crypto.randomUUID(),
    kind: "share",
    shareOf: 1,
    applied: "26.00",
    tip: "0.00",
  } as const;
}

it.each(["cash", "card"] as const)(
  "refuses a whole %s payment before it issues a sale",
  async (method) => {
    const id = await bill();
    await expect(
      takeBillPayment(
        deps(),
        venue.cfg,
        id,
        {
          ...wholePayment(),
          method,
          ...(method === "cash" ? { tendered: "26.00" } : { entry: "manual" }),
        },
        venue.operator,
      ),
    ).rejects.toMatchObject({ code: "set_menu.payment_not_ready" });
    expect(
      await venue.db.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, id)),
    ).toEqual([]);
    expect(
      (
        await venue.db
          .select({ status: workingOrders.status })
          .from(workingOrders)
          .where(eq(workingOrders.id, id))
      )[0]?.status,
    ).toBe("open");
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

it.each(["open", "placed"] as const)(
  "refuses the reader on a %s bill before asking it to collect",
  async (status) => {
    const id = await bill();
    if (status === "placed") await placeByHand(venue, id);
    const provider = new FakePaymentProvider(venue.db);
    await expect(
      takeReaderBillPayment(
        { ...deps(), provider },
        venue.cfg,
        id,
        { ...wholePayment(), method: "card", entry: "reader" },
        venue.operator,
      ),
    ).rejects.toMatchObject({ code: "set_menu.payment_not_ready" });
    expect(provider.collectCalls).toHaveLength(0);
  },
);

it("refuses collecting an already placed order", async () => {
  const id = await bill();
  await placeByHand(venue, id);
  await expect(
    takeBillPayment(
      deps(),
      venue.cfg,
      id,
      { ...wholePayment(), method: "cash", tendered: "26.00" },
      venue.operator,
    ),
  ).rejects.toMatchObject({ code: "set_menu.payment_not_ready" });
});

it("refuses recording an unpaid departure on a new set-menu bill", async () => {
  const id = await bill();
  const { partyId } = await billRow(venue, id);
  const expectedPartyRevision = await revisionOf(venue, partyId!);
  await expect(
    inTx(venue, async (tx) =>
      recordUnpaidDeparture(
        tx,
        deps(),
        venue.cfg,
        partyId!,
        {
          billId: id,
          expectedPartyRevision,
          expectedEdits: [await readBillEditState(tx, id)],
          reason: "Left before paying",
        },
        { ...venue.operator, attempts: { throttle: createPinThrottle(), slot: "departure" } },
      ),
    ),
  ).rejects.toMatchObject({ code: "set_menu.payment_not_ready" });
  expect(await revisionOf(venue, partyId!)).toBe(expectedPartyRevision);
});

it("refuses closing a new set-menu bill as deferred", async () => {
  const id = await bill();
  await expect(
    inTx(venue, async (tx) =>
      closeBillDeferredTx(
        tx,
        { ...deps(), admitPartyRelease: async () => "allowed" },
        venue.cfg,
        {
          id,
          submissionId: crypto.randomUUID(),
          expectedRevision: await readOrderRevision(tx, id),
          expectedEdit: await readBillEditState(tx, id),
          expectedTotal: "26.00",
          invoiceType: "F2",
          recipient: null,
          receiptLanguage: venue.cfg.locale,
          delivery: null,
          partyFinish: null,
        },
        venue.operator.personId,
      ),
    ),
  ).rejects.toMatchObject({ code: "set_menu.payment_not_ready" });
});

it.each(["comp", "discount_percent", "discount_amount"] as const)(
  "refuses previewing or applying %s on a set-menu bill",
  async (action) => {
    const id = await bill();
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, { ...REASONS.house, name: `House ${crypto.randomUUID()}` }),
    );
    const args = await inTx(venue, async (tx) => {
      const [line] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 1)));
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
    const error = { code: "set_menu.payment_not_ready" };
    await expect(
      inTx(venue, (tx) => previewAdjustment(tx, args, venue.cfg.locale)),
    ).rejects.toMatchObject(error);
    await expect(
      inTx(venue, (tx) =>
        applyAdjustment(
          tx,
          venue.cfg,
          { ...args, admission: testTradingAdmission() },
          venue.cfg.locale,
        ),
      ),
    ).rejects.toMatchObject(error);
    expect(
      await venue.db
        .select({ id: adjustments.id })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, id)),
    ).toEqual([]);
  },
);

it("still lets staff cancel a dish on a set-menu bill", async () => {
  const id = await bill();
  const { adjustmentIds } = await inTx(venue, (tx) =>
    cancelLine(tx, venue.cfg, id, 1, undefined, venue.operator.personId),
  );
  expect(adjustmentIds).toHaveLength(1);
});

it("keeps the cancellation when the remaining set-menu bill matches cash already received", async () => {
  const id = await bill(false);
  await order(venue, id, "Paella");
  const paymentId = await cashContribution(venue, id, "26.00");
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, copy, 3));

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
