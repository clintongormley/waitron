import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedDevice, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { devices } from "./devices.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let deviceId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  ({ deviceId } = await seedDevice(suite.db));
});

it.each([-1, 101])("refuses a battery level of %i", async (batteryLevel) => {
  const error = await captureError(() =>
    suite.db.update(devices).set({ batteryLevel }).where(eq(devices.id, deviceId)),
  );
  expect(engineErrorMessage(error)).toBe("CHECK constraint failed: devices_battery_level_ck");
});

it.each([0, 100, null])("stores a battery level of %s", async (batteryLevel) => {
  const [row] = await suite.db
    .update(devices)
    .set({ batteryLevel })
    .where(eq(devices.id, deviceId))
    .returning({ batteryLevel: devices.batteryLevel });
  expect(row).toEqual({ batteryLevel });
});

it("refuses a deletion timestamp on an active device", async () => {
  const error = await captureError(() =>
    suite.db
      .update(devices)
      .set({ deletedAt: "2026-11-18T10:00:00.000Z" })
      .where(eq(devices.id, deviceId)),
  );
  expect(engineErrorMessage(error)).toBe("CHECK constraint failed: devices_deleted_ck");
});

it("stores the enrollment time without a second creation column", async () => {
  expect(
    suite.db.all(sql`select name from pragma_table_info('devices') where name = 'created_at'`),
  ).toEqual([]);
  const [row] = await suite.db
    .select({ enrolledAt: devices.enrolledAt })
    .from(devices)
    .where(eq(devices.id, deviceId));
  expect(row?.enrolledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
