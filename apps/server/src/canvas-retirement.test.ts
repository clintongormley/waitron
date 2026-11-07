import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_CHANGE_SOURCES,
  FORM_FACTOR_REFUSAL,
  captureError,
  deviceProfiles,
  withTransaction,
  triggerRaised,
} from "@waitron/db";
import { seedDevice, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

describe("canvas retirement on a fresh venue", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  it("has no canvas table or live change source", async () => {
    const tables = suite.db
      .execute<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .rows.map((row) => row.name);
    expect(tables).not.toContain("canvases");
    expect(CORE_CHANGE_SOURCES.map((source) => source.table)).not.toContain("canvases");
  });

  it("keeps device profiles without a canvas selector", async () => {
    const columns = suite.db
      .execute<{ name: string }>(sql`select name from pragma_table_info('device_profiles')`)
      .rows.map((row) => row.name);
    expect(columns).toEqual([
      "id",
      "name",
      "form_factor",
      "capabilities",
      "inactivity_timeout_seconds",
      "starting_screen",
      "created_at",
      "updated_at",
      "retired_at",
    ]);
  });

  it("refuses changing a held profile's form factor but permits its rename", async () => {
    await seedVenue(suite.db, {
      name: "Retained venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Food",
    });
    const { profileId } = await seedDevice(suite.db);
    const refused = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx
          .update(deviceProfiles)
          .set({ formFactor: "phone-portrait" })
          .where(eq(deviceProfiles.id, profileId));
      }),
    );
    expect(triggerRaised(refused, FORM_FACTOR_REFUSAL)).toBe(true);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(deviceProfiles)
        .set({ name: "Renamed counter" })
        .where(eq(deviceProfiles.id, profileId));
    });
    const [profile] = await suite.db
      .select()
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, profileId));
    expect(profile).toMatchObject({ name: "Renamed counter", formFactor: "till" });
  });
});
