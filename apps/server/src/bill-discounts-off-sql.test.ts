import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { billPayments, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { REASONS } from "./testing/adjustment-venue.js";
import { holdDiscount } from "./testing/bill-discounts.js";
import { inTx, seatedWith } from "./testing/bill-venue.js";
import { deferredCloseVenue, type DeferredCloseKit } from "./testing/deferred-close-fixture.js";
import { parseBillsQuery } from "./find-bill-query.js";
import { readFindBill, readFindBills } from "./find-bill-bills.js";
import { listOrders } from "./orders-list.js";
import { readBillsOfParties } from "./parties.js";
import { listCounterWaiting } from "./working-order-counter.js";
import { listHeldOrders } from "./working-order-held-read.js";
import { listTablesWithState } from "./working-order-table-state.js";
import "./errors.js";

// Every case holds 10% on the whole bill: each reader's total is 90% of the bill's lines, so a
// reader that sums its lines alone answers the undiscounted figure and fails.
let t: DeferredCloseKit;
let complaint: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
    complaint = await inTx(
      t.venue,
      async (tx) => (await createAdjustmentReason(tx, REASONS.complaint)).id,
    );
  },
});

function holdTenPercent(billId: string): Promise<string> {
  return inTx(t.venue, (tx) =>
    holdDiscount(
      tx,
      {
        reasonId: { complaint } as Record<keyof typeof REASONS, string>,
        staffId: t.venue.operatorId,
      },
      { workingOrderId: billId },
    ),
  );
}

function received(billId: string, applied: number) {
  return inTx(t.venue, (tx) =>
    tx.insert(billPayments).values({
      workingOrderId: billId,
      submissionId: randomUUID(),
      fingerprint: randomUUID(),
      kind: "contribution",
      method: "cash",
      applied,
      tendered: applied,
      tip: 0,
      state: "received",
      receivedAt: new Date().toISOString(),
      requestedBy: t.venue.operatorId,
      source: "device",
      deviceId: t.venue.deviceId,
    }),
  );
}

async function partyBill(partyId: string, billId: string) {
  const bills = await inTx(t.venue, (tx) => readBillsOfParties(tx, [partyId]));
  return bills.get(partyId)!.find((bill) => bill.workingOrderId === billId)!;
}

const findQuery = (values: Record<string, string> = {}) =>
  parseBillsQuery(new URLSearchParams(values));

describe("an open bill's SQL totals take off its pending discounts", () => {
  it("party bills: the total, what is outstanding and what is overpaid", async () => {
    const part = await seatedWith(t.venue, "House salad");
    await holdTenPercent(part.tabId);
    await received(part.tabId, 500);
    const over = await seatedWith(t.venue, "House salad");
    await holdTenPercent(over.tabId);
    await received(over.tabId, 1100);

    expect(await partyBill(part.partyId, part.tabId)).toMatchObject({
      total: "10.80",
      outstanding: "5.80",
    });
    const overpaid = await partyBill(over.partyId, over.tabId);
    expect(overpaid).toMatchObject({ total: "10.80", outstanding: "0.00", overpaid: "0.20" });
  });

  it("a bill holding no pending discount keeps its lines' total", async () => {
    const plain = await seatedWith(t.venue, "House salad");

    expect(await partyBill(plain.partyId, plain.tabId)).toMatchObject({
      total: "12.00",
      outstanding: "12.00",
    });
  });

  it("held orders", async () => {
    const party = await seatedWith(t.venue, "House salad");
    await holdTenPercent(party.tabId);

    const held = await listHeldOrders({ db: t.venue.db });

    expect(held.find((order) => order.id === party.tabId)).toMatchObject({ total: "10.80" });
  });

  it("the floor's tab total", async () => {
    const party = await seatedWith(t.venue, "House salad", "Small beer");
    await holdTenPercent(party.tabId);

    const tables = await inTx(t.venue, (tx) => listTablesWithState(tx));

    expect(tables.find((table) => table.party?.id === party.partyId)).toMatchObject({
      tabTotal: "13.50",
    });
  });

  it("the counter's waiting list, a placed Counter order included", async () => {
    const placed = await t.counterOrder("placed");
    await holdTenPercent(placed);

    const waiting = await listCounterWaiting({ db: t.venue.db });

    expect(waiting.find((order) => order.id === placed)).toMatchObject({ total: "16.20" });
  });

  it("the orders list, and what it owes", async () => {
    const party = await seatedWith(t.venue, "House salad");
    await holdTenPercent(party.tabId);
    await received(party.tabId, 500);

    const page = await inTx(t.venue, (tx) =>
      listOrders(tx, { status: "all", dates: "any", credited: false, limit: 500, scope: "all" }),
    );

    expect(page.rows.find((row) => row.id === party.tabId)).toMatchObject({
      total: "10.80",
      stillOwed: "5.80",
    });
  });

  it("Find bill, what it owes, and its place when sorted by total", async () => {
    const discounted = await seatedWith(t.venue, "Steak");
    await holdTenPercent(discounted.tabId);
    await received(discounted.tabId, 500);
    const between = await seatedWith(t.venue, "Octopus", "Small beer");

    expect(await inTx(t.venue, (tx) => readFindBill(tx, discounted.tabId))).toMatchObject({
      total: "22.50",
      stillOwed: "17.50",
    });
    const sorted = (
      await inTx(t.venue, (tx) =>
        readFindBills(tx, findQuery({ sort: "total", direction: "ascending" })),
      )
    ).rows.map((row) => row.workingOrderId);
    // 22.50 sorts before 23.00; the lines alone, 25.00, would sort after it.
    expect(sorted.indexOf(discounted.tabId)).toBeGreaterThanOrEqual(0);
    expect(sorted.indexOf(discounted.tabId)).toBeLessThan(sorted.indexOf(between.tabId));
  });

  it("the deferred close accepts the party bill's discounted total as its expected total", async () => {
    const party = await seatedWith(t.venue, "House salad");
    await holdTenPercent(party.tabId);
    const { total } = await partyBill(party.partyId, party.tabId);

    await t.close(await t.requestFor(party.tabId, total, party.partyId));

    expect(
      await inTx(t.venue, (tx) =>
        tx.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, party.tabId)),
      ),
    ).toEqual([{ total: 1080 }]);
  });
});
