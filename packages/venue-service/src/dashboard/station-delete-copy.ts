import type { DeleteDialogCopy } from "@waitron/ui";
import { codeOf } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export function stationDeleteCopy(): DeleteDialogCopy {
  return {
    heading: t("prep.delete_heading"),
    refusals: t("prep.delete_refusals"),
    ends: t("prep.delete_ends"),
    removes: t("prep.delete_removes"),
    irreversible: t("prep.delete_irreversible"),
    cancel: t("prep.cancel"),
    confirm: t("prep.delete"),
    retry: t("prep.delete_retry"),
    loading: t("prep.delete_loading"),
    item: (item) => {
      const keys = {
        station_unsent_lines: "prep.delete_station_unsent_lines",
        station_draft_lines: "prep.delete_station_draft_lines",
        station_printers: "prep.delete_station_printers",
        station_made_here: "prep.delete_station_made_here",
        station_timing: "prep.delete_station_timing",
        station_routing_cells: "prep.delete_station_routing_cells",
        station_routing_periods: "prep.delete_station_routing_periods",
        station_device_screens: "prep.delete_station_device_screens",
        station_profile_screens: "prep.delete_station_profile_screens",
        station_daily_states: "prep.delete_station_daily_states",
        station_daily_destinations: "prep.delete_station_daily_destinations",
      } as const;
      return format(keys[item.key as keyof typeof keys], {
        count: String(item.count),
        names: item.targets.map((target) => target.name).join(", "),
      });
    },
    refusal: (item) =>
      item.code === "station.is_default"
        ? t("prep.delete_default")
        : item.code === "station.screen_in_use"
          ? format("prep.delete_screens", {
              names: item.targets.map((target) => target.name).join(", "),
            })
          : format("prep.delete_work", { count: String(item.params.count) }),
  };
}

export function stationDeleteError(error: unknown): string {
  const code = codeOf(error);
  if (code === "station.is_default") return t("prep.delete_default");
  if (code === "station.screen_in_use") return t("prep.delete_screen_error");
  if (code === "station.work_in_progress")
    return format("prep.delete_work", {
      count: String((error as { params: { count: number } }).params.count),
    });
  return t("prep.save_error");
}
