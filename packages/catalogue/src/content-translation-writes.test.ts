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
import { resolveTranslationCells } from "./content-translation-cells.js";
import { writeTranslationMaps } from "./content-translation-writes.js";
import type { TranslationItem } from "./content-translation-types.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "en", required: ["es", "ca"] };
const kinds = ["product", "variant", "option_list", "option_label", "extra_list", "unit"] as const;
type Kind = (typeof kinds)[number];

async function resolveItem(
  tx: Transaction,
  kind: TranslationItem["kind"],
  id: string,
): Promise<TranslationItem> {
  const { cells } = await resolveTranslationCells(
    tx,
    [{ kind, id, language: "en", field: "name" }],
    context,
  );
  return { kind, id, name: cells[0]!.staffText ?? "", owners: cells[0]!.owners, cells };
}

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
      staffName: "Staff unit",
      staffAbbreviation: "su",
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
    "%s existing writer retains its current translation rules and exact saved maps",
    async (kind) => {
      await seedTenant(suite.db);
      const ids = await withTransaction(suite.db, (tx) => fixture(tx));
      if (kind === "unit") {
        expect(
          await withTransaction(suite.db, (tx) =>
            existingWrite(tx, kind, ids, { en: "English only" }),
          ),
        ).toMatchObject({
          name: { en: "English only" },
          staffName: "Staff unit",
          staffAbbreviation: "su",
        });
      } else if (kind === "product" || kind === "variant") {
        await withTransaction(suite.db, (tx) =>
          existingWrite(tx, kind, ids, { en: "English only" }),
        );
        const [stored] = await suite.db
          .select({ customerName: products.customerName })
          .from(products)
          .where(eq(products.id, ids[kind]));
        expect(stored!.customerName).toEqual({ en: "English only" });
      } else {
        await withTransaction(suite.db, async (tx) => {
          await existingWrite(tx, kind, ids, { en: "English only" });
          const { targets } = await resolveTranslationTargets(
            tx,
            "en",
            [{ kind, id: ids[kind] }],
            context,
          );
          const resolved = targets[0];
          expect(resolved?.state === "present" ? resolved.names : undefined).toEqual({
            en: "English only",
          });
        });
      }
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
    const before = await withTransaction(suite.db, (tx) => snapshot(tx));
    await expect(
      withTransaction(suite.db, async (tx) => {
        await writeTranslationMaps(tx, await resolveItem(tx, kind, "removed-id"), {
          name: { en: "English", es: "Castellano" },
        });
      }),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
    expect(await withTransaction(suite.db, (tx) => snapshot(tx))).toEqual(before);
  });

  it("refuses a resolved variant passed to the top-level product writer", async () => {
    await seedTenant(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        const item = await resolveItem(tx, "variant", ids.variant);
        await writeTranslationMaps(tx, { ...item, kind: "product" }, { name: { en: "English" } });
      }),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it("option_label refuses an inactive owner", async () => {
    await seedTenant(suite.db);
    await expect(
      withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        await tx
          .update(optionLists)
          .set({ active: false })
          .where(eq(optionLists.id, ids.option_list));
        await writeTranslationMaps(tx, await resolveItem(tx, "option_label", ids.option_label), {
          name: { en: "English" },
        });
      }),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it.each(["product", "variant", "variant parent"] as const)(
    "%s accepts only a customer-name translation after archiving",
    async (archived) => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        const kind = archived === "product" ? "product" : "variant";
        const archivedId = archived === "variant" ? ids.variant : ids.product;
        await tx.update(products).set({ active: false }).where(eq(products.id, archivedId));
        const before = await snapshot(tx);
        expect(before.products.find((row) => row.id === archivedId)!.active).toBe(false);
        const item = await resolveItem(tx, kind, ids[kind]);
        expect(await snapshot(tx)).toEqual(before);
        const customerName =
          kind === "product"
            ? { es: "CLIENT Pan", ca: "CLIENT Pa", en: "CLIENT English" }
            : { es: "CLIENT Pequeño", ca: "CLIENT Petit", en: "CLIENT English" };
        await writeTranslationMaps(tx, item, { name: customerName });
        expect(await snapshot(tx)).toEqual({
          ...before,
          products: before.products.map((row) =>
            row.id === ids[kind] ? { ...row, customerName } : row,
          ),
        });
      });
    },
  );

  it("shared named cells preserve aggregates and other language cells without another configuration read", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const before = await snapshot(tx);
      const items: TranslationItem[] = [];
      for (const kind of kinds) items.push(await resolveItem(tx, kind, ids[kind]));
      const readSpy = vi.spyOn(tx, "select");
      const executeSpy = vi.spyOn(tx, "execute");
      try {
        for (const item of items) {
          const names =
            item.kind === "product"
              ? { es: "CLIENT Pan", ca: "CLIENT Pa" }
              : item.kind === "variant"
                ? { es: "CLIENT Pequeño", ca: "CLIENT Petit" }
                : item.kind === "option_list"
                  ? { es: "CLIENT Punto", ca: "CLIENT Punt" }
                  : item.kind === "option_label"
                    ? { es: "CLIENT Poco", ca: "CLIENT Poc" }
                    : item.kind === "extra_list"
                      ? { es: "CLIENT Guarnición", ca: "CLIENT Guarnició" }
                      : { es: "CLIENT Kilogramo", ca: "CLIENT Quilogram" };
          await writeTranslationMaps(tx, item, {
            name: { ...names, en: `CLIENT English ${item.kind}` },
          });
        }
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
        expect("customerName" in row ? row.customerName : row.name).toMatchObject({
          en: `CLIENT English ${kind}`,
        });
      }
      for (const rows of [after.products, after.options, after.labels, after.extras])
        for (const row of rows) if (row.customerName) delete row.customerName.en;
      for (const row of after.units) delete row.name.en;
      expect(after).toEqual(before);
    });
  });

  it.each(kinds)(
    "%s saves without a default companion and changes only the final name map",
    async (kind) => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        const before = await snapshot(tx);
        await writeTranslationMaps(tx, await resolveItem(tx, kind, ids[kind]), {
          name: { en: "New customer text" },
        });
        const after = await snapshot(tx);
        const expected = structuredClone(before);
        const rows =
          kind === "product" || kind === "variant"
            ? expected.products
            : kind === "option_list"
              ? expected.options
              : kind === "option_label"
                ? expected.labels
                : kind === "extra_list"
                  ? expected.extras
                  : expected.units;
        const row = rows.find((row) => row.id === ids[kind])!;
        if ("customerName" in row) row.customerName = { en: "New customer text" };
        else row.name = { en: "New customer text" };
        expect(after).toEqual(expected);
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        expect(targets[0]).toMatchObject({ names: { en: "New customer text" } });
      });
    },
  );

  it.each(kinds)(
    "%s replaces all submitted language keys and permits clearing the final translation",
    async (kind) => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const ids = await fixture(tx);
        await writeTranslationMaps(tx, await resolveItem(tx, kind, ids[kind]), {
          name: { en: "New English", es: "Nuevo castellano" },
        });
        const { targets } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        expect(targets[0]).toMatchObject({ names: { en: "New English", es: "Nuevo castellano" } });
        await writeTranslationMaps(tx, await resolveItem(tx, kind, ids[kind]), { name: {} });
        const { targets: cleared } = await resolveTranslationTargets(
          tx,
          "en",
          [{ kind, id: ids[kind] }],
          context,
        );
        expect(cleared[0]).toMatchObject({ names: {} });
      });
    },
  );
});

describe("menu translation writes", () => {
  it.each(["menu", "section", "included_menu"] as const)(
    "%s saves optional final names and preserves non-name columns",
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
      await withTransaction(suite.db, async (tx) => {
        const beforeSections = await tx.select().from(sections).orderBy(sections.id);
        const beforeMembers = await tx.select().from(sectionMembers).orderBy(sectionMembers.id);
        const item = await resolveItem(tx, kind, ids[kind]);
        const readSpy = vi.spyOn(tx, "execute");
        try {
          await writeTranslationMaps(tx, item, {
            name:
              kind === "included_menu"
                ? { ca: "CLIENT Begudes", en: "English" }
                : { en: "English" },
          });
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
              names: { ca: "CLIENT Begudes", en: "English" },
              color: "#123456",
              image: null,
            },
          });
          delete row.folderOverrides.names!.en;
        } else {
          const row = afterSections.find((row) => row.id === ids[kind])!;
          expect(row.names).toEqual({ en: "English" });
          delete row.names.en;
        }
        expect(afterSections).toEqual(beforeSections);
        expect(afterMembers).toEqual(beforeMembers);
      });
    },
  );
});

describe("final translation map identity", () => {
  it.each(["kind", "id", "field"] as const)(
    "refuses a group whose resolved cell has a different %s without writing",
    async (changed) => {
      await seedTenant(suite.db);
      const ids = await withTransaction(suite.db, (tx) => fixture(tx));
      const before = await withTransaction(suite.db, (tx) => snapshot(tx));
      await expect(
        withTransaction(suite.db, async (tx) => {
          const { cells } = await resolveTranslationCells(
            tx,
            [{ kind: "product", id: ids.product, language: "en", field: "name" }],
            context,
          );
          const cell = { ...cells[0]! };
          if (changed === "kind") cell.kind = "variant";
          if (changed === "id") cell.id = ids.variant;
          if (changed === "field") cell.field = "abbreviation";
          const item: TranslationItem = {
            kind: "product",
            id: ids.product,
            name: "STAFF Bread",
            owners: cells[0]!.owners,
            cells: [cell],
          };
          await writeTranslationMaps(tx, item, { name: { en: "Wrong target" } });
        }),
      ).rejects.toMatchObject({ code: "content.translation_invalid" });
      expect(await withTransaction(suite.db, (tx) => snapshot(tx))).toEqual(before);
    },
  );
});
