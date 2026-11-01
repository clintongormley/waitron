import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  kitchenStations,
  parties,
  printJobs,
  ticketItemMoves,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, persons } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { AppError } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  departmentReceipts,
  retargetOrderServiceContext,
  setDepartmentTransferSettings,
  setProfileServiceScope,
} from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { moveLinesToGroup } from "./testing/group-composition-fixture.js";
import { moveDishesToStation, placeOrder } from "./testing/order-writer-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { counterOrder, OPERATOR, setupPartyVenue } from "./testing/party-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedClosingBody } from "./testing/party-close-fixture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { withStationDishes } from "./station-closing.js";
import { mountTillApi } from "./till-api.js";
import { LiveEvents } from "./live-api.js";
import { requestCfg } from "./request-config.js";
import { DEVICE_COOKIE } from "./device-session.js";
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
const LATEST = "2026-03-14T12:10:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const dish = (venue: Venue, product: "burger" | "water") => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
});

async function jobCounts(tx: Transaction, venue: Venue) {
  const counts: Record<string, number> = {};
  for (const [name, id] of Object.entries(venue.printers))
    counts[name] = (
      await tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, id))
    ).length;
  return counts;
}

async function slips(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
      .orderBy(printJobs.createdAt, printJobs.id)
  ).map((job) => decodeTicket(job.payload));
}

async function lineOf(tx: Transaction, venue: Venue, product: "burger" | "water") {
  const found = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, venue.party.tabId));
  const matching = found.filter((line) => line.productId === venue.products[product]);
  expect(matching).toHaveLength(1);
  return matching[0]!;
}

async function itemOf(tx: Transaction, lineId: string) {
  const items = await tx
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  expect(items).toHaveLength(1);
  return items[0]!;
}

async function movesOf(tx: Transaction, lineId: string) {
  return tx
    .select({ from: ticketItemMoves.fromStationId, to: ticketItemMoves.toStationId })
    .from(ticketItemMoves)
    .where(eq(ticketItemMoves.workingOrderLineId, lineId))
    .orderBy(ticketItemMoves.movedAt);
}

const mover = (venue: Venue) => ({ deviceId: venue.cfg.origin.deviceId, personId: OPERATOR });

async function move(tx: Transaction, venue: Venue, lineId: string, stationId: string) {
  return moveDishesToStation(
    tx,
    venue.cfg,
    venue.party.tabId,
    { submissionId: randomUUID(), lineIds: [lineId], stationId },
    mover(venue),
  );
}

async function placeFireNow(tx: Transaction, venue: Venue) {
  return placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
  });
}

describe("A773 requested lifecycle: station move", () => {
  it("keeps a Requested dish Requested, printing nothing, when moved to a waiting station and then to one that does not wait", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.kitchen]);
      await placeFireNow(tx, venue);
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemOf(tx, burger.id)).toMatchObject({
        stationId: venue.stations.grill,
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      const counts = await jobCounts(tx, venue);

      vi.setSystemTime(new Date(LATER));
      await move(tx, venue, burger.id, venue.stations.kitchen);
      expect(await itemOf(tx, burger.id)).toMatchObject({
        stationId: venue.stations.kitchen,
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      expect(await movesOf(tx, burger.id)).toEqual([
        { from: venue.stations.grill, to: venue.stations.kitchen },
      ]);
      expect(await jobCounts(tx, venue)).toEqual(counts);

      vi.setSystemTime(new Date(LATEST));
      await move(tx, venue, burger.id, venue.stations.bar);
      expect(await itemOf(tx, burger.id)).toMatchObject({
        stationId: venue.stations.bar,
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      expect(await movesOf(tx, burger.id)).toEqual([
        { from: venue.stations.grill, to: venue.stations.kitchen },
        { from: venue.stations.kitchen, to: venue.stations.bar },
      ]);
      expect(await jobCounts(tx, venue)).toEqual(counts);
    });
  });

  it("never holds released work moved to a station that waits, and prints its ticket there from the old station", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await placeFireNow(tx, venue);
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemOf(tx, burger.id)).toMatchObject({
        stationId: venue.stations.grill,
        firedAt: AT,
      });
      await setStationsWaitForPass(tx, true, [venue.stations.kitchen]);
      const counts = await jobCounts(tx, venue);

      vi.setSystemTime(new Date(LATER));
      await move(tx, venue, burger.id, venue.stations.kitchen);

      expect(await itemOf(tx, burger.id)).toMatchObject({
        stationId: venue.stations.kitchen,
        requestedAt: AT,
        firedAt: AT,
      });
      const added = (await slips(tx, venue.printers.kitchen)).slice(counts.kitchen);
      expect(added).toHaveLength(1);
      expect(added[0]).toContain("From Grill");
      expect(added[0]).toContain("1.000 x BURG");
    });
  });

  it("sends a Requested dish on with station closing's send choice, still Requested and printing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeFireNow(tx, venue);
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemOf(tx, burger.id)).toMatchObject({ requestedAt: AT, firedAt: null });
      const counts = await jobCounts(tx, venue);

      vi.setSystemTime(new Date(LATER));
      await withStationDishes(
        tx,
        venue.cfg,
        venue.stations.grill,
        venue.stations.kitchen,
        "send",
        async () => {},
        mover(venue),
      );

      expect(await itemOf(tx, burger.id)).toMatchObject({
        stationId: venue.stations.kitchen,
        requestedAt: AT,
        firedAt: null,
        passControlled: true,
      });
      expect(await movesOf(tx, burger.id)).toEqual([
        { from: venue.stations.grill, to: venue.stations.kitchen },
      ]);
      expect(await jobCounts(tx, venue)).toEqual(counts);
    });
  });

  it("lists a Requested dish as outstanding work on a department transfer", async () => {
    const v = await setupPartyVenue(db);
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Transfer operator", pinHash: hashPin("5555"), role: "staff" })
      .returning();
    const app = new Hono();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
        db,
        liveEvents: new LiveEvents(),
        cfg: v.cfg,
        backend: v.backend,
        clock: v.clock,
        secureCookies: false,
        venueLocale: v.cfg.locale,
      },
      () => {},
    );
    const f = await withTransaction(db, async (tx) => {
      const a = await createDepartment(tx, v.cfg, { name: randomUUID(), orderStart: "table" });
      const b = await createDepartment(tx, v.cfg, { name: randomUUID(), orderStart: "table" });
      await tx.insert(departmentReceipts).values(
        [a, b].map((department) => ({
          departmentId: department.id,
          receipt: { operationDescription: "Restaurante" },
        })),
      );
      const az = await createServiceZone(tx, v.cfg, { name: randomUUID(), departmentId: a.id });
      const bz = await createServiceZone(tx, v.cfg, { name: randomUUID(), departmentId: b.id });
      const profiles: string[] = [];
      for (const [departmentId, zoneId] of [
        [a.id, az.id],
        [b.id, bz.id],
      ] as const) {
        const [profile] = await tx
          .insert(deviceProfiles)
          .values({ name: randomUUID(), formFactor: "till", capabilities: [...CAPABILITY_FLAGS] })
          .returning();
        await setProfileServiceScope(tx, v.cfg, profile!.id, {
          departmentId,
          allowedZoneIds: [zoneId],
          startingZoneId: zoneId,
        });
        profiles.push(profile!.id);
      }
      await setDepartmentTransferSettings(tx, v.cfg, a.id, {
        receivingProfileId: null,
        destinationDepartmentIds: [b.id],
      });
      await setDepartmentTransferSettings(tx, v.cfg, b.id, {
        receivingProfileId: profiles[1]!,
        destinationDepartmentIds: [],
      });
      const stations = await tx.select({ id: kitchenStations.id }).from(kitchenStations);
      await setStationsWaitForPass(
        tx,
        true,
        stations.map((station) => station.id),
      );
      return { a: a.id, b: b.id, az: az.id, source: profiles[0]!, desk: profiles[1]! };
    });
    async function login(profileId: string) {
      const device = await enrolDeviceForTest(db, v.cfg, { name: randomUUID(), profileId });
      const response = await app.request("/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
        },
        body: JSON.stringify({ personId: person!.id, pin: "5555" }),
      });
      expect(response.status).toBe(200);
      return {
        cookie: response.headers.get("set-cookie")!.split(";")[0]!,
        deviceId: device.deviceId,
      };
    }
    const source = await login(f.source);
    const desk = await login(f.desk);
    const tab = await counterOrder(v, "Burger");
    await withTransaction(db, (tx) => retargetOrderServiceContext(tx, v.cfg, tab, f.az));
    await placeOrder(
      { admission: testTradingAdmission(), db, backend: v.backend, clock: v.clock },
      requestCfg(v.cfg, source),
      tab,
      person!.id,
    );
    const [item] = await db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, tab));
    expect(item).toMatchObject({ firedAt: null, passControlled: true, state: "queued" });
    expect(item!.requestedAt).not.toBeNull();
    const path = `/api/working-orders/${tab}/department-transfers`;
    const sent = await app.request(path, {
      method: "POST",
      headers: { cookie: source.cookie, "content-type": "application/json" },
      body: JSON.stringify(await observedClosingBody(db, path, { destinationDepartmentId: f.b })),
    });
    expect(sent.status).toBe(200);
    const { id } = (await sent.json()) as { id: string };

    const detail = await app.request(`/api/department-transfers/${id}`, {
      headers: { cookie: desk.cookie },
    });

    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { outstandingWork: unknown[] };
    expect(body.outstandingWork).toEqual([
      expect.objectContaining({
        id: item!.id,
        lineId: item!.workingOrderLineId,
        stationId: item!.stationId,
        state: "queued",
        firedAt: null,
      }),
    ]);
  });

  it("refuses to move a Requested dish into a held group, writing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      return placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          { lines: [dish(venue, "burger")], release: "fire" },
          { lines: [dish(venue, "water")], release: "hold" },
        ],
      });
    });
    const frozen = () =>
      withTransaction(db, async (tx) => ({
        lines: await tx.select().from(workingOrderLines).orderBy(workingOrderLines.id),
        items: await tx.select().from(ticketItems).orderBy(ticketItems.id),
        jobs: await tx.select().from(printJobs).orderBy(printJobs.id),
      }));
    const burgerId = await withTransaction(db, async (tx) => {
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemOf(tx, burger.id)).toMatchObject({ requestedAt: AT, firedAt: null });
      return burger.id;
    });
    const before = await frozen();

    const error = await withTransaction(db, async (tx) => {
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      return moveLinesToGroup(
        tx,
        venue.cfg,
        venue.party.partyId,
        [{ lineId: burgerId, quantity: "1" }],
        { groupId: placed.groups[1]!.id },
        {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: party!.revision,
        },
      );
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("group.not_held");
    expect(await frozen()).toEqual(before);
  });
});
