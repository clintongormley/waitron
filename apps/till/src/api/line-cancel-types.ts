import type { BillEditExpected } from "./client.js";

export interface CancellationContext {
  billStatus: "open" | "placed" | "settled" | "abandoned";
  stage: "not_started" | "started";
  components: {
    id: string | null;
    lineId: string;
    state: "queued" | "preparing" | "ready" | null;
    firedAt: string | null;
    quantity: string;
    kitchenQuantity: string | null;
    servedQuantity: string;
    cancelledQuantity: string;
  }[];
}

export interface CancellationRead {
  context: CancellationContext;
  revision: number;
  billRevision: number;
  billId: string;
  saleId?: string;
  refundValue?: { quantity: string; gross: string };
}

export interface CancelItemRequest {
  expectedEdit: BillEditExpected;
  quantity: string;
  outcome: "remove_charge" | "keep_charge";
  preparationStarted?: boolean;
  refundHandoff?: boolean;
  expectedPartyRevision: number;
  expectedBillRevision: number;
  expectedContext: CancellationContext;
  submissionId: string;
  reasonId?: string;
  note?: string;
  approver?: { personId: string; pin: string };
}
