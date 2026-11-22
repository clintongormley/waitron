import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { configurationBundle } from "../test/configuration-bundle.js";
import {
  exportConfigurationTables,
  importConfigurationTables,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const destination = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const menu = ALL_MODULES.find((m) => m.name === "menu")!;
if (menu.configurationTransfer?.kind !== "tables") throw new Error("menu must transfer tables");
// Menu's checks over products and their takeaway rates alone; menu has no set of its own.
const rateModule: WaitronModule = {
  ...menu,
  configurationTransfer: {
    ...menu.configurationTransfer,
    tables: [{ name: "products" }, { name: "product_takeaway_vat_rates" }],
  },
};
const AT = "2026-11-22T08:00:00.000Z";
const GIN = {
  id: "gin",
  name: "Gin",
  unit_price: 900,
  vat_class: "general",
  created_at: AT,
  updated_at: AT,
};

function spanishBundle(tables: ConfigurationBundle["tables"]) {
  const bundle = configurationBundle();
  bundle.venue = {
    ...bundle.venue,
    country: "ES",
    fiscalTerritory: "ES-common",
    timeZone: "Europe/Madrid",
  };
  bundle.contentLanguages = { defaultLanguage: "es", languages: ["es"] };
  bundle.tables = tables;
  return bundle;
}

function importBundle(bundle: ConfigurationBundle, db: Database = suite.db) {
  return withTransaction(db, (tx) =>
    importConfigurationTables(tx, bundle, [rateModule], bundle.modules),
  );
}

async function seedSpanishVenue(db = suite.db) {
  await seedPersons(db, { displayName: "Admin", role: "admin", passwordHash: "admin-password" });
  await seedVenue(db);
}

async function seedRatedProducts(tx: Transaction) {
  await tx.execute(sql`insert into products (id, name, unit_price, vat_class, created_at, updated_at)
    values ('gin', 'Gin', 900, 'general', ${AT}, ${AT}), ('tonic', 'Tonic', 300, 'general', ${AT}, ${AT})`);
  await tx.execute(sql`insert into products (id, parent_id, name, unit_price, created_at, updated_at)
    values ('single', 'gin', 'Single', null, ${AT}, ${AT})`);
  await tx.execute(sql`insert into product_takeaway_vat_rates (id, product_id, starts_on, rate)
    values ('r1', 'gin', null, 1000), ('r2', 'gin', '2027-01-01', 2100), ('r3', 'tonic', null, 2100)`);
}

it("round trips products' takeaway rates, a variant without rows staying without", async () => {
  await seedSpanishVenue();
  await seedSpanishVenue(destination.db);
  const exported = await withTransaction(suite.db, async (tx) => {
    await seedRatedProducts(tx);
    return exportConfigurationTables(tx, [rateModule]);
  });
  await importBundle(spanishBundle(exported.tables), destination.db);
  const rows = (
    await destination.db.execute<{ name: string; starts_on: string | null; rate: number }>(sql`
      select p.name, r.starts_on, r.rate from product_takeaway_vat_rates r
      join products p on p.id = r.product_id order by p.name, r.starts_on`)
  ).rows;
  expect(rows).toEqual([
    { name: "Gin", starts_on: null, rate: 1000 },
    { name: "Gin", starts_on: "2027-01-01", rate: 2100 },
    { name: "Tonic", starts_on: null, rate: 2100 },
  ]);
  const ids = (
    await destination.db.execute<{ product_id: string }>(
      sql`select product_id from product_takeaway_vat_rates`,
    )
  ).rows.map((row) => row.product_id);
  expect(ids).not.toContain("gin");
  expect(ids).not.toContain("tonic");
});

it("refuses a takeaway rate the importing venue's area does not offer for picking", async () => {
  await seedSpanishVenue();
  const ginAt = (rate: number) =>
    spanishBundle({
      products: [GIN],
      product_takeaway_vat_rates: [{ id: "r1", product_id: "gin", starts_on: null, rate }],
    });
  // 5% is a Spanish rate the VAT return cannot report, so it is accepted but not pickable.
  const bundle = ginAt(500);
  expect(() => validateConfigurationBundle(bundle, [rateModule], bundle.modules)).not.toThrow();
  await expect(importBundle(bundle)).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "product_takeaway_vat_rates.rate" },
  });
  expect((await suite.db.execute(sql`select * from products`)).rows).toEqual([]);
  await importBundle(ginAt(1000));
});

it("refuses a takeaway rate naming a product the bundle does not carry, writing nothing", async () => {
  await seedSpanishVenue();
  const bundle = spanishBundle({
    products: [GIN],
    product_takeaway_vat_rates: [
      { id: "r1", product_id: "gin", starts_on: null, rate: 1000 },
      { id: "r2", product_id: "tonic", starts_on: null, rate: 1000 },
    ],
  });
  await expect(importBundle(bundle)).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "product_takeaway_vat_rates.product_id" },
  });
  expect((await suite.db.execute(sql`select * from products`)).rows).toEqual([]);
  expect((await suite.db.execute(sql`select * from product_takeaway_vat_rates`)).rows).toEqual([]);
});
