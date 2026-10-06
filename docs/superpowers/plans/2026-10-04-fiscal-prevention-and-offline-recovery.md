# Fiscal prevention and offline recovery (W41s) Implementation Plan

> **For agentic workers:** use `superpowers:executing-plans` for the queued task. Work inline,
> following the lane's runbook and the repository's current review rules. Use checkbox steps to
> record progress. The owner selected queue execution; this session does not implement the work.

**Status:** approved by the owner, 2026-10-04. This plan replaces the 2026-10-03 task list; it
does not inherit that list's blanket permission to change assertions or its obsolete review
instructions.

**Goal:** prevent fiscal identity reuse, support administrator-led recovery without internet,
and give operators an evidence-preserving route through rejected or conflicting submissions.

**Architecture:** independent paper or optional cloud allocations feed one local activation
operation. Issuance commits locally; filing handles each record's outcome without rebuilding
its fiscal contents. Recovery, submission and corrective actions share incident evidence but
have separate decisions about whether an action can proceed.

**Tech Stack:** the repository's TypeScript, SQLite/Drizzle, Hono and Lit stack; Vitest and real
Chromium for behavioural checks; the separate `verifactu` library for preproduction probes.

**Spec:** [approved design](../specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md).
Read it and the original design's incident research. The revised design takes precedence.

## Global constraints

- No external service is on the ordinary sale path. Declared recovery can require administrator
  action, but internet and re-enrolling selling devices cannot be prerequisites.
- Preserve original records, identities, fingerprints and links. Do not weaken append-only
  enforcement, edit a golden hash or regenerate an issued invoice to make a test pass.
- Do not use matching dates or amounts to excuse a fingerprint mismatch. Unknown, rejected,
  conflicting and legally resolved are different facts.
- No same-disk continuity file is treated as independent rollback evidence. Reservations and
  abandoned allocations remain consumed outside the restored backup.
- A new series or installation does not fence the old machine or repair missing history.
- Build the paper/emergency path independently of the optional subscription registry. The Cloud
  service is owned by `waitron-cloud`; node integration is owned here.
- Each implementation item starts with TDD: a named failing behaviour, the observed failure,
  minimal change, then the focused pass. The TDD skill is loaded before writing code or tests.
- Existing assertion changes follow the lane's current owner ruling: identify exact assertions
  and obtain the required answer. Plan approval is not an exemption. Preserve golden huella and
  `inmutabilidad` assertions unchanged.
- Any lane prohibition covering `registerSif`, `restoreFiscal`, the builders or schema remains
  in force until an item-specific scope approval is recorded. Preparing the plan does not
  silently amend RUNNER H2. Every fiscal implementation PR ends `needs-owner-review`.
- Each item must leave a working intermediate state; combine coupled schema and consumer changes
  within that item. No feature is enabled solely because a backend stub or an API test passes.
- Use one transaction for local activation, and no network call within it. Schema changes use
  generated migrations, classification and the applicable migration guards. No compatibility or
  data-migration machinery while the repository's preproduction-only rule remains in force.
- Every item updates W41s in the backlog, uses signed-off commits and the normal push hook.
  Focused local checks precede current-head CI; do not add a whole-workspace run merely to finish.

## Build while waiting for the adviser

This plan proposes continuing engineering work while answers are outstanding. A passing test
service response establishes protocol behaviour, not the legal remedy for a customer's invoice.

| Work | Development gate | Gate before enabling for real trading |
| --- | --- | --- |
| Ordering, duplicate detection, evidence retention, validation | Plan approval and ordinary task dependencies | Behavioural checks and owner-reviewed PR |
| Allocation, recovery pack and offline restore | Approved allocation contract (Task 0) | Recovery acceptance exercise; adviser questions about justification remain recorded, not assumed answered |
| Proceed after a definitive rejection (D2) | Task 1's rejected-predecessor probes | Recorded probe result supporting the chosen behaviour and owner-reviewed PR |
| Continue surviving old-chain filings after a switch (D5) | Synthetic development can proceed | Supporting probe result and Q34 answer, or an explicit owner decision on a documented assumption |
| Automatic conflict switch | Task 0's allocation/authority policy | Technical evidence; retain Q33 as an open confirmation and require an owner decision if the answer contradicts the policy |
| Corrective workflows and releasing held records | Build with synthetic records and explicit remedy selection | Q35/Q37/Q38/Q40 answers for disputed cases, or an explicit owner decision naming the case and assumption |
| Missing-history regularisation | Investigation/export tools can proceed | Q41 answer for the particular remedy; no inferred contents or automatic cancellations |

The gates apply to the disputed action, not to unrelated sales or engineering tasks. A held
case stays visible with its reason and required decision. Do not convert a temporary hold into
a promise that the invoice has been legally resolved. No enquiries are sent by a queue item.

## Review focus

1. Restore the same old backup twice with no network, no paired device and a backward clock:
   distinct allocations, no inherited permission to resume a consumed identity (Tasks 0, 4, 6).
2. Crash between external reservation, local activation and receipt delivery: no reused
   allocation, partial active-series set or duplicated surviving transaction (Tasks 4–6, 11).
3. Lose an accepted batch response, then retry beside a cancellation: no cancellation reaches an
   unrelated invoice and accepted successor replies are not discarded (Tasks 1–3).
4. Reprint an old recovery pack or use paper while another administrator is online: no reset of
   reservation history and no second allocation of a reserved name (Tasks 0, 6 and Cloud work).
5. Recover missing history after a remedy was recorded: preserve both sources and identify
   possible double accounting without silently merging chains or duplicating sales (Tasks 8–9).

## Delivery order and file ownership

Task 0 produces the allocation and recovery contract. Task 1 produces external protocol
receipts. Task 2 can proceed independently of both. Task 3 needs Tasks 1–2; Task 4 needs Task 0;
Task 5 can proceed independently; Task 6 needs Tasks 4–5; Task 7 needs Tasks 0–6. Tasks 8–9
build the corrective and investigation flow; Task 10 adds outside evidence and diagnostics;
Task 11 exercises the assembled recovery. Cloud service work is a separate workstream after
Task 0 and is not a prerequisite for the paper path.

Before each queued item, remap these paths against its starting main and check other lanes'
active work. Names under **Create** are proposed new files. Repository-relative paths below
refer to Waitron unless the task explicitly names another repository.

## Task 0: resolve the allocation and recovery contract

**Deliverable:** a reviewed design appendix that supplies concrete formats and failure
decisions before identity or recovery code changes. This is a documentation task, not a
placeholder instruction to an implementer to choose a scheme while coding.

**Files:** update the approved spec; read `packages/fiscal-verifactu/src/schema/sif.ts`,
`registro-sif.ts`, `reserved-series.ts`, `provisioning.ts`, `restore.ts`,
`packages/db/src/schema/series.ts`, `packages/module/src/restore.ts`,
`apps/server/src/restore.ts`, `restore-request.ts`, `promote.ts` and `adopt.ts`.

- [ ] Trace every installation-number, series-purpose, restore-hook and reserved-state consumer
  across the whole tree. Current `SifRegistration.numeroInstalacion` is numeric while the library
  wire field is text; record the complete consequence of adopting an emergency string identity.
- [ ] Specify the short, paper-reserved, cloud-reserved and emergency naming spaces; their
  taxpayer/software/environment scope; character/length bounds including the invoice counter;
  and the emergency randomness source and collision assumption. Validate candidates against the
  library validator and schemas, not a comment's claimed limit. Give concrete printable examples.
- [ ] Specify paper authority across venues, consumption before use, subscription transition,
  reserved paper blocks, stale/reprinted packs and exhausted or lost allocation history. No
  fallback may choose a short name merely because it is absent from the restored database.
- [ ] Define interrupted recovery: what evidence ties an allocation to this recovery, which
  retries reuse that same activation result, and when an uncertain attempt burns the allocation.
  An event ID inside the restored database alone cannot authorise replay on a second box.
- [ ] Define selling authority for automatic conflict recovery and the administrator alternative.
  State what the venue can do while awaiting that intervention; never silently continue issuing
  known-colliding numbers. The 24-hour automatic-switch guard must survive the policy's supported
  recovery cases or be explicitly described as local evidence only.
- [ ] Freeze the shared contract: `FiscalAllocation` carries allocation ID, taxpayer, software,
  environment, installation identity, all series and purposes, source and reservation evidence;
  `RecoveryApproval` carries event ID, operator, old-machine-offline/no-parallel-recovery
  confirmations and evidence. Neither carries the break-the-glass key. Define typed rejection
  cases and the generic module seat carrying these opaque fiscal values through restore/setup.
- [ ] Commit the appendix and obtain the owner's review. Record its exact commit in dependent
  queue items, including the narrow scope exception needed under RUNNER H2. Task 2 need not wait.

## Task 1: establish AEAT protocol behaviour

**Repository:** `verifactu`. **Files:** `scripts/live-aeat.mjs`, `scripts/live-aeat.test.mjs`,
`.github/workflows/live-aeat.yml`; record results in this spec's §7 as a dated receipt.

- [ ] Add test-first synthetic probe builders for: rejected first record with successors in one
  batch; successor in a later batch; absent-original cancellation with `SinRegistroPrevio=S`
  versus an ordinary cancellation; duplicate with changed contents; a fresh installation with
  unchanged software ID; credit note naming a rejected invoice; registered-name mismatch.
- [ ] Each control uses a distinct invoice identity and differs on the property under test.
  The rejected-predecessor case must actually link to the rejected record's hash, not to the
  accepted record before it. Save the expected distinguishing response before filing.
- [ ] Run `node --test scripts/live-aeat.test.mjs`, then its preproduction workflow using
  existing credentials and synthetic data. Do not expose credentials in receipts or touch production.
- [ ] Save request/response fixtures, individual outcomes, run URL and version. Separate HTTP or
  whole-envelope rejection from per-record rejection. Exercise the user's large-batch case at
  the service's validated batch limit, with the first record rejected and all successors inspected.
- [ ] Resolve contradictions before enabling dependent filing rules. If the service cannot be
  reached, record that dependency; continue unrelated local work rather than infer acceptance.

## Task 2: ordered filing and duplicate evidence

**Modify:** `packages/fiscal-verifactu/src/drain.ts`, `drain.test.ts`,
`drain.containment.test.ts`. Add a separate `drain.ordering.test.ts` if the existing suite becomes
unwieldy. **Interface:** preserve the public `drain`/`DrainResult` contract initially.

- [ ] First reproduce delayed earlier retry versus a newly due successor, lost accepted reply,
  unreadable individual response, and independent chains. Assert batch contents and next-due
  time, not merely the final count. Consecutive ordinary records may share a batch.
- [ ] For every duplicate state, test matching fingerprint, mismatching fingerprint with identical
  date/total/tax, missing fingerprint, failed/paged lookup, and a key held under another installation.
  Missing lookup evidence remains unknown; it is not proof of a different installation.
- [ ] Place a foreign invoice under the same key, then attempt our cancellation. Assert the
  foreign record remains untouched. Test cancellations whose originals belong to another chain.
- [ ] Implement claim ordering and duplicate resolution outside the write transaction, preserving
  original retry content. Hold dependent cancellations until their original outcome is established;
  do not globally require acceptance for all corrective operations.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts src/drain.containment.test.ts src/drain.ordering.test.ts`;
  omit the final path only if no separate suite was created. Show that removing the earlier-record
  condition or fingerprint comparison makes the corresponding regression fail. Finish for owner review.

## Task 3: separate submission outcomes from unresolved legal cases

**Modify:** `packages/fiscal-verifactu/src/schema/envios.ts`, `schema/acks.ts`, `acks.ts`,
`drain.ts`, `submission-alerts.ts`, `packages/fiscal/src/backend.ts`, and each consumer found by
tracing `AckState`, `detenido`, `recordsHalted` and the unsent projection.
**Create:** `packages/fiscal-verifactu/src/schema/filing-cases.ts`, `filing-cases.ts` and its test.

- [ ] Pin the proposed outcomes in tests: definitive rejection does not erase later replies;
  unknown outcome blocks later claims on that chain; a confirmed conflict opens an unresolved case;
  a held dependent record stays visible without being reported accepted or legally resolved.
- [ ] Use Task 1's receipts to decide whether successors may proceed after rejected or deliberately
  held predecessors. A held record's successors are a separate protocol case; add a probe if the
  retained evidence does not establish that behaviour.
- [ ] Add durable case events with original record ID, cause, evidence references, operator action
  and any new remedy record ID. Keep submission state separate from case resolution. Return the
  same event/result for an action retry; never edit an original record as the resolution.
- [ ] Apply individual replies and case events transactionally. Update every ack/schema/UI count
  consumer together. Keep existing fiscal-state values until their removal has a traced replacement.
- [ ] Run focused drain, ack, submission-alert and new case suites, then applicable schema and
  append-only guards. A resolved case may still contain an originally rejected record; assert
  that reporting preserves that distinction. Finish for owner review.

## Task 4: one allocation activation operation

**Create:** `packages/fiscal-verifactu/src/allocation.ts`, `allocation.test.ts`,
`schema/allocations.ts`. **Modify:** `registro-sif.ts`, `schema/sif.ts`, `reserved-series.ts`,
`provisioning.ts`, `restore.ts`, `classification.ts`, `index.ts`; generic module/provisioning seats
from Task 0 and their consumers, including reserved standby state.

**Interface:** `activateAllocation(tx, node, allocation, approval)` consumes Task 0's validated
contract and returns the active SIF reference, series references and activation event ID. It
performs no network access. The local allocation ledger is an audit copy, not outside continuity.

- [ ] Write failing cases for duplicate/retired allocation, wrong taxpayer/environment/software,
  missing invoice purpose, series collision across local nodes, abandoned reservation and
  malformed or overlong values. Include an emergency allocation with the clock set backwards.
- [ ] Prove all-or-nothing activation: fail each local write in turn and assert there is no partial
  new SIF/series set. Replay the same authorised event returns the same result; a different event
  cannot reuse it. External consumption is not rolled back by local failure.
- [ ] Replace independent timestamp/counter minting on production setup, restore, re-registration
  and promotion with the shared allocation path. Keep non-fiscal modules independent of VeriFactu
  vocabulary. If representations change, move schema and all consumers in this item.
- [ ] Keep `computeHuella` unchanged and preserve every historical fiscal record byte. In this
  preproduction repository, any required development reset is stated in the PR instead of adding
  data migration. No shipped migration file is edited.
- [ ] Run allocation, SIF, reserved-state, provisioning and restore suites, module-seam guards,
  golden huella and `inmutabilidad`; use a second restored database in the repeat-recovery control.
  Finish for owner review with the Task 0 scope approval attached.

## Task 5: select active series inside issuance transactions

**Modify:** `apps/server/src/till-config.ts`, `trading-config.ts`, `till-sale.ts`,
`working-order.ts`, `bill-payments.ts`, `restore.ts`, and every consumer of
`WAITRON_TILL_SERIES_ID`/stored `seriesId`; `packages/db/src/reserved-identity.ts` where needed.

- [ ] Trace readers in code, deployment, sealed state, adoption/promotion bundles, tests and docs
  across the whole repository. Record exact existing assertions requiring owner approval.
- [ ] Write cases that activate a new series while a sale is queued, then sell through each
  issuance path. Assert the committed sale/fiscal/outbox use the series read inside that transaction.
  A retry of an already committed sale still returns its original invoice, not the current series.
- [ ] Exercise local validation failure and failure before commit: no issued receipt escapes,
  and invoice allocation, sale, record and outbox roll back together. A lost response after
  commit returns that same invoice on retry. Keep these checks on the real issuance entry points.
- [ ] Read the correct purpose's active series transactionally; remove the stale environment
  selection and every copy together. Preserve exactly one live series per required purpose.
- [ ] Test the explicit emergency-to-short switch: new allocated series, unchanged SIF/chain
  unless another recovery independently requires it, old invoices unchanged, no switch on reconnect.
- [ ] Run affected sale, bill, working-order, boot, restore, adoption and promotion suites, plus
  the environment guards selected by the removed variable. Finish for owner review.

## Task 6: recovery pack and offline administrator procedure

**Create:** `apps/server/src/fiscal-recovery.ts`, `fiscal-recovery.test.ts`,
`recovery-pack.ts`, `recovery-pack.test.ts`, and a setup recovery-allocation screen with browser
and accessibility suites. **Modify:** `restore.ts`, `restore-request.ts`, `restore-command.ts`,
`restore-stream.ts`, `restore-gate.ts`, `boot.ts`, `setup-api.ts`, `backup-config.ts`,
`backup-env-writer.ts`, setup restore screens, dashboard recovery/backup entry points.

**Interface:** a staged restore carries the allocation and recovery approval from Task 0 through
to Task 4 activation. The ordinary stage marker is crash bookkeeping, never independent proof
that a full-disk rollback did not occur.

- [ ] With no bucket settings or subscription, create/download a pack containing recovery-key
  material and the allocation register. Distinguish the secret-bearing pack from an incident
  export. Verify no key appears in logs, incidents, query strings or the public recovery page.
- [ ] On fresh hardware with an old backup, no network and no paired device, exercise paper
  allocation and emergency allocation. Require old-machine-offline/no-parallel-recovery
  confirmations; device reports are optional. Include a phone reservation entered by hand.
- [ ] Test wrong taxpayer, a typo, a consumed allocation, an old printed pack and missing history.
  Do not silently overwrite newer paper history. Present recovery source/date and the record the
  administrator must retain before enabling trading.
- [ ] Carry the same procedure through archive, bucket and managed-cloud restore entry points,
  including keeping an existing box identity. A source that requires download still needs its
  connection; an already available archive must not inherit that requirement.
- [ ] Inject crashes after staging, external consumption, local activation and before first sale.
  Test the approved retry/burn policy. Refuse an incompatible older software image without
  rewinding fiscal data; a deliberate old-backup restore returns to this recovery procedure.
- [ ] Run the corresponding restore/pack/server route suites and setup browser suites. Open the
  full journey in both languages/themes at phone and desktop sizes. Finish for owner review.

## Task 7: conditional automatic conflict recovery

**Create:** `packages/fiscal-verifactu/src/chain-restart.ts`, `chain-restart.test.ts`.
**Modify:** `drain.ts`, `filing-cases.ts`, `apps/server/src/fiscal-recovery.ts` and its tests.

**Interface:** the restart operation consumes a saved conflict, Task 0's authority decision and
an independently consumable allocation. It invokes Task 4 only after the conflict reply commits.

- [ ] Reproduce a confirmed active-installation conflict with and without eligible allocation and
  authority evidence. Only the eligible case switches automatically. The other case enters the
  specified administrator flow; it neither guesses a short prefix nor silently clears the incident.
- [ ] Test the 24-hour guard, a retired-installation conflict, missing lookup evidence, and an
  offline administrator recovery. An unavailable AEAT alone starts no new chain.
- [ ] Fail activation after saving the response: preserve that response, retry the authorised
  operation without minting extra identities, and never acknowledge the conflicting original.
- [ ] Exercise surviving old-chain records under D5's probe/adviser gate and separate missing
  history from pending submission. A sale queued behind activation uses the new series.
- [ ] Run restart, drain, restore and sale suites; finish for owner review. Include the gate
  decisions and ensure no old automatic path bypasses the new authority checks.

## Task 8: corrective operations and held-record resolution

**Create:** `packages/fiscal-verifactu/src/record-remedy.ts`, `record-remedy.test.ts`.
**Modify:** `backend.ts`, `chain.ts`, `filing-cases.ts`, schema only where required to retain
the complete new record, and module-exposed management operations; server `cancel-credit.ts`.

**Interface:** remedy requests name the original record, remedy kind, corrected facts, operator,
reason and idempotency key. Results name a new immutable record and case event. They do not
rename the original sale or replace its stored payload.

- [ ] Test an internal-record correction after rejection using the documented S/X operation;
  a corrective invoice for a factual invoice error; and an appropriate absent-original
  cancellation. Append each at the current chain head and keep the original bytes untouched.
- [ ] Cover original outcome unknown, different invoice under the same key, same totals but
  unproven same sale, already generated unsuitable cancellation, and repeated operator submission.
  No ambiguous case selects a remedy automatically.
- [ ] Preserve the staff cancellation/refund accounting action while holding a conflicting fiscal
  reference as agreed in D4. Explicitly test its later resolution without rewriting the held
  record or double-refunding the customer.
- [ ] Build disputed scenarios with synthetic data. Before production enablement, record the
  relevant adviser answer or the owner's explicit case-specific assumption. These controls do
  not block ordinary sales and are not cleared by a successful test-service response. Enforce
  the permitted remedy set at the server action boundary, not only by hiding a screen button;
  test a direct request for a remedy that has not been enabled.
- [ ] Run remedy, correction, void, substitution and payment/cancel suites plus unchanged golden
  huella and `inmutabilidad`. Finish for owner review; include a worked unresolved-to-resolved case.

## Task 9: fiscal filing screen and missing-history investigation

**Create:** `apps/server/src/fiscal-filing-api.ts` and route tests;
`apps/dashboard/src/screens/fiscal-filing-screen.ts` and browser/accessibility tests.
**Modify:** `boot.ts`, dashboard navigation/API/i18n, module query/action seats and case projections.

- [ ] Place Fiscal filing immediately after VAT return in Reporting, readable with `report.export`.
  Show submission progress separately from unresolved legal cases, held records and missing periods.
- [ ] Use Task 6's administrator recovery for manual activation, with re-authentication. Reading
  permission alone must not allow activation or a corrective filing. Test both permission paths.
- [ ] Show invoice identity, original response, available fingerprints, evidence and proposed
  action; never label equal amounts as proof. All successful action retries display the saved result.
- [ ] Export an adviser case without secrets. Record later-recovered source records separately
  from any regularisation, flag possible duplicate accounting and require reconciliation. Do not
  invent invoices or insert recovered foreign rows into the active chain. Q41 gates actual remedy.
- [ ] Exercise slow reloads after successful actions, stale tabs and wrong-field refusals. Run API,
  browser, axe and subscription guards; inspect both themes/languages and phone width. Finish for
  owner review with the screen visible before landing.

## Task 10: outside evidence, deployment checks and clock warnings

**Landing update, 2026-10-06:** W41s-10c landed as [#1264](https://github.com/clintongormley/waitron/pull/1264),
squash `8e2fc9b095f1d7249c2cfa8771f9f87aa4d3a045`. The three dated implementation
checkpoints below now have a landed implementation. Other Task 10 work remains queued;
this landing does not enable public F1 issuance or settle the legal questions.

**Modify:** `packages/fiscal-verifactu/src/reconcile.ts`, server `restart-reset.ts`, `pass.ts`,
`deployment-guard.ts`, `fiscal-readiness.ts`, `fiscal-readiness-runner.ts`, `membership-fence.ts`;
stream `pointer.ts`/`supervisor.ts`; till receipt-result handling and durable device evidence.
**Create:** a signed stream chain-witness module and focused witness suites beside those consumers.

- [ ] Test startup/daily paged lookups across month boundaries, different-date number reuse and
  lost acknowledgements. Failure or incomplete lookup supplies no proof of freshness and does
  not stop ordinary offline sales. Detected conflicts use Task 7, never a second allocator.
- [ ] A device retains last-seen invoice evidence by taxpayer/environment/series; missing,
  corrupted or unavailable storage does not prevent recovery. Evidence from a retired series
  cannot force a new allocation. Test a freshly paired device arriving after offline recovery.
- [ ] Define and review the trust relationship for signed bucket witnesses and higher-term
  membership before enabling fencing. Test genuine newer evidence, stale/replayed evidence,
  forged signatures and unavailable storage. Online fencing remains additional protection;
  paper recovery makes no remote-fencing claim.
- [x] W41s-10c implementation checkpoint, 2026-10-05 (not landed): refuse production use of an
  unstamped database containing preproduction or unknown-environment fiscal records. Preserve
  an empty setup and production-record history. The deployment-guard suite exercises the real
  boot refusal before a missing migration directory can be reached, preserving the original
  record and empty stamp; the module probe also covers fiscal tables not yet migrated.
- [x] W41s-10c implementation checkpoint, 2026-10-05 (not landed): observe zoned AEAT
  presentation timestamps during background submissions. Warn when the entire request interval
  differs by more than one minute, through a fiscal alert and authenticated till banner. Missing,
  malformed, unzoned or ambiguous samples mean unknown. The banner describes the last comparison;
  no freshness guarantee or extra time-source request is added. Cash-sale tests cover warning
  and unavailable reads. Lane A's receipt overlap is explicitly waived by the campaign queue.
- [x] W41s-10c implementation checkpoint, 2026-10-05 (not landed): show saved AEAT rejection
  codes and messages, including a repeated readiness attempt while the refusal is still saved.
  Explain that acceptance does not verify the registered name: W41s-1's §7.1 receipt retained the
  correct header name while varying the record issuer's name. Your legal name and tax ID still
  need checking against your tax registration. Witness work remains separately queued.

## Task 11: full offline exercise and operator instructions

**Create:** `apps/server/src/fiscal-offline-recovery.e2e.test.ts`;
`docs/operations/fiscal-recovery.md`. **Modify:** compliance findings with dated receipts,
adviser questions as actual answers arrive, and W41s in the backlog.

- [ ] Issue invoices, save a backup, issue more while disconnected, lose the box, and restore the
  old backup in a new directory with network access and device evidence unavailable. Use real
  product issuance/restore entry points. Verify fresh allocation, original retained bytes and a
  visible missing-history interval; do not equate new invoices with historical recovery.
- [ ] Repeat from the same backup with backward time, interrupt activation, then switch to a new
  short series. Assert no reused allocated identity, no old-series continuation and no automatic
  series change when connectivity returns. Verify a surviving original transaction replays once.
- [ ] Reconnect the original box in the supported fencing scenario and later recover its history.
  Confirm the stated limit where only manual offline assurance was available. Exercise queue
  restart after a lost response and the approved remedies with synthetic records.
- [ ] Write the printable procedure: isolate the old machine, obtain/consume allocation, retain
  paper evidence, activate, resume, investigate missing history and reconnect. Include recovery
  with no subscription, allocation exhaustion and a lost pack. Keep secret handling separate
  from adviser exports.
- [ ] Run the focused end-to-end suite and changed consumer checks; obtain current-head CI and
  the owner's review. Record remaining adviser-gated actions rather than claiming all cases solved.

## Separate Cloud workstream: subscription allocation registry

The service belongs in `waitron-cloud`, not in the POS database or its backup bucket. These items
remain part of the deliverable, but do not delay the offline path. They need their own repo
worktrees and Cloud queue entries after Task 0 fixes the shared protocol. No Cloud code is added
by this plan-writing change.

1. **Registry service and reservation API.** Create a fiscal-allocation domain package in Cloud;
   integrate with `packages/account-http/src/app.ts` and the existing account/subscription
   boundary. Use the Cloud repository's persistence conventions. Enforce atomic uniqueness and
   idempotent requests; never release abandoned reservations. Tests cover simultaneous requests,
   two venues under one taxpayer, authorisation, retry after lost response, import of paper
   history, pre-reserved paper use and independent registry disaster recovery. The registry's
   own restored state must not silently reissue allocations missing from its backup.
2. **Phone and paper reservation journey.** Add a portal allocation screen/controller/types and
   browser tests beside `apps/portal/src/recovery-screen.ts`. The subscriber can reserve for an
   on-prem venue, retain the receipt and transcribe it into an offline box. Test manual-entry
   mistakes, interrupted requests, old receipts, concurrent administrators, subscription end
   and already reserved paper allocations. Hosting the venue database is not required.
3. **Node adapter and reconciliation.** Add the registry client beside
   `apps/server/src/cloud-client.ts`; feed its signed/validated allocation receipt through Task 6's
   same manual-entry path. Test offline consumption followed by later registration, matching and
   conflicting receipt evidence, no automatic return to short series, and no network on a sale.
   Check the contract against the real Cloud route as well as a fake. Exports exclude recovery keys.

Each Cloud item gets its repo-specific implementation plan from the approved Task 0 contract
before coding, including exact schema, endpoint and test files. Cloud is independently deployable;
the adapter stays unavailable until the service contract is fulfilled, while paper recovery works.

## Queue handoff and completion

- The owner chose the queue for implementation. Keep W41s in lane E unless explicitly moved;
  point it at this plan and the approved spec. Do not restart the obsolete task list.
- The approved plan releases W41s for queue execution. Create separate dependent items for the
  tasks above, including the Task 0 contract checkpoint and Task 1 library work. Do not silently
  broaden a lane's repository or fiscal-core permissions.
- A build gate and a production-enablement gate are separate. When an adviser answer is pending,
  work another eligible item; do not park the whole project or silently choose a legal remedy.
- Product implementation and probes have not run in the planning session. Completion requires
  the offline exercise, concrete correction/investigation workflows, Cloud delivery separately,
  recorded protocol evidence and explicit disposition of every remaining gated action.
