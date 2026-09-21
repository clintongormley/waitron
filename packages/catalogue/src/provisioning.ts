import { sql } from "drizzle-orm";
import { catalogues, locationCatalogues } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { COUNTRY_PACKS, resolveInstalledCountryLocale } from "@waitron/country-packs";
import { contentLanguageCode, FALLBACK_LOCALE } from "@waitron/shared";
import { contentLanguages } from "./schema/menu.js";
import { unitSeedStates, units } from "./schema/units.js";

const geographicLocales = [
  ...new Set([
    FALLBACK_LOCALE,
    ...COUNTRY_PACKS.flatMap((pack) => [
      pack.defaultLocale,
      ...pack.administrativeAreas.flatMap((area) =>
        area.defaultLocale === undefined ? [] : [area.defaultLocale],
      ),
    ]),
  ]),
];

// Full display name shown in the dashboard; the short abbreviation is frozen onto sold lines.
const UNIT_NAMES = {
  g: { en: "Gram", es: "Gramo", ca: "Gram", gl: "Gramo", eu: "Gramo" },
  kg: { en: "Kilogram", es: "Kilogramo", ca: "Quilogram", gl: "Quilogramo", eu: "Kilogramo" },
  mg: { en: "Milligram", es: "Miligramo", ca: "Mil·ligram", gl: "Miligramo", eu: "Miligramo" },
  ml: { en: "Millilitre", es: "Mililitro", ca: "Mil·lilitre", gl: "Mililitro", eu: "Mililitro" },
  l: { en: "Litre", es: "Litro", ca: "Litre", gl: "Litro", eu: "Litro" },
} as const;
const UNIT_ABBR = {
  g: { en: "g", es: "g", ca: "g", gl: "g", eu: "g" },
  kg: { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" },
  mg: { en: "mg", es: "mg", ca: "mg", gl: "mg", eu: "mg" },
  ml: { en: "ml", es: "ml", ca: "ml", gl: "ml", eu: "ml" },
  l: { en: "l", es: "l", ca: "l", gl: "l", eu: "l" },
} as const;

export const CATALOGUE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu and content languages",
    async run(tx, node) {
      const location = await tx.execute<{
        catalogue_id: string | null;
        province: string | null;
        country: string;
      }>(sql`
        select l.catalogue_id, l.province, t.country from locations l
        cross join tenants t
        where l.id = ${node.locationId}`);
      const country = location.rows[0]?.country;
      // Hard-coded for Spain, and wrong for a Spanish venue outside Catalonia: the deli writes its
      // menu in Spanish, Catalan and English, and nothing in setup asks which languages a venue
      // wants. Driving the list from the venue's region and its own choices is the proper fix —
      // docs/backlog.md → A9, "Product languages are hard-coded at setup". Every other country
      // keeps taking its one language from geography, so the hard-code does not spread. All of it
      // is editable from the dashboard afterwards.
      const languages =
        country === "ES"
          ? ["es", "ca", "en"]
          : [
              contentLanguageCode(
                resolveInstalledCountryLocale(geographicLocales, {
                  country,
                  area: location.rows[0]?.province,
                  fallback: FALLBACK_LOCALE,
                }),
              ),
            ];
      // The default has to be one of the languages: `content_languages_default_ck`.
      const defaultLanguage = languages[0]!;
      // Every write below goes through its drizzle table rather than through raw SQL, because
      // the column defaults these rows rely on are no longer SQL defaults: `id`, `created_at` and
      // `updated_at` are supplied by `$defaultFn` in JavaScript
      // (`packages/db/src/schema/columns.ts`), so a raw `insert into catalogues (name)` writes a
      // null id and is refused `NOT NULL constraint failed: catalogues.id`. The same route also
      // hands `languages`, `name` and `abbreviation` to the column mappings that serialise them —
      // those columns store JSON TEXT here, so the `::jsonb` casts and the `array[…]` constructor
      // they replaced have no counterpart to translate into.
      await tx
        .insert(contentLanguages)
        .values({ defaultLanguage, languages })
        .onConflictDoNothing({ target: contentLanguages.id });
      // The id is stated rather than left out: this table's only column IS the key, and drizzle
      // renders a values object with no columns in it as `insert into … () values ()`, which
      // SQLite refuses. `1` is the value the column defaults to and the singleton check demands.
      const claimed = await tx
        .insert(unitSeedStates)
        .values({ id: 1 })
        .onConflictDoNothing({ target: unitSeedStates.id })
        .returning({ id: unitSeedStates.id });
      if (claimed.length > 0) {
        await tx.insert(units).values([
          {
            seedKey: "g",
            name: UNIT_NAMES.g,
            abbreviation: UNIT_ABBR.g,
            precision: 0,
            hardwareUnit: "g",
          },
          {
            seedKey: "kg",
            name: UNIT_NAMES.kg,
            abbreviation: UNIT_ABBR.kg,
            precision: 3,
            hardwareUnit: "kg",
          },
          {
            seedKey: "mg",
            name: UNIT_NAMES.mg,
            abbreviation: UNIT_ABBR.mg,
            precision: 0,
            hardwareUnit: "mg",
          },
          {
            seedKey: "ml",
            name: UNIT_NAMES.ml,
            abbreviation: UNIT_ABBR.ml,
            precision: 0,
            hardwareUnit: null,
          },
          {
            seedKey: "l",
            name: UNIT_NAMES.l,
            abbreviation: UNIT_ABBR.l,
            precision: 3,
            hardwareUnit: null,
          },
        ]);
      }
      let catalogueId = location.rows[0]?.catalogue_id ?? null;
      if (catalogueId === null) {
        const [created] = await tx
          .insert(catalogues)
          .values({ name: "Menu" })
          .returning({ id: catalogues.id });
        catalogueId = created!.id;
        await tx.execute(sql`
          update locations set catalogue_id = ${catalogueId}
          where id = ${node.locationId}`);
      }
      await tx
        .insert(locationCatalogues)
        .values({ locationId: node.locationId, catalogueId })
        .onConflictDoNothing();
      return "initial menu ready";
    },
  },
};
