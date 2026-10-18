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

1. **A draft on one tab while saving another.** Details edited, then Save on the Receipts tab: the
   receipt saves, the dialog stays open and the Details edit is still there (Task 7).
2. **An invalid or refused field on a tab that is not showing.** Save with a blank name from the
   Service tab, or a server refusal naming a Transfers field: the dialog shows that tab, marks it,
   and focuses the field (Task 1).
3. **An address naming a tab the dialog does not offer** (Transfers with one department, Receipts
   without `layout.configure`): the dialog opens on Details and the address is replaced, not
   pushed (Tasks 2, 7).
4. **The tab disappears while selected** (the second department is deleted elsewhere while
   Transfers is showing): Details shows and the draft is kept (Task 1).
5. **A read-only visitor of the Courses page** (`venue.view` without `venue.configure`): names only,
   no Add course, no drag sentence (Task 4).

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
A773-1 rewrites. PR 2 still touches two A773-1 files outside their hunks (stated in its section).

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
`department-edit-dialog.ts`, `venue-departments-shell.ts`, `strings.ts`, their tests,
`packages/venue-service/src/testing/department-edit-fixture.ts`, `docs/developers/design-system.md`,
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
  `zones` and `receipt` keep their meanings. A tab choice pushes history, as Venue settings does
  (`apps/dashboard/src/screens/venue-settings-screen.ts:96`). An address naming a tab not offered
  opens Details and replaces the address.
- An invalid Save, or a refusal naming a field, shows the first tab (Details → Service →
  Transfers) holding a marked field, then focuses it; every tab holding a marked field carries
  `marked` (`TabItem.marked`, `packages/ui/src/components/wt-tabs.ts:15`).

New strings (venue-service catalogue, EN / ES):
`venue.department_tabs` "Department" / "Departamento" (the strip's label);
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
  event `department-tab-change` with `detail: { tab: DepartmentTab }`, `bubbles: true,
  composed: true`, sent when the strip changes and when Save moves to a tab with a marked field.
  Test helper `selectDepartmentTab(form, tab): Promise<void>` clicks the tab in the strip.

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
    the Details item's `marked` is "needs fixing", `department-tab-change` fired with `details`,
    focus on `[name=name]`'s input, no write.
  - `"a refusal naming a Transfers field shows the Transfers tab and marks it"` — request answers
    `department_transfer.settings_invalid` `{ field: "receivingProfileId" }`.
  - `"losing the second department while Transfers shows returns to Details and keeps the draft"`.
  - In `department-settings.a11y.test.ts`: axe passes on each tab in light and dark.
  - In `department-settings.unsaved.test.ts`: `"switching tabs neither asks to leave nor dirties the draft"`.
- [ ] **Step 2: Run and watch them fail**
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-settings.test.ts src/dashboard/department-settings.a11y.test.ts src/dashboard/department-settings.unsaved.test.ts`
  — expected: the new cases fail (no `wt-tabs`), the old ones pass.
- [ ] **Step 3: Implement** the strip and panels in `department-settings.ts` (decisions above).
  Existing cases that now fail only because a Transfers field is on a hidden tab get
  `selectDepartmentTab` in their setup — setup changes, listed in the ledger.
- [ ] **Step 4: Run the three files again** — all pass; read the `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Department settings draw Details, Service and Transfers as tabs (A756)"`.

### Task 2: The dialog and its address follow the tab

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-edit-dialog.ts` (pass `.tab`, nothing else)
- Modify: `packages/venue-service/src/dashboard/venue-departments-shell.ts` (`view` state,
  `#restore`, `#open`, `#editorOrigin` checks that compare `this.view !== "settings"`)
- Test: `packages/venue-service/src/dashboard/departments-zones-shell.test.ts`,
  `department-edit-dialog.test.ts`

**Interfaces:**
- Consumes: `DepartmentTab`, `department-tab-change`, `offeredTabs` from Task 1.
- Produces: `department-edit-dialog` gains `@property() tab: DepartmentTab = "details"`.

- [ ] **Step 1: Write the failing tests** in `departments-zones-shell.test.ts`:
  - `"choosing the Service tab records /view/service and Back returns to Details"`.
  - `"/manage/venue-operations/department/d1/view/service opens the dialog on Service"`.
  - `"an address naming Transfers with one department opens Details and replaces the address"` —
    `history.replaceState` spied, `pushState` not called (CLAUDE.md §4: spy, never `history.length`).
  - `"closing from the Service tab returns focus to that row's menu"`.
  - `"/view/receipt still opens Edit receipt"` (unchanged until PR 3).
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/departments-zones-shell.test.ts src/dashboard/department-edit-dialog.test.ts` — new cases fail.
- [ ] **Step 3: Implement** the shell mapping and the dialog pass-through.
- [ ] **Step 4: Run the same files** — all pass.
- [ ] **Step 5: Commit** `git commit -s -m "The department dialog's tab is kept in the address (A756)"`.

### Task 3: Phone width, docs, backlog and a look

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-layout.test.ts`
  (the department phone-width case selects Service before checking the service fields — setup
  change; add the same check for the Transfers tab)
- Modify: `packages/venue-service/src/dashboard/department-edit-dialog.a11y.test.ts`,
  `department-edit-dialog-transfers.a11y.test.ts` (axe per tab)
- Modify: `docs/developers/design-system.md` → "Departments and zones" ("Edit department holds
  name, trading name, service settings and transfers" becomes the three tabs and their contents)
- Modify: `docs/backlog/kitchen.md` (A756 point 2: say the tabs landed in this PR and what is left —
  Receipts, the reminder) and `docs/backlog.md` A756 line if its wording goes stale

- [ ] **Step 1:** Add the Transfers phone-width case; run
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-layout.test.ts src/dashboard/department-edit-dialog.a11y.test.ts src/dashboard/department-edit-dialog-transfers.a11y.test.ts`
  and watch the old phone-width case fail on the hidden service fields before its setup change.
- [ ] **Step 2:** Make the setup change; run again — pass.
- [ ] **Step 3: Look.** A throwaway browser test (not committed) mounting the dialog through
  `mountDepartmentEditor`, at `page.viewport(1280, 900)` and `page.viewport(390, 900)`, light and
  dark, each tab selected, saving `page.screenshot({ path: "__screenshots__/look/<name>.png" })`.
  Record `window.innerWidth` read inside the test (testing-guide: the width you asked for is not
  evidence). Open every PNG with the Read tool; check the strip scrolls rather than wraps the
  dialog wider than 390, the Save row stays in view, and the Service headings match mock-up 03
  (without its Courses and Tables sections). Delete the throwaway test.
- [ ] **Step 4:** Run the root guards that read these files:
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "Department dialog tabs: phone width, accessibility and docs (A756)"`, then `/finish-branch`.

---

## PR 2 — The Courses page (buildable now)

Branch `feat/a756-courses-page`, from `main` after PR 1. No migration.

Touches two A773-1 files outside their hunks: `apps/dashboard/src/i18n/strings.ts` (new keys and
the value of `kitchen.no_courses`, away from A773-1's added lines after `kitchen.courses_title`)
and `apps/dashboard/src/widgets/course-list.ts` (a property and a method placed after `render()`,
past A773-1's last hunk `@@ -569`). It moves `kitchen-screen.a11y.test.ts`, whose `COURSES`
fixture A773-1 edits: whichever lands second carries `heldUntilFired` into the moved file. If
A773-1 has landed at pick-up, the Courses page shows its "Held until fired" column with no work here.

**Decisions.** Nav item `{ screen: "courses", labelKey: "nav.courses", requiresPermission:
"venue.view" }` in the `menu` group (`apps/dashboard/src/dashboard-app.ts:234-243`) between
Modifiers and Units, matching the routes' read rule (`withVenueReadAuth`, `management-api.ts:468-477`);
`readOnly` when the session lacks `venue.configure` (the write rule, `management-api.ts:454-466`).
The page holds no staged input: a course name is saved on Enter or on leaving the field
(`course-list.ts` `#commit(edit, via: "enter" | "leave")`), so the A331 rule's trigger is absent and
no `*.unsaved.test.ts` is added; the course list's existing suites carry over unchanged.

New strings (dashboard catalogue, EN / ES): `nav.courses` "Courses" / "Cursos";
`courses.title` "Courses" / "Cursos"; `courses.description` "The order dishes are served in. A
product names its course; drag to change the order." / "El orden en que se sirven los platos. Cada
producto indica su curso; arrastra para cambiar el orden."; `courses.description_read_only` "The
order dishes are served in." / "El orden en que se sirven los platos.". Change the value of
`kitchen.no_courses` to "No courses yet. Add one to let products say when they are served." /
"Aún no hay cursos. Añade uno para que los productos indiquen cuándo se sirven." (the product
editor's Courses window reads the same key; the longer sentence fits it too).

### Task 4: A Courses page under Products and menus

**Files:**
- Create: `apps/dashboard/src/screens/courses-screen.ts`, `courses-screen.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (`CORE_SCREENS` :116-145, `NAV_GROUPS` menu
  :234-243, `#renderScreen` beside `case "units"`)
- Modify: `apps/dashboard/src/widgets/course-list.ts` (after `render()` only)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/dashboard-app.test.ts`

**Interfaces:**
- Produces: element `dashboard-courses-screen` with `api: DashboardApi`, `readOnly: boolean`.
  `dashboard-course-list` gains `@property({ type: Boolean }) showAddButton = true` and
  `startAdding(): void` (opens the new-course row, as its own button does today).

- [ ] **Step 1: Write the failing tests** in `courses-screen.test.ts`:
  - `"shows the Courses heading, its description and the shared course list"` — `h1` "Courses",
    the description sentence, one `dashboard-course-list` whose `showAddButton` is false.
  - `"Add course in the header opens the new course row with its name field focused"`.
  - `"read-only: names only, no Add course, and the description without the drag sentence"`.
  In `dashboard-app.test.ts`:
  - `"Products and menus lists Courses after Modifiers to someone with venue.view"` and
    `"hides Courses without venue.view"`.
  - `"/manage/courses opens the Courses page"`.
  - Change the group-match case at `dashboard-app.test.ts:6765` to expect
    `["nav-menus","nav-catalogue","nav-modifiers","nav-courses","nav-units"]` — authorised by A756
    point 1, "Courses get their own page under Products and menus". The "units last" case at
    `:2998` stays as it is.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/courses-screen.test.ts src/dashboard-app.test.ts` — new cases fail.
- [ ] **Step 3: Implement** the screen (heading row with the Add course button, as
  `units-screen.ts:531-534` lays out its heading), the nav item, the render case, the two
  course-list members and the strings.
- [ ] **Step 4: Run the same files plus** `src/widgets/course-list.test.ts src/screens/catalogue-screen.test.ts` — all pass.
- [ ] **Step 5: Commit** `git commit -s -m "Courses get their own page under Products and menus (A756)"`.

### Task 5: The Kitchen tab stops listing courses

**Files:**
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts` (delete the courses section :421-424 and
  the `course-list` import :18)
- Modify: `apps/dashboard/src/screens/kitchen-screen.test.ts` (move the case
  `"shows the courses heading over the shared course list, which loads the courses itself"` to
  `courses-screen.test.ts` — authorised by A756 point 1; add `"the Kitchen tab lists no courses"`)
- Rename: `apps/dashboard/src/screens/kitchen-screen.a11y.test.ts` →
  `apps/dashboard/src/screens/courses-screen.a11y.test.ts`, mounting the Courses page; both cases
  (populated, empty) keep their axe checks, now in light and dark
- Modify: `docs/developers/design-system.md:3537` ("on Venue settings' Kitchen tab" → "on the
  Courses page"), `docs/backlog/kitchen.md` (point 1 done in this PR), `docs/backlog.md` A756 line

- [ ] **Step 1:** Add `"the Kitchen tab lists no courses"`; run
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/kitchen-screen.test.ts` — it fails.
- [ ] **Step 2:** Remove the section; move the case and the a11y file.
- [ ] **Step 3: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.timing.test.ts src/screens/kitchen-screen.unsaved.test.ts src/screens/courses-screen.test.ts src/screens/courses-screen.a11y.test.ts` — pass.
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
- Two drafts, two Save buttons: Details/Service/Transfers share the department form's Save; the
  Receipts tab shows the editor's own Save and Cancel, and the form's action row hides while
  Receipts is selected. A Save closes the dialog only when the other draft is clean; otherwise the
  dialog stays open on the same tab (as `department-edit-dialog.ts` `saved()` already does for a
  newer edit). Cancel on either asks the dialog to close. Escape, Cancel and the close button ask
  ONE leave question covering both drafts (`LeaveRequest.scopes` takes a list,
  `packages/ui-core/src/unsaved-changes.ts:23`).
- The departments list's Receipt link goes (A756 point 2). The "Set up the tax-agency description"
  button (`departments-list.ts:171-184`) still sends `edit-receipt`, which now opens the department
  dialog on Receipts. `/view/receipt` opens that tab; without `layout.configure` it opens Details and
  replaces the address.

### Task 6: Split the receipt editor out of its modal

**Files:**
- Create: `apps/dashboard/src/screens/department-receipt-editor.ts` (fields, preview, draft
  scope, save — moved from `department-receipt-dialog.ts`), `department-receipt-editor.test.ts`
- Modify: `apps/dashboard/src/screens/department-receipt-dialog.ts` (a thin `wt-modal` around the
  editor that keeps today's contract: heading, `size="wide"`, close on save, close events), and
  `apps/dashboard/src/testing/department-receipt-dialog-fixture.ts` (helpers reach through the
  editor's shadow root)
- Test: the seven `department-receipt-dialog*.test.ts` files must pass unchanged in their checks

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
- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/department-receipt-editor.test.ts src/screens/department-receipt-dialog.test.ts src/screens/department-receipt-dialog.unsaved.test.ts src/screens/department-receipt-dialog.retained.test.ts src/screens/department-receipt-dialog.preview.test.ts src/screens/department-receipt-dialog.client.test.ts src/screens/department-receipt-dialog.width.test.ts src/screens/department-receipt-dialog.a11y.test.ts src/dashboard-app.receipt-dialog.test.ts` — all pass with no check edited.
- [ ] **Step 5: Commit** `git commit -s -m "The receipt editor stands on its own inside the Edit receipt dialog (A756)"`.

### Task 7: The Receipts tab hosts the editor

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-settings.ts` (`DepartmentTab` gains
  `"receipt"`; a `receipt` panel slotting `receiptEditor`; action row hidden on Receipts),
  `department-edit-dialog.ts` (`receiptEditor` property, `size`, one leave question, close rule),
  `venue-departments-shell.ts` (pass `renderPanel(...)` to the dialog; drop its own receipt branch
  and `#receiptClosed`/`#receiptSaved` as separate closes), `strings.ts`
  (`venue.department_tab.receipt` "Receipts" / "Recibos")
- Modify: `apps/dashboard/src/dashboard-app.ts:1403-1410` (render the editor, not the dialog)
- Delete: `apps/dashboard/src/screens/department-receipt-dialog.ts`; rename its suites and fixture
  to `department-receipt-editor*` (mechanical: fixture mounts the editor)
- Test: `packages/venue-service/src/dashboard/department-edit-dialog.test.ts`,
  `department-edit-dialog.unsaved.test.ts` (a stub `dashboard-department-receipt-editor` element
  defined in the test, exposing `leaveScope`/`hasUnsavedChanges` and sending the three events),
  `apps/dashboard/src/dashboard-app.receipt-dialog.test.ts`, `dashboard-app.test.ts:7981-8035`

**Changed checks (each authorised by A756 point 2, "Receipt editing … moves into the Receipts
tab"):** in `department-receipt-dialog.unsaved.test.ts` the cases `"untouched Escape closes without
a leave question"`, `"dirty Escape and Cancel protect the draft with Keep and Discard"`, `"pending Save
blocks Escape, Cancel and a duplicate request"`, `"a removed receipt closes the native modal and
releases its mounted draft"` and `"reconnecting the same receipt preserves its native draft and original
Save baseline"` move to the department dialog's suites with the same assertions about the receipt
draft; every case asserting "closes" after a receipt Save (`department-receipt-dialog.test.ts`
`"saves exact independent receipt and policy, keeps hidden translations and closes before any
refresh"`, `.client.test.ts` `"… writes the exact model envelope through the real client and closes"`,
`dashboard-app.receipt-dialog.test.ts` `"successful receipt save closes the hosted dialog and updates
the department host"`) now asserts the department dialog closes because the department form is
clean; `dashboard-app.receipt-dialog.test.ts` `"a deep link cannot open the receipt without layout
permission"` now asserts Details opens with no Receipts tab; `dashboard-app.test.ts:7981` `"the real
receipt link keeps its department and asks before leaving a Settings draft"` reaches Receipts
through the description button or `/view/receipt` instead of the removed link, keeping its
leave-question assertions; `.width.test.ts`'s first-frame width
case measures the department dialog with Receipts offered.

- [ ] **Step 1: Write the failing tests** in `department-edit-dialog.test.ts`:
  `"offers Receipts between Service and Transfers when an editor is supplied, and is wide"`;
  `"no editor, no Receipts tab, standard width"`;
  `"a receipt Save closes the dialog when the department form is clean"`;
  `"a receipt Save keeps the dialog open on Receipts when Details is dirty, and the Details edit survives"`;
  `"Escape with both drafts dirty asks one question; Discard closes without writing either"`;
  in `departments-zones-shell.test.ts`: `"/view/receipt opens the dialog on Receipts"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-edit-dialog.test.ts src/dashboard/department-edit-dialog.unsaved.test.ts src/dashboard/departments-zones-shell.test.ts` — new cases fail.
- [ ] **Step 3: Implement**; make the changed checks listed above.
- [ ] **Step 4: Run** the three venue-service files, then
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.receipt-dialog.test.ts src/dashboard-app.test.ts src/screens/department-receipt-editor*.test.ts` (expand the glob into file names) — all pass.
- [ ] **Step 5: Commit** `git commit -s -m "Receipt editing moves into the department dialog's Receipts tab (A756)"`.

### Task 8: The Receipt link goes; docs, backlog and a look

**Files:**
- Modify: `packages/venue-service/src/dashboard/departments-list.ts:214-231` (a department row's
  Also edit cell is empty; zones keep Floor plan); `departments-list.test.ts`,
  `departments-list.a11y.test.ts`, `departments-zones-list.test.ts` (cases asserting the link —
  authorised by A756 point 2, "the departments table's Receipt link … goes"; a new case
  `"a department row has no Receipt link and the description button opens Receipts"`)
- Modify: `docs/developers/design-system.md` → "Departments and zones" (Also edit; "Edit receipt …
  is a wide `wt-modal`" becomes the Receipts tab), `docs/backlog.md` and `docs/backlog/kitchen.md`
  (below)

- [ ] **Step 1:** Write the new list case; run
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/departments-list.test.ts src/dashboard/departments-zones-list.test.ts src/dashboard/departments-list.a11y.test.ts` — it fails.
- [ ] **Step 2:** Remove the link; adjust the authorised checks; run again — pass.
- [ ] **Step 3: Look** (as Task 3 Step 3) at the dialog on every tab, Receipts with its preview, at
  1280 and 390, light and dark; and at the departments list.
- [ ] **Step 4: Backlog.** Rewrite the A756 entry in `docs/backlog.md` and its detail in
  `docs/backlog/kitchen.md` so they hold only what waits: PRs 4–8 below, each one line with its
  blocker, and the Kitchen tab's removal. Keep the "Changed by A773" block. Run
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/claude-md-pointers.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "The departments list drops its Receipt link; backlog keeps only A756's waiting parts"`, then `/finish-branch`. The PR description says which parts wait for A773-1 and A773-2 (the table above).

---

## Parts that wait

Each is planned when its blocker lands; these notes are the starting decisions, not tasks.

**PR 4 — Reminder to fire the next course, per department. Waits for A773-1** because both readers
are inside functions it rewrites: `order-groups.ts:1415` sits in hunk `@@ -1415,7`
(`readCurrentOrders`) and `releaseReminder`/`readReleaseReminders` change at `@@ -1171`/`@@ -1182`;
the reminder's display moves to the Sent panel (A773-1 plan Tasks 8 and 11). Shape: a nullable
`release_reminder_minutes` count (default 10) on the same venue-service table A757 slice 1 gives the
clearing switch (coordinate; `department_sale_policies` is the natural home), an ADD COLUMN, no
rebuild; drop `service_settings.release_reminder_minutes` (read the generated SQL — no other column
of that table is touched, and nothing references `service_settings`). The seat
`readReleaseReminderMinutes(tx)` (`packages/module/src/module.ts:1290`) takes the party's
department. Service tab section "Courses and the kitchen" with today's combobox
(`service-settings-panel.ts:198-239`). Open point at pick-up: a party seated across two
departments' tables — whose reminder applies. No venue reset expected; confirm with
`scripts/migration-upgrade.test.ts`.

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
- No task changes a function A773-1 rewrites; PR 2's two A773-1 files are touched outside their hunks.
