import { describe, expect, it } from "vitest";
import { deviceProfiles } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { getCountryPack } from "@waitron/country-packs";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { validateCapabilities } from "@waitron/layouts";
import { seedDemoRestaurant } from "../scripts/demo-seed/seed.js";
import { demoDataSetFor } from "../scripts/demo-seed/data-set.js";
import { ALL_MODULES } from "./modules.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("installed starter clock profiles", () => {
  it("seeds clocking on Counter and Handheld only and keeps it through the demo seed", async () => {
    const identity = getCountryPack("ES")!.demo!;
    const request: VenueRequest = {
      country: "ES",
      taxId: identity.taxId,
      legalName: identity.legalName,
      location: {
        name: identity.locationName,
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "04:00",
      },
      seriesCode: "FS",
      rectificativeSeriesCode: "FR",
      admin: {
        displayName: "Owner",
        pinHash: "scrypt$00$00",
        passwordHash: "scrypt$00$00",
        email: "owner@example.test",
      },
    };
    const result = await applyVenue(planVenue(request, ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const readProfiles = () =>
      suite.db
        .select({
          formFactor: deviceProfiles.formFactor,
          capabilities: deviceProfiles.capabilities,
        })
        .from(deviceProfiles)
        .orderBy(deviceProfiles.formFactor);
    const assertClocking = async () => {
      const profiles = await readProfiles();
      expect(
        profiles.map((p) => [
          p.formFactor,
          validateCapabilities(p.capabilities, p.formFactor).includes("clock-in"),
        ]),
      ).toEqual([
        ["kds", false],
        ["phone-portrait", true],
        ["till", true],
      ]);
      return profiles;
    };
    await assertClocking();
    await seedDemoRestaurant(suite.db, {
      venue: {
        nodeId: result.nodeId,
        locationId: result.locationId,
        seriesId: result.seriesIds[0]!,
      },
      locale: "es",
      salesDays: 0,
      departmentTradingNames: identity.departmentTradingNames,
      dataSet: demoDataSetFor(identity),
    });
    const profiles = await assertClocking();
    expect(profiles.find((p) => p.formFactor === "kds")!.capabilities).toContain("run-the-pass");
  });
});
