import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createDemoVenueProvisioner } from "../scripts/demo-seed/testing/provision-venue.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";

const { seedDemoRestaurant } = vi.hoisted(() => ({ seedDemoRestaurant: vi.fn() }));
vi.mock("../scripts/demo-seed/seed.js", () => ({ seedDemoRestaurant }));

// A made-up country whose identity names no data set of its own; every other code is the real one.
vi.mock("@waitron/country-packs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/country-packs")>();
  const nowhere = {
    ...real.getCountryPack("GB")!,
    countryCode: "XX",
    demo: {
      legalName: "Nowhere Foods Ltd",
      taxId: "XX123456789",
      locationName: "Nowhere Street",
      departmentTradingNames: { restaurant: "Nowhere Bar", deli: "Nowhere Deli" },
    },
  };
  return {
    ...real,
    getCountryPack: (code: string) =>
      code.trim().toUpperCase() === "XX" ? nowhere : real.getCountryPack(code),
  };
});

import { INSTALLED_DEMO_SALES_DAYS, demoSeedLocale, seedInstalledDemo } from "./demo-seed.js";
import { DEMO_DATA_SETS } from "../scripts/demo-seed/data-set.js";

function venueWithLocales(invoiceLocales: string[], country = "ES"): VenueRequest {
  return {
    country,
    location: { invoiceLocales },
    admin: { locale: invoiceLocales[0] },
  } as unknown as VenueRequest;
}

let RESULT: VenueResult;
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeEach(async () => {
  seedDemoRestaurant.mockReset();
  seedDemoRestaurant.mockResolvedValue(undefined);
  const ids = await createDemoVenueProvisioner(() => suite.db, {
    nifBase: 95000000,
    invoiceLocale: "es-ES",
    nifFormat: "calculated",
  })();
  RESULT = {
    nodeId: ids.nodeId,
    locationId: ids.locationId,
    seriesIds: [ids.seriesId],
    seeded: [],
  };
});

describe("demoSeedLocale", () => {
  it.each([
    [["es-ES", "en-GB"], "es"],
    [["ES-mx"], "es"],
    [["en-GB", "es-ES"], "en"],
    [["ca-ES"], "en"],
    [[], "en"],
  ])(
    "reads the admin's language, here the first of %j, as the %s sample restaurant",
    (locales, expected) => {
      expect(demoSeedLocale(venueWithLocales(locales))).toBe(expected);
    },
  );

  it.each([
    [["ca-ES"], "es-ES", "es"],
    [["es-ES"], "en-GB", "en"],
    [["es-ES"], null, "en"],
  ])(
    "with receipts in %j, an admin in %s seeds the %s sample restaurant",
    (invoiceLocales, adminLocale, expected) => {
      const venue = {
        country: "ES",
        location: { invoiceLocales },
        admin: { locale: adminLocale },
      } as unknown as VenueRequest;
      expect(demoSeedLocale(venue)).toBe(expected);
    },
  );
});

describe("seedInstalledDemo", () => {
  it("seeds the provisioned venue's own ids, a month of practice sales, and its admin's staff language", async () => {
    seedDemoRestaurant.mockResolvedValue(undefined);
    const db = suite.db;
    const result = RESULT;

    await seedInstalledDemo(db, result, venueWithLocales(["es-ES"]));

    expect(INSTALLED_DEMO_SALES_DAYS).toBe(30);
    expect(seedDemoRestaurant).toHaveBeenCalledTimes(1);
    expect(seedDemoRestaurant.mock.calls[0]![0]).toBe(db);
    expect(seedDemoRestaurant.mock.calls[0]![1]).toStrictEqual({
      venue: {
        nodeId: RESULT.nodeId,
        seriesId: RESULT.seriesIds[0],
        locationId: RESULT.locationId,
      },
      locale: "es",
      salesDays: 30,
      departmentTradingNames: { restaurant: "Bar Casa Delgado", deli: "Deli Delgado" },
      dataSet: DEMO_DATA_SETS["casa-delgado-es"],
    });
  });

  it("seeds a Spanish venue from the data set its country pack names", async () => {
    seedDemoRestaurant.mockReset();
    seedDemoRestaurant.mockResolvedValue(undefined);

    await seedInstalledDemo(suite.db, RESULT, venueWithLocales(["es-ES"]));

    expect(seedDemoRestaurant.mock.calls[0]![1].dataSet).toBe(DEMO_DATA_SETS["casa-delgado-es"]);
  });

  it("names the departments after the venue's country, not the seed language", async () => {
    seedDemoRestaurant.mockReset();
    seedDemoRestaurant.mockResolvedValue(undefined);

    await seedInstalledDemo(suite.db, RESULT, venueWithLocales(["en-GB"]));
    await seedInstalledDemo(suite.db, RESULT, venueWithLocales(["es-ES"]));

    const [english, spanish] = seedDemoRestaurant.mock.calls.map(([, input]) => input);
    expect(english.locale).toBe("en");
    expect(spanish.locale).toBe("es");
    expect(english.departmentTradingNames).toEqual({
      restaurant: "Bar Casa Delgado",
      deli: "Deli Delgado",
    });
    expect(spanish.departmentTradingNames).toEqual(english.departmentTradingNames);
  });

  it("refuses, seeding nothing, a venue whose country has no demo identity", async () => {
    seedDemoRestaurant.mockReset();

    await suite.db.execute(sql`update tenants set country='GB'`);
    await expect(
      seedInstalledDemo(suite.db, RESULT, venueWithLocales(["en-GB"], "GB")),
    ).rejects.toThrow(/GB/);
    expect(seedDemoRestaurant).not.toHaveBeenCalled();
  });

  it("seeds a country with no data set of its own from Casa Delgado in English, under its own trading names", async () => {
    seedDemoRestaurant.mockReset();
    seedDemoRestaurant.mockResolvedValue(undefined);

    await suite.db.execute(sql`update tenants set country='XX'`);
    await seedInstalledDemo(suite.db, RESULT, venueWithLocales(["es-ES"], "XX"));

    expect(seedDemoRestaurant).toHaveBeenCalledTimes(1);
    expect(seedDemoRestaurant.mock.calls[0]![1]).toStrictEqual({
      venue: {
        nodeId: RESULT.nodeId,
        seriesId: RESULT.seriesIds[0],
        locationId: RESULT.locationId,
      },
      locale: "en",
      salesDays: 30,
      departmentTradingNames: { restaurant: "Nowhere Bar", deli: "Nowhere Deli" },
      dataSet: DEMO_DATA_SETS["casa-delgado-es"],
    });
  });
});

it.each(["Barcelona", "Balears, Illes"])(
  "seeds from stored %s geography rather than stale request geography",
  async (province) => {
    await suite.db.execute(
      sql`update locations set province=${province} where id=${RESULT.locationId}`,
    );
    await seedInstalledDemo(suite.db, RESULT, venueWithLocales(["es-ES"]));
    expect(seedDemoRestaurant.mock.calls[0]![1].dataSet.id).toBe("casa-delgado-ca");
    expect(seedDemoRestaurant.mock.calls[0]![1].locale).toBe("es");
  },
);

it("refuses an absent stored location before seeding", async () => {
  await expect(
    seedInstalledDemo(suite.db, { ...RESULT, locationId: "missing" }, venueWithLocales(["es-ES"])),
  ).rejects.toThrow("missing location");
  expect(seedDemoRestaurant).not.toHaveBeenCalled();
});
