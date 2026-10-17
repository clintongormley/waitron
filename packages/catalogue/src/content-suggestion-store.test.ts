import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { products, withTransaction } from "@waitron/db";
import { deactivateProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import { resolveTranslationCells } from "./content-translation-cells.js";
import { saveContentTranslations } from "./content-translations.js";
import { setProductVariants } from "./variants.js";
import {
  readActiveSuggestionJob,
  readSuggestionRun,
  recordSuggestionJobReleased,
} from "./content-suggestion-jobs.js";
import { discardContentSuggestion, storeSuggestionPage } from "./content-suggestion-store.js";
import type { SuggestionPage } from "./content-suggestion-types.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";
import {
  addOversizedFamily,
  addPlainProducts,
  addProduct,
  allJobs,
  context,
  inOrder,
  ref,
  result,
  runningJob,
  seedSuggestionVenue,
  sortedSent,
  startedJob,
  submitJob,
  suggestionRows,
  suggestionSuite,
  translateAll,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();
const at = new Date("2026-10-14T09:00:00.000Z");
const store = (jobId: string, results: SuggestionPage) =>
  app((tx) => storeSuggestionPage(tx, jobId, results, context, at));
const done = (results: SuggestionPage["results"], failed: string[] = []): SuggestionPage => ({
  state: "done",
  cursor: 0,
  nextCursor: null,
  results,
  failed,
});
const text = (itemId: string, language: string, value: string) => ({
  itemId,
  language,
  text: value,
  placeholder: false,
  fix: null,
});

it("stores each name with the token of the item it was made from", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done([
      result(ref(venue.bread), { es: "  CLIENT-ES Pan  ", en: "CLIENT-EN Bread" }),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "CLIENT-EN Bread"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.wine, "es", "CLIENT-ES Vino"),
      text(venue.wine, "en", "CLIENT-EN Wine"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  await app(async (tx) => {
    for (const row of await tx.select().from(contentSuggestions)) {
      const { targets } = await resolveTranslationTargets(
        tx,
        row.language!,
        [{ kind: row.kind, id: row.itemId }],
        context,
      );
      expect(row).toMatchObject({
        jobId: job.id,
        expected: targets[0]!.target.expected,
        createdAt: at.toISOString(),
      });
    }
  });
  expect((await app(allJobs))[0]).toMatchObject({
    state: "done",
    done: 3,
    failed: 0,
    dropped: 0,
    failedRefs: [],
    failure: null,
    released: false,
    finishedAt: at.toISOString(),
  });
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", waiting: 6 });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "done",
    total: 3,
    progress: 3,
    done: 3,
    failed: 0,
    waiting: 6,
    finishedAt: at.toISOString(),
  });
  expect(await app(allJobs)).toHaveLength(1);
});

it("drops a result for an item it did not send and a name for a language that was not missing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done([
      result("product:unknown", { es: "CLIENT-ES Nada" }),
      result(ref(venue.bread), { ca: "CLIENT-CA Pa nou", es: "CLIENT-ES Pan" }),
      result(ref(venue.bread), { en: "CLIENT-EN Bread again" }),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "   ", en: "x".repeat(4097) }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 5, failed: 0, done: 3 });
  const [bread] = await app((tx) => tx.select().from(products).where(eq(products.id, venue.bread)));
  expect(bread!.customerName).toEqual({ ca: "CLIENT-CA Pa" });
});

it("a name entered during the job is not overwritten or suggested", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    const { cells } = await resolveTranslationCells(
      tx,
      [{ kind: "product", id: venue.bread, language: "es", field: "name" }],
      context,
    );
    await saveContentTranslations(
      tx,
      {
        edits: [
          {
            kind: "product",
            id: venue.bread,
            language: "es",
            field: "name",
            expected: cells[0]!.expected,
            text: "CLIENT-ES Pan de la casa",
          },
        ],
      },
      context,
    );
  });
  await store(
    job.id,
    done(
      [result(ref(venue.bread), { es: "CLIENT-ES Pan sugerido", en: "CLIENT-EN Bread" })],
      [ref(venue.wine), ref(venue.cheese)],
    ),
  );
  expect((await app(suggestionRows)).filter((row) => row.itemId === venue.bread)).toEqual([
    text(venue.bread, "en", "CLIENT-EN Bread"),
  ]);
  const [bread] = await app((tx) => tx.select().from(products).where(eq(products.id, venue.bread)));
  expect(bread!.customerName).toEqual({ ca: "CLIENT-CA Pa", es: "CLIENT-ES Pan de la casa" });
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 1, done: 1, failed: 2 });
});

it("accepts a suggestion over tabs saved during the job because whitespace remains a gap", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Pa", es: "\t" } })
      .where(eq(products.id, venue.bread));
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Formatge", es: "\n" } })
      .where(eq(products.id, venue.cheese));
  });
  await store(
    job.id,
    done(
      [
        result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
        result(
          ref(venue.cheese),
          { en: "CLIENT-EN Cheese" },
          { corrections: [{ field: "es", wrong: "Queso", right: "Quesos" }] },
        ),
      ],
      [ref(venue.wine)],
    ),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "CLIENT-EN Bread"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 1, done: 2, failed: 1 });
});

it("drops names in a language the venue disabled during the job, and counts the items done", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es"] }));
  await store(
    job.id,
    done([
      result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.wine, "es", "CLIENT-ES Vino"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 3, failed: 0, done: 3 });
});

it("drops everything for a product deleted during the job, and counts it done", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => deactivateProduct(tx, venue.wine));
  await store(
    job.id,
    done([
      result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
      result(
        ref(venue.wine),
        { ca: "CLIENT-CA Vi", es: "CLIENT-ES Vino", en: "CLIENT-EN Wine" },
        { corrections: [{ field: "internal", wrong: "Wine", right: "Vine" }] },
      ),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect((await app(suggestionRows)).map((row) => row.itemId)).not.toContain(venue.wine);
  expect(await app(suggestionRows)).toHaveLength(3);
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 4, failed: 0, done: 3 });
});

it("keeps a placeholder and an internal spelling fix on the item's own row, and a fix to an entered name on that language's row", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done([
      result(
        ref(venue.bread),
        { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" },
        {
          corrections: [
            { field: "internal", wrong: "Bread", right: "Bred" },
            { field: "ca", wrong: "Pa", right: "Pà" },
          ],
        },
      ),
      result(ref(venue.wine), {}, { placeholder: true }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
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
        language: "ca",
        text: null,
        placeholder: false,
        fix: { field: "ca", wrong: "Pa", right: "Pà" },
      },
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "CLIENT-EN Bread"),
      { itemId: venue.wine, language: null, text: null, placeholder: true, fix: null },
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 0, failed: 0, done: 3 });
  expect(await app(readSuggestionRun)).toMatchObject({ waiting: 3 });
});

it("drops a fix to a missing or unentered language, a fix that changes nothing, and a second fix for one row", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  await app((tx) =>
    tx.insert(contentSuggestions).values({
      kind: "product",
      itemId: venue.wine,
      language: "es",
      text: "CLIENT-ES Vino esperando",
      expected: "{}",
    }),
  );
  const job = await runningJob(suite.db);
  expect(sortedSent(job.sent)[ref(venue.wine)]).toEqual(["ca", "en"]);
  await store(
    job.id,
    done([
      result(
        ref(venue.bread),
        { es: "CLIENT-ES Pan" },
        {
          corrections: [
            { field: "es", wrong: "Pan", right: "Pa" },
            { field: "fr", wrong: "Pain", right: "Pains" },
            { field: "internal", wrong: "Bread", right: "Bread" },
            { field: "internal", wrong: "Bread", right: "Bred" },
            { field: "internal", wrong: "STAFF", right: "STAF" },
          ],
        },
      ),
      result(
        ref(venue.wine),
        { ca: "CLIENT-CA Vi", en: "CLIENT-EN Wine" },
        { corrections: [{ field: "es", wrong: "Vino", right: "Vinos" }] },
      ),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: false,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
      },
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
      text(venue.wine, "es", "CLIENT-ES Vino esperando"),
      text(venue.wine, "en", "CLIENT-EN Wine"),
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 5, failed: 0, done: 3 });
});

it("counts sent items with nothing usable as failed", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, {
    state: "partly_done",
    cursor: 0,
    nextCursor: null,
    reason: "provider_failed",
    results: [result(ref(venue.bread), { es: "   " })],
    failed: [ref(venue.wine), ref(venue.cheese), "product:unknown"],
  });
  const [stored] = await app(allJobs);
  expect(stored).toMatchObject({
    state: "partly_done",
    failure: null,
    done: 0,
    failed: 3,
    dropped: 1,
  });
  expect(stored!.failedRefs).toEqual([ref(venue.bread), ref(venue.wine), ref(venue.cheese)].sort());
  expect(await app(suggestionRows)).toEqual([]);
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "partly_done",
    code: null,
    fits: null,
    failed: 3,
    progress: 3,
  });
});

it("drops a name returned for a context head and does not count the head as failed", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const { beer, pint } = await app(async (tx) => {
    const beer = await addProduct(tx, venue.menuId, "Beer", {
      ca: "CLIENT-CA Cervesa",
      es: "CLIENT-ES Cerveza",
      en: "CLIENT-EN Beer",
    });
    const [pint] = await setProductVariants(
      tx,
      beer,
      [
        {
          name: "STAFF Pint",
          kitchenName: "KITCHEN Pint",
          customerName: { ca: "CLIENT-CA Pinta" },
          unitPrice: "4.00",
          image: null,
          available: true,
        },
      ],
      "ca",
    );
    return { beer, pint: pint!.id };
  });
  const started = await startedJob(suite.db);
  const items = (JSON.parse(started.body!) as { items: { ref: string; missing: string[] }[] })
    .items;
  expect(items.find((item) => item.ref === ref(beer))).toMatchObject({ missing: [] });
  expect(started.sent).not.toHaveProperty(ref(beer));
  const job = await submitJob(suite.db, started);
  await store(
    job.id,
    done(
      [
        result(ref(beer), { es: "CLIENT-ES Cerveza nueva" }),
        result(`variant:${pint}`, { es: "CLIENT-ES Pinta", en: "CLIENT-EN Pint" }),
      ],
      [ref(venue.bread), ref(venue.wine), ref(venue.cheese)],
    ),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([text(pint, "es", "CLIENT-ES Pinta"), text(pint, "en", "CLIENT-EN Pint")]),
  );
  const [stored] = await app(allJobs);
  expect(stored).toMatchObject({ dropped: 1, failed: 3, done: 1 });
  expect(stored!.failedRefs).not.toContain(ref(beer));
});

it("records a cap-stopped partly done job's failure as limit", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, {
    state: "partly_done",
    cursor: 0,
    nextCursor: null,
    reason: "limit_reached",
    results: [result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" })],
    failed: [ref(venue.wine), ref(venue.cheese)],
  });
  expect((await app(allJobs))[0]).toMatchObject({
    state: "partly_done",
    failure: "limit",
    done: 1,
    failed: 2,
  });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "partly_done",
    code: "content.suggestion_limit_reached",
    fits: 0,
  });
});

it("chains the next job of the run, never including an item the run already sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  const olives = await app((tx) =>
    addProduct(tx, venue.menuId, "Olives", { ca: "CLIENT-CA Olives" }),
  );
  await store(job.id, {
    state: "partly_done",
    cursor: 0,
    nextCursor: null,
    reason: "provider_failed",
    results: [
      result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ],
    failed: [ref(venue.wine)],
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(2);
  expect(jobs[1]).toMatchObject({
    runId: job.runId,
    position: 2,
    state: "submitting",
    cloudJobId: null,
    createdAt: at.toISOString(),
  });
  expect(sortedSent(jobs[1]!.sent)).toEqual({ [ref(olives)]: ["en", "es"] });
  expect(jobs[0]!.runTotal).toBe(4);
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", total: 4, progress: 3 });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "sending",
    total: 4,
    progress: 3,
    done: 2,
    failed: 1,
  });
});

it("ends the run with what it sent when the next job would hold no item", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    // Under 200 languages water has gaps too, and as a product it would come before the variant.
    await deactivateProduct(tx, venue.water);
    await addOversizedFamily(tx, venue.menuId);
  });
  await store(job.id, done(translateAll(job.sent)));
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ state: "done", runTotal: 3, done: 3, failed: 0 });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readSuggestionRun)).toMatchObject({ state: "done", total: 3, progress: 3 });
});

it("brings progress to the run's total across a menu over 1,000 items", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  await app((tx) => addPlainProducts(tx, venue.menuId, 1000));
  const first = await runningJob(suite.db);
  expect(Object.keys(first.sent)).toHaveLength(1000);
  expect(first.runTotal).toBe(1003);
  await store(first.id, done(translateAll(first.sent)));
  let jobs = await app(allJobs);
  expect(jobs).toHaveLength(2);
  expect(Object.keys(jobs[1]!.sent)).toHaveLength(3);
  expect(Object.keys(jobs[1]!.sent).some((key) => Object.hasOwn(first.sent, key))).toBe(false);
  expect(jobs[0]!.runTotal).toBe(1003);
  await app((tx) => recordSuggestionJobReleased(tx, first.id));
  const second = await submitJob(suite.db, jobs[1]!);
  await store(second.id, done(translateAll(second.sent)));
  jobs = await app(allJobs);
  expect(jobs).toHaveLength(2);
  await app((tx) => recordSuggestionJobReleased(tx, second.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "done",
    total: 1003,
    progress: 1003,
    done: 1003,
    failed: 0,
    waiting: 1006,
  });
}, 120_000);

it("a retried store after a crash, or a store for an unknown job, changes nothing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(
    job.id,
    done(
      [result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" })],
      [ref(venue.wine), ref(venue.cheese)],
    ),
  );
  const before = { rows: await app(suggestionRows), jobs: await app(allJobs) };
  await store(job.id, done([result(ref(venue.wine), { ca: "CLIENT-CA Vi" })]));
  await store(randomUUID(), done([result(ref(venue.wine), { ca: "CLIENT-CA Vi" })]));
  expect({ rows: await app(suggestionRows), jobs: await app(allJobs) }).toEqual(before);
});

it("starts no next job after the month's limit stopped one, and the run finishes with what was sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  await app((tx) => addPlainProducts(tx, venue.menuId, 1000));
  const first = await runningJob(suite.db);
  expect(first.runTotal).toBe(1003);
  const [answered, ...rest] = Object.keys(first.sent).sort();
  await store(first.id, {
    state: "partly_done",
    cursor: 0,
    nextCursor: null,
    reason: "limit_reached",
    results: translateAll({ [answered!]: first.sent[answered!]! }),
    failed: rest,
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    state: "partly_done",
    failure: "limit",
    done: 1,
    failed: 999,
    runTotal: 1000,
  });
  expect((await app(suggestionRows)).length).toBeGreaterThan(0);
  await app((tx) => recordSuggestionJobReleased(tx, first.id));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "partly_done",
    total: 1000,
    progress: 1000,
    code: "content.suggestion_limit_reached",
    fits: 0,
  });
}, 120_000);

it("puts a placeholder and an internal fix on one row, and drops a placeholder for a deleted product", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => deactivateProduct(tx, venue.wine));
  await store(
    job.id,
    done([
      result(
        ref(venue.bread),
        {},
        { placeholder: true, corrections: [{ field: "internal", wrong: "Bread", right: "Bred" }] },
      ),
      result(ref(venue.wine), {}, { placeholder: true }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      {
        itemId: venue.bread,
        language: null,
        text: null,
        placeholder: true,
        fix: { field: "internal", wrong: "Bread", right: "Bred" },
      },
      text(venue.cheese, "en", "CLIENT-EN Cheese"),
    ]),
  );
  expect((await app(allJobs))[0]).toMatchObject({ dropped: 1, failed: 0, done: 3 });
});

type Answer = (bread: string) => SuggestionPage["results"][number];

/** Stores `first` for bread in one run, releases it, then stores `second` in a fresh run. */
async function storeInTwoRuns(first: Answer, second: Answer) {
  const venue = await seedSuggestionVenue(suite.db);
  const unanswered = [ref(venue.wine), ref(venue.cheese)];
  const one = await runningJob(suite.db);
  await store(one.id, done([first(venue.bread)], unanswered));
  await app((tx) => recordSuggestionJobReleased(tx, one.id));
  const two = await runningJob(suite.db);
  expect(sortedSent(two.sent)[ref(venue.bread)]).toEqual(["en", "es"]);
  await store(two.id, done([second(venue.bread)], unanswered));
  const rows = await app((tx) =>
    tx.select().from(contentSuggestions).where(eq(contentSuggestions.itemId, venue.bread)),
  );
  return { two, rows };
}

it("a later run replaces the item's own row rather than adding a second one", async () => {
  const { two, rows } = await storeInTwoRuns(
    (bread) =>
      result(
        ref(bread),
        {},
        { corrections: [{ field: "internal", wrong: "Bread", right: "Bred" }] },
      ),
    (bread) =>
      result(
        ref(bread),
        {},
        { placeholder: true, corrections: [{ field: "internal", wrong: "STAFF", right: "Staff" }] },
      ),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    jobId: two.id,
    language: null,
    text: null,
    placeholder: true,
    fixField: "internal",
    fixWrong: "STAFF",
    fixRight: "Staff",
  });
});

it("a later run replaces a fix to an entered name rather than adding a second one", async () => {
  const { two, rows } = await storeInTwoRuns(
    (bread) => result(ref(bread), {}, { corrections: [{ field: "ca", wrong: "Pa", right: "Pà" }] }),
    (bread) =>
      result(ref(bread), {}, { corrections: [{ field: "ca", wrong: "CLIENT", right: "Client" }] }),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    jobId: two.id,
    language: "ca",
    text: null,
    placeholder: false,
    fixField: "ca",
    fixWrong: "CLIENT",
    fixRight: "Client",
  });
});

it("a later run replaces more than one batch of an item's rows in one store", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const ids = await app(async (tx) => {
    const inserted = await tx
      .insert(products)
      .values(
        Array.from({ length: 600 }, (_, n) => ({
          catalogueId: venue.menuId,
          name: `STAFF Racio ${n}`,
          kitchenName: `KITCHEN Racio ${n}`,
          customerName: { ca: `CLIENT-CA Racio ${n}` },
          pricingUnit: "each" as const,
          unitPrice: 300,
          vatClass: "reduced" as const,
        })),
      )
      .returning({ id: products.id });
    return inserted.map((row) => row.id);
  });
  const answer = (sent: Record<string, string[]>, word: string, names: boolean) =>
    ids
      .filter((id) => Object.hasOwn(sent, ref(id)))
      .map((id) =>
        result(
          ref(id),
          names
            ? Object.fromEntries(
                sent[ref(id)]!.map((language) => [language, `${word} ${language}`]),
              )
            : {},
          {
            placeholder: names,
            corrections: [
              { field: "internal", wrong: "STAFF", right: `${word} Staff` },
              { field: "ca", wrong: "CLIENT", right: `${word} Client` },
            ],
          },
        ),
      );
  const seeded = [ref(venue.bread), ref(venue.wine), ref(venue.cheese)];
  const one = await runningJob(suite.db);
  await store(one.id, done(answer(one.sent, "ONE", false), seeded));
  expect(await jobRow(one.id)).toMatchObject({ state: "done", failure: null });
  await app((tx) => recordSuggestionJobReleased(tx, one.id));
  const two = await runningJob(suite.db);
  await store(two.id, done(answer(two.sent, "TWO", true), seeded));
  expect(await jobRow(two.id)).toMatchObject({ state: "done", failure: null });
  const rows = await app((tx) =>
    tx.select().from(contentSuggestions).where(inArray(contentSuggestions.itemId, ids)),
  );
  expect(rows).toHaveLength(600 * 4);
  expect(rows.every((row) => row.jobId === two.id)).toBe(true);
  expect(rows.filter((row) => row.fixRight?.startsWith("ONE"))).toEqual([]);
  expect(new Set(rows.map((row) => `${row.itemId} ${row.language}`)).size).toBe(600 * 4);
}, 120_000);

const page = (
  cursor: number,
  nextCursor: number | null,
  results: SuggestionPage["results"],
  failed: string[] = [],
): SuggestionPage => ({
  state: failed.length > 0 ? "partly_done" : "done",
  cursor,
  nextCursor,
  results,
  failed,
});
const breadNames = (en: string) => ({ es: "CLIENT-ES Pan", en });
const jobRow = async (id: string) => (await app(allJobs)).find((row) => row.id === id)!;

it("a page before the last stores its suggestions and keeps the job running at the next cursor", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  expect(
    await store(job.id, page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))])),
  ).toBe("stored");
  const after = await jobRow(job.id);
  expect(after.state).toBe("running");
  expect(after).toMatchObject({
    collectCursor: 1,
    collectedRefs: [ref(venue.bread)],
    finishedAt: null,
  });
  expect(await app(suggestionRows)).toEqual(
    inOrder([text(venue.bread, "es", "CLIENT-ES Pan"), text(venue.bread, "en", "CLIENT-EN Bread")]),
  );
  expect((await app(readActiveSuggestionJob))?.id).toBe(job.id);
});

it("only the last page finishes the job, counts it and chains the next", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  const olives = await app((tx) =>
    addProduct(tx, venue.menuId, "Olives", { ca: "CLIENT-CA Olives" }),
  );
  await store(job.id, page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))]));
  expect(await app(allJobs)).toHaveLength(1);
  expect(
    await store(
      job.id,
      page(1, null, [result(ref(venue.cheese), { en: "CLIENT-EN Cheese" })], [ref(venue.wine)]),
    ),
  ).toBe("complete");
  const jobs = await app(allJobs);
  expect(jobs[0]).toMatchObject({
    state: "partly_done",
    done: 2,
    failed: 1,
    failedRefs: [ref(venue.wine)],
  });
  expect(jobs).toHaveLength(2);
  expect(sortedSent(jobs[1]!.sent)).toEqual({ [ref(olives)]: ["en", "es"] });
});

it("a page stored again after its transaction committed changes nothing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  const first = page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))]);
  await store(job.id, first);
  const rows = await app(suggestionRows);
  expect(await store(job.id, first)).toBe("stale");
  const after = await jobRow(job.id);
  expect(after.dropped).toBe(0);
  expect(after.collectedRefs).toEqual([ref(venue.bread)]);
  expect(after.collectCursor).toBe(1);
  expect(await app(suggestionRows)).toEqual(rows);
});

it("a page whose transaction rolled back is stored once when fetched again", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  const first = page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))]);
  await expect(
    withTransaction(suite.db, async (tx) => {
      await storeSuggestionPage(tx, job.id, first, context, at);
      throw new Error("rolled back");
    }),
  ).rejects.toThrow("rolled back");
  expect(await store(job.id, first)).toBe("stored");
  const after = await jobRow(job.id);
  expect(after).toMatchObject({ collectCursor: 1, dropped: 0 });
  expect(await app(suggestionRows)).toEqual(
    inOrder([text(venue.bread, "es", "CLIENT-ES Pan"), text(venue.bread, "en", "CLIENT-EN Bread")]),
  );
});

it("a ref repeated on a later page is stored once and counted dropped", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, page(0, 1, [result(ref(venue.bread), breadNames("EN Bread"))]));
  await store(
    job.id,
    page(1, 2, [
      result(ref(venue.bread), breadNames("EN Bread again")),
      result(ref(venue.wine), { ca: "CLIENT-CA Vi" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "EN Bread"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
    ]),
  );
  const after = await jobRow(job.id);
  expect(after.dropped).toBe(1);
  expect(after.collectedRefs).toEqual([ref(venue.bread), ref(venue.wine)]);
});

it("a failed ref already accounted for on an earlier page is ignored and not counted", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))]));
  await store(
    job.id,
    page(
      1,
      null,
      [result(ref(venue.cheese), { en: "CLIENT-EN Cheese" })],
      [ref(venue.bread), ref(venue.wine)],
    ),
  );
  expect((await app(suggestionRows)).filter((row) => row.itemId === venue.bread)).toHaveLength(2);
  expect(await jobRow(job.id)).toMatchObject({
    failedRefs: [ref(venue.wine)],
    dropped: 0,
    done: 2,
    failed: 1,
  });
});

it("a suggestion discarded between pages stays discarded and the next page is stored", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))]));
  await app(async (tx) => {
    const rows = await tx
      .select()
      .from(contentSuggestions)
      .where(eq(contentSuggestions.itemId, venue.bread));
    for (const row of rows) await discardContentSuggestion(tx, row.id);
  });
  await store(
    job.id,
    page(1, null, [
      result(ref(venue.wine), { ca: "CLIENT-CA Vi" }),
      result(ref(venue.cheese), { en: "CLIENT-EN Cheese" }),
    ]),
  );
  expect(await app(suggestionRows)).toEqual(
    inOrder([text(venue.wine, "ca", "CLIENT-CA Vi"), text(venue.cheese, "en", "CLIENT-EN Cheese")]),
  );
  expect((await jobRow(job.id)).state).toBe("done");
});

it("a page for a job that is not running, or at another cursor, is stale", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  const before = await jobRow(job.id);
  expect(
    await store(job.id, page(1, 2, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))])),
  ).toBe("stale");
  expect(await app(suggestionRows)).toEqual([]);
  expect(await jobRow(job.id)).toEqual(before);
  expect(await store(job.id, page(0, null, translateAll(job.sent)))).toBe("complete");
  const rows = await app(suggestionRows);
  const completed = await app(allJobs);
  expect(
    await store(job.id, page(0, null, [result(ref(venue.bread), breadNames("EN Bread later"))])),
  ).toBe("stale");
  expect(await app(suggestionRows)).toEqual(rows);
  expect(await app(allJobs)).toEqual(completed);
});

it("a last page that leaves a sent item unaccounted ends the job without a release", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, page(0, 1, [result(ref(venue.bread), breadNames("CLIENT-EN Bread"))]));
  expect(
    await store(job.id, page(1, null, [result(ref(venue.wine), { ca: "CLIENT-CA Vi" })])),
  ).toBe("ended");
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.state).toBe("failed");
  expect(jobs[0]).toMatchObject({
    failure: "rejected",
    released: true,
    failedRefs: [ref(venue.cheese)],
    failed: 1,
    done: 2,
  });
  expect(await app(suggestionRows)).toEqual(
    inOrder([
      text(venue.bread, "es", "CLIENT-ES Pan"),
      text(venue.bread, "en", "CLIENT-EN Bread"),
      text(venue.wine, "ca", "CLIENT-CA Vi"),
    ]),
  );
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "failed",
    code: "cloud.request_invalid",
  });
});

it("a last page whose accounted items fall short of Cloud's total ends the job", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    tx.update(contentSuggestionJobs).set({ total: 4 }).where(eq(contentSuggestionJobs.id, job.id)),
  );
  expect(await store(job.id, page(0, null, translateAll(job.sent)))).toBe("ended");
  expect(await jobRow(job.id)).toMatchObject({ state: "failed", failure: "rejected" });
  expect(await jobRow(job.id)).toMatchObject({ released: true });
  expect(await app(allJobs)).toHaveLength(1);
});

it("a last page that accounts for Cloud's total but not every sent item ends the job", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    tx.update(contentSuggestionJobs).set({ total: 2 }).where(eq(contentSuggestionJobs.id, job.id)),
  );
  expect(
    await store(
      job.id,
      page(0, null, [
        result(ref(venue.bread), breadNames("CLIENT-EN Bread")),
        result(ref(venue.wine), { ca: "CLIENT-CA Vi" }),
      ]),
    ),
  ).toBe("ended");
  expect(await jobRow(job.id)).toMatchObject({ state: "failed", failure: "rejected" });
  expect(await app(allJobs)).toHaveLength(1);
});

it("a result for an item the box did not send does not by itself fail the walk", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  expect(
    await store(
      job.id,
      page(0, null, [
        ...translateAll(job.sent),
        result("product:unknown", { es: "CLIENT-ES Nada" }),
      ]),
    ),
  ).toBe("complete");
  expect(await jobRow(job.id)).toMatchObject({ state: "done", dropped: 1 });
});
