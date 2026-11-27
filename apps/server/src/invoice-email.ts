import type { ReceiptDocumentInput } from "./receipt-document.js";
import { receiptFacts } from "./receipt-facts.js";
import { formatMoney } from "./receipt-money.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { printsAsFullInvoice } from "./invoice-typing.js";
import { invoicePdfFileName } from "./orders-invoice-pdf.js";
import type { InvoiceDeliveryOutcome } from "./invoice-delivery.js";
import type { MailMessage, MailSettlement } from "./mail-sender.js";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { readPrivacyContact } from "@waitron/provisioning";
import { saleId as brandSaleId } from "@waitron/shared";
import { INVOICE_EMAIL_NOTICE_WORDS } from "./i18n/invoice-email-notice.js";
import { invoiceEmailSentence } from "./i18n/invoice-email-message.js";

export interface InvoiceEmailPrivacy {
  privacyNoticeUrl: string | null;
  privacyEmail: string | null;
  /** The sale has a filed tax record, which the box sends to the tax authority. */
  taxRecord: boolean;
}

export async function readInvoiceEmailPrivacy(
  backend: FiscalBackend,
  tx: Transaction,
  saleId: string,
): Promise<InvoiceEmailPrivacy> {
  const contact = await readPrivacyContact(tx);
  const filed = await backend.filedReceiptFor(tx, brandSaleId(saleId));
  return {
    privacyNoticeUrl: contact?.privacyNoticeUrl ?? null,
    privacyEmail: contact?.privacyEmail ?? null,
    taxRecord: filed !== undefined,
  };
}

function privacyNotice(document: ReceiptDocumentInput, privacy: InvoiceEmailPrivacy | undefined) {
  const { invoiceType } = document.result;
  if (privacy === undefined || (invoiceType !== "F1" && invoiceType !== "R1")) return undefined;
  const contacts = [privacy.privacyEmail, privacy.privacyNoticeUrl].filter(
    (contact): contact is string => contact !== null,
  );
  if (contacts.length === 0) return undefined;
  const words =
    INVOICE_EMAIL_NOTICE_WORDS[document.invoiceLocale.split("-")[0] === "en" ? "en" : "es"];
  const venue = (document.result.issuer ?? document.issuer).venueName;
  return [
    (privacy.taxRecord ? words.purposeWithRecord : words.purpose).replace("{venue}", () => venue),
    words.addressSearch,
    words.contact.replace("{contacts}", () => contacts.join(", ")),
  ].join("\n");
}

export async function composeInvoiceEmail({
  document,
  privacy,
}: {
  document: ReceiptDocumentInput;
  privacy?: InvoiceEmailPrivacy;
}): Promise<MailMessage> {
  const pdf = await renderInvoicePdf(document);
  const { labels, letterhead, locale, total } = receiptFacts(document);
  const { invoiceNumber, invoiceType } = document.result;
  const simplified = !printsAsFullInvoice(invoiceType);
  const title =
    invoiceType === "R1" || invoiceType === "R4" || invoiceType === "R5"
      ? labels.correctiveInvoice
      : simplified
        ? labels.simplifiedInvoice
        : labels.invoice;
  const caption = `${title} ${invoiceNumber}`;
  const opening = invoiceEmailSentence(
    locale,
    title.toLocaleLowerCase(locale),
    invoiceNumber,
    formatMoney(total, locale),
    letterhead.tradingName ?? letterhead.legalName,
  );
  const notice = privacyNotice(document, privacy);
  const marked = document.duplicate === true ? `${opening}\n${labels.duplicate}` : opening;
  const text = notice === undefined ? marked : `${marked}\n\n${notice}`;
  const divider = invoiceNumber.lastIndexOf("/");
  return {
    subject: caption,
    text,
    attachments: [
      {
        filename: invoicePdfFileName(
          invoiceNumber.slice(0, divider),
          Number(invoiceNumber.slice(divider + 1)),
        ),
        contentType: "application/pdf",
        content: pdf,
      },
    ],
  };
}

export function invoiceOutcome(
  outcome: Exclude<MailSettlement, { status: "expired" }>,
): InvoiceDeliveryOutcome {
  if (outcome.status === "sent") return outcome;
  if (outcome.status === "rejected" && outcome.serverRefused) {
    return { status: "failed", failureCode: "transport_failed" };
  }
  return {
    status: "unknown",
    failureCode: outcome.failureCode === "email.test_timeout" ? "timeout" : "transport_failed",
  };
}
