import { sql } from "drizzle-orm";
import type { ModuleProvisioning } from "@waitron/module";
import { COUNTRY_PACKS, resolveInstalledCountryLocale } from "@waitron/country-packs";
import { contentLanguageCode, FALLBACK_LOCALE } from "@waitron/shared";

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
      // Each element is its own bound parameter. A JavaScript array interpolated as one value is
      // expanded by Drizzle into a value list — `($3, $4, $5)` — which Postgres rejects instead of
      // reading as an array. The `::text[]` cast is not needed for this insert, whose target column
      // supplies the type — the suite is green without it — and is kept only so this reads the same
      // as its sibling in `packages/provisioning/src/venue-apply.ts`.
      const languageArray = sql`array[${sql.join(
        languages.map((language) => sql`${language}`),
        sql`, `,
      )}]::text[]`;
      await tx.execute(sql`
        insert into content_languages (default_language, languages)
        values (${defaultLanguage}, ${languageArray})
        on conflict (id) do nothing`);
      const claimed = await tx.execute(sql`
        insert into unit_seed_states default values
        on conflict (id) do nothing returning id`);
      if (claimed.rows.length > 0) {
        await tx.execute(sql`
          insert into units (seed_key, name, abbreviation, precision, hardware_unit) values
            ('g', ${JSON.stringify(UNIT_NAMES.g)}::jsonb, ${JSON.stringify(UNIT_ABBR.g)}::jsonb, 0, 'g'),
            ('kg', ${JSON.stringify(UNIT_NAMES.kg)}::jsonb, ${JSON.stringify(UNIT_ABBR.kg)}::jsonb, 3, 'kg'),
            ('mg', ${JSON.stringify(UNIT_NAMES.mg)}::jsonb, ${JSON.stringify(UNIT_ABBR.mg)}::jsonb, 0, 'mg'),
            ('ml', ${JSON.stringify(UNIT_NAMES.ml)}::jsonb, ${JSON.stringify(UNIT_ABBR.ml)}::jsonb, 0, null),
            ('l', ${JSON.stringify(UNIT_NAMES.l)}::jsonb, ${JSON.stringify(UNIT_ABBR.l)}::jsonb, 3, null)`);
      }
      let catalogueId = location.rows[0]?.catalogue_id ?? null;
      if (catalogueId === null) {
        const created = await tx.execute<{ id: string }>(sql`
          insert into catalogues (name) values ('Menu') returning id`);
        catalogueId = created.rows[0]!.id;
        await tx.execute(sql`
          update locations set catalogue_id = ${catalogueId}
          where id = ${node.locationId}`);
      }
      await tx.execute(sql`
        insert into location_catalogues (location_id, catalogue_id) values (${node.locationId}, ${catalogueId})
        on conflict (location_id, catalogue_id) do nothing`);
      return "initial menu ready";
    },
  },
};
