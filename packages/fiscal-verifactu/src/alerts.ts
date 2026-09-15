import type { ModuleAlerts } from "@waitron/module";

/** The fiscal area's claim on `fiscal.` incidents, for the dashboard alerts seat. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
};
