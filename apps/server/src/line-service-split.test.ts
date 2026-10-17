import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenPrintJobLines,
  lineServiceCancellations,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { readLineCancellations } from "./line-service-state.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import {
  carveOffLines,
  createOpenOrder,
  splitLinesWithinOrder,
  splitUnitsWithinOrder,
} from "./working-order.js";

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

async function fixture(
  quantity = 3,
  cancelled = 2,
  served = 0,
  stage: "hold" | "fire" | "preparing" | "ready" = "fire",
) {
  const order = await billWith(venue, [{ name: "Pizza", quantity: String(quantity), olives: 2 }], {
    release: stage === "hold" ? "hold" : "fire",
  });
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
      const perDish = row.parentLineId === null ? 1 : 2;
      await tx
        .update(workingOrderLines)
        .set({
          servedQuantity: served * perDish * 1000,
          servedAt: served > 0 && served === quantity - cancelled ? AT : null,
        })
        .where(eq(workingOrderLines.id, row.id));
      if (quantity === cancelled) {
        await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, row.id));
      } else {
        await tx
          .update(ticketItems)
          .set({
            quantity: (quantity - cancelled) * perDish * 1000,
            state: stage === "preparing" || stage === "ready" ? stage : "queued",
            preparingAt: stage === "preparing" || stage === "ready" ? AT : null,
            readyAt: stage === "ready" ? AT : null,
          })
          .where(eq(ticketItems.workingOrderLineId, row.id));
      }
    }
    return { ...order, parent, rows };
  });
}

async function emptyBill(partyId: string) {
  const id = randomUUID();
  await inTx(venue, (tx) =>
    createOpenOrder(tx, venue.cfg, id, [], null, { partyId, zoneId: venue.tables.zoneId }),
  );
  return id;
}

async function projection(billId: string) {
  return inTx(venue, async (tx) => {
    const rows = await tx
      .select({
        id: workingOrderLines.id,
        parentId: workingOrderLines.parentLineId,
        quantity: workingOrderLines.quantity,
        served: workingOrderLines.servedQuantity,
        servedAt: workingOrderLines.servedAt,
        total: workingOrderLines.lineTotal,
        ticket: ticketItems.quantity,
        state: ticketItems.state,
        firedAt: ticketItems.firedAt,
      })
      .from(workingOrderLines)
      .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo);
    const cancelled = await readLineCancellations(
      tx,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({ ...row, cancelled: cancelled.get(row.id) ?? 0 }));
  });
}

describe("financial splits with charged service cancellations", () => {
  it.each([
    { stage: "hold", state: "queued", fired: false },
    { stage: "fire", state: "queued", fired: true },
    { stage: "preparing", state: "preparing", fired: true },
    { stage: "ready", state: "ready", fired: true },
  ] as const)(
    "leaves one active dish and two extras on the $stage source when two cancelled dishes split off",
    async ({ stage, state, fired }) => {
      const order = await fixture(3, 2, 0, stage);
      const split = await inTx(venue, (tx) =>
        splitLinesWithinOrder(
          tx,
          venue.cfg,
          order.billId,
          [{ lineNo: order.parent.lineNo, quantity: "2" }],
          { splitExtras: true },
        ),
      );
      const targetId = split.get(order.parent.id)!.id;
      const rows = await projection(order.billId);
      expect(
        rows.map(({ quantity, cancelled, served, ticket }) => ({
          quantity,
          cancelled,
          served,
          ticket,
        })),
      ).toEqual([
        { quantity: 1000, cancelled: 0, served: 0, ticket: 1000 },
        { quantity: 2000, cancelled: 0, served: 0, ticket: 2000 },
        { quantity: 2000, cancelled: 2000, served: 0, ticket: null },
        { quantity: 4000, cancelled: 4000, served: 0, ticket: null },
      ]);
      expect(rows[2]!.id).toBe(targetId);
      expect(rows[3]!.parentId).toBe(targetId);
      expect(rows.map(({ total }) => total)).toEqual([900, 300, 1800, 600]);
      expect(rows.slice(0, 2).map((row) => row.state)).toEqual([state, state]);
      expect(rows.slice(0, 2).map((row) => row.firedAt !== null)).toEqual([fired, fired]);
      expect(
        await venue.db
          .select()
          .from(kitchenPrintJobLines)
          .where(
            inArray(
              kitchenPrintJobLines.workingOrderLineId,
              rows.slice(2).map((row) => row.id),
            ),
          ),
      ).toEqual([]);
    },
  );

  it("moves the cancelled financial portion to another bill without moving active kitchen work", async () => {
    const order = await fixture();
    const billId = await emptyBill(order.partyId);
    const moved = await inTx(venue, (tx) =>
      carveOffLines(
        tx,
        venue.cfg,
        order.billId,
        billId,
        [{ lineNo: order.parent.lineNo, quantity: "2" }],
        { refuseHeld: false, splitExtras: true },
      ),
    );
    expect(moved.splitFrom.size).toBe(0);
    const source = await projection(order.billId);
    const target = await projection(billId);
    expect(
      source.map(({ quantity, cancelled, ticket, total }) => ({
        quantity,
        cancelled,
        ticket,
        total,
      })),
    ).toEqual([
      { quantity: 1000, cancelled: 0, ticket: 1000, total: 900 },
      { quantity: 2000, cancelled: 0, ticket: 2000, total: 300 },
    ]);
    expect(
      target.map(({ quantity, cancelled, ticket, total }) => ({
        quantity,
        cancelled,
        ticket,
        total,
      })),
    ).toEqual([
      { quantity: 2000, cancelled: 2000, ticket: null, total: 1800 },
      { quantity: 4000, cancelled: 4000, ticket: null, total: 600 },
    ]);
  });

  it("preserves cancellation, physical serving and active tickets on a mixed moved portion", async () => {
    const order = await fixture(4, 1, 1);
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(
        tx,
        venue.cfg,
        order.billId,
        [{ lineNo: order.parent.lineNo, quantity: "3" }],
        { splitExtras: true },
      ),
    );
    const rows = await projection(order.billId);
    expect(
      rows.map(({ quantity, cancelled, served, ticket }) => ({
        quantity,
        cancelled,
        served,
        ticket,
      })),
    ).toEqual([
      { quantity: 1000, cancelled: 0, served: 1000, ticket: 1000 },
      { quantity: 2000, cancelled: 0, served: 2000, ticket: 2000 },
      { quantity: 3000, cancelled: 1000, served: 0, ticket: 2000 },
      { quantity: 6000, cancelled: 2000, served: 0, ticket: 4000 },
    ]);
    expect(rows[0]!.servedAt).toEqual(expect.any(String));
    expect(rows[1]!.servedAt).toEqual(expect.any(String));
    expect(rows.slice(2).map((row) => row.servedAt)).toEqual([null, null]);
    expect(rows.map((row) => row.total)).toEqual([900, 300, 2700, 900]);
  });

  it("keeps identities and service state when the whole family moves", async () => {
    const order = await fixture();
    const billId = await emptyBill(order.partyId);
    await inTx(venue, (tx) =>
      carveOffLines(tx, venue.cfg, order.billId, billId, [{ lineNo: order.parent.lineNo }], {
        refuseHeld: false,
        splitExtras: true,
      }),
    );
    expect(await projection(order.billId)).toEqual([]);
    const rows = await projection(billId);
    expect(rows.map((row) => row.id)).toEqual(order.rows.map((row) => row.id));
    expect(
      rows.map(({ quantity, cancelled, ticket, total }) => ({
        quantity,
        cancelled,
        ticket,
        total,
      })),
    ).toEqual([
      { quantity: 3000, cancelled: 2000, ticket: 1000, total: 2700 },
      { quantity: 6000, cancelled: 4000, ticket: 2000, total: 900 },
    ]);
  });

  it("keeps a completed active remainder while cancellation remains on the source", async () => {
    const order = await fixture(3, 2, 1);
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(
        tx,
        venue.cfg,
        order.billId,
        [{ lineNo: order.parent.lineNo, quantity: "1" }],
        { splitExtras: true },
      ),
    );
    const rows = await projection(order.billId);
    expect(
      rows.map(({ quantity, cancelled, served, ticket, servedAt }) => ({
        quantity,
        cancelled,
        served,
        ticket,
        servedAt,
      })),
    ).toEqual([
      { quantity: 2000, cancelled: 1000, served: 1000, ticket: 1000, servedAt: AT },
      { quantity: 4000, cancelled: 2000, served: 2000, ticket: 2000, servedAt: AT },
      { quantity: 1000, cancelled: 1000, served: 0, ticket: null, servedAt: null },
      { quantity: 2000, cancelled: 2000, served: 0, ticket: null, servedAt: null },
    ]);
    expect(rows.map((row) => row.total)).toEqual([1800, 600, 900, 300]);
  });

  it("splits a family with no active kitchen work without recreating any ticket", async () => {
    const order = await fixture(3, 3);
    await inTx(venue, (tx) =>
      splitLinesWithinOrder(
        tx,
        venue.cfg,
        order.billId,
        [{ lineNo: order.parent.lineNo, quantity: "2" }],
        { splitExtras: true },
      ),
    );
    const rows = await projection(order.billId);
    expect(
      rows.map(({ quantity, cancelled, served, ticket, servedAt }) => ({
        quantity,
        cancelled,
        served,
        ticket,
        servedAt,
      })),
    ).toEqual([
      { quantity: 1000, cancelled: 1000, served: 0, ticket: null, servedAt: null },
      { quantity: 2000, cancelled: 2000, served: 0, ticket: null, servedAt: null },
      { quantity: 2000, cancelled: 2000, served: 0, ticket: null, servedAt: null },
      { quantity: 4000, cancelled: 4000, served: 0, ticket: null, servedAt: null },
    ]);
  });

  it("carries cancellation-first allocation through every repeated unit split", async () => {
    const { billId } = await billWith(venue, [{ name: "Burger", quantity: "5" }]);
    const [parent] = await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    await inTx(venue, async (tx) => {
      await tx.insert(lineServiceCancellations).values({
        lineId: parent!.id,
        quantity: 2000,
        cancelledAt: AT,
        wasStarted: true,
        actorId: venue.staffId,
      });
      await tx
        .update(ticketItems)
        .set({ quantity: 3000 })
        .where(eq(ticketItems.workingOrderLineId, parent!.id));
      await splitUnitsWithinOrder(tx, venue.cfg, billId, parent!.lineNo);
    });
    const rows = await projection(billId);
    expect(
      rows.map(({ quantity, cancelled, ticket }) => ({ quantity, cancelled, ticket })),
    ).toEqual([
      { quantity: 1000, cancelled: 0, ticket: 1000 },
      { quantity: 1000, cancelled: 1000, ticket: null },
      { quantity: 1000, cancelled: 1000, ticket: null },
      { quantity: 1000, cancelled: 0, ticket: 1000 },
      { quantity: 1000, cancelled: 0, ticket: 1000 },
    ]);
    expect(rows.map((row) => row.total)).toEqual([1200, 1200, 1200, 1200, 1200]);
  });
});
