import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { readProductEditor, saveProductEditor } from "./product-editor.js";
import { setProductVariants } from "./variants.js";
import { createOptionList, getOptionList, updateOptionList } from "./options.js";
import { createExtraList, getExtraList, updateExtraList } from "./extras.js";
import { createUnit, updateUnit } from "./units.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists, extraListItems, productModifiers } from "./schema/extras.js";
import { menuDetails } from "./schema/menu.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { addMember } from "./sections.js";
import { units } from "./schema/units.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import {
  writeMenuTranslation,
  writeSectionTranslation,
  writeIncludedMenuTranslation,
  writeProductTranslation,
  writeVariantTranslation,
  writeOptionListTranslation,
  writeOptionLabelTranslation,
  writeExtraListTranslation,
  writeUnitTranslation,
} from "./content-translation-writes.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "en", required: ["es", "ca"] };
const writers = {
  product: writeProductTranslation,
  variant: writeVariantTranslation,
  option_list: writeOptionListTranslation,
  option_label: writeOptionLabelTranslation,
  extra_list: writeExtraListTranslation,
  unit: writeUnitTranslation,
};
type Kind = keyof typeof writers;
const kinds = Object.keys(writers) as Kind[];
const codes = {
  product: "content.translation_required",
  variant: "content.translation_required",
  option_list: "options.translation_required",
  option_label: "options.translation_required",
  extra_list: "extras.translation_required",
  unit: "unit.translation_required",
};

async function fixture(tx: Transaction) {
  await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "ca", "en"] });
  const menu = await createCatalogue(tx, { name: "Lunch" });
  const product = await createProduct(tx, {
    catalogueId: menu.id,
    categoryId: null,
    unitId: null,
    name: "STAFF Bread",
    customerName: { es: "CLIENT Pan", ca: "CLIENT Pa" },
    kitchenName: "KITCHEN Bread",
    unitPrice: "3.00",
    vatClass: "reduced",
    description: { es: "Crujiente" },
  });
  const variants = await setProductVariants(
    tx,
    product.id,
    [
      {
        name: "STAFF Small",
        customerName: { es: "CLIENT Pequeño", ca: "CLIENT Petit" },
        kitchenName: "KITCHEN Small",
        image: null,
        unitPrice: "2.00",
        available: false,
      },
      {
        name: "STAFF Large",
        customerName: { es: "CLIENT Grande" },
        kitchenName: "KITCHEN Large",
        image: null,
        unitPrice: "4.00",
        available: true,
      },
    ],
    "es",
  );
  const options = await createOptionList(
    tx,
    {
      name: "STAFF Cooked",
      customerName: { es: "CLIENT Punto", ca: "CLIENT Punt" },
      kitchenName: "KITCHEN Cooked",
      defaultLabelId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      labels: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "STAFF Rare",
          customerName: { es: "CLIENT Poco", ca: "CLIENT Poc" },
          kitchenName: "KITCHEN Rare",
          available: false,
        },
        { name: "STAFF Well", customerName: { es: "CLIENT Hecho" }, kitchenName: "KITCHEN Well" },
      ],
    },
    "es",
  );
  const extraProduct = await createProduct(tx, {
    catalogueId: menu.id,
    categoryId: null,
    unitId: null,
    name: "STAFF Butter",
    unitPrice: "1.50",
    vatClass: "reduced",
  });
  const extras = await createExtraList(
    tx,
    {
      name: "STAFF Sides",
      customerName: { es: "CLIENT Guarnición", ca: "CLIENT Guarnició" },
      kitchenName: "KITCHEN Sides",
      minPicks: 1,
      maxPicks: 2,
      items: [{ productId: extraProduct.id, price: "0.75", maxQuantity: 2, preselected: true }],
    },
    "es",
  );
  await tx.insert(productModifiers).values([
    { productId: product.id, optionListId: options.id, sort: 1 },
    { productId: product.id, extraListId: extras.id, sort: 2 },
  ]);
  const unit = await createUnit(
    tx,
    {
      name: { es: "CLIENT Kilogramo", ca: "CLIENT Quilogram" },
      abbreviation: { es: "kg", ca: "kg" },
      precision: 3,
    },
    "es",
  );
  await tx
    .update(units)
    .set({ seedKey: "kilogram", hardwareUnit: "kg" })
    .where(eq(units.id, unit.id));
  return {
    product: product.id,
    variant: variants[0]!.id,
    option_list: options.id,
    option_label: options.labels[0]!.id,
    extra_list: extras.id,
    unit: unit.id,
    menuId: menu.id,
  };
}

async function snapshot(tx: Transaction) {
  return {
    products: await tx.select().from(products).orderBy(products.id),
    options: await tx.select().from(optionLists).orderBy(optionLists.id),
    labels: await tx.select().from(optionLabels).orderBy(optionLabels.id),
    extras: await tx.select().from(extraLists).orderBy(extraLists.id),
    items: await tx.select().from(extraListItems).orderBy(extraListItems.id),
    modifiers: await tx.select().from(productModifiers).orderBy(productModifiers.id),
    units: await tx.select().from(units).orderBy(units.id),
  };
}

async function existingWrite(
  tx: Transaction,
  kind: Kind,
  ids: Awaited<ReturnType<typeof fixture>>,
  names: Record<string, string>,
) {
  if (kind === "product" || kind === "variant") {
    const value = await readProductEditor(tx, ids[kind]);
    return saveProductEditor(tx, ids[kind], ids.menuId, { ...value, customerName: names }, "en");
  }
  if (kind === "option_list" || kind === "option_label") {
    const { id, ...value } = await getOptionList(tx, ids.option_list);
    return updateOptionList(
      tx,
      id,
      kind === "option_list"
        ? { ...value, customerName: names }
        : {
            ...value,
            labels: value.labels.map((label) =>
              label.id === ids.option_label ? { ...label, customerName: names } : label,
            ),
          },
      "en",
    );
  }
  if (kind === "extra_list") {
    const { id, ...value } = await getExtraList(tx, ids.extra_list);
    return updateExtraList(tx, id, { ...value, customerName: names }, "en");
  }
  return updateUnit(tx, ids.unit, { name: names }, "en");
}

describe("shared translation writes", () => {
  it.each(kinds)(
    "%s existing writer checks the same default and accepts its explicit companion",
    async (kind) => {
      await seedTenant(suite.db);
      const ids = await withTransaction(suite.db, (tx) => fixture(tx));
      await expect(
        withTransaction(suite.db, (tx) => existingWrite(tx, kind, ids, { en: "English only" })),
      ).rejects.toMatchObject({
        code: codes[kind],
        params:
          kind === "product" || kind === "variant"
            ? { language: "es" }
            : {
                language: "es",
                field:
                  kind === "unit"
                    ? "name"
                    : kind === "option_label"
                      ? "labels.0.customerName"
                      : "customerName",
              },
      });
      await withTransaction(suite.db, async (tx) => {
        await existingWrite(tx, kind, ids, { en: "English", es: "Castellano" });
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        expect(targets[0]).toMatchObject({ names: { en: "English", es: "Castellano" } });
      });
    },
  );

  it.each(kinds)("%s refuses a disappeared target instead of recreating it", async (kind) => {
    await seedTenant(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        await fixture(tx);
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: "removed-id" }],
          context,
        );
        await writers[kind](tx, targets[0]!, { en: "English", es: "Castellano" });
      }),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it("refuses a resolved variant passed to the top-level product writer", async () => {
    await seedTenant(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind: "variant", id: ids.variant }],
          context,
        );
        await writeProductTranslation(tx, targets[0]!, { en: "English" });
      }),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it.each(["variant", "option_label"] as const)("%s refuses an inactive owner", async (kind) => {
    await seedTenant(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        if (kind === "variant")
          await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
        else
          await tx
            .update(optionLists)
            .set({ active: false })
            .where(eq(optionLists.id, ids.option_list));
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        await writers[kind](tx, targets[0]!, { en: "English" });
      }),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it("shared named cells preserve aggregates and other language cells without another configuration read", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const before = await snapshot(tx);
      const resolution = await resolveTranslationTargets(
        tx,
        "en",
        kinds.map((kind) => ({ kind, id: ids[kind] })),
        context,
      );
      const readSpy = vi.spyOn(tx, "select");
      const executeSpy = vi.spyOn(tx, "execute");
      try {
        for (const entry of resolution.targets)
          await writers[entry.target.kind as Kind](tx, entry, {
            en: `CLIENT English ${entry.target.kind}`,
          });
        expect(readSpy).not.toHaveBeenCalled();
        expect(executeSpy).not.toHaveBeenCalled();
      } finally {
        readSpy.mockRestore();
        executeSpy.mockRestore();
      }
      const after = await snapshot(tx);
      for (const kind of kinds) {
        const rows =
          kind === "product" || kind === "variant"
            ? after.products
            : kind === "option_list"
              ? after.options
              : kind === "option_label"
                ? after.labels
                : kind === "extra_list"
                  ? after.extras
                  : after.units;
        const row = rows.find((row) => row.id === ids[kind])!;
        const names = "customerName" in row ? row.customerName : row.name;
        expect(names).toMatchObject({ en: `CLIENT English ${kind}` });
      }
      // Remove only the new cells before comparing every remaining stored column and sibling row.
      for (const rows of [after.products, after.options, after.labels, after.extras])
        for (const row of rows) if (row.customerName) delete row.customerName.en;
      for (const row of after.units) delete row.name.en;
      expect(after).toEqual(before);
    });
  });

  it.each(kinds)("%s refuses a missing default companion without writing", async (kind) => {
    await seedTenant(suite.db);
    const ids = await withTransaction(suite.db, (tx) => fixture(tx));
    await withTransaction(suite.db, async (tx) => {
      if (kind === "product" || kind === "variant")
        await tx.update(products).set({ customerName: null }).where(eq(products.id, ids[kind]));
      else if (kind === "option_list")
        await tx
          .update(optionLists)
          .set({ customerName: null })
          .where(eq(optionLists.id, ids[kind]));
      else if (kind === "option_label")
        await tx
          .update(optionLabels)
          .set({ customerName: null })
          .where(eq(optionLabels.id, ids[kind]));
      else if (kind === "extra_list")
        await tx.update(extraLists).set({ customerName: null }).where(eq(extraLists.id, ids[kind]));
      else
        await tx
          .update(units)
          .set({ name: { ca: "Quilogram" } })
          .where(eq(units.id, ids[kind]));
    });
    const before = await withTransaction(suite.db, (tx) => snapshot(tx));
    await expect(
      withTransaction(suite.db, async (tx) => {
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        await writers[kind](tx, targets[0]!, { en: "New customer text" });
      }),
    ).rejects.toMatchObject({
      code: codes[kind],
      params:
        kind === "product" || kind === "variant"
          ? { language: "es" }
          : { language: "es", field: kind === "unit" ? "name" : "customerName" },
    });
    expect(await withTransaction(suite.db, (tx) => snapshot(tx))).toEqual(before);
    await withTransaction(suite.db, async (tx) => {
      const { targets } = await resolveTranslationTargets(
        tx,
        "en",
        [{ kind, id: ids[kind] }],
        context,
      );
      await writers[kind](tx, targets[0]!, { en: "New customer text", es: "Castellano explícito" });
      const { targets: after } = await resolveTranslationTargets(
        tx,
        "en",
        [{ kind, id: ids[kind] }],
        context,
      );
      expect(after[0]).toMatchObject({
        names: { en: "New customer text", es: "Castellano explícito" },
      });
    });
  });

  it.each(kinds)(
    "%s accepts an explicit default companion using the saved default, not the fallback or all required languages",
    async (kind) => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        await writers[kind](tx, targets[0]!, { en: "New English", es: "Nuevo castellano", ca: "" });
        const { targets: after } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        expect(after[0]).toMatchObject({
          names: { en: "New English", es: "Nuevo castellano", ca: "" },
        });
      });
    },
  );
});

describe("menu translation writes", () => {
  const menuWriters = {
    menu: writeMenuTranslation,
    section: writeSectionTranslation,
    included_menu: writeIncludedMenuTranslation,
  };
  it.each(["menu", "section", "included_menu"] as const)(
    "%s requires the effective default and preserves non-name columns",
    async (kind) => {
      await seedTenant(suite.db);
      const ids = await withTransaction(suite.db, async (tx) => {
        const shared = await fixture(tx);
        const child = await createCatalogue(tx, { name: "STAFF Drinks" });
        const details = await tx.select().from(menuDetails);
        const root = details.find((row) => row.menuId === shared.menuId)!.rootSectionId;
        const childRoot = details.find((row) => row.menuId === child.id)!.rootSectionId;
        const [section] = await tx
          .insert(sections)
          .values({ internalName: "STAFF Section", ownerMenuId: shared.menuId })
          .returning();
        const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
        await tx
          .update(sectionMembers)
          .set({
            showAsFolder: false,
            folderOverrides: { color: "#123456", image: null, names: { ca: "CLIENT Begudes" } },
          })
          .where(eq(sectionMembers.id, member.id));
        return { menu: root, section: section!.id, included_menu: member.id };
      });
      await expect(
        withTransaction(suite.db, async (tx) => {
          const resolved = await resolveTranslationTargets(
            tx,
            "en",
            [{ kind, id: ids[kind] }],
            context,
          );
          await menuWriters[kind](tx, resolved.targets[0]!, { en: "English" });
        }),
      ).rejects.toMatchObject({
        code: "menu_section.translation_required",
        params: { field: "names", language: "es" },
      });
      await withTransaction(suite.db, async (tx) => {
        const beforeSections = await tx.select().from(sections).orderBy(sections.id);
        const beforeMembers = await tx.select().from(sectionMembers).orderBy(sectionMembers.id);
        const resolved = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        const readSpy = vi.spyOn(tx, "execute");
        try {
          await menuWriters[kind](tx, resolved.targets[0]!, { en: "English", es: "Castellano" });
          expect(readSpy).not.toHaveBeenCalled();
        } finally {
          readSpy.mockRestore();
        }
        const afterSections = await tx.select().from(sections).orderBy(sections.id);
        const afterMembers = await tx.select().from(sectionMembers).orderBy(sectionMembers.id);
        if (kind === "included_menu") {
          const row = afterMembers.find((row) => row.id === ids[kind])!;
          expect(row).toMatchObject({
            showAsFolder: false,
            folderOverrides: {
              names: { ca: "CLIENT Begudes", en: "English", es: "Castellano" },
              color: "#123456",
              image: null,
            },
          });
          delete row.folderOverrides.names!.en;
          delete row.folderOverrides.names!.es;
        } else {
          const row = afterSections.find((row) => row.id === ids[kind])!;
          expect(row.names).toEqual({ en: "English", es: "Castellano" });
          delete row.names.en;
          delete row.names.es;
        }
        expect(afterSections).toEqual(beforeSections);
        expect(afterMembers).toEqual(beforeMembers);
      });
    },
  );
});
