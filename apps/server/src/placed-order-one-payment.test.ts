import { billShare } from "./testing/bill-payment-fixture.js";
import { settleFromProviderRow } from "./bill-payments-loop.js";
import { seedZone } from "@waitron/db/testing/seed.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { deviceId as brandDeviceId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPayments } from "@waitron/db";
import { failAttempting, recordAttemptResolution } from "@waitron/payments";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;
const zoneOf = {} as Record<Kind, { zoneId: string; offerFor: (productId: string) => string }>;
let beerId: string;

type Kind = "invoiced" | "uninvoiced";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    beerId = db.all<{ id: string }>(sql`select id from products where name = 'Caña'`)[0]!.id;
    zoneOf.invoiced = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    zoneOf.uninvoiced = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Barra ticket" })];
      return offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, orderStart: "counter" });
    });
  },
});

/** One Caña (3.00), parked and placed through the routes; `invoiced` issues its invoice between. */
async function placed(kind: Kind): Promise<string> {
  const id = randomUUID();
  const zone = zoneOf[kind];
  const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    dining: "eat_in",
    id,
    zoneId: zone.zoneId,
    lines: [{ menuItemId: zone.offerFor(beerId), quantity: "1" }],
  });
  expect(parked.status).toBe(200);
  if (kind === "invoiced") {
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      id,
      venue.operatorId,
    );
  }
  const place = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`);
  expect(place.status).toBe(200);
  return id;
}

function pay(id: string, cookie = venue.cookie) {
  return send(
    venue.app,
    cookie,
    "POST",
    `/api/working-orders/${id}/payments`,
    billShare("card", "3.00", { entry: "reader", submissionId: id }),
  );
}

function snapshot() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from verifactu_records) as registros,
      (select count(*) from tenders) as tenders,
      (select count(*) from sale_settlements) as settlements,
      (select count(*) from payments) as payments,
      (select count(*) from print_jobs) as printJobs,
      (select count(*) from bill_payments) as billPayments,
      (select count(*) from refunds) as billRefunds
  `)[0];
}

function salesOf(id: string) {
  return venue.db.all<{ id: string }>(sql`select id from sales where working_order_id = ${id}`);
}

function tendersOf(id: string) {
  return venue.db.all<{ method: string; amount: number }>(sql`
    select t.method, t.amount from tenders t join sales s on s.id = t.sale_id
    where s.working_order_id = ${id}`);
}

function paymentsOf(id: string) {
  return venue.db.all<{ provider: string; state: string; saleId: string | null }>(sql`
    select provider, state, sale_id as saleId from payments
    where working_order_id = ${id} order by created_at`);
}

const refusedInFlight = (id: string) => ({
  status: 409,
  json: { code: "order.payment_in_flight", params: { workingOrderId: id } },
});

const cashAsk = {
  kind: "contribution",
  amount: "3.00",
  method: "cash",
  tendered: "3.00",
  applied: "3.00",
  tip: "0.00",
  expectedEdit: null,
};

describe("a placed order's bill payment while its card is in flight", () => {
  function partCard(id: string) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "1.00",
      method: "card",
      entry: "reader",
      applied: "1.00",
      tip: "0.00",
      expectedEdit: null,
    });
  }

  function partCashOnTill2(id: string) {
    return send(venue.app, venue.cookie2, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      ...cashAsk,
      amount: "1.00",
      tendered: "1.00",
      applied: "1.00",
    });
  }

  it("takes a cash part payment, against what is left, while another part payment's card is left unresolved by a reader timeout, as on an open bill", async () => {
    const id = await placed("uninvoiced");
    venue.card.stallNextCollect();
    const card = await partCard(id);
    expect(card).toMatchObject({ status: 200, json: { outcome: "timeout" } });
    expect(
      venue.db.all(sql`select state from bill_payments where working_order_id = ${id}`),
    ).toEqual([{ state: "pending" }]);
    expect(
      venue.db.all(sql`
        select state, bill_payment_id is not null as partPayment from payments
        where working_order_id = ${id}`),
    ).toEqual([{ state: "attempting", partPayment: 1 }]);

    const preview = await send(
      venue.app,
      venue.cookie2,
      "POST",
      `/api/working-orders/${id}/payments/preview`,
      { ...cashAsk, amount: "1.00", tendered: "1.00", applied: "1.00" },
    );
    const cash = await partCashOnTill2(id);

    expect(preview.status).toBe(200);

    expect(cash.status).toBe(200);
    expect(cash.json).toMatchObject({
      outcome: "received",
      payment: { state: "received" },
      balance: { total: "3.00", received: "1.00", reserved: "1.00", outstanding: "1.00" },
    });
    expect(await statusOf(venue, id)).toBe("placed");
    expect(salesOf(id)).toEqual([]);
  });

  it("takes part cash while a part card payment is still at the reader", async () => {
    const id = await placed("uninvoiced");
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    let paying: ReturnType<typeof send> | undefined;
    let observed;
    try {
      paying = partCard(id);
      await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
      observed = { cash: await partCashOnTill2(id) };
    } finally {
      release();
    }
    const card = await paying;

    expect(observed.cash.status).toBe(200);
    expect(observed.cash.json).toMatchObject({
      outcome: "received",
      balance: { received: "1.00", reserved: "1.00", outstanding: "1.00" },
    });
    expect(card).toMatchObject({
      status: 200,
      json: { outcome: "received", balance: { received: "2.00", outstanding: "1.00" } },
    });
    expect(await statusOf(venue, id)).toBe("placed");
  });
});

describe("giving back a part payment on a sent bill before its invoice", () => {
  async function partCash(id: string): Promise<string> {
    const part = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      ...cashAsk,
      amount: "1.00",
      tendered: "1.00",
      applied: "1.00",
    });
    expect(part.status).toBe(200);
    return (part.json.payment as { id: string }).id;
  }

  function refundOf(id: string, paymentId: string) {
    return send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Guest changed their mind",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
  }

  function refundCount(paymentId: string): number {
    return venue.db.all<{ n: number }>(
      sql`select count(*) as n from refunds where bill_payment_id = ${paymentId}`,
    )[0]!.n;
  }

  it("refunds a cash part payment of a sent counter order, leaving nothing received", async () => {
    const id = await placed("uninvoiced");
    const paymentId = await partCash(id);

    const refunded = await refundOf(id, paymentId);

    expect(refunded.status).toBe(200);
    expect(refunded.json).toMatchObject({
      refund: { paymentId, appliedAmount: "1.00", state: "completed" },
      balance: { total: "3.00", received: "0.00", outstanding: "3.00" },
    });
    expect(await statusOf(venue, id)).toBe("placed");
    expect(salesOf(id)).toEqual([]);
  });

  it("refunds a part payment of a sent counter order moved to a table, where it is presented", async () => {
    const party = await seatedWith(venue);
    const id = await placed("uninvoiced");
    const paymentId = await partCash(id);
    const [row] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );
    const moved = await send(venue.app, venue.cookie, "POST", `/api/bills/${id}/move`, {
      to: { tableId: party.tableId },
      expectedEdits: await inTx(venue, async (tx) => {
        const edits = [];
        for (const billId of [id, ...(await readPartyBillIds(tx, [party.partyId]))].sort())
          edits.push(await readBillEditState(tx, billId));
        return edits;
      }),
      otherPartyId: party.partyId,
      expectedOtherPartyRevision: row!.revision,
    });
    expect(moved.status).toBe(200);

    const refunded = await refundOf(id, paymentId);

    expect(refunded.status).toBe(200);
    expect(refunded.json).toMatchObject({
      balance: { total: "3.00", received: "0.00", outstanding: "3.00" },
    });
    expect(await statusOf(venue, id)).toBe("placed");
    expect(salesOf(id)).toEqual([]);
  });

  it("settles the same issued invoice after an earlier part was refunded in full", async () => {
    const id = await placed("uninvoiced");
    const paymentId = await partCash(id);
    expect((await refundOf(id, paymentId)).status).toBe(200);
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      id,
      venue.operatorId,
    );
    const issued = salesOf(id);

    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "card",
      entry: "manual",
      externalRef: "MANUAL-117",
      applied: "3.00",
      tip: "0.00",
    });

    expect(paid).toMatchObject({
      status: 200,
      json: {
        balance: { status: "settled", received: "3.00", outstanding: "0.00" },
        invoice: { total: "3.00" },
      },
    });
    expect(salesOf(id)).toEqual(issued);
    expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
    expect(paymentsOf(id)).toMatchObject([{ state: "captured", saleId: issued[0]!.id }]);
  });

  it("refuses the refund once the sent bill's invoice is issued, writing nothing", async () => {
    const id = await placed("uninvoiced");
    const paymentId = await partCash(id);
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      id,
      venue.operatorId,
    );
    expect(salesOf(id)).toHaveLength(1);
    expect(await statusOf(venue, id)).toBe("placed");
    const before = snapshot();

    const refused = await refundOf(id, paymentId);

    expect(refused).toEqual({
      status: 409,
      json: { code: "working_order.not_open", params: { workingOrderId: id } },
    });
    expect(snapshot()).toEqual(before);
    expect(refundCount(paymentId)).toBe(0);
  });

  it("refuses the refund while the sent bill records a card part payment still pending", async () => {
    const id = await placed("uninvoiced");
    const paymentId = await partCash(id);
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: id,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "card",
        applied: 100,
        tip: 0,
        tendered: null,
        state: "pending",
        receivedAt: null,
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
      }),
    );

    const refused = await refundOf(id, paymentId);

    expect(refused).toEqual(refusedInFlight(id));
    expect(refundCount(paymentId)).toBe(0);
  });

  it("refuses the refund while a reader takes a card part payment of the sent bill", async () => {
    const id = await placed("uninvoiced");
    const paymentId = await partCash(id);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    let paying: ReturnType<typeof send> | undefined;
    let refused;
    try {
      paying = send(venue.app, venue.cookie2, "POST", `/api/working-orders/${id}/payments`, {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "1.00",
        method: "card",
        entry: "reader",
        applied: "1.00",
        tip: "0.00",
        expectedEdit: null,
      });
      await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
      refused = await refundOf(id, paymentId);
    } finally {
      release();
    }
    expect((await paying).status).toBe(200);

    expect(refused).toEqual(refusedInFlight(id));
    expect(refundCount(paymentId)).toBe(0);
  });
});

/** A card payment of `id` through the orchestration, with `provider` as its reader. */
describe("cancelling a placed order respects stored cards", () => {
  function cancel(id: string) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/cancel`, {
      reason: "Guest cancelled",
    });
  }

  it.each(["attempting", "captured"] as const)(
    "refuses an uninvoiced order with a stored %s payment after the live attempt ends",
    async (state) => {
      const id = await placed("uninvoiced");
      venue.card.crashNextCollect(state);
      expect((await pay(id)).status).toBe(500);
      const before = snapshot();
      const amendments = venue.db.all(
        sql`select * from order_amendments where working_order_id = ${id}`,
      );

      expect(await cancel(id)).toEqual(refusedInFlight(id));

      expect(snapshot()).toEqual(before);
      expect(await statusOf(venue, id)).toBe("placed");
      expect(
        venue.db.all(sql`select * from order_amendments where working_order_id = ${id}`),
      ).toEqual(amendments);
      expect(paymentsOf(id)).toEqual([{ provider: "fake", state, saleId: null }]);
      if (state !== "attempting") {
        const calls = venue.card.collectCalls.length;
        const recovered = await pay(id);
        expect(recovered.status).toBe(200);
        expect(recovered.json.outcome).toBe("received");
        expect(venue.card.collectCalls.length).toBe(calls);
        expect(await statusOf(venue, id)).toBe("settled");
        const sale = salesOf(id);
        expect(sale).toHaveLength(1);
        expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
        expect(paymentsOf(id)).toEqual([{ provider: "fake", state, saleId: sale[0]!.id }]);
      }
    },
  );

  it("allows cancellation once the stored unresolved card fails, even while another order holds a payment", async () => {
    const other = await placed("uninvoiced");
    venue.card.crashNextCollect("captured");
    expect((await pay(other)).status).toBe(500);
    const id = await placed("uninvoiced");
    venue.card.crashNextCollect("attempting");
    expect((await pay(id)).status).toBe(500);
    const [attempt] = venue.db.all<{ ref: string }>(
      sql`select payment_ref as ref from payments where working_order_id = ${id}`,
    );
    await inTx(venue, async (tx) => {
      const key = { provider: "fake", paymentRef: attempt!.ref };
      await failAttempting(tx, key);
      await recordAttemptResolution(tx, key, {
        personId: null,
        outcome: "failed",
        cancelledAtProvider: true,
        providerStatus: "canceled",
        resolvedAt: new Date(),
      });
      const [pending] = venue.db.all<{ id: string }>(
        sql`select id from bill_payments where working_order_id = ${id}`,
      );
      await settleFromProviderRow(
        tx,
        { ...venue, admission: testTradingAdmission() },
        pending!.id,
        new Date(),
        async () => ({}),
      );
    });
    const before = snapshot();

    expect((await cancel(id)).status).toBe(200);

    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(snapshot()).toEqual(before);
    expect(
      venue.db.all<{ kind: string }>(
        sql`select kind from order_amendments where working_order_id = ${id} order by sequence_no`,
      ),
    ).toEqual([{ kind: "order_placed" }, { kind: "order_cancelled" }]);
    expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "failed", saleId: null }]);
    expect(paymentsOf(other)).toEqual([{ provider: "fake", state: "captured", saleId: null }]);
  });
});

describe("unpaid duplicate invoice through the payment route", () => {
  it("settles the invoice issued during the charge and replays it without another charge", async () => {
    const id = await placed("uninvoiced");
    const original = venue.card.collect.bind(venue.card);
    let issued: string | undefined;
    const collect = vi.spyOn(venue.card, "collect").mockImplementationOnce(async (params) => {
      const result = await original(params);
      await issueOrderInvoice(
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
        },
        venue.cfg,
        id,
        venue.operatorId,
      );
      issued = salesOf(id)[0]!.id;
      return result;
    });
    const calls = venue.card.collectCalls.length;
    let paid;
    try {
      paid = await pay(id);
    } finally {
      collect.mockRestore();
    }
    expect(paid).toMatchObject({ status: 200, json: { outcome: "received" } });
    expect(await pay(id)).toEqual(paid);
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await statusOf(venue, id)).toBe("settled");
    const sale = salesOf(id);
    expect(sale).toEqual([{ id: issued }]);
    expect(paymentsOf(id)).toEqual([{ provider: "fake", state: "captured", saleId: sale[0]!.id }]);
    expect(tendersOf(id)).toEqual([{ method: "card", amount: 300 }]);
  });
});
