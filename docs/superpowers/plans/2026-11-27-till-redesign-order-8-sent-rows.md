# Till redesign, order screen PR 8: sent rows, serving in place

Lane N, item TILL-REDESIGN-ORDER, PR 8 of the [split](2026-11-26-till-handheld-redesign-pass-1.md)
(“Unfold sent portions and Serve 1 or Serve all in one tap (A773). Keep Fire, Undo and the existing
checks. Fix “Sent !”, empty “Held ·” and the “at the pass” heading (A1108).”). Design:
[§4 The order screen](../specs/2026-11-26-till-handheld-redesign-design.md#4-the-order-screen),
§14.2 “Course heading”, §14.4 “Rows”, “Unfolded rows” and “An opened row”. Backlog: A1108
(`docs/backlog/till.md`, “The till order screen's Sent panel reads…”), the “at the pass” entry
beside it, and the bundle's “Serving part of a row (A773's physical trial)”. Line numbers are PR 6's
head (`941646a6db`, branch `feat/n-till-order-6-rows`, #4459, not landed) unless a line says main
or 7a. Status: cleared by the watcher on 2026-11-27 at 09:04 with five changes, folded in (see
Decisions). It lands as four pull requests, **8-0**, **8a**, **8b** and **8c**, in that order.

## What staff can do when it lands

**8-0.** Nothing on the till yet: the course heading, in the shared UI package.

**8a.** Dishes already sent sit at the top of the order as quiet rows, as on a printed ticket, under
a heading for each fire group named after its course: “Drinks · fired 12 min ago” with a green
“✓ Sent” mark and a **Serve all** button, or a held group with its **Fire** button. There is no Sent
box to open any more, and its “Sent !”, empty “Held ·” and “at the pass under Fired” go with it. A
dish part served is one row, “1 of 3 served”. A row still says when it is ready, waiting at the
pass, served, or cancelled but charged. Tapping a row still serves what is left of it.

**8b.** Tapping a sent row opens it in place: “1 of 3 served”, then **Serve 1** and **Serve 2**, and
**Dish details** for everything else until PR 9d. **Undo** on the Served message still takes a serve
back.

**8c.** A row of several identical dishes carries an arrow; it unfolds them into rows of one, each
opened and served on its own.

## The frames it builds to

Measured in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.

- **Course heading** (8-0), `af` 1 (`.ch`) and §14.2: small capitals, 13 bold, letter-spaced, muted,
  padded 12 / 16 / 6, on the page background, the mark at the right. Letter spacing is built
  `--wt-letter-spacing-caps` (0.04em, `packages/ui-core/src/tokens/structure.css:111`, as
  `wt-sheet` and `wt-row-actions` use) against the drawn 0.03em. The “✓ Sent” mark, `af` 1 and
  `d` 1 (`.pill.ok` in `base.css`): fully rounded, `check` before the word, 13 (§14.2;
  `--wt-font-size-sm`); drawn padding 2–3 by 8–10 is built `--wt-space-1` by `--wt-space-2`.
  “Today's quiet green” is `--wt-color-tab-ready-tint`, the ready tab's green (`design-system.md`,
  its token table), text `--wt-color-text`, the tick `--wt-color-success`: a listed difference from
  the drawn `#d7efe4` / `#12573e`.
- **Sent rows** (8a), `af` 1 (`.r.sent`) and `d` 1, and §14.4: the page background, muted text,
  quantity and name regular weight, price 15 at the right, a line under each, no grip; the grip's
  column stays empty, so quantities line up with the new rows under them. Row height 52, as PR 6's
  rows. The till's column: `m` and `s` (the same rows).
- **An opened sent row** (8b): §4's text decides what it holds (“0 of 2 served” with “Serve 1” and
  “Serve 2”); `e` 3 is the drawing that matches it, and §14.4 names `g` 3's box (2px teal border,
  radius 8, margin 4 / 8, surface colour). The row's text is in full colour and weight while open,
  as `e` 3 draws it; then one line with the count (14, muted) at the left and **Serve 1**,
  **Serve 2** (outlined, 44 tall, 15, `--wt-font-weight-bold`, which is 600) at the right, the same
  rule as 7a's opened-row buttons. `e` 3's **Comp…**, **Move to station…** and **Void…** are not
  built: pass 2 moved them to the selection foot (§4), and **Dish details** reaches them until then.
- **The arrow on a sent row** (8c), `g` 1 and 2 (`.chev`, 44 square, muted; unfolded, teal).
  **Unfolded rows**, `af` 3 (`.r.sub`) and §14.4: indented `--wt-space-5`, on the page background.

## The change

**8-0. The course heading, alone**

1. **`wt-course-heading`, a new primitive in `packages/ui`** (§14.2; queue rule C names lane N for
   course pills). A default slot for the title, so the screen can put the self-updating
   `till-fired-ago` in it (`widgets/fired-ago.ts`); `mark` (`""` or `sent`); `level` (default 3);
   an `end` slot for an action. PR 9c adds the `now` and `later` marks when it first uses them.
   `wt-lozenge` is not reused: it paints a category colour given as data, inline
   (`packages/ui/src/components/wt-lozenge.ts`), where this mark reads fixed tokens. `wt-icon`
   registers `check` itself (main, `wt-icon.ts:121`). It needs nothing from PRs 6 or 7, so it
   builds from main now. Nothing on the till uses it until 8a, so what shows it working is its own
   tests (below), an example on the workbench page beside 13a-0's sheet and rows (#4449 added
   those), and pictures of that example; the `design-system.md` primitives table gains its row here.

**8a. Sent rows by fire group**

2. **One arrangement, from the slices the screen already uses.** New `apps/till/src/state/sent-sections.ts`:
   `sentSections(current, billId, now)` takes `sentPanel`'s slices (`state/sent-panel.ts:99`, kept,
   so the screen's `#sentSlices`, screen `:3463`, and the dish window stay as they are) and places
   each in its fire group, in firing order (`group.position`). Rows sent outside any group
   (`CurrentOrders.ungrouped`, which the widget's own test fixture uses, `sent-orders.test.ts:77`)
   form one last section, headed by their course names and “Fired N min ago” from the earliest
   `firedAt` among them, with the ✓ Sent mark. Each section carries its rows, its companions
   (`sent-panel.ts:120`), whether it is held, and its title: the course names of its rows as
   today's held title joins them (`sent-orders.ts:596–604`), then “Fired 12 min ago” (from the
   group's `firedAt`), “At the pass” when every row waits there, or “Held”. Rows with something
   left come first, ready first, then by time (as `sent-panel.ts:130–137` sorts them), then rows
   wholly served or cancelled but charged.
3. **One row per dish, served or not** (decision 2). Today `splitRow` (`sent-panel.ts:42–70`) cuts
   one line into a cancelled-but-charged slice, a served slice and a fired (or held) slice, and
   `sentSlicePortionKey` (`portion-groups.ts:120–144`) keeps identical portions apart once one is
   served: its key holds the slice's kind (`:134`) and, through `tabLinePortionKey`, whether the
   line is served (`:96`). A sent row now joins a line's served and unserved slices, and joins
   identical one-portion lines whether served or not, under a new key beside `sentSlicePortionKey`
   that leaves out what serving changes (served and fired count as one kind; `servedAt`; a served
   portion's `readyAt`, `:138`); the basket's and the kitchen's keys are not changed. A
   cancelled-but-charged slice stays a row of its own. So a line of 3 with 1 served and three lines
   of 1 with one served both read “1 of 3 served”, and a row knows which portions are left.
4. **`till-sent-orders` draws the sections.** `sent-orders.ts` (841 of its 1,000-line default)
   loses the box, its toggles and its summary: the title and “!” (`:751–768`), the count line
   (`:740–745`), Served's toggle (`:775–794`), Fired's heading (`:796–797`; its **Mark all served**
   moves to each fired heading, item 6), Held's toggle and its count (`:817–830`), the pulse
   (`:82–98`) and `expanded`, `servedOpen` and `heldOpen` (`:242–244`). A visually hidden “Sent”
   heading (`table.sent_title`, level 2) stays, so the course headings (level 3) sit under it,
   beside the “New order” heading. The row's markup moves to a new
   `apps/till/src/widgets/sent-row.ts`. Its text cells reuse PR 6's: the quantity, name,
   second-line and price rules in `draft-row.ts` (`:241–264`) become one exported fragment of plain
   class selectors that both rows import; the basket keeps its own structural grid rules
   (`:184–240`, `:265–272`), which depend on its `.order-lines > .entry` structure. A sent row
   overrides only colour and weight. The 20-second refresh of “Ready N min” and “Fired N min ago”
   (`:341`) now runs whenever a fired row shows, since there is no box left to be open.
5. **What each row says.** The second line holds the extras, note and set-menu tag as today
   (`#what`, `:510–517`), then the row's state where it is not the heading's: “Ready 3 min”,
   “At the pass”, “Served”, “Cancelled, charged” (`#status`, `:518–538`), and on a part-served row
   “1 of 3 served” (`table.row_served_of`, `strings.ts:1425`). Today all of these are muted
   (`.status`, `:189–196`), and the only cue for ready food is the box's warning border and pulse
   (`:82–98`, set by `sent-panel.ts:144`), which this PR removes. So “Ready 3 min” is drawn bold in
   `--wt-color-warning`: new, and a listed difference, since no frame draws a ready row. A
   cancelled-but-charged row stays, with its price, because the bill still charges it. Allergy
   marks, nutrition icons and the set-menu tag stay on the row. The quantity moves out of the name
   into its own column, so “Estrella ×2” becomes “2 Estrella”.
6. **Kept, each in the new place.** Today's **Mark all served** (`:798–804`) becomes **Serve all**
   (`table.serve_group`, reworded in English and Spanish) in the `end` slot of every fired heading,
   “At the pass” included (decision 1). It serves that section's released, unserved portions of
   this bill through `#serve`'s checks, and is disabled while busy or when none is released, as
   today (`:800–801`); it keeps `data-serve-all`. A held group's **Fire** (`:668–675`) sits in its
   heading's `end` slot and opens today's confirmation (screen `:5835`). Its **More** menu with
   Earlier and Later (`:633–667`) and dragging the heading (`:391–431`) stay beside it. The reminder
   strip with Snooze and Fire (`:692–734`) stays above the sections. Other bills' dishes in a held
   group (`:679–688`) stay under its heading, named by bill, because **Fire** sends them too. A tap
   on a fired row still serves what is left of it, with today's checks (`#clickServe` `:485`,
   `#serve` `:432–443`: busy, released, and the quantity shown still current), and the list stays
   still under a pressed finger (`#pressedModel`, `:247`). Holding a row and the ⓘ still open the
   dish's details (`:279–289`, `:577–584`) until 8b. The screen also passes an unread dish list as
   busy (screen `:3364` adds `currentOrdersUnread`), as the dish window already refuses then
   (`#serveRefused`, screen `:5642–5644`).
7. **A1108's words.** “Sent !” and “Held ·” go with the box. `table.at_the_pass` becomes “At the
   pass” / «En el pase», so it reads as the other states do, and a section whose every row waits at
   the pass is headed “At the pass”, never “Fired”. A1108's “at the pass” entry also says a dish
   asked for whose extra was recalled reads Fired in the list and Held in the dish window: write
   that case as a failing test first; if it fails, make both read the same fact; if it passes,
   say so in the PR and delete the point. `table.sent_counts` and `table.served_title` are deleted
   in English and Spanish.

**8b. Open a sent row in place**

8. **A tap opens the row.** New `apps/till/src/widgets/sent-row-open.ts` holds which sent row is
   open, one at a time, as 7a's `OpenDraftRow` (7a: `draft-row-open.ts`) does for new rows. It
   remembers the row by its first portion's line id. A serve no longer splits a row (item 3), so
   after **Serve 1** the same row reads “1 of 2 served” and stays open for a second press, with no
   further tracking. It closes when the bill or party changes, or when no row holds that line id.
   While the list is busy (a serve or fire in flight sets `groupCommandBusy`, `till-app.ts:15515`,
   which reaches the list as `busy`, screen `:3364`) its buttons are disabled, not closed. The box
   rule moves into the fragment of item 4 from 7a's `draft-row.ts`, so both opened rows draw one
   box. The row's button gets `aria-expanded`. A tap no longer serves (`#clickServe` goes).
9. **Serve 1, Serve {N}.** The open line reads `table.row_served_of` (“{served} of {quantity}
   served”), the words the dish window already uses for a part-served line (screen `:4007`), with
   the row's own count: one rule for a line and for identical portions (item 3). A released row with
   N left offers **Serve 1** and, when N is more than one, **Serve {N}**. On a row of portions,
   **Serve 1** serves the first unserved one by line number and **Serve {N}** all of them, as
   today's dish window does (screen `#sendServe`, `:5692–5748`). One line of several whole units
   serves 1 or all of what is left of it. A weighed dish offers one **Serve**, for the whole of it,
   as today (screen `:5619–5638`). A row wholly served, not yet released, or held offers no Serve.
10. **The checks behind a press.** `#serve` (`:432–443`) today uses one quantity both to check the
    row still shows what it showed and as the amount sent (`:440–441`), so a Serve 1 of a line
    showing 3 would send nothing. It is split in two: what the row showed (every portion of the row
    with its quantity, served or not) and what to serve. A press sends nothing if any portion of the
    row changed, as the dish window refuses (screen `:5711–5728`), or if the list is busy. It sends
    today's `serve-lines` event, so the Served message and its **Undo** (`till-app.ts:15847–15858`,
    `:25185–25210`) are unchanged; `till-app.ts` (25,749 of its 25,758 cap) is not touched.
11. **Dish details** (`table.sent_info`, today's ⓘ name) in the open box opens today's dish window
    (`sent-line-info`, screen `:3388`), with Fire now, Move to station, Comp, Void, Change dish,
    Mark served and Undo served, until PR 9d's selection foot. The ⓘ goes. Holding a row still opens
    the window.

**8c. Unfold identical portions**

12. **The arrow.** A row of more than one identical portion carries a muted `chevron-down`, PR 6's
    `draftSplitChevron` drawing, in its end column. (7a's `draftSplitArrow` in `draft-portions.ts`
    takes a new dish's `OrderLine` and does not fit a sent row, so 8c does not depend on 7b.)
    Unfolded, the row keeps its count and price with the arrow turned up in teal, and each portion
    follows as a row of one, indented, reading its own state. Each unserved portion opens on its own
    with “0 of 1 served” and **Serve 1** for that portion. The list remembers unfolded rows by their
    first portion's line id; since a serve no longer parts a portion from its row (item 3), serving
    one leaves the row unfolded. It forgets them when the bill changes, as `willUpdate` clears its
    other state (`:319–336`).

## What stays for now, and why

- **The dish window**, through Dish details and holding: Fire now, Move to station, Comp, Void and
  Change dish live only there until PR 9d. It still asks how many on **Mark served**.
- **Today's draft bar** and the headings of dishes not yet sent, until PRs 9a, 9c and 9d. The
  sideways phone's draft bar covering the order is PR 9a's (the watcher, 02:58).
- **The release reminder strip, Earlier / Later and heading drag**: the frames do not draw them and
  nothing yet replaces them.
- **The stored-details list shown while the service read is unavailable** (`#sentFallback`, screen
  `:3409`): it offers no actions and is not redrawn here.

## Tests, failing first

**8-0**
- New `wt-course-heading.test.ts`: the mark's background, text and tick paint their tokens, at
  `--wt-font-size-sm`; no mark draws none; the title and `end` slots; the heading level, default 3
  and set. New `wt-course-heading.a11y.test.ts`: axe with and without the mark and with a button in
  `end`, in light and dark. The file holds `ui`'s coverage bar (98/98/98/95) and mutation floor (90).

**8a**
- New `sent-sections.test.ts`: firing order; the ungrouped section last, with its own title; ready
  first inside a section, served rows last; a held group with another bill's dish; titles “Fired 12
  min ago”, “At the pass” (all rows waiting) and a mixed section whose waiting row says “At the
  pass”; nothing held gives no held section. One row per dish: a line of 3 with 1 served is one row
  reading “1 of 3 served”, and so are three identical lines of 1 with one served; a cancelled,
  charged part stays its own row; a row's price is the sum of its slices.
- `sent-orders.test.ts`: no toggle, no summary, no “!”; one heading per section with its mark and
  **Serve all**, or **Fire**; **Serve all** sends only its section's released, unserved portions,
  once, and nothing when a row changed or the list is busy; Fire, Earlier / Later, the heading drag
  and the reminder act on the same group as before; a tap serves what is left of a part-served row
  and refuses a changed row; a cancelled-charged row keeps its price; “Ready 3 min” in the warning
  colour, refreshed with no box open. Spanish: «En el pase» never sits under «Marchado».
- The recalled-extra case of item 7; a serve tap refused while the dish list is unread.
- The sent test helpers (`till-table-order-screen.sent.test-helpers.ts:15–40`) stop opening the box.
  Every check that opened it or read its words changes: `data-sent-toggle` (79 uses in 28 files),
  `data-held-toggle` (51 in 22), `data-served-toggle` (17 in 10), the count line and “!”, text checks
  reading “Name ×2”, and the `data-serve-all` checks (15 in 4) that served more than one fire group
  in one press. The PR's “Changed test checks” lists each with `file:line`, old check and new.

**8b**
- New `sent-row-open.test.ts`: a tap opens one row; a second tap or another row closes it; the line
  reads “0 of 2 served”, and “1 of 3 served” both on one line of 3 and on three identical lines of
  1; **Serve 1** sends the first unserved portion, **Serve 2** both, once each; **Serve 1** on one
  line showing 3 sends 1; a weighed dish sends its whole amount; nothing is sent when any portion
  of the row changed since it was drawn, when the list is busy or unread, or for a row not
  released; after **Serve 1** the same row stays open reading the new count; a wholly served row
  offers no Serve; **Dish details** opens the window; holding opens it too.
- `till-app-parties.test.ts`: its partial-serving cases through the dish window (A773,
  `docs/backlog/till.md`, “Replacement order controls”) stay, since that route stays. New cases
  beside them serve two of three from the open row by Serve 1 twice: one request per press, 44px
  targets, and **Undo** taking back exactly those. They run once, in English, one theme and one
  width (decision 4); one case checks the Spanish count line.
- Checks that reach the dish window through the ⓘ (`data-sent-info`, 44 uses in 21 files) or serve
  by tapping the row (`data-serve-line`, 36 in 5) change to Dish details and the open row's Serve;
  each is listed under “Changed test checks”.
- axe on an open fired row and an open served row, light and dark.

**8c**
- The arrow shows on rows of two or more identical portions only; unfolded portions each open and
  serve alone, sending that portion only; serving one leaves the row unfolded; the unfolded state
  clears on another bill; one `till-app-parties.test.ts` case serves one of three by unfolding;
  axe on an unfolded row, light and dark.

## Docs

**8-0**: `design-system.md` gains `wt-course-heading` in the primitives table.

**8a**, where the guides name the Sent box or its list: English and Spanish `kitchen-service.md`
(English `:124` and `:129`, Spanish `:140` and `:145`; and English `:396–397`, Spanish `:430–432`,
for “At the pass”), `table-service.md`'s paid-bill Comp paragraph (English `:748`, Spanish `:791`)
and `modifiers.md` (English `:111`, Spanish `:121`): “in **Sent**” becomes the sent dishes at the top
of the order, with **Serve all** in a fired heading. `design-system.md` gains a “The order's sent
rows (till)” paragraph; “Identical portions share one row” (`:6449–6452`), the draft bar (`:1171`)
and the tick names (`:6504`, “as the Sent list writes it”) lose the Sent panel and list.

**8b**: `table-service.md` `{#portions}` (English `:502–504`, Spanish `:528–530`): a tap opens a sent
row, and **Serve 1** and **Serve all** serve there. `design-system.md` `:6461–6462` (“Mark served …
on a grouped row ask how many”) says the open row's Serve 1 and Serve all and the window's count.
`docs/backlog/till.md`'s “Replacement order controls” (`:1301–1308`) and the A773 section's
“partial-serving trials remain separate backlog entries” (`:2157–2158`) name the new route.

**8c**: the same `{#portions}` paragraphs add that the arrow gives one row per dish.

**Backlog**, in the PR that finishes each: 8a deletes A1108 (`till.md:600`) and the “at the pass”
entry (`:574`), and edits the bundle's wording bullet (`:800–805`) to keep A470 and A1107 only. 8b
deletes the bundle's “Serving part of a row” bullet (`:765–769`) once its Held point (8a) and
partial serving are done, moving its Quantity-box point to its own short line in the bundle and its
Served-message point into A1211's bullet (`:761–764`). Each deletion lowers the bundle's count in
`till.md`'s heading and in `docs/backlog.md:670`, where A1108 also leaves the list.

## Size, review and pictures

Estimates, lines of code and copy then of tests: 8-0 60–100 and 120–160; 8a 200–260 and 400–500,
most of the tests mechanical edits that stop opening the box; 8b 120–170 and 220–290; 8c 50–80 and
100–140. No risk trigger is touched: serving and firing are kitchen state, not filing; no total,
VAT rule, permission, drawer or database changes; a row's price is the sum of the amounts `splitRow`
divides from each line's stored `netAmount` (`sent-panel.ts:54–69`), unchanged; and the serve and
fire requests are today's. So no per-task reviewer; `finish-branch`'s Codex run-it seat runs on each
PR, twice on 8a to 8c, on its named risks. 8-0: each mark and slot paints the tokens and reads as a
heading at its level. 8a: Fire, Serve all, the reminder, Earlier / Later and the heading drag act on
the right group once rows are regrouped, and a joined row's tap sends only what is left. 8b: each
Serve press sends exactly the portions its row showed, and never a row that changed under it. 8c:
an unfolded portion's Serve sends that portion alone.

Pictures go to the watcher, then to lane P, whose Impeccable finish review must say “ready for the
owner”, then to the owner. 8-0's, the workbench example in light and dark at 390 px beside `af` 1's
heading, go to the watcher alone: it changes no screen, so lane P and the owner see the heading in
8a's pictures, as lane I's 15a was handled (watcher, 2026-11-26 22:04). 8a's sit beside `af` 1 and `d` 1, 8b's beside `e` 3, 8c's beside `g` 1 and `g` 2: phone 390 px and till
1280 px, portrait and landscape, light and dark, English and Spanish, and the order panel at
800 × 1280. Each lists its differences against its frames and §14:

- **8-0**: letter spacing 0.04em against the drawn 0.03em; the mark's tokens against the drawn
  `#d7efe4` / `#12573e`.
- **8a**: **Serve all** in each fired heading, which no frame draws (decision 1; the owner can drop
  it at the picture OK); course names joined “Starters, Mains” against §4's “Mains + 1 starter”
  (decision 5); “Ready 3 min” bold in the warning colour; a part-served row reading “1 of 3
  served”, which no frame draws.
- **8b**: `e` 3's Comp…, Move to station… and Void… not built, with Dish details in their place.
- **8c**: whatever measuring `g` 1 and `g` 2 finds.

8a to 8c each land after the owner's recorded OK, 8-0 after the watcher's, and each after green CI
on the current head. 8-0 builds from main; 8a needs 8-0 and PR 6, and builds after 7a, which also edits
`draft-row.ts`; 8b needs 8a; 8c needs 8b. Each leaves main working: after 8a a tap still serves and
the ⓘ still opens the window; 8b replaces both.

## Decisions (watcher, 2026-11-27 09:04)

1. **Mark all served** stays, as **Serve all** at the right end of each fired heading: the queue's
   rule keeps a working route into existing actions until its replacement lands, and nothing in PRs
   9a–12 replaces it. It is listed in 8a's picture differences, so the owner can drop it there.
2. **One served-count rule**: a dish's served and unserved portions are one sent row (“1 of 3
   served”, with Serve buttons for what is left), for one line and for identical lines alike, and
   both are tested. This also removes the extra tracking the open and unfolded rows needed.
3. **Four pull requests**: `wt-course-heading` alone first (8-0, as lane I's 15a), then 8a, 8b, and
   the unfold arrow on its own in 8c.
4. **Tests**: the new serve-from-the-row cases in `till-app-parties.test.ts` run once, not across
   languages, themes and widths, which belong to the axe tests and the pictures; Spanish needs one
   string check.
5. **The plan's defaults**: the heading leaves out the group number, as `af` 1 and §4 do; a mixed
   heading joins course names, “Starters, Mains”, listed against §4's “Mains + 1 starter”; served
   dishes stay under their fire group as quiet rows.

## End notes: the reads

A fresh-context Claude read the plan at `941646a6db` and its twelve findings are folded in. One
was not taken: the Serve buttons stay `--wt-font-weight-bold`, since that token is 600
(`packages/ui-core/src/tokens/structure.css:29`), the drawn weight. The watcher's read, which
agreed, is `~/waitron-campaign-shared/codex-review/last-plan-n8.out`.
