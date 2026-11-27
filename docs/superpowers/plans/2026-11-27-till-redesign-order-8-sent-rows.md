# Till redesign, order screen PR 8: sent rows, serving in place

Lane N, item TILL-REDESIGN-ORDER, PR 8 of the [split](2026-11-26-till-handheld-redesign-pass-1.md)
(“Unfold sent portions and Serve 1 or Serve all in one tap (A773). Keep Fire, Undo and the existing
checks. Fix “Sent !”, empty “Held ·” and the “at the pass” heading (A1108).”). Design:
[§4 The order screen](../specs/2026-11-26-till-handheld-redesign-design.md#4-the-order-screen),
§14.2 “Course heading”, §14.4 “Rows”, “Unfolded rows” and “An opened row”. Backlog: A1108
(`docs/backlog/till.md`, “The till order screen's Sent panel reads…”), the “at the pass” entry
beside it, and the bundle's “Serving part of a row (A773's physical trial)”. Line numbers are PR 6's
head (`941646a6db`, branch `feat/n-till-order-6-rows`, #4459, not landed) unless a line says 7a.
Status: written 2026-11-27 for the watcher's read. It lands as two pull requests, **8a** then
**8b**, each about three hours (see Size).

## What staff can do when it lands

**8a.** Dishes already sent sit at the top of the order as quiet rows, as on a printed ticket, under
a heading for each fire group named after its course: “Drinks · fired 12 min ago” with a green
“✓ Sent” mark, or a held group with its **Fire** button. There is no Sent box to open any more,
and its “Sent !”, empty “Held ·” and “at the pass under Fired” go with it. A row still says when it
is ready, waiting at the pass, served, or cancelled but charged. Tapping a row still serves it.

**8b.** Tapping a sent row opens it in place: “0 of 2 served”, then **Serve 1** and **Serve 2**, and
**Dish details** for everything else until PR 9d. A row of several identical dishes carries the
arrow; it unfolds them into rows of one, each opened and served on its own. **Undo** on the Served
message still takes a serve back.

## The frames it builds to

Measured in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.

- **Course heading**, `af` 1 (`.ch`) and §14.2: small capitals, 13 bold, letter-spaced 0.03em,
  muted, padded 12 / 16 / 6, on the page background, the mark at the right. The “✓ Sent” mark,
  `af` 1 and `d` 1 (`.pill.ok` in `base.css`): fully rounded, `check` before the word. §14.2 makes
  it 13 (`--wt-font-size-sm`); drawn padding 2–3 by 8–10 is built `--wt-space-1` by
  `--wt-space-2`. “Today's quiet green” is `--wt-color-tab-ready-tint`, the ready tab's green
  (`design-system.md`, its token table), text `--wt-color-text`, the tick `--wt-color-success`:
  a listed difference from the drawn `#d7efe4` / `#12573e`.
- **Sent rows**, `af` 1 (`.r.sent`), `d` 1 and `g` 1, and §14.4: the page background, muted text,
  quantity and name regular weight, price 15 at the right, a line under each, no grip; the grip's
  column stays empty, so quantities line up with the new rows under them. Row height 52, as PR 6's
  rows. The till's column: `m` and `s` (the same rows).
- **The arrow on a sent row** (8b), `g` 1 and 2 (`.chev`, 44 square, muted; unfolded, teal).
  **Unfolded rows**, `af` 3 (`.r.sub`) and §14.4: indented, on the page background, built
  `--wt-space-5` as PR 7b's.
- **An opened sent row** (8b), `e` 3, the only drawing of one: the box of `g` 3 (2px teal border,
  radius 8, margin 4 / 8, surface colour), the row's text in full colour while open, then one line
  with “0 of 2 served” (14, muted) at the left and **Serve 1**, **Serve 2** (outlined, 44 tall, 15
  bold) at the right. `e` 3's **Comp…**, **Move to station…** and **Void…** are not built: pass 2
  moved them to the selection foot (§4), and **Dish details** reaches them until then.

## The change

**8a. Sent rows by fire group**

1. **`wt-course-heading`, a new primitive in `packages/ui`** (§14.2; queue rule C names lane N for
   course pills), built first. Properties: `label`, `mark` (`""`, `sent`, `now`, `later`), `level`
   (default 3); an `end` slot for an action. `sent` draws “✓” and its text as above, `now` teal
   (`--wt-color-primary` / `--wt-color-on-primary`), `later` grey (`--wt-color-surface-sunken`).
   PR 9c uses `now` and `later` for the new dishes' headings. The till registers `check` already.
2. **One arrangement, from the slices the screen already uses.** New `apps/till/src/state/sent-sections.ts`:
   `sentSections(current, billId, now)` takes `sentPanel`'s slices (`state/sent-panel.ts:99`, kept,
   so the screen's `#sentSlices`, screen `:3463`, and the dish window stay as they are) and places
   each in its fire group, in firing order (`group.position`), then the bill's ungrouped rows. Each
   section carries its rows (ready first, then by time, as `sent-panel.ts:130–137` sorts them), its
   companions (`sent-panel.ts:120`), whether it is held, and its title: the course names of its
   rows as today's held title joins them (`sent-orders.ts:596–604`), its group number
   (`groupName`), then “Fired 12 min ago” (`till-fired-ago`, from the group's `firedAt`), “At the
   pass” when every row waits there, or “Held”. Rows inside keep today's portion grouping
   (`portionGroups`, `sent-orders.ts:499–509`), unchanged.
3. **`till-sent-orders` draws the sections.** `sent-orders.ts` (841 of its 1,000-line default)
   loses the box, its toggles and its summary: the title and “!” (`:751–768`), the count line
   (`:740–745`), Served's toggle (`:775–794`), Fired's heading with **Mark all served**
   (`:796–805`), Held's toggle and its count (`:817–830`), the pulse (`:82–98`) and `expanded`,
   `servedOpen` and `heldOpen` (`:242–244`). The row's markup moves to a new
   `apps/till/src/widgets/sent-row.ts`. Its text cells reuse PR 6's row rules: the quantity, name,
   second-line and price rules in `draft-row.ts` move once into an exported fragment that both rows
   import, so the two cannot drift. A sent row overrides colour and weight only.
4. **What each row says.** The second line holds the extras, note and set-menu tag as today
   (`#what`, `:510–517`), then the row's state where it is not the heading's: “Ready 3 min” in
   today's warning colour, “At the pass”, “Served”, “Cancelled, charged” (`#status`, `:518–538`). A
   cancelled-but-charged row stays, with its price, because the bill still charges it. Allergy
   marks, nutrition icons and the set-menu tag stay on the row.
5. **Kept, each in the new place.** A held group's **Fire** (`:668–675`) sits in the heading's `end`
   slot and opens today's confirmation (screen `:5835`). Its **More** menu with Earlier and Later
   (`:633–667`) and dragging the heading (`:391–431`) stay beside it. The reminder strip with
   Snooze and Fire (`:692–734`) stays above the sections. Other bills' dishes in a held group
   (`:679–688`) stay under its heading, named by bill, because **Fire** sends them too. A tap on a
   fired row still serves the whole row, with today's checks (`#clickServe` `:485`, `#serve`
   `:432–443`: busy, released, and the quantity shown still current), and the list stays still
   under a pressed finger (`#pressedModel`, `:247`). Holding a row and the ⓘ still open the dish's
   details (`:279–289`, `:577–584`) until 8b.
6. **A1108's words.** “Sent !” and “Held ·” go with the box. `table.at_the_pass` becomes “At the
   pass” / «En el pase», so it reads as the other states do, and a section whose every row waits at
   the pass is headed “At the pass”, never “Fired”. A1108's “at the pass” entry also says a dish
   asked for whose extra was recalled reads Fired in the list and Held in the dish window: write
   that case as a failing test first; if it fails, make both read the same fact; if it passes,
   say so in the PR and delete the point.

**8b. Open a sent row in place, and unfold its portions**

7. **A tap opens the row.** New `apps/till/src/widgets/sent-row-open.ts` holds which sent row is
   open, one at a time, as 7a's `OpenDraftRow` (7a: `draft-row-open.ts`) does for new rows. It
   closes when its dishes leave the section, the bill or party changes, or the list is busy. The
   box reuses 7a's opened-row rule, moved into the fragment of item 3. The row's button gets
   `aria-expanded`. A tap no longer serves (`#clickServe` goes).
8. **Serve 1, Serve all.** The open line reads “{served} of {count} served”: a fired row is
   “0 of 2”, a served row “2 of 2”, since a row holds portions in one state. A fired, released row
   offers **Serve 1** and, when it holds more than one, **Serve {count}**. On a row of identical
   portions, **Serve 1** serves the first by line number and **Serve {count}** all of them, the way
   today's dish window counts (screen `#sendServe`, `:5692–5748`). A single line of several whole
   units serves 1 or all of its quantity. A weighed dish offers one **Serve**, for the whole of it,
   as today (screen `:5619–5638`). Each press sends today's `serve-lines` event through `#serve`'s
   checks, so a row that changed since it was drawn sends nothing. The till's Served message and
   its **Undo** (`till-app.ts:15847–15858`, `:25185–25210`) are unchanged; `till-app.ts` (25,749 of
   25,758) is not touched. A row not yet released, or held, offers no Serve.
9. **Dish details** (`table.sent_info`, today's ⓘ name) in the open box opens today's dish window
   (`sent-line-info`, screen `:3388`), with Fire now, Move to station, Comp, Void, Change dish and
   Undo served, until PR 9d's selection foot. The ⓘ goes. Holding a row still opens the window.
10. **The arrow unfolds portions.** A row of more than one identical portion carries a muted
    `chevron-down` (PR 6's `draftSplitChevron`) in its end column. Unfolded, the row keeps its count
    and price with the arrow turned up in teal, and each portion follows as a row of one, indented.
    Each opens on its own with “0 of 1 served” and **Serve 1** for that portion. The sent list keeps
    which rows are unfolded by their first portion's line id. It clears them when the bill changes,
    as `willUpdate` clears its other state (`:319–336`), and drops one when that row is gone.
    Serving a portion parts it from its row, as today (`portionGroups`' key includes the serving).

## What stays for now, and why

- **The dish window**, through Dish details and holding: Fire now, Move to station, Comp, Void and
  Change dish live only there until PR 9d. It still asks how many on **Mark served**.
- **Today's draft bar** and the headings of dishes not yet sent, until PRs 9a, 9c and 9d. The
  sideways phone's draft bar covering the order is PR 9a's (the watcher, 02:58).
- **The release reminder strip, Earlier / Later and heading drag**: the frames do not draw them and
  nothing yet replaces them.
- **The stored-details list shown while the service read is unavailable** (`#sentFallback`, screen
  `:3409`): it offers no actions and is not redrawn here.
- A dish half served shows as two rows, as today, one fired and one served.

## Tests, failing first

**8a**
- New `wt-course-heading.test.ts` and `.a11y.test.ts`: each mark's colours and size, the `end`
  slot, the heading level; axe on each mark in light and dark.
- New `sent-sections.test.ts`: firing order; ungrouped last; ready first inside a section; a held
  group with another bill's dish; titles “Fired 12 min ago”, “At the pass” (all rows waiting) and a
  mixed section whose waiting row says “At the pass”; an empty held list gives no section.
- `sent-orders.test.ts`: no toggle, no summary, no “!”; one heading per section with its mark or
  **Fire**; Fire, Earlier / Later, the heading drag and the reminder act on the same group as
  before; a tap still serves and refuses a changed row; a cancelled-charged row keeps its price.
  Spanish: «En el pase» never sits under «Marchado».
- The recalled-extra case of item 6.
- The sent test helpers (`till-table-order-screen.sent.test-helpers.ts:15–40`) stop opening the box.
  Every check that opened it (`data-sent-toggle` in 28 files, `data-held-toggle` in 22,
  `data-served-toggle` in 10) or read its count line or “!” changes: the PR's “Changed test checks”
  lists each with `file:line`, old check and new.

**8b**
- New `sent-row-open.test.ts`: a tap opens one row; a second tap or another row closes it; the line
  reads “0 of 2 served”; **Serve 1** sends the first portion, **Serve 2** both, once each; a weighed
  dish sends its whole amount; a row changed since it was drawn, a busy list or a row not released
  sends nothing; **Dish details** opens the window; holding opens it too.
- Unfolding: the arrow shows on rows of two or more only; unfolded portions each open and serve
  alone; the unfolded state clears on another bill.
- `till-app-parties.test.ts`'s partial-serving cases (A773, `docs/backlog/till.md`, “Replacement
  order controls”) move from the dish window to the open row: two of three served by unfolding or
  by Serve 1 twice, 44px targets, one request per press, and **Undo** taking back exactly those, in
  English and Spanish, both themes, at 390 and 1280.
- axe on an open fired row, an open served row and an unfolded row, light and dark.

## Docs

English and Spanish guides change wherever they say “in **Sent**” or “tap a row to mark it served”:
`table-service.md` `{#portions}` (English `:502–504`, Spanish `:528–530`) and the paid-bill Comp
paragraph (English `:748`, Spanish `:791`), `modifiers.md` (English `:111`, Spanish `:121`), and
`kitchen-service.md` (English `:129` and `:396–397`, Spanish `:145` and `:430–432`). `design-system.md`
gains `wt-course-heading` in the primitives table and a “The order's sent rows (till)” paragraph,
and its “Identical portions share one row” (`:6449–6466`) and draft bar (`:1171`) lose “Sent
panel”. The backlog loses A1108, the “at the pass” entry, and the bundle's “Serving part of a row”
except its Quantity-box point; the bundle's count drops to match.

## Size, review and pictures

8a: 200–260 lines of code and copy, and 300–380 of tests, mostly rewritten checks. 8b: 150–200
and 220–300. Together well over one three-hour PR, hence two. No risk trigger is touched: serving
and firing are kitchen state, not filing; no total, VAT rule, permission, drawer or database changes;
the rows show the amounts the server stores (`sent-panel.ts:54–68`), and the serve and fire requests
are today's. So no per-task reviewer; `finish-branch`'s Codex run-it seat runs twice on each PR's
named risks. 8a: Fire, the reminder, Earlier / Later and the heading drag still act on the right
group once rows are regrouped. 8b: each Serve press sends exactly the portions its row showed, and
never a row that changed under it.

Pictures go to the watcher beside `af` 1, `d` 1 and `g` 1 (8a), and `e` 3, `g` 1 and `g` 2 (8b),
with the differences listed against each frame and §14: phone 390 px and till 1280 px, portrait
and landscape, light and dark, English and Spanish, and the order panel at 800 × 1280. Then lane P's
Impeccable finish review, which must say “ready for the owner”. Each lands after the owner's
recorded OK and green CI on the current head. 8a needs PR 6 and builds after 7a, which also edits
`draft-row.ts`; 8b needs 8a and 7a.

## Questions for the watcher

1. **Mark all served.** Today's Fired heading serves every ready dish of the bill in one tap
   (`sent-orders.ts:798–804`). The frames draw no such button, and the spec names nothing to
   replace it, so the plan drops it. After 8b, serving four different dishes takes eight taps.
   Drop it, or keep a **Serve all** in each fired heading's `end` slot?
2. **The group number.** The pass board and station cards show “Group 3”
   (`pass-board.ts:428`, `station-queue.ts:1177`). The frames' headings show only the course.
   The plan keeps the number in the heading so the waiter can match the kitchen's card.
3. **A mixed heading.** §4 draws “Mains + 1 starter”, but a venue types course names in the plural
   only, so “1 starter” has no source. The plan joins the names, as today: “Starters, Mains”.
4. **Served dishes** stay under their fire group as quiet rows reading “Served”, where today they
   fold away under a Served toggle. The spec does not say where they go.
5. **Frame `e` 3** is the only drawing of an opened sent row, and §12 lists `e` neither as chosen
   nor as turned down beyond frame 1. The plan takes only its serving line and box. Two PRs,
   8a then 8b?
