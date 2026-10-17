# A719 — Periods become a window opened from the Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Replace the Periods page and its sidebar entry with a Periods window inside the Calendar,
opened from a "Periods…" button on the Year's season row, from the painters' Periods link (over the
painter, keeping its unsaved paint) and from the Departments warning "Set up periods"; drop the
unused Floor plan column and field, fill an unused period's swatch, and move the period dialog's
Delete… into its bottom row.

**Architecture:** The Calendar screen (`dashboard-opening-hours-screen`,
`packages/venue-service/src/dashboard/opening-hours-screen.ts`) already opens one window, Seasons,
from a `window/<id>` address pair that sits beside whatever view or painter is showing
(`followUrl`, `:255-273`; `navigationScopes`, `:385-395`; `seasonsWindow`, `:404-444`;
`calendarWindowPath`, `opening-hours-paths.ts:56-65`). A719 adds a second window id, `periods`,
to the same handler. Its body is today's Periods page element, renamed `periods-list` and changed
to fit a window. The window's period dialog registers its unsaved draft under the screen's
`windowDraftRoot` (`:151`), so closing the window asks only about the window's own draft and leaves
a painter's unsaved paint alone.

**Tech Stack:** TypeScript, Lit, the shared `wt-*` primitives, Vitest. Every test named below runs
in **real headless Chromium**: `packages/venue-service`'s `browser` project runs everything under
`src/dashboard/` (`packages/venue-service/vitest.config.ts:27-40`), and `apps/dashboard`'s
`browser` project runs its suites (`apps/dashboard/vitest.config.ts:41`).

**Spec** (read all of it before any task):
- `docs/backlog.md:1356-1359`, the A719 entry.
- `docs/backlog/service-periods.md:184-213`, "## A719. Periods become a window opened from the
  Calendar", points 1–5.
- Mockups `docs/backlog/mockups/a718-a727-calendar-and-stations/13-periods-window.png` and
  `11-periods-page-and-dialog.png`, and that folder's `README.md` ("Board 11 was drawn before
  periods moved into a window (board 13); its list rows and dialog still apply").
- **Owner, 2026-10-17 ~10:45, overriding picture 13:** the window keeps **"+ Add period" at the
  top, beside its "Periods" heading**, as today's page has it (`periods-screen.ts:325-337`) — not
  at the bottom of the list as picture 13 draws it.
- `docs/developers/design-system.md:2496-2504` (Forms): "A destructive action in the row — Delete,
  Clear setting — goes in the `cancel` slot after Cancel, keeping its danger look, the two in one
  wrapping flex group, so Save stands alone on the right: `[Cancel] [Delete] … [Save]`".

The spec's points, quoted:

> 1. **The Periods page and its sidebar entry go; a Periods window replaces them.** It lists the
>    periods grouped by department — colour, name, customer menu, staff-only menus, "Painted in" and a
>    bin — with "+ Add period". A row opens the existing period dialog on top: a period has too many
>    fields to edit inside its row, unlike a season (A721).
> 2. **Where it opens:** a "Periods…" button beside "Seasons…" on the Calendar Year's season row (A721
>    adds "Seasons…"; if A719 lands first it adds "Periods…" alone); the
>    painters' "Periods" link (`periodsLink`, `period-editing.ts`), which today navigates away and now
>    opens the window on top of the painter so unsaved paint stays; and the Departments warning "Set up
>    periods" (`departments-list.ts:219`), which opens the Calendar with the window open. The window
>    uses the Calendar's existing `window/<id>` address pair. Extend its window handler with `periods`,
>    reuse `calendarWindowPath`, and declare the destination in venue-service's `searchDestinations`.
>    Keep the retained painter outside the window's draft ancestry.
> 3. **An unused period shows its colour.** Today a period painted nowhere gets an empty dashed square
>    and a greyed name (`swatch-unpainted`, `periods-screen.ts`); "Not painted anywhere" already says
>    so. Fill the square and drop the grey.
> 4. **No Floor plan column or field until A504.** Remove the disabled field from the period dialog
>    and the column from the list, and change A504's entry — which says they are kept for it — to say
>    A504 adds them back.
> 5. **Delete… moves into the dialog's bottom row**, after Cancel on the left, with Save alone on the
>    right — `[Cancel] [Delete…] … [Save]`, the house rule since 2026-10-16 (design-system.md → Forms);
>    today it sits alone in the body.

The detail's old point 6 (a popup colour chooser) was deleted by A753, which landed it: the period
dialog already uses `wt-colour-chooser` (`period-dialog.ts:468-481`). Line numbers below are against
`main` at `8f9505624`.

**Migration: no.** No table, column, stored value, server route or permission changes. The window
reads what the Periods page reads today (`watchOpeningHours`, `watchPaintedIn`,
`opening-hours-client.ts:41-73`) and writes through the same period routes.

---

## What the code does today (checked)

- **The page.** `VENUE_SERVICE_DASHBOARD.moreScreens` registers `periods` (`index.ts:88-107`,
  `navLabelKey: "nav.periods"`, `requiresPermission: "venue_service.manage"`,
  `readPermission: "venue.view"`), drawn by `dashboard-periods-screen` (`periods-screen.ts`). The
  Calendar (`opening-hours`, `index.ts:108-132`) has the same two permissions, so moving the list
  into it shows it to exactly the same people.
- **The list.** A toolbar with `<h1>` and "+ Add period" (`periods-screen.ts:325-337`); columns
  Period, Customer menu, Staff-only menus, Floor plan (`:304-308`), Painted in, and a pinned
  `actions` column holding a `wt-row-actions` menu of Edit, Open in Calendar and Delete
  (`:231-250`, `:314-323`). An unpainted period gets parts `swatch-unpainted` and `unpainted`
  (`:85-92`, `:205-208`, `:281-286`). Edit and Add go through `PeriodEditing` (`:135-144`); the bin's
  future action is today's `askDelete` (`:385-391`).
- **The dialog.** A disabled Floor plan combobox unless `fromPainter` (`period-dialog.ts:113-114`,
  `:528-537`); Delete… alone in the body (`:539-553`); the footer holds Cancel (cancel slot) and Save
  (`:555-579`). Its draft scope is a root scope: `draftScopeFor` is called with no `parent`
  (`:188-203`). The season dialog shows the parent pattern (`season-dialog.ts:150-151`).
  `PeriodEditing.render` passes `.fromPainter` and the submit label (`period-editing.ts:221`,
  `:237-238`). `fromPainter` has no reader in the dialog but the Floor plan field.
- **The window handler.** `followUrl` accepts only `seasons` and removes any other window by
  replacement (`opening-hours-screen.ts:268-271`), and also rewrites a `seasons` window away when the
  address carries `?station=` (`:257-266`). `navigationScopes` returns `[this.windowDraftRoot]` only
  for `seasons` (`:394`). The window is a compact `wt-modal`, `data-test="calendar-window"`, with a
  footer Close (`:404-444`), drawn last in `render` (`:1542`).
- **The Year's season row** is `season-chips` (`opening-hours-year.ts:485-491`): a flex `.row` of
  chips and "+ Season" (`season-chips.ts:219-269`). **There is no "Seasons…" button on `main`**: the
  Seasons window opens only from its address and page search (`index.ts:25-30`). So A719 adds
  "Periods…" alone, as point 2 allows.
- **The painters' link.** `periodsLink()` is `<a slot="link" data-test="periods-link"
  href="/manage/periods">` (`period-editing.ts:17-22`), used by the season painter
  (`season-painter.ts:635`) and the special-day painter (`special-day-painter.ts:1167-1170`). The
  screen intercepts a plain click on it from the season painter only and navigates away through the
  leave question (`opening-hours-screen.ts:1059-1078`); from the special-day painter the shell's link
  handler takes it (`apps/dashboard/src/dashboard-app.ts:1783`).
- **The Departments warning** is at `departments-list.ts:185-189` (not `:219` as the spec says):
  `<a part="link" href="/manage/periods">Set up periods</a>`.
- **Page search** lists `venue-service:seasons` with path
  `/manage/opening-hours/view/year/window/seasons` (`index.ts:24-55`). The shell's URL config
  already knows the `window` key (`apps/dashboard/src/navigation.ts:10`).
- **No root guard pins the page list.** `git grep` of `scripts/` for `periods`, `opening-hours`,
  `navLabelKey` and `moreScreens` finds only schema tests (`scripts/schema-constraints.test.ts`,
  `scripts/migration-upgrade.test.ts`), none about pages. The lists that pin the page are tests in
  the two packages, named in Tasks 2–7.
- **Unused strings are not guarded.** No test under `scripts/` or `packages/venue-service` checks
  for unread keys (grep for "unused" finds none), so removing keys is housekeeping, not a gate.

## Decisions this plan makes (defaults; each may be overruled)

1. **The window body is today's page element, renamed.** `git mv periods-screen.ts periods-list.ts`
   (`PeriodsScreen` → `PeriodsList`, `dashboard-periods-screen` → `periods-list`), with its five test
   files renamed alike. The screen draws the `wt-modal`, as it does for Seasons.
2. **"+ Add period" beside the heading (owner override).** `wt-modal` has no header slot
   (`packages/ui/src/components/wt-dialog.ts:450-458`). So the Periods window's `wt-modal` gets no
   `heading`; it is named by `aria-label` "Periods", and `periods-list` draws today's toolbar with an
   `<h2>` in place of the `<h1>`, styled like the modal's own heading (`margin: 0; font-size:
   var(--wt-font-size-lg)`, as `wt-dialog.ts:86-90`). Adding a header slot to the shared primitive
   was rejected: one consumer does not justify a primitive change and its a11y tests.
3. **Size:** an unsized (wide) `wt-modal` at the size's own height; the table needs the room. A
   footer Close in the cancel slot, as the Seasons window has (picture 13 draws none; the Seasons
   window's is kept for consistency and as a visible way out on a phone).
4. **Rows:** the `wt-row-actions` menu goes. A period row opens the dialog through `wt-data-table`'s
   tree-mode `rowClick` (`rowActivation`: `"click"` for a period, `"none"` for a department), named
   "Edit {name}" (reusing `painter.edit_period`). The pinned column, still keyed `actions`, holds a
   bin: `<wt-button variant="ghost" data-test="delete-period" aria-label="Delete {name}">` with
   `<wt-icon name="bin">`, as `apps/dashboard/src/screens/floor-plan-tables-panel.ts:263-269` draws
   one; its label reuses `period.delete_named`. "Open in Calendar" goes: the window is in the
   Calendar, and Painted in's chips still open each painter.
5. **Delete… keeps its `secondary` look in the bottom row** (picture 11 and 13 draw it plain). It
   opens a confirmation whose own button is the danger one (`period-delete-dialog.ts:239`). See
   "Open question" below.
6. **A viewer** (`venue.view` without `venue_service.manage`) sees "Periods…" and the list, with no
   "+ Add period", no bin, and rows that do not open, as the read-only page does today
   (`periods-screen.ts:314-316`, `:328-329`).
7. **The painters' link** keeps `data-test="periods-link"` and gets the href
   `/manage/opening-hours/view/year/window/periods` (what a new tab opens). A plain click from
   **either** painter is intercepted by the screen and writes
   `calendarWindowPath(<current path>, "periods")`, so the window opens over the painter.
8. **"Periods…" is slotted into `season-chips`.** `season-chips` gets a default `<slot>` at the end
   of its `.row`, after "+ Season"; the Year puts the button there and emits
   `calendar-window-open` (`detail: { window: "periods" }`, `bubbles: true, composed: true`); the
   screen handles it. The Month's key-only chips and the Seasons window leave the slot empty.
9. **No redirect for an old `/manage/periods` bookmark** (CLAUDE.md §3, "No backwards-compatibility
   or data-migration code until Waitron is in production"): it falls back as any unknown page does
   (the A182 case, `apps/dashboard/src/dashboard-app.test.ts:8247-8255`).
10. **Search:** `{ id: "venue-service:periods", screen: "opening-hours", labelKey: "period.title",
    path: "/manage/opening-hours/view/year/window/periods" }`, listed after `venue-service:seasons`.
11. **Strings:** new `period.open_window` — en "Periods…", es "Periodos…". Removed once nothing
    reads them: `nav.periods` (the link's text becomes `period.title`), `period.floor_plan`,
    `period.floor_plan_later`, `period.open_hours`, `menu.row_actions`, `menu.edit` (each read only
    by `periods-screen.ts` today; re-grep before deleting). `menu.actions` stays (the bin column's
    heading).
12. **Unchanged, left open:** a painter opened from a Painted in chip in the window closes to the
    Year without the window (the shell pushes the painter address, so `closePainter` replaces to
    `baseHref`, `opening-hours-screen.ts:1029-1035`). Its backlog entry (`docs/backlog.md:1457-1458`)
    is reworded, not fixed.

## Open question for the owner (with the default this plan uses)

- **Delete…'s look in the bottom row.** The house rule says a destructive action there keeps "its
  danger look"; the period dialog's Delete… has always been `secondary`, because it only opens the
  delete dialog, and both mockups draw it plain. **Default: keep `secondary`** (Decision 5). If the
  owner wants red, it is one attribute and one assertion (Task 1).

---

## Global constraints

- **Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a719-periods-window`, branch
  `feat/a719-periods-window`. Every commit `git commit -s`. **One pull request.**
- **Test first.** Each task writes its failing test, runs it, sees it fail for the stated reason,
  then writes the code.
- **Task size.** Each task is meant to finish well under 100 tool calls. An implementer past about
  150 with its task unfinished stops at a passing or cleanly red point, commits, and hands over:
  done, left, files, each check's state.
- **Focused runs** (check `memory_pressure | grep free` first; beside another session's browser run
  only when free memory is well above 15%):

  ```bash
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/dashboard exec vitest run --project browser src/<file>.test.ts
  ```

  Read the `Tests` count; a run without one proves nothing. Before the PR, run
  `pnpm --filter @waitron/venue-service test:coverage` once (new and renamed files must hold
  98/98/98/95); CI owns the package suites.
- **Every implementer dispatch** also runs `pnpm format:check`, and
  `pnpm --filter <pkg> typecheck` and `lint` for each package it touched.
- **Changing an existing test check** is allowed only where the spec changes what it checks. Each
  task lists them under "Existing checks that change", and the PR description repeats the list under
  **"Changed test checks"**. Deleting a check without an equally strict new one is a STOP: report
  it instead. Helper and fixture changes (a selector for the row's activator, a painted-in answer in
  a request stub) are setup, listed too, with the assertions after them unchanged.
- **Strings:** every new string in `en` and `es` in
  `packages/venue-service/src/dashboard/strings.ts`; product text as short as the meaning allows.
- **CLAUDE.md rules that bite here:**
  - Draft scopes (§3): the period dialog keeps its `draftScopeFor`; in the window it is parented
    under `windowDraftRoot`; the window holds no draft of its own.
  - Events (§3): app events named plainly, `{ bubbles: true, composed: true }`, payload in
    `detail`; the screen's listener calls `event.stopPropagation()` first.
  - A history assertion spies on `history.pushState`/`replaceState` (`pushedPaths()`,
    `opening-hours-screen.painter.test.ts:113-118`), never `history.length` (§4).
  - A close is awaited by its event (`wt-close`, `period-close`), never a bare timer (§4).
  - A width is set with `page.viewport(w, h)` and `window.innerWidth` asserted; a test that sets
    Spanish restores English in `finally` or `afterEach`.
  - A `wt-data-table` cell is styled through `::part()`, never a class (§3).
  - Tokens only for colour, spacing, radius and font.
  - `wt-data-table`'s row-menu column stays keyed `actions` and `pinned: "end"`
    (`scripts/pinned-actions-column.test.ts`).
- **Review path: FULL.** The PR removes a dashboard route (`/manage/periods` and its sidebar entry)
  and adds one (`window/periods`, reached from the Year, both painters, the Departments warning and
  page search), and it changes which unsaved drafts the leave question covers beside a painter's
  unsaved paint — a path that loses a manager's work silently if wrong. Per-task reviews, then
  `/finish-branch` with the Codex run-it seat twice (the second told to set this plan aside and test
  what it does not name). No stored record, migration, server route or permission changes.
- **Ledger:** `docs/handoffs/2026-10-17-a719-periods-window.md` (gitignored), opening
  `Status: in progress`; update it at the end of every task; `Status: done` when the PR lands.

## Review Focus

1. **A painter with unsaved paint, the Periods window over it, and an unsaved edit in the window's
   period dialog; then Back.** Expected: the leave question names only the dialog's draft; Keep
   stays in the window with the edit; Discard closes the window, and the painter is the same element
   with the same paint, still dirty. Pinned in Task 4 (address) and Task 6 (through the link).
2. **Escape in the period dialog inside the window.** Expected: only the dialog closes; the window
   and its address stay. Pinned in Task 4.
3. **A period added in the window while a painter is underneath.** Expected: after closing the
   window, the painter's paint row offers the new period, and the painter's earlier paint is still
   there. Pinned in Task 6.
4. **A viewer opens the window.** Expected: the list, with no "+ Add period", no bin column, and a
   row press opens nothing. Pinned in Tasks 3 and 4.
5. **A phone (390 px).** Expected: the window fits the screen width, every bin is on screen, and a
   tap on a row opens its dialog. Pinned in Task 3.

---

## Task 1: The period dialog — no Floor plan, Delete… in the bottom row, a draft parent

**Files:**
- Modify: `packages/venue-service/src/dashboard/period-dialog.ts` (`:113-114`, `:187-203`,
  `:528-579`)
- Modify: `packages/venue-service/src/dashboard/period-editing.ts` (`:46-61`, `:221-238`)
- Test: `period-dialog.test.ts`, `period-dialog.a11y.test.ts`, `period-dialog.unsaved.test.ts`
  (all under `packages/venue-service/src/dashboard/`)

**Interfaces:**
- Produces: `PeriodDialog.draftParent?: object` (`@property({ attribute: false })`), passed to
  `draftScopeFor` as `parent`. `PeriodEditing` options gain `draftParent?: () => object | undefined`,
  rendered as `.draftParent=${this.options.draftParent?.()}`. `PeriodDialog.fromPainter` is
  removed; `PeriodEditing` keeps its local `fromPainter` for `submitLabel` only.

- [ ] **Step 1: Write the failing tests.**
  - `period-dialog.test.ts`, the field-order case (`:127-138`): the order is
    `["name", "colour", "menuId", "staffMenuIds", "endOffsetMinutes"]`.
  - Replace "the floor plan field is shown disabled…" (`:553-581`) with **"no Floor plan field when
    adding or editing, and a save sends no floor plan"**: for an add (`mount(true)`) and an edit
    (`mountEdit`), `[name=floorPlanId]` is null and the text holds neither "Floor plan" nor (in
    Spanish) "Plano de sala"; the existing save-keys assertion (`["colour", "endOffsetMinutes",
    "menuId", "name", "staffMenuIds"]`) stays word for word.
  - Delete "adding from a painter shows no floor plan field" (`:583-588`): the case above covers
    every state, and `fromPainter` no longer exists.
  - "Delete… shows only when deletable and editing" (`:931-951`): replace
    `closest("wt-form-actions")).toBeNull()` with: the button's `closest("wt-form-actions")` is the
    dialog's footer row; its slotted cancel group holds, in order, Cancel then Delete… (read the
    group's `wt-button` texts: `["Cancel", "Delete…"]`); Save is the only `wt-button` in the
    default slot; the body (`.form`) holds no `[data-test=delete-period]`. `variant` stays
    `"secondary"`.
  - Add **"Delete… sits left of Save, after Cancel, at 1280 and 390 px"**: with `page.viewport`,
    Cancel's right ≤ Delete…'s left and Delete…'s right < Save's left at 1280; at 390 all three
    buttons are inside `window.innerWidth`.
  - `period-dialog.unsaved.test.ts`: add **"a dialog given a draft parent is asked about only with
    that parent"**: inside the file's leave app, open a dialog with `draftParent = root`, change the
    name; `coordinator.request({ scopes: [root], reason: "navigation", proceed })` shows the
    question; a request for `scopes: [{}]` (another root) proceeds without asking; with no
    `draftParent`, `scopes: [root]` proceeds without asking.
  - `period-dialog.a11y.test.ts:100-104`: drop the `floorPlanId` disabled assertion; add for the
    `deletable` state that `[data-test=delete-period]` is inside `wt-form-actions`.

- [ ] **Step 2: Run them, see them fail** on the field order, the Floor plan field, Delete…'s place
  and the draft parent:
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/period-dialog.test.ts src/dashboard/period-dialog.unsaved.test.ts src/dashboard/period-dialog.a11y.test.ts`

- [ ] **Step 3: Implement.** In `period-dialog.ts`: delete the Floor plan block and `fromPainter`;
  move Delete… out of `.form` into the footer as `<div slot="cancel" class="cancel-group">` holding
  Cancel then Delete… (the pattern and CSS of `routing-cell-editor.ts:84-88`, `:688-715`); pass
  `parent: this.draftParent` to `draftScopeFor`. In `period-editing.ts`: stop passing
  `.fromPainter`; add the `draftParent` option and pass it.

- [ ] **Step 4: Run the three files, then the painter suites that open this dialog**
  (`season-painter.test.ts`, `special-day-painter.paint.test.ts`, `periods-screen.editing.test.ts`,
  `periods-screen.delete.test.ts`): all pass. `season-painter.test.ts:212` (`floorPlanId` null) and
  `:340` (no Delete… from a painter) stay unchanged and green.

- [ ] **Step 5: Commit** — `git commit -s -m "The period dialog drops Floor plan and puts Delete… beside Cancel (A719)"`

**Existing checks that change:** `period-dialog.test.ts:131-138` (order loses `floorPlanId`),
`:553-581` (Floor plan shown → absent; save keys kept), `:583-588` (deleted, covered by the
all-states case), `:938` (Delete… not in the footer → in the footer's cancel group);
`period-dialog.a11y.test.ts:100-104` (disabled Floor plan → Delete… in the footer).

## Task 2: Rename the Periods page element to `periods-list` (no behaviour change)

**Files:**
- Rename: `periods-screen.ts` → `periods-list.ts`; `periods-screen.test.ts`, `.a11y.test.ts`,
  `.delete.test.ts`, `.editing.test.ts`, `.unsaved.test.ts` → `periods-list*.test.ts` (all with
  `git mv`)
- Modify: `packages/venue-service/src/dashboard/index.ts:13`, `:101-104`;
  `packages/venue-service/src/dashboard/index.test.ts` (imports and the element name);
  `apps/dashboard/src/dashboard-app.test.ts:8217` (`dashboard-periods-screen` → `periods-list`)

**Interfaces:**
- Produces: `export class PeriodsList` in `periods-list.ts`, `@customElement("periods-list")`,
  `HTMLElementTagNameMap["periods-list"]`; `export type PeriodRow` unchanged.

- [ ] **Step 1:** `git mv` the six files; replace `PeriodsScreen`, `dashboard-periods-screen`,
  `./periods-screen.js` in them and in the two `index` files and `dashboard-app.test.ts:8217`. The
  page stays registered and renders `<periods-list>`.
- [ ] **Step 2:** Run the five renamed files, `index.test.ts`, and
  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/dashboard-app.test.ts -t "Periods link"`:
  the same counts as before the rename, all passing. `git grep -n "periods-screen\|PeriodsScreen"`
  finds only docs (Task 8 handles them).
- [ ] **Step 3: Commit** — `git commit -s -m "Rename the Periods page element to periods-list (A719)"`

**Existing checks that change:** none (names only).

## Task 3: The list fits a window — heading and Add on top, a bin, rows that open, no Floor plan, filled swatches

**Files:**
- Modify: `packages/venue-service/src/dashboard/periods-list.ts` (`:64-74`, `:85-92`, `:129-145`,
  `:205-250`, `:272-357`)
- Modify: `packages/venue-service/src/dashboard/strings.ts` (remove `period.floor_plan`,
  `period.floor_plan_later`, `period.open_hours`, `menu.row_actions`, `menu.edit` in en and es once
  `git grep` shows no reader)
- Test: `periods-list.test.ts`, `periods-list.a11y.test.ts`, `periods-list.editing.test.ts`,
  `periods-list.delete.test.ts`, `periods-list.unsaved.test.ts`

**Interfaces:**
- Consumes: Task 1's `PeriodEditing` option `draftParent`.
- Produces: `PeriodsList.draftParent?: object` (`@property({ attribute: false })`), handed to
  `PeriodEditing` as `draftParent: () => this.draftParent`. Markup the later tasks select:
  `h2` (the heading), `[data-test=add-period]`, `tr[data-row-key="period:<id>"] button.row-activate`
  (the row's activator, drawn by `wt-data-table`), `[data-test=delete-period]` (the bin).

- [ ] **Step 1: Write the failing tests** (in `periods-list.test.ts` unless named).
  - **"heading and + Add period share the top row"**: `h2` reads "Periods" (es "Periodos"); the add
    button's top is within the `h2`'s vertical extent and its left is right of the `h2`'s right; no
    `h1`.
  - **"an unused period shows its colour"** (replaces `:258-269`): for `p2` (painted nowhere) the
    swatch's computed `background-color` equals that of a painted swatch of the same colour drawn in
    the same table (add a painted green period to the fixture), its `part` holds no
    `swatch-unpainted`, and the name's computed `color` equals `p1`'s name colour; "Not painted
    anywhere" is still shown in Painted in. The rest of that case (`p3`'s empty Painted in) stays.
  - **"no Floor plan column"** (replaces `:179-193`'s floor-plan half): `grid.columns` keys are
    `["period", "customerMenu", "staffMenus", "paintedIn", "actions"]`; no `[part=unavailable]`. The
    case's menu, staff-menu and swatch assertions stay word for word.
  - **"a period row opens its dialog; a department row opens nothing"** (replaces `:278-298`):
    `rowActivation` gives `"click"` for every period row and `"none"` for every department row; the
    activator in `period:p1` is named "Edit Lunch"; `userEvent.click` on a period's Customer menu cell
    opens `period-dialog` with `period.id === "p1"`; the pinned `actions` column (`pinned: "end"`)
    holds, per period, one `[data-test=delete-period]` named "Delete Lunch" containing
    `wt-icon[name=bin]`, and department rows hold none; no `wt-row-actions` anywhere; clicking the bin
    opens `period-delete-dialog` for that period and **no** period dialog.
  - **"a viewer…"** (`:300-307`): keep every assertion; add: no row has an activator
    (`button.row-activate` count 0).
  - **Spanish** (`:377-404`): `h2` in place of `h1`; the headers no longer contain "Plano de sala"
    (assert `not.stringContaining`); the `open-hours` assertion becomes the bin's name "Eliminar
    Lunch".
  - **M1 fit** (`:406-476`): mount the list inside an open, unsized `wt-modal` (the window's real
    width) instead of the 898 px frame, at `page.viewport(1280, 900)`; every assertion after the
    mount stays.
  - `periods-list.a11y.test.ts:192-213` "row menus stay on screen" becomes **"bins stay on screen at
    1280 and 390"**: inside an open unsized `wt-modal`, 4 bins, each with width > 0 and inside
    `[0, window.innerWidth]`. Its states loop (`:174-190`) stays; the `delete*` states already click
    `[data-test=delete-period]` in the row (`:147`), which the bin keeps.
  - `periods-list.editing.test.ts:401-418` becomes **"on a phone a row tap opens its dialog and its
    bin is on screen"** (`userEvent.click` on the row's Customer menu cell at 390 px; the dialog's
    `period.id` is `p1`; the bin's box is inside the viewport).
  - Setup only: `editButton` (`periods-list.editing.test.ts:114-120`), `rowButton(…, "edit-period")`
    (`periods-list.delete.test.ts:839`, `:853`, `:925`) and the unsaved mount
    (`periods-list.unsaved.test.ts:82`) select `tr[data-row-key="period:<id>"] button.row-activate`.

- [ ] **Step 2: Run the five files and see the new and changed cases fail** for the reasons above.

- [ ] **Step 3: Implement** in `periods-list.ts`: `h1` → `h2` with the modal heading's size; drop
  the Floor plan column, `unpainted()`, the `swatch-unpainted`/`unpainted` parts and their CSS;
  replace `actions()` with the bin; when not read-only set `.rowClick=${(row) => this.edit(row)}`,
  `.rowClickLabel` and `.rowActivation`; add `draftParent`. Remove the strings that lost their
  readers.

- [ ] **Step 4: Run the five files, then `index.test.ts`**: all pass.

- [ ] **Step 5: Commit** — `git commit -s -m "Periods list: Add beside the heading, a bin, rows that open, no Floor plan (A719)"`

**Existing checks that change:** `periods-list.test.ts:179-193` (greyed Floor plan → no Floor plan
column), `:258-269` (unpainted parts → filled swatch, plain name), `:278-298` (row menu with Edit,
Open in Calendar, Delete; `h1` → bin, row activator; `h2`), `:300-307` (adds no activator),
`:377-404` (`h1`, "Plano de sala", "Abrir en Calendario" → `h2`, absent, bin name), `:406-476`
(898 px frame → real window); `periods-list.a11y.test.ts:192-213` (row menus → bins);
`periods-list.editing.test.ts:401-418` (menu → row tap).

## Task 4: The Calendar's `periods` window

**Files:**
- Modify: `packages/venue-service/src/dashboard/opening-hours-paths.ts` (add the window ids)
- Modify: `packages/venue-service/src/dashboard/opening-hours-screen.ts` (`:255-273`, `:385-395`,
  `:404-444`, `:1542`; import `./periods-list.js`)
- Modify: `packages/venue-service/src/dashboard/index.ts:24-30` (the search destination)
- Test: `opening-hours-paths.test.ts`, `opening-hours-screen.painter.test.ts` (its "the Calendar
  window address" describe, `:760-858`, and the Seasons draft case at `:860`), `opening-hours-screen.a11y.test.ts`,
  `packages/venue-service/src/dashboard/index.test.ts:393-402`

**Interfaces:**
- Produces: in `opening-hours-paths.ts`,
  `export const CALENDAR_WINDOWS = ["seasons", "periods"] as const;`
  `export type CalendarWindow = (typeof CALENDAR_WINDOWS)[number];`
  `export const periodsWindowPath = calendarWindowPath(hoursPath(), "periods");` (=
  `/manage/opening-hours/view/year/window/periods`). In the screen,
  `private openWindow(id: CalendarWindow): Promise<void>` (writes
  `calendarWindowPath(<current path>, id)` through `writeAddress`, a push) and a listener for
  `calendar-window-open` (`CustomEvent<{ window: CalendarWindow }>`) that Tasks 5 and 6 reuse. The
  periods window is `wt-modal[data-test=calendar-window][data-window=periods]`, `aria-label`
  `period.title`, holding `periods-list` with `.api`, `.readOnly` and
  `.draftParent=${this.windowDraftRoot}`, and the same footer Close
  (`[data-test=close-calendar-window]`). The Seasons window gets `data-window="seasons"`.

- [ ] **Step 1: Write the failing tests.**
  - `opening-hours-paths.test.ts`: `periodsWindowPath` is
    `"/manage/opening-hours/view/year/window/periods"`; `calendarWindowPath(base + "/window/seasons",
    "periods")` swaps the pair.
  - In the painter test's window describe (setup: the file's `request` answers
    `/menu-periods/painted-in` with `[]` before its catch-all):
    - **"opens Periods after loading and closes only its window pair"**, the Seasons case's shape:
      `/manage/opening-hours/view/year/year/2027/window/periods` draws the modal with
      `aria-label` "Periods" and a `periods-list` whose table lists the fixture's periods; Close
      returns to `/manage/opening-hours/view/year/year/2027` with the Year drawn.
    - **"a viewer's Periods window lists periods with nothing to change"** (Review Focus 4): mounted
      read-only, `periods-list.readOnly` is true, no `[data-test=add-period]`, no bin, no activator.
    - **"a station address loses its Periods window"**: `…/view/year/window/periods?station=s1`
      replaces to an address with no `window` pair, as `:257-266` does for Seasons.
    - **"window-only Back and Forward retain the painter and its paint under Periods"**: the
      `:816-858` case with `window/periods`.
    - **"closing the Periods window protects its period draft and keeps the painter's paint"**
      (Review Focus 1): painter with dragged paint; `guard.write(`${base}/window/periods`)`; open a
      period from the window's list (row activator), change its name; `guard.write(base)` → Keep →
      still at `…/window/periods`, the name kept; again → Discard → at `base`, `painterOf(el)` is the
      same element, `painter.edited()` unchanged, `app.leave.coordinator.isDirty()` true.
    - **"Escape in the window's period dialog closes only the dialog"** (Review Focus 2): open a
      period, press Escape (`userEvent.keyboard("{Escape}")`), await the dialog's `period-close`;
      the window is still drawn and `location.pathname` still ends `/window/periods`.
    - The existing "removes an unknown window…" case (`:809-815`) stays as it is.
  - `opening-hours-screen.a11y.test.ts` (setup: `request` answers `/menu-periods/painted-in` with
    `[]`): in both themes, `/manage/opening-hours/view/year/window/periods`, editable and read-only,
    has no axe violations once the list's table is drawn.
  - `index.test.ts:397-402`: the destinations list becomes
    `[".../window/seasons", ".../window/periods", ".../view/year", ".../view/month", ".../view/week"]`.

- [ ] **Step 2: Run them, see the window cases fail** (the unknown-window rule removes
  `window/periods` today):
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/opening-hours-paths.test.ts src/dashboard/opening-hours-screen.painter.test.ts src/dashboard/opening-hours-screen.a11y.test.ts src/dashboard/index.test.ts`

- [ ] **Step 3: Implement.** `followUrl` accepts any `CALENDAR_WINDOWS` id (and applies the
  station rule to all of them); `navigationScopes` returns `[this.windowDraftRoot]` whenever a
  window is open; `seasonsWindow()` becomes `calendarWindow()` drawing either window with shared
  close handling; add `openWindow` and the `calendar-window-open` listener on the screen's
  `render` root; add the search destination (Decision 10).

- [ ] **Step 4: Run the four files, then the other screen files**
  (`opening-hours-screen.test.ts`, `.special-day.test.ts`, `.unsaved.test.ts`, `.week.test.ts`):
  all pass.

- [ ] **Step 5: Commit** — `git commit -s -m "The Calendar opens a Periods window at window/periods (A719)"`

**Existing checks that change:** `index.test.ts:397-402` (the destinations list gains
`window/periods`). Setup: `opening-hours-screen.painter.test.ts:36-57` and
`opening-hours-screen.a11y.test.ts:18-78` answer the painted-in read.

## Task 5: "Periods…" on the Year's season row

**Files:**
- Modify: `packages/venue-service/src/dashboard/season-chips.ts` (`:219-269`: a default `<slot>` at
  the end of `.row`)
- Modify: `packages/venue-service/src/dashboard/opening-hours-year.ts` (`:485-491`)
- Modify: `packages/venue-service/src/dashboard/opening-hours-screen.ts` (the Year's listener,
  `:1504-1531`, if the root listener of Task 4 does not already hear it)
- Modify: `strings.ts` (add `period.open_window`)
- Test: `season-chips.test.ts`, `opening-hours-year.test.ts`, `opening-hours-screen.painter.test.ts`

**Interfaces:**
- Consumes: Task 4's `calendar-window-open` handling.
- Produces: `wt-button[data-test=open-periods]` in the Year's `season-chips`, text "Periods…"
  (es "Periodos…"), dispatching `calendar-window-open` with `{ window: "periods" }`.

- [ ] **Step 1: Write the failing tests.**
  - `season-chips.test.ts`: **"slotted content follows + Season on the chips' row"**: a slotted
    button's box shares the row with "+ Season" (same `offsetParent` row, left of it is "+ Season"'s
    right); key-only chips with a slotted child still draw it after the chips.
  - `opening-hours-year.test.ts`: **"the season row ends with Periods…, also for a viewer, which asks
    for the Periods window"**: "Periods…" is the last slotted element of the Year's `season-chips`,
    shown read-only too; `userEvent.click` dispatches one `calendar-window-open` with
    `detail: { window: "periods" }` that is `composed`; Spanish reads "Periodos…".
  - Painter test window describe: **"Periods… on the Year pushes window/periods and Back closes
    it"**: `pushedPaths()` records `["/manage/opening-hours/view/year/window/periods"]`; the window
    is drawn; `history.back()` → `/manage/opening-hours/view/year`, no window.
- [ ] **Step 2: Run the three files; the new cases fail** (no slot, no button).
- [ ] **Step 3: Implement** the slot, the button and its event, and the string.
- [ ] **Step 4: Run the three files and `opening-hours-year.a11y.test.ts`**: all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "The Year's season row offers Periods… (A719)"`

**Existing checks that change:** none.

## Task 6: The painters' Periods link opens the window over the painter

**Files:**
- Modify: `packages/venue-service/src/dashboard/period-editing.ts:17-22` (`periodsLink`)
- Modify: `packages/venue-service/src/dashboard/opening-hours-screen.ts:1059-1078` (move the click
  interception into one handler used by both `season-painter` and `special-day-painter`)
- Test: `opening-hours-screen.painter.test.ts`, `opening-hours-screen.special-day.test.ts`,
  `special-day-painter.paint.test.ts`

**Interfaces:**
- Consumes: Task 4's `openWindow("periods")` and `periodsWindowPath`.
- Produces: `periodsLink()` → `<a slot="link" data-test="periods-link" href=${periodsWindowPath}>`
  with text `t("period.title")`.

- [ ] **Step 1: Write the failing tests.**
  - `opening-hours-screen.painter.test.ts:424-445` ("the Periods link asks first…") becomes **"the
    Periods link opens the window over a painter with paint, asking nothing, and closing it returns
    to the same paint"**: drag paint; click the link; no question opens
    (`wt-unsaved-changes.open` false); `location.pathname` is
    `/manage/opening-hours/view/season/season/winter/department/d1/window/periods`; `painterOf(el)`
    is the same element; Close → back at the painter address, `painter.edited()` unchanged,
    `isDirty()` true, `app.writes` empty.
  - `:313-341` ("closing a painter loaded directly, after its Periods link and Back, closes onto the
    Year view"): the link now opens the window, so after the click the path is the painter's plus
    `/window/periods`; `history.back()` returns to the painter address with the painter drawn; the
    remaining assertions (cancel → `/manage/opening-hours/view/year`) stay word for word.
  - **"a period added in the Periods window reaches the painter underneath"** (Review Focus 3):
    painter with paint; open the window by the link; "+ Add period", fill and save (the request stub
    answers the create and the next model read lists the new period); close the window; the
    painter's paint row offers the new period's chip and `painter.edited()` is unchanged.
  - **"a modified click on the Periods link is left to the browser"**: a `ctrlKey` click is not
    prevented by the screen (`event.defaultPrevented` false in a capturing listener on `document`,
    whose handler then prevents it so the test page does not navigate).
  - `opening-hours-screen.special-day.test.ts`: **"the special-day painter's Periods link opens the
    window over it and keeps its unsaved day"**: change the day; click the link; path ends
    `/window/periods`, the same `special-day-painter` element, still dirty; Back → the painter
    address, still dirty.
  - `special-day-painter.paint.test.ts:499-511`: both `href` assertions become
    `"/manage/opening-hours/view/year/window/periods"`; text "Periods" and `slot` "link" stay.
- [ ] **Step 2: Run the three files; the new and changed cases fail** (the link still goes to
  `/manage/periods`).
- [ ] **Step 3: Implement** the link and the shared interception (same modifier and
  `defaultPrevented` checks as `:1067-1075`).
- [ ] **Step 4: Run the three files and `season-painter.test.ts`**: all pass.
- [ ] **Step 5: Commit** — `git commit -s -m "A painter's Periods link opens the Periods window over it (A719)"`

**Existing checks that change:** `opening-hours-screen.painter.test.ts:326-328` (lands on
`/manage/periods` → on the painter's address plus `/window/periods`), `:424-445` (asks and leaves →
opens over the painter and keeps the paint); `special-day-painter.paint.test.ts:504`, `:510` (href).

## Task 7: The Periods page and its sidebar entry go; "Set up periods" opens the window

**Files:**
- Modify: `packages/venue-service/src/dashboard/index.ts` (delete `:88-107` and the
  `./periods-list.js` import, which `opening-hours-screen.ts` now makes)
- Modify: `packages/venue-service/src/dashboard/departments-list.ts:188`
  (`href=${periodsWindowPath}`)
- Modify: `strings.ts` (remove `nav.periods`, en `:723` and es `:1587`)
- Test: `packages/venue-service/src/dashboard/index.test.ts:292-344`,
  `departments-list.test.ts:181-183`, `departments-list-readiness.a11y.test.ts:160`, `:211`,
  `apps/dashboard/src/dashboard-app.test.ts:6526-6532`, `:8197-8241`, a new A182-style case, and
  `apps/dashboard/src/dashboard-app.search-modules.test.ts`

**Interfaces:**
- Consumes: Task 4's `periodsWindowPath` and search destination.

- [ ] **Step 1: Write the failing tests.**
  - `index.test.ts`: replace "registers Periods between Opening hours and Prep stations, readable
    with venue.view" (`:292-331`) with **"the Periods destination opens the Calendar's window,
    read-only for a viewer"**: at `/manage/opening-hours/view/year/window/periods`, render the
    `opening-hours` entry's `handle.render(true)`; its window's `periods-list` has `readOnly` true,
    its `api.liveData` is the context's, and no `[data-test=add-period]` once the table draws;
    `render(false)` → `readOnly` false and the add button present. In "registers Opening hours
    without a separate Station hours page" (`:333-344`) the ids become
    `["venue-operations", "prep-stations", "opening-hours"]`.
  - `departments-list.test.ts:181-183` and `departments-list-readiness.a11y.test.ts:160`, `:211`:
    the link's href is `"/manage/opening-hours/view/year/window/periods"`; its text and fit
    assertions stay.
  - `dashboard-app.test.ts:6526-6532`: the operations group is `["nav-venue-operations",
    "nav-opening-hours", "nav-prep-stations", "nav-venue-settings"]`.
  - `:8197-8219` becomes **"the real Set up periods link keeps Settings edits until Discard and then
    pushes the Calendar's Periods window"**: every assertion stays with `/manage/periods` replaced by
    `/manage/opening-hours/view/year/window/periods`, and `dashboard-periods-screen` (now
    `periods-list`) found inside `dashboard-opening-hours-screen`'s
    `[data-test=calendar-window][data-window=periods]`. Setup: that suite's request stub answers the
    Calendar's reads (year, stations, special days, painted in).
  - `:8221-8241` (Back and Forward): the same replacement, and its `history.length` checks become a
    `history.pushState` spy showing no push across Back, Keep and Forward (CLAUDE.md §4; equally
    strict).
  - New **"an old Periods page address falls back to the role home"**, the A182 case's shape
    (`:8247-8255`) at `/manage/periods`.
  - `dashboard-app.search-modules.test.ts` (setup: the stub answers `/menu-periods/painted-in` with
    `[]`): **"searching peri finds Periods in the Calendar and opens its window"**: the result
    `venue-service:periods` exists and no `[data-test=nav-periods]` does; clicking it goes to
    `/manage/opening-hours/view/year/window/periods` with the list drawn; axe passes on the window in
    both themes.
- [ ] **Step 2: Run the five files; the changed and new cases fail.**
- [ ] **Step 3: Implement** the removals and the href.
- [ ] **Step 4: Run them**, plus `apps/dashboard/src/nav-destinations.test.ts` and
  `dashboard-app.search-destinations.test.ts`: all pass. `git grep -n '/manage/periods\|nav\.periods\|nav-periods'`
  finds only the new fallback case and docs that Task 8 rewrites.
- [ ] **Step 5: Commit** — `git commit -s -m "Periods leaves the sidebar; Set up periods opens the Calendar's window (A719)"`

**Existing checks that change:** `index.test.ts:292-331` (page registration → window destination,
viewer case kept), `:337-342` (ids lose `periods`); `departments-list.test.ts:182`,
`departments-list-readiness.a11y.test.ts:160`, `:211` (href); `dashboard-app.test.ts:6529` (sidebar
loses `nav-periods`), `:8197-8241` (destination; `history.length` → `pushState` spy).

## Task 8: Docs and backlog

**Files:** `docs/developers/design-system.md`, `docs/developers/dashboard-live-updates.md`,
`packages/venue-service/src/dashboard/live-queries.ts:182` (comment), `docs/backlog.md`,
`docs/backlog/service-periods.md`, `docs/backlog/till.md`, `docs/backlog/dashboard.md`.

- [ ] `design-system.md:4713-4760` "### Periods page" → "### Periods window": the address
  (`window/periods` over any Calendar view or painter), what opens it (Year's "Periods…", both
  painters' link, the Departments warning, page search), the toolbar (`h2` and Add, Decision 2),
  columns without Floor plan, a filled swatch for an unused period, rows that open the dialog, the
  bin, the viewer's view, the draft parent; the dialog paragraph loses the disabled Floor plan and
  puts Delete… in the bottom row after Cancel. Also `:688` and `:1049` ("the Periods page" → "the
  Periods window"), `:2139-2141` ("opened from the Periods page's '+ Add period'" → "the Periods
  window's"), `:2146` (say what the Periods link opens), and `:3189-3193` (the window pair now opens
  Seasons and Periods; drop "A719 can reuse…").
- [ ] `dashboard-live-updates.md:45`, `:94` and the `live-queries.ts:182` comment: "Periods page" →
  "Periods window". Before editing, `git grep -n "Periods page\|periods page"` across `docs/developers`,
  `packages`, `apps` and root READMEs, and fix every hit (CLAUDE.md §1, "A behaviour change retires
  every receipt").
- [ ] `docs/backlog.md:1356-1359`: delete the A719 entry. `docs/backlog/service-periods.md:184-213`:
  delete the section. Add to its "## Decisions and deliberate limits": Decisions 2 (Add beside the
  heading, owner 2026-10-17), 4 (no Open in Calendar; rows open the dialog), 5 (Delete… stays
  secondary) and 9 (no redirect for `/manage/periods`).
- [ ] A504: `docs/backlog.md:2380-2382` "Until it lands, the Periods page's Floor plan column shows a
  muted dash, and the period dialog a disabled Floor plan field except when a painter's + New period
  opens it (`periods-screen.ts`, `period-dialog.ts`)" → "A504 adds a Floor plan column to the Periods
  window and a Floor plan field to the period dialog (`periods-list.ts`, `period-dialog.ts`); A719
  removed the placeholders." `docs/backlog/till.md:524-525` "A506's Periods page and period dialog
  already leave a Floor plan column and field for it." → "A504 adds the Floor plan column to the
  Periods window and the field to the period dialog."
- [ ] `docs/backlog.md:1457-1458` → "A painter opened from a Painted in chip in the Periods window
  closes to the Calendar's Year, not back to the window" (Decision 12), keeping its origin note.
- [ ] `docs/backlog/dashboard.md:922`: "Periods moves into the Calendar under A719" → "Periods is
  registered as `venue-service:periods`, a window in the Calendar (A719)".
- [ ] A721's section (`service-periods.md:215-232`) needs no edit: it already says A721 adds its own
  "Seasons…" button; the Year's season row now ends with "Periods…", and "Seasons…" goes before it.
- [ ] `pnpm exec prettier --file-info` is not needed for `docs/` (ignored); run `pnpm format:check`
  for the `.ts` comment. Commit — `git commit -s -m "docs: the Periods window replaces the Periods page (A719)"`

## Task 9: LOOK

- [ ] Start the dev stack from this worktree: `wa-wt demo waitron-feat-a719-periods-window` (never a
  bare `pnpm dev*`; `lsof` the venue folder and port 8080 before any `wa-wt reset`). If the demo
  venue has no period painted nowhere, add one in the window and say so in the PR.
- [ ] With the workspace's Playwright Chromium, at 390 px and 1280 px wide, light and dark (set
  `data-theme` on `document.documentElement`; record `window.innerWidth` and the computed background
  of the page and of the window's dialog; reject a capture whose light and dark colours match),
  capture:
  1. the Year with "Periods…" at the end of the season row;
  2. the Periods window (heading and "+ Add period" on one line at 1280; how they wrap at 390), the
     unused period's filled swatch beside a painted one, the bins;
  3. the period dialog's bottom row, `[Cancel] [Delete…] … [Save]`, at both widths;
  4. a season painter with paint, then its Periods link: the window over the painter; after Close,
     the paint still there.
- [ ] Save under an ignored `__screenshots__/look/` folder (`.gitignore:20`) or outside the repo;
  list what was looked at, and anything that looked wrong, in the PR under "LOOK".
- [ ] Update the ledger; tell the owner the branch is ready for `/finish-branch`.

---

## PR description must carry

- First line in plain words: the Periods page is now a window in the Calendar.
- "Changed test checks": the union of every task's "Existing checks that change", each with its
  reason (spec point 1, 2, 3, 4 or 5).
- "Open question": Delete…'s look (Decision 5).
- "LOOK": what Task 9 captured.
- No migration; no server change.
