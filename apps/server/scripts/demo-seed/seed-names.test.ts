import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { DEMO_BASELINE_FIXTURE_ROOTS } from "@waitron/country-packs/demo/testing";
import { getCountryPack } from "@waitron/country-packs";
import { seedDemoRestaurant } from "./seed.js";
import { readDemoSeedSelection } from "./data-set.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";
import { CASA_DELGADO_ES } from "./testing/data.js";

type Pair = Record<"en" | "es", string>;
interface Names {
  staff: Pair;
  kitchen: Pair;
  customerEnglish: string;
}
interface ListNames {
  name: Pair;
  kitchen: Pair;
}
const expected = JSON.parse(
  await readFile(
    new URL("plain-names.json", DEMO_BASELINE_FIXTURE_ROOTS["casa-delgado-es"]),
    "utf8",
  ),
) as {
  products: Record<string, Names>;
  variants: Names[];
  options: ListNames & { labels: ListNames[] };
  extras: ListNames;
};
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
afterEach(() => vi.useRealTimers());
for (const locale of ["en", "es"] as const) {
  it(`writes every product, variant and modifier plain name in ${locale}`, async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T10:00:00.000Z") });
    const venue = await createDemoVenueProvisioner(() => suite.db, {
      nifBase: 93_000_000,
      invoiceLocale: "es-ES",
      nifFormat: "calculated",
      adminPin: "5555",
    })();
    await seedDemoRestaurant(suite.db, {
      venue,
      locale,
      salesDays: 0,
      departmentTradingNames: getCountryPack("ES")!.demo!.departmentTradingNames,
      dataSet: CASA_DELGADO_ES,
    });
    expect(
      suite.db.all(sql`
        select s.name from service_steps s join departments d on d.id = s.department_id
        where d.name = ${CASA_DELGADO_ES.floor.departmentNames.deli[locale]}
        order by s.position
      `),
    ).toEqual(
      (locale === "en"
        ? ["Set up", "Take order", "Anything else?"]
        : ["Montar mesa", "Tomar nota", "¿Algo más?"]
      ).map((name) => ({ name })),
    );
    const rows = suite.db.all<{ name: string; kitchen_name: string | null; customer_name: string }>(
      sql`select name, kitchen_name, customer_name from products`,
    );
    expect(rows).toHaveLength(Object.keys(expected.products).length + expected.variants.length);
    for (const want of [...Object.values(expected.products), ...expected.variants]) {
      const found = rows.filter(
        (row) =>
          (JSON.parse(row.customer_name) as Record<string, string>).en === want.customerEnglish,
      );
      expect(found, want.customerEnglish).toHaveLength(1);
      expect.soft(found[0]!.name, want.customerEnglish).toBe(want.staff[locale]);
      expect.soft(found[0]!.kitchen_name, want.customerEnglish).toBe(want.kitchen[locale]);
      expect(
        new Set(
          [
            want.staff[locale],
            want.kitchen[locale],
            (JSON.parse(found[0]!.customer_name) as Record<string, string>)[locale],
          ].map((v) => v!.toLowerCase()),
        ).size,
        want.customerEnglish,
      ).toBe(3);
    }
    for (const [table, wants] of [
      ["option_lists", [expected.options]],
      ["option_labels", expected.options.labels],
      ["extra_lists", [expected.extras]],
    ] as const) {
      const actual = suite.db.all<{ name: string; kitchen_name: string }>(
        sql`select name, kitchen_name from ${sql.identifier(table)} order by rowid`,
      );
      expect(actual).toEqual(
        wants.map((w) => ({ name: w.name[locale], kitchen_name: w.kitchen[locale] })),
      );
    }
    const unit = suite.db.all(
      sql`select staff_name, staff_abbreviation from units where seed_key is null`,
    );
    expect(unit).toEqual([
      {
        staff_name: locale === "en" ? "Portion" : "Ración",
        staff_abbreviation: locale === "en" ? "ptn" : "rac",
      },
    ]);
  });
}

for (const [province, postalCode, image, staffNames] of [
  [
    "Barcelona",
    "08001",
    "catalonia-botifarra.png",
    { en: "Catalan sausage", es: "Butifarra con judías" },
  ],
  [
    "Valencia/València",
    "46001",
    "valencia-all-pebre.png",
    { en: "Eel and potato stew", es: "All i pebre" },
  ],
  [
    "Coruña, A",
    "15001",
    "galicia-empanada.png",
    { en: "Galician savoury pie", es: "Empanada gallega" },
  ],
] as const)
  for (const locale of ["en", "es"] as const)
    it(`writes ${province} departments, groups and stations in ${locale} and keeps image customer names`, async () => {
      const venue = await createDemoVenueProvisioner(() => suite.db, {
        nifBase: 93_000_000,
        nifFormat: "calculated",
        invoiceLocale: "es-ES",
        province,
        postalCode,
      })();
      const { dataSet, identity } = await readDemoSeedSelection(suite.db);
      await seedDemoRestaurant(suite.db, {
        venue,
        locale,
        salesDays: 0,
        dataSet,
        departmentTradingNames: identity.departmentTradingNames,
      });
      expect(
        suite.db
          .all<{ name: string }>(sql`select name from departments`)
          .map((r) => r.name)
          .sort(),
      ).toEqual(
        Object.values(dataSet.floor.departmentNames)
          .map((name) => name[locale])
          .sort(),
      );
      expect(
        suite.db
          .all<{ name: string }>(sql`select name from kitchen_stations`)
          .map((r) => r.name)
          .sort(),
      ).toEqual(
        Object.values(dataSet.stations)
          .map((name) => name[locale])
          .sort(),
      );
      const menus = [dataSet.menus.restaurant, dataSet.menus.lunch, dataSet.menus.deli];
      expect(
        suite.db
          .all<{ name: string }>(sql`select name from categories`)
          .map((r) => r.name)
          .sort(),
      ).toEqual(
        menus
          .flatMap((menu) =>
            menu.categories.map((category) => (category.categoryName ?? category.name)[locale]),
          )
          .sort(),
      );
      const dish = menus
        .flatMap((menu) => menu.categories.flatMap((category) => category.products))
        .find((p) => p.image === image)!;
      expect(dish, image).toBeDefined();
      expect(
        suite.db.all(sql`select name from products
          where json_extract(customer_name, '$.en') = ${dish.customerName!.en}`),
      ).toEqual([{ name: staffNames[locale] }]);
      const names = suite.db.all<{ names: string }>(sql`
        select m.names from media_images m join products p on p.image = m.filename
        where p.name = ${dish.staffName![locale]}
      `);
      expect(names).toHaveLength(1);
      expect(JSON.parse(names[0]!.names)).toEqual(dish.customerName);
    });
