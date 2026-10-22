import type { StaffNotice, StaffNoticeSource } from "@waitron/module";
import { isBeforeFirstIssueDate } from "./first-issue-date.js";

/** The clock notice for one reading: a `clock.unusable` notice before the first issue date
 * `@waitron/verifactu` accepts, judged in the reading's own offset; nothing on or after it. */
export function clockNotices(reading: { instant: Date; offsetMinutes: number }): StaffNotice[] {
  if (!isBeforeFirstIssueDate(reading)) return [];
  return [
    {
      key: "clock.unusable",
      code: "clock.unusable",
      severity: "error",
      params: { clockAt: reading.instant.toISOString(), offsetMinutes: reading.offsetMinutes },
    },
  ];
}

export const FISCAL_STAFF_NOTICES: readonly StaffNoticeSource[] = [
  { read: ({ reading }) => Promise.resolve(clockNotices(reading)) },
];
