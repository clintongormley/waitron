# Fill missing card details after capture

**Finish line.** A newly captured SumUp reader payment can gain its missing card details in the
background. A later receipt copy reads them from the payment. The Lane F watcher chose a few tries
over about a minute at 12:36 on 21 November 2026, in the lane's questions.md. An original laid out before enrichment still has
the original fields. The already captured order 8 stays outside this follow-up. Sale recording
and print requests keep their existing timing.

A read-only lookup on the Lenovo returned all four fields for the captured order whose saved fields
are null. The original reply is unavailable. Both whole-order and bill-part collection, and
lost-response recovery, save through `captureAttempting`. SumUp's classifier supplies a local
settlement time. The saved external reference is the provider's transaction id after capture.

1. **Find and fill recent captures.** In `packages/payments/src/{store,index,provider}.ts` and
   `schema/payments.ts`, add a store read and conditional update and an optional provider method.
   Use the provider/settlement-time index and extract the sweep's inline ownership predicate.
   Read owned, captured reader rows from the past two minutes with a saved provider reference
   and all four card fields null. Fill the four together only while that same captured payment
   and reference still have the empty block. Keep amounts, dates, links and outcome intact.
   The existing SQL trigger permits this. Correct the capture-only card-field comment.
2. **Reuse the provider and its recovery pass.** In `packages/payments-sumup/src/provider.ts`,
   reuse `findTransaction({ id })` and `cardFromTransaction`. Require the same id, successful
   status, matching amount and EUR when supplied. Make one bounded GET per due payment in a
   pass. Keep at most three tries spaced 20 seconds apart in memory, within the minute following
   discovery and the two-minute age limit. Recheck age and abort before a GET and before saving.
   The provider wait holds no database lock. In `apps/server/src/boot.ts`, run the optional step
   after recovery and merge its next due time into the existing pass. Keep the 60-second idle
   ceiling and the same provider list, ownership (including secondaries), and stop signal. Fenced
   boxes and mirrors have no providers. A restart may repeat reads within the age limit.
3. **Use the existing print reads.** Test receipt copies through the normal stored-data builders.
   A copy queued after enrichment shows the new fields. A job already laid out keeps its bytes.
   The provider method is called only by background work.

**Tests first.** `store.card-and-replay.test.ts` owns eligibility, null-only writes and unchanged
financial facts. A focused SumUp provider suite with `FakeSumUp` owns bounded retries, malformed or
refused replies, mismatches, stop and a held GET alongside an independent database write.
The HTTP parser test uses a synthetic example of the observed response shape and valid four
digits. `boot-pending-sweep.test.ts` owns order and scheduling. `receipt-print.test.ts` proves
a fresh whole-order and bill-part copy reads stored decoration
with the same fiscal facts. Reuse the existing receipt fixtures and run only the named files.

This slice leaves out historical backfill, automatic reprints, migrations and new queue records.
Estimate **+180 to +240 production lines and +220 to +280 test lines**, with up to 15 removals
in each. Codex will build after Claude's plan review and watcher clearance.
