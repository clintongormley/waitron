import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products } from "@waitron/db";
import { contentSuggestions } from "./schema/suggestions.js";
import { optionLists, optionLabels } from "./schema/options.js";
import { units } from "./schema/units.js";
import { menuDetails } from "./schema/menu.js";
import { sections, sectionMembers } from "./schema/sections.js";
import { addMember } from "./sections.js";
import { createCatalogue } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationCells } from "./content-translation-cells.js";
import { pruneSuggestions } from "./content-suggestion-collect.js";
import {
  listContentSuggestions,
  storeSuggestionResults,
  suggestionStale,
} from "./content-suggestion-store.js";
import type { TranslationCellRef } from "./content-translation-types.js";
import {
  context,
  result,
  runningJob,
  seedSuggestionVenue,
  suggestionSuite,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();
async function corrected(wrong = "CLIENT-CA Pa", field = "ca", label = false) {
  const venue = await seedSuggestionVenue(suite.db);
  let otherListId = "";
  const cell: TranslationCellRef = {
    kind: "product",
    id: venue.bread,
    language: "ca",
    field: "name",
  };
  if (label)
    await app(async (tx) => {
      const [first, second] = await tx
        .insert(optionLists)
        .values([{ name: "First" }, { name: "Second" }])
        .returning();
      otherListId = second!.id;
      const [created] = await tx
        .insert(optionLabels)
        .values({ listId: first!.id, name: "STAFF label", customerName: { ca: "CLIENT-CA Pa" } })
        .returning();
      cell.kind = "option_label";
      cell.id = created!.id;
    });
  const before = await suite.db.select().from(products).orderBy(products.id);
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
            `${cell.kind}:${cell.id}`,
            {},
            {
              corrections: [{ field, wrong, right: "CLIENT-CA Pà" }],
            },
          ),
        ],
      },
      context,
    ),
  );
  expect(await suite.db.select().from(products).orderBy(products.id)).toEqual(before);
  return { venue, cell, otherListId };
}
async function evidence(cell: TranslationCellRef) {
  const [row] = await suite.db
    .select()
    .from(contentSuggestions)
    .where(eq(contentSuggestions.itemId, cell.id));
  return row!;
}
async function latest(cell: TranslationCellRef) {
  return (await app((tx) => resolveTranslationCells(tx, [cell], context))).cells[0]!;
}
async function listed(id: string, language = "ca") {
  return (await app((tx) => listContentSuggestions(tx, language, {}, context))).suggestions.find(
    (view) => view.itemId === id,
  );
}

describe("language correction evidence", () => {
  it("retains the exact resolved name-cell baseline only when current entered text equals wrong", async () => {
    const { cell } = await corrected();
    const stored = await evidence(cell);
    expect(stored).toMatchObject({
      text: null,
      fixField: "ca",
      fixWrong: "CLIENT-CA Pa",
      fixRight: "CLIENT-CA Pà",
      expected: (await latest(cell)).expected,
    });
    expect(JSON.parse(stored.expected!)).toMatchObject({
      field: "name",
      ref: { kind: "product", id: cell.id },
      language: "ca",
      selectedText: "CLIENT-CA Pa",
    });
    expect(await listed(cell.id)).toMatchObject({ stale: false });
  });

  it.each(["Pa", "client-ca pa", " CLIENT-CA Pa "])(
    "keeps mismatching correction %j note-only",
    async (wrong) => {
      const { cell } = await corrected(wrong);
      expect(await evidence(cell)).toMatchObject({ expected: null, text: null, fixWrong: wrong });
      expect(await listed(cell.id)).toMatchObject({ stale: true });
    },
  );

  it("leaves an internal correction as a note without language evidence", async () => {
    const { cell } = await corrected("STAFF Bread", "internal");
    expect(await evidence(cell)).toMatchObject({
      expected: null,
      language: null,
      fixField: "internal",
      text: null,
    });
    expect(await listed(cell.id)).toMatchObject({ stale: false });
  });

  it.each(["changed text", "changed owner", "archived", "removed", "disabled language"] as const)(
    "does not offer a fresh fix after %s",
    async (change) => {
      const { cell, otherListId } = await corrected(
        undefined,
        undefined,
        change === "changed owner",
      );
      const before = await evidence(cell);
      expect(before.expected).toBeTypeOf("string");
      await app(async (tx) => {
        if (change === "changed text")
          await tx
            .update(products)
            .set({ customerName: { ca: "Changed personally" } })
            .where(eq(products.id, cell.id));
        if (change === "changed owner")
          await tx
            .update(optionLabels)
            .set({ listId: otherListId })
            .where(eq(optionLabels.id, cell.id));
        if (change === "archived")
          await tx.update(products).set({ active: false }).where(eq(products.id, cell.id));
        if (change === "removed") await tx.delete(products).where(eq(products.id, cell.id));
        if (change === "disabled language")
          await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
      });
      const view = await listed(cell.id, change === "disabled language" ? "es" : "ca");
      if (view) expect(view.stale).toBe(true);
      expect(await evidence(cell)).toEqual(before);
    },
  );

  it("keeps evidence fresh when unrelated languages, requirements and default text change", async () => {
    const { cell } = await corrected();
    const before = await evidence(cell);
    expect(before.expected).toBeTypeOf("string");
    await app(async (tx) => {
      await writeContentLanguages(tx, {
        defaultLanguage: "es",
        languages: ["ca", "es", "en", "fr"],
      });
      await tx
        .update(products)
        .set({ customerName: { ca: "CLIENT-CA Pa", es: "Different default" } })
        .where(eq(products.id, cell.id));
    });
    expect(await listed(cell.id)).toMatchObject({ stale: false });
    expect((await evidence(cell)).expected).toBe(before.expected);
    expect((await latest(cell)).expected).not.toBe(before.expected);
  });

  it("preserves a fix and internal note after every language becomes complete, while pruning superseded generated text", async () => {
    const { cell } = await corrected();
    await app(async (tx) => {
      await tx.insert(contentSuggestions).values([
        { kind: "product", itemId: cell.id, language: null, placeholder: true },
        {
          kind: "product",
          itemId: cell.id,
          language: "en",
          text: "Suggested bread",
          expected: "{}",
        },
      ]);
      await tx
        .update(products)
        .set({ customerName: { ca: "CLIENT-CA Pa", es: "Pan", en: "Bread" } })
        .where(eq(products.id, cell.id));
      await pruneSuggestions(tx, context);
    });
    expect(
      (await suite.db.select().from(contentSuggestions)).map((row) => ({
        language: row.language,
        fixField: row.fixField,
        placeholder: row.placeholder,
      })),
    ).toEqual(
      expect.arrayContaining([
        { language: "ca", fixField: "ca", placeholder: false },
        { language: null, fixField: null, placeholder: true },
      ]),
    );
    expect(await suite.db.select().from(contentSuggestions)).toHaveLength(2);
    expect(await listed(cell.id)).toBeDefined();
  });

  it("captures a unit name rather than its abbreviation and preserves unit facts", async () => {
    await seedSuggestionVenue(suite.db);
    const [unit] = await app((tx) =>
      tx
        .insert(units)
        .values({
          staffName: "Staff litre",
          staffAbbreviation: "staff-l",
          name: { ca: "CLIENT Litre" },
          abbreviation: { ca: "cl" },
          precision: 2,
        })
        .returning(),
    );
    const before = await suite.db.select().from(units);
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
              `unit:${unit!.id}`,
              {},
              { corrections: [{ field: "ca", wrong: "CLIENT Litre", right: "CLIENT Litres" }] },
            ),
          ],
        },
        context,
      ),
    );
    const cell: TranslationCellRef = { kind: "unit", id: unit!.id, language: "ca", field: "name" };
    expect(await evidence(cell)).toMatchObject({
      expected: (await latest(cell)).expected,
      fixWrong: "CLIENT Litre",
    });
    expect(await suite.db.select().from(units)).toEqual(before);
  });

  it("captures inherited correction evidence and invalidates it when the root changes", async () => {
    const venue = await seedSuggestionVenue(suite.db);
    const member = await app(async (tx) => {
      const child = await createCatalogue(tx, {
        name: "STAFF child",
        names: { ca: "CLIENT inherited" },
      });
      const roots = await tx.select().from(menuDetails);
      const root = roots.find((row) => row.menuId === venue.menuId)!.rootSectionId;
      const childRoot = roots.find((row) => row.menuId === child.id)!.rootSectionId;
      const included = await addMember(tx, root, { kind: "section", sectionId: childRoot });
      await tx
        .update(sectionMembers)
        .set({ showAsFolder: true, folderOverrides: { names: { es: "Own Spanish" } } })
        .where(eq(sectionMembers.id, included.id));
      return { id: included.id, childRoot };
    });
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
              `included_menu:${member.id}`,
              {},
              {
                corrections: [
                  { field: "ca", wrong: "CLIENT inherited", right: "CLIENT inherited fixed" },
                ],
              },
            ),
          ],
        },
        context,
      ),
    );
    const cell: TranslationCellRef = {
      kind: "included_menu",
      id: member.id,
      language: "ca",
      field: "name",
    };
    expect(await evidence(cell)).toMatchObject({ expected: (await latest(cell)).expected });
    expect(await listed(cell.id)).toMatchObject({ stale: false });
    await app((tx) =>
      tx
        .update(sections)
        .set({ names: { ca: "Changed inherited" } })
        .where(eq(sections.id, member.childRoot)),
    );
    expect(await listed(cell.id)).toMatchObject({ stale: true });
    expect(
      (await suite.db.select().from(sectionMembers).where(eq(sectionMembers.id, member.id)))[0]!
        .folderOverrides.names,
    ).toEqual({ es: "Own Spanish" });
  });
});

describe("name evidence comparison", () => {
  it.each(["field", "structure"] as const)(
    "rejects a changed %s without treating unrelated config as stale",
    async (changed) => {
      const { cell } = await corrected();
      const expected = (await latest(cell)).expected;
      const value = JSON.parse(expected) as Record<string, unknown>;
      if (changed === "field") value.field = "abbreviation";
      else value.structure = { ...(value.structure as Record<string, unknown>), active: false };
      expect(suggestionStale(expected, JSON.stringify(value))).toBe(true);
    },
  );

  it("compares owner and structure facts independent of JSON key order", async () => {
    const { cell } = await corrected();
    const expected = (await latest(cell)).expected;
    const value = JSON.parse(expected) as Record<string, unknown>;
    value.owners = { parentId: null, kind: "product" };
    value.structure = Object.fromEntries(
      Object.entries(value.structure as Record<string, unknown>).reverse(),
    );
    expect(suggestionStale(expected, JSON.stringify(value))).toBe(false);
  });

  it.each(["{}", '{"ref":{}}', '{"field":"name"}'])(
    "rejects incomplete evidence %s even when both strings match",
    (bad) => {
      expect(suggestionStale(bad, bad)).toBe(true);
    },
  );
});

it("rechecks the correction's recorded wrong text as well as its baseline when listing", async () => {
  const { cell } = await corrected();
  await app((tx) =>
    tx
      .update(contentSuggestions)
      .set({ fixWrong: "A different name" })
      .where(eq(contentSuggestions.itemId, cell.id)),
  );
  expect(await listed(cell.id)).toMatchObject({ stale: true });
});
