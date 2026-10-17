import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  catalogues,
  CORE_MIGRATIONS,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
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
import { setIncludeFolder } from "./include-folder.js";
import { createCatalogue, createProduct } from "./operations.js";
import { addMember } from "./sections.js";
import { setProductVariants } from "./variants.js";
import { createUnit } from "./units.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import { sections } from "./schema/sections.js";
import { menuDetails } from "./schema/menu.js";

// Every row below is written through its drizzle table: an `id` comes from the table's own
// `$defaultFn` rather than from a SQL default. The serialisation cases are in
// content-languages.concurrency.test.ts.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

describe("site content languages", () => {
  it("reports a variant's missing customer name without copying the product's staff name", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const catalogue = await createCatalogue(tx, { name: "Bar" });
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "each", fr: "unité" },
          precision: 0,
          abbreviation: { en: "u" },
        },
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
  it("reports only the Active variant while allowing an incomplete new default", async () => {
    await seedTenant(suite.db);
    const { productId, kept } = await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      const catalogue = await createCatalogue(tx, { name: "Bar" });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "Coffee",
        unitPrice: "9.00",
        pricingUnit: "each",
        vatClass: "reduced",
      });
      const variant = (name: string, customer: string, unitPrice: string) => ({
        name,
        customerName: { en: customer },
        kitchenName: null,
        image: null,
        unitPrice,
        available: true,
      });
      const [kept] = await setProductVariants(
        tx,
        product.id,
        [variant("Small", "Small cup", "2.00"), variant("Large", "Large cup", "3.00")],
        "en",
      );
      // Omitting Large makes it Inactive; its row and its English-only customer name stay.
      await setProductVariants(tx, product.id, [kept!], "en");
      return { productId: product.id, kept: kept! };
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] }),
      ),
    ).resolves.toBeUndefined();
    await withTransaction(suite.db, async (tx) => {
      expect(
        (await tx.select().from(products).where(eq(products.id, kept.id)))[0]!.customerName,
      ).toEqual({ en: "Small cup" });
      expect(await readContentLanguages(tx, "en")).toEqual({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      await setProductVariants(
        tx,
        productId,
        [{ ...kept, customerName: { en: "Small cup", fr: "Petit" } }],
        "en",
      );
      expect(await listContentTranslationGaps(tx, "fr")).toEqual([]);
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] });
      expect((await readContentLanguages(tx, "en")).defaultLanguage).toBe("fr");
    });
  });
  it("counts a partial customer name as a gap but a blank one as none", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Bar" });
      const unit = await createUnit(
        tx,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "each" },
          precision: 0,
          abbreviation: { en: "u" },
        },
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

  it("reports a menu section's partly filled customer names as a gap, and an empty map as none", async () => {
    await withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Lunch" });
      const section = async (
        names: Record<string, string>,
        role: "section" | "menu_root" = "section",
      ) =>
        (
          await tx
            .insert(sections)
            .values({
              internalName: "Drinks (internal)",
              names,
              role,
              ownerMenuId: menu.id,
            })
            .returning({ id: sections.id })
        )[0]!.id;
      const spanishOnly = await section({ es: "Bebidas" });
      const none = await section({});
      const both = await section({ en: "Drinks", es: "Bebidas" });
      const root = await section({ es: "Carta" }, "menu_root");

      const gaps = await listContentTranslationGaps(tx, "en");

      expect(gaps).toContainEqual({ kind: "menu_section", id: spanishOnly });
      expect(gaps).not.toContainEqual({ kind: "menu_section", id: none });
      expect(gaps).not.toContainEqual({ kind: "menu_section", id: both });
      expect(gaps).toContainEqual({ kind: "menu_section", id: root });
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
      await expect(
        writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
      ).resolves.toBeUndefined();
      expect(await readContentLanguages(tx, "es")).toEqual({
        defaultLanguage: "en",
        languages: ["en", "es"],
      });
      expect(await listContentTranslationGaps(tx, "en")).toContainEqual({
        kind: "menu_section",
        id: spanishOnly,
      });
      expect(
        (await tx.select().from(sections).where(eq(sections.id, spanishOnly)))[0]!.names,
      ).toEqual({ es: "Bebidas" });
    });
  });

  describe("an include's folder", () => {
    const rootOf = async (tx: Transaction, menuId: string) =>
      (
        await tx
          .select({ root: menuDetails.rootSectionId })
          .from(menuDetails)
          .where(eq(menuDetails.menuId, menuId))
      )[0]!.root;

    /** Lunch includes Drinks. The staff name "STAFF Drinks", Drinks' own customer names and the
     * folder's fixed ones are three different texts. */
    async function lunchIncludingDrinks(tx: Transaction, drinksNames: Record<string, string>) {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] });
      const lunch = await createCatalogue(tx, {
        name: "STAFF Lunch",
        names: { en: "CLIENT-EN Lunch", es: "CLIENT-ES Almuerzo" },
      });
      const drinks = await rootOf(tx, (await createCatalogue(tx, { name: "STAFF Drinks" })).id);
      await tx.update(sections).set({ names: drinksNames }).where(eq(sections.id, drinks));
      const lunchRoot = await rootOf(tx, lunch.id);
      const member = await addMember(tx, lunchRoot, { kind: "section", sectionId: drinks });
      return { lunchRoot, member: member.id };
    }

    it("keeps folder gaps visible after selecting an incomplete default", async () => {
      await withTransaction(suite.db, async (tx) => {
        const { lunchRoot, member } = await lunchIncludingDrinks(tx, {});
        await setIncludeFolder(tx, lunchRoot, member, {
          showAsFolder: true,
          overrides: { names: { en: "FOLDER-EN Bar" } },
        });

        expect(await listContentTranslationGaps(tx, "es")).toEqual([
          { kind: "menu_include", id: member },
        ]);
        expect(await listContentTranslationGaps(tx, "en")).toEqual([]);
        await expect(
          writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] }),
        ).resolves.toBeUndefined();
        expect(await readContentLanguages(tx, "en")).toEqual({
          defaultLanguage: "es",
          languages: ["es", "en"],
        });
        expect(await listContentTranslationGaps(tx, "es")).toEqual([
          { kind: "menu_include", id: member },
        ]);

        await setIncludeFolder(tx, lunchRoot, member, {
          showAsFolder: true,
          overrides: { names: { en: "FOLDER-EN Bar", es: "FOLDER-ES Barra" } },
        });
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
        expect((await readContentLanguages(tx, "en")).defaultLanguage).toBe("es");
      });
    });

    it("still counts the fixed names while the include shows its sections directly", async () => {
      await withTransaction(suite.db, async (tx) => {
        const { lunchRoot, member } = await lunchIncludingDrinks(tx, {});
        await setIncludeFolder(tx, lunchRoot, member, {
          showAsFolder: true,
          overrides: { names: { en: "FOLDER-EN Bar" } },
        });
        await setIncludeFolder(tx, lunchRoot, member, { showAsFolder: false });

        expect(await listContentTranslationGaps(tx, "es")).toEqual([
          { kind: "menu_include", id: member },
        ]);
      });
    });

    it("is no gap where it fixes nothing, however the included menu's own names stand", async () => {
      await withTransaction(suite.db, async (tx) => {
        const { member } = await lunchIncludingDrinks(tx, { en: "CLIENT-EN Drinks" });

        expect(await listContentTranslationGaps(tx, "es")).not.toContainEqual({
          kind: "menu_include",
          id: member,
        });
      });
    });

    it("takes the included menu's own name in a language it does not fix", async () => {
      await withTransaction(suite.db, async (tx) => {
        const { lunchRoot, member } = await lunchIncludingDrinks(tx, {
          es: "CLIENT-ES Bebidas",
        });
        await setIncludeFolder(tx, lunchRoot, member, {
          showAsFolder: true,
          overrides: { names: { en: "FOLDER-EN Bar" } },
        });

        expect(await listContentTranslationGaps(tx, "es")).toEqual([]);
      });
    });

    it("is no gap in any language when every name it shows is fixed blank, so the default can change", async () => {
      await withTransaction(suite.db, async (tx) => {
        const { lunchRoot, member } = await lunchIncludingDrinks(tx, {
          en: "CLIENT-EN Drinks",
          es: "CLIENT-ES Bebidas",
        });
        await setIncludeFolder(tx, lunchRoot, member, {
          showAsFolder: true,
          overrides: { names: { en: "", es: "" } },
        });

        expect(await listContentTranslationGaps(tx, "en")).toEqual([]);
        expect(await listContentTranslationGaps(tx, "es")).toEqual([]);
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
      });
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
  it("selects a first default despite a unit with no translations", async () => {
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(units).values({
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: {},
        abbreviation: {},
        precision: 0,
      });
      await writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr", "en"] });
      expect(await readContentLanguages(tx, "en")).toEqual({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      expect((await tx.select().from(units))[0]).toMatchObject({
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: {},
        abbreviation: {},
      });
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

  it("changes the default while keeping a product's missing translation missing", async () => {
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
    ).resolves.toBeUndefined();
    await withTransaction(suite.db, async (tx) => {
      expect((await readContentLanguages(tx, "es")).defaultLanguage).toBe("fr");
      expect((await tx.select().from(products))[0]!.customerName).toEqual({ en: "Bread" });
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
  it("changes the default while keeping a unit's missing translation missing", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      await tx.insert(units).values({
        staffName: "Staff unit",
        staffAbbreviation: "su",
        name: { en: "cup" },
        abbreviation: { en: "c" },
        precision: 0,
      });
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] }),
      ),
    ).resolves.toBeUndefined();
    await withTransaction(suite.db, async (tx) => {
      expect(await readContentLanguages(tx, "en")).toEqual({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      expect((await tx.select().from(units))[0]).toMatchObject({
        name: { en: "cup" },
        abbreviation: { en: "c" },
        staffName: "Staff unit",
        staffAbbreviation: "su",
      });
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

  describe("required languages", () => {
    const REQUIRED = ["ca", "es"];

    it("refuses a save that leaves out a required language and writes nothing", async () => {
      await withTransaction(suite.db, (tx) =>
        writeContentLanguages(
          tx,
          { defaultLanguage: "ca", languages: ["ca", "es", "en"] },
          REQUIRED,
        ),
      );
      await expect(
        withTransaction(suite.db, (tx) =>
          writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] }, REQUIRED),
        ),
      ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
      await withTransaction(suite.db, async (tx) =>
        expect(await readContentLanguages(tx, "es")).toEqual({
          defaultLanguage: "ca",
          languages: ["ca", "es", "en"],
        }),
      );
    });

    it("refuses a first save that never held the required language", async () => {
      await expect(
        withTransaction(suite.db, (tx) =>
          writeContentLanguages(
            tx,
            { defaultLanguage: "en", languages: ["en", "es-ES"] },
            REQUIRED,
          ),
        ),
      ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
    });

    it("accepts a required language sent with a region, and removing one that is not required", async () => {
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(
          tx,
          { defaultLanguage: "es", languages: ["es", "ca-ES", "fr"] },
          REQUIRED,
        );
        await writeContentLanguages(
          tx,
          { defaultLanguage: "es", languages: ["es", "ca"] },
          REQUIRED,
        );
        expect(await readContentLanguages(tx, "es")).toEqual({
          defaultLanguage: "es",
          languages: ["es", "ca"],
        });
      });
    });

    it("lets a venue with no required language remove any language but its default", async () => {
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "ca", "en"] });
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es"] }, []);
        expect(await readContentLanguages(tx, "es")).toEqual({
          defaultLanguage: "es",
          languages: ["es"],
        });
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
