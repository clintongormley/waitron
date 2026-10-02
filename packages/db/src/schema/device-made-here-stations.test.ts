import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { deviceProfiles } from "./device-profiles.js";
import { deviceMadeHereStations } from "./device-made-here-stations.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations, tenants, tills } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL = "aaaaaaaa-0000-4000-8000-000000000002";
const DEVICE = "aaaaaaaa-0000-4000-8000-000000000003";
const STATION = "aaaaaaaa-0000-4000-8000-000000000004";
const GHOST = "aaaaaaaa-0000-4000-8000-000000000099";
const PROFILE = "aaaaaaaa-0000-4000-8000-000000000005";

describe("device made-here stations schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await suite.db.insert(tenants).values({
      id: 1,
      country: "ES",
      taxId: "B00000000",
      legalName: "Fixture Tenant A",
    });
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(tills).values({ id: TILL, locationId: LOCATION, name: "Till A" });
    await suite.db
      .insert(kitchenStations)
      .values({ id: STATION, locationId: LOCATION, name: "Kitchen A" });
    await suite.db
      .insert(deviceProfiles)
      .values({ id: PROFILE, name: "Till profile", formFactor: "till" });
    await suite.db.insert(devices).values({
      id: DEVICE,
      locationId: LOCATION,
      tillId: TILL,
      deviceProfileId: PROFILE,
      label: "Till device",
      tokenHash: "scrypt$00$00",
    });
  });

  it("stores a device's made-here station once", async () => {
    await suite.db.insert(deviceMadeHereStations).values({ deviceId: DEVICE, stationId: STATION });
    expect(
      await suite.db
        .select()
        .from(deviceMadeHereStations)
        .where(eq(deviceMadeHereStations.deviceId, DEVICE)),
    ).toEqual([{ deviceId: DEVICE, stationId: STATION }]);
    const duplicate = await captureError(() =>
      suite.db.insert(deviceMadeHereStations).values({ deviceId: DEVICE, stationId: STATION }),
    );
    expect(isRefusal(duplicate, UNIQUE_VIOLATION)).toBe(true);
  });

  it("refuses a device or station that does not exist", async () => {
    for (const [deviceId, stationId] of [
      [GHOST, STATION],
      [DEVICE, GHOST],
    ]) {
      const error = await captureError(() =>
        suite.db
          .insert(deviceMadeHereStations)
          .values({ deviceId: deviceId!, stationId: stationId! }),
      );
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
  });
});
