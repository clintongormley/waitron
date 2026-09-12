import { describe, expect, it } from "vitest";
import { withTenant, CORE_MIGRATIONS } from "@waitron/db";
import { sql } from "drizzle-orm";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  readContentLanguages,
  writeContentLanguages,
  validateContentTranslations,
} from "./content-languages.js";

// These tests exercise configuration queries. Privileges and concurrent edits use real Postgres.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

describe("site content languages", () => {
  it.each(["", "invalid_locale", "und"])(
    "uses the shared fallback for an absent setting and invalid preference %j",
    async (fallbackLanguage) => {
      const tenantId = await seedTenant(suite.db);
      await withTenant(suite.db, tenantId, async (tx) => {
        expect(await readContentLanguages(tx, tenantId, fallbackLanguage)).toEqual({
          defaultLanguage: "en",
          languages: ["en"],
        });
        await writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["fr"] });
        expect(await readContentLanguages(tx, tenantId, fallbackLanguage)).toEqual({
          defaultLanguage: "fr",
          languages: ["fr"],
        });
      });
    },
  );

  it("recognizes regional translation keys consistently when changing the default", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, async (tx) => {
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en", "fr"] });
      const menu = await tx.execute<{ id: string }>(
        sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Lunch') returning id`,
      );
      await tx.execute(sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${tenantId}, ${menu.rows[0]!.id}, '{"en":"Bread","fr-FR":"Pain"}'::jsonb, 'each', '2.00', 'general')`);
      await expect(
        writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["fr", "en"] }),
      ).resolves.toBeUndefined();
    });
  });
  it("checks contributed content before changing the default", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en"] }),
    );
    await expect(
      withTenant(suite.db, tenantId, (tx) =>
        writeContentLanguages(
          tx,
          tenantId,
          { defaultLanguage: "fr", languages: ["fr", "en"] },
          "en",
          async () => [{ kind: "image", id: "photo" }],
        ),
      ),
    ).rejects.toMatchObject({
      code: "content.default_missing",
      params: { language: "fr", count: 1 },
    });
  });
  it("requires the configured default for content while allowing missing additional translations", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, async (tx) => {
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en", "fr"] });
      await expect(
        validateContentTranslations(tx, tenantId, { en: "Bread" }, "es-ES"),
      ).resolves.toBeUndefined();
    });
    await expect(
      withTenant(suite.db, tenantId, (tx) =>
        validateContentTranslations(tx, tenantId, { fr: "Pain", en: "  " }, "es-ES"),
      ),
    ).rejects.toMatchObject({ code: "content.translation_required", params: { language: "en" } });
  });

  it("refuses to change the default while a product lacks its translation", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, async (tx) => {
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en", "fr"] });
      const menu = await tx.execute<{ id: string }>(
        sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Lunch') returning id`,
      );
      await tx.execute(sql`insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${tenantId}, ${menu.rows[0]!.id}, '{"en":"Bread"}'::jsonb, 'each', '2.00', 'general')`);
    });
    await expect(
      withTenant(suite.db, tenantId, (tx) =>
        writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["en", "fr"] }),
      ),
    ).rejects.toMatchObject({
      code: "content.default_missing",
      params: { language: "fr", count: 1 },
    });
    await withTenant(suite.db, tenantId, async (tx) => {
      expect((await readContentLanguages(tx, tenantId, "es")).defaultLanguage).toBe("en");
      await tx.execute(
        sql`update products set descriptions = '{"en":"Bread","fr":"Pain"}'::jsonb where tenant_id = ${tenantId}`,
      );
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["en", "fr"] });
      expect(await readContentLanguages(tx, tenantId, "es")).toEqual({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      await writeContentLanguages(tx, tenantId, { defaultLanguage: "fr", languages: ["fr"] });
      const descriptions = await tx.execute<{ descriptions: Record<string, string> }>(
        sql`select descriptions from products where tenant_id = ${tenantId}`,
      );
      expect(descriptions.rows[0]!.descriptions).toEqual({ en: "Bread", fr: "Pain" });
    });
  });
  it("uses the site's supplied default before configuration and persists runtime additions", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, async (tx) => {
      expect(await readContentLanguages(tx, tenantId, "en-GB")).toEqual({
        defaultLanguage: "en",
        languages: ["en"],
      });
      await writeContentLanguages(tx, tenantId, {
        defaultLanguage: "en",
        languages: ["en", "fr", "ca", "ja"],
      });
      expect(await readContentLanguages(tx, tenantId, "es-ES")).toEqual({
        defaultLanguage: "en",
        languages: ["en", "fr", "ca", "ja"],
      });
    });
  });

  it("keeps each tenant's configuration separate", async () => {
    const a = await seedTenant(suite.db);
    const b = await seedTenant(suite.db);
    await withTenant(suite.db, a, (tx) =>
      writeContentLanguages(tx, a, {
        defaultLanguage: "it",
        languages: ["it", "fr"],
      }),
    );
    await withTenant(suite.db, b, async (tx) => {
      expect(await readContentLanguages(tx, b, "en-GB")).toEqual({
        defaultLanguage: "en",
        languages: ["en"],
      });
    });
  });

  it.each([
    { defaultLanguage: "en", languages: [] },
    { defaultLanguage: "en", languages: ["fr"] },
    { defaultLanguage: "en", languages: ["en", "en-GB"] },
    { defaultLanguage: "zz", languages: ["zz"] },
  ])("refuses an invalid configuration %j", async (config) => {
    const tenantId = await seedTenant(suite.db);
    await expect(
      withTenant(suite.db, tenantId, (tx) => writeContentLanguages(tx, tenantId, config)),
    ).rejects.toThrow();
  });
});
