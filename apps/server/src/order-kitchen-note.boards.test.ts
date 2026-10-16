import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { kitchenStations, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeKitchenNote } from "@waitron/venue-service";
import {
  inTx,
  order,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { listStationQueues, readPassBoard } from "./working-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
});

describe("canonical kitchen instructions on preparation boards", () => {
  it("shares the latest party instruction across bills and station/pass reads without changing line notes", async () => {
    const p = await seat(v, await v.table("Train party"));
    await order(v, p.tabId, "Burger", "Flan");
    const second = await split(v, p.partyId, p.tabId, [2]);
    await inTx(v, async (tx) => {
      await tx.update(ticketItems).set({ note: "No onions" });
      await writeKitchenNote(tx, { workingOrderId: p.tabId }, 0, "Obsolete counter note");
      await writeKitchenNote(tx, { partyId: p.partyId }, 0, "Train at 14:30");
    });
    const stationIds = (await v.db.select({ id: kitchenStations.id }).from(kitchenStations)).map(
      (row) => row.id,
    );
    const read = () =>
      inTx(v, async (tx) => ({
        station: [...(await listStationQueues(tx, stationIds)).values()].flat(),
        pass: await readPassBoard(tx, v.cfg.locationId, sql`1=1`),
      }));
    const first = await read();
    for (const board of [first.station, first.pass]) {
      expect(board.map((row) => row.orderId).sort()).toEqual([p.tabId, second].sort());
      expect(board.map((row) => row.kitchenNote)).toEqual(["Train at 14:30", "Train at 14:30"]);
    }
    expect(first.station.flatMap((group) => group.items).map((item) => item.note)).toEqual([
      "No onions",
      "No onions",
    ]);
    expect(
      first.pass
        .flatMap((group) => group.groups.flatMap((section) => section.items))
        .map((item) => item.note),
    ).toEqual(["No onions", "No onions"]);
    await inTx(v, (tx) => writeKitchenNote(tx, { partyId: p.partyId }, 1, "Train at 15:00"));
    const later = await read();
    for (const board of [later.station, later.pass])
      expect(board.map((row) => row.kitchenNote)).toEqual(["Train at 15:00", "Train at 15:00"]);
    await inTx(v, (tx) => writeKitchenNote(tx, { partyId: p.partyId }, 2, null));
    const cleared = await read();
    for (const board of [cleared.station, cleared.pass])
      expect(board.map((row) => row.kitchenNote)).toEqual([null, null]);
    expect(
      await v.db
        .select({ note: workingOrderLines.note })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId)),
    ).toEqual([{ note: null }]);
  });
});
