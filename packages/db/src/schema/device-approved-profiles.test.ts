import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDeviceProfiles, seedVenue, seedZone } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceApprovedProfiles } from "./device-approved-profiles.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let deviceId: string;
let profileId: string;
let zoneId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  const [active, approved] = await seedDeviceProfiles(suite.db, [
    { name: "Bar till", formFactor: "till" },
    { name: "Dining till", formFactor: "till" },
  ]);
  const [device] = await suite.db
    .insert(devices)
    .values({ label: "Till", tokenHash: "seeded", deviceProfileId: active!.id })
    .returning({ id: devices.id });
  deviceId = device!.id;
  profileId = approved!.id;
  ({ id: zoneId } = await seedZone(suite.db, { name: "Dining room" }));
  await suite.db.insert(deviceApprovedProfiles).values({ deviceId, deviceProfileId: profileId });
});

const write = (start: string | null, zones: string | null) =>
  suite.db.execute(sql`
    update device_approved_profiles set starting_zone_id = ${start}, zone_ids = ${zones}
    where device_id = ${deviceId} and device_profile_id = ${profileId}
  `);

it("distinguishes a profile with no saved zones from one whose saved list is empty", async () => {
  const read = () =>
    suite.db.all(
      sql`select starting_zone_id as start, zone_ids as zones from device_approved_profiles`,
    );
  expect(read()).toEqual([{ start: null, zones: null }]);
  const list = JSON.stringify([zoneId]);
  await write(zoneId, list);
  expect(read()).toEqual([{ start: zoneId, zones: list }]);
  await write(null, "[]");
  expect(read()).toEqual([{ start: null, zones: "[]" }]);
});

it("refuses a starting zone on a profile with no saved list", async () => {
  const error = await captureError(() => write(zoneId, null));
  expect(engineErrorMessage(error)).toBe(
    "CHECK constraint failed: device_approved_profiles_start_ck",
  );
});

it("refuses an object as a saved zone list", async () => {
  const error = await captureError(() => write(null, "{}"));
  expect(engineErrorMessage(error)).toBe(
    "CHECK constraint failed: device_approved_profiles_zone_ids_ck",
  );
});

it("requires the starting zone to exist", async () => {
  const missing = "12345678-1234-4123-8123-123456789abc";
  const error = await captureError(() => write(missing, JSON.stringify([missing])));
  expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
});

it.each(["device", "profile"] as const)(
  "cascades saved zones on physical %s deletion",
  async (parent) => {
    await write(zoneId, JSON.stringify([zoneId]));
    if (parent === "device") await suite.db.delete(devices).where(eq(devices.id, deviceId));
    else await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, profileId));
    expect(await suite.db.select().from(deviceApprovedProfiles)).toEqual([]);
  },
);
