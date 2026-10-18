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

## A846. Held card payments: what the check found, and what to build

A held payment is an orphan (a card payment whose order was closed or abandoned with no sale) whose
amount the card provider paid out differs from ours, so the sweep will not refund it
(`amountDrifted`, `packages/payments/src/reconcile.ts`).

Measured 2026-10-18 with a throwaway test in `apps/server` (kept outside the repository) that ran
the real scheduler (`runDue`), `reconcilerAsDuty` and `reconcilePayments` with `recordIncidentOnce`
over a fake settlement report, one payment captured at €10.00 and paid out at €12.50:

- **One held payment works today.** Day 1 raised `payment.reconcile_orphan` (remediation
  `amountDrifted`) and `payment.reconcile_drift`. Both were marked handled; the next day's
  re-sweep of the same, already-checked day raised both again. Left open, each stayed one alert,
  and the re-sweep chain went on daily. Nothing was refunded.
- **A second held payment stayed out of every alert.** Held payments on 1 and 2 July, every open
  alert marked handled each morning: on four days running the open orphan alert named only the
  first. Every orphan alert shares one key (the payment check, no device, no sale), the older
  day's re-sweep runs first, and while the first stays held it takes the key every day.
- **A failed check ended the re-check for good.** The provider failed three checks in a row (about
  45 minutes at the default back-off): the re-sweep was marked `parked`, and no later day checked
  that day again. The held payment was then in no open alert. A first check that parks is never
  retried either.
- **Nothing lets a person close a held payment.** The payment stays `captured` on an abandoned
  order. Stripe is the only provider with a reconciler, and its sweep compares each charge's own
  gross amount, read from `type: "charge"` balance transactions alone (`listSettlements`,
  `packages/payments-stripe/src/stripe-report-client.ts`). A refund made in Stripe's own dashboard
  is, I believe, a balance transaction of its own that this read never lists, so the figures would
  still differ and the daily reminder would never stop. Not tested against Stripe.

Proposed build (owner question Q44 decides the first two points):

1. A "Held: paid out at a different amount" list in the Payments screen's section for stuck bill
   payments and refunds, every held payment whatever day it was taken, each with Record outcome:
   "Refunded in the card provider's dashboard" or "Kept: the money was owed", an optional note
   and the manager PIN, as the section's existing Record outcome takes. Recording ends the checks
   and the alert for that payment; Waitron refunds nothing. Needs a place to keep the provider's
   figure and the outcome (a migration).
2. One alert for held payments, apart from the ordinary orphan alert, that names every held
   payment, links to that list, and stays up until each has an outcome.
3. A check that fails three times in a row is tried again the next day, instead of never.
4. The alert wording stops saying Waitron may not check these payments again.

Picture: `mockups/a846-held-card-payments/01-record-what-was-done.png` (also `-dark`).

## The SumUp Solo experiments

- **The SumUp Solo experiments** ([runbook](../research/2026-09-10-sumup-solo-experiments.md)). Question
  4 was answered on 2026-09-11: a Solo paired to SumUp's cloud cannot also take a payment on its own,
  so the owner chose a separate standalone card machine for the internet-down case
  ([deli hardware](../superpowers/specs/2026-07-30-deli-hardware-design.md) §5). Still open: whether we
  may supply the idempotency key, whether reader webhooks are signed, and whether `void` maps onto
  the refund endpoint.

## The deli's outage card machine

- **The deli's outage card machine** (the deli hardware design §5). Buy the standalone machine, and
  decide how a payment keyed on it and recorded in the till as a manual card tender is matched to the
  record SumUp keeps with no sale of ours attached — the reconciler's sweep, and whether it can see a
  manual tender at all, decide it. Replace the design's estimated prices with real quotes. A barcode
  scanner only if the deli sells barcoded goods — nothing in the till reads one today.

## The SumUp reconciler

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
  its open points are in [till.md](till.md#owner-questions-each-with-the-default-built-answer-when-convenient)).
  One difference from the decision
  above: a card reader now has one holding device at a time, and a scan or a confirmed choice from
  the dropdown moves it to the waiter's device. NFC (W102) and Tap-to-Pay are still open._

_2026-10-14: the NFC implementation is in place. The box-address checks below remain open,
along with Tap-to-Pay._

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

- **An orphaned card payment whose settled amount differs from ours is held, never forgotten**
  (owner, 2026-10-17). It is never refunded automatically while the amounts disagree; its alert
  stays up and reminds daily until a person resolves it, and the sweep re-checks closed periods for
  orphans still unresolved. The build is A846.

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
