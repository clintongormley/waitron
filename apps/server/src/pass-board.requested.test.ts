import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  orderGroups,
  parties,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { readPassBoard, readPassRows } from "./working-order.js";
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

async function ticketItemOf(tx: Transaction, lineId: string): Promise<string> {
  const [row] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row!.id;
}

async function lineIdOf(tx: Transaction, orderId: string, name: string): Promise<string> {
  const rows = await tx
    .select({ id: workingOrderLines.id, name: workingOrderLines.name })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId));
  const found = rows.filter((row) => row.name === name);
  expect(found).toHaveLength(1);
  return found[0]!.id;
}

/** Grill waits; one Fire now group of a burger (Grill) and a water routed to Bar. */
async function burgerAndWater(tx: Transaction, venue: Venue) {
  await setRoutingCell(
    tx,
    venue.cfg,
    { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
    { kind: "station", stationId: venue.stations.bar },
  );
  await setStationsWaitForPass(tx, true, [venue.stations.grill]);
  const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines: [dish(venue, "burger"), dish(venue, "water")], release: "fire" }],
  });
  const group = placed.groups[0]!;
  const [burgerLine, waterLine] = group.lineIds as [string, string];
  return {
    groupId: group.id,
    burgerLine,
    waterLine,
    burgerItem: await ticketItemOf(tx, burgerLine),
    waterItem: await ticketItemOf(tx, waterLine),
  };
}

const onOrder = (orderId: string) => sql`${workingOrders.id} = ${orderId}`;

describe("A773 pass board: reads", () => {
  it("reads today's pass board for a Fire now group unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const group = {
        id: placed.groupId,
        position: 1,
        displayNumber: 1,
        numberPartyId: venue.party.partyId,
        state: "fired",
      };
      const item = {
        allergy: null,
        optionSnapshots: [],
        qty: "1.000",
        unitName: { es: "ud" },
        unitPrecision: 0,
        soldInEach: true,
        state: "queued",
        note: null,
        modifiers: [],
        asServed: { allergens: {}, pending: true },
        asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
        queuedAt: AT,
        group,
        thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        band: "fresh",
      };
      expect(await readPassBoard(tx, venue.cfg.locationId, onOrder(venue.party.tabId))).toEqual([
        {
          orderId: venue.party.tabId,
          kitchenNote: null,
          orderNumber: 1,
          openedMinutes: 0,
          party: { id: venue.party.partyId, revision: 0 },
          courses: [],
          groups: [
            {
              groupId: placed.groupId,
              position: 1,
              displayNumber: 1,
              numberPartyId: venue.party.partyId,
              state: "fired",
              fired: false,
              items: [
                {
                  ...item,
                  id: placed.burgerItem,
                  name: "BURG",
                  stationName: "Grill",
                  firedAt: null,
                },
                { ...item, id: placed.waterItem, name: "H2O", stationName: "Bar", firedAt: AT },
              ],
            },
          ],
          tableLabel: "Split extras",
          worstBand: "fresh",
        },
      ]);
    });
  });

  it("gives each row the facts the pass card and its release read", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      const [groupRow] = await tx
        .select({ createdAt: orderGroups.createdAt, requestKind: orderGroups.requestKind })
        .from(orderGroups)
        .where(eq(orderGroups.id, placed.groupId));
      const rows = await readPassRows(tx, venue.cfg.locationId, onOrder(venue.party.tabId));
      expect(rows.map((row) => row.lineId)).toEqual([placed.burgerLine, placed.waterLine]);
      expect(rows[0]).toMatchObject({
        item: { id: placed.burgerItem, name: "BURG", firedAt: null },
        lineId: placed.burgerLine,
        orderId: venue.party.tabId,
        stationId: venue.stations.grill,
        partyId: venue.party.partyId,
        partyRevision: party!.revision,
        course: null,
        group: {
          id: placed.groupId,
          partyId: venue.party.partyId,
          state: "fired",
          requestKind: groupRow!.requestKind,
          position: 1,
          displayNumber: 1,
          createdAt: groupRow!.createdAt,
        },
        requestedAt: AT,
        firedAt: null,
        readyAt: null,
        passControlled: true,
        remaining: 1000,
        recalled: false,
        stationChosenAt: null,
        stationRetainedAtRelease: false,
        makeAtStationId: null,
        extra: false,
        order: { orderNumber: 1, tableLabel: "Split extras", kitchenNote: null },
      });
      expect(rows[1]).toMatchObject({
        item: { id: placed.waterItem, name: "H2O" },
        stationId: venue.stations.bar,
        firedAt: AT,
        passControlled: false,
        extra: false,
      });

      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      const second = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger", true)], release: "fire" }],
      });
      const chipsLine = await lineIdOf(tx, venue.party.tabId, "Chips");
      const secondBurger = second.groups[0]!.lineIds.find((id) => id !== chipsLine)!;
      const extras = (
        await readPassRows(tx, venue.cfg.locationId, onOrder(venue.party.tabId))
      ).filter((row) => row.group?.id === second.groups[0]!.id);
      expect(extras.map((row) => [row.lineId, row.extra])).toEqual([
        [secondBurger, false],
        [chipsLine, true],
      ]);
      expect(extras.find((row) => row.lineId === chipsLine)).toMatchObject({
        stationId: venue.stations.fryer,
        passControlled: true,
      });
    });
  });
});
