# A1389: detect card amount mismatches

Authority: watcher, 2026-11-07 02:53, in Lane F questions: “No later processor answer ends a known mismatch: not failed, cancelled or exact success. Only the later manager action does.” “Stop automatic reads at the first mismatch.” This replaces the earlier 15-minute limit. The watcher accepts the reader remaining occupied; A1381, A1395 and the later release must be qualified together before landing.

Preserve signed `8b2f940f4a`’s tip/free-sale fixes. No table, migration, payment-state/amount meaning, fiscal writer, refund or release changes. Claude reviews this revision before build. Execute inline, failing tests first.

## Compare and retain

- Trace both adapters, storage, host ticks, bill settlement, till marks, reader checks and manager routes. Keep golden huella and inmutabilidad unedited.
- Add under/over/zero/exact and lookup-failure cases through collect and sweep. Assert attempting with requested amount/reference, null settlement and no refund; exact succeeds when no mismatch was recorded. Observe RED.
- Stripe retrieves the intent after reader success and compares `fromMinorUnits(amountReceived)` before capture; the sweep uses the same rule. SumUp carries the existing transaction Decimal through classification and checks both capture paths.
- Once evidence exists, neither automatic nor manual resolution may capture/fail the row, including later FAILED, CANCELLED, REFUNDED, missing or exact-success answers. Ordinary rows retain their current resolution. Test these alternate paths and concurrent detection.

## Persist one readable alert and stop

- A shared `payments/src/capture-mismatch.ts` helper records `payment.capture_mismatch` using existing incidents. Keep provider/payment/order references and exact requested/reported values, including zero. Wrap collect-time evidence writes with `saveCharge`; test a full-disk failure.
- Existing holds require positive amounts. Existing incident deduplication would hide a second payment. Reuse the `HeldAlertSink` shape for aggregate immutable-alert replacement, retaining the open alert’s entries. Wire it through provider contributions/pool. Add no new dependency on core.
- To enforce the stop across restarts, read whether any open or handled mismatch snapshot names the payment. No earliest-time calculation, deadline, new marker or timer. A repeated detection/handled alert never unlocks or re-alerts that payment.
- Gate automatic calls before Stripe’s resolve loop and SumUp’s lookup; test repeated host ticks, reconstruction, handled alerts and mixed ordinary rows. A known mismatch stays unknown on explicit manager checking too.
- Show every amount pair in English/Spanish with the smallest necessary formatter; arrays currently render JSON. Preserve a second payment’s evidence and readable figures. Promise no release action.

## Verify and finish

- Test unpaid order/mark, occupied reader, stuck visibility and no second payment, sale/tender/fiscal write or refund. Cover placed-order cancellation on the combined A1381/A1395/release candidate before landing.
- Deliberately change only the existing Stripe mismatch `incidentsRaised: 0` expectation to one; preserve its other assertions. Retire affected provider/SumUp sweep comments. Add the helper to the incident-code source list; change no guard policy.
- Update bilingual guides/backlog and inspect alert views in both themes at phone width. Run focused suites, alert/guide guards, scoped types and partial-commit checks.
- Normal finish-branch review, push hook and current-head CI follow. Land only after the freeze and the named dependencies; manager release remains a separate slice.

Provenance, read 2026-11-07: [SumUp transaction](https://developer.sumup.com/api/transactions/get/) describes `tip_amount` as “Tip included in the total transaction amount”; compare its existing total `amount`. [Stripe](https://docs.stripe.com/api/payment_intents/object) describes `amount_received` as “Amount that this PaymentIntent collects.”
