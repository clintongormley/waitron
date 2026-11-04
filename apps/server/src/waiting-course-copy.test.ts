import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  orderGroupEvents,
  orderGroupHoldStations,
  orderGroups,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { setRoutingCell } from "@waitron/venue-service";
import { createCourse, createStation } from "./kitchen.js";
import { copyHeldGroups, snoozeReminder } from "./order-groups.js";
import { saveDraft } from "./order-drafts.js";
import { insertPartyBill } from "./parties.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { attachPrinterToStation } from "./station-printers.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  readChangesAfterSending,
  setChangesAfterSending,
} from "./testing/changes-after-sending.js";
import { setStationPrinting } from "./testing/station-printing.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  orderForParty,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

const MOVER = "cccccccc-0000-4000-8000-000000000002";

let v: PartyVenue;
let postres: string;

// `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    postres = await inTx(v, async (tx) => {
      await createCourse(tx, { name: "Entrantes", displayOrder: 1 });
      await createCourse(tx, { name: "Principales", displayOrder: 2 });
      return (await createCourse(tx, { name: "Postres", displayOrder: 3 })).id;
    });
  },
});

let tableNumber = 0;

type Release = "fire" | "hold";

/** A seated party whose first bill holds `groups`, each placed as one group, in order. */
async function seatWith(groups: { names: string[]; release: Release }[]) {
  const seated = await seat(v, await v.table(`Copy ${++tableNumber}`));
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, seated.partyId, {
      groups: groups.map((group) => ({
        release: group.release,
        lines: group.names.map((name) => ({
          menuItemId: v.item(name),
          quantity: "1",
          courseId: postres,
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

async function copy(billId: string, from: string, to: string, lineIds: string[]) {
  return inTx(v, async (tx) => {
    await reseatBill(tx, billId, to);
    return copyHeldGroups(tx, from, to, lineIds, MOVER);
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

const adminId = () =>
  v.db.all<{ id: string }>(sql`select id from persons where role = 'admin'`)[0]!.id;

describe("A803 waiting copy: copyHeldGroups", () => {
  it("A803 waiting copy: copyHeldGroups copies a held group shared by a leaving and a staying bill, moving only the leaving dish and its extras", async () => {
    const a = await seatWith([{ names: ["Flan", "Tarta"], release: "hold" }]);
    const flan = await lineOf(a.billId, "Flan");
    const g = flan.groupId!;
    const bill2 = await moveToNewBill(a.partyId, a.billId, [(await lineOf(a.billId, "Tarta")).id]);
    const tarta = await lineOf(bill2, "Tarta");
    const extra = await addExtra(bill2, tarta.id);
    const b = await otherParty();
    const [bFired] = await groupsOf(b);
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
    expect((await groupsOf(b)).map((group) => [group.id, group.position, group.state])).toEqual([
      [bFired!.id, bFired!.position, "fired"],
      [copies.get(g2), bFired!.position + 1, "held"],
      [copies.get(g3), bFired!.position + 2, "held"],
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

  it("A803 waiting copy: copyHeldGroups ignores a recalled dish, a dish of a fired group and an extras line it is given", async () => {
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
    const b = await otherParty();
    const linesBefore = await linesOf(a.billId);
    const bGroupsBefore = await groupsOf(b);

    const copies = await copy(a.billId, a.partyId, b, [burger.id, paella.id, extra]);

    expect([...copies]).toEqual([]);
    expect(await linesOf(a.billId)).toEqual(linesBefore);
    expect(await groupsOf(b)).toEqual(bGroupsBefore);
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
