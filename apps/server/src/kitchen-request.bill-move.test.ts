import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { printJobs, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { addTabRound, setLineCourse } from "./testing/order-writer-fixture.js";
import { createCourse } from "./kitchen.js";
import { mergeBills, moveDishes, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { partyRevision } from "./parties.js";
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

const dish = (venue: Venue, product: "burger" | "water") => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
});

async function jobCount(tx: Transaction): Promise<number> {
  return (await tx.select({ id: printJobs.id }).from(printJobs)).length;
}

async function linesOf(tx: Transaction, billId: string) {
  return tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function itemOf(tx: Transaction, lineId: string) {
  const items = await tx
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  expect(items).toHaveLength(1);
  return items[0]!;
}

async function command(tx: Transaction, venue: Venue) {
  return {
    partyId: venue.party.partyId,
    expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
    operatorId: OPERATOR,
  };
}

/** The grill waits for the pass and a Fire now group of the given dishes is sent: each burger
 *  comes back Requested. */
async function requestedBurgers(tx: Transaction, venue: Venue, dishes: ("burger" | "water")[]) {
  await setStationsWaitForPass(tx, true, [venue.stations.grill]);
  await placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines: dishes.map((name) => dish(venue, name)), release: "fire" }],
  });
  const lines = await linesOf(tx, venue.party.tabId);
  for (const line of lines.filter((l) => l.productId === venue.products.burger))
    expect(await itemOf(tx, line.id)).toMatchObject({
      stationId: venue.stations.grill,
      requestedAt: expect.any(String),
      firedAt: null,
      passControlled: true,
    });
  return lines;
}

const stamps = (item: Awaited<ReturnType<typeof itemOf>>) => ({
  stationId: item.stationId,
  requestedAt: item.requestedAt,
  firedAt: item.firedAt,
  passControlled: item.passControlled,
});

describe("A773 requested lifecycle: bill move", () => {
  it("lets Split bill take a Requested dish to a new bill, keeping its request and printing nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const [, second] = await requestedBurgers(tx, venue, ["burger", "burger"]);
      const before = await itemOf(tx, second!.id);
      const jobs = await jobCount(tx);

      const { billId } = await splitBill(
        tx,
        venue.cfg,
        venue.party.tabId,
        [{ lineNo: second!.lineNo }],
        await command(tx, venue),
      );

      const [moved] = await linesOf(tx, billId);
      expect(stamps(await itemOf(tx, moved!.id))).toEqual({
        stationId: venue.stations.grill,
        requestedAt: before.requestedAt,
        firedAt: null,
        passControlled: true,
      });
      expect(await jobCount(tx)).toBe(jobs);
    });
  });

  it("lets Move dishes take a Requested dish to a new bill, keeping its request and printing nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const [, second] = await requestedBurgers(tx, venue, ["burger", "burger"]);
      const before = await itemOf(tx, second!.id);
      const jobs = await jobCount(tx);

      const { billId } = await moveDishes(
        tx,
        venue.cfg,
        venue.party.tabId,
        null,
        [second!.id],
        await command(tx, venue),
      );

      const [moved] = await linesOf(tx, billId);
      expect(stamps(await itemOf(tx, moved!.id))).toEqual({
        stationId: venue.stations.grill,
        requestedAt: before.requestedAt,
        firedAt: null,
        passControlled: true,
      });
      expect(await jobCount(tx)).toBe(jobs);
    });
  });

  it("keeps a Requested dish's stamps when Move dishes, Transfer items and Merge bills carry it to an existing bill", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const [first, second, water] = await requestedBurgers(tx, venue, [
        "burger",
        "burger",
        "water",
      ]);
      const wanted = {
        [first!.id]: stamps(await itemOf(tx, first!.id)),
        [second!.id]: stamps(await itemOf(tx, second!.id)),
      };
      const { billId: other } = await splitBill(
        tx,
        venue.cfg,
        venue.party.tabId,
        [{ lineNo: water!.lineNo }],
        await command(tx, venue),
      );
      const jobs = await jobCount(tx);
      const keptStamps = async () => {
        for (const [lineId, expected] of Object.entries(wanted))
          expect(stamps(await itemOf(tx, lineId))).toEqual(expected);
        expect(await jobCount(tx)).toBe(jobs);
      };

      await moveDishes(
        tx,
        venue.cfg,
        venue.party.tabId,
        other,
        [first!.id],
        await command(tx, venue),
      );
      expect((await linesOf(tx, other)).map((l) => l.id)).toContain(first!.id);
      await keptStamps();

      const [onTab] = await linesOf(tx, venue.party.tabId);
      expect(onTab!.id).toBe(second!.id);
      await transferItems(
        tx,
        venue.cfg,
        venue.party.tabId,
        other,
        [{ lineNo: onTab!.lineNo }],
        await command(tx, venue),
      );
      expect((await linesOf(tx, other)).map((l) => l.id)).toContain(second!.id);
      await keptStamps();

      await mergeBills(tx, venue.cfg, venue.party.tabId, other, await command(tx, venue));
      expect((await linesOf(tx, venue.party.tabId)).map((l) => l.id)).toEqual(
        expect.arrayContaining([first!.id, second!.id]),
      );
      await keptStamps();
    });
  });

  it("refuses to change the course of a Requested dish, as for a released one (D43)", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const postres = await createCourse(tx, venue.cfg, { name: "Postres", displayOrder: 9 });
      const [burger] = await requestedBurgers(tx, venue, ["burger"]);
      const before = await itemOf(tx, burger!.id);

      await expect(
        setLineCourse(tx, venue.cfg, venue.party.tabId, burger!.lineNo, postres.id),
      ).rejects.toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: venue.party.tabId },
      });
      const [after] = await linesOf(tx, venue.party.tabId);
      expect(after!.courseId).toBe(burger!.courseId);
      expect(await itemOf(tx, burger!.id)).toMatchObject({
        ...stamps(before),
        courseId: before.courseId,
      });
    });
  });

  it("still lets a held dish change course", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const postres = await createCourse(tx, venue.cfg, { name: "Postres", displayOrder: 9 });
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const [held] = await linesOf(tx, venue.party.tabId);
      expect(await itemOf(tx, held!.id)).toMatchObject({ requestedAt: null, firedAt: null });

      await setLineCourse(tx, venue.cfg, venue.party.tabId, held!.lineNo, postres.id);

      expect((await linesOf(tx, venue.party.tabId))[0]!.courseId).toBe(postres.id);
      expect((await itemOf(tx, held!.id)).courseId).toBe(postres.id);
    });
  });

  it("still refuses to split off a dish the kitchen holds outside a held group", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "burger"), hold: true },
      ]);
      const [held] = await linesOf(tx, venue.party.tabId);
      expect(await itemOf(tx, held!.id)).toMatchObject({ requestedAt: null, firedAt: null });

      await expect(
        splitBill(
          tx,
          venue.cfg,
          venue.party.tabId,
          [{ lineNo: held!.lineNo }],
          await command(tx, venue),
        ),
      ).rejects.toMatchObject({
        code: "tab.split_held_line",
        params: { tabId: venue.party.tabId, lineNo: held!.lineNo },
      });
    });
  });
});
