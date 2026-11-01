import type { ModuleAlerts } from "@waitron/module";
import { clockBehindSource } from "./clock-behind-alerts.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

/** The fiscal area's dashboard alerts: its claims on `fiscal.` incidents and, for the box area, on
 * the restart and disproof incidents under `clock.behind_chain`, the wrongly dated sales under
 * `clock.records_misdated` and the clock's steps under `clock.corrected` (events), and its ongoing
 * submission and clock-behind checks (sources). The sources live with the fiscal tables they read,
 * so generic code never names them. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [
    { prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" },
    { prefix: "clock.behind_chain", area: "box", permission: "system.manage" },
    { prefix: "clock.records_misdated", area: "box", permission: "system.manage" },
    { prefix: "clock.corrected", area: "box", permission: "system.manage" },
  ],
  sources: [fiscalSubmissionSource, clockBehindSource],
};
