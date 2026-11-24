import "@waitron/shared";
import type { AllocationPreview } from "./bill-allocation.js";

declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * A payment was asked of a bill with nothing left to pay and no card pending on it, or Print
     * the bill of a bill its payments already cover, that has no dishes, or that was cancelled.
     */
    "bill.nothing_outstanding": { workingOrderId: string };
    /**
     * The venue has tips off and the payment would record a tip. `chargeable` is what can be taken
     * without one.
     */
    "bill.tip_not_allowed": { workingOrderId: string; chargeable: string };
    /**
     * The allocation the operator was shown is no longer the server's, or a choice between paying
     * the full price with a tip and using the earlier contributions is needed. `preview` is the
     * server's current answer, for the till to show again.
     */
    "bill.allocation_changed": { workingOrderId: string; preview: AllocationPreview };
    /**
     * Declared by `@waitron/venue-service` too, with the same params.
     * Editing or closing a bill must wait while its card payment can still settle.
     */
    "order.payment_in_flight": { workingOrderId: string };
    "invoice.recipient_invalid": {
      field: "taxId" | "legalName" | "address" | "identifierType" | "identifierCountryCode";
    };
    /** A request requires an open order, so settled, abandoned and absent orders share this code. */
    "working_order.not_open": { workingOrderId: string };
  }
}
