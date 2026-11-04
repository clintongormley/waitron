import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  parties,
  ticketItems,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import type { DeviceKitchenScreen } from "@waitron/module";
import { persons } from "@waitron/identity";
import { setProfileServiceAccess, zoneServicePolicies } from "@waitron/venue-service";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { openTillSession } from "./testing/session-device.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readScopedPassBoard } from "./pass-board.js";
import type { PassCard } from "./pass-card.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import { readPassCoverage, type PassCoverageGap } from "./pass-coverage.js";
import { deleteStation } from "./station-delete.js";
import { byText } from "./text-order.js";
import { markServed } from "./working-order.js";
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

const ALL_PASS: CapabilityFlag[] = ["act-as-kds", "prepare-orders", "run-the-pass"];
const TILL_PASS: CapabilityFlag[] = [...ALL_PASS, "show-expo"];
const STATION_NAMES = { grill: "Grill", fryer: "Fryer", kitchen: "Kitchen", bar: "Bar" } as const;

/** A device on a profile of its own, a kitchen display's unless `formFactor` says otherwise, with
 *  exactly `capabilities`. */
async function kitchenDisplay(
  venue: Venue,
  name: string,
  kitchenScreen: DeviceKitchenScreen,
  capabilities: CapabilityFlag[] = ALL_PASS,
  formFactor: FormFactor = "kds",
): Promise<{ deviceId: string; profileId: string }> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({ name: `${name} profile`, formFactor, capabilities })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(db, venue.cfg, {
    name,
    profileId: profile!.id,
    kitchenScreen,
  });
  return { deviceId: joined.deviceId, profileId: profile!.id };
}

const passOn = (
  venue: Venue,
  name: string,
  stationIds: string[] | null,
  zoneIds: string[] | null = null,
) => kitchenDisplay(venue, name, { kind: "pass", stationIds, zoneIds });

const coverage = () => withTransaction(db, (tx) => readPassCoverage(tx));

const waiting = (venue: Venue, ...stations: (keyof typeof STATION_NAMES)[]) =>
  withTransaction(db, (tx) =>
    setStationsWaitForPass(
      tx,
      true,
      stations.map((station) => venue.stations[station]),
    ),
  );

/** The venue's active zones in display order, read rather than assumed. */
async function zonesInOrder(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: floorZones.id, name: floorZones.name })
    .from(floorZones)
    .where(eq(floorZones.active, true))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
}

/** The expected gaps for `pairs`, in D102's order: by zone, then station name. */
async function gaps(
  venue: Venue,
  pairs: [keyof typeof STATION_NAMES, string][],
): Promise<PassCoverageGap[]> {
  const zones = await zonesInOrder();
  const zoneIndex = (id: string) => zones.findIndex((zone) => zone.id === id);
  return pairs
    .map(([station, zoneId]) => ({
      stationId: venue.stations[station],
      stationName: STATION_NAMES[station],
      zoneId,
      zoneName: zones.find((zone) => zone.id === zoneId)!.name,
    }))
    .sort(
      (a, b) =>
        zoneIndex(a.zoneId) - zoneIndex(b.zoneId) ||
        byText(a.stationName, b.stationName) ||
        byText(a.stationId, b.stationId),
    );
}

describe("A773 station policy: pass coverage", () => {
  it("case 1: no station waits, so nothing is a gap, even with no pass device", async () => {
    await setupSplitExtrasVenue();
    expect(await zonesInOrder()).toHaveLength(2);
    expect(await coverage()).toEqual([]);
  });

  it("case 2: a waiting station with no pass device is a gap in every zone", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const T = venue.party.zoneId;
    const C = venue.counter.zoneId;
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", T],
        ["grill", C],
      ]),
    );
  });

  it("case 3: an every-station every-zone pass covers everything", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill", "fryer");
    await passOn(venue, "Every pass", null);
    expect(await coverage()).toEqual([]);
  });

  it("case 4: a pass on Grill in the tables zone leaves Grill in the counter zone", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await passOn(venue, "Tables pass", [venue.stations.grill], [venue.party.zoneId]);
    expect(await coverage()).toEqual(await gaps(venue, [["grill", venue.counter.zoneId]]));
  });

  it("case 4: a pass on Bar alone leaves Grill in both zones", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await passOn(venue, "Bar pass", [venue.stations.bar]);
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", venue.party.zoneId],
        ["grill", venue.counter.zoneId],
      ]),
    );
  });

  it("case 4: a pass whose one zone was deactivated has no zone left; the deactivated zone is no pair", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await passOn(venue, "Tables pass", [venue.stations.grill], [venue.party.zoneId]);
    await withTransaction(db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.party.zoneId)),
    );
    expect(await coverage()).toEqual(await gaps(venue, [["grill", venue.counter.zoneId]]));
  });

  it("case 5: hot and cold passes each cover their own station", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill", "fryer");
    await passOn(venue, "Hot pass", [venue.stations.grill]);
    await passOn(venue, "Cold pass", [venue.stations.fryer], [venue.party.zoneId]);
    expect(await coverage()).toEqual(await gaps(venue, [["fryer", venue.counter.zoneId]]));
  });

  it("case 6: a pass monitor covers nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await kitchenDisplay(venue, "Monitor", {
      kind: "pass_monitor",
      stationIds: null,
      zoneIds: null,
    });
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", venue.party.zoneId],
        ["grill", venue.counter.zoneId],
      ]),
    );
  });

  it.each([
    ["run-the-pass", ["act-as-kds", "prepare-orders"]],
    ["prepare-orders", ["act-as-kds", "run-the-pass"]],
  ] as const)("case 7: a profile without %s covers nothing", async (_missing, capabilities) => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await kitchenDisplay(venue, "Short pass", { kind: "pass", stationIds: null, zoneIds: null }, [
      ...capabilities,
    ]);
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", venue.party.zoneId],
        ["grill", venue.counter.zoneId],
      ]),
    );
  });

  it("case 8: a disabled pass device covers nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const pass = await passOn(venue, "Every pass", null);
    await withTransaction(db, (tx) =>
      tx.update(devices).set({ active: false }).where(eq(devices.id, pass.deviceId)),
    );
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", venue.party.zoneId],
        ["grill", venue.counter.zoneId],
      ]),
    );
  });

  it("case 9: a pass screen a profile narrowing took covers nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const pass = await passOn(venue, "Narrowed", null);
    await withTransaction(db, (tx) =>
      VENUE_SERVICE.setProfileKitchenScreens(tx, pass.profileId, {
        station: { stationIds: null, zoneIds: null },
      }),
    );
    const screens = await withTransaction(db, (tx) =>
      VENUE_SERVICE.readDeviceKitchenScreens(tx, pass.deviceId),
    );
    expect(screens.find((screen) => screen.kind === "pass")).toMatchObject({ available: false });
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", venue.party.zoneId],
        ["grill", venue.counter.zoneId],
      ]),
    );
  });

  it("case 10: a till pass whose profile serves only the tables zone leaves the counter zone", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await tablesTillPass(venue);
    expect(await coverage()).toEqual(await gaps(venue, [["grill", venue.counter.zoneId]]));
  });

  it("case 14: a till or handheld whose profile has the Pass button off covers nothing, though its Fire still releases", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const both = await gaps(venue, [
      ["grill", venue.party.zoneId],
      ["grill", venue.counter.zoneId],
    ]);
    const every: DeviceKitchenScreen = { kind: "pass", stationIds: null, zoneIds: null };
    await kitchenDisplay(venue, "Handheld pass", every, ALL_PASS, "phone-portrait");
    await burgerAtTable(venue, "fire");
    const pass = await tablesTillPass(venue, ALL_PASS);
    expect(await coverage()).toEqual(both);
    const [card] = await toFire(pass.by);
    expect(card!.releaseTicketItemIds).toHaveLength(1);
    expect(await release(venue, pass.by, card!)).toEqual({
      releasedTicketItemIds: card!.releaseTicketItemIds,
    });
    await kitchenDisplay(venue, "Handheld pass on", every, TILL_PASS, "phone-portrait");
    expect(await coverage()).toEqual([]);
  });

  it("case 13: the till pass's Fire refuses the counter dish and releases the table's", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const placed = await withTransaction(db, async (tx) => {
      const group = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [
            {
              lines: [{ menuItemId: venue.tables.offerFor(venue.products.burger), quantity: "1" }],
              release: "fire",
            },
          ],
        })
      ).groups[0]!;
      const counterId = await fireNewOrder(tx, venue.cfg, [
        { productId: venue.products.burger, quantity: "1" },
      ]);
      const [tableItem] = await tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, group.lineIds[0]!));
      return { counterId, tableBurger: tableItem!.id };
    });
    const pass = await tablesTillPass(venue);
    const cards = await toFire(pass.by);
    const counterCard = cards.find((card) => card.target.kind === "bill")!;
    const tableCard = cards.find((card) => card.target.kind === "group")!;
    expect(counterCard.target).toEqual({ kind: "bill", workingOrderId: placed.counterId });

    await expect(release(venue, pass.by, counterCard)).rejects.toMatchObject({
      code: "service_zone.not_allowed",
      params: { zoneId: venue.counter.zoneId },
    });
    expect(await release(venue, pass.by, tableCard)).toEqual({
      releasedTicketItemIds: [placed.tableBurger],
    });
  });

  it("a deleted station is no gap, though deletion leaves it waiting", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill", "fryer");
    await withTransaction(db, (tx) => deleteStation(tx, venue.stations.grill));
    const [grill] = await db
      .select({ active: kitchenStations.active, waitsForPass: kitchenStations.waitsForPass })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, venue.stations.grill));
    expect(grill).toEqual({ active: false, waitsForPass: true });
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["fryer", venue.party.zoneId],
        ["fryer", venue.counter.zoneId],
      ]),
    );
  });

  it("orders gaps by zone display order, then station name", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill", "fryer");
    const T = venue.party.zoneId;
    const C = venue.counter.zoneId;
    await withTransaction(db, async (tx) => {
      await tx.update(floorZones).set({ displayOrder: 2 }).where(eq(floorZones.id, C));
      await tx.update(floorZones).set({ displayOrder: 1 }).where(eq(floorZones.id, T));
    });
    const names = await db
      .select({ id: floorZones.id, name: floorZones.name })
      .from(floorZones)
      .where(eq(floorZones.active, true));
    const nameOf = (id: string) => names.find((zone) => zone.id === id)!.name;
    // Name order alone would put the counter zone first.
    expect(nameOf(C) < nameOf(T)).toBe(true);
    const gap = (station: "grill" | "fryer", zoneId: string) => ({
      stationId: venue.stations[station],
      stationName: STATION_NAMES[station],
      zoneId,
      zoneName: nameOf(zoneId),
    });
    expect(await coverage()).toEqual([
      gap("fryer", T),
      gap("grill", T),
      gap("fryer", C),
      gap("grill", C),
    ]);
  });

  it("orders a switched-off zone's dishes in its place under its name, binary text order within a zone, and no zone last", async () => {
    const venue = await setupSplitExtrasVenue();
    const T = venue.party.zoneId;
    const C = venue.counter.zoneId;
    const renamed = { grill: "Álvaro", fryer: "Zeta", kitchen: "bar", bar: "Bar" } as const;
    await withTransaction(db, async (tx) => {
      for (const [station, name] of Object.entries(renamed))
        await tx
          .update(kitchenStations)
          .set({ name })
          .where(eq(kitchenStations.id, venue.stations[station as keyof typeof renamed]));
      await tx.update(floorZones).set({ displayOrder: 1 }).where(eq(floorZones.id, T));
      await tx.update(floorZones).set({ displayOrder: 2 }).where(eq(floorZones.id, C));
    });
    await waiting(venue, "grill", "fryer", "kitchen", "bar");
    await burgerAtTable(venue, "fire");
    await counterDishInNoZone(venue);
    await withTransaction(db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, T)),
    );
    const gap = (
      station: keyof typeof renamed,
      zoneId: string | null,
      zoneName: string | null,
    ) => ({
      stationId: venue.stations[station],
      stationName: renamed[station],
      zoneId,
      zoneName,
    });
    expect(await coverage()).toEqual([
      gap("grill", T, "Test tables"),
      gap("bar", C, "Test counter"),
      gap("fryer", C, "Test counter"),
      gap("kitchen", C, "Test counter"),
      gap("grill", C, "Test counter"),
      gap("grill", null, null),
    ]);
  });

  it("case 12: with no active zone, a waiting station needs an every-zone pass", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await passOn(venue, "Tables pass", [venue.stations.grill], [venue.party.zoneId]);
    await withTransaction(db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.active, true)),
    );
    expect(await zonesInOrder()).toEqual([]);
    expect(await coverage()).toEqual([
      { stationId: venue.stations.grill, stationName: "Grill", zoneId: null, zoneName: null },
    ]);
    await passOn(venue, "Every pass", null);
    expect(await coverage()).toEqual([]);
  });

  it("case 12: with no active zone, a till pass whose zone list is left empty still covers the no-zone pair", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const pass = await tablesTillPass(venue);
    await withTransaction(db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.active, true)),
    );
    expect(
      await withTransaction(db, (tx) => VENUE_SERVICE.readProfilesZones(tx, [pass.profileId])),
    ).toEqual(new Map([[pass.profileId, []]]));
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 1: a dish waiting at the tables keeps its gap after its station stops waiting", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await burgerAtTable(venue, "fire");
    await stopWaiting(venue);
    expect(await coverage()).toEqual(await gaps(venue, [["grill", venue.party.zoneId]]));
  });

  it("dishes case 2: only a pass that sees the dish's zone covers it", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await burgerAtTable(venue, "fire");
    await stopWaiting(venue);
    await passOn(venue, "Counter pass", [venue.stations.grill], [venue.counter.zoneId]);
    expect(await coverage()).toEqual(await gaps(venue, [["grill", venue.party.zoneId]]));
    await passOn(venue, "Tables pass", [venue.stations.grill], [venue.party.zoneId]);
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 3: a released dish is no gap", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await burgerAtTable(venue, "fire");
    await stopWaiting(venue);
    const pass = await passOn(venue, "Every pass", null);
    const by: PassActor = { deviceId: pass.deviceId, personId: null };
    const [card] = await toFire(by);
    await release(venue, by, card!);
    await withTransaction(db, (tx) =>
      tx.update(devices).set({ active: false }).where(eq(devices.id, pass.deviceId)),
    );
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 4: a held dish at a station that no longer waits is no gap", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await burgerAtTable(venue, "hold");
    await stopWaiting(venue);
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 5: a dish in no zone needs an every-zone pass", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await counterDishInNoZone(venue);
    await stopWaiting(venue);
    await passOn(venue, "Tables pass", [venue.stations.grill], [venue.party.zoneId]);
    await passOn(venue, "Counter pass", [venue.stations.grill], [venue.counter.zoneId]);
    expect(await coverage()).toEqual([
      { stationId: venue.stations.grill, stationName: "Grill", zoneId: null, zoneName: null },
    ]);
    await passOn(venue, "Every pass", null);
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 5: a till pass limited to the tables zone covers a dish in no zone, and its Fire releases it", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const counterId = await counterDishInNoZone(venue);
    await stopWaiting(venue);
    const pass = await tablesTillPass(venue);
    expect(await coverage()).toEqual([]);
    const card = (await toFire(pass.by)).find((candidate) => candidate.target.kind === "bill")!;
    expect(card.target).toEqual({ kind: "bill", workingOrderId: counterId });
    const [item] = await db
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, counterId));
    expect(await release(venue, pass.by, card)).toEqual({ releasedTicketItemIds: [item!.id] });
  });

  it("dishes case 6: a dish served in full is no gap", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const placed = await burgerAtTable(venue, "fire");
    await stopWaiting(venue);
    await withTransaction(db, async (tx) => {
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      await markServed(
        tx,
        venue.cfg,
        venue.party.partyId,
        [{ lineId: placed.lineId, quantity: "1" }],
        {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: party!.revision,
        },
      );
    });
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 6: a dish whose order was abandoned is no gap", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const placed = await burgerAtTable(venue, "fire");
    await stopWaiting(venue);
    await withTransaction(db, (tx) =>
      tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, placed.orderId)),
    );
    expect(await coverage()).toEqual([]);
  });

  it("dishes case 7: a pair both configured and with a dish waiting is listed once", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await burgerAtTable(venue, "fire");
    expect(await coverage()).toEqual(
      await gaps(venue, [
        ["grill", venue.party.zoneId],
        ["grill", venue.counter.zoneId],
      ]),
    );
  });
});

/** A Grill burger placed at the party's table with `release`. */
const burgerAtTable = (venue: Venue, release: "fire" | "hold") =>
  withTransaction(db, async (tx) => {
    const group = (
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            lines: [{ menuItemId: venue.tables.offerFor(venue.products.burger), quantity: "1" }],
            release,
          },
        ],
      })
    ).groups[0]!;
    const [item] = await tx
      .select({ orderId: ticketItems.workingOrderId, requestedAt: ticketItems.requestedAt })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, group.lineIds[0]!));
    expect(item!.requestedAt === null).toBe(release === "hold");
    return { lineId: group.lineIds[0]!, orderId: item!.orderId };
  });

/** A Grill burger fired on a counter order whose service context is gone, so it has no zone. */
const counterDishInNoZone = (venue: Venue) =>
  withTransaction(db, async (tx) => {
    const counterId = await fireNewOrder(tx, venue.cfg, [
      { productId: venue.products.burger, quantity: "1" },
    ]);
    await tx.execute(sql`delete from order_service_contexts where working_order_id = ${counterId}`);
    return counterId;
  });

const stopWaiting = (venue: Venue) =>
  withTransaction(db, (tx) => setStationsWaitForPass(tx, false, [venue.stations.grill]));

/** A till pass on every station and zone, signed in as a new person, whose profile serves the
 *  tables zone's department and, of its zones, only the tables zone. The fixture's counter zone is
 *  in the same department, so the zone list alone keeps it out. */
async function tablesTillPass(venue: Venue, capabilities: CapabilityFlag[] = TILL_PASS) {
  const T = venue.party.zoneId;
  const departmentOf = async (zoneId: string) =>
    (
      await db
        .select({ id: zoneServicePolicies.departmentId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, zoneId))
    )[0]!.id;
  const department = await departmentOf(T);
  expect(await departmentOf(venue.counter.zoneId)).toBe(department);
  const made = await kitchenDisplay(
    venue,
    "Till pass",
    { kind: "pass", stationIds: null, zoneIds: null },
    capabilities,
    "till",
  );
  await withTransaction(db, (tx) =>
    setProfileServiceAccess(tx, made.profileId, {
      departmentId: department,
      allowedZoneIds: [T],
      startingZoneId: T,
    }),
  );
  const [person] = await withTransaction(db, (tx) =>
    tx
      .insert(persons)
      .values({ displayName: "Till pass cook", pinHash: fixturePinHash("2468"), role: "staff" })
      .returning({ id: persons.id }),
  );
  const personId = person!.id;
  const sessionId = await openTillSession(db, { deviceId: made.deviceId, personId });
  return { ...made, by: { deviceId: made.deviceId, personId, sessionId } satisfies PassActor };
}

/** The device's pass screen's To fire cards, read as its board reads them. */
async function toFire(by: PassActor): Promise<PassCard[]> {
  return withTransaction(db, async (tx) => {
    const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, by.deviceId)).find(
      (candidate) => candidate.kind === "pass",
    )!;
    return (await readScopedPassBoard(tx, passScopeOf(screen))).toFire;
  });
}

const release = (venue: Venue, by: PassActor, card: PassCard) =>
  withTransaction(db, (tx) =>
    releasePassItems(tx, venue.cfg, by, {
      submissionId: randomUUID(),
      target: card.target,
      ticketItemIds: card.releaseTicketItemIds,
      expectedContext: card.releaseContext,
    }),
  );
