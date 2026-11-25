import type { BillEditExpected, BillEditState } from "../api/client.js";

/** The edit state a bill was read with, as a write on that bill expects it. */
export function expectedEditOf({
  billId,
  editorVersion,
  draftId,
  draftRevision,
}: BillEditExpected): BillEditExpected {
  return { billId, editorVersion, draftId, draftRevision };
}

/** The edit state a bill read gives Counter order `orderId`, which has no party; refused as out of
 * date when the read is of another order, names a party, or carries no edit state of its own. */
export function counterBillEdit(
  bill: { workingOrderId: string; partyId: string | null; edit?: BillEditState | null },
  orderId: string,
): BillEditExpected {
  if (
    bill.workingOrderId !== orderId ||
    bill.partyId !== null ||
    bill.edit == null ||
    bill.edit.billId !== orderId
  )
    throw { code: "draft.out_of_date" };
  return expectedEditOf(bill.edit);
}
