# A761 — The staffing grid: a drag paints unless a block is picked, and a wide block editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the staffing grid, a drag paints a new block unless the block under it was clicked first, and a block's editor becomes a wide form whose change is kept only on Save.

**Architecture:** All product code is in `packages/staffing/src/dashboard/staffing-grid.ts`. A new `picked` state names the one block whose edges exist; it is set by a click and cleared when focus leaves that block and its editor. The editor stages role and headcount in a `draft` and sends one `staffing-change` on Save. No shared venue-service code changes.

**Tech stack:** Lit 3, `@waitron/ui` (`wt-combobox`, `wt-number-stepper`, `wt-form-actions`, `wt-button`, `saveActionState`, `submitOnEnter`), Vitest 4 browser mode (real headless Chromium).

**Spec:** the owner's item, quoted in full below. Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a761-staffing-grid-paint-and-editor`, branch `feat/a761-staffing-grid-paint-and-editor`.

## The item, as written

`docs/backlog.md`:

> **A761. The staffing grid: a drag paints unless a block is picked, and a wide block editor (owner, 2026-10-16).** Painting a second role over a day almost always resized the first; now a block must be clicked before its edges resize it. Its editor becomes wide: a role dropdown, How many beside it, and `[Cancel] [Delete] … [Save]`, saving only on Save.

`docs/backlog/workforce.md` → "A761":

> 1. **A drag paints a new block unless you have clicked an existing one first.** Today a drag that starts on a block acts on it: its top and bottom quarters resize it and the rest opens its menu (`staffing-grid.ts:62-63`, the `.edge` rule at `:140`). A block fills its column's width for its hours, so painting a second role over the same hours almost always lands on the first and resizes it. Owner: "if you want to edit an existing one then you should click it first. once it loses focus then dragging paints a new one instead". An unpicked block lets a drag paint through it; clicking a block picks it, and only then do its edges resize it and its editor open. The keyboard keeps working: picking a block also focuses it.
> 2. **The block's editor becomes wide, with a Save.** Today it lists one button per staff role, the current one drawn disabled so it reads as unavailable; a role click and the "How many" stepper save at once; Delete is a large red button; the contents do not line up. Owner: a dropdown of roles, wide rather than long, and a Save rather than saving on a click outside.
>
> ```
> Staff role                How many
> [ Sous chef         ▾ ]   [ −  3  + ]
>
> [Cancel] [Delete]                [Save]
> ```
>
> The role field is the shared combobox (searchable); Save stays quiet until something changes; a click outside or Cancel throws the change away; the bottom row follows the house rule for a destructive action (design-system.md → Forms). A707's note that on a phone the block menu can cover its block is checked against the new editor.

## How it works today (read 2026-10-17, main 3e1f0a0d5)

- Every editable block is a `<button class="block">` holding two `.edge` spans (`staffing-grid.ts:557-563`). A press on an edge starts a resize (`#onPointerdown`, `:376-393`). A press anywhere else on the block already paints: the test "a drag starting on a block adds beside it rather than changing it" (`staffing-grid.test.ts:332`) pins it. So the fix for point 1 is that the edges exist only on the picked block.
- A click opens the menu (`#select`, `:423-429`). Choosing a role sends a change and closes the menu (`#changeRole`, `:455-460`). Each step of How many sends a change and leaves the menu open (`#changeHeadcount`, `:461-473`). Delete is a full-width `danger` button (`:670-678`). Delete or Backspace inside the menu deletes, except in an `<input>` (`#onMenuKeydown`, `:439-454`).
- The menu is an auto popover placed by `placePopover(this.menu, trigger, false)` (`:427`), so its light dismiss closes it.
- The staffing package has no Stryker config: only `ui`, `ui-core`, `fiscal`, `shared` and `db` have one (`find packages apps -maxdepth 2 -name 'stryker*'`). Coverage bar: `98/98/98/95` (`packages/staffing/vitest.config.ts`).
- Baseline run, 2026-10-17, 73% memory free: `pnpm --filter @waitron/staffing exec vitest run src/dashboard/staffing-grid.test.ts src/dashboard/staffing-grid.a11y.test.ts` gave `Tests 84 passed (84)` in 13 s. Drags are simulated by dispatching `PointerEvent`s on the `.day` column or an `.edge` span (`point`, `drag`, `staffing-grid.test.ts:64-101`). Real clicks use `userEvent.click`.

## Decisions

1. **"Picked" is one block per grid, `picked: { key, index, block } | null`.** A click on a block picks it. That is a pointer click, or Enter or Space on the focused block, both of which reach `#select`. Tab focus alone does not pick, because picking only changes what a pointer drag does. A click that ends a drag picks nothing.
2. **The edges are drawn only on the picked block**, and it carries `data-picked`, which the focus-ring rule also matches. Why: the person needs to see which block's edges will resize it. `#onPointerdown` does not change: with no edge under the pointer, the press paints.
3. **"Loses focus" means a `focusout` from the picked block or from its editor whose `relatedTarget` is neither the picked block nor inside `.menu`.** The `relatedTarget` may be `null`, for example on a click on the page outside the grid. Inside `wt-combobox` or `wt-number-stepper`, the related target is retargeted to the field element, which is inside `.menu`, so the picked state stays. A press on an empty part of a column moves focus to that column (`.day` has `tabindex="-1"`, `:744`), so the block is unpicked. Two exceptions follow:
   - The grid's own closes keep the pick. Save, Cancel, Escape and a role change in the old menu **first focus the block, then hide the editor**, and a `#closingOwn` flag stays set until that refocus has happened.
     - Why: the plan's reviewer measured this on 2026-10-17 in real Chromium under Vitest browser mode. With focus on a button inside the open menu, `hidePopover()` fired no focusout at once, and focus stayed on the now-hidden button. Two animation frames later, a focusout fired with `relatedTarget` null and focus went to `body`. The browser did not focus the block again.
     - So a flag set only around `hidePopover()` would guard nothing.
     - Every test of an own close asserts the block's focus and `data-picked` after two `requestAnimationFrame`s, not only after `updateComplete`. Add a helper `twoFrames()` that awaits two `requestAnimationFrame` callbacks.
   - A focusout while `document.hasFocus()` is false is ignored. Why: switching to another app should not throw away a draft.
     - Note for implementers: in a Vitest browser file, `document.hasFocus()` is false until something takes focus. A test that sends a focusout before anything was focused trips this guard, so focus something first.
4. **Unpicking also closes an open editor and discards its draft.** The keyboard works the same way as a click outside: Tab out of the editor discards.
5. **The picked block follows the grid's own change of it.** After a resize or a Save, `picked.block` becomes the changed block at the same index. `resizeBlock` and `changeBlock` keep the index (`block-model.ts:69-104`). An echo from the host therefore keeps it picked. Any other `days` change that leaves a different block at `picked.index` unpicks it, by the same `sameBlock` check `willUpdate` uses for the menu (`:315-320`). A new `target`, or turning `readOnly`, also unpicks.
6. **Any stroke that stretches closes an open editor and drops its draft, whether it resizes from the picked block's edge or paints from its body.** The close happens when the stroke first stretches, at its first preview: `willUpdate` sees `this.#stroke.preview !== null` while `selected !== null`. It does not happen on the press. A press and release with no movement keeps the editor and its draft, on the edge as on the body (Decision 11).
   - Why: a stretched stroke changes the day, and the draft was opened on the block as it was. In the owner's sense, a stroke is a click outside the editor.
   - This close does not use `#closingOwn`: the pick follows wherever the press put the focus.
   - Note for implementers: a press on the block the editor was opened from does not light-dismiss the editor. `placePopover` opens it with `showPopover({ source: trigger })` (`paint-grid-parts.ts:113`), and the plan's reviewer measured on 2026-10-17 that pressing that source block left the editor open. The grid has to close it itself.
7. **The editor:**
   - Its body is a `.fields` row holding `wt-combobox name="staff-role"` (label "Staff role", `required`, the default `search="always"`, options `staffRoles` in order) and `wt-number-stepper name="headcount"` (1–`MAX_HEADCOUNT`).
   - Below that is `wt-form-actions`. Its `cancel` slot holds a `.cancel-group` with Cancel (`secondary`) then Delete (`danger`). Its default slot holds Save. This is the same as `routing-cell-editor.ts:684-726`.
   - Focus opens on the combobox.
   - Save uses `saveActionState({ isDirty: () => roleKnown && !sameBlock({ ...block, ...draft }, block) })` for its variant and `disabled`, and returns early when that state is `unchanged`. Here `roleKnown` means `staffRoles` holds `draft.staffRoleId`.
   - **A block whose staff role was deleted:** the role field opens empty, with its required mark. Save stays quiet and disabled until a known role is chosen, so a How many change alone does not enable it.
     - The Forms rule's messages for a refused submission (beside the field and at the bottom) do not apply. They speak only after the first press of the action, and here the action never enables while the role is unknown.
   - Enter in How many presses Save (`submitOnEnter`).
   - Delete still deletes at once and closes the editor, as it does today. The painter's own Save is the real commit.
8. **No draft scope and no `*.unsaved.test.ts` for the editor.** The owner says a click outside throws the change away, and leaving the painter through its own controls is a click outside. Closing the tab, reloading or the browser's Back with an open, changed editor also throws the change away silently, with no warning; the PR's opening lines say so. A scope registered through `draftScopeFor` would instead ask "Discard unsaved changes?". `saveActionState` needs only `Pick<DraftScope, "isDirty">` (`packages/ui/src/leave-controller.ts:141-147`). Precedents for passing a bare `isDirty` are `painter-frame.ts:160` and the till's `profile-dialog.ts:80`. Task 3 tests that the editor's draft asks nothing and does not set off the browser's leave warning. The painter's draft keeps its own scope and tests.
9. **Delete and Backspace in the editor delete the block only when the focus is outside both fields.** That means focus on Cancel, Delete, Save or the editor itself. They do nothing in the role field or How many: the check is a `wt-combobox` or `wt-number-stepper` in `composedPath()`. Why: those fields are where a person types and clears, and the role field's closed trigger is not an `<input>`, so today's `<input>` check would let a Backspace there delete the block. Backspace on a focused block still deletes it (`:479-484`).
10. **Escape** with the role list open closes only the list, because `wt-combobox` stops it (`wt-combobox.ts:863-865`). Otherwise Escape works like Cancel.
11. **Clicking the block whose editor is open leaves the editor and its draft as they are.**
12. **Placement:** the staffing call becomes `placePopover(this.menu, trigger, false, true)`. That `flipAbove` argument already exists (`paint-grid-parts.ts:107-112`) and is used by `calendar-day-box.ts:123`. The shared helper does not change. A707's shared work (Opening hours' block menu and the Copy to… chooser) stays out of scope. Task 4 records what the look shows.
13. **Strings: no new keys.** Cancel, Save, the search placeholder and "no results" reuse `staffing.role.cancel`, `staffing.role.save`, `staffing.role.search` and `staffing.role.no_results`, which already exist in English and Spanish (`strings.ts:145-149`, `:339-343`). The labels reuse `staffing.grid.staff_role`, `staffing.grid.how_many` and `staffing.grid.delete`.
14. **Shared styles:** `.menu wt-button { width: 100% }` comes from `paintGridStyles` (`paint-grid-parts.ts`, the `.menu wt-button` rule). The grid overrides it locally for the buttons in `wt-form-actions`. Sizes use `--wt-*` tokens only.

## Assumptions (not tested)

- **Safari and WebKit are not tested.** Safari does not focus a button when it is pressed, so focus may go to the `.day` column instead, which would unpick the block on every press. It was not tested because Playwright 1.64 wants WebKit build 2370 and only 2311 is installed (the plan's reviewer, 2026-10-17). The PR states this assumption.

## Global constraints

- Every commit is `git commit -s`. Never `git stash` and never `--no-verify`. Stage explicit paths.
- **Browser tests:** before each run, `memory_pressure | grep free` must show well above 15%. Run with `env -u AI_AGENT -u CLAUDECODE` so failures print their console output. Read the `Tests` count, not the exit status.
- **After each task:**
  - `pnpm --filter @waitron/staffing typecheck`
  - `pnpm exec eslint packages/staffing/src/dashboard`
  - `pnpm exec prettier --check <changed files>`
- Colours, spacing and fonts read `--wt-*` tokens. Nothing uses px, rem or em.
- **Coverage:** CI's staffing coverage job holds `98/98/98/95`. Every new branch named below has a test. Read the job's per-file row for `staffing-grid.ts` on the PR.
- **Changed test checks:** each task reports every existing assertion it changes in a table with three columns: test (file:line), what it checked, and what it checks now. The PR carries the merged table. A check may change only where this item changes what it checks, and its new form must be at least as strict (owner rule, 2026-10-05).

## Review focus

1. **Hiding the editor while it holds the focus:** the late focusout this fires, two frames later with `relatedTarget` null (Decision 3), must not unpick the block on Save, Cancel or Escape. Tasks 1 and 2a test this: after each, and after two animation frames, the block has focus and keeps `data-picked`.
2. **`wt-combobox`'s own popover inside the editor's auto popover:** opening the role list, and clicking a row in it, must not light-dismiss the editor. Task 2a does this with real `userEvent` clicks.
3. **A `days` refresh while a draft is open:** the same block at the same index keeps the editor and its draft, and a different block there closes both. Task 2a.
4. **A block whose staff role no longer exists:** the role field opens empty, Save stays quiet even after a How many change, and choosing a known role makes Save loud. Task 2a.
5. **An app switch:** a focusout while the document has no focus keeps the pick and the draft. Task 1 tests it with `vi.spyOn(document, "hasFocus").mockReturnValue(false)` and a dispatched `FocusEvent`.

---

### Task 1: Edges only on the picked block; a drag over any other block paints

**Files:**
- Modify `packages/staffing/src/dashboard/staffing-grid.ts`: the `picked` state, `#select`, `#block`, `willUpdate`, `#released`, the focusout handler, `#closeMenu`, and the CSS rule at `:130-135`.
- Test `packages/staffing/src/dashboard/staffing-grid.test.ts`.

**Interfaces:**
- Produces:
  - `@state() private picked: { key: string; index: number; block: StaffingBlock } | null`
  - `#onFocusout(event: FocusEvent): void`, bound on every `button.block` and on `.menu`
  - `#unpick(): void`, which clears `picked` and calls `#closeMenu()`
  - the `#closingOwn` flag
  - the attribute `data-picked` on the picked `button.block`
  - the test helper `async function pickBlock(el, key, index = 0)`: `userEvent.click(block)`, then `userEvent.keyboard("{Escape}")`, then `el.updateComplete`, then `twoFrames()`. It is not named `pick`, because `staffing-special-day-painter.test.ts:86` already has a `pick` helper that means something else.

- [ ] **Step 1: Write the failing tests** in `staffing-grid.test.ts`, next to the resize tests:
  - `"an unpicked block has no edges, and a drag from its top quarter paints a new block"`: `grid({ mon: [headChef] }, { chosen: "sc" })`. Expect `block(el,"mon").querySelector(".edge")` to be null. Press where a person would: the target is `el.shadowRoot!.elementFromPoint(x, top + 2)`, with `x` the block's horizontal middle and `top` the block's top. Today that point hits the start `.edge`; after this task it hits the block button. A bare `drag` dispatches on the column and paints even today, so it would prove nothing. Run `drag(el,"mon",180,300,that)`. Expect the changes to equal `[{ key:"mon", blocks:[headChef, { staffRoleId:"sc", headcount:1, startsAt:"09:00", endsAt:"11:00" }] }]`.
  - `"clicking a block picks it: focused, marked, and only its edges resize it"`: `[headChef, sous]`. `pickBlock(el,"mon",0)`. Expect `el.shadowRoot!.activeElement` to be `block(0)` and `block(0).hasAttribute("data-picked")`. Expect `block(1).querySelector(".edge")` to be null. Drag `edge(el,"mon",0,"end")` from 630 to 720 and expect `{ ...headChef, endsAt:"18:00" }`.
  - `"a picked block stays picked while focus is in its menu, and is unpicked when focus goes anywhere else"`. Use the fixture `grid({ mon: [headChef, sous], tue: [] })`, so a `tue` column exists.
    - `userEvent.click(block(0))`: still `data-picked`.
    - `userEvent.click(column(el,"tue"))` (an empty column): no `[data-picked]`, and the menu is closed.
    - `pickBlock` again, then `userEvent.tab()` onto `block(1)`: no `[data-picked]`.
  - `"a click on a button outside the grid unpicks the block"`: append a plain `<button>` to `host` beside the grid. Run `pickBlock(el,"mon",0)`, then `userEvent.click` that button. No `[data-picked]`, and a drag from where the edge was paints.
  - `"picking a second block unpicks the first"`.
  - `"a resized picked block stays picked once the host echoes it, so a second edge drag resizes again"`: the host echoes the changes through `el.days = new Map([[key, blocks]])`. Drag the end edge, then the start edge, and expect two resize changes.
  - `"the host replacing the picked block, a new target, or turning read-only unpicks it; the same block sent again keeps it"`.
  - `"a focusout while the document has no focus keeps the pick"`: spy `document.hasFocus` to return false, then dispatch `new FocusEvent("focusout", { bubbles:true, composed:true, relatedTarget:null })` on the picked block. It is still `data-picked`.
  - `"Escape and a role chosen in the menu leave the block focused and picked"`. This uses the old menu's role button and asserts after `twoFrames()`. Task 2a rewrites it for Save and Cancel.

- [ ] **Step 2: Change the existing edge tests to pick first.** Add `await pickBlock(el, "mon", i)` before the first edge press in each of these tests (`staffing-grid.test.ts` line):

  | Line | Test |
  |---|---|
  | 387 | dragging a block's bottom edge resizes its end… |
  | 405 | an edge dragged past the other edge… |
  | 412 | the click that ends a resize does not open the block's menu |
  | 438 | the two-case loop: a resize dropped because … |
  | 470 | a dropped resize whose pointer is cancelled… |
  | 800 | a resize whose block the host removes mid-drag… |
  | 848 | a one-step resize moves the edge a quarter hour… |
  | 864 | a press anywhere in an edge strip… |
  | 876 | a second finger during a resize… |
  | 887 | a second finger on a block's edge during an add… |
  | 915 | a resize that leaves the block as it was… |
  | 973 | a 30-minute block keeps both edges and a body to click |
  | 985 | a 15-minute block's edges…; a long block's… |
  | 1000 | an end resize of a block kept on the day's last quarter hour… |
  | 1017 | a press on the end edge of a block that crosses the changeover… |
  | 1031 | a resize whose block the host replaces with another mid-drag… |
  | 1046 | a resize released after the host replaced its block… |

  In 387, pick block 1 before its start-edge drag. In 985, pick `mon` and measure it, then pick `tue` and measure it, because only one block has edges at a time. Every assertion stays as it is: each row in the "Changed test checks" table reads "added a pick before the edge press; assertions unchanged". The one exception is 985, which reads "measures each block after picking it".

- [ ] **Step 3: Run the tests and watch them fail.** Run `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run src/dashboard/staffing-grid.test.ts`. Expected: the new tests fail. The first one fails because its drag resizes `headChef` to start at 11:00 instead of adding a block. The picked-marker tests fail on `data-picked`.
- [ ] **Step 4: Implement Decisions 1–5 in `staffing-grid.ts`.**
  - Render the `.edge` spans and `data-picked` only for the picked block.
  - `#select` sets `picked` after the dragged-click guards and focuses the trigger.
  - `#released` sets `picked.block` to the resized block when it resized the picked block.
  - `willUpdate` unpicks on a `days` mismatch, a new `target` or `readOnly`.
  - Add `button.block[data-picked]` to the outline rule.
  - Update the class comment at `:62-63` in one line.
- [ ] **Step 5: Run the grid test and the a11y test** (`src/dashboard/staffing-grid.a11y.test.ts`). Expected: every case passes. Then run typecheck, lint and prettier.
- [ ] **Step 6: Commit:** `feat(staffing): a drag paints through a block unless it was clicked first (A761)`.

### Task 2a: The wide editor stages role and How many, and keeps them only on Save

**Files:**
- Modify `staffing-grid.ts`: `#menu()`, `#select`, `#onMenuKeydown`, `#changeRole` and `#changeHeadcount` (both replaced by draft setters), `#closeMenu`, the styles, and imports for `wt-combobox`, `wt-form-actions`, `saveActionState` and `submitOnEnter` from `@waitron/ui`.
- Test `staffing-grid.test.ts`.

**Interfaces:**
- Consumes from Task 1: `picked`, `#closingOwn`, `#unpick()`.
- Produces:
  - `@state() private draft: { staffRoleId: string; headcount: number } | null`
  - `#save(): void`, `#cancel(): void`
  - test helpers `roleField(el)`, which returns `menu(el).querySelector("wt-combobox[name=staff-role]")`, and `save(el)`, `cancel(el)` (by `data-test="save-block"` and `data-test="cancel-block"`). Delete keeps its text, so `menuButton(el, "Delete")` still finds it.

- [ ] **Step 1: Write the failing tests:**
  - `"clicking a block opens a wide editor: Staff role and How many on one row, then Cancel and Delete, and Save alone on the right"`:
    - The field's `label` is "Staff role", its `value` is "sc", and its `required` is true.
    - The options equal the three roles in order.
    - The stepper reads 2 (min 1, max 50).
    - At `page.viewport(1280, 900)`: the role field's and the stepper's `top`s are within 1 px of each other, Save's `left` is greater than Delete's `right`, and Cancel comes before Delete.
    - Save has `disabled` and the variant `secondary`, and the focus is on the role field.
    - Cancel's variant is `secondary` and Delete's is `danger`. Both are inside the `[slot="cancel"]` group, Cancel first. Save has no `slot` and is a child of `wt-form-actions`.
  - `"typing in the role field filters the list"`: click the field to open its list, type "dis" into its search box, and expect "Dishwasher" to be the only row shown.
  - `"a changed role or How many makes Save loud; changing it back makes it quiet; nothing is sent before Save"`: use `chooseOption(roleField, "dw")`, then step +1 and −1, and `chooseOption` back to "sc".
  - `"Save sends the role and How many together, closes the editor, and leaves the block focused and picked"` (asserted after `twoFrames()`): the changes equal `[{ key:"mon", blocks:[headChef, { ...sous, staffRoleId:"dw", headcount:3 }] }]`.
  - `"Cancel, Escape and a click outside throw the change away"`, three cases in a loop:
    - Each case changes How many, then closes the editor its own way. A click outside is `userEvent.click(column(el,"tue"))`.
    - No change is sent, and reopening the editor shows the stored values.
    - After Cancel or Escape, and after `twoFrames()`, the block is focused and picked.
  - `"opening the role list and choosing from it with clicks keeps the editor open"`: real `userEvent.click` on the field, then on the row named "Dishwasher" in its shadow root. The editor is still `:popover-open` and Save is loud.
  - `"the editor keeps its draft when the host sends the same block back, and closes when another block takes its place"`.
  - `"clicking the block whose editor is open keeps the draft"`.
  - `"a block whose staff role is gone opens with an empty role; Save stays quiet, even after a How many change, until a known role is chosen"`:
    - Use `{ ...headChef, staffRoleId: "gone" }`. The role field's value is `""` and `required` is true.
    - Step How many by +1: Save is still disabled and `secondary`.
    - `chooseOption(roleField, "dw")`: Save is enabled and `primary`.
  - `"How many in the editor stays within 1 to 50 and puts back the last count for other text"`: the clamp table from today's test at 507 (`0→1`, `51→50`, `2.5→50`, blank restored on focusout, `2→2`), now applied to the draft. Then Save sends only the final count.
  - `"the editor's text is Spanish under the Spanish locale"`: labels "Rol de personal" and "Cuántas personas", and buttons "Cancelar", "Eliminar" and "Guardar".

- [ ] **Step 2: Change the existing tests that pin saving at once:**

  | Line | Test | Today it checks | Now it checks |
  |---|---|---|---|
  | 484 | clicking a block opens its staff roles… | one button per role, the current one disabled; a role click sends at once and closes | the same `role=dialog`, `aria-expanded`, `aria-label` and stepper checks; the role combobox's value and options; a role change sends nothing until Save, then sends once and refocuses the block |
  | 507 | How many changes the block's headcount… | each step sends a change and the menu stays open | each step changes the draft; nothing is sent; Save sends the clamped count (the clamp table is kept in the new test above) |
  | 958 | the open menu stays open when its own headcount change comes back | a sent headcount echoed by the host keeps the menu open | renamed "…when the host sends its block back unchanged": the editor and its draft stay |
  | Task 1's "Escape and a role chosen…" | — | role button | Escape, Cancel and Save each leave the block focused and picked |

- [ ] **Step 3: Run the tests and watch them fail**, with the same command as Task 1. The new tests fail on the missing `wt-combobox[name=staff-role]`.
- [ ] **Step 4: Implement Decisions 7, 11, 13 and 14.** Decision 6 belongs to Task 2b, where its tests are. Two details:
  - The `toggle` closed handler clears both `selected` and `draft`.
  - The stepper keeps `showHeadcount` on its correction paths (`headcount-control.ts`).
- [ ] **Step 5: Run the grid test and the a11y test.** Expected: every case passes. Then run typecheck, lint and prettier.
- [ ] **Step 6: Commit:** `feat(staffing): the block editor is wide and keeps its change only on Save (A761)`.

### Task 2b: The editor's keyboard, focus leaving, edge press and placement

**Files:**
- Modify `staffing-grid.ts`: `#onMenuKeydown`, `#onFocusout`, `willUpdate` (the check that a stroke has stretched, for Decision 6) and `#select`'s `placePopover` call.
- Modify `staffing-grid.test.ts` and `staffing-grid.a11y.test.ts`.

**Interfaces:**
- Consumes from Task 2a: `draft`, `#save`, `#cancel`.
- Produces nothing new.

- [ ] **Step 1: Write the failing tests:**
  - `"Delete or Backspace in the editor deletes the block from its buttons but not from the role field or How many"`: focus the role field, How many's input, and the role search box with its list open, and press Backspace in each: nothing is sent. Focus Cancel and press Delete: the block is deleted. This replaces today's 554 (see the table below).
  - `"Escape with the role list open closes only the list; a second Escape closes the editor"`.
  - `"Enter in How many saves"`.
  - `"Tab out of the editor's last button closes it without sending and unpicks the block"`.
  - `"an edge drag of the picked block with its editor open closes the editor when it first stretches, drops the draft, and resizes"`: change How many, then press the end edge and move. After the first `pointermove` and `updateComplete`, the editor is closed. On release, the one change sent is the resize, with the stored headcount.
  - `"a press and release on the picked block's edge with no movement keeps the editor and its draft"`.
  - `"a paint drag from the picked block's body with its editor open closes the editor, drops the draft, and adds a block"`.
  - `"at 390×844 the editor fits inside the window, and sits above a block low in the view when there is room"`:
    - Use a block from 22:00 to 00:00, so it is low in the column, and open its editor.
    - Expect the editor's box to be within `[0, innerWidth]`.
    - First assert the precondition, so the check cannot pass empty: the block's top minus the editor's height is at least 8 (`POPOVER_MARGIN`).
    - Then assert that the editor's bottom is at or above the block's top, within 0.5 px.
    - Control: run it once with `flipAbove` left out of the `placePopover` call and see it fail, then put it back.

- [ ] **Step 2: Change these existing tests:**

  | Line | Test | Today it checks | Now it checks |
  |---|---|---|---|
  | 554 | Delete or Backspace inside an open menu deletes, but not while typing in How many | Backspace in How many's input is ignored, and Delete on a role button deletes | Backspace in either field, including the search box, is ignored, and Delete on Cancel deletes. Stricter: one more field is checked |
  | `staffing-grid.a11y.test.ts:93-98`, `"menu"` state | the menu is open and holds a stepper | the editor is open and holds `wt-combobox[name=staff-role]`, the stepper and `wt-form-actions`. A new `"menu-roles-open"` state runs axe with the role list open, in both themes |

- [ ] **Step 3: Run the tests and watch them fail.** Then implement Decisions 4, 6, 9, 10 and 12, and run the tests again until they pass.
- [ ] **Step 4: Run typecheck, lint and prettier, then commit:** `feat(staffing): the block editor's keys, focus and placement (A761)`.

### Task 3: The painters host the new editor

No product code is expected. If a case fails, the fix goes in `staffing-grid.ts`.

**Files:**
- Test `packages/staffing/src/dashboard/staffing-season-painter.unsaved.test.ts`.
- Test `packages/staffing/src/dashboard/staffing-special-day-painter.test.ts`.

A grep for block-menu or edge use in all six painter test files (`*.test.ts`, `*.a11y.test.ts`, `*.unsaved.test.ts`) found none. Their only How many is the paint row's stepper, so no existing painter check changes.

- [ ] **Step 1: Write the tests.** All three open the editor on the fixture's `headChef` block in the painter's grid.
  - Season, unsaved: `"a block editor's unsaved change asks nothing: Save stays quiet, the page has no leave warning, and Cancel closes the painter at once"`:
    - Open the editor and change How many.
    - Expect `frameButton(painter,"save").disabled` to be true and `unload()` to be false.
    - Assert the editor is still `:popover-open`. Then call `frameButton(painter,"cancel").click()`, a DOM `.click()`, as this file already does. A `userEvent.click` would move the focus first and close the editor, so the test could not tell whether the painter closed with the editor's change still open.
    - The painter closes with no `wt-unsaved-changes` open, and `app.open` is called once.
  - Season, unsaved: `"the block editor's Save becomes a painter edit that asks before leaving"`. After the editor's Save, the frame's Save is `primary` and `unload()` is true.
  - Special day: `"the block editor's Save reaches the special day's draft"`. The grid's `days` holds the new headcount, and the frame's Save is enabled.
- [ ] **Step 2: Run** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run src/dashboard/staffing-season-painter.unsaved.test.ts src/dashboard/staffing-special-day-painter.test.ts`. Expected: they pass. If one fails, fix the grid and keep the test.
- [ ] **Step 3: Run the whole browser project once:** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run --project browser`. Expected: no failures.
- [ ] **Step 4: Commit:** `test(staffing): the painters host the block editor (A761)`.

### Task 4: LOOK (done by the driver, not an implementer)

- [ ] Check `wa-wt ls` and `memory_pressure | grep free`. Then run `wa-wt demo waitron-feat-a761-staffing-grid-paint-and-editor`, and record its process group in the item ledger so you stop only what you started.
- [ ] In the dashboard, open Calendar → Staffing, then a season's standard week. Use a department whose day has at least two overlapping blocks; add staff roles in the demo venue if it needs them.
- [ ] Take screenshots with the workspace's Playwright Chromium. Keep the script in `~/waitron-campaign-b/a761-look-dir/` and save the screenshots to `~/waitron-campaign-b/a761-shots/`. Cover light and dark, 1280×900 and 390×844, and English, plus Spanish at 1280 light, in these states:
  - a picked block (outline) beside an unpicked one
  - the editor unchanged (Save quiet)
  - the editor changed (Save loud)
  - the role list open
  - a block low in the day at 390, so the editor has to sit above it
- [ ] Check by looking, and write down for each:
  - The fields share a row at 1280 and wrap cleanly at 390.
  - The bottom row reads `[Cancel] [Delete] … [Save]`.
  - Nothing is clipped.
  - **A707:** at 390, does the editor cover the block it belongs to, for a block near the top, the middle and the bottom of the day? Write the finding into the ledger.
- [ ] Stop the stack with `wa-wt down <name>`.

### Task 5: Docs (the driver)

**Files:**
- `docs/backlog.md`
- `docs/backlog/workforce.md`
- `docs/developers/design-system.md`

- [ ] Delete the A761 entry in `docs/backlog.md` (lines 4225-4229) and the `## A761.` section in `docs/backlog/workforce.md` (lines 137-166, up to `## A763`). Check with `/usr/bin/grep -rn "A761\|a761" docs/backlog.md docs/backlog/`, which should print nothing. `design-system.md` keeps its new A761 bullet.
- [ ] Edit A707's entry only if Task 4 found something new. For example, if `flipAbove` keeps the staffing editor off its block where the space allows, say so and note that Opening hours' block menu and the chooser are what remains.
- [ ] Update `design-system.md` in three places:
  - **The staffing painter paragraph** (around line 2220). Replace "dragging a block's top or bottom edge resizes it, and clicking a block offers another staff role, How many and Delete" with text saying:
    - a drag over a block that was not clicked paints a new block;
    - a click picks the block and opens its editor;
    - the editor has Staff role and How many on one row and `[Cancel] [Delete] … [Save]` below;
    - only the picked block's edges resize it;
    - the block stays picked until the focus leaves it and its editor;
    - the editor keeps a change only on Save, and Cancel, Escape, a click outside or focus leaving throw it away.
  - **The A331 list** (around line 2381). Add an A761 bullet: the block editor writes its own comparison (`sameBlock` of the draft against the opened block) and takes no draft scope, because the owner wants a click outside to discard it, and a registered scope would make leaving the painter ask about it.
  - **Line 2242:** change "one stated exception, the till's profile dialog" so it names both.
- [ ] Run `pnpm exec prettier --file-info docs/developers/design-system.md`. `docs/` is ignored as a whole, so the check prints `"ignored": true`.
- [ ] Commit: `docs: A761 done — the staffing grid's picked block and wide editor`.

### After the tasks

The driver runs `/finish-branch` with the worktree path. This is the light path: the diff touches no risk trigger, so there are no per-task reviewers, but the Codex run-it seat still runs. The PR's opening lines say that a changed, unsaved block editor is thrown away without warning when the tab is closed or reloaded, or on Back (Decision 8). The body carries:
- the merged "Changed test checks" table;
- Decision 8 with its reason;
- the untested Safari and WebKit assumption;
- the A707 finding.
