import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  orderGroups,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell, setStationToday, ticketItemAllergies } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { fireGroup, fireHeldLine } from "./order-groups.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { createCourse, setProductCourse } from "./kitchen.js";
import { fireLines, fireOrderLines, routingOnce, unsentDishLines } from "./working-order.js";
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

async function orderRevision(tx: Transaction, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.revision;
}

async function allergyCopies(tx: Transaction, ticketItemId: string) {
  return tx
    .select()
    .from(ticketItemAllergies)
    .where(eq(ticketItemAllergies.ticketItemId, ticketItemId));
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
      expect(await allergyCopies(tx, burger!.id)).toEqual([]);
      const revision = await orderRevision(tx, venue.party.tabId);
      const before = await jobCounts(tx, venue);
      vi.setSystemTime(new Date(LATER));
      await fireHeldLine(tx, venue.cfg, venue.party.partyId, burger!.lineId, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      });
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({ ...requestedAtGrill(venue, LATER), queuedAt: burger!.queuedAt }),
      ]);
      expect(burger!.queuedAt).not.toBe(LATER);
      const [line] = await tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, burger!.lineId));
      expect(line!.sentAt).toBe(LATER);
      expect(await allergyCopies(tx, burger!.id)).toHaveLength(1);
      expect(await orderRevision(tx, venue.party.tabId)).toBeGreaterThan(revision);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("refuses a held group whose sold-out burger would be requested at a waiting Grill, writing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      return placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
    });
    await db.run(sql`update products set available = 0 where id = ${venue.products.burger}`);
    const snapshot = () =>
      withTransaction(db, async (tx) => {
        const rows = await items(tx, venue.party.tabId);
        const allergies = [];
        for (const row of rows) allergies.push(await allergyCopies(tx, row.id));
        return {
          rows,
          allergies,
          lines: await tx
            .select()
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, venue.party.tabId)),
          group: await tx
            .select()
            .from(orderGroups)
            .where(eq(orderGroups.id, placed.groups[0]!.id)),
          order: await orderRevision(tx, venue.party.tabId),
          party: await partyRevision(tx, venue.party.partyId),
          jobs: await jobCounts(tx, venue),
        };
      });
    const before = await snapshot();
    vi.setSystemTime(new Date(LATER));
    await expect(
      withTransaction(db, (tx) => fire(tx, venue, placed.groups[0]!.id)),
    ).rejects.toMatchObject({
      code: "product.unavailable",
      params: { productId: venue.products.burger },
    });
    expect(await snapshot()).toEqual(before);
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
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "burger"), hold: true },
      ]);
      const [held] = await tx
        .select()
        .from(ticketItems)
        .where(
          and(eq(ticketItems.workingOrderId, venue.party.tabId), isNull(ticketItems.requestedAt)),
        );
      const before = await jobCounts(tx, venue);
      const laterAt = new Date(Date.parse(requestedAt) + 60_000);
      const later = () =>
        fireOrderLines(
          tx,
          venue.cfg,
          venue.party.tabId,
          [requested!.workingOrderLineId, held!.workingOrderLineId],
          undefined,
          routingOnce(tx, venue.cfg, laterAt),
        );
      const row = async () =>
        tx.select().from(ticketItems).where(eq(ticketItems.id, requested!.id));

      await later();
      expect(await row()).toEqual([requested]);
      expect(await tx.select().from(ticketItems).where(eq(ticketItems.id, held!.id))).toEqual([
        { ...held, requestedAt: laterAt.toISOString(), passControlled: true },
      ]);
      expect(await jobCounts(tx, venue)).toEqual(before);

      await setStationsWaitForPass(tx, false, [venue.stations.grill]);
      await later();
      expect(await row()).toEqual([requested]);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("does not ask the allergy question again when a later release names only a requested burger", async () => {
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
      await tx.run(sql`delete from party_allergy where party_id = ${venue.party.partyId}`);
      await fireOrderLines(tx, venue.cfg, venue.party.tabId, [requested!.workingOrderLineId]);
      expect(await tx.select().from(ticketItems).where(eq(ticketItems.id, requested!.id))).toEqual([
        requested,
      ]);
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

  it("requests a later course's held chips at a waiting Fryer when their no-preparation water is released", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const later = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await setProductCourse(tx, venue.cfg, venue.products.water, later.id);
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "water", true), courseId: later.id, hold: true },
      ]);
      const held = await items(tx, venue.party.tabId);
      expect(held).toEqual([
        expect.objectContaining({
          productId: venue.products.chips,
          requestedAt: null,
          firedAt: null,
        }),
      ]);
      expect(await allergyCopies(tx, held[0]!.id)).toEqual([]);
      const before = await jobCounts(tx, venue);
      await fireLines(
        tx,
        venue.cfg,
        venue.party.tabId,
        (await unsentDishLines(tx, venue.party.tabId)).map((line) => ({
          ...line,
          release: true,
        })),
      );
      const [water] = await tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.productId, venue.products.water));
      expect(water!.sentAt).toBe(AT);
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          productId: venue.products.chips,
          stationId: venue.stations.fryer,
          requestedAt: AT,
          firedAt: null,
          passControlled: true,
        }),
      ]);
      expect(await allergyCopies(tx, held[0]!.id)).toHaveLength(1);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("starts a held extra's queue age at the fire when its dish is fired later and no station waits", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const later = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await setProductCourse(tx, venue.cfg, venue.products.water, later.id);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "water", true), courseId: later.id, hold: true },
      ]);
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({ productId: venue.products.chips, firedAt: null, queuedAt: AT }),
      ]);
      const FIRED = "2026-03-14T12:25:00.000Z";
      vi.setSystemTime(new Date(FIRED));
      await fireLines(
        tx,
        venue.cfg,
        venue.party.tabId,
        (await unsentDishLines(tx, venue.party.tabId)).map((line) => ({
          ...line,
          release: true,
        })),
      );
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          productId: venue.products.chips,
          stationId: venue.stations.fryer,
          requestedAt: FIRED,
          firedAt: FIRED,
          queuedAt: FIRED,
        }),
      ]);
    });
  });

  it("releases only the held extras of the dishes being fired", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const later = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await setProductCourse(tx, venue.cfg, venue.products.water, later.id);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "water", true), courseId: later.id, hold: true },
        { ...dish(venue, "water", true), courseId: later.id, hold: true },
      ]);
      const [firing, staying] = await unsentDishLines(tx, venue.party.tabId);
      const chipsOf = async (dishLineId: string) => {
        const [line] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.parentLineId, dishLineId));
        return (await items(tx, venue.party.tabId)).find((row) => row.lineId === line!.id);
      };
      vi.setSystemTime(new Date(LATER));
      await fireLines(tx, venue.cfg, venue.party.tabId, [
        { ...firing!, release: true },
        { ...staying!, hold: true },
      ]);
      expect(await chipsOf(firing!.id)).toMatchObject({ firedAt: LATER });
      expect(await chipsOf(staying!.id)).toMatchObject({
        productId: venue.products.chips,
        requestedAt: null,
        firedAt: null,
        queuedAt: AT,
      });
    });
  });

  it("answers a replayed group fire as the first and stamps and prints nothing more", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const before = await jobCounts(tx, venue);
      const command = {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      };
      const first = await fireGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        command,
      );
      const stamped = await items(tx, venue.party.tabId);
      expect(stamped).toEqual([expect.objectContaining(requestedAtGrill(venue, AT))]);
      expect(await jobCounts(tx, venue)).toEqual(before);
      vi.setSystemTime(new Date(Date.parse(AT) + 60_000));
      const second = await fireGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        command,
      );
      expect(second).toEqual(first);
      expect(await items(tx, venue.party.tabId)).toEqual(stamped);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });

  it("answers a replayed fire of one held dish as the first and stamps and prints nothing more", async () => {
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
      const command = {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
      };
      const first = await fireHeldLine(tx, venue.cfg, venue.party.partyId, burger!.lineId, command);
      const stamped = await items(tx, venue.party.tabId);
      expect(stamped).toEqual([expect.objectContaining(requestedAtGrill(venue, AT))]);
      expect(await jobCounts(tx, venue)).toEqual(before);
      vi.setSystemTime(new Date(Date.parse(AT) + 60_000));
      const second = await fireHeldLine(
        tx,
        venue.cfg,
        venue.party.partyId,
        burger!.lineId,
        command,
      );
      expect(second).toEqual(first);
      expect(await items(tx, venue.party.tabId)).toEqual(stamped);
      expect(await jobCounts(tx, venue)).toEqual(before);
    });
  });
});
