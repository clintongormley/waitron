import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { parties, taxpayer, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { endMeal } from "./meal-end.js";
import { REASONS, lineIdOf, type AdjustmentVenue } from "./testing/adjustment-venue.js";
import { cutDownOn, discountsHeldOn, salesOf, writtenAsItStood } from "./testing/bill-discounts.js";
import {
  capturedPendingPayment,
  inTx,
  partyRevisionOf,
  paymentRows,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { deferredCloseKit, type DeferredCloseKit } from "./testing/deferred-close-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";
import "./errors.js";

// The check before money moves (plan A1621 PR 2b, item 5; D6): every asked path that would issue a
// bill's invoice asks about a discount that no longer holds, before a card is charged or a payment
// row is written; the paths nobody is asked on write it as it stood.
let venue: BillVenue;
let giver: Pick<AdjustmentVenue, "reasonId" | "staffId">;
let voidReason: string;
let counterZone: string;
let kit: DeferredCloseKit;

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
    voidReason = await withTransaction(
      db,
      async (tx) => (await createAdjustmentReason(tx, REASONS.houseVoid)).id,
    );
    giver = {
      reasonId: { complaint } as AdjustmentVenue["reasonId"],
      staffId: venue.operatorId,
    };
    counterZone = (
      await inTx(venue, (tx) => offerProducts(tx, { zone: "counter", orderStart: "counter" }))
    ).zoneId;
    kit = deferredCloseKit(venue, counterZone);
  },
});

function pay(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    tip: "0.00",
    ...body,
  });
}

function cash(billId: string, amount: string) {
  return pay(billId, {
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
  });
}

function reader(billId: string, amount: string) {
  return pay(billId, {
    kind: "contribution",
    amount,
    method: "card",
    entry: "reader",
    applied: amount,
  });
}

function preview(billId: string, body: Record<string, unknown>) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments/preview`, {
    method: "card",
    entry: "manual",
    ...body,
  });
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function expectRefused(answer: { status: number; json: Record<string, unknown> }) {
  expect(answer.status, JSON.stringify(answer.json)).toBe(400);
  expect(answer.json).toMatchObject({ code: "adjustment.no_longer_applies" });
}

function paymentCount(): number {
  return venue.db.all(sql`select id from bill_payments`).length;
}

async function partyOf(billId: string): Promise<string> {
  const [row] = venue.db.all<{ party_id: string }>(
    sql`select party_id from working_orders where id = ${billId}`,
  );
  return row!.party_id;
}

describe("a payment that would complete the bill is asked before money moves", () => {
  it("refuses cash, and leaves no payment row", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, billId);

    expectRefused(await cash(billId, "25.00"));

    expect(await paymentRows(venue, billId)).toEqual([]);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(await salesOf(venue, billId)).toEqual([]);
    expect(discountsHeldOn(venue, billId)).toHaveLength(1);
  });

  it("refuses a reader card in its first transaction: the provider is asked for nothing", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, billId);
    const calls = venue.card.collectCalls.length;

    expectRefused(await reader(billId, "25.00"));

    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(await paymentRows(venue, billId)).toEqual([]);
    expect(await salesOf(venue, billId)).toEqual([]);
  });

  it("takes a part payment, which issues nothing", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, billId);

    const paid = await cash(billId, "10.00");

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json).toMatchObject({ outcome: "received", balance: { outstanding: "15.00" } });
    expect(discountsHeldOn(venue, billId)).toHaveLength(1);
  });

  it("the preview refuses a payment that would complete the bill, and not a part one", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, billId);

    expectRefused(await preview(billId, { kind: "share", shareOf: 1 }));
    const part = await preview(billId, { kind: "contribution", amount: "10.00" });
    expect(part.status, JSON.stringify(part.json)).toBe(200);
    expect(part.json).toMatchObject({ applied: "10.00" });
  });

  it("refuses a counter sale", async () => {
    const id = randomUUID();
    const tarta = venue.offerFor("Tarta");
    const steak = venue.offerFor("Steak");
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [
        { menuItemId: tarta, quantity: "1" },
        { menuItemId: steak, quantity: "1" },
      ],
      zoneId: counterZone,
      operatorId: venue.operatorId,
    });
    await cutDownOn(venue, giver, id);
    const [order] = venue.db.all<{ revision: number }>(
      sql`select revision from working_orders where id = ${id}`,
    );

    const paid = await pay(id, {
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "25.00",
      applied: "0.00",
      dining: "eat_in",
      basket: {
        revision: order!.revision,
        zoneId: counterZone,
        lines: [
          {
            workingOrderLineId: await lineIdOf(venue, id, 1),
            menuItemId: tarta,
            quantity: "1",
          },
          {
            workingOrderLineId: await lineIdOf(venue, id, 2),
            menuItemId: steak,
            quantity: "1",
          },
        ],
      },
    });

    expectRefused(paid);
    expect(await paymentRows(venue, id)).toEqual([]);
    expect(await salesOf(venue, id)).toEqual([]);
  });
});

describe("every other path that would issue the invoice is asked", () => {
  it("Print the bill", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, party.tabId);
    const { billId, editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
      readBillEditState(tx, party.tabId),
    );
    const deps = {
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
    };
    const request = {
      billId,
      expectedPartyRevision: revisionOf(party.partyId),
      expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
      submissionId: randomUUID(),
      printAnyway: true,
    };
    await expect(
      inTx(venue, (tx) =>
        endMeal(tx, deps, venue.cfg, party.partyId, request, venue.operatorId, null),
      ),
    ).rejects.toMatchObject({ code: "adjustment.no_longer_applies" });
    expect(await salesOf(venue, party.tabId)).toEqual([]);
  });

  it("unpaid departure", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, party.tabId);
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
    expectRefused(departed);
    expect(await salesOf(venue, party.tabId)).toEqual([]);
  });

  it("the deferred close", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak");
    await cutDownOn(venue, giver, party.tabId);
    await expect(
      kit.close(await kit.requestFor(party.tabId, "25.00", party.partyId)),
    ).rejects.toMatchObject({ code: "adjustment.no_longer_applies" });
    expect(await salesOf(venue, party.tabId)).toEqual([]);
  });

  async function payForItemsByReader(sourceId: string, lineNos: number[], applied: string) {
    const partyId = await partyOf(sourceId);
    const picks = [];
    for (const lineNo of lineNos) picks.push({ lineId: await lineIdOf(venue, sourceId, lineNo) });
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${sourceId}/item-payments`, {
      submissionId: randomUUID(),
      picks,
      partyId,
      expectedPartyRevision: await partyRevisionOf(venue, sourceId),
      expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, sourceId))],
      method: "card",
      entry: "reader",
      applied,
      tip: "0.00",
    });
  }

  it("Pay for items, for the new bill: the reader is asked for nothing", async () => {
    const sourceId = await tabWith(venue, "Tarta", "Small beer", "Steak");
    await cutDownOn(venue, giver, sourceId);
    const calls = venue.card.collectCalls.length;
    const payments = paymentCount();

    // The Tarta and the beer move to a bill of their own, the Tarta's 50.00 off with it.
    expectRefused(await payForItemsByReader(sourceId, [1, 2], "3.00"));

    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(paymentCount()).toBe(payments);
    expect(discountsHeldOn(venue, sourceId)).toHaveLength(1);
  });

  it("Pay for items, for the source bill it would issue: the reader is asked for nothing", async () => {
    const sourceId = await tabWith(venue, "Tarta", "Steak");
    // 50.00 off the Steak takes all of it, so paying for the Tarta leaves the source covered.
    await cutDownOn(venue, giver, sourceId, 2);
    const calls = venue.card.collectCalls.length;

    expectRefused(await payForItemsByReader(sourceId, [1], "18.00"));

    expect(venue.card.collectCalls).toHaveLength(calls);
    expect(await salesOf(venue, sourceId)).toEqual([]);
    expect(discountsHeldOn(venue, sourceId)).toHaveLength(1);
  });

  it("a cancel that leaves a part-paid bill exactly covered", async () => {
    const party = await seatedWith(venue, "Tarta", "Steak", "Small beer");
    await cutDownOn(venue, giver, party.tabId);
    expect((await cash(party.tabId, "25.00")).status).toBe(200);
    const beer = await lineIdOf(venue, party.tabId, 3);
    const [partyRow] = await venue.db.select().from(parties).where(eq(parties.id, party.partyId));
    const [bill] = venue.db.all<{ revision: number }>(
      sql`select revision from working_orders where id = ${party.tabId}`,
    );

    const cancelled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/lines/${beer}/cancel-item`,
      {
        quantity: "1",
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, party.tabId)),
        outcome: "remove_charge",
        expectedPartyRevision: partyRow!.revision,
        expectedBillRevision: bill!.revision,
        expectedContext: await readCancellationContext(venue.db, party.partyId, beer),
        submissionId: randomUUID(),
        reasonId: voidReason,
      },
    );

    expectRefused(cancelled);
    expect(await salesOf(venue, party.tabId)).toEqual([]);
    expect(await lineIdOf(venue, party.tabId, 3)).toBe(beer);
  });
});

describe("a completion after money moved is not asked", () => {
  it("the card follow-up writes the discount as it stood, with its activity entry", async () => {
    const billId = await tabWith(venue, "Tarta", "Steak");
    const discountId = await cutDownOn(venue, giver, billId);
    await capturedPendingPayment(venue, billId, 2500);

    await settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
    });

    expect(await statusOf(venue, billId)).toBe("settled");
    expect(await salesOf(venue, billId)).toEqual([{ total: 2500 }]);
    expect(discountsHeldOn(venue, billId)).toEqual([]);
    expect(await writtenAsItStood(venue, billId)).toEqual([
      { data: expect.objectContaining({ discountId, why: "cut_down", takes: "18.00" }) as unknown },
    ]);
  });
});
