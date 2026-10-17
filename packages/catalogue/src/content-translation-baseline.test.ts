import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { contentLanguageChoices } from "@waitron/shared";
import { CORE_MIGRATIONS, products, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { writeContentLanguages } from "./content-languages.js";
import { createCatalogue, createProduct } from "./operations.js";
import { addMember } from "./sections.js";
import { menuDetails } from "./schema/menu.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { units } from "./schema/units.js";
import { resolveTranslationCells } from "./content-translation-cells.js";
import {
  parseTranslationBaseline,
  sameTranslationBaseline,
  projectTranslationBaselines,
} from "./content-translation-baseline.js";
import type { TranslationCellRef } from "./content-translation-types.js";

type Edit = TranslationCellRef & { expected: string; text: string | null };
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "es", required: ["es"] };
function baseline() {
  return {
    ref: { kind: "product", id: "p" },
    language: "en",
    field: "name",
    owners: { kind: "product", parentId: null },
    structure: {
      role: "product",
      active: true,
      ownerActive: true,
      rootMatched: true,
      parentRole: null,
      childActive: true,
    },
    selectedText: "Bread",
    defaultText: "Pan",
    inheritedSelectedText: null,
    inheritedDefaultText: null,
    effectiveSelectedText: "Bread",
    effectiveDefaultText: "Pan",
    config: { defaultLanguage: "es", languages: ["es", "en", "ca"] },
    required: ["es", "ca"],
  };
}
function edit(value: unknown = baseline(), ref: Partial<TranslationCellRef> = {}): Edit {
  return {
    kind: "product",
    id: "p",
    language: "en",
    field: "name",
    ...ref,
    expected: typeof value === "string" ? value : JSON.stringify(value),
    text: "New bread",
  };
}

describe("translation cell baseline validation", () => {
  it("canonicalizes language sets without changing or mutating other saved facts", () => {
    const input = edit();
    const saved = input.expected;
    expect(parseTranslationBaseline(input)).toEqual({
      ...baseline(),
      config: { defaultLanguage: "es", languages: ["ca", "en", "es"] },
      required: ["ca", "es"],
    });
    expect(input.expected).toBe(saved);
  });

  it("retains literal blanks and accepts empty required languages and all 200 enabled languages", () => {
    const languages = [
      "es",
      ...contentLanguageChoices("en")
        .map(({ code }) => code)
        .filter((code) => code !== "es")
        .slice(0, 199),
    ];
    const b = {
      ...baseline(),
      selectedText: " \t ",
      defaultText: null,
      inheritedSelectedText: "Inherited",
      effectiveSelectedText: " \t ",
      effectiveDefaultText: null,
      config: { defaultLanguage: "es", languages },
      required: [],
    };
    expect(parseTranslationBaseline(edit(b))).toEqual({
      ...b,
      config: { ...b.config, languages: [...languages].sort() },
    });
  });

  const malformed: [string, (value: ReturnType<typeof baseline>) => unknown][] = [
    ["unknown top key", (b) => ({ ...b, extra: true })],
    [
      "missing top key",
      (b) => {
        return Object.fromEntries(Object.entries(b).filter(([key]) => key !== "selectedText"));
      },
    ],
    ["wrong ref", (b) => ({ ...b, ref: { kind: "product", id: "other" } })],
    ["wrong kind", (b) => ({ ...b, ref: { kind: "unit", id: "p" } })],
    ["extra ref key", (b) => ({ ...b, ref: { ...b.ref, extra: true } })],
    ["wrong language", (b) => ({ ...b, language: "ca" })],
    ["noncanonical language", (b) => ({ ...b, language: "en-us" })],
    ["wrong field", (b) => ({ ...b, field: "abbreviation" })],
    ["invalid text", (b) => ({ ...b, selectedText: 1 })],
    ["array owner", (b) => ({ ...b, owners: [] })],
    ["null owner", (b) => ({ ...b, owners: null })],
    ["wrong owner kind", (b) => ({ ...b, owners: { kind: "unit" } })],
    [
      "shape-compatible wrong owner kind",
      (b) => ({ ...b, owners: { kind: "variant", parentId: null } }),
    ],
    ["product parent", (b) => ({ ...b, owners: { kind: "product", parentId: "parent" } })],
    ["extra owner key", (b) => ({ ...b, owners: { ...b.owners, extra: true } })],
    ["nonboolean activity", (b) => ({ ...b, structure: { ...b.structure, active: 1 } })],
    ["invalid role", (b) => ({ ...b, structure: { ...b.structure, role: false } })],
    ["missing structure", (b) => ({ ...b, structure: null })],
    ["unknown structure key", (b) => ({ ...b, structure: { ...b.structure, extra: true } })],
    ["invalid default", (b) => ({ ...b, config: { ...b.config, defaultLanguage: "en-us" } })],
    ["default outside set", (b) => ({ ...b, config: { ...b.config, defaultLanguage: "fr" } })],
    ["invalid language set", (b) => ({ ...b, config: { ...b.config, languages: ["es", 3] } })],
    [
      "duplicate enabled language",
      (b) => ({ ...b, config: { ...b.config, languages: ["es", "es"] } }),
    ],
    ["extra config key", (b) => ({ ...b, config: { ...b.config, extra: true } })],
    ["invalid required language", (b) => ({ ...b, required: ["!"] })],
    ["duplicate required language", (b) => ({ ...b, required: ["es", "es"] })],
    [
      "too many languages",
      (b) => ({
        ...b,
        config: {
          ...b.config,
          languages: [
            "es",
            ...contentLanguageChoices("en")
              .map(({ code }) => code)
              .filter((code) => code !== "es")
              .slice(0, 200),
          ],
        },
      }),
    ],
  ];
  it.each(malformed)("refuses %s with the domain code", (_name, mutate) => {
    expect(() => parseTranslationBaseline(edit(mutate(baseline())))).toThrowError(
      expect.objectContaining({ code: "content.translation_batch_invalid", params: {} }),
    );
  });
  it.each(["{", "null", "[]", "1"])("refuses non-object token %s", (token) => {
    expect(() => parseTranslationBaseline(edit(token))).toThrowError(
      expect.objectContaining({ code: "content.translation_batch_invalid", params: {} }),
    );
  });
  it.each([
    { kind: "product", id: "p", language: "en", field: "abbreviation" },
    { kind: "other", id: "p", language: "en", field: "name" },
    { kind: "product", id: " ", language: "en", field: "name" },
  ])("refuses an invalid cell identity %#", (ref) => {
    const b = baseline();
    expect(() =>
      parseTranslationBaseline(
        edit(
          { ...b, ref: { kind: ref.kind, id: ref.id }, field: ref.field },
          ref as TranslationCellRef,
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: "content.translation_batch_invalid" }));
  });

  it.each([
    ["product", { kind: "product", parentId: null }],
    ["variant", { kind: "variant", parentId: "parent" }],
    ["option_list", { kind: "option_list" }],
    ["option_label", { kind: "option_label", listId: "list" }],
    ["extra_list", { kind: "extra_list" }],
    ["menu", { kind: "menu", menuId: "menu", rootId: "root" }],
    ["section", { kind: "section", menuId: "menu" }],
    [
      "included_menu",
      {
        kind: "included_menu",
        menuId: "menu",
        sectionId: "section",
        includedMenuId: "child",
        includedRootId: "root",
      },
    ],
    ["unit", { kind: "unit" }],
  ] as const)(
    "keeps %s ownership facts and refuses a missing or blank owner member",
    (kind, owners) => {
      const b = { ...baseline(), ref: { kind, id: "p" }, owners };
      expect(parseTranslationBaseline(edit(b, { kind })).owners).toEqual(owners);
      const changed = Object.fromEntries(Object.entries(owners).filter(([key]) => key !== "kind"));
      expect(() =>
        parseTranslationBaseline(edit({ ...b, owners: changed }, { kind })),
      ).toThrowError(expect.objectContaining({ code: "content.translation_batch_invalid" }));
      for (const key of Object.keys(owners).filter((key) => key !== "kind"))
        expect(() =>
          parseTranslationBaseline(edit({ ...b, owners: { ...owners, [key]: " " } }, { kind })),
        ).toThrowError(expect.objectContaining({ code: "content.translation_batch_invalid" }));
    },
  );

  it("compares objects by facts rather than serialization order while retaining every fact", () => {
    const a = parseTranslationBaseline(edit());
    const reordered = Object.fromEntries(Object.entries(baseline()).reverse());
    reordered.config = { languages: ["ca", "en", "es"], defaultLanguage: "es" };
    const b = parseTranslationBaseline(edit(reordered));
    expect(sameTranslationBaseline(a, b)).toBe(true);
    for (const [key, value] of [
      ["selectedText", null],
      ["defaultText", "Other"],
      ["inheritedSelectedText", "Inherited"],
      ["inheritedDefaultText", "Otro"],
      ["effectiveSelectedText", "Other"],
      ["effectiveDefaultText", "Otro"],
      ["owners", { kind: "product", parentId: "changed" }],
      ["structure", { ...a.structure, active: false }],
      ["config", { defaultLanguage: "en", languages: ["ca", "en", "es"] }],
      ["required", ["es"]],
      ["language", "ca"],
      ["field", "abbreviation"],
      ["ref", { kind: "product", id: "other" }],
    ])
      expect(sameTranslationBaseline(a, { ...a, [key as string]: value })).toBe(false);
  });
});

describe("translation peer baseline projection", () => {
  it("projects both languages and a cleared default without mutating submitted baselines", () => {
    const en = edit();
    const es = edit(
      { ...baseline(), language: "es", selectedText: "Pan", effectiveSelectedText: "Pan" },
      { language: "es" },
    );
    es.text = null;
    const edits = [en, es];
    const bases = edits.map(parseTranslationBaseline);
    const before = JSON.stringify(bases);
    expect(projectTranslationBaselines(bases, edits)).toEqual([
      {
        ...bases[0],
        selectedText: "New bread",
        defaultText: null,
        effectiveSelectedText: "New bread",
        effectiveDefaultText: null,
      },
      {
        ...bases[1],
        selectedText: null,
        defaultText: null,
        effectiveSelectedText: null,
        effectiveDefaultText: null,
      },
    ]);
    expect(JSON.stringify(bases)).toBe(before);
  });

  it("projects a cleared inherited root and retains unrelated identity and field facts", () => {
    const include = parseTranslationBaseline(
      edit(
        {
          ...baseline(),
          ref: { kind: "included_menu", id: "folder" },
          owners: {
            kind: "included_menu",
            menuId: "menu",
            sectionId: "section",
            includedMenuId: "child",
            includedRootId: "root",
          },
          selectedText: null,
          defaultText: null,
          inheritedSelectedText: "Inherited",
          inheritedDefaultText: "Heredado",
          effectiveSelectedText: "Inherited",
          effectiveDefaultText: "Heredado",
        },
        { kind: "included_menu", id: "folder" },
      ),
    );
    const root: Edit = {
      kind: "menu",
      id: "root",
      language: "en",
      field: "name",
      expected: "unused",
      text: null,
    };
    const defaultRoot = { ...root, language: "es", text: null };
    const unrelated = { ...root, kind: "product" as const, text: "Wrong kind" };
    const unitName = parseTranslationBaseline(
      edit(
        { ...baseline(), ref: { kind: "unit", id: "root" }, owners: { kind: "unit" } },
        { kind: "unit", id: "root" },
      ),
    );
    const abbreviation = {
      ...root,
      kind: "unit" as const,
      field: "abbreviation" as const,
      text: "Wrong field",
    };
    expect(
      projectTranslationBaselines(
        [include, unitName],
        [unrelated, abbreviation, defaultRoot, root],
      ),
    ).toEqual([
      {
        ...include,
        inheritedSelectedText: null,
        inheritedDefaultText: null,
        effectiveSelectedText: null,
        effectiveDefaultText: null,
      },
      unitName,
    ]);
  });

  it.each([false, true])(
    "matches real root/include and unit rereads in either batch order (reversed=%s)",
    async (reverse) => {
      await seedTenant(suite.db);
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "ca"] });
        const parent = await createCatalogue(tx, {
          name: "STAFF Parent",
          names: { es: "CLIENT Padre" },
        });
        const child = await createCatalogue(tx, {
          name: "STAFF Child",
          names: { es: "CLIENT Antes", en: "CLIENT Before", ca: "CLIENT Abans" },
        });
        const roots = await tx.select().from(menuDetails);
        const parentRoot = roots.find((r) => r.menuId === parent.id)!.rootSectionId;
        const childRoot = roots.find((r) => r.menuId === child.id)!.rootSectionId;
        const member = await addMember(tx, parentRoot, { kind: "section", sectionId: childRoot });
        await tx
          .update(sectionMembers)
          .set({ folderOverrides: { names: { en: "CLIENT Folder" }, color: "red" } })
          .where(eq(sectionMembers.id, member.id));
        const [unit] = await tx
          .insert(units)
          .values({
            staffName: "STAFF Kilogram",
            staffAbbreviation: "STAFF kg",
            name: { es: "CLIENT Kilogramo", en: "CLIENT Kilogram" },
            abbreviation: { es: "kg", en: "kg" },
            precision: 3,
          })
          .returning();
        const product = await createProduct(tx, {
          catalogueId: parent.id,
          categoryId: null,
          name: "STAFF Bread",
          kitchenName: "KITCHEN Bread",
          customerName: { es: "CLIENT Pan", en: "CLIENT Bread" },
          unitPrice: "3.00",
          pricingUnit: "each",
          vatClass: "reduced",
        });
        const entries: (TranslationCellRef & { text: string | null })[] = [
          { kind: "included_menu", id: member.id, language: "en", field: "name", text: null },
          { kind: "menu", id: childRoot, language: "es", field: "name", text: "CLIENT Nuevo" },
          { kind: "menu", id: childRoot, language: "en", field: "name", text: "CLIENT New" },
          {
            kind: "included_menu",
            id: member.id,
            language: "ca",
            field: "name",
            text: "CLIENT Carpeta",
          },
          { kind: "unit", id: unit!.id, language: "en", field: "name", text: "CLIENT New unit" },
          { kind: "unit", id: unit!.id, language: "es", field: "abbreviation", text: null },
          { kind: "unit", id: unit!.id, language: "en", field: "abbreviation", text: "CLIENT kg" },
          {
            kind: "product",
            id: product.id,
            language: "en",
            field: "name",
            text: "CLIENT New bread",
          },
        ];
        if (reverse) entries.reverse();
        const refs = entries.map(({ kind, id, language, field }) => ({
          kind,
          id,
          language,
          field,
        }));
        const before = await resolveTranslationCells(tx, refs, context);
        const edits = entries.map((e, i) => ({ ...e, expected: before.cells[i]!.expected }));
        const bases = edits.map(parseTranslationBaseline);
        const projected = projectTranslationBaselines(bases, edits);
        await tx
          .update(sections)
          .set({ names: { es: "CLIENT Nuevo", en: "CLIENT New", ca: "CLIENT Abans" } })
          .where(eq(sections.id, childRoot));
        await tx
          .update(sectionMembers)
          .set({ folderOverrides: { names: { ca: "CLIENT Carpeta" }, color: "red" } })
          .where(eq(sectionMembers.id, member.id));
        await tx
          .update(units)
          .set({
            name: { es: "CLIENT Kilogramo", en: "CLIENT New unit" },
            abbreviation: { en: "CLIENT kg" },
          })
          .where(eq(units.id, unit!.id));
        await tx
          .update(products)
          .set({ customerName: { es: "CLIENT Pan", en: "CLIENT New bread" } })
          .where(eq(products.id, product.id));
        const after = await resolveTranslationCells(tx, refs, context);
        expect(projected).toEqual(
          after.cells.map((c, i) =>
            parseTranslationBaseline({ ...edits[i]!, expected: c.expected }),
          ),
        );
        const include = after.cells.find((c) => c.kind === "included_menu" && c.language === "en")!;
        expect(include).toMatchObject({
          text: null,
          inheritedText: "CLIENT New",
          effectiveText: "CLIENT New",
          defaultText: null,
          inheritedDefaultText: "CLIENT Nuevo",
          effectiveDefaultText: "CLIENT Nuevo",
        });
        const includeCa = projected.find(
          (b) => b.ref.kind === "included_menu" && b.language === "ca",
        )!;
        expect(includeCa).toMatchObject({
          selectedText: "CLIENT Carpeta",
          inheritedSelectedText: "CLIENT Abans",
          inheritedDefaultText: "CLIENT Nuevo",
          effectiveDefaultText: "CLIENT Nuevo",
        });
        expect(projected.find((b) => b.ref.kind === "unit" && b.field === "name")).toMatchObject({
          defaultText: "CLIENT Kilogramo",
        });
        expect(
          projected.find(
            (b) => b.ref.kind === "unit" && b.language === "en" && b.field === "abbreviation",
          ),
        ).toMatchObject({ defaultText: null, effectiveDefaultText: null });
        expect(projected.find((b) => b.ref.kind === "product")).toMatchObject({
          defaultText: "CLIENT Pan",
        });
        expect(projected.some((b, i) => sameTranslationBaseline(b, bases[i]!))).toBe(false);
      });
    },
  );
});
