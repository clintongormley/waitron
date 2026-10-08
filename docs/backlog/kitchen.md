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
