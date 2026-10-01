import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { ContentLanguages } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { listContentTranslationGaps, writeContentLanguages } from "./content-languages.js";
import { listTranslationGapReport } from "./content-translation-report.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
} from "./operations.js";
import { setProductVariants } from "./variants.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { sections } from "./schema/sections.js";
import { menuDetails } from "./schema/menu.js";
import { units } from "./schema/units.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

// A Barcelona venue whose default is Spanish: Catalan is the region's other required language and
// English is an extra one.
const SPANISH_DEFAULT: ContentLanguages = { defaultLanguage: "es", languages: ["es", "ca", "en"] };
const CATALAN_DEFAULT: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "es", "en"] };

async function venue(tx: Transaction, config: ContentLanguages = SPANISH_DEFAULT) {
  await writeContentLanguages(tx, config);
  // A menu's customer names are its root's; complete here, so only what a case adds is missing.
  return createCatalogue(tx, {
    name: "Lunch",
    names: { es: "CLIENT-ES Almuerzo", ca: "CLIENT-CA Dinar", en: "CLIENT-EN Lunch" },
  });
}

/** The three names differ, so a report reading the customer-facing or kitchen name where the staff
 * name belongs fails. */
async function bread(
  tx: Transaction,
  catalogueId: string,
  customerName: Record<string, string> | null = { es: "CLIENT-ES Pan con tomate" },
) {
  return createProduct(tx, {
    catalogueId,
    categoryId: null,
    name: "STAFF Pan",
    customerName,
    kitchenName: "KITCHEN Pan",
    unitPrice: "3.00",
    pricingUnit: "each",
    vatClass: "reduced",
  });
}

async function report(tx: Transaction, config: ContentLanguages = SPANISH_DEFAULT) {
  const languages = await listTranslationGapReport(tx, config);
  return (language: string) => languages.find((entry) => entry.language === language)!.gaps;
}

describe("the missing-translations report", () => {
  it("lists a product with a Spanish customer name under Catalan and English, by its staff name, and not under Spanish", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await venue(tx);
      const product = await bread(tx, menu.id);
      const gaps = await report(tx);
      const listed = { kind: "product", id: product.id, name: "STAFF Pan", reason: "partial" };
      expect(gaps("ca")).toEqual([listed]);
      expect(gaps("en")).toEqual([listed]);
      expect(gaps("es")).toEqual([]);
    });
  });

  it("drops the product from Catalan alone once a Catalan name is saved", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await venue(tx);
      const product = await bread(tx, menu.id);
      await tx
        .update(products)
        .set({ customerName: { es: "CLIENT-ES Pan con tomate", ca: "CLIENT-CA Pa amb tomàquet" } })
        .where(eq(products.id, product.id));
      const gaps = await report(tx);
      expect(gaps("ca")).toEqual([]);
      expect(gaps("en").map((gap) => gap.id)).toEqual([product.id]);
    });
  });

  it("lists something with no customer-facing name under every language but the default", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await venue(tx);
      const product = await bread(tx, menu.id, null);
      const listed = { kind: "product", id: product.id, name: "STAFF Pan", reason: "absent" };
      const spanish = await report(tx);
      expect(spanish("ca")).toEqual([listed]);
      expect(spanish("en")).toEqual([listed]);
      expect(spanish("es")).toEqual([]);
      const catalan = await report(tx, CATALAN_DEFAULT);
      expect(catalan("es")).toEqual([listed]);
      expect(catalan("en")).toEqual([listed]);
      expect(catalan("ca")).toEqual([]);
    });
  });

  it("lists a customer name with no text in the default language under the default", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await venue(tx);
      // No save path writes this, so it is written directly, as a receipt would then print nothing.
      const product = await bread(tx, menu.id, { ca: "CLIENT-CA Pa amb tomàquet" });
      const gaps = await report(tx);
      expect(gaps("es")).toEqual([
        { kind: "product", id: product.id, name: "STAFF Pan", reason: "partial" },
      ]);
      expect(gaps("ca")).toEqual([]);
    });
  });

  it("lists each kind with what holds it, and leaves out a removed variant and an extras list with no customer-facing name", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await venue(tx);
      const parent = await bread(tx, menu.id, null);
      const variant = (name: string) => ({
        name,
        customerName: { es: `CLIENT-ES ${name}` },
        kitchenName: `KITCHEN ${name}`,
        image: null,
        unitPrice: "2.00",
        available: true,
      });
      const [small, large] = await setProductVariants(
        tx,
        parent.id,
        [variant("STAFF Small"), variant("STAFF Large")],
        "es",
      );
      await setProductVariants(tx, parent.id, [small!], "es");
      const [list] = await tx
        .insert(optionLists)
        .values({
          name: "STAFF Doneness",
          customerName: { es: "CLIENT-ES Punto" },
          kitchenName: "K",
        })
        .returning({ id: optionLists.id });
      const [label] = await tx
        .insert(optionLabels)
        .values({ listId: list!.id, name: "STAFF Rare", customerName: { es: "CLIENT-ES Poco" } })
        .returning({ id: optionLabels.id });
      const [extras] = await tx
        .insert(extraLists)
        .values({ name: "STAFF Sides", customerName: { es: "CLIENT-ES Guarnición" } })
        .returning({ id: extraLists.id });
      await tx.insert(extraLists).values({ name: "STAFF Sauces" });
      const [section] = await tx
        .insert(sections)
        .values({
          internalName: "STAFF Drinks",
          names: { es: "CLIENT-ES Bebidas" },
          ownerMenuId: menu.id,
        })
        .returning({ id: sections.id });
      const [details] = await tx
        .select({ root: menuDetails.rootSectionId })
        .from(menuDetails)
        .where(eq(menuDetails.menuId, menu.id));
      await tx
        .update(sections)
        .set({ names: { es: "CLIENT-ES Carta" } })
        .where(eq(sections.id, details!.root));
      const [unit] = await tx
        .insert(units)
        .values({ name: { ca: "racció", es: "ración" }, abbreviation: { es: "rac" }, precision: 0 })
        .returning({ id: units.id });

      const english = (await report(tx))("en");
      const menuParent = { id: menu.id, name: "Lunch" };
      expect(english).toEqual([
        { kind: "product", id: parent.id, name: "STAFF Pan", reason: "absent" },
        {
          kind: "variant",
          id: small!.id,
          name: "STAFF Small",
          reason: "partial",
          parent: { id: parent.id, name: "STAFF Pan" },
        },
        { kind: "option_list", id: list!.id, name: "STAFF Doneness", reason: "partial" },
        {
          kind: "option_label",
          id: label!.id,
          name: "STAFF Rare",
          reason: "partial",
          parent: { id: list!.id, name: "STAFF Doneness" },
        },
        { kind: "extra_list", id: extras!.id, name: "STAFF Sides", reason: "partial" },
        { kind: "menu", id: details!.root, name: "Lunch", reason: "partial", parent: menuParent },
        {
          kind: "section",
          id: section!.id,
          name: "STAFF Drinks",
          reason: "partial",
          parent: menuParent,
        },
        { kind: "unit", id: unit!.id, name: "ración", reason: "partial" },
      ]);
      expect(english.map((gap) => gap.id)).not.toContain(large!.id);
    });
  });

  it("names a unit with no text in the default language by the text it has", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, SPANISH_DEFAULT);
      const [unit] = await tx
        .insert(units)
        .values({ name: { ca: "racció" }, abbreviation: { ca: "rac" }, precision: 0 })
        .returning({ id: units.id });
      expect((await report(tx))("es")).toEqual([
        { kind: "unit", id: unit!.id, name: "racció", reason: "partial" },
      ]);
    });
  });

  it("answers every enabled language in the configuration's order, a complete one with no gaps", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await venue(tx);
      expect(await listTranslationGapReport(tx, SPANISH_DEFAULT)).toEqual([
        { language: "es", gaps: [] },
        { language: "ca", gaps: [] },
        { language: "en", gaps: [] },
      ]);
    });
  });

  it("leaves the default-change check's own list as it was: no customer-facing name is still no gap there", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await venue(tx);
      const product = await bread(tx, menu.id, null);
      expect((await report(tx))("ca").map((gap) => gap.id)).toEqual([product.id]);
      expect(await listContentTranslationGaps(tx, "ca")).toEqual([]);
    });
  });

  describe("leaves out what nobody can order", () => {
    it("a deleted product, which the default-change check still counts", async () => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const menu = await venue(tx);
        const product = await bread(tx, menu.id);
        expect((await report(tx))("ca")).toHaveLength(1);
        await deactivateProduct(tx, product.id);
        expect((await report(tx))("ca")).toEqual([]);
        expect(await listContentTranslationGaps(tx, "ca")).toEqual([
          { kind: "product", id: product.id },
        ]);
      });
    });

    it("the variants of a deleted product", async () => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const menu = await venue(tx);
        const product = await bread(tx, menu.id);
        await setProductVariants(
          tx,
          product.id,
          [
            {
              name: "STAFF Small",
              customerName: { es: "CLIENT-ES Pequeño" },
              kitchenName: "KITCHEN Small",
              image: null,
              unitPrice: "2.00",
              available: true,
            },
          ],
          "es",
        );
        expect((await report(tx))("ca")).toHaveLength(2);
        await deactivateProduct(tx, product.id);
        expect((await report(tx))("ca")).toEqual([]);
      });
    });

    it("a switched-off options list and its options", async () => {
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(tx, SPANISH_DEFAULT);
        const [list] = await tx
          .insert(optionLists)
          .values({
            name: "STAFF Doneness",
            customerName: { es: "CLIENT-ES Punto" },
            active: false,
          })
          .returning({ id: optionLists.id });
        await tx
          .insert(optionLabels)
          .values({ listId: list!.id, name: "STAFF Rare", customerName: { es: "CLIENT-ES Poco" } });
        await tx.insert(optionLabels).values({ listId: list!.id, name: "STAFF Well done" });
        expect((await report(tx))("ca")).toEqual([]);
        await tx.update(optionLists).set({ active: true }).where(eq(optionLists.id, list!.id));
        expect((await report(tx))("ca")).toHaveLength(3);
      });
    });

    it("a switched-off extras list", async () => {
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(tx, SPANISH_DEFAULT);
        await tx.insert(extraLists).values({
          name: "STAFF Sides",
          customerName: { es: "CLIENT-ES Guarnición" },
          active: false,
        });
        expect((await report(tx))("ca")).toEqual([]);
        await tx.update(extraLists).set({ active: true });
        expect((await report(tx))("ca")).toHaveLength(1);
      });
    });

    it("the sections and customer names of a switched-off menu", async () => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const menu = await venue(tx);
        await tx.insert(sections).values({
          internalName: "STAFF Drinks",
          names: { es: "CLIENT-ES Bebidas" },
          ownerMenuId: menu.id,
        });
        await tx.insert(sections).values({ internalName: "STAFF Desserts", ownerMenuId: menu.id });
        const [details] = await tx
          .select({ root: menuDetails.rootSectionId })
          .from(menuDetails)
          .where(eq(menuDetails.menuId, menu.id));
        await tx.update(sections).set({ names: {} }).where(eq(sections.id, details!.root));
        expect((await report(tx))("ca")).toHaveLength(3);
        await deactivateCatalogue(tx, menu.id);
        expect((await report(tx))("ca")).toEqual([]);
      });
    });
  });
});
