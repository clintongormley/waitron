# A10-1 Record Library Implementation Plan

> **Owner amendment, 2026-10-14 — incorporated in the steps below.**
> Decision 7 permits self-approval only for a person currently holding `admin`; every admin is an
> owner for this rule. Persist `self_approved` on the approval, include it in the extended entry hash
> and frozen-closure hash, and expose it in the record and Spanish export, retaining it after a role
> change. Managers/supervisors retain the different-approver refusal. No separate owner field.
> Decision 9 counts automatic clock-outs immediately as confirmed; pending, declined or disputed
> corrections retain the automatic time until an approval replaces it. Keep the next-clock-in
> question and append its worker acknowledgment separately (`confirmedByWorker`). Closure markers
> link unanswered automatic ends to the frozen period; they no longer enable counting. The snapshot
> field is `markedAutomaticEntryIds`. Export retains `sinConfirmar: false` and adds
> `confirmadaPorTrabajador` and `autoaprobada`. The operational checklist below incorporates these rulings;
> the original implementation receipts remain historical.
> Rework tests must observe failure first; main’s behavioral assertions stay intact. A10-1 still
> needs a fresh FULL review, green current-head CI and the owner’s separate approval to land.


> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task, inline with the driver after the separately arranged fresh-context plan review. Read `superpowers:test-driven-development` before writing implementation or tests. Do not delegate execution automatically.

**Goal:** Extend the working-time library with attributable missing-entry corrections, two-party decisions, automatic-entry confirmation, pay-period closure, and an inspectable Spanish library export.

**Architecture:** Keep clock events, corrections and their decisions in the existing per-(node, location) `time_entries` stream. Preserve the existing basic hash bytes and add a hashed extension only for new record metadata. Workforce owns venue pay-period settings and a separate append-only, hash-chained closure journal; closure also appends closure markers to the time-entry stream for unanswered automatic ends.

**Tech stack:** TypeScript, Drizzle SQLite schema/generation, `node:sqlite` through the venue-store helper, Vitest, existing shared business-day clock functions. No new dependency or package.

**Specs:** Read both [A10](../specs/2026-10-12-a10-clocking-in-and-out-design.md) and [workforce design](../specs/2026-07-22-workforce-and-time-record-design.md) fully. This implements A10 part 1 only; July's historical storage/tenant statements are superseded by current repository conventions.

## Global constraints and execution prerequisites

- Spec decisions: manager proposals take effect only on the worker's appended acceptance; worker requests only on manager approval; disagreement retains both versions; missing entries can be supplied; automatic ends count immediately as confirmed, with separate worker acknowledgment; later corrections identify closed-period impact.
- Spec decisions: monthly venue default; closure at `dayCutover` after the last day; no correction deadline; no invented start/end; every new record event is append-only and hash-chained.
- Fiscal H2 is outside the change: `computeHuella`, invoice allocation, `registros_facturacion`, alta builders, `registerSif`, and `restoreFiscal`. No changes to their files, fixtures or assertions. Running an existing fiscal check does not authorise editing it.
- No UI, routes, email, activity discovery, scheduler/end-of-day job, PDF/CSV rendering, payroll adapter, or legal research. The later job calls this branch's primitives; this branch does not make closure happen on its own.
- No updates/deletes of `time_entries`, no rewriting hashes, no compatibility adapter or data backfill. Ordinary generation may copy unchanged rows during schema rebuild; it must not reinterpret them.
- Existing workforce behavioral assertions and old hash bytes stay. Any proposed assertion change goes into the Questions section before execution; do not weaken an assertion or a repository guard.
- **Shared-path gate:** the owner’s 2026-10-13 20:20 waiver permits concurrent additions to `packages/migrations/migrations.manifest.json`; the 21:40 waiver also covers the append-only inventory. Whoever lands second rebases and retains every addition. Recheck every other in-flight path before resuming; these waivers do not cover other code.
- Driver owns backlog updates, signed-off commits, full `finish-branch`, PR and current-head CI. A10-1 ends `needs-owner-review` after FULL finish; never automatically land it.

## Current-main mapping (read receipts, not executed verification)

Read at `HEAD = origin/main = 9f8479aacbab6483a553f4bfea07d21a96a3d36c`; `git rev-parse HEAD origin/main` returned both hashes, and `git diff --name-only origin/main...HEAD` returned no paths. This is the local remote-tracking baseline, not a claim about the server's latest main.

| Current responsibility | Receipt and consequence |
| --- | --- |
| Public library | `packages/workforce/src/index.ts:47` exports chain functions, hash functions, `WorkforceBackend`, projection functions and types. `clocking.ts:177` is a concrete class, not the July spec's hypothetical interface. Extend that class; retain signatures not explicitly extended below. |
| Captured entries | `clocking.ts:32` defines `ClockEventInput`; recorder defaults to subject at `clocking.ts:644`. Capture origin and accountable author are different concepts. |
| State gate | `clocking.ts:158`, `clocking.ts:621`: `Exclude<WorkforceEntryKind, "correction">` and SQL excluding only corrections. A new kind needs an explicit live-kind allowlist; otherwise it can become today's state. |
| Correction gates | `clocking.ts:314` requests against an existing target; `clocking.ts:338` checks supervisor/manager/admin and appends approval. `clocking.ts:707` refuses a second approval per target. Preserve this refusal and the accepted further-correction path targeting the effective approval. |
| Storage | `schema/time-entries.ts:25` has five entry kinds; `:31` has requested/approved; `:59` requires a person recorder; `:125` requires all four correction columns or none. Automatic authors and missing targets need deliberate new shapes. |
| Hash/chain | `chain-hash.ts:61` fixes 16 named fields, in order; `:83` SHA-256 UTF-8 uppercase. `chain.ts:112` truncates timestamps to seconds, `:116` clamps recorded time, `:170` advances the head, `:217` reads verifiable rows. Do not change these encodings or ordering for basic entries. |
| Projection | `projection.ts:156` applies approved corrections; `:142` orders by `(recordedAt,nodeId,sequenceNo)`; `:189` pairs by event time. `:112` assigns the local calendar date of the start. Preserve these established assertions. |
| Reads | `clocking.ts:278` and `:769` fetch by event-time window, including corrections only if their new value lies in it. New record reads must follow targets/responses across the window, including late decisions, rather than filtering decision time alone. |
| Summaries | `projection.ts:244` returns both overtime readings; `clocking.ts:207` consumes injected summary rules; `:756` currently selects latest employment. Preserve the current baseline behavior; do not silently redesign employment-date handling. |
| Spanish adapter | `packages/workforce-es/src/registro-jornada.ts:60` takes sessions and `Period`, returning data, not PDF/CSV. `:27`/`:38` define `LineaJornada`/`RegistroDeJornada`. `convenio.ts:39` supplies configured rules. |
| Module/transfer | `workforce/src/classification.ts:11`, `migrations.ts:11`, `configuration-transfer.ts:1`; `composition/src/modules.ts:153` wires those seats and depends on core + identity. ES's descriptor at `:167` has no SQL workforce dependency to change in this design. |
| Calendar source | `packages/db/src/schema/tenants.ts:82`/`:83`: `timeZone` and `dayCutover` are LOCATION fields. `packages/shared/src/business-day-clock.ts:98` resolves a boundary using `BusinessDayClock`; that type's cutover uses `HH:MM` (`:27`). No new core venue column. |
| Migration coupling | `schema/workforce-chains.ts:21` points to `time_entries`; `schema/time-entries.ts:109` self-references it with restrict. Populated rebuild feasibility is unverified here. |

## Review focus

1. A decision appended months later must still correct the queried old day; Task 3 pins target-complete reads.
2. A different worker, or two concurrent answers, must not accept someone else's proposal or settle it twice; Task 2 pins actors and contention.
3. A proposed end preceding its start, or a missing entry duplicating an existing event, must not manufacture negative/duplicate work; Tasks 2–3 pin validation and valid controls.
4. Closing a month at non-zero offset/DST must not close early or make a retry double-count automatic ends; Task 4 pins boundary and replay.
5. A dispute or automatic end without a completed session must remain visible in the export; Task 5 pins history independently of totals.

## Prospective decisions and defaults

These are implementation defaults, not additional legal requirements. The named questions below identify limits needing attention in review.

- Retain calendar `workDate` and half-open `[start,end)` `Period`. Monthly is calendar month; add configurable weekly (Monday start) and fortnightly (Monday anchor) periods. A venue singleton settings row uses `id = 1`, no tenant column; absence reads monthly. Explicit malformed/null settings refuse, never silently default.
- Period membership follows session start's existing local calendar day. The closure instant is `businessDayBoundaryAt(clock, period.end)`, after the final date's business day. Do not rename the legal calendar date into a business-day date.
- One venue setting applies to every location; a closure is scoped to a location because the available clock and time chains are location-scoped. Store that location's resolved clock with its closure. Multi-location combined finalisation is deferred (Question 2).
- An unanswered automatic end closes the live state and immediately contributes its effective worked minutes as confirmed time. An effective correction of that end counts immediately: worker-request approval and manager-proposal acceptance both supply the agreed time. Pending, declined and disputed changes remain ineffective. At closure an unanswered end contributes and remains automatic/unacknowledged; its original authorship never changes.
- Preserve ordinary clock-write permissions and recorder identity, including a staff recorder different from the subject. For new extended clock rows, read the actual recorder's role at append and store/hash worker or manager author kind; a later role change cannot recategorise that entry. Self-service records worker authorship. Manager correction proposals/approvals retain their role checks. An automatic entry has explicit automatic authorship and null recorder.
- Manager `requestCorrection` remains a pending requested row, preserving the existing supervisor-request assertion; its direction is manager-proposal, and manager approval cannot make it effective. `proposeCorrection` is the explicit public convenience method for that path.
- Multiple proposals may remain pending; a successful settlement reserves its effective target. Stale competing proposals refuse until superseded by a new proposal against the effective entry. A disagreement is terminal for that proposal; a new proposal may follow. No automatic dispute resolution.
- A manager decline of a worker request is recorded and ineffective. The worker's reason is required on disagreement; every correction proposal/request has a trimmed nonblank reason. Automatic confirmation carries no invented correction reason.
- Missing corrections identify a subject, location, clock kind and supplied instant. No fake original event, no guessed rota time. Pending missing events do not enter live state; accepted ones enter historical projection. Further corrections target the approved inserted entry.
- Keep all original event instants to whole seconds and the existing elapsed-minute rounding. Do not introduce minute truncation from the draft-law description.
- Closure captures immutable actual sessions, pending/disputed history, marked automatic ids and summaries under the supplied rules. Missing employment permits recording actual time with `summary: null`; existing `workSummary` still refuses `employment.not_found`.
- The closure journal has its own per-(node,location) hash chain; this is pay-period history, not a second stream for clock/correction events. Both streams are verified independently. A closure marker does not settle the worker's question: a later worker confirmation or correction remains allowed after closure.
- No new mutable closure-head table is needed: read the latest closure by chain position in the caller's write transaction.

## Public interfaces and file boundaries

All types below are exported from `packages/workforce/src/index.ts` unless marked internal. Existing `WorkSession`, `PeriodSummary`, `Period`, `ChainKey`, `Origin` and `WorkSummaryRuleset` retain their current meanings. All writes take the caller's `Transaction`; no method opens a write transaction. Queries on one transaction run in sequence.

**`src/record-types.ts` (new):**

- `ClockEntryKind = "in" | "out" | "break_start" | "break_end"`.
- Extend `WorkforceEntryKind` with `"confirmation"`; extend `CorrectionStatus` with `"declined" | "disputed"`. `approved` still means an effective correction; acceptance is an approved response to a manager proposal.
- `EntryAuthor = { kind: "worker" | "manager"; personId: string } | { kind: "automatic"; personId: null }`.
- `CorrectionTarget = { correctsEntryId: string } | { personId: string; locationId: string; missingEntryKind: ClockEntryKind }` (mutually exclusive, runtime checked).
- `RecordExtension = { selfApproved?: boolean; authorKind: "worker" | "manager" | "automatic" | null; direction: "worker_request" | "manager_proposal" | null; missingEntryKind: ClockEntryKind | null; respondsToEntryId: string | null; payPeriodClosureId: string | null }`.
- `CorrectionRequestInput`: retain nodeId, at, offsetMinutes, reason, actorPersonId, origin; intersect with `CorrectionTarget`. `CorrectionApprovalInput` stays unchanged, including dashboard approval origin.
- `CorrectionDecisionInput = { nodeId: string; correctionId: string; actorPersonId: string; origin: Origin; reason?: string }`.
- `AutomaticCloseInput = { nodeId: string; personId: string; locationId: string; openEntryId: string; at: string; offsetMinutes: number; origin: JobOrigin }`; `at` is caller-supplied last activity, not discovered here.
- `AutomaticConfirmationInput = { nodeId: string; entryId: string; workerPersonId: string; origin: Origin }`.
- Extend `TimeEntryRecord` with `recordedByPersonId?: string | null`, `origin?: Origin`, `correctionReason?: string | null`, `correctionActorId?: string | null`, and `extension?: RecordExtension | null`; keep its existing plain fixture inputs valid. `EntryHashInput.recordedByPersonId` becomes `string | null`, and gains optional `extension: RecordExtension | null`.
- Extend public `TimeEntryAppend` with the same optional `extension`, nullable recorder and expanded correction-status union; `appendToChain`/`readChain` signatures otherwise stay. Keep type re-exports from `clocking.ts` for its current direct-importing suites.
- `ProjectedRecordEntry = { entry: TimeEntryRecord; author: EntryAuthor; effective: boolean; confirmed: boolean; confirmedByWorker: boolean; selfApproved: boolean; corrected: boolean; disputed: boolean; closedPeriodIds: string[] }`.
- `ClosedPeriodImpact = { closureId: string; personId: string; beforeWorkedMinutes: number; afterWorkedMinutes: number; deltaWorkedMinutes: number }`. Include impacts for changed values or confirmation/dispute status even when the minute delta is zero.
- `PayPeriodClosureView = { closureId: string; locationId: string; period: Period; closedAt: string; closureHash: string; snapshot: PayPeriodSnapshot }`; its snapshot is filtered to the requested subject/location. This is a view, not input to closure-chain verification.
- `TimeRecord = { sessions: WorkSession[]; entries: ProjectedRecordEntry[]; closures: PayPeriodClosureView[]; closedPeriodImpacts: ClosedPeriodImpact[] }`. Rich database reads always supply full attribution; `projectTimeRecord` refuses incomplete attribution with `attendance.invalid`, rather than inventing authors for session-only input.

**`src/corrections.ts` (new), `src/automatic-entries.ts` (new), class delegates in `src/clocking.ts`:**

- `WorkforceBackend.requestCorrection(tx, input: CorrectionRequestInput): Promise<string>`; retain `approveCorrection(tx, input: CorrectionApprovalInput): Promise<string>`.
- Add `proposeCorrection(tx, input: CorrectionRequestInput): Promise<string>`, `acceptCorrection(tx, input: CorrectionDecisionInput): Promise<string>`, `disagreeCorrection(tx, input: CorrectionDecisionInput): Promise<string>`, `declineCorrection(tx, input: CorrectionDecisionInput): Promise<string>`.
- Add `recordAutomaticClose(tx, input: AutomaticCloseInput): Promise<string>` and `confirmAutomaticEntry(tx, input: AutomaticConfirmationInput): Promise<string>`. If an applicable period closure already exists, `recordAutomaticClose` appends the new automatic end and exactly one closure marker referencing that closure in the same caller transaction. The frozen closure is unchanged; live time and closed-period impact include the late end. A duplicate call naming the already-closed open entry refuses `attendance.not_pending` before appending. Closure replay itself still appends nothing.
- Internal `effectiveClockEntries(entries: readonly TimeEntryRecord[]): TimeEntryRecord[]` in new `src/effective-entries.ts` resolves effective captures for pairing/live-state checks; `projectWorkSessions` uses it without adding output fields. Mutation validation uses the same effective view.
- Internal helpers share target resolution, role/ownership checks, settlement lookup and append. Do not copy scheduling methods out of `clocking.ts` as unrelated cleanup.

**`src/record-projection.ts` / `src/record-reads.ts` (new):**

- `projectTimeRecord(entries: readonly TimeEntryRecord[], closures: readonly PayPeriodClosure[] = []): TimeRecord`.
- `projectWorkSessions(entries: readonly TimeEntryRecord[]): WorkSession[]` stays exported with unchanged basic output shape; extend its normalization to approved missing entries and confirmation markers. Do not attach metadata to `WorkSession` and break exact equality assertions.
- `WorkforceBackend.timeRecord(tx, query: { period: Period; personId?: string; locationId?: string }): Promise<TimeRecord>`; require at least one scope id. Resolve all relevant target/response chains, not only rows whose proposed/event time is within the range. Compute using complete closure rows internally, then filter every returned closure snapshot and impact to the explicit query scope; a worker query must not expose another worker through a closure. Later routes still own caller authorisation.
- Existing `workSummary` and `getPlannedVsActual` use the same effective entry normalization; return their existing shapes. Counting markers make closure changes visible through `time_entries`, without introducing a closure-table dependency into dashboard totals.

**`src/pay-periods.ts` / `src/pay-period-chain.ts` (new):**

- `PayPeriodSettings = { frequency: "monthly" | "weekly" | "fortnightly"; anchorDate: string | null }`; anchor only required/allowed for fortnightly and must be Monday.
- `resolvePayPeriod(settings: PayPeriodSettings, localDate: string): Period`.
- `readPayPeriodSettings(tx: Database | Transaction): Promise<PayPeriodSettings>`; `setPayPeriodSettings(tx: Transaction, settings: PayPeriodSettings): Promise<void>`.
- `PayPeriodSnapshot = { sessions: WorkSession[]; entries: ProjectedRecordEntry[]; summaries: { personId: string; summary: PeriodSummary | null }[]; markedAutomaticEntryIds: string[] }`.
- `PayPeriodClosure = { id: string; nodeId: string; locationId: string; period: Period; clock: BusinessDayClock; scheduledCloseAt: string; closedAt: string; snapshot: PayPeriodSnapshot; sequenceNo: number; prevClosureHash: string | null; closureHash: string }`.
- `closePayPeriod(tx: Transaction, input: { nodeId: string; locationId: string; period: Period; clock: BusinessDayClock; now: string; ruleset: WorkSummaryRuleset; origin: JobOrigin }): Promise<PayPeriodClosure>`; input period must match the configured cadence. Caller supplies the location's trusted resolved clock, including dated cutover changes.
- `readPayPeriodClosures(tx: Database | Transaction, input: { locationId: string; period: Period }): Promise<PayPeriodClosure[]>` (overlapping closures).
- `verifyPayPeriodClosures(rows: readonly PayPeriodClosure[]): ChainVerification`; use existing result vocabulary, verify one node/location segment at a time. Internal `computeClosureHash` hashes a fixed-order JSON tuple `[id,nodeId,locationId,period.start,period.end,clock.timeZone,clock.dayCutover,clock.cutoverChanges,scheduledCloseAt,closedAt,snapshot,sequenceNo,prevClosureHash]`; snapshot objects serialize fields in their declared type order, absent optional fields as null (never caller object insertion order), sessions sort by person/start/location, entries by recording tuple/id, summaries by person, and marked ids lexically. Include all persisted fields and reject duplicate snapshot ids; no fiscal hashing helper.

**`packages/workforce-es/src/registro-jornada.ts`:**

- Retain `exportTimeRecord(sessions: readonly WorkSession[], periodo: Period): RegistroDeJornada`; add an overload `exportTimeRecord(record: TimeRecord, periodo: Period): RegistroDeJornada`.
- Retain every existing `LineaJornada` field and value. Extend `RegistroDeJornada` with optional `entradas: EntradaJornada[]`, `cierres: PayPeriodClosureView[]` and `cambiosPeriodosCerrados: ClosedPeriodImpact[]` on rich input only; session-only export cannot reconstruct who authored an entry.
- `EntradaJornada = { entryId: string; personId: string; locationId: string; tipo: WorkforceEntryKind; tipoEntradaFaltante: ClockEntryKind | null; direccionCorreccion: "worker_request" | "manager_proposal" | null; estadoCorreccion: CorrectionStatus | null; instante: string; offsetMinutes: number; autor: EntryAuthor; motivo: string | null; corrigeEntradaId: string | null; respondeEntradaId: string | null; efectiva: boolean; automatica: boolean; sinConfirmar: boolean; confirmadaPorTrabajador: boolean; autoaprobada: boolean; corregida: boolean; disputada: boolean; periodosCerrados: string[] }`.
- Export each relevant historical version and response, including unmatched days, with actual local offsets. No contact details or ID numbers added. Audience filtering and physical rendering remain part 6.

## Schema, hashing and migration decisions

- Modify `src/schema/time-entries.ts`: nullable recorder only for explicit automatic rows; add nullable author-kind, direction, missing-kind, response-id and closure-id columns, response self-FK and closure FK, all restrict. Keep old columns/check names and all existing foreign keys/indexes.
- Shape CHECK: a basic clock row has no correction fields; a confirmation has response id and no correction fields; targeted correction has all four existing correction fields; missing correction has null target, non-null missing kind, reason/status/actor, direction and subject/location. A targetless approved row without a missing kind remains malformed and inert.
- Confirmation author worker means worker confirmation; author automatic + closure id means a link to the frozen period, NOT worker acceptance. Ordinary raw basic shapes remain a supported input shape, not an old-version import/migration path.
- New `src/schema/pay-period-settings.ts`: singleton state table, frequency + anchor checks. New `src/schema/pay-period-closures.ts`: append-only ledger, node/location FKs, period/date/clock/snapshot fields, sequence, predecessor/hash, unique chain position and unique `(location_id, period_start, period_end)`. Declare all keys/checks in TypeScript using the shared column vocabulary. No person id arrays without declared reference handling.
- Modify schema/public barrels, classification and configuration transfer. Transfer only pay-period settings; never entries, closures or snapshots. The existing module seats pick these up by reference; no new composition dependency or ES migration is required.
- Preserve the 16-field canonical string exactly when extension is absent/null. With non-null extension append `&RecordExtension=` plus `JSON.stringify([selfApproved ?? false,authorKind,direction,missingEntryKind,respondsToEntryId,payPeriodClosureId])`, including every null slot. This is an enduring basic/extended record shape, not version dispatch or backfill. New writers bind changed meaning into the extension; reader and hash use identical values. Hash null automatic recorder as the empty value in the existing recorder field.
- Generate additions first without adding CHECKs/retyping old columns in that generation: `pnpm --filter @waitron/workforce db:generate --name a10_record_columns`. Then apply final constraints/nullability/enums and generate `--name a10_record_constraints`. Generated filenames/journal positions are determined from the current branch under the shared-path waiver; never predict or hand-edit their numbers.
- **Unverified migration risk:** the second generation may rebuild `time_entries` while populated self/head FKs exist. Inspect emitted SQL and run Task 1's populated upgrade. Do not ship a failed upgrade, suppress keys/triggers, edit shipped SQL, or add a reset exception to a repository guard to make it pass. See Question 3 if generation cannot satisfy the unchanged guard.
- If a pre-production reset is required, state exactly in the PR's first line that existing venue folders using the old workforce schema must be discarded and recreated/reseeded, not restored from old archives/bucket copies. Driver identifies the affected development/demo venue and uses `wa-wt reset demo <worktree-name>`; no production data conversion. This plan authorises no actual reset by the planner and no edits to shipped migrations.

## Consumer audit required before enum, meaning or gate edits

The following is the read mapping to refresh after Lane E/review; search declarations AND prose before implementing.

- `workforce/src/schema/time-entries.ts`, `projection.ts`, `chain.ts`, `chain-hash.ts`, `clocking.ts`, schema/public barrels: enum checks, append inputs, verifier reads, projection filtering, current-state gate, targeted/missing correction resolution and both period readers.
- Existing workforce suites: `migrations.test.ts`, `schema/schema-conformance.test.ts`, `chain-hash.test.ts`, `chain.test.ts`, `chain.concurrency.test.ts`, `clocking.test.ts`, `clocking.concurrency.test.ts`, `corrections.test.ts`, `projection.test.ts`, `planned-vs-actual.test.ts`, `restore-continuation.test.ts`, `index.test.ts`, `schema-ownership.test.ts`, `classification.test.ts`; fixtures `test/fixtures.ts:245` accepts the kind enum.
- ES: `registro-jornada.ts`, `registro-jornada.test.ts`, `work-summary.test.ts`, public-surface `index.test.ts`. `convenio.ts`'s rules resolver is consumed unchanged. ES schema/configuration transfer remain unchanged.
- Existing app consumers: `apps/server/src/workforce-api.ts:9`/`:309` use backend scheduling/planned-vs-actual; `schedule-api.ts:12` and `me-api.ts:13` use schedule reads. `apps/dashboard/src/api/live-queries.ts:487` observes `time_entries` for planned-vs-actual. Keep app interfaces and dependency metadata unchanged; closure markers are observable through that source. Add a library test that this query changes after closure.
- `composition/src/modules.ts:153`, `composition.test.ts:107`, workforce descriptors, `migrations/migrations.manifest.json:50`: classification/append-only lists and transfer contributions. `scripts/changed-scope.mjs:270`/`:274` names these packages; driver checks current-head CI selection for all affected consumers.
- Root guards include classification, append-only descriptors/triggers, schema/upgrade, module graph, transfer references, English vocabulary, errors reachability and workspace cycles. Run unchanged guards; additions to feature-owned inventory tests must retain exact-set checks and every existing name.
- `packages/fiscal-verifactu/src/privileges.expected.ts:114` is read by `scripts/write-path-tables.test.ts`; it is a historical privileges record, not the new schema inventory. Do not edit it or fiscal assertions for A10 table additions.
- Search prose across repository docs/READMEs for old correction/approval and export descriptions; driver updates current documentation in scope, leaves historical specs intact with dated pointers if necessary, and records any additional lane overlap before editing.

## Preserved assertions and review decisions

No existing behavioral assertion is proposed for removal or replacement. Inventory additions in workforce `index.test.ts`/`schema-ownership.test.ts` must be recorded here before editing: add the new public runtime exports and the two owned tables, retaining every old name and exact-set equality; this is feature contract expansion, not changing root guard logic.

- Hash bytes: keep `chain-hash.test.ts:133`'s hand-written canonical-string equality and all field sensitivity cases; retain inserted/removed/reordered/tampered failures and valid negative control (`:156`).
- Chain: keep whole-second/monotonic checks, independent nodes, savepoint retry, 20 concurrent appends, source/device/reason/actor tampering, and restore continuation `[1,2,3,4]`, one genesis (`restore-continuation.test.ts:108`).
- Corrections: keep pending request 480 minutes (`corrections.test.ts:101`, INCLUDING manager-authored pending input); worker-request approval 540 and original 17:00 unchanged (`:149`); origin assertions (`:174`); non-supervisor refusal, missing target, duplicate approval count 1 (`:247`); cross-node result 570 (`:280`).
- Projection: keep exact ordinary session objects; timestamp sorting, calendar-day and DST results; approved/latest/correction-of-correction behavior; missing target without new missing-kind discriminator remains inert (`projection.test.ts:353`/`:363`).
- Totals/export: keep both overtime figures, split-shift daily aggregation, half-open periods and configured headline; ES default 2700/2400/300 (`work-summary.test.ts:78`), 60-vs-0 headlines (`:123`); existing Spanish fields/order/retention/access assertions.

**Review decisions and remaining execution gate:**

1. The basic/extended hash shape preserves old bytes while binding new fields. Use this as a permanent format extension, without an old-version import or backfill path. If execution instead requires one unconditional new hash format, stop: changing the canonical-byte assertion needs an explicit recorded owner decision and a reset; do not weaken it.
2. Selected implementation defaults: weekly/fortnightly options, before-closure automatic totals excluded, location-scoped closure under venue-wide cadence, calendar-day membership, and independent closure chain. The spec fixes monthly default but leaves these details open; retain the listed defaults. Multi-location finalisation is not implemented here.
3. Populated rebuild is a real unresolved feasibility gate. Run generation/upgrade before feature implementation proceeds. If it requires a reset exception in `scripts/migration-upgrade.test.ts`, that conflicts with this task's prohibition on changing repository guards. Report exact failing SQL/constraint and seek a changed design or explicit scope decision; a reset alone does not turn a failing guard green.
4. Existing request APIs admit manager-authored pending rows. The plan preserves that assertion and routes settlement to worker acceptance. If execution requires refusing such requests instead, record the proposed change to `corrections.test.ts:101` BEFORE asking to change it.
5. Preserve `clocking.test.ts:128` and its successful recorder/source/device equality unchanged. The spec does not request a new ordinary-clock permission gate. Add a new metadata test for the retained staff-on-behalf path and a later recorder-role change; assert actual recorder identity and stable stored author kind. No fixture-role change or owner answer is required.

## Task 1: Record shapes, schema and hash integrity

**Files:** Modify workforce `src/schema/time-entries.ts`, `src/schema/index.ts`, `src/index.ts`, `src/chain.ts`, `src/chain-hash.ts`, `src/projection.ts` (type imports), `src/classification.ts`, `src/configuration-transfer.ts`; create `src/record-types.ts`, `src/schema/pay-period-settings.ts`, `src/schema/pay-period-closures.ts`, `src/pay-period-chain.ts`, `src/pay-period-chain.test.ts`, `src/record-migration.test.ts`; generate new files under `packages/workforce/drizzle/`; modify the manifest only after Lane E lands. Extend feature-owned inventory tests as described above.

**Interfaces:** Produces the record types, schema declarations, complete hash append/read round-trip and closure verifier described above. Barrels expose `payPeriodSettings`, `payPeriodClosures`, types and the completed Task 1 verifier; add later functions when their owning task implements them. No undefined exports during intermediate commits. Switch the live-kind type/SQL filter to the explicit four captured kinds when adding the confirmation enum, retaining existing state results.

- [ ] Write failing tests: basic canonical bytes unchanged; two extended rows differing ONLY in each extension field hash differently; null recorder plus automatic authorship round-trips; response/closure pointers cannot be changed undetected; extension removal gives `hash_mismatch`; valid extended chain gives `{ok:true}`. Add closure chain tamper/gap/predecessor controls.
- [ ] Run `pnpm --filter @waitron/workforce exec vitest run src/chain-hash.test.ts src/chain.test.ts src/pay-period-chain.test.ts src/record-migration.test.ts`. Require named failures for absent shapes/functions, not an unrelated import crash; expose one behavior at a time if needed.
- [ ] Implement types/append/hash/closure verifier minimally. Keep absent-extension canonical bytes; add raw valid/invalid controls for missing-correction shape, author/null-recorder pairing, response ownership references, new vocabularies and all old malformed shapes.
- [ ] Generate both migration stages. In `record-migration.test.ts`, use real migration steps on a helper-owned venue with base events, a requested AND approved correction, live chain head, append-only triggers and change feed. Compare original rows/hashes/head values, then append/reverify new shapes; execute FK writes as well as migrate. Run upgrade and schema guards below; halt at Question 3 on a failure.
- [ ] Re-run the focused command plus `src/migrations.test.ts src/schema/schema-conformance.test.ts src/schema-ownership.test.ts src/index.test.ts src/classification.test.ts`; require actual passing test counts and unchanged old assertions. Commit the coherent shape/migration/hash unit with `git commit -s`; do not commit failed migration scaffolding as complete.

## Task 2: Correction and automatic-entry lifecycle

**Files:** Create workforce `src/corrections.ts`, `src/automatic-entries.ts`, `src/effective-entries.ts`, `src/correction-lifecycle.test.ts`, `src/automatic-entries.test.ts`; modify `src/clocking.ts`, `src/projection.ts`, `src/errors.ts`, barrels and, only for additive cases, `src/corrections.test.ts`/`src/clocking.concurrency.test.ts`.

**Interfaces:** Produces all backend mutation methods above and the minimal `effectiveClockEntries` normalization needed for their effective-minute tests; consumes Task 1 shapes and `appendToChain`. Thread attribution/extension columns through current readers now; Task 3 then replaces their window logic and adds rich history views. Add domain errors `correction.invalid {reason:string}`, `attendance.invalid {reason:string}`, `attendance.not_permitted {personId:string}`, `attendance.not_pending {entryId:string}`; reuse target/not-pending/not-permitted codes where their meanings fit. Unknown subject/location uses the existing existence-helper refusal. Do not add UI error wording in this part.

- [ ] Write failing named cases: pending missing out gives no session; worker-request approval supplies 09:00–18:00 = 540; manager proposal over 17:00 leaves 480 until worker acceptance gives 540; disagreement leaves 480 and both versions; decline remains ineffective. Assert complete rows/actors, original bytes and reverified chain, not only row count.
- [ ] Add refusal/control pairs: staff cannot propose/approve/decline; different worker cannot accept/disagree/confirm; a non-admin requester cannot approve their own request, while a current admin can self-approve with the stored flag; manager cannot approve their proposal or propose-and-accept their own change; accepted/declined/disputed or stale target cannot settle again; correcting the effective approval succeeds; blank reason/invalid kind/null/invalid date/fractional offset refuse before append.
- [ ] Add missing-entry structural checks: supplied event and targeted retiming must form a valid chronological session/break sequence with the effective history; duplicate supplied event refuses; missing in+out requests can be approved in chronological order; target person/location cannot be substituted; existing targetless malformed fixture remains inert.
- [ ] Run `pnpm --filter @waitron/workforce exec vitest run src/correction-lifecycle.test.ts src/automatic-entries.test.ts src/corrections.test.ts src/clocking.concurrency.test.ts`; watch the expected behavior fail, then implement one behavior, then watch that case pass.
- [ ] Retain the existing ordinary-clock attribution assertion unchanged; add the stable-author metadata controls described in Question 5.
- [ ] Automatic close requires the named open in, same subject/location, and an explicitly supplied later activity instant; same-instant/no activity (compare after whole-second normalization), closed/replaced open, wrong origin shape and clock-out before in refuse without a row. On-break close ends the trailing break at the supplied end in the projection, without inventing a human break-end. A later real clock-in is allowed; targeted retiming and confirmation rows cannot set live state; accepted missing events follow Task 3's chronological state rule.
- [ ] Run two concurrent acceptance/approval/confirmation calls through separate `withTransaction` bodies: exactly one human decision commits and the other returns the named not-pending code; chain remains contiguous. Keep the existing concurrent-clock assertion. Re-run focused suites and commit with `git commit -s`.

## Task 3: Effective projection and complete record reads

**Files:** Create workforce `src/record-projection.ts`, `src/record-reads.ts`, `src/record-projection.test.ts`, `src/record-reads.test.ts`; modify `src/projection.ts`, `src/clocking.ts`, barrels; preserve all existing projection/planned-vs-actual tests.

**Interfaces:** Produces `TimeRecord`, `projectTimeRecord`, backend `timeRecord`, and reference-complete summary/planned-vs-actual reads using Task 2's `effectiveClockEntries`. Do not duplicate or replace its already-tested normalization. Caller-owned rich input supplies attribution; bare old projection fixture shapes retain established behavior.

- [ ] Add preclosure automatic-correction cases: unanswered automatic 09:00–17:00 gives 480 counted minutes; worker-request approval or manager-proposal acceptance of 18:00 gives 540 before closure; pending/declined/disputed controls retain 480. The original 17:00 row retains automatic authorship.
- [ ] Write failing cases: rejected/unaccepted proposal has no effective contribution; accepted missing start/end projects exactly once; original/proposed/answer rows remain visible with distinct authors; an unanswered automatic end is visible and effective with confirmedByWorker=false until acknowledgment; corrected and disputed flags can coexist.
- [ ] Add scope/window cases: a worker-scoped query/export contains no other person in sessions, entries, closure snapshot or impacts; January target answered in March, corrected January end moved outside January, start moved into/out of queried period, target/response on different nodes, missing whole session, split shifts, breaks and two locations. Follow references before filtering projected session dates. Wrong-person/location data cannot be pulled into the record by a reference.
- [ ] Run `pnpm --filter @waitron/workforce exec vitest run src/record-projection.test.ts src/record-reads.test.ts src/projection.test.ts src/planned-vs-actual.test.ts src/clocking.test.ts`; require expected new behavioral failures first.
- [ ] Implement target/response-aware normalization and scoped reads; preserve `(recordedAt,nodeId,sequenceNo)` precedence and timestamp pairing. Disputes preserve competing values but cannot replace an effective value. A pending/stray missing event cannot affect today's state; live state adds accepted missing events, using their resolved clock kind and supplied event time, only in chronological order with actual captures. Thus an approved missing out can close the old open in and permit a new clock-in, while an older missing out cannot replace a newer live in. Targeted retiming and confirmation rows never become live transitions.
- [ ] Pin live-state controls through the backend: approved missing out after the last open in permits the next `clockIn`; an older approved missing out cannot displace a newer actual in, so a second clock-in still refuses `attendance.already_open`. Keep existing targeted-retiming state assertions.
- [ ] Test read order independence with shuffled inputs and equal event timestamps; use deterministic recording tuple as tie-break for new event types without changing the existing distinct-time assertions. Re-run the focused command, including old exact output tests, and commit with `git commit -s`.

## Task 4: Pay-period settings, immutable closure and late impacts

**Files:** Create workforce `src/pay-periods.ts`, `src/pay-periods.test.ts`, `src/pay-period-closure.test.ts`, `src/pay-period-configuration.test.ts`; modify record projection/reads, errors and barrels. Add configuration-descriptor tests inside workforce; retain composition's existing transfer exclusions.

**Interfaces:** Produces pay-period functions/types above. Errors: `pay_period.invalid {reason:string}`, `pay_period.not_due {closeAt:string}`. Existing identical closure replay returns its stored snapshot; changed clock/settings/rules on replay never rewrite it. Invalid/overlapping nonidentical period requests refuse.

- [ ] Write failing monthly-default/weekly/fortnightly cases, leap February and December rollover, singleton settings round-trip and invalid frequency/anchor/null controls. Assert transferable settings contain no ledger tables or foreign venue ids. Use existing column vocabulary and shared calendar helpers.
- [ ] Write boundary tests: October period `[2026-10-01,2026-11-01)` with Madrid `06:00` closes at `2026-11-01T05:00:00.000Z`; one second before refuses, exact boundary succeeds. Include a period whose closure boundary itself crosses DST, and a dated cutover change; compare with shared helper output and explicit UTC expectations.
- [ ] Write closure tests: unanswered automatic 09:00–17:00 contributes 480 at closure, author remains automatic/confirmed=true, confirmedByWorker=false, open no-activity shift contributes none, worker-confirmed end already counted once; missing entries and unresolved requests/disputes survive in snapshot. Actual time survives missing employment with null summary; existing standalone summary still refuses.
- [ ] Run `pnpm --filter @waitron/workforce exec vitest run src/pay-periods.test.ts src/pay-period-closure.test.ts src/pay-period-configuration.test.ts`; watch failures before implementing each primitive.
- [ ] Implement closure in one caller transaction: read complete history/heads, compute frozen snapshot with eligible automatic ends counted, append immutable closure with canonical hash, then append one automatic confirmation/closure marker per eligible end referencing that closure. An exception rolls back closure AND markers; no snapshot or closure marker can escape alone. Late ingestion is an amendment against closure, not a snapshot rewrite.
- [ ] Add a late automatic end after closure: frozen snapshot/id/hash unchanged, one new end and one marker commit together, live 480 and a closed-period impact appear, duplicate refuses without rows. Inject failure between end and marker and assert neither row commits. Replay of the original closure remains byte-identical and writes nothing.
- [ ] Add replay/concurrency/rollback controls: repeat closure returns identical id/hash/snapshot and no new markers; two simultaneous closes commit one closure; injected failure after first marker leaves no closure/markers/head change. Verify both chain segments and old time-chain continuity.
- [ ] Add late corrections/acceptance/disagreement tests: after closed 480, an accepted 18:00 correction gives live 540 and `ClosedPeriodImpact` before=480/after=540/delta=60, identifies the original closed period, frozen 480 unchanged; moving the session between periods identifies both affected closed periods. A new month is unaffected. Existing planned-vs-actual reflects automatic time immediately, independent of closure markers; no app edits needed.
- [ ] Re-run focused Task 3 and Task 4 suites; commit with `git commit -s`.

## Task 5: Spanish library export over full history

**Files:** Modify `packages/workforce-es/src/registro-jornada.ts`, `src/index.ts`, additive public-surface expectations in `src/index.test.ts`; create `src/registro-jornada-record.test.ts`; retain `src/registro-jornada.test.ts` and `src/work-summary.test.ts` assertions.

**Interfaces:** Produces the rich `exportTimeRecord` overload and `EntradaJornada`; consumes `TimeRecord`. No new ES table/migration, statutory claim or physical renderer.

- [ ] Write failing export cases: real-library worker request/manager approval, manager proposal/worker acceptance, disagreement with both 17:00/18:00 versions, automatic confirmed closure with no worker acknowledgment, later +60 closed-period amendment, and missing day without a completed session. Assert author identity, flags, target/response links, reasons and closed-period ids individually.
- [ ] Run `pnpm --filter @waitron/workforce-es exec vitest run src/registro-jornada-record.test.ts src/registro-jornada.test.ts src/work-summary.test.ts src/index.test.ts`; expect new metadata assertions to fail before implementation, then implement the data mapping.
- [ ] Assert rich export distinguishes missing in from missing out, pending from declined, worker request from manager proposal through the three added discriminators. Include both the original automatic end and its accepted correction with their own authors and statuses.
- [ ] Preserve ordinary session-only line equality, local offsets including repeated DST hour, half-open filtering, deterministic person/date order, four-year constant/date and three access holders. Rich history filtering follows affected dates rather than March answer time; history sorting uses recording tuple plus entry id, never discards alternative versions.
- [ ] Re-run the command; require real test counts. Commit the export unit with `git commit -s`.

## Driver validation and full finish gates

These are prospective commands, NOT tests run by this planner. Check each exit status and actual test count; do not mistake selected-nothing, skip or blank output for a pass.

- [ ] Before implementation: fresh-context plan review, shared-path waiver checked, current lane diff audit, Questions 1–5 addressed at the necessary gate. Confirm only the driver is editing/testing this checkout.
- [ ] After generation run `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/append-only-migration-sets.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/classification-complete.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts` and read their counts. Keep all guard code unchanged. These inventory/scanner checks supplement the populated feature upgrade; they do not prove every production path.
- [ ] Run `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` for manifest/descriptor equality and transfer exclusions. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts` if required by a migration rebase; do not edit that suite. Schema conformance must exercise new FK writes and update/delete refusal of closures as well as `time_entries`.
- [ ] In a disposable candidate, delete worker ownership/settlement guards and automatic session contribution one at a time: respective wrong-worker/duplicate/immediate-count tests must fail for the expected result; valid ownership/replay controls must still pass. Never perform destructive probes in the feature checkout.
- [ ] Driver updates backlog and current prose, audits all base-to-tip claims, commits with `git commit -s`. Announce readiness to run `finish-branch`, then perform FULL finish as already required for this item: initial rebase, one Claude run-it whole-branch review in an installed disposable complete candidate, triage and focused TDD fixes.
- [ ] Normal push hook supplies frozen install, formatting, lint, root guards/coverage and scoped types. Never bypass hooks or lower coverage. Avoid a redundant whole-workspace local package run solely for finishing; investigate any uncovered behavior with focused checks.
- [ ] Open/update PR; verify required coverage jobs for workforce, workforce-es and affected consumers on the actual current head (`98/98/98/95`), plus all required CI and resolved review conversations. Retain review report/command receipts and flag any UNVERIFIED claim. Rebase conflicts require migration regeneration, never manual journal/snapshot repair.
- [ ] Final driver report: PR URL/head SHA, CI/review evidence, any reset requirement, retained owner questions, and state `needs-owner-review`. Owner sign-off is required before landing A10-1; no automatic merge or campaign-state change by this planner.

## Planning self-review

The planner reread both specs against the file after drafting; the following is the resulting coverage/consistency check, not execution evidence.

- A10 library bullets and decisions 5, 7–10 map to Tasks 1–5: only their library support is included; discovering activity/missing shifts, dispatching questions and invoking closure are later parts.
- July's unified clock/correction stream, ingest-vs-event ordering, original-history retention, per-node rekey, generic/Spanish boundary and both configured overtime readings are retained. Historical Postgres/RLS/tenant language is not implemented on today's store.
- Public names/types match the task interface blocks; ordinary session/summary/export interfaces stay usable without fabricated history. Automatic ends and closure markers are observable through the existing time-entry subscription source.
- All five review-focus inputs have explicit failure and valid controls; preserved assertions are listed before any permitted inventory additions. Fiscal H2 and repository guard edits are excluded.
- This is a prospective plan based on file reads. No test, migration, server, review seat or legal-source experiment was run. Populated migration feasibility and the listed defaults remain review gates, not verified claims.
