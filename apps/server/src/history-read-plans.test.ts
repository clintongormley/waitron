import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { eq, inArray, sql, type Query } from "drizzle-orm";
import { SQLiteSelectBase } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import {
  insertInChunks,
  orderGroups,
  parties,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { setReleaseReminderInEveryDepartment } from "./testing/release-reminder.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { readHeldCounts, readReleaseReminders, startGroup } from "./order-groups.js";
import { readStepFacts } from "./service-step-signals.js";
import { listStationQueues, stationHasWork } from "./working-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function capture<T>(read: () => Promise<T>) {
  const queries: Query[] = [];
  const plans: { sql: string; details: string[]; lookupBills: string[] }[] = [];
  const prototype = SQLiteSelectBase.prototype as unknown as {
    _prepare(oneTime?: boolean): unknown;
    toSQL(): Query;
  };
  const prepare = prototype._prepare;
  const builder = vi.spyOn(prototype, "_prepare").mockImplementation(function (
    this: { toSQL(): Query },
    oneTime,
  ) {
    queries.push(this.toSQL());
    return prepare.call(this, oneTime);
  });
  const nativePrepare = DatabaseSync.prototype.prepare;
  const native = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    text,
  ) {
    const query = queries.filter((query) => query.sql === text).at(-1);
    const lookupBills: string[] = [];
    const observed = text.replace(
      'select "working_orders"."id" from "working_orders"',
      'select observe_service_bill("working_orders"."id") from "working_orders"',
    );
    if (observed !== text) {
      this.function("observe_service_bill", (id) => {
        lookupBills.push(String(id));
        return id;
      });
    }
    if (query !== undefined) {
      const explanation = nativePrepare.call(this, `explain query plan ${text}`);
      const rows = explanation.all(...(query.params as SQLInputValue[]));
      plans.push({ sql: text, details: rows.map((row) => String(row.detail)), lookupBills });
    }
    return nativePrepare.call(this, observed);
  });
  try {
    return { result: await read(), plans };
  } finally {
    native.mockRestore();
    builder.mockRestore();
  }
}

async function history(tx: Transaction, billId: string, count = 256, leaveOpen = false) {
  const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, billId));
  const [line] = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const [ticket] = await ticketItemsWithBill(tx).where(
    eq(workingOrderLines.workingOrderId, billId),
  );
  const ids = Array.from({ length: count }, () => ({ bill: randomUUID(), line: randomUUID() }));
  await insertInChunks(
    tx,
    workingOrders,
    ids.map((id, i) => ({
      ...bill!,
      id: id.bill,
      orderNumber: i + 100,
      partyId: null,
      status: "open" as const,
      settledAt: null,
      collectedAt: null,
    })),
  );
  await insertInChunks(
    tx,
    workingOrderLines,
    ids.map((id) => ({
      ...line!,
      id: id.line,
      workingOrderId: id.bill,
      lineNo: 1,
      groupId: null,
      parentLineId: null,
    })),
  );
  await insertInChunks(
    tx,
    ticketItems,
    ids.map((id) => ({
      ...ticket!,
      id: randomUUID(),
      workingOrderId: id.bill,
      workingOrderLineId: id.line,
      state: "ready" as const,
    })),
  );
  if (!leaveOpen)
    await tx
      .update(workingOrders)
      .set({
        status: "settled",
        settledAt: "2025-01-01T12:00:00.000Z",
        collectedAt: "2025-01-01T12:01:00.000Z",
      })
      .where(
        inArray(
          workingOrders.id,
          ids.map((id) => id.bill),
        ),
      );
  return ids;
}

async function fixture() {
  useSplitExtrasDb(suite.db);
  const venue = await setupSplitExtrasVenue();
  const placed = await withTransaction(suite.db, async (tx) => {
    await setReleaseReminderInEveryDepartment(tx, 10);
    const dish = { menuItemId: venue.tables.offerFor(venue.products.burger), quantity: "1" };
    return placeGroups(tx, venue.cfg, venue.party.partyId, {
      operatorId: OPERATOR,
      groups: [
        { release: "fire", lines: [dish] },
        {
          release: "hold",
          lines: [
            {
              ...dish,
              extras: [
                {
                  listId: venue.lists.burger,
                  picks: [{ productId: venue.products.chips, quantity: 1 }],
                },
              ],
            },
          ],
        },
      ],
    });
  });
  return { venue, heldId: placed.groups[1]!.id };
}

describe("current service reads with collected history", () => {
  it("looks up the requested parties and groups before their dishes", async () => {
    const { venue, heldId } = await fixture();
    await withTransaction(suite.db, async (tx) => {
      const read = async () => ({
        held: await readHeldCounts(tx, [venue.party.partyId]),
        reminders: await readReleaseReminders(tx, [venue.party.partyId]),
        steps: await readStepFacts(tx, [
          {
            partyId: venue.party.partyId,
            tableIds: [venue.party.tableId],
            openedAt: "2026-01-01T12:00:00.000Z",
          },
        ]),
      });
      const before = await read();
      expect(before.held).toEqual(new Map([[venue.party.partyId, 1]]));
      expect(before.reminders).toEqual(
        new Map([[venue.party.partyId, { groupId: heldId, dueAt: null }]]),
      );
      expect(before.steps.has(venue.party.tableId)).toBe(true);
      await history(tx, venue.party.tabId);
      const after = await capture(read);
      expect(after.result).toEqual(before);
      const dishes = after.plans.filter(
        (plan) =>
          plan.sql.includes('from "working_order_lines"') &&
          plan.sql.includes('"parent_line_id" is null'),
      );
      expect(dishes).toHaveLength(3);
      for (const plan of dishes) {
        expect.soft(plan.details.join("\n")).not.toContain("working_order_lines_parent_idx");
        expect(plan.details.join("\n")).not.toMatch(/SCAN working_order_lines/);
      }
    });
  });

  it("finds station dishes through uncollected bills instead of the station's history", async () => {
    const { venue } = await fixture();
    await withTransaction(suite.db, async (tx) => {
      const stationIds = [venue.stations.grill, venue.stations.fryer, venue.stations.bar];
      const before = await listStationQueues(tx, stationIds);
      expect(before.get(venue.stations.grill)).toHaveLength(1);
      expect(before.get(venue.stations.fryer)).toHaveLength(1);
      expect(before.get(venue.stations.bar)).toEqual([]);
      await history(tx, venue.party.tabId);
      const after = await capture(async () => ({
        queues: await listStationQueues(tx, stationIds),
        work: await stationHasWork(tx, venue.stations.grill),
        empty: await stationHasWork(tx, venue.stations.bar),
      }));
      expect(after.result).toEqual({ queues: before, work: true, empty: false });
      const items = after.plans.filter(
        (plan) =>
          plan.sql.includes('from "ticket_items"') &&
          plan.sql.includes('"ticket_items"."station_id" in'),
      );
      expect(items).toHaveLength(3);
      for (const plan of items) {
        expect(plan.lookupBills).toEqual([venue.party.tabId]);
        expect(plan.details.join("\n")).toContain("ticket_items_working_order_line_id_key");
        expect(plan.details.join("\n")).toMatch(
          /SEARCH working_order_lines USING (?:COVERING )?INDEX working_order_lines_(?:order_idx|line_no_key) \(working_order_id=\?\)/,
        );
        expect(plan.details.join("\n")).not.toMatch(/SCAN (?:ticket_items|working_order_lines)\b/);
        expect(plan.details.join("\n")).not.toContain("ticket_items_waiting_idx");
        expect(plan.details.join("\n")).not.toContain("ticket_items_queue_idx");
      }
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, venue.party.tabId));
      expect(await stationHasWork(tx, venue.stations.grill)).toBe(false);
      expect((await listStationQueues(tx, stationIds)).get(venue.stations.grill)).toEqual([]);
    });
  });
  it("keeps ready uncollected counter bills and excludes collected, abandoned and made-here work", async () => {
    const { venue } = await fixture();
    await withTransaction(suite.db, async (tx) => {
      const rows = await history(tx, venue.party.tabId, 4, true);
      const [collected, abandoned, madeHere, ready] = rows;
      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: "2025-01-01T12:00:00.000Z" })
        .where(inArray(workingOrders.id, [collected!.bill, madeHere!.bill, ready!.bill]));
      await tx
        .update(workingOrders)
        .set({ collectedAt: "2025-01-01T12:01:00.000Z" })
        .where(eq(workingOrders.id, collected!.bill));
      await tx
        .update(workingOrders)
        .set({ status: "abandoned", settledAt: null })
        .where(eq(workingOrders.id, abandoned!.bill));
      await tx
        .update(ticketItems)
        .set({ madeHere: true })
        .where(eq(ticketItems.workingOrderLineId, madeHere!.line));
      const measured = await capture(() => listStationQueues(tx, [venue.stations.grill]));
      const lookup = measured.plans.find((plan) => plan.sql.includes('from "ticket_items"'))!;
      expect(lookup.lookupBills).toContain(venue.party.tabId);
      expect(lookup.lookupBills).toContain(ready!.bill);
      expect(lookup.lookupBills).not.toContain(collected!.bill);
      expect(lookup.lookupBills).not.toContain(abandoned!.bill);
      const orders = measured.result.get(venue.stations.grill)!;
      expect(orders.map((order) => order.orderId).sort()).toEqual(
        [venue.party.tabId, ready!.bill].sort(),
      );
      const counter = orders.find((order) => order.orderId === ready!.bill)!;
      expect(counter.status).toBe("settled");
      expect(counter.items.map((item) => item.state)).toEqual(["ready"]);
      expect(orders.some((order) => order.orderId === collected!.bill)).toBe(false);
      expect(await stationHasWork(tx, venue.stations.grill)).toBe(true);
      await tx
        .update(workingOrders)
        .set({ collectedAt: "2026-01-01T12:00:00.000Z" })
        .where(inArray(workingOrders.id, [venue.party.tabId, ready!.bill]));
      expect(await stationHasWork(tx, venue.stations.grill)).toBe(false);
      expect(
        (await listStationQueues(tx, [venue.stations.grill])).get(venue.stations.grill),
      ).toEqual([]);
    });
  });

  it.each([{ statistics: false }, { statistics: true }])(
    "finds a party's next group number through the party and number-party indexes (statistics: $statistics)",
    async ({ statistics }) => {
      const { venue } = await fixture();
      const partyId = venue.party.partyId;
      await withTransaction(suite.db, async (tx) => {
        const own = await tx
          .select({ displayNumber: orderGroups.displayNumber })
          .from(orderGroups)
          .where(eq(orderGroups.partyId, partyId));
        expect(own.map((group) => group.displayNumber).sort()).toEqual([1, 2]);
        const others = Array.from({ length: 256 }, () => randomUUID());
        await insertInChunks(
          tx,
          parties,
          others.map((id) => ({
            id,
            state: "closed" as const,
            openedAt: "2025-01-01T12:00:00.000Z",
            openedBy: OPERATOR,
            closedAt: "2025-01-01T14:00:00.000Z",
            closedBy: OPERATOR,
          })),
        );
        await insertInChunks(
          tx,
          orderGroups,
          others.flatMap((other) =>
            [1, 2, 3, 4, 5, 6].map((n) => ({
              partyId: other,
              position: n,
              displayNumber: n,
              numberPartyId: other,
              state: "fired" as const,
              firedAt: "2025-01-01T12:30:00.000Z",
              firedBy: OPERATOR,
              submittedBy: OPERATOR,
            })),
          ),
        );
        // The shape moveGroupsToParty gives a group: held by another party, numbered in this one's sequence.
        await tx.insert(orderGroups).values({
          partyId: others[0]!,
          position: 7,
          displayNumber: 3,
          numberPartyId: partyId,
          state: "fired",
          firedAt: "2025-01-01T12:30:00.000Z",
          firedBy: OPERATOR,
          submittedBy: OPERATOR,
        });
        if (statistics) tx.execute(sql`analyze`);
        const statTables = tx.execute<{ name: string }>(
          sql`select name from sqlite_master where name = 'sqlite_stat1'`,
        ).rows;
        if (statistics)
          expect(
            tx.execute<{ stat: string }>(
              sql`select stat from sqlite_stat1 where idx = 'order_groups_number_party_idx'`,
            ).rows,
          ).toEqual([{ stat: expect.stringMatching(/^1539 /) }]);
        else expect(statTables).toEqual([]);
        const measured = await capture(() =>
          startGroup(tx, partyId, "hold", OPERATOR, "next_course"),
        );
        const [started] = await tx
          .select({
            displayNumber: orderGroups.displayNumber,
            numberPartyId: orderGroups.numberPartyId,
          })
          .from(orderGroups)
          .where(eq(orderGroups.id, measured.result));
        expect(started).toEqual({ displayNumber: 4, numberPartyId: partyId });
        const numbers = measured.plans.filter(
          (plan) =>
            plan.sql.includes('from "order_groups"') && plan.sql.includes('"number_party_id" = ?'),
        );
        expect(numbers).toHaveLength(1);
        const details = numbers[0]!.details.join("\n");
        expect(details).not.toMatch(/SCAN order_groups/);
        expect(details).toContain("order_groups_number_party_idx");
        expect(details).toContain("order_groups_party_idx");
      });
    },
  );
});
