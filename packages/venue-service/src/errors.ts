import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "department.not_found": { departmentId: string };
    "department.last_active": { departmentId: string };
    "zone.table_in_use": { zoneId: string; tableId: string; tableName: string };
    "service_zone.not_found": { zoneId: string };
    "zone.name_taken": { name: string };
    "service_zone.default_missing": Record<string, never>;
    "service_zone.offer_not_allowed": { zoneId: string; menuItemId: string };
    "service_zone.mode_incompatible": {
      zoneId: string;
      expected: string;
      actual: string;
    };
    "service_zone.join_mismatch": { orderZoneId: string; tableZoneId: string };
    /** The device's active profile may not work in this zone. Names only the zone tried. */
    "service_zone.not_allowed": { zoneId: string };
    "route.not_found": { routeId: string };
    "route.subject_not_found": { subject: string; id: string };
    "route.station_inactive": { stationId: string };
    "station.fallback_loop": { stationId: string; fallbackStationId: string };
    "time_zone.unreadable": Record<string, never>;
    "device_profile.access_invalid": {
      field:
        | "profileId"
        | "departmentId"
        | "allowedZoneIds"
        | "startingZoneId"
        | "stationIds"
        | "watcherIds";
      reason:
        | "not_found"
        | "unavailable"
        | "outside_department"
        | "outside_allowed"
        | "empty"
        | "required"
        | "department_required"
        | "shared_display";
    };
    /** The profile has a department but none of its zones can be used now, so it cannot order. */
    "device_profile.no_service_zone": { profileId: string };
    // `route.dish_not_sent` is declared in apps/server's errors.ts, which raises it.
    "order.service_context_missing": { workingOrderId: string };
    "kitchen_notice.not_found": { noticeId: string };
    "kitchen_notice.invalid": { field: "direction" | "cancelledExtra" | "reroutedTo" };
    /**
     * `field` is the request path of the refused value, such as `days.2.cell.periods.0.opensAt`.
     * A clash with the hours either side also names the other date and the subject.
     */
    "hours.invalid": { field: string; date?: string; subjectId?: string };
    "special_date.not_found": { specialDateId: string };
    "special_date.date_taken": { date: string };
    "station.always_open": { stationId: string };
    "holiday.invalid": { field: string };
    "holiday.not_found": { holidayId: string };
    "holiday_geography.not_found": { geographyId: string };
    "holiday.date_taken": { date: string };
    /** `limit` is the country's allowance of local holidays per address and civil year; `year` is
     * absent only when the refused input carried no real date. */
    "holiday.local_limit": { limit: number; year?: number };
    "holiday.geography_current": { geographyId: string };
    /** A configuration import's hours or holiday row holds a value a save would refuse; `field` is
     * the table or `<table>.<column>`. */
    "setup.request_invalid": { field: string };
    // `working_order.not_found` and `station.not_found` are declared in @waitron/db's errors.ts.
  }
}
