# A444 Meal Completion Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, inline by the driver. Read the TDD skill before writing any implementation or test. Checkboxes record execution, not documentation progress. Do not dispatch agents for these tasks.

**Goal:** Give future completed-meal F1 invoices the saved venue calendar day of meal end,
retaining it across midnight, payment waits and restart, with no staff date choice.

**Architecture:** Capture completion automatically at the earliest qualifying existing final-service
command, with optional earlier Bill requested capture separate from its retractable signal. Copy the fact into durable accepted payment intent, then into the
sale and, only with exact H2 permission, the fiscal record. Render saved facts on every surface.

**Tech Stack:** TypeScript, Drizzle/SQLite, existing service-command replay and A739 payment
contexts, A696 venue clocks, Vitest/useVenueDb, Lit/Chromium, installed @waitron/verifactu.

**Spec:** [Meal completion date design](../specs/2026-10-27-a444-meal-completion-date-design.md).
Source receipts there are **source reading, UNVERIFIED**, at `ad8acbab3`. All commands below
are future execution instructions. No tests were run to write this plan.

## Global constraints and the build gate

- Owner approved meal-end date, separate issue date, and **no date entry/choice/confirmation**.
  S4 remains with the adviser; partial service/prepay remains S3/A447, Counter expansion A555,
  public F3 replacement A556. No historical invoice backfill or compatibility machinery.
- **BLOCKED before Task 1 code/tests:** driver records the exact H2 exception listed in the
  spec, released A696/A739 interfaces, reservations and the one-fiscal-branch slot. F/A739 has
  precedence; parked E/A696 `c79b2c03d` and retained F/A739 `3e45abdc6` are read-only references.
  Rebase/reorient on released code, not a foreign worktree or cherry-picked partial payment tree.
- The spec defines the automatic capture rule within the owner's examples: preserve the earliest
  qualifying final action, or capture at final payment/issuance acceptance without a prior Bill
  requested signal. An earlier unrecorded physical end cannot be reconstructed. State that limit;
  do not add a missing-date refusal, new staff action or another general approval gate.
- H2 still forbids changes to hash/chain/number allocation, library alta builders, registerSif,
  restoreFiscal and protected tests. Permission to finish/land is not an exception. If the scoped
  record-field exception is absent, stop build, not just its final fiscal task. No partial PR.
- Preserve every existing behavioral assertion and guard. Add cases for the new completed-meal
  contract; retain the existing provisional/out-of-scope controls. Any existing assertion that
  conflicts after integration is an explicit authorization dependency, never silently deleted.
- Every behavioral task: add the named assertion, run and observe the expected **behavioral**
  failure, implement the minimum, rerun green with nonzero counts and checked exit status.
  Missing imports/compile errors are not the intended red. Use real databases via `useVenueDb`;
  each fiscal case has its own compatible clock/history. Commit completed work with `git commit -s`.

## Review focus

1. A final bill request while a dessert/draft remains must not become whole-meal completion (Task 1).
2. An older partial payer must not date a later resumed meal, and an unresolved card must retain
   accepted evidence while blocking incompatible edits (Tasks 2–3).
3. An unpaid or zero completion, or an edit that settles a balance, must use the same date contract
   without inventing a zero tender, new drawer job or last-payer ownership (Task 3).
4. A month/year boundary or different DST/issue offset must survive persisted AEAT reconstruction
   and consultation, not only a mocked backend call (Task 4).
5. Receipt history after zone changes, restart or F2 replacement selection must not recompute
   dates or issue/charge again (Task 5). These cases are assigned below, not deferred to review.

## Task 0: clear dependencies and inventory the released tree

- [ ] Read both linked specs/plans, relevant developer topic files and current RUNNER H2. Record
      fresh main SHA, precise scoped permission, automatic capture boundaries and released payment
      context/zone helpers. Keep campaign changes with the driver, outside this documentation task.
- [ ] Repeat `rg -n 'recordSale\(|issueIfFullyPaid\(|issueUnpaidInvoice\(' apps packages --glob
'!*.test.ts'` and `rg -n 'operationDate|operation_date|FechaOperacion|billRequestedAt|paymentAttemptAt'
apps packages --glob '!**/meta/**'`. Read actual consumers, including scripts/fixtures,
      submission replay, draft commit, group submit/fire/release, party merge and department transfer.
      Compare with the source table; name every changed path in reservations before touching it.
- [ ] Require the existing registered feature worktree for build, separate from this docs worktree.
      No new overall approval round; unresolved exact H2/path ownership remains a real stop.

## Task 1: capture a real service-ending command and store its fact

**Files:** Create `packages/shared/src/meal-completion.ts`,
`apps/server/src/meal-completion.ts`, `apps/server/src/meal-completion.test.ts`,
`packages/db/src/schema/meal-completion.test.ts`. Extend shared `index.ts`, db
`src/schema/orders.ts`, new generated/custom `packages/db/drizzle/` migrations,
server `bill-request.ts`, `unpaid-departure.ts`, `till-api.ts`, domain `errors.ts` and EN/ES
refusal text. Extend `apps/server/src/table-signals.test.ts`, `unpaid-departure.test.ts`.

**Interfaces (new):** shared `MealCompletion` is exactly the spec's four string fields.
Server `mealServiceState(tx: Transaction, billId: string): Promise<"complete" | "continuing">`
implements the spec's exact family/draft/remaining-quantity predicate.
`captureMealCompletion(tx: Transaction, scope: {billId: string}, commandId: string,
clock: TrustedClock, source: "final_bill" | "final_invoice" | "final_payment" | "settling_edit" | "unpaid_departure"): Promise<MealCompletion | null>`
validates the whole family and stores one server reading on its affected unissued bills. It returns null
for an early bill signal; it never derives completion from servedAt alone. Existing
`requestBill` gains explicit injected clock/scope context; update its real direct test callers
without weakening their signal/replay assertions. New `readMealCompletion(tx, billId: string):
Promise<MealCompletion | null>` validates saved shape/date for later tasks.

- [ ] **Red:** Add `captures final request after midnight, not opening day`: open 27 Oct 23:30,
      final request 28 Oct 00:40 Madrid; assert saved endedAt `2026-10-27T23:40:00.000Z`, zone
      `Europe/Madrid`, operationDate `2026-10-28` and original command id across every family bill.
      Add early request with unserved/held/unsent/draft work: signal present, completion null. After
      marking the last dish served, still null; a new qualifying command captures, old replay does not.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/meal-completion.test.ts
src/table-signals.test.ts src/unpaid-departure.test.ts --reporter=dot`.
      Expected red: qualifying request has no saved completion; do not count a missing column error.
      First make new storage tests red against the migration/schema invariant, then add storage;
      keep server assertions red until capture is implemented. Also test command rollback/lost answer,
      surviving merged family, differing process/venue zone, Canary and DST, unpaid departure with
      and without prior completion, and first qualifying final command after midnight with no earlier observable completion.
- [ ] **Implement:** use vocabulary `json<MealCompletion>` for `mealCompletion`, nullable and no
      default-derived timestamp. No new table or FK. Capture only after existing authority, revision,
      service/cancellation and replay checks. Preserve existing early-request signal behavior and
      paid-signal clearing. Add date-free help wording; no confirmation dialog.
- [ ] **Schema red/green:** in `src/schema/meal-completion.test.ts`, assert a valid snapshot can be
      inserted/read, malformed shape/day refuses, and placed/settled exception updates cannot change
      it. Include the positive control for null-to-completion on an unissued placed bill alone,
      with no unresolved payment; changing any other frozen field still refuses. Run
      `pnpm --filter @waitron/db exec vitest run src/schema/meal-completion.test.ts --reporter=dot`.
      Before adding each guard observe its specific accepted-invalid-write failure; then implement
      CHECKs/freeze trigger and verify the same assertions pass. Do not use a test-only validator.
- [ ] Generate with `pnpm --filter @waitron/db db:generate --name meal_completion` and a separate
      custom generation for trigger changes. Extend **every** working-order transition exception's
      unchanged-column list, not just its usual settle branch. Never edit shipped SQL. Inventory
      classification (`working_orders` is state), configuration export omissions, replication/full
      database restore, schema barrels, module descriptor and migrations manifest. Existing tables
      keep classification; no invented new append-only-table manifest entry. If generation rebuilds
      a table, list incoming FKs/cascades first; split add-column and CHECK generations as required.
- [ ] Rerun the focused server/db commands green; `git diff --check`; commit with `git commit -s`.

## Task 2: preserve/invalidate the fact through service and payment intent

**Files:** Extend server `meal-completion.ts`, `bill-actions.ts`, `move-bill.ts`,
`working-order.ts`, `order-groups.ts`, `bill-editing.ts`, `line-cancel.ts`, party merge and
department-transfer writers found in Task 0; released A739 `payment-receipt-context.ts` and db
`src/schema/order-payment-contexts.ts` with a fresh migration. Create server
`meal-completion.transforms.test.ts`, `meal-completion.intent.test.ts`; retain
`bill-editing.split-transfer.test.ts`, `bill-editing.bill-moves.test.ts` unchanged as controls.

**Interfaces (new):** `invalidateMealCompletion(tx, billIds: readonly string[]): Promise<void>`
clears the affected unissued family after checking unresolved accepted intent.
`readMealCompletion(tx, billId: string): Promise<MealCompletion | null>` returns the validated
snapshot. Acceptance captures automatically if complete service has no snapshot; recovery of an
accepted completed-meal intent must instead require its saved copy and report a data fault if absent. A739's server-owned accepted context gains immutable nullable
`mealCompletion`; context replay returns the original value and rejects changed intent under
the same submission. It is independent of slip and final document choices.

- [ ] **Red:** Assert exact snapshot inheritance on a pure split; same snapshots survive merge;
      missing/different snapshots invalidate affected unissued meals. Assert zone/table-only move
      preserves the original zone/day. Add dessert, restored draft, un-cancel and withdrawal cases
      clearing the whole family; price-only reduction, recipient/language, paid-signal clear and
      delivery edits keep it. Add direct writer calls as well as API cases so guards cannot exist
      only in the browser. Run `pnpm --filter @waitron/server exec vitest run
src/meal-completion.transforms.test.ts src/bill-editing.split-transfer.test.ts
src/bill-editing.bill-moves.test.ts --reporter=dot`; expected red: stale snapshot survives
      resumed service or a fresh split loses provenance. Implement the spec's decision table; rerun.
- [ ] **Red:** Accept a completed-meal card context at 27 Oct 23:55, change clock/zone, lose the
      answer and reopen it: assert the exact original snapshot. Try resumption/withdrawal/merge while
      unresolved: assert `meal.completion_in_flight` and unchanged bill, context and provider count.
      Known decline unlocks resumption without erasing the prior fact by itself. Received partial
      payment followed by resumed service/new final request uses the new date, not the old context.
      Run `pnpm --filter @waitron/server exec vitest run src/meal-completion.intent.test.ts
src/bill-payments.in-flight.test.ts --reporter=dot`; expected red: context lacks the saved fact
      or incompatible mutation succeeds. Implement context copy and domain hold, then require green.
- [ ] Add raw context-update refusal assertions to the released context suite; extend all its
      immutable-field comparisons/triggers. Preserve existing partial/unreserved edit assertions
      outside this new completed-meal hold. Commit after focused green and `git diff --check`.

## Task 3: feed every completed-meal issuance and recovery path

**Files:** Extend `packages/core/src/record-sale.ts`, fiscal `src/backend.ts`, server
`till-sale.ts`, `bill-payments.ts`, `working-order.ts`, `unpaid-departure.ts`,
`bill-payments-loop.ts`, `pending-card-recovery.ts`, relevant initiating/recovery adapters and
synthetic caller fixtures identified in Task 0. Create server `meal-completion.issuance.test.ts`
and `meal-completion.recovery.test.ts`; add core cases in `record-sale.test.ts`.

**Interfaces:** trusted `RecordSaleInput.operationDate?: string` and
`SaleForFiscalRecord.operationDate?: string` carry the validated snapshot day for this F1 flow.
No public request field accepts it. F2 retains null/no operation-date wire input; S3 provisional
paths retain their current contract. Pre-provider admission distinguishes those paths from
completed-meal F1 using `mealServiceState`, not snapshot presence. A qualifying final acceptance
creates completion automatically when absent, before provider work; arbitrary partial/early
payment attempts and invoice-identity selection do not.

- [ ] **Red:** Complete service 27 Oct 23:50 and issue 28 Oct 00:10; assert sale operationDate
      `2026-10-27`, actual issue instant/offset and backend input day. Opening is another date.
      Keep the original core timezone, issue-date, no-bill and F2 assertions; add this independently
      with explicit completion. Run `pnpm --filter @waitron/core exec vitest run
src/record-sale.test.ts --reporter=dot`; expected red: opening-day value or omitted backend day.
      Then implement only authorized pass-through/validation, leaving allocation/chain untouched.
- [ ] Add malformed/nonexistent day, snapshot instant/zone mismatch and completion-after-issue
      negative controls to the new core/server cases. Assert domain refusal before new money;
      after a captured payment assert retained money plus data fault, with no guessed invoice.
      Run those cases red/green with the same core and server commands; do not fix a backward clock
      by mutating accepted completion.
- [ ] **Red:** Exercise all five production server core call sites: cash/manual immediate;
      whole-card live; whole-card recovery; fully paid bill; unpaid departure. Include partial
      money followed by final payment, zero with no tender, reduction/cancellation/draft/send edit
      that settles a paid balance, existing-sale collection and already-issued replay. Assert exact
      dates, one sale/number, unchanged money/VAT/drawer behavior and no invented last-payer ownership.
      Run `pnpm --filter @waitron/server exec vitest run src/meal-completion.issuance.test.ts
src/adjustments-bill-payments.test.ts src/unpaid-departure.test.ts --reporter=dot`.
      Expected red: opening/recovery date or missing snapshot at a bypassing caller; adapt all callers
      through existing orchestration. Keep S3/prepay and synthetic F2 positive controls.
- [ ] **Red:** Defer provider response from 23:55 to 00:05; finalize 00:10, then simulate restart
      29 Oct and lost final answer. Assert retained operation date, actual issue/money times, one
      charge and one invoice. Exercise pending loop and attestation plus restart stale-mark release.
      Missing accepted evidence after charge must preserve money, show a data fault, and never file
      a guessed date or charge again. With complete service and no snapshot, fresh final acceptance must capture automatically before
      provider work; an incomplete-service control must keep S3 behavior. Malformed existing evidence
      refuses before provider work rather than being silently replaced.
      Run `pnpm --filter @waitron/server exec vitest run src/meal-completion.recovery.test.ts
src/bill-payments.card.test.ts src/bill-payments-loop.test.ts src/till-sale-integrated.db.test.ts
src/pending-card-recovery.test.ts src/bill-payments.issue-clock.test.ts --reporter=dot`.
      Expected red: current finalization cannot retain the accepted day. Implement and rerun green.
- [ ] Reconfirm all direct utility/readiness/test-host callers and substitution/correction controls
      after the input extension. Do not change F3/R5 writers, historical sales or protected assertions.
      Commit after focused green and `git diff --check`.

## Task 4: persist and send the operation day, only within the exact H2 exception

**Files:** fiscal-verifactu `src/backend.ts`, `src/schema/registros.ts`, `src/registro-row.ts`,
`src/drain.ts`, `src/reconcile.ts`, new generated `drizzle/` migration. Create
`src/operation-date.test.ts`, `src/operation-date.drain.test.ts`; extend existing
`registro-row.roundtrip.test.ts`, `reconcile.period.test.ts` with additional cases only.

- [ ] Re-read the recorded exception against this path set. If absent/insufficient, **BLOCKED**;
      do not proceed with a receipt-only PR or edit a protected test to make the change permissible.
- [ ] **Red:** Through real backend/store/reconstruction and installed serializer, assert differing
      dates yield `FechaOperacion` `27-10-2026`, same-day omits it, raw POS day remains ISO, and
      `fromRegistroRow` after closing/reopening the database reproduces the field. Test issue offsets
      +01:00, negative offset and a capture/issue DST difference. Expected red: missing wire/stored
      field, not just a passing mocked backend argument. Run `pnpm --filter @waitron/fiscal-verifactu
exec vitest run src/operation-date.test.ts src/registro-row.roundtrip.test.ts --reporter=dot`.
      Then add the nullable field/mapping and backend input. Use the unchanged library builder;
      verify the day-to-Date conversion by its actual output. In a new standalone library-input
      case, vary only FechaOperacion with identical issue/amount/predecessor inputs and assert equal
      huellas. This is an execution check, not permission to change hash code or golden fixtures.
      No new chain or hash implementation.
- [ ] **Red:** File 31 Dec operation/1 Jan issue, restart and drain through the real client with
      synthetic AEAT HTTP replies. Assert outbound date, targeted consulta period and reconciliation
      period use the retained operation month/year, while IDFactura/QR still use issue date. Include
      anulación lookup of the original operation period and F2/no-field positive controls. Run
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/operation-date.drain.test.ts
src/reconcile.period.test.ts src/drain.test.ts --reporter=dot`; expected red: missing date or
      issue-month selection. Change only the approved readers/mappings and rerun green.
- [ ] Generate the new fiscal migration with its package `db:generate`; preserve existing rows
      as null, without reconstructing or rewriting historical invoices. Audit append-only triggers,
      schema projections/raw row types, transfer omissions, module migration descriptor and
      `packages/migrations/migrations.manifest.json` against actual generation. Disclose first-start
      trigger restoration if schema changes alter generated trigger definitions. New columns must
      be frozen by every relevant update exception; no manifest/guard allowlist change by habit.
- [ ] Run the existing protected pair **UNEDITED**:
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
src/inmutabilidad.test.ts --reporter=dot`. Require nonzero PASS counts and unchanged protected
      diff. Also run unedited root migration guards:
      `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts
scripts/migration-upgrade.test.ts --reporter=dot`. If a guard change is needed, stop for its
      exact scope rather than weakening it. Rebase migration collisions by regeneration, never by
      hand editing journals/snapshots. Commit only after those checks and `git diff --check` pass.

## Task 5: qualify saved-date presentation, omissions and release

**Files:** existing server `receipt-issuer.ts`, `invoice-document.ts`, `transaction-receipt.ts`,
`receipt-document.ts`, till `screens/till-ticket-view.ts` only where tests expose a gap; existing
test siblings `invoice-document.test.ts`, `receipt-document.test.ts`,
`transaction-receipt-api.test.ts`, `till-api.receipt.test.ts`, till
`screens/till-ticket-view.test.ts`, `till-app-bill-payments.test.ts`.
New server `meal-completion.documents.test.ts`. Update EN/ES `guide/.../table-service.md`,
affected help and current prose claims; driver owns backlog/research status. No new Record final
bill action, payment prerequisite or date control is introduced.

- [ ] **Red:** Add end-27/issue-28 thermal 58/80 mm, A4, email/PDF data and till cases: both dates,
      same saved identity, no extra operation row on same-day F1 and no new F2 row. Reprint after
      clock/zone/service changes must reproduce original dates. Receipt/Invoice/Email/None and
      Full invoice selection after F2 must never capture another meal end, issue or charge.
      Run `pnpm --filter @waitron/server exec vitest run src/meal-completion.documents.test.ts
src/invoice-document.test.ts src/receipt-document.test.ts src/transaction-receipt-api.test.ts
src/till-api.receipt.test.ts --reporter=dot` and separately
      `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts
src/till-app-bill-payments.test.ts --reporter=dot`.
      Existing renderers may already pass once Task 3 supplies the new data; record that green
      honestly and make no unnecessary renderer change. Any newly exposed rendering gap gets its
      own observed failure before a fix. Retain original assertions, including independent names.
- [ ] Qualify actual rendered thermal/A4 documents and till in EN/ES, both themes and phone width;
      assert native controls offer no date choice. Use `wa-wt demo <registered-worktree-name>` for
      UI work and measure browser headroom first. Inspect rendered PDF/thermal raster artifacts;
      paper/inbox delivery needs separate physical evidence, not a queue-status claim. Update shared
      EN/ES guide anchors and explain final request versus an early bill signal and separate Finish.
- [ ] Add browser/server regression cases in `till-app-bill-payments.test.ts` and
      `meal-completion.issuance.test.ts`: complete service with no bill-request signal, and an early
      signal followed by completed service, both accept final payment directly and capture before
      provider work. Repeat acceptance without resumed service and assert the exact first snapshot;
      an incomplete-service/prepay control keeps S3 behavior. Assert no new date field, required action
      or extra payment submission. Observe the wrong/missing snapshot assertion fail, then implement
      and rerun green. UI only changes if these behavioral assertions expose an actual gap.
- [ ] In an independently installed disposable candidate, remove one new protection at a time:
      early-service qualification, resumption invalidation, in-flight hold, accepted-context copy,
      recovery use of the copy, row round-trip and operation-period selection. Run the corresponding
      new named case from Tasks 1–4; require wrong value/write/provider count to fail its assertion.
      A compile error or an unrelated refusal is not proof. Restore and rerun green; retain logs.
      Positive controls must still allow early bill signals, ordinary F2/prepay, identical replay,
      safe same-meal split, known-decline recovery and issued-invoice collection. Existing guards and
      protected fiscal tests stay unedited even in omission experiments.
- [ ] Audit all changed prose across the full base-to-tip paths for opening-day, payment-day,
      process-zone and “records carry no FechaOperacion” claims. Add dated pointers to historical
      docs; do not rewrite research or imply S3/S4 is resolved. Re-run only suites affected by later
      changes or observed failures. Check exits and nonzero counts; no whole-workspace local run.
- [ ] `git diff --check`; commit with `git commit -s`. Announce **ready to run finish-branch**.
      Driver performs one Claude run-it whole-branch review in a complete temporary checkout after
      initial rebase, triages findings, runs the normal pre-push hook and waits for required
      current-head CI coverage/merge jobs. Keep `98/98/98/95` and existing mutation floors; no hook
      bypass or protected-test edit. One complete fiscal PR, no partial publication. **Owner lands**.

Self-review: Tasks 1–3 cover capture, every caller, transforms and recovery; Task 4 owns the
blocked fiscal representation and month boundary; Task 5 covers surfaces, omission controls
and release. H2 and released path ownership remain explicit gates; the unrecorded physical-end limit stays visible,
not unchecked implementation tasks disguised as completion.
