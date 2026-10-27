import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, locations, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { readStarterStaffLanguage } from "./starter-language.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("readStarterStaffLanguage", () => {
  it.each([
    {
      title: "no tenant row, es-ES receipts",
      tenant: false,
      province: null,
      locale: "es-ES",
      expected: "es",
    },
    {
      title: "no tenant row, fr receipts",
      tenant: false,
      province: null,
      locale: "fr",
      expected: "en",
    },
    {
      title: "Spanish tenant, no province, fr receipts",
      tenant: true,
      province: null,
      locale: "fr",
      expected: "es",
    },
    {
      title: "Spanish tenant, Madrid, en-GB receipts",
      tenant: true,
      province: "Madrid",
      locale: "en-GB",
      expected: "en",
    },
    {
      title: "Spanish tenant, Barcelona, ca-ES receipts",
      tenant: true,
      province: "Barcelona",
      locale: "ca-ES",
      expected: "es",
    },
    {
      title: "Spanish tenant, no province, en-US receipts",
      tenant: true,
      province: null,
      locale: "en-US",
      expected: "es",
    },
  ] as const)("$title answers $expected", async ({ tenant, province, locale, expected }) => {
    if (tenant) await seedTenant(db);
    const [row] = await db
      .insert(locations)
      .values({
        name: "Starter venue",
        province,
        invoiceLocales: [locale],
        operationDescription: "Hospitality",
      })
      .returning({ id: locations.id });
    const cfg = { locationId: brandLocationId(row!.id) };
    expect(await withTransaction(db, (tx) => readStarterStaffLanguage(tx, cfg))).toBe(expected);
  });

  it("answers en for a location that does not exist", async () => {
    await seedTenant(db);
    const cfg = { locationId: brandLocationId(randomUUID()) };
    expect(await withTransaction(db, (tx) => readStarterStaffLanguage(tx, cfg))).toBe("en");
  });
});
