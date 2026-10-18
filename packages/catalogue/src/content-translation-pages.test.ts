import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { contentLanguageChoices } from "@waitron/shared";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { units } from "./schema/units.js";
import { contentSuggestions } from "./schema/suggestions.js";
import { listTranslationItems } from "./content-translation-pages.js";
import type { TranslationQuery } from "./content-translation-types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "es", required: ["es"] };
async function fixture(tx: Transaction) {
  await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "ca"] });
  const menu = await createCatalogue(tx, {
    name: "STAFF Menú",
    names: { es: "CLIENT Menú", en: "CLIENT Menu", ca: "CLIENT Carta" },
  });
  const product = await createProduct(tx, {
    catalogueId: menu.id,
    categoryId: null,
    name: "STAFF Bread",
    customerName: { es: "CLIENT Pan", en: "CLIENT Bread", ca: "UNPROJECTED Pa" },
    kitchenName: "KITCHEN Bread",
    unitPrice: "3.00",
    pricingUnit: "each",
    vatClass: "reduced",
  });
  return { menu: menu.id, product: product.id };
}
const query = (extra: object = {}): TranslationQuery => ({
  languages: ["en"],
  missing: { mode: "any" },
  ...extra,
});

describe("multilingual item pages", () => {
  it("finds gaps outside the projection and distinguishes Missing in from All names", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      await tx
        .update(products)
        .set({ customerName: { es: "CLIENT Pan", en: "CLIENT Bread" } })
        .where(eq(products.id, ids.product));
      const any = await listTranslationItems(tx, query(), context);
      const ca = await listTranslationItems(
        tx,
        query({ missing: { mode: "language", language: "ca" } }),
        context,
      );
      const en = await listTranslationItems(
        tx,
        query({ missing: { mode: "language", language: "en" } }),
        context,
      );
      const all = await listTranslationItems(tx, query({ missing: { mode: "all" } }), context);
      expect(any.rows.map((r) => [r.kind, r.id])).toEqual([["product", ids.product]]);
      expect(ca.rows.map((r) => [r.kind, r.id])).toEqual([["product", ids.product]]);
      expect(en.rows).toEqual([]);
      expect(all.rows.map((r) => r.kind)).toEqual(["product", "menu"]);
      expect(any.rows[0]!.cells.map((c) => [c.language, c.field, c.text])).toEqual([
        ["en", "name", "CLIENT Bread"],
      ]);
    });
  });

  it("looks ahead at row 51 and binds advancing cursors to normalized filters and settings", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
      await tx.insert(units).values(
        Array.from({ length: 51 }, (_, i) => ({
          id: `unit-${String(i).padStart(2, "0")}`,
          staffName: `Staff ${i}`,
          staffAbbreviation: `u${i}`,
          name: {},
          abbreviation: {},
          precision: 0,
        })),
      );
      const first = await listTranslationItems(
        tx,
        query({ kind: "unit", search: " Staff " }),
        context,
      );
      expect(first.rows.map((r) => r.id)).toEqual(
        Array.from({ length: 50 }, (_, i) => `unit-${String(i).padStart(2, "0")}`),
      );
      expect(first.total).toBe(51);
      expect(first.next).toEqual(expect.any(String));
      const second = await listTranslationItems(
        tx,
        query({ kind: "unit", search: "Staff", after: first.next }),
        context,
      );
      expect(second.rows.map((r) => r.id)).toEqual(["unit-50"]);
      expect(second.total).toBe(51);
      expect(second.next).toBeNull();
      const fullFinal = await listTranslationItems(
        tx,
        query({
          kind: "unit",
          search: "Staff",
          after: JSON.stringify({
            ...JSON.parse(first.next!),
            last: { kind: "unit", id: "unit-00" },
          }),
        }),
        context,
      );
      expect(fullFinal.rows).toHaveLength(50);
      expect(fullFinal.next).toBeNull();
    });
  });

  it("projects languages 1, 100 and 200 from a 200-language unit without returning its other values", async () => {
    await withTransaction(suite.db, async (tx) => {
      const languages = contentLanguageChoices("en")
        .slice(0, 200)
        .map(({ code }) => code);
      expect(languages).toHaveLength(200);
      await writeContentLanguages(tx, { defaultLanguage: languages[0]!, languages });
      await tx.insert(units).values({
        id: "u",
        staffName: "Kilogramo",
        staffAbbreviation: "kg",
        name: Object.fromEntries(languages.map((l, i) => [l, `name-${i}`])),
        abbreviation: Object.fromEntries(languages.map((l, i) => [l, `abbr-${i}`])),
        precision: 3,
      });
      const execute = vi.spyOn(tx, "execute");
      try {
        const page = await listTranslationItems(
          tx,
          {
            languages: [languages[0]!, languages[99]!, languages[199]!],
            missing: { mode: "all" },
            kind: "unit",
          },
          { fallbackLanguage: languages[0]!, required: [] },
        );
        expect(page.rows[0]!.cells.map((c) => [c.language, c.field, c.text, c.staffText])).toEqual([
          [languages[0]!, "name", "name-0", "Kilogramo"],
          [languages[0]!, "abbreviation", "abbr-0", "kg"],
          [languages[99]!, "name", "name-99", "Kilogramo"],
          [languages[99]!, "abbreviation", "abbr-99", "kg"],
          [languages[199]!, "name", "name-199", "Kilogramo"],
          [languages[199]!, "abbreviation", "abbr-199", "kg"],
        ]);
        expect(execute).toHaveBeenCalledTimes(4);
        const outputs = await Promise.all(execute.mock.results.map((r) => r.value));
        expect(JSON.stringify(outputs)).not.toContain("name-150");
        expect(JSON.stringify(outputs)).not.toContain("abbr-150");
        expect(JSON.stringify(page)).not.toContain("name-150");
        expect(page.config.languages).toHaveLength(200);
      } finally {
        execute.mockRestore();
      }
    });
  });

  it("searches staff and projected entered text without searching other language columns", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, search: "bReAd", kind: "product" }),
            context,
          )
        ).rows.map((r) => r.id),
      ).toEqual([ids.product]);
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, search: "UNPROJECTED" }),
            context,
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, search: "CLIENT", kind: "product" }),
            context,
          )
        ).rows.map((r) => r.id),
      ).toEqual([ids.product]);
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, search: "MENÚ", kind: "menu" }),
            context,
          )
        ).rows.map((r) => r.kind),
      ).toEqual(["menu"]);
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, search: "' OR 1=1 --" }),
            context,
          )
        ).rows,
      ).toEqual([]);
    });
  });

  it("preserves accent-insensitive multiword search on bounded pages, with trimmed queries and kind/id ordering", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
      await tx.insert(units).values([
        {
          id: "search-1",
          staffName: "Croquetas de jamón ibérico",
          staffAbbreviation: "cr",
          name: {},
          abbreviation: {},
          precision: 0,
        },
        {
          id: "search-2",
          staffName: "Jamón serrano",
          staffAbbreviation: "js",
          name: {},
          abbreviation: {},
          precision: 0,
        },
        {
          id: "search-3",
          staffName: "Pan",
          staffAbbreviation: "p",
          name: {},
          abbreviation: {},
          precision: 0,
        },
      ]);
      for (const [search, expected] of [
        ["IBERICO jamon", ["search-1"]],
        ["jam", ["search-1", "search-2"]],
        ["jam ", ["search-1", "search-2"]],
        ["&", []],
        ["   ", ["search-1", "search-2", "search-3"]],
      ] as const) {
        const page = await listTranslationItems(tx, query({ kind: "unit", search }), context);
        expect(page.rows.map((row) => row.id)).toEqual(expected);
        expect(page.total).toBe(expected.length);
        expect(page.next).toBeNull();
      }
    });
  });

  it("includes complete waiting-fix rows without changing discovery eligibility", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const ids = await fixture(tx);
      const [other] = await tx
        .insert(units)
        .values({
          staffName: "Other",
          staffAbbreviation: "o",
          name: {},
          abbreviation: {},
          precision: 0,
        })
        .returning();
      await tx.insert(contentSuggestions).values([
        {
          kind: "product",
          itemId: ids.product,
          language: "en",
          fixField: "en",
          fixWrong: "CLIENT Bread",
          fixRight: "CLIENT Loaf",
        },
        { kind: "unit", itemId: other!.id, placeholder: true },
      ]);
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, waitingFixes: true }),
            context,
          )
        ).rows.map((r) => [r.kind, r.id]),
      ).toEqual([
        ["product", ids.product],
        ["unit", other!.id],
      ]);
      await tx.update(products).set({ active: false }).where(eq(products.id, ids.product));
      expect(
        (
          await listTranslationItems(
            tx,
            query({ missing: { mode: "all" }, waitingFixes: true }),
            context,
          )
        ).rows.map((r) => r.kind),
      ).toEqual(["unit"]);
      const direct = await listTranslationItems(
        tx,
        {
          languages: ["en"],
          targets: [
            { kind: "product", id: ids.product },
            { kind: "unit", id: "gone" },
          ],
        },
        context,
      );
      expect(
        direct.rows.map((r) => [r.id, r.cells[0]!.eligible, r.cells[0]!.unavailableReason]),
      ).toEqual([
        [ids.product, true, null],
        ["gone", false, "missing"],
      ]);
    });
  });

  it("accepts eight columns and fifty direct unit rows, and refuses a ninth column or fifty-first target", async () => {
    const languages = contentLanguageChoices("en")
      .slice(0, 9)
      .map(({ code }) => code);
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: languages[0]!, languages });
      await tx.insert(units).values(
        Array.from({ length: 50 }, (_, i) => ({
          id: `u-${i}`,
          staffName: `Staff ${i}`,
          staffAbbreviation: `u${i}`,
          name: {},
          abbreviation: {},
          precision: 0,
        })),
      );
    });
    const targets = Array.from({ length: 50 }, (_, i) => ({ kind: "unit" as const, id: `u-${i}` }));
    const accepted: TranslationQuery = { languages: languages.slice(0, 8), targets };
    const page = await withTransaction(suite.db, (tx) =>
      listTranslationItems(tx, accepted, { fallbackLanguage: languages[0]!, required: [] }),
    );
    expect(page.rows.map((r) => r.id)).toEqual(targets.map((r) => r.id));
    expect(
      page.rows.every((r) => r.cells.length === 16 && r.cells.every((c) => c.text === null)),
    ).toBe(true);
    expect(page.rows[49]!.cells.slice(-2).map((c) => [c.field, c.staffText])).toEqual([
      ["name", "Staff 49"],
      ["abbreviation", "u49"],
    ]);
    expect(page.total).toBe(50);
    expect(page.next).toBeNull();
    for (const invalid of [
      { ...accepted, languages },
      { ...accepted, targets: [...targets, { kind: "unit", id: "u-50" }] },
      { ...accepted, targets: [targets[0], targets[0]] },
      { ...accepted, targets: [{ kind: "unit", id: " " }] },
      { ...accepted, targets: [{ kind: "unit", id: "u", extra: true }] },
      { ...accepted, languages: ["fr"] },
    ])
      await expect(
        withTransaction(suite.db, (tx) =>
          listTranslationItems(tx, invalid as TranslationQuery, context),
        ),
      ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it.each([
    { languages: [] },
    { languages: Array(9).fill("en") },
    { languages: ["en", "en"] },
    { languages: ["en-GB"] },
    { languages: ["fr"] },
    { missing: { mode: "language", language: "fr" } },
    { missing: { mode: "any", language: "en" } },
    { missing: { mode: "other" } },
    { kind: "other" },
    { search: "x".repeat(201) },
    { after: "{}" },
    { after: "not-json" },
    { waitingFixes: true },
    { extra: true },
    { targets: [] },
    { targets: [{ kind: "unit", id: "u" }], after: "x" },
  ])("rejects malformed or incompatible page query %#", async (extra) => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, fixture);
    await expect(
      withTransaction(suite.db, (tx) =>
        listTranslationItems(tx, query(extra) as TranslationQuery, context),
      ),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
  });

  it("rejects cursor reuse after filter, projection, configuration or cursor-shape changes", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, fixture);
    await withTransaction(suite.db, (tx) =>
      tx.insert(units).values(
        Array.from({ length: 51 }, (_, i) => ({
          id: `u${i}`,
          staffName: "Unit",
          staffAbbreviation: "u",
          name: {},
          abbreviation: {},
          precision: 0,
        })),
      ),
    );
    const first = await withTransaction(suite.db, (tx) =>
      listTranslationItems(tx, query({ kind: "unit" }), context),
    );
    const savedCursor = JSON.parse(first.next!);
    const reordered = JSON.stringify({
      last: { id: savedCursor.last.id, kind: savedCursor.last.kind },
      filter: {
        waitingFixes: savedCursor.filter.waitingFixes,
        search: savedCursor.filter.search,
        kind: savedCursor.filter.kind,
        missing: savedCursor.filter.missing,
        languages: savedCursor.filter.languages,
      },
      configuration: savedCursor.configuration,
    });
    expect(
      (
        await withTransaction(suite.db, (tx) =>
          listTranslationItems(tx, query({ kind: "unit", after: reordered }), context),
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      withTransaction(suite.db, (tx) =>
        listTranslationItems(tx, query({ kind: "unit", after: first.next }), {
          ...context,
          required: ["es", "ca"],
        }),
      ),
    ).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { scope: "configuration" },
    });
    const selectedLanguage = await withTransaction(suite.db, (tx) =>
      listTranslationItems(
        tx,
        query({ kind: "unit", missing: { mode: "language", language: "ca" } }),
        context,
      ),
    );

    for (const extra of [
      { kind: "product" },
      { languages: ["es"] },
      { missing: { mode: "all" } },
      { search: "Unit" },
      { after: JSON.stringify({ ...JSON.parse(first.next!), extra: true }) },
    ]) {
      await expect(
        withTransaction(suite.db, (tx) =>
          listTranslationItems(tx, query({ kind: "unit", after: first.next, ...extra }), context),
        ),
      ).rejects.toMatchObject({ code: "content.translation_invalid" });
    }
    await withTransaction(suite.db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["es", "en", "ca"] }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        listTranslationItems(tx, query({ kind: "unit", after: first.next }), context),
      ),
    ).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { scope: "configuration" },
    });
    await withTransaction(suite.db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "ca"] }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        listTranslationItems(tx, query({ kind: "unit", after: first.next }), context),
      ),
    ).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { scope: "configuration" },
    });
    await withTransaction(suite.db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        listTranslationItems(
          tx,
          query({
            kind: "unit",
            missing: { mode: "language", language: "ca" },
            after: selectedLanguage.next,
          }),
          context,
        ),
      ),
    ).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { scope: "configuration" },
    });
  });
});
