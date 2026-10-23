import type { AlertSource, ModuleAlerts } from "@waitron/module";
import { clockBehindChain } from "./clock-behind.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

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

/** The fiscal area's dashboard alerts: its claim on `fiscal.` incidents (events) and its ongoing
 * submission and clock-behind checks (sources). The sources live with the fiscal tables they read,
 * so generic code never names them. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
  sources: [fiscalSubmissionSource, clockBehindSource],
};
