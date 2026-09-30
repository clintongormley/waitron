import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentLines, billPaymentRefunds, floorZones, saleLines, sales } from "@waitron/db";
import { parkOrder, placeOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Money through `POST /api/bills/:id/move` (table actions plan, Task 7; spec §7, §9, §15). The move
// itself is tested in `party-move-bill.test.ts`.
let venue: BillVenue;
let invoiceFirstZone: string;
/** A counter zone of its own whose orders are paid before they are sent to the kitchen. */
let prepayZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    invoiceFirstZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
      )
    ).zoneId;
    prepayZone = await inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra prepago" })
        .returning({ id: floorZones.id });
      return (
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, serviceMode: "prepay" })
      ).zoneId;
    });
  },
});

interface Body {
  submissionId?: string;
  kind: "items" | "contribution" | "share";
  lines?: { lineNo: number; quantity?: string }[];
  amount?: string;
  method: "cash" | "card";
  entry?: "manual" | "reader";
  tendered?: string;
  applied: string;
  tip: string;
}

function pay(billId: string, body: Body, opts: { cookie?: string } = {}) {
  return send(
    venue.app,
    opts.cookie ?? venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    { submissionId: randomUUID(), ...body },
  );
}

function cardContribution(billId: string, amount: string) {
  return pay(billId, {
    kind: "contribution",
    amount,
    method: "card",
    entry: "reader",
    applied: amount,
    tip: "0.00",
  });
}

function cashContribution(billId: string, amount: string) {
  return pay(billId, {
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  });
}

function post(path: string, body: unknown, cookie = venue.cookie) {
  return send(venue.app, cookie, "POST", path, body);
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

/** Ana's second bill, split off her main bill with the named lines, and Luis at another table. */
async function splitAtTwoParties(names: string[], lineNos: number[]) {
  const ana = await seatedWith(venue, ...names);
  const luis = await seatedWith(venue, "Caña");
  const split = await post(`/api/bills/${ana.tabId}/split`, {
    transfers: lineNos.map((lineNo) => ({ lineNo })),
    expectedPartyRevision: ana.revision,
  });
  expect(split.status).toBe(200);
  return { ana, luis, billId: split.json.billId as string };
}

function moveTo(
  billId: string,
  tableId: string,
  extra: Record<string, unknown> = {},
  cookie = venue.cookie,
) {
  const partyOf = venue.db.all<{ party_id: string | null }>(
    sql`select party_id from working_orders where id = ${billId}`,
  )[0]!.party_id;
  const holder = venue.db.all<{ party_id: string }>(
    sql`select party_id from party_tables where table_id = ${tableId} and left_at is null`,
  )[0]?.party_id;
  return post(
    `/api/bills/${billId}/move`,
    {
      to: { tableId },
      ...(partyOf === null ? {} : { expectedPartyRevision: revisionOf(partyOf) }),
      ...(holder === undefined
        ? {}
        : { otherPartyId: holder, expectedOtherPartyRevision: revisionOf(holder) }),
      ...extra,
    },
    cookie,
  );
}

function linesNamed(billId: string): string[] {
  return venue.db
    .all<{ name: string }>(
      sql`select name from working_order_lines where working_order_id = ${billId} order by line_no`,
    )
    .map((row) => row.name);
}

function partyOfBill(billId: string): string | null {
  return venue.db.all<{ party_id: string | null }>(
    sql`select party_id from working_orders where id = ${billId}`,
  )[0]!.party_id;
}

function holderOf(tableId: string): string | null {
  return (
    venue.db.all<{ party_id: string }>(
      sql`select party_id from party_tables where table_id = ${tableId} and left_at is null`,
    )[0]?.party_id ?? null
  );
}

async function freeTable(): Promise<string> {
  const table = await post("/api/tables", {
    label: `Mesa ${randomUUID().slice(0, 8)}`,
    zoneId: venue.zoneId,
  });
  expect(table.status).toBe(200);
  return table.json.id as string;
}

/** An open counter order in the tables' zone, so its service mode matches a party's main bill. */
async function counterOrder(...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    zoneId: venue.zoneId,
    operatorId: venue.operatorId,
  });
  return id;
}

/** Starts paying the whole bill by card at the reader, and answers once the reader is running. */
async function wholeBillAtReader(billId: string) {
  const calls = venue.card.collectCalls.length;
  const release = venue.card.holdNextCollect();
  const paying = post("/api/pay", { id: billId, lines: [] });
  await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
  const [row] = venue.db.all<{ payment_attempt_at: string | null }>(
    sql`select payment_attempt_at from working_orders where id = ${billId}`,
  );
  expect(row!.payment_attempt_at).not.toBeNull();
  return { release, paying };
}

/** The kitchen's items for the bill, and how many of them have been sent. */
function kitchenItems(billId: string): { items: number; fired: number } {
  const [row] = venue.db.all<{ items: number; fired: number }>(
    sql`select count(*) as items, count(fired_at) as fired from ticket_items
        where working_order_id = ${billId}`,
  );
  return row!;
}

/** Moves the party's bill to the counter, in `zoneId`. */
function toCounter(
  party: { partyId: string; tabId: string },
  zoneId: string,
  cookie = venue.cookie,
) {
  return post(
    `/api/bills/${party.tabId}/move`,
    {
      to: { counter: { zoneId } },
      partyId: party.partyId,
      expectedPartyRevision: revisionOf(party.partyId),
    },
    cookie,
  );
}

/** A counter order of no party in the pay-first zone, one of each dish named. */
async function prepayOrder(...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    zoneId: prepayZone,
    operatorId: venue.operatorId,
  });
  return id;
}

describe("a bill moved between service modes sends each dish to the kitchen once", () => {
  it("settles a table bill whose dish was sent, moved to a pay-first counter while its card is at the reader, with one invoice", async () => {
    const ana = await seatedWith(venue, "Pulpo");
    expect(kitchenItems(ana.tabId)).toEqual({ items: 1, fired: 1 });
    const { release, paying } = await wholeBillAtReader(ana.tabId);

    const moved = await toCounter(ana, prepayZone, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, ana.tabId)).toBe("settled");
    expect(registroCount(venue, ana.tabId)).toBe(1);
    expect(kitchenItems(ana.tabId)).toEqual({ items: 1, fired: 1 });
  });

  it("settles a table bill whose dish was sent, moved to a pay-first counter, by a cash contribution with one invoice", async () => {
    const ana = await seatedWith(venue, "Pulpo");

    const moved = await toCounter(ana, prepayZone);
    const paid = await cashContribution(ana.tabId, "20.00");

    expect(moved.status).toBe(200);
    expect(paid.status).toBe(200);
    expect(await statusOf(venue, ana.tabId)).toBe("settled");
    expect(registroCount(venue, ana.tabId)).toBe(1);
    expect(kitchenItems(ana.tabId)).toEqual({ items: 1, fired: 1 });
  });

  it.each(["cash", "card"] as const)(
    "settles a table bill whose dish was sent, moved to a pay-first counter, by a %s sale with one invoice and no second send",
    async (method) => {
      const ana = await seatedWith(venue, "Pulpo");

      const moved = await toCounter(ana, prepayZone);
      const paid = await post("/api/sales", {
        workingOrderId: ana.tabId,
        lines: [],
        tender: { method, amount: "20.00" },
      });

      expect(moved.status).toBe(200);
      expect(paid.status).toBe(200);
      expect(await statusOf(venue, ana.tabId)).toBe("settled");
      expect(registroCount(venue, ana.tabId)).toBe(1);
      expect(kitchenItems(ana.tabId)).toEqual({ items: 1, fired: 1 });
    },
  );

  it("places a table bill whose dish was sent, moved to an invoice-first counter, issuing its one invoice", async () => {
    const ana = await seatedWith(venue, "Pulpo");

    const moved = await toCounter(ana, invoiceFirstZone);
    const placed = await post(`/api/working-orders/${ana.tabId}/place`, {});

    expect(moved.status).toBe(200);
    expect(placed.status).toBe(200);
    expect(placed.json).toMatchObject({ status: "placed", total: "20.00" });
    expect(registroCount(venue, ana.tabId)).toBe(1);
    expect(kitchenItems(ana.tabId)).toEqual({ items: 1, fired: 1 });
  });

  it("sends the dish of a pay-first counter order moved into a party while its card is at the reader, and the card settles it", async () => {
    const luis = await seatedWith(venue, "Caña");
    const orderId = await prepayOrder("Pulpo");
    const { release, paying } = await wholeBillAtReader(orderId);

    const moved = await moveTo(orderId, luis.tableId, {}, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: luis.partyId, billId: orderId, merged: false });
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, orderId)).toBe("settled");
    expect(registroCount(venue, orderId)).toBe(1);
    expect(kitchenItems(orderId)).toEqual({ items: 1, fired: 1 });
  });

  it("sends the dish of a pay-first counter order when it moves into a party, and paying in cash sends nothing again", async () => {
    const luis = await seatedWith(venue, "Caña");
    const orderId = await prepayOrder("Pulpo");

    const moved = await moveTo(orderId, luis.tableId, { bills: "separate" });
    const sent = kitchenItems(orderId);
    const paid = await cashContribution(orderId, "20.00");

    expect(moved.status).toBe(200);
    expect(sent).toEqual({ items: 1, fired: 1 });
    expect(paid.status).toBe(200);
    expect(await statusOf(venue, orderId)).toBe("settled");
    expect(registroCount(venue, orderId)).toBe(1);
    expect(kitchenItems(orderId)).toEqual({ items: 1, fired: 1 });
  });
});

describe("money on a moved bill", () => {
  it("finishes a card payment still at the reader on the bill it began on, after the bill moved party", async () => {
    const ana = await seatedWith(venue, "Tarta", "Pulpo"); // €18.00 + €20.00
    const luis = await seatedWith(venue, "Caña");
    const split = await send(venue.app, venue.cookie, "POST", `/api/bills/${ana.tabId}/split`, {
      transfers: [{ lineNo: 2 }],
      expectedPartyRevision: ana.revision,
    });
    const billId = split.json.billId as string; // Pulpo, €20.00
    const body: Body = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "20.00",
      method: "card",
      entry: "reader",
      applied: "20.00",
      tip: "0.00",
    };
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const first = pay(billId, body);
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

    const moved = await send(venue.app, venue.cookie2, "POST", `/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      bills: "merge",
      expectedPartyRevision: ana.revision + 1,
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: luis.revision,
    });
    release();
    const answered = await first;
    const retry = await pay(billId, body);

    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ partyId: luis.partyId, billId, merged: false });
    expect(answered.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(retry.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
    expect(registroCount(venue, billId)).toBe(1);
    expect(await statusOf(venue, billId)).toBe("settled");
    const [row] = venue.db.all<{ party_id: string }>(
      sql`select party_id from working_orders where id = ${billId}`,
    );
    expect(row!.party_id).toBe(luis.partyId);
  });

  it("keeps a partly paid bill's payments where they were, on the same bill", async () => {
    const { luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    expect((await cashContribution(billId, "5.00")).status).toBe(200);
    const before = await paymentRows(venue, billId);

    const moved = await moveTo(billId, luis.tableId);

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: luis.partyId, billId, merged: false });
    expect(await paymentRows(venue, billId)).toEqual(before);
    expect(before.map((p) => [p.workingOrderId, p.applied, p.state])).toEqual([
      [billId, 500, "received"],
    ]);
  });

  it("refunds an earlier payment after the move, through the same bill", async () => {
    const { luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const card = await cardContribution(billId, "5.00");
    const paymentId = (card.json.payment as { id: string }).id;
    expect((await moveTo(billId, luis.tableId)).status).toBe(200);

    const refund = await post(`/api/working-orders/${billId}/payments/${paymentId}/refunds`, {
      submissionId: randomUUID(),
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Se equivocó de cuenta",
      override: { personId: venue.adminId, pin: "1234" },
    });

    expect(refund.status).toBe(200);
    expect(refund.json).toMatchObject({
      refund: { state: "completed", appliedAmount: "5.00" },
      balance: { received: "0.00", outstanding: "20.00" },
    });
    const refunds = await inTx(venue, (tx) =>
      tx
        .select({ state: billPaymentRefunds.state })
        .from(billPaymentRefunds)
        .where(eq(billPaymentRefunds.billPaymentId, paymentId)),
    );
    expect(refunds).toEqual([{ state: "completed" }]);
  });

  it("keeps an item paid for before the move applied to its line, and settles the rest in one invoice of both dishes", async () => {
    const { luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo", "Croquetas"], [2, 3]);
    const paid = await pay(billId, {
      kind: "items",
      lines: [{ lineNo: 1 }],
      method: "cash",
      tendered: "20.00",
      applied: "20.00",
      tip: "0.00",
    });
    expect(paid.status).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    const [pulpo] = venue.db.all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${billId} and line_no = 1`,
    );

    expect((await moveTo(billId, luis.tableId)).status).toBe(200);
    const applied = await inTx(venue, (tx) =>
      tx
        .select({ lineId: billPaymentLines.lineId, amount: billPaymentLines.amount })
        .from(billPaymentLines)
        .where(eq(billPaymentLines.billPaymentId, paymentId)),
    );
    const rest = await cashContribution(billId, "10.00");

    expect(applied).toEqual([{ lineId: pulpo!.id, amount: 2000 }]);
    expect(rest.json).toMatchObject({ outcome: "received", invoice: { total: "30.00" } });
    expect(await statusOf(venue, billId)).toBe("settled");
    const invoiced = await inTx(venue, (tx) =>
      tx
        .select({ name: saleLines.name })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId))
        .where(eq(sales.workingOrderId, billId))
        .orderBy(saleLines.lineNo),
    );
    expect(invoiced).toEqual([{ name: "Pulpo" }, { name: "Croquetas" }]);
    expect(registroCount(venue, billId)).toBe(1);
  });

  it("collects a presented counter bill moved into a party in another zone by settling its one invoice", async () => {
    const ana = await seatedWith(venue, "Caña");
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId: invoiceFirstZone,
      operatorId: venue.operatorId,
    });
    await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
    const issued = venue.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${id}`,
    );
    expect(issued).toHaveLength(1);

    const moved = await moveTo(id, ana.tableId);
    const collected = await post(`/api/working-orders/${id}/collect`, {
      tender: { method: "cash", amount: "18.00" },
    });

    expect(moved.json).toEqual({ partyId: ana.partyId, billId: id, merged: false });
    expect(collected.status).toBe(200);
    expect(venue.db.all(sql`select id from sales where working_order_id = ${id}`)).toEqual(issued);
    expect(registroCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
  });
});

describe("the counter's held list after a move", () => {
  type HeldRow = {
    id: string;
    partyId: string | null;
    total: string;
    outstanding: string;
    hasPayments: boolean;
  };
  async function heldRow(id: string): Promise<HeldRow | undefined> {
    const listed = await send(venue.app, venue.cookie, "GET", "/api/working-orders");
    expect(listed.status).toBe(200);
    return (listed.json as unknown as HeldRow[]).find((row) => row.id === id);
  }

  it("lists a partly paid bill taken to the counter with no party, what it still owes, and that it holds a payment", async () => {
    const ana = await seatedWith(venue, "Pulpo"); // €20.00, the party's only bill
    expect((await cashContribution(ana.tabId, "5.00")).status).toBe(200);

    const moved = await toCounter(ana, venue.zoneId);

    expect(moved.status).toBe(200);
    expect(partyOfBill(ana.tabId)).toBeNull();
    expect(await heldRow(ana.tabId)).toMatchObject({
      partyId: null,
      total: "20.00",
      outstanding: "15.00",
      hasPayments: true,
    });
  });

  it("lists a party's bill still at its table with that party, owing its whole total and holding no payment", async () => {
    const luis = await seatedWith(venue, "Caña");

    expect(await heldRow(luis.tabId)).toMatchObject({
      partyId: luis.partyId,
      total: "3.00",
      outstanding: "3.00",
      hasPayments: false,
    });
  });

  it("counts a card payment still at the reader as a payment, though nothing has been received yet", async () => {
    const orderId = await counterOrder("Tarta");
    const calls = venue.card.collectCalls.length;
    const release = venue.card.holdNextCollect();
    const paying = cardContribution(orderId, "18.00");
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

    const row = await heldRow(orderId);
    release();
    await paying;

    expect(row).toMatchObject({
      partyId: null,
      total: "18.00",
      outstanding: "18.00",
      hasPayments: true,
    });
  });
});

describe("paying a moved bill, by its state", () => {
  it("refuses a partly paid bill taken to the counter by collect, which takes only a presented bill, and by the single payment, and takes the rest as a bill payment with one invoice", async () => {
    const ana = await seatedWith(venue, "Pulpo"); // €20.00
    expect((await cashContribution(ana.tabId, "5.00")).status).toBe(200);
    expect((await toCounter(ana, venue.zoneId)).status).toBe(200);

    const collected = await post(`/api/working-orders/${ana.tabId}/collect`, {
      tender: { method: "cash", amount: "15.00" },
    });
    const sold = await post("/api/sales", {
      lines: [],
      tender: { method: "cash", amount: "15.00" },
      workingOrderId: ana.tabId,
      zoneId: venue.zoneId,
    });
    const refusedPayments = await paymentRows(venue, ana.tabId);
    const rest = await cashContribution(ana.tabId, "15.00");

    expect([collected.status, collected.json.code]).toEqual([409, "working_order.not_placed"]);
    expect([sold.status, sold.json.code]).toEqual([409, "bill.payments_received"]);
    expect(refusedPayments.map((p) => [p.applied, p.state])).toEqual([[500, "received"]]);
    expect(rest.status).toBe(200);
    expect(rest.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(await statusOf(venue, ana.tabId)).toBe("settled");
    expect(registroCount(venue, ana.tabId)).toBe(1);
  });

  it("refuses a presented bill moved into a party as a bill payment, collects it with its one sale, and the party then finishes", async () => {
    const ana = await seatedWith(venue, "Caña");
    const caña = await post(`/api/working-orders/${ana.tabId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    });
    expect(caña.status).toBe(200);
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId: invoiceFirstZone,
      operatorId: venue.operatorId,
    });
    await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
    const issued = venue.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${id}`,
    );
    expect(issued).toHaveLength(1);
    expect((await moveTo(id, ana.tableId)).status).toBe(200);

    const asPayment = await cashContribution(id, "18.00");
    const refusedFinish = await post(`/api/parties/${ana.partyId}/finish`, {
      expectedPartyRevision: revisionOf(ana.partyId),
    });
    const collected = await post(`/api/working-orders/${id}/collect`, {
      tender: { method: "cash", amount: "18.00" },
    });
    const finished = await post(`/api/parties/${ana.partyId}/finish`, {
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect([asPayment.status, asPayment.json.code]).toEqual([409, "working_order.not_open"]);
    expect(await paymentRows(venue, id)).toEqual([]);
    expect([refusedFinish.status, refusedFinish.json.code]).toEqual([
      409,
      "party.bill_outstanding",
    ]);
    expect(collected.status).toBe(200);
    expect(venue.db.all(sql`select id from sales where working_order_id = ${id}`)).toEqual(issued);
    expect(registroCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
    expect(finished.status).toBe(200);
    const [party] = venue.db.all<{ state: string }>(
      sql`select state from parties where id = ${ana.partyId}`,
    );
    expect(party!.state).toBe("closed");
  });
});

describe("a move while a whole bill is being paid by card at the reader", () => {
  it("keeps the moved bill separate from a receiving main bill being paid in full, and both complete", async () => {
    const { luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const { release, paying } = await wholeBillAtReader(luis.tabId);

    const moved = await moveTo(billId, luis.tableId, {}, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: luis.partyId, billId, merged: false });
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, luis.tabId)).toBe("settled");
    expect(registroCount(venue, luis.tabId)).toBe(1);
    expect(linesNamed(luis.tabId)).toEqual(["Caña"]);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(partyOfBill(billId)).toBe(luis.partyId);
    expect(linesNamed(billId)).toEqual(["Pulpo"]);
  });

  it("keeps a counter order being paid in full separate from the party's main bill, and its card completes on it", async () => {
    const luis = await seatedWith(venue, "Caña");
    const orderId = await counterOrder("Tarta");
    const { release, paying } = await wholeBillAtReader(orderId);

    const moved = await moveTo(orderId, luis.tableId, {}, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: luis.partyId, billId: orderId, merged: false });
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, orderId)).toBe("settled");
    expect(registroCount(venue, orderId)).toBe(1);
    expect(partyOfBill(orderId)).toBe(luis.partyId);
    expect(linesNamed(orderId)).toEqual(["Tarta"]);
    expect(await statusOf(venue, luis.tabId)).toBe("open");
    expect(linesNamed(luis.tabId)).toEqual(["Caña"]);
  });

  it("keeps the moved bill separate from a receiving main bill with a card refund in progress", async () => {
    const ana = await seatedWith(venue, "Tarta", "Pulpo");
    const luis = await seatedWith(venue, "Croquetas");
    const split = await post(`/api/bills/${ana.tabId}/split`, {
      transfers: [{ lineNo: 2 }],
      expectedPartyRevision: ana.revision,
    });
    const billId = split.json.billId as string;
    const card = await cardContribution(luis.tabId, "3.00");
    const paymentId = (card.json.payment as { id: string }).id;
    const release = venue.card.holdNextRefund();
    const refunding = post(`/api/working-orders/${luis.tabId}/payments/${paymentId}/refunds`, {
      submissionId: randomUUID(),
      appliedAmount: "3.00",
      tipAmount: "0.00",
      reason: "Se equivocó de cuenta",
      override: { personId: venue.adminId, pin: "1234" },
    });
    await vi.waitFor(() =>
      expect(
        venue.db.all(
          sql`select id from bill_payment_refunds where bill_payment_id = ${paymentId} and state = 'pending'`,
        ),
      ).toHaveLength(1),
    );

    const moved = await moveTo(billId, luis.tableId, {}, venue.cookie2);
    release();
    const refunded = await refunding;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: luis.partyId, billId, merged: false });
    expect(refunded.status).toBe(200);
    expect(linesNamed(luis.tabId)).toEqual(["Croquetas"]);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(partyOfBill(billId)).toBe(luis.partyId);
  });
});

describe("two tills moving one counter order", () => {
  for (const first of ["A", "B"] as const) {
    it(`refuses the second till's move, read with no party, as party.out_of_date (till ${first} first)`, async () => {
      const ana = await seatedWith(venue, "Caña");
      const luis = await seatedWith(venue, "Caña");
      const orderId = await counterOrder("Tarta");
      // Each till read the order at the counter, with no party.
      const tillA = () =>
        post(
          `/api/bills/${orderId}/move`,
          {
            to: { tableId: ana.tableId },
            bills: "separate",
            partyId: null,
            otherPartyId: ana.partyId,
            expectedOtherPartyRevision: ana.revision,
          },
          venue.cookie,
        );
      const tillB = () =>
        post(
          `/api/bills/${orderId}/move`,
          {
            to: { tableId: luis.tableId },
            bills: "separate",
            partyId: null,
            otherPartyId: luis.partyId,
            expectedOtherPartyRevision: luis.revision,
          },
          venue.cookie2,
        );
      const [winner, loser] = first === "A" ? [tillA, tillB] : [tillB, tillA];
      const winnerParty = first === "A" ? ana : luis;

      const won = await winner();
      const revisions = [revisionOf(ana.partyId), revisionOf(luis.partyId)];
      const lost = await loser();

      expect(won.status).toBe(200);
      expect(won.json).toEqual({ partyId: winnerParty.partyId, billId: orderId, merged: false });
      expect(lost.status).toBe(409);
      expect(lost.json).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: winnerParty.partyId, revision: revisionOf(winnerParty.partyId) },
      });
      expect([revisionOf(ana.partyId), revisionOf(luis.partyId)]).toEqual(revisions);
      expect(partyOfBill(orderId)).toBe(winnerParty.partyId);
    });
  }

  it("refuses a move naming a party for a bill another till has taken to the counter", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const read = revisionOf(ana.partyId);
    const toCounter = await post(
      `/api/bills/${billId}/move`,
      { to: { counter: { zoneId: null } }, partyId: ana.partyId, expectedPartyRevision: read },
      venue.cookie,
    );

    const lost = await post(
      `/api/bills/${billId}/move`,
      {
        to: { tableId: luis.tableId },
        partyId: ana.partyId,
        expectedPartyRevision: read,
        otherPartyId: luis.partyId,
        expectedOtherPartyRevision: revisionOf(luis.partyId),
      },
      venue.cookie2,
    );

    expect(toCounter.status).toBe(200);
    expect(lost.status).toBe(409);
    expect(lost.json).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: ana.partyId, revision: revisionOf(ana.partyId) },
    });
    expect(partyOfBill(billId)).toBeNull();
  });

  it("still refuses a party's bill sent with neither a party nor its revision", async () => {
    const { luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: revisionOf(luis.partyId),
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedPartyRevision" },
    });
  });
});

describe("the move route", () => {
  it("refuses a paid bill with 409 bill.paid, changing nothing", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    expect((await cashContribution(billId, "20.00")).status).toBe(200);
    const revisions = [revisionOf(ana.partyId), revisionOf(luis.partyId)];

    const answer = await moveTo(billId, luis.tableId);

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "bill.paid", params: { workingOrderId: billId } });
    expect([revisionOf(ana.partyId), revisionOf(luis.partyId)]).toEqual(revisions);
    expect(await statusOf(venue, billId)).toBe("settled");
  });

  it("answers 401 without a session", async () => {
    const { luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

    const answer = await send(venue.app, "", "POST", `/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
    });

    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
  });

  it("answers a malformed bill id with 409 tab.not_open", async () => {
    const answer = await post(`/api/bills/not-a-uuid/move`, { to: { counter: { zoneId: null } } });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "tab.not_open", params: { tabId: "not-a-uuid" } });
  });

  const BAD_TARGETS: unknown[] = [
    undefined,
    null,
    "counter",
    [],
    {},
    { tableId: 7 },
    { counter: null },
    { counter: {} },
    { counter: { zoneId: 7 } },
    { counter: { zoneId: null, extra: 1 } },
    { tableId: randomUUID(), counter: { zoneId: null } },
    { tableId: randomUUID(), extra: 1 },
  ];

  it.each(BAD_TARGETS.map((to) => ({ to })))(
    "answers the target $to with 400 management.request_invalid, changing nothing",
    async ({ to }) => {
      const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
      const revision = revisionOf(ana.partyId);

      const answer = await post(`/api/bills/${billId}/move`, {
        to,
        expectedPartyRevision: revision,
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "to" },
      });
      expect(revisionOf(ana.partyId)).toBe(revision);
    },
  );

  it("answers a malformed table id as the seat and tab routes do, with 404 table.not_found", async () => {
    const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const revision = revisionOf(ana.partyId);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: "not-a-uuid" },
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(404);
    expect(answer.json).toMatchObject({
      code: "table.not_found",
      params: { tableId: "not-a-uuid" },
    });
    expect(revisionOf(ana.partyId)).toBe(revision);
  });

  it("answers a malformed counter zone id as the sale route does, with 400 shared.invalid_id", async () => {
    const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const revision = revisionOf(ana.partyId);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { counter: { zoneId: "not-a-uuid" } },
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "shared.invalid_id",
      params: { kind: "ServiceZoneId", value: "not-a-uuid" },
    });
    expect(revisionOf(ana.partyId)).toBe(revision);
  });

  it.each([["together"], [null], [1]])(
    "answers the bill choice %j with 400 management.request_invalid",
    async (bills) => {
      const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

      const answer = await post(`/api/bills/${billId}/move`, {
        to: { counter: { zoneId: null } },
        bills,
        expectedPartyRevision: revisionOf(ana.partyId),
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "bills" },
      });
    },
  );

  it.each([
    ["expectedPartyRevision", -1],
    ["expectedOtherPartyRevision", "3"],
    ["otherPartyId", "not-a-uuid"],
  ])("answers a malformed %s with 400 management.request_invalid", async (field, value) => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      expectedPartyRevision: revisionOf(ana.partyId),
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: revisionOf(luis.partyId),
      [field]: value,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
  });

  it("answers a move sent with the target read free (otherPartyId null) to a table a party now holds with 409 party.out_of_date, changing nothing", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const revisions = [revisionOf(ana.partyId), revisionOf(luis.partyId)];

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      expectedPartyRevision: revisions[0],
      partyId: ana.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: luis.partyId, revision: revisions[1] },
    });
    expect([revisionOf(ana.partyId), revisionOf(luis.partyId)]).toEqual(revisions);
    expect(partyOfBill(billId)).toBe(ana.partyId);
  });

  it("takes a move sent with the target read free (otherPartyId null) to a table still free, opening a new party there", async () => {
    const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const to = await freeTable();

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: to },
      expectedPartyRevision: revisionOf(ana.partyId),
      partyId: ana.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: expect.any(String), billId, merged: false });
    expect(answer.json.partyId).not.toBe(ana.partyId);
    expect(partyOfBill(billId)).toBe(answer.json.partyId);
    expect(holderOf(to)).toBe(answer.json.partyId);
  });

  it("answers a move sent with the target read free to its own party's table with 409 table.already_in_party, changing nothing", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const revisions = [revisionOf(ana.partyId), revisionOf(luis.partyId)];

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: ana.tableId },
      expectedPartyRevision: revisions[0],
      partyId: ana.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "table.already_in_party",
      params: { tableId: ana.tableId },
    });
    expect([revisionOf(ana.partyId), revisionOf(luis.partyId)]).toEqual(revisions);
    expect(partyOfBill(billId)).toBe(ana.partyId);
  });

  it("answers a move sent with the target read free and another party's revision with 400, changing nothing", async () => {
    const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const revision = revisionOf(ana.partyId);
    const to = await freeTable();

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: to },
      expectedPartyRevision: revision,
      partyId: ana.partyId,
      otherPartyId: null,
      expectedOtherPartyRevision: 3,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "otherPartyId" },
    });
    expect(revisionOf(ana.partyId)).toBe(revision);
    expect(partyOfBill(billId)).toBe(ana.partyId);
    expect(holderOf(to)).toBeNull();
  });

  it("answers the other party's revision sent without its id with 400, changing nothing", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const revisions = [revisionOf(ana.partyId), revisionOf(luis.partyId)];

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      expectedPartyRevision: revisions[0],
      expectedOtherPartyRevision: revisions[1],
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "otherPartyId" },
    });
    expect([revisionOf(ana.partyId), revisionOf(luis.partyId)]).toEqual(revisions);
    expect(partyOfBill(billId)).toBe(ana.partyId);
  });

  it("takes the other party's id in upper case as in lower", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      bills: "separate",
      expectedPartyRevision: revisionOf(ana.partyId),
      otherPartyId: luis.partyId.toUpperCase(),
      expectedOtherPartyRevision: revisionOf(luis.partyId),
    });

    expect(answer.status).toBe(200);
    expect(partyOfBill(billId)).toBe(luis.partyId);
  });

  it("answers a move to a table the party it read there has left with 409 party.out_of_date", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const read = {
      expectedPartyRevision: revisionOf(ana.partyId),
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: revisionOf(luis.partyId),
    };
    const left = await post(`/api/parties/${luis.partyId}/move`, {
      toTableId: (
        await post("/api/tables", {
          label: `Mesa ${randomUUID().slice(0, 8)}`,
          zoneId: venue.zoneId,
        })
      ).json.id,
      expectedPartyRevision: read.expectedOtherPartyRevision,
    });
    expect(left.status).toBe(200);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      ...read,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: luis.partyId, revision: revisionOf(luis.partyId) },
    });
    expect(partyOfBill(billId)).toBe(ana.partyId);
  });

  it("merges by default, and answers the new codes with 409", async () => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);
    const own = await moveTo(billId, ana.tableId);
    const mainStays = await post(`/api/bills/${ana.tabId}/move`, {
      to: { counter: { zoneId: null } },
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    const merged = await moveTo(billId, luis.tableId);

    expect(own.status).toBe(409);
    expect(own.json).toMatchObject({
      code: "table.already_in_party",
      params: { tableId: ana.tableId },
    });
    expect(mainStays.status).toBe(409);
    expect(mainStays.json).toMatchObject({
      code: "party.main_bill_stays",
      params: { partyId: ana.partyId },
    });
    expect(merged.status).toBe(200);
    expect(merged.json).toEqual({ partyId: luis.partyId, billId: luis.tabId, merged: true });
    expect(await statusOf(venue, billId)).toBe("abandoned");
  });

  it("moves a bill to the counter in the zone sent, answering no party", async () => {
    const { ana, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { counter: { zoneId: invoiceFirstZone.toUpperCase() } },
      bills: "separate",
      partyId: ana.partyId,
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: null, billId, merged: false });
    const [context] = venue.db.all<{ zone_id: string }>(
      sql`select zone_id from order_service_contexts where working_order_id = ${billId}`,
    );
    expect(context!.zone_id).toBe(invoiceFirstZone);
  });
});
