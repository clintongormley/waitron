# Part payments and an unanswered card payment

For a table bill, use **Pay items** for particular dishes, **Contribute** for an amount
towards the bill, or **Split equally** for the people still to pay. Review the amount applied,
tip and change before taking payment. **Split by item** creates another bill; **Pay items**
keeps the payment on this bill.

These are the current table-payment actions. The separate payment-window and bill/table
redesigns remain pending until their implementations land.

## Check the same payment after a lost answer

Choose **Check again** before taking payment again. If the card outcome remains unknown,
ask a manager to open **Card payments** in the dashboard. Check the listed payment with
its provider. If the answer remains unclear, keep the bill unresolved and check the provider's
transaction or ask its support.

For example, losing the page's reply after the customer uses the reader does not tell you
whether the provider took the money. Check that transaction before asking the customer to pay again.

## Record a confirmed provider outcome

First check the specific payment or refund in the provider's dashboard or with its support.
An empty dashboard or unchanged total is insufficient.

Choose **Record confirmed outcome**, select the confirmed result, enter the
provider-confirmation note and manager PIN, then save. Recording a confirmed result describes
what happened at the provider; it is not a request to take or refund money.

## Resolve a held payment with a different amount

Under **Held: paid out at a different amount**, compare the two amounts and establish what
happened outside Waitron. Choose **Record outcome**, then **Refunded in the card provider's
dashboard** or **Kept: the money was owed**. Add a note if useful, enter the manager PIN and
choose **Record**. Recording the outcome does not refund money.

For an ordinary refund, follow [table service](../../apps/server/src/guide/en/table-service.md)
rather than using an outcome record as a refund action.

## Implementation references

The [table screen](../../apps/till/src/screens/till-table-order-screen.ts) and
[payment dialog](../../apps/till/src/widgets/bill-pay-dialog.ts) supply the payment choices.
The [Card payments screen](../../apps/dashboard/src/screens/payments-screen.ts) supplies
provider checks, confirmed outcomes and held-payment records. Their labels and required
confirmation wording live in the [till](../../apps/till/src/i18n/strings.ts) and
[dashboard](../../apps/dashboard/src/i18n/strings.ts) strings.
