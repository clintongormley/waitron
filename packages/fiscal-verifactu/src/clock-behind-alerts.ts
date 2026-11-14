import type { AlertSource } from "@waitron/module";
import { isBeforeFirstIssueDate } from "./first-issue-date.js";

/** Payments are stopped while the box's clock reads before 28-10-2024. The alert context carries no
 * offset, so the reading is taken at offset 0. */
export const clockUnusableSource: AlertSource = {
  area: "box",
  permission: "system.manage",
  async read({ now }) {
    if (!isBeforeFirstIssueDate({ instant: now, offsetMinutes: 0 })) return [];
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
  },
};
