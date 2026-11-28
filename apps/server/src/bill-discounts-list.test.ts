import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { REASONS, lineIdOf } from "./testing/adjustment-venue.js";
import { cutDownOn, holdDiscount, holdTenPercent } from "./testing/bill-discounts.js";
import { inTx, seatedWith } from "./testing/bill-venue.js";
import { deferredCloseVenue, type DeferredCloseKit } from "./testing/deferred-close-fixture.js";
import { readOrderDetail } from "./orders-detail.js";
import { readPartyBills } from "./parties.js";
import { getHeldOrder } from "./working-order-held-read.js";
import "./errors.js";

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

// House salad is 12.00, so 10% on the whole bill takes 1.20 off it.
const tenPercent = (id: string) => ({
  id,
  target: { kind: "bill" },
  action: "discount_percent",
  percentBp: 1000,
  amount: null,
  takes: "1.20",
  holds: "yes",
  origin: "given",
  reasonName: "Guest complaint",
});

async function partyBill(partyId: string, billId: string) {
  const bills = await inTx(t.venue, (tx) => readPartyBills(tx, partyId));
  return bills.find((bill) => bill.workingOrderId === billId)!;
}

describe("an open bill's reads list its pending discounts", () => {
  it("the party bill lists a held 10% with what it takes off", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const id = await holdTenPercent(t.venue, complaint, party.tabId);

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([tenPercent(id)]);
  });

  it("a fixed amount larger than its dish lists the amount given, what it takes and that it is cut down", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const id = await cutDownOn(
      t.venue,
      { reasonId: { complaint }, staffId: t.venue.operatorId },
      party.tabId,
    );

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([
      {
        ...tenPercent(id),
        target: { kind: "line", lineId: await lineIdOf(t.venue, party.tabId, 1) },
        action: "discount_amount",
        percentBp: null,
        amount: "50.00",
        takes: "12.00",
        holds: "cut_down",
      },
    ]);
  });

  it("a party bill holding none lists none", async () => {
    const party = await seatedWith(t.venue, "House salad");

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([]);
  });

  it("the held order read lists a held 10% with what it takes off", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const id = await holdTenPercent(t.venue, complaint, party.tabId);

    expect((await getHeldOrder({ db: t.venue.db }, party.tabId)).discounts).toEqual([
      tenPercent(id),
    ]);
  });

  it("a held order holding none lists none", async () => {
    const party = await seatedWith(t.venue, "House salad");

    expect((await getHeldOrder({ db: t.venue.db }, party.tabId)).discounts).toEqual([]);
  });

  it("the dashboard's order detail lists a held 10%, and its lines less it make its total", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const id = await holdTenPercent(t.venue, complaint, party.tabId);

    const detail = await inTx(t.venue, (tx) => readOrderDetail(tx, party.tabId, "all", false));

    expect(detail.discounts).toEqual([tenPercent(id)]);
    expect(detail.lines.map((line) => line.total)).toEqual(["12.00"]);
    expect(detail.row.total).toBe("10.80");
  });

  it("the dashboard's order detail of a bill holding none lists none", async () => {
    const party = await seatedWith(t.venue, "House salad");

    const detail = await inTx(t.venue, (tx) => readOrderDetail(tx, party.tabId, "all", false));

    expect(detail.discounts).toEqual([]);
  });
});

describe("a discount given as one till row lists once", () => {
  // Each amount is held as rows on two House salads, 12.00 each; rows sharing `givenTogether`
  // are one discount.
  async function amountsOn(amounts: [number, number], together: boolean) {
    const party = await seatedWith(t.venue, "House salad", "House salad");
    const lines = [
      await lineIdOf(t.venue, party.tabId, 1),
      await lineIdOf(t.venue, party.tabId, 2),
    ];
    const shared = randomUUID();
    const ids = await inTx(t.venue, async (tx) => {
      const held = [];
      for (const [at, amount] of amounts.entries()) {
        held.push(
          await holdDiscount(
            tx,
            { reasonId: { complaint }, staffId: t.venue.operatorId },
            {
              lineId: lines[at]!,
              action: "discount_amount",
              percentBp: null,
              amount,
              position: at + 1,
              givenTogether: together ? shared : randomUUID(),
            },
          ),
        );
      }
      return held;
    });
    const amount = (id: string, at: number) => ({
      ...tenPercent(id),
      target: { kind: "line", lineId: lines[at]! },
      action: "discount_amount",
      percentBp: null,
    });
    return { party, ids, amount };
  }

  it("rows given together list as one entry, its amount and what it takes summed", async () => {
    const { party, ids, amount } = await amountsOn([200, 100], true);

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([
      { ...amount(ids[0]!, 0), amount: "3.00", takes: "3.00", holds: "yes" },
    ]);
    expect((await getHeldOrder({ db: t.venue.db }, party.tabId)).discounts).toHaveLength(1);
    const detail = await inTx(t.venue, (tx) => readOrderDetail(tx, party.tabId, "all", false));
    expect(detail.discounts).toHaveLength(1);
  });

  it("rows given together of which one is cut down list once as cut down", async () => {
    const { party, ids, amount } = await amountsOn([5000, 100], true);

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([
      { ...amount(ids[0]!, 0), amount: "51.00", takes: "13.00", holds: "cut_down" },
    ]);
  });

  it("two discounts given separately still list twice", async () => {
    const { party, ids, amount } = await amountsOn([200, 100], false);

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([
      { ...amount(ids[0]!, 0), amount: "2.00", takes: "2.00", holds: "yes" },
      { ...amount(ids[1]!, 1), amount: "1.00", takes: "1.00", holds: "yes" },
    ]);
  });
});
