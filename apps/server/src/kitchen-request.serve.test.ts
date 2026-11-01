import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceMadeHereStations,
  orderGroups,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { createCourse } from "./kitchen.js";
import { fireGroup, readCurrentOrders, type CurrentOrders } from "./order-groups.js";
import {
  fireOrderLines,
  isReleased,
  markGroupServed,
  markServed,
  routingOnce,
  unmarkServed,
} from "./working-order.js";
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

async function partyRevision(tx: Transaction, partyId: string): Promise<number> {
  const [row] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

async function args(tx: Transaction, venue: Venue) {
  return {
    operatorId: OPERATOR,
    submissionId: randomUUID(),
    expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
  };
}

async function serve(tx: Transaction, venue: Venue, lineId: string, quantity = "1") {
  return markServed(
    tx,
    venue.cfg,
    venue.party.partyId,
    [{ lineId, quantity }],
    await args(tx, venue),
  );
}

async function unserve(tx: Transaction, venue: Venue, lineId: string, quantity = "1") {
  return unmarkServed(
    tx,
    venue.cfg,
    venue.party.partyId,
    [{ lineId, quantity }],
    await args(tx, venue),
  );
}

/** The bill's lines with their product, served quantity and kitchen item. */
async function lines(tx: Transaction, venue: Venue) {
  return tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      parentLineId: workingOrderLines.parentLineId,
      groupId: workingOrderLines.groupId,
      servedQuantity: workingOrderLines.servedQuantity,
      itemId: ticketItems.id,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, venue.party.tabId))
    .orderBy(workingOrderLines.lineNo);
}

async function lineOf(tx: Transaction, venue: Venue, product: "burger" | "water" | "chips") {
  const found = (await lines(tx, venue)).filter(
    (line) => line.productId === venue.products[product],
  );
  expect(found).toHaveLength(1);
  return found[0]!;
}

async function lineRow(tx: Transaction, lineId: string) {
  const [row] = await tx
    .select({
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      sentAt: workingOrderLines.sentAt,
      groupState: orderGroups.state,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(eq(workingOrderLines.id, lineId));
  return row!;
}

/** `isReleased` over a ticketless line, read as `servableLines` reads it. */
async function ticketlessReleased(tx: Transaction, lineId: string) {
  const row = await lineRow(tx, lineId);
  return isReleased({
    groupState: row.groupState,
    ticketItemId: null,
    ticketFiredAt: null,
    ticketMadeHere: null,
    sentAt: row.sentAt,
  });
}

async function item(tx: Transaction, itemId: string) {
  const [row] = await tx
    .select({
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      passControlled: ticketItems.passControlled,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
    })
    .from(ticketItems)
    .where(eq(ticketItems.id, itemId));
  return row!;
}

async function jobCount(tx: Transaction): Promise<number> {
  return (await tx.select({ id: printJobs.id }).from(printJobs)).length;
}

function rowFor(current: CurrentOrders, lineId: string) {
  const row = [...current.groups.flatMap((group) => group.rows), ...current.ungrouped].find(
    (candidate) => candidate.lineId === lineId,
  );
  expect(row).toBeDefined();
  return row!;
}

async function fireNow(tx: Transaction, venue: Venue, lineInputs: ReturnType<typeof dish>[]) {
  return placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines: lineInputs, release: "fire" }],
  });
}

async function holdThenFire(tx: Transaction, venue: Venue, lineInputs: ReturnType<typeof dish>[]) {
  const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines: lineInputs, release: "hold" }],
  });
  await fireGroup(tx, venue.cfg, venue.party.partyId, placed.groups[0]!.id, await args(tx, venue));
  return placed;
}

/** Sets the chips' item back to held: both stamps cleared (D39). */
async function holdChipsAgain(tx: Transaction, chipsLineId: string) {
  await tx
    .update(ticketItems)
    .set({ firedAt: null, requestedAt: null })
    .where(eq(ticketItems.workingOrderLineId, chipsLineId));
}

async function madeHereDevice(tx: Transaction, stationId: string) {
  const { deviceId } = await seedDevice(tx, { label: "Here" });
  await tx.insert(deviceMadeHereStations).values({ deviceId, stationId });
  return deviceId;
}

describe("A773 requested lifecycle: serving", () => {
  it("serves a dish waiting for the pass, leaving its kitchen item as it was", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");
      const before = await item(tx, burger.itemId!);
      expect(before).toMatchObject({ requestedAt: AT, firedAt: null, passControlled: true });

      const { revision } = await serve(tx, venue, burger.id);
      expect(revision).toBeGreaterThan(0);
      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(1000);
      expect(await item(tx, burger.itemId!)).toEqual(before);
    });
  });

  it("takes back a served waiting dish, and a later release never sweeps it once served", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");
      const before = await item(tx, burger.itemId!);
      expect(before).toMatchObject({ requestedAt: AT, firedAt: null });

      await serve(tx, venue, burger.id);
      await unserve(tx, venue, burger.id);
      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(0);
      expect(await item(tx, burger.itemId!)).toEqual(before);

      await serve(tx, venue, burger.id);
      const jobsBefore = await jobCount(tx);
      const laterAt = new Date(Date.parse(AT) + 60_000);
      await fireOrderLines(
        tx,
        venue.cfg,
        venue.party.tabId,
        [burger.id],
        undefined,
        routingOnce(tx, venue.cfg, laterAt),
      );
      expect(await item(tx, burger.itemId!)).toEqual(before);
      expect(await jobCount(tx)).toBe(jobsBefore);
    });
  });

  it("serves a whole group holding a waiting burger and a released drink", async () => {
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
      const placed = await fireNow(tx, venue, [dish(venue, "burger"), dish(venue, "water")]);
      const burger = await lineOf(tx, venue, "burger");
      const water = await lineOf(tx, venue, "water");
      expect(await item(tx, burger.itemId!)).toMatchObject({ firedAt: null, requestedAt: AT });
      expect(await item(tx, water.itemId!)).toMatchObject({ firedAt: AT });

      await markGroupServed(
        tx,
        venue.cfg,
        venue.party.partyId,
        placed.groups[0]!.id,
        await args(tx, venue),
      );
      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(1000);
      expect((await lineOf(tx, venue, "water")).servedQuantity).toBe(1000);
    });
  });

  it("serves a released burger whose chips wait for the pass, and the chips with it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await fireNow(tx, venue, [dish(venue, "burger", true)]);
      const burger = await lineOf(tx, venue, "burger");
      const chips = await lineOf(tx, venue, "chips");
      expect(await item(tx, burger.itemId!)).toMatchObject({ firedAt: AT });
      expect(await item(tx, chips.itemId!)).toMatchObject({ requestedAt: AT, firedAt: null });

      await serve(tx, venue, burger.id);
      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(1000);
      expect((await lineOf(tx, venue, "chips")).servedQuantity).toBe(1000);
    });
  });

  it("serves a burger made here in a held group while its chips wait at the Fryer", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      const here = await madeHereDevice(tx, venue.stations.grill);
      await placeGroups(tx, { ...venue.cfg, sendingDeviceId: here }, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger", true)], release: "hold" }],
      });
      const burger = await lineOf(tx, venue, "burger");
      const chips = await lineOf(tx, venue, "chips");
      expect(await item(tx, burger.itemId!)).toMatchObject({ state: "ready", firedAt: AT });
      expect(await item(tx, chips.itemId!)).toMatchObject({ requestedAt: AT, firedAt: null });

      await serve(tx, venue, burger.id);
      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(1000);
    });
  });

  it("refuses serving a burger whose chips are held again", async () => {
    const venue = await setupSplitExtrasVenue();
    const { burgerId } = await withTransaction(db, async (tx) => {
      await holdThenFire(tx, venue, [dish(venue, "burger", true)]);
      const chips = await lineOf(tx, venue, "chips");
      await holdChipsAgain(tx, chips.id);
      expect(await item(tx, chips.itemId!)).toMatchObject({ requestedAt: null, firedAt: null });
      return { burgerId: (await lineOf(tx, venue, "burger")).id };
    });
    const revisionBefore = await withTransaction(db, (tx) =>
      partyRevision(tx, venue.party.partyId),
    );
    await expect(
      withTransaction(db, async (tx) => serve(tx, venue, burgerId)),
    ).rejects.toMatchObject({ code: "group.line_held" });
    await withTransaction(db, async (tx) => {
      expect(await partyRevision(tx, venue.party.partyId)).toBe(revisionBefore);
      expect((await lines(tx, venue)).map((line) => line.servedQuantity)).toEqual([0, 0]);
    });
  });

  it("offers Serve in Current orders exactly where serving is accepted", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const burgerLines = async () =>
        (await lines(tx, venue)).filter((line) => line.productId === venue.products.burger);

      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger")]);
      const requested = (await burgerLines())[0]!;
      expect(await item(tx, requested.itemId!)).toMatchObject({ requestedAt: AT, firedAt: null });

      await setStationsWaitForPass(tx, false, [venue.stations.grill]);
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await fireNow(tx, venue, [dish(venue, "burger", true)]);
      const withRequestedChips = (await burgerLines())[1]!;

      await setStationsWaitForPass(tx, false, [venue.stations.fryer]);
      await holdThenFire(tx, venue, [dish(venue, "burger", true)]);
      const withHeldChips = (await burgerLines())[2]!;
      const heldChips = (await lines(tx, venue)).find(
        (line) => line.parentLineId === withHeldChips.id,
      )!;
      await holdChipsAgain(tx, heldChips.id);

      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const inHeldGroup = (await burgerLines())[3]!;

      const current = await readCurrentOrders(tx, venue.party.partyId);
      expect(rowFor(current, requested.id).released).toBe(true);
      expect(rowFor(current, withRequestedChips.id).released).toBe(true);
      expect(rowFor(current, withHeldChips.id).released).toBe(false);
      expect(rowFor(current, inHeldGroup.id).released).toBe(false);
    });
  });

  it("serves a burger and chips released before the request time existed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await fireNow(tx, venue, [dish(venue, "burger", true)]);
      await tx
        .update(ticketItems)
        .set({ requestedAt: null })
        .where(eq(ticketItems.workingOrderId, venue.party.tabId));
      const burger = await lineOf(tx, venue, "burger");
      const chips = await lineOf(tx, venue, "chips");
      expect(await item(tx, burger.itemId!)).toMatchObject({ requestedAt: null, firedAt: AT });
      expect(await item(tx, chips.itemId!)).toMatchObject({ requestedAt: null, firedAt: AT });

      const current = await readCurrentOrders(tx, venue.party.partyId);
      expect(rowFor(current, burger.id).released).toBe(true);

      await serve(tx, venue, burger.id);
      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(1000);
      expect((await lineOf(tx, venue, "chips")).servedQuantity).toBe(1000);
    });
  });
  it("sends a no-preparation water with a waiting burger in one group, and it reads released", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger"), dish(venue, "water")]);
      const burger = await lineOf(tx, venue, "burger");
      const water = await lineOf(tx, venue, "water");
      expect(water.itemId).toBeNull();
      expect(await item(tx, burger.itemId!)).toMatchObject({ requestedAt: AT, firedAt: null });
      expect((await lineRow(tx, water.id)).sentAt).toBe(AT);
      expect(await ticketlessReleased(tx, water.id)).toBe(true);
    });
  });

  it("sends a no-preparation water added later to a course whose burger waits, and it reads released", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const first = await createCourse(tx, venue.cfg, { name: "First", displayOrder: 5 });
      const later = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 6 });
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "burger"), courseId: first.id, hold: true },
        { ...dish(venue, "burger"), courseId: later.id, release: true },
      ]);
      const [held, requested] = (await lines(tx, venue)).filter(
        (line) => line.productId === venue.products.burger,
      );
      expect(await item(tx, held!.itemId!)).toMatchObject({ requestedAt: null, firedAt: null });
      expect(await item(tx, requested!.itemId!)).toMatchObject({
        requestedAt: AT,
        firedAt: null,
      });

      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "water"), courseId: later.id },
      ]);
      const water = await lineOf(tx, venue, "water");
      expect(water.itemId).toBeNull();
      expect((await lineRow(tx, water.id)).sentAt).toBe(AT);
      expect(await ticketlessReleased(tx, water.id)).toBe(true);
    });
  });

  it("serves and takes back one of two waiting burgers, with one portion of their chips", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "burger", true), quantity: "2" },
      ]);
      const burger = await lineOf(tx, venue, "burger");
      const chips = await lineOf(tx, venue, "chips");
      const before = await item(tx, burger.itemId!);
      expect(before).toMatchObject({ requestedAt: AT, firedAt: null });
      expect(await item(tx, chips.itemId!)).toMatchObject({ firedAt: AT });
      expect((await lineRow(tx, burger.id)).quantity).toBe(2000);
      expect((await lineRow(tx, chips.id)).quantity).toBe(2000);

      await serve(tx, venue, burger.id, "1");
      expect(await lineRow(tx, burger.id)).toMatchObject({ servedQuantity: 1000, servedAt: null });
      expect((await lineRow(tx, chips.id)).servedQuantity).toBe(1000);
      expect(await item(tx, burger.itemId!)).toEqual(before);

      await unserve(tx, venue, burger.id, "1");
      expect((await lineRow(tx, burger.id)).servedQuantity).toBe(0);
      expect((await lineRow(tx, chips.id)).servedQuantity).toBe(0);
      expect(await item(tx, burger.itemId!)).toEqual(before);
    });
  });
});
