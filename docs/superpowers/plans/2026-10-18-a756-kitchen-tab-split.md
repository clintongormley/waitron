# A756. The Kitchen tab split up — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Move each Kitchen-tab setting to the thing it describes — courses to their own page, the
department's service choices to a tabbed department dialog, every station choice to the station —
building now only what A773 leaves untouched.

**Architecture:** Three pull requests are buildable now and touch no code A773-1 is rewriting: a
tabbed department dialog (Details, Service, Transfers), a Courses page under Products and menus, and
the receipt editor moved into the department dialog's Receipts tab. Five further pull requests wait
for A773-1 (or A773-2) because they change functions that branch rewrites; each has a short section
saying why, so it can be planned when its blocker lands.

**Tech Stack:** Lit web components, `@waitron/ui` primitives (`wt-tabs`, `wt-modal`,
`wt-form-actions`), Vitest browser mode (real Chromium), Hono routes, drizzle-kit (later PRs only).

**Spec:** [`docs/backlog/kitchen.md` → A756](../../backlog/kitchen.md#a756-the-kitchen-tab-split-up-a-courses-page-a-department-service-tab-and-an-every-station-card)
(the "Changed by A773" block at its top overrides the mock-ups), the mock-ups in
`docs/backlog/mockups/a756-kitchen-settings/01..04`, and
[A773 spec §7](../specs/2026-10-16-a773-courses-and-groups-design.md#7-settings--changes-to-a756)
with A773's pictures 9 and 10 (`docs/backlog/mockups/a773-courses-and-groups/`). A757's place in
the Service tab: [A757 spec §3.1 and §11](../specs/2026-10-17-a757-table-states-design.md).

## Global Constraints

- Every commit `git commit -s`. Work only in this worktree:
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a756-kitchen-tab-split`, branch
  `feat/a756-kitchen-tab-split` (PR 1). PRs 2 and 3 each get their own worktree from `main` after
  the previous PR lands (`python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`).
- Never edit, commit or run anything that writes in A773-1's worktree
  (`/Users/clintongormley/workspace/worktrees/waitron-feat-a773-1-unsent-list`).
- Forms follow `docs/developers/design-system.md` → Forms and the A331 save rule
  (`draftScopeFor`, `saveActionState`, early return in the save handler). Field primitives only;
  no native `<select>`, `<textarea>` or text `<input>`. Every colour, space and size reads a
  `--wt-*` token.
- Text: concise, EN and ES both, in the package's own catalogue
  (`packages/venue-service/src/dashboard/strings.ts` or `apps/dashboard/src/i18n/strings.ts`).
- A changed test check is allowed only where this plan names the spec sentence that changes it
  (lane C "OWNER DECISION 2026-10-05"). A setup change (selecting a tab before touching a field that
  now sits on another tab, a renamed fixture, a deeper shadow root) is not a check change. Record
  every changed check in the ledger and the PR description. Never touch the golden huella test or
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- Focused tests only while implementing: `pnpm --filter <pkg> exec vitest run <file>`. Before any
  browser run check `memory_pressure | grep free`; read the `Tests` count, never the exit status of
  a pipe. Under an agent, unset `AI_AGENT` and `CLAUDECODE` to see a passing test's console output.
- Ledger: `docs/handoffs/2026-10-18-a756-kitchen-tab-split.md` (gitignored), updated at the end of
  every task with done / changed checks / next step.
- Review path FULL for every PR; then `/finish-branch` with this plan's path as its note.
- None of PRs 1–3 has a migration. Later PRs that do: generate with
  `pnpm --filter <pkg> db:generate --name <name>` against current `main`; never hand-edit SQL,
  snapshots or `_journal.json`; on a number collision reset the migrations folder to `main` and
  regenerate.

## Review Focus

1. **A tab change while a draft is dirty.** Type a name, choose Service: no "leave unsaved
   changes?" question, the address records the tab, the name is kept; Back returns to Details the
   same way (Task 2; Task 8 for Receipts).
2. **A draft on one tab while saving another.** Details edited, then Save on the Receipts tab: the
   receipt saves, the dialog stays open and the Details edit is still there (Task 8).
3. **Enter in a receipt field** with the receipt unchanged and Details dirty: nothing is written
   (Task 8).
4. **An invalid or refused field on a tab that is not showing.** Save with a blank name from the
   Service tab, or a server refusal naming a Transfers field: the dialog shows that tab (replacing
   the address), marks it, and focuses the field (Task 1).
5. **An address naming a tab the dialog does not offer** (Transfers with one department, Receipts
   without `layout.configure`): the dialog opens on Details and the address is replaced, not
   pushed (Tasks 2, 9).

---

## Where each Kitchen-tab setting goes

Today's Venue settings → Kitchen tab is two panels: the core `kitchen` panel
(`apps/dashboard/src/dashboard-app.ts:330-338`, rendering `dashboard-kitchen-screen`,
`apps/dashboard/src/screens/kitchen-screen.ts`) and venue-service's `venue-service-kitchen` panel
(`packages/venue-service/src/dashboard/index.ts:115-132`, rendering
`dashboard-venue-service-settings subject="kitchen"`,
`packages/venue-service/src/dashboard/service-settings-panel.ts:139-176`). "Tables need clearing"
is on the Tables tab and is A757's, not A756's.

A773-1 receipts below are hunk headers of
`git diff 4e18f2a28 feat/a773-1-unsent-list -- <file>` (A773-1's base; branch tip `f8ff49bc6` on
2026-10-18; read, not run beyond the diff).

| Setting | Stored today | Goes to (A756 + A773 §7) | A773 touches it? | Class |
|---|---|---|---|---|
| Courses | `kitchen_courses` (`packages/db/src/schema/kitchen-courses.ts:12-32`); routes `apps/server/src/management-api.ts:1906-2000` | Courses page under Products and menus, with "Held until fired" | A773-1 Task 1 adds `held_until_fired` and its column to the shared list widget (`apps/dashboard/src/widgets/course-list.ts`; hunks `@@ -92`, `@@ -457..-569`) | **Now** (PR 2): the page hosts the widget; the column arrives with A773-1 whichever lands first |
| Who fires held courses | `locations.fire_control` (`packages/db/src/schema/tenants.ts:85`) | Dropped (A773 §7.2) | A773-2 removes it (A773 §9) | **A773-2** |
| Reminder to fire the next course | `service_settings.release_reminder_minutes` (`packages/venue-service/src/schema/settings.ts:28`); read at `apps/server/src/order-groups.ts:1153,1415` | Department → Service tab, "Courses and the kitchen" | A773-1 rewrites both readers (`order-groups.ts` `@@ -1171`, `@@ -1182`, `@@ -1415`) | **Waits for A773-1** (PR 4) |
| Late flags | `kitchen_timing_defaults` + per-station nullable `kitchen_station_timing` (`packages/db/src/schema/kitchen-timing.ts:7-45`) | Each station's own | No design change | **Waits for A773-1** (PR 5): `working-order.ts` imports sit in A773-1's `@@ -97,6`; 20 files that read or seed the tables are A773-1-edited |
| Done on the screen (bump mode) | `locations.bump_mode` (`tenants.ts:84`); read `apps/server/src/till-setup.ts:28,87` → `apps/till/src/till-app.ts:8073` → `till-station-screen.ts:910` → `station-queue.ts:659` | Each station's own | No design change | **Waits for A773-1** (PR 7): `till-app.ts`, `till-station-screen.ts`, `station-queue.ts` are A773-1 files |
| Identical dishes on a ticket | `service_settings.kitchen_ticket_grouping` (`settings.ts:20-22`); read `apps/server/src/kitchen-print.ts:531,1354` | Each station's own | No design change | **Waits for A773-1** (PR 6): `kitchen-print.ts:531` is inside A773-1's `@@ -529,13 planKitchenTickets` |
| Held courses (print in advance) | `service_settings.print_held_work` (`settings.ts:23`); read `order-groups.ts:1435` | Each station's own (A773 §6) | No design change | **Waits for A773-1** (PR 6): A773-1 rewrites `printHoldTickets` (`@@ -1463`) |
| MOVED slips | `service_settings.print_moved_slips` (`settings.ts:24`) + nullable `kitchen_stations.print_moved_slips` (`packages/db/src/schema/kitchen-stations.ts:25-26`); read `kitchen-print.ts:1346` | Each station's own, no venue fallback | No design change | **Waits for A773-1** (PR 6): A773-1 rewrites `printMovedSlips` (`@@ -1385`, `@@ -1393`) |
| Changes after sending | `service_settings.edit_sent_lines` (`settings.ts:16`); read `apps/server/src/working-order.ts:2352,5054`, `apps/server/src/till-api.ts:3525` | Each station, three values (A773 §7.4) | A773-1's Recall reads it as an interim (A773 §3.10; A773-1 plan "Recall alone uses interim `edit_sent_lines`") | **Waits for A773-1** (PR 8) |
| Waits for the pass | — | Each station, and a stations-table column (A773 §5, §7.1) | A773-2 builds it | **A773-2** |
| The department dialog's tabs; Receipt editing in it | One-form dialog (`packages/venue-service/src/dashboard/department-edit-dialog.ts`, `department-settings.ts`); separate Edit receipt modal (`apps/dashboard/src/screens/department-receipt-dialog.ts`) opened from the list's Receipt link (`packages/venue-service/src/dashboard/departments-list.ts:214-231`) | Details · Service · Receipts · Transfers; the link goes | No | **Now** (PRs 1 and 3) |

"Buildable now" here means: no edit inside, or beside, an A773-1 hunk, and no change to a function
A773-1 rewrites. PR 2 still touches three A773-1 files outside their hunks (stated in its section).

**The Kitchen tab itself goes** in whichever PR removes its last control. After PRs 4–8 only fire
control is left, which A773-2 removes; if A773-2 lands first, PR 7 or PR 5 (whichever is last)
removes `kitchen` from `VENUE_SETTINGS_TABS` (`apps/dashboard/src/screens/venue-settings-screen.ts:11-16`),
the core panel and `kitchen-screen.ts`.

### The wording question is moot

The queue asked whether a station's inherited choice reads "Same as every station" or A725's
"Venue setting: Print". A773 §7.1 removes the Every station card: "Every station setting is set on
the station itself … A new station starts with sensible defaults." Once PRs 5 and 6 land, no
station setting inherits a venue value, so neither wording appears. Until then the station editor
keeps A725's wording unchanged — "Venue setting: Print" / "Don't print"
(`packages/venue-service/src/dashboard/station-editor.ts:201-209`, strings `prep.moved_slips_venue_*`)
and "Leave a field blank to use the venue setting" (`prep.timing_inheritance`) — because the venue
values still exist and still apply. PR 5 deletes the second, PR 6 the first. No owner question.

---

## PR 1 — The department dialog in tabs: Details, Service, Transfers (buildable now)

Branch `feat/a756-kitchen-tab-split`. No migration. Unblocks A757 slices 1 and 2, which add a
"Tables" section to the Service tab (A757 spec §11). Receipts joins in PR 3.

Files (all outside A773-1): `packages/venue-service/src/dashboard/department-settings.ts`,
`department-edit-dialog.ts`, `venue-departments-shell.ts`, `venue-operations-loader.ts`,
`index.ts`, `strings.ts`, their tests, `packages/venue-service/src/testing/department-edit-fixture.ts`,
`apps/dashboard/src/dashboard-app.test.ts` (department block), `docs/developers/design-system.md`,
`docs/backlog.md`, `docs/backlog/kitchen.md`.

**Decisions.**
- `department-settings` keeps its one draft and one Save for every tab it owns, and now draws a
  `wt-tabs` strip with one panel per tab (hidden panels stay mounted, design-system "Tabbed
  management pages"). Details: name, trading name. Service: section "Orders and payment" holding
  today's `dashboard-service-settings-fields` and the "zones that differ" line. Transfers: today's
  transfers section, offered only while `showsTransfers` (two or more active departments,
  `department-settings.ts` `get showsTransfers`). The form-actions row stays below the strip.
- The Service panel is a list of `<section>`s, each with an `<h3>`, so A757 adds "Tables" after
  "Orders and payment" and PR 4 adds "Courses and the kitchen" between them.
- The selected tab lives in the address: `view` = `service` / `transfers` (Details is no `view`);
  `zones` and `receipt` keep their meanings. A tab the person picks pushes history, as Venue
  settings does (`apps/dashboard/src/screens/venue-settings-screen.ts:96`). An address naming a tab
  not offered opens Details and replaces the address. The switch to a marked tab after a refused or
  invalid Save also REPLACES the address.
- **A tab change never asks "leave unsaved changes?".** Every address write goes through the
  navigation guard (`packages/ui/src/url-state.ts:118`), which asks whenever any draft is dirty
  (`navigation-guard.ts:173-177`), and `dashboard-app.ts:1947-1957` asks about every draft unless the
  screen supplies `navigationScopes`; the venue-operations screen supplies none
  (`packages/venue-service/src/dashboard/index.ts:62-69`). `dashboard-app.test.ts:7981-7996` shows a
  same-department write asking today. So the screen gains `navigationScopes(destination)`, built
  like the Calendar's (`opening-hours-screen.ts:389-399`, wired at `index.ts:103`): `[]` when the
  destination names the same department, the same query and hash, and a `view` the open dialog
  offers; `undefined` (ask about everything) otherwise. In PR 1 `receipt` is not an offered view, so
  the 7981 case still asks.
- An invalid Save, or a refusal naming a field, shows the first tab (Details → Service →
  Transfers) holding a marked field, then focuses it; every tab holding a marked field carries
  `marked` (`TabItem.marked`, `packages/ui/src/components/wt-tabs.ts:15`).

The strip's label reuses `venue.department`. New strings (venue-service catalogue, EN / ES):
`venue.department_tab.details` "Details" / "Datos";
`venue.department_tab.service` "Service" / "Servicio";
`venue.department_tab.transfers` "Transfers" / "Traslados";
`venue.orders_and_payment` "Orders and payment" / "Pedidos y cobro";
`venue.tab_needs_fixing` "needs fixing" / "hay que corregirlo".
`venue.service_settings` is read only by `department-settings.ts:549-550` (`git grep`, excluding
tests and catalogues): the new heading replaces it, and the key is deleted in EN and ES if nothing
else reads it then. `venue.tab_transfers` stays as the Transfers panel's heading (`:587-588`).

### Task 1: `department-settings` draws its fields in tabs

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-settings.ts`
- Modify: `packages/venue-service/src/dashboard/strings.ts`
- Modify: `packages/venue-service/src/testing/department-edit-fixture.ts` (add `selectDepartmentTab`)
- Test: `packages/venue-service/src/dashboard/department-settings.test.ts`,
  `department-settings.a11y.test.ts`, `department-settings.unsaved.test.ts`

**Interfaces:**
- Produces: `export type DepartmentTab = "details" | "service" | "transfers";` (PR 3 adds
  `"receipt"`); `@property() tab: DepartmentTab = "details"`; `get offeredTabs(): DepartmentTab[]`;
  event `department-tab-change` with `detail: { tab: DepartmentTab; replace: boolean }`,
  `bubbles: true, composed: true` — `replace: false` when the person picks a tab, `true` when Save
  moves to a tab with a marked field. Test helper `selectDepartmentTab(form, tab): Promise<void>`
  clicks the tab in the strip.

- [ ] **Step 1: Write the failing tests** in `department-settings.test.ts`:
  - `"draws Details, Service and Transfers tabs with Details first and the name fields on it"` —
    strip keys `["details","service","transfers"]`; the selected panel holds `[name=name]` and
    `[name=tradingName]`.
  - `"the Service tab holds Orders and payment"` — after `selectDepartmentTab(form,"service")` the
    visible panel holds `dashboard-service-settings-fields` under an `h3` reading
    "Orders and payment".
  - `"offers no Transfers tab with one active department"`.
  - `"a draft typed on two tabs is sent by one Save"` — edit name, switch to Service, change how
    orders start, Save: exactly one `saveDepartmentSettings` write whose body carries both.
  - `"Save with a blank name from the Service tab shows Details, marks it and focuses the name"` —
    the Details item's `marked` is "needs fixing", `department-tab-change` fired with
    `{ tab: "details", replace: true }`, focus on `[name=name]`'s input, no write.
  - `"a refusal naming a Transfers field shows the Transfers tab and marks it"` — request answers
    `department_transfer.settings_invalid` `{ field: "receivingProfileId" }`.
  - `"losing the second department while Transfers shows returns to Details and keeps the draft"`.
  - In `department-settings.a11y.test.ts`: axe passes on each tab in light and dark.
  - In `department-settings.unsaved.test.ts`: `"switching tabs neither asks to leave nor dirties the draft"`.
- [ ] **Step 2: Run and watch them fail**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-settings.test.ts src/dashboard/department-settings.a11y.test.ts src/dashboard/department-settings.unsaved.test.ts`
  — expected: the new cases fail (no `wt-tabs`), the old ones pass.
- [ ] **Step 3: Implement** the strip and panels in `department-settings.ts` (decisions above).
  Existing cases in these three files that now fail only because a Transfers field is on a hidden
  tab get `selectDepartmentTab` in their setup — setup changes, listed in the ledger.
- [ ] **Step 4: Run the three files again** — all pass; read the `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Department settings draw Details, Service and Transfers as tabs (A756)"`.

### Task 2: The address follows the tab, and a tab change asks nothing

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-edit-dialog.ts` (pass `.tab`)
- Modify: `packages/venue-service/src/dashboard/venue-departments-shell.ts` (`view` state,
  `#restore`, `#open`, the `#editorOrigin` checks that compare `this.view !== "settings"`, a
  `department-tab-change` handler writing `view` with the event's `replace`, and
  `navigationScopes(destination: URL): readonly object[] | undefined`)
- Modify: `packages/venue-service/src/dashboard/venue-operations-loader.ts` (forward
  `navigationScopes` to its shell) and `packages/venue-service/src/dashboard/index.ts:62-69`
  (the venue-operations `create` returns `navigationScopes` through a `ref`, as `:98-104` does)
- Test: `packages/venue-service/src/dashboard/departments-zones-shell.test.ts`,
  `department-edit-dialog.test.ts`, `apps/dashboard/src/dashboard-app.test.ts` (beside the
  department cases that use `mountDepartments`, `:7804`)

**Interfaces:**
- Consumes: `DepartmentTab`, `department-tab-change`, `offeredTabs` from Task 1.
- Produces: `department-edit-dialog` gains `@property() tab: DepartmentTab = "details"`;
  `VenueDepartmentsShell.navigationScopes(destination)` as above.

- [ ] **Step 1: Write the failing tests.** In `departments-zones-shell.test.ts`:
  - `"choosing the Service tab records /view/service and Back returns to Details"`.
  - `"/manage/venue-operations/department/d1/view/service opens the dialog on Service"`.
  - `"an address naming Transfers with one department opens Details and replaces the address"` —
    `history.replaceState` spied, `pushState` not called (CLAUDE.md §4: spy, never `history.length`).
  - `"closing from the Service tab returns focus to that row's menu"`.
  - `"/view/receipt still opens Edit receipt"` (unchanged until PR 3).
  - `"navigationScopes is [] for another offered tab of the open department and undefined for another department, a zone or receipt"`.
  In `dashboard-app.test.ts` (via `mountDepartments` and the file's `draft(app)` helper):
  - `"typing a name then choosing Service asks nothing, records /view/service and keeps \"Draft restaurant\""`.
  - `"Back from Service returns to Details with no question and the draft kept"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/departments-zones-shell.test.ts src/dashboard/department-edit-dialog.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "Draft restaurant|Back from Service"` — new cases fail (the dashboard ones on the leave question).
- [ ] **Step 3: Implement** the shell mapping, the scopes, the loader and module wiring.
- [ ] **Step 4: Run the same commands** — pass; then the whole `src/dashboard-app.test.ts` once
  (the 7981 case must still ask, unchanged).
- [ ] **Step 5: Commit** `git commit -s -m "The department dialog's tab is kept in the address and a tab change asks nothing (A756)"`.

### Task 3: Phone width, accessibility, docs and a look

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-layout.test.ts:45-49` — today one pass
  checks every `wt-input` and the service fields; split it: check the inputs with Details showing,
  then `selectDepartmentTab(form, "service")` and check the service fields (setup change); add the
  same check for the Transfers tab
- Modify: `packages/venue-service/src/dashboard/department-edit-dialog.a11y.test.ts`,
  `department-edit-dialog-transfers.a11y.test.ts` (axe per tab)
- Modify: `docs/developers/design-system.md` → "Departments and zones" ("Edit department holds
  name, trading name, service settings and transfers" becomes the three tabs, their contents, and
  that a tab change keeps drafts and asks nothing)
- Modify: `docs/backlog/kitchen.md` (A756 point 2: the tabs landed in this PR; left: Receipts, the
  reminder) and `docs/backlog.md` A756 line if its wording goes stale

- [ ] **Step 1:** Add the Transfers phone-width case; run
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-layout.test.ts src/dashboard/department-edit-dialog.a11y.test.ts src/dashboard/department-edit-dialog-transfers.a11y.test.ts`
  and watch the old phone-width case fail on the hidden service fields before it is split.
- [ ] **Step 2:** Split the case; run again — pass.
- [ ] **Step 3: Look.** A throwaway browser test (not committed) mounting the dialog through
  `mountDepartmentEditor`, at `page.viewport(1280, 900)` and `page.viewport(390, 900)`, light and
  dark, each tab selected, saving `page.screenshot({ path: "__screenshots__/look/<name>.png" })`.
  Record `window.innerWidth` read inside the test (testing-guide: the width you asked for is not
  evidence). Open every PNG with the Read tool; check the strip scrolls rather than widens the
  dialog past 390, the Save row stays in view, and the Service headings match mock-up 03 (without
  its Courses and Tables sections). Delete the throwaway test.
- [ ] **Step 4:** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "Department dialog tabs: phone width, accessibility and docs (A756)"`.

### Task 4: Sweep every suite that opens the department dialog

**Files:** whichever of these fail — `packages/venue-service/src/dashboard/department*.test.ts`,
`departments-*.test.ts`, `service-delete-editors.test.ts` (its department cases near `:226-240`
among them), `department-edit-dialog.unsaved.test.ts`, `apps/dashboard/src/dashboard-app.receipt-dialog.test.ts`
and the department block of `apps/dashboard/src/dashboard-app.test.ts` (`mountDepartments` cases).

- [ ] **Step 1: Run** `pnpm --filter @waitron/venue-service exec vitest run` with every
  `src/dashboard/department*`, `src/dashboard/departments-*` and
  `src/dashboard/service-delete-editors.test.ts` file named, and
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.receipt-dialog.test.ts src/dashboard-app.test.ts -t "department|Department"`.
- [ ] **Step 2:** Classify each failure in the ledger: a **setup change** (select a tab first; a
  field reached through the strip) is made; a **changed check** is made only with its spec sentence
  (A756 point 2, "The department dialog becomes tabbed — Details, Service, Receipts, Transfers") and
  listed in the PR description; anything else is a defect in Tasks 1–3 — fix the code, not the test.
- [ ] **Step 3: Re-run** both commands — pass; read the `Tests` counts.
- [ ] **Step 4: Commit** `git commit -s -m "Department suites select the tab their fields are on (A756)"`, then `/finish-branch`.

---

## PR 2 — The Courses page (buildable now)

Branch `feat/a756-courses-page`, from `main` after PR 1. No migration.

**A773-1 overlap.** Three A773-1 files are touched, each outside A773-1's hunks:
`apps/dashboard/src/i18n/strings.ts` (new keys and the value of `kitchen.no_courses`, away from
A773-1's two lines added after `kitchen.courses_title`); `apps/dashboard/src/widgets/course-list.ts`
(a property and a method declared after `render()`, and one condition in `render()`'s add block
`:594-601`; A773-1's nearest hunk `@@ -569,6` ends about line 575); and
`apps/dashboard/src/screens/kitchen-screen.test.ts`, whose fixtures A773-1 edits in hunk
`@@ -23,12 +23,26` — so this PR leaves `COURSES` and `TWO_COURSES` where they are and keeps both
used. `kitchen-screen.a11y.test.ts` (also A773-1-edited) is NOT renamed or changed. A773-1 also makes
`heldUntilFired` required on `Course` (`apps/dashboard/src/api/client.ts`): whichever of PR 2 and
A773-1 lands second adds `heldUntilFired` to the new test fixtures. If A773-1 has landed at
pick-up, the Courses page shows its "Held until fired" column with no work here.

**Decisions.** Nav item `{ screen: "courses", labelKey: "nav.courses", requiresPermission:
"venue.view" }` in the `menu` group (`apps/dashboard/src/dashboard-app.ts:234-243`) between
Modifiers and Units, matching the routes' read rule (`withVenueReadAuth`, `management-api.ts:468-477`);
`readOnly` when the session lacks `venue.configure` (the write rule, `management-api.ts:454-466`).
The page holds no staged input: a course name is saved on Enter or on leaving the field
(`course-list.ts` `#commit(edit, via: "enter" | "leave")`), so the A331 rule's trigger is absent and
no `*.unsaved.test.ts` is added; the course list's existing suites carry over unchanged. The
product editor's Courses window (`apps/dashboard/src/screens/catalogue-screen.ts:843-869`) stays: after
this PR courses are edited in two places, both under design-system's recorded A212 exception.

Strings (dashboard catalogue, EN / ES): the page title reuses `kitchen.courses_title`
("Courses" / "Cursos", `strings.ts:1243`, `:4224`); new `nav.courses` "Courses" / "Cursos";
`courses.description` "The order dishes are served in. A product names its course; drag to change
the order." / "El orden en que se sirven los platos. Cada producto indica su curso; arrastra para
cambiar el orden."; `courses.description_read_only` "The order dishes are served in." / "El orden en
que se sirven los platos.". Change the value of `kitchen.no_courses` to "No courses yet. Add one to
let products say when they are served." / "Aún no hay cursos. Añade uno para que los productos
indiquen cuándo se sirven." (the Courses window reads the same key; the sentence fits it too).

### Task 5: A Courses page under Products and menus

**Files:**
- Create: `apps/dashboard/src/screens/courses-screen.ts`, `courses-screen.test.ts`,
  `courses-screen.a11y.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (`CORE_SCREENS` :116-145, `NAV_GROUPS` menu
  :234-243, `#renderScreen` beside `case "units"`)
- Modify: `apps/dashboard/src/widgets/course-list.ts` (members declared after `render()`; the
  add block's condition)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/dashboard-app.test.ts`

**Interfaces:**
- Produces: element `dashboard-courses-screen` with `api: DashboardApi`, `readOnly: boolean`.
  `dashboard-course-list` gains `@property({ type: Boolean }) showAddButton = true` (read in the add
  block) and `startAdding(): void` (opens the new-course row, as its own button does today).

- [ ] **Step 1: Write the failing tests.** In `courses-screen.test.ts`:
  - `"shows the Courses heading, its description and the shared course list"` — `h1` reads
    `t("kitchen.courses_title")`, the description sentence, one `dashboard-course-list` whose
    `showAddButton` is false.
  - `"Add course in the header opens the new course row with its name field focused"`.
  - `"read-only: names only, no Add course, and the description without the drag sentence"`.
  In `courses-screen.a11y.test.ts`: axe on a populated and an empty list, light and dark (the
  Kitchen screen stays checked by `kitchen-screen.timing.a11y.test.ts` and the untouched
  `kitchen-screen.a11y.test.ts` until Task 6).
  In `dashboard-app.test.ts`:
  - `"Products and menus lists Courses after Modifiers to someone with venue.view"` (this case
    pins the order) and `"hides Courses without venue.view"`.
  - `"/manage/courses opens the Courses page"`.
  - `"a supervisor sees Courses read-only"` — `/manage/courses` as role supervisor with
    `["venue.view"]`: names shown (`"Starters"`), no `[data-test=add-course]`, no `[data-test=name-c1]`
    (the course assertions Task 6 removes from `:2816`).
  The nav search cases stay as they are: `:6765` and `:6805` run with `meResponse`'s permissions
  `["booking.manage"]` (`:98`) or none, so Courses (needing `venue.view`) is not shown there.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/courses-screen.test.ts src/screens/courses-screen.a11y.test.ts src/dashboard-app.test.ts` — new cases fail.
- [ ] **Step 3: Implement** the screen (heading row with the Add course button, as
  `units-screen.ts:531-534` lays out its heading), the nav item, the render case, the two
  course-list members and the strings.
- [ ] **Step 4: Run the same files plus** `src/widgets/course-list.test.ts src/screens/catalogue-screen.test.ts` — all pass.
- [ ] **Step 5: Commit** `git commit -s -m "Courses get their own page under Products and menus (A756)"`.

### Task 6: The Kitchen tab stops listing courses

**Files:**
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts` (delete the courses section :421-424 and
  the `course-list` import :18)
- Modify: `apps/dashboard/src/screens/kitchen-screen.test.ts` — move the case `"shows the courses
  heading over the shared course list, which loads the courses itself"` (`:137`) to
  `courses-screen.test.ts` (changed check, authorised by A756 point 1, "Courses get their own page
  under Products and menus"); add `"the Kitchen tab lists no courses"`, built with
  `stubApi({}, STATIONS, TWO_COURSES)` so `TWO_COURSES` stays used and A773-1's fixture hunk is untouched
- Modify: `apps/dashboard/src/screens/kitchen-screen.a11y.test.ts` only if its two cases fail once
  the list is gone; if they do, they keep their axe checks on the Kitchen screen and drop the
  waiting on course rows (changed check, A756 point 1)
- Modify: `apps/dashboard/src/dashboard-app.test.ts:2816` `"shows a supervisor Tables and Kitchen
  settings without edit controls"` — its course assertions (`:2862-2872`: the list appears, names
  shown, no add-course, no `name-c1`) are removed, being covered by Task 5's supervisor Courses case;
  the bump and fire checks stay (changed check, A756 point 1)
- Modify: `docs/developers/design-system.md:3537` (the A212 exception names "the Courses page and
  the product editor's Courses window" instead of "Venue settings' Kitchen tab"),
  `docs/backlog/kitchen.md` (point 1 done in this PR), `docs/backlog.md` A756 line

- [ ] **Step 1:** Add `"the Kitchen tab lists no courses"`; run
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/kitchen-screen.test.ts` — it fails.
- [ ] **Step 2:** Remove the section; move the case; change `:2816`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.a11y.test.ts src/screens/kitchen-screen.timing.test.ts src/screens/kitchen-screen.unsaved.test.ts src/screens/courses-screen.test.ts src/dashboard-app.test.ts src/dashboard-app.venue-settings-unsaved.test.ts` — pass.
- [ ] **Step 4: Look** at the Courses page as in Task 3 Step 3 (1280 and 390, light and dark,
  with courses, empty, read-only) against mock-up 02; then
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/live-subscriptions.test.ts scripts/dashboard-browser-purity.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "The Kitchen tab no longer lists courses (A756)"`, then `/finish-branch`.

---

## PR 3 — Receipts in the department dialog (buildable now)

Branch `feat/a756-department-receipts`, from `main` after PR 1. No migration. Independent of PR 2.

**Decisions.**
- The receipt editor loses its own modal and becomes `dashboard-department-receipt-editor`
  (`apps/dashboard/src/screens/department-receipt-editor.ts`). It is still supplied through
  `ctx.renderPanel("department-receipt", subject)` (`apps/dashboard/src/dashboard-app.ts:1403-1410`),
  only to sessions with `layout.configure`; venue-service never imports it (module seam).
- The department dialog offers a Receipts tab (key `receipt`, label "Receipts" / "Recibos") between
  Service and Transfers when `renderPanel` returns an editor. The dialog is `size="wide"` whenever it
  offers Receipts, so switching tabs never changes its width; otherwise `standard` as today.
  `receipt` becomes a view the dialog offers, so Task 2's `navigationScopes` returns `[]` for it.
- Two drafts, two Save buttons: Details/Service/Transfers share the department form's Save; the
  Receipts tab shows the editor's own Save and Cancel, and the form's action row hides while
  Receipts is selected. A Save closes the dialog only when the other draft is clean; otherwise the
  dialog stays open on the same tab (as `department-edit-dialog.ts` `saved()` already does for a
  newer edit). Cancel on either asks the dialog to close. Escape, Cancel and the close button ask
  ONE leave question covering both drafts (`LeaveRequest.scopes` takes a list,
  `packages/ui-core/src/unsaved-changes.ts:23`).
- **Enter in a receipt field never reaches the department form's Save.** The form's
  `submitOnEnter` listener sits on its `.form` wrapper (`department-settings.ts:514-517`) and clicks
  the department Save for any Enter from a single-line input (`packages/ui-core/src/submit-on-enter.ts:20-38`);
  the receipt editor stops an Enter only when its own Save is enabled. So the wrapper's listener
  returns early when the event's `composedPath()` holds the Receipts panel.
  (2026-10-18, A756 PR 3: superseded — the listener now sits on the Details, Service and Transfers
  panels, so Enter from Receipts never reaches it.)
- The departments list's Receipt link goes (A756 point 2). The "Set up the tax-agency description"
  button (`departments-list.ts:171-184`) still sends `edit-receipt`, which now opens the department
  dialog on Receipts. `/view/receipt` opens that tab; without `layout.configure` it opens Details and
  replaces the address. The image library's "in use" link
  (`packages/media/src/dashboard/image-library.ts:39`, `/view/receipt`) must keep landing on the
  Receipts tab (`dashboard-app.unsaved-changes.test.ts:824-828` keeps passing unchanged).

### Task 7: Split the receipt editor out of its modal

**Files:**
- Create: `apps/dashboard/src/screens/department-receipt-editor.ts` (fields, preview, draft
  scope, save — moved from `department-receipt-dialog.ts`), `department-receipt-editor.test.ts`
- Modify: `apps/dashboard/src/screens/department-receipt-dialog.ts` (a thin `wt-modal` around the
  editor that keeps today's contract: heading, description, `size="wide"`, close on save, close
  events), and `apps/dashboard/src/testing/department-receipt-dialog-fixture.ts` (helpers reach
  through the editor's shadow root)
- Test: every suite importing the dialog or its fixture must pass with no check edited — the seven
  `department-receipt-dialog*.test.ts`, `receipt-editor-boundaries.test.ts`,
  `dashboard-app.receipt-dialog.test.ts`, `dashboard-app.venue-settings-unsaved.test.ts`

**Interfaces:**
- Produces: element `dashboard-department-receipt-editor` with `api`, `subject?: {id,name}`,
  `canManagePolicy`, `requiresDescription` (as today's dialog); `get leaveScope(): object |
  undefined`; `get hasUnsavedChanges(): boolean`; `get saving(): boolean`. Events (bubbling,
  composed): `department-receipt-saved` `{ departmentId }` after a write is committed (the editor
  stays mounted and shows the saved values); `department-receipt-cancel` `{ departmentId }` from
  its Cancel; `department-receipt-closed` `{ departmentId }` when its department disappears.
  Its form actions render inline in the body, not in a `footer` slot.

- [ ] **Step 1: Write the failing tests** in `department-receipt-editor.test.ts`:
  `"after Save the editor stays, shows the saved values with Save quiet, and reports saved"`;
  `"Cancel reports cancel and changes nothing"`; `"leaveScope is dirty after an edit and clean after Save"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/department-receipt-editor.test.ts` — fails (no element).
- [ ] **Step 3: Implement** the editor and the thin dialog.
- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/department-receipt-editor.test.ts src/screens/department-receipt-dialog.test.ts src/screens/department-receipt-dialog.unsaved.test.ts src/screens/department-receipt-dialog.retained.test.ts src/screens/department-receipt-dialog.preview.test.ts src/screens/department-receipt-dialog.client.test.ts src/screens/department-receipt-dialog.width.test.ts src/screens/department-receipt-dialog.a11y.test.ts src/screens/receipt-editor-boundaries.test.ts src/dashboard-app.receipt-dialog.test.ts src/dashboard-app.venue-settings-unsaved.test.ts` — all pass with no check edited.
- [ ] **Step 5: Commit** `git commit -s -m "The receipt editor stands on its own inside the Edit receipt dialog (A756)"`.

### Task 8: The Receipts tab in the department dialog (venue-service only)

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` (`DepartmentTab` gains
  `"receipt"`; a `receipt` panel slotting `receiptEditor`; action row hidden on Receipts; the
  `.form` Enter listener ignores the Receipts panel), `department-edit-dialog.ts` (`receiptEditor:
  unknown` property, `size`, one leave question, the close rule), `venue-departments-shell.ts`
  (`receipt` joins the offered views and `navigationScopes`), `strings.ts`
  (`venue.department_tab.receipt` "Receipts" / "Recibos")
- Test: `packages/venue-service/src/dashboard/department-edit-dialog.test.ts`,
  `department-edit-dialog.unsaved.test.ts`, `departments-zones-shell.test.ts` — with a stub
  `dashboard-department-receipt-editor` element defined in the test file, holding one single-line
  input in its shadow root, exposing `leaveScope`/`hasUnsavedChanges`/`saving` and sending the
  three events

The shell still renders its own Edit receipt branch for `view=receipt` until Task 9 passes it the
editor; in this task the dialog's Receipts tab is exercised only with the stub.

- [ ] **Step 1: Write the failing tests** in `department-edit-dialog.test.ts`:
  `"offers Receipts between Service and Transfers when an editor is supplied, and is wide"`;
  `"no editor, no Receipts tab, standard width"`;
  `"a receipt Save closes the dialog when the department form is clean"`;
  `"a receipt Save keeps the dialog open on Receipts when Details is dirty, and the Details edit survives"`;
  `"Enter in a receipt field, receipt unchanged and Details dirty, writes nothing"`;
  in `department-edit-dialog.unsaved.test.ts`:
  `"Escape with both drafts dirty asks one question; Discard closes without writing either"`;
  `"a pending receipt Save blocks Escape and Cancel"`;
  in `departments-zones-shell.test.ts`:
  `"navigationScopes is [] for receipt when the dialog offers it"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-edit-dialog.test.ts src/dashboard/department-edit-dialog.unsaved.test.ts src/dashboard/departments-zones-shell.test.ts` — new cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/dashboard/department-settings.test.ts` — pass.
- [ ] **Step 5: Commit** `git commit -s -m "The department dialog can hold a Receipts tab (A756)"`.

### Task 9: The dashboard hands the editor to the Receipts tab

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts:1403-1410` (`renderPanel("department-receipt")`
  renders `dashboard-department-receipt-editor`)
- Modify: `packages/venue-service/src/dashboard/venue-departments-shell.ts` (pass the rendered
  editor to `department-edit-dialog`; drop its own receipt branch and the separate
  `#receiptClosed`/`#receiptSaved` closes)
- Test: the integration cases in the table below (`dashboard-app.receipt-dialog.test.ts`,
  `dashboard-app.test.ts:7981-8120`, `dashboard-app.venue-settings-unsaved.test.ts:766-800`,
  `dashboard-app.unsaved-changes.test.ts:824-828`, venue-service `service-delete-editors.test.ts:289`)

Each case's fate (authority for every "rewritten": A756 point 2, "Receipt editing … moves into the
Receipts tab"; for every link case: "the departments table's Receipt link … goes"):

| Case | Fate |
|---|---|
| `dashboard-app.test.ts:7981` "the real receipt link keeps its department and asks before leaving a Settings draft" | **Rewritten, check reversed**: opening Receipts with a Settings draft asks nothing, the address becomes `/view/receipt` and the draft is kept |
| `:8002` "a department deep link still requires its own permission: %j" | Unchanged |
| `:8011` "Receipt opens the authoritative live department %s" | Rewritten: the department dialog opens on Receipts for that department |
| `:8036` "hosted Receipt %s Keeps then Discards one draft and returns to the list" | Rewritten: Cancel/Escape from the Receipts tab, one question, then the list |
| `:8066` "a missing department Receipt URL does not borrow another department" | Unchanged check; it looks for `dashboard-department-receipt-editor` instead of the dialog element |
| `:8077` "the department's Receipt link navigates to its department without a picker" | Kept until Task 11, which deletes it with the link |
| `:8097` "Settings hides Edit the receipt when the host cannot offer Receipt" | Rewritten: no Receipts tab |
| `:8106` "a Receipt deep link cannot bypass either permission: %j" | Unchanged check (it looks for the editor element instead of the dialog); without `layout.configure` it lands on Details |
| `dashboard-app.receipt-dialog.test.ts:160` "mounts the selected protected receipt dialog with installed description visibility (%s)" | Rewritten: the Receipts tab's editor, same visibility checks |
| `:178` "successful receipt save closes the hosted dialog and updates the department host" | Rewritten: closes because the department form is clean |
| `:222` "Venue settings no longer hosts a global receipt tab or global receipt reads" | Unchanged |
| `:238` "a deep link cannot open the receipt without layout permission" | Rewritten: Details opens, no Receipts tab |
| `dashboard-app.venue-settings-unsaved.test.ts:766` "the receipt dialog's Cancel protects the appearance before closing" | Rewritten: the Receipts tab's Cancel |
| `:787` "an obsolete receipt department query cannot bypass a venue draft leave decision" | Unchanged check |
| `dashboard-app.unsaved-changes.test.ts:824-828` (image library's receipt link) | Unchanged check: `/view/receipt` lands on Receipts |
| `service-delete-editors.test.ts:289` "department deletion removes its contributed receipt panel while another department draft survives" | Rewritten: deletion closes the department dialog with its Receipts tab; the other department's draft survives |

- [ ] **Step 1:** Rewrite the "Rewritten" cases first; run
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.receipt-dialog.test.ts src/dashboard-app.test.ts src/dashboard-app.venue-settings-unsaved.test.ts src/dashboard-app.unsaved-changes.test.ts`
  and `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/service-delete-editors.test.ts` — the rewritten cases fail.
- [ ] **Step 2: Implement** the wiring.
- [ ] **Step 3: Run** both commands — pass.
- [ ] **Step 4: Commit** `git commit -s -m "Receipt editing moves into the department dialog's Receipts tab (A756)"`.

### Task 10: The Edit receipt dialog goes

**Files:**
- Delete: `apps/dashboard/src/screens/department-receipt-dialog.ts`
- Rename: the fixture to `apps/dashboard/src/testing/department-receipt-editor-fixture.ts`
  (mounts the editor alone); its importers `receipt-editor-boundaries.test.ts`,
  `dashboard-app.venue-settings-unsaved.test.ts` and the receipt suites follow
- Rename: `department-receipt-dialog.{test,unsaved.test,retained.test,preview.test,client.test,width.test,a11y.test}.ts`
  → `department-receipt-editor.*`

Fate of each dialog-dependent case (authority as in Task 9). Every other case in these suites
keeps its check; only its mount goes through the editor fixture (setup change).

| Case | Fate |
|---|---|
| `.test.ts:36` "saves exact independent receipt and policy, keeps hidden translations and closes before any refresh" | Rewritten: "… and stays with Save quiet before any refresh" |
| `.test.ts:292` "a departed %s cannot close or mark a reopened dialog" | Rewritten: "a departed %s cannot mark a reopened editor" |
| `.test.ts:317` "opens a host-selected subject once and returns to its host on close" | Rewritten: opens a subject once; the return-on-close half is Task 8's dialog case |
| `.test.ts:344` "refreshes the selected subject name without replacing its dirty receipt or rereading" | Rewritten: the modal `description` assertion (`:349`) is deleted — the department dialog's heading names the department; the draft and no-reread checks stay |
| `.test.ts:353` "can reopen the same subject after its host clears a closed selection" | Rewritten: a cleared then re-set subject loads afresh |
| `.test.ts:369` "a selected department removed during its live read returns its identity to the host once" | Rewritten: the `department-receipt-closed` check stays; the wait for the modal to close goes |
| `.test.ts:384` "an ignored replacement subject does not overwrite a dirty receipt or consume its later opening" | Rewritten: the subject and draft checks stay; the modal `description` (`:390`) and `open` checks go |
| `.test.ts:442` "a native receipt trading-name choice stays authored through %s at its new owner" | Rewritten: the authored-choice checks stay; the modal `open` checks (`:470-485`) go |
| `.test.ts:406`, `:493` | Unchanged checks |
| `.test.ts:423` "a live receipt response delivered after Cancel begins cannot reopen the closing dialog" | Rewritten at the department dialog in `dashboard-app.receipt-dialog.test.ts`: a live receipt read after Cancel begins cannot keep the dialog open |
| `.client.test.ts:94` "… writes the exact model envelope through the real client and closes" | Rewritten: "… and stays with Save quiet" |
| `.client.test.ts:113` "a declarative selection can reopen the same department after its closed subject is cleared" | Rewritten as `.test.ts:353` |
| `.client.test.ts:133` "host-selected receipt client fits $locale/$theme/$width" | Rewritten: fits inside the department dialog's Receipts tab |
| `.unsaved.test.ts:27` "untouched Escape closes without a leave question", `:36` "dirty Escape and Cancel protect the draft with Keep and Discard", `:76` "pending Save blocks Escape, Cancel and a duplicate request" | Moved to Task 8's dialog suite (with the stub) and Task 9's integration cases; here only the duplicate-request check stays |
| `.unsaved.test.ts:95` "reconnecting the same receipt preserves its native draft and original Save baseline", `:111` "a removed receipt closes the native modal and releases its mounted draft" | Rewritten: reconnecting keeps the draft and baseline; a removed department releases the draft and sends `department-receipt-closed` |
| `.unsaved.test.ts:64`, `:120` | Unchanged checks |
| `.width.test.ts:22`, `:99` (each at 1280 and 390) | Rewritten: measured inside the department dialog offering Receipts |
| `.a11y.test.ts` cases that open the modal | Rewritten: axe on the editor inside the Receipts tab, both themes |

- [ ] **Step 1:** Make the renames and fixture change; rewrite the cases above.
- [ ] **Step 2: Run** every `src/screens/department-receipt-editor*.test.ts` file named, plus
  `src/screens/receipt-editor-boundaries.test.ts src/dashboard-app.venue-settings-unsaved.test.ts src/dashboard-app.receipt-dialog.test.ts` — pass; no file still imports the dialog (`git grep department-receipt-dialog` is empty outside docs).
- [ ] **Step 3: Commit** `git commit -s -m "The Edit receipt dialog is retired; its suites test the editor (A756)"`.

If Tasks 9 and 10 look like they will pass ~100 implementer calls between them, stop at Task 9's
commit and hand over; Task 10 is separate on purpose.

### Task 11: The Receipt link goes; docs, backlog and a look

**Files:**
- Modify: `packages/venue-service/src/dashboard/departments-list.ts:214-231` (a department row's
  Also edit cell is empty; zones keep Floor plan — 2026-10-18: A504 removed the zones' Floor plan
  link first, so the column is empty on every row); `departments-list.test.ts`,
  `departments-list.a11y.test.ts`, `departments-zones-list.test.ts` (cases asserting the link —
  changed checks, authorised by A756 point 2, "the departments table's Receipt link … goes"; a new
  case `"a department row has no Receipt link and the description button opens Receipts"`);
  `apps/dashboard/src/dashboard-app.test.ts:8077` deleted with the link
- Modify: `docs/developers/design-system.md` → "Departments and zones" (Also edit; "Edit receipt …
  is a wide `wt-modal`" becomes the Receipts tab), `docs/backlog.md` and `docs/backlog/kitchen.md`

- [ ] **Step 1:** Write the new list case; run
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/departments-list.test.ts src/dashboard/departments-zones-list.test.ts src/dashboard/departments-list.a11y.test.ts` — it fails.
- [ ] **Step 2:** Remove the link; adjust the authorised checks; run again, plus
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.unsaved-changes.test.ts` — pass.
- [ ] **Step 3: Look** (as Task 3 Step 3) at the dialog on every tab, Receipts with its preview, at
  1280 and 390, light and dark; and at the departments list.
- [ ] **Step 4: Backlog.** Rewrite the A756 entry in `docs/backlog.md` and its detail in
  `docs/backlog/kitchen.md` so they hold only what waits: PRs 4–8 below, each one line with its
  blocker, and the Kitchen tab's removal. Keep the "Changed by A773" block. Run
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/claude-md-pointers.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "The departments list drops its Receipt link; backlog keeps only A756's waiting parts"`, then `/finish-branch`. The PR description says which parts wait for A773-1 and A773-2 (the table above).

---

## PR 4 — The reminder to fire the next course, per department

Planned 2026-10-23, after A773-1 (#1897) and A773-2 PR A (#1944) landed. Branch
`feat/a756-4-reminder-per-department`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a756-4-reminder-per-department`, cut from
`main` at `b85119762`. Ledger: `~/waitron-campaign-c/item-a756-ledger.md`; every task ends by
updating it (done, changed test checks, next step).
**Review path: FULL** — a migration, and a change to a contract between packages (the venue-service
seat in `packages/module/src/module.ts`). Implementers are dispatched as
`subagent_type: "implementer"`.

**Goal.** The reminder to fire the next course stops being one venue-wide value and becomes each
department's own, set on the department dialog's Service tab under a new "Courses and the kitchen"
section; a party's held group falls due by its own department's minutes. The Kitchen tab loses the
dropdown. What the till shows (the held chip on the floor and the Held line of the Sent panel) and
the wire shape it reads (`reminder: ReleaseReminder | null`) do not change.

**Files it touches.**
- venue-service: `src/schema/service.ts` (`departments`), `src/schema/settings.ts`
  (`service_settings`), a generated migration in `drizzle/`, new `src/release-reminders.ts` and its
  test, `src/index.ts`, `src/service.ts`, `src/operations.ts`, `src/routes.ts`,
  `src/kitchen-notices.ts`; dashboard `src/dashboard/client.ts`, `department-settings.ts`,
  `service-settings-panel.ts`, `strings.ts`; their tests and the model fixtures listed in Task 15.
- module: `packages/module/src/module.ts` (the seat).
- server: `apps/server/src/parties.ts`, `order-groups.ts`, `working-order.ts` (one comment), new
  `src/testing/release-reminder.ts`, and the server tests named in Task 13.
- till: `apps/till/src/api/client.ts` (one comment).
- dashboard app: `apps/dashboard/src/dashboard-app.test.ts`,
  `apps/dashboard/src/testing/department-receipt-app-fixture.ts` (fixtures only).
- docs: the guides `apps/server/src/guide/{en,es}/kitchen-service.md`,
  `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/kitchen.md`,
  `docs/backlog/dashboard.md` (a dated pointer on one Decisions entry), and the A664 audit's two
  table rows.

### PR 4 decisions (each with its receipt)

1. **Storage: a nullable column on `departments`, default 10; the venue column is dropped.**
   `releaseReminderMinutes: count("release_reminder_minutes").default(10)` goes after
   `needsClearing` (`packages/venue-service/src/schema/service.ts:35`): the same declaration the
   venue column has today (`packages/venue-service/src/schema/settings.ts:23-26`), null meaning
   off. No CHECK, so drizzle adds the column instead of rebuilding `departments`, which other
   tables' foreign keys point at (A757 slice 1 plan, Decision 1); the range is checked at the
   route, as `requireReleaseReminderMinutes` does today (`packages/venue-service/src/routes.ts:270-283`).
   `count` adds no CHECK (`packages/db/src/schema/columns.ts:148`, a bare `integer`).
   **Measured 2026-10-23** in a scratch copy of this worktree (`cp -c -R`, its `.git` pointer
   removed): with the column moved, `packages/venue-service/node_modules/.bin/drizzle-kit generate --name probe`
   wrote exactly ``ALTER TABLE `departments` ADD `release_reminder_minutes` integer DEFAULT 10;``
   and ``ALTER TABLE `service_settings` DROP COLUMN `release_reminder_minutes`;`` — no `__new_`
   table, so no rebuild of either. With that file in place
   `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`
   printed `Test Files 7 passed (7)`, `Tests 472 passed (472)`;
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` `2 passed`; and
   `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts`
   `72 passed`. So `scripts/migration-upgrade.test.ts` needs no new `CANDIDATES` value; if the
   implementer's own run of it fails on the new column, adding a sample value there is allowed
   (owner). Nothing references `service_settings` in migration SQL
   (`git grep -n -i 'references \`service_settings\`' -- 'packages/*/drizzle/*.sql'` prints
   nothing) and no migration trigger names it or `departments`
   (`git grep -n -i trigger -- 'packages/*/drizzle/*.sql' | grep -i -E 'service_settings|departments'`
   prints nothing). The DROP survives the change feed's update trigger on `service_settings` for
   the reason A757 slice 1 measured (its Decision 2): `migration-upgrade` installs the feed before
   each step and still passed.
   **What an existing venue gets:** every department reads 10 minutes, whatever the venue had, and
   the venue's own value is dropped, not copied (CLAUDE.md §3, "No backwards-compatibility … until
   Waitron is in production"). Control, Node v26.11.1 `node:sqlite`: a `departments` table holding
   a row, after that `ALTER TABLE … ADD … DEFAULT 10`, read `release_reminder_minutes` 10 for the
   old row and for a row inserted after (null would have shown the failing case). **No venue reset**:
   the upgrade walk passed, and no shipped migration file is edited.
   The configuration fixture `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:405`
   still names the venue column; it is left as it is, for the reasons of A757 slice 1's Decision 9
   (a version-1 bundle is refused before any table is read). The new column travels in a
   configuration bundle with no code: `departments` and `service_settings` are both declared
   transfer tables (`packages/venue-service/src/configuration-transfer.ts:700`, `:714`); Task 13
   adds the case that shows it.

2. **A party follows the department of its first table — the zone `partyZone` already names.** A
   held group belongs to a party (`order_groups.party_id`, not null,
   `packages/db/src/schema/order-groups.ts:22`), so the reminder is a party's, not a table's. The
   party's service zone is already defined once: "the service zone of the party's earliest active
   table" (`partyZone` and `partyStateAndZone`, `apps/server/src/parties.ts:201-227`), and it is
   the zone a party's new bill is opened in (`parties.ts:168-173`) and its orders are priced in
   (`apps/server/src/order-drafts.ts:532`). A zone's department is its `zone_service_policies` row
   (`packages/venue-service/src/schema/service.ts:52-78`). So the reminder reads: first active
   table → its zone → that zone's department's minutes. A party at no active table, or whose
   zone has no department, has no reminder — as a table with no department needs no clearing and
   shows no service steps (A757 slice 1, Decision 3; slice 8, Decision 4). `departments.active` is
   not filtered, as slice 1 did not (`packages/venue-service/src/table-clearing.ts:15-17`). That
   differs from `resolveZoneContext`, which takes an order only in an active zone of an active
   department (`packages/venue-service/src/operations.ts:554-555`), and the difference is
   harmless: deleting a department deactivates its zones in the same step
   (`packages/venue-service/src/service-delete.ts:343-345`), so a party still seated there takes no
   new order and keeps the minutes its department last had — read, not run. The seat's doc comment
   says so.
   **Today a party cannot sit in two zones at once,** so the rule is a guard: joining a table in
   another zone is refused `service_zone.join_mismatch` (`apps/server/src/table-actions.ts:170-176`),
   a floor merge across zones is refused the same way (`apps/server/src/floor-today-merges.ts:175-180`),
   and moving guests takes the party off all its tables (`table-actions.ts:80-125`) — read, not run;
   Task 13's tests build every unusual shape (two zones, a zone with no department) by direct
   writes to `party_tables` and `dining_tables`, because no real path builds them.
   **Worked example.** Restaurant has 10 minutes, Terrace 5. A party sits at R4 (Restaurant) at
   20:00; its mains are served at 21:00, so its desserts fall due at 21:10. Were it also holding T2
   (Terrace, joined later), it would still read Restaurant's 10. Moved wholly to T2, it reads
   Terrace's 5: due 21:05. If Terrace has reminders Off, the moved party shows no reminder.
   **Why not the shortest of the departments involved:** it would make the reminder disagree with
   the department whose menus and service the party's orders are taken under, and needs a rule
   for Off against a number; with one zone per party the two rules give the same answer today.

3. **The seat becomes per zone, under a new name; its two callers move with it.**
   `readReleaseReminderMinutes(tx: Transaction): Promise<number | null>`
   (`packages/module/src/module.ts:1449-1450`) is replaced by
   `readReleaseReminderMinutesByZone(tx: Transaction, zoneIds: readonly string[]): Promise<ReadonlyMap<string, number | null>>`
   — each of these zones' department's minutes, null where that department has reminders off; a
   zone with no department is absent. A new name, so the new seat can stand beside the old one
   until Task 14 (as A757 slice 1 did with its seat). Every consumer, by
   `git grep -n -E 'readReleaseReminderMinutes|ReleaseReminderMinutes\(' -- apps packages`:
   the seat's only implementation is `VENUE_SERVICE` (`packages/venue-service/src/service.ts:96`,
   `:245`, from `kitchen-notices.ts:364-371`); its only callers are `readReleaseReminders`
   (`apps/server/src/order-groups.ts:1547`, feeding the floor through `readSeatedParties`,
   `apps/server/src/working-order.ts:8455`) and `readCurrentOrders` (`order-groups.ts:1956-1957`,
   feeding the Sent panel through `GET /api/parties/:id/current-orders`, `apps/server/src/till-api.ts:3173`);
   the seat key list pins its name (`packages/venue-service/src/service.test.ts:90`). The venue
   route's helpers have other callers that go in Task 14: `readReleaseReminderMinutes` at
   `routes.ts:767` and `:786`, `writeReleaseReminderMinutes` at `routes.ts:852` and in five server
   test files (Task 13). No test double implements the seat (`git grep -n 'readPrintMovedSlips[:(]'`
   finds only the real seat and its callers). `readReleaseReminders(tx, partyIds)` and
   `readCurrentOrders(tx, partyId)` keep their signatures, so their test call sites and
   `apps/server/src/party-allergy.ts:78` are untouched.
   **Measured 2026-10-23** in the same scratch copy with a throwaway version of Tasks 12–13: with
   the server reading the department's minutes and the venue writes left in the tests,
   `pnpm --filter @waitron/server exec vitest run src/current-orders.test.ts src/draft-recall.test.ts src/line-service-operations.test.ts src/line-service-projections.test.ts src/line-service-removal.test.ts src/order-groups.test.ts src/party-main-bill.test.ts src/table-signals.test.ts src/till-api.groups.test.ts`
   printed `Tests 2 failed | 573 passed (575)` — only `current-orders.test.ts`'s "shows no reminder
   at all while the venue has reminders off" and "measures from the venue's interval…", the two
   cases that set a value other than 10. With the five files' `writeReleaseReminderMinutes(` swapped
   for an every-department helper: `Tests 575 passed (575)`, and filtered to
   `-t "[Rr]emind|interval|due|snooze"` `Tests 52 passed | 97 skipped`. So every party those
   suites seat is in a zone with a department, and no switch call needs moving after a table's
   creation (unlike A757 slice 1's three reorders).

4. **The dashboard.** The department save (`PUT /management-api/venue-service/departments/:departmentId/settings`,
   `routes.ts:857-905`) gains an optional `releaseReminderMinutes`: absent leaves the stored value
   (as `needsClearing`, `routes.ts:871-874`); `null` or a whole number 1–120, else 400
   `management.request_invalid` `{ field: "releaseReminderMinutes" }` — today's validator, reused.
   The model (`GET /management-api/venue-service`, `routes.ts:747-773`) gains
   `releaseReminderMinutesByDepartment: Record<string, number | null>`, every active department of
   the location keyed by id, and loses `releaseReminderMinutes` in Task 14. A map rather than a
   field on each department, so each model fixture changes one line rather than every department
   literal (the reason of A757 slice 1, Decision 5). The dialog's Service tab gains
   `<section aria-label=…><h3>Courses and the kitchen</h3>` between "Orders and payment" and "Table
   states" (mock-up 03 draws it there; A773 §7.2 keeps the reminder in it and drops "Who sends a
   held course"), holding today's dropdown moved from `service-settings-panel.ts:176-216`: a
   `wt-combobox name="releaseReminderMinutes"` with Off and 5, 10, 15, 20, 30 minutes, plus a stored
   value the list does not offer. It joins the dialog's one draft — `fieldTab`, `equal`, the
   refusal field list and `willUpdate`'s `source` (`department-settings.ts:63-75`, `:87-100`,
   `:575-586`, `:276-286`) — so the A331 save rule the dialog already runs on (`draftScopeFor` at
   `:340`, `saveActionState` at `:487`, `:619`, `:747`) keeps Save quiet and disabled until it
   changes. `DepartmentSettingsInput` (`client.ts:44-53`) gains a required
   `releaseReminderMinutes: number | null`, so every save sends it, as it sends `needsClearing`.
   **Product text.** Quoted from the owner-approved mock-up 03, with one word changed by a later
   owner decision. Mock-up 03 (approved 2026-10-16) draws the section `Courses and the kitchen` and
   the field `Remind to send the next course after`, showing `10 minutes`. A773's "Words used here"
   (owner brainstorms of 2026-10-16 and 2026-10-17, after the mock-ups: "Every decision in the
   revision is the owner's", `docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md:3-5`,
   `:70-83`) makes **Send** the step that puts a dish into Held and **Fire** "cook this now"; a held
   course has already been sent, so "send" would now name the wrong step, and A773 §7.2 calls this
   setting "the reminder to fire the next course" (`:506-507`). "Course" stays: A773 keeps it in
   that sentence, so it is not overridden. So: EN section `Courses and the kitchen`, field
   `Remind to fire the next course after`; ES section `Cursos y cocina`, field
   `Avisar para marchar el siguiente curso tras` ("marchar" for fire as the till's
   `table.reminder_due` says, `apps/till/src/i18n/strings.ts:2814`; "curso" as its
   `table.course_label`, `:2791`). New key `venue.courses_and_kitchen`; the values of
   `venue.release_reminder` change (`packages/venue-service/src/dashboard/strings.ts:526`, `:1425`).
   Off / Deshabilitado and "{n} minutes" / "{n} minutos" stay. The hint stays as it is, and stays
   the dropdown's `hint`, by the owner's decision of 2026-10-17
   (`docs/backlog/dashboard.md:697-700`). The departures from the mock-up, for the PR description:
   the one word above, the Off choice (today's), and no "Who sends a held course" buttons (A773 §7.2).
   **The range is not changed.** A773 §3.4 says "N = 0 meaning at once (owner, 2026-10-17)", and
   `releaseReminder` handles 0 (`order-groups.ts:1529-1532`), but the route refuses 0
   (`routes.ts:277`) and the list offers 5–30. This PR does not build it; Task 18 adds it to the
   backlog as work to do.

5. **Docs.** No user guide describes the reminder today
   (`git grep -n -i -E 'remind|recordatorio' -- apps/server/src/guide` finds only service steps
   and an unrelated Spanish "aviso para"). Since the Service tab gains a section, Task 18 adds one
   paragraph, EN and ES, to `kitchen-service.md`'s "Request cooking from the till"
   (`{#request-cooking}`, both languages) saying where each department sets it. design-system.md's
   "Edit department is tabbed" paragraph (`:5458-5461`) gains the section; the A664 audit's
   `departments` and `service_settings` rows (`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md:162`, `:170`)
   gain dated pointers as slice 1's did; the Decisions entry on the Kitchen panel's two dropdown
   hints (`docs/backlog/dashboard.md:697-700`) gains a dated pointer, never a deletion; `docs/backlog.md`'s A756 entry (`:1570-1572`) and its
   detail (`docs/backlog/kitchen.md:142-155`) drop PR 4 and keep PRs 5–8.

6. **No live-query or error-code change.** The department dialog's model watch,
   `QUERY_DEPENDENCIES.operations`, already lists `departments` (the reason of A757 slice 1,
   Decision 10). No error code is added or retired. The till's re-read triggers are not changed by
   this PR (Review focus 5).

### PR 4 review focus

1. **A department with reminders Off beside one with 10:** a party in the Off department shows no
   reminder on the floor or in the Sent panel; the other's is due 10 minutes after its work ahead
   was served (Task 13).
2. **A party whose first table changes department:** inserted at a second department's table, it
   keeps its first table's minutes; once its first table is left, it takes the second's (Task 13).
3. **A party at a table whose zone has no department:** no reminder, though every department has
   one — the venue value no longer catches it (Task 13).
4. **The venue column leaves no reader:** after Task 15
   `git grep -n -E 'releaseReminderMinutes|release_reminder_minutes|saveReleaseReminderMinutes|writeReleaseReminderMinutes' -- apps packages ':!**/drizzle/**'`
   prints only the department code, the dashboard dialog and its fixtures, and the v1 JSON fixture
   of Decision 1; `GET …/settings` carries no reminder, `PUT …/settings/release-reminder-minutes`
   answers 404, and the Kitchen tab draws no reminder dropdown (Tasks 14–15).
5. **A department's change reaching a till that is already showing the table:** this PR does not
   change when the till re-reads the floor or the Sent panel; a reviewer checks it behaves as the
   venue setting did (changed on the dashboard, then the till's next read shows the new due time),
   and reports it rather than fixing it here.

### Task 12: venue-service stores and serves each department's reminder (additive)

**Files:**
- Modify: `packages/venue-service/src/schema/service.ts` (`departments`, after `needsClearing`)
- Create (generated): `packages/venue-service/drizzle/NNNN_department_release_reminder.sql`, its
  snapshot and journal entry, by
  `pnpm --filter @waitron/venue-service exec drizzle-kit generate --name department_release_reminder`
  — never numbered or edited by hand
- Create: `packages/venue-service/src/release-reminders.ts`, `release-reminders.test.ts`
- Modify: `packages/venue-service/src/index.ts` (`export * from "./release-reminders.js";`),
  `src/service.ts` (list the new seat), `src/service.test.ts` (key list),
  `packages/module/src/module.ts:1449-1450` (the new seat beside the old)
- Modify: `packages/venue-service/src/operations.ts:224-255` (`updateDepartment` input gains
  `releaseReminderMinutes?: number | null`, and its write condition at `:237-241` gains
  `|| input.releaseReminderMinutes !== undefined`), `:752-792` (`DepartmentEditInput`,
  `saveDepartmentEditSettings` passes it through)
- Modify: `packages/venue-service/src/routes.ts:747-773` (model field), `:857-905` (PUT body)
- Test: `packages/venue-service/src/routes.test.ts` (beside the Needs clearing cases, `:590-644`)

**Interfaces — produces:**
- schema: `releaseReminderMinutes: count("release_reminder_minutes").default(10)` on `departments`
- `readReleaseReminderMinutesByZone(tx: Transaction, zoneIds: readonly string[]): Promise<ReadonlyMap<string, number | null>>`
  — one select, `zone_service_policies` inner join `departments` on `department_id`, where
  `zone_id in (…)`; empty input answers an empty map with no query; `departments.active` not filtered.
- `listDepartmentReminderMinutes(tx: Transaction, cfg: VenueScope): Promise<Record<string, number | null>>`
  — every active department of `cfg.locationId`.
- module seat, doc comment: "Each of these zones' department's minutes after the work ahead is
  served that a held group falls due; null where that department has reminders off. A zone with no
  department is absent. An inactive department still answers: deleting one deactivates its zones,
  so a party seated there takes no new order and keeps its department's last minutes."
- GET `/management-api/venue-service` gains `releaseReminderMinutesByDepartment`.
- PUT `…/departments/:departmentId/settings` accepts optional `releaseReminderMinutes` (Decision 4);
  `"releaseReminderMinutes"` joins `onlyKeys`.

- [ ] **Step 1: Write the failing tests.** `release-reminders.test.ts`, set up as
  `table-clearing.test.ts` is (`useVenueDb`, `seedTenant`, a `locations` row, `createDepartment`,
  `createServiceZone`):
  - `"reads each zone's department's minutes, null where the department has reminders off"` —
    departments A (25, by direct `update`) and B (null), a zone in each →
    `toEqual(new Map([[zoneA, 25], [zoneB, null]]))`.
  - `"reads 10 for a department nobody has changed"`.
  - `"leaves out a zone with no department, and an id that is no zone"` — a `floor_zones` row with
    no policy, and `randomUUID()` → neither key present.
  - `"answers an empty list with an empty map"`.
  - `"lists every active department's minutes"` — A 25, B null, C 5 with `active = 0` →
    `toEqual({ [A]: 25, [B]: null })`.
  - `"updateDepartment writes a reminder given alone"` — `updateDepartment(tx, cfg, A, { releaseReminderMinutes: 5 })`
    → the row reads 5 (fails while the write condition leaves the field out).
  In `routes.test.ts` (with `settingsFixture()` and `departmentSettings`):
  - `"saves a department's reminder and lists it in the model"` — PUT
    `{ ...departmentSettings, releaseReminderMinutes: 15 }` → 204, model
    `releaseReminderMinutesByDepartment[fx.departmentId]` 15; then `null` → null; then 120 → 120.
  - `"leaves the reminder as it was when the save does not name it"` — 15, then PUT
    `departmentSettings` alone → still 15.
  - `"refuses a reminder outside whole minutes 1 to 120 or null, naming it, and writes nothing"` —
    each of `0`, `-5`, `121`, `2.5`, `"10"`, `true`, `[10]`: 400,
    `toEqual({ error: { code: "management.request_invalid", params: { field: "releaseReminderMinutes" } } })`,
    `rawSettingsSnapshot()` unchanged.
  - `"changes only the department it saves"` — a second department made with `createDepartment`
    keeps 10 after the first is saved with 5.
  - `service.test.ts`: `"readReleaseReminderMinutesByZone"` joins the sorted key list.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/release-reminders.test.ts src/routes.test.ts src/service.test.ts`
  — FAIL (no module, no model field, no seat key).
- [ ] **Step 3: Add the column and generate.** Read the SQL: it must be the one
  ``ALTER TABLE `departments` ADD `release_reminder_minutes` integer DEFAULT 10;`` line and no
  `__new_departments`. Anything else is a stop.
- [ ] **Step 4: Implement** the two functions, the seat, the operations input and the route.
- [ ] **Step 5: Run Step 2's command** — PASS; read the `Tests` count.
- [ ] **Step 6: Guards.** The seven root suites and the two package runs of Decision 1, each
  `Tests` count read; `pnpm --filter @waitron/venue-service typecheck`,
  `pnpm --filter @waitron/module typecheck`, `pnpm exec prettier --check <changed files>`.
- [ ] **Step 7: Commit** `git commit -s -m "Each department stores its own reminder to fire the next course (A756 PR 4)"`, then update the ledger.

**Assertions changed:** `service.test.ts`'s key list gains one name (the PR adds the seat).

### Task 13: the server reads the reminder from the party's department

**Files:**
- Modify: `apps/server/src/parties.ts` (new `partyFirstZones`, beside `partyStateAndZone` `:211-227`)
- Modify: `apps/server/src/order-groups.ts:1535-1609` (`readReleaseReminders` and its doc comment),
  `:1956-1957` (`readCurrentOrders`)
- Modify (comments only): `apps/server/src/working-order.ts:8041-8044` ("with reminders off" →
  "with its department's reminders off"), `apps/till/src/api/client.ts:2067` ("the venue has
  reminders off" → "the party's department has reminders off")
- Create: `apps/server/src/testing/release-reminder.ts`
- Modify (setup only): `apps/server/src/current-orders.test.ts`, `line-service-operations.test.ts`,
  `line-service-projections.test.ts`, `line-service-removal.test.ts`, `table-signals.test.ts`
- Test: `apps/server/src/current-orders.test.ts` (new cases in "the reminder on the floor and in
  Current orders (D11)", `:507`), `apps/server/src/configuration-transfer.test.ts` (one case)

**Interfaces:**
- Consumes: `VENUE_SERVICE.readReleaseReminderMinutesByZone`, `departments` (Task 12).
- Produces: `partyFirstZones(tx: Transaction, partyIds: readonly string[]): Promise<Map<string, string>>`
  — each party's earliest active table's zone, ordered as `partyStateAndZone` orders
  (`joined_at`, then `rowid`), one select; a party at no active table absent; empty input, no query.
  In `order-groups.ts` a private
  `partyReminderMinutes(tx, partyIds): Promise<Map<string, number | null>>` = `partyFirstZones`
  then one seat call over the distinct zones; a party with no zone, or a zone absent from the seat's
  answer, reads null. `readReleaseReminders` uses it in place of the venue read (two statements for
  the whole floor instead of one); `readCurrentOrders` calls it with `[partyId]` only when the party
  is open.
- Produces (tests): `setReleaseReminderInEveryDepartment(tx: Transaction, minutes: number | null): Promise<void>`
  — `update departments set release_reminder_minutes = minutes`, returning ids; throws
  `new Error("setReleaseReminderInEveryDepartment: the database has no department yet")` when none
  (as `apps/server/src/testing/needs-clearing.ts` does).

- [ ] **Step 1: Write the failing tests** in `current-orders.test.ts`. Every party is built with
  `servedUpToGroupTwo(v)` at the venue's own table, so it can take its orders (a zone with no
  department takes none: `resolveZoneContext` throws `service_zone.not_found`,
  `packages/venue-service/src/operations.ts:559`). Only then is its table moved, by direct writes:
  `update dining_tables set zone_id = …`, or a `party_tables` row inserted. No real path builds
  these shapes (Decision 2); the tests say so in a comment. A second department and its zone come
  from `createDepartment` and `createServiceZone` (`@waitron/venue-service`); the venue's own
  department from `departmentOf` (`./testing/service-steps.js`):
  - `"follows each party's department: Off for one, 10 minutes for another"` — parties A and B each
    from `servedUpToGroupTwo`; B's table moved into department B's zone, B's minutes set to null by
    direct `update departments` → A's `floorReminder` and Current orders reminder due `T(15)`; B's
    both `toBeNull()`.
  - `"reads the department of the party's first table, and the next one's once the first is left"` —
    party A from `servedUpToGroupTwo` (department A, 10 → due `T(15)`); a table made in the venue's
    zone, moved into department B's zone (B at 5), and a `party_tables` row for it with a later
    `joined_at` → still `T(15)`; then `update party_tables set left_at = …` for the first table →
    `T(10)`.
  - `"shows no reminder for a party whose table's zone has no department"` — a party from
    `servedUpToGroupTwo`, then its table moved into a `floor_zones` row inserted with no
    `zone_service_policies` row, every department at 10 → `toBeNull()` on the floor and in Current
    orders.
  - `"asks venue-service once for the whole floor"` — `vi.spyOn(VENUE_SERVICE, "readReleaseReminderMinutesByZone")`
    over `listTablesWithState` with two seated parties: one call.
  In `configuration-transfer.test.ts`, modelled on `"carries a department's Needs clearing switch to the importing venue"`
  (`:2742-2779`): `"carries a department's reminder minutes to the importing venue"` — 25 at the
  source → 25 imported. It is a check that the column travels with no code (Decision 1), not a
  failing test: it passes as soon as Task 12's column exists.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/current-orders.test.ts src/configuration-transfer.test.ts -t "department|first table|once for the whole floor"`
  — the three department cases fail; the transfer check passes already.
- [ ] **Step 3: Implement** `partyFirstZones`, `partyReminderMinutes`, the two readers and the helper.
- [ ] **Step 4: Switch the setup of the five files.** Replace
  `writeReleaseReminderMinutes` in their `@waitron/venue-service` imports with
  `import { setReleaseReminderInEveryDepartment } from "./testing/release-reminder.js";` and each
  `writeReleaseReminderMinutes(` with `setReleaseReminderInEveryDepartment(`, arguments unchanged
  (measured, Decision 3: no call moves). Rename the two cases that now name the department:
  `current-orders.test.ts:638` → `"shows no reminder at all while its department has reminders off"`,
  `:647` → `"measures from its department's interval, and shows none for a party with no held group"`.
- [ ] **Step 5: Run every touched file and the other reminder suites** (check
  `memory_pressure | grep free` first):
  `pnpm --filter @waitron/server exec vitest run src/current-orders.test.ts src/configuration-transfer.test.ts src/draft-recall.test.ts src/line-service-operations.test.ts src/line-service-projections.test.ts src/line-service-removal.test.ts src/order-groups.test.ts src/party-main-bill.test.ts src/table-signals.test.ts src/till-api.groups.test.ts`
  — every file passes; read the count. `git grep -n writeReleaseReminderMinutes -- apps` prints nothing.
- [ ] **Step 6:** `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/till typecheck`,
  prettier; commit `git commit -s -m "A party's held group falls due by its own department's reminder (A756 PR 4)"`,
  then update the ledger.

**Assertions changed:** none. Setup changed in the five files; two test names reworded.

### Task 14: the venue-wide reminder goes from the server and the data

**Files:**
- Modify: `packages/venue-service/src/schema/settings.ts:23-26` (the column and its comment go)
- Regenerate: `packages/venue-service/drizzle/` (Step 2)
- Modify: `packages/venue-service/src/kitchen-notices.ts:364-381` (delete both functions),
  `src/service.ts:96,245`, `packages/module/src/module.ts:1449-1450` (the old seat goes),
  `src/routes.ts` (imports `:43`, `:48`; model field `:767`; settings GET field `:786`; the PUT
  route `:847-855`; `requireReleaseReminderMinutes` stays for the department save)
- Test: `packages/venue-service/src/kitchen-notices.test.ts`, `routes.test.ts`, `service.test.ts`

- [ ] **Step 1: Edit the tests first.** Delete `describe("the release-reminder setting")` in
  `kitchen-notices.test.ts` (from `:1625`) and in `routes.test.ts` (from `:2713`); in the
  print-moved-slips "leaves the other settings as they were" case (`routes.test.ts:2667-2686`)
  remove the `releaseReminderMinutes` type line and expectation; remove
  `"readReleaseReminderMinutes"` from the seat key list. Add to `routes.test.ts`
  `"no longer serves the venue-wide reminder"`: the model and `GET …/settings` bodies
  `not.toHaveProperty("releaseReminderMinutes")`; `PUT …/settings/release-reminder-minutes` answers 404.
- [ ] **Step 2: Drop the column and regenerate ONE migration for the PR.**
  `BASE=$(git merge-base HEAD origin/main) && git rm -r -q packages/venue-service/drizzle && git checkout $BASE -- packages/venue-service/drizzle && git clean -fd packages/venue-service/drizzle`,
  then Task 12's generate command. The new file must hold exactly Decision 1's two statements;
  anything else is a stop. (`git rm -r` first, or Task 12's committed files survive the checkout —
  A757 slice 1 Task 3's note.)
- [ ] **Step 3: Delete the old code** (functions, seat, route, the two GET fields, imports).
- [ ] **Step 4: Run.** `pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts src/routes.test.ts src/service.test.ts src/release-reminders.test.ts`
  — PASS. Then the guard runs of Task 12 Step 6, plus `pnpm exec vitest run scripts/module-seams.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/module`, `@waitron/server`; prettier;
  commit `git commit -s -m "The venue-wide reminder setting goes; one migration for the move (A756 PR 4)"`,
  then update the ledger.

**Assertions changed** (the column and route are removed): `kitchen-notices.test.ts` — the
`releaseReminderMinutes` key leaves the `serviceSettings` row `toEqual`s at `:1506`, `:1540`,
`:1582`, `:1619`, and its describe goes; `routes.test.ts` — the expectation at `:2684` and the
describe at `:2713` go; `service.test.ts` — one key leaves the list.

### Task 15: the Kitchen tab drops the reminder, and the model fixtures follow

**Files:**
- Modify: `packages/venue-service/src/dashboard/service-settings-panel.ts` (delete `REMINDER_MINUTES` `:11`,
  `#releaseReminder` `:176-216`, the `Field` member `:17` and the call at `:172`; Task 16b builds
  the dropdown again in the dialog)
- Modify: `packages/venue-service/src/dashboard/client.ts` (`VenueServiceModel`: replace
  `releaseReminderMinutes` `:106-108` with
  `releaseReminderMinutesByDepartment: Record<string, number | null>`; `VenueServiceSettingsView`
  loses `"releaseReminderMinutes"` `:123`; `loadSettings` loses `:305`; delete
  `saveReleaseReminderMinutes` `:428-431`)
- Modify (setup, one line each): every model fixture naming `releaseReminderMinutes` —
  `git grep -l releaseReminderMinutes -- packages/venue-service/src/dashboard packages/venue-service/src/testing packages/venue-service/test apps/dashboard/src`
  lists them (the department, departments-list, shell, navigation, loader and index suites,
  `testing/department-zones-fixture.ts`, `test/service-delete-test-helpers.ts`,
  `apps/dashboard/src/testing/department-receipt-app-fixture.ts`, `apps/dashboard/src/dashboard-app.test.ts`
  at `:1772`, `:4498`, `:4576`, `:8073`, `:8193`): `releaseReminderMinutes: X` →
  `releaseReminderMinutesByDepartment: {}`. Many are cast `as never`, so typecheck does not find a
  missed one; the grep does.
- Test: `service-settings-panel.test.ts`, `service-settings-panel.a11y.test.ts`,
  `service-settings-panel.exempt.test.ts`, `client.test.ts` (all in `packages/venue-service/src/dashboard/`)

- [ ] **Step 1: Edit the tests.**
  - Delete `describe("the setting for the reminder to fire the next group")`
    (`service-settings-panel.test.ts:617-771`). Its behaviours move to Task 16b, each named there:
    the stored value and default, a stored value the list does not offer, choosing the shown value
    (`:722`) or Off (`:734`) again saving nothing, the change staying inside its form (`:746`), and
    Spanish (`:756`). The refused-save and disabled-while-saving cases belong to the panel's
    save-at-once pattern, which the dialog does not use; the dialog's refusal case replaces them.
  - `"gives the two kitchen settings' dropdowns their hints"` (`:773-791`) keeps its grouping half
    and loses its reminder half (search, placeholder, value, hint "marked served", trigger text
    "Off"), which Task 16b adds at the dialog; rename it `"gives the grouping dropdown its hint"`.
  - The reminder half of the read-only case (`:54-73`); the a11y case
    `"release reminder setting accessibility (%s)"` (`a11y.test.ts:133`); the
    `releaseReminderMinutes` entry of `exempt.test.ts:126-130` and its API stub `:67-68`;
    `client.test.ts`'s `"stores the release reminder's minutes, or none for off"` (`:308`).
  - `client.test.ts`: the key leaves the read-only settings fixture at `:187`, which is also the
    case's expected value; at `:206` the model fixture takes `releaseReminderMinutesByDepartment: {}`;
    the key leaves the expected `loadSettings` answer at `:218`. The settings-view fixture at
    `service-settings-panel.test.ts:22` and the others the grep shows lose it.
  - `"shows the stored value after the held-groups switch and before the reminder"` (`:501-518`)
    becomes `"shows the stored value last, after the held-groups switch"`, expecting
    `printMovedSlips` to be the last field.
  - Add `"the Kitchen tab draws no reminder"` — no `wt-combobox[name="releaseReminderMinutes"]`.
- [ ] **Step 2: Run and watch the new case fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/service-settings-panel.test.ts src/dashboard/service-settings-panel.a11y.test.ts src/dashboard/service-settings-panel.exempt.test.ts src/dashboard/client.test.ts`
- [ ] **Step 3: Remove** the dropdown, the field, the client method; change the model type; sweep
  the fixtures. The department dialog reads nothing new yet.
- [ ] **Step 4: Run** Step 2's command, then `pnpm --filter @waitron/venue-service exec vitest run src/dashboard`
  and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts` (browser runs;
  check free memory first) — PASS. The grep of Review focus 4 shows no model fixture left.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/dashboard`; prettier; commit
  `git commit -s -m "The Kitchen tab no longer sets the reminder to fire the next course (A756 PR 4)"`,
  then update the ledger.

**Assertions changed** (A756 moves the setting off the Kitchen tab): the deleted and moved cases of
Step 1; the reminder half of `service-settings-panel.test.ts:773`; `client.test.ts:187` and `:218`
(the key leaves expected values); the field-order case, whose last field is now MOVED slips.

### Task 16a: the department save carries the reminder

**Files:**
- Modify: `packages/venue-service/src/dashboard/client.ts:44-53` (`DepartmentSettingsInput` gains
  `releaseReminderMinutes: number | null`)
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` — the draft only, no new
  markup: `fieldTab` `releaseReminderMinutes: "service"`; `equal`; the refusal field list; and
  `source` reading `this.model!.releaseReminderMinutesByDepartment[row.id] ?? null`, with the
  one-line comment "One model read lists the departments and keys every active one here, so the
  fallback only types the lookup."
- Modify (exact bodies): the department-save expectations that already carry `needsClearing`
  (`client.test.ts`, `department-edit-dialog.test.ts`, `department-settings.test.ts`,
  `department-settings.unsaved.test.ts`, `venue-departments-policy.test.ts`,
  `venue-departments-shell.actions.test.ts` — `git grep -n -E 'needsClearing: (false|true)'`)
  gain `releaseReminderMinutes: null`, the value a `{}` fixture gives
- Test: `packages/venue-service/src/dashboard/department-settings.test.ts`

**Interfaces — produces:** `DepartmentSettingsInput.releaseReminderMinutes: number | null`, always
sent; the draft field of the same name, which Task 16b's dropdown changes through
`this.changed("releaseReminderMinutes", …)`.

- [ ] **Step 1: Write the failing test** in `department-settings.test.ts`:
  `"saving a name change sends the stored minutes unchanged"` — model
  `releaseReminderMinutesByDepartment: { d1: 25 }`, edit the name, Save → the write's body
  `toMatchObject({ name: <new name>, releaseReminderMinutes: 25 })`.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-settings.test.ts -t "stored minutes"`
- [ ] **Step 3: Implement** the type and the draft field.
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard` (free
  memory first). The failures expected are the exact-body assertions listed above; add only
  `releaseReminderMinutes: null` to each. Any other red case is a stop. Then
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/dashboard`; prettier; commit
  `git commit -s -m "The department save carries its reminder to fire the next course (A756 PR 4)"`,
  then update the ledger.

**Assertions changed:** the exact-body expectations listed gain `releaseReminderMinutes: null`
(the PR adds the field to the department save); nothing else.

### Task 16b: the Service tab draws the reminder

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` (the section and dropdown
  of Decision 4 after "Orders and payment", built as the Kitchen tab's was — `REMINDER_MINUTES`,
  the stored-value rule, `search="auto"`, `placeholder` Off, the `hint` — with
  `error=${errors.releaseReminderMinutes ?? ""}`, `?disabled=${disabled}`, and a `wt-change`
  handler that stops the event and calls
  `this.changed("releaseReminderMinutes", value === "" ? null : Number(value))`)
- Modify: `packages/venue-service/src/dashboard/strings.ts` (`venue.courses_and_kitchen`; the new
  values of `venue.release_reminder`; EN and ES as Decision 4)
- Test: `department-settings.test.ts`, `department-settings.unsaved.test.ts`,
  `department-settings.a11y.test.ts`

- [ ] **Step 1: Write the failing tests** in `department-settings.test.ts`:
  - `"shows the reminder under Courses and the kitchen, between Orders and payment and Table states"` —
    the Service panel's `h3` texts in order `["Orders and payment", "Courses and the kitchen", "Table states"]`;
    `wt-combobox[name=releaseReminderMinutes]` labelled "Remind to fire the next course after",
    value `"10"` for `releaseReminderMinutesByDepartment: { d1: 10 }`.
  - `"gives the reminder dropdown its search, Off and its hint"` (moved from
    `service-settings-panel.test.ts:773`) — `{ d1: null }` → `[search, placeholder, value]`
    `toEqual(["auto", "Off", ""])`, `hint` contains "marked served", the `.trigger`'s text "Off".
  - `"offers Off and 5 to 30 minutes, and keeps a stored value the list does not offer"` — `{ d1: 7 }`
    → option values `["", "5", "7", "10", "15", "20", "30"]`, value `"7"`.
  - `"choosing 20 enables Save and saves it with the department"` — Save goes from disabled to
    primary; the write's body `toMatchObject({ releaseReminderMinutes: 20 })`; choosing Off sends `null`.
  - `"choosing the reminder already shown, or Off when Off is shown, leaves Save quiet"` (moved from
    `:722` and `:734`) — `clickChosenRow` on each; Save stays disabled and nothing is written.
  - `"keeps the reminder's change inside the dialog"` (moved from `:746`) — a `wt-change` listener
    on `document`, as that file's `changesHeardOutside` does, hears nothing when 5 is chosen.
  - `"a refusal naming the reminder, sent while Details shows, brings back Service and marks it"` —
    400 `management.request_invalid` `{ field: "releaseReminderMinutes" }` → tab `service`, marked,
    the combobox's `error` set and its `.trigger` carrying `aria-invalid="true"`, Save not disabled
    by the refusal alone.
  - `"follows a change another dashboard makes while the form is clean, and keeps a draft while it is not"`.
  - `"reads in Spanish"` (moved from `:756`, with the new label) — `Cursos y cocina`,
    `Avisar para marchar el siguiente curso tras`, options `Deshabilitado`, `5 minutos` … `30 minutos`.
  In `department-settings.unsaved.test.ts`: `"choosing a reminder dirties the form, choosing the stored one again cleans it, and leaving asks only while dirty"`.
  In `department-settings.a11y.test.ts`: axe on the Service tab with the section, light and dark,
  and with the reminder refused.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-settings.test.ts src/dashboard/department-settings.unsaved.test.ts src/dashboard/department-settings.a11y.test.ts`
- [ ] **Step 3: Implement** the section, the dropdown and the strings.
- [ ] **Step 4: Run** Step 2's command — PASS; then `pnpm --filter @waitron/venue-service exec vitest run src/dashboard`
  (free memory first) — PASS with no other case changed.
- [ ] **Step 5:** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`;
  typecheck `@waitron/venue-service`; prettier; commit
  `git commit -s -m "The department dialog's Service tab sets its reminder to fire the next course (A756 PR 4)"`,
  then update the ledger.

**Assertions changed:** none beyond Task 15's moves; the moved behaviours are checked here.

### Task 17: a look at the Service tab in real Chromium

**Files:** a throwaway test in `apps/dashboard/src/` (deleted, never committed); pictures and notes
outside the worktree, in `/Users/clintongormley/waitron-campaign-c/a756-4-shots/` and
`/Users/clintongormley/waitron-campaign-c/a756-4-look-report.md`, as A757 slice 1's Task 7 did.

- [ ] **Step 1:** Mount the whole dashboard with `mountReceiptApp`
  (`apps/dashboard/src/testing/department-receipt-app-fixture.ts`) at
  `path: "/manage/venue-operations/department/bar/view/service"`. The fixture's own model gives
  `releaseReminderMinutesByDepartment: {}` after Task 15, so give `bar` 10 minutes through its
  `respond` option (`:29`, consulted first at `:73`): for a GET of `/management-api/venue-service`,
  answer `Response.json(model)` with a copy of the fixture's model literal (`:43-70`) holding
  `releaseReminderMinutesByDepartment: { bar: 10 }`; answer `undefined` for every other request,
  so PUTs keep the fixture's 204. For light and dark and `page.viewport(1280, 900)` and
  `page.viewport(390, 900)`: a picture as opened (Save quiet), one with the list open, and one after
  choosing Off (Save primary). Read `window.innerWidth` inside the test and record it. Then Venue
  settings → Kitchen tab at 1280, light: no reminder dropdown.
- [ ] **Step 2:** Look at every picture against mock-up 03
  (`docs/backlog/mockups/a756-kitchen-settings/03-department-service-tab.png`, without its "Who
  sends a held course" buttons): the heading sits between "Orders and payment" and "Table states"
  at the same level; the dropdown and its hint fit at 390 with no sideways scroll
  (`document.documentElement.scrollWidth` equals the viewport width); the open list stays inside
  the dialog; dark is readable. A defect found is fixed with a failing test first, in the
  component's own test file, and committed.
- [ ] **Step 3:** Delete the throwaway test; `git status` shows it gone. Update the ledger with the
  look report's path and any defect found.

### Task 18: guides, design notes, the audit and the backlog

**Files:** `apps/server/src/guide/en/kitchen-service.md`, `apps/server/src/guide/es/kitchen-service.md`,
`docs/developers/design-system.md:5458-5461`,
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md:162,170`, `docs/backlog.md:1570-1572`,
`docs/backlog/kitchen.md:142-155`, `docs/backlog/dashboard.md:697-700`

- [ ] **Step 1: The guides.** At the end of "Request cooking from the till" (`{#request-cooking}`),
  EN: "A held group falls due a set number of minutes after the dishes fired before it have been
  served. Each department sets those minutes, or turns the reminder off, under **Courses and the
  kitchen** on its **Service** tab in the dashboard." ES: "Un grupo en espera vence unos minutos
  después de que se hayan servido los platos marchados antes que él. Cada departamento fija esos
  minutos, o desactiva el aviso, en **Cursos y cocina**, en su pestaña **Servicio** del panel."
  Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2: design-system.md.** "Service holds two sections … “Orders and payment”, … and
  “Table states”, …" → three sections, with "“Courses and the kitchen”, with the reminder to fire
  the next course," between them.
- [ ] **Step 3: The A664 audit** gets dated pointers only: `departments` R gains
  "`release_reminder_minutes` (added 2026-10-23, A756 PR 4)"; `service_settings` R's
  `release_reminder_minutes` gains "(dropped 2026-10-23, A756 PR 4)".
- [ ] **Step 4: The Decisions entry** "The two dropdown explanations on venue service's Kitchen
  panel stay as hints (owner, 2026-10-17)" (`docs/backlog/dashboard.md:697-700`) is kept whole and
  gains one dated line: "**2026-10-23 (A756 PR 4):** the reminder's dropdown, with its hint, moved
  to the department dialog's Service tab, under Courses and the kitchen; it is still a hint."
- [ ] **Step 5: The backlog.** In `docs/backlog/kitchen.md`'s A756 detail delete the PR 4 bullet
  (finished; PRs 5–8 and the Kitchen tab's removal stay as they are) and add an open point:
  "Offer “At once” (0 minutes) in each department's reminder, as A773 §3.4 decided (owner,
  2026-10-17); the list offers Off and 5–30 minutes and the save refuses 0
  (`requireReleaseReminderMinutes`, `packages/venue-service/src/routes.ts`)." In
  `docs/backlog.md`'s A756 entry say "Open points from #1852, #1854 and PR 4 are in the detail."
- [ ] **Step 6: Missed claims.**
  `git grep -n -i -E 'venue.?wide reminder|venue.s reminder|reminder (setting|minutes)|release reminder|reminder to fire' -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide`
  — each hit about this reminder is rewritten here, is the Decisions entry of Step 4, or is history
  in a dated plan or spec (left alone). `pnpm exec prettier --file-info <file>` on each changed doc
  (`docs/` is ignored whole), and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 7: The PR description and the ledger** both name:
  - **every changed test check**, from each task's "Assertions changed": Task 12's seat key list;
    Task 14's `kitchen-notices.test.ts` row `toEqual`s and deleted describes, `routes.test.ts:2684`
    and its describe, the seat key list; Task 15's deleted and moved panel cases, the reminder half
    of `service-settings-panel.test.ts:773`, `client.test.ts:187` and `:218`, the field-order case;
    Task 16a's exact request bodies gaining `releaseReminderMinutes: null`; and the test renames of
    Task 13 Step 4;
  - **the default and reset decision**: every department starts at 10 minutes, the venue's own
    value is dropped, not copied, and no venue reset is needed (Decision 1);
  - **the departures from mock-up 03**: "send" → "fire" in the field's label (A773's words), Off
    kept as a choice, no "Who sends a held course" buttons (A773 §7.2), and the Table states section
    beneath holding Needs clearing and Service steps as A757 drew it.
- [ ] **Step 8: Commit** `git commit -s -m "Guides and backlog: each department sets its reminder to fire the next course (A756 PR 4)"`,
  update the ledger to `Status: done` for PR 4's build, then `/finish-branch` with this plan's
  path as its note.

---

## Parts that wait

Each is planned when its blocker lands; these notes are the starting decisions, not tasks.

**PR 4 — Reminder to fire the next course, per department:** planned 2026-10-23, after A773-1 landed — see [PR 4](#pr-4--the-reminder-to-fire-the-next-course-per-department) above.

**PR 5 — Late flags on each station. Waits for A773-1:** `working-order.ts` imports the timing
helpers at :96-99, inside A773-1's `@@ -97,6` hunk, and 20 files that read or seed the timing tables
are A773-1-edited (`comm` of the two file lists: `kitchen.ts`, `working-order.ts`,
`order-groups.test.ts`, `working-order.test.ts`, `till-api*.test.ts`, `tabs.test.ts`,
`split-bill.test.ts`, `order-drafts.db.test.ts`, `packages/db/src/classification.ts`,
`packages/db/src/index.ts` among them). Shape: revive the retired, still NOT NULL columns
`kitchen_stations.warm_after_minutes`/`overdue_after_minutes`/`forgotten_after_minutes`
(`kitchen-stations.ts:18-21`, already ordered by `kitchen_stations_thresholds_ordered`) as each
station's own late flags, so `kitchen_stations` — referenced by tickets and routing — is never
rebuilt; DROP `kitchen_station_timing` and `kitchen_timing_defaults` (no migration SQL
`REFERENCES` either — `git grep` of `packages/*/drizzle/*.sql`, 2026-10-18). Remove them from the
classification list, configuration transfer (`packages/db/src/configuration-transfer.ts`,
`apps/server/src/configuration-transfer.ts`), provisioning (`packages/provisioning/src/venue-apply.ts`),
`packages/db/src/kitchen-timing-readiness.ts`, `table-signals.ts:57-68`, `working-order.ts`,
`packages/reporting/src/overdue-orders.ts`, `station-delete.ts`, the Kitchen tab's late-flags panel
and the station editor's blank-means-venue rule and note. Guards: the schema set listed under
Global Constraints plus `scripts/classification-complete.test.ts`,
`scripts/two-file-foreign-keys.test.ts`, `scripts/migration-upgrade.test.ts` (CANDIDATES lose the
two tables). Venue reset: decided by the upgrade walk.

**PR 6 — Identical dishes, held courses and MOVED slips on each station. Waits for A773-1:**
`kitchen-print.ts:531` is inside `@@ -529,13 planKitchenTickets`; A773-1 rewrites `printMovedSlips`
(`@@ -1385`, `@@ -1393`) and `printHoldTickets` (`@@ -1463`); the seats live in
`packages/module/src/module.ts` and `packages/venue-service/src/service.ts`, both A773-1-edited.
Shape: ADD to `kitchen_stations` `ticket_grouping` (label, default `combined`, refused outside the
two values at the route as `colour` is — a CHECK would rebuild the table) and `print_held_work`
(flag, NOT NULL default false), each an ALTER TABLE ADD as `0152`/`0154` were; keep
`print_moved_slips` nullable (making it NOT NULL rebuilds `kitchen_stations`) and read null as
Print; the station routes always write a boolean. Drop the three `service_settings` columns; the
grouping column's CHECK makes drizzle rebuild `service_settings` — harmless, nothing references it,
but read the SQL. Station editor fields per A773 picture 10; the "Venue setting" choice goes.

**PR 7 — Done on the screen on each station. Waits for A773-1:** the mode travels
`till-setup.ts:28,87` → `till-app.ts:8073` → `till-station-screen.ts:910` → `station-queue.ts:659`,
and the last three are A773-1 files. One `till-station-queue` draws several stations' tickets
(`till-station-screen.ts:905`, and again at `:1104`), so the queue must choose the mode per ticket by its station.
Shape: `kitchen_stations.bump_mode` (label, default `line`, route-validated); stop reading
`locations.bump_mode` and leave the column (its CHECK `locations_bump_mode_ck` means dropping it
rebuilds `locations`, which most tables reference — leave it for A760's migration squash).

**PR 8 — Changes after sending, three values, on each station. Waits for A773-1** (its Recall reads
`edit_sent_lines` as the interim, A773 §3.10) and is listed as "A756/A773-2" in A773-1's plan
coverage table. Check at pick-up that a dish is made at exactly one station (A9), so one station
answers whether it may be recalled.

**A773-2 owns** "Waits for the pass" (the station field, the stations-table column, the missing-pass
warning) and removing `locations.fire_control` with the Kitchen tab's Fire control buttons.

---

## Self-review notes

- Spec coverage: A756 point 1 → PR 2; point 2 → PRs 1, 3 (reminder → PR 4); point 3 → PRs 5–8 and
  A773-2; point 4 → whichever of PR 5/7/A773-2 is last. A773 §7.1 → PRs 5–7 and A773-2; §7.2 →
  A773-2 (PR 1 never draws Who fires); §7.3 → PR 2 hosts the column A773-1 builds; §7.4 → PR 8.
- No task changes a function A773-1 rewrites; PR 2's three A773-1 files are touched outside their hunks.
- Task sizes: Tasks 9 and 10 were split from one task so each stays well under ~100 implementer calls.
- PR 4 (2026-10-23): every file:line in its section was re-read on `b85119762`; the migration's
  SQL, the root guards and the server reminder suites were run in a scratch copy, not reasoned
  about. Tasks 12–18 (16 split into 16a and 16b) each stay one package or one layer, so each is well under ~100 implementer
  calls; Task 15's fixture sweep is one line per file.
