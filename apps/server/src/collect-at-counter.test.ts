import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderGroupEvents,
  orderGroups,
  parties,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { readBillEditState } from "./bill-editing.js";
import { splitBill } from "./bill-actions.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem } from "./line-cancel.js";
import { releaseHeldWorkOf } from "./order-groups.js";
import { seatTable } from "./parties.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { createTable } from "./testing/live-table.js";
import { printedLines } from "./testing/decode-ticket.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  billWith,
  inTx,
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

async function lastJobId() {
  const jobs = await venue.db.select({ id: printJobs.id }).from(printJobs);
  return jobs.reduce((max, job) => (job.id > max ? job.id : max), "");
}

async function jobsAfter(id: string) {
  const jobs = await venue.db
    .select({ id: printJobs.id, payload: printJobs.payload })
    .from(printJobs)
    .where(gt(printJobs.id, id))
    .orderBy(printJobs.id);
  return jobs.map((job) => printedLines(job.payload));
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
  await pay(p.billId, "24.00");
  return p;
}

async function cancelKeepingCharge(partyId: string, billId: string) {
  const [line] = await topLines([billId]);
  await inTx(venue, async (tx) => {
    const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
    await cancelItem(
      tx,
      venue.cfg,
      partyId,
      line!.id,
      {
        expectedEdit: await readBillEditState(tx, billId),
        expectedContext: await readCancellationContext(tx, partyId, line!.id),
        expectedPartyRevision: await partyRevision(partyId),
        expectedBillRevision: bill!.revision,
        submissionId: randomUUID(),
        quantity: (line!.quantity / 1000).toFixed(3),
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
    const before = await lastJobId();

    await release(p.partyId, [p.billId]);

    const tickets = await ticketsOf([p.billId]);
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((item) => item.firedAt !== null)).toBe(true);
    expect((await groupsOf(p.partyId)).map((group) => group.state)).toEqual(["fired"]);
    const jobs = await jobsAfter(before);
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

    expect((await topLines([p.billId])).map((line) => line.groupId)).toEqual([null]);
    expect((await groupsOf(p.partyId)).map((group) => group.state)).toEqual(["removed"]);
  });

  it("leaves a fired group alone", async () => {
    const p = await billWith(venue, [{ name: "Burger", quantity: "2" }], { release: "fire" });
    await pay(p.billId, "24.00");
    const groups = await groupsOf(p.partyId);
    const events = await venue.db
      .select()
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.partyId, p.partyId));
    const before = await lastJobId();

    await release(p.partyId, [p.billId]);

    expect(await groupsOf(p.partyId)).toEqual(groups);
    expect(
      await venue.db.select().from(orderGroupEvents).where(eq(orderGroupEvents.partyId, p.partyId)),
    ).toEqual(events);
    expect(await jobsAfter(before)).toEqual([]);
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
