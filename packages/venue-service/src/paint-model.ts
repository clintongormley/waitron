import { clockAt, layerPaint, stepSpan } from "./day-paint.js";

/** One painted block of a business day; `periodId: null` is Closed. */
export type Paint = { periodId: string | null; startsAt: string; endsAt: string };

const STEP_MINUTES = 15;
const DAY_MINUTES = 1440;
// `layerPaint` treats a null period as unpainted, so stored Closed travels through it under an id
// no period can have: period ids come from `newId` (packages/db/src/schema/columns.ts), a random UUID.
const CLOSED = "closed";

function toLayer(range: Paint, keepClosed: boolean) {
  return { ...range, periodId: range.periodId ?? (keepClosed ? CLOSED : null) };
}

function fromLayer(range: { periodId: string; startsAt: string; endsAt: string }): Paint {
  return { ...range, periodId: range.periodId === CLOSED ? null : range.periodId };
}

/** Paint a stretch over a day's ranges, replacing what is under it; joins touching same-period runs.
 *  Its two ends may come in either order, as an upward drag gives them.
 *  `closedErases`: in a season week, painting Closed removes ranges. */
export function paintStretch(
  day: readonly Paint[],
  stretch: Paint,
  cutover: string,
  closedErases: boolean,
): Paint[] {
  const [start, end] = stepSpan(stretch, cutover);
  const ordered =
    start > end ? { ...stretch, startsAt: stretch.endsAt, endsAt: stretch.startsAt } : stretch;
  const season = day
    .map((range) => toLayer(range, true))
    .filter((range): range is Paint & { periodId: string } => range.periodId !== null);
  return layerPaint(season, [toLayer(ordered, !closedErases)], cutover).map(fromLayer);
}

export function deleteBlock(day: readonly Paint[], index: number): Paint[] {
  return day.filter((_, at) => at !== index).map((range) => ({ ...range }));
}

/** `closedErases` as for `paintStretch`: changing a block to Closed removes it or stores Closed. */
export function changeBlockPeriod(
  day: readonly Paint[],
  index: number,
  periodId: string | null,
  cutover: string,
  closedErases: boolean,
): Paint[] {
  const block = day[index];
  if (!block) return day.map((range) => ({ ...range }));
  return paintStretch(day, { ...block, periodId }, cutover, closedErases);
}

export function copyDay(
  days: ReadonlyMap<string, readonly Paint[]>,
  from: string,
  to: readonly string[],
): Map<string, Paint[]> {
  const copy = (day: readonly Paint[]) => day.map((range) => ({ ...range }));
  const copied = new Map([...days].map(([key, day]) => [key, copy(day)]));
  const source = days.get(from) ?? [];
  for (const key of to) copied.set(key, copy(source));
  return copied;
}

/** The clock quarter hour nearest `offsetPx` (row 0 is the changeover, a row is 15 minutes), held
 *  inside the business day, as the server's step rule (`parseRanges`, service-day.ts) requires of
 *  both ends of a range. On a quarter-hour changeover the day's end answers the changeover. A row
 *  with no height answers the first quarter hour. */
export function stepAt(offsetPx: number, rowPx: number, cutover: string): string {
  return clockAt(stepMinuteAt(offsetPx, rowPx, cutover), cutover);
}

/** `stepAt` as minutes from the changeover; on a quarter-hour changeover the day's end answers 1440. */
export function stepMinuteAt(offsetPx: number, rowPx: number, cutover: string): number {
  const minutes = rowPx > 0 ? (offsetPx / rowPx) * STEP_MINUTES : 0;
  const first = (STEP_MINUTES - (Number(cutover.slice(3, 5)) % STEP_MINUTES)) % STEP_MINUTES;
  const last = Math.floor((DAY_MINUTES - first) / STEP_MINUTES);
  const row = Math.min(Math.max(Math.round((minutes - first) / STEP_MINUTES), 0), last);
  return first + row * STEP_MINUTES;
}

export function samePaint(a: readonly Paint[], b: readonly Paint[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (paint, i) =>
        paint.periodId === b[i]!.periodId &&
        paint.startsAt === b[i]!.startsAt &&
        paint.endsAt === b[i]!.endsAt,
    )
  );
}

/** `stored`'s days, except each day `current` paints differently from `sent` (a missing day
 *  paints nothing), which takes `current`'s, or is left out when `current` has no such day. */
export function rebaseDays<K>(
  stored: ReadonlyMap<K, readonly Paint[]>,
  sent: ReadonlyMap<K, readonly Paint[]>,
  current: ReadonlyMap<K, readonly Paint[]>,
): Map<K, Paint[]> {
  const copy = (day: readonly Paint[]) => day.map((range) => ({ ...range }));
  const rebased = new Map([...stored].map(([key, day]) => [key, copy(day)]));
  for (const key of new Set([...sent.keys(), ...current.keys()])) {
    const day = current.get(key);
    if (samePaint(day ?? [], sent.get(key) ?? [])) continue;
    if (day) rebased.set(key, copy(day));
    else rebased.delete(key);
  }
  return rebased;
}

/** `days` with every block of a period in `removed` taken out. */
export function withoutPeriods<K>(
  days: ReadonlyMap<K, readonly Paint[]>,
  removed: ReadonlySet<string>,
): Map<K, Paint[]> {
  return new Map(
    [...days].map(([key, day]) => [
      key,
      day
        .filter(({ periodId }) => periodId === null || !removed.has(periodId))
        .map((range) => ({ ...range })),
    ]),
  );
}
