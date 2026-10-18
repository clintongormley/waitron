# A582 slice 2 — help mode on the dashboard: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** a person signed in to the dashboard can turn help on from a "?" in the banner, see badges on
the parts of Products that have help, see a "?" beside menu options that have help, and turn it off
again; signing out or the session ending turns it off, and a reload starts with it off. The
dashboard's five always-visible "?" become help-mode badges in the same change.

**Spec:** `docs/superpowers/specs/2026-10-18-a582-help-mode-design.md` (approved 2026-10-18). Slice 2
is its §8 item 2, drawing on §3.1 (the dashboard), §3.3 (badges inside menus), §5 (how a screen marks
a part), §6 (keyboard, screen readers, staying on) and §7 (today's "?" buttons). Slice 1's plan,
`docs/superpowers/plans/2026-10-18-a582-1-help-badge.md`, and what it landed (#1846) are the base.
The backlog's "Slice 2 must also" list (`docs/backlog/dashboard.md`, A582) is covered by Tasks 7 and 8.
"Read more in the guide" links are slice 3 and are not in this plan.

**Base:** `main` at `40f4d71f9`. Every file reference below is to that commit. **(read)** marks a
conclusion from reading code, not from running it; the measurements in "Measured while writing this
plan" were run, and each says what ran.

**Tech stack:** TypeScript, Lit 3, Vitest 4.1.11 in browser mode (real headless Chromium through
Playwright) for `packages/ui`, `apps/dashboard` and `packages/payments-sumup`; plain Vitest for the
root guards under `scripts/`.

---

## Two pull requests

Slice 2 is split into two pull requests, each finishable by a few small implementer tasks and each
leaving `main` green and working on its own.

| | PR 2a — the shared pieces | PR 2b — the dashboard |
| --- | --- | --- |
| Branch | `feat/a582-2-dashboard-help` (this worktree) | `feat/a582-2b-dashboard-help`, made with `python3 ~/workspace/tools/worktree.py new waitron feat/a582-2b-dashboard-help --headless` from `main` **after 2a has landed** |
| What it adds | in `packages/ui`: `wt-row-actions` keeps a menu open for a badge inside a slotted element and re-places an open menu whose size changes; a new `wt-menu-row`; a new `wt-help-switch`; `help` on `wt-data-table` columns; `help` on `wt-tabs` items; the design-system entries | the banner switch and room for it at phone width; help off on sign-out and session end; the five "?" moved to help mode, with SumUp's given a positioned box; the guard; Products' help; the account-menu and ⋮-menu users of `wt-menu-row`; docs and the backlog |
| Tasks | 1–6 | 7–11 |
| What it leaves working | Nothing anyone sees changes: no screen uses the new pieces and nothing turns help on, exactly as slice 1 left it. Every existing `wt-row-actions` menu behaves as before (Task 1's tests pin it). | Help mode works end to end on the dashboard. |

**Why two.** One pull request would hold eleven tasks across four packages and two dozen test files.
2a is pure `packages/ui` with no consumer, the same shape as slice 1, so it can be reviewed against
the spec's §3.3 and §5 alone; 2b is the visible change, reviewed with screenshots. The spec's one
"same pull request" rule — the five "?" switch to help mode in the same change as the switch that
turns them on (§7, and slice 1's plan) — is kept: both are in 2b.

No `CLAUDE.md` risk trigger is touched by either (no fiscal path, no tenant read, no migration, no
permission, no concurrency, no cross-package wire contract), so both take the light review path; the
plan-vs-spec read and the Codex run-it seat still run on each.

---

## Words used in this plan

- **badge** — the small filled "?" help mode shows on a part of a page: `<wt-help-tooltip mode="help-mode">` (slice 1).
- **help box** — the small popover a badge opens.
- **the switch** — the "?" button in the banner that turns help on and off. Its state is slice 1's
  `packages/ui/src/help-mode.ts` (in memory only).
- **menu row** — `wt-menu-row`, the new element that lays out one menu option with its badge beside it (spec §3.3, §5).
- **phone width** — below the dashboard's drawer breakpoint, `48rem` (`apps/dashboard/src/dashboard-app.ts:737`, read).

---

## Measured while writing this plan

All run 2026-10-18 in this worktree on `main` at `40f4d71f9`, Vitest 4.1.11 in headless Chromium,
with throwaway tests that were deleted (or reverted) afterwards. Free memory was 51% before the
runs (`memory_pressure | grep free`). Output was read with `AI_AGENT= CLAUDECODE=` so passing tests'
`console.log` showed.

### M1–M3: a badge in a menu row inside `wt-row-actions`

A throwaway `packages/ui/src/zz-probe-a582-2.test.ts`
(`AI_AGENT= CLAUDECODE= pnpm exec vitest run src/zz-probe-a582-2.test.ts` in `packages/ui`, 5 tests
passed) defined a stand-in menu row: a Lit element whose shadow root held `<slot>` (the option, a
`wt-button` "Edit") and a `wt-help-tooltip mode="help-mode" data-keep-open`, with the badge put back
in the flow by the row's own CSS (`position: static; margin: 0; --wt-help-badge-target: var(--wt-tap-min)`).
A second option "Delete" followed it. The failing case for M1 was stated first: if
`wt-row-actions` honours `data-keep-open` only in its own light DOM, a click on the badge would
close the menu.

- **M1 (today's `wt-row-actions`):** help on, the badge's button was 44 × 44 px in the row (so the
  token override gives the §3.3 square). A click on the badge **closed the menu**, and the option
  did not run. Cause (read): `closesMenu` honours `data-keep-open` only on nodes for which
  `this.contains(node)` is true (`packages/ui/src/components/wt-row-actions.ts:147-158`), and
  `contains` does not see into the menu row's shadow root. The spec's own measurement (§3.3) put the
  badge in the menu's light DOM, which is why it stayed open there.
- **M2 (with `closesMenu` patched in the test to honour `data-keep-open` on any node that comes
  before the menu's own element in `event.composedPath()`):** a click on the badge left the menu
  open, opened the help box and did not run the option. The first Escape closed only the box, with
  the menu open and focus on the badge's button; the second Escape closed the menu. With the menu
  opened by Enter on its button, three Tabs went to "Edit", then the badge's button, then "Delete",
  and the menu stayed open. With the box open, a click on the option ran it once and closed both
  the menu and the box.
- **M3 (help turned on while the menu is open):** at a 390 px window, a menu with `align="end"`
  whose button touched the window's right edge opened at left 286.3, right 382 (width 95.7). Turning
  help on while it was open showed the badge at once, and the menu grew to width 122.3 with its
  left edge unchanged, so its **right edge went to 408.6, past the 390 px window**. `wt-row-actions`
  places its popup only when it opens (`positionPopup`, `wt-row-actions.ts:111-129`, read).

### M4: a badge inside `wt-tabs`' tab strip

Same file. A `wt-tabs` with two tabs; the second tab button wrapped in a positioned span holding a
help-mode badge, help on, inside the `role="tablist"`. **axe 4.14 reported
`aria-required-children` (critical) on the tablist**: a tablist may own only tabs. The badge's top
was 8 px above the tablist's top, inside a box with `overflow-x: auto`
(`packages/ui/src/components/wt-tabs.ts:34-44`, read), so its top was cut off (the tablist's
`scrollHeight` and `clientHeight` were both 52). So a tab's badge cannot live in the tab strip.

### M5: a badge in a `wt-data-table` column heading

Same file. A two-column `wt-data-table` 1278 px wide; badge on the last heading, help on.
Baseline: the table's `.scroll` box had `scrollWidth` 1278 = `clientWidth` 1278, `scrollHeight` 81 =
`clientHeight` 81.

- Badge hung over the **heading cell's** top trailing corner (the `th` made `position: relative`):
  `scrollWidth` 1290 > `clientWidth` 1278 — **the table gained a sideways scroll** (and the top half
  of the badge is outside the box, which clips it).
- Badge hung over the **heading's label** (the text wrapped in an inline-block, positioned `span`):
  `scrollWidth` 1278, `scrollHeight` 81 — **no scroll**. The badge's box ran from y = 1 to 25 with the
  `th` starting at y = 1: the label sits 12 px below the cell's top (`th` padding
  `var(--wt-space-3)`, `wt-data-table.ts:254-260`, read), exactly half the dashboard badge's 24 px
  target, so it fits.

The mockup (`docs/backlog/mockups/a582-help-mode/01-dashboard-off-on.png`) draws the Availability
badge exactly there, over the label's corner.

### M6–M8: room for the switch in the dashboard banner

A throwaway test inserted into the `describe` that holds `atViewport` in
`apps/dashboard/src/dashboard-app.test.ts` (after `:5405`), run with
`AI_AGENT= CLAUDECODE= pnpm exec vitest run src/dashboard-app.test.ts -t "ZZPROBE"` in
`apps/dashboard` (16 tests passed, 455 skipped), then the file was restored byte for byte from a copy.
It mounted the signed-in app the way the existing banner tests do (`alertsApi`, one error alert, so
the bell shows; `atViewport`, which pads the page 24 px as `index.html` does), for intents `live`
and `demo`, in `en-GB` and `es-ES`, at 320, 360, 390 and 480 px, and read the lockup's width. The
stand-in for the switch was a 44 × 44 `span` inserted before the account menu (the actions row has
a 4 px gap, so it costs 48 px). The failing case was stated first: a lockup below 60 px, the floor
`dashboard-app.test.ts:5587` asserts at 360, 390 and 480.

| Lockup width (px), English / Spanish | 320 | 360 | 390 | 480 |
| --- | --- | --- | --- | --- |
| today | 31.1 / 32.4 | 71.1 / 72.4 | 101.1 / 102.4 | 128 / 128 |
| **M6** with the switch, nothing else changed | 0 / 0 (banner overflows 5 / 4 px) | 23.1 / 24.4 | 53.1 / 54.4 | 128 / 128 |
| nav toggle's trailing margin 12 → 4 px | 0 | 31.1 / 32.4 | 61.1 / 62.4 | 128 |
| actions' leading margin 8 → 0 | 0 | 31.1 / 32.4 | 61.1 / 62.4 | 128 |
| banner side padding 12 → 8 px | 0 (overflow 1 / 0) | 31.1 / 32.4 | 61.1 / 62.4 | 128 |
| all three of those together | 7.1 / 8.4 | 47.1 / 48.4 | 77.1 / 78.4 | 128 |
| **M7** the language chooser off the first row, switch in | 40 / 40 | 80 / 80 | 110 / 110 | 128 |

The results were the same for `live` and `demo`. So A681's receipt (15 px at 360, 45 at 390 for a
52 px stand-in) is confirmed in kind: the switch alone takes the lockup below its floor at 360 and
390, and tightening margins and padding does not get it back at 360. Taking the language chooser
(52.9 px English, 51.6 Spanish) off the first row does, with room to spare, and leaves the lockup
wider than today at every phone width (it is also 9 px wider than today at 320, where no test sets a
floor).

**M8** — the same probe with the chooser moved (in the test's DOM) to the end of the second row,
beside the legal name: at all four widths, both languages and both intents, the chooser sat inside
the banner, below the lockup, after the legal name (and after the Live pill), level with the name
(0 px between their centres), and the banner did not overflow. The banner grew from 102 px to
121 px tall, because the chooser (44 px) is taller than the name's line (17 px).

---

## Decisions made in this plan (for the reviewer)

1. **Two pull requests** — see above.
2. **The banner at phone width: signed in, the language chooser moves to the end of the second row.**
   Measured (M6–M8): the switch cannot join the first row without taking the lockup below the 60 px
   floor at 360 and 390 px, and every margin tweak tried still leaves it below at 360. The spec
   leaves the method to this plan (§3.1: "Slice 2 finds the room and its plan says how") and keeps
   the "?" in the first row with the bell and the account menu, which this does. The chooser stays
   one tap away, on the row that already holds the venue's name. The cost: the signed-in banner is
   19 px taller below `48rem` (M8), and mockup 03 drew the chooser on the first row; the look step
   (Task 11) shows the owner the result. Rejected: moving the chooser into the account menu (more
   work — the chooser is an arrow-key menu of its own, `packages/ui/src/menu-popover.ts` — and one
   more tap); shrinking the page's 24 px padding at phone width (reaches every screen); lowering the
   60 px floor (a behaviour check the spec does not change). The rule applies only signed in: signed
   out there is no switch, and the signed-out banner is unchanged (its own phone-width test,
   `apps/dashboard/src/dashboard-app.theme.test.ts:274-308`, keeps passing unedited). It applies to
   the whole phone-width range, not only below 400 px where it is needed, so there is one rule and
   one breakpoint.
3. **The switch is a shared primitive, `wt-help-switch`**, in `packages/ui`, not markup in the
   dashboard: slices 4 and 5 need the same button on the till and the kitchen screens (spec §5: "the
   switch … that each app's top bar drives"). It calls `setHelpMode` itself and follows the state
   through `HelpModeController`, so it sends no event (slice 1's decision 6: an event would have no
   listener). Off: a 44 px target with an outlined, muted circled "?", the same circle as
   `wt-help-tooltip`'s always mode (`wt-help-tooltip.ts:16-42`, read). On: `aria-pressed="true"` and
   the circle filled `--wt-color-primary` with an `--wt-color-on-primary` "?", the badge's own
   colours. Its name is the app's word for Help (property `label`, English default "Help"). It is
   shown only when signed in, between the alerts bell and the account menu (spec §3.1).
4. **Help goes off in `#returnToLogin`** (`apps/dashboard/src/dashboard-app.ts:1332`, read), the one
   path every sign-out and session end takes: Log out (`#onLogout`, `:1504`), the idle timer
   (`#scheduleSessionExpiry`, `:1319`), a session refused by the server (`#onSessionInvalid`,
   `:954-959`), and another tab's expiry (`#onSessionStorage`, `:981`), all read. A reload starts
   off already because the state is held in memory only (slice 1, `help-mode.test.ts` "nothing is
   saved"); Task 7 pins it for the dashboard too.
5. **`wt-row-actions` honours `data-keep-open` on any element between the click's target and the
   menu's own element** (the part of `event.composedPath()` before the host), which includes a
   slotted element's shadow root, and still not on an element outside the menu (M1, M2). It also
   **re-places an open menu whose size changes** (a `ResizeObserver` on the popup, calling
   `positionPopup` while open), so a menu that gains its badges while open stays inside the window
   (M3).
6. **The menu row is `wt-menu-row`.** It wraps one option: `<wt-menu-row help=… help-label=…><wt-button …>…</wt-button></wt-menu-row>`.
   The option keeps the row's full height and the rest of its width; the badge sits after it in
   its own `--wt-tap-min` square, in the flow, carrying `data-keep-open`. The badge's accessible
   name is `help-label`, given whole by the screen (for example "Help: Account settings"), because
   the row cannot read its option's label reliably. With no `help`, the row draws only its option.
   This slice supports a `wt-button` option; an `<a href>` option inside a menu row would lose the
   look `wt-row-actions` gives a link (`::slotted(a[href])`, `wt-row-actions.ts:54-81`, read, styles
   only a direct child) — recorded as an open risk, not built.
7. **A column's badge hangs over the heading's label, not the heading cell** (M5): a cell's corner is
   at the scrolling box's edge, where the badge is clipped and the table gains a sideways scroll.
   `DataTableColumn` gains `help?: string`; the table gains `helpLabel` (English default "Help"),
   and the badge is named `` `${helpLabel}: ${column.label}` ``. Only a column with `help` gets the
   label wrapper, so every existing table's heading DOM is unchanged.
8. **A tab's badge is drawn outside the tab strip** (M4) — in a layer of `.tab-row`, placed by script
   over the tab label's top trailing corner, moved when the strip scrolls or resizes, and hidden
   (`visibility: hidden`, so also out of the Tab order) while that corner is scrolled out of the
   strip's visible part. This follows the way `wt-help-tooltip` and `wt-row-actions` already place
   their popups by script (`positionTooltip`, `positionPopup`). CSS anchor positioning was not used:
   nothing in the tree uses it (`grep -rn "anchor-name\|position-anchor" apps packages`, run
   2026-10-18, found nothing) and which browsers the dashboard must support is not written down.
   `TabItem` gains `help?: string`; `wt-tabs` gains `helpLabel` (English default "Help"). Products
   has no tabs (read: no `wt-tabs` in `product-list.ts`, `catalogue-browser.ts` or the editor), so
   no screen uses this in slice 2; it is built because spec §8 item 2 names it.
9. **Badge text keys.** `help.label` ("Help" / "Ayuda") names the switch and is each table's and
   tabs' `helpLabel`; `help.badge_label` ("Help: {part}" / "Ayuda: {part}") names a badge through the
   dashboard's `fill` (`apps/dashboard/src/i18n/t.ts:12`, read); a part's text is
   `help.<screen>.<part>` (spec §4). No `help.` key exists today (read); the existing `_help` /
   `_help_label` keys of the five "?" are left as they are.
10. **SumUp's "?"** goes inside a new inline-block, `position: relative` box around the
    "Affiliate app ID / Affiliate key" text, so it hangs over that text's top trailing corner, as a
    dialog heading's badge does (slice 1, decision 10). Today no ancestor of it is positioned
    (`packages/payments-sumup/src/dashboard/sumup-connect-form.ts:41-48` and `:245-253`, and
    `apps/dashboard/src/screens/payments-screen.ts:199-242`, read).
11. **Products help goes on five parts** whose labels do not say enough (each text is in Task 10 with
    the code it describes): the price field (what the price and the unit mean), VAT, Default
    course, the Variants section and the list's Availability column. Not on: name, category,
    colour, image, the names in other languages, nutrition, Modifiers, and "Ordered on its own by",
    whose `wt-segmented-control` has no `help` slot (read; spec §5: another primitive gains a slot
    when a screen first needs one, and the option hints already explain each choice,
    `strings.ts:2039-2041`).
12. **The menu users** (spec §3.3; the brief asks for at least one of each): the account menu's
    **Account settings** (the label does not say what is inside) and the product editor's variant ⋮
    menu's **Keep** (shown on a variant marked to be archived; "Keep" alone does not say it cancels
    that). Nothing else in the account menu or the Products ⋮ menus gets help: Archive already
    explains itself in its confirmation (`strings.ts:4981`, read).

---

## Global constraints (both pull requests)

- No migration, no server change, no new error code.
- Comments only for an invariant or a non-obvious why; never history.
- Every commit `git commit -s`, plain-English message. Never `--no-verify`. Run `pnpm format:check`
  before each commit.
- Focused tests only, with the exact commands each task names. Read the `Tests` count; a run that
  prints none is no evidence. Before a browser run check `memory_pressure | grep free`; run beside
  another session's browser run only when free memory is well above 15%. Stop only processes you
  started, by their ids.
- Coverage holds `98/98/98/95` in `packages/ui`, `apps/dashboard` and `packages/payments-sumup`;
  never close a gap with an ignore comment or an exclude.
- Every colour, spacing, radius and size reads a declared `--wt-*` token (guards:
  `packages/ui/src/no-hardcoded-chrome.test.ts`, `scripts/style-token-names.test.ts`).
- A new `wt-*` primitive gets a token-painting test and an axe test in a sibling `*.a11y.test.ts`
  covering each distinct state in both themes (`CLAUDE.md` §3; `design-system.md` "Adding a
  primitive"). Before trusting an axe case, break the thing it checks (remove an `aria-label`) and
  see it go red.
- Custom events (none are added) would be `wt-*`, carry `detail`, bubble and be composed.
- **Changed test checks.** Each pull request lists below the existing checks whose assertion
  changes, and why the spec changes the behaviour each checks. **Any other existing assertion that
  has to change to make a task pass: STOP** and report it with the measured before and after.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
  cleanly failing) point, commits, and returns a handover: what is done, what is left, the files,
  and the state of each check.

---

# PR 2a — the shared pieces in `packages/ui`

Branch `feat/a582-2-dashboard-help`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a582-2-dashboard-help`.

## File map (2a)

| File | Change | Task |
| --- | --- | --- |
| `packages/ui/src/components/wt-row-actions.ts` | keep-open across a slotted element's shadow root; re-place an open menu on resize | 1 |
| `packages/ui/src/components/wt-row-actions.test.ts` | three cases | 1 |
| `packages/ui/src/components/wt-menu-row.ts` (new), `.test.ts` (new), `.a11y.test.ts` (new) | the menu row | 2 |
| `packages/ui/src/components/wt-help-switch.ts` (new), `.test.ts` (new), `.a11y.test.ts` (new) | the switch | 3 |
| `packages/ui/src/components/wt-data-table.ts`, `wt-data-table.help.test.ts` (new), `wt-data-table.a11y.test.ts` | column `help` | 4 |
| `packages/ui/src/components/wt-tabs.ts`, `wt-tabs.help.test.ts` (new), `wt-tabs.a11y.test.ts` | tab `help` | 5 |
| `packages/ui/src/index.ts` | export the two new elements' classes and types beside `WtRowActions` | 2, 3 |
| `docs/developers/design-system.md` | entries | 6 |

## Changed test checks (2a)

None. Every existing test in `packages/ui` passes unedited. The new elements reflect no `disabled`,
so `packages/ui/src/tap-target-and-focus.test.ts:42-58`'s exact interactive set does not change
(read: the set is `wt-row-actions` plus every component reflecting `disabled`, `:31-36`).

---

### Task 1: `wt-row-actions` keeps its menu open for a badge inside a row, and keeps an open menu inside the window

**Files:** `packages/ui/src/components/wt-row-actions.ts` (`closesMenu`, `:147-165`; `show`/`hide`
and the lifecycle, `:94-121`), `packages/ui/src/components/wt-row-actions.test.ts`.

Sketch:

```ts
private closesMenu(event: MouseEvent): boolean {
  const path = event.composedPath();
  // Everything before the host is inside the menu, including a slotted element's shadow root.
  if (path.slice(0, path.indexOf(this)).some((node) => node instanceof HTMLElement && node.hasAttribute("data-keep-open")))
    return false;
  … // the action check, unchanged
}

readonly #resize = new ResizeObserver(() => {
  if (this.popup?.matches(":popover-open")) this.positionPopup();
});
// observe the popup in firstUpdated; disconnect in disconnectedCallback; re-observe on reconnect
```

- [ ] **Step 1: Write the failing tests** in `wt-row-actions.test.ts` (use the file's `mountActions`;
  each case defines what it needs inline; `afterEach` already runs `cleanup`):
  - `"stays open for a click on a data-keep-open element inside a slotted element's shadow root"` —
    define a test-local element (as `customElements.define("test-keep-open-row", …)`) whose shadow
    root holds `<slot></slot><button data-keep-open>?</button>`; put it in the menu around a
    `wt-button`; open; `userEvent.click` the shadow button: the popup stays open. Then click the
    `wt-button`: it closes. (M1: today this closes on the first click.)
  - `"a data-keep-open element outside the menu does not keep it open"` — wrap the whole
    `wt-row-actions` in `<div data-keep-open>`; open; click "Edit": the popup closes. This is the
    control that the scope stayed inside the menu (it passes today, and must still pass).
  - `"an open menu that grows stays inside the window"` — `page.viewport(390, 800)` (restore
    1280 × 900 in `finally`); the menu in `<div style="display:flex;justify-content:flex-end">` with
    `align="end"`; open; append a `<wt-button>` whose text is 30 characters long; wait one animation
    frame; the popup's `right` is at most `innerWidth - 8`. (M3: today it stays where it opened.)
- [ ] **Step 2: See them fail:**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-row-actions.test.ts` — the first and
  third fail, the second passes.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again; all pass**, with the unchanged suites that use row menus:
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-row-actions.test.ts src/components/wt-row-actions.a11y.test.ts src/components/wt-data-table.test.ts src/tap-target-and-focus.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/widgets/row-actions.test.ts src/screens/devices-screen.test.ts`
  (the two dashboard files are the ones using `data-keep-open` today, found with
  `grep -rln "data-keep-open" apps packages`, run 2026-10-18). Then
  `pnpm --filter @waitron/ui typecheck`.
- [ ] **Step 5: Deletion proofs** (each restored after): put `this.contains(node)` back → the first
  case fails; drop the `slice(0, …indexOf(this))` (test every node in the path) → the control case
  fails; delete the observer's `positionPopup()` → the third case fails.
- [ ] **Step 6: Commit**, e.g. `Row menus stay open for a help badge inside a menu row, and stay inside the window when they grow (A582)`.

---

### Task 2: `wt-menu-row` — a menu option with a help badge in its own square

**Files:** create `packages/ui/src/components/wt-menu-row.ts`, `wt-menu-row.test.ts`,
`wt-menu-row.a11y.test.ts`; export from `packages/ui/src/index.ts`.

**Interface:**

```ts
@customElement("wt-menu-row")
export class WtMenuRow extends LitElement {
  @property() help = "";                              // the help box's text; empty draws no badge
  @property({ attribute: "help-label" }) helpLabel = ""; // the badge's accessible name, whole
}
```

Render: `<slot></slot>${this.help ? html`<wt-help-tooltip mode="help-mode" data-keep-open aria-label=${this.helpLabel}>${this.help}</wt-help-tooltip>` : nothing}`.
Styles (`baseStyles` first): `:host { display: flex; align-items: center; width: 100%; }`,
`::slotted(*) { flex: 1 1 auto; min-width: 0; }`, and for the badge
`wt-help-tooltip[data-help-on] { position: static; margin: 0; flex: none; --wt-help-badge-target: var(--wt-tap-min); }`
— a rule from this shadow root beats the badge's own `:host` rules (measured as M1–M2's stand-in:
the badge was 44 × 44 and in the flow). No `delegatesFocus`, no `disabled`: the row is not itself a
control.

- [ ] **Step 1: Write the failing tests.** In `wt-menu-row.test.ts`, mount
  `<wt-row-actions label="Actions" align="end"><wt-menu-row help="Edits it." help-label="Help: Edit"><wt-button variant="ghost" align="start">Edit</wt-button></wt-menu-row><wt-button variant="ghost" align="start">Delete</wt-button></wt-row-actions>`
  with a click counter on "Edit"; `afterEach`: `cleanup()`, `setHelpMode(false)`. These are spec
  §3.3's behaviours:
  - `"while help is off it draws only the option, as wide as the row"` — the option's width equals
    the row's; the badge's `checkVisibility()` is false. **Control in the same case:** with help on
    the option is narrower by the `--wt-tap-min` square.
  - `"while help is on the badge takes its own --wt-tap-min square at the trailing end, beside the option"` —
    the badge's button is `tapMin × tapMin` (read `--wt-tap-min` from the host); its left edge is at
    or past the option's right edge; its right edge is the row's; the option keeps the row's height.
  - `"a right-to-left menu puts the badge at the left"` — `dir="rtl"` on the container.
  - `"a tap on the badge opens its box, leaves the menu open and does not run the option"`.
  - `"a tap on the option runs it and closes the menu, and an open box with it"`.
  - `"a second tap on the badge closes its box and leaves the menu open"`.
  - `"the first Escape closes only the box and returns focus to the badge; the next closes the menu"`.
  - `"Tab goes from the option to its badge, then to the next option"` — open with Enter on the
    menu's button, then Tab ×3, reading the deep active element each time (M2's sequence).
  - `"Enter and Space on the badge open and close its box without running the option or closing the menu"`.
  - `"with help off the badge adds no Tab stop"` — Tab from "Edit" goes to "Delete".
  - `"an open menu shows its badges when help is turned on, and hides them when it is turned off"` —
    open the menu with help off; `setHelpMode(true)`; badge visible, menu still open; off again:
    hidden, menu still open. With help on, turning it off while the box is open closes the box
    (slice 1's badge does that; this pins it in a menu).
  - `"with no help text it draws no badge"` — `help=""`, help on: no `wt-help-tooltip` in the row's
    shadow root.
  - `"the badge is named by help-label and described by its box once open"` — `aria-label` on the
    badge's button is "Help: Edit"; after opening, `aria-describedby` names the box.
  - `"paints the badge from the tokens"` — set `--wt-tap-min: 50px` and `--wt-help-badge-size: 30px`
    on `host`: the button is 50 × 50 and its circle 30 × 30; set `--wt-color-primary: rgb(1, 2, 3)`:
    the circle's background follows. (This is the token-painting test the house rule asks of a new
    primitive.)
  In `wt-menu-row.a11y.test.ts`, inside `describe.each(["light", "dark"])` using `mountThemed`, each
  with the menu open: `"help off"`, `"help on"` (with `{ enable: ["target-size"] }`), `"help on, box
  open"`. Then break it once by hand (remove `help-label`) and see `button-name` fire in the help-on
  case only; restore.
- [ ] **Step 2: See them fail** (the element does not exist):
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-menu-row.test.ts src/components/wt-menu-row.a11y.test.ts`
- [ ] **Step 3: Implement**, and add the export.
- [ ] **Step 4: Run again; all pass**, plus
  `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts src/tap-target-and-focus.test.ts src/components/wt-row-actions.test.ts`
  and `pnpm --filter @waitron/ui typecheck`.
- [ ] **Step 5: Deletion proofs** (each restored after): delete `data-keep-open` → the "tap on the
  badge" case fails; delete `position: static` → the "own square" case fails (the badge hangs
  instead); delete the `--wt-help-badge-target` override → the square's size case fails (24 px);
  render the badge before the slot → the Tab-order case fails.
- [ ] **Step 6: Commit**, e.g. `Add wt-menu-row: a menu option with a help badge in its own square beside it (A582)`.

---

### Task 3: `wt-help-switch` — the button that turns help on and off

**Files:** create `packages/ui/src/components/wt-help-switch.ts`, `wt-help-switch.test.ts`,
`wt-help-switch.a11y.test.ts`; export from `packages/ui/src/index.ts`.

**Interface:** `@property() label = "Help"`. `delegatesFocus` (`delegatesFocusShadowRootOptions`,
as `wt-row-actions.ts:10`). Render a native `<button type="button" aria-label=${label} aria-pressed=${on}>`
holding `<span class="icon" aria-hidden="true">?</span>`; a click calls `setHelpMode(!currentHelpMode())`.
`HelpModeController` redraws it. Styles: the button `min-width`/`min-height: var(--wt-tap-min)`,
transparent, `--wt-radius-md`, focus ring as `wt-row-actions`; the icon as `wt-help-tooltip`'s
always-mode circle (`wt-help-tooltip.ts:31-40`) in `--wt-color-text-muted`; pressed:
`background: var(--wt-color-primary); color: var(--wt-color-on-primary); border-color: transparent`
on the icon. No `disabled` property.

- [ ] **Step 1: Write the failing tests** (`afterEach`: `cleanup()`, `setHelpMode(false)`):
  - `"starts unpressed while help is off"` — `aria-pressed="false"`, named "Help".
  - `"a click turns help on and shows as pressed; a second turns it off"` — `currentHelpMode()` true
    then false; `aria-pressed` follows.
  - `"follows help turned on elsewhere"` — `setHelpMode(true)`; after `updateComplete` it reads pressed.
  - `"two switches stay in step"` — mount two; click one; the other reads pressed.
  - `"Enter and Space toggle it"`.
  - `"is a --wt-tap-min target"` — set `--wt-tap-min: 50px` on `host`; the button is at least 50 × 50.
  - `"paints from the tokens"` — set `--wt-color-text-muted` and, pressed, `--wt-color-primary` /
    `--wt-color-on-primary` on `host`; the icon's computed colours follow.
  - `"takes the app's word for Help"` — `label="Ayuda"`: the button is named "Ayuda".
  In `wt-help-switch.a11y.test.ts`, both themes: `"help off"` and `"help on"` (with
  `{ enable: ["target-size"] }`). Break it once (empty `label`) and see `button-name` fire.
- [ ] **Step 2: See them fail:**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-help-switch.test.ts src/components/wt-help-switch.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again; all pass**, plus `src/no-hardcoded-chrome.test.ts`,
  `src/tap-target-and-focus.test.ts`, `src/help-mode.test.ts`, and `pnpm --filter @waitron/ui typecheck`.
- [ ] **Step 5: Deletion proofs:** delete the controller → "follows help turned on elsewhere" fails;
  bind `aria-pressed` to a constant → the click case fails.
- [ ] **Step 6: Commit**, e.g. `Add wt-help-switch, the "?" button that turns help mode on and off (A582)`.

---

### Task 4: help on `wt-data-table` columns

**Files:** `packages/ui/src/components/wt-data-table.ts` (`DataTableColumn`, `:32-63`; `#renderHead`,
`:2491-2579`; styles), create `wt-data-table.help.test.ts`, extend `wt-data-table.a11y.test.ts`.

What changes: `DataTableColumn` gains `/** A help-mode badge over the heading's label. */ help?: string;`.
The table gains `@property({ attribute: "help-label" }) helpLabel = "Help";`. In `#renderHead`, for a
column with `help`, the heading content (the plain label or the sort `<button>`, before
`#treeHeading` wraps it) goes inside
`<span class="head-label">…<wt-help-tooltip mode="help-mode" aria-label=${`${this.helpLabel}: ${column.label}`}>${column.help}</wt-help-tooltip></span>`,
with `.head-label { position: relative; display: inline-block; }`. A column without `help` renders
exactly as today. The badge sits outside the sort button, never inside it.

- [ ] **Step 1: Write the failing tests** in `wt-data-table.help.test.ts` (the file's own mount, as
  `wt-data-table.head-and-cells.test.ts:40-55` does; `afterEach`: `cleanup()`, `setHelpMode(false)`):
  - `"a column with help hangs a badge over its label's top trailing corner while help is on"` —
    the badge button's centre within 1 px of the label span's top-right corner.
  - `"it adds no scroll and moves nothing"` — on the LAST column of a table as wide as its box: with
    help off and on, `.scroll`'s `scrollWidth === clientWidth` and `scrollHeight === clientHeight`,
    and every `th`'s box is the same as with no `help` at all. **Control in the same case:** hang the
    same badge over the `th`'s corner instead (make the `th` `position: relative` and append it
    there): `scrollWidth > clientWidth` (M5).
  - `"a sortable column's badge is beside the sort button, not inside it"` — the badge's
    `closest("button.sort")` is null; clicking the badge opens its box and does not sort
    (`aria-sort` unchanged).
  - `"with sticky-header the badge is not cut off"` — `sticky-header`, help on: the badge button's
    top is at or below `.scroll`'s top.
  - `"the badge is named Help: and the column's label, and helpLabel changes the word"`.
  - `"a column without help renders its heading as before"` — no `.head-label`, no badge.
  - `"while help is off the badge cannot be reached"`.
  - `"in a right-to-left page it hangs over the label's top left corner"`.
  In `wt-data-table.a11y.test.ts`, inside its existing theme loop: `"a column with help, help off"`
  and `"…, help on"` (with `{ enable: ["target-size"] }`).
- [ ] **Step 2: See them fail:**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.help.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again; all pass**, with every existing table suite unedited:
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.help.test.ts src/components/wt-data-table.a11y.test.ts src/components/wt-data-table.test.ts src/components/wt-data-table.head-and-cells.test.ts src/components/wt-data-table.column-arrangement.test.ts src/components/wt-data-table.filters-sorting.test.ts src/components/wt-data-table.tree-expansion.test.ts src/components/wt-data-table.view-memory.test.ts src/components/wt-data-table.lifecycle.test.ts src/components/wt-data-table.server-paging.test.ts src/no-hardcoded-chrome.test.ts`,
  then `pnpm --filter @waitron/ui typecheck`.
- [ ] **Step 5: Deletion proofs:** delete `position: relative` from `.head-label` → the corner case
  fails; move the badge into the `th` itself → the "no scroll" case fails; put the badge inside the
  sort button → the sortable case fails.
- [ ] **Step 6: Commit**, e.g. `Table columns can carry help: a badge over the column's label in help mode (A582)`.

---

### Task 5: help on `wt-tabs` items

**Files:** `packages/ui/src/components/wt-tabs.ts` (`TabItem`, `:7-13`; render, `:278-339`; the
size observer and scroll handling, `:153-276`), create `wt-tabs.help.test.ts`, extend
`wt-tabs.a11y.test.ts`.

What changes: `TabItem` gains `help?: string`; the element gains
`@property({ attribute: "help-label" }) helpLabel = "Help"`. A tab with `help` draws its label in
`<span class="tab-label">` (only that tab; others unchanged). After the tab strip, inside
`.tab-row` (which becomes `position: relative`), render one
`<wt-help-tooltip mode="help-mode" data-key=… aria-label=${`${helpLabel}: ${label}`}>${help}</wt-help-tooltip>`
per tab with help, styled `position: absolute; inset: auto; margin: 0; translate: -50% -50%` from
`wt-tabs`' own shadow CSS. A `#placeBadges()` sets each badge's `left`/`top` (px, relative to
`.tab-row`) to its tab label's top trailing corner (`right` in left-to-right, `left` in
right-to-left, read from the strip's computed `direction`), and sets `data-out-of-view` when that
corner is outside the strip's visible box; `wt-help-tooltip[data-out-of-view] { visibility: hidden; }`.
Call it from `updated`, from the strip's `scroll` handler (beside `#scheduleOverflow`, `:284`), from
the size observer's callback, and from a `HelpModeController` update (the badges have no size while
help is off, so they are placed when it turns on).

- [ ] **Step 1: Write the failing tests** in `wt-tabs.help.test.ts` (mount as `wt-tabs.test.ts:9-20`;
  `afterEach`: `cleanup()`, `setHelpMode(false)`):
  - `"a tab with help hangs a badge over its label's top trailing corner while help is on"` — centre
    within 1 px of `.tab-label`'s top-right corner.
  - `"the badge is outside the tablist"` — `badge.closest('[role="tablist"]')` is null (M4).
  - `"it moves nothing"` — every tab button's box and the tab row's height are the same with help
    off, on, and with no `help`.
  - `"it follows its tab when the strip scrolls"` — a strip narrower than its tabs; scroll it by 40;
    after a frame the badge moved by 40 (within 1 px).
  - `"a badge whose tab is scrolled out of view is hidden and cannot be focused"` — `visibility` is
    `hidden`; `button.focus()` leaves no active element.
  - `"tapping the badge opens its box and does not select the tab"` — no `wt-tab-change`.
  - `"in a right-to-left page it hangs over the label's top left corner"`.
  - `"while help is off it cannot be reached; with help on, Tab goes from the selected tab to the badges"`.
  - `"helpLabel names the badge with the tab's label"`.
  In `wt-tabs.a11y.test.ts`, both themes: `"a tab with help, help off"` and `"…, help on"` (with
  `{ enable: ["target-size"] }`). The help-on case is the one that would have failed with the badge
  in the tablist (M4).
- [ ] **Step 2: See them fail:**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-tabs.help.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again; all pass**, with
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-tabs.test.ts src/components/wt-tabs.a11y.test.ts src/no-hardcoded-chrome.test.ts`
  unedited, then `pnpm --filter @waitron/ui typecheck`. `wt-tabs` is used by many dashboard screens;
  CI runs their suites.
- [ ] **Step 5: Deletion proofs:** drop the scroll call to `#placeBadges` → the "follows" case
  fails; drop `data-out-of-view` → the "hidden" case fails; render the badge inside the tablist →
  the a11y help-on case fails.
- [ ] **Step 6: Commit**, e.g. `Tabs can carry help: a badge over the tab's label, drawn outside the tab strip (A582)`.

---

### Task 6: the design-system entries, and what PR 2a says

**Files:** `docs/developers/design-system.md` (prettier ignores `docs/` as a whole, so format by hand).

- [ ] **Step 1: Read every claim this PR retires** — `grep -n "help\|keep-open\|wt-row-actions" docs/developers/design-system.md docs/developers/conventions-ui.md`.
  Known (read): "### Help mode" (`design-system.md:2089-2120`: "Nothing turns it on yet", and its
  guard list), the primitives table rows for `wt-row-actions`, `wt-data-table`, `wt-tabs`, and
  "### Hit targets" / "`--wt-tap-min`" if they list exceptions.
- [ ] **Step 2: Write.** In "### Help mode": the switch element (`wt-help-switch`: a toggle button,
  pressed while on, label from the app); menu rows (`wt-menu-row`, the badge in its own
  `--wt-tap-min` square, `data-keep-open`, Tab order option → badge → next option, first Escape
  closes the box, a `wt-button` option only for now); column `help` (the badge over the heading's
  label, because a cell's corner is clipped at the scroll box's edge) and tab `help` (drawn outside
  the tab strip, because a tablist may own only tabs; hidden while scrolled out of view); name the
  new guards (the four new test files). In the `wt-row-actions` row: `data-keep-open` counts on any
  element inside the menu, including inside a slotted element's shadow root; an open menu that
  changes size is placed again. Add the new primitives to the primitives table and the axe
  "verified by running" list with the date.
- [ ] **Step 3: Commit**, e.g. `Describe menu rows, the help switch and column and tab help in the design system (A582)`.
- [ ] **Step 4: The pull request.** Title, e.g. `Help mode, slice 2a: menu rows, the help switch, and help on table columns and tabs in packages/ui (A582)`.
  Body: what landed; that nothing on any screen changes yet; that 2b uses it; the measurements M1–M5
  in a sentence each. **The lander** updates `docs/backlog.md`'s A582 entry and
  `docs/backlog/dashboard.md`'s A582 detail on `main` to say 2a landed with its number.

---

# PR 2b — the dashboard

Branch `feat/a582-2b-dashboard-help`, made from `main` after 2a landed:
`python3 ~/workspace/tools/worktree.py new waitron feat/a582-2b-dashboard-help --headless`. Copy this
plan's 2b section into the new worktree's ledger (`docs/handoffs/`) before Task 7. Line numbers
below are at `40f4d71f9`; 2a touches no file 2b edits, so they should still hold, but re-find each
before editing.

## File map (2b)

| File | Change | Task |
| --- | --- | --- |
| `apps/dashboard/src/dashboard-app.ts` | the switch in the banner; help off in `#returnToLogin`; phone-width layout; account menu's menu row | 7, 9 |
| `apps/dashboard/src/dashboard-app.help.test.ts` (new) | the switch, staying on, going off, the phone-width banner | 7 |
| `apps/dashboard/src/dashboard-app.test.ts`, `dashboard-app.theme.test.ts` | changed checks (listed below) | 7, 9 |
| `apps/dashboard/src/i18n/strings.ts` | `help.*` keys, EN and ES | 7, 9, 10 |
| `apps/dashboard/src/screens/device-profiles-screen.ts`, `staff-screen.ts`, `widgets/unit-form.ts` | `mode="help-mode"` | 8 |
| `packages/payments-sumup/src/dashboard/sumup-connect-form.ts`, `.test.ts` | positioned box, `mode="help-mode"` | 8 |
| `apps/dashboard/src/widgets/unit-form.test.ts` | changed check | 8 |
| the device-profiles, staff, unit-form and units a11y files | help-on cases | 8 |
| `scripts/help-tooltip-mode.test.ts` (new) | the guard | 8 |
| `apps/dashboard/src/widgets/variant-table.ts`, `.test.ts` | Keep's menu row | 9 |
| `apps/dashboard/src/widgets/product-editor.ts`, `widgets/product-list.ts`, their tests | Products help | 10 |
| `docs/developers/design-system.md`, `conventions-ui.md`, `docs/backlog.md`, `docs/backlog/dashboard.md`, `CLAUDE.md` | docs | 11 |

## Changed test checks (2b)

Each changes because the spec (or this plan's decision under it) changes the behaviour it checks:

1. `apps/dashboard/src/dashboard-app.test.ts:5425-5437`, "puts the language chooser, then the bell,
   before the account menu in the banner" — the expected children gain `"help-switch"` between
   `"alerts-bell"` and `"account-menu"`. Spec §3.1 puts the switch there.
2. `dashboard-app.test.ts:5438-5489`, "fits every banner item without overlap at %ipx" (360, 400,
   480) — the assertion "the language chooser shares the lockup's row" (`:5485-5487`) becomes "the
   language chooser is on the second row, level with the venue name, at the trailing edge"; the
   switch joins the measured items and "shares the lockup's row". Decision 2 (spec §3.1 leaves the
   method to this plan).
3. `dashboard-app.test.ts:5527-5604`, "when the intent is %s, in %s, fits banner items and the shared
   bar at %ipx" (360, 390, 480) — the same change at `:5600-5602`. The 60 px lockup floor (`:5587`)
   is NOT changed and must pass with the switch in the first row.
4. `apps/dashboard/src/dashboard-app.theme.test.ts:181-190`, "signed in, the banner has no theme
   chooser and the account menu holds the Theme choices between Account settings and Log out" —
   the account menu's children become `["profile-row", "theme-choices", "logout"]`: Account settings
   now sits in a `wt-menu-row` (spec §3.3). The `wt-button` inside keeps `data-test="profile"`, so
   every test that clicks it is unchanged.
5. `apps/dashboard/src/widgets/unit-form.test.ts:117-140`, "shows the decimal-places help on demand
   from a help button beside the precision" — it measures the "?" (`:133`) and clicks it (`:134`),
   which is hidden until help is on (spec §7). The case turns help on first (`setHelpMode(true)`,
   with `setHelpMode(false)` in `afterEach`) and adds that with help off the "?" is not visible.

Not changed, but their scans no longer see the five "?" while help is off, so Task 8 adds help-on
axe cases beside them: `device-profiles-screen.a11y.test.ts` (editor cases, `:154-249`, `:476-521`),
`staff-screen.a11y.test.ts:43-51`, `dashboard-app.a11y.test.ts:323-337`, `unit-form.a11y.test.ts:20-48`,
`units-screen.a11y.test.ts:42-55`. Tests that only check the "?"'s attributes or text keep passing
unedited: `staff-screen.test.ts:1445-1471`, `staff-filters.test.ts:134-150`,
`device-profiles-screen.test.ts:2251-2264`, `sumup-connect-form.test.ts:181-196` (all read).

---

### Task 7: the banner switch, help going off, and room at phone width

**Files:** `apps/dashboard/src/dashboard-app.ts` (`#banner`, `:1708-1811`; phone-width CSS,
`:737-770`; `#returnToLogin`, `:1332`), `apps/dashboard/src/i18n/strings.ts`, create
`apps/dashboard/src/dashboard-app.help.test.ts`, edit the checks 1–3 above.

What changes:
- Strings: `"help.label": "Help"` / `"Ayuda"`, `"help.badge_label": "Help: {part}"` / `"Ayuda: {part}"`.
- In `#banner`, signed in only, after the bell and before the account menu:
  `<wt-help-switch data-test="help-switch" label=${t("help.label")}></wt-help-switch>`.
- `#returnToLogin` calls `setHelpMode(false)` (decision 4).
- Phone-width layout, signed in (decision 2). Mark the banner (e.g. `data-signed-in` on
  `.brand-banner` when `authenticated`). Under `@media (max-width: 48rem)`, for the signed-in banner
  only, `.banner-actions` becomes `display: contents` so its children are grid items: the first row
  holds toggle, lockup, then bell, switch and account menu at the trailing edge; the second row
  holds the venue row, then the language chooser at the trailing edge (`justify-self: end`).
  Keep the 4 px space between the trailing controls and 8 px before them, which is what M7 measured
  with. Keep the DOM order of `.banner-actions`' children (`language-chooser`, `alerts-bell`,
  `help-switch`, `account-menu`), so the signed-out banner and its tests are untouched. The
  implementer may choose different CSS if it meets the acceptance below.

- [ ] **Step 1: Write the failing tests** in `dashboard-app.help.test.ts` (copy the mount helpers it
  needs from `dashboard-app.test.ts:69-260` and `:5345-5405`, as the sibling `dashboard-app.theme.test.ts`
  does; `afterEach`: `setHelpMode(false)`, `cleanupWidgets()`):
  - `"signed in, the banner has a Help switch between the bell and the account menu"`.
  - `"signed out, there is no Help switch"`.
  - `"the switch turns help on and off, and shows when it is on"` — `aria-pressed`, `currentHelpMode()`.
  - `"help stays on when moving between screens"` — on, select another screen through the nav; still on.
  - `"logging out turns help off"`, `"the session expiring turns help off"` (advance the idle timer
    as the existing expiry tests do — find them with `grep -n "management_session.expired" src/dashboard-app.test.ts`),
    `"a refused session turns help off"` (dispatch `waitron-session-invalid` with
    `management_session.expired`), `"another tab's expiry turns help off"` (a `storage` event with
    deadline 0) — one case per path in decision 4, so deleting any one call path is seen.
  - `"a fresh page starts with help off"` — a second `dashboard-app` mounted after `setHelpMode(false)`
    and a spy on `Storage.prototype.setItem` shows no help key written while toggling (the reload
    receipt is slice 1's in-memory state; this pins that the dashboard adds no storage).
  - `it.each` over `live`/`demo` × `en-GB`/`es-ES` × 320/360/390/480:
    `"signed in at %ipx the switch shares the lockup's row and the language chooser takes the second row"` —
    at 360, 390 and 480 the lockup is at least 60 px; at 320 it is at least 31 px (today's width,
    M6); the switch, bell and account menu share the lockup's row; the chooser is below the lockup,
    at the banner's trailing edge, level with the venue name within 1 px; nothing overlaps; the
    banner does not scroll sideways. **What the failing case shows:** without the layout change the
    lockup reads about 23 px at 360 and 53 px at 390 (M6).
  - `"at 1280px the language chooser stays in the first row"`.
  - `"has no accessibility violations with help on, in both themes"` — the banner and an open account menu.
- [ ] **Step 2: See them fail:** `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.help.test.ts`.
- [ ] **Step 3: Implement**, and edit changed checks 1–3.
- [ ] **Step 4: Run again; all pass**, with the banner suites:
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.help.test.ts src/dashboard-app.test.ts src/dashboard-app.theme.test.ts src/dashboard-app.a11y.test.ts`
  (`dashboard-app.test.ts` is long: check free memory first). Then
  `pnpm --filter @waitron/dashboard typecheck`.
- [ ] **Step 5: Deletion proofs:** delete `setHelpMode(false)` in `#returnToLogin` → all four
  going-off cases fail; delete the phone-width rule → the 360/390 cases fail on the lockup.
- [ ] **Step 6: Commit**, e.g. `A "?" in the dashboard banner turns help on and off; at phone width the language chooser moves to the second row to make room (A582)`.

---

### Task 8: the five "?" become badges, SumUp's gets a box, and a guard keeps new ones in help mode

**Files:** `apps/dashboard/src/screens/device-profiles-screen.ts:2136`, `:2197`;
`apps/dashboard/src/screens/staff-screen.ts:401`; `apps/dashboard/src/widgets/unit-form.ts:372`;
`packages/payments-sumup/src/dashboard/sumup-connect-form.ts:41-48`, `:245-253` and its test; the a11y
files listed under "Changed test checks"; `apps/dashboard/src/widgets/unit-form.test.ts:117-140`;
create `scripts/help-tooltip-mode.test.ts`.

- [ ] **Step 1: Write the guard first**, modelled on `scripts/native-form-fields.test.ts` (read its
  `sourceFilesIn`, `:114-124`, and its literal visitor, `:79-112`): walk `apps` and `packages`,
  skipping `node_modules`, `dist`, dot-directories, `*.test.ts` and `apps/setup`; parse each `.ts`
  with `ts.createSourceFile`; in every string, template and no-substitution literal (with `${…}`
  blanked to spaces, as `:86-92`), find each `<wt-help-tooltip\b[^>]*` and report `file:line` unless
  that tag's text contains `mode="help-mode"`. Export the matcher; unit cases: a tag with the mode
  passes; one without it fails; `mode=${x}` fails (the blanked expression is not the literal);
  `mode="always"` fails; text in a comment is not read. The tree case: `expect(offenders).toEqual([])`
  and "reaches both roots". Header comment: **weaker than its name** — it reads literals as text, so
  a badge made with `document.createElement` or a tag name built at run time is unseen, and it does
  not check that a badge sits in a positioned box. Run it and see it list exactly the five sites:
  `pnpm exec vitest run scripts/help-tooltip-mode.test.ts` (the root project includes
  `scripts/**/*.test.ts`, `vitest.config.ts:71`, read).
- [ ] **Step 2: Write the other failing tests:**
  - `sumup-connect-form.test.ts`: `"the affiliate help is hidden until help is on, then hangs over the heading's top trailing corner"` —
    help off: not visible; help on: the badge button's centre within 1 px of the heading text box's
    top-right corner. (Without the positioned box it hangs over a far ancestor — slice 1's
    measurement found (414, 0) against the page.)
  - Help-on axe cases (both themes, as each file already loops) in
    `device-profiles-screen.a11y.test.ts` (one editor case), `staff-screen.a11y.test.ts`,
    `unit-form.a11y.test.ts` and `units-screen.a11y.test.ts`, each run with
    `{ enable: ["target-size"] }`; if axe flags an overlap of the badge with the field, that overlap
    is the approved look (spec §3.1): keep the case on default rules and report it.
  - Changed check 5 in `unit-form.test.ts`.
- [ ] **Step 3: See the guard and the SumUp case fail**, then implement: `mode="help-mode"` on the
  five; in SumUp, wrap the label `<span>` and the badge in
  `<span class="affiliate-heading">` with `position: relative; display: inline-block`.
- [ ] **Step 4: Run; all pass:**
  `pnpm exec vitest run scripts/help-tooltip-mode.test.ts`;
  `pnpm --filter @waitron/payments-sumup exec vitest run src/dashboard/sumup-connect-form.test.ts src/dashboard/panel.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/unit-form.test.ts src/widgets/unit-form.a11y.test.ts src/screens/units-screen.a11y.test.ts src/screens/staff-screen.test.ts src/screens/staff-screen.a11y.test.ts src/screens/staff-filters.test.ts src/screens/device-profiles-screen.test.ts src/screens/device-profiles-screen.a11y.test.ts src/dashboard-app.a11y.test.ts`.
  (`@waitron/payments-sumup`, read from its `package.json`.) Then typecheck both packages.
- [ ] **Step 5: Deletion proofs:** remove `mode="help-mode"` from one site → the guard names it;
  remove `position: relative` from `.affiliate-heading` → the SumUp case fails.
- [ ] **Step 6: Commit**, e.g. `The dashboard's five "?" show only in help mode, and a guard keeps every new "?" outside setup in help mode (A582)`.

---

### Task 9: the first menu rows — Account settings and a variant's Keep

**Files:** `apps/dashboard/src/dashboard-app.ts` (account menu, `:1778-1806`),
`apps/dashboard/src/widgets/variant-table.ts` (`#action`, `:325-344`; the restore action,
`:416-426`), `strings.ts`, `dashboard-app.theme.test.ts` (changed check 4), `variant-table.test.ts`.

Texts (each a claim; the code it describes is cited, read):

| Key | English | Spanish (draft; match the table's existing words) | What it describes |
| --- | --- | --- | --- |
| `help.account.settings` | Your name, email, phone and language, and how you sign in: password, PIN, passkeys, authenticator app and Google. | Tu nombre, correo, teléfono e idioma, y cómo inicias sesión: contraseña, PIN, llaves de acceso, app de autenticación y Google. | `apps/dashboard/src/screens/profile-screen.ts:519` (name, display name, email, phone, language fields), `:877` (password), `:890` (PIN), `:45` and `:535` (passkeys), `:966` (authenticator), `:991-999` (Google), `:1037` (language) |
| `help.products.keep_variant` | Cancels archiving this variant. Archiving happens only when you save the product. | Cancela el archivado de esta variante. Se archiva solo al guardar el producto. | `variant-table.ts:416-426` (Keep shows only for a variant marked inactive and emits `wt-restore`), `:374-378` and `strings.ts:2000` ("Archived when saved"), `product-editor.ts:1050-1062` (variant edits stay in the draft until save) |

The implementer re-reads each cited place and narrows a text that says more than the code; the
Spanish for "passkey" and "authenticator app" must match what `strings.ts` already uses (grep the
`profile.` keys' Spanish values).

- [ ] **Step 1: Write the failing tests:**
  - `dashboard-app.help.test.ts`: `"with help on, the account menu shows a badge beside Account settings"` —
    open the menu; the `wt-menu-row` holding `[data-test=profile]` shows its badge, named
    "Help: Account settings"; a click on it opens the box, does not open the profile and leaves the
    menu open; with help off, no badge.
  - `variant-table.test.ts`: `"with help on, Keep has a badge that explains it, and Keep still works"` —
    a variant marked to be archived; help on; open its ⋮; the badge beside Keep is named
    "Help: Keep"; clicking the badge emits no `wt-restore`; clicking Keep emits it as before.
  - Changed check 4.
- [ ] **Step 2: See them fail**, then implement: wrap Account settings' `wt-button` in
  `<wt-menu-row data-test="profile-row" help=… help-label=${fill("help.badge_label", { part: t("action.account_settings") })}>`,
  and the variant table's restore action in a `wt-menu-row` the same way (only that action; the
  others stay as they are). `#action`'s `event.stopPropagation()` (`variant-table.ts:337`) is kept as
  it is: the menu row does not change where the option's click goes.
- [ ] **Step 3: Run; all pass:**
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.help.test.ts src/dashboard-app.theme.test.ts src/widgets/variant-table.test.ts src/widgets/product-editor.test.ts`
  and `pnpm --filter @waitron/dashboard typecheck`.
- [ ] **Step 4: Commit**, e.g. `The account menu's Account settings and a variant's Keep explain themselves in help mode (A582)`.

---

### Task 10: Products — help on each part that needs it

**Files:** `apps/dashboard/src/widgets/product-editor.ts` (price `:1542-1569`, VAT `:1422-1441`,
Default course `:1157-1177`, Variants `:1620-1713`), `apps/dashboard/src/widgets/product-list.ts`
(Availability column `:1230-1247`; the `wt-data-table` at `:1630-1715`), `strings.ts`, their tests.
All line numbers read at `40f4d71f9` (a read-only research pass).

Badges: the price, VAT and course fields take
`<wt-help-tooltip slot="help" mode="help-mode" aria-label=${fill("help.badge_label", { part: <the field's label> })}>${t(<key>)}</wt-help-tooltip>`
in their existing `help` slots; Variants takes one in `wt-disclosure`'s `help` slot; the
Availability column gets `help: t("help.products.availability")` and the table `help-label=${t("help.label")}`.

Texts. Each is a claim about behaviour; the right-hand column is the code it describes (read). The
implementer follows each call chain once more before committing and narrows any sentence the code
does not bear out (`CLAUDE.md` §1). Owner's standing rule: as short as the meaning allows.

| Key | English | Spanish (draft) | Code it describes |
| --- | --- | --- | --- |
| `help.products.price` | The price includes VAT. With Each it sells one at a time; with a unit that has decimal places, the till asks how much. | El precio incluye el IVA. Con Unidad se vende de uno en uno; con una unidad con decimales, la caja pregunta la cantidad. | `packages/catalogue/src/pricing.ts:31` (`unitPrice` is gross, per selected unit); `packages/catalogue/src/units.ts:21-29` (no unit reads as Each, precision 0); `apps/till/src/widgets/product-pick.ts:19-33` (the keypad asks for a quantity when the unit's `precision > 0` or it has a scale unit) |
| `help.products.vat` | The VAT class. A sale uses the class's rate on the day it is invoiced. A change reaches the tills when the menu is published again. | La clase de IVA. Una venta aplica el tipo de la clase el día de la factura. Un cambio llega a la caja al volver a publicar la carta. | `packages/catalogue/src/vat-rates.ts:4`, `:22-27`, `:76-84` (classes and dated rates); `apps/server/src/issue-moment.ts:17-20` and `pricing.ts:178-206` (rate taken at issue); `packages/catalogue/src/menu-document.ts:756` and `docs/developers/products.md:146-157` (a VAT change is a menu change, reaching tills on republishing) |
| `help.products.course` | The course this dish goes out in, unless staff change it on the order. Extras have no course. | El curso en que sale este plato, salvo que el personal lo cambie en el pedido. Los extras no llevan curso. | `apps/server/src/working-order.ts:781` (a line's own course, else the product's default) and `:776` (extras lines take none) |
| `help.products.variants` | Versions of this product with their own name and price, such as sizes. A blank field uses the product's. Once it has a variant, the till sells only its variants. | Versiones de este producto con su propio nombre y precio, como tamaños. Un campo vacío usa el del producto. Con variantes, la caja solo vende las variantes. | `packages/catalogue/src/variant-fallback.ts:101-117` (blank fields inherit); `packages/catalogue/src/variants.ts:506-508` (`product.variant_required`: a product with an active variant cannot be sold as itself) |
| `help.products.availability` | Unavailable: its Available switch is off, so the tills stop selling it at once, with no publishing. Archived: no longer sold. | No disponible: su interruptor Disponible está apagado, así que la caja deja de venderlo al momento, sin publicar. Archivado: ya no se vende. | `product-list.ts:1234-1245` (what the column shows); `menu-document.ts:431` (`sellable = active && available`) and `:529-600` (`applyLiveFields` reads it from the current rows, so no publish is needed); `catalogue-screen.ts:399-423` (Archive sets `active: false`) |

Known gaps to check while implementing (from the research pass): "Each" is "Unidad" in Spanish
(`strings.ts:4907`), so the Spanish price text says "Unidad"; "at once" in the Availability text
holds only if the till re-reads the live fields without a reload — follow `applyLiveFields` to the
till's menu read and, if a till must reload or refresh, say "on its next refresh" instead (record
which in the commit).

- [ ] **Step 1: Write the failing tests:** in `product-editor.test.ts` and `product-list.test.ts`
  (find each file's mount helper first):
  - `"with help on, the price, VAT, course and Variants show a badge with their help text"` — each
    badge visible, named "Help: <label>", its box's text the English string; with help off none is
    visible.
  - `"the Availability column has help"` — the column's badge, help on.
  - `"in Spanish the badges read the Spanish help"` — one field and the column.
  - `"turning help on moves nothing in the editor"` — each field's `[part=field]` box and the
    Variants header box are the same with help off and on (slice 1's "takes no room", at screen
    level).
  - An axe case with help on in `product-editor.a11y.test.ts` and the product list's a11y file, if
    they exist (`ls apps/dashboard/src/widgets/product-*.a11y.test.ts`); otherwise in the catalogue
    screen's.
- [ ] **Step 2: See them fail**, implement, then run:
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-editor.test.ts src/widgets/product-list.test.ts src/screens/catalogue-screen.test.ts src/screens/catalogue-screen.a11y.test.ts`
  (add whichever a11y files Step 1 used) and `pnpm --filter @waitron/dashboard typecheck`.
- [ ] **Step 3: Commit**, e.g. `Products explains its price, VAT, course, variants and availability in help mode (A582)`.

---

### Task 11: look at it, docs, backlog, and what PR 2b says

- [ ] **Step 1: Look.** Check free memory and the venue's holders (`lsof` on the venue folder and
  port 8080) first. Start the stack with `wa-wt demo <worktree-name>` (the new worktree's name;
  never a bare `pnpm dev`), sign in, and screenshot with the workspace's Playwright Chromium, in
  light and dark, at 1280 × 900 and 390 × 844, plus the banner at 320 and 360: Products with help
  off and on; a badge's box open over the price field; the Availability column's badge; the
  Variants section's badge (slice 1's decision 9: it hangs at the end of the heading row, not right
  after "Variants" as mockup 01 draws it — show the owner); the account menu open with help on and
  the Account settings box open; a variant's ⋮ with Keep's badge; the phone-width banner with the
  chooser on the second row; device profiles' Department badge; SumUp's affiliate badge. Keep the
  screenshots outside the worktree (`mktemp -d`) and describe what each showed in the PR body.
  Stop the stack the way `wa-wt` documents, by the ids it started.
- [ ] **Step 2: Docs.** Read every claim the change retires, across the whole base-to-tip range:
  `grep -rn "help\|language chooser\|account menu" docs/developers/design-system.md docs/developers/conventions-ui.md`.
  Known (read): `design-system.md` "### Help mode" ("Nothing turns it on yet"; "Every other new
  badge takes `mode="help-mode"`. Nothing guards this" — now guarded, name the guard and that it is
  weaker than its name); "### Dashboard banner" (`:3102-3154`: the language chooser "sits at the
  trailing edge too" — now on the second row below `48rem` signed in, with M6–M8 as the receipt
  replacing A681's; the switch between the bell and the account menu; help off on sign-out and
  session end; the account menu's Account settings in a menu row); `conventions-ui.md:42` (the
  "?" rule — check it still reads right). Add one `CLAUDE.md` §3 line only if a reviewer would
  otherwise relitigate it: "A `wt-help-tooltip` outside the setup wizard carries `mode="help-mode"`.
  Guard: `scripts/help-tooltip-mode.test.ts`, weaker than its name — reads literals as text." (with
  the receipt in `conventions-ui.md`).
- [ ] **Step 3: Backlog.** In `docs/backlog/dashboard.md`'s A582 detail, replace "Slice 2 must also"
  with a line that slice 2 landed (both PR numbers), and keep slices 3–5. New short entries for what
  this leaves open: help on `<a href>` menu options (decision 6); the language chooser's place at
  phone width, for the owner to confirm (decision 2); help on the other dashboard screens as they
  are touched. Update `docs/backlog.md`'s A582 line to match.
- [ ] **Step 4: Commit**, e.g. `Describe the dashboard's help mode, its guard and the phone-width banner (A582)`.
- [ ] **Step 5: The pull request.** Title, e.g. `Help mode, slice 2b: a "?" in the dashboard banner, help on Products, and menu options with help (A582)`.
  Body: what a person sees; the phone-width banner decision and its measurements (M6–M8); the
  changed test checks 1–5 with the reason for each; the screenshots' findings; open risks.

---

## Mutation testing

`packages/ui`'s floor of 90 is enforced only by the nightly run (slice 1's plan, citing
`docs/developers/ci-and-gates.md:325`). The new logic and the case that kills each likely mutant:

| Logic | Mutant | Killed by |
| --- | --- | --- |
| `closesMenu`'s path slice | whole path; `indexOf` → `0` | Task 1's control case; the shadow keep-open case |
| the resize observer's open check | always / never re-place | the "grows" case; existing positioning cases |
| `wt-menu-row`'s `help ? badge : nothing` | always draw | "no help text draws no badge" |
| `wt-help-switch`'s `!currentHelpMode()` | `!` removed | "a second click turns it off" |
| table head wrapper only with `help` | always wrap | "a column without help renders as before" |
| tabs' out-of-view test | inverted, removed | the "hidden" case and the corner case |

## Review focus

1. **PR 2a changes no screen.** Every existing `packages/ui` test passes unedited; the one shared
   behaviour change is `wt-row-actions`' keep-open scope and re-placing, pinned in Task 1 with a
   control that outside elements still do not keep a menu open.
2. **PR 2b's changed checks are exactly the five listed**, each traced to the spec or decision 2.
3. **Every help text against its cited code** (Tasks 9 and 10): reviewers follow the call chain, not
   the label.
4. **The phone-width banner** (decision 2) is a visible change the mockup did not draw; the PR's
   screenshots must show it.

## Open risks

- **Decision 2 departs from mockup 03**, which drew the language chooser on the first row. The
  measurements say it does not fit there with the switch; the owner may prefer the chooser in the
  account menu instead. Task 11 puts it in the backlog for him to confirm.
- **The Availability text's "at once"** depends on how quickly a till sees a live field change;
  Task 10 checks it and narrows the text if needed.
- **A menu row with a link option** loses the link's look (decision 6). No user needs it in this
  slice.
- **Tab badges are placed by script**, so a layout change that the observer does not see (a font
  loading late, for example) could leave a badge off its corner until the next scroll or resize.
  No screen uses tab help yet; the first screen that does should look at it.
- **The guard reads literals as text** (Task 8): a badge created with `document.createElement` or a
  tag built at run time is not checked, and nothing checks that a badge sits in a positioned box.
- **Badges overlapping text.** A column's or a dialog heading's badge hangs over its label's corner
  and can cover part of the last letter, as the mockup draws it; the look step shows the owner.
