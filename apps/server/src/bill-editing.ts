import { and, eq, inArray } from "drizzle-orm";
import {
  billEditStates,
  nowIso,
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, isUuid } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import type { BillEditExpected, BillEditState } from "./order-drafts.js";
import "./errors.js";

export async function acquireBillEditor(
  tx: Transaction,
  billId: string,
  operatorId: string,
  expected: BillEditExpected,
): Promise<BillEditState> {
  const edit = await requireBillEditor(tx, billId, operatorId, expected);
  if (edit.editorId !== null) return edit;
  // Validate nonempty work before acquiring; create its outbox in the same transaction.
  await writeEditor(tx, edit, operatorId);
  return readBillEditState(tx, billId);
}

export async function closeBillDraft(
  tx: Transaction,
  billId: string,
  operatorId: string,
  expected: BillEditExpected,
  state: "submitted" | "discarded",
): Promise<BillEditState> {
  const edit = await requireBillEditor(tx, billId, operatorId, expected);
  if (edit.draftId === null) return edit;
  const [fresh] = await tx
    .select({ id: orderDraftLines.id })
    .from(orderDraftLines)
    .where(eq(orderDraftLines.draftId, edit.draftId))
    .limit(1);
  const [source] = await tx
    .select({ id: orderDraftRecalledLines.id })
    .from(orderDraftRecalledLines)
    .where(eq(orderDraftRecalledLines.draftId, edit.draftId))
    .limit(1);
  if (fresh !== undefined || source !== undefined) throw invalid("lines");
  await tx
    .update(orderDrafts)
    .set({ state, revision: edit.draftRevision! + 1, updatedAt: nowIso() })
    .where(eq(orderDrafts.id, edit.draftId));
  await writeEditor(tx, edit, null);
  return readBillEditState(tx, billId);
}

// Record the ownership event and attendance in this same transaction at the command root.
export async function transferBillEditor(
  tx: Transaction,
  billId: string,
  operatorId: string,
  expected: BillEditExpected,
): Promise<BillEditState> {
  const edit = await comparedBillEdit(tx, billId, expected);
  if (edit.draftId === null || edit.editorId === operatorId) return edit;
  await tx
    .update(orderDrafts)
    .set({ ownerId: operatorId, revision: edit.draftRevision! + 1, updatedAt: nowIso() })
    .where(eq(orderDrafts.id, edit.draftId));
  await writeEditor(tx, edit, operatorId);
  return readBillEditState(tx, billId);
}

// Validate the complete affected set before relocating; a common foreign editor may follow it.
export async function relocateBillEditor(
  tx: Transaction,
  billId: string,
  expected: BillEditExpected,
): Promise<BillEditState> {
  const edit = await comparedBillEdit(tx, billId, expected);
  if (edit.draftId !== null)
    await tx
      .update(orderDrafts)
      .set({ revision: edit.draftRevision! + 1, updatedAt: nowIso() })
      .where(eq(orderDrafts.id, edit.draftId));
  await writeEditor(tx, edit, edit.editorId);
  return readBillEditState(tx, billId);
}

async function comparedBillEdit(tx: Transaction, billId: string, expected: BillEditExpected) {
  const wanted = parseBillEditExpected(expected);
  if (wanted.billId !== billId) throw invalid("expectedEdit.billId");
  const edit = await readBillEditState(tx, billId);
  requireExpectedState(edit, wanted);
  return edit;
}

async function writeEditor(tx: Transaction, edit: BillEditState, editorId: string | null) {
  await tx
    .insert(billEditStates)
    .values({ billId: edit.billId, editorId, editorVersion: edit.editorVersion + 1 })
    .onConflictDoUpdate({
      target: billEditStates.billId,
      set: { editorId, editorVersion: edit.editorVersion + 1 },
    });
}

export async function readPartyBillIds(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<string[]> {
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(inArray(workingOrders.partyId, [...partyIds]))
    .orderBy(workingOrders.id);
  return bills.map((bill) => bill.id);
}

export function parseBillEditExpecteds(value: unknown): BillEditExpected[] {
  if (!Array.isArray(value)) throw invalid("expectedEdits");
  const expected = Array.from(value, (edit, index) =>
    parseExpectedAt(edit, `expectedEdits.${index}`),
  );
  for (let index = 1; index < expected.length; index++)
    if (expected[index - 1]!.billId >= expected[index]!.billId)
      throw invalid(`expectedEdits.${index}.billId`);
  return expected;
}

export async function requireBillEditors(
  tx: Transaction,
  billIds: readonly string[],
  operatorId: string,
  expected: BillEditExpected[],
): Promise<BillEditState[]> {
  const { wanted, edits } = await readExpectedBillEdits(tx, billIds, expected);
  const conflicts = edits.filter((edit) => edit.editorId !== null && edit.editorId !== operatorId);
  if (conflicts.length > 0) throw editorConflict(conflicts[0]!, conflicts);
  for (const [index, edit] of edits.entries()) requireExpectedState(edit, wanted[index]!);
  return edits;
}

export async function requireRelocatableBillEditors(
  tx: Transaction,
  billIds: readonly string[],
  operatorId: string,
  expected: BillEditExpected[],
): Promise<BillEditState[]> {
  const { wanted, edits } = await readExpectedBillEdits(tx, billIds, expected);
  const owners = new Set(edits.flatMap((edit) => (edit.editorId === null ? [] : [edit.editorId])));
  if (owners.size > 1) {
    const conflicts = edits.filter(
      (edit) => edit.editorId !== null && edit.editorId !== operatorId,
    );
    throw editorConflict(conflicts[0]!, conflicts);
  }
  for (const [index, edit] of edits.entries()) requireExpectedState(edit, wanted[index]!);
  return edits;
}

export function parseBillEditExpected(value: unknown): BillEditExpected {
  return parseExpectedAt(value, "expectedEdit");
}

function parseExpectedAt(value: unknown, field: string): BillEditExpected {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid(field);
  const input = value as Record<string, unknown>;
  const billId = uuid(input.billId, `${field}.billId`);
  const editorVersion = revision(input.editorVersion, `${field}.editorVersion`);
  const draftId = input.draftId === null ? null : uuid(input.draftId, `${field}.draftId`);
  const draftRevision =
    input.draftRevision === null ? null : revision(input.draftRevision, `${field}.draftRevision`);
  if ((draftId === null) !== (draftRevision === null)) throw invalid(`${field}.draftRevision`);
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
  if (edit.editorId !== null && edit.editorId !== operatorId) throw editorConflict(edit);
  requireExpectedState(edit, wanted);
  return edit;
}

async function readExpectedBillEdits(
  tx: Transaction,
  billIds: readonly string[],
  expected: BillEditExpected[],
): Promise<{ wanted: BillEditExpected[]; edits: BillEditState[] }> {
  const wanted = parseBillEditExpecteds(expected);
  const ids = [...new Set(billIds)].sort();
  if (ids.length !== wanted.length || ids.some((id, index) => id !== wanted[index]!.billId))
    throw invalid("expectedEdits");
  const edits: BillEditState[] = [];
  for (const id of ids) edits.push(await readBillEditState(tx, id));
  return { wanted, edits };
}

function editorConflict(edit: BillEditState, conflicts?: BillEditState[]) {
  return new AppError("draft.taken_over", {
    billId: edit.billId,
    draftId: edit.draftId,
    ownerId: edit.editorId!,
    ownerName: edit.editorName,
    edit,
    ...(conflicts === undefined ? {} : { conflicts }),
  });
}

function requireExpectedState(edit: BillEditState, wanted: BillEditExpected): void {
  if (
    wanted.editorVersion !== edit.editorVersion ||
    wanted.draftId !== edit.draftId ||
    wanted.draftRevision !== edit.draftRevision
  )
    throw new AppError("draft.out_of_date", {
      billId: edit.billId,
      draftId: edit.draftId,
      revision: edit.draftRevision,
      edit,
    });
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
