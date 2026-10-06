import type { ExtraMakerOutcome, PreparationRoute } from "@waitron/module";
import { addDays } from "./hours-rules.js";
export type { ExceptionInput, RoutingModel, RouteExplanation } from "./routing-types.js";

/** What a claim or an exception sends work to. */
export type RouteTarget = PreparationRoute; // { kind: "station"; stationId } | { kind: "no_preparation" }

export interface StationClaim {
  readonly categoryId: string;
  readonly target: RouteTarget;
}

export interface RouteException {
  readonly id: string;
  readonly position: number;
  readonly zoneId: string | null; // null: any service zone
  readonly categoryId: string | null; // a folder, including its subfolders
  readonly productId: string | null; // a top-level product, including its variants
  readonly target: RouteTarget;
}

export interface RoutingRules {
  readonly exceptions: readonly RouteException[]; // any order; sorted by (position, id) inside
  readonly claims: ReadonlyMap<string, RouteTarget>; // categoryId → target
  readonly parentOf: ReadonlyMap<string, string | null>; // categoryId → parent categoryId
  readonly activeStationIds: ReadonlySet<string>;
  readonly defaultStationId: string | null; // the active default, or null
  readonly timing: ReadonlyMap<string, StationTiming>;
}

/** One weekly interval. Only the HH:MM portion of each endpoint counts. */
export interface WeeklyInterval {
  readonly weekday: number;
  readonly opensAt: string;
  readonly closesAt: string;
}

/** One opening on its own date; a close at or before the open ends the next day. */
export interface DayPeriod {
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface StationTiming {
  readonly fallbackId: string | null;
  readonly hours: readonly WeeklyInterval[];
  readonly today: "open" | "closed" | null;
  /** The standard week has hours set; when absent, any `hours` at all mean it has. */
  readonly weekSet?: boolean;
  /** Special-date hours by calendar date, `[]` for Closed; a date not listed uses the week. */
  readonly dates?: ReadonlyMap<string, readonly DayPeriod[]>;
}

export interface RoutingMoment {
  readonly weekday: number;
  readonly timeOfDay: string;
  /** The calendar date that owns `timeOfDay`; without one only the standard week applies. */
  readonly civilDate?: string;
}

export type StationStatus =
  | {
      readonly open: true;
      readonly why: "default" | "opened_by_hand" | "in_hours" | "no_hours" | "time_not_applied";
    }
  | { readonly open: false; readonly why: "switched_off" | "closed_by_hand" | "out_of_hours" };

export interface ProductFacts {
  readonly productId: string;
  readonly routedProductId: string; // the parent's id for a variant, else productId
  readonly categoryId: string | null; // the EFFECTIVE category (a variant's is its parent's)
}

export type RoutingDecision =
  | { readonly kind: "exception"; readonly exceptionId: string }
  | { readonly kind: "claim"; readonly categoryId: string }
  | { readonly kind: "default" };

export interface FallbackStep {
  readonly stationId: string;
  readonly why: "switched_off" | "closed_by_hand" | "out_of_hours";
}

export interface MakerChoice {
  readonly route: RouteTarget | null;
  readonly decidedBy: RoutingDecision | null;
  readonly fallbacks: readonly FallbackStep[];
  readonly noReplacement: boolean;
}

export function folderAncestors(
  parentOf: ReadonlyMap<string, string | null>,
  categoryId: string | null,
): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let current = categoryId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    ancestors.push(current);
    current = parentOf.get(current) ?? null;
  }
  return ancestors;
}

function orderedExceptions(rules: RoutingRules): RouteException[] {
  return [...rules.exceptions].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function stationStatus(
  rules: RoutingRules,
  stationId: string,
  moment: RoutingMoment | null,
): StationStatus {
  if (!rules.activeStationIds.has(stationId)) return { open: false, why: "switched_off" };
  if (stationId === rules.defaultStationId) return { open: true, why: "default" };
  if (moment === null) return { open: true, why: "time_not_applied" };
  const timing = rules.timing.get(stationId);
  if (timing?.today === "closed") return { open: false, why: "closed_by_hand" };
  if (timing?.today === "open") return { open: true, why: "opened_by_hand" };
  if (timing === undefined) return { open: true, why: "no_hours" };
  const time = moment.timeOfDay;
  const previousDate = moment.civilDate === undefined ? undefined : addDays(moment.civilDate, -1);
  const own = stationDayHours(timing, moment.civilDate, moment.weekday);
  const previous = stationDayHours(timing, previousDate, (moment.weekday + 6) % 7);
  const inTail = (previous ?? []).some(
    ({ opensAt, closesAt }) =>
      opensAt.slice(0, 5) >= closesAt.slice(0, 5) && time < closesAt.slice(0, 5),
  );
  if (own === null) return { open: true, why: inTail ? "in_hours" : "no_hours" };
  const inOwn = own.some(({ opensAt, closesAt }) => {
    const opening = opensAt.slice(0, 5);
    const closing = closesAt.slice(0, 5);
    return opening <= time && (opening >= closing || time < closing);
  });
  return inOwn || inTail ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" };
}

/**
 * A station's hours on one date: its special-date hours, else that weekday of a set standard week.
 * `null` makes no claim at all: no hours are set for that date.
 */
export function stationDayHours(
  timing: StationTiming,
  civilDate: string | undefined,
  weekday: number,
): readonly DayPeriod[] | null {
  const special = civilDate === undefined ? undefined : timing.dates?.get(civilDate);
  if (special !== undefined) return special;
  if (!(timing.weekSet ?? timing.hours.length > 0)) return null;
  return timing.hours.filter((interval) => interval.weekday === weekday);
}

/** The next change of a station's scheduled state, on the venue's clock. */
export interface StationTransition {
  readonly weekday: number;
  readonly timeOfDay: string;
  readonly daysAhead: number;
}

function walkFallbacks(
  rules: RoutingRules,
  start: string | null,
  moment: RoutingMoment | null,
  seen: Set<string>,
) {
  const steps: FallbackStep[] = [];
  let current = start;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const status = stationStatus(rules, current, moment);
    if (status.open) return { stationId: current, steps };
    steps.push({ stationId: current, why: status.why });
    current = rules.timing.get(current)?.fallbackId ?? null;
  }
  return { stationId: null, steps };
}

export function followFallbacks(
  rules: RoutingRules,
  stationId: string,
  moment: RoutingMoment | null,
): { readonly stationId: string | null; readonly steps: readonly FallbackStep[] } {
  return walkFallbacks(rules, stationId, moment, new Set());
}

export function closedSendsTo(
  rules: RoutingRules,
  stationId: string,
  moment: RoutingMoment | null,
): string | null {
  if (stationId === rules.defaultStationId) return stationId;
  return walkFallbacks(
    rules,
    rules.timing.get(stationId)?.fallbackId ?? null,
    moment,
    new Set([stationId]),
  ).stationId;
}

export function chooseMaker(
  rules: RoutingRules,
  product: ProductFacts,
  zoneId: string | null,
  moment: RoutingMoment | null,
): MakerChoice {
  const ancestors = folderAncestors(rules.parentOf, product.categoryId);
  const accept = (target: RouteTarget, decision: RoutingDecision): MakerChoice => {
    if (target.kind === "no_preparation")
      return { route: target, decidedBy: decision, fallbacks: [], noReplacement: false };
    const { stationId, steps } = followFallbacks(rules, target.stationId, moment);
    return {
      route: stationId === null ? null : { kind: "station", stationId },
      decidedBy: decision,
      fallbacks: steps,
      noReplacement: stationId === null,
    };
  };

  for (const exception of orderedExceptions(rules)) {
    if (
      (exception.zoneId !== null && exception.zoneId !== zoneId) ||
      (exception.productId !== null && exception.productId !== product.routedProductId) ||
      (exception.categoryId !== null && !ancestors.includes(exception.categoryId))
    ) {
      continue;
    }
    const choice = accept(exception.target, { kind: "exception", exceptionId: exception.id });
    return choice;
  }
  for (const categoryId of ancestors) {
    const target = rules.claims.get(categoryId);
    if (target === undefined) continue;
    const choice = accept(target, { kind: "claim", categoryId });
    return choice;
  }
  if (rules.defaultStationId !== null && rules.activeStationIds.has(rules.defaultStationId)) {
    return {
      route: { kind: "station", stationId: rules.defaultStationId },
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
    };
  }
  return { route: null, decidedBy: null, fallbacks: [], noReplacement: false };
}

export interface ExtraChoice {
  readonly outcome: ExtraMakerOutcome;
  readonly decidedBy: RoutingDecision | null;
  readonly fallbacks: readonly FallbackStep[];
}

export function chooseExtraMaker(
  rules: RoutingRules,
  extra: ProductFacts,
  zoneId: string | null,
  moment: RoutingMoment | null,
  dishStationId: string | null,
): ExtraChoice {
  const choice = chooseMaker(rules, extra, zoneId, moment);
  const outcome: ExtraMakerOutcome =
    choice.decidedBy === null || choice.decidedBy.kind === "default"
      ? { kind: "follows_dish", why: "no_rule" }
      : choice.route === null
        ? { kind: "follows_dish", why: "no_replacement" }
        : choice.route.kind === "no_preparation"
          ? { kind: "follows_dish", why: "no_preparation" }
          : choice.route.stationId === dishStationId
            ? { kind: "follows_dish", why: "same_station" }
            : { kind: "made", stationId: choice.route.stationId };
  return { outcome, decidedBy: choice.decidedBy, fallbacks: choice.fallbacks };
}

export function unreachableExceptions(rules: RoutingRules): Set<string> {
  const exceptions = orderedExceptions(rules);
  const unreachable = new Set<string>();
  for (const [i, candidate] of exceptions.entries()) {
    const covered = exceptions.slice(0, i).some((earlier) => {
      if (earlier.zoneId !== null && earlier.zoneId !== candidate.zoneId) return false;
      if (earlier.categoryId === null && earlier.productId === null) return true;
      if (earlier.productId !== null) return earlier.productId === candidate.productId;
      return (
        candidate.categoryId !== null &&
        folderAncestors(rules.parentOf, candidate.categoryId).includes(earlier.categoryId!)
      );
    });
    if (covered) unreachable.add(candidate.id);
  }
  return unreachable;
}
