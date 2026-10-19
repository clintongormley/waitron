import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  OPERATOR,
  commandFor,
  floorRow,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
} from "./testing/party-venue.js";
import { joinTables, moveGuests } from "./testing/table-action-fixture.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("A669 marks only tables whose seated party has an allergic guest and clears the mark after deletion", async () => {
  const venue = await setupPartyVenue(suite.db);
  const marked = await venue.table("Allergic party");
  const other = await venue.table("Other party");
  const free = await venue.table("Free table");
  const joining = await venue.table("Joined table");
  expect(await floorRow(venue, free)).not.toHaveProperty("hasAllergy");
  const party = await seat(venue, marked, 2);
  await seat(venue, other, 2);
  expect(await floorRow(venue, marked)).not.toHaveProperty("hasAllergy");

  await inTx(venue, (tx) =>
    VENUE_SERVICE.savePartyAllergy(
      tx,
      party.partyId,
      party.revision,
      {
        answer: "allergies",
        guests: [{ who: "Guest 2", allergens: { milk: {} } }],
      },
      OPERATOR,
    ),
  );

  expect(await floorRow(venue, marked)).toMatchObject({ hasAllergy: true });
  expect(await floorRow(venue, other)).not.toHaveProperty("hasAllergy");
  expect(await floorRow(venue, free)).not.toHaveProperty("hasAllergy");

  const command = await commandFor(venue, party.partyId);
  await inTx(venue, (tx) =>
    joinTables(tx, venue.cfg, party.partyId, joining, {
      ...command,
      bills: "merge",
      otherPartyId: null,
    }),
  );
  expect(await floorRow(venue, joining)).toMatchObject({ hasAllergy: true });

  const moving = await commandFor(venue, party.partyId);
  await inTx(venue, (tx) =>
    moveGuests(tx, venue.cfg, party.partyId, free, {
      ...moving,
      bills: "merge",
      otherPartyId: null,
    }),
  );
  expect(await floorRow(venue, free)).toMatchObject({ hasAllergy: true });
  expect(await floorRow(venue, marked)).not.toHaveProperty("hasAllergy");
  expect(await floorRow(venue, joining)).not.toHaveProperty("hasAllergy");

  const revision = await revisionOf(venue, party.partyId);
  await inTx(venue, (tx) =>
    VENUE_SERVICE.savePartyAllergy(
      tx,
      party.partyId,
      revision,
      {
        answer: "allergies",
        guests: [],
      },
      OPERATOR,
    ),
  );
  expect(await floorRow(venue, marked)).not.toHaveProperty("hasAllergy");
  expect(await floorRow(venue, joining)).not.toHaveProperty("hasAllergy");
  expect(await floorRow(venue, free)).not.toHaveProperty("hasAllergy");
});
