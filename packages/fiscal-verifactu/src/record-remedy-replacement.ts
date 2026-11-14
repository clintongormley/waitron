import "./errors.js";
import { recordReplacement } from "@waitron/core";
import { readLiveSeriesIdTx, type Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { AppError, jobOrigin, seriesId } from "@waitron/shared";
import { formatDateTime } from "@waitron/verifactu";
import { applyCorrectiveInvoice } from "./record-remedy-corrective.js";
import { caseIdForRecord, type RemedyPolicy } from "./record-remedy.js";
import { makeVerifactuBackend } from "./slot.js";

const KEYS = ["kind", "caseId", "registroId", "actionKey", "reason", "operationDate"];

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new AppError("fiscal.remedy_request_invalid", {});
  return value;
}

function operationDateInvalid(): never {
  throw new AppError("fiscal.operation_date_invalid", { field: "operationDate" });
}

/** A calendar day written `YYYY-MM-DD`; refused otherwise. */
function calendarDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) operationDateInvalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    operationDateInvalid();
  return value;
}

/**
 * Puts right a simplified invoice AEAT refused for a future issue date (`1112`) with a replacement
 * corrective (R5 "S") carrying the day the sale really happened.
 */
export async function applyReplacementInvoiceRequest(
  tx: Transaction,
  ctx: Pick<ModuleRouteContext, "db">,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: Record<string, unknown>,
) {
  if (Object.keys(raw).some((key) => !KEYS.includes(key)))
    throw new AppError("fiscal.remedy_request_invalid", {});
  const registroId = text(raw.registroId);
  const actionKey = text(raw.actionKey);
  const reason = text(raw.reason);
  const operationDate = calendarDay(raw.operationDate);
  const request = {
    caseId: raw.caseId === undefined ? await caseIdForRecord(tx, registroId) : text(raw.caseId),
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
    backend,
    request,
    remedy: {
      kind: "replacement-invoice",
      action: { operationDate },
      admits: ({ filingCase, delivery, target }) =>
        filingCase.cause === "fiscal.registro_rechazado" &&
        delivery.codigoError === "1112" &&
        target.tipoFactura === "F2",
      async replace(tx, { correctsSaleId, target, clock }) {
        const now = clock.now();
        // The replacement's own issue day, from the reading that dates it.
        const today = formatDateTime(now.instant, now.offsetMinutes).slice(0, 10);
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
          operationDescription: target.descripcionOperacion ?? undefined,
          nodeId: generation.nodeId,
          seriesId: seriesId(await readLiveSeriesIdTx(tx, generation.nodeId, "rectificative")),
          correctsSaleId,
          operationDate,
          authz: { managementSessionId: token },
          clock,
        });
      },
    },
  });
}
