import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";

const { seedDemoRestaurant } = vi.hoisted(() => ({ seedDemoRestaurant: vi.fn() }));
vi.mock("../scripts/demo-seed/seed.js", () => ({ seedDemoRestaurant }));

import { INSTALLED_DEMO_SALES_DAYS, demoSeedLocale, seedInstalledDemo } from "./demo-seed.js";

function venueWithLocales(invoiceLocales: string[]): VenueRequest {
  return { location: { invoiceLocales } } as unknown as VenueRequest;
}

describe("demoSeedLocale", () => {
  it.each([
    [["es-ES", "en-GB"], "es"],
    [["ES-mx"], "es"],
    [["en-GB", "es-ES"], "en"],
    [["ca-ES"], "en"],
    [[], "en"],
  ])("reads invoice locales %j as the %s sample restaurant", (locales, expected) => {
    expect(demoSeedLocale(venueWithLocales(locales))).toBe(expected);
  });
});

describe("seedInstalledDemo", () => {
  it("seeds the provisioned venue's own ids with a month of practice sales in its language", async () => {
    seedDemoRestaurant.mockResolvedValue(undefined);
    const db = {} as Database;
    const result = {
      locationId: "location-1",
      tillId: "till-1",
      nodeId: "node-1",
      seriesIds: ["series-standard", "series-rectificative"],
      seeded: [],
    } satisfies VenueResult;

    await seedInstalledDemo(db, result, venueWithLocales(["es-ES"]));

    expect(INSTALLED_DEMO_SALES_DAYS).toBe(30);
    expect(seedDemoRestaurant).toHaveBeenCalledTimes(1);
    expect(seedDemoRestaurant).toHaveBeenCalledWith(db, {
      venue: {
        tillId: "till-1",
        nodeId: "node-1",
        seriesId: "series-standard",
        locationId: "location-1",
      },
      locale: "es",
      salesDays: 30,
    });
  });
});
