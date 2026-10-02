import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import {
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { transferItems } from "./bill-actions.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { partyRevisionOfOrder } from "./parties.js";
import { joinTables } from "./table-actions.js";
import { createTable } from "./tables.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { splitPartyBill } from "./testing/serve-line.js";
import { addTabRound, createOpenOrder } from "./working-order.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});
type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
type Dish = "burger" | "water";
function picked(venue: Venue, dish: Dish, quantity = "2") {
  return {
    menuItemId: venue.tables.offerFor(venue.products[dish]),
    quantity,
    extras: [
      { listId: venue.lists[dish], picks: [{ productId: venue.products.chips, quantity: 2 }] },
    ],
  };
}
async function chipsRecords(tx: Transaction, venue: Venue) {
  return tx
    .select({
      lineId: workingOrderLines.id,
      lineQuantity: workingOrderLines.quantity,
      ticketQuantity: ticketItems.quantity,
      stationId: ticketItems.stationId,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.productId, venue.products.chips));
}
async function compOne(venue: Venue) {
  await withTransaction(db, async (tx) => {
    const [actor] = await tx
      .insert(persons)
      .values({
        displayName: "Split test operator",
        pinHash: hashPin("4321"),
        role: "staff",
      })
      .returning({ id: persons.id });
    const reason = await createAdjustmentReason(tx, {
      name: "House",
      names: { en: "House", es: "Casa" },
      actions: ["comp"],
      maxPercentBp: null,
      maxAmount: null,
      applyRole: "staff",
      approverRole: "staff",
      noteRequired: false,
    });
    const [dish] = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, venue.party.tabId))
      .orderBy(workingOrderLines.lineNo)
      .limit(1);
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, venue.party.tabId));
    await applyAdjustment(
      tx,
      venue.cfg,
      {
        orderId: venue.party.tabId,
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: dish!.id,
        reasonId: reason.id,
        action: "comp",
        quantity: "1",
        note: null,
        operatorId: actor!.id,
      },
      venue.cfg.locale,
    );
  });
}

describe("splitting a dish with split-off extras", () => {
  it.each(["burger", "water"] as const)(
    "a partial comp of two %ss splits four chips at Fryer into two records of two",
    async (dish) => {
      const venue = await setupSplitExtrasVenue();
      await withTransaction(db, (tx) =>
        addTabRound(tx, venue.cfg, venue.party.tabId, [picked(venue, dish)]),
      );
      await compOne(venue);
      if (dish === "water") {
        const waterRecords = await withTransaction(db, (tx) =>
          tx
            .select({ id: ticketItems.id })
            .from(ticketItems)
            .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
            .where(eq(workingOrderLines.productId, venue.products.water)),
        );
        expect(waterRecords).toEqual([]);
      }
      const records = await withTransaction(db, (tx) => chipsRecords(tx, venue));
      expect(records).toHaveLength(2);
      expect(
        records.map((record) => ({
          lineQuantity: record.lineQuantity,
          ticketQuantity: record.ticketQuantity,
          stationId: record.stationId,
        })),
      ).toEqual([
        { lineQuantity: 2000, ticketQuantity: 2000, stationId: venue.stations.fryer },
        { lineQuantity: 2000, ticketQuantity: 2000, stationId: venue.stations.fryer },
      ]);
      expect(records.reduce((sum, record) => sum + record.ticketQuantity!, 0)).toBe(4000);
    },
  );

  it("refuses to split a whole water whose course holds its chips record", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await withTransaction(db, async (tx) => {
      const course = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await setProductCourse(tx, venue.cfg, venue.products.water, course.id);
      return course.id;
    });
    await withTransaction(db, (tx) =>
      addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...picked(venue, "water", "1"), courseId, hold: true },
      ]),
    );
    await expect(
      withTransaction(db, (tx) =>
        splitPartyBill(tx, venue.cfg, venue.party.tabId, [{ lineNo: 1 }]),
      ),
    ).rejects.toMatchObject({
      code: "tab.split_held_line",
      params: { tabId: venue.party.tabId, lineNo: 1 },
    });
  });

  it("a whole burger transferred between bills tells Grill and Fryer when the party joins another table", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, (tx) =>
      addTabRound(tx, venue.cfg, venue.party.tabId, [picked(venue, "burger", "1")]),
    );
    const otherTable = await withTransaction(db, (tx) =>
      createTable(tx, venue.cfg, { label: "Other split table", zoneId: venue.party.zoneId }),
    );
    const destination = randomUUID();
    await withTransaction(db, (tx) =>
      createOpenOrder(tx, venue.cfg, destination, [], null, {
        partyId: venue.party.partyId,
        zoneId: venue.party.zoneId,
      }),
    );
    const jobCounts = async () =>
      withTransaction(db, async (tx) => {
        const jobs = await tx
          .select({ printerId: printJobs.printerId, payload: printJobs.payload })
          .from(printJobs);
        return new Map(
          [venue.printers.grill, venue.printers.fryer].map((printerId) => [
            printerId,
            jobs
              .filter((job) => job.printerId === printerId)
              .map((job) => decodeTicket(job.payload)),
          ]),
        );
      });
    await withTransaction(db, async (tx) => {
      const party = await partyRevisionOfOrder(tx, venue.party.tabId);
      await transferItems(tx, venue.cfg, venue.party.tabId, destination, [{ lineNo: 1 }], {
        expectedPartyRevision: party!.revision,
        operatorId: randomUUID(),
      });
    });
    const before = await jobCounts();
    await withTransaction(db, async (tx) => {
      const party = await partyRevisionOfOrder(tx, venue.party.tabId);
      await joinTables(tx, venue.cfg, venue.party.partyId, otherTable.id, {
        expectedPartyRevision: party!.revision,
        operatorId: randomUUID(),
        bills: "separate",
        otherPartyId: null,
      });
    });
    const after = await jobCounts();
    const grillSlips = after
      .get(venue.printers.grill)!
      .slice(before.get(venue.printers.grill)!.length);
    const fryerSlips = after
      .get(venue.printers.fryer)!
      .slice(before.get(venue.printers.fryer)!.length);
    expect(grillSlips).toHaveLength(1);
    expect(grillSlips[0]).toContain("MOVED");
    expect(grillSlips[0]).toContain("BURG");
    expect(fryerSlips).toHaveLength(1);
    expect(fryerSlips[0]).toContain("MOVED");
    expect(fryerSlips[0]).toContain("CHIPS");
    const moved = await withTransaction(db, (tx) =>
      tx
        .select({ stationId: ticketItems.stationId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, destination)),
    );
    expect(new Set(moved.map((item) => item.stationId))).toEqual(
      new Set([venue.stations.grill, venue.stations.fryer]),
    );
  });
});
