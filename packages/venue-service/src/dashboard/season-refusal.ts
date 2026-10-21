import type { Refusal } from "./refusal.js";
import { t } from "./strings.js";

export type SeasonRefusedField = "name" | "startsOn" | "colour";

/** The saved entry and field a `season.invalid` refusal names by its path `save.<i>.<field>`. */
export function seasonRefusalField(
  refusal: Refusal,
): { index: number; field: SeasonRefusedField; message: string } | undefined {
  const params = refusal.params ?? {};
  if (refusal.code !== "season.invalid") return undefined;
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
export function seasonRefusalText(refusal: Refusal): string {
  if (seasonRefusalField(refusal)) return "";
  const params = refusal.params ?? {};
  if (refusal.code === "hours.clock_changed") return t("hours.clock_changed");
  if (refusal.code === "season.not_found") return t("season.not_found");
  if (refusal.code !== "season.invalid") return t("prep.save_error");
  if (params.reason === "last") return t("season.last");
  return t("prep.save_error");
}
