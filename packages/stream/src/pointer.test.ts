import { describe, expect, it } from "vitest";
import { canonicalize, generateNodeKeyPair, signBytes } from "@waitron/membership";
import type { CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { generationName } from "./names.js";
import {
  pointerKey,
  pointerMessage,
  readPointer,
  SentPointers,
  signPointer,
  verifyPointer,
  writePointer,
} from "./pointer.js";
import type { SignedPointer, StreamPointer } from "./pointer.js";
import { createMemoryObjectStore } from "./testing/memory-store.js";

const VENUE = "loc-1";
const NODE = "3f1c2b9e-8d7a-4e21-9b0c-5a6d7e8f9012";
const OTHER_NODE = "7a2d4c6e-1b3f-4a5c-8d9e-0f1a2b3c4d5e";
const KEYS = generateNodeKeyPair();
const OTHER_KEYS = generateNodeKeyPair();

function body(overrides: Partial<StreamPointer> = {}): StreamPointer {
  const term = overrides.term ?? 2;
  const nodeId = overrides.nodeId ?? NODE;
  return {
    venueId: VENUE,
    term,
    nodeId,
    generation: generationName(term, nodeId, new Date("2026-09-23T10:00:00Z")),
    writtenAt: "2026-09-23T10:05:00.000Z",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("signing and verifying", () => {
  it("verifies against the key that signed, and against nothing else", () => {
    const pointer = signPointer(body(), KEYS.privateKey);
    expect(verifyPointer(pointer, KEYS.publicKey)).toBe(true);
    expect(verifyPointer(pointer, OTHER_KEYS.publicKey)).toBe(false);
  });

  it("refuses a pointer whose body was changed after signing", () => {
    const pointer = signPointer(body(), KEYS.privateKey);
    const moved = {
      ...pointer,
      body: {
        ...pointer.body,
        generation: generationName(2, NODE, new Date("2026-09-24T00:00:00Z")),
      },
    };
    expect(verifyPointer(moved, KEYS.publicKey)).toBe(false);
  });

  it("refuses a malformed pointer rather than throwing", () => {
    const pointer = signPointer(body(), KEYS.privateKey);
    expect(
      verifyPointer({ ...pointer, extra: 1 } as unknown as SignedPointer, KEYS.publicKey),
    ).toBe(false);
    expect(verifyPointer({ ...pointer, signature: "not base64!" }, KEYS.publicKey)).toBe(false);
  });

  it("does not accept a signature the same key made over the bare body, so no other signed document can pass as a pointer", () => {
    const signature = signBytes(canonicalize(body() as unknown as CanonicalValue), KEYS.privateKey);
    expect(verifyPointer({ body: body(), signature }, KEYS.publicKey)).toBe(false);
    expect(pointerMessage(body())).toContain('"purpose":"waitron.stream.pointer.v1"');
  });

  it("refuses to sign a malformed body", () => {
    try {
      signPointer({ ...body(), term: -1 }, KEYS.privateKey);
      expect.unreachable("signPointer accepted term -1");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("backup.stream_pointer_invalid");
    }
  });
});

describe("readPointer", () => {
  it("answers null for a venue no box has streamed yet", async () => {
    await expect(readPointer(createMemoryObjectStore(), VENUE)).resolves.toBeNull();
  });

  it.each([
    ["not_json", "{"],
    ["not_json", "ÿ"],
    ["shape", JSON.stringify({ body: body(), signature: "s", extra: 1 })],
    ["shape", JSON.stringify({ body: { ...body(), extra: 1 }, signature: "s" })],
    ["shape", JSON.stringify({ body: { ...body(), term: "2" }, signature: "s" })],
    ["shape", JSON.stringify([])],
    ["venue_id", JSON.stringify({ body: { ...body(), venueId: "a/b" }, signature: "s" })],
    ["term", JSON.stringify({ body: { ...body(), term: 1.5 }, signature: "s" })],
    [
      "generation",
      JSON.stringify({ body: { ...body(), generation: "current.json" }, signature: "s" }),
    ],
    ["generation", JSON.stringify({ body: { ...body(), nodeId: OTHER_NODE }, signature: "s" })],
    ["generation", JSON.stringify({ body: { ...body(), term: 3 }, signature: "s" })],
    ["written_at", JSON.stringify({ body: { ...body(), writtenAt: "yesterday" }, signature: "s" })],
    ["other_venue", JSON.stringify({ body: { ...body(), venueId: "loc-2" }, signature: "s" })],
  ])("refuses a stored pointer as %s", async (reason, stored) => {
    const store = createMemoryObjectStore();
    const raw = stored === "ÿ" ? new Uint8Array([0xff]) : new TextEncoder().encode(stored);
    await store.put(pointerKey(VENUE), raw);
    expect(await rejection(readPointer(store, VENUE))).toEqual({
      code: "backup.stream_pointer_invalid",
      params: { reason },
    });
  });
});

describe("writePointer", () => {
  it("writes the first pointer only if none exists, and reads it back with its version", async () => {
    const store = createMemoryObjectStore();
    const pointer = signPointer(body(), KEYS.privateKey);
    await writePointer(store, VENUE, pointer, null);
    expect(store.calls.at(-1)).toEqual({
      operation: "put",
      key: pointerKey(VENUE),
      condition: { ifNoneMatch: "*" },
    });
    const read = await readPointer(store, VENUE);
    expect(read?.pointer).toEqual(pointer);
    expect(read?.etag).toBe(store.snapshot().get(pointerKey(VENUE))?.etag);
  });

  it("a first write loses when another box wrote first", async () => {
    const store = createMemoryObjectStore();
    await writePointer(
      store,
      VENUE,
      signPointer(body({ nodeId: OTHER_NODE }), OTHER_KEYS.privateKey),
      null,
    );
    expect(
      await rejection(writePointer(store, VENUE, signPointer(body(), KEYS.privateKey), null)),
    ).toEqual({
      code: "backup.stream_precondition_failed",
      params: { key: pointerKey(VENUE) },
    });
  });

  it("replaces the pointer when it is unchanged since it was read", async () => {
    const store = createMemoryObjectStore();
    await writePointer(store, VENUE, signPointer(body(), KEYS.privateKey), null);
    const read = await readPointer(store, VENUE);
    const next = signPointer(body({ term: 3 }), KEYS.privateKey);
    await writePointer(store, VENUE, next, read!.etag);
    expect(store.calls.at(-1)?.condition).toEqual({ ifMatch: read!.etag });
    expect((await readPointer(store, VENUE))?.pointer).toEqual(next);
  });

  it("refuses to replace the pointer when it changed since it was read", async () => {
    const store = createMemoryObjectStore();
    await writePointer(store, VENUE, signPointer(body(), KEYS.privateKey), null);
    const read = await readPointer(store, VENUE);
    const theirs = signPointer(body({ term: 3, nodeId: OTHER_NODE }), OTHER_KEYS.privateKey);
    await writePointer(store, VENUE, theirs, read!.etag);
    const ours = signPointer(body({ term: 3 }), KEYS.privateKey);
    expect(await rejection(writePointer(store, VENUE, ours, read!.etag))).toEqual({
      code: "backup.stream_precondition_failed",
      params: { key: pointerKey(VENUE) },
    });
    expect((await readPointer(store, VENUE))?.pointer).toEqual(theirs);
  });

  it("treats a refusal of its OWN write — landed, answer lost, retried — as success", async () => {
    const store = createMemoryObjectStore();
    const pointer = signPointer(body(), KEYS.privateKey);
    store.failNext({
      operation: "put",
      error: new AppError("backup.stream_precondition_failed", { key: pointerKey(VENUE) }),
      landed: true,
    });
    await expect(writePointer(store, VENUE, pointer, null)).resolves.toBeUndefined();
    expect((await readPointer(store, VENUE))?.pointer).toEqual(pointer);
  });

  it("passes every other failure through unchanged", async () => {
    const store = createMemoryObjectStore();
    store.failNext({
      operation: "put",
      error: new AppError("backup.stream_request_failed", {
        operation: "put",
        key: pointerKey(VENUE),
        status: 403,
        name: "AccessDenied",
      }),
    });
    expect(
      (await rejection(writePointer(store, VENUE, signPointer(body(), KEYS.privateKey), null)))
        .code,
    ).toBe("backup.stream_request_failed");
  });

  it("refuses a malformed or other-venue pointer before touching the bucket", async () => {
    const store = createMemoryObjectStore();
    const pointer = signPointer(body(), KEYS.privateKey);
    expect((await rejection(writePointer(store, "loc-2", pointer, null))).params).toEqual({
      reason: "other_venue",
    });
    expect(
      (
        await rejection(
          writePointer(
            store,
            VENUE,
            { ...pointer, signature: 7 } as unknown as SignedPointer,
            null,
          ),
        )
      ).params,
    ).toEqual({
      reason: "shape",
    });
    expect(store.calls).toEqual([]);
  });
});

describe("SentPointers", () => {
  it("holds the exact bytes writePointer stored, and not a pointer that differs only in its signature", async () => {
    const store = createMemoryObjectStore();
    const mine = signPointer(body(), KEYS.privateKey);
    const sent = new SentPointers();
    sent.add(mine);
    await writePointer(store, VENUE, mine, null);
    expect(sent.includes((await store.get(pointerKey(VENUE)))!.body)).toBe(true);
    const twin = signPointer(body(), OTHER_KEYS.privateKey);
    await writePointer(store, VENUE, twin, (await readPointer(store, VENUE))!.etag);
    expect(sent.includes((await store.get(pointerKey(VENUE)))!.body)).toBe(false);
  });
});
