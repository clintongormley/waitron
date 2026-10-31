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
        kind: "device",
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
        kind: "device",
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

  it("forgets an agreeing AEAT reading after five minutes", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({ authorityMs: START_WALL + 500, uncertaintyMs: 700, at: clock.arrived() });
    clock.advance(299_000);
    expect(store.witnesses()).toEqual([
      {
        kind: "authority",
        id: "authority",
        boxAt: iso(START_WALL),
        witnessAt: iso(START_WALL + 500),
        uncertaintyMs: 700,
      },
    ]);
    clock.advance(2_000);
    expect(store.witnesses()).toEqual([]);
  });

  it("drops an agreeing AEAT reading after a clock step", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({ authorityMs: START_WALL + 500, uncertaintyMs: 700, at: clock.arrived() });
    clock.stepWall(2_000);
    expect(store.witnesses()).toEqual([]);
  });

  it("keeps a disagreeing AEAT reading through age and steps until the stop ends", () => {
    const clock = clocks();
    const store = storeWith(clock);
    const disagreeing = {
      kind: "authority",
      id: "authority",
      boxAt: iso(START_WALL),
      witnessAt: iso(START_WALL + 7_200_000),
      uncertaintyMs: 700,
    };
    store.noteAuthority({
      authorityMs: START_WALL + 7_200_000,
      uncertaintyMs: 700,
      at: clock.arrived(),
    });
    clock.advance(600_000);
    clock.stepWall(2_000);
    expect(store.witnesses()).toEqual([disagreeing]);
    store.endStop();
    expect(store.witnesses()).toEqual([]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1])(
    "notes no AEAT reading of %s",
    (authorityMs) => {
      const clock = clocks();
      const store = storeWith(clock);
      store.noteAuthority({ authorityMs, uncertaintyMs: 600, at: clock.arrived() });
      expect(store.witnesses()).toEqual([]);
      expect(store.takeNewAuthority()).toEqual([]);
    },
  );

  it("hands each AEAT reading to takeNewAuthority once", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({ authorityMs: START_WALL, uncertaintyMs: 600, at: clock.arrived() });
    store.noteDevice("till-1", "192.168.10.31", START_WALL, clock.arrived());
    clock.advance(60_000);
    store.noteAuthority({
      authorityMs: START_WALL + 60_000,
      uncertaintyMs: 600,
      at: clock.arrived(),
    });
    expect(store.takeNewAuthority().map((witness) => witness.witnessAt)).toEqual([
      iso(START_WALL),
      iso(START_WALL + 60_000),
    ]);
    expect(store.takeNewAuthority()).toEqual([]);
    clock.advance(1_000);
    store.noteAuthority({
      authorityMs: START_WALL + 61_000,
      uncertaintyMs: 600,
      at: clock.arrived(),
    });
    expect(store.takeNewAuthority().map((witness) => witness.witnessAt)).toEqual([
      iso(START_WALL + 61_000),
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

  it("hands a disagreeing AEAT reading to takeNewAuthority once", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({
      authorityMs: START_WALL + 7_200_000,
      uncertaintyMs: 600,
      at: clock.arrived(),
    });
    expect(store.takeNewAuthority().map((witness) => witness.witnessAt)).toEqual([
      iso(START_WALL + 7_200_000),
    ]);
    expect(store.takeNewAuthority()).toEqual([]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "stores no AEAT reading whose uncertainty is %s, even one far from the box",
    (uncertaintyMs) => {
      const clock = clocks();
      const store = storeWith(clock);
      store.noteAuthority({ authorityMs: START_WALL, uncertaintyMs, at: clock.arrived() });
      store.noteAuthority({
        authorityMs: START_WALL + 7_200_000,
        uncertaintyMs,
        at: clock.arrived(),
      });
      expect(store.witnesses()).toEqual([]);
      expect(store.takeNewAuthority()).toEqual([]);
    },
  );

  it.each([
    ["no address", undefined],
    ["an empty address", ""],
  ])("notes a device reading with %s as one with no address", (_, address) => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", address, START_WALL + 3_000, clock.arrived());
    expect(store.witnesses()).toEqual([
      {
        kind: "device",
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

  it("forgets every reading when cleared, but still hands AEAT's untaken ones to takeNewAuthority", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", "192.168.10.31", START_WALL, clock.arrived());
    const agreeing = { authorityMs: START_WALL, uncertaintyMs: 100, at: clock.arrived() };
    const disagreeing = {
      authorityMs: START_WALL + 3_600_000,
      uncertaintyMs: 100,
      at: clock.arrived(),
    };
    store.noteAuthority(agreeing);
    store.noteAuthority(disagreeing);
    expect(store.witnesses()).toHaveLength(3);
    store.clear();
    expect(store.witnesses()).toEqual([]);
    expect(store.takeNewAuthority().map((witness) => witness.witnessAt)).toEqual([
      iso(START_WALL),
      iso(START_WALL + 3_600_000),
    ]);
    store.noteDevice("till-1", "192.168.10.31", START_WALL, clock.arrived());
    expect(store.witnesses()).toHaveLength(1);
  });

  it("hands AEAT's readings to forSetting with the box clocks they were noted at, until a step", () => {
    const clock = clocks();
    const store = storeWith(clock);
    const agreeingAt = clock.arrived();
    store.noteAuthority({ authorityMs: START_WALL + 500, uncertaintyMs: 700, at: agreeingAt });
    clock.advance(1_000);
    const disagreeingAt = clock.arrived();
    store.noteAuthority({
      authorityMs: START_WALL + 1_000 + 172_800_000,
      uncertaintyMs: 700,
      at: disagreeingAt,
    });
    clock.advance(1_000);
    const agreeing = {
      kind: "authority",
      id: "authority",
      boxAt: iso(START_WALL),
      witnessAt: iso(START_WALL + 500),
      uncertaintyMs: 700,
    };
    const disagreeing = {
      kind: "authority",
      id: "authority",
      boxAt: iso(START_WALL + 1_000),
      witnessAt: iso(START_WALL + 1_000 + 172_800_000),
      uncertaintyMs: 700,
    };
    expect(store.witnesses()).toEqual([agreeing, disagreeing]);
    expect(store.forSetting()).toEqual([
      { witness: agreeing, at: agreeingAt },
      { witness: disagreeing, at: disagreeingAt },
    ]);

    clock.stepWall(5_000);
    expect(store.witnesses()).toEqual([disagreeing]);
    expect(store.forSetting()).toEqual([]);
  });

  it("hands forSetting no agreeing AEAT reading after a step, read before witnesses()", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({ authorityMs: START_WALL + 500, uncertaintyMs: 700, at: clock.arrived() });
    clock.stepWall(5_000);
    expect(store.forSetting()).toEqual([]);
  });

  it("hands forSetting no AEAT disagreement older than five minutes", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({
      authorityMs: START_WALL + 172_800_000,
      uncertaintyMs: 700,
      at: clock.arrived(),
    });
    clock.advance(299_000);
    expect(store.forSetting()).toHaveLength(1);
    clock.advance(2_000);
    expect(store.witnesses()).toHaveLength(1);
    expect(store.forSetting()).toEqual([]);
  });

  it("never hands a device reading to forSetting", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteDevice("till-1", "192.168.10.31", START_WALL + 172_800_000, clock.arrived());
    store.noteAuthority({
      authorityMs: START_WALL + 172_800_000,
      uncertaintyMs: 700,
      at: clock.arrived(),
    });
    expect(store.witnesses().map((witness) => witness.kind)).toEqual(["device", "authority"]);
    expect(store.forSetting().map((reading) => reading.witness.kind)).toEqual(["authority"]);
  });

  it("forgets forSetting's readings when the stop ends or the clock is cleared", () => {
    const clock = clocks();
    const store = storeWith(clock);
    store.noteAuthority({
      authorityMs: START_WALL + 172_800_000,
      uncertaintyMs: 700,
      at: clock.arrived(),
    });
    store.endStop();
    expect(store.forSetting()).toEqual([]);
    store.noteAuthority({ authorityMs: START_WALL + 500, uncertaintyMs: 700, at: clock.arrived() });
    store.clear();
    expect(store.forSetting()).toEqual([]);
  });

  it("reads the box's own clocks when none are injected", () => {
    const store = createClockWitnessStore();
    const now = Date.now();
    store.noteDevice("till-1", "192.168.10.31", now, { wallMs: now, monoMs: performance.now() });
    expect(store.witnesses()).toHaveLength(1);
  });
});
