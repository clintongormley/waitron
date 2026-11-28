import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { activityLog, readVenueClock, sales, taxpayer, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { businessDayAt, businessDayBounds, decimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { readBillFigures, readHeld } from "./bill-payment-rows.js";
import { closeOfDayConfig, issueBillAtClose, type CloseOfDayRule } from "./close-of-day.js";
import { endMeal } from "./meal-end.js";
import { refuseOrderOverSimplifiedLimit } from "./stored-order-lines.js";
import { REASONS, lineIdOf, type AdjustmentVenue } from "./testing/adjustment-venue.js";
import { holdDiscount } from "./testing/bill-discounts.js";
import {
  inTx,
  placedCounterBillMovedTo,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { clockAt } from "./testing/deferred-close-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";
import "./errors.js";

// Every path that invoices a bill's dishes writes its held discounts first, and every figure the
// payment path reads takes them off (plan A1621 PR 2b, items 2, 3 and 6).
let venue: BillVenue;
/** What `holdDiscount` reads of a venue: the complaint reason, given by the operator. */
let giver: Pick<AdjustmentVenue, "reasonId" | "staffId">;
let counterZone: string;
let rule: CloseOfDayRule;
let closeClock: ReturnType<typeof clockAt>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    const complaint = await withTransaction(
      db,
      async (tx) => (await createAdjustmentReason(tx, REASONS.complaint)).id,
    );
    giver = {
      reasonId: { complaint } as AdjustmentVenue["reasonId"],
      staffId: venue.operatorId,
    };
    counterZone = (
      await inTx(venue, (tx) => offerProducts(tx, { zone: "counter", orderStart: "counter" }))
    ).zoneId;
    const dayClock = await inTx(venue, (tx) => readVenueClock(tx));
    const nextDayStart = businessDayBounds(dayClock, businessDayAt(dayClock, new Date())).endAt;
    rule = { dayStartedAt: new Date(nextDayStart), venueClock: dayClock };
    closeClock = clockAt(Date.parse(nextDayStart) + 60_000);
  },
});

const tenPercentOn = (workingOrderId: string) =>
  inTx(venue, (tx) => holdDiscount(tx, giver, { workingOrderId }));

/** 50.00 off the bill's first line, more than it costs: it no longer holds as given. */
async function cutDownOn(billId: string): Promise<string> {
  const lineId = await lineIdOf(venue, billId, 1);
  return inTx(venue, (tx) =>
    holdDiscount(tx, giver, {
      lineId,
      action: "discount_amount",
      percentBp: null,
      amount: 5000,
    }),
  );
}

function pay(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    tip: "0.00",
    ...body,
  });
}

function preview(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments/preview`, {
    method: "card",
    entry: "manual",
    ...body,
  });
}

function balance(billId: string) {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

async function figuresOf(billId: string) {
  return inTx(venue, async (tx) => {
    const { advances } = await readHeld(tx, [billId]);
    return readBillFigures(tx, billId, advances);
  });
}

async function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
}

/** What crystallising left on the bill: its adjustment records and its pending rows. */
async function writtenOn(billId: string) {
  return inTx(venue, async (tx) => ({
    recorded: await tx
      .select({ reduction: adjustments.reduction })
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, billId)),
    pending: venue.db.all(sql`
      select id from bill_discounts where working_order_id = ${billId}
        or line_id in (select id from working_order_lines where working_order_id = ${billId})`),
  }));
}

async function writtenAsItStood(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ data: activityLog.data })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.kind, "discount.written_as_it_stood"),
          eq(activityLog.subjectId, billId),
        ),
      ),
  );
}

async function linesTotal(billId: string): Promise<number> {
  const [row] = venue.db.all<{ total: number }>(
    sql`select sum(line_total) as total from working_order_lines where working_order_id = ${billId}`,
  );
  return row!.total;
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

/** Print the bill through its own function, as a till does. */
async function printTheBill(party: { partyId: string; tabId: string }) {
  const { billId, editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, party.tabId),
  );
  return inTx(venue, (tx) =>
    endMeal(
      tx,
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      party.partyId,
      {
        billId,
        expectedPartyRevision: revisionOf(party.partyId),
        expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
        submissionId: randomUUID(),
        printAnyway: true,
      },
      venue.operatorId,
      null,
    ),
  );
}

function closeDay(billId: string) {
  return withTransaction(venue.db, (tx) =>
    issueBillAtClose(
      tx,
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: closeClock,
      },
      closeOfDayConfig(venue.cfg),
      billId,
      rule,
    ),
  );
}

/** A Counter order of one Tarta (18.00) in the pay-after-sending zone, placed unpaid. */
async function placedCounterOrder(): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId: counterZone,
    operatorId: venue.operatorId,
  });
  await placeOrder({ ...deps, admission: testTradingAdmission() }, venue.cfg, id, venue.operatorId);
  return id;
}

describe("the payment path's figures take held discounts off", () => {
  it("completes and issues a bill paid its discounted total in cash", async () => {
    const billId = await tabWith(venue, "Steak", "Tarta");
    await tenPercentOn(billId);

    const paid = await pay(billId, {
      kind: "contribution",
      amount: "38.70",
      method: "cash",
      tendered: "38.70",
      applied: "38.70",
    });

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await salesOf(billId)).toEqual([{ total: 3870 }]);
    const written = await writtenOn(billId);
    expect(written.recorded.map(({ reduction }) => reduction)).toEqual([430]);
    expect(written.pending).toEqual([]);
    expect(await linesTotal(billId)).toBe(3870);
  });

  it("reads the discounted total against the simplified-invoice limit", async () => {
    const billId = await tabWith(venue, "Steak", "Tarta");
    await tenPercentOn(billId);
    await expect(
      inTx(venue, (tx) =>
        refuseOrderOverSimplifiedLimit(
          tx,
          { simplifiedInvoiceLimit: decimal("38.70") },
          billId,
          null,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      inTx(venue, (tx) =>
        refuseOrderOverSimplifiedLimit(
          tx,
          { simplifiedInvoiceLimit: decimal("38.69") },
          billId,
          null,
        ),
      ),
    ).rejects.toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
  });

  it("shares the discounted total in an equal split", async () => {
    const billId = await tabWith(venue, "Steak", "Tarta");
    await tenPercentOn(billId);
    const half = await preview(billId, { kind: "share", shareOf: 2 });
    expect(half.status, JSON.stringify(half.json)).toBe(200);
    expect(half.json).toMatchObject({ applied: "19.35" });
  });
});

describe("a placed order's figure takes its held discounts off (D23)", () => {
  async function expectNinetyPercent(billId: string) {
    expect((await figuresOf(billId)).meal).toBe("16.20");
    const whole = await preview(billId, { kind: "share", shareOf: 1 });
    expect(whole.status, JSON.stringify(whole.json)).toBe(200);
    expect(whole.json).toMatchObject({ applied: "16.20" });
    const now = await balance(billId);
    expect(now.json).toMatchObject({ total: "16.20", outstanding: "16.20" });
  }

  it("for a Counter order placed in a pay-after-sending zone", async () => {
    const id = await placedCounterOrder();
    await tenPercentOn(id);
    expect(await statusOf(venue, id)).toBe("placed");
    await expectNinetyPercent(id);
  });

  it("for a placed order moved to a table holding a party", async () => {
    const party = await seatedWith(venue);
    const id = await placedCounterBillMovedTo(venue, counterZone, party);
    await tenPercentOn(id);
    expect(await statusOf(venue, id)).toBe("placed");
    await expectNinetyPercent(id);
  });
});

describe("every invoice path writes the bill's held discounts first", () => {
  it("Print the bill", async () => {
    const party = await seatedWith(venue, "Steak", "Tarta");
    await tenPercentOn(party.tabId);
    await printTheBill(party);
    expect(await salesOf(party.tabId)).toEqual([{ total: 3870 }]);
    const written = await writtenOn(party.tabId);
    expect(written.recorded.map(({ reduction }) => reduction)).toEqual([430]);
    expect(written.pending).toEqual([]);
  });

  it("unpaid departure", async () => {
    const party = await seatedWith(venue, "Steak", "Tarta");
    await tenPercentOn(party.tabId);
    const departed = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      {
        billId: party.tabId,
        expectedPartyRevision: revisionOf(party.partyId),
        reason: "Left without paying",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(departed.status, JSON.stringify(departed.json)).toBe(200);
    expect(await salesOf(party.tabId)).toEqual([{ total: 3870 }]);
    const written = await writtenOn(party.tabId);
    expect(written.recorded.map(({ reduction }) => reduction)).toEqual([430]);
    expect(written.pending).toEqual([]);
  });

  it("the close of day", async () => {
    const party = await seatedWith(venue, "Steak", "Tarta");
    await tenPercentOn(party.tabId);
    expect(await closeDay(party.tabId)).toMatchObject({ kind: "issued" });
    expect(await salesOf(party.tabId)).toEqual([{ total: 3870 }]);
    const written = await writtenOn(party.tabId);
    expect(written.recorded.map(({ reduction }) => reduction)).toEqual([430]);
    expect(written.pending).toEqual([]);
  });

  it("the reader's second transaction", async () => {
    const billId = await tabWith(venue, "Steak", "Tarta");
    await tenPercentOn(billId);
    const paid = await pay(billId, {
      kind: "contribution",
      amount: "38.70",
      method: "card",
      entry: "reader",
      applied: "38.70",
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await salesOf(billId)).toEqual([{ total: 3870 }]);
    const written = await writtenOn(billId);
    expect(written.recorded.map(({ reduction }) => reduction)).toEqual([430]);
    expect(written.pending).toEqual([]);
  });
});

describe("paths nobody is asked on write a discount that no longer holds as it stood", () => {
  it("the close of day, with its activity entry", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    const discountId = await cutDownOn(party.tabId);
    expect(await closeDay(party.tabId)).toMatchObject({ kind: "issued" });
    expect(await salesOf(party.tabId)).toEqual([{ total: 2500 }]);
    expect((await writtenOn(party.tabId)).pending).toEqual([]);
    expect(await writtenAsItStood(party.tabId)).toEqual([
      { data: { discountId, why: "cut_down", takes: "18.00" } },
    ]);
  });

  it("the reader's second transaction, with its activity entry", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    // Held once the card is at the reader: the payment's first transaction is asked.
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const answer = pay(billId, {
      kind: "contribution",
      amount: "25.00",
      method: "card",
      entry: "reader",
      applied: "25.00",
    });
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
    const discountId = await cutDownOn(billId);
    release();
    const paid = await answer;
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await salesOf(billId)).toEqual([{ total: 2500 }]);
    expect((await writtenOn(billId)).pending).toEqual([]);
    expect(await writtenAsItStood(billId)).toEqual([
      { data: { discountId, why: "cut_down", takes: "18.00" } },
    ]);
  });

  it("a cash payment is asked, and refused", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    await cutDownOn(billId);
    const paid = await pay(billId, {
      kind: "contribution",
      amount: "25.00",
      method: "cash",
      tendered: "25.00",
      applied: "25.00",
    });
    expect(paid.json).toMatchObject({ code: "adjustment.no_longer_applies" });
    expect(await statusOf(venue, billId)).toBe("open");
    expect(await salesOf(billId)).toEqual([]);
  });
});
