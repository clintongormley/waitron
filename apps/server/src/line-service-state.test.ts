import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { lineServiceCancellations, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  readLineCancellations,
  serviceQuantities,
  splitLineServiceState,
} from "./line-service-state.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

const AT = "2026-10-17T09:00:00.000Z";
const SERVED_AT = "2026-10-17T09:15:00.000Z";

describe("line service quantities", () => {
  it.each([
    { quantity: 3000, served: 0, cancelled: 0, want: { active: 3000, served: 0, remaining: 3000 } },
    {
      quantity: 3000,
      served: 1000,
      cancelled: 0,
      want: { active: 3000, served: 1000, remaining: 2000 },
    },
    {
      quantity: 3000,
      served: 3000,
      cancelled: 0,
      want: { active: 3000, served: 3000, remaining: 0 },
    },
    {
      quantity: 3000,
      served: 0,
      cancelled: 2000,
      want: { active: 1000, served: 0, remaining: 1000 },
    },
    {
      quantity: 3000,
      served: 2000,
      cancelled: 2000,
      want: { active: 1000, served: 1000, remaining: 0 },
    },
    { quantity: 3000, served: 1000, cancelled: 3000, want: { active: 0, served: 0, remaining: 0 } },
    {
      quantity: 333,
      served: 100,
      cancelled: 125,
      want: { active: 208, served: 100, remaining: 108 },
    },
    {
      quantity: 1000,
      served: 1000,
      cancelled: 2000,
      want: { active: 0, served: 0, remaining: 0 },
    },
  ])(
    "counts active food from $quantity with $cancelled cancelled and $served served",
    ({ quantity, served, cancelled, want }) => {
      expect(serviceQuantities(quantity, served, cancelled)).toEqual(want);
    },
  );
});

describe("splitting charged cancellation service state", () => {
  let venue: AdjustmentVenue;
  useVenueDb({
    resetPerTest: false,
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
    setup: async (db) => {
      venue = await provisionAdjustmentVenue(db);
    },
  });

  async function fixture(quantity = 3000, cancelled = 2000, served = 0, started = true) {
    const { billId } = await billWith(venue, [
      { name: "Pizza", quantity: String(quantity / 1000), olives: 2 },
    ]);
    return inTx(venue, async (tx) => {
      const [source] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId))
        .orderBy(workingOrderLines.lineNo);
      await tx
        .update(workingOrderLines)
        .set({
          servedQuantity: served,
          servedAt: served > 0 && served === quantity - cancelled ? SERVED_AT : null,
        })
        .where(eq(workingOrderLines.id, source!.id));
      if (cancelled > 0)
        await tx.insert(lineServiceCancellations).values({
          lineId: source!.id,
          quantity: cancelled,
          cancelledAt: AT,
          wasStarted: started,
          actorId: venue.staffId,
        });
      return (
        await tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, source!.id))
      )[0]!;
    });
  }

  async function split(sourceId: string, moved: number) {
    return inTx(venue, async (tx) => {
      const [source] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, sourceId));
      const [target] = await tx
        .insert(workingOrderLines)
        .values({
          ...source!,
          id: undefined,
          lineNo: 100,
          quantity: moved,
          servedQuantity: 0,
          servedAt: null,
        })
        .returning();
      await splitLineServiceState(tx, sourceId, target!.id, moved);
      await tx
        .update(workingOrderLines)
        .set({ quantity: source!.quantity - moved })
        .where(eq(workingOrderLines.id, sourceId));
      return target!.id;
    });
  }

  async function states(ids: string[]) {
    return inTx(venue, async (tx) => {
      const cancellations = await readLineCancellations(tx, ids);
      const result = [];
      for (const id of ids) {
        const [row] = await tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, id));
        const [cancel] = await tx
          .select()
          .from(lineServiceCancellations)
          .where(eq(lineServiceCancellations.lineId, id));
        result.push({
          quantity: row!.quantity,
          served: row!.servedQuantity,
          servedAt: row!.servedAt,
          cancelled: cancellations.get(id) ?? 0,
          cancellation: cancel ?? null,
        });
      }
      return result;
    });
  }

  it("moves two cancelled dishes from three without treating them as served food", async () => {
    const source = await fixture();
    const targetId = await split(source.id, 2000);
    const [left, moved] = await states([source.id, targetId]);
    expect(left).toEqual({
      quantity: 1000,
      served: 0,
      servedAt: null,
      cancelled: 0,
      cancellation: null,
    });
    expect(moved).toEqual({
      quantity: 2000,
      served: 0,
      servedAt: null,
      cancelled: 2000,
      cancellation: {
        lineId: targetId,
        quantity: 2000,
        cancelledAt: AT,
        wasStarted: true,
        actorId: venue.staffId,
      },
    });
  });

  it("leaves complementary cancellation state and its original facts on both partial rows", async () => {
    const source = await fixture();
    const targetId = await split(source.id, 1000);
    const [left, moved] = await states([source.id, targetId]);
    expect(left).toMatchObject({
      quantity: 2000,
      cancelled: 1000,
      served: 0,
      cancellation: {
        lineId: source.id,
        quantity: 1000,
        cancelledAt: AT,
        wasStarted: true,
        actorId: venue.staffId,
      },
    });
    expect(moved).toMatchObject({
      quantity: 1000,
      cancelled: 1000,
      served: 0,
      servedAt: null,
      cancellation: {
        lineId: targetId,
        quantity: 1000,
        cancelledAt: AT,
        wasStarted: true,
        actorId: venue.staffId,
      },
    });
  });

  it("preserves a cancellation that happened before cooking started", async () => {
    const source = await fixture(3000, 2000, 0, false);
    const targetId = await split(source.id, 1000);
    const [left, moved] = await states([source.id, targetId]);
    expect(left!.cancellation).toEqual({
      lineId: source.id,
      quantity: 1000,
      cancelledAt: AT,
      wasStarted: false,
      actorId: venue.staffId,
    });
    expect(moved!.cancellation).toEqual({
      lineId: targetId,
      quantity: 1000,
      cancelledAt: AT,
      wasStarted: false,
      actorId: venue.staffId,
    });
  });

  it("keeps actual serving on the source's active food before moving any served overflow", async () => {
    const source = await fixture(4000, 1000, 3000);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedAt: SERVED_AT })
        .where(eq(workingOrderLines.id, source.id)),
    );
    const targetId = await split(source.id, 2000);
    const [left, moved] = await states([source.id, targetId]);
    expect(left).toMatchObject({ quantity: 2000, cancelled: 0, served: 2000, servedAt: SERVED_AT });
    expect(moved).toMatchObject({
      quantity: 2000,
      cancelled: 1000,
      served: 1000,
      servedAt: SERVED_AT,
    });
  });

  it("does not create cancellation records for ordinary service splits", async () => {
    const source = await fixture(3000, 0, 1000);
    const targetId = await split(source.id, 2000);
    expect(await states([source.id, targetId])).toEqual([
      {
        quantity: 1000,
        cancelled: 0,
        served: 1000,
        servedAt: expect.any(String),
        cancellation: null,
      },
      { quantity: 2000, cancelled: 0, served: 0, servedAt: null, cancellation: null },
    ]);
  });

  it("keeps a fully cancelled split out of physical serving on both rows", async () => {
    const source = await fixture(3000, 3000);
    const targetId = await split(source.id, 1000);
    const state = await states([source.id, targetId]);
    expect(
      state.map(({ quantity, cancelled, served, servedAt }) => ({
        quantity,
        cancelled,
        served,
        servedAt,
      })),
    ).toEqual([
      { quantity: 2000, cancelled: 2000, served: 0, servedAt: null },
      { quantity: 1000, cancelled: 1000, served: 0, servedAt: null },
    ]);
  });

  it("reads only requested cancellations and accepts an empty selection", async () => {
    const one = await fixture();
    const two = await fixture(3000, 1000);
    await inTx(venue, async (tx) => {
      expect(await readLineCancellations(tx, [])).toEqual(new Map());
      expect(await readLineCancellations(tx, [one.id])).toEqual(new Map([[one.id, 2000]]));
      expect(await readLineCancellations(tx, [two.id, one.id])).toEqual(
        new Map([
          [one.id, 2000],
          [two.id, 1000],
        ]),
      );
    });
  });

  it("conserves cancellation through repeated splits without inventing physical service", async () => {
    const source = await fixture(4000, 3000, 0);
    const first = await split(source.id, 1000);
    // Use a distinct target line number for the second caller-created row.
    await inTx(venue, (tx) =>
      tx.update(workingOrderLines).set({ lineNo: 101 }).where(eq(workingOrderLines.id, first)),
    );
    const second = await split(source.id, 1000);
    const state = await states([source.id, first, second]);
    expect(
      state.map(({ quantity, cancelled, served, servedAt }) => ({
        quantity,
        cancelled,
        served,
        servedAt,
      })),
    ).toEqual([
      { quantity: 2000, cancelled: 1000, served: 0, servedAt: null },
      { quantity: 1000, cancelled: 1000, served: 0, servedAt: null },
      { quantity: 1000, cancelled: 1000, served: 0, servedAt: null },
    ]);
  });

  it("changes service fields without rewriting the caller's priced rows", async () => {
    const source = await fixture();
    await inTx(venue, async (tx) => {
      const [target] = await tx
        .insert(workingOrderLines)
        .values({
          ...source,
          id: undefined,
          lineNo: 100,
          quantity: 2000,
        })
        .returning();
      const before = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, source.workingOrderId))
        .orderBy(workingOrderLines.lineNo);
      await splitLineServiceState(tx, source.id, target!.id, 2000);
      expect(
        await tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, source.workingOrderId))
          .orderBy(workingOrderLines.lineNo),
      ).toEqual(before);
    });
  });

  it("rolls back the new cancellation identity and source changes with its surrounding split", async () => {
    const source = await fixture();
    const before = await states([source.id]);
    await expect(
      inTx(venue, async (tx) => {
        const [target] = await tx
          .insert(workingOrderLines)
          .values({
            ...source,
            id: undefined,
            lineNo: 100,
            quantity: 2000,
          })
          .returning();
        await splitLineServiceState(tx, source.id, target!.id, 2000);
        throw new Error("abort the split");
      }),
    ).rejects.toThrow("abort the split");
    expect(await states([source.id])).toEqual(before);
    expect(
      await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, source.workingOrderId)),
    ).toHaveLength(2);
  });
});
