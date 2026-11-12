import { seedActivityActor } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { setRoutingCell, setStationToday, writePartyAllergy } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { readPassRows } from "./working-order.js";
import { readPassCardRows, readScopedPassBoard, type PassScope } from "./pass-board.js";
import type { PassBoard, PassCard } from "./pass-card.js";
import { fireNewOrder } from "./testing/split-extras-venue.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { createCourse, createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { fireGroup, moveGroupsToParty } from "./order-groups.js";
import { withStationDishes } from "./station-closing.js";
import { createTable } from "./testing/live-table.js";
import { seatTable } from "./parties.js";
import { addTabRound, sendLines } from "./testing/order-writer-fixture.js";
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

async function seatAnotherParty(tx: Transaction, venue: Venue, label: string): Promise<string> {
  const { id: tableId } = await createTable(tx, venue.cfg, { label, zoneId: venue.party.zoneId });
  const { partyId } = await seatTable(tx, venue.cfg, {
    tableId,
    guestCount: null,
    operatorId: OPERATOR,
  });
  await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, OPERATOR);
  return partyId;
}

const onOrder = (orderId: string) => sql`${workingOrders.id} = ${orderId}`;

describe("A773 pass board: reads", () => {
  it("reads a Fire now group's card on the pass board", async () => {
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
      const [card, ...others] = cards(await readScopedPassBoard(tx, EVERY));
      expect(others).toEqual([]);
      expect(card).toEqual({
        key: `group:${placed.groupId}`,
        target: { kind: "group", partyId: venue.party.partyId, groupId: placed.groupId },
        kind: "new_order",
        requestedAt: AT,
        readyAt: null,
        allReady: false,
        party: { id: venue.party.partyId, revision: 0 },
        orders: [
          {
            orderId: venue.party.tabId,
            orderNumber: 1,
            kitchenNote: null,
            tableLabel: "Split extras",
            tableShortNames: ["Split extras"],
          },
        ],
        group: { displayNumber: 1, position: 1 },
        items: [
          {
            ...item,
            id: placed.burgerItem,
            name: "BURG",
            stationName: "Grill",
            firedAt: null,
            lineId: placed.burgerLine,
            orderId: venue.party.tabId,
            stationId: venue.stations.grill,
            phase: "requested",
            requestedAt: AT,
            readyAt: null,
            visible: true,
            informational: false,
            passControlled: true,
            course: null,
            stationClosed: false,
            extra: false,
          },
          {
            ...item,
            id: placed.waterItem,
            name: "H2O",
            stationName: "Bar",
            firedAt: AT,
            lineId: placed.waterLine,
            orderId: venue.party.tabId,
            stationId: venue.stations.bar,
            phase: "waiting",
            requestedAt: AT,
            readyAt: null,
            visible: true,
            informational: true,
            passControlled: false,
            course: null,
            stationClosed: false,
            extra: false,
          },
        ],
        releaseTicketItemIds: [placed.burgerItem],
        releaseContext: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });
  });

  it("ages a card's dishes against one reading of the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const tenMinutes = Date.parse(AT) + 10 * 60_000;
      const now = vi
        .spyOn(Date, "now")
        .mockReturnValueOnce(tenMinutes - 1)
        .mockReturnValue(tenMinutes);
      try {
        const [card] = cards(await readScopedPassBoard(tx, EVERY));
        const bands = new Map(card!.items.map((dish) => [dish.id, dish.band]));
        // Ten minutes is Overdue, so a second reading of the clock would tip either dish over.
        expect([bands.get(placed.burgerItem), bands.get(placed.waterItem)]).toEqual([
          "warm",
          "warm",
        ]);
      } finally {
        now.mockRestore();
      }
    });
  });

  it("dates a group's party by its first stored group, read or not", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      vi.setSystemTime(new Date(Date.parse(AT) - 60 * 60_000));
      const other = await seatAnotherParty(tx, venue, "Earlier party");
      await placeGroups(tx, venue.cfg, other, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      vi.setSystemTime(new Date(AT));
      const first = await burgerAndWater(tx, venue);
      vi.setSystemTime(new Date(Date.parse(AT) + 60 * 60_000));
      const later = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
        })
      ).groups[0]!;
      const rows = await readPassRows(
        tx,
        sql`${workingOrderLines.groupId} = ${later.id}`,
        Date.now(),
      );
      expect(rows.map((row) => row.group?.id)).toEqual([later.id]);
      expect(rows[0]!.group!.createdAt).not.toBe(AT);
      const [stored] = await tx
        .select({ createdAt: orderGroups.createdAt })
        .from(orderGroups)
        .where(eq(orderGroups.id, first.groupId));
      expect(rows[0]!.group!.partyFirstCreatedAt).toBe(stored!.createdAt);
    });
  });

  it("reads a later group's kind, two portions, a ready time, a course and the group's own party", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const first = await burgerAndWater(tx, venue);
      const later = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
        })
      ).groups[0]!;
      const laterItem = await ticketItemOf(tx, later.lineIds[0]!);
      const course = await createCourse(tx, { name: "Mains", displayOrder: 3 });
      await tx
        .update(ticketItems)
        .set({ courseId: course.id })
        .where(eq(ticketItems.id, laterItem));
      const readyAt = new Date(Date.parse(AT) + 5 * 60_000).toISOString();
      await tx
        .update(ticketItems)
        .set({ state: "ready", readyAt })
        .where(eq(ticketItems.id, first.waterItem));
      const other = await seatAnotherParty(tx, venue, "Merged into");
      // As a merge does: the groups move, this bill stays on its own party.
      await moveGroupsToParty(tx, venue.party.partyId, other);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "burger"), quantity: "2" },
      ]);
      const [two] = await tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, venue.party.tabId),
            isNull(workingOrderLines.groupId),
          ),
        );
      await sendLines(tx, venue.cfg, venue.party.tabId, [two!.lineNo]);
      const twoItem = await ticketItemOf(tx, two!.id);
      const [kind] = await tx
        .select({ requestKind: orderGroups.requestKind })
        .from(orderGroups)
        .where(eq(orderGroups.id, later.id));
      expect(kind!.requestKind).not.toBe("new_order");

      const rows = await readPassRows(tx, onOrder(venue.party.tabId), Date.now());
      const byItem = new Map(rows.map((row) => [row.item.id, row]));
      expect(byItem.get(laterItem)).toMatchObject({
        partyId: venue.party.partyId,
        group: { id: later.id, partyId: other, requestKind: kind!.requestKind },
        course: { id: course.id, name: "Mains", displayOrder: 3 },
      });
      expect(byItem.get(twoItem)!.remaining).toBe(2000);
      expect(byItem.get(first.waterItem)!.readyAt).toBe(readyAt);
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
      const rows = await readPassRows(tx, onOrder(venue.party.tabId), Date.now());
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
      const extras = (await readPassRows(tx, onOrder(venue.party.tabId), Date.now())).filter(
        (row) => row.group?.id === second.groups[0]!.id,
      );
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

const EVERY: PassScope = { stationIds: null, zoneIds: null };

const cards = (board: PassBoard): PassCard[] => [
  ...board.held,
  ...board.toFire,
  ...board.inProgress,
  ...board.ready,
];

async function partyRow(tx: Transaction, partyId: string) {
  const [row] = await tx
    .select({ id: parties.id, revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!;
}

async function billCommand(tx: Transaction, venue: Venue) {
  return {
    partyId: venue.party.partyId,
    expectedPartyRevision: (await partyRow(tx, venue.party.partyId)).revision,
    operatorId: OPERATOR,
  };
}

describe("A773 pass board: scoped", () => {
  it("puts a Requested dish on the board, its Bar water informational", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const board = await readScopedPassBoard(tx, EVERY);
      expect(cards(board)).toHaveLength(1);
      const [card] = board.toFire;
      expect(card!.target).toEqual({
        kind: "group",
        partyId: venue.party.partyId,
        groupId: placed.groupId,
      });
      expect(card!.releaseTicketItemIds).toEqual([placed.burgerItem]);
      expect(card!.releaseContext).toMatch(/^[0-9a-f]{64}$/);
      const items = new Map(card!.items.map((item) => [item.id, item]));
      expect(items.get(placed.burgerItem)).toMatchObject({
        phase: "requested",
        informational: false,
        stationId: venue.stations.grill,
      });
      expect(items.get(placed.waterItem)).toMatchObject({
        phase: "waiting",
        informational: true,
        stationId: venue.stations.bar,
      });
    });
  });

  it("puts one group's dishes on two bills on one card", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger"), dish(venue, "burger")], release: "fire" }],
      });
      const [first, second] = placed.groups[0]!.lineIds as [string, string];
      const { billId } = await moveDishes(
        tx,
        venue.cfg,
        venue.party.tabId,
        null,
        [second],
        await billCommand(tx, venue),
      );
      const board = await readScopedPassBoard(tx, EVERY);
      expect(cards(board)).toHaveLength(1);
      const [card] = board.toFire;
      expect(card!.releaseTicketItemIds).toEqual(
        [await ticketItemOf(tx, first), await ticketItemOf(tx, second)].sort(),
      );
      expect(card!.orders.map((order) => order.orderId).sort()).toEqual(
        [venue.party.tabId, billId].sort(),
      );
    });
  });

  it("shows a held group as a held card with nothing to fire", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const burgerItem = await ticketItemOf(tx, placed.groups[0]!.lineIds[0]!);
      const waiting = await readScopedPassBoard(tx, EVERY);
      expect(cards(waiting)).toHaveLength(1);
      expect(waiting.held[0]).toMatchObject({
        kind: "held",
        releaseTicketItemIds: [],
        releaseContext: null,
      });
      expect(waiting.held[0]!.items).toEqual([
        expect.objectContaining({ id: burgerItem, phase: "held", informational: false }),
      ]);

      await setStationsWaitForPass(tx, false, [venue.stations.grill]);
      const notWaiting = await readScopedPassBoard(tx, EVERY);
      expect(notWaiting.held[0]!.items).toEqual([
        expect.objectContaining({ id: burgerItem, phase: "held", informational: false }),
      ]);

      await setStationsWaitForPass(tx, true, [venue.stations.bar]);
      const barWaiting = await readScopedPassBoard(tx, EVERY);
      expect(barWaiting.held[0]!.items).toEqual([
        expect.objectContaining({ id: burgerItem, phase: "held", informational: true }),
      ]);
    });
  });

  it("gives a counter order its own new order card", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const orderId = await fireNewOrder(tx, venue.cfg, [
        { productId: venue.products.burger, quantity: "1" },
      ]);
      const board = await readScopedPassBoard(tx, EVERY);
      expect(cards(board)).toHaveLength(1);
      expect(board.toFire[0]).toMatchObject({
        target: { kind: "bill", workingOrderId: orderId },
        kind: "new_order",
      });
      expect(board.toFire[0]!.releaseTicketItemIds).toHaveLength(1);
    });
  });

  it("lists a card only on a pass that sees one of its dishes", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const fryer = await readScopedPassBoard(tx, {
        stationIds: [venue.stations.fryer],
        zoneIds: null,
      });
      expect(cards(fryer)).toEqual([]);
      const grill = await readScopedPassBoard(tx, {
        stationIds: [venue.stations.grill],
        zoneIds: null,
      });
      expect(cards(grill)).toHaveLength(1);
      expect(grill.toFire[0]!.releaseTicketItemIds).toEqual([placed.burgerItem]);
    });
  });

  it("lists a card only on a pass on its zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const counter = await readScopedPassBoard(tx, {
        stationIds: null,
        zoneIds: [venue.counter.zoneId],
      });
      expect(cards(counter)).toEqual([]);
      const tables = await readScopedPassBoard(tx, {
        stationIds: null,
        zoneIds: [venue.party.zoneId],
      });
      expect(cards(tables)).toHaveLength(1);
      expect(tables.toFire[0]!.releaseTicketItemIds).toEqual([placed.burgerItem]);
    });
  });

  it("gives a party bill's dish outside any group its own card, and reads each card back alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger")]);
      const [loose] = await tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, venue.party.tabId),
            isNull(workingOrderLines.groupId),
          ),
        );
      await sendLines(tx, venue.cfg, venue.party.tabId, [loose!.lineNo]);
      const looseItem = await ticketItemOf(tx, loose!.id);

      const board = await readScopedPassBoard(tx, EVERY);
      const groupCard = cards(board).find((card) => card.target.kind === "group")!;
      const billCard = cards(board).find((card) => card.target.kind === "bill")!;
      expect(cards(board)).toHaveLength(2);
      expect(billCard.target).toEqual({ kind: "bill", workingOrderId: venue.party.tabId });
      expect(billCard.items.map((item) => item.id)).toEqual([looseItem]);
      expect(groupCard.items.map((item) => item.id).sort()).toEqual(
        [placed.burgerItem, placed.waterItem].sort(),
      );

      const idsOf = async (card: PassCard) =>
        (await readPassCardRows(tx, card.target)).map((row) => row.item.id).sort();
      expect(await idsOf(groupCard)).toEqual(groupCard.items.map((item) => item.id).sort());
      expect(await idsOf(billCard)).toEqual([looseItem]);
      expect(
        await readPassCardRows(tx, {
          kind: "group",
          partyId: randomUUID(),
          groupId: placed.groupId,
        }),
      ).toEqual([]);
    });
  });

  it("marks no held dish closed at a closed station", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const burgerItem = await ticketItemOf(tx, placed.groups[0]!.lineIds[0]!);
      await setStationToday(
        tx,
        venue.stations.grill,
        "closed",
        new Date(AT),
        await seedActivityActor(tx),
      );
      const { held } = await readScopedPassBoard(tx, EVERY);
      expect(held).toHaveLength(1);
      expect(held[0]!.items.find((item) => item.id === burgerItem)).toMatchObject({
        phase: "held",
        stationClosed: false,
      });
    });
  });

  it("reads the whole group on a pass that sees only part of it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const cold = (await createStation(tx, { name: "Cold" })).id;
      await routeProductTo(tx, venue.products.cheese, cold);
      await setRoutingCell(
        tx,
        { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
        { kind: "station", stationId: venue.stations.bar },
      );
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            lines: [
              dish(venue, "burger"),
              dish(venue, "water"),
              { menuItemId: venue.tables.offerFor(venue.products.cheese), quantity: "1" },
            ],
            release: "fire",
          },
        ],
      });
      const [burgerLine, waterLine, saladLine] = placed.groups[0]!.lineIds as [
        string,
        string,
        string,
      ];
      await moveDishes(
        tx,
        venue.cfg,
        venue.party.tabId,
        null,
        [saladLine],
        await billCommand(tx, venue),
      );
      const burgerItem = await ticketItemOf(tx, burgerLine);
      const waterItem = await ticketItemOf(tx, waterLine);
      const saladItem = await ticketItemOf(tx, saladLine);
      await tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, saladItem));
      const scope = { stationIds: [venue.stations.grill], zoneIds: null };

      const board = await readScopedPassBoard(tx, scope);
      expect(cards(board)).toHaveLength(1);
      const [card] = board.toFire;
      expect(card!.items.map((item) => item.id).sort()).toEqual(
        [burgerItem, waterItem, saladItem].sort(),
      );
      for (const id of [waterItem, saladItem])
        expect(card!.items.find((item) => item.id === id)).toMatchObject({
          visible: false,
          informational: true,
        });
      expect(card!.allReady).toBe(false);

      await tx
        .update(ticketItems)
        .set({ firedAt: AT, state: "ready", readyAt: AT })
        .where(eq(ticketItems.id, burgerItem));
      const after = await readScopedPassBoard(tx, scope);
      expect(after.ready).toEqual([]);
      expect(after.inProgress.map((entry) => entry.key)).toEqual([card!.key]);
      expect(after.inProgress[0]!.allReady).toBe(false);
    });
  });

  it("offers no Fire while a dish sits at a closed station nothing kept it at", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const burger = async () => {
        const { toFire } = await readScopedPassBoard(tx, EVERY);
        expect(toFire).toHaveLength(1);
        const [card] = toFire;
        return { card: card!, item: card!.items.find((item) => item.id === placed.burgerItem)! };
      };

      await setStationToday(
        tx,
        venue.stations.grill,
        "closed",
        new Date(AT),
        await seedActivityActor(tx),
      );
      const closed = await burger();
      expect(closed.item.stationClosed).toBe(true);
      expect(closed.card.releaseTicketItemIds).toEqual([]);
      expect(closed.card.releaseContext).toBeNull();

      await setStationToday(
        tx,
        venue.stations.grill,
        null,
        new Date(AT),
        await seedActivityActor(tx),
      );
      const reopened = await burger();
      expect(reopened.item.stationClosed).toBe(false);
      expect(reopened.card.releaseTicketItemIds).toEqual([placed.burgerItem]);
      expect(reopened.card.releaseContext).toMatch(/^[0-9a-f]{64}$/);

      await withStationDishes(
        tx,
        venue.cfg,
        venue.stations.grill,
        undefined,
        "leave",
        async (at) =>
          setStationToday(tx, venue.stations.grill, "closed", at, await seedActivityActor(tx)),
        { deviceId: venue.cfg.origin.deviceId, personId: null },
      );
      const left = await burger();
      expect(left.item.stationClosed).toBe(false);
      expect(left.card.releaseTicketItemIds).toEqual([placed.burgerItem]);
      expect(left.card.releaseContext).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("judges a dish's station closed at the instant the board ages it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      const twoDaysBefore = Date.parse(AT) - 2 * 24 * 60 * 60_000;
      await setStationToday(
        tx,
        venue.stations.grill,
        "closed",
        new Date(twoDaysBefore),
        await seedActivityActor(tx),
      );
      const now = vi.spyOn(Date, "now").mockReturnValueOnce(twoDaysBefore);
      try {
        const { toFire } = await readScopedPassBoard(tx, EVERY);
        expect(toFire).toHaveLength(1);
        expect(toFire[0]!.items.find((item) => item.id === placed.burgerItem)!.stationClosed).toBe(
          true,
        );
      } finally {
        now.mockRestore();
      }
    });
  });

  it("offers Fire for a split-off extra Requested at its closed station, marked closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger", true)], release: "hold" }],
      });
      const groupId = placed.groups[0]!.id;
      const chipsLine = await lineIdOf(tx, venue.party.tabId, "Chips");
      const chipsItem = await ticketItemOf(tx, chipsLine);
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await setStationToday(
        tx,
        venue.stations.fryer,
        "closed",
        new Date(AT),
        await seedActivityActor(tx),
      );
      await fireGroup(tx, venue.cfg, venue.party.partyId, groupId, {
        submissionId: randomUUID(),
        expectedPartyRevision: (await partyRow(tx, venue.party.partyId)).revision,
        operatorId: OPERATOR,
      });
      const [stored] = await tx.select().from(ticketItems).where(eq(ticketItems.id, chipsItem));
      expect(stored).toMatchObject({
        stationId: venue.stations.fryer,
        requestedAt: AT,
        firedAt: null,
        stationChosenAt: null,
      });

      const { toFire } = await readScopedPassBoard(tx, EVERY);
      expect(toFire).toHaveLength(1);
      const [card] = toFire;
      expect(card!.items.find((item) => item.id === chipsItem)).toMatchObject({
        extra: true,
        stationClosed: true,
      });
      expect(card!.releaseTicketItemIds).toEqual([chipsItem]);
      expect(card!.releaseContext).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("carries the party's stored revision and each dish's course for Ready", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await burgerAndWater(tx, venue);
      await tx
        .update(parties)
        .set({ revision: sql`${parties.revision} + 7` })
        .where(eq(parties.id, venue.party.partyId));
      const { toFire } = await readScopedPassBoard(tx, EVERY);
      expect(toFire).toHaveLength(1);
      const [card] = toFire;
      expect(card!.party).toEqual(await partyRow(tx, venue.party.partyId));
      expect(card!.party!.revision).not.toBe(0);
      expect(card!.items.find((item) => item.id === placed.burgerItem)!.course).toBeNull();
    });
  });
});
