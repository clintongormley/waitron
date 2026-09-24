import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { TrustedTimeAnchor } from "./clock.js";
import { createTrustedClock } from "./clock.js";

const TILL = "till-1";
const TRUSTED = new Date("2027-03-14T10:00:00.000Z");
const WALL_START = new Date("2027-03-14T09:59:58.000Z").getTime();

/** Injected sources, because the design turns on the monotonic source and the wall clock moving
 * INDEPENDENTLY of each other. */
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
    // A clock that throws stops a sale.
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
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().confident).toBe(true);
  });

  it("advances by the monotonic elapsed, not by the wall clock", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    // A derived time that tracked the wall clock would not move at all here.
    sources.state.monotonic += 90_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 90_000);
  });

  it("ignores a wall-clock jump forward", () => {
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
    // Rounding up would put the record ahead of the truth, and the timestamp is validated only
    // as an upper bound.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 1_500.9;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 1_500);
  });

  it("never goes backwards when the monotonic source itself resets", () => {
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
    // Reload: a new monotonic source near zero and an anchor loaded from storage.
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
    // Zero is not negative, so this takes the forward path, not the jump path. The instant is the
    // same either way; only `.confidence` and `.warning` tell them apart.
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
