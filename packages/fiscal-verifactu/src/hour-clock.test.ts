import { describe, expect, it } from "vitest";
import {
  compareHourClocks,
  confirmHourClock,
  canSelectHour,
  type HourClockObservation,
} from "./hour-clock.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
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

describe("every usable clock observation participates in hour admission", () => {
  it.each([
    [120_000, false],
    [121_000, true],
  ] as const)(
    "compares a third reading displaced by %i milliseconds",
    (difference, disagreement) => {
      const decision = compareHourClocks(
        [sample("box"), sample("browser"), sample("internet", NOW + difference)],
        RELEASE,
      );
      expect(decision.disagreement).toBe(disagreement);
      expect(decision.requiresConfirmation).toBe(disagreement);
      expect(decision.usable.map((entry) => entry.source)).toEqual(["box", "browser", "internet"]);
      expect(canSelectHour(decision)).toBe(!disagreement);
    },
  );

  it("includes uncertainty when applying the disagreement threshold", () => {
    const decision = compareHourClocks(
      [sample("box"), sample("browser", NOW + 119_999, 2)],
      RELEASE,
    );
    expect(decision.disagreement).toBe(true);
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

  it("waits when equal readings have uncertainty on both sides of the UTC hour", () => {
    const boundary = Date.parse("2026-10-16T12:00:00.000Z");
    const decision = compareHourClocks(
      [sample("box", boundary, 1), sample("browser", boundary, 1)],
      RELEASE,
    );
    expect(decision.disagreement).toBe(false);
    expect(decision.boundaryWait).toBe(true);
    expect(canSelectHour(decision, confirmHourClock(decision))).toBe(false);
  });

  it("waits even for exact readings only two milliseconds apart across the hour", () => {
    const boundary = Date.parse("2026-10-16T12:00:00.000Z");
    const decision = compareHourClocks(
      [sample("box", boundary - 1), sample("browser", boundary + 1)],
      RELEASE,
    );
    expect(decision.boundaryWait).toBe(true);
    expect(canSelectHour(decision)).toBe(false);
  });

  it("advances an older sample by monotonic elapsed time before comparing", () => {
    const browser = {
      ...sample("browser", NOW - 180_000),
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1000,
    };
    const box = { ...sample("box"), monotonicStartedMs: 181_000, monotonicFinishedMs: 181_000 };
    const decision = compareHourClocks([box, browser], RELEASE);
    expect(decision.disagreement).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
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

  it("requires displayed-time confirmation when comparisons are unavailable", () => {
    const decision = compareHourClocks(
      [sample("box"), { source: "internet", result: "unavailable", reason: "tls" }],
      RELEASE,
    );
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.unavailable).toEqual([
      { source: "internet", result: "unavailable", reason: "tls" },
    ]);
    expect(canSelectHour(decision)).toBe(false);
    expect(canSelectHour(decision, confirmHourClock(decision))).toBe(true);
  });

  it("accepting the displayed box time can resolve a disagreeing clock in another hour", () => {
    const decision = compareHourClocks(
      [sample("box"), sample("browser", NOW + 3_600_000)],
      RELEASE,
    );
    expect(decision.disagreement).toBe(true);
    expect(decision.boundaryWait).toBe(true);
    expect(canSelectHour(decision)).toBe(false);
    expect(canSelectHour(decision, confirmHourClock(decision))).toBe(true);
  });

  it("confirmation cannot resolve the box's own uncertainty across the hour", () => {
    const boundary = Date.parse("2026-10-16T12:00:00.000Z");
    const decision = compareHourClocks(
      [sample("box", boundary, 1), sample("browser", boundary + 3_600_000)],
      RELEASE,
    );
    expect(decision.disagreement).toBe(true);
    expect(canSelectHour(decision, confirmHourClock(decision))).toBe(false);
  });

  it("a copied confirmation or a confirmation for changed readings grants nothing", () => {
    const first = compareHourClocks([sample("box")], RELEASE);
    const confirmation = confirmHourClock(first);
    expect(canSelectHour(first, { ...confirmation })).toBe(false);
    expect(canSelectHour(compareHourClocks([sample("box", NOW + 1)], RELEASE), confirmation)).toBe(
      false,
    );
    expect(
      canSelectHour(
        compareHourClocks(
          [{ ...sample("box"), monotonicStartedMs: 1001, monotonicFinishedMs: 1001 }],
          RELEASE,
        ),
        confirmation,
      ),
    ).toBe(false);
  });

  it.each([null, NOW + 1, NaN, Infinity])(
    "confirmation cannot lower an absent or later release floor %s",
    (release) => {
      const decision = compareHourClocks([sample("box")], release);
      expect(decision.releaseBlocked).toBe(true);
      expect(canSelectHour(decision, confirmHourClock(decision))).toBe(false);
    },
  );

  it.each(["2025-12-31T23:59:59.999Z", "2145-08-15T16:00:00.000Z"])(
    "confirmation cannot admit an out-of-range clock %s",
    (time) => {
      const decision = compareHourClocks([sample("box", Date.parse(time))], 0);
      expect(decision.rangeBlocked).toBe(true);
      expect(canSelectHour(decision, confirmHourClock(decision))).toBe(false);
    },
  );

  it.each([
    { instantMs: NaN },
    { uncertaintyMs: -1 },
    { uncertaintyMs: Infinity },
    { monotonicStartedMs: 2000 },
    { monotonicFinishedMs: 7001 },
    { wallFinishedMs: NOW + 2000 },
  ])("unusable box evidence never becomes manual authority: %j", (change) => {
    const decision = compareHourClocks(
      [{ ...sample("box"), ...change }, sample("browser")],
      RELEASE,
    );
    expect(canSelectHour(decision, confirmHourClock(decision))).toBe(false);
    expect(decision.unavailable).toContainEqual(expect.objectContaining({ source: "box" }));
  });

  it("refuses duplicate box sources rather than choosing the convenient one", () => {
    const decision = compareHourClocks(
      [sample("box"), sample("box", NOW + 121_000), sample("browser")],
      RELEASE,
    );
    expect(canSelectHour(decision, confirmHourClock(decision))).toBe(false);
  });

  it("neither a copied decision nor its confirmation recreates a comparison", () => {
    const copy = { ...compareHourClocks([sample("box"), sample("browser")], RELEASE) };
    expect(canSelectHour(copy)).toBe(false);
    expect(canSelectHour(copy, confirmHourClock(copy))).toBe(false);
  });
});
