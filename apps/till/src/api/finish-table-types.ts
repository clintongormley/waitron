import type { CancelItemRequest, CancellationContext, RefundLink } from "./line-cancel-types.js";

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

export interface FinishTableCollect {
  submissionId: string;
  collect: { bills: { billId: string; expectedBillRevision: number }[] };
  cancellations?: never;
  approver?: never;
}

export interface FinishTableAnswer {
  state: "closed";
  refundLinks?: RefundLink[];
}
