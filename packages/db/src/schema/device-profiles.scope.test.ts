import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDeviceProfiles, seedVenue, seedZone } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deviceProfiles } from "./device-profiles.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let profileId: string;
let zoneId: string;
let departmentId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: "Ordering till",
    formFactor: "till",
  });
  profileId = profile!.id;
  ({ id: zoneId, departmentId } = await seedZone(suite.db, { name: "Dining room" }));
});

function writeScope(department: string | null, start: string | null, zones: string | null) {
  return suite.db.execute(sql`
    update device_profiles
    set order_department_id = ${department}, order_starting_zone_id = ${start}, order_zone_ids = ${zones}
    where id = ${profileId}
  `);
}

it("stores unrestricted, every-zone, and explicit scopes", async () => {
  const read = () =>
    suite.db.all(sql`
    select order_department_id as department, order_starting_zone_id as start, order_zone_ids as zones
    from device_profiles where id = ${profileId}
  `);
  expect(read()).toEqual([{ department: null, start: null, zones: null }]);
  for (const zones of [null, "[]", JSON.stringify([zoneId])]) {
    await writeScope(departmentId, zoneId, zones);
    expect(read()).toEqual([{ department: departmentId, start: zoneId, zones }]);
  }
});

it.each([
  ["department without a start", true, false, null, "device_profiles_order_scope_ck"],
  ["start without a department", false, true, null, "device_profiles_order_scope_ck"],
  ["list without a department", false, false, "[]", "device_profiles_order_scope_ck"],
  ["object as a zone list", true, true, "{}", "device_profiles_order_zone_ids_ck"],
  ["invalid JSON as a zone list", true, true, "[", "device_profiles_order_zone_ids_ck"],
])("refuses %s", async (_name, withDepartment, withStart, zones, constraint) => {
  const error = await captureError(() =>
    writeScope(withDepartment ? departmentId : null, withStart ? zoneId : null, zones),
  );
  expect(engineErrorMessage(error)).toBe(`CHECK constraint failed: ${constraint}`);
});

it("refuses an inactivity timeout on a kitchen display and keeps one on a till", async () => {
  const [display] = await seedDeviceProfiles(suite.db, {
    name: "Kitchen display",
    formFactor: "kds",
  });
  const timeout = (id: string) =>
    suite.db
      .update(deviceProfiles)
      .set({ inactivityTimeoutSeconds: 300 })
      .where(eq(deviceProfiles.id, id))
      .returning({ seconds: deviceProfiles.inactivityTimeoutSeconds });
  expect(await timeout(profileId)).toEqual([{ seconds: 300 }]);
  const error = await captureError(() => timeout(display!.id));
  expect(engineErrorMessage(error)).toBe("CHECK constraint failed: device_profiles_kds_timeout_ck");
});
