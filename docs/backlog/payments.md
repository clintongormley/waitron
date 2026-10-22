# Payments and card readers — detail

The open entries are listed in [the backlog](../backlog.md), under "Payments and card readers". This file holds
their full text.

## The Stripe webhook endpoint still has to be repointed by hand, at Stripe

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe.** #378 shortened the
  address from `/webhooks/stripe/<an id>` to `/webhooks/stripe`; the endpoint registered in the
  Stripe dashboard is outside this repository and will keep sending to the old one until somebody
  changes it there. **Next action:** change it in the Stripe dashboard before any card payment is
  taken through a Stripe webhook.

<a id="the-card-refund-path-records-only-after-the-provider-call-with-a-fresh-key-each-time"></a>

## The reconciler's card reversal records only after the provider call, with a fresh key each time

`reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) sends a fresh `randomUUID()`
idempotency key on every call and writes `payment_refunds` only after the call returns, so a
crash between the two leaves no record, and a repeat would send a new key. SumUp's refund sends
no key at all. Its only product caller is the reconciler's reversal of an abandoned order's
capture (`packages/payments-stripe/src/reconciler.ts`); refunding a bill's card payment before
its invoice goes through the separate durable path of Task 14 (design §6b). **Next action:**
give the reconciler's reversal the same durable-attempt rule.
Post-invoice returns use the durable `tender_refunds` path (A737 Part 2): the server records
the request before sending, keeps `tr_<refundId>` on retry and recovers pending outcomes.

## Turn off Stripe's on-reader tip screen, or read the tip back

Backlog only; SumUp is
the go-live provider (owner, 2026-10-21). Waitron takes the tip at the
till and adds it to the amount it charges (`tipOf`, `apps/server/src/till-sale.ts`). It creates
no Stripe Terminal configuration and does not turn the reader's tip screen off:
`processPaymentIntent` (`packages/payments-stripe/src/stripe-client.ts`) sends only the payment's
id. Stripe's docs: "When you process the payment, the reader adds the selected tip. If the
payment is successful, the amount in the `PaymentIntent` and `Charge` updates to include the tip
amount" (https://docs.stripe.com/terminal/features/collecting-tips/on-reader), set up through "a
Configuration object or the Dashboard". So if tipping were switched on in Stripe's Dashboard,
every tipped reader payment would be charged more than Waitron records, the payments check would
report each as a difference, and an orphaned one would be held. Read from the code and Stripe's
docs while planning A846 (the fee question's table in
[the A846 plan](../superpowers/plans/2026-10-19-a846-held-card-payments.md)); not tried against
Stripe. **Next action:** pass `process_config[skip_tipping]=true` from `processPaymentIntent`,
tested against Stripe's sandbox.

## The payments check ignores the currency Stripe reports

`stripeReportClient`
(`packages/payments-stripe/src/stripe-report-client.ts`) reads each balance transaction's
`amount` and never its `currency`. Stripe's docs: "if you charge a customer 10.00 EUR, the
PaymentIntent's `amount` is `1000` and `currency` is `eur`. If this converts to 12.34 USD in your
Stripe account, the BalanceTransaction's `amount` is `1234`, its `currency` is `usd`"
(https://docs.stripe.com/api/balance_transactions/object), and "If the charge currency differs
from your settlement currency … Stripe converts the charge to your settlement currency"
(https://docs.stripe.com/currencies/conversions). Waitron charges in euros, so an account whose
settlement currency is not the euro would make every payment differ. Left open by A846.

## A846's points for the owner at land: held card payments

Each stays open until the owner answers it. "The picture" is
[01-record-what-was-done.png](mockups/a846-held-card-payments/01-record-what-was-done.png)
([dark](mockups/a846-held-card-payments/01-record-what-was-done-dark.png)).

1. **"Kept: the money was owed" leaves money with no invoice.** The payment stays captured on an
   abandoned order with no sale, and Waitron files nothing for it. Whether the money needs an
   invoice is a fiscal question A846 does not answer.
2. **"Next morning" is midnight UTC** (01:00 or 02:00 in Spain), not the venue's business-day
   changeover, so a venue still open then sees the held-payments alert come back during service.
3. **A replaced alert reads "handled by someone"** in the Handled tab when the check replaced it
   because a new held payment appeared. Alternative: a distinct "replaced by a newer alert" line.
4. **The alert's button reads "Go to Card payments"** (the screen's name in the navigation), as
   other alerts' links do, not the picture's "Open Payments".
5. **The outcome is a dropdown, not the picture's two radio buttons**: no radio-group field exists
   among the shared components. Building one is a new shared field with its own tests.
6. **The morning return needs the payments check to get past its Stripe account.** While the
   Stripe credential cannot be used, the check starts and throws in `resolveAccount()`
   (`packages/payments-stripe/src/reconciler.ts`) before reading anything, so a handled
   held-payments alert does not come back; what shows instead is the check's own failure
   (`reconcile.run_failed` and `reconcile.run_parked` log lines, and `/health`'s `parked` count
   and a `duty.degraded` log line for the pass that parks it). The alternative is refreshing the
   held alert before the check resolves its Stripe account.

The Stripe tip screen, the plan's sixth point, is its own entry above.

7. **The alert reads "1 card payments … refund them … with each"** for a single payment: the alert
   wording has no singular form, like the other payment alerts beside it.
8. **The dialog changes width when an outcome is chosen** (244 px empty, 372 px with the longest
   choice at 1280); the picture draws it wide throughout.
9. **At phone width the chosen outcome is cut short**: "Refunded in the card provider's dash…". A
   shorter label for the closed dropdown would avoid it.
10. **On opening, focus lands on the dialog box itself** (a ring round the whole dialog), not on the
    Outcome field.
11. **At 1280 the alert row's buttons wrap** ("Go to Card payments" on three lines), because the
    actions column is drawn as narrow as its content.
12. **No gap under the dialog's order line** before the amounts; the picture leaves one.
13. **The picture's note under the dialog's buttons** ("Waitron refunds nothing itself…") is not in
    the dialog.

14. **The section's introduction does not fit the held list.** It sits under "Bill payments and
    refunds awaiting a card provider", whose sentence says a manager records only the outcome the
    provider confirms, with a note. A held payment is not a bill payment, its note is optional, and
    "Kept" is not something the provider confirms.
15. **The held alert says "closed orders"**, as the picture does, though a payment is held only when
    its order was abandoned; the orphan alert beside it says "closed or abandoned".
16. **A day whose check never succeeds is retried every day, with no cap** (the owner asked for a
    next-day retry).
17. **A payment refunded by staff between the check's two transactions could still be held**: the
    check decides on its first read, as the existing refund-claim path does. Believed rare; not fixed.
18. **A held payment whose order stops being abandoned** would be named by both the difference and
    held alerts (`markOrderPlaced`, `apps/server/src/working-order.ts`, updates by id with no status
    check): reported twice, never hidden. Callers not traced.
19. **The held list leaves `label` out when an order has none**, where its sibling lists send
    `label: null` (`GET /management-api/payments/held`). A one-line change plus its test in
    `apps/server/src/payments-api.held.test.ts`.

## The SumUp Solo experiments

**A949 checkpoint, 2026-10-22:** the replacement credential passed account, reader and transaction
reads. The configured Solo is paired but reports `OFFLINE`. Affiliate credentials are present;
their checkout validity remains untested. History returns separate payment and refund rows;
filtering each type returned the exact expected sets. The original payment's detail agrees by
UUID, transaction code and client transaction id. See the
[authenticated baseline and operator checklist](../research/2026-09-10-sumup-solo-experiments.md#9-a949-authenticated-baseline-2026-10-22).
The 2026-10-21 `401` checkpoint remains historical. No checkout, refund or pairing write was sent.
Published refund units still conflict with September's measurement; keep the adapter unchanged
until the controlled live re-test settles this.

- **The SumUp Solo experiments** ([runbook](../research/2026-09-10-sumup-solo-experiments.md)). Question
  4 was answered on 2026-09-11: a Solo paired to SumUp's cloud cannot also take a payment on its own,
  so the owner chose a separate standalone card machine for the internet-down case
  ([deli hardware](../superpowers/specs/2026-07-30-deli-hardware-design.md) §5). Still open: whether we
  can look up a supplied reference before and after payment, whether a duplicate reference is
  refused, actual reader webhook headers, signature-card handling, and a fresh immediate full
  refund. September's full-refund result is not a measurement of a distinct authorisation void.

## The deli's outage card machine

(the deli hardware design §5). Buy the standalone machine and
replace estimated prices with real quotes. The owner chose three supported cases for A949 on
2026-10-21: automatically match manually recorded payments from a second Solo on the same account
by amount and time, with unmatched payments listed for a manager; identify other providers'
manual payments as paid outside Waitron, carrying the operation number and machine through the
till, day report and accountant exports; and check cash-only service without a backup machine.
Historical API-payment rows are now readable; a standalone-payment sample remains missing.
A barcode scanner only if the deli sells barcoded goods; nothing in the till reads one today.

## The SumUp reconciler

**A949, owner 2026-10-21:** build after the reference experiments establish the matching inputs.
Include the backup-machine contract above and W44's durable reversal attempts: write an attempt
before the provider call, then recover an uncertain outcome without a fresh blind refund. The
[authenticated baseline](../research/2026-09-10-sumup-solo-experiments.md#9-a949-authenticated-baseline-2026-10-22)
records separate payment/refund history rows and working detail lookups. Supplied-reference
creation, standalone matching samples and current refund units remain open; no reconciler was built.

- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human. Note: a SumUp refund appears both as a
  `REFUND` event inside the original transaction (`events` and `transaction_events`, which the
  refund lookup reads) and as its own item of `type: REFUND` in the transaction history listing;
  the original's `status` stays `SUCCESSFUL` (read on 2026-09-27 from three refunded transactions).

## What M7b2 left open (a manager clearing a stuck card payment, #702)

- SumUp has no permanent lock: its sweep resolves every `attempting` row against SumUp, and fails
  one SumUp has never heard of after 15 minutes, with an incident. It leaves a row only while SumUp
  keeps answering PENDING. The manager action refuses a SumUp payment
  (`payment.resolve_unsupported`).
- The add-reader dismissal tests (`packages/payments-sumup/src/dashboard/sumup-add-reader.test.ts`
  and its Stripe twin, `stripe-add-reader.test.ts`) have not been re-measured since #721 made
  both wait for the native dialog's `close` event before counting `onClose`. On a recurrence,
  keep the log.

## Check NFC pick-up on the box's address

On the OnePlus 13, open the installed till at `https://waitron.local`. In Equipment, press
Allow NFC for that address's first permission grant. Close the dialog and tap a registered reader
and portable printer from Counter, Floor, a table's order, payment, Station, Pass and My Schedule.
Check the pick-up notice and Equipment's assignments. Try a printer with no pick-up roles;
its notice must say that no printer role is selected. Try a foreign label and a reader with a
payment already running; neither should change the assignment. Sign out, tap a registered sticker,
and sign in normally: the selection must wait for sign-in. Open a row's QR camera, return to the
list and close the dialog; NFC must resume without a second selection from the same tap. Lock the
phone or leave the app and return, then tap again. Browser tests use simulated readers; these
box-address checks remain unverified. Left open by W102.

## Check NFC sticker writing and locking on the box's address

On the OnePlus 13 at `https://waitron.local`, open a reader or portable printer's Equipment label
in the dashboard. Write a spare unlocked sticker and check its text with the till. Write again
after moving the sticker away to check the retry message. Lock only a disposable sticker after
reading the permanent warning, then try rewriting it. Browser tests use simulated writers; these
box-address write/read/lock checks remain unverified. Left open by W102.

## Check equipment labels on a physical venue printer

On the OnePlus 13 at `https://waitron.local`, open a portable printer's Equipment label, press
Print on a printer, choose that printer and print. Check its job preview, read the paper's QR in
the till dialog, and check the name and code are legible. Repeat for a reader label on a second
active printer. Confirm neither print opens the drawer. Application payload checks do not
establish a physical print; these checks remain unverified. Left open by W102.

## A guest paying from their own phone

(owner idea 2026-09-18, parked — the surface it needs does
not exist). The waiter hands a greeted table a QR code standing for its newly opened tab; the diner
scans it, reads the menu, orders, watches what has been served and what is still coming, and settles
at the end. Two owner decisions were taken while pricing it: **the diner's phone reaches us over the
PUBLIC INTERNET** through the venue's cloud instance, not the restaurant's wifi — which is what lets
a provider call back to say the money arrived; and **Waitron runs SEVERAL payment providers at
once**, routing each payment method and channel to whichever is cheapest for that cell, so this is
never a single-vendor choice. The owner's worked example: Mollie for Bizum, SumUp for card-present,
the online card case still open. Costs of doing that, to weigh rather than wish away: one merchant
account and one settlement reconciliation per provider, and one adapter each to write and keep
working. Prices and receipts:
[2026-09-18-online-payment-providers-bizum.md](../research/2026-09-18-online-payment-providers-bizum.md).
This is now the payment part of [A508](till.md#a508-a-tables-qr-code-order-call-a-waiter-ask-for-the-bill-or-pay);
the ordering surface is A508 and [A509](till.md#a509-online-ordering-for-collection-at-the-counter).

## Routing by BILL SIZE is allowed but is the smallest lever

(owner idea 2026-09-18, arithmetic in
the research note). The card mix moves the crossover further than the bill size does, and the deli's
own mix is a query once it trades, not a research question. Two things to know before building it:
the provider is chosen when the payment page is minted, so the AMOUNT can be routed on and the CARD
CLASS cannot; and a refund must return through whichever provider took the payment. So **method
first**; the variant that earns its keep is card-present, spending SumUp's Tarifa Plana €2 500
monthly allowance first, which needs no second merchant account.

## Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing built

**A949, 2026-10-21:** the Cloud API documents a `WAITING_FOR_SIGNATURE` reader state, but no
signature-required payment was observed. Capture, merchant acceptance and retention ownership
remain open. Follow the physical-card check in the
[experiment checkpoint](../research/2026-09-10-sumup-solo-experiments.md#8-a949-checkpoint-2026-10-21)
before deciding whether Waitron needs a signature step. Keep this entry open.

- **Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing
  built.** When a card or its issuer picks signature as the way it proves the person is who they say
  (the card-scheme term is the Cardholder Verification Method), the payment is only complete once a
  signature is captured, and the merchant is usually expected to keep it in case the payment is later
  disputed. Three things to settle before this is a task, none of them verified yet: (1) whether our
  readers — the SumUp Solo, and Stripe Terminal if it ever comes back — handle the signature entirely
  on the reader and hand us a finished payment, or whether they hand the signature step back to us to
  run on the waiter's screen; (2) if it lands on us, WHERE the signature is captured and kept (an
  on-screen signature pad, or a printed receipt with a signature line the waiter files) and how that
  record is stored and retrieved for a dispute; and (3) whether the fiscal receipt has to show
  anything about it — this is a card-scheme rule, separate from the Veri\*Factu invoice record, so
  confirm the two do not touch before assuming they are independent. Start by reading what the SumUp
  Solo actually does on a signature-required card (it belongs with the SumUp Solo experiments above),
  because if the reader owns the whole step there may be nothing for us to build.

## `finalizeCapture`'s duplicate fallback can show a receipt for an order that is not settled

Left open by A526. When a card payment's last step tries to file the sale and finds a sale already
on the order, it answers that sale's receipt instead of failing (`finalizeCapture`'s catch,
`apps/server/src/till-sale.ts`). The receipt comes from `readSettledTicket`, which reads the sale
and never the order's status (read). So if another writer filed a sale on an order that is still
`placed`, the till is shown a receipt while the card's charge is recorded on no sale.

A526 now refuses the unpaid departure used to reach the fallback before that change. No other
way to reach it is known; it has not been re-run since A526. Next: decide what the fallback does
when the order is not settled (for example, fail and leave the charge for reconciliation rather
than show a receipt).

## Check how real Stripe answers a malformed reader id, and one from another Stripe account

Left open by A519 (#1566). The add-reader route answers `reader.reference_unknown` when Stripe's
library throws `StripeInvalidRequestError` (`packages/payments-stripe/src/card-provider.ts`
`readers.add`), and its tests used a local server pretending to be Stripe answering 404
`resource_missing`. Whether test-mode Stripe answers those two cases the same way is unchecked; a
sandbox case beside `checkout.sandbox.test.ts` would settle it.

## A provider that keeps sending data slowly, or a connection that is slow to open, can take longer

A reader's status and the provider's available readers wait up to 250 seconds. Stripe
gives up on an attempt after 80 seconds of silence once connected and tries three times (stated
in `defaultMakeStripe`, `packages/payments-stripe/src/card-provider.ts`). A provider that keeps
sending data slowly, or a connection that is slow to open, can take longer, since Stripe's limit
is on silence, not on the whole answer. Left open by A255 (#1145, lane A's W18c).

## The W48 test does not measure a real silent provider or the box's HTTP/1.1 connection limit

The SumUp pairing dialog's status reads (`#pollTick` and `#unpairOrphan`,
`packages/payments-sumup/src/dashboard/sumup-add-reader.ts`) are outside the limit, other
screens' reads are not limited, and it was not measured in a real browser against a real silent
provider. Left open by A260 (several card readers' status reads at once can use up the browser's
connections to the box; W18c #1145 and W48 #1162).

## Two concurrent passes over `listAttempting` (`packages/payments/src/store.ts`; its one caller is the SumUp provider's `resolvePending`) do not both succeed

The second pass throws partway instead of skipping the rows the first resolved.
Left open by #558.

## Loose ends left by B28's review (#1005), not acted on, under service Task 17 (#991)

- The reader pay's `tipOf` (`apps/server/src/till-sale.ts`) treats a `null` tip as no tip,
  against CLAUDE.md §3's rule that a default applies only when the field is absent; it predates
  B28, and paying a non-zero bill on the reader is believed to accept it the same way (read, not
  run). Next: a route case sending `tip: null` to `POST /api/pay`, then decide refuse or accept.
- After a free sale settles on the reader, a stale card-attempt mark on the order is left in
  place; manual Pay is believed to leave it the same way (read, not run).

## A875. Check two writes the bill payments design says a pending card refund refuses

The
design's §8 test 17 lists "a move" among the writes refused `bill.refund_in_progress`, and §5.2
lists "transfer". Read, not run (A847's review, #1860): neither moving guests nor moving a bill
appears to check for a pending refund, and the test covering test 17 makes no move; a transfer
between bills appears to be refused earlier, `bill.payments_received`, because the refunded
payment is still on the bill. Next: one route case each during a pending refund, then fix the
design's wording, or the code if a move can change what a bill charges (ask the owner first).

## The next identical bill payment can be answered with one that got a server error

(narrowed
by A796). A payment that got no answer, or is still being sent, now holds the bill on its locked
confirmation (A773-1, #1897, and A796). What is left: a first send answered with a 5xx or an
error with no code keeps its submission without holding the bill (`unansweredAfter`,
`apps/till/src/state/bill-payment.ts`), so if the server did record it, the next
identical payment on that bill from this phone reuses its id (`submissionFor`, same
file) and the server replays the first (`beginBillPayment`, `apps/server/src/bill-payments.ts`):
the second guest's payment is never recorded. A796's plan ran the scratch case (a contribution
refused `server.internal` with status 502 left the dialog unlocked) and chose not to hold the
bill, because a server that kept failing would hold it for good (plan, decision 1, B5).

## Check first: on a venue with no fiscal module, replaying a settled bill may throw

(read, not
run; found by A796's Task 23 review). `readSettledTicket`, which rebuilds the ticket for a
replay, throws when the backend has no filed record (`apps/server/src/till-sale.ts:840-846`),
and the no-fiscal backend's `filedReceiptFor` always answers `undefined`
(`packages/fiscal-none/src/backend.ts:67`). First run a replay on such a venue to see whether it
is reached.

## On a venue with no fiscal module, a handheld shows the ticket view after a presented bill is paid, not the paid screen

(known limit of A796; read, not run). The paid screen shows only for
an `F2` result (the `paid` check in `apps/till/src/till-app.ts`), and the presented path takes its invoice
type from `readReceiptIssuer`, which returns none when the backend has no filed record
(`apps/server/src/receipt-issuer.ts:8-9`).

## A793 — tips: who a tip belongs to, how it is shared out, and what payroll gets

NOT APPROVED: the owner (2026-10-18, on Q38): "Leave this for now. Back to the backlog. It needs a
bigger brainstorm." Next: that brainstorm with the owner, before any build or further question.
A first design is kept as input ([design](../superpowers/specs/2026-10-18-a793-tips-design.md), pictures in
[mockups/a793-tips/](mockups/a793-tips/), research in
[compliance/research/2026-10-18-a793-tips.md](../compliance/research/2026-10-18-a793-tips.md)); not
built. A shared pot per business day split by hours clocked (kitchen included) or each person
keeping their own, chosen on a new Tips tab in Venue settings that also replaces
`WAITRON_TILL_TIPS`; cash tips handed out at the day's close (once a close counts the drawer,
A239, and the asesor's L6(g) allows it), card tips paid with wages; a Tips page under Team by day
and by pay period, frozen when a pay period closes (once the product has a step that closes one).
The first design had six build slices (its §7), the first a fix (next entry). Replaces the old "Tip-collection UI" entry: cash and
typed-card tips already arrived with bill payments (#956).

## A whole-order card payment does not refuse a negative tip

(found by A793's design, read, not
run). With tips on, a request that did not come from the till's own form (which refuses it) can
carry `tip: "-5.00"`: `POST /api/pay` never checks `tip` (`apps/server/src/till-api.ts:1682-1737`)
and `decimal()` accepts it (`packages/shared/src/money.ts:14-25`), so the reader would be asked for
the bill less €5.00 and the tender would then fail its `tip_amount >= 0` check after the card was
charged.
A tip with more than two decimals is not checked either; the bill payment routes refuse both
(`apps/server/src/bill-payments-api.ts:32`). Next: a route case sending `tip: "-5.00"`, then refuse
it before the reader is asked. A793's slice 1. Full review (money).

## A whole-order payment records the amount it expected, not the amount captured

(found by A793's
design, read). A capture that differs from bill plus till tip is written as bill plus till tip
(`apps/server/src/till-sale.ts:1568`, and `:1879` for an order already placed); only the recovery
path reads the captured amount and calls the excess a tip. The only cause found is a reader whose
own tip screen was switched on outside Waitron; other causes were not checked. Next: compare the captured amount at capture time, as the bill payment loop does
(`payment.bill_capture_mismatch`).

## An offline card payment that forwarding moved to `settled` with no sale no longer holds its placed order

Once no card payment of the order runs in this process, a collect is accepted
(`ordersWithUnfiledPayment`, `apps/server/src/till-sale.ts`, counts no `settled` row). A526's
review measured it with `FakePaymentProvider.forward`; of the adapters, only
`StripeOnDeviceProvider`, which no app builds, settles forwarded rows. Left open by A526.

## Lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive

SumUp's
older `refund` call still parses a 2xx or 4xx body as JSON
(`packages/payments-sumup/src/sumup-client.ts`, `refund` through `call`), so a 404 answered with
an HTML page throws `SyntaxError`. Its one caller is `reverseViaSumUp`; fold it into the neutral
reversal primitive. Left open by A632.

## A placed order with no invoice is not checked against stored card payments when it is cancelled

Its cancel sees a card running at the reader in this process, but not a stored
payment its provider has not resolved, nor one captured and not yet filed; the cancel had no
payment check at all before C126. (Its collect, card payment and unpaid departure do check both
since A526.) Left open by C126 (cancelling an order whose invoice was issued credits it, #1030).

## A payment whose read shows it settled the bill needs one press of Comprobar de nuevo to show the ticket

A bill read that lists a held payment frees the bill, except when that payment
settled it: the locked confirmation stays, and its Comprobar de nuevo replays the payment and
shows the ticket (`apps/till/src/till-app-bill-payments.test.ts`, "keeps the locked
confirmation when the payment settled the bill, and Comprobar de nuevo shows the ticket").

## Three small tip display gaps

(found by A793's design, read): the dashboard's order detail shows
a bill payment's applied amount without its tip (`apps/dashboard/src/widgets/order-detail-dialog.ts:398`);
the card slip's words are fixed Spanish (`apps/server/src/payment-slip.ts:55-59`); and the Spanish
refund slip says "Propina" where the English says "Tip returned"
(`apps/server/src/tender-refund-receipt.ts:79-92`).

## A848. Show a clear message when the till pays, sends or moves an empty order

`#onPayTab`
(`apps/till/src/till-app.ts`) shows `sale.error` for any server code it does not name, which
hides `sale.empty_basket`. On the till, try paying, sending and moving an empty order; where no
clear message shows, add one in English and Spanish. Done when each of the three has been tried
and shows a clear message.

## Task 4 (#832, every paper names all of a party's tables)

Not yet checked: the payment API's
`/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
`/management-api/payments/bill-refunds` queries (`apps/server/src/payments-api.ts`), which read
the same column. Left open by the table actions plan.
[Detail](till.md#tables-parties-and-bills--the-tills-table-actions)

<a id="slice-2--the-handheld-nfcqr-link"></a>

## Decisions and deliberate limits

- **Handheld reader selection** (owner decisions 2026-09-18)
  ([2026-09-18-handheld-and-till-hardware-decisions.md](../superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §2–§3): the waiter carries the reader to the table and settles there; pairing is an NFC sticker, a
  printed QR sticker, or **a dropdown, which is the fallback that always exists and should be built
  first**. Readers are SHARED between waiters, so the tap and the scan are for confirming which
  reader is in your hand, not for speed — a remembered reader is offered, never auto-selected. Web
  NFC is Chrome-for-Android only; the browser's own QR decoder is not dependable, so decode in JS or
  WASM. Also here: restoring `stripe_on_device` (Tap-to-Pay). Redsys and
  bank terminals are parked; Bizum research is under _Later and parked_.
  W100 (#1332) changed one choice: a card reader has one holding device at a time, and a scan
  or confirmed dropdown choice moves it to the waiter's device. The owner kept W100's defaults
  ([till decisions](till.md#device-equipment-defaults-w100-1332-owner-kept-every-default-2026-10-07)).
  A796 (#1921) carries the phone's last-chosen reader and receipt printer, folded away; the folded
  row has a scan button, and background NFC pick-up updates the open form. Tap-to-Pay and the
  physical box-address checks above remain open.
  [A796 design](../superpowers/specs/2026-10-19-a796-handheld-payments-design.md).

- **Joining and unjoining tables stay allowed while a card refund of a bill is pending** (owner,
  2026-10-17, A847). Bill payments design §5.2; test:
  `apps/server/src/table-actions.refund-pending.test.ts`.

- **An orphaned card payment whose settled amount differs from ours is held, never forgotten**
  (owner, 2026-10-17). It is never refunded automatically while the amounts disagree; its alert
  stays up and reminds daily until a person resolves it, and the sweep re-checks closed periods for
  orphans still unresolved. Built by A846, as the owner refined it in answering Q44 on 2026-10-18
  (recorded in [the A846 plan](../superpowers/plans/2026-10-19-a846-held-card-payments.md)):
  the reminder is an ordinary alert that can be marked handled and comes back the next morning
  while any held payment has no outcome, not one that cannot be dismissed; and a manager closes a
  held payment by recording an outcome in the Payments screen's held list.

- **Uncertain Stripe reader payments stay unknown** (owner, 2026-10-16, A764).
  Check them automatically after collection ends; keep the order locked until the outcome is known.
  Retain the manager check as a fallback. A confirmed cancellation advances the next attempt's key;
  a bank decline keeps its existing retry key. Automatic resolution has no person in its audit row.
  Collection ownership is process-local. The provider sweep runs in every node role; only sale
  recovery and bill completion check for primary. Before enabling a second venue node, restrict
  provider cancellation to its collection owner or add coordination between nodes. Today's venue
  has one node (CLAUDE.md §5); this is not a claim of protection across nodes.
  [Implementation plan](../superpowers/plans/2026-10-17-a764-stripe-unknown-outcome.md).

- **A printer's pick-up roles are a printer setting, never sticker content** (owner, 2026-10-12,
  W102 part 0). The QR label and NFC text carry only the equipment kind and id. A general pick-up
  uses the saved set; a scan for one row uses only that row. The default is receipt and payment
  slip. The cash drawer is outside this set. You can select None to leave assignments alone on a
  general pick-up; row scans remain available.
  When A508 adds the table-QR-code role, extend the printer setting's options and its multi-role
  summary together.

- **An equipment NFC sticker holds a text record, not a web address** (owner, 2026-10-12, W102).
  On the OnePlus 13 probe, a web-address sticker tapped while the installed till was not in front
  reloaded the till with that address, discarding what it showed, and Chrome 154 ignored the
  manifest setting meant to prevent it. A web address also ties the sticker to one address that a
  later move to the cloud would not follow. A text sticker tapped then brings up Android's own tag
  viewer instead. [Results](../research/2026-10-12-nfc-probe-oneplus-13.md).

- **A placed order takes one card payment at a time** (A526, 2026-10-12; defaults sent to the owner
  as an FYI the same day and built). While a card payment of a placed order is in flight — running
  in this process, still `attempting` at its provider, or captured (or accepted offline) and not yet
  on a sale — a cash or hand-keyed card collect of the order, a second card payment of it and an
  unpaid departure of the party it belongs to are refused `order.payment_in_flight`, writing
  nothing. Pressing Pay again to file a card that was already charged is never refused, even from
  another till and even while that card's own payment has not yet filed it: it files that charge and
  asks no reader. A till on another payment provider is refused until the charge is filed, by the
  original payment's own last step or by a Pay from a till on the provider that took it. A request
  that arrives after the order is settled gets its receipt back, as a retry after a lost answer must
  (so a cash collect after the card settled answers the card's receipt). After a reader timeout,
  cash waits while the provider reports the card pending: with SumUp, for as long as SumUp answers
  PENDING, and up to 15 minutes when SumUp has no record of the payment. Plan:
  `docs/superpowers/plans/2026-10-12-a526-placed-order-one-payment.md`.

- **A reader still paired at a provider that can unpair it (SumUp) is deleted in Waitron only
  while that provider's account is not connected** (owner, 2026-10-10), after the confirmation says
  it stays registered there.
  While the account is connected, a SumUp unpair call that fails, a rejected key included, still
  answers `reader.unpair_failed` and leaves the reader switched off: a rejected key is found only
  when Delete is pressed, because the impact read calls no provider, so the confirmation could not
  say so beforehand; disconnecting and connecting again with a working key fixes it (Disconnect
  needs every SumUp reader switched off first), and the delete then unpairs; and a rejected key and
  an outage answer alike, told apart only in the log (`reader.unpair_failed`'s `logReason`).
  Plan: `docs/superpowers/plans/2026-10-10-a435-3b-reader-delete-disconnected.md`.

- **SumUp's card-present price is a plan choice, not a rate** (owner supplied the table, 2026-09-18).
  Tarifa Plana (€25/month, 0 % up to €2 500/month of Spanish debit/credit, then 0,79 %) is the plan to
  assume and beats Stripe Terminal on a Spanish card, so SumUp is **confirmed for the card-present
  seat**. SumUp's online rate (1,95 % on every plan) keeps it a weak candidate for the guest's own
  phone.
