import { asc, eq, getTableColumns } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { printJobs, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setStationToday } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { addTabRound, recallLines, sendLines } from "./testing/order-writer-fixture.js";
import { createCourse } from "./kitchen.js";
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
afterEach(() => {
  vi.useRealTimers();
});

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

async function items(tx: Transaction, orderId: string) {
  return tx
    .select(getTableColumns(ticketItems))
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(ticketItems.workingOrderId, orderId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function lines(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      productId: workingOrderLines.productId,
      sentAt: workingOrderLines.sentAt,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function jobsAt(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
  ).map((job) => decodeTicket(job.payload));
}

async function jobCounts(tx: Transaction, venue: Venue) {
  const counts: Record<string, number> = {};
  for (const [name, id] of Object.entries(venue.printers))
    counts[name] = (await jobsAt(tx, id)).length;
  return counts;
}

const burger = (venue: Venue) => ({
  menuItemId: venue.tables.offerFor(venue.products.burger),
  quantity: "1",
});

const water = (venue: Venue) => ({
  menuItemId: venue.tables.offerFor(venue.products.water),
  quantity: "1",
});

describe("A773 waiter request: tab send", () => {
  it("leaves a Requested dish alone and requests the held one at a waiting Grill", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [burger(venue)]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [{ ...burger(venue), hold: true }]);
      const [requested, held] = await items(tx, venue.party.tabId);
      expect(requested).toMatchObject({ requestedAt: AT, firedAt: null, passControlled: true });
      expect(held).toMatchObject({ requestedAt: null, firedAt: null, passControlled: false });
      const before = await jobCounts(tx, venue);
      vi.setSystemTime(new Date(LATER));
      await sendLines(tx, venue.cfg, venue.party.tabId, []);
      const afterFirst = await items(tx, venue.party.tabId);
      expect(afterFirst).toEqual([
        requested,
        { ...held, requestedAt: LATER, firedAt: null, passControlled: true },
      ]);
      expect(await jobCounts(tx, venue)).toEqual(before);
      await sendLines(tx, venue.cfg, venue.party.tabId, []);
      expect(await items(tx, venue.party.tabId)).toEqual(afterFirst);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("does not reroute a Requested dish whose station has closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [burger(venue)]);
      const [requested] = await items(tx, venue.party.tabId);
      expect(requested).toMatchObject({ stationId: venue.stations.grill, firedAt: null });
      await setStationToday(
        tx,
        venue.cfg,
        venue.stations.grill,
        "closed",
        new Date(),
        venue.stations.kitchen,
      );
      const before = await jobCounts(tx, venue);
      await sendLines(tx, venue.cfg, venue.party.tabId, []);
      expect(await items(tx, venue.party.tabId)).toEqual([requested]);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("requests a held dish rerouted to a waiting Kitchen there, printing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [{ ...burger(venue), hold: true }]);
      await setStationToday(
        tx,
        venue.cfg,
        venue.stations.grill,
        "closed",
        new Date(),
        venue.stations.kitchen,
      );
      await setStationsWaitForPass(tx, true, [venue.stations.kitchen]);
      const before = await jobCounts(tx, venue);
      await sendLines(tx, venue.cfg, venue.party.tabId, []);
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          stationId: venue.stations.kitchen,
          requestedAt: AT,
          firedAt: null,
          passControlled: true,
        }),
      ]);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("releases a held dish rerouted to a Kitchen that does not wait, with the from-Grill ticket", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [{ ...burger(venue), hold: true }]);
      await setStationToday(
        tx,
        venue.cfg,
        venue.stations.grill,
        "closed",
        new Date(),
        venue.stations.kitchen,
      );
      const before = await jobCounts(tx, venue);
      await sendLines(tx, venue.cfg, venue.party.tabId, []);
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          stationId: venue.stations.kitchen,
          requestedAt: AT,
          firedAt: AT,
          passControlled: false,
        }),
      ]);
      const kitchen = (await jobsAt(tx, venue.printers.kitchen)).slice(before.kitchen);
      expect(kitchen).toHaveLength(1);
      expect(kitchen[0]).toContain("From Grill");
      expect(kitchen[0]).toContain("x BURG");
    });
  });

  it("sends a course's no-preparation line once the waiter has asked for every dish in it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const later = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...burger(venue), courseId: later.id, hold: true },
        { ...burger(venue), courseId: later.id, hold: true },
        { ...water(venue), courseId: later.id, hold: true },
      ]);
      const [first, second, drink] = await lines(tx, venue.party.tabId);
      expect(drink!.productId).toBe(venue.products.water);
      expect(await items(tx, venue.party.tabId)).toHaveLength(2);
      const before = await jobCounts(tx, venue);
      const itemOf = async (lineId: string) =>
        (await items(tx, venue.party.tabId)).find((row) => row.workingOrderLineId === lineId);
      const sentOf = async (lineId: string) =>
        (await lines(tx, venue.party.tabId)).find((row) => row.id === lineId)!.sentAt;

      await sendLines(tx, venue.cfg, venue.party.tabId, [first!.lineNo]);
      expect(await itemOf(first!.id)).toMatchObject({
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      expect(await itemOf(second!.id)).toMatchObject({ requestedAt: null, firedAt: null });
      expect(await sentOf(drink!.id)).toBeNull();

      vi.setSystemTime(new Date(LATER));
      await sendLines(tx, venue.cfg, venue.party.tabId, [second!.lineNo]);
      expect(await itemOf(second!.id)).toMatchObject({
        requestedAt: LATER,
        firedAt: null,
        passControlled: true,
      });
      expect(await sentOf(drink!.id)).toBe(LATER);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("sends a recalled dish again when nothing waits", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [burger(venue)]);
      const [line] = await lines(tx, venue.party.tabId);
      await recallLines(tx, venue.cfg, venue.party.tabId, [line!.lineNo]);
      const grillBefore = (await jobsAt(tx, venue.printers.grill)).length;
      vi.setSystemTime(new Date(LATER));
      await sendLines(tx, venue.cfg, venue.party.tabId, [line!.lineNo]);
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          stationId: venue.stations.grill,
          requestedAt: LATER,
          firedAt: LATER,
          passControlled: false,
        }),
      ]);
      const grill = (await jobsAt(tx, venue.printers.grill)).slice(grillBefore);
      expect(grill).toHaveLength(1);
      expect(grill[0]).toContain("x BURG");
    });
  });
});
