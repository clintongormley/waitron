import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  lineServiceCancellations,
  parties,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell, ticketItemAllergies } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { advanceTicketItem } from "./working-order.js";
import { readCancellationContext, requireCancellationContext } from "./line-cancel-context.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

const AT = "2026-10-17T11:30:00.000Z";
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

async function renameFixtureTicket(tx: Transaction, lineId: string, ticketId: string) {
  const [ticket] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  const copies =
    ticket === undefined
      ? []
      : await tx
          .delete(ticketItemAllergies)
          .where(eq(ticketItemAllergies.ticketItemId, ticket.id))
          .returning();
  await tx
    .update(ticketItems)
    .set({ id: ticketId })
    .where(eq(ticketItems.workingOrderLineId, lineId));
  if (copies.length > 0)
    await tx
      .insert(ticketItemAllergies)
      .values(copies.map((copy) => ({ ...copy, ticketItemId: ticketId })));
}

async function fixture(release: "fire" | "hold" = "fire", coffee = false) {
  const order = await billWith(
    venue,
    coffee ? [{ name: "Coffee", quantity: "3" }] : [{ name: "Pizza", quantity: "3", olives: 2 }],
    { release },
  );
  return inTx(venue, async (tx) => {
    const rows = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo);
    const parent = rows[0]!;
    const extra = rows[1];
    const parentTicket = "f" + randomUUID().slice(1);
    const extraTicket = "0" + randomUUID().slice(1);
    for (const rename of [
      { lineId: parent.id, ticketId: parentTicket },
      ...(extra === undefined ? [] : [{ lineId: extra.id, ticketId: extraTicket }]),
    ]) {
      await renameFixtureTicket(tx, rename.lineId, rename.ticketId);
    }
    return { ...order, parent, extra, parentTicket, extraTicket };
  });
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function read(order: Fixture) {
  return inTx(venue, (tx) => readCancellationContext(tx, order.partyId, order.parent.id));
}

async function snapshot(order: Fixture) {
  return inTx(venue, async (tx) => ({
    bill: await tx.select().from(workingOrders).where(eq(workingOrders.id, order.billId)),
    party: await tx.select().from(parties).where(eq(parties.id, order.partyId)),
    lines: await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId)),
    tickets: await tx
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, order.billId)),
    cancellations: await tx
      .select()
      .from(lineServiceCancellations)
      .where(eq(lineServiceCancellations.lineId, order.parent.id)),
  }));
}

describe("cancellation confirmation context", () => {
  it("captures every dish component in stable kitchen-id order with billed and actual kitchen counts", async () => {
    const order = await fixture("hold");
    await inTx(venue, async (tx) => {
      await tx.insert(lineServiceCancellations).values({
        lineId: order.parent.id,
        quantity: 1000,
        cancelledAt: AT,
        wasStarted: false,
        actorId: venue.staffId,
      });
      await tx
        .update(ticketItems)
        .set({ quantity: 2000 })
        .where(eq(ticketItems.id, order.parentTicket));
      await tx
        .update(ticketItems)
        .set({ quantity: 4000 })
        .where(eq(ticketItems.id, order.extraTicket));
    });
    expect(await read(order)).toEqual({
      billStatus: "open",
      stage: "not_started",
      components: [
        {
          id: order.extraTicket,
          lineId: order.extra!.id,
          state: "queued",
          firedAt: null,
          quantity: "6.000",
          kitchenQuantity: "4.000",
          servedQuantity: "0.000",
          cancelledQuantity: "2.000",
        },
        {
          id: order.parentTicket,
          lineId: order.parent.id,
          state: "queued",
          firedAt: null,
          quantity: "3.000",
          kitchenQuantity: "2.000",
          servedQuantity: "0.000",
          cancelledQuantity: "1.000",
        },
      ],
    });
  });

  it.each(["preparing", "ready"] as const)(
    "treats an extra at %s as started even while its dish waits",
    async (state) => {
      const order = await fixture();
      await inTx(venue, async (tx) => {
        await advanceTicketItem(tx, venue.cfg, order.extraTicket, "preparing");
        if (state === "ready") await advanceTicketItem(tx, venue.cfg, order.extraTicket, "ready");
      });
      expect(await read(order)).toMatchObject({
        stage: "started",
        components: [
          { id: order.extraTicket, state },
          { id: order.parentTicket, state: "queued" },
        ],
      });
    },
  );

  it("captures a no-preparation dish and treats actual serving as started", async () => {
    const order = await fixture("fire", true);
    expect(await read(order)).toEqual({
      billStatus: "open",
      stage: "not_started",
      components: [
        {
          id: null,
          lineId: order.parent.id,
          state: null,
          firedAt: null,
          quantity: "3.000",
          kitchenQuantity: null,
          servedQuantity: "0.000",
          cancelledQuantity: "0.000",
        },
      ],
    });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedQuantity: 1000 })
        .where(eq(workingOrderLines.id, order.parent.id)),
    );
    expect(await read(order)).toMatchObject({
      stage: "started",
      components: [{ servedQuantity: "1.000" }],
    });
  });

  it("treats a preparing dish as started while its extra still waits", async () => {
    const order = await fixture();
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, order.parentTicket, "preparing"));
    expect(await read(order)).toMatchObject({
      stage: "started",
      components: [
        { id: order.extraTicket, state: "queued" },
        { id: order.parentTicket, state: "preparing" },
      ],
    });
  });

  it.each(["placed", "settled"] as const)(
    "accepts an unchanged %s bill context without requiring an open bill or altering its money",
    async (status) => {
      const order = await fixture();
      await inTx(venue, (tx) =>
        tx
          .update(workingOrders)
          .set({ status, settledAt: status === "settled" ? AT : null })
          .where(eq(workingOrders.id, order.billId)),
      );
      const context = await read(order);
      expect(context.billStatus).toBe(status);
      const before = await snapshot(order);
      expect(
        await inTx(venue, (tx) =>
          requireCancellationContext(tx, order.partyId, order.parent.id, context),
        ),
      ).toEqual(context);
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it("accepts unchanged confirmation with reordered component and object keys without writing", async () => {
    const order = await fixture();
    const context = await read(order);
    const expected = {
      components: [...context.components].reverse(),
      stage: context.stage,
      billStatus: context.billStatus,
    };
    const before = await snapshot(order);
    expect(
      await inTx(venue, (tx) =>
        requireCancellationContext(tx, order.partyId, order.parent.id, expected),
      ),
    ).toEqual(context);
    expect(await snapshot(order)).toEqual(before);
  });

  it("refuses kitchen advancement without a party or bill revision change, then accepts renewed consent", async () => {
    const order = await fixture();
    const expected = await read(order);
    const before = await snapshot(order);
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, order.extraTicket, "preparing"));
    const advanced = await snapshot(order);
    expect(advanced.bill).toEqual(before.bill);
    expect(advanced.party).toEqual(before.party);
    const current = await read(order);
    expect(current.stage).toBe("started");
    await expect(
      inTx(venue, (tx) => requireCancellationContext(tx, order.partyId, order.parent.id, expected)),
    ).rejects.toMatchObject({ code: "tab.cancel_context_changed", params: { context: current } });
    expect(await snapshot(order)).toEqual(advanced);
    expect(
      await inTx(venue, (tx) =>
        requireCancellationContext(tx, order.partyId, order.parent.id, current),
      ),
    ).toEqual(current);
    expect(await snapshot(order)).toEqual(advanced);
  });

  it.each([
    "parent_state",
    "extra_quantity",
    "billed_quantity",
    "served_quantity",
    "cancelled_quantity",
    "removed_extra",
    "new_extra",
    "new_ticket",
    "fired",
    "paid",
    "presented",
  ] as const)("refuses a changed %s snapshot and leaves the new state intact", async (change) => {
    const order = await fixture(change === "fired" ? "hold" : "fire");
    const expected = await read(order);
    await inTx(venue, async (tx) => {
      switch (change) {
        case "parent_state":
          await advanceTicketItem(tx, venue.cfg, order.parentTicket, "preparing");
          break;
        case "extra_quantity":
          await tx
            .update(ticketItems)
            .set({ quantity: 5000 })
            .where(eq(ticketItems.id, order.extraTicket));
          break;
        case "billed_quantity":
          await tx
            .update(workingOrderLines)
            .set({ quantity: 4000 })
            .where(eq(workingOrderLines.id, order.parent.id));
          break;
        case "served_quantity":
          await tx
            .update(workingOrderLines)
            .set({ servedQuantity: 1000 })
            .where(eq(workingOrderLines.id, order.extra!.id));
          break;
        case "cancelled_quantity":
          await tx.insert(lineServiceCancellations).values({
            lineId: order.parent.id,
            quantity: 1000,
            cancelledAt: AT,
            wasStarted: false,
            actorId: venue.staffId,
          });
          break;
        case "removed_extra":
          await tx.delete(workingOrderLines).where(eq(workingOrderLines.id, order.extra!.id));
          break;
        case "new_extra":
          await tx
            .insert(workingOrderLines)
            .values({ ...order.extra!, id: randomUUID(), lineNo: 3 });
          break;
        case "new_ticket":
          await renameFixtureTicket(tx, order.extra!.id, randomUUID());
          break;
        case "fired":
          await tx
            .update(ticketItems)
            .set({ firedAt: AT })
            .where(eq(ticketItems.id, order.parentTicket));
          break;
        case "paid":
          await tx
            .update(workingOrders)
            .set({ status: "settled", settledAt: AT })
            .where(eq(workingOrders.id, order.billId));
          break;
        case "presented":
          await tx
            .update(workingOrders)
            .set({ status: "placed" })
            .where(eq(workingOrders.id, order.billId));
          break;
      }
    });
    const before = await snapshot(order);
    const current = await read(order);
    await expect(
      inTx(venue, (tx) => requireCancellationContext(tx, order.partyId, order.parent.id, expected)),
    ).rejects.toMatchObject({ code: "tab.cancel_context_changed", params: { context: current } });
    expect(await snapshot(order)).toEqual(before);
  });

  it.each(["quantity", "served"] as const)(
    "detects %s changes without a kitchen ticket",
    async (change) => {
      const order = await fixture("fire", true);
      const expected = await read(order);
      await inTx(venue, (tx) =>
        tx
          .update(workingOrderLines)
          .set(change === "quantity" ? { quantity: 4000 } : { servedQuantity: 1000 })
          .where(eq(workingOrderLines.id, order.parent.id)),
      );
      await expect(
        inTx(venue, (tx) =>
          requireCancellationContext(tx, order.partyId, order.parent.id, expected),
        ),
      ).rejects.toMatchObject({ code: "tab.cancel_context_changed" });
    },
  );

  it.each(["foreign_party", "extra", "missing", "abandoned"] as const)(
    "refuses %s as a cancellation subject",
    async (kind) => {
      const order = await fixture();
      let partyId = order.partyId;
      let lineId = order.parent.id;
      let code = "management.request_invalid";
      if (kind === "foreign_party") {
        partyId = (await fixture()).partyId;
        code = "bill.other_party";
      }
      if (kind === "extra") lineId = order.extra!.id;
      if (kind === "missing") lineId = randomUUID();
      if (kind === "abandoned") {
        await inTx(venue, (tx) =>
          tx
            .update(workingOrders)
            .set({ status: "abandoned" })
            .where(eq(workingOrders.id, order.billId)),
        );
        code = "tab.not_open";
      }
      await expect(
        inTx(venue, (tx) => readCancellationContext(tx, partyId, lineId)),
      ).rejects.toMatchObject({ code });
    },
  );
});
