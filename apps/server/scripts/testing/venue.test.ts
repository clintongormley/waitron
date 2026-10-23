import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dirname } from "node:path";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionTestVenue } from "./venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    const main = db
      .all<{ name: string; file: string }>(sql`pragma database_list`)
      .find((database) => database.name === "main")!;
    await provisionTestVenue(dirname(main.file), "50000000K");
  },
});

describe("the operator scripts' shared test venue", () => {
  it("stores English location text while retaining the Spanish fiscal and receipt settings", () => {
    expect(
      suite.db.all(sql`
      select name, operation_description, address_line1, invoice_locales,
        fiscal_territory, time_zone from locations
    `),
    ).toEqual([
      {
        name: "Main room",
        operation_description: "Retail sale",
        address_line1: "1 Market Street",
        invoice_locales: '["es-ES"]',
        fiscal_territory: "ES-common",
        time_zone: "Europe/Madrid",
      },
    ]);
  });

  it("stores an English administrator name with the script login intact", () => {
    expect(
      suite.db.all(sql`
      select display_name, email, role from persons
    `),
    ).toEqual([
      {
        display_name: "Administrator",
        email: "admin@scripts.test",
        role: "admin",
      },
    ]);
  });
});
