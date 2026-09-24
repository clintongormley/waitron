import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { ObjectStore, PutCondition } from "./object-store.js";
import { PROBE_PREFIX, probeBucket } from "./probe.js";
import { createMemoryObjectStore } from "./testing/memory-store.js";

const NONCE = "nonce-1";
const KEY = `${PROBE_PREFIX}${NONCE}.json`;

function failure(status: number | null, name: string): AppError {
  return new AppError("backup.stream_request_failed", { operation: "put", key: KEY, status, name });
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
  it("throws the store's own error when the bucket gives no answer at all, leaving nothing behind", async () => {
    const store = createMemoryObjectStore();
    const noAnswer = failure(null, "ECONNREFUSED");
    store.failNext({ operation: "put", error: noAnswer });
    await expect(probeBucket(store, NONCE)).rejects.toBe(noAnswer);
    expect([...store.snapshot().keys()]).toEqual([]);
  });

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
    await expect(probeBucket(denied, NONCE)).resolves.toMatchObject({
      ok: false,
      reason: "access_denied",
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

  it("uses a fresh random name when none is given", async () => {
    const store = createMemoryObjectStore();
    await probeBucket(store);
    const key = store.calls[0]!.key;
    expect(key.startsWith(PROBE_PREFIX)).toBe(true);
    expect(key).not.toBe(KEY);
  });
});
