import { expect, it } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import { formatTenderRefundAcknowledgment } from "./tender-refund-receipt.js";
import type { TenderRefundAcknowledgment } from "./tender-refund-types.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";
const acknowledgment: TenderRefundAcknowledgment = {
  refund: {
    id: "refund-id",
    saleId: "sale-id",
    tenderId: "tender-id",
    state: "completed",
    appliedAmount: "12.34",
    tipAmount: "0.56",
    createdAt: "2026-10-16T08:00:00Z",
    completedAt: "2026-10-16T09:05:00Z",
  },
  invoiceNumber: "A/1",
  issuer: { venueName: "Saved issuer", nif: "B12345678" },
  customerName: "Saved customer",
  method: "card",
  last4: "5838",
};
it.each([
  ["es-ES", "es-ES", "es-ES"],
  ["ca-ES", "ca-ES", "ca-ES"],
  ["gl-ES", "gl-ES", "gl-ES"],
  ["eu-ES", "eu-ES", "eu-ES"],
  ["en-GB", "en-GB", "en-GB"],
  ["ca", "ca-ES", "es-ES"],
  ["en", "en-GB", "en-GB"],
  ["fr-FR", "en-GB", "es-ES"],
])(
  "A965 payment language refund %s preserves heading %s and row %s selection",
  (language, headingLocale, rowLocale) => {
    const headings = receiptLabelsFor(headingLocale!);
    const labels = receiptLabelsFor(rowLocale!);
    const bytes = formatTenderRefundAcknowledgment(acknowledgment, language!, {
      paperWidth: "80mm",
      resolution: "180dpi",
    });
    const text = decodeTicket(bytes);
    expect(text).toContain(headings.refundHeading);
    expect(text).toContain(headings.refundNotice);
    expect(text).toContain(labels.refundReference);
    expect(text).toContain(labels.refundAmount);
    expect(text).toContain(labels.refundTip);
    expect(text).toContain(labels.refundTotal);
    expect(text).toContain("A/1");
    expect(text).toContain("5838");
    expect(text).toMatch(/09:05(?:\)| AM)? UTC/);
    expect(opensDrawer(bytes)).toBe(false);
  },
);
