import { describe, expect, it } from "vitest";
import { kitchenStations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining } from "@waitron/shared";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import { readScopedPassBoard } from "./pass-board.js";
import { inTx, provisionBillVenue, seatedWith, type BillVenue } from "./testing/bill-venue.js";
import { boardCards, EVERY } from "./testing/pass-board-probe.js";
import { listStationQueues } from "./working-order-station-queue.js";

// The station queue and the pass name each order's way of selling, so a takeaway order is packed
// (A1522, Decision 12).
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

async function seatedSelling(dining: Dining): Promise<string> {
  await inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments))
      await setDepartmentSalePolicyField(tx, id, "dining", dining);
  });
  return (await seatedWith(venue, "Croquettes")).tabId;
}

async function twoBills(): Promise<{ eatIn: string; takeaway: string }> {
  return { eatIn: await seatedSelling("eat_in"), takeaway: await seatedSelling("takeaway") };
}

describe("the kitchen's reads of an order", () => {
  it("carry each order's way of selling on the station queue", async () => {
    const { eatIn, takeaway } = await twoBills();
    const queues = await inTx(venue, async (tx) =>
      listStationQueues(
        tx,
        (await tx.select({ id: kitchenStations.id }).from(kitchenStations)).map(({ id }) => id),
      ),
    );
    const groups = [...queues.values()].flat();
    expect(groups.find((group) => group.orderId === eatIn)?.dining).toBe("eat_in");
    expect(groups.find((group) => group.orderId === takeaway)?.dining).toBe("takeaway");
  });

  it("carry each order's way of selling on the pass", async () => {
    const { eatIn, takeaway } = await twoBills();
    const orders = boardCards(await inTx(venue, (tx) => readScopedPassBoard(tx, EVERY))).flatMap(
      (card) => card.orders,
    );
    expect(orders.find((order) => order.orderId === eatIn)?.dining).toBe("eat_in");
    expect(orders.find((order) => order.orderId === takeaway)?.dining).toBe("takeaway");
  });
});
