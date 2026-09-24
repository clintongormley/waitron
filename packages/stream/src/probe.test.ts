import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { ObjectStore, PutCondition } from "./object-store.js";
import { PROBE_PREFIX, probeBucket } from "./probe.js";
import { createS3ObjectStore } from "./s3-store.js";
import { createMemoryObjectStore } from "./testing/memory-store.js";

const NONCE = "nonce-1";
const KEY = `${PROBE_PREFIX}${NONCE}.json`;

function failure(status: number | null, name: string): AppError {
  return new AppError("backup.stream_request_failed", { operation: "put", key: KEY, status, name });
}

function landedRefusal(): AppError {
  return new AppError("backup.stream_precondition_failed", { key: KEY });
}

type Request = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
};

/**
 * One honest object behind the real S3 client, answering its requests: conditions are honoured, and
 * the write numbered `lostAnswer` lands and is then answered 500, so the client sends it again.
 */
function bucketLosingAnswer(lostAnswer: number) {
  let held: Uint8Array | undefined;
  let etag = "";
  let writes = 0;
  const methods: string[] = [];
  const answer = (statusCode: number, headers: Record<string, string>, body = "") => ({
    response: { statusCode, headers, body: Readable.from([Buffer.from(body)]) },
  });
  const refuse = (statusCode: number, code: string) =>
    answer(
      statusCode,
      { "content-type": "application/xml" },
      `<Error><Code>${code}</Code></Error>`,
    );
  const handler = {
    async handle(request: Request) {
      methods.push(request.method);
      if (request.method === "PUT") {
        const ifNoneMatch = request.headers["if-none-match"];
        const ifMatch = request.headers["if-match"];
        if ((ifNoneMatch === "*" && held) || (ifMatch !== undefined && ifMatch !== etag))
          return refuse(412, "PreconditionFailed");
        held = new Uint8Array(request.body as Uint8Array);
        writes += 1;
        etag = `"v${writes}"`;
        return writes === lostAnswer ? refuse(500, "InternalError") : answer(200, { etag });
      }
      if (request.method === "DELETE") {
        held = undefined;
        return answer(204, {});
      }
      if (request.query["list-type"] !== undefined) {
        const contents = held
          ? `<Contents><Key>root/${KEY}</Key><LastModified>2026-09-23T10:00:00.000Z</LastModified></Contents>`
          : "";
        return answer(
          200,
          { "content-type": "application/xml" },
          `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
        );
      }
      return held ? answer(200, { etag }, Buffer.from(held).toString()) : refuse(404, "NoSuchKey");
    },
  };
  const store = createS3ObjectStore(
    {
      endpoint: "https://s3.example.test",
      region: "us-east-1",
      bucket: "owner-bucket",
      prefix: "root",
      accessKeyId: "AKIAEXAMPLE0000",
      secretAccessKey: "not-a-real-secret",
    },
    { requestHandler: handler as never, sleep: async () => undefined },
  );
  return { store, methods, held: () => held };
}

/** A store whose `put` rewrites or drops the condition before the honest store sees it. */
function rewritingConditions(
  rewrite: (condition: PutCondition | undefined) => PutCondition | undefined,
) {
  const inner = createMemoryObjectStore();
  const store: ObjectStore = {
    ...inner,
    put: (key, body, condition) => inner.put(key, body, rewrite(condition)),
  };
  return { inner, store };
}

describe("probeBucket", () => {
  it("passes an honest bucket and leaves nothing behind", async () => {
    const store = createMemoryObjectStore();
    await expect(probeBucket(store, NONCE)).resolves.toEqual({ ok: true });
    expect([...store.snapshot().keys()]).toEqual([]);
    expect(
      store.calls.filter((call) => call.operation === "put").map((call) => call.condition),
    ).toEqual([
      { ifNoneMatch: "*" },
      { ifNoneMatch: "*" },
      { ifMatch: expect.any(String) },
      { ifMatch: expect.any(String) },
    ]);
  });

  it("refuses a bucket that ignores 'only if absent'", async () => {
    const { inner, store } = rewritingConditions((condition) =>
      condition && "ifNoneMatch" in condition ? undefined : condition,
    );
    await expect(probeBucket(store, NONCE)).resolves.toEqual({
      ok: false,
      reason: "create_only_ignored",
      detail: expect.any(String),
    });
    expect(inner.snapshot().has(KEY)).toBe(false);
  });

  it("refuses a bucket that ignores 'only if unchanged'", async () => {
    const { inner, store } = rewritingConditions((condition) =>
      condition && "ifMatch" in condition ? undefined : condition,
    );
    await expect(probeBucket(store, NONCE)).resolves.toEqual({
      ok: false,
      reason: "if_match_ignored",
      detail: expect.any(String),
    });
    expect(inner.snapshot().has(KEY)).toBe(false);
  });

  it("refuses a bucket that refuses even a current version", async () => {
    const { store } = rewritingConditions((condition) =>
      condition && "ifMatch" in condition ? { ifMatch: '"never"' } : condition,
    );
    await expect(probeBucket(store, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "fresh_version_refused",
    });
  });

  // Reconciliation N13: a bucket that gave NO answer is not a refusal. The supervisor reads a throw as
  // "unreachable, the lag already shows it" and an answer as "unusable" (Task 7), so the two must differ.
  it.each(["put", "list"] as const)(
    "throws the store's own error when the bucket gives no answer at the %s step, leaving nothing behind",
    async (operation) => {
      const store = createMemoryObjectStore();
      const noAnswer = failure(null, "ECONNREFUSED");
      store.failNext({ operation, error: noAnswer });
      await expect(probeBucket(store, NONCE)).rejects.toBe(noAnswer);
      // At the list step the object has been written, so only the clean-up removes it.
      expect([...store.snapshot().keys()]).toEqual([]);
    },
  );

  it.each([
    [403, "access_denied"],
    [501, "conditional_write_unsupported"],
    [500, "write_failed"],
  ] as const)("names a first write answered %s as %s", async (status, reason) => {
    const store = createMemoryObjectStore();
    store.failNext({ operation: "put", error: failure(status, "X") });
    await expect(probeBucket(store, NONCE)).resolves.toEqual({
      ok: false,
      reason,
      detail: expect.any(String),
    });
  });

  it.each([
    ["get", "read_mismatch"],
    ["list", "list_failed"],
    ["delete", "delete_failed"],
  ] as const)(
    "names a 501 at the %s step as %s, since that step made no conditional write",
    async (operation, reason) => {
      const store = createMemoryObjectStore();
      store.failNext({ operation, error: failure(501, "NotImplemented") });
      await expect(probeBucket(store, NONCE)).resolves.toEqual({
        ok: false,
        reason,
        detail: "NotImplemented (501)",
      });
    },
  );

  it("names a write refused for a reason that is not the bucket's as write_failed", async () => {
    const store = createMemoryObjectStore();
    store.failNext({ operation: "put", error: new Error("boom") });
    await expect(probeBucket(store, NONCE)).resolves.toEqual({
      ok: false,
      reason: "write_failed",
      detail: "boom",
    });
  });

  it("refuses a bucket that reads back something else, or nothing", async () => {
    const changed = createMemoryObjectStore();
    const lying: ObjectStore = {
      ...changed,
      get: async (key) =>
        (await changed.get(key)) ? { body: new Uint8Array([0]), etag: '"x"' } : null,
    };
    await expect(probeBucket(lying, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "read_mismatch",
    });
    const forgetful = createMemoryObjectStore();
    await expect(
      probeBucket({ ...forgetful, get: async () => null }, NONCE),
    ).resolves.toMatchObject({ ok: false, reason: "read_mismatch" });
    const failing = createMemoryObjectStore();
    failing.failNext({ operation: "get", error: failure(500, "InternalError") });
    await expect(probeBucket(failing, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "read_mismatch",
    });
  });

  it("refuses a bucket whose listing does not show what was written, or cannot be listed", async () => {
    const hidden = createMemoryObjectStore();
    await expect(probeBucket({ ...hidden, list: async () => [] }, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "list_failed",
    });
    const denied = createMemoryObjectStore();
    denied.failNext({ operation: "list", error: failure(403, "AccessDenied") });
    // A key without the list permission is named by the step it failed, not as a general refusal.
    await expect(probeBucket(denied, NONCE)).resolves.toEqual({
      ok: false,
      reason: "list_failed",
      detail: "AccessDenied (403)",
    });
  });

  it("refuses a bucket where a delete does not delete, or fails", async () => {
    const sticky = createMemoryObjectStore();
    await expect(
      probeBucket({ ...sticky, delete: async () => undefined }, NONCE),
    ).resolves.toMatchObject({ ok: false, reason: "delete_failed" });
    // A delete that always fails: the check reports it, and the clean-up's own failed delete is
    // swallowed rather than replacing that answer.
    const failing = createMemoryObjectStore();
    const store: ObjectStore = {
      ...failing,
      delete: async () => {
        throw failure(500, "InternalError");
      },
    };
    await expect(probeBucket(store, NONCE)).resolves.toEqual({
      ok: false,
      reason: "delete_failed",
      detail: "InternalError (500)",
    });
  });

  it.each([2, 3, 4])(
    "names condition step %i failing outright as write_failed",
    async (failingPut) => {
      const inner = createMemoryObjectStore();
      let puts = 0;
      const store: ObjectStore = {
        ...inner,
        put: async (key, body, condition) => {
          puts += 1;
          if (puts === failingPut) throw failure(500, "InternalError");
          return inner.put(key, body, condition);
        },
      };
      await expect(probeBucket(store, NONCE)).resolves.toEqual({
        ok: false,
        reason: "write_failed",
        detail: "InternalError (500)",
      });
    },
  );

  it("passes when its first write landed but was answered as refused, and leaves nothing behind", async () => {
    const store = createMemoryObjectStore();
    store.failNext({ operation: "put", error: landedRefusal(), landed: true });
    await expect(probeBucket(store, NONCE)).resolves.toEqual({ ok: true });
    expect([...store.snapshot().keys()]).toEqual([]);
  });

  it("cleans up a first write that landed but was answered as refused, when a later step fails", async () => {
    const store = createMemoryObjectStore();
    store.failNext({ operation: "put", error: landedRefusal(), landed: true });
    store.failNext({ operation: "list", error: failure(403, "AccessDenied") });
    await expect(probeBucket(store, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "list_failed",
    });
    expect([...store.snapshot().keys()]).toEqual([]);
  });

  it("reports a first write refused over an object it did not write, and leaves that object alone", async () => {
    const store = createMemoryObjectStore();
    await store.put(KEY, new TextEncoder().encode("someone else's"));
    await expect(probeBucket(store, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "write_failed",
    });
    expect(new TextDecoder().decode(store.snapshot().get(KEY)?.body)).toBe("someone else's");
  });

  it.each([
    [1, "the first write"],
    [2, "the replacing write"],
  ])(
    "passes through the real S3 client when %i (%s) lands, is answered 500, and the resend is refused",
    async (lostAnswer) => {
      const bucket = bucketLosingAnswer(lostAnswer);
      await expect(probeBucket(bucket.store, NONCE)).resolves.toEqual({ ok: true });
      expect(bucket.held()).toBeUndefined();
      // Four conditional writes, plus the client's one resend of the write that lost its answer.
      expect(bucket.methods.filter((method) => method === "PUT")).toHaveLength(5);
    },
  );

  it("keeps its answer when the clean-up's delete throws before returning a promise", async () => {
    const inner = createMemoryObjectStore();
    const store: ObjectStore = {
      ...inner,
      delete: () => {
        throw new Error("thrown at once");
      },
    };
    await expect(probeBucket(store, NONCE)).resolves.toEqual({
      ok: false,
      reason: "delete_failed",
      detail: "thrown at once",
    });
  });

  it("uses a fresh random name when none is given", async () => {
    const store = createMemoryObjectStore();
    await probeBucket(store);
    const key = store.calls[0]!.key;
    expect(key.startsWith(PROBE_PREFIX)).toBe(true);
    expect(key).not.toBe(KEY);
  });
});
