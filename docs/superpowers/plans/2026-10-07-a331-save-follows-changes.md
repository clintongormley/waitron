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
`login-screen.ts` is excluded: every action on it is a sign-in, not a save. 2026-10-08, after 3a
landed: batch 2 still waits on lane A's A346 and A348 (branch
`fix/price-overrides-stand-out-and-available`, which edits the menus-screen tests and the menu
tables), so 3b goes next.

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
  (2026-10-08: `include-folder-form` and `section-details-form` were done in Batch 2b below;
  `section-add-products`, `menu-publications` and `add-to-menus` are batch 2a's.)
- Venue-service batch 4b / `feat/service-periods-slice-1`: all `packages/venue-service/`, including
  hours/date/holiday/menu-slot editors, watcher, service settings, venue operations, timetable
  and preparation-station forms. (2026-10-08: the local holiday editor and the watcher form were
  done in Batch 4c below.)
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
files. Five forms edit or submit staged input and are gated; every other form in that list takes an action and
keeps today's behaviour:

| Form | Decision | Why |
| --- | --- | --- |
| Party name (`party-name-dialog.ts`, `data-name-save`) | SAVE | Renames a stored party (`till-app.ts` ~6887, `api.setPartyName`); pre-filled from the stored name. |
| Schedule: Request cover, Request time off (`till-schedule-screen.ts`, `.cover-submit`, `.abs-submit`) | SAVE | The same submissions of staged input that 3a.2b gated on the dashboard (`api.requestSwap` ~313, `api.requestAbsence` ~328). |
| Invoice recipient (`invoice-recipient-dialog.ts`, `data-invoice-save`) | SAVE | Captures the customer's tax details; on a bill it writes `setOrderInvoiceChoice` (`till-app.ts` ~7587). Every field is required and it always opens empty, so — like 3b's bill attestation — an untouched press can never send anything; gating changes only the look of the empty dialog. Its counter path feeds the details into the sale request (`till-app.ts` ~3118–3120, ~3235), so this PR takes the FULL review path and changes nothing the payment or sale request is sent. |
| Modifier picker, edit mode (`modifier-picker.ts`, `.confirm`, when `initialSelections` is set) | SAVE | Edits a basket line's modifiers (`basket.ts` ~559–570) or a held/sent line's (`till-table-order-screen.ts` ~2388–2401, `change-line`); pre-filled from the line. |
| Modifier picker, add mode | ACTION (unchanged look and behaviour) | Adding a dish is a pick with no earlier choice to compare with. Pass `savableAtOpen: initialSelections === undefined`, so add mode stays `primary` and never returns early. |
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

## Batch 3b — printers, devices, device profiles, payments, canvases (5 files)

Branch `feat/save-follows-changes-hardware`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-save-follows-changes-hardware`. Line numbers
(~NNN) were read from the tree at `59fa80809` on 2026-10-08. On the same day,
`gh pr view <n> --json files` over the open non-Dependabot pull requests (#1399, #1400, #1404), and
a `git diff --name-only` of lane A's `fix/price-overrides-stand-out-and-available` against `main`,
listed none of the five screens.

**The 3a rules block ("Rules for every task") applies to every task below.** Two more rules, each
learnt in 3a:

- Read the whole run output for `Unhandled error` lines. Vitest can report every test passing
  while it prints one, and that is a failure: find what threw and fix it.
- To find the tests that press an untouched Save, make the new early return THROW for a moment
  (`if (s.unchanged) throw new Error("untouched save")`) and run the task's suites. Every test that
  then fails pressed an untouched Save: each is a changed check (one edit before the press, or an
  assertion that Save is disabled) or a fix. Put the plain `return` back afterwards. The
  "predicted changed checks" below came from a script that looked for a press with no edit
  earlier in the same test; it misses an edit made inside a helper, and it misses a test whose
  start it misread, so the throw-probe is the list that counts.

**Where a save handler today reads "a scope exists" as "a coordinator exists".** Once a scope
always exists, every `if (scope) … else …` branch whose `else` stood for "no coordinator" changes
what runs in a widget test. Each task names its sites. Where both branches end the same way (the
form closes, or it stays open on a newer edit), delete the `else` branch: the scope's
`commit`/`isDirty` gives the same answer with or without a coordinator, and the dead branch would
cost coverage. Where they differ, gate on the coordinator. A widget test that relied on the old
`else` branch is a changed check; a failure showing that the scope branch is wrong in the app is
a regression: stop and report it.

**Forms that open already savable** (each passes `{ savableAtOpen: true }` — or the condition
given — to `saveActionState`, and gets a save-state case asserting it opens enabled and `primary`).
None of these forms needs the early return, because their action is never `unchanged`. Their
registrations stay as they are — except the calibration wizard, which is savable at open only when
an add opened it: 3b.1b converts its registration, and its early return reads the same flag:

- **Printers, "name this printer" dialog** (`confirm-add-printer`, ~3511–3518, labelled Add or
  Enable). `#namePrinter` (~569–593) fills the name from what discovery reported, or from a
  switched-off printer's stored name (`discoveredNames[key] ?? #disabledPrinter(device)?.name ??
  #discoveredLabel(device)`, ~575–579), and pressing Add with that name registers the printer. It
  passes `savableAtOpen: true` every time it opens, not only after an add: opening it IS the add.
- **Printers, the calibration wizard when an add opened it (a fresh add or a re-add).** `#registerDiscovered`
  opens the wizard (`#openPrinter`, ~1376) and then sets `#readdingId` (~1399). Closing the wizard
  without saving switches the printer off again (`#finishCalibration`, ~668–677), so pressing Save
  with the settings as they are is what keeps it on — the test "leaves the printer switched on
  once its calibration is saved" (`printers-screen.test.ts` ~7495) presses it untouched and must
  stay as it is. `#savePrinter` clears `#readdingId` as it starts (~1707), so do not read
  `#readdingId` live in the render: set a flag of the wizard's own beside `#readdingId = disabled.id`
  (~1399) and clear it in `#disposeCalibrationDraft` (~661), or Save turns quiet while its
  request is in flight. **Ruling (runner, 2026-10-08, after the plan review): after a FRESH add the
  wizard is savable at open too.** The wizard exists to confirm a new printer's default settings
  (80mm, 180dpi, no drawer, not portable, ~1376–1398) — a pre-filled value the operator must
  confirm. Today an untouched Save there closes the wizard with no request (`#savePrinter` builds
  an empty patch, ~1700–1711); gating it would leave Cancel as the only way to finish, while Cancel
  after a re-add means "switch it off again". So set ONE "opened by an add" flag in both branches
  of `#registerDiscovered` (fresh and re-add), beside `#openPrinter`, and read it for
  `savableAtOpen`. This changes no current behaviour. Editing an existing printer's calibration
  (`calibrate-printer-details`) opens quiet. The PR names this ruling for the owner.
- **Devices, the pairing dialog's settings step** (`pair-submit`, ~1890–1897). `#toSettings`
  (~798–817) fills the name with the device's own asked-for name (`waitingName(request)`) and, for a
  returning device, its old profile and station; pressing Pair approves the device as it asked. The
  dialog keeps its own checks (`blocked`, `#pairSettled`).
- **Payments, each reader row in "Add a reader"** (`adopt-${providerRef}`, ~1666–1670). `#onAddReader`
  fills each name with the provider's reader name (`drafts`, ~634; drawn at ~1639), and Add adopts the
  reader under that name. Today these buttons have no `variant`, so `savableAtOpen` draws them
  `primary` for the first time — the same look as the printers' discovered-row Add (~3684). LOOK
  at a dialog with several readers in 3b.6.
- **Canvases, the duplicate dialog** (`confirm-duplicate`, ~1033–1040). `#openDuplicate` (~853–857)
  fills the name with `<name> (copy)`, and Duplicate creates the canvas (`createCanvas`, ~868).

**What the earlier survey notes said, checked against the code:** devices' Edit backs one Save
with the edit scope and the reader scope — true (~510–511; the save handler already reads both,
~1413). Device profiles' Save backs the draft scope and the reader scope — true (~501–504, ~1352).
"Printers' calibration wizard and name-printer modal open savable after an add" — half true: the
name dialog always opens savable; the wizard does after any add (above, ruling). "Canvas
create/duplicate savable at open" — duplicate is; the create dialog is not a save at all
(`#confirmCreate`, ~496–511, sends no request: it opens the editor on a default canvas), and the
editor it opens already reports a change, because its scope's baseline is `null` (~502, ~312)
while the draft is a canvas, so its Save opens enabled with no flag. "Payments adopt pre-filled" —
true. Not in the notes: devices' pairing dialog also opens savable.

**Two calls the plan reviewer agreed with**, both gated below on the 3a.2b ruling that a
submission of staged input is gated: the printers' Bluetooth Pair dialog (`confirm-pair`) sends a
PIN to the agent rather than saving an edit, and the payments bill attestation (`confirm-bill-attest`)
records an outcome with a note and a manager PIN. Both open with every required field empty
(`pairPin = ""` at ~1585; `billOutcome`, `billNote`, `billPin` all `""` at ~841–843), so an
untouched press can never send anything: gating changes only that the empty press now shows a
disabled button instead of the field errors.

### Task 3b.1a — printers: the agent dialog and the printer page's name and connection editors

All in `apps/dashboard/src/screens/printers-screen.ts`.

- **Edit agent** (`save-agent`, ~2171–2178, fixed `variant="primary"` today) on `#agentScope`,
  registered with `leaveCoordinatorFor(this)` and `?.register` in `#editAgent` (~693–702): make it
  `draftScopeFor`. Leave paths that read "a scope exists": `.beforeClose=${this.#agentScope ? …}`
  (~2135), `#beforeAgentClose` (~683–686, `this.#agentLeave!` and `this.#agentScope!`), and
  `#closeModal`'s `if (this.#agentScope)` (~3154) — gate all three on `#agentLeave`. The early
  return goes in `#saveAgent` (~2183) after its `!agent` check and BEFORE `formAttempted = true`,
  so an untouched press shows no error.
- **Printer page, name** (`save-printer-name`, ~2635–2641) on `#detailNameScope`
  (`leaveCoordinatorFor(this)?.register`, ~2370) and **connection** (`save-printer-connection`,
  ~2770–2776) on `#detailConnectionScope` (~2396): both become `draftScopeFor`, keep their
  existing `?disabled` conditions, and return early at the top of `#saveDetailName` (~2486) and
  `#saveDetailConnection` (~2428). `#cancelDetail` (~2407–2426) already gates on
  `coordinator && scope`. "Scope exists" branches in the two save handlers: the refusal paths'
  `if (scope && …) … else if (this.detail… === savingDraft)` (~2447–2454, ~2501–2504) and the
  success paths' `if (scope) … else if (… === savingDraft)` (~2458–2469, ~2508–2518). I believe
  each `else` becomes unreachable once the scope always exists; delete them (coverage confirms).
- Immediate, not gated: `edit-agent-*`, `revoke-agent-*`, `allow-agent-*`, `scan-agents`,
  `open-add-agent` (the Add-an-agent dialog has no field and only a Close), `join-review-*` (opens
  the join dialog), the join dialog's number choices and `join-deny-*`, the status switch (`printer-detail-active`),
  `edit-printer-name`, `edit-printer-connection`, `open-equipment-label`.
- Predicted changed checks (`printers-screen.test.ts`): "does nothing when a Save from a closed
  agent editor is pressed" (~5539) and "does nothing when Save from a closed name editor is
  pressed" (~6035) — type a change first, so they still prove the STALE press does nothing rather
  than the untouched one; "leaves the agent's Save working after a refusal that names no field"
  (~6472) and "shows an agent refusal and the fields sentence one after the other" (~6486) — one
  edit before the first press.
- Suites: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen
  src/screens/printer-agent.unsaved src/screens/printer-inline.unsaved src/dashboard-app.test`
  (`dashboard-app.test.ts` ~6370–6420 edits a printer's name and connection under the real
  coordinator).

### Task 3b.1b — printers: the calibration wizard

- `save-printer-${id}` (~3440–3446, fixed `variant="primary"`, no `?disabled` today, shown on step
  3 only) on `#calibrationScope` (`?.register`, ~2251–2264): make it `draftScopeFor`; bind
  `variant` and `?disabled=${s.unchanged}` (keep `?loading`) with
  `saveActionState(this.#calibrationScope, { savableAtOpen: <the opened-by-an-add flag> })` (see "Forms that
  open already savable"). Early return in `#savePrinter` (~1691) after its `submitting` check,
  on `saveActionState(…)` with the SAME `savableAtOpen` flag as the render, so an added or re-added
  printer's untouched Save still works. Clear that flag where a save succeeds (beside
  `scope?.commit(submitted)`, ~1720): a wizard a newer edit keeps open (`scope.isDirty()`) must
  turn quiet again when that edit is undone, as any form left open after a save does.
  `submitOnEnter` on the wizard (~3248) already skips a disabled button
  (`packages/ui-core/src/submit-on-enter.ts` ~35).
- Leave paths: `.beforeClose=${this.#calibrationScope ? …}` (~3244), `#beforeCalibrationClose`'s
  `!this.#calibrationScope || this.#calibrationLeave!` (~649–650), `#closeModal`'s
  `if (id === "edit-printer-modal" && this.#calibrationScope)` (~3169) — gate on
  `#calibrationLeave`.
- Not gated: `calibration-next` and `calibration-back` (step navigation), `print-ruler-*`,
  `print-sample-receipt-*`, `test-printer-drawer`, `cancel-edit-printer`, and on the printer rows
  `print-test-page-*`, `deactivate-printer-*`, `forget-pairing-*`, `edit-printer-*` (opens the
  name editor), `calibrate-printer-details`.
- Save-state cases: an existing printer's wizard reaches step 3 with Save quiet and disabled;
  changing paper width on step 1 makes it primary on step 3; changing it back makes it quiet; a re-added printer's wizard opens with Save enabled and primary, and pressing it untouched keeps
  the printer on (no `deactivatePrinter`) and stays primary while the request is in flight; a
  freshly added printer's wizard also opens with Save enabled and primary, and pressing it
  untouched closes the wizard with no update request (today's behaviour).
- Predicted changed checks (`printers-screen.test.ts`): "keeps the printer's saved paper width and
  resolution when calibration is run again" (~509–531) and "does not write unchanged calibration
  settings" (~818–825) — both press an untouched Save and expect no write: assert Save disabled
  instead (the second also expected the wizard to close; it now stays open until Cancel). Also
  (plan review): "does not resend detail edits when finishing calibration" (~827–880) edits the
  name and connection first, so the script missed it, but its calibration Save (~867) is pressed
  untouched: its `toHaveBeenCalledTimes(3)` would still pass with Save disabled, proving nothing —
  change one calibration setting before the press and assert the fourth call carries only that
  setting.
- Suites: `src/screens/printers-screen src/screens/printer-calibration.unsaved`.

### Task 3b.1c — printers: Add a printer (the name dialog and the Bluetooth Pair dialog)

- **Name dialog** (`confirm-add-printer`, ~3511–3518): bind `variant` through
  `saveActionState(this.#printerNameScope, { savableAtOpen: true })` (it stays `primary`, as
  today). Leave `#printerNameScope`'s registration (~582–592) as it is: the gate never reads it,
  and keeping it coordinator-only leaves `#registerDiscovered`'s scope branches (~1335–1343,
  ~1357–1375), `#beforePrinterNameClose` (~560–567) and the Add dialog's `.beforeClose` (~3736)
  untouched.
- **Bluetooth Pair dialog** (`confirm-pair`, ~3573–3580, fixed `variant="primary"`,
  `?disabled=${pinInvalid}`) on `#pairScope` (`?.register`, ~1597–1607, `parent:
  this.#addressScope?.id`): make it `draftScopeFor` and gate it (see "Two calls the plan reviewer agreed with").
  Early return in `#pair` (~1610) before `pairAttempted = true`. Leave paths:
  `.beforeClose=${this.#pairScope ? …}` (~3534), `#beforePairClose`'s `!this.#pairScope ||
  this.#pairLeave!` (~756–757), `#closeModal`'s `if (id === "pair-printer-modal" && this.#pairScope)`
  (~3165) — gate on `#pairLeave`. "Scope exists" branch in `#pair`: `if (scope && modal) { closeAfter
  … } else await this.#closeModal(…)` (~1630–1634). `closeAfter("saved")` only sets `open = false`
  (`packages/ui/src/components/wt-dialog.ts` ~155–157), so I believe both branches end the same
  way: keep `if (modal)` and delete the `else`.
- `#addressScope` (~2988–2998) stays as it is: the only action beside it, Check address
  (`probe-printer`), is a lookup that writes nothing (`#probe` ~1155 → `probePrinterAddress`), so it
  is not gated.
- Immediate, not gated: `open-add-printer`, `scan-printers`, `show-all-bluetooth`, `probe-printer`,
  `register-*` (opens the name dialog), `pair-*` (opens the Pair dialog), `forget-device-*`,
  `cancel-new-printer`, `resend-job-*`, `view-job-*`, `refresh-printer-lists`.
- Predicted changed checks: "asks for the PIN, checks it beside the field and in the bottom
  message, then pairs" (`printers-screen.test.ts` ~6876–6897) and "renders Bluetooth devices, Show
  all and the Pair dialog accessibly" (`printers-screen.a11y.test.ts` ~658–681) press Pair with the
  PIN empty to show its error: type an invalid PIN (`12 34`) first.
- Suites: `src/screens/printers-screen src/screens/printer-name.unsaved
  src/screens/printer-pair.unsaved src/screens/printer-address.unsaved`.

### Task 3b.2 — devices (`devices-screen.ts`)

- **Edit device** (`edit-save`, ~1988–1995, fixed `variant="primary"`, `?disabled=${blocked}`) on
  `{ isDirty: () => this.#editScope.isDirty() || this.#readerScope?.isDirty() }`. `#editScope` is
  registered with `?.register` in `#registerEditDraft` (~552–579) and `#readerScope` with
  `this.#editLeave?.register` once the readers arrive (~1095–1101): both become `draftScopeFor`
  (the reader scope still only once its read lands). Early return in `#submitEdit` (~1323) after
  `editSaving` and BEFORE `editAttempted = true`. Leave paths: `.beforeClose=${this.#editScope ||
  this.#readerScope ? …}` (~1921) — gate on `#editLeave`. `#beforeEditClose` (~512–520) already
  answers "close" without a coordinator, so it is safe as it stands, but binding on the
  coordinator keeps a widget test's close as direct as today.
- I believe no edit opens savable: the baseline is taken from the form as opened, after
  `heldBinding`, `#activeBinding` and the printer choices have been resolved (~1050–1074), so a
  stored value the form shows differently is part of the baseline. The save-state test fills
  every field: name, a kitchen device with a held switched-off station (as in ~1297), all three
  printers, made-here stations, approved profiles and a card reader.
- **Pair** (`pair-submit`) opens savable — see above.
- Immediate, not gated: `edit-device-*`, `remove-*` (two-tap), `open-add-device`, `pair-*` on the
  waiting list, the number choices (`#checkNumber`), `add-device-close`.
- Predicted changed checks (`devices-screen.test.ts`; each presses Save untouched through its
  `save()` helper, ~1161): ~1297, ~1331 ("…saves it unchanged" with a held station or watcher),
  ~1686 ("Save keeps both, unchanged"), ~1720, ~1861, ~1876, ~2013, ~2055 ("a name clash shows
  under Name"), ~2174, ~2228, ~2248, ~2283, ~2429 ("sends one request however often Save is
  pressed"), ~2552, ~2816; `devices-screen.a11y.test.ts` ~420 and ~509 (refusal states). A test
  whose point is that an untouched Save sends the held values unchanged becomes the 3a.4a shape:
  the form opens disabled (which shows the held values read back equal), then one field is edited
  and every OTHER field is sent as it was.
- Suites: `src/screens/devices-screen src/screens/device-edit.unsaved
  src/screens/device-pair.unsaved`.
- This task is the size of 3a.3 (receipts): commit at a green point and hand over if it nears ~80
  tool calls (done, left, files, each check's state). While working, filter runs by test name
  (`-t`); run the whole suites for the throw-probe and the final pass.

### Task 3b.3 — device profiles (`device-profiles-screen.ts`)

- `profile-save` (~2138–2144, fixed `variant="primary"`, `?disabled=${this.saving || ownMarked}`)
  on `{ isDirty: () => this.#draftScope.isDirty() || this.#readerScope?.isDirty() }`. Both are
  registered with `this.#leave?.register` — `#registerDraft` (~540–566, `id: this`) and
  `#loadReaders` (~1001–1011, `parent: this`): both become `draftScopeFor`. Early return in `#save`
  (~1287) after `saving` and BEFORE `attempted = true`.
- Leave path: `#cancel`'s `if (this.#draftScope) await this.#leave!.request(…)` (~1242) — gate on
  `#leave`.
- A new profile with nothing typed opens unchanged: `#openCreate` (~903–931) takes the baseline
  after the draft is cleared, and moves it (`scope?.commit`, ~921) when it fills in a venue's only
  department, so that fill-in is not a change. Its name is required (`#save` ~1286 comment), so
  it is not savable at open. I believe no edit opens savable either: `#openEditor` (~935–987) drops
  switched-off zones (`liveZones`) BEFORE `#registerDraft`, and `#extrasToSend` (~1190–1221) sends
  nothing for a part that matches what was loaded.
- **Duplicate is immediate**: `#duplicate` (~1390–1439) creates the copy straight away
  (`createDeviceProfile`, ~1422) with no dialog. Also immediate: `create` (opens the editor),
  `edit-*`, `delete-*` and `confirm-delete`. The printer list's up/down buttons are draft edits.
- Predicted changed checks (`device-profiles-screen.test.ts`; the `editListed`/`editKitchen`/
  `openEdit` helpers open without editing, `openCreate` ~1352 types a name): ~446 and ~531 (Edit
  then Save untouched), ~1014, ~1030, ~1256 ("sends no lists when they are unchanged"), ~1757,
  ~1772, ~2060 ("sends no default or drawer list a save leaves alone"), ~2109, ~2123, ~2184,
  ~2214, ~2231. The "…unchanged"/"…leaves alone" ones take the 3a.4a shape described in 3b.2.
- Suites: `src/screens/device-profiles-screen` (the `.test`, `.a11y.test` and `.unsaved.test`
  files).
- This task is the size of 3a.3 (receipts): commit at a green point and hand over if it nears ~80
  tool calls (done, left, files, each check's state). While working, filter runs by test name
  (`-t`); run the whole suites for the throw-probe and the final pass.

### Task 3b.4 — payments (`payments-screen.ts`)

- **Rename a reader** (the reader dialog in `edit` mode: `save-reader`, ~1786–1793). The same
  button is `confirm-unpair` in `unpair` mode, which stays as it is (immediate). In edit mode bind
  `variant` and `?disabled=${this.busy || invalid || s.unchanged}` from
  `saveActionState(this.#editScope)`. `#editScope` is registered with `this.#readerLeave?.register`
  in `#openEditor` (~741–749): make it `draftScopeFor`. Early return in `#saveEditor` (~773) for
  edit mode only, BEFORE `editAttempted = true`. Leave path: `.beforeClose=${this.#editScope ? …}`
  (~1728) — gate on `#readerLeave`; `#beforeEditorClose` (~435–439) already starts with
  `!this.#readerLeave ||`.
- **Bill attestation** (`confirm-bill-attest`, ~1250–1256, no `variant` today, `?disabled=${invalid}`)
  on `#billScope` (`this.#billLeave?.register`, ~847–855): make it `draftScopeFor`, gate it (see
  "Two calls the plan reviewer agreed with"). Early return in `#attestBill` (~903) BEFORE `billAttempted = true`. Leave
  path: `.beforeClose=${this.#billScope ? …}` (~1166) — gate on `#billLeave`; `#beforeBillClose`
  (~401–405) already starts with `!this.#billLeave ||`.
- **Add a reader** rows (`adopt-*`) open savable — see above; their per-row scopes (~638–645) stay.
- Immediate, not gated: `connect-*`, `disconnect-*` (two-tap), `add-reader-*`, `pair-new-reader`,
  `cancel-discovery`, the reader rows' `edit-*`, `label-*`, `details-*`, `enable-*`/`disable-*`,
  `unpair-*` and `confirm-unpair`, `refresh-readers`, `check-*` and `confirm-bill-check`,
  `attest-*` (opens the dialog), `refresh-bill-recovery`, `resolve-*` and `confirm-resolve`. The
  connect form and the pairing panel (`connect-form-*`, `add-reader-dialog-*`) are the payment
  modules' own panels, in batch 4.
- Predicted changed checks (`payments-screen.bill-recovery.test.ts`): "requires a confirmed
  outcome, note and PIN before attesting a refund" (~246), "on an invalid submission focuses the
  first invalid field" (~362), "re-checks every change after a failed submission" (~390), the
  outcome case near ~643 — each presses Record with the form empty: fill one field wrongly first;
  "starts again when the form is reopened: no messages and Record working" (~467) — the reopened
  form now opens with Record DISABLED; `payments-screen.a11y.test.ts` ~300–312 presses Record
  empty for the errors state: one field first. No rename test predicted: each types a name first.
- Suites: `src/screens/payments-screen src/screens/payment-attestation.unsaved
  src/screens/payment-readers.unsaved` (the first covers `.test`, `.a11y.test` and
  `.bill-recovery.test`).

### Task 3b.5 — canvases (`canvas-editor-screen.ts`)

- **Editor Save** (`save`, ~1320–1326, fixed `variant="primary"`, `?disabled=${this.saving}`) on
  `#editorScope`, registered with `this.#leave?.register` inside `willUpdate` (~298–313): make it
  `draftScopeFor`. Its `commit` then asks for an update from inside `willUpdate` (~312); I believe
  Lit folds that into the update already running, but check the run for a "scheduled an update
  after an update completed" warning and for an update loop. Early return in `#save` (~808) after
  its `saving` check. A NEW canvas's editor opens enabled with no flag (its baseline is `null`,
  ~502 and ~312): a save-state case pins that, beside an existing canvas opening quiet.
- **Duplicate** (`confirm-duplicate`) opens savable — see above; its scope (~338–351) stays.
- **Create** (`confirm-create`, ~1002–1008) is NOT a save: it writes nothing (`#confirmCreate`,
  ~496–511) and opens the editor. Leave it as it is, and its scope (~319–333) too.
- Leave paths: none to change. `#requestCancelEditor` already gates on `#leave` (~251–262), and the
  create and duplicate dialogs' `.beforeClose` bindings (~984, ~1017) read scopes that stay
  coordinator-only.
- Immediate, not gated: `create`, `edit-*`, `duplicate-*` (opens the dialog), `delete-*` and
  `confirm-delete`, `editor-cancel`, `canvas-settings`. The tab bar, palette, card and tab buttons
  are draft edits.
- Predicted changed checks (`canvas-editor-screen.test.ts`): "Save on an existing canvas calls
  updateCanvas and returns to the list" (~670), "surfaces a server canvas.name_taken rejection"
  (~704), "keeps the newer canvas open when an earlier save finishes" (~916), "does not save twice
  before the disabled state renders" (~955) — each opens an existing canvas and presses Save
  untouched: one edit first. The `.unsaved.test.ts` presses all follow `canvasName(…)`. Also
  (plan review): "ignores move and resize intents naming a card the tab does not have" (~1359)
  and "keeps the last tab when its delete is clicked anyway" (~1374) make an edit that changes
  nothing, then press Save and expect `updateCanvas` with the unchanged definition: assert Save
  stays disabled instead, which proves the ignored edit changed nothing.
- Suites: `src/screens/canvas-editor-screen` (the `.test`, `.a11y.test` and `.unsaved.test`
  files).

### Task 3b.6 — look, docs, backlog

- Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test
  src/dashboard-app.a11y.test` once: they mount the printers, devices, device profiles, payments
  and canvas screens to check routing and headings (`dashboard-app.test.ts` ~1790, ~1863, ~1875,
  ~2623, ~5433–5440; `dashboard-app.a11y.test.ts` ~503–518) and press none of their Saves except
  the printer page editors already run in 3b.1a. No `dashboard-app.*unsaved*` or settings-panels
  test mounts any of the five (`git grep -l` of each element name over `apps/dashboard/src`,
  2026-10-08).
- LOOK (dev stack from the worktree, `wa-wt demo waitron-feat-save-follows-changes-hardware`;
  check port 8080 and the venue folder's holders first): each form above unchanged and after one
  edit, desktop, light, English — including the forms that open savable (name a printer, a
  freshly added and a re-added printer's wizard, device pairing, Add a reader with several readers, duplicate a
  canvas). Then 390px, dark, Spanish on the printers screen (the printer page's name editor and
  the calibration wizard) and one dialog (Edit device).
- `docs/developers/design-system.md` → Forms: add a "batch 3b" line to the list of forms that
  follow the rule, and name the 3b forms that open already savable beside the backup paragraph
  (the name-a-printer dialog, the calibration wizard when an add opened it, device pairing, Add a reader,
  duplicate a canvas).
- Root `CLAUDE.md` §3: the clause becomes "the forms that follow it are listed in
  design-system.md", naming no batches. It is format-checked: run `pnpm format:check`.
- `docs/backlog.md` A331: batch 3b's status in the headline, and
  a 3b bullet listing the forms, the ones that open savable, and what the look found.
- Light review path (no risk trigger).

## Batch 4c — the venue-service forms nobody else is changing, and the till's profile dialog (Lane C, A331-4c)

Branch `feat/save-follows-changes-venue-service`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-save-follows-changes-venue-service`. Line
numbers (~NNN) were read at `9845a79a5` on 2026-10-08 and checked by the plan's fresh-context
reviewer, whose findings are folded in. Not in this batch, because other lanes are
changing them: `hours-screen.ts`, `menu-timetable-screen.ts`, `venue-operations-screen.ts` (lane D's
`feat/service-periods-slice-1`), `prep-stations-screen.ts` (lane E's `fix/drag-edge-scroll`), every
`configuration-transfer*` file, and `apps/till/src/i18n/codes*` (#1399). This batch edits none of
them; a changed check in `prep-stations-screen.test.ts` is allowed (a test file only, different
hunks from a drag test), and whichever branch lands second rebases. (2026-10-08: #1416, which was
`fix/drag-edge-scroll`, landed first; this branch rebased onto it.)

**The 3a rules block and Batch 5's three extra rules apply to every task** (watch for
`Unhandled error`; the temporary THROW probe at each new early return; an `if (scope) … else …`
whose `else` stood for "no coordinator"). Also design-system.md → Forms: a form that takes its scope
in `willUpdate` and disposes it on disconnect returns before `draftScopeFor` while
`!this.isConnected`, with a reconnect case in its `*.unsaved.test.ts`. Checks per task: the named
suites, the package's `typecheck`, `pnpm format:check`, `pnpm lint`, `git commit -s`.

| Form | Decision | Why |
| --- | --- | --- |
| Local holiday, Add and Edit (`local-holidays-editor.ts`, `data-test="save-local"`, editor `kind: "entry"`) | SAVE | Writes a stored holiday (`api.saveLocalHoliday`, ~303); Edit opens pre-filled from the stored entry, Add opens empty. |
| Local holiday, Remove and Forget an earlier address (same modal, `kind: "remove"` / `"forget"`) | ACTION | A confirmation of a delete; drawn `danger`, unchanged. |
| Holiday area (`holidayArea` combobox) | ACTION | Saves on choice (`#saveArea`, ~514); there is no Save button. |
| Watcher, New and Edit (`watcher-form.ts`, `data-test="save-watcher"`) | SAVE | Emits `watcher-save`, which the prep stations screen writes (`prep-stations-screen.ts` ~2999); Edit opens pre-filled from the stored watcher. |
| Till profile (`apps/till/src/widgets/profile-dialog.ts`, `data-test="profile-switch"`) | SAVE | Changes the device's stored profile (`api.switchDeviceProfile`, `till-app.ts` ~4466); opens on the active profile. Pressing Switch with the active profile still chosen sends no request today — the app closes the dialog (`till-app.ts` ~4413–4416; pinned by `till-app.test.ts` ~15922–15932 and ~16294–16300) — so gating stops nothing that reaches the server, and a different profile's switch is sent exactly as before. That is why this batch takes the light review path although a profile bounds what a till may do (CLAUDE.md §3). |

No form here opens already savable, so none passes `savableAtOpen`.

### Task 4c.1 — local holidays (`packages/venue-service/src/dashboard/local-holidays-editor.ts`)

`#begin` (~201–237) registers the entry scope with `this.#leave?.register` — make it
`draftScopeFor(this, owner)` (same owner), keeping `#leave` as the coordinator it returns. Leave
paths that read "a scope exists" and must gate on the coordinator too: `#open` (~189–199,
`if (scope) this.#leave!.request…`), `#beforeClose` (~228–236, `!scope || …this.#leave!…`), and
Cancel (~491–495, `if (!this.#scope) this.#close()`). Save (~498–506): for an entry,
`variant=${s.variant}` and `?disabled=${this.busy || own errors || s.unchanged}`; for remove and
forget keep `variant="danger"` and today's `?disabled` — compute `s` and the early return only when
`editor.kind === "entry"`, because Remove and Forget have no scope and `saveActionState(undefined)`
reads as unchanged; they still take `#leave` from the coordinator. The early return goes in `#submit`
(~279) before `attempted` is set, for an entry only. The new-entry "the address moved" warning (~288–296)
keeps the draft changed, so the second press still sends. Equality is today's (date, trimmed name).
Tests first, in a new `local-holidays-editor.save-state.test.ts`: Edit opens disabled/secondary on
host and inner button; Add with nothing typed opens disabled; one edit enables primary; typing the
stored value back (and the stored name with spaces around it) disables it; an untouched press sends
no `saveLocalHoliday`; a refused save stays enabled; Remove and Forget open enabled and `danger`.
Axe both states, both themes, in `local-holidays-editor.a11y.test.ts` (~134, ~146). Predicted
changed checks (the reviewer's reading; the throw-probe still runs): `local-holidays-editor.test.ts`
~392 presses an empty Add and is the only test asserting "Enter a date." and "Enter a name." — a
blank name equals the empty baseline (equality trims), so the two can no longer show together:
split it into a name typed with no date ("Enter a date.") and a date typed with a blank name ("Enter
a name."); ~634 (an `it.each` of seven Edit cases, whose ~641 asserts the unedited name) and ~899
(Edit) edit the name before pressing, and ~641 expects the edited name; ~680 asserts `disabled ===
false` on a reopened empty Add — it becomes `true`, then one edit and `false` (it is not a press, so
the throw-probe does not find it); `a11y.test.ts` ~134 presses an empty Add — type a name only. Suites: `pnpm --filter @waitron/venue-service exec vitest run
src/dashboard/local-holidays-editor src/dashboard/hours-screen`.

### Task 4c.2 — watchers (`packages/venue-service/src/dashboard/watcher-form.ts`)

`willUpdate` (~123–162, registering at ~147–160) takes the scope with `leaveCoordinatorFor(this)` and `this.leave?.register`:
make it `draftScopeFor(this, owner)`, returning first while `!this.isConnected` (it disposes on
disconnect, ~87–93), and override `connectedCallback` to call `super.connectedCallback();
this.requestUpdate();` as the batch 5 dialogs do (`party-name-dialog.ts` ~51–54,
`station-choice-dialog.ts` ~57–60): Lit runs no update on reconnect, so without it Save is stuck
disabled and the first edit's `willUpdate` re-seeds the draft and wipes that edit. The reconnect case
in `watcher-form.unsaved.test.ts` removes the form, re-appends it, edits, presses Cancel and expects
the question; with the `isConnected` return deleted it must fail. `requestLeave`
(~111–117, `if (!this.scope) return true; … this.leave!.request`) gates on the coordinator.
`commitSubmitted` (~119–123) keeps its contract (true when the form is now clean) but its
`equalInput` fallback stood for "no scope", which can no longer happen while connected: delete the
fallback if unreachable, or say why not. Save (~341–346, no `variant` today, so `secondary`): bind
`variant=${s.variant}` and `?disabled=${this.busy || (this.attempted && this.invalid) || s.unchanged}`;
the early return goes in `save()` (~227) before `attempted` is set. Tests first, in a new
`watcher-form.save-state.test.ts`: an existing watcher with stations, zones, "every" choices and
`runsPass` filled opens disabled/secondary; New opens disabled; one edit enables primary; undoing it
(re-ticking the same station, retyping the name) disables it; an untouched press emits no
`watcher-save`; a refused save (`refusal` set) stays enabled; after `commitSubmitted` with the form
still mounted, Save goes quiet. Axe both states, both themes, in the new file (there is no
`watcher-form.a11y.test.ts`). Predicted changed checks (the reviewer's reading; the throw-probe still runs):
`watcher-form.test.ts` ~40 is its only untouched press — typing spaces into the name is not a change
(`input` trims it), so toggle `runsPass` instead, which is a change and leaves all three fields
invalid; `watcher-form.unsaved.test.ts` ~333 saves a seeded Edit whose draft (`"  Pass  "`, stations
in reverse order) equals its baseline, so it will emit nothing; ~361 and ~404 press a form already
out of the page — they trip the throw-probe (no scope) but pass with the plain `return`, so they are
not changed checks. `prep-stations-screen.test.ts` presses `data-test="save-watcher"` three times
(~5164, ~5182, ~5186), each after an edit; its other `save-watcher-*` buttons are different, ungated
buttons. Suites: `pnpm --filter @waitron/venue-service exec vitest run
src/dashboard/watcher-form src/dashboard/prep-stations-screen src/dashboard/watchers-seen`.

### Task 4c.3 — the till's profile dialog (`apps/till/src/widgets/profile-dialog.ts`)

It has no draft scope, and does not get one registered with the app's coordinator: the app asks
that coordinator about `scopes: "all"` (except the basket) before switching (`till-app.ts`
~4415–4436), so a registered dialog scope would join the question the switch itself asks. "Changed"
is the one comparison `this.chosen !== this.activeProfileId`, passed as
`saveActionState({ isDirty: () => … })` (as `receipts-screen.ts` ~274 passes its own `isDirty`). This is the one
place a comparison is written per form, against design-system.md → Forms' "never a second comparison
written per screen": there is no first one, and a registered scope would join the app's question;
Task 4c.4 says so in Forms.
`data-test="profile-switch"` (~122–127, fixed `variant="primary"`) binds `variant=${s.variant}` and
`?disabled=${s.unchanged}`, keeping `?loading=${this.busy}`; its click handler returns early while
unchanged. The app's own `profileId === this.activeProfileId` branch (`till-app.ts` ~4411–4414)
stays: it is the app's rule for an event, and tests dispatch the event directly. A refusal (about
the chosen profile, or an order-open or draft notice) leaves the choice changed, so Switch stays
enabled. Tests first in `profile-dialog.test.ts` (or a new `profile-dialog.save-state.test.ts`):
opens disabled/secondary on host and inner button; choosing another profile enables primary;
choosing the active one again disables it; an untouched press emits no `profile-switch`; with a
`device_profile.not_approved` notice and a different choice, Switch is enabled. Axe both states,
both themes, in `profile-dialog.a11y.test.ts`. Predicted changed checks: none (the reviewer's reading: the one
real press, `till-app.test.ts` ~16022, chooses another profile first; the other uses dispatch the
event directly). The throw-probe still runs. Suites: `pnpm --filter @waitron/till exec vitest run
src/widgets/profile-dialog src/till-app.test src/till-app-boot-and-counter src/till-app-drafts
src/till-app-menu-timetable`.

### Task 4c.4 — look, docs, backlog

LOOK (forms mounted with test data in Chromium, as batch 5 did; or the dev stack from this worktree,
checking port 8080 and the venue folder's holders first): each form unchanged and changed at 1280px,
light, English; the watcher form and the profile dialog also at 390px, dark, Spanish. design-system.md
→ Forms: add the three forms and the till profile decision to the list of forms that follow the rule,
and one sentence naming the profile dialog as the stated exception to "never a second comparison"
(why: Task 4c.3);
`willUpdate` paragraph: add the watcher form if it takes the `isConnected` return. Update the A331
backlog entry: batch 4c landed, the profile dialog open point closed, batch 4b's remaining forms
(hours, timetable, operations, prep stations) still open. Light review path.

## Batch 2a — catalogue and menus forms outside lane D's Preview bundle (15 files)

Branch `feat/save-follows-changes-catalogue`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-save-follows-changes-catalogue`. Line
numbers (~NNN) were read from the tree at `3abb870b6` on 2026-10-08. Paths are under
`apps/dashboard/src/`. Lane D's `feat/preview-a349-a350-a351-a352` (tip `2949198b0`) changes
`screens/menus-screen.ts` and `menus-screen.test.ts`, `navigation*`, `menu-preview*`,
`menu-prices-table*`, `menu-structure-table.ts`, `menu-document-tree*`, `menu-tree-presentation.ts`,
`product-media.ts` and `i18n/strings.ts`; none of the 15 files below, and none of their own test
files. Open PRs #1399 and #1309 touch no file under `screens/` or `widgets/`; #1416 touches
`widgets/product-list.ts` and `packages/ui`'s reorder table, none of the 15 (`gh pr view <n> --json
files`, 2026-10-08).

**The 3a rules block and the two 3b rules apply to every task below.** Three more, for this batch:

- **No edit to lane D's files or to `menus-screen.test.ts`, `menus-screen.a11y.test.ts`,
  `screens/menu-details.unsaved.test.ts` (it mounts `dashboard-menus-screen`) or
  `navigation.test.ts`.** `widgets/menu-selections.unsaved.test.ts` and
  `widgets/menu-publications.*.test.ts` match the `menu-*.test.ts` pattern but test 2a widgets alone
  and lane D's branch leaves them alone, so they are 2a's to edit. A task whose widget
  `menus-screen.ts` mounts runs `src/screens/menus-screen.test.ts` UNEDITED, throw-probe included; a
  failure there caused by the gate means that widget moves to 2b: revert it and say so.
- **A refusal handed to an untouched form fails by assertion, not by the throw-probe.** Tests that
  mount a form with `fieldErrors` (or emit the form's own event — `wt-submit`, `create-ingredient`
  — from outside with values the form never held) and then assert Save enabled now see Save
  disabled, because nothing was edited. In the app a refusal always follows a changed press, so
  make the edit in the form first and keep the "a refusal never disables Save" assertion. Find
  them with `rg -U -n 'disabled,?\s*\)\.toBe\(false\)|disabled"\)\)\.toBe\(false\)'` over the
  task's suites: prettier wraps most screen-level ones as `.disabled,` / `).toBe(false)` on two
  lines, which a one-line grep misses (it finds none of the three in `units-screen.test.ts`,
  `recipe-screen.test.ts` and `modifiers-screen.test.ts`).
- A form that opens on a stored value it shows differently (a normalised default, a 0 shown as an
  empty box) takes that shown value as its baseline, so it opens quiet. A test whose point is that
  an untouched Save sends that value takes the 3a.4a shape: the form opens disabled, one OTHER
  field is edited, and the value is sent as shown.

**Forms that open already savable:** none. `git grep -n -i 'duplicat\|clone\|prefill'` over the
15 files finds only `extra-list-form.ts` ~613 (a validation message). Checked opening by opening:
every create opens empty — the unit form from the catalogue screen has no `.value` at all
(`catalogue-screen.ts` ~885–893), the list forms get `null` for a create (~903, ~914–918;
`modifiers-screen.ts` ~666, ~680), the menu form gets `menuDetails = null` for a create
(`menus-screen.ts` ~1199–1212), the option window gets `null` for Add option
(`option-list-form.ts` ~711); the pickers open with nothing chosen (`add-to-menus.ts` ~165–170;
`section-add-products.ts` keeps no `selected` input); and a move opens on the queued version's
stored date and time (`menu-publications.ts` ~430–431), where pressing Move untouched changes
nothing. The catalogue default VAT class is always a stored `VatClass`
(`packages/catalogue/src/settings-types.ts` ~4), so the panel opens on a valid stored value.
(2026-10-08: superseded for one opening by A410 — the option window opened showing a refusal the
list handed it passes `savableAtOpen`; see design-system.md → Forms.)

**Not a save, not gated (no code change):**

- `screens/units-screen.ts` — the unit editor is `unit-form` (2a.2). The screen's own scope
  (`#reassignmentScope`, ~147–164) backs the in-use dialog's "Change unit" (`change-unit`,
  ~672–682): an operation on the selected products, beside the dialog's own Delete (`delete-unit`,
  danger, ~710–716). Its `?disabled` (~675–679) holds while either products or a target is
  missing, so it already holds whenever its scope is unchanged (baseline `{ products: [], target:
  "" }`, ~163, ~166, ~376), and `#changeUnit` already returns on the same condition (~358–364).
  Treat it
  as an action: it keeps `variant="secondary"`, and the scope stays coordinator-only.
- `widgets/catalogue-browser.ts` — its scope (`#operationScope`, ~145–147, ~207–222) backs the
  move/delete dialog (`#operationDialog`, ~521–740), a confirmation of an operation on the
  selection. Delete (`confirm` in delete mode, danger) is pressed with its default contents choice
  (`move_up`, ~147, ~313), so gating it would block the delete. Move already stays disabled until
  a destination is chosen (~731), the one thing that makes its scope changed (~147, ~305). No
  change; the colour chooser and inline naming were classified as non-saves in batch 7.
- `widgets/image-upload.ts` — no Save. Its picker dialog acts at once: choosing an image
  (`select-image`, ~264–272) or Remove (~213–219, ~286–295) changes the PARENT's draft and closes.
  Its scope (~141–151, `equal: () => true`) never reports a change; it exists as the parent of the
  media library's scopes, whose Save batch 4a gated.

A ruling the owner may overrule, named in the PR: units' Change unit and the catalogue's Move keep
today's look (Move `primary` while disabled at open, Change unit `secondary`). Gating either would
change only its look, through `draftScopeFor` plus `saveActionState`.
_2026-10-08 (owner, A409): Move now draws `secondary` while it waits for a destination; see
design-system.md → Forms._

### Task 2a.1 — catalogue defaults and the recipe editor (`screens/catalogue-settings-panel.ts`, `widgets/recipe-editor.ts`)

Both stay on screen after a save, so each needs the "quiet again after a save" case.

- **Catalogue defaults** `save` (~204–212, fixed `variant="primary"`, `?disabled=${this.attempted
  && !this.#valid()}`) on `#scope`, registered with `leaveCoordinatorFor(this)?.register` inside
  the settings read's callback, once (~75–84): make it `draftScopeFor` there. Early return in
  `#save` (~138) after `!this.model || this.submitting`, BEFORE `attempted = true` (~140); the
  form's `@submit` (~176–179) goes through the same handler. `#requestCancel` (~128–136) already
  asks for the coordinator itself; leave it. `#setSaved` commits (~99–103), so a save turns Save
  quiet again. No early exit becomes unreachable: changing to an empty class is a change that
  `#valid` (~105–107) still refuses.
- **Recipe editor** `confirm` (~162–169, fixed `variant="primary"`, `?disabled=${this.busy}`) on
  `#scope` (`?.register`, ~99–110): make it `draftScopeFor`. Early return in `#confirm` (~122)
  after `busy`. `requestLeave` (~79–82) already gates on `#leave`. "A scope exists" site: the public
  `isDirty()` (~71–73, `?? false`) answered "not dirty" with no coordinator; it now answers truly,
  which changes `willUpdate`'s refetch branch (~92, a dirty draft is no longer overwritten by a
  fetched recipe) and `recipe-screen.ts` ~268 (a dirty editor keeps its product) in widget and
  screen tests. Both now match the app, where a coordinator always exists. Keep them; a test that
  relied on the old answer is a changed check. `commitSaved` (~75–77) commits inside the screen's
  save; the commit at ~96 runs inside `willUpdate` — check the run for a Lit "scheduled an update
  after an update completed" warning, as 3b.5 did.
- Predicted changed checks: `catalogue-settings-panel.a11y.test.ts` ~55–57 presses Save untouched
  for its "saving" and "save-error" states (choose another class first); `recipe-editor.test.ts`
  ~127–130 ("emits save-recipe as a bubbling, composed event") presses untouched.
- Suites: `pnpm --filter @waitron/dashboard exec vitest run src/screens/catalogue-settings-panel
  src/dashboard-app.settings-panels src/widgets/recipe-editor src/screens/recipe-screen`.

### Task 2a.2 — the unit form and the ingredient form (`widgets/unit-form.ts`, `widgets/ingredient-form.ts`)

- **Unit form** `submit` (~390–396, fixed `variant="primary"`, `?disabled=${this.busy ||
  invalid}`) on `#scope` (`?.register`, ~118–132): make it `draftScopeFor`. Early return in
  `#submit` (~223) after `busy`, BEFORE `attempted = true` (~226). "A scope exists" sites:
  `#beforeClose` (`this.#leave!`, ~76–78), `#cancel`'s `if (this.#scope)` (~275),
  `.beforeClose=${this.#scope ? …}` (~299) — gate all three on `#leave`. `#comparisonValue`
  (~254–260) trims, so a create holding only spaces is unchanged.
- **Ingredient form** `confirm` (~310–316, Create or Save, fixed `variant="primary"`,
  `?disabled=${this.busy || invalidName !== ""}`) on `#scope` (`?.register`, ~160–171): make it
  `draftScopeFor`. Early return in `#confirm` (~216) after its connected/open/busy check, BEFORE
  `attempted = true` (~219). "A scope exists" sites: `#beforeClose` (`#leave!`, ~85–88),
  `.beforeClose=${this.#scope ? …}` (~271) — gate on `#leave`. It has no Cancel button. Its
  `commit` calls inside `willUpdate` (~154, ~170) now request an update: check for the Lit warning.
  The name compares untrimmed (`#current`, ~102–109), so "   " is a change that `#nameError`
  refuses: the error contract, not the gate, handles it.
- Predicted changed checks (`unit-form.test.ts`): ~281–305 and ~307–325 open a stored unit, switch
  the default language and press untouched to see the missing translation's error (edit one field
  first); ~520–525 presses an empty create; ~584–592 mounts with a refusal and presses untouched;
  ~609–614 "starts again when reopened… Save working" (Save now opens disabled); by assertion,
  ~489–500 (an empty create asserted enabled) and ~546–556 (a refusal at mount, no edit, asserted
  enabled). By assertion: `units-screen.test.ts` ~467–475 and `catalogue-screen.test.ts`
  ~1366–1382 emit `wt-submit` with values the form never held, then assert Save enabled — type the
  values into the form and press; `recipe-screen.test.ts` ~270–293 does the same to the ingredient
  form with `create-ingredient`.
  (`ingredient-form.test.ts`): ~138–142, ~164–166, ~190–192, ~210–212 and ~483–488 press an
  empty create; ~182–188 asserts an empty create enabled; ~273–283 and ~351–364 press an untouched edit
  to check the patch sent (3a.4a shape).
- Suites: `src/widgets/unit-form src/screens/units-screen src/screens/unit-owners.unsaved
  src/widgets/catalogue-forms.unsaved src/screens/catalogue-screen src/widgets/ingredient-form
  src/screens/recipe-screen`.

### Task 2a.3a — the option window (`widgets/option-label-form.ts`)

Split from the option list (2a.3b) for size; the window goes first, and each commit is green alone.

- `save` (~347–352, fixed `variant="primary"`, `.disabled=${this.busy || invalid}`) on `#scope`
  (`?.register` in `#registerDraft`, ~102–118, `parent: this.draftParent`): make it
  `draftScopeFor`. Its Save writes into the list's draft, not to the server (`option-list-form.ts`
  `#saveLabel`, ~382–397, which calls `closeSaved`) — gated like batch 1's variant form. Early
  return in `#submit` (~188) after `busy`, BEFORE `attempted = true` (~191). "A scope exists"
  sites: `#beforeClose` (~91–93), `#cancel` (~234), `.beforeClose` (~296) — gate on `#leave`. Add
  option opens empty (`.value=${editing === "new" ? null : editing}`, `option-list-form.ts` ~711):
  the name is required (`#validate`, ~165–167).
- Predicted changed checks (`option-label-form.test.ts`): ~353–355, ~421–428, ~442–444 (an empty
  press, a refusal at mount pressed untouched, "starts again when reopened… Save working"); its
  enabled-Save assertions at ~283, ~332–339 and ~368–394 are to be read against the assertion
  rule above. The throw-probe over `option-list-form.test.ts` finds any list test that presses the
  window's Save untouched; those are this task's.
- Suites: `src/widgets/option-label-form src/widgets/option-list-form
  src/widgets/modifier-forms.unsaved src/widgets/section-details-form.test.ts`
  (`section-details-form.test.ts` ~347–352 mounts the option window for a style comparison only).

_2026-10-08 (owner, A410): the option window opened showing a refusal the list handed it now opens
with Save active; see design-system.md → Forms._

### Task 2a.3b — option lists (`widgets/option-list-form.ts`)

- `save` (~794–799, fixed `variant="primary"`, `.disabled=${this.busy || invalid}`) on `#scope`
  (`?.register` in `#registerDraft`, ~194–210): make it `draftScopeFor`. Early return in
  `#submit` (~458) after `busy`, BEFORE `attempted = true` (~461). "A scope exists" sites:
  `#beforeClose` (~183–185), `#cancel`'s `if (this.#scope)` (~513), `.beforeClose` (~736) — gate
  on `#leave`. `#reseed` normalises the default through `#keepDefault` (~271–272, ~278–280) before
  the scope registers (~242), so a list whose stored default is empty or unavailable opens quiet:
  the shown default is the one the server would store (`option-contract.ts` ~113 normalises with
  the same `effectiveDefaultLabelId`).
- Not gated: Add option (`add-option`, opens the window), Edit (`edit-label-*`), Delete
  (`remove-label-*`) and the default radios — draft edits of the list.
- Predicted changed checks (`option-list-form.test.ts`): ~951–958 and ~960–976 press untouched to
  see the normalised default sent (3a.4a shape); ~1560–1562 presses an empty create; ~1635–1643
  mounts with a refusal and presses untouched; ~1648–1650 "starts again when reopened… Save
  working". By assertion (a refusal at mount, no edit, then Save asserted enabled): ~978–988,
  ~1157–1161, ~1580–1582, ~1609–1611. `option-list-form.a11y.test.ts` ~82–84 presses the empty
  create for its "invalid" state.
- Suites: `src/widgets/option-list-form src/widgets/option-label-form
  src/widgets/modifier-forms.unsaved src/screens/modifiers-screen src/screens/modifier-owners.unsaved
  src/screens/catalogue-screen`.
- Commit at a green point and hand over if it nears ~80 tool calls. Filter by test name (`-t`)
  while working; run whole suites for the throw-probe and the final pass.

### Task 2a.4 — extras lists (`widgets/extra-list-form.ts`)

- `save` (~1084–1089, fixed `variant="primary"`, `.disabled=${this.busy || invalid}`) on `#scope`
  (`?.register` in `#registerDraft`, ~239–255): make it `draftScopeFor`. Early return in `#submit`
  (~710) after `busy`, BEFORE `attempted = true` (~713). "A scope exists" sites: `#beforeClose`
  (~228–230), `#cancel`'s `if (this.#scope)` (~725), `.beforeClose` (~987) — gate on `#leave`.
- Not gated: the add-product picker (~943–969, adds a row to the draft), remove (`remove-item-*`),
  reorder, preselected and portion fields — draft edits.
- `#reseed` shows a stored minimum of 0 as an empty box (~312–313), and that is the baseline.
- Predicted changed checks (`extra-list-form.test.ts`, from a script that looks for a press with
  no edit earlier in the same test; confirm each with the throw-probe): ~1311–1316 ("shows a
  saved minimum of 0 as the empty box, and saves it back as 0", 3a.4a shape), ~2213–2221 (refusal
  at mount, untouched press), ~2226–2228 ("starts again when reopened… Save working"); ~254–266,
  ~383–387, ~1044–1055, ~1068–1085, ~1112–1123, ~1326–1344, ~1372–1382, ~2370–2374 and
  ~2460–2471 were flagged too and may edit through a helper the script does not know.
  By assertion (a refusal at mount, no edit): ~440–455, ~789–793; `modifiers-screen.test.ts`
  ~1121–1143 opens a create, emits `wt-submit` from outside, then asserts Save enabled after the
  refusal — type a name into the form and press. `extra-list-form.a11y.test.ts` ~138–140
  ("invalid" state) and ~153–185 (a stored list with an empty required portion, pressed untouched
  to show the error: edit another field first).
- Suites: `src/widgets/extra-list-form src/widgets/modifier-forms.unsaved src/screens/modifiers-screen
  src/screens/modifier-owners.unsaved src/screens/catalogue-screen`.
- One file, so it cannot split along a file seam: commit at a green point and hand over if it
  nears ~80 tool calls.

### Task 2a.5 — the two pickers (`widgets/add-to-menus.ts`, `widgets/section-add-products.ts`)

Both are an Add whose staged input is a set of ticks; nothing ticked is unchanged.

- **Add to menus** `add-to-menus` (~374–381, fixed `variant="primary"`, `.disabled=${this.busy ||
  this.#noneChosen}`) on `#scope` (`?.register`, ~179–190): make it `draftScopeFor`. Early return
  in `#confirm` (~236) after `busy`, BEFORE `attempted = true` (~239). "A scope exists" sites:
  `#beforeClose` (~152–154), `#cancel`'s `if (this.#scope)` (~253), `.beforeClose` (~351) — gate on
  `#leave`. A placement failure re-ticks the failed sections and marks the draft changed
  (~171–174), and `commitAdded` commits `[]` (~257–261), so a retry stays enabled. The "nothing
  chosen" message (`#noneChosen`, ~216–218) stays reachable — after a press that sent something,
  unticking every place — so keep it and its `!sectionIds.length` branch (~241–244, reachable when
  a ticked failure names a section no longer listed). Skip (`skip`) is not gated.
- **Section Add products** `add` (~348–354, fixed `variant="primary"`, `.disabled=${this.busy}`) on
  `#scope` (`leaveCoordinatorFor(this)?.register`, ~150–160): make it `draftScopeFor` (there is no
  `#leave` to keep and no leave path; Cancel is slotted by the parent). Early return in `#confirm`
  (~219) after `busy`. The category filter and the search (~316–330) are not part of the draft.
  `#chosen` (~185–187) counts only products still offered, so ticks whose products have since
  entered the section (`inSection`) leave the draft changed with nothing to add: the
  "nothing chosen" message (~223–226) stays for that path.
- Predicted changed checks (`add-to-menus.test.ts`): ~239–249 (empty press; assert Add disabled,
  and reach the message through a press then unticking), ~251–258 (tick and untick: Save now
  quiet and disabled — this is the undo case, keep it as such), ~260–268, ~270–283, ~293–304 (empty
  presses and "Add working" after reopen), ~352–356 (asserts `variant="primary"` at open: tick a
  place first); `add-to-menus.a11y.test.ts` ~86–89 ("invalid" state, empty press).
  (`section-add-products.test.ts`): ~285–295 and ~497–504 press with nothing ticked (assert Add
  disabled; reach the message through ~256–267's path); `section-add-products.a11y.test.ts`
  ~81–84 ("invalid" state, empty press — same path). `menu-selections.unsaved.test.ts` ticks
  before every press (~98–100, ~119–131, ~227–241, ~273–274): no change predicted.
- `menus-screen.test.ts` mounts the products picker, but every Add there either emits
  `wt-add-products` itself (~2743, ~2759, ~3793, ~3909, ~3992) or ticks first (~8973–8985): no
  change predicted. Run it unedited (rule above).
- Suites: `src/widgets/add-to-menus src/widgets/section-add-products
  src/widgets/menu-selections.unsaved src/screens/catalogue-screen src/screens/menus-screen
  src/screens/menu-details.unsaved` (the last two prefixes take every suite that mounts the menus
  screen, lane D's included, all run unedited).

### Task 2a.6 — scheduling a menu (`widgets/menu-publications.ts`)

- `schedule-submit` (~794–803, Schedule or Move, fixed `variant="primary"`,
  `?disabled=${invalid}`, `.loading=${this.scheduleBusy}`) on `#scope` (`?.register` in
  `#openSchedule`, ~436–448): make it `draftScopeFor`. Early return in `#submitSchedule` (~504)
  after `scheduleBusy` (~507), BEFORE `attempted = true` (~508). "A scope exists" sites:
  `#beforeClose` (~269–271), `.beforeClose=${this.#scope ? …}` (~709) — gate on `#leave`. Close
  (`schedule-close`, ~786–792) always calls `requestClose`, which with no guard just closes: leave
  it.
- A move opens on the version's stored date and time (~430–431): unchanged until one of them
  changes. A schedule opens empty. After a `time_repeated` refusal the date and time stay as
  typed (`#placeRefusal`, ~554–563), so the draft stays changed and Save enabled. The
  `moving === null && preview === null` branch (~510–513) sets a refusal, not a silent return;
  keep it.
- Not gated: `schedule-open`, `move-*`, `cancel-*` (open dialogs), `cancel-confirm` (danger,
  immediate, ~676), `cancel-keep`, `editions-retry`.
- Predicted changed checks: `menu-publications.test.ts` ~648–652 (an empty schedule pressed to
  show both field errors: enter one field, press, and the other's error shows);
  `menu-publications.a11y.test.ts` ~169–187 presses the empty form for its states with no
  refusal. `menus-screen.test.ts` only reads the widget's properties (~5581–5592, ~5603–5611) and
  never presses `schedule-submit`: no change predicted; run it unedited.
- Suites: `src/widgets/menu-publications src/screens/menus-screen src/screens/menu-details.unsaved`
  (run unedited, as in 2a.5).

### Task 2a.7 — carried to 2b: the section and include dialogs (`widgets/section-details-form.ts`, `widgets/include-folder-form.ts`)

Only `menus-screen.ts` mounts these two (`git grep -n` of each element name: the menu form ~1978,
the section form ~2602, the include form ~2575), and gating either forces edits to
`menus-screen.test.ts`, so both wait for lane D's branch to land. The design, read at the same
sha, for 2b to take:

- **Section/menu details** `save` (~328–333, fixed `variant="primary"`, `.disabled=${this.busy ||
  this.pickerOpen || invalid}`) on `#scope` (`?.register`, ~118–133): `draftScopeFor`; early
  return in `#submit` (~177) after `busy || pickerOpen`, BEFORE `attempted = true` (~180); gate
  `#beforeClose` (~85–88), `#cancel`'s `if (this.#scope)` (~214) and `.beforeClose` (~235) on
  `#leave`. Not savable at open (create opens empty). Forced `menus-screen.test.ts` changes: ~1796–1807
  and ~2030–2046 press an empty create; "the name forms" (`it.each` over menu and new-section,
  ~7799–7957): ~7855–7861 types " " (trimmed, so unchanged) and asserts Save enabled, ~7863–7874,
  ~7908–7928, ~7931–7944, ~7946–7955 press with the name emptied back to "". Its own suites:
  `section-details-form.test.ts`, `.a11y`, `.unsaved`, and `menu-details.unsaved.test.ts`
  (mounts the menus screen).
- **Include folder** `save` (~359–364, fixed `variant="primary"`, `.disabled=${this.busy ||
  this.pickerOpen}`) on `#scope` (`?.register`, ~141–154): `draftScopeFor`; early return in
  `#submit` (~193) after `busy || pickerOpen`; gate `#beforeClose` (~100–103), `#cancel` (~240)
  and `.beforeClose` (~315) on `#leave`. It edits an existing include (opened from the row's Edit,
  `menus-screen.ts` ~2195): not savable at open. Forced `menus-screen.test.ts` changes: ~4255–4279,
  ~4281–4317 (`it.each`, two rows) and ~4319–4332 open an include and press Save untouched to see
  the server's refusal.

### Task 2a.8 — look, docs, backlog

- Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test
  src/dashboard-app.a11y.test src/dashboard-app.settings-panels src/dashboard-app.unsaved-changes`
  once: they mount screens that hold these forms (the catalogue, units and menus screens among
  them) and read the catalogue defaults panel's value (`dashboard-app.settings-panels.test.ts`
  ~230–247), and press none of this batch's actions (`git grep -n` of every element name over `dashboard-app*.test.ts`,
  2026-10-08).
- LOOK (`wa-wt demo waitron-feat-save-follows-changes-catalogue`; check port 8080 and the venue
  folder's holders first): each gated form unchanged and after one edit, desktop, light, English —
  catalogue defaults (and quiet again after a save), the recipe editor (and after a save), New and
  Edit unit, New and Edit ingredient, an option list with its option window, an extras list, Add to
  menus after creating a product (and after a refused place), the section's Add products, Schedule
  and Move on a menu's Preview. Then 390px, dark, Spanish on the extras list and the option window
  over its list.
- `docs/developers/design-system.md` → Forms (list ~1559–1581): add a "batch 2a" line naming the
  gated forms; under "These open already savable" (~1583) nothing is added. Add one sentence that
  units' Change unit, the catalogue's Move/Delete and the image picker take an action, pointing
  here.
- `docs/backlog.md` A331 (~1523–1526): batch 2a's status in the headline ("batches 2b and 4b
  OPEN"), and a 2a bullet listing the forms, the three not-a-save rulings, what the look found,
  and that 2b — the section/menu details form, the include dialog and the menus screen's own
  forms — waits on lane D's Preview branch.
- Light review path (no risk trigger).

## Batch 2b — the menus screen and the Preview bundle's files (Lane C, A331-2b)

Branch `feat/save-follows-changes-menus`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-save-follows-changes-menus`, off `main` at
`f11acc977` (lane D's Preview bundle, #1417, is on it). Line numbers (~NNN) were read there on
2026-10-08. Paths are under `apps/dashboard/src/`.

**Overlap with batch 2a.** Lane B's 2a (`feat/save-follows-changes-catalogue`, its own section of
this plan, not yet on `main`) hands two forms to 2b by name — its Task 2a.7, "carried to 2b: the
section and include dialogs" (`widgets/section-details-form.ts`, `widgets/include-folder-form.ts`)
— because only `menus-screen.ts` mounts them and gating them forces edits to
`menus-screen.test.ts`. The batch list above puts `section-*` and `include-folder-form` in batch 2,
but `git diff --name-only origin/main...feat/save-follows-changes-catalogue` (2026-10-08, 2a tip
`dc7f9229b`, with 2a.5 and 2a.6 committed) touches neither file nor any file below except this
plan, so 2b takes them. 2b does not edit 2a's files: `add-to-menus.ts`, `section-add-products.ts` and `menu-publications.ts`
(2a.5, 2a.6) are 2a's, though `menus-screen.ts` mounts all three. 2a's rule for 2a.5 and 2a.6 is
to run `menus-screen.test.ts` unedited, and to move a widget to 2b if the gate breaks it there; if
that happens, 2b takes it in a task added after 2a lands. Both branches edit this plan,
`design-system.md` → Forms and the A331 backlog entry: whichever lands second rebases and keeps
both.

**Rules.** The 3a rules block, and Batch 5's three extra rules (watch for `Unhandled error`; the
temporary THROW probe at each new early return; an `if (scope) … else …` whose `else` stood for "no
coordinator"), apply to every task. design-system.md → Forms: a form that takes its scope in
`willUpdate` and disposes it on disconnect skips `draftScopeFor` while `!this.isConnected`, asks for
an update when put back, and has a reconnect case in its `*.unsaved.test.ts`. Both 2b forms take
their scope in `willUpdate` and dispose it on disconnect (`section-details-form.ts` ~90–95, ~118–133; `include-folder-form.ts` ~105–110, ~141–154).
Two of 2a's rules apply too, restated here because 2a's text is not on `main`:

- **A refusal handed to an untouched form fails by assertion, not by the throw-probe.** A test that
  mounts the form with `fieldErrors` or `refusal` and then asserts Save enabled now sees it
  disabled, because nothing was edited. In the app a refusal always follows a changed press, so make
  an edit first and keep the "a refusal never disables Save" assertion. Find them with
  `rg -U -n 'disabled,?\s*\)\.toBe\(false\)|disabled"\)\)\.toBe\(false\)'` over the task's suites.
- **A form that opens on a stored value it shows differently takes that shown value as its
  baseline**, so it opens quiet. A test whose point is that an untouched Save sends that value
  instead edits one OTHER field and checks the value is still sent as shown.

Checks per task: the named suites, `pnpm --filter @waitron/dashboard typecheck`,
`pnpm format:check`, `pnpm lint`, `git commit -s`. Light review path: no risk trigger, no migration.

**Forms that open already savable:** none. `git grep -n -i 'duplicat\|clone\|prefill'` over the 2b
files finds only an error code (`menus-screen.ts` ~166) and `structuredClone` calls. Checked
opening by opening: a new menu opens with `menuDetails = null` (`menus-screen.ts` ~1207–1221), a
rename on the menu's stored root (~1213); a new section with `editingSection = null` (~1405–1408),
an edit on the stored section (~2218); an include's Edit on its stored folder or, with none,
`FOLLOWING_FOLDER` (`include-folder-form.ts` ~132), which is what a missing folder already reads as
(`packages/catalogue/src/section-graph.ts` ~105), so an untouched save changes nothing.

**Not a save — no code change** (each acts at once, confirms an operation, or only shows):

| Where | What | Why |
| --- | --- | --- |
| `menus-screen.ts` | Add a shortcut (~2507–2541), Include a menu (~2644–2674) | No Save button: choosing in the combobox writes at once (`#addShortcut` ~1615, `#includeMenu` ~1507). |
| `menus-screen.ts` | Delete section (`delete-section-save`, ~2676–2726) | A `danger` confirmation of a delete. |
| `menus-screen.ts` | The home display slider and radios (~2387–2398, ~2443–2456) | Each change saves at once (`#saveDisplay` ~1689). The device radios above them (~2367–2384) only switch which device's display is shown. |
| `menus-screen.ts` | Add menu, Reorder and Done, the retry buttons | Open a form, switch a mode, read again. |
| `menus-screen.ts` | The Add products window (~2735–2786) | Hosts 2a's picker. Its Cancel and `beforeClose` already ask for the coordinator itself (`leaveCoordinatorFor(this)`, ~1532–1537, ~2741, ~2776), so 2a's change to the picker needs nothing here. |
| `widgets/menu-prices-table.ts` | Each price override field (~870–886) and Undo (~1273–1285); Show clashes (~1178) | No Save button: a price saves on Enter or on leaving the field (`#commit` ~946); Undo writes the old price back at once; Show clashes only filters the table. |
| `widgets/menu-structure-table.ts` | Row menus' Add, Edit, Delete, Remove, the colour swatch, drag to reorder (~718–810) | Each opens one of the forms above or writes at once. |
| `widgets/menu-preview.ts` | Publish (`publish` ~732–741) and its confirmation (`publish-confirm` ~862–867) | Publishes the menu's staged changes, an operation; Publish is drawn only while there is something to publish (`#renderPublish` ~727–729). Show all changes, the view combobox (~698) and Retry change only what is shown. |
| `widgets/menu-document-tree.ts`, `widgets/menu-tree-presentation.ts`, `widgets/device-home-preview.ts` | — | Draw only: no form controls besides the preview's navigation tiles. |
| `widgets/menu-price-inheritance.ts`, `widgets/section-writes.ts`, `widgets/off-menus.ts`, `packages/catalogue/src/customer-menu-presentation.ts` (Batch 7 held `customer-menu*` for this work) | — | Helpers with no controls (`git grep -n 'wt-button\|register(\|leaveCoordinatorFor'` finds none). |
| `navigation.ts`, `i18n/strings.ts` | — | The URL map and `leftToBrowser` (~1–34); strings need nothing new. |

So the code change is two files; the rest of 2b is the menus screen's tests.

### Task 2b.1a — section and menu details: wire the gate (`widgets/section-details-form.ts`)

The menus screen mounts this one form twice: the menu form (create and rename,
`menus-screen.ts` ~1986–2007) and the section form (new and edit, ~2620–2642).

- In `willUpdate` (~118–133) replace `leaveCoordinatorFor(this)` + `this.#leave?.register` with
  `draftScopeFor(this, owner)` (same owner), `#leave` taking the coordinator. Skip that branch while
  `!this.isConnected` (the reseed and the `!this.open` dispose above it stay as they are), and add
  `override connectedCallback() { super.connectedCallback(); this.requestUpdate(); }`.
- "A scope exists" sites, to gate on `#leave`: `#beforeClose`'s `this.#leave!` (~85–88),
  `#cancel`'s `if (this.#scope)` (~214), `.beforeClose=${this.#scope ? …}` (~235).
- Save (`data-test="save"`, ~328–333, fixed `variant="primary"`): `variant=${s.variant}`,
  `.disabled=${s.unchanged || this.busy || this.pickerOpen || invalid}`. No early return yet (2b.1b),
  so tests that press an untouched Save still reach the handler; only checks that ASSERT the
  enabled state change in this task.
- `#submissionValue` (~191–202) trims the internal name and drops blank customer names, so typing
  `" "` into an empty create is unchanged. The `dispose()` calls inside `willUpdate` (~103, ~115)
  now ask for an update: read the run for Lit's "scheduled an update after an update completed"
  warning.
- Tests first, new `section-details-form.save-state.test.ts`: a stored section with both customer
  names, an image and a colour opens with Save disabled on the host and its inner `<button>` and
  `variant="secondary"`; a create with nothing typed opens disabled; one edit (name, a customer
  name, the colour, the image) enables it and draws it `primary`; typing the stored name back, and
  `" Drinks "` for `Drinks`, disables it; a changed form with an empty internal name, pressed, shows
  its error and stays `primary` and disabled; `fieldErrors` after a changed press keeps Save
  enabled; `commitSaved` with the form still open makes it quiet. Reconnect case in
  `section-details-form.unsaved.test.ts`: remove the open form, put it back, edit, press Cancel,
  and the question opens; with the `isConnected` skip deleted it must fail. Axe both states, both
  themes: add a "changed" state to `section-details-form.a11y.test.ts`.
- Predicted changed checks (assertions of the enabled state): `section-details-form.test.ts` ~185
  (reopened, now disabled), ~173 (the name typed back to `Drinks` is the undo: now disabled), ~197
  and ~212 (a refusal at mount, no edit: edit first); `menus-screen.test.ts` "the name forms"
  ~7841–7847 (types `" "` into an empty create: now disabled — assert that), ~7917–7930
  ("starts again when it is reopened": reopened disabled).
- Suites: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/section-details-form
  src/screens/menus-screen src/screens/menu-details.unsaved` (the `menus-screen` prefix takes the
  `.a11y`, `.heading` and `.home-columns` files too).

### Task 2b.1b — section and menu details: the early return, and the tests it changes

- `#submit` (~177) returns while `saveActionState(this.#scope).unchanged`, after the
  `busy || pickerOpen` return (~179) and BEFORE `attempted = true` (~180). Test first: an untouched
  press emits no `wt-submit`. Then the throw-probe over the 2b.1a suites. Some untouched presses
  show under the probe only as `Unhandled error` lines in tests that stay green: the a11y presses
  (`section-details-form.a11y.test.ts` ~38, `menus-screen.a11y.test.ts` ~315) are changed checks
  all the same; `menus-screen.test.ts` ~2071 is not — the live change has already closed the
  form, so that press sent nothing before either; leave it.
- Predicted changed checks (from reading; the throw-probe is the list that counts):
  `section-details-form.test.ts` ~8–23 (an empty create pressed: type a customer name, then press,
  and the internal name's error shows), ~222–237 (a translation refusal pressed untouched), ~238–264
  (the first press at ~247 is untouched), ~307–317 (no colour, pressed untouched: edit the name and
  check `color` is still sent as `null`); `section-details-form.a11y.test.ts` ~37–40 (the "invalid"
  state presses an empty create: type a customer name first). `menus-screen.test.ts`: ~1796–1815
  (empty menu create pressed at ~1803), ~2030–2060 (empty section create pressed at ~2042) —
  type a customer name first in both; "the name forms" (`it.each` over the menu form and the new
  section form), each test twice: ~7849–7872 (`""` into an empty create is no change: type a
  customer name, then empty the internal name), ~7894–7915 (the second press at ~7911 follows
  emptying the name back to unchanged), ~7917–7930 (its press at ~7920 is an empty create, which
  the test needs to have shown errors before the reopen: same fix as ~7849), ~7932–7945 (same as
  ~7849); `menus-screen.a11y.test.ts` ~309–318 and ~368–390 (blank name refused: type a customer name first). Presses after a typed
  name (~964, ~1074, ~1858, ~1874, ~1888–1894, ~1932, ~2022, ~2071–2151, ~2999, ~3178, ~3758,
  ~3772, ~8387) and `menu-details.unsaved.test.ts` (~94–107, fills the name first) should not change.
- Suites: as 2b.1a.

### Task 2b.2 — an include's Edit dialog (`widgets/include-folder-form.ts`)

- In `willUpdate` (~141–154) `draftScopeFor(this, owner)` (same owner, `#leave` from the
  coordinator), the same `isConnected` skip and `connectedCallback` as 2b.1a. "A scope exists"
  sites: `#beforeClose` (~100–103), `#cancel`'s `if (this.#scope)` (~240), `.beforeClose`
  (~315) — gate on `#leave`.
- Save (~359–364, fixed `variant="primary"`): `variant=${s.variant}`,
  `.disabled=${s.unchanged || this.busy || this.pickerOpen}`. Early return in `#submit` (~193)
  after the `busy || pickerOpen` return (~195), BEFORE `#dismiss` (~196). It has no checks of its
  own, so nothing else joins `?disabled`.
- The baseline is `#submissionValue()` at open, worked out by `folderOverridesFrom` (~217–224), so
  an include whose stored overrides match the included menu's own values opens quiet (2a's
  shown-value rule).
- Tests first, new `include-folder-form.save-state.test.ts`: a stored folder with names, image and
  colour opens disabled/secondary on host and inner button; `value: null` opens disabled; turning
  the switch off enables it, back on disables it; typing a name and typing it back disables it; an
  untouched press emits no `wt-submit`; a refusal after a changed press keeps Save enabled;
  `commitSaved` with the form open makes it quiet. Reconnect case in
  `include-folder-form.unsaved.test.ts`, as 2b.1a. Axe both states, both themes: add a "changed"
  state to `include-folder-form.a11y.test.ts`.
- Measured 2026-10-08 (see "Plan review" below): every failure and `Unhandled error` the
  throw-probe raised in these suites is at a site listed in 2b.1a, 2b.1b or 2b.2 (~2071 is listed there as one to leave).
- Predicted changed checks: `include-folder-form.test.ts` ~129–137 (keeps a name in a language the
  form does not show, pressed untouched: edit the colour and check `fr` is still sent), ~204–218
  (`it.each`, three rows: refusal at mount, Save asserted enabled at ~216 — edit first);
  `menus-screen.test.ts` ~4255–4279, ~4281–4317 (`it.each`, two rows), ~4319–4332 (an include
  opened and pressed untouched to see the server's refusal: edit the colour first, as ~4231–4253
  does); `menus-screen.a11y.test.ts` ~347–366 ("refused: true" presses untouched).
- Suites: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/include-folder-form
  src/screens/menus-screen`.

### Task 2b.3 — look, docs, backlog

- LOOK, with the forms mounted with test data in the workspace's Playwright Chromium (as batch 5
  did), screenshots into `~/waitron-campaign-c/a331-2b-shots/`: New menu, Rename menu, New section,
  Edit section and an include's Edit, each unchanged and after one edit, at 1280px, light, English;
  then 390px, dark, Spanish on Rename menu and the include's Edit. Also the Edit section form
  quiet again after a refused-then-fixed save. The changed-checks inventory (`file:line`, before →
  after, why) goes in `~/waitron-campaign-c/item-a331-2b-changed-tests.md` and the PR's "Changed
  test checks".
- `docs/developers/design-system.md` → Forms: add a "batch 2b" line to the list of forms that
  follow the rule (the menu details form, new and rename; the section form, new and edit; an
  include's Edit), add the two forms to the `willUpdate` paragraph's list of forms that take the
  `isConnected` skip, and one sentence that the menus screen's own windows, the price fields and
  Publish act at once, except the Add products window and the publication schedule, which are
  batch 2a's, pointing at this section. Nothing joins "These open already savable".
- `docs/backlog.md` A331: batch 2b's status in the headline and a 2b bullet (the forms, the not-a-save
  table in one line, what the look found). If 2a has not landed, batch 2 stays OPEN for 2a.

**Plan review (fresh context, 2026-10-08, at `a50333417`).** A temporary probe wired both forms as
2b.1a and 2b.2 describe (`draftScopeFor`, the `isConnected` skip, the leave paths on `#leave`, Save
bound to `saveActionState`) with `throw new Error("untouched save")` at both early returns, then ran
`pnpm --filter @waitron/dashboard exec vitest run src/widgets/section-details-form
src/widgets/include-folder-form src/screens/menus-screen src/screens/menu-details.unsaved`: 595
tests, 31 failed, 28 `Unhandled error` lines, every one at a site listed in 2b.1a, 2b.1b or 2b.2
except `menus-screen.test.ts` ~2071 (explained in 2b.1b) and ~7920 (added to 2b.1b). No failure in
either form's `*.unsaved.test.ts` or `menu-details.unsaved.test.ts`. The probe was reverted. Because
it bound `disabled` and the early return together, it does not say which task each failure falls
in; the split above is from reading.

## Batch 4d — prep stations (Lane E, A331-4d)

Branch `feat/save-follows-changes-prep-stations`. Limit implementation to
`packages/venue-service/src/dashboard/prep-stations-screen.ts` and its tests, plus the A331 backlog
and Forms status. No migration. Leave hours, menu timetable, venue operations, watcher-form and
local-holidays-editor alone. Obtain one fresh-context review of this appendix before implementation.

**Action inventory** (screen line numbers at planning, 2026-10-08):

| Normal Save | Handler / draft scope |
| --- | --- |
| New station | `#saveStation` (:1336) / `#stationScope` |
| Station Rename | `#saveStationName` (:1226) / `#renameScope` |
| Tickets station printers | `#saveStationPrinters` (:1806) / `#printerScope` |
| Watcher Rename | `#saveWatcherName` (:2836) / `#watcherRenameScope` |
| Watcher follows, zones, pass | `#saveWatcherCell` (:2172) / `#watcherCellScope` |
| Watcher printers | `#saveWatcherPrinters` (:1999) / `#watcherPrinterScope` |
| Settings rest, fallback, warm/overdue/forgotten minutes | `#saveSettingsCell` (:2354) / `#settingsScope` |

Watcher Create/Edit delegates Save to `watcher-form` (already gated, :228/:246 there); preserve
`#saveWatcher`'s `commitSubmitted` and close/refresh behavior. None of the screen-owned saves needs
`savableAtOpen`. Routing choice/preview/Confirm (`#saveCell`, :1016), Make default, reorder,
watcher Enable/Delete/Disable, and station Today/Open/Close/Back to schedule/Enable are operations.
The station-action fallback and switch-off dialog (`#saveStationAction`, :1755) uses Confirm,
including conditional fallback write before deactivation; preserve its scope and confirmation rules.
Settings fallback **is** a normal Save: retain its two presses and reset confirmation on a new choice.

- [x] **Test first.** Read the TDD skill and current house/UI/testing rules. Extend
  `prep-stations-screen.test.ts` with a Save-state group: exercise every table mode standalone and under a
  `LeaveController`. Watch failures before implementation: untouched Save is secondary with its
  host and native button disabled; host click and Enter cause no validation, confirmation or write; edit enables
  primary, undo restores quiet. Cover trimmed names, order-independent sets, normalized minutes,
  inherited empty minutes versus an explicit default, changed invalid input, retry after refusal,
  busy primary/disabled, reopening and detach/reconnect. Keep operations available without an edit.
- [x] **Wire the seven scopes.** Replace their registrations in `#syncStationDrafts`,
  `#syncWatcherInlineDrafts`, `#syncPrinterDraft`, `#syncSettingsDraft` with `draftScopeFor`;
  preserve snapshots, equality, restore and identity. Prevent detached registration and request an
  update on reconnect. Bind each Save's variant and disabled state with `saveActionState`, keeping
  busy/read-only/own-validation checks; return unchanged before validation/errors in all seven Save handlers, including
  `#saveStation`, `#saveStationName`, `#saveWatcherName`, **and** Settings fallback's click wrapper, before it sets `confirming`. Keep leave decisions on
  coordinator presence, never scope presence: audit `#leavePrinters`, `#leaveSettings`,
  `#leaveWatcherInline`, `#beforeStationClose`, `#beforeWatcherRenameClose` and modal bindings.
- [x] **New station validation.** After a changed invalid submission, keep Save primary/disabled
  until the draft passes its local checks; keep field messages and the bottom summary in step
  with revalidation after an attempt. Server refusals alone remain retryable. Test a retained
  Add/Rename editor disconnected and reattached without reopening, then edit and request leave:
  detached updates must not register a standalone scope before the application reconnects.
  Keep its opened/submitted baseline if it was dirty before detaching; undo still compares to that baseline.
- [x] **Preserve asynchronous behavior.** Retain Cancel/Escape/backdrop/tab/replacement decisions,
  pending-write locks, identity checks and inert stale controls/answers. Commit submitted values,
  keeping newer input dirty in editors that accept it during a write; Settings blocks such input.
  Keep successful-close-before-refresh and read/action error separation. Run existing pending,
  refusal, stale and newer-input cases; remove the gate as a negative control, observe failure,
  then restore it and watch the focused cases pass.
- [x] **Inventory changed test checks.** Temporarily throw at each unchanged return and run the
  suites below; restore returns and classify every failure. Record `file:line`, before/after and why
  in the ledger and PR. Known candidates: main `.test.ts:452` (unchanged retained fallback now stays
  quiet/open without confirmation or write), `:1524` (edit another field before testing missing
  name), `.settings.test.ts:404` (change rest before testing refusal), `.a11y.test.ts:261/:269`
  (edit before invalid/rename refusal). Keep their remaining assertions; any unrelated failure is
  a regression, not permission to weaken a check.
- [x] **Verify and look.** Run
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen src/dashboard/watcher-form src/dashboard/routing-grid`
  (all six existing screen suites plus the new suite and delegated/confirmation consumers), then
  `pnpm --filter @waitron/venue-service typecheck`. Read test counts and unhandled errors. Extend
  axe coverage for quiet/changed modes in both themes; LOOK at each Save mode and fallback's second
  press in light/dark, EN/ES, desktop/390px. Capture the real contributed component in a
  browser fixture for each saved value; this avoids changing shared demo printer/station settings.
  Any dev stack needed uses `wa-wt demo waitron-feat-save-follows-changes-prep-stations`. Run golden huella and immutability
  unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [x] **Finish implementation.** Update A331 backlog and Forms' implemented-form list; signed-off
  commits, announce readiness for `finish-branch`. Use one Claude whole-branch run-it review after
  its initial rebase in an installed throwaway candidate checkout; read completed findings and fix
  them. Push through the normal hook once; require current-head CI, including selected package
  coverage. Preserve other appendices on rebase. Land only with owner authorization.

Execution receipt, 2026-10-08: landed in #1426 as `46e8688f3bff5c3dfac00f4d205b9470d51b6f7c`.
Focused browser checks ran 738 tests; the current-head CI venue-service coverage job ran 2,829.
The Claude run-it validation-message finding and the dirty-before-reconnect case each failed added
behavioral tests before their fixes. Changed test checks and review limits are recorded in the PR.


## Batch 7b — revisit the landed reservations (Lane E, A331-7b)

**2026-10-08, audit on `086d75f84e83e56fdfc168c5902d7dbc4987fdb5`.** The original
Batch 7 above is a historical receipt. Its hardware (#1415), till (#1414, #1418),
menu/home/Preview (#1411, #1417, #1422, #1424) and invoice foundation (#1399)
reservations have landed. This follow-up found no additional staged Save editor to
change in those paths. Only documentation changes; all existing tests and product
code stay byte-for-byte unchanged.

Rerun the four inventory commands under Batch 7. Intersect the labelled list with
the button list for the first inventory; retain every button file for the second.
Read both scoped and unscoped files in the reserved groups: a scope alone does not
establish that the button or handler uses the Save gate. On this tree, the whole-tree
lists contained 33 labelled button files without a scope-helper mention and 103
button files without one. These counts describe a text scan, not independent forms.
The local command outputs and checks are retained under
`~/waitron-campaign-e/receipts/a331-7b/`.

| Previously reserved area | Classification on this tree and source receipt |
| --- | --- |
| Printer and agent settings, calibration and pairing | Existing Save gates: `apps/dashboard/src/screens/printers-screen.ts:2191` (agent), `:2440` (connection), `:2491` (name), `:1696` (calibration), `:1616` (Pair). Calibration after Add and the supplied printer name remain savable at open, as batch 3b decided. |
| Devices, profiles and readers | Existing Save gates: `apps/dashboard/src/screens/devices-screen.ts:585` combines the device and reader scopes; `device-profiles-screen.ts:571` combines the profile and reader scopes; `payments-screen.ts:777` gates Rename and `:917` gates bill attestation. Pair and provider-supplied reader Add retain batch 3b's savable-at-open rules. The disabled-zone profile ruling remains A396's separate task. |
| Canvas editor, name chooser and duplicate | `apps/dashboard/src/screens/canvas-editor-screen.ts:815` gates the editor's Save. Create's `#confirmCreate` at `:503` opens a default canvas draft with a null baseline, without a request. Duplicate confirms a prefilled copy name (`:1042`); it remains savable at open. `canvas-grid-preview.ts` changes the parent draft; it owns no separate Save. |
| Menu and section details, include Edit, Add products, Add to menus, publication schedule | Existing helpers and handler returns in `apps/dashboard/src/widgets/section-details-form.ts:192`, `include-folder-form.ts:208`, `section-add-products.ts:227`, `add-to-menus.ts:245` and `menu-publications.ts:510`. `menus-screen.ts:1999`, `:2608` and `:2634` consume the child submissions. |
| Prices, Structure, Preview and device-home preview | Prices commit on Enter or leaving a field (`apps/dashboard/src/widgets/menu-prices-table.ts:884`, `:942`, `:946`); Undo sends the previous price (`:985`). Structure buttons emit operations or open an editor (`menu-structure-table.ts:744`). Preview publishes, retries a read or changes the local hidden-change list (`menu-preview.ts:541`, `:586`); device-home preview navigates (`device-home-preview.ts:315`). Home display choices write immediately through `menus-screen.ts:2395`, `:2411`, `:2421`. None owns an additional staged primary Save. |
| Till Save editors | Party name, invoice recipient, modifier Edit, station Make at and schedule cover/time-off requests already use the shared gate. Profile Switch uses batch 4c's stated comparison exception (`apps/till/src/widgets/profile-dialog.ts:84`). Modifier Add remains savable at open (`modifier-picker.ts:485`). Batch 5's operation classifications still apply. |
| Other till controls from the broader inventory | Equipment choice emits `equipment-change` (`apps/till/src/widgets/equipment-dialog.ts:162`) and reaches `setDeviceEquipment` (`till-app.ts:4535`) immediately; taking a held item is a confirmation of that operation. Reader choice emits `reader-chosen` (`reader-picker.ts:76`); reprint language confirms a print (`reprint-language-dialog.ts:77`). Basket refresh, seating, order/payment/serve controls and navigation remain operations, parent-draft changes or choosers, with no additional staged Save editor. |
| Invoice configuration/setup and server/agent paths | The configuration-transfer and setup API files are server boundaries, not editors. The setup screens retain Batch 6's provisioning/restore classifications. `apps/dashboard/src/screens/email-screen.ts:104` and `:118` read the practice inbox; SMTP setup screens remain part 2 (A231q). The string-page scan still finds only recovery Retry and agent setup/reset actions. Agent `/setup` calls Configure (`apps/print-agent/src/setup-page.ts:208`, `:225`), whose implementation clears the token and resets runtime even for the saved address (`packages/print-agent/src/agent.ts:592`–`:605`). Keep that retry available. |

**Still reserved.** Skip hours/date/slot, service settings, venue operations and menu
timetable forms in `packages/venue-service`; lane D's A366 slices rewrite them and
batch 4b follows those landings. The local holiday and watcher editors already
landed in #1418, and preparation stations in #1426. This audit does not claim to
cover lane D's unlanded tree, future invoice screens or reconnect defects being
worked by lane C's A397.

**Checks and limits.** Run unchanged focused suites, not a package-wide gate.
The exact commands and outputs are retained in the local receipts. All commands
below exited 0, with these printed results:

| Command (after `pnpm --filter <package> exec vitest run`) | Package | Printed result |
| --- | --- | --- |
| `src/screens/printers-screen.save-state.test.ts src/screens/devices-screen.save-state.test.ts src/screens/device-profiles-screen.save-state.test.ts src/screens/payments-screen.save-state.test.ts src/screens/canvas-editor-screen.save-state.test.ts src/screens/menu-details.unsaved.test.ts src/widgets/section-details-form.unsaved.test.ts src/widgets/include-folder-form.test.ts src/widgets/menu-selections.unsaved.test.ts src/widgets/menu-publications.test.ts src/widgets/menu-prices-table.test.ts` | `@waitron/dashboard` | 11 files, 527 tests passed |
| `src/widgets/section-details-form.save-state.test.ts src/widgets/include-folder-form.save-state.test.ts src/widgets/menu-publications.save-state.test.ts src/widgets/section-add-products.save-state.test.ts src/widgets/menu-publications.unsaved.test.ts src/screens/menus-screen.test.ts` | `@waitron/dashboard` | 6 files, 470 tests passed |
| `src/widgets/party-name-dialog.test.ts src/widgets/invoice-recipient-dialog.test.ts src/widgets/modifier-picker.test.ts src/widgets/station-choice-dialog.test.ts src/widgets/profile-dialog.test.ts src/widgets/equipment-dialog.test.ts src/widgets/reprint-language-dialog.test.ts src/widgets/reader-picker.test.ts src/widgets/basket-refresh-dialog.test.ts src/widgets/seat-dialog.test.ts src/screens/till-schedule-screen.test.ts` | `@waitron/till` | 11 files, 205 tests passed |
| `src/widgets/party-name-dialog.save-state.test.ts src/widgets/invoice-recipient-dialog.save-state.test.ts src/widgets/modifier-picker.save-state.test.ts src/widgets/station-choice-dialog.save-state.test.ts src/widgets/profile-dialog.save-state.test.ts src/screens/till-schedule-screen.save-state.test.ts` | `@waitron/till` | 6 files, 39 tests passed |
| `src/setup-page.test.ts` | `@waitron/print-agent-app` | 1 file, 33 tests passed |
| `src/agent.test.ts -t 'setup reset drops|reconfigures a denied agent|refuses a queued configure'` | `@waitron/print-agent` | 1 file, 4 tests passed, 114 skipped by name selection |
| `src/write-path.e2e.test.ts src/inmutabilidad.test.ts` | `@waitron/fiscal-verifactu` | 2 files, 20 tests passed, both files unedited |

The first dashboard command also named two nonexistent filters,
`src/screens/menu-layout.unsaved.test.ts` and `src/widgets/menu-price-outcomes.test.ts`;
the second named `src/widgets/menu-prices-table.input.test.ts`, also absent. Vitest
ran only the existing files listed above. No execution is claimed for absent filters.

The dashboard
hardware Save-state suites, menu detail/selection/publication and price suites
exercise the existing gates and immediate commits; till editor and chooser suites
exercise the Save/action distinction; setup-page and selected agent cases exercise
same-address reset/rejoin. No new Save gate was needed, so there is no new red/green
cycle, changed-test-check inventory or visual change to verify. Browser console
output includes the ResizeObserver notification-loop message; its cause and screen
effect remain unverified and belong to A407. Do not infer package coverage or absence
of other defects from these focused runs.

## A397 — forms keep asking after being taken out of the page and put back (Lane C, part 1)

Branch `fix/forms-reconnect-keep-asking`. Light review path (dashboard and module screens, no risk
trigger), no migration. Part 1 covers the person edit, new person, variant, purchase and shift
forms, the bookings form, and the watcher form's edit-first case. The product editor and the unit
form wait for lane B's A332 (`feat/all-products-colour`), which changes
`product-editor.unsaved.test.ts` and `unit-owners.unsaved.test.ts`: part 2, after it lands. Do not
edit either file in part 1.

**Two cases per form**, each in the form's own `*.unsaved.test.ts` (the variant form has none:
create `apps/dashboard/src/widgets/variant-form.unsaved.test.ts`, mounting the form under a test
host holding a `LeaveController`, as `ingredient-form.unsaved.test.ts` does):

- **Case R — edit after.** Open the form, take it out of the page and put it back
  (`reattachAfterDetachedUpdate` in `apps/dashboard/src/widgets/test-helpers.ts`; the modules'
  suites inline the same remove → await `updateComplete` → re-insert → await), then edit a field.
  The coordinator reports dirty, and Cancel or Escape opens the discard question with the form
  still open.
- **Case E — edit before.** Open the form, edit a field, take it out and put it back. The edit is
  still shown, the coordinator reports dirty, Save is enabled and drawn `primary`, and Cancel or
  Escape opens the discard question.

**Run each case on `main` BEFORE any fix** and record pass or fail per form in
`~/waitron-campaign-c/item-a397-measurements.md` (form, case, result on main, result after the fix,
the deletion that made a fixed case fail). The failing answer for R is "no question, the form
closes" (or `isDirty()` false); for E it is the edit replaced by the stored value, or kept but not
dirty.

**The fix, only where a case fails on `main`** — the till's party name dialog
(`apps/till/src/widgets/party-name-dialog.ts`) is the model:

- R: `connectedCallback` calls `requestUpdate()` (Lit runs no update on reconnect), and
  `willUpdate` takes a scope only while `this.isConnected` (`else if (this.isConnected &&
  !this.#scope)`); the re-seed branch above it is not guarded by `isConnected`.
- E: keep the value the scope last committed — the opened value, then each saved value — in a
  field that `disconnectedCallback` does not clear (`#baseline`), and after taking a new scope call
  `scope.commit(this.#baseline)` so the kept edit compares against it (`register` takes the current
  value as its first baseline and `commit` replaces it with a snapshot,
  `packages/ui/src/unsaved-changes.ts`). The till dialog's `#baseline ??=` works only because that
  dialog is used once; every form here is reopened, so CLEAR `#baseline` wherever the form really
  reopens or re-seeds (and person edit's `#loadPerson`), or a reopened form starts dirty and Discard
  restores the previous opening's values. A reset in the `!open` branch as well is optional where
  every reopen already passes through the reopen branch (measured on the variant form,
  `~/waitron-campaign-c/item-a397-measurements.md`). Add a case per form: save or discard, reopen, and the form opens
  quiet with the reopened values.
- Four forms clear their opening identity on disconnect and so re-seed their fields on reconnect,
  replacing the edit: purchase (`#identity`), shift dialog (`#identity`), booking form
  (`#identity`) and the watcher form (`identity`). Stop clearing it there, but keep what it
  guarded. In purchase and shift, `writeCompletion` drops a departed write by comparing `#opening`,
  which is only renewed through that identity reset: renew `#opening = {}` in
  `disconnectedCallback` instead, and ADD a case (neither suite has one) — start a write, take the
  form out and put it back, complete the write, and it neither commits nor closes the form. Booking
  already renews `#opening` on disconnect. The watcher creates its scope only inside the re-seed
  branch (`identity` missing or `watcherId` changed), and `identity` is also the scope's id and
  `requestLeave`'s departed check: split `willUpdate` into "re-seed when the watcher changes" and a
  separate `if (!this.scope)` that takes the scope and commits the kept baseline, and give
  `requestLeave` its own token renewed on disconnect. Its existing "disconnect aborts its
  question", "removed form cannot submit" and "departed … cannot release" cases stay unedited and
  green.

**Proof by deletion, per fixed form:** delete `this.isConnected &&` from the scope-taking branch — R fails; restore.
Stop committing the kept baseline — E fails; restore. (The detached update R needs comes from the
scope's `dispose()` on disconnect, which redraws the host; if deleting `this.isConnected &&` does not fail R,
the case is not reaching that update — fix the case, not the proof.) Where a case passes on `main` with no fix,
keep it as the guard and say so in the measurements file; that it is not vacuous is shown by the
same case failing on a fixed form with its fix deleted.

### Task A397.1 — people (`apps/dashboard/src/widgets/person-edit.ts`, `person-form.ts`)

`pnpm --filter @waitron/dashboard exec vitest run src/widgets/person-edit.unsaved.test.ts src/widgets/person-form.unsaved.test.ts`, then each form's other suites (`person-edit*.test.ts`,
`person-form*.test.ts`) and the screen that hosts them (found by grep).

### Task A397.1b — the variant form (`variant-form.ts`, new `variant-form.unsaved.test.ts`)

`pnpm --filter @waitron/dashboard exec vitest run src/widgets/variant-form.unsaved.test.ts`, then
`variant-form*.test.ts`, and `product-editor.unsaved.test.ts` and `product-editor.test.ts` unedited.

### Task A397.2 — purchases and shifts (`apps/dashboard/src/widgets/purchase-form.ts`, `shift-dialog.ts`)

`pnpm --filter @waitron/dashboard exec vitest run src/widgets/purchase-form.unsaved.test.ts src/widgets/shift-dialog.unsaved.test.ts`, then `purchase-form*.test.ts`, `shift-dialog*.test.ts`
and the screens that host them (`purchasing`/`schedule` screen suites found by grep).

### Task A397.3 — bookings and the watcher form (`packages/bookings/src/dashboard/booking-form.ts`, `packages/venue-service/src/dashboard/watcher-form.ts`)

The watcher form already has Case R ("taken out of the page and put back keeps an edit made
afterwards"); add Case E only. `pnpm --filter @waitron/bookings exec vitest run src/dashboard/booking-form.unsaved.test.ts` and `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/watcher-form.unsaved.test.ts`, then each package's other suites for the form.

### Task A397.4 — docs, backlog

`docs/developers/design-system.md` → Forms: move the forms fixed here into the list that takes a
scope only while connected; say which keep an edit made before removal (Case E) and which forms remain
untried for it. `docs/backlog.md`: mark #1418's watcher-form point and #1414's point (2) done for
the forms covered, and leave the product editor and unit form named as part 2. Changed test
checks (if any) listed in `~/waitron-campaign-c/item-a397-changed-tests.md` and the PR. No visual
change, so no screenshots.
