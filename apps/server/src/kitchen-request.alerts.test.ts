import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
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
import { kitchenNotices, setRoutingCell } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { addTabRound, updateOrderLine } from "./testing/order-writer-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { OPERATOR } from "./testing/party-venue.js";
import { fireGroup } from "./order-groups.js";
import { passScreensDark, stationScreensDark } from "./station-outputs-down.js";
import { readStationDeleteImpact } from "./station-delete.js";
import { enqueueOrderKitchenNoteChange } from "./kitchen-print.js";
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
const minutesAfterAt = (minutes: number) => new Date(Date.parse(AT) + minutes * 60_000);

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const dish = (venue: Venue, product: "burger" | "water", quantity = "1", chips = 0) => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity,
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists[product],
            picks: [{ productId: venue.products.chips, quantity: chips }],
          },
        ],
      }
    : {}),
});

async function items(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      productId: workingOrderLines.productId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      groupId: workingOrderLines.groupId,
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

async function allSlips(tx: Transaction, venue: Venue) {
  const out: Record<string, string[]> = {};
  for (const [name, id] of Object.entries(venue.printers)) out[name] = await slips(tx, id);
  return out;
}

const newSince = (
  before: Record<string, string[]>,
  after: Record<string, string[]>,
  name: string,
) => after[name]!.slice(before[name]!.length);

async function revision(tx: Transaction, id: string) {
  return (
    await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id))
  )[0]!.revision;
}

async function editLine(
  tx: Transaction,
  venue: Venue,
  lineId: string,
  patch: Parameters<typeof updateOrderLine>[4],
) {
  const [line] = await tx
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, lineId));
  return updateOrderLine(
    tx,
    venue.cfg,
    venue.party.tabId,
    line!.lineNo,
    patch,
    await revision(tx, venue.party.tabId),
    OPERATOR,
  );
}

/** A Fire now burger at a waiting Grill, requested at AT and not released. */
async function requestedBurger(venue: Venue) {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
  await withTransaction(db, async (tx) => {
    await setStationsWaitForPass(tx, true, [venue.stations.grill]);
    await placeGroups(tx, venue.cfg, venue.party.partyId, {
      operatorId: OPERATOR,
      groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
    });
    expect(await items(tx, venue.party.tabId)).toEqual([
      expect.objectContaining({ stationId: venue.stations.grill, requestedAt: AT, firedAt: null }),
    ]);
  });
  vi.useRealTimers();
}

async function kdsDevice(
  venue: Venue,
  screen: Parameters<typeof enrolDeviceForTest>[2]["kitchenScreen"],
) {
  const [profile] = await db
    .insert(deviceProfiles)
    .values({ name: randomUUID(), formFactor: "kds", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  const { deviceId } = await enrolDeviceForTest(db, venue.cfg, {
    name: "Screen",
    profileId: profile!.id,
    kitchenScreen: screen,
  });
  const [row] = await db
    .select({ lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.id, deviceId));
  expect(row!.lastSeenAt).toBeNull();
  return deviceId;
}

describe("A773 requested lifecycle: alerts and slips", () => {
  it("lists an unseen pass screen for a dish requested within the hour, not for one requested over an hour ago", async () => {
    const venue = await setupSplitExtrasVenue();
    await requestedBurger(venue);
    const pass = await kdsDevice(venue, {
      kind: "pass",
      stationIds: null,
      zoneIds: [venue.party.zoneId],
    });
    const read = (now: Date) => withTransaction(db, (tx) => passScreensDark(tx, venue.cfg, now));
    expect(await read(minutesAfterAt(5))).toEqual([
      expect.objectContaining({ deviceId: pass, kind: "pass", lastSeenAt: null }),
    ]);
    expect(await read(minutesAfterAt(61))).toEqual([]);
  });

  it("raises no dark-station alert for a dish still waiting for the pass", async () => {
    const venue = await setupSplitExtrasVenue();
    await requestedBurger(venue);
    await kdsDevice(venue, {
      kind: "station",
      stationIds: [venue.stations.grill],
      zoneIds: null,
    });
    const read = () =>
      withTransaction(db, (tx) => stationScreensDark(tx, venue.cfg.locationId, minutesAfterAt(5)));
    expect(await read()).toEqual([]);
    // Control: the same dish released makes the same dark screen an alert.
    await db.execute(
      sql`update ticket_items set fired_at = requested_at where working_order_id = ${venue.party.tabId}`,
    );
    expect(await read()).toEqual([expect.objectContaining({ stationId: venue.stations.grill })]);
  });

  it("counts a requested dish as open work when its station is deleted", async () => {
    const venue = await setupSplitExtrasVenue();
    await requestedBurger(venue);
    const impact = await withTransaction(db, (tx) =>
      readStationDeleteImpact(tx, venue.cfg, venue.stations.grill),
    );
    expect(impact.refusals.find((r) => r.code === "station.work_in_progress")).toMatchObject({
      params: { stationId: venue.stations.grill, count: 1 },
      targets: [{ id: venue.party.tabId }],
    });
  });

  it("prints no void at Grill for a requested burger when its line is cut to one, and voids the released chips at Fryer", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger", "2", 1)]);
      const rows = await items(tx, venue.party.tabId);
      const burger = rows.find((row) => row.productId === venue.products.burger)!;
      expect(burger).toMatchObject({ quantity: 2000, requestedAt: AT, firedAt: null });
      expect(rows.find((row) => row.productId === venue.products.chips)).toMatchObject({
        stationId: venue.stations.fryer,
        firedAt: AT,
      });
      const before = await allSlips(tx, venue);
      vi.setSystemTime(new Date(LATER));
      await editLine(tx, venue, burger.lineId, { quantity: "1" });
      const after = await allSlips(tx, venue);
      expect(newSince(before, after, "grill")).toEqual([]);
      const fryer = newSince(before, after, "fryer");
      expect(fryer).toHaveLength(1);
      expect(fryer[0]).toContain("VOID");
      expect(fryer[0]).toContain("CHIPS");
      // The pass prints a copy of Fryer's void and nothing of the burger's own.
      expect(newSince(before, after, "pass")).toEqual(fryer);
      // With no void, the pass's later release works from this reduced quantity.
      const cut = (await items(tx, venue.party.tabId)).find((row) => row.id === burger.id);
      expect(cut).toMatchObject({ quantity: 1000, requestedAt: AT, firedAt: null });
    });
  });

  it("prints no HOLD CHANGED for a requested burger in a fired group whose HOLD ticket printed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      expect((await slips(tx, venue.printers.grill)).join("\n")).toContain("*** HOLD ***");
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      await fireGroup(tx, venue.cfg, venue.party.partyId, placed.groups[0]!.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
      });
      const [burger] = await items(tx, venue.party.tabId);
      expect(burger).toMatchObject({ requestedAt: AT, firedAt: null });
      const before = await allSlips(tx, venue);
      vi.setSystemTime(new Date(LATER));
      await editLine(tx, venue, burger!.lineId, { note: "No salt" });
      const after = await allSlips(tx, venue);
      for (const name of Object.keys(venue.printers))
        expect(newSince(before, after, name)).toEqual([]);
    });
  });

  it("sends an order-note change for the released water alone, nothing for a requested burger", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
        { kind: "station", stationId: venue.stations.bar },
      );
      await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.grill]);
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger"), dish(venue, "water")], release: "fire" }],
      });
      const rows = await items(tx, venue.party.tabId);
      expect(rows.find((row) => row.productId === venue.products.burger)).toMatchObject({
        requestedAt: AT,
        firedAt: null,
      });
      expect(rows.find((row) => row.productId === venue.products.water)).toMatchObject({
        stationId: venue.stations.bar,
        firedAt: AT,
      });
      const before = await allSlips(tx, venue);
      const noticesBefore = await tx.select({ id: kitchenNotices.id }).from(kitchenNotices);
      await enqueueOrderKitchenNoteChange(tx, venue.cfg, [venue.party.tabId], {
        before: "Old",
        after: "New",
      });
      const after = await allSlips(tx, venue);
      expect(newSince(before, after, "bar")).toHaveLength(1);
      for (const name of ["grill", "pass", "fryer", "kitchen"])
        expect(newSince(before, after, name)).toEqual([]);
      const seen = new Set(noticesBefore.map((row) => row.id));
      const added = (
        await tx
          .select({ id: kitchenNotices.id, stationId: kitchenNotices.stationId })
          .from(kitchenNotices)
      ).filter((row) => !seen.has(row.id));
      expect(added.map((row) => row.stationId)).toEqual([venue.stations.bar]);
    });
  });
});
