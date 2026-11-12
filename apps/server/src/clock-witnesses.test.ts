import { describe, expect, it } from "vitest";
import { createClockWitnessStore } from "./clock-witnesses.js";

const START_WALL = Date.parse("2026-10-23T10:00:00.000Z");
const START_MONO = 50_000;

function clocks() {
  let wall = START_WALL;
  let mono = START_MONO;
  return {
    wall: () => wall,
    monotonic: () => mono,
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    stepWall(ms: number) {
      wall += ms;
    },
    arrived: () => ({ wallMs: wall, monoMs: mono }),
  };
}

function storeWith(clock: ReturnType<typeof clocks>) {
  return createClockWitnessStore({ wall: clock.wall, monotonic: clock.monotonic });
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("createClockWitnessStore", () => {
  it("hands out a device reading for five minutes after it arrived, then forgets it", () => {
    const clock = clocks();
    const store = storeWith(clock);
    const arrived = clock.arrived();
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 3_000, arrived);
    clock.advance(299_000);
    expect(store.witnesses()).toEqual([
      {
        id: "till-1",
        address: "192.168.10.31",
        boxAt: iso(START_WALL),
        witnessAt: iso(START_WALL + 3_000),
        uncertaintyMs: 0,
      },
    ]);
    clock.advance(2_000);
    expect(store.witnesses()).toEqual([]);
  });

  it("drops a device reading once the wall clock steps against the steady clock", () => {
    const small = clocks();
    const kept = storeWith(small);
    kept.noteDevice("till-1", "192.168.10.31", START_WALL, small.arrived());
    small.advance(10_000);
    small.stepWall(900);
    expect(kept.witnesses()).toHaveLength(1);

    const big = clocks();
    const dropped = storeWith(big);
    dropped.noteDevice("till-1", "192.168.10.31", START_WALL, big.arrived());
    big.advance(10_000);
    big.stepWall(2_000);
    expect(dropped.witnesses()).toEqual([]);
  });

  it("keeps only the later of two readings from one device", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 1_000, clock.arrived());
    clock.advance(15_000);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 16_500, clock.arrived());
    expect(store.witnesses()).toEqual([
      {
        id: "till-1",
        address: "192.168.10.31",
        boxAt: iso(START_WALL + 15_000),
        witnessAt: iso(START_WALL + 16_500),
        uncertaintyMs: 0,
      },
    ]);
  });

  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY, 8.64e15 + 1])(
    "notes no device reading of %s",
    (deviceMs) => {
      const clock = clocks();
      const store = storeWith(clock);
      store.noteDevice("till-1", "192.168.10.31", deviceMs, clock.arrived());
      expect(store.witnesses()).toEqual([]);
    },
  );

  it("hands out a fresh device reading that disagrees with the box", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 7_200_000, clock.arrived());
    expect(store.witnesses()).toEqual([
      expect.objectContaining({ id: "till-1", witnessAt: iso(START_WALL + 7_200_000) }),
    ]);
  });

  it("keeps the reading that arrived later when two from one device are noted out of order", () => {
    const clock = clocks();
    const store = storeWith(clock);
    const earlier = clock.arrived();
    clock.advance(15_000);
    const later = clock.arrived();
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 16_500, later);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 1_000, earlier);
    expect(store.witnesses()).toEqual([
      expect.objectContaining({
        boxAt: iso(START_WALL + 15_000),
        witnessAt: iso(START_WALL + 16_500),
      }),
    ]);
  });

  it.each([
    ["no address", undefined],
    ["an empty address", ""],
  ])("notes a device reading with %s as one with no address", (_, address) => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", address, START_WALL + 3_000, clock.arrived());
    expect(store.witnesses()).toEqual([
      {
        id: "till-1",
        boxAt: iso(START_WALL),
        witnessAt: iso(START_WALL + 3_000),
        uncertaintyMs: 0,
      },
    ]);
  });

  it("keeps a reading from each of two devices at one address, each naming it", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 1_000, clock.arrived());
    store.noteDevice("till-2", "192.168.10.31", START_WALL + 2_000, clock.arrived());
    expect(store.witnesses()).toEqual([
      expect.objectContaining({ id: "till-1", address: "192.168.10.31" }),
      expect.objectContaining({ id: "till-2", address: "192.168.10.31" }),
    ]);
  });

  it("keeps one device's later reading, at its new address, when its address changes", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 1_000, clock.arrived());
    clock.advance(1_000);
    store.noteDevice("till-1", "192.168.10.32", START_WALL + 2_000, clock.arrived());
    expect(store.witnesses()).toEqual([
      expect.objectContaining({ id: "till-1", address: "192.168.10.32" }),
    ]);
  });

  it("reads the box's own clocks when none are injected", () => {
    const store = createClockWitnessStore();
    const now = Date.now();
    store.noteDevice("till-1", "192.168.10.31", now, { wallMs: now, monoMs: performance.now() });
    expect(store.witnesses()).toHaveLength(1);
  });
});
