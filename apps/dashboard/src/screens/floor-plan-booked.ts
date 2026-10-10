import { currentLocale, fill } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^\d{2}:\d{2}$/;

/** Why a save could not delete a table, from `table.booked`'s params; the code's own sentence when
 *  they carry no well-formed date and time. */
export function bookedReason(params: Record<string, unknown>): string {
  const { date, time } = params;
  const parts = typeof date === "string" ? DATE.exec(date) : null;
  if (parts === null || typeof time !== "string" || !TIME.test(time)) {
    return codeMessage("table.booked");
  }
  // Built and read in UTC, so the reader's own time zone cannot move it to another day.
  const day = new Intl.DateTimeFormat(currentLocale(), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))));
  return fill("floor_plan_editor.booked", { date: day, time });
}
