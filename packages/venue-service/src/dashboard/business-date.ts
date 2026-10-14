import { businessDayAt } from "@waitron/shared";
import type { OpeningHoursModel } from "../menu-timetable-types.js";

export function businessDateToday(model: OpeningHoursModel): string {
  if (!model.clockReadable) return "";
  try {
    return businessDayAt(model.businessDayClock, new Date());
  } catch {
    return "";
  }
}
