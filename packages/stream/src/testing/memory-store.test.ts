import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createMemoryObjectStore } from "./memory-store.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (body: Uint8Array | undefined) => new TextDecoder().decode(body);

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return "resolved";
}

describe("createMemoryObjectStore", () => {
  it("stores, reads back and tags each object with the quoted MD5 of its bytes, as S3 does for a PUT stored unencrypted or with SSE-S3", async () => {
    const store = createMemoryObjectStore();
    const { etag } = await store.put("a", bytes("one"));
    expect(etag).toBe(`"${createHash("md5").update("one").digest("hex")}"`);
    const got = await store.get("a");
    expect(text(got?.body)).toBe("one");
    expect(got?.etag).toBe(etag);
    expect(await store.get("missing")).toBeNull();
  });

  it("keeps the tag for a rewrite of the same bytes, so 'only if unchanged' cannot see it", async () => {
    const store = createMemoryObjectStore();
    const first = await store.put("a", bytes("one"));
    const second = await store.put("a", bytes("one"));
    expect(second.etag).toBe(first.etag);
    await expect(store.put("a", bytes("two"), { ifMatch: first.etag })).resolves.toBeDefined();
  });

  it("accepts the first tag again once the bytes change and change back", async () => {
    const store = createMemoryObjectStore();
    const original = await store.put("a", bytes("one"));
    const changed = await store.put("a", bytes("two"));
    expect(changed.etag).not.toBe(original.etag);
    await store.put("a", bytes("one"));
    await expect(store.put("a", bytes("three"), { ifMatch: original.etag })).resolves.toBeDefined();
    expect(text((await store.get("a"))?.body)).toBe("three");
  });

  it("refuses 'only if absent' on an existing key and allows it on a new one", async () => {
    const store = createMemoryObjectStore();
    await store.put("a", bytes("one"), { ifNoneMatch: "*" });
    expect(await code(store.put("a", bytes("two"), { ifNoneMatch: "*" }))).toBe(
      "backup.stream_precondition_failed",
    );
    expect(text((await store.get("a"))?.body)).toBe("one");
  });

  it("allows 'only if unchanged' on the current version, refuses a stale one, and refuses a missing object", async () => {
    const store = createMemoryObjectStore();
    const { etag } = await store.put("a", bytes("one"));
    const { etag: next } = await store.put("a", bytes("two"), { ifMatch: etag });
    expect(await code(store.put("a", bytes("three"), { ifMatch: etag }))).toBe(
      "backup.stream_precondition_failed",
    );
    expect((await store.get("a"))?.etag).toBe(next);
    expect(await code(store.put("b", bytes("x"), { ifMatch: etag }))).toBe(
      "backup.stream_precondition_failed",
    );
  });

  it("lists by prefix in key order with the time each was written", async () => {
    let now = new Date("2026-09-01T00:00:00Z");
    const store = createMemoryObjectStore({ now: () => now });
    await store.put("v/b", bytes("b"));
    now = new Date("2026-09-02T00:00:00Z");
    await store.put("v/a", bytes("a"));
    await store.put("w/c", bytes("c"));
    expect(await store.list("v/")).toEqual([
      { key: "v/a", lastModified: new Date("2026-09-02T00:00:00Z") },
      { key: "v/b", lastModified: new Date("2026-09-01T00:00:00Z") },
    ]);
  });

  it("hands out times that do not reach back into the store, and keeps none of the clock's", async () => {
    const clock = new Date("2026-09-01T00:00:00Z");
    const store = createMemoryObjectStore({ now: () => clock });
    await store.put("a", bytes("one"));
    clock.setUTCFullYear(2000);
    store.snapshot().get("a")!.lastModified.setUTCFullYear(2001);
    (await store.list(""))[0]!.lastModified.setUTCFullYear(2002);
    expect((await store.list(""))[0]!.lastModified).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(store.snapshot().get("a")!.lastModified).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("deletes, and deleting a missing key is not an error", async () => {
    const store = createMemoryObjectStore();
    await store.put("a", bytes("one"));
    await store.delete("a");
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
  });

  it("fails the next matching call on request, before or after storing", async () => {
    const store = createMemoryObjectStore();
    const refused = new AppError("backup.stream_request_failed", {
      operation: "put",
      key: "a",
      status: 500,
      name: "InternalError",
    });
    store.failNext({ operation: "put", key: "b", error: refused });
    store.failNext({ operation: "put", error: refused, landed: true });
    expect(await code(store.put("a", bytes("landed")))).toBe("backup.stream_request_failed");
    expect(text((await store.get("a"))?.body)).toBe("landed");
    expect(await code(store.put("b", bytes("never")))).toBe("backup.stream_request_failed");
    expect(await store.get("b")).toBeNull();
    for (const operation of ["get", "list", "delete"] as const) {
      store.failNext({ operation, error: refused });
    }
    expect(await code(store.get("a"))).toBe("backup.stream_request_failed");
    expect(await code(store.list(""))).toBe("backup.stream_request_failed");
    expect(await code(store.delete("a"))).toBe("backup.stream_request_failed");
  });

  it("records each call, and hands out copies that do not reach back into the store", async () => {
    const store = createMemoryObjectStore();
    const body = bytes("one");
    await store.put("a", body, { ifNoneMatch: "*" });
    body[0] = 0;
    const got = await store.get("a");
    got!.body[0] = 0;
    store.snapshot().clear();
    store.snapshot().get("a")!.body[0] = 0;
    expect(text((await store.get("a"))?.body)).toBe("one");
    expect(store.calls.map((call) => [call.operation, call.key, call.condition])).toEqual([
      ["put", "a", { ifNoneMatch: "*" }],
      ["get", "a", undefined],
      ["get", "a", undefined],
    ]);
  });
});
