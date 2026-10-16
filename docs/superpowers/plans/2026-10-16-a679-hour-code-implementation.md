# A679 Hour-Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` for INLINE execution, one task at a time. Read `superpowers:test-driven-development` before writing implementation or tests. The owner already selected inline execution and authorised finish/land; do not ask again. Exact protected-edit permissions and generated-PDF acceptance remain separate gates.

**Goal:** Complete first Live setup and ordinary recovery using durable UTC-hour identities and one key-only recovery PDF.

**Architecture:** The fiscal module owns hour encoding, clock policy, historical floors and admission. Generic hosts provide authenticated operation context, durable opaque state, exclusion and module dispatch. Retain existing activation, restore, ownership, retirement and publication interfaces wherever they can consume the new validated input without protected edits.

**Tech Stack:** TypeScript, Lit/shared UI controls, Hono, existing durable JSON/filesystem stores, SQLite through existing module interfaces, PDFKit/fontkit/PDF.js/pdf-lib, Vitest and real Chromium/installed Chrome.

**Spec:** `docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md`, published at `cc5a284539b723c455ebd717bf4ae4cc1500ba2d`, approved by the owner at approximately 14:50 on 2026-10-16.

## Authority, baseline and replacement scope

- This plan belongs at `docs/superpowers/plans/2026-10-16-a679-hour-code-implementation.md`.
- It replaces active Tasks 9–12 of `2026-10-15-a679-one-pdf-implementation.md` and revises assumptions inherited from its completed Tasks 1–8.
- Product source baseline: clean signed `92a76fb6891e4eb7fb83d5db2f942f67d1656294`.
- The author performed read-only source inspection. No tests, builds, servers, browser journeys or product qualification ran.
- Main advanced during inspection; the approved design remains identified by its literal commit above. Reconcile current main before implementation.
- Authority: the approved spec records the owner’s 2026-10-16 decisions at 12:20, 13:00 and 13:40; its dated approval records acceptance at 14:50.
- Follow repository `CLAUDE.md`, its developer topics and the lane’s local runner for execution and landing.
- Canonical historical ledger: `.superpowers/sdd/2026-10-15-a679-one-pdf-implementation/progress.md`.
- Its Task 8 closure records completed local qualification through signed implementation `ff56b8ae8`; these are historical receipts, not tests of hour naming.
- Preserve codec, ownership, exclusion, empty-proof, original-retention, workspace and publication assertions unless a specific authorised change requires otherwise.
- Retire active assumptions about S/P/C/E namespaces, register consultation, Cloud allocation continuity, register-bearing PDFs and physical owner typing.
- Keep one eventual product PR, **#1752**, on the existing long-lived feature branch. Intermediate product commits stay local until every entry path agrees.
- Cloud repository changes belong to Lane D. Do not edit another lane’s files, branch, queue or processes.

## Global constraints

- Epoch: **2026-01-01T00:00:00Z**. Encode elapsed whole UTC hours most-significant first in exactly four symbols.
- Alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; preserve leading zeroes and generate uppercase.
- `2026-10-16T11:40:00Z` → hour `6923` → `06RB`; next hour → `06RC`.
- `0000` is representable; refuse before the epoch and at `2145-08-15T16:00:00Z`. Last hour is `ZZZZ`.
- The four-symbol value is also `NumeroInstalacion`. Node UUIDs and unpredictable attempt/event IDs remain separate.
- Base length stays **≤21**, using existing `[A-Za-z0-9/_.-]` validation. Counter stays **1..9,999,999,999**.
- Maximum combined number is **37 characters**: 21-character base, hyphen, four symbols, slash and ten digits.
- Preserve complete configured `{code,purpose}` sets, exact base spelling, multiple bases per purpose and **`FF/full`**.
- No wrap, truncation, longer-code alternative, synthetic conversion, migration or backwards-compatibility implementation.
- Production and preproduction have separate databases, identities, readiness and history floors.
- Real development/preproduction Live uses hour policy. Demo, Preparation and isolated readiness use automatic disposable preparation without taxpayer-coordination or PDF ceremony.
- Clock disagreement threshold is **strictly above 120 seconds**, including uncertainty; the existing filing-clock warning remains separate.
- Authenticated internet comparison has a **five-second total deadline**. TLS failures mean unavailable; never disable certificate checks.
- Compare every usable observation. Even smaller disagreement must wait when accepted uncertainty crosses a UTC-hour boundary.
- Manual confirmation is fresh, bound to displayed readings and invalidated by clock correction. It overrides no release, history or range limit.
- Persist selected-hour intent before exposing usable activation material, under existing shared exclusion and venue locks.
- Every known spent hour excludes that whole hour across bases, purposes, software identifiers, nodes, attempts and retired workspaces for the same taxpayer and target environment. Software ID remains evidence metadata, never a filter that hides known invoice names.
- Choose the eligible **current** hour strictly later than known history; never invent present time with `maximum + 1`.
- Before persistence, crossing the boundary recalculates preview. After persistence, the event retains its hour across ordinary boundaries.
- Countdown authority lives on the server and uses monotonic elapsed time. Persist its UTC wait target; refresh reconnects to that same wait. Restart requires fresh comparisons and cannot infer completion from downtime or reuse the old process's monotonic reading.
- **No**, **Yes**, and **I don’t know** describe taxpayer-wide activity, including other venues, interrupted setup and recovery. Yes/unknown wait for the next UTC hour.
- Simultaneous No answers can collide; simultaneous Yes answers can also collide. A countdown is not a shared reservation.
- Correct clocks, surviving history and taxpayer-wide coordination are assumptions, not global uniqueness guarantees.
- Preserve old-seller isolation, sole recovery, matching-key authentication, manager permissions and operation-bound authority.
- Ordinary reboot/update, exact Finish, download/print and key reissue allocate **zero** identities.
- Restore preserves historical records and recovered counter values, retires recovered active series and selects a fresh hour before renewed issuance.
- Standby admission reserves no hour. Promotion selects one when activation occurs.
- Secrets remain **192 bits**, **47 entered / 57 displayed characters**. Normalise only display entry, never the actual secret or issued names.
- Raw keys and secret PDFs stay transient, outside logs, browser persistence and venue backups. Promise no guaranteed memory erasure.
- A696’s zone confirmation does not establish that invoice writers use the venue zone. A696 and A731/A732/A733 remain separately scoped.
- H2 protects hashes, chains, invoice-number allocation, `registros_facturacion`, alta builders, `registerSif`, `restoreFiscal` and existing fiscal assertions.
- Existing SQL stays unchanged. The 13:40 exception permits read-only inspection solely for positive empty proof; it is not general SQL permission.
- Never edit guards to force a pass. Every commit uses `git commit -s`; never bypass hooks.

## Review Focus

| Risk | Expected behavior and owning tests |
| --- | --- |
| Box/browser agree while internet differs, TLS fails, or uncertainty spans an hour | All usable observations influence admission; disagreement/unavailability is visible; ambiguous hours wait. Task 2, `hour-clock.test.ts`. |
| Higher hour survives only on another node, retired workspace or older/newer backup | Lower evidence never wins; unrelated scope remains independent. Tasks 3 and 7, `hour-history.test.ts`, `hour-recovery.test.ts`. |
| Boundary, restart, correction or delayed response races durable selection | Preview refreshes, recorded intent stays fixed, stale grants fail, monotonic waits cannot finish early. Tasks 3–5, `hour-selection.test.ts`, `first-fiscal-hour.route.test.ts`. |
| Rendered key differs from attachment or manual entry changes its secret | Real rendered values enter real controls and authenticate the selected backup; malformed attachments refuse. Tasks 6 and 10. |
| Dormant promotion, exact Finish or PDF reissue silently activates again | Promotion alone chooses its hour; Finish/reissue have zero activation and preserve counters/history. Tasks 5, 8 and 9. |

## Source-only interface and consumer map

Paths below are current unless marked **new**. `vf/` means `packages/fiscal-verifactu/src/`; `server/` means `apps/server/src/`.

| Boundary | Current source and required treatment |
| --- | --- |
| Identity/series | `vf/allocation-identity.ts`, `reserved-series.ts`: prefix parser and complete-set checks; active hour validation must preserve base/counter limits. |
| Envelope/admission | `vf/allocation-envelope.ts:278–320`: source-prefix mapping and outside authority; replace active policy without weakening operator/isolation checks. |
| Preparation | `vf/allocation-configuration.ts`, `allocation-preparation.ts`, `allocation-operation.ts`: configured dispatch, callback-scoped tokens, input snapshots and authenticated activation. |
| Initial setup | `vf/initial-setup.ts`, `initial-paper-candidates.ts`; `packages/module/src/initial-setup.ts`: retained assignments, candidates/request/inspect/confirmation/committed seats. |
| Generic host | `packages/module/src/operation-preparation.ts`; `server/module-operation-host.ts`: `configureModuleOperations`, `readPublicEvidence`, `readRetiredSetup`, `withPreparedModuleOperations`. |
| Actual writer | `vf/allocation.ts:307–435`: reads prior result, validates, retires active series and stores supplied identity/series. Keep writer and SQL unchanged. |
| Lifecycle | `vf/allocated-lifecycle.ts`; `restore.ts` re-exports it as `FISCAL_RESTORE` and `restoreFiscal`. Do not replace that protected restore hook. |
| First setup/publication | `server/first-fiscal-evidence.ts`, `first-fiscal-delivery.ts`, `first-setup-node-key.ts`, `first-fiscal-activation.ts`, `first-setup-finish-audit.ts`. |
| Resolution/retirement | Provisioning `first-setup-resolution.ts`, `first-setup-workspace.ts`; server resolution, inspection, unused-assignment and empty-database files. Preserve original-byte and pre-open guarantees. |
| Modes/import | `server/setup-api.ts`, `provision.ts`, `configuration-import.ts`, `configuration-transfer.ts`; provisioning `venue-plan.ts`, `venue-apply.ts`, `cli.ts`. |
| Disposable readiness | `vf/throwaway-allocation.ts` currently signs `S000001`; `server/fiscal-readiness-runner.ts` uses a separate retained database. Replace hidden signer/S naming. |
| Backup evidence | `packages/module/src/module.ts:1200–1220` has `backup.nonDbState`, `restore`, `assertRestoreCommitted`, `recoveryPack`; `server/backup-sources.ts` carries declared content-addressed directories. |
| Backup preview | `server/recovery-backup-preview.ts`: taxpayer/environment/node/key name, currently no country/territory. Extend selection and module-owned evidence before fiscal actions. |
| Recovery sources | `server/restore.ts`, `restore-stream.ts`, `restore-request.ts`, `cloud-recovery.ts`, `recovery-module-operation.ts`, `restore-command.ts`. |
| Re-register | `server/provision-till.ts`, `apps/server/scripts/register-till.ts`: `provisionNode` → recovery authority → module seed. |
| Standby/promotion | `vf/allocated-standby.ts`, `standby-allocation.ts`; server `mirror-bundle.ts`, `reserved-identity.ts`, `adopt.ts`, `promote.ts`, `promotion-operation.ts`. |
| Promotion constraint | `vf/allocation-operation.ts:216–253` requires `reservationEventId`; protected `allocation.ts:216–304` requires retained paper reservation. Task 8 owns the exact boundary experiment. |
| Browser integration | `vf/setup/first-fiscal-screen.ts`, `setup/strings.ts`; setup app/session/API, venue/review/resolution and archive/bucket/Cloud restore screens. |
| PDF/key | `vf/paper-register-compact.ts`, `register-document.ts`, `register-pdf.ts`, `register-reader.ts`; current renderer supports **A4**. Preserve node-key codec behavior. |
| Current pack access | `server/recovery-pack.ts`, `recovery-pack-api.ts`: matching supplied key and manager `system.manage`; no existing `recovery-document-api.ts`. |
| Entry paths | `server/bin.ts`, `node-entry.ts`, `first-setup-entry.ts`, `boot.ts`, recovery listener/surface, restore CLI and provisioning CLI. |
| Composition/browser exports | `packages/composition/src/modules.ts`, dashboard module composition and explicit fiscal package subpaths. Generic code never imports fiscal internals. |
| New focused units | `vf/hour-identity.ts`, `hour-clock.ts`, `hour-history.ts`, `hour-selection.ts`, `hour-preparation.ts`, `hour-release.ts`; key-only PDF/reader units; `server/module-preparation-state.ts`, recovery-document service/API. |

Current `InitialSetupContribution.candidates(context, proposal): unknown` can be awaited by its host; retain the public browser action’s existing Promise contract. Keep `request`, `inspect`, `confirmation`, `documentConfirmation` and `committed` as the module’s opaque validation boundaries.

**New proposed generic host capability**, only because current public-evidence readers do not persist an operation’s hour intent:

```ts
withPreparationState<T>(
  binding: OperationBinding,
  run: (state: {
    readonly value: unknown;
    replace(value: unknown): Promise<void>;
  }) => Promise<T>,
): Promise<T>;
```

The host owns paths, exclusion, lock reuse and durable writes; the module owns the bounded value schema. Re-enter an existing hold rather than taking the same coordinator twice. Configure this capability for first setup, recovery, CLI and promotion; missing capability refuses fresh admission.

## Execution and verification discipline

- Every feature task: add behavioral assertions → run and observe intended RED → minimal implementation → repeat the exact command for counted GREEN → signed commit.
- Missing exports may be the first RED; obtain the behavioral RED before claiming a policy defect reproduced.
- Commands below run from the product worktree. The existing deadline wrapper bounds the process group; exit 124 is a failed check.
- Use `useVenueDb` with actual migration sets and append-only triggers; preserve behavioral assertions and report every changed check.
- Browser suites run in real Chromium. Check memory and other runs first; do not overlap coverage directories.
- Retain command, exit status, test counts and intended failure. A blank run or skipped case supplies no qualification.
- Stop only recorded owned PIDs. Keep receipts outside committed product source.

### Task 0: Publish this replacement and reconcile shared work

**Files:** this plan, superseded-plan pointers, affected historical design pointers, `docs/backlog.md`, `docs/backlog/fiscal.md`.

- [ ] Re-read current lane queue/questions/STOP, approved spec and Task 8 closure. Preserve original start time and completed receipts.
- [ ] Inspect committed and dirty diffs of `refactor/a182-2-retire-canvases` and `feat/a737-post-invoice-refund`, and other active lanes, without modifying their trees.
- [ ] Source-only orientation found A182 changing configuration-transfer format and A737 touching boot/errors/translations/docs, with additional dirty till work. Reinspect rather than treating these observations as current.
- [ ] Compare overlapping hunks, retain both lanes’ work and follow RUNNER’s collision rule. Coordinate a concrete overlap before editing it.
- [ ] Save/fresh-context-check this plan against the approved design in the existing separate docs tree from current main; fix plan findings before any product build.
- [ ] Publish docs-only with a signed commit, normal hook and H11 around the entire main update/install/cleanup. Preserve the long-lived product tree.
- [ ] Mark A679 hour implementation still open in backlog; add dated supersession pointers without rewriting historical requirements or receipts.
- [ ] Resume the existing product branch, reconcile published documents and current main according to overlap rules. Create no second active product feature.

**Task 0 checkpoint, 2026-10-16:** plan published at `275d1d6b702909c101aa99b3f78f51930ac6f834`, after separate high-effort authorship and an independent requirements check. The check corrected history filtering across software IDs and countdown restart semantics. CI `38908709040` and licence/sign-off `38908708463` passed on that exact commit. The product branch rebased from `92a76fb6891e4eb7fb83d5db2f942f67d1656294` to `4094497d8402376f68e9986cc82c6eaa066da930`; conflict resolutions retained the approved A679 backlog paragraph. Of 214 feature code paths, 211 retained identical Git blobs; the other three incorporated main's workflow, boot-test and module-export changes. This is a source comparison, not behavioral qualification.

Focused rebase checks passed: 20 module cases, 20 unchanged protected fiscal cases and 186 CI-workflow cases. `src/boot.test.ts` returned 58 passed and four failed both at the old commit in an independently installed disposable worktree and at the rebased commit. The named failures and messages matched: two static configuration refusals were masked by `setup.attempt_uncertain`, and Demo/Live provision requests returned 400 instead of 200. These failures predate this rebase; their introduction into the feature branch was not measured. Tasks 4, 9 and 10 below own their remaining qualification. No hour implementation, product review, product CI or finish readiness is claimed.

### Task 1: Hour identity and unchanged-writer feasibility

**Files:** new `vf/hour-identity.ts` and tests; `allocation-identity.ts`, `allocation-envelope.ts`, `allocation-operation.ts`, `reserved-series.ts` only within permitted validation/admission scope.

**New module interface:** `encodeHourIdentity(instantMs: number): string`; `decodeHourIdentity(identity: string): number`. The decoder returns the elapsed whole-hour index from the epoch and accepts canonical four-symbol identities; human display normalisation stays separate.

- [ ] RED: epoch→`0000`, worked example→`06RB`, next hour→`06RC`, final hour→`ZZZZ`; reject before epoch/exhaustion, fractions where whole hours are required, malformed symbols and noncanonical internal spelling.
- [ ] RED: preserve exact complete set including two standard bases and `FF/full`; reject missing, extra, duplicate or changed purpose/base. Assert the 21-character/ten-digit example totals 37.
- [ ] Run: `node scripts/run-with-deadline.mjs 240 -- pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-identity.test.ts`.
- [ ] Add authenticated hour admission to the envelope/preparation boundary. Preserve actual operation authority, old-machine isolation and exact replay; JSON cannot recreate callback authority.
- [ ] Add `src/hour-activation.test.ts` using the real writer and full configured bases. Exercise initial activation, recovery and exact replay while `allocation.ts` remains byte-identical.
- [ ] Run that file with the same 240-second command structure; assert stored four-symbol `NumeroInstalacion`, exact series and one activation event.
- [ ] Keep old protocol parsing isolated for historical tests/original-byte inspection; it must not remain reachable as active naming authority.
- [ ] If a protected edit is required, retain the failing command and exact refusal, propose only the specific edit and obtain its exact permission before changing it. Independent tasks continue.
- [ ] Repeat focused commands to GREEN; commit `git commit -s -m "feat: validate hour identities at fiscal admission"`.

### Task 2: Immutable release floor and honest clock comparison

**Files:** new `vf/hour-clock.ts`, `hour-release.ts`, sibling tests; new `scripts/generate-hour-release.mjs`; `scripts/bundle-node.mjs` and server build wiring; module-selected transport/configuration wiring.

**New module interface:** `compareHourClocks(observations, releaseInstantMs): HourClockDecision`. `HourClockDecision` explicitly reports usable/unavailable sources, uncertainty, disagreement, confirmation requirement and boundary wait.

- [ ] RED: box/browser agreement cannot hide a third usable reading differing by 121 seconds; 120 seconds alone does not trigger the “above threshold” rule.
- [ ] RED: request uncertainty changes the result; equal readings with an interval crossing the hour still wait.
- [ ] RED: offline, timeout, malformed/stale/cached responses, invalid certificate and not-yet-valid/expired TLS all report unavailable; no insecure retry or use of the box’s own `Date`.
- [ ] RED: no usable comparison requires the explicit displayed-time confirmation; altered readings or wall/monotonic correction invalidate it.
- [ ] Run: `node scripts/run-with-deadline.mjs 240 -- pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts`.
- [ ] Implement a five-second total request budget, including redirects/body handling. Reject redirects outside the selected authenticated origin and bound response size/freshness.
- [ ] Select the origin through the fiscal module’s known AEAT configuration or an already configured Waitron origin; browser input supplies samples, never a URL.
- [ ] Record wall instant, monotonic request interval, source/result and uncertainty; display full dates/zones for disagreement.
- [ ] Generate release-floor metadata from the pinned packaged source commit: resolve its full SHA and committer UTC timestamp with Git, validate both, and embed that literal plus generator provenance into every Node artifact that can admit a fresh identity. Build wiring invokes the generator; a missing stamp refuses admission rather than using the runtime clock.
- [ ] Generator command: `node scripts/generate-hour-release.mjs --source "$(git rev-parse HEAD)"`; retain the resolved SHA and emitted timestamp. Never read a runtime environment override, install time, mtime or `Date.now()` as the floor. Generated build metadata must not create a self-referential tracked commit hash.
- [ ] Add a generator/build test using two pinned source commits: each packaged revision receives its own source timestamp, and a stale prior stamp cannot survive a rebuild. Inspect all admitting server/restore/re-register/promotion CLI entry artifacts, not just one bundle.
- [ ] Add `src/hour-release.test.ts`: changing runtime clock, `WAITRON_BUILD_ID`, environment and file times cannot lower the imported floor.
- [ ] Inspect the final built artifact in Task 10 to establish that the literal/provenance travelled into the binary.
- [ ] Repeat both focused files to GREEN; commit `git commit -s -m "feat: compare setup clocks against an immutable release floor"`.

### Task 3: Complete known-history floor and durable selection

**Files:** new `vf/hour-history.ts`, `hour-selection.ts`, tests; new `server/module-preparation-state.ts` and tests; module host/contract, initial-setup assignment projections.

**New module interface:** `projectHourHistory(evidence): HourHistory`; projection contains scope, greatest spent hour, recorded time floor, evidence references and contradictions.

- [ ] RED: a higher hour on another base/node, retired series, abandoned attempt, predecessor workspace or supplied backup blocks the current/lower hour.
- [ ] RED: a higher known hour under another software ID for this taxpayer and environment still blocks reuse; keep software ID for attribution without excluding that evidence.
- [ ] RED: another taxpayer/environment does not block; incomplete/corrupt required evidence refuses rather than becoming an empty history.
- [ ] Run: `node scripts/run-with-deadline.mjs 240 -- pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-history.test.ts src/hour-selection.test.ts`.
- [ ] First run a bounded real-store inventory experiment with a higher retired hour on another node and a lower current-node hour. Compare existing reader results with the fixture’s known records.
- [ ] Existing candidate-collision checks are not a greatest-hour reader. If existing interfaces cannot expose the complete set, gate only the missing read.
- [ ] **Exact SQL permission gate:** before adding queries, request read-only enumeration of `invoice_series`, `registro_sif`, `fiscal_allocations` and `fiscal_reservations`, naming exact selected fields/predicates and the failed completeness assertion. The 13:40 empty-proof permission does not cover these reads.
- [ ] Add no such SQL before approval; do not modify existing statements or schema. Codec, clock, PDF and UI work can proceed independently.
- [ ] Implement append-only/public hour evidence through the opaque host store, retaining every spent intent and retirement reference at the stable anchor.
- [ ] Under existing exclusion and venue locks, reread ownership, scope, observations and all available evidence before recording intent; persist/sync before returning usable material.
- [ ] RED: concurrent requests, failure before/after durable writes, lost replies and restored old workspace cannot release or duplicate an hour.
- [ ] RED: precursor preview crosses boundary→recalculate; recorded intent crosses boundary→same identity; uncertain/abandoned replacement→strictly later current hour.
- [ ] Persist the UTC wait target with its attempt and scope before acknowledging Yes/unknown; reconnecting refreshes return the same target and wait identity.
- [ ] RED: forward wall-clock jumps cannot finish an in-process wait early. Restart retains the original UTC target, obtains fresh server comparisons and starts a new monotonic interval; neither downtime nor the old monotonic value establishes completion.
- [ ] RED: restart with an unresolved or changed comparison retains the wait and refuses selection until comparison/confirmation and target checks succeed. A verified target already passed needs no invented additional hour; every history/release/boundary check still applies.
- [ ] Run host checks: `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/server exec vitest run src/module-preparation-state.test.ts src/first-fiscal-hour.route.test.ts --maxWorkers=2`.
- [ ] Repeat to GREEN after any exact gate clears; commit `git commit -s -m "feat: retain spent hours before exposing activation input"`.

### Task 4: All setup modes, import and readiness

**Files:** `vf/initial-setup.ts`, `allocation-configuration.ts`, `throwaway-allocation.ts`; module initial-setup/setup contracts; server host/setup/provision/readiness and setup session/API.

**Interfaces:** retain initial-setup seats and `ThrowawayAllocation.prepare`; await candidate preparation, and persist only validated module requests.

- [ ] RED through real host: production Live, preproduction Live, development Live, Demo, Preparation and configuration-import Live retain their correct target environments and full bases.
- [ ] RED: imported configuration never transfers activation identity/counters/readiness into production; changed country/module/version/base set invalidates frozen grants.
- [ ] RED: automatic disposable setup uses four-symbol syntax with no signer, S prefix, recovery PDF or taxpayer question; it cannot authorise production.
- [ ] Run: `node scripts/run-with-deadline.mjs 360 -- pnpm --filter @waitron/server exec vitest run src/first-fiscal-hour.route.test.ts src/first-fiscal-mode.test.ts src/configuration-import.test.ts src/fiscal-readiness-first-setup.test.ts src/fiscal-readiness-allocation.test.ts --maxWorkers=2`.
- [ ] Reproduce the retained certificate-free development Live readiness gap with the real contribution, without its earlier readiness isolation.
- [ ] Fix only readiness-target parsing/admission: production keeps certificate requirements; preproduction’s certificate-free contract reaches its intended disposable readiness result.
- [ ] Keep readiness database, credentials and receipt separate; no network call joins the sale path.
- [ ] Configure hour preparation through every host, including CLI provisioning. No fallback to ambient paper/Cloud/emergency files.
- [ ] Qualify the existing Demo provisioning case in `server/boot.test.ts` through the intended automatic preparation path. Retain its assertions on the response, stored venue, environment and restart; do not weaken them to accept a refusal.
- [ ] Run fiscal disposable tests: `node scripts/run-with-deadline.mjs 240 -- pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/throwaway-allocation.test.ts src/hour-activation.test.ts`.
- [ ] Preserve old fiscal assertions; enumerate incompatible old policy checks for exact permission rather than silently rewriting them.
- [ ] Repeat to GREEN; commit `git commit -s -m "feat: apply hour admission across setup modes and readiness"`.

### Task 5: Retirement, empty restart and publication-only Finish

**Files:** provisioning resolution/workspace contracts; server resolution, unused-assignment, evidence/delivery, finish audit and activation-publication integration; sibling tests.

**Interfaces:** retain `startAgainFirstSetup`, `resolveFirstSetupWorkspace`, `checkedFirstFiscalCommit`, `finishFirstFiscalSetup` and `publishCheckedFirstFiscal`; replace active register answers with explicit local hour/outcome evidence.

- [ ] RED: password-free unused-PDF Start again requires positive never-activated/full empty proof under locks; catalogue, sale, invoice/fiscal, other-module, missing/corrupt/partial/unknown cases refuse.
- [ ] RED: retirement preserves original bytes, burns the whole hour across every base and selects an isolated workspace; old roots never become fallback.
- [ ] RED: marker repair/password rebind records observations without inventing register consultation; invalidate old owner/evidence/delivery grants.
- [ ] RED: exact Finish needs freshly recovered ownership and exact committed module/venue/publication agreement, but no register consultation or fresh hour.
- [ ] Assert zero activation/provision calls and unchanged fiscal records, chains, series and counters after Finish, including interrupted audit/publication retries.
- [ ] Run: `node scripts/run-with-deadline.mjs 420 -- pnpm --filter @waitron/server exec vitest run src/first-setup-unused-pdf.test.ts src/first-setup-workspace.test.ts src/first-setup-finish.route.test.ts src/first-fiscal-declared-publication.test.ts src/first-fiscal-interruption.test.ts --maxWorkers=2`.
- [ ] Keep strict ordinary readers and positive empty proof unchanged. Replace only register-specific active audit carriers; retain historical carrier bytes as originals.
- [ ] Preserve prepared/applied ordering, anchor/target lock order, evidence rereads, permissions and fault behavior.
- [ ] Run provisioning pair: `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/provisioning exec vitest run src/first-setup-resolution.test.ts src/first-setup-workspace.test.ts`.
- [ ] Repeat to GREEN; commit `git commit -s -m "feat: retain hour retirement and finish exact publication without allocation"`.

### Task 6: Key-only PDF and transient delivery

**Files:** new fiscal recovery-document/PDF/reader units and tests; retain node-key codec; server delivery/node-key bindings; explicit browser exports.

**New interfaces:** `renderRecoveryPdf(document, locale): Promise<Uint8Array>`; `readRecoveryPdf(bytes): Promise<{document; attachmentBytes}>`. Use a distinct key-only document tag, not the old register shape.

- [ ] RED: real generated PDF contains legal name/NIF, venue, environment, node ID, key name, creation date, format label and grouped key.
- [ ] Assert no allocation list, register position, signing key, Cloud receipt, administrator/archive password, provider credential or TLS private key.
- [ ] RED: generated 24-byte secret reconstructs byte-for-byte from 39 payload plus eight check symbols; entered/displayed counts remain 47/57.
- [ ] RED: lowercase, groups and supported look-alikes decode correctly; wrong scope/node/name/check/padding/format refuses. Never case-fold the reconstructed secret.
- [ ] RED: one exact canonical attachment round-trips; duplicate, missing, edited, oversized or conflicting attachments refuse. A stripped PDF offers manual key entry.
- [ ] Run: `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/recovery-pdf.browser.test.ts src/recovery-reader.browser.test.ts src/paper-register-compact.browser.test.ts`.
- [ ] Reuse installed PDF libraries/font/notices and current **A4** support. If this task adds another supported size, include it in every PDF acceptance check.
- [ ] Keep the PDF’s instructions: retain this sheet, use matching backup and separate backup password, retain older sheets for older backups.
- [ ] Download and Print reuse identical bytes in one delivery session; only explicit kept confirmation grants delivery authority.
- [ ] Preserve public digest/stage/owner bindings. Retire register-specific digest meaning explicitly; never persist the secret attachment as public delivery chunks.
- [ ] Assert raw key/PDF absence from state, logs, browser storage and backup inputs; disposal releases references and Blob URLs.
- [ ] Repeat to GREEN; commit `git commit -s -m "feat: deliver one key-only recovery PDF"`.

### Task 7: Backup evidence and every recovery source

**Files:** fiscal hour history/recovery-pack contribution; module backup seats; server backup sources/preview, archive/stream/staged/managed-Cloud restore and operation adapters; setup recovery screens/API.

**Interfaces:** retain `backup.nonDbState`, `backup.recoveryPack`, `backup.restore`, `assertRestoreCommitted` and `createRecoveryRestoreRunner`. Carry module evidence opaquely.

- [ ] RED: archive, bucket and managed-Cloud preview derive country/territory/zone and the recorded filing module from validated backup evidence; mismatches/unknown selection grant no fiscal authority.
- [ ] RED: selected backup’s floors can raise but never lower surviving host/retirement floors; bind the exact selected artifact/point and activation source.
- [ ] RED for each source: preserve historical fiscal rows and recovered counters exactly, retire recovered active series, activate fresh-hour series before issuance.
- [ ] Assert matching named key and separate archive password remain required; wrong key, missing data, old seller active or concurrent recovery refuses before destructive work.
- [ ] Run: `node scripts/run-with-deadline.mjs 420 -- pnpm --filter @waitron/server exec vitest run src/hour-recovery.test.ts src/recovery-backup-preview.test.ts src/recovery-backup-preview.older.test.ts src/restore-request.node-key.test.ts src/restore-command.archive.test.ts src/restore-command.archive-target.test.ts --maxWorkers=2`.
- [ ] Export public spent-hour evidence through declared module backup sources; configure corresponding archive and bucket-sealed state capture. Exclude raw keys/PDFs.
- [ ] Reuse existing restore hook and writer; no counter rewrite, historical record modification or `restoreFiscal` edit.
- [ ] Cover staged restart/lost response and `assertRestoreCommitted` exact replay. Reboot of restored completion allocates zero additional identities.
- [ ] Add source-specific HTTP/CLI tests in `hour-recovery.test.ts`; use real adapters with synthetic external responses, not merely a fake module seat.
- [ ] Repeat to GREEN; commit `git commit -s -m "feat: carry hour floors through archive bucket and managed recovery"`.

### Task 8: Re-register and standby promotion without advance reservation

**Files:** fiscal standby/preparation/admission adapters; server provision-till, mirror-bundle, reserved-identity, adopt, promotion-operation and tests.

- [ ] RED: `provisionNode` with matching authenticated recovery operation selects a fresh hour, preserves history and refuses stale/changed binding or missing isolation.
- [ ] RED: standby reserve/establish creates node/membership state with **no hour intent, fiscal reservation, SIF or invoice series**.
- [ ] RED: promotion asks/compares/selects at activation time, uses complete frozen bases and activates once; admission-time clock/hour grants cannot be replayed later.
- [ ] Run: `node scripts/run-with-deadline.mjs 360 -- pnpm --filter @waitron/server exec vitest run src/hour-promotion.test.ts src/provision-till.test.ts src/allocated-standby-host.test.ts src/boot.promotion-operation.test.ts --maxWorkers=2`.
- [ ] Keep generic `StandbyProvisioning` seats and `series: "on-activation"`; replace fiscal reservation-bearing opaque state with dormant configuration/binding evidence.
- [ ] In a disposable installed candidate, first attempt promotion through unchanged activation entry points. Retain the exact `reservation_missing`/mismatch/series refusal and unchanged-row assertions.
- [ ] Do not manufacture an early reservation or disguise hour admission as paper authority to make the experiment pass.
- [ ] **Exact protected-edit gate, only if required:** propose an authenticated hour-standby wrapper adjacent to existing activation wrappers in `allocation.ts`, passing validated dormant bases into the existing private `activate` function.
- [ ] Specify its exact signature, authority checks and diff before permission. The private writer, SQL, numbering, chains and existing dormant assertions remain unchanged.
- [ ] Implement that wrapper only after its exact approval; no broader H2 exception follows. Independent tasks continue while it waits.
- [ ] Repeat promotion/re-register commands to GREEN; commit `git commit -s -m "feat: select fiscal hours only when standby promotion activates"`.

### Task 9: Real wizard, recovery fields and authorised reissue

**Files:** fiscal setup screen/strings; setup app/session/API and venue/review/resolution/recovery screens; new server recovery-document service/API; node-key staging and tests.

- [ ] RED through the real setup app: venue/admin → certificate/email/readiness as applicable → combined country/place/zone/time review → taxpayer-wide question → hour wait/selection → PDF → kept → activation.
- [ ] RED: review shows Madrid/Canary distinctions; editing scope, bases, readings or declaration invalidates affected review/grants/delivery.
- [ ] RED: interrupted page offers **Continue with your setup password** first, **Start again** second; truthful abandoned/uncertain/Finish outcomes remain.
- [ ] RED: saved-PDF and manual grouped/lowercase/look-alike entry use real inner controls, reconstruct the matching backup secret and perform authenticated recovery.
- [ ] RED: stripped PDF requests manual key; it cannot reconstruct allocation history. Wrong backup node/name/check marks the correct field.
- [ ] RED: reprint returns retained identical bytes; after raw-key loss, unfinished reissue requires original password over trusted HTTPS, completed reissue requires authenticated manager `system.manage`.
- [ ] Assert reissue changes only staged/current named verifier, invalidates affected delivery grants and makes zero activation/hour-allocation calls. Old backups still accept only their matching old key.
- [ ] Run: `node scripts/run-with-deadline.mjs 420 -- pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts src/setup-app-first-fiscal.unsaved.test.ts src/screens/first-setup-resolution-screen.test.ts src/screens/recovery-allocation.test.ts src/screens/recovery-allocation.unsaved.test.ts`.
- [ ] Run server document checks: `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/server exec vitest run src/recovery-document-api.test.ts src/first-fiscal-delivery.test.ts src/recovery-pack-api.test.ts --maxWorkers=2`.
- [ ] Use module-owned UI/explicit browser exports; generic setup does not parse hour/PDF fiscal internals.
- [ ] Qualify the existing Live provision case in `server/boot.test.ts` with the actual owned preparation/readiness context. Preserve its certificate, environment and successful-response assertions; add required fixture context rather than changing those expected outcomes.
- [ ] Apply shared required fields, semantic names, hints, caret preservation, draft scopes, field errors and one bottom message. Request refusal alone never disables retry.
- [ ] Keep HTTP public-only; secrets require actual HTTPS/same-origin/authentication. No A731/A732/A733 mutation or password reset is introduced.
- [ ] Repeat to GREEN; commit `git commit -s -m "feat: complete hour setup and key-only recovery journeys"`.

### Task 10: Installed journeys, durability and owner PDF acceptance

**Files:** new server hour/PDF installed e2e suites; existing first-setup entry/launch/fault suites; retained synthetic visual/PDF receipts.

- [ ] RED: installed Chrome downloads the actual wizard PDF; await its download and re-upload that exact saved file through the real picker.
- [ ] Assert exact attachment bytes; an actual annotation/resave changes PDF hash while retaining attachment; actual print/export removes attachment and offers manual entry.
- [ ] Render real PDF pages and enter the **rendered values** through real recovery fields, including lowercase, grouping and look-alikes; authenticate a real selected-backup fixture.
- [ ] Exercise direct `bin.ts`, supervised `runEntry`, already-recovery listener, raw boot, restore CLI and provisioning CLI with normal and interrupted states.
- [ ] Preserve the two existing static-configuration refusal cases in `server/boot.test.ts`: bad SPA configuration and an excessive tick budget must report their existing `server.config_invalid` details before first-setup target inspection touches an unopenable path. Trace the startup order before changing it; retain both assertions and the valid-configuration controls.
- [ ] Run the entire existing boot suite after Tasks 4/9 integration: `node scripts/run-with-deadline.mjs 360 -- pnpm --filter @waitron/server exec vitest run src/boot.test.ts --maxWorkers=2`. Its four recorded failures must be resolved before finish/land.
- [ ] Fault before/after intent, kept grant, commit, verifier, audit, retirement and selection publication; assert original retention, no old-root open/fallback and no duplicate activation.
- [ ] Include simultaneous independent No/Yes setups as explicit limit tests: identical hours are possible; copy must require coordination and make no reservation guarantee.
- [ ] Cover clock rollback/future clock, lost history, stale backup, old box return and clone limits without claiming detection the evidence cannot supply.
- [ ] Run: `node scripts/run-with-deadline.mjs 600 -- pnpm --filter @waitron/server exec vitest run src/first-fiscal-hour.e2e.test.ts src/first-fiscal-document-download.e2e.test.ts src/first-fiscal-launch.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts --maxWorkers=2`.
- [ ] Build once after plan publication/check: `node scripts/run-with-deadline.mjs 600 -- pnpm --filter @waitron/server build`; then `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/setup build`.
- [ ] Inspect the built server’s embedded release timestamp/provenance and exercise its floor under an earlier clock; runtime environment changes cannot lower it.
- [ ] Perform one coordinated whole-task visual pass: **EN/ES × light/dark × 390/1280**, real pages, keyboard/focus, inner controls, axe and computed colours. Recheck changed states after visual fixes.
- [ ] Generate realistic **real-code EN/ES PDFs at every supported size**; current support is A4. Keep automated extraction/entry receipts separate from visual review.
- [ ] Copy PDFs to `~/My Drive/Waitron mockups/<yyyy-mm-dd> A679 recovery PDF/` with `question.txt` explaining labels, matching backups/old keys and “approve, or say what to change”.
- [ ] Obtain and retain the owner’s **LOOK approval before product landing**. No physical owner typing/printing exercise remains.
- [ ] Use synthetic secrets only; allocate fixture ports together, record owned PIDs and guard teardown. Managed dev previews use `wa-wt onboarding <worktree-name>`.
- [ ] Repeat affected commands to GREEN; commit `git commit -s -m "test: qualify hour setup recovery and rendered PDF entry"`.

### Task 11: Remove active allocation protocols and reconcile prose

**Files:** fiscal configuration/exports/custodian command wiring; server Cloud allocation clients/routes/configuration; current operator/developer docs, READMEs, backlog and historical pointers.

- [ ] Inventory every active import/caller before removal: S/P/C/E generators, paper position/history selection, custody/signing tools, Cloud reservation/consume/status/reporting and continuity assumptions.
- [ ] Remove active `cloud-fiscal-allocation-client.ts`/`cloud-fiscal-allocation.ts` wiring, signed-C preparation routes and allocation-specific env/configuration/report dispatch.
- [ ] Remove active paper-custodian command/build/UI entry points and emergency identity choices; retain historical source only where required for unchanged tests/original-byte inspection, with no production dispatch.
- [ ] Preserve shared Cloud accounts, registration, recovery approvals/grants, backup transport and authentication.
- [ ] Give Lane D the removal inventory: Cloud fiscal-allocation reservation/evidence/store/signers; account reserve/consume/abandon/status/list/import-paper and installation allocation reports; portal allocation controller/screen/routes/types; allocation-specific schema ownership/guards/config/docs.
- [ ] Do not edit Cloud files or shipped migrations. Synthetic installations may be reset; no S/P/C/E-to-hour conversion is built.
- [ ] Update `docs/operations/a679-changed-checks.md` with **every** changed fixture/check/assertion, before/after behavior and exact authority. Existing fiscal-assertion changes require exact permission first.
- [ ] Audit entire changed prose paths, including `first-live-fiscal-setup.md`, paper-custodian procedures, restore/backup guides, package READMEs and developer restore claims.
- [ ] Active instructions describe hour policy/key-only PDF and disclosed limits; historical specs/plans receive dated pointers and retain original bytes.
- [ ] Keep A679 open until acceptance/gates complete; preserve separate A696/A731/A732/A733 and W41s-7 scope. Do not replan them.
- [ ] Run unchanged focused guards: `node scripts/run-with-deadline.mjs 300 -- pnpm exec vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
- [ ] Repeat affected runtime tests after removals; commit `git commit -s -m "refactor: retire active register and Cloud allocation protocols"`.

### Task 12: Deletion controls, two installed reviews and authorised landing

**Files:** final candidate, changed-check inventory, current docs/backlog and local receipts.

- [ ] Reinspect all foreign committed/dirty diffs and current main; retain A182/A737 work. Rebase overlapping code, install and run affected checks; do not rebase merely for BEHIND.
- [ ] Create an owned disposable **independent installed candidate** containing the complete committed/staged/unstaged/untracked candidate tree; verify file/tree equality and run `pnpm install --frozen-lockfile`.
- [ ] Serial deletion controls: all-observation comparison, release floor, history maximum, strict-later check, durable-before-exposure, monotonic wait, owner generation, exact commit, kept binding, attachment uniqueness, key verifier, retirement admission and dormant-no-hour rule.
- [ ] Each omission must fail its named behavioral assertion; restore it and run its positive before the next. Preserve logs; no protected writer/old assertion/guard edits for controls.
- [ ] Run protected golden checks **unedited**: `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts`; require the expected 20 cases.
- [ ] Run unchanged fiscal contract suite: `node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/fiscal test`.
- [ ] Compare protected file/assertion bytes against baseline/current main and exact permission records. No unexplained protected delta may proceed.
- [ ] Invoke the actual Codex `finish-branch` skill from the feature tree. Its first installed Claude run-it review follows the initial rebase.
- [ ] Carry the A679 requirement for **two completed final installed Claude run-it reviews**: run the second on the complete candidate after first-review fixes; preserve both briefs/reports/timing/usage.
- [ ] Use `~/workspace/tools/claude-seat.sh review-run <candidate> <brief> <report>`; briefs name captured base SHA, full candidate and this plan, with bounded experiments and source-only claims labelled.
- [ ] Review all five Review Focus risks, every entry consumer, clock/history assumptions, zero-activation paths, protection boundaries, old-seller isolation and retained assertions.
- [ ] Inspect completed findings, reproduce/triage them and fix accepted behavior test-first. A wrapper success or pending prose is not review completion.
- [ ] Announce readiness for `finish-branch` when implementation/validation completes; since already authorised, continue its review/push/CI work without another approval request.
- [ ] Let the normal pre-push hook run its checks once. CI owns package suites/coverage/mutation; do not add a duplicate whole-workspace run.
- [ ] Update existing PR **#1752**, including exact Changed test checks, permission receipts, both reviews, owner PDF approval and remaining limits.
- [ ] Require checks/coverage merge jobs on the **literal current head SHA**; inspect selected package scope. Do not wait for CodeQL.
- [ ] If PDF LOOK or an exact protected/SQL permission remains missing, keep product unlanded and report only that concrete gate; independent authorised work remains complete.
- [ ] Once all gates clear, use actual Codex `land-branch` from main under existing finish/land authorisation.
- [ ] H11: acquire `~/waitron-campaign-shared/main.lock` with atomic `mkdir`; retry every 30 seconds for at most ten minutes. Never proceed unless this invocation acquired it.
- [ ] Hold that lock through the entire merge, main fast-forward, dependency install and owned worktree/local/remote branch cleanup. Release only this invocation’s lock.
- [ ] Verify remote feature branch absence, update backlog in the same landing change and retain separate unfinished follow-ups.
- [ ] H12: record main’s exact merge SHA and its own CI run ID; read its conclusion, or checkpoint the pending run. Missing/cancelled/red is never reported green.
- [ ] Remove only owned candidates/processes after collecting receipts; preserve original historical evidence and report actual final acceptance/CI results.

## Completion evidence

A679 is complete only when the final product tree has counted behavioral passes for every mapped entry path, complete hour-floor qualification, immutable release provenance in the built artifact, unchanged protected golden checks, meaningful deletion controls, two completed installed Claude reviews, owner approval of the generated PDFs and current-head CI. Landing additionally requires H11 cleanup and H12 tracking of the merge’s own run.

Source inspection and historical Tasks 1–8 do not substitute for these results.
