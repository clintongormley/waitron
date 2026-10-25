import { describe, expect, it } from "vitest";
import type { ClockWitness } from "./clock-witnesses.js";
import {
  agreeingDeviceGroup,
  CLOCK_WITNESS_MARGIN_MS,
  judgeClockWitnesses,
} from "./clock-witnesses.js";

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

  it("keeps an authority's latest AGREEING reading even when a newer one says nothing or disagrees", () => {
    const agreed = authority(0, 500, -10_000);
    const vague = authority(59_000, 5_000, 10_000);
    const contrary = authority(2 * HOUR_MS, 500, 5_000);
    expect(judgeClockWitnesses([agreed, vague, contrary])).toEqual({
      agreeing: [agreed],
      authorityDisagrees: [contrary],
      devicesDisagreeing: [],
    });
  });

  it("does not count a device as agreeing when its LATEST reading disagrees, even though an older one agreed", () => {
    const verdict = judgeClockWitnesses([device("a", 0, -10_000), device("a", 61_000, 10_000)]);
    expect(verdict.agreeing).toEqual([]);
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

  it("among groups of one size with the same newest reading, take the one with the smaller differences", () => {
    const low = device("low", 2 * HOUR_MS, -20_000);
    const mid = device("mid", 2 * HOUR_MS + 50_000, 5_000);
    const high = device("high", 2 * HOUR_MS + 100_000, -10_000);
    expect(ids(judgeClockWitnesses([high, mid, low]).devicesDisagreeing)).toEqual(["low", "mid"]);
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

  it("keeps the disagreeing reading when two share a box time, in either order", () => {
    const agreed = device("a", 0);
    const contrary = device("a", HOUR_MS);
    const other = device("b", HOUR_MS);
    for (const readings of [
      [agreed, contrary, other],
      [contrary, agreed, other],
    ]) {
      const verdict = judgeClockWitnesses(readings);
      expect(verdict.agreeing).toEqual([]);
      expect(verdict.devicesDisagreeing).toEqual(expect.arrayContaining([contrary, other]));
      expect(verdict.devicesDisagreeing).toHaveLength(2);
    }
  });
});

function at(address: string, witness: ClockWitness): ClockWitness {
  return { ...witness, address };
}

describe("devices at one address", () => {
  it("count once when they agree: the latest reading from the address stands for it", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", 0)),
      at("10.0.0.5", device("b", 0, 1_000)),
    ]);
    expect(ids(verdict.agreeing)).toEqual(["b"]);
  });

  it("count twice when they agree from two addresses", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", 0)),
      at("10.0.0.6", device("b", 0)),
    ]);
    expect(ids(verdict.agreeing)).toEqual(["a", "b"]);
  });

  it("make no group when two of them disagree from one address", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", HOUR_MS)),
      at("10.0.0.5", device("b", HOUR_MS)),
    ]);
    expect(verdict.devicesDisagreeing).toEqual([]);
    expect(verdict.agreeing).toEqual([]);
  });

  it("make a group of two when two disagree from two addresses", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", HOUR_MS)),
      at("10.0.0.6", device("b", HOUR_MS)),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
  });

  it("count three disagreeing ids over two addresses as a group of two, keeping each address's latest", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", HOUR_MS, 2_000)),
      at("10.0.0.5", device("b", HOUR_MS)),
      at("10.0.0.6", device("c", HOUR_MS, 1_000)),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "c"]);
  });

  it("let a newer disagreeing reading from an address replace an older agreeing one from another id there", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", 0)),
      at("10.0.0.5", device("b", HOUR_MS, 1_000)),
      at("10.0.0.6", device("c", HOUR_MS)),
    ]);
    expect(verdict.agreeing).toEqual([]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["b", "c"]);
  });

  it("keep the disagreeing reading when two from one address share a box time, in either order", () => {
    const agreed = at("10.0.0.5", device("a", 0));
    const contrary = at("10.0.0.5", device("b", HOUR_MS));
    const elsewhere = at("10.0.0.6", device("c", 0));
    const third = at("10.0.0.7", device("d", HOUR_MS));
    for (const tie of [
      [agreed, contrary],
      [contrary, agreed],
    ]) {
      expect(ids(judgeClockWitnesses([...tie, elsewhere]).agreeing)).toEqual(["c"]);
      expect(ids(judgeClockWitnesses([...tie, elsewhere, third]).devicesDisagreeing)).toEqual([
        "b",
        "d",
      ]);
    }
  });

  it("count by id alone when a witness has no address", () => {
    const verdict = judgeClockWitnesses([
      device("a", HOUR_MS),
      device("b", HOUR_MS),
      at("10.0.0.5", device("c", 0)),
      device("d", 0),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["a", "b"]);
    expect(ids(verdict.agreeing)).toEqual(["c", "d"]);
  });

  it("do not mistake an address for a device id that has no address", () => {
    const verdict = judgeClockWitnesses([
      device("10.0.0.5", HOUR_MS),
      at("10.0.0.5", device("b", HOUR_MS)),
    ]);
    expect(ids(verdict.devicesDisagreeing)).toEqual(["10.0.0.5", "b"]);
  });

  it("keep the latest reading per id before the latest per address", () => {
    const verdict = judgeClockWitnesses([
      at("10.0.0.5", device("a", HOUR_MS, 2_000)),
      at("10.0.0.6", device("a", HOUR_MS, 3_000)),
      at("10.0.0.5", device("b", HOUR_MS, 1_000)),
    ]);
    expect(verdict.devicesDisagreeing.map((witness) => witness.address).sort()).toEqual([
      "10.0.0.5",
      "10.0.0.6",
    ]);
  });
});

describe("the group of agreeing devices", () => {
  it("is empty for two devices each a minute off the box, one either way", () => {
    expect(agreeingDeviceGroup([device("behind", -60_000), device("ahead", 60_000)])).toEqual([]);
  });

  it("holds two devices each half a minute off the box, one either way", () => {
    expect(ids(agreeingDeviceGroup([device("behind", -30_000), device("ahead", 30_000)]))).toEqual([
      "ahead",
      "behind",
    ]);
  });

  it("holds two devices exactly a minute apart, and not two a millisecond more", () => {
    expect(ids(agreeingDeviceGroup([device("a", -30_000), device("b", 30_000)]))).toHaveLength(2);
    expect(agreeingDeviceGroup([device("a", -30_000), device("b", 30_001)])).toEqual([]);
  });

  it("of three a minute behind, level and a minute ahead, takes the pair seen latest", () => {
    const behind = device("behind", -60_000, -10_000);
    const level = device("level", 0);
    const ahead = device("ahead", 60_000, 10_000);
    expect(ids(agreeingDeviceGroup([behind, level, ahead]))).toEqual(["ahead", "level"]);
    const behindLatest = device("behind", -60_000, 10_000);
    const aheadEarly = device("ahead", 60_000, -10_000);
    expect(ids(agreeingDeviceGroup([aheadEarly, level, behindLatest]))).toEqual([
      "behind",
      "level",
    ]);
  });

  it("takes the larger group over a smaller one", () => {
    expect(
      ids(
        agreeingDeviceGroup([
          device("x", -55_000, 50_000),
          device("y", -55_000, 50_000),
          device("a", 30_000),
          device("b", 30_000),
          device("c", 30_000),
        ]),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("needs two: one agreeing device is no group", () => {
    expect(agreeingDeviceGroup([device("a", 0)])).toEqual([]);
  });

  it("leaves out devices that disagree with the box and every authority reading", () => {
    expect(agreeingDeviceGroup([device("a", 0), device("far", 61_000), authority(0, 500)])).toEqual(
      [],
    );
  });

  it("leaves out a device that disagrees with the box even when it is within a minute of one that agrees", () => {
    expect(agreeingDeviceGroup([device("a", 30_000), device("near", 61_000)])).toEqual([]);
  });

  it("drops a reading it cannot read, so a valid one from the same device still counts", () => {
    const unreadable = { ...device("a", 0, 10_000), witnessAt: "not a time" };
    expect(ids(agreeingDeviceGroup([unreadable, device("a", 0), device("b", 0)]))).toEqual([
      "a",
      "b",
    ]);
  });

  it("counts devices at one address once", () => {
    expect(
      agreeingDeviceGroup([at("10.0.0.5", device("a", 0)), at("10.0.0.5", device("b", 0, 1_000))]),
    ).toEqual([]);
    expect(
      ids(agreeingDeviceGroup([at("10.0.0.5", device("a", 0)), at("10.0.0.6", device("b", 0))])),
    ).toEqual(["a", "b"]);
  });

  it("lets a tie at one address keep the disagreeing reading, in either order", () => {
    const agreed = at("10.0.0.5", device("a", 0));
    const contrary = at("10.0.0.5", device("b", HOUR_MS));
    const elsewhere = at("10.0.0.6", device("c", 0));
    for (const tie of [
      [agreed, contrary],
      [contrary, agreed],
    ]) {
      expect(agreeingDeviceGroup([...tie, elsewhere])).toEqual([]);
    }
  });

  it("does not count a device whose latest reading disagrees", () => {
    expect(
      agreeingDeviceGroup([device("a", 0, -10_000), device("a", 61_000, 10_000), device("b", 0)]),
    ).toEqual([]);
  });
});

describe("a witness that cannot be judged", () => {
  const empty = { agreeing: [], authorityDisagrees: [], devicesDisagreeing: [] };

  it("is dropped when its box time is unreadable, so a later valid reading from the device counts", () => {
    const unreadable = { ...device("a", 0, -30_000), boxAt: "not a time" };
    const valid = device("a", 0);
    expect(judgeClockWitnesses([unreadable, valid]).agreeing).toEqual([valid]);
    expect(judgeClockWitnesses([valid, unreadable]).agreeing).toEqual([valid]);
  });

  it("is dropped when its own time is unreadable, so an earlier valid reading from the device counts", () => {
    const valid = device("a", 0, -30_000);
    const unreadable = { ...device("a", 0), witnessAt: "not a time" };
    expect(judgeClockWitnesses([valid, unreadable]).agreeing).toEqual([valid]);
    expect(judgeClockWitnesses([unreadable]).agreeing).toEqual([]);
  });

  it("is dropped when its uncertainty is negative, rather than turning a disagreement into agreement", () => {
    expect(judgeClockWitnesses([authority(61_001, -2_000)])).toEqual(empty);
    expect(judgeClockWitnesses([authority(0, -1)])).toEqual(empty);
  });

  it("is dropped when its uncertainty is not a finite number", () => {
    expect(judgeClockWitnesses([authority(0, Number.NaN)])).toEqual(empty);
    expect(judgeClockWitnesses([authority(0, Number.POSITIVE_INFINITY)])).toEqual(empty);
  });

  it("still counts an authority with no uncertainty at all", () => {
    const exact = authority(61_001, 0);
    expect(judgeClockWitnesses([exact]).authorityDisagrees).toEqual([exact]);
    const agreed = authority(60_000, 0);
    expect(judgeClockWitnesses([agreed]).agreeing).toEqual([agreed]);
  });

  it("does not let a dropped reading replace a valid one from the same device in a group", () => {
    const valid = device("a", 2 * HOUR_MS, -30_000);
    const broken = { ...device("a", 0), uncertaintyMs: -1 };
    expect(
      ids(judgeClockWitnesses([valid, broken, device("b", 2 * HOUR_MS)]).devicesDisagreeing),
    ).toEqual(["a", "b"]);
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
