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
      select json_extract(settings.doc, '$.name') as name, json_extract(settings.doc, '$.operationDescription') as operation_description, json_extract(settings.doc, '$.addressLine1') as address_line1, json_extract(settings.doc, '$.invoiceLocales') as invoice_locales,
        json_extract(settings.doc, '$.fiscalTerritory') as fiscal_territory, json_extract(b.doc, '$.timeZone') as time_zone from settings cross join settings b where settings.module = 'venue' and b.module = 'business_day'
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

  it("stores an English administrator name, email and role", () => {
    expect(
      suite.db.all(sql`
      select display_name, email, (select built_in_key from person_roles join roles on roles.id = person_roles.role_id where person_roles.person_id = persons.id and built_in_key is not null) as role from persons
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
