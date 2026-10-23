import { describe, expect, it } from "vitest";
import type { ClockWitness } from "./clock-witnesses.js";
import { CLOCK_WITNESS_MARGIN_MS, judgeClockWitnesses } from "./clock-witnesses.js";

const BOX_AT_MS = Date.parse("2027-03-14T10:00:00.000Z");
const HOUR_MS = 3_600_000;

function device(id: string, offsetMs: number, boxAtShiftMs = 0): ClockWitness {
  const boxAt = BOX_AT_MS + boxAtShiftMs;
  return {
    kind: "device",
    id,
    boxAt: new Date(boxAt).toISOString(),
    witnessAt: new Date(boxAt + offsetMs).toISOString(),
    uncertaintyMs: 0,
  };
}

function authority(offsetMs: number, uncertaintyMs: number, boxAtShiftMs = 0): ClockWitness {
  const boxAt = BOX_AT_MS + boxAtShiftMs;
  return {
    kind: "authority",
    id: "authority",
    boxAt: new Date(boxAt).toISOString(),
    witnessAt: new Date(boxAt + offsetMs).toISOString(),
    uncertaintyMs,
  };
}

function ids(witnesses: readonly ClockWitness[]): string[] {
  return witnesses.map((witness) => witness.id).sort();
}

describe("the margin", () => {
  it("is one minute", () => {
    expect(CLOCK_WITNESS_MARGIN_MS).toBe(60_000);
  });
});

describe("a single witness against the box", () => {
  it("counts a device exactly a minute off, either way, as agreeing", () => {
    const ahead = device("ahead", 60_000);
    const behind = device("behind", -60_000);
    const verdict = judgeClockWitnesses([ahead, behind]);
    expect(ids(verdict.agreeing)).toEqual(["ahead", "behind"]);
    expect(verdict.devicesDisagreeing).toEqual([]);
  });

  it("counts two devices a millisecond over a minute off as disagreeing", () => {
    const verdict = judgeClockWitnesses([device("a", 60_001), device("b", 60_001)]);
    expect(verdict.agreeing).toEqual([]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
  });

  it("counts two devices a millisecond over a minute behind as disagreeing", () => {
    const verdict = judgeClockWitnesses([device("a", -60_001), device("b", -60_001)]);
    expect(verdict.agreeing).toEqual([]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
  });

  it("widens an authority's difference by its uncertainty before calling it agreeing", () => {
    const within = authority(59_000, 1_000);
    expect(judgeClockWitnesses([within])).toEqual({
      agreeing: [within],
      authorityDisagrees: [],
      devicesDisagreeing: [],
    });
    const behind = authority(-59_000, 1_000);
    expect(judgeClockWitnesses([behind]).agreeing).toEqual([behind]);
  });

  it("lets an authority whose uncertainty straddles the minute say nothing", () => {
    expect(judgeClockWitnesses([authority(59_000, 1_001)])).toEqual({
      agreeing: [],
      authorityDisagrees: [],
      devicesDisagreeing: [],
    });
    expect(judgeClockWitnesses([authority(61_000, 1_000)])).toEqual({
      agreeing: [],
      authorityDisagrees: [],
      devicesDisagreeing: [],
    });
  });

  it("calls an authority disagreeing only once its difference less its uncertainty passes the minute", () => {
    const ahead = authority(61_001, 1_000);
    expect(judgeClockWitnesses([ahead])).toEqual({
      agreeing: [],
      authorityDisagrees: [ahead],
      devicesDisagreeing: [],
    });
    const behind = authority(-61_001, 1_000);
    expect(judgeClockWitnesses([behind]).authorityDisagrees).toEqual([behind]);
  });

  it("lists every disagreeing authority reading, the latest first", () => {
    const older = authority(2 * HOUR_MS, 500, -10_000);
    const newest = authority(2 * HOUR_MS, 500, 10_000);
    const middle = authority(2 * HOUR_MS, 500);
    expect(judgeClockWitnesses([older, newest, middle]).authorityDisagrees).toEqual([
      newest,
      middle,
      older,
    ]);
  });

  it("keeps only the latest agreeing authority reading", () => {
    const older = authority(0, 500, -10_000);
    const newer = authority(0, 500, 10_000);
    expect(judgeClockWitnesses([newer, older]).agreeing).toEqual([newer]);
    expect(judgeClockWitnesses([older, newer]).agreeing).toEqual([newer]);
  });
});

describe("devices that disagree with the box", () => {
  it("group two devices whose differences are within a minute of each other", () => {
    const verdict = judgeClockWitnesses([
      device("a", 2 * HOUR_MS),
      device("b", 2 * HOUR_MS + 59_000),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
  });

  it("group two devices exactly a minute apart", () => {
    const verdict = judgeClockWitnesses([
      device("a", 2 * HOUR_MS),
      device("b", 2 * HOUR_MS + 60_000),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
  });

  it("do not group two devices more than a minute apart", () => {
    const verdict = judgeClockWitnesses([
      device("a", 2 * HOUR_MS),
      device("b", 2 * HOUR_MS + 61_000),
    ]);
    expect(verdict.devicesDisagreeing).toEqual([]);
    expect(verdict.agreeing).toEqual([]);
  });

  it("need two: one device alone is no group", () => {
    expect(judgeClockWitnesses([device("a", 2 * HOUR_MS)]).devicesDisagreeing).toEqual([]);
  });

  it("do not count a device that agrees with the box", () => {
    const verdict = judgeClockWitnesses([device("a", 30_000), device("b", 61_000)]);
    expect(ids(verdict.agreeing)).toEqual(["a"]);
    expect(verdict.devicesDisagreeing).toEqual([]);
  });

  it("pick the group of two out of three when the third is off the other way", () => {
    const verdict = judgeClockWitnesses([
      device("a", 2 * HOUR_MS),
      device("far", -3 * HOUR_MS),
      device("b", 2 * HOUR_MS + 30_000),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
  });

  it("pick the larger group over a smaller one", () => {
    const verdict = judgeClockWitnesses([
      device("x", -3 * HOUR_MS, 50_000),
      device("y", -3 * HOUR_MS, 50_000),
      device("a", 2 * HOUR_MS),
      device("b", 2 * HOUR_MS),
      device("c", 2 * HOUR_MS),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b", "c"]);
  });

  it("pick the larger group even when a smaller one was seen later", () => {
    const verdict = judgeClockWitnesses([
      device("a", -3 * HOUR_MS, -50_000),
      device("b", -3 * HOUR_MS, -50_000),
      device("c", -3 * HOUR_MS, -50_000),
      device("x", 2 * HOUR_MS, 50_000),
      device("y", 2 * HOUR_MS, 50_000),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b", "c"]);
  });

  it("break a tie between groups of one size by each group's newest reading, not its oldest", () => {
    const verdict = judgeClockWitnesses([
      device("wide-old", -3 * HOUR_MS, -30_000),
      device("wide-new", -3 * HOUR_MS, 10_000),
      device("narrow-old", 2 * HOUR_MS, -5_000),
      device("narrow-new", 2 * HOUR_MS, 5_000),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["wide-new", "wide-old"]);
  });

  it("need every pair to agree, and among groups of one size take the one seen latest", () => {
    const low = device("low", 2 * HOUR_MS, -20_000);
    const mid = device("mid", 2 * HOUR_MS + 50_000, -10_000);
    const high = device("high", 2 * HOUR_MS + 100_000, 5_000);
    expect(ids(judgeClockWitnesses([low, mid, high]).devicesDisagreeing)).toEqual(["high", "mid"]);
    expect(ids(judgeClockWitnesses([high, mid, low]).devicesDisagreeing)).toEqual(["high", "mid"]);

    const lowLatest = device("low", 2 * HOUR_MS, 5_000);
    const highEarly = device("high", 2 * HOUR_MS + 100_000, -20_000);
    expect(ids(judgeClockWitnesses([lowLatest, mid, highEarly]).devicesDisagreeing)).toEqual([
      "low",
      "mid",
    ]);
    expect(ids(judgeClockWitnesses([highEarly, mid, lowLatest]).devicesDisagreeing)).toEqual([
      "low",
      "mid",
    ]);
  });
});

describe("the same device twice", () => {
  it("counts only the reading with the later box time", () => {
    const stale = device("a", 2 * HOUR_MS, -30_000);
    const fresh = device("a", 0, 30_000);
    expect(judgeClockWitnesses([stale, fresh, device("b", 2 * HOUR_MS)])).toEqual({
      agreeing: [fresh],
      authorityDisagrees: [],
      devicesDisagreeing: [],
    });
    expect(judgeClockWitnesses([fresh, device("b", 2 * HOUR_MS), stale]).agreeing).toEqual([fresh]);
  });

  it("lets a later disagreeing reading replace an earlier agreeing one", () => {
    const verdict = judgeClockWitnesses([
      device("a", 0, -30_000),
      device("a", 2 * HOUR_MS, 30_000),
      device("b", 2 * HOUR_MS),
    ]);
    expect(verdict.agreeing).toEqual([]);
    expect(verdict.devicesDisagreeing).toEqual(
      expect.arrayContaining([device("a", 2 * HOUR_MS, 30_000), device("b", 2 * HOUR_MS)]),
    );
    expect(verdict.devicesDisagreeing).toHaveLength(2);
  });
});

describe("no witnesses", () => {
  it("gives an empty verdict", () => {
    expect(judgeClockWitnesses([])).toEqual({
      agreeing: [],
      authorityDisagrees: [],
      devicesDisagreeing: [],
    });
  });
});
