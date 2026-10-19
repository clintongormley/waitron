import type { CancelItemRequest, CancellationContext } from "./line-cancel-types.js";

export interface UnservedDish {
  billId: string;
  billRevision: number;
  lineId: string;
  name: string;
  quantity: string;
  context: CancellationContext;
}

export type FinishCancellation = Pick<
  CancelItemRequest,
  | "quantity"
  | "expectedBillRevision"
  | "expectedContext"
  | "preparationStarted"
  | "refundHandoff"
  | "reasonId"
  | "note"
> & { lineId: string };

export interface FinishTableResolution {
  submissionId: string;
  cancellations: FinishCancellation[];
  approver?: CancelItemRequest["approver"];
}
