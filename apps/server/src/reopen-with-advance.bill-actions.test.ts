import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sales, workingOrders } from "@waitron/db";
import { filedInvoicesOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { advanceBills, provisionAdvanceVenue, type AdvanceVenue } from "./testing/advance-bills.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { inTx, send, statusOf, type Answer } from "./testing/bill-venue.js";
import * as fixture from "./testing/split-after-print-fixture.js";
import "./errors.js";

// The other actions of a bill reopened from a printed bill part of which was paid as an advance:
// they are an open bill's with an advance on it. Each case's bill is at a table of its own.
let advanceVenue: AdvanceVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    advanceVenue = await provisionAdvanceVenue(db);
    // Print the bill prints on the till's receipt printer, which the venue's till profile allows.
    db.run(sql`update device_profiles set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'`);
  },
});

const venue = () => advanceVenue.venue;
const supervisor = () => ({ personId: venue().adminId, pin: "1234" });
const { seated, advance } = advanceBills(() => advanceVenue);

async function partyOf(billId: string): Promise<string> {
  const [bill] = await inTx(venue(), (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return bill!.partyId!;
}

/** A table with the named dishes and a 30.00 advance, its bill printed and reopened: the reopened
 * bill. */
async function reopenedWithAdvance(...dishes: string[]): Promise<string> {
  const x = await seated(...dishes);
  await advance(x, "30.00");
  await fixture.printed(venue(), { partyId: await partyOf(x), tabId: x });
  const reopened = await fixture.split(venue(), x, venue().cookie);
  expect(reopened.status, JSON.stringify(reopened.json)).toBe(200);
  return reopened.json.billId as string;
}

async function lineOf(billId: string, name: string): Promise<string> {
  const lines = await fixture.dishesOf(venue(), billId);
  return lines.find((line) => line.name === name)!.id;
}

async function dishNames(billId: string): Promise<string[]> {
  return (await fixture.dishesOf(venue(), billId))
    .filter((line) => line.parentLineId === null)
    .map((line) => line.name);
}

async function billAction(path: string, body: Record<string, unknown>): Promise<Answer> {
  return send(
    venue().app,
    venue().cookie,
    "POST",
    path,
    await observedBillActionBody(venue().db, path, body),
  );
}

async function moveDishes(billId: string, names: string[], toBillId: string | null) {
  const lineIds: string[] = [];
  for (const name of names) lineIds.push(await lineOf(billId, name));
  return billAction(`/api/bills/${billId}/move-dishes`, {
    lineIds,
    toBillId,
    expectedPartyRevision: fixture.revisionOf(venue(), await partyOf(billId)),
  });
}

describe("the other actions of a reopened bill with an advance", () => {
  it("merging it away into another bill of its party is bill.payments_received, and it keeps its dishes", async () => {
    const y = await reopenedWithAdvance("Tasting menu", "Salad bowl");
    const moved = await moveDishes(y, ["Salad bowl"], null);
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const other = moved.json.billId as string;

    const merged = await billAction(`/api/bills/${other}/merge`, {
      fromBillId: y,
      expectedPartyRevision: fixture.revisionOf(venue(), await partyOf(y)),
    });

    expect(merged.status, JSON.stringify(merged.json)).toBe(409);
    expect(merged.json).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: y },
    });
    expect(await statusOf(venue(), y)).toBe("open");
    expect(await dishNames(y)).toEqual(["Tasting menu"]);
    expect(await dishNames(other)).toEqual(["Salad bowl"]);
  });

  it("moving dishes off it that would leave less than the advance is bill.received_exceeds_total, and the dishes stay", async () => {
    const y = await reopenedWithAdvance("Tasting menu", "Salad bowl");

    const moved = await moveDishes(y, ["Tasting menu"], null);

    expect(moved.status, JSON.stringify(moved.json)).toBe(409);
    expect(moved.json).toMatchObject({ code: "bill.received_exceeds_total" });
    expect(await dishNames(y)).toEqual(["Tasting menu", "Salad bowl"]);
    expect((await fixture.balanceOf(venue(), y)).json).toMatchObject({
      total: "140.00",
      received: "30.00",
    });
  });

  it("its party leaving unpaid files its receipt at 90.00, the 30.00 advance taken off 120.00", async () => {
    const y = await reopenedWithAdvance("Tasting menu");
    const partyId = await partyOf(y);

    const left = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/parties/${partyId}/unpaid-departure`,
      {
        billId: y,
        expectedPartyRevision: fixture.revisionOf(venue(), partyId),
        reason: "Left without paying",
        override: supervisor(),
      },
    );

    expect(left.status, JSON.stringify(left.json)).toBe(200);
    const receipts = await inTx(venue(), (tx) =>
      tx
        .select({ id: sales.id, total: sales.total })
        .from(sales)
        .where(eq(sales.workingOrderId, y)),
    );
    expect(receipts.map((receipt) => receipt.total)).toEqual([9000]);
    const records = filedInvoicesOf(venue().db, receipts[0]!.id, new Date());
    expect(records.map((record) => [record.total, record.errors])).toEqual([["90.00", []]]);
  });
});
