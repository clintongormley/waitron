import { expect, it } from "vitest";
import { clockBehindSource } from "./clock-behind-alerts.js";
import { FISCAL_ALERTS } from "./index.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

it("claims fiscal. incidents for the fiscal area under fiscal.view, links the reply-mismatch and record-check warnings to Fiscal filing, and claims clock.behind_chain, clock.records_misdated and clock.corrected incidents for the box area under system.manage, and contributes the submission and clock-behind sources", () => {
  expect(FISCAL_ALERTS).toEqual({
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
      { prefix: "clock.behind_chain", area: "box", permission: "system.manage" },
      { prefix: "clock.records_misdated", area: "box", permission: "system.manage" },
      { prefix: "clock.corrected", area: "box", permission: "system.manage" },
    ],
    sources: [fiscalSubmissionSource, clockBehindSource],
  });
});
