# W41s-7: conflict recovery on the current contract

> **For agentic workers:** Use `superpowers:executing-plans`, inline, task by task. Before future code or tests, read the TDD skill. Write a failing behaviour test, observe its stated failure, implement the minimum, and rerun. Commit each completed slice with `git commit -s`.

**Goal:** Preserve a confirmed conflict, stop issuance on its colliding identity, and switch automatically
only with the approved outside evidence; otherwise require authenticated administrator recovery.

**Architecture:** Keep response persistence in the fiscal drain transaction. Recover from committed cases
in a separate operation, using the existing allocation writer only after its item-specific gate. Naming,
operator authentication, outside selling authority and legal resolution remain distinct contracts.

**Stack:** TypeScript, Vitest's Node project, `useVenueDb`, SQLite transactions, module operation preparation.

**Authorities:** Original [plan, Task 7](2026-10-04-fiscal-prevention-and-offline-recovery.md#task-7-conditional-automatic-conflict-recovery); approved [spec, §6 and §9.3](../specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md); dated replacements in [A679](../specs/2026-10-16-a679-hour-coded-series-design.md), [A947 §6.5](../specs/2026-10-21-a947-two-box-failover-design.md), and [A1207](2026-10-29-a1207-minute-not-in-database.md).

## Constraints and settled decisions

- Campaign execution, finish and land are authorised by the owner's 1 November instruction. Do not add a full-design approval gate. The current docs deliverable needs one fresh plan review; future W41s code needs **two completed Claude run-it reviews**, resolved findings, normal hook and current-head CI.
- The owner lifted the one-fiscal-branch and overlap waits. Do not wait for A696; the second lander rebases overlapping work and reruns focused checks. A947 3a is in flight: do not invent a competing node table or authority format.
- RUNNER H2 remains: no unauthorised changes to chain logic, invoice-number allocation, `registerSif`, `restoreFiscal`, alta builders or `registros_facturacion`. Golden huella and `inmutabilidad` assertions stay unedited. W41s-4's permission is not this item's permission.
- A new identity is the five-character UTC-minute name. Use `createHourSelection`, including current
  clock/history checks; no S/P/E allocator, random fallback, `maximum + 1`, global monotonic floor or new naming algorithm.
- The automatic path requires an authenticated, unexpired **outside** sole-seller grant, acknowledgement that the previous seller was fenced, an independently consumable allocation and durable outside switch history covering the rolling 24 hours. Naming alone supplies none of these facts.
- The first definite conflict on the active identity stops new issuance and requires recovery. This is separate from the three-refusal filing brake. A definite annulled duplicate requires the stop and administrator flow even though it cannot qualify for automatic switching.
- Persist a lookup-confirmed conflict before attempting activation. A matching duplicate, missing lookup,
  unavailable AEAT or retired-installation conflict never initiates an automatic switch of the active installation.
- A switch does not accept the conflicting original, close its case, settle missing history or establish a legal remedy. Preserve D5/Q34's separate adviser/probe gates. Run no external probe in this item.
- A backward clock never clears the 24-hour guard. Missing, incomplete or uncertain outside history requires administrator recovery; elapsed time alone never releases a held second conflict.

## Current source remap (inspection only)

Inspected HEAD `e9967ef3fac9497a4071cc3a36febf563daf22f6`. `git show --no-patch` identifies Task 4 as #1700 / `59d51560f87c652c91b9b131e678180ffad1c773`, and Task 6 as #1717 / `13cbf8387b62c9d6684e38bd25874ad1bdda6eb0`. These are source observations, not runtime qualification. Re-anchor the following symbols after rebase.

| Original role           | Current source and implication                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conflict classification | `packages/fiscal-verifactu/src/drain.ts:1642` `routeB` compares fingerprint and installation; `:1726` `handleDuplicate` saves rejection and opens a case. Route A's annulled duplicate is not a lookup-confirmed mismatch.                                                                                      |
| Response transaction    | `drain.ts:332` resolves lookups before `:334` `countOnCommit` persists the whole reply. The surrounding submit catch also backs off claims; recovery failure must not enter that catch after a committed reply.                                                                                                 |
| Durable case            | `filing-cases.ts:52` `openFilingCase` returns an existing case unchanged; `:110` `recordCaseEvent` records person actions; `:181` reports status. Do not label a machine switch as a person's resolution.                                                                                                       |
| Stored evidence         | `src/schema/filing-cases.ts:19` currently declares code/message/CSV only. It does not persist a typed lookup-mismatch candidate or outside authority.                                                                                                                                                           |
| Task 4 writer           | `allocation.ts:139` authenticates activation; `:152` allows recovery actions restore/promote; `:345` `activate` replays retained results; `:430` retires SIF and series, resets `cadenas`, and inserts the replacement allocation. This is the H2 crossing.                                                     |
| Allocation admission    | `allocation-operation.ts:100` `withCollectedModuleAllocation` accepts setup/restore/promote; `allocation-preparation.ts:66` consumes a callback-scoped prepared operation. Do not disguise conflict recovery as restore or promotion.                                                                           |
| Current name admission  | `hour-recovery-preparation.ts:33` authenticates restore/promote operators; `:67` builds minute allocation input; `:173` prepares the exact selected input. `allocation-envelope.ts:292` scopes hour admission to setup/restore/promote.                                                                         |
| Current selector        | `hour-selection.ts:441` distinguishes setup/restore settling; `:453` skips used minutes; `:497` records the current minute. Existing-attempt and second-clock checks still apply.                                                                                                                               |
| Host preparation        | `hosted-hour-recovery.ts:30`, `hour-configuration.ts:32` connect module preparation. `src/index.ts:8` exports the current hour operations, rather than historical `allocation-configuration.ts` operations.                                                                                                     |
| Actual descriptor       | No fiscal `descriptor.ts` was found by `rg --files --hidden -g '!**/node_modules/**' -g '!**/.git/**'`. The fiscal descriptor is `packages/composition/src/modules.ts:289`, with operations, fiscal slot and restore contributions at `:302`.                                                                   |
| Actual live drain host  | `apps/server/src/boot.ts:2952` calls the enabled fiscal slot; `packages/fiscal-verifactu/src/slot.ts:79` constructs the transport and calls the drain. Neither accepts a conflict-recovery issuer today.                                                                                                        |
| Actual restore hosts    | `apps/server/src/recovery-preparation.ts:83` prepares selected-copy restore; `first-setup-backup-recovery.ts:663` supplies isolation from operator answers. `recovery-module-operation.ts` consumes prepared restore input. `restore.ts` in the fiscal package aliases `allocated-lifecycle.ts`'s restore hook. |
| Actual promotion host   | `apps/server/src/node-operation-preparation.ts:89` supplies recovery facts after authentication; `:129` checks operator attestation. `promote.ts:39` defines that attestation, not an acknowledged remote fence.                                                                                                |
| Operator carrier        | `packages/module/src/operation-authority.ts:29` creates a callback-scoped binding after host authentication; `operation-input.ts:28` checks it. This carrier performs no outside grant verification.                                                                                                            |
| Sale consumer           | `apps/server/src/till-sale.ts:995` selects inside the issuance transaction; `invoice-selection.ts:105` / `:126` read live standard/full series. `working-order.ts:7060` does the same for invoice-first issuance. `packages/core/src/record-sale.ts:270` allocates the number.                                  |

Original `apps/server/src/fiscal-recovery.ts` and `chain-restart.ts` do not exist in this tree. Create the files named below deliberately; do not revive those historical interfaces by assumption.

## Actual blockers and gate before implementation

Inspection found membership/fencing mechanisms, but no qualified issuer of the complete automatic-switch evidence.
`packages/membership/src/types.ts` contains signed roles/terms, without a sole-seller lease expiry or
previous-seller acknowledgement. `apps/server/src/promote.ts:58` checks a local attestation.
`cloud-evidence.ts:299` describes retained receipts as snapshots; its payload has no sole-seller lease
expiry or previous-seller acknowledgement, and its allocation parser requires `C` plus six digits (`:158`).
These inspected contracts do not supply the complete minute-allocation automatic-recovery evidence.

**Gate A, required before Tasks 3–4 or any protected change:** obtain item-specific H2 permission for a new
`conflict-switch` action to reach `activateAuthenticatedAllocation(...)` and `activate(...)` in
`allocation.ts:139,345`, through matching admission in `allocation-operation.ts` and `allocation-envelope.ts`.
Limit the permission to rotating the affected node's SIF/series and resetting its chain head through that
existing writer, after the saved conflict and qualified outside authorisation. The approved issuance-stop
requirement includes read-only preflights before construction in `backend.ts`'s `recordSale` (`:270`),
`recordVoid` (`:387`), `recordCorrection` (`:464`) and `recordSubstitution` (`:566`); it does not itself
require a new scope permission. Do not change record contents, hashes,
record schema, counter allocation logic or `registerSif`/`restoreFiscal`. If more is needed, gate the exact operation.

**Gate B, required before production activation:** decide the real issuer/integration for all four outside
facts and its freshness/revocation checks. Specify taxpayer/software/environment/node/event/source/identity-set
binding, previous-seller acknowledgement, independent single consumption, complete outside 24-hour history,
time uncertainty and restart reconciliation. Decide how a current minute selected by A1207 becomes independently
consumable without changing its naming rules. Reuse A947 3a's eventual storage ownership; a local JSON file,
restored role bit, supplied `true`, synthetic source or old cloud receipt is not a substitute.
The issuer must retain the case-to-event binding and held decisions across retries; a new pass cannot mint
a fresh event to evade the rolling limit. An incomplete switch attempt remains reserved against a concurrent switch.

Until both gates close, Tasks 1–2 may produce a **dormant policy and durable-candidate checkpoint only**,
without a live switch call or claims that runtime Task 7 is complete. Task 2 alone does not stop new issuance;
do not publish that checkpoint as completed conflict recovery. Keep Tasks 3–4 and their acceptance criteria open.
Task 2 needs the new evidence ledger specified below; it does not need an authority protocol or an activation migration.

## Review focus

Each condition has an owning test below: an issuer response arrives after expiry (Task 3); two conflicts race on one active SIF (Task 3); a process dies between response commit and switch scheduling (Task 2); capture finishes during activation (Task 4); history is restored or the wall clock moves backwards (Tasks 1 and 3).

### Task 1: express eligibility without inventing authority

**Create:** `packages/fiscal-verifactu/src/conflict-recovery-policy.ts` and `conflict-recovery-policy.test.ts`. No runtime import/export wiring.

**Interface:** `decideConflictRecovery(facts: ConflictPolicyFacts, nowMs: number): ConflictDecision`.
`ConflictDecision` is `{ kind: "irrelevant" } | { kind: "administrator"; reason: ConflictReason } | { kind: "eligible" }`.
`ConflictReason` is the union of `authority_missing`, `authority_scope_mismatch`, `authority_expired`,
`fence_unacknowledged`, `allocation_unavailable`, `history_uncertain`, `switch_within_24h`, `held_event`.
`ConflictPolicyFacts` contains `lookup: "mismatch" | "match" | "unknown"`, `annulledConflict: boolean`, `active: boolean`,
`automaticAttempt: "new" | "held"`, `scopeMatches: boolean`,
`grant: null | { notBeforeMs: number; expiresAtMs: number }`, `fenceAcknowledged: boolean`,
`allocationConsumable: boolean`, and `history: null | { complete: boolean; observedAtMs: number; switchTimesMs: readonly number[] }`.
These are synthetic policy observations, **not credentials or verified proof**. The future trusted adapter
owns verification and binds the observations; never feed request JSON directly to activation through this helper.

- [ ] Write table-driven failures: active mismatch with every fact present and no prior switch is eligible; a match, an unresolved lookup without a definite conflict, and retired cases are irrelevant. An active definite annulled conflict yields administrator recovery, never eligible. Every single absent authority fact independently yields administrator recovery with its specific reason.
- [ ] Add grant tests at not-before, just before expiry and exactly expiry; only `notBeforeMs <= nowMs < expiresAtMs` passes. A mismatched scope refuses even with otherwise valid facts.
- [ ] Add history tests at 24 hours minus 1 ms (refuse) and exactly 24 hours (eligible for a new event);
      future switch time, backwards time before the outside observation, non-finite values and incomplete/absent
      history all refuse. Recreated local state cannot supply missing outside history. `automaticAttempt: "held"`
      remains administrator-only after the boundary; time alone cannot create a newly authorised event.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/conflict-recovery-policy.test.ts`.
      Require a behavioural red, such as expected eligible but received administrator from a compile-only stub,
      rather than an import/setup failure. Implement the policy, rerun and require a nonzero passing Tests count.
- [ ] Commit with `git commit -s -m "Define dormant conflict recovery eligibility"`. State that the positive case is synthetic and runtime activation remains disconnected.

### Task 2: persist a restartable conflict candidate with the response

**Modify:** `packages/fiscal-verifactu/src/drain.ts`, `filing-cases.ts`, the fiscal module's schema, classification and migration descriptor.
**Create/test:** `packages/fiscal-verifactu/src/schema/conflict-evidence.ts`, `conflict-evidence.ts`, `drain.conflict-recovery.test.ts`; retain `drain.cases.test.ts`'s assertions.

**Interfaces:** add an append-only `fiscal_conflict_evidence` ledger independently of case creation. Its columns are `id`, `registro_id` referencing the immutable original, `case_id` referencing its existing or newly opened case, `attempt` holding the claimed envio's incremented `intentos`, `cause` (`fiscal.huella_divergente` or `fiscal.duplicado_anulado`), JSON `evidence` and `recorded_at`. Declare a unique index on `(registro_id, attempt, cause)` and name that target on conflict handling. Repeated application of the same reply returns its retained observation; a later attempt may add evidence without editing the original case.
`ConflictEvidence` contains the exact response line/CSV plus either `{ kind: "lookup-mismatch"; storedFingerprint: string; storedInstallation: string | null }` or `{ kind: "annulled" }`. Extend `routeB`'s result to carry those observed values for a confirmed mismatch; do not infer a missing installation value. No credentials go in evidence or logs.
`readActiveConflicts(tx: Transaction, nodeId: string): Promise<readonly ActiveConflict[]>` joins observations to originals and the node's current SIF. Each result carries `evidenceId`, `caseId`, `registroId`, `sifId`, original fingerprint and cause; deduplicate multiple observations of one original. `ConflictCandidate` is an `ActiveConflict` with lookup-mismatch evidence; `readConflictRecoveryCandidates(tx: Transaction, nodeId: string): Promise<readonly ConflictCandidate[]>` projects only those results for automatic eligibility. Annulled observations still establish the issuance stop and administrator need.

- [ ] Reproduce a Route B mismatch through the real client/fake transport. Assert exact original, rejected ack, code/message/CSV, open case and committed lookup observation. First run red, then implement the smallest persistence change.
- [ ] Open a case for an earlier outcome, then establish a mismatch on a later attempt. Assert the old append-only case is byte-identical and a new observation/candidate exists. Repeat the same reply and assert no duplicate observation. Cover Route A with an existing case too.
- [ ] Matching lookup, lookup throw, absent result and ordinary refusal produce no conflict observation. Route A produces an annulled observation and active stop, but no automatic candidate. Retired-SIF conflicts preserve evidence without stopping or switching the current SIF. Keep unrelated reply lines and old-chain submission outcomes unchanged.
- [ ] Inject failure after case/evidence writes: all response changes roll back. After reply commit, a new reader finds the observation without another submit. A separate failing post-commit consumer leaves rejection, response evidence and case unchanged.
- [ ] Generate the new migration rather than editing shipped SQL. Classify the new table as ledger, add `appendOnly()`, include it in the exported migration descriptor and manifest, and add only the new table's exact enumerating entries under the standing W41s table-list approval. Record those lines as FYI. Run the schema, classification, migration-match and append-only guards named in CLAUDE.md; prove the new ledger rejects update/delete. Its references are within the fiscal set, not to node-local tables.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/drain.conflict-recovery.test.ts` red then green, followed by `src/drain.cases.test.ts src/filing-cases.test.ts`. Recovery execution stays outside the submit catch and response transaction; this checkpoint calls no activation.
- [ ] Commit with `git commit -s -m "Retain append-only conflict observations with filing replies"`. This dormant checkpoint does not implement issuance protection or completed recovery.

### Task 3: qualified authorisation and atomic activation (Gates A and B)

**Create:** `packages/fiscal-verifactu/src/conflict-recovery.ts`, `conflict-recovery.test.ts`.
**Modify only within the granted scope:** `allocation.ts`, `allocation-operation.ts`, `allocation-envelope.ts`, `hour-recovery-preparation.ts`, `hour-configuration.ts`; extend their existing tests. Add a host adapter only after Gate B names its real issuer and storage contract.

**Interfaces:** `ConflictRecoveryRequest = ConflictCandidate & { binding: OperationBinding }`, with `module: "fiscal-verifactu"`, `action: "conflict-switch"`, a stable unpredictable `eventId`, source bound to the original/case and exact target node.
`ConflictRecoveryAuthorizer.withPrepared<T>(request: ConflictRecoveryRequest, run: (operation: ModuleOperationInput) => Promise<T>): Promise<T | null>` returns null for absent/refused evidence; its positive callback exists only while issuer evidence and current-minute admission remain valid.
`recoverConflict(deps: { db: Database; node: ProvisionedNode; authorizer: ConflictRecoveryAuthorizer }, request: ConflictRecoveryRequest): Promise<ActivationResult | null>`
reads committed evidence, enters that callback, rechecks the active SIF for a new switch and activates in one `withTransaction`.
For committed replay, validate the exact retained result and fresh outside authorisation before the new-switch
eligibility check; do not reject a legitimate replay because the original SIF was retired by that same event.
Reuse `activatePreparedModuleAllocation(tx, node, operation)` and its exact retained result. Do not issue
`OperationAuthority` with a fabricated administrator, reuse a restore action or turn policy eligibility into authority.

- [ ] Before implementation, record the two gates' concrete answers and real adapter path in this plan. If either answer is missing, stop this task, retaining the dormant checkpoint and the remaining integration criteria.
- [ ] Write failing real-database cases for a qualified active conflict: one new SIF/all configured purposes, old series retired, one allocation result and reset head. Snapshot the original record bytes and rejected ack; they stay unchanged and its case stays open. Matching/retired/unknown cases perform zero activations.
- [ ] Write refusing controls for forged, expired, wrong-node/taxpayer/environment/event/source/identity-set
      evidence; missing acknowledgement; unavailable history; revoked authority during an awaited read; and
      caller mutation of supplied evidence. The authorizer returns null without entering its callback when proof
      is refused; invalid/expired prepared admission raises the existing domain refusal. Assert unchanged SIF/head/series/counters.
- [ ] Test durable ordering with an independent read after reply commit and before outside consumption. Fail local activation after outside consumption: the response survives and the receipt stays spent. Retry with fresh authority and the same proven event: return the exact committed result if present, without another identity or counter reset. A proven noncommit, local rollback or uncertain/lost local result leaves the outside allocation consumed and requires a distinct allocation under administrator recovery. Only an exact proven committed replay may return the retained result; issuer retry rules cannot broaden this policy.
- [ ] Race two eligible cases on one SIF: at most one activates; the loser rereads the now-retired SIF and cannot allocate again. Restart with local history rolled back while outside history retains a switch: refuse another switch inside 24 hours. Expired evidence after issuer latency refuses before writes.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/conflict-recovery.test.ts` red, implement minimally, then green. Run `src/hour-activation.test.ts`, `src/allocation-operation.test.ts`, `src/hour-recovery-preparation.test.ts`, `src/hour-selection.test.ts` with the same prefix. Preserve their authentication, exact replay and A1207 controls.
- [ ] Commit with `git commit -s -m "Activate a conflict replacement only with outside authority"` after the real issuer tests pass; synthetic positives alone do not close this task.

### Task 4: connect the live host and protect issuance (Gates A and B)

**Modify:** `packages/fiscal/src/backend.ts`, `packages/fiscal/src/contribution.ts`, `packages/fiscal-verifactu/src/slot.ts`, `apps/server/src/boot.ts` for an opaque optional duty callback; keep fiscal-specific details in the module. Modify `backend.ts` only for the authorised refusal before construction. **Create:** `apps/server/src/conflict-recovery.test.ts` and the live administrator entry point specified below. **Extend:** `till-sale-integrated.db.test.ts`, `till-api.fiscal-sale-paths.test.ts`.

**Interface:** optional `FiscalDutyDeps.recoverConflicts?: (now: Date) => Promise<void>` runs after the drain's
response transaction has returned, including on a later restart/pass with no due submit. Its configured closure
owns the qualified module adapter. Missing callback never activates. Add the generic `FiscalBackend.refuseNewIssuance(tx: Transaction, nodeId: NodeId): Promise<void>`; the Veri*Factu implementation reads active conflict evidence and the no-filing implementation is a no-op. Grow necessary test fakes without weakening their checks. Create
`assertNoActiveConflict(tx: Transaction, nodeId: string): Promise<void>` in `conflict-recovery.ts`;
any active definite conflict returned by `readActiveConflicts`, including an annulled duplicate, throws
`sif.allocation_invalid` with reason `conflict_requires_administrator` before construction. Include earlier
active `fiscal.huella_divergente` and `fiscal.duplicado_anulado` cases without new ledger evidence;
ineligibility for automatic activation must not permit colliding issuance.
A resolved-case note alone cannot lift this stop while the same SIF remains active.

- [ ] First fail a boot-host test proving committed candidates are revisited without another AEAT response;
      a throwing recovery callback does not back off or rewrite an already persisted response. Reconcile pending
      outside events and committed results before scanning new active candidates, including a switch whose SIF
      already rotated before the process died. Trace the slot and generic duty's other consumers before extending the contract.
- [ ] First fail issuance cases after exactly one committed active conflict, separately for lookup mismatch and annulled duplicate: cash, card initiation, invoice-first, correction and substitution paths cannot issue on it; replays keep their recorded facts; inspecting orders/evidence stays available. Call `refuseNewIssuance` after committed replay recovery and before new money, drawer work or number allocation. Extend the existing preflight turns beside `refuseWhileClockBehind` in `till-sale.ts` (cash, integrated P1 and refund preparation) and `bill-payments.ts`; trace both refund recovery loops and all alternative provider-send callers before editing. Keep the final fiscal-builder check for races. Inventory `backend.ts`'s `recordSale`, `recordVoid`, `recordCorrection` and `recordSubstitution`, with a refusing behavioural case for each applicable path. Assert provider collect/refund and drawer spies have zero new calls on a preflight refusal. If a capture already left P1 before the conflict, retain its actual money result and recoverable unfiled payment, refuse only the colliding invoice, never charge again, and finalise once under the fresh identity. A final-builder refusal must not roll back the only record of captured money or report the capture as declined. Gate any additional protected-site change before editing it.
      Keep refund/cancellation accounting independent of held fiscal issuance; do not classify a legal remedy
      or change surviving old-chain filing policy through this refusal guard.
- [ ] First fail a queue-order test using promises rather than sleeps: hold the actual authorised activation transaction, queue a sale behind it, commit, then release the sale. Assert its live series id, new minute suffix, number 1, new SIF and one fiscal record; old counters and original conflict bytes are unchanged. On activation rollback, assert the queued sale refuses the colliding identity and consumes no number.
- [ ] Retain `till-sale-integrated.db.test.ts:993`'s card-capture overlap assertions; add the qualified activation test rather than substituting its manual series edit as proof of real activation. Cover standard/full purposes, an already-issued sale replay after switching, and another node's unaffected series.
- [ ] Implement a distinct non-destructive live administrator procedure; promotion of an already-primary node and selected-backup restore are not this procedure. Gate B must specify the module-owned API/screen contribution and its exact host bridge before this task starts. Its required operation is `recoverActiveConflict(request: { evidenceId: string; eventId: string; targetNodeId: NodeId; oldMachineOffline: true; noParallelRecovery: true }, authority: OperationAuthority): Promise<ActivationResult>` on the current live database, bound to `action: "conflict-switch"`. Use fresh current recovery-key authentication over HTTPS, under the existing owner decision allowing that key alone to authorise offline recovery; retain recovery-key attribution instead of inventing a person. Keep the key out of the persisted request, logs and public pages. The screen shows the conflict, explains isolation and preservation of orders, offers the current minute/clock procedure and a safe Stop, and retries its same committed event. Missing/wrong/replaced key and isolation refusal write nothing. A valid administrator recovery may proceed inside 24 hours without claiming outside automatic authority. Assert current orders, payments, cases and original record bytes survive and no archive is staged, database replaced or `alreadyPrimary` shortcut taken. Real Chromium/a11y coverage in both themes and EN/ES at phone/desktop widths is required for this new entry point. The plan is not ready for this task until Gate B supplies those concrete route/component files and interfaces; do not substitute an unrelated restore screen.
- [ ] Keep surviving old-chain pending records distinct from missing history and new issuance. Retain `drain.cases.test.ts:798` outcomes around a conflict and unknown-lookup ordering; do not loosen them or infer legal clearance from the fake service. D5/Q34 remains a separate release gate for any changed old-chain filing policy.
- [ ] Run the new server file red, implement the host/refusal wiring, then green. Run the focused commands below, update affected developer/operator guides in English and Spanish, and retain the unresolved issuer/legal decisions explicitly if any remain.
- [ ] Commit with `git commit -s -m "Connect authorised conflict recovery and guard new issuance"` only when full integration acceptance passes.

## Focused verification and completion

Paths and selectors below were checked against source/configuration, **not executed by this plan author**.
Fiscal has a `node` project; server uses its default project. Use `useVenueDb`, controlled compatible clocks,
fresh database ownership and real client/fake transport; never an external AEAT endpoint.
Check each exit and nonzero Tests count.

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/conflict-recovery-policy.test.ts src/drain.conflict-recovery.test.ts src/conflict-recovery.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/drain.cases.test.ts src/drain.test.ts src/filing-cases.test.ts src/hour-activation.test.ts src/allocation-operation.test.ts src/hour-recovery-preparation.test.ts src/hour-selection.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/server exec vitest run src/conflict-recovery.test.ts src/till-sale-integrated.db.test.ts src/till-api.fiscal-sale-paths.test.ts
pnpm --filter @waitron/server exec vitest run src/hour-promotion.test.ts src/recovery-module-operation.fiscal.test.ts src/restore-operation-preparation.test.ts src/restore-fiscal-e2e.test.ts
```

- [ ] Run only commands relevant to the built slice; proposed new files exist only after their tasks. Preserve all protected assertions. No workspace-wide local suite; CI owns required package coverage. Follow the normal hook and check CI selection and successful coverage jobs on the exact head.
- [ ] Prove each new eligibility/refusal guard by deleting it in an isolated disposable checkout and observing its named behavioural assertion fail; retain legitimate accepting controls. Do not mutate protected golden fixtures or weaken existing guards.
- [x] Fresh-context plan review completed on 1 November; its five findings are corrected in this remap. Source inspection is not runtime qualification. For future code, complete both Claude run-it reviews against the candidate, inspect their findings, fix and rerun focused checks. Announce readiness for `finish-branch`; when executing this authorised campaign, continue finish/land under its normal lock and cleanup rules.
- [ ] Audit the complete base-to-tip prose path set, not just changed identifiers. Update stale backlog entries in the implementing change; a dormant checkpoint leaves runtime Task 7 open. Keep historical authorities intact with dated pointers.

**Scope boundary:** no new legal assurances, remote-fencing promises, allocation service, A947 implementation, speculative migration, fiscal-record rewrite or external probe. This publication changes documentation only; live recovery remains unimplemented.

**Next action:** resolve Gate A and the concrete Gate B contracts before protected integration. The completed plan review is not to be repeated solely for a rebase. The unresolved decision is the real outside issuer and minute-allocation consumption contract, plus item-specific permission for the exact conflict-switch activation named above. Gate B also needs the concrete non-destructive live entry-point design; restore/promotion are not a substitute. Tasks 1–2 are useful dormant work; they do not complete runtime Task 7.
