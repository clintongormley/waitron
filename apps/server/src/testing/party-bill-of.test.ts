import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders } from "@waitron/db";
import { insertPartyBill } from "../parties.js";
import { numbersOf } from "./bill-identities.js";
import { firstOpenBillOf } from "./party-bill-of.js";
import {
  inTx,
  order,
  pay,
  placeByHand,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./party-venue.js";
import "../errors.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function newBill(partyId: string): Promise<string> {
  return inTx(v, (tx) => insertPartyBill(tx, v.cfg, partyId));
}

async function openBillOf(partyId: string): Promise<string | null> {
  return inTx(v, (tx) => firstOpenBillOf(tx, partyId));
}

describe("A803 fixtures: firstOpenBillOf", () => {
  it("names the lowest-numbered open bill, skipping paid and presented ones", async () => {
    const { partyId, tabId: bill1 } = await seat(v, await v.table("Mesa 61"));
    const bill2 = await newBill(partyId);
    const bill3 = await newBill(partyId);
    const bill4 = await newBill(partyId);
    await order(v, bill1, "Burger");
    await pay(v, bill1, "12.00");
    await placeByHand(v, bill2);
    expect((await numbersOf(v, partyId)).map(([id, n]) => [id, n])).toEqual([
      [bill1, 1],
      [bill2, 2],
      [bill3, 3],
      [bill4, 4],
    ]);

    expect(await openBillOf(partyId)).toBe(bill3);
  });

  it("names none for a party whose bills are all paid", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 62"));
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");

    expect(await openBillOf(partyId)).toBeNull();
  });

  it("names Bill 1 over an older-opened Bill 2", async () => {
    const { partyId, tabId: bill1 } = await seat(v, await v.table("Mesa 63"));
    const bill2 = await newBill(partyId);
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ openedAt: "2000-01-01T00:00:00.000Z" })
        .where(eq(workingOrders.id, bill2)),
    );
    expect((await numbersOf(v, partyId)).map(([id, n]) => [id, n])).toEqual([
      [bill1, 1],
      [bill2, 2],
    ]);

    expect(await openBillOf(partyId)).toBe(bill1);
  });
});
