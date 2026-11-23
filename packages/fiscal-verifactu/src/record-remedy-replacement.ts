import "./errors.js";
import { recordReplacement } from "@waitron/core";
import { readLiveSeriesIdTx, type Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { AppError, isCalendarDate, jobOrigin, localCalendarDate, seriesId } from "@waitron/shared";
import { applyCorrectiveInvoice } from "./record-remedy-corrective.js";
import { FULL_INVOICE_REPLACEMENT, type RemedyPolicy } from "./record-remedy.js";
import { only, requestCaseId, text } from "./record-remedy-request.js";
import { FISCAL_SLOT, makeVerifactuBackend } from "./slot.js";

function operationDateInvalid(): never {
  throw new AppError("fiscal.operation_date_invalid", { field: "operationDate" });
}

function operationDateOf(value: unknown): string {
  if (typeof value !== "string" || !isCalendarDate(value)) operationDateInvalid();
  return value;
}

/**
 * Puts right an invoice AEAT refused for a future issue date (`1112`) with a replacement corrective
 * carrying the day the sale really happened: an R5 "S" for a simplified invoice (F2), and, only
 * where the policy carries `FULL_INVOICE_REPLACEMENT`, an R4 "S" naming the same customer for a
 * full invoice (F1).
 */
export async function applyReplacementInvoiceRequest(
  tx: Transaction,
  ctx: Pick<ModuleRouteContext, "db">,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: Record<string, unknown>,
) {
  only(raw, ["kind", "caseId", "registroId", "actionKey", "reason", "operationDate"]);
  const registroId = text(raw.registroId);
  const actionKey = text(raw.actionKey);
  const reason = text(raw.reason);
  const operationDate = operationDateOf(raw.operationDate);
  const request = {
    caseId: await requestCaseId(tx, raw.caseId, registroId),
    registroId,
    actionKey,
    reason,
  };
  const backend = makeVerifactuBackend({
    db: ctx.db,
    clock: generation.clock,
    environment: generation.environment,
  });
  return applyCorrectiveInvoice(tx, {
    managementSessionId: token,
    generation,
    enabledRemedies,
    request,
    remedy: {
      kind: "replacement-invoice",
      action: { operationDate },
      admits: ({ filingCase, delivery, target }) =>
        filingCase.cause === "fiscal.registro_rechazado" &&
        delivery.codigoError === "1112" &&
        (target.tipoFactura === "F2" ||
          (target.tipoFactura === "F1" && enabledRemedies.has(FULL_INVOICE_REPLACEMENT))),
      async issue(tx, { correctsSaleId, target, clock }) {
        const now = clock.now();
        // The replacement's own issue day, from the reading that dates it.
        const today = localCalendarDate(now.instant, now.offsetMinutes);
        // @waitron/verifactu's FECHA_OPERACION_BEFORE_MINIMUM: not before today twenty years back.
        const earliest = `${String(Number(today.slice(0, 4)) - 20).padStart(4, "0")}${today.slice(4)}`;
        if (
          operationDate > today ||
          operationDate > target.fechaExpedicionFactura ||
          operationDate < earliest
        )
          operationDateInvalid();
        return recordReplacement(tx, backend, {
          origin: jobOrigin("operator_script"),
          operationDescription:
            target.descripcionOperacion ??
            FISCAL_SLOT.venueFields?.defaults?.operationDescription ??
            "",
          nodeId: generation.nodeId,
          seriesId: seriesId(
            await readLiveSeriesIdTx(
              tx,
              generation.nodeId,
              target.tipoFactura === "F2" ? "corrective" : "full_corrective",
            ),
          ),
          correctsSaleId,
          operationDate,
          authz: { managementSessionId: token },
          clock,
        });
      },
    },
  });
}
