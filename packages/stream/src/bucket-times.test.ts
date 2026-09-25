import { describe, expect, it } from "vitest";
import { bucketClockOffset, levelFolder, newestUpload } from "./bucket-times.js";
import { generationPrefix } from "./generations.js";
import type { ObjectStore } from "./object-store.js";
import { createMemoryObjectStore } from "./testing/memory-store.js";

const VENUE = "c0000000-0000-4000-8000-000000000002";
const GENERATION = "gen-0-c0000000-0000-4000-8000-000000000008-20260923T090000Z";
const AT = (minute: number) => new Date(Date.UTC(2026, 8, 23, 12, minute));

async function generationWith(files: Record<string, number>) {
  let clock = AT(0);
  const store = createMemoryObjectStore({ now: () => clock });
  for (const [name, minute] of Object.entries(files)) {
    clock = AT(minute);
    await store.put(`${generationPrefix(VENUE, GENERATION)}${name}`, Uint8Array.from([1]));
  }
  return store;
}

describe("levelFolder", () => {
  it("names a level by four lowercase hex digits and a slash", () => {
    expect(levelFolder(0)).toBe("0000/");
    expect(levelFolder(10)).toBe("000a/");
  });
});

describe("newestUpload", () => {
  it("is the newest object anywhere in the generation, whatever order the listing gives", async () => {
    const store = await generationWith({
      "0000/a.ltx": 5,
      "0003/b.ltx": 40,
      "0001/c.ltx": 10,
    });
    expect(await newestUpload(store, VENUE, GENERATION)).toEqual(AT(40));
  });

  it("reads only the named level's folder when one is given", async () => {
    const store = await generationWith({ "0000/a.ltx": 5, "0001/b.ltx": 30, "0003/c.ltx": 40 });
    expect(await newestUpload(store, VENUE, GENERATION, { level: 1 })).toEqual(AT(30));
    expect(store.calls.at(-1)).toMatchObject({
      operation: "list",
      key: `${generationPrefix(VENUE, GENERATION)}0001/`,
    });
  });

  it("keeps the floor when nothing listed is newer, and is null for an empty generation", async () => {
    const store = await generationWith({ "0000/a.ltx": 5 });
    expect(await newestUpload(store, VENUE, GENERATION, { level: 0, floor: AT(20) })).toEqual(
      AT(20),
    );
    expect(await newestUpload(store, VENUE, GENERATION, { level: 1 })).toBeNull();
  });
});

describe("bucketClockOffset", () => {
  it("is the object's time on the bucket's clock minus the middle of the write on the caller's", async () => {
    const store = createMemoryObjectStore({ now: () => new Date(100_000) });
    await store.put("probe", Uint8Array.from([1]));
    expect(await bucketClockOffset(store, "probe", 10_000, 30_000)).toBe(80_000);
  });

  it("is null when the listing does not show the object", async () => {
    const store = createMemoryObjectStore({ now: () => new Date(100_000) });
    await store.put("probe-other", Uint8Array.from([1]));
    expect(await bucketClockOffset(store, "probe", 0, 0)).toBeNull();
  });

  it("passes a failed listing on", async () => {
    const failing: ObjectStore = {
      ...createMemoryObjectStore(),
      list: async () => {
        throw new Error("unreachable");
      },
    };
    await expect(bucketClockOffset(failing, "probe", 0, 0)).rejects.toThrow("unreachable");
  });
});
