import { eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { payPeriodSettings } from "./schema/pay-period-settings.js";
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
