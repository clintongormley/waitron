# UI navigation and controls implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the form task and review; execute the remaining integration work in this session. Track the test cycle for each task below.

**Goal:** Keep your selected destination through browser navigation and refresh, submit ordinary forms with Enter, and show a consistently positioned, readable language chooser throughout the UI.

**Architecture:** Keep navigation in each app's existing state machine, synchronising validated destination identifiers with URL path segments. Share keyboard submission behavior in `@waitron/ui`, with explicit form boundaries. Use the existing language registry for labels before the options load and a common bottom-right placement for existing language controls.

**Tech stack:** TypeScript, Lit, Vitest browser mode with Chromium.

**Spec:** The owner's requirements in this conversation, approved for all UI on 2026-09-06.

## Global constraints

- Apply across till, dashboard and setup wherever the relevant UI exists.
- Preserve authentication, role, device capability, and submission validation checks.
- Enter in multiline fields inserts a newline; Enter in a selector selects an option. Ignore composition, key repeat and modified Enter for implicit submission.
- Record navigation only in the URL, never passwords, pairing codes, PINs or form drafts.
- A missing or unavailable tab falls back to the current app's permitted default.
- Run failing tests before implementation. Never run browser suites concurrently.
- Existing setup has no language chooser or translated UI; the language work applies to the existing till/dashboard choosers. Setup's forms remain in scope.
- A wizard step is not a tab. Do not persist sensitive setup drafts or make provisioning repeat through history navigation.

### Task 1: Enter submits ordinary forms

**Files:** `packages/ui/src/` shared helper and browser tests; form-bearing screens and widgets under `apps/till/src/`, `apps/dashboard/src/`, `apps/setup/src/`; `docs/developers/design-system.md`.

**Interface:** An explicitly scoped Enter handler routes to the same action as the form's submit button, respecting disabled and busy states. Export the helper through `packages/ui/src/index.ts`. Do not infer an action by searching for the first primary button on an arbitrary screen.

- [x] Inventory every input-bearing component and identify its form boundary and submit action, or record why it is a live filter/editor rather than a form.
- [x] Add browser tests pressing Enter in real shadow inputs. Verify one submit with the current field values; verify multiline/select controls and disabled/in-flight submissions do not trigger it. Include login, device pairing, a dashboard edit form and a setup step.
- [x] Run each affected test before implementation and record its expected failure.
- [x] Implement the shared helper and explicit per-form wiring. Preserve existing click behavior and validation.
- [x] Run targeted tests and typechecks; give the controller the test commands/results and inventory. Package coverage runs are serialised by the controller.

### Task 2: Readable language controls in one position

**Files:** both `apps/{till,dashboard}/src/widgets/language-chooser.ts`, their tests, their hosting shells/screens and relevant layout tests.

**Interface:** Continue emitting `locale-selected` with `{ code }`; retain server-provided options and preference persistence.

- [x] Test that a freshly rendered English chooser displays `English` before opening; a Spanish chooser displays `Español`. Existing lazy option loading still works.
- [x] Test menu placement above the bottom-right trigger in a narrow viewport.
- [x] Use `SUPPORTED_LOCALES` to resolve the initial label. Position the chooser consistently and reserve room so it does not cover content; ensure enrolment and logged-in screens have a chooser.
- [x] Run the relevant widget and shell browser tests.

### Task 3: URL-backed navigation

**Files:** `apps/dashboard/src/dashboard-app.ts`, `apps/till/src/till-app.ts`, navigation tests and any shared URL controller in `packages/ui/src/`; dashboard nested tab screens where applicable.

**Interface:** Use app paths (`/manage/<section>` and `/tabs/<key>`), preserving unrelated query parameters. Only meaningful navigation pushes history; menu choices use browser session storage. Restoring history never pushes another entry. Restore only after the app has enough information to validate the requested tab.

- [x] Trace every assignment and consumer of screen/tab state before changing it.
- [x] Add browser tests for initial URL restoration, refreshing by recreating the app, tab changes, actual Back/Forward events, unavailable tabs and restricted sessions.
- [x] Run those tests and observe the absent URL behavior fail.
- [x] Wire URL reads/writes through the existing navigation/data-loading paths; detach history listeners on disconnect. Preserve the requested till tab through PIN login.
- [x] Run unfiltered package coverage and typechecks.

### Task 4: Integration review and verification

- [x] Review the full diff for old-behavior claims in docs and comments and update `docs/ui-review.md`.
- [x] Review the form inventory against all UI inputs and the navigation inventory against all actual tab controls.
- [x] Run lint, typecheck, format check and the appropriate tests. Run UI, till, dashboard and setup coverage sequentially.
- [x] Review the resulting diff independently and resolve actionable findings.

## Verification — 2026-09-06

All four browser packages passed their unfiltered `test:coverage` commands, run sequentially:

| Package | Tests | Statements / lines | Functions | Branches |
| --- | ---: | ---: | ---: | ---: |
| `@waitron/ui` | 271 | 97.65% | 98.55% | 94.21% |
| `@waitron/till` | 1211 | 99.30% | 98.83% | 96.93% |
| `@waitron/dashboard` | 1356 | 99.38% | 99.26% | 95.59% |
| `@waitron/setup` | 198 | 100% | 100% | 96.87% |

`pnpm exec vitest run --coverage` passed the root's 1008 tests and coverage thresholds.
`pnpm lint`, `pnpm typecheck` and `pnpm format:check` passed; the four changed packages'
typechecks were repeated after the final edits. This is scoped test verification, not a run of
`pnpm test` across the whole workspace.

Independent forms and integration reviews are complete, with their actionable findings fixed.
Regression tests cover duplicate submission, canvas navigation/save races and preserving a pairing
code while changing language. Narrow viewport tests check menu bounds and content clearance.
The first full dashboard coverage run exposed URL state leaking between accessibility tests;
shared cleanup now restores the initial URL after unmounting, and all original assertions pass.

The owner subsequently requested finish-branch review; see the follow-up below.

## Follow-up requirements — 2026-09-06

The owner requested paths instead of query parameters and history entries only for meaningful
navigation. Payment steps and modifier dialogs remain transient. The menu ID moves into browser
session storage as the last menu viewed within a login; it persists through new and parked orders.
Every successful login resets it to the default, including the PIN login after refresh. Automatic
return home after a completed sale replaces history.

The original query-based verification above records the first implementation. Follow-up path and
session tests and production refresh routing passed the checks below.


### Follow-up verification

Unfiltered coverage passed sequentially for the browser packages:

| Package | Tests | Statements / lines | Functions | Branches |
| --- | ---: | ---: | ---: | ---: |
| `@waitron/ui` | 279 | 97.77% | 98.63% | 94.36% |
| `@waitron/till` | 1216 | 99.24% | 98.67% | 97.03% |
| `@waitron/dashboard` | 1358 | 99.38% | 99.26% | 95.66% |
| `@waitron/setup` | 198 | 100% | 100% | 96.87% |
| `@waitron/server` | 2534 | 99.11% | 99.17% | 98.34% |

Commands: `pnpm --filter <package> test:coverage`; the server run used
`TESTCONTAINERS_RYUK_DISABLED=true` and the real Docker test database. Root coverage passed all
1008 tests. Whole-workspace lint and format checks and the changed packages' typechecks passed.

Both production builds passed. A headless Chromium smoke test served the built bundles through
`mountSpa`, loaded and reloaded `/manage/staff`, `/manage/floor/view/plano/zone/z1`,
`/tabs/floor/zone/z1` and `/?dev`, and found their expected app elements with no page errors.
The smoke used unauthenticated API responses; authenticated path restoration is covered by the
browser suites. The till build initially rejected the developer chooser's top-level `await` at
`apps/till/src/main.ts:30` (introduced in `e31f65ae5`, verified with `git blame`). The lazy import now
renders through its promise callback, preserving the configured build target.

Independent review found and verified fixes for unavailable canvas history destinations, detached
logins overwriting session preferences, and Back/Forward during asynchronous login data loading.
Payment and modifier tests assert that their interactions do not call history methods; the menu
preference survives parking and new orders. Explicit tab selection still pushes history.
The owner subsequently specified that every new login resets the menu to the default; the updated
regressions cover stored preferences, same-person re-login and a different operator.

The owner subsequently requested finish-branch review. The final workspace gate and PR preparation follow that review.


### Login reset verification — 2026-09-06

The three login-reset regressions failed before implementation (214 passed, 3 failed). After the
change, `pnpm --filter @waitron/till test:coverage` passed all 1218 tests and coverage thresholds.
Till typecheck and production build, workspace lint and format check passed. Independent review
found no functional issues. The reset includes logging in as the same person after logout.


### Remember dietary filters — 2026-09-06

Owner extension: remember vegetarian and the other dietary filters under the same login boundary
as the menu. The app owns the selected predicate, shared by counter and table-order screens,
including embedded cards. Screen changes and new/parked orders retain it; a new login resets to no
filter. Session storage records the selection without affecting history or basket contents.

Regression cycle: all four predicate navigation cases, table-order sharing and payment/new-order
retention failed before the change (6 failures in the app suite); the embedded card regression also
failed. After implementation all 341 targeted tests passed. Additional regressions exercise blocked storage
and a detached login completing after the live app chose a filter. Unfiltered till coverage passed
all 1226 tests; till typecheck and production build passed. Independent review found no actionable
issues. Workspace lint and formatting passed.


### Finish-branch corrections — 2026-09-06

Regular till destinations have nested paths: `/tabs/<key>/view/schedule`, `/view/station`,
`/view/expo` and `/view/allergens`. Kitchen station selection adds `/station/<id>`. Login and
history restoration validate the destination against the current device and its available screens;
station restoration validates the ID against the loaded station list. Embedded station cards keep
their selections local, and enrolled kitchen displays retain their bound station. Payment steps,
modifier dialogs, menu/filter choices and unfinished forms remain outside navigation history.

Saved canvas tab keys determine which selections can enter a path. Adding or reselecting an
unsaved tab stays local; completing a save updates the saved keys for that editor. Device-profile
Save now guards synchronously against Enter followed immediately by a click, with retry available
after a rejected write. Language-placement test names now describe the shell they actually query;
the historical language spec and heavy-screen plan point to the superseding bottom-right decision.

The finish-branch controller ran the whole-workspace gate after these corrections; the result is recorded below.


Scoped fix verification: `pnpm --filter @waitron/till test:coverage` passed 1,242 tests in 67 files
(99.25% statements/lines, 98.68% functions, 96.95% branches). The dashboard command passed 1,362 tests
in 95 files (99.38% statements/lines, 99.26% functions, 95.70% branches). These browser runs were
serial. Both packages' `typecheck` commands and the changed source files' Prettier checks passed.
The regression tests first reproduced the missing till destination and station paths, stale queue
restoration, duplicate profile dispatch and unsaved canvas tab URL. These are the scoped verification results.


### Whole-workspace verification — 2026-09-06

After the review corrections, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm test`
all exited 0. The run used `TESTCONTAINERS_RYUK_DISABLED=true` and
`npm_config_workspace_concurrency=1`; `pnpm config get workspace-concurrency` returned `1` with
that setting. `pnpm reap` removed no stale containers before the gate. The complete test command
ran for 435 seconds, including the root tests and every package test script, and ended with all
2,534 server tests passing. This receipt precedes the finish workflow's rebase and pre-push hook.
