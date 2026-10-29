# A950 Automatic Upgrades Implementation Plan

> **For agentic workers:** After owner approval of this plan and build authority, use superpowers:executing-plans and work inline, task by task. Read superpowers:test-driven-development before writing implementation or tests. Steps use checkbox (`- [ ]`) syntax. Execute eligible cuts inline and preserve every prerequisite gate.

**Goal:** Update a qualified box during its closed window, preserving a complete return path until the candidate restarts, passes database checks and answers fresh local reads, then close rollback before normal work resumes.

**Architecture:** Extend B3's restricted host service. Keep its journal, admission decisions and saved floor evidence outside replaced application state. The server supplies authenticated, durable completion evidence and a dedicated validation startup; the host owns stopped capture, image selection, closure, restoration and one-time release of the checked process.

**Tech Stack:** Repository-pinned Node, ESM JavaScript with strict runtime parsers and JSDoc types for host tools; TypeScript/Hono, SQLite and existing module seats for the server; Lit/shared fields for screens; Vitest and real Chromium for focused tests. Encrypted Linux btrfs, the selected Docker store and pinned Litestream/S3 require separate real qualification. No new workspace package.

**Spec:** [Complete approved A950 design](../specs/2026-10-27-a950-automatic-upgrades-design.md), §§1–9, including the 29 October approval. Read its [screen brief](../../backlog/mockups/a950-automatic-upgrades/README.md), [B3 plan](2026-10-26-b3-usb-installer.md), [A799 plan](2026-10-22-a799-real-upgrade-testing.md) and [A947 design](../specs/2026-10-21-a947-two-box-failover-design.md) before execution. B3, A799 and A947 approval does not supply missing A950 contracts or qualification.

## Global Constraints

- **PLAN AWAITING OWNER APPROVAL.** The owner approved the design on 29 October with “Default the hours to 3-5, so upgrades are on by default.” This permits this plan only. No implementation, test writing, product/VM/container experiment, release, Cloud service change or campaign-state change is authorised by publication. All commands below are future instructions. All A950 runtime gates are **UNVERIFIED / NOT RUN**.
- Every venue starts automatic-on with an editable **03:00–05:00 local** window. No initial Save is required. Both hours may be explicitly cleared to save an unset window; partial/invalid pairs refuse. An unset window blocks manual and automatic application while downloads/sales continue. Missing first settings receive defaults once; restart never overwrites explicit unset or custom hours. Pause retains the hours. A custom saved **01:30–08:00** example stays valid. No inferred opening hours.
- Manual and automatic application share prerequisites. Require actual primary close/report and subsequent archive completion, **10 quiet minutes**, and **strictly more than 17 minutes** before the saved reopening boundary: **2 freeze/drain + 5 migration/readiness + 5 restoration + 5 old-readiness**. Capture, shutdown, journals, closure and release fit inside those phase bounds. Qualify them before activation; defer if they cannot be bounded.
- Release checks get **3 attempts** per daily check, **30 seconds** per metadata/hold attempt and **10 minutes** per image attempt. Verified download precedes freeze. Do not cancel money, printing, reporting or backups to fit. Unknown effects never become successful because a timer expired.
- One active box attempt and one rollback set. One attempt per box in a coordinated occurrence, retained across restart, edits and clock jumps. An edit cannot create another attempt for the same close episode, overlapping period or consumed daily allowance. Quarantine a failed candidate digest after one trial. Same-digest retry requires an explicit administrator action in a later eligible occurrence and the recorded cause. Cleanup failure prevents another attempt.
- Rollback closes automatically after the three bound local checks. No first order, first change, scheduled action, acceptance click or healthy overnight READY wait. Serialize closure and rollback. **ROLLBACK_CLOSED and RESTORED permanently forbid another restoration for that attempt**, even if their replies were lost.
- Ordinary sales perform **no network/provider/host updater roundtrip**. Outages can defer application or publication; they cannot delay successful local closure or gate ordinary sales. Preserve A947 membership authority, including its separate uncertain-restart wait and authenticated Continue without spare choice.
- No change to fiscal writers, `computeHuella`, hash chains, invoice-number allocation, `registros_facturacion`, alta builders, `registerSif`, `restoreFiscal`, golden huella or `inmutabilidad`. No new chain, installation name, automatic promotion, migration bypass, reset or old image over migrated data. Keep the newest start-again floor and unknown/damaged evidence.
- Use B3's **five** areas, `@rootfs`, `@images`, `@volumes`, `@logs`, `@host-state`. App rollback replaces only the captured complete volume set and matching old images/config. Logs, host evidence, retained disk key/UUID and recovery identity survive. No sixth root, blanket prune, shared-state deletion or new reserved disk allocation.
- Use module descriptors/composition, released lock/recovery helpers and existing permissions. A verb-only read-only gate and generic health are insufficient containment/readiness. No new support expiry, A1016 backup default, automatic support upload or external service work.
- Each code cut uses focused red/green checks, signed-off commits (`git commit -s`), the normal hook and current-head CI. Preserve behavioural assertions and coverage `98/98/98/95`. Do not repeat whole-workspace tests to finish a cut. Follow current repository finishing/publication rules only when separately instructed to execute.

## Review Focus

1. A valid completed setup record beside pending restore/reset evidence: reject destructive startup without rejecting legitimate completed venues. Test in Task 6.
2. A day changes while the same closure remains unbroken, or somebody edits hours backwards: admit the valid episode once, never reuse an old day or mint another attempt. Test in Tasks 1 and 4.
3. Upload succeeds but pruning/cleanup fails, or an aborted sweep reports late: keep sales and real jobs running, with no freeze authority. Test in Task 3.
4. Power fails after a terminal marker but before its reply or release: preserve current work and never restore the snapshot again. Test in Tasks 2 and 8.
5. The spare disappears or a signed newer membership arrives during trial: distinguish peer loss from lost authority, never promote or restore a stale primary. Test in Tasks 9 and 10.

## Current source map and prerequisite gates

Source inspection at **`2078cc07c4b9414d38f31e122b86a6cc075b1163`**, 29 October 2026, supplies pointers, **not runtime verification**. Refresh paths and consumers at each cut. Preserve the design's historical tables rather than replacing their SHAs with this one.

| Existing source read | Integration consequence |
| --- | --- |
| `deploy/waitron.sh`, `cmd_install`, `running_images`, `delete_previous_images`; `deploy/compose.yml` | Install fetches files, starts normal Compose and deletes previous app/agent images after generic health. A950 must not call this path unchanged. Compose includes app, mailpit and print-agent persistent writers, host networking and automatic restart. Inventory actual deployed mounts and sidecars again. |
| `apps/server/src/node-entry.ts`, `runEntry` and its first-setup/restore/reset calls; `boot.ts`, `bootServer` | Put host admission ahead of **all** entry effects. Boot has migrations, membership reconciliation, duties and read-only HTTP gates at different points. Existing mirror gates do not contain validation startup. |
| `packages/provisioning/src/schema-ahead.ts`; `packages/migrations/src/apply.ts`; composition descriptors | Keep ahead checks, run packaged enabled sets/dependencies, compare completeness and retained disabled-module data. Never enable modules to make a test pass. |
| `packages/reporting/src/record-daily-close.ts:32`; `apps/server/src/report-api.ts:268`, `:309` | `recordDailyClose(tx, input)` is the frozen append; report routes compute live figures. `rg -n 'recordDailyClose\(\|computeDailyClose\(' packages apps --glob '*.ts' --glob '!*.test.ts'` finds the frozen writer called by `apps/server/scripts/daily-close-z-demo.ts`, not a production close workflow. This scoped search is not proof of runtime absence outside these paths. **P-CLOSE below remains a prerequisite.** |
| `apps/server/src/backup-sweep.ts:171`, `:268`, `:287`, `:316`; `backup-supervisor.ts:276`, `:281`; `backup-schedule.ts:60` | `runOnce` resolves destination calls separately; upload notification precedes pruning and final cleanup. Supervisor guards replaced callbacks but has no A950 day-bound authority. Observe actual cycle deadlines; do not move them when settings clocks change. |
| `packages/provisioning/src/first-setup-start-again-note.ts:52`, `:58`; callers in `box-folders.ts`, `first-setup-start-again-set-aside.ts`, `apps/server/src/first-setup-resolution.ts` | Current `StartAgainNote` permits `lastName:null`; malformed/damaged reads refuse. `raiseStartAgainNote` preserves an equal or greater floor, so equal-floor conflicting evidence needs refusal **before** that call. Trace all current readers/writers, including reset, before overlay integration. |
| `apps/server/src/till-api.ts:1501`, `:1573`; `orders-api.ts:266`; `till-setup.ts` | Proposed validation probes use `/api/till`, `/api/service-zones/:zoneId/offers`, `/management-api/orders/:id`. These normal routes include authentication, transactions and possible bookkeeping. Task 7 must add narrowly scoped passive handling through the same read services, not blindly whitelist GET. |
| `packages/identity/src/manager-login.ts:56`, `:130`; `passkey.ts:223`, `:239` | Existing login creates a session; passkey challenge/finish writes rows/counters. They cannot be called unchanged while validation forbids venue writes. **P-AUTH** defines the required binding. |
| `apps/server/src/stream-host.ts`; `packages/stream/src/supervisor.ts`, `pointer.ts`, `conditional.ts`; `membership-reconcile.ts` | Stream stop/reload, generation claim and pointer writes are not an A950 freeze/handoff interface. `readPointer` shape-checks without signature verification. Task 9 must qualify signed authority, complete-copy and conditional publication. |
| `bench/real-upgrade/index.json`, `README.md`; `scripts/a799/` | Index has `epoch:null`, no fixtures and no oldest source. Cuts 1–3 supply pure admission/comparison/fetch helpers; no historical qualification follows. Require actual A799 inputs/results at Task 12. |
| [B3 plan file map](2026-10-26-b3-usb-installer.md#file-map-and-execution-gates) | Its `scripts/box/host.mjs`, `host-protocol.mjs`, `release-list.mjs`, `release-assets.mjs`, server bridge, `this-box-screen.ts` and `bench/box-installer/` are **proposed dependency paths**, absent at this inspection. They are not existing runnable tools. |

**Execution stops at these gates, without fabricated fallback evidence:**

- **P-BUILD:** owner approval of this complete plan plus explicit build authority. One fresh plan review precedes presentation. Until then edit documentation only.
- **P-B3:** released B3 restricted socket/authentication, checked five-area layout, release-list verifier, exact platform/image inventory and disk-key/UUID protection. Both retained old and candidate images must implement the qualified A950 startup, passive-check and release protocol. A legacy source without that protocol is ineligible; do not patch the retained image or bootstrap with the old unsafe install path. Installing an updater-capable baseline is a separately authorised prerequisite, not an automatic trial of an unsupported source. Pure Tasks 1–3 can precede it; no host effect wiring before the relevant contracts exist. No B3 slice 7 daily poller is supplied by its six-slice plan. A950 Tasks 1/12 own that separately authorised integration.
- **P-CLOSE:** a separately approved production closing workflow must declare its required outputs, authenticate the actual closure of D, and return committed output identities and terminal job results. It must supply the `CloseProducer` interface below from real production calls. Where a frozen close is required, its receipt must reference a real `recordDailyClose` result, with legitimate required cash-count input, never a demo or synthetic row. The declaration must cover any required print/delivery completion and input generation. Do not build a daily report scheduler. Task 3 may land an unavailable-provider adapter; Tasks 4/8 must defer with `close-producer-unavailable` until the real producer and its integration tests exist. Plan approval is not approval to invent a broader daily-close product flow.
- **P-HOLD:** A1049 needs an accepted, authenticated **account-free** Cloud hold-check contract bound to release identity, freshness and expiry. Cloud service implementation, endpoint selection, signing custody or account creation require their own authority. Until supplied, `HoldCheck` returns `unknown`, discovery does not offer/apply that release, and both manual/automatic paths defer `hold-unknown`. No anonymous-success fallback.
- **P-AUTH:** bind the released B3 fresh-proof and A947 memory-challenge contracts, or obtain separate approval for the bounded read-only verifier described in Task 8. No normal session, passkey counter, recovery-code consumption or durable authentication write during validation. Without a qualified binding, fresh-auth return stays unavailable and release qualification is blocked; automatic safety restoration still works.
- **P-PAIR:** A947 must release and qualify waiting startup, store/follower/copy-up stop, signed membership/fencing, measured catch-up and Continue without spare/rejoin contracts. Task 10's pure coordination can land earlier; paired activation cannot. A947 slice 4a's minute names and its plan supply none of these by themselves.
- **P-RELEASE:** real evidence for **every applicable §9 gate**, A799 oldest/previous history, B3 hardware/trust and the exact old/new/platform protocols. Missing, skipped, stale or failed results keep activation off. Non-B3 disks defer `layout-unqualified`; a whole-copy adapter requires its own equally qualified contract, not repartitioning here.

## File responsibilities and independently landable cuts

All host A950 files in this table are **new proposed paths** under `scripts/box/upgrades/`; their sibling `.test.mjs` files are root tests. Server/UI files explicitly labelled existing are modifications; others are proposed. Do not import TypeScript source directly into host Node. Package small server helpers through the existing bundle tooling. No package/app suite starts a container; real rigs live under `bench/`.

| PR cut | New responsibility and paths | Existing or dependency paths | Dependencies; safe shipped behaviour and activation |
| --- | --- | --- | --- |
| 1 | `contracts.mjs`, `window.mjs`, `settings.mjs`, `discovery.mjs` and sibling tests | B3 `release-list.mjs` after P-B3 | P-BUILD only for pure work. Defaults/status can ship; no host freeze or live poll wiring. |
| 2 | `journal.mjs`, `admission.mjs`, sibling tests | B3 host/layout API after P-B3 | 1. Strict journal/permit library; no application caller yet. |
| 3 | Server `upgrade-receipts.ts`, `upgrade-close-source.ts`, sibling tests | Existing `backup-sweep.ts`, `backup-supervisor.ts`, `backup-staging-turn.ts`, `boot.ts`, `errors.ts` | 1; P-CLOSE for actual close binding. Archive evidence only; no updater invocation, no new scheduler. |
| 4 | Server `upgrade-admission.ts`, `upgrade-activity.ts`, sibling tests | Existing `boot.ts`, `run-server.ts`, work admission/module/backup/settings/membership callers traced in task | 1–3. Local fence dormant except tests until 8/12. No sales host call. |
| 5 | `capture.mjs`, `images.mjs`, `floor.mjs`, sibling tests; server `upgrade-floor-entry.ts`, test; bench `automatic-upgrades/resources.mjs`, `run.mjs` | Existing provisioning note/recovery/lock helpers, `scripts/bundle-node.mjs`; B3 rig/layout | 2, 4, P-B3. Owned rig commands only, no unattended application. |
| 6 | Server `upgrade-entry.ts`, `upgrade-mode.ts`, sibling tests; `boot.upgrade-validation.test.ts`; host `launch.mjs`, test | Existing `node-entry.ts`, `boot.ts`, `run-server.ts`, `deploy/compose.yml`; B3 host/protocol bridge | 2, 4, 5. Validation cannot release itself. Managed boot integration ships only with fail-closed journal handling. |
| 7 | Server `upgrade-checks.ts`, `upgrade-validator.ts`, sibling tests; host `readiness.mjs`, test | Existing till/config/history read services, migrations/protection descriptors; A799 comparisons only where qualified | 5, 6. Candidate remains contained. No automatic activation. |
| 8 | `controller.mjs`, `restore.mjs`, sibling tests; server `upgrade-control-api.ts`, test; `upgrade-control-proof.ts`, test | B3 host/bridge/fresh-proof dependency paths; identity binding at P-AUTH; existing recovery helpers | 2–7, P-B3/P-CLOSE/P-AUTH. Full single-box flow in owned rigs. Installed application still held by P-RELEASE. |
| 9 | `publication.mjs`, test; server `upgrade-stream.ts`, test | Existing `stream-host.ts`, stream supervisor/generations/pointer/pruning/rebuild paths | 5–8. Frozen publication and new-generation handoff in rig; no paired activation. |
| 10 | `pair.mjs`, test; server `upgrade-peer.ts`, test | Released A947 paths recorded at P-PAIR, not an invented follower in today's tree | 8, 9, P-PAIR for binding. Unsupported pairs defer; qualified single-box remains an explicit authenticated choice. |
| 11 | Server `upgrade-api.ts`, test, `upgrade-surface.ts`, test, i18n `upgrades.ts`; dashboard `screens/upgrade-settings.ts` and browser/a11y/unsaved tests; `widgets/upgrade-status.ts` and browser/a11y tests; new EN/ES `guide/*/upgrades.md` | Existing server `boot.ts`, dashboard `api/client.ts`, `dashboard-app.ts`, `navigation.ts`, `help-guide.ts`, `i18n/strings.ts`, Box status screens/guides; B3 this-box screen | 1, 3, 8–10. Honest default/paused/wait/unqualified status and authorised controls. No button bypasses activation. |
| 12 | `qualification.mjs`, test; bench `automatic-upgrades/qualification.schema.json`, `release-check.mjs`, `README.md`; proposed workflow `.github/workflows/automatic-upgrades.yml` | B3 release assets/host service, A799 real workflow; existing CI classifiers/tests, deploy script/tests/docs | All cuts and P-RELEASE. Enable only exact qualified releases/platforms. No host/TPM transition bundled with app activation. |

## Shared interfaces

A **journal** is the host's durable record of what happened. A **fence** stops new work while
an admission decision and capture are in progress. A **nonce** identifies one fresh boot.
A **conditional pointer handoff** replaces a published backup reference only if its recorded
version still matches, also called compare-and-swap (CAS). These controls protect an attempt;
they do not make the updater a continuing dependency for ordinary sales.

These are **proposed**, not discovered APIs. Task 1 owns strict parsers in `contracts.mjs`; server
`upgrade-receipts.ts` owns matching TypeScript wire types with cross-reader fixtures. Reject
unknown versions/fields, duplicate IDs, malformed values, oversized bodies and non-finite times.
Use repository branded IDs inside TypeScript. Host records use fixed paths below `/var/lib/waitron-host/updates/` on checked `@host-state`: `settings.json`, `current.json`, `attempts/<host-minted-id>/` and `receipts/<host-minted-id>.json`. They are root-owned, with `0700` directories and `0600` files; settings/receipt writes use the same serialized durable publication as the journal. Browser/RPC callers never supply a path. No record is a venue backup/export input.

Times below are integer UTC milliseconds; a digest
is a SHA-256 value. An opaque handle is a value minted by its verifier, never accepted as proof
merely because caller JSON has the right fields. Unannotated IDs, hashes, labels and generations
below are strings; revisions, sequences, terms and times are nonnegative safe integers. Named
outcome fields are the stated unions, and collections are bounded arrays of the listed shape.

| Contract | Fields and meaning |
| --- | --- |
| `UpdateSettings` | `{version:1, revision:number, automatic:boolean, start:string\|null, end:string\|null, timeZone:string, clockDigest:string, clockReviewRequired:boolean}`. Both HH:MM or both null for an explicitly unset window; defaults `automatic:true,start:'03:00',end:'05:00'`. Revision is monotonic, defaults are initialised once and never overwrite saved custom hours or an explicitly saved null pair. |
| `UpdateSettingsDraft` | `{automatic:boolean,start:string\|null,end:string\|null,reviewedClockDigest:string}`. The server supplies the actual zone and clock digest, checks the review against them and never trusts a client-provided review-required flag. |
| `WindowOccurrence` | `{id:string, startDate:string, zone:string, revision:number, startMs:number, endMs:number}`; ID includes saved generation. `WindowResult` is `{kind:'resolved',occurrence}` or `{kind:'skip',reason:'window-unset'\|'endpoint-gap'\|'endpoint-fold'\|'clock-uncertain'\|'clock-review'}`. |
| `CloseContext` | `{venueId,locationId,primaryNodeId,term,businessDay,startMs,endMs,episodeId,inputGeneration,clockDigest,reportSettingsDigest}`. Bounds are D's actual business-day bounds. `inputGeneration` advances for every relevant write/job/settings/authority change, not just order creation. |
| `CloseReceipt` | `{version:1,id,context:CloseContext,confirmedBy,confirmedAt,inventoryDigest,outputs:[{id,kind,digest,committedAt}],jobs:[{id,kind,outcome:'succeeded',completedAt}],startedAt,completedAt}`. `CloseProducer.read(context:CloseContext):Promise<{kind:'complete',receipt:CloseReceipt}\|{kind:'waiting'\|'unavailable',reason:string}>`. Its explicit declared inventory can contain zero scheduled jobs, but missing declaration is unavailable, never complete. |
| `ArchiveReceipt` | `{version:1,id,context:CloseContext,closeReceiptId,settingsDigest,keyFingerprint,runId,sweepGeneration,artifactId,artifactDigest,captureGeneration,capturedAt,startedAt,completedAt,destinations:[{id,storedAt,prunedAt}],cleanupCompletedAt}`. Every enabled destination appears once; no secret key or person data in logs. Captured data covers the accepted close outputs. |
| `AdmissionEvidence` | `{close:CloseReceipt,archive:ArchiveReceipt,window:WindowOccurrence,windowRevision,observedGeneration,quietSinceMs,scheduledDeadlines:[{jobId,dueMs}],outstandingJobs:[],membershipDigest,hold:HoldAnswer}`. Accepted durable binding adds a host evidence digest and verification time; old evidence is never relabelled. |
| `HoldAnswer` / `HoldCheck` | Answer `{kind:'clear'\|'held'\|'unknown',releaseDigest,checkedAt,expiresAt,proofDigest:string\|null}`. `HoldCheck.check(releaseDigest:string,signal:AbortSignal):Promise<HoldAnswer>`. Only a P-HOLD-qualified adapter can mint clear/held; absent adapter yields unknown. |
| `AttemptBinding` | `{attemptId,diskUuid,layoutDigest,oldReleaseDigest,candidateReleaseDigest,nodeId,term,membershipDigest,occurrenceId,episodeId,dailyAllowanceKey,windowRevision,admissionGeneration,inventoryDigest}`. Per-boot check binding adds `{bootNonce,activeTreeId,schemaDigest}`. |
| `Journal` | `{version:1,binding:AttemptBinding,sequence,phase,phaseStartedUtcMs,phaseDeadlineUtcMs,startedBootId,bootMonotonicStartMs,elapsedMsAtCheckpoint,captureId:string\|null,checksDigest:string\|null,releaseGeneration:string\|null,restoreSteps:[],floorEvidence,publicationEvidence,outcome}`. Store immutable attempt inputs separately by digest. Phases are the exact §6 names. Terminal facts are append-only host evidence even when the current journal advances. Missing expected evidence is inspection-required. |
| `StartupPermit` | Verifier-only `{binding,bootNonce,activeTreeId,mode:'validation'\|'current',generation,expiresAt,proof}`; one use at entry. A current permit derives from intact old state/no candidate or ROLLBACK_CLOSED/RESTORED, never a caller mode flag. Normal work later uses an in-process admitted generation. |
| `ReadinessEvidence` | `{binding,bootNonce,activeTreeId,schemaDigest,restarted:true,databaseChecksDigest,passiveReadsDigest,role,forbiddenAttempts:0,completedAt}`. Own checks must establish every literal, not trust candidate booleans. `ReleasePermit` binds its digest and a terminal marker to that same boot and generation. |
| `FloorEvidence` | `{kind:'absent'} \| {kind:'known',note:StartAgainNote,bytesDigest,source} \| {kind:'name-unknown',note:StartAgainNote,bytesDigest,source} \| {kind:'damage-unknown',bytesDigest,source}`. Preserve raw non-secret evidence under host state. Damage/conflict refuses automatic entry; absence never overwrites unknown. |
| `PublicationEvidence` | Present source `{kind:'present',nodeId,term,membershipDigest,pointerDigest,etag,generation,head,protectedPrefixes:[],spareHead:string\|null}` or `{kind:'absent',nodeId,term,membershipDigest}`. Missing bucket is absent, not a fabricated ETag. `PublicationResult` is `{kind:'published',generation,head}\|{kind:'pending'\|'reconcile',reason}`. |

Use named refusal reasons with a fixed vocabulary in the contracts. Host results are
`{kind:'ok',value}` or `{kind:'defer'|'inspection-required'|'refused',reason}`. Server routes map
them through registered `upgrade.*` domain errors in existing `apps/server/src/errors.ts`;
unauthorised requests retain existing session/`authorization.not_permitted` codes. Assert codes
and safe reasons in tests. Never turn parse failures into an empty success object.

## Task 1 / PR 1: defaults, dated windows and bounded discovery

**Files:** new host contracts/settings/window/discovery modules and their tests from cut 1.
**Interfaces:** `initialUpdateSettings(timeZone:string,clockDigest:string):UpdateSettings`;
`resolveUpdateWindow(settings:UpdateSettings,startDate:string):WindowResult`;
`saveUpdateSettings(current:UpdateSettings,draft:UpdateSettingsDraft,expectedRevision:number):UpdateSettings`;
`discoverRelease(input:{nowMs:number,installedDigest:string},deps:DiscoveryDeps,signal:AbortSignal):Promise<DiscoveryResult>`.
`DiscoveryDeps` supplies `fetchManifest(signal:AbortSignal):Promise<Uint8Array>`,
`verifyManifest(bytes:Uint8Array):VerifiedRelease`, `hold:HoldCheck`,
`pullImage(digest:string,signal:AbortSignal):Promise<string>`, `now():number` and
`sleep(ms:number,signal:AbortSignal):Promise<void>`. Returned pulled digest must match the requested one.
`DiscoveryResult` is `ready` with verified immutable manifest/platform/image inventory and hold,
or `deferred` with reason/next check. `fetchManifest`/`pullImage` take an AbortSignal and return
bytes/verified digest respectively; `verifyManifest(bytes)` uses B3's released strict verifier.

- [ ] Add failing `window.test.mjs`: fresh `03:00–05:00`, automatic true without Save; save `01:30–08:00`; pause retains it; explicitly clear both hours to null and preserve that pair across restart without reapplying defaults. Resolver returns `window-unset`, and both automatic/manual admission defer while downloads/sales continue. UI maps both cleared inputs to a null pair; reject absent fields, one-sided null, raw blank strings, partial/equal/out-of-range hours and stale revision. Assert exact next dated occurrence/UTC bounds, cross-midnight, missing/repeated endpoint and unique endpoints spanning an internal offset change. Include clock edit/pending cutover requiring fresh review/save. Do not reuse backup's local-time approximation to choose a DST offset.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/window.test.mjs scripts/box/upgrades/settings.test.mjs`; observe named expected failures, implement those pure interfaces, rerun and read passing test counts.
- [ ] Add failing `discovery.test.mjs`: wrong signature/key/platform/protocol/source/digest or a release requiring a new installation identity, held/unknown/stale answer and image failure leave installed service untouched. Pin **3** attempts, **30_000 ms** metadata/hold, **600_000 ms** images, no overlapping attempts or fourth try. A valid signed candidate with qualified clear answer/download succeeds; P-HOLD absence never does.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/discovery.test.mjs`, observe red, implement minimal adapters behind injected boundaries and repeat green. B3 wire types are bound only after P-B3; no invented current endpoint. Sign off the pure-policy cut. No systemd timer or updater is enabled.

## Task 2 / PR 2: durable attempt evidence and startup decisions

**Files:** new `journal.mjs`, `admission.mjs` and sibling tests.
**Interfaces:** `readAttempt(hostRoot:string,diskUuid:string):Promise<AttemptRead>`;
`transitionAttempt(expectedSequence:number,event:AttemptEvent,io:JournalIo):Promise<Journal>`;
`decideStartup(read:AttemptRead,observed:StartupObservation):StartupDecision`.
`AttemptRead` is verified journal or inspection-required; verified idle requires an explicitly
initialised checked host layout with no attempt, not missing files after an attempt.
`AttemptEvent` names prepare/freeze/capture/validate/checks/close/release/rollback/restore-step/
restored/cleanup with the binding and expected sequence. `JournalIo` supplies fixed-root,
no-follow file IO, sync/rename/directory-sync/read-back and exclusive host operation turns.
`StartupObservation` carries actual disk/mount/tree/process/membership identities.
`StartupDecision` is keep-serving-old, validate, resume-restore, start-current or inspect, never
a trading permit before its required checks. No HTTP caller supplies hostRoot or disk paths.

- [ ] Add failing journal tests for unknown version/keys, wrong disk/mount/tree, symlink, truncation, sequence conflict, lost write answer and every atomic publication interruption. A complete valid record round-trips; failed read-back admits nothing. ROLLBACK_CLOSED rejects rollback even before LIVE; RESTORED rejects restoring again even before release reply.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/journal.test.mjs scripts/box/upgrades/admission.test.mjs`, observe red, implement strict publication/transition rules and rerun green.
- [ ] Add a table-driven assertion for **every row of design §6**, including positive absence of closure versus an uncertain closure write. PREPARED never restores over a serving old app; FREEZING without candidate can recheck the intact tree; VALIDATING can rerun lost checks only inside its original budget; candidate crash/timeout records rollback intent. Terminal phases preserve current tree; unknown/missing/conflicting journal or newer term inspects. Repeat the same command red/green, then sign off. Use a suspend-aware steady clock within one boot, persisted UTC deadlines and elapsed
  checkpoints across boots. Never compare raw monotonic readings from different boots or reset a
  phase allowance on reboot. If elapsed time cannot be established, hold admission and inspect;
  positive open-rollback evidence can still choose recorded restoration, never fresh validation.
  Test reboot, suspend, backward/forward clock movement and lost checkpoints. Actual
  flush/power-loss durability remains Task 12's Linux gate.

## Task 3 / PR 3: real completion receipts without a daily scheduler

**Files:** new server receipts/close-source modules/tests; modify existing backup sweep/supervisor,
boot and errors. Read `backup-staging-turn.ts`, settings owners and all callbacks first.
**Interfaces:** `readCloseForUpgrade(context:CloseContext,producer:CloseProducer|null):Promise<CloseResult>`;
`finishArchiveForUpgrade(run:ArchiveRunOutcome):ArchiveReceipt|null`;
`persistUpgradeReceipt(receipt:CloseReceipt|ArchiveReceipt,host:ReceiptStore):Promise<void>`.
`CloseResult` is the producer's complete/waiting/unavailable union.
`ArchiveRunOutcome` adds to the existing run: context/close identity at capture, artifact digest,
effective settings/key fingerprint, sweep/run IDs, capture generation, every destination's
stored/pruned outcome and **final cleanup result**, start/end times and abort/replacement state.
`ReceiptStore.accept(receipt):Promise<void>` is an authenticated fixed host verb; it validates
producer identity and stores evidence on `@host-state`. A failed persistence yields no receipt.

- [ ] Write failing `upgrade-receipts.test.ts`: wrong D/node/term/generation/clock/settings, pre-close capture, missing destination, failed prune/cleanup, aborted/replaced run and startup copy without context yield null or a named waiting reason. `onUploaded` alone and a resolved `runOnce` with failed storage never complete. Valid later capture with all stores/pruning/cleanup settled yields exactly one bound receipt.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/upgrade-receipts.test.ts src/upgrade-close-source.test.ts`; observe expected red, implement parsers and null-producer deferral, repeat green. Absent/unknown report inventory is unavailable, not `jobs:[]` success. Add a positive same-episode-after-rollover case and a prior-day rejection.
- [ ] Add failing cases to existing `backup-sweep.test.ts` and `backup-supervisor.test.ts` for a success observer **after** final cleanup, capture-to-close binding and replaced callbacks. If current suites are split, put these cases in new `backup-sweep.upgrade.test.ts`/`backup-supervisor.upgrade.test.ts` and use those exact paths. Observe red, add an optional `onRunSettled(outcome:ArchiveRunOutcome):Promise<void>` called after cleanup with truthful failures, suppress stale receipts in supervisor, rerun green. Keep existing schedule, startup copy, retention and destination-result assertions.
- [ ] Add actual-producer integration tests only after P-CLOSE: authenticate closure with real outputs, fail a required job, reopen/change an input, then require invalidation. The production workflow must cover frozen-close/cash counts when declared. Until then preserve `close-producer-unavailable` and keep application disabled. Update backup runbook wording that paraphrases completion. Sign off this evidence-only cut.

## Task 4 / PR 4: one local admission turn and complete quiet checks

**Files:** new server admission/activity modules/tests; modify existing `apps/server/src/boot.ts`,
`run-server.ts`, `backup-sweep.ts`, `backup-supervisor.ts`, `business-day-start.ts`,
`business-day-changeover.ts`, `membership-reconcile.ts` and `module-operation-host.ts` in that
directory, plus B3 host/protocol for host/network exclusion. HTTP admission surrounds the mounted
routes, including module routes. Duty leases wrap the actual starts/calls in `boot.ts`, including
`runLoop`, `runPendingCardLoop`, `runTenderRefundRecoveryLoop`, scheduled menu activation and
Cloud workers. Trace their current sources and stop callbacks before editing. Additional
producers discovered by the mandatory inventory must be added to this file map before binding. Store no updater permission on an order or fiscal row.
**Interfaces:** `createUpgradeActivity():UpgradeActivity` with
`enter(kind:ActivityKind):Promise<ActivityLease>`, `changed(cause:ChangeCause):void`,
`freeze(input:AdmissionEvidence,check:()=>Promise<AdmissionEvidence>):Promise<FreezeResult>`.
`ActivityLease.release(outcome:'known'|'unknown'):void` tracks completion in-process.
`ActivityKind` enumerates request, order, bill, reader, reconciliation, refund, print, drawer,
report, archive, restore, reset, setup, membership, host/network and update. `ChangeCause`
enumerates business-input, job-inventory, clock/cutover, report-settings, archive-settings,
window and membership. `FreezeResult` is a held local fence plus evidence/generation, or defer.
`ActivityLease` includes operation ID/kind and a once-only release; `FreezeResult` success is
`{kind:'frozen',handle:FreezeHandle,evidence:AdmissionEvidence,generation:string}`, with
`FreezeHandle.release():Promise<void>` reopening only the intact checked old generation or
handing ownership to the controller. The fence spans final recheck through stopped capture. Never await queries on one DB transaction
in parallel; database decisions use existing write/operation turns. Host status is consulted at
upgrade admission/startup only.

- [ ] Inventory actual request admissions, module duties, reader/refund loops, printing/drawer delivery, backup staging/free-space deletion, scheduled activation, host operations and membership writers. Record the list and their stop/quiet hooks in `docs/developers/automatic-upgrades.md` (new in this cut). Unknown contributors defer. A root inventory guard must fail when a new duty lacks classification; it supplements, not replaces, real containment tests.
- [ ] Add failing `upgrade-admission.test.ts`: at 9:59 quiet reject, at 10:00 accept only with every prerequisite; reject **17:00.000** remaining and accept **17:00.001** with controlled clocks and all other checks. Assert each active/held order, unsettled bill, unknown refund/payment, printing/drawer, destructive/host/membership operation and actual due job defers. Pending unsent fiscal/email may freeze; already-started effects drain to known outcomes or defer, never cancel.
- [ ] Add deterministic racing cases: new request/job/settings/term arrives on either side of final turn; admitted work wins or defers freeze. Clock/pending cutover changes invalidate binding without moving a worker's retained deadline. Same unbroken D after rollover can pass; reopened D, older day, changed outputs and missing producer cannot. Preserve jobs on window expiry.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/upgrade-admission.test.ts src/upgrade-activity.test.ts`, observe red, implement local accounting/fence and integrate each inventoried consumer, repeat green. Add host policy tests to `admission.test.mjs` for restart, edit, cross-midnight overlap and backward clock preserving episode/daily attempt use. Preserve the consumed allowance outside editable settings. Sign off with the fence still dormant on installed boxes.

## Task 5 / PR 5: stopped whole-state capture, exact images and floor overlay

**Files:** cut 5's new modules, helper, tests and owned rig; modify existing bundle tooling to
package the floor helper. P-B3 is required for real layout bindings.
**Interfaces:** `retainImages(release:VerifiedRelease,inventory:ImageInventory):Promise<RetainedImages>`;
`captureStoppedState(input:{binding:AttemptBinding,fence:FreezeHandle},ops:CaptureOps):Promise<Capture>`;
`mergeFloorEvidence(saved:FloorEvidence,observed:FloorEvidence):FloorDecision`;
`applyUpgradeFloor(stateDir:string,evidence:FloorEvidence):Promise<FloorApplyResult>` in the new server helper.
`VerifiedRelease` is B3-verifier output; inventories include platform app/agent/sidecar digests,
Compose/env/profiles and protected container references. `CaptureOps` observes checked mounts,
stops/reaps all inventoried writers, holds maintenance/venue/recovery ownership, snapshots and
checks file/WAL/integrity inventories. `Capture` binds read-only subvolume ID, full inventory,
tree/disk/release identity and clean-exit evidence. A forced exit yields no Capture.
`FloorDecision`/`FloorApplyResult` are unchanged, retained/applied or inspection-required.

- [ ] Add failing root image/capture tests: tag drift, absent offline old image, unknown sidecar/mount/nested subvolume, wrong/missing logs/host mount, surviving writer, forced shutdown, wrong release/tree or incomplete side files reject before candidate launch. A complete stopped set with separately mounted logs/host evidence succeeds. Confirm cleanup excludes protected old references and never removes unowned resources.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/images.test.mjs scripts/box/upgrades/capture.test.mjs scripts/box/upgrades/floor.test.mjs`, observe red; implement fixed-root inventory/ownership and pure merge, repeat green. No database-only fallback for non-B3 layouts.
- [ ] Add failing `upgrade-floor-entry.test.ts`: newer known and `lastName:null` notes survive restoration; absent is never substituted for unknown; equal-floor conflicting provenance and malformed/damaged note refuse. Use released `readStartAgainNote`/`raiseStartAgainNote`; re-read/merge observations under the fence immediately before restoration and apply **before any old entry/setup/recovery/name selection**. Preserve raw damaged evidence and stop if the helper cannot represent it. Reconcile recovery only with `updateRecoveryState` under its lock; never rewrite JSON or unlink locks. Run `pnpm --filter @waitron/server exec vitest run src/upgrade-floor-entry.test.ts` red/green.
- [ ] Build proposed `node bench/automatic-upgrades/run.mjs --case capture --run-dir <new-owned-dir>` on isolated Linux only after authority: encrypted five-area B3 disk, actual selected Docker store/mounts, stopped app/agent/mailpit/stream/follower/host writers, offline launch of exact old digests. Rig rejects existing/nonempty roots and arbitrary host device arguments, records owned image paths/VM PIDs/mounts, cleans only those resources. Test each supported old parser against known/name-unknown/damage evidence; unsupported parser makes that pair ineligible, never lower the floor. Sign off with real evidence status explicit.

## Task 6 / PR 6: validation before entry effects and duty startup

**Files:** cut 6 paths. **Interfaces:**
`requireUpgradeStartup(input:EntryObservation,host:StartupAuthority):Promise<StartupPermit>` in
`upgrade-entry.ts`; `createUpgradeMode(permit:StartupPermit):UpgradeMode` in `upgrade-mode.ts`;
`launchValidation(binding:AttemptBinding,capture:Capture):Promise<ValidationProcess>` in host launch.
`EntryObservation` is actual disk/tree/image/config/node identity, not an environment assertion.
`StartupAuthority` authenticates private host requests and consumes a bound permit. Managed
installs with unknown authority refuse before entry effects; unmanaged normal installations
keep their existing path and cannot opt into A950 with a flag. `UpgradeMode` permits only the
closed inventory of local migration/diagnostic/passive work and later accepts one ReleasePermit.
`ValidationProcess` contains actual PID/container/boot nonce/listener identity and exit monitor.

- [ ] Add failing entry tests: missing/forged/replayed/wrong-boot permits cause **zero** first-setup, recovery/reset/restore, migration, identity creation or normal boot effects. A valid completed venue enters candidate validation via real entry; pending destructive state defers before capture. A raw mode env variable grants nothing. A valid ordinary unmanaged boot remains a positive control. A managed host with verified idle/current state issues the matching current permit and keeps normal service working. A host without this protocol cannot authorise validation; candidate selection rejects that source before any old service is stopped.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/upgrade-entry.test.ts src/upgrade-mode.test.ts src/node-entry.test.ts`; observe red, integrate startup authority at the earliest entry point and implement modes plus the matching authenticated B3 startup-permit verb in the same cut, repeat green without replacing existing assertions.
- [ ] Add failing `boot.upgrade-validation.test.ts` using real database helpers and every enabled/disabled module shape. Assert real packaged migrations run, while fiscal filing/reconciliation, card/refund recovery, printing/drawer, email/webhooks, scheduled changes, Cloud/tunnel renewal/snapshots, archives, stream/pruning and spare following/copy-up do not start or attempt effects. Include free-space/archive deletion, last-seen/session renewal, startup clean-up and any new contribution from Task 4's inventory. Expected local migration/boot deltas are explicitly listed by field/cause; unknown deltas fail.
- [ ] Run that focused file red/green while adding duty-level capability gates and `undoOnFailure` stops. Real rig `--case containment` additionally withholds external capabilities, hardware workers, Docker socket and general host write API. Intercept attempted calls and fail on the attempt, even if network denial prevented it. Host-network Compose needs a qualified isolation profile with only bound local TLS/host-control access; normal networking cannot silently carry over. Sign off; candidate still cannot release itself.

## Task 7 / PR 7: the three local checks, with independent preservation

**Files:** cut 7 modules/tests; modify existing `apps/server/src/till-api.ts`, `till-setup.ts`, `orders-api.ts` and `orders-list.ts` in that directory at their passive read boundaries. Keep normal authentication/bookkeeping behaviour for ordinary callers; only the verified local validator branch selects the non-writing read path.
**Interfaces:** `checkUpgradeDatabase(input:DatabaseCheckInput):Promise<DatabaseCheckEvidence>`;
`issueValidator(binding:AttemptBinding,bootNonce:string):ValidatorCapability`;
`validateLocalRunning(input:{binding,bootNonce,activeTreeId},capability:ValidatorCapability):Promise<PassiveReadEvidence>`;
`checkCandidate(process:ValidationProcess,capture:Capture):Promise<ReadinessEvidence>`.
`DatabaseCheckInput` names each actual DB, packaged enabled/dependency manifests, retained module
inventory and independent pre-upgrade facts plus explicit migration/boot transformation rules.
`ValidatorCapability` is short-lived process memory, bound to attempt/boot/role and the three
fixed passive read purposes. It cannot create normal sessions or authorise business actions.
Evidence includes raw check results/digests, not just counts or `ok:true` from the process.

- [ ] Add failing database checks: incomplete/pending/ahead journal, unknown set/hash, FK enforcement off, integrity/FK failure, same-name changed trigger/index/constraint, lost disabled-module rows, equal-count swapped identity/history, allocation advance and raw stored-byte changes all fail. A declared exact migration transform and enumerated local boot delta pass while original facts remain independent. Compare node/tenant, keys, SIF/name, series/next number, fiscal/workforce facts/heads and all retained history without fiscal writes. A799's generic typed readers/comparators may be reused, its fixture facts cannot substitute for this venue's capture.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/upgrade-checks.test.ts`; observe red, implement non-writing checks through generic module descriptors, repeat green. Unsupported transformations/readers are qualification failure, not refreshed expectations or waived checks.
- [ ] Add failing `upgrade-validator.test.ts` and host `readiness.test.mjs`: actual TLS identity plus fresh `/api/till`, `/api/service-zones/:zoneId/offers` and `/management-api/orders/:id` body checks share candidate/boot/attempt/tree/schema. Capture representative IDs/expected projections before freeze. For a venue with no retained order or no offers, assert the real expected empty collection/configuration with its venue identity and separately read retained history when present; a generic empty placeholder cannot pass. Waiting spare uses retained-copy passive services with waiting-role response, not trading route activation.
- [ ] Reject old listener/boot, cached/redirect/setup/recovery/health-only success, wrong body/role, expired or overbroad capability, other route/verb and any bookkeeping write. Route adapters call the same passive read services while suppressing normal credential/session/device-touch paths; no alternate canned validation data. Run the two focused commands red/green, then real `--case readiness` over the packaged TLS listener. Delete each check in an owned copy and observe its named failure beside the valid positive. No venue test sale. Sign off with runtime limits recorded.

## Task 8 / PR 8: bounded controller, restoration and terminal release

**Files:** cut 8 modules/tests and B3 bridge extensions. **Interfaces:**
`advanceUpgrade(attemptId:string,event:ControllerEvent):Promise<AttemptStatus>`;
`restoreAttempt(journal:Journal,capture:Capture):Promise<RestoredEvidence>`;
`verifyUpgradeControl(input:ControlProofInput,binding:AttemptBinding):Promise<ControlAuthority>`;
`releaseGeneration(permit:ReleasePermit):Promise<void>` on UpgradeMode.
`ControllerEvent` is begin/checks-passed/check-failed/candidate-exited/deadline/explicit-return/
hold-received/recover with exact binding/sequence. Begin also carries `origin:'automatic'|'manual'`: automatic requires the saved switch on; manual requires verified administrator control authority and all the same readiness prerequisites. Pause blocks automatic begin while preserving hours; manual begin still needs a configured window. An explicitly unset pair blocks both origins with `window-unset`. `AttemptStatus` includes phase, availability,
fresh check/terminal/release identities, reason and bounded redacted diagnostics. `ControlAuthority`
binds authenticated admin, attempt, operation, request digest and single-use nonce. No caller
supplies a journal path, image command, person-name proof or unbound boolean.

- [ ] At P-AUTH, record exact released B3/A947 verifier signatures and qualification in the developer integration document before binding. If absent, the bounded separately approved prerequisite is `verifyUpgradeControl`: read-only active-admin/password or passkey verification against the stopped venue, enrolled TOTP checked, host-memory challenge/replay/rate limits, action-only authority, no normal session or persistent auth change. Reuse real cryptographic verifiers; never duplicate them in a host script or consume a recovery code. Existing authenticated authority can be verified before freeze and bound to an in-memory action grant. Missing binding blocks fresh-auth return/release qualification, not automatic failure restoration.
- [ ] Add failing controller/restore cases: begin with valid final fence only; expired freeze/capture within **2 minutes** defers and rechecks intact old service if no candidate ran; candidate checks/closure/release within **5 minutes**; failures restore within the original **5 + 5 minutes** restoration/old-readiness phases. Expiry never implies success or kills unknown money effects. A candidate crash does not trigger candidate restart loops. A received authenticated hold while validation is open chooses rollback; closure needs no new hold roundtrip.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/controller.test.mjs scripts/box/upgrades/restore.test.mjs` red, implement serialized host turns and recorded replacement/overlay substeps, repeat green. Stop all candidate writers, verify capture, restore complete set with old digests/config, overlay floor/recovery, run old local checks, durably write/read-back **RESTORED**, then release matching old generation. Retain failed-tree/evidence until replacement proven.
- [ ] Add closure-versus-return races both ways. Successful checks cause immediate durable **ROLLBACK_CLOSED** and same-boot release without staff. A lost close/release/restore answer queries journal; uncertain marker holds; closed marker repairs current candidate; RESTORED rechecks current old tree without reapplying snapshot. After terminal release, admit sign-in/clock-in/PIN/refund/filing/backups under normal checks with **zero per-operation host calls**. Persistent failed digest quarantines; explicit later retry still obeys allowance/gates. Test that a newer qualified fixed digest is eligible in the next occurrence, while edits cannot reset the failed digest or daily allowance. Cleanup failure blocks further attempt and retains evidence.
- [ ] Add auth/control route tests red/green: anonymous/forged/non-admin/expired/replayed/wrong-attempt proof refuses; real qualified password/passkey plus enrolled TOTP works without DB writes. Closure winning during auth removes return authority. Run `pnpm --filter @waitron/server exec vitest run src/upgrade-control-api.test.ts src/upgrade-control-proof.test.ts`. Repeat full crash table with fault injection in `--case journal-cuts`; uncertain restore/mount/journal stays on host inspection page, never an empty venue. Sign off; installed activation still off.

## Task 9 / PR 9: retain remote authority and publish a fresh generation

**Files:** new publication/stream adapters/tests; modify existing stream host/supervisor,
generation pruning, pointer/rebuild selection only where the exact contract requires.
**Interfaces:** `freezeUpgradePublication(binding:AttemptBinding):Promise<PublicationEvidence>`;
`resumeUpgradePublication(input:{terminal:TerminalEvidence,previous:PublicationEvidence}):Promise<PublicationResult>`.
`TerminalEvidence` is verified ROLLBACK_CLOSED or RESTORED plus matching current-tree checks.
`freeze` stops/drains publisher, follower/store/copy-up/prune owners and records actual signed
pointer/ETag/generation/head/term. `resume` opens a fresh namespace, verifies full copy, and makes
one conditional pointer handoff against that authority. It never changes fiscal identity/term.

- [ ] Add failing root/server tests: candidate trial cannot publish, follow, mutate store, mirror deletions or prune retained prefixes. Restores exclude trial objects and require signed membership/pointer plus complete generation. Same-term fresh prefix switches only after verified full copy; changed ETag/new term returns reconcile without overwrite. Lost CAS reply resolves only by exact authenticated own-write evidence. Rollback retains/restores old authority; use a new prefix after restoration unless exact restored set/version continuity was independently qualified.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/publication.test.mjs` and `pnpm --filter @waitron/server exec vitest run src/upgrade-stream.test.ts` red/green. Keep current pointer APIs' signature and conditional semantics; do not treat `readPointer` shape validation as trust. Retain old objects/spare DB until verified copy and successful handoff, not just a saved pointer string.
- [ ] Execute proposed `--case stream` with actual pinned Litestream **0.5.17** and S3 fixture after binary/runtime authority. Cut before/after full copy and pointer replacement; exercise prune/delete mirroring and failed CAS. Bucket/Cloud/internet outage before freeze can defer update; after local success closure proceeds and local sales work with publication pending and actual old-copy age/version warning. Publication retries use bounded backoff and retain both authority and current work. Sign off with external-service operations still unauthorised.

## Task 10 / PR 10: spare first and membership-preserving coordination

**Files:** new pair/peer modules/tests; released A947 bindings at P-PAIR.
**Interfaces:** `planPair(input:PairObservation):PairDecision`;
`advancePair(sequenceId:string,event:PairEvent):Promise<PairStatus>`.
`PairObservation` includes signed primary/spare identity/term, exact versions/protocol qualification,
measured primary/spare heads, primary receipts, occurrence/budget, active attempts and an optional
verified single-box ControlAuthority. `PairDecision` is defer with reason, spare-first with
sequential budgets, or explicitly-authorised single-box. `PairEvent` is spare-closed/caught-up/
primary-started/primary-terminal/peer-lost/new-membership; each carries signed or locally verified
evidence. `PairStatus` names waiting/trading roles, frozen heads, remaining budget and warnings.

- [ ] At P-PAIR, record current A947 methods and exact stop/rejoin/fencing protocol versions before adapter code. Unsupported old-primary/new-spare or new-primary/new-spare pair defers `pair-unqualified`. Qualify host/journal protocol, stored schema, Litestream/S3/LTX formats, membership/fencing, tail transfer, takeover validation and print-agent protocol. No general compatibility layer or implementation of A947 inside this cut.
- [ ] Add failing pair tests: primary's authenticated day/head/term receipts authorise spare, its disabled archive cannot; require a full **17-minute-plus** reserve for each sequential trial and a separately measured bounded catch-up allowance before paired admission. Primary work during spare trial invalidates primary readiness. Spare remains waiting; its local checks close rollback **before** follow resumes. Failure before closure restores untouched spare; after closure only qualified repair/rejoin, never stale snapshot-as-current.
- [ ] Run `pnpm exec vitest run scripts/box/upgrades/pair.test.mjs` red/green, then `pnpm --filter @waitron/server exec vitest run src/upgrade-peer.test.ts` red/green after real binding. Require measured catch-up to primary head, freeze follow/copy-up at that head during primary trial, and prove upgraded spare can follow restored old primary as well as new primary.
- [ ] Real `--case paired` runs on LAN and the qualified WireGuard fixture after P-PAIR. Primary keeps selling during spare validation without coordinator roundtrips. Missing/incompatible spare defers automation; an admin may explicitly choose the qualified single-box path and see loss-of-spare effect. Losing peer during primary validation alone does not fail local checks: proved authority permits closure; uncertain authority holds. New signed membership/takeover ends the attempt and forbids stale restoration/admission. Preserve A947's uncertain-restart wait and separate manager Continue without spare, including its sign-in/offline declaration. No automatic promotion/new name. Sign off; pair release still waits for exact mixed-version evidence.

## Task 11 / PR 11: settings, honest status and in-place control

**Files:** cut 11 UI/API/surface/i18n/guides plus B3/Box integration. **Interfaces:**
`mountUpgradeApi(app:Hono,deps:UpgradeApiDeps,log:Logger):void`;
`readUpgradeView(status:AttemptStatus,settings:UpdateSettings,evidence:CompletionView):UpgradeView`;
dashboard API `readUpgrades():Promise<UpgradeView>`,
`saveUpgradeSettings(draft:UpdateSettingsDraft,expectedRevision:number):Promise<UpgradeView>`,
`requestUpdate(input:{releaseDigest,occurrenceId,proof,singleBox:boolean,retryFailedDigest:boolean}):Promise<UpgradeView>`.
`UpgradeApiDeps` supplies authenticated B3 host calls, passive session checking, authority verifier
and actual completion status readers. `CompletionView` carries D's dated bounds/closure, declared
jobs, each selected backup rule/deadline/result and wait reason. `UpgradeView` is their redacted
presentation, explicit service availability and only currently permitted actions. Public host
status has no account/credential/person data; control routes are separate and authenticated.

- [ ] Add failing route/screen tests: default automatic-on **03:00–05:00** needs no Save; saved custom times persist; pause does not clear them. Both cleared inputs save an explicit null pair; reload/restart preserves it and both application paths wait while downloads/sales continue. Partial/equal/invalid edits cannot save, errors stay inline with one bottom sentence; unchanged Save is quiet. Clock changes require dated review/save and preserve actual running backup deadlines. No update button bypasses P-RELEASE, manual gates, single-box authority or duplicate-attempt limits.
- [ ] Pin all §8 states/copy from the approved brief: checking only while validation is proven open; completed only with bound checks/closure/release; restored only with containment/no-admission, complete restore, old readiness and RESTORED. Explicit return says it was chosen, not that checks failed. Postclosure failure keeps current state and shows actual availability; unknown journal offers inspection/redacted report/Leave. Spare completion means ready to follow, never ready to sell. Stale Return/auth loses to closure and refreshes honestly. Leave this screen changes no phase, work or unknown payment.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/upgrade-api.test.ts src/upgrade-surface.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run src/screens/upgrade-settings.test.ts src/widgets/upgrade-status.test.ts` red/green. Shared fields, semantic names, `draftScopeFor`, `saveActionState`, passive live reads, preserved drafts and request/action error ownership follow current Forms contract. Add and run the new named `.unsaved.test.ts` and `.a11y.test.ts` siblings in both themes; no new primitive is assumed.
- [ ] Render actual product views in EN/ES, light/dark, **390/1280 px**, keyboard/focus/axe; inspect default, customised timeline, paused, explicitly unset, waiting, skip, disabled/unavailable reports/backups, stale proof and all terminal/uncertain states. Real host-rendered recovery pages also need visual checks, not string assertions alone. Timeline separates rollover, on-demand reports, scheduled due, actual completion and unknown. Offer Backups and qualified close/report workflow plus sign-in on the same screen where needed. Use existing authorised notification channels only after old service returns, queue offline, no new Cloud/support upload. Keep host logs/redacted persistent Box alert and last-attempt details. Update EN/ES guides with shared heading IDs. Sign off without claiming static mockups qualify the product.

## Task 12 / PR 12: real qualification, release gate and final activation

**Files:** cut 12 paths; existing B3 release/host wiring, deployment tooling, CI scope/tests and
operator docs. **Interfaces:** `assertUpgradeQualified(input:UpgradeQualification):void` in
`qualification.mjs`; `activateUpgradeRelease(input:{manifestDigest,qualificationDigest,platform}):Promise<void>`
through B3's restricted release authority, with no arbitrary path/command. `UpgradeQualification`
names source SHA, exact old/new platform digests, host/journal/layout/protocol versions, module
variants, test case IDs, raw evidence hashes, platform/model/runtime versions and passed/failed/
not-run status for **every gate below**. Exact-digest evidence remains outside source commits;
any candidate change invalidates it. Qualification parsers validate evidence, not reality.

- [ ] Add failing eligibility tests: missing/empty/skipped/failed/stale/model/digest/version mismatch, absent P-CLOSE/P-HOLD/P-AUTH, unqualified image/parser/mixed pair or failed B3 trust control refuses activation. Complete exact-bound positive passes. Run `pnpm exec vitest run scripts/box/upgrades/qualification.test.mjs` red/green. No “tests passed” placeholder can fill a real qualification row.
- [ ] Complete this acceptance ledger on run-owned disposable Linux/VM/physical rigs after separate experiment authority. New `node bench/automatic-upgrades/release-check.mjs --manifest <candidate> --qualification <record>` must report each required case and no pending rows. Rig case names here are **proposed, not runnable today**. Measure phase/catch-up bounds; failure keeps activation off, does not silently change the approved budgets.

| Design §9 gate | Required cases and retained distinguishing evidence | Owning tasks |
| --- | --- | --- |
| Scheduling and completion | `schedule`: fresh default/no initial Save, pause, explicit unset preserved across restart and invalid edits; both origins defer on unset with downloads/sales available; manual parity; on-demand close with no scheduler and actual required jobs; unavailable/disabled/missing reporting; all late/failed/unknown outcomes. Real archive after close at every destination through prune/cleanup; old callbacks/startup/reload, wrong day/node/term/revision/generation. Final-turn races, same D after rollover, fixed/weekday/interval/auto due rules and retained old-clock deadlines, pending cutovers, cross-midnight/DST gap/fold/internal shift, clock jumps/reboot/edit duplicate allowance. Full positive, exact-cutoff negative; no cancelled jobs. Both-box evidence from primary, sequential budgets and catch-up. Product timeline alternatives inspected. | 1, 3, 4, 10, 11 |
| Closure and host admission | `closure-races`, `journal-cuts`: close/return/failure both orders; power before/after marker and release; lost check/completion replies; stale boot permits, unknown journal; no preclose effect/no restore after either terminal marker. Idle overnight succeeds without staff; ordinary operations make zero ongoing host calls. Deletion controls plus valid positive. | 2, 6–8 |
| Complete-state durability | `capture`, `restore-cuts`, `floor`: actual encrypted btrfs and pinned Docker store, all mounted writers/nested roots/side files; power loss at every journal and replacement/overlay substep. Compare full state plus retained logs/host markers/key/UUID/recovery identity and newer/unknown/damaged floor. Missing host/log mounts and unsupported old parser must refuse. | 2, 5, 8 |
| Capacity and images | `capacity`, `offline-images`: exhaust data **and metadata** on a small owned filesystem during pull/snapshot/migration/closure/restoration. Old immutable digests launch offline. Supported cleanup cannot remove protected references. Never fill or clean shared disk. | 5, 8 |
| Candidate containment/readiness | `containment`, `readiness`, `screens`: real packaged entry, all module variants, incomplete/ahead/integrity/FK/protection/preservation negatives; same-boot TLS/menu/config/history positive and stale/cache/setup/recovery/health/overbroad credential negatives. Intercept each external/hardware/background seat attempt. Remove each gate, observe named failure and valid control. Actual EN/ES themes/phone/desktop/keyboard/accessibility. No venue test sale/provider operation. | 4, 6–8, 11 |
| A799 release qualification | Consume **real** oldest-supported and previous-retained source results, equal endpoints once; actual pending migrations distinct from restart, independent issued-F1/original-recipient/history/identity preservation, restart and separate continued sale on disposable copies. Reject missing/empty/skipped evidence; retain originals, no auto retirement or changed expectations. Use A799's existing-authority capture/fetch/CI paths; do not regenerate source facts here. | P-RELEASE, 7, 12 |
| Stream and spare | `stream`, `paired`: actual pinned Litestream/S3, old/new formats/protocols, freeze store/follow/copy-up/prune/deletion; same-term conditional fresh-prefix handoff/failed CAS; cuts around full copy/pointer switch, restored old authority. Peer loss/new membership never admits stale primary; spare closes before follow and primary sells during its trial. Outages do not delay local closure/sales; old head/objects retained during bounded publication retries. | 9, 10 |
| Host/TPM and clients | Reference B3's separately authorised actual Linux/VM/TPM/firmware/disk and Android device/build records; startup reseal interruptions, key-present transitions and failed/missing Android trust controls remain holds. Preserve retained key/UUID, recovery identity, locked redirects and fixed-path minimal normal Wi-Fi copy/cleanup outside measured boot bytes. No recovery SSID/hotspot. Unjoinable Wi-Fi offers cable/local recovery. A950 app results do not substitute for these records. | P-B3, 5, 12 |

- [ ] Before workflow edits, read current `ci-and-gates.md`; measure rig jobs and split near four minutes while keeping every case. Add bounded checkout/leftover cleanup/retry, bounded pnpm/apt/Playwright, two-attempt artifact download/upload and timeout-minutes. Test CI classifiers select the rig for all relevant host/server/bench/release paths. Add failing assertions to existing `scripts/changed-scope.test.mjs`, `scripts/changed-packages.test.mjs`, `scripts/ci-workflow.test.mjs` and new `scripts/box/upgrades/release-gate.test.mjs`, then red/green focused commands. Candidate jobs get no new credentials; trusted fetching/evidence publication follows A799/B3 authority. Required gates must pass on the exact candidate, never a skipped reusable job.
- [ ] Only after P-HOLD and B3 verifier binding, wire the daily jittered host check and installed application in B3 host service. Keep persisted automatic-on separate from release eligibility: before qualification show why it waits, never present a disabled release as ready. Recheck qualified release/hold immediately before freeze; a received held answer cancels open validation, no external wait during closure. No synchronous hold fetch in ordinary requests.
- [ ] Route **both manual and automatic** managed-box application through the controller. Add red/green cases to existing `scripts/waitron-sh.test.mjs` so managed `install` cannot bypass the journal/complete-state path, change files early or delete protected images; unmanaged installs explicitly remain ineligible for A950. Update `deploy/README.md`, existing server backup reference/operations guide and new `docs/operations/automatic-upgrades.md` to describe actual commands and repair-current-state limits. No app update invokes kernel/boot/firmware/TPM/Docker-line transitions or rolls back `@rootfs`/`@host-state`; those remain B3's separate host transaction.
- [ ] Freeze final signed source/version, rebuild exact candidate assets, rerun applicable real qualification against those bytes and require the gate before separately authorised publication/activation. Verify normal hook/current-head CI, retained old offline launch, current authority and all acceptance rows. Update only A950 backlog entries with actual remaining gaps. An unrun or failed row leaves build/qualification open and activation off; do not declare A950 complete because libraries or screens landed.

## Coverage and execution gates

The plan maps the approved design to the following tasks. This mapping is not runtime evidence.
§3 maps to Tasks 1/3/4/10, §4 to 2/5, §5 to 6/7/8, §6 to 2/8 and the crash ledger,
§7 to 9/10, §8 to 11, and every §9 row to the qualification ledger in 12. The five Review Focus
conditions have named negative and legitimate positive assertions in their owning tasks. Proposed
interfaces/paths are distinguished from current sources and B3/A947 dependency paths. No gate
permits synthetic close success, a missing initial default or overwritten explicit unset choice, a second attempt by editing settings, a new
daily scheduler, stale-floor rollback or release before real qualification.

**Not run:** product, package tests, Linux/VM/container, TPM/btrfs/power-cut, real bucket, paired
versions, historical upgrade, Android or browser product qualification. Documentation consistency
checks are not any of those results. Execution remains inline after owner plan approval and
build authority, stopping at each explicit unmet prerequisite, with current service and
activation state reported plainly.
