import "@waitron/shared";
import type { BusinessDayClockConflict } from "@waitron/module";

/** Something that still names a menu of a department's list, so the menu cannot leave it. */
export type MenuUse =
  | { kind: "department_all_day" }
  | { kind: "period"; periodId: string }
  | { kind: "zone_all_day"; zoneId: string }
  | { kind: "zone_period"; zoneId: string; periodId: string };

declare module "@waitron/shared" {
  interface ErrorParams {
    "device.not_found": { deviceId: string };
    "device_zones.invalid": {
      field: "profileId" | "snapshot" | "selectedZoneIds" | "startingZoneId";
    };
    "device_zones.changed": Record<string, never>;
    "allergy.invalid": { field: string };
    "allergy.out_of_date": { revision: number };
    "kitchen_note.invalid": { field: "note" | "scope" | "revision" };
    "kitchen_note.too_long": { length: number; limit: number };
    "kitchen_note.out_of_date": { revision: number };
    "hours.clock_change_pending": { effectiveBusinessDay: string };
    "hours.clock_changed": Record<string, never>;
    "venue.business_day_hours_conflict": {
      conflicts: BusinessDayClockConflict[];
      conflictCount: number;
    };
    "department.name_taken": { name: string };
    "department_transfer.settings_invalid": {
      field: "receivingProfileId" | "destinationDepartmentIds";
    };
    "department_transfer.not_allowed": Record<string, never>;
    "department_transfer.desk_unavailable": { departmentId: string };
    "department_transfer.pending": { tabId: string };
    "department_transfer.not_found": { requestId: string };
    "department_transfer.not_pending": { requestId: string };
    "department_transfer.tab_unavailable": { tabId: string };
    "department_transfer.structure_unsupported": { tabId: string };
    "department_transfer.destination_invalid": { field: "zoneId" | "tableId" };
    "department_transfer.reason_required": Record<string, never>;
    "working_order.out_of_date": { workingOrderId: string; revision: number };
    "order.payment_in_flight": { workingOrderId: string };
    "bill.refund_in_progress": { workingOrderId: string };
    "department.not_found": { departmentId: string };
    "department.last_active": { departmentId: string };
    "zone.order_in_progress": { zoneId: string; workingOrderId: string };
    "zone.transfer_pending": { zoneId: string; requestId: string };
    "zone.profile_in_use": { zoneId: string; profileId: string };
    "department.order_in_progress": { departmentId: string; workingOrderId: string };
    "department.transfer_pending": { departmentId: string; requestId: string };
    "department.profile_in_use": { departmentId: string; profileId: string };
    "zone.table_in_use": { zoneId: string; tableId: string; tableName: string };
    /**
     * An import's refusal adds the zone's switched-off department, the routing row it refused, and
     * each name the export holds.
     */
    "service_zone.not_found": {
      zoneId: string;
      zoneName?: string;
      departmentId?: string;
      departmentName?: string;
      row?: "category" | "product" | "no_category" | "all";
      name?: string;
    };
    /** A default names a menu the department's list does not hold. */
    "department_menu.not_found": { departmentId: string; menuId: string };
    /** Removing a menu from a department's list that `uses` still name, every one of them. */
    "department_menu.in_use": { departmentId: string; menuId: string; uses: MenuUse[] };
    "zone_extension.invalid": { field: "until"; reason: "step" | "not_later" | "clock_skips" };
    "zone_extension.not_allowed": { zoneId: string; reason: "not_closing" | "department_closed" };
    "period_extension.invalid": { field: "until"; reason: "step" | "not_later" | "clock_skips" };
    "period_extension.not_allowed": { periodId: string };
    "menu_period.not_found": { periodId: string };
    "menu_period.not_running": { departmentId: string; menuId: string };
    "menu_period.invalid": {
      field:
        "staffMenuIds" | "colour" | "endOffsetMinutes" | "replacementPeriodId" | "floorPlanSetId";
      reason?: "whole_minutes" | "range" | "placement";
      periodId?: string;
      departmentId?: string;
      seasonId?: string;
      weekday?: number;
      date?: string;
      specialDayId?: string;
    };
    /** Another of the department's named periods already has `name`, as trimmed. */
    "menu_period.name_taken": { departmentId: string; name: string };
    /** Another of the department's floor plan sets already has `name`. */
    "floor_plan_set.name_taken": { departmentId: string; name: string };
    /** No floor plan set with this id among the venue's active departments' sets. */
    "floor_plan_set.not_found": { setId: string };
    /** A floor plan set request names something the set cannot take; `field` names it. */
    "floor_plan_set.invalid": { field: string };
    /** A department's default set cannot be deleted; another set is made the default first. */
    "floor_plan_set.is_default": { setId: string };
    "menu_timetable.invalid": {
      field: string;
      periodId?: string;
      date?: string;
      departmentId?: string;
      seasonId?: string;
      weekday?: number;
      specialDayId?: string;
      reason?: "overlap" | "clock_skips" | "empty" | "order" | "step" | "end_offset";
    };
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
    "service_zone.closed": { zoneId: string };
    "service_zone.not_allowed": { zoneId: string };
    "route.subject_not_found": { subject: string; id: string };
    "route.station_inactive": { stationId: string };
    "route.period_invalid": {
      periodId: string;
      reason: "other_department" | "repeated" | "not_offered";
    };
    "station.destination_invalid": {
      stationId: string;
      sendsToStationId: string;
      reason: "self" | "unknown" | "inactive" | "closed";
    };
    "time_zone.unreadable": Record<string, never>;
    "device_profile.access_invalid": {
      field:
        | "profileId"
        | "departmentId"
        | "allowedZoneIds"
        | "startingZoneId"
        | "kitchenScreens"
        | "stationScreenStations"
        | "passScreenStations"
        | "passScreenZones"
        | "passMonitorStations"
        | "passMonitorZones";
      reason:
        | "not_found"
        | "unavailable"
        | "outside_department"
        | "outside_allowed"
        | "empty"
        | "required"
        | "department_required"
        | "shared_display"
        | "not_for_screen";
    };
    /** A device was given a station its profile does not offer. */
    "station.not_allowed": { stationId: string; screen: "station" | "pass" | "pass_monitor" };
    "kitchen_screen.required": Record<string, never>;
    "kitchen_screen.not_allowed": { screen: "station" | "pass" | "pass_monitor" };
    /** null: an order in no zone. */
    "kitchen_screen.zone_not_allowed": { zoneId: string | null };
    /** `screen` names the kind whose list is refused; absent for `field: "screens"`. */
    "kitchen_screen.invalid": {
      field: "screens" | "stationIds" | "zoneIds";
      reason: "empty" | "not_found" | "not_for_screen" | "one_only";
      screen?: "station" | "pass" | "pass_monitor";
    };
    /** The profile has a department but none of its zones can be used now, so it cannot order. */
    "device_profile.no_service_zone": { profileId: string };
    // `route.dish_not_sent` is declared in apps/server's errors.ts, which raises it.
    "order.service_context_missing": { workingOrderId: string };
    "kitchen_notice.not_found": { noticeId: string };
    "kitchen_notice.invalid": {
      field: "direction" | "cancelledExtra" | "reroutedTo" | "fromNumber" | "orderNoteChange";
    };
    /** `field` is the request path of the refused value, such as `days.2.cell.periods.0.opensAt`. */
    "hours.invalid": { field: string };
    "season.not_found": { seasonId: string };
    /** `field` is the request path of the refused value, such as `save.2.startsOn`, or `delete`
     *  (`last`) or `seasons` (`end_offset`). `end_offset`: the change leaves a sending cutoff
     *  running into what follows; a boundary between two seasons names the season and weekday, a
     *  special day its date. */
    "season.invalid": {
      field: string;
      reason?: "taken" | "last" | "end_offset";
      date?: string;
      departmentId?: string;
      periodId?: string;
      seasonId?: string;
      weekday?: number;
      specialDayId?: string;
    };
    "special_day.invalid": {
      field: string;
      date?: string;
      reason?:
        "empty" | "order" | "step" | "overlap" | "clock_skips" | "end_offset" | "outside_hours";
      departmentId?: string;
      zoneId?: string;
      periodId?: string;
    };
    "special_day.not_found": { specialDayId: string };
    /** Another special day already holds `date` (the first day the two would share). */
    "special_day.date_taken": { date: string; name: string; specialDayId: string };
    "zone_closed_time.invalid": {
      field: string;
      reason?: "empty" | "order" | "step" | "overlap" | "outside_hours";
      zoneId?: string;
      weekday?: number;
    };
    "station.always_open": { stationId: string };
    "holiday.invalid": { field: string };
    /** A configuration import's hours or holiday row holds a value a save would refuse; `field` is
     * the table or `<table>.<column>`. */
    "setup.request_invalid": { field: string };
    // `working_order.not_found` and `station.not_found` are declared in @waitron/db's errors.ts.
  }
}
