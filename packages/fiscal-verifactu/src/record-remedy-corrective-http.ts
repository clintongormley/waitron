import "./errors.js";
import type { RecordSaleLine } from "@waitron/core";
import type { Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { decimal, isUuid, jobOrigin, seriesId } from "@waitron/shared";
import { applyCorrectiveInvoice, correctiveRemedy } from "./record-remedy-corrective.js";
import type { RemedyPolicy } from "./record-remedy.js";
import { invalid, object, only, requestCaseRegistroId, text } from "./record-remedy-request.js";
import { makeVerifactuBackend } from "./slot.js";

function amount(value: unknown): string {
  const literal = text(value);
  try {
    decimal(literal);
  } catch {
    invalid();
  }
  return literal;
}
function line(value: unknown): RecordSaleLine {
  const row = object(value);
  only(row, [
    "lineNo",
    "name",
    "descriptions",
    "quantity",
    "unitPrice",
    "vatRate",
    "lineTotal",
    "lineGross",
    "productId",
    "correctsLineId",
    "advanceRole",
    "deductsSaleId",
  ]);
  if (typeof row.lineNo !== "number" || !Number.isSafeInteger(row.lineNo) || row.lineNo < 1)
    invalid();
  const descriptions = object(row.descriptions);
  for (const [locale, description] of Object.entries(descriptions)) {
    text(locale);
    text(description);
  }
  const result: RecordSaleLine = {
    lineNo: row.lineNo,
    name: text(row.name),
    descriptions: descriptions as Record<string, string>,
    quantity: amount(row.quantity),
    unitPrice: amount(row.unitPrice),
    vatRate: amount(row.vatRate),
    lineTotal: amount(row.lineTotal),
  };
  if ("lineGross" in row) result.lineGross = row.lineGross === null ? null : amount(row.lineGross);
  if ("productId" in row) result.productId = row.productId === null ? null : text(row.productId);
  if ("correctsLineId" in row)
    result.correctsLineId = row.correctsLineId === null ? null : text(row.correctsLineId);
  if ("advanceRole" in row) {
    if (
      row.advanceRole !== null &&
      row.advanceRole !== "payment_on_account" &&
      row.advanceRole !== "deduction"
    )
      invalid();
    result.advanceRole = row.advanceRole;
  }
  if ("deductsSaleId" in row) {
    if (row.deductsSaleId !== null && !isUuid(text(row.deductsSaleId))) invalid();
    result.deductsSaleId = row.deductsSaleId as string | null;
  }
  return result;
}

export async function applyCorrectiveInvoiceRequest(
  tx: Transaction,
  ctx: Pick<ModuleRouteContext, "db">,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: RemedyPolicy,
  raw: Record<string, unknown>,
) {
  only(raw, ["kind", "caseRegistroId", "registroId", "actionKey", "reason", "correction"]);
  const correction = object(raw.correction);
  only(correction, ["seriesId", "total", "operationDescription", "wholeInvoice", "lines"]);
  if ("wholeInvoice" in correction && typeof correction.wholeInvoice !== "boolean") invalid();
  if (!Array.isArray(correction.lines) || correction.lines.length === 0) invalid();
  const lines = correction.lines.map(line);
  if (new Set(lines.map((item) => item.lineNo)).size !== lines.length) invalid();
  const registroId = text(raw.registroId);
  const request = {
    caseRegistroId: await requestCaseRegistroId(tx, raw.caseRegistroId, registroId),
    registroId,
    actionKey: text(raw.actionKey),
    reason: text(raw.reason),
  };
  const backend = makeVerifactuBackend({
    db: ctx.db,
    clock: generation.clock,
    environment: generation.environment,
  });
  const remedy = correctiveRemedy(
    {
      origin: jobOrigin("operator_script"),
      seriesId: seriesId(text(correction.seriesId)),
      total: amount(correction.total),
      operationDescription: text(correction.operationDescription),
      wholeInvoice: correction.wholeInvoice === true,
      lines,
    },
    { managementSessionId: token, nodeId: generation.nodeId, backend },
  );
  return applyCorrectiveInvoice(tx, {
    managementSessionId: token,
    generation,
    enabledRemedies,
    request,
    remedy,
  });
}
