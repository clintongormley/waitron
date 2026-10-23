import { requireBodyUuid } from "@waitron/server-kit";
import { invalid } from "./bill-allocation.js";
import { submissionIdOf } from "./bill-payments-api.js";
import { parseCancellationContext } from "./line-cancel-input.js";
import type { CounterCollection, FinishCancellation } from "./finish-party-service.js";
import { requireRevision } from "./till-api.js";

export function parseFinishCancellations(body: Record<string, unknown>): {
  submissionId?: string;
  cancellations?: FinishCancellation[];
  collect?: CounterCollection;
} {
  if (body.collect !== undefined) {
    if (body.cancellations !== undefined) throw invalid("collect");
    if (body.approver !== undefined) throw invalid("approver");
    if (body.submissionId === undefined) throw invalid("submissionId");
    return { submissionId: submissionIdOf(body), collect: parseCollect(body.collect) };
  }
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

function parseCollect(raw: unknown): CounterCollection {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw invalid("collect");
  const { bills } = raw as Record<string, unknown>;
  if (!Array.isArray(bills) || bills.length === 0) throw invalid("collect");
  const parsed = bills.map((bill: unknown) => {
    if (bill === null || typeof bill !== "object" || Array.isArray(bill)) throw invalid("collect");
    const value = bill as Record<string, unknown>;
    return {
      billId: requireBodyUuid(value.billId, "billId").toLowerCase(),
      expectedBillRevision: requireRevision(value.expectedBillRevision, "expectedBillRevision"),
    };
  });
  if (new Set(parsed.map((bill) => bill.billId)).size !== parsed.length) throw invalid("collect");
  return { bills: parsed };
}
