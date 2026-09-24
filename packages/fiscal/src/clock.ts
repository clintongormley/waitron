import { AppError } from "@waitron/shared";
// Side-effect only: registers this package's error codes on the shared `ErrorParams` registry.
import "./errors.js";

export type TrustedTimeSource = "upstream" | "authority";

export type ClockConfidence = "anchored" | "degraded" | "unanchored";

/** Milliseconds from an arbitrary origin that only increases within a page's lifetime, such as
 * `performance.now()`. Injected so it can move independently of the wall clock. */
export type MonotonicSource = () => number;

/**
 * Persisted by the caller after every contact with a trusted source. `wallClockMs` is the wall
 * clock at anchor time: after a reload has lost the monotonic reference, comparing it with the
 * current wall clock is how a backwards jump is detected.
 */
export interface TrustedTimeAnchor {
  trustedAtMs: number;
  offsetMinutes: number;
  monotonicMs: number;
  wallClockMs: number;
  source: TrustedTimeSource;
}

export interface TrustedReading {
  instant: Date;
  offsetMinutes: number;
  confident: boolean;
  confidence: ClockConfidence;
  anchorAgeSeconds: number;
  /** Constructed, never thrown. Throwing would propagate out of the sale write path. */
  warning?: AppError<"clock.degraded" | "clock.jump_detected">;
}

export interface TrustedClockOptions {
  tillId: string;
  monotonic: MonotonicSource;
  wallClock: () => number;
  /**
   * Seconds of anchor age after which confidence is reported as degraded and a warning is
   * attached to every reading.
   *
   * REQUIRED, with no default, deliberately. This is a PRODUCT threshold for telling staff the
   * clock is stale, NOT the regulatory timestamp margin, and a default here would read as one.
   */
  degradedAfterSeconds: number;
  /** Resolves the offset for a given instant. Defaults to the offset recorded at anchor time —
   * never to `Date.prototype.getTimezoneOffset()`, which reports the DEVICE's zone and is exactly
   * what a time-zone change on the device alters. */
  resolveOffsetMinutes?: (instant: Date) => number;
  /** A previously persisted anchor, supplied at construction after a reload. */
  anchor?: TrustedTimeAnchor | null;
}

export interface TrustedClock {
  now(): TrustedReading;
  anchor(trusted: {
    instant: Date;
    offsetMinutes: number;
    source: TrustedTimeSource;
  }): TrustedTimeAnchor;
  currentAnchor(): TrustedTimeAnchor | null;
}

export function createTrustedClock(options: TrustedClockOptions): TrustedClock {
  const { tillId, monotonic, wallClock, degradedAfterSeconds, resolveOffsetMinutes } = options;

  let anchor: TrustedTimeAnchor | null = null;
  /** Elapsed time carried over from before a reload. Zero for an anchor set in this page's
   * lifetime. */
  let carriedElapsedMs = 0;
  let jump: { wallClockDeltaSeconds: number; monotonicElapsedSeconds: number } | null = null;

  /**
   * DOCUMENTED LIMITATION — a reload cannot prove a FORWARD wall-clock jump. With the monotonic
   * reference gone, the wall clock is the only witness (`performance.timeOrigin` is itself derived
   * from the wall clock at page-load time, so it is not an independent one): reading earlier than
   * at anchor time proves a backwards jump, but reading later is also what genuine elapsed time
   * produces. Rather than invent a plausibility threshold, the forward delta is adopted as the
   * elapsed estimate, confidence ages against `degradedAfterSeconds` as usual, and the next
   * `anchor()` corrects it.
   */
  if (options.anchor) {
    const restored = options.anchor;
    const wallDeltaMs = wallClock() - restored.wallClockMs;
    if (wallDeltaMs < 0) {
      // Provably a jump. With no estimate of elapsed time, hold at the anchor: the earliest
      // instant consistent with the evidence.
      carriedElapsedMs = 0;
      jump = { wallClockDeltaSeconds: Math.trunc(wallDeltaMs / 1000), monotonicElapsedSeconds: 0 };
    } else {
      // NOT provably a jump — see the DOCUMENTED LIMITATION above.
      carriedElapsedMs = wallDeltaMs;
    }
    anchor = { ...restored, monotonicMs: monotonic() };
  }

  function elapsedMs(current: TrustedTimeAnchor): number {
    const sinceAnchor = monotonic() - current.monotonicMs;
    // A monotonic source that has gone backwards has reset. Clamp at zero: the derived instant
    // must never precede the anchor.
    return carriedElapsedMs + (sinceAnchor > 0 ? sinceAnchor : 0);
  }

  function offsetFor(instant: Date, fallback: number): number {
    return resolveOffsetMinutes ? resolveOffsetMinutes(instant) : fallback;
  }

  return {
    now(): TrustedReading {
      if (anchor === null) {
        const instant = new Date(wallClock());
        return {
          instant,
          offsetMinutes: offsetFor(instant, 0),
          confident: false,
          confidence: "unanchored",
          anchorAgeSeconds: 0,
        };
      }

      const elapsed = elapsedMs(anchor);
      // Truncate rather than round: the timestamp is validated only as an UPPER bound, so a
      // millisecond behind costs nothing and a millisecond ahead is the direction that trips
      // error 2004.
      const instant = new Date(anchor.trustedAtMs + Math.trunc(elapsed));
      const anchorAgeSeconds = Math.trunc(elapsed / 1000);
      const offsetMinutes = offsetFor(instant, anchor.offsetMinutes);

      if (jump !== null) {
        return {
          instant,
          offsetMinutes,
          confident: false,
          confidence: "degraded",
          anchorAgeSeconds,
          warning: new AppError("clock.jump_detected", jump),
        };
      }

      if (anchorAgeSeconds >= degradedAfterSeconds) {
        return {
          instant,
          offsetMinutes,
          confident: false,
          confidence: "degraded",
          anchorAgeSeconds,
          warning: new AppError("clock.degraded", { tillId, anchorAgeSeconds }),
        };
      }

      return {
        instant,
        offsetMinutes,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds,
      };
    },

    anchor(trusted): TrustedTimeAnchor {
      // A trusted source always wins, including when it corrects backwards: rejecting that would
      // pin a till that has run fast to its own drift.
      anchor = {
        trustedAtMs: trusted.instant.getTime(),
        offsetMinutes: trusted.offsetMinutes,
        monotonicMs: monotonic(),
        wallClockMs: wallClock(),
        source: trusted.source,
      };
      carriedElapsedMs = 0;
      jump = null;
      return anchor;
    },

    currentAnchor(): TrustedTimeAnchor | null {
      return anchor;
    },
  };
}
