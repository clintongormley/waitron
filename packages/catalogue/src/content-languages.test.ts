import { describe, expect, it } from "vitest";
import { catalogues, CORE_MIGRATIONS, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  readContentLanguages,
  writeContentLanguages,
  validateContentTranslations,
  findContentTranslationGap,
  listContentTranslationGaps,
} from "./content-languages.js";
import { createCatalogue, createProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import { createUnit } from "./units.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";

// These tests exercise configuration queries, against one SQLite file with the real migrations
// applied. Every row below is written through its drizzle table: an `id` comes from the table's own
// `$defaultFn` rather than from a SQL default, and a `json()` column stores JSON TEXT, so a raw
// insert with a `::jsonb` cast has neither an id nor a cast that means anything here. The
// serialisation cases that used to live beside this file are in content-languages.concurrency.test.ts.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

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
      // A variant is a `products` row, reported once, as a variant, with the product it belongs to
      // — never a second time as a product in its own right.
      expect(await listContentTranslationGaps(tx, "fr")).toEqual([
        { kind: "variant", id: variant!.id, productId: product.id },
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
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Bar" });
      const unit = await createUnit(
        tx,
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
      const plain = await createProduct(tx, {
        ...base,
        name: "Water",
        unitPrice: "1.00",
      });
      // A customer name in en only → a gap for es.
      const partial = await createProduct(tx, {
        ...base,
        name: "Coffee",
        customerName: { en: "Fresh Coffee" },
        unitPrice: "2.00",
      });
      // A variant with no customer name → not a gap.
      const variants = await setProductVariants(
        tx,
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
      const esGaps = await listContentTranslationGaps(tx, "es");
      expect(esGaps).toContainEqual({ kind: "product", id: partial.id });
      expect(esGaps).not.toContainEqual({ kind: "product", id: plain.id });
      for (const v of variants) expect(esGaps).not.toContainEqual({ kind: "variant", id: v.id });
      // In en, even the partial customer name is complete → no product/variant gap.
      const enGaps = await listContentTranslationGaps(tx, "en");
      expect(enGaps).not.toContainEqual({ kind: "product", id: partial.id });
    });
  });

  it("reports which of several maps is the first with no text in the default language", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });

      expect(await findContentTranslationGap(tx, [{ en: "One" }, { en: "Two" }], "en")).toBeNull();
      expect(
        await findContentTranslationGap(tx, [{ en: "One" }, { fr: "Deux" }, { fr: "Trois" }], "en"),
      ).toEqual({ index: 1, language: "en" });
      expect(await findContentTranslationGap(tx, [], "en")).toBeNull();
      await expect(
        findContentTranslationGap(tx, [{ en: 7 as unknown as string }], "en"),
      ).rejects.toMatchObject({ code: "content.translation_invalid" });
    });
  });

  it("reports a missing option list or option label customer name as a gap", async () => {
    await withTransaction(suite.db, async (tx) => {
      const list = async (name: string, customerName?: Record<string, string>) =>
        (
          await tx
            .insert(optionLists)
            .values({ name, ...(customerName === undefined ? {} : { customerName }) })
            .returning({ id: optionLists.id })
        )[0]!.id;
      const label = async (listId: string, name: string, customerName: Record<string, string>) =>
        (
          await tx
            .insert(optionLabels)
            .values({ listId, name, customerName })
            .returning({ id: optionLabels.id })
        )[0]!.id;
      const named = await list("Cooked", { en: "How cooked?" });
      const plain = await list("Spice");
      const namedLabel = await label(named, "Rare", { en: "Rare" });
      const plainLabel = await label(plain, "Mild", {});

      const gaps = await listContentTranslationGaps(tx, "fr");

      expect(gaps).toContainEqual({ kind: "option_list", id: named });
      expect(gaps).toContainEqual({ kind: "option_label", id: namedLabel });
      // Both names are optional and fall back to the staff name, so a wholly-absent one is no gap.
      expect(gaps).not.toContainEqual({ kind: "option_list", id: plain });
      expect(gaps).not.toContainEqual({ kind: "option_label", id: plainLabel });
    });
  });

  it("reports a missing extras list customer name as a gap", async () => {
    await withTransaction(suite.db, async (tx) => {
      const list = async (name: string, customerName?: Record<string, string>) =>
        (
          await tx
            .insert(extraLists)
            .values({ name, ...(customerName === undefined ? {} : { customerName }) })
            .returning({ id: extraLists.id })
        )[0]!.id;
      const named = await list("Sides", { en: "Choose a side" });
      const plain = await list("Sauces");
      const blank = await list("Breads", {});

      const gaps = await listContentTranslationGaps(tx, "fr");

      expect(gaps).toContainEqual({ kind: "extra_list", id: named });
      // The customer name is optional and falls back to the staff `name`, so a wholly-absent one —
      // null or an empty map — is no gap, the same split the option kinds above make.
      expect(gaps).not.toContainEqual({ kind: "extra_list", id: plain });
      expect(gaps).not.toContainEqual({ kind: "extra_list", id: blank });
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
      const [menu] = await tx
        .insert(catalogues)
        .values({ name: "Lunch" })
        .returning({ id: catalogues.id });
      await tx.insert(products).values({
        catalogueId: menu!.id,
        name: "Bread",
        customerName: { en: "Bread", "fr-FR": "Pain" },
        pricingUnit: "each",
        unitPrice: 200,
        vatClass: "general",
      });
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
      const [menu] = await tx
        .insert(catalogues)
        .values({ name: "Lunch" })
        .returning({ id: catalogues.id });
      await tx.insert(products).values({
        catalogueId: menu!.id,
        name: "Bread",
        customerName: { en: "Bread" },
        pricingUnit: "each",
        unitPrice: 200,
        vatClass: "general",
      });
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
      await tx.update(products).set({ customerName: { en: "Bread", fr: "Pain" } });
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] });
      expect(await readContentLanguages(tx, "es")).toEqual({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr"] });
      const customerNames = await tx.select({ customerName: products.customerName }).from(products);
      expect(customerNames[0]!.customerName).toEqual({ en: "Bread", fr: "Pain" });
    });
  });
  it("refuses to change the default while a unit lacks its translation", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      await tx
        .insert(units)
        .values({ name: { en: "cup" }, abbreviation: { en: "c" }, precision: 0 });
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
