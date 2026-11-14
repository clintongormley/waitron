import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createDemoVenueProvisioner } from "./provision-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("the demo scripts' test venue", () => {
  it("passes an explicit English working language to the first department with Spanish receipts", async () => {
    await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 82_000_000,
      invoiceLocale: "es-ES",
      staffLanguage: "en",
    })();
    expect(suite.db.all(sql`select name from service_steps order by position`)).toEqual(
      ["Set up", "Take order", "Anything else?"].map((name) => ({ name })),
    );
    expect(
      suite.db.all(
        sql`select json_extract(doc, '$.invoiceLocales') as invoice_locales from settings where module = 'venue'`,
      ),
    ).toEqual([{ invoice_locales: '["es-ES"]' }]);
  });

  it("stores an English operation description", async () => {
    await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 82_000_000,
      invoiceLocale: "es-ES",
    })();

    expect(
      suite.db.all(
        sql`select json_extract(doc, '$.operationDescription') as operation_description from settings where module = 'venue'`,
      ),
    ).toEqual([{ operation_description: "Sale on premises" }]);
  });

  it.each([
    {
      country: "ES" as const,
      invoiceLocale: "es-ES",
      venueSnapshot: {
        name: "Main room",
        address_line1: "1 Market Street",
        invoice_locales: '["es-ES"]',
        fiscal_territory: "ES-common",
        time_zone: "Europe/Madrid",
      },
    },
    {
      country: "GB" as const,
      invoiceLocale: "en-GB",
      venueSnapshot: {
        name: "Main counter",
        address_line1: "1 High Street",
        invoice_locales: '["en-GB"]',
        fiscal_territory: "GB-vat",
        time_zone: "Europe/London",
      },
    },
  ])("stores English venue text for $country with its fiscal settings", async (fixture) => {
    await createDemoVenueProvisioner(() => suite.db, {
      country: fixture.country,
      nifBase: 82_000_000,
      invoiceLocale: fixture.invoiceLocale,
    })();

    expect(
      suite.db.all(sql`
        select json_extract(settings.doc, '$.name') as name, json_extract(settings.doc, '$.addressLine1') as address_line1, json_extract(settings.doc, '$.invoiceLocales') as invoice_locales, json_extract(settings.doc, '$.fiscalTerritory') as fiscal_territory, json_extract(b.doc, '$.timeZone') as time_zone
        from settings cross join settings b where settings.module = 'venue' and b.module = 'business_day'
      `),
    ).toEqual([fixture.venueSnapshot]);
  });

  it.each([
    { country: "ES" as const, invoiceLocale: "es-ES" },
    { country: "GB" as const, invoiceLocale: "en-GB" },
  ])("stores an English administrator for $country with the requested email", async (fixture) => {
    await createDemoVenueProvisioner(() => suite.db, {
      ...fixture,
      nifBase: 82_000_000,
      adminEmail: "demo-owner@example.test",
    })();

    expect(
      suite.db.all(
        sql`select display_name, email, (select built_in_key from person_roles join roles on roles.id = person_roles.role_id where person_roles.person_id = persons.id and built_in_key is not null) as role from persons`,
      ),
    ).toEqual([
      {
        display_name: "Administrator",
        email: "demo-owner@example.test",
        role: "admin",
      },
    ]);
  });
});
