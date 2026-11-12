import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  deviceProfiles,
  lineServiceCancellations,
  orderDraftLines,
  orderDrafts,
  orderGroupEvents,
  orderGroupHoldStations,
  orderGroups,
  parties,
  partyTables,
  printJobs,
  stationPrinters,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { departments, kitchenNotices, setRoutingCell } from "@waitron/venue-service";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { createCourse, createStation } from "./kitchen.js";
import {
  copyHeldGroups,
  copyWaitingGroups,
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
import { readBillLines, readOrderRevision } from "./working-order.js";
import { VENUE_SERVICE } from "./modules.js";
import { attachPrinterToStation } from "./station-printers.js";
import { mergeBills, moveDishes, splitBill } from "./testing/bill-action-fixture.js";
import { readScopedPassBoard } from "./pass-board.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { cancelLine } from "./testing/cancel-line.js";
import { moveBill, type MoveTarget } from "./testing/move-bill-fixture.js";
import { moveSettledBillToCounter } from "./move-bill.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { joinTables, moveGuests, splitTable } from "./testing/table-action-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";
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

/** A second party, seated, with a fired water line so its groups do not start at 1. */
async function otherParty() {
  const seated = await seat(v, await v.table(`Copy ${++tableNumber}`));
  await orderForParty(v, seated.partyId, ["Water"]);
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

describe("A803 waiting copy: copyHeldGroups", () => {
  it("A803 waiting mark: the bill's lines, which the split panel reads, give a held dish its course and group and no fired time", async () => {
    const { billId } = await seatWith([
      { names: ["Flan"], release: "hold" },
      { names: ["Water"], release: "fire", courseId: null },
    ]);
    const lines = await inTx(v, (tx) => readBillLines(tx, billId));
    const flan = lines.find((line) => line.name === "Flan")!;
    expect(flan.course?.name).toBe("Desserts");
    expect(flan.groupId).not.toBeNull();
    expect(flan.firedAt).toBeNull();
    expect((await groupRow(flan.groupId!)).state).toBe("held");
    const water = lines.find((line) => line.name === "Water")!;
    expect(water.course).toBeUndefined();
    expect((await groupRow(water.groupId!)).state).toBe("fired");
  });

  describe("A803 waiting mark: the rows' own read says whether a dish waits, as the order screen's released does", () => {
    /** One dish's mark as the bill's lines give it, beside the order screen's row for that dish. */
    async function markOf(partyId: string, billId: string, name: string) {
      const line = (await inTx(v, (tx) => readBillLines(tx, billId))).find(
        (each) => each.name === name && each.parentLineNo === null,
      )!;
      const orders = await inTx(v, (tx) => readCurrentOrders(tx, partyId));
      const row = orders.groups.flatMap((group) => group.rows).find((each) => each.name === name)!;
      return {
        waits: line.waitsInHeldGroup === true,
        firedAt: line.firedAt,
        course: line.course?.name,
        released: row.released,
        kitchen: row.kitchen?.phase ?? null,
      };
    }

    /** A move here reaches an open panel: its timed bills read sees it and starts a rows read. */
    const billRevision = (billId: string) => inTx(v, (tx) => readOrderRevision(tx, billId));

    it("a dish at a station that waits for the pass stops waiting when fireGroup fires its group, with no fired time", async () => {
      const a = await seatWith([{ names: ["Flan"], release: "hold" }]);
      const flan = await lineOf(a.billId, "Flan");
      const { stationId } = await kitchenItemOf(flan.id);
      expect(await markOf(a.partyId, a.billId, "Flan")).toEqual({
        waits: true,
        firedAt: null,
        course: "Desserts",
        released: false,
        kitchen: "held",
      });

      const revision = await billRevision(a.billId);
      await inTx(v, (tx) => setStationsWaitForPass(tx, true, [stationId]));
      try {
        await fire(a.partyId, flan.groupId!);
      } finally {
        await inTx(v, (tx) => setStationsWaitForPass(tx, false, [stationId]));
      }

      expect(await billRevision(a.billId)).toBeGreaterThan(revision);
      expect(await markOf(a.partyId, a.billId, "Flan")).toEqual({
        waits: false,
        firedAt: null,
        course: "Desserts",
        released: true,
        kitchen: "requested",
      });
    });

    it("a dish needing no preparation, with no kitchen item, stops waiting when fireGroup fires its group", async () => {
      await inTx(v, (tx) =>
        setRoutingCell(
          tx,
          { row: { kind: "product", productId: v.productId("Red wine bottle") }, zoneId: null },
          { kind: "no_preparation" },
        ),
      );
      const a = await seatWith([{ names: ["Red wine bottle"], release: "hold" }]);
      const wine = await lineOf(a.billId, "Red wine bottle");
      expect(await markOf(a.partyId, a.billId, "Red wine bottle")).toEqual({
        waits: true,
        firedAt: null,
        course: "Desserts",
        released: false,
        kitchen: null,
      });

      const revision = await billRevision(a.billId);
      await fire(a.partyId, wine.groupId!);

      expect(await billRevision(a.billId)).toBeGreaterThan(revision);
      expect(await markOf(a.partyId, a.billId, "Red wine bottle")).toEqual({
        waits: false,
        firedAt: null,
        course: "Desserts",
        released: true,
        kitchen: null,
      });
    });

    it("a held dish with no course waits, and has no course to name", async () => {
      const a = await seatWith([{ names: ["Tarta"], release: "hold", courseId: null }]);
      expect(await markOf(a.partyId, a.billId, "Tarta")).toEqual({
        waits: true,
        firedAt: null,
        course: undefined,
        released: false,
        kitchen: "held",
      });
    });

    it("a dish in a fired group, and an extra of a held dish, carry no mark", async () => {
      const a = await seatWith([
        { names: ["Burger"], release: "fire" },
        { names: ["Flan"], release: "hold" },
      ]);
      const extra = await addExtra(a.billId, (await lineOf(a.billId, "Flan")).id);
      const lines = await inTx(v, (tx) => readBillLines(tx, a.billId));
      expect(lines.map((line) => [line.id === extra, line.name, line.waitsInHeldGroup])).toEqual([
        [false, "Burger", undefined],
        [false, "Flan", true],
        [true, "Flan", undefined],
      ]);
    });

    it("a dish made here is released at its send even in a held group, until an extra of it is held", async () => {
      const a = await seatWith([{ names: ["Flan"], release: "hold" }]);
      const flan = await lineOf(a.billId, "Flan");
      const item = await kitchenItemOf(flan.id);
      const made = "2026-11-05T12:00:00.000Z";
      await inTx(v, (tx) =>
        tx
          .update(ticketItems)
          .set({ madeHere: true, firedAt: made, state: "ready" })
          .where(eq(ticketItems.id, item.id)),
      );
      expect(await markOf(a.partyId, a.billId, "Flan")).toMatchObject({
        waits: false,
        released: true,
      });

      const extra = await addExtra(a.billId, flan.id);
      await inTx(v, (tx) =>
        tx.insert(ticketItems).values({
          ...item,
          id: randomUUID(),
          workingOrderLineId: extra,
        }),
      );
      expect(await markOf(a.partyId, a.billId, "Flan")).toMatchObject({
        waits: true,
        released: false,
      });
    });

    it("placing a new held group on the bill says its dish waits and moves the bill's revision", async () => {
      const a = await seatWith([{ names: ["Burger"], release: "fire" }]);
      const revision = await billRevision(a.billId);

      await inTx(v, (tx) =>
        placeGroups(tx, v.cfg, a.partyId, {
          groups: [
            {
              release: "hold",
              lines: [{ menuItemId: v.item("Tarta"), quantity: "1", courseId: desserts }],
            },
          ],
          operatorId: OPERATOR,
          billId: a.billId,
        }),
      );

      expect(await billRevision(a.billId)).toBeGreaterThan(revision);
      expect(await markOf(a.partyId, a.billId, "Tarta")).toMatchObject({
        waits: true,
        course: "Desserts",
      });
    });

    it("a dish its fired group left unreleased, as for a held extra, does not wait in a held group", async () => {
      const a = await seatWith([{ names: ["Burger"], release: "fire" }]);
      const burger = await lineOf(a.billId, "Burger");
      const extra = await addExtra(a.billId, burger.id);
      await inTx(v, async (tx) => {
        const item = await tx
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, burger.id))
          .then((rows) => rows[0]!);
        await tx.insert(ticketItems).values({
          ...item,
          id: randomUUID(),
          workingOrderLineId: extra,
          requestedAt: null,
          firedAt: null,
          state: "queued",
        });
      });
      expect(await markOf(a.partyId, a.billId, "Burger")).toMatchObject({
        waits: false,
        released: false,
      });
    });

    it("a dish wholly cancelled has nothing left to wait for; part cancelled, the rest waits", async () => {
      const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
      const cancel = (lineId: string, quantity: number) =>
        inTx(v, (tx) =>
          tx.insert(lineServiceCancellations).values({
            lineId,
            quantity,
            cancelledAt: "2026-11-05T12:00:00.000Z",
            wasStarted: false,
            actorId: OPERATOR,
          }),
        );
      await cancel((await lineOf(a.billId, "Flan")).id, 1000);
      const cake = await lineOf(a.billId, "Tarta");
      await inTx(v, (tx) =>
        tx
          .update(workingOrderLines)
          .set({ quantity: 2000 })
          .where(eq(workingOrderLines.id, cake.id)),
      );
      await cancel(cake.id, 1000);

      expect(await markOf(a.partyId, a.billId, "Flan")).toMatchObject({
        waits: false,
        released: false,
      });
      expect(await markOf(a.partyId, a.billId, "Tarta")).toMatchObject({
        waits: true,
        released: false,
      });
    });
  });

  it("A803 waiting copy: copyHeldGroups copies a held group shared by a leaving and a staying bill, moving only the leaving dish and its extras", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Flan", "Tarta"], release: "hold" },
    ]);
    const flan = await lineOf(a.billId, "Flan");
    const g = flan.groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const cake = await lineOf(bill2, "Tarta");
    const extra = await addExtra(bill2, cake.id);
    const b = await otherParty();
    const [bFired] = await groupsOf(b);
    expect((await groupsOf(a.partyId)).map((group) => group.displayNumber)).toEqual([1, 2]);
    expect(bFired!.displayNumber).toBe(1);
    const source = await groupRow(g);
    const ticketsBefore = await ticketsOf([a.billId, bill2]);

    const copies = await copy(bill2, a.partyId, b, [cake.id]);

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
      [cake.id, copyId],
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
    const cake = await lineOf(a.billId, "Tarta");
    const flan = await lineOf(a.billId, "Flan");
    const [g2, g3] = [cake.groupId!, flan.groupId!];
    expect(g2).not.toBe(g3);
    const b = await otherParty();
    const [bFired] = await groupsOf(b);

    const copies = await copy(a.billId, a.partyId, b, [flan.id, cake.id]);

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
    const cake = await lineOf(a.billId, "Tarta");
    const g = cake.groupId!;
    const b = await otherParty();

    await copy(a.billId, a.partyId, b, [cake.id]);

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
      const cake = await lineOf(bill2, "Tarta");
      expect(await kitchenItemOf(cake.id)).toMatchObject({ stationId: grill, firedAt: null });
      const b = await otherParty();

      const copies = await copy(bill2, a.partyId, b, [cake.id]);

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
    const cake = await lineOf(bill2, "Tarta");
    const b = await otherParty();
    const before = (await eventsOf(g)).length;

    const copies = await copy(bill2, a.partyId, b, [cake.id]);

    const copyId = copies.get(g)!;
    expect((await eventsOf(g)).slice(before)).toEqual([
      {
        id: expect.any(String),
        partyId: a.partyId,
        groupId: g,
        kind: "lines_moved",
        actorId: MOVER,
        actorDeviceId: null,
        detail: { lineIds: [cake.id], to: copyId },
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
        detail: { lineIds: [cake.id], from: g, arrived: true },
        createdAt: expect.any(String),
      },
    ]);
  });

  it("A803 waiting copy: copyHeldGroups ignores a dish of a fired group, an extras line and a dish of another party's held group it is given", async () => {
    const a = await seatWith([
      { names: ["Burger"], release: "fire" },
      { names: ["Tarta", "Paella"], release: "hold" },
    ]);
    const burger = await lineOf(a.billId, "Burger");
    const cake = await lineOf(a.billId, "Tarta");
    const extra = await addExtra(a.billId, cake.id);
    const c = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const otherCake = await lineOf(c.billId, "Tarta");
    const b = await otherParty();
    const linesBefore = await linesOf(a.billId);
    const bGroupsBefore = await groupsOf(b);
    const cLinesBefore = await linesOf(c.billId);
    const cGroupsBefore = await groupsOf(c.partyId);

    const copies = await copy(a.billId, a.partyId, b, [burger.id, extra, otherCake.id]);

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

describe("A1327 waiting copy: copyWaitingGroups", () => {
  const stations: string[] = [];
  let stationNumber = 0;
  afterEach(async () => {
    await inTx(v, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: false }, stations);
      await setStationsWaitForPass(tx, false, stations);
    });
    stations.length = 0;
  });

  /**
   * Held group G of Flan (Pastry), Tarta (Grill) and Paella (Fryer), fired with every station
   * waiting for the pass and only Grill and Pastry printing held work: each dish waits, Flan and
   * Tarta on HOLD paper. Tarta and Paella then move to Bill 2, keeping G.
   */
  async function waitingGroup() {
    const n = ++stationNumber;
    const grill = await stationWithPrinter(`Waiting grill ${n}`, ["Tarta"]);
    const pastry = await stationWithPrinter(`Waiting pastry ${n}`, ["Flan"]);
    const fryer = await stationWithPrinter(`Waiting fryer ${n}`, ["Paella"]);
    stations.push(grill, pastry, fryer);
    await inTx(v, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true }, [grill, pastry]);
      await setStationsWaitForPass(tx, true, [grill, pastry, fryer]);
    });
    const a = await seatWith([{ names: ["Flan", "Tarta", "Paella"], release: "hold" }]);
    const g = (await lineOf(a.billId, "Flan")).groupId!;
    expect(await holdStationsOf(g)).toEqual([grill, pastry].sort());
    await fire(a.partyId, g);
    const bill2 = await moveToNewBill(a.partyId, a.billId, [
      (await lineOf(a.billId, "Tarta")).id,
      (await lineOf(a.billId, "Paella")).id,
    ]);
    const cake = await lineOf(bill2, "Tarta");
    const rice = await lineOf(bill2, "Paella");
    for (const dish of [cake, rice])
      expect(await kitchenItemOf(dish.id)).toMatchObject({
        requestedAt: expect.any(String),
        firedAt: null,
      });
    return { ...a, g, bill2, cake, rice, grill, pastry, fryer };
  }

  async function copyWaiting(billId: string, from: string, to: string, lineIds: string[]) {
    return inTx(v, async (tx) => {
      await reseatBill(tx, billId, to);
      return copyWaitingGroups(tx, from, to, lineIds, MOVER);
    });
  }

  it("A1327 waiting copy: copyWaitingGroups makes a fired copy carrying its source's firing and HOLD time, and only the HOLD stations a moving dish waits at", async () => {
    const w = await waitingGroup();
    const extra = await addExtra(w.bill2, w.cake.id);
    const cakeItem = await kitchenItemOf(w.cake.id);
    await inTx(v, (tx) =>
      tx.insert(ticketItems).values({
        ...cakeItem,
        id: randomUUID(),
        workingOrderLineId: extra,
        stationId: w.pastry,
        requestedAt: null,
        firedAt: null,
        state: "queued",
      }),
    );
    const source = await groupRow(w.g);
    expect(source).toMatchObject({ state: "fired", firedBy: expect.any(String) });
    expect(source.holdPrintedAt).not.toBeNull();
    expect(source.requestKind).not.toBe("next_course");
    const b = await otherParty();
    const [bFired] = await groupsOf(b);
    const ticketsBefore = await ticketsOf([w.billId, w.bill2]);

    const copies = await copyWaiting(w.bill2, w.partyId, b, [w.cake.id, w.rice.id]);

    const copyId = copies.get(w.g)!;
    expect([...copies]).toEqual([[w.g, copyId]]);
    expect(await groupRow(copyId)).toEqual({
      id: copyId,
      partyId: b,
      position: bFired!.position + 1,
      displayNumber: bFired!.displayNumber + 1,
      numberPartyId: b,
      state: "fired",
      firedAt: source.firedAt,
      firedBy: source.firedBy,
      firedByDeviceId: null,
      submittedBy: source.submittedBy,
      remindAt: null,
      holdPrintedAt: source.holdPrintedAt,
      requestKind: source.requestKind,
      createdAt: source.createdAt,
    });
    expect(await holdStationsOf(copyId)).toEqual([w.grill]);
    expect(await holdStationsOf(w.g)).toEqual([w.grill, w.pastry].sort());
    expect((await linesOf(w.bill2)).map((line) => [line.id, line.groupId])).toEqual([
      [w.cake.id, copyId],
      [w.rice.id, copyId],
      [extra, copyId],
    ]);
    expect((await lineOf(w.billId, "Flan")).groupId).toBe(w.g);
    expect(await ticketsOf([w.billId, w.bill2])).toEqual(ticketsBefore);
  });

  it("A1327 waiting copy: copyWaitingGroups copies the kitchen display that fired its source", async () => {
    const w = await waitingGroup();
    const deviceId = v.cfg.origin.deviceId;
    await inTx(v, (tx) =>
      tx
        .update(orderGroups)
        .set({ firedBy: null, firedByDeviceId: deviceId })
        .where(eq(orderGroups.id, w.g)),
    );
    const b = await otherParty();

    const copies = await copyWaiting(w.bill2, w.partyId, b, [w.cake.id]);

    expect(await groupRow(copies.get(w.g)!)).toMatchObject({
      state: "fired",
      firedBy: null,
      firedByDeviceId: deviceId,
    });
  });

  it("A1327 waiting copy: copyWaitingGroups writes one lines_moved event on each side, naming the mover", async () => {
    const w = await waitingGroup();
    const b = await otherParty();
    const before = (await eventsOf(w.g)).length;

    const copies = await copyWaiting(w.bill2, w.partyId, b, [w.cake.id, w.rice.id]);

    const copyId = copies.get(w.g)!;
    expect((await eventsOf(w.g)).slice(before)).toEqual([
      {
        id: expect.any(String),
        partyId: w.partyId,
        groupId: w.g,
        kind: "lines_moved",
        actorId: MOVER,
        actorDeviceId: null,
        detail: { lineIds: [w.cake.id, w.rice.id], to: copyId },
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
        detail: { lineIds: [w.cake.id, w.rice.id], from: w.g, arrived: true },
        createdAt: expect.any(String),
      },
    ]);
  });

  it("A1327 waiting copy: copyWaitingGroups keeps a fired source group the copy empties, writing no removed event", async () => {
    const w = await waitingGroup();
    const flan = await lineOf(w.billId, "Flan");
    const command = await commandFor(v, w.partyId);
    await inTx(v, (tx) =>
      moveDishes(tx, v.cfg, w.billId, w.bill2, [flan.id], { ...command, partyId: w.partyId }),
    );
    const b = await otherParty();
    const before = (await eventsOf(w.g)).length;

    const copies = await copyWaiting(w.bill2, w.partyId, b, [flan.id, w.cake.id, w.rice.id]);

    const copyId = copies.get(w.g)!;
    expect((await linesOf(w.bill2)).map((line) => line.groupId)).toEqual([copyId, copyId, copyId]);
    expect((await groupRow(w.g)).state).toBe("fired");
    expect((await eventsOf(w.g)).slice(before).map((event) => event.kind)).toEqual(["lines_moved"]);
  });

  it("A1327 waiting copy: copyWaitingGroups ignores a dish of a held group it is given", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const cake = await lineOf(a.billId, "Tarta");
    const b = await otherParty();
    const bGroupsBefore = await groupsOf(b);

    const copies = await copyWaiting(a.billId, a.partyId, b, [cake.id]);

    expect([...copies]).toEqual([]);
    expect((await lineOf(a.billId, "Tarta")).groupId).toBe(cake.groupId);
    expect(await groupsOf(b)).toEqual(bGroupsBefore);
  });
});

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
        menuItemId: v.item("Water"),
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
    const cake = await lineOf(a.billId, "Tarta");
    const g = cake.groupId!;
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 1, { slot: 0, joinGroupId: g });
    await draftLine(draftId, 2, { slot: 2, afterGroupId: g });
    const linesBefore = await draftLineRows(draftId);
    expect(
      linesBefore.filter((row) => row.joinGroupId === g || row.afterGroupId === g),
    ).toHaveLength(2);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [cake.id]);

    const copyId = copies.get(g)!;
    expect((await groupRow(g)).state).toBe("held");
    expect(await draftLineRows(draftId)).toEqual(
      linesBefore.map((row) => pointedAt(row, g, copyId)),
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
    const cake = await lineOf(a.billId, "Tarta");
    const g3 = (await lineOf(a.billId, "Flan")).groupId!;
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 0, { slot: 0, joinGroupId: g3 });
    await draftLine(draftId, 1, { slot: 1, afterGroupId: g3 });
    const before = await draftLineRows(draftId);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [cake.id]);

    expect([...copies.keys()]).toEqual([cake.groupId]);
    expect(await draftLineRows(draftId)).toEqual(before);
  });

  it("A803 waiting copy: copyHeldGroups points each draft reference at its own group's copy", async () => {
    const a = await seatWith([
      { names: ["Tarta"], release: "hold" },
      { names: ["Flan"], release: "hold" },
    ]);
    const cake = await lineOf(a.billId, "Tarta");
    const flan = await lineOf(a.billId, "Flan");
    const [g1, g2] = [cake.groupId!, flan.groupId!];
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 0, { slot: 0, joinGroupId: g1 });
    await draftLine(draftId, 1, { slot: 0, joinGroupId: g2 });
    await draftLine(draftId, 2, { slot: 1, afterGroupId: g1 });
    await draftLine(draftId, 3, { slot: 2, afterGroupId: g2 });
    const before = await draftLineRows(draftId);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [cake.id, flan.id]);

    const [copy1, copy2] = [copies.get(g1)!, copies.get(g2)!];
    expect(copy1).not.toBe(copy2);
    expect(await draftLineRows(draftId)).toEqual(
      before.map((row) => pointedAt(pointedAt(row, g1, copy1), g2, copy2)),
    );
  });

  it("A803 waiting copy: copyHeldGroups leaves a discarded draft of the moving bill as it was", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const cake = await lineOf(a.billId, "Tarta");
    const g = cake.groupId!;
    const draftId = await openDraft(a.partyId, a.billId);
    await draftLine(draftId, 0, { slot: 0, joinGroupId: g });
    await inTx(v, (tx) =>
      tx.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, draftId)),
    );
    const before = await draftLineRows(draftId);
    const b = await otherParty();

    const copies = await copy(a.billId, a.partyId, b, [cake.id]);

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
      { menuItemId: v.item("Water"), quantity: "1", slot: 0, joinGroupId: g, courseId: null },
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
          menuItemId: v.item("Water"),
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
    const burger = await lineOf(a.billId, "Burger");
    const flan = await lineOf(a.billId, "Flan");
    expect((await groupsOf(result.partyId!)).map((group) => [group.id, group.state])).toEqual([
      [burger.groupId, "fired"],
      [flan.groupId, "held"],
    ]);
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
      { names: ["Water"], release: "fire" },
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

  it("A803 waiting copy: Split a table records attendance for the copy's event when given a recorder", async () => {
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
    const before = (await eventsOf(source)).length;
    const facts: Parameters<AttendanceRecorder>[1][] = [];
    const recorder: AttendanceRecorder = async (_tx, fact) => {
      facts.push(fact);
    };

    const result = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, a.partyId, tableId, a.billId, splitting, { recorder, clock: v.clock }),
    );

    const copyId = (await lineOf(a.billId, "Flan")).groupId!;
    expect(copyId).not.toBe(source);
    const sourceEvents = (await eventsOf(source)).slice(before);
    const copyEvents = await eventsOf(copyId);
    expect(sourceEvents.map((event) => event.kind)).toEqual(["lines_moved", "removed"]);
    expect(copyEvents.map((event) => [event.kind, event.partyId])).toEqual([
      ["lines_moved", result.partyId],
    ]);
    expect(facts.filter((fact) => fact.key === `group:${copyEvents[0]!.id}`)).toEqual([
      {
        source: "draft",
        key: `group:${copyEvents[0]!.id}`,
        personId: OPERATOR,
        kind: "order",
        at: expect.any(String),
        offsetMinutes: 0,
        outcome: "qualified",
      },
    ]);
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
  return { ...a, g: flan.groupId!, flan, bill2, cake: await lineOf(bill2, "Tarta") };
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
      (await kitchenItemOf(a.cake.id)).firedAt,
    ];
    expect(await firedAt()).toEqual([null, null]);

    await fire(b, copyId);

    const [flanAfterCopy, cakeAfterCopy] = await firedAt();
    expect(flanAfterCopy).toBeNull();
    expect(cakeAfterCopy).not.toBeNull();
    expect((await groupRow(a.g)).state).toBe("held");

    await fire(a.partyId, a.g);

    const [flanAfterSource, cakeAfterSource] = await firedAt();
    expect(flanAfterSource).not.toBeNull();
    expect(cakeAfterSource).toBe(cakeAfterCopy);
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
    ).toEqual([[copyId, "held", [a.cake.id]]]);
    expect([...shown.counts].sort()).toEqual(
      [
        [a.partyId, 1],
        [partyId!, 1],
      ].sort(),
    );
  });
});

function holderNow(tableId: string) {
  return inTx(v, (tx) => holderOf(tx, tableId));
}

describe("A803 waiting copy: a move that fails", () => {
  /** Every party's groups: `rowsOf` names its parties, and a stray row would be at a new one. */
  async function countOrderGroups() {
    return (await v.db.select({ id: orderGroups.id }).from(orderGroups)).length;
  }

  it("A803 waiting copy: a move refused for a stale revision leaves every row as it was", async () => {
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
      const groupCountBefore = await countOrderGroups();
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
      expect(await holderNow(tableId)).toBe(path === "Move this bill" ? null : a.partyId);
      expect(await countOrderGroups()).toBe(groupCountBefore);
      expect(await rowsOf([a.partyId], [a.billId])).toEqual(before);
      expect(outcome).toBe(marker);
    });
  }
});

const words = kitchenTicketWords("es");

let paperNumber = 0;
const paperStations: string[] = [];

async function printerOf(stationId: string): Promise<string> {
  const [row] = await v.db
    .select({ printerId: stationPrinters.printerId })
    .from(stationPrinters)
    .where(eq(stationPrinters.stationId, stationId));
  return row!.printerId;
}

/** Every job the printer was sent, oldest first, as its printed lines. */
async function printed(printerId: string): Promise<string[][]> {
  const jobs = await v.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId))
    .orderBy(sql`rowid`);
  return jobs.map((job) => printedLines(job.payload));
}

/** A MOVED slip's printed lines, its time matched by shape. */
function movedSlip(station: string, orderLine: string, from: string, to: string, dishes: string[]) {
  return [
    `*** ${words.moved} ***`,
    station,
    orderLine,
    `${words.fromPlace}${from}`,
    `${words.toPlace}${to}`,
    expect.stringMatching(/^\d\d:\d\d$/),
    ...dishes,
    "",
  ];
}

/**
 * Grill (Burger, Tarta) and Pastry (Flan), each with its own printer, Pastry printing held work
 * when `holdPaper` and Grill when `grillHoldPaper`. A party at Mesa 5: Bill 1 keeps a fired water line and the held Flan; Bill 2 has a fired
 * Burger and the held Tarta. Flan and Tarta share held group G, the party's third, so a copy at a
 * new party (fired group 1, copy 2) never shares G's number.
 */
async function paperTable(holdPaper: boolean, grillHoldPaper = holdPaper) {
  const n = ++paperNumber;
  const grill = await stationWithPrinter(`Paper grill ${n}`, ["Burger", "Tarta"]);
  const pastry = await stationWithPrinter(`Paper pastry ${n}`, ["Flan"]);
  paperStations.push(grill, pastry);
  await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: holdPaper }, [pastry]));
  await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: grillHoldPaper }, [grill]));
  const label = `Mesa 5 (${n})`;
  const seated = await seat(v, await v.table(label));
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, seated.partyId, {
      groups: [
        {
          release: "fire",
          lines: [{ menuItemId: v.item("Water"), quantity: "1", courseId: null }],
        },
        {
          release: "fire",
          lines: [{ menuItemId: v.item("Burger"), quantity: "1", courseId: null }],
        },
        {
          release: "hold",
          lines: ["Flan", "Tarta"].map((name) => ({
            menuItemId: v.item(name),
            quantity: "1",
            courseId: desserts,
          })),
        },
      ],
      operatorId: OPERATOR,
      billId: seated.tabId,
    }),
  );
  const flan = await lineOf(seated.tabId, "Flan");
  const bill2 = await moveToNewBill(seated.partyId, seated.tabId, [
    (await lineOf(seated.tabId, "Burger")).id,
    (await lineOf(seated.tabId, "Tarta")).id,
  ]);
  return {
    n,
    label,
    partyId: seated.partyId,
    bill1: seated.tabId,
    bill2,
    g: flan.groupId!,
    grill: { id: grill, name: `Paper grill ${n}`, printer: await printerOf(grill) },
    pastry: { id: pastry, name: `Paper pastry ${n}`, printer: await printerOf(pastry) },
  };
}

async function orderLineOf(billId: string): Promise<string> {
  const [bill] = await v.db
    .select({ orderNumber: workingOrders.orderNumber })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return `${words.order} ${bill!.orderNumber}`;
}

describe("A803 waiting copy: kitchen paper", () => {
  afterEach(() => inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: false }, paperStations)));

  /** Moves Bill 2 to `tableId` or a new free table; returns its party, copy and printer marks. */
  async function moveBill2(
    t: Awaited<ReturnType<typeof paperTable>>,
    label: string,
    tableId?: string,
  ) {
    const marks = {
      grill: (await printed(t.grill.printer)).length,
      pastry: (await printed(t.pastry.printer)).length,
    };
    const from = (await partyOfBill(t.bill2))!;
    const { partyId } = await moveWholeBill(t.bill2, from, {
      tableId: tableId ?? (await v.table(label)),
    });
    const copyId = (await lineOf(t.bill2, "Tarta")).groupId!;
    return { partyId: partyId!, copyId, marks };
  }

  async function partyOfBill(billId: string) {
    const [bill] = await v.db
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    return bill!.partyId;
  }

  function movedNotices(billIds: string[]) {
    return v.db
      .select({
        id: kitchenNotices.id,
        lineName: kitchenNotices.lineName,
        stationId: kitchenNotices.stationId,
      })
      .from(kitchenNotices)
      .where(and(inArray(kitchenNotices.workingOrderId, billIds), eq(kitchenNotices.kind, "moved")))
      .orderBy(asc(kitchenNotices.lineName));
  }

  async function answerNoAllergies(partyId: string) {
    const revision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      VENUE_SERVICE.savePartyAllergy(
        tx,
        partyId,
        revision,
        { answer: "none", guests: [] },
        OPERATOR,
      ),
    );
  }

  async function orderNumberOf(billId: string): Promise<string> {
    const [bill] = await v.db
      .select({ orderNumber: workingOrders.orderNumber })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    return String(bill!.orderNumber);
  }

  /** A FIRE ticket's printed lines, its time matched by shape. */
  function fireTicket(
    station: string,
    table: string,
    billNumber: string,
    group: number,
    dish: string,
  ) {
    return [
      `*** ${words.fire} ***`,
      station,
      table,
      billNumber,
      expect.stringMatching(/^\d\d:\d\d$/),
      `${words.group} ${group} · DESSERTS`,
      dish,
      "",
    ];
  }

  it("A803 waiting copy: the MOVED slip lists only the moved dishes, the held ones under HOLD with the copy's group", async () => {
    const t = await paperTable(true);
    const table8 = `Mesa 8 (${t.n})`;
    const noticesBefore = new Set(
      (await movedNotices([t.bill1, t.bill2])).map((notice) => notice.id),
    );

    const { copyId, marks } = await moveBill2(t, table8);

    expect((await groupRow(copyId)).displayNumber).not.toBe((await groupRow(t.g)).displayNumber);
    expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
      movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, [
        "1 x BURG",
        words.hold,
        `${words.group} 2 · DESSERTS`,
        "1 x TARTA",
      ]),
    ]);
    expect((await printed(t.pastry.printer)).slice(marks.pastry)).toEqual([]);
    expect(
      (await movedNotices([t.bill1, t.bill2])).filter((notice) => !noticesBefore.has(notice.id)),
    ).toEqual([
      { id: expect.any(String), lineName: "BURG", stationId: t.grill.id },
      { id: expect.any(String), lineName: "TARTA", stationId: t.grill.id },
    ]);
  });

  it("A803 waiting copy: the move prints no HOLD ticket and no HOLD CHANGED slip", async () => {
    const t = await paperTable(true);

    const { marks } = await moveBill2(t, `Mesa 8 (${t.n})`);

    const atMove = [
      ...(await printed(t.grill.printer)).slice(marks.grill),
      ...(await printed(t.pastry.printer)).slice(marks.pastry),
    ];
    expect(atMove.map((lines) => lines[0])).toEqual([`*** ${words.moved} ***`]);
    expect(
      atMove
        .flat()
        .filter((text) => text.includes(words.holdChanged) || text === `*** ${words.hold} ***`),
    ).toEqual([]);
  });

  it("A803 waiting copy: the copy's later FIRE lists only the moved dish, marked FIRE, and the source's only the staying one", async () => {
    const t = await paperTable(true);
    const table8 = `Mesa 8 (${t.n})`;
    const { partyId, copyId } = await moveBill2(t, table8);
    await answerNoAllergies(partyId);
    const before = {
      grill: (await printed(t.grill.printer)).length,
      pastry: (await printed(t.pastry.printer)).length,
    };

    await fire(partyId, copyId);

    expect((await printed(t.grill.printer)).slice(before.grill)).toEqual([
      fireTicket(t.grill.name, table8, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
    ]);
    expect((await printed(t.pastry.printer)).slice(before.pastry)).toEqual([]);

    await fire(t.partyId, t.g);

    expect((await printed(t.grill.printer)).slice(before.grill + 1)).toEqual([]);
    expect((await printed(t.pastry.printer)).slice(before.pastry)).toEqual([
      fireTicket(t.pastry.name, t.label, await orderNumberOf(t.bill1), 3, "1 x FLAN"),
    ]);
  });

  it("A803 waiting copy: bytes already printed never change", async () => {
    const t = await paperTable(true);
    const jobs = () =>
      v.db
        .select({ id: printJobs.id, payload: printJobs.payload })
        .from(printJobs)
        .orderBy(asc(printJobs.id));
    const before = await jobs();
    const unchanged = async () => {
      const now = new Map((await jobs()).map((job) => [job.id, job.payload]));
      for (const job of before) expect(now.get(job.id)).toEqual(job.payload);
    };

    const { partyId, copyId } = await moveBill2(t, `Mesa 8 (${t.n})`);
    await unchanged();
    await answerNoAllergies(partyId);
    await fire(partyId, copyId);
    await fire(t.partyId, t.g);

    await unchanged();
    expect((await jobs()).length).toBeGreaterThan(before.length);
  });

  it("A803 waiting copy: a held group whose HOLD ticket never printed adds nothing under HOLD", async () => {
    const t = await paperTable(false);
    expect((await groupRow(t.g)).holdPrintedAt).toBeNull();
    const table8 = `Mesa 8 (${t.n})`;

    const { partyId, copyId, marks } = await moveBill2(t, table8);

    expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
      movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, ["1 x BURG"]),
    ]);
    expect((await groupRow(copyId)).holdPrintedAt).toBeNull();
    await answerNoAllergies(partyId);
    const before = (await printed(t.grill.printer)).length;

    await fire(partyId, copyId);

    const atFire = (await printed(t.grill.printer)).slice(before);
    expect(atFire).toEqual([expect.arrayContaining(["1 x TARTA"])]);
    expect(atFire[0]![0]).not.toMatch(/\*\*\*/);
  });

  it("A803 waiting copy: Split a table: the leaving bill's MOVED slip lists its held dish under HOLD", async () => {
    const t = await paperTable(true);
    const table8 = `Mesa 8 (${t.n})`;
    const tableId = await v.table(table8);
    const joining = { operatorId: OPERATOR, expectedPartyRevision: await revisionOf(v, t.partyId) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, t.partyId, tableId, joining));
    const mark = (await printed(t.grill.printer)).length;
    const splitting = {
      operatorId: OPERATOR,
      expectedPartyRevision: await revisionOf(v, t.partyId),
    };

    await inTx(v, (tx) => splitTable(tx, v.cfg, t.partyId, tableId, t.bill2, splitting));

    const copyId = (await lineOf(t.bill2, "Tarta")).groupId!;
    expect((await groupRow(copyId)).displayNumber).not.toBe((await groupRow(t.g)).displayNumber);
    const orderLine = await orderLineOf(t.bill2);
    const slips = (await printed(t.grill.printer))
      .slice(mark)
      .filter((lines) => lines[0] === `*** ${words.moved} ***` && lines[2] === orderLine);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.slice(6)).toEqual([
      "1 x BURG",
      words.hold,
      `${words.group} 2 · DESSERTS`,
      "1 x TARTA",
      "",
    ]);
  });

  it("A803 split: what the kitchen is told: a loose held dish on HOLD paper prints under HOLD with its copy's number", async () => {
    const t = await paperTable(true);
    const table8 = `Mesa 8 (${t.n})`;
    const tableId = await v.table(table8);
    const joining = { operatorId: OPERATOR, expectedPartyRevision: await revisionOf(v, t.partyId) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, t.partyId, tableId, joining));
    const marks = {
      grill: (await printed(t.grill.printer)).length,
      pastry: (await printed(t.pastry.printer)).length,
    };
    const burger = await lineOf(t.bill2, "Burger");
    const cake = await lineOf(t.bill2, "Tarta");
    const splitting = {
      operatorId: OPERATOR,
      expectedPartyRevision: await revisionOf(v, t.partyId),
      expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, t.bill2))],
    };

    const { partyId, billId: newBill } = await inTx(v, (tx) =>
      splitTable(
        tx,
        v.cfg,
        t.partyId,
        tableId,
        { wholeBillIds: [], loose: [{ billId: t.bill2, lineIds: [burger.id, cake.id] }] },
        splitting,
      ),
    );

    const copyId = (await lineOf(newBill, "Tarta")).groupId!;
    expect((await groupRow(copyId)).displayNumber).not.toBe((await groupRow(t.g)).displayNumber);
    const fromNumber = await orderNumberOf(t.bill2);
    const toNumber = await orderNumberOf(newBill);
    expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
      movedSlip(
        t.grill.name,
        `${words.order} ${fromNumber} -> ${toNumber}`,
        `Mesa 5 (${t.n}), 8 (${t.n})`,
        table8,
        ["1 x BURG", words.hold, `${words.group} 2 · DESSERTS`, "1 x TARTA"],
      ),
    ]);
    expect((await printed(t.pastry.printer)).slice(marks.pastry)).toEqual([]);

    await answerNoAllergies(partyId);
    const beforeFire = (await printed(t.grill.printer)).length;

    await fire(partyId, copyId);

    expect((await printed(t.grill.printer)).slice(beforeFire)).toEqual([
      fireTicket(t.grill.name, table8, toNumber, 2, "1 x TARTA"),
    ]);
  });

  it("A803 waiting copy: moving the bill again: the second MOVED slip lists the held dish under HOLD with its group's number at the third table", async () => {
    const t = await paperTable(true);
    const table8 = `Mesa 8 (${t.n})`;
    const table9 = `Mesa 9 (${t.n})`;
    const third = await v.table(table9);
    // A group already there makes the copy number 3 here against 2 at the second table, so a slip
    // printing the number the dish left behind cannot pass.
    await orderForParty(v, (await seat(v, third)).partyId, ["Water"]);
    const first = await moveBill2(t, table8);

    const second = await moveBill2(t, table9, third);

    expect(second.copyId).not.toBe(first.copyId);
    expect((await groupRow(second.copyId)).displayNumber).not.toBe(
      (await groupRow(first.copyId)).displayNumber,
    );
    expect((await printed(t.grill.printer)).slice(second.marks.grill)).toEqual([
      movedSlip(t.grill.name, await orderLineOf(t.bill2), table8, table9, [
        "1 x BURG",
        words.hold,
        `${words.group} 3 · DESSERTS`,
        "1 x TARTA",
      ]),
    ]);
    expect((await printed(t.pastry.printer)).slice(second.marks.pastry)).toEqual([]);
  });

  describe("A1327 a dish waiting for the pass on HOLD paper changes table", () => {
    afterEach(() => inTx(v, (tx) => setStationsWaitForPass(tx, false, paperStations)));

    let passActor: PassActor | undefined;

    async function passDevice(): Promise<PassActor> {
      if (passActor !== undefined) return passActor;
      const [profile] = await inTx(v, (tx) =>
        seedDeviceProfiles(tx, {
          name: "A1327 pass profile",
          formFactor: "kds",
          capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
        }),
      );
      const joined = await enrolDeviceForTest(v.db, v.cfg, {
        name: "A1327 pass",
        profileId: profile!.id,
        kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
      });
      passActor = { deviceId: joined.deviceId, personId: null };
      return passActor;
    }

    /**
     * Releases, with the real `releasePassItems`, the pass card holding the line's ticket item, as
     * the board scoped to `stationId` offers it; null reads every station's, as the pass device does.
     */
    async function release(stationId: string | null, lineId: string) {
      const item = await kitchenItemOf(lineId);
      const stationIds = stationId === null ? null : [stationId];
      const card = await inTx(v, async (tx) =>
        (await readScopedPassBoard(tx, { stationIds, zoneIds: null })).toFire.find((found) =>
          found.releaseTicketItemIds.includes(item.id),
        ),
      );
      expect(card).toBeDefined();
      const pass = await passDevice();
      await inTx(v, (tx) =>
        releasePassItems(tx, v.cfg, pass, {
          submissionId: randomUUID(),
          target: card!.target,
          ticketItemIds: card!.releaseTicketItemIds,
          expectedContext: card!.releaseContext,
        }),
      );
    }

    /** {@link paperTable} with Grill waiting for the pass and G fired: Tarta waits on HOLD paper. */
    async function waitingTable(grillHoldPaper = true) {
      const t = await paperTable(true, grillHoldPaper);
      await inTx(v, (tx) => setStationsWaitForPass(tx, true, [t.grill.id]));
      await fire(t.partyId, t.g);
      const cake = await kitchenItemOf((await lineOf(t.bill2, "Tarta")).id);
      expect(cake.requestedAt).not.toBeNull();
      expect(cake.firedAt).toBeNull();
      return t;
    }

    async function releaseTarta(t: Awaited<ReturnType<typeof paperTable>>) {
      const mark = (await printed(t.grill.printer)).length;
      await release(t.grill.id, (await lineOf(t.bill2, "Tarta")).id);
      return (await printed(t.grill.printer)).slice(mark);
    }

    it("A1327: moved to a free table, the MOVED slip lists the waiting tarta under HOLD and its release prints FIRE", async () => {
      const t = await waitingTable();
      const table8 = `Mesa 8 (${t.n})`;

      const { partyId, marks } = await moveBill2(t, table8);

      expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, [
          "1 x BURG",
          words.hold,
          `${words.group} 2 · DESSERTS`,
          "1 x TARTA",
        ]),
      ]);
      await answerNoAllergies(partyId);
      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, table8, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
      ]);
    });

    it("A1327: moved to a table another party holds, the MOVED slip lists the waiting tarta under HOLD and its release prints FIRE", async () => {
      const t = await waitingTable();
      const label = `Mesa 8 (${t.n})`;
      const tableId = await v.table(label);
      await orderForParty(v, (await seat(v, tableId)).partyId, ["Water"]);

      const { marks } = await moveBill2(t, label, tableId);

      expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, label, [
          "1 x BURG",
          words.hold,
          `${words.group} 3 · DESSERTS`,
          "1 x TARTA",
        ]),
      ]);
      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, label, await orderNumberOf(t.bill2), 3, "1 x TARTA"),
      ]);
    });

    it("A1327: a waiting tarta whose HOLD paper printed only at another station is left off the slip and released with no FIRE mark", async () => {
      const t = await waitingTable(false);
      expect(await holdStationsOf(t.g)).toEqual([t.pastry.id]);
      const table8 = `Mesa 8 (${t.n})`;

      const { partyId, marks } = await moveBill2(t, table8);

      expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, ["1 x BURG"]),
      ]);
      await answerNoAllergies(partyId);
      const released = await releaseTarta(t);
      expect(released).toEqual([expect.arrayContaining(["1 x TARTA"])]);
      expect(released[0]![0]).not.toMatch(/\*\*\*/);
    });

    it("A1327: a waiting tarta whose HOLD paper never printed is left off the slip and released with no FIRE mark", async () => {
      const t = await paperTable(false);
      await inTx(v, (tx) => setStationsWaitForPass(tx, true, [t.grill.id]));
      await fire(t.partyId, t.g);
      const table8 = `Mesa 8 (${t.n})`;

      const { partyId, marks } = await moveBill2(t, table8);

      expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, ["1 x BURG"]),
      ]);
      await answerNoAllergies(partyId);
      const released = await releaseTarta(t);
      expect(released).toEqual([expect.arrayContaining(["1 x TARTA"])]);
      expect(released[0]![0]).not.toMatch(/\*\*\*/);
    });

    it("A1327: with Grill waiting for the pass, a fired dish and a dish of a still-held group print on the slip as before", async () => {
      const t = await paperTable(true);
      await inTx(v, (tx) => setStationsWaitForPass(tx, true, [t.grill.id]));
      const table8 = `Mesa 8 (${t.n})`;

      const { copyId, marks } = await moveBill2(t, table8);

      expect((await groupRow(copyId)).state).toBe("held");
      expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, [
          "1 x BURG",
          words.hold,
          `${words.group} 2 · DESSERTS`,
          "1 x TARTA",
        ]),
      ]);
    });

    it("A1327: a held copy fired at the second table and moved again lists the waiting tarta under HOLD and its release prints FIRE", async () => {
      const t = await paperTable(true);
      await inTx(v, (tx) => setStationsWaitForPass(tx, true, [t.grill.id]));
      const table8 = `Mesa 8 (${t.n})`;
      const table9 = `Mesa 9 (${t.n})`;
      const first = await moveBill2(t, table8);
      await answerNoAllergies(first.partyId);
      await fire(first.partyId, first.copyId);
      expect((await kitchenItemOf((await lineOf(t.bill2, "Tarta")).id)).firedAt).toBeNull();

      const second = await moveBill2(t, table9);

      expect((await printed(t.grill.printer)).slice(second.marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), table8, table9, [
          "1 x BURG",
          words.hold,
          `${words.group} 2 · DESSERTS`,
          "1 x TARTA",
        ]),
      ]);
      await answerNoAllergies(second.partyId);
      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, table9, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
      ]);
    });

    it("A1327: beside a waiting dish at the same station never on HOLD paper, voiding that dish prints no HOLD correction and only the tarta's release is marked FIRE", async () => {
      const t = await waitingTable();
      await inTx(v, (tx) =>
        placeGroups(tx, v.cfg, t.partyId, {
          groups: [
            {
              release: "fire",
              lines: ["Burger", "Burger"].map((name) => ({
                menuItemId: v.item(name),
                quantity: "1",
                courseId: null,
              })),
            },
          ],
          operatorId: OPERATOR,
          billId: t.bill2,
        }),
      );
      const [, second, third] = (await linesOf(t.bill2)).filter(
        (line) => line.name === "Burger" && line.parentLineId === null,
      );
      expect((await kitchenItemOf(second!.id)).requestedAt).not.toBeNull();
      expect((await kitchenItemOf(third!.id)).firedAt).toBeNull();
      const table8 = `Mesa 8 (${t.n})`;
      const { partyId } = await moveBill2(t, table8);
      await answerNoAllergies(partyId);

      const beforeVoid = (await printed(t.grill.printer)).length;
      await inTx(v, (tx) => cancelLine(tx, v.cfg, t.bill2, second!.lineNo));
      expect(
        (await printed(t.grill.printer))
          .slice(beforeVoid)
          .flat()
          .filter((text) => text.includes(words.hold)),
      ).toEqual([]);

      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, table8, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
      ]);

      const beforeBurger = (await printed(t.grill.printer)).length;
      await release(t.grill.id, third!.id);
      const burger = (await printed(t.grill.printer)).slice(beforeBurger);
      expect(burger).toEqual([expect.arrayContaining(["1 x BURG"])]);
      expect(burger[0]![0]).not.toMatch(/\*\*\*/);
    });

    it("A1368: moved to the counter, the waiting tarta gets no moved notice, is left off the slip and is released with no FIRE mark", async () => {
      const t = await waitingTable();
      const mark = (await printed(t.grill.printer)).length;
      const noticesBefore = new Set((await movedNotices([t.bill2])).map((notice) => notice.id));

      await moveWholeBill(t.bill2, t.partyId, { counter: { zoneId: null } });

      expect((await printed(t.grill.printer)).slice(mark)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, words.counter, ["1 x BURG"]),
      ]);
      expect(
        (await movedNotices([t.bill2])).filter((notice) => !noticesBefore.has(notice.id)),
      ).toEqual([{ id: expect.any(String), lineName: "BURG", stationId: t.grill.id }]);
      expect(await releaseTarta(t)).toEqual([
        [
          t.grill.name,
          t.label,
          await orderNumberOf(t.bill2),
          expect.stringMatching(/^\d\d:\d\d$/),
          "1 x TARTA",
          "",
        ],
      ]);
    });

    it("A1368: a paid bill moved to the counter gives the waiting tarta a moved notice but leaves it off the slip and releases it with no FIRE mark", async () => {
      const t = await waitingTable();
      await payWorkingOrder(
        { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
        v.cfg,
        { id: t.bill2, tender: { method: "cash", amount: "27.00" }, lines: [] },
      );
      const mark = (await printed(t.grill.printer)).length;
      const noticesBefore = new Set((await movedNotices([t.bill2])).map((notice) => notice.id));

      await inTx(v, async (tx) =>
        moveSettledBillToCounter(
          tx,
          v.cfg,
          t.bill2,
          { partyId: t.partyId },
          await readBillEditState(tx, t.bill2),
        ),
      );

      expect((await printed(t.grill.printer)).slice(mark)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, words.counter, ["1 x BURG"]),
      ]);
      expect(
        (await movedNotices([t.bill2])).filter((notice) => !noticesBefore.has(notice.id)),
      ).toEqual([
        { id: expect.any(String), lineName: "BURG", stationId: t.grill.id },
        { id: expect.any(String), lineName: "TARTA", stationId: t.grill.id },
      ]);
      expect(await releaseTarta(t)).toEqual([
        [
          t.grill.name,
          t.label,
          await orderNumberOf(t.bill2),
          expect.stringMatching(/^\d\d:\d\d$/),
          "1 x TARTA",
          "",
        ],
      ]);
    });

    /**
     * {@link paperTable} with only Grill printing held work and Flan moved to Bill 2 beside the
     * Tarta, both stations waiting for the pass, G fired: the Tarta waits on Grill's HOLD paper and
     * the Flan at Pastry, which never had any.
     */
    async function mixedStationTable() {
      const t = await paperTable(false, true);
      const flan = await lineOf(t.bill1, "Flan");
      const command = { ...(await commandFor(v, t.partyId)), partyId: t.partyId };
      await inTx(v, (tx) => moveDishes(tx, v.cfg, t.bill1, t.bill2, [flan.id], command));
      expect(await holdStationsOf(t.g)).toEqual([t.grill.id]);
      await inTx(v, (tx) => setStationsWaitForPass(tx, true, [t.grill.id, t.pastry.id]));
      await fire(t.partyId, t.g);
      for (const name of ["Tarta", "Flan"])
        expect(await kitchenItemOf((await lineOf(t.bill2, name)).id)).toMatchObject({
          requestedAt: expect.any(String),
          firedAt: null,
        });
      const table8 = `Mesa 8 (${t.n})`;
      const noticesBefore = new Set((await movedNotices([t.bill2])).map((notice) => notice.id));
      const moved = await moveBill2(t, table8);
      expect((await lineOf(t.bill2, "Flan")).groupId).toBe(moved.copyId);
      expect(await holdStationsOf(moved.copyId)).toEqual([t.grill.id]);
      return { t, table8, noticesBefore, ...moved };
    }

    it("A1327: a dish of the same group waiting at a station never on HOLD paper is left off the slip, and voiding it prints no HOLD correction", async () => {
      const { t, table8, partyId, marks, noticesBefore } = await mixedStationTable();

      expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
        movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, table8, [
          "1 x BURG",
          words.hold,
          `${words.group} 2 · DESSERTS`,
          "1 x TARTA",
        ]),
      ]);
      expect((await printed(t.pastry.printer)).slice(marks.pastry)).toEqual([]);
      expect(
        (await movedNotices([t.bill2])).filter((notice) => !noticesBefore.has(notice.id)),
      ).toEqual([
        { id: expect.any(String), lineName: "BURG", stationId: t.grill.id },
        { id: expect.any(String), lineName: "TARTA", stationId: t.grill.id },
      ]);
      await answerNoAllergies(partyId);

      const beforeVoid = {
        grill: (await printed(t.grill.printer)).length,
        pastry: (await printed(t.pastry.printer)).length,
      };
      await inTx(v, async (tx) =>
        cancelLine(tx, v.cfg, t.bill2, (await lineOf(t.bill2, "Flan")).lineNo),
      );
      expect((await printed(t.grill.printer)).slice(beforeVoid.grill)).toEqual([]);
      expect((await printed(t.pastry.printer)).slice(beforeVoid.pastry)).toEqual([]);

      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, table8, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
      ]);
    });

    it("A1327: releasing the group's pass card marks the tarta FIRE and the dish of the same group never on HOLD paper with no FIRE mark", async () => {
      const { t, table8, partyId } = await mixedStationTable();
      await answerNoAllergies(partyId);
      const mark = {
        grill: (await printed(t.grill.printer)).length,
        pastry: (await printed(t.pastry.printer)).length,
      };

      await release(null, (await lineOf(t.bill2, "Flan")).id);

      expect((await printed(t.grill.printer)).slice(mark.grill)).toEqual([
        fireTicket(t.grill.name, table8, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
      ]);
      expect((await printed(t.pastry.printer)).slice(mark.pastry)).toEqual([
        [
          t.pastry.name,
          table8,
          await orderNumberOf(t.bill2),
          expect.stringMatching(/^\d\d:\d\d$/),
          `${words.group} 2 · DESSERTS`,
          "1 x FLAN",
          "",
        ],
      ]);
    });

    /** Joins a new Mesa 8 to the party and splits it off with `selection`; returns the slip mark. */
    async function splitOff(
      t: Awaited<ReturnType<typeof paperTable>>,
      selection: { wholeBillIds: string[]; loose: { billId: string; lineIds: string[] }[] },
    ) {
      const table8 = `Mesa 8 (${t.n})`;
      const tableId = await v.table(table8);
      const joining = {
        operatorId: OPERATOR,
        expectedPartyRevision: await revisionOf(v, t.partyId),
      };
      await inTx(v, (tx) => joinTables(tx, v.cfg, t.partyId, tableId, joining));
      const mark = (await printed(t.grill.printer)).length;
      const noticesBefore = new Set(
        (await movedNotices([t.bill1, t.bill2])).map((notice) => notice.id),
      );
      const splitting = {
        operatorId: OPERATOR,
        expectedPartyRevision: await revisionOf(v, t.partyId),
        expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, t.bill2))],
      };
      const result = await inTx(v, (tx) =>
        splitTable(tx, v.cfg, t.partyId, tableId, selection, splitting),
      );
      return { table8, mark, noticesBefore, ...result };
    }

    async function newNotices(billIds: string[], before: Set<string>) {
      return (await movedNotices(billIds)).filter((notice) => !before.has(notice.id));
    }

    it("A1327: Split a table taking the whole bill lists the waiting tarta under HOLD and its release prints FIRE", async () => {
      const t = await waitingTable();

      const { table8, mark, noticesBefore, partyId } = await splitOff(t, {
        wholeBillIds: [t.bill2],
        loose: [],
      });

      const orderLine = await orderLineOf(t.bill2);
      const slips = (await printed(t.grill.printer))
        .slice(mark)
        .filter((lines) => lines[0] === `*** ${words.moved} ***` && lines[2] === orderLine);
      expect(slips).toHaveLength(1);
      expect(slips[0]!.slice(6)).toEqual([
        "1 x BURG",
        words.hold,
        `${words.group} 2 · DESSERTS`,
        "1 x TARTA",
        "",
      ]);
      expect(await newNotices([t.bill1, t.bill2], noticesBefore)).toEqual([
        { id: expect.any(String), lineName: "BURG", stationId: t.grill.id },
        { id: expect.any(String), lineName: "TARTA", stationId: t.grill.id },
      ]);
      await answerNoAllergies(partyId);
      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, table8, await orderNumberOf(t.bill2), 2, "1 x TARTA"),
      ]);
    });

    it("A1327: Split a table taking the waiting tarta loose lists it under HOLD and its release prints FIRE", async () => {
      const t = await waitingTable();
      const cake = await lineOf(t.bill2, "Tarta");

      const {
        table8,
        mark,
        noticesBefore,
        partyId,
        billId: newBill,
      } = await splitOff(t, {
        wholeBillIds: [],
        loose: [{ billId: t.bill2, lineIds: [cake.id] }],
      });

      const fromNumber = await orderNumberOf(t.bill2);
      const toNumber = await orderNumberOf(newBill);
      expect((await printed(t.grill.printer)).slice(mark)).toEqual([
        movedSlip(
          t.grill.name,
          `${words.order} ${fromNumber} -> ${toNumber}`,
          `Mesa 5 (${t.n}), 8 (${t.n})`,
          table8,
          [words.hold, `${words.group} 1 · DESSERTS`, "1 x TARTA"],
        ),
      ]);
      expect(await newNotices([t.bill2, newBill], noticesBefore)).toEqual([
        { id: expect.any(String), lineName: "TARTA", stationId: t.grill.id },
      ]);
      await answerNoAllergies(partyId);
      const releaseMark = (await printed(t.grill.printer)).length;
      await release(t.grill.id, (await lineOf(newBill, "Tarta")).id);
      expect((await printed(t.grill.printer)).slice(releaseMark)).toEqual([
        fireTicket(t.grill.name, table8, toNumber, 1, "1 x TARTA"),
      ]);
    });

    it("A1327: Split a table taking a waiting tarta whose HOLD paper printed only at another station leaves it off the slip and releases it with no FIRE mark", async () => {
      const t = await waitingTable(false);

      const { mark, partyId } = await splitOff(t, { wholeBillIds: [t.bill2], loose: [] });

      const orderLine = await orderLineOf(t.bill2);
      const slips = (await printed(t.grill.printer))
        .slice(mark)
        .filter((lines) => lines[0] === `*** ${words.moved} ***` && lines[2] === orderLine);
      expect(slips).toHaveLength(1);
      expect(slips[0]!.slice(6)).toEqual(["1 x BURG", ""]);
      await answerNoAllergies(partyId);
      const released = await releaseTarta(t);
      expect(released).toEqual([expect.arrayContaining(["1 x TARTA"])]);
      expect(released[0]![0]).not.toMatch(/\*\*\*/);
    });

    /** The party's bill-to-bill moves of Bill 2's waiting Tarta, each by its real writer. */
    const BETWEEN_BILLS = {
      "Split bill": async (t: Awaited<ReturnType<typeof paperTable>>) => {
        const cake = await lineOf(t.bill2, "Tarta");
        const command = { ...(await commandFor(v, t.partyId)), partyId: t.partyId };
        return (
          await inTx(v, (tx) => splitBill(tx, v.cfg, t.bill2, [{ lineNo: cake.lineNo }], command))
        ).billId;
      },
      "Move dishes": async (t: Awaited<ReturnType<typeof paperTable>>) => {
        const cake = await lineOf(t.bill2, "Tarta");
        const command = { ...(await commandFor(v, t.partyId)), partyId: t.partyId };
        await inTx(v, (tx) => moveDishes(tx, v.cfg, t.bill2, t.bill1, [cake.id], command));
        return t.bill1;
      },
      "Merge bills": async (t: Awaited<ReturnType<typeof paperTable>>) => {
        const command = { ...(await commandFor(v, t.partyId)), partyId: t.partyId };
        await inTx(v, (tx) => mergeBills(tx, v.cfg, t.bill1, t.bill2, command));
        return t.bill1;
      },
    };

    it.each(Object.keys(BETWEEN_BILLS) as (keyof typeof BETWEEN_BILLS)[])(
      "A1327: %s taking the waiting tarta to another bill of the party lists it under HOLD and its release prints FIRE",
      async (action) => {
        const t = await waitingTable();
        const fromNumber = await orderNumberOf(t.bill2);
        const mark = (await printed(t.grill.printer)).length;

        const to = await BETWEEN_BILLS[action](t);

        expect((await lineOf(to, "Tarta")).groupId).toBe(t.g);
        const toNumber = await orderNumberOf(to);
        expect((await printed(t.grill.printer)).slice(mark)).toEqual([
          movedSlip(t.grill.name, `${words.order} ${fromNumber} -> ${toNumber}`, t.label, t.label, [
            ...(action === "Merge bills" ? ["1 x BURG"] : []),
            words.hold,
            `${words.group} 3 · DESSERTS`,
            "1 x TARTA",
          ]),
        ]);
        const releaseMark = (await printed(t.grill.printer)).length;
        await release(t.grill.id, (await lineOf(to, "Tarta")).id);
        expect((await printed(t.grill.printer)).slice(releaseMark)).toEqual([
          fireTicket(t.grill.name, t.label, toNumber, 3, "1 x TARTA"),
        ]);
      },
    );

    it("A1327: combined into the party at the table it moves to, the waiting tarta keeps its group, is listed under HOLD and its release prints FIRE", async () => {
      const t = await waitingTable();
      const label = `Mesa 8 (${t.n})`;
      const tableId = await v.table(label);
      const other = await seat(v, tableId);
      await orderForParty(v, other.partyId, ["Water"]);
      const fromNumber = await orderNumberOf(t.bill2);
      const mark = (await printed(t.grill.printer)).length;

      const moving = {
        ...(await commandFor(v, t.partyId)),
        otherPartyId: other.partyId,
        expectedOtherPartyRevision: await revisionOf(v, other.partyId),
      };
      await inTx(v, (tx) => moveGuests(tx, v.cfg, t.partyId, tableId, moving));

      expect((await lineOf(t.bill2, "Tarta")).groupId).toBe(t.g);
      expect(await orderNumberOf(t.bill2)).toBe(fromNumber);
      expect((await printed(t.grill.printer)).slice(mark)).toEqual([
        movedSlip(t.grill.name, `${words.order} ${fromNumber}`, t.label, label, [
          "1 x BURG",
          words.hold,
          `${words.group} 3 · DESSERTS`,
          "1 x TARTA",
        ]),
      ]);
      expect(await releaseTarta(t)).toEqual([
        fireTicket(t.grill.name, label, fromNumber, 3, "1 x TARTA"),
      ]);
    });
  });
});

declare module "vitest" {
  interface TaskMeta {
    raceWinner?: string;
    raceLoserCode?: string;
  }
}

type Outcome = PromiseSettledResult<unknown>;

/**
 * Starts both commands at once, each after its revisions and body were read, and records the
 * order each was asked for, began and ended inside its transaction.
 */
async function race(
  commands: Record<string, (tx: Transaction) => Promise<unknown>>,
): Promise<{ outcomes: Record<string, Outcome>; trace: string[] }> {
  const trace: string[] = [];
  let open!: () => void;
  const barrier = new Promise<void>((resolve) => (open = resolve));
  const names = Object.keys(commands);
  const run = async (name: string) => {
    await barrier;
    trace.push(`asked ${name}`);
    return inTx(v, async (tx) => {
      trace.push(`began ${name}`);
      try {
        return await commands[name]!(tx);
      } finally {
        trace.push(`ended ${name}`);
      }
    });
  };
  const racing = Promise.allSettled(names.map(run));
  open();
  const settled = await racing;
  return {
    outcomes: Object.fromEntries(names.map((name, i) => [name, settled[i]!])),
    trace,
  };
}

/** The one command that committed and the other's refusal code, recorded on the case. */
function judge(
  task: { meta: { raceWinner?: string; raceLoserCode?: string } },
  outcomes: Record<string, Outcome>,
  trace: string[],
) {
  const names = Object.keys(outcomes);
  // Both were asked for before either ended: they were in flight together.
  const firstEnd = trace.findIndex((entry) => entry.startsWith("ended"));
  expect(trace.slice(0, firstEnd).filter((entry) => entry.startsWith("asked"))).toHaveLength(2);
  const ran = trace.filter((entry) => !entry.startsWith("asked")).map((e) => e.split(" ")[1]);
  expect(ran).toEqual([ran[0], ran[0], ran[2], ran[2]]);
  expect(new Set(ran).size).toBe(2);
  const winners = names.filter((name) => outcomes[name]!.status === "fulfilled");
  expect(winners).toHaveLength(1);
  const winner = winners[0]!;
  const loser = names.find((name) => name !== winner)!;
  const reason = (outcomes[loser] as PromiseRejectedResult).reason as { code?: string };
  task.meta.raceWinner = winner;
  task.meta.raceLoserCode = reason.code;
  expect(reason).toMatchObject({ code: "party.out_of_date" });
  return { winner, loser };
}

function eventKindsSince(groupIds: string[], before: Set<string>) {
  return v.db
    .select({
      id: orderGroupEvents.id,
      groupId: orderGroupEvents.groupId,
      kind: orderGroupEvents.kind,
    })
    .from(orderGroupEvents)
    .where(inArray(orderGroupEvents.groupId, groupIds))
    .orderBy(sql`rowid`)
    .then((rows) => rows.filter((row) => !before.has(row.id)));
}

/** The bills' MOVED notices not in `before`. */
function movedNoticesOf(billIds: string[], before: Set<string>) {
  return v.db
    .select({
      id: kitchenNotices.id,
      lineName: kitchenNotices.lineName,
      movedTo: kitchenNotices.movedTo,
    })
    .from(kitchenNotices)
    .where(and(inArray(kitchenNotices.workingOrderId, billIds), eq(kitchenNotices.kind, "moved")))
    .orderBy(asc(kitchenNotices.lineName))
    .then((rows) => rows.filter((row) => !before.has(row.id)));
}

describe("A803 waiting copy: races", () => {
  afterEach(() => inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: false }, paperStations)));

  /** Bill 2's Move this bill to `tableId`, carrying the revision and edit state read now. */
  async function moveOf(billId: string, partyId: string, tableId: string) {
    const options = {
      operatorId: OPERATOR,
      partyId,
      expectedPartyRevision: await revisionOf(v, partyId),
      otherPartyId: null,
      expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, billId))],
    };
    return (tx: Transaction) => moveBill(tx, v.cfg, billId, { tableId }, options);
  }

  it("A803 waiting copy: of two moves of one bill read from one revision, one commits and the other is refused with nothing of its own written", async ({
    task,
  }) => {
    const t = await paperTable(true);
    const labels = { left: `Mesa 8 (${t.n})`, right: `Mesa 9 (${t.n})` };
    const tables = { left: await v.table(labels.left), right: await v.table(labels.right) };
    const marks = {
      grill: (await printed(t.grill.printer)).length,
      pastry: (await printed(t.pastry.printer)).length,
    };
    const eventsBefore = new Set((await eventsOf(t.g)).map((event) => event.id));
    const noticesBefore = new Set(
      (await movedNoticesOf([t.bill1, t.bill2], new Set())).map((notice) => notice.id),
    );

    const { outcomes, trace } = await race({
      left: await moveOf(t.bill2, t.partyId, tables.left),
      right: await moveOf(t.bill2, t.partyId, tables.right),
    });

    const { winner, loser } = judge(task, outcomes, trace);
    const won = (outcomes[winner] as PromiseFulfilledResult<{ partyId: string }>).value.partyId;
    const side = winner as "left" | "right";
    expect(await holderNow(tables[side])).toBe(won);
    expect(await holderNow(tables[loser as "left" | "right"])).toBeNull();
    const cake = await lineOf(t.bill2, "Tarta");
    const copies = await groupsOf(won);
    expect(copies.map((group) => [group.id, group.state])).toEqual([
      [(await lineOf(t.bill2, "Burger")).groupId, "fired"],
      [cake.groupId, "held"],
    ]);
    expect(
      (await eventKindsSince([t.g, cake.groupId!], eventsBefore)).map((e) => [e.groupId, e.kind]),
    ).toEqual([
      [t.g, "lines_moved"],
      [cake.groupId, "lines_moved"],
    ]);
    expect(
      (await movedNoticesOf([t.bill1, t.bill2], noticesBefore)).map((n) => [n.lineName, n.movedTo]),
    ).toEqual([
      ["BURG", labels[side]],
      ["TARTA", labels[side]],
    ]);
    expect((await printed(t.grill.printer)).slice(marks.grill)).toEqual([
      movedSlip(t.grill.name, await orderLineOf(t.bill2), t.label, labels[side], [
        "1 x BURG",
        words.hold,
        `${words.group} 2 · DESSERTS`,
        "1 x TARTA",
      ]),
    ]);
    expect((await printed(t.pastry.printer)).slice(marks.pastry)).toEqual([]);
  });

  for (const order of [
    ["move", "fire"],
    ["fire", "move"],
  ] as const) {
    it(`A803 waiting copy: a move and a fire of the same held group: one commits, the other is refused (${order[0]} asked first)`, async ({
      task,
    }) => {
      const t = await paperTable(true);
      const label = `Mesa 8 (${t.n})`;
      const tableId = await v.table(label);
      const marks = {
        grill: (await printed(t.grill.printer)).length,
        pastry: (await printed(t.pastry.printer)).length,
      };
      const eventsBefore = new Set((await eventsOf(t.g)).map((event) => event.id));
      const noticesBefore = new Set(
        (await movedNoticesOf([t.bill1, t.bill2], new Set())).map((notice) => notice.id),
      );
      const firing = { ...(await commandFor(v, t.partyId)), submissionId: randomUUID() };
      const commands = {
        move: await moveOf(t.bill2, t.partyId, tableId),
        fire: (tx: Transaction) => fireGroup(tx, v.cfg, t.partyId, t.g, firing),
      };

      const { outcomes, trace } = await race({
        [order[0]]: commands[order[0]],
        [order[1]]: commands[order[1]],
      });

      const { winner } = judge(task, outcomes, trace);
      expect(winner).toBe(order[0]);
      const cake = await lineOf(t.bill2, "Tarta");
      const newPrints = [
        ...(await printed(t.grill.printer)).slice(marks.grill),
        ...(await printed(t.pastry.printer)).slice(marks.pastry),
      ].map((lines) => lines[0]);
      if (winner === "move") {
        const won = (await holderNow(tableId))!;
        expect(won).not.toBeNull();
        expect(await groupRow(cake.groupId!)).toMatchObject({ partyId: won, state: "held" });
        expect(await kitchenItemOf(cake.id)).toMatchObject({ firedAt: null, requestedAt: null });
        expect((await groupRow(t.g)).state).toBe("held");
        expect(
          (await eventKindsSince([t.g, cake.groupId!], eventsBefore)).map((e) => e.kind),
        ).toEqual(["lines_moved", "lines_moved"]);
        expect(newPrints).toEqual([`*** ${words.moved} ***`]);
      } else {
        expect(await holderNow(tableId)).toBeNull();
        expect(cake.groupId).toBe(t.g);
        expect((await groupRow(t.g)).state).toBe("fired");
        expect(await kitchenItemOf(cake.id)).toMatchObject({ firedAt: expect.any(String) });
        expect((await eventKindsSince([t.g], eventsBefore)).map((e) => e.kind)).toEqual(["fired"]);
        expect(await movedNoticesOf([t.bill1, t.bill2], noticesBefore)).toEqual([]);
        expect(newPrints).toEqual([`*** ${words.fire} ***`, `*** ${words.fire} ***`]);
      }
    });
  }

  for (const order of [
    ["move", "split"],
    ["split", "move"],
  ] as const) {
    it(`A803 waiting copy: a move and Split a table of the same bill: one commits (${order[0]} asked first)`, async ({
      task,
    }) => {
      const a = await seatWith([
        { names: ["Burger"], release: "fire" },
        { names: ["Flan"], release: "hold" },
      ]);
      const source = (await lineOf(a.billId, "Flan")).groupId!;
      const joined = await v.table(`Copy ${++tableNumber}`);
      const joining = {
        operatorId: OPERATOR,
        expectedPartyRevision: await revisionOf(v, a.partyId),
      };
      await inTx(v, (tx) => joinTables(tx, v.cfg, a.partyId, joined, joining));
      const free = await v.table(`Copy ${++tableNumber}`);
      const splitting = {
        ...(await commandFor(v, a.partyId)),
        expectedEdits: [await inTx(v, (tx) => readBillEditState(tx, a.billId))],
      };
      const commands = {
        move: await moveOf(a.billId, a.partyId, free),
        split: (tx: Transaction) => splitTable(tx, v.cfg, a.partyId, joined, a.billId, splitting),
      };

      const { outcomes, trace } = await race({
        [order[0]]: commands[order[0]],
        [order[1]]: commands[order[1]],
      });

      const { winner } = judge(task, outcomes, trace);
      expect(winner).toBe(order[0]);
      const flan = await lineOf(a.billId, "Flan");
      const won = (await holderNow(winner === "move" ? free : joined))!;
      expect(won).not.toBe(a.partyId);
      expect(await holderNow(winner === "move" ? joined : free)).toBe(
        winner === "move" ? a.partyId : null,
      );
      expect((await groupsOf(won)).map((group) => group.state)).toEqual(["fired", "held"]);
      expect(await groupRow(flan.groupId!)).toMatchObject({ partyId: won, state: "held" });
      expect((await groupRow(source)).state).toBe("removed");
      expect(await groupsOf(a.partyId)).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ state: "held" })]),
      );
    });
  }
});

describe("A803 waiting copy: how long a group has been held", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  function backdateGroup(groupId: string, createdAt: string) {
    return inTx(v, (tx) =>
      tx.update(orderGroups).set({ createdAt }).where(eq(orderGroups.id, groupId)),
    );
  }

  async function shownGroup(partyId: string, groupId: string) {
    const { groups } = await inTx(v, (tx) => readCurrentOrders(tx, partyId));
    return groups.find((group) => group.id === groupId)!;
  }

  async function splitToNewTable(partyId: string, billId: string) {
    const tableId = await v.table(`Copy ${++tableNumber}`);
    const joining = { operatorId: OPERATOR, expectedPartyRevision: await revisionOf(v, partyId) };
    await inTx(v, (tx) => joinTables(tx, v.cfg, partyId, tableId, joining));
    const splitting = { operatorId: OPERATOR, expectedPartyRevision: await revisionOf(v, partyId) };
    return inTx(v, (tx) => splitTable(tx, v.cfg, partyId, tableId, billId, splitting));
  }

  it("A803 waiting copy: Move this bill: the copy shows the time its source was held, and so does a copy of the copy", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const source = (await lineOf(a.billId, "Tarta")).groupId!;
    const held = minutesAgo(20);
    await backdateGroup(source, held);
    const before = await shownGroup(a.partyId, source);
    expect(before.sentAt).toBe(held);

    const first = await moveWholeBill(a.billId, a.partyId, {
      tableId: await v.table(`Copy ${++tableNumber}`),
    });

    const copy = (await lineOf(a.billId, "Tarta")).groupId!;
    expect(copy).not.toBe(source);
    const shown = await shownGroup(first.partyId!, copy);
    expect(shown.sentAt).toBe(held);
    expect(shown.sentBy).toBe(before.sentBy);

    const second = await moveWholeBill(a.billId, first.partyId!, {
      tableId: await v.table(`Copy ${++tableNumber}`),
    });

    const again = (await lineOf(a.billId, "Tarta")).groupId!;
    expect(again).not.toBe(copy);
    expect((await shownGroup(second.partyId!, again)).sentAt).toBe(held);
  });

  it("A803 waiting copy: Split a table: the copy shows the time its source was held", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    const source = (await lineOf(a.billId, "Tarta")).groupId!;
    const held = minutesAgo(20);
    await backdateGroup(source, held);
    const before = await shownGroup(a.partyId, source);
    expect(before.sentAt).toBe(held);

    const split = await splitToNewTable(a.partyId, a.billId);

    const copy = (await lineOf(a.billId, "Tarta")).groupId!;
    expect(copy).not.toBe(source);
    const shown = await shownGroup(split.partyId, copy);
    expect(shown.sentAt).toBe(held);
    expect(shown.sentBy).toBe(before.sentBy);
  });

  it("A803 waiting copy: the copy's number and position at the other table still come after the groups there", async () => {
    const a = await seatWith([{ names: ["Tarta"], release: "hold" }]);
    await backdateGroup((await lineOf(a.billId, "Tarta")).groupId!, minutesAgo(20));
    const tableId = await v.table(`Copy ${++tableNumber}`);
    const { partyId } = await seat(v, tableId);
    await orderForParty(v, partyId, ["Water"]);

    await moveWholeBill(a.billId, a.partyId, { tableId });

    const copy = (await lineOf(a.billId, "Tarta")).groupId!;
    const groups = await groupsOf(partyId);
    expect(groups.at(-1)!.id).toBe(copy);
    expect(groups.at(-1)!.displayNumber).toBe(groups.length);
    const { groups: shown } = await inTx(v, (tx) => readCurrentOrders(tx, partyId));
    expect(shown.at(-1)!.id).toBe(copy);
  });

  it("A803 waiting copy: the pass's held column ranks a party by its oldest group, so a copy brings its source's age with it", async () => {
    const t = await paperTable(false);
    await backdateGroup(t.g, minutesAgo(20));
    const older = await seatWith([{ names: ["Flan"], release: "hold" }]);
    const olderGroup = (await lineOf(older.billId, "Flan")).groupId!;
    await backdateGroup(olderGroup, minutesAgo(10));
    const later = await seatWith([{ names: ["Flan"], release: "hold" }]);
    const laterGroup = (await lineOf(later.billId, "Flan")).groupId!;
    const heldOrder = async (ids: string[]) => {
      const board = await inTx(v, (tx) =>
        readScopedPassBoard(tx, { stationIds: [t.grill.id, t.pastry.id], zoneIds: null }),
      );
      return board.held
        .map((card) => (card.target.kind === "group" ? card.target.groupId : null))
        .filter((id) => id !== null && ids.includes(id));
    };
    expect(await heldOrder([olderGroup, laterGroup])).toEqual([olderGroup, laterGroup]);

    await moveWholeBill(t.bill2, t.partyId, { tableId: await tableOf(later.partyId) });

    const copy = (await lineOf(t.bill2, "Tarta")).groupId!;
    expect(await heldOrder([olderGroup, laterGroup, copy])).toEqual([laterGroup, copy, olderGroup]);
  });
});
