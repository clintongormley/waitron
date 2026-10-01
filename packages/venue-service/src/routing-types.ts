import type { RouteException, RouteTarget } from "./routing.js";

export interface ExceptionInput {
  zoneId: string | null;
  categoryId: string | null;
  productId: string | null;
  target: RouteTarget;
}

export interface RoutingModel {
  claims: { categoryId: string; target: RouteTarget; stationOff: boolean }[];
  exceptions: (RouteException & { neverMatches: boolean; stationOff: boolean })[];
  unassigned: { folders: { id: string; name: string }[]; products: { id: string; name: string }[] };
  defaultStationId: string | null;
  /** Includes referenced inactive stations, which the active-station management list omits. */
  stations: { id: string; name: string; active: boolean }[];
}
