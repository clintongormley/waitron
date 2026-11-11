import type { DeleteDialogCopy } from "@waitron/ui";
import { codeOf } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

const work = (count: number) =>
  format(count === 1 ? "prep.delete_work_one" : "prep.delete_work", { count: String(count) });

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
        station_unsent_lines: [
          "prep.delete_station_unsent_lines",
          "prep.delete_station_unsent_lines_one",
        ],
        station_draft_lines: [
          "prep.delete_station_draft_lines",
          "prep.delete_station_draft_lines_one",
        ],
        station_printers: ["prep.delete_station_printers", "prep.delete_station_printers_one"],
        station_made_here: ["prep.delete_station_made_here", "prep.delete_station_made_here_one"],
        station_routing_cells: [
          "prep.delete_station_routing_cells",
          "prep.delete_station_routing_cells_one",
        ],
        station_routing_periods: [
          "prep.delete_station_routing_periods",
          "prep.delete_station_routing_periods_one",
        ],
        station_device_screens: [
          "prep.delete_station_device_screens",
          "prep.delete_station_device_screens_one",
        ],
        station_profile_screens: [
          "prep.delete_station_profile_screens",
          "prep.delete_station_profile_screens_one",
        ],
        station_daily_states: [
          "prep.delete_station_daily_states",
          "prep.delete_station_daily_states_one",
        ],
        station_daily_destinations: [
          "prep.delete_station_daily_destinations",
          "prep.delete_station_daily_destinations_one",
        ],
      } as const;
      const [many, one] = keys[item.key as keyof typeof keys];
      const single = item.count === 1;
      return format(single ? one : many, {
        count: String(item.count),
        names: item.targets
          .map((target) =>
            target.deleted ? `${target.name} (${t("venue.delete_mark_deleted")})` : target.name,
          )
          .join(", "),
      });
    },
    refusal: (item) =>
      item.code === "station.is_default"
        ? t("prep.delete_default")
        : item.code === "station.screen_in_use"
          ? format(item.targets.length === 1 ? "prep.delete_screens_one" : "prep.delete_screens", {
              names: item.targets
                .map((target) =>
                  target.deleted
                    ? `${target.name} (${t("venue.delete_mark_deleted")})`
                    : target.name,
                )
                .join(", "),
            })
          : work(Number(item.params.count)),
  };
}

export function stationDeleteError(error: unknown): string {
  const code = codeOf(error);
  if (code === "station.is_default") return t("prep.delete_default");
  if (code === "station.screen_in_use")
    return t(
      (error as { params?: { count?: number } }).params?.count === 1
        ? "prep.delete_screen_error_one"
        : "prep.delete_screen_error",
    );
  if (code === "station.work_in_progress")
    return work((error as { params: { count: number } }).params.count);
  return t("prep.save_error");
}
