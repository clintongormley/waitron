import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { readSettings, withTransaction, type Database, type Transaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { MENU_SETTINGS } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { configurationBundle } from "../test/configuration-bundle.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import {
  decodeConfigurationBundle,
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
  // 5% passes the bundle's shape check but is not on Spain's pick list.
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

const NO_PRODUCTS = { products: [], product_takeaway_vat_rates: [] };

function withMenuDefault(bundle: ConfigurationBundle, defaultTakeawayVatRate: string | null) {
  bundle.tables = NO_PRODUCTS;
  bundle.settings = {
    menu: {
      version: MENU_SETTINGS.version,
      doc: {
        defaultProductVatClass: "general",
        defaultTakeawayVatRate,
        defaultColor: null,
        starterUnitsCreated: true,
      },
    },
  };
  return bundle;
}

it("refuses a new-product takeaway default the importing venue's area does not offer, writing nothing", async () => {
  await seedSpanishVenue();
  // 5.00 has Spain's spelling but is not on its pick list.
  const bundle = withMenuDefault(spanishBundle({}), "5.00");
  expect(() => validateConfigurationBundle(bundle, [rateModule], bundle.modules)).not.toThrow();
  await expect(importBundle(bundle)).rejects.toMatchObject({
    code: "setup.request_invalid",
    params: { field: "settings.menu.defaultTakeawayVatRate" },
  });
  expect(await readSettings(suite.db, MENU_SETTINGS)).toMatchObject({ revision: 0 });
});

it.each(["10.00", null])("imports %j as the new-product takeaway default", async (rate) => {
  await seedSpanishVenue();
  await importBundle(withMenuDefault(spanishBundle({}), rate));
  expect((await readSettings(suite.db, MENU_SETTINGS)).doc.defaultTakeawayVatRate).toBe(rate);
});

it("checks the new-product takeaway default against the importing venue's area, not Spain's", async () => {
  await seedPersons(suite.db, {
    displayName: "Admin",
    role: "admin",
    passwordHash: "admin-password",
  });
  await seedVenue(suite.db, { fiscalTerritory: "GB-vat" });
  await suite.db.execute(sql`update taxpayer set country = 'GB'`);
  // Spain picks 10.00; the United Kingdom's pack picks only 0.00.
  await expect(importBundle(withMenuDefault(configurationBundle(), "10.00"))).rejects.toMatchObject(
    {
      code: "setup.request_invalid",
      params: { field: "settings.menu.defaultTakeawayVatRate" },
    },
  );
  await importBundle(withMenuDefault(configurationBundle(), "0.00"));
  expect((await readSettings(suite.db, MENU_SETTINGS)).doc.defaultTakeawayVatRate).toBe("0.00");
});

it("refuses as outdated a format-56 export, whose menu document has no takeaway default", () => {
  const bundle = { ...configurationBundle(), version: 56 };
  bundle.settings = {
    menu: {
      version: 1,
      doc: { defaultProductVatClass: "general", defaultColor: null, starterUnitsCreated: true },
    },
  };
  const artifact = encryptArtifact(
    packArchive([{ name: "configuration.json", bytes: Buffer.from(JSON.stringify(bundle)) }]),
    "a strong passphrase",
  );
  expect(() => decodeConfigurationBundle(artifact, "a strong passphrase")).toThrow(
    expect.objectContaining({ code: "setup.configuration_outdated", params: {} }),
  );
});
