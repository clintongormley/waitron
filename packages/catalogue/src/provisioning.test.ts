import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_PROVISIONING } from "./provisioning.js";

// This suite checks seeded values and idempotence; it makes no privilege or contention claim.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

async function venue(country: string, province: string, receipt: string) {
  const tenantId = await seedTenant(suite.db);
  await suite.db.execute(sql`update tenants set country = ${country} where id = ${tenantId}`);
  const location = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, province, invoice_locales, operation_description)
    values (${tenantId}, 'Venue', ${province}, array[${receipt}], 'Hospitality') returning id`);
  const locationId = brandLocationId(location.rows[0]!.id);
  const nodeId = await seedNode(suite.db, tenantId, locationId);
  return { tenantId, locationId, nodeId };
}

async function storedLanguages(tenantId: string) {
  return (
    await suite.db.execute<{ default_language: string; languages: string[] }>(sql`
    select default_language, languages from content_languages where tenant_id = ${tenantId}`)
  ).rows;
}

describe("catalogue provisioning", () => {
  it.each([
    ["ES", "Madrid", "en-GB", "es"],
    ["ES", "Barcelona", "es-ES", "ca"],
    ["ES", "A Coruña", "en-GB", "gl"],
    ["ES", "Bizkaia", "en-GB", "eu"],
    ["GB", "London", "es-ES", "en"],
    ["XX", "Unknown", "es-ES", "en"],
  ])(
    "seeds %s/%s content independently of the %s receipt locale",
    async (country, province, receipt, language) => {
      const node = await venue(country, province, receipt);
      await suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
      expect(await storedLanguages(node.tenantId)).toEqual([
        { default_language: language, languages: [language] },
      ]);
      const location = await suite.db.execute<{ invoice_locales: string[] }>(sql`
      select invoice_locales from locations where tenant_id = ${node.tenantId} and id = ${node.locationId}`);
      expect(location.rows).toEqual([{ invoice_locales: [receipt] }]);
    },
  );

  it("preserves authored languages and reuses the initial menu on another seed", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = () => suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, node));
    await expect(run()).resolves.toBe("initial menu ready");
    await suite.db
      .execute(sql`update content_languages set default_language = 'fr', languages = array['fr','de']
      where tenant_id = ${node.tenantId}`);
    await run();
    expect(await storedLanguages(node.tenantId)).toEqual([
      { default_language: "fr", languages: ["fr", "de"] },
    ]);
    const menus = await suite.db.execute<{ count: number }>(sql`
      select count(*)::int as count from location_catalogues where tenant_id = ${node.tenantId}`);
    expect(menus.rows).toEqual([{ count: 1 }]);
  });
});
