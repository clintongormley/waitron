import type { ModuleAlerts } from "@waitron/module";
import { fiscalSubmissionSource } from "./submission-alerts.js";

/** The fiscal area's dashboard alerts: its claim on `fiscal.` incidents (events) and its ongoing
 * submission check (sources). The source lives with the fiscal tables it reads, so generic code
 * never names them. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
  sources: [fiscalSubmissionSource],
};
