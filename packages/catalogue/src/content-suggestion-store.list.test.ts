import { describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { products } from "@waitron/db";
import { deactivateProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import type { TranslationCellEdit } from "./content-translation-types.js";
type TranslationBatch = { edits: TranslationCellEdit[] };
import { resolveTranslationCells } from "./content-translation-cells.js";
import { saveContentTranslations } from "./content-translations.js";
import { BATCH_SIZE } from "./batches.js";
import { pruneSuggestions } from "./content-suggestion-collect.js";
import { recordSuggestionJobReleased, startSuggestionRun } from "./content-suggestion-jobs.js";
import {
  discardContentSuggestion,
  listContentSuggestions,
  storeSuggestionPage,
  suggestionStale,
} from "./content-suggestion-store.js";
import type { ContentSuggestionView } from "./content-suggestion-types.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
  addPlainProducts,
  context,
  inOrder,
  ref,
  result,
  runningJob,
  seedSuggestionVenue,
  suggestionRows,
  suggestionSuite,
  type SuggestionVenue,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();

/** One finished, released job that wrote every missing name, an internal fix for Bread and a fix
 * to Cheese's entered Catalan name. */
async function storedVenue(): Promise<SuggestionVenue> {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    await storeSuggestionPage(
      tx,
      job.id,
      {
        state: "done",
        cursor: 0,
        nextCursor: null,
        failed: [],
        results: [
          result(
            ref(venue.bread),
            { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" },
            { corrections: [{ field: "internal", wrong: "Bread", right: "Bred" }] },
          ),
          result(ref(venue.wine), {
            ca: "CLIENT-CA Vi",
            es: "CLIENT-ES Vino",
            en: "CLIENT-EN Wine",
          }),
          result(
            ref(venue.cheese),
            { en: "CLIENT-EN Cheese" },
            { corrections: [{ field: "ca", wrong: "Formatge", right: "Formatges" }] },
          ),
        ],
      },
      context,
    );
    await recordSuggestionJobReleased(tx, job.id);
  });
  return venue;
}
const page = (language: string, after?: string) =>
  app((tx) => listContentSuggestions(tx, language, after === undefined ? {} : { after }, context));
const summary = (views: readonly ContentSuggestionView[]) =>
  inOrder(
    views.map(({ itemId, language, text, placeholder, fix, stale }) => ({
      itemId,
      language,
      text,
      placeholder,
      fix,
      stale,
    })),
  );
const named = (itemId: string, language: string, text: string) => ({
  itemId,
  language,
  text,
  placeholder: false,
  fix: null,
  stale: false,
});

it("lists the page language, the default language and the item rows", async () => {
  const venue = await storedVenue();
  const listed = await page("es");
  expect(listed.language).toBe("es");
  expect(listed.next).toBeNull();
  expect(listed.run).toMatchObject({ state: "done", waiting: 6 });
  expect(listed.suggestions.every((view) => view.kind === "product")).toBe(true);
  expect(summary(listed.suggestions)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
        stale: false,
      },
      named(venue.bread, "es", "CLIENT-ES Pan"),
      named(venue.wine, "ca", "CLIENT-CA Vi"),
      named(venue.wine, "es", "CLIENT-ES Vino"),
      {
        itemId: venue.cheese,
        language: "ca",
        text: null,
        placeholder: false,
        fix: { field: "ca", wrong: "Formatge", right: "Formatges" },
        stale: true,
      },
    ]),
  );
  expect((await page("ca")).suggestions.map((view) => view.language).sort()).toEqual([
    "ca",
    "ca",
    null,
  ]);
});

it("lists 100 suggestions a page, by id", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const ids = await app(async (tx) => {
    const created = await addPlainProducts(tx, venue.menuId, 120);
    await tx.insert(contentSuggestions).values(
      created.map((itemId) => ({
        kind: "product" as const,
        itemId,
        language: "en",
        text: "CLIENT-EN Tapa",
        expected: "{}",
      })),
    );
    return created;
  });
  const first = await page("en");
  expect(first.suggestions).toHaveLength(100);
  expect(first.next).toBe(first.suggestions.at(-1)!.id);
  const second = await page("en", first.next!);
  expect(second.suggestions).toHaveLength(20);
  expect(second.next).toBeNull();
  expect([...first.suggestions, ...second.suggestions].map((view) => view.itemId).sort()).toEqual(
    [...ids].sort(),
  );
});

it("refuses a language the venue has not enabled with content.languages_invalid", async () => {
  await seedSuggestionVenue(suite.db);
  await expect(page("fr")).rejects.toMatchObject({ code: "content.languages_invalid" });
});

it("a language added after the job leaves the suggestions current", async () => {
  const venue = await storedVenue();
  await app((tx) =>
    writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en", "fr"] }),
  );
  const [stored] = await app((tx) =>
    tx
      .select()
      .from(contentSuggestions)
      .where(
        and(eq(contentSuggestions.itemId, venue.bread), eq(contentSuggestions.language, "es")),
      ),
  );
  const { targets } = await app((tx) =>
    resolveTranslationTargets(tx, "es", [{ kind: "product", id: venue.bread }], context),
  );
  expect(stored!.expected).not.toBe(targets[0]!.target.expected);
  const { suggestions } = await page("es");
  expect(
    suggestions.find((view) => view.itemId === venue.bread && view.language === "es"),
  ).toMatchObject({
    text: "CLIENT-ES Pan",
    stale: false,
  });
  expect(suggestions.filter((view) => view.text !== null).every((view) => !view.stale)).toBe(true);
});

it("marks a suggestion stale once that item's text in that language changes, and only then", async () => {
  const venue = await storedVenue();
  await app((tx) =>
    tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Pa", en: "CLIENT-EN Bread typed" } })
      .where(eq(products.id, venue.bread)),
  );
  const english = (await page("en")).suggestions;
  expect(
    english.find((view) => view.itemId === venue.bread && view.language === "en"),
  ).toMatchObject({
    stale: true,
  });
  const spanish = (await page("es")).suggestions;
  expect(
    spanish.find((view) => view.itemId === venue.bread && view.language === "es"),
  ).toMatchObject({
    stale: false,
  });
});

it("a suggestion for a deleted product is neither listed nor kept by the next run", async () => {
  const venue = await storedVenue();
  await app((tx) => deactivateProduct(tx, venue.wine));
  const listed = (await page("es")).suggestions.map((view) => view.itemId);
  expect(listed).not.toContain(venue.wine);
  expect(listed).toContain(venue.bread);
  await app((tx) => startSuggestionRun(tx, context));
  const rows = await app(suggestionRows);
  expect(rows.map((row) => row.itemId)).not.toContain(venue.wine);
  expect(rows.filter((row) => row.itemId === venue.bread)).toHaveLength(3);
});

it("starting a run prunes suggestions for names that were filled elsewhere", async () => {
  const venue = await storedVenue();
  await app(async (tx) => {
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Pa", es: "CLIENT-ES Pan del editor" } })
      .where(eq(products.id, venue.bread));
    await tx
      .update(products)
      .set({
        customerName: {
          ca: "CLIENT-CA Formatge",
          es: "CLIENT-ES Queso",
          en: "CLIENT-EN Cheese typed",
        },
      })
      .where(eq(products.id, venue.cheese));
  });
  await app((tx) => startSuggestionRun(tx, context));
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
      },
      {
        itemId: venue.bread,
        language: "en",
        text: "CLIENT-EN Bread",
        placeholder: false,
        fix: null,
      },
      { itemId: venue.wine, language: "ca", text: "CLIENT-CA Vi", placeholder: false, fix: null },
      { itemId: venue.wine, language: "es", text: "CLIENT-ES Vino", placeholder: false, fix: null },
      { itemId: venue.wine, language: "en", text: "CLIENT-EN Wine", placeholder: false, fix: null },
      {
        itemId: venue.cheese,
        language: "ca",
        text: null,
        placeholder: false,
        fix: { field: "ca", wrong: "Formatge", right: "Formatges" },
      },
    ]),
  );
});

it("pruning deletes every suggestion that is no longer needed, past one statement's batch", async () => {
  const venue = await storedVenue();
  await app(async (tx) => {
    const filled = await addPlainProducts(tx, venue.menuId, BATCH_SIZE + 1);
    await tx.insert(contentSuggestions).values(
      filled.map((itemId) => ({
        kind: "product" as const,
        itemId,
        language: "en",
        text: "CLIENT-EN Tapa",
        expected: "{}",
      })),
    );
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Tapa", es: "CLIENT-ES Tapa", en: "CLIENT-EN Tapa" } })
      .where(inArray(products.id, filled));
  });
  const before = (await app(suggestionRows)).filter((row) =>
    [venue.bread, venue.wine, venue.cheese].includes(row.itemId),
  );
  await app((tx) => pruneSuggestions(tx, context));
  expect(await app(suggestionRows)).toEqual(before);
});

it("discarding a suggestion deletes it, and discarding it again is content.suggestion_not_found", async () => {
  const venue = await storedVenue();
  const [row] = await app((tx) =>
    tx
      .select()
      .from(contentSuggestions)
      .where(
        and(eq(contentSuggestions.itemId, venue.bread), eq(contentSuggestions.language, "es")),
      ),
  );
  await app((tx) => discardContentSuggestion(tx, row!.id));
  expect(
    (await app(suggestionRows)).filter((r) => r.itemId === venue.bread).map((r) => r.language),
  ).toEqual([null, "en"]);
  await expect(app((tx) => discardContentSuggestion(tx, row!.id))).rejects.toMatchObject({
    code: "content.suggestion_not_found",
    params: { suggestionId: row!.id },
  });
});

describe("saving a name", () => {
  async function saveWine(id: string): Promise<TranslationBatch> {
    return app(async (tx) => {
      const { cells } = await resolveTranslationCells(
        tx,
        [
          { kind: "product", id, language: "es", field: "name" },
          { kind: "product", id, language: "ca", field: "name" },
        ],
        context,
      );
      return {
        edits: cells.map(({ kind, id, language, field, expected }) => ({
          kind,
          id,
          language,
          field,
          expected,
          text: language === "es" ? "CLIENT-ES Vino de la casa" : "CLIENT-CA Vi de la casa",
        })),
      };
    });
  }
  const wineLanguages = async (venue: SuggestionVenue) =>
    (await app(suggestionRows))
      .filter((row) => row.itemId === venue.wine)
      .map((row) => row.language);

  it("deletes its suggestion and its default companion's", async () => {
    const venue = await storedVenue();
    const request = await saveWine(venue.wine);
    await app((tx) => saveContentTranslations(tx, request, context));
    expect(await wineLanguages(venue)).toEqual(["en"]);
  });

  it("deletes each saved item's suggestions in the saved languages, and nothing else", async () => {
    const venue = await storedVenue();
    const request = await app(async (tx) => {
      const refs = [venue.bread, venue.wine, venue.cheese].flatMap((id) => [
        { kind: "product" as const, id, language: "es", field: "name" as const },
        ...(id === venue.wine
          ? [{ kind: "product" as const, id, language: "ca", field: "name" as const }]
          : []),
      ]);
      const { cells } = await resolveTranslationCells(tx, refs, context);
      const { targets } = await resolveTranslationTargets(
        tx,
        "es",
        [venue.bread, venue.wine, venue.cheese].map((id) => ({ kind: "product" as const, id })),
        context,
      );
      return {
        edits: cells.map(({ kind, id, language, field, expected }) => ({
          kind,
          id,
          language,
          field,
          expected,
          text:
            language === "ca"
              ? "CLIENT-CA Vi de la casa"
              : `CLIENT-ES ${targets.find((entry) => entry.target.id === id)!.target.name}`,
        })),
      };
    });
    await app((tx) => saveContentTranslations(tx, request, context));
    const languages = async (itemId: string) =>
      (await app(suggestionRows)).filter((row) => row.itemId === itemId).map((row) => row.language);
    expect(await languages(venue.bread)).toEqual([null, "en"]);
    expect(await languages(venue.wine)).toEqual(["en"]);
    expect(await languages(venue.cheese)).toEqual(["ca", "en"]);
  });

  it("deletes a suggestion that arrived before a retried save", async () => {
    const venue = await storedVenue();
    const request = await saveWine(venue.wine);
    await app((tx) => saveContentTranslations(tx, request, context));
    await app((tx) =>
      tx.insert(contentSuggestions).values({
        kind: "product",
        itemId: venue.wine,
        language: "es",
        text: "CLIENT-ES Vino",
        expected: "{}",
      }),
    );
    expect(await wineLanguages(venue)).toEqual(["en", "es"]);
    await app((tx) => saveContentTranslations(tx, request, context));
    expect(await wineLanguages(venue)).toEqual(["en"]);
  });

  it("puts both suggestions back when the transaction around the save fails after it", async () => {
    const venue = await storedVenue();
    const request = await saveWine(venue.wine);
    await expect(
      app(async (tx) => {
        await saveContentTranslations(tx, request, context);
        expect((await suggestionRows(tx)).filter((row) => row.itemId === venue.wine)).toHaveLength(
          1,
        );
        throw new Error("refused after the save");
      }),
    ).rejects.toThrow("refused after the save");
    expect(await wineLanguages(venue)).toEqual(["ca", "en", "es"]);
    const [wine] = await app((tx) => tx.select().from(products).where(eq(products.id, venue.wine)));
    expect(wine!.customerName).toBeNull();
  });
});

describe("suggestionStale", () => {
  const token = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      ref: { kind: "product", id: "p1" },
      language: "es",
      field: "name",
      structure: {
        role: "product",
        active: true,
        ownerActive: true,
        rootMatched: true,
        parentRole: null,
        childActive: true,
      },
      inheritedSelectedText: null,
      inheritedDefaultText: null,
      owners: { kind: "product", parentId: null },
      selectedText: null,
      defaultText: "CLIENT-CA Pa",
      effectiveSelectedText: null,
      effectiveDefaultText: "CLIENT-CA Pa",
      config: { defaultLanguage: "ca", languages: ["ca", "es"] },
      required: [],
      ...fields,
    });

  it("ignores the language list, the required languages and the default language's text", () => {
    expect(
      suggestionStale(
        token(),
        token({
          config: { defaultLanguage: "ca", languages: ["ca", "en", "es"] },
          required: ["ca"],
          defaultText: "CLIENT-CA Pa nou",
          effectiveDefaultText: "CLIENT-CA Pa nou",
        }),
      ),
    ).toBe(false);
  });
  it.each(["selectedText", "effectiveSelectedText", "inheritedSelectedText"])(
    "is stale once %s changes",
    (key) => {
      expect(suggestionStale(token(), token({ [key]: "CLIENT-ES Pan" }))).toBe(true);
    },
  );
  it("is stale once the owner, the item or the language changes", () => {
    expect(suggestionStale(token(), token({ owners: { kind: "variant", parentId: "p0" } }))).toBe(
      true,
    );
    expect(suggestionStale(token(), token({ ref: { kind: "product", id: "p2" } }))).toBe(true);
    expect(suggestionStale(token(), token({ language: "en" }))).toBe(true);
  });
  it.each(["", "not json", "null", "[]", "3"])(
    "treats a token that is not an object (%j) as stale",
    (bad) => {
      expect(suggestionStale(bad, token())).toBe(true);
      expect(suggestionStale(token(), bad)).toBe(true);
    },
  );
});
