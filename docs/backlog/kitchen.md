# The kitchen and preparation — detail

The open entries are listed in [the backlog](../backlog.md), under "The kitchen and preparation". This file holds
their full text.

## KDS operations — low priority (A9)

Order routing is built (item→station, station→printer, receipt→printer). Gaps: a routing audit
view (a routing cell keeps no record of who changed it or when — the most useful to close); no
station `type`/`kind`; single-target only (no fan-out or per-modifier rules; period choices came
with A366 slice 4). Table and service statuses have full CRUD; kitchen statuses are partial —
`bump_mode` and `fire_control` are configurable fixed enums, but a user-definable kitchen-status
list does not exist.

## Task 5 (#750, kitchen, pass and table screen by group; printing problems)

- **Task 5 (#750, kitchen, pass and table screen by group; printing problems).** Left open:
  - A party finished while its food is still on the pass keeps its cards there with no group
    button that works (each is refused `party.not_open`); a question for the owner.
  - "Ready" and "Fired N min ago" on the table screen are the plan's default, not an owner
    decision.
  - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
  - `*** REPRINT ***`, `GROUP n`, `*** HOLD ***`, `*** FIRE ***`, `*** HOLD CHANGED ***` and
    `*** HOLD CANCELLED ***` print in English. Since B11g the extra-cancel slip's header word and
    cancel line follow the server's locale (`WAITRON_TILL_LOCALE`, `es-ES`
    when unset), so by default a held slip reads `*** HOLD CAMBIADO ***`, `GROUP n` and
    `QUITAR:`, mixed on one slip. Since A683 a ticket for a named party also prints its order
    line in that locale, so a held ticket reads `*** HOLD ***` above `Pedido 5 · Ana`.
  - A switched-off printer's printing problem keeps showing until the printer is switched on
    and a Reprint prints there; there is no way to dismiss one.
  - A failed ticket on a pass printer (one ticket for the whole order) shows on the card of
    every station it covered, even where that station's own printer printed; it stops showing at
    a station once a Reprint of the bill would not link that pass printer to that station.
    _2026-10-10 (A366 slice 5 Part B): watchers are gone, and a pass printer is now a printer
    listed on every station; its combined ticket is linked to each station it covers, so this
    applies again ("shows a failed combined ticket on both stations' cards, and one Reprint there
    clears both", `apps/server/src/print-problems.test.ts`)._
  - Finish table drops the problem of a bill that transfers emptied (read, not run; not
    re-checked by B6a).
  - After a merge, a reprint of the absorbed bill that was still waiting at the merge clears
    nothing when it prints, so its warning stays until the merged bill is reprinted once more
    (`moveKitchenPrintLinks`, `apps/server/src/kitchen-print.ts`). The same holds when dishes move
    by transfer, split or a line move: a copied ticket never counts as a reprint. Not tested as a
    rule: move a dish from bill A to bill B, reprint B so it prints, move the dish back, and A
    shows its old failure again.
  - Only dishes whose unit does not print on the ticket — sold in Each by the unit's identity
    (`readLinesSoldInEach`), or with no unit recorded on the line — are added together or split;
    a venue-made unit that counts pieces (a "portion"), even one spelled like Each, prints line
    by line, because nothing records a unit's kind (a unit field would need a migration).
  - The kitchen-ticket grouping setting sits on Venue settings' **Kitchen** tab,
    and so does "Print held groups in advance", which is not about sent work at all.
  - `fireHeldGroupsOfCourse` (`apps/server/src/order-groups.ts`), through which a course Fire
    still fires a party's held groups, is to be removed in a follow-up.
  - Every pass press moves the party's revision, so a waiter's open Tab drawer meets
    `party.out_of_date` after it and reads again.
  - Setting up a venue from an imported configuration deletes every kitchen station, and the
    `kitchen_print_jobs` station key has no delete rule; whether that venue can already hold
    link rows at that point was not tested (read, not run).
  - The pass's Ready and Away record no `order_group_events` row, so who pressed them is
    recorded nowhere readable; a new kind changes that append-only table's check, which is a
    core migration.
  - Questions for the owner: the kitchen and pass screens offer Fire on every held group, where
    the plan's text said "the first held group"; and the table screen reads its printing
    problems in a second request beside the groups read on every table load (folding them in
    would change the exact-body assertion in `apps/server/src/till-api.groups.test.ts`).

## Task 6 (#761, HOLD tickets in advance)

- **Task 6 (#761, HOLD tickets in advance).** Left open:
  - A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem",
    like every correction slip: none is recorded in `kitchen_print_jobs`.
  - A printed HOLD ticket goes stale when held groups are reordered or a party is merged into
    another (both renumber `GROUP n`). Only a FIRE ticket or a Reprint can be relied on.
  - Whether a group's HOLD ticket was queued is recorded per group, not per station, so a
    correction, and a Reprint's REPRINT and HOLD section, can print at a station whose printer
    never printed that group's HOLD ticket.

## Is a `+` sub-line enough for a doneness answer on the kitchen ticket?

- **Is a `+` sub-line enough for a doneness answer on the kitchen ticket?** Doneness is a modifier
  the venue adds itself (Task 10); an options answer prints on the kitchen ticket as an indented
  `+ <list kitchen name>: <label kitchen name>` line. **Open, and worth a cook's eye before a real
  service:** whether that is enough for something a cook must not miss, or whether an options answer
  deserves its own prominent form on the ticket. Nobody has watched a real kitchen read one.

## KDS corrections deferred from #191

- **KDS corrections deferred from #191** (owner, 2026-09-01): a moved dish must keep its kitchen
  status — the ticket must travel with the line, not re-fire (`moveTabLines`, which dropped it, was
  deleted by service plan Task 13; whether this still holds for the paths that move lines now is not
  checked); hold-on-send without courses plus a venue disable setting; FP-1's empty-named
  child-modifier row; a device-scoped collect route (a kitchen display's Fire already has a device
  route, `apps/server/src/device-levers.ts`). Then the low-priority KDS list under
  [KDS operations](../backlog/kitchen.md#kds-operations--low-priority-a9).

## Mark a new dish as urgent

- **Mark a new dish as urgent** (owner, 2026-09-27). A waiter can already send a new dish straight
  to the kitchen ("cook this now, don't hold it") under every release setting; the owner would like
  a way to add urgency to it too, so the kitchen sees it flagged. Nothing like it exists today. Not
  designed: what the flag looks like on the kitchen screen, the pass and a printed ticket, and who
  may set it. Releasing an ALREADY-held group stays with whoever the venue's `fire_control` setting
  names — the waiter asks the kitchen or pass when that is not the waiter.

## Three follow-ups 3c-1 left

- **Three follow-ups 3c-1 left:** the kitchen screen's column view has no per-order card, so it
  does not show the rest of the order (a station that needs that context uses the card view);
  units added to a discounted pay-first dish held in a group get a held kitchen record of their own
  while the dish has none — observed on `main`, its history not checked, and whether it is wanted
  remains open; and a device's made-here stations do not travel in configuration export, because
  devices are not exported (`packages/db/src/configuration-transfer.ts:1-37`), so a venue set up
  from an export sets them again on the Devices screen.

## A following extra has different names on paper and on screen

- **A following extra has different names on paper and on screen.** Its `+` line prints the frozen
  staff name (`buildTicketItems`, `apps/server/src/kitchen-print.ts`), while the kitchen screen and
  pass read its frozen customer `descriptions` (`readQueueSubItems`,
  `apps/server/src/working-order.ts`). A split-off extra's cross-reference reads kitchen names on
  both surfaces. Decide which name the following extra should show, then make the surfaces agree.

## The dark-screen alert can be wrong

- **The dark-screen alert can be wrong** (S2b, owner, 2026-10-01). A kitchen working from paper
  may never mark dishes ready on its screen. With that screen switched off, each send can raise
  the dark-screen alert for up to an hour while those dishes remain waiting. A kitchen screen
  opened through the dev stack's device chooser never records a check-in: the override returns
  before the cookie path updates `lastSeenAt` (`apps/server/src/device-session.ts:176-186`).
  Improve how the alert distinguishes a kitchen using paper and how the dev chooser records check-ins.

## Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it)

- **Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it).**
  The counter's prep-queue card shows no notices and does not refresh. The till's API client has no
  general request timeout (only the kitchen refresh and menu-state reads are bounded, at 25 seconds,
  and a table's round sends and offer reloads, at 150 seconds). A refusal that lands after the tab
  is paid, or after a server switch, shows the ordinary unnamed message. The kitchen screen's list
  of stations is read only when the screen opens, so after that read fails the out-of-date banner
  stays, counting, until the screen is opened again; long outages are counted in minutes, never
  hours.

## Each is decided by the unit's identity, with one known gap

- **Each is decided by the unit's identity, with one known gap.** While a line is still open,
  deleting the stored unit seeded as `each` it was sold in makes its queue row, any notice recorded
  after, its printed ticket, the expo board and the ticket's merge-or-split check read it as not
  Each, because `readLinesSoldInEach` looks the seed key up on the live unit row; the unit a product
  with no stored unit reads as cannot be deleted, so only such a stored unit is affected. A line with
  no recorded context but a unit recorded on it prints that unit, so its entries print as sold.
  **Kept as they are, by the owner's choice (2026-09-28):** the printed receipt
  (`apps/server/src/receipt-ticket.ts`) and the till's ticket view
  (`apps/till/src/screens/till-ticket-view.ts`) still show the Each unit.

## A656 — tidy the Routes tab and its cell editor

Owner, 2026-10-14, from screenshots of the Santet venue at desktop width and on a phone
([mockups/a656-routes-tab/](mockups/a656-routes-tab/)).

1. **The fallback field's label.** The cell editor (`routing-cell-editor.ts`, the `target`
   combobox labelled `routing.any_other_time`) always says "Any other time", which "doesn't make
   sense if you haven't already added a period routing". With no period route it reads "Station"
   (Spanish needs the owner's wording beside "Estación"); once a route is added it reads "Any other
   time" / "El resto del tiempo". The tests that pin the label (`routing-cell-editor.test.ts`, the
   `[name=target]` case; `routing-grid.test.ts`, the labels the editor offers) follow.
2. **Line the station fields up.** In screenshot 2 the fallback field runs past the right edge of
   the route's Station field, and a route's Station is narrower than its Periods. Both choose a
   station, so their right edges meet, and Periods and Station split a route row evenly beside its
   Remove.
3. **No empty band under a one-line row.** Every cell is `vertical-align: top`, and the label and
   the station button each hold `min-block-size: var(--wt-tap-min)` with padding as well, so a
   one-line row is taller than its text and the spare height sits below it (read in
   `routing-grid.ts`, not measured). Keep a row a tap target tall, but either centre a one-line row
   or stop the padding adding to the minimum. A cell with period lines (screenshot 4, "Kitchen /
   Open: Bar / Lunch: Front bar") is the case that must still read from the top. The open entry "A
   long word in a routing-grid row name still splits at 390 px" works on the same label cell.
4. **One Expand/Collapse button, right of a full-width search.** Today `.toolbar` wraps and
   `.toolbar wt-input` carries a `max-inline-size`, so on a desktop the search stops short and on a
   phone the two buttons drop to a second row. One button, "Collapse all" while every category is
   open and "Expand all" otherwise (`wt-data-table`'s `expandAllLabel` and `collapseAllLabel`
   behave this way; the grid is drawn by hand, so it copies the behaviour rather than switching it
   on), stays to the right of the search box at every width, and the search box takes the rest of
   the row. A584's Period field already sits after the search box; the tidy keeps it there.

## Decisions and deliberate limits

- **The till's Join that pushes tables together reads what was sent from the target group's
  tables, as the floor plan's merge does (A704, owner 2026-10-15).** A counter order
  delivered to a table already in the group, whose place becomes the group's name, gets a MOVED
  slip ("From: Table 9 / To: Fiesta"); so does a party seated at one of those tables, only when
  its place changes. Both routes hand `withMovedSlips` the two tables and the target's group
  (`apps/server/src/moved-slips.ts`). The owner turned down keeping the two routes different.

- **The party's name prints on every kitchen ticket, as on MOVED slips (A683, owner 2026-10-14).**
  A named party's tickets read `Order 5 · Ana` / `Pedido 5 · Ana`, so the cook meets the name on
  the first ticket; a merged party's read the name of the party it ended up in, and an unnamed
  party's or a counter order's print the bare number. Picture 5 in
  [the A650 mockups](mockups/a650-moved-slips/).

- **A prep station's Times tab draws one track per department that sends it orders (A688, owner
  2026-10-14, mockup 2 of question A2 of A506-12).** A key above the grid names the rows in
  department order ("Rows: Restaurant · Bar"), and hovering a range names its period and
  department. A department with nothing on a date that another department fills draws an empty
  track; a date with nothing at all reads "No orders" once. A station one department feeds keeps
  one track and no key. The owner turned down one bar holding every range (two ranges at the same
  time hid each other) and one bar with a label naming both where times overlap. Mockups:
  [mockups/a506-12-times-overlap/](mockups/a506-12-times-overlap/).

- After approval the owner ruled that a dish made at the till is never held and the till lists
  what to make ("Make now").

- **The Routes grid blanks a zone cell only where it repeats the row's own Every zone (A507, owner
  2026-10-11, option A).** A zone cell with nothing set on the row is blank when what it inherits —
  station and period lines — is the row's own Every zone, and otherwise shows the inherited station
  in grey italics. The owner turned down blanking every inherited zone cell (option B): a category
  under one that sends Front Bar to Bar would then read as going to Kitchen from Front Bar.
  Mockups: [mockups/a507-prep-stations/](mockups/a507-prep-stations/).

- **A row's own Every zone beats a parent's setting for one zone (A507, owner 2026-10-11).**
  CLANDESTINA sets Every zone to Kitchen, so its Front Bar goes to Kitchen although Santet Deli Co
  sends Front Bar to Bar. The owner accepted it because the Routes grid makes it visible: CLANDESTINA's
  Front Bar cell is blank under its own Every zone.

- **A routing cell's period lines are written out under its station (A507, owner 2026-10-11,
  option 1)**, one per line in smaller text, in the station's style. The owner turned down a
  "+1 period" marker with the lines on hover (option 2: a scan for one station needs hovering) and
  the lines after the station on one line (option 3: crowds narrow columns).

- **The Routes search differs on purpose from the Products and Menu Structure search (A507, owner
  2026-10-11).** Those list matches flat with inline paths (A461, `catalogue.md` → _Decisions_);
  the Routes grid shows each match under every category above it, because those rows carry the
  stations being inherited.

- **A product's own routing choice never asks (A507, owner 2026-10-11).** What changes is the
  product clicked, its own variants and the extras that move with it as their dish, which the
  person already chose. It saves at once; a category, All categories or No category choice that
  moves products still opens the "Review route change" notice.

- **Prep station colours and the Routes grid's painting (A584, owner 2026-10-13).** The owner's
  decisions: (1) a station picks its colour from a larger set than the six menu periods use ("offer
  a bigger set than the periods use"); (2) every cell of the Routes grid is coloured, and a cell
  that follows its row's Every zone takes that station's colour but still writes no name; (3) with
  "All periods", each period line under a station gets a dot in the colour of the station it sends
  to; (4) with one period chosen, a cell shows only that period's station, with no "otherwise …"
  line; (5) the Period dropdown sits beside the search and always opens on "All periods", not
  remembered. The station editor board (twelve colours, a used colour still offered with its
  station's name under it, a new station starting on the first unused colour) was shown and not
  objected to. The colour is `kitchen_stations.colour` in the core set (`packages/db`),
  because `kitchen_stations` is core's table; it has no CHECK,
  because a CHECK makes drizzle rebuild `kitchen_stations` and a rebuild deletes its cascading
  children's rows (a reviewer added one in a scratch worktree and `db:generate` produced
  `__new_kitchen_stations` five times), so the station routes and the configuration import refuse a
  colour outside the twelve, and a stored one outside them draws unpainted. With one period chosen,
  a cell that A507's rule leaves blank is named, in the "differs" style, when its station for the
  period differs from its row's Every zone's saved station for the period. "Always opens on All
  periods" is read as each time the page opens: the choice is the grid's own state, never written to
  the address or to storage. Mockups:
  [mockups/a584-station-colours/](mockups/a584-station-colours/).

- **A prep station set not to print MOVED slips still shows the moved notice on its kitchen screen
  (A650 question C, owner 2026-10-14: the default kept).** The venue's Print MOVED slips switch and
  a station's own MOVED slips choice decide paper only. Plan:
  [2026-10-14-a650-moved-slips-design.md](../superpowers/plans/2026-10-14-a650-moved-slips-design.md) §6.
