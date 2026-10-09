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
import { createCatalogue, createProduct, updateMenuDetails } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import type { TranslationBatch, TranslationRef } from "./content-translation-types.js";
import { saveContentTranslations } from "./content-translations.js";
import { setProductVariants } from "./variants.js";
import { addMember, updateSection } from "./sections.js";
import { setIncludeFolder } from "./include-folder.js";
import { menuDetails, contentLanguages } from "./schema/menu.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context = { fallbackLanguage: "es", required: ["es", "ca"] };
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
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "ca", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: { es: "CLIENT Almuerzo" },
    });
    const child = await createCatalogue(tx, {
      name: "STAFF Drinks",
      names: { es: "CLIENT Bebidas" },
    });
    const roots = await tx.select().from(menuDetails);
    const root = roots.find((row) => row.menuId === menu.id)!.rootSectionId;
    const childRoot = roots.find((row) => row.menuId === child.id)!.rootSectionId;
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      unitId: null,
      name: "STAFF Bread",
      kitchenName: "KITCHEN Bread",
      customerName: { es: "CLIENT Pan" },
      unitPrice: "3.00",
      vatClass: "reduced",
    });
    const [variant] = await setProductVariants(
      tx,
      product.id,
      [
        {
          name: "STAFF Small",
          kitchenName: "KITCHEN Small",
          customerName: { es: "CLIENT Pequeño" },
          unitPrice: "2.00",
          image: null,
          available: true,
        },
      ],
      "es",
    );
    const [list] = await tx
      .insert(optionLists)
      .values({
        name: "STAFF Doneness",
        kitchenName: "KITCHEN Doneness",
        customerName: { es: "CLIENT Punto" },
      })
      .returning();
    const [label] = await tx
      .insert(optionLabels)
      .values({
        listId: list!.id,
        name: "STAFF Rare",
        kitchenName: "KITCHEN Rare",
        customerName: { es: "CLIENT Poco" },
        available: false,
      })
      .returning();
    const [extra] = await tx
      .insert(extraLists)
      .values({
        name: "STAFF Sides",
        kitchenName: "KITCHEN Sides",
        customerName: { es: "CLIENT Guarnición" },
      })
      .returning();
    const [section] = await tx
      .insert(sections)
      .values({ internalName: "STAFF Mains", names: { es: "CLIENT Platos" }, ownerMenuId: menu.id })
      .returning();
    const member = await addMember(tx, root, { kind: "section", sectionId: childRoot });
    await setIncludeFolder(
      tx,
      root,
      member.id,
      {
        showAsFolder: false,
        overrides: { names: { ca: "CLIENT Begudes" }, color: "#123456", image: null },
      },
      "es",
    );
    const [unit] = await tx
      .insert(units)
      .values({ name: { es: "CLIENT Ración" }, abbreviation: { es: "rac" }, precision: 2 })
      .returning();
    return {
      product: product!.id,
      variant: variant!.id,
      option_list: list!.id,
      option_label: label!.id,
      extra_list: extra!.id,
      menu: root,
      section: section!.id,
      included_menu: member.id,
      unit: unit!.id,
      menuId: menu.id,
      childMenuId: child.id,
      childRoot,
    };
  });
}
type Ids = Awaited<ReturnType<typeof fixture>>;
async function batch(
  ids: Ids,
  selected: readonly (typeof kinds)[number][] = kinds,
  language = "en",
): Promise<TranslationBatch> {
  return app(async (tx) => ({
    edits: (
      await resolveTranslationTargets(
        tx,
        language,
        selected.map((kind) => ({ kind, id: ids[kind] })),
        context,
      )
    ).targets.map(({ target }) => ({
      kind: target.kind,
      id: target.id,
      expected: target.expected,
      text: `  CLIENT English ${target.kind}  `,
    })),
  }));
}
async function snapshot(tx: Transaction) {
  return {
    products: await tx.select().from(products).orderBy(products.id),
    lists: await tx.select().from(optionLists).orderBy(optionLists.id),
    labels: await tx.select().from(optionLabels).orderBy(optionLabels.id),
    extras: await tx.select().from(extraLists).orderBy(extraLists.id),
    sections: await tx.select().from(sections).orderBy(sections.id),
    members: await tx.select().from(sectionMembers).orderBy(sectionMembers.id),
    units: await tx.select().from(units).orderBy(units.id),
    menus: await tx.select().from(catalogues).orderBy(catalogues.id),
    details: await tx.select().from(menuDetails).orderBy(menuDetails.menuId),
  };
}

describe("atomic content translations", () => {
  it("saves nine own identities and preserves every other stored field", async () => {
    const ids = await fixture();
    const request = await batch(ids);
    const before = await app(snapshot);
    const result = await app((tx) => saveContentTranslations(tx, "en", request, context));
    expect(result.saved.map(({ kind, id, selectedText }) => ({ kind, id, selectedText }))).toEqual(
      kinds.map((kind) => ({ kind, id: ids[kind], selectedText: `CLIENT English ${kind}` })),
    );
    const after = await app(snapshot);
    for (const rows of [after.products, after.lists, after.labels, after.extras])
      for (const row of rows) if (row.customerName) delete row.customerName.en;
    for (const row of after.sections) delete row.names.en;
    for (const row of after.members)
      if (row.folderOverrides.names) delete row.folderOverrides.names.en;
    for (const row of after.units) delete row.name.en;
    expect(after).toEqual(before);
  });
  it("mixed batch rollback carries the name rule's target field and language", async () => {
    const ids = await fixture();
    await app((tx) =>
      tx.update(products).set({ customerName: null }).where(eq(products.id, ids.variant)),
    );
    const request = await batch(ids);
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_refused",
      params: {
        kind: "variant",
        id: ids.variant,
        field: "defaultText",
        language: "es",
        causeCode: "content.translation_required",
        causeParams: { language: "es" },
      },
    });
    expect(await app(snapshot)).toEqual(before);
  });
  it("cell conflict refuses the whole batch", async () => {
    const ids = await fixture();
    const request = await batch(ids);
    await app((tx) =>
      tx
        .update(products)
        .set({ customerName: { es: "CLIENT Pequeño", en: "Another writer" } })
        .where(eq(products.id, ids.variant)),
    );
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { kind: "variant", id: ids.variant },
    });
    expect(await app(snapshot)).toEqual(before);
  });
  it("merges unrelated price and language concurrency and equivalent configuration order", async () => {
    const ids = await fixture();
    const request = await batch(ids);
    await app(async (tx) => {
      await tx
        .update(products)
        .set({ unitPrice: 475, customerName: { ca: "CLIENT Pa", es: "CLIENT Pan" } })
        .where(eq(products.id, ids.product));
      await tx.update(contentLanguages).set({ languages: ["en", "es", "ca"] });
    });
    request.edits = request.edits.map((edit) => ({
      ...edit,
      expected: (() => {
        const baseline = JSON.parse(edit.expected) as {
          config: { languages: string[] };
          required: string[];
        };
        baseline.config.languages.reverse();
        baseline.required.reverse();
        return JSON.stringify(Object.fromEntries(Object.entries(baseline).reverse()));
      })(),
    }));
    const result = await app((tx) =>
      saveContentTranslations(tx, "en", request, { ...context, required: ["ca", "es", "ca"] }),
    );
    expect(result.saved).toHaveLength(9);
    const [stored] = await suite.db.select().from(products).where(eq(products.id, ids.product));
    expect(stored).toMatchObject({
      unitPrice: 475,
      customerName: { ca: "CLIENT Pa", es: "CLIENT Pan", en: "CLIENT English product" },
    });
  });
  it("equivalent retry returns canonical names without issuing updates", async () => {
    const ids = await fixture();
    const request = await batch(ids);
    const first = await app((tx) => saveContentTranslations(tx, "en", request, context));
    expect(first.saved).toHaveLength(9);
    const second = await app(async (tx) => {
      const spy = vi.spyOn(tx, "update");
      try {
        const result = await saveContentTranslations(tx, "en", request, context);
        expect(spy).not.toHaveBeenCalled();
        return result;
      } finally {
        spy.mockRestore();
      }
    });
    expect(second).toEqual(first);
  });
  it("a divergent cell refuses the entire lost-response retry", async () => {
    const ids = await fixture();
    const request = await batch(ids);
    await app((tx) => saveContentTranslations(tx, "en", request, context));
    await app((tx) =>
      tx
        .update(sections)
        .set({ names: { es: "CLIENT Platos", en: "Different" } })
        .where(eq(sections.id, ids.section)),
    );
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_stale",
      params: { kind: "section", id: ids.section },
    });
    expect(await app(snapshot)).toEqual(before);
  });
  it.each([
    "owner",
    "activity",
    "role",
    "configuration",
    "required",
    "label owner",
    "included root",
    "child activity",
    "root ownership",
  ] as const)("refuses %s changes rather than redirecting a draft", async (change) => {
    const ids = await fixture();
    const request = await batch(ids);
    await app(async (tx) => {
      switch (change) {
        case "owner":
          await tx
            .update(sections)
            .set({ ownerMenuId: ids.childMenuId })
            .where(eq(sections.id, ids.section));
          break;
        case "activity":
          await tx.update(products).set({ active: false }).where(eq(products.id, ids.variant));
          break;
        case "role":
          await tx
            .update(sections)
            .set({ role: "home_layout" })
            .where(eq(sections.id, ids.section));
          break;
        case "configuration":
          await tx.update(contentLanguages).set({ defaultLanguage: "ca" });
          break;
        case "required":
          break;
        case "label owner": {
          const [other] = await tx.insert(optionLists).values({ name: "Other list" }).returning();
          await tx
            .update(optionLabels)
            .set({ listId: other!.id })
            .where(eq(optionLabels.id, ids.option_label));
          break;
        }
        case "included root":
          await tx
            .update(sectionMembers)
            .set({ childSectionId: ids.menu })
            .where(eq(sectionMembers.id, ids.included_menu));
          break;
        case "child activity":
          await tx
            .update(catalogues)
            .set({ active: false })
            .where(eq(catalogues.id, ids.childMenuId));
          break;
        case "root ownership":
          await tx
            .update(menuDetails)
            .set({ rootSectionId: ids.section })
            .where(eq(menuDetails.menuId, ids.menuId));
          break;
      }
    });
    const before = await app(snapshot);
    await expect(
      app((tx) =>
        saveContentTranslations(
          tx,
          "en",
          request,
          change === "required" ? { ...context, required: ["es"] } : context,
        ),
      ),
    ).rejects.toMatchObject({
      code: ["role", "child activity", "root ownership"].includes(change)
        ? "content.translation_unavailable"
        : "content.translation_stale",
    });
    expect(await app(snapshot)).toEqual(before);
  });
  it("never recreates a removed target", async () => {
    const ids = await fixture();
    const request = await batch(ids);
    await app((tx) => tx.delete(units).where(eq(units.id, ids.unit)));
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_unavailable",
      params: { kind: "unit", id: ids.unit },
    });
    expect(await app(snapshot)).toEqual(before);
  });
  it("a baseline belongs to its selected language even when both cells were empty", async () => {
    const ids = await fixture();
    const request = await batch(ids, ["product"]);
    await expect(
      app((tx) => saveContentTranslations(tx, "ca", request, context)),
    ).rejects.toMatchObject({ code: "content.translation_stale" });
    expect(
      (
        await app((tx) =>
          resolveTranslationTargets(tx, "ca", [{ kind: "product", id: ids.product }], context),
        )
      ).targets[0]!.target.selectedText,
    ).toBeNull();
  });
  it("explicit default companion is trimmed and its original request retries without writes", async () => {
    const ids = await fixture();
    await app((tx) =>
      tx.update(products).set({ customerName: null }).where(eq(products.id, ids.product)),
    );
    const request = await batch(ids, ["product"]);
    request.edits[0]!.defaultText = "  CLIENT Pan nuevo  ";
    const first = await app((tx) => saveContentTranslations(tx, "en", request, context));
    expect(first.saved[0]).toMatchObject({
      selectedText: "CLIENT English product",
      defaultText: "CLIENT Pan nuevo",
    });
    expect(await app((tx) => saveContentTranslations(tx, "en", request, context))).toEqual(first);
  });
  it.each(["existing", "selected default", "inherited"] as const)(
    "rejects a gratuitous companion with %s default",
    async (mode) => {
      const ids = await fixture();
      const request = await batch(
        ids,
        [mode === "inherited" ? "included_menu" : "product"],
        mode === "selected default" ? "es" : "en",
      );
      request.edits[0]!.defaultText = "Gratuitous";
      const before = await app(snapshot);
      await expect(
        app((tx) =>
          saveContentTranslations(tx, mode === "selected default" ? "es" : "en", request, context),
        ),
      ).rejects.toMatchObject({ code: "content.translation_batch_invalid" });
      expect(await app(snapshot)).toEqual(before);
    },
  );
  it.each(["root first", "include first"] as const)(
    "root include final maps accept a default supplied by the batch (%s)",
    async (order) => {
      const ids = await fixture();
      await app((tx) =>
        tx.update(sections).set({ names: {} }).where(eq(sections.id, ids.childRoot)),
      );
      const refs: TranslationRef[] = [
        { kind: "menu", id: ids.childRoot },
        { kind: "included_menu", id: ids.included_menu },
      ];
      if (order === "include first") refs.reverse();
      const request: TranslationBatch = await app(async (tx) => ({
        edits: (await resolveTranslationTargets(tx, "en", refs, context)).targets.map(
          ({ target }) => ({
            kind: target.kind,
            id: target.id,
            expected: target.expected,
            text: target.kind === "menu" ? "Root English" : "Folder English",
            ...(target.kind === "menu" ? { defaultText: "Root Español" } : {}),
          }),
        ),
      }));
      const first = await app((tx) => saveContentTranslations(tx, "en", request, context));
      expect(first.saved.find((row) => row.kind === "included_menu")).toMatchObject({
        selectedText: "Folder English",
        defaultText: null,
        effectiveDefaultText: "Root Español",
        defaultRequired: false,
      });
      const before = await app(snapshot);
      expect(await app((tx) => saveContentTranslations(tx, "en", request, context))).toEqual(first);
      expect(await app(snapshot)).toEqual(before);
    },
  );
  it("changed inherited default conflicts even when the requested override already matches", async () => {
    const ids = await fixture();
    const request = await batch(ids, ["included_menu"]);
    await app((tx) => saveContentTranslations(tx, "en", request, context));
    await app((tx) =>
      tx
        .update(sections)
        .set({ names: { es: "Other default" } })
        .where(eq(sections.id, ids.childRoot)),
    );
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({ code: "content.translation_stale" });
  });
  it.each(["configured", "unset"] as const)(
    "existing menu, section and folder checks expose the %s default fallback",
    async (mode) => {
      const ids = await fixture();
      if (mode === "unset") await app((tx) => tx.delete(contentLanguages));
      for (const [writer, language] of [
        [
          () => app((tx) => updateMenuDetails(tx, ids.menuId, { names: { ca: "Only català" } })),
          mode === "configured" ? "es" : "en",
        ],
        [
          () => app((tx) => updateSection(tx, ids.section, { names: { ca: "Only català" } }, "es")),
          "es",
        ],
        [
          () =>
            app((tx) =>
              setIncludeFolder(
                tx,
                ids.menu,
                ids.included_menu,
                {
                  showAsFolder: false,
                  overrides: { names: { ca: "Only català", es: "", en: "" } },
                },
                "es",
              ),
            ),
          "es",
        ],
      ] as const) {
        await expect(writer()).rejects.toMatchObject({
          code: "menu_section.translation_required",
          params: { field: "names", language },
        });
      }
      if (mode === "unset") {
        await expect(
          app((tx) => updateMenuDetails(tx, ids.menuId, { names: { es: "Español" } })),
        ).rejects.toMatchObject({
          code: "menu_section.translation_required",
          params: { language: "en" },
        });
        await app((tx) => updateSection(tx, ids.section, { names: { es: "Español" } }, "es"));
        await app((tx) =>
          setIncludeFolder(
            tx,
            ids.menu,
            ids.included_menu,
            { showAsFolder: false, overrides: { names: { es: "Español" } } },
            "es",
          ),
        );
      }
    },
  );
  it.each([
    "empty",
    "duplicate",
    "bad token",
    "wrong target",
    "unknown field",
    "blank",
    "too long",
    "too many",
    "null",
  ] as const)("refuses malformed batch %s without writes", async (mode) => {
    const ids = await fixture();
    let request = await batch(ids, ["product"]);
    switch (mode) {
      case "empty":
        request.edits = [];
        break;
      case "duplicate":
        request.edits.push({ ...request.edits[0]! });
        break;
      case "bad token":
        request.edits[0]!.expected = "{}";
        break;
      case "wrong target":
        request.edits[0]!.id = ids.variant;
        break;
      case "unknown field":
        request = { ...request, extra: true } as TranslationBatch;
        break;
      case "blank":
        request.edits[0]!.text = " \t ";
        break;
      case "too long":
        request.edits[0]!.text = "é".repeat(2049);
        break;
      case "too many":
        request.edits = Array.from({ length: 101 }, (_, i) => ({
          ...request.edits[0]!,
          id: `id-${i}`,
        }));
        break;
      case "null":
        request = null as unknown as TranslationBatch;
        break;
    }
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({ code: "content.translation_batch_invalid" });
    expect(await app(snapshot)).toEqual(before);
  });
  it("one hundred saves use one configuration and one bounded target read", async () => {
    const ids = await fixture();
    const refs = await app(async (tx) => {
      const rows = await tx
        .insert(units)
        .values(
          Array.from({ length: 100 }, (_, i) => ({
            name: { es: `CLIENT Unit ${i}` },
            abbreviation: { es: `u${i}` },
            precision: 0,
          })),
        )
        .returning({ id: units.id });
      return rows.map((row) => ({ kind: "unit" as const, id: row.id }));
    });
    for (const selected of [refs.slice(0, 1), refs]) {
      const request = await app(async (tx) => ({
        edits: (await resolveTranslationTargets(tx, "en", selected, context)).targets.map(
          ({ target }) => ({
            kind: target.kind,
            id: target.id,
            expected: target.expected,
            text: `English ${target.id}`,
          }),
        ),
      }));
      await app(async (tx) => {
        const spy = vi.spyOn(tx, "execute");
        let result;
        try {
          result = await saveContentTranslations(tx, "en", request, context);
          expect(spy).toHaveBeenCalledTimes(2);
        } finally {
          spy.mockRestore();
        }
        expect(result.saved).toHaveLength(selected.length);
        expect(result.saved.every((row) => row.selectedText === `English ${row.id}`)).toBe(true);
      });
    }
    expect(
      (
        await app((tx) =>
          resolveTranslationTargets(tx, "en", [{ kind: "product", id: ids.product }], context),
        )
      ).targets[0]!.target.selectedText,
    ).toBeNull();
  });
  it("an external default change conflicts and cannot be mistaken for a retry", async () => {
    const ids = await fixture();
    const request = await batch(ids, ["product"]);
    await app((tx) => saveContentTranslations(tx, "en", request, context));
    await app((tx) =>
      tx
        .update(products)
        .set({ customerName: { es: "Different default", en: "CLIENT English product" } })
        .where(eq(products.id, ids.product)),
    );
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({ code: "content.translation_stale" });
  });
  it("selected default root edits project both inherited cells for the retry", async () => {
    const ids = await fixture();
    const refs: TranslationRef[] = [
      { kind: "included_menu", id: ids.included_menu },
      { kind: "menu", id: ids.childRoot },
    ];
    const request = await app(async (tx) => ({
      edits: (await resolveTranslationTargets(tx, "es", refs, context)).targets.map(
        ({ target }) => ({
          kind: target.kind,
          id: target.id,
          expected: target.expected,
          text: target.kind === "menu" ? "Root español" : "Folder español",
        }),
      ),
    }));
    const first = await app((tx) => saveContentTranslations(tx, "es", request, context));
    expect(first.saved[0]).toMatchObject({
      selectedText: "Folder español",
      defaultText: "Folder español",
      effectiveDefaultText: "Folder español",
    });
    expect(await app((tx) => saveContentTranslations(tx, "es", request, context))).toEqual(first);
  });
  it("mixed retry and unsaved rows cannot partially complete a batch", async () => {
    const ids = await fixture();
    const request = await batch(ids, ["product", "variant"]);
    await app((tx) => saveContentTranslations(tx, "en", { edits: [request.edits[0]!] }, context));
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({ code: "content.translation_stale" });
    expect(await app(snapshot)).toEqual(before);
  });
  it.each([
    "json",
    "language",
    "nontext language",
    "structure",
    "role",
    "owners",
    "required",
    "cell",
    "config",
    "token fields",
    "owner id",
  ] as const)("refuses malformed baseline %s", async (mode) => {
    const ids = await fixture();
    const request = await batch(ids, ["product"]);
    const edit = request.edits[0]!;
    const baseline = JSON.parse(edit.expected) as Record<string, unknown>;
    switch (mode) {
      case "json":
        edit.expected = "{";
        break;
      case "language":
        baseline.language = "!!";
        break;
      case "nontext language":
        baseline.language = 42;
        break;
      case "structure":
        baseline.structure = { ...(baseline.structure as object), active: "true" };
        break;
      case "role":
        baseline.structure = { ...(baseline.structure as object), role: 42 };
        break;
      case "owners":
        baseline.owners = { kind: "section", menuId: ids.menuId };
        break;
      case "required":
        baseline.required = ["!!"];
        break;
      case "cell":
        baseline.selectedText = 42;
        break;
      case "config":
        baseline.config = { defaultLanguage: "es", languages: null };
        break;
      case "token fields":
        baseline.extra = true;
        break;
      case "owner id":
        baseline.owners = { kind: "product", parentId: ids.variant };
        break;
    }
    if (mode !== "json") edit.expected = JSON.stringify(baseline);
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({ code: "content.translation_batch_invalid" });
    expect(await app(snapshot)).toEqual(before);
  });
  it("4 KiB multibyte names save without losing internal spaces", async () => {
    const ids = await fixture();
    const request = await batch(ids, ["product"]);
    request.edits[0]!.text = "é".repeat(2046) + "  ab";
    const result = await app((tx) => saveContentTranslations(tx, "en", request, context));
    expect(result.saved[0]!.selectedText).toBe("é".repeat(2046) + "  ab");
  });
  it("other domain name refusals keep their cause and row for the caller", async () => {
    const ids = await fixture();
    await app((tx) =>
      tx
        .update(units)
        .set({ name: { es: "CLIENT Ración", "!!": "Invalid language" } })
        .where(eq(units.id, ids.unit)),
    );
    const request = await batch(ids, ["product", "unit"]);
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_refused",
      params: {
        kind: "unit",
        id: ids.unit,
        field: "text",
        language: "en",
        causeCode: "content.language_invalid",
        causeParams: {},
      },
    });
    expect(await app(snapshot)).toEqual(before);
  });
  it.each(kinds)("%s missing default carries its existing domain name refusal", async (kind) => {
    const ids = await fixture();
    await app(async (tx) => {
      switch (kind) {
        case "product":
        case "variant":
          await tx.update(products).set({ customerName: null }).where(eq(products.id, ids[kind]));
          break;
        case "option_list":
          await tx
            .update(optionLists)
            .set({ customerName: null })
            .where(eq(optionLists.id, ids[kind]));
          break;
        case "option_label":
          await tx
            .update(optionLabels)
            .set({ customerName: null })
            .where(eq(optionLabels.id, ids[kind]));
          break;
        case "extra_list":
          await tx
            .update(extraLists)
            .set({ customerName: null })
            .where(eq(extraLists.id, ids[kind]));
          break;
        case "unit":
          await tx.update(units).set({ name: {} }).where(eq(units.id, ids[kind]));
          break;
        case "menu":
        case "section":
          await tx.update(sections).set({ names: {} }).where(eq(sections.id, ids[kind]));
          break;
        case "included_menu":
          await tx
            .update(sectionMembers)
            .set({ folderOverrides: { names: { es: "" } } })
            .where(eq(sectionMembers.id, ids[kind]));
          break;
      }
    });
    const causeCodes = {
      product: "content.translation_required",
      variant: "content.translation_required",
      option_list: "options.translation_required",
      option_label: "options.translation_required",
      extra_list: "extras.translation_required",
      unit: "unit.translation_required",
      menu: "menu_section.translation_required",
      section: "menu_section.translation_required",
      included_menu: "menu_section.translation_required",
    };
    const request = await batch(ids, [kind]);
    const before = await app(snapshot);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_refused",
      params: {
        kind,
        id: ids[kind],
        field: "defaultText",
        language: "es",
        causeCode: causeCodes[kind],
      },
    });
    expect(await app(snapshot)).toEqual(before);
  });
});

it("saves only customer names on an explicitly selected archived product", async () => {
  const ids = await fixture();
  await app((tx) => tx.update(products).set({ active: false }).where(eq(products.id, ids.product)));
  const before = await app(snapshot);
  const request = await batch(ids, ["product"]);
  await app((tx) => saveContentTranslations(tx, "en", request, context));
  const [stored] = await suite.db.select().from(products).where(eq(products.id, ids.product));
  expect(stored!.customerName).toEqual({ es: "CLIENT Pan", en: "CLIENT English product" });
  const after = await app(snapshot);
  expect(after).toEqual({
    ...before,
    products: before.products.map((row) =>
      row.id === ids.product ? { ...row, customerName: stored!.customerName } : row,
    ),
  });
});

it.each(["variant", "parent"] as const)(
  "saves a variant translation after its %s is archived",
  async (archived) => {
    const ids = await fixture();
    await app((tx) =>
      tx
        .update(products)
        .set({ active: false })
        .where(eq(products.id, archived === "parent" ? ids.product : ids.variant)),
    );
    const request = await batch(ids, ["variant"]);
    await app((tx) => saveContentTranslations(tx, "en", request, context));
    const [stored] = await suite.db.select().from(products).where(eq(products.id, ids.variant));
    expect(stored!.customerName).toEqual({ es: "CLIENT Pequeño", en: "CLIENT English variant" });
  },
);

it.each(["option_list", "extra_list", "menu"] as const)(
  "still refuses explicitly selected inactive %s translations without any write",
  async (kind) => {
    const ids = await fixture();
    await app(async (tx) => {
      if (kind === "option_list")
        await tx.update(optionLists).set({ active: false }).where(eq(optionLists.id, ids[kind]));
      else if (kind === "extra_list")
        await tx.update(extraLists).set({ active: false }).where(eq(extraLists.id, ids[kind]));
      else await tx.update(catalogues).set({ active: false }).where(eq(catalogues.id, ids.menuId));
    });
    const before = await app(snapshot);
    const request = await batch(ids, [kind]);
    await expect(
      app((tx) => saveContentTranslations(tx, "en", request, context)),
    ).rejects.toMatchObject({
      code: "content.translation_unavailable",
      params: { kind, id: ids[kind] },
    });
    expect(await app(snapshot)).toEqual(before);
  },
);
