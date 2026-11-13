import "./errors.js";
import type { RecordSaleLine } from "@waitron/core";
import type { Transaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import { AppError, decimal, jobOrigin, seriesId } from "@waitron/shared";
import { applyCorrectiveInvoice } from "./record-remedy-corrective.js";
import { caseIdForRecord, type RemedyKind } from "./record-remedy.js";
import { makeVerifactuBackend } from "./slot.js";

function invalid(): never {
  throw new AppError("fiscal.remedy_request_invalid", {});
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(row).some((key) => !keys.includes(key))) invalid();
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return invalid();
  return value;
}
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
  return result;
}

export async function applyCorrectiveInvoiceRequest(
  tx: Transaction,
  ctx: Pick<ModuleRouteContext, "db">,
  generation: NonNullable<ModuleRouteContext["recordGeneration"]>,
  token: string,
  enabledRemedies: ReadonlySet<RemedyKind>,
  raw: Record<string, unknown>,
) {
  only(raw, ["kind", "caseId", "registroId", "actionKey", "reason", "correction"]);
  const correction = object(raw.correction);
  only(correction, ["seriesId", "total", "operationDescription", "wholeInvoice", "lines"]);
  if ("wholeInvoice" in correction && typeof correction.wholeInvoice !== "boolean") invalid();
  if (!Array.isArray(correction.lines) || correction.lines.length === 0) invalid();
  const lines = correction.lines.map(line);
  if (new Set(lines.map((item) => item.lineNo)).size !== lines.length) invalid();
  const registroId = text(raw.registroId);
  const request = {
    caseId: raw.caseId === undefined ? await caseIdForRecord(tx, registroId) : text(raw.caseId),
    registroId,
    actionKey: text(raw.actionKey),
    reason: text(raw.reason),
    correction: {
      origin: jobOrigin("operator_script"),
      seriesId: seriesId(text(correction.seriesId)),
      total: amount(correction.total),
      operationDescription: text(correction.operationDescription),
      wholeInvoice: correction.wholeInvoice === true,
      lines,
    },
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
  });
}
