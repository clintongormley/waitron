import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orderGroups, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCourse } from "./kitchen.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { inTx, OPERATOR, seatWithNoAllergies, setupPartyVenue } from "./testing/party-venue.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { fireableLineColumns, fireLines, parkOrder, sendToPrep } from "./working-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function counterWithCourses() {
  const v = await setupPartyVenue(suite.db);
  const courses = await inTx(v, async (tx) => ({
    first: await createCourse(tx, v.cfg, { name: "First", displayOrder: 1 }),
    last: await createCourse(tx, v.cfg, { name: "Last", displayOrder: 2 }),
  }));
  const id = randomUUID();
  await parkOrder({ db: v.db }, v.cfg, {
    id,
    zoneId: v.counter.zoneId,
    operatorId: OPERATOR,
    lines: [
      { menuItemId: v.counterItem("Burger"), quantity: "1" },
      { menuItemId: v.counterItem("Burger"), quantity: "2" },
      { menuItemId: v.counterItem("Burger"), quantity: "3" },
    ],
  });
  await inTx(v, async (tx) => {
    await tx
      .update(workingOrderLines)
      .set({ courseId: courses.last.id })
      .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 1)));
    await tx
      .update(workingOrderLines)
      .set({ courseId: courses.first.id })
      .where(and(eq(workingOrderLines.workingOrderId, id), eq(workingOrderLines.lineNo, 2)));
  });
  const lines = await inTx(v, (tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo),
  );
  return { v, id, courses, lines };
}

describe("A773 counter release", () => {
  it("sends every course without changing recorded courses, line order or prices", async () => {
    const { v, id, courses, lines } = await counterWithCourses();
    await placeOrder({ ...v, admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
    const after = await inTx(v, async (tx) => ({
      order: (await tx.select().from(workingOrders).where(eq(workingOrders.id, id)))[0]!,
      lines: await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo),
      items: await tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
      groups: await tx.select().from(orderGroups),
    }));
    expect(after.order.partyId).toBeNull();
    expect(after.order.status).toBe("placed");
    expect(after.groups).toEqual([]);
    expect(
      after.lines.map(({ lineNo, quantity, courseId }) => [lineNo, quantity, courseId]),
    ).toEqual([
      [1, 1000, courses.last.id],
      [2, 1000, courses.first.id],
      [3, 1000, null],
      [4, 1000, null],
      [5, 1000, null],
      [6, 1000, null],
    ]);
    expect(after.lines).toEqual(lines.map((line) => ({ ...line, sentAt: expect.any(String) })));
    expect(after.items).toHaveLength(6);
    for (const line of lines) {
      const item = after.items.find((row) => row.workingOrderLineId === line.id)!;
      expect(item).toMatchObject({
        courseId: line.courseId,
        quantity: line.quantity,
        state: "queued",
      });
      expect(item.firedAt).not.toBeNull();
    }
  });

  it("releases every course on payment and refuses duplicate kitchen sends", async () => {
    const { v, id, lines } = await counterWithCourses();
    await payWorkingOrder(
      { ...v, admission: testTradingAdmission() },
      v.cfg,
      { id, tender: { method: "cash", amount: "72.00" }, lines: [] },
      OPERATOR,
    );
    const before = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
    );
    expect(before).toHaveLength(lines.length);
    expect(before.every(({ firedAt }) => firedAt !== null)).toBe(true);
    await expect(sendToPrep(v, v.cfg, id)).rejects.toMatchObject({ code: "ticket.already_fired" });
    expect(
      await inTx(v, (tx) =>
        tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
      ),
    ).toEqual(before);
  });

  it("keeps a table's explicit held group held", async () => {
    const v = await setupPartyVenue(suite.db);
    const party = await seatWithNoAllergies(v, await v.table("Held table"));
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, party.partyId, {
        billId: party.tabId,
        operatorId: OPERATOR,
        groups: [
          { lines: [{ menuItemId: v.item("Burger"), quantity: "1" }], release: "fire" },
          { lines: [{ menuItemId: v.item("Burger"), quantity: "2" }], release: "hold" },
        ],
      }),
    );
    const items = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    // The held Burger ×2 is two portions, each its own line and ticket item (A803).
    const [fired, held] = placed.groups.map((group) => group.lineIds);
    expect(held).toHaveLength(2);
    expect(items).toHaveLength(3);
    const firedAt = (lineId: string) =>
      items.find(({ workingOrderLineId }) => workingOrderLineId === lineId)!.firedAt;
    expect(firedAt(fired![0]!)).not.toBeNull();
    expect(held!.map(firedAt)).toEqual([null, null]);
  });

  it("ignores a table holding flag on a counter release", async () => {
    const { v, id, lines } = await counterWithCourses();
    await inTx(v, async (tx) => {
      const stored = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      await fireLines(
        tx,
        v.cfg,
        id,
        stored.map((line) => ({ ...line, hold: true })),
      );
    });
    const items = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
    );
    expect(items).toHaveLength(lines.length);
    expect(items.every(({ firedAt }) => firedAt !== null)).toBe(true);
  });
});
