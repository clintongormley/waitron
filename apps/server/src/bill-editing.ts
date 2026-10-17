import { and, eq } from "drizzle-orm";
import { billEditStates, orderDrafts, type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import type { BillEditState } from "./order-drafts.js";

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
