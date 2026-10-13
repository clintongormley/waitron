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

**2026-10-12 checkpoint:** `allocation-identity.ts` validates installation formats, encodes
16 bytes as the approved emergency name, checks the separate manual checksum, and checks the
complete allocated series set against requested bases and purposes. Its sibling tests cover
invalid formats, duplication and substitution; `allocation-boundaries.test.ts` runs the actual
library validator over complete records at the 60-character invoice limit and a 61-character
control. No activation or schema change is connected yet. Before those writes, the owner must
settle who signs paper reservations and how fresh offline hardware trusts that key (§9.2).
The next step remains allocation/approval scope and authority validation, then atomic writes
and every entry-point replacement above; this checkpoint does not complete Task 4.

**2026-10-12 paper authority checkpoint:** the owner selected a separate external custodian
Ed25519 key, with independent fingerprint confirmation on replacement hardware. `paper-evidence.ts`
checks signed blocks and consumption receipts against separately enrolled trust, the outside
register confirmations and the exact recovery scope and complete series set. The standalone
`waitron-paper-custodian` command generates keys and signs public evidence; it does not maintain
the master register. The [custodian procedure](../../developers/paper-custodian.md) covers enrolment
and key replacement. No persistent allocation, SIF representation or activation entry point has
changed. Next: validate the complete allocation/approval envelope, then the coupled schema,
all-or-nothing activation and entry-point replacement above. Task 4 remains incomplete.

**2026-10-12 envelope checkpoint:** `allocation-envelope.ts` validates the complete paper or
emergency allocation and administrator approval. Its context is supplied separately by the host:
taxpayer, software, environment, configured series, source/backup, target node, event, operator,
reauthentication and outside authority. Initial setup explicitly confirms `oldMachineAbsent`;
recovery confirms `oldMachineOffline` instead. The parser refuses extra fields and returns detached,
frozen values. Current paper-entry state remains an outside operational assertion, not something
the signature proves. Emergency input must match an in-process cryptographic draw, its separate
checksum and the recorded outside incident; missing history requires explicit uncertainty.
Cloud input is refused until the separate registry adapter supplies trusted evidence.

No activation or schema change is connected. A committed prior activation is referred to the
future replay operation rather than authorised as a new activation. Next: trace and replace the
numeric SIF/series consumers together, generate and qualify the schema migration, then implement
atomic activation and committed replay plus every entry-point replacement. Task 4 remains open.

**2026-10-12 migration qualification checkpoint:** a disposable clone of the envelope
checkpoint generated the SIF integer-to-text rebuild and exercised it through `applyMigrations`
with an existing record written by `seedSale` and `appendToChain`. Default generated SQL refused
the populated parent drop. Deferral plus an explicit zero-violation assertion before deferral OFF
retained the sampled record, chain and append-only triggers; the orphan control refused and
rolled back. Deleting the assertion let the orphan commit and failed that refusal test.
The candidate passed the migration-upgrade and four schema/trigger suites. The experiment and
its limits are recorded in [the migration notes](../../developers/conventions-data.md).

No candidate SQL or schema edit is installed on this branch. Regenerate the complete schema,
including the allocation ledger, and repeat these controls on that final tree. Preserve shipped
SQL byte for byte. The numeric consumer inventory is a search inventory, not a completed audit;
replace those consumers with the schema and atomic activation in one working milestone.
Task 4 remains incomplete, with no activation entry point connected.


**2026-10-12 atomic-write checkpoint:** an inactive `activateAllocation` now writes the supplied
identity, complete series and immutable audit result in the caller's transaction. A confirmed
paper replay rechecks outside evidence and stored/current scope and returns the recorded result.
Six injected write failures roll back; tests compare a synthetic retained record and preserve
its chain sequence. Installed deletion controls cover writes, outside commitment, envelope
binding and current identity/series checks. The ledger-only generated migration passes the
upgrade walk. The root append-only table-name pin needs approval for one additional entry;
no guard logic has changed. This is not the final SIF text migration: the inactive writer binds
text through SQL while the declaration and counter-based host consumers still await replacement.
Do not expose or call it from setup/restore until that coupled transition, restart/emergency
replay and two-restored-database qualification are complete. Task 4 remains incomplete.

**2026-10-12 replay and host-audit checkpoint:** the owner approved the one additional
append-only table-name entry. Its guard passes. Emergency replay now compares the complete
persisted allocation and approval before revalidating current scope and outside confirmation;
a new allocation still requires a fresh in-process random draw. Qualification reopens two archived
database copies, replays the committed result without that original draw, and compares all
activation rows. Two copies of a pre-activation backup refuse reuse when the committed local result
is absent; independently recorded attempts use separate fresh emergency identity sets.

The host audit found a standby lifecycle decision: reservation/adoption happen before the current
primary stops, while the recovery approval requires isolation before activation. The concrete
[decision inventory](2026-10-12-w41s4-standby-activation-decision.md) proposes dormant reservation
followed by activation at promotion. No host path or SIF declaration has changed. Task 4 remains
incomplete; the owner's earlier signer/assertion/list-entry approvals remain valid.

**2026-10-12 dormant-standby checkpoint:** the owner approved reservation at join and activation
at takeover. `paper-reservation.test.ts` uses independently signed bytes to check a dedicated
reservation receipt bound to the block, allocation, join event, operator, primary and named spare.
`paper-custodian.reservation.test.ts` exercises the separate signing command and outside
confirmation flags. `standby-allocation.test.ts` checks stored taxpayer, environment, software,
source/target binding, complete-purpose bases and retained collisions, then compares SIF, chain,
series, audit and counter rows around a successful read-only validation. No live standby identity
or series is written by this validator. These APIs are still unconnected to bundle, adoption and
promotion. Their authenticated host context, dormant persistence, takeover consumption and
atomic role/identity activation remain open alongside the coupled text-schema/counter transition.

**2026-10-12 dormant-persistence checkpoint:** the internal `establishDormantAllocation`
operation checks a real standby node in the primary's location, refuses a standby with an
active SIF or series and validates the signed reservation against stored scope. It stores a
detached proof and complete bases in the append-only `fiscal_reservations` ledger, without
activating the spare. `dormant-allocation.test.ts` compares the active tables, checks same-event
and concurrent retries, refuses retained event/allocation/identity reuse, rolls back a failed
adoption body and attempts update/delete. A caller-mutation case failed with changed stored
signature payload before the detached snapshot was added. Migration `0006_dormant_reservations`
adds only this table and its indexes; the previous SQL files are unchanged.

This internal operation is not connected to the host or exported from the public barrel.
Authenticated host context, binding takeover consumption to this stored reservation, coupled
text typing/counter retirement and all host consumers remain unfinished. The existing root
append-only and fiscal schema-ownership exact lists each fail only on the new table name.
The [list-change request](2026-10-12-w41s4-reservation-list-approval.md) specifies the two additions;
no existing assertion or guard has changed in this checkpoint.

**2026-10-12 takeover-binding checkpoint:** the owner approved the two exact dormant-table
list additions at 20:55; both observed list failures now pass. The internal
`activateDormantAllocation` reads the retained join proof and rechecks its signatures, then
binds a distinct takeover event to its source, named target, signed block, identity and complete
purpose set. It uses retained bases rather than a caller's subset and delegates current outside
consumption, administrator confirmation and transactional writes to the allocation operation.
Historical proof checking carries no fabricated current-reservation flags. Ordinary activation
now refuses consuming a locally retained spare allocation through a different recovery path;
that regression resolved instead of refusing before the shared check was added.

The new suite checks all three purposes, unchanged primary and reservation rows, committed
replay, substitutions, current confirmations, a refused final audit write and a detached
consumption snapshot. The package coverage run passed 1,176 cases above all four bars; later
qualification adds two cases without changing production code. The six-file root run passed
2,548 cases, including the populated upgrade walk. Neither activation writer is exported from
the package barrel or connected to a host. Host-issued authenticated inputs, role changes,
SIF text typing, counter retirement and every setup/seed/restore/bundle/adoption/promotion
consumer remain coupled work; current-main rebase and final schema regeneration still remain.
Task 4 is incomplete and has no publication candidate.

**2026-10-12 authenticated-host checkpoint:** `@waitron/module` now carries an in-process operator
authority bound to a module, action, event, source and target. The trusted host must authenticate
before issuance; the carrier performs no login and proves no outside-register fact. Its authority
expires when its operation callback settles, including on refusal. The internal server helper
checks the actual manager password before opening its authentication transaction, checks the
authenticator and permission there, ends the temporary login session, then issues authority to
the operation callback. Its database cases cover changed account status and permission during
the check, malformed credentials and scope mutation.

The internal fiscal wrappers require the issued authority, match its operator and scope, and
recheck it after awaited reads before a new activation's writes or a replay return. A plain
`reauthentication` object no longer suffices for these wrappers. A synthetic integration case
uses the real authentication helper, signed retained reservation and separate consumption with
the existing `commitMirrorPromotionTx` in one host transaction; a refused membership write leaves
the fiscal, reservation, role and membership rows unchanged. These are internal qualification
paths, not a boot or HTTP promotion test, and their supplied outside-register confirmations do
not establish independent continuity.

The wrappers remain outside the fiscal public barrel, and existing setup, restore, reservation,
adoption and promotion entry points remain unchanged. Initial setup, CLI recovery and break-glass
adapters still need their own authenticated host context. The coupled text SIF/counter retirement,
all entry-point replacements, current-main schema regeneration and final populated upgrade remain
open. Do not publish this intermediate tree; Task 4 is incomplete.

**2026-10-12 setup/restore-carrier checkpoint:** the generic seed and restore seats now accept
optional module-owned operation input. The venue runner snapshots the supplied event/source and
attributes setup authority only to the account it created in that transaction, rechecking its
role/status before each module. Host-chosen account/node IDs can be supplied before outside
consumption is signed. The generic restore runner checks a supplied operation's module, action,
target and current authority before calling its hook. Absent inputs preserve the existing calls.

A synthetic integration combines actual venue creation and scoped initial authority with a
synthetic initial allocation signed with the paper-evidence helpers and all three purposes; wrong operator and missing current
outside confirmation roll back the venue. Twelve installed removal controls fail assertions;
restoring the candidate passes the new suites. Existing assertions, fiscal goldens, public fiscal
seats, numeric SIF/counter code, shipped SQL and promotion authentication are unchanged.

The real recovery-key route probe accepts a valid node key with no operator ID, a staff ID and
an unknown ID. The wrong-key control refuses. That route supplies no named administrator to
the activation callback. The [operator decision](2026-10-12-w41s4-break-glass-operator-decision.md)
requires the owner's choice before adding that authority path. CLI/staged recovery inputs,
bundle/adoption/promotion and final text SIF/counter/all-consumer/schema qualification remain
coupled work. Do not publish this incomplete candidate; Task 4 remains open.

**2026-10-13 module-adapter checkpoint:** `allocation-operation.ts` accepts the opaque allocation
and approval through `ModuleOperationInput`, with outside evidence supplied separately by the host.
It obtains the operator, event and source from live in-process authority and reads stored venue
scope before calling the authenticated activation operation. Inputs, binding and outside evidence
are detached before database reads; a genuine emergency draw keeps its in-process identity.
Promotion requires a retained dormant-reservation event and uses the dormant takeover operation.

`allocation-operation.test.ts` exercises initial setup without scaffold series, recovery-key
attribution, dormant promotion, emergency input, committed replay and caller rollback on a real
venue database. Extra or malformed input, another authority scope and expired authority refuse.
The installed disposable candidate's removal controls fail assertions; the restored suite passes.
Lane E retains the commands and outputs in `receipts/w41s4-operation-adapter-*`.

The adapter has no production caller or public export. Independently collected custodian trust
and outside confirmations are still a host obligation, not facts established by these fixtures.
Next connect the production collectors and fiscal seats together with SIF text typing, counter
retirement and every host consumer. Then regenerate on current main, qualify the populated upgrade
and complete both full reviews, hook and CI before publication. Task 4 remains incomplete.

**2026-10-13 configured paper-source checkpoint:** `allocation-paper-source.ts` reads the
custodian command's public-file format against a separately supplied, independently confirmed
fingerprint. It reads a separate current-event confirmation, binds the operator and full operation
scope, and forwards its exact allocation ID for comparison at activation. Both files are reread
on each source call; reads are bounded to 64 KiB. Both paths and the compared fingerprint are
supplied as separate host configuration; the source does not inspect the submitted allocation.
No source is selected by default.

The confirmation records an operator's consultation of the outside master. Reusing an old file
does not establish that the register remains current. Public host selection and the Task 6 manual
journey must keep that consultation separate from the signed allocation and any restored pack.
The [custodian procedure](../../developers/paper-custodian.md#configured-host-source-on-the-task-4-branch)
records the internal format and this limit.

The new source suite covers the actual custodian command's public output, complete signed
activation, separate fingerprints, replaced keys, request/configuration mutation, missing and
malformed files, exact read-size boundaries, current-entry states, uncertain prior attempts,
committed replay without resetting invoice counters and caller rollback without changing the
outside confirmation. A server integration joins real recovery-key authentication, configured
paper files and activation, and refuses a key replaced during collection. Lane E retains executed
checks and installed deletion controls under `receipts/w41s4-source-*`.

This source and its allocation-ID comparison are internal. No public host, fiscal descriptor,
numeric SIF/counter path, shipped migration or existing fiscal assertion is changed. Finish the
coupled production seats and all consumers, regenerate on current main, rerun the populated
upgrade and fiscal qualifications, and complete both whole-branch reviews, hook and CI before
publication. Task 4 remains incomplete.

**Owner naming override, 2026-10-13 18:00:** mint a UTC issue date plus a four-character
cryptographic code with no look-alike pairs. Store `YYYY-MM-DD · CODE` beside the verifier,
then localize the label and date only for display. The handover must not change the stored
name when its language changes. Redraw an immediate replacement collision inside the verifier
transaction; do not treat the short label as a globally unique identifier or a credential.
The dated naming checkpoint above describes the earlier random-label format. Physical paper
output and the backup chooser's selected-copy name remain Task 6 work.

**Implementation checkpoint, 2026-10-13:**
`packages/fiscal-verifactu/src/allocated-lifecycle.ts` supplies a prepared-allocation seed
with its active-series resolver, a restore hook that leaves series creation with activation,
and a dormant-takeover hook. New database cases exercise initial setup, re-registration,
restore, takeover, committed retries and action refusals. New real setup/restore-host cases
first failed with the former hooks (unsuffixed setup codes; no restore allocation audit), then
passed with the allocated hooks. Production composition and all entry-point/schema/counter
replacement remain coupled work before publication; these exports do not switch the descriptor.

**2026-10-14 adoption-consumer checkpoint:** the public adopter deliberately refuses an enabled
module whose independently prepared standby opens series only at activation. The setup route
returns `409 module.operation_invalid` before the local first-write hook; the pending worker logs
that code and retains the exact latch across retries. Its boot case checks the real pending
status and absence of a viewer session, node key and selling identity. Disabled modules retain
the existing adoption path. A synthetic signed-reservation journey leaves supplied outside
evidence unchanged after the local refusal. No copy mechanism or stored authentication is added.

Default descriptors, text SIF/counter retirement and the final migration/all-consumer qualification
remain coupled work. This checkpoint does not enable default allocated setup or restore and is
not ready for publication. The two whole-branch reviews, normal push hook and current-head CI
still precede authorised landing.

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

**2026-10-12 implementation remap:** F2 and F1 share `selectOrderInvoice` in
`apps/server/src/invoice-selection.ts`; F1 and corrective series were already read live.
The cached standard-series field was removed from configuration, mirror designation and restored
identity together. Fixture ids remain separate from request configuration. Task 4's activation
protocol is independent and is not implemented here. The switch qualification changes series
explicitly through a transaction and keeps the SIF unchanged.

## Task 6: recovery pack and offline administrator procedure

**Owner addition, 2026-10-13 10:55:** include the node recovery key's stored name in the printed
paper handover and the backup chooser. Read the name from the selected backup's database,
never the live box or a manifest assembled before its archive snapshot. Warn that restoring
an older backup reinstates its older key; keep that paper until no older backup remains.
Task 4 establishes names, handover-screen forwarding and selected-copy restore output; this
Task 6 owns physical recovery-pack printing and the chooser's name display. Keep the backup
file's encryption key separate from the node's recovery credential.


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
**A364 update, 2026-10-07:** the owner removes the till's authority-clock notices.
Measured drift remains an administrator alert; the till does not poll for it.

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

**2026-10-12 recovery-key authority checkpoint:** the owner chose key-only authority with
attribution to the key event. `withRecoveryKeyOperation` checks the actual node verifier outside
the write lock, rechecks it in the operation transaction and issues temporary scoped authority.
No account is required or modified. The supplied callback runs in that same transaction; its
refusal rolls back its writes and revokes the authority. The signed paper consumption and local
approval carry the same structured key event, while ordinary administrator attribution stays a
person ID. New tests use independently signed bytes, account-free dormant takeover, all three
purposes, retained audit replay and membership-write rollback. These are internal synthetic
qualification paths, not connected promotion or cold-restore entry points.

**2026-10-12 restore-placement/CLI checkpoint:** the initial CLI can forward host-selected node and
administrator IDs plus opaque module input into the venue runner. Archive and bucket CLI paths and
both staged restore paths can receive a trusted host callback that authenticates against the placed
database. It supplies the transaction used for all restore hooks and series checks. In-process
authority stays alive through that callback and is never reconstructed from a marker or backup.
The supplied module entries are snapshotted before the hooks run.

Database tests exercise real encrypted-file validation and stream placement with distinct backup
and node keys. Wrong-key refusal publishes no identity; refusal by a later hook rolls back writes
from authentication and the earlier hook. CLI and staged forwarding tests use actual placement
behind injected outer restore callbacks, so they do not qualify a complete production command or
boot journey. The production entry points still lack allocation input collection and authenticated
fiscal-seat wiring. The existing fiscal assertions and shipped migrations are unchanged.

Remaining Task 4 work: production input collection and authenticated seat wiring; text SIF/counter retirement
and every setup, seed, restore, bundle, adoption and promotion consumer together; current-main
rebase, complete migration regeneration and populated upgrade; sync the Cloud handoff's proposed
operator binding to the owner-selected union; two full reviews, normal hook and current-head CI.
Do not publish this incomplete candidate.


**2026-10-13 standby-host checkpoint:** the reservation carrier supplies the named standby and
scoped opaque input. Establishment carries its own scoped input without serialising in-process
authority into the bundle or pending marker. The new `provisioning.standby.activate` seat runs in
`promoteMirrorToPrimary` before trading-series validation, in the same transaction as the role and
membership writes. An optional trusted host callback supplies that transaction and its freshly
issued authority; key authentication need not open a nested transaction.

New tests run signed dormant-allocation activation through that real promotion function using the
actual node-key verifier. They retain the separate outside reservation and consumption, compare
all three purposes and permanent key-event attribution, and roll back activation on a refused
membership write. Generic carrier tests check scope, detached binding snapshots, expired authority,
replaced keys, incomplete series and refused settings writes. The original missing-full-series
check still refuses before writing trading settings. The settings file itself remains outside the
database transaction; these tests do not claim that a later database refusal rolls that file back.

The production composition's fiscal standby and restore seats are unchanged and do not use these
new inputs. Boot/HTTP allocation collection and fiscal-seat wiring, text SIF/counter retirement,
all setup/seed/restore/bundle/adoption/promotion consumers, current-main migration regeneration,
populated upgrade, Cloud binding sync, and two full reviews plus hook/current-head CI remain.
Task 4 is still incomplete; do not publish this candidate.


**2026-10-13 named-key qualification:** the owner selected the chosen backup's verifier for
cold restore and retained the live verifier for takeover. A new core column stores a non-secret
name with each newly minted key's verifier. The adoption response and setup handover carry that
name with the one-time secret. The placed-database restore path reads its own key name before
invoking authentication, including when a wrong key refuses the callback. No key name is
computed from the current live box, and a name does not authenticate an operation.

New cases first failed on the absent stored name, handover forwarding and selected-copy log.
A real archive made before replacement retains the old name and accepts the old key, while
the live database refuses it and accepts the replacement. A refused key replacement retains
the old verifier and name. The eight handover views were inspected in English and Spanish,
light and dark, at requested widths 390 and 1280; the accessibility cases passed. Migration
`0144_recovery_key_name.sql` adds one nullable core column without rebuilding a table or changing
shipped SQL. Physical paper output and the backup chooser's names belong to Task 6 under the
owner's explicit permission to place them in the next recovery part.

The coupled production collectors/fiscal seats/text-SIF/counter/all-consumer transition, current-main
schema regeneration and populated upgrade, Cloud operator binding, and two full reviews plus hook/
current-head CI still remain. Task 4 is incomplete; do not publish this checkpoint.

**2026-10-13 initial-series handoff qualification:** a filing seed may declare `series.resolve`.
The generic venue runner then skips scaffold inserts, resolves the allocated references after
all seeds and on retries, and checks their node, active state, complete purposes, ids and codes.
It returns ids in requested purpose order. A repeated setup does not run the seed again.
The internal fiscal resolver compares requested bases with the committed allocation and refuses
changed taxpayer, environment, software, installation or active references.

New tests first returned scaffold ids, missed the resolver and returned a duplicate id for
repeated requested purposes. The signed synthetic integration now opens exactly the allocated
series and preserves counters and allocation/SIF rows on retry. Installed removal controls cover
the handoff and resolver's scope checks. Existing assertion expressions and golden/immutability
sources are retained. The production fiscal descriptor has not adopted this contribution;
independently collected authority, fiscal seats and the coupled text/counter/all-entry-point
transition still precede publication, schema regeneration and the full finish/land gates.


**2026-10-13 outside-collection boundary qualification:** `withCollectedModuleAllocation`
asks a separately configured source for evidence using only authenticated scope and operator.
It refuses a missing source or receipt, another event/operator and expired authentication
before entering the host callback. It detaches the submitted values and returned evidence;
all submitted own fields are checked before cloning can discard hidden fields. The callback
contains activation in the caller's transaction and expires when the attempt settles.

New real-database cases exercise the signed complete series set, current-source refusals,
replay with a fresh source lookup, another writer during collection and rollback after a
later host failure or authentication expiry during the final audit write. Emergency cases
retain the host's genuine in-process draw. The source in these cases is supplied by the
fixture; this does not establish an independent current register or a configured production
custodian. No public host entry point or fiscal descriptor is connected.

The generic recovery-key helper now has an optional collection callback before its commit
transaction. It verifies the secret before collection and rechecks the verifier and scoped
authority in that transaction. Captured, queued and in-flight commits refuse expired
authority; local failure leaves the separately held outside mark intact. New host tests join
this helper with the module collector and a genuine emergency draw, and assert all three
purposes and key-event attribution without a person or management session. Public boot, CLI,
restore and promotion entry points still have no configured production source.

The configured production sources and authenticated fiscal seats, coupled text-SIF/counter
retirement and all consumer replacements remain the next Task 4 work. Current-main schema
regeneration, populated upgrade, Cloud operator-binding synchronisation, two full reviews,
the normal push hook and current-head CI still precede publication.

**2026-10-13 host preparation checkpoint:** the module contract now has a scoped preparation seat.
The generic setup, restore and promotion callers can collect before opening their write transaction.
An explicit public paper-source factory joins the enrolled public key and current-event files to an
attempt-local fiscal token. A saved token cannot recreate the collected source or its authority.
The real-key runner verifies before collection and rechecks the verifier before the host writes.
Initial authority names the planned account and target; the transaction requires the same newly
created active administrator. Known or concurrently created administrators refuse initial authority.
Signed setup exercises the complete series set and committed retry; real-key restore exercises the
generic hook transaction and key replacement. Restore rechecks each hook's authority and all retained
hook authorities before commit, so expiration during a later hook rolls earlier writes back.

The production composition still selects no collector and retains the old fiscal contributions.
Finish the configured entry points, seed/restore/dormant seats and complete text/counter consumer
transition before regeneration, populated upgrade, Cloud binding sync, both full reviews and the
normal hook/current-head CI. This checkpoint does not complete Task 4 and must not be published.

**2026-10-13 public recovery-input checkpoint:** re-registration and both cold-restore commands
accept the detached generic operation file and separate node key. Staged archive/stream restore
reconstructs the runner after restart from marker input or the entry process's operation-file path;
the marker takes precedence and carries no authentication authority or node key. The parser refuses
input whose JSON round trip changes it before staging replaces an earlier request. Key verification
precedes outside collection, and key recheck and every seed/hook write share the transaction.

New focused cases qualify current-key refusal, action/target/module binding, snapshots before awaits,
location changes during collection, later-seed rollback and committed re-registration retry. Real
fiscal command cases use signed paper evidence and the supplied `P000042` identity, preserve old
SIF/series rows, and activate the complete purpose set. Those cases inject allocated hooks and
source-tree migrations; the bucket case injects the downloaded database, not an S3 download.

The default descriptors, readiness and standby public consumers, coupled text SIF/counter retirement,
current-main schema regeneration/populated upgrade, Cloud contract and both full reviews plus
hook/current-head CI remain. Task 4 is incomplete; do not publish this checkpoint.


**2026-10-13 allocated-standby checkpoint:** the fiscal contribution now implements reserve,
establish and activate with attempt-local prepared input. Reserve returns only the signed
reservation carrier; establishment writes only the dormant reservation ledger. Neither opens
series or a SIF. Separate current reservation statements and enrolled public trust are selected
through the explicit paper preparation factory. The statements do not establish independent
current history or fence another writer.

Both generic carriers prepare outside their write transaction. A module declaring series creation
at activation refuses scaffold series in either reservation output or adoption input. Adopted
arguments are detached before the first credential read, and all module authorities are rechecked
before commit, including when a later module outlives an earlier authority. Real bundle/adoption
and key-authenticated mirror-promotion tests exercise separate databases, complete purposes,
current-consumption refusal and membership-write rollback. Existing fiscal assertions, root
checks and shipped SQL are unchanged at this checkpoint.

Next select the production collector and allocated seed/restore/standby contributions together
with text SIF/counter retirement and every setup/CLI/readiness/re-registration/archive/bucket/
staged/bundle/adoption/promotion consumer. Then rebase/regenerate the complete candidate schema,
run populated upgrade and fiscal qualification, align the Cloud handoff's operator union, and
complete both full reviews, normal hook and current-head CI. No intermediate publication.


**2026-10-13 production source and initial-entry checkpoint:** the production module list now
selects `FISCAL_OPERATIONS`, which reads separately configured custodian/current-confirmation paths
and an independently compared fingerprint at each attempt. This supersedes earlier checkpoint
statements that no production collector is selected. No default path or submitted trust is used.

The public setup route accepts `initialOperations`; the provisioning CLI reads the same shape from
`WAITRON_INITIAL_VENUE_INPUT`. Both carry the planned node/admin IDs and module event/source inputs
into `applyVenue`. A committed setup retry uses the module's series resolver, checks the planned
node/admin and exact stored references, and does not recollect outside consumption. The CLI refuses
malformed, oversized or unselected-module input before stamping the environment.

Qualification uses real database/route/CLI operations and an explicitly supplied allocated seed.
The default fiscal seed/restore/standby contributions still need to switch together with text SIF
and counter retirement. Remaining public authentication/input consumers, schema regeneration and
populated upgrade, Cloud operator binding, two FULL reviews, hook and current-head CI remain.
This is not a publication candidate. Local receipts use the `w41s4-production-*` prefix.


**2026-10-13 public standby/readiness checkpoint:** the bundle and promotion HTTP routes accept
opaque generic operation input and scope it to fresh account or recovery-key authentication.
Bundle operations are bound to the primary/standby and selected reserving module. Promotion uses
a scoped runner that collects outside evidence only when activation is needed, checks a replaced
node verifier at commit, and shares activation/series/role/membership writes. Boot forwards the
enabled set and runner. Signed fiscal HTTP cases supply the real paper source and allocated
standby contribution; generic route and boot cases use test contributions.

Readiness now carries separately supplied initial allocation input into its isolated preproduction
venue, stamps that database, and recovers committed allocated references through the supplied
module set. The signed sample case checks the recorded identity/invoice and complete returned-row
comparisons after retry with the confirmation removed. Its accepted drain reply is simulated;
the existing real-drain refusal case also runs. No live authority probe or default fiscal descriptor
switch is claimed. Adoption's missing-copy limit remains, without persisted authentication.

The coupled default-descriptor/text-SIF/counter/remaining-consumer transition, current-main schema
regeneration/populated upgrade, Cloud operator union, two FULL reviews and normal hook/current-head
CI remain. Task 4 is still incomplete and this checkpoint must not be published.


**2026-10-14 series-base boundary checkpoint:** setup validation and `liveSeriesBases` accept
21 characters and refuse 22, with the setup wizard's English and Spanish help/refusal messages
using that bound. The exact boundary assertion and message changes were approved in the
2026-10-13 remaining-checks document. Default descriptor/text-SIF/counter replacement and the
remaining consumers stay coupled; this checkpoint does not complete Task 4.

**2026-10-14 hook-contract checkpoint:** the remaining-consumer audit found existing
return-field and malformed-reservation-code assertions outside the earlier exact approval
lists. The [supplemental request](2026-10-14-w41s4-hook-contract-assertion-approval.md)
names each expression and the retained complete-series, rollback, permission and history
checks. Six isolated controls reproduced the old/new interface differences and passed
with the proposed comparisons; no production code or original assertion was changed.
Task 4 is parked on that exact approval before the coupled default/text/counter switch.
