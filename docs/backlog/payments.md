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

- **The reconciler's card reversal records only after the provider call, with a fresh key each time.**
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

- **Turn off Stripe's on-reader tip screen, or read the tip back.** Waitron takes the tip at the
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

- **The payments check ignores the currency Stripe reports.** `stripeReportClient`
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

From the look at the screens in a real browser (both themes, 1280 and 390 px wide; no defect
against the design system was found; report kept outside the repository):

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

From the pre-merge review:

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

**A949 checkpoint, 2026-10-21:** every read-only request with the saved API credential returned
`401`, including memberships, readers, reader status, history and transaction lookup. An invalid-key
control also returned `401`; reader permissions and availability were not established. The saved
experiment file has no affiliate credentials. No checkout, refund or pairing write was sent. See the
[probe results and operator steps](../research/2026-09-10-sumup-solo-experiments.md#8-a949-checkpoint-2026-10-21).
The current published refund description explicitly uses major units, conflicting with §4b's
September cents measurement; the adapter's three fake-HTTP wire checks still pass with cents.
Keep the adapter unchanged until the controlled live re-test settles this.

- **The SumUp Solo experiments** ([runbook](../research/2026-09-10-sumup-solo-experiments.md)). Question
  4 was answered on 2026-09-11: a Solo paired to SumUp's cloud cannot also take a payment on its own,
  so the owner chose a separate standalone card machine for the internet-down case
  ([deli hardware](../superpowers/specs/2026-07-30-deli-hardware-design.md) §5). Still open: whether we
  can look up a supplied reference before and after payment, whether a duplicate reference is
  refused, actual reader webhook headers, signature-card handling, and a fresh immediate full
  refund. September's full-refund result is not a measurement of a distinct authorisation void.

## The deli's outage card machine

- **The deli's outage card machine** (the deli hardware design §5). Buy the standalone machine and
  replace estimated prices with real quotes. The owner chose three supported cases for A949 on
  2026-10-21: automatically match manually recorded payments from a second Solo on the same account
  by amount and time, with unmatched payments listed for a manager; identify other providers'
  manual payments as paid outside Waitron, carrying the operation number and machine through the
  till, day report and accountant exports; and check cash-only service without a backup machine.
  Live history and standalone-payment samples remain unavailable at the experiment checkpoint.
  A barcode scanner only if the deli sells barcoded goods; nothing in the till reads one today.

## The SumUp reconciler

**A949, owner 2026-10-21:** build after the reference experiments establish the matching inputs.
Include the backup-machine contract above and W44's durable reversal attempts: write an attempt
before the provider call, then recover an uncertain outcome without a fresh blind refund. The
[experiment checkpoint](../research/2026-09-10-sumup-solo-experiments.md#8-a949-checkpoint-2026-10-21)
records the refused credential and the unresolved refund-unit discrepancy. No reconciler was built
by that checkpoint.

- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human. Note: a SumUp refund appears both as a
  `REFUND` event inside the original transaction (`events` and `transaction_events`, which the
  refund lookup reads) and as its own item of `type: REFUND` in the transaction history listing;
  the original's `status` stays `SUCCESSFUL` (read on 2026-09-27 from three refunded transactions).

## What M7b2 left open (a manager clearing a stuck card payment, #702)

- **What M7b2 left open (a manager clearing a stuck card payment, #702).**
  - SumUp has no permanent lock: its sweep resolves every `attempting` row against SumUp, and fails
    one SumUp has never heard of after 15 minutes, with an incident. It leaves a row only while SumUp
    keeps answering PENDING. The manager action refuses a SumUp payment
    (`payment.resolve_unsupported`).
  - Flaky: `packages/payments-sumup/src/dashboard/sumup-add-reader.test.ts`, "calls onClose when
    the dialog is dismissed with Escape", failed once in a run beside two coverage runs and passed
    three times alone (2026-09-26); its Stripe twin, `stripe-add-reader.test.ts`, was logged failing
    about one whole-package run in three (2026-09-27). #721 made both wait for the native
    dialog's `close` event before counting `onClose`. Neither has been re-measured since; on a
    recurrence, keep the log.

## Slice 2 — the handheld NFC/QR link

- **Slice 2 — the handheld NFC/QR link.** Owner decisions 2026-09-18
  ([2026-09-18-handheld-and-till-hardware-decisions.md](../superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §2–§3): the waiter carries the reader to the table and settles there; pairing is an NFC sticker, a
  printed QR sticker, or **a dropdown, which is the fallback that always exists and should be built
  first**. Readers are SHARED between waiters, so the tap and the scan are for confirming which
  reader is in your hand, not for speed — a remembered reader is offered, never auto-selected. Web
  NFC is Chrome-for-Android only; the browser's own QR decoder is not dependable, so decode in JS or
  WASM. Also here: restoring `stripe_on_device` (Tap-to-Pay). Redsys and
  bank terminals are parked; Bizum research is under _Later and parked_.
  _2026-10-07: the printed QR sticker and the dropdown landed with W100 (#1332;
  its owner questions were answered 2026-10-07, every default kept: [till.md](till.md#device-equipment-defaults-w100-1332-owner-kept-every-default-2026-10-07)).
  One difference from the decision
  above: a card reader now has one holding device at a time, and a scan or a confirmed choice from
  the dropdown moves it to the waiter's device. NFC (W102) and Tap-to-Pay are still open._

_2026-10-14: the NFC implementation is in place. The box-address checks below remain open,
along with Tap-to-Pay._

_2026-10-19: the handheld payment flow is designed as A796 and revised to the owner's answer (no
reader question; the form carries the phone's last-chosen reader and receipt printer, folded away).
On 2026-10-19 the owner answered the six questions Revision 3 asked, and Revision 4 writes them in, with a
scan button on the folded row and the till's background NFC pick-up updating the open form;
none is open, and the build is to be planned as its own item:
[2026-10-19-a796-handheld-payments-design.md](../superpowers/specs/2026-10-19-a796-handheld-payments-design.md)._

_2026-10-21: the handheld payment flow is built as A796 and landed
([#1921](https://github.com/clintongormley/waitron/pull/1921)). What it left open, Tap-to-Pay
included, is in [backlog.md](../backlog.md), _Payments and card readers_._

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

- **A guest paying from their own phone** (owner idea 2026-09-18, parked — the surface it needs does
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

- **Routing by BILL SIZE is allowed but is the smallest lever** (owner idea 2026-09-18, arithmetic in
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

What was measured: the plan's fresh-context reviewer, on the code before A526 (2026-10-12), held a
presented bill's card at the reader and recorded an unpaid departure for its party. The departure
filed an invoice and recorded the bill as unpaid; when the card was released, `/api/pay` answered
"captured" with a receipt, but the payment row stayed captured with no sale and the order stayed
`placed`. A526 now refuses that departure, so the fallback is reachable that way no longer; it
would be again by any sale written on an order that is not settled. Not re-run since A526. Next:
decide what the fallback does when the order is not settled (for example, fail and leave the charge
for reconciliation rather than show a receipt).

## Check how real Stripe answers a malformed reader id, and one from another Stripe account

- **Check how real Stripe answers a malformed reader id, and one from another Stripe account** —
  left open by A519 (#1566). The add-reader route answers `reader.reference_unknown` when Stripe's
  library throws `StripeInvalidRequestError` (`packages/payments-stripe/src/card-provider.ts`
  `readers.add`), and its tests used a local server pretending to be Stripe answering 404
  `resource_missing`. Whether test-mode Stripe answers those two cases the same way is unchecked; a
  sandbox case beside `checkout.sandbox.test.ts` would settle it.

## A provider that keeps sending data slowly, or a connection that is slow to open, can take longer

- **A provider that keeps sending data slowly, or a connection that is slow to open, can take
  longer** — a reader's status and the provider's available readers wait up to 250 seconds. Stripe
  gives up on an attempt after 80 seconds of silence once connected and tries three times (stated
  in `defaultMakeStripe`, `packages/payments-stripe/src/card-provider.ts`). A provider that keeps
  sending data slowly, or a connection that is slow to open, can take longer, since Stripe's limit
  is on silence, not on the whole answer. Left open by A255 (#1145, lane A's W18c).

## The W48 test does not measure a real silent provider or the box's HTTP/1.1 connection limit

- **The W48 test does not measure a real silent provider or the box's HTTP/1.1 connection limit.**
  The SumUp pairing dialog's status reads (`#pollTick` and `#unpairOrphan`,
  `packages/payments-sumup/src/dashboard/sumup-add-reader.ts`) are outside the limit, other
  screens' reads are not limited, and it was not measured in a real browser against a real silent
  provider. Left open by A260 (several card readers' status reads at once can use up the browser's
  connections to the box; W18c #1145 and W48 #1162).

## Decisions and deliberate limits

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
