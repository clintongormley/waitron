# A331 — a form's Save stays quiet and disabled until something changes

Owner, 2026-10-07 ~12:05: "open a form with the Save button transparent (and disabled?). but as soon
as you make a change, make the Save button active/blue". ~13:10: "this should be global". The full
item, with the owner's interaction rules, is A331 in lane B's queue; this plan is its runbook.

**Goal.** Every form in Waitron that saves opens with its primary action (Save, Create, Add…)
disabled and drawn in the quiet `secondary` style. As soon as the draft differs from what was
opened, the action is enabled and drawn `primary` (blue). Undoing the change back to the opened
values makes it quiet and disabled again.

**Rules carried from the item (do not re-decide them):**

- "Changed" is what the screen's draft scope already says (`DraftScope.isDirty()`,
  `packages/ui-core/src/unsaved-changes.ts`), not a second hand-written comparison per screen.
- The form-error contract (`docs/developers/design-system.md` → Forms) is unchanged for a CHANGED
  form: errors beside fields after the first press, one message above the buttons, the action
  disabled while the form's own checks fail. A refusal from a request never disables the action by
  itself (owner, 2026-09-29) — a refused save leaves the draft changed, so the action stays enabled.
- A create form with nothing typed counts as unchanged.
- A form whose OPENED state is already savable (a duplicate, or a pre-filled value the operator must
  confirm) must not be stuck disabled: it treats its opened state as a change. Each batch names
  any such screen.
- Disabled means `disabled` on `wt-button`, not only a look.
- A second action that saves by itself (the product editor's "Enable" on an inactive product) is not
  the form's primary action and is not gated: pressing it IS the change. Each batch names any such
  action.
- The setup wizard's step navigation (Continue/Next) is not a save; a sign-in is not a save.

## Batches — one pull request each, in this order

1. **Shared mechanism + the product and variant editors** (this plan's tasks 1–4).
2. Dashboard catalogue and menus forms (`apps/dashboard/src/widgets/*-form.ts`, `recipe-editor`,
   `section-*`, `include-folder-form`, `add-to-menus`, `image-upload`, `catalogue-browser`,
   `catalogue-settings-panel`, `units-screen`, `menus-screen`, `menu-publications`).
3. The rest of the dashboard's draft-scope screens (`git grep -ln leaveCoordinatorFor apps/dashboard/src`
   less batches 1–2).
4. Module screens: `packages/venue-service`, `packages/payments-stripe`, `packages/payments-sumup`,
   `packages/adjustments`, `packages/bookings`, `packages/media`.
5. `apps/till` — many of its dialogs take an action (pay, refund, find, override) rather than save an
   edit; the batch says which are saves.
6. `apps/setup` — only the steps that edit something already stored.
7. Save-type forms with NO draft scope, and string-rendered pages served by `apps/server` or the
   print agent that have a Save: bring each under the rule or list it with the reason.

Each later batch gets a short task list appended here before it starts, reviewed once.

## Batch 1

Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-save-follows-changes`, branch
`feat/save-follows-changes`. Reviewed once by a fresh-context reader (2026-10-07); its findings are
folded in below.

**What batch 1 found about already-savable openings:** `git grep -n -i duplicat` over
`catalogue-screen.ts`, `product-editor.ts` and `catalogue-browser.ts` finds no duplicate or clone
flow, so no batch-1 form opens already savable. The one ungated action is the product editor's
"Enable" (`data-test="restore"`, `save(event, true)`).

**Two facts the tasks rest on** (read 2026-10-07):

- Every widget test mounts its widget WITHOUT an application coordinator
  (`apps/dashboard/src/widgets/test-helpers.ts` ~42–60), so `leaveCoordinatorFor(this)?.register(…)`
  gives no scope there. Both editors also use "a scope exists" to mean "a coordinator exists": Cancel
  calls `requestClose` only with a scope (`product-editor.ts` ~942, `variant-form.ts` ~156), and
  `beforeClose` is bound only with one (`product-editor.ts` ~1863, `variant-form.ts` ~242), and the
  guard reads `this.#leave!` (`product-editor.ts` ~445–447, `variant-form.ts` ~74–76). So the
  coordinator and the scope are handed back SEPARATELY, and the leave paths keep gating on the
  coordinator.
- Tests press Save with `.click()` on the `wt-button` host. Measured by the plan reviewer in
  Playwright's Chromium: a host `.click()` reaches the host's click listener even while the inner
  `<button>` is disabled. So `disabled` alone stops a person but not a test, and a test that presses
  Save on an untouched form stays green. Each save handler therefore also returns early while
  unchanged; that makes every such test fail loudly, and the failures ARE the "Changed test checks".

### Task 1 — the shared mechanism (`packages/ui-core`, `packages/ui`)

1. `packages/ui-core/src/unsaved-changes.ts`: export `trackDraft<T>(owner: DraftOwner<T>):
   DraftScope<T>` — the same baseline/`equal`/`commit`/`dispose` behaviour a coordinator's
   `register` gives, with no leave question and no `beforeunload`. Share the baseline logic with
   `register` rather than copying it. Tests in `unsaved-changes.test.ts`: unchanged at start; dirty
   after the owner's value changes; clean again when changed back; `commit(v)` makes `v` the new
   baseline; `dispose()` makes it clean for good; it adds no `beforeunload` listener.
2. `packages/ui/src/leave-controller.ts`: export `draftScopeFor<T>(host: HTMLElement, owner:
   DraftOwner<T>): { coordinator: LeaveCoordinator | undefined; scope: DraftScope<T> }` — the
   coordinator from `leaveCoordinatorFor(host)`, and its `register(owner)` or, with none,
   `trackDraft(owner)`. The returned scope's `commit` and `dispose` also call
   `host.requestUpdate()` when the host has one, because a baseline is not a reactive property and a
   form that stays open after a save must redraw its Save quiet. Export `draftScopeFor` and
   `DraftOwner` (beside `DraftScope`) from `packages/ui/src/index.ts`. Tests: with a
   `LeaveController` above, `coordinator` is set and the leave question still fires for a dirty
   draft; without, `coordinator` is undefined and the scope still reports dirty/clean; `commit`
   requests an update.
3. Beside it, export `saveActionState(scope: Pick<DraftScope<unknown>, "isDirty"> | undefined,
   options?: { savableAtOpen?: boolean }): { variant: "primary" | "secondary"; unchanged: boolean }`.
   `unchanged` is `!(options?.savableAtOpen || scope?.isDirty())`; `variant` is `secondary` when
   unchanged, else `primary`. A screen binds `variant=${s.variant}` and
   `?disabled=${s.unchanged || <its existing conditions>}`, and its save handler returns early while
   `s.unchanged`. A changed form that is blocked (invalid, busy, a nested window open) stays drawn
   `primary` and disabled. Unit tests for every combination (ui and ui-core are mutation-tested at
   90, in the weekly run: thin tests pass the PR and fail on Monday).
4. Docs, as the owner decision dated 2026-10-07:
   - `docs/developers/design-system.md` → Forms: add the rule, naming `draftScopeFor`,
     `saveActionState` and the early return. Reword the lines it contradicts: "Only the form's own
     checks ever disable the action" (~1471), "the primary action works until the first submission"
     (~1478), and "reopening or resetting a form starts it again: no messages, the action enabled"
     (~1507). Leave the sign-in example snippet (~1539–1555) alone — a sign-in is not a save — and
     add a separate short save-form snippet. State what a blocked change looks like (primary,
     disabled).
   - `docs/developers/conventions-ui.md`'s forms entry (~11–15) and the forms line in the root
     `CLAUDE.md` §3: one added clause each with the decision and a pointer.

Checks: `pnpm --filter @waitron/ui-core exec vitest run src/unsaved-changes.test.ts`,
`pnpm --filter @waitron/ui exec vitest run src/leave-controller` (or the file the tests land in),
both packages' `typecheck`, `pnpm format:check`, `pnpm lint`. Prove each new check by deletion.

### Task 2a — the product editor: wire it and test it (`apps/dashboard/src/widgets/product-editor.ts`)

1. Replace the registration with `draftScopeFor(this, …)` (same owner object): `#leave` takes
   `coordinator`, `#draftScope` takes `scope`. Every leave path (Cancel's `requestClose`,
   `beforeClose`, `#beforeClose`) gates on `#leave`, not on `#draftScope`.
2. Bind the Save button (`data-test="save"`; today `variant` is unset, so it is `secondary` by
   `wt-button`'s default, `wt-button.ts` ~113) to `saveActionState(this.#draftScope)`. "Enable"
   (`data-test="restore"`) is not gated.
3. Tests first, in real Chromium (a new `product-editor.save-state.test.ts`): an existing product,
   FULLY filled (translated names incl. a regional code, a price like `9.00`, dietary marks,
   variants), opens with Save `disabled` on the host AND on its inner `<button>`, and
   `variant="secondary"`; so do an inactive product (its Enable enabled) and a variant's own page
   (`value.inherited`); a new product with nothing typed opens disabled; one edit makes Save enabled
   and `primary`; typing the original value back makes it disabled and `secondary` again; a changed
   but invalid form still shows its errors after a press and keeps Save disabled (primary) until
   fixed; after a refused save (`fieldErrors` set) Save stays enabled. In
   `product-editor.unsaved.test.ts` (which has a `LeaveController` above): edit, then `commitSaved`
   with the editor still open, and Save goes quiet and disabled; edit, Cancel, Discard, and Save is
   quiet if the editor is reopened. Prove "cannot save" with the handler's early return (no
   `wt-submit`) or a real pointer click on the inner button, never only an outer `.click()`.
4. `product-editor.a11y.test.ts`: axe on the unchanged and the changed state, both themes. Its
   "errors" state (~231, mounted empty ~155) presses Save on an untouched form: make one edit first
   and list it under "Changed test checks".
5. Checks: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.save-state
   src/widgets/product-editor.unsaved src/widgets/product-editor.a11y`, dashboard `typecheck`.
   Commit.

### Task 2b — the product editor: the early return, and the tests it changes

1. `save()` returns early while `saveActionState(this.#draftScope).unchanged`, except the Enable
   path (`save(event, true)`). Test first: an untouched form's Save press sends no `wt-submit`.
2. Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor
   src/screens/catalogue-screen src/screens/modifier-owners.unsaved src/screens/unit-owners.unsaved
   src/state/product-child-create`. Each test that now fails because it pressed Save on an untouched
   form gets one edit before the press, or asserts the disabled state instead — the reviewer
   predicted, among others, `product-editor.test.ts` ~888–896, ~1020–1035, ~1068–1075, ~2666–2677,
   ~3075–3085. A failure for any OTHER reason is a regression signal: stop and report it. List each
   change (`file:line`, before → after) in the ledger for the PR's "Changed test checks".
3. Checks: the run above green, dashboard `typecheck`, `pnpm format:check`, `pnpm lint`. Commit.

### Task 3 — the variant form (`apps/dashboard/src/widgets/variant-form.ts`)

Same as Tasks 2a and 2b for `data-test="variant-save"`: register through `draftScopeFor` (the scope
keeps `parent: this.draftParent`; leave paths gate on the coordinator, ~74–76, ~156, ~242); REPLACE
its fixed `variant="primary"` (~321) with the helper's; `#save` returns early while unchanged.
Tests: an existing variant opens disabled/secondary; Add variant with nothing typed opens disabled;
one edit enables it; undo disables it; axe both states, both themes (`variant-form.a11y.test.ts` —
its "errors" state ~54–58 mounts empty and clicks Save: make one edit first, list it). Run
`src/widgets/variant-form` and `src/widgets/product-editor` again (the editor opens the form), plus
dashboard `typecheck`, `pnpm format:check`, `pnpm lint`; list every changed check.

### Task 4 — look, docs, backlog

LOOK at the product editor and the variant form, unchanged and changed, EN and ES, light and dark,
desktop and 390px (`wa-wt demo waitron-feat-save-follows-changes`; check port 8080 and the venue
folder's holders first), and watch Save as the dialog closes after a save. Add an A331 entry to
`docs/backlog.md` saying batch 1 landed and listing batches 2–7 as open. The queue-side FYI on
changed checks goes in lane B's `questions.md`.

`isDirty()` in `render()` deep-copies the product draft about three times per keystroke
(`currentValue`, and `submissionValue` on both sides of the comparison). It is small; if the look
shows typing lag, cache the result per update.

Then `/finish-branch` (light path: no migration, no risk trigger).

## Batch order change (2026-10-08)

Batch 2 waits: lane A's open #1392 (A347) changes `catalogue-browser.ts` and `menus-screen.ts`, and
lane A's next menus items change the same area. Batch 3 overlaps no open pull request, so it goes
first, split in two pull requests: **3a** (venue settings, service and people, below) and **3b**
(printers, devices, device profiles, payments, canvases — task list appended when 3a lands).
`login-screen.ts` is excluded: every action on it is a sign-in, not a save.

## Batch 3a — venue settings, service and people (13 files)

Branch `feat/save-follows-changes-venue`. The pattern is batch 1's, copied from
`apps/dashboard/src/widgets/variant-form.ts` (~113, ~169, ~240, ~325) and its
`variant-form.save-state.test.ts`.

**Rules for every task (read before each):**

- Every `leaveCoordinatorFor(this)?.register(owner)` / `coordinator.register(owner)` that backs a
  gated Save becomes `draftScopeFor(this, owner)`. A scope that today exists only when a coordinator
  exists (an early `return` on no coordinator, or `?.register`) must exist without one too, or Save
  is stuck disabled in every widget test (`saveActionState(undefined)` is `unchanged`). Every leave
  path (Cancel's `requestClose`, `beforeClose`, an `if (!scope) proceed()`) keeps gating on the
  COORDINATOR, never on "a scope exists".
- Save binds `variant=${s.variant}` (replacing a fixed `variant="primary"`, or adding one where none
  is set) and `?disabled=${s.unchanged || <its existing conditions>}`; its handler returns early
  while `s.unchanged`. A changed form that its own checks block stays drawn primary and disabled.
- Where one Save covers several scopes, pass `{ isDirty: () => a.isDirty() || b.isDirty() }`
  (a scope's `isDirty()` covers itself only).
- Immediate actions (deactivate, test, acknowledge, resend invitation, a download) are not gated.
- Tests first, in real Chromium, in a new `<file>.save-state.test.ts` beside the screen: opens with
  Save `disabled` on the host AND its inner `<button>` and `variant="secondary"` (a PRE-FILLED form
  is the case that matters: fill every field it shows, in the spellings a stored value comes back
  in); one edit makes it enabled and `primary`; typing the original value back makes it disabled
  and `secondary`; an untouched Save press sends nothing (the early return — prove "cannot save"
  by the handler's absence of a request/event, or a real pointer click on the inner button, never
  only an outer `.click()`); after a save that leaves the form open, Save is quiet again. Axe both
  states, both themes: in the screen's existing `*.a11y.test.ts` where one exists, otherwise in
  the new file. Prove the gate by deletion (drop `s.unchanged ||` and the early return; the new
  cases fail; restore).
- Then run the screen's existing suites (named per task). A test that fails because it pressed
  Save on an untouched form gets one edit before the press, or asserts the disabled state instead
  — at least as strict as before; list each (`file:line`, before → after) in the SDD ledger for the
  PR's "Changed test checks". A failure for any OTHER reason is a regression: stop and report it.
  An "empty submit shows errors" test on a create form becomes: type something invalid, then press
  (the empty form now cannot be pressed).
- Once a scope always exists, every place where "a scope exists" stands in for "a coordinator
  exists" breaks: `.beforeClose` gets bound and `this.#leave!.request` throws on Escape, Cancel or
  close in every widget test. Each task lists the ones the plan reviewer found; grep for more.
- A branch the gate makes unreachable (an "empty change closes the form" or "empty label returns"
  early exit) is deleted, so the coverage bar holds; a test of it is a changed check.
- A changed create form whose own checks still fail keeps its action disabled: where a handler
  silently returns on a missing required field, add that condition to `?disabled`.
- Each task ends with `pnpm --filter @waitron/dashboard typecheck`, `pnpm format:check`,
  `pnpm lint`, and a `git commit -s`. An implementer passing ~80 tool calls with the task unfinished
  commits at a green point and hands over.

**Forms that open already savable:** `git grep -n -i 'duplicat\|clone\|prefill'` over the 13 files
finds only backup's `#prefillFromStatus` (an edit form), so no 3a form passes `savableAtOpen`.
(2026-10-08: superseded in 3a.4a — the backup settings editor passes `savableAtOpen` when the
stored schedule is not a wall-clock one or no retention is stored; see design-system.md → Forms.)

### Task 3a.1 — floor and service status (`floor-screen.ts`, `service-status-screen.ts`)

Both hold an inline "new" form (`#newScope`) and one scope per existing row registered in a loop
(floor ~198, service status ~135). Each row's Save (`table-save-${id}`, `save-${id}`) gates on its
OWN row scope; the add action (floor's `data-add-table` button ~646, service status `add` ~423)
gates on `#newScope`. Rewrite the row loops to `draftScopeFor`; floor's `#acceptTables` (~183) and
service status's `#acceptRows` (~125) and `#registerNew` (~92) return early without a coordinator —
make the scopes exist without one. Immediate, not gated: `deactivate`, `table-deactivate-*`,
`table-enable`, and floor's zone dropdown (it saves when a zone is picked). Service status: a
colour-only change makes `#newScope` changed while `#create` returns on an empty label (~236) —
add the empty label to `add`'s `?disabled`. Floor's `#createTable` `if (label === "") return`
becomes unreachable: delete it. Suites: `src/screens/floor-screen src/screens/service-status-screen
src/dashboard-app.venue-settings-unsaved src/dashboard-app.settings-panels`.

### Task 3a.2a — kitchen timing and venue details

- `kitchen-screen.ts`: `save-timing` (~354, no variant today) on `#timingScope` (~203).
  `#cancelTiming` (~160) does `if (!this.#timingScope) proceed()` then `this.#leave!`: gate it on
  the coordinator.
- `venue-details-panel.ts`: `save` (~562) on `#scope` (~184); `#registerDraft` (~182) returns early
  without a coordinator — fix it (`#requestCancel` already gates on `!this.#leave`). `#save`'s
  empty-patch branch (~382–385, closes the form) becomes unreachable: delete it, and list any
  "Save untouched closes the editor" test as a changed check. `acknowledge` is immediate.
Suites: `src/screens/kitchen-screen src/screens/venue-details-panel
src/dashboard-app.venue-settings-unsaved src/dashboard-app.settings-panels` (and any other test
that mounts the panel: `git grep -l venue-details-panel apps/dashboard/src`).

### Task 3a.2b — my schedule (`my-schedule-screen.ts`)

`cover-submit` (~514) and `abs-submit` (~611) on their own scopes (~170, ~181). Both are
submissions of staged input, so both are gated. `accept-*` is immediate. Suites:
`src/screens/my-schedule-screen src/dashboard-app.schedule-unsaved`.

### Task 3a.3 — receipts (`receipts-screen.ts`)

One `save` (~1084) covers three child scopes (language ~220, description ~237, trim ~257), each
registered only after its read arrives: gate on `trim?.isDirty() || language?.isDirty() ||
description?.isDirty()` (with `draftScopeFor`, so each exists without a coordinator once read).
`this.#dirty = this.#descriptionScope?.isDirty() ?? true` (~1071) loses its fallback: drop the
`?? true`. `use-fixed-language` is immediate. Its seven test files press Save about 54 times;
`receipts-screen.location.test.ts` alone presses an untouched Save in about 5 tests (~163, ~183,
~365, ~379). This task is the largest of the batch: commit at a green point and hand over if it
nears ~80 tool calls. Suites: `src/screens/receipts-screen src/dashboard-app.venue-settings-unsaved`.

### Task 3a.4a — backup (`backup-screen.ts`)

`apply` (~1007, `#archiveScope` ~293, which re-registers per mode) and `save-settings` (~1034,
pre-filled by `#prefillFromStatus`) are gated. `#trackArchive` (~282) returns early on
`!this.#leave`: make the scope exist without one. Immediate, not gated: `rotate-confirm`,
`configuration-export` (`#exportScope` ~335 backs a download's passphrase), `show-old-key`,
`copy-key`. Many tests press `save-settings` on an untouched pre-filled form
(`backup-screen.test.ts` ~1038, ~1049, ~1257; `backup-screen.a11y.test.ts` ~172). "prefills picked
weekdays and a fixed time, and re-applies them unchanged" (~1262) becomes: the pre-filled form
opens disabled (which itself shows the pre-fill reads back equal), then one field is edited and
every OTHER field is sent exactly as pre-filled. Suites: `src/screens/backup-screen
src/dashboard-app.backup-unsaved`.

### Task 3a.4b — the bucket stream (`stream-settings-panel.ts`)

`save` (~773) on `#scope` (~296, registered through `?.register` — fix). Immediate, not gated:
`test` (~765), turn off, `change`. Editing blanks the secret, so a first edit is the change.
Suites: `src/screens/stream-settings-panel src/dashboard-app.settings-panels`.

### Task 3a.5 — your profile (`profile-screen.ts`)

One `save` (~1122) serves every mode through one `#scope` (~276) holding the current mode's
fields. No profile mode is savable at open: every mode except view and codes requires a typed
current password or code (`needsCredentials` ~409–422, `#shownFields` ~517–523, `#validate`
~535–554). So the gate applies in every mode and nothing passes `savableAtOpen`. Leave paths that
read "a scope exists": `requestLeave` (~251–254, `!this.#scope || this.#leave!`), `#closeModal`
(~398), `.beforeClose` (~1092) — gate them on the coordinator. This changes when the button is
enabled, not what any credential route checks. `dashboard-app.test.ts` ~1088–1091 opens Edit
details and presses Save untouched: its `saveProfile` round-trip needs one edit first (a predicted
changed check). Suites: `src/screens/profile-screen src/dashboard-app.profile-unsaved
src/dashboard-app.unsaved-changes src/dashboard-app.test`.

### Task 3a.6a — people (`widgets/person-edit.ts`, `person-form.ts`)

`person-edit` `save` (~377, pre-filled; `resend-invitation` immediate), `person-form` `confirm`
(~296, a create: "empty submit shows errors" tests become type-something-invalid-then-press).
"Scope exists" leave paths: person-edit ~63–65, ~218, ~277; person-form ~75–77, ~219, ~256.
Suites: `src/widgets/person-edit src/widgets/person-form src/screens/staff`.

### Task 3a.6b — purchases and shifts (`widgets/purchase-form.ts`, `shift-dialog.ts`)

`purchase-form` `confirm` (~674; a new invoice is blank, an edit pre-filled); `shift-dialog`
`confirm` (~243) — a role-only change makes the scope changed while `#confirm` returns on a blank
start or end (~157): add that to `?disabled`. `remove` on the shift dialog is immediate.
"Scope exists" leave paths: purchase-form ~214–216, ~543; shift-dialog ~70–72, ~208. Suites:
`src/widgets/purchase-form src/widgets/shift-dialog src/screens/purchases src/screens/roster`.

### Task 3a.7 — look, docs, backlog

LOOK (dev stack from the worktree; check port 8080 and the venue folder's holders first): each
screen unchanged and changed at desktop, light, EN; then 390px, dark and ES on one inline-row
screen (floor), one dialog (person-edit) and one panel (backup). design-system.md → Forms lists
which forms follow the rule: add the 3a forms there; the CLAUDE.md §3 clause says "batches 1 and
3a follow it (list: design-system.md)" rather than naming 13 files. Update the A331 backlog entry
(batches 1 and 3a landed; 2, 3b, 4–7 open). Light review path.

## Batch 6 — setup stored-setting editors (Lane E, A331-6)

**Source audit, 2026-10-08: zero candidates found.** Apply the shared helpers only to setup steps
editing already stored settings. Continue/Next and sign-in remain excluded. Do not invent a Save
or convert an operation into an editor to fill this batch. Behavioral checks and fresh-context
review remain tasks below; this audit records source call chains, not a runtime result.

The eight production screens found by `rg -l leaveCoordinatorFor apps/setup/src/screens -g '*.ts' -g '!*.test.ts'`
are excluded as follows. Their events reach the shell through
`apps/setup/src/setup-app.ts:1392`. A draft patch merges browser state
(`apps/setup/src/setup-app.ts:673`); navigation changes the step (`apps/setup/src/setup-app.ts:767`),
and venue's advance selects certificate or review (`apps/setup/src/setup-app.ts:834`).

| Screen and action receipt | Exclusion and remaining call chain |
| --- | --- |
| `apps/setup/src/screens/admin-screen.ts:182` | Next patches the proposed admin and navigates to venue, through the draft/navigation handlers above. |
| `apps/setup/src/screens/cert-screen.ts:260` | Next patches the proposed certificate and navigates to fiscal-test, through those same handlers. |
| `apps/setup/src/screens/venue-screen.ts:611` | Next patches the proposed venue and emits advance, through the draft/advance handlers above. Imported values also enter this draft (`apps/setup/src/setup-app.ts:1198`); pre-filled wizard input is not a stored-setting editor. |
| `apps/setup/src/screens/connect-screen.ts:182` | Connect requests adoption with credentials: `apps/setup/src/setup-app.ts:950`, `apps/setup/src/api/client.ts:215`, `apps/server/src/setup-api.ts:798` calls adopt. |
| `apps/setup/src/screens/live-source-screen.ts:121` | Import stages configuration: `apps/setup/src/setup-app.ts:1178`, `apps/setup/src/api/client.ts:280`, `apps/server/src/setup-api.ts:1119` calls staging, wired at `apps/server/src/boot.ts:942`. Staging writes artifact, wrapped passphrase and marker files (`apps/server/src/configuration-import.ts:83`); it is not a stored-setting editor. Start empty (`apps/setup/src/screens/live-source-screen.ts:104`) patches the wizard and navigates. |
| `apps/setup/src/screens/reset-screen.ts:169` | Reset authorizes clearing an incomplete adoption: `apps/setup/src/setup-app.ts:1309`, `apps/setup/src/api/client.ts:219`, `apps/server/src/setup-api.ts:872` checks the operation and `apps/server/src/setup-api.ts:894` stages reset. |
| `apps/setup/src/screens/restore-screen.ts:188` | Restore requests archive recovery: `apps/setup/src/setup-app.ts:969`, `apps/setup/src/api/client.ts:245`, `apps/server/src/setup-api.ts:1009` stages restore. |
| `apps/setup/src/screens/restore-bucket-screen.ts:224` | Restore requests a bucket rebuild: `apps/setup/src/setup-app.ts:1034`, `apps/setup/src/api/client.ts:271`, `apps/server/src/setup-api.ts:1077` calls staging, wired at `apps/server/src/boot.ts:927`. Venue confirmation is part of that request. |

**Screens without that registration, also excluded:**

- Review's Provision (`apps/setup/src/screens/review-screen.ts:229`) and provisioning's Retry
  (`apps/setup/src/screens/provisioning-screen.ts:67`) share `apps/setup/src/setup-app.ts:848`,
  `apps/setup/src/api/client.ts:206`, `apps/server/src/setup-api.ts:627`. This is initial provisioning
  or its resumption (`apps/server/src/setup-api.ts:680`), including staged configuration
  (`apps/server/src/boot.ts:1011`), not editing stored settings. Review's Edit links navigate
  (`apps/setup/src/screens/review-screen.ts:127`); provisioning offers reset navigation or reload
  (`apps/setup/src/screens/provisioning-screen.ts:84`). Do not gate confirmation or retry on dirtiness.
- Mode and its live confirmation (`apps/setup/src/screens/mode-screen.ts:105`,
  `apps/setup/src/screens/mode-screen.ts:140`), role (`apps/setup/src/screens/role-screen.ts:62`) and
  configuration-preview (`apps/setup/src/screens/configuration-preview-screen.ts:69`) patch/navigate
  through the handlers above. Connection Continue (`apps/setup/src/screens/connection-screen.ts:72`)
  checks status (`apps/setup/src/setup-app.ts:654`, `apps/setup/src/api/client.ts:198`,
  `apps/server/src/setup-api.ts:555`); its other action opens trust help.
- Fiscal-test Run (`apps/setup/src/screens/fiscal-test-screen.ts:73`) reaches
  `apps/setup/src/setup-app.ts:1216`, `apps/setup/src/api/client.ts:295`,
  `apps/server/src/setup-api.ts:615`; Continue navigates to review. Cloud-restore actions
  (`apps/setup/src/screens/cloud-restore-screen.ts:117`) reach `apps/setup/src/setup-app.ts:1122`,
  `apps/setup/src/api/client.ts:223` and `apps/server/src/setup-api.ts:905` for start/status/start-again;
  recovery uses `apps/setup/src/api/client.ts:236` and staging at `apps/server/src/setup-api.ts:939`.
- Done polls status and offers links (`apps/setup/src/screens/done-screen.ts:127`,
  `apps/setup/src/screens/done-screen.ts:169`). The old-box checkbox only supplies a recovery answer
  (`apps/setup/src/screens/old-box-question.ts:52`). The shell language chooser changes the current
  language (`apps/setup/src/setup-app.ts:482`, `apps/setup/src/i18n/t.ts:17`), with no Save action.

### Tasks 6.1–6.4 — confirm, check, document, land

1. Fresh-context review: repeat the screen search and inspect every action in the shell's screen
   switch (`apps/setup/src/setup-app.ts:1421`), including confirmation, retry and imported/pre-filled
   drafts. Recheck the receipts against the current tree. If a true stored-setting editor is found,
   revise this scope before implementation; use TDD and only `draftScopeFor` plus `saveActionState`
   with the save-handler early return. These remain the sole mechanism for future true saves;
   leave paths gate on the returned coordinator. No helper rollout is needed for the exclusions.
2. Run existing behavioral, unsaved-change and accessibility suites in Chromium:
   `pnpm --filter @waitron/setup exec vitest run src/screens src/setup-app src/api/client.test.ts`.
   Record test counts and failures; the screen selection includes the existing `*.a11y.test.ts`
   suites. Preserve their assertions and existing navigation/action behavior. No new code or tests
   are needed if review still finds zero candidates.
3. In the execution change, update only the A331 Batch 6 status in `docs/backlog.md` and Forms in
   `docs/developers/design-system.md`: record the audited setup exclusions and link here, without
   listing setup as an implemented save-form rollout or changing other batches' status.
4. If zero candidates remain and checks pass, verify the entire change is `docs/`-only and use
   the item-specific own-PR workflow: `git commit -s`, finish-branch with the normal push hook and
   current-head CI, then the authorized land-branch under the shared landing lock. The production-code
   review is skipped for this documentation audit. Update only Lane E campaign state; preserve the
   other batches and lanes.

**Completed 2026-10-08 against base `d401dcaac4212bb60db7d43e9859957e21af711a`.**
The fresh-context source review found no missed stored-setting editor and checked the numbered
receipts. Its cloud-action wording correction is included. Task 6.2's command passed 1,249 tests
in 47 files, including existing accessibility suites; the unedited `write-path.e2e.test.ts` and
`inmutabilidad.test.ts` passed 20 tests with
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
Backlog and Forms now record the audit. Only documentation changed; no new Save state, test
assertion or visible screen change was introduced, so no red-green cycle, new save-state axe matrix
or visual-change inspection is claimed. Logs and the source-review triage are retained outside the
repository in `~/waitron-campaign-e/receipts/a331-6/`.

## Batch 4a — module forms (Lane E, A331-4a)

Branch `feat/save-follows-changes-modules`. Apply Batch 1 and Batch 3a's rules, plus Batch 3b's
two extra rules read from the hardware worktree: treat `Unhandled error` output as a failure, and
temporarily throw at each untouched-save early return to find affected checks. This section plans
execution; it records no implementation or test results. No migration. Leave `packages/venue-service`
and other lanes' work untouched.

**Classification receipts:** numbered source at `3c5514738` (2026-10-08); recheck before execution.
Paths below are repository-relative. Provider actions remain ungated even though they write local
registrations or credentials after the provider step.

| Named form | Decision and call path |
| --- | --- |
| `packages/payments-stripe/src/dashboard/stripe-add-reader.ts` | Exclude Add: provider-reader adoption. Handler `:147` calls `packages/payments-stripe/src/dashboard/client.ts:39`; `apps/server/src/payments-api.ts:571` calls the provider, then `:585` inserts the local reader. `packages/payments-stripe/src/card-provider.ts:207` retrieves an existing Stripe reader; this is not a new Stripe pairing or a stored-reader name editor. |
| `packages/payments-stripe/src/dashboard/stripe-connect-form.ts` | Exclude Connect: handler `:129` calls `packages/payments-stripe/src/dashboard/client.ts:31`; `apps/server/src/payments-api.ts:472` invokes the provider and `:483` seals credentials. `packages/payments-stripe/src/card-provider.ts:162` verifies the account with Stripe. |
| `packages/payments-sumup/src/dashboard/sumup-add-reader.ts` | Exclude Pair and Try again: handler `:181` calls `packages/payments-sumup/src/dashboard/client.ts:76`, through `apps/server/src/payments-api.ts:571` to `packages/payments-sumup/src/card-provider.ts:214` (`pairReader`). The form polls pairing status at `:212` and finishes at `:227`. Preserve polling, cancellation and orphan cleanup. |
| `packages/payments-sumup/src/dashboard/sumup-connect-form.ts` | Exclude Connect, including merchant selection: handler `:182` calls `packages/payments-sumup/src/dashboard/client.ts:67`, through `apps/server/src/payments-api.ts:472` to `packages/payments-sumup/src/card-provider.ts:158` (memberships) and `:165` (merchant choice), before credentials are sealed at server `:483`. |
| `packages/adjustments/src/dashboard/reasons-screen.ts` | Gate reason create/edit (`save-editor`, `:1088`) and bill-discount limit (`save-limit`, `:763`). Handlers `:651` / `:692` call `packages/adjustments/src/dashboard/client.ts:131`, `:135`, `:161`; `packages/adjustments/src/routes.ts:236`, `:248`, `:283` write reasons/settings. Reorder, Enable and Deactivate remain immediate actions (`:410`, `:627`, `:617`). |
| `packages/bookings/src/dashboard/booking-form.ts` | Gate Create/Save (`confirm`, `:354`). Handler emits update/create at `:235` / `:244`; `packages/bookings/src/dashboard/bookings-screen.ts:223` / `:243` calls `packages/bookings/src/dashboard/client.ts:75` / `:79`; `packages/bookings/src/routes.ts:160` / `:173` writes the booking. Seating, cancellation and other booking actions are outside this form. |
| `packages/media/src/dashboard/image-library.ts` | Gate names edit and upload (`save`, `:786`): handler `:527` / `:530` calls `packages/media/src/dashboard/client.ts:71` / `:80`; `packages/media/src/routes.ts:132` / `:146` stores the image/metadata. Opening Upload, preview, picker selection, retry and Delete remain ungated (`:797`, `:567`, `:897`, `:873`, `:663`). |

### Rules and tests for the included saves

- Use only `draftScopeFor` and `saveActionState` from `@waitron/ui` (exports
  `packages/ui/src/index.ts:108`, `:110`). All three included packages already depend on it
  (`packages/adjustments/package.json:29`, `packages/bookings/package.json:28`,
  `packages/media/package.json:24`). Bind `variant` and `disabled` on `wt-button`; retain existing
  busy/validation conditions. Return early while unchanged before setting attempted/errors or
  emitting a write/event. Keep request refusals retryable, including those naming fields.
- Keep coordinator guards separate from always-present scopes. Adjustments: `:268`, `:275`,
  `:1051`; bookings: `:273` guards the callback at `:91`; media: `:714`, `:780` guard `:320`.
  Preserve parent scopes, discard/close behavior, submitted-value commits and stale-completion checks.
  Dispose and recreate scopes on reopen; test without a coordinator and with the real coordinator.
  Standalone booking/reason forms also commit submitted values and retain newer edits after a
  successful write; previously they closed because no scope existed. This deliberately matches
  their coordinated dashboard behavior. The retained standalone limit likewise adopts the
  refreshed/submitted baseline and quiets Save when its values match. Dispose the reason
  coordinator handle whenever its scope is retired, including replacement by Deactivate.
- Equality must compare draft values independently of busy state: do not copy the payment forms'
  `busy || equal` pattern (`stripe-add-reader.ts:74`, `stripe-connect-form.ts:67`,
  `sumup-connect-form.ts:99`). A changed in-flight save stays primary and disabled. Keep each
  included owner's normalization; do not add a second dirty comparison.
- No current included opening needs `savableAtOpen`: reason defaults still lack name/actions
  (`reasons-screen.ts:450`), booking creation only seeds date (`booking-form.ts:159`), upload opens
  without file/names (`image-library.ts:436`). Editing the duplicate-upload result opens a stored
  image (`:867`), so unchanged metadata is quiet. Recheck actual callers; if a fully savable creation
  is found, document it and use the same opening flag in render and handler, clearing it on success/close.
- Tests first in Chromium: watch each new behavioral case fail for the expected reason, then add
  the minimal wiring and rerun. Assert host and native button disabled/secondary at a fully filled
  stored opening and empty create; edit enables primary, undo restores quiet; untouched host submit
  sends no request/event; invalid changed input follows the existing error contract; refusal permits
  retry; successful commit quiets any retained form; reopening starts a fresh baseline. Test newer
  edits during a write and primary styling while busy. Remove the gate as a negative control, observe
  failure, then restore it. Axe unchanged/changed states in both themes for every included mode.
- During execution, temporarily replace the unchanged return with `throw new Error("untouched save")`
  and run each task's existing suites. Restore the plain return. Classify every resulting failure;
  retain behavioral assertions and list `file:line`, before/after and why under **Changed test checks**
  in the ledger and PR. Predictable cases: `reasons-screen.a11y.test.ts:169`, `:179`, `:198`, and
  `image-library.a11y.test.ts:71` press untouched saves. Make a meaningful edit first while preserving
  their error/refusal/success assertions. The probe, not this prediction, determines the full list.

### Execution checklist

- [ ] Remap on the starting main, check open-PR overlap, read PRs #1391/#1401/#1407 and the topic
  guides, and obtain one fresh-context review of this section before implementation.
- [ ] Adjustments: convert `#reasonScope` (`:462`) and `#limitScope` (`:351`) separately; gate their
  own handlers/buttons. Test normalized percent/money undo and limits saved while the page stays
  open. Add `src/dashboard/reasons-screen.save-state.test.ts`; extend the existing unsaved/axe suites.
- [ ] Bookings: convert registration (`:173`), preserve `comparable` (`:31`) and open/identity reset
  (`:153`), gate `#confirm` (`:212`). Add `src/dashboard/booking-form.save-state.test.ts` and
  `src/dashboard/booking-form.a11y.test.ts`; retain parent-screen write/refusal behavior. Register
  the shared `parkPointerCommands` in bookings browser config before importing the shared axe
  helper, as adjustments/media do; this avoids an unregistered-command hook failure.
- [ ] Media: convert registration (`:445`), preserve names/file equality and generation reset
  (`:433`), gate `#save` (`:504`). Add `src/dashboard/image-library.save-state.test.ts`; test file
  selection/removal, names undo, duplicate upload and reopen; extend unsaved/axe suites.
- [ ] Run focused suites, including the new files and existing consumers:
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen`;
  `pnpm --filter @waitron/bookings exec vitest run src/dashboard/booking-form src/dashboard/bookings-screen`;
  `pnpm --filter @waitron/media exec vitest run src/dashboard/image-library src/dashboard/image-picker`.
  Also run the media throw probe and retained checks through dashboard parents:
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/image-upload.unsaved
  src/widgets/section-details-form.unsaved src/widgets/product-editor.unsaved
  src/widgets/image-upload.a11y src/screens/receipts-screen.top-block`.
  Record counts and inspect complete output for `Unhandled error`; run affected package typechecks.
- [ ] LOOK at each included mode unchanged/changed, EN/ES, light/dark, 1280/390px, using the managed
  worktree dev stack. Retain visual receipts. Run fiscal20 unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] In the implementation change, update A331's backlog status and Forms' implemented-form list
  in `docs/developers/design-system.md`, linking the excluded provider-action classifications, and record classifications and
  changed checks in its own PR. Use signed-off commits, then announce readiness for `finish-branch`;
  use the no-migration light path, including the required Claude whole-branch run-it review after
  initial rebase, normal push hook and current-head CI/coverage. Preserve other appended batches on
  rebase. Land only with owner authorization through `land-branch`, verify merge CI and managed cleanup.

## Batch 7 — remaining forms and string pages (Lane E, A331-7)

**Audit-only documentation result, 2026-10-08.** Base/HEAD `ed7a94cb111b08f746d7583ee4d792eec4fcf8c7`,
branch `feat/save-follows-changes-remaining`: no eligible Save editor in the unreserved scope; reserved forms remain outstanding.
Retain all owner rules above. No implementation, new tests, migration or helper rollout.

**Inventory commands.** Intersect the labelled and button file lists, then remove scope-helper files
and the two fully reserved groups. Exclude test/spec files and generated/dependency directories:

```sh
rg -li '\b(save|create|add|submit)\b' apps packages -g '*.{ts,tsx,js,mjs,html}' -g '!*.test.*' -g '!*.spec.*'
rg -l '<(wt-button|button)\b' apps packages -g '*.{ts,tsx,js,mjs,html}' -g '!*.test.*' -g '!*.spec.*'
rg -l 'leaveCoordinatorFor|draftScopeFor' apps packages -g '*.{ts,tsx,js,mjs,html}' -g '!*.test.*' -g '!*.spec.*'
rg -n '<(wt-button|button|form)\b|type="submit"' apps/server/src apps/print-agent/src -g '*.ts' -g '!*.test.ts'
```

Result: **26 labelled no-scope files**, **72 all-button files**, before the remaining reservations.
The broader scan removed 77 scoped files and 32 in `apps/till` / `packages/venue-service`.
The word scan includes identifiers/prose: classify handlers and computed labels, not matches.
Dashboard paths in the next two bullets are under `apps/dashboard/src/`.

- Labelled inventory: `dashboard-app.ts`; screens `alerts`, `catalogue`, `content-languages`,
  `modifiers`, `purchases`, `recipe`, `roster`, `staff` (`*-screen.ts`); widgets
  `add-content-language`, `allergen-picker`, `category-color-form`, `course-list`, `product-list`,
  `variant-table`, `menu-prices-table`, `menu-structure-table` (`*.ts`). Also the two string pages,
  `packages/bookings/src/dashboard/bookings-screen.ts`, shared `wt-{button,combobox,data-table,disclosure}`,
  `packages/ui/demo/main.ts` and `packages/ui-core/test/consumer/main.ts`.
- Broader inventory adds screens `approvals`, `cloud-services`, `dashboard-sales`, `demo-printer`,
  `demo-reader`, `diagnostics`, `email`, `orders`, `servers`, `vat-return`, plus `screens/canvas-editor/canvas-grid-preview.ts`;
  widgets `alerts-bell`, `allergen-dietary-picker`,
  `color-field`, `customer-menu-renderer`, `device-home-preview`, `equipment-label`, `hold-notice`,
  `ingredient-list`, `menu-preview`, `order-detail-dialog`, `order-reprint-dialog`, `print-job-preview`,
  `purchase-list`, `staff-list`; setup's eight unscoped screens listed in Batch 6;
  `packages/adjustments/src/dashboard/adjustment-report-screen.ts`, shared `reorder-table.ts` and
  `wt-{choice-row,floor-canvas,help-tooltip,language-chooser,number-stepper,price-input,relative-time,row-actions,tabs,toast,unsaved-changes}`.

**Classification receipts (source call paths, not labels):**

- `apps/dashboard/src/widgets/add-content-language.ts:107` calls `#add` on selection, then the
  supplied save at `:51`; `apps/dashboard/src/screens/content-languages-screen.ts:406` supplies `#saveAdded`,
  reaching `#write` / `updateContentLanguages` at `:277` / `:285`, then `apps/server/src/catalogue-api.ts:871` / `:887`.
  Add opens the chooser (`content-languages-screen.ts:395`);
  default/remove act immediately (`:363`, `:375`). There is no staged primary Save to gate.
- `apps/dashboard/src/widgets/course-list.ts:291` opens an inline row. Enter/blur commits at
  `:354` / `:373`; `:320` skips an unchanged existing name before create/update at `:331` / `:332`.
  These reach `apps/server/src/management-api.ts:2134` / `:2186`, then `apps/server/src/kitchen.ts:373` / `:454`. Preserve inline commits; Add opens.
- `apps/dashboard/src/widgets/category-color-form.ts:85` emits the chosen color immediately.
  `apps/dashboard/src/widgets/catalogue-browser.ts:987` reaches `#chooseColor`: row selection
  updates the category at `:803` (server `apps/server/src/catalogue-api.ts:1282`); box selection
  only stages its color at `:795`. The chooser has Cancel, no Save.
- `apps/dashboard/src/widgets/product-list.ts:1199` / `:1206` dispatch Add. Product Add reaches
  `apps/dashboard/src/screens/catalogue-screen.ts:744` / `:747`, opening the scoped product editor;
  category Add opens inline naming (`apps/dashboard/src/widgets/catalogue-browser.ts:859`).
  Enter/blur emits `name-commit` (`product-list.ts:748`, `:759`, `:700`), reaching create/update
  (`catalogue-browser.ts:761`, `:775`, `:776`; server `catalogue-api.ts:1232`, `:1282`). No primary Save.
- `apps/dashboard/src/widgets/allergen-picker.ts:101` emits a parent-draft change, consumed by
  `apps/dashboard/src/widgets/ingredient-form.ts:307` / `:194`, whose scope is registered at `:161`.
  `variant-table.ts:315` likewise emits events consumed by `product-editor.ts:1602`–`:1654`;
  that editor owns the Save gate (`:516`, `:868`). Neither child is an independent Save editor.
- Screen/list Add/Edit opens scoped children: staff (`staff-screen.ts:351`, `:476`), purchase (`purchases-screen.ts:201`, `:217`),
  ingredient (`recipe-screen.ts:360`, `:428`), shift (`roster-screen.ts:448`, `:320`),
  modifiers (`modifiers-screen.ts:588`), booking (`packages/bookings/src/dashboard/bookings-screen.ts:412`).
- Other unreserved buttons navigate/open/close, retry reads, delete/enable, print/download or perform
  operations. Computed labels: cloud's request-button factory (`cloud-services-screen.ts:244`, `:330`, `:360`),
  server removal/clear (`servers-screen.ts:175`, `:265`), staff resets/invitations
  (`staff-screen.ts:120`), booking lifecycle (`bookings-screen.ts:332`, `:357`). Approval, roster Publish
  and diagnostic verbosity call operations (`approvals-screen.ts:142`, `roster-screen.ts:305`,
  `diagnostics-screen.ts:137`); VAT downloads (`vat-return-screen.ts:122`). Retain Batch 6's setup exclusions.
  Shared primitives, previews, demo and consumer fixtures are not product Save editors.
- Server trust is download/navigation links (`apps/server/src/trust-page.ts:84`, `:131`). Recovery's
  computed Retry posts at `apps/server/src/recovery-surface.ts:446`, reaches `onRetry` at `:481`, then persists state and exits (`apps/server/src/node-entry.ts:426`).

**Print-agent Save is an ACTION: connect or re-enrol, including an unchanged saved-URL retry.**
`apps/print-agent/src/setup-page.ts:100` / `:105` posts to `:208` / `:225`;
`apps/print-agent/src/bin.ts:37` calls `packages/print-agent/src/agent.ts:587`.
Configure clears the token, writes configuration, resets runtime (including halted at `:123`) and
wakes the loop (`:592`–`:602`); subsequent ticks attempt self-enrol/join (`:347`, `:380`). No equality gate.
Joined agents cannot configure (`setup-page.ts:211`, `agent.ts:591`); keep the saved-URL retry available for re-enrolment after denial.
The exclusion follows the operation, not native HTML/helper availability. Reset/cancel are operations (`setup-page.ts:233`, `:245`).

**Reserved forms and next audit.** Paths here are relative to the repository. Leave these
for after their owning branches land; rerun the two inventories, inspect each primary Save and
adopt `draftScopeFor` / `saveActionState` test-first where its owning batch has not done so:

- Hardware batch 3b, `feat/save-follows-changes-hardware`: the agent/name/connection/calibration
  and printer forms in `apps/dashboard/src/screens/printers-screen.ts`; device and profile forms
  in `devices-screen.ts` / `device-profiles-screen.ts`; reader settings in `payments-screen.ts`;
  canvas create/edit in `canvas-editor-screen.ts` and `screens/canvas-editor/`.
- Till batch 5, `feat/save-follows-changes-till`: all `apps/till/`, including schedule and
  party-name forms. Its owner classifies the other dialogs before changing their actions.
- A339, `fix/home-column-ranges`, and the following Preview work: catalogue device-home files;
  `apps/dashboard/src/widgets/device-home-preview.ts`; `screens/menus-screen.ts` and its tests;
  menu widgets `menu-preview`, `menu-prices-table`, `menu-structure-table`, `menu-publications`,
  `customer-menu*`, `add-to-menus`, `include-folder-form` and `section-*` under that widgets folder.
- Venue-service batch 4b / `feat/service-periods-slice-1`: all `packages/venue-service/`, including
  hours/date/holiday/menu-slot editors, watcher, service settings, venue operations, timetable
  and preparation-station forms.
- Parked invoice part 1, [#1399](https://github.com/clintongormley/waitron/pull/1399):
  `apps/server/src/configuration-transfer*`, `apps/server/src/setup-api.ts`,
  `packages/db/src/configuration-transfer.ts`, `apps/till/src/i18n/codes*`, and print-agent
  `packages/print-agent/src/{agent,client,index}.ts`. Read the agent only to trace setup; no edits.

Other already scoped dashboard forms remain earlier-batch work. This audit completes only the
unreserved no-scope and string-page inventory; the listed follow-up remains open in the backlog.

**Verification run for exclusions (existing tests, unchanged):**
`pnpm --filter @waitron/dashboard exec vitest run src/widgets/add-content-language.test.ts src/widgets/course-list.test.ts src/widgets/category-color-form.test.ts`
passed 112 tests in 3 Chromium files; `pnpm --filter @waitron/print-agent-app exec vitest run src/setup-page.test.ts`
passed 33 tests; `pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts -t 'setup reset drops|reconfigures a denied agent|refuses a queued configure'`
passed 4 tests, with 114 skipped by selection (including same-URL reset/rejoin cases at `agent.test.ts:1483`, `:1511`).
These checks do not validate reserved forms or package-wide coverage. No behavior/visual change is claimed.
Validate this appendix with `git diff --check` and an append-only comparison against the base.
The implementation change also records this audit and its remaining reservations in the backlog
and Forms contract. It changes documentation only.

## Batch 5 — the till app (Lane C, A331-5)

Branch `feat/save-follows-changes-till`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-save-follows-changes-till`. Line numbers
(~NNN) were read at `75d3a6d5f` on 2026-10-08. On that day the open pull requests' file lists and
lane D's `feat/service-periods-slice-1` touched no till file below; lane E's #1399 changes
`apps/till/src/i18n/codes.ts` and `codes.test.ts`, which this batch does not edit.

**The 3a rules block applies to every task**, with `pnpm --filter @waitron/till typecheck` in place
of the dashboard's. Three more rules, learnt in 3b (they live in lane B's 3b section, not yet on
`main`, so they are repeated here):

- Read the whole run output for `Unhandled error` lines. Vitest can report every test passing while
  it prints one, and that is a failure: find what threw and fix it.
- To find the tests that press an untouched Save, make the new early return THROW for a moment
  (`if (s.unchanged) throw new Error("untouched save")`) and run the task's suites. Every test that
  then fails pressed an untouched Save: each is a changed check (one edit before the press, or an
  assertion that Save is disabled) or a fix. Put the plain `return` back afterwards. The predicted
  changed checks below came from reading; the throw-probe is the list that counts.
- Once a scope always exists, every `if (scope) … else …` branch in a save handler whose `else` stood
  for "no coordinator" changes what runs in a widget test. Where both branches end the same way,
  delete the `else`; where they differ, gate on the coordinator. A widget test that relied on the old
  `else` is a changed check; a failure showing that the scope branch is wrong in the app is a
  regression: stop and report it.

Till widget tests mount through `mountWidget` (`apps/till/src/widgets/test-helpers.ts`
~61–80) with no `LeaveController` above, exactly like the dashboard's; each `*.unsaved.test.ts` holds
its own controller. The till's suites run in real Chromium (`apps/till/vitest.config.ts`).

**Which till dialogs are saves** (reviewed once by a fresh-context reader, 2026-10-08; its findings
are folded in). `git grep -ln leaveCoordinatorFor apps/till/src` lists 19 non-test
files. Five forms edit or submit staged input and are gated; every other form takes an action and
keeps today's behaviour:

| Form | Decision | Why |
| --- | --- | --- |
| Party name (`party-name-dialog.ts`, `data-name-save`) | SAVE | Renames a stored party (`till-app.ts` ~6887, `api.setPartyName`); pre-filled from the stored name. |
| Schedule: Request cover, Request time off (`till-schedule-screen.ts`, `.cover-submit`, `.abs-submit`) | SAVE | The same submissions of staged input that 3a.2b gated on the dashboard (`api.requestSwap` ~313, `api.requestAbsence` ~328). |
| Invoice recipient (`invoice-recipient-dialog.ts`, `data-invoice-save`) | SAVE | Captures the customer's tax details; on a bill it writes `setOrderInvoiceChoice` (`till-app.ts` ~7587). Every field is required and it always opens empty, so — like 3b's bill attestation — an untouched press can never send anything; gating changes only the look of the empty dialog. Its counter path feeds the details into the sale request (`till-app.ts` ~3118–3120, ~3235), so this PR takes the FULL review path and changes nothing the payment or sale request is sent. |
| Modifier picker, edit mode (`modifier-picker.ts`, `.confirm`, when `initialSelections` is set) | SAVE | Edits a basket line's modifiers (`basket.ts` ~559–570) or a held/sent line's (`till-table-order-screen.ts` ~2388–2401, `change-line`); pre-filled from the line. |
| Modifier picker, add mode | ACTION (unchanged look and behaviour) | Adding a dish is a pick; its defaults are valid to send. Pass `savableAtOpen: initialSelections === undefined`, so add mode stays `primary` and never returns early. |
| Station choice, Make at mode (`station-choice-dialog.ts`, `data-submit`, `!moving`) | SAVE | Edits an unsent basket line's station (`till-app.ts` ~5999–6008, `setLineMakeAt`); pre-filled with the line's `makeAt`. |
| Station choice, Move mode | ACTION | Moves a sent ticket; its `?disabled` already refuses an unchanged choice (~201–205). Keep its look and behaviour. |
| Seat a table (`seat-dialog.ts`) | ACTION | Creates a party; an empty guest count is a valid seat (`seat-dialog.test.ts` ~57–65), so gating would block seating. |
| Supervisor override, lock screen, enrol screen | ACTION | A PIN authorisation, a sign-in, a device enrolment. |
| Bill pay, tender pay, bill refund, find bill, cancel and credit, unpaid departure, adjustment | ACTION | Take, refund or write off money, or cancel a document. |
| Dead ends, department transfers | ACTION | Answer a send-or-pay question; request, accept or decline a transfer (workflow replies, like acknowledge). |
| Table order: mark served, split and transfer, order preview/send | ACTION | Act on the order (serve, move lines between bills, send to the kitchen). |
| The till app's dead-end question after a line edit (`till-app.ts` ~6476, dialog ~6532–6560; it uses the app's coordinator directly, so the 19-file grep misses it) | ACTION | Retries a refused line change. |

The enrol screen is an action for a second reason too: a refused join returns to the name step
holding the same name (`till-enrol-screen.ts` ~128), and pressing again is the operator's intent.

### Task 5.1 — party name (`apps/till/src/widgets/party-name-dialog.ts`)

Register through `draftScopeFor` (~53–61; baseline stays `savedValue ?? value`). Leave paths that
read "a scope exists": `#leave!` (~43), `#cancel`'s `if (this.#scope)` (~115),
`.beforeClose=${this.#scope ? …}` (~140) — gate them on the coordinator. `data-name-save`
(~166–170, fixed `variant="primary"`) binds the helper; keep `attempted && #tooLong()`. The early
return goes in the save handler before `attempted` is set. An empty name is a valid save (it
clears the name) when the stored name was not empty. A refused save reopens the dialog holding the
refused value beside the stored one (`till-table-order-screen.ts` ~1604), so it opens changed:
add a save-state case for that. Predicted changed checks (`party-name-dialog.test.ts`): ~73–80
(a second press after the first save), ~108–113 (mounted with a refusal and `value` but no
`savedValue` — give it the stored value the app passes). Suites: `src/widgets/party-name-dialog
src/screens/party-name.unsaved src/screens/till-table-order-screen src/till-app-parties`.

### Task 5.2 — schedule requests (`apps/till/src/screens/till-schedule-screen.ts`)

Two `this.#leave?.register` calls in `connectedCallback` (~199–221) become two `draftScopeFor`
calls; `.cover-submit` (~486–491) gates on the cover scope and `.abs-submit` (~603–608) on the
absence scope, each keeping its existing `busy || <empty field>` conditions. Early returns in both
submit handlers. `#back` already gates on the coordinator (~343). The absence kind defaults to
`holiday`, so a kind-only change makes the scope changed while dates are empty: the existing empty
date condition keeps it disabled. Suites: `src/screens/till-schedule-screen`.

### Task 5.3 — invoice recipient (`apps/till/src/widgets/invoice-recipient-dialog.ts`)

`?.register` (~97–114) becomes `draftScopeFor`; leave paths `#leave!` (~57) and `.beforeClose`
(~223) gate on the coordinator. `data-invoice-save` (~321–326) binds the helper, keeping
`attempted && invalid`; the early return goes before `attempted` is set. No `savableAtOpen`: it
never opens pre-filled (the app passes only `refusal` and `refusalField`, `till-app.ts` ~8854–8858).
`#errors` requires all six fields (~134–143), so an untouched press sends nothing today either; what
DOES change is that today an empty press sets `attempted` (~147), marking all six fields and showing
the fields sentence (~218), and after this task that press does nothing — the button is disabled.
Check `writeCompletion` (~75–92) against the third rule above. Predicted changed checks:
`invoice-recipient-dialog.test.ts` ~68–73 presses an untouched form carrying a server refusal;
`invoice-recipient-dialog.a11y.test.ts` ~28–31 presses the empty dialog to reach its invalid states
(type an invalid tax id first, or axe passes on the wrong state); `till-app-bill-payments.test.ts`
~488–526 sends the confirm event without typing and then asserts Save enabled (~518–520) — type the
six fields first. A parked order also sends the invoice choice (`till-app.ts` ~3529–3532). Also run `src/till-app-bill-payments.test.ts` and
`src/till-app.test.ts` (both open the dialog) — a failure there for any reason but an untouched
press (or the predicted ones above) is a STOP: this path feeds the sale request. Suites:
`src/widgets/invoice-recipient-dialog src/till-app-bill-payments src/till-app.test
src/till-app-boot-and-counter`.

### Task 5.4 — modifier picker, edit mode (`apps/till/src/widgets/modifier-picker.ts`)

`?.register` (~214–233) becomes `draftScopeFor`; leave paths (~193, ~465, ~494) gate on the
coordinator. `.confirm` (~569–576) binds
`saveActionState(scope, { savableAtOpen: this.initialSelections === undefined })`, keeping
`!#satisfied(stale, totals)`; the early return reads the same state. Edit mode has no
already-savable opening: `#stalePicks` reads the line's STORED selections (~300–310) and
`#satisfied` is false while any stale pick exists (~326), so such a line could never be saved from
the picker, gate or no gate; and a stored answer whose option is gone is not counted (~380–387), so
the operator must pick one, which is itself a change. Predicted changed checks
(`till-table-order-screen.test.ts`): "saving unchanged sends the extras back" (~2376–2430) and the
weighed-child reopen (~2432–2462) press untouched — change the note first and keep their extras
assertions; "changed and changed back" (~2496–2507) becomes: Save disabled, no event sent. Tests: edit mode opens quiet and
disabled, one choice enables it, undoing disables it; add mode opens `primary` and enabled (the
`savableAtOpen` case). Suites: `src/widgets/modifier-picker src/widgets/basket
src/widgets/tender-pay src/widgets/menu-browser src/screens/till-table-order-screen
src/till-app-table-service` (grep `till-modifier-picker` for any other mounter).

### Task 5.5 — station choice, Make at mode (`apps/till/src/widgets/station-choice-dialog.ts`)

`if (!this.#leave) return;` (~73) skips both the scope and `this.selected = baseline` (~75): make
the scope exist without a coordinator and keep setting `selected`. "Scope exists" leave paths
~55, ~96, ~173 gate on the coordinator. `data-submit` (~201–205, no variant today, so `secondary`
in both modes by `wt-button`'s default) binds `variant=${moving ? "secondary" : s.variant}`, and the
gate in Make at mode only; in Move mode it keeps today's `?disabled`. Accepted edge, named in the
PR: `#loadStations` swallows a failed read (`till-app.ts` ~2556–2558) and `#choice()` turns a
station missing from the list into "rules" (~112–120), so a stored station missing from an
out-of-date list opens unchanged and clearing it cannot be saved until the list loads. Opened with
no station chosen, it starts at "rules" and saving that changes nothing, so the gate is right. The early return
applies in Make at mode only. Predicted changed check: `station-choice-dialog.test.ts` ~65–79
presses Make at's Save untouched. Suites: `src/widgets/station-choice-dialog src/till-app.test
src/till-app-counter-adjustments` (it opens the real Make at dialog, ~335–726).

### Task 5.6 — look, docs, backlog

LOOK (dev stack from the worktree; check port 8080 and the venue folder's holders first): the five
forms unchanged and changed at desktop, light, EN; then 390px, dark and ES on party name and the
modifier picker's edit mode. design-system.md → Forms: add the batch 5 forms and the till's
action list (a pointer to this table); the root `CLAUDE.md` §3 forms clause ("batches 1 and 3a
follow it") and `docs/developers/conventions-ui.md` (~19) name batch 5. Update the A331 backlog
entry (batch 5 landed). Lane B's 3b branch edits the same lines: whichever lands second rebases and
keeps both. FULL review path because of the invoice recipient (5.3).
