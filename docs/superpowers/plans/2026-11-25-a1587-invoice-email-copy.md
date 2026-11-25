# A1587. Name the emailed invoice and say what it contains

Customers can identify an emailed invoice or receipt from the name of its PDF and read the amount and the business name in the message. An original and a copy both use `FF-0EBGA-4.pdf` for `FF-0EBGA/4`. The copy has a duplicate mark in the PDF and on the next line of the message, before any blank line and privacy notice.

## Wording for the owner to see

| Language | Opening line |
| --- | --- |
| Spanish | Adjuntamos la factura FF-0EBGA/4, de 2,00 €. Juniper Test Cafe |
| English | Attached is invoice FF-0EBGA/4 for €2.00. Juniper Test Cafe |
| Catalan | Us adjuntem la factura FF-0EBGA/4, per un import de 2,00 €. Juniper Test Cafe |
| Galician | Achegamos a factura FF-0EBGA/4, por importe de 2,00 €. Juniper Test Cafe |
| Basque | Erantsita bidaltzen dizugu FF-0EBGA/4 zenbakiko faktura (2,00 €). Juniper Test Cafe |

Use the existing lower-cased document titles inside these sentences. Spanish examples are `Adjuntamos la factura simplificada S/1, de 1,00 €. Juniper Test Cafe`, `Adjuntamos la factura rectificativa R/7, de -2,00 €. Juniper Test Cafe` for R5, and `Adjuntamos la factura rectificativa R/8, de 2,00 €. Juniper Test Cafe` for a full replacement. The Spanish copy uses the same opening line as the original and `DUPLICADO` below it.

## Build and check

1. Update existing tests first. In `apps/server/src/invoice-email.test.ts`, assert the exact Spanish example, the five receipt languages, the receipt and both corrective types, and the original and copy filenames. Include `F/A/1` as `F_A-1.pdf`, an R5 with a negative total and a printed name containing `$&`. Keep the PDF, language, and privacy assertions. In `apps/server/src/invoice-delivery.test.ts`, keep checking the duplicate mark in the message and PDF on resend and retry. In `apps/server/src/boot.invoice-delivery.test.ts`, assert the sent receipt's new body and filename while retaining the exact privacy paragraph check. Run the three files to see the new checks fail on the old composer.
2. Change `composeInvoiceEmail` in `apps/server/src/invoice-email.ts`. Split `result.invoiceNumber` at its last slash and reuse `invoicePdfFileName` from `orders-invoice-pdf.ts`. Reuse the subject's document labels, the PDF's `receiptFacts` letterhead name (`tradingName` or `legalName`) and `formatMoney` from `receipt-money.ts` for the stored total. Put the five sentence functions in `apps/server/src/i18n/invoice-email-message.ts`, keyed by `document.invoiceLocale` with the same Spanish fallback as the receipt labels. Keep the subject, privacy paragraph and PDF. Delivery, stored invoice data and filing are outside the change.
3. Run `pnpm --filter @waitron/server exec vitest run src/invoice-email.test.ts src/invoice-delivery.test.ts src/boot.invoice-delivery.test.ts` and the Server typecheck. Retain synthetic SMTP samples so the watcher can show the owner the wording and verify the attachment names before landing. Remove the A1587 reference from the real-box bundle in `docs/backlog/printers.md`. Cite the changed test expectations in the PR.

Expected size is 35–55 added product lines and 20–45 net added test lines. The 25 November real-box handoff, `docs/handoffs/2026-11-25-real-box-session.md:62`, records the owner's “yes” to naming the attachment after the number and putting a real sentence in the message. The Lane E queue at 19:36 records the wording and asks to show it to the owner before landing.
