import { rangeSpanInDay, type ServiceRange } from "./service-day.js";
import type { ServiceDayContext } from "./service-day-context.js";

export interface RecordedRun {
  periodId: string;
  startsAt: string;
}

/** `runs` is `serviceRuns(withExtension(painted, extension, cutover))`: a keep open joins the
 *  range it extends into one run. */
export interface DueDay {
  painted: readonly ServiceRange[];
  extension: ServiceRange | null;
  runs: readonly ServiceRange[];
}

export function occurrenceKey(
  departmentId: string,
  businessDay: string,
  run: ServiceRange,
): string {
  return JSON.stringify([departmentId, businessDay, run.periodId, run.startsAt]);
}

export function recordedRun(
  key: string | null,
  departmentId: string,
  businessDay: string,
): RecordedRun | null {
  if (key === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    !parsed.every((part) => typeof part === "string")
  )
    return null;
  const [department, day, periodId, startsAt] = parsed as string[];
  return department === departmentId && day === businessDay
    ? { periodId: periodId!, startsAt: startsAt! }
    : null;
}

/** A missing start still matches only the run `withExtension` made by cutting the recorded
 *  painted range at today's keep open's end (plan decision 22); anything else is gone. */
export function matchRecorded(
  day: DueDay,
  recorded: RecordedRun,
  context: ServiceDayContext,
): ServiceRange | null {
  const same = day.runs.find(
    (run) => run.periodId === recorded.periodId && run.startsAt === recorded.startsAt,
  );
  if (same !== undefined) return same;
  const { extension } = day;
  if (extension === null) return null;
  const kept = rangeSpanInDay(extension, context);
  const cut = day.painted.find(
    (range) => range.periodId === recorded.periodId && range.startsAt === recorded.startsAt,
  );
  if (cut === undefined) return null;
  const span = rangeSpanInDay(cut, context);
  if (span.start < kept.start || span.start >= kept.end || span.end <= kept.end) return null;
  return (
    day.runs.find(
      (run) => run.periodId === recorded.periodId && run.startsAt === extension.endsAt,
    ) ?? null
  );
}

/** Running → next later today → last that ran today; never a run starting earlier than the
 *  recorded one (spec decision 4), which applies only while the record still matches a run. */
export function dueRun(input: {
  day: DueDay;
  minute: number;
  context: ServiceDayContext;
  recorded: RecordedRun | null;
}): ServiceRange | null {
  const { day, minute, context, recorded } = input;
  const matched = recorded === null ? null : matchRecorded(day, recorded, context);
  const floor = matched === null ? -Infinity : rangeSpanInDay(matched, context).start;
  const runs = day.runs
    .map((run) => ({ run, span: rangeSpanInDay(run, context) }))
    .filter(({ span }) => span.start >= floor);
  const running = runs.find(({ span }) => span.start <= minute && minute < span.end);
  const next = runs.find(({ span }) => span.start > minute);
  const last = runs.filter(({ span }) => span.end <= minute).at(-1);
  return (running ?? next ?? last)?.run ?? null;
}
