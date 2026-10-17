# A753 points 2 and 3 — one colour chooser, and who holds each staff role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** One shared colour chooser — a field showing the chosen colour that opens a small panel of
colours — used by the period dialog and the staff role dialog. In the staff role dialog it marks the
colours other roles use, and a new role starts on the first colour no role uses. The Staff roles
list names the people holding each role, then "plus N more" past a cut-off.

**Not in this plan:** A753 point 1 (more colours). It waits for the owner's answer to the swatch
board (`~/waitron-campaign-b/a753-owner-question.md`) and needs a migration, because three CHECK
constraints list the six colours (`staff_roles_colour_ck`, `special_dates_colour_ck`,
`menu_periods_colour_ck` — measured in `~/waitron-campaign-b/item-a753-ledger.md`). Nothing here
assumes six: every list of colours below is built from `CALENDAR_COLOURS`.

**Architecture:** A new field primitive, `wt-colour-chooser`, in `packages/ui`. It knows nothing
about calendars or stations: the host hands it a list of choices, each with its name, a CSS colour
to paint its square, and the names of whatever else uses it. A small browser-safe helper in
venue-service, `calendar-colours.ts`, turns `CALENDAR_COLOURS` (still the one place the calendar
palette lives, `packages/venue-service/src/hours-types.ts:6`) into those choices, and works out the
first colour nobody uses; the period dialog and the staff role dialog (in staffing) both use it, and
A721's season colours can later. The Staff roles list route gains each holder's display name.

**Tech stack:** TypeScript, Lit, the shared `wt-*` primitives, Hono routes, Drizzle on SQLite,
Vitest in real headless Chromium for everything under `packages/ui/src` and the `browser` projects
of venue-service and staffing (`src/dashboard/**`), and Vitest on Node for staffing's `node` project.

**Spec — quoted, never paraphrased:**

- `docs/backlog.md`, A753: "Periods, staff roles and menus pick from six colours; the palette grows
  (the owner sees a swatch board first), every place picking one uses A725's shared colour popup —
  the staff role dialog's dropdown included, marking colours other roles use and starting a new role
  on an unused one — and the Staff roles list names the people holding each role, with "plus N more"
  past 5 or 10, whichever reads better."
- `docs/backlog/service-periods.md`, "## A753…", point 2: "**One picker for every calendar colour.**
  The staff role dialog shows the colour as a dropdown
  (`packages/staffing/src/dashboard/staff-role-dialog.ts:296-305`); the period dialog draws its own
  swatches (`packages/venue-service/src/dashboard/period-dialog.ts:446-531`). A725 point 7 already
  plans one shared colour popup for stations, periods and seasons; staff roles use it too. Whichever
  of A725 and A753 lands first builds it, and the other adopts it. The category and product colour
  field (`apps/dashboard/src/widgets/color-field.ts`, a different set of 24) stays apart. **For staff
  roles it marks the colours other roles use**, as A725 point 7 does for stations, **and a new role
  starts on the first colour no role uses**, as A725 point 4 does for a new station (owner,
  2026-10-16: Waiter was offered Grey while only blue and red were taken). The painter's "+ New
  staff role" opens the same dialog."
- Same section, point 3: "**The Staff roles list names who holds each role.** The People column says
  "3 people"; it shows the names, then "plus N more" past a cut-off. Owner: try 5 and 10 names on the
  real screen and keep the one that reads better."
- `docs/backlog/kitchen.md`, A725 point 7: "**The colour is chosen in a popup:** one square showing
  the colour opens a small panel of colours, which still marks those other stations use. One shared
  component, also used by periods (A719) and seasons (A721); category colours keep their dialog."
- `docs/backlog/service-periods.md`, A719 point 6: "**The colour is chosen in a popup**, the shared
  chooser A725 point 7 describes, not a row of squares. Whichever of A719, A721 and A725 lands first
  builds it."
- Lane B's queue (`~/waitron-campaign-b/queue.md`, A753): "The one shared colour popup for periods
  and staff roles is also lane F's A725 point 7: whichever of A725/A753 lands first builds it and the
  other reuses it — lane F has been told. Lane A's A721 (season colours) is later in lane A; keep the
  palette in one place it can read." A725 has not started, so this item builds it.

Line numbers below are against `main` at `3597a1730`; find each place by the function or selector
named beside it if they have moved.

**Migration: no.** No table, column, CHECK or stored value changes. Point 3 adds a field to one
route's answer (a read of `persons.display_name`), nothing stored.

**Review path: FULL** — a new shared `wt-*` primitive and a change to what a route returns (a
permission question, below). Per-task reviews, then `/finish-branch` with the Codex run-it seat run
twice side by side, the second told to set this plan aside and test what it does not name.

---

## Decisions this plan makes (FYI to the owner in the PR; any may be overruled)

1. **The primitive is `wt-colour-chooser`.** Siblings were grepped: the one popup chooser is
   `wt-language-chooser`; the palettes it serves spell "colour" (`CALENDAR_COLOURS`,
   `STATION_COLOURS`, `station-colour-picker`); "color" in `packages/ui` belongs to the category set
   (`category-color.ts`, `wt-lozenge`'s `color`, the dashboard's `color-field.ts`), which the spec
   keeps apart. So "colour" also keeps the two families visibly separate.
2. **It is a form field drawn like the others** (design-system.md → Forms → "The field box",
   `fieldStyles`): the label floats above the box, and the box holds a square of the chosen colour,
   its name and a chevron. That is the "one square showing the colour" of A725 point 7, inside the
   same field box the dialogs' other fields use. Pressing it opens the panel: a grid of tiles, each a
   square, the colour's name, and under it, small and muted, the names of whatever else uses it — the
   prep station picker's layout today (`station-colour-picker.ts`), so A725 can move stations onto it
   without a visual change.
3. **Keyboard:** the panel is a radio group with one tab stop. The arrow keys move round it and
   choose as they go (radio behaviour, as the period swatches and station picker do today); Home and
   End go to the first and last. Enter, Space or a click chooses and closes the panel; Escape closes
   it. Either way focus goes back to the field. Leaving the panel with Tab closes it and moves on.
   Arrow Down, Arrow Up, Enter and Space on the closed field open it. Escape inside a dialog closes
   only the panel, never the dialog.
4. **The period dialog marks colours too.** The names are already at hand: the host has the
   department's periods (`department.periods`, `period-editing.ts:186-187`), so it passes each other
   period's name and colour. Editing a period never marks its own colour as used by itself. When the
   dialog asks for the department, the marks follow the department chosen, and there are none
   before one is chosen. A new period still starts on the department's first unused colour, as today.
5. **A new staff role starts on the first colour, in `CALENDAR_COLOURS` order, that no other role
   uses; when every colour is used, the first (red).** The choice is made when the dialog opens. If
   the roles list arrives after the dialog opened, the marks update but the starting colour does not
   move under the person's eyes. "Other roles" never includes the role being edited, nor the role
   the dialog itself has just created (the dialog stays open on it when only the people failed to
   save, `staff-role-dialog.ts:40-44`).
6. **The names come from the Staff roles list route**, not from the people list the dialog loads:
   that read (`listPeople`, `GET /management-api/staff`) needs `person.manage`
   (`client.ts:236-240`), and the Staff roles page is also shown read-only to people with only
   `venue.view`. A new domain read, `listStaffRolesWithHolderNames`, feeds only
   `GET /management-api/staffing/staff-roles`; `listStaffRoles` and every other answer that carries a
   staff role (create, update, set holders, the rota's `staffRoles`) are unchanged.
   **Who can see the names, and what they could already see:**
   - The route is gated by `venue.view` (`gatedBy(VIEW_VENUE, …)`, `packages/staffing/src/routes.ts:305-313`),
     which the supervisor, manager and admin roles hold (`SUPERVISOR`,
     `packages/identity/src/permissions.ts:46-55`, and the sets built on it).
   - Every active person's name is already readable WITHOUT signing in:
     `GET /management-api/staff-roster` is "Deliberately unauthenticated" and answers
     `listActiveStaff`, every `status = 'active'` person's `{ personId, displayName }`
     (`apps/server/src/management-api.ts:864-872`, `packages/identity/src/staff.ts:581-588`).
     Measured 2026-10-17 on `3597a1730`:
     `pnpm --filter @waitron/server exec vitest run src/management-api.accounts-and-receipt-config.test.ts -t "unauthenticated pre-login roster"`
     passed (`Tests 1 passed | 106 skipped`); that case sends no cookie and reads "The Manager" and
     "The Clerk" with a 200. A refused read would have printed a 401 there.
   - **The one widening:** a holder who is `pending` or `suspended` is not on that roster. Their
     names reach `venue.view` holders through this route and, for anyone credited on an order or
     sale whatever their status, already through `GET /management-api/orders/staff`, which any
     signed-in session reads (`orders-api.ts:245-250`, `listOrderStaff`, `orders-list.ts:553-563`).
     The plan names every holder, so the list agrees with the count it replaces and with the dialog,
     which keeps a suspended holder listed (`peopleOptions`, `staff-role-dialog.ts:274-279`). Say
     this in the PR's FYI; the owner may ask for active holders only.
7. **Names are shown in name order** (the shared label comparator, `createLabelComparator`, as the
   delete question already sorts holders, `staff-roles.ts:196-203`), joined with ", ". Past the
   cut-off: "{names} plus {count} more" ("{names} y {count} más"). Nobody: "No people", as today.
   The cut-off is one constant, `HOLDER_NAMES_SHOWN`; Task 6 picks 5 or 10 by eye.
8. **The list reads names again when a person changes** (renamed, suspended): `persons` joins the
   `staff-roles` live query's tables.

---

## Global constraints

- **Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a753-calendar-colours`,
  branch `feat/a753-calendar-colours`. Every commit `git commit -s`. One pull request.
- **Ledger:** `~/waitron-campaign-b/item-a753-ledger.md` (the lane's). Update it at the end of every
  task: what is done, decisions, the next step.
- **Test first.** Each task writes its failing tests, runs them, sees them fail for the reason
  stated, then writes the code.
- **Task size.** Each task should finish well under 100 tool calls. An implementer past about 150
  with its task unfinished stops at a passing or cleanly red point, commits, and hands over: done,
  left, files, each check's state.
- **Focused runs.** Check `memory_pressure | grep free` first; run beside another session's browser
  run only when free memory is well above 15%.

  ```bash
  pnpm --filter @waitron/ui exec vitest run src/components/<file>.test.ts
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/staffing exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/staffing exec vitest run --project node src/<file>.test.ts
  ```

  Read the `Tests` count; a run without one proves nothing.
- **Every implementer dispatch** also runs `pnpm format:check`, and `pnpm --filter <pkg> typecheck`
  and `pnpm --filter <pkg> lint` for each package it touched.
- **Changing an existing test check.** Allowed only where this spec changes what the check checks
  (owner decision 2026-10-05). Each task lists those checks and why under "Existing checks that
  change". A check not listed is not touched; if another one fails, that is a regression — stop and
  find out why. Helper, mock and fixture changes are allowed and are listed too; the assertions after
  them stay word for word. A replaced check is at least as strict as the old one. Keep a running
  list for the PR's "Changed test checks" section (`file:line`, before, after, the spec line).
- **Strings:** every new string goes in both `en` and `es` (staffing's `es` is typed
  `Record<keyof typeof en, string>`, `strings.ts:202`, so a missing one fails the typecheck; check
  venue-service's the same way). Product text as short as the meaning allows.
- **CLAUDE.md rules that bite here:**
  - Every colour, spacing, radius and font reads a `--wt-*` token. A choice's square is painted from
    the `fill` the host passes, which is a `var(--wt-color-palette-…)` read written out in full in
    `PERIOD_COLOUR_TOKENS` (`period-colour-styles.ts:5-12`), so `scripts/style-token-names.test.ts`
    reads it.
  - A shared `wt-*` component's events are `wt-*`, carry `detail`, are dispatched
    `bubbles: true, composed: true`, and the event that caused them is stopped first. Use
    `dispatchWtChange` (`packages/ui-core/src/interactive.ts:36-39`, re-exported through
    `packages/ui/src/interactive.ts`), as `wt-combobox` does.
  - A native popover is shown and positioned in the same call, never from `toggle`
    (`wt-row-actions.ts:111-129`, `wt-combobox.ts:730-773`).
  - A click whose result depends on update order is tested with `userEvent.click`, not
    `element.click()`. An Escape test uses the native keypress (`userEvent.keyboard("{Escape}")`).
  - A width is set with `page.viewport(w, h)` and `window.innerWidth` is read and asserted.
  - A test that sets Spanish restores the language in `finally` (or the file's `afterEach`).
  - A screen does not draw its own form field: the period dialog's hand-drawn radio group goes.
  - Forms keep A331's save rule: Save quiet and disabled until the draft changes. Neither dialog's
    draft scope or save logic changes; their `*.unsaved.test.ts` and `*.save-state.test.ts` must stay
    green.
  - `packages/ui` holds coverage 98/98/98/95 and a mutation floor of 90 (judged nightly on the merged
    score); `packages/ui` may not import venue-service — its `package.json` depends only on
    `@waitron/shared`, `@waitron/ui-core` and `lit`, and venue-service depends on `@waitron/ui`, so an
    import the other way would be a dependency loop (`scripts/workspace-cycles.test.ts`).
- **Do not touch** Venue settings' tab list (`CORE_SETTINGS_PANELS`, module `settingsPanels`), the
  prep station editor or `station-colour-picker.ts` (A725 moves stations later), or the category
  colour field.

## Review Focus

Inputs the spec implies but no point names; each has its test in the task named.

1. **A stored colour outside the palette** (a period whose colour is `pink`): the field shows no
   colour, the panel's tab stop is its first tile, and the dialog's own check still says "Choose a
   colour." Tasks 1 and 3a.
2. **Every colour taken:** a new staff role starts on red; two roles sharing a colour are both named
   on its tile. Task 4a.
3. **The dialog left open on a role it has just created** (people failed to save) while the live list
   now includes that role: its own colour is not marked as used by itself. Task 4a.
4. **Escape with the panel open inside a dialog that guards unsaved changes:** only the panel closes;
   the dialog stays, focus returns to the field. Tasks 1 and 3a.
5. **The panel near the bottom or right edge of a 390 px window:** it stays wholly on screen.
   Task 1.
6. **The field disabled while its panel is open** (the dialog starts saving): the panel closes.
   Task 1.
7. **Holder names:** two people with the same display name, a suspended holder, accented names
   sorted by the label comparator, a person holding two roles, another location's roles. Task 5a.
8. **Exactly the cut-off number of holders** shows them all with no "plus"; one more shows "plus 1
   more". Task 5b.

---

### Task 1: `wt-colour-chooser` — the field, the panel, the keys

**Files:**
- Create: `packages/ui/src/components/wt-colour-chooser.ts`,
  `packages/ui/src/components/wt-colour-chooser.test.ts`
- Read first: `wt-combobox.ts` (`renderField`, `:967-1048`; `openList` and `positionPopup`,
  `:730-773`), `wt-row-actions.ts` (show, hide, Escape, `:99-192`), `station-colour-picker.ts` (tile
  layout and arrow keys), `packages/ui-core/src/field-styles.ts`, design-system.md → "Adding a
  primitive" (`:3679-3707`) and → Forms → "The field box" (`:2659-2752`).

**Interfaces — produces:**

```ts
// wt-colour-chooser.ts
export interface ColourChoice {
  /** What `value` matches and `wt-change` carries, e.g. "red". */
  value: string;
  /** The colour's name, in the screen's language. */
  label: string;
  /** A CSS colour for its square: a `var(--wt-color-…)` read, so a theme repaints it. */
  fill: string;
  /** The names of the other things that use this colour, in the order to show them. */
  usedBy?: readonly string[];
}

@customElement("wt-colour-chooser")
export class WtColourChooser extends LitElement {
  // delegatesFocusShadowRootOptions; baseStyles first, then fieldStyles
  @property() name = "";
  @property() label = "";
  /** Controlled: the field shows the choice whose value this is, or none. */
  @property() value = "";
  @property({ attribute: false }) choices: readonly ColourChoice[] = [];
  @property({ type: Boolean }) required = false;
  @property({ type: Boolean }) disabled = false;
  @property() error = "";
  /** A used colour's accessible name; `names` are its `usedBy`, joined with ", ". */
  @property({ attribute: false }) usedByLabel: (colour: string, names: string) => string =
    (colour, names) => `${colour}, ${names}`;
  show(): void; // opens the panel; does nothing when disabled, off the page or already open
  hide(): void;
}
// Event: `wt-change`, `detail: { value }`, bubbles and composed, sent only when the value differs
// from `value`. The chooser never changes `value` itself: the host sets it.
```

**What it draws:**
- `:host { display: block; max-width: var(--wt-field-max-width) }`.
- The field box as `wt-combobox` draws it: `.field` with `part="field"`, `data-label` from
  `fieldLabelState({ value: chosenLabel })` (it floats whenever a choice matches `value`),
  `data-invalid`, `data-disabled`; a real `<label class="field-label" for=…>` with the label text in
  `.field-label-text` and the `*` (`data-required`, `aria-hidden`) when `required`; the control is a
  `<button type="button" class="field-control trigger">` carrying `name`, `aria-expanded`,
  `aria-controls` (the panel), `aria-invalid` when `error` is set, and `aria-describedby` (the error
  paragraph). Inside it: the chosen colour's square (`part="swatch"`, painted from its `fill`
  through a custom property set inline, e.g. `style="--swatch-fill: …"`), the colour's name, and a
  `wt-icon name="chevron-down"`. With no matching choice it shows no square and no name.
- The error is a paragraph under the box, as `wt-combobox`'s is (`class="error"`, `data-error`).
- The panel: `<div popover part="panel">` holding `<div role="radiogroup">` labelled by the field's
  label, with `aria-required` when `required`. Each choice is a
  `<button type="button" role="radio">` tile with `aria-checked`, `data-value`, a square, the name,
  and, when `usedBy` is not empty, a muted small line of the names; the visible text is
  `aria-hidden` and the tile's `aria-label` is `usedByLabel(label, usedBy.join(", "))`, or just
  `label` when nobody uses it. Tiles sit in two columns (`repeat(2, minmax(0, 1fr))`), each at least
  `--wt-tap-min` tall. The checked tile has the station picker's ring
  (`outline: var(--wt-field-line-width-active) solid var(--wt-color-primary)`, bold name).
- Positioning, in the same call that shows it: width `max-content`, at least the trigger's width
  and at most `innerWidth - 16px`; left aligned with the trigger and pulled in to keep an 8 px
  gutter; top at the trigger's bottom, clamped between 8 px and `innerHeight - height - 8px` — the
  rule `wt-combobox.positionPopup` uses.

- [ ] **Step 1: Failing tests** in `wt-colour-chooser.test.ts` (`mount`, `host`, `cleanup` from
  `../test-helpers.js`; `userEvent` and `page` from `vitest/browser`). Fixture: six choices
  red…purple with `fill: "var(--wt-color-palette-<colour>)"`, blue `usedBy: ["Runner", "Cook"]`,
  red `usedBy: ["Waiter"]`.
  1. The field: label "Colour" in a `<label for>` that names the trigger; the trigger carries
     `name="colour"`, shows "Blue" and a square for `value="blue"`; `required` draws the `*`; no
     `required`, no `*`.
  2. `value="pink"` (in no choice): the trigger shows no name and no square, the label rests
     (`data-label` as `fieldLabelState` gives for an empty value), and once open, the first tile is
     the only one with `tabindex="0"` and none is `aria-checked="true"`.
  3. A real click on the trigger opens the panel (`:popover-open`), sets `aria-expanded="true"`,
     and focuses the checked tile; the tiles' `data-value`s follow `choices` order; the radio group
     is named "Colour".
  4. Marks: the blue tile shows "Runner, Cook" in its muted line and is named
     "Blue, Runner, Cook" by default and "Blue, used by Runner, Cook" with
     a `usedByLabel` that returns "{colour}, used by {names}"; the grey tile has no names line and is named
     "Grey".
  5. Arrow keys with the panel open (native keypresses): from blue, ArrowRight sends one
     `wt-change` with `{ value: "green" }` and focuses the green tile once the host sets `value`;
     ArrowDown → next, ArrowLeft and ArrowUp → previous, wrapping at both ends; Home → red, End →
     purple. Each press sends exactly one event, `bubbles` and `composed` true. The panel stays
     open.
  6. Controlled: with a listener that does NOT set `value`, an arrow press sends the event and the
     field still shows the old colour.
  7. A real click on the green tile sends one `wt-change` `{ value: "green" }`, closes the panel
     and returns focus to the trigger. A click on the already-checked tile sends nothing and closes.
     Enter and Space on a tile do the same as a click. The native `click` that caused the event does
     not reach a listener on the host's parent (stopped first).
  8. Escape with the panel open (native keypress): closes it, focus on the trigger, and the keydown
     reaches no listener above the chooser and is `defaultPrevented`. Inside a
     `<wt-modal open .beforeClose=${() => Promise.resolve(true)}>` the modal stays open after that
     Escape; a second Escape (panel closed) does reach the modal.
  9. A real click outside closes the panel and does not take focus from where it was clicked.
     Tab from the checked tile moves focus out of the chooser and closes the panel.
  10. ArrowDown, ArrowUp, Enter and Space on the closed trigger open it.
  11. Before the first painted frame the panel's top is at the trigger's bottom and its left at the
      trigger's left (measure in a `requestAnimationFrame` registered in the trigger's `click`
      listener, as `wt-row-actions.test.ts:104-145` does).
  12. At `page.viewport(390, 700)` (assert `window.innerWidth` is 390), with the chooser near the
      bottom right of the page, the open panel's rectangle is inside the window with an 8 px margin.
  13. `disabled`: the trigger is disabled and a click opens nothing; setting `disabled` while open
      closes the panel. `show()` before the first render and after removal does nothing.
  14. `error="Choose a colour."`: the paragraph shows it, the trigger has `aria-invalid="true"` and
      names the paragraph in `aria-describedby`; `focusFirstInvalid(host)` focuses the trigger.
      With no error, no `aria-invalid="true"` and no paragraph.
  15. Changing `choices` while open re-renders the tiles; the checked tile follows `value`.
  Fails today: the element does not exist.
- [ ] **Step 2: Run** `pnpm --filter @waitron/ui exec vitest run src/components/wt-colour-chooser.test.ts`;
  see the import fail.
- [ ] **Step 3: Implement** the interface above.
- [ ] **Step 4: Run** the file until green (read the `Tests` count), then `wt-combobox.test.ts` and
  `wt-row-actions.test.ts` (untouched, must stay green). **No existing check changes.** Commit
  `"A753: wt-colour-chooser, a field that opens a panel of colours"`.

### Task 2: The chooser's token, accessibility and mutation checks; workbench and export

**Files:**
- Modify: `wt-colour-chooser.test.ts`, `packages/ui/src/index.ts` (add
  `export type { ColourChoice } from "./components/wt-colour-chooser.js";` — a type-only export, so
  importing the package index does not register the element), `packages/ui/demo/main.ts` (the
  workbench: import it and show one with marks and one with an error, beside the other fields)
- Create: `packages/ui/src/components/wt-colour-chooser.a11y.test.ts`

- [ ] **Step 1: Token tests** (design-system.md → "Adding a primitive", steps 1 and 6):
  1. `host.style.setProperty("--wt-color-palette-blue", "rgb(1, 2, 3)")` repaints the trigger's
     square and the blue tile's square to `rgb(1, 2, 3)`.
  2. `--wt-color-field-fill` on the host repaints the field box.
  3. `--wt-color-primary` on the host repaints the checked tile's ring.
  4. `--wt-field-max-width: 200px` on the host makes the field no wider than 200 px (as
     `packages/ui-core/src/components/wt-input.test.ts` does).
  5. The trigger and each tile are at least `--wt-tap-min` tall.
  `no-hardcoded-chrome.test.ts` finds the new file by itself; run it.
- [ ] **Step 2: Axe tests**, `describe.each(["light", "dark"])`, with `mountThemed` and
  `expectNoA11yViolations` from `../a11y-helpers.js`: closed with a chosen colour; closed with no
  matching value; required; with an error; disabled; open with marks (wait for `:popover-open`).
  Then break it on purpose — remove the radio group's label, then the trigger's `for` — confirm the
  run goes red for that reason, and restore.
- [ ] **Step 3: Run** both files and `src/no-hardcoded-chrome.test.ts`; green. Commit.
- [ ] **Step 4: Mutation.**
  `gtimeout 2700 pnpm --filter @waitron/ui exec stryker run --mutate src/components/wt-colour-chooser.ts`.
  Kill survivors with tests that assert behaviour, or name each one left and why it is equivalent.
  The bar is 90 for this file. Record the score in the ledger and the PR.
- [ ] **Step 5:** `pnpm --filter @waitron/ui test:coverage` (check free memory first; this package
  runs in the browser) and read the new file's row in the table: 98/98/98/95. Commit
  `"A753: the colour chooser's token, accessibility and mutation checks"`.

### Task 3a: The calendar palette as choices; the period dialog takes the chooser

**Files:**
- Create: `packages/venue-service/src/dashboard/calendar-colours.ts`,
  `calendar-colours.test.ts`
- Modify: `packages/venue-service/package.json` (exports: add
  `"./dashboard/calendar-colours": "./src/dashboard/calendar-colours.ts"`), `period-dialog.ts`,
  `strings.ts`, `period-dialog.test.ts`, `period-dialog.a11y.test.ts`,
  `periods-screen.editing.test.ts`

**Interfaces — produces:**

```ts
// calendar-colours.ts — browser-safe; staffing imports it as
// "@waitron/venue-service/dashboard/calendar-colours"
import type { ColourChoice } from "@waitron/ui";
export interface ColourUser { name: string; colour: string }
/** Every calendar colour as a chooser choice, in CALENDAR_COLOURS order, painted from
 *  PERIOD_COLOUR_TOKENS[colour].fill, each naming the users that have it in the order given. */
export function calendarColourChoices(
  label: (colour: CalendarColour) => string,
  users?: readonly ColourUser[],
): ColourChoice[];
/** The first calendar colour no entry of `used` is; the first colour when every one is. */
export function firstUnusedCalendarColour(used: readonly string[]): CalendarColour;
```

The period dialog: the `<fieldset name="colour">` and its radio group (`period-dialog.ts:500-544`),
`COLOUR_STEPS` (`:38-43`), the `tabStop` line (`:446`) and the swatch, radiogroup, fieldset, legend
and `colour-error` styles (`:79-111`) go. In their place:
`<wt-colour-chooser name="colour" label=${t("hours.colour")} .value=${this.draft.colour}
.choices=${calendarColourChoices((c) => t("hours.colour." + c))} .usedByLabel=${…}
.error=${this.error("colour")} ?disabled=${this.busy} @wt-change=…>`, whose listener stops the event
and calls `this.changed("colour", event.detail.value)` when `current()`. `unused` (`:45-46`) becomes
`firstUnusedCalendarColour`. This task passes no users yet (Task 3b does). New string
`hours.colour_used_by`: "{colour}, used by {names}" / "{colour}, en uso por {names}" (the station
picker's wording, `strings.ts:252`, `:1089`).

- [ ] **Step 1: Failing tests.**
  - `calendar-colours.test.ts`: the choices' values are `CALENDAR_COLOURS` in order; each `fill` is
    `PERIOD_COLOUR_TOKENS[colour].fill`; labels come from the function; users `[{ name: "Lunch",
    colour: "red" }, { name: "Dinner", colour: "blue" }, { name: "Brunch", colour: "red" }]` give
    red `usedBy ["Lunch", "Brunch"]`, blue `["Dinner"]`, the rest none; a user whose colour is not in
    the palette marks nothing. `firstUnusedCalendarColour([])` is red, `(["red", "amber"])` grey,
    every colour → red.
  - `period-dialog.test.ts`, new: a real pointer path — `userEvent.click` the chooser's trigger,
    then the green tile; the chooser shows green, Save is primary and enabled, and Save sends
    `colour: "green"`. And: with the panel open, a native Escape closes the panel and leaves the
    dialog open (Review Focus 4).
  Fails today: the module does not exist; the dialog has no `wt-colour-chooser`.
- [ ] **Step 2: Run** both files; see them fail for those reasons.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change** (each because spec point 2 replaces the period
  dialog's own swatches with the shared chooser):
  - `period-dialog.test.ts` helpers `swatch`, `checkedColour`, `errorOf`, `change` (`:54-77`):
    setup. They read `wt-colour-chooser[name=colour]` — `checkedColour` returns its `value` when that
    is one of `CALENDAR_COLOURS`, else `null`; `errorOf("colour")` returns its `error`; `change` for
    colour dispatches `wt-change` `{ value }` from it, as for the other fields. Every assertion that
    uses them stays word for word.
  - "colour is a radio group of the six period colours; choosing one checks only it and makes Save
    ready" (`:400-436`) → "colour is the shared chooser of the six period colours; choosing one makes
    Save ready": the chooser's `label` is "Colour", its choices' `[value, label]` are the six in
    order with the same English names, its `value` is "blue", Save disabled; after choosing green,
    `value` is "green", Save primary and enabled.
  - "the colour group is one tab stop, and the arrow keys move focus and the choice round it"
    (`:438-466`) → moves to the primitive (Task 1, cases 5 and 7). In the dialog it becomes: focus
    the chooser's trigger, ArrowDown opens the panel, ArrowRight chooses green, Escape closes it,
    the chooser shows green and Save is enabled.
  - "with no colour chosen, the first swatch is the group's tab stop" (`:468-484`) → the chooser
    shows no colour for `pink`, and once opened its first tile is the tab stop (the tile assertion
    reads inside the chooser's shadow root).
  - "draws the chosen swatch's ring outside the swatch, clear of its fill" (`:486-492`) → deleted
    here; the ring is the chooser's, checked by Task 2 step 1 case 3 and Task 1's tile tests. Name
    the replacement in the PR.
  - "LOOK L1, L2, L9…" (`:494-510`) → L1 and L2 (the legend's gap and the ring colour) go with the
    legend and the ring; L9's three assertions on the end-offset explanation stay word for word,
    with `text` read from the name field's label colour instead of the legend's.
  - "a Save refused only for its colour moves focus to the first swatch" (`:512-525`) → "… moves
    focus to the colour field": the deep active element is the chooser's trigger.
  - "a refusal naming colour shows under the colour group" (`:527-543`) → the chooser's `error` is
    "Check this value." and its trigger has `aria-invalid="true"`.
  - "departed controls cannot edit…" (`:604-637`): setup — `oldColour` is the old chooser, and the
    stale write is a `wt-change` dispatched from it. Assertions unchanged.
  - `period-dialog.a11y.test.ts:96` (`[role=radiogroup] [role=radio]` count 6) → the chooser is
    present with six choices; `:107` (`[data-test=colour-error]` text) → the chooser's `error` is
    "Choose a colour.".
  - `periods-screen.editing.test.ts` helpers `change` (`:132-134`) and `checkedColour`
    (`:149-150`): setup, as above.
- [ ] **Step 5: Run** `calendar-colours.test.ts`, `period-dialog.test.ts`,
  `period-dialog.a11y.test.ts`, `period-dialog.unsaved.test.ts`, `periods-screen.editing.test.ts`,
  `periods-screen.test.ts`, `season-painter.test.ts`; all green. Commit
  `"A753: the period dialog picks its colour with the shared chooser"`.

### Task 3b: The period dialog marks the colours its department's other periods use

**Files:** Modify `period-dialog.ts`, `period-editing.ts` (`render`, `:182-210`), and the tests named.

**Interfaces:** `PeriodDialog.usedColours` becomes `colourUsers: readonly ColourUser[]` — the
department's OTHER periods, `{ name, colour }`. `Department` becomes
`{ id: string; name: string; colourUsers: readonly ColourUser[] }`. The host builds both from
`department.periods`, leaving out `editor.period?.id`. The dialog's chooser gets
`calendarColourChoices(label, shownUsers)`, where `shownUsers` is the chosen department's
`colourUsers` when it asks for the department (none before one is chosen), else `colourUsers`. A new
period's first colour is `firstUnusedCalendarColour` of the same users' colours.

- [ ] **Step 1: Failing tests** (`period-dialog.test.ts`, `periods-screen.editing.test.ts`):
  1. Adding with `colourUsers` `[{ name: "Lunch", colour: "red" }, { name: "Dinner", colour:
     "amber" }]`: the chooser's red choice has `usedBy ["Lunch"]`, amber `["Dinner"]`; the new
     period starts on grey.
  2. Adding with two departments: before choosing, no choice has `usedBy`; after choosing
     Restaurant its periods' names appear; after switching to Bar, Bar's.
  3. In the Periods page, editing "Lunch" (red) in a department with "Dinner" (red) and "Brunch"
     (blue): red is marked `["Dinner"]` only — the edited period is never its own mark.
  4. Spanish: a marked tile is named "Rojo, en uso por Lunch".
  Fails today: the property does not exist.
- [ ] **Step 2: Run**; see them fail. **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change** (the dialog's input changes shape because the marks
  need names — spec point 2):
  - `period-dialog.test.ts:968-969`, `period-dialog.unsaved.test.ts:305-306`,
    `period-dialog.a11y.test.ts:72-73`: fixtures — `usedColours: ["red", "amber"]` becomes
    `colourUsers` with one named period per colour, same colours. Assertions unchanged (the
    preselected-colour test at `:1012-1022` still expects grey, then amber, then blue).
  - `periods-screen.editing.test.ts:591-596`: the check that the page hands the dialog each
    department's used colours now expects each department's `colourUsers`, the same colours with
    the periods' names from the `twoDepartments()` fixture.
- [ ] **Step 5: Run** the period dialog's four files and the `periods-screen*.test.ts` files; green.
  Commit `"A753: the period dialog marks colours other periods use"`.

### Task 4a: The staff role dialog takes the chooser, marks other roles' colours, starts on an unused one

**Files:** Modify `packages/staffing/src/dashboard/staff-role-dialog.ts`, `strings.ts`,
`staff-role-dialog.test.ts`, `staff-role-dialog.save-state.test.ts`,
`staff-role-dialog.a11y.test.ts`.

**Interfaces:** a new property
`@property({ attribute: false }) staffRoles: readonly Pick<StaffRole, "id" | "name" | "colour">[] = []`
— the venue's staff roles, in list order. "Others" are those whose id is neither `staffRole?.id` nor
the dialog's own `savedId`. `draftOf` takes the others' colours: a new role's colour is
`firstUnusedCalendarColour(others.map((role) => role.colour))`, worked out when the dialog opens
(the same `willUpdate` branch that resets the draft, `:105-122`). The `wt-combobox name="colour"`
(`:295-307`) becomes `<wt-colour-chooser name="colour" label=${t("staffing.role.colour")}
.value=${this.draft.colour} .choices=${calendarColourChoices(colourName, others)}
.usedByLabel=${…} .error=${this.fieldError("colour")} ?disabled=${this.busy} @wt-change=…>`; the
listener stops the event and calls `this.change({ ...this.draft, colour: event.detail.value },
"colour")`. New string `staffing.role.colour_used_by`: "{colour}, used by {names}" /
"{colour}, en uso por {names}".

- [ ] **Step 1: Failing tests** (`staff-role-dialog.test.ts`):
  1. New, with `staffRoles` Waiter red, Runner blue, Cook blue: the chooser's value is amber; red's
     `usedBy` is `["Waiter"]`, blue's `["Runner", "Cook"]`; the others have none. (The owner's case:
     with only blue and red taken, the new role is offered amber, not grey.)
  2. New, with six roles using all six colours: red.
  3. Editing Runner (blue) with the same list: blue's `usedBy` is `["Cook"]`; its value stays blue.
  4. A new role created, its people refused (the existing holders-failure setup), and the host then
     handing a list that includes the created role: that role is not in any `usedBy`.
  5. Choosing through the panel with real clicks sends the chosen colour in `createStaffRole`.
  6. Spanish: a used tile is named "Rojo, en uso por Waiter"; English "Red, used by Waiter".
  Fails today: no `staffRoles` property, no chooser.
- [ ] **Step 2: Run**; see them fail. **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change.** Spec point 2 replaces the dropdown with the shared
  chooser, and "a new role starts on the first colour no role uses" — with no other roles that is
  red, not blue:
  - The `field("wt-combobox", "colour")` reads (`:98`, `:127`, `:137`, `:142`, `:218`, `:280`,
    `:286-288`, `:326-328`, `:347`) read `wt-colour-chooser[name=colour]`, and `chooseOption` on it
    becomes a `wt-change` dispatched from it (setup). Their values stay word for word, except:
  - "offers a required name, the six calendar colours and the venue's people" (`:93-122`): the
    colour field's `options` become its `choices` (the same six `[value, label]` pairs);
    `multiple` false goes (the chooser has one value by construction); `value` "blue" → "red".
  - "speaks Spanish…" (`:133-138`): `options[4].label` → `choices[4].label`, still "Verde".
  - `:167` and `:467`: `createStaffRole` called with `colour: "blue"` → `"red"`; `:433`:
    `updateStaffRole` with `colour: "blue"` → `"red"` (the draft's starting colour, carried).
  - `staff-role-dialog.save-state.test.ts:74-77`: `opened` for a new role "blue" → "red"; the two
    `chooseOption(box("colour"), …)` calls become `wt-change` dispatches on the chooser.
  - `staff-role-dialog.a11y.test.ts:53`: dispatches on `[name=colour]`, which is now the chooser
    host — check it still finds it; no change expected.
- [ ] **Step 5: Run** the dialog's four files (`staff-role-dialog*.test.ts`) and
  `staff-role-delete-copy.test.ts`; green. Commit
  `"A753: the staff role dialog marks colours other roles use and starts on an unused one"`.

### Task 4b: Every host hands the dialog the roles

**Files:** Modify `staff-roles-screen.ts` (`:367-375`), `painter-parts.ts` (`staffRoleDialog`,
`:237-256`), `staffing-season-painter.ts` (`:483`), `staffing-special-day-painter.ts` (`:422`),
and their tests.

**Interfaces:** `staffRoleDialog(api, open, staffRoles, saved, close)`, with
`staffRoles: readonly StaffRole[]`; the painters pass `this.staffRoles`; the screen passes
`.staffRoles=${this.staffRoles ?? []}`.

- [ ] **Step 1: Failing tests:**
  1. `staff-roles-screen.test.ts`: with roles Waiter green, Cook red, Runner purple, "New staff
     role" opens the dialog with those three as `staffRoles` and colour amber; Edit on Cook opens it
     with all three (the dialog leaves Cook out itself).
  2. `staffing-season-painter.test.ts` and `staffing-special-day-painter.test.ts`, in the "+ New
     staff role opens the staff role dialog…" cases: the opened dialog's `staffRoles` equals the
     painter's roles from its fixture.
  Fails today: nothing passes `staffRoles`.
- [ ] **Step 2: Run**; see them fail. **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change:** `staff-roles-screen.test.ts:878-881` ("creates the
  next staff role after a held create answers…"): both POST bodies' `colour: "blue"` → `"red"` —
  the page lists only Waiter (green), so a new role starts on red (spec point 2).
- [ ] **Step 5: Run** every `src/dashboard/*.test.ts` file in staffing that mentions
  `staff-role-dialog` or `staffRoleDialog` (`git grep -l`), plus `staff-roles-screen.a11y.test.ts`;
  green. Commit `"A753: every place that adds a staff role hands the dialog the other roles"`.

### Task 5a: The Staff roles list route names each role's holders

**Files:** Modify `packages/staffing/src/staffing-types.ts`, `staff-roles.ts`, `routes.ts`
(`GET BASE`, `:305-313`), `dashboard/client.ts` (`watchStaffRoles`), `staff-roles.test.ts`,
`routes.test.ts`; fixtures that answer the
list read (`src/testing/season-staffing-fixture.ts:91`, `special-day-staffing-fixture.ts:53`,
`dashboard/index.test.ts:49`, and any the typecheck names) gain `holderNames`.

**Interfaces — produces:**

```ts
// staffing-types.ts
export interface ListedStaffRole extends StaffRole {
  /** Every holder's display name, whatever their status, in name order. */
  holderNames: string[];
}
// staff-roles.ts
/** The location's staff roles as `listStaffRoles` gives them, each with its holders' names. */
export function listStaffRolesWithHolderNames(tx: Transaction, cfg: Cfg): Promise<ListedStaffRole[]>;
// client.ts
watchStaffRoles(queries, apply: (staffRoles: ListedStaffRole[]) => …): Promise<void>;
```

The names come from one query over `person_staff_roles` joined to `persons` and to `staff_roles`
(scoped to `cfg.locationId`), sorted with `createLabelComparator()` and then by person id, grouped by
role in JavaScript. `listStaffRoles` and `readStaffRoles` do not change, so the rota and every write's
answer keep their shape.

- [ ] **Step 1: Failing tests.**
  - `staff-roles.test.ts` (node, real database through `useVenueDb`): roles Sous chef (held by
    "Marc", "Álvaro", "ana" — mixed case and an accent) and Head chef (held by nobody): Sous chef's
    `holderNames` follow the label comparator's order (assert the comparator's order, worked out in
    the test with `createLabelComparator`, not a hand-sorted list); Head chef's is `[]`. A suspended
    holder is named. A person holding both roles is named in both. Two holders with one display
    name both appear. Another location's role is absent. Each listed role equals its
    `listStaffRoles` row plus `holderNames`.
  - `routes.test.ts`: a supervisor's `GET` answers `holderNames` beside `holderIds`; a staff-role
    session is still refused (the existing `notPermitted` case covers it — check it runs).
  Fails today: the field and the function do not exist.
- [ ] **Step 2: Run**
  `pnpm --filter @waitron/staffing exec vitest run --project node src/staff-roles.test.ts src/routes.test.ts`;
  see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change** (spec point 3: the list names who holds each role):
  - `routes.test.ts:144` — `{ staffRoles: [staffRole] }` → each listed role gains `holderNames: []`;
    `:416-418` → the listed role gains `holderNames` with `r.ana`'s display name. Whole-shape pins
    gaining the new key; every existing value unchanged.
- [ ] **Step 5:** The permission receipt. Re-run
  `pnpm --filter @waitron/server exec vitest run src/management-api.accounts-and-receipt-config.test.ts -t "unauthenticated pre-login roster"`
  and copy Decision 6's paragraph, with this run's `Tests` line, into the commit message. Commit
  `"A753: the staff roles list names each role's holders"`.

### Task 5b: The People column names the holders, then "plus N more"

**Files:** Modify `packages/staffing/src/dashboard/staff-roles-screen.ts` (`#columns`, `:265-292`),
`strings.ts` (`holderCount`, `:430-435`), `live-queries.ts`, `strings.test.ts`,
`live-queries.test.ts`, `staff-roles-screen.test.ts`, `staff-roles-screen.a11y.test.ts`.

**Interfaces:**

```ts
// staff-roles-screen.ts
/** How many holders' names the People column shows before "plus N more". */
export const HOLDER_NAMES_SHOWN = 5; // Task 6 keeps 5 or changes it to 10
// strings.ts — replaces holderCount
/** "No people"; the names; or the first `shown` names "plus N more". */
export function holderNames(names: readonly string[], shown: number, locale?: string): string;
// live-queries.ts (Decision 8)
"staff-roles": ["staff_roles", "person_staff_roles", "persons"],
```

Strings: new `staffing.role.holders_more` "{names} plus {count} more" / "{names} y {count} más".
`staffing.role.holders_one` is no longer read — delete it in both languages (`holders_none` stays;
`holders_other` stays, the dialog's people field counts with it, `staff-role-dialog.ts:315`). The
screen's list state becomes `ListedStaffRole[]`.

- [ ] **Step 1: Failing tests.**
  - `strings.test.ts`: `holderNames([], 5, "en")` "No people", `"es"` "Nadie";
    `(["Ana", "Marc"], 5)` "Ana, Marc"; five names with `shown` 5 → all five, no "plus"; six → the
    first five then " plus 1 more"; twelve → " plus 7 more"; Spanish "… y 7 más".
  - `staff-roles-screen.test.ts`: a role held by `HOLDER_NAMES_SHOWN + 2` people shows the first
    `HOLDER_NAMES_SHOWN` names and "plus 2 more"; one held by exactly `HOLDER_NAMES_SHOWN` shows all
    of them; written against the constant so it holds for 5 or 10. A reader (`readOnly`) sees the
    names too. Spanish.
  - `live-queries.test.ts`: `"staff-roles"` reads again when a person changes.
  Fails today: `holderNames` does not exist; the column counts; `persons` is not a dependency.
- [ ] **Step 2: Run**; see them fail. **Step 3: Implement.** Then from the repository root run
  `pnpm exec vitest run scripts/live-subscriptions.test.ts` (`persons` must be a declared resource;
  the rota's query already reads it, `live-queries.ts`).
- [ ] **Step 4: Existing checks that change** (spec point 3, "it shows the names"):
  - `strings.test.ts:20-25` (`holderCount` 0/1/3 in English and Spanish) → the `holderNames` cases
    above; "No people"/"Nadie" stay, "1 person" and "3 people" become names.
  - `staff-roles-screen.test.ts:208-210` — `"2 people"`, `"1 person"`, `"No people"` → Waiter's
    two holders' names, Cook's one, "No people"; `:367` `"2 people"` → the two names. The fixture's
    `listed()` (`:53-59`) gains `holderNames`, looked up from a names map that grows Marc beside Ana
    (`:50`); setup.
  - The test's name at `:201` changes "its holder count" to "who holds it".
  - "refreshes a renamed holder in the delete warning without re-reading the list, and refreshes
    holder counts" (`:332-370`): the list now shows names, so a person's rename must re-read it
    (Decision 8). After `invalidate([{ type: "persons" }])` the list read count goes from 1 to 2
    and the People cell shows "Ana Ruiz" (the fixture's list answer takes `holderName`); after the
    `person_staff_roles` invalidation it is 3 and the cell shows both names. The delete warning's
    assertions stay word for word; the name becomes "refreshes a renamed holder in the delete
    warning and in the list, and refreshes the holders".
  - `live-queries.test.ts:5-7` — `["staff_roles", "person_staff_roles"]` →
    `["staff_roles", "person_staff_roles", "persons"]`, and the case's name says a person's change
    too.
- [ ] **Step 5: Run** `staff-roles-screen.test.ts`, `staff-roles-screen.a11y.test.ts`,
  `strings.test.ts`, `live-queries.test.ts`, `client.test.ts`; green. Commit
  `"A753: the Staff roles list names who holds each role"`.

### Task 6: LOOK — the chooser in both dialogs, and 5 or 10 names (done by the driver, not an implementer)

This is a judgement by eye, so the session driving the plan does it.

- [ ] Start the dev stack: `lsof` the first slot's venue folder and port 8080, then
  `wa-wt demo waitron-feat-a753-calendar-colours` (never a bare `pnpm dev*`).
- [ ] The demo venue seeds six people (`apps/server/scripts/demo-seed/staff.ts`). Add people with
  the manager's session (the dashboard's people page, or `POST /management-api/staff`) until there
  are at least 12, and staff roles: one held by 12 people, one by 3, one by nobody, two sharing a
  colour. These stay in the shared demo venue; say so in the PR.
- [ ] With the workspace's Playwright Chromium (a script in a `mktemp -d` folder outside the
  worktree), at 390 px and 1280 px wide (record `window.innerWidth`), light and dark (set
  `data-theme` on `document.documentElement`; record the page's computed background and reject a
  capture whose light and dark colours are the same):
  - The Staff roles list with `HOLDER_NAMES_SHOWN = 5`, then with it changed to 10 (the dev server
    reloads). Eight pictures.
  - The staff role dialog: new (which colour it starts on), the panel open with marks; an edit.
  - The period dialog from Calendar → Periods: the panel open with the department's marks; from a
    painter's "+ New period".
  - Once in Spanish.
  Save every picture to `/Users/clintongormley/waitron-campaign-b/a753-shots/` with names that say
  what they show (`roles-list-5-light-1280.png`, …).
- [ ] Pick 5 or 10 by eye: whichever keeps a row readable at 390 px and still shows enough names at
  1280 px. Set `HOLDER_NAMES_SHOWN`, write one line on why in the ledger and the PR, and keep both
  sets of pictures for the PR's FYI to the owner. Commit `"A753: show N holders before 'plus more'"`
  if it changed.
- [ ] Anything that looks wrong (the panel clipped by the dialog, a tile's names wrapping badly, the
  square misaligned with the name) goes back to the task that drew it.

### Task 7: Docs, backlog, and the end of the branch

- [ ] `docs/developers/design-system.md`:
  - The primitives table (`:632` onwards): a `wt-colour-chooser` row beside `wt-combobox` — its
    properties (`name`, `label`, `value`, `choices` `{ value, label, fill, usedBy? }[]`,
    `required`, `disabled`, `error`, `usedByLabel`), what it draws, the keys (Decision 3), and its
    event, `wt-change` `{ value }`. Say it is for a palette of named colours and that the category
    and product colour field (`color-field.ts`) is separate.
  - "The field box" list of field primitives (`:2661-2662`) gains `wt-colour-chooser`.
  - Periods page (`:4656-4657`): "Colour (six swatches)" → the chooser, marking the colours the
    department's other periods use.
  - Read every other sentence that describes the period dialog's colour, the staff role dialog's
    colour or the Staff roles list's People column (`git grep -n` for "swatches", "holder",
    "People column", "staff-role dialog" under `docs/developers/`) and correct what this branch made
    false (CLAUDE.md §1, "A behaviour change retires every receipt").
- [ ] `docs/backlog.md`, A753 (`:1329-1335`): rewrite so it says only point 1 is left — the palette
  grows after the owner's swatch board, with its migration — and that points 2 and 3 landed in
  #NNNN. Do NOT delete the entry.
- [ ] `docs/backlog/service-periods.md`:
  - A753 section: delete points 2 and 3; point 1 keeps its number.
  - A719 (`:212-213`): delete point 6 — the period dialog now uses the shared chooser. The other
    points keep their numbers.
  - A721 point 1 (`:224-226`): "(A725's popup chooser)" → "(`wt-colour-chooser`, choices from
    `calendarColourChoices`, `packages/venue-service/src/dashboard/calendar-colours.ts`)".
  - "Decisions and deliberate limits" (`:330`): add Decisions 5 (starting colour fixed at open),
    6 (the names list every holder, with the permission receipt in one line and a pointer to the
    PR) and 7 (the cut-off chosen, with the pictures' PR).
- [ ] `docs/backlog/kitchen.md`, A725 point 7 (`:171-173`): the shared component exists —
  `wt-colour-chooser` (A753, #NNNN); A725 hands it the twelve station colours from
  `STATION_COLOUR_TOKENS` with `usedBy`, and `station-colour-picker.ts` goes. Keep the rest of the
  entry.
- [ ] Coverage, after checking free memory: `pnpm --filter @waitron/venue-service test:coverage` and
  `pnpm --filter @waitron/staffing test:coverage`; read the new and changed files' rows.
- [ ] Ledger to `Status: done` for points 2 and 3, naming point 1 as what is left. Then
  `/finish-branch /Users/clintongormley/workspace/worktrees/waitron-feat-a753-calendar-colours
  (plan docs/superpowers/plans/2026-10-17-a753-calendar-colours.md)`.
- [ ] The PR description: what changed, in plain words; the FULL review path; the permission
  receipt (Decision 6) and the one widening; the mutation score; the cut-off picked and both sets
  of pictures; "Changed test checks" (every entry from Tasks 3a–5b, `file:line`, before, after, the
  spec line); the demo people added for the LOOK.
- [ ] Append to `~/waitron-campaign-b/questions.md` one FYI section, headed
  `A753 points 2 and 3 (#NNNN) — FYI, no answer needed`: the changed test checks (or a pointer to
  the PR's section), the names of pending and suspended holders now shown to supervisors (Decision
  6), and the cut-off with the pictures' folder.
- [ ] Once merged: append to `~/waitron-campaign-f/questions.md` a section headed
  `## A753 (#NNNN) landed — FYI for A725, no answer needed`, saying in plain words that
  `wt-colour-chooser` exists in `packages/ui`, takes a list of colours with how each is painted and
  who uses it, and that A725 point 7 adopts it for stations; name the merge commit.
