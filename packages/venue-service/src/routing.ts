import type { PreparationRoute } from "@waitron/module";
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

export interface StationTiming {
  readonly fallbackId: string | null;
  readonly hours: readonly WeeklyInterval[];
  readonly today: "open" | "closed" | null;
}

export interface RoutingMoment {
  readonly weekday: number;
  readonly timeOfDay: string;
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
  readonly categoryId: string | null; // the EFFECTIVE category (a variant's own, else its parent's)
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
  if (!timing?.hours.length) return { open: true, why: "no_hours" };
  const inside = timing.hours.some(({ weekday, opensAt, closesAt }) => {
    const opening = opensAt.slice(0, 5);
    const closing = closesAt.slice(0, 5);
    const time = moment.timeOfDay;
    if (opening < closing) return weekday === moment.weekday && opening <= time && time < closing;
    return (
      (weekday === moment.weekday && time >= opening) ||
      ((weekday + 1) % 7 === moment.weekday && time < closing)
    );
  });
  return inside ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" };
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
