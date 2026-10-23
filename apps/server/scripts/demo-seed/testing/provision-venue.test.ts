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
  it("stores an English operation description for the Spanish practice venue", async () => {
    await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 82_000_000,
      invoiceLocale: "es-ES",
    })();

    expect(suite.db.all(sql`select operation_description from locations`)).toEqual([
      { operation_description: "Sale on premises" },
    ]);
  });

  it.each([
    {
      country: "ES" as const,
      invoiceLocale: "es-ES",
      location: {
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
      location: {
        name: "Main counter",
        address_line1: "1 High Street",
        invoice_locales: '["en-GB"]',
        fiscal_territory: "GB-vat",
        time_zone: "Europe/London",
      },
    },
  ])("stores English location text for $country with its fiscal settings", async (fixture) => {
    await createDemoVenueProvisioner(() => suite.db, {
      country: fixture.country,
      nifBase: 82_000_000,
      invoiceLocale: fixture.invoiceLocale,
    })();

    expect(
      suite.db.all(sql`
        select name, address_line1, invoice_locales, fiscal_territory, time_zone
        from locations
      `),
    ).toEqual([fixture.location]);
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

    expect(suite.db.all(sql`select display_name, email, role from persons`)).toEqual([
      {
        display_name: "Administrator",
        email: "demo-owner@example.test",
        role: "admin",
      },
    ]);
  });
});
