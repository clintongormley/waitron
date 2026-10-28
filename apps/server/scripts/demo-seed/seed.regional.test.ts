import { afterEach, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import {
  readContentLanguages,
  buildMenuDocument,
  listAvailableProducts,
  listMenuOffers,
  listTranslationGapReport,
} from "@waitron/catalogue";
import * as selections from "./data-set.js";
import { seedSales } from "./seed-sales.js";
vi.mock("./seed-sales.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./seed-sales.js")>();
  return { ...real, seedSales: vi.fn(real.seedSales) };
});
import { seedDemoRestaurant } from "./seed.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";
import { demoMediaPath } from "./seed-media.js";
import { readFile, mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPin, verifyPassword } from "@waitron/identity";
import { DEMO_DASHBOARD_PASSWORD } from "./credentials.js";
import { DEMO_BASELINE_FIXTURE_ROOTS } from "@waitron/country-packs/demo/testing";
const expected = JSON.parse(
  await readFile(
    new URL("catalan-names.json", DEMO_BASELINE_FIXTURE_ROOTS["casa-delgado-es"]),
    "utf8",
  ),
) as {
  sausage: { staff: string; kitchen: string; customer: Record<string, string> };
  wine: string;
  drinks: string;
  menus: { restaurant: string; lunch: string };
  products: { staff: string; price: string; vatClass: string }[];
};
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60000,
});
afterEach(() => vi.useRealTimers());
for (const [province, postalCode, invoiceLocale] of [
  ["Barcelona", "08001", "ca-ES"],
  ["Balears, Illes", "07001", "es-ES"],
])
  for (const locale of ["en", "es"] as const)
    it(`offers and records regional dishes and wine with both media roots (${province}/${locale})`, async () => {
      expect(selections.DEMO_DATA_SETS).toHaveProperty("casa-delgado-ca");
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
      const venue = await createDemoVenueProvisioner(() => suite.db, {
        nifBase: 94000000,
        nifFormat: "calculated",
        invoiceLocale: invoiceLocale!,
        province,
        postalCode,
        adminPin: "5555",
      })();
      expect(selections).toHaveProperty("readDemoSeedSelection", expect.any(Function));
      const selection = await selections.readDemoSeedSelection(suite.db, venue.locationId);
      expect(selection.identity).toMatchObject({
        dataSet: "casa-delgado-ca",
        locationName: "Can Delgado",
      });
      await seedDemoRestaurant(suite.db, {
        venue,
        locale,
        salesDays: 2,
        departmentTradingNames: selection.identity.departmentTradingNames,
        dataSet: selection.dataSet,
      });
      expect(await readContentLanguages(suite.db, locale)).toMatchObject({
        defaultLanguage: "ca",
        languages: ["ca", "es", "en"],
      });
      const languageConfig = await readContentLanguages(suite.db, locale);
      const gaps = await withTransaction(suite.db, (tx) =>
        listTranslationGapReport(tx, languageConfig),
      );
      expect(gaps.flatMap((language) => language.gaps)).toEqual([]);
      const rows = suite.db.all<{
        name: string;
        kitchen_name: string;
        customer_name: string;
        image: string;
      }>(sql`select name,kitchen_name,customer_name,image from products where parent_id is null`);
      expect(rows.some((p) => p.name === expected.sausage.staff)).toBe(true);
      const sausage = rows.find((p) => p.name === expected.sausage.staff)!;
      expect(sausage.kitchen_name).toBe(expected.sausage.kitchen);
      expect(JSON.parse(sausage.customer_name)).toMatchObject({
        ca: expected.sausage.customer.ca,
        en: "House Catalan sausage with white beans",
      });
      const menus = suite.db.all<{ id: string; name: string }>(sql`select id,name from catalogues`);
      const drinks = menus.find((m) => m.name === expected.drinks)!;
      expect(drinks).toBeDefined();
      const doc = await withTransaction(suite.db, (tx) => buildMenuDocument(tx, drinks.id));
      expect(JSON.stringify(doc)).toContain(expected.wine);
      expect(JSON.stringify(doc)).not.toContain(expected.sausage.staff);
      for (const name of [expected.menus.restaurant, expected.menus.lunch]) {
        const menu = menus.find((row) => row.name === name)!;
        expect(menu, name).toBeDefined();
        const offers = await withTransaction(suite.db, (tx) => listMenuOffers(tx, [menu.id]));
        expect(offers.find((offer) => offer.name === expected.wine)).toMatchObject({
          unitPrice: "4.50",
          vatClass: "general",
        });
        if (name === expected.menus.restaurant)
          for (const product of expected.products)
            expect(
              offers.find((offer) => offer.name === product.staff),
              product.staff,
            ).toMatchObject({ unitPrice: product.price, vatClass: product.vatClass });
      }

      for (const row of rows) expect(row.image).toMatch(/^[0-9a-f]{64}\.webp$/);
      const manager = suite.db.all<{ pin_hash: string; password_hash: string | null }>(
        sql`select pin_hash,password_hash from persons where email='manager@demo.waitron.local'`,
      )[0]!;
      expect(await verifyPin("5555", manager.pin_hash)).toBe(true);
      expect(manager.password_hash).not.toBeNull();
      expect(await verifyPassword(DEMO_DASHBOARD_PASSWORD, manager.password_hash!)).toBe(true);
      const food = selection.dataSet.menus.restaurant.categories
        .flatMap((c) => c.products)
        .find((p) => p.image === "catalonia-botifarra.png")!;
      const source = await readFile(
        demoMediaPath(selection.dataSet.mediaDataSet, food.image, undefined),
      );
      expect(source.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const root = await mkdtemp(join(tmpdir(), "a972-media-"));
      try {
        await mkdir(join(root, selection.dataSet.mediaDataSet));
        const basenames = [
          selection.dataSet.menus.restaurant,
          selection.dataSet.menus.deli,
          selection.dataSet.menus.lunch,
        ].flatMap((menu) =>
          menu.categories.flatMap((category) => category.products.map((product) => product.image)),
        );
        for (const basename of basenames) {
          const original = demoMediaPath(selection.dataSet.mediaDataSet, basename, undefined);
          const sourceBytes = await readFile(original);
          await cp(original, join(root, selection.dataSet.mediaDataSet, basename));
          expect(
            await readFile(demoMediaPath(selection.dataSet.mediaDataSet, basename, root)),
            basename,
          ).toEqual(sourceBytes);
        }
      } finally {
        await rm(root, { recursive: true });
      }
      const available = (await listAvailableProducts(suite.db, venue.locationId)).products;
      expect(available.some((p) => p.name === expected.sausage.staff)).toBe(true);
      expect(available.some((p) => p.name === expected.wine)).toBe(true);
      const input = vi.mocked(seedSales).mock.calls.at(-1)![1];
      expect(input.products.map((p) => p.id).sort()).toEqual(available.map((p) => p.id).sort());
      const sales = suite.db.all<{ invoice_locales: string; descriptions: string }>(
        sql`select s.invoice_locales,l.descriptions from sales s join sale_lines l on l.sale_id=s.id`,
      );
      expect(sales.length).toBeGreaterThan(0);
      for (const row of sales) {
        expect(JSON.parse(row.invoice_locales)).toEqual([invoiceLocale]);
        expect(Object.keys(JSON.parse(row.descriptions))).toEqual([invoiceLocale]);
      }
    });

it("records a forced regional-only pool through the unchanged fiscal seat", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
  const venue = await createDemoVenueProvisioner(() => suite.db, {
    nifBase: 96000000,
    nifFormat: "calculated",
    invoiceLocale: "ca-ES",
    province: "Barcelona",
    postalCode: "08001",
  })();
  const selection = await selections.readDemoSeedSelection(suite.db, venue.locationId);
  await seedDemoRestaurant(suite.db, {
    venue,
    locale: "es",
    salesDays: 0,
    departmentTradingNames: selection.identity.departmentTradingNames,
    dataSet: selection.dataSet,
  });
  const product = (await listAvailableProducts(suite.db, venue.locationId)).products.find(
    (p) => p.name === expected.sausage.staff,
  )!;
  const { count } = await seedSales(suite.db, {
    venue: { nodeId: venue.nodeId, seriesId: venue.seriesId },
    invoiceLocale: "ca-ES",
    days: 2,
    products: [
      {
        id: product.id,
        name: product.name,
        customerName: product.customerName,
        unitPrice: product.unitPrice,
        vatClass: product.vatClass,
      },
    ],
  });
  expect(count).toBeGreaterThan(0);
  const rows = suite.db.all<{ name: string; descriptions: string }>(
    sql`select name,descriptions from sale_lines`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.name).toBe(expected.sausage.staff);
    expect(JSON.parse(row.descriptions)).toEqual({ "ca-ES": expected.sausage.customer.ca });
  }
  expect(suite.db.all<{ n: number }>(sql`select count(*) as n from registros_facturacion`)).toEqual(
    [{ n: count }],
  );
});
