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

const UNIT_NAMES = {
  each: { en: "each", es: "unidad", ca: "unitat", gl: "unidade", eu: "unitatea" },
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
        join tenants t on t.id = l.tenant_id
        where l.tenant_id = ${node.tenantId} and l.id = ${node.locationId}`);
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
        insert into content_languages (tenant_id, default_language, languages)
        values (${node.tenantId}, ${defaultLanguage}, ${languageArray})
        on conflict (tenant_id) do nothing`);
      const claimed = await tx.execute(sql`
        insert into unit_seed_states (tenant_id) values (${node.tenantId})
        on conflict (tenant_id) do nothing returning tenant_id`);
      if (claimed.rows.length > 0) {
        await tx.execute(sql`
          insert into units (tenant_id, seed_key, name, precision, hardware_unit) values
            (${node.tenantId}, 'each', ${JSON.stringify(UNIT_NAMES.each)}::jsonb, 0, null),
            (${node.tenantId}, 'g', ${JSON.stringify(UNIT_NAMES.g)}::jsonb, 0, 'g'),
            (${node.tenantId}, 'kg', ${JSON.stringify(UNIT_NAMES.kg)}::jsonb, 3, 'kg'),
            (${node.tenantId}, 'mg', ${JSON.stringify(UNIT_NAMES.mg)}::jsonb, 0, 'mg'),
            (${node.tenantId}, 'ml', ${JSON.stringify(UNIT_NAMES.ml)}::jsonb, 0, null),
            (${node.tenantId}, 'l', ${JSON.stringify(UNIT_NAMES.l)}::jsonb, 3, null)`);
      }
      let catalogueId = location.rows[0]?.catalogue_id ?? null;
      if (catalogueId === null) {
        const created = await tx.execute<{ id: string }>(sql`
          insert into catalogues (tenant_id, name)
          values (${node.tenantId}, 'Menu') returning id`);
        catalogueId = created.rows[0]!.id;
        await tx.execute(sql`
          update locations set catalogue_id = ${catalogueId}
          where tenant_id = ${node.tenantId} and id = ${node.locationId}`);
      }
      await tx.execute(sql`
        insert into location_catalogues (tenant_id, location_id, catalogue_id)
        values (${node.tenantId}, ${node.locationId}, ${catalogueId})
        on conflict (tenant_id, location_id, catalogue_id) do nothing`);
      return "initial menu ready";
    },
  },
};
