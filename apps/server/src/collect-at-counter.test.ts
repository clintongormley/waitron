import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDraftRecalledLines,
  orderDrafts,
  orderGroupEvents,
  orderGroups,
  parties,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPrinter } from "@waitron/printing";
import { kitchenNotices, setRoutingCell } from "@waitron/venue-service";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { splitBill } from "./bill-actions.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem } from "./line-cancel.js";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill, moveSettledBillToCounter } from "./move-bill.js";
import { recordHeldPaper, releaseHeldWorkOf } from "./order-groups.js";
import { seatTable } from "./parties.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { createTable } from "./testing/live-table.js";
import { printedLines } from "./testing/decode-ticket.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

async function pay(billId: string, amount: string) {
  await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
    id: billId,
    tender: { method: "cash", amount },
    lines: [],
  });
}

async function partyRevision(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return party!.revision;
}

async function groupsOf(partyId: string) {
  return venue.db.select().from(orderGroups).where(eq(orderGroups.partyId, partyId));
}

async function topLines(billIds: string[]) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, billIds),
        isNull(workingOrderLines.parentLineId),
      ),
    );
}

async function ticketsOf(billIds: string[]) {
  return venue.db.select().from(ticketItems).where(inArray(ticketItems.workingOrderId, billIds));
}

/** Print job ids are random, so the jobs since a point are told by rowid. */
function lastJobRow() {
  return (
    venue.db.all<{ row: number | null }>(sql`select max(rowid) as row from print_jobs`)[0]!.row ?? 0
  );
}

function jobsByPrinterAfter(row: number) {
  return venue.db
    .all<{ printerId: string; payload: Uint8Array }>(
      sql`select printer_id as printerId, payload from print_jobs where rowid > ${row} order by rowid`,
    )
    .map((job) => ({ printerId: job.printerId, lines: printedLines(job.payload) }));
}

const release = (
  partyId: string,
  billIds: string[],
  attendance?: Parameters<typeof releaseHeldWorkOf>[5],
) =>
  inTx(venue, (tx: Transaction) =>
    releaseHeldWorkOf(tx, venue.cfg, partyId, billIds, venue.staffId, attendance),
  );

/** A paid bill of two Burgers in one held group, its HOLD ticket marked printed. */
async function paidHeld() {
  const p = await billWith(venue, [{ name: "Burger", quantity: "2" }], { release: "hold" });
  await venue.db
    .update(orderGroups)
    .set({ holdPrintedAt: new Date().toISOString() })
    .where(eq(orderGroups.partyId, p.partyId));
  await inTx(venue, async (tx) => {
    const held = await tx
      .selectDistinct({ groupId: orderGroups.id, stationId: ticketItems.stationId })
      .from(orderGroups)
      .innerJoin(workingOrderLines, eq(workingOrderLines.groupId, orderGroups.id))
      .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(eq(orderGroups.partyId, p.partyId));
    for (const { groupId, stationId } of held)
      await recordHeldPaper(tx, groupId, new Set([stationId!]));
  });
  await pay(p.billId, "24.00");
  return p;
}

async function cancelKeepingCharge(partyId: string, billId: string) {
  for (const line of await topLines([billId]))
    await inTx(venue, async (tx) => {
      const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
      await cancelItem(
        tx,
        venue.cfg,
        partyId,
        line.id,
        {
          expectedEdit: await readBillEditState(tx, billId),
          expectedContext: await readCancellationContext(tx, partyId, line.id),
          expectedPartyRevision: await partyRevision(partyId),
          expectedBillRevision: bill!.revision,
          submissionId: randomUUID(),
          quantity: (line.quantity / 1000).toFixed(3),
          outcome: "keep_charge",
          reasonId: venue.reasonId.houseVoid,
        },
        venue.staffId,
      );
    });
}

describe("releaseHeldWorkOf", () => {
  it("fires a paid bill's held group", async () => {
    const p = await paidHeld();
    const before = lastJobRow();

    await release(p.partyId, [p.billId]);

    const tickets = await ticketsOf([p.billId]);
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((item) => item.firedAt !== null)).toBe(true);
    expect((await groupsOf(p.partyId)).map((group) => group.state)).toEqual(["fired"]);
    const jobs = jobsByPrinterAfter(before).map((job) => job.lines);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]![0]).toBe("*** FIRE ***");
    expect(jobs[0]!.join("\n")).toContain("2.000 x BURG");
  });

  it("fires a group shared by two bills once", async () => {
    const p = await billWith(venue, [{ name: "Burger", quantity: "2" }], { release: "hold" });
    const split = await inTx(venue, async (tx) =>
      splitBill(tx, venue.cfg, p.billId, [{ lineNo: 1, quantity: "1" }], {
        operatorId: venue.staffId,
        partyId: p.partyId,
        expectedPartyRevision: await partyRevision(p.partyId),
        expectedEdit: await readBillEditState(tx, p.billId),
      }),
    );
    const lines = await topLines([p.billId, split.billId]);
    expect(new Set(lines.map((line) => line.groupId)).size).toBe(1);
    await pay(p.billId, "12.00");
    await pay(split.billId, "12.00");

    await release(p.partyId, [p.billId, split.billId]);

    const events = await venue.db
      .select()
      .from(orderGroupEvents)
      .where(and(eq(orderGroupEvents.partyId, p.partyId), eq(orderGroupEvents.kind, "fired")));
    expect(events).toHaveLength(1);
    const tickets = await ticketsOf([p.billId, split.billId]);
    expect(new Set(tickets.map((item) => item.workingOrderId))).toEqual(
      new Set([p.billId, split.billId]),
    );
    expect(tickets.every((item) => item.firedAt !== null)).toBe(true);
  });

  it("removes a held group whose every line was cancelled with its charge kept", async () => {
    const p = await paidHeld();
    await cancelKeepingCharge(p.partyId, p.billId);

    await release(p.partyId, [p.billId]);

    // Each portion is its own line (A803).
    expect((await topLines([p.billId])).map((line) => line.groupId)).toEqual([null, null]);
    expect((await groupsOf(p.partyId)).map((group) => group.state)).toEqual(["removed"]);
  });

  it("keeps a held group, and its line on another bill, that still holds a recalled dish", async () => {
    const p = await billWith(venue, [{ name: "Burger", quantity: "2" }], { release: "hold" });
    const split = await inTx(venue, async (tx) =>
      splitBill(tx, venue.cfg, p.billId, [{ lineNo: 1, quantity: "1" }], {
        operatorId: venue.staffId,
        partyId: p.partyId,
        expectedPartyRevision: await partyRevision(p.partyId),
        expectedEdit: await readBillEditState(tx, p.billId),
      }),
    );
    await pay(p.billId, "12.00");
    await cancelKeepingCharge(p.partyId, p.billId);
    const [recalled] = await topLines([split.billId]);
    const [draft] = await venue.db
      .insert(orderDrafts)
      .values({ partyId: p.partyId, billId: split.billId, ownerId: venue.staffId, revision: 1 })
      .returning();
    await venue.db
      .insert(orderDraftRecalledLines)
      .values({ draftId: draft!.id, sourceLineId: recalled!.id, position: 1 });

    await release(p.partyId, [p.billId]);

    expect((await topLines([p.billId])).map((line) => line.groupId)).toEqual([null]);
    expect((await topLines([split.billId])).map((line) => line.groupId)).toEqual([
      recalled!.groupId,
    ]);
    expect((await groupsOf(p.partyId)).map((group) => group.state)).toEqual(["held"]);
  });

  it("leaves a fired group alone", async () => {
    const p = await billWith(venue, [{ name: "Burger", quantity: "2" }], { release: "fire" });
    await pay(p.billId, "24.00");
    const groups = await groupsOf(p.partyId);
    const events = await venue.db
      .select()
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.partyId, p.partyId));
    const before = lastJobRow();

    await release(p.partyId, [p.billId]);

    expect(await groupsOf(p.partyId)).toEqual(groups);
    expect(
      await venue.db.select().from(orderGroupEvents).where(eq(orderGroupEvents.partyId, p.partyId)),
    ).toEqual(events);
    expect(jobsByPrinterAfter(before)).toEqual([]);
  });

  it("refuses with the release's own refusal", async () => {
    const p = await paidHeld();
    // Combining with a party that never answered the allergy question leaves it unanswered.
    await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.tables.zoneId,
      });
      const seated = await seatTable(tx, venue.cfg, {
        tableId: table.id,
        guestCount: null,
        operatorId: venue.staffId,
      });
      await combineParties(tx, venue.cfg, {
        from: seated.partyId,
        into: p.partyId,
        bills: "separate",
        tables: "join",
        operatorId: venue.staffId,
      });
    });

    await expect(release(p.partyId, [p.billId])).rejects.toMatchObject({
      code: "allergy.unanswered",
    });
    expect((await groupsOf(p.partyId)).map((group) => group.state)).toEqual(["held"]);
  });

  it("records the release in the working-time facts", async () => {
    const attendance = { recorder: recordAttendanceFact, clock: venue.clock };
    const fired = await paidHeld();
    const removed = await paidHeld();
    await cancelKeepingCharge(removed.partyId, removed.billId);

    await release(fired.partyId, [fired.billId], attendance);
    await release(removed.partyId, [removed.billId], attendance);

    const events = await venue.db
      .select()
      .from(orderGroupEvents)
      .where(
        and(
          inArray(orderGroupEvents.partyId, [fired.partyId, removed.partyId]),
          inArray(orderGroupEvents.kind, ["fired", "removed"]),
        ),
      );
    expect(events.map((event) => [event.partyId, event.kind]).sort()).toEqual(
      [
        [fired.partyId, "fired"],
        [removed.partyId, "removed"],
      ].sort(),
    );
    const facts = await venue.db
      .select()
      .from(attendanceOperationFacts)
      .where(
        inArray(
          attendanceOperationFacts.key,
          events.map((event) => `group:${event.id}`),
        ),
      );
    expect(facts.map((fact) => [fact.key, fact.personId, fact.locationId]).sort()).toEqual(
      events.map((event) => [`group:${event.id}`, venue.staffId, venue.cfg.locationId]).sort(),
    );
  });
});

/** A second station, Salads, with a printer of its own, preparing the Salad; made once. */
let salads: Promise<{ stationId: string; printerId: string }> | undefined;
function saladStation() {
  salads ??= inTx(venue, async (tx) => {
    const printer = await createPrinter(
      tx,
      { locationId: venue.cfg.locationId },
      { name: "Fríos", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    const station = await createStation(tx, venue.cfg, {
      name: "Salads",
      printerIds: [printer.id],
    });
    const [salad] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, "Salad"));
    await setRoutingCell(
      tx,
      venue.cfg,
      { row: { kind: "product", productId: salad!.id }, zoneId: null },
      { kind: "station", stationId: station.id },
    );
    return { stationId: station.id, printerId: printer.id };
  });
  return salads;
}

async function orderRow(billId: string) {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return order!;
}

async function zoneOf(billId: string) {
  return inTx(venue, async (tx) =>
    (await VENUE_SERVICE.findOrderZones(tx, venue.cfg, [billId])).get(billId),
  );
}

async function serve(billId: string, lineNo: number) {
  const id = await lineIdOf(venue, billId, lineNo);
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, id));
  await venue.db
    .update(workingOrderLines)
    .set({ servedQuantity: line!.quantity })
    .where(eq(workingOrderLines.id, id));
}

async function noticesOn(billId: string) {
  const rows = await venue.db
    .select({
      stationId: kitchenNotices.stationId,
      kind: kitchenNotices.kind,
      lineName: kitchenNotices.lineName,
      movedTo: kitchenNotices.movedTo,
    })
    .from(kitchenNotices)
    .where(eq(kitchenNotices.workingOrderId, billId));
  return rows.sort((a, b) => a.lineName.localeCompare(b.lineName));
}

const toCounter = (p: { partyId: string; billId: string }) =>
  inTx(venue, async (tx) =>
    moveSettledBillToCounter(
      tx,
      venue.cfg,
      p.billId,
      { partyId: p.partyId },
      await readBillEditState(tx, p.billId),
    ),
  );

async function paidFired(lines: { name: string; quantity?: string }[], amount: string) {
  const p = await billWith(venue, lines, { release: "fire" });
  await pay(p.billId, amount);
  return p;
}

describe("moveSettledBillToCounter", () => {
  it("moves a paid bill to the counter, changing only its party", async () => {
    const p = await paidFired([{ name: "Burger" }], "12.00");
    const before = await orderRow(p.billId);
    const zone = await zoneOf(p.billId);
    expect(zone).toBe(venue.tables.zoneId);

    await toCounter(p);

    expect(await orderRow(p.billId)).toEqual({ ...before, partyId: null });
    expect(await zoneOf(p.billId)).toBe(zone);
  });

  it("tells each station with food still to come that it went to the counter", async () => {
    const p = await paidFired([{ name: "Burger", quantity: "2" }, { name: "Steak" }], "49.00");
    const before = lastJobRow();

    await toCounter(p);

    const jobs = jobsByPrinterAfter(before);
    expect(jobs.map((job) => job.printerId)).toEqual([venue.printerId]);
    const [slip] = jobs.map((job) => job.lines);
    expect(slip![0]).toBe("*** MOVIDO ***");
    expect(slip).toContain("A:  (mostrador)");
    const text = slip!.join("\n");
    // A MOVED slip still names each line (A803 D16), and each burger is its own line.
    expect(slip!.filter((line) => line.includes("1.000 x BURG"))).toHaveLength(2);
    expect(text).not.toContain("2.000 x BURG");
    expect(text).toContain("1.000 x CHULETA");
    expect(await noticesOn(p.billId)).toEqual([
      { stationId: venue.stationId, kind: "moved", lineName: "BURG", movedTo: null },
      { stationId: venue.stationId, kind: "moved", lineName: "BURG", movedTo: null },
      { stationId: venue.stationId, kind: "moved", lineName: "CHULETA", movedTo: null },
    ]);
  });

  it("tells nothing about a served dish", async () => {
    const station = await saladStation();
    const p = await billWith(venue, [{ name: "Burger" }, { name: "Salad" }], { release: "fire" });
    expect((await ticketsOf([p.billId])).map((item) => item.stationId).sort()).toEqual(
      [venue.stationId, station.stationId].sort(),
    );
    await serve(p.billId, 2);
    await pay(p.billId, "22.00");
    const before = lastJobRow();

    await toCounter(p);

    const jobs = jobsByPrinterAfter(before);
    expect(jobs.map((job) => job.printerId)).toEqual([venue.printerId]);
    expect(jobs[0]!.lines.join("\n")).toContain("1.000 x BURG");
    expect(jobs[0]!.lines.join("\n")).not.toContain("ENSAL");
    expect(await noticesOn(p.billId)).toEqual([
      { stationId: venue.stationId, kind: "moved", lineName: "BURG", movedTo: null },
    ]);
  });

  it("tells only the station of the one dish still to come when every other dish was served", async () => {
    await saladStation();
    const p = await billWith(venue, [{ name: "Burger" }, { name: "Steak" }, { name: "Salad" }], {
      release: "fire",
    });
    await serve(p.billId, 2);
    await serve(p.billId, 3);
    await pay(p.billId, "47.00");
    const before = lastJobRow();

    await toCounter(p);

    const jobs = jobsByPrinterAfter(before);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(venue.printerId);
    const text = jobs[0]!.lines.join("\n");
    expect(text).toContain("1.000 x BURG");
    expect(text).not.toContain("CHULETA");
    expect(text).not.toContain("ENSAL");
    expect(await noticesOn(p.billId)).toEqual([
      { stationId: venue.stationId, kind: "moved", lineName: "BURG", movedTo: null },
    ]);
  });

  it("tells the kitchen about a partly served dish", async () => {
    const p = await billWith(venue, [{ name: "Burger", quantity: "2" }], {
      release: "fire",
      shape: "grouped",
    });
    await venue.db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000 })
      .where(eq(workingOrderLines.id, await lineIdOf(venue, p.billId, 1)));
    await pay(p.billId, "24.00");
    const before = lastJobRow();

    await toCounter(p);

    const jobs = jobsByPrinterAfter(before);
    expect(jobs.map((job) => job.printerId)).toEqual([venue.printerId]);
    expect(jobs[0]!.lines[0]).toBe("*** MOVIDO ***");
    expect(jobs[0]!.lines.join("\n")).toContain("2.000 x BURG");
    expect(await noticesOn(p.billId)).toEqual([
      { stationId: venue.stationId, kind: "moved", lineName: "BURG", movedTo: null },
    ]);
  });

  it("tells the kitchen nothing when every dish was served", async () => {
    const p = await billWith(venue, [{ name: "Burger" }], { release: "fire" });
    await serve(p.billId, 1);
    await pay(p.billId, "12.00");
    const before = lastJobRow();

    await toCounter(p);

    expect((await orderRow(p.billId)).partyId).toBeNull();
    expect(jobsByPrinterAfter(before)).toEqual([]);
    expect(await noticesOn(p.billId)).toEqual([]);
  });

  it("copies the party's kitchen note", async () => {
    const p = await paidFired([{ name: "Burger" }], "12.00");
    await inTx(venue, async (tx) => {
      const scope = { partyId: p.partyId };
      const notes = await VENUE_SERVICE.readKitchenNotes(tx, [scope]);
      const current = notes.get(VENUE_SERVICE.kitchenNoteKey(scope))!;
      await VENUE_SERVICE.writeKitchenNote(tx, scope, current.revision, "No salt");
    });

    await toCounter(p);

    const scope = { workingOrderId: p.billId };
    const notes = await inTx(venue, (tx) => VENUE_SERVICE.readKitchenNotes(tx, [scope]));
    expect(notes.get(VENUE_SERVICE.kitchenNoteKey(scope))!.note).toBe("No salt");
  });

  it("refuses held work", async () => {
    const p = await paidHeld();
    const order = await orderRow(p.billId);
    const groups = await groupsOf(p.partyId);
    const lines = await topLines([p.billId]);

    await expect(toCounter(p)).rejects.toMatchObject({ code: "group.held_leaves_party" });

    expect(await orderRow(p.billId)).toEqual(order);
    expect(await groupsOf(p.partyId)).toEqual(groups);
    expect(await topLines([p.billId])).toEqual(lines);
  });

  it("refuses an open bill and a collected one", async () => {
    const open = await billWith(venue, [{ name: "Burger" }], { release: "fire" });
    const collected = await paidFired([{ name: "Burger" }], "12.00");
    await venue.db
      .update(workingOrders)
      .set({ collectedAt: new Date().toISOString() })
      .where(eq(workingOrders.id, collected.billId));

    for (const p of [open, collected]) {
      const order = await orderRow(p.billId);
      await expect(toCounter(p)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "billId" },
      });
      expect(await orderRow(p.billId)).toEqual(order);
    }
  });

  it("Move this bill → The counter still refuses a paid bill", async () => {
    const p = await paidFired([{ name: "Burger" }], "12.00");
    const order = await orderRow(p.billId);

    await expect(
      inTx(venue, async (tx) =>
        moveBill(
          tx,
          venue.cfg,
          p.billId,
          { counter: { zoneId: null } },
          {
            expectedEdits: [await readBillEditState(tx, p.billId)],
            bills: "separate",
            expectedPartyRevision: await partyRevision(p.partyId),
            partyId: p.partyId,
            operatorId: venue.staffId,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "bill.paid", params: { workingOrderId: p.billId } });
    expect(await orderRow(p.billId)).toEqual(order);
  });
});
