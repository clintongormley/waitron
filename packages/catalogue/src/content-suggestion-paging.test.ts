import { expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { products } from "@waitron/db";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationCells } from "./content-translation-cells.js";
import { listContentSuggestions, storeSuggestionResults } from "./content-suggestion-store.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
  addPlainProducts,
  context,
  seedSuggestionVenue,
  runningJob,
  result,
  suggestionSuite,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();
const list = (query: { after?: string; configuration?: string; fixesOnly?: true } = {}) =>
  app((tx) => listContentSuggestions(tx, query, context));

it("returns every language with fresh name-cell identity and the current Save token", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const refs = ["ca", "es", "en"].map((language) => ({
    kind: "product" as const,
    id: venue.wine,
    language,
    field: "name" as const,
  }));
  const current = await app((tx) => resolveTranslationCells(tx, refs, context));
  await app((tx) =>
    tx.insert(contentSuggestions).values(
      current.cells.map((cell) => ({
        kind: cell.kind,
        itemId: cell.id,
        language: cell.language,
        text: `CLIENT ${cell.language}`,
        expected: cell.expected,
      })),
    ),
  );
  const page = await list();
  expect(page.config).toEqual({ defaultLanguage: "ca", languages: ["ca", "es", "en"] });
  expect(page.required).toEqual([]);
  expect(page.configuration).toBe(current.configuration);
  expect(page.waitingFixes).toBe(0);
  expect(page.run).toBeNull();
  expect(page.next).toBeNull();
  expect(
    page.suggestions
      .map((view) => ({ cell: view.cell, expected: view.expected, stale: view.stale }))
      .sort((a, b) => a.cell!.language.localeCompare(b.cell!.language)),
  ).toEqual(
    current.cells
      .map(({ kind, id, language, field, expected }) => ({
        cell: { kind, id, language, field },
        expected,
        stale: false,
      }))
      .sort((a, b) => a.cell.language.localeCompare(b.cell.language)),
  );
  await app((tx) =>
    writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en", "fr"] }),
  );
  const refreshed = await list();
  const freshCells = await app((tx) => resolveTranslationCells(tx, refs, context));
  for (const view of refreshed.suggestions) {
    expect(view.expected).toBe(
      freshCells.cells.find((cell) => cell.language === view.language)!.expected,
    );
    expect(view.expected).not.toBe(
      current.cells.find((cell) => cell.language === view.language)!.expected,
    );
    expect(view.stale).toBe(false);
  }
});

it("examines 100 stored rows then the remaining one without repeating ids", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const stored = await app(async (tx) => {
    const ids = await addPlainProducts(tx, venue.menuId, 101);
    return tx
      .insert(contentSuggestions)
      .values(
        ids.map((itemId) => ({
          kind: "product" as const,
          itemId,
          language: "en",
          text: "CLIENT English",
          expected: "{}",
        })),
      )
      .returning();
  });
  const first = await list();
  expect(first.suggestions).toHaveLength(100);
  expect(first.next).toBe([...stored].sort((a, b) => a.id.localeCompare(b.id))[99]!.id);
  const second = await list({ after: first.next!, configuration: first.configuration });
  expect(second.suggestions).toHaveLength(1);
  expect(second.next).toBeNull();
  expect([...first.suggestions, ...second.suggestions].map((view) => view.id).sort()).toEqual(
    stored.map((row) => row.id).sort(),
  );
});

it.each(["inactive", "wrong role", "disabled generated language", "fixes only"] as const)(
  "advances past a fully filtered stored page: %s",
  async (reason) => {
    const venue = await seedSuggestionVenue(suite.db);
    const stored = await app(async (tx) => {
      const ids = await addPlainProducts(tx, venue.menuId, 101);
      const rows = await tx
        .insert(contentSuggestions)
        .values(
          ids.map((itemId) => ({
            kind: "product" as const,
            itemId,
            language: reason === "disabled generated language" ? "fr" : "en",
            text: "CLIENT English",
            expected: "{}",
          })),
        )
        .returning();
      if (reason === "inactive")
        await tx.update(products).set({ active: false }).where(inArray(products.id, ids));
      if (reason === "wrong role")
        await tx
          .update(contentSuggestions)
          .set({ kind: "variant" })
          .where(inArray(contentSuggestions.itemId, ids));
      return rows.sort((a, b) => a.id.localeCompare(b.id));
    });
    const query = reason === "fixes only" ? { fixesOnly: true as const } : {};
    const first = await list(query);
    expect(first.suggestions).toEqual([]);
    expect(first.next).toBe(stored[99]!.id);
    const second = await list({ ...query, after: first.next!, configuration: first.configuration });
    expect(second.suggestions).toEqual([]);
    expect(second.next).toBeNull();
  },
);

it("binds continuation to configuration including required languages", async () => {
  await seedSuggestionVenue(suite.db);
  const first = await list();
  await app((tx) =>
    writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en", "fr"] }),
  );
  await expect(
    list({ after: "last-id", configuration: first.configuration }),
  ).rejects.toMatchObject({
    code: "content.translation_stale",
    params: { scope: "configuration" },
  });
  const current = await list();
  await expect(
    app((tx) =>
      listContentSuggestions(
        tx,
        { after: "last-id", configuration: current.configuration },
        { ...context, required: ["ca"] },
      ),
    ),
  ).rejects.toMatchObject({
    code: "content.translation_stale",
    params: { scope: "configuration" },
  });
});

it("counts complete-row fixes and notes independently of run text, cursor and filter", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const cell = (
    await app((tx) =>
      resolveTranslationCells(
        tx,
        [{ kind: "product", id: venue.water, language: "ca", field: "name" }],
        context,
      ),
    )
  ).cells[0]!;
  await app((tx) =>
    tx.insert(contentSuggestions).values([
      {
        kind: "product",
        itemId: venue.water,
        language: "ca",
        fixField: "ca",
        fixWrong: "CLIENT-CA Aigua",
        fixRight: "CLIENT-CA Aigües",
        expected: cell.expected,
      },
      {
        kind: "product",
        itemId: venue.water,
        language: null,
        placeholder: true,
        fixField: "internal",
        fixWrong: "STAFF Water",
        fixRight: "STAFF Waters",
      },
      { kind: "product", itemId: venue.bread, language: null, placeholder: true },
      {
        kind: "product",
        itemId: venue.bread,
        language: "en",
        text: "CLIENT Bread",
        expected: "{}",
      },
      {
        kind: "product",
        itemId: venue.cheese,
        language: "fr",
        fixField: "fr",
        fixWrong: "Fromage",
        fixRight: "Fromages",
      },
      { kind: "product", itemId: "gone", language: null, placeholder: true },
      { kind: "variant", itemId: venue.wine, language: null, placeholder: true },
    ]),
  );
  const page = await list({ fixesOnly: true });
  expect(page.waitingFixes).toBe(4);
  expect(page.run).toBeNull();
  expect(page.suggestions).toHaveLength(4);
  const fix = page.suggestions.find((row) => row.language === "ca")!;
  expect(fix).toMatchObject({
    cell: { kind: "product", id: venue.water, language: "ca", field: "name" },
    expected: cell.expected,
    text: null,
    stale: false,
  });
  expect(page.suggestions.find((row) => row.language === "fr")).toMatchObject({
    stale: true,
    expected: null,
    cell: { kind: "product", id: venue.cheese, language: "fr", field: "name" },
  });
  expect(
    page.suggestions
      .filter((row) => row.language === null)
      .every((row) => row.cell === null && row.expected === null),
  ).toBe(true);
  const past = await list({ after: "zzzz", configuration: page.configuration });
  expect(past.suggestions).toEqual([]);
  expect(past.waitingFixes).toBe(4);
  await app((tx) => tx.update(products).set({ active: false }).where(eq(products.id, venue.water)));
  expect((await list()).waitingFixes).toBe(2);
});

it.each(
  [
    null,
    [],
    { language: "es" },
    { after: "" },
    { after: "id" },
    { configuration: 1 },
    { configuration: "" },
    { fixesOnly: false },
    { fixesOnly: "1" },
  ].map((query) => [query]),
)("refuses malformed suggestion query %j", async (query) => {
  await seedSuggestionVenue(suite.db);
  await expect(
    app((tx) => listContentSuggestions(tx, query as never, context)),
  ).rejects.toMatchObject({ code: "content.translation_invalid" });
});

it("keeps independently fresh corrections for two entered languages on one item", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  await app((tx) =>
    tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Pa", es: "CLIENT-ES Pan" } })
      .where(eq(products.id, venue.bread)),
  );
  const before = await suite.db.select().from(products).where(eq(products.id, venue.bread));
  const job = await runningJob(suite.db);
  await app((tx) =>
    storeSuggestionResults(
      tx,
      job.id,
      {
        state: "done",
        failed: [],
        results: [
          result(
            `product:${venue.bread}`,
            {},
            {
              corrections: [
                { field: "ca", wrong: "CLIENT-CA Pa", right: "CLIENT-CA Pà" },
                { field: "es", wrong: "CLIENT-ES Pan", right: "CLIENT-ES Panes" },
              ],
            },
          ),
        ],
      },
      context,
    ),
  );
  const current = await app((tx) =>
    resolveTranslationCells(
      tx,
      ["ca", "es"].map((language) => ({
        kind: "product",
        id: venue.bread,
        language,
        field: "name",
      })),
      context,
    ),
  );
  const page = await list({ fixesOnly: true });
  expect(page.waitingFixes).toBe(2);
  expect(
    page.suggestions
      .map(({ cell, expected, fix, stale, text }) => ({ cell, expected, fix, stale, text }))
      .sort((a, b) => a.cell!.language.localeCompare(b.cell!.language)),
  ).toEqual(
    current.cells.map(({ kind, id, language, field, expected }) => ({
      cell: { kind, id, language, field },
      expected,
      fix:
        language === "ca"
          ? { field: "ca", wrong: "CLIENT-CA Pa", right: "CLIENT-CA Pà" }
          : { field: "es", wrong: "CLIENT-ES Pan", right: "CLIENT-ES Panes" },
      stale: false,
      text: null,
    })),
  );
  expect(await suite.db.select().from(products).where(eq(products.id, venue.bread))).toEqual(
    before,
  );
});
