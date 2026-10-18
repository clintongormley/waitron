import type { DeleteDialogCopy } from "@waitron/ui";
import { codeOf } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";
import { t } from "./strings.js";
const itemKeys = {
  tables: "venue.delete_item_tables",
  saved_tables: "venue.delete_item_saved_tables",
  zones: "venue.delete_item_zones",
  today_joins: "venue.delete_item_today_joins",
  reset_targets: "venue.delete_item_reset_targets",
  routing_rules: "venue.delete_item_routing_rules",
  routing_periods: "venue.delete_item_routing_periods",
  profile_zones: "venue.delete_item_profile_zones",
  profile_starting_zones: "venue.delete_item_profile_starting_zones",
  screen_zones: "venue.delete_item_screen_zones",
  screen_notices: "venue.delete_item_screen_notices",
  zone_policies: "venue.delete_item_zone_policies",
  zone_extensions: "venue.delete_item_zone_extensions",
  department_periods: "venue.delete_item_department_periods",
  floor_plan_sets: "venue.delete_item_floor_plan_sets",
  staff_menus: "venue.delete_item_staff_menus",
  seasons: "venue.delete_item_seasons",
  period_extensions: "venue.delete_item_period_extensions",
  department_policy: "venue.delete_item_department_policy",
  transfer_desks: "venue.delete_item_transfer_desks",
  transfer_routes: "venue.delete_item_transfer_routes",
  default_department: "venue.delete_item_default_department",
  counter_default: "venue.delete_item_counter_default",
} as const;
const refusalKeys = {
  "department.last_active": "venue.delete_refusal_department_last_active",
  "zone.table_in_use": "venue.delete_refusal_zone_table_in_use",
  "table.delivery_in_progress": "venue.delete_refusal_table_delivery_in_progress",
  "table.booked": "venue.delete_refusal_table_booked",
  "zone.order_in_progress": "venue.delete_refusal_zone_order_in_progress",
  "department.order_in_progress": "venue.delete_refusal_department_order_in_progress",
  "zone.transfer_pending": "venue.delete_refusal_zone_transfer_pending",
  "department.transfer_pending": "venue.delete_refusal_department_transfer_pending",
  "zone.profile_in_use": "venue.delete_refusal_zone_profile_in_use",
  "department.profile_in_use": "venue.delete_refusal_department_profile_in_use",
} as const;
export function serviceDeleteCopy(kind: "zone" | "department"): DeleteDialogCopy {
  return {
    heading: t(kind === "zone" ? "venue.delete_zone_heading" : "venue.delete_department_heading"),
    refusals: t("venue.delete_refusals"),
    ends: t("venue.delete_ends"),
    removes: t("venue.delete_removes"),
    irreversible: t("venue.delete_irreversible"),
    cancel: t("venue.cancel"),
    confirm: t("venue.delete"),
    retry: t("venue.delete_retry"),
    loading: t("venue.delete_loading"),
    item(item) {
      const names = item.targets.map((target) => target.name).join(", ");
      if (item.key === "counter_default" && !names) return t("venue.delete_counter_empty");
      if (item.key === "default_department" && !names) return t("venue.delete_default_empty");
      const key = itemKeys[item.key as keyof typeof itemKeys];
      if (!key) return t("venue.delete_action_error");
      const line = format(key, { count: String(item.count), names });
      return ["tables", "saved_tables", "zones", "today_joins", "reset_targets"].includes(
        item.key,
      ) && names
        ? `${line} ${names}`
        : line;
    },
    refusal(item) {
      const key = refusalKeys[item.code as keyof typeof refusalKeys];
      return key
        ? format(key, {
            tableName: String(item.params.tableName ?? ""),
            names: item.targets.map((target) => target.name).join(", "),
          })
        : t("venue.delete_action_error");
    },
  };
}
export function serviceDeleteError(kind: "zone" | "department", error: unknown): string {
  const code = codeOf(error);
  if (!(code in refusalKeys)) return t("venue.delete_action_error");
  return serviceDeleteCopy(kind).refusal({
    code,
    params: (error as { params?: Record<string, string | number> }).params ?? {},
    targets: [],
  });
}
