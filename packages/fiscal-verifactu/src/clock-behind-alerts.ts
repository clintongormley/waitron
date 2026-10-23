import type { AlertSource } from "@waitron/module";
import { clockBehindChain } from "./clock-behind.js";

/** Payments are stopped while the box's clock reads more than a minute before the latest record.
 * The alert context carries no offset, so the reading is taken at offset 0; only the instants are
 * shown. */
export const clockBehindSource: AlertSource = {
  area: "box",
  permission: "system.manage",
  async read({ tx, now }) {
    const behind = await clockBehindChain(tx, { instant: now, offsetMinutes: 0 });
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
