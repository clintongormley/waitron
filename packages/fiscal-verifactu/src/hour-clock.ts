export interface SetupBrowserClockSample {
  readonly challengeId: string;
  readonly instantMs: number;
}
export type HourClockSource = "box" | "browser" | "internet";
// Intervals use this server process's monotonic clock; sample the box after comparisons finish.
export type HourClockObservation =
  | {
      source: HourClockSource;
      result: "usable";
      instantMs: number;
      uncertaintyMs: number;
      wallStartedMs: number;
      wallFinishedMs: number;
      monotonicStartedMs: number;
      monotonicFinishedMs: number;
    }
  | {
      source: HourClockSource;
      result: "unavailable";
      reason: string;
      wallStartedMs?: number;
      wallFinishedMs?: number;
      monotonicStartedMs?: number;
      monotonicFinishedMs?: number;
      uncertaintyMs?: null;
    };

export interface HourClockDecision {
  readonly usable: readonly { source: HourClockSource; lowerMs: number; upperMs: number }[];
  readonly unavailable: readonly Extract<HourClockObservation, { result: "unavailable" }>[];
  readonly secondClock: boolean;
  readonly disagreement: boolean;
  readonly releaseBlocked: boolean;
  readonly rangeBlocked: boolean;
}

const decisions = new WeakSet<HourClockDecision>();
const AGREEMENT_MS = 30_000;
const MINUTE_MS = 60_000;
const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");
const END_MS = EPOCH_MS + 32 ** 5 * MINUTE_MS;

function validSample(sample: Extract<HourClockObservation, { result: "usable" }>): boolean {
  const duration = sample.monotonicFinishedMs - sample.monotonicStartedMs;
  return (
    [
      sample.instantMs,
      sample.uncertaintyMs,
      sample.wallStartedMs,
      sample.wallFinishedMs,
      sample.monotonicStartedMs,
      sample.monotonicFinishedMs,
    ].every(Number.isFinite) &&
    sample.uncertaintyMs >= 0 &&
    sample.uncertaintyMs <= 5000 &&
    duration >= 0 &&
    duration <= 5000 &&
    Math.abs(sample.wallFinishedMs - sample.wallStartedMs - duration) <= 1000
  );
}

export function compareHourClocks(
  observations: readonly HourClockObservation[],
  releaseInstantMs: number | null,
): HourClockDecision {
  const counts = new Map<HourClockSource, number>();
  for (const sample of observations)
    counts.set(sample.source, (counts.get(sample.source) ?? 0) + 1);
  const box = observations.find(
    (sample): sample is Extract<HourClockObservation, { result: "usable" }> =>
      sample.source === "box" &&
      sample.result === "usable" &&
      counts.get("box") === 1 &&
      validSample(sample),
  );
  const usable: HourClockDecision["usable"][number][] = [];
  const unavailable: HourClockDecision["unavailable"][number][] = [];
  for (const sample of observations) {
    let reason: string | undefined;
    if (counts.get(sample.source) !== 1) reason = "duplicate";
    else if (sample.result === "unavailable") reason = sample.reason;
    else if (!validSample(sample) || box === undefined) reason = "invalid";
    else if (
      box.monotonicFinishedMs - sample.monotonicFinishedMs > 30_000 ||
      sample.monotonicFinishedMs > box.monotonicFinishedMs
    )
      reason = "stale";
    if (reason !== undefined) {
      unavailable.push(
        Object.freeze({
          ...(sample.result === "unavailable" ? sample : {}),
          source: sample.source,
          result: "unavailable",
          reason,
        }),
      );
    } else if (sample.result === "usable") {
      const elapsed =
        box!.monotonicFinishedMs - (sample.monotonicStartedMs + sample.monotonicFinishedMs) / 2;
      const uncertainty = Math.max(
        sample.uncertaintyMs,
        (sample.monotonicFinishedMs - sample.monotonicStartedMs) / 2,
      );
      usable.push(
        Object.freeze({
          source: sample.source,
          lowerMs: sample.instantMs + elapsed - uncertainty,
          upperMs: sample.instantMs + elapsed + uncertainty,
        }),
      );
    }
  }
  const boxRange = usable.find((sample) => sample.source === "box");
  const middle = (sample: { lowerMs: number; upperMs: number }) =>
    (sample.lowerMs + sample.upperMs) / 2;
  const others = usable.filter((sample) => sample.source !== "box");
  const decision: HourClockDecision = Object.freeze({
    usable: Object.freeze(usable),
    unavailable: Object.freeze(unavailable),
    secondClock: others.length > 0,
    disagreement:
      boxRange !== undefined &&
      others.some((sample) => Math.abs(middle(sample) - middle(boxRange)) > AGREEMENT_MS),
    releaseBlocked:
      boxRange === undefined ||
      releaseInstantMs === null ||
      !Number.isSafeInteger(releaseInstantMs) ||
      boxRange.lowerMs < releaseInstantMs,
    rangeBlocked:
      boxRange === undefined || boxRange.lowerMs < EPOCH_MS || boxRange.upperMs >= END_MS,
  });
  decisions.add(decision);
  return decision;
}

export function clockRefusal(decision: HourClockDecision): string {
  if (!decisions.has(decision) || decision.releaseBlocked || decision.rangeBlocked)
    return "clock_unconfirmed";
  if (!decision.secondClock) return "second_clock_missing";
  return decision.disagreement ? "clock_disagreement" : "clock_unconfirmed";
}

export function canSelectHour(decision: HourClockDecision): boolean {
  return (
    decisions.has(decision) &&
    !decision.releaseBlocked &&
    !decision.rangeBlocked &&
    decision.secondClock &&
    !decision.disagreement
  );
}
