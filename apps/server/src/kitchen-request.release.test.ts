import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  orderGroups,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell, setStationToday } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { fireGroup, fireHeldLine } from "./order-groups.js";
import { fireOrderLines, routingOnce } from "./working-order.js";
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

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

async function items(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      productId: workingOrderLines.productId,
      stationId: ticketItems.stationId,
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      queuedAt: ticketItems.queuedAt,
      passControlled: ticketItems.passControlled,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(ticketItems.workingOrderId, orderId));
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

async function partyRevision(tx: Transaction, partyId: string): Promise<number> {
  const [row] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

async function fire(tx: Transaction, venue: Venue, groupId: string) {
  return fireGroup(tx, venue.cfg, venue.party.partyId, groupId, {
    operatorId: OPERATOR,
    submissionId: randomUUID(),
    expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
  });
}

const dish = (venue: Venue, product: "burger" | "water", chips = false) => ({
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

const requestedAtGrill = (venue: Venue, requestedAt: string) => ({
  stationId: venue.stations.grill,
  requestedAt,
  firedAt: null,
  passControlled: true,
  state: "queued",
});

describe("A773 waiter request: release", () => {
  it("releases a held burger and requests its chips at a waiting Fryer when the group fires", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger", true)], release: "hold" }],
      });
      const before = await jobCounts(tx, venue);
      await fire(tx, venue, placed.groups[0]!.id);
      const rows = await items(tx, venue.party.tabId);
      expect(rows.find((row) => row.productId === venue.products.burger)).toMatchObject({
        stationId: venue.stations.grill,
        requestedAt: AT,
        firedAt: AT,
        passControlled: false,
      });
      expect(rows.find((row) => row.productId === venue.products.chips)).toMatchObject({
        stationId: venue.stations.fryer,
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      const grill = (await jobsAt(tx, venue.printers.grill)).slice(before.grill);
      expect(grill).toHaveLength(1);
      expect(grill[0]).toContain("x BURG");
      expect(grill[0]).not.toContain("x CHIPS");
      expect((await jobsAt(tx, venue.printers.fryer)).length).toBe(before.fryer);
      for (const ticket of (await jobsAt(tx, venue.printers.pass)).slice(before.pass))
        expect(ticket).not.toContain("x CHIPS");
    });
  });

  it("requests a held group's burgers on two bills at a waiting Grill and releases the drink at Bar", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
        { kind: "station", stationId: venue.stations.bar },
      );
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            lines: [dish(venue, "burger"), dish(venue, "burger"), dish(venue, "water")],
            release: "hold",
          },
        ],
      });
      const { billId } = await splitBill(tx, venue.cfg, venue.party.tabId, [{ lineNo: 2 }], {
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
        operatorId: OPERATOR,
      });
      const before = await jobCounts(tx, venue);
      await fire(tx, venue, placed.groups[0]!.id);

      const first = await items(tx, venue.party.tabId);
      const second = await items(tx, billId);
      expect(second).toEqual([expect.objectContaining(requestedAtGrill(venue, AT))]);
      expect(first.find((row) => row.productId === venue.products.burger)).toMatchObject(
        requestedAtGrill(venue, AT),
      );
      expect(first.find((row) => row.productId === venue.products.water)).toMatchObject({
        stationId: venue.stations.bar,
        requestedAt: AT,
        firedAt: AT,
        passControlled: false,
      });
      const bar = (await jobsAt(tx, venue.printers.bar)).slice(before.bar);
      expect(bar).toHaveLength(1);
      expect(bar[0]).toContain("H2O");
      expect(await jobCounts(tx, venue)).toEqual({ ...before, bar: before.bar! + 1 });
      const [group] = await tx
        .select({ state: orderGroups.state, firedAt: orderGroups.firedAt })
        .from(orderGroups)
        .where(eq(orderGroups.id, placed.groups[0]!.id));
      expect(group).toEqual({ state: "fired", firedAt: AT });
    });
  });

  it("requests a held burger fired on its own at a waiting Grill and prints nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const [burger] = await items(tx, venue.party.tabId);
      const before = await jobCounts(tx, venue);
      await fireHeldLine(tx, venue.cfg, venue.party.partyId, burger!.lineId, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining(requestedAtGrill(venue, AT)),
      ]);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("prints Bar's FIRE ticket for a group whose HOLD ticket printed, and nothing at a waiting Grill", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
        { kind: "station", stationId: venue.stations.bar },
      );
      await setStationPrinting(tx, { printHeldWork: true }, [
        venue.stations.grill,
        venue.stations.bar,
      ]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger"), dish(venue, "water")], release: "hold" }],
      });
      expect((await jobsAt(tx, venue.printers.grill)).join("\n")).toContain("*** HOLD ***");
      expect((await jobsAt(tx, venue.printers.bar)).join("\n")).toContain("*** HOLD ***");
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const before = await jobCounts(tx, venue);
      await fire(tx, venue, placed.groups[0]!.id);
      const bar = (await jobsAt(tx, venue.printers.bar)).slice(before.bar);
      expect(bar).toHaveLength(1);
      expect(bar[0]).toContain("*** FIRE ***");
      expect(bar[0]).toContain("H2O");
      expect(await jobCounts(tx, venue)).toEqual({ ...before, bar: before.bar! + 1 });
    });
  });

  it("leaves a requested burger alone when a later release names it, before and after its station stops waiting", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
      });
      const [requested] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, venue.party.tabId));
      expect(requested).toMatchObject({ firedAt: null, passControlled: true });
      const requestedAt = requested!.requestedAt!;
      const before = await jobCounts(tx, venue);
      const later = () =>
        fireOrderLines(
          tx,
          venue.cfg,
          venue.party.tabId,
          [requested!.workingOrderLineId],
          undefined,
          routingOnce(tx, venue.cfg, new Date(Date.parse(requestedAt) + 60_000)),
        );
      const row = async () =>
        tx.select().from(ticketItems).where(eq(ticketItems.id, requested!.id));

      await later();
      expect(await row()).toEqual([requested]);
      expect(await jobCounts(tx, venue)).toEqual(before);

      await setStationsWaitForPass(tx, false, [venue.stations.grill]);
      await later();
      expect(await row()).toEqual([requested]);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("reroutes a held burger from a closed Grill before requesting it at a waiting Kitchen", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({ stationId: venue.stations.grill, firedAt: null }),
      ]);
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
      await fire(tx, venue, placed.groups[0]!.id);
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          stationId: venue.stations.kitchen,
          requestedAt: expect.any(String),
          firedAt: null,
          passControlled: true,
        }),
      ]);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });
});
