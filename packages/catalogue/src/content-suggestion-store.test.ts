import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products } from "@waitron/db";
import { deactivateProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import { resolveTranslationTargets } from "./content-translation-targets.js";
import { saveContentTranslations } from "./content-translations.js";
import { setProductVariants } from "./variants.js";
import { readSuggestionRun, recordSuggestionJobReleased } from "./content-suggestion-jobs.js";
import { storeSuggestionResults } from "./content-suggestion-store.js";
import type { SuggestionResults } from "./content-suggestion-types.js";
import { contentSuggestions } from "./schema/suggestions.js";
import {
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
const store = (jobId: string, results: SuggestionResults) =>
  app((tx) => storeSuggestionResults(tx, jobId, results, context, at));
const done = (results: SuggestionResults["results"], failed: string[] = []): SuggestionResults => ({
  state: "done",
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
    const { targets } = await resolveTranslationTargets(
      tx,
      "es",
      [{ kind: "product", id: venue.bread }],
      context,
    );
    await saveContentTranslations(
      tx,
      "es",
      {
        edits: [
          {
            kind: "product",
            id: venue.bread,
            expected: targets[0]!.target.expected,
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

it("counts sent items with nothing usable, or not answered, as failed", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await store(job.id, {
    state: "partly_done",
    reason: "provider_failed",
    results: [result(ref(venue.bread), { es: "   " })],
    failed: [ref(venue.wine), "product:unknown"],
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

type Answer = (bread: string) => SuggestionResults["results"][number];

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
