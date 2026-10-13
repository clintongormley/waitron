import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { seasonOn } from "../season-rules.js";
import { t } from "./strings.js";
export const seasonIdOn = (seasons: OpeningHoursModel["seasons"], date: string) =>
  seasonOn(seasons, date)?.id ?? "";
export const weekdayLabel = (weekday: number) =>
  t(`hours.day.${weekday}` as Parameters<typeof t>[0]);
