import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentLines, billPaymentRefunds, saleLines, sales } from "@waitron/db";
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

// Money through `POST /api/bills/:id/move` (table actions plan, Task 7; spec §7, §9, §15): a moved
// bill keeps its id, so its payments, a card still at the reader, its refunds and its invoice stay
// with it. The move itself is tested in `party-move-bill.test.ts`.
let venue: BillVenue;
let invoiceFirstZone: string;

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

function moveTo(billId: string, tableId: string, extra: Record<string, unknown> = {}) {
  const partyOf = venue.db.all<{ party_id: string | null }>(
    sql`select party_id from working_orders where id = ${billId}`,
  )[0]!.party_id;
  const holder = venue.db.all<{ party_id: string }>(
    sql`select party_id from party_tables where table_id = ${tableId} and left_at is null`,
  )[0]?.party_id;
  return post(`/api/bills/${billId}/move`, {
    to: { tableId },
    ...(partyOf === null ? {} : { expectedPartyRevision: revisionOf(partyOf) }),
    ...(holder === undefined ? {} : { expectedOtherPartyRevision: revisionOf(holder) }),
    ...extra,
  });
}

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
    { tableId: "not-a-uuid" },
    { tableId: 7 },
    { counter: null },
    { counter: {} },
    { counter: { zoneId: "not-a-uuid" } },
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
  ])("answers a malformed %s with 400 management.request_invalid", async (field, value) => {
    const { ana, luis, billId } = await splitAtTwoParties(["Tarta", "Pulpo"], [2]);

    const answer = await post(`/api/bills/${billId}/move`, {
      to: { tableId: luis.tableId },
      expectedPartyRevision: revisionOf(ana.partyId),
      expectedOtherPartyRevision: revisionOf(luis.partyId),
      [field]: value,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
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
