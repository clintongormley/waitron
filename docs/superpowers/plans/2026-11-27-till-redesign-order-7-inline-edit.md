# Till redesign, order screen PR 7: open a new row in place, and unfold portions

Lane N, item TILL-REDESIGN-ORDER, PR 7 of the [split](2026-11-26-till-handheld-redesign-pass-1.md)
(“Unfold portions and edit quantity, options and note inline. Keep existing actions while their new
foot is built.”). Design: [§4 The order screen](../specs/2026-11-26-till-handheld-redesign-design.md#4-the-order-screen),
§14.2 “Stepper”, §14.4 “Rows”, “Unfolded rows” and “An opened row”. It builds on PR 6 (#4459,
branch `feat/n-till-order-6-rows`, not yet landed): branch from it, and rebase onto `main` once it
lands. Line numbers below are PR 6's head (`b51313a980`). Status: written 2026-11-27 for the
watcher's read. It lands as two pull requests, **7a** then **7b**, each about three hours (see Size).

## What staff can do when it lands

**7a.** Tapping a new dish's row opens it in place: a box with a teal edge holds the row and, under
it, − count +, **Options** and **Note**. − and + change how many at once. **Options** opens today's
dish details (options, variant, course, amount, note). **Note** opens the same details with the note
field open and ready to type. Tapping the row again closes it; opening another row closes the first.
Holding a row still opens today's details, until PR 9d makes holding select.

**7b.** The arrow on a row of several unfolds it into rows of one, indented under a row that keeps
the dish's count, total and an up arrow; tapping that arrow folds them. Portions still alike fold
into one row again, as today. If one was made differently, the folded row still reads as one dish:
“3 Burger” over “2 Chips · 1 Salad”, at the three portions' price. Ticking it ticks all three, so
Remove, Move to… and Fire act on all three, and dragging it moves all three.

## The frames it builds to

- **Stepper** (§14.2), drawn in `g` 3 and measured from `base.css`'s `.stepper`, which `d` 2, `f` 1
  and `h` 3 share: one outlined box 44 tall outside its 1px border, radius 8; inside it − and +
  cells 44 wide and 42 tall (`base.css:64–65`), the number 16, weight 600, in a 32-wide cell between
  them; + in teal. Built as `--wt-font-size-lg`, which is 18 (§14's 16–18 rule): a listed difference,
  as in PR 6.
- **Opened row**: `g` 3 (`.open`, `.acts`): a 2px teal border, radius 8, margin 4 and 8, on the
  surface colour; the row inside it has no line under it; the controls are outlined, 44 tall, 15
  bold, padded 0 12, 8 apart, and wrap. Remove and “Split into 3” in `f` 2, `f` 3 and `g` 3 are not
  built (§14.1).
- **Folded row** with the arrow: `g` 1 and `af` 1, as PR 6 built it. **Folded, made differently**:
  `af` 1's Burger row (“3 Burger”, “2 Chips · 1 Salad”, €43.50) and §4's text.
- **Unfolded**: `g` 2's group row, its arrow turned up and teal (`.chev.on`). The portions are drawn
  as `af` 3's `.r.sub`: indented 22, on the page background. §14.4's text (“indented under their
  row, on the page background”) wins over `g` 2's white `.kid`, which is indented 30. Built as
  `--wt-space-5` (24): a listed difference against both. A portion carries no stepper (item 9).

## The change

**7a. Open a row in place**

1. **`wt-stepper`, a new primitive in `packages/ui`**, built first (§14.2; lane N builds the stepper,
   queue rule C). `wt-number-stepper` does not fit: it is a form field you type into, with a
   floating label and 24px buttons by the owner's A263 decision (design-system.md, its table row);
   the frame's stepper is a count with 44-wide buttons and nothing to type. Properties: `value` (a
   whole number), `min` (default 0), `max` (optional), `label`, `disabled`, and `decreaseLabel` and
   `increaseLabel` as on `wt-number-stepper`. Drawn: `--wt-tap-min` tall outside its border, 1px
   `--wt-color-border`, `--wt-radius-md`, `--wt-color-surface`; − and + `--wt-tap-min` square, `wt-icon` `minus` in
   `--wt-color-text` and `plus` in `--wt-color-primary`; the number at least `--wt-space-6` wide,
   `--wt-font-size-lg`, `--wt-font-weight-bold`, tabular figures. − is disabled at `min` and + at
   `max`; a disabled button fades its icon through `--wt-opacity-disabled`. A group named by
   `label`, with the count in a polite live region. Each step sends `wt-change` with
   `detail: { value }`, `bubbles` and `composed`, and stops the inner click. The till already
   registers `minus` and `plus` (`till-app.ts:714`). Last added (N 10), the options foot (N 11) and
   Move dishes (D 14c) reuse it.
2. **A new file draws the opened row's controls**: `apps/till/src/widgets/draft-row-open.ts`, with
   its styles. `draft-row.ts` gains `opened` on `DraftRowView`: the entry carries `data-open` and the
   box, the row button `aria-expanded`, and an `opened-<n>` slot under the row. While open, the box
   is on the surface colour, as `g` 3; the last-added tint comes back when it closes. In `basket.ts`
   (1,453 of its 1,500-line cap), the compact row's tap sends a `draft-row-tap` event naming the
   line in place of opening details (`basket.ts:887`), and the basket passes `opened`.
3. **The screen holds which row is open**, one at a time. The row closes when its line leaves the
   order, the order is swapped (another bill, a re-read), while sending, while edits are locked, or
   while an order is in flight. The order screen (7,396 of its 7,500 cap) must not grow: 7a also
   creates `apps/till/src/widgets/draft-portions.ts` and moves `#draftLine`'s split arrow, its
   family header (`:4698`) and `#splitDraftLine` and `#foldDraftFamily` (`:4810–4845`) there,
   unchanged, once. 7b then changes them in that file. N 8 (sent rows) reuses it for their arrow.
   `basket.ts` grows by at most 10 lines in 7a.
4. **The stepper acts at once**, as today's row stepper did (`basket.ts:1206–1236`):
   `store.setLineQuantity(index, String(value))`. − stops at 1, because Remove in the draft bar takes
   a dish off. + is disabled when `store.canSelectProduct?.(line.product)` is false, and also on a
   line holding a pick the menu no longer offers. `setLineQuantity` refuses that step by sending a
   `"refused"` event (`working-order.ts:678`), and only the counter's store is listened to
   (`till-app.ts:3183`), so on a table today's + would do nothing and say nothing. There is no draft
   scope and no Save: the step reaches the server with the draft, like any other change to it, and
   design-system.md (“Protect an edited dialog before closing it”) says “automatically saved forms
   need no draft scope”. The row's price stays `draftLinePrice` and the total `lineGross`; neither
   changes. (`setLineQuantity`'s simplified-invoice limit applies only to the counter's store, the one
   `till-app.ts:11718` gives a limit; a table's draft has none set, today as after this change.)
5. **Weighed and set-menu dishes get no stepper**, only Options and Note.
   - A weighed dish's amount (“250 ml”) is typed in today's details, as now: today's row gave a
     stepper only to a dish sold by the unit (`basket.ts:1195`).
   - A set-menu dish's count is changed in today's details, as now: today's row draws no stepper on
     a set-menu line (`basket.ts:1189`). Also, `setLineQuantity` checks a larger count against the
     dish without its set menu (`working-order.ts:674`), where `setLineDetails` passes the line's
     own set menu (`:626`). Read in the code, not run.
6. **Options** calls `basket.openLineDetails(line)`. **Note** calls it with `{ note: true }`, and the
   picker gains `focusNote`, which opens and focuses its note field through the existing Add note
   path (`modifier-picker.ts:1056`). Both are disabled exactly when the row button is.
7. **Holding** a row calls `openLineDetails` directly from `#openHeldDraftLine` (screen `:2189`),
   which today clicks the row, since a click now opens it in place. A drag still never opens it.

**7b. Unfold portions**

8. **The store keeps a split family whose portions differ.** A new `portionsOf(line)` gives the
   family's members still in the order (two or more), whatever their options. `splitFamily` keeps
   its meaning, all alike, and folding those still merges them (`foldSplitFamily`, unchanged).
   Families stay in memory, as today: they are kept by line object (`#splitFamilies`, a `WeakMap`,
   `working-order.ts:271`), and a re-read of the draft builds new line objects, so its portions then
   show as rows of one. Read in the code, not run.
9. **`draft-portions.ts`** (made in 7a, item 3) gains the group row, the summary and the fold of
   portions that differ. `basket.ts` must not grow in 7b: the compact row's view assembly
   (`basket.ts:873–889`, the `draftRow({...})` call) moves into `draft-row.ts` as one function that
   also takes the folded family's count, summary and price, so the basket keeps one call.
   - **Unfolded**: the group row goes in `before-<first>`, in place of today's `data-fold-draft-family`
     header: count, name, summary, the portions' price, and the `chevron-down` turned up, in
     `--wt-color-primary`, with `aria-expanded="true"`. It has no box until PR 9d. Each portion is a
     row of one with `portion` set: indented `--wt-space-5`, `--wt-color-bg`, no arrow, and, opened,
     no stepper: + would make it a row of two, and the summary counts rows. `g` 3 draws “− 1 +” on
     a portion; a listed difference. Options and Note stay.
   - **Fold**: if the portions are alike, `foldSplitFamily`, as today. If not, the screen marks the
     family folded. The basket then draws the first portion's row with the family's count, summary
     and price, and the screen leaves the other portions out of that basket's `lineIndexes`.
   - **Never hidden behind a fold**: each portion's allergy mark, flag choice and routing warning
     are drawn on its own row (screen `:4683–4690`, `:4754–4755`), and so are its not-offered,
     blocked, period-ended and server marks (`lineMarks`, `draft-row.ts`). So portions that differ
     fold into one row only while none of them carries any of these and none is the last added
     dish (whose reveal and `#openLastAdded` look for its row). Otherwise the arrow is not offered
     and the portions stay unfolded; one that gains a mark while folded unfolds the family. The
     summary keeps each extra's own allergen and diet icons, drawn by the same code as the row's
     second line.
   - **Who reads `lineIndexes`** (the basket's property), each checked against a hidden portion:
     `basket.ts:438` (declared) and `:857` (the rows it draws); the screen's `:4650` (sets it per
     section), `:2194` (`#openHeldDraftLine` finds a row's basket) and `:4272` (`#openLastAdded`);
     and the test helper `till-table-order-screen.test-helpers.ts:195` (`openDraftLine`). The
     `lineIndexes` of a sent group (screen `:4949`, `state/draft-groups.ts:11`, `till-app.ts:15368`)
     is another field of the same name, not affected.
   - **The summary** lists each different second line with how many portions carry it, in order of
     first appearance (“2 Chips · 1 Salad”). Portions with nothing on their second line are not
     listed, since the row's count covers them.
   - **The price** is the sum of the portions' `draftLinePrice`, the figures the total already adds.
   - **A folded row made differently**: a tap or the arrow unfolds it. Its box ticks or unticks every
     portion, and shows ticked when all are. Press-and-drag carries every portion (`#pressDraft`'s
     `chosen`).
   - The group row and fold are drawn only while every portion sits in one fire group and course;
     otherwise each portion is a row of its own where it sits.

## What stays for now, and why

- **Today's details**, through Options, Note and holding. They alone hold the variant, the course,
  the flag and routing choices (`detail-<n>`) and a weighed dish's amount, until PR 11's options
  panel. PR 9d makes holding select.
- **Today's draft bar** (Move to…, Remove, Fire, Send all) until PR 9a, and the selection box until
  PRs 9c and 9d.
- A family re-read from the server shows as rows of one (item 8). Keeping it would need a field on
  the server's draft.

## Tests, failing first

**7a**
- New `wt-stepper.test.ts`: steps and their `wt-change`; − at `min` and + at `max` disabled;
  `disabled` locks both; the inner click does not reach the host; the token painting (height, border,
  radius, `plus` in primary, `minus` in text).
- New `wt-stepper.a11y.test.ts`: axe on a plain stepper, at `min`, at `max` and disabled, in light and
  dark; the group and both buttons are named.
- New `till-table-order-screen.open-row.test.ts`: a tap opens the row with a stepper, Options, Note
  and `aria-expanded`, a second tap closes it, opening another closes the first; + and − change the
  line, its row's price and the total, and leave the draft unsaved (`store.dirty`); − is disabled at
  1 and + when the dish cannot be added or holds a pick no longer offered; a weighed and a set-menu
  dish have no stepper; Options opens
  the details, Note opens them with focus in the note field; the row closes and its controls are
  disabled while sending or locked; holding opens the details; a drag opens nothing.
- `draft-row.a11y.test.ts` gains an opened row in light and dark. The picker's test gains
  `focusNote`.
- The `openDraftLine` test helper (56 uses) taps the row and then Options, and returns the picker as
  now. Checks that expect a tap to open the details are rewritten; the PR's “Changed test checks”
  section lists each with its `file:line`, old check and new one.

**7b**
- `working-order.test.ts`: `portionsOf` keeps a family after `setLineModifiers` changes one portion;
  drops a removed portion; gives nothing under two; `splitFamily` is then still `undefined`.
- The summary, once: “2 Chips · 1 Salad”; a portion with an empty second line is not listed.
- `till-table-order-screen.split-units.test.ts`: unfolding draws the group row (arrow up,
  `aria-expanded`) and indented portions on the page background; alike portions fold into one line
  (the existing check stays); different ones fold into “3 Burger”, “2 Chips · 1 Salad” at the summed
  price, and a tap unfolds them; ticking it ticks all three, Remove removes all three and a drag
  moves all three; with a portion in another fire group there is no group row; a re-read draft shows
  rows of one; an opened portion has no stepper.
- Safety, in the same file: portions where one carries an allergy mark, a flag, a routing warning
  or a not-offered mark offer no fold and show each mark on its own row; a folded family unfolds
  when one of its portions gains a mark; a folded row with a Salad extra shows the extra's allergen
  icons.
- `till-table-order-screen.split-units.a11y.test.ts`: the group row folded and unfolded, and a
  portion, in light and dark.

## Docs

The English and Spanish `table-service.md` change in `{#portions}`'s last two paragraphs. 7a: a tap
opens a dish in place, where − and + change how many, Options its options and Note its note, and
holding opens all its details. 7b: the arrow on a row of several gives one row per dish, the arrow
again folds them, and a folded row of different dishes says how many of each. 7a also changes
`{#portions}`'s weighed-dish paragraph (English `:522–523`, Spanish `:551`), which says to tap a
weighed dish's row at a table to edit it: a tap now opens it, and Options edits the amount.
`docs/developers/design-system.md` gains `wt-stepper`'s row in the primitives table, and its order
row paragraph gains the opened row and the portions.

## Size, review and pictures

7a: 160–220 lines of code and copy, and 250–320 of tests including the rewritten checks. 7b: 110–150
and 180–240. Together that is well over one three-hour PR, hence two. No risk trigger is touched:
no money rule changes (item 4), and no fiscal path, permission or database. So no per-task reviewer;
`finish-branch`'s Codex run-it seat runs twice on each PR's named risks. 7a: gestures on one row (a
tap opens it, holding opens details, a drag does neither), and a step pressed while the draft is
saving or sending. 7b: ticking, Remove, Move to…, Fire and a drag on a folded row made differently
act on exactly its portions.

Pictures go to the watcher beside `g` 3 (7a), and beside `g` 1, `g` 2, `af` 1 and `af` 3 (7b), with
the differences listed against each frame and against §14.2 and §14.4's sizes: phone 390 px and
till 1280 px, portrait and landscape, light and dark, English and Spanish, and the order panel at
800 × 1280, where PR 6's names wrapped (the opened row's controls must wrap inside the box).

Then lane P's Impeccable finish review, which the watcher asks for, must say “ready for the owner”
before the owner sees the PR (queue rule B). Each lands after the owner's recorded OK and green CI
on the current head.

## Questions for the watcher

1. Two PRs, 7a then 7b, rather than one, to keep to about three hours each?
2. The spec does not say what the opened row's **Note** does. The plan opens today's details with
   the note field focused, so there is one note editor until PR 11's options panel replaces it,
   rather than a note field inside the box.
3. The spec does not say what a tap on a folded row of different portions does. The plan unfolds
   it, since one stepper cannot change three different dishes.
