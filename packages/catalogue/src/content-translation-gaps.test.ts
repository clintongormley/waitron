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
import { contentLanguageChoices, type ContentLanguages } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { writeContentLanguages, listContentTranslationGaps } from "./content-languages.js";
import {
  listTranslationGapReport,
  listTranslationGapCounts,
} from "./content-translation-report.js";
import { listTranslationTargets, listTranslationGapRows } from "./content-translation-targets.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { menuDetails } from "./schema/menu.js";
import { units } from "./schema/units.js";
import { addMember } from "./sections.js";
import { setIncludeFolder } from "./include-folder.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const config: ContentLanguages = { defaultLanguage: "es", languages: ["es", "en"] };
const context = { fallbackLanguage: "es", required: ["es"] };

async function fixture(tx: Transaction, names: Record<string, string> | null) {
  await writeContentLanguages(tx, config);
  const menu = await createCatalogue(tx, { name: "STAFF Menu", names: names ?? {} });
  const child = await createCatalogue(tx, {
    name: "STAFF Included",
    names: { es: "CLIENT Hijo", en: "CLIENT Child" },
  });
  const roots = await tx.select().from(menuDetails);
  const root = roots.find((row) => row.menuId === menu.id)!.rootSectionId;
  const childRoot = roots.find((row) => row.menuId === child.id)!.rootSectionId;
  const product = await createProduct(tx, {
    catalogueId: menu.id,
    categoryId: null,
    name: "STAFF Product",
    customerName: null,
    kitchenName: "KITCHEN Product",
    unitPrice: "3.00",
    pricingUnit: "each",
    vatClass: "reduced",
  });
  await tx.update(products).set({ customerName: names }).where(eq(products.id, product.id));
  const [variant] = await tx
    .insert(products)
    .values({
      catalogueId: menu.id,
      parentId: product.id,
      name: "STAFF Variant",
      customerName: names,
      kitchenName: "KITCHEN Variant",
      unitPrice: 200,
      pricingUnit: "each",
      vatClass: "reduced",
    })
    .returning();
  const [list] = await tx
    .insert(optionLists)
    .values({ name: "STAFF Options", customerName: names })
    .returning();
  const [label] = await tx
    .insert(optionLabels)
    .values({ listId: list!.id, name: "STAFF Label", customerName: names })
    .returning();
  const [extra] = await tx
    .insert(extraLists)
    .values({ name: "STAFF Extras", customerName: names })
    .returning();
  const [section] = await tx
    .insert(sections)
    .values({ ownerMenuId: menu.id, internalName: "STAFF Section", names: names ?? {} })
    .returning();
  await tx
    .update(sections)
    .set({ names: names ?? {} })
    .where(eq(sections.id, root));
  const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
  await tx
    .update(sectionMembers)
    .set({ folderOverrides: { names: names ?? {} } })
    .where(eq(sectionMembers.id, member.id));
  const [unit] = await tx
    .insert(units)
    .values({
      staffName: "Kilogram",
      staffAbbreviation: "kg",
      name: names ?? {},
      abbreviation: names ?? {},
      precision: 3,
    })
    .returning();
  return {
    menu,
    root,
    child,
    childRoot,
    product,
    variant: variant!,
    list: list!,
    label: label!,
    extra: extra!,
    section: section!,
    member,
    unit: unit!,
  };
}

describe("complete translation gap predicates", () => {
  it.each([
    ["null", null],
    ["empty", {}],
    ["disabled only", { fr: "CLIENT FR text" }],
    ["spaces", { es: "   ", en: "  " }],
    ["tabs", { es: "\t\n", en: "\r\t" }],
    ["nonbreaking spaces", { es: "\u00a0", en: "\ufeff\u00a0" }],
  ] as const)(
    "reports %s text in the default too, without treating fallback as entered text",
    async (_name, input) => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        const f = await fixture(tx, input);
        const expected = [
          ["product", f.product.id],
          ["variant", f.variant.id],
          ["option_list", f.list.id],
          ["option_label", f.label.id],
          ["extra_list", f.extra.id],
          ["menu", f.root],
          ["section", f.section.id],
          ...(_name === "null" || _name === "empty" || _name === "disabled only"
            ? []
            : [["included_menu", f.member.id]]),
          ["unit", f.unit.id],
        ];
        const report = await listTranslationGapReport(tx, config);
        expect(
          report.map(({ language, gaps }) => [language, gaps.map(({ kind, id }) => [kind, id])]),
        ).toEqual([
          ["es", expected],
          ["en", expected],
        ]);
        expect(await listTranslationGapCounts(tx, config)).toEqual([
          { language: "es", count: expected.length },
          { language: "en", count: expected.length },
        ]);
        expect(report[0]!.gaps.find(({ kind }) => kind === "unit")!.name).toBe("Kilogram");
        for (const language of config.languages) {
          const page = await listTranslationTargets(tx, language, {}, context);
          expect(page.total).toBe(expected.length);
          expect(page.rows.map(({ kind, id }) => [kind, id])).toEqual(expected);
        }
      });
    },
  );

  it("matches JavaScript trim for stored Unicode whitespace while keeping other invisible text", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, config);
      const menu = await createCatalogue(tx, {
        name: "STAFF Menu",
        names: { es: "CLIENT Carta", en: "CLIENT Menu" },
      });
      const blankValues = [
        "\u0009",
        "\u000a",
        "\u000b",
        "\u000c",
        "\u000d",
        " ",
        "\u00a0",
        "\u1680",
        "\u2000",
        "\u2001",
        "\u2002",
        "\u2003",
        "\u2004",
        "\u2005",
        "\u2006",
        "\u2007",
        "\u2008",
        "\u2009",
        "\u200a",
        "\u2028",
        "\u2029",
        "\u202f",
        "\u205f",
        "\u3000",
        "\ufeff",
      ];
      const rows = await tx
        .insert(products)
        .values(
          [...blankValues, "\u0085", "\u200b", " CLIENT "].map((text, i) => ({
            catalogueId: menu.id,
            name: `STAFF ${i}`,
            customerName: { es: text, en: "CLIENT Present" },
            kitchenName: `KITCHEN ${i}`,
            unitPrice: 200,
            pricingUnit: "each" as const,
            vatClass: "reduced",
          })),
        )
        .returning();
      const report = await listTranslationGapReport(tx, config);
      expect(report[0]!.gaps.map(({ id }) => id).sort()).toEqual(
        rows
          .slice(0, 25)
          .map(({ id }) => id)
          .sort(),
      );
      expect(report[1]).toEqual({ language: "en", gaps: [] });
      expect(await listTranslationGapCounts(tx, config)).toEqual([
        { language: "es", count: 25 },
        { language: "en", count: 0 },
      ]);
      expect((await listContentTranslationGaps(tx, "es")).map(({ id }) => id).sort()).toEqual(
        rows
          .slice(0, 25)
          .map(({ id }) => id)
          .sort(),
      );
    });
  });

  it.each([
    [{ es: "CLIENT Spanish unit", en: "CLIENT Name" }, {}],
    [{}, { es: "kg", en: "kg" }],
    [{}, {}],
  ] as const)("counts a unit once per language with %s / %s", async (name, abbreviation) => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, config);
      const [unit] = await tx
        .insert(units)
        .values({
          staffName: "Kilogram",
          staffAbbreviation: "kg",
          name,
          abbreviation,
          precision: 3,
        })
        .returning();
      const expected = [{ kind: "unit", id: unit!.id, name: "Kilogram", reason: "partial" }];
      expect(await listTranslationGapReport(tx, config)).toEqual([
        { language: "es", gaps: expected },
        { language: "en", gaps: expected },
      ]);
      expect(await listTranslationGapCounts(tx, config)).toEqual([
        { language: "es", count: 1 },
        { language: "en", count: 1 },
      ]);
      expect(
        (await listTranslationTargets(tx, "es", {}, context)).rows.map(({ id }) => id),
      ).toEqual([unit!.id]);
      expect((await listTranslationGapRows(tx, config)).map(({ id }) => id)).toEqual([unit!.id]);
      expect(await listContentTranslationGaps(tx, "es")).toEqual([{ kind: "unit", id: unit!.id }]);
    });
  });

  it("uses inherited text for an overriding inclusion, and leaves a cleared override represented by its root", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const f = await fixture(tx, { es: "CLIENT Completo", en: "CLIENT Complete" });
      await tx
        .update(sections)
        .set({ names: { es: "CLIENT Hijo" } })
        .where(eq(sections.id, f.childRoot));
      await setIncludeFolder(tx, f.root, f.member.id, {
        showAsFolder: false,
        overrides: { names: { en: "CLIENT Override" } },
      });
      expect(await listTranslationGapReport(tx, config)).toEqual([
        { language: "es", gaps: [] },
        {
          language: "en",
          gaps: [
            {
              kind: "menu",
              id: f.childRoot,
              name: "STAFF Included",
              reason: "partial",
              parent: { id: f.child.id, name: "STAFF Included" },
            },
          ],
        },
      ]);
      await setIncludeFolder(tx, f.root, f.member.id, {
        showAsFolder: false,
        overrides: { names: {} },
      });
      expect(
        (await listTranslationGapReport(tx, config))[1]!.gaps.map(({ kind, id }) => [kind, id]),
      ).toEqual([["menu", f.childRoot]]);
      expect(await listTranslationGapCounts(tx, config)).toEqual([
        { language: "es", count: 0 },
        { language: "en", count: 1 },
      ]);
    });
  });

  it("shares discovery's activity, ownership and role exclusions while direct archived reads stay eligible", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const f = await fixture(tx, null);
      await tx.update(products).set({ active: false }).where(eq(products.id, f.product.id));
      await tx.update(optionLists).set({ active: false }).where(eq(optionLists.id, f.list.id));
      await tx.update(extraLists).set({ active: false }).where(eq(extraLists.id, f.extra.id));
      await tx.update(sections).set({ role: "home_layout" }).where(eq(sections.id, f.section.id));
      await tx.update(catalogues).set({ active: false }).where(eq(catalogues.id, f.menu.id));
      expect(await listTranslationGapCounts(tx, config)).toEqual([
        { language: "es", count: 1 },
        { language: "en", count: 1 },
      ]);
      for (const { gaps } of await listTranslationGapReport(tx, config))
        expect(gaps).toEqual([
          { kind: "unit", id: f.unit.id, name: "Kilogram", reason: "partial" },
        ]);
      const direct = await listTranslationTargets(
        tx,
        "es",
        {
          targets: [
            { kind: "product", id: f.product.id },
            { kind: "variant", id: f.variant.id },
          ],
        },
        context,
      );
      expect(
        direct.rows.map(({ eligible, unavailableReason }) => [eligible, unavailableReason]),
      ).toEqual([
        [true, null],
        [true, null],
      ]);
    });
  });

  it("returns only count rows in one database read for 200 languages, including zeros", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const languages = [
        "es",
        "en",
        ...contentLanguageChoices("en")
          .map(({ code }) => code)
          .filter((code) => code !== "es" && code !== "en")
          .slice(0, 198),
      ];
      expect(languages).toHaveLength(200);
      const large = { defaultLanguage: "es", languages };
      await writeContentLanguages(tx, large);
      await tx.insert(units).values({
        staffName: "Kilogram",
        staffAbbreviation: "kg",
        name: { es: "CLIENT Kilogram" },
        abbreviation: { es: "kg" },
        precision: 3,
      });
      const spy = vi.spyOn(tx, "execute");
      try {
        expect(await listTranslationGapCounts(tx, large)).toEqual(
          languages.map((language, i) => ({ language, count: i === 0 ? 0 : 1 })),
        );
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
