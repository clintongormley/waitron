import nodemailer from "nodemailer";
import { Socket } from "node:net";
import { receiptLabelsFor } from "@waitron/country-packs";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import type { InvoiceDeliveryOutcome } from "./invoice-delivery.js";

export type InvoiceEmailSender = (message: {
  recipient: string;
  document: ReceiptDocumentInput;
}) => Promise<InvoiceDeliveryOutcome>;

export function createInvoiceEmailSender(config: {
  url: string;
  from: string;
}): InvoiceEmailSender {
  return async ({ recipient, document }) => {
    const pdf = await renderInvoicePdf(document);
    const labels = receiptLabelsFor(document.invoiceLocale);
    const caption = `${labels.invoice} ${document.result.invoiceNumber}`;
    // Own the socket so the deadline can cancel an in-flight SMTP exchange.
    const socket = new Socket();
    const transport = nodemailer.createTransport({ url: config.url, socket });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<InvoiceDeliveryOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({ status: "unknown", failureCode: "timeout" });
        socket.destroy();
        transport.close();
      }, 30_000);
    });
    const sending = transport
      .sendMail({
        from: config.from,
        to: recipient,
        subject: caption,
        text: `${caption}${document.duplicate === true ? ` — ${labels.duplicate}` : ""}`,
        attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", content: pdf }],
      })
      .then<InvoiceDeliveryOutcome, InvoiceDeliveryOutcome>(
        () => ({ status: "sent" }),
        (error: unknown) => {
          const response =
            typeof error === "object" && error !== null && "responseCode" in error
              ? error.responseCode
              : undefined;
          return {
            status:
              typeof response === "number" && response >= 400 && response <= 599
                ? "failed"
                : "unknown",
            failureCode: "transport_failed",
          };
        },
      );
    try {
      return await Promise.race([sending, timeout]);
    } finally {
      clearTimeout(timer!);
      socket.destroy();
      transport.close();
    }
  };
}
