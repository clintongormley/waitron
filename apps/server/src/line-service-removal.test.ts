import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  lineServiceCancellations,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { adjustments } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  listStationNotices,
  setRoutingCell,
  writePrintHeldWork,
  writeReleaseReminderMinutes,
} from "@waitron/venue-service";
import { applyAdjustment, previewAdjustment } from "./adjustments-apply.js";
import { createStation } from "./kitchen.js";
import { placeGroups, readCurrentOrders, readReleaseReminders } from "./order-groups.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

const AT = "2026-10-17T10:00:00.000Z";
let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const extra = await createStation(tx, venue.cfg, { name: "Extra station" });
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: extra.id },
      );
    });
  },
});

async function fixture(quantity = 4, cancelled = 1, served = 0, release: "fire" | "hold" = "fire") {
  const order = await billWith(venue, [{ name: "Pizza", quantity: String(quantity), olives: 2 }], {
    release,
  });
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
        wasStarted: true,
        actorId: venue.staffId,
      });
    for (const line of family) {
      const ratio = line.parentLineId === null ? 1 : 2;
      await tx
        .update(workingOrderLines)
        .set({
          servedQuantity: served * ratio * 1000,
          servedAt: served > 0 && served === quantity - cancelled ? AT : null,
        })
        .where(eq(workingOrderLines.id, line.id));
      if (quantity === cancelled)
        await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, line.id));
      else
        await tx
          .update(ticketItems)
          .set({ quantity: (quantity - cancelled) * ratio * 1000 })
          .where(eq(ticketItems.workingOrderLineId, line.id));
    }
    return { ...order, parent, extra: family[1]! };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function snapshot(order: Fixture) {
  return inTx(venue, async (tx) => ({
    lines: await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo),
    bill: await tx.select().from(workingOrders).where(eq(workingOrders.id, order.billId)),
    party: await tx.select().from(parties).where(eq(parties.id, order.partyId)),
    cancellations: await tx
      .select()
      .from(lineServiceCancellations)
      .where(eq(lineServiceCancellations.lineId, order.parent.id)),
    tickets: await tx
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, order.billId))
      .orderBy(ticketItems.workingOrderLineId),
    jobs: await tx.select().from(printJobs).orderBy(printJobs.id),
    adjustments: await tx
      .select()
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, order.billId)),
    commands: await tx
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, order.billId)),
    notices: (await listStationNotices(tx, venue.cfg, venue.stationId)).filter(
      (notice) => notice.workingOrderId === order.billId,
    ),
  }));
}

async function ask(order: Fixture, quantity: string | undefined) {
  const [bill] = await venue.db
    .select()
    .from(workingOrders)
    .where(eq(workingOrders.id, order.billId));
  return {
    orderId: order.billId,
    expectedRevision: bill!.revision,
    lineId: order.parent.id,
    reasonId: venue.reasonId.house,
    action: "cancel" as const,
    ...(quantity === undefined ? {} : { quantity }),
    note: null,
    operatorId: venue.staffId,
    submissionId: randomUUID(),
  };
}

describe("off-bill cancellation beside charged service cancellation", () => {
  it.each(["preview", "apply"] as const)(
    "refuses %s of more than the active portion and leaves every row intact",
    async (operation) => {
      const order = await fixture(3, 2);
      const args = await ask(order, "2");
      const before = await snapshot(order);
      await expect(
        inTx(venue, async (tx) => {
          if (operation === "preview") await previewAdjustment(tx, args, venue.venueLocale);
          else await applyAdjustment(tx, venue.cfg, args, venue.venueLocale);
        }),
      ).rejects.toMatchObject({ code: "adjustment.quantity_invalid" });
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it.each([undefined, "3"])(
    "refuses removing the charged-cancelled slice with quantity %s",
    async (quantity) => {
      const order = await fixture(3, 3);
      const before = await snapshot(order);
      const args = await ask(order, quantity);
      await expect(
        inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale)),
      ).rejects.toMatchObject({ code: "adjustment.quantity_invalid" });
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it.each(["fire", "hold"] as const)(
    "reduces only active %s work and its extras while preserving the charged portion",
    async (release) => {
      const order = await fixture(4, 1, 0, release);
      const before = await snapshot(order);
      const args = await ask(order, "2");
      await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale));
      const after = await snapshot(order);
      expect(
        after.lines.map(({ id, quantity, lineTotal, servedQuantity, servedAt }) => ({
          id,
          quantity,
          lineTotal,
          servedQuantity,
          servedAt,
        })),
      ).toEqual([
        { id: order.parent.id, quantity: 2000, lineTotal: 1800, servedQuantity: 0, servedAt: null },
        { id: order.extra.id, quantity: 4000, lineTotal: 600, servedQuantity: 0, servedAt: null },
      ]);
      expect(
        after.tickets.map(({ workingOrderLineId, quantity }) => ({ workingOrderLineId, quantity })),
      ).toEqual(
        expect.arrayContaining([
          { workingOrderLineId: order.parent.id, quantity: 1000 },
          { workingOrderLineId: order.extra.id, quantity: 2000 },
        ]),
      );
      expect(after.tickets).toHaveLength(2);
      expect(after.cancellations).toEqual(before.cancellations);
      expect(after.adjustments).toHaveLength(1);
      expect(after.adjustments[0]).toMatchObject({ reduction: 2400, action: "cancel" });
      expect(after.party[0]!.revision).toBe(before.party[0]!.revision + 1);
      expect(after.bill[0]!.revision).toBe(before.bill[0]!.revision + 1);
      expect(
        await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale)),
      ).toMatchObject({ revision: after.bill[0]!.revision });
      expect(await snapshot(order)).toEqual(after);
    },
  );

  it("clamps actual serving to the active remainder rather than the still-charged bill quantity", async () => {
    const order = await fixture(4, 1, 3);
    const args = await ask(order, "2");
    await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale));
    const after = await snapshot(order);
    expect(
      after.lines.map(({ servedQuantity, servedAt }) => ({ servedQuantity, servedAt })),
    ).toEqual([
      { servedQuantity: 1000, servedAt: AT },
      { servedQuantity: 2000, servedAt: AT },
    ]);
  });

  it.each(["fire", "hold"] as const)(
    "removes all remaining %s kitchen work without deleting the cancelled charge or inventing serving",
    async (release) => {
      await inTx(venue, (tx) => writePrintHeldWork(tx, true));
      const order = await fixture(3, 2, 1, release);
      const before = await snapshot(order);
      const args = await ask(order, "1");
      await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale));
      const after = await snapshot(order);
      expect(
        after.lines.map(({ id, quantity, servedQuantity, servedAt, lineTotal }) => ({
          id,
          quantity,
          servedQuantity,
          servedAt,
          lineTotal,
        })),
      ).toEqual([
        { id: order.parent.id, quantity: 2000, servedQuantity: 0, servedAt: null, lineTotal: 1800 },
        { id: order.extra.id, quantity: 4000, servedQuantity: 0, servedAt: null, lineTotal: 600 },
      ]);
      expect(after.tickets).toEqual([]);
      expect(after.cancellations).toEqual(before.cancellations);
      expect(after.notices).toEqual([expect.objectContaining({ kind: "void", quantity: "1.000" })]);
      const newJobs = after.jobs.filter((job) => !before.jobs.some((old) => old.id === job.id));
      expect(newJobs).toHaveLength(1);
      const printed = printedLines(newJobs[0]!.payload).join("\n");
      expect(printed).toContain(release === "hold" ? "CANCEL" : "VOID");
      expect(printed).toContain("PIZZA");
      await expect(
        inTx(venue, async (tx) =>
          applyAdjustment(
            tx,
            venue.cfg,
            {
              ...args,
              submissionId: randomUUID(),
              expectedRevision: after.bill[0]!.revision,
            },
            venue.venueLocale,
          ),
        ),
      ).rejects.toMatchObject({ code: "adjustment.quantity_invalid" });
      expect(await snapshot(order)).toEqual(after);
    },
  );

  it("keeps the ordinary un-cancelled dish's proportional tickets and serving", async () => {
    const order = await fixture(4, 0, 3);
    const args = await ask(order, "2");
    await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale));
    const after = await snapshot(order);
    expect(after.cancellations).toEqual([]);
    expect(after.lines.map((line) => line.servedQuantity)).toEqual([2000, 4000]);
    expect(after.lines.every((line) => line.servedAt !== null)).toBe(true);
    expect(after.tickets.map((ticket) => ticket.quantity).sort((a, b) => a! - b!)).toEqual([
      2000, 4000,
    ]);
  });

  it.each([
    {
      served: 0,
      servedAt: null,
      dueAt: "2026-10-17T12:10:00.000Z",
      completedAt: "2026-10-17T12:00:00.000Z",
    },
    { served: 1, servedAt: AT, dueAt: "2026-10-17T10:10:00.000Z", completedAt: AT },
    {
      served: 1,
      servedAt: "2026-10-17T11:00:00.000Z",
      dueAt: "2026-10-17T11:10:00.000Z",
      completedAt: "2026-10-17T11:00:00.000Z",
    },
  ])(
    "dates the next course from service completion with $served already served at $servedAt",
    async ({ served, servedAt, dueAt, completedAt }) => {
      const order = await fixture(3, 2, served);
      const held = await inTx(venue, async (tx) => {
        if (servedAt !== null)
          await tx
            .update(workingOrderLines)
            .set({ servedAt })
            .where(eq(workingOrderLines.id, order.parent.id));
        await writeReleaseReminderMinutes(tx, 10);
        return placeGroups(tx, venue.cfg, order.partyId, {
          operatorId: venue.staffId,
          billId: order.billId,
          groups: [
            { release: "hold", lines: [{ menuItemId: venue.item("Salad"), quantity: "1" }] },
          ],
        });
      });
      const args = await ask(order, "1");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
      try {
        await inTx(venue, (tx) => applyAdjustment(tx, venue.cfg, args, venue.venueLocale));
        const expected = { groupId: held.groups[0]!.id, dueAt };
        expect((await inTx(venue, (tx) => readCurrentOrders(tx, order.partyId))).reminder).toEqual(
          expected,
        );
        expect(
          (await inTx(venue, (tx) => readReleaseReminders(tx, [order.partyId]))).get(order.partyId),
        ).toEqual(expected);
        const after = await snapshot(order);
        expect(after.lines.slice(0, 2).map((line) => [line.servedQuantity, line.servedAt])).toEqual(
          [
            [0, null],
            [0, null],
          ],
        );
        expect(after.cancellations).toEqual([
          {
            lineId: order.parent.id,
            quantity: 2000,
            cancelledAt: completedAt,
            wasStarted: true,
            actorId: venue.staffId,
          },
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
