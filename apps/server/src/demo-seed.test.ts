import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";

const { seedDemoRestaurant } = vi.hoisted(() => ({ seedDemoRestaurant: vi.fn() }));
vi.mock("../scripts/demo-seed/seed.js", () => ({ seedDemoRestaurant }));

import { INSTALLED_DEMO_SALES_DAYS, demoSeedLocale, seedInstalledDemo } from "./demo-seed.js";
import { DEMO_DATA_SETS } from "../scripts/demo-seed/data-set.js";

function venueWithLocales(invoiceLocales: string[], country = "ES"): VenueRequest {
  return {
    country,
    location: { invoiceLocales },
    admin: { locale: invoiceLocales[0] },
  } as unknown as VenueRequest;
}

const RESULT = {
  locationId: "location-1",
  nodeId: "node-1",
  seriesIds: ["series-standard", "series-rectificative"],
  seeded: [],
} satisfies VenueResult;

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
    const db = {} as Database;
    const result = {
      locationId: "location-1",
      nodeId: "node-1",
      seriesIds: ["series-standard", "series-rectificative"],
      seeded: [],
    } satisfies VenueResult;

    await seedInstalledDemo(db, result, venueWithLocales(["es-ES"]));

    expect(INSTALLED_DEMO_SALES_DAYS).toBe(30);
    expect(seedDemoRestaurant).toHaveBeenCalledTimes(1);
    expect(seedDemoRestaurant.mock.calls[0]![0]).toBe(db);
    expect(seedDemoRestaurant.mock.calls[0]![1]).toStrictEqual({
      venue: {
        nodeId: "node-1",
        seriesId: "series-standard",
        locationId: "location-1",
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

    await seedInstalledDemo({} as Database, RESULT, venueWithLocales(["es-ES"]));

    expect(seedDemoRestaurant.mock.calls[0]![1].dataSet).toBe(DEMO_DATA_SETS["casa-delgado-es"]);
  });

  it("names the departments after the venue's country, not the seed language", async () => {
    seedDemoRestaurant.mockReset();
    seedDemoRestaurant.mockResolvedValue(undefined);

    await seedInstalledDemo({} as Database, RESULT, venueWithLocales(["en-GB"]));
    await seedInstalledDemo({} as Database, RESULT, venueWithLocales(["es-ES"]));

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

    await expect(
      seedInstalledDemo({} as Database, RESULT, venueWithLocales(["en-GB"], "GB")),
    ).rejects.toThrow(/GB/);
    expect(seedDemoRestaurant).not.toHaveBeenCalled();
  });
});
