import type { AlertSource } from "@waitron/module";
import { clockBehindChain } from "./clock-behind.js";
import { isBeforeFirstIssueDate } from "./first-issue-date.js";

/** Payments are stopped while the box's clock reads more than a minute before the latest record,
 * or before 28-10-2024, which `clock.unusable` reports instead. The alert context carries no
 * offset, so the reading is taken at offset 0; only the instants are shown. */
export const clockBehindSource: AlertSource = {
  area: "box",
  permission: "system.manage",
  async read({ tx, now }) {
    const reading = { instant: now, offsetMinutes: 0 };
    if (isBeforeFirstIssueDate(reading)) {
      return [
        {
          key: "clock.unusable",
          code: "clock.unusable",
          severity: "error",
          since: null,
          screen: "box-status",
          params: { clockAt: now.toISOString() },
        },
      ];
    }
    const behind = await clockBehindChain(tx, reading);
    if (behind === null) return [];
    return [
      {
        key: "clock.behind_chain",
        code: "clock.behind_chain",
        severity: "error",
        since: null,
        screen: "box-status",
        params: { clockAt: behind.clockAt, lastRecordAt: behind.lastRecordAt },
      },
    ];
  },
};
