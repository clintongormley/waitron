import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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

describe("made-here station assignment", () => {
  const stationId = "aaaaaaaa-0000-4000-8000-000000000004";
  const otherStationId = "aaaaaaaa-0000-4000-8000-000000000006";
  const read = () =>
    suite.db.all(sql`select made_here_station_ids from devices where id = ${deviceId}`);
  const write = (value: string) =>
    suite.db.execute(
      sql`update devices set made_here_station_ids = ${value} where id = ${deviceId}`,
    );

  it("defaults to no station and round-trips one station", async () => {
    expect(read()).toEqual([{ made_here_station_ids: "[]" }]);
    const assignment = JSON.stringify([stationId]);
    await write(assignment);
    expect(read()).toEqual([{ made_here_station_ids: assignment }]);
  });

  it.each([
    ["malformed JSON", "["],
    ["an object", JSON.stringify({ stationId })],
    ["two stations", JSON.stringify([stationId, otherStationId])],
    ["a duplicate station", JSON.stringify([stationId, stationId])],
  ])("refuses %s without replacing the saved station", async (_name, invalid) => {
    const assignment = JSON.stringify([stationId]);
    await write(assignment);
    const error = await captureError(() => write(invalid));
    expect(engineErrorMessage(error)).toBe(
      "CHECK constraint failed: devices_made_here_station_ids_ck",
    );
    expect(read()).toEqual([{ made_here_station_ids: assignment }]);
  });
});
