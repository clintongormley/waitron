# A1389: detect card amount mismatches

Authority: watcher, 2026-11-06 23:12, recorded in Lane F questions:
“Land the detection now, as a normal PR after the freeze: both adapters, mismatch stays uncertain, both amounts in the alert, checks stop at 15 minutes. No migration.”
The manager release follows after A760. This split deliberately leaves a persistent mismatch holding an unpaid order.

Preserve signed `8b2f940f4a`’s tip validation and free-sale mark fixes. No table, state, amount-field meaning, fiscal writer, refund or release changes. Claude reviews this page before build; execute inline with failing tests first.

## Compare actual amounts

- Trace collect/sweep, payment storage, bill settlement, till marks, reader busy checks and manager routes before changing their gates.
- Extend both adapters’ `provider.test.ts` and their sweep suites: under, over, zero and exact amounts, plus unavailable evidence. Assert requested amount/reference retained, attempting state, no settlement or refund; exact succeeds. Observe RED.
- Stripe `provider.ts`: retrieve the intent after reader success and require succeeded plus exact `fromMinorUnits(amountReceived)` before capture; reuse the sweep comparison. Lookup failure stays unknown.
- SumUp `provider.ts`: carry the transaction’s existing Decimal amount through classification and compare before collect/sweep capture. Keep known mismatches attempting through later unavailable/deferred answers; preserve ordinary resolution. Run GREEN.

## Alert and bound automatic checks

- Compare existing holds and incident facilities first. Positive-only holds cannot represent zero mismatches; use existing incidents, without fake sale ids or resolution records.
- Test a small shared `payments/src/capture-mismatch.ts` helper before implementation. Register `payment.capture_mismatch`, expose both amounts and provider/payment/order references, and wire the existing sinks, including Stripe’s contribution.
- Use existing immutable aggregate-alert replacement: multiple payments must remain visible when deduplication collides. Read historical evidence even after handling the alert.
- Bound automatic provider calls at 15 minutes after the earliest matching mismatch incident. Test both sides of the boundary, provider reconstruction/restart, handled/replaced alerts and mixed ordinary rows. Acknowledgment never unlocks or resets the window.
- Gate before network calls. Prove repeated host ticks make no calls for expired mismatches; the host ignores `nextDueAt`. Manual reads retain their current behavior.

## Verify and finish

- Server tests prove the retained unpaid order/mark cannot be charged again, with no sale, tender, fiscal write or refund. Verify stuck-list visibility and current manual-resolution behavior before/after expiry.
- Add bilingual alert wording/tests showing both amounts and the limit, without promising release. Update affected guides/backlog and inspect alerts in both themes at phone width.
- Preserve existing assertions; run focused adapter/shared/server cases, alert/guide guards, partial-commit cases and affected types. Stop for an uncovered storage or policy decision.
- Run normal finish-branch review, push hook and current-head CI. Publish the normal PR; land only after the A760 freeze is explicitly lifted.
