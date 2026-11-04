import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  orderGroupEvents,
  orderGroupHoldStations,
  orderGroups,
  parties,
  partyTables,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { departments, kitchenNotices, setRoutingCell } from "@waitron/venue-service";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { createCourse, createStation } from "./kitchen.js";
import {
  copyHeldGroups,
  fireGroup,
  readCurrentOrders,
  readHeldCounts,
  readReleaseReminders,
  snoozeReminder,
} from "./order-groups.js";
import * as groupWrites from "./order-groups.js";
import { saveDraft } from "./order-drafts.js";
import { holderOf, insertPartyBill } from "./parties.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { VENUE_SERVICE } from "./modules.js";
import { attachPrinterToStation } from "./station-printers.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { moveBill, type MoveTarget } from "./testing/move-bill-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import {
  readChangesAfterSending,
  setChangesAfterSending,
} from "./testing/changes-after-sending.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setReleaseReminderInEveryDepartment } from "./testing/release-reminder.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  orderForParty,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

const MOVER = "cccccccc-0000-4000-8000-000000000002";

let v: PartyVenue;
let desserts: string;

// `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    desserts = await inTx(
      v,
      async (tx) => (await createCourse(tx, { name: "Desserts", displayOrder: 1 })).id,
    );
  },
});

let tableNumber = 0;

type Release = "fire" | "hold";

/** A seated party whose first bill holds `groups`, each placed as one group, in order. */
async function seatWith(groups: { names: string[]; release: Release; courseId?: string | null }[]) {
  const seated = await seat(v, await v.table(`Copy ${++tableNumber}`));
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, seated.partyId, {
      groups: groups.map((group) => ({
        release: group.release,
        lines: group.names.map((name) => ({
          menuItemId: v.item(name),
          quantity: "1",
          courseId: group.courseId === undefined ? desserts : group.courseId,
        })),
      })),
      operatorId: OPERATOR,
      billId: seated.tabId,
    }),
  );
  return { partyId: seated.partyId, billId: seated.tabId };
}

/** A second party, seated, with one fired Agua so its groups do not start at 1. */
async function otherParty() {
  const seated = await seat(v, await v.table(`Copy ${++tableNumber}`));
  await orderForParty(v, seated.partyId, ["Agua"]);
  return seated.partyId;
}

function linesOf(billId: string) {
  return v.db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      parentLineId: workingOrderLines.parentLineId,
      groupId: workingOrderLines.groupId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function lineOf(billId: string, name: string) {
  return (await linesOf(billId)).find((line) => line.name === name && line.parentLineId === null)!;
}

function groupRow(id: string) {
  return v.db
    .select()
    .from(orderGroups)
    .where(eq(orderGroups.id, id))
    .then((rows) => rows[0]!);
}

function groupsOf(partyId: string) {
  return v.db
    .select()
    .from(orderGroups)
    .where(eq(orderGroups.partyId, partyId))
    .orderBy(asc(orderGroups.position));
}

function holdStationsOf(groupId: string) {
  return v.db
    .select({ stationId: orderGroupHoldStations.stationId })
    .from(orderGroupHoldStations)
    .where(eq(orderGroupHoldStations.groupId, groupId))
    .then((rows) => rows.map((row) => row.stationId).sort());
}

function eventsOf(groupId: string) {
  return v.db
    .select()
    .from(orderGroupEvents)
    .where(eq(orderGroupEvents.groupId, groupId))
    .orderBy(sql`rowid`);
}

function ticketsOf(billIds: string[]) {
  return v.db
    .select()
    .from(ticketItems)
    .where(inArray(ticketItems.workingOrderId, billIds))
    .orderBy(asc(ticketItems.id));
}

/** A new bill of the party, holding `lineIds` moved from `billId` with 4a's Move dishes. */
async function moveToNewBill(partyId: string, billId: string, lineIds: string[]) {
  const bill2 = await inTx(v, (tx) => insertPartyBill(tx, v.cfg, partyId));
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) => moveDishes(tx, v.cfg, billId, bill2, lineIds, { ...command, partyId }));
  return bill2;
}

/** An extras line for the dish, as `party-arriving-dishes.test.ts` makes one. */
async function addExtra(billId: string, dishId: string): Promise<string> {
  const lines = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const dish = lines.find((line) => line.id === dishId)!;
  const id = randomUUID();
  await inTx(v, (tx) =>
    tx.insert(workingOrderLines).values({
      ...dish,
      id,
      lineNo: Math.max(...lines.map((line) => line.lineNo)) + 1,
      parentLineId: dish.id,
    }),
  );
  return id;
}

/** Puts the bill on `partyId` by hand, as a Move this bill or Split a table would before copying. */
function reseatBill(tx: Transaction, billId: string, partyId: string) {
  return tx.update(workingOrders).set({ partyId }).where(eq(workingOrders.id, billId));
}

async function copy(
  billId: string,
  from: string,
  to: string,
  lineIds: string[],
  attendance?: { recorder: AttendanceRecorder; at: string },
) {
  return inTx(v, async (tx) => {
    await reseatBill(tx, billId, to);
    return copyHeldGroups(tx, from, to, lineIds, MOVER, attendance);
  });
}

/** A station with its own printer that takes each of `dishes`. */
async function stationWithPrinter(name: string, dishes: string[]): Promise<string> {
  return inTx(v, async (tx) => {
    const station = await createStation(tx, { name });
    const { id } = await createPrinter(tx, {
      name: `${name} printer`,
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await attachPrinterToStation(tx, { stationId: station.id, printerId: id });
    for (const dish of dishes)
      await setRoutingCell(
        tx,
        { row: { kind: "product", productId: v.productId(dish) }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    return station.id;
  });
}

function kitchenItemOf(lineId: string) {
  return v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId))
    .then((rows) => rows[0]!);
}

const adminId = () =>
  v.db.all<{ id: string }>(sql`select id from persons where role = 'admin'`)[0]!.id;

describe("A803 waiting copy: copyHeldGroups", () => {
  it("A803 waiting copy: copyHeldGroups copies a held group shared by a leaving and a staying bill, moving only the leaving dish and its extras", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan", "Tarta"], release: "hold" },
    ]);
    const flan = await lineOf(a.billId, "Flan");
    const g = flan.groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const tarta = await lineOf(bill2, "Tarta");
    const extra = await addExtra(bill2, tarta.id);
    const b = await otherParty();
    const [bFired] = await groupsOf(b);
    expect((await groupsOf(a.partyId)).map((group) => group.displayNumber)).toEqual([1, 2]);
    expect(bFired!.displayNumber).toBe(1);
    const source = await groupRow(g);
    const ticketsBefore = await ticketsOf([a.billId, bill2]);

    const copies = await copy(bill2, a.partyId, b, [tarta.id]);

    const copyId = copies.get(g)!;
    expect([...copies]).toEqual([[g, copyId]]);
    expect(await groupRow(copyId)).toEqual({
      id: copyId,
      partyId: b,
      position: bFired!.position + 1,
      displayNumber: bFired!.displayNumber + 1,
      numberPartyId: b,
      state: "held",
      firedAt: null,
      firedBy: null,
      firedByDeviceId: null,
      submittedBy: source.submittedBy,
      remindAt: null,
      holdPrintedAt: source.holdPrintedAt,
      requestKind: "next_course",
      createdAt: expect.any(String),
    });
    expect((await linesOf(bill2)).map((line) => [line.id, line.groupId])).toEqual([
      [tarta.id, copyId],
      [extra, copyId],
    ]);
    expect((await lineOf(a.billId, "Flan")).groupId).toBe(g);
    expect((await groupRow(g)).state).toBe("held");
    expect(await ticketsOf([a.billId, bill2])).toEqual(ticketsBefore);
  });

  it("A803 waiting copy: copyHeldGroups keeps two held groups of one course as two copies, in the source's order", async () => {
    const a = await seatWith([
      { names: ["Tarta"], release: "hold" },
      { names: ["Flan"], release: "hold" },
    ]);
    const tarta = await lineOf(a.billId, "Tarta");
    const flan = await lineOf(a.billId, "Flan");
    const [g2, g3] = [tarta.groupId!, flan.groupId!];
    expect(g2).not.toBe(g3);
    const b = await otherParty();
    const [bFired] = await groupsOf(b);

    const copies = await copy(a.billId, a.partyId, b, [flan.id, tarta.id]);

    expect([...copies.keys()]).toEqual([g2, g3]);
    expect(
      (await groupsOf(b)).map((group) => [
        group.id,
        group.position,
        group.displayNumber,
        group.numberPartyId,
        group.state,
      ]),
    ).toEqual([
      [bFired!.id, bFired!.position, bFired!.displayNumber, b, "fired"],
      [copies.get(g2), bFired!.position + 1, bFired!.displayNumber + 1, b, "held"],
      [copies.get(g3), bFired!.position + 2, bFired!.displayNumber + 2, b, "held"],
    ]);
    expect((await linesOf(a.billId)).map((line) => [line.name, line.groupId])).toEqual([
      ["Tarta", copies.get(g2)],
      ["Flan", copies.get(g3)],
    ]);
  });

  it("A803 waiting copy: copyHeldGroups removes a source group the copy empties, with a removed event naming the mover", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const tarta = await lineOf(a.billId, "Tarta");
    const g = tarta.groupId!;
    const b = await otherParty();

    await copy(a.billId, a.partyId, b, [tarta.id]);

    expect((await groupRow(g)).state).toBe("removed");
    expect(
      (await eventsOf(g))
        .filter((event) => event.kind === "removed")
        .map((event) => [event.partyId, event.actorId]),
    ).toEqual([[a.partyId, MOVER]]);
  });

  it("A803 waiting copy: copyHeldGroups copies the recorded HOLD stations that hold a moved dish, and no others", async () => {
    const grill = await stationWithPrinter("Grill", ["Tarta"]);
    const pastry = await stationWithPrinter("Pastry", ["Flan"]);
    await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }, [grill, pastry]));
    try {
      const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
      const g = (await lineOf(a.billId, "Flan")).groupId!;
      expect(await holdStationsOf(g)).toEqual([grill, pastry].sort());
      const source = await groupRow(g);
      expect(source.holdPrintedAt).not.toBeNull();
      const bill2 = await moveToNewBill(a.partyId, a.billId, [
        (await lineOf(a.billId, "Tarta")).id,
      ]);
      const b = await otherParty();

      const copies = await copy(bill2, a.partyId, b, [(await lineOf(bill2, "Tarta")).id]);

      const copyId = copies.get(g)!;
      expect(await holdStationsOf(copyId)).toEqual([grill]);
      expect((await groupRow(copyId)).holdPrintedAt).toBe(source.holdPrintedAt);
      expect(await holdStationsOf(g)).toEqual([grill, pastry].sort());
    } finally {
      await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: false }, [grill, pastry]));
    }
  });

  it("A803 waiting copy: copyHeldGroups gives the copy no HOLD station that never got HOLD paper", async () => {
    const grill = await stationWithPrinter("Grill without HOLD paper", ["Tarta"]);
    const pastry = await stationWithPrinter("Pastry with HOLD paper", ["Flan"]);
    await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }, [pastry]));
    try {
      const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
      const g = (await lineOf(a.billId, "Flan")).groupId!;
      expect(await holdStationsOf(g)).toEqual([pastry]);
      const bill2 = await moveToNewBill(a.partyId, a.billId, [
        (await lineOf(a.billId, "Tarta")).id,
      ]);
      const tarta = await lineOf(bill2, "Tarta");
      expect(await kitchenItemOf(tarta.id)).toMatchObject({ stationId: grill, firedAt: null });
      const b = await otherParty();

      const copies = await copy(bill2, a.partyId, b, [tarta.id]);

      expect(await holdStationsOf(copies.get(g)!)).toEqual([]);
    } finally {
      await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: false }, [pastry]));
    }
  });

  it("A803 waiting copy: copyHeldGroups records attendance for each event it writes when given a recorder", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Tarta"], release: "hold" },
    ]);
    const g = (await lineOf(a.billId, "Tarta")).groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const b = await otherParty();
    const before = (await eventsOf(g)).length;
    const facts: Parameters<AttendanceRecorder>[1][] = [];
    const at = "2026-11-04T12:00:00.000Z";
    const recorder: AttendanceRecorder = async (_tx, fact) => {
      facts.push(fact);
    };

    const copies = await copy(bill2, a.partyId, b, [(await lineOf(bill2, "Tarta")).id], {
      recorder,
      at,
    });

    const sourceEvents = (await eventsOf(g)).slice(before);
    const copyEvents = await eventsOf(copies.get(g)!);
    expect(sourceEvents.map((event) => event.kind)).toEqual(["lines_moved", "removed"]);
    expect(copyEvents.map((event) => event.kind)).toEqual(["lines_moved"]);
    expect(facts).toEqual(
      [sourceEvents[0]!, copyEvents[0]!, sourceEvents[1]!].map((event) => ({
        source: "draft",
        key: `group:${event.id}`,
        personId: MOVER,
        kind: "order",
        at,
        offsetMinutes: 0,
        outcome: "qualified",
      })),
    );
  });

  it("A803 waiting copy: copyHeldGroups writes one lines_moved event on each side, naming the mover", async () => {
    const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
    const g = (await lineOf(a.billId, "Flan")).groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const tarta = await lineOf(bill2, "Tarta");
    const b = await otherParty();
    const before = (await eventsOf(g)).length;

    const copies = await copy(bill2, a.partyId, b, [tarta.id]);

    const copyId = copies.get(g)!;
    expect((await eventsOf(g)).slice(before)).toEqual([
      {
        id: expect.any(String),
        partyId: a.partyId,
        groupId: g,
        kind: "lines_moved",
        actorId: MOVER,
        actorDeviceId: null,
        detail: { lineIds: [tarta.id], to: copyId },
        createdAt: expect.any(String),
      },
    ]);
    expect(await eventsOf(copyId)).toEqual([
      {
        id: expect.any(String),
        partyId: b,
        groupId: copyId,
        kind: "lines_moved",
        actorId: MOVER,
        actorDeviceId: null,
        detail: { lineIds: [tarta.id], from: g, arrived: true },
        createdAt: expect.any(String),
      },
    ]);
  });

  it("A803 waiting copy: copyHeldGroups ignores a recalled dish, a dish of a fired group, an extras line and a dish of another party's held group it is given", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Tarta", "Paella"], release: "hold" },
    ]);
    const burger = await lineOf(a.billId, "Burger");
    const tarta = await lineOf(a.billId, "Tarta");
    const paella = await lineOf(a.billId, "Paella");
    const extra = await addExtra(a.billId, tarta.id);
    const settings = await inTx(v, (tx) => readChangesAfterSending(tx));
    const recallCommand = await commandFor(v, a.partyId);
    try {
      await inTx(v, async (tx) => {
        await setChangesAfterSending(tx, "held-or-waiting");
        return recallToDraft(tx, v.cfg, a.partyId, paella.id, {
          ...recallCommand,
          operatorId: adminId(),
          expectedEdit: await readBillEditState(tx, a.billId),
          submissionId: randomUUID(),
        });
      });
    } finally {
      await inTx(v, async (tx) => {
        for (const [stationId, value] of settings)
          await setChangesAfterSending(tx, value, [stationId]);
      });
    }
    const c = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const cTarta = await lineOf(c.billId, "Tarta");
    const b = await otherParty();
    const linesBefore = await linesOf(a.billId);
    const bGroupsBefore = await groupsOf(b);
    const cLinesBefore = await linesOf(c.billId);
    const cGroupsBefore = await groupsOf(c.partyId);

    const copies = await copy(a.billId, a.partyId, b, [burger.id, paella.id, extra, cTarta.id]);

    expect([...copies]).toEqual([]);
    expect(await linesOf(a.billId)).toEqual(linesBefore);
    expect(await groupsOf(b)).toEqual(bGroupsBefore);
    expect(await linesOf(c.billId)).toEqual(cLinesBefore);
    expect(await groupsOf(c.partyId)).toEqual(cGroupsBefore);
  });

  it("A803 waiting copy: copyHeldGroups leaves a snooze behind", async () => {
    const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
    const g = (await lineOf(a.billId, "Flan")).groupId!;
    const snoozeCommand = await commandFor(v, a.partyId);
    await inTx(v, (tx) =>
      snoozeReminder(tx, v.cfg, a.partyId, g, 10, { ...snoozeCommand, submissionId: randomUUID() }),
    );
    const snoozed = (await groupRow(g)).remindAt;
    expect(snoozed).not.toBeNull();
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const b = await otherParty();

    const copies = await copy(bill2, a.partyId, b, [(await lineOf(bill2, "Tarta")).id]);

    expect((await groupRow(copies.get(g)!)).remindAt).toBeNull();
    expect((await groupRow(g)).remindAt).toBe(snoozed);
  });
});

/** Recalls the dish into its bill's open draft with the real `recallToDraft`; returns the draft. */
async function recall(partyId: string, billId: string, lineId: string): Promise<string> {
  const settings = await inTx(v, (tx) => readChangesAfterSending(tx));
  const command = await commandFor(v, partyId);
  try {
    const recalled = await inTx(v, async (tx) => {
      await setChangesAfterSending(tx, "held-or-waiting");
      return recallToDraft(tx, v.cfg, partyId, lineId, {
        ...command,
        operatorId: adminId(),
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
      });
    });
    return recalled.draft.id;
  } finally {
    await inTx(v, async (tx) => {
      for (const [stationId, value] of settings)
        await setChangesAfterSending(tx, value, [stationId]);
    });
  }
}

/** An open draft on the bill, made by hand. */
async function openDraft(partyId: string, billId: string): Promise<string> {
  const [draft] = await inTx(v, (tx) =>
    tx
      .insert(orderDrafts)
      .values({ partyId, billId, ownerId: OPERATOR })
      .returning({ id: orderDrafts.id }),
  );
  return draft!.id;
}

/** A fresh Agua in the draft, placed by `place`. */
async function draftLine(
  draftId: string,
  position: number,
  place: { slot: number; joinGroupId?: string; afterGroupId?: string },
): Promise<string> {
  const [line] = await inTx(v, (tx) =>
    tx
      .insert(orderDraftLines)
      .values({
        draftId,
        position,
        menuItemId: v.item("Agua"),
        options: [],
        extras: [],
        quantity: 1000,
        slot: place.slot,
        joinGroupId: place.joinGroupId ?? null,
        afterGroupId: place.afterGroupId ?? null,
      })
      .returning({ id: orderDraftLines.id }),
  );
  return line!.id;
}

function draftLineRows(draftId: string) {
  return v.db
    .select()
    .from(orderDraftLines)
    .where(eq(orderDraftLines.draftId, draftId))
    .orderBy(asc(orderDraftLines.position));
}

function recalledRows(draftId: string) {
  return v.db
    .select()
    .from(orderDraftRecalledLines)
    .where(eq(orderDraftRecalledLines.draftId, draftId))
    .orderBy(asc(orderDraftRecalledLines.position));
}

/** Replaces `from` by `to` in the row's two group references. */
function pointedAt<T extends { joinGroupId: string | null; afterGroupId: string | null }>(
  row: T,
  from: string,
  to: string,
): T {
  return {
    ...row,
    joinGroupId: row.joinGroupId === from ? to : row.joinGroupId,
    afterGroupId: row.afterGroupId === from ? to : row.afterGroupId,
  };
}

describe("A803 waiting copy: copyHeldGroups and drafts", () => {
  it("A803 waiting copy: copyHeldGroups points the moving bill's draft at the copy", async () => {
    const a = await seatWith([{ names: ["Tarta", "Flan", "Paella"], release: "hold" }]);
    const tarta = await lineOf(a.billId, "Tarta");
    const flan = await lineOf(a.billId, "Flan");
    const paella = await lineOf(a.billId, "Paella");
    const g = tarta.groupId!;
    const draftId = await recall(a.partyId, a.billId, flan.id);
    const [recalledFlan] = await recalledRows(draftId);
    expect(recalledFlan).toMatchObject({ sourceLineId: flan.id, joinGroupId: g, slot: 0 });
    const next =
      Math.max(
        recalledFlan!.position,
        ...(await draftLineRows(draftId)).map((row) => row.position),
      ) + 1;
    await draftLine(draftId, next, { slot: 0, joinGroupId: g });
    await draftLine(draftId, next + 1, { slot: 2, afterGroupId: g });
    await inTx(v, (tx) =>
      tx.insert(orderDraftRecalledLines).values({
        draftId,
        sourceLineId: paella.id,
        position: next + 2,
        slot: 2,
        afterGroupId: g,
      }),
    );
    const linesBefore = await draftLineRows(draftId);
    const recalledBefore = await recalledRows(draftId);
    expect(
      linesBefore.filter((row) => row.joinGroupId === g || row.afterGroupId === g),
    ).toHaveLength(2);
    expect(
      recalledBefore.filter((row) => row.joinGroupId === g || row.afterGroupId === g),
    ).toHaveLength(2);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [tarta.id]);

    const copyId = copies.get(g)!;
    expect((await groupRow(g)).state).toBe("held");
    expect(await draftLineRows(draftId)).toEqual(
      linesBefore.map((row) => pointedAt(row, g, copyId)),
    );
    expect(await recalledRows(draftId)).toEqual(
      recalledBefore.map((row) => pointedAt(row, g, copyId)),
    );
  });

  it("A803 waiting copy: copyHeldGroups leaves a staying bill's draft on the source group", async () => {
    const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
    const g = (await lineOf(a.billId, "Flan")).groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const staying = await openDraft(a.partyId, a.billId);
    await draftLine(staying, 0, { slot: 0, joinGroupId: g });
    await draftLine(staying, 1, { slot: 1, afterGroupId: g });
    const before = await draftLineRows(staying);
    const b = await otherParty();

    const copies = await copy(bill2, a.partyId, b, [(await lineOf(bill2, "Tarta")).id]);

    expect(copies.has(g)).toBe(true);
    expect(await draftLineRows(staying)).toEqual(before);
  });

  it("A803 waiting copy: copyHeldGroups leaves a reference to a group that got no copy as it was", async () => {
    const a = await seatWith([
      { names: ["Tarta"], release: "hold" },
      { names: ["Flan"], release: "hold" },
    ]);
    const tarta = await lineOf(a.billId, "Tarta");
    const g3 = (await lineOf(a.billId, "Flan")).groupId!;
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 0, { slot: 0, joinGroupId: g3 });
    await draftLine(draftId, 1, { slot: 1, afterGroupId: g3 });
    const before = await draftLineRows(draftId);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [tarta.id]);

    expect([...copies.keys()]).toEqual([tarta.groupId]);
    expect(await draftLineRows(draftId)).toEqual(before);
  });

  it("A803 waiting copy: copyHeldGroups points each draft reference at its own group's copy", async () => {
    const a = await seatWith([
      { names: ["Tarta"], release: "hold" },
      { names: ["Flan"], release: "hold" },
    ]);
    const tarta = await lineOf(a.billId, "Tarta");
    const flan = await lineOf(a.billId, "Flan");
    const [g1, g2] = [tarta.groupId!, flan.groupId!];
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 0, { slot: 0, joinGroupId: g1 });
    await draftLine(draftId, 1, { slot: 0, joinGroupId: g2 });
    await draftLine(draftId, 2, { slot: 1, afterGroupId: g1 });
    await draftLine(draftId, 3, { slot: 2, afterGroupId: g2 });
    const before = await draftLineRows(draftId);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [tarta.id, flan.id]);

    const [copy1, copy2] = [copies.get(g1)!, copies.get(g2)!];
    expect(copy1).not.toBe(copy2);
    expect(await draftLineRows(draftId)).toEqual(
      before.map((row) => pointedAt(pointedAt(row, g1, copy1), g2, copy2)),
    );
  });

  it("A803 waiting copy: copyHeldGroups leaves a discarded draft of the moving bill as it was", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const tarta = await lineOf(a.billId, "Tarta");
    const g = tarta.groupId!;
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 0, { slot: 0, joinGroupId: g });
    await inTx(v, (tx) =>
      tx.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, draftId)),
    );
    const before = await draftLineRows(draftId);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [tarta.id]);

    expect(copies.has(g)).toBe(true);
    expect(await draftLineRows(draftId)).toEqual(before);
  });

  it("A803 waiting copy: copyHeldGroups: a staying bill's draft naming a source group the copy removed is refused at its next save, as for any emptied held group", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const g = (await lineOf(a.billId, "Tarta")).groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const save = (lines: unknown[]) =>
      inTx(v, async (tx) => {
        const edit = await readBillEditState(tx, a.billId);
        return saveDraft(tx, v.cfg, a.partyId, OPERATOR, {
          expectedEdit: edit,
          billId: a.billId,
          draftId: edit.draftId,
          revision: edit.draftRevision ?? 0,
          lines,
        });
      });
    const saved = await save([
      { menuItemId: v.item("Agua"), quantity: "1", slot: 0, joinGroupId: g, courseId: null },
    ]);
    const [line] = saved.draft!.lines;
    expect(line).toMatchObject({ joinGroupId: g });
    const b = await otherParty();

    await copy(bill2, a.partyId, b, [(await lineOf(bill2, "Tarta")).id]);

    expect((await groupRow(g)).state).toBe("removed");
    await expect(
      save([
        {
          id: line!.id,
          menuItemId: v.item("Agua"),
          quantity: "1",
          slot: 0,
          joinGroupId: g,
          courseId: null,
        },
      ]),
    ).rejects.toMatchObject({ code: "group.not_held", params: { groupId: g } });
  });
});

/** Moves the whole bill with the real `moveBill`, reading both parties' revisions first. */
async function moveWholeBill(billId: string, partyId: string, to: MoveTarget) {
  const target = "tableId" in to ? await inTx(v, (tx) => holderOf(tx, to.tableId)) : null;
  const options = {
    operatorId: OPERATOR,
    partyId,
    expectedPartyRevision: await revisionOf(v, partyId),
    otherPartyId: target,
    ...(target === null ? {} : { expectedOtherPartyRevision: await revisionOf(v, target) }),
  };
  return inTx(v, (tx) => moveBill(tx, v.cfg, billId, to, options));
}

/** Every row of the tables a move writes, for these parties and bills, in a stable order. */
async function rowsOf(partyIds: string[], billIds: string[]) {
  const groups = await v.db
    .select()
    .from(orderGroups)
    .where(inArray(orderGroups.partyId, partyIds))
    .orderBy(asc(orderGroups.id));
  const groupIds = groups.map((group) => group.id);
  const drafts = await v.db
    .select()
    .from(orderDrafts)
    .where(inArray(orderDrafts.billId, billIds))
    .orderBy(asc(orderDrafts.id));
  const draftIds = drafts.map((draft) => draft.id);
  return {
    groups,
    holdStations: await v.db
      .select()
      .from(orderGroupHoldStations)
      .where(inArray(orderGroupHoldStations.groupId, groupIds))
      .orderBy(asc(orderGroupHoldStations.groupId), asc(orderGroupHoldStations.stationId)),
    events: await v.db
      .select()
      .from(orderGroupEvents)
      .where(inArray(orderGroupEvents.partyId, partyIds))
      .orderBy(asc(orderGroupEvents.id)),
    lines: await v.db
      .select()
      .from(workingOrderLines)
      .where(inArray(workingOrderLines.workingOrderId, billIds))
      .orderBy(asc(workingOrderLines.id)),
    tickets: await ticketsOf(billIds),
    notices: await v.db
      .select()
      .from(kitchenNotices)
      .where(inArray(kitchenNotices.workingOrderId, billIds))
      .orderBy(asc(kitchenNotices.id)),
    printJobs: await v.db.select().from(printJobs).orderBy(asc(printJobs.id)),
    drafts,
    draftLines: await v.db
      .select()
      .from(orderDraftLines)
      .where(inArray(orderDraftLines.draftId, draftIds))
      .orderBy(asc(orderDraftLines.id)),
    recalledLines: await v.db
      .select()
      .from(orderDraftRecalledLines)
      .where(inArray(orderDraftRecalledLines.draftId, draftIds))
      .orderBy(asc(orderDraftRecalledLines.id)),
    parties: await v.db
      .select()
      .from(parties)
      .where(inArray(parties.id, partyIds))
      .orderBy(asc(parties.id)),
    partyTables: await v.db
      .select()
      .from(partyTables)
      .where(inArray(partyTables.partyId, partyIds))
      .orderBy(asc(partyTables.partyId), asc(partyTables.tableId)),
    bills: await v.db
      .select()
      .from(workingOrders)
      .where(inArray(workingOrders.id, billIds))
      .orderBy(asc(workingOrders.id)),
  };
}

describe("A803 waiting copy: Move this bill", () => {
  it("A803 waiting copy: Move this bill to a free table takes a held dish, held, in its own copy of the group", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const source = (await lineOf(a.billId, "Flan")).groupId!;
    const tableId = await v.table(`Copy ${++tableNumber}`);

    const result = await moveWholeBill(a.billId, a.partyId, { tableId });

    expect(result.billId).toBe(a.billId);
    expect(result.partyId).not.toBeNull();
    expect(result.partyId).not.toBe(a.partyId);
    const flan = await lineOf(a.billId, "Flan");
    expect(flan.groupId).not.toBe(source);
    expect(await groupRow(flan.groupId!)).toMatchObject({
      partyId: result.partyId,
      state: "held",
      firedAt: null,
    });
    expect(await kitchenItemOf(flan.id)).toMatchObject({ firedAt: null, requestedAt: null });
    expect((await groupRow(source)).state).toBe("removed");
  });

  it("A803 waiting copy: Move this bill to a seated table takes a held dish, held, in its own copy of the group after all of that party's groups", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const source = (await lineOf(a.billId, "Flan")).groupId!;
    const b = await seatWith([
      { names: ["Agua"], release: "fire" },
      { names: ["Tarta"], release: "hold" },
    ]);
    const before = await groupsOf(b.partyId);
    const [table] = await v.db
      .select({ tableId: partyTables.tableId })
      .from(partyTables)
      .where(eq(partyTables.partyId, b.partyId));

    const result = await moveWholeBill(a.billId, a.partyId, { tableId: table!.tableId });

    expect(result).toEqual({ partyId: b.partyId, billId: a.billId });
    const burger = await lineOf(a.billId, "Burger");
    const flan = await lineOf(a.billId, "Flan");
    const after = await groupsOf(b.partyId);
    expect(after.map((group) => [group.id, group.state])).toEqual([
      [before[0]!.id, "fired"],
      [before[1]!.id, "held"],
      [burger.groupId, "fired"],
      [flan.groupId, "held"],
    ]);
    expect(flan.groupId).not.toBe(source);
    expect(after[3]).toMatchObject({ partyId: b.partyId, state: "held", firedAt: null });
    expect(await kitchenItemOf(flan.id)).toMatchObject({ firedAt: null, requestedAt: null });
    expect((await groupRow(source)).state).toBe("removed");
  });

  it("A803 waiting copy: Move this bill to the counter still refuses a held dish, writing nothing", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const before = await rowsOf([a.partyId], [a.billId]);

    await expect(
      moveWholeBill(a.billId, a.partyId, { counter: { zoneId: v.counter.zoneId } }),
    ).rejects.toMatchObject({
      code: "group.held_leaves_party",
      params: { tabId: a.billId, lineNo: 2 },
    });

    expect(await rowsOf([a.partyId], [a.billId])).toEqual(before);
  });
});

describe("A803 waiting copy: Split a table", () => {
  it("A803 waiting copy: Split a table takes a bill holding a held dish", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const source = (await lineOf(a.billId, "Flan")).groupId!;
    const tableId = await v.table(`Copy ${++tableNumber}`);
    const joining = { operatorId: OPERATOR, expectedPartyRevision: await revisionOf(v, a.partyId) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, a.partyId, tableId, joining));
    const splitting = {
      expectedPartyRevision: await revisionOf(v, a.partyId),
      operatorId: OPERATOR,
    };

    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, a.partyId, tableId, a.billId, splitting),
    );

    expect(result.billId).toBe(a.billId);
    expect(result.partyId).not.toBe(a.partyId);
    const burger = await lineOf(a.billId, "Burger");
    const flan = await lineOf(a.billId, "Flan");
    const groups = await groupsOf(result.partyId);
    expect(groups.map((group) => [group.id, group.state])).toEqual([
      [burger.groupId, "fired"],
      [flan.groupId, "held"],
    ]);
    expect(flan.groupId).not.toBe(source);
    expect(groups[1]).toMatchObject({ partyId: result.partyId, state: "held", firedAt: null });
    expect(await kitchenItemOf(flan.id)).toMatchObject({ firedAt: null, requestedAt: null });
    expect((await groupRow(source)).state).toBe("removed");
  });
});

/** Fires the party's group with the real `fireGroup`, reading the party's revision first. */
async function fire(partyId: string, groupId: string) {
  const command = await commandFor(v, partyId);
  return inTx(v, (tx) =>
    fireGroup(tx, v.cfg, partyId, groupId, { ...command, submissionId: randomUUID() }),
  );
}

async function tableOf(partyId: string): Promise<string> {
  const [table] = await v.db
    .select({ tableId: partyTables.tableId })
    .from(partyTables)
    .where(eq(partyTables.partyId, partyId));
  return table!.tableId;
}

/** Bill 1 keeps Flan in held group G; Bill 2 holds Tarta in the same G. */
async function sharedHeldGroup(before: { names: string[]; release: Release }[] = []) {
  const a = await seatWith([...before, { names: ["Flan", "Tarta"], release: "hold" }]);
  const flan = await lineOf(a.billId, "Flan");
  const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
  return { ...a, g: flan.groupId!, flan, bill2, tarta: await lineOf(bill2, "Tarta") };
}

describe("A803 waiting copy: what the copy does afterwards", () => {
  it("A803 waiting copy: a dish held by hand on a course that does not wait by itself stays held at the new table", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold", courseId: null },
    ]);
    const source = (await lineOf(a.billId, "Flan")).groupId!;
    const [flanRow] = await v.db
      .select({ courseId: workingOrderLines.courseId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.groupId, source));
    expect(flanRow).toEqual({ courseId: null });
    const b = await otherParty();

    await moveWholeBill(a.billId, a.partyId, { tableId: await tableOf(b) });

    const burger = await lineOf(a.billId, "Burger");
    const flan = await lineOf(a.billId, "Flan");
    expect(flan.groupId).not.toBe(burger.groupId);
    expect(flan.groupId).not.toBe(source);
    expect(await groupRow(flan.groupId!)).toMatchObject({
      partyId: b,
      state: "held",
      firedAt: null,
    });
    expect(await kitchenItemOf(flan.id)).toMatchObject({ firedAt: null, requestedAt: null });
    expect((await groupRow(source)).state).toBe("removed");
  });

  it("A803 waiting copy: two held groups of one course stay two at the new table", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
      { names: ["Flan"], release: "hold" },
    ]);
    const [, g2, g3] = (await groupsOf(a.partyId)).map((group) => group.id);
    const flans = (await linesOf(a.billId)).filter((line) => line.name === "Flan");
    expect(flans.map((line) => line.groupId)).toEqual([g2, g3]);
    const tableId = await v.table(`Copy ${++tableNumber}`);

    const result = await moveWholeBill(a.billId, a.partyId, { tableId });

    const burger = await lineOf(a.billId, "Burger");
    const moved = (await linesOf(a.billId)).filter((line) => line.name === "Flan");
    const groups = await groupsOf(result.partyId!);
    expect(groups.map((group) => [group.id, group.state])).toEqual([
      [burger.groupId, "fired"],
      [moved[0]!.groupId, "held"],
      [moved[1]!.groupId, "held"],
    ]);
    expect(moved[0]!.groupId).not.toBe(moved[1]!.groupId);
    expect([(await groupRow(g2!)).state, (await groupRow(g3!)).state]).toEqual([
      "removed",
      "removed",
    ]);
  });

  it("A803 waiting copy: firing the copy sends none of the source's dishes, and firing the source sends none of the copy's", async () => {
    const a = await sharedHeldGroup();
    const b = await otherParty();
    await moveWholeBill(a.bill2, a.partyId, { tableId: await tableOf(b) });
    const copyId = (await lineOf(a.bill2, "Tarta")).groupId!;
    expect(copyId).not.toBe(a.g);
    const firedAt = async () => [
      (await kitchenItemOf(a.flan.id)).firedAt,
      (await kitchenItemOf(a.tarta.id)).firedAt,
    ];
    expect(await firedAt()).toEqual([null, null]);

    await fire(b, copyId);

    const [flanAfterCopy, tartaAfterCopy] = await firedAt();
    expect(flanAfterCopy).toBeNull();
    expect(tartaAfterCopy).not.toBeNull();
    expect((await groupRow(a.g)).state).toBe("held");

    await fire(a.partyId, a.g);

    const [flanAfterSource, tartaAfterSource] = await firedAt();
    expect(flanAfterSource).not.toBeNull();
    expect(tartaAfterSource).toBe(tartaAfterCopy);
  });

  it("A803 waiting copy: firing a copy at a free table asks for the new party's allergy answer first", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const tableId = await v.table(`Copy ${++tableNumber}`);
    const { partyId } = await moveWholeBill(a.billId, a.partyId, { tableId });
    const copyId = (await lineOf(a.billId, "Flan")).groupId!;

    await expect(fire(partyId!, copyId)).rejects.toMatchObject({ code: "allergy.unanswered" });
    expect((await groupRow(copyId)).state).toBe("held");

    const revision = await revisionOf(v, partyId!);
    await inTx(v, (tx) =>
      VENUE_SERVICE.savePartyAllergy(
        tx,
        partyId!,
        revision,
        { answer: "none", guests: [] },
        OPERATOR,
      ),
    );
    await fire(partyId!, copyId);

    expect((await groupRow(copyId)).state).toBe("fired");
    expect((await kitchenItemOf((await lineOf(a.billId, "Flan")).id)).firedAt).not.toBeNull();
  });

  it("A803 waiting copy: firing the copy at a station that waits for the pass leaves its dish Requested", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const flan = await lineOf(a.billId, "Flan");
    const { stationId } = await kitchenItemOf(flan.id);
    const b = await otherParty();
    await moveWholeBill(a.billId, a.partyId, { tableId: await tableOf(b) });
    const copyId = (await lineOf(a.billId, "Flan")).groupId!;
    await inTx(v, (tx) => setStationsWaitForPass(tx, true, [stationId]));
    try {
      await fire(b, copyId);
    } finally {
      await inTx(v, (tx) => setStationsWaitForPass(tx, false, [stationId]));
    }

    expect((await groupRow(copyId)).state).toBe("fired");
    const item = await kitchenItemOf(flan.id);
    expect(item.requestedAt).not.toBeNull();
    expect(item.firedAt).toBeNull();
  });

  it("A803 waiting copy: moving the bill again copies the copy and removes the emptied one", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const source = (await lineOf(a.billId, "Flan")).groupId!;
    const first = await moveWholeBill(a.billId, a.partyId, {
      tableId: await v.table(`Copy ${++tableNumber}`),
    });
    const firstCopy = (await lineOf(a.billId, "Flan")).groupId!;

    const second = await moveWholeBill(a.billId, first.partyId!, {
      tableId: await v.table(`Copy ${++tableNumber}`),
    });

    const flan = await lineOf(a.billId, "Flan");
    expect(second.partyId).not.toBe(first.partyId);
    expect(new Set([source, firstCopy, flan.groupId]).size).toBe(3);
    expect(await groupRow(flan.groupId!)).toMatchObject({
      partyId: second.partyId,
      state: "held",
      firedAt: null,
    });
    expect(await groupRow(firstCopy)).toMatchObject({ partyId: first.partyId, state: "removed" });
    expect((await groupRow(source)).state).toBe("removed");
    expect(await kitchenItemOf(flan.id)).toMatchObject({ firedAt: null, requestedAt: null });
  });

  it("A803 waiting copy: the new table's release reminder names the copy once the dishes ahead of it are served", async () => {
    const minutesBefore = await v.db
      .select({ id: departments.id, minutes: departments.releaseReminderMinutes })
      .from(departments);
    await inTx(v, (tx) => setReleaseReminderInEveryDepartment(tx, 10));
    try {
      const a = await seatWith([
        { names: ["Burger"], release: "fire" },
        { names: ["Tarta"], release: "hold" },
      ]);
      const g = (await lineOf(a.billId, "Tarta")).groupId!;
      const bill2 = await moveToNewBill(a.partyId, a.billId, [
        (await lineOf(a.billId, "Tarta")).id,
      ]);
      const b = await otherParty();
      const reminders = async () => {
        const current = await inTx(v, async (tx) => ({
          source: (await readCurrentOrders(tx, a.partyId)).reminder,
          copy: (await readCurrentOrders(tx, b)).reminder,
          read: await readReleaseReminders(tx, [a.partyId, b]),
        }));
        expect(current.read.get(a.partyId)).toEqual(current.source);
        expect(current.read.get(b)).toEqual(current.copy);
        return { source: current.source, copy: current.copy };
      };
      expect((await reminders()).source).toEqual({ groupId: g, dueAt: null });

      await moveWholeBill(bill2, a.partyId, { tableId: await tableOf(b) });

      const copyId = (await lineOf(bill2, "Tarta")).groupId!;
      expect(await reminders()).toEqual({ source: null, copy: { groupId: copyId, dueAt: null } });

      const servedAt = new Date().toISOString();
      const [bFired] = await groupsOf(b);
      await inTx(v, (tx) =>
        tx
          .update(workingOrderLines)
          .set({ servedQuantity: workingOrderLines.quantity, servedAt })
          .where(eq(workingOrderLines.groupId, bFired!.id)),
      );

      expect(await reminders()).toEqual({
        source: null,
        copy: {
          groupId: copyId,
          dueAt: new Date(Date.parse(servedAt) + 10 * 60_000).toISOString(),
        },
      });
    } finally {
      await inTx(v, async (tx) => {
        for (const { id, minutes } of minutesBefore)
          await tx
            .update(departments)
            .set({ releaseReminderMinutes: minutes })
            .where(eq(departments.id, id));
      });
    }
  });

  it("A803 waiting copy: each table's Current orders and held count show its own part of the group", async () => {
    const a = await sharedHeldGroup();

    const { partyId } = await moveWholeBill(a.bill2, a.partyId, {
      tableId: await v.table(`Copy ${++tableNumber}`),
    });

    const copyId = (await lineOf(a.bill2, "Tarta")).groupId!;
    const shown = await inTx(v, async (tx) => ({
      source: (await readCurrentOrders(tx, a.partyId)).groups,
      copy: (await readCurrentOrders(tx, partyId!)).groups,
      counts: await readHeldCounts(tx, [a.partyId, partyId!]),
    }));
    expect(
      shown.source.map((group) => [group.id, group.state, group.rows.map((row) => row.lineId)]),
    ).toEqual([[a.g, "held", [a.flan.id]]]);
    expect(
      shown.copy.map((group) => [group.id, group.state, group.rows.map((row) => row.lineId)]),
    ).toEqual([[copyId, "held", [a.tarta.id]]]);
    expect([...shown.counts].sort()).toEqual(
      [
        [a.partyId, 1],
        [partyId!, 1],
      ].sort(),
    );
  });
});

describe("A803 waiting copy: a move that fails", () => {
  it("A803 waiting copy: a move refused before it writes leaves every row as it was", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const stale = await revisionOf(v, a.partyId);
    const joined = await v.table(`Copy ${++tableNumber}`);
    const joining = { operatorId: OPERATOR, expectedPartyRevision: stale };
    await inTx(v, (tx) => joinTables(tx, v.cfg, a.partyId, joined, joining));
    const tableId = await v.table(`Copy ${++tableNumber}`);
    const before = await rowsOf([a.partyId], [a.billId]);

    await expect(
      inTx(v, (tx) =>
        moveBill(
          tx,
          v.cfg,
          a.billId,
          { tableId },
          {
            operatorId: OPERATOR,
            partyId: a.partyId,
            expectedPartyRevision: stale,
            otherPartyId: null,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "party.out_of_date" });

    expect(await rowsOf([a.partyId], [a.billId])).toEqual(before);
  });

  for (const path of ["Move this bill", "Split a table"] as const) {
    it(`A803 waiting copy: a failure after the copy rolls the copy back too (${path})`, async () => {
      const a = await seatWith([
        { names: ["Burger"], release: "fire" },
        { names: ["Flan"], release: "hold" },
      ]);
      const flan = await lineOf(a.billId, "Flan");
      const tableId = await v.table(`Copy ${++tableNumber}`);
      if (path === "Split a table") {
        const joining = {
          operatorId: OPERATOR,
          expectedPartyRevision: await revisionOf(v, a.partyId),
        };
        await inTx(v, (tx) => joinTables(tx, v.cfg, a.partyId, tableId, joining));
      }
      const before = await rowsOf([a.partyId], [a.billId]);
      const marker = new Error("A803 waiting copy: failure after the copy");
      const real = groupWrites.printHoldTickets;
      let copiedBeforeFailure = false;
      const failing = vi
        .spyOn(groupWrites, "printHoldTickets")
        .mockImplementation(async (tx, cfg, groupIds) => {
          await real(tx, cfg, groupIds);
          const [row] = await tx
            .select({ groupId: workingOrderLines.groupId })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.id, flan.id));
          copiedBeforeFailure = row!.groupId !== flan.groupId;
          throw marker;
        });
      const command = await commandFor(v, a.partyId);

      let outcome: unknown = "committed";
      try {
        await inTx(v, (tx) =>
          path === "Move this bill"
            ? moveBill(
                tx,
                v.cfg,
                a.billId,
                { tableId },
                { ...command, partyId: a.partyId, otherPartyId: null },
              )
            : splitTable(tx, v.cfg, a.partyId, tableId, a.billId, command),
        );
      } catch (error) {
        outcome = error;
      } finally {
        failing.mockRestore();
      }

      expect(copiedBeforeFailure).toBe(true);
      expect(await rowsOf([a.partyId], [a.billId])).toEqual(before);
      expect(outcome).toBe(marker);
    });
  }
});
