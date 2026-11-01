import { VALENCIA_DEMO_TEXT, GALICIA_DEMO_TEXT } from "@waitron/country-packs/demo/testing";
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
      const available = (await listAvailableProducts(suite.db)).products;
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
  const product = (await listAvailableProducts(suite.db)).products.find(
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

for (const locale of ["en", "es"] as const)
  it(`offers and records Valencian dishes and wine with both media roots (${locale})`, async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 97000000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
      province: VALENCIA_DEMO_TEXT.province,
      postalCode: "46001",
      adminPin: "5555",
    })();
    const selection = await selections.readDemoSeedSelection(suite.db, venue.locationId);
    expect(selection.identity).toMatchObject({
      dataSet: "casa-delgado-valencia",
      locationName: VALENCIA_DEMO_TEXT.locationName,
    });
    await seedDemoRestaurant(suite.db, {
      venue,
      locale,
      salesDays: 2,
      departmentTradingNames: selection.identity.departmentTradingNames,
      dataSet: selection.dataSet,
    });
    const languages = await readContentLanguages(suite.db, locale);
    expect(languages).toMatchObject({
      defaultLanguage: "ca-ES-valencia",
      languages: ["ca-ES-valencia", "es", "en"],
    });
    const gaps = await withTransaction(suite.db, (tx) => listTranslationGapReport(tx, languages));
    expect(gaps.flatMap((language) => language.gaps)).toEqual([]);
    const rows = suite.db.all<{
      name: string;
      kitchen_name: string;
      customer_name: string;
      image: string;
    }>(sql`select name,kitchen_name,customer_name,image from products where parent_id is null`);
    expect(rows.find((p) => p.name === VALENCIA_DEMO_TEXT.dish)).toMatchObject({
      kitchen_name: VALENCIA_DEMO_TEXT.dishKitchen,
    });
    expect(JSON.parse(rows.find((p) => p.name === VALENCIA_DEMO_TEXT.dish)!.customer_name)).toEqual(
      {
        "ca-ES-valencia": VALENCIA_DEMO_TEXT.dishCustomer,
        es: VALENCIA_DEMO_TEXT.dishCustomer,
        en: "House eel and potato stew",
      },
    );
    const menus = suite.db.all<{ id: string; name: string }>(sql`select id,name from catalogues`);
    for (const name of [
      VALENCIA_DEMO_TEXT.drinksMenu,
      VALENCIA_DEMO_TEXT.restaurantMenu,
      VALENCIA_DEMO_TEXT.lunchMenu,
    ]) {
      const menu = menus.find((m) => m.name === name)!;
      expect(menu, name).toBeDefined();
      const offers = await withTransaction(suite.db, (tx) => listMenuOffers(tx, [menu.id]));
      expect(offers.find((p) => p.name === VALENCIA_DEMO_TEXT.wine)).toMatchObject({
        unitPrice: "4.00",
        vatClass: "general",
      });
      if (name === VALENCIA_DEMO_TEXT.restaurantMenu)
        for (const [dish, price] of [
          [VALENCIA_DEMO_TEXT.dish, "14.50"],
          [VALENCIA_DEMO_TEXT.salad, "8.50"],
          [VALENCIA_DEMO_TEXT.paella, "16.50"],
          [VALENCIA_DEMO_TEXT.horchata, "5.50"],
          [VALENCIA_DEMO_TEXT.rice, "13.50"],
          [VALENCIA_DEMO_TEXT.stew, "9.50"],
          [VALENCIA_DEMO_TEXT.dessert, "5.50"],
        ])
          expect(
            offers.find((p) => p.name === dish),
            dish,
          ).toMatchObject({ unitPrice: price, vatClass: "reduced" });
      if (name === VALENCIA_DEMO_TEXT.drinksMenu)
        expect(offers.some((p) => p.name === VALENCIA_DEMO_TEXT.dish)).toBe(false);
    }
    const people = suite.db.all<{
      display_name: string;
      pin_hash: string;
      password_hash: string | null;
    }>(
      sql`select display_name,pin_hash,password_hash from persons where email like '%@demo.waitron.local' order by display_name`,
    );
    expect(people.map((p) => p.display_name)).toEqual([
      VALENCIA_DEMO_TEXT.supervisor,
      VALENCIA_DEMO_TEXT.clara,
      VALENCIA_DEMO_TEXT.neus,
      VALENCIA_DEMO_TEXT.pau,
      VALENCIA_DEMO_TEXT.manager,
    ]);
    const manager = people.find((p) => p.display_name === VALENCIA_DEMO_TEXT.manager)!;
    expect(await verifyPin("5555", manager.pin_hash)).toBe(true);
    expect(await verifyPassword(DEMO_DASHBOARD_PASSWORD, manager.password_hash!)).toBe(true);
    for (const person of people.filter((p) => p !== manager))
      expect(person.password_hash).toBeNull();
    const root = await mkdtemp(join(tmpdir(), "a972-valencia-media-"));
    try {
      await mkdir(join(root, selection.dataSet.mediaDataSet));
      const basenames = [
        selection.dataSet.menus.restaurant,
        selection.dataSet.menus.deli,
        selection.dataSet.menus.lunch,
      ].flatMap((m) => m.categories.flatMap((c) => c.products.map((p) => p.image)));
      for (const basename of basenames) {
        const original = demoMediaPath(selection.dataSet.mediaDataSet, basename, undefined);
        const source = await readFile(original);
        expect(source.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        await cp(original, join(root, selection.dataSet.mediaDataSet, basename));
        expect(
          await readFile(demoMediaPath(selection.dataSet.mediaDataSet, basename, root)),
          basename,
        ).toEqual(source);
      }
    } finally {
      await rm(root, { recursive: true });
    }
    for (const row of rows) expect(row.image).toMatch(/^[0-9a-f]{64}\.webp$/);
    const available = (await listAvailableProducts(suite.db)).products;
    const pool = vi.mocked(seedSales).mock.calls.at(-1)![1].products;
    expect(pool.map((p) => p.id).sort()).toEqual(available.map((p) => p.id).sort());
    for (const name of [
      VALENCIA_DEMO_TEXT.dish,
      VALENCIA_DEMO_TEXT.salad,
      VALENCIA_DEMO_TEXT.paella,
      VALENCIA_DEMO_TEXT.horchata,
      VALENCIA_DEMO_TEXT.rice,
      VALENCIA_DEMO_TEXT.stew,
      VALENCIA_DEMO_TEXT.dessert,
      VALENCIA_DEMO_TEXT.wine,
    ])
      expect(
        pool.some((p) => p.name === name),
        name,
      ).toBe(true);
    const sales = suite.db.all<{ invoice_locales: string; descriptions: string }>(
      sql`select s.invoice_locales,l.descriptions from sales s join sale_lines l on l.sale_id=s.id`,
    );
    expect(sales.length).toBeGreaterThan(0);
    for (const row of sales) {
      expect(JSON.parse(row.invoice_locales)).toEqual(["es-ES"]);
      expect(Object.keys(JSON.parse(row.descriptions))).toEqual(["es-ES"]);
    }
  });

it("stores the Valencian plain-name entry when Catalan and Valencian differ", async () => {
  const venue = await createDemoVenueProvisioner(() => suite.db, {
    nifBase: 98000000,
    nifFormat: "calculated",
    invoiceLocale: "es-ES",
    province: VALENCIA_DEMO_TEXT.province,
    postalCode: "46001",
  })();
  const { dataSet, identity } = await selections.readDemoSeedSelection(suite.db, venue.locationId);
  expect(dataSet.plainNameLanguage).toBe("ca-ES-valencia");
  const synthetic = {
    ...dataSet,
    printerName: {
      en: "English printer",
      es: "Spanish printer",
      ca: "Catalan printer",
      "ca-ES-valencia": "Valencian printer",
    },
  };
  await seedDemoRestaurant(suite.db, {
    venue,
    locale: "es",
    salesDays: 0,
    dataSet: synthetic,
    departmentTradingNames: identity.departmentTradingNames,
  });
  expect(suite.db.all(sql`select name from printers`)).toEqual([{ name: "Valencian printer" }]);
});

it.each([
  [VALENCIA_DEMO_TEXT.dish, VALENCIA_DEMO_TEXT.dishCustomer],
  [VALENCIA_DEMO_TEXT.salad, VALENCIA_DEMO_TEXT.saladCustomer],
  [VALENCIA_DEMO_TEXT.paella, VALENCIA_DEMO_TEXT.paellaCustomer],
  [VALENCIA_DEMO_TEXT.horchata, VALENCIA_DEMO_TEXT.horchataCustomerEs],
  [VALENCIA_DEMO_TEXT.rice, VALENCIA_DEMO_TEXT.riceCustomerEs],
  [VALENCIA_DEMO_TEXT.stew, VALENCIA_DEMO_TEXT.stewCustomer],
  [VALENCIA_DEMO_TEXT.dessert, VALENCIA_DEMO_TEXT.dessertCustomer],
  [VALENCIA_DEMO_TEXT.wine, VALENCIA_DEMO_TEXT.wineCustomerEs],
])("records a forced Valencian %s through the unchanged fiscal seat", async (name, customer) => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
  const venue = await createDemoVenueProvisioner(() => suite.db, {
    nifBase: 99000000,
    nifFormat: "calculated",
    invoiceLocale: "es-ES",
    province: VALENCIA_DEMO_TEXT.province,
    postalCode: "46001",
  })();
  const { dataSet, identity } = await selections.readDemoSeedSelection(suite.db, venue.locationId);
  expect(dataSet.id).toBe("casa-delgado-valencia");
  await seedDemoRestaurant(suite.db, {
    venue,
    locale: "es",
    salesDays: 0,
    dataSet,
    departmentTradingNames: identity.departmentTradingNames,
  });
  const available = (await listAvailableProducts(suite.db)).products;
  const product = available.find((p) => p.name === name)!;
  expect(product, name).toBeDefined();
  const { count } = await seedSales(suite.db, {
    venue: { nodeId: venue.nodeId, seriesId: venue.seriesId },
    invoiceLocale: "es-ES",
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

  const rows = suite.db.all<{ name: string; descriptions: string }>(
    sql`select name,descriptions from sale_lines where name=${name!}`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.name).toBe(name);
    expect(JSON.parse(row.descriptions)).toEqual({ "es-ES": customer });
  }
  expect(count).toBeGreaterThan(0);
  expect(suite.db.all(sql`select count(*) as n from registros_facturacion`)).toEqual([
    { n: count },
  ]);
});

for (const locale of ["en", "es"] as const)
  it(`offers and records Galician dishes and wine with both media roots (${locale})`, async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 97000000,
      nifFormat: "calculated",
      invoiceLocale: "es-ES",
      province: GALICIA_DEMO_TEXT.province,
      postalCode: "15001",
      adminPin: "5555",
    })();
    const selection = await selections.readDemoSeedSelection(suite.db, venue.locationId);
    expect(selection.identity).toMatchObject({
      dataSet: "casa-delgado-gl",
      locationName: GALICIA_DEMO_TEXT.locationName,
    });
    await seedDemoRestaurant(suite.db, {
      venue,
      locale,
      salesDays: 2,
      departmentTradingNames: selection.identity.departmentTradingNames,
      dataSet: selection.dataSet,
    });
    const languages = await readContentLanguages(suite.db, locale);
    expect(languages).toMatchObject({
      defaultLanguage: "gl",
      languages: ["gl", "es", "en"],
    });
    const gaps = await withTransaction(suite.db, (tx) => listTranslationGapReport(tx, languages));
    expect(gaps.flatMap((language) => language.gaps)).toEqual([]);
    const rows = suite.db.all<{
      name: string;
      kitchen_name: string;
      customer_name: string;
      image: string;
    }>(sql`select name,kitchen_name,customer_name,image from products where parent_id is null`);
    expect(rows.find((p) => p.name === GALICIA_DEMO_TEXT.dish)).toMatchObject({
      kitchen_name: GALICIA_DEMO_TEXT.dishKitchen,
    });
    expect(JSON.parse(rows.find((p) => p.name === GALICIA_DEMO_TEXT.dish)!.customer_name)).toEqual({
      gl: GALICIA_DEMO_TEXT.dishCustomer,
      es: GALICIA_DEMO_TEXT.dishCustomerEs,
      en: "House Galician savoury pie",
    });
    const menus = suite.db.all<{ id: string; name: string }>(sql`select id,name from catalogues`);
    for (const name of [
      GALICIA_DEMO_TEXT.drinksMenu,
      GALICIA_DEMO_TEXT.restaurantMenu,
      GALICIA_DEMO_TEXT.lunchMenu,
    ]) {
      const menu = menus.find((m) => m.name === name)!;
      expect(menu, name).toBeDefined();
      const offers = await withTransaction(suite.db, (tx) => listMenuOffers(tx, [menu.id]));
      expect(offers.find((p) => p.name === GALICIA_DEMO_TEXT.wine)).toMatchObject({
        unitPrice: "4.50",
        vatClass: "general",
      });
      if (name === GALICIA_DEMO_TEXT.restaurantMenu)
        for (const [dish, price] of [
          [GALICIA_DEMO_TEXT.dish, "8.50"],
          [GALICIA_DEMO_TEXT.soup, "6.50"],
          [GALICIA_DEMO_TEXT.pork, "14.50"],
          [GALICIA_DEMO_TEXT.pancakes, "5.50"],
          [GALICIA_DEMO_TEXT.fish, "9.50"],
          [GALICIA_DEMO_TEXT.mussels, "10.50"],
          [GALICIA_DEMO_TEXT.cake, "5.50"],
        ])
          expect(
            offers.find((p) => p.name === dish),
            dish,
          ).toMatchObject({ unitPrice: price, vatClass: "reduced" });
      if (name === GALICIA_DEMO_TEXT.drinksMenu)
        expect(offers.some((p) => p.name === GALICIA_DEMO_TEXT.dish)).toBe(false);
    }
    const people = suite.db.all<{
      display_name: string;
      pin_hash: string;
      password_hash: string | null;
    }>(
      sql`select display_name,pin_hash,password_hash from persons where email like '%@demo.waitron.local' order by display_name`,
    );
    expect(people.map((p) => p.display_name)).toEqual([
      GALICIA_DEMO_TEXT.anton,
      GALICIA_DEMO_TEXT.brais,
      GALICIA_DEMO_TEXT.iria,
      GALICIA_DEMO_TEXT.supervisor,
      GALICIA_DEMO_TEXT.manager,
    ]);
    const manager = people.find((p) => p.display_name === GALICIA_DEMO_TEXT.manager)!;
    expect(await verifyPin("5555", manager.pin_hash)).toBe(true);
    expect(await verifyPassword(DEMO_DASHBOARD_PASSWORD, manager.password_hash!)).toBe(true);
    for (const person of people.filter((p) => p !== manager))
      expect(person.password_hash).toBeNull();
    const root = await mkdtemp(join(tmpdir(), "a972-galicia-media-"));
    try {
      await mkdir(join(root, selection.dataSet.mediaDataSet));
      const basenames = [
        selection.dataSet.menus.restaurant,
        selection.dataSet.menus.deli,
        selection.dataSet.menus.lunch,
      ].flatMap((m) => m.categories.flatMap((c) => c.products.map((p) => p.image)));
      for (const basename of basenames) {
        const original = demoMediaPath(selection.dataSet.mediaDataSet, basename, undefined);
        const source = await readFile(original);
        expect(source.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        await cp(original, join(root, selection.dataSet.mediaDataSet, basename));
        expect(
          await readFile(demoMediaPath(selection.dataSet.mediaDataSet, basename, root)),
          basename,
        ).toEqual(source);
      }
    } finally {
      await rm(root, { recursive: true });
    }
    for (const row of rows) expect(row.image).toMatch(/^[0-9a-f]{64}\.webp$/);
    const available = (await listAvailableProducts(suite.db)).products;
    const pool = vi.mocked(seedSales).mock.calls.at(-1)![1].products;
    expect(pool.map((p) => p.id).sort()).toEqual(available.map((p) => p.id).sort());
    for (const name of [
      GALICIA_DEMO_TEXT.dish,
      GALICIA_DEMO_TEXT.soup,
      GALICIA_DEMO_TEXT.pork,
      GALICIA_DEMO_TEXT.pancakes,
      GALICIA_DEMO_TEXT.fish,
      GALICIA_DEMO_TEXT.mussels,
      GALICIA_DEMO_TEXT.cake,
      GALICIA_DEMO_TEXT.wine,
    ])
      expect(
        pool.some((p) => p.name === name),
        name,
      ).toBe(true);
    const sales = suite.db.all<{ invoice_locales: string; descriptions: string }>(
      sql`select s.invoice_locales,l.descriptions from sales s join sale_lines l on l.sale_id=s.id`,
    );
    expect(sales.length).toBeGreaterThan(0);
    for (const row of sales) {
      expect(JSON.parse(row.invoice_locales)).toEqual(["es-ES"]);
      expect(Object.keys(JSON.parse(row.descriptions))).toEqual(["es-ES"]);
    }
  });

it.each([
  [GALICIA_DEMO_TEXT.dish, GALICIA_DEMO_TEXT.dishCustomerEs],
  [GALICIA_DEMO_TEXT.soup, GALICIA_DEMO_TEXT.soupCustomerEs],
  [GALICIA_DEMO_TEXT.pork, GALICIA_DEMO_TEXT.porkCustomerEs],
  [GALICIA_DEMO_TEXT.pancakes, GALICIA_DEMO_TEXT.pancakesCustomerEs],
  [GALICIA_DEMO_TEXT.fish, GALICIA_DEMO_TEXT.fishCustomerEs],
  [GALICIA_DEMO_TEXT.mussels, GALICIA_DEMO_TEXT.musselsCustomerEs],
  [GALICIA_DEMO_TEXT.cake, GALICIA_DEMO_TEXT.cakeCustomerEs],
  [GALICIA_DEMO_TEXT.wine, GALICIA_DEMO_TEXT.wineCustomerEs],
])("records a forced Galician %s through the unchanged fiscal seat", async (name, customer) => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
  const venue = await createDemoVenueProvisioner(() => suite.db, {
    nifBase: 99000000,
    nifFormat: "calculated",
    invoiceLocale: "es-ES",
    province: GALICIA_DEMO_TEXT.province,
    postalCode: "15001",
  })();
  const { dataSet, identity } = await selections.readDemoSeedSelection(suite.db, venue.locationId);
  expect(dataSet.id).toBe("casa-delgado-gl");
  await seedDemoRestaurant(suite.db, {
    venue,
    locale: "es",
    salesDays: 0,
    dataSet,
    departmentTradingNames: identity.departmentTradingNames,
  });
  const available = (await listAvailableProducts(suite.db)).products;
  const product = available.find((p) => p.name === name)!;
  expect(product, name).toBeDefined();
  const { count } = await seedSales(suite.db, {
    venue: { nodeId: venue.nodeId, seriesId: venue.seriesId },
    invoiceLocale: "es-ES",
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

  const rows = suite.db.all<{ name: string; descriptions: string }>(
    sql`select name,descriptions from sale_lines where name=${name!}`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.name).toBe(name);
    expect(JSON.parse(row.descriptions)).toEqual({ "es-ES": customer });
  }
  expect(count).toBeGreaterThan(0);
  expect(suite.db.all(sql`select count(*) as n from registros_facturacion`)).toEqual([
    { n: count },
  ]);
});
