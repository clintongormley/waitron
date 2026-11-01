import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { addTabRound, updateHeldOrder, updateOrderLine } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { createCourse, setProductCourse } from "./kitchen.js";
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
type Dish = "burger" | "water";

function line(venue: Venue, dish: Dish, quantity = "1", chips = 0) {
  const picks = chips ? [{ productId: venue.products.chips, quantity: chips }] : [];
  return {
    menuItemId: venue.tables.offerFor(venue.products[dish]),
    quantity,
    ...(picks.length ? { extras: [{ listId: venue.lists[dish], picks }] } : {}),
  };
}

async function revision(tx: Transaction, id: string) {
  return (
    await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id))
  )[0]!.revision;
}

async function edit(
  tx: Transaction,
  venue: Venue,
  lineNo: number,
  patch: Parameters<typeof updateOrderLine>[4],
) {
  return updateOrderLine(
    tx,
    venue.cfg,
    venue.party.tabId,
    lineNo,
    patch,
    await revision(tx, venue.party.tabId),
    OPERATOR,
  );
}

async function items(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      productId: workingOrderLines.productId,
      courseId: ticketItems.courseId,
      stationId: ticketItems.stationId,
      note: ticketItems.note,
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      passControlled: ticketItems.passControlled,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(ticketItems.workingOrderId, orderId));
}

async function slips(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
  ).map((job) => decodeTicket(job.payload));
}

describe("A773 requested lifecycle: edit", () => {
  it("keeps a released burger released when a change edit sends it again", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger")]);
      const [before] = await items(tx, id);
      expect(before).toMatchObject({ requestedAt: AT, firedAt: AT });
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      vi.setSystemTime(new Date(LATER));
      await edit(tx, venue, 1, { note: "No salt" });
      const after = await items(tx, id);
      expect(after).toHaveLength(1);
      expect(after[0]!.id).not.toBe(before!.id);
      expect(after[0]).toMatchObject({
        requestedAt: LATER,
        firedAt: LATER,
        passControlled: false,
      });
      const grill = await slips(tx, venue.printers.grill);
      const recalled = grill.findIndex((slip) => slip.includes("RECALLED"));
      expect(recalled).toBeGreaterThan(0);
      expect(grill.at(-1)).toContain("BURG");
      expect(grill.at(-1)).not.toContain("RECALLED");
      expect(grill.length - 1).toBeGreaterThan(recalled);
    });
  });

  it("brings each record back in its own phase, the requested one with its first request time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger", "1", 1)]);
      const before = await items(tx, id);
      const burgerBefore = before.find((row) => row.productId === venue.products.burger)!;
      const chipsBefore = before.find((row) => row.productId === venue.products.chips)!;
      expect(burgerBefore).toMatchObject({ requestedAt: AT, firedAt: null });
      expect(chipsBefore).toMatchObject({ stationId: venue.stations.fryer, firedAt: AT });
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      const grillBefore = (await slips(tx, venue.printers.grill)).length;
      const passBefore = (await slips(tx, venue.printers.pass)).length;
      vi.setSystemTime(new Date(LATER));
      await edit(tx, venue, 1, { note: "No salt" });
      const after = await items(tx, id);
      const burger = after.find((row) => row.productId === venue.products.burger)!;
      const chips = after.find((row) => row.productId === venue.products.chips)!;
      // "change", not "free": both records are new.
      expect(burger.id).not.toBe(burgerBefore.id);
      expect(chips.id).not.toBe(chipsBefore.id);
      expect(burger).toMatchObject({ requestedAt: AT, firedAt: null, passControlled: true });
      expect(chips).toMatchObject({
        stationId: venue.stations.fryer,
        requestedAt: LATER,
        firedAt: LATER,
        passControlled: false,
      });
      const fryer = await slips(tx, venue.printers.fryer);
      const recalled = fryer.findIndex((slip) => slip.includes("RECALLED"));
      expect(recalled).toBeGreaterThan(0);
      expect(fryer.at(-1)).toContain("CHIPS");
      expect(fryer.length - 1).toBeGreaterThan(recalled);
      expect(await slips(tx, venue.printers.grill)).toHaveLength(grillBefore);
      // The pass copies the chips' slips; none of its new jobs is the burger's own.
      const passNew = (await slips(tx, venue.printers.pass)).slice(passBefore);
      expect(passNew.every((slip) => slip.includes("x CHIPS"))).toBe(true);
      expect(passNew.some((slip) => slip.includes("x BURG"))).toBe(false);
    });
  });

  it("edits a requested burger in place", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, id, [line(venue, "burger")]);
      const [before] = await items(tx, id);
      expect(before).toMatchObject({ requestedAt: AT, firedAt: null });
      vi.setSystemTime(new Date(LATER));
      await edit(tx, venue, 1, { note: "No salt" });
      expect(await items(tx, id)).toEqual([
        { ...before, note: "No salt", requestedAt: AT, firedAt: null },
      ]);
      for (const printer of Object.values(venue.printers))
        expect(await slips(tx, printer)).toEqual([]);
    });
  });

  it("requests a new dish an edit adds to a course whose last requested dish it removes", async () => {
    const venue = await setupSplitExtrasVenue();
    const id = venue.party.tabId;
    const { starters, mains } = await withTransaction(db, async (tx) => {
      const starters = await createCourse(tx, venue.cfg, { name: "Starters", displayOrder: 1 });
      const mains = await createCourse(tx, venue.cfg, { name: "Mains", displayOrder: 2 });
      await setProductCourse(tx, venue.cfg, venue.products.burger, mains.id);
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, id, [
        { ...line(venue, "burger"), courseId: starters.id, release: true },
        { ...line(venue, "burger"), courseId: mains.id, release: true },
      ]);
      return { starters, mains };
    });
    const before = await withTransaction(db, async (tx) => ({
      rows: await items(tx, id),
      currentRevision: await revision(tx, id),
    }));
    expect(before.rows.map((row) => [row.courseId, row.firedAt])).toEqual(
      expect.arrayContaining([
        [starters.id, null],
        [mains.id, null],
      ]),
    );
    const kept = before.rows.find((row) => row.courseId === starters.id)!;
    const removed = before.rows.find((row) => row.courseId === mains.id)!;
    await updateHeldOrder({ admission: testTradingAdmission(), db }, venue.cfg, id, {
      revision: before.currentRevision,
      operatorId: OPERATOR,
      lines: [{ ...line(venue, "burger"), workingOrderLineId: kept.lineId }, line(venue, "burger")],
    });
    await withTransaction(db, async (tx) => {
      const after = await items(tx, id);
      expect(after.map((row) => row.lineId)).not.toContain(removed.lineId);
      const added = after.find((row) => row.lineId !== kept.lineId)!;
      expect(added).toMatchObject({
        courseId: mains.id,
        firedAt: null,
        passControlled: true,
      });
      expect(added.requestedAt).not.toBeNull();
    });
  });
});
