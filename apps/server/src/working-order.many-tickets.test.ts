import { and, eq, sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { ticketItems, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
  type ProductLine,
} from "./testing/split-extras-venue.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
beforeAll(() => useSplitExtrasDb(suite.db));

// Node's own SQLite binds at most 32,766 values per statement; one send here writes more than that
// to `ticket_items` twice: once for the dishes and once for the extras made at another station.
it("A1208 one send of 2,400 burgers each with chips writes a kitchen item for every burger and every chips", async () => {
  const venue = await setupSplitExtrasVenue();
  const lines: ProductLine[] = [];
  for (let left = 2400; left > 0; left -= 99)
    lines.push({
      productId: venue.products.burger,
      quantity: String(Math.min(left, 99)),
      extras: [
        { listId: venue.lists.burger, picks: [{ productId: venue.products.chips, quantity: 1 }] },
      ],
    });

  const id = await withTransaction(suite.db, (tx) => fireNewOrder(tx, venue.cfg, lines));

  const count = async (stationId: string) =>
    (
      await suite.db
        .select({ count: sql<number>`count(*)` })
        .from(ticketItems)
        .where(and(eq(ticketItems.workingOrderId, id), eq(ticketItems.stationId, stationId)))
    )[0]!.count;
  expect(await count(venue.stations.grill)).toBe(2400);
  expect(await count(venue.stations.fryer)).toBe(2400);
});
