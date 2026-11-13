import { seedZone, seedPerson } from "@waitron/db/testing/seed.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { deleteCourse } from "./course-delete.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  devices,
  kitchenStations,
  orderGroupEvents,
  orderGroups,
  printJobs,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { splitBill } from "./testing/bill-action-fixture.js";
import { createCourse } from "./kitchen.js";
import { moveBill, type MoveBillOptions, type MoveTarget } from "./testing/move-bill-fixture.js";
import {
  bumpGroupReady,
  fireGroup,
  groupArrivingDishes,
  readCurrentOrders,
} from "./order-groups.js";
import { attachPrinterToStation, detachPrinterFromStation } from "./station-printers.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import { fireOrderLines, parkOrder } from "./working-order.js";
import { readScopedPassBoard } from "./pass-board.js";
import { boardCards, EVERY } from "./testing/pass-board-probe.js";
import { printedLines } from "./testing/decode-ticket.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  OPERATOR,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  nextMillisecond,
  order,
  orderForParty,
  partyAt,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";
import { setStationPrinting } from "./testing/station-printing.js";

const MOVER = "cccccccc-0000-4000-8000-000000000002";
const FIRER = "cccccccc-0000-4000-8000-000000000003";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// Dishes that arrive in a party by Move a bill or Split a table get a kitchen group, so the pass
// can mark them and the waiter can release what is unsent (table actions plan, Task 9; A96, P16).
let v: PartyVenue;
/** A counter zone whose orders are invoiced when placed. */
let ticketThenPayZone: string;
let starterCourseId: string;
let mainCourseId: string;
let dessertCourseId: string;

// `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await seedPerson(db, { id: MOVER, displayName: "Moving operator" });
    ticketThenPayZone = await inTx(v, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Invoice counter" })];
      return (
        await offerProducts(tx, v.cfg, {
          zone: { zoneId: zone!.id },
          orderStart: "counter",
        })
      ).zoneId;
    });
    [starterCourseId, mainCourseId, dessertCourseId] = await inTx(v, async (tx) => [
      (await createCourse(tx, { name: "Starters", displayOrder: 1 })).id,
      (await createCourse(tx, { name: "Mains", displayOrder: 2 })).id,
      (await createCourse(tx, { name: "Desserts", displayOrder: 3 })).id,
    ]);
  },
});

async function move(billId: string, to: MoveTarget, opts: Partial<MoveBillOptions> = {}) {
  const own = (await billRow(v, billId)).partyId;
  const target = "tableId" in to ? await partyAt(v, to.tableId) : null;
  const options: MoveBillOptions = {
    operatorId: OPERATOR,
    ...(own === null ? {} : { expectedPartyRevision: await revisionOf(v, own) }),
    ...(target === null || target === own
      ? {}
      : { otherPartyId: target, expectedOtherPartyRevision: await revisionOf(v, target) }),
    ...opts,
  };
  return inTx(v, (tx) => moveBill(tx, v.cfg, billId, to, options));
}

async function splitOff(partyId: string, billId: string, lineNos: number[]): Promise<string> {
  const command = await commandFor(v, partyId);
  const { billId: made } = await inTx(v, (tx) =>
    splitBill(
      tx,
      v.cfg,
      billId,
      lineNos.map((lineNo) => ({ lineNo })),
      command,
    ),
  );
  return made;
}

/** The party's groups, by position. */
async function groupsOf(partyId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        id: orderGroups.id,
        position: orderGroups.position,
        state: orderGroups.state,
        firedAt: orderGroups.firedAt,
        firedBy: orderGroups.firedBy,
        submittedBy: orderGroups.submittedBy,
      })
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(asc(orderGroups.position)),
  );
}

/** Every stored column of the bill's lines, in line order. */
async function lineRows(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** The bill's kitchen items with `fired_at` set. */
async function firedTicketsOf(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ lineId: ticketItems.workingOrderLineId, state: ticketItems.state })
      .from(ticketItems)
      .where(and(eq(ticketItems.workingOrderId, billId), isNotNull(ticketItems.firedAt))),
  );
}

/** The groups of the pass cards holding a bill's dishes; null for a card that is the bill's own. */
async function passGroupsOf(billId: string) {
  const board = await inTx(v, (tx) => readScopedPassBoard(tx, EVERY));
  return boardCards(board)
    .filter((card) => card.items.some((item) => item.orderId === billId))
    .map((card) => (card.target.kind === "group" ? card.target.groupId : null));
}

async function eventsOf(groupId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        partyId: orderGroupEvents.partyId,
        kind: orderGroupEvents.kind,
        actorId: orderGroupEvents.actorId,
        detail: orderGroupEvents.detail,
      })
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.groupId, groupId)),
  );
}

async function command(partyId: string) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, partyId),
    operatorId: OPERATOR,
  };
}

/** A table bill of a new party at `label`: Burger for the first course, sent, and Flan for dessert, waiting. */
async function coursedBill(label: string) {
  const originalParty = await seat(v, await v.table(label));
  await inTx(v, (tx) =>
    addTabRound(tx, v.cfg, originalParty.tabId, [
      { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
      { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
    ]),
  );
  return originalParty;
}

describe("dishes arriving in a party (A96, P16)", () => {
  it("puts a moved bill's sent dishes in one new fired group, after the receiving party's last group", async () => {
    const [table4, table7] = [await v.table("Table 4"), await v.table("Table 7")];
    const originalParty = await seat(v, table4);
    const receivingParty = await seat(v, table7);
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);
    await orderForParty(v, receivingParty.partyId, ["Water"]);
    const groupsBefore = await groupsOf(receivingParty.partyId);

    await move(b2, { tableId: table7 });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.slice(0, -1)).toEqual(groupsBefore);
    expect(groups.at(-1)).toMatchObject({
      state: "fired",
      position: groupsBefore.length + 1,
      firedAt: expect.any(String),
      firedBy: OPERATOR,
      submittedBy: OPERATOR,
    });
    const made = groups.at(-1)!.id;
    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([made]);
    expect(await eventsOf(made)).toEqual([
      {
        partyId: receivingParty.partyId,
        kind: "lines_moved",
        actorId: OPERATOR,
        detail: { workingOrderId: b2, arrived: true },
      },
    ]);
  });

  it("dates a moved bill's fired group from its earliest kitchen firing and names whoever fired that dish's group in the party it left", async () => {
    const [table4, table7] = [await v.table("Time 4"), await v.table("Time 7")];
    const originalParty = await seat(v, table4);
    const receivingParty = await seat(v, table7);
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    await orderForParty(v, originalParty.partyId, ["Paella"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2, 3]);
    const [wineLine, riceLine] = await lineRows(b2);
    // The later line fired first, so neither the first line nor the latest firing is the answer;
    // the first line's sent time is earlier still, so a sent time must not outrank a kitchen item.
    const earliest = minutesAgo(25);
    await inTx(v, async (tx) => {
      for (const [line, firedAt, sentAt] of [
        [wineLine!, minutesAgo(12), minutesAgo(40)],
        [riceLine!, earliest, minutesAgo(5)],
      ] as const) {
        await tx
          .update(ticketItems)
          .set({ firedAt })
          .where(eq(ticketItems.workingOrderLineId, line.id));
        await tx.update(workingOrderLines).set({ sentAt }).where(eq(workingOrderLines.id, line.id));
      }
      await tx
        .update(orderGroups)
        .set({ firedBy: FIRER })
        .where(eq(orderGroups.id, riceLine!.groupId!));
    });

    await move(b2, { tableId: table7 }, { operatorId: MOVER });

    const made = (await groupsOf(receivingParty.partyId)).at(-1)!;
    expect(made).toMatchObject({
      state: "fired",
      firedAt: earliest,
      firedBy: FIRER,
      submittedBy: MOVER,
    });
    const current = await inTx(v, (tx) => readCurrentOrders(tx, receivingParty.partyId));
    expect(current.groups.find((g) => g.id === made.id)).toMatchObject({
      firedAt: earliest,
      sentAt: earliest,
    });
  });

  it("dates an arriving fired group from a dish's sent time where the dish has no kitchen item, and names the mover when that dish records no firer", async () => {
    const originalParty = await seat(v, await v.table("Time 5"));
    const receivingParty = await seat(v, await v.table("Time 8"));
    await order(v, originalParty.tabId, "Burger");
    const [burger] = await lineRows(originalParty.tabId);
    const sent = minutesAgo(30);
    await inTx(v, async (tx) => {
      await tx
        .update(ticketItems)
        .set({ firedAt: minutesAgo(10) })
        .where(eq(ticketItems.workingOrderLineId, burger!.id));
      await tx
        .insert(workingOrderLines)
        .values({ ...burger!, id: randomUUID(), lineNo: 2, sentAt: sent });
    });

    // Only the later-fired dish records who fired it.
    const made = await inTx(v, (tx: Transaction) =>
      groupArrivingDishes(
        tx,
        v.cfg,
        receivingParty.partyId,
        originalParty.tabId,
        MOVER,
        new Map([[burger!.id, { personId: FIRER }]]),
      ),
    );

    const [group] = await groupsOf(receivingParty.partyId);
    expect(group).toMatchObject({
      id: made.fired,
      state: "fired",
      firedAt: sent,
      firedBy: MOVER,
    });
  });

  it("lets the pass mark a moved bill's dishes ready through their new group", async () => {
    const [table4, table7] = [await v.table("Pass 4"), await v.table("Pass 7")];
    const originalParty = await seat(v, table4);
    const receivingParty = await seat(v, table7);
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);

    await move(b2, { tableId: table7 });

    const made = (await groupsOf(receivingParty.partyId)).at(-1)!.id;
    expect(await passGroupsOf(b2)).toEqual([made]);
    const ready = await command(receivingParty.partyId);
    await inTx(v, (tx) => bumpGroupReady(tx, receivingParty.partyId, made, ready));
    expect(await firedTicketsOf(b2)).toEqual([{ lineId: expect.any(String), state: "ready" }]);
  });

  it("puts sent dishes in a fired group and a dish waiting for its course in a held group, which the waiter then releases", async () => {
    const originalParty = await coursedBill("Course 1");
    const targetTable = await v.table("Course 2");
    const receivingParty = await seat(v, targetTable);
    const [burger, custardLine] = await lineRows(originalParty.tabId);
    expect(await firedTicketsOf(originalParty.tabId)).toEqual([
      { lineId: burger!.id, state: "queued" },
    ]);

    await move(originalParty.tabId, { tableId: targetTable });

    const [fired, held] = await groupsOf(receivingParty.partyId);
    expect(fired).toMatchObject({ state: "fired", position: 1 });
    expect(held).toMatchObject({ state: "held", position: 2, firedAt: null, firedBy: null });
    expect((await lineRows(originalParty.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [custardLine!.id, held!.id],
    ]);
    expect(await eventsOf(held!.id)).toEqual([
      {
        partyId: receivingParty.partyId,
        kind: "lines_moved",
        actorId: OPERATOR,
        detail: { workingOrderId: originalParty.tabId, arrived: true },
      },
    ]);
    expect(await firedTicketsOf(originalParty.tabId)).toHaveLength(1);

    const fire = await command(receivingParty.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, receivingParty.partyId, held!.id, fire));

    expect(await firedTicketsOf(originalParty.tabId)).toHaveLength(2);
  });

  it("holds a moved bill's waiting dishes course by course, so firing one held group sends none of a later one", async () => {
    const originalParty = await seat(v, await v.table("Courses 1"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, originalParty.tabId, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
        { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
        { menuItemId: v.item("Tarta"), quantity: "1", courseId: mainCourseId },
      ]),
    );
    const targetTable = await v.table("Courses 2");
    const receivingParty = await seat(v, targetTable);
    const [burger, custardLine, cakeLine] = await lineRows(originalParty.tabId);
    expect(await firedTicketsOf(originalParty.tabId)).toEqual([
      { lineId: burger!.id, state: "queued" },
    ]);

    await move(originalParty.tabId, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
      ["held", 3],
    ]);
    const [fired, heldMains, heldDesserts] = groups;
    expect((await lineRows(originalParty.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [custardLine!.id, heldDesserts!.id],
      [cakeLine!.id, heldMains!.id],
    ]);
    for (const held of [heldMains!, heldDesserts!]) {
      expect(await eventsOf(held.id)).toEqual([
        {
          partyId: receivingParty.partyId,
          kind: "lines_moved",
          actorId: OPERATOR,
          detail: { workingOrderId: originalParty.tabId, arrived: true },
        },
      ]);
    }

    const fireMains = await command(receivingParty.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, receivingParty.partyId, heldMains!.id, fireMains));

    expect((await firedTicketsOf(originalParty.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, cakeLine!.id].sort(),
    );
  });

  it("fires a moved no-course dish while leaving live held courses separate", async () => {
    const originalParty = await seat(v, await v.table("No course 1"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, originalParty.tabId, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
        { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
        { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        { menuItemId: v.item("Tarta"), quantity: "1", courseId: mainCourseId },
      ]),
    );
    const targetTable = await v.table("No course 2");
    const receivingParty = await seat(v, targetTable);
    const [burger, custardLine, loose, cakeLine] = await lineRows(originalParty.tabId);
    expect([loose!.courseId, loose!.sentAt]).toEqual([null, null]);

    await move(originalParty.tabId, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
      ["held", 3],
    ]);
    const [fired, heldMains, heldDesserts] = groups;
    expect((await lineRows(originalParty.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [custardLine!.id, heldDesserts!.id],
      [loose!.id, fired!.id],
      [cakeLine!.id, heldMains!.id],
    ]);

    const fireDesserts = await command(receivingParty.partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, receivingParty.partyId, heldDesserts!.id, fireDesserts),
    );

    expect((await firedTicketsOf(originalParty.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, custardLine!.id, loose!.id].sort(),
    );

    const fireMains = await command(receivingParty.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, receivingParty.partyId, heldMains!.id, fireMains));

    expect((await firedTicketsOf(originalParty.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, custardLine!.id, loose!.id, cakeLine!.id].sort(),
    );
  });

  it("fires every moved no-course dish when no live held course remains", async () => {
    const originalParty = await seat(v, await v.table("No course 3"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, originalParty.tabId, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
        { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        { menuItemId: v.item("Flan"), quantity: "1", hold: true },
      ]),
    );
    const targetTable = await v.table("No course 4");
    const receivingParty = await seat(v, targetTable);
    const [burger, loose, custardLine] = await lineRows(originalParty.tabId);

    await move(originalParty.tabId, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([["fired", 1]]);
    expect((await lineRows(originalParty.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, groups[0]!.id],
      [loose!.id, groups[0]!.id],
      [custardLine!.id, groups[0]!.id],
    ]);
  });

  it("fires moved inactive and no-course dishes while keeping an active held course held", async () => {
    const retired = await inTx(
      v,
      async (tx) => (await createCourse(tx, { name: "Second course", displayOrder: 2 })).id,
    );
    const originalParty = await seat(v, await v.table("No course 5"));
    try {
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, originalParty.tabId, [
          { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
          { menuItemId: v.item("Tarta"), quantity: "1", courseId: retired },
          { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
          { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        ]),
      );
    } finally {
      // The venue is shared by the whole file.
      await inTx(v, (tx) => deleteCourse(tx, retired));
    }
    const targetTable = await v.table("No course 6");
    const receivingParty = await seat(v, targetTable);
    const [burger, cakeLine, custardLine, loose] = await lineRows(originalParty.tabId);

    await move(originalParty.tabId, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
    ]);
    const [fired, heldDesserts] = groups;
    expect((await lineRows(originalParty.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [cakeLine!.id, fired!.id],
      [custardLine!.id, heldDesserts!.id],
      [loose!.id, fired!.id],
    ]);

    const fireDesserts = await command(receivingParty.partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, receivingParty.partyId, heldDesserts!.id, fireDesserts),
    );

    expect((await firedTicketsOf(originalParty.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, cakeLine!.id, custardLine!.id, loose!.id].sort(),
    );
  });

  it("fires all moved inactive courses and no-course dishes without creating held groups", async () => {
    const [thirdCourseId, fourthCourseId] = await inTx(v, async (tx) => [
      (await createCourse(tx, { name: "Third course", displayOrder: 2 })).id,
      (await createCourse(tx, { name: "Fourth course", displayOrder: 4 })).id,
    ]);
    const originalParty = await seat(v, await v.table("No course 7"));
    try {
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, originalParty.tabId, [
          { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
          { menuItemId: v.item("Tarta"), quantity: "1", courseId: thirdCourseId },
          { menuItemId: v.item("Flan"), quantity: "1", courseId: fourthCourseId },
          { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        ]),
      );
    } finally {
      // The venue is shared by the whole file.
      await inTx(v, async (tx) => {
        await deleteCourse(tx, thirdCourseId);
        await deleteCourse(tx, fourthCourseId);
      });
    }
    const targetTable = await v.table("No course 8");
    const receivingParty = await seat(v, targetTable);
    const [burger, cakeLine, custardLine, loose] = await lineRows(originalParty.tabId);

    await move(originalParty.tabId, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([["fired", 1]]);
    const [fired] = groups;
    expect((await lineRows(originalParty.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [cakeLine!.id, fired!.id],
      [custardLine!.id, fired!.id],
      [loose!.id, fired!.id],
    ]);
  });

  it("puts an open counter order's dishes, sent to the kitchen at the move, in one new fired group", async () => {
    const targetTable = await v.table("Counter 1");
    const receivingParty = await seat(v, targetTable);
    const counter = await counterOrder(v, "Caña", "Tarta");
    expect(await firedTicketsOf(counter)).toEqual([]);

    await move(counter, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ state: "fired", position: 1 });
    expect((await lineRows(counter)).map((l) => l.groupId)).toEqual([groups[0]!.id, groups[0]!.id]);
    expect(await firedTicketsOf(counter)).toHaveLength(2);
  });

  it("gives a placed counter order moved into a party one fired group, leaving it placed and every other line value as it was", async () => {
    const targetTable = await v.table("Invoice 1");
    const receivingParty = await seat(v, targetTable);
    const id = randomUUID();
    const deps = { db: v.db, backend: v.backend, clock: v.clock };
    await parkOrder(deps, v.cfg, {
      id,
      zoneId: ticketThenPayZone,
      lines: ["Burger", "Red wine bottle"].map((name) => ({
        menuItemId: v.item(name),
        quantity: "1",
      })),
      operatorId: OPERATOR,
    });
    await placeOrder({ ...deps, admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
    const before = await lineRows(id);
    expect(before.every((l) => l.sentAt !== null && l.groupId === null)).toBe(true);

    await move(id, { tableId: targetTable });

    const [group] = await groupsOf(receivingParty.partyId);
    expect(group).toMatchObject({ state: "fired", position: 1 });
    expect((await billRow(v, id)).status).toBe("placed");
    expect(await lineRows(id)).toEqual(before.map((l) => ({ ...l, groupId: group!.id })));
    expect(await passGroupsOf(id)).toEqual([group!.id]);
  });

  it("gives a bill moved to a free table its new party's first group", async () => {
    const originalParty = await coursedBill("Free 1");
    const freeTable = await v.table("Free 2");
    await orderForParty(v, originalParty.partyId, ["Water"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [1]);

    const result = await move(b2, { tableId: freeTable });

    const groups = await groupsOf(result.partyId!);
    expect(groups.map((g) => [g.state, g.position])).toEqual([["fired", 1]]);
    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([groups[0]!.id]);
  });

  it("names whoever fired a dish's group in the party it left, not the mover, when its bill moves to a free table", async () => {
    const originalParty = await seat(v, await v.table("Free 3"));
    const freeTable = await v.table("Free 4");
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);
    const [wineLine] = await lineRows(b2);
    await inTx(v, (tx) =>
      tx.update(orderGroups).set({ firedBy: FIRER }).where(eq(orderGroups.id, wineLine!.groupId!)),
    );

    const result = await move(b2, { tableId: freeTable }, { operatorId: MOVER });

    expect(await groupsOf(result.partyId!)).toEqual([
      expect.objectContaining({ state: "fired", firedBy: FIRER, submittedBy: MOVER }),
    ]);
  });

  it("names the kitchen display that fired a dish's group in the party it left, not the mover, when its bill moves", async () => {
    const originalParty = await seat(v, await v.table("Free 5"));
    const freeTable = await v.table("Free 6");
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);
    const [wineLine] = await lineRows(b2);
    const display = await seedSessionDevice(v.db);
    await inTx(v, async (tx) => {
      await tx.update(devices).set({ label: "Kitchen screen" }).where(eq(devices.id, display));
      await tx
        .update(orderGroups)
        .set({ firedBy: null, firedByDeviceId: display })
        .where(eq(orderGroups.id, wineLine!.groupId!));
    });

    const result = await move(b2, { tableId: freeTable }, { operatorId: MOVER });

    const [made] = await inTx(v, (tx) =>
      tx
        .select({
          firedBy: orderGroups.firedBy,
          firedByDeviceId: orderGroups.firedByDeviceId,
          submittedBy: orderGroups.submittedBy,
        })
        .from(orderGroups)
        .where(eq(orderGroups.partyId, result.partyId!)),
    );
    expect(made).toEqual({ firedBy: null, firedByDeviceId: display, submittedBy: MOVER });
    const current = await inTx(v, (tx) => readCurrentOrders(tx, result.partyId!));
    expect(current.groups.map((g) => g.sentBy)).toEqual(["Kitchen screen"]);
  });

  it("names the kitchen display that fired a dish's group when Split a table takes its bill", async () => {
    const [table4, table5] = [await v.table("Split 6"), await v.table("Split 7")];
    const originalParty = await seat(v, table4);
    await nextMillisecond();
    const joining = { ...(await commandFor(v, originalParty.partyId)) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, originalParty.partyId, table5, joining));
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);
    const [wineLine] = await lineRows(b2);
    const display = await seedSessionDevice(v.db);
    await inTx(v, (tx) =>
      tx
        .update(orderGroups)
        .set({ firedBy: null, firedByDeviceId: display })
        .where(eq(orderGroups.id, wineLine!.groupId!)),
    );

    const splitting = { ...(await commandFor(v, originalParty.partyId)), operatorId: MOVER };
    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, originalParty.partyId, table5, b2, splitting),
    );

    const [made] = await inTx(v, (tx) =>
      tx
        .select({ firedBy: orderGroups.firedBy, firedByDeviceId: orderGroups.firedByDeviceId })
        .from(orderGroups)
        .where(eq(orderGroups.partyId, result.partyId)),
    );
    expect(made).toEqual({ firedBy: null, firedByDeviceId: display });
  });

  it("puts the chosen bill's sent dishes in ONE fired group at position 1 of the party Split a table starts, fired by whoever fired their group", async () => {
    const [table4, table5] = [await v.table("Split 4"), await v.table("Split 5")];
    const originalParty = await seat(v, table4);
    await nextMillisecond();
    const joining = { ...(await commandFor(v, originalParty.partyId)) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, originalParty.partyId, table5, joining));
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle", "Flan"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2, 3]);

    const splitting = { ...(await commandFor(v, originalParty.partyId)), operatorId: MOVER };
    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, originalParty.partyId, table5, b2, splitting),
    );

    const groups = await groupsOf(result.partyId);
    expect(groups.map((g) => [g.state, g.position, g.firedBy, g.submittedBy])).toEqual([
      ["fired", 1, OPERATOR, MOVER],
    ]);
    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([groups[0]!.id, groups[0]!.id]);
  });

  it("groups a counter order moved onto a seated table as a bill of its own, and leaves the party's first bill's lines as they were", async () => {
    const targetTable = await v.table("Merge 1");
    const receivingParty = await seat(v, targetTable);
    await orderForParty(v, receivingParty.partyId, ["Burger"]);
    await order(v, receivingParty.tabId, "Red wine bottle");
    const [burger, wineLine] = await lineRows(receivingParty.tabId);
    const [own] = await groupsOf(receivingParty.partyId);
    expect([burger!.groupId, wineLine!.groupId]).toEqual([own!.id, null]);
    const counter = await counterOrder(v, "Tarta");

    const result = await move(counter, { tableId: targetTable });

    expect(result).toEqual({ partyId: receivingParty.partyId, billId: counter });
    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.id === own!.id, g.state, g.position])).toEqual([
      [true, "fired", 1],
      [false, "fired", 2],
    ]);
    expect((await lineRows(receivingParty.tabId)).map((l) => [l.name, l.groupId])).toEqual([
      ["Burger", own!.id],
      ["Red wine bottle", null],
    ]);
    expect((await lineRows(counter)).map((l) => [l.name, l.groupId])).toEqual([
      ["Tarta", groups[1]!.id],
    ]);
    expect((await billRow(v, counter)).partyId).toBe(receivingParty.partyId);
  });

  it("lets a dish's kitchen item decide whether it arrived released, and its sent time decide only for a dish with none", async () => {
    const originalParty = await seat(v, await v.table("Sent 1"));
    const targetTable = await v.table("Sent 2");
    const receivingParty = await seat(v, targetTable);
    await order(v, originalParty.tabId, "Burger");
    const [burger] = await lineRows(originalParty.tabId);
    expect(burger!.sentAt).not.toBeNull();
    // The dish's kitchen item held while the dish reads as sent; the other dishes have no kitchen
    // item, one sent, one not, and one not and waiting for dessert.
    await inTx(v, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ courseId: dessertCourseId })
        .where(eq(workingOrderLines.id, burger!.id));
      await tx
        .update(ticketItems)
        .set({ firedAt: null, requestedAt: null })
        .where(eq(ticketItems.workingOrderLineId, burger!.id));
      await tx.insert(workingOrderLines).values([
        { ...burger!, id: randomUUID(), lineNo: 2 },
        { ...burger!, id: randomUUID(), lineNo: 3, sentAt: null, courseId: dessertCourseId },
        { ...burger!, id: randomUUID(), lineNo: 4, sentAt: null, courseId: dessertCourseId },
      ]);
    });

    const made = await inTx(v, (tx: Transaction) =>
      groupArrivingDishes(
        tx,
        v.cfg,
        receivingParty.partyId,
        originalParty.tabId,
        OPERATOR,
        new Map(),
      ),
    );

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => [g.id, g.state])).toEqual([
      [made.fired, "fired"],
      [made.held[0], "held"],
    ]);
    expect((await lineRows(originalParty.tabId)).map((l) => [l.lineNo, l.groupId])).toEqual([
      [1, made.held[0]],
      [2, made.fired],
      [3, made.held[0]],
      [4, made.held[0]],
    ]);
  });

  it("gives an extras line its dish's group", async () => {
    const originalParty = await seat(v, await v.table("Extra 1"));
    const targetTable = await v.table("Extra 2");
    const receivingParty = await seat(v, targetTable);
    await order(v, originalParty.tabId, "Burger");
    const [burger] = await lineRows(originalParty.tabId);
    // An extras line is a line whose `parent_line_id` names its dish. This one reads as unsent while
    // its dish is sent, so read on its own it would be held.
    await inTx(v, (tx) =>
      tx.insert(workingOrderLines).values({
        ...burger!,
        id: randomUUID(),
        lineNo: 2,
        parentLineId: burger!.id,
        sentAt: null,
      }),
    );

    await move(originalParty.tabId, { tableId: targetTable });

    const groups = await groupsOf(receivingParty.partyId);
    expect(groups.map((g) => g.state)).toEqual(["fired"]);
    expect((await lineRows(originalParty.tabId)).map((l) => l.groupId)).toEqual([
      groups[0]!.id,
      groups[0]!.id,
    ]);
  });

  it("makes no group, records nothing and leaves the revision for a bill whose every dish already has one", async () => {
    const originalParty = await seat(v, await v.table("Nothing 1"));
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const groupsBefore = await groupsOf(originalParty.partyId);
    const linesBefore = await lineRows(originalParty.tabId);
    const revision = await revisionOf(v, originalParty.partyId);
    const [{ events }] = v.db.all<{ events: number }>(
      sql`select count(*) as events from order_group_events where party_id = ${originalParty.partyId}`,
    );

    const made = await inTx(v, (tx: Transaction) =>
      groupArrivingDishes(
        tx,
        v.cfg,
        originalParty.partyId,
        originalParty.tabId,
        OPERATOR,
        new Map(),
      ),
    );

    expect(made).toEqual({ fired: null, held: [] });
    expect(await groupsOf(originalParty.partyId)).toEqual(groupsBefore);
    expect(await lineRows(originalParty.tabId)).toEqual(linesBefore);
    expect(await revisionOf(v, originalParty.partyId)).toBe(revision);
    expect(
      v.db.all<{ events: number }>(
        sql`select count(*) as events from order_group_events where party_id = ${originalParty.partyId}`,
      ),
    ).toEqual([{ events }]);
  });

  it("gives a bill leaving for the counter no group", async () => {
    const originalParty = await coursedBill("Bar 1");
    await orderForParty(v, originalParty.partyId, ["Water"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [1]);

    await move(b2, { counter: { zoneId: null } });

    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([null]);
  });
});

describe("an arriving held group's advance HOLD ticket", () => {
  const TIME = expect.stringMatching(/^\d\d:\d\d$/);
  let printerId: string | undefined;

  async function defaultStation() {
    const [station] = await inTx(v, (tx) =>
      tx
        .select({ id: kitchenStations.id, name: kitchenStations.name })
        .from(kitchenStations)
        .where(and(eq(kitchenStations.isDefault, true))),
    );
    return station!;
  }

  /** What a ticket for `billId` at table `label` prints under its mark: station, table, bill, time. */
  async function head(label: string, billId: string): Promise<unknown[]> {
    return [
      (await defaultStation()).name,
      label,
      String((await billRow(v, billId)).orderNumber),
      TIME,
    ];
  }

  /** The default station's printer, attached on first use. */
  async function kitchenPrinter(): Promise<string> {
    if (printerId === undefined) {
      const station = await defaultStation();
      printerId = await inTx(v, async (tx) => {
        const { id } = await createPrinter(tx, {
          name: "Kitchen printer",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, {
          stationId: station.id,
          printerId: id,
        });
        return id;
      });
    }
    return printerId;
  }

  /** Every job the kitchen printer holds, oldest first: its kind and its printed lines. */
  async function jobs() {
    const printer = await kitchenPrinter();
    const rows = await inTx(v, (tx) =>
      tx
        .select({ kind: printJobs.kind, payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printer))
        .orderBy(sql`rowid`),
    );
    return rows.map((row) => ({
      kind: row.kind,
      lines: printedLines(row.payload).filter((text) => text !== ""),
    }));
  }

  const printHeldWork = (on: boolean) =>
    inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: on }));

  async function heldGroupOf(partyId: string) {
    const [group] = await inTx(v, (tx) =>
      tx
        .select({ id: orderGroups.id, holdPrintedAt: orderGroups.holdPrintedAt })
        .from(orderGroups)
        .where(and(eq(orderGroups.partyId, partyId), eq(orderGroups.state, "held"))),
    );
    return group!;
  }

  afterEach(() => printHeldWork(false));

  it("with Print held groups in advance on, a moved bill's waiting dish prints a HOLD ticket at the move and a FIRE slip when its group is fired", async () => {
    await printHeldWork(true);
    const originalParty = await coursedBill("Notice 1");
    const targetTable = await v.table("Notice 2");
    const receivingParty = await seat(v, targetTable);
    const before = (await jobs()).length;

    await move(originalParty.tabId, { tableId: targetTable });

    const held = await heldGroupOf(receivingParty.partyId);
    const header = await head("Notice 2", originalParty.tabId);
    const atMove = (await jobs()).slice(before);
    expect(
      atMove.filter((job) => job.lines[0] === `*** ${kitchenTicketWords("es").hold} ***`),
    ).toEqual([
      {
        kind: "document",
        lines: [
          `*** ${kitchenTicketWords("es").hold} ***`,
          ...header,
          `${kitchenTicketWords("es").group} 2 · DESSERTS`,
          "1 x FLAN",
        ],
      },
    ]);
    expect(held.holdPrintedAt).not.toBeNull();

    const fired = (await jobs()).length;
    const fire = await command(receivingParty.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, receivingParty.partyId, held.id, fire));

    expect((await jobs()).slice(fired)).toEqual([
      {
        kind: "document",
        lines: [
          `*** ${kitchenTicketWords("es").fire} ***`,
          ...header,
          `${kitchenTicketWords("es").group} 2 · DESSERTS`,
          "1 x FLAN",
        ],
      },
    ]);
  });

  it("names on the HOLD ticket the moved bill itself, kept apart from the destination's bill", async () => {
    await printHeldWork(true);
    const originalParty = await coursedBill("Notice 7");
    const targetTable = await v.table("Notice 8");
    const receivingParty = await seat(v, targetTable);
    const before = (await jobs()).length;

    const result = await move(originalParty.tabId, { tableId: targetTable });

    expect(result).toEqual({ partyId: receivingParty.partyId, billId: originalParty.tabId });
    const holds = (await jobs())
      .slice(before)
      .filter((job) => job.lines[0] === `*** ${kitchenTicketWords("es").hold} ***`);
    expect(holds).toEqual([
      {
        kind: "document",
        lines: [
          `*** ${kitchenTicketWords("es").hold} ***`,
          ...(await head("Notice 8", originalParty.tabId)),
          `${kitchenTicketWords("es").group} 2 · DESSERTS`,
          "1 x FLAN",
        ],
      },
    ]);
  });

  it("with Print held groups in advance off, a moved bill's waiting dish prints nothing at the move and an ordinary ticket when its group is fired", async () => {
    const originalParty = await coursedBill("Notice 3");
    const targetTable = await v.table("Notice 4");
    const receivingParty = await seat(v, targetTable);
    const before = (await jobs()).length;

    await move(originalParty.tabId, { tableId: targetTable });

    const held = await heldGroupOf(receivingParty.partyId);
    expect(
      (await jobs()).slice(before).filter((job) => job.lines.some((text) => text.includes("FLAN"))),
    ).toEqual([]);
    expect(held.holdPrintedAt).toBeNull();

    const fired = (await jobs()).length;
    const fire = await command(receivingParty.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, receivingParty.partyId, held.id, fire));

    const atFire = (await jobs()).slice(fired);
    expect(atFire).toEqual([{ kind: "document", lines: expect.arrayContaining(["1 x FLAN"]) }]);
    expect(atFire[0]!.lines[0]).not.toMatch(/\*\*\*/);
  });

  it("with Print held groups in advance on, a waiting dish on the bill Split a table takes prints a HOLD ticket", async () => {
    await printHeldWork(true);
    const [table4, table5] = [await v.table("Notice 5"), await v.table("Notice 6")];
    const originalParty = await seat(v, table4);
    await nextMillisecond();
    const joining = { ...(await commandFor(v, originalParty.partyId)) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, originalParty.partyId, table5, joining));
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, b2, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: starterCourseId },
        { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
      ]),
    );
    const before = (await jobs()).length;

    const splitting = await commandFor(v, originalParty.partyId);
    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, originalParty.partyId, table5, b2, splitting),
    );

    const held = await heldGroupOf(result.partyId);
    expect(
      (await jobs())
        .slice(before)
        .filter((job) => job.lines[0] === `*** ${kitchenTicketWords("es").hold} ***`),
    ).toEqual([
      {
        kind: "document",
        lines: [
          `*** ${kitchenTicketWords("es").hold} ***`,
          ...(await head("Notice 6", b2)),
          `${kitchenTicketWords("es").group} 2 · DESSERTS`,
          "1 x FLAN",
        ],
      },
    ]);
    expect(held.holdPrintedAt).not.toBeNull();
  });
});

describe("A773 requested lifecycle: arrival", () => {
  /** Every station waits for the pass and prints held work, with one printer on every active
   *  station; each is restored afterwards, the venue being shared across cases. */
  async function everyStationWaiting(run: (jobCount: () => Promise<number>) => Promise<void>) {
    const stations = v.db.all<{ id: string; active: number }>(
      sql`select id, active from kitchen_stations`,
    );
    const stationIds = stations.map((station) => station.id);
    const active = stations.filter((station) => station.active).map((station) => station.id);
    const printerId = await inTx(v, async (tx) => {
      await setStationsWaitForPass(tx, true, stationIds);
      await setStationPrinting(tx, { printHeldWork: true });
      const { id } = await createPrinter(tx, {
        name: `P-${randomUUID().slice(0, 8)}`,
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      for (const stationId of active)
        await attachPrinterToStation(tx, {
          stationId,
          printerId: id,
        });
      return id;
    });
    const jobCount = async () =>
      (
        await inTx(v, (tx) =>
          tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, printerId)),
        )
      ).length;
    try {
      await run(jobCount);
    } finally {
      await inTx(v, async (tx) => {
        await setStationsWaitForPass(tx, false, stationIds);
        await setStationPrinting(tx, { printHeldWork: false });
        for (const stationId of active)
          await detachPrinterFromStation(tx, { stationId, printerId });
      });
    }
  }

  async function itemOf(lineId: string) {
    const [item] = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, lineId)),
    );
    return item!;
  }

  it("moves a Requested dish alone in a course held until fired into one fired group dated by its request, printing nothing", async () => {
    await everyStationWaiting(async (jobCount) => {
      const originalParty = await seat(v, await v.table("Single order 1"));
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, originalParty.tabId, [
          { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
        ]),
      );
      const [custardLine] = await lineRows(originalParty.tabId);
      const item = await itemOf(custardLine!.id);
      expect(item).toMatchObject({
        requestedAt: expect.any(String),
        firedAt: null,
        passControlled: true,
      });
      const targetTable = await v.table("Single order 2");
      const receivingParty = await seat(v, targetTable);
      await nextMillisecond();
      const jobsBefore = await jobCount();

      await move(originalParty.tabId, { tableId: targetTable });

      expect(
        (await groupsOf(receivingParty.partyId)).map((g) => ({
          state: g.state,
          firedAt: g.firedAt,
        })),
      ).toEqual([{ state: "fired", firedAt: item.requestedAt }]);
      expect(await itemOf(custardLine!.id)).toEqual(item);
      expect(await jobCount()).toBe(jobsBefore);
    });
  });

  it("lets Split a table take a Requested dish alone in a course held until fired into one fired group, printing nothing", async () => {
    const [table4, table5] = [await v.table("Split order 1"), await v.table("Split order 2")];
    const originalParty = await seat(v, table4);
    await nextMillisecond();
    const joining = await commandFor(v, originalParty.partyId);
    await inTx(v, (tx) => joinTables(tx, v.cfg, originalParty.partyId, table5, joining));
    await orderForParty(v, originalParty.partyId, ["Burger", "Red wine bottle"]);
    const b2 = await splitOff(originalParty.partyId, originalParty.tabId, [2]);
    await everyStationWaiting(async () => {
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, b2, [
          { menuItemId: v.item("Flan"), quantity: "1", courseId: dessertCourseId },
        ]),
      );
      const custardLine = (await lineRows(b2)).find(
        (line) => line.productId !== null && line.courseId === dessertCourseId,
      )!;
      const item = await itemOf(custardLine.id);
      expect(item).toMatchObject({
        requestedAt: expect.any(String),
        firedAt: null,
        passControlled: true,
      });
      const printed = async () =>
        (
          await inTx(v, (tx) =>
            tx
              .select({ payload: printJobs.payload })
              .from(printJobs)
              .orderBy(sql`rowid`),
          )
        ).map((job) => printedLines(job.payload));
      const jobsBefore = (await printed()).length;

      const splitting = await commandFor(v, originalParty.partyId);
      const result = await inTx(v, (tx) =>
        splitTable(tx, v.cfg, originalParty.partyId, table5, b2, splitting),
      );

      const groups = await groupsOf(result.partyId);
      expect(groups.map((g) => g.state)).toEqual(["fired"]);
      expect((await lineRows(b2)).find((line) => line.id === custardLine.id)!.groupId).toBe(
        groups[0]!.id,
      );
      expect(await itemOf(custardLine.id)).toEqual(item);
      const after = (await printed()).slice(jobsBefore);
      expect(after.flat().filter((text) => text.includes("FLAN"))).toEqual([]);
      expect(after.map((lines) => lines[0])).not.toContain(
        `*** ${kitchenTicketWords("es").hold} ***`,
      );
    });
  });

  it("moves a Requested dish beside an earlier released one into one fired group dated by the released dish", async () => {
    const originalParty = await coursedBill("Joined order 1");
    const [burger, custardLine] = await lineRows(originalParty.tabId);
    const burgerItem = await itemOf(burger!.id);
    expect(burgerItem.firedAt).not.toBeNull();
    await nextMillisecond();
    await everyStationWaiting(async () => {
      await inTx(v, (tx) => fireOrderLines(tx, v.cfg, originalParty.tabId, [custardLine!.id]));
      const custardItem = await itemOf(custardLine!.id);
      expect(custardItem).toMatchObject({ firedAt: null, passControlled: true });
      expect(custardItem.requestedAt! > burgerItem.firedAt!).toBe(true);
      const targetTable = await v.table("Joined order 2");
      const receivingParty = await seat(v, targetTable);

      await move(originalParty.tabId, { tableId: targetTable });

      const groups = await groupsOf(receivingParty.partyId);
      expect(groups.map((g) => ({ state: g.state, firedAt: g.firedAt }))).toEqual([
        { state: "fired", firedAt: burgerItem.firedAt },
      ]);
      expect((await lineRows(originalParty.tabId)).map((l) => l.groupId)).toEqual([
        groups[0]!.id,
        groups[0]!.id,
      ]);
    });
  });
});
