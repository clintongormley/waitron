import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  orderDrafts,
  parties,
  workingOrderLines,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { isUuid } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import {
  saveDraft,
  takeOverDraft,
  type BillEditExpected,
  type Draft,
  type SaveDraftInput,
} from "../order-drafts.js";
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

const httpObservations = new WeakMap<Database, Map<string, BillEditExpected>>();

// Content-route fixtures keep the first command observation on completed retries.
export async function observedDraftCommandBody(
  db: Database,
  method: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const ask = body as Record<string, unknown>;
  if (Object.hasOwn(ask, "expectedEdit")) return body;
  const save = method === "PUT" && /^\/api\/parties\/[^/]+\/drafts$/.test(path);
  const recall = /^\/api\/parties\/[^/]+\/lines\/([^/]+)\/recall$/.exec(path);
  const draft = /^\/api\/parties\/[^/]+\/drafts\/([^/]+)\/(take-over|submit)$/.exec(path);
  if (!save && recall === null && draft === null) return body;
  return withTransaction(db, async (tx) => {
    let billId = typeof ask.billId === "string" ? ask.billId : undefined;
    if (recall !== null) {
      const [row] = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, recall[1]!.toLowerCase()));
      billId = row?.workingOrderId;
    } else if (draft !== null) {
      const [row] = await tx
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, draft[1]!.toLowerCase()));
      billId = row?.billId ?? undefined;
    }
    if (billId === undefined || !isUuid(billId)) {
      const partyId = /^\/api\/parties\/([^/]+)/.exec(path)?.[1];
      const [party] = await tx
        .select({ billId: parties.mainBillId })
        .from(parties)
        .where(eq(parties.id, partyId?.toLowerCase() ?? ""));
      billId = party?.billId ?? undefined;
    }
    if (billId === undefined || !isUuid(billId)) return body;
    billId = billId.toLowerCase();
    let cache = httpObservations.get(db);
    if (cache === undefined) {
      cache = new Map();
      httpObservations.set(db, cache);
    }
    const key =
      typeof ask.submissionId === "string"
        ? `${method}:${path.toLowerCase()}:${ask.submissionId.toLowerCase()}`
        : undefined;
    let expectedEdit = key === undefined ? undefined : cache.get(key);
    if (expectedEdit === undefined) {
      const edit = await readBillEditState(tx, billId);
      expectedEdit = save
        ? {
            billId,
            editorVersion: edit.editorVersion,
            draftId: ask.draftId as string | null,
            draftRevision: ask.draftId === null ? null : (ask.revision as number),
          }
        : draft === null
          ? edit
          : {
              billId,
              editorVersion: edit.editorVersion,
              draftId: draft[1]!.toLowerCase(),
              draftRevision:
                draft[2] === "take-over"
                  ? (ask.revision as number)
                  : typeof ask.draftRevision === "number" &&
                      Number.isSafeInteger(ask.draftRevision) &&
                      ask.draftRevision >= 0
                    ? ask.draftRevision
                    : edit.draftRevision,
            };
      if (key !== undefined) cache.set(key, expectedEdit);
    }
    return { expectedEdit, ...ask };
  });
}
