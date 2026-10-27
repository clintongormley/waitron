import nodemailer from "nodemailer";
import { Socket } from "node:net";
import { receiptLabelsFor } from "@waitron/country-packs";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import type { InvoiceDeliveryOutcome } from "./invoice-delivery.js";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { OnboardingIntent } from "./trading-config.js";
import { resolveInvoiceEmailDelivery } from "./email-delivery.js";
import { INVOICE_EMAIL_NOTICE_WORDS } from "./i18n/invoice-email-notice.js";

export interface InvoiceEmailPrivacy {
  privacyNoticeUrl: string | null;
  privacyEmail: string | null;
  /** The sale has a filed tax record, which the box sends to the tax authority. */
  taxRecord: boolean;
}

export type InvoiceEmailSender = (message: {
  recipient: string;
  document: ReceiptDocumentInput;
  privacy?: InvoiceEmailPrivacy;
}) => Promise<InvoiceDeliveryOutcome>;

function privacyNotice(document: ReceiptDocumentInput, privacy: InvoiceEmailPrivacy | undefined) {
  if (privacy === undefined) return undefined;
  const contacts = [privacy.privacyEmail, privacy.privacyNoticeUrl].filter(
    (contact): contact is string => contact !== null,
  );
  if (contacts.length === 0) return undefined;
  const words =
    INVOICE_EMAIL_NOTICE_WORDS[document.invoiceLocale.split("-")[0] === "en" ? "en" : "es"];
  const venue = (document.result.issuer ?? document.issuer).venueName;
  return [
    (privacy.taxRecord ? words.purposeWithRecord : words.purpose).replace("{venue}", () => venue),
    words.contact.replace("{contacts}", () => contacts.join(", ")),
  ].join("\n");
}

export function createRoutedInvoiceEmailSender(deps: {
  db: Database;
  ring: KeyRing;
  config: { onboardingIntent: OnboardingIntent | undefined; devMode: boolean };
}): InvoiceEmailSender {
  return async (message) => {
    const delivery = await resolveInvoiceEmailDelivery(deps.db, deps.ring, deps.config);
    if (delivery.mode === "unconfigured") {
      return { status: "failed", failureCode: "transport_failed" };
    }
    return createInvoiceEmailSender(delivery.smtp)(message);
  };
}

export function createInvoiceEmailSender(config: {
  url: string;
  from: string;
}): InvoiceEmailSender {
  return async ({ recipient, document, privacy }) => {
    const pdf = await renderInvoicePdf(document);
    const labels = receiptLabelsFor(document.invoiceLocale);
    const caption = `${labels.invoice} ${document.result.invoiceNumber}`;
    const notice = privacyNotice(document, privacy);
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
        text: `${caption}${document.duplicate === true ? ` — ${labels.duplicate}` : ""}${notice === undefined ? "" : `\n\n${notice}`}`,
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
