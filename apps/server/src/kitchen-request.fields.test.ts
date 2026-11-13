import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ticketItems, withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { updateOrderLine } from "./testing/order-writer-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { readCurrentOrders, type GroupRelease } from "./order-groups.js";
import { advanceTicketItem, listStationQueue } from "./working-order.js";
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
afterEach(() => {
  vi.useRealTimers();
});

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const dish = (venue: Venue, product: "burger" | "water", chips = false) => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists[product],
            picks: [{ productId: venue.products.chips, quantity: 1 }],
          },
        ],
      }
    : {}),
});

async function place(
  tx: Transaction,
  venue: Venue,
  release: GroupRelease,
  lines: ReturnType<typeof dish>[],
) {
  return placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines, release }],
  });
}

async function lineOf(tx: Transaction, venue: Venue, product: "burger" | "water" | "chips") {
  const found = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo, itemId: ticketItems.id })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, venue.party.tabId),
        eq(workingOrderLines.productId, venue.products[product]),
      ),
    );
  expect(found).toHaveLength(1);
  return found[0]!;
}

async function queueItem(tx: Transaction, stationId: string, lineId: string) {
  const groups = await listStationQueue(tx, stationId);
  const item = groups.flatMap((group) => group.items).find((i) => i.workingOrderLineId === lineId);
  expect(item).toBeDefined();
  return item!;
}

async function currentRow(tx: Transaction, venue: Venue, lineId: string) {
  const orders = await readCurrentOrders(tx, venue.party.partyId);
  const row = [...orders.groups.flatMap((group) => group.rows), ...orders.ungrouped].find(
    (candidate) => candidate.lineId === lineId,
  );
  expect(row).toBeDefined();
  return row!;
}

async function routeBottledToBar(tx: Transaction, venue: Venue) {
  await setRoutingCell(
    tx,
    { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
    { kind: "station", stationId: venue.stations.bar },
  );
}

/** A Requested burger at a waiting Grill and a Bar water, placed at AT; the water is ready at LATER. */
async function requestedBurgerAndReadyWater(tx: Transaction, venue: Venue) {
  await routeBottledToBar(tx, venue);
  await setStationsWaitForPass(tx, true, [venue.stations.grill]);
  await place(tx, venue, "fire", [dish(venue, "burger"), dish(venue, "water")]);
  const water = await lineOf(tx, venue, "water");
  await advanceTicketItem(tx, water.itemId!, "preparing");
  vi.setSystemTime(new Date(LATER));
  await advanceTicketItem(tx, water.itemId!, "ready");
  return { burger: await lineOf(tx, venue, "burger"), water };
}

describe("A773 pass fields", () => {
  it("tells the station queue each item's phase, request and ready times, and whether the pass controls it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const { burger, water } = await requestedBurgerAndReadyWater(tx, venue);

      expect(await queueItem(tx, venue.stations.grill, burger.id)).toMatchObject({
        phase: "requested",
        requestedAt: AT,
        firedAt: null,
        readyAt: null,
        passControlled: true,
      });
      const bar = await queueItem(tx, venue.stations.bar, water.id);
      expect(bar).toMatchObject({
        phase: "ready",
        requestedAt: AT,
        firedAt: AT,
        readyAt: LATER,
        passControlled: false,
      });
    });
  });

  it("tells current orders each dish's kitchen phase and request time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const { burger, water } = await requestedBurgerAndReadyWater(tx, venue);

      const burgerRow = await currentRow(tx, venue, burger.id);
      expect(burgerRow.kitchen).toMatchObject({ phase: "requested", requestedAt: AT });
      expect(burgerRow).toMatchObject({ requestedAt: AT, firedAt: null });
      const waterRow = await currentRow(tx, venue, water.id);
      expect(waterRow.firedAt).toBe(AT);
      expect(waterRow).toMatchObject({ requestedAt: waterRow.firedAt });
      expect(waterRow.kitchen).toMatchObject({ phase: "ready", requestedAt: AT });
    });
  });

  it("dates a dish's request by its extra that has waited since earlier", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await place(tx, venue, "fire", [dish(venue, "burger", true)]);
      const burger = await lineOf(tx, venue, "burger");
      vi.setSystemTime(new Date(LATER));
      const [order] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, venue.party.tabId));
      await updateOrderLine(
        tx,
        venue.cfg,
        venue.party.tabId,
        burger.lineNo,
        { portionLineNos: [], note: "No salt" },
        order!.revision,
        OPERATOR,
      );

      const stamps = await tx
        .select({
          lineId: ticketItems.workingOrderLineId,
          requestedAt: ticketItems.requestedAt,
          firedAt: ticketItems.firedAt,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, venue.party.tabId));
      const chips = await lineOf(tx, venue, "chips");
      expect(stamps.find((s) => s.lineId === burger.id)).toMatchObject({
        requestedAt: LATER,
        firedAt: LATER,
      });
      expect(stamps.find((s) => s.lineId === chips.id)).toMatchObject({
        requestedAt: AT,
        firedAt: null,
      });

      const row = await currentRow(tx, venue, burger.id);
      expect(row).toMatchObject({ requestedAt: AT, firedAt: null });
    });
  });

  it("dates a row with no kitchen work by its fire, and a held one not at all", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          { lines: [dish(venue, "water")], release: "fire" },
          { lines: [dish(venue, "water")], release: "hold" },
        ],
      });
      const [fired, held] = placed.groups.map((group) => group.lineIds[0]!) as [string, string];
      expect(await currentRow(tx, venue, fired)).toMatchObject({
        kitchen: null,
        requestedAt: AT,
        firedAt: AT,
      });
      expect(await currentRow(tx, venue, held)).toMatchObject({
        kitchen: null,
        requestedAt: null,
        firedAt: null,
      });
    });
  });

  it("reads a held dish as held, with no request time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await place(tx, venue, "hold", [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");

      expect(await queueItem(tx, venue.stations.grill, burger.id)).toMatchObject({
        phase: "held",
        requestedAt: null,
        firedAt: null,
      });
      const row = await currentRow(tx, venue, burger.id);
      expect(row.kitchen).toMatchObject({ phase: "held", requestedAt: null });
      expect(row).toMatchObject({ requestedAt: null, firedAt: null });
    });
  });
});
