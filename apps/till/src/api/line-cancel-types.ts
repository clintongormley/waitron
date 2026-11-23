import type { BillEditExpected } from "./client.js";

export interface CancellationContext {
  billStatus: "open" | "placed" | "settled" | "abandoned";
  stage: "not_started" | "started";
  components: {
    id: string | null;
    lineId: string;
    state: "queued" | "preparing" | "ready" | null;
    firedAt: string | null;
    requestedAt: string | null;
    stationId: string | null;
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
  /** On a row's read of a settled bill: what each portion the row can still give up refunds, in the
   * order it gives them up. A cancel of `k` portions refunds the first `k`. */
  rowRefunds?: string[];
  /** The free items that come back with this dish when every portion it has left is cancelled with
   * Refund: it is the bill's last paid dish. A `served` one cannot come back, so that cancel cannot
   * give money back. */
  withFree?: {
    lineId: string;
    name: string;
    quantity: string;
    refundAmount: string;
    served?: true;
  }[];
  /** A dish given free that holds a share of the price paid: it gives money back only with the
   * bill's last paid dish. */
  givenFree?: true;
  /** On a `givenFree` dish: the paid dishes whose every unserved portion, cancelled with Refund
   * ticked, brings it back; empty while none can. */
  comesBackWith?: string[];
}

export interface RefundLink {
  lineId: string;
  adjustmentId: string;
}

export interface CancelItemAnswer {
  revision: number;
  refundLinks?: RefundLink[];
}

export interface CancelItemRequest {
  expectedEdit: BillEditExpected | null;
  /** Every portion line of a row the till shows as one, the path's line among them (plan D31). */
  lineIds?: string[];
  quantity: string;
  outcome: "remove_charge" | "keep_charge";
  preparationStarted?: boolean;
  refundHandoff?: boolean;
  /** The free items coming back with the last paid dish, by line id. */
  withFree?: string[];
  expectedPartyRevision?: number;
  expectedBillRevision: number;
  expectedContext: CancellationContext;
  submissionId: string;
  reasonId?: string;
  note?: string;
  approver?: { personId: string; pin: string };
}
