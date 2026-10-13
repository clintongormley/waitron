import { layerPaint } from "./day-paint.js";

/** One painted block of a business day; `periodId: null` is Closed. */
export type Paint = { periodId: string | null; startsAt: string; endsAt: string };

const STEP_MINUTES = 15;
const DAY_MINUTES = 1440;
// `layerPaint` treats a null period as unpainted, so stored Closed travels through it under an id
// no period can have: period ids are uuids.
const CLOSED = "closed";

function toLayer(range: Paint, keepClosed: boolean) {
  return { ...range, periodId: range.periodId ?? (keepClosed ? CLOSED : null) };
}

function fromLayer(range: { periodId: string; startsAt: string; endsAt: string }): Paint {
  return { ...range, periodId: range.periodId === CLOSED ? null : range.periodId };
}

/** Paint a stretch over a day's ranges, replacing what is under it; joins touching same-period runs.
 *  `closedErases`: in a season week, painting Closed removes ranges. */
export function paintStretch(
  day: readonly Paint[],
  stretch: Paint,
  cutover: string,
  closedErases: boolean,
): Paint[] {
  const season = day
    .map((range) => toLayer(range, true))
    .filter((range): range is Paint & { periodId: string } => range.periodId !== null);
  return layerPaint(season, [toLayer(stretch, !closedErases)], cutover).map(fromLayer);
}

export function deleteBlock(day: readonly Paint[], index: number): Paint[] {
  return day.filter((_, at) => at !== index).map((range) => ({ ...range }));
}

/** Null stores Closed; Delete is what removes a block. */
export function changeBlockPeriod(
  day: readonly Paint[],
  index: number,
  periodId: string | null,
  cutover: string,
): Paint[] {
  const block = day[index];
  if (!block) return day.map((range) => ({ ...range }));
  return paintStretch(day, { ...block, periodId }, cutover, false);
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

/** The time at the row line nearest `offsetPx`, held between the changeover and the next one;
 *  an offset at or past the day's end answers the changeover, which ends a range at the day's end. */
export function stepAt(offsetPx: number, rowPx: number, cutover: string): string {
  const rows = Math.round(offsetPx / rowPx);
  const minutes = Math.min(Math.max(rows, 0) * STEP_MINUTES, DAY_MINUTES);
  const clock =
    (Number(cutover.slice(0, 2)) * 60 + Number(cutover.slice(3, 5)) + minutes) % DAY_MINUTES;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clock / 60))}:${pad(clock % 60)}`;
}
