import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { addTabRound, sendLines, updateOrderLine } from "./testing/order-writer-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { createCourse, setProductCourse } from "./kitchen.js";
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
afterEach(() => {
  vi.useRealTimers();
});

const AT = "2026-03-14T12:00:00.000Z";
const EDIT_AT = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
type Dish = "burger" | "water";

function line(venue: Venue, dish: Dish, quantity = "1", chips = 0, rings = 0) {
  const picks = [
    ...(chips ? [{ productId: venue.products.chips, quantity: chips }] : []),
    ...(rings ? [{ productId: venue.products.onionRings, quantity: rings }] : []),
  ];
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
      stationId: ticketItems.stationId,
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      passControlled: ticketItems.passControlled,
      state: ticketItems.state,
      readyAt: ticketItems.readyAt,
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

function burgerWithChips(venue: Venue) {
  return {
    productId: venue.products.burger,
    quantity: "1",
    extras: [
      { listId: venue.lists.burger, picks: [{ productId: venue.products.chips, quantity: 1 }] },
    ],
  };
}

describe("A773 waiter request: extras", () => {
  it("requests chips at a waiting Fryer while their burger is released at Grill", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      const orderId = await fireNewOrder(tx, venue.cfg, [burgerWithChips(venue)]);
      const rows = await items(tx, orderId);
      const burger = rows.find((row) => row.productId === venue.products.burger)!;
      const chips = rows.find((row) => row.productId === venue.products.chips)!;
      expect(burger).toMatchObject({ requestedAt: AT, firedAt: AT, passControlled: false });
      expect(chips).toMatchObject({
        stationId: venue.stations.fryer,
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      const grill = await jobsAt(tx, venue.printers.grill);
      expect(grill).toHaveLength(1);
      expect(grill[0]).toContain("1.000 x BURG");
      expect(await jobsAt(tx, venue.printers.fryer)).toEqual([]);
      // The Pass printer serves Grill and Fryer: it gets Grill's ticket and no Fryer ticket.
      expect(await jobsAt(tx, venue.printers.pass)).toEqual(grill);
    });
  });

  it("releases chips at Fryer while their burger is requested at a waiting Grill", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const orderId = await fireNewOrder(tx, venue.cfg, [burgerWithChips(venue)]);
      const rows = await items(tx, orderId);
      const burger = rows.find((row) => row.productId === venue.products.burger)!;
      const chips = rows.find((row) => row.productId === venue.products.chips)!;
      expect(burger).toMatchObject({ requestedAt: AT, firedAt: null, passControlled: true });
      expect(chips).toMatchObject({ requestedAt: AT, firedAt: AT, passControlled: false });
      expect((await jobsAt(tx, venue.printers.fryer)).join("\n")).toContain("CHIPS");
    });
  });

  it("requests the chips a released no-preparation water gains at a send", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const courseId = await withTransaction(db, async (tx) => {
      const course = await createCourse(tx, venue.cfg, { name: "Later", displayOrder: 2 });
      await setProductCourse(tx, venue.cfg, venue.products.water, course.id);
      return course.id;
    });
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...line(venue, "water"), courseId, hold: true },
      ]);
      const [water] = await tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, venue.party.tabId));
      const [child] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: venue.party.tabId,
          lineNo: water!.lineNo + 1,
          name: "Chips",
          productId: venue.products.chips,
          kitchenName: "CHIPS",
          descriptions: { "es-ES": "Hand-cut fries" },
          quantity: 1000,
          unitPriceGross: 100,
          vatClass: "general",
          lineTotal: 100,
          courseId,
          parentLineId: water!.id,
          extraListId: venue.lists.water,
        })
        .returning({ id: workingOrderLines.id });
      expect(await items(tx, venue.party.tabId)).toEqual([]);
      await sendLines(tx, venue.cfg, venue.party.tabId, []);
      const [sent] = await tx
        .select({ sentAt: workingOrderLines.sentAt })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, water!.id));
      expect(sent!.sentAt).not.toBeNull();
      expect(await items(tx, venue.party.tabId)).toEqual([
        expect.objectContaining({
          lineId: child!.id,
          stationId: venue.stations.fryer,
          requestedAt: AT,
          firedAt: null,
          passControlled: true,
        }),
      ]);
      expect(await jobsAt(tx, venue.printers.fryer)).toEqual([]);
      expect(await jobsAt(tx, venue.printers.pass)).toEqual([]);
    });
  });

  it("makes chips ready where they are made here, even at a waiting station", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Bar till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id });
      const [here] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          deviceProfileId: profile!.id,
          label: "Here",
          tokenHash: `here-${randomUUID()}`,
        })
        .returning({ id: devices.id });
      await tx
        .insert(deviceMadeHereStations)
        .values({ deviceId: here!.id, stationId: venue.stations.fryer });
      const placed = await placeGroups(
        tx,
        { ...venue.cfg, sendingDeviceId: here!.id },
        venue.party.partyId,
        {
          operatorId: OPERATOR,
          groups: [{ lines: [line(venue, "burger", "1", 1)], release: "hold" }],
        },
      );
      const rows = await items(tx, placed.tabId);
      const burger = rows.find((row) => row.productId === venue.products.burger)!;
      const chips = rows.find((row) => row.productId === venue.products.chips)!;
      expect(chips).toMatchObject({
        state: "ready",
        requestedAt: AT,
        firedAt: AT,
        readyAt: AT,
        passControlled: false,
      });
      expect(burger).toMatchObject({ requestedAt: null, firedAt: null });
    });
  });

  it("releases chips an edit adds to a requested burger by the Fryer's own setting", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [line(venue, "burger")]);
      expect((await items(tx, venue.party.tabId))[0]).toMatchObject({
        requestedAt: AT,
        firedAt: null,
      });
      vi.setSystemTime(new Date(EDIT_AT));
      await edit(tx, venue, 1, { extras: line(venue, "burger", "1", 1).extras });
      const chips = (await items(tx, venue.party.tabId)).find(
        (row) => row.productId === venue.products.chips,
      );
      expect(chips).toMatchObject({ firedAt: expect.any(String), passControlled: false });
      const fryer = (await jobsAt(tx, venue.printers.fryer)).join("\n");
      expect(fryer).toContain("CHIPS");
      expect(fryer).not.toContain("HOLD CHANGED");
    });
  });

  it("requests onion rings an edit adds to a water whose chips are requested", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [line(venue, "water", "1", 1)]);
      const [chipsBefore] = await items(tx, venue.party.tabId);
      expect(chipsBefore).toMatchObject({
        productId: venue.products.chips,
        requestedAt: AT,
        firedAt: null,
      });
      vi.setSystemTime(new Date(EDIT_AT));
      await edit(tx, venue, 1, { extras: line(venue, "water", "1", 1, 1).extras });
      const rows = await items(tx, venue.party.tabId);
      expect(rows.find((row) => row.productId === venue.products.onionRings)).toMatchObject({
        requestedAt: EDIT_AT,
        firedAt: null,
        passControlled: true,
      });
      expect(rows.find((row) => row.id === chipsBefore!.id)).toEqual(chipsBefore);
      expect(await jobsAt(tx, venue.printers.fryer)).toEqual([]);
      expect(await jobsAt(tx, venue.printers.pass)).toEqual([]);
    });
  });

  it("freezes a requested extra's allergy snapshot at the request", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [line(venue, "burger", "1", 1)]);
      const chips = (await items(tx, venue.party.tabId)).find(
        (row) => row.productId === venue.products.chips,
      )!;
      expect(chips).toMatchObject({ firedAt: null, passControlled: true });
      expect((await VENUE_SERVICE.readTicketAllergies(tx, [chips.id])).has(chips.id)).toBe(true);
    });
  });
});
