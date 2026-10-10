# Moving a dish to another station (slice 3c-3) Implementation Plan

> **2026-10-10, A366 slice 4 Part B:** station-hours and configured-fallback contracts below
> describe the earlier implementation. The Station hours page, its editors and storage are
> retired. A closed station follows today's destination, then the active default; a disabled
> station uses the active default. Closing or disabling with unfinished dishes requires their
> disposition. See [the current station contract](../../developers/conventions-data.md#prep-stations-without-authored-hours)
> and [the slice 4 plan](2026-10-08-a366-slice-4-prep-stations.md#part-b--no-station-hours-or-fallbacks-worked-out-times-second-pull-request).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any waiter choose, from the till, where a dish is made before it is sent ("Make at…");
move a dish the kitchen already has, but has not started, to another station, with a slip at the
old station and a ticket at the new one; and, when a held dish is released after its station has
closed, send it where the rules now send it instead of to a station nobody is working at.

**Architecture:** Nothing new is stored on the dish line: "Make at…" is till screens over 3b's
`make_at_station_id`, which sending already obeys. A move is one new till route,
`POST /api/working-orders/:id/lines/move-station`, recorded once per submission through
`runServiceCommand`, which changes the dish's kitchen record (`ticket_items.station_id`) in place
and never the bill's lines on a presented or paid bill. The old station is told the way every
cancel and recall tells it today: a kitchen notice on its screen and a correction slip on its
printers, now of two new kinds ("moved to another station"); the new station gets an ordinary
ticket with one line naming where the dish came from. Release (`releaseHeld` and `sendLines` in
`apps/server/src/working-order.ts`) asks, at one clock reading for the whole release (every bill
of a group included), which held dishes sit at a station that is not open, re-routes those through
the release's one routing snapshot (3c-2's `routingAt`), and prints them at their new station without the FIRE header. A dish that
still has nowhere to go is released at its old station, and the release itself records a dashboard
alert (an incident) naming that station and those dishes.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`, Lit web
components (till; its suites run in real headless Chromium), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§5.3 (its last paragraph, which this slice narrows) and §5.7; the owner's slice 3 split of
2026-10-01 (`docs/backlog.md`, the design entry: "'Make at' on any dish before sending, moving a dish
to another station after it is sent (any waiter), and re-routing a held dish whose station closed
before it was released"), and 3b's S10 and S17 last bullet, which handed these three items to 3c.
**Not in this plan:** moving part of a line (split it first, M8); moving from the kitchen or expo
screens (M17); a Move button for a PAID counter order, which has no line view yet (the route accepts
it; a backlog entry adds the button to B16's list, M9); clearing the old printer's "stuck" alert
after a move (M16); any record of who moved a dish beyond the command record and the notice (M12);
naming, in "Make at", where the rules would send the dish (M1); re-routing a split-off extra's own
kitchen record at release (P3); "Make at" on a stored, unsent dish of a table bill (3b's dead-end
question still covers the one case that matters there); watchers and the whole-order printer (3d).

**Builds after slices 3a, 3b and 3c-2** (`docs/superpowers/plans/2026-10-01-prep-station-rules-slice-3a.md`,
`docs/superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md`, and 3c-2's plan,
`docs/superpowers/plans/2026-10-01-split-off-extras-slice-3c2.md`, branch `feat/split-off-extras`),
and after 3c-1 (`docs/superpowers/plans/2026-10-01-rest-of-order-made-here-slice-3c1.md`, branch
`feat/rest-of-order-made-here`): the amendment of 2026-10-01 reads 3c-1's `ticket_items.made_here`
mark (Tasks 3 and 4). None of them is on `main` today (read 2026-10-01 at `ebaa1f6c5`). Start this
branch, `feat/move-dish-station`, from a `main` that holds 3a, 3b, 3c-1 and 3c-2; if 3c-1 has not
landed when this branch starts, stop and ask, rather than building the made-here parts against a
column that does not exist. **Where this plan says "3a's X", "3b's X", "3c-2's X" or "3c-1's X", read
X in the code, not in that plan: the code is what landed.** The names this plan leans on are, from
the plans: 3b's `VENUE_SERVICE.resolveMakers(tx, cfg, zoneId, productIds, at)` returning a
`MakerOutcome` (`made` / `no_replacement` / `no_station`, 3b plan:937-946), 3b's
`VENUE_SERVICE.stationStates(tx, { locationId }, at)` returning `{ open, isDefault, active, name }`
per station of the venue, switched-off ones included (3b plan:950-957), 3b's
`working_order_lines.make_at_station_id` and `order_draft_lines.make_at_station_id` (3b Task 4,
3b plan:1012-1036), 3b's till dead-end rows (`apps/till/src/widgets/dead-ends-section.ts`,
3b plan:1278-1287) and 3b's
`makeAt` on draft and basket lines (3b Tasks 4b, 4c, 4d). From 3c-2, which lands before this slice
(Structure), Task 4 reuses its one routing snapshot: the seat method `routingAt(tx, cfg, at)`
returning a `MakerResolver` (`makers`, `extraMakers`, `.at`), the internal opener
`routingOnce(tx, cfg, at)` of type `RoutingOnce`, which every release command opens and passes down
(plan-3c2 Tasks 1, 3, 4 and its "Review 2 applied", I4), and its record scope
`onDishesOrTheirExtras` (plan-3c2 Task 2). These names are from 3c-2's plan; the builder uses the
names in 3c-2's LANDED code. Beyond that routing snapshot (to whose `MakerResolver` Task 4 adds one
question) and `onDishesOrTheirExtras`, this plan relies on 3c-2 only for what the shared decisions
sheet fixes for it (X1, X11, X14): a split-off extra has its own `ticket_items`
row on the extra's own child line, linked to its dish by `parent_line_id`; a dish's kitchen work is
its own record plus its split-off extras'; and a dish and its split-off extra name each other's
station on screen and paper, read as the order stands when it is shown or printed. 3c-2 is being
planned in parallel with this one; where its helper or field names matter, this plan says "3c-2's"
and the builder finds the name in the code.

## Decisions for the owner (M1–M24, and the plan's own P1–P13)

The owner settled M3, M6 and M21's behaviour on 2026-10-01 (M21's alert SHAPE is this plan's
default, P8 and P12), and said in M10 ("any waiter"), M13 (a closed
station may be chosen) and M17 ("from the till") what those parts must do. Every other decision is a
default the plan takes; approving the plan approves them.

**Choosing the station before the dish is sent**

- **M1. "Make at…" on any dish not yet sent, for any waiter.** It uses the "make at" station 3b
  already stores on the dish (no new storage). On a table, each dish being ordered gets a "Make at"
  dropdown beside its course dropdown; its first choice is "Where the rules send it", which does not
  say where that is. At the counter, a dish not yet sent gets a "Make at…" button that opens a small
  dialog with the same dropdown.
- **M2. The till learns which stations are open now** from its existing station list
  (`GET /api/stations`), which gains an "open" flag from 3b's station states. It still lists only
  switched-on stations; a closed one is shown as "Upstairs bar (closed)".

**Moving a dish the kitchen already has**

- **M3. The old station is told whenever the dish was sent there (owner).** "Sent there" means: it
  was fired there, or it is held in a group whose HOLD ticket was printed in advance. That is the
  rule every cancel and recall slip already follows. A ticket still waiting to print at the old
  station cannot be withdrawn and will print later, so the slip is needed even then. The slip is a
  new kind, "\*\*\* MOVED TO GRILL \*\*\*" (Spanish when the till's language is Spanish), and the old
  station's kitchen screen gets a new kind of notice, "Moved to Grill". The existing "MOVED" slip and
  "moved" notice mean "moved to another TABLE" and are not reused. The new notice kind needs the
  notices table rebuilt (see Landing).
- **M4. The new station gets an ordinary ticket with one extra line, "From Bar",** and no notice.
- **M5. A held dish moved by hand:** if its group's HOLD ticket was printed in advance, the old
  station gets a HOLD CANCELLED slip and the new one a HOLD ticket (also saying "From Bar");
  otherwise only the station changes and nothing prints.
- **M6. Which dishes can move (owner):** held dishes, and sent dishes still waiting (not started).
  A dish the cook has started, or that is ready, is refused with the code Recall uses
  (`ticket.already_started`). Dishes on a discarded or handed-over order, and dishes already sent out
  of the kitchen or served, are refused too (P2 names the codes).
- **M7. The dish's lateness clock starts again at the new station** (its `queued_at` becomes the
  moment of the move); the time it was first fired is kept.
- **M8. Whole lines only.** To move two of three, split the line first.
- **M9. Any order whose dish is still with the kitchen:** open, presented or paid, table or counter.
  A move writes only kitchen records (the kitchen record, print jobs, notices), never the bill's
  lines on a presented or paid bill, which the database refuses. On the till: a table's sent dishes,
  and a counter order that has been retrieved. A PAID counter order has no screen listing its dishes
  yet; the route accepts it, and a backlog entry adds the button to B16's "paid, not yet handed
  over" list once B16 lands.
- **M10. Who: any waiter (owner).** A signed-in till session is enough; no PIN, as for Recall, Send
  and Fire.
- **M11. The venue's "changes to sent items" switch does not block a move**, because a move does not
  change what is made.
- **M12. Nothing is recorded beyond the command record and the notice** (pre-live).
- **M13. Moving a dish to the station it is already at succeeds and does nothing. A switched-off
  station is refused (`route.station_inactive`). A closed station can be chosen (owner)** and is shown
  "(closed)".
- **M14. One new route**, `POST /api/working-orders/:id/lines/move-station`, body
  `{ submissionId, lineIds, stationId }`, one transaction, recorded once per submission id on the bill
  (`runServiceCommand`), so a repeat returns the first answer and prints nothing again. The till does
  not send the order's revision; the order's revision is moved on so other tills refresh.
- **M15. Codes:** reuse `ticket.already_started`, `station.not_found`, `route.station_inactive` and
  `tab.line_not_found`; add `ticket.not_sent` (the line has no kitchen record: never sent, or a dish
  that needs no preparation).
- **M16. The old printer's "stuck" alert does not clear after a move.** A167 left the same gap for
  dishes moved to another bill. Accepted; one backlog line records both.
- **M17. Not from the kitchen or expo screens (owner: "from the till").**

**Releasing a held dish after its station closed**

- **M18. A held dish is re-routed at release only when its station is not open at that moment**
  (closed by hand, out of hours, or switched off). The rules are asked again for it, per bill and with
  that bill's service zone, at the release's one clock reading — one reading for the whole release,
  so a group spanning several bills (B20) asks "is it open?" once, not once per bill. A station that
  is open keeps its dish even if the rules would now pick another.
- **M19. A held dish whose station a waiter chose is not re-routed**: the cook agreed. "Chose"
  means either 3b's "make at" on the dish, while the dish's kitchen record is still at that station,
  or a move by hand (Task 3), on ANY bill — the move marks the kitchen record itself (P1). Either
  holds while the chosen station is switched on; a switched-off one is routed by the rules, exactly
  as 3b's sending treats it.
- **M20. If the rules now say "no preparation" for a held dish, it stays at its old station.**
- **M21. If nothing can replace a closed station at release (owner), the dish is released at its
  old, closed station, and a dashboard alert says so.** A waiter can then move the dish from the
  till. That BEHAVIOUR is the owner's. The decisions sheet also named the alert's mechanism, an
  ongoing source built on 3b's waiting-dish check; this plan does not follow that part (P8), and what
  the owner gives up by it is listed in P12.
- **M22. The ticket a re-routed held dish gets at its new station is an ordinary one, without the
  "\*\*\* FIRE \*\*\*" header, with the "From Bar" line,** because that station never had the HOLD
  ticket. The old station gets a HOLD CANCELLED slip when its HOLD ticket was printed in advance; a
  dish held by course, with no HOLD ticket, moves silently. (The FIRE header becomes a per-dish
  choice: a re-routed dish prints on its own ticket even at a station that had the group's HOLD
  ticket for other dishes.)
- **M23. A dish with split-off extras moves alone.** Extras that follow the dish move with it
  (they print on its ticket). A split-off extra stays at its own station; its "for Burger at …" line
  names the dish's new station on its screen at once and on anything printed later. Nothing prints
  at the extra's station.
- **M24. The sentences this retires** (CLAUDE.md §1): the kitchen record's "never reroute food
  already sent" (`packages/db/src/schema/ticket-items.ts:24-27`), `fireLines`' "never moves an
  already-fired item" (`apps/server/src/working-order.ts:1133`, or what 3a made of that block), 3b's
  S10 and its Global Constraint, and the design's §5.3 last paragraph are narrowed, or get a dated
  pointer to this slice.

**Choices this plan makes that the decisions sheet does not (approve with the plan)**

- **P1. A move marks the kitchen record as chosen by hand, and, on an OPEN bill, also stores the new
  station as the dish's "make at".** The mark is a new nullable `ticket_items.station_chosen_at`,
  set to the move's time; on any bill, a release keeps a record carrying it at its station while that
  station is switched on (M19). If the station is switched off before the release, a DISH's record
  is re-routed by the rules like any other, and with no replacement it is released there and
  alerted (P8); a split-off extra's record (which P3 lets a waiter move by hand) is never re-routed,
  so it is released there and alerted (P3, P8). A field
  on the record, because a presented or paid bill's line cannot be written (the freeze trigger), and
  no existing field says "a person chose this station": `make_at_station_id` is on the frozen line,
  and `queued_at` is also reset by `sendLines`. The "make at" write on an open bill is for units
  added later, which 3b copies from the dish's "make at" (3b plan:1005-1011); units cannot be added
  to a presented or paid bill.
- **P2. Codes for the refusals M15 does not name**, each an existing code: a discarded order →
  `working_order.not_open`; a handed-over counter order → `working_order.already_collected`; a dish
  sent out of the kitchen (`away_at`), or any part of its line served → `ticket.already_started`,
  whose description is widened to say so. Not a new code each. The till's shared words for three of
  them misfit a move (`ticket.already_started` ends "You can cancel it", wrong for a served dish;
  `working_order.not_open` says "presented, paid or discarded", though a move is allowed on presented
  and paid bills; `working_order.already_collected` and `tab.line_not_found` have no words at all,
  `apps/till/src/i18n/codes.ts`), so the Move dialog words the move refusals in its own sentences
  (Task 7).
- **P3. The route moves any line that has its own kitchen record, a split-off extra included,** and
  the till offers "Move to station…" on every line it lists with a kitchen record the server would
  accept (a `movable` flag the server computes). Not quite everywhere the route accepts: a Current
  orders row lists a dish's extras with no kitchen part (`order-groups.ts:1112-1123`), so a split-off
  extra on a presented or paid bill that is not the bill on screen has no button. Re-routing at
  release (M18) covers dish records only: a held split-off extra whose own station is not open is
  released there, and the release's alert (P8) names that station and the extra, as it does a
  stranded dish — unless a waiter chose that station for it and it is still switched on (M19). A waiter can then move it by hand
  where a button exists.
- **P4. The till shows where a sent dish is made only inside the Move dialog** ("Grill (now)");
  order rows still show no station.
- **P5. The old station's screen gets the "moved" notice exactly when it would get a slip** (fired,
  or held on a printed HOLD ticket), whether or not it has a printer, as recalls and voids work today.
- **P6. Spanish words:** the slip "\*\*\* PASADO A PARRILLA \*\*\*" (the station's name in capitals),
  the ticket line "Viene de Barra", the screen notice "Pasado a Parrilla" under the kind "Cambio de
  estación".
- **P7. The table's "Make at" dropdown and the counter's "Make at…" button appear only when the
  venue has more than one switched-on station.**
- **P8. M21's alert is RECORDED by the release, not inferred by an ongoing check.** When a release
  leaves a held record at a station that is not open, and nobody chose that station for it (M19),
  it records one incident, `route.released_at_closed_station`, naming the station, the dishes and
  the order, at the release's clock reading. That covers a dish whose rules now answer "no
  replacement", "no default station" or "no preparation" (M20, M21), and a held split-off extra
  whose own station is not open (P3; extras are never re-routed). Why recorded rather than ongoing:
  an ongoing source sees only "a closed station with dishes fired in the last hour still queued",
  which cannot tell the M21 case from dishes legitimately sent before a routine closing (and a
  printer-only station never bumps, so it always has them, 3b plan:1489-1490); the release is the
  one place that knows the dead end happened. It falls under venue-service's existing `route.` claim
  (area `kitchen`, permission `venue_service.manage`, `packages/venue-service/src/alerts.ts:2-4`),
  like `route.dish_not_sent`. It is NOT raised for a station a waiter chose — by "make at" or by a
  move, on any bill (M19, P1) — while that station is switched on, because the cook agreed; a chosen
  station that has been switched off is treated like any other (re-routed, and alerted if nothing
  takes the dish); that also keeps the alert off every send
  path (`fireLines` is untouched). Its limits are P12.
- **P9. A recalled dish sent again (`sendLines`) whose station has closed is re-routed like any held
  dish, silently**: its old station already printed a RECALLED slip.
- **P10. Landing departs from the decisions sheet, deliberately.** The sheet says a generated
  migration that rebuilds a table holding rows makes the plan needs-owner-review. M3 requires one:
  `kitchen_notices` is rebuilt, and holds rows on any box that has served. This plan lands when green
  if that rebuild COPIES every row (as the reviewer measured, and as `0008`/`0012` do), no foreign
  key points into the table, and `scripts/migration-upgrade.test.ts` passes through it. Any other
  shape of generated SQL is still a STOP and needs-owner-review.
- **P11. Once a line has a kitchen record, a request's `makeAt` never changes or clears that line's
  stored "make at"; and units added to a manually moved dish keep the dish's "make at" even if the request says
  `null`. An ordinary sent dish still routes explicitly cleared added units by the current rule.** (Widened on re-check from "a SENT dish": 3b treats a held line, which has a record but no
  `sent_at`, as not yet sent, where `null` clears, 3b plan:1161-1167. A move, not a "make at", is how
  a recorded dish changes station.) 3b's rule for `makeAt` on a write is "a string sets it, `null` clears it, an absent key
  leaves it" (3b plan:1160-1161), and units added to a sent dish go on a new line that copies the
  dish's make-at (3b plan:1005-1011), with an explicit `makeAt` on that patch applying to the new
  line (3b plan:1168). A till holding a stale copy of the dish — another till, or this one
  before it re-read — would send `null` and undo P1, sending the added units back to the old station.
  So, for a line with a kitchen record (held or fired), the server ignores any `makeAt` the request
  carries for that line, and on an edit that adds units to a manually moved dish, treats `makeAt: null` as absent for
  the new line; only a station id overrides the copied value (which 3b's "the station has no replacement,
  ask again" retry still needs). A server rule, not a till fix, because a till fix cannot reach
  another till's stale copy. Cost: a waiter cannot ask for the added units "where the rules send
  them" on a manually moved dish; they choose a station instead. **The remaining limit, for
  approval:** the server cannot tell a stale STATION id from 3b's deliberate retry (which sends a
  station the waiter has just chosen), so an explicit station always overrides. Where that could
  bite, read 2026-10-01: the till that moves the dish reloads the order afterwards (Task 9), which
  brings the new "make at" and the current revision. Another
  till's copy read BEFORE the move cannot be saved at all — both order edits require the order's
  revision (`requireEditableOrder`, `apps/server/src/working-order.ts:3530-3556`, used by
  `PUT /api/working-orders/:id`, `till-api.ts:1226-1255`, and by the line patch), and the move bumps
  it (Task 3 step 10), so that till is refused `working_order.out_of_date` and reloads, reading the
  new "make at" P1 wrote. A copy read AFTER the move already holds the new station. So no stale id
  reaches the server through today's write paths; the limit would open only for a future path that
  takes `makeAt` without the order's revision. (The coordinator's ruling asked this paragraph to name
  "another till holding a stale station id" as the open limit; the revision check closes that case,
  so it is stated as closed, with the receipt.)
- **P12. The limits of P8's alert, which the owner accepts by approving it** (in place of the
  sheet's ongoing source, M21):
  - **One open alert per venue.** The incidents table keeps one OPEN incident per till, code and
    sale (`incidents_open_dedup`, `packages/db/src/schema/incidents.ts:49-64`); this one has no sale,
    and every release runs with the server's one till id (every caller of `fireGroup`, `fireCourse`
    and `sendLines` is a `till-api.ts` route passing `deps.cfg`, the `TillConfig` resolved once at
    boot, `apps/server/src/till-config.ts:16-19`; no device route releases anything).
  - **Later dead ends add nothing** while it is open, on any order and any station, possibly for
    days; it names only the first.
  - **It never clears by itself**: moving the dish, or reopening the station, leaves it up until
    someone marks it handled on the dashboard. Then the next dead end records a new one.
  - **The wording says there may be more**, in a sentence of its own (Task 5).
- **P13. A "made here" dish (3c-1) is never moved and never re-routed** (amended 2026-10-01, twice).
  3c-1 keeps such a dish as a kitchen record with a `made_here` mark, and a made-here item is NEVER
  held: whatever would have held it (a later course, a held group, a round sent on hold, units added
  beside a held dish), `fireLines` records it fired at the send's one clock reading and `ready`
  (3c-1 plan, T12, owner). So a made-here record always has a fire time and is `ready`. The till that
  sent it makes it on the spot, so it has no ticket at its station to move. A move of one is refused
  with a new code, `ticket.made_here` (Task 3), and the till never offers Move to station… for one.
  A release never meets one — it reads only held records — and its candidate read still says
  `made_here = false`, as a defence only (Task 4).

## Global Constraints

- **Landing: LANDS when green** (review wave clean and required CI green), like 3b — a deliberate
  narrowing of the decisions sheet's rule, for the owner to approve as **P10**. The sheet makes any
  generated rebuild of a table holding rows a STOP and needs-owner-review; M3 requires one
  (`kitchen_notices`). This plan lands when green provided Task 1's SECOND generated migration is the
  expected `kitchen_notices` rebuild that COPIES every row, no foreign key points into the table, and
  `scripts/migration-upgrade.test.ts` passes through both migrations. The receipts: the review
  (2026-10-01, `main` at `8aa9a4bfe`) generated the two migrations in a throwaway worktree and ran
  them over a `kitchen_notices` table shaped as `0012` leaves it, holding one notice of each of the
  four existing kinds: 4 rows after, a `rerouted` row naming a station accepted, a `rerouted` row
  without one and a `void` row naming one each refused by `kitchen_notices_rerouted_to_ck`. Read
  2026-10-01: no foreign key points INTO `kitchen_notices` (`grep -rn 'REFERENCES \`kitchen_notices\`'
  packages/*/drizzle` found nothing, nor did a search of every `packages/*/src/schema/*.ts`), so the
  rebuild's `DROP TABLE` deletes no other table's rows; no other migration set's trigger body names
  it (the only `drizzle/*.sql` files naming it are venue-service's own); and it carries change-feed
  triggers (every venue-service classified table is a change source,
  `packages/venue-service/src/classification.ts:20-21`), which `applyMigrations` removes before any
  set migrates (`removeChangeFeed`, `packages/migrations/src/apply.ts:69`) and boot reinstalls
  (`installChangeFeed`, `apps/server/src/boot.ts:1277`); the upgrade guard does the same per step
  (`scripts/migration-upgrade.test.ts:157-168`). Task 3's core migration (`station_chosen_at` on
  `ticket_items`) is expected to be one plain `ALTER TABLE … ADD`, as 3b measured for its column on
  `working_order_lines` (3b plan:1022-1025); a rebuild there is a STOP too. If the generated SQL
  differs from that shape (no
  copy, another table rebuilt, a key into it), STOP: the landing rule becomes needs-owner-review. No
  venue reset is expected.
- Every commit: `git commit -s`, message in plain English (owner rule; name files and codes once as
  pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or an ignore
  comment. **Mutation-tested packages touched:** `db` — `packages/db/src/schema/ticket-items.ts` gains
  the `station_chosen_at` column (Task 3) and a comment (Task 10). Task 3 hand-mutates the column, as
  3b's Task 5 did for its index, so the weekly mutation run is not the first to notice. `ui`, `ui-core`,
  `shared` and `fiscal` are not touched. `venue-service`, `server` and `till` have no Stryker config
  (`ls packages/*/stryker.config.json` lists `db`, `fiscal`, `shared`, `ui-core`, `ui`).
- Every colour, spacing, radius and font reads a `--wt-*` token.
- Forms and dialogs follow `docs/developers/design-system.md` → Forms: the dialog's refusal goes at
  the BOTTOM of its body, on its own line, never beside the buttons or in a pinned button bar (owner
  2026-09-30). Every input has a semantic `name`. A Lit `<select>` whose options come from an
  expression marks the chosen option with `.selected` (CLAUDE.md §3).
- Every new string in English AND Spanish: till strings in `apps/till/src/i18n/strings.ts` (its
  Spanish table is typed `Record<StringKey, string>`, so a missing entry fails the typecheck), till
  refusal wording in `apps/till/src/i18n/codes.ts`, alert wording in
  `apps/dashboard/src/i18n/alert-messages.ts`. Printed words follow the till's language (`cfg.locale`:
  Spanish, else English), as the "EXTRA CANCELLED" slip does (`apps/server/src/kitchen-ticket.ts:227-242`).
  Kitchen paper prints each dish by its kitchen name, through `buildTicketItems`, as every slip does
  (`docs/developers/products.md`).
- Error codes name the domain concept. New thrown codes: `ticket.not_sent` and `ticket.made_here`
  (P13). One new recorded
  incident code: `route.released_at_closed_station` (P8), under venue-service's existing `route.`
  claim. Before committing each, grep the siblings (`grep -n '"ticket\.' apps/server/src/errors.ts`;
  `grep -rn '"route\.' apps/server/src/errors.ts packages/venue-service/src/errors.ts`).
- **Writes:** a move and a release re-route change `ticket_items` and add print jobs and notices;
  they write `working_order_lines` only on an order whose status is `open` (P1). The freeze trigger
  `working_order_lines_require_open_parent_update` (core `0053_line_sent_after_close.sql`, re-created
  by 3b with `make_at_station_id` in its column lists) refuses any other line write on a presented or
  paid bill, which is why the rule exists.
- One transaction per request (CLAUDE.md §3): the route opens exactly one `withTransaction`; every
  function below takes a `tx` and opens none; queries on one transaction are awaited in turn, never
  `Promise.all`. **One clock reading per move and per release** (3b's S9): a move reads the clock
  as its first statement; a release uses 3c-2's one routing snapshot (`routingOnce`, opened at the
  release command's one clock reading and passed down through every bill of a group), which this
  plan makes the entry point's first statement and asks for both the stations' states and the
  re-route — no new clock parameter and no second rules load (Task 4).
- `fireLines` stays the only place that ROUTES a new kitchen record (`splitTicketItem`,
  `working-order.ts:3115-3139`, also inserts one, copying its source's whole row — station and
  `station_chosen_at` mark included, because it spreads `...ticket`, `:3131-3137`). Only the move
  (Task 3) and the release re-route (Task 4) change an existing record's station.
- Module boundary: core code reaches venue-service only through the `VENUE_SERVICE` seat
  (`apps/server/src/modules.ts`, contract `packages/module/src/module.ts`). venue-service never
  imports `apps/server` or `@waitron/printing`.
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter @waitron/venue-service db:generate --name <name>`; READ every generated file. The
  migration number in this plan is illustrative; the generator picks the next free one.
- Browser suites: check `memory_pressure | grep free` and the heaviest processes
  (`ps -axo rss,command | sort -nr | head`) before a browser run; do not start one beside a
  whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

These are the inputs likeliest to hurt a venue. Each is pinned by a test in the task named:

1. **A queued dish moved from Bar to Grill.** Bar's printer gets one slip reading
   "\*\*\* MOVED TO GRILL \*\*\*" with the dish; Bar's screen gets one "Moved to Grill" notice;
   Grill's printer gets an ordinary ticket (no HOLD or FIRE header) with the line "From Bar" and the
   dish; Grill gets no notice. The dish's `queued_at` is the move time and its `fired_at` is
   unchanged. (Task 3)
2. **The same move sent twice, after the dish moved back.** Move A→B with submission `s1`, then
   B→A with `s2`, then the till resends `s1` (as after no answer): the record is still at A, no
   print job, notice or revision is added, and the answer equals `s1`'s first answer (asserted in
   that order, so a missing gate fails first on the station and the counts). Only the record
   can stop that third request printing: without it, the dish is at A, the request names B, and a
   second slip and ticket would print. The same id with another station is refused
   `submission.id_reused`. (Task 3)
3. **A started dish is refused.** A dish Grill marked `preparing` is refused
   `ticket.already_started` and nothing is written: no print job, no notice, station unchanged. So
   is a `ready` one, one sent out of the kitchen, and one with part of its line served. (Task 3)
4. **A held dish on a PAID bill whose station closed with no replacement.** Its group is fired after
   the bill was paid and after Upstairs bar was closed by hand with no fallback: the dish is released
   at Upstairs bar, the release writes no bill line other than the first "sent" stamp, and the
   release records one `route.released_at_closed_station` incident naming Upstairs bar and the dish.
   The same paid bill with Downstairs bar as Upstairs bar's FALLBACK: the dish is re-routed to
   Downstairs bar and the release succeeds with the line's `make_at_station_id` unchanged — the
   case in which a wrong write to the bill's lines would actually be tried, and refused by the
   freeze trigger. (Tasks 4, 5)
5. **A held dish whose station closed WITH a fallback.** Upstairs bar claims Drinks and is closed,
   Downstairs bar its fallback (the rules name Upstairs bar for the mojito, and the walk down
   Upstairs bar's fallback chain reaches Downstairs bar — a re-route asks the RULES for the
   product; it never walks the fallback of whatever station the record happens to be at), the venue printing held work in advance, so the group's HOLD ticket went to Upstairs bar:
   firing the group gives Upstairs bar a HOLD CANCELLED slip and a "Moved to Downstairs bar" notice,
   and Downstairs bar an ordinary ticket with "From Upstairs bar" and no "\*\*\* FIRE \*\*\*" header,
   while a dish of the same group at an open station still gets its FIRE ticket. A group split
   (B20) across an open bill and a paid check, a mojito on each: both move, each bill gets its own
   HOLD CANCELLED slip and its own "From Upstairs bar" ticket. (Task 4)
6. **A closed station the waiter chose is kept, on any bill.** A dish whose "make at" is Upstairs
   bar, closed, sent on hold and released: it is released at Upstairs bar, and no alert is recorded.
   A held mojito on a PAID bill moved by hand to Grill (its line still says nothing; the record is
   marked `station_chosen_at`), Grill then closed with Downstairs bar as its fallback: released at
   Grill, no alert. And the stale case: a record at Grill whose line's "make at" still names Upstairs
   bar, Grill closed, Upstairs bar open → re-routed to Upstairs bar (the rules' choice; a "make at"
   that no longer describes where the record is protects nothing). (Task 4)
7. **A dish with a split-off extra.** A burger at Grill whose chips split off to Fryer is moved to
   Downstairs grill: the burger's record moves, the chips' record stays at Fryer, nothing is printed
   at Fryer, and Fryer's queue shows the chips' cross-reference naming Downstairs grill. (Task 3)
8. **A held dish moved by hand after its HOLD ticket printed.** Upstairs bar gets HOLD CANCELLED and
   the notice, Downstairs bar a HOLD ticket with "From Upstairs bar"; firing the group later gives
   Downstairs bar its FIRE ticket. (Task 3)
9. **One routing snapshot, one instant, across a group's bills.** Upstairs bar open until 21:00,
   Downstairs bar its fallback; a group split across two bills, each holding a mojito at Upstairs
   bar; a clock that moves one millisecond on every reading, starting at 20:59:59.999. Firing the
   group opens 3c-2's routing snapshot once, as `fireGroup`'s first statement (`routingAt` called
   once, 3b's `stationStates` never), and releases BOTH mojitos at Upstairs bar, each stamped
   20:59:59.999. A snapshot opened per bill would read 21:00:00.000 or later and send both mojitos to
   Downstairs bar. (Task 4)
10. **Added units on a moved dish keep the new station.** A burger moved from Bar to Grill on an
    open counter order; the counter then saves the basket with the burger raised by one and
    `makeAt: null` on its line (a stale copy): the added units' record is at Grill (P11). (Task 3)
11. **A split-off extra stranded at release is alerted.** A held burger at Grill (open) whose chips
    split off to Fryer; Fryer closed with no fallback; the group fired: the chips' record is released
    at Fryer, not re-routed, and the release records the alert naming Fryer and the chips. (Tasks 4,
    5)

---

## File structure

**Created**

- `apps/server/src/station-move.ts` + `station-move.test.ts`: `stillMovable`, `moveDishesToStation`,
  `rerouteHeldAtRelease`.
- `apps/server/src/till-api.station-move.test.ts`: the route and the station list's `open`.
- `packages/venue-service/drizzle/00NN_kitchen_notice_rerouted_to.sql` (generated: one column) and
  `00MM_kitchen_notice_rerouted_check.sql` (generated: the table rebuild).
- `apps/server/src/closed-station-alert.ts` + `.test.ts`: `raiseReleasedAtClosedStation`.
- `packages/db/drizzle/00NN_ticket_item_station_chosen.sql` (generated: one column, P1).
- `apps/till/src/widgets/station-choice-dialog.ts` + `.test.ts` + `.a11y.test.ts`: the dialog that
  asks "Make at" (counter) or "Move to" (table and counter).
- `apps/till/src/screens/till-table-order-screen.stations.test.ts` (beside 3b's `.dead-ends.test.ts`).

**Modified (main ones).** Each task lists its own files exactly.

- `packages/venue-service/src/{schema/kitchen-notices,kitchen-notices}.ts`, `packages/module/src/module.ts`
- `apps/server/src/{kitchen-ticket,kitchen-print,working-order,order-groups,till-api,errors}.ts`
- `apps/dashboard/src/i18n/alert-messages.ts`
- `apps/till/src/{api/client,till-app,i18n/strings,i18n/codes}.ts`,
  `apps/till/src/screens/till-table-order-screen.ts`, `apps/till/src/widgets/{basket,card-grid,station-queue}.ts`
- `scripts/schema-constraints.test.ts`, `scripts/alert-codes.test.ts` (`INCIDENT_CODE_SOURCES`)
- `packages/db/src/schema/ticket-items.ts` (a comment), `docs/backlog.md`, the design, the 3b plan

---

### Task 1: A kitchen notice can say a dish moved to another station

**Files:**
- Modify: `packages/venue-service/src/schema/kitchen-notices.ts`, `packages/venue-service/src/kitchen-notices.ts`,
  `packages/module/src/module.ts` (the `recordKitchenNotices` and `listStationNotices` seat types,
  `:410-445` today), `scripts/schema-constraints.test.ts` (the check list at `:393-398`)
- Create (generated, in TWO generations): `packages/venue-service/drizzle/00NN_kitchen_notice_rerouted_to.sql`
  and `00MM_kitchen_notice_rerouted_check.sql`
- Test: `packages/venue-service/src/kitchen-notices.test.ts`, `migrations.test.ts`,
  `schema/schema-conformance.test.ts`, `schema/service.test.ts` (it reads `kitchenNotices`' config at
  `:136`, `:179`)

**Schema** (`schema/kitchen-notices.ts`):

```ts
export const kitchenNoticeKind = enumType(["recalled", "void", "changed", "moved", "rerouted"]);
// in the table:
    /** On a `rerouted` notice, the station the work now belongs to, by name as it was then. */
    reroutedTo: label("rerouted_to"),
// in the constraints:
    check(
      "kitchen_notices_rerouted_to_ck",
      sql`(${t.kind} = 'rerouted' and ${t.reroutedTo} is not null) or (${t.kind} <> 'rerouted' and ${t.reroutedTo} is null)`,
    ),
```

A by-value name, not a station id: a notice copies everything it shows by value
(`schema/kitchen-notices.ts:24-27`), and a key to `kitchen_stations` would be one more constraint for
nothing the screen needs.

**Interfaces** (`kitchen-notices.ts`; the seat in `module.ts` mirrors them):

```ts
export async function recordKitchenNotices(
  tx, cfg, orderId, items, kind: KitchenNoticeKind,
  movedTo: string | null = null,
  direction: KitchenNoticeDirection | null = null,
  cancelledExtra: string | null = null,
  reroutedTo: string | null = null, // NEW: required on `rerouted`, refused on every other kind
): Promise<void>;
// kitchen_notice.invalid { field: "reroutedTo" } when given on another kind or missing on `rerouted`,
// checked beside the `direction` and `cancelledExtra` checks (`:77-86` today), before any read.
// listStationNotices' rows GAIN `reroutedTo: string | null`; its `kind` union gains "rerouted".
```

Update the function's description (`:56-66`) to name `reroutedTo`.

- [ ] **Step 1: Write the failing tests** in `kitchen-notices.test.ts`, beside the `cancelledExtra`
  cases: a `rerouted` notice with `reroutedTo: "Grill"` is listed by `listStationNotices` with
  `kind: "rerouted"` and `reroutedTo: "Grill"`; `rerouted` without it, and `recalled` with it, are
  each refused `kitchen_notice.invalid` with `field: "reroutedTo"` (assert the code and the field,
  never just `Error`); and a raw insert of a `void` row carrying `rerouted_to` is refused by the
  engine (the check, not the function, as the existing `moved_to` case does).
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-notices.test.ts`.
  Expected: FAIL (the kind and the parameter do not exist).
- [ ] **Step 3: Implement** the schema in TWO generations, never one. **Why two:** with the column
  and the check added in one schema change, drizzle-kit writes ONE rebuild whose copy step reads
  `rerouted_to` out of the old table, which has no such column. Commit `756e3bb18` (B11g, which made
  `0011`/`0012` the same way) records it: "Regenerating `0011` as one migration produced a table
  rebuild whose copy step reads `cancelled_extra` out of the old table … `scripts/migration-upgrade.test.ts`
  failed with `no such column`." The review re-measured it on 2026-10-01: the one-shot SQL listed
  `"rerouted_to"` in both the INSERT and the SELECT lists, and running it over a populated
  `0012`-shaped table failed `no such column: "rerouted_to"`; the two-step pair carried all four
  rows.
  1. Add ONLY the column (`reroutedTo: label("rerouted_to")`), then
     `pnpm --filter @waitron/venue-service db:generate --name kitchen_notice_rerouted_to`. READ it.
     Expected exactly: ``ALTER TABLE `kitchen_notices` ADD `rerouted_to` text;``.
  2. Then widen the kind and add `kitchen_notices_rerouted_to_ck`, and
     `pnpm --filter @waitron/venue-service db:generate --name kitchen_notice_rerouted_check`. READ
     it. Expected shape, and the only one accepted (Global Constraints, Landing): `PRAGMA
     foreign_keys=OFF`; `CREATE TABLE __new_kitchen_notices` with every column (`rerouted_to`
     included), the widened `kitchen_notices_kind_ck` and the new `kitchen_notices_rerouted_to_ck`;
     `INSERT INTO __new_kitchen_notices(<every column, rerouted_to included>) SELECT <the same> FROM
     kitchen_notices` (the column now exists in the old table, added by step 1, and is null on every
     old row, which the new check accepts for the old kinds); `DROP TABLE kitchen_notices`; the
     rename; `PRAGMA foreign_keys=ON`; the `kitchen_notices_open_idx` partial index re-created. Any
     other table in the file, a rebuild without the copy, or a key into `kitchen_notices`: STOP
     (needs-owner-review, P10).

  Then the store, the seat types and the description; add `"kitchen_notices_rerouted_to_ck"` to
  `scripts/schema-constraints.test.ts`'s check list in alphabetical place. No test forces that line
  (the re-check ran the guard green without it: the list is a must-exist list, so a missing name is
  simply unchecked); it is what makes a later regeneration that drops the check fail.
- [ ] **Step 4: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-notices.test.ts src/migrations.test.ts src/service.test.ts src/schema/schema-conformance.test.ts src/schema/service.test.ts`,
  then `pnpm exec vitest run scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/append-only-triggers.test.ts`,
  then `pnpm --filter @waitron/venue-service typecheck` and `pnpm --filter @waitron/server typecheck`
  (the seat type changed). Expected: PASS. The upgrade test is the evidence that the rebuild carries
  existing rows (it fails a step that leaves a table holding fewer rows); record its result in the
  commit message. (That the guard sees the one-shot trap is already measured: `756e3bb18`'s run
  failed `no such column` on it.)
- [ ] **Step 5: Commit**: "Kitchen notices: a new 'rerouted' kind names the station a dish was moved to (venue-service adds the column, then rebuilds kitchen_notices for the check, copying every row)".

---

### Task 2: Paper — the "moved to" slip and the "From Bar" line

**Files:**
- Modify: `apps/server/src/kitchen-ticket.ts` (`KitchenTicket` `:39-55`, `formatKitchenTicket`
  `:163-200`, `CorrectionSlip` `:213-225`, `slipHeader` `:238-242`, `formatCorrectionSlip` `:248-285`;
  add words beside `EXTRA_CANCELLED_WORDS` `:227-236`), `apps/server/src/kitchen-print.ts`
  (`planKitchenTickets` `:354-456`, `enqueueKitchenTickets` `:481-492`, `CorrectionChange` `:536-541`;
  add `enqueueStationMoved` beside `enqueueExtraCancelled` `:666-689`)
- Test: `apps/server/src/kitchen-ticket.test.ts`, `apps/server/src/kitchen-print.test.ts`

**Interfaces:**

```ts
// kitchen-ticket.ts
export type KitchenTicket = {
  reprint?: boolean;
  mark?: "HOLD" | "FIRE";
  /** Where this work came from: printed as one line, "From Bar" ("Viene de Bar" in Spanish),
   *  under the time and above any GROUP line. */
  from?: { stationName: string; locale: string };
} & ( /* unchanged */ );

export type CorrectionSlip = { /* unchanged shared fields */ } & (
  | /* the existing six */
  | { kind: "TO STATION"; toStation: string; locale: string }
);
// slipHeader: "TO STATION" → `MOVED TO ${toStation upper-cased with toLocaleUpperCase(locale)}`,
// or `PASADO A …` for Spanish. Printed as `*** MOVED TO GRILL ***` like every header (`:255`).

// kitchen-print.ts
export async function enqueueKitchenTickets(
  tx, cfg, orderId, firedItems: FiredItem[],
  { mark, from }: { mark?: "HOLD" | "FIRE"; from?: string /* the old station's name */ } = {},
): Promise<boolean>;
// `from` reaches `planKitchenTickets`' `head` as `{ stationName: from, locale: cfg.locale }`.

/**
 * Record a `rerouted` notice per item naming `toStationName`, then a slip per item at the item's
 * OLD station (`item.stationId`): `TO STATION` for fired work, `HOLD CANCELLED` for held work on a
 * printed HOLD ticket (an item carrying `group`). Callers pass only items the old station was told
 * about (M3, P5). Call it BEFORE the item's station changes.
 */
export async function enqueueStationMoved(
  tx: Transaction, cfg: TillConfig, orderId: string,
  items: CorrectionItem[], toStationName: string,
): Promise<void>;
```

`enqueueStationMoved` calls `VENUE_SERVICE.recordKitchenNotices(tx, cfg, orderId, items.map(toNoticeItem), "rerouted", null, null, null, toStationName)`
once, then `printCorrectionSlips` twice at most: once with the fired items (no `group`) and
`{ kind: "TO STATION", toStation: toStationName, locale: cfg.locale }`, once with the held ones and
`{ kind: "HOLD CANCELLED" }`. `printCorrectionSlips` (`:701-756`) already sends each slip to every
active printer of the item's station, grouped by paper width and resolution, and skips a station
with no active printer; nothing about it changes.

- [ ] **Step 1: Write the failing tests.** `kitchen-ticket.test.ts`, decoding with the existing
  helpers (`printedLines`, `apps/server/src/testing/decode-ticket.ts:23`):
  - a station ticket with `from: { stationName: "Bar", locale: "en-GB" }` prints "From Bar" after the
    time and before the dish; with `locale: "es-ES"`, "Viene de Bar"; with `mark: "HOLD"` as well, the
    HOLD header and the From line both print;
  - an order-scope (PASE) ticket with `from` prints it under the header too;
  - a `TO STATION` slip with `toStation: "Grill"` prints "\*\*\* MOVED TO GRILL \*\*\*", then the old
    station's name, table, order number, time and the dish; with `locale: "es-ES"` and
    `toStation: "Parrilla"`, "\*\*\* PASADO A PARRILLA \*\*\*";
  - the existing slip and ticket cases keep passing unchanged.

  `kitchen-print.test.ts`, on a real database as its existing correction cases are set up: with Bar
  and Grill each holding one active printer, `enqueueStationMoved` for one fired item at Bar records
  one `rerouted` notice at Bar naming Grill and enqueues exactly one job, on Bar's printer, decoding to
  the `TO STATION` slip; for one held item carrying `group: 2`, the job is a HOLD CANCELLED slip
  naming GROUP 2, and the notice is still `rerouted`; with Bar's printer switched off, the notice is
  recorded and no job enqueued. `enqueueKitchenTickets(…, { from: "Bar" })` enqueues Grill's ticket
  carrying "From Bar" and links it in `kitchen_print_jobs` / `kitchen_print_job_lines` exactly as
  without `from`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-print.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the Spanish/English choice in one place, as
  `extraCancelledWords` (`:232-236`) does: widen it to a `kitchenWords(locale)` table with `changed`,
  `cancel`, `movedTo` and `from`, and keep EXTRA CANCELLED's words unchanged. The station name is
  operator text: it goes through `prepareText` and wraps like every other line. Update the
  `CorrectionSlip` description (`:202-212`) to name the new kind; a `TO STATION` slip has no table
  change and no sign.
- [ ] **Step 4: Run** the same two files and `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Kitchen paper: a 'moved to another station' slip for the old station, and a 'From Bar' line on the new station's ticket, in the till's language".

---

### Task 3: Moving a dish the kitchen already has

**Files:**
- Create: `apps/server/src/station-move.ts`, `apps/server/src/station-move.test.ts`,
  `apps/server/src/till-api.station-move.test.ts`
- Modify: `apps/server/src/till-api.ts` (the route beside `…/lines/recall`, `:2050-2060`; the status
  map `:270-345`), `apps/server/src/errors.ts` (`ticket.not_sent`; widen the descriptions of
  `ticket.already_started` `:621-627` and `working_order.already_collected` `:278-284`, read at
  `107746610`; add `ticket.made_here` beside the `ticket.*` siblings, `:601-627`),
  `apps/server/src/working-order.ts` (`TabLine` `:2617-2660` and `readTabLines` `:2663-2740` gain
  `stationId` and `movable`; and 3b's add-units path in `applyLineEdits`, for P11),
  `apps/server/src/order-groups.ts` (`readCurrentOrders` `:1054-1167`: the row's kitchen part gains
  `stationId` and `movable`), `packages/db/src/schema/ticket-items.ts` (the `station_chosen_at`
  column, P1)
- Create (generated): `packages/db/drizzle/00NN_ticket_item_station_chosen.sql`

**The mark (P1)** (`ticket-items.ts`, beside `awayAt`):

```ts
    // Set when a waiter moved this record to its station by hand; a release keeps it there while the station is switched on.
    stationChosenAt: tsString("station_chosen_at"),
```

Generate with `pnpm --filter @waitron/db db:generate --name ticket_item_station_chosen` and READ it:
expected exactly one ``ALTER TABLE `ticket_items` ADD `station_chosen_at` text;``, as 3b measured
for its column on `working_order_lines` (3b plan:1022-1025) — and as the re-check measured for this
column on 2026-10-01 (`db:generate` in a throwaway worktree gave exactly that line; the migration
guards then passed). A `__new_ticket_items` rebuild is a
STOP: `ticket_items` holds rows on every box that has sent a dish. No trigger names `ticket_items`
(research §A.1, `grep -rniE 'on [`"]?ticket_items' packages/*/drizzle/*.sql` finds index lines only),
so the freeze trigger's column lists are unaffected. `packages/db` is mutation-tested (floor 90):
the hand mutation a string mutant makes — `tsString("station_chosen_at")` to `tsString("")` — is
already caught: measured by the re-check on 2026-10-01, `pnpm --filter @waitron/db exec vitest run`
failed 7 tests in `src/schema/schema-conformance.test.ts` (`ticket_items`) and
`src/schema/ticket-items.test.ts`. Re-run that mutation once the column exists, record which tests
fail in the commit message, and restore.

**Interfaces** (`station-move.ts`; it imports `./errors.js`, CLAUDE.md §3):

```ts
/** Whether a kitchen record may still move to another station (M6): not made here (3c-1's
 *  `made_here`, P13 — always fired and ready), still queued — held or fired, not started — not sent
 *  out of the kitchen, and
 *  nothing of its line served. The till offers the button exactly where this holds (P3). */
export function stillMovable(
  item: { state: TicketState; awayAt: string | null; madeHere: boolean },
  line: { servedAt: string | null; servedQuantity: number },
): boolean;

export interface StationMoveRequest {
  submissionId: string;
  lineIds: readonly string[]; // working_order_lines ids; duplicates collapse
  stationId: string;
}
export interface StationMoveResult {
  revision: number;
  stationId: string;
  /** Each line whose kitchen record changed station, with the station it left. A line already at
   *  `stationId` is not listed (M13). */
  moved: { workingOrderLineId: string; fromStationId: string }[];
}

export async function moveDishesToStation(
  tx: Transaction, cfg: TillConfig, orderId: string, request: StationMoveRequest,
): Promise<StationMoveResult>;
```

**Behaviour**, inside `runServiceCommand(tx, { kind: "bill", workingOrderId: orderId },
request.submissionId, "line.move_station", { orderId, lineIds: [...new Set(request.lineIds)].sort(), stationId }, run)`
(`apps/server/src/parties.ts:590-630`; the adjustments use this scope the same way,
`adjustments-apply.ts:785-790`). Everything below is inside `run`, so a replay runs none of it
(CLAUDE.md §3: a replay reports the original facts; the side effects are gated by the record):

1. One clock reading, `const at = new Date()`, as the FIRST statement of `moveDishesToStation`,
   before `runServiceCommand` and any other `await` (3b plan:973-977 says why: a timer that runs in
   such a gap shifts the reading). `run` uses that `at`.
2. (_2026-10-03: superseded by A238, `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md`: `tills` is gone._) The order, joined to `tills` on `cfg.locationId` as `recordKitchenNotices` does
   (`packages/venue-service/src/kitchen-notices.ts:89-96`): absent → `working_order.not_found`;
   `abandoned` → `working_order.not_open`; `collected_at` set → `working_order.already_collected`
   (P2).
3. The station, from `VENUE_SERVICE.stationStates(tx, { locationId: cfg.locationId }, at)`: absent →
   `station.not_found { stationId }`; `active` false → `route.station_inactive { stationId }`; closed is
   allowed (M13).
4. The lines, one read: `working_order_lines` (id, `working_order_id`, `served_at`,
   `served_quantity`) left-joined to `ticket_items` (id, `station_id`, `state`, `fired_at`,
   `away_at`, `made_here`, the fired quantity via `firedQuantity`, `kitchen-print.ts:519`), plus each
   line's `group_id`. A requested id not on this order → `tab.line_not_found { tabId: orderId,
   lineId }`; one with no kitchen record → `ticket.not_sent { workingOrderId: orderId, lineId }`; one
   whose record is made here → `ticket.made_here { ticketItemId }` (P13; such a record is always
   fired and `ready`, 3c-1 T12, so without this check it would be refused `ticket.already_started`,
   wrongly blaming the kitchen), checked before the next; one where `stillMovable` is otherwise false → `ticket.already_started
   { ticketItemId }`. All refusals come before any
   write. **Only the named lines' OWN records are read** — never 3c-2's "a dish's kitchen work"
   helper, which would add its split-off extras (M23).
5. Lines already at `stationId` are dropped (M13). With none left: return `{ revision: <current>,
   stationId, moved: [] }` — nothing written, revision not moved.
6. Who the old station must hear from (M3, P5): a fired record (`fired_at` set) is a `TO STATION`
   item; a held record whose group's HOLD ticket was printed is a `HOLD CANCELLED` item carrying the
   group's position (`printedHeldGroups`, `order-groups.ts:1212-1229`); any other held record is
   told nothing. Group them by old station, and for each call `enqueueStationMoved` (Task 2) with the
   items for that station and the new station's name from step 3 — BEFORE step 7.
7. `UPDATE ticket_items SET station_id = <stationId>, queued_at = <at>, station_chosen_at = <at>
   WHERE id IN (…) AND state = 'queued'` (M7: `fired_at` kept; P1: the record is marked chosen). Assert the returned row count equals the moving set (writes are
   serialised, so a mismatch is a defect, not a race: throw a plain `Error`).
8. On an order whose status is `open` (P1): `UPDATE working_order_lines SET make_at_station_id =
   <stationId>` for the moved lines. Never on `placed` or `settled`.
9. The new station's paper, one call per old station so each ticket carries one "From" line:
   fired records → `enqueueKitchenTickets(tx, cfg, orderId, items, { from: oldName })`; held records
   whose group's HOLD ticket was printed → `enqueueKitchenTickets(…, { mark: "HOLD", from: oldName })`
   (M5); other held records print nothing. `FiredItem.quantity` is the record's fired quantity.
10. `bumpRevision(tx, [orderId])` (`working-order.ts:3650`), then return the new revision
    (`readOrderRevision`, `:2751`) and `moved`.

**The route** (`till-api.ts`, beside `…/lines/recall`):

```ts
app.post("/api/working-orders/:id/lines/move-station", (c) =>
  run(c, log, async () => {
    await requireSession(deps, c); // any waiter (M10): no PIN, no handheld refusal
    const id = requireUuidId(c.req.param("id"), "working_order.not_found");
    const body = await readJsonBody<Record<string, unknown>>(c);
    // submissionIdOf (bill-payments-api.ts:95) for the id; lineIds: a non-empty array of at most 100
    // strings, else management.request_invalid { field: "lineIds" }; a lineId that is not a uuid →
    // tab.line_not_found; stationId not a uuid → station.not_found.
    const result = await withTransaction(deps.db, (tx) => moveDishesToStation(tx, deps.cfg, id, { … }));
    return c.json(result);
  }),
);
```

Status map: `"ticket.not_sent": 409`, `"ticket.made_here": 409`. Confirm `route.station_inactive: 409`, `station.not_found: 404`,
`tab.line_not_found: 404`, `ticket.already_started: 409` and `working_order.already_collected: 409`
are still mapped after 3a and 3b (3a's plan deletes `route.station_inactive` from this map,
3a plan:856-857; 3b's order writes raise it again, 3b plan:1171-1172; add it back if it is missing).

**Error descriptions** (`errors.ts`):
- `"ticket.not_sent": { workingOrderId: string; lineId: string }` — "A move to another station named
  a line with no kitchen record: never sent, or a dish that needs no preparation. Choosing where it is
  made before it is sent is 'make at' (`make_at_station_id`)." `ticket.not_fired` (`:616`) means
  "the order was never fired" and is not stretched.
- `"ticket.made_here": { ticketItemId: string }` (P13) — "A move to another station named a dish
  that is made at the till that sent it (3c-1's `made_here`; always fired and ready): it has no ticket
  at its station, and its station stays its maker." Why a new code rather than a sibling (grepped
  2026-10-01, `grep -n '"ticket\.' apps/server/src/errors.ts`: `invalid_transition`,
  `already_fired`, `not_fired`, `item_held`, `already_started`, and this plan's `not_sent`): the
  record is `ready`, so `already_started` would fit its state but tell the waiter the KITCHEN made
  it, and its till words end "You can cancel it", which is no answer to "move it"; `not_sent` says
  the line has no kitchen record, and it has one. The till's words must say why the move is
  pointless — it is made at the till.
- `ticket.already_started`: "A recall, or a move to another station, was asked for a line the kitchen
  has already started (`preparing` or `ready`); a move also refuses a line sent out of the kitchen or
  with any part served. …" (keep the rest).
- `working_order.already_collected`: add "…, or a move to another station found the order handed
  over".

**A recorded line's make-at stays put (P11).** In 3b's write paths for `makeAt` (`applyLineEdits`
and the `OrderLinePatch` path): a line that has a kitchen record — held or fired — ignores any
`makeAt` the request carries for it. And where units added to such a dish go on a new line that copies the dish's `make_at_station_id` (3b plan:1005-1011; today's
new-line code is at `working-order.ts:3970-3978`, which copies `courseId`): when its ticket has a manual station choice and the request's
`makeAt` for that line is `null`, keep the copied value. An ordinary sent dish honors explicit `null` and routes by the rule; only a station id overrides a manual choice. Both entry
points reach it — `OrderLinePatch` (`PUT /api/working-orders/:id/lines/:lineNo`) and the counter's
whole-order save (`PUT /api/working-orders/:id`, whose `SaleLine.makeAt` 3b writes the same way).
A `makeAt` on a line with no kitchen record follows 3b's rule unchanged.

**What the till reads** (P3, P4): `TabLine` gains `stationId: string | null` (the record's station,
null without one) and `movable: boolean` (`stillMovable`, false without a record and false for a
made-here record, P13; the order's own status is the till's to know). `readTabLines` adds
`ticket_items.station_id`, `ticket_items.away_at`, `ticket_items.made_here` and
`working_order_lines.served_quantity` to its select. `readCurrentOrders`' kitchen part
(`{ state, firedAt, awayAt }`, built at `order-groups.ts:1150-1153` today) gains `stationId` and
`movable` the same way. Suites that pin these bodies with `toEqual` fail until they list the new
fields: find them with `grep -rln 'parentProductId\|awayAt' apps/server/src/*.test.ts` and update each
— that is the intended change, not a defect. 3c-2 changes `readTabLines` too (X14); keep its fields.

- [ ] **Step 1: Write the failing tests** in `station-move.test.ts`, on a real database
  (`useVenueDb` with `migrationOptionsFor(manifestSets(), null)`, provisioned with
  `apps/server/src/testing/party-venue.ts` as the group and print-problem suites are), with stations
  Bar, Grill (each with one active station-scope printer), Fryer and Downstairs grill, and
  `cfg.locale` English. Every refusal asserts its code and that nothing was written (print jobs,
  notices, the record's station and the order's revision all unchanged):
  - **Review Focus 1:** a fired, queued burger at Bar moved to Grill → the result lists it with
    `fromStationId: bar`; Bar's printer has one new job decoding to "\*\*\* MOVED TO GRILL \*\*\*"
    and the dish; Grill's printer one new job decoding to a ticket with "From Bar" and the dish and
    neither HOLD nor FIRE; `listStationNotices` gives Bar one `rerouted` notice with
    `reroutedTo: "Grill"` and Grill none; the record's `queued_at` is the move time (a fake clock,
    `vi.useFakeTimers({ toFake: ["Date"] })`), its `station_chosen_at` is the move time, and its
    `fired_at` is unchanged.
  - **Review Focus 2:** move the burger Bar→Grill with submission `s1` and keep the answer; move it
    Grill→Bar with `s2`; then send `s1`'s request again. Assert, in this order: the record is at Bar;
    the counts of print jobs, of `kitchen_notices` rows and the order's revision are the same after
    the third request as after the second; and only then that the third answer `toEqual`s the first
    (so a missing gate fails first on the station and the counts, not on the answer). A plain repeat right after
    `s1` also answers the same. The same submission id with `stationId: fryer` →
    `submission.id_reused`.
  - **Review Focus 3:** `preparing` → `ticket.already_started`; `ready` → same; `away_at` set → same;
    `served_quantity` > 0 → same.
  - **Made here (P13, amended 2026-10-01, twice):** a lager sent from the bar till whose made-here
    list names Bar (3c-1's setup: its record is at Bar, `made_here` true, `ready`, fired at the send)
    moved to Grill → refused `ticket.made_here`, not `ticket.already_started`, and nothing written
    (no print job, no notice, record still at Bar, revision unchanged). The same lager sent from the
    bar till inside a HELD group (3c-1 T12: made at once, so its record is fired and `ready` while the
    group's other dishes wait) → also `ticket.made_here`. `GET /api/working-orders/:id/lines` lists
    both with `movable: false`, and the current-orders row's kitchen part likewise.
  - `ticket.not_sent` for a line with no record; `tab.line_not_found` for another order's line;
    `station.not_found` for another venue's station; `route.station_inactive` for a switched-off
    station; a station closed by hand (3b's `setStationToday`) is accepted; `working_order.not_open`
    for an abandoned order; `working_order.already_collected` for a collected counter order.
  - The same station → `moved: []`, nothing written, revision not moved.
  - With the venue's "changes to sent items" switched off (`VENUE_SERVICE.readEditSentLines` false),
    the move still succeeds (M11).
  - A held dish (course hold, no group) → its station changes, no job, no notice.
  - **Review Focus 8:** a held dish in a group whose HOLD ticket was printed (the venue's
    `print_held_work` on, `writePrintHeldWork`) → Bar gets one HOLD CANCELLED slip naming the group
    and one `rerouted` notice; Grill one ticket with the HOLD header and "From Bar"; then `fireGroup`
    → Grill gets a FIRE ticket for it.
  - **P1:** on an open bill the moved line's `make_at_station_id` is Grill, and units added to it
    afterwards through the line-edit path go to Grill; on a presented (placed) bill and on a paid
    (settled) bill the move succeeds and the line's `make_at_station_id` is unchanged (the freeze
    trigger would refuse a write, so a passing move proves none was attempted).
  - **Review Focus 10 (P11):** on an open counter order, the burger moved Bar→Grill; then
    `PUT /api/working-orders/:id` with the basket raised by one on the burger and `makeAt: null` on
    its `SaleLine` → the new line's record is at Grill and its `make_at_station_id` is Grill. The same
    through `PUT …/lines/:lineNo` with `{ quantity: <+1>, makeAt: null }`. With `makeAt: <Bar>` the
    added units go to Bar (an explicit station still overrides).
  - **P11, held line:** a HELD burger (group held, no `sent_at`) moved Bar→Grill on an open bill; then
    an edit of that line carrying `makeAt: null` (or `makeAt: <Bar>`) → the line's
    `make_at_station_id` is still Grill and its record is still at Grill.
  - **The mark travels with a split (re-check m-A):** a held burger (×2) in a held group, moved
    Bar→Grill by hand (marked), then one unit split onto a check of the same party (B20's split,
    `carveOffLines` with `refuseHeld: false`, `working-order.ts:2795-2801`, which copies the record
    through `splitTicketItem`'s `...ticket` spread, `:3131-3137`) → the copied record is at Grill and
    carries the same `station_chosen_at`. (M19 says "on ANY bill"; the copy is what keeps that true
    after a split.)
  - **Review Focus 7:** a burger at Grill whose chips are a split-off extra at Fryer (built through
    3c-2's send path, as 3c-2's own suites build one) moved to Downstairs grill → the burger's record
    is at Downstairs grill, the chips' record still at Fryer, Fryer's printer has no new job, and
    `listStationQueue(tx, fryer)` shows the chips' cross-reference naming Downstairs grill (3c-2's
    field). The Downstairs grill ticket shows 3c-2's "with Chips from Fryer" line.
  - **P3:** moving the chips' own line (a split-off extra) to Grill moves only that record, with a
    slip at Fryer and "From Fryer" at Grill.
  - A two-dish move from Bar and Fryer to Grill gives Grill two tickets, one "From Bar", one
    "From Fryer".

  In `till-api.station-move.test.ts`: the route answers 200 with the result; a malformed body →
  400 `management.request_invalid` with its field; each refusal's status as mapped; no session →
  the session refusal. `GET /api/working-orders/:id/lines` lists `stationId` and `movable` (true for a
  queued dish, false for a started one and for a dish with no record).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/station-move.test.ts src/till-api.station-move.test.ts`.
  Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the column and its migration first (read it; the mutation check above),
  then `station-move.ts`, the route, the codes and the two reads.
- [ ] **Step 4: Run** those two files, then
  `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/order-groups.test.ts src/kitchen-print.test.ts src/till-api.test.ts src/till-api.groups.test.ts`
  and `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/migration-upgrade.test.ts scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts`
  and the db suite named above, then
  `pnpm --filter @waitron/server typecheck`. Expected: PASS. Then proofs by deletion (CLAUDE.md §4),
  each confirming the failure is the one named:
  - delete step 6's `enqueueStationMoved` call and run Review Focus 1: it must fail on "Bar's printer
    has one new job";
  - delete the `runServiceCommand` wrapper (call `run()` directly) and run Review Focus 2: it must
    fail on "the counts of print jobs … are the same after the third request" (the resent `s1` then
    moves the dish Bar→Grill again and prints a slip and a ticket) — NOT only on the answer;
  - delete the P11 rule and run Review Focus 10: it must fail on "the new line's record is at Grill".

  Restore all three.
- [ ] **Step 5: Commit**: "Till route: any waiter can move a dish the kitchen has not started to another station; the old station gets a slip and a notice, the new one a ticket saying where it came from".

---

### Task 4: A held dish whose station has closed is re-routed when it is released

**Files:**
- Modify: `apps/server/src/station-move.ts` (add `rerouteHeldAtRelease`),
  `apps/server/src/working-order.ts` (`releaseHeld` `:1513-1544`, `finishRelease` `:1552-1567`,
  `sendLines` `:1573-1650`, and the release entry points `fireCourse` `:1473-1486`),
  `apps/server/src/order-groups.ts` (`fireGroup` `:245-265`), `packages/module/src/module.ts` (3c-2's
  `MakerResolver` gains `stations()`), `packages/venue-service/src/routing-store.ts` (3c-2's
  `routingAt` answers it)
- Test: `apps/server/src/station-move.test.ts` (a `describe("release")`), `apps/server/src/order-groups.test.ts`,
  `packages/venue-service/src/routing-store.test.ts`

**The one routing snapshot is 3c-2's** (plan-3c2 P1, Tasks 1, 3, 4 and its "Review 2 applied", I4;
read the landed code for the names). 3c-2 has every release command — `fireCourse`, `fireGroup`,
`sendLines` — open ONE lazy routing snapshot, `routingOnce(tx, cfg, at)` (a `RoutingOnce`: an opener
of `VENUE_SERVICE.routingAt(tx, cfg, at)`, which loads the venue's moment and the rules once, with
`.at` its instant), at its one clock reading, and pass it down `fireHeldGroupsOfCourse` →
`releaseGroup` → `fireOrderLines` → `releaseHeld` → `heldNoRouteLines` / `finishRelease`; each uses
`routing.at` as its fire time. This task adds NO clock parameter and NO second rules load: the
re-route asks the same snapshot.

**The snapshot gains one question** (`module.ts`, 3c-2's `MakerResolver`):

```ts
  /** Each station of the venue, switched off included, as 3b's `stationStates` answers it — but
   *  from this snapshot's rules and moment (3b's `stationStatus`), with the station names read once,
   *  on first ask. */
  stations(): Promise<ReadonlyMap<string, { open: boolean; isDefault: boolean; active: boolean; name: string }>>;
```

So a release that spans several bills asks "which stations are open?" against one load at one
instant. `VENUE_SERVICE.stationStates` (3b) stays for its other callers (the move, the till's station
list).

**Interface:**

```ts
/** Where each re-routed line's record was before. */
export type Rerouted = ReadonlyMap<string /* working_order_lines id */, { stationId: string; stationName: string }>;

/**
 * Before a release stamps `fired_at`: of the order's held records `scope` selects, re-route each dish
 * record whose station is not open at `routing.at` (M18) to where the rules send it now, tell the
 * old station when its group's HOLD ticket was printed (M22), and record the alert for any left at a
 * station that is not open and that nobody chose (P8). Never touches `working_order_lines`. Opens
 * the snapshot only when some record in scope is held.
 */
export async function rerouteHeldAtRelease(
  tx: Transaction, cfg: TillConfig, orderId: string, scope: SQL, routing: RoutingOnce,
): Promise<Rerouted>;
```

**Behaviour:**
1. Read the held records in scope: `ticket_items` joined to `working_order_lines` where
   `ticket_items.working_order_id = orderId`, `scope`, `fired_at is null`, `state = 'queued'` and
   `made_here = false` (P13). That condition is a defence, not a branch a correct venue reaches: a
   3c-1 made-here record is never held (3c-1 plan, T12, owner: every hold path fires it at the send,
   `ready`), so `fired_at is null` already leaves it out. It costs one predicate, and it keeps a held
   made-here row — should a path T12 missed ever write one — from being re-routed and printed at a
   station whose till makes the dish. Take the record id, its
   `station_chosen_at`, the line id, station, the line's `parent_line_id`, `product_id`,
   `make_at_station_id` and `group_id`, and the fired quantity. A record whose line has a
   `parent_line_id` is a split-off extra's (3c-2): it is an **alert-only** candidate, never re-routed
   (P3). None → empty map, and the snapshot is not opened.
2. `const resolver = await routing(); const states = await resolver.stations()`. A station is **not
   open** when it is missing from the map, or its `active` is false, or its `open` is false —
   written as `!state || !state.active || !state.open`, because 3b defines `open` only as "taking work
   now" (3b plan:950-957) and M18 depends on a switched-off station counting as not open. Keep the
   records whose station is not open. Set aside — not re-routed, not alerted — those a waiter chose
   (M19), **but only while their station is switched on (`active`)**: the record carries
   `station_chosen_at` (a move by hand, any bill, P1), or its line's `make_at_station_id` EQUALS the
   record's own station (3b's "make at"; one that no longer names where the record is protects
   nothing). A chosen record whose station has been SWITCHED OFF is not set aside: it is re-routed by
   the rules like any other, and with no replacement it is stranded and alerted. Alert-only
   candidates left are **stranded** at once (step 7). Drop dish candidates with a null `product_id`.
   No dish candidate left → no further rules question.
3. The zone: `(await VENUE_SERVICE.findOrderContext(tx, cfg, orderId))?.zoneId ?? null` (as `fireLines`
   reads it, `working-order.ts:1158`). Then `resolver.makers(zone, productIds)` — the same snapshot,
   never a second `routingAt` or 3b's `resolveMakers` wrapper.
4. Each candidate whose outcome is `{ kind: "made", route: { kind: "station", stationId } }` with a
   station other than its own moves there. `no_replacement`, `no_station` and a `no_preparation`
   route leave it where it is (M20, M21): those are **stranded** too.
5. Tell the old stations: candidates moving whose group's HOLD ticket was printed
   (`printedHeldGroups`; the group is still `held` here, because `releaseGroup` marks it fired only
   after its bills are released, `order-groups.ts:444-450`) go to `enqueueStationMoved` as
   `HOLD CANCELLED` items with the group's position, one call per new station (each call names one
   destination; each item still carries its own old station). Others are told nothing (M22, P9).
6. `UPDATE ticket_items SET station_id = <new>, queued_at = <routing.at>` per moving record (M7). A
   re-route never sets `station_chosen_at`: the rules chose.
7. With any stranded records (dishes from step 4, split-off extras from step 2):
   `raiseReleasedAtClosedStation(tx, cfg, orderId, routing.at, stranded)` (Task 5), once for this bill.
8. Return the map of moved lines to their old station id and name (names from step 2).

**The one clock reading (3b's S9; review 1 I5, re-check I-1).** Each release entry point — `fireGroup`,
`fireCourse`, `sendLines` — opens 3c-2's snapshot as its FIRST statement, before any `await`:
`const routing = routingOnce(tx, cfg, new Date())`. If 3c-2's landed code opens it later (for
example after `fireGroup`'s `runServiceCommand`, `requireOpenParty`, `checkAndBumpParty` and
`requireHeldGroup`, each an `await`, `order-groups.ts:252-261`, `parties.ts:599-620`), move it up.
Why first: 3b's S9 measured it (3b plan:973-977: "the plan's re-check measured a timer in such a gap
shifting the reading. A correct implementation would then fail the test"), and such a timer exists
in-process: the venue holder's heartbeat constructs `new Date()` in a `setInterval`
(`packages/store/src/venue-liveness.ts:295-300`). Opening it before the replay check costs nothing:
the opener is lazy, and a replay asks it nothing.

**Wiring:**
- `releaseHeld` calls `rerouteHeldAtRelease(tx, cfg, orderId, ticketScope, routing)` — with the
  snapshot 3c-2 passes it — before its `UPDATE … RETURNING` (whose `RETURNING stationId` then already
  names the new station), and passes the map to `finishRelease`.
- `sendLines`: the same, before its update (`:1610-1629`), with a scope built from the same
  conditions its update uses.
- `finishRelease` gains `rerouted: Rerouted` and prints in two parts: the items NOT in the map with
  `{ mark }` as today, then, per old station, the items in the map with `{ from: <old name> }` and no
  mark (M22). Everything else in it is unchanged.
- `releaseGroup`'s per-group FIRE mark still reaches `finishRelease`, which now leaves it off
  re-routed dishes.
- Rewrite `releaseHeld`'s and `finishRelease`'s descriptions to say a dish whose station is not open
  is re-routed first.

- [ ] **Step 1: Write the failing tests** (`station-move.test.ts`, `describe("release")`), with the
  location's zone `Europe/Madrid`, stations Upstairs bar (claims Drinks), Downstairs bar and Grill,
  each with an active printer, and a fake clock fixed on a Friday evening:
  - **Review Focus 5:** `print_held_work` on; a mojito held in group 1 at Upstairs bar, its HOLD ticket
    printed, and a burger in the same group at Grill; Upstairs bar closed by hand
    (`setStationToday`) with Downstairs bar as its fallback (`setStationFallback`). `fireGroup` →
    the mojito's record is at Downstairs bar with `queued_at` = the release time; Upstairs bar has one
    HOLD CANCELLED slip and one `rerouted` notice naming Downstairs bar; Downstairs bar has one
    ticket with "From Upstairs bar" and no FIRE header; Grill's ticket for the burger still has the
    FIRE header; no `route.released_at_closed_station` incident.
  - **Review Focus 5, B20:** the same group split (as B20's cases in `order-groups.test.ts` split
    one) across an open bill and a paid check, a mojito on each: both records move to Downstairs
    bar; each bill gets its own HOLD CANCELLED slip at Upstairs bar and its own "From Upstairs bar"
    ticket at Downstairs bar. Spy on `VENUE_SERVICE.routingAt`, `VENUE_SERVICE.resolveMakers` and
    `VENUE_SERVICE.stationStates`: `routingAt` was called exactly once, and `resolveMakers` and
    `stationStates` never — here both bills DO re-route, so a per-bill `resolveMakers(…, routing.at)`
    (same answers, a second rules load) fails this case, which Review Focus 9 (where nothing
    re-routes) cannot see.
  - **Review Focus 9 (one clock):** Upstairs bar has hours Friday 19:00–21:00 (3b's
    `replaceStationHours`) and Downstairs bar as fallback; the group split across two bills, a
    mojito on each. Replace `globalThis.Date` with a subclass whose no-argument constructor returns
    `2026-10-02T18:59:59.999Z` (Friday 20:59:59.999 in Madrid) plus one millisecond per construction
    so far (`Date.now()` likewise), as 3b's S9 test does (3b plan:1085-1099); install it immediately
    before calling `fireGroup` directly and restore it in `finally`. Spy on
    `VENUE_SERVICE.routingAt` and `VENUE_SERVICE.stationStates`. Both mojitos are released at
    Upstairs bar, both records stamped `2026-10-02T18:59:59.999Z`, the group's `fired_at` is that
    instant too, `routingAt` was called exactly once for the two bills, and `stationStates` never.
    Control: temporarily make `releaseGroup` open a fresh `routingOnce(tx, cfg, new Date())` per bill
    instead of using the one `fireGroup` passed, and confirm the case fails — BOTH mojitos move to
    Downstairs bar (`fireGroup`'s opener took the first construction, 20:59:59.999; the per-bill ones
    take the second and third, 21:00:00.000 and later) and `routingAt` is called twice; restore.
  - Course hold, no HOLD ticket (`print_held_work` off), Upstairs bar closed with Downstairs bar as
    its fallback: fired by `fireCourse` → re-routed to Downstairs bar, and Upstairs bar gets no job
    and no notice.
  - **Review Focus 6:** the mojito's `make_at_station_id` is Upstairs bar (closed) → released at
    Upstairs bar, nothing at Downstairs bar, and no incident (the waiter chose it, P8). With Upstairs
    bar switched off AFTER the mojito was sent on hold and before `fireGroup` (and Downstairs bar its
    fallback), the make-at no longer protects it and it goes to Downstairs bar. (Switched off before
    the send, 3b's `fireLines` would already have ignored the make-at and routed it to Downstairs bar,
    and the release would never meet the switched-off case.)
  - **Review Focus 6, a move by hand on a PAID bill:** a held mojito on a settled bill moved by hand
    to Grill (`moveDishesToStation`; its line cannot take a make-at, P1, so only the record's
    `station_chosen_at` says it was chosen); Grill then closed with Downstairs bar as its fallback,
    Upstairs bar open; `fireGroup` → released at Grill, no incident. Proof by deletion: drop
    `station_chosen_at = <at>` from Task 3's step 7 and run this case — it must fail on "released at
    Grill" (the rules would send it to Upstairs bar); restore.
  - **Review Focus 6, a hand-moved dish whose station is then SWITCHED OFF (re-check I-A):** the same
    hand move to Grill (marked); Grill then switched off (`active: false`, which the management API
    accepts with queued work, `management-api.ts:1688-1691`) with Downstairs bar as its fallback, and
    Upstairs bar open; `fireGroup` → re-routed by the RULES to Upstairs bar (the mark protects only
    while its station is switched on). With Upstairs bar also closed and no fallback anywhere, the
    mojito is released at Grill and the incident is recorded naming Grill.
  - **Review Focus 6, a stale make-at:** the mojito's line says make-at Upstairs bar, but its record
    is at Grill and carries no `station_chosen_at` (write `ticket_items.station_id` directly in the
    test — the shape a record has when its make-at station was switched off at send and the rules
    sent it elsewhere, then switched back on); Grill closed, Upstairs bar open → re-routed to Upstairs
    bar: the RULES' choice for the product (Upstairs bar claims Drinks). Grill's fallback is never
    consulted; a re-route asks the rules, it does not walk the current station's fallback. Without
    the "equals the record's own station" test (m1) the dish would stay at Grill.
  - **M20:** Drinks re-claimed by "no preparation" after the hold, Upstairs bar closed → released at
    Upstairs bar, and the incident is recorded.
  - An open station keeps its dish even when the rules now name another (M18): Upstairs bar open,
    Drinks re-claimed by Downstairs bar after the hold → released at Upstairs bar.
  - **Review Focus 4:** a held group on a table bill; the bill paid in full (settled), as the B21
    cases in `order-groups.test.ts` pay one; Upstairs bar closed with NO fallback; `fireGroup` → no
    error, the mojito's record is at Upstairs bar and fired. (Task 5 adds the incident assertion.)
  - **Review Focus 4, with a fallback:** the same settled bill, Upstairs bar closed WITH Downstairs
    bar as its fallback → the release succeeds, the record is at Downstairs bar, and the line's
    `make_at_station_id` and every other column of its `working_order_lines` row except `sent_at`
    are unchanged. Proof by deletion: add, inside `rerouteHeldAtRelease`'s move branch, a
    `working_order_lines` write of `make_at_station_id` with no status check (as Task 3 step 8 would
    be without its `open` test) and run this case — it must fail with the freeze trigger's
    refusal ("lines may only be written while the order is open"); remove it.
  - P9: a recalled mojito (`recallLines`) whose station has since closed, with Downstairs bar as its
    fallback, sent again with `sendLines` → at Downstairs bar, and Upstairs bar gets nothing new.
  - **Made here beside a held dish (P13, amended 2026-10-01, twice):** group 1 sent from the bar
    till whose made-here list names Upstairs bar, holding a mojito (Upstairs bar) and a burger
    (Grill), with Downstairs grill as Grill's fallback: per 3c-1 T12 the mojito's record is made at
    once (fired, `ready`, `made_here` true) while the burger waits held at Grill. Grill then closed by
    hand, and Upstairs bar too; `fireGroup` → the burger is re-routed to Downstairs grill (a ticket
    with "From Grill"), and the mojito's record is untouched: still at Upstairs bar, same `fired_at`,
    no print job naming it, no `rerouted` notice, no `route.released_at_closed_station` incident.
  - **The defence (P13):** the one case that exercises step 1's `made_here = false`, since no product
    path writes a held made-here record: insert one directly (a mojito at Upstairs bar, `made_here`
    true, `queued`, `fired_at` null, in group 1 — the row T12 says cannot occur), close Upstairs bar
    with Downstairs bar as its fallback, `fireGroup` → the record stays at Upstairs bar, with no
    "From" ticket at Downstairs bar and no notice. Proof by deletion: drop `made_here = false` — the
    case must fail on "stays at Upstairs bar".
  - **Review Focus 11:** a held burger at Grill (open) whose chips are a split-off extra at Fryer
    (built through 3c-2's send path); Fryer closed with no fallback; `fireGroup` → the chips' record
    is released at Fryer (never re-routed, P3), and one incident names Fryer and the chips. With
    Fryer given an open fallback instead, the chips are STILL released at Fryer (extras are not
    re-routed) and the incident is still recorded — it covers every record left at a station that is
    not open and that nobody chose.
  In `packages/venue-service/src/routing-store.test.ts`, beside 3c-2's snapshot cases: a resolver's
  `stations()` answers each station's `open`, `active`, `isDefault` and `name` as `stationStates`
  does at the same instant (Upstairs bar closed by hand, a switched-off station, the default), and
  answers from the snapshot it was opened with — close a station by hand AFTER opening it and the
  resolver still says open, as 3c-2's own "it loads once, at opening" case does for claims.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/station-move.test.ts -t release`
  and `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/station-move.test.ts src/order-groups.test.ts src/working-order.test.ts src/till-api.courses.test.ts src/till-api.groups.test.ts src/kitchen-print.test.ts`
  `pnpm --filter @waitron/server typecheck` and `pnpm --filter @waitron/venue-service typecheck`
  (this task changes `module.ts` and `routing-store.ts`). Expected: PASS. Proof by deletion: remove the
  `rerouteHeldAtRelease` call from `releaseHeld` and run Review Focus 5 — it must fail on "the
  mojito's record is at Downstairs bar".
- [ ] **Step 5: Commit**: "Release: a held dish whose station is closed when it fires goes where the rules send it now, asked of the release's one routing snapshot, with a HOLD CANCELLED slip at the old station when it had the HOLD ticket".

---

### Task 5: A dish released into a closed station records a dashboard alert

**Files:**
- Create: `apps/server/src/closed-station-alert.ts`, `apps/server/src/closed-station-alert.test.ts`
- Modify: `apps/server/src/errors.ts` (declare the incident's code and params, as
  `route.dish_not_sent` is declared, `:1141`), `apps/dashboard/src/i18n/alert-messages.ts`,
  `scripts/alert-codes.test.ts` (`INCIDENT_CODE_SOURCES`, `:24-39`: add the new file)
- Test: `apps/server/src/closed-station-alert.test.ts`, `apps/server/src/station-move.test.ts` (Review
  Focus 4), `scripts/alert-codes.test.ts`, `apps/dashboard/src/i18n/alerts.test.ts`

**Why a recorded incident, not an ongoing source (P8):** an ongoing check can only see "a closed
station with dishes fired in the last hour still queued", which is also true after every routine
closing, and always at a printer-only station whose cooks never mark dishes done (3b plan:1489-1490).
The release is the one place that knows a dead end happened, and it records it at that moment, as
the payment path records `route.dish_not_sent` (`apps/server/src/dish-not-sent-alert.ts`).

**Interface** (`closed-station-alert.ts`, modelled on `dish-not-sent-alert.ts`):

```ts
export interface Stranded {
  stationId: string;
  stationName: string;
  /** The lines left there — dishes, and split-off extras (P3) — in line order. */
  lineIds: readonly string[];
}

/** Record that a release left held work at a station that is not open and that nobody chose
 *  (M21, P8). One incident per call; while one is open on this till, a later one adds nothing (P12). */
export async function raiseReleasedAtClosedStation(
  tx: Transaction, cfg: Pick<TillConfig, "tillId">, orderId: string, at: Date,
  stranded: readonly Stranded[],
): Promise<void>;
```

It calls `recordIncidentOnce` (`packages/core/src/incidents.ts:55-81`) with `tillId: cfg.tillId`, no
sale, `severity: "error"`, `detectedAt: at`, and `new AppError("route.released_at_closed_station",
{ station, dishes, workingOrderId, orderNumber, orderLabel })`: `station` the names of the stations,
joined with ", " (one, usually); `dishes` the lines' staff names, each once, joined with ", "
(`workingOrderLines.name`, as `raiseDishesNotSent` names dishes by staff name — CLAUDE.md §3, one name
per surface: the dashboard is a staff surface); the order's number and label read as
`recordDishesNotSent` reads them (`dish-not-sent-alert.ts:77-80`). **Dedup:** `incidents_open_dedup`
keeps one open incident per till, code and sale (`packages/db/src/schema/incidents.ts:49-64`); this
code has no sale and the server's one till id, so a second dead-end release while the first alert is
open records nothing (`recordIncidentOnce` answers `false` through its targeted `do nothing`); once
someone marks it handled, the next one records again. The wording says so. **Refusals:** the
incidents table carries no trigger (its schema comment, `incidents.ts:14-16`), the dedup conflict is
absorbed by the targeted clause, and `till_id` is the server's own till row — so, read and not run,
none of the refusals `raiseDishesNotSent` catches (its catch `dish-not-sent-alert.ts:42-54`, the list
`ALERT_REFUSALS` `:57`) is expected here. Catch only unique and not-null insert refusals; result
code 1811 alone cannot identify a trigger refusal (`CLAUDE.md` §3). Those listed refusals do not
fail a release; other failures still propagate. Log
nothing (the release paths carry no logger). The file must contain no other
double-quoted dotted literal: `scripts/alert-codes.test.ts` reads every one in a listed file as a
recorded code (`:84-90`).

Wording (`alert-messages.ts`; the header forbids promising a later automatic check). Its last
sentence is its own, not the file's `MORE_EN`/`MORE_ES` (`:12-14`), which speak of "later checks";
this alert is written by releases. The reason covers every stranded case — no replacement, no
default station, the rules now saying "no preparation" (M20), and a split-off extra, which is never
re-routed:
- EN: "Order {orderNumber}: {dishes} went to {station}, which is closed or switched off, and the
  prep station rules sent them nowhere else. If nobody is making them there, move them to another
  station from the till (Move to station…), or open {station} for today on the Prep stations page.
  Dishes left at a closed station later do not add to this alert while it is open, so there may be
  more."
- ES: "Pedido {orderNumber}: {dishes} se enviaron a {station}, que está cerrada o desactivada, y las
  reglas de las estaciones de preparación no los enviaron a ningún otro sitio. Si nadie los está
  preparando allí, pásalos a otra estación desde el TPV (Cambiar de estación…) o abre {station} por
  hoy en la página de Estaciones de preparación. Los platos que queden más tarde en una estación
  cerrada no se añaden a esta alerta mientras esté abierta, así que puede haber más."

It falls under venue-service's `route.` claim (`packages/venue-service/src/alerts.ts:2-4`: area
`kitchen`, permission `venue_service.manage`); `scripts/alert-codes.test.ts`'s "every recorded code is
claimed by an area" case checks it.

- [ ] **Step 1: Write the failing tests.** `closed-station-alert.test.ts` (real database, set up as the
  `route.dish_not_sent` cases are: `grep -rln 'route.dish_not_sent' apps/server/src/*.test.ts`): one call records one open incident with the code,
  params, severity and `detected_at` = `at`; a second call while it is open records nothing; after
  `markIncidentHandled` (`packages/core/src/incidents.ts:188`, the dashboard's handled path) a third call records a new one. In
  `station-move.test.ts`, Review Focus 4 gains: after the release, the incidents table holds one open
  `route.released_at_closed_station` naming Upstairs bar and the mojito; Review Focus 11 one naming
  Fryer and the chips; Review Focus 5 and 6 assert none. In `scripts/alert-codes.test.ts` nothing new is written: listing the file is the change.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/closed-station-alert.test.ts`
  and `pnpm exec vitest run scripts/alert-codes.test.ts` (with the file written but not yet listed,
  the latter must fail on "every file that records an incident is a listed code source" — the
  control that the guard sees it). Expected: FAIL.
- [ ] **Step 3: Implement** the file, the code's declaration, the listing and the wording, and the
  call in `rerouteHeldAtRelease` (Task 4, step 7).
- [ ] **Step 4: Run** those two, `src/station-move.test.ts`, and
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: "Kitchen alerts: a release that leaves dishes at a closed station, because nothing could take them, records an alert naming the station and the dishes".

---

### Task 6: The kitchen screen shows "Moved to Grill"

**Files:**
- Modify: `apps/till/src/api/client.ts` (`KitchenNoticeKind` `:1147` gains `"rerouted"`;
  `KitchenNotice` `:1154-1175` gains `reroutedTo: string | null`), `apps/till/src/widgets/station-queue.ts`
  (`NOTICE_ICONS` `:26-31`, `#notice` `:728-771`, the `.notice.kind-*` styles near `:500`),
  `apps/till/src/i18n/strings.ts` (beside `station.notice.moved_to`, `:136` and Spanish `:938`)
- Test: `apps/till/src/widgets/station-queue.test.ts` and its a11y test. **Fixture fan-out (expected
  typecheck failures):** every `KitchenNotice` literal gains `reroutedTo: null` — read 2026-10-01, the
  suites that write one (`grep -rln 'cancelledExtra: null' apps/till/src`) are
  `screens/till-station-screen.test.ts`, `screens/till-station-screen.a11y.test.ts`,
  `widgets/station-queue.test.ts`, `widgets/station-queue.a11y.test.ts` and `api/client.test.ts`;
  re-run the grep rather than trust the list.

**Behaviour:** a `rerouted` notice shows the kind "Moved station" / "Cambio de estación"
(`station.notice.rerouted`), with the moved-to-table arrow icon (`NOTICE_ICONS` is typed over every
kind, so the typecheck requires an entry), and a line "Moved to {station}" / "Pasado a {station}"
(`station.notice.rerouted_to`, filled with a replacer function as `moved_to` is, so a `$` in a name
is never read as a pattern). The "Got it" button's label includes it, as it includes the cancelled
extra.

- [ ] **Step 1: Write the failing tests**: a `rerouted` notice renders its kind, icon and "Moved to
  Grill"; acknowledging it dispatches `acknowledge-notice` with its id; the a11y test covers it in both
  themes.
- [ ] **Step 2: Run** (check memory first) `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `src/widgets/station-queue.a11y.test.ts`, and
  `pnpm --filter @waitron/till typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: "Kitchen screen: a dish moved to another station shows as 'Moved to Grill' at the station it left".

---

### Task 7: The till knows which stations are open, and one dialog asks for a station

**Files:**
- Modify: `apps/server/src/till-api.ts` (`GET /api/stations`, `:1298-1306`), `apps/till/src/api/client.ts`
  (`Station` `:1058-1064` gains `open: boolean`; `TabLine` gains `stationId` and `movable`;
  `CurrentOrderKitchen` `:507-511` gains them too; new `moveDishStation`), `apps/till/src/till-app.ts`
  (`stations` `:1192`, read lazily today by `#loadStationQueue` `:1566`)
- Create: `apps/till/src/widgets/station-choice-dialog.ts` + `.test.ts` + `.a11y.test.ts`
- Test: `apps/server/src/till-api.station-move.test.ts`, `apps/till/src/api/client.test.ts`.
  **Fixture fan-out (expected typecheck failures):** `Station` gains a required `open`, and `TabLine`
  and `CurrentOrderKitchen` gain required `stationId` and `movable`. Every till suite that builds one
  as a literal fails to typecheck until it states them; find them with
  `pnpm --filter @waitron/till typecheck` and give the suites' shared line and station factories the
  new fields (`open: true`, `stationId: null`, `movable: false`) rather than editing each literal.

**Server:** the route reads `listStations(tx, deps.cfg)` (`apps/server/src/kitchen.ts:98-114`,
unchanged, switched-on stations only) and `VENUE_SERVICE.stationStates(tx, { locationId:
deps.cfg.locationId }, new Date())` in the same transaction, and adds `open` to each station. The
management route that also calls `listStations` is untouched.

**Client:**

```ts
moveDishStation(
  orderId: string,
  body: { submissionId: string; lineIds: string[]; stationId: string },
  options?: { signal?: AbortSignal },
): Promise<{ revision: number; stationId: string; moved: { workingOrderLineId: string; fromStationId: string }[] }>;
```

**The app's station list:** `#loadStations()` reads `listStations()` and replaces `this.stations`
whenever a table's order screen opens, the counter basket is shown, and a station dialog opens, so
"(closed)" is as fresh as the last of those. A failed read keeps the previous list.

**The dialog (`till-station-choice-dialog`)**, an app widget in a `wt-dialog`:
- properties: `mode: "make-at" | "move"`, `dishName`, `stations: Station[]`, `currentStationId:
  string | null` (move mode), `selected: string | null`, `busy`, `refusal: string | null` (a code);
- a native `<select name="station">` labelled "Make at" / "Preparar en" (make-at) or "Move to" /
  "Pasar a" (move). Options: in make-at mode a first option "Where the rules send it" / "Donde lo
  envían las reglas" with value `""`; then every listed station, a closed one as 3b's dead-end rows
  write it ("Upstairs bar (closed)", reuse 3b's string), and in move mode the current one as "Grill
  (now)" / "Parrilla (ahora)" (P4). The chosen option carries `.selected`. In move mode the select
  opens on the current station when it is listed; when it is not (a station switched off since the
  dish was sent, so not in the switched-on list), the select gains a first empty option "Choose a
  station" / "Elige una estación", selected, and Move stays disabled until a listed station is
  chosen;
- buttons: "Save" / "Guardar" (make-at) or "Move" / "Pasar" (move), disabled while `busy` and, in
  move mode, while the current station or the empty option is selected; and "Cancel" / "Cancelar";
- a refusal shows on its own line at the bottom of the body. In move mode it uses the dialog's own
  sentences for the codes whose shared words misfit a move (P2), from new till strings
  `move_station.refused.<code>`: `ticket.already_started` ("The kitchen has started, finished or sent
  out this dish, so it stays where it is" / "La cocina ya ha empezado, terminado o sacado este plato,
  así que se queda donde está"), `working_order.not_open` ("This order has been discarded" / "Este
  pedido se ha descartado"), `working_order.already_collected` ("This order has already been handed
  over" / "Este pedido ya se ha entregado"), `tab.line_not_found` ("This dish is no longer on this
  bill" / "Este plato ya no está en esta cuenta"), `ticket.not_sent` ("This dish has not gone to the
  kitchen yet" / "Este plato aún no ha ido a cocina"), `ticket.made_here` ("This dish is made here at
  the till, so it has no ticket at a station to move" / "Este plato se prepara aquí en la caja, así
  que no tiene comanda en ninguna estación que pasar"); any other code shows `codeMessage(code)`;
- events (plain names, an app widget): `station-chosen` with `{ stationId: string | null }`, and
  `close`.

- [ ] **Step 1: Write the failing tests**: the route lists `open: false` for Upstairs bar closed by
  hand and `true` for the default; the dialog's two modes render their options (first option, closed
  marking, "(now)"), Move is disabled on the current station, choosing and pressing emits
  `station-chosen`, a refusal renders at the bottom of the body, and the a11y test covers both modes
  and a refusal in both themes; a current station missing from the list leaves the empty option
  selected and Move disabled; each of the five move refusals shows its own sentence, and another
  code its `codeMessage`; the client posts the body to the route.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/till-api.station-move.test.ts` and
  (memory first) `pnpm --filter @waitron/till exec vitest run src/widgets/station-choice-dialog.test.ts src/api/client.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and the dialog's a11y test. Expected: PASS.
- [ ] **Step 5: Commit**: "Till: the station list says which stations are open now, and one dialog asks where to make or move a dish".

---

### Task 8: On a table — "Make at" while ordering, "Move to station…" once sent

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`#draftLine` `:2457-2506`,
  `#lineActions` `:1709-1767`, `#currentRow` `:3268-3313`; a `stations` property), `apps/till/src/till-app.ts`
  (passes `stations`; a `move-station` handler; the dialog), `apps/till/src/i18n/strings.ts`,
  `apps/till/src/i18n/codes.ts`, `LINE_REFUSALS` (`till-app.ts:437-448`)
- Create: `apps/till/src/screens/till-table-order-screen.stations.test.ts`
- Test: `apps/till/src/till-app-table-service.test.ts` (or the till-app suite that drives recall:
  `grep -ln 'recallLines' apps/till/src/till-app*.test.ts`)

**Behaviour:**
- **Make at, while ordering (M1, P7).** With more than one station listed, each draft line's tools
  (`span.draft-line-tools`) gain, after the course select, a native
  `<select name="make-at" data-make-at=${index}>` labelled "Make at · <dish>": first option "Where
  the rules send it" (value `""`), then the stations, closed ones marked. The chosen option is the
  line's `makeAt` (`.selected`). A change writes the line's `makeAt` through 3b's draft-store write
  (3b Task 4c), `""` as `null`, so the draft saves it like a course. A stored `makeAt` naming a
  station not in the list (switched off since) shows the first option, and the app clears it once
  when the list arrives, so the next save is not refused `route.station_inactive`.
- **Move to station…, once sent (M9, P3).** `#lineActions` adds a "Move to station…" / "Cambiar de
  estación…" button (`data-move-station=${line.lineNo}`, labelled with the dish's name) when
  `line.movable`. A Current orders row (`#currentRow`) adds the same button when its kitchen part is
  `movable` and its line is NOT listed in the Pending list on screen
  (`!this.#pending().some((line) => line.id === row.lineId)`). That is the surface for a dish on a
  presented or paid bill, INCLUDING the bill on screen: the till opens such bills
  (`billToOpen`, `till-app.ts:320-323`, picks the first owing bill, a presented one included, else
  the last, a paid one included), `readTabLines` refuses them (`assertTabOpen`,
  `working-order.ts:2603-2613`), and the app then keeps the screen's `lines` empty
  (`till-app.ts:3037-3045`), so their dishes appear only in Current orders. No dish gets two buttons:
  a line in Pending has its button there. It is not the held row's existing "Move"
  (`data-move-line`, which moves a dish to another GROUP). Pressing dispatches `move-station` with `{ workingOrderId, lineId, name,
  stationId }`.
- **The app** opens the dialog in move mode (after `#loadStations()`), and on `station-chosen` sends
  `moveDishStation` with ONE `crypto.randomUUID()` submission id per press, resent on no answer with
  `resendUnanswered` under `TABLE_REQUEST_LIMIT_MS`, as `#applyAdjustment` sends its command
  (`till-app.ts:4040-4062`). On success it closes the dialog and re-reads the bill's lines
  (`#loadTabLines()`) and the party's current orders. On a refusal it keeps the dialog open with the
  refusal at the bottom (`lineWriteError`'s code) and re-reads the lines behind it, so a raced start
  removes the button, as Recall's reload does (`till-app.ts:3873-3887`). The table holds no
  make-at copy of a sent line to refresh: `TabLine` carries none, and (read from the 3b plan, Task 4c)
  the table's Change patch sends `makeAt` only on 3b's dead-end retry, which names a station the
  waiter just chose. The counter does hold one (Task 9).
- `LINE_REFUSALS` gains `ticket.not_sent`, `ticket.made_here`, `working_order.already_collected`, `route.station_inactive`,
  `station.not_found`; the Move dialog handles `tab.line_not_found` itself so other table actions
  retain their existing generic refusal (`working_order.not_open` already reaches the screen
  through `TABLE_REFUSALS`, `till-app.ts:265-287`). `codes.ts` gains, in both languages: `ticket.not_sent` ("This dish has not
  gone to the kitchen yet. Choose where it is made before sending it" / "Este plato aún no ha ido a
  cocina. Elige dónde se prepara antes de enviarlo"), `ticket.made_here` ("This dish is made here at
  the till, so it cannot be moved to a station" / "Este plato se prepara aquí en la caja, así que no
  se puede pasar a una estación"), `working_order.already_collected` ("This order
  has already been handed over" / "Este pedido ya se ha entregado"), `route.station_inactive` ("That
  station has been switched off. Choose another" / "Esa estación se ha desactivado. Elige otra") and
  `station.not_found` ("That station no longer exists. Choose another" / "Esa estación ya no existe.
  Elige otra") — each only if 3b has not added it already (grep first).

- [ ] **Step 1: Write the failing tests** (`.stations.test.ts`, mounting the screen as 3b's
  `.dead-ends.test.ts` does): the Make at select appears on each draft line with two stations and not
  with one; its options and closed marking; choosing writes the line's `makeAt` and `""` writes
  `null`; a stored `makeAt` shows as selected; Move to station… appears on a queued line, not on a
  started one, not on a line with no record; on a Current orders row of another bill but not on the
  row of a dish listed in Pending; and — **the presented bill on screen** — with the shown bill
  presented (`lines` empty, as the app leaves it) and its dish's Current orders row `movable`, the
  button appears on that row (the case the first rule, "another bill only", missed); pressing it
  dispatches `move-station` with the line's id and station. In the till-app
  suite: the dialog opens; Move sends one request with a submission id and the chosen station, a
  resend after no answer reuses that id, success re-reads the lines, and `ticket.already_started`
  shows its words at the bottom of the dialog.
- [ ] **Step 2: Run** (memory first) `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.stations.test.ts` and the till-app file.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those, the table screen's existing suites
  (`ls apps/till/src/screens/till-table-order-screen*.test.ts`), `src/i18n/codes.test.ts` and
  `pnpm --filter @waitron/till typecheck`. Expected: PASS. Then look at it in the dev stack
  (`wa-wt demo <worktree-name>`, the till enrolled with the dev code) with Upstairs bar closed by hand
  on the dashboard: the draft line's Make at select, the Move dialog with "(closed)" and "(now)", a
  move's slip and ticket on the Printers screen's job preview — in both themes and at handheld width.
- [ ] **Step 5: Commit**: "Table: choose where a dish is made while ordering it, and move a sent dish the kitchen has not started to another station".

---

### Task 9: At the counter — "Make at…" before sending, "Move to station…" once sent

**Files:**
- Modify: `apps/till/src/widgets/basket.ts` (a `makeAtStations` property; a "Make at…" button on
  unsent rows; "Move to station…" in `#adjustActions` `:704-744` for a `movable` row),
  `apps/till/src/widgets/card-grid.ts` (passes the property, `:236-241`), `apps/till/src/till-app.ts`
  (`open-make-at` and `move-station` handlers; `ACTIONABLE_REFUSALS` `:462-466`),
  `apps/till/src/state/working-order.ts` (if 3b wrote the basket's `makeAt` write inline in
  `till-app.ts`, move it to a `setLineMakeAt(index, stationId | null)` beside `setLineCourse`)
- Test: `apps/till/src/widgets/basket.test.ts`, the counter till-app suites
  (`ls apps/till/src/till-app*counter*.test.ts`)

**Behaviour:**
- **Make at… (M1, P7).** With `makeAtStations` holding more than one station, every row the kitchen
  does not have (`sent` false, `basket.ts:425`) shows a small button: "Make at…" / "Preparar en…",
  or, when the line has one, "Make at: Grill" / "Preparar en: Parrilla". It dispatches `open-make-at`
  with the line's place in the store. The table screen's draft baskets never set the property, so they
  never show it. The app opens the dialog in make-at mode; Save writes the line's `makeAt` (null for
  the first option), which marks the basket changed, and 3b's `#currentSaleLines` sends it with the
  next save or payment. A basket line whose stored `makeAt` names a station not in the list
  (switched off since it was chosen) shows the plain "Make at…" and the app clears it once when the
  list arrives, as on the table (Task 8), so the next save is not refused `route.station_inactive`
  (3b plan:1171-1172).
- **Move to station… (M9).** On a row the stored listing has as `movable` (`listed.movable`), the
  row's actions (shown only while the listing is adjustable, as Cancel is) gain the button; it
  dispatches `move-station` with the stored line's id. The app runs the same flow as the table
  (Task 8), and on success RELOADS the counter order exactly as a counter adjustment does
  (`#rereadAdjusted` → `#reloadCounterOrder(this.#store.id, <session>)`, `till-app.ts:2562`, used at
  `:3959`). The reload reads the order and its lines from the server and replaces the basket with
  them (`loadFrom`: each line's stored `makeAt`, which 3b returns on retrieval and which the move
  set to the new station on an open order, P1; the server's current revision; the basket left
  unchanged), and re-reads `counterLines`. It does NOT patch the basket's `makeAt` or copy the move's
  revision: the move route takes no revision (M14), so copying its answer would let a basket read
  before ANOTHER till's save pass the revision check on its next save and silently drop that save
  (`updateHeldOrder` treats the request as the whole new state, `working-order.ts:4334-4341`); and a
  basket write would mark the basket changed, which hides Cancel and Move to station… on every row
  (`adjustableListing` needs an unchanged basket, `state/adjust-target.ts:27-41`). Losing nothing by
  reloading: Move to station… is offered only while the basket is unchanged (`adjustableListing`),
  so there is no unsaved edit to keep. A PAID counter order shows no line view, so
  it offers nothing (M9).
- The counter's Move dialog shows refusals through its own map. `ACTIONABLE_REFUSALS` serves
  counter pay, place and hold; it does not need move codes.

- [ ] **Step 1: Write the failing tests**: the basket shows Make at… on an unsent row only with
  `makeAtStations` of two or more, shows the chosen station's name, and dispatches `open-make-at`;
  Move to station… shows on a `movable` sent row and not on a started one; in the counter suite,
  choosing a station sets the line's `makeAt` and the next pay request carries it on that
  `SaleLine`; a basket line whose `makeAt` names a station no longer listed is cleared and the next
  save sends `makeAt: null`; **the reload after a move:** a burger made at Bar BY HAND ("Make at…"
  Bar before it was sent, so the basket holds `makeAt: <Bar>`), sent, then moved to Grill on an open
  counter order; the fake API answers the move with a new revision and the order's re-read with the
  burger at `makeAt: <Grill>` and that revision → the till re-reads the order (assert the call), the
  basket's burger shows Grill, the basket is unchanged (Cancel and Move to station… still offered),
  and pressing + on the burger then saving sends a `PUT` whose burger `SaleLine` carries
  `makeAt: <Grill>` and the re-read revision. Control: delete the reload; the `PUT` then carries
  `makeAt: <Bar>` and the revision read before the move (which the real server refuses
  `working_order.out_of_date`, because the move bumped it). **Another till's save is kept:** the
  re-read answers with a line another till added before the move (a second dish) → the reloaded
  basket shows it, and the next save sends it; a refusal shows at the bottom of the dialog.
- [ ] **Step 2: Run** (memory first) `pnpm --filter @waitron/till exec vitest run src/widgets/basket.test.ts` and the counter suite.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those, `src/widgets/basket.adjustments.test.ts`, `src/widgets/basket.a11y.test.ts`,
  `src/widgets/card-grid.test.ts` and `pnpm --filter @waitron/till typecheck`. Expected: PASS. Look at
  it in the dev stack on a counter order (Make at… before Pay, Move to station… on a retrieved order
  with a sent dish), in both themes and at handheld width.
- [ ] **Step 5: Commit**: "Counter: choose where a dish is made before it is sent, and move a sent dish to another station".

---

### Task 10: The documents catch up

**Files:**
- Modify: `packages/db/src/schema/ticket-items.ts` (`:24-27`), `apps/server/src/working-order.ts`
  (the comment block above `fireLines`, which 3a rewrote; today's `:1131-1141`),
  `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` (§5.3, `:293-294`),
  `docs/superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md` (S10 `:118-124`, the Global
  Constraint `:233-235`), `docs/backlog.md`

**M24, the sentences this slice makes false** (CLAUDE.md §1: a behaviour change retires every receipt
about the old behaviour, wherever it lives):
- `ticket-items.ts`: "with its station SNAPSHOTTED so later routing changes never reroute food already
  sent" becomes "with its station chosen when the line is sent. A routing change never moves it; a
  waiter's move (`apps/server/src/station-move.ts`) and the release of held work whose station has
  closed do." Prefer cutting to rewording (CLAUDE.md §1); keep only what the code cannot show.
- The `fireLines` comment: cut "so a later configuration change never moves an already-fired item",
  or narrow it the same way.
- The design, after §5.3's last paragraph: "_2026-10-01 (slice 3c-3, owner): a waiter can move a dish
  the kitchen has not started to another station, and a held dish released after its station closed
  goes where the rules send it then ([plan](../plans/2026-10-01-moving-dishes-slice-3c3.md)). A rule
  change alone still moves nothing already sent._"
- The 3b plan: a dated pointer at the end of S10 and of its Global Constraint naming this plan.
- Then grep the WHOLE tree, not only `apps/` and `packages/` (CLAUDE.md §1, the path-set rule):
  `grep -rn -i "snapshot.*station\|station.*snapshot\|never reroute\|never moves\|keeps the station it was first sent to\|recorded when the work is sent" --include='*.ts' --include='*.md' . | grep -v node_modules`.
  Judge EVERY hit: does this slice make it false? A sentence saying a ROUTING change never moves a
  sent dish stays true; one saying a dish's station never changes after it is sent does not. Do not
  work from a list of expected hits.

**Backlog** (`docs/backlog.md`):
- the design entry (`:197-218` today): 3c-3 built, with the PR number when it lands;
- NEW "Move to station on a paid counter order" (M9): the route accepts it; add the button to B16's
  "paid, not yet handed over" list (`docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md`,
  Task 16) once that lands;
- A167's entry, under "Left open" (`:2970-2975` today): a dated line (M16) — "_2026-10-01 (3c-3): a
  dish moved to another station leaves its ticket at the old station's printer counted by that
  printer's stuck alert in the same way, because nothing reprints there._";
- NEW "A till-session station view can bump a dish another station now has": the till-session
  route `POST /api/ticket-items/:id/advance` does not check the item's station
  (`apps/server/src/till-api.ts:1334-1346`; the device route does, `device-api.ts:247-257`, refusing
  `device.forbidden_station`), so a till's station view still showing a moved dish can bump it at its
  new station until its next 15-second poll. This is on `main` today, before this branch; a move
  makes it reachable more often.

- [ ] **Step 1:** the four documents and the grep.
- [ ] **Step 2:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (it checks backticked
  paths in `CLAUDE.md` only, so it says nothing about these files — run it only if `CLAUDE.md`
  changed), and `pnpm --filter @waitron/db typecheck`.
- [ ] **Step 3: Commit**: "Documents: a dish's station can now change after it is sent — by a waiter's move, or when held work is released after its station closed".

---

## Self-review notes

- **Decisions to tasks:** M1, M2 → Tasks 7, 8, 9. M3, M4, M5, M7, M12 → Tasks 1, 2, 3, 6. M6, M8,
  M9, M10, M11, M13, M14, M15 → Task 3 (UI halves in 8, 9). M16 → Task 10. M17 → nothing built, stated.
  M18, M19, M20, M22 → Task 4. M21 → Tasks 4, 5. M23 → Task 3 (Review Focus 7). M24 → Task 10. P1–P3
  → Tasks 3, 4; P4 → Task 7; P5, P6 → Tasks 2, 3, 6; P7 → Tasks 8, 9; P8, P12 → Tasks 4, 5; P9 →
  Task 4; P10 → Global Constraints and Task 1; P11 → Task 3; P13 → Tasks 3, 4, 7, 8.
- **Review Focus to tests:** 1, 2, 3, 7, 8, 10 in Task 3; 4 and 11 in Tasks 4 and 5; 5, 6, 9 in
  Task 4.
- **Interfaces changed on purpose:** `recordKitchenNotices` gains a ninth parameter and the
  `rerouted` kind (seat in `module.ts`); `enqueueKitchenTickets` gains `from`; `finishRelease` gains
  `rerouted`; 3c-2's `MakerResolver` gains `stations()` (the release functions keep 3c-2's
  signatures and pass its routing snapshot on to `rerouteHeldAtRelease`); `ticket_items` gains
  `station_chosen_at`; `TabLine` and the current-orders row gain
  `stationId` and `movable`; the till's `Station` gains `open`. Each task names the suites that pin
  the old shapes.
- **Codes:** new `ticket.not_sent` and `ticket.made_here` (thrown) and `route.released_at_closed_station` (a recorded
  incident under venue-service's `route.` claim). Kept and reused: `ticket.already_started`
  (description widened), `working_order.already_collected` (widened), `working_order.not_open`,
  `station.not_found`, `route.station_inactive`, `tab.line_not_found`, `submission.id_reused`,
  `kitchen_notice.invalid`.
- **Claims in this plan that were read, not run** (2026-10-01; `main` at `ebaa1f6c5`, and every
  cited server, till, venue-service, module and scripts file re-checked unchanged at `38612da08`
  with `git diff --stat`): every line number; that no key or other set's trigger names
  `kitchen_notices`; that `applyMigrations` removes and boot reinstalls the change feed around a
  rebuild (Task 1's upgrade test runs it); that a release's group is still `held` while its bills
  are released (`order-groups.ts:444-450`); that the new incident cannot meet the refusals
  `raiseDishesNotSent` guards against; and everything about 3a, 3b and 3c-2, which is read from their
  plans and the decisions sheet, not from code. RUN, by the review: the one-shot `kitchen_notices`
  migration fails `no such column`, and the two-step pair carries every row (Task 1).

## Review 1 applied

The fresh-context review (`plan-3c3-review.md`, 1 Critical, 7 Important, 12 Minor) and the
coordinator's rulings on it, all applied:

- **C1** (one-shot migration cannot apply): Task 1 now generates twice, column then kind and check,
  citing `756e3bb18` and the review's measurement; File structure names both files.
- **I1** (landing departs from the sheet): stated in Global Constraints as a deliberate narrowing and
  made **P10** for the owner's approval; any other generated shape stays a STOP.
- **I2** (no Move on a presented or paid bill on screen): Task 8 offers it on every Current orders
  row whose dish is not in Pending, with a test for the presented bill on screen.
- **I3** (no re-route on a paid bill): Review Focus 4 gains the fallback-on-a-settled-bill case with a
  proof by deletion against the freeze trigger; Review Focus 5 gains the B20 split-group case.
- **I4** (replay test could not see the gate): Review Focus 2 is now A→B, B→A, resend A→B; the proof
  by deletion names the assertion that fails.
- **I5** (several clock readings): one reading at each release entry point, threaded through every
  bill of a group, into `heldNoRouteLines` and the group's `fired_at`; Review Focus 9 pins it with a
  moving clock and a control.
- **I6** (stale make-at undoes P1): new **P11**, a server rule on the added-units path, with Review
  Focus 10 through both entry points and a proof by deletion. Server-side because a till fix cannot
  reach another till's stale copy.
- **I7** (the alert fires after routine closings): the ongoing source is gone. The release records an
  incident at the moment it leaves a dish at a station that is not open (**P8**, Task 5), with an
  area claim through `route.`, English and Spanish wording, and stated dedup. It is not raised for a
  waiter's make-at or move to a closed station (the cook agreed, as M19 and M13 say), which also keeps
  `fireLines` untouched.
- **m1** M19 compares make-at with the record's own station; **m2** "not open" is
  `missing || !active || !open`; **m3** moot (no ongoing source); **m4** Task 10's grep no longer
  enumerates expected hits; **m5** `fireLines` is "the only place that ROUTES a new record"; **m6** the
  Move dialog words five refusals itself, including `tab.line_not_found`; **m7** the
  counter clears a stale make-at; **m8** P3 says a split-off extra on another presented bill has no
  button; **m9** fixture fan-out named in Tasks 6 and 7; **m10** `packages/migrations/src/apply.ts:69`
  cited; **m11** the Move dialog's empty option when the current station is not listed; **m12** a
  backlog line for the till-session bump route that does not check the station.

## Review 2 applied

The narrow re-check (`plan-3c3-recheck.md`, 0 Critical, 5 Important, 7 Minor) and the coordinator's
rulings on it, all applied:

- **I-1** (Review Focus 9 could fail a correct implementation): every release entry point —
  `fireGroup`, `fireCourse`, `sendLines` — reads the clock as its FIRST statement, before any
  `await`, citing 3b's S9 and the in-process heartbeat timer; `moveDishesToStation` does the same.
- **I-2** (P3 promised an alert P8 never raised): the release's alert now covers a held split-off
  extra left at a station that is not open (an alert-only candidate, never re-routed); Review Focus
  11 tests it, with and without a fallback.
- **I-3** (M21 still labelled the owner's mechanism): M21 now says the owner decided the BEHAVIOUR;
  the alert's shape is this plan's default (P8), and its limits are a new numbered default, **P12**:
  one open alert per venue, later dead ends add nothing, it never clears by itself, the wording says
  there may be more.
- **I-4** (Review Focus 6 expected the wrong station): the stale-make-at case now expects the RULES'
  station (Upstairs bar), with Grill's fallback never consulted; every other Review Focus and Task 4
  case was checked for the same mistake — Review Focus 5 now says how its station is reached, and
  the course-hold and P9 cases name the fallback they rely on.
- **I-5** (a hand move on a presented or paid bill was not protected): a move now marks the kitchen
  record (`ticket_items.station_chosen_at`, a core column; expected as one `ALTER TABLE … ADD`, a
  rebuild is a STOP; `db` mutation check by hand). No existing field says "a person chose this
  station". Release keeps a marked record at its station, and does not alert it, while that station
  is switched on (M19, P1, P8 rewritten; corrected in review 3 from "never"); a paid-bill test with a
  proof by deletion pins it.
- **Minors:** m-1 Review Focus 2 asserts station and counts before the answer; m-2 Review Focus 9's
  control now predicts both mojitos move; m-3 the alert's last sentence is its own, not `MORE_EN`;
  m-4 the wording's reason covers no-preparation and extras; m-5 "a group can be fired on a bill
  paid moments before"; m-6 citations corrected (`alert-codes.test.ts:84-90`,
  `dish-not-sent-alert.ts:77-80`, `:42-54`, `:57`, `alerts.ts:2-4`); m-7 P11 widened to any line with
  a kitchen record (held included), with a held-line test. The re-check's side note — the
  schema-constraints list does not force the new check name — is stated in Task 1.

## Review 3 applied

The second narrow re-check (`plan-3c3-recheck2.md`, 0 Critical, 3 Important, 4 Minor) and the
coordinator's rulings on it:

- **I-C (ruling 1):** Task 4 reuses 3c-2's one routing snapshot — `routingOnce(tx, cfg, at)`
  (`RoutingOnce`) opening `VENUE_SERVICE.routingAt`, which every release command opens at its one
  clock reading and passes down (plan-3c2 Tasks 1, 3, 4, "Review 2 applied" I4). The parallel `at`
  parameter chain is gone, and so is the stale `heldNoRouteLines` sentence. `rerouteHeldAtRelease`
  takes the `RoutingOnce`, asks `makers` of it, and asks the stations' states of it through a new
  `MakerResolver.stations()` (answered from the snapshot's rules and moment), so a release spanning
  several bills loads the rules once. Each entry point opens the snapshot as its FIRST statement
  (moved up if 3c-2 opens it later). Review Focus 9 now spies `routingAt` (once) and `stationStates`
  (never), and its control opens a fresh snapshot per bill in `releaseGroup`. "Builds after" says the
  names come from 3c-2's landed code.
- **I-A (ruling 2):** every sentence about the mark — P1, P3, P8, the schema comment, the Review 2
  note — now says it protects a dish only while its chosen station is switched on; a hand-moved dish
  whose station is switched off is re-routed by the rules and, with no replacement, stranded and
  alerted. New Task 4 case pins both.
- **I-B (ruling 3):** after a counter move, the till sets the moved line's `makeAt` in its basket
  store to the new station and takes the move's revision; a till test checks that the next raise
  sends Grill. (Superseded in review 4: the till reloads the counter order instead.) The table holds no make-at copy of a sent line (stated, from the 3b plan). **Not
  applied as worded:** the ruling asked P11 to name "another till holding a stale station id" as the
  open limit. The code closes that case: both order edits require the order's revision
  (`requireEditableOrder`, `working-order.ts:3530-3556`) and the move bumps it, so such a till is
  refused `working_order.out_of_date` and reloads the new make-at. P11 now states that, with the
  receipt, and names the limit that does remain (a future write path taking `makeAt` without the
  revision).
- **m-A:** Global Constraints says `splitTicketItem` copies the mark; Task 3 tests that a split keeps
  it. **m-B:** the mutation check is stated as already caught (`schema-conformance.test.ts`,
  `ticket-items.test.ts`, measured by the re-check), to be re-run and recorded; the wrong grep path
  is gone. **m-C:** Review Focus 6's switched-off case switches off AFTER the hold. **m-D:** the
  catch is kept for "an alert must never fail a release" alone.

## Review 4 applied

The third narrow re-check (`plan-3c3-recheck3.md`, 0 Critical, 1 Important, 6 Minor) and the
coordinator's ruling, all applied:

- **I-1:** after a move at the counter, the till RELOADS the counter order (`#reloadCounterOrder`,
  `till-app.ts:2562`, as counter adjustments do through `#rereadAdjusted`, `:3959`) instead of
  patching the basket's "make at" and copying the move's revision. The reload brings the new "make
  at" and the server's revision and leaves the basket unchanged, so Cancel and Move to station…
  stay offered, and a save another till made before the move is kept rather than silently
  overwritten (the move takes no revision, M14, so copying its answer would have let a stale basket
  pass the revision check). Task 9's test is rewritten: the burger is made at Bar by hand before it
  is sent, the till re-reads the order after the move, and the next `PUT` carries Grill and the
  re-read revision; the control (no reload) predicts what the stale save would actually send — Bar
  and the pre-move revision, which the real server refuses `working_order.out_of_date`. A second
  case keeps another till's line through the reload. P11's sentence and the Review 3 note now say
  "reloads".
- **m-1:** the control's setup now gives the basket Bar (made at Bar by hand), so its prediction
  holds. **m-2:** "Builds after" names the routing snapshot and `onDishesOrTheirExtras` as reliances
  beyond X1, X11 and X14. **m-3:** P1 says a switched-off chosen DISH is re-routed and a split-off
  extra's record is released there and alerted. **m-4:** Architecture says the re-route goes
  through the release's one routing snapshot. **m-5:** Review Focus 5's split-group case spies
  `routingAt` (once) and `resolveMakers` and `stationStates` (never), where both bills re-route.
  **m-6:** Task 4 also runs `pnpm --filter @waitron/venue-service typecheck`.

## Amended 2026-10-01 (after approval)

Found by the 3d plan's re-check (`plan-3d-recheck.md`, I-1). This plan said a 3c-1 "made here"
record is "born `ready`", so its release re-route (which reads `state = 'queued'`) would never meet
one. As 3c-1's approved plan then stood, that held only for a made-here dish that fired at once: it
kept one sent on hold as an ordinary held record that turned `ready` at release, so this plan's
re-route and move could have picked one up and printed it at a station that never makes it.
(Superseded by the second amendment below: the owner then ruled that a made-here item is never
held.) Changed then:

- **P13 (new):** a made-here dish is never moved and never re-routed; its station stays its maker and
  nothing prints.
- **Task 4, step 1:** the release's candidates add `made_here = false`, with a test.
- **Task 3:** a move of a made-here record is refused with a new code, `ticket.made_here` (409),
  checked before `ticket.already_started`. `stillMovable` takes the mark, so `movable` is false for
  one and the till never offers Move to station…. New cases for the refusal and the `movable` flag.
- **Tasks 7 and 8:** English and Spanish wording for `ticket.made_here` in the Move dialog and the
  till's code table; it joins `LINE_REFUSALS`.
- **Builds after:** 3c-1 is now required, not "most likely" — the amendment reads its column.

## Amended 2026-10-01 (owner, after approval) — second

The owner corrected 3c-1 after approval: "a made-here item should never be held, it must be made in
the moment otherwise the waiter will forget" (3c-1 plan, T12 and T13, and its "Amended 2026-10-01
(owner, after approval)" note). Every hold path now fires a made-here item at the send, `ready`, so
the HELD made-here record the first amendment guarded against can no longer exist. Changed here:

- **P13:** restated — a made-here record is always fired and `ready`; a move of one is still refused
  `ticket.made_here`, and the till never offers the move; the release never meets one.
- **Task 3:** the refusal's reason no longer speaks of a held made-here dish: the record is `ready`,
  so without the check it would be refused `ticket.already_started`, which blames the kitchen; the
  code's description and its "why a new code" say so. The held-lager test is replaced by two that
  can exist: a lager made here at a plain send, and one made at once inside a held group.
- **`stillMovable`'s description** says a made-here record is always fired and ready.
- **Task 4, step 1:** `made_here = false` stays, described truthfully as a defence (no correct venue
  reaches it; `fired_at is null` already leaves made-here records out). The held-lager release test
  is replaced by one that can exist — a held group sent from the bar till, where the made-here mojito
  was made at once: the release re-routes the held burger and never touches the mojito — and by one
  case that inserts a held made-here row directly, the only way to exercise the defence, with its
  proof by deletion.
- **The first amendment's note** is reworded to say what 3c-1's plan said then and that this note
  supersedes it.
