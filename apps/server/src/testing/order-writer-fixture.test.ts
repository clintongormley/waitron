import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { addGroupedTabRound, addTabRound } from "./order-writer-fixture.js";
import { inTx, seatWithNoAllergies, setupPartyVenue, type PartyVenue } from "./party-venue.js";

let v: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

it("addTabRound writes a quantity of three as three dishes, each with its own fired ticket item", async () => {
  const p = await seatWithNoAllergies(v, await v.table(`Round ${randomUUID().slice(0, 8)}`));

  await inTx(v, (tx) =>
    addTabRound(tx, v.cfg, p.tabId, [{ menuItemId: v.item("Burger"), quantity: "3" }]),
  );

  const lines = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId))
    .orderBy(asc(workingOrderLines.lineNo));
  expect(lines.map((line) => line.quantity)).toEqual([1000, 1000, 1000]);
  expect(lines.map((line) => line.cohortOrdinal)).toEqual([1, 2, 3]);
  expect(lines.map((line) => line.wholePortion)).toEqual([true, true, true]);
  expect(lines[0]!.cohortId).not.toBeNull();
  expect(new Set(lines.map((line) => line.cohortId)).size).toBe(1);
  const items = await v.db
    .select()
    .from(ticketItems)
    .where(
      inArray(
        ticketItems.workingOrderLineId,
        lines.map((line) => line.id),
      ),
    );
  const firedLines = items
    .filter((item) => item.firedAt !== null)
    .map((item) => item.workingOrderLineId);
  expect([...firedLines].sort()).toEqual(lines.map((line) => line.id).sort());
});

it("addGroupedTabRound writes a quantity of three as one unbound row of three, with one fired ticket item", async () => {
  const p = await seatWithNoAllergies(v, await v.table(`Round ${randomUUID().slice(0, 8)}`));

  await inTx(v, (tx) =>
    addGroupedTabRound(tx, v.cfg, p.tabId, [{ menuItemId: v.item("Burger"), quantity: "3" }]),
  );

  const lines = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  expect(lines.map((line) => line.quantity)).toEqual([3000]);
  expect(lines.map((line) => line.cohortId)).toEqual([null]);
  const items = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lines[0]!.id));
  expect(items.map((item) => item.firedAt !== null)).toEqual([true]);
});
