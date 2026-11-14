import { and, eq, sql, inArray } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import {
  statementChunks,
  kitchenPrintJobLines,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { workingLineContexts } from "@waitron/venue-service";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { offerProducts } from "./testing/zone-offers.js";
import { createTableKitchenOrder } from "./testing/kitchen-table-order.js";
import { fireAll } from "./testing/serve-line.js";
import { insertTabRound, priceTabRound } from "./working-order.js";
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
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(and(eq(workingOrderLines.workingOrderId, id), eq(ticketItems.stationId, stationId)))
    )[0]!.count;
  expect(await count(venue.stations.grill)).toBe(2400);
  expect(await count(venue.stations.fryer)).toBe(2400);
});

// One printer here, the pass, takes both stations' tickets: a job of 5,462 burgers and 5,462 chips
// links 10,924 lines to it, more than one statement of three values a row can bind.
it("A1208 one send of 5,462 burgers each with chips links every burger and every chips to the pass printer's ticket", async () => {
  const venue = await setupSplitExtrasVenue();
  const lines: ProductLine[] = [];
  for (let left = 5462; left > 0; left -= 99)
    lines.push({
      productId: venue.products.burger,
      quantity: String(Math.min(left, 99)),
      extras: [
        { listId: venue.lists.burger, picks: [{ productId: venue.products.chips, quantity: 1 }] },
      ],
    });

  const id = await withTransaction(suite.db, (tx) => fireNewOrder(tx, venue.cfg, lines));

  const [linked] = await suite.db
    .select({ count: sql<number>`count(*)` })
    .from(kitchenPrintJobLines)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobLines.printJobId))
    .innerJoin(
      ticketItems,
      eq(ticketItems.workingOrderLineId, kitchenPrintJobLines.workingOrderLineId),
    )
    .where(
      and(
        eq(printJobs.printerId, venue.printers.pass),
        inArray(
          ticketItems.workingOrderLineId,
          sql`(select id from working_order_lines where working_order_id = ${id})`,
        ),
      ),
    );
  expect(linked!.count).toBe(10924);
});

// A table's bill records what the kitchen knew of its party's allergies for each ticket item it
// fires, three values a row: 11,880 burgers fired at once are more than one statement can bind.
it("A1208 a table bill firing 11,880 burgers at once records an allergy snapshot for every burger", async () => {
  const venue = await setupSplitExtrasVenue();
  const id = await withTransaction(suite.db, async (tx) => {
    const tabId = await createTableKitchenOrder(tx, venue.cfg);
    const offers = await offerProducts(tx, venue.cfg, { zone: "tables" });
    const round = offers.toOfferLines(
      Array.from({ length: 990 }, () => ({ productId: venue.products.burger, quantity: "1" })),
    );
    for (let n = 0; n < 12; n++) {
      const priced = await priceTabRound(tx, venue.cfg, tabId, round, "checked");
      await insertTabRound(tx, venue.cfg, priced, priced.rows);
    }
    await fireAll(tx, venue.cfg, tabId);
    return tabId;
  });

  const [snapshots] = suite.db.all<{ count: number }>(
    sql`select count(*) as count from ticket_items t where t.allergy_frozen = 1 and t.working_order_line_id in (select id from working_order_lines where working_order_id = ${id})`,
  );
  expect(snapshots!.count).toBe(11880);
});

it("a 1,188-water round keeps every line and context and an extra across the insert boundary", async () => {
  const venue = await setupSplitExtrasVenue();
  await withTransaction(suite.db, async (tx) => {
    const tabId = await createTableKitchenOrder(tx, venue.cfg);
    const offers = await offerProducts(tx, venue.cfg, { zone: "tables" });
    const water = Array.from({ length: 1188 }, () => ({
      productId: venue.products.water,
      quantity: "1",
    }));
    const pricedWater = await priceTabRound(
      tx,
      venue.cfg,
      tabId,
      offers.toOfferLines(water),
      "checked",
    );
    const boundary = statementChunks(workingOrderLines, pricedWater.rows)[0]!.length;
    const lines: ProductLine[] = [];
    for (const count of [boundary - 1, 1188 - (boundary - 1)]) {
      for (let left = count; left > 0; left--)
        lines.push({ productId: venue.products.water, quantity: "1" });
      if (lines.some((line) => line.productId === venue.products.burger)) continue;
      lines.push({
        productId: venue.products.burger,
        quantity: "1",
        extras: [
          { listId: venue.lists.burger, picks: [{ productId: venue.products.chips, quantity: 1 }] },
        ],
      });
    }
    const round = await priceTabRound(tx, venue.cfg, tabId, offers.toOfferLines(lines), "checked");
    expect(round.rows[boundary - 1]!.productId).toBe(venue.products.burger);
    expect(round.rows[boundary]!.parentLineId).toBe(round.rows[boundary - 1]!.id);
    const rows = round.rows.map((row) => ({ ...row, groupId: null, creditedTo: null }));
    expect(tx.insert(workingOrderLines).values(rows).toSQL().params.length).toBeGreaterThan(32766);
    const inserted = await insertTabRound(tx, venue.cfg, round, rows);
    expect(inserted.map((row) => row.id)).toEqual(round.rows.map((row) => row.id));
    const stored = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(stored).toHaveLength(1190);
    expect(stored[boundary]!.parentLineId).toBe(stored[boundary - 1]!.id);
    const contexts = await tx
      .select({ id: workingLineContexts.workingOrderLineId })
      .from(workingLineContexts)
      .innerJoin(
        workingOrderLines,
        eq(workingOrderLines.id, workingLineContexts.workingOrderLineId),
      )
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(new Set(contexts.map((row) => row.id))).toEqual(new Set(stored.map((row) => row.id)));
    await fireAll(tx, venue.cfg, tabId);
    const kitchen = await tx
      .select({ id: ticketItems.workingOrderLineId })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(kitchen.map((row) => row.id).sort()).toEqual(
      [stored[boundary - 1]!.id, stored[boundary]!.id].sort(),
    );
  });
});
