import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, deviceProfiles, devices, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { scriptSessionDevice } from "./script-device.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function profileOf(deviceId: string) {
  const [row] = await suite.db
    .select({ id: deviceProfiles.id, retiredAt: deviceProfiles.retiredAt })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, deviceId));
  return row!;
}

describe("scriptSessionDevice", () => {
  it("puts its device on the live profile of that name, never a retired one", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Bar", invoiceLocales: ["es"], operationDescription: "Hostelería" })
      .returning({ id: locations.id });
    const [retired] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: "Script till",
        formFactor: "till",
        capabilities: [],
        retiredAt: new Date().toISOString(),
      })
      .returning({ id: deviceProfiles.id });
    const run = () =>
      withTransaction(suite.db, (tx) => scriptSessionDevice(tx, location!.id, "Script till"));

    const first = await profileOf(await run());
    expect(first.id).not.toBe(retired!.id);
    expect(first.retiredAt).toBeNull();
    // With a retired and a live profile both named so, the next run finds the live one.
    expect((await profileOf(await run())).id).toBe(first.id);
  });
});
