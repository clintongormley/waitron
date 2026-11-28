import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { REASONS } from "./testing/adjustment-venue.js";
import { holdTenPercent } from "./testing/bill-discounts.js";
import { inTx, seatedWith } from "./testing/bill-venue.js";
import { deferredCloseVenue, type DeferredCloseKit } from "./testing/deferred-close-fixture.js";
import { readFindBill } from "./find-bill-bills.js";
import { readOrderDetail } from "./orders-detail.js";
import { readBillsOfParties, readPartyBills } from "./parties.js";
import { getHeldOrder } from "./working-order-held-read.js";
import { listTablesWithState } from "./working-order-table-state.js";
import "./errors.js";

type Read = (tx: Transaction, id: string) => Promise<unknown>;

// Every gather of held discounts starts with one `readPendingDiscounts` call naming its bills.
const gathered = vi.hoisted(() => [] as string[][]);
vi.mock("@waitron/adjustments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/adjustments")>();
  return {
    ...actual,
    readPendingDiscounts: (tx: Transaction, billIds: readonly string[]) => {
      gathered.push([...billIds]);
      return actual.readPendingDiscounts(tx, billIds);
    },
  };
});

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

beforeEach(() => {
  gathered.length = 0;
});

async function twoDiscountedParties() {
  const unrelated = await seatedWith(t.venue, "House salad");
  await holdTenPercent(t.venue, complaint, unrelated.tabId);
  const asked = await seatedWith(t.venue, "House salad");
  await holdTenPercent(t.venue, complaint, asked.tabId);
  gathered.length = 0;
  return { unrelated, asked };
}

describe("a read of one bill or party gathers its own bills' discounts, once", () => {
  it.each<[string, Read]>([
    ["Find bill's one bill", (tx, bill) => readFindBill(tx, bill)],
    ["the order detail", (tx, bill) => readOrderDetail(tx, bill, "all", false)],
  ])("%s", async (_, read) => {
    const { unrelated, asked } = await twoDiscountedParties();

    await inTx(t.venue, (tx) => read(tx, asked.tabId));

    expect(gathered).toEqual([[asked.tabId]]);
    expect(gathered.flat()).not.toContain(unrelated.tabId);
  });

  it("the held order", async () => {
    const { asked } = await twoDiscountedParties();

    await getHeldOrder({ db: t.venue.db }, asked.tabId);

    expect(gathered).toEqual([[asked.tabId]]);
  });

  it.each<[string, Read]>([
    ["the party's bills", (tx, party) => readPartyBills(tx, party)],
    ["the party bills read", (tx, party) => readBillsOfParties(tx, [party])],
  ])("%s", async (_, read) => {
    const { asked } = await twoDiscountedParties();

    await inTx(t.venue, (tx) => read(tx, asked.partyId));

    expect(gathered).toEqual([[asked.tabId]]);
  });

  it("the floor gathers once for its tab totals and its parties' bills", async () => {
    const { unrelated, asked } = await twoDiscountedParties();

    await inTx(t.venue, (tx) => listTablesWithState(tx));

    expect(gathered).toHaveLength(1);
    expect(gathered[0]).toEqual(expect.arrayContaining([unrelated.tabId, asked.tabId]));
  });
});
