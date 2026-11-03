import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  floorZones,
  kitchenStations,
  ticketItems,
  withTransaction,
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

const coverage = (venue: Venue) => withTransaction(db, (tx) => readPassCoverage(tx, venue.cfg));

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
        byCodeUnit(a.stationName, b.stationName) ||
        byCodeUnit(a.stationId, b.stationId),
    );
}

/** The database's binary collation, which `localeCompare` is not. */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe("A773 station policy: pass coverage", () => {
  it("case 1: no station waits, so nothing is a gap, even with no pass device", async () => {
    const venue = await setupSplitExtrasVenue();
    expect(await zonesInOrder()).toHaveLength(2);
    expect(await coverage(venue)).toEqual([]);
  });

  it("case 2: a waiting station with no pass device is a gap in every zone", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    const T = venue.party.zoneId;
    const C = venue.counter.zoneId;
    expect(await coverage(venue)).toEqual(
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
    expect(await coverage(venue)).toEqual([]);
  });

  it("case 4: a pass on Grill in the tables zone leaves Grill in the counter zone", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await passOn(venue, "Tables pass", [venue.stations.grill], [venue.party.zoneId]);
    expect(await coverage(venue)).toEqual(await gaps(venue, [["grill", venue.counter.zoneId]]));
  });

  it("case 4: a pass on Bar alone leaves Grill in both zones", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await passOn(venue, "Bar pass", [venue.stations.bar]);
    expect(await coverage(venue)).toEqual(
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
    expect(await coverage(venue)).toEqual(await gaps(venue, [["grill", venue.counter.zoneId]]));
  });

  it("case 5: hot and cold passes each cover their own station", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill", "fryer");
    await passOn(venue, "Hot pass", [venue.stations.grill]);
    await passOn(venue, "Cold pass", [venue.stations.fryer], [venue.party.zoneId]);
    expect(await coverage(venue)).toEqual(await gaps(venue, [["fryer", venue.counter.zoneId]]));
  });

  it("case 6: a pass monitor covers nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await waiting(venue, "grill");
    await kitchenDisplay(venue, "Monitor", {
      kind: "pass_monitor",
      stationIds: null,
      zoneIds: null,
    });
    expect(await coverage(venue)).toEqual(
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
    expect(await coverage(venue)).toEqual(
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
    expect(await coverage(venue)).toEqual(
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
      VENUE_SERVICE.setProfileKitchenScreens(tx, venue.cfg, pass.profileId, {
        station: { stationIds: null, zoneIds: null },
      }),
    );
    const screens = await withTransaction(db, (tx) =>
      VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, pass.deviceId),
    );
    expect(screens.find((screen) => screen.kind === "pass")).toMatchObject({ available: false });
    expect(await coverage(venue)).toEqual(
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
    expect(await coverage(venue)).toEqual(await gaps(venue, [["grill", venue.counter.zoneId]]));
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
    const cards = await toFire(venue, pass.by);
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
    await withTransaction(db, (tx) => deleteStation(tx, venue.cfg, venue.stations.grill));
    const [grill] = await db
      .select({ active: kitchenStations.active, waitsForPass: kitchenStations.waitsForPass })
      .from(kitchenStations)
      .where(eq(kitchenStations.id, venue.stations.grill));
    expect(grill).toEqual({ active: false, waitsForPass: true });
    expect(await coverage(venue)).toEqual(
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
    expect(await coverage(venue)).toEqual([
      gap("fryer", T),
      gap("grill", T),
      gap("fryer", C),
      gap("grill", C),
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
    expect(await coverage(venue)).toEqual([
      { stationId: venue.stations.grill, stationName: "Grill", zoneId: null, zoneName: null },
    ]);
    await passOn(venue, "Every pass", null);
    expect(await coverage(venue)).toEqual([]);
  });
});

/** A till pass on every station and zone, signed in as a new person, whose profile serves the
 *  tables zone's department and, of its zones, only the tables zone. The fixture's counter zone is
 *  in the same department, so the zone list alone keeps it out. */
async function tablesTillPass(venue: Venue) {
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
    ALL_PASS,
    "till",
  );
  await withTransaction(db, (tx) =>
    setProfileServiceAccess(tx, venue.cfg, made.profileId, {
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
async function toFire(venue: Venue, by: PassActor): Promise<PassCard[]> {
  return withTransaction(db, async (tx) => {
    const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, by.deviceId)).find(
      (candidate) => candidate.kind === "pass",
    )!;
    return (await readScopedPassBoard(tx, venue.cfg, passScopeOf(screen))).toFire;
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
