import type { BillEditExpected, BillEditState } from "../api/client.js";

export interface BillEditConflict {
  partyId: string;
  label: string;
  ownerName: string | null;
  edit: BillEditExpected;
}

interface ConflictParty {
  partyId: string;
  edits: readonly BillEditExpected[];
  label: (billId: string) => string;
}

function refusedEdits(error: unknown): Partial<BillEditState>[] {
  const refusal = error as { code?: unknown; conflicts?: unknown } | null | undefined;
  return refusal?.code === "draft.taken_over" && Array.isArray(refusal.conflicts)
    ? refusal.conflicts
    : [];
}

export function billEditConflictIncludes(error: unknown, billId: string): boolean {
  return refusedEdits(error).some((conflict) => conflict?.billId === billId);
}

export function billEditConflictRows(
  error: unknown,
  parties: readonly ConflictParty[],
): BillEditConflict[] {
  return refusedEdits(error).flatMap((conflict) => {
    if (
      typeof conflict?.billId !== "string" ||
      typeof conflict.editorVersion !== "number" ||
      (conflict.draftId !== null && typeof conflict.draftId !== "string") ||
      (conflict.draftRevision !== null && typeof conflict.draftRevision !== "number")
    )
      return [];
    const { billId, editorVersion, draftId, draftRevision, editorName } = conflict;
    const party = parties.find(({ edits }) => edits.some((edit) => edit.billId === billId));
    return party === undefined
      ? []
      : [
          {
            partyId: party.partyId,
            label: party.label(billId),
            ownerName: typeof editorName === "string" ? editorName : null,
            edit: { billId, editorVersion, draftId, draftRevision },
          },
        ];
  });
}
