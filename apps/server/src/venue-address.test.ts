import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { locations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addressLines, readReceiptAddress } from "./venue-address.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const none = {
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: null,
  province: null,
};

describe("addressLines", () => {
  it("prints the two street lines, the postal code with the city, and a province unlike the city", () => {
    expect(
      addressLines({
        addressLine1: "Calle Mayor 1",
        addressLine2: "Local 2",
        postalCode: "03001",
        city: "Alicante",
        province: "Alicante/Alacant",
      }),
    ).toEqual(["Calle Mayor 1", "Local 2", "03001 Alicante", "Alicante/Alacant"]);
  });

  it("leaves out a province that names the city, whatever its case and spacing", () => {
    expect(
      addressLines({
        ...none,
        addressLine1: "Calle Mayor 1",
        postalCode: "28013",
        city: "Madrid",
        province: " MADRID ",
      }),
    ).toEqual(["Calle Mayor 1", "28013 Madrid"]);
  });

  it("prints whichever of the postal code and city is set, and skips blank parts", () => {
    expect(addressLines({ ...none, postalCode: "28013", addressLine2: "  " })).toEqual(["28013"]);
    expect(addressLines({ ...none, city: "Madrid", addressLine1: "" })).toEqual(["Madrid"]);
    expect(addressLines({ ...none, province: "Madrid" })).toEqual(["Madrid"]);
  });

  it("prints nothing for a location with no address", () => {
    expect(addressLines(none)).toEqual([]);
  });

  it("trims each part", () => {
    expect(addressLines({ ...none, addressLine1: " Calle Mayor 1 ", city: " Madrid " })).toEqual([
      "Calle Mayor 1",
      "Madrid",
    ]);
  });
});

describe("readReceiptAddress", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  it("reads the location's address, and none when the receipt switches it off", async () => {
    const venue = await setupVenue(suite.db);
    const read = (receipt: { printAddress?: boolean }, locationId: string = venue.cfg.locationId) =>
      withTransaction(suite.db, (tx) => readReceiptAddress(tx, locationId, receipt));
    expect(await read({})).toEqual(["Calle Mayor 1", "28013 Madrid"]);
    expect(await read({ printAddress: true })).toEqual(["Calle Mayor 1", "28013 Madrid"]);
    expect(await read({ printAddress: false })).toEqual([]);
    await suite.db
      .update(locations)
      .set({ addressLine1: null, postalCode: null, city: null, province: null })
      .where(eq(locations.id, venue.cfg.locationId));
    expect(await read({})).toEqual([]);
    expect(await read({}, "aa000000-0000-4000-8000-000000000001")).toEqual([]);
  });
});
