import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "invoice.recipient_invalid": {
      field: "taxId" | "legalName" | "address" | "identifierType" | "identifierCountryCode";
    };
    /** A request requires an open order, so settled, abandoned and absent orders share this code. */
    "working_order.not_open": { workingOrderId: string };
  }
}
