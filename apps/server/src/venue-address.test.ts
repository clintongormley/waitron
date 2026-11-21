import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { describe, expect, it } from "vitest";

import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import * as venueAddress from "./venue-address.js";
import {
  addressLines,
  readReceiptAddress,
  readVenueAddressAndLine,
  venueAddressLine,
} from "./venue-address.js";
import { setupVenue } from "./testing/venue-fixtures.js";

const none = {
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: null,
  province: null,
};

describe("addressLines", () => {
  it("joins the street lines, then the postal code and city with a province unlike the city: two lines", () => {
    expect(
      addressLines({
        addressLine1: "Calle Mayor 1",
        addressLine2: "Local 2",
        postalCode: "03001",
        city: "Alicante",
        province: "Alicante/Alacant",
      }),
    ).toEqual(["Calle Mayor 1, Local 2", "03001 Alicante, Alicante/Alacant"]);
  });

  it("keeps a single street line and a province without a city on their own", () => {
    expect(addressLines({ ...none, addressLine2: "Local 2", province: "Girona" })).toEqual([
      "Local 2",
      "Girona",
    ]);
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

  it("prints nothing for a venue with no address", () => {
    expect(addressLines(none)).toEqual([]);
  });

  it("trims each part", () => {
    expect(addressLines({ ...none, addressLine1: " Calle Mayor 1 ", city: " Madrid " })).toEqual([
      "Calle Mayor 1",
      "Madrid",
    ]);
  });
});

describe("venueAddressLine", () => {
  it("joins the parts as a registered address is, keeping a province that names the city", () => {
    expect(
      venueAddressLine({
        addressLine1: " Carrer de Mallorca 123 ",
        addressLine2: "2º 1ª",
        postalCode: "08010",
        city: "Barcelona",
        province: "Barcelona",
      }),
    ).toBe("Carrer de Mallorca 123, 2º 1ª, 08010 Barcelona, Barcelona");
    expect(venueAddressLine(none)).toBe("");
  });
});

describe("readReceiptAddress", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  it("reads the venue's address lines", async () => {
    await setupVenue(suite.db);
    expect(await withTransaction(suite.db, (tx) => venueAddress.readVenueAddress(tx))).toEqual([
      "Calle Mayor 1",
      "28013 Madrid",
    ]);
  });

  it.each(["venue", "receipt on", "receipt off"])(
    "refuses %s address reads when no venue is set up",
    async (reader) => {
      await expect(
        withTransaction(suite.db, (tx) =>
          reader === "venue"
            ? venueAddress.readVenueAddress(tx)
            : readReceiptAddress(tx, { printAddress: reader === "receipt on" }),
        ),
      ).rejects.toMatchObject({ code: "venue.not_found" });
    },
  );

  it("reads the venue's address, and none when the receipt switches it off", async () => {
    await setupVenue(suite.db);
    const read = (receipt: { printAddress?: boolean }) =>
      withTransaction(suite.db, (tx) => readReceiptAddress(tx, receipt));
    expect(await read({})).toEqual(["Calle Mayor 1", "28013 Madrid"]);
    expect(await read({ printAddress: true })).toEqual(["Calle Mayor 1", "28013 Madrid"]);
    expect(await read({ printAddress: false })).toEqual([]);
    await seedVenueSettings(suite.db, {
      addressLine1: null,
      postalCode: null,
      city: null,
      province: null,
    });
    expect(await read({})).toEqual([]);
  });

  it("reads the venue's address lines and its whole line in one go", async () => {
    await setupVenue(suite.db);
    await seedVenueSettings(suite.db, {
      addressLine1: "Carrer de Mallorca 123",
      postalCode: "08010",
      city: "Barcelona",
      province: "Barcelona",
    });
    expect(await withTransaction(suite.db, (tx) => readVenueAddressAndLine(tx))).toEqual({
      venueAddress: ["Carrer de Mallorca 123", "08010 Barcelona"],
      venueAddressLine: "Carrer de Mallorca 123, 08010 Barcelona, Barcelona",
    });
  });
});
