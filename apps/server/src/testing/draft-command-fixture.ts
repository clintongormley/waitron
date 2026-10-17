import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { orderDrafts, type Transaction } from "@waitron/db";
import { isUuid } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import { saveDraft, takeOverDraft, type Draft, type SaveDraftInput } from "../order-drafts.js";
import type { AttendanceRecorder } from "../attendance-capture.js";
import type { TillConfig } from "../till-config.js";

// Content fixtures consume a draft; command-contract cases call the public writers directly.
export async function saveDraftForTest(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  operatorId: string,
  input: Omit<SaveDraftInput, "expectedEdit">,
  attendance?: AttendanceRecorder,
): Promise<Draft> {
  const billId = typeof input.billId === "string" ? input.billId.toLowerCase() : "";
  const edit = isUuid(billId) ? await readBillEditState(tx, billId) : null;
  const result = await saveDraft(
    tx,
    cfg,
    partyId,
    operatorId,
    {
      ...input,
      expectedEdit: {
        billId,
        editorVersion: edit?.editorVersion ?? 0,
        draftId: input.draftId === null ? null : input.draftId.toLowerCase(),
        draftRevision: input.draftId === null ? null : input.revision,
      },
    },
    attendance,
  );
  return result.draft!;
}

export async function takeOverDraftForTest(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  draftId: string,
  operatorId: string,
  revision: number,
  attendance?: AttendanceRecorder,
): Promise<Draft> {
  const [draft] = await tx
    .select()
    .from(orderDrafts)
    .where(eq(orderDrafts.id, draftId.toLowerCase()));
  const billId = draft?.billId ?? randomUUID();
  const edit = await readBillEditState(tx, billId);
  const result = await takeOverDraft(
    tx,
    cfg,
    partyId,
    draftId,
    operatorId,
    {
      revision,
      submissionId: randomUUID(),
      expectedEdit: {
        billId,
        editorVersion: edit.editorVersion,
        draftId: draftId.toLowerCase(),
        draftRevision: revision,
      },
    },
    attendance,
  );
  return result.draft!;
}

export async function expectedDraftEditForTest(
  tx: Transaction,
  draft: { id: string; revision: number },
) {
  const [row] = await tx
    .select()
    .from(orderDrafts)
    .where(eq(orderDrafts.id, draft.id.toLowerCase()));
  const edit = await readBillEditState(tx, row?.billId ?? randomUUID());
  return {
    billId: edit.billId,
    editorVersion: edit.editorVersion,
    draftId: draft.id.toLowerCase(),
    draftRevision: draft.revision,
  };
}
