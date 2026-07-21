import { AppError } from "@waitron/shared";
// Side-effect only: registers this package's two error codes on the shared `ErrorParams`
// registry by declaration merging. See errors.ts for why, and errors.reachability.test.ts for
// the mechanical check that this import keeps that file reachable from the package's own
// public barrel (index.ts re-exports everything below from this module).
import "./errors.js";

export type TrustedTimeSource = "upstream" | "authority";

export type ClockConfidence = "anchored" | "degraded" | "unanchored";

/** Returns milliseconds from an arbitrary origin that only ever increases within a page's
 * lifetime — `performance.now()` in the PWA. Injected rather than referenced directly so tests
 * can drive it independently of the wall clock, which is the entire point of the design. */
export type MonotonicSource = () => number;

/**
 * Persisted verbatim by the caller after every contact with a trusted source. `wallClockMs` is
 * the reading `Date.now()` gave at anchor time and exists for exactly one purpose: after a
 * reload has destroyed the monotonic reference, comparing it against the current wall clock is
 * the only way to DETECT a jump rather than silently trusting whatever the device now says.
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
   * REQUIRED, with no default, deliberately. This is a PRODUCT threshold about when to tell a
   * member of staff that the clock is stale. It is NOT the regulatory timestamp margin: the
   * published sources give no number for that, breaching it is a non-rejecting warning, and
   * AEAT appears to serve the value dynamically. A default here would become a hardcoded
   * regulatory constant the first time somebody read it as one.
   */
  degradedAfterSeconds: number;
  /** Resolves the huso for a given instant, e.g. through the venue's IANA zone. Defaults to the
   * offset recorded at anchor time — never to `Date.prototype.getTimezoneOffset()`, which
   * reports the DEVICE's zone and is precisely what a "timezone fix" changes. */
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
  /** Elapsed time carried over from before a reload, which the new monotonic source knows
   * nothing about. Zero for an anchor set in this page's lifetime. */
  let carriedElapsedMs = 0;
  let jump: { wallClockDeltaSeconds: number; monotonicElapsedSeconds: number } | null = null;

  /**
   * DOCUMENTED LIMITATION — a reload cannot prove a FORWARD wall-clock jump.
   *
   * On construction with a restored `anchor`, this page's monotonic reference is gone (a fresh
   * page load starts `performance.now()` back near zero) and the only witness left is the wall
   * clock itself. Comparing the current wall-clock reading against `anchor.wallClockMs` can
   * PROVE a backwards jump — time does not run backwards, so a wall clock reading earlier than
   * it did at anchor time is unambiguous evidence of a jump (handled in the `wallDeltaMs < 0`
   * branch below, held at the anchor). It cannot prove a forward jump: `performance.timeOrigin`
   * is itself derived from the wall clock at page-load time, so it is not an independent
   * witness, and "the wall clock reads 30 minutes later" is exactly what a genuine 30 minutes of
   * elapsed time would also produce. There is no way to tell the two apart from inside this
   * page.
   *
   * The deliberate choice is to ACCEPT this rather than invent a plausibility heuristic (e.g.
   * "reject any forward delta over N minutes as implausible"): a heuristic here would need its
   * own threshold, and an unpublished, invented threshold is exactly what findings §4 forbids
   * elsewhere in this module. Instead: the forward wall-clock delta is adopted as the elapsed
   * estimate, confidence ages against `degradedAfterSeconds` exactly as it would for genuine
   * offline elapsed time, and the next contact with a trusted source (`anchor()`) corrects
   * whatever error accumulated. This is consistent with "bias slow" only in the sense that a
   * forward jump this can't detect is the one direction this design does NOT defend against —
   * it defends against blocking a sale, not against every possible clock manipulation.
   */
  if (options.anchor) {
    const restored = options.anchor;
    const wallDeltaMs = wallClock() - restored.wallClockMs;
    if (wallDeltaMs < 0) {
      // Provably a jump: the wall clock reads earlier than it did when the anchor was written,
      // and time does not run backwards. No estimate of elapsed time is available, so hold at
      // the anchor — the earliest instant consistent with the evidence, which is also the slow
      // end of the plausible range.
      carriedElapsedMs = 0;
      jump = { wallClockDeltaSeconds: Math.trunc(wallDeltaMs / 1000), monotonicElapsedSeconds: 0 };
    } else {
      // NOT provably a jump — see the DOCUMENTED LIMITATION comment above. Adopt the forward
      // delta as the elapsed estimate; it is the only one available, and it is what genuine
      // elapsed time would also produce.
      carriedElapsedMs = wallDeltaMs;
    }
    anchor = { ...restored, monotonicMs: monotonic() };
  }

  function elapsedMs(current: TrustedTimeAnchor): number {
    const sinceAnchor = monotonic() - current.monotonicMs;
    // A monotonic source that has gone backwards has reset under us. Clamp at zero rather than
    // subtracting: the derived instant must never precede the anchor.
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
      // A trusted source always wins, including when it corrects backwards. Rejecting a
      // backwards correction would pin a till that has run fast to its own drift permanently.
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
