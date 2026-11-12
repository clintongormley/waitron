import { compareDecimal, decimal, addDecimal } from "@waitron/shared";
import type { BillEditExpected, CurrentOrderRow, PartyBill } from "../api/client.js";
import type { CloseDeferredRequest } from "../api/deferred-close-types.js";
import type { StringKey } from "../i18n/strings.js";
import type { CapabilityFlag } from "../layout.js";
import { shownReceiptLanguage } from "../widgets/receipt-language.js";

/** Whether Pay offers Close as deferred payment: not at all, switched off with why, or usable. */
export type DeferredOffer =
  { state: "hidden" } | { state: "off"; reason: StringKey } | { state: "offered" };

export type DeferredDishRow = Pick<
  CurrentOrderRow,
  "workingOrderId" | "quantity" | "cancelledQuantity" | "servedQuantity" | "servedAt"
>;

export interface DeferredOfferInput {
  capabilities: readonly CapabilityFlag[];
  bill: Pick<PartyBill, "workingOrderId" | "status" | "outstanding" | "hasPayments">;
  /** A bill payment held or out, a card answer still unknown, or an unanswered whole payment. */
  paymentUnconfirmed: boolean;
  /** The party's Current orders; null while they are being read, or when they could not be. */
  currentOrders: { groups: { rows: DeferredDishRow[] }[]; ungrouped: DeferredDishRow[] } | null;
  /** The last read of Current orders failed. */
  currentOrdersUnread: boolean;
}

function servedOrCancelled(row: DeferredDishRow): boolean {
  if (row.servedAt !== null) return true;
  const done = addDecimal(decimal(row.servedQuantity), decimal(row.cancelledQuantity ?? "0"));
  return compareDecimal(done, decimal(row.quantity)) >= 0;
}

export function deferredOffered(input: DeferredOfferInput): DeferredOffer {
  const { bill, currentOrders } = input;
  if (
    !input.capabilities.includes("close-deferred") ||
    bill.hasPayments ||
    (bill.status !== "open" && bill.status !== "placed") ||
    compareDecimal(decimal(bill.outstanding), decimal("0")) <= 0
  )
    return { state: "hidden" };
  if (input.paymentUnconfirmed)
    return { state: "off", reason: "deferred_close.payment_unconfirmed" };
  if (currentOrders === null)
    return {
      state: "off",
      reason: input.currentOrdersUnread ? "deferred_close.orders_unread" : "table.loading",
    };
  if (
    [...currentOrders.groups.flatMap((group) => group.rows), ...currentOrders.ungrouped].some(
      (row) => row.workingOrderId === bill.workingOrderId && !servedOrCancelled(row),
    )
  )
    return { state: "off", reason: "deferred_close.unserved" };
  return { state: "offered" };
}

/**
 * Why `bill` can no longer be closed as a deferred payment, as a `deferred_close.ineligible` reason
 * the till words (`codeMessage`); undefined when none of them fits.
 */
export function deferredGoneReason(
  bill: Pick<PartyBill, "status" | "outstanding" | "hasPayments"> | undefined,
): string | undefined {
  if (bill === undefined) return undefined;
  if (bill.hasPayments) return "prior_payment";
  if (bill.status === "settled") return "final_without_deferral";
  if (bill.status === "abandoned") return "void";
  if (compareDecimal(decimal(bill.outstanding), decimal("0")) <= 0) return "non_positive";
  return undefined;
}

export interface DeferredRequestInput {
  bill: PartyBill;
  offeredLanguages: readonly string[];
  expectedEdit: BillEditExpected | null;
  party: { id: string; revision: number; expectedEdits: BillEditExpected[] } | null;
}

/** The close as the bill on screen asks for it, under a new submission id every call. */
export function deferredCloseRequest(input: DeferredRequestInput): CloseDeferredRequest {
  const { bill, party } = input;
  return {
    submissionId: crypto.randomUUID(),
    expectedRevision: bill.revision,
    expectedEdit: input.expectedEdit,
    expectedTotal: bill.total,
    invoiceType: bill.invoiceType,
    recipient: bill.recipient,
    // The server compares an issued invoice's language as stored (apps/server/src/deferred-close.ts).
    receiptLanguage:
      bill.invoiceNumber !== undefined && bill.receiptLanguage !== undefined
        ? bill.receiptLanguage
        : shownReceiptLanguage(bill.receiptLanguage, input.offeredLanguages),
    delivery: bill.invoiceDelivery ?? null,
    partyFinish:
      party === null
        ? null
        : {
            partyId: party.id,
            expectedPartyRevision: party.revision,
            expectedEdits: party.expectedEdits,
          },
  };
}
