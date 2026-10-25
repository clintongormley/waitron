import { describe, expect, it } from "vitest";
import { floorViewChoices, type FloorViewIdentity } from "./floor-view-memory.js";

const identity: FloorViewIdentity = { origin: "https://venue.example", deviceId: "device-1" };
const z1Key = 'waitron.floorView.["https://venue.example","device-1","z1"]';

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const blocked = () => {
  throw new Error("storage blocked");
};

describe("floor view memory", () => {
  it("remembers a zone's view across a restart", () => {
    const saved = storage();
    floorViewChoices(saved, identity).remember("z1", "list");
    const restarted = floorViewChoices(saved, identity);
    expect(restarted.read("z1")).toBe("list");
    expect(restarted.read("z2")).toBeUndefined();
    expect([...saved.values.keys()]).toEqual([z1Key]);
  });

  it("keeps devices and venues apart", () => {
    const saved = storage();
    floorViewChoices(saved, identity).remember("z1", "list");
    floorViewChoices(saved, { ...identity, deviceId: "device-2" }).remember("z1", "map");
    floorViewChoices(saved, { ...identity, origin: "https://other.example" }).remember("z1", "map");
    expect(floorViewChoices(saved, identity).read("z1")).toBe("list");
    expect(floorViewChoices(saved, { ...identity, deviceId: "device-3" }).read("z1")).toBe(
      undefined,
    );
    expect(
      floorViewChoices(saved, { origin: "https://third.example", deviceId: "device-1" }).read("z1"),
    ).toBeUndefined();
    floorViewChoices(saved, { ...identity, deviceId: "device-2" }).remember("z1", "list");
    expect(
      floorViewChoices(saved, { ...identity, origin: "https://other.example" }).read("z1"),
    ).toBe("map");
  });

  it.each(["grid", '"map"'])(
    "ignores and removes a stored value that is not map or list (%s)",
    (bad) => {
      const saved = storage();
      saved.setItem(z1Key, bad);
      expect(floorViewChoices(saved, identity).read("z1")).toBeUndefined();
      expect(saved.values.has(z1Key)).toBe(false);
    },
  );

  it.each(["throws", null] as const)(
    "a store that refuses every call (or is %s) still remembers for this instance",
    (mode) => {
      const choices = floorViewChoices(
        mode === null ? null : { getItem: blocked, setItem: blocked, removeItem: blocked },
        identity,
      );
      expect(() => choices.remember("z1", "map")).not.toThrow();
      expect(choices.read("z1")).toBe("map");
      expect(choices.read("z2")).toBeUndefined();
    },
  );

  it("a refused removal does not bring the bad value back", () => {
    const saved = storage();
    saved.setItem(z1Key, "grid");
    let reads = 0;
    const choices = floorViewChoices(
      {
        ...saved,
        getItem: (key) => {
          reads++;
          return saved.getItem(key);
        },
        removeItem: blocked,
      },
      identity,
    );
    expect(choices.read("z1")).toBeUndefined();
    expect(saved.values.get(z1Key)).toBe("grid");
    expect(choices.read("z1")).toBeUndefined();
    expect(reads).toBe(1);
  });
});
