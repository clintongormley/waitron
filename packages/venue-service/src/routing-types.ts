import type {
  RouteTarget,
  RoutingRules,
  StationStatus,
  StationTransition,
  WeeklyInterval,
} from "./routing.js";
import type { CalendarColour } from "./hours-types.js";

export type RoutingRow =
  | { kind: "all" }
  | { kind: "no_category" }
  | { kind: "category"; categoryId: string }
  | { kind: "product"; productId: string };

/** `zoneId: null` is Every zone. */
export type CellAddress = { row: RoutingRow; zoneId: string | null };

export type RoutingCell = CellAddress & { target: RouteTarget };

/** `periodId`: the running period's line on that cell chose the target. */
export type RoutingDecision =
  { kind: "cell"; address: CellAddress; periodId?: string } | { kind: "default" };

export type SelectedCell = { target: RouteTarget | null; decidedBy: RoutingDecision | null };

export type RoutingSelectionRules = Pick<
  RoutingRules,
  "cells" | "parentOf" | "activeStationIds" | "defaultStationId" | "cellPeriods" | "zoneDepartment"
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

/** What a cell sends work to while one period runs. */
export type PeriodLine = { periodId: string; target: RouteTarget };

/**
 * `target: null` clears the cell; No preparation is an explicit saved value. `periods` replaces
 * the cell's period lines; omitted, the stored lines stay.
 */
export type RoutingChange = {
  kind: "cell";
  address: CellAddress;
  target: RouteTarget | null;
  periods?: readonly PeriodLine[];
};

export interface RoutingMove {
  productId: string;
  productName: string;
  zoneId: string | null;
  zoneName: string | null;
  from: RouteTarget | null;
  to: RouteTarget | null;
  toNoReplacement: boolean;
  /** Present only on an extra's move: the dish that offers it. */
  dish?: { productId: string; productName: string };
  /** The periods during which the move happens; null: at any other time. */
  periodIds: string[] | null;
}

/** A period a routing line can name, with the products its menus reach, variants by parent. */
export interface RoutingPeriod {
  id: string;
  departmentId: string;
  departmentName: string;
  name: string;
  colour: CalendarColour;
  productIds: string[];
}

/** `periods` is present only on a cell with period lines. */
export type RoutingModelCell = RoutingCell & { periods?: PeriodLine[] };

export interface RoutingModel {
  stationTimes: StationTimes[];
  todayEnds: { timeOfDay: string; tomorrow: boolean } | null;
  clockReadable: boolean;
  /** Active zones in display order: the grid's columns. */
  zones: { id: string; name: string }[];
  categories: GridCategory[];
  /** Active top-level products; a disabled product's stored cells are left out of `cells` too. */
  products: GridProduct[];
  cells: readonly RoutingModelCell[];
  /** Each department's periods in the order its week first runs them; one never placed last. */
  periods: RoutingPeriod[];
  defaultStationId: string | null;
  /** Includes referenced inactive stations, which the active-station management list omits. */
  stations: { id: string; name: string; active: boolean }[];
}

/** `canMakeDefault`: the session may use Make default (`venue.configure`). */
export type RoutingView = RoutingModel & { canMakeDefault: boolean };
