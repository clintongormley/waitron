# The kitchen and preparation — detail

The open entries are listed in [the backlog](../backlog.md), under "The kitchen and preparation". This file holds
their full text.

## KDS operations — low priority (A9)

Order routing is built (item→station, station→printer, receipt→printer). Gaps: a routing audit
view (a routing cell keeps no record of who changed it or when — the most useful to close); no
station `type`/`kind`; single-target only (no fan-out or per-modifier rules; period choices came
with A366 slice 4). Venue-made table statuses were retired by A757 slice 2 (2026-10-19); kitchen
statuses are partial — preparation mode is a fixed enum, and a user-definable kitchen-status list
does not exist.

## Task 5 (#750, kitchen, pass and table screen by group; printing problems)

Left open:

- A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
- A switched-off printer's printing problem keeps showing until the printer is switched on
  and a Reprint prints there; there is no way to dismiss one.
- A failed ticket on a pass printer (one ticket for the whole order) shows on the card of
  every station it covered, even where that station's own printer printed; it stops showing at
  a station once a Reprint of the bill would not link that pass printer to that station.
  (`apps/server/src/print-problems.test.ts`).
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
- Every pass press moves the party's revision, so a waiter's open table screen meets
  `party.out_of_date` after it and reads again.
- Setting up a venue from an imported configuration deletes every kitchen station, and the
  `kitchen_print_jobs` station key has no delete rule; whether that venue can already hold
  link rows at that point was not tested (read, not run).
- The pass's Ready records no `order_group_events` row, so who pressed them is
  recorded nowhere readable; a new kind changes that append-only table's check, which is a
  core migration.
- The till's ordinary table refresh (`#loadTabLines` and the other groups reads in
  `apps/till/src/till-app.ts`) can let an older read that answers last replace newer order groups
  and current orders; A809 (#2153) fixed this for the printing-problems notice only, with a
  per-read number. Believed to predate A809 (`git blame` 2026-09-27); not traced further.

## Task 6 (#761, HOLD tickets in advance)

Left open:

- A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem",
  like every correction slip: none is recorded in `kitchen_print_jobs`.
- A printed HOLD ticket goes stale when held groups are reordered or a party is merged into
  another (both renumber `GROUP n`). Only a FIRE ticket or a Reprint can be relied on.
- A group's HOLD paper is recorded per station, not per printer
  (`order_group_hold_stations`), so a correction to a station whose printer changed after its
  HOLD ticket prints on the new printer, which never had that ticket (`printCorrectionSlips`
  reads the station's current printers; read, not run).

## KDS corrections deferred from #191

- **KDS corrections deferred from #191** (owner, 2026-09-01): a moved dish must keep its kitchen
  status — the ticket must travel with the line, not re-fire (`moveTabLines`, which dropped it, was
  deleted by service plan Task 13; whether this still holds for the paths that move lines now is not
  checked); hold-on-send without courses plus a venue disable setting; FP-1's empty-named
  child-modifier row; a device-scoped collect route. Then the low-priority KDS list under
  [KDS operations](../backlog/kitchen.md#kds-operations--low-priority-a9).

## Mark a new dish as urgent

- **Mark a new dish as urgent** (owner, 2026-09-27). A waiter can already send a new dish straight
  to the kitchen ("cook this now, don't hold it") under every release setting; the owner would like
  a way to add urgency to it too, so the kitchen sees it flagged. Nothing like it exists today. Not
  designed: what the flag looks like on the kitchen screen, the pass and a printed ticket, and who
  may set it. A773 assigns requests to cook held work to the waiter.

## The dark-screen alert can be wrong

- **The dark-screen alert can be wrong** (S2b, owner, 2026-10-01). A kitchen working from paper
  may never mark dishes ready on its screen. With that screen switched off, each send can raise
  the dark-screen alert for up to an hour while those dishes remain waiting. A kitchen screen
  opened through the dev stack's device chooser never records a check-in: the override returns
  before the cookie path updates `lastSeenAt` (`readDeviceProof` in `apps/server/src/device-session.ts`).
  Improve how the alert distinguishes a kitchen using paper and how the dev chooser records check-ins.

## Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it)

The counter's prep-queue card shows no notices and does not refresh. The till's API client has no
general request timeout (only the kitchen refresh and menu-state reads are bounded, at 25 seconds,
and a table's round sends and offer reloads, at 150 seconds). A refusal that lands after the tab
is paid, or after a server switch, shows the ordinary unnamed message. The kitchen screen's list
of stations is read only when the screen opens, so after that read fails the out-of-date banner
stays, counting, until the screen is opened again; long outages are counted in minutes, never
hours.

## A1066. Four server test files mark a HOLD ticket printed without recording a station

`party-allergy.restart`, `party-allergy.submit`, `party-arriving-dishes` and `kitchen-print` write a
group's HOLD stamp straight to the row, without recording any station in
`order_group_hold_stations`. They pass in CI; nobody has checked whether what they assert still
depends on HOLD paper reaching a station. `line-service-projections.test.ts` failed for this reason
and now records its stations. Left open by A756 PR 6's review.

## Routing reads do work only one screen uses

- Left open by A366 slice 4 Part A's review:
  every read of the routing model works out each period's products (`readRoutingPeriods`,
  `packages/venue-service/src/routing-periods.ts`), which only the routing cell editor needs, so the
  catalogue's folder read pays for it too; and the Opening hours model reads every period's routing
  uses (`readRoutingUses`, `packages/venue-service/src/menu-timetable.ts`), re-read on any product
  or category change, though since A506-11 nothing reads the model's copy: the period delete dialog
  reads its own through `GET …/menu-periods/:periodId/delete-impact`. Work each out only where it is
  used.

## A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits

- **A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits
  (2026-10-15; open, owner decision).** When a waiter edits a sent dish, the till deletes its
  kitchen items and sends replacements. The dish keeps its earlier made-here choice
  (`keepMadeHere`, `apps/server/src/working-order.ts`), but its extras are routed afresh in
  `insertSplitExtras`, which reads the made-here stations of the sending device. So an extra the
  Quesos station already received can come back as made on the spot when a device that makes
  Quesos itself does the edit. Found by A687's review (#1720); its fifth case in
  `apps/server/src/sent-order-number.test.ts` relies on this behaviour and will fail if it
  changes. Decide: should extras keep their earlier choice, as the dish does?

## A930. The manager's overdue report counts a held dish as late

Left open by A757 slice 3. The manager overview's "orders taking too long" list
(`computeOverdueOrders`, `packages/reporting/src/overdue-orders.ts`) reads every unserved ticket item
of its node that is not made here, on an order neither abandoned nor collected; its `where` has no
`fired_at` test, so a dish waiting in a held group ages from when it was taken. Since A757 slice 3
`timingBand`, like the `long_wait` signal before it, counts only fired dishes (`ticket_items.fired_at`
set; A757 Q17). The report also ages a dish waiting for the pass from `queued_at`, which is still its
insert until the pass fires it, while the pass's board ages it from `requested_at` (A773-2 B4a, its
plan's D68).

Next: decide whether the report leaves held dishes out, as the floor does. If it does, add a
`fired_at is not null` test to its `where` and a case beside `overdue-orders.test.ts`'s.

## Supervisors have no dashboard path to a prep station's times

- **Supervisors have no dashboard path to a prep station's times** (ASK A1 of A506-12). The times
  show in the Calendar's Show picker, offered only to someone with `venue.configure`: a
  read-only Calendar offers no stations. The stations service-times route still lets `venue.view` read them (`routes.ts`). Owner to decide whether a
  supervisor gets a read-only view, which would now mean offering stations in a read-only
  Calendar's Show — left open by A506-12.

## The earliest fire time is picked by comparing the stored times as text

- Left by C78's review: the earliest fire time is picked by comparing the stored times as text,
  right only while every writer stores the same `toISOString()` form (every writer found uses
  `nowIso()`; not proven for all). Left open by the table actions plan's Task 9 (#874, dishes arriving in a
  party get a kitchen group).

## `GET /management-api/stations/outputs-down` and the dashboard's `listOutputsDown` have no caller

- Found while removing the Stations tab's health read (A366 slice 4 decision 34): the
  route (`apps/server/src/management-api.ts`) and the client method
  (`packages/venue-service/src/dashboard/routing-client.ts`) are called only by their own tests.
  Decide whether to remove them or use them; slice 4 Part A leaves both.

## A selected tab that grows while its strip keeps its width is not scrolled back into view

- (`packages/ui/src/components/wt-tabs.ts`) — left open by A487a (#1540): a late font load or a
  longer label can leave it cut at the strip's edge, and `main` before #1540 behaved the same. Since
  #1540 the fade is resized when the tab grows; scrolling it back was not added because doing so
  broke the "leaves a strip the reader scrolled where it is when only its height changes" case.

## A1080. Owner question: which refusal wins when one save holds a started dish and a dish at a "Not allowed" station.

Within one dish `ticket.already_started` is checked first (a bare raise of a started dish is not refused as started, A1382), but across a
save the answer can be `ticket.already_fired` (found by #2044's second Codex review, not called a
bug). Decide whether "started first" should hold across the whole save
([rule](#changes-after-sending-every-part-of-a-dish-decides-and-removal-is-not-gated-a756-pr-8-2026-10-24)).

## A1139 — A kitchen card in Ready keeps ageing (2026-10-27; open, owner question)

- A card whose
  dishes are all Ready keeps its minutes and band, so after a quiet hour it reads "277 min" and
  pulses as forgotten, while the header line's "late" leaves it out (A797 slice 8, D9). Before slice
  8 the Ready column's dishes carried the age border too. Should a Ready card stop ageing, age from
  when it became Ready, or is it enough that a cook can collapse Ready to a strip that draws no
  cards (slice 9)? Seen in A797 slice 8's LOOK.

## A1368. A dish waiting for the pass whose HOLD ticket printed, moved to the counter, still gets no MOVED line and no FIRE mark

**A1368. A dish waiting for the pass whose HOLD ticket printed, moved to the counter, still gets no MOVED line and no FIRE mark (left open by A1327, #2502).** The dish is one whose HOLD ticket has printed, which
the waiter then fired at a station that waits for the pass, and which the pass has not yet
released. When its bill goes to another table or another bill, the MOVED slip lists it and its
release is marked FIRE; moving the bill to the counter does neither:

- `moveBill`'s counter branch and `moveSettledBillToCounter` (`apps/server/src/move-bill.ts`) leave
  the bill's dishes with no group;
- the pass then releases the dish by its bill, not a group (`apps/server/src/pass-card.ts`);
- the record of which stations have a group's HOLD paper is per group (`order_group_hold_stations`).

The fix proposed is a per-dish record of HOLD paper, which is a schema change, held by A1308 until
A760 lands.

The two "A1368" cases in `apps/server/src/waiting-course-copy.test.ts` pin both counter paths. The
kitchen screen differs between them: `moveBill`'s counter branch gives it a `moved` notice for the
burger only, while `moveSettledBillToCounter` gives one for the tarta as well, with the slip still
listing only the burger.

The owner chose to fix it (2026-11-06): a cook is not left with two tickets for one dish. It lands
in A1308's orders and sales slice, which rebuilds the table anyway.

## Bundle: What a kitchen card draws

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **The kitchen screens and the pass still show allergens as text chips.** A668 brings icons to the
  editor, the till's buttons and its order list, not to these screens.

## Bundle: Held paper followups

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1066. Four server test files mark a HOLD ticket printed without recording a station.**
  [Detail](kitchen.md#a1066-four-server-test-files-mark-a-hold-ticket-printed-without-recording-a-station)
- **Loose ends left by service Task 6 (#761, HOLD tickets in advance).**
  [Detail](kitchen.md#task-6-761-hold-tickets-in-advance)
- **A1369. A reprint of a bill's kitchen tickets leaves out a dish waiting for the pass whose HOLD ticket printed (seen in A1327's review, #2502; predates it).**
  The dish is one whose HOLD ticket printed, then fired at a station that waits for the pass and not
  yet released. Reprinting its bill prints only the bill's other dishes: `readReprintParts`
  (`apps/server/src/kitchen-print.ts`) reads held work through `readOnHoldTickets` only. Decide
  whether a reprint lists it, and how it is marked.

## Bundle: Routing model reads

4 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The Opening hours model's `periods[].weekdays` and `routingUses` have no reader left in the
  dashboard**, while `readOpeningHoursModel` still works both out on every read. See also "Routing
  reads do work only one screen uses" — left open by A506-11, #1694.
- **The server accepts a routing period line naming the cell's own plain station**; it routes
  nothing differently (`validatePeriodLines`, `packages/venue-service/src/routing-store.ts`). Left
  open by A366 slice 4 Part A.
- **The period delete warning orders its rows on the server** (`routingRowPlaces`,
  `packages/venue-service/src/menu-timetable.ts`) **with a copy of the Routes tab's row order**
  (`visibleRoutingRows`); a change to one can leave the other behind. Move the order into
  `packages/venue-service/src/routing.ts` and use it from both. Left open by A366 slice 4 Part A.
- **Routing reads do work only one screen uses** — left open by A366 slice 4 Part A's review.
  [Detail](kitchen.md#routing-reads-do-work-only-one-screen-uses)

## Bundle: Supervisor station read

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1079. Owner question: should a supervisor see each station's "Changes after sending"?** The
  Kitchen tab let a supervisor read it (owner, 2026-10-04); since #2044 it lives only in the station
  editor, which needs `venue.configure`. Decide whether a supervisor gets a read-only view
  ([decision note](dashboard.md)). Left open by A756 PR 8.
- **Supervisors have no dashboard path to a prep station's times** (ASK A1 of A506-12).
  [Detail](kitchen.md#supervisors-have-no-dashboard-path-to-a-prep-stations-times)

## Decisions and deliberate limits

### A switched-off course uses Fire now (owner, 2026-10-17; C80)

A dish whose course is switched off follows the no-course rule: Fire now, listed first, whether
you send it or move its bill. This replaces the earlier earliest-listed-course rule in the
[table-actions plan](../superpowers/plans/2026-09-28-table-actions.md).

### A756. The Kitchen tab split up: a Courses page, a department Service tab and an Every station card

**A756 (owner, 2026-10-16) — the owner approved the mock-ups.** The canvas they
were drawn on is [here](https://claude.ai/artifact/GKV4JTKfn1hpbxxoskbpBT) (owner's account only).

**Changed by A773 (owner, 2026-10-16, the same day).** These replace parts of the mock-ups:

- "Who fires held courses" is dropped, not moved to departments.
- There is no "Every station" card: every station setting is set on each station.
- Stations gain "Waits for the pass", and the Courses page gains "Held until fired".
- "Changes after sending" has three values (A773 revision, owner 2026-10-17): no changes; while
  held; while held or waiting. It decides when a sent dish can be recalled.

See [A773's spec §7](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#7-settings--changes-to-a756).
Built by A756 PRs 1–8 (plan `docs/superpowers/plans/2026-10-18-a756-kitchen-tab-split.md`);
"Waits for the pass" belongs to A773-2. `locations.fire_control` is read by nothing and goes with
the `locations` table in A1301 S28, not A773-2: dropping the column alone rebuilds `locations`,
which the upgrade guard refuses (A773-2 PR D plan D113). S28 also deletes the tests that still set
it, in `packages/db/src/schema/kitchen-courses.test.ts`, `apps/server/src/order-groups.test.ts`, `management-api.test.ts`, `till-api.test.ts` and `configuration-import.test.ts`, and `packages/provisioning/src/configuration-transfer.boundaries.test.ts`.

### Add station sets a station's name, colour, printers and late flags only (A756 PRs 6–8)

This records the built default (plans A756 PRs 6–8), not an owner ruling; owner FYI, say if Add
station should offer more. Every other choice starts at its default and is changed in the station editor: one line for
identical dishes, no held printing, MOVED slips printed, one item at a time on the screen, and
changes allowed while held or waiting.
**2026-10-26 (A797 slice 6):** Add station also sets the Ready warning time, 3 minutes by default.

### Held groups keep the switch "Print held groups in advance" (owner, 2026-10-28; A1062)

The station editor keeps its switch. Picture 10's "Held courses: Print when sent / Print when
fired" dropdown (A773) is not adopted.

### Changes after sending: every part of a dish decides, and removal is not gated (A756 PR 8, 2026-10-24)

**2026-11-11:** [R3-owner](../superpowers/plans/2026-11-11-r3-owner-retire-recall.md)
retires Recall and moves every sent-dish removal to Cancel item. The following dated ruling
records the earlier order-edit removal path; the station setting still governs Change dish.

Owner FYIs, built this way; say if any should change. A dish the kitchen has started is refused
first. Since A1382 (owner, 2026-11-07), a bare quantity raise of a started dish is not refused as
started: the extra goes to the kitchen as a new line, and Changes after sending still decides it. Otherwise the dish's own station and the station of each extra routed elsewhere must all
allow the change. A dish with no kitchen record, on it or on any of its extras, can be recalled whatever the
stations allow (A773-1 open
point 4's answer A said so). A "Not allowed" station also refuses changes to a held dish, which the
venue switch allowed through line edits. At a "Not allowed" station, removing a waiting dish or
lowering its quantity through an order edit goes through, as a Void with its notice (with the venue
switch off it was refused); the setting decides only Recall and changes (controller's ruling,
2026-10-24).

### A756 point 1. Courses have their own page under Products and menus (owner, 2026-10-16)

Courses get their own page under Products and menus, because products name them: a list with drag
handles, Add course, and Delete in each row's menu (courses already delete through
`wt-delete-dialog`).

### A756 point 3. Changes after sending and held-course printing are set per station (owner, 2026-10-16)

The switch exists for a printer-only station, which cannot see a change. A dish is believed to go
to exactly one station (routing is single-target, A9), so one station answers whether an item may
change; check that against the code when PR 8 is picked up. **2026-10-24 (A756 PR 8):** checked — a
dish's own work is at one station, its split-off extras can be at others, and every part must allow
the change (plan PR 8 Decision 1).

### A725. Prep stations: up the sidebar, no Times tab or drag handles, colours that differ, a clearer station editor

**Owner decisions, 2026-10-15; implemented 2026-10-17.**

- Prep stations follows Departments and zones in the sidebar. It has Stations and Routes tabs.
  You view planned station times through Calendar's Show picker; its existing
  `venue.configure` permission stays. The supervisor's read-only Calendar question stays open.
- Station lists use names, with the default station in its alphabetical place and its Default label
  retained. Stations have no hand-set order, reorder route or stored order column. Courses and
  zones keep their own order.
  Implementation choice, 2026-10-17: every station list uses the same Spanish alphabetical
  comparison, including accents and ñ, independently of the interface language.
- A new station without an explicit colour takes the first colour unused by active stations,
  falling back to red when all colours are used. Explicit colours stay as chosen, including
  duplicates. Server creation, provisioning, scripts and imports use this rule. Each station row
  shows its colour square.
- Add and Edit use the shared `wt-colour-chooser`, showing other stations that use a colour.
  The Edit window groups its three late-flag fields in one short row under Late flags (minutes),
  followed by one instruction to leave a field blank to use the venue setting. **2026-10-23 (A756
  PR 5):** the minutes are the station's own and required; the instruction is gone. **2026-10-26
  (A797 slice 6):** a fourth field, Ready warning, follows the three, and the Edit window sets the
  four two to a row.
- The Edit switch reads "Also list the order's dishes from other stations", with "On this station's
  tickets and kitchen screen" beneath it. "Print a slip when sent dishes move table" offers
  "Venue setting: Print" or "Venue setting: Don't print", "Print", and "Don't print". Spanish matches.
  **2026-10-23 (A756 PR 6):** the choice is the station's own: Print or Don't print.
- Configuration bundles use version 4. Older exports must be exported again from a compatible
  source; there is no conversion of station-order settings. **2026-10-19:** A757 slice 2 moved the
  export to version 5. **2026-10-21:** A841 slice 2 moved it to version 6. **2026-10-23:** A756 PR 5 moved it to version 7. **2026-10-24:** A756 PR 8 moved it to version 8. **2026-10-26:** A980 S1a2 moved it to version 9. **2026-11-02:** A1301 S17 moved it to version 10. **2026-11-10:** A1308 4a-i moved it to version 13. **2026-11-10:** A1308 4a-ii moved it to version 15.

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
  _(2026-11-04, A803 slice 4b: a bill holding a held course can now move to another table, with its own held copy; it still cannot move to the counter.)_

- **The till's Join that pushes tables together reads what was sent from the target group's
  tables, as the floor plan's merge does (A704, owner 2026-10-15).** A counter order
  delivered to a table already in the group, whose place becomes the group's name, gets a MOVED
  slip ("From: Table 9 / To: Fiesta"); so does a party seated at one of those tables, only when
  its place changes. Both routes hand `withMovedSlips` the two tables and the target's group
  (`apps/server/src/moved-slips.ts`). The owner turned down keeping the two routes different.

- **The party's name prints on every kitchen ticket, as on MOVED slips (A683, owner 2026-10-14).**
  A named party's tickets read `Order 5 · Ana` / `Pedido 5 · Ana`, so the cook meets the name on
  the first ticket; a merged party's read the name of the party it ended up in, and an unnamed
  party's or a counter order's print the bare number.

- **A prep station's Times tab draws one track per department that sends it orders (A688, owner
  2026-10-14, mockup 2 of question A2 of A506-12).** A key above the grid names the rows in
  department order ("Rows: Restaurant · Bar"), and hovering a range names its period and
  department. A department with nothing on a date that another department fills draws an empty
  track; a date with nothing at all reads "No orders" once. A station one department feeds keeps
  one track and no key. The owner turned down one bar holding every range (two ranges at the same
  time hid each other) and one bar with a label naming both where times overlap.
  **2026-10-17:** A725 retires that standalone tab. Calendar's Show picker carries the station
  view, using department names even for a single sending department (A722 Part 3, Decision 10).

- After approval the owner ruled that a dish made at the till is never held and the till lists
  what to make ("Make now").

- **The Routes grid blanks a zone cell only where it repeats the row's own Every zone (A507, owner
  2026-10-11, option A).** A zone cell with nothing set on the row is blank when what it inherits —
  station and period lines — is the row's own Every zone, and otherwise shows the inherited station
  in grey italics. The owner turned down blanking every inherited zone cell (option B): a category
  under one that sends Front Bar to Bar would then read as going to Kitchen from Front Bar.

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
  children's rows, so the station routes and the configuration import refuse a
  colour outside the twelve, and a stored one outside them draws unpainted. With one period chosen,
  a cell that A507's rule leaves blank is named, in the "differs" style, when its station for the
  period differs from its row's Every zone's saved station for the period. "Always opens on All
  periods" is read as each time the page opens: the choice is the grid's own state, never written to
  the address or to storage. **2026-10-17, A753 point 1:**
  periods gained thirteen colours, retiring decision (1)'s "bigger set than the periods use".
  **2026-10-17, owner's A725/A783 decision:** stations use the same shared palette as periods,
  staff roles and seasons. A725 adopts the current shared list; A783 expands it to sixteen and
  changes the shared chooser layout. The historical twelve-colour board does not set today's palette.
  **2026-10-18, A783:** stations, periods, staff roles and seasons take the sixteen.

- **A prep station set not to print MOVED slips still shows the moved notice on its kitchen screen
  (A650 question C, owner 2026-10-14: the default kept).** The venue's Print MOVED slips switch and
  a station's own MOVED slips choice decide paper only. Plan:
  [2026-10-14-a650-moved-slips-design.md](../superpowers/plans/2026-10-14-a650-moved-slips-design.md) §6.
  **2026-10-23 (A756 PR 6):** the venue switch is gone; the station's own choice decides paper alone.

- **Each is decided by the unit's identity.** **Kept as it is, by the owner's choice
  (2026-09-28):** the till's ticket view (`apps/till/src/screens/till-ticket-view.ts`) still shows
  the Each unit. The printed receipt prints an Each count bare since A663 Part 2 (owner,
  2026-10-15).

- **A party kitchen-note change prints one slip per affected printer and one notice per station,
  listing its affected bills (owner, 2026-11-06, A1378).** Acknowledging the notice covers every
  underlying bill row. Independent counter orders and other parties stay separate. This replaces
  A807's per-bill presentation; each row retains its original bill attribution.

- **Kitchen paper uses the saved venue zone; a reprint keeps the earliest send and separate reprint
  times (owner, 2026-11-06, A1378).** Whole quantities print without a zero fractional suffix;
  fractions keep their supplied precision. A divider ends a late-send run before an unmarked dish.

- **FIRE marks only station sections whose HOLD paper was recorded (owner, 2026-11-06, A1378).**
  A station getting its first paper stays unmarked on a shared printer's ticket.

- **Correction paper carries the current surviving party's name (owner, 2026-11-06, A1378).**
  Naming, renaming or clearing a party with outstanding printed kitchen work sends one identity
  slip per affected printer, with the old/new names and affected order numbers. Served, collected,
  abandoned, made-here-only and never-printed held work receive no name-change paper. Independent
  counter orders do not take the party's name merely because they are delivered to its table.

- **MOVED uses the station's combined/separate choice (owner, 2026-11-06, A1378).** Identical whole
  portions combine only within their group; measured and printed-as-sold items stay separate.

- **Dishes that arrive in a party get a kitchen group at the receiving party (P16, owner,
  2026-10-17: kept).** Spec §15's "leaves with them outside any group" is read as the side the bill
  leaves; the receiving party groups the dishes (the table actions plan's Task 9, #874).

- **A doneness answer prints as an indented `+` sub-line on the kitchen ticket (owner,
  2026-10-17: fine as built).**
