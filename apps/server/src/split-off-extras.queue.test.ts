import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ticketItems, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { listExpoQueue, listStationQueue } from "./working-order.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});

describe("split extra queues", () => {
  it("shows a routed extra once at Fryer and cross references both kitchen lines", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await fireNewOrder(tx, venue.cfg, [
        {
          productId: venue.products.burger,
          quantity: "1",
          extras: [
            {
              listId: venue.lists.burger,
              picks: [
                { productId: venue.products.chips, quantity: 2 },
                { productId: venue.products.cheese, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      const grill = await listStationQueue(tx, venue.stations.grill);
      const fryer = await listStationQueue(tx, venue.stations.fryer);
      expect(grill.flatMap((g) => g.items)).toHaveLength(1);
      expect(grill[0]!.items[0]!.name).toBe("BURG");
      expect(grill[0]!.items[0]!.modifiers).toHaveLength(1);
      expect(grill[0]!.items[0]!.modifiers[0]!.descriptions).toEqual({ "es-ES": "Queso extra" });
      expect(grill[0]!.items[0]!.crossRefs).toEqual([
        {
          kind: "with",
          name: "CHIPS",
          perDish: 2,
          stationName: "Fryer",
          addAllergens: { gluten: { presence: "contains", source: "wheat" } },
          suitableFor: [],
        },
      ]);
      expect(fryer.flatMap((g) => g.items)).toHaveLength(1);
      expect(fryer[0]!.items[0]!.name).toBe("CHIPS");
      expect(fryer[0]!.items[0]!.quantity).toBe("2.000");
      expect(fryer[0]!.items[0]!.asServed.allergens).toEqual({
        gluten: { presence: "contains", source: "wheat" },
      });
      expect(fryer[0]!.items[0]!.crossRefs).toEqual([
        { kind: "for", name: "BURG", stationName: "Grill" },
      ]);
      const expo = await listExpoQueue(tx, venue.cfg);
      const items = expo.flatMap((order) =>
        order.courses
          .flatMap((course) => course.items)
          .concat(order.groups.flatMap((group) => group.items)),
      );
      expect(items.map((item) => item.name).sort()).toEqual(["BURG", "CHIPS"]);
      expect(items.find((item) => item.name === "BURG")!.modifiers).toHaveLength(1);
      expect(items.find((item) => item.name === "BURG")!.crossRefs).toEqual(
        grill[0]!.items[0]!.crossRefs,
      );
      expect(items.find((item) => item.name === "CHIPS")!.crossRefs).toEqual(
        fryer[0]!.items[0]!.crossRefs,
      );
      await tx
        .update(ticketItems)
        .set({ stationId: venue.stations.kitchen })
        .where(eq(ticketItems.workingOrderLineId, grill[0]!.items[0]!.workingOrderLineId));
      const moved = await listStationQueue(tx, venue.stations.fryer);
      expect(moved[0]!.items[0]!.crossRefs).toEqual([
        { kind: "for", name: "BURG", stationName: "Kitchen" },
      ]);
    });
  });

  it("names no preparation for the parent of a split extra", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await fireNewOrder(tx, venue.cfg, [
        {
          productId: venue.products.water,
          quantity: "1",
          extras: [
            {
              listId: venue.lists.water,
              picks: [{ productId: venue.products.chips, quantity: 1 }],
            },
          ],
        },
      ]);
      const fryer = await listStationQueue(tx, venue.stations.fryer);
      expect(fryer[0]!.items[0]!.crossRefs).toEqual([
        { kind: "for", name: "AGUA", stationName: null },
      ]);
    });
  });
});
