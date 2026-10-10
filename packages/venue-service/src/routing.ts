import type { ExtraMakerOutcome, PreparationRoute } from "@waitron/module";
import { addDays } from "./hours-rules.js";
import type {
  CellAddress,
  RoutingCell,
  RoutingDecision,
  RoutingModel,
  RoutingRow,
  RoutingSelectionRules,
  SelectedCell,
} from "./routing-types.js";
export type {
  CellAddress,
  GridCategory,
  GridProduct,
  GridRow,
  RoutingCell,
  RoutingChange,
  RoutingDecision,
  RoutingModel,
  RoutingPeriod,
  RoutingRow,
  RoutingSelectionRules,
  RoutingView,
  SelectedCell,
} from "./routing-types.js";

/** What a routing cell sends work to. */
export type RouteTarget = PreparationRoute; // { kind: "station"; stationId } | { kind: "no_preparation" }

export interface RoutingRules {
  /** At most one cell per coordinate; the list's order decides nothing. */
  readonly cells: readonly RoutingCell[];
  readonly parentOf: ReadonlyMap<string, string | null>; // categoryId → parent categoryId
  readonly activeStationIds: ReadonlySet<string>;
  readonly defaultStationId: string | null; // the active default, or null
  readonly timing: ReadonlyMap<string, StationTiming>;
  /** By cell key, then period id: what the cell sends work to while that period runs. */
  readonly cellPeriods?: ReadonlyMap<string, ReadonlyMap<string, RouteTarget>>;
  readonly zoneDepartment?: ReadonlyMap<string, string>; // zoneId → departmentId
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
  readonly todaySendsTo?: string | null;
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
  /** The running period by department id, null when none runs; absent: Any other time. */
  readonly periods?: ReadonlyMap<string, string | null>;
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

/** The grid's `data-row` and `data-zone` attributes show these keys. */
export function rowKey(row: RoutingRow): string {
  return row.kind === "all"
    ? "all"
    : row.kind === "no_category"
      ? "no_category"
      : row.kind === "category"
        ? `c:${row.categoryId}`
        : `p:${row.productId}`;
}

export const zoneKey = (zoneId: string | null): string => zoneId ?? "every";

export const cellKey = ({ row, zoneId }: CellAddress): string =>
  `${rowKey(row)}|${zoneKey(zoneId)}`;

export function targetKey(target: RouteTarget | null): string {
  if (target === null) return "";
  return target.kind === "no_preparation" ? "no_preparation" : `station:${target.stationId}`;
}

export function parseTargetKey(key: string): RouteTarget | null {
  if (key === "") return null;
  if (key === "no_preparation") return { kind: "no_preparation" };
  if (key.startsWith("station:"))
    return { kind: "station", stationId: key.slice("station:".length) };
  throw new Error(`Not a route target key: ${key}`);
}

const cellIndexes = new WeakMap<readonly RoutingCell[], ReadonlyMap<string, RoutingCell>>();

/** Only a frozen list is cached: a cached index would go stale if the list changed. */
function cellIndex(cells: readonly RoutingCell[]): ReadonlyMap<string, RoutingCell> {
  const cached = cellIndexes.get(cells);
  if (cached !== undefined) return cached;
  const index = new Map(cells.map((cell) => [cellKey(cell), cell]));
  if (Object.isFrozen(cells)) cellIndexes.set(cells, index);
  return index;
}

/**
 * Row order decides before zone: the product, its category, each parent (or No category when the
 * effective category is null), All categories, and within each row its zone cell before Every
 * zone. All categories × Every zone is the implicit default station, never a stored cell. A
 * product row's `categoryId` is its effective category. `skipOwn` ignores the cell at exactly the
 * asked coordinate: what that coordinate shows with no setting of its own. The chosen cell's line
 * for the period running in the zone's department, if it has one, replaces the cell's own target.
 */
export function selectRoutingCell(
  rules: RoutingSelectionRules,
  row: RoutingRow,
  zoneId: string | null,
  categoryId: string | null = null,
  {
    skipOwn = false,
    periods,
  }: { readonly skipOwn?: boolean; readonly periods?: RoutingMoment["periods"] } = {},
): SelectedCell {
  const lineage: RoutingRow[] = row.kind === "product" ? [row] : [];
  if (row.kind === "no_category" || (row.kind === "product" && categoryId === null)) {
    lineage.push({ kind: "no_category" });
  } else if (row.kind !== "all") {
    const leaf = row.kind === "category" ? row.categoryId : categoryId;
    for (const id of folderAncestors(rules.parentOf, leaf)) {
      lineage.push({ kind: "category", categoryId: id });
    }
  }
  lineage.push({ kind: "all" });
  const byCoordinate = cellIndex(rules.cells);
  const own = skipOwn ? cellKey({ row, zoneId }) : null;
  const at = (address: CellAddress) => {
    const key = cellKey(address);
    return key === own ? undefined : byCoordinate.get(key);
  };
  let best: RoutingCell | undefined;
  for (const candidate of lineage) {
    if (zoneId !== null) best = at({ row: candidate, zoneId });
    if (best === undefined && candidate.kind !== "all") best = at({ row: candidate, zoneId: null });
    if (best !== undefined) break;
  }
  if (best !== undefined) {
    const address = { row: best.row, zoneId: best.zoneId };
    const departmentId = zoneId === null ? undefined : rules.zoneDepartment?.get(zoneId);
    const periodId = departmentId === undefined ? null : (periods?.get(departmentId) ?? null);
    const line =
      periodId === null ? undefined : rules.cellPeriods?.get(cellKey(best))?.get(periodId);
    return line === undefined || periodId === null
      ? { target: best.target, decidedBy: { kind: "cell", address } }
      : { target: line, decidedBy: { kind: "cell", address, periodId } };
  }
  if (rules.defaultStationId !== null && rules.activeStationIds.has(rules.defaultStationId)) {
    return {
      target: { kind: "station", stationId: rules.defaultStationId },
      decidedBy: { kind: "default" },
    };
  }
  return { target: null, decidedBy: null };
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
  usedTodayDestination = false,
) {
  const steps: FallbackStep[] = [];
  let current = start;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const status = stationStatus(rules, current, moment);
    if (status.open) return { stationId: current, steps };
    steps.push({ stationId: current, why: status.why });
    const timing = rules.timing.get(current);
    const todayDestination = status.why === "closed_by_hand" ? timing?.todaySendsTo : null;
    if (todayDestination != null) usedTodayDestination = true;
    current = todayDestination ?? timing?.fallbackId ?? null;
  }
  const defaultId = rules.defaultStationId;
  const stationId =
    usedTodayDestination && defaultId !== null && rules.activeStationIds.has(defaultId)
      ? defaultId
      : null;
  return { stationId, steps };
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
  const timing = rules.timing.get(stationId);
  const todayDestination =
    stationStatus(rules, stationId, moment).why === "closed_by_hand" ? timing?.todaySendsTo : null;
  return walkFallbacks(
    rules,
    todayDestination ?? timing?.fallbackId ?? null,
    moment,
    new Set([stationId]),
    todayDestination != null,
  ).stationId;
}

export function chooseMaker(
  rules: RoutingRules,
  product: ProductFacts,
  zoneId: string | null,
  moment: RoutingMoment | null,
): MakerChoice {
  const { target, decidedBy } = selectRoutingCell(
    rules,
    { kind: "product", productId: product.routedProductId },
    zoneId,
    product.categoryId,
    { periods: moment?.periods },
  );
  if (target === null || decidedBy === null || decidedBy.kind === "default") {
    return { route: target, decidedBy, fallbacks: [], noReplacement: false };
  }
  if (target.kind === "no_preparation") {
    return { route: target, decidedBy, fallbacks: [], noReplacement: false };
  }
  const { stationId, steps } = followFallbacks(rules, target.stationId, moment);
  return {
    route: stationId === null ? null : { kind: "station", stationId },
    decidedBy,
    fallbacks: steps,
    noReplacement: stationId === null,
  };
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

/** Where an extra goes beside a dish routed as `dish`, or null while the dish has no route: its
 * extras then wait on it. */
export function chooseExtraMakerBeside(
  rules: RoutingRules,
  dish: MakerChoice,
  extra: ProductFacts,
  zoneId: string | null,
  moment: RoutingMoment | null,
): ExtraChoice | null {
  if (dish.route === null) return null;
  const dishStationId = dish.route.kind === "station" ? dish.route.stationId : null;
  return chooseExtraMaker(rules, extra, zoneId, moment, dishStationId);
}

export interface ChangeReach {
  readonly reachesZone: (zoneId: string | null) => boolean;
  readonly covers: (product: ProductFacts) => boolean;
}

/**
 * The zones and products whose `chooseMaker` can read the cell at `address`. `covers` compares
 * ids as given, as `selectRoutingCell` does.
 */
export function changeReach(
  parentOf: ReadonlyMap<string, string | null>,
  { row, zoneId }: CellAddress,
): ChangeReach {
  const reachesZone = (zone: string | null) => zoneId === null || zone === zoneId;
  if (row.kind === "all") return { reachesZone, covers: () => true };
  if (row.kind === "no_category")
    return { reachesZone, covers: (product) => product.categoryId === null };
  if (row.kind === "product")
    return { reachesZone, covers: (product) => product.routedProductId === row.productId };
  const under = new Map<string, boolean>();
  return {
    reachesZone,
    covers: ({ categoryId }) => {
      if (categoryId === null) return false;
      let found = under.get(categoryId);
      if (found === undefined)
        under.set(
          categoryId,
          (found = folderAncestors(parentOf, categoryId).includes(row.categoryId)),
        );
      return found;
    },
  };
}

/** The cells are copied and frozen so `selectRoutingCell` can cache its index for them. */
export function selectionRulesFromModel(model: RoutingModel): RoutingSelectionRules {
  return {
    cells: Object.freeze([...model.cells]),
    parentOf: new Map(model.categories.map((category) => [category.id, category.parentId])),
    activeStationIds: new Set(
      model.stations.filter((station) => station.active).map((station) => station.id),
    ),
    defaultStationId: model.defaultStationId,
  };
}
