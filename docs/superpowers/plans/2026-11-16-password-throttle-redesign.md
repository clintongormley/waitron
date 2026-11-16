# Password throttle redesign

**Finish line:** Made-up addresses cannot discard another address's failed-password count or wait, in either real-first or spray-first order, including after capacity is exhausted.
**Ask:** Lane K `queue.md` → `PASSWORD-THROTTLE-REDESIGN`; owner, 2026-11-16 08:56: “Yes, queue the redesign”. This plan covers only that throttle weakness in `LOGIN-ONE-ANSWER-GAPS`.
**Evidence:** Driver reports 1 passed, 30 skipped: `pnpm --filter @waitron/provisioning exec vitest run src/password-throttle.test.ts -t 'lets a different address with more wrong tries take the counter'`. Defect characterization, not desired behavior.

## Existing code reused and exact files

- Modify `packages/provisioning/src/password-throttle.ts` and `packages/provisioning/src/password-throttle.test.ts`; reuse `placeOf`, the finished-entry cache, in-flight map, `madeUp`, `neighbours`, `fail`, `forgetAll` and `refusal` (extend collision discovery to three neighbours).
- Reuse unchanged `pinThrottleIdle`, `pinThrottleUnlockAt`, `pinThrottleRetryAfterSeconds` and policy constants from `packages/identity/src/pin-throttle.ts`; retain `MAX_TRACKED`, `BUCKETS`, `MAX_BUCKET_FAILS`. No dependencies.
- Prose: this plan, `docs/backlog.md` and `docs/backlog/dashboard.md`; when implementation lands, remove only the collision weakness, retaining the other one-answer gaps.
- Consumers traced with `rg`: provisioning first-setup owner/exports; server re-export, management/profile/fresh proof, promote/mirror/setup/carry-on and handover routes/helpers/shared boot instance. Repeat `rg -n 'createPasswordThrottle|PasswordThrottleProbe|wouldRefuse|finishAttempt' packages/provisioning/src apps/server/src` before implementation; leave these consumers unchanged.

## Capacity and lifecycle decisions

- Replace each single-owner bucket with **two owned slots plus one overflow summary**. Compare the full existing HMAC digest for ownership, replacing the 32-bit fingerprint; keep secret bucket selection and trim/lowercase normalization unchanged. Allocate tables lazily.
- Slot: digest, occupied flag, capped count, unlock/last-activity times. Overflow: flag, capped count, both times, no owner. Fixed typed-array payload: `BUCKETS × (2 × (32+1+1+8+8) + (1+1+8+8)) = 7,733,248` bytes, excluding objects/maps.
- Folding updates a matching owner or claims an empty/idle slot. Never replace a live owner's slot with another key, regardless of count. An owned slot stays reserved while its key is in flight, even beyond idle time.
- With both slots occupied, fold into overflow using componentwise maxima of live count/unlock/last-activity values; never overwrite with a weaker contribution. Overflow is used only for addresses without a live owned slot; existing explicit owners keep independent histories.
- Unowned addresses merge cached/held history with live overflow at admission, completion and folding. Claiming a free slot carries that floor; keep overflow until expiry even when slots free.
- Saturation trades availability for protection: unrelated unowned addresses inherit counts/waits; continued spray can prolong interference. No exact history promise for arbitrarily many keys. Success clears only matching owner/cache state, never overflow/another owner.
- `invalid` adds one failure and computes the existing delay; `error` adds no failure/new wait, but refreshes activity; `success` releases its own state. Delayed completions merge current overflow before updating. Refusals do not refresh history.
- Preserve all in-flight behavior: same normalized key refuses with one second; other keys can proceed; held entries are never evicted. `tracked()` remains cache plus in-flight count: at most `max(MAX_TRACKED, inFlight.size)`. Total memory remains fixed tables plus O(MAX_TRACKED + concurrent attempts), **not** an absolute bound under unlimited concurrent requests.
- Apply `pinThrottleIdle` independently to cache, slots and summary: expire at 15 minutes idle or strictly over 60 seconds ahead; preserve boundary/sweep-past-future behavior. In-flight reservations survive. Expired summary contributes nothing.
- `wouldRefuse` makes the same effective-history decision as `begin` without allocating, claiming, sweeping, refreshing, clearing or reordering any state. Public signatures, retry rounding and callers' one-answer/hash work stay unchanged.

## Two TDD tasks (execute inline after review)

1. **Retain both colliding owners.** Add `retains real-first history` and `retains spray-first history`, forcing cache eviction between colliding failures; assert both addresses' exact next waits/count escalation. Run `pnpm --filter @waitron/provisioning exec vitest run src/password-throttle.test.ts -t 'retains (real-first|spray-first) history'` and see both fail from lost counts before implementing slots. Intentionally replace the takeover characterization with retained-history assertions; keep its neighbour-wait assertion and every other existing behavioral assertion. Implement ownership, rerun to green.
2. **Protect overflow/lifecycle.** Add `saturated bucket` cases beyond two slots: both orders, repeated eviction, weaker folds, overflow surviving another success/freed slot, owner independence, count cap, idle/backward boundaries, held reservation, concurrent completion, error/success, and passive-probe parity against an unprobed control. Assert exact waits and existing `tracked()` bounds with existing helpers. Run `pnpm --filter @waitron/provisioning exec vitest run src/password-throttle.test.ts -t 'saturated bucket'`; observe policy failures before overflow implementation; rerun green, then run the whole throttle file. Inspect fixed array sizes against the payload calculation; no inspection API.

## Verification, limits and handoff

- Existing route checks only: `pnpm --filter @waitron/server exec vitest run src/own-password-ahead.test.ts src/fresh-sign-in.test.ts src/promote-api.throttle.test.ts`; inspect actual test counts. No new route tests. Run the normal pre-push gate once and require current-head scoped CI; no whole-workspace local run.
- Out of scope: routes, authentication/database changes, PIN saturation, persistent counters, new admission limits, timers, dependencies, and unrelated one-answer gaps. Audit prose about old takeover behavior; historical receipts get a dated pointer rather than a rewrite.
- Expected changed lines (added + removed): **production 180; tests 240; support 0; prose 70; total 490**. At **1.5× (735 total)**, or any material design departure, stop for the watcher's outside opinion before expanding.
- This is a plan-only handoff, not build clearance: Claude reviews the plan, then Lane K's watcher clears implementation. No owner design approval is claimed. One PR; auth risk requires two run-it review angles during `finish-branch` and a fresh Claude read of fixes.
