import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  PRUNE_CONCURRENCY,
  claimGeneration,
  generationPrefix,
  markerKey,
  pruneGenerations,
} from "./generations.js";
import { generationName } from "./names.js";
import type { ObjectStore } from "./object-store.js";
import { createMemoryObjectStore } from "./testing/memory-store.js";

const VENUE = "loc-1";
const NODE = "3f1c2b9e-8d7a-4e21-9b0c-5a6d7e8f9012";
const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 7 * DAY;
const T0 = new Date("2026-09-01T00:00:00Z");
const gen = (term: number, at: Date = T0) => generationName(term, NODE, at);

async function rejection(promise: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("claimGeneration", () => {
  it("claims a new generation by writing its marker only if absent", async () => {
    const store = createMemoryObjectStore();
    await claimGeneration(store, VENUE, gen(1));
    expect(markerKey(VENUE, gen(1))).toBe(`venues/${VENUE}/${gen(1)}/opened.json`);
    expect(generationPrefix(VENUE, gen(1))).toBe(`venues/${VENUE}/${gen(1)}/`);
    expect(store.calls.at(-1)).toEqual({
      operation: "put",
      key: markerKey(VENUE, gen(1)),
      condition: { ifNoneMatch: "*" },
    });
    const marker = JSON.parse(
      new TextDecoder().decode((await store.get(markerKey(VENUE, gen(1))))!.body),
    );
    expect(marker).toEqual({
      generation: gen(1),
      venueId: VENUE,
      term: 1,
      nodeId: NODE,
      nonce: expect.any(String),
    });
  });

  it("refuses a generation whose marker already exists, and leaves that marker alone", async () => {
    const store = createMemoryObjectStore();
    await claimGeneration(store, VENUE, gen(1));
    const before = (await store.get(markerKey(VENUE, gen(1))))!.body;
    expect(await rejection(claimGeneration(store, VENUE, gen(1)))).toEqual({
      code: "backup.stream_precondition_failed",
      params: { key: markerKey(VENUE, gen(1)) },
    });
    expect((await store.get(markerKey(VENUE, gen(1))))!.body).toEqual(before);
  });

  it("lets exactly one of two boxes claiming the same name at once win", async () => {
    const store = createMemoryObjectStore();
    const outcomes = await Promise.allSettled([
      claimGeneration(store, VENUE, gen(1)),
      claimGeneration(store, VENUE, gen(1)),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("treats a refusal of its own landed claim as success", async () => {
    const store = createMemoryObjectStore();
    store.failNext({
      operation: "put",
      error: new AppError("backup.stream_precondition_failed", { key: markerKey(VENUE, gen(1)) }),
      landed: true,
    });
    await expect(claimGeneration(store, VENUE, gen(1))).resolves.toBeUndefined();
  });

  it("passes other failures through", async () => {
    const store = createMemoryObjectStore();
    store.failNext({
      operation: "put",
      error: new AppError("backup.stream_request_failed", {
        operation: "put",
        key: "k",
        status: 403,
        name: "AccessDenied",
      }),
    });
    expect((await rejection(claimGeneration(store, VENUE, gen(1)))).code).toBe(
      "backup.stream_request_failed",
    );
  });

  // Review Focus 1: box clocks that disagree. Two openings in the same second are either distinct
  // (different nodes: the node id is in the name) or the same name, and then the second claim is
  // refused — never merged into one folder.
  it("keeps two same-second openings apart whatever the clocks say: distinct names, or the second refused", async () => {
    const store = createMemoryObjectStore();
    const OTHER = "7a2d4c6e-1b3f-4a5c-8d9e-0f1a2b3c4d5e";
    const early = new Date("2026-09-23T12:00:00.100Z");
    const late = new Date("2026-09-23T12:00:00.900Z");
    const mine = generationName(2, NODE, early);
    const theirs = generationName(2, OTHER, late);
    expect(mine).not.toBe(theirs);
    await claimGeneration(store, VENUE, mine);
    await claimGeneration(store, VENUE, theirs);
    // The same node reading a clock that stepped back into a second it already used.
    const again = generationName(2, NODE, late);
    expect(again).toBe(mine);
    const before = (await store.get(markerKey(VENUE, mine)))!.body;
    expect(await rejection(claimGeneration(store, VENUE, again))).toEqual({
      code: "backup.stream_precondition_failed",
      params: { key: markerKey(VENUE, mine) },
    });
    expect((await store.get(markerKey(VENUE, mine)))!.body).toEqual(before);
    expect(await store.get(markerKey(VENUE, theirs))).not.toBeNull();
  });

  it("refuses a name that is not a generation, before touching the bucket", async () => {
    const store = createMemoryObjectStore();
    expect(await rejection(claimGeneration(store, VENUE, "current.json"))).toEqual({
      code: "backup.stream_name_invalid",
      params: { field: "generation", value: "current.json" },
    });
    expect(store.calls).toEqual([]);
  });
});

describe("pruneGenerations", () => {
  async function seeded() {
    let clock = T0;
    const store = createMemoryObjectStore({ now: () => clock });
    const put = async (key: string, at: Date) => {
      clock = at;
      await store.put(key, new Uint8Array([1]));
    };
    const root = `venues/${VENUE}/`;
    const old = gen(1);
    const oldButLive = gen(2);
    const oldMarkerFreshFile = gen(3);
    const fresh = gen(4, new Date("2026-09-08T00:00:00Z"));
    for (const file of ["opened.json", "0000/a.ltx", "0001/b.ltx"])
      await put(`${root}${old}/${file}`, T0);
    await put(`${root}${oldButLive}/opened.json`, T0);
    await put(`${root}${oldMarkerFreshFile}/opened.json`, T0);
    await put(`${root}${oldMarkerFreshFile}/0000/c.ltx`, new Date("2026-09-08T12:00:00Z"));
    await put(`${root}${fresh}/opened.json`, new Date("2026-09-08T00:00:00Z"));
    await put(`${root}current.json`, T0);
    await put(`${root}notes/readme.txt`, T0);
    await put(`venues/loc-2/${gen(1)}/opened.json`, T0);
    return { store, root, old, oldButLive, oldMarkerFreshFile, fresh };
  }

  it("deletes a whole generation once its newest file is older than the window and the pointer does not name it", async () => {
    const { store, root, old, oldButLive } = await seeded();
    const now = new Date(T0.getTime() + WINDOW + DAY);
    await expect(pruneGenerations(store, VENUE, oldButLive, now, WINDOW)).resolves.toEqual([old]);
    const left = [...store.snapshot().keys()];
    expect(left.filter((key) => key.startsWith(`${root}${old}/`))).toEqual([]);
    expect(left).toEqual(
      expect.arrayContaining([
        `${root}${oldButLive}/opened.json`,
        `${root}current.json`,
        `${root}notes/readme.txt`,
        `venues/loc-2/${gen(1)}/opened.json`,
      ]),
    );
  });

  it("keeps a generation whose newest file is exactly at the window's edge", async () => {
    const { store, oldButLive } = await seeded();
    await expect(
      pruneGenerations(store, VENUE, oldButLive, new Date(T0.getTime() + WINDOW), WINDOW),
    ).resolves.toEqual([]);
  });

  it("keeps the live generation however old it is", async () => {
    const { store, old, oldButLive } = await seeded();
    const now = new Date(T0.getTime() + 30 * DAY);
    const deleted = await pruneGenerations(store, VENUE, old, now, WINDOW);
    expect(deleted).not.toContain(old);
    expect(deleted).toContain(oldButLive);
  });

  it("refuses a live name that is not a generation, and a window that is not a positive duration, deleting nothing", async () => {
    const { store } = await seeded();
    const before = store.snapshot().size;
    expect(
      await rejection(pruneGenerations(store, VENUE, "current.json", new Date(), WINDOW)),
    ).toEqual({
      code: "backup.stream_name_invalid",
      params: { field: "live", value: "current.json" },
    });
    for (const windowMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        (await rejection(pruneGenerations(store, VENUE, gen(2), new Date(), windowMs))).params,
      ).toEqual({
        field: "windowMs",
        value: String(windowMs),
      });
    }
    expect(store.snapshot().size).toBe(before);
  });

  it("refuses a listing that names a key outside this venue, deleting nothing", async () => {
    const inner = createMemoryObjectStore({ now: () => T0 });
    await inner.put(`venues/${VENUE}/${gen(1)}/opened.json`, new Uint8Array([1]));
    const stray = `venues/loc-2/${gen(1)}/0000/a.ltx`;
    const store: ObjectStore = {
      ...inner,
      list: async (prefix) => [
        ...(await inner.list(prefix)),
        { key: stray, lastModified: new Date(T0) },
      ],
    };
    expect(
      await rejection(
        pruneGenerations(store, VENUE, gen(2), new Date(T0.getTime() + 2 * WINDOW), WINDOW),
      ),
    ).toEqual({ code: "backup.stream_name_invalid", params: { field: "listedKey", value: stray } });
    expect(inner.calls.filter((call) => call.operation === "delete")).toEqual([]);
  });

  it(`deletes a large generation with at most ${PRUNE_CONCURRENCY} deletes in flight`, async () => {
    const inner = createMemoryObjectStore({ now: () => T0 });
    for (let i = 0; i < 50; i += 1)
      await inner.put(`venues/${VENUE}/${gen(1)}/0000/${i}.ltx`, new Uint8Array([1]));
    let inFlight = 0;
    let most = 0;
    const store: ObjectStore = {
      ...inner,
      async delete(key) {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        await inner.delete(key);
      },
    };
    await pruneGenerations(store, VENUE, gen(2), new Date(T0.getTime() + 2 * WINDOW), WINDOW);
    expect(inner.snapshot().size).toBe(0);
    expect(most).toBe(PRUNE_CONCURRENCY);
  });

  // A generation whose marker is gone could be claimed again, and would then be streamed into
  // on top of its own old files.
  it("deletes a generation's marker last, and keeps it when a delete before it fails", async () => {
    const root = `venues/${VENUE}/${gen(1)}/`;
    const files = ["0000/a.ltx", "0000/b.ltx", "opened.json", "zz/after-the-marker.ltx"];
    const fill = async () => {
      const inner = createMemoryObjectStore({ now: () => T0 });
      for (const file of files) await inner.put(`${root}${file}`, new Uint8Array([1]));
      return inner;
    };
    const now = new Date(T0.getTime() + 2 * WINDOW);

    const whole = await fill();
    const order: string[] = [];
    const recording: ObjectStore = {
      ...whole,
      async delete(key) {
        order.push(key);
        await whole.delete(key);
      },
    };
    await pruneGenerations(recording, VENUE, gen(2), now, WINDOW);
    expect(order).toHaveLength(files.length);
    expect(order.at(-1)).toBe(markerKey(VENUE, gen(1)));

    const inner = await fill();
    const failing: ObjectStore = {
      ...inner,
      async delete(key) {
        await new Promise((resolve) => setImmediate(resolve));
        if (key === `${root}0000/a.ltx`) throw new Error("delete refused");
        await inner.delete(key);
      },
    };
    await expect(pruneGenerations(failing, VENUE, gen(2), now, WINDOW)).rejects.toThrow(
      "delete refused",
    );
    expect(inner.snapshot().has(markerKey(VENUE, gen(1)))).toBe(true);
  });

  it(`deletes several old generations through one pool of ${PRUNE_CONCURRENCY}, every marker after every file`, async () => {
    const inner = createMemoryObjectStore({ now: () => T0 });
    for (const term of [1, 3]) {
      await inner.put(markerKey(VENUE, gen(term)), new Uint8Array([1]));
      for (let i = 0; i < 5; i += 1)
        await inner.put(`venues/${VENUE}/${gen(term)}/0000/${i}.ltx`, new Uint8Array([1]));
    }
    const order: string[] = [];
    let inFlight = 0;
    let most = 0;
    const store: ObjectStore = {
      ...inner,
      async delete(key) {
        order.push(key);
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        await inner.delete(key);
      },
    };
    await expect(
      pruneGenerations(store, VENUE, gen(2), new Date(T0.getTime() + 2 * WINDOW), WINDOW),
    ).resolves.toEqual([gen(1), gen(3)]);
    expect(inner.snapshot().size).toBe(0);
    expect(most).toBe(PRUNE_CONCURRENCY);
    expect(order.slice(-2).sort()).toEqual([markerKey(VENUE, gen(1)), markerKey(VENUE, gen(3))]);
  });

  it("keeps every old generation's marker when a file delete in any of them fails", async () => {
    const inner = createMemoryObjectStore({ now: () => T0 });
    for (const term of [1, 3]) {
      await inner.put(markerKey(VENUE, gen(term)), new Uint8Array([1]));
      await inner.put(`venues/${VENUE}/${gen(term)}/0000/a.ltx`, new Uint8Array([1]));
    }
    const store: ObjectStore = {
      ...inner,
      async delete(key) {
        if (key === `venues/${VENUE}/${gen(3)}/0000/a.ltx`) throw new Error("delete refused");
        await inner.delete(key);
      },
    };
    await expect(
      pruneGenerations(store, VENUE, gen(2), new Date(T0.getTime() + 2 * WINDOW), WINDOW),
    ).rejects.toThrow("delete refused");
    expect(inner.snapshot().has(markerKey(VENUE, gen(1)))).toBe(true);
    expect(inner.snapshot().has(markerKey(VENUE, gen(3)))).toBe(true);
  });

  it("starts no further deletes once one has failed, and none after it has answered", async () => {
    const inner = createMemoryObjectStore({ now: () => T0 });
    for (let i = 0; i < 50; i += 1)
      await inner.put(`venues/${VENUE}/${gen(1)}/0000/${i}.ltx`, new Uint8Array([1]));
    let attempts = 0;
    let finished = 0;
    const store: ObjectStore = {
      ...inner,
      async delete(key) {
        attempts += 1;
        const first = attempts === 1;
        await new Promise((resolve) => setImmediate(resolve));
        if (first) throw new Error("delete refused");
        await new Promise((resolve) => setImmediate(resolve));
        await inner.delete(key);
        finished += 1;
      },
    };
    await expect(
      pruneGenerations(store, VENUE, gen(2), new Date(T0.getTime() + 2 * WINDOW), WINDOW),
    ).rejects.toThrow("delete refused");
    const atAnswer = { attempts, finished };
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({ attempts, finished }).toEqual(atAnswer);
    expect(attempts).toBeLessThanOrEqual(PRUNE_CONCURRENCY);
  });
});
