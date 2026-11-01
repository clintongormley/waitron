# A696 Startup Zone Validation Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and implement inline, task by task. Read the TDD skill before writing implementation or tests. Checkboxes describe future work, not results. Do not dispatch implementation or review agents automatically.

**Goal:** Admit trading only after validating the saved writing-location zone, provide restricted manager confirmation when that value is unusable, and date new invoices and ordinary tickets consistently without changing saved fiscal facts.

**Architecture:** Separate runtime zone-name classification, conversion at an instant, country creation policy, and server admission. Resolve the writing location inside each issuing transaction and inject one frozen reading through existing `TrustedClock` inputs before VAT rating. A bad saved zone starts a narrow authentication and confirmation surface; a committed repair requests restart and never opens admission in that process.

**Tech stack:** TypeScript, Node/Intl, Hono, Drizzle/node:sqlite, Lit/shared `wt-*` fields, Vitest with real Chromium for browser packages.

**Spec:** [Approved startup design](../specs/2026-10-20-a696-startup-zone-validation-design.md), including the complete issuance/preservation inventory in the [original audit](../specs/2026-10-15-a696-invoice-time-zone-design.md). The guided mid-payment proposal is historical and is not an implementation contract.

## Authority and constraints

- The owner approved the startup design **including minimal A166 explicit country-zone lists and creation/import validation first**, on 2026-10-21 at approximately 02:25 (`~/waitron-campaign-e/questions.md`, heading “OWNER ANSWER — A696”). Earlier approval-status paragraphs remain historical. This invocation publishes documentation only; build authorization/execution belongs to the later parent step. There is no additional approval ceremony invented by this plan.
- No protected writer, alta builder, hash algorithm, chain, allocation, numbering, `registros_facturacion`, `registerSif`, `restoreFiscal`, golden huella, `inmutabilidad` or existing guard changes. No schema, default or migration change is expected. Prepare clocks in callers. If current source proves an existing input insufficient, report the exact file, call/signature, required protected change and H2 gate; stop that dependency rather than broadening permission.
- Preserve UTC instant storage and every old date, offset, capture, amount, number, reference, hash and recovery fact. No new public F1/F3/void endpoint, post-capture repair screen, payment-resume action, financial adjustment, historical rewrite or reporting recalculation authority. A444 remains separate.
- A valid supported saved named zone, including an alias or a name outside its country's creation list, cannot unlock repair. Valid-to-valid edits retain all history locks. No economic fallback to Madrid, UTC, browser or process zone; cache formatters only, never offsets or live settings.
- Preserve entry/restore/reset/ahead/migration/identity/integrity/key/module/membership/adoption/primary/mirror/fence requirements. A696 and A798 remain independent stops; confirmation grants neither `system.manage` nor a clock-reset policy. A798's webhook exception cannot bypass A696.
- Use `useVenueDb`, sequential queries within one `withTransaction`, focused failing-first tests, and signed-off commits. Keep behavioural assertions when changing tests. No whole-workspace local suite, weakened coverage bar, ignored code, skipped hook or early whole-branch review.
- Before execution, the parent reconciles reserved files with ongoing server/till/boot work, A850's backup-verification interfaces and A798's landed contract. Wait for overlapping owners' work or integrate their landed commits; never edit foreign worktrees or campaign files. `docs/backlog/fiscal.md` is reserved by F. Only the parent may update shared `docs/backlog.md` later.

## Current source map and decisions

Inspected at `73203009984a751d4c816b71b5ac580fdaabb7aa`; these are source observations, **not runtime results**. Recheck after integration; the design's older line numbers are not interfaces.

| Owner and files                                                                                                                                                                     | Current source and planned responsibility                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared: `packages/shared/src/business-day-clock.ts:31`, `:59`; new `time-zone.ts`, exports/errors                                                                                   | Named-zone and offset checks currently live privately inside business-day conversion. Add independent reusable classification/conversion, without changing reporting-clock semantics.                                                                              |
| Country: `packages/country/src/country.ts:112`, country-es/spain, country-gb/united-kingdom; country-packs/registry                                                                 | There is a default/per-area zone but no explicit list. Add only `CountryPack.timeZones` and one country-packs policy helper, with canonical alias comparison.                                                                                                      |
| Provisioning: `venue-plan.ts:193`, `venue-apply.ts:229`, configuration-transfer `:591`, `:623`; server provision/setup                                                              | Planner copies the zone; apply independently consumes actions and converts saved reuse data at `:268`. Import validates metadata but its final location update at `:163` does not assign a zone. Guard each boundary separately.                                   |
| Fiscal adapter: new `packages/fiscal/src/issue-clock.ts`                                                                                                                            | Fiscal already depends on db/shared/Drizzle. Own node/location resolution and prepared `TrustedClock`; no new dependency from shared to fiscal and no changes to protected core/backend bodies.                                                                    |
| Server clock: `venue-details.ts:95`, `:197`, `:242`, `:260`; business-day-start `:86`; new `venue-zone-context.ts`                                                                  | Normal details loads reporting clock/history, and zone save currently does not bump revision. Own raw repair context, retained-clock validation and ordinary zone revision changes.                                                                                |
| Schedule: `packages/venue-service/src/menu-timetable.ts:180`, `:268`                                                                                                                | Internal clash calculation already accepts an acquired clock, but exported `assertPeriodEndOffsets` does not. Add a candidate argument to that existing service seam; do not fabricate a readable old clock.                                                       |
| Boot: `apps/server/src/boot.ts:1402`, `:1506`, `:1591`, `:1605`, `:1707`, `:2471`, `:2573`; node-entry                                                                              | Membership/read-only/fiscal setup precedes attendance duties, but current listener and pending-payment loops are later. Admission must precede the **first** dependent start, not just listener binding.                                                           |
| Auth/shell: management-api `:859`, me-api `:291`, `:308`; dashboard-app `:1151`                                                                                                     | Reuse login/MFA/passkey/Google, cookie and session contracts. Shell currently starts live updates, content-language, alert and theme loaders on authentication. Branch to repair before those ordinary loaders/navigation.                                         |
| Mail/restart: `venue-time-zone.ts:6`, account-email; boot `:1310`, `:2395`                                                                                                          | Authentication email already has an explicit UTC display fallback. Keep that existing mail-only contract out of economic validation. Setup/promote schedule SIGTERM; add a response-finish-aware restart callback for repair, tested through real entry/shutdown.  |
| Issuance: issue-moment `:17`; till-sale `:935`, `:1553`, `:1685`; bill-payments `:685`; working-order `:6683`; cancel-credit `:64`                                                  | Existing explicit clocks suffice for sale/correction/substitution. Void backend `:327`, `:343` chooses the original alta's node and injected clock. A caller must prepare for that node, not assume the current device.                                            |
| Presentation: receipt-issuer `:30`, receipt-document `:215`, `:227`; till `screens/till-ticket-view.ts:740`                                                                         | Offset is recipient-gated, and simplified receipt/F2 browser branches independently omit it. Existing till test “retains F2 date rendering…” pins the old behaviour and must become a meaningful saved-offset assertion.                                           |
| Other callers: provisioning/fiscal-readiness-runner `:55`, `:110`; recover-provisioned-venue; server scripts                                                                        | Readiness now consumes `clock: () => TrustedClock`, unlike the original audit; it calls that factory twice. Reused readiness must validate its own saved database. Four direct location inserts still omit the zone; seed-sales `:239` still reads process offset. |
| Restore entry: `apps/server/src/recovery-fiscal-selection.ts:32`, `recovery-preparation.ts:114`; fiscal-verifactu `setup/recovery-hour.ts:404`, `completed-recovery-document.ts:54` | Invalid zone drops fiscal selection before preparation; UI/PDF formatting also consumes it. This source-only dependency precedes boot repair. Task 6 must qualify the real artifact path, with the H2 boundary below.                                              |

**Integration dependencies:** A798's future boundary/public-state interface is not established here; consume its landed guard. Qualify provider refusal/redelivery with the installed client and signed synthetic events, without claims about preventing provider-side money movement. Candidate schedules need the explicit service argument above. Restore's pre-boot zone dependency needs Task 6's caller-only feasibility check. Missing structure stays fatal; another clock/schedule repair needs its own exact authority, not zone confirmation.

## Interfaces to keep consistent

These are proposed new interfaces; existing signatures mentioned in the tasks stay existing unless explicitly extended here.

- **Shared owns** `classifyTimeZone(value: unknown): SavedTimeZone`, where `SavedTimeZone` is `{ kind: "missing" } | { kind: "invalid" } | { kind: "valid"; timeZone: string }`. Null/undefined/blank are missing; rejected names/numeric offsets are invalid. Catch only name-rejection errors; unexpected runtime faults propagate. `timeZoneOffsetMinutes(timeZone: string, instant: Date): number` rejects nonfinite instants and unreadable offsets separately.
- **Country-packs owns** `requireCountryTimeZone(country: string, value: unknown): string`, returning a runtime-supported canonical name whose canonical equivalent is in `CountryPack.timeZones`. Shared registry codes: `venue.time_zone_invalid` with bounded `reason: missing | invalid | country`; `venue.time_zone_conversion_failed` with `reason: invalid_instant | unreadable_offset`; `venue.time_zone_target_invalid` with `reason: node | location | mismatch`. Never include invalid raw text.
- **Fiscal owns** `IssueScope = { nodeId: string; locationId?: string }`, `readIssueZone(tx: Transaction, scope: IssueScope): Promise<string>` and `prepareIssueClock(tx: Transaction, scope: IssueScope, source: TrustedClock): Promise<TrustedClock>`. The latter copies one source reading/Date, replaces only its offset from the saved zone, and returns fresh copies of that frozen reading. Preserve confidence/anchor delegation. Raw record builders keep explicit-input contracts.
- **Server owns** `TradingAdmission`, constructed unchecked, with `snapshot(): TradingAdmissionView`, `require(): void`, `repairOnly(reason: "missing" | "invalid"): void`, `requireRestart(): void`, `admit(): void`. View is `{ state: "ready" } | { state: "unchecked" | "missing" | "invalid" | "restart_required" }`; only boot calls `admit` after required checks. Refusal is `venue.time_zone_not_ready`, params containing only `reason` equal to the closed state. `requireEconomicWrite(tx, scope, admission): Promise<void>` requires that holder and calls `readIssueZone`; no default-ready/no-op callback.
- **Server owns** `readZoneContext(tx: Transaction, scope: IssueScope): Promise<ZoneContext>`. Its fields are `nodeId`, `locationId`, `legalName`, `country` (strings), `province: string | null`, `savedZone: SavedTimeZone`, `clock: BusinessDayClock`, `clockRevision: number` (absent row = 0). `validateRetainedZoneClock(tx: Transaction, scope: IssueScope, candidateZone: string, at: Date): Promise<BusinessDayClock>` checks conversion, retained clock and schedules. **Module owns** the extended `VenueServiceContribution.assertPeriodEndOffsets` contract in `packages/module/src/module.ts`; **venue-service owns** its implementation, `assertPeriodEndOffsets(tx, cfg, candidateClock?: BusinessDayClock): Promise<void>`; omitted candidate preserves existing callers.
- **Repair API owns** `GET /management-api/venue-details/time-zone-repair[?timeZone=...]` and POST of exactly `{ timeZone: string; expectedClockRevision: number; confirmed: true }`. Both require the management cookie, exact configured management Origin and live `venue.configure`; POST requires JSON. `ZoneRepairView` contains identity, eligibility/category, revision, country choices/suggestion, admission state, retained clock and optional candidate preview `{ at, civilDate, timeOfDay, offsetMinutes, businessDay, dayCutover }`. POST returns `{ repaired: true; clockRevision: number; admission: "restart_required" }`. A role-blind authenticated session carries only admission for routing; permission-gated GET supplies details. No browser-supplied target or financial facts.

## Review focus

1. A runtime-accepted alias outside a geography suggestion remains a valid saved zone and cannot grant repair (Tasks 1, 3, 7).
2. A failure after confirmed commit or a lost response must not invite a second audit/write, and a restart must not bypass a different fault (Tasks 7, 9, 18).
3. An already-settled replay must not acquire a current clock; a direct caller or worker must not bypass closed admission (Tasks 10–13, 16).
4. Pending provider work spanning midnight/DST must retain capture evidence and acquire its issue offset at finalization (Tasks 11, 12, 17).
5. Broken cutovers/schedules and unexpected formatter/structure faults must neither disappear nor turn into zone-change authority (Tasks 3, 7, 8).

## Execution rules

Tasks depend on earlier interfaces; keep them inline. Each is a bounded deliverable, normally 20–60 tool calls and **under 100**. If one exceeds that budget, checkpoint its named subcases and continue the same task next firing rather than deleting acceptance. Each test step means write assertions, run the listed focused command, inspect a nonzero test count and the expected behavioural failure, then implement and rerun. A missing import/compiler failure is not the intended red result. Commands below are future commands, not executed receipts.

For safety-critical omission controls, create a disposable detached checkout containing the complete candidate and tests, install its locked dependencies with `pnpm install --frozen-lockfile`, remove only the named new check, and run the named focused case. Record the observed wrong write/provider call or wrong value; compile errors are not evidence. Restore that copy, rerun the passing control, and remove it. Never swap files/stashes in the feature checkout. Existing guards and golden tests remain unedited in both trees. Every task ends with `git diff --check`, review/stage only its paths, then **`git commit -s`** with the stated message; commit only after its meaningful focused cases pass.

### Task 1: Minimal A166 list and independent runtime validation

**Files/ownership:** Create shared `src/time-zone.ts`/`.test.ts`; extend shared `index.ts`/`errors.ts`, country `src/country.ts`, country-es `src/spain.ts`, country-gb `src/united-kingdom.ts`, country-packs `src/registry.ts` and their sibling tests. Consumes Intl only; produces shared classification/conversion and country policy interfaces above.

- [x] **Red:** Assert ES list exactly `["Europe/Madrid", "Atlantic/Canary"]`, GB exactly `["Europe/London"]`; defaults/area suggestions belong to their lists. Missing/null/`""`/spaces classify missing; `"Invalid/Zone"`/`"+02:00"` invalid; `" Europe/Madrid "` canonicalizes to Madrid; runtime-recognized `US/Eastern` stays valid. ES creation rejects London with `venue.time_zone_invalid/{reason:"country"}`; an alias canonically equivalent to a listed zone succeeds. Inject non-RangeError runtime failure and assert it propagates, not invalid eligibility.
- [x] **Minimal:** Implement the interfaces; accept named UTC for saved-zone validity; reject numeric zones even where Intl accepts them. Offset is computed per finite instant; formatter failure is not name rejection. Do not add worldwide choice UI or enable unsupported territories.
- [x] **Red/green command:** `pnpm --filter @waitron/shared exec vitest run src/time-zone.test.ts`; run country-es/GB sibling tests and `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts` separately. Expect listed assertions to fail before implementation and all selected counts to pass afterwards.
- [x] **Control/commit:** In the installed disposable copy omit the country-list comparison: ES/London must wrongly succeed and fail its assertion. Commit `feat: define country zone choices and runtime validation` with `git commit -s`.

### Task 2: Planner, direct actions and configuration import

**Files/ownership:** Modify provisioning `src/venue-plan.ts`, `venue-apply.ts`, `configuration-transfer.ts`; server `src/provision.ts`, `setup-api.ts` only where their existing geography boundaries consume validation; tests `venue-plan.test.ts`, `venue-apply.e2e.test.ts`, `configuration-transfer.boundaries.test.ts`, server `configuration-transfer.clock.test.ts`/setup tests. Consumes Task 1; produces independently validated planner actions, apply input and bundle metadata with existing return types.

- [x] **Red:** For each missing/blank/numeric/unsupported/country-excluded value assert the exact Task 1 code and zero inserted locations. Construct `create-location` actions directly, bypassing planner; assert refusal before reuse conversion or any seed. Validate artifact A and selected request B independently: valid artifact + invalid B and invalid artifact + valid B both refuse. Direct import rejects malformed metadata even if it would not overwrite a zone. Reuse with an invalid saved zone refuses and never repairs it.
- [x] **Minimal:** Call country validation in planner, preflight every apply action using ensure-tenant/stored country context before module preparation/allocation/seed side effects, and validate bundle before module callbacks/staging and again through import. Keep Spain's province equality and territory refusal. CLI `cli.ts`, first-setup-command-deployment and web provision must reach those boundaries. Keep locations/history outside import allowlisting; final prepared-location update still changes only its existing fields.
- [x] **Red/green commands:** `pnpm --filter @waitron/provisioning exec vitest run src/venue-plan.test.ts src/venue-apply.e2e.test.ts src/configuration-transfer.boundaries.test.ts`; `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.clock.test.ts`. Retain existing unsupported-territory assertions.
- [x] **Controls/commit:** Omit planner, apply, bundle-stage and direct-import checks **one at a time** in the installed copy; each dedicated case must accept/write the bad input and fail. Commit `feat: validate zone at every provisioning boundary` with `git commit -s`.

### Task 3: Saved clock context, retained schedules and normal settings revision

**Files/ownership:** Create server `src/venue-zone-context.ts`/`.test.ts`; modify `venue-details.ts`, `venue-details.test.ts`; extend `packages/module/src/module.ts` and venue-service `src/menu-timetable.ts`/tests together. Consumes Task 1 and existing nodes/locations/tenants/cutover tables; produces `ZoneContext` and candidate validation interfaces.

- [x] **Red:** Raw context for invalid zone returns category invalid and revision 0 without calling `readVenueDetails`/`readBusinessDayClockModel`. Missing node/location or configured-location mismatch throws `venue.time_zone_target_invalid` with the matching reason. Valid alias/out-of-country-list saved zone is ineligible. Preserve baseline `06:00:00`, past `2026-09-01/05:00`, future `2026-11-01/07:00`, schedule rows and existing revisions byte-for-byte during preview. Bad shape, duplicate/out-of-order dates, non-increasing boundary and incompatible end offset return their own clock/timetable codes.
- [x] **Minimal:** Read raw rows directly and normalize cutover spellings only in memory. Validate boundaries on the day before/at/after every retained transition, plus current bounds; extend `VenueServiceContribution.assertPeriodEndOffsets` with the same optional candidate-clock parameter, then use candidate-aware `assertPeriodEndOffsets` through the existing `VENUE_SERVICE` module slot. Assert a distinct candidate reaches that slot and changes the validation result, with the stored clock unchanged; keep the two-argument control. Keep all history locks in normal `writeVenueDetails`; on a real eligible zone change bump clock revision once in the same transaction. An equivalent/no-op alias edit bumps it zero times; publish any admitted configuration refresh only after commit.
- [x] **Red/green commands:** `pnpm --filter @waitron/server exec vitest run src/venue-zone-context.test.ts src/venue-details.test.ts`; `pnpm --filter @waitron/venue-service exec vitest run src/menu-timetable.test.ts`. Run `pnpm --filter @waitron/server typecheck` and `pnpm --filter @waitron/venue-service typecheck` to check the shared signature; keep source-existing schedule assertions as well as candidate cases.
- [x] **Control/commit:** Omit candidate schedule validation in the installed copy: the incompatible candidate must wrongly pass. Commit `feat: validate retained zone clocks without ordinary details` with `git commit -s`.

### Task 4: Prepared issue clocks and closed admission

**Files/ownership:** Create fiscal `src/issue-clock.ts`/`.test.ts`, export via `src/index.ts`; create server `src/trading-admission.ts`/`.test.ts`; shared error registry and server/till/dashboard localized code maps/boundary statuses. Consumes Tasks 1/3; produces the fiscal and admission interfaces above. Preserve existing `systemClock` as an instant/confidence source, not the invoice offset source.

- [x] **Red:** Initial holder refuses with `venue.time_zone_not_ready/{reason:"unchecked"}`; missing/invalid/restart each gives its own fixed reason; only `admit` opens it. At `2026-10-14T23:30:00.000Z`, stored Madrid plus source offset 0 produces frozen instant unchanged and offset 120. Source `now` is called once; mutating either returned Date cannot alter later reads. Bad node/zone/instant/formatter produces its separate exact code before any writer call; preserve confidence/anchor metadata.
- [x] **Minimal:** Implement node-location agreement and raw-zone validation in the caller transaction. Keep holder required in server economic dependency types; no optional/no-op default for direct orchestration. Build conversion errors independently of repair classification. Add 409 mapping and reason-specific EN/ES confirmation versus waiting/reloading messages; webhook keeps its retryable server-error boundary.
- [x] **Red/green commands:** `pnpm --filter @waitron/fiscal exec vitest run src/issue-clock.test.ts`; `pnpm --filter @waitron/server exec vitest run src/trading-admission.test.ts`; focused changed boundary/i18n tests. Run existing root `scripts/errors-reachable.test.ts` without editing its assertions.
- [x] **Controls/commit:** Omit holder `require`, then saved-zone validation, independently; observe acceptance of unchecked/bad-zone work. Commit `feat: prepare saved-zone issue clocks and trading admission` with `git commit -s`.

### Task 5: Signed webhook admission and redelivery

**Files/ownership:** Modify server `webhook.ts`/`.test.ts`; create `zone-webhook-admission.test.ts` for the independent boundary cases. Consumes Task 4 admission; produces the signature-verifying webhook handler mounted by Task 8. No dependency on later issuance changes.

- [x] **Red:** A valid signed new settlement under closed admission returns retryable **500**, stores **0** new economic rows and retains preexisting evidence byte-for-byte. Direct `settleWebhook` must refuse too. Invalid signatures keep their existing refusal. Admitted control stores the settlement once; closing, reopening and redelivering the same verified event creates no duplicate.
- [x] **Minimal:** Make admission a required handler/orchestration dependency and check it at the actual settlement-write transaction after raw signature verification. Retain verified unrelated-event treatment. Use the real installed provider client with synthetic signed events; provider-side money movement remains outside this claim.
- [x] **Focused red/green/control:** `pnpm --filter @waitron/server exec vitest run src/webhook.test.ts src/zone-webhook-admission.test.ts`. In an installed copy omit only the write-boundary check; observe 200/new settlement and the intended failed assertion, then restore/pass.
- [x] **Commit:** `git commit -s` with `fix: refuse webhook settlement before zone admission`. Actual repair-mode mounting and post-restart redelivery are Task 8/18 acceptance.

### Task 6: Qualify the invalid-zone restore entry dependency

**Files/ownership:** Inspect server `recovery-fiscal-selection.ts`, `recovery-preparation.ts`, fiscal-verifactu `setup/recovery-hour.ts`, `completed-recovery-document.ts`, `recovery-pdf-node.ts`; create server `zone-restore-entry.test.ts`. Consumes Task 1 classification and existing restore identity/evidence inputs. Produces a qualified caller-only path to placement/startup, or an exact H2 dependency receipt; it does not admit trading.

- [x] **Red:** Supply an archive whose saved zone is invalid through real preview/preparation/archive restore and the bucket equivalent. The current `recoveryFiscalSelection` drops selection before preparation. Assert that a valid original recovery identity and raw invalid zone can be retained through the caller boundary without inventing a usable clock. Include wrong key/damaged identity controls that still refuse before placement.
- [x] **Minimal or exact stop:** Separate zone formatting from recovery-identity selection only in callers/presentation, using existing explicit UTC evidence where local rendering is unavailable. Preserve raw artifact zone and all allocation/activation validation. If a protected guard, writer or golden assertion must change, stop this dependency at H2 and report the exact file/signature/proposed diff; continue independent tasks. No restore acceptance may be claimed until that dependency is resolved.
- [x] **Focused red/green/control:** `pnpm --filter @waitron/server exec vitest run src/zone-restore-entry.test.ts`; provision the pinned archive/bucket tools this suite uses and inspect nonzero counts. Keep original key and allocation refusal assertions. Omit the new caller separation in the installed copy to reproduce the original pre-boot refusal, then restore/pass. Actual restored boot/repair is Task 18.
- [x] **Commit/checkpoint:** `git commit -s` with `test: qualify invalid-zone restore entry` for passing caller changes/tests, or commit only the exact dependency documentation if H2 stops this work; leave the unresolved checkbox open.

### Task 7: Atomic confirmation and response-before-restart

**Files/ownership:** Create server `src/venue-zone-repair.ts`, `venue-zone-repair-api.ts`, `restart-after-response.ts` and sibling tests; produce an explicit response-finish restart callback and handler dependencies for Task 8 integration; add error/event registry, boot alert claim and dashboard `i18n/alert-messages.ts`. Consumes Tasks 1/3/4; produces GET/POST and one handled incident. `restartAfterResponse(outgoing: ServerResponse, requestRestart: () => void): void` uses the installed Hono Node `HttpBindings.outgoing`; it requests restart once on finish or disconnect after commit.

- [x] **Red:** Both paths require live `venue.configure`; manager/admin succeed, staff/supervisor refuse. Missing/foreign Origin, non-JSON, unknown fields/forged node/payment/date/force, false confirmation, unsafe/negative/noninteger revision change 0 rows. Hold parsed request, revoke/suspend/expire/demote session, then resume: refusal at transaction authorization. Valid saved name/alias refuses even with history. Country-excluded candidate refuses; missing/invalid saved name alone permits candidate validation.
- [x] **Red:** With revision absent, successful Madrid confirmation produces revision **1**, exactly **1** `venue.time_zone_repaired` warning whose acknowledged time equals detected time and acknowledged actor equals authorized actor; params have node/location, canonical zone, revisions 0/1, old category and a 64-hex SHA-256 fingerprint, never raw invalid text. Audit insert failure rolls zone/revision/event back. Concurrent same-revision saves yield one success and one conflict; lost-response retry sees ineligible valid zone, no second event. Later independently corrupted fixture plus successful repair yields a second handled event, not open-incident deduplication.
- [x] **Minimal:** One `withTransaction`: reauthorize, resolve target, reread category/revision, validate candidate/retained clock, update zone only, bump revision, insert handled event directly using existing schema. Stale revision uses `venue.business_day_changed`; valid saved value uses new `venue.time_zone_repair_not_needed` (409); malformed request uses `management.request_invalid` (400). Register new codes/event and an explicit alert claim with `venue.configure`. After commit set restart-required and use the response lifecycle helper with a required restart callback, supplied by boot in Task 8. Verify callback ordering here without depending on that later boot integration. Failed commit requests no restart; disconnect after commit does, without another write.
- [x] **Red/green commands:** `pnpm --filter @waitron/server exec vitest run src/venue-zone-repair.test.ts src/venue-zone-repair-api.test.ts src/restart-after-response.test.ts`; run root registry guards unedited. Capture logs and assert no raw invalid value, body or secrets. Failed-refresh/status-read and restart-failure cases belong to Tasks 9/18.
- [x] **Controls/commit:** Omit transaction reauthorization, revision comparison and handled-incident insert separately in installed copy; each dedicated assertion must fail for unauthorized overwrite, duplicate success or missing audit. Commit `feat: confirm unusable venue zones atomically` with `git commit -s`.

### Task 8: Boot admission and repair-only authentication

**Files/ownership:** Modify server `boot.ts`, `health.ts`, `node-api.ts`, `me-api.ts`; create `zone-repair-serving.ts`/`.test.ts`, `boot.zone-admission.test.ts`; retain `boot.failed-start.test.ts`, `boot.mirror.test.ts` and authentication suites. Consumes Tasks 3/4/5/7; produces boot-selected repair-only or normal serving and the session admission view.

- [x] **Red:** Delay validation with a controlled promise: before release, starts for attendance/email/invoice delivery/pending-card/refund/other normal duties are 0, unrestricted binds 0, `acceptingSales` never true. Fresh and restored bad-zone boots serve manager login/session/logout/confirmation without details/report/alert/clock loaders. Public status exposes only liveness and unavailable trading; authenticated staff see explanation/logout, not context or action. Valid zone is an opposite control: existing primary boot duties and sales work.
- [x] **Minimal:** Complete required structural/identity/membership/fiscal/clock checks before admission and the first dependent duty; valid zone alone never admits. Repair mode starts only narrow request tracking/listener/assets/guides, registering undo immediately. Exact allowlist under `/management-api`: GET `locales`, `session/me`, `google/config`, `google/callback`, `passkey/signals`; POST `session`, `password-reset`, `account-actions/inspect`, `account-actions/complete`, `passkey/auth/options`, `passkey/auth/verify`, `passkey/register/options`, `passkey/register/verify`, `session/me/passkey-offer`, `google/login`; DELETE `session`; plus Task 7 GET/POST. Retain route authentication/MFA/Origin/RP/cookies and static/account-link assets. Mount `/webhooks/stripe` only through Task 5's signature-verifying, admission-closed handler, so a new settlement gets retryable 500 rather than middleware 409. This grants no write bypass. Default-deny other surfaces; mirror/fence remains outside the exception.
- [x] **Red/green commands:** `pnpm --filter @waitron/server exec vitest run src/boot.zone-admission.test.ts src/zone-repair-serving.test.ts src/boot.failed-start.test.ts src/boot.mirror.test.ts`; selected existing password/MFA/passkey/Google cases. Assert no session before second factor, generic refused-login responses, revoked/suspended/expired refusal, no automatic modal passkey and no need for ordinary details. Exercise account mail's existing display-only fallback; do not reuse it for admission.
- [x] **Control/commit:** Omit the pre-duty decision in the installed copy; delayed boot must start a named duty and fail. Commit `feat: boot unusable zones into restricted management` with `git commit -s`.

### Task 9: Reachable repair dashboard and guides

**Files/ownership:** Modify dashboard `src/dashboard-app.ts`, `src/api/client.ts`, `src/i18n/strings.ts`; create `src/screens/venue-zone-repair.ts`, `.test.ts`, `.unsaved.test.ts`; server `src/guide/en/time-zone.md`, `src/guide/es/time-zone.md`; dashboard `src/help-guide.ts`. Consumes session admission view and Task 7 API; produces repair without ordinary navigation initialization.

- [x] **Red:** A bad-zone session mounts repair before live/content-language/alerts/details/report loaders (spies each **0**). Staff see legal name/explanation/logout only; manager sees country choices with no preselected/saved suggestion. At `23:30Z` candidate Madrid preview shows `2026-10-15`, `01:30`, +120, business date `2026-10-14` under 06:00 cutover. Save initially quiet/disabled; choosing and confirming activates it; invalid submit shows each field and one bottom message, keyboard/Enter follows Forms. Request refusal permits retry without editing; stale reply cannot overwrite newer session/status.
- [x] **Minimal:** Use `wt-combobox`/existing confirmation primitive, semantic `timeZone`, required marks, `draftScopeFor`, `saveActionState` and native-focus access. Show approved fixed explanation, suggestion rationale, retained changeover and explicit “I confirm that this is the correct time zone for this venue.” Never offer payment recovery. After success accept the saved draft and show restart/readiness; if refresh fails show load failure. On a lost POST response read status before offering another save; valid saved state means restart/readiness, not an editable repair.
- [x] **Red/green commands:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-zone-repair.test.ts src/screens/venue-zone-repair.unsaved.test.ts src/dashboard-app.test.ts`; `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; existing root `scripts/guide-links.test.ts`. Restore global locale after cases; add matching explicit guide ids.
- [x] **Look/commit:** Inspect real Chromium EN/ES, light/dark, 390px phone and desktop, keyboard focus, leave-with-draft, logout/session expiry, error/restart/load failure. Use managed `wa-wt` stack if needed; stop only owned processes. Commit `feat: guide managers through startup zone confirmation` with `git commit -s`.

**Execution note, 21 October:** The dashboard suppresses referrers. Its native same-origin GET has no `Origin` header, so that read also accepts browser `Sec-Fetch-Site: same-origin` when the request URL's origin exactly matches configuration. POST keeps its exact `Origin` requirement; missing browser evidence, a foreign origin or a different URL origin still refuse. A normal boot removes the repair-only route, so lost-reply status recovery checks authenticated session admission after a 404 and retires the draft only for `ready` or `restart_required`. The repair language chooser changes display locally without a profile write.

### Task 10: Default-deny mutations and direct auto-issue callers

**Files/ownership:** Modify server `till-api.ts`, `payments-api.ts`, `adjustments-api.ts`, `working-order.ts`, `unpaid-departure.ts`, `cancel-credit.ts`; thread the same holder through bill-actions, adjustment/draft/line-cancellation and finish-service callers; create `zone-economic-boundaries.test.ts`; extend relevant existing route/direct tests. Consumes required `TradingAdmission`, `requireEconomicWrite` and prepared clock; produces shared HTTP/direct checks without changing protected writers.

- [x] **Red:** For each closed state assert 409/fixed reason and zero new orders, tenders, payments, sales, fiscal records or numbering advance across save, line edit, split, adjustment auto-issue, unpaid departure and cancellation R5. Call exported orchestration functions directly as well as routes. An authenticated settled replay is the allowed opposite control; unauthenticated replay still refuses. Other application mutations, including safe-verb handlers that write, are absent/refused in repair mode; authentication bookkeeping is the named exception.
- [x] **Minimal:** Thread admission explicitly through dependencies and require it at economic transaction entry before writes; each auto-issue boundary prepares the existing clock before rating/correction. Keep operator/session/device-profile/action/zone and normal primary checks. Inventory all `issueIfFullyPaid`, `issueUnpaidInvoice`, `creditWholeInvoice`, core writer and provider preparation call sites; record each against a behavioural case, including direct exports. Do not replace checks with route middleware alone.
- [x] **Red/green commands:** `pnpm --filter @waitron/server exec vitest run src/zone-economic-boundaries.test.ts src/unpaid-departure.test.ts`; focused existing working-order/adjustment/cancel route cases. At the night fixture each new issue has `2026-10-15`, +120 and one new fiscal record; existing invoices stay unchanged.
- [x] **Controls/commit:** Omit route and direct boundary checks in separate installed-copy runs. Isolate each from redundant gates: call middleware with a terminal write spy, and direct orchestration without HTTP middleware. Require the intended write to expose omission. Commit `feat: gate economic edits and direct issuance callers` with `git commit -s`.

### Task 11: Whole-order sale, collection and captured recovery

**Files/ownership:** Modify server `till-sale.ts`, `issue-moment.ts` only as needed, `working-order.ts` issuance helper and dependency types; extend `till-sale.test.ts`, `till-sale-integrated.test.ts`, `issue-moment.test.ts`. Consumes Tasks 4/10; produces prepared input at every immediate/deferred collection/finalization boundary, preserving existing outcomes.

- [x] **Red:** Walk-up cash/manual card, held/placed/zero-due and invoice-first later collection each use saved Madrid at night. New issue: instant `2026-10-14T23:30:00.000Z`, offset **120**, fiscal issue day **2026-10-15**, generation **2026-10-15T01:30:00+02:00**. Already-issued later settlement adds **0** invoices. Closed admission before preparation calls collect **0** times and changes **0** financial rows. Normal and accepted-offline captures finalize once with original provider amount/instant and new issuance-time offset; captured-crash recovery calls collect **0** times.
- [x] **Red:** Hold provider response over local midnight and a DST boundary, then finalize. Source is read once for issuance before `rateLines`; existing rate-change fixture retains total **2.50**, base **2.27**, tax **0.23** at its pre-midnight reading. Hold capture while attempting ordinary zone edit: existing order lock refuses with `venue.detail_locked/{field:"timeZone",reason:"orders"}`; releasing provider produces one invoice/charge and unchanged capture facts.
- [x] **Minimal:** Validate target/name **and a disposable conversion reading** in preparation before collection; a formatter/instant failure calls collect 0 times and offers no repair. Prepare a fresh issue clock in finalization, before rating. No lock/transaction spans provider I/O. Return settled replay before new clock/rating; retain capture/reservation/resolution evidence and idempotent effects. Never reuse the preparation reading's offset for issuance.
- [x] **Red/green command/control:** `pnpm --filter @waitron/server exec vitest run src/till-sale.test.ts src/till-sale-integrated.test.ts src/issue-moment.test.ts`. In installed copy omit preparation validation and then finalization preparation separately; assert bad-zone collect call and wrong +0 offset respectively. Commit `fix: issue whole-order invoices in the saved venue zone` with `git commit -s`.

### Task 12: Bill money, management completion, refunds and worker boundaries

**Files/ownership:** Modify server `bill-payments.ts`, `bill-payments-loop.ts`, `bill-refunds.ts`, `tender-refunds.ts`, `tender-refund-sends.ts`, `tender-refund-recovery.ts`, `pending-card-recovery.ts`, `payments-api.ts`, bill/tender API dependency wiring and boot loop wiring. Create `zone-bill-payment-boundaries.test.ts`, `tender-refund-recovery.test.ts` and test-only `testing/zone-payment-venue.ts`; extend pending-card tests and complete existing refund fixtures. Run the original card/loop/refund/management suites as well. Consumes admission and prepared clock; retains existing result types.

- [x] **Red:** Partial cash/manual/reader payment retains received-at; last payment, poll/retry, stored-provider completion and manager attestation issue exactly once at finalization (+120/night day), preserving all received/settled instants. Closed admission refuses payment/collection/refund preparation with provider collect/refund calls **0** and **0** new payment/refund/resolution/attestation rows. Do not weaken manager PIN/note/contradictory-evidence rules. Saved evidence remains identical after rejected finalization.
- [x] **Red:** Direct automatic whole-order recovery, pending bill completion and tender-refund recovery each run one forced pass with ready then closed admission before its transaction: zero new economic rows/provider calls in the closed case. Already-stored capture remains captured/unassociated; later admitted pass finishes once. Concurrent manager/till/worker completion returns one saved invoice with no duplicate receipt/drawer/effects. Worker-only tests must reach the boundary even when boot's start gate is bypassed.
- [x] **Minimal:** Require admission per pass and at every economic write/provider preparation transaction, retaining role predicates; reader preparation also validates a disposable conversion reading. Prepare a fresh clock in shared bill issuance, including `issueIfFullyPaid`; non-issuing refund clocks retain their event semantics. Add no recovery authority. Await resolver stop and all loops before store close; register undo immediately.
- [x] **Red/green commands/controls:** `pnpm --filter @waitron/server exec vitest run src/bill-payments.card.test.ts src/bill-payments-loop.test.ts src/pending-card-recovery.test.ts src/tender-refund-recovery.test.ts`; separately run focused refund and management-attestation cases. Delete each worker boundary check in installed copy with boot/pass gates held out of the way; expect the specific saved row/provider call to appear. Commit `fix: gate payment workers and bill issuance by zone admission` with `git commit -s`.

**Execution note, 21 October:** The dedicated boundary/recovery command passes 65 cases, including midnight and both DST transitions. The broader 14-file payment/refund/management command passes 737; five selected boot shutdown/unwind cases pass. Existing assertions remain unchanged after fixture completion. The original wrong-node refusal tests caught a validation-order regression: zone validation now follows invoice ownership checks and still precedes reservation writes. An installed complete candidate catches 15 omissions and passes 65 after restoration. Entry-only omissions distinguish refusal shape or provider access; transaction omissions expose attempted writes, changed refund rows or finalization. These checks do not complete Tasks 13–20 or qualify external provider behavior.

### Task 13: Core-only correction, substitution, void and emergency capabilities

**Files/ownership:** Create server `src/zone-core-capabilities.test.ts`; create fiscal-verifactu `src/void-issue-clock.ts`/`.test.ts`, export via its `src/index.ts`. Keep protected core writers/backend/chain/builders unchanged. Consumes fiscal `prepareIssueClock`; produces `prepareFiscalVoidClock(tx: Transaction, saleId: SaleId, source: TrustedClock): Promise<TrustedClock>`. This read-only caller adapter owns the original-alta lookup inside its regime module; generic server production code gains no regime-specific query or route.

- [x] **Red:** Exercise real core F1/deferred, generic R5, multi-original F3 and fiscal void through prepared clocks. New issue/generation at night follows Madrid; old offset-0 invoice dated **2026-10-14** stays that exact referenced date. Void has one new annulment, **0** allocated numbers, original identity day **14-10-2026**, new generation **2026-10-15T01:30:00+02:00**. Resolve original alta's writing node and verify agreement with saved sale/node before preparing; mismatches refuse without writes. F3 retains multiple original dates and original predecessor hash.
- [x] **Minimal:** Prepare in the caller transaction; construct void backend through existing contribution `makeBackend({db,clock,environment})`. Direct core/backend/CLI callers validate their own database/location, not a live-server holder. Keep raw explicit record inputs unchanged. Existing active emergency identity/series uses the same path; allocation timestamps do not become generation clocks. Preserve F1 operation-date selection and absent `FechaOperacion`; public F1 remains refused.
- [x] **Red/green commands/control:** `pnpm --filter @waitron/server exec vitest run src/zone-core-capabilities.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/void-issue-clock.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts`, with the latter two unedited. In installed copy use unprepared caller source: +120/reference assertions must fail. Label these core-only, never public routes.
- [x] **Commit:** `git commit -s` with `test: qualify caller clocks across fiscal capabilities`. Any need to edit a protected body or golden expectation is the exact H2 dependency gate, not permission supplied by this task.

### Task 14: Readiness, installed/CLI seeds and every script writer

**Files/ownership:** Modify provisioning `fiscal-readiness-runner.ts`/`.test.ts`, `recover-provisioned-venue.ts`; server `demo-seed.ts`, scripts `dev-setup.ts`, `demo-seed/seed-sales.ts`, `demo-seed/testing/provision-venue.ts`, `record-one-sale.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`, `allergens-demo.ts`; extend corresponding script/readiness tests, add `src/zone-script-callers.test.ts`. Consumes Tasks 1/2/4; produces explicit validated saved zones and clocks in those existing entry points.

- [x] **Red:** Fresh **and reused** isolated readiness with bad saved zone refuse before sample issuance; live venue readiness cannot substitute for it. Injected `clock()` controls actual issuance, called once per issue, independent of tender-only `now`. Installed Demo refuses bad saved zone before seed issuance. CLI/web/dev/first-setup inputs reach planner/apply validation. Four default inserts explicitly save Madrid, including allergens which issues nothing. Direct action/bundle/reuse cases remain independently covered.
- [x] **Minimal:** Validate explicit intended zones through Task 1 at each direct script insert; do not change schema defaults. Resolve each script's writing node in its issuing transaction. Readiness shares one prepared clock between core and backend. Backdated seed keeps every generated instant and derives that instant's offset; live-clock CLIs prepare sale and correction separately. Fixed August Madrid demos retain **+120** and their existing scenarios; do not change reporting/demo calendar selection or unrelated seed content.
- [x] **Red/green commands:** `pnpm --filter @waitron/provisioning exec vitest run src/fiscal-readiness-runner.test.ts`; `pnpm --filter @waitron/server exec vitest run src/zone-script-callers.test.ts src/fiscal-readiness-runner.verifactu.test.ts`. Use spawned built-script cases for command entry points, with owned temporary dirs, controlled clock/release metadata and clear `GIT_*` when git is invoked. Assert sample date/generation, not tender time alone.
- [x] **Controls/commit:** Make each direct script's seed insert callable for testing as `seedVenue(db: Database, timeZone: string = "Europe/Madrid")`, keeping that default at its command entry and adding no operator flag. In installed copy omit each insert validation independently and call with `Invalid/Zone`; the saved invalid value must fail its assertion. Separately omit reused-readiness validation and historical seed offset resolution. Commit `fix: validate script zones and prepare isolated issue clocks` with `git commit -s`.

### Task 15: Plain F2 presentation from recorded offsets

**Files/ownership:** Modify server `receipt-issuer.ts`, `receipt-document.ts`, `till-sale.ts` result type/callers; create `src/receipt-issuer.test.ts`, extend receipt-document tests; till `src/api/client.ts`, `src/screens/till-ticket-view.ts`/`.test.ts`/`.presentation.test.ts`. Inspect whole-shape till-sale/bill API tests and A4 `invoice-document.test.ts`. Consumes saved offset; returns it independently of recipient blocks.

- [x] **Red:** Plain F2 without recipient at the night instant and offset 120 displays **15 October, 01:30** in thermal/browser output, including simplified layout. Old saved offset 0 displays **14 October, 23:30**, even with current Madrid or unreadable zone; no current-zone read occurs. F1/A4 matches its saved offset. Recipient/issuer/customer blocks retain their existing gates. Assert the actual QR URL invoice-identity date too: the old offset-0 invoice remains `14-10-2026`; the newly issued Madrid invoice uses `15-10-2026`. Repeat through receipt and reprint with a changed or unusable current zone; QR identity, displayed date and stored original each retain their own recorded facts. Reprint/replay never re-date or re-rate.
- [x] **Minimal:** Read/supply saved offset before filed-issuer or recipient-only early returns; test absent issuer too. Consume it in each simplified/F2 renderer. Replace the old F2 offset-ignoring assertion with exact dates; retain unrelated assertions. Update permitted whole-shape JSON expectations; protected goldens remain untouched.
- [x] **Red/green commands:** `pnpm --filter @waitron/server exec vitest run src/receipt-issuer.test.ts src/receipt-document.test.ts src/invoice-document.test.ts`; `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts src/screens/till-ticket-view.presentation.test.ts`. Inspect actual rendered thermal artifacts and browser EN/ES, both themes/phone/desktop; use strings files for translated expected labels.
- [x] **Control/commit:** In installed copy omit offset at issuer and each renderer independently: midnight assertions must show the wrong day. Commit `fix: render plain receipts with their recorded issue offset` with `git commit -s`.

### Task 16: Saved replay and historical facts across filing and restore

**Files/ownership:** Create server `zone-preservation.test.ts`; extend focused existing resend/reconcile/filing-case/export/restore suites without editing protected fiscal checks. Consumes Tasks 6/10–15; produces preservation receipts, no new history-writing interface.

- [x] **Red:** Saved authenticated replay, historical read, reprint and outbox reconstruction acquire **0** new issue readings. Compare complete fiscal/payment/close rows, original QR identity dates and reconstructed payload/hash around failed sends, lost answers, restart/resend, no-trace reconciliation, brake probe/release, date/month duplicate lookup and filing-case handling. No extra fiscal rows arise from those operations; only existing submission/detection bookkeeping may differ.
- [x] **Restore/export cases:** Retain configuration-transfer allowlists. Use actual archive and bucket entry points, including first drain, to retain predecessor/identity/allocation evidence and old recorded QR dates; the next admitted issue uses its saved zone. Task 6's unresolved H2 dependency blocks this acceptance, never silently substitutes post-placement corruption.
- [x] **Minimal:** Keep replay before new clock acquisition and preserve explicit record facts in reconstruction. Repair-only serving may defer clock-dependent reads until restart; it never turns replay into new money or starts ordinary filing duties.
- [x] **Focused red/green/commit:** `pnpm --filter @waitron/server exec vitest run src/zone-preservation.test.ts src/restore-fiscal-e2e.test.ts src/restore-stream.test.ts`; run affected fiscal drain/reconcile/filing-case suites separately. A skipped pinned-tool test is not evidence. Commit `test: preserve recorded facts across zone admission` with `git commit -s`.

### Task 17: Cross-process calendar and DST matrix

**Files/ownership:** Create server `src/zone-process-matrix.test.ts` and test-only runner `src/testing/zone-process-child.ts`; reuse Tasks 10–15 scenario helpers. Consumes their issuance seams; restart and A798 are separate Tasks 18/19. Parent launches separate Node processes under `TZ=UTC` and `TZ=Europe/Madrid`; child emits `{ casesRun, results }` keyed by scenario/family. Parent asserts the exact required key set and expected values, so selected CI tests execute both zones without a workspace-wide workflow change.

- [x] **Red/matrix:** In each process exercise the issuance families assigned in Tasks 10–14 through their real reachable boundaries; label core-only ones. Assert identical saved issue instant/day/offset and generation literal in both processes. Exact additional rows: Madrid `2026-10-14T22:30Z` → `2026-10-15/120/2026-10-15T00:30:00+02:00`; noon `2026-10-14T12:00Z` → `2026-10-14/120/2026-10-14T14:00:00+02:00`; Canary `22:30Z` → `2026-10-14/60/2026-10-14T23:30:00+01:00`, `23:30Z` → next day `00:30+01:00`. Canary winter `2026-01-15T23:30Z` → same day/0/`23:30:00+00:00`.
- [x] **Red/DST:** Madrid `2026-03-29T00:59:59Z` → `01:59:59+01:00` (60), `01:00Z` → `03:00:00+02:00` (120); `2026-10-25T00:30Z`/`01:30Z` → distinct instants, both `02:30` with 120/60. Reconstruct original literals/hashes. Canary qualification enables no taxation. Parent fails for missing/duplicate scenarios, zero count, timeout, wrong vector or nonzero child exit; bound child waits below parent budget and inspect parent test counts too.
- [x] **Focused red/green/control:** `pnpm --filter @waitron/server exec vitest run src/zone-process-matrix.test.ts`. In the installed copy remove one required scenario result and then use the process offset for one midnight case; each must fail its specific count/vector assertion. Restore/pass, then `git commit -s` with `test: compare issue calendars in UTC and Madrid processes`.

**Execution note, 21 October:** The installed complete candidate passed 18 parent cases: ten real cash calendar outputs and 115 selected owning issuance cases in each of separate UTC and Madrid processes, plus child exit/deadline checks. The parent checks exact calendar keys/values, family keys, source suites and selected counts. The script fixture now accepts the matrix host zone while keeping UTC as its standalone default; every original assertion remains unchanged. Missing/duplicate/zero-count outputs, a process-offset midnight issue and an omitted family produce nine expected assertion failures across five independent controls. Added child-observed script zones then pass both focused parent cases, preserving all 26 selected script cases. Forcing the nested executables or historical seeder back to UTC adds nine and two expected failures respectively; the restored script suite passes 13. Restored calendar/runner and readiness checks pass. No production change was needed in this task. Restored boot and actual A798 integration remain Tasks 18–19.

### Task 18: Restart order, restored boot and duty teardown

**Files/ownership:** Extend `boot.zone-admission.test.ts`, `boot.failed-start.test.ts`, zone-repair API and worker/race tests; use actual `node-entry`/restore entry helpers. Consumes Tasks 5–12 and resolved Task 6 entry. Produces complete response/restart/shutdown receipts.

- [x] **Red:** A successful repair response reaches its client before restart request; admission stays restart-required until process close. Lost response/status/retry creates one repair. A failed restart retains the committed repair and its actual other fault. Fresh, genuinely restored invalid-zone and promotion startup each reclassify before economic duties. After repair and successful normal restart, redeliver Task 5's signed webhook and settle once.
- [x] **Races/teardown:** Normal eligible valid-zone edit before history affects the next issuance without restart; order/sale/close/dated-cutover locks still refuse. Inject formatter/invalid-instant/structure failures: none becomes repair eligibility. Every started duty registers undo immediately, listeners close, holder releases and loops/resolvers finish before store close, even when another teardown throws.
- [x] **Focused red/green/controls:** `pnpm --filter @waitron/server exec vitest run src/boot.zone-admission.test.ts src/boot.failed-start.test.ts src/venue-zone-repair-api.test.ts`; focused worker cases. Omit pre-duty admission and one worker's transaction boundary separately in an installed copy, bypassing the other gate for each experiment; observe the named duty/write, restore/pass.
- [x] **Commit:** `git commit -s` with `test: qualify zone repair restarts and teardown`. An unresolved restore or protected dependency remains open and prevents whole-branch readiness.

**Execution note, 22 October:** The seven focused server suites pass 241 cases, including genuine archive/bucket command placement followed by real entry/boot, verified synthetic HTTPS, fresh password login, confirmation and normal restart. The bucket transport remains synthetic. Restored placeholder credentials still produce the existing first-start diagnostic; these cases qualify zone admission and saved rows, not successful fiscal first-start verification. The promotion case stops the genuinely promoted server, supplies an invalid saved-zone fixture, then reboots its persisted identity. Existing response-finish/disconnect cases accompany lost-answer/retry, retained repair after a failed restart, normal settings-to-next-sale and signed-webhook redelivery (one captured row, unchanged on duplicate). Its separate network settlement audit is explicitly offline.

A new failed-start case first observed an un-aborted Cloud worker when snapshot initialization threw. Registering each started Cloud duty's abort-and-wait immediately fixes that boundary; the full failed-start suite passes. Six independent faults in an installed complete candidate produce seven assertion failures: un-aborted worker, two early attendance duty starts, a changed pending-payment row, restart before response finish, missing restart-required state and an obsolete next-sale offset. Restoring the candidate passes all 241 cases. The worker probe calls its transaction boundary directly with no captured provider row, bypassing the pass gate and downstream issuance. Protected fiscal tests pass 20 cases unchanged; root teardown/English/module/dependency checks pass 5,394. These receipts cover the named cases; actual A798 clock-stop integration remains Task 19.

### Task 19: Keep A696 and A798 stops independent

**Files/ownership:** Add server `zone-clock-stop-interaction.test.ts` using the landed A798 public-state/write-boundary API, plus its existing clock fixtures. Consumes Task 18 and the actual released A798 interface; creates no A798 implementation or policy.

- [x] **Red:** With both stops, confirming A696 changes zone/revision/handled event only and leaves A798's exact refusal. Clearing A798 alone leaves A696 closed. The minimum/latest-generation comparison remains UTC across chains; zone confirmation changes neither the clock nor `system.manage`. A798's webhook exception still receives Task 5's A696 refusal, with no new settled evidence.
- [x] **Minimal/gate:** Compose the independent guards. If A798's needed interface has not landed, leave this named integration task incomplete, record the required branch/interface, and continue only independent work; no fake passing substitute.
- [x] **Focused red/green/control:** `pnpm --filter @waitron/server exec vitest run src/zone-clock-stop-interaction.test.ts`; run the specific landed A798 clock suite. Omit each independent check separately and assert the retained other refusal, then restore/pass.
- [x] **Commit:** `git commit -s` with `test: keep venue zone and clock stops independent`.

### Task 20: Complete coverage ledger, focused gates and FULL PR handoff

**Files/ownership:** Update this plan's execution receipts and relevant developer/runbook prose only for observed behaviour. Parent coordinates `docs/backlog.md` and minimal A166 residuals; never touch reserved `docs/backlog/fiscal.md` or rewrite old spec bodies. Consumes prior receipts; produces a reviewable FULL fiscal branch, not an automatic merge.

- [x] **Coverage ledger:** Map design §1 to Tasks 4/7–19; §2 to 4/5/8/10–12/18/19; §3 to 3/7–9/18; §4 to 1–3/14; §5 to 4/10–14/17/18; §6 to 10–19; §7 to all focused controls and Tasks 17–19. Enumerate walk-up, held, placed, zero-due, manual/integrated/offline, recovered capture, deferred/later settlement, bill worker/retry/attestation, save/edit/split/adjustment, unpaid departure, cancellation/generic R5, F1/F3/void, emergency, isolated readiness, installed/CLI seeds, live CLIs and fixed demos, with actual case/command receipts. No missing family or dependency is waived by a passing helper.
- [x] **Verification:** Run focused changed behaviour, Task 13's unedited fiscal checks and `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/guide-links.test.ts`; inspect counts and failures. Review `git diff <base> --name-only` for protected paths and `git diff --check`. Check developer/package README/operator claims across the complete changed path set. No local whole-workspace suite or duplicated hook; unrun checks stay pending.
- [x] **Commit/readiness:** Use `git commit -s` for final docs/receipts. Once all required work, including integration dependencies, passes, announce readiness for `finish-branch` and continue under the parent's workflow authorization. One Claude run-it whole-branch review after initial rebase belongs there, in an independent installed complete-candidate checkout. Read completed findings and fix them with focused checks. Retain approval across later rebases; inspect integration and rerun affected checks without another review solely for rebase.
- [ ] **FULL PR:** Push through normal hook, wait for required current-head CI coverage/merge jobs and inspect actual selected package scope, including the matrix children. Preserve 98/98/98/95 and mutation requirements. Finish green and leave this fiscal PR **waiting for owner landing**; no auto-merge. The parent handles backlog residuals, later authorized land-branch and cleanup. Wider A166 and A444 remain open. Plan publication alone claims no passing runtime, payment, browser, fiscal or restore acceptance.


### Execution update, 1 November: current-main integration and Task 19

The resumed tree is based on `ac8faa0a12e4b08e5d177edb47cff460258ea089`.
Integration commit `96ef38d5d` preserves the newer node configuration, portion-based orders,
clock-behind checks, full-disk checks, recovery packs and five-symbol minute identities.
Main retired the period-end-offset model and `settle-invoice-first.ts`; the earlier Task 3 and
Task 14 descriptions of those interfaces are historical. Candidate validation now retains the
actual `department_day_ranges`, cutover history and revision; the retired script's two added
cases were removed with that entry point. No protected fiscal writer or golden was changed.

Task 19 uses the released backend clock-stop and confirmation interfaces. Four real cases
check exact clock refusal/minimum UTC date across original offsets, unchanged fiscal/person/session
rows, zone repair and restart-required admission, authority-witness clock confirmation,
pre-reader refusal, and installed Stripe signature verification. Managers already have
`system.manage`: the test preserves the existing authorization result rather than assuming
that they lack it. Repair changes neither that result nor the clock reading.

The installed complete candidate passes all four cases. Independently omitting zone admission,
the bill reader's clock check, and webhook write admission produces the intended failed
assertions. In the clock omission, the provider collect count becomes one instead of zero;
a later fiscal refusal cannot hide it. Restoring the candidate passes all four again. The
owning clock-behind payment/refund suites passed 25 cases during integration.

### Task 20 coverage ledger

The commands below are focused Vitest runs through the named package. Earlier task execution
notes retain the original red/green and omission receipts; this table connects their boundaries
to the design and the resumed integration checks. It does not qualify live provider or AEAT acceptance.

| Design | Tasks and exercised boundary | Command/case receipt |
| --- | --- | --- |
| §1: saved-zone issue clocks and admission | 4/7–19: raw target/context, startup, all issuance callers, presentation, restore and independent clock stop | Server `trading-admission.test.ts`, `venue-zone-context.test.ts`, `boot.zone-admission.test.ts`; fiscal `issue-clock.test.ts`; the economic families below. Resumed startup/context/repair/webhook run: 90 passed. |
| §2: independent economic stops | 4/5/8/10–12/18/19: HTTP/direct writes, signed webhook, provider preparation and worker finalization | Server `zone-economic-boundaries.test.ts`, `zone-bill-payment-boundaries.test.ts`, `zone-webhook-admission.test.ts`, `zone-clock-stop-interaction.test.ts`; Task 12's payment/refund/attestation run: 737 passed. Resumed dedicated economic suites: 89 passed; Task 19 restored control: 4 passed. |
| §3: restricted repair | 3/7–9/18: missing/invalid classification, permission, preview, atomic confirmation, response-before-restart and duty unwind | Server `venue-zone-repair.test.ts`, `venue-zone-repair-api.test.ts`, `boot.failed-start.test.ts`, `zone-restored-boot.test.ts`; dashboard repair/unsaved/a11y/app/code suites: 544 passed during integration. Staff sign-in extension: 4 passed, eight actual captures. |
| §4: every saved-zone writer | 1–3/14: explicit ES/GB country lists, planner, direct apply, independent bundle/request checks, reuse and script inserts | Shared `time-zone.test.ts`, country-es/GB tests, country-packs `registry.test.ts`, provisioning `venue-plan.test.ts`, `venue-apply.e2e.test.ts`, `configuration-transfer.boundaries.test.ts`; server `configuration-transfer.clock.test.ts` and `zone-script-callers.test.ts`. Original controls are in Tasks 1–3/14; package-wide current-head CI remains required. |
| §5: issue time versus existing facts | 4/10–14/17/18: fresh finalization clock, pinned preparation clock, replay before reading, old records/QR facts and recovery identities | Server `till-sale-integrated.test.ts`, bill issuance/replay tests, `zone-preservation.test.ts`, `zone-preservation.restore.test.ts`, `zone-restore-entry.test.ts`; fiscal-verifactu `completed-recovery-zone.test.ts` and `void-issue-clock.test.ts`. Resumed adapter checks: 22 passed; restore/clock run: 11 passed. |
| §6: calendar and caller coverage | 10–19: walk-up, held, placed, zero-due, manual/integrated/offline, recovered capture, deferred collection, worker/retry/attestation, save/edit/split/adjustment, unpaid departure, cancellation, core F1/F3/R5/void/emergency, readiness and scripts | `zone-process-matrix.test.ts`: 18 parent cases passed under separate UTC/Madrid processes. Each process runs whole-order 39, bill 35, auto-issue 7, core-only 11, readiness 1, scripts 11 and core-only emergency 10 selected owning cases, retaining their assertions. Ten chronological real-cash vectors assert exact instant/date/offset/generation/hash/history across midnight and both DST transitions. |
| §7: executable failure controls | All task controls, especially 17–19 | Task 17's missing/duplicate/count/vector/family controls and Task 18's duty/restart/write omissions remain recorded above. Task 19's three independent omissions fail and restored candidate passes. No provider call is inferred solely from a downstream append refusal. |

The scripts family covers installed Demo refusal before catalogue/sales, backdated seed offsets,
`record-one-sale`, fixed August daily-close/Z/modelo-303 demos and explicit non-issuing allergens
seed validation. Readiness uses a separate provisioned database. The matrix labels F1/F3/R5,
void and emergency as core-only, without implying a public route. Recovered capture and deferred
collection retain original money facts; issuance uses its own fresh prepared reading.

Additional resumed checks: the unedited golden write-path and inmutabilidad suites pass 20 cases;
root alert/error/module/dependency/guide guards pass 4,080; server, dashboard, fiscal and provisioning
type checks and changed TypeScript lint pass. `git diff --check` passes. The integration assertion
inventory checks 7,556 existing direct expectation chains in 69 changed test files against the
rebased pre-integration tree. Input admission holders preserve matcher arguments; deliberate
A696-only adaptations cover the retired interfaces, new incident note field, minute identities,
earlier unknown-identity refusal and the current recovery pack's two pages/server-key attachment.
Protected test files have no diff against the captured main base.

The changed developer receipt, hour-recovery runbook, guide twins and repository README references
were inspected alongside the complete test diff. The old adviser-export backlog claim is removed:
exports continue to read saved issue dates; new invoices now receive the saved-zone date. Wider
A166 and A444 remain open. The repair refusal now offers the existing sign-out/sign-in flow, in
English and Spanish. Actual repair captures include errors and restart/load failure at phone and
desktop widths in both themes; real rendered guide checks pass eight views. A staff screenshot
setup initially changed only the logo theme; mounting each explicit host theme corrects that
measurement. It was a capture setup correction, not evidence of a production theme defect.

Local terminal logs, full test diff, integration assertion inventory, omitted-guard experiments and
visual artifacts are retained in Lane E `receipts/a696-resume-20261101/`. Whole-branch review,
normal push hook and required current-head CI remain pending at this checkpoint. This is a fiscal
PR for owner landing; local focused passes alone do not complete the FULL PR checkbox above.


**Backlog coordination, 1 November:** the owner lifted every file-overlap wait. The parent
removes the completed A696 task from the backlog and adds a dated implementation pointer to its
historical fiscal audit, preserving the audit bodies, decisions and every unrelated entry. This
supersedes Task 20's reservation of that file for this status update only; it does not authorize
changes to another lane's work. The separate fiscal PR still needs full review/CI qualification
and owner landing. The watcher-requested A1242 and A1252 observations are recorded separately
in the CI backlog; they change no product code.


### Whole-branch review and corrections, 1 November

The required independent installed Claude run-it review completed in 766 seconds against
`612535109230027092a40e9be50f43b8a8aa16f3`, reviewing `e9786061f`. Both findings are accepted.
The archive/bucket preservation suite still selected a retired four-symbol series; the current
fixture uses `A-0CNNY`. Its sample also preceded the owning helper's later records. The driver
observed both successive two-case failures, then used the actual series and chronological sample
clock; both cases now pass with every matcher retained. Earlier dated receipts did not establish
this suite's passing state after the rebase.

A padded saved zone was normalized for admission while other readers used its raw text. Six new
server cases reproduce ordinary duties starting and repair refusing it; direct issuance, reuse and
recovery cases fail separately. `classifySavedTimeZone` now validates stored spelling with Intl;
`classifyTimeZone` still normalizes new input. Every classifier consumer is traced: raw context,
issuance, reuse and recovery presentation use the saved check; request/candidate/country inputs
keep normalization. No old row is silently rewritten. The repaired row is saved canonically by
explicit confirmation. Supported aliases, missing values and unexpected runtime faults retain
their separate cases.

Checking recovery presentation exposed eight more stale test setups using main's removed
installation-code/last-hour fields. Their setup now uses main's second-clock/preview contract.
The old waiting target/date assertions are retired because `3ba85c7a6` (PR #1990), subsequently
`62a2b62bb`, renders a countdown there. The test now checks its exact `30:00`, retaining the UTC
comparison/ISO, raw selection, unavailable credentials, accessibility and width assertions. Before
the classifier fix it distinguishes 16 padded failures from eight invalid-zone passes; afterwards
all 24 pass, plus the unchanged owning recovery-hour browser suite. Actual padded recovery captures
were inspected in both languages/themes at phone and desktop widths.

Final focused corrections pass shared53, fiscal23, provisioning19, server80, recovery/browser/
protected113, and startup-unwind/repair-API86. The protected pair is unchanged. A complete installed
candidate then normalizes saved names again: two shared assertions fail and both padded boot cases
start duties. Restored shared53 and boot2 pass. These are the named boundary receipts, not proof
about every consumer or duty. The report's broader unverified claims remain explicitly unverified
in the retained triage. Review, timing/usage, red/green/control logs and exact candidate hash live
in Lane E `receipts/a696-resume-20261101/`. Normal push-hook and current-head CI qualification
remain pending; the FULL PR box remains open for their external evidence and owner handoff.


**First push-hook correction, 1 November:** format/lint passed, then the repository suite failed
one case while10,090 passed. The unchanged node-identity guard caught an unused retired fixture
setting and a fiscal test local still named for a till. The supported loader reads only node
identity and resolves its location from rows (`b1b0f1095`, PR #2198). Remove the unused settings
from boot and wrong-node restore fixtures; rename the fiscal fixture's13identifier uses, retaining
every matcher and property key. Focused guard40/server30/fiscal30 pass. A text search also caught
a retired setting after an escaped newline that the guard missed; its decoded-string gap is
recorded in the CI backlog, with the actual two-way probe. No guard was relaxed. The blocked
hook is retained as failure evidence; the next normal push must complete its gate again.


### First PR CI corrections, 1 November

PR #2369's first run (`41298505179`, head `465c0d43c`) completed with eleven failing
package jobs and the failing aggregate. Its other package merges and shared mutation passed;
server/provisioning merges were skipped. The normal push hook had passed 10,091 root cases,
coverage and affected types in 572 seconds. No failed check is bypassed or rerun unchanged.

The attendance test exposed a regression: line edits retain the order's recorded location when
configuration points elsewhere. `updateOrderLine` now checks the writing node's zone without
requiring the unrelated configured location to match. The original attendance assertions remain;
two new direct-edit controls accept a valid writing-node zone beside invalid unrelated configuration
and reject the reverse with unchanged rows. Observed red2, green75 across attendance/economic
suites. In an independently installed complete candidate, deleting just that admission makes the
invalid-node-zone case resolve revision1 instead of refusing; the positive control still passes.

Other failures exposed incomplete fixtures at the new boundaries. Payment/PIN routes now seed an
actual node and explicit zone; the signed webhook case uses its provisioned node. Bill/VAT tests
save the zone matching each literal issue offset, retaining every fiscal date/rate/replay matcher.
British fixtures use London; Spain CLI reuse uses Canary instead of an out-of-country candidate.
The two real readiness-drain cases save Canary for their unchanged UTC winter expectation.
Promotion restart fetches the actual ephemeral listener port, as main's A1152 harness requires.
An initial attempt to set the configuration port to0 correctly failed positive-integer validation;
the final fixture retains a positive configuration value and reads the bound port.

Changed-check notice: Task15 authorizes the three receipt-layout expectations to supply their
fixture's recorded offset120 rather than the date helper's implicit0. Their format/spacing/counter
assertions remain. Task3 authorizes the exact returned clock model to increment revision once for
a real zone edit; the three account-email cases now expect that increment and retain every email,
deadline and other model assertion. These follow the approved behavior, not changes to protected
fiscal expectations. The golden pair remains untouched.

Focused results after these corrections: attendance/economic75, receipt97, provisioning readiness/
reuse36, CLI68, seven server suites150, and promotion5 pass. The first combined server rerun was
154pass/1fail because of the attempted port0 fixture; the final promotion run fixes that failure.
No unhandled SQL error remains in the final payment test output. Exact red/green/history/omission
logs are retained in Lane E `receipts/a696-resume-20261101/`. A fresh normal push hook and
current-head CI remain required; the sole766-second review is retained for these bounded fixes.
