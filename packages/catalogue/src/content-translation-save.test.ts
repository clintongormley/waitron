import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { contentLanguageChoices } from "@waitron/shared";
import {
  CORE_MIGRATIONS,
  catalogues,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationCells } from "./content-translation-cells.js";
import { saveContentTranslations } from "./content-translations.js";
import { addMember } from "./sections.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { menuDetails, contentLanguages } from "./schema/menu.js";
import { units } from "./schema/units.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { contentSuggestions } from "./schema/suggestions.js";
import type { TranslationCellEdit, TranslationCellRef } from "./content-translation-types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "es", required: ["es"] };
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const kinds = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
] as const;
async function fixture() {
  await seedTenant(suite.db);
  return app(async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en", "ca"] });
    const menu = await createCatalogue(tx, { name: "STAFF menu", names: { es: "CLIENT menu" } });
    const child = await createCatalogue(tx, {
      name: "STAFF child",
      names: { es: "CLIENT root", en: "CLIENT root" },
    });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      unitId: null,
      name: "STAFF bread",
      kitchenName: "KITCHEN bread",
      customerName: { es: "CLIENT ES bread", en: "CLIENT bread", fr: "CLIENT pain" },
      unitPrice: "3.00",
      vatClass: "reduced",
    });
    const [variant] = await tx
      .insert(products)
      .values({
        catalogueId: menu.id,
        parentId: product.id,
        name: "STAFF small",
        kitchenName: "KITCHEN small",
        customerName: { es: "CLIENT small" },
      })
      .returning();
    const [list] = await tx
      .insert(optionLists)
      .values({ name: "STAFF option", customerName: { es: "CLIENT option" } })
      .returning();
    const [label] = await tx
      .insert(optionLabels)
      .values({ listId: list!.id, name: "STAFF label", customerName: { es: "CLIENT etiqueta" } })
      .returning();
    const [extra] = await tx
      .insert(extraLists)
      .values({ name: "STAFF extra", customerName: { es: "CLIENT extra" } })
      .returning();
    const roots = await tx.select().from(menuDetails);
    const root = roots.find((r) => r.menuId === menu.id)!.rootSectionId;
    const childRoot = roots.find((r) => r.menuId === child.id)!.rootSectionId;
    const [section] = await tx
      .insert(sections)
      .values({
        internalName: "STAFF section",
        ownerMenuId: menu.id,
        names: { es: "CLIENT section" },
      })
      .returning();
    const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
    await tx
      .update(sectionMembers)
      .set({
        showAsFolder: false,
        folderOverrides: {
          names: { en: "CLIENT override" },
          color: "preserved-colour",
          image: null,
        },
      })
      .where(eq(sectionMembers.id, member.id));
    const [unit] = await tx
      .insert(units)
      .values({
        staffName: "STAFF kilogram",
        staffAbbreviation: "kg-staff",
        name: { es: "CLIENT kilogram", fr: "CLIENT kilo" },
        abbreviation: { es: "kg", fr: "kilo" },
        precision: 3,
        seedKey: "kilogram",
        hardwareUnit: "kg",
      })
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
      childRoot,
      menuId: menu.id,
      childMenuId: child.id,
    };
  });
}
async function edits(
  refs: TranslationCellRef[],
  text: string | null = " New text ",
): Promise<TranslationCellEdit[]> {
  const { cells } = await app((tx) => resolveTranslationCells(tx, refs, context));
  return cells.map(({ kind, id, language, field, expected }) => ({
    kind,
    id,
    language,
    field,
    expected,
    text,
  }));
}
function ref(
  kind: TranslationCellRef["kind"],
  id: string,
  language = "en",
  field: TranslationCellRef["field"] = "name",
): TranslationCellRef {
  return { kind, id, language, field };
}
async function snapshot() {
  return app(async (tx) => ({
    products: await tx.select().from(products).orderBy(products.id),
    options: await tx.select().from(optionLists).orderBy(optionLists.id),
    labels: await tx.select().from(optionLabels).orderBy(optionLabels.id),
    extras: await tx.select().from(extraLists).orderBy(extraLists.id),
    units: await tx.select().from(units).orderBy(units.id),
    sections: await tx.select().from(sections).orderBy(sections.id),
    members: await tx.select().from(sectionMembers).orderBy(sectionMembers.id),
    suggestions: await tx.select().from(contentSuggestions).orderBy(contentSuggestions.id),
  }));
}
const save = (batch: { edits: TranslationCellEdit[] }) =>
  app((tx) => saveContentTranslations(tx, batch, context));

describe("atomic multilingual cell saves", () => {
  it("saves two languages on one item and removes the last enabled keys without losing disabled text", async () => {
    const ids = await fixture();
    const batch = {
      edits: await edits(
        [ref("product", ids.product, "en"), ref("product", ids.product, "es")],
        null,
      ),
    };
    const reply = await save(batch);
    expect(reply.saved.map((c) => [c.language, c.text, c.defaultText])).toEqual([
      ["en", null, null],
      ["es", null, null],
    ]);
    const [row] = await suite.db.select().from(products).where(eq(products.id, ids.product));
    expect(row).toMatchObject({
      customerName: { fr: "CLIENT pain" },
      name: "STAFF bread",
      kitchenName: "KITCHEN bread",
    });
    expect(await save(batch)).toEqual(reply);
  });
  it.each(kinds)("%s writes final maps without a required default companion", async (kind) => {
    const ids = await fixture();
    const batch = {
      edits: await edits([ref(kind, ids[kind], "es"), ref(kind, ids[kind], "en")], null),
    };
    const reply = await save(batch);
    expect(reply.saved.map((c) => c.text)).toEqual([null, null]);
    const reread = await app((tx) =>
      resolveTranslationCells(
        tx,
        batch.edits.map(({ kind, id, language, field }) => ({ kind, id, language, field })),
        context,
      ),
    );
    expect(reread.cells).toEqual(reply.saved);
    if (["product", "variant", "option_list", "option_label", "extra_list"].includes(kind)) {
      const table =
        kind === "product" || kind === "variant"
          ? products
          : kind === "option_list"
            ? optionLists
            : kind === "option_label"
              ? optionLabels
              : extraLists;
      const [row] = await suite.db
        .select({ customerName: table.customerName })
        .from(table)
        .where(eq(table.id, ids[kind]));
      expect(row!.customerName).toEqual(kind === "product" ? { fr: "CLIENT pain" } : null);
    }
  });
  it("groups both unit fields into one row replacement, preserving precision, staff and unedited languages", async () => {
    const ids = await fixture();
    const batch = {
      edits: await edits([
        ref("unit", ids.unit, "es"),
        ref("unit", ids.unit, "en", "abbreviation"),
        ref("unit", ids.unit, "es", "abbreviation"),
      ]),
    };
    batch.edits[0]!.text = null;
    batch.edits[1]!.text = " kg-en ";
    batch.edits[2]!.text = null;
    await app(async (tx) => {
      const update = vi.spyOn(tx, "update");
      try {
        await saveContentTranslations(tx, batch, context);
        expect(update).toHaveBeenCalledTimes(1);
      } finally {
        update.mockRestore();
      }
    });
    const [row] = await suite.db.select().from(units).where(eq(units.id, ids.unit));
    expect(row).toMatchObject({
      name: { fr: "CLIENT kilo" },
      abbreviation: { en: "kg-en", fr: "kilo" },
      staffName: "STAFF kilogram",
      staffAbbreviation: "kg-staff",
      precision: 3,
    });
  });
  it.each([false, true])(
    "uses the final inherited root in either batch order (reverse=%s) and retries exactly",
    async (reverse) => {
      const ids = await fixture();
      const batch = {
        edits: await edits([
          ref("menu", ids.childRoot, "es"),
          ref("included_menu", ids.included_menu, "en"),
        ]),
      };
      batch.edits[0]!.text = "New root";
      batch.edits[1]!.text = null;
      if (reverse) batch.edits.reverse();
      const reply = await save(batch);
      const cell = reply.saved.find((c) => c.kind === "included_menu")!;
      expect(cell).toMatchObject({
        text: null,
        effectiveText: "CLIENT root",
        defaultText: null,
        inheritedDefaultText: "New root",
        effectiveDefaultText: "New root",
      });
      expect(JSON.parse(cell.expected)).toMatchObject({
        selectedText: null,
        inheritedDefaultText: "New root",
        effectiveDefaultText: "New root",
      });
      expect(await save(batch)).toEqual(reply);
      const [row] = await suite.db
        .select()
        .from(sectionMembers)
        .where(eq(sectionMembers.id, ids.included_menu));
      expect(row!.folderOverrides).toEqual({ names: {}, color: "preserved-colour", image: null });
      expect(row!.showAsFolder).toBe(false);
    },
  );
  it("refuses a whole-batch old/final mixture while accepting a fully final exact retry", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product), ref("unit", ids.unit)]) };
    await suite.db
      .update(products)
      .set({ customerName: { es: "CLIENT ES bread", en: "New text", fr: "CLIENT pain" } })
      .where(eq(products.id, ids.product));
    const before = await snapshot();
    await expect(save(batch)).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { ...ref("product", ids.product) },
    });
    expect(await snapshot()).toEqual(before);
    await suite.db
      .update(units)
      .set({ name: { es: "CLIENT kilogram", en: "New text", fr: "CLIENT kilo" } })
      .where(eq(units.id, ids.unit));
    expect((await save(batch)).saved.map((c) => c.text)).toEqual(["New text", "New text"]);
  });
  it("refuses an unavailable late member before any map or suggestion changes", async () => {
    const ids = await fixture();
    const batch = {
      edits: await edits([ref("product", ids.product), ref("option_label", ids.option_label)]),
    };
    await suite.db.insert(contentSuggestions).values({
      kind: "product",
      itemId: ids.product,
      language: "en",
      text: "suggested",
      expected: batch.edits[0]!.expected,
    });
    await suite.db
      .update(optionLists)
      .set({ active: false })
      .where(eq(optionLists.id, ids.option_list));
    const before = await snapshot();
    await expect(save(batch)).rejects.toMatchObject({
      code: "content.translation_unavailable",
      params: ref("option_label", ids.option_label),
    });
    expect(await snapshot()).toEqual(before);
  });
  it("cleans only exact saved name suggestions including fixes, preserving abbreviation names, notes and other languages", async () => {
    const ids = await fixture();
    const batch = {
      edits: await edits([
        ref("product", ids.product),
        ref("unit", ids.unit, "en", "abbreviation"),
      ]),
    };
    await suite.db.insert(contentSuggestions).values([
      {
        id: "saved",
        kind: "product",
        itemId: ids.product,
        language: "en",
        text: "suggested",
        expected: batch.edits[0]!.expected,
        fixField: "en",
        fixWrong: "bad",
        fixRight: "good",
      },
      {
        id: "other-language",
        kind: "product",
        itemId: ids.product,
        language: "ca",
        placeholder: true,
      },
      {
        id: "note",
        kind: "product",
        itemId: ids.product,
        language: null,
        fixField: "internal",
        fixWrong: "bad",
        fixRight: "good",
      },
      { id: "unit-name", kind: "unit", itemId: ids.unit, language: "en", placeholder: true },
    ]);
    await save(batch);
    expect(
      (await suite.db.select().from(contentSuggestions).orderBy(contentSuggestions.id)).map(
        (r) => r.id,
      ),
    ).toEqual(["note", "other-language", "unit-name"]);
    await suite.db.insert(contentSuggestions).values({
      id: "retry-saved",
      kind: "product",
      itemId: ids.product,
      language: "en",
      placeholder: true,
    });
    await save(batch);
    expect(
      (await suite.db.select().from(contentSuggestions).orderBy(contentSuggestions.id)).map(
        (r) => r.id,
      ),
    ).toEqual(["note", "other-language", "unit-name"]);
  });
  it.each(["default", "disabled", "added-language", "owner", "activity"])(
    "refuses %s changes with maps intact",
    async (change) => {
      const ids = await fixture();
      const batch = { edits: await edits([ref("option_label", ids.option_label)]) };
      if (change === "owner") {
        const [list] = await suite.db.insert(optionLists).values({ name: "Other" }).returning();
        await suite.db
          .update(optionLabels)
          .set({ listId: list!.id })
          .where(eq(optionLabels.id, ids.option_label));
      } else if (change === "activity")
        await suite.db
          .update(optionLists)
          .set({ active: false })
          .where(eq(optionLists.id, ids.option_list));
      else
        await suite.db
          .update(contentLanguages)
          .set(
            change === "default"
              ? { defaultLanguage: "ca" }
              : change === "disabled"
                ? { languages: ["es", "ca"] }
                : { languages: ["es", "en", "ca", "de"] },
          )
          .where(eq(contentLanguages.id, 1));
      const before = await snapshot();
      await expect(save(batch)).rejects.toMatchObject({
        code:
          change === "activity" || change === "disabled"
            ? "content.translation_unavailable"
            : "content.translation_stale",
        params: ref("option_label", ids.option_label),
      });
      expect(await snapshot()).toEqual(before);
    },
  );
  it("still permits direct archived product and variant translations", async () => {
    const ids = await fixture();
    await suite.db.update(products).set({ active: false }).where(eq(products.id, ids.product));
    await suite.db.update(products).set({ active: false }).where(eq(products.id, ids.variant));
    const batch = {
      edits: await edits([ref("product", ids.product), ref("variant", ids.variant)]),
    };
    expect((await save(batch)).saved.map((c) => [c.kind, c.text, c.eligible])).toEqual([
      ["product", "New text", true],
      ["variant", "New text", true],
    ]);
  });
});

describe("translation cell batch boundaries", () => {
  it.each([
    ["empty", () => ({ edits: [] })],
    ["missing edits", () => ({})],
    ["non-array edits", () => ({ edits: {} })],
    ["extra body key", (e: TranslationCellEdit) => ({ edits: [e], language: "en" })],
    ["duplicate cell", (e: TranslationCellEdit) => ({ edits: [e, e] })],
    ["blank value", (e: TranslationCellEdit) => ({ edits: [{ ...e, text: " \t " }] })],
    ["numeric value", (e: TranslationCellEdit) => ({ edits: [{ ...e, text: 1 }] })],
    [
      "omitted value",
      (e: TranslationCellEdit) => ({
        edits: [Object.fromEntries(Object.entries(e).filter(([key]) => key !== "text"))],
      }),
    ],
    ["extra cell key", (e: TranslationCellEdit) => ({ edits: [{ ...e, extra: true }] })],
    [
      "noncanonical language",
      (e: TranslationCellEdit) => ({ edits: [{ ...e, language: "en-us" }] }),
    ],
    ["bad kind", (e: TranslationCellEdit) => ({ edits: [{ ...e, kind: "constructor" }] })],
    ["blank id", (e: TranslationCellEdit) => ({ edits: [{ ...e, id: " " }] })],
    [
      "abbreviation on product",
      (e: TranslationCellEdit) => ({ edits: [{ ...e, field: "abbreviation" }] }),
    ],
    [
      "wrong expected id",
      (e: TranslationCellEdit) => ({
        edits: [
          {
            ...e,
            expected: JSON.stringify({
              ...JSON.parse(e.expected),
              ref: { kind: "product", id: "other" },
            }),
          },
        ],
      }),
    ],
    ["malformed expected", (e: TranslationCellEdit) => ({ edits: [{ ...e, expected: "{" }] })],
  ] as const)("refuses %s before any query or write", async (_name, mutate) => {
    const ids = await fixture();
    const [e] = await edits([ref("product", ids.product)]);
    const before = await snapshot();
    let reads = 0;
    await expect(
      app(async (tx) => {
        const spy = vi.spyOn(tx, "execute");
        try {
          return await saveContentTranslations(
            tx,
            mutate(e!) as { edits: TranslationCellEdit[] },
            context,
          );
        } finally {
          reads = spy.mock.calls.length;
          spy.mockRestore();
        }
      }),
    ).rejects.toMatchObject({ code: "content.translation_batch_invalid", params: {} });
    expect(reads).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
  it("accepts exactly 4096 UTF-8 value bytes, refuses 4098 without writes", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product)], "é".repeat(2048)) };
    expect((await save(batch)).saved[0]!.text).toBe("é".repeat(2048));
    const before = await snapshot();
    batch.edits[0]!.text = "é".repeat(2049);
    await expect(save(batch)).rejects.toMatchObject({ code: "content.translation_batch_invalid" });
    expect(await snapshot()).toEqual(before);
  });
  it("accepts exactly 262144 serialized UTF-8 bytes and rejects a one-byte-larger exact retry", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product)], "é") };
    const remaining = 262144 - Buffer.byteLength(JSON.stringify(batch), "utf8");
    batch.edits[0]!.expected = " ".repeat(remaining) + batch.edits[0]!.expected;
    expect(Buffer.byteLength(JSON.stringify(batch), "utf8")).toBe(262144);
    const first = await save(batch);
    expect(first.saved[0]!.text).toBe("é");
    expect(await save(batch)).toEqual(first);
    batch.edits[0]!.expected = " " + batch.edits[0]!.expected;
    const before = await snapshot();
    await expect(save(batch)).rejects.toMatchObject({ code: "content.translation_batch_invalid" });
    expect(await snapshot()).toEqual(before);
  });
  it("accepts 100 distinct cells on one item, refuses 101 before accepting retry", async () => {
    const ids = await fixture();
    const languages = [
      "es",
      ...contentLanguageChoices("en")
        .map((c) => c.code)
        .filter((c) => c !== "es")
        .slice(0, 100),
    ];
    await app((tx) => writeContentLanguages(tx, { defaultLanguage: "es", languages }));
    const refs = languages.map((language) => ref("product", ids.product, language));
    const all = [
      ...(await edits(refs.slice(0, 100), "Translated")),
      ...(await edits(refs.slice(100), "Translated")),
    ];
    const first = await save({ edits: all.slice(0, 100) });
    expect(first.saved).toHaveLength(100);
    expect(first.saved.every((c) => c.text === "Translated")).toBe(true);
    const before = await snapshot();
    await expect(save({ edits: all })).rejects.toMatchObject({
      code: "content.translation_batch_invalid",
    });
    expect(await snapshot()).toEqual(before);
    expect(await save({ edits: all.slice(0, 100) })).toEqual(first);
  });
  it("validates a later final map before writing an earlier group or deleting its suggestion", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product), ref("unit", ids.unit)]) };
    await suite.db
      .update(units)
      .set({ name: { es: "CLIENT kilogram", fr: "x".repeat(4097) } })
      .where(eq(units.id, ids.unit));
    await suite.db
      .insert(contentSuggestions)
      .values({ kind: "product", itemId: ids.product, language: "en", placeholder: true });
    const before = await snapshot();
    let writes = 0;
    await expect(
      app(async (tx) => {
        const spy = vi.spyOn(tx, "update");
        try {
          return await saveContentTranslations(tx, batch, context);
        } finally {
          writes = spy.mock.calls.length;
          spy.mockRestore();
        }
      }),
    ).rejects.toMatchObject({
      code: "content.translation_refused",
      params: {
        ...ref("unit", ids.unit),
        causeCode: "content.translation_invalid",
        causeParams: {},
      },
    });
    expect(writes).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
  it("rechecks the whole batch even when an unchanged cell looks both old and final", async () => {
    const ids = await fixture();
    const batch = {
      edits: await edits([
        ref("product", ids.product),
        ref("unit", ids.unit),
        ref("option_list", ids.option_list, "es"),
      ]),
    };
    batch.edits[2]!.text = "CLIENT option";
    await suite.db
      .update(products)
      .set({ customerName: { es: "CLIENT ES bread", en: "New text", fr: "CLIENT pain" } })
      .where(eq(products.id, ids.product));
    const before = await snapshot();
    await expect(save(batch)).rejects.toMatchObject({ code: "content.translation_stale" });
    expect(await snapshot()).toEqual(before);
  });
  it("keeps unrelated language changes and staff fallback out of the edited baseline", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product)]) };
    await suite.db
      .update(products)
      .set({
        name: "STAFF renamed",
        customerName: { es: "CLIENT ES bread", en: "CLIENT bread", fr: "CLIENT changed" },
      })
      .where(eq(products.id, ids.product));
    const reply = await save(batch);
    expect(reply.saved[0]).toMatchObject({ text: "New text", staffText: "STAFF renamed" });
    const [row] = await suite.db.select().from(products).where(eq(products.id, ids.product));
    expect(row).toMatchObject({
      name: "STAFF renamed",
      customerName: { es: "CLIENT ES bread", en: "New text", fr: "CLIENT changed" },
    });
  });
  it("does not rewrite maps on a fully final retry while still cleaning saved suggestions", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product)]) };
    const first = await save(batch);
    await suite.db
      .insert(contentSuggestions)
      .values({ kind: "product", itemId: ids.product, language: "en", placeholder: true });
    let writes = 0;
    const reply = await app(async (tx) => {
      const spy = vi.spyOn(tx, "update");
      try {
        return await saveContentTranslations(tx, batch, context);
      } finally {
        writes = spy.mock.calls.length;
        spy.mockRestore();
      }
    });
    expect(reply).toEqual(first);
    expect(writes).toBe(0);
    expect(await suite.db.select().from(contentSuggestions)).toEqual([]);
  });
  it.each([
    "role",
    "root ownership",
    "included root",
    "child activity",
    "variant activity",
    "required",
  ] as const)("rejects %s races instead of redirecting a draft", async (change) => {
    const ids = await fixture();
    const selected =
      change === "variant activity"
        ? ref("variant", ids.variant)
        : change === "role"
          ? ref("section", ids.section)
          : change === "root ownership"
            ? ref("menu", ids.menu)
            : change === "required"
              ? ref("product", ids.product)
              : ref("included_menu", ids.included_menu);
    const batch = { edits: await edits([selected]) };
    if (change === "role")
      await suite.db
        .update(sections)
        .set({ role: "home_layout" })
        .where(eq(sections.id, ids.section));
    if (change === "root ownership")
      await suite.db
        .update(menuDetails)
        .set({ rootSectionId: ids.section })
        .where(eq(menuDetails.menuId, ids.menuId));
    if (change === "included root")
      await suite.db
        .update(sectionMembers)
        .set({ childSectionId: ids.menu })
        .where(eq(sectionMembers.id, ids.included_menu));
    if (change === "child activity")
      await suite.db
        .update(catalogues)
        .set({ active: false })
        .where(eq(catalogues.id, ids.childMenuId));
    if (change === "variant activity")
      await suite.db.update(products).set({ active: false }).where(eq(products.id, ids.variant));
    const before = await snapshot();
    await expect(
      app((tx) =>
        saveContentTranslations(
          tx,
          batch,
          change === "required" ? { ...context, required: ["es", "ca"] } : context,
        ),
      ),
    ).rejects.toMatchObject({
      code: ["role", "root ownership", "child activity"].includes(change)
        ? "content.translation_unavailable"
        : "content.translation_stale",
      params: selected,
    });
    expect(await snapshot()).toEqual(before);
  });
  it("does not recreate a removed target or consume its suggestion", async () => {
    const ids = await fixture();
    const batch = { edits: await edits([ref("product", ids.product), ref("unit", ids.unit)]) };
    await suite.db
      .insert(contentSuggestions)
      .values({ kind: "unit", itemId: ids.unit, language: "en", placeholder: true });
    await suite.db.delete(units).where(eq(units.id, ids.unit));
    const before = await snapshot();
    await expect(save(batch)).rejects.toMatchObject({
      code: "content.translation_unavailable",
      params: ref("unit", ids.unit),
    });
    expect(await snapshot()).toEqual(before);
  });
  it("clears both last unit maps to empty maps without deleting its abbreviation-only name suggestion", async () => {
    const ids = await fixture();
    await suite.db
      .update(units)
      .set({ name: { es: "CLIENT kilogram" }, abbreviation: { es: "kg" } })
      .where(eq(units.id, ids.unit));
    await suite.db
      .insert(contentSuggestions)
      .values({ kind: "unit", itemId: ids.unit, language: "en", placeholder: true });
    const abbreviation = {
      edits: await edits([ref("unit", ids.unit, "en", "abbreviation")], "kg-en"),
    };
    await save(abbreviation);
    expect((await suite.db.select().from(contentSuggestions)).map((r) => r.language)).toEqual([
      "en",
    ]);
    const batch = {
      edits: await edits(
        [
          ref("unit", ids.unit, "es"),
          ref("unit", ids.unit, "es", "abbreviation"),
          ref("unit", ids.unit, "en", "abbreviation"),
        ],
        null,
      ),
    };
    const before = (await snapshot()).units;
    await save(batch);
    const after = (await snapshot()).units;
    expect(after).toEqual(
      before.map((row) => (row.id === ids.unit ? { ...row, name: {}, abbreviation: {} } : row)),
    );
  });
  it("updates all nine item identities while preserving exact untouched maps and every other column", async () => {
    const ids = await fixture();
    const batch = { edits: await edits(kinds.map((kind) => ref(kind, ids[kind]))) };
    const before = await snapshot();
    const reply = await save(batch);
    expect(reply.saved.map((c) => [c.kind, c.id, c.text])).toEqual(
      kinds.map((kind) => [kind, ids[kind], "New text"]),
    );
    const after = await snapshot();
    const oldCustomers = new Map(
      [...before.products, ...before.options, ...before.labels, ...before.extras].map((row) => [
        row.id,
        row.customerName,
      ]),
    );
    for (const rows of [after.products, after.options, after.labels, after.extras])
      for (const row of rows) {
        const original = oldCustomers.get(row.id)!;
        expect(row.customerName).toEqual({ ...original, en: "New text" });
        row.customerName = original;
      }
    for (const row of after.sections) {
      const original = before.sections.find((old) => old.id === row.id)!;
      if (row.id === ids.menu || row.id === ids.section) {
        expect(row.names).toEqual({ ...original.names, en: "New text" });
        row.names = original.names;
      }
    }
    for (const row of after.members) {
      const original = before.members.find((old) => old.id === row.id)!;
      if (row.id === ids.included_menu) {
        expect(row.folderOverrides.names).toEqual({
          ...original.folderOverrides.names,
          en: "New text",
        });
        row.folderOverrides.names = original.folderOverrides.names;
      }
    }
    for (const row of after.units) {
      const original = before.units.find((old) => old.id === row.id)!;
      if (row.id === ids.unit) {
        expect(row.name).toEqual({ ...original.name, en: "New text" });
        row.name = original.name;
      }
    }
    expect(after).toEqual(before);
  });
});
