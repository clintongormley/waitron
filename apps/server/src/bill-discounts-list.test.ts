import { describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { REASONS, lineIdOf } from "./testing/adjustment-venue.js";
import { cutDownOn, holdDiscount } from "./testing/bill-discounts.js";
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
    const id = await holdTenPercent(party.tabId);

    expect((await partyBill(party.partyId, party.tabId)).discounts).toEqual([tenPercent(id)]);
  });

  it("a fixed amount larger than its dish lists the amount given, what it takes and that it is cut down", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const id = await cutDownOn(
      t.venue,
      {
        reasonId: { complaint } as Record<keyof typeof REASONS, string>,
        staffId: t.venue.operatorId,
      },
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
    const id = await holdTenPercent(party.tabId);

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
    const id = await holdTenPercent(party.tabId);

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
