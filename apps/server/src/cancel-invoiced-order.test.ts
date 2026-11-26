import { seedZone } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  invoiceSeries,
  orderAmendments,
  saleLines,
  saleSettlements,
  saleVoids,
  tenders,
  unpaidDepartures,
  withTransaction,
} from "@waitron/db";
import { listOutstandingSales, recordCorrection } from "@waitron/core";
import { verifactuRecords } from "@waitron/fiscal-verifactu";
import { createPinThrottle, hashPin, PIN_THROTTLE_IDLE_MS } from "@waitron/identity";
import { captureAttempting } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  placedCounterBillMovedTo,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { mountTillApi } from "./till-api.js";
import { billShare, takeReaderBillPayment } from "./testing/bill-payment-fixture.js";
import { openTillSession } from "./testing/session-device.js";
import * as fixture from "./testing/cancel-invoice-venue.js";
import "./errors.js";
import { failingDerivationsOf, watchDerivations, watchedOrder } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

// Cancelling a placed order whose invoice was issued cancels it (`sale.void`) when nothing was
// served and nothing paid, and otherwise credits it whole (an R5 corrective invoice), in the
// cancel's one transaction. Driven over HTTP against a venue that files real Veri*Factu records.
let cv: fixture.CancelInvoiceVenue;
let venue: BillVenue;
let ticketThenPayZone: string;
let productIdOf: (name: string) => string;
let portionListId: string;
let supervisorId: string;
/** The supervisor's own session on the first till's device: holds `sale.rectify`. */
let supervisorCookie: string;
let supervisorSessionId: string;

const SUPERVISOR_PIN = fixture.SUPERVISOR_PIN;
const REASON = "Pedido equivocado";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    cv = await fixture.provisionCancelInvoiceVenue(db);
    ({
      venue,
      ticketThenPayZone,
      productIdOf,
      portionListId,
      supervisorId,
      supervisorCookie,
      supervisorSessionId,
    } = cv);
  },
});

function placed(
  lines: Parameters<typeof fixture.placed>[1],
  zoneId = ticketThenPayZone,
  issued = true,
  dining: "eat_in" | "takeaway" = "eat_in",
): Promise<string> {
  return fixture.placed(cv, lines, zoneId, issued, dining);
}

const invoiceOf = (billId: string) => fixture.invoiceOf(venue, billId);
const creditsOf = (saleId: string) => fixture.creditsOf(venue, saleId);
const linesOf = (saleId: string) => fixture.linesOf(venue, saleId);
const activeCorrective = () => fixture.activeCorrective(venue);

function cancel(id: string, cookie = supervisorCookie) {
  return send(venue.app, cookie, "POST", `/api/working-orders/${id}/cancel`, { reason: REASON });
}

function amendmentsOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        kind: orderAmendments.kind,
        actorId: orderAmendments.actorId,
        reason: orderAmendments.reason,
      })
      .from(orderAmendments)
      .where(eq(orderAmendments.workingOrderId, billId))
      .orderBy(orderAmendments.sequenceNo),
  );
}

/** The cancellations filed against the sale, by whom and why. */
function voidsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ reason: saleVoids.reason, voidedBy: saleVoids.voidedBy })
      .from(saleVoids)
      .where(eq(saleVoids.saleId, saleId)),
  );
}

/** The sale's cancellation records (anulación) in the Veri*Factu chain. */
function annulmentsOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: verifactuRecords.id })
      .from(verifactuRecords)
      .where(
        and(eq(verifactuRecords.saleId, saleId), eq(verifactuRecords.tipoRegistro, "anulacion")),
      ),
  );
}

/** Credits 1.00 of a Small beer's 3.00 invoice: 0.83 at 21%, so a credit of the whole would exceed it. */
async function creditPartly(saleId: string) {
  const series = await activeCorrective();
  await inTx(venue, (tx) =>
    recordCorrection(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(saleId),
      total: "-1.00",
      lines: [
        {
          lineNo: 1,
          name: "Small beer",
          descriptions: { [venue.cfg.locale]: "Glass of lager" },
          quantity: "-0.333",
          unitPrice: "2.48",
          vatRate: "21.00",
          lineTotal: "-0.83",
        },
      ],
      authz: { sessionId: supervisorSessionId },
      clock: venue.clock,
    }),
  );
}

/** Everything a credit or a cancellation would write, so a refusal can be shown to have written none of it. */
function fiscalSnapshot() {
  return venue.db.all(sql`
    select
      (select count(*) from sales) as sales,
      (select count(*) from sale_lines) as saleLines,
      (select count(*) from sale_settlements) as settlements,
      (select count(*) from sale_voids) as voids,
      (select count(*) from verifactu_records) as recordCount,
      (select count(*) from order_amendments) as amendments,
      (select group_concat(id || ':' || (select coalesce(max(sales.invoice_number), 0) + 1 from sales where sales.series_id = invoice_series.id), ',') from invoice_series) as series,
      (select group_concat(node_id || ':' || secuencia || ':' || huella, ',')
        from (select node_id, secuencia, huella from verifactu_records order by node_id, secuencia)) as chain
  `)[0];
}

async function expectRefusedUnwritten(
  billId: string,
  answer: Promise<{ status: number; json: Record<string, unknown> }>,
  refusal: { status: number; code: string },
): Promise<void> {
  expectUnwritten(await observeRefusal(billId, answer), refusal);
}

// Observes a refusal without asserting, so a case holding a card at the reader can release it
// before any assertion fails.
async function observeRefusal(
  billId: string,
  answer: Promise<{ status: number; json: Record<string, unknown> }>,
) {
  const before = fiscalSnapshot();
  const { status, json } = await answer;
  return {
    answered: { status, code: json.code },
    before,
    after: fiscalSnapshot(),
    status: await statusOf(venue, billId),
    credits: await creditsOf((await invoiceOf(billId)).id),
  };
}

function expectUnwritten(
  observed: Awaited<ReturnType<typeof observeRefusal>>,
  refusal: { status: number; code: string },
): void {
  expect(observed.answered).toEqual(refusal);
  expect(observed.after).toEqual(observed.before);
  expect(observed.status).toBe("placed");
  expect(observed.credits).toEqual([]);
}

/**
 * A received cash payment on a placed bill, written directly: the payment route's one insert into
 * `bill_payments` (`bill-payments.ts`) first requires an open bill (`requireOpenBill`).
 */
function receivePayment(billId: string) {
  return inTx(venue, (tx) =>
    tx.insert(billPayments).values({
      workingOrderId: billId,
      submissionId: randomUUID(),
      fingerprint: "test",
      kind: "contribution",
      method: "cash",
      applied: 100,
      tendered: 100,
      state: "received",
      receivedAt: new Date().toISOString(),
      requestedBy: venue.operatorId,
      source: venue.cfg.origin.source,
      deviceId: venue.cfg.origin.deviceId,
    }),
  );
}

describe("cancelling a placed order whose invoice was issued", () => {
  it("files the published 0.055 kg portion exactly after unit precision falls", async () => {
    await inTx(venue, async (tx) => {
      await tx.execute(
        sql`update extra_list_items set portion = 55 where list_id = ${portionListId}`,
      );
      await tx.execute(sql`update units set precision = 2 where seed_key = 'credit-test-kg'`);
    });
    try {
      const oldId = await placed([
        {
          name: "Mosto",
          quantity: "1",
          extras: [
            { listId: portionListId, picks: [{ productId: productIdOf("Ham"), quantity: 3 }] },
          ],
        },
      ]);
      expect((await linesOf((await invoiceOf(oldId)).id))[1]).toMatchObject({
        quantity: 150,
        priceQuantity: 50,
        lineGross: 3,
      });

      await inTx(venue, (tx) => offerProducts(tx, { zone: "counter", orderStart: "counter" }));
      const newId = await placed([
        {
          name: "Mosto",
          quantity: "1",
          extras: [
            { listId: portionListId, picks: [{ productId: productIdOf("Ham"), quantity: 3 }] },
          ],
        },
      ]);
      const newSale = await invoiceOf(newId);
      expect((await linesOf(newSale.id))[1]).toMatchObject({
        quantity: 165,
        priceQuantity: 55,
        lineGross: 3,
      });
      const [child] = await inTx(venue, (tx) =>
        tx
          .select({ unitPrecision: saleLines.unitPrecision })
          .from(saleLines)
          .where(
            and(eq(saleLines.saleId, newSale.id), eq(saleLines.productId, productIdOf("Ham"))),
          ),
      );
      expect(child?.unitPrecision).toBe(2);
    } finally {
      await inTx(venue, async (tx) => {
        await tx.execute(
          sql`update extra_list_items set portion = 50 where list_id = ${portionListId}`,
        );
        await tx.execute(sql`update units set precision = 3 where seed_key = 'credit-test-kg'`);
        await offerProducts(tx, { zone: "counter", orderStart: "counter" });
      });
    }
  });

  it("refuses an operator without sale.void and no override, writing nothing and using no invoice number", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);

    const answer = cancel(id, venue.cookie);
    await expectRefusedUnwritten(id, answer, {
      status: 403,
      code: "authorization.not_permitted",
    });
    expect((await answer).json.params).toEqual({ permission: "sale.void" });
  });

  it("refuses a bill holding a payment, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    await receivePayment(id);

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "bill.payments_received",
    });
  });

  it("credits a bill its party left unpaid after its part payment was given back in full, tendering nothing", async () => {
    const party = await seatedWith(venue, "Small beer");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "1.00",
        method: "cash",
        tendered: "1.00",
        applied: "1.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    const givenBack = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments/${(paid.json.payment as { id: string }).id}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "1.00",
        tipAmount: "0.00",
        reason: "Overcharged",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(givenBack.status, JSON.stringify(givenBack)).toBe(200);
    const [{ revision }] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );
    const departed = await send(
      venue.app,
      supervisorCookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      { billId: party.tabId, expectedPartyRevision: revision, reason: "Se marcharon sin pagar" },
    );
    expect(departed.status, JSON.stringify(departed)).toBe(200);
    const original = await invoiceOf(party.tabId);

    const answer = await cancel(party.tabId);

    expect(answer).toEqual({ status: 200, json: { body: "" } });
    expect(await creditsOf(original.id)).toEqual([expect.objectContaining({ total: -300 })]);
    expect(
      await inTx(venue, (tx) => tx.select().from(tenders).where(eq(tenders.saleId, original.id))),
    ).toEqual([]);
    expect(
      await inTx(venue, (tx) =>
        tx.select().from(saleSettlements).where(eq(saleSettlements.saleId, original.id)),
      ),
    ).toHaveLength(1);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
  });

  it("refuses an operator without sale.rectify on a bill holding a payment as not permitted, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    await receivePayment(id);

    const answer = cancel(id, venue.cookie);
    await expectRefusedUnwritten(id, answer, {
      status: 403,
      code: "authorization.not_permitted",
    });
    expect((await answer).json.params).toEqual({ permission: "sale.rectify" });
  });

  it("refuses a second cancel, leaving exactly one cancellation", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    expect((await cancel(id)).status).toBe(200);
    const original = await invoiceOf(id);

    const again = await cancel(id);

    expect({ status: again.status, code: again.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
    expect(await voidsOf(original.id)).toHaveLength(1);
  });

  it("cancelling a different bill keeps the remaining bill's party revision current", async () => {
    const party = await seatedWith(venue);
    const presented = await placedCounterBillMovedTo(venue, ticketThenPayZone, party);
    const [before] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );

    const answer = await cancel(presented);

    expect(answer.status).toBe(200);
    const [after] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );
    expect(after!.revision).toBe(before!.revision);
  });

  it("cancelling the last presented bill leaves its seated party a fresh empty bill", async () => {
    const party = await seatedWith(venue);
    const presented = await placedCounterBillMovedTo(venue, ticketThenPayZone, party);
    const discarded = await send(
      venue.app,
      venue.cookie,
      "DELETE",
      `/api/working-orders/${party.tabId}`,
      { expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)) },
    );
    expect(discarded.status).toBe(200);
    const [before] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );

    const answer = await cancel(presented);

    expect(answer.status).toBe(200);
    const remaining = venue.db.all<{ id: string; status: string }>(sql`
      select id, status from working_orders
      where party_id = ${party.partyId} and status != 'abandoned'`);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.status).toBe("open");
    expect(remaining[0]!.id).not.toBe(presented);
    const [after] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );
    expect(after!.revision).toBe(before!.revision + 1);
    expect(
      venue.db.all(
        sql`select id from working_order_lines where working_order_id = ${remaining[0]!.id}`,
      ),
    ).toEqual([]);
  });

  it("cancels the receipt of a bill its party left without paying and abandons it, leaving the departure as recorded", async () => {
    const party = await seatedWith(venue, "Small beer");
    const departed = await send(
      venue.app,
      supervisorCookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      {
        billId: party.tabId,
        expectedPartyRevision: party.revision,
        reason: "Se marcharon sin pagar",
      },
    );
    expect(departed.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    const readDeparture = () =>
      inTx(venue, (tx) =>
        tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.workingOrderId, party.tabId)),
      );
    const departure = await readDeparture();
    expect(departure).toHaveLength(1);
    const original = await invoiceOf(party.tabId);
    const listedBills = async () => {
      const listed = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/bills/lookup?q=${original.invoiceNumber}`,
      );
      expect(listed.status).toBe(200);
      return (listed.json as { bills: { workingOrderId: string }[] }).bills.map(
        (row) => row.workingOrderId,
      );
    };
    expect(await listedBills()).toContain(party.tabId);

    const answer = await cancel(party.tabId);

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    expect(await voidsOf(original.id)).toEqual([{ reason: REASON, voidedBy: supervisorId }]);
    expect(await creditsOf(original.id)).toEqual([]);
    expect(await readDeparture()).toEqual(departure);
    expect(await listedBills()).not.toContain(party.tabId);
    expect(
      venue.db.all(sql`select id from working_orders
        where party_id = ${party.partyId} and status != 'abandoned'`),
    ).toEqual([]);
  });

  it("refuses an invoice already partly credited, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    await creditPartly(original.id);
    const partial = await creditsOf(original.id);
    expect(partial.map((credit) => credit.total)).toEqual([-100]);
    const before = fiscalSnapshot();

    const answer = await cancel(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "sale.correction_exceeds_total",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await creditsOf(original.id)).toEqual(partial);
  });

  it("refuses an invoice already credited upwards, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    const series = await activeCorrective();
    // 0.83 at 21% is 1.00 added to the Small beer's 3.00, so a credit of 3.00 would leave it 1.00.
    await inTx(venue, (tx) =>
      recordCorrection(tx, venue.backend, {
        operationDescription: "Restaurante",
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        correctsSaleId: brandSaleId(original.id),
        total: "1.00",
        lines: [
          {
            lineNo: 1,
            name: "Small beer",
            descriptions: { [venue.cfg.locale]: "Glass of lager" },
            quantity: "0.333",
            unitPrice: "2.48",
            vatRate: "21.00",
            lineTotal: "0.83",
          },
        ],
        authz: { sessionId: supervisorSessionId },
        clock: venue.clock,
      }),
    );
    const raised = await creditsOf(original.id);
    const before = fiscalSnapshot();

    const answer = await cancel(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "sale.correction_not_whole",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await creditsOf(original.id)).toEqual(raised);
  });

  it("files one cancellation when two cancels of the order arrive together, refusing the second", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    const series = await activeCorrective();

    const answers = await Promise.all([cancel(id), cancel(id)]);

    expect(answers.map((answer) => [answer.status, answer.json.code]).sort()).toEqual([
      [200, undefined],
      [409, "working_order.not_placed"],
    ]);
    expect(await voidsOf(original.id)).toHaveLength(1);
    expect(await annulmentsOf(original.id)).toHaveLength(1);
    expect(await creditsOf(original.id)).toEqual([]);
    expect(await activeCorrective()).toEqual(series);
    expect(await amendmentsOf(id)).toHaveLength(2);
  });

  it("keeps none of the cancellation when a write after it fails", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    // The cancel's last write is its amendment, after the cancellation, its record and the
    // chain's move.
    venue.db.run(
      sql.raw(
        `create trigger refuse_cancel_amendment before insert on order_amendments
         when new.kind = 'order_cancelled' and new.working_order_id = '${id}'
         begin select raise(abort, 'refused by the test'); end`,
      ),
    );
    const before = fiscalSnapshot();
    let answer: Awaited<ReturnType<typeof cancel>>;
    try {
      answer = await cancel(id);
    } finally {
      venue.db.run(sql.raw("drop trigger refuse_cancel_amendment"));
    }

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 500,
      code: "server.internal",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await voidsOf(original.id)).toEqual([]);
    const outstanding = await inTx(venue, (tx) => listOutstandingSales(tx));
    expect(outstanding.map((sale) => sale.saleId)).toContain(original.id);
    // The control: with the refusal gone, the same cancel cancels the receipt.
    expect((await cancel(id)).status).toBe(200);
    expect(await voidsOf(original.id)).toHaveLength(1);
  });
});

describe("cancelling an invoiced order on a supervisor's PIN", () => {
  type Override = { personId: unknown; pin: unknown } | string;

  function cancelWith(override: Override, cookie = venue.cookie, app = venue.app) {
    return (id: string) =>
      send(app, cookie, "POST", `/api/working-orders/${id}/cancel`, { reason: REASON, override });
  }

  /** The till routes with a wrong-PIN limit of their own, on a clock the case moves. */
  function throttledApp() {
    const clockAt = { now: 1_000_000 };
    const app = new Hono();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: venue.cfg.locale,
        pool: venue.pool,
        pinThrottle: createPinThrottle({ now: () => clockAt.now }),
      },
      () => {},
    );
    return { app, clockAt };
  }

  it("cancels the receipt for an operator without sale.void, naming the supervisor as authorising", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);

    const answer = await cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN })(id);

    expect(answer).toEqual({ status: 200, json: { body: "" } });
    expect(await voidsOf(original.id)).toEqual([{ reason: REASON, voidedBy: supervisorId }]);
    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
      { kind: "order_cancelled", actorId: venue.operatorId, reason: REASON },
    ]);
  });

  it("refuses a wrong supervisor PIN as pin.invalid, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);

    await expectRefusedUnwritten(id, cancelWith({ personId: supervisorId, pin: "0000" })(id), {
      status: 401,
      code: "pin.invalid",
    });
  });

  it("refuses the PIN of someone who does not hold sale.void, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const answer = cancelWith({ personId: venue.operatorId, pin: "5555" })(id);

    await expectRefusedUnwritten(id, answer, { status: 403, code: "authorization.not_permitted" });
    expect((await answer).json.params).toEqual({ permission: "sale.void" });
  });

  // Thunks, because the supervisor's id exists only once the suite's setup has run.
  it.each<[string, () => Override, { status: number; code: string }]>([
    [
      "an override that is not an object",
      () => SUPERVISOR_PIN,
      { status: 400, code: "management.request_invalid" },
    ],
    [
      "a person id that is not a UUID",
      () => ({ personId: "sofia", pin: SUPERVISOR_PIN }),
      { status: 401, code: "pin.invalid" },
    ],
    [
      "a PIN that is not text",
      () => ({ personId: supervisorId, pin: 7777 }),
      { status: 401, code: "pin.invalid" },
    ],
  ])("refuses %s, writing nothing", async (_, override, refusal) => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);

    await expectRefusedUnwritten(id, cancelWith(override())(id), refusal);
  });

  it("never checks an override sent by someone who holds sale.void, and cancels on their own authority", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);

    const answer = await cancelWith(
      { personId: venue.operatorId, pin: "5555" },
      supervisorCookie,
    )(id);

    expect(answer.status).toBe(200);
    expect(await voidsOf(original.id)).toEqual([{ reason: REASON, voidedBy: supervisorId }]);
  });

  it("counts wrong PINs in the till's override bucket: after four even the right one is 429, the drawer too, until the wait is over", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    const { app, clockAt } = throttledApp();
    const right = { personId: supervisorId, pin: SUPERVISOR_PIN };

    for (let i = 0; i < 4; i += 1) {
      const wrong = await cancelWith(
        { personId: supervisorId, pin: "0000" },
        venue.cookie,
        app,
      )(id);
      expect({ status: wrong.status, code: wrong.json.code }).toEqual({
        status: 401,
        code: "pin.invalid",
      });
    }
    const throttled = cancelWith(right, venue.cookie, app)(id);
    await expectRefusedUnwritten(id, throttled, { status: 429, code: "pin.throttled" });
    expect((await throttled).json.params).toEqual({ retryAfterSeconds: 2 });
    const drawer = await send(app, venue.cookie, "POST", "/api/drawer/open", { override: right });
    expect({ status: drawer.status, code: drawer.json.code }).toEqual({
      status: 429,
      code: "pin.throttled",
    });

    clockAt.now += 2_001;
    expect((await cancelWith(right, venue.cookie, app)(id)).status).toBe(200);
    expect(await voidsOf(original.id)).toEqual([{ reason: REASON, voidedBy: supervisorId }]);
  });

  it("refuses the PIN of someone who does not hold sale.rectify on a bill holding a payment as not permitted, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    await receivePayment(id);
    const answer = cancelWith({ personId: venue.operatorId, pin: "5555" })(id);

    await expectRefusedUnwritten(id, answer, { status: 403, code: "authorization.not_permitted" });
    expect((await answer).json.params).toEqual({ permission: "sale.rectify" });
  });

  it("refuses a wrong PIN on a bill holding a payment as pin.invalid, and counts it: after four even the right one is 429", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    await receivePayment(id);
    const { app } = throttledApp();
    const withPin = (pin: string) =>
      cancelWith({ personId: supervisorId, pin }, venue.cookie, app)(id);

    for (let i = 0; i < 4; i += 1) {
      await expectRefusedUnwritten(id, withPin("0000"), { status: 401, code: "pin.invalid" });
    }

    const throttled = withPin(SUPERVISOR_PIN);
    await expectRefusedUnwritten(id, throttled, { status: 429, code: "pin.throttled" });
    expect((await throttled).json.params).toEqual({ retryAfterSeconds: 2 });
  });

  it("refuses a sale.rectify holder's PIN on a bill holding a payment as bill.payments_received, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    await receivePayment(id);

    await expectRefusedUnwritten(
      id,
      cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN })(id),
      { status: 409, code: "bill.payments_received" },
    );
  });

  it("lets a refused cancel that never reaches the PIN check leave the wrong-PIN count to go idle", async () => {
    const cancelled = await placed([{ name: "Small beer", quantity: "1" }]);
    expect(
      (await cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN })(cancelled)).status,
    ).toBe(200);
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const { app, clockAt } = throttledApp();
    const wrong = cancelWith({ personId: supervisorId, pin: "0000" }, venue.cookie, app);
    for (let i = 0; i < 4; i += 1) expect((await wrong(id)).status).toBe(401);

    clockAt.now += PIN_THROTTLE_IDLE_MS - 60_000;
    const notPlaced = await wrong(cancelled);
    expect({ status: notPlaced.status, code: notPlaced.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
    clockAt.now += 60_000;

    expect((await wrong(id)).status).toBe(401);
    const right = cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN }, venue.cookie, app);
    expect((await right(id)).status).toBe(200);
  });

  it("refuses a cancel of a cancelled order as before when deriving the override PIN's key fails", async () => {
    const cancelled = await placed([{ name: "Small beer", quantity: "1" }]);
    expect(
      (await cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN })(cancelled)).status,
    ).toBe(200);

    const refused = await failingDerivationsOf("4040", () =>
      cancelWith({ personId: supervisorId, pin: "4040" })(cancelled),
    );

    expect({ status: refused.status, code: refused.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
  });

  function noInvoiceZone(name: string) {
    return inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name })];
      return offerProducts(tx, {
        zone: { zoneId: zone!.id },
        orderStart: "counter",
      });
    });
  }

  it("never checks an override sent with an order that has no invoice, so a wrong PIN there does not count", async () => {
    const ticketFirst = await noInvoiceZone("Barra sin factura");
    const { app } = throttledApp();
    const wrong = cancelWith({ personId: supervisorId, pin: "0000" }, venue.cookie, app);

    for (let i = 0; i < 5; i += 1) {
      const id = await placed([{ name: "Small beer", quantity: "1" }], ticketFirst.zoneId, false);
      expect((await wrong(id)).status).toBe(200);
      expect(await statusOf(venue, id)).toBe("abandoned");
    }
    const invoiced = await placed([{ name: "Small beer", quantity: "1" }]);
    const right = cancelWith({ personId: supervisorId, pin: SUPERVISOR_PIN }, venue.cookie, app);
    expect((await right(invoiced)).status).toBe(200);
  });

  it("refuses an override that is not an object even on an order with no invoice, writing nothing", async () => {
    const ticketFirst = await noInvoiceZone("Barra sin factura, mal formada");
    const id = await placed([{ name: "Small beer", quantity: "1" }], ticketFirst.zoneId, false);
    const before = fiscalSnapshot();

    const answer = await cancelWith(SUPERVISOR_PIN)(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 400,
      code: "management.request_invalid",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("placed");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
    ]);
  });

  it("an override sent by someone who holds sale.rectify is never checked, so it neither counts nor clears", async () => {
    const { app } = throttledApp();
    const byStaff = (pin: string) => cancelWith({ personId: supervisorId, pin }, venue.cookie, app);
    const bySupervisor = (pin: string) =>
      cancelWith({ personId: supervisorId, pin }, supervisorCookie, app);
    const id = await placed([{ name: "Small beer", quantity: "1" }]);

    for (let i = 0; i < 3; i += 1) {
      expect((await byStaff("0000")(id)).status).toBe(401);
    }
    expect(
      (await bySupervisor("0000")(await placed([{ name: "Small beer", quantity: "1" }]))).status,
    ).toBe(200);
    expect(
      (await bySupervisor(SUPERVISOR_PIN)(await placed([{ name: "Small beer", quantity: "1" }])))
        .status,
    ).toBe(200);
    // Had the supervisor's wrong PIN counted, this would already be 429; had their right PIN
    // cleared the count, the right PIN after it would be accepted.
    expect((await byStaff("0000")(id)).status).toBe(401);
    await expectRefusedUnwritten(id, byStaff(SUPERVISOR_PIN)(id), {
      status: 429,
      code: "pin.throttled",
    });
  });
});

describe("cancelling an invoiced order on a supervisor's PIN derives its key outside the write lock", () => {
  const anotherWriter = () => withTransaction(venue.db, (tx) => tx.execute(sql`select 1`));

  afterEach(async () => {
    await watchedOrder();
  });

  function cancelWithSupervisor(id: string, cookie = venue.cookie) {
    return send(venue.app, cookie, "POST", `/api/working-orders/${id}/cancel`, {
      reason: REASON,
      override: { personId: supervisorId, pin: SUPERVISOR_PIN },
    });
  }

  it("checks the PIN ahead for an operator holding only sale.rectify, on a receipt it cancels", async () => {
    const operator = await fixture.cookieOfPersonHolding(cv, "sale.rectify");
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    watchDerivations(SUPERVISOR_PIN, anotherWriter, anotherWriter, anotherWriter);

    const answer = await cancelWithSupervisor(id, operator);

    expect(answer.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(await voidsOf(original.id)).toEqual([{ reason: REASON, voidedBy: supervisorId }]);
  });

  it("checks the PIN ahead for an operator holding only sale.void, on an invoice it credits", async () => {
    const operator = await fixture.cookieOfPersonHolding(cv, "sale.void");
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    await creditPartly((await invoiceOf(id)).id);
    watchDerivations(SUPERVISOR_PIN, anotherWriter, anotherWriter, anotherWriter);

    const answer = await cancelWithSupervisor(id, operator);

    // The credit is refused after the PIN check: the invoice has already been partly credited.
    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "sale.correction_exceeds_total",
    });
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
  });

  it("cancels the receipt while another writer commits during the PIN check, deriving the key once", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    watchDerivations(SUPERVISOR_PIN, anotherWriter, anotherWriter, anotherWriter);

    const answer = await cancelWithSupervisor(id);

    expect(answer.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(await voidsOf(original.id)).toEqual([{ reason: REASON, voidedBy: supervisorId }]);
  });

  it("derives no key for an override sent with an order that has no invoice", async () => {
    const ticketFirst = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Barra sin factura, sin clave" })];
      return offerProducts(tx, {
        zone: { zoneId: zone!.id },
        orderStart: "counter",
      });
    });
    const id = await placed([{ name: "Small beer", quantity: "1" }], ticketFirst.zoneId, false);
    watchDerivations(SUPERVISOR_PIN, anotherWriter);

    const answer = await cancelWithSupervisor(id);

    expect(answer.status).toBe(200);
    expect(await watchedOrder()).toEqual([]);
  });
});

describe("who may approve a cancel and credit (GET /api/cancel-credit-authorizers)", () => {
  it("lists the active holders of sale.rectify, and no one else, by id and name only", async () => {
    const [suspended] = await inTx(venue, (tx) =>
      seedPersons(tx, {
        displayName: "Suspended manager",
        pinHash: hashPin("5555"),
        role: "manager",
        status: "suspended",
      }),
    );

    const listed = await send(venue.app, venue.cookie, "GET", "/api/cancel-credit-authorizers");

    expect(listed.status).toBe(200);
    const people = listed.json as unknown as Record<string, unknown>[];
    const ids = people.map((person) => person.personId);
    expect(ids).toEqual(expect.arrayContaining([venue.adminId, supervisorId]));
    expect(ids).not.toContain(venue.operatorId);
    expect(ids).not.toContain(suspended!.id);
    for (const person of people) expect(Object.keys(person)).toEqual(["personId", "displayName"]);
  });

  it("refuses a caller with no session, as the drawer's list does", async () => {
    const credit = await send(venue.app, "", "GET", "/api/cancel-credit-authorizers");
    const drawer = await send(venue.app, "", "GET", "/api/drawer/authorizers");

    expect(credit).toMatchObject({ status: 401, json: { code: "session.required" } });
    expect(credit.json).toEqual(drawer.json);
  });

  it("answers a caller with a session but no device as the drawer's list does", async () => {
    const [sessionOnly] = venue.cookie.split("; ");
    const credit = await send(venue.app, sessionOnly!, "GET", "/api/cancel-credit-authorizers");
    const drawer = await send(venue.app, sessionOnly!, "GET", "/api/drawer/authorizers");

    expect(credit.status).toBe(drawer.status);
    if (drawer.status !== 200) expect(credit.json).toEqual(drawer.json);
  });
});

/**
 * A reader provider that commits its `attempting` row before the card is asked, as the Stripe and
 * SumUp providers do, holds the card at the reader until `release`, then captures it.
 */
class CardAtTheReader extends FakePaymentProvider {
  readonly entered: Promise<void>;
  release!: () => void;
  private signal!: () => void;
  private readonly gate: Promise<void>;

  constructor() {
    super(venue.db);
    this.entered = new Promise((resolve) => (this.signal = resolve));
    this.gate = new Promise((resolve) => (this.release = resolve));
  }

  override async collect(params: Parameters<FakePaymentProvider["collect"]>[0]) {
    this.stallNextCollect();
    const asked = await super.collect(params);
    this.signal();
    await this.gate;
    const settledAt = new Date();
    await inTx(venue, (tx) =>
      captureAttempting(tx, {
        provider: this.provider,
        paymentRef: asked.paymentRef,
        settledAt,
        externalRef: `charge-${asked.paymentRef}`,
      }),
    );
    return { ...asked, state: "captured" as const, settledAt };
  }
}

function payThreeEuroByReader(id: string, submissionId = randomUUID()) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
    dining: "eat_in",
    submissionId,
    kind: "share",
    shareOf: 1,
    method: "card",
    entry: "reader",
    applied: "3.00",
    tip: "0.00",
  });
}

describe("cancelling an invoiced order while a card is paying it", () => {
  it("refuses while the card is at the reader, writing nothing, and the card then settles the invoice", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    const provider = new CardAtTheReader();
    const personId = venue.operatorId;
    const sessionId = await openTillSession(venue.db, {
      deviceId: venue.cfg.origin.deviceId,
      personId,
    });
    const paying = takeReaderBillPayment(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        provider,
      },
      venue.cfg,
      id,
      billShare("card", "3.00", { entry: "reader" }),
      { personId, sessionId },
    );
    await provider.entered;

    const refused = await observeRefusal(id, cancel(id));
    provider.release();
    const paid = await paying;

    expectUnwritten(refused, { status: 409, code: "order.payment_in_flight" });
    expect(paid.outcome).toBe("received");
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await creditsOf(original.id)).toEqual([]);
  });

  it("refuses cancellation while a captured card has not settled the invoice", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    venue.card.crashNextCollect("captured");
    const submissionId = randomUUID();
    const pay = () => payThreeEuroByReader(id, submissionId);
    const lost = await pay();
    expect(lost.status).toBe(500);

    await expectRefusedUnwritten(id, cancel(id), {
      status: 409,
      code: "order.payment_in_flight",
    });

    // Pay again settles the invoice from the captured payment, charging nothing more.
    const calls = venue.card.collectCalls.length;
    const recovered = await pay();
    expect(recovered.status).toBe(200);
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("refuses an operator without sale.rectify as not permitted while a captured card has not settled the invoice, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    venue.card.crashNextCollect("captured");
    const lost = await payThreeEuroByReader(id);
    expect(lost.status).toBe(500);

    const answer = cancel(id, venue.cookie);
    await expectRefusedUnwritten(id, answer, {
      status: 403,
      code: "authorization.not_permitted",
    });
    expect((await answer).json.params).toEqual({ permission: "sale.rectify" });
  });

  it("refuses while the card is at a reader that has written no payment yet, and the card then settles the invoice", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = payThreeEuroByReader(id);
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const paymentsWhileHeld = paymentsOf(id);

    const refused = await observeRefusal(id, cancel(id));
    const outstandingWhileHeld = await outstandingIds();
    release();
    const paid = await paying;

    expect(paymentsWhileHeld).toEqual([]);
    expectUnwritten(refused, { status: 409, code: "order.payment_in_flight" });
    expect(outstandingWhileHeld).toContain(original.id);
    expect(paid.status).toBe(200);
    expect(paid.json.outcome).toBe("received");
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await outstandingIds()).not.toContain(original.id);
    expect(tendersOf(original.id)).toEqual([{ method: "card", amount: 300 }]);
    expect(paymentsOf(id)).toEqual([{ state: "captured", saleId: original.id }]);
    expect(await creditsOf(original.id)).toEqual([]);
  });

  it("refuses an operator without sale.rectify as not permitted while the card is at a reader that has written no payment yet, writing nothing", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = payThreeEuroByReader(id);
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const paymentsWhileHeld = paymentsOf(id);

    const answer = cancel(id, venue.cookie);
    const refused = await observeRefusal(id, answer);
    release();
    const paid = await paying;

    expect(paymentsWhileHeld).toEqual([]);
    expectUnwritten(refused, { status: 403, code: "authorization.not_permitted" });
    expect((await answer).json.params).toEqual({ permission: "sale.rectify" });
    expect(paid.status).toBe(200);
    expect(paid.json.outcome).toBe("received");
  });

  it("cancels the receipt once a declined card has left the reader", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    const original = await invoiceOf(id);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    venue.card.failNextCollect();
    const paying = payThreeEuroByReader(id);
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const refused = await cancel(id);
    release();
    const declined = await paying;

    expect(refused.status).toBe(409);
    expect(declined.status).toBe(200);
    expect(declined.json.outcome).toBe("declined");

    expect(await cancel(id)).toEqual({ status: 200, json: { body: "" } });
    expect(await voidsOf(original.id)).toHaveLength(1);
    expect(await statusOf(venue, id)).toBe("abandoned");
  });

  it("refuses a card for an order cancelled before it reached the reader, asking no reader", async () => {
    const id = await placed([{ name: "Small beer", quantity: "1" }]);
    expect((await cancel(id)).status).toBe(200);
    const calls = venue.card.collectCalls.length;

    const paid = await payThreeEuroByReader(id);

    expect({ status: paid.status, code: paid.json.code }).toEqual({
      status: 409,
      code: "working_order.not_open",
    });
    expect(venue.card.collectCalls.length).toBe(calls);
    expect(paymentsOf(id)).toEqual([]);
  });
});

async function outstandingIds(): Promise<string[]> {
  const outstanding = await inTx(venue, (tx) => listOutstandingSales(tx));
  return outstanding.map((sale) => sale.saleId);
}

function tendersOf(saleId: string) {
  return venue.db.all<{ method: string; amount: number }>(
    sql`select method, amount from tenders where sale_id = ${saleId}`,
  );
}

function paymentsOf(workingOrderId: string) {
  return venue.db.all<{ state: string; saleId: string | null }>(
    sql`select state, sale_id as saleId from payments where working_order_id = ${workingOrderId}`,
  );
}

describe("cancelling a placed order with no invoice", () => {
  it("abandons it with its reasoned amendment and files nothing", async () => {
    const ticketFirst = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Barra ticket" })];
      return offerProducts(tx, {
        zone: { zoneId: zone!.id },
        orderStart: "counter",
      });
    });
    const id = await placed([{ name: "Small beer", quantity: "1" }], ticketFirst.zoneId, false);
    const before = fiscalSnapshot() as Record<string, unknown>;

    expect((await cancel(id, venue.cookie)).status).toBe(200);

    expect(fiscalSnapshot()).toEqual({ ...before, amendments: Number(before.amendments) + 1 });
    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await amendmentsOf(id)).toEqual([
      { kind: "order_placed", actorId: venue.operatorId, reason: null },
      { kind: "order_cancelled", actorId: venue.operatorId, reason: REASON },
    ]);
  });

  it("refuses while a card is at the reader for it, and the card then files its sale", async () => {
    const ticketFirst = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Barra tarjeta" })];
      return offerProducts(tx, {
        zone: { zoneId: zone!.id },
        orderStart: "counter",
      });
    });
    const id = await placed([{ name: "Small beer", quantity: "1" }], ticketFirst.zoneId, false);
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = payThreeEuroByReader(id);
    await expect.poll(() => venue.card.collectCalls.length).toBe(calls + 1);
    const before = fiscalSnapshot();

    const refused = await cancel(id, venue.cookie);
    const afterRefusal = fiscalSnapshot();
    const statusWhileHeld = await statusOf(venue, id);
    release();
    const paid = await paying;

    expect({ status: refused.status, code: refused.json.code }).toEqual({
      status: 409,
      code: "order.payment_in_flight",
    });
    expect(afterRefusal).toEqual(before);
    expect(statusWhileHeld).toBe("placed");
    expect(paid.status).toBe(200);
    expect(await statusOf(venue, id)).toBe("settled");
    const sale = await invoiceOf(id);
    expect(paymentsOf(id)).toEqual([{ state: "captured", saleId: sale.id }]);
  });
});

describe("a party's bills name the invoice and its correctives (GET /api/parties/:id/bills)", () => {
  async function billOf(partyId: string, billId: string) {
    const listed = await send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/bills`);
    expect(listed.status).toBe(200);
    return (listed.json as unknown as Record<string, unknown>[]).find(
      (bill) => bill.workingOrderId === billId,
    )!;
  }

  async function numberOf(sale: { seriesId: string; invoiceNumber: number }) {
    const [series] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, sale.seriesId)),
    );
    return `${series!.code}/${sale.invoiceNumber}`;
  }

  /** A party's main bill, placed with its invoice issued by the party leaving without paying. */
  async function invoicedPartyBill() {
    const party = await seatedWith(venue, "Small beer");
    const departed = await send(
      venue.app,
      supervisorCookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      {
        billId: party.tabId,
        expectedPartyRevision: party.revision,
        reason: "Se marcharon sin pagar",
      },
    );
    expect(departed.status).toBe(200);
    return party;
  }

  it("names the invoice of a placed bill whose invoice was issued, with no correctives", async () => {
    const party = await invoicedPartyBill();
    const original = await invoiceOf(party.tabId);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill).toMatchObject({ status: "placed", receiptAvailable: true });
    expect(bill.invoiceNumber).toBe(await numberOf(original));
    expect(bill.correctives).toEqual([]);
  });

  it("names the receipt a cancel cancelled, and no corrective", async () => {
    const party = await invoicedPartyBill();
    const original = await invoiceOf(party.tabId);
    expect((await cancel(party.tabId)).status).toBe(200);
    expect(await voidsOf(original.id)).toHaveLength(1);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill.status).toBe("abandoned");
    expect(bill.invoiceNumber).toBe(await numberOf(original));
    expect(bill.correctives).toEqual([]);
  });

  it("names neither on a placed bill with no invoice", async () => {
    const party = await seatedWith(venue, "Small beer");
    const place = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/place`,
      { expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)) },
    );
    expect(place.status).toBe(200);

    const bill = await billOf(party.partyId, party.tabId);

    expect(bill).toMatchObject({ status: "placed", receiptAvailable: false });
    expect(bill).not.toHaveProperty("invoiceNumber");
    expect(bill).not.toHaveProperty("correctives");
  });
});

describe("cancelling an invoiced counter order from the counter's waiting list", () => {
  async function waitingRow(id: string): Promise<Record<string, unknown> | undefined> {
    const answer = await send(venue.app, venue.cookie, "GET", "/api/orders/counter-waiting");
    expect(answer.status).toBe(200);
    return (answer.json as unknown as Record<string, unknown>[]).find((row) => row.id === id);
  }

  async function formattedNumberOf(sale: { seriesId: string; invoiceNumber: number }) {
    const [series] = await inTx(venue, (tx) =>
      tx
        .select({ code: invoiceSeries.code })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, sale.seriesId)),
    );
    return `${series!.code}/${sale.invoiceNumber}`;
  }

  it("lists it with its invoice, and once cancelled its receipt has one cancellation, no corrective, and it leaves the list", async () => {
    const id = await placed([
      { name: "Mosto", quantity: "1" },
      { name: "Zumo", quantity: "2" },
    ]);
    const original = await invoiceOf(id);
    expect(await waitingRow(id)).toMatchObject({
      status: "placed",
      serviceMode: "prepay",
      invoiceNumber: await formattedNumberOf(original),
    });

    expect(await cancel(id)).toEqual({ status: 200, json: { body: "" } });

    expect(await voidsOf(original.id)).toHaveLength(1);
    expect(await annulmentsOf(original.id)).toHaveLength(1);
    expect(await creditsOf(original.id)).toEqual([]);
    expect(await statusOf(venue, id)).toBe("abandoned");
    expect(await waitingRow(id)).toBeUndefined();
  });

  it("refuses a counter order already paid, writing nothing (working_order.not_placed)", async () => {
    const id = await placed([{ name: "Mosto", quantity: "1" }]);
    const paid = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "0.55",
      applied: "0.55",
      tip: "0.00",
    });
    expect(paid.status).toBe(200);
    const before = fiscalSnapshot();

    const answer = await cancel(id);

    expect({ status: answer.status, code: answer.json.code }).toEqual({
      status: 409,
      code: "working_order.not_placed",
    });
    expect(fiscalSnapshot()).toEqual(before);
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await creditsOf((await invoiceOf(id)).id)).toEqual([]);
  });
});
