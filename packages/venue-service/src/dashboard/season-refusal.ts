import { isLocalDate } from "../hours-rules.js";
import type { LocalDate } from "../hours-types.js";
import { format, formatDate } from "./hours-view.js";
import type { Refusal } from "./refusal.js";
import { t } from "./strings.js";

export type SeasonRefusedField = "name" | "startsOn" | "colour";

/** The saved entry and field a `season.invalid` refusal names by its path `save.<i>.<field>`. */
export function seasonRefusalField(
  refusal: Refusal,
): { index: number; field: SeasonRefusedField; message: string } | undefined {
  const params = refusal.params ?? {};
  if (refusal.code !== "season.invalid" || params.reason === "end_offset") return undefined;
  const path = typeof params.field === "string" ? params.field : "";
  const match = /^save\.(\d+)\.(name|startsOn|colour)$/.exec(path);
  if (!match) return undefined;
  const field = match[2] as SeasonRefusedField;
  const taken = params.reason === "taken";
  const message =
    field === "colour"
      ? t("hours.colour_required")
      : field === "name"
        ? t(taken ? "season.name_taken" : "prep.name_required")
        : t(taken ? "season.start_taken" : "season.start_required");
  return { index: Number(match[1]), field, message };
}

/** A refusal worded for beside Save; empty for one that names a saved entry's field. */
export function seasonRefusalText(
  refusal: Refusal,
  seasons: readonly { id: string; name: string }[],
  specialDays: readonly { id: string; name: string }[],
): string {
  if (seasonRefusalField(refusal)) return "";
  const params = refusal.params ?? {};
  if (refusal.code === "hours.clock_changed") return t("hours.clock_changed");
  if (refusal.code === "season.not_found") return t("season.not_found");
  if (refusal.code !== "season.invalid") return t("prep.save_error");
  if (params.reason === "last") return t("season.last");
  if (params.reason !== "end_offset") return t("prep.save_error");
  if (isLocalDate(params.date)) {
    const date = formatDate(params.date as LocalDate);
    const day = specialDays.find((entry) => entry.id === params.specialDayId);
    return day
      ? format("season.offset_day", { name: day.name, date })
      : format("season.offset_date", { date });
  }
  const season = seasons.find((entry) => entry.id === params.seasonId);
  const weekday = Number(params.weekday);
  if (season && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
    return format("season.offset_season", {
      season: season.name,
      weekday: t(`hours.day_in_sentence.${weekday}` as Parameters<typeof t>[0]),
    });
  return t("prep.save_error");
}
