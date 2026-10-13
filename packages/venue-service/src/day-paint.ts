import type { ClosedRange, ServiceRange } from "./service-day.js";

/** A painted stretch of a special date; `periodId: null` is Closed. */
export interface PaintRange {
  periodId: string | null;
  startsAt: string;
  endsAt: string;
}

export interface ZonePaint {
  kind: "closed" | "open";
  startsAt: string;
  endsAt: string;
}

// Kept free of runtime imports so the dashboard can load it: the arithmetic mirrors
// `rangeSpan` (service-day.ts) and the join mirrors `joinTouching` (season-weeks.ts).
// Minute by minute: a changeover or a range time may fall on any minute.
const STEPS = 1440;

function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function stepSpan(range: ClosedRange, cutover: string): [number, number] {
  const from = clockMinutes(cutover);
  const start = (clockMinutes(range.startsAt) - from + 1440) % 1440;
  // The changeover is the exclusive end, allowing one range to fill the whole day.
  const end = (clockMinutes(range.endsAt) - from + 1440) % 1440 || 1440;
  return [start, end];
}

export function clockAt(step: number, cutover: string): string {
  const minute = (clockMinutes(cutover) + step) % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

function paintSteps<T, R extends ClosedRange>(
  steps: T[],
  ranges: readonly R[],
  value: (range: R) => T,
  cutover: string,
): T[] {
  for (const range of ranges) {
    const [start, end] = stepSpan(range, cutover);
    for (let step = start; step < end; step++) steps[step] = value(range);
  }
  return steps;
}

/** Each run of equal values that `keep` accepts, as a range; so touching equal runs are one. */
function runs<T>(
  steps: readonly T[],
  keep: (value: T) => boolean,
  cutover: string,
): { value: T; startsAt: string; endsAt: string }[] {
  const found: { value: T; startsAt: string; endsAt: string }[] = [];
  let start = 0;
  for (let step = 1; step <= STEPS; step++) {
    if (step < STEPS && steps[step] === steps[start]) continue;
    const value = steps[start] as T;
    if (keep(value))
      found.push({ value, startsAt: clockAt(start, cutover), endsAt: clockAt(step, cutover) });
    start = step;
  }
  return found;
}

function serviceSteps(season: readonly ServiceRange[], cutover: string): (string | null)[] {
  return paintSteps<string | null, ServiceRange>(
    Array<string | null>(STEPS).fill(null),
    season,
    (range) => range.periodId,
    cutover,
  );
}

function closedSteps(season: readonly ClosedRange[], cutover: string): boolean[] {
  return paintSteps(Array<boolean>(STEPS).fill(false), season, () => true, cutover);
}

function toServiceRanges(steps: readonly (string | null)[], cutover: string): ServiceRange[] {
  return runs(steps, (value) => value !== null, cutover).map(({ value, startsAt, endsAt }) => ({
    periodId: value as string,
    startsAt,
    endsAt,
  }));
}

function toClosedRanges(steps: readonly boolean[], cutover: string): ClosedRange[] {
  return runs(steps, (value) => value, cutover).map(({ startsAt, endsAt }) => ({
    startsAt,
    endsAt,
  }));
}

/** The season's day with each painted stretch replacing what was there; touching same-period runs joined. */
export function layerPaint(
  season: readonly ServiceRange[],
  paint: readonly PaintRange[],
  cutover: string,
): ServiceRange[] {
  const steps = paintSteps(
    serviceSteps(season, cutover),
    paint,
    (range) => range.periodId,
    cutover,
  );
  return toServiceRanges(steps, cutover);
}

/** The zone's season closures with "closed" paint added and "open" paint cut out. */
export function layerZonePaint(
  season: readonly ClosedRange[],
  paint: readonly ZonePaint[],
  cutover: string,
): ClosedRange[] {
  const steps = paintSteps(
    closedSteps(season, cutover),
    paint,
    (range) => range.kind === "closed",
    cutover,
  );
  return toClosedRanges(steps, cutover);
}

/** The smallest paint that turns `season` into `edited`. */
export function paintFromEdit(
  season: readonly ServiceRange[],
  edited: readonly ServiceRange[],
  cutover: string,
): PaintRange[] {
  const before = serviceSteps(season, cutover);
  const after = serviceSteps(edited, cutover);
  const changed = after.map((value, step) => (value === before[step] ? undefined : value));
  return runs(changed, (value) => value !== undefined, cutover).map(
    ({ value, startsAt, endsAt }) => ({ periodId: value ?? null, startsAt, endsAt }),
  );
}

/** The same for a zone: "closed" where the edit closes time the season left open, "open" where it
 *  opens time the season closed. */
export function zonePaintFromEdit(
  season: readonly ClosedRange[],
  edited: readonly ClosedRange[],
  cutover: string,
): ZonePaint[] {
  const before = closedSteps(season, cutover);
  const after = closedSteps(edited, cutover);
  const changed = after.map((closed, step) => (closed === before[step] ? undefined : closed));
  return runs(changed, (value) => value !== undefined, cutover).map(
    ({ value, startsAt, endsAt }) => ({ kind: value ? "closed" : "open", startsAt, endsAt }),
  );
}
