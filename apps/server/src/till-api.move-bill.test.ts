import { seedZone } from "@waitron/db/testing/seed.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedTableActionBody } from "./testing/table-action-fixture.js";
import { observedMoveBillBody } from "./testing/move-bill-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentLines, billPaymentRefunds, saleLines, sales } from "@waitron/db";
import { parkOrder } from "./working-order.js";
import { createTable } from "./testing/live-table.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  fiscalRecordCount,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Money through `POST /api/bills/:id/move` (table actions plan, Task 7; spec §7, §9, §15). The move
// itself is tested in `party-move-bill.test.ts`.
let venue: BillVenue;
let ticketThenPayZone: string;
/** A counter zone of its own whose orders are paid before they are sent to the kitchen. */
let prepayZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    ticketThenPayZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      )
    ).zoneId;
    prepayZone = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Barra prepago" })];
      return (
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, orderStart: "counter" })
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

async function post(path: string, body: unknown, cookie = venue.cookie) {
  body = await observedTableActionBody(
    venue.db,
    path,
    await observedMoveBillBody(venue.db, path, body),
  );
  const place = /^\/api\/working-orders\/([^/]+)\/place$/.exec(path);
  if (place !== null && body !== null && typeof body === "object")
    body = { expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, place[1]!)), ...body };
  return send(venue.app, cookie, "POST", path, body);
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function lineIdsAt(billId: string, lineNos: number[]): string[] {
  return lineNos.map(
    (lineNo) =>
      venue.db.all<{ id: string }>(
        sql`select id from working_order_lines
            where working_order_id = ${billId} and line_no = ${lineNo}`,
      )[0]!.id,
  );
}

async function splitAtTwoParties(names: string[], lineNos: number[]) {
  const firstParty = await seatedWith(venue, ...names);
  const secondParty = await seatedWith(venue, "Caña");
  const split = await post(
    `/api/bills/${firstParty.tabId}/move-dishes`,
    await observedBillActionBody(venue.db, `/api/bills/${firstParty.tabId}/move-dishes`, {
      lineIds: lineIdsAt(firstParty.tabId, lineNos),
      toBillId: null,
      expectedPartyRevision: firstParty.revision,
    }),
  );
  expect(split.status).toBe(200);
  return { firstParty, secondParty, billId: split.json.billId as string };
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
  const { id } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `Mesa ${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  return id;
}

/** An open counter order in the tables' zone, so its service mode matches the bills of a party seated there. */
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
        where working_order_line_id in (select id from working_order_lines where working_order_id = ${billId})`,
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
    const firstParty = await seatedWith(venue, "Octopus");
    expect(kitchenItems(firstParty.tabId)).toEqual({ items: 1, fired: 1 });
    const { release, paying } = await wholeBillAtReader(firstParty.tabId);

    const moved = await toCounter(firstParty, prepayZone, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, firstParty.tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, firstParty.tabId)).toBe(1);
    expect(kitchenItems(firstParty.tabId)).toEqual({ items: 1, fired: 1 });
  });

  it("settles a table bill whose dish was sent, moved to a pay-first counter, by a cash contribution with one invoice", async () => {
    const firstParty = await seatedWith(venue, "Octopus");

    const moved = await toCounter(firstParty, prepayZone);
    const paid = await cashContribution(firstParty.tabId, "20.00");

    expect(moved.status).toBe(200);
    expect(paid.status).toBe(200);
    expect(await statusOf(venue, firstParty.tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, firstParty.tabId)).toBe(1);
    expect(kitchenItems(firstParty.tabId)).toEqual({ items: 1, fired: 1 });
  });

  it.each(["cash", "card"] as const)(
    "settles a table bill whose dish was sent, moved to a pay-first counter, by a %s sale with one invoice and no second send",
    async (method) => {
      const firstParty = await seatedWith(venue, "Octopus");

      const moved = await toCounter(firstParty, prepayZone);
      const paid = await post("/api/sales", {
        workingOrderId: firstParty.tabId,
        lines: [],
        tender: { method, amount: "20.00" },
      });

      expect(moved.status).toBe(200);
      expect(paid.status).toBe(200);
      expect(await statusOf(venue, firstParty.tabId)).toBe("settled");
      expect(fiscalRecordCount(venue, firstParty.tabId)).toBe(1);
      expect(kitchenItems(firstParty.tabId)).toEqual({ items: 1, fired: 1 });
    },
  );

  it("places a sent table bill moved to a ticket-then-pay counter without filing, then collects its one invoice without sending again", async () => {
    const firstParty = await seatedWith(venue, "Octopus");

    const moved = await toCounter(firstParty, ticketThenPayZone);
    const placed = await post(`/api/working-orders/${firstParty.tabId}/place`, {});

    expect(moved.status).toBe(200);
    expect(placed.status).toBe(200);
    expect(placed.json).toEqual({ id: firstParty.tabId, status: "placed" });
    expect(fiscalRecordCount(venue, firstParty.tabId)).toBe(0);
    expect(
      venue.db.all(sql`select id from sales where working_order_id = ${firstParty.tabId}`),
    ).toEqual([]);
    expect(kitchenItems(firstParty.tabId)).toEqual({ items: 1, fired: 1 });

    const collected = await post(`/api/working-orders/${firstParty.tabId}/collect`, {
      tender: { method: "cash", amount: "20.00" },
    });
    expect(collected.status).toBe(200);
    expect(collected.json).toMatchObject({
      total: "20.00",
      invoiceNumber: expect.stringMatching(/^A\/\d+$/),
    });
    expect(await statusOf(venue, firstParty.tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, firstParty.tabId)).toBe(1);
    expect(kitchenItems(firstParty.tabId)).toEqual({ items: 1, fired: 1 });
  });

  it("sends the dish of a pay-first counter order moved into a party while its card is at the reader, and the card settles it", async () => {
    const seatedParty = await seatedWith(venue, "Caña");
    const orderId = await prepayOrder("Octopus");
    const { release, paying } = await wholeBillAtReader(orderId);

    const moved = await moveTo(orderId, seatedParty.tableId, {}, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: seatedParty.partyId, billId: orderId });
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, orderId)).toBe("settled");
    expect(fiscalRecordCount(venue, orderId)).toBe(1);
    expect(kitchenItems(orderId)).toEqual({ items: 1, fired: 1 });
  });

  it("sends the dish of a pay-first counter order when it moves into a party, and paying in cash sends nothing again", async () => {
    const seatedParty = await seatedWith(venue, "Caña");
    const orderId = await prepayOrder("Octopus");

    const moved = await moveTo(orderId, seatedParty.tableId);
    const sent = kitchenItems(orderId);
    const paid = await cashContribution(orderId, "20.00");

    expect(moved.status).toBe(200);
    expect(sent).toEqual({ items: 1, fired: 1 });
    expect(paid.status).toBe(200);
    expect(await statusOf(venue, orderId)).toBe("settled");
    expect(fiscalRecordCount(venue, orderId)).toBe(1);
    expect(kitchenItems(orderId)).toEqual({ items: 1, fired: 1 });
  });
});

describe("money on a moved bill", () => {
  it("finishes a card payment still at the reader on the bill it began on, after the bill moved party", async () => {
    const firstParty = await seatedWith(venue, "Tarta", "Octopus"); // €18.00 + €20.00
    const secondParty = await seatedWith(venue, "Caña");
    const split = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/bills/${firstParty.tabId}/move-dishes`,
      await observedBillActionBody(venue.db, `/api/bills/${firstParty.tabId}/move-dishes`, {
        lineIds: lineIdsAt(firstParty.tabId, [2]),
        toBillId: null,
        expectedPartyRevision: firstParty.revision,
      }),
    );
    const billId = split.json.billId as string; // Octopus, €20.00
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

    const moved = await post(
      `/api/bills/${billId}/move`,
      {
        to: { tableId: secondParty.tableId },
        expectedPartyRevision: firstParty.revision + 1,
        otherPartyId: secondParty.partyId,
        expectedOtherPartyRevision: secondParty.revision,
      },
      venue.cookie2,
    );
    release();
    const answered = await first;
    const retry = await pay(billId, body);

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: secondParty.partyId, billId });
    expect(answered.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(retry.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(venue.card.collectCalls.length).toBe(calls + 1);
    expect(await paymentRows(venue, billId)).toHaveLength(1);
    expect(fiscalRecordCount(venue, billId)).toBe(1);
    expect(await statusOf(venue, billId)).toBe("settled");
    const [row] = venue.db.all<{ party_id: string }>(
      sql`select party_id from working_orders where id = ${billId}`,
    );
    expect(row!.party_id).toBe(secondParty.partyId);
  });

  it("keeps a partly paid bill's payments where they were, on the same bill", async () => {
    const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    expect((await cashContribution(billId, "5.00")).status).toBe(200);
    const before = await paymentRows(venue, billId);

    const moved = await moveTo(billId, secondParty.tableId);

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: secondParty.partyId, billId });
    expect(await paymentRows(venue, billId)).toEqual(before);
    expect(before.map((p) => [p.workingOrderId, p.applied, p.state])).toEqual([
      [billId, 500, "received"],
    ]);
  });

  it("refunds an earlier payment after the move, through the same bill", async () => {
    const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const card = await cardContribution(billId, "5.00");
    const paymentId = (card.json.payment as { id: string }).id;
    expect((await moveTo(billId, secondParty.tableId)).status).toBe(200);

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
    const { secondParty, billId } = await splitAtTwoParties(
      ["Tarta", "Octopus", "Croquettes"],
      [2, 3],
    );
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
    const [octopusLine] = venue.db.all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${billId} and line_no = 1`,
    );

    expect((await moveTo(billId, secondParty.tableId)).status).toBe(200);
    const applied = await inTx(venue, (tx) =>
      tx
        .select({ lineId: billPaymentLines.lineId, amount: billPaymentLines.amount })
        .from(billPaymentLines)
        .where(eq(billPaymentLines.billPaymentId, paymentId)),
    );
    const rest = await cashContribution(billId, "10.00");

    expect(applied).toEqual([{ lineId: octopusLine!.id, amount: 2000 }]);
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
    expect(invoiced).toEqual([{ name: "Octopus" }, { name: "Croquettes" }]);
    expect(fiscalRecordCount(venue, billId)).toBe(1);
  });

  it("collects a presented counter bill moved into a party in another zone by settling its one invoice", async () => {
    const firstParty = await seatedWith(venue, "Caña");
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId: ticketThenPayZone,
      operatorId: venue.operatorId,
    });
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    await issueOrderInvoice(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    const issued = venue.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${id}`,
    );
    expect(issued).toHaveLength(1);

    const moved = await moveTo(id, firstParty.tableId);
    const collected = await post(`/api/working-orders/${id}/collect`, {
      tender: { method: "cash", amount: "18.00" },
    });

    expect(moved.json).toEqual({ partyId: firstParty.partyId, billId: id });
    expect(collected.status).toBe(200);
    expect(venue.db.all(sql`select id from sales where working_order_id = ${id}`)).toEqual(issued);
    expect(fiscalRecordCount(venue, id)).toBe(1);
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
    const firstParty = await seatedWith(venue, "Octopus"); // €20.00, the party's only bill
    expect((await cashContribution(firstParty.tabId, "5.00")).status).toBe(200);

    const moved = await toCounter(firstParty, venue.zoneId);

    expect(moved.status).toBe(200);
    expect(partyOfBill(firstParty.tabId)).toBeNull();
    expect(await heldRow(firstParty.tabId)).toMatchObject({
      partyId: null,
      total: "20.00",
      outstanding: "15.00",
      hasPayments: true,
    });
  });

  it("lists a party's bill still at its table with that party, owing its whole total and holding no payment", async () => {
    const seatedParty = await seatedWith(venue, "Caña");

    expect(await heldRow(seatedParty.tabId)).toMatchObject({
      partyId: seatedParty.partyId,
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
    const firstParty = await seatedWith(venue, "Octopus"); // €20.00
    expect((await cashContribution(firstParty.tabId, "5.00")).status).toBe(200);
    expect((await toCounter(firstParty, venue.zoneId)).status).toBe(200);

    const collected = await post(`/api/working-orders/${firstParty.tabId}/collect`, {
      tender: { method: "cash", amount: "15.00" },
    });
    const sold = await post("/api/sales", {
      lines: [],
      tender: { method: "cash", amount: "15.00" },
      workingOrderId: firstParty.tabId,
      zoneId: venue.zoneId,
    });
    const refusedPayments = await paymentRows(venue, firstParty.tabId);
    const rest = await cashContribution(firstParty.tabId, "15.00");

    expect([collected.status, collected.json.code]).toEqual([409, "working_order.not_placed"]);
    expect([sold.status, sold.json.code]).toEqual([409, "bill.payments_received"]);
    expect(refusedPayments.map((p) => [p.applied, p.state])).toEqual([[500, "received"]]);
    expect(rest.status).toBe(200);
    expect(rest.json).toMatchObject({ outcome: "received", invoice: { total: "20.00" } });
    expect(await statusOf(venue, firstParty.tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, firstParty.tabId)).toBe(1);
  });

  it("refuses a presented bill moved into a party as a bill payment, collects it with its one sale, and the party then finishes", async () => {
    const firstParty = await seatedWith(venue, "Caña");
    const beerPayment = await post(`/api/working-orders/${firstParty.tabId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    });
    expect(beerPayment.status).toBe(200);
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId: ticketThenPayZone,
      operatorId: venue.operatorId,
    });
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    await issueOrderInvoice(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
    const issued = venue.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${id}`,
    );
    expect(issued).toHaveLength(1);
    expect((await moveTo(id, firstParty.tableId)).status).toBe(200);

    const asPayment = await cashContribution(id, "18.00");
    const refusedFinish = await post(`/api/parties/${firstParty.partyId}/finish`, {
      expectedPartyRevision: revisionOf(firstParty.partyId),
    });
    const collected = await post(`/api/working-orders/${id}/collect`, {
      tender: { method: "cash", amount: "18.00" },
    });
    const unserved = await post(`/api/parties/${firstParty.partyId}/finish`, {
      expectedPartyRevision: revisionOf(firstParty.partyId),
    });
    expect([unserved.status, unserved.json.code]).toEqual([409, "party.unserved_dishes"]);
    const dishes = (unserved.json.params as { dishes: { lineId: string; quantity: string }[] })
      .dishes;
    expect(dishes).toHaveLength(2);
    const served = await post(`/api/parties/${firstParty.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(firstParty.partyId),
      items: dishes.map(({ lineId, quantity }) => ({ lineId, quantity })),
    });
    expect(served.status, JSON.stringify(served.json)).toBe(200);
    const finished = await post(`/api/parties/${firstParty.partyId}/finish`, {
      expectedPartyRevision: revisionOf(firstParty.partyId),
    });

    expect([asPayment.status, asPayment.json.code]).toEqual([409, "working_order.not_open"]);
    expect(await paymentRows(venue, id)).toEqual([]);
    expect([refusedFinish.status, refusedFinish.json.code]).toEqual([
      409,
      "party.bill_outstanding",
    ]);
    expect(collected.status).toBe(200);
    expect(venue.db.all(sql`select id from sales where working_order_id = ${id}`)).toEqual(issued);
    expect(fiscalRecordCount(venue, id)).toBe(1);
    expect(await statusOf(venue, id)).toBe("settled");
    expect(finished.status).toBe(200);
    const [party] = venue.db.all<{ state: string }>(
      sql`select state from parties where id = ${firstParty.partyId}`,
    );
    expect(party!.state).toBe("closed");
  });
});

describe("a move while a whole bill is being paid by card at the reader", () => {
  it("keeps the moved bill separate from the receiving table's bill made at seating, being paid in full, and both complete", async () => {
    const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const { release, paying } = await wholeBillAtReader(secondParty.tabId);

    const moved = await moveTo(billId, secondParty.tableId, {}, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: secondParty.partyId, billId });
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, secondParty.tabId)).toBe("settled");
    expect(fiscalRecordCount(venue, secondParty.tabId)).toBe(1);
    expect(linesNamed(secondParty.tabId)).toEqual(["Caña"]);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(partyOfBill(billId)).toBe(secondParty.partyId);
    expect(linesNamed(billId)).toEqual(["Octopus"]);
  });

  it("keeps a counter order being paid in full separate from the party's bill made at seating, and its card completes on it", async () => {
    const seatedParty = await seatedWith(venue, "Caña");
    const orderId = await counterOrder("Tarta");
    const { release, paying } = await wholeBillAtReader(orderId);

    const moved = await moveTo(orderId, seatedParty.tableId, {}, venue.cookie2);
    release();
    const paid = await paying;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: seatedParty.partyId, billId: orderId });
    expect(paid.json).toMatchObject({ outcome: "captured" });
    expect(await statusOf(venue, orderId)).toBe("settled");
    expect(fiscalRecordCount(venue, orderId)).toBe(1);
    expect(partyOfBill(orderId)).toBe(seatedParty.partyId);
    expect(linesNamed(orderId)).toEqual(["Tarta"]);
    expect(await statusOf(venue, seatedParty.tabId)).toBe("open");
    expect(linesNamed(seatedParty.tabId)).toEqual(["Caña"]);
  });

  it("keeps the moved bill separate from the receiving table's bill made at seating, with a card refund in progress", async () => {
    const firstParty = await seatedWith(venue, "Tarta", "Octopus");
    const secondParty = await seatedWith(venue, "Croquettes");
    const split = await post(
      `/api/bills/${firstParty.tabId}/move-dishes`,
      await observedBillActionBody(venue.db, `/api/bills/${firstParty.tabId}/move-dishes`, {
        lineIds: lineIdsAt(firstParty.tabId, [2]),
        toBillId: null,
        expectedPartyRevision: firstParty.revision,
      }),
    );
    const billId = split.json.billId as string;
    const card = await cardContribution(secondParty.tabId, "3.00");
    const paymentId = (card.json.payment as { id: string }).id;
    const release = venue.card.holdNextRefund();
    const refunding = post(
      `/api/working-orders/${secondParty.tabId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "3.00",
        tipAmount: "0.00",
        reason: "Se equivocó de cuenta",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    await vi.waitFor(() =>
      expect(
        venue.db.all(
          sql`select id from bill_payment_refunds where bill_payment_id = ${paymentId} and state = 'pending'`,
        ),
      ).toHaveLength(1),
    );

    const moved = await moveTo(billId, secondParty.tableId, {}, venue.cookie2);
    release();
    const refunded = await refunding;

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: secondParty.partyId, billId });
    expect(refunded.status).toBe(200);
    expect(linesNamed(secondParty.tabId)).toEqual(["Croquettes"]);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(partyOfBill(billId)).toBe(secondParty.partyId);
  });
});

describe("two tills moving one counter order", () => {
  for (const first of ["A", "B"] as const) {
    it(`refuses the second till's move, read with no party, as party.out_of_date (till ${first} first)`, async () => {
      const firstParty = await seatedWith(venue, "Caña");
      const secondParty = await seatedWith(venue, "Caña");
      const orderId = await counterOrder("Tarta");
      // Each till read the order at the counter, with no party.
      const tillA = () =>
        post(
          `/api/bills/${orderId}/move`,
          {
            to: { tableId: firstParty.tableId },
            partyId: null,
            otherPartyId: firstParty.partyId,
            expectedOtherPartyRevision: firstParty.revision,
          },
          venue.cookie,
        );
      const tillB = () =>
        post(
          `/api/bills/${orderId}/move`,
          {
            to: { tableId: secondParty.tableId },
            partyId: null,
            otherPartyId: secondParty.partyId,
            expectedOtherPartyRevision: secondParty.revision,
          },
          venue.cookie2,
        );
      const [winner, loser] = first === "A" ? [tillA, tillB] : [tillB, tillA];
      const winnerParty = first === "A" ? firstParty : secondParty;

      const won = await winner();
      const revisions = [revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)];
      const lost = await loser();

      expect(won.status).toBe(200);
      expect(won.json).toEqual({ partyId: winnerParty.partyId, billId: orderId });
      expect(lost.status).toBe(409);
      expect(lost.json).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: winnerParty.partyId, revision: revisionOf(winnerParty.partyId) },
      });
      expect([revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)]).toEqual(revisions);
      expect(partyOfBill(orderId)).toBe(winnerParty.partyId);
    });
  }

  it("refuses a move naming a party for a bill another till has taken to the counter", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const read = revisionOf(firstParty.partyId);
    const toCounter = await post(
      `/api/bills/${billId}/move`,
      {
        to: { counter: { zoneId: null } },
        partyId: firstParty.partyId,
        expectedPartyRevision: read,
      },
      venue.cookie,
    );

    const lost = await post(
      `/api/bills/${billId}/move`,
      {
        to: { tableId: secondParty.tableId },
        partyId: firstParty.partyId,
        expectedPartyRevision: read,
        otherPartyId: secondParty.partyId,
        expectedOtherPartyRevision: revisionOf(secondParty.partyId),
      },
      venue.cookie2,
    );

    expect(toCounter.status).toBe(200);
    expect(lost.status).toBe(409);
    expect(lost.json).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: firstParty.partyId, revision: revisionOf(firstParty.partyId) },
    });
    expect(partyOfBill(billId)).toBeNull();
  });

  it("still refuses a party's bill sent with neither a party nor its revision", async () => {
    const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
      otherPartyId: secondParty.partyId,
      expectedOtherPartyRevision: revisionOf(secondParty.partyId),
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
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    expect((await cashContribution(billId, "20.00")).status).toBe(200);
    const revisions = [revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)];

    const answer = await moveTo(billId, secondParty.tableId);

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "bill.paid", params: { workingOrderId: billId } });
    expect([revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)]).toEqual(revisions);
    expect(await statusOf(venue, billId)).toBe("settled");
  });

  it("answers 401 without a session", async () => {
    const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

    const answer = await send(venue.app, "", "POST", `/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
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
      const { firstParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
      const revision = revisionOf(firstParty.partyId);

      const answer = await post(`/api/bills/${billId}/move`, {
        to,
        expectedPartyRevision: revision,
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "to" },
      });
      expect(revisionOf(firstParty.partyId)).toBe(revision);
    },
  );

  it("answers a malformed table id as the seat and tab routes do, with 404 table.not_found", async () => {
    const { firstParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const revision = revisionOf(firstParty.partyId);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: "not-a-uuid" },
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(404);
    expect(answer.json).toMatchObject({
      code: "table.not_found",
      params: { tableId: "not-a-uuid" },
    });
    expect(revisionOf(firstParty.partyId)).toBe(revision);
  });

  it("answers a malformed counter zone id as the sale route does, with 400 shared.invalid_id", async () => {
    const { firstParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const revision = revisionOf(firstParty.partyId);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { counter: { zoneId: "not-a-uuid" } },
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "shared.invalid_id",
      params: { kind: "ServiceZoneId", value: "not-a-uuid" },
    });
    expect(revisionOf(firstParty.partyId)).toBe(revision);
  });

  it.each([["merge"], ["separate"], ["together"], [null], [1]])(
    "A803 no merge flag: a bills key of any value, including an invalid one, is ignored (%j)",
    async (bills) => {
      const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

      const answer = await moveTo(billId, secondParty.tableId, { bills });

      expect(answer.status).toBe(200);
      expect(answer.json).toEqual({ partyId: secondParty.partyId, billId });
      expect(partyOfBill(billId)).toBe(secondParty.partyId);
      expect(await statusOf(venue, billId)).toBe("open");
      expect(await statusOf(venue, secondParty.tabId)).toBe("open");
    },
  );

  it.each([
    ["expectedPartyRevision", -1],
    ["expectedOtherPartyRevision", "3"],
    ["otherPartyId", "not-a-uuid"],
  ])("answers a malformed %s with 400 management.request_invalid", async (field, value) => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
      expectedPartyRevision: revisionOf(firstParty.partyId),
      otherPartyId: secondParty.partyId,
      expectedOtherPartyRevision: revisionOf(secondParty.partyId),
      [field]: value,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
  });

  it("answers a move sent with the target read free (otherPartyId null) to a table a party now holds with 409 party.out_of_date, changing nothing", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const revisions = [revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)];

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
      expectedPartyRevision: revisions[0],
      partyId: firstParty.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: secondParty.partyId, revision: revisions[1] },
    });
    expect([revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)]).toEqual(revisions);
    expect(partyOfBill(billId)).toBe(firstParty.partyId);
  });

  it("takes a move sent with the target read free (otherPartyId null) to a table still free, opening a new party there", async () => {
    const { firstParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const to = await freeTable();

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: to },
      expectedPartyRevision: revisionOf(firstParty.partyId),
      partyId: firstParty.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: expect.any(String), billId });
    expect(answer.json.partyId).not.toBe(firstParty.partyId);
    expect(partyOfBill(billId)).toBe(answer.json.partyId);
    expect(holderOf(to)).toBe(answer.json.partyId);
  });

  it("A803 waiting copy: moves a bill holding a held dish to a free table, where the new party's Current orders lists it in a held group", async () => {
    const firstParty = await seatedWith(venue);
    const placed = await post(`/api/parties/${firstParty.partyId}/groups`, {
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, firstParty.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(firstParty.partyId),
      groups: [
        { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" },
        { lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }], release: "hold" },
      ],
    });
    expect(placed.status).toBe(200);
    const [cakeLine] = venue.db.all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${firstParty.tabId} and name = 'Tarta'`,
    );
    const to = await freeTable();

    const answer = await moveTo(firstParty.tabId, to, {
      partyId: firstParty.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(200);
    const partyId = answer.json.partyId as string;
    expect(partyId).not.toBe(firstParty.partyId);
    const read = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${partyId}/current-orders`,
    );
    expect(read.status).toBe(200);
    const groups = read.json.groups as { state: string; rows: { lineId: string }[] }[];
    expect(
      groups.filter((group) => group.rows.some((row) => row.lineId === cakeLine!.id)),
    ).toMatchObject([{ state: "held" }]);
  });

  it("answers a move sent with the target read free to its own party's table with 409 table.already_in_party, changing nothing", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const revisions = [revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)];

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: firstParty.tableId },
      expectedPartyRevision: revisions[0],
      partyId: firstParty.partyId,
      otherPartyId: null,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "table.already_in_party",
      params: { tableId: firstParty.tableId },
    });
    expect([revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)]).toEqual(revisions);
    expect(partyOfBill(billId)).toBe(firstParty.partyId);
  });

  it("answers a move sent with the target read free and another party's revision with 400, changing nothing", async () => {
    const { firstParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const revision = revisionOf(firstParty.partyId);
    const to = await freeTable();

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: to },
      expectedPartyRevision: revision,
      partyId: firstParty.partyId,
      otherPartyId: null,
      expectedOtherPartyRevision: 3,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "otherPartyId" },
    });
    expect(revisionOf(firstParty.partyId)).toBe(revision);
    expect(partyOfBill(billId)).toBe(firstParty.partyId);
    expect(holderOf(to)).toBeNull();
  });

  it("answers the other party's revision sent without its id with 400, changing nothing", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const revisions = [revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)];

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
      expectedPartyRevision: revisions[0],
      expectedOtherPartyRevision: revisions[1],
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "otherPartyId" },
    });
    expect([revisionOf(firstParty.partyId), revisionOf(secondParty.partyId)]).toEqual(revisions);
    expect(partyOfBill(billId)).toBe(firstParty.partyId);
  });

  it("takes the other party's id in upper case as in lower", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
      expectedPartyRevision: revisionOf(firstParty.partyId),
      otherPartyId: secondParty.partyId.toUpperCase(),
      expectedOtherPartyRevision: revisionOf(secondParty.partyId),
    });

    expect(answer.status).toBe(200);
    expect(partyOfBill(billId)).toBe(secondParty.partyId);
  });

  it("answers a move to a table the party it read there has left with 409 party.out_of_date", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const read = {
      expectedPartyRevision: revisionOf(firstParty.partyId),
      otherPartyId: secondParty.partyId,
      expectedOtherPartyRevision: revisionOf(secondParty.partyId),
    };
    const left = await post(`/api/parties/${secondParty.partyId}/move`, {
      toTableId: await freeTable(),
      expectedPartyRevision: read.expectedOtherPartyRevision,
    });
    expect(left.status).toBe(200);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: secondParty.tableId },
      ...read,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: secondParty.partyId, revision: revisionOf(secondParty.partyId) },
    });
    expect(partyOfBill(billId)).toBe(firstParty.partyId);
  });

  it("keeps the bill separate by default, moves a party's first bill while it holds another, and answers the new codes with 409", async () => {
    const { firstParty, secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);
    const own = await moveTo(billId, firstParty.tableId);
    const first = await post(`/api/bills/${firstParty.tabId}/move`, {
      to: { counter: { zoneId: null } },
      expectedPartyRevision: revisionOf(firstParty.partyId),
    });

    const moved = await moveTo(billId, secondParty.tableId);

    expect(own.status).toBe(409);
    expect(own.json).toMatchObject({
      code: "table.already_in_party",
      params: { tableId: firstParty.tableId },
    });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ partyId: null, billId: firstParty.tabId });
    expect(partyOfBill(firstParty.tabId)).toBeNull();
    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ partyId: secondParty.partyId, billId });
    expect(await statusOf(venue, billId)).toBe("open");
    expect(partyOfBill(billId)).toBe(secondParty.partyId);
  });

  it("A803 no main bill (move): a bill moved onto a table held by another party stays its own open bill, beside the open bill already there", async () => {
    const { secondParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

    const answer = await moveTo(billId, secondParty.tableId);

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: secondParty.partyId, billId });
    expect(await statusOf(venue, billId)).toBe("open");
    expect(partyOfBill(billId)).toBe(secondParty.partyId);
    expect(await statusOf(venue, secondParty.tabId)).toBe("open");
  });

  it("moves a bill to the counter in the zone sent, answering no party", async () => {
    const { firstParty, billId } = await splitAtTwoParties(["Tarta", "Octopus"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { counter: { zoneId: ticketThenPayZone.toUpperCase() } },
      partyId: firstParty.partyId,
      expectedPartyRevision: revisionOf(firstParty.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: null, billId });
    const [context] = venue.db.all<{ zone_id: string }>(
      sql`select zone_id from order_service_contexts where working_order_id = ${billId}`,
    );
    expect(context!.zone_id).toBe(ticketThenPayZone);
  });
});
