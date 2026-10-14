import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  type TranslationCloud,
  translationCloudFixture,
  verifySubmitVector,
} from "../test/translation-cloud-fixture.js";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import { jobFingerprint, submitSignedBody } from "./cloud-translation.js";

interface VectorCase {
  name: string;
  expect: string;
  envelope: { payload: string; signature: string; body: string };
}
const v = JSON.parse(
  readFileSync(new URL("../test/cloud-translation-vector.json", import.meta.url), "utf8"),
) as { operationId: string; cases: VectorCase[] };
const vector = (name: string) => v.cases.find((c) => c.name === name)!.envelope;
const singleCases = v.cases.filter((c) => c.name !== "replayed_operation");
// The signed body is the last field of the machine payload (`machinePayload`, cloud-installation.ts).
const signedBodyOf = (payload: string) =>
  (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown[])[7] as string;

const item = (
  ref: string,
  staffName: string,
  missing: string[],
  family = ref,
  kind = family === ref ? "product" : "variant",
) => ({ ref, kind, family, category: null, staffName, existing: {}, missing });
const job = (items: unknown[], fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    country: "ES",
    languages: { default: "ca", enabled: ["ca", "es"] },
    items,
    houseStyle: [],
    ...fields,
  });
const pinta = [item("product:1", "PINTA", ["ca"])];
const house = { kind: "product", staffName: "CARAJILLO", names: { ca: "Cigaló" } };
const one = job([item("product:1", "PINTA", ["ca", "es"])]);
const two = job([
  item("product:1", "PINTA", ["ca", "es"]),
  item("product:2", "CANYA", ["ca", "es"]),
]);

type Lookup = "translation-status" | "translation-collect" | "translation-release";
const submit = (f: TranslationCloud, body: string, operationId?: string) =>
  f.signedRequest("translation-submit", { signedBody: submitSignedBody(body), body, operationId });
const ask = (f: TranslationCloud, action: Lookup, jobId: string) =>
  f.signedRequest(action, { signedBody: JSON.stringify({ version: 1, jobId }) });
const jobIdOf = (answer: { json: unknown }) => (answer.json as { jobId: string }).jobId;
const refused = (status: number, error: string) => ({ status, json: { error } });

async function withCloud(
  run: (f: TranslationCloud) => Promise<void>,
  options?: { cloudBeforeVersion2?: boolean },
) {
  const f = await translationCloudFixture(options);
  try {
    await f.client.refresh(); // renew: the box's first lease
    await run(f);
  } finally {
    await f.close();
  }
}

it.each(singleCases)("the fake's fingerprint check gives the vector's answer for $name", (c) => {
  expect(
    verifySubmitVector({ body: c.envelope.body, signedBody: signedBodyOf(c.envelope.payload) }),
  ).toBe(c.expect === "accepted");
});

it.each(singleCases)(
  "the $name envelope, re-signed with the fixture's key, is answered $expect",
  (c) =>
    withCloud(async (f) => {
      const answer = await f.signedRequest("translation-submit", {
        signedBody: signedBodyOf(c.envelope.payload),
        body: c.envelope.body,
      });
      if (c.expect === "accepted")
        expect(answer).toMatchObject({
          status: 200,
          json: { version: 1, state: "queued", total: 1 },
        });
      else expect(answer).toEqual(refused(401, "invalid_proof"));
    }),
);

it("a fingerprint mismatch is 401 invalid_proof and makes no job", () =>
  withCloud(async (f) => {
    const valid = vector("valid");
    const changed = vector("changed_body");
    expect(signedBodyOf(changed.payload)).toBe(signedBodyOf(valid.payload));
    expect(changed.body).not.toBe(valid.body);
    expect(
      await f.signedRequest("translation-submit", {
        signedBody: signedBodyOf(changed.payload),
        body: changed.body,
      }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
    expect(f.submissions).toEqual([]);
  }));

it("the replayed-operation vector is a conflict after the valid one, which replays as the same job", () =>
  withCloud(async (f) => {
    const valid = vector("valid");
    const replayed = vector("replayed_operation");
    const send = (e: VectorCase["envelope"]) =>
      f.signedRequest("translation-submit", {
        signedBody: signedBodyOf(e.payload),
        body: e.body,
        operationId: v.operationId,
      });
    const first = await send(valid);
    expect(first.status).toBe(200);
    expect(await send(replayed)).toEqual(refused(409, "conflict"));
    expect(await send(valid)).toEqual(first);
    expect(f.jobs.size).toBe(1);
  }));

it.each([
  ["not JSON", 400, "invalid_input", "application/json", "not json"],
  ["JSON null", 400, "invalid_input", "application/json", "null"],
  ["a JSON array", 400, "invalid_input", "application/json", "[]"],
  ["a JSON string", 400, "invalid_input", "application/json", '"x"'],
  ["sent as text/plain", 415, "invalid_input", "text/plain", '{"payload":"x","signature":"x"}'],
  [
    "an object without a string payload",
    401,
    "invalid_proof",
    "application/json",
    '{"signature":"x"}',
  ],
])(
  "an outer request that is %s is %i %s before anything else",
  (_name, status, error, contentType, body) =>
    withCloud(async (f) => {
      const before = f.requests.length;
      const response = await fetch(`${f.options.origin}/api/installations/translation-submit`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(f.requests).toHaveLength(before);
      expect(f.calls).toEqual([]);
    }),
);

it("an outer request holding other keys than the contract's is an invalid proof, and each is recorded", () =>
  withCloud(async (f) => {
    const signedBody = submitSignedBody(two);
    expect(
      await f.signedRequest("translation-submit", { signedBody, body: two, extra: { note: "x" } }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(await f.signedRequest("translation-submit", { signedBody })).toEqual(
      refused(401, "invalid_proof"),
    );
    expect(await f.signedRequest("translation-submit", { signedBody, extra: { body: 5 } })).toEqual(
      refused(401, "invalid_proof"),
    );
    expect(
      await f.signedRequest("translation-status", {
        signedBody: JSON.stringify({ version: 1, jobId: randomUUID() }),
        body: "{}",
      }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
    expect(f.submissions).toEqual([]);
    expect(f.calls.map((c) => c.action)).toEqual([
      "translation-submit",
      "translation-submit",
      "translation-submit",
      "translation-status",
    ]);
    expect((await f.signedRequest("translation-submit", { signedBody, body: two })).status).toBe(
      200,
    );
  }));

it("a lease the fake did not issue, or a proof time over 60 seconds away, is an invalid proof", () =>
  withCloud(async (f) => {
    const signedBody = submitSignedBody(two);
    for (const input of [
      { lease: "" },
      { lease: JSON.stringify({ payload: "eA", signature: "eA" }) },
      { issuedAt: Date.now() - 61_000 },
      { issuedAt: Date.now() + 61_000 },
    ])
      expect(
        await f.signedRequest("translation-submit", { signedBody, body: two, ...input }),
      ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
    expect((await f.signedRequest("translation-submit", { signedBody, body: two })).status).toBe(
      200,
    );
  }));

it("checks the size before the fingerprint, and the fingerprint before reading the job", () =>
  withCloud(async (f) => {
    const oversized = JSON.stringify({
      version: 1,
      jobSha256: jobFingerprint("x").jobSha256,
      jobBytes: 1_048_577,
    });
    expect(
      await f.signedRequest("translation-submit", { signedBody: oversized, body: "x" }),
    ).toEqual(refused(413, "translation_job_too_large"));
    expect(
      await f.signedRequest("translation-submit", {
        signedBody: submitSignedBody("x"),
        body: "not json",
      }),
    ).toEqual(refused(401, "invalid_proof"));
    const upperCase = JSON.stringify({
      version: 1,
      jobSha256: jobFingerprint(two).jobSha256.toUpperCase(),
      jobBytes: jobFingerprint(two).jobBytes,
    });
    expect(
      await f.signedRequest("translation-submit", { signedBody: upperCase, body: two }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(await submit(f, "not json")).toEqual(refused(400, "invalid_request"));
    expect(f.submissions.map((s) => s.body)).toEqual(["not json"]);
  }));

it.each([
  ["a kind outside the nine", job([{ ...item("product:1", "PINTA", ["ca"]), kind: "telepathy" }])],
  ["a staff name over 500 characters", job([item("product:1", "P".repeat(501), ["ca"])])],
  [
    "an empty missing on an item that heads no other",
    job([item("product:1", "PINTA", []), item("product:2", "CANYA", ["ca"])]),
  ],
  [
    "a member listed before its head",
    job([item("variant:2", "CANYA", ["ca"], "product:1"), item("product:1", "PINTA", [])]),
  ],
  ["a missing language that is not enabled", job([item("product:1", "PINTA", ["fr"])])],
  ["a key the contract does not name", job([{ ...item("product:1", "PINTA", ["ca"]), note: "x" }])],
  [
    "a category on an options list",
    job([{ ...item("option_list:1", "SIZES", ["ca"]), kind: "option_list", category: "BEERS" }]),
  ],
  ["a repeated ref", job([item("product:1", "PINTA", ["ca"]), item("product:1", "CANYA", ["es"])])],
  ["version 2", job(pinta, { version: 2 })],
  ["a country that is not two capitals", job(pinta, { country: "es" })],
  ["a default that is not enabled", job(pinta, { languages: { default: "en", enabled: ["ca"] } })],
  [
    "21 enabled languages",
    job(pinta, {
      languages: {
        default: "ca",
        enabled: ["ca", ...Array.from({ length: 20 }, (_, i) => `l${String.fromCharCode(97 + i)}`)],
      },
    }),
  ],
  ["no items", job([])],
  [
    "a member's ref over 128 characters",
    job([item("product:1", "PINTA", []), item("v".repeat(129), "CANYA", ["ca"], "product:1")]),
  ],
  [
    "an existing name in a language that is not enabled",
    job([{ ...item("product:1", "PINTA", ["ca"]), existing: { fr: "Pinte" } }]),
  ],
  ["a missing language listed twice", job([item("product:1", "PINTA", ["ca", "ca"])])],
  [
    "a missing language that already has a name",
    job([{ ...item("product:1", "PINTA", ["ca"]), existing: { ca: "Pinta" } }]),
  ],
  [
    "a house-style entry with a key the contract does not name",
    job(pinta, { houseStyle: [{ ...house, note: "x" }] }),
  ],
  ["301 house-style entries", job(pinta, { houseStyle: Array.from({ length: 301 }, () => house) })],
])("a job with %s is 400 invalid_request", (_name, body) =>
  withCloud(async (f) => {
    expect(await submit(f, body)).toEqual(refused(400, "invalid_request"));
    expect(f.jobs.size).toBe(0);
  }),
);

it("accepts a context head listed before its member, and counts only items with languages to write", () =>
  withCloud(async (f) => {
    const body = job([
      item("product:1", "PINTA", []),
      item("variant:2", "PINTA CANYA", ["ca"], "product:1"),
    ]);
    expect(await submit(f, body)).toMatchObject({
      status: 200,
      json: { version: 1, state: "queued", total: 1 },
    });
  }));

it("over 1,000 valid items is 413 translation_job_too_large", () =>
  withCloud(async (f) => {
    const body = job(Array.from({ length: 1001 }, (_, i) => item(`product:${i}`, `P${i}`, ["ca"])));
    expect(await submit(f, body)).toEqual(refused(413, "translation_job_too_large"));
    expect(f.jobs.size).toBe(0);
  }));

it("checks the service, consent, an open job and the cap in the contract's order", () =>
  withCloud(async (f) => {
    f.service("provisioning");
    f.consent(false);
    f.cap(0);
    expect(await submit(f, two)).toEqual(refused(403, "permission_denied"));
    f.service("ready");
    expect(await submit(f, two)).toEqual(refused(403, "translation_consent_required"));
    f.consent(true);
    expect(await submit(f, two)).toEqual({
      status: 409,
      json: { error: "translation_limit_reached", fits: 0 },
    });
    f.cap(2);
    expect((await submit(f, two)).status).toBe(200);
    f.cap(0);
    expect(await submit(f, two)).toEqual(refused(409, "translation_job_running"));
    expect(f.jobs.size).toBe(1);
  }));

it("a repeated operation ID is answered at step 5, before the service and consent are checked", () =>
  withCloud(async (f) => {
    const operationId = randomUUID();
    const first = await submit(f, two, operationId);
    await ask(f, "translation-status", jobIdOf(first));
    f.service("failed");
    f.consent(false);
    expect(await submit(f, two, operationId)).toEqual({
      status: 200,
      json: { ...(first.json as object), state: "running" },
    });
    expect(await submit(f, one, operationId)).toEqual(refused(409, "conflict"));
    expect(f.jobs.size).toBe(1);
  }));

it("status, collect and release answer permission_denied while the service is not ready", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    f.service("unconfigured");
    for (const action of [
      "translation-status",
      "translation-collect",
      "translation-release",
    ] as const)
      expect(await ask(f, action, id)).toEqual(refused(403, "permission_denied"));
    expect(f.jobs.get(id)!.state).toBe("queued");
    f.service("ready");
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "running" });
  }));

it("the version-2 configuration reply carries the service's state", () =>
  withCloud(async (f) => {
    const state = async () =>
      (await f.client.refresh()).installation!.services.find(
        (s) => s.service === "content_translation",
      )?.state;
    expect(await state()).toBe("ready");
    f.service("provisioning");
    expect(await state()).toBe("provisioning");
  }));

/** Signs a `configuration` request with the box's pending operation ID, which the base fake requires. */
async function postConfiguration(f: TranslationCloud, body: string) {
  const saved = JSON.parse(
    await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"),
  ) as SavedCloudState & { lifecycle: { pending: { operationId: string } } };
  const bytes = machinePayload(saved, {
    action: "configuration",
    operationId: saved.lifecycle.pending.operationId,
    lease: JSON.stringify(saved.lifecycle.lease),
    body,
  });
  const key = createPrivateKey({
    key: Buffer.from(saved.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const response = await fetch(`${f.options.origin}/api/installations/configuration`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, key).toString("base64url"),
    }),
  });
  return { status: response.status, json: (await response.json()) as unknown };
}

it("a configuration body other than {} or the version-2 one is an invalid proof", () =>
  withCloud(async (f) => {
    f.lose(); // leaves the configuration request pending, so its operation ID can be signed again
    await expect(f.client.refresh()).rejects.toThrow();
    for (const body of ['{"servicesVersion":2,"extra":1}', '{"servicesVersion":3}', "not json"])
      expect(await postConfiguration(f, body)).toEqual(refused(401, "invalid_proof"));
  }));

it("a Cloud before version 2 refuses the version-2 configuration, and the box renews to three services", () =>
  withCloud(
    async (f) => {
      let refusal: unknown;
      // While the box's request waits, the same signed request is sent again to read the answer.
      f.delay(async () => {
        f.delay(async () => {});
        refusal = await postConfiguration(f, '{"servicesVersion":2}');
      });
      await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
      expect(refusal).toEqual(refused(401, "invalid_proof"));
      expect(f.requests.at(-2)![2]).toBe("configuration"); // the box's; the last is the re-send
      expect(f.requests.at(-2)![7]).toBe('{"servicesVersion":2}');
      const status = await f.client.refresh();
      expect(f.requests.at(-1)![2]).toBe("renew");
      const services = status.installation!.services.map((s) => s.service);
      expect(services).toHaveLength(3);
      expect(services).not.toContain("content_translation");
    },
    { cloudBeforeVersion2: true },
  ));

it("a revoked installation's translation requests are 403 revoked, after the proof is checked", () =>
  withCloud(async (f) => {
    f.revoke();
    expect(await submit(f, two)).toEqual(refused(403, "revoked"));
    expect(await ask(f, "translation-status", randomUUID())).toEqual(refused(403, "revoked"));
    expect(
      await f.signedRequest("translation-submit", {
        signedBody: submitSignedBody(two),
        body: two,
        lease: "",
      }),
    ).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
  }));

it("an operation ID that is not a UUID is an invalid proof", () =>
  withCloud(async (f) => {
    expect(await submit(f, two, "op-1")).toEqual(refused(401, "invalid_proof"));
    expect(f.jobs.size).toBe(0);
  }));

it("a lease the fake issued is an invalid proof once it has expired", () =>
  withCloud(async (f) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 3_601_000);
    try {
      expect(await submit(f, two)).toEqual(refused(401, "invalid_proof"));
    } finally {
      clock.mockRestore();
    }
    expect((await submit(f, two)).status).toBe(200);
  }));

it("runs a job queued, running, done, and collects the default translator's answers", () =>
  withCloud(async (f) => {
    const body = job([
      item("product:1", "PINTA", []),
      item("variant:2", "?", ["ca", "es"], "product:1"),
      { ...item("product:3", "ZURRITO", ["ca"]), existing: { es: "Zurito" } },
    ]);
    const submitted = await submit(f, body);
    const id = jobIdOf(submitted);
    expect(submitted).toEqual({
      status: 200,
      json: { version: 1, jobId: id, state: "queued", total: 2 },
    });
    expect((await ask(f, "translation-status", id)).json).toEqual({
      version: 1,
      jobId: id,
      state: "running",
      total: 2,
      done: 1,
      failed: 0,
    });
    expect((await ask(f, "translation-status", id)).json).toEqual({
      version: 1,
      jobId: id,
      state: "done",
      total: 2,
      done: 2,
      failed: 0,
    });
    expect(await ask(f, "translation-collect", id)).toEqual({
      status: 200,
      json: {
        version: 1,
        jobId: id,
        state: "done",
        results: [
          { ref: "variant:2", names: {}, placeholder: true, corrections: [] },
          {
            ref: "product:3",
            names: { ca: "CA ZURRITO" },
            placeholder: false,
            corrections: [{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }],
          },
        ],
        failed: [],
      },
    });
  }));

interface Ending {
  name: string;
  arrange: (f: TranslationCloud) => void;
  body: string;
  state: "partly_done" | "failed";
  reason: string;
  failed: string[];
}
it.each<Ending>([
  {
    name: "the cap stopping a two-item job",
    arrange: (f) => f.capStop(true),
    body: two,
    state: "partly_done",
    reason: "limit_reached",
    failed: ["product:2"],
  },
  {
    name: "the cap stopping a one-item job",
    arrange: (f) => f.capStop(true),
    body: one,
    state: "failed",
    reason: "limit_reached",
    failed: ["product:1"],
  },
  {
    name: "the provider failing one item",
    arrange: (f) => f.failRefs(["product:1"]),
    body: two,
    state: "partly_done",
    reason: "provider_failed",
    failed: ["product:1"],
  },
  {
    name: "the provider failing every item",
    arrange: (f) => f.failRefs(["product:1", "product:2"]),
    body: two,
    state: "failed",
    reason: "provider_unavailable",
    failed: ["product:1", "product:2"],
  },
  {
    name: "the provider down",
    arrange: (f) => f.providerDown(true),
    body: two,
    state: "failed",
    reason: "provider_unavailable",
    failed: ["product:1", "product:2"],
  },
  {
    name: "consent withdrawn",
    arrange: (f) => f.consentWithdrawn(true),
    body: two,
    state: "failed",
    reason: "consent_required",
    failed: ["product:1", "product:2"],
  },
])(
  "a job ended by $name is $state with reason $reason",
  ({ arrange, body, state, reason, failed }) =>
    withCloud(async (f) => {
      arrange(f);
      const id = jobIdOf(await submit(f, body));
      await ask(f, "translation-status", id);
      const total = (JSON.parse(body) as { items: unknown[] }).items.length;
      expect((await ask(f, "translation-status", id)).json).toEqual({
        version: 1,
        jobId: id,
        state,
        total,
        done: total - failed.length,
        failed: failed.length,
        reason,
      });
      const collected = await ask(f, "translation-collect", id);
      if (state === "failed") expect(collected).toEqual(refused(409, "translation_not_ready"));
      else expect(collected.json).toMatchObject({ state, failed });
    }),
);

it("hold keeps a job running, and statusOverride is merged into every later status", () =>
  withCloud(async (f) => {
    f.hold(true);
    const id = jobIdOf(await submit(f, two));
    for (let poll = 0; poll < 3; poll++)
      expect((await ask(f, "translation-status", id)).json).toMatchObject({
        state: "running",
        done: 1,
      });
    f.statusOverride({ state: "done", reason: "limit_reached" });
    expect((await ask(f, "translation-status", id)).json).toMatchObject({
      state: "done",
      reason: "limit_reached",
    });
    expect(f.jobs.get(id)!.state).toBe("running");
    f.statusOverride(null);
    f.hold(false);
    expect((await ask(f, "translation-status", id)).json).toEqual({
      version: 1,
      jobId: id,
      state: "done",
      total: 2,
      done: 2,
      failed: 0,
    });
  }));

it("collect and release answer by state, and release deletes the job but keeps the submission", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    expect(await ask(f, "translation-collect", id)).toEqual(refused(409, "translation_not_ready"));
    expect(await ask(f, "translation-release", id)).toEqual(refused(409, "translation_not_ready"));
    await ask(f, "translation-status", id);
    expect(await ask(f, "translation-release", id)).toEqual(refused(409, "translation_not_ready"));
    await ask(f, "translation-status", id);
    expect((await ask(f, "translation-collect", id)).status).toBe(200);
    const collected = { status: 200, json: { version: 1, jobId: id, state: "collected" } };
    expect(await ask(f, "translation-release", id)).toEqual(collected);
    expect(await ask(f, "translation-release", id)).toEqual(collected);
    expect(f.jobs.get(id)).toMatchObject({ state: "collected", job: null, results: null });
    expect(f.submissions.map((s) => s.body)).toEqual([two]);
    expect(await ask(f, "translation-collect", id)).toEqual(refused(410, "translation_expired"));
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "collected" });
  }));

it("an expired job's collect and release are 410 translation_expired", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    f.expire(id);
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "expired" });
    expect(await ask(f, "translation-collect", id)).toEqual(refused(410, "translation_expired"));
    expect(await ask(f, "translation-release", id)).toEqual(refused(410, "translation_expired"));
    expect(f.jobs.get(id)).toMatchObject({ job: null, results: null });
  }));

it("a failed job is not ready to collect, and releasing it deletes it", () =>
  withCloud(async (f) => {
    f.providerDown(true);
    const id = jobIdOf(await submit(f, two));
    await ask(f, "translation-status", id);
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "failed" });
    expect(await ask(f, "translation-collect", id)).toEqual(refused(409, "translation_not_ready"));
    expect(await ask(f, "translation-release", id)).toEqual({
      status: 200,
      json: { version: 1, jobId: id, state: "collected" },
    });
    expect(f.jobs.get(id)).toMatchObject({ state: "collected", job: null });
  }));

it.each(["translation-status", "translation-collect", "translation-release"] as const)(
  "%s of an unknown job is 404 translation_job_not_found",
  (action) =>
    withCloud(async (f) => {
      expect(await ask(f, action, randomUUID())).toEqual(refused(404, "translation_job_not_found"));
    }),
);

it.each([
  ["its keys in the other order", (id: string) => JSON.stringify({ jobId: id, version: 1 })],
  ["a job ID that is not a UUID", () => JSON.stringify({ version: 1, jobId: "job-1" })],
  ["version 2", (id: string) => JSON.stringify({ version: 2, jobId: id })],
  [
    "a key the contract does not name",
    (id: string) => JSON.stringify({ version: 1, jobId: id, x: 1 }),
  ],
])("a status signed body with %s is 400 invalid_request", (_name, signed) =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    expect(await f.signedRequest("translation-status", { signedBody: signed(id) })).toEqual(
      refused(400, "invalid_request"),
    );
    expect(f.jobs.get(id)!.state).toBe("queued");
  }),
);

it("loseNext commits and then drops the reply; the same operation ID returns the same job", () =>
  withCloud(async (f) => {
    const operationId = randomUUID();
    f.loseNext("translation-submit");
    await expect(submit(f, two, operationId)).rejects.toThrow("fetch failed");
    expect(f.jobs.size).toBe(1);
    const again = await submit(f, two, operationId);
    expect(again.status).toBe(200);
    expect(f.jobs.get(jobIdOf(again))!.operationId).toBe(operationId);
    expect(f.submissions).toEqual([
      { operationId, body: two },
      { operationId, body: two },
    ]);
    f.loseNext("translation-status");
    await expect(ask(f, "translation-status", jobIdOf(again))).rejects.toThrow("fetch failed");
    expect(f.jobs.get(jobIdOf(again))!.state).toBe("running");
  }));

it("stall holds the next request of an action, already recorded, until it is released", () =>
  withCloud(async (f) => {
    const id = jobIdOf(await submit(f, two));
    await ask(f, "translation-status", id);
    const stalled = f.stall("translation-status");
    const pending = ask(f, "translation-status", id);
    await stalled.reached;
    expect(f.calls.at(-1)).toMatchObject({ action: "translation-status" });
    expect(f.jobs.get(id)!.state).toBe("running");
    f.hold(true);
    stalled.release();
    expect((await pending).json).toMatchObject({ state: "running" });
    f.hold(false);
    expect((await ask(f, "translation-status", id)).json).toMatchObject({ state: "done" });
  }));

it("offline fails translation requests at the socket, and online brings them back", () =>
  withCloud(async (f) => {
    f.offline();
    await expect(submit(f, two)).rejects.toThrow("fetch failed");
    expect(f.calls.map((c) => c.action)).toEqual(["translation-submit"]);
    expect(f.jobs.size).toBe(0);
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.online();
    expect((await submit(f, two)).status).toBe(200);
  }));

it("a translator's answer reaches collect as written, so a test can make Cloud misbehave", () =>
  withCloud(async (f) => {
    f.translator((i) => ({
      names: { fr: `FR ${i.staffName}` },
      placeholder: false,
      corrections: [],
    }));
    const id = jobIdOf(await submit(f, one));
    await ask(f, "translation-status", id);
    await ask(f, "translation-status", id);
    expect((await ask(f, "translation-collect", id)).json).toMatchObject({
      results: [
        { ref: "product:1", names: { fr: "FR PINTA" }, placeholder: false, corrections: [] },
      ],
    });
  }));
