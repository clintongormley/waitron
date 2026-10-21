import { AppError } from "@waitron/shared";
import { formatDate } from "@waitron/verifactu";

/** 28-10-2024 as YYYYMMDD: `@waitron/verifactu` refuses an earlier FechaExpedicionFactura. */
export const FIRST_ISSUE_DAY = 20241028;

/** Throws `clock.unusable { clockAt, offsetMinutes }` when the reading's date, in its own offset, is before {@link FIRST_ISSUE_DAY}. */
export function refuseBeforeFirstIssueDate(reading: {
  instant: Date;
  offsetMinutes: number;
}): void {
  const [day, month, year] = formatDate(reading.instant, reading.offsetMinutes).split("-");
  if (Number(`${year}${month}${day}`) < FIRST_ISSUE_DAY) {
    throw new AppError("clock.unusable", {
      clockAt: reading.instant.toISOString(),
      offsetMinutes: reading.offsetMinutes,
    });
  }
}
