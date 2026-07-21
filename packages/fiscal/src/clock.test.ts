import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { TrustedTimeAnchor } from "./clock.js";
import { createTrustedClock } from "./clock.js";

const TILL = "till-1";
const TRUSTED = new Date("2027-03-14T10:00:00.000Z");
const WALL_START = new Date("2027-03-14T09:59:58.000Z").getTime();

/** Mutable, injected sources. Fake timers alone are not enough — Vitest's fake timers do not
 * reliably control `performance.now()` across environments, and the whole design turns on the
 * monotonic source and the wall clock moving INDEPENDENTLY of each other. */
function makeSources(startWall = WALL_START) {
  const state = { monotonic: 1_000, wall: startWall };
  return {
    state,
    monotonic: () => state.monotonic,
    wallClock: () => state.wall,
    advance(ms: number) {
      state.monotonic += ms;
      state.wall += ms;
    },
  };
}

function makeClock(overrides: Partial<Parameters<typeof createTrustedClock>[0]> = {}) {
  const sources = makeSources();
  const clock = createTrustedClock({
    tillId: TILL,
    monotonic: sources.monotonic,
    wallClock: sources.wallClock,
    degradedAfterSeconds: 3_600,
    ...overrides,
  });
  return { clock, sources };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(WALL_START);
  return () => vi.useRealTimers();
});

describe("before any anchor exists", () => {
  it("falls back to the wall clock rather than refusing to answer", () => {
    const { clock, sources } = makeClock();
    expect(clock.now().instant.getTime()).toBe(sources.state.wall);
  });

  it("reports confidence as unanchored", () => {
    const { clock } = makeClock();
    expect(clock.now().confidence).toBe("unanchored");
    expect(clock.now().confident).toBe(false);
  });

  it("never throws", () => {
    // The load-bearing assertion of the whole file. A clock that throws stops a sale, and
    // spec §4 lists nothing fiscal that may stop a sale.
    const { clock } = makeClock();
    expect(() => clock.now()).not.toThrow();
  });

  it("reports a zero anchor age", () => {
    const { clock } = makeClock();
    expect(clock.now().anchorAgeSeconds).toBe(0);
  });
});

describe("deriving time from the anchor", () => {
  it("returns the anchored instant immediately after anchoring", () => {
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().instant.toISOString()).toBe(TRUSTED.toISOString());
  });

  it("reports confident as true while freshly anchored", () => {
    // Mutation testing found this boolean unguarded: every other test in this describe block
    // reads `.instant` only, so a mutant hardcoding `confident: false` on the happy path
    // survived. `.confidence` (the string) is checked elsewhere; this is the boolean twin.
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().confident).toBe(true);
  });

  it("advances by the monotonic elapsed, not by the wall clock", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    // Move the monotonic source WITHOUT moving the wall clock. A derived time that tracks the
    // wall clock would not move at all here.
    sources.state.monotonic += 90_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 90_000);
  });

  it("ignores a wall-clock jump forward", () => {
    // A timezone fix, a manual correction or an OS update. This is the risk the whole design
    // exists to remove, and it is why the derived instant must never read Date.now().
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 60_000;
    sources.state.wall += 3_600_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 60_000);
  });

  it("ignores a wall-clock jump backward", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 60_000;
    sources.state.wall -= 3_600_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 60_000);
  });

  it("truncates a fractional monotonic elapsed rather than rounding it", () => {
    // Bias slow, at millisecond granularity. `performance.now()` returns fractional
    // milliseconds; rounding 1500.9 up to 1501 puts the record one millisecond AHEAD of the
    // truth, and the timestamp is validated only as an upper bound.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 1_500.9;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 1_500);
  });

  it("never goes backwards when the monotonic source itself resets", () => {
    // A monotonic source that resets without a reload — a suspended worker resuming, say. The
    // earliest instant consistent with the evidence is the anchor itself, never something
    // earlier.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 60_000;
    sources.state.monotonic = 0;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime());
  });

  it("reports the anchor age in whole seconds", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 5_500;
    expect(clock.now().anchorAgeSeconds).toBe(5);
  });
});

describe("degraded confidence", () => {
  it("stays confident below the injected threshold", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 99_000;
    expect(clock.now().confidence).toBe("anchored");
    expect(clock.now().warning).toBeUndefined();
  });

  it("degrades at the injected threshold", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 100_000;
    expect(clock.now().confidence).toBe("degraded");
    expect(clock.now().confident).toBe(false);
  });

  it("still returns a usable instant while degraded", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 200_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 200_000);
  });

  it("carries the warning as a value rather than throwing it", () => {
    // Warn only. Constructing an AppError and attaching it is the whole mechanism — throwing
    // it would propagate out of the sale write path and stop the sale.
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 150_000;
    const reading = clock.now();
    expect(reading.warning).toBeInstanceOf(AppError);
    expect(reading.warning?.code).toBe("clock.degraded");
    expect(reading.warning?.params).toEqual({ tillId: TILL, anchorAgeSeconds: 150 });
  });

  it("restores confidence when re-anchored", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 200_000;
    clock.anchor({
      instant: new Date(TRUSTED.getTime() + 200_000),
      offsetMinutes: 60,
      source: "upstream",
    });
    expect(clock.now().confidence).toBe("anchored");
    expect(clock.now().anchorAgeSeconds).toBe(0);
  });

  it("accepts a trusted instant earlier than the one currently derived", () => {
    // If the local clock has run fast, an AEAT response is still authoritative. Rejecting a
    // backwards correction would pin the till to its own drift forever.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 600_000;
    const corrected = new Date(TRUSTED.getTime() + 300_000);
    clock.anchor({ instant: corrected, offsetMinutes: 60, source: "authority" });
    expect(clock.now().instant.toISOString()).toBe(corrected.toISOString());
  });
});

describe("UTC plus offset", () => {
  it("carries the offset recorded at anchor time", () => {
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().offsetMinutes).toBe(60);
  });

  it("does not read the device timezone", () => {
    // A timezone change is one of the causes of a wall-clock jump, so deriving the huso from
    // Date.prototype.getTimezoneOffset() would let the very event we defend against rewrite a
    // fiscally meaningful field.
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 120, source: "authority" });
    expect(clock.now().offsetMinutes).toBe(120);
    expect(clock.now().offsetMinutes).not.toBe(-new Date().getTimezoneOffset());
  });

  it("uses an injected resolver when one is supplied, so DST is the caller's problem", () => {
    const { clock, sources } = makeClock({
      resolveOffsetMinutes: (instant: Date) =>
        instant.getTime() >= TRUSTED.getTime() + 60_000 ? 120 : 60,
    });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().offsetMinutes).toBe(60);
    sources.state.monotonic += 120_000;
    expect(clock.now().offsetMinutes).toBe(120);
  });
});

describe("PWA reload — the monotonic reference resets", () => {
  function anchorFor(wallAtAnchor: number): TrustedTimeAnchor {
    return {
      trustedAtMs: TRUSTED.getTime(),
      offsetMinutes: 60,
      monotonicMs: 5_000,
      wallClockMs: wallAtAnchor,
      source: "authority",
    };
  }

  it("round-trips the anchor through JSON, because that is how it is persisted", () => {
    const { clock } = makeClock();
    const persisted = clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(JSON.parse(JSON.stringify(persisted))).toEqual(persisted);
  });

  it("adopts the wall-clock delta as the elapsed estimate when the wall clock is plausible", () => {
    // Reload: a brand-new monotonic source starting near zero, an anchor loaded from storage.
    // The only estimate of elapsed time available is the wall-clock difference, and here it is
    // consistent with time simply having passed.
    const sources = makeSources(WALL_START + 30_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 30_000);
  });

  it("treats an exact-zero wall-clock delta at reload as no jump at all", () => {
    // Boundary case between "time passed" and "provable backwards jump": the wall clock reads
    // EXACTLY what it read at anchor time (an instant reload, or a wall clock coarser than the
    // gap). Zero is not negative, so this must take the forward/plausible path, not the jump
    // path — a mutant that widens the jump check to `<= 0` collapses this into "degraded" with
    // no test noticing, since carriedElapsedMs is 0 either way and only `.confidence`/`.warning`
    // reveal the difference.
    const sources = makeSources(WALL_START);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    const reading = clock.now();
    expect(reading.confidence).toBe("anchored");
    expect(reading.confident).toBe(true);
    expect(reading.warning).toBeUndefined();
    expect(reading.instant.getTime()).toBe(TRUSTED.getTime());
  });

  it("keeps counting from the restored estimate on the new monotonic source", () => {
    const sources = makeSources(WALL_START + 30_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    sources.state.monotonic += 10_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 40_000);
  });

  it("detects a backwards wall-clock jump across the reload and holds at the anchor", () => {
    // The wall clock now reads EARLIER than it did when the anchor was written. Time cannot
    // have run backwards, so this is provably a jump. The earliest instant consistent with the
    // evidence is the anchor itself — which is also the slow end of the plausible range, so
    // biasing slow and being correct coincide here.
    const sources = makeSources(WALL_START - 3_600_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime());
  });

  it("reports the detected jump as a warning value, not a throw", () => {
    const sources = makeSources(WALL_START - 3_600_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    const reading = clock.now();
    expect(reading.confidence).toBe("degraded");
    expect(reading.confident).toBe(false);
    expect(reading.warning?.code).toBe("clock.jump_detected");
    expect(reading.warning?.params).toEqual({
      wallClockDeltaSeconds: -3_600,
      monotonicElapsedSeconds: 0,
    });
  });

  it("still sells after a detected jump", () => {
    const sources = makeSources(WALL_START - 3_600_000);
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    expect(() => clock.now()).not.toThrow();
    expect(clock.now().instant).toBeInstanceOf(Date);
  });

  it("clears the jump once a trusted source is contacted again", () => {
    const sources = makeSources(WALL_START - 3_600_000);
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "upstream" });
    expect(clock.now().confidence).toBe("anchored");
    expect(clock.now().warning).toBeUndefined();
  });

  it("exposes the current anchor so the caller can persist it after every contact", () => {
    const { clock } = makeClock();
    expect(clock.currentAnchor()).toBeNull();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.currentAnchor()?.trustedAtMs).toBe(TRUSTED.getTime());
    expect(clock.currentAnchor()?.wallClockMs).toBe(WALL_START);
  });
});
