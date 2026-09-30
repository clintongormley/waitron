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
    /** A paid order's dishes that no station could take were not sent to the kitchen. `dishes` is
     *  their staff names; `orderLabel` is the operator's own text. */
    "route.dish_not_sent": {
      zoneId: string;
      zoneName: string;
      dishes: string;
      workingOrderId: string;
      orderNumber: number;
      orderLabel: string | null;
    };
    "order.service_context_missing": { workingOrderId: string };
    "kitchen_notice.not_found": { noticeId: string };
    "kitchen_notice.invalid": { field: "direction" };
    // `working_order.not_found` and `station.not_found` are declared in @waitron/db's errors.ts.
  }
}
