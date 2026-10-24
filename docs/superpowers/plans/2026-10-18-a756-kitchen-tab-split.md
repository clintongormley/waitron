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

## PR 5 — Late flags on each station

Planned 2026-10-23, after PR 4 landed (#2020). Branch `feat/a756-5-late-flags-per-station`,
worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a756-5-late-flags-per-station`,
cut from `main` at `d9252ac34`. Ledger for PR 5: `~/waitron-campaign-c/item-a756-ledger.md`, the
one PR 4 used (the `docs/handoffs/…` path under Global Constraints was PR 1's); every task ends by
updating it (done, changed test checks, next step).
**Review path: FULL** — a migration that drops two tables, a change to what the station routes
answer (read by venue-service's dashboard), and a new configuration format. Implementers are
dispatched as `subagent_type: "implementer"`.

**Goal.** The late flags (the minutes after which a dish shows as warm, overdue and forgotten) stop
being a venue-wide value that a station may override field by field, and become each station's own
three numbers, set in the station editor under "Late flags (minutes)" and required there. A new
station starts at 5, 10 and 15 minutes. The Kitchen tab loses its late-flags panel and keeps the
choice of how preparation is marked done. Every reader (the station queues, the pass, the floor's
timing band, the bill and party signals, and the manager's overdue report) reads the station's
own row. The two tables that held the venue value and the overrides are dropped.

**Files it touches.**
- shared: `packages/shared/src/timing.ts`, `src/index.ts` (one constant), `src/timing.test.ts`.
- db: `src/schema/kitchen-stations.ts` (comment), `src/schema/kitchen-timing.ts` and its test
  (deleted), `src/schema/index.ts`, `src/index.ts`, `src/classification.ts`,
  `src/configuration-transfer.ts`, `src/kitchen-timing-readiness.ts` and its test (deleted),
  `src/errors.ts`, a generated migration in `drizzle/`, `src/schema/kitchen-stations.test.ts`.
- provisioning: `src/kitchen-timing.ts`, `src/configuration-transfer.ts`, `src/venue-apply.ts`, and
  `src/kitchen-timing.test.ts`, `src/venue-apply.test.ts`, `src/configuration-transfer.boundaries.test.ts`,
  `test/configuration-bundle.ts`.
- reporting: `src/overdue-orders.ts`, `src/overdue-orders.test.ts`, `test/fixtures.ts`.
- server: `src/working-order.ts`, `src/table-signals.ts`, `src/kitchen.ts`, `src/kitchen-timing.ts`,
  `src/management-api.ts`, `src/station-delete.ts`, and the tests named in Tasks 19–23 and 26.
- venue-service dashboard: `station-editor.ts`, `prep-stations-screen.ts`, `routing-client.ts`,
  `station-delete-copy.ts`, `live-queries.ts`, `strings.ts`, and their tests and fixtures (Tasks 24a, 24b).
- dashboard app: `src/screens/kitchen-screen.ts`, `src/api/client.ts`, `src/api/live-queries.ts`,
  `src/i18n/strings.ts`, and their tests and stubs (Tasks 25a, 25b).
- docs: the guides `apps/server/src/guide/{en,es}/kitchen-service.md`,
  `docs/developers/design-system.md`, `docs/developers/conventions-data.md`, `docs/backlog.md`,
  `docs/backlog/kitchen.md`, the A664 audit and retention inventory, the A760 inventory, and the
  A797 design (one dated pointer each).

### PR 5 decisions (each with its receipt)

1. **Storage: the station's own retired columns come back into use; the two tables are dropped.**
   `kitchen_stations` still carries `warm_after_minutes`, `overdue_after_minutes` and
   `forgotten_after_minutes`, each `count(...).notNull()` with defaults 5, 10 and 15, ordered by the
   CHECK `kitchen_stations_thresholds_ordered` (`packages/db/src/schema/kitchen-stations.ts:18-21`,
   `:42-46`; the defaults and the CHECK are pinned by `kitchen-stations.test.ts:114`). Using them
   needs no schema change to `kitchen_stations`, which tickets, routing and most kitchen tables
   reference, so the table is never rebuilt. `kitchen_timing_defaults` and `kitchen_station_timing`
   (`packages/db/src/schema/kitchen-timing.ts:7-45`, both in core's migration set, created by
   `packages/db/drizzle/0102_kitchen_timing_inheritance.sql`) are dropped.
   **Measured 2026-10-23** in a scratch copy of this worktree (`cp -c -R` to
   a temporary directory, its `.git` pointer removed; deleted afterwards): with `kitchen-timing.ts` taken out of
   `src/schema/index.ts`, `packages/db/node_modules/.bin/drizzle-kit generate --name retire_kitchen_timing_tables`
   wrote `drizzle/0186_retire_kitchen_timing_tables.sql` holding exactly
   ``DROP TABLE `kitchen_station_timing`;`` and ``DROP TABLE `kitchen_timing_defaults`;`` — no
   `__new_` table, so nothing is rebuilt. With that file in place and the two `classify(...)` lines
   removed, `pnpm exec vitest run scripts/migration-upgrade.test.ts` passed (`Tests 4 passed (4)`)
   and reported `343 steps` and `229 tables hold rows after the last step`; the same run on this
   worktree unchanged reported `342 steps` and `231 tables`, the control that the walk did apply the
   new step and the two tables went. Then
   `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts`
   printed `Test Files 8 passed (8)`, `Tests 521 passed (521)`, and
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` `Tests 2 passed (2)`.
   Nothing points at either table:
   ``git grep -n -i -E 'references `(kitchen_station_timing|kitchen_timing_defaults)`' -- 'packages/*/drizzle/*.sql'``
   printed nothing (exit 1), where the same search for ``references `kitchen_stations` `` counts 40
   lines; no migration trigger names either (`git grep -n -i trigger -- 'packages/*/drizzle/*.sql' | grep -i -E 'station_timing|timing_defaults'`
   printed nothing). Neither is append-only (both are `classify(..., "state", ...)`,
   `packages/db/src/classification.ts:124-125`). The change feed puts triggers on both, but a box
   migrates with the feed taken off (`removeChangeFeed`'s comment,
   `packages/db/src/change-feed.ts:139-142`), and SQLite drops a table's own triggers with it:
   Node v26.11.1 `node:sqlite`, a table with a `waitron_change_*_update` trigger, then
   ``DROP TABLE``, printed `triggers before 1`, `triggers after 0` (an error or `1` would have been
   the failing case). **No venue reset**: the walk passed with rows in every table, and no shipped
   migration file is edited.

2. **What each existing station's flags become: whatever its own row already holds — 5, 10 and 15
   for every station made since 2026-10-06. The venue value and the overrides are dropped, not
   copied** (CLAUDE.md §3, "No backwards-compatibility or data-migration code until Waitron is in
   production"; PR 4 did the same with the venue-wide reminder, its Decision 1). Since
   `924a94b74` (#1269, 2026-10-06) no application code writes the three columns: `createStation`
   inserts only name, default flag and colour (`apps/server/src/kitchen.ts:100-108`),
   `updateStation` takes the minutes out of what it sets (`:191-194`), provisioning inserts
   `Cocina` without them (`packages/provisioning/src/venue-apply.ts:306-312`), and a configuration
   copy leaves them out (`omit`, `packages/db/src/configuration-transfer.ts:30`); `git log -S warmAfterMinutes --since=2026-10-05`
   over non-test server and package code lists five commits, and none of their diffs adds a write
   of the columns (`924a94b74` retired them; `4e318802f` moved the timing code to provisioning;
   `0f0a6fc0e`, `8f2af6f95` and `b34bfbe94` read them or take them out of what is set) — read, not run. **Measured
   2026-10-23**, Node v26.11.1 `node:sqlite`, every core migration up to 0185 then the probe's
   0186, applied by a throwaway script (since deleted) that ran each SQL file in journal order: a station `Bar` with a venue row of 4/9/14 and an
   override of warm 3 read 3/9/14 through today's `coalesce` and 5/10/15 from its own row; after
   0186 its row read 5/10/15 and neither table existed. A copy would have printed 3/9/14 after.
   **A new station starts at 5, 10 and 15** (A773 §7.1, "A new station starts with sensible
   defaults"): the column defaults, which are also today's venue defaults
   (`kitchen-timing.ts:11-13`, inserted bare at `venue-apply.ts:303`) and the Add dialog's starting
   values (`packages/venue-service/src/dashboard/prep-stations-screen.ts:158-160`, `:792-794`). One
   constant names them for code, `DEFAULT_STATION_THRESHOLDS` in `@waitron/shared`; the schema
   keeps its literals, and `apps/server/src/kitchen.test.ts`'s case "a station row given no
   minutes takes the schema's defaults, equal to DEFAULT_STATION_THRESHOLDS" inserts a bare
   `kitchen_stations` row and compares its three minutes with the constant (Task 20 fix round 1).
   That case catches a change to the constant or to the schema's `.default` (drizzle's insert sends
   the schema's default as a bound value for an omitted column, `drizzle-orm/sqlite-core/dialect.js:366-367`);
   `scripts/migrations-match-schema.test.ts` catches a `.default` committed without its migration
   (both measured in Task 28's review: `.default(5)` → `.default(6)` alone failed each); nothing
   checks the stored column default on its own.

3. **Validation: the three minutes are required on the station; a present value is a whole number
   1–2147483647; the order is checked against what the station already has.** Today
   `parseStationTimingPatch` accepts `null` as "follow the venue" and checks the range, and
   `assertStationTiming` checks the order of the overrides over the venue defaults
   (`packages/provisioning/src/kitchen-timing.ts:15-50`). After: `null`, like any value that is
   not a whole number in range, is refused `management.request_invalid` `{ field }` (today's code
   and params for a bad value); an order that fails is refused `station.thresholds_invalid`
   `{ field, stationId?, name }`, naming the later field of the pair, as `invalidTimingField` does
   today (`:75-84`). A POST checks what it sends over `DEFAULT_STATION_THRESHOLDS` (an absent field
   is stored at its default); a PATCH checks what it sends over the station's stored three, and
   writes nothing — name and printers included — when refused, as today. Both codes already name
   the field, and the station editor already puts either under that field
   (`stationRefusalField`, `packages/venue-service/src/dashboard/station-editor.ts:161-166`), so
   the forms rule (a refusal that names a shown field says so under it) holds with no new code.
   The CHECK orders the three but has no `warm >= 1` (`kitchen-stations.ts:42-46`, unlike the
   dropped venue table's `kitchen_timing_defaults_ordered`); adding it would rebuild
   `kitchen_stations`, so the station routes and the import refuse below 1, and the column comment
   says so (Task 26).

4. **The station routes' answer.** `GET /management-api/stations` already carries
   `warmAfterMinutes`, `overdueAfterMinutes` and `forgottenAfterMinutes`; they become the station's
   own values, and `timingDefaults` and `timingOverrides` leave the answer (`Station`,
   `apps/server/src/kitchen.ts:29-45`). Their only reader is venue-service's dashboard
   (`git grep -n -E 'timingOverrides|timingDefaults' -- apps packages` outside tests: `kitchen.ts`,
   `routing-client.ts:36-37`, `prep-stations-screen.ts:756-757`, `station-editor.ts`), which Task 24a
   moves. The same `Station` shape also reaches the till through `listStationsToday`
   (`apps/server/src/till-api.ts:2160`, `apps/server/src/device-api.ts:674`), so the two keys leave
   those answers too; no till code reads them (`git grep -n -E 'timingOverrides|timingDefaults' -- apps/till`
   prints nothing). Between Tasks 20 and 24a the old editor sends `null` for a cleared field and gets the
   refusal under it — acceptable inside one pull request; no commit is deployed alone.

5. **Configuration copies carry the station's three minutes and move to format 7.** The two tables
   leave `CORE_CONFIGURATION_TRANSFER` (`packages/db/src/configuration-transfer.ts:32-33`) and the
   `omit` of the three columns goes (`:30`). Precedent, followed exactly: "Retiring configuration
   tables also retires their export format" (`docs/developers/conventions-data.md:1605`) — A182
   part 2 (format 3), A725 (4), A757 slice 2 (5, `eb16d3805`) and A841 slice 2 (6, `a3e627167`,
   when it dropped `tenant_themes`). Without the bump a format-6 copy, which always carries both
   table keys, would be refused with the generic `tables` refusal
   (`packages/provisioning/src/configuration-transfer.ts:567-569`) instead of
   `setup.configuration_outdated`. Code sites: `:138`, `:172`, `:483`, `:486`; test sites
   `apps/server/src/configuration-import.test.ts:49`, `:154`, `apps/server/src/configuration-transfer.test.ts:401`,
   `:4524`, `packages/provisioning/test/configuration-bundle.ts:5`,
   `packages/provisioning/src/configuration-transfer.boundaries.test.ts:51`. The import's check of
   imported minutes keeps today's refusal, `station.thresholds_invalid` `{ field, name }`
   (`configuration-transfer.test.ts:4265-4310`), but runs **before** the rows are written, on the
   bundle's `kitchen_stations` rows: written first, an out-of-order row would be refused by the
   CHECK as a raw database error, and a warm of 0 would pass it. `apps/server/src/configuration-transfer.ts`
   names neither table (`git grep -n -i -E 'timing|warm_after' -- apps/server/src/configuration-transfer.ts`
   prints nothing); it is not touched. The format-1 fixture
   `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` (which names
   both tables) is left as it is, for the reason of A757 slice 1's Decision 9 and A841's Task 10: a
   format-1 copy is refused as outdated before any table is read.

6. **`scripts/migration-upgrade.test.ts` needs no change.** Neither table has a `CANDIDATES`,
   `ONE_ROW` or `RESETS` entry (`git grep -n -i -E 'timing_defaults|station_timing' -- scripts`
   prints nothing), so the owner's 2026-10-11 rule about removing an existing value does not come
   into play; the walk counts a table only while it still exists ("a table that still exists after
   it holding fewer rows fails", the file's header), and the probe of Decision 1 passed with the
   file untouched. Earlier drops did the same: `git log -S tenant_themes -- scripts/migration-upgrade.test.ts`
   lists nothing, and `eb16d3805`'s only edit there is a `RESETS` entry for its rebuild of
   `dining_tables`, which this drop does not have.

7. **Hand-kept table lists that name the tables** (`git grep -n -E 'kitchen_station_timing|kitchen_timing_defaults' -- '*.test.ts' 'apps/server/src/testing/*'`):
   `apps/server/src/testing/clear-provision-fixture.ts:49`, `:54` (tables emptied in order);
   `apps/server/src/management-api.station-disable.test.ts:126` and
   `apps/server/src/station-delete.test.ts:156` (snapshot lists); and
   `apps/server/src/canvas-retirement-upgrade.test.ts:499-519`, which applies every migration
   (`:478`) and whose `retained` copies every table
   the predecessor had — A841 added `delete retained.tenant_themes;` (`:519`) and A757 slice 2
   `delete retained.table_service_statuses;` (`:518`) for the same reason.
   `apps/server/src/station-order-migration.test.ts` names `kitchen_station_timing` at `:188` but
   migrates only up to `0167_retire_station_order` (`setsAsOf("retired", (when) => when <= retirement.when)`,
   `:68`; the predecessor `:70`), so both tables exist before and after its step and its list and
   expected `after` (`:221-226`) stay as they are; only its `@waitron/db` imports of the two tables
   (`:9-10`), used for the predecessor's inserts (`:102`, `:115`), become raw SQL in Task 26
   (the review's scratch run with 0186 present passed it unchanged).
   `packages/venue-service/src/kitchen-allergy.upgrade.test.ts` applies only venue-service's set
   and lists only venue-service sources (`:217`, `:207`), so a core drop does not reach it — read,
   not run; Task 26 runs it. `packages/db/src/schema/kitchen-timing-upgrade.test.ts` migrates only
   up to 0102 and imports nothing this PR removes (its imports, `:1-18`), so it stays and keeps
   checking that shipped migration — read, not run; Task 26 runs it.

8. **Station delete.** A deleted station keeps its row (`active = false`) and so its minutes;
   nothing is removed for them, so the delete impact's `station_timing` line goes
   (`apps/server/src/station-delete.ts:119-122`, `:149`, `:214`), with its dashboard copy
   (`station-delete-copy.ts:23`, `prep.delete_station_timing`) and live-query dependency (Task 24b).

9. **Error codes.** `station.timing_missing` (`packages/db/src/errors.ts:33`) loses both throw
   sites (`kitchen-timing-readiness.ts:16`, `provisioning/src/kitchen-timing.ts:99`) and is deleted:
   before a venue is live a code is deleted freely, every copy in one change (CLAUDE.md §3); its
   other copies are tests only (`git grep -n station.timing_missing -- apps packages scripts`).
   `station.thresholds_invalid` stays.

10. **The UI.** The station editor keeps A725's one short row of three fields under "Late flags
    (minutes)" (owner, 2026-10-15, `docs/backlog/kitchen.md:364`), each now `required`, opening on
    the station's own minutes, with no placeholder and no "Leave a field blank to use the venue
    setting" note (`prep.timing_inheritance`, EN and ES, deleted). A cleared field is invalid and
    gets today's message, `prep.threshold_invalid` ("Use whole minutes with warm < overdue <
    forgotten."), the one Add station already gives a blank field (`prep-stations-screen.ts:819-830`
    and `:800-805` read a blank as 0). Save still sends only what changed (`sendable`, `station-editor.ts:422-443`)
    and keeps the A331 rule it already follows (`draftScopeFor` `:354`, `saveActionState` `:454`).
    The Add dialog already starts at 5/10/15 with all three required (`prep-stations-screen.ts:1002-1010`);
    it reads them from the constant. **No new product text**; the only strings that change are
    deletions (the station editor's note and delete line; the Kitchen tab's ten `kitchen.timing_*`
    and `kitchen.station_*` keys, EN and ES). **Departure, for the PR description:** A773's picture 10
    (`docs/backlog/mockups/a773-courses-and-groups/10-station-settings.png`) draws late flags as one
    "Late after · 5 · 10 · 15 min" dropdown; this PR keeps the three fields the owner chose in A725
    and that are built, which is the most conservative reading. The Kitchen tab keeps the "Done on
    the screen" buttons (core panel) and venue-service's panel; it goes in whichever PR removes its
    last control (PR 7 or A773-2).

11. **Overlaps.** A930 (`docs/backlog/kitchen.md:233`) is the overdue report's `where`; Task 19
    changes only that query's selected columns and joins (`packages/reporting/src/overdue-orders.ts:53-69`),
    not its `where`, so A930 is untouched and stays open. A797's design plans its Ready warning
    minutes "beside the late flags' three" in the two tables this PR drops
    (`docs/superpowers/specs/2026-10-18-a797-device-screens-design.md:496-503`); Task 28 adds a
    dated pointer there saying the station's own row is where they now live.

### PR 5 review focus

1. **A PATCH naming one minutes field that would break the stored order** (station at 5/10/15,
   `{ name: "X", warmAfterMinutes: 12 }`): 400 `station.thresholds_invalid`
   `{ field: "overdueAfterMinutes", stationId, name }`, and neither the name nor the minutes change
   (Task 20).
2. **A POST naming one field**: `{ warmAfterMinutes: 3 }` stores 3/10/15; `{ warmAfterMinutes: 12 }`
   is refused on `overdueAfterMinutes` and no station is made (Task 20).
3. **`null` for a minutes field**, from any client: 400 `management.request_invalid` naming it;
   from the editor a cleared field never reaches the server (Tasks 20, 24).
4. **An imported station row with minutes out of order, below 1, not whole, or missing**: the
   first three refused `station.thresholds_invalid` `{ field, name }` with no venue row kept; a
   missing one stored at its default (Task 21).
5. **Another manager changes a station's minutes while the editor is open**: the editor keeps
   showing the values it opened with (it reloads only for another station, `station-editor.ts:333`),
   and Save sends only the fields this manager changed, so an untouched field is not overwritten.
   Not changed here; a reviewer confirms it and reports rather than fixes (Task 24a).

### Task 19: every kitchen reader takes the station's own minutes

**Files:**
- Modify: `apps/server/src/working-order.ts` — imports `:147-150`; `listStationQueues` (`:7503`:
  the check at `:7507`, the select `:7538-7540`, the joins `:7547-7551`); `readPassBoard` (`:7806`:
  `:7811`, `:7833-7835`, `:7853-7857`); `listTablesWithState` (`:8128`: `:8135`, the JSON object
  `:8198-8200`, the joins `:8216-8217`)
- Modify: `apps/server/src/table-signals.ts` (imports `:5-8`, `:44`, `:60-62`, `:69-73`)
- Modify: `packages/reporting/src/overdue-orders.ts` (imports `:4-7`, `:43`, `:53-55`, `:65-69`)
- Test: `apps/server/src/kitchen-timing-consumers.test.ts`, `packages/reporting/src/overdue-orders.test.ts`
- Modify (setup only): `apps/server/src/working-order.test.ts:6258-6263`

**Interfaces — produces:** no signature changes. Each reader takes `kitchenStations.warmAfterMinutes`
/ `overdueAfterMinutes` / `forgottenAfterMinutes` (raw SQL: `ks.warm_after_minutes` …) in place of
`coalesce(override, venue)`, and drops the left join on `kitchen_station_timing`, the inner join on
`kitchen_timing_defaults` and its `assertKitchenTimingPresent(tx)` call (that check existed only so
the inner join could not empty the kitchen, `kitchen-timing-readiness.ts:8`). The function itself
stays until Task 22.

- [ ] **Step 1: Write the failing tests.**
  - `kitchen-timing-consumers.test.ts`: the `it.each` at `:35-120` keeps its rows and every check
    and changes its setup only: instead of `setKitchenTimingDefaults` and `createStation(... thresholds)`,
    write 2/4/6 onto the default station's row and make Bar with `createStation` then write 3/5/7
    onto its row (`tx.update(kitchenStations).set({...}).where(eq(kitchenStations.id, …))`). Rename
    it `"classifies age %i by each station's own minutes, including an inactive station's work"`.
  - Replace `"reclassifies inherited fields on a default edit…"` (`:122`) and `"a venue edit
    reclassifies inherited live work…"` (`:163`) with one case,
    `"a change to a station's minutes reclassifies its live work in every reader"`: a Burger aged 6
    minutes at the default station reads `warm` on the station queue, the pass and the floor, and
    no overdue row; after writing 2/4/6 onto that station's row the same reads give `forgotten`,
    the bill's signal `{ kind: "long_wait", band: "forgotten" }`, and one overdue row.
  - Delete `describe("missing kitchen timing defaults")` (`:274-305`) and the imports it alone used
    (`kitchenTimingDefaults`, `getKitchenTimingDefaults`, `setKitchenTimingDefaults`).
  - `overdue-orders.test.ts`: `"reads the line's station's own minutes"` — write 2/4/6 onto
    `stationId`'s row, seed a fired order aged 5 minutes → one row, band `overdue` (at 5/10/15 it
    would be fresh and absent).
  - `working-order.test.ts:6258`: Barra's 2/4/6 are written onto its `kitchen_stations` row instead
    of a `kitchen_station_timing` row (setup; the checks at `:6281-6295` are unchanged), and its
    now-unused `kitchenStationTiming` import (`:23`) goes.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/kitchen-timing-consumers.test.ts src/working-order.test.ts -t "own minutes|reclassifies|own station thresholds"`
  and `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts -t "own minutes"`
  — FAIL: the readers still read 5/10/15 from the venue row.
- [ ] **Step 3: Implement** the five reader changes.
- [ ] **Step 4: Run** (check `memory_pressure | grep free` first)
  `pnpm --filter @waitron/server exec vitest run src/kitchen-timing-consumers.test.ts src/working-order.test.ts src/tables.test.ts src/table-signals.test.ts src/report-api.overdue-orders.test.ts src/station-queue-rest.test.ts src/till-api.fiscal-sale-paths.test.ts`
  and `pnpm --filter @waitron/reporting exec vitest run` — PASS; read each `Tests` count.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/reporting typecheck`,
  `pnpm exec prettier --check <changed files>`; commit
  `git commit -s -m "Kitchen screens, the floor and the overdue report read each station's own late flags (A756 PR 5)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1, "Every station setting is set on the station itself"): the two
venue-edit cases and the missing-defaults describe of `kitchen-timing-consumers.test.ts` are
deleted; nothing else. Setup changed in the `it.each` and in `working-order.test.ts:6258`.

### Task 20: a station's save writes its own minutes

**Files:**
- Modify: `packages/shared/src/timing.ts`, `src/index.ts:125`; Test: `src/timing.test.ts`
- Modify: `packages/provisioning/src/kitchen-timing.ts` (`:9-50`, and `assertKitchenTimingStations`
  `:103-124`); Test: `src/kitchen-timing.test.ts` (`:53`, `:73`)
- Modify: `apps/server/src/kitchen.ts` (`Station` `:29-45`, `createStation` `:79-122`,
  `listStations` `:124-157`, `updateStation` `:175-230`), `apps/server/src/management-api.ts`
  (PATCH body types `:1641-1650`: `number`, not `number | null`)
- Test: `apps/server/src/kitchen.test.ts`, `apps/server/src/management-api.test.ts`

**Interfaces — produces:**
- `export const DEFAULT_STATION_THRESHOLDS: Readonly<StationThresholds>` = 5 / 10 / 15
  (`@waitron/shared`), with the one-line comment "The kitchen_stations column defaults; a server
  test pins that the two agree."
- `export type StationTimingPatch = Partial<StationThresholds>;`
- `parseStationTimingPatch(body: Record<string, unknown>): StationTimingPatch` — a present field
  must be a whole number 1–2147483647; anything else, `null` included, `management.request_invalid { field }`.
- `assertStationTiming(patch: StationTimingPatch, base: StationThresholds, station: { id?: string; name: string }): void`
  — each field read as `patch[field] ?? base[field]` (never a plain spread, so a field present
  but `undefined` still reads the base); `station.thresholds_invalid { field, stationId?, name }`.
- `assertKitchenTimingStations` (still alive until Task 22, called by the venue PUT and the
  configuration import) builds each station's patch from its override row's **non-null** fields
  before calling `assertStationTiming`, so a null override still means "the venue value" there.
  Without this the narrower `StationTimingPatch` fails provisioning's type check: the review's run
  printed `src/kitchen-timing.ts(119,25): error TS2345 … 'number | null' is not assignable to
  'number | undefined'`.
- `createStation` checks over `DEFAULT_STATION_THRESHOLDS` and inserts all three
  (`thresholds?.[field] ?? DEFAULT_STATION_THRESHOLDS[field]` for each) in the station's own
  insert; no `kitchen_station_timing` row.
- `updateStation` reads the station's stored three with its name, checks the patch over them, and
  writes the minutes in the same `update kitchen_stations` as the other fields.
- `listStations` reads the three columns; `Station` loses `timingDefaults` and `timingOverrides`.
- `getKitchenTimingDefaults`, `setKitchenTimingDefaults`, `assertKitchenTimingStations` and the
  two routes stay, unread by station code, until Task 22.

- [ ] **Step 1: Write the failing tests.**
  - `timing.test.ts`: `"DEFAULT_STATION_THRESHOLDS is 5, 10 and 15"` (`toEqual`, so the constant is
    not mutated unseen; shared is a mutation-tested package).
  - `kitchen.test.ts`:
    - `"a station made with no minutes starts at the default late flags, on its own row"` —
      `createStation({ name })`; the row's three columns `toEqual(DEFAULT_STATION_THRESHOLDS)`, and
      `listStations` shows them.
    - `"createStation and updateStation write the station's own row, and an omitted field keeps its value"`
      — `createStation({ name, thresholds: { warmAfterMinutes: 3, overdueAfterMinutes: 8 } })` →
      row 3/8/15; `updateStation(id, { name: "Renamed", overdueAfterMinutes: 7 })` → 3/7/15 and the
      name.
    - `"a station's answer carries only its own minutes"` — the listed station
      `not.toHaveProperty("timingDefaults")` and `not.toHaveProperty("timingOverrides")`.
  - `management-api.test.ts`:
    - `"POST stores timing overrides atomically…"` (`:1244`) → `"POST stores the station's minutes on
      its row and refuses an unordered set without a row"`: the stored values are read from
      `kitchen_stations`; the two refusals are unchanged.
    - `"POST accepts partial and null overrides…"` (`:1296`) → `"POST stores an omitted minute at its
      default and refuses null naming the field"`: `{ warmAfterMinutes: 2 }` → 2/10/15;
      `{ warmAfterMinutes: null, overdueAfterMinutes: 8 }` → 400 `management.request_invalid`
      `{ field: "warmAfterMinutes" }`, no station made.
    - `"PATCH null inherits one field…"` (`:1319`) → `"PATCH refuses null for each minutes field
      and changes nothing"`: after 2/8/12, each of the three set to `null` alone → 400 naming it;
      the row still reads 2/8/12.
    - the `it.each` at `:1365`: `null` joins the refused values; the "nothing saved" check reads the
      row (still 5/10/15) instead of an empty `kitchen_station_timing`.
    - `"PATCH refuses inherited order inversions…"` (`:1397`) → `"PATCH refuses an order inversion
      against the stored minutes before saving name or minutes…"`: after 2/4 the body
      `{ name: "Should not save", warmAfterMinutes: 5 }` is refused `station.thresholds_invalid`
      `{ field: "overdueAfterMinutes", stationId, name }`; the row is unchanged; the unknown-id half
      is unchanged except that it reads no `kitchen_station_timing`.
    - `"PATCH saves independent thresholds…"` (`:1797`) and `"PATCH writes name, timings and printers
      together or not at all"` (`:2053`): the stored values are read from `kitchen_stations`; the
      second's expected rows become 5/10/15 after the refusal and 3/8/15 after the save.
    - `"venue late-flag defaults"` (`:2903`) is left for Task 22: its station case writes
      `kitchen_station_timing` directly and the venue PUT still reads it.
  - `provisioning/src/kitchen-timing.test.ts`: `:53` → `"retains omitted fields and refuses null"`;
    `:73` → `"names the station and the field an edit puts out of order over its stored minutes"`.
    Its venue cases (`:122`, `:150`, `:171`) stay and must still pass: they cover a station with
    no override row and one with a partial override through `assertKitchenTimingStations`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/shared exec vitest run src/timing.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run src/kitchen-timing.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts -t "station|POST|PATCH|minutes"`.
- [ ] **Step 3: Implement** the constant, the two helpers, the three station functions and the
  PATCH types. Delete, in `kitchen.test.ts`, the cases whose subject was the venue value:
  `"A725 timing refuses the alphabetically first invalid station override"` (`:118`, it inverts
  stations through a venue edit), `"new stations inherit venue defaults…"` (`:388`, replaced by the
  second new case) and `"lists raw timing overrides separately…"` (`:414`); in
  `"defaults isDefault to false…"` (`:245`) the expected `defaultThresholds` loses `timingDefaults`
  and `timingOverrides` (`:252-257`) and the `:321-327` block likewise.
- [ ] **Step 4: Run** Step 2's commands without `-t`, plus
  `pnpm --filter @waitron/server exec vitest run src/kitchen-timing-consumers.test.ts src/station-delete.test.ts src/configuration-transfer.test.ts`
  — PASS (the transfer suite still uses the tables; Task 21 changes it; it and the
  `"venue late-flag defaults"` describe of `management-api.test.ts` are what catch a plain-spread
  merge, which refuses a station with no override row).
- [ ] **Step 5:** typecheck `@waitron/shared`, `@waitron/provisioning`, `@waitron/server`;
  prettier; commit `git commit -s -m "A station's save writes its own late flags (A756 PR 5)"`, then
  update the ledger.

**Assertions changed** (A773 §7.1): the deleted and rewritten cases above. A station's minutes are
read from `kitchen_stations` rather than `kitchen_station_timing` wherever a case reads storage;
null is refused where it was "follow the venue"; the list answer loses two fields.

### Task 21: configuration copies carry the station's own minutes, at format 7

**Files:**
- Modify: `packages/db/src/configuration-transfer.ts:26-33` (drop the `omit` and the two entries)
- Modify: `packages/provisioning/src/configuration-transfer.ts` (`:17`; `:138`, `:172` → `7`;
  `:483` → `> 7`; `:486` → `!== 7`; the new check right after `const incoming = checkedRows(...)`
  at `:626`, reading `incoming`'s `kitchen_stations` rows as `stationColours` does (`:627-630`), so
  a bundle whose `kitchen_stations` is not a list still meets `checkedRows`' refusal first; delete
  the post-import check `:779-785`)
- Modify: `packages/provisioning/src/kitchen-timing.ts` (new function)
- Test: `apps/server/src/configuration-transfer.test.ts` (`:401`, `:2320`, `:4188`, `:4265`,
  `:4524`; its `kitchenStationTiming`/`kitchenTimingDefaults` imports `:68-69` go),
  `apps/server/src/configuration-import.test.ts` (`:49`, `:139-154`),
  `packages/provisioning/test/configuration-bundle.ts:5`,
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts:51`,
  `packages/provisioning/src/kitchen-timing.test.ts`

**Interfaces — produces:**
`assertImportedStationTimings(rows: readonly Record<string, unknown>[]): void` — for each bundle
`kitchen_stations` row, the three snake-case columns (an absent key read as its
`DEFAULT_STATION_THRESHOLDS` value), each a whole number 1–2147483647 and in order, else
`station.thresholds_invalid { field: <camelCase field>, name }`; rows checked in
`compareStationNames(a.name, b.name) || a.id.localeCompare(b.id)` order, as
`assertKitchenTimingStations` checks today (`kitchen-timing.ts:120`). No `stationId`: a bundle id
is the exporting venue's.

- [ ] **Step 1: Change the tests first.**
  - `configuration-import.test.ts`: `bundle.version` 7 (`:49`); `"future version"` `{ version: 8 }`;
    add `"A756 pre-late-flags export with the venue's late flags"`
    `{ version: 6, tables: { ...bundle.tables, kitchen_timing_defaults: [{ location_id: "loc", warm_after_minutes: 5, overdue_after_minutes: 10, forgotten_after_minutes: 15 }] } }`
    and `"A756 pre-late-flags export without them"` `{ version: 6 }`, both expecting
    `setup.configuration_outdated` through the existing `it.each`.
  - `configuration-transfer.test.ts:401` and `:4524` → 7; `configuration-bundle.ts:5` → 7;
    `boundaries.test.ts:51` → `{ version: 8 }`.
  - `"transfers effective kitchen defaults and nullable overrides without retired column values"`
    (`:4188`) → `"carries each station's own late flags to the importing venue"`: a station with
    6/12/16 on its row; the exported row carries `warm_after_minutes: 6`,
    `overdue_after_minutes: 12`, `forgotten_after_minutes: 16`; `transferred.tables`
    `not.toHaveProperty("kitchen_timing_defaults")` and `("kitchen_station_timing")`; the imported
    station reads 6/12/16.
  - `"refuses imported station timing warm=%i atomically"` (`:4265`): the station's 3 is written on
    its row; the bundle edit sets `kitchen_stations[i].warm_after_minutes`; the refusal check is
    unchanged; the last two checks become "no `kitchen_stations` row named 'Invalid imported timing'
    in the target". Add a separate case, `"refuses an imported minute that is not a whole number"`:
    `warm_after_minutes: 2.5` → `station.thresholds_invalid` `{ field: "warmAfterMinutes" }`.
  - `"A725 allocates omitted imported colours…"` (`:2320`): Desserts' warm 7 is written on its row
    and read back from the imported `kitchen_stations` row (setup and read path; same value).
  - `kitchen-timing.test.ts`: `"assertImportedStationTimings reads a missing minute as its default
    and names the first station out of order by name"`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts src/configuration-transfer.test.ts`
  and `pnpm --filter @waitron/provisioning exec vitest run` — FAIL: format-6 rows accepted, the
  format-7 bundle refused, the columns still omitted, warm 0 imported and warm 12 refused by the
  CHECK as a raw error.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2's commands — PASS. Then
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-command-import.test.ts` and
  `pnpm exec vitest run scripts/id-columns-are-references.test.ts scripts/module-seams.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/db`, `@waitron/provisioning`, `@waitron/server`; prettier;
  commit `git commit -s -m "Configuration copies carry each station's own late flags and move to format 7 (A756 PR 5)"`,
  the body saying a format-6 copy is now refused as outdated and why (Decision 5); update the ledger.

**Assertions changed** (A773 §7.1; the format rule of `conventions-data.md:1605`): the format pins
6 → 7 and the future-version rows 7 → 8; two new outdated rows; the transfer case of `:4188`
rewritten; `:4265`'s last two checks; `:2320` reads the imported row.

### Task 22: the venue-wide late flags leave the server

**Files:**
- Modify: `apps/server/src/management-api.ts` (delete the two routes `:1532-1550` and imports
  `:13-14`), `apps/server/src/kitchen-timing.ts` (re-export only `parseStationTimingPatch`,
  `assertStationTiming`, `type StationTimingPatch`)
- Modify: `packages/provisioning/src/kitchen-timing.ts` (delete `parseKitchenTimingDefaults`,
  `getKitchenTimingDefaults`, `assertKitchenTimingStations`, `setKitchenTimingDefaults`),
  `packages/provisioning/src/venue-apply.ts` (`:6`, `:303`)
- Delete: `packages/db/src/kitchen-timing-readiness.ts`, `kitchen-timing-readiness.test.ts`;
  modify `packages/db/src/index.ts:30`, `packages/db/src/errors.ts:33` (`station.timing_missing`)
- Modify: `apps/server/src/station-delete.ts` (`:14`, `:119-122`, `:149`, `:214`)
- Modify (comment): `apps/server/src/floor-today-api.test.ts:702` — delete the line; its claim
  ends with this task
- Test: `apps/server/src/management-api.test.ts` (`:2903-3000`), `apps/server/src/kitchen.test.ts`
  (`:442`), `packages/provisioning/src/kitchen-timing.test.ts` (`:122`, `:150`, `:171`),
  `packages/provisioning/src/venue-apply.test.ts:64-90`, `apps/server/src/station-delete.test.ts`
  (`:342`, `:357`, `:408`, `:656-659`)

- [ ] **Step 1: Write the failing tests.**
  - `management-api.test.ts`: replace `describe("venue late-flag defaults")` with
    `"no longer serves the venue's late flags"` — `GET` and `PUT /management-api/kitchen-timing-defaults`
    (a manager's cookie, a valid body) both answer 404.
  - `venue-apply.test.ts:64` → `"a new venue's first station starts at the default late flags and
    keeps a station's edit when the plan is retried"`: `Cocina`'s row reads 5/10/15; after
    `update kitchen_stations set warm_after_minutes = 3`, a retried `applyVenue` leaves 3; and
    `select count(*) from kitchen_timing_defaults` is 0.
  - `station-delete.test.ts`: `"keeps a deleted station's late flags on its row"` — a station at
    2/4/6, deleted → its row reads 2/4/6 with `active` false.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/station-delete.test.ts -t "late flags"`
  and `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts`.
- [ ] **Step 3: Implement** the deletions. In the tests: delete `kitchen.test.ts:442`
  (`"refuses missing venue defaults…"`) and its two imports; delete the three venue-default cases of
  `provisioning/src/kitchen-timing.test.ts`; in `station-delete.test.ts` remove the
  `kitchen_station_timing` insert at `:342`, the `station_timing` line of the expected impact at
  `:357`, `kitchenStationTiming` from the loop at `:408`, and the insert at `:656-659` (the
  rollback case keeps its check), and its `kitchenStationTiming` import (`:11`); in
  `management-api.test.ts` the `kitchenStationTiming` import (`:13`) goes with the describe. The
  snapshot list at `station-delete.test.ts:156` stays until Task 26.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/kitchen.test.ts src/station-delete.test.ts src/floor-today-api.test.ts src/kitchen-timing-consumers.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run`, `pnpm --filter @waitron/db exec vitest run src/schema`
  — PASS. Then `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts`;
  `git grep -n -E 'station\.timing_missing|assertKitchenTimingPresent|getKitchenTimingDefaults|setKitchenTimingDefaults|assertKitchenTimingStations|kitchen-timing-defaults' -- apps/server packages`
  prints only the new 404 case in `management-api.test.ts` (its `/kitchen-timing-defaults` path).
  On `d9252ac34` the same command lists 17 files, every one changed by Tasks 19–22; the
  dashboard is outside these paths (Task 25b), and the JSON fixture's underscored keys do not
  match the pattern.
- [ ] **Step 5:** typecheck `@waitron/db`, `@waitron/provisioning`, `@waitron/server`; prettier;
  commit `git commit -s -m "The venue-wide late flags leave the server (A756 PR 5)"`, then update the ledger.

**Assertions changed** (A773 §7.1, "no Every station card"): the venue-defaults describe and the
three provisioning cases and `kitchen.test.ts:442` deleted; `venue-apply.test.ts:64` rewritten
around the station; the delete impact loses `station_timing` (Decision 8).

### Task 23: test setup stops writing the venue's late flags

Setup only: after Task 22 nothing reads `kitchen_timing_defaults`, so each `insert(kitchenTimingDefaults)`
written for a test venue, and its import, goes. Mechanical; no check changes.

**Files** (each one insert line and one import name): `apps/server/src/course-retention.test.ts:74`,
`floor-annotations.test.ts:44`, `floor-today-seat-api.test.ts:270`, `kitchen.test.ts:66`,
`order-drafts.db.test.ts:122`, `:1771`, `order-groups.test.ts:165`, `print-problems.test.ts:109`,
`report-api.overdue-orders.test.ts:133`, `split-bill.test.ts:95`, `station-queue-rest.test.ts:38`,
`tables.test.ts:84`, `:417`, `tabs.test.ts:119`, `till-api.courses.test.ts:76`,
`till-api.parties.test.ts:61`, `till-api.split-bill.test.ts:82`, `till-api.status.test.ts:44`,
`till-api.tables.test.ts:68`, `till-api.test.ts:164`, `till-reroute-e2e.test.ts:159-162`,
`working-order-reads.sqlite.test.ts:54`, `working-order.test.ts:188`,
`apps/server/src/testing/split-extras-venue.ts:56`;
`packages/reporting/test/fixtures.ts:67`. Not here: `station-order-migration.test.ts:102` and
`:115`, which build a predecessor database and move to raw SQL in Task 26.

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2: Run** (free memory first) every touched server file in one
  `pnpm --filter @waitron/server exec vitest run <files>` and `pnpm --filter @waitron/reporting exec vitest run`
  — PASS, each file's count read; then
  `git grep -n -E 'kitchenTimingDefaults|kitchenStationTiming|kitchen_timing_defaults|kitchen_station_timing' -- apps packages ':!**/drizzle/**'`
  lists only these files: for Task 24b, `packages/venue-service/src/dashboard/live-queries.ts`
  (`:92`, `:120-121`) and its test (`:10-11`); for Task 25b, `apps/dashboard/src/api/live-queries.ts`
  (`:467`, `:491`), `apps/dashboard/src/api/live-queries.test.ts:1017`,
  `kitchen-screen.timing.test.ts` and `kitchen-screen.unsaved.test.ts`; for Task 26,
  `packages/db/src/schema/kitchen-timing.ts`, its test, `schema/kitchen-stations.ts` (the comment),
  `packages/db/src/index.ts`, `classification.ts`, `clear-provision-fixture.ts`,
  `management-api.station-disable.test.ts`, `station-delete.test.ts` (`:156`),
  `station-order-migration.test.ts` and `venue-apply.test.ts` (the count check); and, staying,
  `configuration-transfer.test.ts` and `configuration-import.test.ts` (Task 21's absent-key and
  outdated-format checks), `kitchen-timing-upgrade.test.ts` and the format-1 JSON fixture.
- [ ] **Step 3:** `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/reporting typecheck`;
  prettier; commit `git commit -s -m "Test venues stop writing the venue's late flags (A756 PR 5)"`,
  then update the ledger.

**Assertions changed:** none.

### Task 24a: the station editor sets the station's own minutes, all three required

**Files:**
- Modify: `packages/venue-service/src/dashboard/station-editor.ts` (`StationEditorStation` `:27-39`,
  `StationEditorSave` `:46-52`, `timingErrors` `:105-129`, `timingDraft` `:212-219`,
  `willUpdate` `:340-347`, `fieldErrors` `:408-413`, `sendable` `:437-441`, the fieldset `:577-603`)
- Modify: `routing-client.ts` (`PrepStation` `:24-38` loses `timingDefaults`/`timingOverrides`;
  `updateStation` `:119-131` takes `Partial<StationThresholds>`), `prep-stations-screen.ts`
  (`:756-757` pass the three numbers; `:158-160`, `:792-794` spread `DEFAULT_STATION_THRESHOLDS`),
  `strings.ts` (`prep.timing_inheritance` `:307`, `:1202` deleted)
- Test: `station-editor.test.ts`, `station-editor.a11y.test.ts`, `prep-stations-screen.test.ts`
- Modify (fixtures, setup): every station fixture naming `timingDefaults`/`timingOverrides` —
  `git grep -l -E 'timingOverrides|timingDefaults' -- packages/venue-service apps/dashboard` lists
  them (`prep-stations-screen.a11y.test.ts`, `prep-stations-screen.unsaved.test.ts`,
  `routing-grid.unsaved.test.ts`, `calendar-station-month.test.ts`, `station-editor.save-state.test.ts`,
  `station-editor.unsaved.test.ts`, `test/station-delete-test-helpers.ts`,
  `apps/dashboard/src/dashboard-app.unsaved-changes.test.ts:991-1000`): the two keys go, and an
  editor fixture gains its three numbers. Several are cast `as never`, so the grep, not typecheck,
  finds a missed one. The three editor fixtures that hold an override of overdue 5 over defaults
  3/10/15 — `station-editor.save-state.test.ts:23-28`, `station-editor.unsaved.test.ts:22-33`,
  `station-editor.a11y.test.ts:50-58` — become `warmAfterMinutes: 3, overdueAfterMinutes: 5,
  forgottenAfterMinutes: 15`, so `"05 over an override of 5 stays quiet"` (`save-state.test.ts:113`)
  and warm 4 (`unsaved.test.ts:194`) stay valid and unchanged. A station-list fixture holding
  5/10/15 with no overrides simply loses the two keys.

**Interfaces — produces:** `StationEditorStation = { …; } & StationThresholds` (the station's own
minutes); `StationEditorSave = { … } & Partial<StationThresholds>`; the draft's three strings start
as `String(station.warmAfterMinutes)` …; a blank or invalid field gets `prep.threshold_invalid`;
each `wt-input` carries `required`, no `placeholder`; the fieldset has its legend and no
`aria-describedby`.

- [ ] **Step 1: Write the failing tests** in `station-editor.test.ts` (fixture `GRILL` gets
  `warmAfterMinutes: 5, overdueAfterMinutes: 12, forgottenAfterMinutes: 15` in place of the two keys):
  - `"opens on the station's own minutes, each required, with no placeholder and no venue note"`
    — values `["5", "12", "15"]`, `required` true ×3, `placeholder` `""` ×3, labels unchanged,
    `$(el, "#timing-inheritance")` null (replaces `:341`).
  - `"a cleared minutes field is marked beside it and at the bottom and sends nothing"` — warm set
    to `""`, Save → warm's error "Use whole minutes with warm < overdue < forgotten.", the form
    message "Correct the highlighted fields to continue.", nothing sent, Save disabled and warm
    focused; typing 4 → `[{ warmAfterMinutes: 4 }]` (replaces `:360`'s null half).
  - `"sends a typed minute, and nothing for a minute typed back as its stored value"` — warm 3 →
    `[{ warmAfterMinutes: 3 }]`; on a fresh mount warm typed `"05"` → Save stays quiet (the
    `timingText` rule) (replaces `:360`'s other half).
  - `"holds the timings in order against the station's own minutes"` (rewrite of `:409` on `GRILL`:
    warm 12 → overdue marked; overdue 16 → forgotten marked).
  In `prep-stations-screen.test.ts`: `:823` → `"opens a station's own minutes in its editor and
  saves all three in one request"` (values 3/10/15 from the view, no placeholder checks).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-editor.test.ts src/dashboard/prep-stations-screen.test.ts`
- [ ] **Step 3: Implement**, then change the remaining cases: delete `:459` (`"follows a
  venue-default change while open…"`) and `prep-stations-screen.test.ts:873` (`"follows new venue
  defaults…"`); `:472` loses its note line; `:490` mounts `GRILL` with 5/10/15; `:699` selects the
  fieldset by its legend, expects values `["5", "12", "15"]` in place of placeholders, and loses its
  note line. Three more checks change:
  - `prep-stations-screen.test.ts:362` (the routing-handover look) expects Warm's placeholder
    `not.toBe("")`; it becomes Warm's value `not.toBe("")` and `required` true — the station's own
    minutes are shown in the field.
  - `station-editor.a11y.test.ts:150-156` checks the fieldset's `aria-describedby` is
    `timing-inheritance`, the note's text and the placeholder's contrast; after, it checks the
    fieldset has no `aria-describedby`, `#timing-inheritance` is absent and each field is
    `required`. The placeholder-contrast check goes with the placeholder, and so do the
    `contrastRatio` helper and its comment (`:8-21`), whose only use it is (`:156`). The per-field
    `aria-describedby` check (`:142-147`) stays.
  - (Task 25b names the Kitchen tab's.)
  Sweep the fixtures.
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard` (free
  memory first) and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.unsaved-changes.test.ts`
  — PASS; `git grep -n -E 'timingOverrides|timingDefaults|timing_inheritance' -- apps packages`
  prints nothing.
- [ ] **Step 5:** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts`;
  typecheck `@waitron/venue-service`, `@waitron/dashboard`; prettier; commit
  `git commit -s -m "The station editor sets the station's own late flags, all three required (A756 PR 5)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1, "Every station setting is set on the station itself"):
`station-editor.test.ts` `:341`, `:360`, `:409`, `:459` (deleted), `:472`, `:490`, `:699`;
`prep-stations-screen.test.ts` `:362`, `:823`, `:873` (deleted); `station-editor.a11y.test.ts:150-156`.
The editor fixtures' numbers are setup.

### Task 24b: the delete dialog and the live queries stop naming station timing

Depends only on Task 22 (the delete impact no longer lists `station_timing`, and nothing writes the
two tables).

**Files:** `packages/venue-service/src/dashboard/station-delete-copy.ts:23` and
`station-delete-copy.test.ts:71`; `station-delete-dialog.test.ts:37` (fixture);
`live-queries.ts` (`"station-delete-impact"` `:92` and `routing` `:120-121` lose the tables) and
`live-queries.test.ts:10-11`; `strings.ts` (`prep.delete_station_timing` `:355`, `:1250` deleted).

- [ ] **Step 1: Change the tests first:** `station-delete-copy.test.ts:71`'s key list and
  `live-queries.test.ts:10-11`'s expected `routing` list lose the names; the dialog fixture loses
  `counted("station_timing", 1)`.
- [ ] **Step 2: Run and watch the two list checks fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-delete-copy.test.ts src/dashboard/live-queries.test.ts src/dashboard/station-delete-dialog.test.ts`
- [ ] **Step 3: Implement**; run Step 2's command — PASS; then
  `pnpm exec vitest run scripts/live-subscriptions.test.ts`;
  `git grep -n -E 'delete_station_timing|"station_timing"|kitchen_station_timing|kitchen_timing_defaults' -- packages/venue-service`
  prints nothing.
- [ ] **Step 4:** typecheck `@waitron/venue-service`; prettier; commit
  `git commit -s -m "The station delete dialog and live queries stop naming station timing (A756 PR 5)"`,
  then update the ledger.

**Assertions changed** (Decision 8; the tables are dropped): the delete-copy key list and the
`routing` dependency list.

### Task 25a: Venue settings' leave-protection cases use the Venue details draft

`apps/dashboard/src/dashboard-app.venue-settings-unsaved.test.ts` uses the Kitchen tab's late-flags
form as its example draft: the mount helper waits for `[data-test=edit-timing]` (`:126-135`) and
seven cases edit it through `editTiming` (`:138-149`): `:151`, `:169`, `:187`, `:213`, `:260`
("ignores a repeated tab target…"), `:274` and `:367` ("keyboard tab navigation…") —
`grep -n editTiming` lists those seven calls. The behaviour they check is the Venue settings
container's (Keep, Discard, Back and Forward, sidebar, logout, language, forced expiry, a repeated
target, a reverted draft, keyboard tab navigation), and the Venue details tab holds a real draft the
same file already edits (`:284`, `:330`, `:341`). This task moves the seven onto that draft **while
the late-flags form still exists**, so the suite is green before and after.

- [ ] **Step 1:** Add a helper `editVenueDetails(app)` from the existing Venue details steps (Edit,
  then fill `addressLine1`, as `:287-292` do); the mount helper stops waiting for `edit-timing` and
  waits for the opened tab's panel (Venue details' `[data-test=edit]`, or the Kitchen tab's
  `[data-test=bump-line]`). Each of the seven cases keeps its name's behaviour and every check,
  with "Kitchen timing"/"late flags" in its name changed to "a Venue details draft" and the edited
  field the Venue details field. Because the draft now lives on Venue details, the first of the two
  tabs (`VENUE_SETTINGS_TABS`, `apps/dashboard/src/screens/venue-settings-screen.ts:11`), every
  case's direction swaps: it starts on Venue details and leaves to Kitchen (`:151`, `:187`, `:213`,
  `:260`, `:274`), Back and Forward run between the same two the other way (`:169`), and the
  keyboard case (`:367`) focuses the Venue details tab and presses `{End}` instead of `{Home}`.
  Each swap is a setup change. Where the Venue details panel ends differently after Discard (it
  returns to its read view, the behaviour `:341` checks, so the input is gone rather than reset),
  the check reads that view's stored value (`[data-test=saved-addressLine1]`, as `:310` does)
  instead of the input's; record each such check as
  changed, for the reason that the late flags leave the Kitchen tab (A773 §7.1).
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.venue-settings-unsaved.test.ts`
  (free memory first) — PASS. Delete the file's `getKitchenTimingDefaults` stub (`:50-54`) only in
  Task 25b.
- [ ] **Step 3:** prettier; commit
  `git commit -s -m "Venue settings' leave checks use the Venue details draft (A756 PR 5)"`, then update the ledger.

**Assertions changed:** only the after-Discard reads Step 1 names, if any; otherwise setup (which
draft is edited, the swapped directions, `{End}` for `{Home}`) and names only. Recorded in the
ledger and the PR description, with this task's reason.

### Task 25b: the Kitchen tab's late-flags panel goes

**Files:**
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts` (delete the timing state, methods,
  `#timingPanel`, its CSS `.timing*`, and the imports only it used; `#load` watches only the bump mode)
- Modify: `apps/dashboard/src/api/client.ts` (`KitchenTimingDefaults` `:727`;
  `getKitchenTimingDefaults`/`setKitchenTimingDefaults` `:3231-3237`),
  `apps/dashboard/src/api/live-queries.ts` (`getKitchenTimingDefaults` `:491`;
  `kitchen_station_timing` in `getStationDeleteImpact` `:467`), `apps/dashboard/src/i18n/strings.ts`
  (EN `:1267-1269`, `:1291-1297`; ES `:4489-4491`, `:4514-4520`)
- Delete: `kitchen-screen.timing.test.ts`, `kitchen-screen.timing.a11y.test.ts`,
  `kitchen-screen.save-state.test.ts` (every case is the late-flags form)
- Test: `kitchen-screen.test.ts`, `kitchen-screen.unsaved.test.ts`,
  `kitchen-screen.waiter-authority.test.ts`, `kitchen-screen.a11y.test.ts`,
  `apps/dashboard/src/api/client.test.ts:3000-3030`, `apps/dashboard/src/api/live-queries.test.ts:1017`
- Modify (stubs, setup): `dashboard-app.a11y.test.ts:360-365`, `dashboard-app.help.test.ts:75-80`,
  `dashboard-app.module-order.test.ts:60-65`, `dashboard-app.settings-panels.test.ts:110-115`,
  `dashboard-app.test.ts:140-145`, `dashboard-app.venue-settings-unsaved.test.ts:50-54`

- [ ] **Step 1: Change the tests first.**
  - `kitchen-screen.waiter-authority.test.ts:28`: wait for `[data-test=bump-line]` instead of
    timing values; requests `toEqual(["/management-api/bump-mode"])`; one `section`.
  - `kitchen-screen.test.ts:104` → `"says the read failed when the bump mode cannot be read"`
    (the timing-values check goes; the alert check stays); add `"draws no late flags"` — no
    `[data-test=timing-values]`, `[data-test=edit-timing]` or `wt-input`.
  - `kitchen-screen.test.ts:160` (`"starts its first section at its own top inside a grid…"`)
    reads `first.nextElementSibling` (`:167`), which is the late-flags section and would be null
    with one section left; it keeps only the first check (the section's top equals the host's top,
    `:166`) and drops the second-section check.
  - `kitchen-screen.unsaved.test.ts`: delete every timing case (`:91`, `:128`, `:141`, `:154`,
    `:177`, `:201`, `:219`, `:239`, `:261`, `:281`, `:304`, `:362`); keep both
    `"the immediate bump choice stays exempt…"` cases (`:334`), its mount helper losing the timing stubs.
  - `client.test.ts:3000-3030`: delete the late-flags client case. `live-queries.test.ts:1017`:
    the name leaves `stationDeleteReads`.
- [ ] **Step 2: Run and watch the new and changed cases fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.waiter-authority.test.ts`
- [ ] **Step 3: Implement**; remove the stubs listed.
- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens src/api src/dashboard-app.a11y.test.ts src/dashboard-app.help.test.ts src/dashboard-app.module-order.test.ts src/dashboard-app.settings-panels.test.ts src/dashboard-app.test.ts src/dashboard-app.venue-settings-unsaved.test.ts`
  (browser runs; free memory first) — PASS. `git grep -n -E 'KitchenTimingDefaults|kitchen-timing-defaults|kitchen\.timing_|kitchen\.station_(warm|overdue|forgotten)|edit-timing|timing-values' -- apps packages`
  prints nothing.
- [ ] **Step 5:** `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/style-token-names.test.ts`;
  typecheck `@waitron/dashboard`; prettier; commit
  `git commit -s -m "The Kitchen tab no longer sets late flags (A756 PR 5)"`, then update the ledger.

**Assertions changed** (A756/A773 §7.1, the late flags leave the Kitchen tab): the three deleted
files; the timing cases of `kitchen-screen.unsaved.test.ts`; `kitchen-screen.test.ts:104` and
`:160`;
`waiter-authority.test.ts:28`'s request list and section count; the client case; the dependency list.

### Task 26: drop the two tables; one migration

**Files:**
- Delete: `packages/db/src/schema/kitchen-timing.ts`, `packages/db/src/schema/kitchen-timing.test.ts`
- Modify: `packages/db/src/schema/index.ts:17`, `packages/db/src/index.ts:135`,
  `packages/db/src/classification.ts:124-125`, `packages/db/src/schema/kitchen-stations.ts:18`
  (the comment becomes: "The CHECK orders the three; the station routes and the import refuse a
  minute below 1, because adding that to the CHECK would rebuild this table.")
- Create (generated): `packages/db/drizzle/NNNN_retire_kitchen_timing_tables.sql`, its snapshot and
  journal entry, by `pnpm --filter @waitron/db db:generate --name retire_kitchen_timing_tables` —
  never numbered or edited by hand; on a number collision reset `packages/db/drizzle` to `main`
  (`git rm -r -q` then `git checkout <base> --` then `git clean -fd`, as PR 4's Task 14) and regenerate
- Modify (hand-kept lists, Decision 7): `apps/server/src/testing/clear-provision-fixture.ts:49`,
  `:54`; `apps/server/src/management-api.station-disable.test.ts:126`;
  `apps/server/src/station-delete.test.ts:156`; `apps/server/src/canvas-retirement-upgrade.test.ts`
  (after `:519` add `delete retained.kitchen_timing_defaults;` and `delete retained.kitchen_station_timing;`);
  `apps/server/src/station-order-migration.test.ts` (only the `:9-10` imports go, with `:102` and
  `:115` becoming raw `sql` inserts; its list at `:188` and expected `after` at `:221-226` stay,
  because it migrates only up to `0167_retire_station_order`, Decision 7);
  `packages/provisioning/src/venue-apply.test.ts` (Task 22's `count(*) from kitchen_timing_defaults`
  check goes: the table no longer exists, and the new case below covers its absence)
- Test: `packages/db/src/schema/kitchen-stations.test.ts`

- [ ] **Step 1: Write the failing test** in `kitchen-stations.test.ts`:
  `"the venue keeps no late flags apart from its stations"` — `select name from sqlite_master where
  name in ('kitchen_timing_defaults', 'kitchen_station_timing')` → `[]`.
- [ ] **Step 2: Run and watch it fail.** `pnpm --filter @waitron/db exec vitest run src/schema/kitchen-stations.test.ts`
- [ ] **Step 3: Delete, edit and generate.** Read the SQL: exactly Decision 1's two `DROP TABLE`
  lines and nothing else; anything else (a `__new_` table above all) is a stop. Re-run before
  generating: the `REFERENCES` and trigger searches of Decision 1 print nothing.
- [ ] **Step 4: Run.** Step 2's command — PASS. Then the guards, each `Tests` count read:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts scripts/live-subscriptions.test.ts scripts/errors-reachable.test.ts scripts/id-columns-are-references.test.ts`
  (the upgrade walk must report one step more than on `main` and two tables fewer, as Decision 1
  measured; if it fails on a value, adding a `CANDIDATES` value for a new column is allowed, but
  this task adds no column — any failure is a stop);
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`;
  `pnpm --filter @waitron/db exec vitest run src/schema src/classification.test.ts`;
  `pnpm --filter @waitron/db exec vitest run src/schema/kitchen-timing-upgrade.test.ts` (stays, Decision 7);
  `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts src/station-order-migration.test.ts src/station-delete.test.ts src/management-api.station-disable.test.ts src/configuration-transfer.test.ts src/kitchen-timing-consumers.test.ts`
  plus every server suite using `clear-provision-fixture.ts` (`git grep -l clear-provision-fixture -- apps/server/src`);
  `pnpm --filter @waitron/venue-service exec vitest run src/kitchen-allergy.upgrade.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run`;
  `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts`. Then
  `git grep -n -E 'kitchenTimingDefaults|kitchenStationTiming|kitchen_timing_defaults|kitchen_station_timing' -- apps packages scripts ':!**/drizzle/**'`
  prints only `station-order-migration.test.ts` (its raw predecessor inserts and its `:188`
  list), `canvas-retirement-upgrade.test.ts`'s two `delete` lines, Task 21's absent-key and
  outdated-format checks in `configuration-transfer.test.ts` and `configuration-import.test.ts`,
  `kitchen-timing-upgrade.test.ts` and the format-1 JSON fixture.
- [ ] **Step 5:** typecheck `@waitron/db`, `@waitron/server`, `@waitron/provisioning`,
  `@waitron/reporting`; prettier; commit
  `git commit -s -m "Drop the venue-wide and per-station late-flag tables; one migration (A756 PR 5)"`,
  then update the ledger.

**Assertions changed** (the tables are dropped, A773 §7.1): `kitchen-timing.test.ts` deleted;
`venue-apply.test.ts` loses Task 22's count check;
`canvas-retirement-upgrade.test.ts`'s `retained` loses the two tables (the precedent of
`:518-519`); the two snapshot lists lose the name. `station-order-migration.test.ts`'s checks do
not change (setup only: raw inserts for its predecessor).

### Task 27: a look at the station editor and the Kitchen tab in real Chromium

**Files:** throwaway tests in `packages/venue-service/src/dashboard/` and `apps/dashboard/src/screens/`
(deleted, never committed); pictures and notes outside the worktree, in
`/Users/clintongormley/waitron-campaign-c/a756-5-shots/` and
`/Users/clintongormley/waitron-campaign-c/a756-5-look-report.md`, as PR 4's Task 17 did.

- [ ] **Step 1:** Mount `prep-stations-screen` with the `api()` fixture of
  `prep-stations-screen.test.ts` (a view whose `bar` station holds 3/10/15). For light and dark, at
  `page.viewport(1280, 900)` and `page.viewport(390, 900)`: Edit on `bar` as opened (Save quiet);
  after clearing Warm and pressing Save (the field and the bottom line marked); Add station as
  opened (5/10/15). Read and record `window.innerWidth` inside the test. Then mount
  `dashboard-kitchen-screen` at 1280, light: the bump buttons and no late flags.
- [ ] **Step 2:** Look at every picture: the three minutes stay on one row at 390 and 1280 with
  their required marks and full labels, EN and ES (`setLocale("es")` once); no sideways scroll
  (`document.documentElement.scrollWidth` equals the viewport width); no stray gap where the note
  was; dark is readable. A defect found is fixed with a failing test first, in the component's own
  test file, and committed.
- [ ] **Step 3:** Delete the throwaway tests; `git status` shows them gone. Update the ledger with
  the look report's path and any defect found.

### Task 28: guides, design notes, audits and the backlog

**Files:** `apps/server/src/guide/en/kitchen-service.md:95-97`, `apps/server/src/guide/es/kitchen-service.md:108-110`,
`docs/developers/design-system.md` (`:2767`, `:4435`, `:4594-4605`, `:5284`),
`docs/developers/conventions-data.md:1622-1626`, `docs/backlog/kitchen.md` (`:149`, `:364-365`,
`:369-371`, Open points), `docs/backlog.md:1570-1572`,
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md:70-71`,
`docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md` (after `:261`),
`docs/operations/a760-migration-squash-inventory.md` (after `:380`),
`docs/superpowers/specs/2026-10-18-a797-device-screens-design.md` (after `:503`)

- [ ] **Step 1: The guides.** EN `:95-97` becomes: "You choose when to request cooking from the
  till. In **Venue settings**, the **Kitchen** tab lets you choose whether to mark preparation ready
  by line or by whole ticket; you no longer choose a venue-wide firing mode there. Each prep station
  sets its own late flags, under **Late flags (minutes)** when you edit it in **Prep stations**."
  ES `:108-110`: "Tú decides cuándo pedir la preparación desde el terminal. En **Configuración del
  local**, la pestaña **Cocina** permite elegir si se marca como listo cada plato o la comanda
  completa; ya no se elige allí un modo de marcha para todo el local. Cada estación de preparación
  fija sus propios avisos de demora, en **Avisos de demora (minutos)** al editarla en **Estaciones
  de preparación**." (The station editor's words: `prep.late_flags`, `prep.title`,
  `packages/venue-service/src/dashboard/strings.ts:306`, `:1201`, `:238`, `:1131`.) Run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2: design-system.md.** `:2767`'s "the kitchen's late flags" gains "(retired by A756 PR
  5, 2026-10-23)", as the service-status rows' note above it reads; `:4435` "with one inheritance
  hint" goes; `:4594-4605`: the note sentence and "A minutes field left blank follows the venue's
  Kitchen default … follows the default again" are replaced by "Each minutes field is required and
  opens on the station's own value; a blank one is marked like any other invalid value." and
  "counting a blank field as its default" goes; `:5284` "format 6" → "format 7".
- [ ] **Step 3: conventions-data.md:1622-1626** gains "and A756 PR 5 (format 7, 2026-10-23, when it
  dropped `kitchen_timing_defaults` and `kitchen_station_timing` and the station's own minutes
  joined the copy)" and pins format 7.
- [ ] **Step 4: Audits and inventories, dated pointers only.** The personal-data audit's two rows
  (`:70-71`) gain "(table dropped 2026-10-23, A756 PR 5)" in their name cells, as `:102` does. The
  retention inventory gains, after `:261`: "**2026-10-23:** `kitchen_timing_defaults` and
  `kitchen_station_timing` were dropped (A756 PR 5, core migration NNNN); this removes
  `kitchen_timing_defaults(location_id)` from `locations`' incoming closure and
  `kitchen_station_timing(station_id)` from `kitchen_stations`'." The A760 inventory gains after
  `:380`: "**2026-10-23 (A756 PR 5):** `kitchen_timing_defaults` and `kitchen_station_timing` were
  dropped by core NNNN; a squash leaves them out." The A797 design gains after `:503`:
  "**2026-10-23 (A756 PR 5):** the two late-flag tables named above were dropped; each station's
  late flags are its own `kitchen_stations` columns, so a Ready warning time would be a further
  station column." (NNNN is Task 26's generated number.)
- [ ] **Step 5: The backlog.** In `docs/backlog/kitchen.md`'s A756 detail delete the PR 5 bullet
  (`:149`; PRs 6–8 and the Kitchen tab's removal stay). The A725 entry's
  "followed by one instruction to leave a field blank to use the venue setting" (`:364-365`) is
  kept and gains "**2026-10-23 (A756 PR 5):** the minutes are the station's own and required; the
  instruction is gone." `:369-371` gains "**2026-10-23:** A756 PR 5 moved it to version 7." Add
  open points: "From PR 5: Add station draws its three minutes as full-width fields, the Edit window
  as one short row under Late flags (minutes) (`prep-stations-screen.ts` `#dialog`, `station-editor.ts`);
  unchanged by PR 5." and "From PR 5: A773's picture 10 draws late flags as one 'Late after · 5 ·
  10 · 15 min' dropdown; PR 5 kept A725's three fields (owner, 2026-10-15). Ask the owner whether
  picture 10 replaces them." In `docs/backlog.md`'s A756 entry say "PRs 1–4 landed (#1852, #1854,
  #1858, #2020); PR 5 is in review; PRs 6–8 are buildable. Open points are in the detail." (the
  number is filled in after landing, as `0c7f997fa` did for PR 4).
- [ ] **Step 6: Missed claims.**
  `git grep -n -i -E 'venue.?wide late|default late flags|late.flag defaults|blank to use the venue|timing_defaults|station_timing|avisos de retraso predeterminados' -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide README.md 'packages/*/README.md'`
  — each hit is rewritten here, is a dated pointer of Step 4 or 5, or is history in a dated plan or
  spec (left alone). `pnpm exec prettier --file-info <file>` on each changed doc (`docs/` is ignored
  whole), and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 7: The PR description and the ledger** both name:
  - **every changed test check**, from each task's "Assertions changed", and Task 25a's setup move;
  - **the default and reset decision**: every station keeps what its own row holds (5/10/15 for any
    station made since 2026-10-06), the venue value and the overrides are dropped, not copied, and
    no venue reset is needed (Decisions 1 and 2);
  - **the format change**: a format-6 configuration copy is refused as outdated (Decision 5);
  - **the departure from A773's picture 10** (Decision 10).
- [ ] **Step 8: Commit** `git commit -s -m "Guides and backlog: each station sets its own late flags (A756 PR 5)"`,
  update the ledger to `Status: done` for PR 5's build, then `/finish-branch` with this plan's path
  as its note.

---

## PR 6 — Identical dishes, held courses and MOVED slips on each station

Planned 2026-10-23, after PR 5 landed (#2023). Branch `feat/a756-6-station-printing-choices`,
worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a756-6-station-printing-choices`,
cut from `main` at `157f152c5`. Ledger for PR 6: `~/waitron-campaign-c/item-a756-ledger.md`, the
one PRs 4 and 5 used; every task ends by updating it (done, changed test checks, next step).
**Review path: FULL** — two migrations (one rebuilds `service_settings`), a new core table that
decides which kitchen printers get held-work paper, a change to what the station routes answer
(read by venue-service's dashboard and the till), and the removal of a module seat
(`packages/module/src/module.ts`, a cross-package contract). Implementers are dispatched as
`subagent_type: "implementer"`.

**Goal.** How identical dishes print on a ticket ("One line: 3 x Burger" or "A line each"),
whether held groups print in advance on a ticket marked HOLD, and whether MOVED slips print stop
being venue-wide settings on the Kitchen tab and become each prep station's own three choices,
set in the station editor. A new station starts with today's venue defaults: one line, held
groups not printed in advance, MOVED slips printed. A station whose MOVED slips choice was "Venue
setting" now simply prints them. Held-work paper becomes exact per station: a station gets a HOLD
ticket only when it prints held groups in advance, and every later piece of paper about that held
work (a HOLD correction, the HOLD part of a MOVED slip or a reprint, the FIRE banner) prints only at
the stations that had the HOLD ticket, whatever their choice is later; a station that did not prints
its part at the fire. Kitchen-screen notices do not change. The Kitchen tab's venue-service panel keeps only "Changes
after sending" (PR 8 moves it). The three `service_settings` columns are dropped.

**Files it touches.**
- shared: `packages/shared/src/ticket-grouping.ts` (new) and its test, `src/index.ts`.
- db: `src/schema/kitchen-stations.ts`, `src/schema/order-group-hold-stations.ts` (new),
  `src/schema/index.ts`, `src/classification.ts`, `src/configuration-transfer.ts`, a generated
  core migration in `drizzle/`, `src/schema/kitchen-stations.test.ts`,
  `src/schema/order-group-hold-stations.test.ts` (new).
- server: `src/kitchen.ts`, `src/management-api.ts`, `src/kitchen-print.ts`, `src/kitchen-ticket.ts`,
  `src/order-groups.ts`, `src/working-order.ts`, `src/station-move.ts`, `src/draft-recall.ts`,
  `src/testing/station-printing.ts` (new), and the tests named in Tasks 29–39.
- venue-service: `src/schema/settings.ts`, `src/kitchen-notices.ts`, `src/routes.ts`,
  `src/routing-types.ts`, `src/service.ts`, a generated migration in `drizzle/`, and the dashboard's
  `station-editor.ts`, `prep-stations-screen.ts`, `routing-client.ts`, `service-settings-panel.ts`,
  `client.ts`, `live-queries.ts`, `strings.ts`, with their tests and fixtures.
- module: `packages/module/src/module.ts` (three seat reads go).
- dashboard app: `src/testing/department-receipt-app-fixture.ts`, `src/dashboard-app.test.ts` (fixtures).
- docs: the guides `apps/server/src/guide/{en,es}/kitchen-service.md`,
  `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/kitchen.md`, the A664
  audit and retention inventory, and the A760 inventory (one dated pointer each).

### PR 6 decisions (each with its receipt)

1. **Storage: two columns added to `kitchen_stations`, one new core table, three
   `service_settings` columns dropped; two migrations, no venue reset.**
   `kitchen_stations` gains `ticket_grouping` (`label`, `.$type<TicketGrouping>()`, NOT NULL,
   default `'combined'`) and `print_held_work` (`flag`, NOT NULL, default false), as `0152` and
   `0154` added `colour` and `print_moved_slips`. `print_moved_slips` stays nullable
   (`packages/db/src/schema/kitchen-stations.ts:26`): making it NOT NULL would rebuild
   `kitchen_stations`, which 40 migration lines reference (PR 5's Decision 1 count). A new core
   table `order_group_hold_stations (group_id → order_groups, station_id → kitchen_stations,
   primary key both)` records which stations a held group's HOLD ticket was queued for (Decision 5).
   `service_settings` (venue-service's set) loses `kitchen_ticket_grouping`, `print_held_work` and
   `print_moved_slips` (`packages/venue-service/src/schema/settings.ts:18-22`) and the CHECK
   `service_settings_kitchen_ticket_grouping_ck` (`:26`).
   **Measured 2026-10-23** in a scratch copy of this worktree (`cp -c -R` to a temporary
   directory, its `.git` pointer removed; deleted afterwards), with those schema changes and the
   new table's `classify(...)` line:
   - `pnpm db:generate --name station_printing_choices` in `packages/db` wrote
     `drizzle/0187_station_printing_choices.sql` holding exactly a `CREATE TABLE
     order_group_hold_stations` (two `FOREIGN KEY … ON DELETE no action`, `PRIMARY KEY(group_id,
     station_id)`), ``ALTER TABLE `kitchen_stations` ADD `ticket_grouping` text DEFAULT 'combined' NOT NULL``
     and ``ALTER TABLE `kitchen_stations` ADD `print_held_work` integer DEFAULT false NOT NULL`` —
     no `__new_` table, so `kitchen_stations` is not rebuilt.
   - `pnpm db:generate --name retire_venue_printing_choices` in `packages/venue-service` wrote
     `drizzle/0068_retire_venue_printing_choices.sql`: a rebuild (`__new_service_settings` with
     `id`, `edit_sent_lines` and the singleton CHECK; `INSERT … SELECT "id", "edit_sent_lines"`;
     `DROP TABLE`; `RENAME`). It is a drop only, so the drizzle-kit trap of a rebuild that also adds
     a column (CLAUDE.md §3) does not apply: the `SELECT` names only columns the old table has.
     `service_settings` was rebuilt the same way once before, by shipped
     `packages/venue-service/drizzle/0006_kitchen_ticket_grouping_check.sql`. Nothing points at it:
     ``git grep -n -i 'references `service_settings`' -- 'packages/*/drizzle/*.sql'`` printed nothing
     (exit 1), and no migration trigger names it
     (`git grep -n -i trigger -- 'packages/*/drizzle/*.sql' | grep -i service_settings`, exit 1).
     Its change-feed triggers go with the old table and boot puts them back; the venue-service
     upgrade test below shows that.
   - `pnpm exec vitest run scripts/migration-upgrade.test.ts` passed (`Tests 4 passed (4)`) and
     reported `345 steps` and `230 tables hold rows after the last step`; the same run on the
     unchanged copy reported `343 steps` and `229 tables` — the control that the walk applied both
     new steps and filled the new table.
   - `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts`
     printed `Test Files 8 passed (8)`, `Tests 521 passed (521)`; with the new table's
     `classify(...)` line removed, `classification-complete.test.ts` failed with `core: created
     table "order_group_hold_stations" is not classified` (the control that the guards saw it).
     `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` printed `Tests 2 passed (2)`.
   - `pnpm exec vitest run scripts/apply-migrations-callers.test.ts scripts/append-only-migration-sets.test.ts scripts/id-columns-are-references.test.ts scripts/no-tenant-column.test.ts scripts/column-vocabulary.test.ts`
     `Tests 80 passed (80)`; `pnpm --filter @waitron/composition exec vitest run` `Tests 125 passed (125)`;
     the other upgrade suites — server `draft-line-place-upgrade`, `printer-pickup-upgrade`,
     `recovery-backup-preview.older`, `backup-verification-compatibility` (`Tests 109 passed`),
     db `drawer-refund-upgrade`, `kitchen-timing-upgrade` (`2 passed`), venue-service
     `department-receipts.upgrade`, `order-kitchen-notes.upgrade`, `party-allergy.upgrade`,
     `migrations` (`50 passed`), migrations `order-group-events-rebuild`, `apply-*`, `manifest`,
     `journal-hashes` (`25 passed`), root `menu-sections-upgrade`, `fiscal-allocation-migration`,
     `fiscal-certificate-migration` (`7 passed`), workforce `record-migration`,
     `attendance-response-migration` (`18 passed`) — all passed unchanged.
   - Five cases in four files failed, each for a reason Task 29 or Task 39 fixes (Decision 7):
     `canvas-retirement-upgrade.test.ts` (two cases), `station-order-migration.test.ts`,
     `packages/venue-service/src/kitchen-allergy.upgrade.test.ts`, and
     `packages/venue-service/src/schema/service.test.ts` "declares service_settings's keys, checks
     and indexes" (it pins the dropped CHECK). With Decision 7's edits the first three files passed
     (the fourth's pin is Task 39's one-line change, not re-run in the probe).
   **No venue reset**: the walk passed with rows in every table, and no shipped migration file is
   edited. Both numbers were free on `157f152c5`; a parked branch with core migrations
   (`feat/a739-payment-window`, Decision 11) may take 0187 first, and then Task 29 regenerates.

2. **What each existing station gets: the column defaults, not the venue's values.** Every
   station reads `ticket_grouping = 'combined'` and `print_held_work = false` after the ADD, and a
   station whose `print_moved_slips` is null (today "Venue setting") prints MOVED slips. The
   venue's three values are dropped, not copied (CLAUDE.md §3, "No backwards-compatibility or
   data-migration code until Waitron is in production"; PR 4's Decision 1 and PR 5's Decision 2 did
   the same). These are today's venue defaults (`settings.ts:18-22`: `combined`, `false`, `true`;
   the seat's fallbacks `kitchen-notices.ts:338`, `:354`, `:370` agree), so a venue that never
   changed the Kitchen tab sees no difference. A773 §7.1 asks only that "A new station starts with
   sensible defaults"; picture 10 draws one station (Bar) with "Print when sent" and "One line",
   which is that station's state in the story, not a default. **A new station starts at the same
   three values**: `createStation` writes `printMovedSlips: true` explicitly (the station routes
   always write a boolean) and leaves the other two to their column defaults; provisioning's first
   station (`packages/provisioning/src/venue-apply.ts:304`) and a configuration import that omits
   the column leave `print_moved_slips` null, which reads as Print. A group held before the upgrade
   and still held has `hold_printed_at` set but no `order_group_hold_stations` rows, so it is
   treated as having no HOLD paper (its fire prints an ordinary ticket). Pre-live, not carried over.

3. **Validation at the station routes.** PATCH `/management-api/stations/:id` accepts
   `ticketGrouping` (`"combined"` or `"separate"`, checked with `isTicketGrouping` from
   `@waitron/shared` as `colour` is with `isStationColour`, `apps/server/src/management-api.ts:352-357`),
   `printHeldWork` (a boolean) and `printMovedSlips` (a boolean). Anything else — `null` for
   `printMovedSlips` included — is refused `management.request_invalid { field }`, today's code
   for a bad station field (`:1639-1643` for `printMovedSlips`; the editor already puts a refusal
   that names a field under it, `stationRefusalField`, `station-editor.ts:150-170`). No CHECK on
   `ticket_grouping`: a CHECK would rebuild `kitchen_stations` (as for `colour`, whose column comment
   says so, `kitchen-stations.ts:27`); the routes and the import refuse an unknown value, and the
   column comment says so. POST `/management-api/stations` is unchanged (it accepts none of the
   station's printing choices today, `:1533-1542`, and the Add dialog sets none); `createStation`
   writes the defaults of Decision 2. A refused PATCH writes nothing, as today (`updateStation`
   validates before its one `update`, `apps/server/src/kitchen.ts:158-205`).

4. **The station's answer.** `Station` (`apps/server/src/kitchen.ts:29-43`) gains
   `ticketGrouping: TicketGrouping` and `printHeldWork: boolean`, and `printMovedSlips` becomes
   `boolean`, a stored null answered as `true`, so a null reads as Print. The null is mapped in
   two places, each reading the column for itself: `listStations` (`kitchen.ts:124-141`, Task 30)
   and the printing path's `readStations` (`kitchen-print.ts:350-366`, Task 33). Its readers:
   `GET /management-api/stations` (venue-service's dashboard, `routing-client.ts:24-38`) and
   `listStationsToday` (`kitchen.ts:143-156`), which reaches the till through `till-api.ts` and
   `device-api.ts` — no till code reads `printMovedSlips` (`git grep -n printMovedSlips -- apps/till`
   prints nothing), so the till only carries three more keys. The routing view's venue value
   (`RoutingView.printMovedSlips`, `packages/venue-service/src/routing-types.ts:108-112`, written at
   `routes.ts:703`, read only by `prep-stations-screen.ts:766`) goes, with the `routing` live
   query's `service_settings` dependency (`packages/venue-service/src/dashboard/live-queries.ts:154`),
   which the same commit added for it (`git blame` of both lines: `e8f935e57`).

5. **Held-work paper is per station, recorded when the HOLD ticket is queued; screen notices are
   not touched.** Today one stamp on the group says "the kitchen has a HOLD ticket for this group"
   (`order_groups.hold_printed_at`, set by `printHoldTickets` when any printer took a job,
   `apps/server/src/order-groups.ts:2001-2041`), and every later decision reads the stamp,
   deliberately not the setting: "The marker, not the setting: a group whose HOLD ticket was
   queued is fired by a FIRE slip" (`order-groups.ts:815`), and the Kitchen tab's hint promises "A
   group held before this is turned on prints when it is fired, as before. A group already printed
   marked HOLD is still fired marked FIRE after this is turned off" (`venue.print_held_work_hint`,
   `strings.ts:530-531`). With the choice per station, a group can be on paper at Kitchen and not
   at Bar, so the stamp alone would print Bar HOLD corrections, a FIRE banner and the HOLD part of
   MOVED slips and reprints for paper it never had; reading Bar's *current* choice instead would
   break the marker rule for a station switched off after printing. So the marker becomes per
   station: `order_group_hold_stations` holds `(group, station)` for each station a HOLD job
   carried (`KitchenJob.stationIds`, `kitchen-print.ts:693-698`). Its writers: `printHoldTickets`,
   and the held move (`station-move.ts`) and held join (Task 35b) under the rule below, all through
   `recordHeldPaper`. `hold_printed_at` keeps being set as today.
   **The stamp keeps choosing which items the kitchen is told about; the table only decides what
   prints.** The same functions record kitchen-screen notices and print slips from one item list:
   `enqueueHoldCorrections` (`kitchen-print.ts:933-951`), `enqueueStationMoved` (its reroute notice
   for every item, `:905-926`), the order-note correction (`:794-846`, its query `:822-826` feeding
   both), and the MOVED path, whose `readSentItems` (`:1170-1196`, from `readOnHoldTickets`
   `:1199-1222`) picks the `moved` notices. A station with a screen and no printer is never in the
   table (no HOLD job carries it), so filtering those item lists would drop notices it gets today.
   Every item selection stays on the stamp; the filter sits where paper is made. The rules:
   - **HOLD ticket:** `printHoldTickets` plans only the held items at stations whose
     `print_held_work` is on now; no such station, no ticket and no stamp — today's behaviour with
     the venue switch off.
   - **A recorded station gets every later piece of paper about the group, whatever its current
     choice** (the marker rule): HOLD CHANGED added and removed, HOLD CANCELLED, the held EXTRA
     CANCELLED, the HOLD part of a MOVED slip and of a reprint, a held dish moved in from another
     station (its HOLD ticket "from X", `station-move.ts:373-385`), and the FIRE banner.
   - **A station not recorded gets none of that paper; its part of the group prints at the fire,
     as an ordinary ticket** — whether it was off when the group was held or has been switched on
     since — except a dish moving or joining in under the rule below. This is the per-station form of the hint's "A group
     held before this is turned on prints when it is fired", and of `correctJoin`, which prints
     nothing for a group with no HOLD ticket (`order-groups.ts:2122-2123`). It also means a station
     never holds partial HOLD paper (a "+1" for a dish whose first one it never had on paper), and
     whether a station gets paper never depends on another station's.
   - **FIRE banner:** a fire ticket's route prints `*** FIRE ***` when one of its stations is
     recorded for the group; otherwise it is an ordinary ticket. A printer shared by a recorded and
     an unrecorded station got the HOLD ticket, so its joint ticket is marked FIRE.
   - **Where the filter sits:** `CorrectionItem` gains `holdGroupId?: string`, set only on held work
     corrected against a group's HOLD ticket; `printCorrectionSlips` (`kitchen-print.ts:1064`)
     prints such an item only at a station recorded for that group, after the notices are recorded
     and before its HOLD CHANGED allergy freeze (`:1075-1083`). The MOVED slip's HOLD part
     (`printMovedSlips`, `:1444-1500`) and a reprint's HOLD part (`readReprintParts`, `:1606-1643`)
     keep a held item only when its line's group and its station are recorded.
   - **A held dish moving or joining in (ruling of 2026-10-23,
     `.superpowers/sdd/2026-10-18-a756-kitchen-tab-split/ruling-34-fresh-station.md`):** when a held
     dish of a group with HOLD paper (stamp set, at least one recorded station) moves to, or joins
     at, a station not recorded for the group, that station gets today's paper (the move's HOLD
     ticket "from X"; the join's HOLD CHANGED added) and is recorded, but only when (a) its own
     `print_held_work` is on now and (b) it holds no other unfired, uncancelled ticket item of the
     group besides the arriving ones. Otherwise it gets nothing until the fire. With every station
     on this is today's venue switch "on"; (b) keeps paper complete.
   - **Unchanged:** every notice; the sent order number (`stampSentOrderNumber`,
     `working-order.ts:3809-3838`, "only those the kitchen has seen", which screens see too);
     `line-cancel.ts:210`, whose own branch runs only for a group with no paper at all and does not
     set `holdGroupId` (read, not run; Task 35c runs `line-cancel.test.ts`); and the allergy path,
     which keys on the frozen copy each HOLD recipient received (`kitchen-allergy.ts:357-359`,
     "Copy presence identifies the exact HOLD recipient"), copies being made only for stations a HOLD
     job, or a printed HOLD CHANGED added, reached (`kitchen-print.ts:541-549`, `:1075-1083`).
   Every reader of the group stamp is assigned: `git grep -n -E 'holdPrintedAt|hold_printed_at|printedHeldGroups' -- apps/server/src ':!*.test.ts'`
   on `157f152c5` lists `draft-recall.ts:267` (Task 35c sets `holdGroupId`), `kitchen-allergy.ts:309`,
   `:359` (unchanged), `kitchen-print.ts:825` (Task 35a sets `holdGroupId` on its held rows),
   `:1217` (`readOnHoldTickets`, unchanged; Task 35a filters its two printing consumers),
   `line-cancel.ts:210` (unchanged), `order-groups.ts:529`, `:812-816` (Task 34), `:1054`, `:2122`
   (Task 35b, through `HeldChange.groupId`), `:2037` (the writer, Task 34), `:2044-2060`
   (`printedHeldGroups` itself, unchanged), `station-move.ts:115`, `:300` (Task 35c),
   `working-order.ts:2969`, `:6030`, `:6143` (Task 35b), `:3053` (Task 35c), `:3833` (unchanged).

6. **Configuration copies: the new columns travel, the format stays 7.** `kitchen_stations` is
   exported whole (no `omit`, `packages/db/src/configuration-transfer.ts:24-29`), so both new
   columns travel with no transfer code; `order_group_hold_stations` is service state and is not
   declared. The import refuses a `ticket_grouping` outside the two values before any row is
   written, `setup.request_invalid { field: "kitchen_stations.ticket_grouping" }`, beside the
   colour check (`validateCoreConfiguration`, `:4-9`, which `validateConfigurationBundle` runs
   before `importConfigurationTables` writes, `packages/provisioning/src/configuration-transfer.ts:590-624`).
   The two flags follow the other station flags (`is_default`, `shows_rest_of_order`,
   `print_moved_slips`), which the import does not check today (read, not run). **No format bump:**
   the bump rule covers retired *tables*, whose key an older file always carries
   (`docs/developers/conventions-data.md:1605-1628`); this PR drops columns, as PR 4 did with
   `service_settings.release_reminder_minutes` and left the format at 6 (`git show 3180a350a -- packages/provisioning/src/configuration-transfer.ts`
   prints nothing: PR 4 did not touch the format). A file
   exported before PR 6 carries the older core and venue-service module versions and is refused
   `setup.request_invalid { field: "module:<name>" }` before any table is read
   (`packages/provisioning/src/configuration-transfer.ts:598-602`; the venue-service case is
   `apps/server/src/configuration-import.test.ts:892`) — read, not run for PR 6's numbers. The
   format-1 fixture `configuration-v1-before-printing-retirement.json:398-405` still names the venue
   columns and is left as it is (a format-1 file is refused before any table is read; A757 slice 1's
   Decision 9).

7. **Hand-kept lists and pins.**
   - `apps/server/src/canvas-retirement-upgrade.test.ts`: its `retained` list of tables newer than
     the predecessor gains `order_group_hold_stations: []` (`:500-516`, as `adjustment_refunds: []`),
     and the populated case's `predecessor(root, [...])` call (`:394`) gains
     `"_station_printing_choices"` beside `"_floor_plan_sets"` and `"_floor_reset_tables_taken_off"`:
     the fill calls today's `createStation` and `applyVenue`, whose drizzle inserts name every
     column (failed in the probe with `table kitchen_stations has no column named ticket_grouping`,
     from `kitchen.ts:94` and `venue-apply.ts:304`). Both edits measured: `Tests 5 passed (5)`.
   - `apps/server/src/station-order-migration.test.ts` migrates only up to `0167_retire_station_order`
     and fills the predecessor "in the predecessor's own columns" (its comment, `:90-91`), but calls
     `seedKitchenStation` (`:109`) and `createStation` (`:111-112`), which now name the new columns.
     They become raw inserts in the predecessor's columns (`id, location_id, name, is_default|colour,
     created_at`); and before the last check, `listStations` (`:229`, which now reads the new
     columns), the test applies the core set up to `_station_printing_choices` only
     (`setsAsOf("printing", (when) => when <= retirement.when || when === printing.when)`). Its
     snapshot check (`:221-226`) runs before that step and is unchanged. Measured: `Tests 1 passed (1)`.
     Migrating to every current migration instead failed in a workforce rebuild
     (`DROP TABLE staff_roles`, `FOREIGN KEY constraint failed`), so the narrower step is the one used.
   - `packages/venue-service/src/kitchen-allergy.upgrade.test.ts`: `laterColumnDrops`' entry for
     `waitron_change_service_settings_update` (`:247-250`) becomes the four columns in their
     original order, `' or new."kitchen_ticket_grouping" is not old."kitchen_ticket_grouping" or new."print_held_work" is not old."print_held_work" or new."release_reminder_minutes" is not old."release_reminder_minutes" or new."print_moved_slips" is not old."print_moved_slips"'`
     (order from `0005`, `0007`, `0010`, `0052`; the order I first tried failed). Measured:
     `Tests 1 passed (1)`.
   - `packages/venue-service/src/schema/service.test.ts:191-194` pins `service_settings`' checks;
     the grouping CHECK leaves it.
   - `scripts/schema-constraints.test.ts`' foreign-key list, kept in table-name order, gains the
     new table's two keys after `order_group_events`' rows and before `order_groups`' (`:216-220`), so the guard writes through
     them (CLAUDE.md §3: "a green migrate is no evidence a new key is sound"). The guard passed
     without them in the probe, so this adds coverage rather than fixing a failure.
   - `station-delete.test.ts:152-175` and `management-api.station-disable.test.ts:123-130` are
     whole-list pins of the tables a station delete or disable may touch; each gains
     `order_group_hold_stations`. Closing a station moves its dishes through `moveDishesToStation`
     (`station-closing.ts:77-87`), the held-move path of Decision 5. The table's writers are
     `printHoldTickets` and the held move and join under Decision 5's ruling; the pinned delete and
     disable cases record nothing, so the new entry is expected to read the same before and after
     (re-run in Task 34: unchanged) — it is there to catch a write a later change adds (a new table in a whole-list pin, every
     existing value unchanged).
   - Not changed: `apps/server/src/testing/clear-provision-fixture.ts` clears untraded fixtures and
     lists no `order_groups`.
   - Pins of the station answer (`kitchen.test.ts:212-256`, `:285`; `management-api.test.ts:1040-1060`
     types) gain `ticketGrouping` and `printHeldWork` with every existing value unchanged except
     `printMovedSlips: null` → `true` (Decision 4's spec sentence: "MOVED slips … Each station's own,
     no venue fallback", this plan's table).

8. **Test venues set the station, not the venue.** 23 server test files call the venue seat's
   writers: all 23 turn held printing on or off (`writePrintHeldWork`), 3 of them also set the venue
   grouping and 1 the venue MOVED slips (`git grep -l -E 'writePrintHeldWork\(|writeKitchenTicketGrouping\(|writePrintMovedSlips\(' -- 'apps/server/src/*.test.ts' | wc -l`
   printed 23 on `157f152c5`, and the same for `writePrintHeldWork\(` alone). The venue value applied to every station, so the equivalent setup writes every
   station's column. Task 32 adds `apps/server/src/testing/station-printing.ts` and moves every call
   to it **while the venue value still governs**, writing both, so the suite is green before and
   after each reader moves (the Task 25a pattern); Task 38 drops the venue half. A case that makes a
   station after the call sets that station too (a venue value covered later stations; a column
   does not) — a setup change, which the implementer finds by the case failing.

9. **The UI.** The station editor keeps A725's layout (owner, 2026-10-15) and adds, after "Print a
   slip when sent dishes move table":
   - "Identical dishes on a kitchen ticket": a `wt-combobox` (`name="ticketGrouping"`,
     `search="never"`) offering "One line: 3 x Burger" and "A line each: 1 x Burger, three times" —
     today's Kitchen-tab label, choices and hint "Applies to new kitchen tickets and to reprints."
     (`strings.ts:520-523`, ES `:1416-1420`), moved to `prep.ticket_grouping*` keys. The hint is kept
     as the combobox's `hint`, which `wt-combobox` hides visually and keeps for assistive technology
     (`.hint` is `visuallyHiddenStyles`, `packages/ui-core/src/field-styles.ts:153-155`; the input's
     `describedBy` names it, `packages/ui/src/components/wt-combobox.ts:1100`), as on the
     Kitchen tab today;
   - "Print held groups in advance": a `wt-switch` (`name="printHeldWork"`), today's label
     (`:529`, ES `:1426`), with one note beneath as the rest-of-order switch has (`station-editor.ts:594-604`):
     EN "Prints a held group at once, marked HOLD, and again marked FIRE when it is fired.", ES
     "Imprime un grupo en espera en el momento, marcado HOLD, y otra vez marcado FIRE al marcharlo."
     — the one new product text, shortened from today's hint, whose sentences about switching the
     venue value on and off no longer fit a station;
   - MOVED slips offers "Print" and "Don't print" only; "Venue setting: Print"/"Don't print" and the
     `venuePrintsMovedSlips` property go (`prep.moved_slips_venue_*`, EN `:304-305`, ES `:1195-1196`,
     deleted).
   Save sends only what changed, as today (`sendable`, `station-editor.ts:413-435`), and keeps the
   A331 rule it already follows (`draftScopeFor` `:345`, `saveActionState` `:445`, `:506`). Field
   primitives only. The fields go after MOVED slips so the existing check that MOVED slips comes
   "right after the rest-of-order switch" (`station-editor.test.ts:545-559`) stays true.
   **Add station** gains no field: it sets none of the station's printing choices today, and a new
   station starts at the defaults (Decision 2). **The Kitchen tab** keeps both panels: the core
   one (Done on the screen, Fire control) and venue-service's, now holding only "Changes after
   sending" (`service-settings-panel.ts:131-144`); the tab goes in whichever change removes its last
   control (PR 8 for this panel, PR 7 and A773-2 for the core one).
   **Departures from A773's picture 10, for the PR description:** the picture draws "Held courses ·
   Print when sent" as a dropdown; this PR uses the switch and wording the Kitchen tab already
   has, which are built, translated and seen by the owner, rather than new text. The picture lists
   Identical dishes and Held courses above MOVED slips; this PR puts them after it, keeping the
   built order the editor's tests pin. Both are the most conservative reading; Task 41 records them
   as open points.

10. **Error codes.** None added or removed: every refusal is `management.request_invalid` or
    `setup.request_invalid` with a `field`, both registered. The seat reads `readKitchenTicketGrouping`,
    `readPrintHeldWork` and `readPrintMovedSlips` (`packages/module/src/module.ts:1370-1371`,
    `:1445-1448`; `packages/venue-service/src/service.ts:93-95`, `:242-244`) and the three PUT
    routes (`routes.ts:804-843`) go; their only callers are `kitchen-print.ts:561`, `:1426`,
    `:1434`, `order-groups.ts:2012` and the Kitchen-tab panel (`git grep -n 'readPrintHeldWork\|readPrintMovedSlips\|readKitchenTicketGrouping' -- apps/server/src ':!*.test.ts'`
    prints exactly those four lines on `157f152c5`).

11. **Overlaps.** `feat/a696-startup-zone-validation` (parked) touches `module.ts` around
    `assertPeriodEndOffsets`, `management-api.ts:222`, `working-order.ts` (`:347`, `:6423-6537`) and
    `order-groups.test.ts` (`:3399`, `:3450`) — none of the hunks this plan edits; whichever lands
    second rebases. `feat/a739-payment-window` (parked) adds core migrations numbered `0184`–`0186`
    and two `classify(...)` blocks in `packages/db/src/classification.ts`; if it lands first, Task 29
    regenerates on its tip (Global Constraints). No other worktree's branch touches a file in
    Decision 7 or Tasks 29–39 (`git diff --name-only $(git merge-base main <branch>) <branch>` over
    each branch of `git worktree list`, 2026-10-23).

### PR 6 review focus

1. **A station switched off after its HOLD ticket printed** (Kitchen prints held work, a group is
   held, Kitchen is then switched off): removing a held dish still prints HOLD CHANGED at Kitchen,
   and firing prints Kitchen's ticket marked FIRE (Tasks 34, 35b).
2. **A station that never had the HOLD ticket** (Bar off, Kitchen on, one group with dishes at
   both): Bar gets no HOLD ticket, no HOLD correction, no HOLD part on a MOVED slip or reprint, and an
   unmarked ticket when the group fires; Kitchen gets all of them (Tasks 34, 35a–c).
3. **A station switched on after a group was held** (Bar off at the hold, a Bar dish held; Bar
   switched on; a second Bar dish joins or is moved in): nothing prints at Bar until the fire, where
   both dishes print on one ordinary ticket; Bar is never recorded, so no "+1" or "-1" for paper it
   never had (Tasks 35b, 35c).
6. **A station with a kitchen screen and no printer** in a printed held group: every notice it
   gets today — HOLD CHANGED and CANCELLED, reroute, order note, moved — it still gets (Tasks 35a–c).
4. **Identical dishes on one ticket for two stations sharing a printer**, Grill `separate`, Cold
   `combined`: each station's part of the joint ticket is laid out by its own choice (Task 33).
5. **PATCH `printMovedSlips: null`** from any client: 400 naming the field, nothing written; a
   station stored null reads `printMovedSlips: true` in the answer and prints MOVED slips (Tasks 30, 33).

### Task 29: storage — two station columns, the hold-paper table, one core migration

**Files:**
- Create: `packages/shared/src/ticket-grouping.ts`, `src/ticket-grouping.test.ts`; modify
  `packages/shared/src/index.ts` (beside `isStationColour`, `:210`)
- Modify: `packages/db/src/schema/kitchen-stations.ts` (`:25-26` and after), `src/schema/index.ts`,
  `src/classification.ts` (after `order_groups`, `:185-189`)
- Create: `packages/db/src/schema/order-group-hold-stations.ts` (modelled on
  `device-made-here-stations.ts`), `src/schema/order-group-hold-stations.test.ts`
- Create (generated): `packages/db/drizzle/NNNN_station_printing_choices.sql`, its snapshot and
  journal entry, by `pnpm --filter @waitron/db db:generate --name station_printing_choices` —
  never numbered or edited by hand; on a number collision reset `packages/db/drizzle` to `main`
  and regenerate (as PR 5's Task 26)
- Modify (Decision 7): `apps/server/src/canvas-retirement-upgrade.test.ts` (`:394`, `:500-516`),
  `apps/server/src/station-order-migration.test.ts` (`:14`, `:27`, `:109-112`, before `:229`),
  `scripts/schema-constraints.test.ts` (after `:218`), `apps/server/src/station-delete.test.ts`
  (`:152-175`), `apps/server/src/management-api.station-disable.test.ts` (`:123-130`)
- Test: `packages/db/src/schema/kitchen-stations.test.ts`

**Interfaces — produces:**
- `export const TICKET_GROUPINGS = ["combined", "separate"] as const;`
  `export type TicketGrouping = (typeof TICKET_GROUPINGS)[number];`
  `export function isTicketGrouping(value: unknown): value is TicketGrouping` (`@waitron/shared`).
- `kitchenStations.ticketGrouping` (`label("ticket_grouping").$type<TicketGrouping>().notNull().default("combined")`,
  with the comment "The station routes and the import refuse a value outside `isTicketGrouping`; a
  CHECK would rebuild this table.") and `kitchenStations.printHeldWork`
  (`flag("print_held_work").notNull().default(false)`). The `printMovedSlips` comment
  (`kitchen-stations.ts:25`) becomes "Null prints MOVED slips; the station routes write a boolean."
- `orderGroupHoldStations` (`group_id`, `station_id`, primary key `order_group_hold_stations_pk`,
  keys `order_group_hold_stations_group_fk`, `order_group_hold_stations_station_fk`), with the doc
  comment "The stations a held group's HOLD ticket was queued for; held-work paper goes only to
  them (A756 PR 6)." Classified `state`: "the stations a held group's HOLD ticket was queued for;
  copied to a standby, never drained back".

- [ ] **Step 1: Write the failing tests.**
  - `ticket-grouping.test.ts`: `TICKET_GROUPINGS` `toEqual(["combined", "separate"])`;
    `isTicketGrouping` true for each, false for `"Combined"`, `""`, `null`, `1` (shared is
    mutation-tested).
  - `kitchen-stations.test.ts`: `"a station row given no printing choices groups identical dishes,
    prints no held work in advance and leaves MOVED slips null"` — a bare insert reads
    `combined` / `false` / `null`.
  - `order-group-hold-stations.test.ts`: a row naming a real group and station is stored; a second
    identical row is refused as a unique violation; a row naming an unknown station is refused as
    a foreign-key error (`isRefusal(error, FOREIGN_KEY_VIOLATION)`, as `order-groups.test.ts:178`
    asserts; model the file on `device-made-here-stations.test.ts`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/shared exec vitest run src/ticket-grouping.test.ts` and
  `pnpm --filter @waitron/db exec vitest run src/schema/kitchen-stations.test.ts src/schema/order-group-hold-stations.test.ts`.
- [ ] **Step 3: Implement and generate.** Read the SQL: exactly Decision 1's `CREATE TABLE` and two
  `ALTER TABLE … ADD` lines; a `__new_` table is a stop.
- [ ] **Step 4: The hand-kept lists** of Decision 7 (canvas, station-order, schema-constraints).
- [ ] **Step 5: Run** (free memory first) Step 2's commands; the guards
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts`
  (expected: one step more than on `main` and one table more holding rows; Decision 1 measured
  the two migrations together, +2 steps and +1 table); `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`;
  `pnpm --filter @waitron/db exec vitest run src/schema src/classification.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts src/station-order-migration.test.ts src/station-delete.test.ts src/management-api.station-disable.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run` — PASS, each `Tests` count read.
- [ ] **Step 6:** typecheck `@waitron/shared`, `@waitron/db`, `@waitron/server`; prettier; commit
  `git commit -s -m "Each station can store its own ticket grouping and held printing; the hold paper table (A756 PR 6)"`
  with a body giving the reason the new table is in the core set (CLAUDE.md §3, "No new table enters
  the core migration set without a stated reason in the commit"): both its keys point at core tables
  (`order_groups`, `kitchen_stations`, both in `packages/db/src/schema`), and the server's printing
  code that writes and reads it is not a module's; then update the ledger.

**Assertions changed:** the two whole-list pins of `station-delete.test.ts` and
`management-api.station-disable.test.ts` gain a table, every existing value unchanged (Decision 7).
`station-order-migration.test.ts` and `canvas-retirement-upgrade.test.ts` change setup only.

### Task 30: a station's save writes its own printing choices

**Files:**
- Modify: `apps/server/src/kitchen.ts` (`Station` `:29-43`, `createStation` `:79-122`,
  `listStations` `:124-141`, `updateStation` `:158-205`), `apps/server/src/management-api.ts`
  (PATCH `:1596-1655`; a `parseTicketGrouping` beside `parseStationColour` `:352-357`)
- Test: `apps/server/src/kitchen.test.ts`, `apps/server/src/management-api.test.ts`

**Interfaces — produces:** `Station` with `ticketGrouping: TicketGrouping`, `printHeldWork: boolean`,
`printMovedSlips: boolean` (`listStations` reads the column and maps `null` to `true`; Task 33
does the same in `kitchen-print.ts`' `readStations`, Decision 4); `updateStation`'s patch takes
`ticketGrouping?: TicketGrouping; printHeldWork?: boolean; printMovedSlips?: boolean`;
`createStation` inserts `printMovedSlips: true`.

- [ ] **Step 1: Write the failing tests.**
  - `kitchen.test.ts`: `"a new station groups identical dishes, prints no held work in advance and
    prints MOVED slips"` — `createStation({ name })`; the row reads `combined` / `false` / `true` and
    `listStations` answers the same; `"a station stored with no MOVED slips choice answers that it
    prints them"` — set the column to null by SQL; `listStations` answers `printMovedSlips: true`;
    `"updateStation writes a station's three printing choices and leaves the others"`.
  - `management-api.test.ts`:
    - `"lists a new station following the venue for MOVED slips"` (`:1706`) → `"lists a new
      station printing MOVED slips, grouping identical dishes, printing no held work in advance"`.
    - `"PATCH saves a station's MOVED slips choice as print, don't print or as the venue"`
      (`:1713`) → `"… as print or don't print"`: the loop over `[true, false, null]` becomes
      `[true, false]`.
    - `"PATCH refuses a MOVED slips choice that is not true, false or null"` (`:1728`) →
      `"… that is not true or false"`: `null` joins `"yes"` and `1` as refused, and the row is
      unchanged after each.
    - New: `"PATCH saves a station's ticket grouping and refuses any other value"` — `"separate"`
      saved; `"Separate"`, `null`, `1` each 400 `management.request_invalid { field: "ticketGrouping" }`,
      the row still `separate`; `"PATCH saves a station's held printing and refuses a non-boolean"`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts -t "station|MOVED|grouping|held|PATCH"`.
- [ ] **Step 3: Implement.** Update the whole-shape pins of Decision 7 (two new keys;
  `printMovedSlips: null` → `true` at `kitchen.test.ts:230`, `:240`, `:250`, `:285`, and the
  response types at `management-api.test.ts:1046`, `:1056` → `boolean`).
- [ ] **Step 4: Run** Step 2's command without `-t`, plus
  `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/till-api.test.ts src/station-queue-rest.test.ts src/configuration-transfer.test.ts`
  — PASS (the till answers carry the keys; any further whole-shape pin found gains the two keys
  only, every existing value unchanged — record each). Configuration transfer's
  `"transfers each station's MOVED slips choice, print, don't print or as the venue"` (`:2245`)
  still passes: it reads the column, which keeps null.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "A station's save writes its own ticket grouping, held printing and MOVED slips choice (A756 PR 6)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1, "Every station setting is set on the station itself"; this
plan's table, "MOVED slips … no venue fallback"): `management-api.test.ts` `:1706`, `:1713`, `:1728`;
the station answer's `printMovedSlips` null → `true` in `kitchen.test.ts`. Keys added to
whole-shape pins with existing values unchanged: named in the ledger.

### Task 31: configuration copies check an imported ticket grouping

**Files:** `packages/db/src/configuration-transfer.ts:4-9`; Test:
`packages/db/src/configuration-transfer.test.ts` (so db's own coverage and mutation runs see the
check) and `apps/server/src/configuration-transfer.test.ts`.

- [ ] **Step 1: Write the failing tests.** In `packages/db/src/configuration-transfer.test.ts`,
  beside the colour cases (`:41-66`): `"refuses a station ticket grouping a save would refuse"`
  (`"bogus"`, `"Combined"`, `null`, `1` each throw `setup.request_invalid`
  `{ field: "kitchen_stations.ticket_grouping" }`), `"accepts an absent station ticket grouping"`
  and `"accepts each station ticket grouping"` (over `TICKET_GROUPINGS`). In
  `apps/server/src/configuration-transfer.test.ts`, beside `"transfers a station's colour"` (`:2283`):
  - `"transfers each station's ticket grouping and held printing"` — Grill `separate` / `true`,
    Cold `combined` / `false`; the exported rows carry `ticket_grouping` and `print_held_work`, and
    the imported stations read the same.
  - `"refuses an imported ticket grouping outside the two values before writing anything"` — a
    bundle row with `ticket_grouping: "bogus"` → `setup.request_invalid`
    `{ field: "kitchen_stations.ticket_grouping" }`, and the target has no station named as in the
    bundle (as the colour refusal case checks).
- [ ] **Step 2: Run and watch the refusal cases fail** (the transfer case may already pass: the
  table is exported whole). `pnpm --filter @waitron/db exec vitest run src/configuration-transfer.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t "grouping|held printing"`.
- [ ] **Step 3: Implement** the check in `validateCoreConfiguration`.
- [ ] **Step 4: Run** Step 2's db command, `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run`, `pnpm exec vitest run scripts/id-columns-are-references.test.ts`
  — PASS. `git grep -n 'version: 7' -- packages/provisioning/src/configuration-transfer.ts` still
  prints `:137` (no format change, Decision 6).
- [ ] **Step 5:** typecheck `@waitron/db`, `@waitron/server`; prettier; commit
  `git commit -s -m "A configuration import refuses an unknown station ticket grouping (A756 PR 6)"`,
  then update the ledger.

**Assertions changed:** none.

### Task 32: test venues set their stations' printing choices through one helper

Setup only: Decision 8. Mechanical; no check changes.

**Files:**
- Create: `apps/server/src/testing/station-printing.ts`:
  `setStationPrinting(tx: Transaction, choices: { printHeldWork?: boolean; ticketGrouping?: TicketGrouping; printMovedSlips?: boolean }, stationIds?: readonly string[]): Promise<void>`
  — writes each given choice to every `kitchen_stations` row (or only `stationIds`) **and**, while
  the venue value exists, to the venue through `writePrintHeldWork` / `writeKitchenTicketGrouping`
  / `writePrintMovedSlips` (only when `stationIds` is absent). One comment line: "Writes the venue's
  value too until A756 PR 6 Task 38."
- Modify: every server test calling those three seat writers —
  `git grep -l -E 'writePrintHeldWork\(|writeKitchenTicketGrouping\(|writePrintMovedSlips\(' -- 'apps/server/src/*.test.ts'`
  lists 23 files on `157f152c5` (Decision 8): each call `writeX(tx, v)` becomes
  `setStationPrinting(tx, { x: v })`, and each `afterEach` reset likewise. Not here:
  `move-merge.test.ts`'s describes at `:1372` and `:1442`, whose subject is the venue/station
  MOVED-slips relation (Task 33), and `kitchen-print.test.ts:1203`'s `it.each` on the venue
  grouping (Task 33).

- [ ] **Step 1:** Write the helper and make the edits. Where a case creates a station after the
  helper call, call the helper again after it (or pass the new station's id) — setup.
- [ ] **Step 2: Run** (free memory first) every touched file in one
  `pnpm --filter @waitron/server exec vitest run <files>` — PASS, each file's count read; then
  `git grep -n -E 'writePrintHeldWork\(|writeKitchenTicketGrouping\(|writePrintMovedSlips\(' -- 'apps/server/src/*.test.ts'`
  prints only the Task 33 cases named above.
- [ ] **Step 3:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "Test venues set their stations' printing choices through one helper (A756 PR 6)"`,
  then update the ledger.

**Assertions changed:** none. (`split-off-extras.release.test.ts:120` reads `readPrintHeldWork`
and keeps passing because the helper still writes the venue value; Task 38 changes it.)

### Task 33: tickets and MOVED slips read each station's own grouping and MOVED slips choice

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` — `readStations` (`:350-366`: add `ticketGrouping`,
  `printHeldWork`, and `printMovedSlips` read as a boolean, null as true); `planKitchenTickets`
  (drop `:561`; `arrangeTicketItems(…, station.ticketGrouping)` at `:588-594`);
  `MovedSlipPrinting` (`:1403-1408`, drop `grouping`); `readMovedSlipPrinting` (`:1414-1436`: keep
  stations whose own choice prints, no venue read); `printMovedSlips` (`:1474`: the station's own
  grouping). `apps/server/src/kitchen-ticket.ts:85` aliases `TicketGrouping` from `@waitron/shared`.
- Test: `apps/server/src/kitchen-print.test.ts`, `apps/server/src/move-merge.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `kitchen-print.test.ts`: `"each station's part of a shared printer's ticket follows its own
    ticket grouping"` — Grill `separate` and Cold `combined` share one printer; a fire of 3 Burger
    at Grill and 2 Salad at Cold prints Grill's three entries of 1 and Cold's one `2 x Salad`.
    The `it.each` at `:1203` (venue grouping) sets the grouping on the dish's station instead
    (setup) and its rows and checks stay.
  - `move-merge.test.ts`: `describe("the venue's print-MOVED-slips setting")` (`:1372`) becomes
    `describe("a station's print-MOVED-slips choice")`: its three cases keep their checks, the
    choice set on the station (`setStationPrinting(tx, { printMovedSlips: on })`).
    `describe("a prep station's own print-MOVED-slips choice")` (`:1442`): `"venue on, Grill off,
    Postres following…"` (`:1490`) → `"Grill off and Postres never chosen: Move guests prints at
    Postres only and records notices at both"` (Postres's column left null, so it prints);
    `"venue off, Grill on: Move guests prints at the Grill only"` (`:1503`) → `"Grill on and
    Postres off: …"` (Postres set false); `stationPrints` (`:1453`) takes a boolean; the venue
    writes at `:1443`, `:1467`, `:1514` go. The grouping describe (`:1178`) sets the grouping on
    the stations (setup).
  - New in `move-merge.test.ts`: `"a station whose MOVED slips choice was never set prints MOVED
    slips"` — set the column null by SQL; Move guests prints its slip.
- [ ] **Step 2: Run and watch the new cases fail.**
  `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts src/move-merge.test.ts -t "grouping|MOVED"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** (free memory first) every file of Task 32 (`git grep -l setStationPrinting -- 'apps/server/src/*.test.ts' | xargs pnpm --filter @waitron/server exec vitest run`, which lists the 23 files Decision 8 counts), and
  `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts src/party-table-actions.test.ts`
  — PASS; `git grep -n -E 'readKitchenTicketGrouping|readPrintMovedSlips' -- apps/server/src`
  prints nothing.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "Kitchen tickets and MOVED slips follow each station's own choices (A756 PR 6)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1; this plan's table, MOVED slips "no venue fallback"): the two
renamed `move-merge.test.ts` cases at `:1490` and `:1503`, whose expectation for a station left as
the venue now follows "null prints"; the describe at `:1372` renamed with its checks kept.

### Task 34: a HOLD ticket goes to the stations that print held work, and the fire marks only theirs

**Files:**
- Modify: `apps/server/src/order-groups.ts` — `printHoldTickets` (`:2001-2041`): read the held
  items joined to `kitchen_stations` with `print_held_work` on, no venue read (`:2012`); record
  each station a job carried in `order_group_hold_stations`; stamp `hold_printed_at` as today.
  Add `heldPaperStations(tx, groupIds): Promise<Map<string, ReadonlySet<string>>>` and
  `recordHeldPaper(tx, groupId, stationIds)` (insert, `onConflictDoNothing({ target: [groupId, stationId] })`
  — the table has one unique key, so the target is named per CLAUDE.md §3). Fire paths: the group
  fire (`:811-817`) and Fire now on one held dish (`:529-560`) pass the group's marker set instead of
  `"FIRE"`.
- Modify: `apps/server/src/kitchen-print.ts` — `enqueueKitchenTickets` (`:726-740`) answers
  `ReadonlySet<string>`, the stations its jobs carried (only `order-groups.ts:2032` used the
  boolean); `planKitchenTickets` takes `fire?: { heldPaper: ReadonlySet<string> }` in place of
  `mark: "FIRE"` and prints `*** FIRE ***` on a route only when one of its stations is in
  `heldPaper` (the `head` object `:629-639` gets its `mark` per route).
- Modify: `apps/server/src/working-order.ts` — the `mark?: "FIRE"` parameter of `fireOrderLines`
  (`:2332-2338`) and the functions it passes it through (`:2357`, `:2410`, `:2440`) becomes
  `fire?: { heldPaper: ReadonlySet<string> }`.
- Modify: `apps/server/src/station-move.ts` — the held move's destination paper (Decision 5's
  ruling): a recorded destination prints as today; an unrecorded one that prints held work now and
  holds none of the group's other held work gets the HOLD ticket "from X" and is recorded
  (`recordHeldPaper`); any other prints nothing until the fire. Old-station corrections stay for 35c.
- Modify: `packages/db/src/index.ts` — export `orderGroupHoldStations`.
- Test: `apps/server/src/order-groups.test.ts` (`describe("advance HOLD tickets (Task 6)")`, `:4288`),
  `apps/server/src/station-move.test.ts`

- [ ] **Step 1: Write the failing tests** — in `station-move.test.ts`, each checking the
  `order_group_hold_stations` rows: `"a held dish moved to a station that prints held work and has
  none of the group's held work gets a HOLD ticket from X and is fired marked FIRE"`, `"a held dish
  moved to a station that does not print held work prints nothing there until an unmarked fire
  ticket"`, `"a held dish moved to a station already holding unprinted held work of the group prints
  nothing there until the fire"`. In the HOLD describe, with Kitchen (prints held work) and
  Bar (does not), each with its own printer:
  - `"a held group's HOLD ticket prints only at the stations that print held work, and records
    them"` — a held group with a dish at each: one HOLD job, at Kitchen's printer, listing only
    Kitchen's dish; `order_group_hold_stations` = `{(group, Kitchen)}`; `hold_printed_at` set.
  - `"with no station printing held work, nothing prints and nothing is recorded"` — no job, no
    row, `hold_printed_at` null.
  - `"firing marks FIRE only on the paper of a station that had the HOLD ticket"` — Kitchen's fire
    ticket starts `*** FIRE ***`, Bar's does not.
  - `"a station switched off after its HOLD ticket printed is still fired marked FIRE"` and
    `"a station switched on after the group was held is fired with an ordinary ticket"`.
  - `"Fire now on one held dish marks FIRE only at a station that had the HOLD ticket"`
    (the `:5316` describe's path).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/order-groups.test.ts -t "HOLD|FIRE|held"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** (free memory first)
Every file of Task 32 (`git grep -l setStationPrinting -- 'apps/server/src/*.test.ts' | xargs pnpm --filter @waitron/server exec vitest run`, which lists the 23 files Decision 8 counts)
  — PASS (every one sets its stations through Task 32's helper, so their checks hold), plus
  `src/station-move.test.ts src/management-api.station-disable.test.ts src/station-delete.test.ts`;
  `git grep -n -E 'readPrintHeldWork|mark\?: "FIRE"' -- apps/server/src ':!*.test.ts'` prints nothing.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "A HOLD ticket prints at the stations that print held work, and the fire marks only theirs (A756 PR 6)"`,
  then update the ledger.

**Assertions changed:** none; the cases are new (A773 §6, "Held-ticket printing in advance stays a
station setting").

### Task 35a: held paper prints only at the stations recorded for it

The filter of Decision 5, in the three places paper is made; no item selection changes, so every
notice stays as it is.

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` — `CorrectionItem` (`:772-783`) gains
  `holdGroupId?: string`; `printCorrectionSlips` (`:1064`) reads the table for the items' hold
  groups and drops, from the slips only, an item whose station is not recorded for its
  `holdGroupId`, before the allergy freeze (`:1075-1083`); the order-note correction's query
  (`:801-830`) selects the line's group id and sets `holdGroupId` on its held rows (`firedAt` null);
  `readMovedSlipPrinting`/`printMovedSlips` (`:1414-1500`) keep a held item on the slip only when
  its line's group and its station are recorded; `readReprintParts` (`:1606-1643`) keeps a held
  item in the reprint's HOLD part only on the same condition. A station left with nothing to print
  gets no slip. `readOnHoldTickets` and `readSentItems` are not changed.
- Test: `apps/server/src/kitchen-print.test.ts`, `apps/server/src/move-merge.test.ts` (the HOLD
  describe `:1023`), `apps/server/src/order-kitchen-note.corrections.test.ts`

- [ ] **Step 1: Write the failing tests.** Kitchen prints held work; Bar does not; Screen is a
  station with a kitchen screen and no printer; one held group with a dish at each, its HOLD ticket
  queued (Kitchen recorded):
  - `move-merge.test.ts`: `"a MOVED slip lists under HOLD only the held dishes of a station
    recorded for the group"` — Move guests: Kitchen's slip lists its dish under HOLD; Bar prints
    nothing; the `moved` notices of all three stations are recorded, as today.
  - `kitchen-print.test.ts`: `"a reprint prints the HOLD part only for a station recorded for the
    group"`.
  - `order-kitchen-note.corrections.test.ts`: `"a changed order note corrects held paper only at a
    station recorded for the group, and every station's screen is told"` — a slip at Kitchen, none
    at Bar; notices at Kitchen, Bar and Screen.
  - In each file, the screen-only check: Screen's notices are those it gets on `157f152c5` (the
    case asserts them explicitly, so deleting the filter's placement upstream would fail it).
- [ ] **Step 2: Run and watch the printing checks fail** (the notice checks pass before and after).
  `pnpm --filter @waitron/server exec vitest run src/move-merge.test.ts src/kitchen-print.test.ts src/order-kitchen-note.corrections.test.ts -t "recorded|HOLD|held"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files without `-t`, plus every file of Task 32
  (`git grep -l setStationPrinting -- 'apps/server/src/*.test.ts' | xargs pnpm --filter @waitron/server exec vitest run`,
  free memory first) and `src/party-move-bill.test.ts src/party-table-actions.test.ts src/finish-party-collect.test.ts src/sent-order-number.test.ts`
  — PASS.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "HOLD paper on corrections, MOVED slips and reprints goes only to stations recorded for it (A756 PR 6)"`,
  then update the ledger.

**Assertions changed:** none; the cases are new.

### Task 35b: HOLD corrections built from a group change name their group

**Files:**
- Modify: `apps/server/src/order-groups.ts` — `HeldChange` (`:2063-2071`) gains `groupId: string`
  (the group whose HOLD ticket is corrected); `correctHoldTickets` (`:2073-2100`) passes it on as
  each item's `holdGroupId`. Item selection does not change: the type change makes the compiler list
  every `HeldChange` built — `order-groups.ts:529-548` (source), `:1098-1133` (`taken` from
  `line.groupId`, `given` to `targetId`), `:2116-2135` (`correctJoin`, still returning early for a
  group with no stamp), `working-order.ts:2969-2989`, `:6030-6062` (`givenExtras`) and
  `:6138-6175` (the held edits, printed at `:5815-5816` and `:6059`).
- The join half of Decision 5's ruling lands here: a join at a station not recorded, which prints
  held work now and holds none of the group's held work, gets today's HOLD CHANGED added and is
  recorded (`recordHeldPaper`).
- Test: `apps/server/src/order-groups.test.ts`, `apps/server/src/split-off-extras.edit.test.ts`

- [ ] **Step 1: Write the failing tests** (Kitchen on, Bar off, Screen with no printer; one printed
  held group with a dish at each, unless said):
  - `order-groups.test.ts`: `"removing a held dish corrects the HOLD ticket only at a station
    recorded for the group, and tells every station's screen"`; `"moving a held dish between
    printed groups takes it off and adds it only at stations recorded for each group"`;
    `"a station switched off after its HOLD ticket printed still gets +N for a joining dish"`;
    `"a station switched on after the group was held gets nothing for a joining dish, and its whole
    part prints unmarked at the fire"` — Bar switched on, a second Bar dish joins: no slip at Bar, Bar
    not recorded, and the fire prints Bar's two dishes on one ordinary ticket; Screen's notices for
    the join are recorded in every case.
  - `split-off-extras.edit.test.ts`: `"an extra added to a held dish prints +N only at a station
    recorded for the group"`.
- [ ] **Step 2: Run and watch the printing checks fail.**
  `pnpm --filter @waitron/server exec vitest run src/order-groups.test.ts src/split-off-extras.edit.test.ts -t "recorded|switched|joining|extra"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two files without `-t`, every file of Task 32 (as in Task 35a), and
  `src/till-api.groups.test.ts src/working-order.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "HOLD corrections from group changes print only where the group's HOLD ticket went (A756 PR 6)"`,
  then update the ledger.

**Assertions changed:** none; the cases are new.

### Task 35c: recall, a cancelled extra and a station move print only on a station's own HOLD paper

**Files:**
- Modify: `apps/server/src/draft-recall.ts:267-282` (its HOLD CANCELLED items carry
  `holdGroupId: line.groupId`; the condition on the stamp stays), `apps/server/src/working-order.ts:3045-3056`
  (the held cancelled extra carries `holdGroupId: extra.dishGroupId`), `apps/server/src/station-move.ts`
  — `:110-140` and `:295-325` (held corrections at the old station carry `holdGroupId: row.groupId`;
  `enqueueStationMoved` records the reroute notice for every item as today); the destination's
  paper landed in Task 34 (Decision 5's ruling)
- Test: `apps/server/src/draft-recall.test.ts`, `apps/server/src/adjustments-extra-cancel.test.ts`,
  `apps/server/src/station-move.test.ts`

- [ ] **Step 1: Write the failing tests** (Kitchen on, Bar off, Screen with no printer; one printed
  held group): `draft-recall.test.ts`: `"recalling a held dish cancels it on paper only at a station
  recorded for the group, and every screen is told"`; `adjustments-extra-cancel.test.ts`:
  `"cancelling a held dish's extra prints only at a station recorded for the group"`;
  `station-move.test.ts`: `"moving a held dish from Kitchen to Bar, which does not print held
  work, cancels it on Kitchen's paper, prints nothing at Bar until the fire, and records the reroute
  notice"`, `"moving a held dish from Bar to Kitchen, recorded for the group, prints nothing at Bar
  and a HOLD ticket from Bar at Kitchen, which then fires marked FIRE"`, `"a held dish moved to a recorded station since switched off still prints its HOLD ticket
  there"`, and `"a held dish moved off the screen-only station keeps its reroute notice"`.
- [ ] **Step 2: Run and watch the printing checks fail.**
  `pnpm --filter @waitron/server exec vitest run src/draft-recall.test.ts src/adjustments-extra-cancel.test.ts src/station-move.test.ts -t "recorded|held"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files without `-t`, every file of Task 32 (as in Task 35a), and
  `src/line-cancel.test.ts src/draft-recall-legacy.test.ts src/till-reroute-e2e.test.ts src/management-api.station-disable.test.ts src/station-delete.test.ts src/bill-editing.station-move.test.ts`
  — PASS. Then the receipt of Decision 5:
  `git grep -n 'holdGroupId' -- apps/server/src ':!*.test.ts'` names `kitchen-print.ts`,
  `order-groups.ts`, `draft-recall.ts`, `working-order.ts` and `station-move.ts`, and not
  `line-cancel.ts`.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "Recall, a cancelled extra and a station move print only on a station's own HOLD paper (A756 PR 6)"`,
  then update the ledger.

**Assertions changed:** none; the cases are new.

### Task 36: the station editor sets a station's three printing choices

**Files:**
- Modify: `packages/venue-service/src/dashboard/station-editor.ts` (`StationEditorStation`
  `:27-36`, `StationEditorSave` `:42-49`, `Draft` `:61-67`, `equal` `:94-100`, `movedChoice`/
  `movedValue`/`movedOptions` `:190-204`, `venuePrintsMovedSlips` `:274-275`, the draft `:277-286`
  and `:329-337`, `changed` `:406`, `sendable` `:413-435`, the render after the MOVED fieldset
  `:605-623`)
- Modify: `routing-client.ts` (`PrepStation` `:24-38`; `updateStation` `:116-127`),
  `prep-stations-screen.ts` (`:756-757` pass the three; `:766` goes), `strings.ts`
  (`prep.moved_slips_venue_*` EN `:304-305`, ES `:1195-1196` deleted; `prep.ticket_grouping`,
  `prep.ticket_grouping.combined`, `prep.ticket_grouping.separate`, `prep.ticket_grouping_hint`,
  `prep.print_held_work`, `prep.print_held_work_hint` added EN and ES, Decision 9's words)
- Test: `station-editor.test.ts`, `station-editor.a11y.test.ts`, `prep-stations-screen.test.ts`
- Modify (fixtures, setup): every station fixture — `git grep -l -E 'printMovedSlips: (null|true|false)' -- packages/venue-service/src/dashboard packages/venue-service/test`
  minus the operations-model fixtures Task 37 handles (those that also name `kitchenTicketGrouping`):
  `calendar-station-month.test.ts:41`, `prep-stations-screen*.test.ts`, `routing-grid*.test.ts`,
  `station-editor*.test.ts`, `test/station-delete-test-helpers.ts:25`, `:52`. A station fixture's
  `printMovedSlips: null` becomes `true` and gains `ticketGrouping: "combined", printHeldWork: false`;
  a `RoutingView` fixture loses its `printMovedSlips` key (`routing-grid.test.ts:78`,
  `prep-stations-screen.test.ts:47`, `station-delete-test-helpers.ts:25`).

**Interfaces — produces:** `StationEditorStation.printMovedSlips: boolean`, plus
`ticketGrouping: TicketGrouping` and `printHeldWork: boolean`; `StationEditorSave` gains
`ticketGrouping?` and `printHeldWork?`, `printMovedSlips?: boolean`.

- [ ] **Step 1: Write the failing tests** in `station-editor.test.ts`:
  - `"offers Print a slip when sent dishes move table as the venue…"` (`:545`) → `"offers Print a
    slip when sent dishes move table as Print or Don't print, right after the rest-of-order
    switch"`: options `[["print","Print"],["dont-print","Don't print"]]`; the position check (`:555`)
    unchanged; the `venuePrintsMovedSlips: false` half (`:557-558`) goes.
  - `"sends null when a station's own choice goes back to as the venue"` (`:580`): deleted.
  - `"reads Print a slip when sent dishes move table in Spanish"` (`:588`): options
    `["Imprimir", "No imprimir"]`; the venue-label check (`:598`) goes.
  - New: `"opens on the station's ticket grouping and held printing, after MOVED slips"` — a
    `wt-combobox[name=ticketGrouping]` labelled "Identical dishes on a kitchen ticket" with the two
    choices, value from the station; a `wt-switch[name=printHeldWork]` labelled "Print held groups
    in advance", checked from the station, with its note; both after the MOVED combobox.
  - New: `"sends only a changed ticket grouping or held printing, and nothing for a choice put
    back"`; `"reads the ticket grouping and held printing in Spanish"`.
  - `station-editor.a11y.test.ts`: its fixture gains the two values, so its axe cases run over
    the new combobox and switch in both themes.
  - `prep-stations-screen.test.ts`: `"hands the station's and the venue's MOVED slips choices to the
    editor and saves the station's"` (`:886`) → `"hands the station's printing choices to the editor
    and saves the station's"` — the editor opens on `printMovedSlips: true`, `ticketGrouping`,
    `printHeldWork`; choosing Don't print sends `{ printMovedSlips: false }` (was `null` at `:912`);
    the `routing.printMovedSlips` half (`:891`, `:920-928`) goes. `"follows the venue's MOVED slips
    switch in an open editor's first option"` (`:934`) and `"keeps a MOVED slips choice made in an
    open editor when the venue's switch changes"` (`:943`): deleted.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-editor.test.ts src/dashboard/prep-stations-screen.test.ts`
- [ ] **Step 3: Implement**; sweep the fixtures.
- [ ] **Step 4: Run** (free memory first) `pnpm --filter @waitron/venue-service exec vitest run src/dashboard`
  — PASS; `git grep -n -E 'venuePrintsMovedSlips|moved_slips_venue|"venue"' -- packages/venue-service/src/dashboard/station-editor.ts packages/venue-service/src/dashboard/prep-stations-screen.ts`
  prints nothing.
- [ ] **Step 5:** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts`;
  typecheck `@waitron/venue-service`; prettier; commit
  `git commit -s -m "The station editor sets a station's ticket grouping, held printing and MOVED slips (A756 PR 6)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1; this plan's table, MOVED slips "no venue fallback"; the
"wording question is moot" note above, which said PR 6 deletes "Venue setting: Print"):
`station-editor.test.ts` `:545`, `:580` (deleted), `:588`; `prep-stations-screen.test.ts` `:886`,
`:934` and `:943` (deleted). Fixtures are setup.

### Task 37: the Kitchen tab drops the three venue printing settings

**Files:**
- Modify: `packages/venue-service/src/dashboard/service-settings-panel.ts` (`:7`, `:10-11`,
  `:131-197`: keep the section, its heading and Changes after sending), `client.ts`
  (`VenueServiceModel` `:104-106`, `VenueServiceSettingsView` `:118-121`, `KitchenTicketGrouping`
  `:122`, `loadSettings` `:296-302`, the three `save*` methods `:406-422`), `strings.ts`
  (`venue.kitchen_ticket_grouping*`, `venue.print_held_work*`, `venue.print_moved_slips*`, EN
  `:520-523`, `:529-534`, ES `:1416-1420`, `:1426-1431`; and `venue.combobox_search` /
  `venue.combobox_no_results` only if `git grep` finds no other user), `live-queries.ts` (the
  `routing` list loses `service_settings`, `:154`, Decision 4)
- Test: `service-settings-panel.test.ts`, `service-settings-panel.a11y.test.ts`,
  `service-settings-panel.exempt.test.ts`, `client.test.ts`, `live-queries.test.ts`
- Modify (fixtures, setup): each operations-model fixture naming the three keys —
  `git grep -l kitchenTicketGrouping -- packages/venue-service apps/dashboard` minus the files above
  (`department-dialogs*.test.ts`, `department-settings*.test.ts`, `departments-list*.test.ts`,
  `department-edit-dialog-transfers.a11y.test.ts`, `index.test.ts`, `venue-departments-shell*.test.ts`,
  `venue-navigation.test.ts`, `venue-operations-loader.test.ts`, `src/testing/department-zones-fixture.ts:112`,
  `test/service-delete-test-helpers.ts:38`, `apps/dashboard/src/testing/department-receipt-app-fixture.ts:64-66`,
  `apps/dashboard/src/dashboard-app.test.ts` `:1763`, `:4489`, `:4567`, `:8064`, `:8184`): the
  three keys go.

- [ ] **Step 1: Change the tests first.**
  - `service-settings-panel.test.ts`: every case whose subject is one of the three (the grouping
    combobox, the held-work switch and hint, the MOVED switch and hint; `grep -n -E 'kitchenTicketGrouping|printHeldWork|printMovedSlips|print-held-work|print-moved-slips'`
    lists them) is deleted; add `"the Kitchen tab's venue-service panel offers only Changes after
    sending"` — one `wt-switch`, named `editSentLines`, no `wt-combobox`, no
    `[data-test=print-held-work-hint]` or `[data-test=print-moved-slips-hint]`.
  - `service-settings-panel.a11y.test.ts` and `.exempt.test.ts`: the cases or rows for the three go;
    the Changes after sending ones stay.
  - `client.test.ts`: the three save-method cases go; `loadSettings`' expected value loses the keys.
  - `live-queries.test.ts`: the `routing` list's expected value loses `service_settings`.
- [ ] **Step 2: Run and watch the new case fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/service-settings-panel.test.ts`
- [ ] **Step 3: Implement**; sweep the fixtures.
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard` and
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.settings-panels.test.ts src/screens`
  (browser runs; free memory first) — PASS; `pnpm exec vitest run scripts/live-subscriptions.test.ts`;
  `git grep -n -E 'kitchenTicketGrouping|savePrintHeldWork|savePrintMovedSlips|venue\.print_(held_work|moved_slips)|venue\.kitchen_ticket_grouping' -- apps packages ':!**/drizzle/**'`
  prints only venue-service's server code and its tests (Task 38).
- [ ] **Step 5:** typecheck `@waitron/venue-service`, `@waitron/dashboard`; prettier; commit
  `git commit -s -m "The Kitchen tab no longer sets ticket grouping, held printing or MOVED slips (A756 PR 6)"`,
  then update the ledger.

**Assertions changed** (A756 "Changed by A773": "There is no 'Every station' card: every station
setting is set on each station"): the panel's cases for the three settings; `client.test.ts`'s
three save cases and `loadSettings` value; the `routing` dependency list.

### Task 38: venue-service stops storing and serving the venue's printing settings

**Files:**
- Modify: `packages/venue-service/src/kitchen-notices.ts` (delete `:333-381`'s six functions and
  the `KitchenTicketGrouping` import, `:19`), `routes.ts` (imports `:40-46`, `:62`; `:703`;
  `:763-765`; `:782-784`; the three PUT routes `:804-843`), `routing-types.ts:108-112`,
  `service.ts` (`:93-95`, `:242-244`), `packages/module/src/module.ts` (`:1370-1371`, `:1445-1448`)
- Modify: `apps/server/src/testing/station-printing.ts` (the venue half and its comment go)
- Test: `packages/venue-service/src/kitchen-notices.test.ts` (describes `:1512`, `:1551`, `:1583`
  deleted), `routes.test.ts` (describes `:2524`, `:2594`, `:2665` deleted; `"the venue's service
  settings"` `:2451` expects a body without the three keys; the routing view's expected body
  loses `printMovedSlips`), `service.test.ts` (the seat's member list),
  `apps/server/src/split-off-extras.release.test.ts:120`

- [ ] **Step 1: Change the tests first:** the deletions above; `routes.test.ts`: add
  `"no longer serves the venue's printing settings"` — the three PUT routes answer 404 for a
  manager with `venue.configure`; `split-off-extras.release.test.ts:120`'s
  `expect(await readPrintHeldWork(tx)).toBe(true)` becomes a read of the stations' `print_held_work`
  (all true).
- [ ] **Step 2: Run and watch the new case fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/routes.test.ts -t "printing settings"`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts src/routes.test.ts src/service.test.ts`,
  `pnpm --filter @waitron/module exec vitest run`, and every file Task 32 touched in one
  `pnpm --filter @waitron/server exec vitest run <files>` — PASS. Then
  `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts`;
  `git grep -n -E 'readPrintHeldWork|readPrintMovedSlips|readKitchenTicketGrouping|writePrintHeldWork|writePrintMovedSlips|writeKitchenTicketGrouping|print-held-work|print-moved-slips|kitchen-ticket-grouping' -- apps packages`
  prints nothing.
- [ ] **Step 5:** typecheck `@waitron/module`, `@waitron/venue-service`, `@waitron/server`;
  prettier; commit `git commit -s -m "venue-service stops serving the venue's printing settings (A756 PR 6)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1): the three describes of each test file deleted; the settings
GET body and the routing view's body lose keys; `split-off-extras.release.test.ts:120` reads the
stations (the setting moved, the value it checks is the same).

### Task 39: drop the three venue columns; one venue-service migration

**Files:**
- Modify: `packages/venue-service/src/schema/settings.ts` (`:5-7`, `:17-22`, `:26`; the comment
  `:17` goes with its column)
- Create (generated): `packages/venue-service/drizzle/NNNN_retire_venue_printing_choices.sql`,
  snapshot and journal, by `pnpm --filter @waitron/venue-service db:generate --name retire_venue_printing_choices`
- Test: `packages/venue-service/src/schema/service.test.ts:191-194`,
  `packages/venue-service/src/kitchen-allergy.upgrade.test.ts:247-250` (Decision 7),
  `packages/venue-service/src/migrations.test.ts`

- [ ] **Step 1: Write the failing test** in `migrations.test.ts`: `"the venue keeps no ticket
  grouping, held printing or MOVED slips of its own"` — `pragma table_info(service_settings)`
  names only `id` and `edit_sent_lines`.
- [ ] **Step 2: Run and watch it fail.** `pnpm --filter @waitron/venue-service exec vitest run src/migrations.test.ts`
- [ ] **Step 3: Edit and generate.** Read the SQL: Decision 1's rebuild, whose `INSERT … SELECT`
  names only `id` and `edit_sent_lines`; anything else is a stop. Re-run before generating: the
  `REFERENCES` and trigger searches of Decision 1 print nothing. Update the two pins of Decision 7.
- [ ] **Step 4: Run** Step 2's command — PASS; then
  `pnpm --filter @waitron/venue-service exec vitest run src/schema src/kitchen-allergy.upgrade.test.ts src/department-receipts.upgrade.test.ts src/order-kitchen-notes.upgrade.test.ts src/party-allergy.upgrade.test.ts src/classification.test.ts`;
  the guards of Task 29's Step 5 (the walk now reports Decision 1's `345 steps` and `230 tables`
  if `main` has not moved, else two steps and one table more than `main`);
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`;
  `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts src/configuration-transfer.test.ts src/configuration-import.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run` — PASS.
- [ ] **Step 5:** typecheck `@waitron/venue-service`; prettier; commit
  `git commit -s -m "Drop the venue's ticket grouping, held printing and MOVED slips; one migration (A756 PR 6)"`,
  then update the ledger.

**Assertions changed** (the columns are dropped): `service.test.ts`' check list loses
`service_settings_kitchen_ticket_grouping_ck`; the upgrade test's `laterColumnDrops` entry (a
hand-kept list, Decision 7).

### Task 40: a look at the station editor and the Kitchen tab in real Chromium

**Files:** throwaway tests in `packages/venue-service/src/dashboard/` (deleted, never committed);
pictures and notes outside the worktree, in `/Users/clintongormley/waitron-campaign-c/a756-6-shots/`
and `/Users/clintongormley/waitron-campaign-c/a756-6-look-report.md`, as PR 5's Task 27 did.

- [ ] **Step 1:** Mount `prep-stations-screen` with the `api()` fixture of
  `prep-stations-screen.test.ts` (its `bar` station with `ticketGrouping: "separate"`,
  `printHeldWork: true`, `printMovedSlips: false`). For EN and ES (`setLocale("es")`), light and
  dark, at `page.viewport(1280, 900)` and `page.viewport(390, 900)`: Edit on `bar` as opened (Save
  quiet), scrolled so the three printing fields show; the ticket grouping list opened; Add station
  as opened. Then mount `dashboard-venue-service-settings` (`subject="kitchen"` as
  `packages/venue-service/src/dashboard/index.ts` renders it) at both widths, light and dark, EN
  and ES: only Changes after sending. Read and record `window.innerWidth` inside each test.
- [ ] **Step 2:** Look at every picture: the new combobox and switch line up with the fields
  above them at both widths, their labels whole in both languages, the switch's note under it as
  the rest-of-order note sits; the ticket grouping list's longest choice ("A line each: 1 x Burger,
  three times", "Una por plato: 1 x Hamburguesa, tres veces") fits at 390; no sideways scroll
  (`document.documentElement.scrollWidth` equals the viewport width); the Kitchen panel shows no gap
  where the three settings were; dark is readable. A defect found is fixed with a failing test
  first, in the component's own test file, and committed.
- [ ] **Step 3:** Delete the throwaway tests; `git status` shows them gone. Update the ledger with
  the look report's path and any defect found.

### Task 41: guides, design notes, audits and the backlog

**Files:** `apps/server/src/guide/en/kitchen-service.md` (`:52-58`, `:88-97`),
`apps/server/src/guide/es/kitchen-service.md` (the `{#held-work}` section, `:101-111`),
`docs/developers/design-system.md` (`:2896`, `:4617-4622`), `docs/backlog/kitchen.md` (`:149`,
Open points; the A725 entry `:384-386`), `docs/backlog.md:1571`,
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md` (`:69`, `:170`),
`docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md` (after `:263`),
`docs/operations/a760-migration-squash-inventory.md` (after `:382`)

- [ ] **Step 1: The guides.** EN `:88-92`: "…prints a **MOVED** slip when its **Print a slip when
  sent dishes move table** setting is **Print**; the food stays…" (the "or follows the venue's
  **Print MOVED slips**" clause goes). ES `:101-105` likewise ("…si su ajuste **Imprimir un aviso
  al cambiar de mesa los platos enviados** es **Imprimir**; los platos siguen…"). The paragraph at
  EN `:94-97` gains: "Each prep station also sets how identical dishes print on its tickets and
  whether it prints held groups in advance, under **Identical dishes on a kitchen ticket** and
  **Print held groups in advance**." ES `:107-111`: "Cada estación de preparación fija también cómo
  se imprimen los platos iguales en sus comandas y si imprime por adelantado los grupos en espera,
  en **Platos iguales en una comanda de cocina** e **Imprimir por adelantado los grupos en espera**."
  The `{#held-work}` sections (EN `:52`, ES its twin) gain one sentence: EN "Only a station set to
  **Print held groups in advance** receives a HOLD ticket, and only that station receives the
  corrections to it and the ticket marked FIRE." ES "Solo una estación con **Imprimir por adelantado
  los grupos en espera** recibe una comanda HOLD, y solo esa estación recibe sus correcciones y la
  comanda marcada FIRE." (The labels are Task 36's strings.) Run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2: design-system.md.** `:2896` "Rest-of-order, MOVED slips and a station's three
  late-flag minutes" → "Rest-of-order, MOVED slips, identical dishes, held printing and a station's
  three late-flag minutes". `:4617-4622`: after "Print a slip when sent dishes move table" add
  ", then "Identical dishes on a kitchen ticket" and "Print held groups in advance" with its
  note"; "The slip choices are "Venue setting: Print" (or "Venue setting: Don't print"),
  "Print" and "Don't print"; choosing the venue setting again sends null." → "The slip choices
  are "Print" and "Don't print"." `git grep -n -i -E 'kitchen ticket grouping|print held|MOVED
  slips' docs/developers/design-system.md` for any Kitchen-tab description of the three; each hit
  is updated.
- [ ] **Step 3: Audits and inventories, dated pointers only.** Personal-data audit `:69`
  (`kitchen_stations`): append "**2026-10-23 (A756 PR 6):** `ticket_grouping` and
  `print_held_work` added." `:170` (`service_settings`): `kitchen_ticket_grouping`,
  `print_held_work` and `print_moved_slips` each gain "(dropped 2026-10-23, A756 PR 6)", as
  `release_reminder_minutes` reads. Retention inventory, after `:263`: "**2026-10-23:** A756 PR 6
  added core table `order_group_hold_stations` (core migration NNNN), which adds
  `order_group_hold_stations(group_id)` to `order_groups`' incoming closure and
  `order_group_hold_stations(station_id)` to `kitchen_stations`'; not yet given a retention row."
  A760 inventory, after `:382`: "**2026-10-23 (A756 PR 6):** core NNNN adds
  `order_group_hold_stations` and two `kitchen_stations` columns; venue-service NNNN drops three
  `service_settings` columns by a rebuild. A squash writes the end state." (NNNN are Tasks 29 and
  39's generated numbers.)
- [ ] **Step 4: The backlog.** In `docs/backlog/kitchen.md`'s A756 detail delete the PR 6 bullet
  (`:149`; PRs 7–8 and the Kitchen tab's removal stay). The A725 entry's "offers "Venue setting:
  Print" or "Venue setting: Don't print", "Print", and "Don't print"" (`:384-386`) is kept and
  gains "**2026-10-23 (A756 PR 6):** the choice is the station's own: Print or Don't print." Add open
  points: "From PR 6: A773's picture 10 draws Held courses as a dropdown, "Print when sent"; PR 6
  uses the switch "Print held groups in advance" the Kitchen tab had. Ask the owner whether
  picture 10's wording replaces it." "From PR 6: picture 10 lists Identical dishes and Held courses
  above MOVED slips; PR 6 puts them after it, the editor's built order." "From PR 6: Add station
  sets none of a station's printing choices; a new station starts at one line, no held printing,
  MOVED slips printed." In `docs/backlog.md`'s A756 entry say "PRs 1–5 landed (#1852, #1854,
  #1858, #2020, #2023); PR 6 is in review; PRs 7–8 are buildable. Open points are in the detail."
- [ ] **Step 5: Missed claims.**
  `git grep -n -i -E 'venue setting: (print|don.t print)|Print MOVED slips|print held groups in advance|identical dishes|kitchen_ticket_grouping|print_held_work|readPrintHeldWork|ajuste del local: |avisos MOVIDO' -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide README.md 'packages/*/README.md'`
  — each hit is rewritten here, is a dated pointer of Step 3 or 4, or is history in a dated plan or
  spec (left alone). `pnpm exec prettier --file-info <file>` on each changed doc (`docs/` is ignored
  whole), and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 6: The PR description and the ledger** both name:
  - **every changed test check**, from each task's "Assertions changed", and the setup moves of
    Tasks 29 and 32;
  - **the default and reset decision**: every station starts at one line, no held printing and
    MOVED slips printed, a station left as "Venue setting" now prints MOVED slips, the venue values
    are dropped, not copied, a group held before the upgrade is treated as having no HOLD paper,
    and no venue reset is needed (Decisions 1 and 2);
  - **held paper per station** (Decision 5) and the new table: a recorded station keeps getting its
    HOLD paper whatever its later choice, an unrecorded one prints its part at the fire, and
    notices are unchanged;
  - **no configuration format change** and why (Decision 6);
  - **the departures from A773's picture 10** (Decision 9).
- [ ] **Step 7: Commit** `git commit -s -m "Guides and backlog: each station sets its own ticket grouping, held printing and MOVED slips (A756 PR 6)"`,
  update the ledger to `Status: done` for PR 6's build, then `/finish-branch` with this plan's path
  as its note.

## PR 7 — Done on the screen on each station

Planned 2026-10-24, after PR 6 landed (#2031). Branch `feat/a756-7-bump-mode-per-station`,
worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a756-7-bump-mode-per-station`,
cut from `main` at `97a8b7699`. Ledger for PR 7: `~/waitron-campaign-c/item-a756-ledger.md`, the
one PRs 4–6 used; every task ends by updating it (done, changed test checks, next step).
**Review path: FULL** — a core migration, a change to what the station routes and every station
queue answer (read by venue-service's dashboard and the till), the till's start read losing a
field, and a configuration import check. Implementers are dispatched as
`subagent_type: "implementer"`.

**Goal.** Whether a kitchen screen marks preparation done one item at a time or a whole ticket at
once ("bump mode": `line` or `ticket`) stops being one venue-wide value on the Kitchen tab and
becomes each prep station's own choice, set in the station editor under "Done on the screen". A new
station starts at one item at a time. Each order on a kitchen screen follows its own station's
choice, including in the merged view that shows several stations' orders in one queue. The Kitchen
tab loses its core panel and keeps venue-service's "Changes after sending" (PR 8 moves it). The
till's start read stops carrying the venue's mode. `locations.bump_mode` stays in the database,
read and written by nothing, for A760's migration squash.

**Files it touches.**
- shared: `packages/shared/src/bump-mode.ts` (new) and its test, `src/index.ts`.
- db: `src/schema/kitchen-stations.ts`, `src/schema/tenants.ts` (comments only),
  `src/configuration-transfer.ts`, a generated core migration in `drizzle/`, and the tests
  `src/schema/kitchen-stations.test.ts`, `src/configuration-transfer.test.ts`.
- server: `src/kitchen.ts`, `src/management-api.ts`, `src/working-order.ts`, `src/till-setup.ts`,
  and the tests named in Tasks 42–49b.
- provisioning: `src/configuration-transfer.ts`, `test/configuration-bundle.ts`.
- till: `src/api/client.ts`, `src/widgets/station-queue.ts`, `src/screens/till-station-screen.ts`,
  `src/till-app.ts`, and the tests and helpers named in Tasks 46a, 46b and 50.
- venue-service dashboard: `station-editor.ts`, `routing-client.ts`, `prep-stations-screen.ts`,
  `strings.ts`, with their tests and fixtures.
- dashboard app: `src/dashboard-app.ts`, `src/screens/kitchen-screen.ts` and its five suites
  (deleted), `src/api/client.ts`, `src/api/live-queries.ts`, `src/i18n/strings.ts`, and the suites
  named in Tasks 48a–48c.
- docs: the guides `apps/server/src/guide/{en,es}/kitchen-service.md`,
  `docs/developers/design-system.md`, `docs/developers/conventions-ui.md`, `docs/backlog.md`,
  `docs/backlog/kitchen.md`, the A664 personal-data audit and the A760 inventory (one dated pointer
  each).

### PR 7 decisions (each with its receipt)

1. **Storage: one column added to `kitchen_stations`; `locations.bump_mode` is left in place; one
   migration, no venue reset.** `kitchen_stations` gains `bump_mode` (`label`,
   `.$type<BumpMode>()`, NOT NULL, default `'line'`), with no CHECK, for the reason PR 6 gave for
   `ticket_grouping` (`packages/db/src/schema/kitchen-stations.ts:29-30`: "a CHECK would rebuild
   this table"). The values come from a new `BUMP_MODES` in `@waitron/shared`, beside
   `TICKET_GROUPINGS` (`packages/shared/src/index.ts:213`).
   **Measured 2026-10-24** in a scratch copy of this worktree (`cp -c -R` to
   `/tmp/a756-7-scratch.cZjB/w`, its `.git` pointer removed; a second copy, `control`, unchanged
   for the walk; a third for the `locations` probe below; all deleted afterwards), with `bump-mode.ts` added and the column declared after
   `printHeldWork` (`kitchen-stations.ts:31`):
   - `pnpm db:generate --name station_bump_mode` in `packages/db` wrote
     `drizzle/0188_station_bump_mode.sql` holding exactly
     ``ALTER TABLE `kitchen_stations` ADD `bump_mode` text DEFAULT 'line' NOT NULL;`` — no
     `__new_` table, so `kitchen_stations` is not rebuilt.
   - `pnpm exec vitest run scripts/migration-upgrade.test.ts` passed (`Tests 4 passed (4)`) and
     reported `346 steps` and `230 tables hold rows after the last step`; the same run in the
     unchanged copy reported `345 steps` and `230 tables` — the control that the walk applied the
     new step (a column adds no table).
   - `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts scripts/apply-migrations-callers.test.ts scripts/id-columns-are-references.test.ts scripts/column-vocabulary.test.ts`
     printed `Test Files 11 passed (11)`, `Tests 576 passed (576)`. Control: in the unchanged copy
     with only the schema edit (no migration), `scripts/migrations-match-schema.test.ts` failed
     (`Tests 1 failed | 18 passed (19)`), so the guard does see the column.
     `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` printed
     `Tests 2 passed (2)`; `pnpm --filter @waitron/composition exec vitest run` `Tests 125 passed (125)`.
   - `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts src/station-order-migration.test.ts src/draft-line-place-upgrade.test.ts src/printer-pickup-upgrade.test.ts`
     printed `Tests 1 failed | 7 passed (8)`: canvas-retirement's "refuses the populated
     predecessor for reset and retains every row after rollback" failed with `table
     kitchen_stations has no column named bump_mode` (its fill calls today's `createStation`, whose
     drizzle insert names every column). With `"_station_bump_mode"` added to its predecessor list
     beside `"_station_printing_choices"` (`:394-398`), and `Station`/`listStations` reading the
     column as Task 43 will, the two files printed `Tests 1 failed | 5 passed (6)`: now
     `station-order-migration.test.ts` failed (`no such column: "bump_mode"`), because its last
     step applies the core set only up to `_station_printing_choices` (`:239`) before calling
     `listStations` (`:241`). With a `bump` journal lookup beside `printing` (`:40-43`) and
     `|| when === bump.when` added to that step, they printed `Tests 6 passed (6)`. Both edits are
     Task 42's (Decision 7).
   **No venue reset**: the walk passed with rows in every table, and no shipped migration file is
   edited. 0188 was free on `97a8b7699`; `feat/a739-payment-window` (parked) carries core
   migrations numbered 0184–0186, which already collide with `main`'s
   (`0184_purchase_supplier_year` … `0186_retire_kitchen_timing_tables`), so whichever lands second
   regenerates (Global Constraints).

   **`locations.bump_mode` stays, unread and unwritten, until A760's squash.** Measured in the third
   scratch copy: with the column and its CHECK `locations_bump_mode_ck`
   (`packages/db/src/schema/tenants.ts:84`, `:98`) taken out, `pnpm db:generate` wrote a rebuild
   — `CREATE TABLE __new_locations`, `INSERT … SELECT`, ``DROP TABLE `locations` ``, `RENAME` — not a
   column drop. `git grep -h -i -o -E 'references `locations`' -- 'packages/*/drizzle/*.sql' | wc -l`
   prints 62, in 36 files. A rebuild on this engine runs with foreign keys on, so its `DROP TABLE`
   deletes every cascading child's rows and fails on a `no action` child holding rows (CLAUDE.md
   §3), so it is not done here. The column's doc comment (`tenants.ts:21-26`) is replaced by
   "Read by nothing: each station has its own `bump_mode`. Dropping this column rebuilds
   `locations`, so A760's squash removes it." After this PR nothing writes it but a new
   `locations` row's default: its two writers, `setBumpMode` (`apps/server/src/kitchen.ts:229-231`,
   the PUT route) and a configuration import's `applyPreparedLocation`
   (`packages/provisioning/src/configuration-transfer.ts:155-167`), both go (Tasks 49a, 49b).
   No guard pins writes to `locations`: `scripts/write-path-tables.json` lists `deployment`,
   `mirror_config`, `node_roles`, `nodes` and `tenants` only, and `git grep -n -i bump -- scripts`
   prints nothing.

2. **What each existing station reads: the column default, `line`; the venue's value is dropped,
   not copied** (CLAUDE.md §3, "No backwards-compatibility or data-migration code until Waitron is
   in production"; PR 4's Decision 1, PR 5's Decision 2 and PR 6's Decision 2 did the same). A venue
   that never changed the Kitchen tab sees no change: `line` is today's venue default
   (`tenants.ts:84`). **Measured 2026-10-24**, Node v26.11.1 `node:sqlite`, every core migration up
   to 0187 then the probe's 0188, applied in journal order by a throwaway script (since deleted): a
   location with `bump_mode = 'ticket'` and a station `Bar` printed `before
   0188_station_bump_mode venue: ticket station has column: false` and `after
   0188_station_bump_mode venue: ticket station: line`. A copy would have printed `station:
   ticket`. **A new station starts at `line`** (A773 §7.1, "A new station starts with sensible
   defaults"): `createStation` leaves the column to its default, as it does `ticket_grouping`
   (`apps/server/src/kitchen.ts:78-122`); Add station sets no bump mode (it sets none of the
   station's screen or printing choices today); provisioning's first station
   (`packages/provisioning/src/venue-apply.ts`) and an import that omits the column take the
   default too.

3. **Validation at the station routes.** PATCH `/management-api/stations/:id` accepts `bumpMode`,
   `"line"` or `"ticket"`, checked by a `parseBumpMode` beside `parseTicketGrouping`
   (`apps/server/src/management-api.ts:366-371`) with `isBumpMode` from `@waitron/shared`; anything
   else, `null` included, is refused `management.request_invalid { field: "bumpMode" }`, today's
   code for a bad station field. The editor does not map this refusal to the field:
   `stationRefusalField` (`packages/venue-service/src/dashboard/station-editor.ts:164-183`) and the
   `Field` type (`:70`) know name, colour, printers and the minutes only, as they do not know
   `ticketGrouping` either, and `refusalText` (`:185`) has no string for it. Following PR 6's
   ticket-grouping precedent, this PR adds none: a two-choice dropdown cannot send another value,
   and the route's check is tested server-side (Task 43); any such refusal shows as the generic
   save error above the buttons. A refused
   PATCH writes nothing (`updateStation` validates before its one `update`,
   `apps/server/src/kitchen.ts:164-213`). POST is unchanged (Decision 2).

4. **The station's answer and the queue's.** `Station` (`apps/server/src/kitchen.ts:28-43`) gains
   `bumpMode: BumpMode`, read in `listStations` (`:124-147`); it reaches venue-service's dashboard
   (`GET /management-api/stations`, `PrepStation`, `routing-client.ts:29-42`) and the till's
   `GET /api/stations` (`listStationsToday`, `till-api.ts:2157-2162`) and
   `device-api.ts:674`. The screen does **not** read it there. **Each order in a station's queue
   carries its station's mode** (`StationQueueGroup.bumpMode`, `working-order.ts:7285-7305`), read
   in the same join that already gives each order its station's late flags (`listStationQueues`,
   `:7510`, selecting `kitchenStations.bumpMode` beside `:7544-7547`, set beside `thresholds` at
   `:7655`). That is PR 5's precedent: "An order is aged by its oldest line against its own
   station's thresholds" (`apps/till/src/widgets/station-queue.ts`, the class comment), and
   `thresholds` rides on every order "so the widget can re-derive … locally"
   (`apps/till/src/api/client.ts:1663-1666`). Both screens' reads are built from
   `listStationQueues`: the operator's `GET /api/stations/:id/queue` (`till-api.ts:2165-2179`) and
   the enrolled screen's `GET /api/device/station-screen` (`device-api.ts:533-578`, through
   `stationScreenSlots`, `:1007-1034`), so neither route changes. **Why per order:** one
   `till-station-queue` draws several stations' orders. Read: the merged view builds one queue from
   every drawn station, tagging each order with its `stationId`
   (`apps/till/src/screens/till-station-screen.ts:886-922`), and the widget already takes the
   station of a bump from the order (`group.stationId ?? this.stationId`,
   `station-queue.ts:636-658`). Run on `97a8b7699`:
   `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts -t "merged view"`
   printed `Tests 13 passed | 206 skipped (219)`, among them "merged shows one queue, oldest
   first, each order labelled by its station", which finds exactly one `till-station-queue` whose
   orders are `[["wo-2","st-2"],["wo-1","st-1"]]`. A single mode on the widget cannot serve that
   queue. The widget's `bumpMode` property goes; it reads `group.bumpMode` in `#bump` and
   `#bumpLabel` (`:1154-1157`). Nothing on the server reads the mode for a bump: the whole-ticket
   route accepts a bump at any station, as today (`git grep -n -E 'bumpMode|bump_mode' -- apps/server/src ':!*.test.ts'`
   lists only `kitchen.ts`, `till-setup.ts` and the format-1 JSON fixture; it is case-sensitive,
   and `management-api.ts` names the mode only as `getBumpMode`, `setBumpMode` and `BumpMode`, in
   its imports `:93-102` and the two venue routes `:1714-1735` — no advance route reads it),
   because "the per-line ticket-item state is always the source of truth" (`kitchen.ts:225-226`).
   With the queue's 35 server suites run in the probe with the key added
   (`git grep -l -E 'listStationQueues?\(|/queue"|station-screen' -- 'apps/server/src/*.test.ts'`,
   35 files) every one passed (`Tests 2007 passed (2007)`) — no whole-shape pin sees the key, so
   Task 44's new cases are the only checks that it is there. With `bumpMode` added to `Station`,
   two cases in `kitchen.test.ts` failed ("defaults isDefault to false and lists active stations
   by name", `:212`, and "updateStation renames but cannot reactivate a removed station", `:341`):
   whole-shape pins that gain the key with every value unchanged; `management-api.test.ts`,
   `device-api.test.ts`, `till-api.test.ts`, `station-queue-rest.test.ts`,
   `till-api.station-today.test.ts`, `configuration-transfer.test.ts` and
   `configuration-import.test.ts` passed (`Tests 797 passed`, with the two failures).

5. **The till stops taking a bump mode from its start read.** Today the venue's mode travels
   `till-setup.ts:36-42`, `:98` → `TillSetup.bumpMode` (`apps/till/src/api/client.ts:173-177`) →
   `till-app.ts:9563` (state `:2951-2952`) → `.bumpMode` on both station-screen mounts (`:17877`,
   `:18081`) → `till-station-screen.ts:207`, `:919`, `:1112` → the widget (`:618`). All of it goes.
   The setup answer loses `bumpMode`, and `readSetupFields` loses its `locations` select, which read
   nothing else (`till-setup.ts:36-42`), and that half of its unreachable guard (`:81-86`). A
   changed station mode now reaches an open kitchen screen at its next queue read, every
   `REFRESH_MS` (15 s, `till-station-screen.ts:52`, started at `:344` in both modes) — including an
   enrolled kitchen screen, which never refreshed its setup (backlog A785, "Its bump mode never
   refreshes": nobody signs in, so no menu-state poll runs). Task 46b's failing case runs that.
   Setup fixtures in till suites carry `bumpMode` beside a `fireControl` that has had no type since
   #1944; this PR removes the `bumpMode` lines (Task 50, setup) and leaves `fireControl` to A773-2,
   which removes `locations.fire_control`.

6. **Configuration copies: the new column travels, the venue's mode leaves the copy, the format
   stays 7.** `kitchen_stations` is exported whole (no `omit`, `packages/db/src/configuration-transfer.ts:24-29`),
   so `bump_mode` travels with no transfer code. The import refuses a value outside `BUMP_MODES`
   before any row is written, `setup.request_invalid { field: "kitchen_stations.bump_mode" }`,
   beside the ticket-grouping check (`validateCoreConfiguration`, `:4-12`). The venue's mode leaves
   `PreparedVenue.location` (`packages/provisioning/src/configuration-transfer.ts:56`), the export's
   select (`:95`), the required location strings (`:517-526`) and `applyPreparedLocation`'s update
   (`:163`), so an import no longer writes `locations.bump_mode`. **No format bump**, for PR 6's
   reason (its Decision 6): the bump rule covers retired tables, whose key an older file always
   carries (`docs/developers/conventions-data.md:1605-1628`). A file exported before this PR names
   one fewer core migration than the target and is refused `setup.request_invalid { field:
   "module:core" }` before any table is read: `validateConfigurationBundle` compares every
   module's version (`packages/provisioning/src/configuration-transfer.ts:590-603`), and
   `apps/server/src/configuration-import.test.ts:892` ("refuses a bundle exported before the
   routing grid by its venue-service version") pins that a module's version is its journal's
   length — run for venue-service, read for core; Task 49b adds the core case. A current file that
   still carries `venue.location.bumpMode` is accepted and the key ignored, as a `tillName` is
   ("accepts a bundle that still carries a tillName, as it checks only the venue fields it
   names", `apps/server/src/configuration-transfer.test.ts:480`). The format-1 fixture
   `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:22` still
   names `bumpMode` and is left as it is (a format-1 file is refused before any table is read; A757
   slice 1's Decision 9).

7. **Hand-kept lists and pins.**
   - `apps/server/src/canvas-retirement-upgrade.test.ts:394-398`: the predecessor list gains
     `"_station_bump_mode"` (Decision 1, measured).
   - `apps/server/src/station-order-migration.test.ts`: a `bump` journal lookup beside `printing`
     (`:40-43`) and its last step `setsAsOf("printing", (when) => when <= retirement.when || when === printing.when || when === bump.when)`
     (`:239`) (Decision 1, measured). Its snapshot check runs before that step and is unchanged.
   - `packages/db/src/schema/kitchen-stations.test.ts:121`'s bare-insert case gains a check of the
     new column's default (an added check; no existing one changes; named in the ledger).
   - The two `kitchen.test.ts` whole-shape pins gain `bumpMode: "line"` (Decision 4).
   - Not changed: `station-delete.test.ts` and `management-api.station-disable.test.ts` pin
     tables, not columns; `scripts/migration-upgrade.test.ts` (no `CANDIDATES`, `ONE_ROW` or
     `RESETS` entry names either column; the walk passed untouched); `clear-provision-fixture.ts`.

8. **The UI.** The station editor gains "Done on the screen", a `wt-combobox`
   (`name="bumpMode"`, `search="never"`) offering "One item at a time" and "Whole ticket at once",
   placed right after the late-flags fieldset and before "Also list the order's dishes from other
   stations" — picture 10's order (Late after, then Done on the screen), and it leaves the check
   that MOVED slips comes "right after the rest-of-order switch" (`station-editor.test.ts:550`)
   true. **The words are the mock-ups', not the Kitchen tab's** ("Bump mode", "Per item", "Whole
   ticket", `apps/dashboard/src/i18n/strings.ts:1267-1269`): A773 §7.1 names the setting "done on
   the screen", and the owner-approved pictures 04 (A756) and 10 (A773) both label it "Done on the
   screen", 04 with the choices "One item at a time" and "Whole ticket at once". Spanish, new text:
   «Marcado en la pantalla», «Un plato cada vez», «Toda la comanda a la vez» (coordinator's
   ruling of 2026-10-24: "plato" as the station editor's own strings say it, e.g.
   `prep.health.empty`, `packages/venue-service/src/dashboard/strings.ts:1120`, and as the Spanish
   guide does, `apps/server/src/guide/es/kitchen-service.md:118`, "si se marca como listo cada
   plato o la comanda completa"; "Hecho" would clash with «Hecho aquí», `strings.ts:1244`). The
   till's own button stays "Avanzar comanda", `apps/till/src/i18n/strings.ts:2401`. This differs from PR 6,
   which kept the Kitchen tab's built words: there the built control (a switch) differed from the
   picture's (a dropdown); here both pictures and the spec name the setting, and "Bump mode" is
   kitchen jargon. Task 52 records the wording as an owner FYI, built as above, not a blocker. Keys
   `prep.bump_mode`, `prep.bump_mode.line`, `prep.bump_mode.ticket`, EN and ES, in
   `packages/venue-service/src/dashboard/strings.ts` beside `prep.ticket_grouping*` (`:307-310`,
   ES `:1193-1196`). No hint. Save sends only what changed (`sendable`, `station-editor.ts:429-454`)
   and keeps the A331 rule it already follows (`draftScopeFor` `:358`, `saveActionState` `:465`,
   `:526`); field primitives only. **Add station gains no field** (Decision 2).

9. **The Kitchen tab: its core panel goes; the tab stays with venue-service's panel alone.**
   Fire control left the Kitchen tab in #1944 (`git log -S getFireControl -- apps/dashboard/src/api/client.ts`
   names `509e8d42a`); `kitchen-screen.ts` draws only the bump buttons (`:100-111`), and
   `git grep -n -i firecontrol -- apps/dashboard/src ':!*.test.ts'` prints nothing (six suites keep
   a dead `getFireControl` stub, removed beside each `getBumpMode` stub in Task 48c). So the bump
   mode is the core panel's last control, and this PR removes the `kitchen` entry of
   `CORE_SETTINGS_PANELS` (`apps/dashboard/src/dashboard-app.ts:337-345`, import `:85`),
   `kitchen-screen.ts` and its five suites. (The "Kitchen tab itself goes" paragraph above
   expected fire control to be the core panel's last control; its buttons left with #1944, so the
   core panel goes here.) The tab itself stays: venue-service's `venue-service-kitchen` panel still holds "Changes after sending"
   (`packages/venue-service/src/dashboard/index.ts:140-157`,
   `service-settings-panel.ts:130-144`), which PR 8 moves; `VENUE_SETTINGS_TABS`
   (`venue-settings-screen.ts:11`) keeps `kitchen`, and a tab shows only when a panel on it is
   visible (`#tabs`, `:56-58`). Who then sees Kitchen: venue-service's panel shows to a session
   holding `venue_service.manage` or `venue.view` (`requiresPermission` and `readPermission`,
   `index.ts:145-146`, read by `#mayRead`, `dashboard-app.ts:1481-1486`) and is editable with
   `venue_service.manage`. Every role but staff holds `venue.view` (supervisor, and manager and
   admin through it, `packages/identity/src/permissions.ts:45-54`, admin holding every
   permission), and staff are sent to My schedule before Venue settings (`#permittedScreen`,
   `dashboard-app.ts:1941`), so no real session loses the tab while venue service is on. A venue
   without venue service loses Kitchen and keeps Venue details, whose core panels need
   `venue.view`; before, its Kitchen tab held only the bump buttons. A session that sees no panel
   at all (only test stubs with no permissions) gets the heading and no tabs, which the page
   already draws (`venue-settings-screen.ts:96-99`). Six `dashboard-app*.test.ts` cases and the leave-check
   suite relied on the core panel; Tasks 48a and 48b move them, each with its reason.

10. **Error codes.** None added or removed: refusals are `management.request_invalid` and
    `setup.request_invalid` with a `field`, both registered.

11. **Overlaps.** `feat/a696-startup-zone-validation` (parked) touches `dashboard-app.ts`
    (`@@ -955`…`@@ -1194`), `working-order.ts` and provisioning's `configuration-transfer.ts`;
    `feat/a739-payment-window` (parked) touches `dashboard-app.ts` (`@@ -101`, `@@ -150`, `@@ -303`,
    `@@ -1718`, `@@ -1941`, `@@ -2603`), `till-setup.ts` (`@@ -7`, `@@ -106`), `working-order.ts`
    (`@@ -6733`), `till-app.ts` (`@@ -14`) and core migrations; `feat/a841-8-logo-screens` touches
    `dashboard-app.ts` (`@@ -40`, `@@ -186`, `@@ -1750`). None is a hunk this plan edits
    (`git diff -U0 $(git merge-base main <branch>) <branch>` over the files above, 2026-10-24);
    whichever lands second rebases, and a739 regenerates its migrations.

### PR 7 review focus

1. **A merged kitchen screen holding a whole-ticket station and a per-item station**: tapping the
   first's order bumps the whole order there (`advance-ticket`, "Advance ticket #N"); tapping the
   second's advances one dish (`advance-ticket-item`, "Advance #N") (Task 46b).
2. **A manager changes a station's mode while an enrolled kitchen screen is open**: the next
   queue read (15 s) changes how that station's orders bump, with nobody signed in (Task 46b).
3. **PATCH `bumpMode: null` or `"Ticket"`**: 400 `management.request_invalid { field: "bumpMode" }`,
   nothing written (Task 43).
4. **An imported station row with `bump_mode: "bogus"`**: refused before any row is written; a
   current file carrying `venue.location.bumpMode` is accepted and the target venue's column is
   not written (Tasks 45, 49b).
5. **Venue settings for a venue without venue service**: no Kitchen tab, Venue details kept, and
   an address naming `kitchen` opens Venue details (Task 48b).

### Task 42: storage — the station's bump mode column, one core migration

**Files:**
- Create: `packages/shared/src/bump-mode.ts` (modelled on `ticket-grouping.ts`),
  `src/bump-mode.test.ts`; modify `packages/shared/src/index.ts` (after `:213`)
- Modify: `packages/db/src/schema/kitchen-stations.ts` (import `:1`; after `:31`),
  `packages/db/src/schema/tenants.ts:21-26` (comment only, Decision 1's words)
- Create (generated): `packages/db/drizzle/NNNN_station_bump_mode.sql`, its snapshot and journal
  entry, by `pnpm --filter @waitron/db db:generate --name station_bump_mode` — never numbered or
  edited by hand; on a number collision reset `packages/db/drizzle` to `main` and regenerate (as
  PR 5's Task 26)
- Modify (Decision 7): `apps/server/src/canvas-retirement-upgrade.test.ts:394-398`,
  `apps/server/src/station-order-migration.test.ts` (`:40-43`, `:239`)
- Test: `packages/db/src/schema/kitchen-stations.test.ts`

**Interfaces — produces:**
- `export const BUMP_MODES = ["line", "ticket"] as const;`
  `export type BumpMode = (typeof BUMP_MODES)[number];`
  `export function isBumpMode(value: unknown): value is BumpMode` (`@waitron/shared`).
- `kitchenStations.bumpMode` (`label("bump_mode").$type<BumpMode>().notNull().default("line")`,
  with the comment "The station routes and the import refuse a value outside `isBumpMode`; a CHECK
  would rebuild this table.").

- [ ] **Step 1: Write the failing tests.**
  - `bump-mode.test.ts`: `BUMP_MODES` `toEqual(["line", "ticket"])`; `isBumpMode` true for each,
    false for `"Line"`, `""`, `null`, `1` (shared is mutation-tested).
  - `kitchen-stations.test.ts`: the bare-insert case at `:121` (renamed `"…, leaves MOVED slips
    null and is done one item at a time"`) also reads `bumpMode` `"line"`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/shared exec vitest run src/bump-mode.test.ts` and
  `pnpm --filter @waitron/db exec vitest run src/schema/kitchen-stations.test.ts`.
- [ ] **Step 3: Implement and generate.** Read the SQL: exactly Decision 1's one `ALTER TABLE … ADD`
  line; a `__new_` table is a stop.
- [ ] **Step 4: The two upgrade suites** of Decision 7.
- [ ] **Step 5: Run** (free memory first) Step 2's commands; the guards
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts scripts/column-vocabulary.test.ts`
  (expected: one step more than on `main`, the same number of tables holding rows — Decision 1's
  346 and 230 if `main` has not moved); `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`;
  `pnpm --filter @waitron/db exec vitest run src/schema src/classification.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/canvas-retirement-upgrade.test.ts src/station-order-migration.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run` — PASS, each `Tests` count read.
  (`station-order-migration.test.ts` passes before Task 43 either way; Decision 1 measured that it
  needs the edit once `listStations` reads the column.)
- [ ] **Step 6:** typecheck `@waitron/shared`, `@waitron/db`, `@waitron/server`; prettier; commit
  `git commit -s -m "Each station can store its own bump mode (A756 PR 7)"`, then update the ledger.

**Assertions changed:** none; `kitchen-stations.test.ts:121` gains a check (Decision 7); the two
upgrade suites change setup only.

### Task 43: a station's save writes its own bump mode

**Files:**
- Modify: `apps/server/src/kitchen.ts` (`Station` `:28-43`, `listStations` `:124-147`,
  `updateStation`'s patch type `:167-176`; its local `export type BumpMode` `:225-227` is replaced
  by `@waitron/shared`'s, which `setBumpMode`/`getBumpMode` use until Task 49a),
  `apps/server/src/management-api.ts` (`parseBumpMode` beside `:366-371`; the PATCH body and patch
  types `:1615-1645`, set after `:1670`; the `type BumpMode` import `:102` from `@waitron/shared`)
- Test: `apps/server/src/kitchen.test.ts`, `apps/server/src/management-api.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `kitchen.test.ts`: `"a new station is done one item at a time"` — `createStation({ name })`;
    `listStations` answers `bumpMode: "line"`; `"updateStation writes a station's bump mode and
    leaves the others"` — Bar set to `ticket`, Grill still `line`.
  - `management-api.test.ts`, beside `"PATCH saves a station's ticket grouping and refuses any
    other value"` (`:1760`): `"PATCH saves a station's bump mode and refuses any other value"` —
    `"ticket"` saved and listed; `"Ticket"`, `null`, `1`, `true` each 400
    `management.request_invalid { field: "bumpMode" }`, the row still `ticket` after each; and
    `{ name: "Renamed", bumpMode: "bogus" }` leaves the name unchanged.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/kitchen.test.ts src/management-api.test.ts -t "bump mode|one item"`.
- [ ] **Step 3: Implement.** The two whole-shape pins of Decision 4 (`kitchen.test.ts:212`,
  `:341`) gain `bumpMode: "line"`, every other value unchanged.
- [ ] **Step 4: Run** Step 2's command without `-t`, plus
  `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/till-api.test.ts src/till-api.station-today.test.ts src/station-queue-rest.test.ts src/configuration-transfer.test.ts src/station-order-migration.test.ts src/canvas-retirement-upgrade.test.ts`
  — PASS (Decision 4 measured these with the key; any further whole-shape pin found gains the key
  only — record each).
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "A station's save writes its own bump mode (A756 PR 7)"`, then update the ledger.

**Assertions changed:** keys added to two whole-shape pins with existing values unchanged (A773
§7.1, "Every station setting is set on the station itself").

### Task 44: every order in a station's queue carries its station's bump mode

**Files:**
- Modify: `apps/server/src/working-order.ts` (`StationQueueGroup` `:7285-7305` gains
  `bumpMode: BumpMode`; `listStationQueues` selects `bumpMode: kitchenStations.bumpMode` after
  `:7547` and sets it beside `thresholds` at `:7655`)
- Test: `apps/server/src/station-queue-rest.test.ts`, `apps/server/src/device-api.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `station-queue-rest.test.ts`: `"each order in a station's queue carries that station's bump
    mode"` — Grill `ticket`, Bar `line`, one order with a dish at each, fired;
    `GET /api/stations/<Grill>/queue` answers that order with `bumpMode: "ticket"`, Bar's with
    `"line"`; then Bar set to `ticket` by `updateStation` and Bar's queue read again answers
    `"ticket"`.
  - `device-api.test.ts`: `"the station screen gives each station's orders that station's bump
    mode"` — a device whose screen works Grill and Bar; `GET /api/device/station-screen` answers
    Grill's queue orders `ticket` and Bar's `line`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/station-queue-rest.test.ts src/device-api.test.ts -t "bump mode"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** (free memory first) every server suite that reads a station queue:
  `git grep -l -E 'listStationQueues?\(|/queue"|station-screen' -- 'apps/server/src/*.test.ts' | sed 's#apps/server/##' | xargs pnpm --filter @waitron/server exec vitest run`
  (35 files on `97a8b7699`; Decision 4 ran them with the key) — PASS.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "Each order in a station's queue carries that station's bump mode (A756 PR 7)"`,
  then update the ledger.

**Assertions changed:** none; the cases are new.

### Task 45: configuration copies check an imported bump mode

**Files:** `packages/db/src/configuration-transfer.ts:4-12`; Test:
`packages/db/src/configuration-transfer.test.ts` (beside `:69-90`) and
`apps/server/src/configuration-transfer.test.ts`.

- [ ] **Step 1: Write the failing tests.** In `packages/db/src/configuration-transfer.test.ts`:
  `"refuses a station bump mode a save would refuse %j"` (`"bogus"`, `"Ticket"`, `null`, `1`, each
  `setup.request_invalid { field: "kitchen_stations.bump_mode" }`), `"accepts an absent station
  bump mode"` and `"accepts each station bump mode"` (over `BUMP_MODES`). In
  `apps/server/src/configuration-transfer.test.ts`, beside PR 6's ticket-grouping transfer case:
  `"transfers each station's bump mode"` (Grill `ticket`, Cold `line`; the exported rows carry
  `bump_mode` and the imported stations read the same) and `"refuses an imported bump mode
  outside the two values before writing anything"` (a bundle row with `bump_mode: "bogus"`; the
  target has no station named as in the bundle).
- [ ] **Step 2: Run and watch the refusal cases fail** (the transfer case may already pass: the
  table is exported whole). `pnpm --filter @waitron/db exec vitest run src/configuration-transfer.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t "bump mode"`.
- [ ] **Step 3: Implement** the check in `validateCoreConfiguration`.
- [ ] **Step 4: Run** Step 2's db command, `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run`, `pnpm exec vitest run scripts/id-columns-are-references.test.ts`
  — PASS.
- [ ] **Step 5:** typecheck `@waitron/db`, `@waitron/server`; prettier; commit
  `git commit -s -m "A configuration import refuses an unknown station bump mode (A756 PR 7)"`,
  then update the ledger.

**Assertions changed:** none.

### Task 46a: the till's queue orders carry a bump mode (types and fixtures)

Setup only, mechanical: the till's `StationQueueGroup` gains the field Task 44 sends, so every
typed order fixture names it. No behaviour changes.

**Files:**
- Modify: `apps/till/src/api/client.ts` (`StationQueueGroup` `:1643-1667`, after `thresholds`
  `:1666`: `bumpMode: "line" | "ticket";` with the one-line comment "This order's own station's
  choice; a merged queue mixes stations.")
- Modify (fixtures, setup): every typed order literal `tsc` names — measured in the probe with the
  field added, `pnpm --filter @waitron/till typecheck` reported 36 errors:
  `src/widgets/station-queue.test.ts` (12), `src/widgets/station-queue.a11y.test.ts` (8),
  `src/widgets/station-queue.kitchen-note.test.ts` (6), `src/screens/till-station-screen.test.ts`
  (5), `src/screens/till-station-screen.a11y.test.ts` (2), `test/kitchen-allergy-fixtures.ts` (1),
  `src/screens/kitchen-allergy-send.test.ts` (1), `src/api/client.test.ts` (1). Each gains
  `bumpMode: "line"` beside its `thresholds`; a literal spreading another inherits it.

- [ ] **Step 1:** Add the field; run `pnpm --filter @waitron/till typecheck` and add
  `bumpMode: "line"` to each literal it names until it passes.
- [ ] **Step 2: Run** (free memory first) the eight files in one
  `pnpm --filter @waitron/till exec vitest run <files>` — PASS, each count read.
- [ ] **Step 3:** prettier; commit
  `git commit -s -m "The till's queue orders carry their station's bump mode (A756 PR 7)"`, then
  update the ledger.

**Assertions changed:** none.

### Task 46b: each order on a kitchen screen bumps by its own station's mode

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`BumpMode` `:55-57` stays as the type; the
  `bumpMode` property `:618` goes; `#bump` `:636-658` and `#bumpLabel` `:1154-1157` read
  `group.bumpMode`), `apps/till/src/screens/till-station-screen.ts` (`bumpMode` property `:207`
  and import `:27`; the bindings `:919`, `:1112`), `apps/till/src/till-app.ts` (import `:297`;
  state `:2951-2952`; `:9563`; the bindings `:17877`, `:18081`)
- Test: `apps/till/src/widgets/station-queue.test.ts`, `station-queue.a11y.test.ts`,
  `apps/till/src/screens/till-station-screen.test.ts`, `apps/till/src/till-app.test.ts`,
  `apps/till/src/till-app-setup-refresh.test.ts`

- [ ] **Step 1: Change the tests first.**
  - `station-queue.test.ts`: new `"a merged queue bumps each order by its own station's mode"` — a
    `ticket` order at st-1 and a `line` order at st-2: tapping st-1's dish emits only
    `advance-ticket { orderId, stationId: "st-1" }`, tapping st-2's emits only
    `advance-ticket-item`, and the rail's bump labels read "Advance ticket #5" and "Advance #6". The
    cases at `:872`, `:887` and `:2227` keep their checks and move `bumpMode: "ticket"` from the
    widget onto their orders (setup).
  - `station-queue.a11y.test.ts:468`: `bumpMode: "ticket"` moves onto its orders (setup).
  - `till-station-screen.test.ts`: `"threads bumpMode through to the widget"` (`:209`) →
    `"hands the widget each station's orders with their own bump mode"` — a station whose queue
    read answers an order with `bumpMode: "ticket"`; the widget's order carries it. The cases
    passing `bumpMode: "ticket"` to the screen (the cases starting at `:277`, `:704` and `:1156`,
    the `it.each` starting at `:1232`, and the `bump` helper starting at `:1348`) set it on their queue orders instead (setup; their checks
    stay). The case starting at `:1875` sets `queue.bumpMode = "ticket"` (`:1891`); it sets
    the mode on `sameOrderAtBarra`'s order instead (setup). New: `"a merged
    device screen bumps a whole order at one station and a single dish at another"` and `"a
    station's changed bump mode reaches an open device screen at its next refresh"` — fake timers,
    `getDeviceStationScreen` answering `line` then `ticket` for the same station; after one
    `REFRESH_MS` a tap emits `advance-ticket` and the screen calls `deviceAdvance` for each
    advanceable dish (A785's bump-mode half).
  - `till-app.test.ts:13307` (`"threads the venue bump_mode from boot to the station screen …"`):
    deleted — the start read no longer carries a mode (Decision 5).
  - `till-app-setup-refresh.test.ts:459` (`"A773 waiter authority: refresh keeps bump mode and
    drops the retired station control"`) → `"A773 waiter authority: refresh drops the retired
    station control"`: the two `station().bumpMode` checks (`:475`, `:484`) go, the `fireControl`
    check stays; `:498-506` loses `expect(venue(el).bumpMode).toBe("line")`, the courses check
    stays; the `venue` helper (`:376`) loses `bumpMode`.
- [ ] **Step 2: Run and watch the new cases fail.**
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/screens/till-station-screen.test.ts -t "own|merged|refresh"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** (free memory first) `pnpm --filter @waitron/till exec vitest run src/widgets src/screens/till-station-screen.test.ts src/screens/till-station-screen.a11y.test.ts src/till-app.test.ts src/till-app-setup-refresh.test.ts`
  — PASS; `git grep -n -E '\.bumpMode=|bumpMode = till' -- apps/till/src` prints nothing.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit
  `git commit -s -m "Each order on a kitchen screen bumps by its own station's mode (A756 PR 7)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1, done on the screen is set on each station): the renamed
`till-station-screen.test.ts:209`; `till-app.test.ts:13307` deleted; the two bump-mode checks of
`till-app-setup-refresh.test.ts` `:459` and the one at `:506`. Moving `bumpMode` from the widget or
screen onto orders elsewhere is setup.

### Task 47: the station editor sets a station's bump mode

**Files:**
- Modify: `packages/venue-service/src/dashboard/station-editor.ts` (import `:22-29`;
  `StationEditorStation` `:34-44`, `StationEditorSave` `:50-59`, `Draft` `:72-80`, `equal`
  `:106-114`, the draft `:286-297` and `:343-352`, `changed` `:419-427`, `sendable` `:429-454`, the
  field after the late-flags fieldset, before `:614`)
- Modify: `routing-client.ts` (`PrepStation` `:29-42`; `updateStation` `:123-136`),
  `prep-stations-screen.ts` (`:752-763` passes `bumpMode`), `strings.ts` (Decision 8's three
  keys, EN and ES)
- Test: `station-editor.test.ts`, `station-editor.a11y.test.ts`, `prep-stations-screen.test.ts`
- Modify (fixtures, setup): every station fixture —
  `git grep -l -E 'printHeldWork: (true|false)' -- packages/venue-service/src/dashboard packages/venue-service/test`
  (10 files on `97a8b7699`, `station-editor.ts`'s own default among them), plus
  `station-editor.a11y.test.ts`, whose fixture sets `printHeldWork` from its state (`:38`): each
  gains `bumpMode: "line"`.

**Interfaces — produces:** `StationEditorStation.bumpMode: BumpMode`; `StationEditorSave.bumpMode?`.

- [ ] **Step 1: Write the failing tests** in `station-editor.test.ts`, beside PR 6's cases
  (`:562-640`):
  - `"opens on the station's bump mode, right after the late flags"` — a
    `wt-combobox[name=bumpMode]` labelled "Done on the screen" with the options
    `[["line","One item at a time"],["ticket","Whole ticket at once"]]`, value from the station,
    the late-flags fieldset its previous sibling and the rest-of-order switch its next.
  - `"sends only a changed bump mode, and nothing for a choice put back"` — choose Whole ticket at
    once: Save enabled, sends `{ bumpMode: "ticket" }`; choose back: Save quiet.
  - `"reads the bump mode in Spanish"` — label «Marcado en la pantalla», options «Un plato cada
    vez», «Toda la comanda a la vez».
  - `station-editor.a11y.test.ts`: its fixture gains `bumpMode: "ticket"`, so its axe cases run
    over the new combobox in both themes.
  - `prep-stations-screen.test.ts`: `"hands the station's printing choices to the editor and saves
    the station's"` (PR 6's case) gains `bumpMode` — the editor opens on the station's value, and
    choosing Whole ticket at once sends `{ bumpMode: "ticket" }`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-editor.test.ts src/dashboard/prep-stations-screen.test.ts`
- [ ] **Step 3: Implement**; sweep the fixtures.
- [ ] **Step 4: Run** (free memory first) `pnpm --filter @waitron/venue-service exec vitest run src/dashboard`
  — PASS; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/venue-service`; prettier; commit
  `git commit -s -m "The station editor sets a station's bump mode (A756 PR 7)"`, then update the ledger.

**Assertions changed:** the `prep-stations-screen.test.ts` case gains a key and a send (A773 §7.1);
fixtures are setup.

### Task 48a: Venue settings' leave checks reach Kitchen through venue service's panel

`apps/dashboard/src/dashboard-app.venue-settings-unsaved.test.ts` leaves Venue details for the
Kitchen tab in most of its cases (`grep -n 'select(app, "kitchen")'`), and its session enables no
module (`modules: []`, `:76`, and again in the `getMe` overrides at `:567`, `:654`, `:746`, `:785`), so its Kitchen tab is the core panel alone; its mount helper waits for
that panel's `[data-test=bump-line]` (`:120-133`). With the core panel gone (Task 48b) this suite
would have no Kitchen tab. This task gives it venue service's panel **while the core panel still
exists**, so the suite is green before and after (the Task 25a pattern).

- [ ] **Step 1:** The session answers `modules: ["venue-service"]` (the default and each override), and `mountWidget` gets a
  `request` answering `/management-api/venue-service` with the model
  `apps/dashboard/src/testing/department-receipt-app-fixture.ts:43-68` builds (export a small
  builder from that fixture rather than copying it, if the receipt cases' fixture can share it) and
  `[]` for any other module read. The mount helper waits for Venue details' `[data-test=edit]` or
  venue service's `dashboard-venue-service-settings` `[data-test=kitchen-changes]`. Every case
  keeps its name and checks. Where a case's sidebar click or a read now meets a module screen or
  request (the session lists venue service's sidebar entries too), adjust the stub, not the check.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.venue-settings-unsaved.test.ts`
  (free memory first) — PASS, the count read and equal to `main`'s.
- [ ] **Step 3:** prettier; commit
  `git commit -s -m "Venue settings' leave checks reach Kitchen through venue service's panel (A756 PR 7)"`,
  then update the ledger.

**Assertions changed:** none (setup: which panel the Kitchen tab holds).

### Task 48b: the Kitchen tab's core panel goes

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (import `:85`; the `kitchen` entry of
  `CORE_SETTINGS_PANELS` `:337-345`)
- Delete: `apps/dashboard/src/screens/kitchen-screen.ts`, `kitchen-screen.test.ts`,
  `kitchen-screen.a11y.test.ts`, `kitchen-screen.unsaved.test.ts`,
  `kitchen-screen.waiter-authority.test.ts`
- Test: `apps/dashboard/src/dashboard-app.test.ts` (`:1724`, `:1746`, `:1778`, `:1793`, `:2811`,
  `:2829`, `:2852`), `dashboard-app.settings-panels.test.ts` (`:138`, `:179`),
  `dashboard-app.a11y.test.ts:356`, and `dashboard-app.venue-settings-unsaved.test.ts`'s mount
  helper, which stops looking for `dashboard-kitchen-screen` (`:128-131`)

- [ ] **Step 1: Change the tests first.**
  - `dashboard-app.test.ts`:
    - `:1724` `"opens Venue settings, with Kitchen among its tabs, under one h1"` → `"opens Venue
      settings under one h1, with Kitchen holding venue service's panel"`: the session enables
      venue service with `venue.view` (the `request` of `:1755-1770`); tabs
      `["venue-details", "kitchen"]`; no `dashboard-kitchen-screen`; one h1.
    - `:1746` `"puts venue service's kitchen panel after the core one"` → `"Kitchen holds venue
      service's panel alone"`: `panelsOn(el, "kitchen")` `toEqual(["dashboard-venue-service-settings"])`.
    - `:1778` `"keeps Kitchen with only its core panel when venue service is disabled"` → `"has no
      Kitchen tab when venue service is disabled"`: the tab list has no `kitchen`, and the address
      `/manage/venue-settings/view/kitchen` is replaced by the first visible tab, or left at Venue
      settings when none is (this stub session holds no `venue.view`).
    - `:1793` `"hands each core panel the shell's api"`: the session gains `venue.view` and the loop
      runs over `dashboard-venue-details-panel` and `dashboard-venue-defaults-panel`, opened at
      `/view/venue-details` (setup: the same check over the core panels that remain).
    - `:2811` `"offers a manager Venue settings … opening on its first permitted tab"`: the api
      check reads `dashboard-venue-details-panel` with `venue.view`, and the address is
      `/view/venue-details` (setup and address).
    - `:2829` `"shows a supervisor Venue settings without its Receipts tab"`: the pathname check
      becomes "no tabs, the heading alone" — this stub supervisor has no permissions and no
      modules (a real supervisor holds `venue.view`, Decision 9).
    - `:2852` `"shows a supervisor Kitchen settings without edit controls"`: deleted — its subject
      is the core panel's read-only bump buttons; venue service's panel keeps its own read-only
      cases (`packages/venue-service/src/dashboard/service-settings-panel.test.ts`).
  - `dashboard-app.settings-panels.test.ts`: `:138` `"puts a module's panels on their tab by their
    stated order, the core panel counting as 0"` moves to the Venue details tab, the one tab left
    with core panels: the file's `vi.mock` gives `widgets` two more panels on `venue-details`
    (orders -1 and 5) gated by a new permission `test.details`, so `:147`, whose session lacks it,
    still sees only `["kitchen"]`; the case mounts with `["test.use", "test.details", "venue.view"]`
    and reads `["panel-early", "core", "core", "panel-late"]` (the Venue details and Defaults
    panels, each order 0). `:179` `"refuses to start when a module repeats a core panel's id"` uses
    `id: "defaults"` (setup).
  - `dashboard-app.a11y.test.ts:356`: the session gains `venue.view`, so the page draws a tab and
    the axe check has something to read (setup).
- [ ] **Step 2: Run and watch the changed cases fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.settings-panels.test.ts -t "Venue settings|Kitchen|core panel"`
- [ ] **Step 3: Implement**; delete the five files. The client methods, the live-query row, the
  strings and the test stubs stay until Task 48c: every stub object that names `getBumpMode` is
  cast `as unknown as DashboardApi` or passed through a `stubApi(overrides: Record<string,
  unknown>)` (`dashboard-app.a11y.test.ts:38`, `:110`; `dashboard-app.help.test.ts:40`, `:135`;
  `dashboard-app.module-order.test.ts:63`; `dashboard-app.settings-panels.test.ts:111`;
  `dashboard-app.test.ts:105`, `:200`; `dashboard-app.venue-settings-unsaved.test.ts:112`), so a
  stub naming a method nothing calls still compiles and this commit stays green.
- [ ] **Step 4: Run** (browser runs; free memory first) `pnpm --filter @waitron/dashboard exec vitest run src/screens src/dashboard-app.a11y.test.ts src/dashboard-app.help.test.ts src/dashboard-app.module-order.test.ts src/dashboard-app.settings-panels.test.ts src/dashboard-app.test.ts src/dashboard-app.venue-settings-unsaved.test.ts`
  — PASS; `pnpm exec vitest run scripts/style-token-names.test.ts scripts/guide-links.test.ts`;
  typecheck `@waitron/dashboard`.
- [ ] **Step 5:** prettier; commit
  `git commit -s -m "The Kitchen tab's bump mode buttons go; Kitchen keeps venue service's panel (A756 PR 7)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1, "Every station setting is set on the station itself"; the "Kitchen
tab itself goes" paragraph above): the five deleted files; `dashboard-app.test.ts` `:1724`, `:1746`,
`:1778`, `:2829` and `:2852` (deleted); `settings-panels.test.ts:138` moved to another tab.
`:1793`, `:2811`, `settings-panels.test.ts:179` and `a11y.test.ts:356` are setup.

### Task 48c: the dashboard's bump-mode client, live query and strings go

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`BumpMode` `:738`; `setBumpMode`/`getBumpMode`
  `:3274-3280`), `apps/dashboard/src/api/live-queries.ts:489`, `apps/dashboard/src/i18n/strings.ts`
  (EN `:1267-1269`, ES `:4537-4539`)
- Test: `api/client.test.ts:1654`, `api/client-routes.test.ts:83-84`, `api/live-queries.test.ts:206`
- Modify (stubs, setup): the `getBumpMode` stub and the dead `getFireControl` stub beside it in
  `dashboard-app.a11y.test.ts:359-360`, `dashboard-app.help.test.ts:74-75`,
  `dashboard-app.module-order.test.ts:60-61`, `dashboard-app.settings-panels.test.ts:109-110`,
  `dashboard-app.test.ts:139-140`, `dashboard-app.venue-settings-unsaved.test.ts:50-51`

- [ ] **Step 1: Change the tests first.** `client.test.ts:1654` and `client-routes.test.ts:83-84`
  are deleted with the two methods; `live-queries.test.ts:206`'s `getBumpMode` row goes.
- [ ] **Step 2: Implement**; remove the stubs listed.
- [ ] **Step 3: Run** (browser runs; free memory first) `pnpm --filter @waitron/dashboard exec vitest run src/api src/dashboard-app.a11y.test.ts src/dashboard-app.help.test.ts src/dashboard-app.module-order.test.ts src/dashboard-app.settings-panels.test.ts src/dashboard-app.test.ts src/dashboard-app.venue-settings-unsaved.test.ts`
  — PASS; `pnpm exec vitest run scripts/live-subscriptions.test.ts`;
  `git grep -n -E 'bump_mode|bumpMode|BumpMode|bump-mode|kitchen-screen\.|dashboard-kitchen-screen|kitchen\.bump_|getFireControl' -- apps/dashboard`
  prints nothing (on `97a8b7699` it lists exactly the 18 files Tasks 48b and 48c change or delete).
- [ ] **Step 4:** typecheck `@waitron/dashboard`; prettier; commit
  `git commit -s -m "The dashboard's bump mode client and strings go (A756 PR 7)"`, then update the
  ledger.

**Assertions changed** (A773 §7.1): the two client cases deleted and the live-query row removed.

### Task 49a: the venue-wide bump mode leaves the server and the till's start read

**Files:**
- Modify: `apps/server/src/till-setup.ts` (`:4` `locations` import; the select `:36-42`; `:81-86`
  keeps the taxpayer half of its guard; `:98`), `apps/server/src/kitchen.ts` (`setBumpMode`,
  `getBumpMode`, `:225-238`), `apps/server/src/management-api.ts` (imports `:93`, `:97`; the two
  routes `:1714-1735`)
- Test: `apps/server/src/till-api.test.ts` (`:1363-1365`, `:1586-1606`, `:1621`),
  `apps/server/src/till-api.setup-revision.test.ts:180-197`, `apps/server/src/management-api.test.ts`
  (`:277-286`, `:1947-1997`, `:2004-2045`, `:2878-2880`)

- [ ] **Step 1: Write the failing tests.**
  - `management-api.test.ts`: `"no longer serves the venue's bump mode"` — `GET` and
    `PUT /management-api/bump-mode` (a manager's cookie, `{ mode: "ticket" }`) answer 404. `"lets a
    supervisor read Kitchen settings while refusing edits"` (`:277`) loses `/bump-mode` from both
    its lists and keeps `/courses`; the cases `:1947` and `:1976` are deleted; the staff and
    no-session cases (`:2004`, `:2031`) lose their `/bump-mode` requests (`:2022-2023`,
    `:2044-2045`); the fire-control case `:2847` (`"retired fire-control routes leave the stored %s value and bump
    mode unchanged"`) loses its bump read (`:2878-2880`) and is renamed `"retired fire-control
    routes leave the stored %s value and the venue row unchanged"` — its whole-row
    `toEqual(before)` still covers the column.
  - `till-api.test.ts`: the whole-answer pin `:1363-1365` loses `bumpMode` and its comment;
    `:1586` (`"GET /api/till echoes a non-default bump_mode …"`) → `"GET /api/till carries no bump
    mode, whatever the venue's column holds"` — with `locations.bump_mode = 'ticket'`,
    `not.toHaveProperty("bumpMode")`; `:1621`'s `toMatchObject({ bumpMode: "line" })` goes.
  - `till-api.setup-revision.test.ts:180`: `"…, and when bump mode changes"` → `"the revision
    moves when a course is added and when one is renamed"`: the `locations` update and its push go.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/till-api.test.ts src/till-api.setup-revision.test.ts -t "bump mode"`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files without `-t`, plus `src/kitchen.test.ts src/device-api.test.ts`
  — PASS; `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts`;
  `git grep -n -E 'bump_mode|bumpMode|bump-mode|BumpMode' -- apps/server/src ':!*.test.ts'` prints
  only `kitchen.ts` (`Station`), `management-api.ts` (the PATCH), `working-order.ts` (the queue)
  and the format-1 JSON fixture.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit
  `git commit -s -m "The venue-wide bump mode leaves the server and the till's start read (A756 PR 7)"`,
  then update the ledger.

**Assertions changed** (A773 §7.1): the bump-mode route cases and auth-list entries deleted; the
start-read pin loses a key; `till-api.test.ts:1586` inverted and `:1621` cut; the revision case
loses its bump-mode step; `management-api.test.ts:2847` loses its bump read and is renamed (its
whole-row check of the venue row stays).

### Task 49b: configuration copies stop carrying the venue's bump mode

**Files:**
- Modify: `packages/provisioning/src/configuration-transfer.ts` (`:56`, `:95`, `:163`, `:525`)
- Modify (fixtures, setup): `packages/provisioning/test/configuration-bundle.ts:29`,
  `apps/server/src/configuration-import.test.ts:70`, `apps/server/src/configuration-transfer.test.ts:422`
- Test: `apps/server/src/configuration-transfer.test.ts`, `apps/server/src/configuration-import.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `configuration-transfer.test.ts`: `"exports no venue bump mode, and an import leaves the
    target's column alone"` — a source venue with `locations.bump_mode = 'ticket'`; the bundle's
    `venue.location` has no `bumpMode`; a target set to `'ticket'` reads `'ticket'` after the import
    and one set to `'line'` reads `'line'`. `"accepts a bundle that still carries the venue's bump
    mode, as it checks only the venue fields it names"` — beside the `tillName` case (`:480`).
  - `configuration-import.test.ts`: `"refuses a bundle exported before A756 PR 7 by its core
    version, before any write"` — modelled on `:892`: `modules.core` one below
    `versions.core`, refused `setup.request_invalid { field: "module:core" }`, the state folder
    empty (Decision 6's read made a run).
- [ ] **Step 2: Run and watch them fail** (the core-version case may pass already; it pins the
  existing comparison). `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts -t "bump mode|core version"`.
- [ ] **Step 3: Implement**; drop the three fixture lines.
- [ ] **Step 4: Run** the two files without `-t`, `pnpm --filter @waitron/provisioning exec vitest run`
  — PASS; `git grep -n -E 'bump_mode|bumpMode' -- packages/provisioning` prints
  nothing; `git grep -n 'version: 7' -- packages/provisioning/src/configuration-transfer.ts`
  still prints the export (no format change, Decision 6).
- [ ] **Step 5:** typecheck `@waitron/provisioning`, `@waitron/server`; prettier; commit
  `git commit -s -m "Configuration copies stop carrying the venue's bump mode (A756 PR 7)"`, then
  update the ledger.

**Assertions changed:** none; the fixtures lose a key the type no longer has (setup).

### Task 50: the till's start read stops naming a bump mode (type and fixtures)

Setup only, mechanical: after Task 46b nothing reads `TillSetup.bumpMode`, and after Task 49a the
server does not send it.

**Files:** `apps/till/src/api/client.ts:173-177` (the field and its comment go); one line each:
`apps/till/src/api/client.test.ts:631`, `till-app-adjustments.test.ts:163`,
`till-app-boot-and-counter.test.ts:84`, `till-app-counter-adjustments.test.ts:40`,
`till-app-counter-cancel-credit.test.ts:29`, `till-app-counter-move-station.test.ts:41`,
`till-app-device-zones.test.ts:148`, `till-app-drafts.test.ts:208`, `till-app-floor-layout.test.ts:74`,
`till-app-kitchen-note.test.ts:32`, `till-app-menu-refresh.test.ts:229`,
`till-app-menu-timetable.test.ts:173`, `till-app-open-table.test.ts:213`, `till-app-parties.test.ts:199`,
`till-app-service-steps.test.ts:97`, `till-app-setup-refresh.test.ts:216` (and its answers at
`:478`, `:501`, which Task 46b left as setup), `till-app-table-service.test.ts:145`,
`till-app.help-mode.test.ts:28`, `till-app.test.ts:235`, `till-app.theme.test.ts:115`,
`src/widgets/guide-sheet.test.ts:306`, and `apps/till/test/allergy-app-fixture.ts:179`,
`bill-pay-app.ts:248`, `clock-app.ts:85`, `equipment-app.ts:20`, `native-reload.ts:75`. The
`fireControl` lines beside them stay (Decision 5).

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2: Run** (free memory first) every touched suite in one
  `pnpm --filter @waitron/till exec vitest run <files>` (the helpers' suites:
  `git grep -l -E 'allergy-app-fixture|bill-pay-app|clock-app|equipment-app|native-reload' -- apps/till/src`)
  — PASS, each count read; `git grep -n -E 'bumpMode' -- apps/till` prints only
  `station-queue.ts`, `client.ts`'s `StationQueueGroup`, and the order fixtures and cases of Tasks
  46a and 46b.
- [ ] **Step 3:** typecheck `@waitron/till`; prettier; commit
  `git commit -s -m "The till's start read no longer names a bump mode (A756 PR 7)"`, then update
  the ledger.

**Assertions changed:** none.

### Task 51: a look at the station editor, the kitchen screen and the Kitchen tab in real Chromium

**Files:** throwaway tests in `packages/venue-service/src/dashboard/` and `apps/till/src/screens/`
(deleted, never committed); pictures and notes outside the worktree, in
`/Users/clintongormley/waitron-campaign-c/a756-7-shots/` and
`/Users/clintongormley/waitron-campaign-c/a756-7-look-report.md`, as PR 6's Task 40 did.

- [ ] **Step 1:** Mount `prep-stations-screen` with the `api()` fixture of
  `prep-stations-screen.test.ts` (its `bar` station with `bumpMode: "ticket"`). For EN and ES
  (`setLocale("es")`), light and dark, at `page.viewport(1280, 900)` and `page.viewport(390, 900)`:
  Edit on `bar` as opened (Save quiet), scrolled so Done on the screen shows with the late flags
  above it; its list opened. Then mount `dashboard-venue-service-settings` as
  `packages/venue-service/src/dashboard/index.ts` renders it, at both widths, light and dark: only
  Changes after sending. Then mount `till-station-screen` in device mode with two stations merged
  (`till-station-screen.test.ts`'s `mountFor`), Cocina's orders `ticket` and Barra's `line`, rail
  view, light and dark, at 1280 and 390: the two orders' bump labels. Read and record
  `window.innerWidth` inside each test.
- [ ] **Step 2:** Look at every picture: the new combobox lines up with the fields above and below
  it at both widths, its label and longest choice ("Toda la comanda a la vez") whole in both
  languages; no sideways scroll (`document.documentElement.scrollWidth` equals the viewport width);
  the Kitchen tab shows no gap where the bump buttons were; the merged rail shows "Advance ticket
  #N" on Cocina's order and "Advance #N" on Barra's (2026-10-24: that label is read out but not
  shown; what a cook sees is the "Whole ticket" mark on Cocina's order, added after the review —
  see `station-queue.test.ts`'s whole-ticket cases); dark is readable. A defect found is fixed with a
  failing test first, in the component's own test file, and committed.
- [ ] **Step 3:** Delete the throwaway tests; `git status` shows them gone. Update the ledger with
  the look report's path and any defect found.

### Task 52: guides, design notes, audits and the backlog

**Files:** `apps/server/src/guide/en/kitchen-service.md:102-107`,
`apps/server/src/guide/es/kitchen-service.md:117-123`, `docs/developers/design-system.md`
(`:2896`, `:4617-4622`, after `:5165`), `docs/developers/conventions-ui.md` (`:1531`, `:1567`,
`:1571`, `:1577`), `docs/backlog/kitchen.md` (`:148`, Open points),
`docs/backlog.md` (`:1575-1577`, A785 `:2022-2025`),
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md` (`:41`, `:69`),
`docs/operations/a760-migration-squash-inventory.md` (after `:384`)

- [ ] **Step 1: The guides.** EN `:102-104` becomes: "You choose when to request cooking from the
  till; there is no venue-wide firing mode. Each prep station sets whether its kitchen screen marks
  preparation done one item at a time or a whole ticket at once, under **Done on the screen** when
  you edit it in **Prep stations**." The sentences after it (late flags, identical dishes, held
  groups) stay. ES `:117-119`: "Tú decides cuándo pedir la preparación desde el terminal; no hay un
  modo de marcha para todo el local. Cada estación de preparación fija si su pantalla de cocina
  marca un plato cada vez o toda la comanda a la vez, en **Marcado en la pantalla** al
  editarla en **Estaciones de preparación**." No heading changes; both keep `{#service-lifetime}`'s
  section. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2: design-system.md.** `:2896` "Rest-of-order, MOVED slips, identical dishes, held
  printing and a station's three late-flag minutes" → "…, a station's three late-flag minutes and
  its bump mode". `:4617-4618`: after the late-flag sentence add `"Done on the screen" (One item at
  a time or Whole ticket at once),`. After `:5165` ("…read-only without it."): "Kitchen holds venue
  service's panel alone, Changes after sending, shown with `venue.view` and editable with
  `venue_service.manage`; without venue service there is no Kitchen tab (A756 PR 7, 2026-10-24)."
  `git grep -n -i -E 'bump|whole ticket|per item' docs/developers/design-system.md` — each hit is
  updated.
- [ ] **Step 3: conventions-ui.md.** `:1531` loses "bump mode,"; `:1571` "bump mode reaches the
  station screen," goes; `:1577` "when bump mode changes," goes; and the device-mode line
  (`:1567`, "A kitchen screen in device mode: nothing, the theme included") gains "A station's
  bump mode is not a setup value: each order of its queue carries it (`StationQueueGroup.bumpMode`),
  read every 15 s in both modes (`REFRESH_MS`, `apps/till/src/screens/till-station-screen.ts`)."
- [ ] **Step 4: Audits and inventories, dated pointers only.** Personal-data audit `:69`
  (`kitchen_stations`): append "**2026-10-24 (A756 PR 7):** `bump_mode` added." `:41` (`locations`):
  `bump_mode` gains "(read by nothing since A756 PR 7, 2026-10-24; kept for A760)". A760 inventory,
  after `:384`: "**2026-10-24 (A756 PR 7):** core NNNN adds `kitchen_stations.bump_mode`.
  `locations.bump_mode` is read and written by nothing and is left in place, because dropping it
  rebuilds `locations`; a squash leaves it out." (NNNN is Task 42's generated number.) The retention
  inventory is not touched: a column adds no table to a closure.
- [ ] **Step 5: The backlog.** In `docs/backlog/kitchen.md`'s A756 detail delete the PR 7 bullet
  (`:148`); the Kitchen-tab bullet (`:150-151`) becomes "**The Kitchen tab goes** with PR 8, which
  moves its last setting, Changes after sending (venue service's panel); PR 7 removed its core
  panel." Add open points: "From PR 7: the station editor labels the bump mode "Done on the
  screen", "One item at a time" and "Whole ticket at once" (pictures 04 and 10); the Kitchen tab
  said "Bump mode", "Per item" and "Whole ticket". Owner FYI, not a blocker: the Spanish is new
  and built as «Marcado en la pantalla», «Un plato cada vez», «Toda la comanda a la vez» (the
  coordinator's choice of 2026-10-24); say if other words read better." "From PR 7: Add station sets no bump mode; a new station starts at one item at a time."
  In `docs/backlog.md`'s A756 entry (`:1575-1577`) say "PRs 1–6 landed (#1852, #1854, #1858,
  #2020, #2023, #2031); PR 7 is in review; PR 8 is buildable. Open points are in the detail." A785
  (`:2022-2025`) names only the bump mode today, which this PR makes refresh; the theme is what is
  left (`docs/developers/conventions-ui.md:1567`: a kitchen screen in device mode "takes the theme
  in use when it starts"). Rewrite it as a short theme-only entry: "**A785. A kitchen screen in
  device mode keeps the theme it started with until reload (left open by A768, 2026-10-17).**
  Nobody signs in on it, so it runs no menu-state poll and never sees the setup revision move
  when the theme in use changes. Its station queue read could name the revision, as
  `/api/menu-state` does. (A756 PR 7, 2026-10-24, moved the bump mode onto each queue order, so
  that refreshes.)" Before writing it, re-read conventions-ui.md's device-mode line after Step 3's
  edit; if it no longer leaves the theme, delete A785 instead.
- [ ] **Step 6: Missed claims.**
  `git grep -n -i -E 'bump.?mode|bump_mode|whole-ticket bump|per item|venue-wide bump|modo de marcado|por artículo' -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide README.md 'packages/*/README.md'`
  — each hit is rewritten here, is a dated pointer of Step 4 or 5, or is history in a dated plan or
  spec (left alone). `pnpm exec prettier --file-info <file>` on each changed doc (`docs/` is ignored
  whole), and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 7: The PR description and the ledger** both name:
  - **every changed test check**, from each task's "Assertions changed", and the setup moves of
    Tasks 46a, 50 and 48a;
  - **the default and reset decision**: every station starts at one item at a time, the venue's
    value is dropped, not copied, `locations.bump_mode` stays unread for A760, and no venue reset
    is needed (Decisions 1 and 2);
  - **each order bumps by its own station** (Decision 4), and the till's start read losing the
    field (Decision 5);
  - **no configuration format change** and why (Decision 6);
  - **the Kitchen tab** keeping venue service's panel alone, and who no longer sees it (Decision 9);
  - **the wording** taken from pictures 04 and 10, with new Spanish (Decision 8).
- [ ] **Step 8: Commit** `git commit -s -m "Guides and backlog: each station sets what is done on its screen (A756 PR 7)"`,
  update the ledger to `Status: done` for PR 7's build, then `/finish-branch` with this plan's path
  as its note.

---

## Parts that wait

Each is planned when its blocker lands; these notes are the starting decisions, not tasks.

2026-10-23: A773-1 landed (#1897), so PRs 5–8 no longer wait for it; re-check the line numbers
below against `main` when each is planned.

**PR 4 — Reminder to fire the next course, per department:** planned 2026-10-23, after A773-1 landed — see [PR 4](#pr-4--the-reminder-to-fire-the-next-course-per-department) above.

**PR 5 — Late flags on each station:** planned 2026-10-23, after PR 4 landed — see [PR 5](#pr-5--late-flags-on-each-station) above.

**PR 6 — Identical dishes, held courses and MOVED slips on each station:** planned 2026-10-23, after PR 5 landed — see [PR 6](#pr-6--identical-dishes-held-courses-and-moved-slips-on-each-station) above.

**PR 7 — Done on the screen on each station:** planned 2026-10-24, after PR 6 landed — see [PR 7](#pr-7--done-on-the-screen-on-each-station) above.

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
- PR 5 (2026-10-23): every file:line in its section was re-read on `d9252ac34`; the generated
  migration's SQL, the upgrade walk (with a control run on the unchanged tree), the root schema
  guards, `inmutabilidad`, a data control for what an existing station reads after the drop, and a
  trigger-on-drop control were run in a scratch copy or in `node:sqlite`, not reasoned about. Every
  file that names either table (`git grep -l -E 'kitchen_station_timing|kitchen_timing_defaults|kitchenStationTiming|kitchenTimingDefaults' -- ':!docs'`,
  15 product files, 4 test-support files and 36 test files) is assigned to a task, or left with a
  stated reason (the format-1 JSON fixture, `kitchen-timing-upgrade.test.ts`). Tasks 19–28 (with
  24 and 25 each split in two) each stay
  one package or one layer; Task 24b (delete dialog and live queries) is apart from 24a (the
  editor), and Task 25 is split into 25a (move the leave checks off the late-flags
  form while it still exists) and 25b (remove it) so each commit stays green; Task 23 is the
  mechanical setup sweep, kept apart so Task 22 stays small. Task 20 is the largest (one
  provisioning helper file, three server functions, two server suites); its implementer follows
  the handover rule if it runs long.
- PR 5 fresh-context review (2026-10-23), folded in: Task 20 now covers `assertKitchenTimingStations`
  and pins `??`; `station-order-migration.test.ts` keeps its checks (it stops at 0167); Task 25a moves
  seven cases, not five; three more changed checks are named; Task 24 is split; Task 21's check reads
  `incoming`; Tasks 22 and 23's grep predictions match their commands; Decision 4 names the till
  answers; the PR 5 ledger is named.
- PR 6 (2026-10-23): every file:line in its section was re-read on `157f152c5`. Both generated
  migrations' SQL, the upgrade walk (with a control run on the unchanged tree), the root schema
  guards with a classification control, `inmutabilidad`, composition, and every upgrade-style suite
  were run in a scratch copy, not reasoned about; the fixes to the four upgrade checks that failed
  (Decision 7) were run there too. The held-paper design (Decision 5) came from reading every
  reader of `hold_printed_at` (`git grep` listed in Decision 5) and the marker rule stated at
  `order-groups.ts:815`; it is read, not run, and Tasks 34–35c each start with failing cases for
  it. Every file that names one of the three settings
  (`git grep -l -E 'kitchenTicketGrouping|printHeldWork|printMovedSlips|kitchen_ticket_grouping|print_held_work|print_moved_slips' -- apps packages ':!**/drizzle/**'`,
  61 files on `157f152c5`) is assigned to a task, or left with a stated reason (the format-1 JSON
  fixture; `configuration-transfer.test.ts:2245`, which reads the kept nullable column). Tasks 29–41
  (35 split three ways) each stay one package or one layer: storage (29), the station routes (30),
  the import check (31), the mechanical test-setup sweep (32), ticket and MOVED-slip readers (33),
  HOLD writing and FIRE (34), held-paper readers (35a), corrections built as `HeldChange` (35b),
  the three direct correction paths (35c), the editor (36), the Kitchen panel (37), venue-service's
  server side (38) and the column drop (39). Task 32 moves every test to the station before any
  reader moves, writing both values, so each commit stays green; Task 37 stops the dashboard
  calling the venue routes before Task 38 removes them. Tasks 34 and 35b are the largest; their
  implementers follow the handover rule if they run long.
- PR 6 fresh-context review (2026-10-23), folded in after checking each finding against the code:
  Decision 5 now keeps the group stamp for every notice and filters only printing (a screen-only
  station would have lost notices, `kitchen-print.ts:905-926`, `:933-951`, `:1170-1196`), and Tasks
  35a–35c are rewritten around `CorrectionItem.holdGroupId` with a screen-only case each; a station
  not recorded for a group now gets no HOLD paper for it at all, so it never holds partial paper
  (the review proposed a full HOLD ticket for such a station once it is switched on; the plan
  instead follows the existing rule "A group held before this is turned on prints when it is
  fired", `strings.ts:530-531`, and `correctJoin`'s early return, `order-groups.ts:2122-2123`, so
  the table has one writer); a recorded station gets a held move's HOLD ticket whatever its current
  choice; Tasks 33–35c run all 23 files of Task 32; Task 31 tests the import check in db; the two
  station-delete pins gain the table; Task 29's commit states why the table is core; the
  schema-constraints placement, the two places that map null to Print, and the kept grouping hint
  are named.
- PR 7 (2026-10-24): every file:line in its section was re-read on `97a8b7699`. The generated
  migration's SQL, the upgrade walk (with a control run on the unchanged tree), the root schema
  guards with a `migrations-match-schema` control, `inmutabilidad`, composition, the upgrade-style
  server suites (and the two fixes Decision 7 names), a data control for what an existing station
  reads after the migration, a generation showing that dropping `locations.bump_mode` rebuilds
  `locations`, the 35 server suites that read a station queue with the new key, the station-answer
  suites, the till's type change (36 fixture errors counted by `tsc`) and the merged-view case that
  shows one queue holding two stations were run in a scratch copy or on this tree, not reasoned
  about. Read, not run: that nothing on the server reads the mode for a bump (a `git grep`), and
  that a pre-PR-7 file is refused by its core version (Task 49b runs it). Every file that names the
  mode (`git grep -l -E 'bump_mode|bumpMode|BumpMode' -- apps packages ':!**/drizzle/**'`, 62 files
  on `97a8b7699`) is assigned: the 17 dashboard files to Tasks 48a–48c (five deleted); server
  `kitchen.ts` and `management-api.ts` to Tasks 43 and 49a, `till-setup.ts`, `till-api.test.ts`,
  `till-api.setup-revision.test.ts` and `management-api.test.ts` to Task 49a,
  `configuration-import.test.ts` and `configuration-transfer.test.ts` to Task 49b; the 33 till files
  to Tasks 46a, 46b and 50 (`client.ts`, `till-app.test.ts` and `till-app-setup-refresh.test.ts` to
  two of them each); `tenants.ts` to Task 42 (comment), provisioning's two files to Task 49b; and
  one left with a stated reason (the format-1 JSON fixture, Decision 6). Tasks 42–52 (46 and 49 each split in
  two, 48 in three) each stay one package or one layer: storage (42), the station routes (43),
  the queue answer (44), the import check (45), the till's order type and its fixtures (46a), the
  till's reading of it (46b), the editor (47), the leave-check suite's move (48a), the core panel's
  removal (48b), the dashboard's client methods and strings (48c), the server's venue mode and start read (49a), provisioning's copies (49b), and the
  till's start-read type and fixtures (50). The order keeps each commit green and each consumer
  ahead of its source: the server sends the mode on each order (44) before the till's type requires
  it (46a); the till stops reading the start read's mode (46b) before the server stops sending it
  (49a); the leave-check suite gets venue service's panel (48a) before the core panel goes (48b);
  and the dashboard stops calling the bump-mode routes (48b, its client methods going in 48c)
  before the server removes them (49a),
  as PR 6's Task 37 came before its Task 38. Task 46b is the largest (three till files and five
  suites); its implementer follows the handover rule if it runs long.
- PR 7 fresh-context review (2026-10-24), folded in after checking each finding against the code:
  the editor's refusal case for the bump mode is dropped and Decision 3 corrected
  (`stationRefusalField`, `Field` and `refusalText`, `station-editor.ts:70`, `:164-185`, know no
  ticket-grouping field either; PR 6's precedent); Decision 9 now says who sees Kitchen
  (`#mayRead`, `dashboard-app.ts:1481-1486`: `venue_service.manage` or `venue.view`; every role but
  staff holds `venue.view`, `packages/identity/src/permissions.ts:45-54`; staff never reach Venue
  settings, `dashboard-app.ts:1941`), and the open point about sessions left with no tabs is
  dropped; Task 48b is split, 48c taking the client methods, live-query row, strings and stubs
  (every stub is cast or typed `Record<string, unknown>`, so the commit between stays green); the
  Spanish words follow the coordinator's ruling («Marcado en la pantalla», «Un plato cada vez»,
  «Toda la comanda a la vez»), recorded as an owner FYI; A785 becomes a theme-only entry, its
  receipt `conventions-ui.md:1567`; Decision 4's `git grep` claim is corrected (case-sensitive:
  `management-api.ts` names the mode only as `getBumpMode`/`setBumpMode`/`BumpMode`, in its
  venue routes); `management-api.test.ts:2847` is renamed in Task 49a and listed as changed; Task
  46b's line numbers say where each case starts.
