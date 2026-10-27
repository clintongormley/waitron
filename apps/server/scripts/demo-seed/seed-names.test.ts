import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";
import { DEMO_BASELINE_FIXTURE_ROOTS } from "@waitron/country-packs/demo/testing";
import { getCountryPack } from "@waitron/country-packs";
import { seedDemoRestaurant } from "./seed.js";
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
