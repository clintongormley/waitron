import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  lineServiceCancellations,
  orderGroups,
  parties,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell, writeReleaseReminderMinutes } from "@waitron/venue-service";
import { fireGroup, placeGroups, readCurrentOrders, readReleaseReminders } from "./order-groups.js";
import { createStation } from "./kitchen.js";
import { recallToDraft } from "./draft-recall.js";
import {
  fireableLineColumns,
  fireLines,
  fireOrderLines,
  markGroupServed,
  markServed,
  ordersWithUnfiredDish,
  unmarkServed,
  unsentDishLines,
} from "./working-order.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

const AT = "2026-10-17T09:00:00.000Z";
let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: "Extra station" });
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    });
  },
});

async function fixture(quantity = 3, cancelled = 2) {
  const order = await billWith(venue, [{ name: "Pizza", quantity: String(quantity), olives: 2 }]);
  return inTx(venue, async (tx) => {
    const rows = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo);
    const parent = rows[0]!;
    await tx.insert(lineServiceCancellations).values({
      lineId: parent.id,
      quantity: cancelled * 1000,
      cancelledAt: AT,
      wasStarted: true,
      actorId: venue.staffId,
    });
    for (const row of rows) {
      if (quantity === cancelled) {
        await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, row.id));
      } else {
        await tx
          .update(ticketItems)
          .set({ quantity: (quantity - cancelled) * (row.parentLineId === null ? 1000 : 2000) })
          .where(eq(ticketItems.workingOrderLineId, row.id));
      }
    }
    return { ...order, parent };
  });
}

async function args(partyId: string, submissionId = randomUUID()) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return { expectedPartyRevision: party!.revision, operatorId: venue.staffId, submissionId };
}

async function rows(billId: string) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

describe("serving with charged cancellations", () => {
  it.each([1, 3])(
    "refuses Recall of a family carrying %s cancelled dishes without changing its bill or party",
    async (cancelled) => {
      const order = await fixture(3, cancelled);
      const before = await rows(order.billId);
      const command = await args(order.partyId);
      await expect(
        inTx(venue, async (tx) =>
          recallToDraft(tx, venue.cfg, order.partyId, order.parent.id, {
            ...command,
            expectedEdit: await readBillEditState(tx, order.billId),
          }),
        ),
      ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "lineId" } });
      expect(await rows(order.billId)).toEqual(before);
      expect((await args(order.partyId)).expectedPartyRevision).toBe(command.expectedPartyRevision);
    },
  );

  it("dates completion of the one active dish and its two extras without changing billed quantities", async () => {
    const order = await fixture();
    const command = await args(order.partyId);
    await inTx(venue, (tx) =>
      markServed(
        tx,
        venue.cfg,
        order.partyId,
        [{ lineId: order.parent.id, quantity: "1" }],
        command,
      ),
    );
    const after = await rows(order.billId);
    expect(
      after.map(({ quantity, servedQuantity, lineTotal }) => ({
        quantity,
        servedQuantity,
        lineTotal,
      })),
    ).toEqual([
      { quantity: 3000, servedQuantity: 1000, lineTotal: 2700 },
      { quantity: 6000, servedQuantity: 2000, lineTotal: 900 },
    ]);
    expect(after[0]!.servedAt).toEqual(expect.any(String));
    expect(after[1]!.servedAt).toBe(after[0]!.servedAt);
    expect(
      await inTx(venue, (tx) =>
        markServed(
          tx,
          venue.cfg,
          order.partyId,
          [{ lineId: order.parent.id, quantity: "1" }],
          command,
        ),
      ),
    ).toEqual({ revision: command.expectedPartyRevision + 1 });
    expect(await rows(order.billId)).toEqual(after);
  });

  it("refuses a serving that would consume cancelled food and rolls back the party revision", async () => {
    const order = await fixture();
    const before = await rows(order.billId);
    const command = await args(order.partyId);
    await expect(
      inTx(venue, (tx) =>
        markServed(
          tx,
          venue.cfg,
          order.partyId,
          [{ lineId: order.parent.id, quantity: "2" }],
          command,
        ),
      ),
    ).rejects.toMatchObject({ code: "tab.serve_quantity_invalid" });
    expect(await rows(order.billId)).toEqual(before);
    expect((await args(order.partyId)).expectedPartyRevision).toBe(command.expectedPartyRevision);
  });

  it("serves only active food when the entire group is marked served", async () => {
    const order = await fixture();
    const command = await args(order.partyId);
    await inTx(venue, (tx) =>
      markGroupServed(tx, venue.cfg, order.partyId, order.parent.groupId!, command),
    );
    const after = await rows(order.billId);
    expect(after.map((row) => row.servedQuantity)).toEqual([1000, 2000]);
    expect(after[0]!.servedAt).toEqual(expect.any(String));
  });

  it("cannot turn a fully cancelled dish into served food or undo its cancellation", async () => {
    const order = await fixture(2, 2);
    for (const change of [markServed, unmarkServed]) {
      const command = await args(order.partyId);
      await expect(
        inTx(venue, (tx) =>
          change(
            tx,
            venue.cfg,
            order.partyId,
            [{ lineId: order.parent.id, quantity: "1" }],
            command,
          ),
        ),
      ).rejects.toMatchObject({ code: "tab.serve_quantity_invalid" });
    }
    expect((await rows(order.billId)).map((row) => [row.servedQuantity, row.servedAt])).toEqual([
      [0, null],
      [0, null],
    ]);
    expect(
      (
        await venue.db
          .select()
          .from(lineServiceCancellations)
          .where(eq(lineServiceCancellations.lineId, order.parent.id))
      )[0]!.quantity,
    ).toBe(2000);
  });

  it("undoes physical serving without restoring cancelled food or changing its financial rows", async () => {
    const order = await fixture();
    await inTx(venue, async (tx) => {
      const family = await rows(order.billId);
      for (const row of family)
        await tx
          .update(workingOrderLines)
          .set({ servedQuantity: row.parentLineId === null ? 1000 : 2000, servedAt: AT })
          .where(eq(workingOrderLines.id, row.id));
    });
    const command = await args(order.partyId);
    await inTx(venue, (tx) =>
      unmarkServed(
        tx,
        venue.cfg,
        order.partyId,
        [{ lineId: order.parent.id, quantity: "1" }],
        command,
      ),
    );
    expect(
      (await rows(order.billId)).map((row) => [
        row.quantity,
        row.servedQuantity,
        row.servedAt,
        row.lineTotal,
      ]),
    ).toEqual([
      [3000, 0, null, 2700],
      [6000, 0, null, 900],
    ]);
    const next = await args(order.partyId);
    await expect(
      inTx(venue, (tx) =>
        markServed(
          tx,
          venue.cfg,
          order.partyId,
          [{ lineId: order.parent.id, quantity: "2" }],
          next,
        ),
      ),
    ).rejects.toMatchObject({ code: "tab.serve_quantity_invalid" });
  });
});

describe("firing with charged cancellations", () => {
  it.each([
    { cancelled: 2, want: [1000, 2000] },
    { cancelled: 3, want: [] },
  ])(
    "creates only active kitchen quantities with $cancelled dishes cancelled",
    async ({ cancelled, want }) => {
      const order = await fixture(3, cancelled);
      await inTx(venue, async (tx) => {
        const family = await tx
          .select(fireableLineColumns)
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, order.billId));
        for (const line of family)
          await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, line.id));
        await fireLines(tx, venue.cfg, order.billId, family);
      });
      const tickets = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, order.billId));
      expect(tickets.map((row) => row.quantity).sort((a, b) => a! - b!)).toEqual(want);
      expect((await rows(order.billId)).map((row) => [row.quantity, row.lineTotal])).toEqual([
        [3000, 2700],
        [6000, 900],
      ]);
    },
  );

  it("refuses a direct group Fire when only cancelled charges remain, preserving its revision and held state", async () => {
    const order = await fixture(2, 2);
    await inTx(venue, (tx) =>
      tx
        .update(orderGroups)
        .set({ state: "held", firedAt: null })
        .where(eq(orderGroups.id, order.parent.groupId!)),
    );
    const command = await args(order.partyId);
    await expect(
      inTx(venue, (tx) => fireGroup(tx, venue.cfg, order.partyId, order.parent.groupId!, command)),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "groupId" } });
    expect((await args(order.partyId)).expectedPartyRevision).toBe(command.expectedPartyRevision);
    expect(
      (
        await venue.db.select().from(orderGroups).where(eq(orderGroups.id, order.parent.groupId!))
      )[0]!.state,
    ).toBe("held");
  });

  it("does not let fully cancelled held food block an order as unfired work", async () => {
    const order = await fixture(2, 2);
    await inTx(venue, (tx) =>
      tx
        .update(orderGroups)
        .set({ state: "held", firedAt: null })
        .where(eq(orderGroups.id, order.parent.groupId!)),
    );
    expect(await inTx(venue, (tx) => ordersWithUnfiredDish(tx, [order.billId]))).toEqual(new Set());
  });

  it("does not release a cancelled no-preparation dish even when a legacy line Fire names it", async () => {
    const order = await billWith(venue, [{ name: "Coffee", quantity: "2" }], { release: "hold" });
    const [parent] = await rows(order.billId);
    await inTx(venue, async (tx) => {
      await tx.insert(lineServiceCancellations).values({
        lineId: parent!.id,
        quantity: 2000,
        cancelledAt: AT,
        wasStarted: false,
        actorId: venue.staffId,
      });
      await fireOrderLines(tx, venue.cfg, order.billId, [parent!.id]);
    });
    expect((await rows(order.billId))[0]!.sentAt).toBeNull();
  });

  it("omits cancelled no-preparation food from the unsent-work read", async () => {
    const order = await billWith(venue, [{ name: "Coffee", quantity: "2" }], { release: "hold" });
    const [parent] = await rows(order.billId);
    await inTx(venue, (tx) =>
      tx.insert(lineServiceCancellations).values({
        lineId: parent!.id,
        quantity: 2000,
        cancelledAt: AT,
        wasStarted: false,
        actorId: venue.staffId,
      }),
    );
    expect(await inTx(venue, (tx) => unsentDishLines(tx, order.billId))).toEqual([]);
  });
});

describe("charged cancellation release completion", () => {
  it.each([
    { served: 0, servedAt: null, want: null },
    { served: 1000, servedAt: "2026-10-17T08:50:00.000Z", want: "2026-10-17T09:10:00.000Z" },
    { served: 1000, servedAt: "2026-10-17T09:15:00.000Z", want: "2026-10-17T09:25:00.000Z" },
    { served: 1000, servedAt: null, want: "2026-10-17T09:10:00.000Z" },
  ])(
    "dates a mixed family with $served served at $servedAt",
    async ({ served, servedAt, want }) => {
      const order = await fixture();
      const held = await inTx(venue, async (tx) => {
        await writeReleaseReminderMinutes(tx, 10);
        await tx
          .update(workingOrderLines)
          .set({ servedQuantity: served, servedAt })
          .where(eq(workingOrderLines.id, order.parent.id));
        return placeGroups(tx, venue.cfg, order.partyId, {
          operatorId: venue.staffId,
          billId: order.billId,
          groups: [
            { release: "hold", lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }] },
          ],
        });
      });
      const expected = { groupId: held.groups[0]!.id, dueAt: want };
      expect((await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId))).reminder).toEqual(
        expected,
      );
      expect(
        (await inTx(venue, (tx) => readReleaseReminders(tx, [order.partyId]))).get(order.partyId),
      ).toEqual(expected);
    },
  );

  it("uses the full cancellation time for both floor and Current orders reminders without fabricating serving", async () => {
    const order = await fixture(2, 2);
    const held = await inTx(venue, async (tx) => {
      await writeReleaseReminderMinutes(tx, 10);
      return placeGroups(tx, venue.cfg, order.partyId, {
        operatorId: venue.staffId,
        billId: order.billId,
        groups: [{ release: "hold", lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }] }],
      });
    });
    const want = { groupId: held.groups[0]!.id, dueAt: "2026-10-17T09:10:00.000Z" };
    expect((await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId))).reminder).toEqual(
      want,
    );
    expect(
      (await inTx(venue, (tx) => readReleaseReminders(tx, [order.partyId]))).get(order.partyId),
    ).toEqual(want);
    expect(
      (await rows(order.billId)).slice(0, 2).map((row) => [row.servedQuantity, row.servedAt]),
    ).toEqual([
      [0, null],
      [0, null],
    ]);
  });
});
