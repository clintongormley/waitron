import "./errors.js";
import { AppError } from "@waitron/shared";
import { formatDate } from "@waitron/verifactu";

/** 28-10-2024 as YYYYMMDD: `@waitron/verifactu` refuses an earlier FechaExpedicionFactura. */
export const FIRST_ISSUE_DAY = 20241028;

/** Whether the reading's date, in its own offset, is before {@link FIRST_ISSUE_DAY}. */
export function isBeforeFirstIssueDate(reading: { instant: Date; offsetMinutes: number }): boolean {
  const [day, month, year] = formatDate(reading.instant, reading.offsetMinutes).split("-");
  return Number(`${year}${month}${day}`) < FIRST_ISSUE_DAY;
}

/** Throws `clock.unusable { clockAt, offsetMinutes }` when {@link isBeforeFirstIssueDate}. */
export function refuseBeforeFirstIssueDate(reading: {
  instant: Date;
  offsetMinutes: number;
}): void {
  if (isBeforeFirstIssueDate(reading)) {
    throw new AppError("clock.unusable", {
      clockAt: reading.instant.toISOString(),
      offsetMinutes: reading.offsetMinutes,
    });
  }
}
