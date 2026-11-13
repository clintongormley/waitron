import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  allergyLineTicks,
  parties,
  workingOrderLines,
  workingOrders,
  OPEN_PARENT_REFUSAL,
  triggerRaised,
  captureError,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readPartyAllergy, setAllergyLineTicks, writePartyAllergy } from "@waitron/venue-service";
import {
  OPERATOR,
  inTx,
  order,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

it("keeps allergy ticks writable after settlement while the dish line is frozen", async () => {
  const p = await seat(v, await v.table("Settled allergy"));
  await inTx(v, (tx) =>
    writePartyAllergy(
      tx,
      p.partyId,
      {
        answer: "allergies",
        guests: [{ who: "Window seat", allergens: { milk: {} } }],
      },
      OPERATOR,
    ),
  );
  await order(v, p.tabId, "Burger");
  await pay(v, p.tabId, "12.00");
  const [bill] = await v.db.select().from(workingOrders).where(eq(workingOrders.id, p.tabId));
  const [party] = await v.db.select().from(parties).where(eq(parties.id, p.partyId));
  expect(bill!.status).toBe("settled");
  expect(party!.state).toBe("open");
  const [line] = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId));
  const allergy = await inTx(v, (tx) => readPartyAllergy(tx, p.partyId));
  const guestId = allergy.guests[0]!.id;
  await inTx(v, (tx) => setAllergyLineTicks(tx, p.partyId, [{ guestId, workingLineId: line!.id }]));
  expect(
    await v.db
      .select({ guestId: allergyLineTicks.guestId, workingLineId: allergyLineTicks.workingLineId })
      .from(allergyLineTicks)
      .where(eq(allergyLineTicks.guestId, guestId)),
  ).toEqual([{ guestId, workingLineId: line!.id }]);
  const error = await captureError(() =>
    inTx(v, async (tx) =>
      tx.run(
        sql`update working_order_lines set kitchen_name = kitchen_name || ' ' where id = ${line!.id}`,
      ),
    ),
  );
  expect(triggerRaised(error, OPEN_PARENT_REFUSAL)).toBe(true);
});
