import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  categories,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { ContentLanguages } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCategory } from "./categories.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
} from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import {
  listAbsentTranslationRefs,
  listTranslationGapRefs,
  listTranslationTargets,
  resolveTranslationTargets,
} from "./content-translation-targets.js";
import type { TranslationRef } from "./content-translation-types.js";
import type { SuggestionItem } from "./content-suggestion-types.js";
import { setIncludeFolder } from "./include-folder.js";
import { addMember } from "./sections.js";
import { menuDetails } from "./schema/menu.js";
import { sections } from "./schema/sections.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
  buildSuggestionJob,
  collectSuggestionItems,
  isLiveTarget,
  parseSuggestionRef,
  pruneSuggestions,
  readSuggestionGaps,
  suggestionRef,
  TEXT_LIMIT,
} from "./content-suggestion-collect.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const THREE: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "es", "en"] };
const ONE: ContentLanguages = { defaultLanguage: "ca", languages: ["ca"] };
const context = { fallbackLanguage: "ca", required: [] };
const KINDS = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
];

interface Lunch {
  menuId: string;
  rootId: string;
}

async function rootOf(tx: Transaction, menuId: string): Promise<string> {
  const [row] = await tx
    .select({ root: menuDetails.rootSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.root;
}

/** Seeds the taxpayer, saves the languages and makes Lunch, whose own names are complete. */
async function inVenue<T>(
  config: ContentLanguages,
  body: (tx: Transaction, lunch: Lunch) => Promise<T>,
): Promise<T> {
  await seedTenant(suite.db);
  return withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, config);
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: Object.fromEntries(
        config.languages.map((language) => [language, `CLIENT-${language.toUpperCase()} Dinar`]),
      ),
    });
    return body(tx, { menuId: menu.id, rootId: await rootOf(tx, menu.id) });
  });
}

async function product(
  tx: Transaction,
  lunch: Lunch,
  name: string,
  customerName: Record<string, string> | null,
  categoryId: string | null = null,
): Promise<string> {
  const created = await createProduct(tx, {
    catalogueId: lunch.menuId,
    categoryId,
    unitId: null,
    name: `STAFF ${name}`,
    kitchenName: `KITCHEN ${name}`,
    customerName,
    unitPrice: "3.00",
    vatClass: "reduced",
  });
  return created.id;
}

/** Written directly: the variant editor refuses a customer-facing name with no default-language text. */
async function variant(
  tx: Transaction,
  lunch: Lunch,
  parentId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: lunch.menuId,
      parentId,
      name: `STAFF ${name}`,
      kitchenName: `KITCHEN ${name}`,
      customerName,
    })
    .returning({ id: products.id });
  return row!.id;
}

async function optionList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLists.id });
  return row!.id;
}

async function optionLabel(
  tx: Transaction,
  listId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLabels)
    .values({ listId, name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLabels.id });
  return row!.id;
}

async function extraList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(extraLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: extraLists.id });
  return row!.id;
}

async function section(
  tx: Transaction,
  menuId: string,
  name: string,
  names: Record<string, string>,
): Promise<string> {
  const [row] = await tx
    .insert(sections)
    .values({ internalName: `STAFF ${name}`, names, ownerMenuId: menuId })
    .returning({ id: sections.id });
  return row!.id;
}

async function rename(tx: Transaction, productId: string, name: string): Promise<void> {
  await tx.update(products).set({ name }).where(eq(products.id, productId));
}

const position = (ref: string) => KINDS.indexOf(ref.slice(0, ref.indexOf(":")));
const compareRefs = (a: string, b: string) => position(a) - position(b) || (a < b ? -1 : 1);
const sortRefs = (refs: string[]) => [...refs].sort(compareRefs);
const inListOrder = <T extends { ref: string }>(rows: T[]) =>
  [...rows].sort((a, b) => compareRefs(a.ref, b.ref));

describe("suggestion refs", () => {
  it("writes a ref as kind and id, and reads back only a well-formed one", () => {
    expect(suggestionRef({ kind: "option_label", id: "abc" })).toBe("option_label:abc");
    expect(parseSuggestionRef("option_label:abc")).toEqual({ kind: "option_label", id: "abc" });
    expect(parseSuggestionRef("section:a:b")).toEqual({ kind: "section", id: "a:b" });
    for (const ref of ["", "product", "product:", ":abc", "widget:abc"])
      expect(parseSuggestionRef(ref)).toBeNull();
  });
});

describe("what counts as still there", () => {
  it("lists the live items with no customer-facing name at all, in the dialog's order, and nothing else", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      const oli = await product(tx, lunch, "Oli", {});
      const vi = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      const copa = await variant(tx, lunch, vi, "Copa", null);
      const punt = await optionList(tx, "Punt", null);
      const poc = await optionLabel(tx, punt, "Poc", {});
      await extraList(tx, "Salses", null);
      await tx
        .insert(units)
        .values({ name: { ca: "CLIENT-CA Ració" }, abbreviation: { ca: "r." }, precision: 0 });
      const bar = await createCatalogue(tx, { name: "STAFF Bar", names: { ca: "CLIENT-CA Bar" } });
      const barRoot = await rootOf(tx, bar.id);
      await tx.update(sections).set({ names: {} }).where(eq(sections.id, barRoot));
      const plats = await section(tx, lunch.menuId, "Plats", {});
      const coca = await product(tx, lunch, "Coca", null);
      await deactivateProduct(tx, coca);
      const vermut = await product(tx, lunch, "Vermut", { ca: "CLIENT-CA Vermut" });
      await variant(tx, lunch, vermut, "Vermut gran", null);
      await tx.update(products).set({ active: false }).where(eq(products.id, vermut));
      const spice = await optionList(tx, "Picant", { ca: "CLIENT-CA Picant" });
      await optionLabel(tx, spice, "Molt", null);
      await tx.update(optionLists).set({ active: false }).where(eq(optionLists.id, spice));
      const terrace = await createCatalogue(tx, {
        name: "STAFF Terrassa",
        names: { ca: "CLIENT-CA Terrassa" },
      });
      await section(tx, terrace.id, "Postres", {});
      await deactivateCatalogue(tx, terrace.id);

      expect((await listAbsentTranslationRefs(tx)).map(suggestionRef)).toEqual(
        sortRefs([
          `product:${pa}`,
          `product:${oli}`,
          `variant:${copa}`,
          `option_list:${punt}`,
          `option_label:${poc}`,
          `menu:${barRoot}`,
          `section:${plats}`,
        ]),
      );
    });
  });

  it("treats only a present, eligible item whose own row and owner are active as live", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      const coca = await product(tx, lunch, "Coca", null);
      await deactivateProduct(tx, coca);
      const vermut = await product(tx, lunch, "Vermut", null);
      const gran = await variant(tx, lunch, vermut, "Vermut gran", null);
      await tx.update(products).set({ active: false }).where(eq(products.id, vermut));
      const drinks = await createCatalogue(tx, {
        name: "STAFF Drinks",
        names: { ca: "CLIENT-CA Begudes" },
      });
      const include = await addMember(tx, lunch.rootId, {
        kind: "section",
        sectionId: await rootOf(tx, drinks.id),
      });
      await deactivateCatalogue(tx, drinks.id);
      const refs: TranslationRef[] = [
        { kind: "product", id: pa },
        { kind: "product", id: "no-such-product" },
        { kind: "product", id: gran },
        { kind: "product", id: coca },
        { kind: "variant", id: gran },
        { kind: "included_menu", id: include.id },
      ];
      const { targets } = await resolveTranslationTargets(tx, "ca", refs, context);
      expect(targets.map((entry) => isLiveTarget(entry))).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
      // Each refusal above rests on one flag alone: a variant asked for as a product on
      // `eligible`, the deleted product on `active`, the variant of the deleted product on
      // `ownerActive`. The include of a switched-off menu is already not eligible.
      expect(
        targets.map(
          (entry) =>
            entry.state === "present" && {
              eligible: entry.target.eligible,
              active: entry.structure.active,
              ownerActive: entry.structure.ownerActive,
            },
        ),
      ).toEqual([
        { eligible: true, active: true, ownerActive: true },
        false,
        { eligible: false, active: true, ownerActive: true },
        { eligible: true, active: false, ownerActive: true },
        { eligible: true, active: true, ownerActive: false },
        { eligible: false, active: true, ownerActive: true },
      ]);
    });
  });
});

describe("the gaps a run starts from", () => {
  const missingByRef = async (tx: Transaction) =>
    Object.fromEntries(
      [...(await readSuggestionGaps(tx, context))].map(([ref, gap]) => [ref, [...gap.missing]]),
    );

  it("holds every live item blank in at least one enabled language, with the languages it is blank in", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const noEn = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa", es: "CLIENT-ES Pan" });
      const noDefault = await product(tx, lunch, "Oli", {
        es: "CLIENT-ES Aceite",
        en: "CLIENT-EN Oil",
      });
      const spaces = await product(tx, lunch, "Sal", {
        ca: "CLIENT-CA Sal",
        es: "  ",
        en: "CLIENT-EN Salt",
      });
      // The listing's blank test is SQLite's trim, which removes spaces only.
      await product(tx, lunch, "Mel", { ca: "CLIENT-CA Mel", es: "\t", en: "CLIENT-EN Honey" });
      await product(tx, lunch, "Vi", {
        ca: "CLIENT-CA Vi",
        es: "CLIENT-ES Vino",
        en: "CLIENT-EN Wine",
      });
      const nameless = await product(tx, lunch, "Coca", null);
      const empty = await product(tx, lunch, "Formatge", {});
      const gone = await product(tx, lunch, "Vermut", null);
      await deactivateProduct(tx, gone);
      const glass = await variant(tx, lunch, noEn, "Pa gran", { en: "CLIENT-EN Big bread" });
      const doneness = await optionList(tx, "Punt", null);
      const rare = await optionLabel(tx, doneness, "Poc", { ca: "CLIENT-CA Poc" });
      await extraList(tx, "Salses", null);
      const sides = await extraList(tx, "Guarnició", { ca: "CLIENT-CA Guarnició" });
      const [portion] = await tx
        .insert(units)
        .values({
          name: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
          abbreviation: { ca: "r." },
          precision: 0,
        })
        .returning({ id: units.id });
      const drinks = await createCatalogue(tx, {
        name: "STAFF Drinks",
        names: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
      });
      const drinksRoot = await rootOf(tx, drinks.id);
      const include = await addMember(tx, lunch.rootId, { kind: "section", sectionId: drinksRoot });
      await setIncludeFolder(
        tx,
        lunch.rootId,
        include.id,
        {
          showAsFolder: false,
          overrides: { names: { ca: "CLIENT-CA Begudes de la casa" }, color: null, image: null },
        },
        "ca",
      );
      const mains = await section(tx, lunch.menuId, "Plats", {});

      expect(await missingByRef(tx)).toEqual({
        [`product:${noEn}`]: ["en"],
        [`product:${noDefault}`]: ["ca"],
        [`product:${spaces}`]: ["es"],
        [`product:${nameless}`]: ["ca", "es", "en"],
        [`product:${empty}`]: ["ca", "es", "en"],
        [`variant:${glass}`]: ["ca", "es"],
        [`option_list:${doneness}`]: ["ca", "es", "en"],
        [`option_label:${rare}`]: ["es", "en"],
        [`extra_list:${sides}`]: ["es", "en"],
        [`menu:${drinksRoot}`]: ["en"],
        [`section:${mains}`]: ["ca", "es", "en"],
        [`included_menu:${include.id}`]: ["en"],
        [`unit:${portion!.id}`]: ["en"],
      });
      const listed = new Set<string>();
      for (const language of THREE.languages) {
        let after: string | null = null;
        do {
          const page = await listTranslationTargets(tx, language, after ? { after } : {}, context);
          for (const row of page.rows) listed.add(suggestionRef(row));
          after = page.next;
        } while (after !== null);
      }
      for (const ref of await listAbsentTranslationRefs(tx)) listed.add(suggestionRef(ref));
      expect((await listTranslationGapRefs(tx, THREE)).map(suggestionRef)).toEqual(
        sortRefs([...listed]),
      );
    });
  });

  it("collects from, prunes against and builds a job from the gaps it is handed, leaving them as they were", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const oli = await product(tx, lunch, "Oli", { ca: "CLIENT-CA Oli" });
      const gaps = await readSuggestionGaps(tx, context);
      await tx
        .update(products)
        .set({ customerName: { ca: "CLIENT-CA Oli", es: "CLIENT-ES Aceite", en: "CLIENT-EN Oil" } })
        .where(eq(products.id, oli));
      await tx.insert(contentSuggestions).values([
        { kind: "product", itemId: pa, language: "es", text: "CLIENT-ES Pan", expected: "{}" },
        { kind: "product", itemId: oli, language: "es", text: "CLIENT-ES Oli", expected: "{}" },
      ]);

      await pruneSuggestions(tx, context, gaps);
      expect(await tx.select().from(contentSuggestions)).toHaveLength(2);
      const items = await collectSuggestionItems(tx, context, new Set(), gaps);
      expect(items.map(({ ref, missing }) => ({ ref, missing }))).toEqual(
        inListOrder([
          { ref: `product:${pa}`, missing: ["en"] },
          { ref: `product:${oli}`, missing: ["en"] },
        ]),
      );
      const draft = await buildSuggestionJob(tx, context, new Set(), gaps);
      expect(draft!.sent).toEqual({ [`product:${pa}`]: ["en"], [`product:${oli}`]: ["en"] });
      for (const gap of gaps.values()) expect([...gap.missing]).toEqual(["es", "en"]);

      await pruneSuggestions(tx, context);
      expect(
        (await tx.select({ itemId: contentSuggestions.itemId }).from(contentSuggestions)).map(
          (row) => row.itemId,
        ),
      ).toEqual([pa]);
    });
  });

  it("holds a one-language venue's names with no text at all, and its names blank in that language", async () => {
    await inVenue(ONE, async (tx, lunch) => {
      const nameless = await product(tx, lunch, "Coca", null);
      const empty = await product(tx, lunch, "Formatge", {});
      const blank = await product(tx, lunch, "Pa", { ca: " ", es: "CLIENT-ES Pan" });
      await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      expect(await missingByRef(tx)).toEqual({
        [`product:${nameless}`]: ["ca"],
        [`product:${empty}`]: ["ca"],
        [`product:${blank}`]: ["ca"],
      });
    });
  });
});

describe("collecting what is missing", () => {
  it("collects every missing name across the nine kinds with its family, its category and its staff name", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const beers = await createCategory(tx, { name: "TAP BEERS" });
      const cana = await product(tx, lunch, "Caña", { ca: "CLIENT-CA Canya" }, beers.id);
      const pinta = await variant(tx, lunch, cana, "Pinta", { en: "CLIENT-EN Pint" });
      const punto = await optionList(tx, "Punto", { ca: "CLIENT-CA Punt", es: "CLIENT-ES Punto" });
      const poco = await optionLabel(tx, punto, "Poco", { ca: "CLIENT-CA Poc" });
      const sides = await extraList(tx, "Guarnición", { ca: "CLIENT-CA Guarnició" });
      const drinks = await createCatalogue(tx, {
        name: "STAFF Drinks",
        names: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
      });
      const drinksRoot = await rootOf(tx, drinks.id);
      const plats = await section(tx, lunch.menuId, "Plats", { ca: "CLIENT-CA Plats" });
      const include = await addMember(tx, lunch.rootId, { kind: "section", sectionId: drinksRoot });
      await setIncludeFolder(
        tx,
        lunch.rootId,
        include.id,
        {
          showAsFolder: false,
          overrides: {
            names: { ca: "CLIENT-CA Begudes de la casa" },
            color: "#123456",
            image: null,
          },
        },
        "ca",
      );
      const [racio] = await tx
        .insert(units)
        .values({
          name: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
          abbreviation: { ca: "r." },
          precision: 0,
        })
        .returning({ id: units.id });

      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        {
          ref: `product:${cana}`,
          kind: "product",
          family: `product:${cana}`,
          category: "TAP BEERS",
          staffName: "STAFF Caña",
          existing: { ca: "CLIENT-CA Canya" },
          missing: ["es", "en"],
        },
        {
          ref: `variant:${pinta}`,
          kind: "variant",
          family: `product:${cana}`,
          category: "TAP BEERS",
          staffName: "STAFF Pinta",
          existing: { en: "CLIENT-EN Pint" },
          missing: ["ca", "es"],
        },
        {
          ref: `option_list:${punto}`,
          kind: "option_list",
          family: `option_list:${punto}`,
          category: null,
          staffName: "STAFF Punto",
          existing: { ca: "CLIENT-CA Punt", es: "CLIENT-ES Punto" },
          missing: ["en"],
        },
        {
          ref: `option_label:${poco}`,
          kind: "option_label",
          family: `option_list:${punto}`,
          category: null,
          staffName: "STAFF Poco",
          existing: { ca: "CLIENT-CA Poc" },
          missing: ["es", "en"],
        },
        {
          ref: `extra_list:${sides}`,
          kind: "extra_list",
          family: `extra_list:${sides}`,
          category: null,
          staffName: "STAFF Guarnición",
          existing: { ca: "CLIENT-CA Guarnició" },
          missing: ["es", "en"],
        },
        {
          ref: `menu:${drinksRoot}`,
          kind: "menu",
          family: `menu:${drinksRoot}`,
          category: null,
          staffName: "STAFF Drinks",
          existing: { ca: "CLIENT-CA Begudes", es: "CLIENT-ES Bebidas" },
          missing: ["en"],
        },
        {
          ref: `section:${plats}`,
          kind: "section",
          family: `menu:${lunch.rootId}`,
          category: null,
          staffName: "STAFF Plats",
          existing: { ca: "CLIENT-CA Plats" },
          missing: ["es", "en"],
        },
        {
          ref: `included_menu:${include.id}`,
          kind: "included_menu",
          family: `included_menu:${include.id}`,
          category: null,
          staffName: "STAFF Drinks",
          existing: { ca: "CLIENT-CA Begudes de la casa", es: "CLIENT-ES Bebidas" },
          missing: ["en"],
        },
        {
          ref: `unit:${racio!.id}`,
          kind: "unit",
          family: `unit:${racio!.id}`,
          category: null,
          staffName: "CLIENT-CA Ració",
          existing: { ca: "CLIENT-CA Ració", es: "CLIENT-ES Ración" },
          missing: ["en"],
        },
      ]);
    });
  });

  it("asks for every enabled language, the default included, for a name with no customer-facing text", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        {
          ref: `product:${pa}`,
          kind: "product",
          family: `product:${pa}`,
          category: null,
          staffName: "STAFF Pa",
          existing: {},
          missing: ["ca", "es", "en"],
        },
      ]);
    });
  });

  it("a one-language venue gets its empty names in that language", async () => {
    await inVenue(ONE, async (tx, lunch) => {
      const blank = await product(tx, lunch, "Pa", null);
      const empty = await product(tx, lunch, "Oli", {});
      const named = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      const glass = await variant(tx, lunch, named, "Copa", null);
      const doneness = await optionList(tx, "Punt", null);
      const rare = await optionLabel(tx, doneness, "Poc", {});
      await extraList(tx, "Salses", null);
      const bar = await createCatalogue(tx, { name: "STAFF Bar", names: { ca: "CLIENT-CA Bar" } });
      const barRoot = await rootOf(tx, bar.id);
      await tx.update(sections).set({ names: {} }).where(eq(sections.id, barRoot));
      const mains = await section(tx, lunch.menuId, "Plats", {});
      const expected = (
        kind: SuggestionItem["kind"],
        id: string,
        family: string,
        staffName: string,
      ): SuggestionItem => ({
        ref: `${kind}:${id}`,
        kind,
        family,
        category: null,
        staffName,
        existing: {},
        missing: ["ca"],
      });
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual(
        inListOrder([
          expected("product", blank, `product:${blank}`, "STAFF Pa"),
          expected("product", empty, `product:${empty}`, "STAFF Oli"),
          expected("variant", glass, `product:${named}`, "STAFF Copa"),
          expected("option_list", doneness, `option_list:${doneness}`, "STAFF Punt"),
          expected("option_label", rare, `option_list:${doneness}`, "STAFF Poc"),
          expected("menu", barRoot, `menu:${barRoot}`, "STAFF Bar"),
          expected("section", mains, `menu:${lunch.rootId}`, "STAFF Plats"),
        ]),
      );
    });
  });

  it("a name blank in every language is asked for in every language", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: " ", es: "" });
      const [item] = await collectSuggestionItems(tx, context, new Set());
      expect(item).toMatchObject({
        ref: `product:${pa}`,
        existing: {},
        missing: ["ca", "es", "en"],
      });
    });
  });

  it("leaves out an extras list with no customer-facing name and keeps a partly named one", async () => {
    await inVenue(THREE, async (tx) => {
      await extraList(tx, "Salses", null);
      await extraList(tx, "Postres", {});
      const sides = await extraList(tx, "Guarnició", { ca: "CLIENT-CA Guarnició" });
      expect(
        (await collectSuggestionItems(tx, context, new Set())).map(({ ref, missing }) => ({
          ref,
          missing,
        })),
      ).toEqual([{ ref: `extra_list:${sides}`, missing: ["es", "en"] }]);
    });
  });

  it("never asks for a language the item already has, and sends only enabled languages as existing", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa", fr: "CLIENT-FR Pain" });
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        expect.objectContaining({
          ref: `product:${pa}`,
          existing: { ca: "CLIENT-CA Pa" },
          missing: ["es", "en"],
        }),
      ]);
    });
  });

  it("leaves out a language with a waiting suggestion and an item with a waiting placeholder, and reads the gaps before either", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const half = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const placeholder = await product(tx, lunch, "Oli", { ca: "CLIENT-CA Oli" });
      const fixed = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      const covered = await product(tx, lunch, "Sal", { ca: "CLIENT-CA Sal" });
      const complete = await product(tx, lunch, "Mel", {
        ca: "CLIENT-CA Mel",
        es: "CLIENT-ES Miel",
        en: "CLIENT-EN Honey",
      });
      await tx.insert(contentSuggestions).values([
        { kind: "product", itemId: half, language: "es", text: "CLIENT-ES Pan", expected: "{}" },
        { kind: "product", itemId: placeholder, language: null, placeholder: true },
        {
          kind: "product",
          itemId: fixed,
          language: null,
          fixField: "internal",
          fixWrong: "Vi",
          fixRight: "Vino",
        },
        { kind: "product", itemId: covered, language: "es", text: "CLIENT-ES Sal", expected: "{}" },
        {
          kind: "product",
          itemId: covered,
          language: "en",
          text: "CLIENT-EN Salt",
          expected: "{}",
        },
        {
          kind: "product",
          itemId: complete,
          language: "es",
          text: "CLIENT-ES Miel nueva",
          expected: "{}",
        },
      ]);

      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items.map(({ ref, missing }) => ({ ref, missing }))).toEqual(
        inListOrder([
          { ref: `product:${half}`, missing: ["en"] },
          { ref: `product:${fixed}`, missing: ["es", "en"] },
        ]),
      );
      const gaps = await readSuggestionGaps(tx, context);
      expect(sortRefs([...gaps.keys()])).toEqual(
        sortRefs([half, placeholder, fixed, covered].map((id) => `product:${id}`)),
      );
      for (const gap of gaps.values()) expect([...gap.missing]).toEqual(["es", "en"]);
    });
  });

  it("sends no blank name as existing when a waiting suggestion covers its language", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      await tx
        .update(products)
        .set({ customerName: { ca: "CLIENT-CA Pa", es: "   " } })
        .where(eq(products.id, pa));
      await tx.insert(contentSuggestions).values({
        kind: "product",
        itemId: pa,
        language: "es",
        text: "CLIENT-ES Pan",
        expected: "{}",
      });
      expect(await collectSuggestionItems(tx, context, new Set())).toEqual([
        expect.objectContaining({
          ref: `product:${pa}`,
          existing: { ca: "CLIENT-CA Pa" },
          missing: ["en"],
        }),
      ]);
    });
  });

  it("walks every page of the listing and resolves past one batch of 100", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      await tx.insert(products).values(
        Array.from({ length: 120 }, (_, index) => ({
          catalogueId: lunch.menuId,
          name: `STAFF Item ${index}`,
          kitchenName: `KITCHEN Item ${index}`,
          customerName: { ca: `CLIENT-CA Item ${index}` },
          pricingUnit: "each",
          unitPrice: 300,
          vatClass: "reduced",
        })),
      );
      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items).toHaveLength(120);
      expect(new Set(items.map((item) => item.ref)).size).toBe(120);
      expect(items.every((item) => item.missing.join() === "es,en")).toBe(true);
    });
  });

  it("leaves out every excluded ref", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", null);
      const oli = await product(tx, lunch, "Oli", null);
      const items = await collectSuggestionItems(tx, context, new Set([`product:${pa}`]));
      expect(items.map((item) => item.ref)).toEqual([`product:${oli}`]);
    });
  });

  it.each<[string, ContentLanguages]>([
    ["a one-language venue", ONE],
    ["a three-language venue", THREE],
  ])(
    "leaves out a deleted product and every variant of a deleted product in %s",
    async (_, config) => {
      await inVenue(config, async (tx, lunch) => {
        const live = await product(tx, lunch, "Pa", null);
        const gone = await product(tx, lunch, "Coca", null);
        await variant(tx, lunch, gone, "Coca petita", null);
        await deactivateProduct(tx, gone);
        const closed = await product(tx, lunch, "Vermut", { ca: "CLIENT-CA Vermut" });
        await variant(tx, lunch, closed, "Vermut gran", null);
        // The variant row stays active: only its product's flag says the family is gone.
        await tx.update(products).set({ active: false }).where(eq(products.id, closed));
        expect(
          (await collectSuggestionItems(tx, context, new Set())).map((item) => item.ref),
        ).toEqual([`product:${live}`]);
      });
    },
  );

  it("leaves out an item Cloud would refuse, and a name or a category it would refuse, without refusing the rest", async () => {
    await inVenue(THREE, async (tx, lunch) => {
      const blankStaff = await product(tx, lunch, "Blank", { ca: "CLIENT-CA Blanc" });
      await rename(tx, blankStaff, "   ");
      const longStaff = await product(tx, lunch, "Long", { ca: "CLIENT-CA Llarg" });
      await rename(tx, longStaff, "S".repeat(TEXT_LIMIT + 1));
      const edge = await product(tx, lunch, "Edge", { ca: "CLIENT-CA Vora" });
      await rename(tx, edge, "S".repeat(TEXT_LIMIT));
      const longName = await product(tx, lunch, "Pa", {
        ca: "C".repeat(TEXT_LIMIT + 1),
        es: "CLIENT-ES Pan",
      });
      const blankCategory = await createCategory(tx, { name: "Blank" });
      await tx.update(categories).set({ name: "   " }).where(eq(categories.id, blankCategory.id));
      const unnamed = await product(tx, lunch, "Oli", { ca: "CLIENT-CA Oli" }, blankCategory.id);
      const unnamedVariant = await variant(tx, lunch, unnamed, "Oli petit", {
        ca: "CLIENT-CA Oli petit",
      });
      const longCategory = await createCategory(tx, { name: "Long" });
      await tx
        .update(categories)
        .set({ name: "C".repeat(TEXT_LIMIT + 1) })
        .where(eq(categories.id, longCategory.id));
      const shut = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" }, longCategory.id);
      await variant(tx, lunch, shut, "Vi negre", { ca: "CLIENT-CA Vi negre" });

      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items.map((item) => item.ref)).toEqual(
        sortRefs([
          `product:${edge}`,
          `product:${longName}`,
          `product:${unnamed}`,
          `variant:${unnamedVariant}`,
        ]),
      );
      const byRef = new Map(items.map((item) => [item.ref, item]));
      expect(byRef.get(`product:${edge}`)!.staffName).toBe("S".repeat(TEXT_LIMIT));
      expect(byRef.get(`product:${longName}`)).toMatchObject({ missing: ["en"] });
      expect(byRef.get(`product:${longName}`)!.existing).toEqual({ es: "CLIENT-ES Pan" });
      expect(byRef.get(`product:${unnamed}`)!.category).toBeNull();
      expect(byRef.get(`variant:${unnamedVariant}`)!.category).toBeNull();
    });
  });
});
