# Print a full invoice again from the till

When the office printer stops answering, the Customer document window names the A4 printer, says to check whether it printed, and offers **Print it again**, including on a paying till with no A4 assignment. Staff can choose another printer. The window follows delivery, including email. The invoice delivery alert opens that invoice in Orders.

The 25 November real-box handoff records the owner’s “yes” to the till drawing. Lane I’s A1582 queue quotes the drawing and calls for the alert link. The Orders print window after sending is a separate picture proposal for the owner.

## 1. Retry an uncertain A4 original

In `apps/server/src/invoice-delivery-status.ts`, use the existing printer join to offer a distinct retry action for the paying till when the current attempt is an uncertain or failed A4 original that was not switched to another medium, its saved A4 printer is active, and the invoice has neither a completed original nor a delivery in progress. Keep the device’s existing printer offer and receipt role resolution. In `till-sale-receipt-routes.ts` and `invoice-delivery-actions.ts`, accept that same retry destination through the permission- and zone-checked sales print route. Keep the current request key, reservation and original/copy rules. A new attempt, a known completion (including a late success) or a disabled printer ends the extra offer.

Use `apps/server/src/till-api.deliveries.test.ts` to prove the paying till can read and queue the original to an A4 printer picked on another till. Check that an unrelated or disabled office printer is refused and that completion ends the extra offer. After an unreachable retry, the till must offer the same original again. Inspect the queued job and its designation.

## 2. Follow it in Customer document

Add the optional retry action to `apps/till/src/api/client.ts`. In `widgets/settlement-document-dialog.ts` and `screens/till-ticket-view.ts`, show the saved A4 printer through printing and completion. Prefer it until a choice resolves to another printer for this opening. An inherited choice that resolves to None leaves the saved printer available. Use the current `till-app.ts` save guard for the ordinary device offer and keep a pending choice from printing. In Customer document for a full invoice, replace **Check print status** with the existing timed read and live updates. Retry failed reads while the document is open, including the first read, and update the relevant English and Spanish messages in `i18n/strings.ts`.

The heading currently tests late success and misses `unknown`. Use the uncertain heading for the current unknown attempt, including email. Say the printer stopped answering only on timeout without a hold. Keep the held wording and ask staff to check the paper for other uncertain A4 outcomes. Find bill and transactions without a bill keep their current controls. Move the ticket read routing out of `till-app.ts` and delivery wording out of `till-ticket-view.ts` into `screens/ticket-delivery.ts`. Keep `till-app.ts` within its measured cap.

Use `till-app-settlement-documents.test.ts`, `till-app.invoice-printer-choice.test.ts` and `settlement-document-dialog.test.ts` for the open picker with no A4 setting or a different default, the saved choice and sent printer ID, and automatic recovery from a failed read through A4 uncertainty, a later A4 completion and email completion. Check the timeout and hold words at the view. Replace manual status events in existing full-invoice window tests with the box’s live changes. Update `guide/{en,es}/table-service.md` and check both themes and languages at phone and desktop widths.

## 3. Open the invoice from its alert

Add the bill ID, or the sale ID for a transaction, to existing invoice alert parameters in `apps/server/src/alert-sources.ts`. Pass it through `widgets/alert-format.ts`, `widgets/alerts-bell.ts` and `screens/alerts-screen.ts` in the dashboard. Follow `dashboard-app.ts`’s existing product link with an Orders URL parameter read by `screens/orders-screen.ts`. Use its scoped detail read and clear the parameter on close or when leaving Orders. Check the payload in `alert-sources.invoice-delivery.test.ts` and the exact invoice opening twice from an alert in `dashboard-app.test.ts`, independent of list filters.

Prepare the Orders close-and-confirm picture for the owner before any change to that window. Preserve that open choice when removing the finished A1582 backlog references. Print Queue belongs to A1583 and A1588. Allow about 230 changed product lines and 80 relocated lines, and about 280 test lines including updated assertions, plus guides. If the alert link puts the three-hour pull request budget out of reach, open it in a second pull request. Run focused tests and two Claude run-it reviews. The owner lands the green branch.
