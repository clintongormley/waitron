# A554. Show where an invoice was emailed

Staff who can email a full invoice can check its recorded email address in **Find a bill** and **Orders → View details**, including after a refused send. On 24 November 2026 at 22:05, the owner answered question 9, “Yes, in Find a bill and Orders (Recommended)”. The chosen option limits visibility to people who may send it again.

## Read the recorded address

- In `apps/server/src/invoice-delivery-status.ts`, use the email rows already read by `deliveryStatus` to add optional `invoiceRecipientEmail` to `InvoiceDeliveryAttempt` when the caller requests it. Share the recorded destination at every email outcome. Keep `rowAttempt`, used for send and retry replies, address-free. Register the field with `maskEmail` in `log-personal-data.ts`.
- In `orders-api.ts` and `orders-list.ts`, opt in using the scoped dashboard session's `report.export` permission. In `till-sale-receipt-routes.ts`, opt in on the full invoice's bill delivery read when the profile permits `print-receipt` and `assertRequestDevice` proves the same device. Check proof once before the read lock, withholding the address on `device.unauthorized`; both claim-expiry branches use the same result. Preserve order scope and zone checks. Permission allows reading past attempts even when mail is unavailable. The simplified receipt email read (`?medium=email`) and orderless transaction reads stay outside A554.
- In `orders-invoice-deliveries.test.ts` and `till-api.deliveries.test.ts`, first fail a check for the address on an authorized read, including a retryable refusal. In the privacy checks, preserve every no-address assertion for writes and logs. Assert absence in current and history on restricted reads, testing the dashboard's export permission and the till's capability and matching proof. In `logger.test.ts`, check masking with a real-looking test address and extend the existing per-key fixture. Run the personal log parameters guard.

## Show the address where staff need it

- Mirror the optional field in both `api/client.ts` files and correct the dashboard retry comment. In `apps/dashboard/src/widgets/order-detail-dialog.ts`, add the address as text on its email history line for `mayExport`. In `screens/till-ticket-view.ts`, show the latest email attempt's address for a full invoice and `canPrintReceipt`, labelled as the last email address beside the existing status. The settlement dialog overrides that display. Use both `i18n/strings.ts` files. The email forms keep their current presentation.
- Start with failing checks in `order-detail-dialog.delivery.test.ts`, `till-ticket-view.test.ts` and `till-app.test.ts`. Match an address to its own dashboard history row and keep it hidden for a viewer without export permission. The till view tests cover an authorized full invoice, missing capability and a simplified receipt. Test the post-payment dialog's omission in `settlement-document-dialog.test.ts`. Exercise both **Bills** and **Transactions** through the app, with the address beside **Send the email again** in Bills. Run the changed test files and look at both details in Chromium at phone width, in both languages and themes.
- Update the English and Spanish `table-service.md` and `data-protection.md` guides, including who can see the address and what to check after a misdirected invoice. Remove the two A554 backlog entries and add a dated pointer by the old A739 no-address decision.

The send forms still open empty. This uses the existing storage, sending and fiscal records. Estimate 105 production lines, 175 test lines and 25 guide and backlog lines across about 20 files.

Claude reviewed the plan. The watcher cleared it on 25 November 2026 at 03:18 with the plain ticket
and settlement dialog split above, and asked for the simplified receipt limit to be named in the PR.
