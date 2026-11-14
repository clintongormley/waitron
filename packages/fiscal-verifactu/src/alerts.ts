import type { ModuleAlerts } from "@waitron/module";
import { clockUnusableSource } from "./clock-behind-alerts.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

/** The fiscal area's dashboard alerts: its claims on `fiscal.` incidents and, for the box area, on
 * the clock's steps under `clock.corrected` (events), and its ongoing submission and unusable-clock
 * checks (sources). The sources live with the fiscal code they read, so generic code never names
 * them. */
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [
    { prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" },
    {
      prefix: "fiscal.registro_rechazado",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.huella_divergente",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.duplicado_anulado",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.aceptado_con_errores",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.anulacion_retenida",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.respuesta_descuadrada",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.record_flagged",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    {
      prefix: "fiscal.record_totals_disagree",
      area: "fiscal",
      permission: "fiscal.view",
      screen: "fiscal-filing",
    },
    { prefix: "clock.corrected", area: "box", permission: "system.manage" },
  ],
  sources: [fiscalSubmissionSource, clockUnusableSource],
};
