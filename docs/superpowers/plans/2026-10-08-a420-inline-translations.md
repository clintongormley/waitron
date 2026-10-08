# A420 Inline Translations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, one whole task per firing. Do not dispatch agents. Spec and unattended execution are approved.

**Goal:** Fill one language's missing customer-facing names in one staged, atomic save.

**Architecture:** Add paged translation targets and dedicated names-only commands in catalogue. The route owns one transaction; the widget separates drafts from passive snapshots. Keep the existing gap report and publication flow.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, shared `wt-*` controls, Vitest and real Chromium.

**Spec:** `docs/superpowers/specs/2026-10-08-a420-inline-translations.md`.

## Global constraints

- Work in this feature worktree only. No fiscal writers, migrations, append-only workarounds, guard/configuration changes or edits in other lanes' trees or main checkout.
- Only named cells change. A required default companion starts blank; staff text is only its placeholder. Never copy implicitly, clear translations, autosave, auto-publish or chunk writes.
- Exact limits: 1–100 unique targets, 50 displayed rows per page, 256 KiB serialized request, 4 KiB UTF-8 per entered name. Trim at submission, preserving internal spaces and typing selection.
- Preserve sibling names, variants/activity, option ordering/defaults, extras/prices, include folder settings, unit abbreviations/precision/seed/hardware, publications and recorded snapshots.
- Read CLAUDE.md, developer topics and the TDD skill before code. Follow observed red, minimal implementation, observed green. Domain refusals are caught outside `withTransaction` in tests.

Source: `ecba0d3794225407ad3eb8e3d5c7e4db37f1bb65`, **unverified until execution**. Re-read dependencies; no campaign-file reads beyond the brief. Record commands/counts, remaining tasks and commit at checkpoints; leave no processes running.

## Review focus

1. Multibyte text/false Content-Length: byte limits (4).
2. Reordered equivalent keys/language sets: save succeeds (3).
3. Joint root/include edits: validate final dependencies (3).
4. Detach before dirty scope redraw: reconnect protects edits (6).
5. Live fill/owner replacement: retain text/focus until review (6).

## Files and interfaces

Under `packages/catalogue/`, create `src/content-translation-types.ts` (browser-safe types), `content-translation-targets.ts` (bounded reads), `content-translation-writes.ts` (per-kind commands), `content-translations.ts` (batch), with sibling tests. Export from `packages/catalogue/src/index.ts`; register new errors in `errors.ts`.

Create `apps/server/src/content-translations-api.ts`/`.test.ts`; mount through `catalogue-api.ts`'s `gated`. Under `apps/dashboard/src/`, create `widgets/content-translations-model.ts`, `.test.ts`, `content-translations-dialog.ts`, `.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`. Modify `api/client.ts`, `api/live-queries.ts`, their existing `.test.ts` files, `screens/content-languages-screen.ts` and its two test files, `i18n/strings.ts`, `i18n/codes.ts`. Consumer paths appear in Task 7.

Wire types: `TranslationRef = {kind: TranslationGapKind; id: string}`; `TranslationEdit = TranslationRef & {expected: string; text: string; defaultText?: string}`; `TranslationBatch = {edits: TranslationEdit[]}`. `TranslationTarget` adds `label`, `context`, `reason`, `owners`, `selectedStored`, `selectedEffective`, `defaultStored`, `defaultEffective` (cells: `string | null`), `defaultRequired`, `eligible`, `unavailableReason`, `expected`. Optional `owners` keys: `parentProductId`, `optionListId`, `menuId`, `rootId`, `sectionId`, `includedMenuId`, `includedRootId`. `TranslationPage = {language: string; config: ContentLanguages; required: string[]; rows: TranslationTarget[]; next: string | null; total: number}`.

Expected tokens encode canonical values, not timestamps or whole-row hashes: reference/selected language, relevant role/activity/owners, selected/default cells and inheritance sources, enabled/default/required settings. Compare decoded structures by values; sort set-like language arrays. Reject malformed tokens. Tokens grant no authority; rederive owners/permissions.

### Exact read model contract

`TranslationContext = {fallbackLanguage: string; required: readonly string[]}`. Each target has
`name: string`, `parent?: {id: string; name: string}`, `reason: TranslationGapReason`,
`selectedText`, `defaultText`, `effectiveSelectedText`, `effectiveDefaultText` (each `string | null`),
`defaultRequired: boolean`, `eligible: boolean`, `unavailableReason: null | "missing" | "inactive" | "ownership" | "role"`,
`owners: TranslationOwners | null`, and `expected: string`.

`TranslationOwners` is a discriminated union keyed by the report kind: product has `parentId: null`;
variant has `parentId`; option_list/extra_list/unit have only kind; option_label has `listId`;
menu has `menuId, rootId`; section has `menuId`; included_menu has
`menuId, sectionId, includedMenuId, includedRootId`. Every id is a string. No owner id is trusted from a request.

Resolved targets are either `{state: "missing"; target: TranslationTarget}` or
`{state: "present"; target: TranslationTarget; names: Record<string,string> | null;
inheritedNames: Record<string,string>; structure: TranslationStructure}`.
`TranslationStructure = {role: string | null; active: boolean; ownerActive: boolean;
rootMatched: boolean; parentRole: string | null; childActive: boolean}`.
Only present, eligible targets reach a names-only writer. Expected values include the selected language, inherited selected/default cells,
selected/default stored/effective cells, ownership/structure and value-normalized configuration;
unrelated names and other aggregate fields are excluded.

## Task 1: Bounded selected-language targets for all nine kinds

**Files:** New catalogue types/targets/tests and `index.ts`.

**Interfaces:** Produce `listTranslationTargets(tx: Transaction, language: string, query: {after?: string; targets?: TranslationRef[]}, context: TranslationContext): Promise<TranslationPage>` and `resolveTranslationTargets(tx: Transaction, language: string, refs: readonly TranslationRef[], context: TranslationContext): Promise<TranslationResolution>`. The exact contracts above apply: resolution holds language/config/required and an ordered targets array. GET explicit lookup is 1–50 refs; domain resolution/PUT is 1–100. Missing targets are a separate state.

- [x] Write cases named `nine target identities`, `activity and ownership`, `default fallback`, `bounded reads`, `stable pages`. Use `useVenueDb`; distinct variant/parent, menu/root, member/section/include ids. Assert partial/absent membership, extras absent omission, units names-only/no activity filter, unavailable option labels still included, either inactive inclusion menu ineligible, wrong roles/owners unavailable, configured/unset default and required-language settings.
- [x] RED: `pnpm --filter @waitron/catalogue exec vitest run src/content-translation-targets.test.ts`. Require the expected missing-read-model failure and Tests count.
- [x] Implement projected SQL gap selection ordered by declared kind order then id, with cursor validation, `LIMIT 50`, and count separately. No all-language report, editors or whole section graph. Explicit-target reads include filled/unavailable/deleted references for review; accept at most 50 per read and forbid combining them with a cursor. Bulk fetch deduplicated target/owner/dependency ids in chunks of 100, statements awaited in sequence. Assert one config read and equal same-kind reads for 1/100 references; pin counts/mixed-kind bound.
- [x] GREEN: repeat RED command and `pnpm --filter @waitron/catalogue exec vitest run src/content-translation-report.test.ts src/content-languages.test.ts`.
- [x] Stage exact task paths; `git commit -s -m "feat: resolve bounded inline translation targets"`. Checkpoint: internal reads and retained report tests green.

## Task 2: Names-only shared-definition commands

**Files:** Catalogue writes/tests.

**Interfaces:** Produce `writeProductTranslation`, `writeVariantTranslation`, `writeOptionListTranslation`, `writeOptionLabelTranslation`, `writeExtraListTranslation`, `writeUnitTranslation`, each `(tx: Transaction, target: ResolvedTranslationTarget, names: Record<string,string>): Promise<void>`; define `ResolvedTranslationTarget` in targets.

- [x] Write `shared named cells preserve aggregates`: exercise six kinds with distinct staff/customer/kitchen text; assert untouched cells and aggregate state unchanged. Add default-companion missing/present controls using the existing product editor, options/extras writers and unit name validation to establish equivalent name rules.
- [x] RED: `pnpm --filter @waitron/catalogue exec vitest run src/content-translation-writes.test.ts`.
- [x] Implement explicit column updates on resolved own ids, never aggregate saves or generic table updates. Validate merged maps through `contentTranslationGap` against the already-read config, preserving domain codes/fields. No per-row config read. Recheck active parent/list and label ownership during resolution; unit writes touch only `name`.
- [x] GREEN: repeat RED command; run `pnpm --filter @waitron/catalogue exec vitest run src/product-editor.test.ts src/options.test.ts src/extras.test.ts src/units.operations.test.ts`.
- [x] `git commit -s -m "feat: write shared translation cells without aggregate reconciliation"` after staging. Checkpoint: six tested commands, no route.

## Task 3: Menu commands and atomic comparison/retry algorithm

**Files:** Extend writes/tests; new catalogue orchestration/tests/errors; `index.ts`.

**Interfaces:** Add `writeMenuTranslation`, `writeSectionTranslation`, `writeIncludedMenuTranslation` with Task 2's signature. Produce `saveContentTranslations(tx: Transaction, language: string, batch: TranslationBatch, context: TranslationContext): Promise<{saved: TranslationTarget[]}>`. Register `content.translation_stale`, `content.translation_unavailable`, `content.translation_batch_invalid`, `content.translation_refused`. Refused params: domain `causeCode`/`causeParams`, kind/id, field (`text`/`defaultText`), language.

- [x] Write `mixed batch rollback`, `cell conflict versus unrelated concurrency`, `equivalent retry`, `root include final maps`. Assert same-cell/owner/role/activity/config changes refuse all writes; reordered sets/maps and concurrent price/other-language changes succeed. Retry the original payload after success and assert canonical results with no writes; one divergent cell refuses the entire retry. Include inherited default, folder-off, foreign label and replaced inclusion cases. Probe root fallback through existing menu/section/include writers configured/unset.
- [x] RED: `pnpm --filter @waitron/catalogue exec vitest run src/content-translations.test.ts src/content-translation-writes.test.ts`.
- [x] Resolve once, merge only requested cells, build all proposed maps before validation. For includes validate effective names as if the folder were on, preserving `showAsFolder`, image/color and other overrides; resolve root through `menu_details.rootSectionId`, section role/owner and both inclusion menus.
- [x] Compare normal requests against baseline dependencies. Permit no-op retry only when **every** intended stored cell equals the canonical request and all other preconditions match. Project this batch's root/default effects into retry dependency baselines; retain ownership/config checks. Accept `defaultText` only for a required, currently missing companion, or an equivalent retry of that companion. Preserve existing defaults; reject gratuitous second-language writes. Validate all targets, then sequentially dispatch the nine commands in the caller's transaction; never recreate missing rows.
- [x] GREEN: repeat RED command; `pnpm --filter @waitron/catalogue exec vitest run src/include-folder.db.test.ts src/sections.db.test.ts src/content-languages.concurrency.test.ts`.
- [x] `git commit -s -m "feat: save translation batches atomically with value comparisons"`. Checkpoint: domain behavior and rollback/read-count receipts.

## Task 4: Authenticated GET/PUT and dashboard transport

**Files:** Server API/tests/mount; dashboard client/live-query files/tests; EN/ES error codes.

**Interfaces:** Mount `GET`/`PUT /management-api/content-translations/:language`; GET accepts `after` or repeated `target=kind:id`. Client methods: `getContentTranslationTargets(language: string, query: TranslationQuery): Promise<TranslationPage>` and `saveContentTranslations(language: string, batch: TranslationBatch): Promise<{saved: TranslationTarget[]}>`; `TranslationQuery` is Task 1's query type.

- [x] Write authenticated nine-kind success/rollback cases, manager success controls beside missing/expired/staff permission refusals; assert permission/session rechecked inside `gated`. Reject unknown fields/kinds, duplicates, nulls, invalid tokens/language/cursor and 0/101 targets. Test GET 50 succeeds/51 refuses and PUT 100 succeeds/101 refuses, 4096/4097 UTF-8 bytes per text, 262144/262145 actual body bytes, absent/false Content-Length and chunked input. Assert domain cause and target/field/language survive client transport.
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/content-translations-api.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/api/live-queries.test.ts`.
- [x] Bound raw body bytes before JSON parsing, including streamed bodies, in this route. Reuse `gated` exactly once; no nested transaction. Keep gap GET unchanged. Dependencies include content_languages, products, option_lists/labels, extra_lists, sections, section_members, **menu_details**, catalogues and units. Audit shipped subscription resources; add no guard exemptions. Add localized stale/unavailable/invalid/refused wording; show preserved domain cause for validation failures.
- [x] GREEN: repeat both commands and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts -t 'missing-translations report|content languages'`.
- [x] `git commit -s -m "feat: expose authenticated translation target and batch routes"`. Checkpoint: complete API.

## Task 5: Staged modal, filters, pages and drafts

**Files:** New dashboard model/dialog/tests; screen/tests; strings.

**Interfaces:** Widget properties `api: DashboardApi`, `language: string`, `open: boolean`; events `translations-closed`, `translations-saved` with `{saved: TranslationTarget[]}`. Model `TranslationDrafts`: `edit(ref: TranslationRef, field: "text" | "defaultText", text: string): void`, `submission(): TranslationBatch`, `validate(): FieldFault[]`, `review(latest: TranslationTarget[], choices: Map<string, "keep" | "replace" | "discard">): void`; `FieldFault = {target: TranslationRef; field: "text" | "defaultText"; message: string}`.

- [x] Write `explicit companion`, `hidden drafts save together`, `empty revert`, `limits and hidden invalid focus`: selected language only, blank companion only for a non-default selection lacking effective default text, no staff copy, whitespace cancellation, companion-only invalidity, untouched omissions, 50-row pages, 100/101 draft boundary, byte limits and Show edited/count. Assert Kind multi-select, Why single-select, context search and retryable field refusals.
- [x] RED: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-model.test.ts src/widgets/content-translations-dialog.test.ts src/screens/content-languages-screen.test.ts`.
- [x] Scan selected-language pages sequentially with passive reads, assembling the opening ordered rows before enabling edits. Apply filters before slicing 50 visible rows; drafts are keyed by kind/id outside that slice. Use `wt-modal`, field primitives, semantic names/language tags/required markers, `part` styling/tokens and bottom form message. At draft capacity keep other rows readable. Explain shared-definition versus membership-override scope, and retain editor links through the leave gate. Wire `draftScopeFor`, `saveActionState` and shared close protection now; commit/close on successful PUT before refresh. Replace the temporary dialog; retain gap-GET completeness.
- [x] GREEN: repeat RED command; `git commit -s -m "feat: stage inline translation drafts across filters and pages"`.

## Task 6: Live review, leave protection and reply generations

**Files:** Dialog/model/tests, new `.unsaved.test.ts`; screen integration tests.

- [x] Write real Chromium cases for edit/revert; Cancel/native close/Escape, navigation/editor links, locale, voluntary logout and unload; Keep/Discard; dirty-before-disconnect/reconnect; late GET/PUT/review replies after reopen. Live arrivals count without insertion; clean departures may leave, dirty departures retain text/focus/unavailable state. Review latest must show old/current/draft and require explicit keep draft/replace with latest/discard edit before accepting a baseline. Fetch retained references in groups of 50 so filled/deleted rows remain reviewable. Complete every passive refresh by scanning all gap pages under one opening generation and snapshot revision, then apply the assembled latest set atomically. Compare enabled/default/required configuration by values on every page; if it changes during the scan, abandon that scan and expose a retryable read failure without touching drafts. A late page never partially replaces rows. Include an arrival/departure on page two and a mid-scan configuration change in the browser cases.
- [x] RED: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.unsaved.test.ts src/widgets/content-translations-dialog.test.ts`.
- [x] Compare normalized submissions to the opening baseline; guard unchanged/busy/invalid saves. Dispose/recreate scope on connection changes without rebasing edited text. Fence reads/actions/review with opening generation plus snapshot revision; newer live data wins over an older explicit read. Watchers assign snapshots only. Separate read/action errors. Keep Task 5's write-success-before-refresh ordering; refresh failures remain load failures. Security teardown invalidates pending decisions/replies.
- [x] GREEN: repeat RED command; assert repeated save sends once, network/stale refusal retains draft and remains retryable, and save-success/refresh-failure closes exactly once. `git commit -s -m "feat: protect translation drafts through live review and reconnect"`.

Task 6 checkpoint, 2026-10-08: real Chromium focused model/dialog/unsaved/screen run
passes 120 cases; three additional real application navigation/locale/logout cases pass
with Keep and Discard. The real PUT/failed-report-refresh case closes once before the
load failure. Full scans retain drafts, fetch edited references in groups of 50 and
reject a mid-scan configuration change. Arrivals stay outside the opening order until
review; dirty missing/filled rows retain text, while Keep cannot adopt a replacement
owner. A changed default clears the old companion only after explicit review, requiring
a new companion instead of moving text between languages. An omitted retained reference
is marked for review until a fresh scan resolves it.

Observed failing controls: missing snapshot/review (6), missing live/review UI (4),
abandoned PUT busy state (1), changed-default/returning-arrival cases (2), omitted
reference (1), stale review error (1), missing unavailable marker/obsolete companion (2)
and hidden review (1). Native-close selector, shell official-language fixture and logout
helper corrections were test setup errors; they are not production-defect receipts.
Installed disposable deletions of reply generation, dirty retention, reconnect baseline
and review-error revision each fail an assertion; restored focused run passes. The
1280/390 EN/ES light/dark matrix passes axe and field/button bounds; 64 dialog captures
include the review choices scrolled into view. Focused root guards (77), unchanged fiscal
pair (20), dashboard types/lint/build and formatting pass. Lit development, experimental
WebCrypto and bundle-size warnings remain in logs. No package coverage or CI claim.

Task 7 still owes shared-name/publication/recorded-sale consumers, its complete installed
control set and opening the built application. Task 8 owns the branch review/push/CI/land.

Task 6 follow-up, 2026-10-08: after the first signed-off checkpoint, the reverse
ordering was reproduced: an old passive scan's refusal replaced a newer successful
explicit review. `old passive scan refusal` failed before fencing each scan read's
refusal by opening and snapshot revision. Current focused run passes 121 cases;
dashboard types/lint/format pass. Deleting that revision comparison in another
installed disposable candidate fails an assertion, restored run passes 121 and the
candidate is removed. This adds no layout or subscription dependency change. The
earlier 120-case receipt remains the measurement of the first checkpoint.

## Task 7: Consumer evidence, deletion controls and visual acceptance

**Files:** Extend `packages/catalogue/src/menu-publication.test.ts`, `product-presentation.test.ts`, `option-snapshot-labels.test.ts`; `apps/server/src/till-api.receipt.test.ts`; new dialog `.a11y.test.ts`; update `docs/developers/products.md` and A420 entry in `docs/backlog.md` when stale.

- [x] Add `inline changes preserve publication and recorded names` in consumer suites. Record a sale first, save translations through the real route, then read back sale descriptions, fiscal record bytes/hash/sequence and invoice counter unchanged. Preview sees edited shared names; already-published version stays identical until explicit publish. Preserve three distinct names in fixtures.
- [x] Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-publication.test.ts src/product-presentation.test.ts src/option-snapshot-labels.test.ts`; `pnpm --filter @waitron/server exec vitest run src/till-api.receipt.test.ts -t 'inline changes|filed identity'`.
- [x] In an installed disposable candidate, delete unchanged-save, ownership, stale comparison, generation and draft protection one at a time. For ownership/stale deletion run Task 3's RED command; for unchanged/generation/draft deletion run Task 6's RED command. Require behavioral failure, then restore and rerun for green, including legitimate-success controls. Restore each deletion before the next. Never swap working-tree files or weaken tests/guards.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.a11y.test.ts src/screens/content-languages-screen.a11y.test.ts`. Inspect EN/ES × light/dark × measured `window.innerWidth` 390/1280, keyboard/caret, long names and loading/empty/invalid/conflict states. Save screenshots under sibling `__screenshots__/`; run axe per state/theme and inspect the images. Check browser memory headroom. Build via `pnpm --filter @waitron/dashboard build` and open the resulting UI. Stop only recorded owned process ids.
- [x] `git commit -s -m "test: verify inline translation consumers and draft protections"`. Checkpoint: ready to run finish-branch.

Task 7 checkpoint, 2026-10-08: the real-store consumer fixture translates all nine kinds,
checks customer/staff/kitchen renderers and both working menus, compares published rows before
explicit publication, then checks that the other menu's publication remains unchanged. A real
filed-sale fixture saves through the authenticated route, retains complete raw sale/line/fiscal/
series/publication rows and reprints the original customer text. Catalogue consumers pass 131;
the selected receipt cases pass 2; route cases pass 53. Installed removals of unchanged-save,
ownership, stale comparison, reply generation and dirty retention each fail assertions. Removing
the selected-language write fails each new consumer case; restoring it passes. The final installed
candidate passes catalogue 242, dashboard 121 and selected receipt 2; source bytes match and the
candidate is removed. No production code changed in Task 7.

The unchanged fiscal pair passes 20; focused root guards pass 138. Types, touched ESLint,
format and dashboard build pass. The EN/ES light/dark matrix at measured 390/1280 passes
36 axe cases; 64 dialog state captures were inspected. The production dashboard build opens,
edits with keyboard/caret preserved and saves in all eight locale/theme/width combinations
against controlled HTTP fixtures. This is a built-client check, separate from the real route
and database acceptance. Fixture corrections were the synthetic Each id, macOS Home key,
retained closed element and an explicit missing-field assertion. Experimental WebCrypto,
Lit development, one test-port fallback and build chunk-size warnings remain in the logs.

Ruling: product-presentation and option-snapshot-label consumers share the new real-store menu
fixture instead of receiving separate databases in their pure suites. Existing assertions in
those suites remain and run alongside it. Cost if wrong: another consumer path may be untested;
the recorded product path is independently exercised by the real receipt case.
Task 8 remains the one Claude review, normal hook, current-head CI and authorised locked landing.

### Existing assertion inventory

Retain catalogue report/API assertions unchanged. In `content-languages-screen.test.ts`, replace multi-language disclosure ordering/expansion and read-only-modal assertions (877, 1415, 1492, 1521) with selected-language opening/loading/reopening checks. Move gap search/filter/link/context/localization/column-stability assertions (822–1179, 1281, 1348) to widget tests, retaining their behavior with staged fields. Replace automatic row removal (927) with separate clean/dirty departure assertions. Preserve completeness/loading/refusal recovery, pinned language actions, receipt warnings and all language-setting tests. Split report-read accessibility (screen `.a11y.test.ts:233`) from target-read accessibility. Re-read names/lines; inventory additional changes, never delete behavioral assertions to fit implementation.

## Task 8: One final review, normal hook, current-head CI; landing locked

- [x] Check clean tree, spec coverage and consumers/prose. Execute finish-branch inline: fetch/rebase feature branch for initial review, capture literal base SHA, build an independent disposable candidate containing the complete tree, install locked dependencies.
- [x] Run one completed Claude whole-branch review through `~/workspace/tools/claude-seat.sh review-run <candidate> <brief> <report>`. Include deletion receipts/unverified claims; require completed findings and experiment results. Fix findings with red/green and `git commit -s`. Do not repeat review solely for later rebases.
- [x] Push through the normal hook once; never bypass it or duplicate whole-workspace package tests locally. Require current-head CI, expected package selections/coverage, resolved conversations and matching SHA. Handle origin/main advances here only: inspect overlap/conflicts; focused checks, hook/CI after required rebases.
- [x] Report ready PR/receipts. **Landing stays locked:** this plan authorizes no merge, main-checkout work or branch cleanup. Hand off to locked landing. End the firing with a clean tree and no owned processes.

## Plan self-check

Coverage: nine kinds 1–3; auth/limits 4; companion/filters/pages/save 3–5; comparisons/retries 3; live/leave/reconnect/generations/write-before-refresh 5–6; aggregates/publications/snapshots/visuals/deletion 2–3/7; review/hook/CI/locked landing 8. No known gaps; runtime, read-count, deletion and visual evidence await execution.

Fresh-context plan review (2026-10-08) found four gaps: resolver language, concrete result fields, separate GET/domain limits and whole-scan live refresh. The contracts above incorporate each finding. Runtime results remain unverified until execution.

Task 1 local checkpoint (2026-10-08): focused 66 cases, fiscal 20 unedited, root 97, scoped types/lint/format passed. Restricted read-model coverage 100/98.16/100/100; this is not package or CI coverage. Four installed safeguard removals failed at their intended assertions; restored focused 66 passed. Tasks 2–8 remain unbuilt; no route or editable dialog is exposed.

Task 2 local checkpoint (2026-10-08): six shared-definition commands merge names and validate
against the configuration carried by the internal resolved target. Focused 206, fiscal 20 unedited
and root 3605 checks passed, with scoped types/lint/format. Restricted writer coverage
100/100/100/100 is not package or CI coverage. Four installed removals failed at their intended
assertions; restored read/write suites passed 47 cases. Existing assertions are unchanged.
Tasks 3–8 remain unbuilt; no route or editable dialog is exposed.


Task 3 local checkpoint (2026-10-08): all nine names-only commands and atomic domain saves
are built. The expected token now records the selected language and inherited selected/default
cells. Batch retries project this batch's root/default effects and issue no updates; conflicts
retain their target identity. Default-name refusals preserve the existing domain code/params.
Five installed safeguard removals failed as expected (four controls produced assertion failures; root-projection
removal refused the valid joint save); restored suites passed 111 cases. Restricted source
coverage 99.56/97.5/100/100 is not package or CI coverage. Existing assertions remain unchanged.
The authenticated route, staged dialog and Tasks 4–8 remain unbuilt.


Task 4 local checkpoint (2026-10-08): authenticated selected-language GET/PUT routes,
dashboard transport, ten live dependencies (including menu_details) and EN/ES refusal wording
are built. Route tests exercise all nine kinds, atomic refusal, equivalent retry, queued/upload-time
manager checks, GET 50/51, PUT 100/101, 4096/4097 text bytes and 262144/262145 actual body bytes
with absent or false Content-Length and streamed chunks. The client preserves validation cause,
target, field and language; displaying the cause beside staged fields remains Task 5.
The staged dialog, live review, unsaved protection and consumer/visual acceptance remain Tasks 5–7.
Task 4 receipts: repaired installed-base RED51; final route53/dashboard338/domain111,
unchanged report/language3, root102 and unedited fiscal20 cases passed. Scoped types/lint/format
passed. Restricted route coverage is 100/100/100/100 (55 statements, 30 branches, 12 functions,
51 lines), not package or CI coverage. Three installed removals failed their assertions;
restored route53 passed. No existing behavioral assertion changed; no visible UI changed.

Task 5 checkpoint (2026-10-08): staged dialog/model and screen integration built locally.
The focused model/dialog/unsaved/screen run passed 91 cases. The 390px field-bounds
check first failed with an input beyond the table edge, then passed after combining each
row's name and fields in a responsive cell. Default-companion, name-byte and close-guard
removals failed in an installed independent candidate; restored suites passed 91 cases.
Task 6 still supplies `review`, complete live/leave/reconnect/reply handling; Task 7
still supplies recorded-name consumer checks and built-app visual acceptance. Task 5
uses shared close protection now and covers its basic Close/Escape/Keep/Discard path.
Receipts are local to lane E under `receipts/a420-part2/task5-*`.

Task 8 review checkpoint, 2026-10-08: the completed Claude run-it review took 608 seconds.
Live departures reproduced an empty last page; the callback now clamps the page. A second
failing case reproduced a disappearing unresolved review; passive snapshots now show the
newest current values while retaining the draft and requiring an explicit choice. Reopen
and reconnect refusal tests catch deletion of the late-save guard. Full application editor
links and fields for a newly added language are exercised. Five installed controls each fail
assertions; restored candidate dialog126 and shell4 pass. The misplaced error-code comment
was deleted. The unset menu-root fallback remains a separate backlog entry. Normal push
and current-head CI still own the final gate; landing uses the runner's authorised lock.

Task 8 landing checkpoint, 2026-10-08: PR [#1456](https://github.com/clintongormley/waitron/pull/1456)
landed by squash as `145eac9c34cfcab7e807ecebcdef0a0ef1ab43b7`. The normal push hook passed;
CI run `37828296772` completed successfully on candidate
`6c864e4b36350b29a7755a4d6232edad07e55719`. Its changed scope selected catalogue, dashboard
and server, with their consumers; catalogue, dashboard and merged server coverage passed.
The licence and sign-off run also passed, and there were no review conversations.

The owner and runner separately authorised landing. The runner's shared lock was held
through the merge, main update, dependency install and feature worktree/branch cleanup.
Main had advanced only in purchasing code and the backlog; the only overlap was the backlog,
so the documented BEHIND exception applied. The merge's own CI run `37829876544` exists
for the exact squash SHA; it was still queued at this checkpoint. The completed A420 backlog
entry was removed in the feature change. The unset menu-root fallback remains a separate
open decision; the media-name and section-address follow-ups remain open too.
