import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "../migrations.js";
import { contentSuggestionJobs, contentSuggestions } from "./suggestions.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const job = {
  runId: crypto.randomUUID(),
  position: 1,
  state: "submitting" as const,
  sent: {},
  runTotal: 1,
};

it("deleting a job keeps its suggestions and clears their job", async () => {
  await withTransaction(suite.db, async (tx) => {
    const [j] = await tx.insert(contentSuggestionJobs).values(job).returning();
    await tx.insert(contentSuggestions).values({
      jobId: j!.id,
      kind: "product",
      itemId: "p1",
      language: "ca",
      text: "Pa",
      expected: "{}",
    });
    await tx.delete(contentSuggestionJobs);
    const [s] = await tx.select().from(contentSuggestions);
    expect(s).toMatchObject({ jobId: null, text: "Pa" });
  });
});

it("refuses a second suggestion for the same item and language", async () => {
  const insert = () =>
    withTransaction(suite.db, (tx) =>
      tx
        .insert(contentSuggestions)
        .values({ kind: "unit", itemId: "u1", language: "es", text: "Kilo", expected: "{}" }),
    );
  await insert();
  await expect(insert()).rejects.toThrow(/UNIQUE constraint failed: content_suggestions/);
});

it("refuses a named suggestion without the token it was made from", async () => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx
        .insert(contentSuggestions)
        .values({ kind: "unit", itemId: "u2", language: "es", text: "Kilo" }),
    ),
  ).rejects.toThrow(/content_suggestions_name_ck/);
});

it("refuses a job state outside the list", async () => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.insert(contentSuggestionJobs).values({ ...job, state: "paused" as never }),
    ),
  ).rejects.toThrow(/content_suggestion_jobs_state_ck/);
});

it.each([
  { fixField: "es", fixWrong: null, fixRight: null },
  { fixField: null, fixWrong: "Pan", fixRight: null },
  { fixField: null, fixWrong: null, fixRight: "Pa" },
  { fixField: "es", fixWrong: "Pan", fixRight: null },
  { fixField: "es", fixWrong: null, fixRight: "Pa" },
  { fixField: null, fixWrong: "Pan", fixRight: "Pa" },
])("refuses a fix with some of its three columns set: %o", async (fix) => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.insert(contentSuggestions).values({ kind: "unit", itemId: "u3", language: "es", ...fix }),
    ),
  ).rejects.toThrow(/content_suggestions_fix_ck/);
});

it("refuses a named suggestion without a language", async () => {
  await expect(
    withTransaction(suite.db, (tx) =>
      tx
        .insert(contentSuggestions)
        .values({ kind: "unit", itemId: "u4", language: null, text: "Kilo", expected: "{}" }),
    ),
  ).rejects.toThrow(/content_suggestions_text_language_ck/);
});

it("accepts a whole fix, a placeholder and a named suggestion", async () => {
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(contentSuggestions).values([
      {
        kind: "unit",
        itemId: "u5",
        language: "es",
        fixField: "es",
        fixWrong: "Pan",
        fixRight: "Pa",
      },
      {
        kind: "unit",
        itemId: "u5",
        language: null,
        fixField: "internal",
        fixWrong: "Kilo",
        fixRight: "Kilogram",
        placeholder: true,
      },
      { kind: "unit", itemId: "u6", language: "ca", text: "Quilo", expected: "{}" },
    ]);
    expect(await tx.select().from(contentSuggestions)).toHaveLength(3);
  });
});
