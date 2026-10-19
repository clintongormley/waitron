import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { products } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { writeContentLanguages } from "./content-languages.js";
import { createCatalogue } from "./operations.js";
import {
  markSuggestionRunOpened,
  readActiveSuggestionJob,
  readSuggestionRun,
  recordSuggestionJobEnded,
  recordSuggestionJobProgress,
  recordSuggestionJobRefused,
  recordSuggestionJobReleased,
  recordSuggestionJobSubmitted,
  sentInRun,
  startSuggestionRun,
} from "./content-suggestion-jobs.js";
import { storeSuggestionPage } from "./content-suggestion-store.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";
import {
  addProduct,
  allJobs,
  context,
  ref,
  result,
  runningJob,
  seedSuggestionVenue,
  sortedSent,
  startedJob,
  suggestionSuite,
} from "../test/suggestion-fixture.js";

const { suite, app } = suggestionSuite();
const at = new Date("2026-10-14T09:00:00.000Z");
const later = new Date("2026-10-14T10:00:00.000Z");

it("has no run before the first Translate all", async () => {
  await seedSuggestionVenue(suite.db);
  expect(await app(readSuggestionRun)).toBeNull();
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

it("starts a run as one submitting job holding the body and what it sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const view = await app((tx) => startSuggestionRun(tx, context, at));
  expect(view).toEqual({
    state: "sending",
    total: 3,
    progress: 0,
    done: 0,
    failed: 0,
    code: null,
    fits: null,
    waiting: 0,
    finishedAt: null,
    opened: false,
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    position: 1,
    state: "submitting",
    runTotal: 3,
    cloudJobId: null,
    released: false,
    createdAt: at.toISOString(),
    finishedAt: null,
  });
  expect(sortedSent(jobs[0]!.sent)).toEqual({
    [ref(venue.bread)]: ["en", "es"],
    [ref(venue.wine)]: ["ca", "en", "es"],
    [ref(venue.cheese)]: ["en"],
  });
  const body = JSON.parse(jobs[0]!.body!) as { version: number; items: { ref: string }[] };
  expect(body.version).toBe(1);
  expect(body.items.map((item) => item.ref).sort()).toEqual(
    [ref(venue.bread), ref(venue.wine), ref(venue.cheese)].sort(),
  );
  expect((await app(readActiveSuggestionJob))?.id).toBe(jobs[0]!.id);
});

it("a new job has no collect position and nothing accounted for", async () => {
  await seedSuggestionVenue(suite.db);
  await app((tx) => startSuggestionRun(tx, context, at));
  const [job] = await app(allJobs);
  expect(job!.collectCursor).toBe(null);
  expect(job!.collectedRefs).toEqual([]);
});

it("counts a variant but not its complete product, which travels only as context", async () => {
  await seedTenant(suite.db);
  const { water, small } = await app(async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Carta",
      names: { ca: "CLIENT-CA Carta", es: "CLIENT-ES Carta", en: "CLIENT-EN Menu" },
    });
    const water = await addProduct(tx, menu.id, "Water", {
      ca: "CLIENT-CA Aigua",
      es: "CLIENT-ES Agua",
      en: "CLIENT-EN Water",
    });
    const [row] = await tx
      .insert(products)
      .values({
        catalogueId: menu.id,
        parentId: water,
        name: "STAFF Water small",
        kitchenName: "KITCHEN Water small",
        customerName: { ca: "CLIENT-CA Aigua petita" },
      })
      .returning({ id: products.id });
    return { water, small: row!.id };
  });
  const view = await app((tx) => startSuggestionRun(tx, context, at));
  expect(view).toMatchObject({ total: 1 });
  const [job] = await app(allJobs);
  expect(job!.runTotal).toBe(1);
  expect(job!.sent).toEqual({ [`variant:${small}`]: ["es", "en"] });
  const body = JSON.parse(job!.body!) as { items: { ref: string }[] };
  expect(body.items.map((item) => item.ref)).toEqual([ref(water), `variant:${small}`]);
});

it("refuses a second run while a job is active", async () => {
  await seedSuggestionVenue(suite.db);
  await startedJob(suite.db);
  await expect(app((tx) => startSuggestionRun(tx, context))).rejects.toMatchObject({
    code: "content.suggestion_job_running",
  });
  expect(await app(allJobs)).toHaveLength(1);
});

it("returns null and keeps the last run when nothing is missing", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app(async (tx) => {
    await recordSuggestionJobEnded(tx, job.id, "failed", "rejected", at);
    await tx
      .update(products)
      .set({ customerName: { ca: "CLIENT-CA Ple", es: "CLIENT-ES Lleno", en: "CLIENT-EN Full" } })
      .where(inArray(products.id, [venue.bread, venue.wine, venue.cheese]));
  });
  expect(await app((tx) => startSuggestionRun(tx, context))).toBeNull();
  expect((await app(allJobs)).map((row) => row.id)).toEqual([job.id]);
});

it("starting a run removes the last run's jobs and keeps its suggestions", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const first = await runningJob(suite.db);
  await app(async (tx) => {
    await tx.insert(contentSuggestions).values([
      {
        jobId: first.id,
        kind: "product",
        itemId: venue.bread,
        language: "es",
        text: "CLIENT-ES Pan sugerido",
        expected: "{}",
      },
      {
        jobId: first.id,
        kind: "product",
        itemId: venue.bread,
        language: "ca",
        fixField: "ca",
        fixWrong: "Pa",
        fixRight: "Pà",
      },
    ]);
    await recordSuggestionJobEnded(tx, first.id, "failed", "rejected", at);
  });
  expect(await app((tx) => startSuggestionRun(tx, context, later))).toMatchObject({
    state: "sending",
    waiting: 1,
  });
  const jobs = await app(allJobs);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.id).not.toBe(first.id);
  expect(jobs[0]!.runId).not.toBe(first.runId);
  expect(sortedSent(jobs[0]!.sent)[ref(venue.bread)]).toEqual(["en"]);
  const kept = await app((tx) => tx.select().from(contentSuggestions));
  expect(
    kept
      .map(({ language, text, jobId }) => ({ language, text, jobId }))
      .sort((a, b) => (a.language! < b.language! ? -1 : 1)),
  ).toEqual([
    { language: "ca", text: null, jobId: null },
    { language: "es", text: "CLIENT-ES Pan sugerido", jobId: null },
  ]);
});

it("records Cloud's job and progress, and clears the body once Cloud holds it", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  const cloudJobId = randomUUID();
  await app((tx) => recordSuggestionJobSubmitted(tx, job.id, { jobId: cloudJobId, total: 3 }));
  expect((await app(allJobs))[0]).toMatchObject({
    state: "running",
    cloudJobId,
    total: 3,
    body: null,
  });
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", progress: 0 });
  await app((tx) => recordSuggestionJobProgress(tx, job.id, { done: 2, failed: 0 }));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "running",
    total: 3,
    done: 2,
    failed: 0,
    progress: 2,
  });
});

it("ignores progress for a job not running and a second submit reply", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  await app((tx) => recordSuggestionJobProgress(tx, job.id, { done: 2, failed: 1 }));
  expect((await app(allJobs))[0]).toMatchObject({ state: "submitting", done: 0, failed: 0 });
  const cloudJobId = randomUUID();
  await app((tx) => recordSuggestionJobSubmitted(tx, job.id, { jobId: cloudJobId, total: 3 }));
  await app((tx) => recordSuggestionJobSubmitted(tx, job.id, { jobId: randomUUID(), total: 9 }));
  expect((await app(allJobs))[0]).toMatchObject({ state: "running", cloudJobId, total: 3 });
});

it.each([
  ["consent", null, "content.suggestion_consent_required"],
  ["limit", 6, "content.suggestion_limit_reached"],
  ["job_running", null, "content.suggestion_job_running"],
] as const)(
  "a run whose submit was refused with %s shows its code",
  async (refusal, fits, code) => {
    await seedSuggestionVenue(suite.db);
    const job = await startedJob(suite.db);
    await app((tx) => recordSuggestionJobRefused(tx, job.id, refusal, fits, at));
    expect(await app(readSuggestionRun)).toMatchObject({
      state: "refused",
      code,
      fits,
      finishedAt: at.toISOString(),
    });
    expect((await app(allJobs))[0]).toMatchObject({
      state: "refused",
      refusal,
      fits,
      released: true,
      body: null,
    });
    expect(await app(readActiveSuggestionJob)).toBeUndefined();
  },
);

it.each([
  ["provider", "content.suggestion_service_unavailable", null, false],
  ["consent", "content.suggestion_consent_required", null, false],
  ["limit", "content.suggestion_limit_reached", 0, false],
  ["not_connected", "cloud.not_configured", null, true],
  ["rejected", "cloud.request_invalid", null, true],
] as const)(
  "a job Cloud held that failed with %s shows %s",
  async (failure, code, fits, released) => {
    await seedSuggestionVenue(suite.db);
    const job = await runningJob(suite.db);
    await app((tx) => recordSuggestionJobEnded(tx, job.id, "failed", failure, at));
    expect(await app(readSuggestionRun)).toMatchObject({
      state: "failed",
      code,
      fits,
      finishedAt: at.toISOString(),
    });
    expect((await app(allJobs))[0]).toMatchObject({
      state: "failed",
      failure,
      released,
      body: null,
    });
    expect((await app(readActiveSuggestionJob))?.id).toBe(released ? undefined : job.id);
  },
);

it("a job that ended before Cloud held it is released at once", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await startedJob(suite.db);
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "failed", "provider", at));
  expect((await app(allJobs))[0]).toMatchObject({ state: "failed", released: true, body: null });
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

it.each([
  ["failed", "provider"],
  ["expired", null],
] as const)("leaves a job that is already done alone when told it %s", async (state, failure) => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    storeSuggestionPage(
      tx,
      job.id,
      { state: "done", cursor: 0, nextCursor: null, results: [], failed: Object.keys(job.sent) },
      context,
      at,
    ),
  );
  const before = (await app(allJobs))[0]!;
  expect(before).toMatchObject({ state: "done", released: false });
  await app((tx) => recordSuggestionJobEnded(tx, job.id, state, failure, later));
  expect((await app(allJobs))[0]).toEqual(before);
});

it("an expired job is released and its run shows content.suggestion_expired", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "expired", null, at));
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "expired",
    code: "content.suggestion_expired",
    fits: null,
    finishedAt: at.toISOString(),
  });
  expect((await app(allJobs))[0]).toMatchObject({ released: true });
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
});

it.each([
  ["limit", "content.suggestion_limit_reached", 0],
  [null, null, null],
] as const)(
  "a partly done run with failure %s shows code %s and keeps its counts",
  async (failure, code, fits) => {
    await seedSuggestionVenue(suite.db);
    const job = await runningJob(suite.db);
    await app(async (tx) => {
      await tx
        .update(contentSuggestionJobs)
        .set({ state: "partly_done", failure, done: 2, failed: 1, finishedAt: at.toISOString() })
        .where(eq(contentSuggestionJobs.id, job.id));
      await recordSuggestionJobReleased(tx, job.id);
    });
    expect(await app(readSuggestionRun)).toEqual({
      state: "partly_done",
      total: 3,
      progress: 3,
      done: 2,
      failed: 1,
      code,
      fits,
      waiting: 0,
      finishedAt: at.toISOString(),
      opened: false,
    });
  },
);

it("a done run with items the box could not use shows partly done", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 2, failed: 1, released: true, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, job.id)),
  );
  expect(await app(readSuggestionRun)).toMatchObject({ state: "partly_done", code: null });
});

it("a done job not yet released still counts as active", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 3, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, job.id)),
  );
  expect((await app(readActiveSuggestionJob))?.id).toBe(job.id);
  expect(await app(readSuggestionRun)).toMatchObject({ state: "running", finishedAt: null });
  await expect(app((tx) => startSuggestionRun(tx, context))).rejects.toMatchObject({
    code: "content.suggestion_job_running",
  });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  expect(await app(readActiveSuggestionJob)).toBeUndefined();
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "done",
    total: 3,
    progress: 3,
    finishedAt: at.toISOString(),
  });
});

it("the last job's refusal wins over an earlier job's success", async () => {
  await seedSuggestionVenue(suite.db);
  const first = await runningJob(suite.db);
  await app(async (tx) => {
    await tx
      .update(contentSuggestionJobs)
      .set({ state: "done", done: 3, released: true, finishedAt: at.toISOString() })
      .where(eq(contentSuggestionJobs.id, first.id));
    const [second] = await tx
      .insert(contentSuggestionJobs)
      .values({
        runId: first.runId,
        position: 2,
        state: "submitting",
        body: "{}",
        sent: { "product:later": ["es"] },
        runTotal: 4,
      })
      .returning();
    await recordSuggestionJobRefused(tx, second!.id, "limit", 0, later);
  });
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "refused",
    code: "content.suggestion_limit_reached",
    fits: 0,
    total: 3,
    done: 3,
    finishedAt: later.toISOString(),
  });
});

it("sums done and failed across a run's jobs, keeps the first job's total, and knows what the run sent", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const first = await runningJob(suite.db);
  const other = randomUUID();
  await app(async (tx) => {
    await tx
      .update(contentSuggestionJobs)
      .set({
        state: "done",
        done: 2,
        failed: 1,
        runTotal: 5,
        released: true,
        finishedAt: at.toISOString(),
      })
      .where(eq(contentSuggestionJobs.id, first.id));
    await tx.insert(contentSuggestionJobs).values({
      runId: first.runId,
      position: 2,
      state: "running",
      cloudJobId: randomUUID(),
      sent: { [`product:${other}`]: ["es"], [`unit:${other}`]: ["en"] },
      runTotal: 9,
      done: 1,
      failed: 0,
    });
  });
  expect(await app(readSuggestionRun)).toMatchObject({
    state: "running",
    total: 5,
    done: 3,
    failed: 1,
    progress: 4,
  });
  expect([...(await app((tx) => sentInRun(tx, first.runId)))].sort()).toEqual(
    [
      ref(venue.bread),
      ref(venue.wine),
      ref(venue.cheese),
      `product:${other}`,
      `unit:${other}`,
    ].sort(),
  );
  expect(await app((tx) => sentInRun(tx, randomUUID()))).toEqual(new Set());
});

it("opened is set once, and only after the run has finished", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => markSuggestionRunOpened(tx, at));
  expect(await app(readSuggestionRun)).toMatchObject({ opened: false });
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "failed", "provider", at));
  await app((tx) => markSuggestionRunOpened(tx, at));
  expect(await app(readSuggestionRun)).toMatchObject({ state: "failed", opened: false });
  await app((tx) => recordSuggestionJobReleased(tx, job.id));
  await app((tx) => markSuggestionRunOpened(tx, at));
  await app((tx) => markSuggestionRunOpened(tx, later));
  expect(await app(readSuggestionRun)).toMatchObject({ opened: true });
  expect((await app(allJobs))[0]!.openedAt).toBe(at.toISOString());
});

it("a job ended after some pages counts what it never received as failed", async () => {
  const venue = await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) =>
    storeSuggestionPage(
      tx,
      job.id,
      {
        state: "partly_done",
        cursor: 0,
        nextCursor: 1,
        results: [result(ref(venue.bread), { es: "CLIENT-ES Pan", en: "CLIENT-EN Bread" })],
        failed: [ref(venue.wine)],
      },
      context,
      at,
    ),
  );
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "expired", null, at));
  const [ended] = await app(allJobs);
  expect(ended!.failed).toBe(2);
  expect(ended).toMatchObject({
    failedRefs: [ref(venue.cheese), ref(venue.wine)].sort(),
    done: 1,
  });
  expect(await app(readSuggestionRun)).toMatchObject({ state: "expired", failed: 2 });
});

it("a job ended before any page keeps its counts", async () => {
  await seedSuggestionVenue(suite.db);
  const job = await runningJob(suite.db);
  await app((tx) => recordSuggestionJobProgress(tx, job.id, { done: 1, failed: 1 }));
  await app((tx) => recordSuggestionJobEnded(tx, job.id, "expired", null, at));
  expect((await app(allJobs))[0]).toMatchObject({ done: 1, failed: 1, failedRefs: [] });
});
