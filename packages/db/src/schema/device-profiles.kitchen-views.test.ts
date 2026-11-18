import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDeviceProfiles, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let profileId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: "Kitchen display",
    formFactor: "kds",
  });
  profileId = profile!.id;
});

function write(value: string) {
  return suite.db.execute(sql`
    update device_profiles set kitchen_views = ${value} where id = ${profileId}
  `);
}

it("stores kitchen views as an object", async () => {
  const read = () =>
    suite.db.all(sql`
    select kitchen_views from device_profiles where id = ${profileId}
  `);
  expect(read()).toEqual([{ kitchen_views: "{}" }]);
  const view = '{"station":{"stationIds":null,"zoneIds":null}}';
  await write(view);
  expect(read()).toEqual([{ kitchen_views: view }]);
});

it.each(["[]", '"station"', "{"])("refuses a kitchen views value of %s", async (value) => {
  const error = await captureError(() => write(value));
  expect(engineErrorMessage(error)).toBe(
    "CHECK constraint failed: device_profiles_kitchen_views_ck",
  );
});
