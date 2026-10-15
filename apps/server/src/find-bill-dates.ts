import { AppError, businessDayAt, businessDayBounds, type BusinessDayClock } from "@waitron/shared";
import { civilDateOf, validateBusinessDay } from "@waitron/reporting";
import type { DateWindow, FindBillDates } from "./find-bill-types.js";
import "./errors.js";

export function validateFindBillRange(from: string, to: string): void {
  for (const [field, day] of [
    ["from", from],
    ["to", to],
  ] as const) {
    try {
      validateBusinessDay(day);
    } catch {
      throw new AppError("management.request_invalid", { field });
    }
  }
  if (from > to) throw new AppError("management.request_invalid", { field: "to" });
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function resolveFindBillDates(
  clock: BusinessDayClock,
  dates: FindBillDates,
  now: Date,
): DateWindow {
  if (dates.preset === "any") return null;
  if (dates.preset === "business-day") {
    const day = businessDayAt(clock, now);
    return { ...businessDayBounds(clock, day), from: day, to: day };
  }
  const today = civilDateOf(now, clock.timeZone);
  let from: string;
  let to: string;
  switch (dates.preset) {
    case "today":
      from = to = today;
      break;
    case "yesterday":
      from = to = addDays(today, -1);
      break;
    case "last-7-days":
      from = addDays(today, -6);
      to = today;
      break;
    case "this-month": {
      from = today.slice(0, 7) + "-01";
      const next = new Date(`${from}T00:00:00.000Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      to = addDays(next.toISOString().slice(0, 10), -1);
      break;
    }
    case "custom":
      from = dates.from;
      to = dates.to;
      break;
  }
  validateFindBillRange(from, to);
  const midnight = { timeZone: clock.timeZone, dayCutover: "00:00", cutoverChanges: [] };
  return {
    from,
    to,
    startAt: businessDayBounds(midnight, from).startAt,
    endAt: businessDayBounds(midnight, to).endAt,
  };
}
