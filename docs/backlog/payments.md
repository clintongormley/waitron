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
  2026-10-08; open; campaign lane E).** `apps/dashboard/src/screens/payments-screen.ts`.
  1. **Providers and Readers become two tabs**, laid out like Print agents and Printers. The screen
     opens on Readers when the venue has at least one reader, and on Providers when it has none
     (read as "added to Waitron", online or not — confirm with the owner if that matters).
  2. **"Default for devices" becomes "In use by", listing device names.** The column today counts
     only devices that picked the reader themselves (`device_card_readers`,
     `apps/server/src/payments-api.ts`); a device left on "Use default" that gets the reader from
     its profile (`device_profile_card_readers`) is not counted, and the header reads as if it were.
     List every device that would take a card on this reader, both ways; a long list is shortened
     ("Bar till, Terrace till +3").
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
