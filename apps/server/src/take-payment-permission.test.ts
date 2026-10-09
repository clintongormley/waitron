import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders } from "@waitron/db";
import { payments } from "@waitron/payments";
import { AppError } from "@waitron/shared";
import { parkOrder, placeOrder } from "./working-order.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Every role holds `sale.take_payment`, so no real person can be refused it: `authorize` is wrapped
// to refuse that one permission while `gate.deny` is set, and to record what it was asked.
const gate = vi.hoisted(() => ({
  deny: false,
  calls: [] as { sessionId: string; permission: string }[],
}));
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...actual,
    authorize: async (...args: Parameters<typeof actual.authorize>) => {
      const [, request] = args;
      gate.calls.push({ sessionId: request.sessionId, permission: request.permission });
      if (gate.deny && request.permission === "sale.take_payment") {
        throw new AppError("authorization.not_permitted", { permission: request.permission });
      }
      return actual.authorize(...args);
    },
  };
});

let venue: BillVenue;
let counter: ZoneOffers;
let sessionId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const [session] = db.all<{ id: string }>(
      sql`select id from sessions where person_id = ${venue.operatorId} and ended_at is null`,
    );
    sessionId = session!.id;
  },
});

beforeEach(() => {
  gate.deny = false;
  gate.calls.length = 0;
});

function productIdOf(name: string): string {
  const [row] = venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`);
  return row!.id;
}

function workingOrderCount(id: string): number {
  const [row] = venue.db.all<{ count: number }>(
    sql`select count(*) as count from working_orders where id = ${id}`,
  );
  return row!.count;
}

function salesCount(id: string): number {
  const [row] = venue.db.all<{ count: number }>(
    sql`select count(*) as count from sales where working_order_id = ${id}`,
  );
  return row!.count;
}

function providerPaymentsOf(id: string) {
  return inTx(venue, (tx) =>
    tx.select({ id: payments.id }).from(payments).where(eq(payments.workingOrderId, id)),
  );
}

async function paymentAttemptOf(id: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ attemptAt: workingOrders.paymentAttemptAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, id)),
  );
  return row!.attemptAt;
}

/** A counter order of one Tarta (18.00), presented without an invoice. */
async function presentedTarta(): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }],
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId);
  expect(await statusOf(venue, id)).toBe("placed");
  expect(registroCount(venue, id)).toBe(0);
  return id;
}

function billPayment(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "5.00",
    applied: "5.00",
    tip: "0.00",
    ...body,
  });
}

function expectRefused(answer: { status: number; json: Record<string, unknown> }): void {
  expect(answer.status).toBe(403);
  expect(answer.json).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "sale.take_payment" },
  });
}

function expectAsked(): void {
  expect(gate.calls).toContainEqual({ sessionId, permission: "sale.take_payment" });
}

describe("POST /api/sales needs sale.take_payment", () => {
  function counterSale(id: string) {
    return send(venue.app, venue.cookie, "POST", "/api/sales", {
      lines: [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId: id,
      zoneId: counter.zoneId,
    });
  }
  function payTabByCard(tabId: string) {
    return send(venue.app, venue.cookie, "POST", "/api/sales", {
      lines: [],
      tender: { method: "card", amount: "18.00", externalRef: "OP-1" },
      workingOrderId: tabId,
    });
  }

  it("refuses a cash counter sale and keeps no order and no sale", async () => {
    gate.deny = true;
    const id = randomUUID();

    expectRefused(await counterSale(id));

    expectAsked();
    expect(workingOrderCount(id)).toBe(0);
    expect(salesCount(id)).toBe(0);
    expect(registroCount(venue, id)).toBe(0);
  });

  it("sells the same cash counter sale when the permission is held", async () => {
    const id = randomUUID();

    const answer = await counterSale(id);

    expect(answer.status).toBe(200);
    expectAsked();
    expect(await statusOf(venue, id)).toBe("settled");
    expect(registroCount(venue, id)).toBe(1);
  });

  it("refuses a hand-keyed card payment of a tab and leaves the tab open and unpaid", async () => {
    const tabId = await tabWith(venue, "Tarta");
    gate.deny = true;

    expectRefused(await payTabByCard(tabId));

    expectAsked();
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(salesCount(tabId)).toBe(0);
    expect(registroCount(venue, tabId)).toBe(0);
    expect(await tendersOfBill(venue, tabId)).toEqual([]);
  });

  it("takes the same hand-keyed card payment when the permission is held", async () => {
    const tabId = await tabWith(venue, "Tarta");

    const answer = await payTabByCard(tabId);

    expect(answer.status).toBe(200);
    expectAsked();
    expect(await statusOf(venue, tabId)).toBe("settled");
    expect(await tendersOfBill(venue, tabId)).toMatchObject([{ method: "card", amount: 1800 }]);
  });
});

describe("POST /api/pay needs sale.take_payment", () => {
  function payOnReader(tabId: string) {
    return send(venue.app, venue.cookie, "POST", "/api/pay", { id: tabId, lines: [] });
  }

  it("refuses before the reader is asked and leaves the tab open with no payment", async () => {
    const tabId = await tabWith(venue, "Tarta");
    const readerCalls = venue.card.collectCalls.length;
    gate.deny = true;

    expectRefused(await payOnReader(tabId));

    expectAsked();
    expect(venue.card.collectCalls.length).toBe(readerCalls);
    expect(await statusOf(venue, tabId)).toBe("open");
    expect(await paymentAttemptOf(tabId)).toBeNull();
    expect(await providerPaymentsOf(tabId)).toEqual([]);
    expect(registroCount(venue, tabId)).toBe(0);
  });

  it("charges the reader when the permission is held", async () => {
    const tabId = await tabWith(venue, "Tarta");
    const readerCalls = venue.card.collectCalls.length;

    const answer = await payOnReader(tabId);

    expect(answer).toMatchObject({ status: 200, json: { outcome: "captured" } });
    expectAsked();
    expect(venue.card.collectCalls.length).toBe(readerCalls + 1);
    expect(await statusOf(venue, tabId)).toBe("settled");
  });
});

describe("POST /api/working-orders/:id/collect needs sale.take_payment", () => {
  function collectCash(id: string) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/collect`, {
      tender: { method: "cash", amount: "20.00" },
    });
  }

  it("refuses and leaves the presented order placed, with no invoice and no tender", async () => {
    const id = await presentedTarta();
    gate.deny = true;

    expectRefused(await collectCash(id));

    expectAsked();
    expect(await statusOf(venue, id)).toBe("placed");
    expect(salesCount(id)).toBe(0);
    expect(registroCount(venue, id)).toBe(0);
    expect(await tendersOfBill(venue, id)).toEqual([]);
  });

  it("collects the same order when the permission is held", async () => {
    const id = await presentedTarta();

    const answer = await collectCash(id);

    expect(answer.status).toBe(200);
    expectAsked();
    expect(await statusOf(venue, id)).toBe("settled");
    expect(registroCount(venue, id)).toBe(1);
  });
});

describe("POST /api/working-orders/:id/payments needs sale.take_payment on every entry", () => {
  const entries: { name: string; body: Record<string, unknown> }[] = [
    { name: "cash", body: { method: "cash", tendered: "5.00" } },
    { name: "a hand-keyed card", body: { method: "card", entry: "manual", externalRef: "OP-2" } },
    { name: "a card on the reader", body: { method: "card", entry: "reader" } },
  ];

  it.each(entries)("refuses $name and records no payment on the bill", async ({ body }) => {
    const billId = await tabWith(venue, "Tarta");
    const readerCalls = venue.card.collectCalls.length;
    gate.deny = true;

    expectRefused(await billPayment(billId, body));

    expectAsked();
    expect(await paymentRows(venue, billId)).toEqual([]);
    expect(await providerPaymentsOf(billId)).toEqual([]);
    expect(venue.card.collectCalls.length).toBe(readerCalls);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(registroCount(venue, billId)).toBe(0);
  });

  it.each(entries)("takes $name when the permission is held", async ({ body }) => {
    const billId = await tabWith(venue, "Tarta");

    const answer = await billPayment(billId, body);

    expect(answer).toMatchObject({ status: 200, json: { payment: { state: "received" } } });
    expectAsked();
    expect(await paymentRows(venue, billId)).toMatchObject([{ state: "received", applied: 500 }]);
  });
});
