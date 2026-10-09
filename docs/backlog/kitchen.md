# The kitchen and preparation — detail

The open entries are listed in [the backlog](../backlog.md), under "The kitchen and preparation". This file holds
their full text.

## KDS operations — low priority (A9)

Order routing is built (item→station, station→printer, receipt→printer). Gaps: a routing read-back /
audit view (the station selects are set-only — the most useful to close); no station `type`/`kind`;
single-target only (no fan-out, no per-modifier or per-time rules). Table and service statuses have
full CRUD; kitchen statuses are partial — `bump_mode` and `fire_control` are configurable fixed
enums, but a user-definable kitchen-status list does not exist.

## Task 5 (#750, kitchen, pass and table screen by group; printing problems)

- **Task 5 (#750, kitchen, pass and table screen by group; printing problems).** Left open:
  - A party finished while its food is still on the pass keeps its cards there with no group
    button that works (each is refused `party.not_open`); a question for the owner.
  - "Ready" and "Fired N min ago" on the table screen are the plan's default, not an owner
    decision.
  - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
  - `*** REPRINT ***`, `GROUP n`, `*** HOLD ***`, `*** FIRE ***`, `*** HOLD CHANGED ***` and
    `*** HOLD CANCELLED ***` print in English. Since B11g the extra-cancel slip is the one kind
    whose header word and cancel line follow the server's locale (`WAITRON_TILL_LOCALE`, `es-ES`
    when unset), so by default a held slip reads `*** HOLD CAMBIADO ***`, `GROUP n` and
    `QUITAR:`, mixed on one slip.
  - A switched-off printer's printing problem keeps showing until the printer is switched on
    and a Reprint prints there; there is no way to dismiss one.
  - A failed ticket on a pass printer (one ticket for the whole order) shows on the card of
    every station it covered, even where that station's own printer printed; it stops showing at
    a station once a Reprint of the bill would not link that pass printer to that station.
    _2026-10-01 (slice 3d): the whole-order printer is gone; a watcher's copy is linked to no
    station and shows no printing problem (W23)._
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
    another (both renumber `GROUP n`), and when the party's table moves or is joined, since no
    MOVED slip goes out for held work (`readSentWork`, `apps/server/src/kitchen-print.ts`). Only a
    FIRE ticket or a Reprint can be relied on.
  - Whether a group's HOLD ticket was queued is recorded per group, not per station, so a
    correction, and a Reprint's REPRINT and HOLD section, can print at a station whose printer
    never printed that group's HOLD ticket.

## Is a `+` sub-line enough for a doneness answer on the kitchen ticket?

- **Is a `+` sub-line enough for a doneness answer on the kitchen ticket?** Doneness is a modifier
  the venue adds itself (Task 10); an options answer prints on the kitchen ticket as an indented
  `+ <list kitchen name>: <label kitchen name>` line. **Open, and worth a cook's eye before a real
  service:** whether that is enough for something a cook must not miss, or whether an options answer
  deserves its own prominent form on the ticket. Nobody has watched a real kitchen read one.

## On the Routing tab, the label above the "Where is this made?" time choice is cut

- **Seen in A323's look at the demo (2026-10-07), in files A323 did not change.** On the
  Routing tab, the label above the "Where is this made?" time choice is cut to "W…" ("Cuá…" in
  Spanish) at 1280 and 390 px, in both themes, because the choice is too narrow for it.
  Screenshots:
  `~/waitron-campaign-c/a323-shots/`.

## At 390 px the routing grid's fixed first column takes about 140 of the grid's roughly 310 px

- **Seen in A372's look at the demo (2026-10-07), in files A372 did not change.** At 390 px
  the routing grid's fixed first column takes about 140 of the grid's roughly 310 px, so one
  zone column shows at a time and a saved choice in a zone column is reached only by scrolling
  sideways. In a cell at 390 px, "Downstairs bar" fills its field and its last letter touches
  the dropdown arrow. Screenshots: `~/waitron-campaign-c/a372-shots/`.

## Prep stations' Settings cell saves have the shape A261-4 changed for routing cells

- **Prep stations' Settings cell saves have the shape A261-4 changed for routing cells.**
  `#saveSettingsCell`
  (`packages/venue-service/src/dashboard/prep-stations-screen.ts`) marks the change saved and
  releases its unsaved-changes registration as soon as the save succeeds, before the refresh
  that follows has settled. A routing cell now keeps its registration until that refresh
  settles. Not changed in A261-4.

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

## A till-session station view can bump a dish another station now has

- **A till-session station view can bump a dish another station now has.** The till-session
  `POST /api/ticket-items/:id/advance` route does not check the item's station
  (`apps/server/src/till-api.ts`); the device route does (`apps/server/src/device-api.ts`) and refuses
  `device.forbidden_station`. Until its next 15-second poll, a till's station view can still show a
  moved dish and advance it at its new station. The route predates PF7; moves make this more likely.

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

## Decisions and deliberate limits

- After approval the owner ruled that a dish made at the till is never held and the till lists
  what to make ("Make now").
