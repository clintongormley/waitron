import { FULL_INVOICE_DOCUMENT_FIXTURE } from "@waitron/orders-sales/testing/full-invoice-fixture.js";
import type { FormatReceiptInput } from "../receipt-ticket.js";

export { FULL_INVOICE_DOCUMENT_FIXTURE };

export const FULL_INVOICE_FIXTURE: FormatReceiptInput = {
  ...FULL_INVOICE_DOCUMENT_FIXTURE,
  printer: { paperWidth: "80mm", resolution: "180dpi" },
};
