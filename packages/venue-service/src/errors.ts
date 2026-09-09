import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "department.not_found": { departmentId: string };
    "service_zone.not_found": { zoneId: string };
    "service_zone.menu_not_allowed": { zoneId: string; menuId: string };
    "service_zone.default_missing": Record<string, never>;
    "service_zone.offer_not_allowed": { zoneId: string; menuItemId: string };
    "route.missing": { zoneId: string; productId: string };
    "route.station_inactive": { stationId: string };
    "order.service_context_missing": { workingOrderId: string };
  }
}
