import type {
  RouteTarget,
  RoutingRules,
  StationStatus,
  StationTransition,
  WeeklyInterval,
} from "./routing.js";

export type RoutingRow =
  | { kind: "all" }
  | { kind: "no_category" }
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
  /** Present only on an extra's move: the dish that offers it. */
  dish?: { productId: string; productName: string };
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

/** `canMakeDefault`: the session may use Make default (`venue.configure`). */
export type RoutingView = RoutingModel & { canMakeDefault: boolean };
