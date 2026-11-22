# Payments and card readers — detail

_2026-11-15, A1529: The recovery and comparison pages below moved to **Check card payments** in Reporting. Reader tools stay on **Card payments**. [Move plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1529-card-pages.md)._

The open entries are listed in [the backlog](../backlog.md), under "Payments and card readers". This file holds
their full text.

## Turn off Stripe's on-reader tip screen, or read the tip back

SumUp remains the go-live provider (owner, 2026-10-21). A1389's 2026-11-08 cut-back reads the cloud
reader's actual capture and reported tip; the excess becomes tip, and matching reader-tip evidence
avoids a difference alert. The fake-client cases exercise this path; no Stripe sandbox or physical
reader qualification has run. The on-device adapter still records the requested amount
(`packages/payments-stripe/src/device-provider.ts`). **Next action:** qualify tipping against a real
Stripe reader before using Stripe, and cover the on-device amount path if that adapter is needed.
The approved implementation is in
[the A1389 cut-back plan](../superpowers/plans/2026-11-08-a1389-actual-card-amounts.md).

## A846's points for the owner at land: held card payments

Each stays open until the owner answers it. "The picture" was a mock-up, removed from the repository on 2026-11-02.

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

The [sandbox checks and owner settlement script](../research/2026-11-15-a949-sandbox-and-settlement-check.md)
record the successful €10 Virtual A control and the later virtual-reader session on 16 November.
The €11 late decline needed a manager-confirmed release after the provider reported `FAILED`;
€42.51 returned a generic decline within the till's wait. A separate €10 Virtual B payment settled
its own bill and matched SumUp's `SUCCESSFUL` transaction. The owner's 17 November paired-Solo
check captured €1.40. The next daily audit checked that charge by reference and amount with no
discrepancies. The owner saw both completed checks in SumUp comparison, with no rows in the two
payment lists. On 19 November the owner paid €1.40 by chip and online PIN. The Waitron capture
and the saved SumUp transaction agree by reference and amount. The owner accepted the saved
standalone backup replay and closed the hands-on checks on 20 November. Signature was not tested
because no card was available. Idle reader battery refresh timing remains unqualified.
Waitron omits old or undated SumUp battery snapshots. Check charge on the reader when no percentage
is shown. See the script's dated battery provenance and the existing alert-cache limit.

**9 November continuation:** the owner's cross-account session accepted Waitron's new affiliate
block with the restaurant's credential. A reference read changed from 404 to PENDING before the
tap; after payment it matched the saved identities and EUR 1.00. Integer-cents refunds returned
REFUNDED events while the payment stayed SUCCESSFUL. An unpaid cancellation was visible by
reference as FAILED; only its checkout's failure reason identified cancellation. Read
[the retained results and limits](../research/2026-09-10-sumup-solo-experiments.md#11-a949-cross-account-session-2026-11-09).
The earlier session below remains a historical measurement.

**A949 session, 2026-11-05:** affiliate checkout and lookup after payment worked. A repeated
foreign reference started a new checkout, so the reference did not prevent a second request. The
first immediate lookup before the tap returned 404; a later checkout was visible as PENDING
while waiting, but its lookup key was not retained; pending lookup by our supplied reference
remains open. The saved callback carried no signature-like header. One delivery arrived after
the listener returned, about 112 seconds after its event timestamp; the failed attempt count and
retry schedule are unknown. Read the [results and
provenance](../research/2026-09-10-sumup-solo-experiments.md#10-a949-solo-session-2026-11-05).

The reported integer-`40` control returned EUR 0.40. The reported decimal-`0.40` probe, resent
after a definite refusal, returned the full EUR 1.00, unlike September's no-movement
observation. The request bytes were not retained, so an omitted or malformed amount is not
excluded; its cause is unknown. Current Waitron methods send integer cents; the stale truncation
comments have been removed. The session also observed temporary 409 balance refusals.
_8 November 2026: the till now explains a recognised balance refusal on the failed request’s
reply and offers a new refund later; later reads keep the generic failed-refund words._
The watcher's repeated requests departed from the earlier single-request checklist and are
recorded as such.

The review's read-only follow-up found ids in both raw refund-event arrays. Replaying each
complete detail through the real adapter matched its refund; the raw 19-row history response
omits foreign-reference keys, while the two detail responses carry them. See the runbook's
§10.7.

Physical declined-card behavior, the statement/fee check and the SIM-only and offline probes
remain open. No further paid request is authorised unattended, and a distinct authorisation void
has not been measured.

## The deli's outage card machine

(the deli hardware design §5). Buy the standalone machine and replace estimated prices with real
quotes. The owner chose three supported cases for A949 on 2026-10-21: automatically match
manually recorded payments from a second Solo on the same account by amount and time, with
unmatched payments listed for a manager; identify other providers' manual payments as paid
outside Waitron, carrying the operation number and machine through the till, day report and
accountant exports; and check cash-only service without a backup machine. The 5 November
phone-app samples report `payment_type: POS`, as API payments do, and client references starting
`urn:sumup:pos:sale:`. The owner's typed reference became product text (`Some ref`, with a
trailing space in detail), not a verified matching key. These samples inform the design; the
other-provider and cash-only cases still need qualification. A
barcode scanner only if the deli sells barcoded goods; nothing in the till reads one today.

The first backup-machine entry slice lets a counter use Other card machine while its normal reader
is configured. It records optional same-SumUp-account/other source, machine and operation number,
keeping those details on saved payment displays. The day report and accountant detail sheet carry
source, machine and operation number, current payment state and successful refunds.

The 20 November audit listed the manually recorded €1.40 payment as unmatched, as expected for
a charge on the owner's other SumUp account. It also listed both sides of the same-account €1.50
payment as unmatched. The standalone Solo charge was recorded in Waitron 10 minutes and 4 seconds
later, outside the original five-minute matching window. On 20 November the saved audit rows
were replayed through the reconciler in an isolated database. The 30-minute window matched the
€1.50 pair and left the €1.40 entry for a manager to check. The owner accepted the saved-audit
replay as the backup-machine qualification on 20 November.

## The SumUp reconciler

**A949, owner 2026-10-21:** build after the reference experiments establish the matching inputs.
The backup-machine software and SumUp abandoned-order refunds are built; hardware qualification
remains. The
[November
session](../research/2026-09-10-sumup-solo-experiments.md#10-a949-solo-session-2026-11-05)
establishes supplied-reference acceptance and lookup after payment, duplicate creation, separate
refund rows/events, and phone-app samples. The raw 19-row history response from the 11:42
read-only follow-up has no foreign-reference key; two original details do. Both raw details
retain refund ids, and their real-adapter replays match the corresponding refund. The earlier
projection omitted ids; it is not evidence for a parser change. A first missing lookup does not
license another charge; ambiguous matches stay visible. The gross-charge audit is separate from bank-payout proof and refund reconciliation. Further work can use [the 9 November cross-account session](../research/2026-09-10-sumup-solo-experiments.md#11-a949-cross-account-session-2026-11-09).
The A1308 table-work hold was lifted on 7 November; any new schema work regenerates on the
current main baseline. The first A949 slice uses `WAITRON_SUMUP_AFFILIATE` in
`packages/payments-sumup/src/affiliate.ts` for the app ID and public partner key together.
To change them, edit that one value and ship a box update. The venue supplies only its own API
key and merchant selection. One retry without partner metadata follows only a documented
HTTP 400 invalid-affiliate-key refusal and raises `payment.affiliate_rejected`; acceptance of
that fallback is not live-qualified. A lost fallback reply has no supplied reference to recover.

Recovery records the gross capture and identified completed refunds together. Uncertain refund
evidence stays attempting for another check; a failed refund alone leaves the charge. A partly
refunded unfiled charge keeps the order held until explicit confirmation. Direct-order and pending
linked payments can retain provider-confirmed remaining money on the bill, bill-first with any excess
as a tip; failed-linked payments keep the full-refund route. Stripe durable reversal attempts
remain open.

- Show managers the daily match result for payments taken through paired SumUp readers. The SumUp comparison lists standalone payment matches and payments that need checking.

The daily gross-charge audit and read-only refund comparison do not establish bank arrival.
The original transaction can stay
`SUCCESSFUL` while identified `REFUND` events in `events` and `transaction_events` show money
returned; its status alone cannot establish what remains collected.

## What M7b2 left open (a manager clearing a stuck card payment, #702)

- A1089: repair a charged card payment that Waitron still cannot record after retries, preserving its original details and preventing a second charge.
- SumUp has no permanent lock: its sweep resolves every `attempting` row this box owns against
  SumUp, and fails one SumUp has never heard of after 15 minutes, with an incident. It also leaves uncertain refund evidence attempting for another check. The manager action refuses a SumUp payment
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
box-address checks remain unverified.

## Check NFC sticker writing and locking on the box's address

On the OnePlus 13 at `https://waitron.local`, open a reader or portable printer's Equipment label
in the dashboard. Write a spare unlocked sticker and check its text with the till. Write again
after moving the sticker away to check the retry message. Lock only a disposable sticker after
reading the permanent warning, then try rewriting it. Browser tests use simulated writers; these
box-address write/read/lock checks remain unverified.

## Check equipment labels on a physical venue printer

On the OnePlus 13 at `https://waitron.local`, open a portable printer's Equipment label, press
Print on a printer, choose that printer and print. Check its job preview, read the paper's QR in
the till dialog, and check the name and code are legible. Repeat for a reader label on a second
active printer. Confirm neither print opens the drawer. Application payload checks do not
establish a physical print; these checks remain unverified.

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

## Check how real Stripe answers a reader id from another Stripe account

The add-reader route answers `reader.reference_unknown` when Stripe's library throws
`StripeInvalidRequestError` (`packages/payments-stripe/src/card-provider.ts` `readers.add`).
`reader-add.sandbox.test.ts` shows test-mode Stripe answers that way for an unknown and a malformed
id. Whether it does for a real reader that belongs to another Stripe account is unchecked: it needs a second test-mode account holding a simulated reader.

## A793 — tips: who a tip belongs to, how it is shared out, and what payroll gets

NOT APPROVED: the owner (2026-10-18, on Q38): "Leave this for now. Back to the backlog. It needs a
bigger brainstorm." Next: that brainstorm with the owner, before any build or further question.
A first design is kept as input ([design](../superpowers/specs/2026-10-18-a793-tips-design.md), research in
[compliance/research/2026-10-18-a793-tips.md](../compliance/research/2026-10-18-a793-tips.md)); not
built. A shared pot per business day split by hours clocked (kitchen included) or each person
keeping their own, chosen on a new Tips tab in Venue settings that also replaces
`WAITRON_TILL_TIPS`; cash tips handed out at the day's close (once a close counts the drawer,
A239, and the asesor's L6(g) allows it), card tips paid with wages; a Tips page under Team by day
and by pay period, frozen when a pay period closes (once the product has a step that closes one).
The first design had six build slices (its §7). Replaces the old "Tip-collection UI" entry: cash and
typed-card tips already arrived with bill payments (#956).

## Loose ends left by W102 (NFC and equipment labels)

- [Check NFC pick-up on the box's address](#check-nfc-pick-up-on-the-boxs-address).
- [Check NFC sticker writing and locking on the box's address](#check-nfc-sticker-writing-and-locking-on-the-boxs-address).
- [Check equipment labels on a physical venue printer](#check-equipment-labels-on-a-physical-venue-printer).

<a id="slice-2--the-handheld-nfcqr-link"></a>

## Bundle: Stripe adapter upkeep

Remaining Stripe qualification and maintenance.

- **Turn off Stripe's on-reader tip screen, or read the tip back.** Backlog only; SumUp is the
  go-live provider (owner, 2026-10-21). A1389 reads the cloud reader's actual amount and tip;
  real-reader qualification and the on-device amount path remain.
  [Detail](payments.md#turn-off-stripes-on-reader-tip-screen-or-read-the-tip-back)
- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no scheme/PAN/
  auth. Gated on the deli having a Stripe account, which it does not.
- **Check how real Stripe answers a reader id from another Stripe account** — left open by A519
  (#1566). Needs a second test-mode account.
  [Detail](payments.md#check-how-real-stripe-answers-a-reader-id-from-another-stripe-account)
- **Check Stripe's reader paging on real Stripe.** The reader list (`readers.list` in
  `packages/payments-stripe/src/card-provider.ts`) asks for 100 readers a page and follows
  `starting_after` until Stripe says there are no more. Its tests use a fake Stripe, and no sandbox
  case lists readers. A check needs more than 100 readers on one account, since the page size is
  fixed at 100.
- **Stripe's two return addresses (`successUrl`, `cancelUrl`) are still sealed with its secrets**,
  and their only reader, `createCheckoutSession`, has no production caller (read, not run). A1308's
  env4 left them as they are (owner, 2026-11-09: "Leave this for when we test Stripe"): decide then
  whether to move them to the payments settings document or stop collecting them.

## Bundle: Tap to pay restore

1 entry, size M. Its text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Restore `stripe_on_device` (Tap-to-Pay) on the handheld** (left open by A796). It waits for
  the one-time native-app decision
  ([native app capabilities](../superpowers/specs/2026-08-30-native-app-capabilities.md), N1/N2;
  [A796 design §6](../superpowers/specs/2026-10-19-a796-handheld-payments-design.md#6-tap-to-pay)).

## Decisions and deliberate limits

- **A949 signature qualification closed** (owner, 2026-11-20 16:19). No signature-required card was
  available, so the signature step was not tested. The existing
  [SumUp experiment checkpoint](../research/2026-09-10-sumup-solo-experiments.md#8-a949-checkpoint-2026-10-21)
  records what remains unknown about reader handling.

- **A cancellation's refund is approved on the server, not carried by the till** (owner,
  2026-11-12, R6-5: "Approval on server"; the watcher cleared the detail below, #2983). Once a
  €14 cancellation with a refund is approved, staff can refund that €14 without another PIN;
  refunding more needs fresh refund authority, and the till keeps no approval credential.

- **Closing a bill as a deferred payment is final in Waitron** (owner, 2026-10-21 02:40, A275;
  the words "Deferred payment" / «Pago aplazado», owner, 2026-11-11). The invoice is issued at the
  meal and the table freed; there is no awaiting-payment balance, later money-received entry,
  part payment, reversal, receivables ledger or unpaid-debt list. The amount shows separately in
  the day's close and in the accountant's export, and the accountant reconciles the bank outside
  Waitron.

- **Silent-provider qualification, 2026-11-16:** two real Chromium Payments tabs over loopback
  HTTP/1.1 retained two live streams and two silent-provider reads; an unrelated authenticated
  read answered in 1.4 ms. A six-socket saturation control blocked that read until a socket was
  released. Removing Web Locks started four browser requests but only two reached the provider;
  that observation does not qualify four distinct fallback reads. No production change.
  [Scope, failed hypothesis and receipts](../research/2026-11-16-silent-provider-connections.md).

- **The Stripe payments check reads amounts only; a Stripe account that settles in a currency other
  than the euro is out of scope** (watcher, 2026-11-15, lane A's STRIPE-CURRENCY). Waitron charges
  only in euros, and a eurozone venue's Stripe account settles in euros unless its owner chose
  otherwise, so this is not a real venue event; Stripe is not the go-live provider either.
  `stripeReportClient` (`packages/payments-stripe/src/stripe-report-client.ts`) never reads a
  balance transaction's `currency`.

- **Bank-payout reconciliation stays outside Waitron.** The owner asked on 21 October 2026 (A275),
  “Wouldn't this reconciliation be done by the accountant outside of waitron”. The watcher withdrew
  the bank-payout audit from A949 on 14 November at 16:33: no viewer or audit is to be built, and no
  payout evidence is requested. The gross-charge audit and refund comparison do not prove bank arrival.

- **SumUp abandoned-order refunds** (owner, 2026-11-14 09:52, relayed in Lane F questions.md):
  send one full refund only with an exact saved Waitron reference, matching amount and no prior refund.
  The existing orphan marker commits before sending and forbids any resend, including a crash before HTTP.
  Unconfirmed marked payments stay visible in Card payments for a manager to check in SumUp.
  [Plan and authority](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-13-a949-orphan-self-heal.md).


- **Money moving does not stop kitchen and course work** (owner, 2026-11-12, R7-1: asked whether
  staff may still "do everything that does not change what the bill charges", he answered "Yes,
  kitchen carries on"). While a card is at the reader or a card refund waits on a bill, staff may
  still fire a held course or dish, send held dishes, move dishes between stations, close or delete
  a station, change or reorder courses, move a whole dish between held courses, choose Make at,
  change a dish's note, rename the bill and change the whole-order kitchen note. Adding, removing
  or repricing dishes, a quantity, extras or options-answer change (a card taken for the whole
  order files the options answered when the card payment began; refusing it while a refund or a
  part payment waits is the lane's reading, not the owner's words), comps, discounts and moving
  dishes between bills stay refused. So do a partial move or split of a held dish, which rewrite
  the rows carrying its price: that is the lane's reading, not the owner's words. Moving a whole bill
  was already allowed ([till.md](till.md#a-pending-card-payment-does-not-stop-a-bill-moving-table-actions-plan-p19)).
  The writes allowed above count their write with `bumpRevisionKeepingPayment`
  (`apps/server/src/working-order.ts`). Tests: the "card payment" and "refund" cases in
  `apps/server/src/bill-editing.station-move.test.ts`, `order-groups.test.ts`,
  `working-order.test.ts`, `till-api.unroutable-dish.test.ts` and `station-delete.test.ts`; the
  card-at-the-reader cases in `till-api.kitchen-note.test.ts` and `till-api.test.ts`.

- **An uncertain bill payment keeps its original confirmation** (A1399, watcher answer,
  2026-11-06 23:12). A server error or code-less answer that does not prove the payment was refused
  uses the existing hold and **Check again**, with the same complete request. An empty balance
  read never releases it. Repeated server errors keep the bill held until the box answers; there
  is no timeout. The watcher’s 2026-11-07 00:09 answer keeps known-charge advice while its row
  is pending, including after reopening or rechecking. A coded refusal whose balance names the
  retained pending submission also holds that confirmation until a recorded end. Cash and
  hand-keyed full-disk refusals with no row keep their specific refusal without a new hold.
  A recheck refused before lookup (such as `reader.not_held`) retains the existing release with
  a warning: the first payment may have gone through, so inspect the bill’s payments before
  taking it again. That answer does not establish the first payment’s outcome. The watcher’s
  2026-11-07 00:29 clarification keeps a known charge held through every refusal until its row
  reaches a recorded end. Its warning links to Card payments, including dashboard sign-in,
  where the existing bill-payment recovery records the provider’s confirmed outcome. If the
  retained payment is read as received and settles the bill, reopening reads its stored receipt
  without resending to the reader; a receipt-read failure leaves it recorded and its hold ended.
  Every held pending row offers the existing Card payments sign-in, including after a coded refusal.

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
  The [waiting SumUp checkout](../superpowers/plans/2026-11-21-cancel-waiting-card-payment.md)
  can be stopped from Pay. The original payment confirms whether the guest was charged.
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
  (recorded in [the A846 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-19-a846-held-card-payments.md)):
  the reminder is an ordinary alert that can be marked handled and comes back the next morning
  while any held payment has no outcome, not one that cannot be dismissed; and a manager closes a
  held payment by recording an outcome in the Payments screen's held list.

- **Uncertain Stripe reader payments stay unknown** (owner, 2026-10-16, A764).
  Check them automatically after collection ends; keep what the order charges locked until the outcome is known.
  Retain the manager check as a fallback. A confirmed cancellation advances the next attempt's key;
  a bank decline keeps its existing retry key. Automatic resolution has no person in its audit row.
  Each payment records the box that started it in `payments.node_id`: every payment insert takes a
  required node id (`packages/payments/src/store.ts:45`). Each box's card sweep resolves only the
  in-flight payments it owns: its own, those of boxes it has taken over from, followed back through
  each of those boxes' own sources (`readTakenOverFrom`, `apps/server/src/handover-collection.ts`,
  read once at start), and payments naming no box only while it is the venue's singleton primary
  (`listAttempting`, `packages/payments/src/store.ts:510`; `sweepOwners`, `apps/server/src/boot.ts`). The sweep runs on every box except a mirror and a box fenced by the chart it holds, decided at start
  (`fencedOrMirror`, `apps/server/src/boot.ts`): a fenced box's open payments that never reached the new main
  box stay open, as they do on a restricted box. Only sale recovery and bill completion check for primary. Coordination between two boxes collecting at the same time is not
  built. The manager's stuck-payment lists, resolve routes and bill-payment attestations apply the
  same collection ownership. The primary named in the held chart also recovers payments from boxes
  the chart fences or revokes, so plain promotion retains a manager fallback
  (`apps/server/src/payments-api.ts`). Today's venue has one node (CLAUDE.md §5).
  [Implementation plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a764-stripe-unknown-outcome.md).

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
  in this process, still `attempting` at its provider, or already charged and not yet
  on a sale — a cash or hand-keyed card collect
  of the order, a payment of it in the bill's payment window or its preview (added 2026-11-12;
  there a card taken for a part payment is not counted, though its reservation is, as on an open
  bill),
  a second card payment of it and an unpaid departure of the party it belongs to are refused `order.payment_in_flight`, writing
  nothing. Pressing Pay again to file a card that was already charged is never refused, even from
  another till and even while that card's own payment has not yet filed it: it files that charge and
  asks no reader. A till on another payment provider is refused until the charge is filed, by the
  original payment's own last step or by a Pay from a till on the provider that took it. A request
  that arrives after the order is settled gets its receipt back, as a retry after a lost answer must
  (so a cash collect after the card settled answers the card's receipt). After a reader timeout,
  cash waits while the provider reports the card pending: with SumUp, for as long as SumUp answers
  PENDING, and up to 15 minutes when SumUp has no record of the payment. Plan:
  [2026-10-12-a526-placed-order-one-payment.md](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-12-a526-placed-order-one-payment.md).

- **A reader still paired at a provider that can unpair it (SumUp) is deleted in Waitron only
  while that provider's account is not connected** (owner, 2026-10-10), after the confirmation says
  it stays registered there.
  While the account is connected, a SumUp unpair call that fails, a rejected key included, still
  answers `reader.unpair_failed` and leaves the reader switched off: a rejected key is found only
  when Delete is pressed, because the impact read calls no provider, so the confirmation could not
  say so beforehand; disconnecting and connecting again with a working key fixes it (Disconnect
  needs every SumUp reader switched off first), and the delete then unpairs; and a rejected key and
  an outage answer alike, told apart only in the log (`reader.unpair_failed`'s `logReason`).
  Plan: [2026-10-10-a435-3b-reader-delete-disconnected.md](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-10-a435-3b-reader-delete-disconnected.md).

- **SumUp's card-present price is a plan choice, not a rate** (owner supplied the table, 2026-09-18).
  Tarifa Plana (€25/month, 0 % up to €2 500/month of Spanish debit/credit, then 0,79 %) is the plan to
  assume and beats Stripe Terminal on a Spanish card, so SumUp is **confirmed for the card-present
  seat**. SumUp's online rate (1,95 % on every plan) keeps it a weak candidate for the guest's own
  phone.
