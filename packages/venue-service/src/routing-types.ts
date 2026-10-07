import type {
  FallbackStep,
  RouteTarget,
  RoutingRules,
  StationStatus,
  StationTransition,
  WeeklyInterval,
} from "./routing.js";
import type { ExtraMakerOutcome } from "@waitron/module";

export type RoutingRow =
  | { kind: "all" }
  | { kind: "category"; categoryId: string }
  | { kind: "product"; productId: string };

/** `zoneId: null` is Every zone. */
export type CellAddress = { row: RoutingRow; zoneId: string | null };

export type RoutingCell = CellAddress & { target: RouteTarget };

export type RoutingDecision = { kind: "cell"; address: CellAddress } | { kind: "default" };

export type SelectedCell = { target: RouteTarget | null; decidedBy: RoutingDecision | null };

export type RoutingSelectionRules = Pick<
  RoutingRules,
  "cells" | "parentOf" | "activeStationIds" | "defaultStationId"
>;

export type GridProduct = { id: string; name: string; categoryId: string | null };

export type GridCategory = { id: string; name: string; parentId: string | null };

export type GridRow = {
  row: RoutingRow;
  name: string;
  path: string[];
  depth: number;
  hiddenProducts: number;
  hiddenCategories: number;
};

export interface StationTimes {
  stationId: string;
  status: StationStatus;
  nextTransition: StationTransition | null;
  /** The standard week's opening periods. */
  hours: WeeklyInterval[];
  /** The standard week has hours set; when absent, any `hours` at all mean it has. */
  weekSet?: boolean;
  /**
   * A special date from today on (on any date while the clock cannot be read) closes this station
   * for some or all of its day: a Closed cell, a cell with periods, or a whole-venue closure. When
   * absent, none does.
   */
  specialDateRestricts?: boolean;
  fallbackStationId: string | null;
  today: "open" | "closed" | null;
  closedSendsTo: string | null;
}

export interface RouteExplanation {
  route: RouteTarget | null;
  decidedBy: RoutingDecision | null;
  fallbacks: FallbackStep[];
  noReplacement: boolean;
  clockReadable: boolean;
  stations: { id: string; name: string; active: boolean }[];
  extras: ExtraExplanation[];
  extrasWaitOnDish: boolean;
}

export interface ExtraExplanation {
  productId: string;
  outcome: ExtraMakerOutcome;
  decidedBy: RoutingDecision | null;
  fallbacks: FallbackStep[];
}

/** @deprecated The old exception writers' input; deleted with them in Task 8a. */
export interface ExceptionInput {
  zoneId: string | null;
  categoryId: string | null;
  productId: string | null;
  target: RouteTarget;
}

/** `target: null` clears the cell; No preparation is an explicit saved value. */
export type RoutingChange = { kind: "cell"; address: CellAddress; target: RouteTarget | null };

export interface RoutingMove {
  productId: string;
  productName: string;
  zoneId: string | null;
  zoneName: string | null;
  from: RouteTarget | null;
  to: RouteTarget | null;
  toNoReplacement: boolean;
}

export interface RoutingModel {
  stationTimes: StationTimes[];
  todayEnds: { timeOfDay: string; tomorrow: boolean } | null;
  clockReadable: boolean;
  /** Active zones in display order: the grid's columns. */
  zones: { id: string; name: string }[];
  categories: GridCategory[];
  /** Active top-level products; a disabled product's stored cells are left out of `cells` too. */
  products: GridProduct[];
  cells: readonly RoutingCell[];
  defaultStationId: string | null;
  /** Includes referenced inactive stations, which the active-station management list omits. */
  stations: { id: string; name: string; active: boolean }[];
}
