/**
 * The wizard's Demo path on a real database: the server's `provisionVenue` with a Demo-shaped
 * venue, then `seedInstalledDemo`, which the setup route runs next.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readContentLanguages } from "@waitron/catalogue";
import { getCountryPack } from "@waitron/country-packs";
import { hashPassword, hashPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parseModuleConfig } from "@waitron/module";
import type { VenueRequest } from "@waitron/provisioning";
import { seedInstalledDemo } from "./demo-seed.js";
import { ALL_MODULES } from "./modules.js";
import { provisionVenue, venueModuleConfig } from "./provision.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("provisions Spain's demo business and files its practice sales under the demo tax ID", async () => {
  const identity = getCountryPack("ES")!.demo!;
  const venue: VenueRequest = {
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
      displayName: "Administradora",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("dashPass123"),
      email: "owner@example.test",
    },
  };
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-demo-seed-"));
  try {
    const result = await provisionVenue(
      {
        ownerDb: suite.db,
        moduleConfig: venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common"),
        database: "venue",
        stateDir,
      },
      { environment: "preproduction", venue },
    );

    await seedInstalledDemo(suite.db, result, venue);

    const { rows: departments } = await suite.db.execute<{ trading_name: string }>(
      sql`select trading_name from departments order by trading_name`,
    );
    const { rows: sales } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from sales`,
    );
    const { rows: records } = await suite.db.execute<{ issuer: string; n: number }>(
      sql`select id_emisor_factura as issuer, count(*) as n from registros_facturacion group by id_emisor_factura`,
    );
    expect(departments.map((d) => d.trading_name)).toEqual(["Bar Casa Delgado", "Deli Delgado"]);
    expect(sales[0]!.n).toBeGreaterThan(0);
    expect(records).toEqual([{ issuer: "B00000000", n: sales[0]!.n }]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

it("names a Barcelona demo's dishes in its Spanish-speaking admin's language, with Catalan the content default", async () => {
  const identity = getCountryPack("ES")!.demo!;
  const venue: VenueRequest = {
    country: "ES",
    taxId: identity.taxId,
    legalName: identity.legalName,
    location: {
      name: identity.locationName,
      fiscalTerritory: "ES-common",
      invoiceLocales: ["ca-ES"],
      operationDescription: "Venda a l'establiment",
      addressLine1: "Carrer Major 1",
      addressLine2: null,
      postalCode: "08001",
      city: "Barcelona",
      province: "Barcelona",
      timeZone: "Europe/Madrid",
      dayCutover: "04:00",
    },
    seriesCode: "FS",
    rectificativeSeriesCode: "FR",
    admin: {
      displayName: "Administradora",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("dashPass123"),
      email: "owner@example.test",
      locale: "es-ES",
    },
  };
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-demo-seed-"));
  try {
    const result = await provisionVenue(
      {
        ownerDb: suite.db,
        moduleConfig: venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common"),
        database: "venue",
        stateDir,
      },
      { environment: "preproduction", venue },
    );

    await seedInstalledDemo(suite.db, result, venue);

    const { rows: products } = await suite.db.execute<{ name: string }>(
      sql`select name from products where name in ('Ensalada mixta', 'Mixed salad')`,
    );
    const languages = await withTransaction(suite.db, (tx) => readContentLanguages(tx, "es"));
    expect(products.map((p) => p.name)).toEqual(["Ensalada mixta"]);
    expect(languages.defaultLanguage).toBe("ca");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
