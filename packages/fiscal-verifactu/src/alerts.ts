import type { ModuleAlerts } from "@waitron/module";
import { clockBehindSource } from "./clock-behind-alerts.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

/** The fiscal area's dashboard alerts: its claim on `fiscal.` incidents (events) and its ongoing
 * submission and clock-behind checks (sources). The sources live with the fiscal tables they read,
 * so generic code never names them. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
  sources: [fiscalSubmissionSource, clockBehindSource],
};
