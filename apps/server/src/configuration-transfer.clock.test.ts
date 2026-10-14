import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { deviceProfiles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { getDeviceProfile, profileAllows } from "@waitron/layouts";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import {
  buildConfigurationBundle,
  exportConfigurationTables,
  importConfigurationTables,
} from "./configuration-transfer.js";

const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("round-trips the clock-in capability and still refuses a shared display", async () => {
  const at = new Date("2026-01-05T09:00:00Z");
  const venue = await createClockVenue(source.db, () => at);
  const versions = await schemaVersionsByModule(source.db, ALL_MODULES);
  const exported = await exportConfigurationTables(source.db, ALL_MODULES);
  const [operator] = await source.db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.role, "admin"));
  const bundle = {
    ...(await buildConfigurationBundle(
      source.db,
      { ...venue.cfg, sourceOperatorId: operator!.id },
      ALL_MODULES,
      at,
      versions,
    )),
    ...exported,
  };
  const request: VenueRequest = {
    country: "ES",
    taxId: "B20202020",
    legalName: "Imported SL",
    location: {
      name: "Imported venue",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      addressLine1: "Calle Mayor 2",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
  };
  await applyVenue(planVenue(request, ALL_MODULES), {
    db: target.db,
    modules: ALL_MODULES,
    beforeCommit: (tx, installed) =>
      importConfigurationTables(tx, bundle, installed, ALL_MODULES, versions),
  });
  await withTransaction(target.db, async (tx) => {
    const [clock] = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.name, "Clock only"));
    const imported = await getDeviceProfile(tx, clock!.id);
    expect(imported!.id).not.toBe(venue.profileId);
    expect(imported!.capabilities).toEqual(["clock-in"]);
    expect(profileAllows(imported!, "clock-in")).toBe(true);
    const [kitchen] = await tx
      .select({ id: deviceProfiles.id })
      .from(deviceProfiles)
      .where(eq(deviceProfiles.formFactor, "kds"));
    await tx
      .update(deviceProfiles)
      .set({ capabilities: ["clock-in"] })
      .where(eq(deviceProfiles.id, kitchen!.id));
    expect(profileAllows((await getDeviceProfile(tx, kitchen!.id))!, "clock-in")).toBe(false);
  });
});
