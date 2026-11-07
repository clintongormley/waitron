# A1389: detect card amount mismatches

Authority: watcher, 2026-11-07 02:53, in Lane F questions: “No later processor answer ends a known mismatch: not failed, cancelled or exact success. Only the later manager action does.” “Stop automatic reads at the first mismatch.” This replaces the earlier 15-minute limit. The watcher accepts the reader remaining occupied; A1381, A1395 and the later release must be qualified together before landing.

Preserve signed `8b2f940f4a`’s tip/free-sale fixes. No table, migration, payment-state/amount meaning, fiscal writer, refund or release changes. Claude reviews this revision before build. Execute inline, failing tests first.

## Compare and retain

- Trace both adapters, storage, host ticks, bill settlement, till marks, reader checks and manager routes. Keep golden huella and inmutabilidad unedited.
- Add under/over/zero/exact and lookup-failure cases through collect and sweep. Assert attempting with requested amount/reference, null settlement and no refund; exact succeeds when no mismatch was recorded. Observe RED.
- Stripe retrieves the intent after reader success. Compare `fromMinorUnits(amountReceived)` only for an intent with `status: succeeded`; processing with zero received stays unknown without a mismatch alert. Test that case and apply the same sweep rule. SumUp carries the existing transaction Decimal through classification and checks both capture paths.
- Once evidence exists, neither automatic nor manual resolution may capture/fail the row, including later FAILED, CANCELLED, REFUNDED, missing or exact-success answers. Ordinary rows retain their current resolution. Test these alternate paths and concurrent detection.

## Persist one readable alert and stop

- A shared `payments/src/capture-mismatch.ts` helper records `payment.capture_mismatch` using existing incidents. Keep provider/payment/order references and exact requested/reported values, including zero. Wrap collect-time evidence writes with `saveCharge`; test a full-disk failure.
- Existing holds require positive amounts. Existing incident deduplication would hide a second payment. Use a sink of raise and handle for aggregate immutable-alert replacement, retaining the open alert’s entries. Wire it through provider contributions/pool. Add no new dependency on core.
- To enforce the stop across restarts, query every `payment.capture_mismatch` incident directly from the exported `incidents` table inside the transaction, including handled snapshots, to find the payment. No earliest-time calculation, deadline, new marker or timer. Test p1 handled, p2 open, then replacement naming p2/p3: p1 still stops. Acknowledgment never unlocks or re-alerts that payment.
- Gate automatic calls before Stripe’s resolve loop and SumUp’s lookup; test repeated host ticks, reconstruction, handled alerts and mixed ordinary rows. Recheck evidence inside every resolving write transaction so an answer already in flight cannot bypass it. Known mismatches stay unknown on manual checking too; later automatic passes return `nextDueAt: null`.
- Show every amount pair in English/Spanish with the smallest necessary formatter; arrays currently render JSON. Preserve a second payment’s evidence and readable figures. Promise no release action.

## Verify and finish

- Test a bill payment remaining pending/locked, unpaid order/mark, occupied reader, stuck visibility and no second payment, sale/tender/fiscal write or refund. Cover placed-order cancellation on the combined A1381/A1395/release candidate before landing.
- Give the Stripe sweep table a per-row `incidentsRaised`: one for the 1209 mismatch, zero for the other rows; preserve its other assertions. Retire affected provider/SumUp sweep comments. Add the helper to the incident-code source list; change no guard policy.
- Update bilingual guides/backlog and inspect alert views in both themes at phone width. Run focused suites, alert/guide guards, scoped types and partial-commit checks.
- Normal finish-branch review, push hook and current-head CI follow. Land only after the freeze and the named dependencies; manager release remains a separate slice.

Provenance, read 2026-11-07: [SumUp transaction](https://developer.sumup.com/api/transactions/get/) describes `tip_amount` as “Tip included in the total transaction amount”; compare its existing total `amount`. [Stripe](https://docs.stripe.com/api/payment_intents/object) describes `amount_received` as “Amount that this PaymentIntent collects.”
