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

export function billEditConflictRows(
  error: unknown,
  parties: readonly ConflictParty[],
): BillEditConflict[] {
  const refusal = error as { code?: unknown; conflicts?: unknown } | null | undefined;
  if (refusal?.code !== "draft.taken_over" || !Array.isArray(refusal.conflicts)) return [];
  return (refusal.conflicts as Partial<BillEditState>[]).flatMap((conflict) => {
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
