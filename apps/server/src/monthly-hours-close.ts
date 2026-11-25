import { readVenueClock, type Transaction } from "@waitron/db";
import { readHolidays, type HolidayRead } from "@waitron/venue-service";
import type { BusinessDayClock } from "@waitron/shared";
import {
  payPeriodCloseBoundary,
  readNextMonthlyPayPeriod,
  readPayPeriodCloseGraceDays,
} from "@waitron/workforce";

export async function monthlyHoursCloseSchedule(
  tx: Transaction,
  clock: BusinessDayClock,
  periodEnd: string,
  graceDays: number,
): Promise<{ scheduledCloseAt: string; holidayCoverageComplete: boolean }> {
  let month: string | undefined;
  let calendar: HolidayRead | undefined;
  let holidayCoverageComplete = true;
  const scheduledCloseAt = await payPeriodCloseBoundary(
    clock,
    periodEnd,
    graceDays,
    async (date) => {
      const needed = date.slice(0, 7);
      if (month !== needed || calendar === undefined) {
        const end = new Date(`${needed}-01T00:00:00Z`);
        end.setUTCMonth(end.getUTCMonth() + 1, 0);
        calendar = await readHolidays(tx, date, end.toISOString().slice(0, 10));
        month = needed;
        holidayCoverageComplete &&= calendar.coverage.every(
          (year) => year.nationalRegional === "complete",
        );
      }
      return calendar.facts.some((holiday) => holiday.date === date);
    },
  );
  return { scheduledCloseAt, holidayCoverageComplete };
}

export async function nextMonthlyHoursClose(tx: Transaction) {
  const period = await readNextMonthlyPayPeriod(tx);
  if (period === null) return null;
  const clock = await readVenueClock(tx);
  const graceDays = await readPayPeriodCloseGraceDays(tx);
  const { scheduledCloseAt } = await monthlyHoursCloseSchedule(tx, clock, period.end, graceDays);
  return { period, clock, scheduledCloseAt };
}
