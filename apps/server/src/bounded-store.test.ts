import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createS3ObjectStore, type ObjectStore, type StoreCall } from "@waitron/stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boundObjectStore } from "./bounded-store.js";

const never = () => new Promise<never>(() => {});

function hanging(): ObjectStore {
  return { get: never, put: never, list: never, delete: never, deleteMany: never };
}

describe("boundObjectStore", () => {
  it.each([
    ["get", (s: ObjectStore) => s.get("venues/v1/current.json"), "venues/v1/current.json"],
    ["put", (s: ObjectStore) => s.put("probe/x", new Uint8Array([1])), "probe/x"],
    ["list", (s: ObjectStore) => s.list("venues/v1/"), "venues/v1/"],
    ["delete", (s: ObjectStore) => s.delete("probe/x"), "probe/x"],
    ["delete", (s: ObjectStore) => s.deleteMany(["a", "b"]), "a"],
    ["delete", (s: ObjectStore) => s.deleteMany([]), ""],
  ] as const)(
    "refuses a %s the bucket never answers as a request with no answer",
    async (operation, call, key) => {
      await expect(call(boundObjectStore(hanging(), 10))).rejects.toMatchObject({
        code: "backup.stream_request_failed",
        params: { operation, key, status: null, name: "TimedOut" },
      });
    },
  );

  it("passes each answer and each refusal through unchanged, with the same arguments", async () => {
    const refusal = new Error("refused");
    const inner: ObjectStore = {
      get: vi.fn(async () => ({ body: new Uint8Array([7]), etag: "e1" })),
      put: vi.fn(async () => ({ etag: "e2" })),
      list: vi.fn(async () => [{ key: "k", lastModified: new Date(0) }]),
      delete: vi.fn(async () => {}),
      deleteMany: vi.fn(async () => {
        throw refusal;
      }),
    };
    const store = boundObjectStore(inner, 1_000);
    expect(await store.get("g")).toEqual({ body: new Uint8Array([7]), etag: "e1" });
    expect(await store.put("p", new Uint8Array([2]), { ifNoneMatch: "*" })).toEqual({
      etag: "e2",
    });
    expect(await store.list("l/")).toEqual([{ key: "k", lastModified: new Date(0) }]);
    await store.delete("d");
    await expect(store.deleteMany(["m"])).rejects.toBe(refusal);
    expect(inner.get).toHaveBeenCalledWith("g", { signal: expect.any(AbortSignal) });
    expect(inner.put).toHaveBeenCalledWith(
      "p",
      new Uint8Array([2]),
      { ifNoneMatch: "*" },
      { signal: expect.any(AbortSignal) },
    );
    expect(inner.list).toHaveBeenCalledWith("l/", { signal: expect.any(AbortSignal) });
    expect(inner.delete).toHaveBeenCalledWith("d", { signal: expect.any(AbortSignal) });
    expect(inner.deleteMany).toHaveBeenCalledWith(["m"], { signal: expect.any(AbortSignal) });
  });

  it("clears its timer once the bucket answers, so a finished call holds nothing open", async () => {
    vi.useFakeTimers();
    try {
      const store = boundObjectStore({ ...hanging(), get: async () => null }, 60_000);
      expect(await store.get("g")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Each method records the signal it was handed, and never answers until that signal is cancelled. */
  function untilCancelled(cancelledWith: (operation: string) => unknown = () => "cancelled") {
    const signals: (AbortSignal | undefined)[] = [];
    const wait = (operation: string, call?: StoreCall) =>
      new Promise<never>((_, reject) => {
        signals.push(call?.signal);
        call?.signal?.addEventListener("abort", () => reject(cancelledWith(operation)), {
          once: true,
        });
      });
    const store: ObjectStore = {
      get: (_key, call) => wait("get", call),
      put: (_key, _body, _condition, call) => wait("put", call),
      list: (_prefix, call) => wait("list", call),
      delete: (_key, call) => wait("delete", call),
      deleteMany: (_keys, call) => wait("delete", call),
    };
    return { store, signals };
  }

  const methods = [
    ["get", (s: ObjectStore, call?: StoreCall) => s.get("k", call)],
    ["put", (s: ObjectStore, call?: StoreCall) => s.put("k", new Uint8Array([1]), undefined, call)],
    ["list", (s: ObjectStore, call?: StoreCall) => s.list("p/", call)],
    ["delete", (s: ObjectStore, call?: StoreCall) => s.delete("k", call)],
    ["deleteMany", (s: ObjectStore, call?: StoreCall) => s.deleteMany(["k"], call)],
  ] as const;

  it.each(methods)(
    "cancels a %s still unanswered when its time passes, and still reports the time limit",
    async (_, call) => {
      const inner = untilCancelled();
      await expect(call(boundObjectStore(inner.store, 10))).rejects.toMatchObject({
        code: "backup.stream_request_failed",
        params: { status: null, name: "TimedOut" },
      });
      expect(inner.signals).toHaveLength(1);
      expect(inner.signals[0]?.aborted).toBe(true);
    },
  );

  it.each(methods)(
    "passes the caller's cancel of a %s to the bucket, and answers with the bucket's own error",
    async (operation, call) => {
      const inner = untilCancelled((name) => new Error(`${name} cancelled`));
      const caller = new AbortController();
      const answer = call(boundObjectStore(inner.store, 60_000), { signal: caller.signal });
      expect(inner.signals[0]?.aborted).toBe(false);
      caller.abort();
      await expect(answer).rejects.toThrow(
        `${operation === "deleteMany" ? "delete" : operation} cancelled`,
      );
      expect(inner.signals[0]?.aborted).toBe(true);
    },
  );

  it("leaves a call answered in time uncancelled, with no timer left behind", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const store = boundObjectStore(
        {
          ...hanging(),
          get: async (_key, call) => {
            seen = call?.signal;
            return null;
          },
        },
        60_000,
      );
      expect(await store.get("g")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(120_000);
      expect(seen).toBeInstanceOf(AbortSignal);
      expect(seen?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("boundObjectStore over the real bucket client", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it("leaves no live request behind when a read's body stalls past the time limit", async () => {
    const observed = { closed: false };
    const server = createServer((request, response) => {
      request.socket.once("close", () => (observed.closed = true));
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { etag: '"v1"', "content-length": "1000" });
        response.write("the first part");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const { port } = server.address() as AddressInfo;
    const store = createS3ObjectStore({
      endpoint: `http://127.0.0.1:${port}`,
      region: "us-east-1",
      bucket: "owner-bucket",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE0000",
      secretAccessKey: "not-a-real-secret",
    });
    await expect(boundObjectStore(store, 300).get("venues/v1/current.json")).rejects.toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "get", key: "venues/v1/current.json", status: null, name: "TimedOut" },
    });
    await vi.waitFor(() => expect(observed.closed).toBe(true), { timeout: 2_000 });
  });
});
