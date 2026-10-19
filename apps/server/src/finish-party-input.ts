import { requireBodyUuid } from "@waitron/server-kit";
import { invalid } from "./bill-allocation.js";
import { submissionIdOf } from "./bill-payments-api.js";
import { parseCancellationContext } from "./line-cancel-input.js";
import type { FinishCancellation } from "./finish-party-service.js";
import { requireRevision } from "./till-api.js";

export function parseFinishCancellations(body: Record<string, unknown>): {
  submissionId?: string;
  cancellations?: FinishCancellation[];
} {
  if (body.cancellations === undefined)
    return body.submissionId === undefined ? {} : { submissionId: submissionIdOf(body) };
  if (!Array.isArray(body.cancellations)) throw invalid("cancellations");
  const cancellations = body.cancellations.map((raw: unknown): FinishCancellation => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw invalid("cancellations");
    const value = raw as Record<string, unknown>;
    if (typeof value.quantity !== "string") throw invalid("quantity");
    for (const field of ["preparationStarted", "refundHandoff"])
      if (value[field] !== undefined && typeof value[field] !== "boolean") throw invalid(field);
    if (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 500))
      throw invalid("note");
    return {
      lineId: requireBodyUuid(value.lineId, "lineId").toLowerCase(),
      quantity: value.quantity,
      expectedBillRevision: requireRevision(value.expectedBillRevision, "expectedBillRevision"),
      expectedContext: parseCancellationContext(value.expectedContext),
      preparationStarted: value.preparationStarted as boolean | undefined,
      refundHandoff: value.refundHandoff as boolean | undefined,
      reasonId:
        value.reasonId === undefined
          ? undefined
          : requireBodyUuid(value.reasonId, "reasonId").toLowerCase(),
      note: value.note as string | undefined,
    };
  });
  return { submissionId: submissionIdOf(body), cancellations };
}
