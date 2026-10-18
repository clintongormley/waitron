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
    button that works (each is refused `party.not_open`). Designed in A758 §3.8 (2026-10-18):
    Finish table asks first, the paid receipt gains Cancel items… with A773-1's keep-the-payment
    and refund choices, and the card says Table finished. Waits for the owner's Q40 and for
    A773-1.
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
  - The table screen's second request for printing problems is A809; which held groups the
    kitchen and pass screens offer Fire on is A773's (owner, 2026-10-17).

## Task 6 (#761, HOLD tickets in advance)

- **Task 6 (#761, HOLD tickets in advance).** Left open:
  - A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem",
    like every correction slip: none is recorded in `kitchen_print_jobs`.
  - A printed HOLD ticket goes stale when held groups are reordered or a party is merged into
    another (both renumber `GROUP n`). Only a FIRE ticket or a Reprint can be relied on.
  - Whether a group's HOLD ticket was queued is recorded per group, not per station, so a
    correction, and a Reprint's REPRINT and HOLD section, can print at a station whose printer
    never printed that group's HOLD ticket.

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

## A756. The Kitchen tab split up: a Courses page, a department Service tab and an Every station card

**Changed by A773 (owner, 2026-10-16, the same day).** These replace parts of the mock-ups below:

- "Who fires held courses" is dropped, not moved to departments.
- There is no "Every station" card: every station setting is set on each station.
- Stations gain "Waits for the pass", and the Courses page gains "Held until fired".
- "Changes after sending" has three values (A773 revision, owner 2026-10-17): no changes; while
  held; while held or waiting. It decides when a sent dish can be recalled.

See [A773's spec §7](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#7-settings--changes-to-a756).

**A756 (owner, 2026-10-16) — the owner approved the mock-ups.** Mock-ups:
[where each setting goes](mockups/a756-kitchen-settings/01-where-each-setting-goes.png),
[Courses page](mockups/a756-kitchen-settings/02-courses-page.png),
[department Service tab](mockups/a756-kitchen-settings/03-department-service-tab.png),
[Prep stations](mockups/a756-kitchen-settings/04-prep-stations-every-station.png); the canvas they
were drawn on is [here](https://claude.ai/artifact/GKV4JTKfn1hpbxxoskbpBT) (owner's account only).
After A725, which changes the same station editor.

Every setting on Venue settings' Kitchen tab is stored once for the venue today: bump mode and
fire control on `locations` (`packages/db/src/schema/tenants.ts:84-85`); late flags in
`kitchen_timing_defaults`, which a station may override in `kitchen_station_timing`
(`packages/db/src/schema/kitchen-timing.ts`); and `service_settings`
(`packages/venue-service/src/schema/settings.ts`) — `edit_sent_lines`, `kitchen_ticket_grouping`,
`print_held_work`, `print_moved_slips` (a station may override it), `release_reminder_minutes`, and
`clearing_workflow`, which is A757's. Moving them to departments and stations is a migration; before
go-live nothing is carried forward.

2. **The department dialog becomes tabbed — Details, Service, Receipts, Transfers.** Details,
   Service (with its "Orders and payment" section) and Transfers landed in A756's first pull
   request (#1852). Still left: the Receipts tab, into which receipt editing
   (`apps/dashboard/src/screens/department-receipt-dialog.ts`) moves while the departments table's
   Receipt link (`packages/venue-service/src/dashboard/departments-list.ts:215-226`) goes; and
   Service's "Courses and the kitchen" section, holding the reminder to send the next course
   (who sends a held course is dropped, per the A773 block above). A757 adds its optional table
   states to Service.
3. **Prep stations gets an "Every station" card**, and each setting on it can differ per station:
   late flags; done on the screen (today's bump mode: one item at a time or the whole ticket);
   identical dishes on a ticket; held courses (print in advance marked HOLD, or when sent); MOVED
   slips; changes after sending. The stations table gains a "Differs from every station" column.
   **Changes after sending and held-course printing are per station** (owner, 2026-10-16): the
   switch exists for a printer-only station, which cannot see a change. A dish is believed to go
   to exactly one station (routing is single-target, A9), so one station answers whether an item
   may change; check that against the code.
4. **The Kitchen tab goes.**

Wording: in the mock-ups a station's inherited choice reads "Same as every station". A725 point 6's
"Venue setting: Print" was chosen when the default lived on Venue settings; the owner is asked to
confirm the new wording when A756 is picked up.

## Left by C80: a dish whose course the till does not list

**Owner, 2026-10-17:** a dish whose course is switched off is treated as a dish with no course
(Fire now, listed first, as A773's design says), whether sent or moved. Relayed to A773; delete
this section once A773 covers it. The reading below is what A773 has to change.

- Left by C80 (read from `draftSections` and `groupArrivingDishes`, not compared with a running
  till): the till files a dish whose course it does not list (an inactive course) under the earliest
  course it lists, while a move keeps it in its own held group; and when a round is SENT,
  `working-order.ts` picks its earliest course without checking whether it is active, so with a
  switched-off course the send path and the move path can file a dish with no course under different
  courses (owner, 2026-09-29: not queued). Left open by the table actions plan's Task 9 (#874,
  dishes arriving in a party get a kitchen group).

  **2026-10-10 update:** A435 step 5 now shows saved drafts in their recorded course section and
  fired lines with their recorded label, even with no active courses. The C80 reading above is
  historical; its move/send comparison remains unverified here.

## A long word in a routing-grid row name still splits at 390 px

- **A long word in a routing-grid row name still splits at 390 px** — since A507 part 2 a name
  breaks between words where each word fits ("AGAVE", "Café con / leche" stay whole), but a word
  wider than what is left of the capped first column beside the indent and the arrow still breaks
  inside itself ("BOCAD/ILLOS", "CLAN/DESTI/NA" one level down). The column is held at 96 px by the
  phone-width case "at phone width the row label column is capped and the zones take most of the width"
  (`packages/venue-service/src/dashboard/routing-grid.test.ts`). Options: widen the cap, shrink the
  arrow at phone width, or hyphenate (`hyphens: auto` needs a `lang` on the grid or above it; the
  dashboard sets none — `apps/dashboard/index.html`'s `<html>` has none).

## Routing reads do work only one screen uses

- **Routing reads do work only one screen uses** — left open by A366 slice 4 Part A's review:
  every read of the routing model works out each period's products (`readRoutingPeriods`,
  `packages/venue-service/src/routing-periods.ts`), which only the routing cell editor needs, so the
  catalogue's folder read pays for it too; and the Opening hours model reads every period's routing
  uses (`readRoutingUses`, `packages/venue-service/src/menu-timetable.ts`), re-read on any product
  or category change, though since A506-11 nothing reads the model's copy: the period delete dialog
  reads its own through `GET …/menu-periods/:periodId/delete-impact`. Work each out only where it is
  used.

## A695 — Naming or renaming a party after its food was sent prints nothing

- **A695 — Naming or renaming a party after its food was sent prints nothing (2026-10-15; open,
  owner decision).** Since A683 a named party's kitchen tickets read "Order 5 · Ana", but Name the
  party prints no MOVED slip (A650 design, path 17), so a ticket already on the rail keeps the old
  name, or none, while later tickets for the same order carry the new one. Decide: should a rename
  of a party with sent food print a slip? Raised by A683's review (#1724).

## A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits

- **A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits
  (2026-10-15; open, owner decision).** When a waiter edits a sent dish, the till deletes its
  kitchen items and sends replacements. The dish keeps its earlier made-here choice
  (`keepMadeHere`, `apps/server/src/working-order.ts`), but its extras are routed afresh in
  `insertSplitExtras`, which reads the made-here stations of the sending device. So an extra the
  Quesos station already received can come back as made on the spot when a device that makes
  Quesos itself does the edit. Found by A687's review (#1720); its fifth case in
  `apps/server/src/sent-order-number.test.ts` relies on this behaviour and will fail if it
  changes. The review believed it dates from #1013 (`git log -S keepMadeHere`), not checked
  further. Decide: should extras keep their earlier choice, as the dish does?

## Decisions and deliberate limits

### A725. Prep stations: up the sidebar, no Times tab or drag handles, colours that differ, a clearer station editor

**Owner decisions, 2026-10-15; implemented 2026-10-17.**

- Prep stations follows Departments and zones in the sidebar. It has Stations and Routes tabs.
  You view planned station times through Calendar's Show picker; its existing
  `venue_service.manage` permission stays. The supervisor's read-only Calendar question stays open.
- Station lists use names, with the default station in its alphabetical place and its Default label
  retained. Stations have no hand-set order, reorder route or stored order column. Courses and
  zones keep their own order.
  Implementation choice, 2026-10-17: every station list uses the same Spanish alphabetical
  comparison, including accents and ñ, independently of the interface language.
- A new station without an explicit colour takes the first colour unused by active stations at its
  location, falling back to red when all colours are used. Explicit colours stay as chosen, including
  duplicates. Server creation, provisioning, scripts and imports use this rule. Each station row
  shows its colour square.
- Add and Edit use the shared `wt-colour-chooser`, showing other stations that use a colour.
  The Edit window groups its three late-flag fields in one short row under Late flags (minutes),
  followed by one instruction to leave a field blank to use the venue setting.
- The Edit switch reads "Also list the order's dishes from other stations", with "On this station's
  tickets and kitchen screen" beneath it. "Print a slip when sent dishes move table" offers
  "Venue setting: Print" or "Venue setting: Don't print", "Print", and "Don't print". Spanish matches.
- Configuration bundles use version 4. Older exports must be exported again from a compatible
  source; there is no conversion of station-order settings.

The populated predecessor test carries ticket, printer, timing and staffing references through the
native column drop and compares every recorded table value except the retired column. Run
`pnpm --filter @waitron/server exec vitest run src/station-order-migration.test.ts` and
`pnpm exec vitest run scripts/migration-upgrade.test.ts` for this migration's retention checks.

- **Whole-order kitchen notes (A743, owner 2026-10-15).** You can give the kitchen one
  instruction above a counter order or a table party's dishes, alongside each dish's own note.
  It appears on kitchen paper and station/pass screens; later edits and removals use acknowledged
  kitchen notices. The shared order-heading region also belongs to A669's table allergy information.
  Implementation choices and checks: [plan](../superpowers/plans/2026-10-15-a743-whole-order-kitchen-note.md).

- **Routes has no Expand/Collapse control, and closing a category closes everything inside it
  (A726, owner 2026-10-15, replacing A656's one Expand/Collapse button).** A closed category shows
  only the rows with a route of their own below it, at any depth, with their path; opening a
  category under a closed parent still lists all its products. Search fills the toolbar's row,
  sharing it with Period where there are periods; on a phone, Period takes its own row below
  Search. The editor calls its fallback Station (Estación) until it holds a period route, then Any
  other time (El resto del tiempo). Its two route fields share the row evenly, and both station
  fields end together. Clear setting stays red and sits at the left of the editor's bottom row,
  after Cancel; Save is alone on the right — since 2026-10-16 the house rule for every destructive
  action in a form's bottom row ([design-system.md](../developers/design-system.md)).

- **A counter order moved to a table sends its unsent dishes to the kitchen at the move (A660,
  owner 2026-10-15: (C), keep the rule).** A bill entering table service from another service mode
  has its never-sent dishes sent then, as a round is (`adoptZone`, `apps/server/src/move-bill.ts`,
  since #864); five cases in `party-move-bill.test.ts` ("the dishes of an open bill moved between
  service modes") pin it. The owner first chose that the dishes arrive as a held course (A660b),
  then withdrew it after a throwaway patch of that change, measured 2026-10-15, showed three costs:
  the release reminder names only the party's first held course and comes due only once food sent
  ahead of it is served, so a counter order seated at a free table is never reminded about; a
  bill holding a held course cannot move again (`group.held_leaves_party`), so a counter order
  moved to the wrong table could be corrected only by sending its food; and a paid dish could wait
  unsent with nothing prompting anyone, since `finishTable` does not look at held dishes. The same
  run found that holding alone would not do: the dishes need held kitchen items, or the course's
  Send sends nothing.

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
  **2026-10-17:** A725 retires that standalone tab. Calendar's Show picker carries the station
  view, using department names even for a single sending department (A722 Part 3, Decision 10).

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
  [mockups/a584-station-colours/](mockups/a584-station-colours/). **2026-10-17, A753 point 1:**
  periods gained thirteen colours, retiring decision (1)'s "bigger set than the periods use".
  **2026-10-17, owner's A725/A783 decision:** stations use the same shared palette as periods,
  staff roles and seasons. A725 adopts the current shared list; A783 expands it to sixteen and
  changes the shared chooser layout. The historical twelve-colour board does not set today's palette.

- **A prep station set not to print MOVED slips still shows the moved notice on its kitchen screen
  (A650 question C, owner 2026-10-14: the default kept).** The venue's Print MOVED slips switch and
  a station's own MOVED slips choice decide paper only. Plan:
  [2026-10-14-a650-moved-slips-design.md](../superpowers/plans/2026-10-14-a650-moved-slips-design.md) §6.

- **Each is decided by the unit's identity.** **Kept as it is, by the owner's choice
  (2026-09-28):** the till's ticket view (`apps/till/src/screens/till-ticket-view.ts`) still shows
  the Each unit. The printed receipt prints an Each count bare since A663 Part 2 (owner,
  2026-10-15).

- **A whole-order kitchen-note change prints one slip per printer and raises one notice per
  station (owner, 2026-10-17).** The slip lists the affected dishes, and the cook acknowledges the
  notice once per station, replacing A743's default of a slip and a notice per dish. To be built
  as A807.

- **Dishes that arrive in a party get a kitchen group at the receiving party (P16, owner,
  2026-10-17: kept).** Spec §15's "leaves with them outside any group" is read as the side the bill
  leaves; the receiving party groups the dishes (the table actions plan's Task 9, #874).

- **A dish whose course is switched off is treated as a dish with no course (C80, owner,
  2026-10-17)**: Fire now, listed first, whether it was sent or moved. Relayed to lane G for A773;
  A773's spec does not cover it yet.

- **A doneness answer prints as an indented `+` sub-line on the kitchen ticket (owner,
  2026-10-17: fine as built).**
