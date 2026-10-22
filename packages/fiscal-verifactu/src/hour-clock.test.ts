import { describe, expect, it } from "vitest";
import {
  compareHourClocks,
  canSelectHour,
  clockRefusal,
  type HourClockObservation,
} from "./hour-clock.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
const T = Date.parse("2026-10-24T09:00:00Z");
const RELEASE = Date.parse("2026-10-15T00:00:00.000Z");
function sample(
  source: "box" | "browser" | "internet",
  instantMs = NOW,
  uncertaintyMs = 0,
): Extract<HourClockObservation, { result: "usable" }> {
  return {
    source,
    result: "usable",
    instantMs,
    uncertaintyMs,
    wallStartedMs: NOW,
    wallFinishedMs: NOW,
    monotonicStartedMs: 1000,
    monotonicFinishedMs: 1000,
  };
}

describe("a name needs a second clock within 30 seconds of the box", () => {
  it.each([
    [30_000, true],
    [30_001, false],
    [-30_000, true],
    [-30_001, false],
  ] as const)("a browser %i milliseconds from the box is selectable: %s", (offset, allowed) => {
    const decision = compareHourClocks([sample("box", T), sample("browser", T + offset)], RELEASE);
    expect(decision.secondClock).toBe(true);
    expect(decision.disagreement).toBe(!allowed);
    expect(canSelectHour(decision)).toBe(allowed);
    if (!allowed) expect(clockRefusal(decision)).toBe("clock_disagreement");
  });

  it("reads the middle of a reading's range, not its edge", () => {
    const decision = compareHourClocks(
      [sample("box", T), sample("browser", T + 29_000, 2500)],
      RELEASE,
    );
    expect(decision.usable[1]).toMatchObject({ lowerMs: T + 26_500, upperMs: T + 31_500 });
    expect(decision.disagreement).toBe(false);
    expect(canSelectHour(decision)).toBe(true);
  });

  it("reads the middle of a range behind the box, not its edge", () => {
    const decision = compareHourClocks(
      [sample("box", T), sample("browser", T - 29_000, 2500)],
      RELEASE,
    );
    expect(decision.usable[1]).toMatchObject({ lowerMs: T - 31_500, upperMs: T - 26_500 });
    expect(decision.disagreement).toBe(false);
    expect(canSelectHour(decision)).toBe(true);
  });

  it("every other clock must agree, not just one", () => {
    const decision = compareHourClocks(
      [sample("box", T), sample("browser", T), sample("internet", T + 31_000)],
      RELEASE,
    );
    expect(decision.usable.map((entry) => entry.source)).toEqual(["box", "browser", "internet"]);
    expect(canSelectHour(decision)).toBe(false);
    expect(clockRefusal(decision)).toBe("clock_disagreement");
  });

  it("the box's clock alone is refused second_clock_missing", () => {
    const decision = compareHourClocks(
      [sample("box", T), { source: "internet", result: "unavailable", reason: "tls" }],
      RELEASE,
    );
    expect(decision.secondClock).toBe(false);
    expect(decision.unavailable).toEqual([
      { source: "internet", result: "unavailable", reason: "tls" },
    ]);
    expect(canSelectHour(decision)).toBe(false);
    expect(clockRefusal(decision)).toBe("second_clock_missing");
  });

  it("a box four days slow beside a correct browser is refused clock_disagreement", () => {
    const decision = compareHourClocks(
      [sample("box", T - 4 * 86_400_000), sample("browser", T)],
      RELEASE,
    );
    expect(canSelectHour(decision)).toBe(false);
    expect(clockRefusal(decision)).toBe("clock_disagreement");
  });

  it("readings two milliseconds apart across the UTC hour are selectable", () => {
    const boundary = Date.parse("2026-10-24T10:00:00.000Z");
    const decision = compareHourClocks(
      [sample("box", boundary - 1), sample("browser", boundary + 1)],
      RELEASE,
    );
    expect(canSelectHour(decision)).toBe(true);
  });

  it("a release after the box's reading is refused clock_unconfirmed", () => {
    const decision = compareHourClocks([sample("box", T), sample("browser", T)], T + 1);
    expect(decision.releaseBlocked).toBe(true);
    expect(canSelectHour(decision)).toBe(false);
    expect(clockRefusal(decision)).toBe("clock_unconfirmed");
  });

  it("never lets a caller understate the measured request interval", () => {
    const box = { ...sample("box"), monotonicStartedMs: 5000, monotonicFinishedMs: 5000 };
    const browser = {
      ...sample("browser", NOW + 117_000),
      wallFinishedMs: NOW + 4000,
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 5000,
    };
    const decision = compareHourClocks([box, browser], RELEASE);
    expect(decision.disagreement).toBe(true);
    expect(decision.usable[1]).toMatchObject({ lowerMs: NOW + 117_000, upperMs: NOW + 121_000 });
  });

  it("a stale browser reading is not a second clock", () => {
    const browser = {
      ...sample("browser", NOW - 180_000),
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1000,
    };
    const box = { ...sample("box"), monotonicStartedMs: 181_000, monotonicFinishedMs: 181_000 };
    const decision = compareHourClocks([box, browser], RELEASE);
    expect(decision.secondClock).toBe(false);
    expect(clockRefusal(decision)).toBe("second_clock_missing");
    expect(decision.unavailable).toContainEqual(
      expect.objectContaining({ source: "browser", reason: "stale" }),
    );
  });

  it("uses a fresh earlier observation at the box's current monotonic instant", () => {
    const browser = {
      ...sample("browser", NOW - 4000),
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1000,
    };
    const box = { ...sample("box"), monotonicStartedMs: 5000, monotonicFinishedMs: 5000 };
    const decision = compareHourClocks([box, browser], RELEASE);
    expect(decision.usable[1]).toMatchObject({ source: "browser", lowerMs: NOW, upperMs: NOW });
    expect(canSelectHour(decision)).toBe(true);
  });

  it.each([null, NOW + 1, NaN, Infinity])(
    "an absent or later release floor %s blocks the name",
    (release) => {
      const decision = compareHourClocks([sample("box"), sample("browser")], release);
      expect(decision.releaseBlocked).toBe(true);
      expect(canSelectHour(decision)).toBe(false);
      expect(clockRefusal(decision)).toBe("clock_unconfirmed");
    },
  );

  it.each(["2025-12-31T23:59:59.999Z", "2089-10-18T16:32:00.000Z"])(
    "an out-of-range clock %s is refused",
    (time) => {
      const decision = compareHourClocks(
        [sample("box", Date.parse(time)), sample("browser", Date.parse(time))],
        0,
      );
      expect(decision.rangeBlocked).toBe(true);
      expect(canSelectHour(decision)).toBe(false);
      expect(clockRefusal(decision)).toBe("clock_unconfirmed");
    },
  );
  it("a clock in the last nameable minute is in range", () => {
    const time = Date.parse("2089-10-18T16:31:59.999Z");
    const decision = compareHourClocks([sample("box", time), sample("browser", time)], 0);
    expect(decision.rangeBlocked).toBe(false);
  });

  it.each([
    { instantMs: NaN },
    { uncertaintyMs: -1 },
    { uncertaintyMs: Infinity },
    { monotonicStartedMs: 2000 },
    { monotonicFinishedMs: 7001 },
    { wallFinishedMs: NOW + 2000 },
  ])("unusable box evidence never admits a name: %j", (change) => {
    const decision = compareHourClocks(
      [{ ...sample("box"), ...change }, sample("browser")],
      RELEASE,
    );
    expect(canSelectHour(decision)).toBe(false);
    expect(decision.unavailable).toContainEqual(expect.objectContaining({ source: "box" }));
  });

  it("refuses duplicate box sources rather than choosing the convenient one", () => {
    const decision = compareHourClocks(
      [sample("box"), sample("box", NOW + 121_000), sample("browser")],
      RELEASE,
    );
    expect(canSelectHour(decision)).toBe(false);
  });

  it("a copied decision does not recreate a comparison", () => {
    const copy = { ...compareHourClocks([sample("box"), sample("browser")], RELEASE) };
    expect(canSelectHour(copy)).toBe(false);
    expect(clockRefusal(copy)).toBe("clock_unconfirmed");
  });
});
