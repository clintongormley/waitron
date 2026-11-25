# Print a full invoice again from the till

After the office printer stops answering, the Customer document window names the A4 printer that received the full invoice, says to check whether it printed, and offers **Print it again**. This works on the handheld that paid the bill even if that printer is absent from its equipment list. The picker still lets staff choose another printer. The window follows delivery by itself, including email. The invoice delivery alert opens that invoice in Orders.

The owner agreed to the till drawing in the 25 November real-box session. The power-cut trial used a bill prepared on the Mac and paid on a handheld with no A4 assignment. Orders printed the existing invoice as the original when the HP returned. The queue records the agreed drawing and the separate Orders remarks.

## 1. Offer the printer that received the invoice

In `apps/server/src/invoice-delivery-status.ts` and `till-sale-receipt-routes.ts`, use the latest failed or uncertain A4 original to offer its active A4 printer alongside the usual device choice. Use the saved delivery's printer, scoped to the sale already checked by the route. Share the offer between the existing till status read and print request. Keep receipt role resolution and the equipment list as they are. Keep the existing device and zone checks, active-delivery refusal, repeat-request handling and original/copy decision in `requestPrintDelivery` and `reserveInvoiceDelivery`.

Start in `apps/server/src/till-api.deliveries.test.ts`. Prepare the bill with a different till's A4 printer, end the print without confirmation, then prove the paying till can read the offer and queue an original on the same printer. Check that it cannot send to another off-list A4 printer, or retry the saved printer once it is disabled. Inspect the queued job and its designation. Reuse the existing tests for completion, competing delivery and repeated requests.

## 2. Show the destination and follow the delivery

Use the existing controls in `apps/till/src/widgets/settlement-document-dialog.ts` and `screens/till-ticket-view.ts`. Start with the delivery's A4 name and use that printer for **Print it again**. Keep the delivery history separate from the picker, so an explicit, confirmed choice can change the next destination. Use the existing print action in `till-app.ts` and keep printing disabled until a pending printer change settles. Use the existing delivery reread for waiting A4 and email attempts. In Customer document, remove **Check print status** when showing a full invoice. Use the uncertain heading for an unknown A4 attempt as well as a reported late success, and give the printer-specific instruction in `i18n/strings.ts` in English and Spanish.

In `apps/till/src/till-app-settlement-documents.test.ts` and `till-app.invoice-printer-choice.test.ts`, drive the open window from queued A4 through uncertain to retry, and from queued email to sent, without a manual read. Check the visible destination, heading, button and request printer ID, including after a successful picker change. Update the English and Spanish `table-service.md` guides and check the window in both languages and themes at phone and desktop widths.

## 3. Open the invoice from its alert

In `apps/server/src/alert-sources.ts`, carry the working order ID for a bill or the sale ID for a transaction in the existing invoice alert. In the dashboard's `widgets/alerts-bell.ts`, `screens/alerts-screen.ts`, `dashboard-app.ts` and `screens/orders-screen.ts`, pass the named target to the existing order detail dialog and use its permission-checked by-ID read. Keep other alert links working. Use `alert-sources.invoice-delivery.test.ts` to pin the target ID and `dashboard-app.test.ts` to open it from Go to Orders independently of list filters.

Prepare a picture of Orders closing its print window and showing that the invoice was sent. Bring that choice to the owner before changing the Orders print window. Print Queue changes belong to A1583 and A1588. This change uses the filed invoice and existing delivery records, with no schema changes. Remove the A1582 backlog references when the agreed behavior works. Allow about 155 product lines and 140 test lines plus guides. Run the focused tests and two Claude run-it reviews before handing the green branch to the owner to land.
