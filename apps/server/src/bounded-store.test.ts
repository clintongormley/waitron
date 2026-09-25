import type { ObjectStore } from "@waitron/stream";
import { describe, expect, it, vi } from "vitest";
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
    expect(inner.get).toHaveBeenCalledWith("g");
    expect(inner.put).toHaveBeenCalledWith("p", new Uint8Array([2]), { ifNoneMatch: "*" });
    expect(inner.list).toHaveBeenCalledWith("l/");
    expect(inner.delete).toHaveBeenCalledWith("d");
    expect(inner.deleteMany).toHaveBeenCalledWith(["m"]);
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
});
