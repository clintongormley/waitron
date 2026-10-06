import type {
  FallbackStep,
  RouteException,
  RouteTarget,
  RoutingDecision,
  StationStatus,
  StationTransition,
  WeeklyInterval,
} from "./routing.js";
import type { ExtraMakerOutcome } from "@waitron/module";

export interface StationTimes {
  stationId: string;
  status: StationStatus;
  nextTransition: StationTransition | null;
  /** The standard week's opening periods. */
  hours: WeeklyInterval[];
  /** The standard week has hours set; when absent, any `hours` at all mean it has. */
  weekSet?: boolean;
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

export interface ExceptionInput {
  zoneId: string | null;
  categoryId: string | null;
  productId: string | null;
  target: RouteTarget;
}

export type RoutingChange =
  | { kind: "claim"; categoryId: string; target: RouteTarget | null }
  | { kind: "exception"; id: string | null; input: ExceptionInput }
  | { kind: "exception_delete"; id: string }
  | { kind: "exception_order"; ids: string[] }
  | { kind: "assignment"; productId: string; target: RouteTarget };

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
  claims: { categoryId: string; target: RouteTarget; stationOff: boolean }[];
  exceptions: (RouteException & { neverMatches: boolean; stationOff: boolean })[];
  unassigned: { folders: { id: string; name: string }[]; products: { id: string; name: string }[] };
  defaultStationId: string | null;
  /** Includes referenced inactive stations, which the active-station management list omits. */
  stations: { id: string; name: string; active: boolean }[];
}
