import type { FallbackStep } from "../routing.js";
import type {
  CellAddress,
  ExtraExplanation,
  RouteExplanation,
  RoutingDecision,
} from "../routing-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

/** Display names by id; a category's name is its full path. */
export interface ExplanationNames {
  station(id: string): string;
  product(id: string): string;
  category(id: string): string;
  zone(id: string): string;
}

type Answer = Pick<RouteExplanation, "route" | "decidedBy" | "fallbacks" | "noReplacement">;

const ALL_EVERY_ZONE: CellAddress = { row: { kind: "all" }, zoneId: null };

export function cellPlace(address: CellAddress, names: ExplanationNames): string {
  const { row, zoneId } = address;
  const rowName =
    row.kind === "all"
      ? t("routing.all_categories")
      : row.kind === "category"
        ? names.category(row.categoryId)
        : names.product(row.productId);
  return zoneId === null
    ? format("prep.test_place_every_zone", { row: rowName })
    : format("prep.test_place_zone", { row: rowName, zone: names.zone(zoneId) });
}

function isCell(
  decision: RoutingDecision | null,
): decision is Extract<RoutingDecision, { kind: "cell" }> {
  return decision?.kind === "cell";
}

/** The winning cell with the station it chose, before any fallback moved the work. */
export function decisionSentence(answer: Answer, names: ExplanationNames): string {
  const chosen = answer.fallbacks[0]?.stationId ?? stationOf(answer.route);
  const station = chosen === null ? t("prep.no_preparation") : names.station(chosen);
  if (!isCell(answer.decidedBy))
    return format("prep.test_default_cell", { station, place: cellPlace(ALL_EVERY_ZONE, names) });
  return format("prep.test_cell", { station, place: cellPlace(answer.decidedBy.address, names) });
}

function stationOf(route: RouteExplanation["route"]): string | null {
  return route?.kind === "station" ? route.stationId : null;
}

function fallbackReason(step: FallbackStep, names: ExplanationNames): string {
  return format(step.why === "switched_off" ? "prep.test_disabled" : `prep.test_${step.why}`, {
    station: names.station(step.stationId),
  });
}

function hops(
  steps: readonly FallbackStep[],
  last: string | null,
  names: ExplanationNames,
): string[] {
  return steps.map((step, index) => {
    const reason = fallbackReason(step, names);
    const next = steps[index + 1]?.stationId ?? last;
    return next === null
      ? format("prep.test_no_replacement", { reason })
      : format("prep.test_fallback_step", { reason, destination: names.station(next) });
  });
}

/** Each closed or disabled station on the way, naming the station its work goes to next. */
export function fallbackSentences(answer: Answer, names: ExplanationNames): string[] {
  return hops(answer.fallbacks, answer.noReplacement ? null : stationOf(answer.route), names);
}

export function extraSentence(
  extra: ExtraExplanation,
  dish: Pick<RouteExplanation, "route">,
  names: ExplanationNames,
): string {
  const name = names.product(extra.productId);
  const outcome = extra.outcome;
  if (outcome.kind === "follows_dish") {
    const dishStation = stationOf(dish.route);
    return format(`prep.test_extra_${outcome.why}`, {
      name,
      station: extra.fallbacks[0] ? names.station(extra.fallbacks[0].stationId) : "",
      dishStation: dishStation === null ? "" : names.station(dishStation),
    });
  }
  const made = format("prep.test_extra_made", {
    name,
    station: names.station(outcome.stationId),
    place: cellPlace(isCell(extra.decidedBy) ? extra.decidedBy.address : ALL_EVERY_ZONE, names),
  });
  return [...hops(extra.fallbacks, outcome.stationId, names), made].join(" ");
}
