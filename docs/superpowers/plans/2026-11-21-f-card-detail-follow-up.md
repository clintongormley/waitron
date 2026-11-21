# Fill missing card details after capture

**Finish line.** A newly captured SumUp reader payment can gain its missing card details in the
background. A later receipt copy reads them from the payment. The Lane F watcher chose a few tries
over about a minute at 12:36 on 21 November 2026, in the lane's questions.md. Sale recording and
print requests keep their existing timing.

A read-only lookup on the Lenovo returned all four fields for the captured order whose saved fields
are null. The original reply is unavailable. Both whole-order and bill-part collection, and
lost-response recovery, save through `captureAttempting`. SumUp's classifier supplies a local
settlement time. The saved external reference is the provider's transaction id after capture.

1. **Find and fill recent captures.** In `packages/payments/src/{store,index,provider}.ts` and
   `schema/payments.ts`, add a store read and conditional update and an optional provider method.
   Use the existing provider/settlement-time index and collection-ownership predicate. Select only
   owned, captured reader rows from the past minute with an external reference and no card block
   (scheme or last four missing). Fill only null card fields on the same captured payment and
   reference. The existing SQL trigger permits these updates. Keep amounts, dates, links, outcome
   and other existing values intact. Correct the capture-only card-field comment.
2. **Reuse the provider and its recovery pass.** In `packages/payments-sumup/src/provider.ts`,
   reuse `findTransaction({ id })` and `cardFromTransaction`. Require the same id, successful
   status, matching amount and EUR when supplied. Space scans 20 seconds apart. Recheck the
   minute limit and abort before each GET and again before saving. The provider wait holds no
   database lock. Reuse the client's bounded request. `apps/server/src/{boot,pending-card-recovery}.ts`
   run the optional method after existing recovery steps, with the same owners and stop signal.
   Give the loop a 20-second idle ceiling so a capture arrives in time to retry. A restart can
   repeat a recent read within its original window.
3. **Use the existing print reads.** Test receipt copies through the normal stored-data builders.
   A copy queued after enrichment shows the new fields. A job already laid out keeps its bytes.
   The provider method is called only by background work.

**Tests first.** `store.card-and-replay.test.ts` owns eligibility, null-only writes and unchanged
financial facts. A focused SumUp provider suite with `FakeSumUp` owns bounded retries, malformed or
refused replies, mismatches, stop and a held GET alongside an independent database write.
`boot-pending-sweep.test.ts` and `pending-card-loop.test.ts` own integration order and cadence.
`receipt-print.test.ts` proves a fresh whole-order and bill-part copy reads stored decoration
with the same fiscal facts. Reuse the existing receipt fixtures and run only the named files.

This slice leaves out historical backfill, automatic reprints, migrations and new queue records.
Estimate **+180 to +240 production lines and +220 to +280 test lines**, with up to 15 removals
in each. Codex will build after Claude's plan review and watcher clearance.
