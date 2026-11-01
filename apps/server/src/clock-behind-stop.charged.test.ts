import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import type { TrustedClock } from "@waitron/fiscal";
import { getPaymentByRef, insertCapturedPayment, recordResolution } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { recoverAutomaticCardPayments } from "./pending-card-recovery.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";

// Every case reads NOW, the latest record's time, and builds each clock from it, because each sale
// moves NOW for the cases after it.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const dish = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      dishId = dish.id;
      await assignCatalogueToLocation(tx, venue.cfg.locationId, catalogue.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [dishId] });
    });
    const first = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: randomUUID(),
      zoneId: counter.zoneId,
      lines: dish(),
      tender: { method: "cash", amount: "10.00" },
    });
    if (first.status !== 200) throw new Error(`setup sale answered ${first.status}`);
  },
});

const MINUTE = 60_000;

function latest(): { at: Date; offsetMinutes: number } {
  const [row] = venue.db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return { at: new Date(row!.at), offsetMinutes: row!.offsetMinutes };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

/** A clock that reads `ms` until moved. */
function movableClock(ms: number): { clock: TrustedClock; moveTo: (next: number) => void } {
  const base = systemClock();
  let at = ms;
  return {
    clock: { ...base, now: () => ({ ...base.now(), instant: new Date(at), offsetMinutes: 60 }) },
    moveTo: (next) => {
      at = next;
    },
  };
}

function behindChain(clockMs: number) {
  const record = latest();
  return {
    code: "clock.behind_chain",
    params: {
      clockAt: new Date(clockMs).toISOString(),
      offsetMinutes: 60,
      lastRecordAt: record.at.toISOString(),
      lastRecordOffsetMinutes: record.offsetMinutes,
    },
  };
}

const chargedNotRecorded = (workingOrderId: string) => ({
  code: "sale.charged_not_recorded",
  params: { workingOrderId, reason: "clock_behind_chain" },
});

function dish() {
  return [{ menuItemId: counter.offerFor(dishId), quantity: "1" }];
}

function cardSale(app: BillVenue["app"], id: string) {
  return send(app, venue.cookie, "POST", "/api/pay", { id, lines: dish(), zoneId: counter.zoneId });
}

function payStored(app: BillVenue["app"], id: string) {
  return send(app, venue.cookie, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId });
}

function payBill(app: BillVenue["app"], billId: string, amount: string) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "card",
    entry: "reader",
    applied: amount,
    tip: "0.00",
  });
}

const collects = () => venue.card.collectCalls.length;

/** Starts `request` with the next collect held; answers once the reader has been reached. */
async function heldAtReader<T>(request: () => Promise<T>) {
  const release = venue.card.holdNextCollect();
  const calls = collects();
  const answer = request();
  await vi.waitFor(() => expect(collects()).toBe(calls + 1));
  return { answer, release };
}

function allRecords(): number {
  const [row] = venue.db.all<{ n: number }>(sql`select count(*) as n from registros_facturacion`);
  return row!.n;
}

function count(table: string, column: string, id: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`,
  );
  return row!.n;
}

function capturedUnlinked(id: string): number {
  const [row] = venue.db.all<{ n: number }>(sql`
    select count(*) as n from payments
    where working_order_id = ${id} and state = 'captured' and sale_id is null
  `);
  return row!.n;
}

/** The order's card tender's time and its provider payment's own `settled_at`. */
function tenderTimes(id: string): { tender: number; provider: number }[] {
  return venue.db
    .all<{ tender: string; provider: string }>(
      sql`
        select t.settled_at as tender, p.settled_at as provider
        from tenders t
        join sales s on s.id = t.sale_id
        join payments p on p.sale_id = s.id
        where s.working_order_id = ${id} and t.method = 'card'
      `,
    )
    .map((row) => ({
      tender: new Date(row.tender).getTime(),
      provider: new Date(row.provider).getTime(),
    }));
}

/** Each bill payment's state and received time, beside its provider payment's `settled_at`. */
function billPaymentTimes(billId: string) {
  return venue.db
    .all<{ state: string; received: string | null; provider: string }>(
      sql`
        select b.state as state, b.received_at as received, p.settled_at as provider
        from bill_payments b
        join payments p on p.bill_payment_id = b.id
        where b.working_order_id = ${billId}
      `,
    )
    .map((row) => ({
      state: row.state,
      received: row.received === null ? null : new Date(row.received).getTime(),
      provider: new Date(row.provider).getTime(),
    }));
}

async function placedIssuedOrder(clock: TrustedClock): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: dish(),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await issueOrderInvoice(
    { ...deps, admission: testTradingAdmission() },
    venue.cfg,
    id,
    venue.operatorId,
  );
  await placeOrder({ ...deps, admission: testTradingAdmission() }, venue.cfg, id, venue.operatorId);
  return id;
}

it("a card charged as the stop begins says so, and Pay records it without charging again", async () => {
  const now = nowMs();
  const behind = now - 10 * MINUTE;
  const id = randomUUID();
  const records = allRecords();
  const before = collects();
  const reader = movableClock(now + MINUTE);

  const { answer, release } = await heldAtReader(() => cardSale(venue.appAt(reader.clock), id));
  reader.moveTo(behind);
  release();
  const charged = await answer;

  expect(charged.status).toBe(507);
  expect(charged.json).toEqual(chargedNotRecorded(id));
  expect(collects()).toBe(before + 1);
  expect(capturedUnlinked(id)).toBe(1);
  expect(count("sales", "working_order_id", id)).toBe(0);
  expect(allRecords()).toBe(records);

  const refused = await payStored(venue.appAt(clockAt(behind)), id);

  expect(refused.status).toBe(409);
  expect(refused.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before + 1);

  const paid = await payStored(venue.appAt(clockAt(now + 2 * MINUTE)), id);

  expect(paid.status).toBe(200);
  expect(paid.json.outcome).toBe("captured");
  expect(collects()).toBe(before + 1);
  expect(count("sales", "working_order_id", id)).toBe(1);
  expect(registroCount(venue, id)).toBe(1);
  expect(allRecords()).toBe(records + 1);
});

it("the automatic recovery files nothing during the stop, then files it", async () => {
  const now = nowMs();
  const behind = now - 10 * MINUTE;
  const billId = await tabWith(venue, "Paella");
  const paymentRef = randomUUID();
  await withTransaction(venue.db, async (tx) => {
    await insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      workingOrderId: billId,
      provider: "fake",
      paymentRef,
      amount: decimal("35.00"),
      settledAt: new Date(now),
    });
    const payment = (await getPaymentByRef(tx, { provider: "fake", paymentRef }))!;
    await recordResolution(tx, {
      paymentId: payment.id,
      workingOrderId: billId,
      personId: null,
      outcome: "captured",
      cancelledAtProvider: false,
      providerStatus: "succeeded",
      resolvedAt: new Date(now),
    });
  });
  const before = collects();

  const stopped = await recoverAutomaticCardPayments({
    admission: testTradingAdmission(),
    ...venue,
    clock: clockAt(behind),
  });

  expect(stopped.filed).toBe(0);
  expect(stopped.errors).toEqual([
    { paymentId: expect.any(String), error: expect.stringContaining("clock.behind_chain") },
  ]);
  expect(registroCount(venue, billId)).toBe(0);

  const resumed = await recoverAutomaticCardPayments({
    admission: testTradingAdmission(),
    ...venue,
    clock: clockAt(now + MINUTE),
  });

  expect(resumed).toEqual({ filed: 1, errors: [] });
  expect(collects()).toBe(before);
  expect(await statusOf(venue, billId)).toBe("settled");
  expect(registroCount(venue, billId)).toBe(1);
});

it("a card on a bill as the stop begins says so, and the pending pass completes it once the clock moves on", async () => {
  const now = nowMs();
  const behind = now - 10 * MINUTE;
  const billId = await tabWith(venue, "Paella");
  const before = collects();
  const reader = movableClock(now + MINUTE);

  const { answer, release } = await heldAtReader(() =>
    payBill(venue.appAt(reader.clock), billId, "35.00"),
  );
  reader.moveTo(behind);
  release();
  const charged = await answer;

  expect(charged.status).toBe(507);
  expect(charged.json).toEqual(chargedNotRecorded(billId));
  expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["pending"]);
  expect(registroCount(venue, billId)).toBe(0);

  await settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: clockAt(now + 2 * MINUTE),
    cfg: venue.cfg,
  });

  expect((await paymentRows(venue, billId)).map((row) => row.state)).toEqual(["received"]);
  expect(await statusOf(venue, billId)).toBe("settled");
  expect(registroCount(venue, billId)).toBe(1);
  expect(collects()).toBe(before + 1);
});

it("a card charged as the stop begins on an already-invoiced order is recorded, dated by the provider", async () => {
  const now = nowMs();
  const behind = now - 10 * MINUTE;
  const id = await placedIssuedOrder(clockAt(now));
  const records = allRecords();
  const before = collects();
  const reader = movableClock(now);

  const { answer, release } = await heldAtReader(() => payStored(venue.appAt(reader.clock), id));
  reader.moveTo(behind);
  release();
  const paid = await answer;

  expect(paid.status).toBe(200);
  expect(paid.json.outcome).toBe("captured");
  expect(collects()).toBe(before + 1);
  const [times] = tenderTimes(id);
  expect(times!.tender).toBe(times!.provider);
  expect(times!.tender).not.toBe(behind);
  expect(allRecords()).toBe(records);
});

it("a card part payment charged as the stop begins is received, dated by the provider", async () => {
  const now = nowMs();
  const behind = now - 10 * MINUTE;
  const billId = await tabWith(venue, "Paella");
  const records = allRecords();
  const before = collects();
  const reader = movableClock(now);

  const { answer, release } = await heldAtReader(() =>
    payBill(venue.appAt(reader.clock), billId, "10.00"),
  );
  reader.moveTo(behind);
  release();
  const paid = await answer;

  expect(paid.status).toBe(200);
  expect(paid.json.outcome).toBe("received");
  expect(collects()).toBe(before + 1);
  const [times] = billPaymentTimes(billId);
  expect(times!.state).toBe("received");
  expect(times!.received).toBe(times!.provider);
  expect(times!.received).not.toBe(behind);
  expect(await statusOf(venue, billId)).toBe("open");
  expect(allRecords()).toBe(records);
});
