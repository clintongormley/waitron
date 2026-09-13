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

async function storedUnits(tenantId: string) {
  return (
    await suite.db.execute<{
      seed_key: string;
      name: Record<string, string>;
      precision: number;
      hardware_unit: string | null;
    }>(sql`
      select seed_key, name, precision, hardware_unit from units
      where tenant_id = ${tenantId} order by seed_key`)
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

  it("seeds the six units once and preserves edits and intentional deletion on another node", async () => {
    const node = await venue("ES", "Madrid", "es-ES");
    const run = (nodeId = node.nodeId) =>
      suite.db.transaction((tx) => CATALOGUE_PROVISIONING.seed!.run(tx, { ...node, nodeId }));
    await run();
    expect(await storedUnits(node.tenantId)).toEqual([
      {
        seed_key: "each",
        name: { en: "each", es: "unidad", ca: "unitat", gl: "unidade", eu: "unitatea" },
        precision: 0,
        hardware_unit: null,
      },
      {
        seed_key: "g",
        name: { en: "g", es: "g", ca: "g", gl: "g", eu: "g" },
        precision: 0,
        hardware_unit: "g",
      },
      {
        seed_key: "kg",
        name: { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" },
        precision: 3,
        hardware_unit: "kg",
      },
      {
        seed_key: "l",
        name: { en: "l", es: "l", ca: "l", gl: "l", eu: "l" },
        precision: 3,
        hardware_unit: null,
      },
      {
        seed_key: "mg",
        name: { en: "mg", es: "mg", ca: "mg", gl: "mg", eu: "mg" },
        precision: 0,
        hardware_unit: "mg",
      },
      {
        seed_key: "ml",
        name: { en: "ml", es: "ml", ca: "ml", gl: "ml", eu: "ml" },
        precision: 0,
        hardware_unit: null,
      },
    ]);
    await suite.db.execute(sql`
      update units set name = '{"en":"piece","es":"pieza"}'::jsonb
      where tenant_id = ${node.tenantId} and seed_key = 'each'`);
    await suite.db.execute(sql`
      delete from units where tenant_id = ${node.tenantId} and seed_key = 'mg'`);
    const otherNode = await seedNode(suite.db, node.tenantId, node.locationId);
    await run(otherNode);
    expect(
      (await storedUnits(node.tenantId)).find((unit) => unit.seed_key === "each")?.name,
    ).toEqual({
      en: "piece",
      es: "pieza",
    });
    expect((await storedUnits(node.tenantId)).map((unit) => unit.seed_key)).not.toContain("mg");
  });
});
