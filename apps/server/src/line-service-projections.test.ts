import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  lineServiceCancellations,
  orderGroups,
  printJobs,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  listStationNotices,
  setRoutingCell,
  writeReleaseReminderMinutes,
} from "@waitron/venue-service";
import { createCourse, createStation } from "./kitchen.js";
import {
  correctJoin,
  listOrderGroups,
  placeGroups,
  readCurrentOrders,
  readReleaseReminders,
  snoozeReminder,
  unsnoozeReminder,
} from "./order-groups.js";
import { listExpoQueue, listStationQueue, readTabLines } from "./working-order.js";
import { printedLines } from "./testing/decode-ticket.js";
import { attachPrinterToStation } from "./station-printers.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

const AT = "2026-10-17T09:00:00.000Z";
let venue: AdjustmentVenue;
let extraStationId: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: "Extra station" });
      extraStationId = station.id;
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    });
  },
});

async function fixture(cancelled: number, release: "fire" | "hold" = "fire", served = 0) {
  const order = await billWith(venue, [{ name: "Pizza", quantity: "3", olives: 2 }], { release });
  return inTx(venue, async (tx) => {
    const family = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo);
    const parent = family[0]!;
    if (cancelled > 0)
      await tx.insert(lineServiceCancellations).values({
        lineId: parent.id,
        quantity: cancelled * 1000,
        cancelledAt: AT,
        wasStarted: false,
        actorId: venue.staffId,
      });
    for (const row of family) {
      const ratio = row.parentLineId === null ? 1 : 2;
      await tx
        .update(workingOrderLines)
        .set({
          servedQuantity: served * ratio * 1000,
          servedAt: served > 0 && served === 3 - cancelled ? AT : null,
        })
        .where(eq(workingOrderLines.id, row.id));
      if (cancelled === 3) {
        await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, row.id));
      } else {
        await tx
          .update(ticketItems)
          .set({ quantity: (3 - cancelled) * ratio * 1000 })
          .where(eq(ticketItems.workingOrderLineId, row.id));
      }
    }
    return { ...order, parent, extra: family[1]! };
  });
}

describe("charged cancellation read projections", () => {
  it.each(["hold", "fire"] as const)(
    "keeps billed dish and extra quantities separate from cancellation in %s Current orders",
    async (release) => {
      const order = await fixture(2, release);
      const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
      expect(current.groups.flatMap((group) => group.rows)).toMatchObject([
        {
          lineId: order.parent.id,
          quantity: "3.000",
          cancelledQuantity: "2.000",
          servedQuantity: "0.000",
          servedAt: null,
          released: release === "fire",
          extras: [{ lineId: order.extra.id, quantity: "6.000", cancelledQuantity: "4.000" }],
        },
      ]);
    },
  );

  it("keeps a fully cancelled charge visible without making it released or actually served", async () => {
    const order = await fixture(3);
    const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
    expect(current.groups.flatMap((group) => group.rows)).toMatchObject([
      {
        lineId: order.parent.id,
        quantity: "3.000",
        cancelledQuantity: "3.000",
        servedQuantity: "0.000",
        servedAt: null,
        released: false,
        kitchen: null,
      },
    ]);
  });

  it("does not combine actual serving with the cancelled count", async () => {
    const order = await fixture(2, "fire", 1);
    const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
    expect(current.groups.flatMap((group) => group.rows)).toMatchObject([
      { quantity: "3.000", cancelledQuantity: "2.000", servedQuantity: "1.000", servedAt: AT },
    ]);
  });

  it("returns cancelled counts on the bill read without changing its frozen financial rows", async () => {
    const order = await fixture(2);
    const before = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId));
    const lines = await inTx(venue, (tx) => readTabLines(tx, venue.cfg, order.billId));
    expect(lines).toMatchObject([
      {
        id: order.parent.id,
        quantity: "3.000",
        cancelledQuantity: "2.000",
        unitPriceGross: "9.00",
      },
      { id: order.extra.id, quantity: "6.000", cancelledQuantity: "4.000", unitPriceGross: "1.50" },
    ]);
    expect(
      await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId)),
    ).toEqual(before);
  });

  it.each([
    { cancelled: 2, summary: "1 × Pizza", hasLine: true },
    { cancelled: 3, summary: "", hasLine: false },
  ])(
    "summarises only active held work with $cancelled cancelled",
    async ({ cancelled, summary, hasLine }) => {
      const order = await fixture(cancelled, "hold");
      const groups = await inTx(venue, (tx) => listOrderGroups(tx, order.partyId));
      expect(groups.groups).toMatchObject([
        { id: order.parent.groupId, summary, lineIds: hasLine ? [order.parent.id] : [] },
      ]);
    },
  );

  it("omits cancellation metadata on ordinary food", async () => {
    const order = await fixture(0);
    const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
    const row = current.groups.flatMap((group) => group.rows)[0]!;
    expect(row).not.toHaveProperty("cancelledQuantity");
    expect(row.extras[0]).not.toHaveProperty("cancelledQuantity");
    const lines = await inTx(venue, (tx) => readTabLines(tx, venue.cfg, order.billId));
    for (const line of lines) expect(line).not.toHaveProperty("cancelledQuantity");
    expect((await inTx(venue, (tx) => listOrderGroups(tx, order.partyId))).groups).toMatchObject([
      { summary: "3 × Pizza", lineIds: [order.parent.id] },
    ]);
  });

  it("retains the course of a held group whose remaining charges are all cancelled", async () => {
    const order = await fixture(3, "hold");
    const course = await inTx(venue, async (tx) => {
      const created = await createCourse(tx, venue.cfg, {
        name: "Later mains",
        heldUntilFired: true,
      });
      await tx
        .update(workingOrderLines)
        .set({ courseId: created.id })
        .where(eq(workingOrderLines.id, order.parent.id));
      return created;
    });
    const groups = await inTx(venue, (tx) => listOrderGroups(tx, order.partyId));
    expect(groups.groups).toMatchObject([
      { id: order.parent.groupId, summary: "", lineIds: [], courseIds: [course.id] },
    ]);
  });

  it.each([2, 3])(
    "reminds about the next group with active food after %s held cancellations",
    async (cancelled) => {
      const order = await fixture(cancelled, "hold");
      const next = await inTx(venue, async (tx) => {
        await writeReleaseReminderMinutes(tx, 10);
        return placeGroups(tx, venue.cfg, order.partyId, {
          operatorId: venue.staffId,
          billId: order.billId,
          groups: [
            { release: "hold", lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }] },
          ],
        });
      });
      const want =
        cancelled === 3
          ? { groupId: next.groups[0]!.id, dueAt: "2026-10-17T09:10:00.000Z" }
          : { groupId: order.parent.groupId, dueAt: null };
      const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
      expect(current.reminder).toEqual(want);
      expect(
        (await inTx(venue, (tx) => readReleaseReminders(tx, [order.partyId]))).get(order.partyId),
      ).toEqual(want);
      const [held] = await venue.db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.id, order.parent.groupId!));
      expect(held!.state).toBe("held");
      expect(held!.firedAt).toBeNull();
    },
  );

  it("snoozes only the next active group after a fully cancelled held group", async () => {
    const order = await fixture(3, "hold");
    const next = await inTx(venue, async (tx) => {
      await writeReleaseReminderMinutes(tx, 10);
      return placeGroups(tx, venue.cfg, order.partyId, {
        operatorId: venue.staffId,
        billId: order.billId,
        groups: [{ release: "hold", lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }] }],
      });
    });
    const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
    const args = {
      submissionId: randomUUID(),
      expectedPartyRevision: current.revision,
      operatorId: venue.staffId,
    };
    const result = await inTx(venue, (tx) =>
      snoozeReminder(tx, venue.cfg, order.partyId, next.groups[0]!.id, 5, args),
    );
    expect(result).toEqual({ revision: current.revision + 1 });
    const [stored] = await venue.db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.id, next.groups[0]!.id));
    expect(stored!.remindAt).toEqual(expect.any(String));
    expect((await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId))).reminder).toEqual({
      groupId: stored!.id,
      dueAt: stored!.remindAt,
    });
    await expect(
      inTx(venue, (tx) =>
        snoozeReminder(tx, venue.cfg, order.partyId, order.parent.groupId!, 5, {
          ...args,
          submissionId: randomUUID(),
          expectedPartyRevision: result.revision,
        }),
      ),
    ).rejects.toMatchObject({ code: "group.not_waiting" });
    const cleared = await inTx(venue, (tx) =>
      unsnoozeReminder(tx, venue.cfg, order.partyId, next.groups[0]!.id, {
        ...args,
        submissionId: randomUUID(),
        expectedPartyRevision: result.revision,
      }),
    );
    expect(cleared).toEqual({ revision: result.revision + 1 });
    expect((await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId))).reminder).toEqual({
      groupId: stored!.id,
      dueAt: "2026-10-17T09:10:00.000Z",
    });
  });

  it("keeps a held group actionable when another dish in it is cancelled", async () => {
    const order = await fixture(3, "hold");
    await inTx(venue, async (tx) => {
      await writeReleaseReminderMinutes(tx, 10);
      await placeGroups(tx, venue.cfg, order.partyId, {
        operatorId: venue.staffId,
        billId: order.billId,
        joinGroupId: order.parent.groupId!,
        groups: [{ release: "hold", lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }] }],
      });
    });
    const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
    const want = { groupId: order.parent.groupId!, dueAt: null };
    expect(current.reminder).toEqual(want);
    expect(
      (await inTx(venue, (tx) => readReleaseReminders(tx, [order.partyId]))).get(order.partyId),
    ).toEqual(want);
    const groups = await inTx(venue, (tx) => listOrderGroups(tx, order.partyId));
    expect(groups.groups[0]!.summary).toBe("1 × Salad");
    expect(groups.groups[0]!.lineIds).toHaveLength(1);
    expect(groups.groups[0]!.lineIds).not.toContain(order.parent.id);
  });

  it("has no release reminder or snooze action when only cancelled held charges remain", async () => {
    const order = await fixture(3, "hold");
    await inTx(venue, (tx) => writeReleaseReminderMinutes(tx, 10));
    const current = await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId));
    expect(current.reminder).toBeNull();
    expect(
      (await inTx(venue, (tx) => readReleaseReminders(tx, [order.partyId]))).get(order.partyId),
    ).toBeNull();
    const args = {
      expectedPartyRevision: current.revision,
      submissionId: randomUUID(),
      operatorId: venue.staffId,
    };
    await expect(
      inTx(venue, (tx) =>
        snoozeReminder(tx, venue.cfg, order.partyId, order.parent.groupId!, 5, args),
      ),
    ).rejects.toMatchObject({ code: "group.not_waiting" });
    expect((await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId))).revision).toBe(
      current.revision,
    );
  });

  it.each([2, 3])("station and pass show only active food with %s cancelled", async (cancelled) => {
    const order = await fixture(cancelled);
    for (const [stationId, quantity] of [
      [venue.stationId, "1.000"],
      [extraStationId, "2.000"],
    ]) {
      const queue = await inTx(venue, (tx) => listStationQueue(tx, stationId!));
      const items = queue.filter((row) => row.orderId === order.billId).flatMap((row) => row.items);
      expect(items.map((item) => item.quantity)).toEqual(cancelled === 3 ? [] : [quantity]);
    }
    const pass = await inTx(venue, (tx) => listExpoQueue(tx, venue.cfg));
    const items = pass
      .filter((row) => row.orderId === order.billId)
      .flatMap((row) => row.groups.flatMap((group) => group.items));
    expect(items.map((item) => item.qty)).toEqual(cancelled === 3 ? [] : ["1.000", "2.000"]);
  });

  it("prints and records only the active dish and extras when joining a printed held group", async () => {
    const order = await fixture(2, "hold");
    const before = new Set(
      (await venue.db.select({ id: printJobs.id }).from(printJobs)).map((row) => row.id),
    );
    await inTx(venue, async (tx) => {
      await attachPrinterToStation(tx, {
        stationId: extraStationId,
        printerId: venue.printerId,
        locationId: venue.cfg.locationId,
      });
      await tx
        .update(orderGroups)
        .set({ holdPrintedAt: AT })
        .where(eq(orderGroups.id, order.parent.groupId!));
      await correctJoin(tx, venue.cfg, order.parent.groupId!, [order.parent.id]);
    });
    const notices = await inTx(venue, async (tx) => {
      const parentNotices = await listStationNotices(tx, venue.cfg, venue.stationId);
      const extraNotices = await listStationNotices(tx, venue.cfg, extraStationId);
      return [...parentNotices, ...extraNotices].filter(
        (notice) => notice.workingOrderId === order.billId,
      );
    });
    expect(
      notices.map((notice) => ({ quantity: notice.quantity, direction: notice.direction })),
    ).toEqual([
      { quantity: "1.000", direction: "added" },
      { quantity: "2.000", direction: "added" },
    ]);
    const jobs = (await venue.db.select().from(printJobs)).filter((row) => !before.has(row.id));
    expect(jobs).toHaveLength(2);
    expect(
      jobs.flatMap((job) => printedLines(job.payload)).filter((line) => /^\+/.test(line)),
    ).toEqual(["+1.000 x PIZZA", "+2.000 x ACEIT"]);
  });
});
