# A275 Task 0: read-only party readiness implementation slice plan

**Goal:** Let later transfer closure ask whether service can finish, using the existing checks. This prerequisite delivers no transfer closure, daily line, accountant export or debt tracking.

**Basis:** [Approved design](../specs/2026-10-22-a275-final-transfer-close-design.md) and [reviewed plan, Task 0](2026-10-22-a275-final-transfer-close.md#task-0-extract-party-readiness-without-changing-explicit-finish). Source observations are **read-only, runtime unverified** at `85808d9f3f`; no tests ran. `rg` traced current `finishPartyService` callers in `till-api.ts`, `bill-identities.test.ts` and `order-portions.adjustments.test.ts`; no readiness export exists.

**Authority pending:** Lane E `questions.md`, 2026-11-09 11:30, assigns A987 then A275 Tasks 1–6 while A1308 3a-i waits for 1a; Task 7 waits for A739. Task 0 is required by those tasks but unnamed in that instruction. Manager approval to include this prerequisite remains pending. A987's policy decision was pending in the commissioning brief; the subsequent 11:44 approval concerns A987, not this prerequisite. The driver must commit this plan, obtain one Claude plan read with `~/workspace/tools/claude-seat.sh review-branch`, address findings, then obtain watcher approval before building. Owner finish/land authorisation does not replace that approval.

**Contract and approach:** Export `readPartyFinishReadiness(tx: Transaction, cfg: OriginConfig, args: FinishPartyArgs): Promise<{ready:true}|{ready:false; blockers:PartyFinishBlocker[]}>`. Current `FinishPartyArgs` includes `admission`; `TillConfig` is obsolete here. Retain the reviewed six-code `PartyFinishBlocker` union, but emit only one service blocker, the first encountered: `revision`, `other_bills`, `editor` or `service`. Scope and authority belong to later command admission; this read grants neither and does not call `requireEconomicWrite`.

Extract the existing sequential reads into one internal reader shared with explicit finish: open party, revision, family bills, editor/unsent checks, then unserved dishes (`finish-party-service.ts:119`). Keep economic admission, replay, cancellation, collection, refunds and all writes in their existing paths; create no second close algorithm.

Translate only `party.out_of_date` to `revision`, `party.bill_outstanding` to `other_bills`, and `draft.taken_over`, `draft.out_of_date`, `bill.unsent_dishes` to `editor`; remaining dishes mean `service`. These codes come from `bill-editing.ts:134,268,284` and `bill-unsent.ts:49`. Missing and closed parties both propagate `party.not_open` (`parties.ts:504`), before reading revision. Malformed expectations, cancellation-context errors and unexpected/database errors propagate unchanged. No broad catch-all.

**Exact build files and estimated churn:**

- `apps/server/src/finish-party-service.ts`: approximately 110 added + 70 removed production lines (180 total, including moved/replaced checks).
- `apps/server/src/finish-party-service.test.ts`: approximately 280 added + 20 removed test lines (300 total); preserve every original behavioral assertion.
- `docs/backlog/fiscal.md`: approximately eight progress lines; keep A275 open. Existing exported reads suffice; leave `parties.ts` unchanged.

**Build and behavioral checks:**

- [ ] Use real `useVenueDb`; observe expected RED before minimum GREEN. Cover ready control, sibling outstanding, unserved remainder, stale party revision, foreign editor, stale editor/draft expectations, unsent work with current expectations, malformed expectations, missing/closed party and unchanged unexpected/database rejection. Pin simultaneous-blocker refusal order and existing explicit-finish behavior.
- [ ] Compare before/after snapshots for every readiness outcome: family parties/revisions, table membership/clearing, bills/lines, editors/drafts, tickets, cancellations, adjustments/refunds, commands, money and jobs. Readiness must write nothing, bump nothing and perform no cancellation or refund.
- [ ] Run only `pnpm --filter @waitron/server exec vitest run src/finish-party-service.test.ts --reporter=verbose`; retain counts. Once, omit sibling and unserved checks separately in a disposable candidate, observe their assertions fail with ready control passing, restore and rerun. No permanent mutation harness or whole-package suite.

**Finish line:** One PR within three build hours, shared read checks usable by later Tasks 1–6, original finish assertions passing, Claude run-it review then normal hook and required current-head CI green. Stop for watcher review beyond 720 production-plus-test changed lines (1.5×480), new files or expanded scope. No routes, tables, schema, fiscal behavior or owner-landed fiscal code here. Before later Task 1, re-pin its schema instructions to A1308 1a's baseline-rebuild workflow; do not build it or rewrite the historical plan in this slice.
