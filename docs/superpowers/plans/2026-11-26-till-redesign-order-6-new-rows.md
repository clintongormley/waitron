# Till redesign, order screen PR 6: compact rows for new dishes

Lane N, item TILL-REDESIGN-ORDER, PR 6 of the [split](2026-11-26-till-handheld-redesign-pass-1.md)
(“Read compact rows, see matching repeat picks group and the last dish light up”). Design:
[§4 The order screen](../specs/2026-11-26-till-handheld-redesign-design.md#4-the-order-screen).
Status: PLAN FOR APPROVAL.

## What staff can do when it lands

On a table's order, each dish not yet sent reads as one short row, as on a printed ticket: the
quantity, the name, its options and extras on a quiet second line, and the row's price on the right.
Tapping the same dish again adds to its row. The dish added last is tinted, so the waiter sees what
the last tap did. Tapping a row opens today's dish details, where quantity, options, note and now
**Remove** live until PR 7 opens rows in place.

## The frames it builds to

- Picture `d` frame 1: rows under the course heading. Bold quantity first, name, quiet second line
  (“Medium”), price at the right edge, no buttons on the row, the last-added row (Croquettes) tinted.
- Picture `af` frame 1: the same rows under fire-group headings (“Starters”, “Mains”). Its grips
  arrive in PR 9c. Its headings stay as they are today until 9c and 9d restyle them.
- Picture `g` frame 1: a row of several of one dish keeps a control at its right edge. Until PR 7
  makes it the unfold arrow, it is today's split control (`›`, `data-split-draft-line`), unchanged.
  The header that folds a split dish back together (`data-fold-draft-family`) also stays.

## The change

1. **A new file draws the row.** `apps/till/src/widgets/draft-row.ts` exports the compact row's
   template and styles. `widgets/basket.ts` is at 1,467 of its 1,500-line cap, so it gains only a
   `compactRows` property and one branch in its line loop that calls the new file. Only
   `#draftSections` in `screens/till-table-order-screen.ts` sets `compactRows`. The counter screen
   (which also uses details mode) and the sent rows keep today's rows. The order screen (7,381 of
   7,500) must not grow: if it would, `#draftLine`'s markup moves into the new file.
2. **Row layout, with no button inside a button.** The row is three cells: the selection box (the
   `lead` slot), one native `<button>` holding quantity, name, second line and price, and the split
   chevron (the `end` slot). The selection box is today's `data-draft-select` control, shrunk to the
   box, so selecting and the tests that select keep working. The row button carries `data-line-detail`
   (the ⓘ's marker today) and a new `data-draft-row`. With those, three things keep finding the row:
   the scroll to the last-added dish (`basket.ts:841`), the long-press opening of details
   (`#openHeldDraftLine`, screen `:2209`), and the test helper `openDraftLine`.
3. **Row content.** Quantity: today's `quantityLabel` (a weighed dish reads “250 ml”). Second line:
   the extras (with a pick count above one), the option answers, and the note, joined with “ · ”.
   An extra keeps its own allergen and diet icons beside its name (today's `extraNutrition`, drawn
   on a sub-row). An extra the menu no longer offers keeps its marker. The dish's nutrition icons,
   its allergy mark, and its not-offered, blocked, server-unavailable and period-ended marks stay on
   the row (allergy safety). The routing and flag warnings stay under it.
4. **The price is the one the total adds.** `panelTotal` (`state/draft-layout.ts:182`) prices a
   set-menu dish at its set-menu share and every other line at `lineGross`. Its per-line rule moves
   into an exported function that both the total and the row call, so the two cannot drift.
5. **The last dish lights up.** The row whose line is `store.lastAdded` (`state/working-order.ts:412`)
   carries `data-last-added` and the `--wt-color-surface-lifted` background, the light teal of frame
   `d` (`#d2effb` light, `#1e3d46` dark, `packages/ui-core/src/tokens/colors.css`).
6. **Repeat picks group.** The table draft already adds a repeat to the first matching row
   (`addMerging`, `state/working-order.ts:555`, via `draft-sync.ts:53`). The merge key keeps
   repeats in one fire group, and never merges set-menu or weighed dishes
   (`packages/shared/src/draft-merge.ts`). This PR pins that at the row. The counter still adds a
   line per tap until PR 9b moves the counter onto this ticket.
7. **One tap opens the dish.** The row button calls `openLineDetails`. It replaces the ⓘ, the
   double-click and the row's − and + controls. The details panel already edits quantity
   (`modifier-picker.ts`, `lineDetails` mode). The button is disabled exactly when the ⓘ is today:
   while sending, while edits are locked, or while an order is in flight. Press-and-drag also starts
   from the row button: `#pressDraft` and `#draftClick` treat `data-draft-row` as they treat
   `data-draft-select`, so a drag never also opens the panel. A long press that does not move still
   opens the details, as it does today, until PR 9d makes holding select.
8. **Remove moves into the panel.** In `compactRows` mode only, the panel shows **Remove** at its
   foot in danger styling, as in picture `g` frame 3. It sits in a new slot of the picker, because
   the existing `line-details` slot is at the top. It has the same guards as today's × (`#lineReadOnly`,
   in flight): it removes the line at once and closes the panel.

## What the frame drops that stays for now, and why

Each stays only until its replacement lands, so no existing action is lost in between:

- **A small selection box at the row's left edge.** **Fire** and **Move to…** in the draft bar act
  on the selection. PR 9d replaces the box with hold-to-select and the selection foot.
- **Today’s draft bar** (**Move to…**, **Fire**, **Send all**) stays until PR 9a's foot.
- **Today's fire-group headings and their menu** stay until PRs 9c and 9d.

## Tests, failing first

- New `apps/till/src/widgets/draft-row.test.ts` (browser), covering four things.
  1. Row text for a plain dish, a dish with an option, an extra and a note, a weighed dish, and a
     set-menu dish.
  2. A burger whose cheese extra adds milk shows milk beside the cheese. An extra no longer offered
     shows its marker.
  3. The rows' prices plus the sent total equal the order total, with one each of: an extra, an
     extra no longer offered, a set-menu dish and a weighed dish.
  4. The tint moves to the newly added row, and leaves a row once it is no longer the last added.
- New `draft-row.a11y.test.ts`: axe on a plain row, a last-added row, a row with warnings and a
  disabled row, in light and dark. Each row has one button, named by its quantity, name and price.
- In `till-table-order-screen.new-order.test.ts`:
  - two taps on one dish give one row reading 2 (a pinning check; it passes today);
  - a tap on a row opens the details panel;
  - **Remove** there removes the line and closes the panel;
  - the row and Remove do nothing while sending;
  - a press-and-drag on a row moves it without opening the panel;
  - a long press still opens the details;
  - the last-added row is scrolled into view.
- Existing checks that use the row stepper or the row's ×, or that select a line by tapping its
  name, are rewritten to the new route. Each is listed in the PR's “Changed test checks” section with
  its `file:line`, its old check and its new one. Counter and sent-row checks stay as they are.

## Docs

The English and Spanish `table-service.md` guides change in two sections. `{#portions}` says a
tap opens a dish's details, where Remove is. `{#phone-order}` says pressing a row starts the drag
(“press its name” becomes “press its row”). `docs/developers/design-system.md` describes the order
row.

## Size, review and pictures

About three to four hours: 130–180 lines of code and copy, and 200–280 lines of tests including the
rewritten checks. No risk trigger on the list is touched: no money calculation changes (the row
calls the total's own per-line rule), no fiscal path, permission or database. So no per-task
reviewer. `finish-branch`'s wave runs the Codex run-it seat twice, as the split asks for named
risks. The two named risks are allergen display on the compact row, and touch gestures (tap, drag,
long press) on one row. Pictures go
to the watcher beside frames `d` 1 and `af` 1, with the differences listed:

- phone 390 px and till 1280 px;
- portrait and landscape;
- light and dark;
- English and Spanish.

It lands after the owner's recorded OK and green CI on the current head.
