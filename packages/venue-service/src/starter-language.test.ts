import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { readStarterStaffLanguage } from "./starter-language.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("readStarterStaffLanguage", () => {
  it.each([
    {
      title: "no taxpayer row, es-ES receipts",
      taxpayer: false,
      province: null,
      locale: "es-ES",
      expected: "es",
    },
    {
      title: "no taxpayer row, fr receipts",
      taxpayer: false,
      province: null,
      locale: "fr",
      expected: "en",
    },
    {
      title: "Spanish taxpayer, no province, fr receipts",
      taxpayer: true,
      province: null,
      locale: "fr",
      expected: "es",
    },
    {
      title: "Spanish taxpayer, Madrid, en-GB receipts",
      taxpayer: true,
      province: "Madrid",
      locale: "en-GB",
      expected: "en",
    },
    {
      title: "Spanish taxpayer, Barcelona, ca-ES receipts",
      taxpayer: true,
      province: "Barcelona",
      locale: "ca-ES",
      expected: "es",
    },
    {
      title: "Spanish taxpayer, no province, en-US receipts",
      taxpayer: true,
      province: null,
      locale: "en-US",
      expected: "es",
    },
  ] as const)("$title answers $expected", async ({ taxpayer, province, locale, expected }) => {
    const venue = {
      name: "Starter venue",
      province,
      invoiceLocales: [locale],
    };
    if (taxpayer) await seedVenue(db, venue);
    else {
      const { name, province, invoiceLocales } = venue;
      await seedVenueSettings(db, { name, province, invoiceLocales });
      await seedBusinessDay(db);
    }
    expect(await withTransaction(db, (tx) => readStarterStaffLanguage(tx))).toBe(expected);
  });
});
