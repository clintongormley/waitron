import { and, eq } from "drizzle-orm";
import { billEditStates, orderDrafts, type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, isUuid } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import type { BillEditExpected, BillEditState } from "./order-drafts.js";
import "./errors.js";

export function parseBillEditExpected(value: unknown): BillEditExpected {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("expectedEdit");
  const input = value as Record<string, unknown>;
  const billId = uuid(input.billId, "expectedEdit.billId");
  const editorVersion = revision(input.editorVersion, "expectedEdit.editorVersion");
  const draftId = input.draftId === null ? null : uuid(input.draftId, "expectedEdit.draftId");
  const draftRevision =
    input.draftRevision === null
      ? null
      : revision(input.draftRevision, "expectedEdit.draftRevision");
  if ((draftId === null) !== (draftRevision === null)) throw invalid("expectedEdit.draftRevision");
  return { billId, editorVersion, draftId, draftRevision };
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return value.toLowerCase();
}

function revision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(field);
  return value;
}

export async function requireBillEditor(
  tx: Transaction,
  billId: string,
  operatorId: string,
  expected: BillEditExpected,
): Promise<BillEditState> {
  const wanted = parseBillEditExpected(expected);
  if (wanted.billId !== billId) throw invalid("expectedEdit.billId");
  const edit = await readBillEditState(tx, billId);
  if (edit.editorId !== null && edit.editorId !== operatorId)
    throw new AppError("draft.taken_over", {
      billId,
      draftId: edit.draftId,
      ownerId: edit.editorId,
      ownerName: edit.editorName,
      edit,
    });
  if (
    wanted.editorVersion !== edit.editorVersion ||
    wanted.draftId !== edit.draftId ||
    wanted.draftRevision !== edit.draftRevision
  )
    throw new AppError("draft.out_of_date", {
      billId,
      draftId: edit.draftId,
      revision: edit.draftRevision,
      edit,
    });
  return edit;
}

export async function readBillEditState(tx: Transaction, billId: string): Promise<BillEditState> {
  const [state] = await tx
    .select({
      editorId: billEditStates.editorId,
      editorName: persons.displayName,
      editorVersion: billEditStates.editorVersion,
    })
    .from(billEditStates)
    .leftJoin(persons, eq(persons.id, billEditStates.editorId))
    .where(eq(billEditStates.billId, billId));
  const [draft] = await tx
    .select({ id: orderDrafts.id, revision: orderDrafts.revision })
    .from(orderDrafts)
    .where(and(eq(orderDrafts.billId, billId), eq(orderDrafts.state, "open")));
  return {
    billId,
    editorId: state?.editorId ?? null,
    editorName: state?.editorName ?? null,
    editorVersion: state?.editorVersion ?? 0,
    draftId: draft?.id ?? null,
    draftRevision: draft?.revision ?? null,
  };
}
