import { describe, expect, it } from "vitest";
import { withTransaction, CORE_MIGRATIONS } from "@waitron/db";
import { sql } from "drizzle-orm";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  readContentLanguages,
  writeContentLanguages,
  validateContentTranslations,
  listContentTranslationGaps,
} from "./content-languages.js";
import { createCatalogue, createProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import { createUnit } from "./units.js";

// These tests exercise configuration queries. Privileges and concurrent edits use real Postgres.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

describe("site content languages", () => {
  it("requires a variant's customer name in a new default language but leaves the product's optional", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Bar" });
      const unit = await createUnit(
        tx,
        { name: { en: "each", fr: "unité" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      // The product has only a staff name (no customer name), so it never gaps; the variant carries a
      // partial customer name and is the sole gap until it is completed.
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "Coffee",
        description: { en: "Freshly roasted" },
        unitPrice: "9.00",
        unitId: unit.id,
        vatClass: "reduced",
      });
      const [variant] = await setProductVariants(
        tx,
        product.id,
        [
          {
            name: "Small",
            customerName: { en: "Small cup" },
            kitchenName: null,
            image: null,
            unitPrice: "2.00",
            available: true,
          },
        ],
        "en",
      );
      expect(await listContentTranslationGaps(tx, "fr")).toEqual([
        { kind: "variant", id: variant!.id },
      ]);
      await setProductVariants(
        tx,
        product.id,
        [{ ...variant!, customerName: { en: "Small cup", fr: "Petit" } }],
        "en",
      );
      expect(await listContentTranslationGaps(tx, "fr")).toEqual([]);
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr", "en"] });
      expect((await readContentLanguages(tx, "en")).defaultLanguage).toBe("fr");
    });
  });
  it("counts a partial customer name as a gap but a blank one as none", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, async (tx) => {
      const catalogue = await createCatalogue(tx, tenantId, { name: "Bar" });
      const unit = await createUnit(
        tx,
        tenantId,
        { name: { en: "each" }, precision: 0, abbreviation: { en: "u" } },
        "en",
      );
      const base = {
        catalogueId: catalogue.id,
        categoryId: null,
        unitId: unit.id,
        vatClass: "reduced" as const,
      };
      // No customer name → never a gap in any language.
      const plain = await createProduct(tx, tenantId, {
        ...base,
        name: "Water",
        unitPrice: "1.00",
      });
      // A customer name in en only → a gap for es.
      const partial = await createProduct(tx, tenantId, {
        ...base,
        name: "Coffee",
        customerName: { en: "Fresh Coffee" },
        unitPrice: "2.00",
      });
      // A variant with no customer name → not a gap.
      const variants = await setProductVariants(
        tx,
        tenantId,
        partial.id,
        [
          {
            name: "Small",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "2.00",
            available: true,
          },
          {
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "3.00",
            available: true,
          },
        ],
        "en",
      );
      const esGaps = await listContentTranslationGaps(tx, tenantId, "es");
      expect(esGaps).toContainEqual({ kind: "product", id: partial.id });
      expect(esGaps).not.toContainEqual({ kind: "product", id: plain.id });
      for (const v of variants) expect(esGaps).not.toContainEqual({ kind: "variant", id: v.id });
      // In en, even the partial customer name is complete → no product/variant gap.
      const enGaps = await listContentTranslationGaps(tx, tenantId, "en");
      expect(enGaps).not.toContainEqual({ kind: "product", id: partial.id });
    });
  });

  it.each(["", "invalid_locale", "und"])(
    "uses the shared fallback for an absent setting and invalid preference %j",
    async (fallbackLanguage) => {
      await withTransaction(suite.db, async (tx) => {
        expect(await readContentLanguages(tx, fallbackLanguage)).toEqual({
          defaultLanguage: "en",
          languages: ["en"],
        });
        await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr"] });
        expect(await readContentLanguages(tx, fallbackLanguage)).toEqual({
          defaultLanguage: "fr",
          languages: ["fr"],
        });
      });
    },
  );

  it("recognizes regional translation keys consistently when changing the default", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const menu = await tx.execute<{ id: string }>(
        sql`insert into catalogues (name) values ('Lunch') returning id`,
      );
      await tx.execute(
        sql`insert into products (catalogue_id, name, customer_name, pricing_unit, unit_price, vat_class) values (${menu.rows[0]!.id}, 'Bread', '{"en":"Bread","fr-FR":"Pain"}'::jsonb, 'each', '2.00', 'general')`,
      );
      await expect(
        writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr", "en"] }),
      ).resolves.toBeUndefined();
    });
  });
  it("checks contributed content before changing the default", async () => {
    await withTransaction(suite.db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(
          tx,
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
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      await expect(
        validateContentTranslations(tx, { en: "Bread" }, "es-ES"),
      ).resolves.toBeUndefined();
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        validateContentTranslations(tx, { fr: "Pain", en: "  " }, "es-ES"),
      ),
    ).rejects.toMatchObject({ code: "content.translation_required", params: { language: "en" } });
  });

  it("refuses to change the default while a product lacks its translation", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const menu = await tx.execute<{ id: string }>(
        sql`insert into catalogues (name) values ('Lunch') returning id`,
      );
      await tx.execute(
        sql`insert into products (catalogue_id, name, customer_name, pricing_unit, unit_price, vat_class) values (${menu.rows[0]!.id}, 'Bread', '{"en":"Bread"}'::jsonb, 'each', '2.00', 'general')`,
      );
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] }),
      ),
    ).rejects.toMatchObject({
      code: "content.default_missing",
      params: { language: "fr", count: 1 },
    });
    await withTransaction(suite.db, async (tx) => {
      expect((await readContentLanguages(tx, "es")).defaultLanguage).toBe("en");
      await tx.execute(sql`update products set customer_name = '{"en":"Bread","fr":"Pain"}'::jsonb`);
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] });
      expect(await readContentLanguages(tx, "es")).toEqual({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr"] });
      const customerNames = await tx.execute<{ customer_name: Record<string, string> }>(
        sql`select customer_name from products`,
      );
      expect(customerNames.rows[0]!.customer_name).toEqual({ en: "Bread", fr: "Pain" });
    });
  });
  it("refuses to change the default while a unit lacks its translation", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      await tx.execute(sql`
        insert into units (name, abbreviation, precision)
        values ('{"en":"cup"}'::jsonb, '{"en":"c"}'::jsonb, 0)`);
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] }),
      ),
    ).rejects.toMatchObject({
      code: "content.default_missing",
      params: { language: "fr", count: 1 },
    });
  });
  it("uses the site's supplied default before configuration and persists runtime additions", async () => {
    await withTransaction(suite.db, async (tx) => {
      expect(await readContentLanguages(tx, "en-GB")).toEqual({
        defaultLanguage: "en",
        languages: ["en"],
      });
      await writeContentLanguages(tx, {
        defaultLanguage: "en",
        languages: ["en", "fr", "ca", "ja"],
      });
      expect(await readContentLanguages(tx, "es-ES")).toEqual({
        defaultLanguage: "en",
        languages: ["en", "fr", "ca", "ja"],
      });
    });
  });

  it.each([
    { defaultLanguage: "en", languages: [] },
    { defaultLanguage: "en", languages: ["fr"] },
    { defaultLanguage: "en", languages: ["en", "en-GB"] },
    { defaultLanguage: "zz", languages: ["zz"] },
  ])("refuses an invalid configuration %j", async (config) => {
    await expect(
      withTransaction(suite.db, (tx) => writeContentLanguages(tx, config)),
    ).rejects.toThrow();
  });
});
