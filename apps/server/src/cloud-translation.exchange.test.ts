import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { translationCloudFixture } from "../test/translation-cloud-fixture.js";
import { createCloudConnection, type SavedCloudState } from "./cloud-client.js";
import { COLLECT_REPLY_BYTES, refusalOf, translationStatus } from "./cloud-translation.js";

type Fake = Awaited<ReturnType<typeof translationCloudFixture>>;
const body = (items: number) =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: ["ca", "es"] },
    items: Array.from({ length: items }, (_, i) => ({
      ref: `product:${i}`,
      kind: "product",
      family: `product:${i}`,
      category: null,
      staffName: `PRODUCT ${i}`,
      existing: {},
      missing: ["ca", "es"],
    })),
    houseStyle: [],
  });
const op = () => crypto.randomUUID();
async function withFake(
  test: (f: Fake) => Promise<void>,
  options?: { cloudBeforeVersion2?: boolean },
) {
  const f = await translationCloudFixture(options);
  try {
    await test(f);
  } finally {
    await f.close();
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("submits, polls, collects and releases one job", () =>
  withFake(async (f) => {
    const job = await f.client.translation.submit(op(), body(2));
    expect(job).toMatchObject({ state: "queued", total: 2 });
    expect((await f.client.translation.status(job.jobId)).state).toBe("running");
    const done = await f.client.translation.status(job.jobId);
    expect(done).toEqual({ jobId: job.jobId, state: "done", total: 2, done: 2, failed: 0 });
    expect(Object.hasOwn(done, "reason")).toBe(false);
    const results = await f.client.translation.collect(job.jobId);
    expect(results.results.map((r) => r.names)).toEqual([
      { ca: "CA PRODUCT 0", es: "ES PRODUCT 0" },
      { ca: "CA PRODUCT 1", es: "ES PRODUCT 1" },
    ]);
    await f.client.translation.release(job.jobId);
    await f.client.translation.release(job.jobId);
    expect(f.jobs.get(job.jobId)!.state).toBe("collected");
  }));

it("a lost submit reply retried with the same operation ID returns the same job", () =>
  withFake(async (f) => {
    const id = op();
    f.loseNext("translation-submit");
    await expect(f.client.translation.submit(id, body(1))).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const again = await createCloudConnection(f.options).translation.submit(id, body(1));
    expect(f.jobs.size).toBe(1);
    expect(f.jobs.get(again.jobId)!.operationId).toBe(id);
  }));

it.each([
  ["consent withheld", (f: Fake) => f.consent(false), "content.suggestion_consent_required", {}],
  ["the cap", (f: Fake) => f.cap(1), "content.suggestion_limit_reached", { fits: 1 }],
])("maps %s at submit to its domain code", (_n, arrange, code, params) =>
  withFake(async (f) => {
    arrange(f);
    await expect(f.client.translation.submit(op(), body(2))).rejects.toMatchObject({
      code,
      params,
    });
  }),
);

it("a service Cloud has not made ready for this installation is cloud.unavailable", () =>
  withFake(async (f) => {
    f.service("unconfigured");
    await expect(f.client.translation.submit(op(), body(1))).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    expect(f.calls.at(-1)!.action).toBe("translation-submit");
    expect(f.jobs.size).toBe(0);
  }));

it("refuses a second job while one runs", () =>
  withFake(async (f) => {
    f.hold(true);
    await f.client.translation.submit(op(), body(1));
    await expect(f.client.translation.submit(op(), body(1))).rejects.toMatchObject({
      code: "content.suggestion_job_running",
    });
  }));

it("an expired job's collect is content.suggestion_expired, and an unknown job's status too", () =>
  withFake(async (f) => {
    const job = await f.client.translation.submit(op(), body(1));
    f.expire(job.jobId);
    await expect(f.client.translation.collect(job.jobId)).rejects.toMatchObject({
      code: "content.suggestion_expired",
    });
    await expect(f.client.translation.status(crypto.randomUUID())).rejects.toMatchObject({
      code: "content.suggestion_expired",
    });
  }));

it("a reused operation ID with another body is cloud.request_invalid", () =>
  withFake(async (f) => {
    const id = op();
    await f.client.translation.submit(id, body(1));
    await expect(f.client.translation.submit(id, body(2))).rejects.toMatchObject({
      code: "cloud.request_invalid",
    });
    expect(f.jobs.size).toBe(1);
  }));

it.each([
  ["the cap", (f: Fake) => f.capStop(true), "partly_done", "limit_reached"],
  [
    "a provider failure on some items",
    (f: Fake) => f.failRefs(["product:0"]),
    "partly_done",
    "provider_failed",
  ],
  ["the provider down", (f: Fake) => f.providerDown(true), "failed", "provider_unavailable"],
  ["consent withdrawn", (f: Fake) => f.consentWithdrawn(true), "failed", "consent_required"],
])("a job stopped by %s reports its reason", (_n, arrange, state, reason) =>
  withFake(async (f) => {
    arrange(f);
    const job = await f.client.translation.submit(op(), body(2));
    await f.client.translation.status(job.jobId);
    expect(await f.client.translation.status(job.jobId)).toMatchObject({
      jobId: job.jobId,
      state,
      total: 2,
      reason,
    });
  }),
);

it.each([
  ["done with a reason", { state: "done", reason: "limit_reached" }],
  ["partly done without one", { state: "partly_done", reason: undefined }],
  ["failed with a partly-done reason", { state: "failed", reason: "provider_failed" }],
  ["an unknown state", { state: "paused" }],
  ["a negative count", { done: -1 }],
  ["another job's id", { jobId: "00000000-0000-4000-8000-000000000099" }],
])("refuses a status reply with %s", (_n, patch) =>
  withFake(async (f) => {
    const job = await f.client.translation.submit(op(), body(2));
    f.statusOverride(patch);
    await expect(f.client.translation.status(job.jobId)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  }),
);

it("a body over 1,000 items is cloud.request_invalid", () =>
  withFake(async (f) => {
    await expect(f.client.translation.submit(op(), body(1001))).rejects.toMatchObject({
      code: "cloud.request_invalid",
    });
  }));

it("an unreachable Cloud is cloud.unavailable and a never-connected box is cloud.not_configured", async () => {
  await withFake(async (f) => {
    await f.client.translation.status(crypto.randomUUID()).catch(() => undefined); // gets a lease
    f.offline();
    await expect(f.client.translation.status(crypto.randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  });
  const empty = await mkdtemp(join(tmpdir(), "waitron-translation-empty-"));
  try {
    const none = createCloudConnection({
      stateDir: empty,
      origin: "https://cloud.example",
      localVenueId: crypto.randomUUID(),
      environment: "test",
    });
    await expect(none.translation.status(crypto.randomUUID())).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    await expect(none.translationService()).resolves.toBe("not_connected");
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

it("translationService reads on and off from the saved reply without a network call", () =>
  withFake(async (f) => {
    await f.client.refresh(); // renew
    await f.client.refresh(); // configuration, content_translation ready
    const before = f.requests.length + f.calls.length;
    await expect(f.client.translationService()).resolves.toBe("on");
    expect(f.requests.length + f.calls.length).toBe(before);
    f.service("unconfigured");
    await f.client.refresh();
    await expect(f.client.translationService()).resolves.toBe("off");
  }));

it("a Cloud from before version 2 refuses the configuration request, and the service is off", () =>
  withFake(
    async (f) => {
      await expect(f.client.refresh()).resolves.toMatchObject({ state: "complete" }); // renew
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
      await expect(f.client.translationService()).resolves.toBe("off");
    },
    { cloudBeforeVersion2: true },
  ));

it("a refresh and a report run while a status call waits on Cloud", () =>
  withFake(async (f) => {
    await f.client.refresh(); // renew: the lease is live from here on
    const job = await f.client.translation.submit(op(), body(1));
    const held = f.stall("translation-status");
    const status = f.client.translation.status(job.jobId);
    await held.reached;
    await expect(f.client.refresh()).resolves.toMatchObject({ state: "complete" });
    await expect(
      f.client.report([{ service: "remote_access", health: "healthy", failure: null }]),
    ).resolves.toMatchObject({ state: "complete" });
    held.release();
    await expect(status).resolves.toMatchObject({ jobId: job.jobId, state: "running" });
  }));

it("renews a lease with ten minutes or less left before a translation call, and reuses a live one", () =>
  withFake(async (f) => {
    await f.client.refresh(); // renew
    const job = await f.client.translation.submit(op(), body(1));
    const renewals = () => f.requests.filter((r) => r[2] === "renew").length;
    const before = renewals();
    await f.client.translation.status(job.jobId);
    expect(renewals()).toBe(before);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 51 * 60_000 });
    await f.client.translation.status(job.jobId);
    expect(renewals()).toBe(before + 1);
  }));

it("sends a lifecycle request left pending before a translation call", () =>
  withFake(async (f) => {
    f.lose();
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    await expect(f.client.translation.submit(op(), body(1))).resolves.toMatchObject({ total: 1 });
    const renewals = f.requests.filter((r) => r[2] === "renew").map((r) => r[4]);
    expect(renewals).toHaveLength(2);
    expect(renewals[1]).toBe(renewals[0]);
  }));

it("a renewal Cloud answers as revoked is cloud.not_configured, with no translation call", () =>
  withFake(async (f) => {
    f.revoke();
    await expect(f.client.translation.submit(op(), body(1))).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect(f.calls).toHaveLength(0);
    await expect(f.client.translationService()).resolves.toBe("not_connected");
    await expect(f.client.translation.status(JOB)).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
  }));

it("refuses a collect reply with a result whose names are not text", () =>
  withFake(async (f) => {
    f.translator(() => ({ names: { ca: 5 as never }, placeholder: false, corrections: [] }));
    const job = await f.client.translation.submit(op(), body(1));
    await f.client.translation.status(job.jobId);
    await f.client.translation.status(job.jobId);
    await expect(f.client.translation.collect(job.jobId)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  }));

// Every result at the contract's bounds, written in characters JSON can only send as `\uXXXX`.
const LANGUAGES = [
  ...["ca", "es", "en", "fr", "de", "it", "pt", "nl", "eu", "gl", "oc", "ast", "an", "pt-BR"],
  ...["en-GB", "es-MX", "fr-CA", "de-AT", "it-CH", "nl-BE"],
];
const worstBody = () =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: LANGUAGES },
    items: Array.from({ length: 1000 }, (_, i) => {
      const ref = `product:${i}:`.padEnd(128, "x");
      return {
        ref,
        kind: "product",
        family: ref,
        category: null,
        staffName: `PRODUCT ${i}`,
        existing: {},
        missing: LANGUAGES,
      };
    }),
    houseStyle: [],
  });
const escaped = (c: string) => c.repeat(500);

it("accepts a collect reply as large as the contract allows", () =>
  withFake(async (f) => {
    f.translator((item) => ({
      names: Object.fromEntries(item.missing.map((l) => [l, escaped("\u0001")])),
      placeholder: false,
      corrections: Array.from({ length: 10 }, () => ({
        field: "internal",
        wrong: escaped("\u0001"),
        right: escaped("\u0002"),
      })),
    }));
    const job = await f.client.translation.submit(op(), worstBody());
    await f.client.translation.status(job.jobId);
    await f.client.translation.status(job.jobId);
    const collected = await f.client.translation.collect(job.jobId);
    expect(collected.results).toHaveLength(1000);
    expect(collected.results[999]!.names["nl-BE"]).toBe(escaped("\u0001"));
  }));

it("refuses a collect reply over its size limit", () =>
  withFake(async (f) => {
    f.translator(() => ({
      names: { ca: "x".repeat(COLLECT_REPLY_BYTES) },
      placeholder: false,
      corrections: [],
    }));
    const job = await f.client.translation.submit(op(), body(1));
    await f.client.translation.status(job.jobId);
    await f.client.translation.status(job.jobId);
    await expect(f.client.translation.collect(job.jobId)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  }));

const JOB = "00000000-0000-4000-8000-000000000001";
const result = { ref: "product:0", names: { ca: "Pinta" }, placeholder: false, corrections: [] };
const reply = (value: unknown, status = 200) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), { status });
type Call = (f: Fake) => Promise<unknown>;
const submit: Call = (f) => f.client.translation.submit(op(), body(1));
const status: Call = (f) => f.client.translation.status(JOB);
const collect: Call = (f) => f.client.translation.collect(JOB);
const release: Call = (f) => f.client.translation.release(JOB);
const collected = (patch: Record<string, unknown>) => ({
  version: 1,
  jobId: JOB,
  state: "done",
  results: [result],
  failed: [],
  ...patch,
});

it.each([
  [
    "a submit reply whose job id is not a UUID",
    submit,
    reply({ version: 1, jobId: "x", state: "queued", total: 1 }),
    "cloud.unavailable",
  ],
  [
    "a reply of another version",
    status,
    reply({ version: 2, jobId: JOB, state: "running", total: 1, done: 0, failed: 0 }),
    "cloud.unavailable",
  ],
  ["a reply that is not JSON", status, reply("<html>"), "cloud.unavailable"],
  ["a reply with no body", status, new Response(null, { status: 204 }), "cloud.unavailable"],
  ["a refusal that is not JSON", status, reply("<html>", 503), "cloud.unavailable"],
  ["a 415 that is not JSON", status, reply("", 415), "cloud.request_invalid"],
  [
    "a collect reply in a state with no results",
    collect,
    reply(collected({ state: "running" })),
    "cloud.unavailable",
  ],
  [
    "a collect reply whose failures are not refs",
    collect,
    reply(collected({ failed: [1] })),
    "cloud.unavailable",
  ],
  [
    "a collect reply whose results are not a list",
    collect,
    reply(collected({ results: {} })),
    "cloud.unavailable",
  ],
  [
    "a collect reply with a result that is not an object",
    collect,
    reply(collected({ results: ["x"] })),
    "cloud.unavailable",
  ],
  [
    "a collect reply with a correction missing its right text",
    collect,
    reply(
      collected({ results: [{ ...result, corrections: [{ field: "internal", wrong: "a" }] }] }),
    ),
    "cloud.unavailable",
  ],
  [
    "a release reply in another state",
    release,
    reply({ version: 1, jobId: JOB, state: "done" }),
    "cloud.unavailable",
  ],
  [
    "a release reply for another job",
    release,
    reply({ version: 1, jobId: crypto.randomUUID(), state: "collected" }),
    "cloud.unavailable",
  ],
])("refuses %s", (_n, call, response, code) =>
  withFake(async (f) => {
    await f.client.refresh(); // renew: the call below makes one request
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
    await expect(call(f)).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledTimes(1);
  }),
);

it("accepts a collect reply holding a correction", () =>
  withFake(async (f) => {
    await f.client.refresh();
    const correction = { field: "internal", wrong: "ZURRITO", right: "ZURITO" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      reply(
        collected({
          state: "partly_done",
          results: [{ ...result, corrections: [correction] }],
          failed: ["product:1"],
        }),
      ),
    );
    await expect(f.client.translation.collect(JOB)).resolves.toEqual({
      state: "partly_done",
      results: [{ ...result, corrections: [correction] }],
      failed: ["product:1"],
    });
  }));

it("a signed body over 4 KiB is cloud.request_invalid and is not sent", () =>
  withFake(async (f) => {
    await f.client.refresh();
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(f.client.translation.status("x".repeat(4096))).rejects.toMatchObject({
      code: "cloud.request_invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  }));

it("a call its caller aborts is cloud.unavailable", () =>
  withFake(async (f) => {
    await f.client.refresh();
    const job = await f.client.translation.submit(op(), body(1));
    const held = f.stall("translation-status");
    const abort = new AbortController();
    const call = f.client.translation.status(job.jobId, abort.signal);
    await held.reached;
    abort.abort();
    await expect(call).rejects.toMatchObject({ code: "cloud.unavailable" });
    held.release();
  }));

it("a saved state holding no lease is cloud.not_configured, with nothing sent", () =>
  withFake(async (f) => {
    const state = JSON.parse(
      await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"),
    ) as SavedCloudState;
    delete state.lifecycle?.lease;
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(translationStatus(state, JOB)).rejects.toMatchObject({
      code: "cloud.not_configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  }));

it.each([
  [403, { error: "translation_consent_required" }, "content.suggestion_consent_required"],
  [409, { error: "translation_job_running" }, "content.suggestion_job_running"],
  [409, { error: "translation_limit_reached", fits: 6 }, "content.suggestion_limit_reached"],
  [409, { error: "translation_limit_reached", fits: -1 }, "cloud.unavailable"],
  [410, { error: "translation_expired" }, "content.suggestion_expired"],
  [404, { error: "translation_job_not_found" }, "content.suggestion_expired"],
  [400, { error: "invalid_request" }, "cloud.request_invalid"],
  [413, { error: "translation_job_too_large" }, "cloud.request_invalid"],
  [413, { error: "invalid_input" }, "cloud.request_invalid"],
  [415, undefined, "cloud.request_invalid"],
  [409, { error: "conflict" }, "cloud.request_invalid"],
  [401, { error: "invalid_proof" }, "cloud.unavailable"],
  [403, { error: "permission_denied" }, "cloud.unavailable"],
  [403, { error: "revoked" }, "cloud.unavailable"],
  [403, { error: "forbidden" }, "cloud.unavailable"],
  [408, { error: "invalid_input" }, "cloud.unavailable"],
  [409, { error: "translation_not_ready" }, "cloud.unavailable"],
  [429, { error: "rate_limited" }, "cloud.unavailable"],
  [503, { error: "temporarily_unavailable" }, "cloud.unavailable"],
])("maps %i %j to %s", (status, value, code) => {
  expect(refusalOf(status, value)).toMatchObject({ code });
});
it("carries the number that would fit", () => {
  expect(refusalOf(409, { error: "translation_limit_reached", fits: 6 }).params).toEqual({
    fits: 6,
  });
});
