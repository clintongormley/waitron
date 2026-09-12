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

export const CATALOGUE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu and content language",
    async run(tx, node) {
      const location = await tx.execute<{
        catalogue_id: string | null;
        province: string | null;
        country: string;
      }>(sql`
        select l.catalogue_id, l.province, t.country from locations l
        join tenants t on t.id = l.tenant_id
        where l.tenant_id = ${node.tenantId} and l.id = ${node.locationId}`);
      const defaultLanguage = contentLanguageCode(
        resolveInstalledCountryLocale(geographicLocales, {
          country: location.rows[0]?.country,
          area: location.rows[0]?.province,
          fallback: FALLBACK_LOCALE,
        }),
      );
      await tx.execute(sql`
        insert into content_languages (tenant_id, default_language, languages)
        values (${node.tenantId}, ${defaultLanguage}, array[${defaultLanguage}])
        on conflict (tenant_id) do nothing`);
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
