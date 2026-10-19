import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  CATALOGUE_MIGRATIONS,
  contentSuggestionJobs,
  contentSuggestions,
  createCatalogue,
  createProduct,
  readActiveSuggestionJob,
  readSuggestionRun,
  startSuggestionRun,
  writeContentLanguages,
  type TranslationContext,
} from "@waitron/catalogue";
import { addOversizedFamily } from "@waitron/catalogue/test/suggestion-fixture.js";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { translationCloudFixture, type FakeJobBody } from "../test/translation-cloud-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
import { refusalOf, type CollectedPage } from "./cloud-translation.js";
import {
  createContentSuggestionRunner,
  JOB_LIFETIME_MS,
  type ContentSuggestionRunnerDeps,
  type RunnerStep,
} from "./content-suggestion-runner.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const context: TranslationContext = { fallbackLanguage: "es-ES", required: [] };
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
type Fake = Awaited<ReturnType<typeof translationCloudFixture>>;

const SUBMIT = "translation-submit";
const STATUS = "translation-status";
const COLLECT = "translation-collect";
const RELEASE = "translation-release";

/** A connected fake Cloud whose last configuration reply carried the translation service. */
async function connected(): Promise<Fake> {
  const f = await translationCloudFixture();
  await f.client.refresh(); // renew: no lease yet
  await f.client.refresh(); // configuration, four services
  expect(await f.client.translationService()).toBe("on");
  return f;
}

/** A venue in Spanish and English with one complete menu and a product per staff name, each missing English. */
async function venue(staffNames: readonly string[]): Promise<string[]> {
  await seedTenant(suite.db);
  return inTx(async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] });
    const menu = await createCatalogue(tx, {
      name: "STAFF Lunch",
      names: { es: "CLIENT-es Almuerzo", en: "CLIENT-en Lunch" },
    });
    const ids: string[] = [];
    for (const name of staffNames) {
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        unitId: null,
        name,
        kitchenName: name.replace("STAFF", "KITCHEN"),
        customerName: { es: name.replace("STAFF", "CLIENT-es") },
        unitPrice: "3.00",
        vatClass: "reduced",
      });
      ids.push(product.id);
    }
    return ids;
  });
}

function deps(
  f: Fake,
  overrides: Partial<ContentSuggestionRunnerDeps> = {},
): ContentSuggestionRunnerDeps {
  return { db: suite.db, connection: f.client, context, isPrimary: () => true, ...overrides };
}

/** A runner whose clock reads `ms` later than the real one. */
function later(f: Fake, ms: number) {
  return createContentSuggestionRunner(deps(f, { now: () => new Date(Date.now() + ms) }));
}

async function runToIdle(
  runner: ReturnType<typeof createContentSuggestionRunner>,
  limit = 20,
): Promise<RunnerStep[]> {
  const steps: RunnerStep[] = [];
  for (let i = 0; i < limit; i++) {
    const next = await runner.step();
    steps.push(next);
    if (next === "idle") return steps;
  }
  throw new Error(`still busy after ${limit} steps: ${steps.join(", ")}`);
}

const actions = (f: Fake) => f.calls.map((call) => call.action);
const runView = () => inTx((tx) => readSuggestionRun(tx));
const suggestions = () =>
  inTx((tx) =>
    tx
      .select({
        itemId: contentSuggestions.itemId,
        language: contentSuggestions.language,
        text: contentSuggestions.text,
      })
      .from(contentSuggestions)
      .orderBy(contentSuggestions.text),
  );

/** A job body the fake accepts, for a job this box did not record. */
const OTHER_BODY = JSON.stringify({
  version: 1,
  country: "ES",
  languages: { default: "es", enabled: ["es", "en"] },
  items: [
    {
      ref: "product:other",
      kind: "product",
      family: "product:other",
      category: null,
      staffName: "STAFF Other",
      existing: {},
      missing: ["en"],
    },
  ],
  houseStyle: [],
} satisfies FakeJobBody);

it("runs a job from submit to release and stores its suggestions", async () => {
  const f = await connected();
  try {
    const [bread, wine] = await venue(["STAFF Bread", "STAFF Wine"]);
    await inTx((tx) => startSuggestionRun(tx, context));

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual([
      "again",
      "wait",
      "again",
      "again",
      "idle",
    ]);
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, RELEASE]);
    expect(await suggestions()).toEqual([
      { itemId: bread, language: "en", text: "EN STAFF Bread" },
      { itemId: wine, language: "en", text: "EN STAFF Wine" },
    ]);
    expect(await runView()).toMatchObject({
      state: "done",
      total: 2,
      done: 2,
      failed: 0,
      progress: 2,
      waiting: 2,
      code: null,
    });
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
  } finally {
    await f.close();
  }
});

it("a lost submit reply is retried after a restart as the same job", async () => {
  const f = await connected();
  try {
    const [bread] = await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const job = (await inTx((tx) => readActiveSuggestionJob(tx)))!;
    f.loseNext(SUBMIT);
    await expect(createContentSuggestionRunner(deps(f)).step()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });

    const restarted = createContentSuggestionRunner(
      deps(f, { connection: createCloudConnection(f.options) }),
    );
    expect(await runToIdle(restarted)).toEqual(["again", "wait", "again", "again", "idle"]);
    expect(f.jobs.size).toBe(1);
    expect(f.submissions.map((s) => s.operationId)).toEqual([job.id, job.id]);
    expect(f.submissions[1]!.body).toBe(f.submissions[0]!.body);
    expect(await suggestions()).toEqual([
      { itemId: bread, language: "en", text: "EN STAFF Bread" },
    ]);
  } finally {
    await f.close();
  }
});

it("a restarted box resumes polling the job it already submitted", async () => {
  const f = await connected();
  try {
    const [bread] = await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const first = createContentSuggestionRunner(deps(f));
    expect(await first.step()).toBe("again");
    expect(await first.step()).toBe("wait");

    const restarted = createContentSuggestionRunner(
      deps(f, { connection: createCloudConnection(f.options) }),
    );
    expect(await runToIdle(restarted)).toEqual(["again", "again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, RELEASE]);
    expect(f.jobs.size).toBe(1);
    expect(await suggestions()).toEqual([
      { itemId: bread, language: "en", text: "EN STAFF Bread" },
    ]);
  } finally {
    await f.close();
  }
});

const cursors = (f: Fake) => f.calls.filter((c) => c.action === COLLECT).map((c) => c.cursor);
const job = () => inTx(async (tx) => (await tx.select().from(contentSuggestionJobs))[0]!);

/** Runner deps whose collect goes through `on`, which decides whether and how the fake is called. */
function lossy(
  f: Fake,
  on: (cursor: number, call: () => Promise<CollectedPage>) => Promise<CollectedPage>,
): ContentSuggestionRunnerDeps {
  return deps(f, {
    connection: {
      ...f.client,
      translation: {
        ...f.client.translation,
        collect: (id, cursor, signal) =>
          on(cursor, () => f.client.translation.collect(id, cursor, signal)),
      },
    },
  });
}

const THREE = ["STAFF Bread", "STAFF Oil", "STAFF Wine"];

it("collects every page, then stores the job as done, then releases it", async () => {
  const f = await connected();
  try {
    await venue(THREE);
    f.pageItems(1);
    await inTx((tx) => startSuggestionRun(tx, context));

    await runToIdle(createContentSuggestionRunner(deps(f)));
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, COLLECT, COLLECT, RELEASE]);
    expect(cursors(f)).toEqual([0, 1, 2]);
    expect(await suggestions()).toHaveLength(3);
    expect(await runView()).toMatchObject({ state: "done", done: 3 });
  } finally {
    await f.close();
  }
});

it("never sends release before the last page is stored", async () => {
  const f = await connected();
  try {
    await venue(THREE);
    f.pageItems(1);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(
      lossy(f, (cursor, call) =>
        cursor === 2 ? Promise.reject(new AppError("cloud.unavailable", {})) : call(),
      ),
    );

    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    await expect(runner.step()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(actions(f)).not.toContain(RELEASE);
    expect(await job()).toMatchObject({ state: "running", collectCursor: 2 });
    expect(await runView()).toMatchObject({ state: "running" });
  } finally {
    await f.close();
  }
});

it("a lost page reply is fetched again at the same position, and nothing is counted twice", async () => {
  const f = await connected();
  try {
    await venue(THREE);
    f.pageItems(1);
    await inTx((tx) => startSuggestionRun(tx, context));
    let lost = false;
    const runner = createContentSuggestionRunner(
      lossy(f, async (cursor, call) => {
        const page = await call();
        if (cursor === 1 && !lost) {
          lost = true;
          throw new AppError("cloud.unavailable", {});
        }
        return page;
      }),
    );

    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    await expect(runner.step()).rejects.toMatchObject({ code: "cloud.unavailable" });
    await runToIdle(runner);
    expect(cursors(f)).toEqual([0, 1, 1, 2]);
    expect(await job()).toMatchObject({ dropped: 0, done: 3 });
  } finally {
    await f.close();
  }
});

it("a restarted box resumes from the saved position", async () => {
  const f = await connected();
  try {
    await venue(THREE);
    f.pageItems(1);
    await inTx((tx) => startSuggestionRun(tx, context));
    const first = createContentSuggestionRunner(
      lossy(f, (cursor, call) =>
        cursor === 1 ? Promise.reject(new TypeError("fetch failed")) : call(),
      ),
    );
    expect(await first.step()).toBe("again");
    expect(await first.step()).toBe("wait");
    await expect(first.step()).rejects.toBeInstanceOf(TypeError);
    const before = cursors(f).length;

    const restarted = createContentSuggestionRunner(
      deps(f, { connection: createCloudConnection(f.options) }),
    );
    await runToIdle(restarted);
    expect(cursors(f).slice(before)[0]).toBe(1);
    expect(await suggestions()).toHaveLength(3);
    expect(actions(f).filter((a) => a === RELEASE)).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it("a refused page (429) resumes at the saved position after back-off", async () => {
  const f = await connected();
  try {
    await venue(THREE);
    f.pageItems(1);
    await inTx((tx) => startSuggestionRun(tx, context));
    let refused = false;
    const runner = createContentSuggestionRunner(
      lossy(f, (cursor, call) => {
        if (cursor === 1 && !refused) {
          refused = true;
          return Promise.reject(refusalOf(429, { error: "rate_limited" }));
        }
        return call();
      }),
    );
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    await expect(runner.step()).rejects.toMatchObject({ code: "cloud.unavailable" });
    const before = cursors(f).length;

    await runner.step();
    expect(cursors(f).slice(before)[0]).toBe(1);
  } finally {
    await f.close();
  }
});

const partly: [string, (f: Fake, refs: string[]) => void, string | null, number | null][] = [
  ["some items failed", (f, refs) => f.failRefs([refs[0]!]), null, null],
  ["the spending cap stopped it", (f) => f.capStop(true), "content.suggestion_limit_reached", 0],
];
it.each(partly)(
  "a job Cloud left partly done because %s keeps what was done",
  async (_name, arrange, code, fits) => {
    const f = await connected();
    try {
      const ids = await venue(["STAFF Bread", "STAFF Wine"]);
      arrange(f, ids.map((id) => `product:${id}`).sort());
      await inTx((tx) => startSuggestionRun(tx, context));

      await runToIdle(createContentSuggestionRunner(deps(f)));
      expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, COLLECT, RELEASE]);
      expect(await runView()).toMatchObject({
        state: "partly_done",
        code,
        fits,
        total: 2,
        done: 1,
        failed: 1,
        progress: 2,
        waiting: 1,
      });
      expect(await suggestions()).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);

const failed: [string, (f: Fake) => void, string][] = [
  ["the provider was down", (f) => f.providerDown(true), "content.suggestion_service_unavailable"],
  ["consent was withdrawn", (f) => f.consentWithdrawn(true), "content.suggestion_consent_required"],
];
it.each(failed)(
  "a job Cloud failed because %s shows why and is released so Cloud deletes it",
  async (_name, arrange, code) => {
    const f = await connected();
    try {
      await venue(["STAFF Bread", "STAFF Wine"]);
      arrange(f);
      await inTx((tx) => startSuggestionRun(tx, context));

      expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual([
        "again",
        "wait",
        "again",
        "again",
        "idle",
      ]);
      expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, RELEASE]);
      expect([...f.jobs.values()].map((job) => job.state)).toEqual(["collected"]);
      expect(await runView()).toMatchObject({ state: "failed", code });
      expect(await suggestions()).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

const gone: [string, (f: Fake, jobId: string) => void][] = [
  ["has expired it", (f, jobId) => f.expire(jobId)],
  ["reports it collected", (f) => f.statusOverride({ state: "collected" })],
];
it.each(gone)("a running job Cloud %s ends expired without a collect", async (_name, arrange) => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    arrange(f, [...f.jobs.values()][0]!.jobId);

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT, STATUS]);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
  } finally {
    await f.close();
  }
});

it("a collect refused as expired ends the job expired", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    f.expire([...f.jobs.values()][0]!.jobId);
    f.statusOverride({ state: "done" });

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT, STATUS, COLLECT]);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
  } finally {
    await f.close();
  }
});

it("a release refused as expired is recorded as released, and the suggestions stay", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    f.expire([...f.jobs.values()][0]!.jobId);

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f).at(-1)).toBe(RELEASE);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    expect(await runView()).toMatchObject({ state: "done", waiting: 1 });
  } finally {
    await f.close();
  }
});

const refusals: [string, (f: Fake) => Promise<unknown> | void, string, number | null][] = [
  ["consent is missing", (f) => f.consent(false), "content.suggestion_consent_required", null],
  ["the spending cap", (f) => f.cap(1), "content.suggestion_limit_reached", 1],
  [
    "another job is running in Cloud",
    (f) => {
      f.hold(true);
      return f.client.translation.submit(randomUUID(), OTHER_BODY);
    },
    "content.suggestion_job_running",
    null,
  ],
];
it.each(refusals)(
  "a submit refused because of %s is recorded as refused and does not block the next run",
  async (_name, arrange, code, fits) => {
    const f = await connected();
    try {
      await venue(["STAFF Bread", "STAFF Wine"]);
      await arrange(f);
      await inTx((tx) => startSuggestionRun(tx, context));
      const before = f.calls.length;

      expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
      expect(actions(f).slice(before)).toEqual([SUBMIT]);
      expect(await runView()).toMatchObject({ state: "refused", code, fits });
      await expect(inTx((tx) => startSuggestionRun(tx, context))).resolves.toMatchObject({
        state: "sending",
      });
    } finally {
      await f.close();
    }
  },
);

it("a body Cloud will never accept ends the job as rejected", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const other = JSON.parse(OTHER_BODY) as FakeJobBody;
    await inTx((tx) =>
      tx.update(contentSuggestionJobs).set({
        body: JSON.stringify({ ...other, items: [{ ...other.items[0]!, kind: "telepathy" }] }),
      }),
    );

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT]);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.request_invalid" });
  } finally {
    await f.close();
  }
});

it("a status Cloud refuses as a request it will never accept ends the job as rejected", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    await inTx((tx) =>
      tx.update(contentSuggestionJobs).set({ state: "running", cloudJobId: "not-a-job-id" }),
    );

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([STATUS]);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.request_invalid" });
  } finally {
    await f.close();
  }
});

it("a release Cloud cannot answer is rethrown and tried again on the next step", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    f.offline();
    await expect(runner.step()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toMatchObject({ released: false });

    f.online();
    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(actions(f).at(-1)).toBe(RELEASE);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
  } finally {
    await f.close();
  }
});

it("an error that is not a Cloud refusal is rethrown and the job kept", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const failure = new TypeError("not a refusal");
    const connection = {
      translationService: () => f.client.translationService(),
      translation: {
        ...f.client.translation,
        submit: () => Promise.reject(failure),
      },
    };

    await expect(createContentSuggestionRunner(deps(f, { connection })).step()).rejects.toBe(
      failure,
    );
    expect(await runView()).toMatchObject({ state: "sending" });
  } finally {
    await f.close();
  }
});

const broken: [string, { state?: "running"; body: null }][] = [
  ["a submitting job with no body", { body: null }],
  ["a running job with no Cloud job", { state: "running", body: null }],
];
it.each(broken)("%s ends rejected without a call", async (_name, patch) => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    await inTx((tx) => tx.update(contentSuggestionJobs).set(patch));

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
    expect(f.calls).toEqual([]);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.request_invalid" });
  } finally {
    await f.close();
  }
});

it("a job Cloud took but whose reply was lost, ended on the box as not connected, is marked released while Cloud still holds it", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.loseNext(SUBMIT);
    await expect(createContentSuggestionRunner(deps(f)).step()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    f.service("unconfigured");
    await f.client.refresh();
    const before = f.calls.length;

    expect(await createContentSuggestionRunner(deps(f)).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.not_configured" });
    const [job] = await inTx((tx) =>
      tx
        .select({
          released: contentSuggestionJobs.released,
          cloudJobId: contentSuggestionJobs.cloudJobId,
        })
        .from(contentSuggestionJobs),
    );
    expect(job).toEqual({ released: true, cloudJobId: null });
    expect([...f.jobs.values()].map((held) => held.state)).toEqual(["queued"]);
  } finally {
    await f.close();
  }
});

it("a job Cloud took but whose reply was lost, ended by the box's own 24-hour clock, is marked released while Cloud still holds it", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.loseNext(SUBMIT);
    await expect(createContentSuggestionRunner(deps(f)).step()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
    const [job] = await inTx((tx) =>
      tx
        .select({
          released: contentSuggestionJobs.released,
          cloudJobId: contentSuggestionJobs.cloudJobId,
        })
        .from(contentSuggestionJobs),
    );
    expect(job).toEqual({ released: true, cloudJobId: null });
    expect([...f.jobs.values()].map((held) => held.state)).toEqual(["queued"]);
  } finally {
    await f.close();
  }
});

it("a job whose call meets a revoked connection ends on the next step as not connected, without a call", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    f.revoke();
    await expect(runner.step()).rejects.toMatchObject({ code: "cloud.unavailable" });
    expect(actions(f)).toEqual([SUBMIT, STATUS]);

    expect(await runner.step()).toBe("again");
    expect(actions(f)).toEqual([SUBMIT, STATUS]);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.not_configured" });
  } finally {
    await f.close();
  }
});

it("an empty job, past Cloud's 20 languages, ends failed as a request Cloud refused", async () => {
  const f = await connected();
  try {
    await seedTenant(suite.db);
    await inTx(async (tx) => {
      const menu = await createCatalogue(tx, { name: "STAFF Lunch" });
      await addOversizedFamily(tx, menu.id);
    });
    await inTx((tx) => startSuggestionRun(tx, context));

    expect(await runToIdle(createContentSuggestionRunner(deps(f)))).toEqual(["again", "idle"]);
    expect(actions(f)).toEqual([SUBMIT]);
    const [sent] = f.submissions.map((s) => JSON.parse(s.body) as FakeJobBody);
    expect(sent!.items).toEqual([]);
    expect(sent!.languages.enabled.length).toBeGreaterThan(20);
    expect(f.jobs.size).toBe(0);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.request_invalid" });
  } finally {
    await f.close();
  }
});

it("a job Cloud switched the service off for ends without a call, and the next run is not refused", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    f.service("unconfigured");
    await f.client.refresh();
    expect(await f.client.translationService()).toBe("off");
    const before = f.calls.length;

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "failed", code: "cloud.not_configured" });
    await expect(inTx((tx) => startSuggestionRun(tx, context))).resolves.toMatchObject({
      state: "sending",
    });
  } finally {
    await f.close();
  }
});

it("a stored job waiting for its release when the service goes off is released without a call", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    f.service("unconfigured");
    await f.client.refresh();
    const before = f.calls.length;

    expect(await runToIdle(runner)).toEqual(["again", "idle"]);
    expect(f.calls).toHaveLength(before);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    expect(await runView()).toMatchObject({ state: "done", waiting: 1, code: null });
  } finally {
    await f.close();
  }
});

it("a running job 24 hours old ends expired without asking Cloud", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.hold(true);
    expect(await createContentSuggestionRunner(deps(f)).step()).toBe("again");
    // The control: a minute short of the lifetime, the runner still polls.
    expect(await later(f, JOB_LIFETIME_MS - 60_000).step()).toBe("wait");
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    await expect(inTx((tx) => startSuggestionRun(tx, context))).resolves.toMatchObject({
      state: "sending",
    });
  } finally {
    await f.close();
  }
});

it("a job Cloud never took ends expired after 24 hours instead of being retried for good", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.offline();
    await expect(createContentSuggestionRunner(deps(f)).step()).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await runView()).toMatchObject({ state: "expired", code: "content.suggestion_expired" });
  } finally {
    await f.close();
  }
});

it("a stored job 24 hours old is released without a call and keeps its state", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f));
    expect(await runner.step()).toBe("again");
    expect(await runner.step()).toBe("wait");
    expect(await runner.step()).toBe("again");
    const before = f.calls.length;

    expect(await later(f, JOB_LIFETIME_MS).step()).toBe("again");
    expect(f.calls).toHaveLength(before);
    expect(await inTx((tx) => readActiveSuggestionJob(tx))).toBeUndefined();
    expect(await runView()).toMatchObject({ state: "done", waiting: 1 });
  } finally {
    await f.close();
  }
});

it("an unreachable Cloud keeps the job and backs off from 5 to 60 seconds, starting again at 5 after a success", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.offline();
    const controller = new AbortController();
    const sleeps: number[] = [];
    const errors: string[] = [];

    await createContentSuggestionRunner(deps(f)).run(controller.signal, {
      onError: (error) => errors.push(codeOf(error)),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 6) f.online();
        if (sleeps.length === 7) f.offline();
        if (sleeps.length === 8) controller.abort();
      },
    });
    // Six failed submits, a submit and a poll that succeed, then a failed poll.
    expect(sleeps).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 5000, 5000]);
    expect(errors).toEqual(Array(7).fill("cloud.unavailable"));
    expect(f.jobs.size).toBe(1);
    expect(await runView()).toMatchObject({ state: "running" });
  } finally {
    await f.close();
  }
});

it("polls no more than once every five seconds while Cloud runs the job", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread", "STAFF Wine"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    f.hold(true);
    const controller = new AbortController();
    const sleeps: number[] = [];

    await createContentSuggestionRunner(deps(f)).run(controller.signal, {
      sleep: async (ms) => {
        sleeps.push(ms);
        if (actions(f).filter((action) => action === STATUS).length === 3) controller.abort();
      },
    });
    expect(actions(f)).toEqual([SUBMIT, STATUS, STATUS, STATUS]);
    expect(sleeps).toEqual([5000, 5000, 5000]);
    expect(await runView()).toMatchObject({ state: "running", total: 2, progress: 1 });
  } finally {
    await f.close();
  }
});

it("chains a menu over 1,000 items within Cloud's limits and never resends an item", async () => {
  const f = await connected();
  try {
    const ids = await venue(
      Array.from({ length: 1005 }, (_, i) => `STAFF Dish ${String(i).padStart(4, "0")}`),
    );
    const refs = ids.map((id) => `product:${id}`).sort();
    // The first ref in the job order, so it is in the first job.
    f.failRefs([refs[0]!]);
    await inTx((tx) => startSuggestionRun(tx, context));

    await runToIdle(createContentSuggestionRunner(deps(f)));
    expect(f.submissions).toHaveLength(2);
    const sent = f.submissions.map((submission) => {
      expect(Buffer.byteLength(submission.body, "utf8")).toBeLessThanOrEqual(1_048_576);
      const items = (JSON.parse(submission.body) as FakeJobBody).items;
      expect(items.length).toBeLessThanOrEqual(1000);
      return items.map((item) => item.ref);
    });
    expect(sent.flat()).toHaveLength(1005);
    expect(new Set(sent.flat())).toEqual(new Set(refs));
    expect(sent.flat().filter((ref) => ref === refs[0])).toHaveLength(1);
    expect(await runView()).toMatchObject({
      state: "partly_done",
      total: 1005,
      done: 1004,
      failed: 1,
      progress: 1005,
      waiting: 1004,
    });
  } finally {
    await f.close();
  }
}, 120_000);

it("does nothing on a node that is not the primary, and waits a minute between looks", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const runner = createContentSuggestionRunner(deps(f, { isPrimary: () => false }));
    expect(await runner.step()).toBe("idle");

    const controller = new AbortController();
    const sleeps: number[] = [];
    await runner.run(controller.signal, {
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) controller.abort();
      },
    });
    expect(sleeps).toEqual([60000, 60000]);
    expect(f.calls).toEqual([]);
    expect(await runView()).toMatchObject({ state: "sending" });
  } finally {
    await f.close();
  }
});

it("wakes at once when a run starts", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    const runner = createContentSuggestionRunner(deps(f));
    const controller = new AbortController();
    let idle = () => {};
    const idling = new Promise<void>((resolve) => {
      idle = resolve;
    });
    const loop = runner.run(controller.signal, {
      sleep: (ms, signal) => {
        if (ms !== 60000) return Promise.resolve();
        idle();
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    await idling;
    await inTx((tx) => startSuggestionRun(tx, context));
    runner.wake();

    await vi.waitFor(() => expect(actions(f)).toContain(SUBMIT), { timeout: 2000 });
    controller.abort();
    await loop;
  } finally {
    await f.close();
  }
});

it("stops during its own idle pause when told to stop", async () => {
  const f = await connected();
  try {
    const controller = new AbortController();
    const loop = createContentSuggestionRunner(deps(f)).run(controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(loop).resolves.toBeUndefined();
    expect(f.calls).toEqual([]);
  } finally {
    await f.close();
  }
});

it("a step that fails because it was stopped ends the loop without reporting an error", async () => {
  const f = await connected();
  try {
    await venue(["STAFF Bread"]);
    await inTx((tx) => startSuggestionRun(tx, context));
    const controller = new AbortController();
    const connection = {
      translation: f.client.translation,
      translationService: async () => {
        controller.abort();
        return f.client.translationService();
      },
    };
    const errors: unknown[] = [];
    const sleeps: number[] = [];

    await createContentSuggestionRunner(deps(f, { connection })).run(controller.signal, {
      onError: (error) => errors.push(error),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(errors).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(await runView()).toMatchObject({ state: "sending" });
  } finally {
    await f.close();
  }
});

it("stops with the error when its sleep fails for a reason other than stopping", async () => {
  const f = await connected();
  try {
    const failure = new Error("timer broken");
    await expect(
      createContentSuggestionRunner(deps(f)).run(new AbortController().signal, {
        sleep: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  } finally {
    await f.close();
  }
});
