import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { units } from "./schema/units.js";
import { addMember } from "./sections.js";
import { setIncludeFolder } from "./include-folder.js";
import { setProductVariants } from "./variants.js";
import { menuDetails } from "./schema/menu.js";
import { sections } from "./schema/sections.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { listTranslationItems } from "./content-translation-pages.js";
import { resolveTranslationCells } from "./content-translation-cells.js";
import type { TranslationCellRef } from "./content-translation-types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "es", required: ["es"] };

async function fixture(tx: Transaction) {
  await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "ca"] });
  const menu = await createCatalogue(tx, { name: "STAFF Menu", names: {} });
  const product = await createProduct(tx, {
    catalogueId: menu.id,
    categoryId: null,
    name: "STAFF Bread",
    customerName: {
      es: "CLIENT Pan",
      en: "CLIENT Bread",
      ca: "UNREQUESTED Pa",
      fr: "DISABLED Pain",
    },
    kitchenName: "KITCHEN Bread",
    unitPrice: "3.00",
    pricingUnit: "each",
    vatClass: "reduced",
  });
  const [unit] = await tx
    .insert(units)
    .values({
      staffName: "Kilogramo",
      staffAbbreviation: "kg",
      name: {},
      abbreviation: {},
      precision: 3,
    })
    .returning();
  return { product: product.id, unit: unit!.id };
}

const cell = (
  kind: TranslationCellRef["kind"],
  id: string,
  language = "en",
  field: TranslationCellRef["field"] = "name",
): TranslationCellRef => ({ kind, id, language, field });

describe("bounded translation field reads", () => {
  it("returns distinct unit staff fields without manufacturing entered text", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const result = await resolveTranslationCells(
        tx,
        [
          cell("unit", ids.unit),
          cell("unit", ids.unit, "en", "abbreviation"),
          cell("product", "missing"),
        ],
        context,
      );
      expect(
        result.cells.map(
          ({
            kind,
            id,
            language,
            field,
            staffText,
            text,
            inheritedText,
            effectiveText,
            defaultText,
            inheritedDefaultText,
            effectiveDefaultText,
            owners,
            eligible,
            unavailableReason,
          }) => ({
            kind,
            id,
            language,
            field,
            staffText,
            text,
            inheritedText,
            effectiveText,
            defaultText,
            inheritedDefaultText,
            effectiveDefaultText,
            owners,
            eligible,
            unavailableReason,
          }),
        ),
      ).toEqual([
        {
          kind: "unit",
          id: ids.unit,
          language: "en",
          field: "name",
          staffText: "Kilogramo",
          text: null,
          inheritedText: null,
          effectiveText: null,
          defaultText: null,
          inheritedDefaultText: null,
          effectiveDefaultText: null,
          owners: { kind: "unit" },
          eligible: true,
          unavailableReason: null,
        },
        {
          kind: "unit",
          id: ids.unit,
          language: "en",
          field: "abbreviation",
          staffText: "kg",
          text: null,
          inheritedText: null,
          effectiveText: null,
          defaultText: null,
          inheritedDefaultText: null,
          effectiveDefaultText: null,
          owners: { kind: "unit" },
          eligible: true,
          unavailableReason: null,
        },
        {
          kind: "product",
          id: "missing",
          language: "en",
          field: "name",
          staffText: null,
          text: null,
          inheritedText: null,
          effectiveText: null,
          defaultText: null,
          inheritedDefaultText: null,
          effectiveDefaultText: null,
          owners: null,
          eligible: false,
          unavailableReason: "missing",
        },
      ]);
      expect(JSON.parse(result.cells[1]!.expected)).toMatchObject({
        field: "abbreviation",
        language: "en",
        selectedText: null,
        config: { defaultLanguage: "es", languages: ["ca", "en", "es"] },
        required: ["es"],
      });
    });
  });

  it("projects selected and default text in SQL, retains input order and returns disabled cells for review", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const execute = vi.spyOn(tx, "execute");
      try {
        const result = await resolveTranslationCells(
          tx,
          [
            cell("product", ids.product),
            cell("unit", ids.unit, "es", "abbreviation"),
            cell("product", ids.product, "fr"),
          ],
          context,
        );
        expect(
          result.cells.map(
            ({ field, language, text, defaultText, eligible, unavailableReason }) => ({
              field,
              language,
              text,
              defaultText,
              eligible,
              unavailableReason,
            }),
          ),
        ).toEqual([
          {
            field: "name",
            language: "en",
            text: "CLIENT Bread",
            defaultText: "CLIENT Pan",
            eligible: true,
            unavailableReason: null,
          },
          {
            field: "abbreviation",
            language: "es",
            text: null,
            defaultText: null,
            eligible: true,
            unavailableReason: null,
          },
          {
            field: "name",
            language: "fr",
            text: "DISABLED Pain",
            defaultText: "CLIENT Pan",
            eligible: false,
            unavailableReason: "language_disabled",
          },
        ]);
        expect(execute).toHaveBeenCalledTimes(2);
        const rows = await Promise.all(execute.mock.results.map((r) => r.value));
        expect(JSON.stringify(rows)).not.toContain("UNREQUESTED Pa");
        expect(JSON.stringify(result)).not.toContain("UNREQUESTED Pa");
      } finally {
        execute.mockRestore();
      }
    });
  });

  it("keeps archived direct products editable while role changes remain explicit", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
      const result = await resolveTranslationCells(
        tx,
        [cell("product", ids.product), cell("variant", ids.product)],
        context,
      );
      expect(result.cells.map((c) => [c.kind, c.eligible, c.unavailableReason, c.owners])).toEqual([
        ["product", true, null, { kind: "product", parentId: null }],
        ["variant", false, "role", null],
      ]);
    });
  });

  it("shares all nine kinds and include inheritance between pages and retained cells", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const [variant] = await setProductVariants(
        tx,
        ids.product,
        [
          {
            name: "STAFF Small",
            customerName: {},
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
        .values({ name: "STAFF Choices", customerName: {} })
        .returning();
      const [label] = await tx
        .insert(optionLabels)
        .values({ listId: list!.id, name: "STAFF Toasted", customerName: {} })
        .returning();
      const [extra] = await tx.insert(extraLists).values({ name: "STAFF Extras" }).returning();
      const roots = await tx.select().from(menuDetails);
      const root = roots[0]!;
      const [section] = await tx
        .insert(sections)
        .values({ internalName: "STAFF Mains", names: {}, ownerMenuId: root.menuId })
        .returning();
      const child = await createCatalogue(tx, {
        name: "STAFF Drinks",
        names: { es: "CLIENT Bebidas", en: "CLIENT Drinks", ca: "CLIENT Begudes" },
      });
      const [childDetails] = await tx
        .select()
        .from(menuDetails)
        .where(eq(menuDetails.menuId, child.id));
      const member = await addMember(tx, root.rootSectionId, {
        kind: "section",
        sectionId: childDetails!.rootSectionId,
      });
      await setIncludeFolder(
        tx,
        root.rootSectionId,
        member.id,
        { showAsFolder: false, overrides: { names: { en: "CLIENT Folder" } } },
        "es",
      );
      const refs: TranslationCellRef[] = [
        cell("product", ids.product),
        cell("variant", variant!.id),
        cell("option_list", list!.id),
        cell("option_label", label!.id),
        cell("extra_list", extra!.id),
        cell("menu", root.rootSectionId),
        cell("section", section!.id),
        cell("included_menu", member.id),
        cell("unit", ids.unit),
      ];
      const direct = await resolveTranslationCells(tx, refs, context);
      expect(direct.cells.map((c) => [c.kind, c.text, c.staffText, c.eligible])).toEqual([
        ["product", "CLIENT Bread", "STAFF Bread", true],
        ["variant", null, "STAFF Small", true],
        ["option_list", null, "STAFF Choices", true],
        ["option_label", null, "STAFF Toasted", true],
        ["extra_list", null, "STAFF Extras", true],
        ["menu", null, "STAFF Menu", true],
        ["section", null, "STAFF Mains", true],
        ["included_menu", "CLIENT Folder", "STAFF Drinks", true],
        ["unit", null, "Kilogramo", true],
      ]);
      const include = direct.cells[7]!;
      expect(include).toMatchObject({
        inheritedText: "CLIENT Drinks",
        effectiveText: "CLIENT Folder",
        defaultText: null,
        inheritedDefaultText: "CLIENT Bebidas",
        effectiveDefaultText: "CLIENT Bebidas",
        owners: {
          kind: "included_menu",
          menuId: root.menuId,
          sectionId: root.rootSectionId,
          includedMenuId: child.id,
          includedRootId: childDetails!.rootSectionId,
        },
      });
      expect(JSON.parse(include.expected)).toMatchObject({
        field: "name",
        inheritedSelectedText: "CLIENT Drinks",
        inheritedDefaultText: "CLIENT Bebidas",
        structure: {
          role: "menu_root",
          active: true,
          ownerActive: true,
          rootMatched: true,
          parentRole: "menu_root",
          childActive: true,
        },
      });
      expect(direct.cells.map((c) => c.owners)).toEqual([
        { kind: "product", parentId: null },
        { kind: "variant", parentId: ids.product },
        { kind: "option_list" },
        { kind: "option_label", listId: list!.id },
        { kind: "extra_list" },
        { kind: "menu", menuId: root.menuId, rootId: root.rootSectionId },
        { kind: "section", menuId: root.menuId },
        {
          kind: "included_menu",
          menuId: root.menuId,
          sectionId: root.rootSectionId,
          includedMenuId: child.id,
          includedRootId: childDetails!.rootSectionId,
        },
        { kind: "unit" },
      ]);
      expect(
        (
          await listTranslationItems(
            tx,
            { languages: ["en"], missing: { mode: "all" }, kind: "variant", search: "bread" },
            context,
          )
        ).rows.map((row) => row.id),
      ).toEqual([variant!.id]);
      expect(
        (
          await listTranslationItems(
            tx,
            {
              languages: ["en"],
              missing: { mode: "all" },
              kind: "option_label",
              search: "choices",
            },
            context,
          )
        ).rows.map((row) => row.id),
      ).toEqual([label!.id]);
      const page = await listTranslationItems(
        tx,
        { languages: ["en"], missing: { mode: "all" } },
        context,
      );
      for (const wanted of direct.cells)
        expect(
          page.rows
            .find((r) => r.kind === wanted.kind && r.id === wanted.id)!
            .cells.find((c) => c.field === wanted.field),
        ).toEqual(wanted);
      const spanish = await listTranslationItems(
        tx,
        { languages: ["en"], missing: { mode: "language", language: "es" } },
        context,
      );
      expect(spanish.rows.some((r) => r.kind === "included_menu")).toBe(false);
      await setIncludeFolder(
        tx,
        root.rootSectionId,
        member.id,
        { showAsFolder: false, overrides: { names: {} } },
        "es",
      );
      const cleared = await resolveTranslationCells(
        tx,
        [cell("included_menu", member.id)],
        context,
      );
      expect(cleared.cells[0]).toMatchObject({
        text: null,
        inheritedText: "CLIENT Drinks",
        effectiveText: "CLIENT Drinks",
      });
      expect(
        (
          await listTranslationItems(tx, { languages: ["en"], missing: { mode: "all" } }, context)
        ).rows.some((r) => r.kind === "included_menu"),
      ).toBe(false);
    });
  });

  it.each(
    [
      [],
      Array.from({ length: 101 }, (_, i) => cell("product", `p${i}`)),
      [cell("product", "p"), cell("product", "p")],
      [cell("product", "p", "en", "abbreviation")],
      [cell("unit", "u", "es-ES")],
      [cell("unit", "u", "!!")],
      [{ ...cell("unit", "u"), extra: true }],
      [{ ...cell("unit", "u"), field: "other" }],
      [{ ...cell("unit", "u"), id: " " }],
      [
        Object.assign(Object.create({ field: "name" }), {
          kind: "unit",
          id: "u",
          language: "es",
          extra: true,
        }),
      ],
      [{ ...cell("unit", "u"), language: 5 }],
      [null],
      [{ ...cell("unit", "u"), kind: "other" }],
    ].map((refs) => [refs]),
  )("refuses invalid cell selection %#", async (refs) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        resolveTranslationCells(tx, refs as TranslationCellRef[], context),
      ),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it("accepts 100 distinct retained cells in a bounded pair of database reads", async () => {
    await withTransaction(suite.db, async (tx) => {
      const execute = vi.spyOn(tx, "execute");
      try {
        const result = await resolveTranslationCells(
          tx,
          Array.from({ length: 100 }, (_, i) => cell("unit", `missing-${i}`, "es", "abbreviation")),
          context,
        );
        expect(result.cells).toHaveLength(100);
        expect(
          result.cells.every((c) => c.unavailableReason === "missing" && c.staffText === null),
        ).toBe(true);
        expect(execute).toHaveBeenCalledTimes(2);
      } finally {
        execute.mockRestore();
      }
    });
  });
});
