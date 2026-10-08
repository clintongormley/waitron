# Payments and card readers — detail

The open entries are listed in [the backlog](../backlog.md), under "Payments and card readers". This file holds
their full text.

## The two `provider.test.ts` cases named "throws payment.not_found" assert only `rejects.toThrow()`, not the code

- `packages/payments-stripe`, found by #570 and not changed (each a code or config change, not a
  comment): the two `provider.test.ts` cases named "throws payment.not_found" assert only
  `rejects.toThrow()`, not the code (CLAUDE.md §4); `tenant-scoping.test.ts` is named for tenant
  scoping but now guards that no source file opens a bare `.transaction(`; and `vitest.config.ts`
  leaves `src/stripe-client.ts` out of coverage although #570's review made that wrapper throw and
  two tests in the normal suite failed, so the normal run does reach it — CLAUDE.md §2 says a gap
  is never closed by an exclude over code a test could reach. Reversal retry-safety (one persisted
  id per reversal) is still deferred: #570's review showed two identical `reverseViaStripe` calls
  get different idempotency keys, so a retried reversal sends a second real refund; the comment
  at `reverse.ts` says so.

## The Stripe webhook endpoint still has to be repointed by hand, at Stripe

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe.** #378 shortened the
  address from `/webhooks/stripe/<an id>` to `/webhooks/stripe`; the endpoint registered in the
  Stripe dashboard is outside this repository and will keep sending to the old one until somebody
  changes it there. **Next action:** change it in the Stripe dashboard before any card payment is
  taken through a Stripe webhook.

## A421 — the Card payments screen: tabs, who uses a reader, Disconnect, Disable

- **A421 — the Card payments screen: tabs, who uses a reader, Disconnect, Disable (owner,
  2026-10-08; in progress; campaign lane D).** `apps/dashboard/src/screens/payments-screen.ts`.
  1. **Providers and Readers become two tabs**, laid out like Print agents and Printers. The screen
     opens on Readers when the venue has at least one reader, and on Providers when it has none
     (added to Waitron, including disabled or offline readers). Implemented locally on
     `feat/card-payments-controls`; not landed. The first successful reader list chooses the
     default; tab links and later choices survive live refreshes. Providers remain available
     while that read is pending or failed. Both panels stay mounted when switching tabs.
  2. **"Default for devices" becomes "In use by", listing device names.** Implemented locally
     on `feat/card-payments-controls`; not landed. The reader list includes each active device's
     explicit choice, otherwise its profile default, and the screen shortens a long list to
     "Bar till, Terrace till +3" with the full list in its title. The current holder stays separate.
     Disconnect and Disable below remain open; this item lands together in one PR.
  3. **Disconnect asks the way other screens do, and checks first.** It shows "Tap again to
     disconnect" (`payments.disconnect_confirm`), unlike the other screens' confirm steps (the
     Devices screen's button, for one, turns into "Disable this device?"). The refusal "Disable
     this provider's card readers before disconnecting it" (`payment.provider_in_use`) comes only
     after confirming, at the top of the page, moving the page down. Check for active readers when
     Disconnect is pressed, skip the confirm when it would be refused, and show the refusal as a
     floating message beside the button, so nothing moves. The bucket copy's Turn off says "Tap
     again to turn off" too (`stream.turn_off_confirm`,
     `apps/dashboard/src/screens/stream-settings-panel.ts`); give it the same confirm (owner,
     2026-10-08).
  4. **One Disable instead of Disable plus "Unpair from SumUp".** Unpairing already switches the
     reader off and can never be undone here (the unpair route sets `active: false`, and an
     unpaired reader loses Enable, `canEnable`). Disable opens a confirm with an "Also unpair from
     {provider}" tick box and its can't-be-undone warning, shown only where the provider can unpair
     (`canUnpair`). A reader already disabled but still paired keeps an "Unpair from {provider}"
     item, or it could never be unpaired.

## The card refund path records only after the provider call, with a fresh key each time

- **The card refund path records only after the provider call, with a fresh key each time.**
  `reverseViaStripe` (`packages/payments-stripe/src/reverse.ts`) sends a fresh `randomUUID()`
  idempotency key on every call and writes `payment_refunds` only after the call returns, so a
  crash between the two leaves no record, and a repeat would send a new key. SumUp's refund sends
  no key at all. Its only product caller is the reconciler's reversal of an abandoned order's
  capture (`packages/payments-stripe/src/reconciler.ts`); refunding a bill's card payment before
  its invoice goes through the separate durable path of Task 14 (design §6b). **Next action:**
  give the reconciler's reversal, and any post-invoice refund route when one is built, the same
  durable-attempt rule.

## A pending card refund does not refuse joining or unjoining tables, though the bill payments design says it does

- **A pending card refund does not refuse joining or unjoining tables, though the bill payments
  design says it does.** The design's §5.2 list ("each payment, refund, void, quantity change,
  adjustment, split, transfer, join and unjoin … are refused with `bill.refund_in_progress`",
  [bill payments design](../superpowers/specs/2026-09-26-bill-payments-design.md)) names join and
  unjoin. The run-it review of #851 (2026-09-29) reported that joining a free table to the party
  and unjoining a table without moving any dishes both succeeded while a card refund of the bill
  was pending; its probes were temporary and are not in the tree. Nobody has yet checked whether
  either can change what the bill charges. **Next action:** the owner decides whether the code
  should refuse them or the design should drop them from the list; then a test that tries each
  during a pending refund.

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
  - Stripe Terminal's automatic `resolvePending` sweep is still a no-op, on purpose. During a LIVE
    collect the row is `attempting` and its PaymentIntent waits for a card, so a sweep that cancels
    would cancel a payment a customer is about to tap. Only the manager action, which first checks
    that no attempt is running in this process, asks Stripe, and cancels the PaymentIntent if Stripe
    still allows it.
  - SumUp has no permanent lock: its sweep resolves every `attempting` row against SumUp, and fails
    one SumUp has never heard of after 15 minutes, with an incident. It leaves a row only while SumUp
    keeps answering PENDING. The manager action refuses a SumUp payment
    (`payment.resolve_unsupported`).
  - When the reader poll times out or errors, `collect` cancels the reader action best-effort and
    fails the row. If that cancel fails and the customer then taps, the money is captured while the
    local row says `failed`; only reconciliation sees it. Now that a resolver exists, leaving such a
    row `attempting` would hand it to the manager action instead. That would also lock the order
    until a manager acts, so it is the owner's call.
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
  the dropdown moves it to the waiter's device. NFC (W102, not queued: it needs a real NFC handheld and tag to probe — owner 2026-10-08) and
  Tap-to-Pay are still open._
- **Still pending: NFC** — tapping a phone on an NFC sticker to pick a reader (plan Task 5),
  W102 — not queued; it waits for a real NFC handheld (Chrome for Android) and a tag to
  probe on, since a simulated NFC test cannot show hardware support (owner 2026-10-08). Left open
  by W100 (#1332); the plan is the
  [equipment plan](../superpowers/plans/2026-10-04-device-equipment-and-independent-drawers.md).

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
  The ordering surface itself is parked under _online ordering (SP15)_ and the customer-facing menu.

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

## Decisions and deliberate limits

- **SumUp's card-present price is a plan choice, not a rate** (owner supplied the table, 2026-09-18).
  Tarifa Plana (€25/month, 0 % up to €2 500/month of Spanish debit/credit, then 0,79 %) is the plan to
  assume and beats Stripe Terminal on a Spanish card, so SumUp is **confirmed for the card-present
  seat**. SumUp's online rate (1,95 % on every plan) keeps it a weak candidate for the guest's own
  phone.
