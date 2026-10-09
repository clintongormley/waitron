import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  catalogues,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { setProductVariants } from "./variants.js";
import { addMember } from "./sections.js";
import { setIncludeFolder } from "./include-folder.js";
import { menuDetails } from "./schema/menu.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import type { TranslationRef } from "./content-translation-types.js";
import {
  listTranslationTargets,
  resolveTranslationTargets,
} from "./content-translation-targets.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "es", required: ["es"] };

async function fixture(tx: Transaction) {
  await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "ca", "en"] });
  const menu = await createCatalogue(tx, { name: "STAFF Lunch", names: { es: "CLIENT Almuerzo" } });
  const child = await createCatalogue(tx, {
    name: "STAFF Drinks",
    names: { es: "CLIENT Bebidas", en: "Drinks" },
  });
  const roots = await tx.select().from(menuDetails);
  const root = roots.find((row) => row.menuId === menu.id)!.rootSectionId;
  const childRoot = roots.find((row) => row.menuId === child.id)!.rootSectionId;
  const product = await createProduct(tx, {
    catalogueId: menu.id,
    categoryId: null,
    name: "STAFF Bread",
    customerName: null,
    kitchenName: "KITCHEN Bread",
    unitPrice: "3.00",
    pricingUnit: "each",
    vatClass: "reduced",
  });
  const [variant] = await setProductVariants(
    tx,
    product.id,
    [
      {
        name: "STAFF Small",
        customerName: { es: "CLIENT Pequeño" },
        kitchenName: "KITCHEN Small",
        image: null,
        unitPrice: "2.00",
        available: true,
      },
    ],
    "es",
  );
  const [list] = await tx
    .insert(optionLists)
    .values({ name: "STAFF Doneness", customerName: { es: "CLIENT Punto" } })
    .returning();
  const [label] = await tx
    .insert(optionLabels)
    .values({
      listId: list!.id,
      name: "STAFF Rare",
      customerName: { es: "CLIENT Poco" },
      available: false,
    })
    .returning();
  const [extra] = await tx
    .insert(extraLists)
    .values({ name: "STAFF Sides", customerName: { es: "CLIENT Guarnición" } })
    .returning();
  await tx.insert(extraLists).values({ name: "STAFF Omitted absent extras" });
  const [section] = await tx
    .insert(sections)
    .values({ internalName: "STAFF Mains", names: { es: "CLIENT Platos" }, ownerMenuId: menu.id })
    .returning();
  const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
  await setIncludeFolder(
    tx,
    root,
    member.id,
    { showAsFolder: false, overrides: { names: { en: "" }, color: "#123456" } },
    "es",
  );
  const [unit] = await tx
    .insert(units)
    .values({ name: { es: "ración" }, abbreviation: { es: "rac" }, precision: 2 })
    .returning();
  return {
    product: product.id,
    variant: variant!.id,
    option_list: list!.id,
    option_label: label!.id,
    extra_list: extra!.id,
    menu: root,
    section: section!.id,
    included_menu: member.id,
    unit: unit!.id,
    menuId: menu.id,
    root,
    childRoot,
    childMenuId: child.id,
  };
}

describe("inline translation targets", () => {
  it.each([
    ["en", "content.languages_invalid"],
    ["es-ES", "content.translation_invalid"],
    ["!!", "content.language_invalid"],
  ])("refuses disabled or noncanonical requested language %s", async (language, code) => {
    await expect(
      withTransaction(suite.db, (tx) => listTranslationTargets(tx, language, {}, context)),
    ).rejects.toMatchObject({ code });
  });
  it("nine target identities distinguish each name from its owner and retain folder-off gaps", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const executeSpy = vi.spyOn(tx, "execute");
      const page = await (async () => {
        try {
          const answer = await listTranslationTargets(tx, "en", {}, context);
          expect(executeSpy).toHaveBeenCalledTimes(4);
          return answer;
        } finally {
          executeSpy.mockRestore();
        }
      })();
      expect(page.rows.map(({ kind, id }) => ({ kind, id }))).toEqual([
        { kind: "product", id: ids.product },
        { kind: "variant", id: ids.variant },
        { kind: "option_list", id: ids.option_list },
        { kind: "option_label", id: ids.option_label },
        { kind: "extra_list", id: ids.extra_list },
        { kind: "menu", id: ids.menu },
        { kind: "section", id: ids.section },
        { kind: "included_menu", id: ids.included_menu },
        { kind: "unit", id: ids.unit },
      ]);
      const byKind = Object.fromEntries(page.rows.map((row) => [row.kind, row]));
      expect(byKind.product).toMatchObject({
        name: "STAFF Bread",
        reason: "absent",
        selectedText: null,
        defaultText: null,
        defaultRequired: true,
        eligible: true,
        owners: { kind: "product", parentId: null },
      });
      expect(byKind.variant!.owners).toEqual({ kind: "variant", parentId: ids.product });
      expect(byKind.option_label!.owners).toEqual({
        kind: "option_label",
        listId: ids.option_list,
      });
      expect(byKind.menu!.owners).toEqual({ kind: "menu", menuId: ids.menuId, rootId: ids.root });
      expect(byKind.included_menu).toMatchObject({
        selectedText: "",
        defaultText: null,
        effectiveSelectedText: "",
        effectiveDefaultText: "CLIENT Bebidas",
        defaultRequired: false,
        owners: {
          kind: "included_menu",
          menuId: ids.menuId,
          sectionId: ids.root,
          includedMenuId: ids.childMenuId,
          includedRootId: ids.childRoot,
        },
      });
      expect(page).toMatchObject({
        total: 9,
        next: null,
        config: { defaultLanguage: "es", languages: ["es", "ca", "en"] },
        required: ["es"],
      });
    });
  });

  it("activity and ownership keep missing and invalid review targets explicit", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
      await tx
        .update(optionLists)
        .set({ active: false })
        .where(eq(optionLists.id, ids.option_list));
      await tx.update(sections).set({ role: "home_layout" }).where(eq(sections.id, ids.section));
      const resolved = await resolveTranslationTargets(
        tx,
        "en",
        [
          { kind: "variant", id: ids.variant },
          { kind: "option_label", id: ids.option_label },
          { kind: "section", id: ids.section },
          { kind: "unit", id: "removed-unit" },
          { kind: "product", id: ids.variant },
        ],
        context,
      );
      expect(
        resolved.targets.map((row) => [
          row.state,
          row.target.eligible,
          row.target.unavailableReason,
        ]),
      ).toEqual([
        ["present", true, null],
        ["present", false, "inactive"],
        ["present", false, "role"],
        ["missing", false, "missing"],
        ["present", false, "role"],
      ]);
      await tx
        .update(sectionMembers)
        .set({ sectionId: ids.section })
        .where(eq(sectionMembers.id, ids.included_menu));
      const moved = await resolveTranslationTargets(
        tx,
        "en",
        [{ kind: "included_menu", id: ids.included_menu }],
        context,
      );
      expect(moved.targets[0]!.target).toMatchObject({
        eligible: false,
        unavailableReason: "role",
      });
    });
  });

  it("default fallback and required settings are read once and appear in expected values", async () => {
    await withTransaction(suite.db, async (tx) => {
      const [unit] = await tx
        .insert(units)
        .values({ name: { es: "ración" }, abbreviation: { es: "rac" }, precision: 0 })
        .returning();
      const page = await listTranslationTargets(tx, "es", {}, context);
      expect(page).toMatchObject({
        config: { defaultLanguage: "es", languages: ["es"] },
        rows: [],
        total: 0,
      });
      const one = await resolveTranslationTargets(
        tx,
        "es",
        [{ kind: "unit", id: unit!.id }],
        context,
      );
      expect(one.targets[0]!.target).toMatchObject({
        selectedText: "ración",
        defaultText: "ración",
        defaultRequired: false,
      });
      expect(JSON.parse(one.targets[0]!.target.expected)).toMatchObject({
        config: { defaultLanguage: "es", languages: ["es"] },
        required: ["es"],
      });
    });
  });

  it("stable pages carry fifty rows then the remainder without duplicate ids", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
      await tx.insert(units).values(
        Array.from({ length: 51 }, (_, i) => ({
          id: `u-${String(i).padStart(3, "0")}`,
          name: { es: "ración" },
          abbreviation: { es: "rac" },
          precision: 0,
        })),
      );
      const first = await listTranslationTargets(tx, "en", {}, context);
      expect(first.rows.map((row) => row.id)).toEqual(
        Array.from({ length: 50 }, (_, i) => `u-${String(i).padStart(3, "0")}`),
      );
      expect(first.total).toBe(51);
      expect(first.next).not.toBeNull();
      const second = await listTranslationTargets(tx, "en", { after: first.next! }, context);
      expect(second.rows.map((row) => row.id)).toEqual(["u-050"]);
      expect(second.next).toBeNull();
      const filled = await listTranslationTargets(
        tx,
        "en",
        {
          targets: [
            { kind: "unit", id: "u-000" },
            { kind: "unit", id: "removed" },
          ],
        },
        context,
      );
      expect(filled.rows.map((row) => [row.id, row.eligible])).toEqual([
        ["u-000", true],
        ["removed", false],
      ]);
    });
  });

  it("bounded reads use the same number of statements for one and one hundred targets", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
      const refs = Array.from({ length: 100 }, (_, i) => ({
        kind: "unit" as const,
        id: `unit-${i}`,
      }));
      await tx.insert(units).values(
        refs.map(({ id }) => ({
          id,
          name: { es: "ración" },
          abbreviation: { es: "rac" },
          precision: 0,
        })),
      );
      const actual = vi.spyOn(tx, "execute");
      try {
        await resolveTranslationTargets(tx, "en", refs.slice(0, 1), context);
        const count = actual.mock.calls.length;
        expect(await actual.mock.results[1]!.value).toMatchObject({
          rows: [{ kind: "unit", id: "unit-0" }],
        });
        actual.mockClear();
        const many = await resolveTranslationTargets(tx, "en", refs, context);
        expect(many.targets).toHaveLength(100);
        expect(await actual.mock.results[1]!.value).toHaveProperty("rows.length", 100);
        expect(actual).toHaveBeenCalledTimes(count);
        expect(count).toBe(2);
      } finally {
        actual.mockRestore();
      }
    });
  });

  it("either inactive inclusion menu makes the exact membership ineligible", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const refs = [{ kind: "included_menu" as const, id: ids.included_menu }];
      for (const id of [ids.childMenuId, ids.menuId]) {
        await tx.update(catalogues).set({ active: false }).where(eq(catalogues.id, id));
        const resolved = await resolveTranslationTargets(tx, "en", refs, context);
        expect(resolved.targets[0]!.target).toMatchObject({
          eligible: false,
          unavailableReason: "inactive",
        });
        expect(
          (await listTranslationTargets(tx, "en", {}, context)).rows.map((row) => row.id),
        ).not.toContain(ids.included_menu);
        await tx.update(catalogues).set({ active: true }).where(eq(catalogues.id, id));
      }
      expect(
        (await resolveTranslationTargets(tx, "en", refs, context)).targets[0]!.target.eligible,
      ).toBe(true);
    });
  });

  it("wrong-kind references never manufacture missing owner ids", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const member = await addMember(tx, ids.root, { kind: "product", productId: ids.product });
      const resolved = await resolveTranslationTargets(
        tx,
        "en",
        [
          { kind: "variant", id: ids.product },
          { kind: "included_menu", id: member.id },
        ],
        context,
      );
      expect(
        resolved.targets.map(({ target }) => ({
          eligible: target.eligible,
          reason: target.unavailableReason,
          owners: target.owners,
        })),
      ).toEqual([
        { eligible: false, reason: "role", owners: null },
        { eligible: false, reason: "role", owners: null },
      ]);
    });
  });

  it("a replaced menu root is unavailable while the real root remains savable", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      await tx
        .update(menuDetails)
        .set({ rootSectionId: ids.section })
        .where(eq(menuDetails.menuId, ids.menuId));
      const resolved = await resolveTranslationTargets(
        tx,
        "en",
        [{ kind: "menu", id: ids.root }],
        context,
      );
      expect(resolved.targets[0]!.target).toMatchObject({
        eligible: false,
        unavailableReason: "ownership",
      });
      await tx
        .update(menuDetails)
        .set({ rootSectionId: ids.root })
        .where(eq(menuDetails.menuId, ids.menuId));
      expect(
        (await resolveTranslationTargets(tx, "en", [{ kind: "menu", id: ids.root }], context))
          .targets[0]!.target.eligible,
      ).toBe(true);
    });
  });

  it("tokens exclude unrelated languages and price but change with selected or default cells", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const refs = [{ kind: "variant" as const, id: ids.variant }];
      const token = async () =>
        (await resolveTranslationTargets(tx, "en", refs, context)).targets[0]!.target.expected;
      const before = await token();
      await tx
        .update(products)
        .set({ customerName: { ca: "Altre", es: "CLIENT Pequeño" }, unitPrice: 800 })
        .where(eq(products.id, ids.variant));
      expect(await token()).toBe(before);
      await tx
        .update(products)
        .set({ customerName: { es: "CLIENT Pequeño", en: "Small" } })
        .where(eq(products.id, ids.variant));
      expect(await token()).not.toBe(before);
      await tx
        .update(products)
        .set({ customerName: { es: "CLIENT Otro" } })
        .where(eq(products.id, ids.variant));
      expect(await token()).not.toBe(before);
    });
  });

  it("empty units remain partial gaps and whitespace default labels use a nonblank name", async () => {
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
      const [empty] = await tx
        .insert(units)
        .values({ name: {}, abbreviation: { es: "u" }, precision: 0 })
        .returning();
      const [blank] = await tx
        .insert(units)
        .values({ name: { es: "  ", ca: "racció" }, abbreviation: { es: "u" }, precision: 0 })
        .returning();
      const page = await listTranslationTargets(tx, "es", {}, context);
      expect(page.rows.find((row) => row.id === empty!.id)).toMatchObject({
        reason: "partial",
        name: "",
        defaultRequired: true,
      });
      expect(page.rows.find((row) => row.id === blank!.id)).toMatchObject({
        reason: "partial",
        name: "racció",
        defaultRequired: true,
      });
    });
  });

  it("fifty explicit lookup targets succeed and one hundred domain targets do not permit 101", async () => {
    await withTransaction(suite.db, async (tx) => {
      const refs = Array.from({ length: 50 }, (_, i) => ({
        kind: "unit" as const,
        id: `removed-${i}`,
      }));
      expect(
        (await listTranslationTargets(tx, "es", { targets: refs }, context)).rows,
      ).toHaveLength(50);
    });
    await expect(
      withTransaction(suite.db, (tx) =>
        resolveTranslationTargets(
          tx,
          "es",
          Array.from({ length: 101 }, (_, i) => ({ kind: "unit", id: `removed-${i}` })),
          context,
        ),
      ),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it.each([
    { after: "invalid" },
    { after: "invalid", targets: [{ kind: "unit", id: "a" }] },
    { targets: [] },
    {
      targets: [
        { kind: "unit", id: "a" },
        { kind: "unit", id: "a" },
      ],
    },
    { targets: Array.from({ length: 51 }, (_, i) => ({ kind: "unit", id: `u-${i}` })) },
  ] satisfies { after?: string; targets?: TranslationRef[] }[])(
    "refuses malformed or over-limit page lookup %j",
    async (query) => {
      await expect(
        withTransaction(suite.db, (tx) => listTranslationTargets(tx, "es", query, context)),
      ).rejects.toMatchObject({ code: "content.translation_invalid" });
    },
  );
});
