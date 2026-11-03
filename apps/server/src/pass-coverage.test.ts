import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, devices, floorZones, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { CapabilityFlag } from "@waitron/layouts";
import type { DeviceKitchenScreen } from "@waitron/module";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { VENUE_SERVICE } from "./modules.js";
import { readPassCoverage, type PassCoverageGap } from "./pass-coverage.js";
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

/** A device on a kitchen-display profile of its own with exactly `capabilities`. */
async function kitchenDisplay(
  venue: Venue,
  name: string,
  kitchenScreen: DeviceKitchenScreen,
  capabilities: CapabilityFlag[] = ALL_PASS,
): Promise<{ deviceId: string; profileId: string }> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({ name: `${name} profile`, formFactor: "kds", capabilities })
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
        zoneIndex(a.zoneId) - zoneIndex(b.zoneId) || a.stationName.localeCompare(b.stationName),
    );
}

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
});
