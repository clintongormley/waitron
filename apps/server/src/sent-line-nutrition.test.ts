import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { updateProduct } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readTabLines } from "./working-order.js";
import { submitGroups } from "./testing/group-submit-fixture.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seatWithNoAllergies,
  setupPartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("keeps the dish declaration from its first send after the product changes", async () => {
  const v = await setupPartyVenue(suite.db);
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
    }),
  );
  const party = await seatWithNoAllergies(v, await v.table("Sent declarations"));
  const expectedPartyRevision = await revisionOf(v, party.partyId);
  await inTx(v, (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision,
      operatorId: OPERATOR,
      groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
    }),
  );
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), {
      allergens: { eggs: {} },
      dietaryDeclarations: [],
    }),
  );
  const lines = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  expect(lines).toHaveLength(1);
  expect(lines[0]!.sentAt).toEqual(expect.any(String));
  expect(lines[0]!.nutrition).toEqual({
    allergens: { milk: {} },
    dietaryDeclarations: ["vegetarian"],
  });
});
