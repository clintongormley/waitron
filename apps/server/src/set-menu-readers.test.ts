import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { updateProduct } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createStation } from "./kitchen.js";
import { readLineNutrition } from "./line-nutrition.js";
import { readCurrentOrders } from "./order-group-reads.js";
import { readOrderPreviewItems } from "./order-preview.js";
import { readOrderStateCounts } from "./order-state-counts.js";
import { readArrivingAllergyDishes, readPartyAllergyView } from "./party-allergy.js";
import { inTx } from "./testing/party-venue.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    await inTx(fixture.venue, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      await updateProduct(tx, fixture.copy.productId, { allergens: { milk: {} } });
    });
  },
});

it("lists only the dish in current orders", async () => {
  const { partyId, dishId } = await setMenuBill(fixture);
  const current = await inTx(fixture.venue, (tx) => readCurrentOrders(tx, partyId));
  expect(
    [...current.ungrouped, ...current.groups.flatMap((group) => group.rows)].map(
      (row) => row.lineId,
    ),
  ).toEqual([dishId]);
});

it("lists only the dish in the order preview", async () => {
  const { billId, dishId } = await setMenuBill(fixture);
  const preview = await inTx(fixture.venue, (tx) => readOrderPreviewItems(tx, [billId]));
  expect(preview.get(billId)?.map((row) => row.lineId)).toEqual([dishId]);
});

it.each(["party", "arrival"] as const)(
  "shows the dish's allergy declaration on %s",
  async (read) => {
    const { billId, partyId, dishId } = await setMenuBill(fixture);
    const { venue } = fixture;
    const dishes = await inTx(venue, (tx) =>
      read === "party"
        ? readPartyAllergyView(tx, partyId).then((view) => view.dishes)
        : readArrivingAllergyDishes(tx, billId),
    );
    expect(dishes.map(({ line, allergens }) => ({ line, allergens }))).toEqual([
      { line: { kind: "working", id: dishId }, allergens: { milk: {} } },
    ]);
  },
);

it("counts the dish as ordered and waiting", async () => {
  const { billId } = await setMenuBill(fixture);
  const counts = await inTx(fixture.venue, (tx) => readOrderStateCounts(tx, [billId]));
  expect(counts.get(billId)).toEqual({ ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 });
});

it("reads nutrition for the dish alone", async () => {
  const { menuLineId, dishId } = await setMenuBill(fixture);
  const nutrition = await inTx(fixture.venue, (tx) => readLineNutrition(tx, [menuLineId, dishId]));
  expect([...nutrition]).toEqual([[dishId, { allergens: { milk: {} }, dietaryDeclarations: [] }]]);
});
