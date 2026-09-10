import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "department.not_found": { departmentId: string };
    "department.has_active_zones": { departmentId: string; zoneId: string };
    "service_zone.not_found": { zoneId: string };
    "service_zone.default_missing": Record<string, never>;
    "service_zone.offer_not_allowed": { zoneId: string; menuItemId: string };
    "service_zone.mode_incompatible": {
      zoneId: string;
      expected: string;
      actual: string;
    };
    "service_zone.join_mismatch": { orderZoneId: string; tableZoneId: string };
    "route.missing": { zoneId: string; productId: string };
    "route.not_found": { routeId: string };
    "route.subject_not_found": { subject: string; id: string };
    "route.duplicate": Record<string, never>;
    "route.station_inactive": { stationId: string };
    "order.service_context_missing": { workingOrderId: string };
  }
}
