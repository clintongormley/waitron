import { desc, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { AppError, businessDayBoundaryAt, type BusinessDayClock } from "@waitron/shared";
import {
  DEFAULT_CLOSE_GRACE_DAYS,
  MAX_CLOSE_GRACE_DAYS,
  payPeriodSettings,
} from "./schema/pay-period-settings.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";
import { timeEntries } from "./schema/time-entries.js";
import { isRecordDate } from "./record-dates.js";
import type { Period } from "./projection.js";
import "./errors.js";

export interface PayPeriodSettings {
  frequency: "monthly" | "weekly" | "fortnightly";
  anchorDate: string | null;
}
export function invalidPeriod(reason: string): never {
  throw new AppError("pay_period.invalid", { reason });
}
function validateSettings(settings: PayPeriodSettings): void {
  if (
    settings === null ||
    typeof settings !== "object" ||
    typeof settings.frequency !== "string" ||
    !["monthly", "weekly", "fortnightly"].includes(settings.frequency)
  )
    invalidPeriod("frequency");
  if (settings.frequency === "fortnightly") {
    if (
      !isRecordDate(settings.anchorDate) ||
      new Date(`${settings.anchorDate}T00:00:00Z`).getUTCDay() !== 1
    )
      invalidPeriod("anchor");
  } else if (settings.anchorDate !== null) invalidPeriod("anchor");
}
export function resolvePayPeriod(settings: PayPeriodSettings, localDate: string): Period {
  validateSettings(settings);
  if (!isRecordDate(localDate)) invalidPeriod("date");
  const date = new Date(`${localDate}T00:00:00Z`);
  if (settings.frequency === "monthly") {
    date.setUTCDate(1);
    const start = date.toISOString().slice(0, 10);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const end = date.toISOString().slice(0, 10);
    if (!isRecordDate(end)) invalidPeriod("date_range");
    return { start, end };
  }
  const days = settings.frequency === "weekly" ? 7 : 14;
  const epoch =
    settings.frequency === "weekly"
      ? Date.parse("1970-01-05T00:00:00Z")
      : Date.parse(`${settings.anchorDate}T00:00:00Z`);
  const startAt =
    epoch + Math.floor((date.getTime() - epoch) / (days * 86400000)) * days * 86400000;
  const start = new Date(startAt).toISOString().slice(0, 10),
    end = new Date(startAt + days * 86400000).toISOString().slice(0, 10);
  if (!isRecordDate(start) || !isRecordDate(end)) invalidPeriod("date_range");
  return { start, end };
}
export async function readPayPeriodSettings(
  tx: Database | Transaction,
): Promise<PayPeriodSettings> {
  const [row] = await tx.select().from(payPeriodSettings).where(eq(payPeriodSettings.id, 1));
  return row === undefined
    ? { frequency: "monthly", anchorDate: null }
    : { frequency: row.frequency, anchorDate: row.anchorDate };
}
export async function setPayPeriodSettings(
  tx: Transaction,
  settings: PayPeriodSettings,
): Promise<void> {
  validateSettings(settings);
  await tx
    .insert(payPeriodSettings)
    .values({ id: 1, ...settings })
    .onConflictDoUpdate({ target: payPeriodSettings.id, set: settings });
}

export async function readPayPeriodCloseGraceDays(tx: Database | Transaction): Promise<number> {
  const [row] = await tx
    .select({ days: payPeriodSettings.closeGraceDays })
    .from(payPeriodSettings)
    .where(eq(payPeriodSettings.id, 1));
  return row?.days ?? DEFAULT_CLOSE_GRACE_DAYS;
}

export async function setPayPeriodCloseGraceDays(tx: Transaction, value: unknown): Promise<void> {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_CLOSE_GRACE_DAYS
  )
    invalidPeriod("closeGraceDays");
  const patch = { closeGraceDays: value };
  await tx
    .insert(payPeriodSettings)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: payPeriodSettings.id, set: patch });
}

export async function payPeriodCloseBoundary(
  clock: BusinessDayClock,
  periodEnd: string,
  graceDays: number,
  isHoliday: (date: string) => Promise<boolean>,
): Promise<string> {
  const date = new Date(`${periodEnd}T00:00:00Z`);
  while (graceDays > 0) {
    const weekday = date.getUTCDay();
    if (weekday > 0 && weekday < 6 && !(await isHoliday(date.toISOString().slice(0, 10)))) {
      graceDays--;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return businessDayBoundaryAt(clock, date.toISOString().slice(0, 10));
}

export async function readNextMonthlyPayPeriod(tx: Transaction): Promise<Period | null> {
  const settings = await readPayPeriodSettings(tx);
  if (settings.frequency !== "monthly") return null;
  const [last] = await tx
    .select({ end: payPeriodClosures.periodEnd })
    .from(payPeriodClosures)
    .orderBy(desc(payPeriodClosures.periodEnd))
    .limit(1);
  if (last !== undefined) return resolvePayPeriod(settings, last.end);
  const [first] = await tx
    .select({
      date: sql<
        string | null
      >`min(date(${timeEntries.eventAt}, printf('%+d minutes', ${timeEntries.eventOffsetMinutes})))`,
    })
    .from(timeEntries).where(sql`${timeEntries.entryKind} = 'in' or (
      ${timeEntries.entryKind} = 'correction' and ${timeEntries.correctionStatus} = 'approved'
      and ${timeEntries.missingEntryKind} = 'in'
    )`);
  return first?.date ? resolvePayPeriod(settings, first.date) : null;
}
