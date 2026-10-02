import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { printJobs, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readPrintHeldWork, writePrintHeldWork } from "@waitron/venue-service";
import { createCourse, setProductCourse } from "./kitchen.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { OPERATOR } from "./testing/party-venue.js";
import {
  addTabRound,
  bumpCourseReady,
  fireCourse,
  markCourseAway,
  markServed,
  sendLines,
  setLineCourse,
} from "./working-order.js";
import { fireGroup, placeGroups, readCurrentOrders } from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";
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
const pick = (venue: Venue, product: "burger" | "water", chips = true) => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists[product],
            picks: [{ productId: venue.products.chips, quantity: 1 }],
          },
        ],
      }
    : {}),
});
async function rows(tx: Transaction, tabId: string) {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      sentAt: workingOrderLines.sentAt,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const items = await tx
    .select({
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
      courseId: ticketItems.courseId,
      state: ticketItems.state,
      awayAt: ticketItems.awayAt,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, tabId));
  return { lines, items };
}
async function fryerTickets(tx: Transaction, venue: Venue) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, venue.printers.fryer))
  ).map((job) => decodeTicket(job.payload));
}
async function laterCourse(venue: Venue, ...products: ("burger" | "water")[]) {
  return withTransaction(db, async (tx) => {
    const course = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
    for (const product of products)
      await setProductCourse(tx, venue.cfg, venue.products[product], course.id);
    return course.id;
  });
}

describe("releasing split-off extras", () => {
  it("fires both held records by course, then readies and sends them away together", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await laterCourse(venue, "burger");
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...pick(venue, "burger"), courseId, hold: true },
      ]);
      expect((await rows(tx, venue.party.tabId)).items.map((item) => item.firedAt)).toEqual([
        null,
        null,
      ]);
      await fireCourse(tx, venue.cfg, venue.party.tabId, courseId, OPERATOR);
      const fired = await rows(tx, venue.party.tabId);
      expect(fired.items).toHaveLength(2);
      expect(fired.items.every((item) => item.firedAt !== null)).toBe(true);
      expect((await fryerTickets(tx, venue)).join("\n")).toContain("CHIPS");
      await bumpCourseReady(tx, venue.cfg, venue.party.tabId, courseId);
      expect((await rows(tx, venue.party.tabId)).items.map((item) => item.state)).toEqual([
        "ready",
        "ready",
      ]);
      await markCourseAway(tx, venue.cfg, venue.party.tabId, courseId);
      expect((await rows(tx, venue.party.tabId)).items.every((item) => item.awayAt !== null)).toBe(
        true,
      );
    });
  });

  it.each(["burger", "water"] as const)(
    "fires held %s and chips together by group with a FIRE slip",
    async (product) => {
      const venue = await setupSplitExtrasVenue();
      await withTransaction(db, async (tx) => {
        await writePrintHeldWork(tx, true);
        expect(await readPrintHeldWork(tx)).toBe(true);
        const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [{ lines: [pick(venue, product)], release: "hold" }],
        });
        expect((await fryerTickets(tx, venue)).join("\n")).toContain("*** HOLD ***");
        await fireGroup(tx, venue.cfg, venue.party.partyId, placed.groups[0]!.id, {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: placed.revision,
        });
        const result = await rows(tx, placed.tabId);
        expect(
          result.items.find((item) => item.stationId === venue.stations.fryer)?.firedAt,
        ).not.toBeNull();
        expect((await fryerTickets(tx, venue)).join("\n")).toContain("*** FIRE ***");
      });
    },
  );

  it("fires both chips when a named burger is sent", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await laterCourse(venue, "burger");
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        {
          ...pick(venue, "burger"),
          courseId,
          hold: true,
          extras: [
            {
              listId: venue.lists.burger,
              picks: [{ productId: venue.products.chips, quantity: 2 }],
            },
          ],
        },
      ]);
      const before = await rows(tx, venue.party.tabId);
      const dish = before.lines.find((line) => line.parentLineId === null)!;
      await sendLines(tx, venue.cfg, venue.party.tabId, [dish.lineNo]);
      expect((await rows(tx, venue.party.tabId)).items.every((item) => item.firedAt !== null)).toBe(
        true,
      );
      expect((await fryerTickets(tx, venue)).join("\n")).toContain("CHIPS");
    });
  });

  it("moves a held dish and its extra records to the new course", async () => {
    const venue = await setupSplitExtrasVenue();
    const first = await laterCourse(venue, "burger");
    await withTransaction(db, async (tx) => {
      const second = await createCourse(tx, venue.cfg, { name: "Third", displayOrder: 3 });
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...pick(venue, "burger"), courseId: first, hold: true },
      ]);
      const dish = (await rows(tx, venue.party.tabId)).lines.find(
        (line) => line.parentLineId === null,
      )!;
      expect(
        (await rows(tx, venue.party.tabId)).items.every((item) => item.courseId === first),
      ).toBe(true);
      await setLineCourse(tx, venue.cfg, venue.party.tabId, dish.lineNo, second.id);
      expect((await rows(tx, venue.party.tabId)).items.map((item) => item.courseId)).toEqual([
        second.id,
        second.id,
      ]);
    });
  });

  it("refuses to re-course a sent water while its chips are cooking", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const later = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await addTabRound(tx, venue.cfg, venue.party.tabId, [pick(venue, "water")]);
      const dish = (await rows(tx, venue.party.tabId)).lines.find(
        (line) => line.parentLineId === null,
      )!;
      await expect(
        setLineCourse(tx, venue.cfg, venue.party.tabId, dish.lineNo, later.id),
      ).rejects.toMatchObject({ code: "ticket.already_fired" });
      expect((await rows(tx, venue.party.tabId)).items[0]?.courseId).toBeNull();
    });
  });

  it("refuses serving a sent water while its chips are held again", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [pick(venue, "water")]);
      const dish = (await rows(tx, venue.party.tabId)).lines.find(
        (line) => line.parentLineId === null,
      )!;
      await tx
        .update(ticketItems)
        .set({ firedAt: null })
        .where(
          eq(ticketItems.workingOrderLineId, (await rows(tx, venue.party.tabId)).items[0]!.lineId),
        );
      const current = await readCurrentOrders(tx, venue.party.partyId);
      expect(JSON.stringify(current)).toContain('"released":false');
      await expect(
        markServed(tx, venue.cfg, venue.party.partyId, [{ lineId: dish.id, quantity: "1" }], {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: current.revision,
        }),
      ).rejects.toMatchObject({ code: "group.line_held" });
      await tx
        .update(ticketItems)
        .set({ firedAt: new Date().toISOString() })
        .where(
          eq(ticketItems.workingOrderLineId, (await rows(tx, venue.party.tabId)).items[0]!.lineId),
        );
      const fresh = await readCurrentOrders(tx, venue.party.partyId);
      expect(JSON.stringify(fresh)).toContain('"released":true');
      await markServed(tx, venue.cfg, venue.party.partyId, [{ lineId: dish.id, quantity: "1" }], {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: fresh.revision,
      });
    });
  });

  it("releases water's held chips by course and stamps the water sent", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await laterCourse(venue, "water");
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...pick(venue, "water"), courseId, hold: true },
      ]);
      expect((await rows(tx, venue.party.tabId)).items[0]!.firedAt).toBeNull();
      await fireCourse(tx, venue.cfg, venue.party.tabId, courseId, OPERATOR);
      const result = await rows(tx, venue.party.tabId);
      expect(result.items[0]!.firedAt).not.toBeNull();
      expect(result.lines.find((line) => line.parentLineId === null)!.sentAt).not.toBeNull();
      expect((await fryerTickets(tx, venue)).join("\n")).toContain("CHIPS");
    });
  });

  it("decides an undecided child of a held no-preparation water at release", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await laterCourse(venue, "water");
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...pick(venue, "water", false), courseId, hold: true },
      ]);
      const dish = (await rows(tx, venue.party.tabId)).lines[0]!;
      const [child] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: venue.party.tabId,
          lineNo: dish.lineNo + 1,
          name: "Chips",
          productId: venue.products.chips,
          kitchenName: "CHIPS",
          descriptions: { "es-ES": "Patatas fritas" },
          quantity: 1000,
          unitPriceGross: 100,
          vatClass: "general",
          lineTotal: 100,
          courseId,
          parentLineId: dish.id,
          extraListId: venue.lists.water,
        })
        .returning({ id: workingOrderLines.id });
      expect((await rows(tx, venue.party.tabId)).items).toEqual([]);
      await fireCourse(tx, venue.cfg, venue.party.tabId, courseId, OPERATOR);
      const result = await rows(tx, venue.party.tabId);
      expect(result.items).toEqual([
        expect.objectContaining({
          lineId: child!.id,
          stationId: venue.stations.fryer,
          courseId,
          firedAt: expect.any(String),
        }),
      ]);
      expect(result.lines.find((line) => line.id === dish.id)!.sentAt).not.toBeNull();
      expect((await fryerTickets(tx, venue)).join("\n")).toContain("CHIPS");
    });
  });

  it("leaves held group extras held when sending every ungrouped line", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [pick(venue, "burger")], release: "hold" }],
      });
      await sendLines(tx, venue.cfg, placed.tabId, []);
      expect((await rows(tx, placed.tabId)).items.every((item) => item.firedAt === null)).toBe(
        true,
      );
    });
  });

  it("opens one routing snapshot across the course and held group release", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await laterCourse(venue, "water", "burger");
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...pick(venue, "water", false), courseId, hold: true },
        { ...pick(venue, "burger"), courseId, hold: true },
      ]);
      const water = (await rows(tx, venue.party.tabId)).lines.find(
        (line) => line.productId === venue.products.water,
      )!;
      await tx.insert(workingOrderLines).values({
        workingOrderId: venue.party.tabId,
        lineNo: 4,
        name: "Chips",
        productId: venue.products.chips,
        kitchenName: "CHIPS",
        descriptions: { "es-ES": "Patatas fritas" },
        quantity: 1000,
        unitPriceGross: 100,
        vatClass: "general",
        lineTotal: 100,
        courseId,
        parentLineId: water.id,
        extraListId: venue.lists.water,
      });
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [{ ...pick(venue, "water"), courseId }], release: "hold" }],
      });
      const snapshot = vi.spyOn(VENUE_SERVICE, "routingAt");
      const makers = vi.spyOn(VENUE_SERVICE, "resolveMakers");
      const extraMakers = vi.spyOn(VENUE_SERVICE, "resolveExtraMakers");
      try {
        await fireCourse(tx, venue.cfg, venue.party.tabId, courseId, OPERATOR);
        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(makers).not.toHaveBeenCalled();
        expect(extraMakers).not.toHaveBeenCalled();
      } finally {
        snapshot.mockRestore();
        makers.mockRestore();
        extraMakers.mockRestore();
      }
    });
  });

  it("does not open routing when a course releases only routed work", async () => {
    const venue = await setupSplitExtrasVenue();
    const courseId = await laterCourse(venue, "burger");
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...pick(venue, "burger"), courseId, hold: true },
      ]);
      const snapshot = vi.spyOn(VENUE_SERVICE, "routingAt");
      try {
        await fireCourse(tx, venue.cfg, venue.party.tabId, courseId, OPERATOR);
        expect(snapshot).not.toHaveBeenCalled();
      } finally {
        snapshot.mockRestore();
      }
    });
  });
});
