# Watchers: the pass, runners and their printers (slice 3d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A venue can set up named **watchers** on Prep Stations — "Pass", following Grill, Fryer and
Cold from every service zone; "Terrace runner", following every station for the Terrace — and attach
kitchen screens and printers to them. A watcher makes nothing. Its screen lists each dish it follows
with the station making it and its progress, and the watcher marks its own copy done; its printers
print a copy of every send it follows, headed by the watcher's name, and every correction slip about
a dish on that paper. The whole-order "One ticket per order" printer setting goes: such a printer is
now a watcher's printer.

**Architecture:** Watchers are core data (`packages/db/src/schema/watchers.ts`): a `watchers` row
(name, "every station", "every zone", the "runs the pass" switch), the stations and service zones it follows
(`watcher_stations`, `watcher_zones`), the printers attached to it (`watcher_printers`), and each
watcher's own Done marks (`watcher_item_marks`, one per watcher and kitchen record). A kitchen-screen
device binds a station OR a watcher (`devices.watcher_id`, with the database's binding trigger
re-created to allow exactly one). Which service zone an order is in "now" is worked out by core
(`orderWatchZones`, `apps/server/src/watch-zones.ts`) from the party's table, then the delivery
table, then the recorded zone, which core reads for many orders in ONE call of a new venue-service
seat method (`findOrderZones`, beside B16's `findOrderModes`). The watcher's board
(`listWatcherQueue`, `apps/server/src/watcher-board.ts`) reuses the expediter board's builder, so a
watcher shows exactly what today's pass shows, filtered to what it follows and has not marked done.
Printing plans a watcher copy beside the station tickets in the same `planKitchenTickets` pass, one
ticket per watcher and paper layout, linked to no bill or station, and `printCorrectionSlips` sends
each slip to the watcher printers that see the dish. The till's pass screen (`till-expo-screen.ts`)
gains a chooser ("All stations" plus each watcher) and a watcher mode; an always-on screen bound to a
watcher boots straight into it. Prep Stations (3a's venue-service screen) edits watchers through
core's routes.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`, Lit web
components (dashboard, till and venue-service dashboard; their suites run in real headless Chromium),
Vitest.

**Branch:** `feat/watchers`, in a worktree made with
`python3 ~/workspace/tools/worktree.py new waitron feat/watchers --headless`. This plan is committed
as `docs/superpowers/plans/2026-10-01-watchers-slice-3d.md` (decisions sheet, Structure).

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§5.2 (one maker, any number of watchers), §5.9 (watchers), §5.11's last sentence (watchers do not see
made-here items), §5.12 (Prep Stations; the tester "shows the maker, the watchers") and §8 (the
whole-order printer, and the table plan). The owner split slice 3 into four plans on 2026-10-01; this
is the fourth. **Not in this plan:** the table plan's progress (design §8, first bullet: it already
shows "to serve / ready / en route" and the wait colour, W16 — a "being made" count and an automatic
floor refresh go to the backlog); takeaway and delivery orders and a "Pickup" zone (no such orders
exist yet; 3a's scope); dropping the `printers.ticket_scope` column (W20: left unused, dropped at the
next reset); a watcher on a canvas card (the `expo` card stays "All stations", P15); moving an
enrolled kitchen screen to another station or watcher without joining again (P18); an alert when a
watcher's screens go dark (P17); watchers on the kitchen screens' correction notices (W12).

**Builds after** slices 3a, 3b, 3c-1, 3c-2 and 3c-3
(`docs/superpowers/plans/2026-10-01-prep-station-rules-slice-3a.md`,
`…-station-hours-fallbacks-slice-3b.md`, `…-rest-of-order-made-here-slice-3c1.md`,
`…-split-off-extras-slice-3c2.md`, `…-moving-dishes-slice-3c3.md`), none of which is on `main` when
this plan is written, and after lane B's counter handover (B16), which **landed on `main` as #981
(`47e990c5c`, 2026-10-01 15:14)** while this plan was being written. Start this branch from a `main`
that holds all five slices. **Where this plan says "3a's X", "3b's X", "3c-1's X", "3c-2's X" or
"3c-3's X", read X in the landed code, not in that plan: the code is what landed.** The names this
plan leans on, from those plans: 3a's Prep Stations screen
(`packages/venue-service/src/dashboard/prep-stations-screen.ts`), its client (`PrepStationsApi`,
`routing-client.ts`), its tester (`explainRoute`, `RouteExplanation`) and its `routing` live-query
entry; 3b's `stationScreensDark` and `stationPrintersDown` (`apps/server/src/station-outputs-down.ts`);
3c-1's `ticket_items.made_here` and `planKitchenTickets`' `restOfOrderExcept`; 3c-2's split-off extra
records and their cross-references (`crossRefs` on `ExpoItem` and on `KitchenTicketItem`); 3c-3's
`enqueueStationMoved`, the `from` option of `enqueueKitchenTickets`, `moveDishesToStation`,
`rerouteHeldAtRelease` and its two-part `finishRelease`. Line numbers below were read on `main` at
`47e990c5c`, and every one the two reviews touched was re-read at `107746610` (B24, #984, and A156, #983, landed in
between; B24 moved `till-app.ts`, and `working-order.ts` after its `:4513`, by a line or two; A156
touched only `packages/media`); 3a–3c move many of them in `working-order.ts`, `kitchen-print.ts` and `till-app.ts`, so
find each place by the function named beside the number.

## Decisions for the owner (W1–W27, and the plan's own P1–P19)

The owner settled W1, W4, W6 and W20 on 2026-10-01. Every other W is a default from the slice 3d
decisions sheet (2026-10-01), and approving this plan approves them. P1–P19 are this plan's own
defaults; approving the plan approves them too.

**The watcher (screens and printers)**

- **W1. A watcher is a NAMED thing (owner),** set up on Prep Stations: a name ("Pass", "Terrace
  runner"), the stations and service zones it follows, and its switch. Kitchen screens and printers
  attach to it. Two screens at one pass share one list and one set of Done marks. Watchers and what
  they follow travel in configuration export; which screen shows which watcher does not (devices are
  never exported). A printer's attachment travels, because printers' settings already do (core copies
  `printers` and `station_printers` whole, `packages/db/src/configuration-transfer.ts:27-33`).
- **W2. A watcher is not a station.** Nothing that picks or lists a station that makes food — claims,
  exceptions, fallbacks, "Make at", "Move to", the default, the till's station list, 3b's alerts —
  ever sees one.
- **W3. What it follows:** a list of stations, or "every station" (so a station added later is
  included), AND a list of service zones, or "every zone". A dish is the watcher's when BOTH match.
  "Every station, Terrace" is a terrace runner; "Grill, Fryer, Cold, every zone" is the pass.
- **W4. Away stays exactly as it is (owner):** one shared "the pass sent it out" per dish, which the
  floor's "en route" and other features read. Every watcher ALSO gets its own private Done, which only
  it sees.
- **W5. Done is per dish, with "All done" on each order card.**
- **W6. Fire (owner):** each watcher has a switch, "Fires held courses and groups". When the venue's
  fire control is "the pass", Fire appears only on watchers with that switch, and only on a till where
  someone is signed in (every fire records who did it), as today. **P4 widens and renames this
  switch; the owner is asked to confirm it.**
- **W7. An always-on watcher screen** (no one signed in, a device bound to the watcher) can mark its
  own Done and nothing else: no Fire, Ready or Away. Its Done records the device.
- **W8. Which zone an order is in, for a zone watcher:** where the food goes now — the party's table,
  else the delivery table, else the zone the order was taken in (counter orders). A presented bill
  whose guests moved still records its old zone, so the recorded zone alone is not enough. Many orders
  are read in one set-based venue-service call, never one call per order.
- **W9. Lines that need no preparation are not shown.**
- **W10. Split-off extras (3c-2) appear on their own,** with their cross-reference ("for Burger at
  Grill"). Made-here items (3c-1) never appear.
- **W11. A dish leaves a watcher** at the watcher's own Done, when it is fully served, or when its
  order is handed over or discarded. Task 1 checks first what removes a paid TABLE bill's dishes
  today. Read on `main`: a table bill paid through `payWorkingOrder` or `takeBillPayment` is settled
  with no handover stamp (`fileImmediateSale` is called without its `markCollected` flag,
  `apps/server/src/till-sale.ts:494`; a bill payment that pays it in full settles it in
  `issueWhenFullyPaid`, which writes its label, status and settled time and no handover,
  `apps/server/src/bill-payments.ts:722-725`), so its dishes stay on the station screens until a
  cook presses Collect (`markCollected` accepts any settled order, `apps/server/src/working-order.ts:4730`).
  On a watcher, a paid table bill's dish therefore leaves by Done, by being served, or by a Collect.
- **W12. Watcher screens show no kitchen correction notices** (recalled, cancelled, moved): a notice
  is acknowledged once per station, and a watcher acknowledging it would clear it from the cook.
  Watcher PRINTERS do get slips (W25).
- **W13. A watcher screen asks again every 15 seconds,** like the kitchen screen. No push channel.
- **W14. Today's pass ("Expo"):** the button opens a list — "All stations" (today's pass, unchanged)
  plus each watcher. Nothing a venue uses today disappears.
- **W15. A watcher screen device is bound to a watcher, not a station.** Today a database trigger
  makes every kitchen-screen device bind one station (`device_binding_rule_insert` / `_update`,
  `packages/db/drizzle/0001_behavioural_triggers.sql:379-412`); this plan re-creates both triggers so
  a kitchen screen binds exactly one of a station or a watcher. 3b's "screens went dark" alert never
  counts a watcher screen.
- **W16. The table plan (design §8) is out of 3d.** A "being made" count and an automatic floor
  refresh go to the backlog.
- **W17. Who edits watchers:** whoever can edit stations (`venue.configure`), on Prep Stations.
- **W18. Lateness colours:** each dish by its own station's thresholds, as the pass does today —
  except a dish the pass has sent out, on a watcher's board (P19).
- **W19. Dev and demo:** the demo seed adds a "Pass" watcher following the kitchen stations, and
  `dev-setup` a screen for it, openable from the device chooser.

**Printers**

- **W20. "One ticket per order" goes (owner):** the setting disappears from screens and code now; such
  a printer becomes a printer attached to a watcher. The `printers.ticket_scope` column is left in the
  database, unread (dropping it rebuilds `printers`, which a venue that has printed refuses — measured
  by the printers research for #974's `0055`), and is deleted at the next reset; a backlog entry says
  so. No conversion step (owner: no box printer uses it).
- **W21. A printer either makes or watches, never both** — refused when saved — or it would print some
  dishes twice.
- **W22. A watcher's ticket is headed by the watcher's name** ("Pase", "Runner terraza"), not "PASE".
  It prints per send, listing each station's items under that station's name (today's PASE layout).
  Cross-references (3c-2) print on it; "Show the rest of the order" (3c-1) does not apply.
- **W23. A watcher copy that fails to print does not show "Printing problem"** on the table or the
  stations: the dish is not missing at its station; the printer's own "jobs waiting" alert covers it.
- **W24. A watcher's HOLD copy counts as "the HOLD ticket printed"** (as the pass copy does today), so
  later changes to held work send HOLD CHANGED / HOLD CANCELLED to it.
- **W25. Watcher printers get every correction slip about a dish on their paper** — VOID, RECALLED,
  HOLD CHANGED, HOLD CANCELLED, EXTRA CANCELLED, MOVED (table), and 3c-3's MOVED TO — with the move
  rules: a watcher that sees the dish both before and after a station move gets nothing; one that saw
  it only before gets the "moved to" slip; one that sees it only after gets a copy with "From Bar"; a
  table move sends MOVED to every watcher that saw the dish before it or sees it after. This fixes
  today's gap where a PASE printer misses the VOID for a dish it printed through another station.
- **W26. Reprint includes watcher printers** (Reprint stays "reprint everything for this order").
- **W27. Nothing here touches the cash drawer or receipt jobs** (CLAUDE.md §5); kitchen and watcher
  jobs stay `document` jobs.

**The plan's own defaults (P1–P19)** — not discussed with the owner; approving the plan approves them.

- **P1. Watchers are core, not venue-service.** Kitchen screens (`devices`), printers and the kitchen
  records a watcher shows are core tables; the device binding is a core trigger; the till and device
  routes that read a watcher are core; and core dashboard code (the Devices and Printing rules
  screens, which bind screens and printers to a watcher) may not call `/management-api/venue-service/*`
  (3a R10). Prep Stations is venue-service's screen, and a module screen calling core routes is the
  shape 3a already uses for stations. The one thing venue-service owns — each order's recorded service
  zone (`order_service_contexts`) — core reads through a new seat method, `findOrderZones`, set-based,
  beside B16's `findOrderModes` (`packages/module/src/module.ts:363-368`).
- **P2. A watcher must follow something on both axes:** at least one station or "every station", and
  at least one zone or "every zone"; otherwise it is refused (`management.request_invalid` naming
  `stationIds` or `zoneIds`). "Every zone" includes orders with no zone at all (a counter order taken
  on a till with no default zone), so the pass sees them.
- **P3. Removing a watcher switches it off (`active` false), as stations are switched off.** Its name
  is free again (the name is unique among switched-on watchers only), its printers are detached in the
  same transaction, and a screen still bound to it shows "This screen's watcher was removed. Ask a
  manager to set this screen up again." Why not delete the row: devices are never deleted
  (`packages/db/src/schema/devices.ts:13-14`) and keep pointing at it.
- **P4. FOR THE OWNER — W6's switch becomes ONE switch, "Runs the pass" / "Lleva el pase", which
  widens the owner's "Fires held courses and groups".** A watcher with it, opened at a till where
  someone is signed in, shows Fire (only when the venue's fire control is "the pass", as W6 says),
  and Ready and Away, for whole courses and groups; a watcher without it shows only Done and "All
  done". An always-on screen never shows any of the three, with or without the switch (W7). Why the
  owner's switch is widened rather than left alone: Ready and Away, like Fire, act on the WHOLE course
  or group at every station (`bumpCourseReady`, `markCourseAway`, `bumpGroupReady`, `markGroupAway`),
  so a watcher that follows only Grill would send the bar's drinks out too; today's pass shows them to
  every signed-in till. Keeping the owner's name while giving the switch this second job would leave
  it labelled "fires" under the "kitchen" and "waiter" fire-control settings, where it fires nothing
  and only shows Ready and Away. The stored column is `runs_pass`; the screen's line under the switch
  reads "Shows Fire (when the pass fires held work), Ready and Away for whole courses and groups." If
  the owner wants Fire and Ready/Away on separate switches instead, it is a second flag column on
  `watchers` (a plain added column) and a second `wt-switch` in Task 13.
- **P5. Away on a watcher also marks that section's shown dishes Done for that watcher** (a second
  request after the Away succeeds), so the pass does not have to clear what it has just sent out.
- **P6. A dish marked Done disappears, with "Undo" for the last Done for 10 seconds.** Undo deletes
  the mark; the dish comes back.
- **P7. "All stations" (today's pass) also asks again every 15 seconds** — it is the same screen, and
  today it never refreshes on its own (`apps/till/src/screens/till-expo-screen.ts:426-439` reads on connect and after its
  own actions only). This is the one change to today's pass; striking P7 keeps it as it is.
- **P8. The chooser:** with no switched-on watcher, the Expo button opens "All stations" directly, as
  today. With one or more, it opens a list; the choice is kept in the address (`till-watcher`), as the
  station screen keeps its station.
- **P9. A watcher copy is linked to no bill or station** (no `kitchen_print_jobs` or
  `kitchen_print_job_lines` rows), which is what keeps it out of "Printing problem" (W23). Cost: like
  a correction slip today, a failed copy stays in the printer's "jobs waiting" alert until it prints
  or is resent from the Printers screen; a Reprint does not clear it there
  (`printJobInTrouble`, `apps/server/src/print-job-trouble.ts:38-78`, clears a kitchen ticket by a
  later printed reprint only through its link rows). A backlog entry records it.
- **P10. At a release, watcher copies are built once per release, from the same list
  `finishRelease` hands its station parts.** That list never holds a made-here record, because
  nothing made here is ever held (3c-1's T12, amended by the owner on 2026-10-01: a made-here item is
  fired and `ready` at the send that records it), and every release stamps and prints only records
  with no fire time (`releaseHeld`, `apps/server/src/working-order.ts:1532`; `sendLines`, `:1624`).
  3d's own made-here drop in the watcher paths (Task 9) is a defence, not what keeps them off. For each watcher printer,
  every released dish it sees at the dish's final station is on ONE copy marked FIRE when the release
  is — except a dish 3c-3 re-routed that the watcher did NOT follow at its old station: that dish goes
  on a copy of its own per old station, with the "From Upstairs bar" line and no FIRE header, as W25
  says for a dish new to a watcher and as 3c-3's M22 does on station paper. A watcher that followed a
  re-routed dish at both stations is waiting for the FIRE on its HOLD copy, so it gets the dish on the
  marked copy. A watcher that followed it only at the old station gets 3c-3's HOLD CANCELLED slip
  (W25's "saw it only before").
- **P11. The watcher reads run inside `withTransaction`,** as the station screen's do
  (`apps/server/src/device-api.ts:206-210`). Cost (read, not measured): `withTransaction` is the venue
  file's write lock (`packages/db/src/tenancy.ts`), so each screen's 15-second read queues behind a
  sale and a sale behind it, as every kitchen screen's does today.
- **P12. UI words:** "Watchers" / "Puntos de seguimiento", one "Watcher" / "Punto de seguimiento";
  "Every station" / "Todas las estaciones"; "Every service zone" / "Todas las zonas de servicio";
  "Done" / "Hecho"; "All done" / "Todo hecho"; "Undo" / "Deshacer"; "All stations" /
  "Todas las estaciones"; the switch "Runs the pass" / "Lleva el pase" (P4); "Sent out" /
  "Despachado" on a dish already sent out by the pass (a new `expo.sent_out`; not the till's
  `table.group_away` "En route" / "En camino", which in Spanish reads the same as the Away lever
  `expo.away`, "En camino", on the same card; and not "Enviado", which the till already uses for
  "sent to the kitchen", `table.group_sent` and `waiting.sent_not_paid`, `strings.ts:1141`, `:924`).
- **P13. Prep Stations shows, on each station card, "Watched by: Pass, Terrace runner",** and the
  tester names the watchers that would see the product it is asked about (3a: "watchers join the
  tester in 3d").
- **P14. A printer still set to "one ticket per order" on an existing venue becomes a station printer
  of the stations it is attached to when this lands** (W20: no conversion): it prints each of those
  stations' own tickets until someone attaches it to a watcher instead. The PR body says so.
- **P15. The `expo` card on a canvas keeps showing "All stations".** A card showing one watcher is a
  backlog entry.
- **P16. Done marks are kept per kitchen record.** A split copies the marks to the split-off record
  (`splitTicketItem`); an edit that replaces a dish's record drops them, so the changed dish comes
  back as not done (the dish changed); 3c-3's move keeps the record, so the mark stays.
- **P17. No "screens went dark" alert for a watcher's screens** in 3d; a backlog entry.
- **P18. An enrolled kitchen screen is bound when it joins and cannot be moved to another station or
  watcher without joining again,** as today for stations (no device route changes which station a screen shows;
  `apps/server/src/device-api.ts:291-368`); a backlog entry.
- **P19. FOR THE OWNER — on a watcher board, a sent-out dish no longer colours its order.** A dish
  the pass has sent out (its `away_at` set) shows "Sent out" / "Despachado" and no lateness colour
  and no "Forgotten" flag, and it counts towards neither its order's colour nor the overdue count —
  on a watcher's board only. The rule is per dish, narrower than today's pass, which leaves out of an
  order's colour only sections that are wholly away (`#orderBand`, `till-expo-screen.ts:773-780`).
  "All stations" keeps today's `#item` and `#orderBand` unchanged. Why: on a watcher's board a
  sent-out dish stays until the watcher's own Done (W4, W11), and timed from when it was queued it
  would turn "forgotten" and flash for a dish that left the kitchen long ago.

## Global Constraints

- **Landing: LANDS when green** (the review wave clean and required CI passing) unless a generated
  migration rebuilds a table holding rows — then STOP: the landing rule becomes needs-owner-review.
  Task 2's generated migration is expected to be plain `CREATE TABLE`s, one `CREATE INDEX`, one
  `CREATE UNIQUE INDEX` and one `ALTER TABLE devices ADD … REFERENCES` (measured, Task 2); the custom
  migration re-creates two triggers, not a table. No venue reset is expected.
- Every commit: `git commit -s`, message in plain English (owner rule; name files and codes once as
  pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or an ignore
  comment. **Mutation-tested package touched:** `db` (Task 2's schema file and the `devices` column);
  Task 2 hand-mutates them. `ui`, `ui-core`, `shared` and `fiscal` are not touched.
- Every colour, spacing, radius and font reads a `--wt-*` token. No hex, no named colour, no new
  `rem`/`em`.
- Forms follow `docs/developers/design-system.md` → Forms: required fields visibly marked; a field's
  problem beside the field; a hint as the field's placeholder; the form's refusal message on its own
  line at the BOTTOM of the form (in a dialog, at the end of its body), never beside the buttons; every
  input has a semantic `name`. A Lit `<select>` whose options come from an expression marks the chosen
  option with `.selected` (CLAUDE.md §3).
- Every new string in English AND Spanish: core dashboard strings in `apps/dashboard/src/i18n/strings.ts`
  and refusal words in `apps/dashboard/src/i18n/codes.ts`; Prep Stations in
  `packages/venue-service/src/dashboard/strings.ts`; till words in `apps/till/src/i18n/strings.ts`
  (its Spanish table is typed `Record<StringKey, string>`, so a missing entry fails the typecheck) and
  till refusal words in `apps/till/src/i18n/codes.ts`.
- Each surface shows ONE of a product's three names (CLAUDE.md §3): the watcher board and the watcher
  copy are kitchen surfaces and read kitchen names (they reuse the expo builder and
  `buildTicketItems`). Every fixture product gives the staff, customer-facing and kitchen names
  DIFFERENT text (`apps/server/src/testing/party-venue.ts`'s `MENU` already does).
- Error codes name the domain concept. New: `watcher.not_found { watcherId }`,
  `watcher.name_taken { name }` (sibling of `station.name_taken`, `apps/server/src/errors.ts:580`) and
  `printer.makes_and_watches { id }` (sibling of the host's `printer.*` codes,
  `apps/server/src/errors.ts:36-42`; `id` as `printer.not_found { id }` names a printer,
  `packages/printing/src/errors.ts:11`). Before committing each, `grep -n '"watcher\.\|"printer\.\|"station\.' apps/server/src/errors.ts packages/*/src/errors.ts`.
  Every file that throws a code imports its registry (`import "./errors.js"`).
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter @waitron/db db:generate --name <name>`; hand-written SQL with
  `pnpm --filter @waitron/db db:generate:custom --name <name>`. READ every generated file: an
  unexpected `__new_<table>` rebuild is a STOP (CLAUDE.md §3). Numbers here are illustrative; the
  generator picks the next free one. A number collision on rebase is fixed by resetting
  `packages/db/drizzle` to `main`'s state and regenerating — never by hand-editing the snapshots or
  `_journal.json` — then running the guard set: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. Copy the
  custom trigger migration's body to `/tmp` before resetting the folder.
- No new table enters the core migration set without a stated reason in the commit (CLAUDE.md §3):
  Task 2's commit message says why the five tables are core (P1).
- Module boundary: core code reaches venue-service only through `VENUE_SERVICE`
  (`apps/server/src/modules.ts:16`, contract `packages/module/src/module.ts`); core dashboard code
  never calls `/management-api/venue-service/*`; the venue-service dashboard imports only TYPES from
  core-free modules and calls core routes over HTTP.
- One transaction per request; every function below that writes takes a `tx` and opens none; queries
  on one transaction are awaited in turn, never `Promise.all` (CLAUDE.md §3). Rewriting a watcher's
  followed stations or zones deletes the set, then inserts the new one (CLAUDE.md §3: rewriting rows
  one at a time can break a unique index). Every `onConflictDoNothing` names its target.
- The one place a station is chosen and a kitchen record is written stays `fireLines`; a watcher
  changes no record's station or state. Done writes only `watcher_item_marks`.
- **3c-3's P12 stays true:** no device route fires, readies or sends away anything (W7); the till
  routes that do still require a signed-in session. Do not add one.
- Browser suites: check `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`
  before a browser run; do not start one beside a whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

The inputs likeliest to hurt a venue, each pinned by a test in the task named:

1. **The pass sees what it follows, from every zone.** "Pass" follows Grill, Fryer and Cold, every
   zone. A burger at Grill for a Terrace table and a burger at Grill for an indoor table are both on
   its board; a lager at Bar on the same Terrace order is not. (Task 6)
2. **A runner sees its zone, and lets go when the party moves.** "Terrace runner" follows every
   station, Terrace. It sees the Terrace burger and lager, not the indoor burger; after the Terrace
   party moves to an indoor table it sees neither — including a PRESENTED bill of that party, whose
   recorded zone is still Terrace (W8). (Tasks 5, 6)
3. **Two pass screens share one Done.** Screen A marks the Terrace burger done; screen B's next read,
   bound to the same watcher, no longer lists it; the runner (another watcher) still does. (Tasks 6, 7)
4. **Done on a watcher changes nothing anyone else sees.** After Done: the record's `state`,
   `away_at` and station are unchanged, it is still on Grill's queue and on "All stations", and the
   floor's counts are unchanged. (Task 6)
5. **Fire only where the switch is, and never from an unattended screen.** The Fire lever appears on
   a watcher that runs the pass (P4), opened at a signed-in till, when fire control is "the pass"; not
   on one without the switch, and not on an always-on screen; a device-cookie request to the course or
   group fire route is refused `session.required` (that refusal already holds today; the test pins
   it). (Tasks 7, 10, 11)
6. **What a watcher never shows.** A made-here lager (3c-1) and a no-preparation water never appear;
   a split-off portion of chips (3c-2) appears on its own with "for Burger at Grill". (Task 6)
7. **A paid table bill.** Its dishes stay on a watcher until served, marked done, or collected —
   Task 1 first pins that payment alone does not take them off today's screens. (Tasks 1, 6)
8. **A watcher printer prints one ticket per send, headed by the watcher's name.** A send of a burger
   (Grill), chips (Fryer) and a lager (Bar) gives the Pass printer ONE ticket headed "Pase", listing
   Fryer's and Grill's items under their names and no lager, alongside the stations' own tickets; it is
   linked to no station, so its failure shows no "Printing problem". (Task 8)
9. **The VOID reaches the paper that listed the dish, and a station move alone prints nothing for a
   zone runner.** A watcher following Grill and Bar printed a steak and a beer; voiding the beer gives
   it a VOID slip (today's PASE gap). A dish moved from Grill to Downstairs grill (3c-3) gives the
   Terrace runner's printer nothing, a Grill-only watcher a "moved to" slip, and a Downstairs-grill-only
   watcher a copy with "From Grill". (Task 9)
10. **Make or watch, never both.** Attaching a printer to a watcher while it is attached to a station
    is refused `printer.makes_and_watches`, and so is the reverse. (Task 4)
11. **3b's dark-screen alert ignores watcher screens.** A dark watcher screen does not raise Grill's
    alert, and a live watcher screen does not hide Grill's own dark screen. (Task 7)
12. **No drawer.** A watcher printer that has a cash drawer gets only `document` jobs. (Task 9)
13. **Away does not take a dish off a runner.** The pass presses Away on the Terrace party's course:
    "Terrace runner" still lists the burger, shown "Sent out", until the runner marks it done (or it is
    served, handed over or discarded, W11). The pass's own board clears it (P5). (Tasks 6, 10)
14. **A made-here dish never reaches a watcher's paper.** A lager made here, sent from the bar till in
    a send that holds the rest of the order, is on no watcher copy — not at the send, and not when the
    held dishes are released later, including at a station that has closed (3c-3's re-route path) —
    and a move of it is refused (3c-3's P13); and 3d's own watcher copy and slip code leaves a
    made-here record out even when a caller hands it one. (Task 9)

---

## File structure

**Created**

- `packages/db/src/schema/watchers.ts` + `watchers.test.ts` — `watchers`, `watcherStations`,
  `watcherZones`, `watcherPrinters`; `packages/db/src/schema/watcher-item-marks.ts` —
  `watcherItemMarks` (the test file covers both).
- `packages/db/drizzle/00NN_watchers.sql` (generated) and `00NN_device_binding_watcher.sql` (custom).
- `apps/server/src/watchers.ts` + `watchers.test.ts` — the store, `watcherSees`, `setPrinterWatcher`.
- `apps/server/src/watch-zones.ts` + `watch-zones.test.ts` — `orderWatchZones`.
- `apps/server/src/watcher-board.ts` + `watcher-board.test.ts` — `listWatcherQueue`,
  `markWatcherItems`.
- `apps/server/src/watchers.leave.test.ts` — Task 1's characterization of today's leave rule.
- `apps/server/src/till-api.watchers.test.ts` — the till and device watcher routes.
- `apps/server/src/kitchen-print.watchers.test.ts` — watcher copies and slips.
- `apps/server/scripts/demo-seed/seed-watchers.ts` + `seed-watchers.test.ts`.
- `packages/venue-service/src/dashboard/watcher-form.ts` + `.test.ts`;
  `packages/venue-service/src/dashboard/watchers-seen.ts` + `.test.ts` (pure: which watchers see a
  station and zone).

**Modified (main ones)** — each task lists its own exactly.

- `packages/db/src/schema/{devices,index,printers,kitchen-print-jobs}.ts`, `packages/db/src/{classification,trigger-refusals,configuration-transfer,index}.ts`
- `packages/module/src/module.ts`, `packages/venue-service/src/{operations,service}.ts`
- `packages/printing/src/printers.ts`
- `apps/server/src/{kitchen-print,kitchen-ticket,working-order,management-api,print-api,station-printers,device-api,device-session,device,join-requests,join-api,till-api,errors}.ts`,
  `apps/server/src/testing/{enrol,clear-provision-fixture}.ts`, `apps/server/scripts/dev-setup.ts`,
  `apps/server/scripts/demo-seed/{seed,seed-catalogue}.ts`
- `apps/till/src/{api/client,navigation,till-app,i18n/strings,i18n/codes}.ts`,
  `apps/till/src/screens/till-expo-screen.ts`, `apps/till/src/widgets/card-grid.ts`
- `apps/dashboard/src/{api/client,api/live-queries,i18n/strings,i18n/codes}.ts`,
  `apps/dashboard/src/screens/{printing-rules-screen,printers-screen,devices-screen}.ts`
- `packages/venue-service/src/dashboard/{prep-stations-screen,routing-client,strings,live-queries}.ts` (3a's)
- `scripts/schema-constraints.test.ts`, `scripts/behavioural-triggers.test.ts`
- `docs/backlog.md`, the design spec, `docs/developers/products.md`, `docs/developers/conventions-ui.md`
  (only if Task 15's sweep finds a printing rule there)

---

### Task 1: What takes a paid table bill's dishes off the kitchen screens today (W11)

A characterization test, written BEFORE anything relies on it: W11's leave rule assumes payment
alone takes nothing off a screen. Its "Expected" is PASS — it pins today's behaviour. **If it fails,
the facts have changed (a lane after B16 stamps a handover on table bills): STOP, report to the
supervising session, and do not build W11's rule until the owner has said what a watcher does.**

**Files:**
- Create: `apps/server/src/watchers.leave.test.ts` (later tasks add watcher cases to it)

**Setup:** `useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) })` and
`setupPartyVenue(suite.db)`, as `apps/server/src/table-signals.test.ts:69-72` builds its venue. Find
the venue's own station as that file's `cocina` helper does. Every dish routes to the default station
unless a test routes it elsewhere (3a's `routeProductTo`, `apps/server/src/testing/zone-offers.ts`).

- [ ] **Step 1: Write the test.**

```ts
describe("what takes a paid table bill's dishes off today's kitchen screens", () => {
  it("leaves a table bill paid at the till on the station queue and the pass until it is collected", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 1"));
    await orderForParty(v, partyId, ["Burger"], tabId);
    await pay(v, tabId, "12.00"); // payWorkingOrder, apps/server/src/till-sale.ts:441
    expect(await billRow(v, tabId)).toMatchObject({ status: "settled", collectedAt: null });
    expect(await onStationQueue(tabId)).toBe(true); // listStationQueue(tx, cocina)
    expect(await onPass(tabId)).toBe(true); // listExpoQueue(tx, v.cfg)
    await markCollected({ db: v.db }, v.cfg, tabId);
    expect(await onStationQueue(tabId)).toBe(false);
    expect(await onPass(tabId)).toBe(false);
  });

  it("leaves a table bill paid in full through a bill payment on both, too", async () => {
    // As above, but paid with takeBillPayment for the bill's whole balance, as
    // apps/server/src/table-signals.test.ts:610-624 pays one (kind "contribution", cash).
  });
});
```

  `billRow` and `orderForParty` are `apps/server/src/testing/party-venue.ts`'s; `onStationQueue` and
  `onPass` are two small helpers in the file that answer whether any group or order of the result
  has `orderId === tabId`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/watchers.leave.test.ts`.
  Expected: PASS (read on `main`: `fileImmediateSale` is called without `markCollected` from
  `payWorkingOrder`, `apps/server/src/till-sale.ts:494`, and `issueWhenFullyPaid` writes the label,
  status and settled time and no handover, `apps/server/src/bill-payments.ts:722-725`). Control: temporarily pass `true` as
  `fileImmediateSale`'s `markCollected` at `till-sale.ts:494` and confirm the first case fails on
  `collectedAt: null`; restore it. Control for the second case, on the product path: temporarily add `collectedAt: settledAt` to
  `issueWhenFullyPaid`'s update (`apps/server/src/bill-payments.ts:722-725`), confirm the second case
  fails on `collectedAt: null`, and restore it.
- [ ] **Step 3: Commit** — `git add apps/server/src/watchers.leave.test.ts && git commit -s -m "Tests: a paid table bill's dishes stay on the station queue and the pass until a cook collects the order"`

---

### Task 2: Storage — watchers, what they follow, their printers and Done marks, and a screen bound to a watcher

**Files:**
- Create: `packages/db/src/schema/watchers.ts` (`watchers`, `watcherStations`, `watcherZones`,
  `watcherPrinters`) and `packages/db/src/schema/watcher-item-marks.ts` (`watcherItemMarks`, in its own
  file because it keys `devices`, and `devices.ts` imports `watchers.ts`: one file would be an import
  cycle). Export both from `packages/db/src/schema/index.ts`, after `station-printers.js` (`:22`), and
  the five tables from `packages/db/src/index.ts` beside `stationPrinters` (`:112`).
- Modify: `packages/db/src/schema/devices.ts` — after `stationId` (`:23-25`):
  `watcherId: id("watcher_id").references(() => watchers.id),` inside the same
  `/* v8 ignore start */` … `/* v8 ignore stop */` pair shape the file uses for `stationId`; and the
  header (`:7-11`): "a `kds` device binds a kitchen station OR a watcher, and no till".
- Create (generated): `packages/db/drizzle/00NN_watchers.sql`
- Create (custom): `packages/db/drizzle/00NN_device_binding_watcher.sql`
- Modify: `packages/db/src/trigger-refusals.ts:52-56` — `KDS_BINDING_REFUSAL` becomes
  `"a kds device binds a station or a watcher, and no register"` and `REGISTER_BINDING_REFUSAL`
  `"a non-kds device binds a register and no station or watcher"`, with their doc lines.
- Modify: `packages/db/src/classification.ts` — beside `station_printers` (`:87`):
  `classify("watchers", "state", STATE)`, `classify("watcher_stations", "state", STATE)`,
  `classify("watcher_zones", "state", STATE)`, `classify("watcher_printers", "state", STATE)`,
  `classify("watcher_item_marks", "state", "each watcher's own Done marks, live service in flight; copied to a standby, never drained back")`.
  Being `state`, each is a change source (`CORE_CHANGE_SOURCES`), which the live queries need.
- Modify: `scripts/schema-constraints.test.ts` — `EXPECTED_FOREIGN_KEYS` (alphabetical place, beside
  `devices` at `:67-71` and `station_printers` at `:198-199`):
  `["devices", ["watcher_id"], "watchers"]`, `["watcher_item_marks", ["done_by_device_id"], "devices"]`,
  `["watcher_item_marks", ["ticket_item_id"], "ticket_items"]`, `["watcher_item_marks", ["watcher_id"], "watchers"]`,
  `["watcher_printers", ["printer_id"], "printers"]`, `["watcher_printers", ["watcher_id"], "watchers"]`,
  `["watcher_stations", ["station_id"], "kitchen_stations"]`, `["watcher_stations", ["watcher_id"], "watchers"]`,
  `["watcher_zones", ["watcher_id"], "watchers"]`, `["watcher_zones", ["zone_id"], "floor_zones"]`,
  `["watchers", ["location_id"], "locations"]`; `EXPECTED_UNIQUE_INDEXES` (`:242`):
  `"watchers_name_key"`; `EXPECTED_CHECK_CONSTRAINTS` (`:329`): `"watcher_item_marks_done_by_ck"`.
- Modify: `scripts/behavioural-triggers.test.ts` — new cases in the two binding `describe`s
  (`device_binding_rule_insert` at `:1283`, `device_binding_rule_update` after it); the existing cases
  keep their assertions (they read the two constants, which now hold the new words).
- Modify: `apps/server/src/testing/clear-provision-fixture.ts` — `"watcher_item_marks"`,
  `"watcher_printers"`, `"watcher_stations"`, `"watcher_zones"`, `"watchers"`, in that order, before
  `"kitchen_stations"` (each keys a table deleted later in the list).
- Create: `packages/db/src/schema/watchers.test.ts`

**Schema** (`watchers.ts`; the column vocabulary from `./columns.js`, CLAUDE.md §3):

```ts
import { sql } from "drizzle-orm";
import { foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { floorZones } from "./floor-zones.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { locations } from "./tenants.js";

/**
 * A point of view on the kitchen that makes nothing (design §5.9): it follows stations and service
 * zones, and a dish is its when both match. Switched off rather than deleted, because devices point
 * at it and are never deleted.
 */
export const watchers = table(
  "watchers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    everyStation: flag("every_station").notNull().default(false),
    everyZone: flag("every_zone").notNull().default(false),
    runsPass: flag("runs_pass").notNull().default(false),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("watchers_name_key").on(t.locationId, t.name).where(sql`${t.active}`),
    foreignKey({ columns: [t.locationId], foreignColumns: [locations.id], name: "watchers_location_fk" }),
  ],
);

export const watcherStations = table(
  "watcher_stations",
  { watcherId: id("watcher_id").notNull(), stationId: id("station_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.watcherId, t.stationId], name: "watcher_stations_pk" }),
    foreignKey({ columns: [t.watcherId], foreignColumns: [watchers.id], name: "watcher_stations_watcher_fk" }),
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "watcher_stations_station_fk" }),
  ],
);

export const watcherZones = table(
  "watcher_zones",
  { watcherId: id("watcher_id").notNull(), zoneId: id("zone_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.watcherId, t.zoneId], name: "watcher_zones_pk" }),
    foreignKey({ columns: [t.watcherId], foreignColumns: [watchers.id], name: "watcher_zones_watcher_fk" }),
    foreignKey({ columns: [t.zoneId], foreignColumns: [floorZones.id], name: "watcher_zones_zone_fk" }),
  ],
);

/** A printer that prints a watcher's copies; keyed by the printer, so it serves one watcher. */
export const watcherPrinters = table(
  "watcher_printers",
  { printerId: id("printer_id").primaryKey(), watcherId: id("watcher_id").notNull() },
  (t) => [
    foreignKey({ columns: [t.printerId], foreignColumns: [printers.id], name: "watcher_printers_printer_fk" }),
    foreignKey({ columns: [t.watcherId], foreignColumns: [watchers.id], name: "watcher_printers_watcher_fk" }),
  ],
);
```

`watcher-item-marks.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { ticketItems } from "./ticket-items.js";
import { watchers } from "./watchers.js";

/** A watcher's own Done on one kitchen record (W4): private to that watcher, gone with the record. */
export const watcherItemMarks = table(
  "watcher_item_marks",
  {
    watcherId: id("watcher_id").notNull(),
    ticketItemId: id("ticket_item_id").notNull(),
    doneAt: tsString("done_at").notNull(),
    // No key: a person lives in identity's migration set, which core's may not reference.
    doneByPersonId: id("done_by_person_id"),
    doneByDeviceId: id("done_by_device_id"),
  },
  (t) => [
    primaryKey({ columns: [t.watcherId, t.ticketItemId], name: "watcher_item_marks_pk" }),
    foreignKey({ columns: [t.watcherId], foreignColumns: [watchers.id], name: "watcher_item_marks_watcher_fk" }),
    foreignKey({ columns: [t.ticketItemId], foreignColumns: [ticketItems.id], name: "watcher_item_marks_item_fk" })
      .onDelete("cascade"),
    foreignKey({ columns: [t.doneByDeviceId], foreignColumns: [devices.id], name: "watcher_item_marks_device_fk" }),
    check("watcher_item_marks_done_by_ck", sql`(${t.doneByPersonId} is null) <> (${t.doneByDeviceId} is null)`),
    index("watcher_item_marks_item_idx").on(t.ticketItemId),
  ],
);
```

The index serves the cascade from `ticket_items`, which otherwise scans the table on every deleted
record. Neither `watchers` nor stations nor zones are ever deleted (switched off), so no other key
needs a delete rule. The cascade makes `watcher_item_marks` a cascading child of `ticket_items`: a
future rebuild of `ticket_items` would empty it (CLAUDE.md §3) — acceptable for marks, and Task 15
records it in the backlog.

**Measured 2026-10-01** in a throwaway detached worktree of `main` at `ddde4e535` (before B16; removed
after), with these tables (`watcher_item_marks` then had no device key and no check, and lived in
`watchers.ts`) and the `devices` column: `pnpm --filter @waitron/db db:generate --name probe`
emitted five `CREATE TABLE`s (`watcher_item_marks`, `watcher_printers`, `watcher_stations`,
`watcher_zones`, `watchers`), `CREATE INDEX \`watcher_item_marks_item_idx\``,
``CREATE UNIQUE INDEX `watchers_name_key` ON `watchers` (`location_id`,`name`) WHERE "watchers"."active"``
and ``ALTER TABLE `devices` ADD `watcher_id` text REFERENCES watchers(id);`` — no `__new_` rebuild
(the probe's generated SQL was not committed). With the custom trigger migration below and the five
`classify` rows, `scripts/migration-upgrade.test.ts`, `migrations-match-schema.test.ts`,
`append-only-triggers.test.ts`, `classification-complete.test.ts`, `two-file-foreign-keys.test.ts` and
`schema-constraints.test.ts` passed; `behavioural-triggers.test.ts` failed exactly its 7 binding cases
until the two refusal strings were changed, then passed 240 of 240. A device key and a check inside a
`CREATE TABLE` generate inline (as `m1-printer-watches.sql`'s check did), so your file differs only by
those two lines and its number. B16's `0056_placed_order_handover.sql` is now on `main`, so your
numbers are at least `0057`/`0058`. Anything else in the generated file — above all a `__new_devices`
— is a STOP.

**The custom migration** (`pnpm --filter @waitron/db db:generate:custom --name device_binding_watcher`,
written AFTER the generated one, so `watcher_id` exists when it runs). Measured with the probe above:

```sql
-- The binding rule (0001_behavioural_triggers.sql) re-created: a kds device binds a station OR a
-- watcher, never both, and no register; every other form factor binds a register and neither.
DROP TRIGGER IF EXISTS device_binding_rule_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS device_binding_rule_update;--> statement-breakpoint
CREATE TRIGGER device_binding_rule_insert
BEFORE INSERT ON devices
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'device has no profile')
  WHERE NOT exists (SELECT 1 FROM device_profiles p WHERE p.id = new.device_profile_id);

  SELECT raise(abort, 'a kds device binds a station or a watcher, and no register')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) = 'kds'
    AND ((new.station_id IS NULL) = (new.watcher_id IS NULL) OR new.till_id IS NOT NULL);

  SELECT raise(abort, 'a non-kds device binds a register and no station or watcher')
  WHERE (SELECT p.form_factor FROM device_profiles p WHERE p.id = new.device_profile_id) <> 'kds'
    AND (new.till_id IS NULL OR new.station_id IS NOT NULL OR new.watcher_id IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER device_binding_rule_update
BEFORE UPDATE ON devices
FOR EACH ROW
WHEN (
  old.station_id IS NOT new.station_id
  OR old.watcher_id IS NOT new.watcher_id
  OR old.till_id IS NOT new.till_id
  OR old.device_profile_id IS NOT new.device_profile_id
  OR (old.active = 0 AND new.active <> 0)
)
BEGIN
  -- the same three refusals as the insert trigger, word for word
END;
```

  (Write the update trigger's body out in full — the three `SELECT raise(…)` statements of the insert
  trigger, unchanged. `0001`'s comment block above the original triggers, `:323-378`, explains the
  gate and the missing-profile refusal; it stays true and is not repeated.) No other trigger is on
  `devices` (`grep -rn 'ON devices' packages/*/drizzle/*.sql` lists only the two), and no other
  migration set's trigger body names `devices`.

- [ ] **Step 1: Write the failing tests.**
  `packages/db/src/schema/watchers.test.ts`, set up as `packages/db/src/schema/devices.test.ts:1-60`
  (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, a tenant, a location, a station, a zone, a
  printer, a device profile, a ticket item — copy the ticket-item setup from
  `packages/db/src/schema/ticket-items.test.ts`):

```ts
it("gives a new watcher no stations, no zones and no runs-the-pass switch, switched on", async () => { /* insert name + location only; read every default */ });

it("refuses a second switched-on watcher with the same name, and accepts one once the first is switched off", async () => {
  await insertWatcher({ name: "Pass" });
  expect(isUniqueViolation(await captureError(() => insertWatcher({ name: "Pass" })))).toBe(true);
  await inTx((tx) => tx.update(watchers).set({ active: false }).where(eq(watchers.name, "Pass")));
  await insertWatcher({ name: "Pass" }); // no throw
});

it("deletes a watcher's marks with the kitchen record they mark", async () => { /* mark, delete the ticket item, marks gone */ });

it("refuses a mark naming no kitchen record, and one that names both or neither of a person and a device", async () => {
  // FOREIGN_KEY_VIOLATION for the record; CHECK_VIOLATION (packages/db/src/sql-state.ts:46) for the other two
});

it("indexes the marks by kitchen record", async () => {
  const { rows } = await suite.db.execute<{ name: string }>(sql`select name from pragma_index_list('watcher_item_marks')`);
  expect(rows.map((r) => r.name)).toContain("watcher_item_marks_item_idx");
});
```

  In `scripts/behavioural-triggers.test.ts`, inside `describe("device_binding_rule_insert")`: "accepts a
  kds device bound to a watcher and no station" (`watcher_id` `'watcher'`, as the file writes ids;
  it runs with `pragma foreign_keys = off`), "refuses a kds device bound to a station AND a watcher"
  (`KDS_BINDING_REFUSAL`), "refuses a non-kds device bound to a register and a watcher"
  (`REGISTER_BINDING_REFUSAL`); inside `describe("device_binding_rule_update")`: "refuses a watcher
  added to a station-bound kds device" and "accepts moving a kds device from its station to a watcher
  in one update". Each inserts its own device row: a case run alone with `-t` must not depend on a
  row another case inserts — the probe's first run of "refuses a watcher added to a station-bound
  kds device" updated a row that a case `-t` had skipped would have inserted, matched nothing, and
  failed for that reason alone; and an "accepts" case on a missing row would pass having proved
  nothing.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/watchers.test.ts` and
  `pnpm exec vitest run scripts/behavioural-triggers.test.ts -t binding`. Expected: FAIL (no tables;
  the old trigger refuses the watcher-bound kds with `a kds device binds a station and no register` —
  the probe's control measured exactly that).
- [ ] **Step 3: Implement** the schema files, then
  `pnpm --filter @waitron/db db:generate --name watchers` and READ it against the measured output;
  then the custom migration; then the refusal strings, the classification rows, the guard rows and the
  fixture list.
- [ ] **Step 4: Run** the Step 2 commands (PASS), then the guard set
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`, and
  `pnpm --filter @waitron/db exec vitest run src/schema/devices.test.ts src/schema/devices.trigger.test.ts src/classification.test.ts`
  (unset `AI_AGENT` and `CLAUDECODE` to see a passing test's output). Expected: PASS. If the upgrade
  test fails with `could not write row N of <table>` for a new table, the fix is usually a
  `CANDIDATES` entry giving its filler real parents, never a `RESETS` one (read the test's header).
- [ ] **Step 5: Mutation check by hand** (`packages/db` holds a floor of 90 over `src/**`, scored
  weekly). One at a time — copy each file to `/tmp` first and restore from the copy (CLAUDE.md memory:
  `git checkout <path>` discards uncommitted work) — flip each new flag's default, rename
  `watcher_item_marks_item_idx`, delete `.onDelete("cascade")`, and delete the unique index's
  `.where(...)`; run `pnpm --filter @waitron/db exec vitest run src/schema/watchers.test.ts` after each
  and confirm it fails. Record the five failures in the commit message.
- [ ] **Step 6: Commit** — `git add packages/db scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts apps/server/src/testing/clear-provision-fixture.ts && git commit -s -F <message file>` with:

```
Kitchen data: watchers — what each follows, the printers that print its copies and its own Done
marks — and a kitchen screen can be bound to a watcher instead of a station (core migration: five
new tables and one added column, no table rebuild; a custom migration re-creates the device
binding triggers).

Why these tables are CORE: a watcher shows core's kitchen records, prints on core's printers and
is shown by core's devices, whose binding rule is a core trigger; the till and device routes that
read it are core, and the core Devices and Printing rules screens bind screens and printers to it,
which they could not do through a module's routes.
```

---

### Task 3: Watchers are stored, read and written, and travel in configuration export

**Files:**
- Create: `apps/server/src/watchers.ts`, `apps/server/src/watchers.test.ts`
- Modify: `apps/server/src/errors.ts` — `"watcher.not_found": { watcherId: string }` and
  `"watcher.name_taken": { name: string }`, each with a one-line description, beside
  `station.name_taken` (`:580`)
- Modify: `apps/server/src/management-api.ts` — four routes beside the station routes
  (`:1615-1760`); `STATUS` gains `"watcher.not_found": 404` and `"watcher.name_taken": 409` beside
  `"station.name_taken": 409` (`:259`)
- Modify: `packages/db/src/configuration-transfer.ts` — after the `dining_tables` entry (`:16-20`):
  `{ name: "watchers", locationColumns: ["location_id"] }`, `{ name: "watcher_stations" }`,
  `{ name: "watcher_zones" }`; after `station_printers` (`:33`): `{ name: "watcher_printers" }`. Never
  `watcher_item_marks` (live service, not configuration), and `devices` stay out as today.
- Modify: `apps/dashboard/src/api/client.ts` — a `Watcher` type and `listWatchers()` (Task 4's
  Printing rules and Task 12's Devices screen read it); `apps/dashboard/src/api/live-queries.ts` —
  `listWatchers: ["watchers", "watcher_stations", "watcher_zones", "watcher_printers"]`
- Test: `apps/server/src/watchers.test.ts`, `apps/server/src/management-api.test.ts` (beside the
  station cases), `apps/server/src/configuration-transfer.test.ts`, `scripts/live-subscriptions.test.ts`
  (run only)

**Interfaces** (`watchers.ts`; it imports `./errors.js`; every writer takes a `tx` and opens none):

```ts
/** What a watcher follows (W3). An `every…` flag means "all, including ones added later"; its list is then empty. */
export interface WatcherFollows {
  everyStation: boolean;
  stationIds: readonly string[];
  everyZone: boolean;
  zoneIds: readonly string[];
}

export interface Watcher extends WatcherFollows {
  id: string;
  name: string;
  runsPass: boolean;
  displayOrder: number;
  active: boolean;
  /** The printers attached to it (`watcher_printers`), by id. */
  printerIds: string[];
}

export interface WatcherInput extends WatcherFollows {
  name: string;
  runsPass: boolean;
  displayOrder?: number;
}

/** Whether a dish at `stationId`, for an order in `zoneId` (null: no zone), is this watcher's (W3, P2). */
export function watcherSees(follows: WatcherFollows, dish: { stationId: string; zoneId: string | null }): boolean;

export async function listWatchers(tx: Transaction, cfg: TillConfig): Promise<Watcher[]>; // switched on, by display order then name
export async function readWatcher(tx: Transaction, cfg: TillConfig, watcherId: string): Promise<Watcher | null>; // switched off too
export async function createWatcher(tx: Transaction, cfg: TillConfig, input: WatcherInput): Promise<{ id: string }>;
export async function updateWatcher(tx: Transaction, cfg: TillConfig, watcherId: string, input: WatcherInput): Promise<void>;
export async function removeWatcher(tx: Transaction, cfg: TillConfig, watcherId: string): Promise<void>;
```

**Behaviour (the tests pin each):**
- `watcherSees`: `(everyStation || stationIds.includes(stationId)) && (everyZone || (zoneId !== null && zoneIds.includes(zoneId)))`.
  "Every zone" accepts a `null` zone (P2); a zone list never does.
- `createWatcher` / `updateWatcher` check, before any write:
  - `name` trimmed and not empty, else `management.request_invalid { field: "name" }`;
  - `everyStation` false with no `stationIds`, or true WITH `stationIds`:
    `management.request_invalid { field: "stationIds" }`; the same for zones with `field: "zoneIds"`
    (P2);
  - each station a switched-on station of this venue (`requireLiveStation`,
    `apps/server/src/kitchen.ts:39`, `station.not_found`); each zone a switched-on `floor_zones` row of
    `cfg.locationId` (`zone.not_found { zoneId }`, the code `apps/server/src/tables.ts:41` throws);
    duplicates in either list are dropped;
  - a name another switched-on watcher of this venue has: `watcher.name_taken { name }` — caught from
    the insert or update as `createStation` catches `station.name_taken` (`kitchen.ts:71-97`): the only
    unique index on `watchers` besides its key is `watchers_name_key`.
- `updateWatcher` on an unknown, another venue's or switched-off watcher: `watcher.not_found`. It
  replaces the followed stations and zones by deleting the watcher's rows, then inserting the new
  sets (CLAUDE.md §3).
- `removeWatcher` (P3): `watcher.not_found` for an unknown or another venue's one; switched off
  already: no error, nothing changes. Otherwise sets `active` false and deletes its `watcher_printers`
  rows, in the caller's transaction. Its followed sets and marks stay.
- `listWatchers` reads each table once (watchers, then stations, zones and printers for those ids,
  awaited in turn) and assembles them.

**HTTP routes** (`management-api.ts`, all through `withVenueAuth` — `venue.configure`, W17 — with
`requireVenueCfg(deps)` as the station routes use; a malformed `:id` answers `watcher.not_found`):
- `GET /management-api/watchers` → `Watcher[]`
- `POST /management-api/watchers` body `WatcherInput` → 201 `{ id }`
- `PUT /management-api/watchers/:id` body `WatcherInput` (every key present) → 204
- `DELETE /management-api/watchers/:id` → 204

Body checks: not an object → `{ field: "body" }`; `name` not a string → `{ field: "name" }`; each flag
not a boolean → its own name as `field`; each list not an array of strings →
`{ field: "stationIds" | "zoneIds" }`; `displayOrder` through the file's `parseDisplayOrder` (`:365`).

- [ ] **Step 1: Write the failing tests.** `watchers.test.ts` (real database: `useVenueDb` with
  `migrationOptionsFor(manifestSets(), null)`; a venue through `setupPartyVenue`, which has two zones,
  `v.tables.zoneId` and `v.counter.zoneId`; a second station made with `createStation`):
  - `watcherSees`: the pass (two stations, every zone) sees its station in any zone and with a `null`
    zone, not another station; the runner (every station, one zone) sees any station in its zone, not
    the other zone, and not a `null` zone;
  - create, then list: the follows come back as written, by display order then name; update replaces
    both sets (old station gone, new one there); remove: gone from the list, `readWatcher` still reads
    it with `active: false`, and its `watcher_printers` row is gone (insert that row directly here:
    `setPrinterWatcher` is Task 4's);
  - each refusal, asserting the code and `params` (never just `Error`): empty name; `everyStation`
    false with `[]`; `everyStation` true with a station; a switched-off station (`station.not_found`);
    another venue's zone (`zone.not_found`); a name another switched-on watcher has
    (`watcher.name_taken`); update and remove of an unknown id (`watcher.not_found`);
  - a name freed by removal can be used again.

  `management-api.test.ts`: each route's status; the body refusals with their `field`; 401 without a
  management session; 403 for a person without `venue.configure` (copy how the station cases build
  one).

  `configuration-transfer.test.ts`, in the shape of "transfers the venue's limit on a bill's total
  discount" (`:1029-1052`): a watcher following one station and one zone, with a printer attached
  (a `watcher_printers` row inserted directly), is exported and imported into a fresh venue; the imported watcher has the same name and flags, its
  station and zone are the imported venue's (ids remapped), and the imported printer is attached to
  it. And the declared list names `watchers`, `watcher_stations`, `watcher_zones` and
  `watcher_printers`, and never `watcher_item_marks` or `devices` (read
  `CORE_CONFIGURATION_TRANSFER.tables`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/watchers.test.ts src/management-api.test.ts src/configuration-transfer.test.ts -t watcher`
  (name the new cases so `-t watcher` finds them). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/errors-reachable.test.ts`
  and `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "Watchers: a venue can name a watcher, choose the stations and service zones it follows, and switch it off; watchers travel in configuration export".

---

### Task 4: A printer makes or watches, and "One ticket per order" leaves the settings (W20, W21)

**Files:**
- Modify: `apps/server/src/watchers.ts` — `setPrinterWatcher`
- Modify: `apps/server/src/station-printers.ts` — `attachPrinterToStation` (`:23-40`) refuses a
  printer attached to a watcher
- Modify: `apps/server/src/errors.ts` — `"printer.makes_and_watches": { id: string }` beside
  the host's `printer.*` codes (`:36-42`) — `id`, not `printerId`, because the printer codes that name
  a printer by its id name it `id` (`printer.not_found { id }`, `packages/printing/src/errors.ts:11`,
  thrown by `station-printers.ts:37`): "A printer was attached to a station while it prints a
  watcher's copies, or to a watcher while it prints a station's tickets; it would print some dishes
  twice."
- Modify: `apps/server/src/print-api.ts` — a new `PUT /management-api/printers/:id/watcher`
  (`printer.manage`, the file's `gated`); `STATUS` gains `"printer.makes_and_watches": 409` and
  `"watcher.not_found": 404`; the printer PATCH (`:888`) stops reading `ticketScope`
  (`:908-914`) and the import of `printTicketScope` (`:19`) goes
- Modify: `packages/printing/src/printers.ts` — `UpdatePrinterInput.ticketScope` (`:100`) goes;
  `PrinterRow.ticketScope` (`:115`) becomes `watcherId: string | null`, read in `listPrinters`
  (`:174-192`) by a left join to `watcherPrinters`
- Modify: `apps/dashboard/src/api/client.ts` — `PrintTicketScope` (`:681`) goes; `Printer.ticketScope`
  (`:710`) becomes `watcherId: string | null`; `PrinterPatch.ticketScope` (`:775`) goes; new
  `setPrinterWatcher(printerId, watcherId | null)`
- Modify: `apps/dashboard/src/screens/printers-screen.ts:1145` (the literal `ticketScope: "station"` on
  a new printer goes)
- Modify: `apps/dashboard/src/screens/printing-rules-screen.ts` — `#renderRouting` (`:172-224`)
- Modify: `apps/dashboard/src/api/live-queries.ts` — `listPrinters` (`:29`) gains `"watcher_printers"`
- Modify: `apps/dashboard/src/i18n/strings.ts` — delete `printers.ticket_scope` (`:752`, `:2651`);
  the new strings below, both languages; `apps/dashboard/src/i18n/codes.ts` — words for
  `printer.makes_and_watches` and `watcher.not_found`
- Tests: `apps/server/src/station-printers.test.ts`, `apps/server/src/print-api.test.ts` (the PATCH
  cases at `:1235-1249` and `:1299-1308` that round-trip `ticketScope: "order"`),
  `packages/printing/src/printers.test.ts` (`:204-211`), `apps/dashboard/src/screens/printing-rules-screen.test.ts`
  (`:453-456`, `:517`), and every dashboard fixture that writes `ticketScope:` (`grep -rln 'ticketScope' apps/dashboard/src packages/printing/src apps/server/src`;
  read 2026-10-01: `printers-screen.test.ts`, `printers-screen.a11y.test.ts`, `devices-screen.test.ts`,
  `devices-screen.a11y.test.ts`, `client.test.ts`) — each `ticketScope: "station"` becomes
  `watcherId: null`

**Interface:**

```ts
/** Attach a printer to a watcher (W21), or with `null` detach it. The printer must be a switched-on
 *  printer of this venue (`printer.not_found`), the watcher a switched-on watcher of it
 *  (`watcher.not_found`), and the printer attached to no station (`printer.makes_and_watches`).
 *  Moving it from one watcher to another is one upsert on the printer's key. */
export async function setPrinterWatcher(tx: Transaction, cfg: TillConfig, printerId: string, watcherId: string | null): Promise<void>;
```

The upsert names its target (`.onConflictDoUpdate({ target: watcherPrinters.printerId, set: { watcherId } })`,
CLAUDE.md §3). `attachPrinterToStation` reads `watcher_printers` for the printer after its two
existing checks and throws `printer.makes_and_watches { id }` when a row exists. The route:
body `{ watcherId: string | null }`; a missing key or a non-string, non-null value is
`management.request_invalid { field: "watcherId" }`.

`printers.ticket_scope` stays in the schema, unread (W20). Leave the column and its check in
`packages/db/src/schema/printers.ts` (the migrations must still match the schema,
`scripts/migrations-match-schema.test.ts`) and replace the doc line above `printTicketScope`
(`:12-13`) to say that existing printer rows retain the unused column until the planned venue reset.
`packages/db/src/schema/printing.test.ts:166-175` keeps pinning the column's default: it is still
true.

**The screen** (`#renderRouting`):
- The "One ticket per order" switch goes. In its place, a shared `<wt-combobox name="watcherId">` labelled
  "Prints a watcher's copies" / "Imprime las copias de un punto de seguimiento": first option, empty
  value, "No: prints the tickets of the stations below" / "No: imprime las comandas de las estaciones
  de abajo"; then each switched-on watcher by name (`listWatchers`, Task 3, watched as a live query
  beside the screen's others, `:113-140`). The chosen value comes from `printer.watcherId`.
  Changing it calls `setPrinterWatcher` through the screen's `#mutate` (`:143-155`).
- While a printer has a watcher, its station switches are `disabled` and one line under them says:
  "A printer that prints a watcher's copies prints no station tickets." / "Una impresora que imprime
  las copias de un punto de seguimiento no imprime comandas de estación."
- A refusal (`printer.makes_and_watches` when the printer still has stations) shows on its own line at
  the bottom of that printer's card, in both languages: "This printer prints station tickets. Turn its
  stations off first, or it would print some dishes twice." / "Esta impresora imprime comandas de
  estación. Desactiva primero sus estaciones, o imprimiría algunos platos dos veces." The select goes
  back to the stored value (bind `.selected` from the stored `watcherId`, so a re-render restores it).
- Every colour and size from `--wt-*` tokens.

- [ ] **Step 1: Write the failing tests.**
  - `watchers.test.ts`: `setPrinterWatcher` attaches, moves to another watcher, and detaches with
    `null`; it refuses a printer attached to a station (`printer.makes_and_watches`), a switched-off
    printer (`printer.not_found`) and a switched-off watcher (`watcher.not_found`).
  - `station-printers.test.ts`: `attachPrinterToStation` refuses a printer attached to a watcher
    (`printer.makes_and_watches`) and writes no row (Review Focus 10).
  - `print-api.test.ts`: the PUT's 204, its body refusal, its 409 and 404, and 403 without
    `printer.manage`; `GET /management-api/printers` carries `watcherId` and no `ticketScope`. The two
    cases that round-tripped `ticketScope: "order"` now send it and assert the printer's other fields
    changed and the GET carries no `ticketScope` (the route ignores a key it does not read, as it
    ignores any unknown key) — a deliberate change of what they pin, said in the commit message.
  - `printers.test.ts`: `listPrinters` reads `watcherId` from `watcher_printers` (`null` with none).
  - `printing-rules-screen.test.ts`: no element named `ticketScope` renders; the select lists "No…"
    and each watcher, with the stored one selected; choosing one calls `setPrinterWatcher(printer,
    watcher)`; a printer with a watcher has its station switches disabled and the line under them; a
    rejected call shows the refusal at the bottom of that printer's card and the select shows the
    stored value again (assert the native `<select>`'s `value`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/watchers.test.ts src/station-printers.test.ts src/print-api.test.ts`,
  `pnpm --filter @waitron/printing exec vitest run src/printers.test.ts` and — check memory first —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/printing-rules-screen.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** Then `grep -rn 'ticketScope\|ticket_scope\|printers.ticket_scope' apps packages --include='*.ts' | grep -v '/dist/\|node_modules'`:
  the only hits left are the schema column (`packages/db/src/schema/printers.ts`), its export
  (`packages/db/src/index.ts:105`), `packages/db/src/schema/printing.test.ts`, the kitchen-print
  routing that Task 8 rewrites (`apps/server/src/kitchen-print.ts:88`, `:107`, `:328-338`) and its
  tests, and the unrelated parameter `ticketScope` of `releaseHeld` in `working-order.ts`.
- [ ] **Step 4: Run** the Step 2 commands, the dashboard's `src/screens/printers-screen.test.ts
  src/screens/devices-screen.test.ts src/api/client.test.ts`, `pnpm exec vitest run scripts/live-subscriptions.test.ts`,
  and the server, printing and dashboard typechecks. Expected: PASS. Then open Printing rules in the
  dev stack (`wa-wt demo <worktree-name>`) at desktop and phone width, in both themes, attach a printer
  to a watcher (create one through `POST /management-api/watchers` or Task 13's screen if it is built),
  and see the station switches disable and the refusal sit at the bottom of the card.
- [ ] **Step 5: Commit** — "Printing rules: a printer prints a watcher's copies or its stations' tickets, never both; the One ticket per order setting is gone (the column stays, unread, until the next reset)".

---

### Task 5: Where an order is now, for a watcher (W8)

**Files:**
- Modify: `packages/module/src/module.ts` — beside B16's `findOrderModes` (`:363-368`):

```ts
/** Each named order's recorded service zone in one read; an order with no context is absent. */
findOrderZones(
  tx: Transaction,
  cfg: { locationId: LocationId },
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, string>>;
```

- Modify: `packages/venue-service/src/operations.ts` — `findOrderServiceZones`, written as
  `findOrderServiceModes` is (`:751-770`, an empty list reads nothing); `packages/venue-service/src/service.ts`
  wires it beside `findOrderModes: findOrderServiceModes` (`:37`)
- Modify: `packages/db/src/index.ts:200` — export `partySurvivors`
  (`packages/db/src/party-table-labels.ts:29-43`) beside the three label helpers it exports
- Create: `apps/server/src/watch-zones.ts`, `apps/server/src/watch-zones.test.ts`
- Test: `packages/venue-service/src/operations.test.ts` (beside B16's `findOrderServiceModes` cases),
  `packages/venue-service/src/service.test.ts` (the seat's method list, as B16 added one line)

**Interface** (`watch-zones.ts`):

```ts
/** What {@link orderWatchZones} reads of an order. */
export interface ZonedOrder { id: string; partyId: string | null; deliveryTableId: string | null }

/**
 * Where each order's food goes now (W8), keyed by order: a party bill's party's earliest-joined
 * active table's zone — or, once the party holds no table, that of the party it was merged into, as
 * `billPartyTableLabels` (`packages/db/src/party-table-labels.ts:51-66`) names its tables; else the
 * delivery table's zone; else the zone recorded when the order opened (one
 * `VENUE_SERVICE.findOrderZones` call for every order still unresolved); else null.
 */
export async function orderWatchZones(
  tx: Transaction,
  cfg: TillConfig,
  orders: readonly ZonedOrder[],
): Promise<Map<string, string | null>>;
```

A step that finds a table with no zone (`dining_tables.zone_id` is nullable) falls through to the
next step. Reads, in turn: the active tables of the named parties (`party_tables` ⋈ `dining_tables`,
`left_at` null, ordered by `joined_at`, `id`, as `partyZone` reads one party,
`apps/server/src/parties.ts:139-153`); `partySurvivors` and their tables for the parties left with
none; the delivery tables; and one seat call. An empty `orders` reads nothing.

- [ ] **Step 1: Write the failing tests.** `operations.test.ts`: `findOrderServiceZones` answers each
  order's recorded zone, leaves out an order with no context and another venue's order, and reads
  nothing for `[]`. `watch-zones.test.ts` (party venue; a second table-service zone, Terrace, made
  with `createZone`, `apps/server/src/tables.ts:224`, and offered with
  `offerProducts(tx, cfg, { zone: { zoneId: terrace }, serviceMode: "table_tab" })`,
  `apps/server/src/testing/zone-offers.ts:66`):
  - a party seated at a Terrace table: Terrace; after `moveGuests` (`apps/server/src/table-actions.ts:64`)
    to an indoor table: the indoor zone — for its OPEN bill, and for a PRESENTED bill of the same party
    (`placeByHand`, `apps/server/src/testing/party-venue.ts:310`), whose recorded zone
    (`findOrderZones`) is still Terrace (Review Focus 2);
  - two parties joined (`joinTables`) so one is merged into the other: the merged party's bill reads
    the surviving party's table zone;
  - a counter order delivered to a Terrace table (`delivery_table_id`): Terrace;
  - a counter order with a recorded zone and no table: the recorded zone; one with neither: `null`;
  - **one call for many:** with `vi.spyOn(VENUE_SERVICE, "findOrderZones")`, `orderWatchZones` over a
    party bill, a delivered order and two counter orders calls it ONCE, with only the two counter
    orders' ids; over party bills alone it never calls it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/operations.test.ts src/service.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/watch-zones.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, and `pnpm --filter @waitron/venue-service typecheck`,
  `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "Watchers: where an order's food goes now — its party's table, its delivery table, or the zone it was taken in — read for many orders at once".

---

### Task 6: A watcher's board, and its own Done

The server read a watcher screen shows, and the one write it makes. The board is today's pass board
(`listExpoQueue`), built by the same code, kept to what the watcher follows.

**Files:**
- Modify: `apps/server/src/working-order.ts` — split `listExpoQueue` (`:5405`) into a shared builder
  and its caller; `splitTicketItem` (`:3122-3145`) copies the source record's marks
- Create: `apps/server/src/watcher-board.ts`, `apps/server/src/watcher-board.test.ts`
- Modify: `apps/server/src/watchers.leave.test.ts` (Task 1's file) — the watcher's leave cases
- Test: `apps/server/src/working-order-reads.sqlite.test.ts`, `apps/server/src/working-order.test.ts`
  (the expo cases there keep passing unchanged: run them)

**The shared builder.** Move the body of `listExpoQueue` into

```ts
/** The pass board for the orders `scope` selects: every order not abandoned and not collected that
 *  `scope` keeps, ALL its items (so a section's roll-ups cover every item), sectioned as today. */
export async function readPassBoard(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  scope: SQL,
): Promise<ExpoOrder[]>;
```

and make `listExpoQueue` call it with today's `exists (… away_at is null)` clause as `scope` —
byte for byte the answer it gives today (its cases in
`working-order-reads.sqlite.test.ts` and `working-order.test.ts` are the proof; none changes). The
builder keeps every filter the landed code has (3c-1's `made_here = 0`, in the main `where` and in
the subquery) and every field (3c-2's `crossRefs`). Each section (`ExpoCourse`, `ExpoGroup`) gains
nothing; the watcher's sections add `allReady` themselves (below).

**Interfaces** (`watcher-board.ts`; it imports `./errors.js`):

```ts
export type WatcherCourse = ExpoCourse & { allReady: boolean };
export type WatcherGroup = ExpoGroup & { allReady: boolean };
export type WatcherOrder = Omit<ExpoOrder, "courses" | "groups"> & { courses: WatcherCourse[]; groups: WatcherGroup[] };

export interface WatcherBoard {
  watcher: { id: string; name: string; runsPass: boolean; active: boolean };
  /** Empty for a switched-off watcher (P3). */
  orders: WatcherOrder[];
}

/** `watcher.not_found` for an unknown id or another venue's watcher. */
export async function listWatcherQueue(tx: Transaction, cfg: TillConfig, watcherId: string): Promise<WatcherBoard>;

/** Mark the named kitchen records done for this watcher (`done: true`), or take the marks back.
 *  Records that no longer exist are skipped. `watcher.not_found` for an unknown, another venue's or
 *  switched-off watcher. Writes `watcher_item_marks` only. */
export async function markWatcherItems(
  tx: Transaction,
  cfg: TillConfig,
  watcherId: string,
  ticketItemIds: readonly string[],
  done: boolean,
  by: { personId: string } | { deviceId: string },
  at: Date,
): Promise<void>;
```

**`listWatcherQueue`, in order** (each read awaited in turn):
1. `readWatcher` (Task 3). Unknown or another venue's: `watcher.not_found`. Switched off: return it
   with `orders: []`.
2. The candidates: `ticket_items` ⋈ `working_orders` ⋈ `working_order_lines`, where the order is not
   abandoned and not collected, the line is not fully served (`served_at is null`: `writeServed` sets
   it only when the whole quantity is served, `working-order.ts:2330`), the record is not made here
   (3c-1, W10), the station is one the watcher follows (no condition when `everyStation`), and
   `not exists` a mark for (this watcher, the record). There is NO `away_at` condition: Away is the
   pass's shared "sent it out" (W4), and a dish already sent out stays on a watcher until its own
   Done, until it is served, or until its order is handed over or discarded (W11) — a runner's work
   starts at Away. Select the record id and the order's id, `party_id` and `delivery_table_id`. Lines
   with no kitchen record (no preparation, W9) never appear.
3. Unless `everyZone`: `orderWatchZones` (Task 5) over the candidates' distinct orders, once, and
   keep the candidates whose order's zone `watcherSees` accepts.
4. `readPassBoard` with `scope` = the remaining orders' ids (`inArray(workingOrders.id, …)`; none →
   return `orders: []` without the read).
5. For every section: `allReady` = every one of its items (all of them, before filtering) is
   `ready`; then keep only the items that are candidates; drop empty sections, then empty orders;
   recompute each order's `worstBand` over the items it shows whose `awayAt` is null (`worstBand`,
   `@waitron/shared`) — P19: on a watcher board a sent-out dish no longer colours its order; this is
   per dish, narrower than today's pass, which leaves out only sections that are wholly away. An
   order whose shown items are all away is `fresh` (`worstBand([])`, `packages/shared/src/timing.ts:28-32`).
   The screen does not read this field — it works out bands itself on every render
   (`till-expo-screen.ts:39-41`: "The server's `ExpoItem.band`/`ExpoOrder.worstBand` are
   ignored") — but the API still answers it, so it is kept true and tested (below).
   `fired` and `away` stay as the builder rolled them up over ALL the section's items, because the
   levers they drive act on the whole course or group (P4). A section is never dropped for being
   away (`readPassBoard` keeps every item; the pass's own away filter lives in the till screen,
   Task 10, and is not applied to a watcher's board).

**`markWatcherItems`:** `readWatcher` (switched-on only); validate nothing else. For `done`: read which
of the ids are `ticket_items` rows, then insert one mark each with `doneAt: at.toISOString()` and the
person or device, `.onConflictDoNothing({ target: [watcherItemMarks.watcherId, watcherItemMarks.ticketItemId] })`
(a mark already there keeps its first time). For not `done`: delete this watcher's marks for those
ids.

**`splitTicketItem`:** after inserting the copy (`:3138-3144`), read the source record's marks and
insert the same marks for the copy's id (P16): a part split off a dish the pass had marked done stays
done there.

- [ ] **Step 1: Write the failing tests** (`watcher-board.test.ts`, real database, party venue). Set
  up stations Grill, Fryer, Cold and Bar (`createStation`); route Burger to Grill and Caña (the lager)
  to Bar (3a's `routeProductTo`, `apps/server/src/testing/zone-offers.ts`); a Terrace zone as in
  Task 5; the venue's tables zone is "indoors". Watchers through Task 3's `createWatcher`: **Pass**
  (Grill, Fryer, Cold; every zone) and **Terrace runner** (every station; Terrace). Party A at a
  Terrace table orders a burger and a lager; party B at an indoor table a burger (`orderForParty`).
  Assert whole objects with `toEqual` where a stray key would matter (CLAUDE.md §4).
  - **Review Focus 1:** Pass's board has both burgers (A's and B's) and no lager.
  - **Review Focus 2:** Terrace runner's board has A's burger and lager and not B's burger; after
    `moveGuests` takes party A to an indoor table, it has neither. Then with a PRESENTED bill: party
    C at a Terrace table, its bill presented (`placeByHand`), C moved indoors — the runner shows none
    of C's dishes, though `findOrderZones` still answers Terrace for that bill.
  - **Review Focus 3 (the function):** `markWatcherItems(…, [A's burger], true, { deviceId: d1 })` on
    Pass, then the same from `{ deviceId: d2 }`: one mark row (the first `done_at`); Pass's board no
    longer has A's burger; Terrace runner's still does.
  - **Review Focus 4:** after that Done: A's burger record's `state`, `away_at` and `station_id` are
    unchanged; it is still in `listStationQueue(tx, grill)` and in `listExpoQueue`; and
    `listTablesWithState`'s row for A's table is unchanged (compare the whole row before and after).
  - **Undo:** `done: false` takes the mark away; the burger is back on Pass's board.
  - **Review Focus 13 (Away):** party A's burger and lager bumped ready, then the pass's Away on their
    group (`markGroupAway`, `apps/server/src/order-groups.ts:295`): Terrace runner's board still has
    both, each with `awayAt` set, and the section's `away: true`; after the runner marks them done,
    neither is there. Proof by deletion: add `isNull(ticketItems.awayAt)` to step 2 and confirm this
    case fails on "still has both". And P19 on the server: with the clock past both dishes'
    forgotten thresholds, the runner's order answers `worstBand: "fresh"` while both are sent out;
    remove the `awayAt` filter from step 5's band and confirm it answers `forgotten`.
  - **Review Focus 6:** a lager made here (3c-1: a till whose made-here list names Bar sends it, as
    3c-1's `made-here.test.ts` sends one) is on no watcher board, even a watcher of every station; a
    water routed to no preparation (3a's no-preparation exception, as 3a's routing tests write one)
    is on none; a burger with chips split off to Fryer (3c-2's fixture,
    `apps/server/src/testing/split-extras-venue.ts`) shows the chips as their own item at Fryer with
    3c-2's `crossRefs` naming the burger at Grill, on Pass, and both on a Terrace runner when the order
    is on the Terrace.
  - **Leaving (W11):** a burger fully served (`serveLine`, `apps/server/src/testing/serve-line.ts:91`)
    leaves every board; one served in part stays; a counter order collected (`markCollected`) leaves;
    one discarded (`cancelPlacedOrder`, `working-order.ts:4663`) leaves; a held burger (group held)
    shows with `firedAt: null`.
  - **Roll-ups:** a course holding A's burger (watched) and a lager (not watched), the burger ready and
    the lager not: Pass's section has `allReady: false` and lists only the burger; with the lager
    ready too, `allReady: true`.
  - **Every station:** a station created AFTER the runner was saved, with a dish for the Terrace: on
    the runner's board.
  - **Lateness (W18):** each item carries its own station's `thresholds` (Grill 5/10/15, Bar with
    others).
  - **A switched-off watcher:** `{ watcher: { …, active: false }, orders: [] }`; `markWatcherItems`
    refuses it `watcher.not_found`; an unknown id is `watcher.not_found` for both.
  - **Split (P16):** a burger ×2 on Pass, marked done, split one unit onto a check of the same party
    (`carveOffLines`): the copy's record carries Pass's mark too.
  - **An edit replaces the record:** a burger marked done on Pass, its note changed through the edit
    path (`applyLineEdits`, which deletes the record and sends the dish again): the new record has no
    mark and the burger is back on Pass's board (the dish changed).

  In `watchers.leave.test.ts`, after Task 1's cases: the same paid table bill's burger stays on Pass's
  board after payment (W11), and leaves it when served, when marked done, and when collected.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/watcher-board.test.ts src/watchers.leave.test.ts`.
  Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the builder split first, and run
  `pnpm --filter @waitron/server exec vitest run src/working-order-reads.sqlite.test.ts src/working-order.test.ts src/order-groups.test.ts src/party-table-actions.test.ts`
  — PASS, unchanged; then `watcher-board.ts` and the split.
- [ ] **Step 4: Run** the Step 2 command and the Step 3 suites again. Expected: PASS. Proof by
  deletion: drop the `not exists` mark condition from step 2 and confirm Review Focus 3 fails on "no
  longer has A's burger"; drop step 3's zone filter and confirm Review Focus 2 fails; restore both
  (copy the file to `/tmp` first).
- [ ] **Step 5: Commit** — "Watchers: a watcher's board lists the dishes it follows, as the pass shows them, and the watcher marks its own copy done without changing anything anyone else sees".

---

### Task 7: The till and an always-on screen read a watcher; a kitchen screen joins as a watcher's

**Files:**
- Modify: `apps/server/src/till-api.ts` — three routes beside `GET /api/expo/queue` (`:1382`);
  `STATUS` gains `"watcher.not_found": 404`
- Modify: `apps/server/src/device-session.ts` — `DeviceBinding` (`:83-92`) gains `watcherId: string | null`;
  `deviceBindingColumns` (`:96-104`) and `toDeviceBinding` (`:141-156`) carry it
- Modify: `apps/server/src/device-api.ts` — `GET /api/device/me` (`:181-195`) answers `watcherId`;
  new `GET /api/device/watcher` and `POST /api/device/watcher/done` beside `GET /api/device/station`
  (`:198-213`); `GET /management-api/devices` (`:265-289`) selects `watcherId`; `STATUS` (`:61-90`)
  gains `"watcher.not_found": 404`
- Modify: `apps/server/src/device.ts` — `resolveDeviceBinding` (`:108-139`) takes `watcherId`
- Modify: `apps/server/src/join-requests.ts` — `acceptDeviceJoinRequest` (`:321-369`) input and insert
  carry `watcherId`
- Modify: `apps/server/src/join-api.ts` — the accept route (`:205-242`) reads `watcherId`
  (`optionalBodyUuid`); `STATUS` gains `"watcher.not_found": 404`
- Modify: `apps/server/src/errors.ts` — `device.station_required`'s description (`:664-668`): "…with no
  station and no watcher"
- Modify: `apps/server/src/testing/enrol.ts` — `enrolDeviceForTest`'s input (`:12`) gains
  `watcherId?: string`, passed through
- Modify: 3b's `apps/server/src/station-outputs-down.test.ts` — Review Focus 11
- Create: `apps/server/src/till-api.watchers.test.ts`
- Test: `apps/server/src/device-api.test.ts`, `apps/server/src/join-api.test.ts`,
  `apps/server/src/device.test.ts`, `apps/server/src/device-session.test.ts`

**Binding a screen to a watcher.** `resolveDeviceBinding`'s input gains `watcherId?: string | null`.
For a `kds_station` kind: exactly one of `stationId` and `watcherId` — neither is the existing
`device.station_required`, both is `management.request_invalid { field: "watcherId" }`; a station is
checked as today (`requireLiveStation`); a watcher must be a switched-on watcher of this venue
(`watcher.not_found`). For a till or handheld, a `watcherId` is
`management.request_invalid { field: "watcherId" }` (the trigger would refuse it anyway; this names
the field). The insert in `acceptDeviceJoinRequest` writes `watcherId: binding.watcherId`. The
database trigger (Task 2) is the backstop.

**Routes:**
- `GET /api/watchers` (`requireSession`) → the switched-on watchers, `{ id, name, runsPass }[]`,
  by display order then name (the till's chooser, Task 10).
- `GET /api/watchers/:id/queue` (`requireSession`) → `WatcherBoard`; malformed or unknown id →
  `watcher.not_found`.
- `POST /api/watchers/:id/done` (`requireSession`) body `{ ticketItemIds: string[], done: boolean }`
  → 204; `ticketItemIds` not a non-empty array of at most 200 UUIDs →
  `management.request_invalid { field: "ticketItemIds" }`; `done` not a boolean → `{ field: "done" }`;
  records the session's `personId`. The clock is read once, in the route, and passed as `at`.
- `GET /api/device/watcher` (`requireDevice`) → the device's own watcher's `WatcherBoard`, returned
  as it is (not wrapped under another `watcher` key, which would make the screen read
  `.watcher.watcher.name`); a device bound to no watcher → `device.unauthorized`, as `GET /api/device/station` answers a
  device with no station (`:204`), confirming nothing about the device.
- `POST /api/device/watcher/done` (`requireDevice`) — the same body and checks as the till route, for
  the device's own watcher, recording the device's id (W7).

Every read and write runs in one `withTransaction` (P11). No device route fires, readies or sends
away anything (W7; 3c-3's P12 stays true).

- [ ] **Step 1: Write the failing tests.**
  - `till-api.watchers.test.ts` (the route harness `apps/server/src/till-api.test.ts` uses; a signed-in
    session, and a kitchen-screen device enrolled with `enrolDeviceForTest(…, { watcherId: pass })`):
    - the list, the queue and Done with their statuses and refusals; Done records the person;
    - **Review Focus 3 (the routes):** two devices bound to Pass; device A posts Done for A's burger;
      device B's `GET /api/device/watcher` no longer lists it; a device bound to Terrace runner still
      does; the mark records device A;
    - **Review Focus 5 (server side) — already true today, pinned, not red-then-green:** the fire
      routes require a session (`requireSession`, `apps/server/src/till-session.ts:56-71`). With only
      device A's cookie (no session), `POST` to the course
      fire route (`mountCourseVerb(…, "fire", …)`, `till-api.ts:1380`) and to the group fire route
      (`POST /api/parties/:id/groups/:gid/fire`, `till-api.ts:1818`) is refused `session.required` (401), and nothing is fired (the records' `fired_at` stay null);
    - a device bound to a station asking `GET /api/device/watcher` gets `device.unauthorized`; a device
      bound to Pass after Pass is removed gets `{ watcher: { id, name, runsPass, active: false },
      orders: [] }` (Task 6's switched-off answer, unwrapped).
  - `device-api.test.ts`: `/api/device/me` carries `watcherId` (null for a station's screen and a
    till); `GET /management-api/devices` carries it.
  - `join-api.test.ts` and `device.test.ts`: accepting a kitchen screen with `watcherId` binds it (the
    devices row has `watcher_id` and no `station_id`); with neither → `device.station_required`; with
    both → `management.request_invalid { field: "watcherId" }`; a switched-off watcher →
    `watcher.not_found`; a till profile with `watcherId` → `management.request_invalid`.
  - **Review Focus 11** — in 3b's `station-outputs-down.test.ts`, beside its dark-screen cases: Grill
    has no screen of its own and a dish waiting; a screen bound to Pass (which follows Grill) last
    seen ten minutes ago → `stationScreensDark` returns no Grill row. Grill's own screen dark and a
    LIVE screen bound to Pass → Grill is listed (the watcher's screen does not keep Grill alive).
    Read, not run: 3b's dark-screen read joins `devices` on `station_id`, which a watcher's screen
    leaves null; these cases are what hold it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/till-api.watchers.test.ts src/device-api.test.ts src/join-api.test.ts src/device.test.ts src/station-outputs-down.test.ts`.
  Expected: FAIL for the new routes and the binding. The Review Focus 5 and Review Focus 11 cases may
  already pass — they pin behaviour that holds today; say so in the commit.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `src/device-session.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts`,
  and `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "Watchers: a signed-in till reads and marks any watcher, and a kitchen screen can join as a watcher's screen, which only marks its own Done".

---

### Task 8: Paper — a watcher printer gets one copy of every send it follows, headed by the watcher's name

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` — `PrinterMapping` (`:85-91`) and `printerMappings`
  (`:98-117`) stop reading `ticketScope`; `routeKitchenTickets` (`:317-347`) keeps only station
  routes; `planKitchenTickets` (`:354-456`) plans watcher copies; `enqueueKitchenJobs` (`:459-475`)
  links nothing for a watcher copy; `enqueueKitchenTickets` (`:481-492`) gains `watchers`; a new
  exported `enqueueWatcherCopies`; `readReprintParts` (`:975-1028`), `readReprintTargets`
  (`:1034-1064`) and `reprintOrderTickets` (`:1074-1102`) lose `orderScopeAlsoAt`
- Modify: `apps/server/src/kitchen-ticket.ts` — the `order` variant of `KitchenTicket` (`:39-55`)
  becomes `watcher`; `ORDER_HEADER` (`:12-13`) goes; the header comment (`:4-5`)
- Modify: `packages/db/src/schema/kitchen-print-jobs.ts` — its doc (`:7-16`): the sentence "An
  order-scope printer's job gets a row for every station whose dishes its ticket lists; after a
  reprint merges a fired and a HOLD section onto one printer, both sections' stations" becomes "A
  watcher's copy has none (it is no station's ticket, W23)."
- Create: `apps/server/src/kitchen-print.watchers.test.ts`
- Tests converted (below): `apps/server/src/kitchen-ticket.test.ts`, `apps/server/src/kitchen-print.test.ts`,
  `apps/server/src/print-problems.test.ts`, `apps/server/src/order-groups.test.ts`, and the PASE
  fixtures the 3c plans added (`grep -rn 'ticketScope: "order"\|, "order")\|scope: "order"\|"PASE"' apps/server/src packages`)

**Interfaces:**

```ts
// kitchen-ticket.ts — the second variant of KitchenTicket:
//   | { scope: "watcher"; watcherName: string; tableLabel: string; orderNumber: string; firedAt: Date;
//       stations: KitchenTicketStation[] }
// printed exactly as the `order` variant was, with `watcherName` (operator text, through
// `prepareText`) where "PASE" was. 3c-3's `from` prints on it as it did on the `order` variant;
// 3c-1's `alsoOnOrder` stays on the `station` variant only.

// kitchen-print.ts
/** Which watcher printers a call prints for: every one that follows an item ("all"); none; or, for
 *  work that has just moved from station `newSince` (3c-3), only a watcher that did not already
 *  follow it there (W25). */
export type WatcherCopies = "all" | "none" | { newSince: string };

/** A printer attached to a switched-on watcher, with what that watcher follows. */
interface WatcherPrinter extends EscSetting {
  printerId: string;
  watcherId: string;
  watcherName: string;
  follows: WatcherFollows; // Task 3
}

/** The venue's switched-on printers attached to switched-on watchers; one read when there are none. */
async function readWatcherPrinters(tx: Transaction, locationId: string): Promise<WatcherPrinter[]>;

// KitchenJob GAINS `watcherId?: string`; a watcher copy has `station: null, stationIds: []`.
// planKitchenTickets' options GAIN `makers?: boolean` (default true), `watchers?: WatcherCopies`
// (default "all") and `rerouted?: Rerouted` (3c-3's type; only `enqueueWatcherCopies` passes it). enqueueKitchenTickets' options GAIN `watchers?: WatcherCopies` (default "all").

/** Watcher copies only, no station ticket: for a caller that prints the stations' paper in several
 *  parts and wants each watcher to get its copies once (P10, Task 9). `items` is the caller's
 *  made-here-free list, each at its final station. With `rerouted` (3c-3's `Rerouted`: line id →
 *  the station it left), a re-routed item a watcher did not follow at its old station goes on a copy
 *  of its own per old station, with that station as "From" and no `mark`; every other item it sees
 *  goes on one copy with `mark`. Answers whether any job was queued. */
export async function enqueueWatcherCopies(
  tx: Transaction, cfg: TillConfig, orderId: string, items: FiredItem[],
  options?: { mark?: "HOLD" | "FIRE"; rerouted?: ReadonlyMap<string, { stationId: string; stationName: string }> },
): Promise<boolean>;
```

**Behaviour:**
- `routeKitchenTickets(stationIds, mappings)`: every mapping is a station printer now (W21 keeps a
  watcher's printer out of `station_printers`); for each involved station, in the order given, each of
  its printers gets that station's own ticket, one build per layout, as today's station-scope branch
  does. The order-scope branch and the `orderScopeAlsoAt` parameter are deleted, and with them every
  caller's `orderScopeAlsoAt` (`readReprintParts` builds it at `:1016-1023`).
- `planKitchenTickets`: read the station mappings (when `makers`) and the watcher printers (unless
  `watchers` is `"none"`), awaited in turn; return `[]` when both are empty (today it returns early
  when the station mappings alone are empty, `:371`: that return now also needs no watcher printer).
  Build the items and stations exactly as today. Then, when there are watcher printers: read the
  order's zone once (`orderWatchZones`, Task 5, with the order's `party_id` and `delivery_table_id`,
  which `readOrderHeaders` already selects, `:250-272` — return them on `OrderHeader` rather than
  reading the row twice); for each watcher, its stations are the sorted `stations` whose id
  `watcherSees` accepts with that zone — and, with `{ newSince }`, none at all when `watcherSees`
  also accepts `newSince` with that zone (every item of such a call came from `newSince`). A watcher
  with no station left gets nothing. For each of its printers' layouts (`groupByLayout`), one
  `formatKitchenTicket({ ...head, scope: "watcher", watcherName, stations: <its stations> }, layout)`
  shared by that watcher's printers of that layout; each job's `lineIds` are the fired items at those
  stations, and its `watcherId` is set. Maker jobs come first, then watcher jobs, watchers by name.
  With `rerouted` (only `enqueueWatcherCopies` passes it, Task 9), a watcher's items are split per
  item rather than per station: those it did not follow at their old station (`watcherSees` with the
  old station and the order's zone answers false) go, grouped by old station, on copies headed with
  that station as `from` and no `mark`; the rest on the one marked copy. Each copy's items are
  arranged by station exactly as a whole copy's are.
- `enqueueKitchenJobs`: a job with `watcherId` is enqueued (`enqueuePrintJob`, kind `document` by
  default) and linked to nothing: no `kitchen_print_jobs` row and no `kitchen_print_job_lines` row
  (W23, P9). Every other job as today.
- `enqueueKitchenTickets` returns whether ANY job was queued, watcher copies included, so a HOLD print
  that reached only a watcher's printer marks the group's HOLD ticket printed
  (`printHoldTickets`, `apps/server/src/order-groups.ts:1175-1209`, sets `hold_printed_at` from that
  answer, `:1200`) — W24, with no change in `order-groups.ts`.
- `reprintOrderTickets` (W26): both parts plan with `watchers: "all"`; its existing merge
  (`job.printerId === hold.printerId && job.station === hold.station`) puts a watcher printer's fired
  and HOLD copies in one job, as it does a station printer's two tickets.
- `readReprintParts` and `readReprintTargets`: `ReprintPart` loses `orderScopeAlsoAt`; a reprint's
  targets are station printers only, so `readPrintProblems` never names a watcher printer.
- A switched-off watcher has no printers (Task 3 detaches them), and a switched-off printer is not
  read; neither prints.

- [ ] **Step 1: Write the failing tests** (`kitchen-print.watchers.test.ts`, real database, built as
  `kitchen-print.test.ts:78` builds its venue; stations Grill, Fryer and Bar each with one station
  printer; watchers and their printers through Task 3's `createWatcher` and Task 4's
  `setPrinterWatcher`; decode with `printedLines`, `apps/server/src/testing/decode-ticket.ts`):
  - **Review Focus 8:** Pass (Grill, Fryer; every zone) has one printer. One send of a burger (Grill),
    chips (Fryer) and a lager (Bar): Pass's printer has exactly ONE new job, decoding to the header
    `Pase` (the watcher's name), the table and order, then `Fryer` and its chips, `Grill` and its
    burger, and no lager or `Bar`; Grill's, Fryer's and Bar's printers each still get their own
    ticket; no `kitchen_print_jobs` or `kitchen_print_job_lines` row names Pass's job; the call
    answers `true`.
  - A zone runner: Terrace runner (every station; Terrace) — a Terrace order's burger and lager print
    as one copy listing `Bar` and `Grill`; an indoor order's send prints nothing at its printer.
  - Two printers on one watcher, 80mm and 58mm: two builds, each printer one job.
  - **W24:** a held group holding only a dish at a station with NO printer, the venue printing held
    work in advance, and Pass following that station: `printHoldTickets` queues Pass's HOLD copy and
    the group's `hold_printed_at` is set. Control: with Pass's printer detached, nothing is queued and
    `hold_printed_at` stays null.
  - **W26:** a reprint of an order with a fired burger and a held one on a printed HOLD ticket gives
    Pass's printer ONE job holding `*** REPRINT ***`, the fired section and the `*** HOLD ***` section.
  - **W23:** Pass's copy failed and given up (set as `print-problems.test.ts` sets an exhausted job):
    `listPrintProblems(tx, partyId)` and `ordersWithPrintProblem(tx, grill, [order], now)` are empty;
    `printingAlertSource()` (`apps/server/src/alert-sources.ts:251`) lists `printer.jobs_waiting` for
    Pass's printer.
  - 3c-1: Grill shows the rest of the order; Pass's copy has no "Also on this order" heading. A lager
    made here (3c-1) is on no watcher copy.
  - 3c-2: a burger with chips split off to Fryer: Pass's copy carries `> with CHIPS from Fryer` under
    the burger and `> for BURG at Grill` under the chips.
  - "Every station": a station created after Terrace runner was saved prints on its copy.
  - **P14:** a printer whose `ticket_scope` is written `'order'` directly, attached to Grill: a send
    gives it Grill's own station ticket, headed `Grill`, and no consolidated ticket.
  - `kitchen-ticket.test.ts`: a `watcher` ticket named "Runner terraza" prints that header where
    "PASE" was, then each station's name and items; with 3c-3's `from` it prints the "From" line too.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/kitchen-print.watchers.test.ts src/kitchen-ticket.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** Then convert the tests that built a whole-order printer. Rule (CLAUDE.md
  global: a rewritten test keeps the behaviour it protected): where the PASE printer stood for "the
  expediter's copy", it becomes a watcher's printer following the stations it was attached to, and
  the assertion keeps its meaning with the watcher's name as header; where the behaviour it pinned no
  longer exists (`orderScopeAlsoAt`; a pass printer's failure shown at stations), the case is deleted
  and its replacement named, in the commit message. The known ones, read 2026-10-01:
  - `kitchen-ticket.test.ts:176-189`, `:210-218`, `:533-566`, `:719-731` — `scope: "order"` becomes
    `scope: "watcher", watcherName: "Pase"`; the expected header line `"PASE"` becomes `"Pase"`.
  - `kitchen-print.test.ts`'s `makePrinter(…, "order")` (`:193-207`) — replace the `scope` parameter
    with a `watching?: WatcherFollows` that creates a watcher and attaches the printer. Cases
    `:366` (the dedupe: now "each station's ticket, and ONE copy for the watcher following both"),
    `:402`, `:610` (layouts) and `:1208` (reprint) use it. `:685` ("builds a correction slip once per
    distinct layout among the line's printers") used a 58mm order-scope printer only as a second
    layout on the line's station: make it a second STATION printer of that station, so it still
    pins one slip per layout among the line's printers (Task 9 tests watcher slips).
  - `order-groups.test.ts:4260-4285` ("sends the HOLD ticket to an order-scope printer too, as its pass
    copy") — a watcher named "Pase" following the dish's station; the expected `"PASE"` line becomes
    `"Pase"`.
  - `print-problems.test.ts` (its `passPrinter` helper, `:2055-2067`, goes):
    - `:560`, `:745`, `:924` (a pass printer's reprint printing must not clear a station printer's
      failure): the pass becomes a watcher's printer; every assertion about the station printer stays.
    - `:396` ("…a pass ticket every one"): now "…a watcher's copy none" (P9).
    - `:1101` (a pass printer's fired and held work reprinted as one job linked to both stations):
      now one job linked to no station.
    - `:1146`, `:1212`, `:1281` pinned `orderScopeAlsoAt` (a pass printer reached through the other
      part's stations), and `:1500`, `:1562`, `:1577` pinned a pass printer's failure shown at
      stations: delete all six; their replacements are this task's W26 and W23 cases.
  - 3c-1's, 3c-2's and 3c-3's PASE fixtures (3c-1 Task 5's "a PASE printer hangs off Grill", 3c-2
    Task 10's "the PASE job holds both stations' lines", 3c-3 Task 2's "an order-scope (PASE) ticket
    with `from`"): a watcher's printer following the same stations; their assertions stand, with the
    watcher's name as header.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/kitchen-print.watchers.test.ts src/kitchen-ticket.test.ts src/kitchen-print.test.ts src/print-problems.test.ts src/order-groups.test.ts src/till-api.reprint.test.ts src/kitchen-print.concurrency.test.ts`
  and every 3c suite that printed a PASE ticket (`grep -rln 'Pase\|watching:' apps/server/src/*.test.ts`),
  then `pnpm --filter @waitron/server typecheck` and `pnpm exec vitest run scripts/alert-codes.test.ts`.
  Expected: PASS. Then `grep -rn 'ticketScope\|orderScopeAlsoAt\|ORDER_HEADER\|scope: "order"' apps/server/src packages --include='*.ts'`
  prints only the schema column, its export and `printing.test.ts` (Task 4's list). Decode Review
  Focus 8's job and read it; print it on a real printer if one is reachable, and say which you did.
- [ ] **Step 5: Commit** — "Kitchen paper: a watcher's printer gets one copy of every send it follows, headed by the watcher's name and linked to no station; the whole-order printer is gone" (name the deleted print-problems cases and their replacements in the body).

---

### Task 9: Paper — watcher printers get the correction slips, and a dish that only changes station prints nothing for a watcher that still follows it

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` — `printCorrectionSlips` (`:701-756`) gains a watcher
  rule; `SentWork` (`:758-762`), `readSentWork` (`:765-779`) and `readPartiesSentWork` (`:889-942`)
  carry the order's zone before a move; `notifyMoved` (`:844-882`) uses it; 3c-3's
  `enqueueStationMoved` gains the destination station's id
- Modify: 3c-3's `apps/server/src/station-move.ts` (`moveDishesToStation`'s steps 6 and 9,
  `rerouteHeldAtRelease`'s step 5) and 3c-3's `finishRelease` (`apps/server/src/working-order.ts`)
- Test: `apps/server/src/kitchen-print.watchers.test.ts`, 3c-3's `apps/server/src/station-move.test.ts`

**Interfaces:**

```ts
/** Which watcher printers a slip goes to (W25). */
type WatcherSlipRule =
  /** VOID, RECALLED, HOLD CHANGED, HOLD CANCELLED, EXTRA CANCELLED: a watcher that follows the item now. */
  | { kind: "follows" }
  /** MOVED (to another table): one that followed it in any of these zones — before the move or after. */
  | { kind: "followed_in"; zoneIds: readonly (string | null)[] }
  /** 3c-3's MOVED TO, and its HOLD CANCELLED for a moved held dish: one that followed it at its old
   *  station (`item.stationId`) and does not follow it at `toStationId`. */
  | { kind: "followed_until"; toStationId: string };

// printCorrectionSlips(tx, cfg, orderId, items, change, knownHeader?, watchers: WatcherSlipRule = { kind: "follows" })
// SentWork GAINS `zoneId: string | null` — the order's zone (Task 5) when it was read.
// 3c-3's enqueueStationMoved(tx, cfg, orderId, items, toStationName) GAINS `toStationId: string` after
// `toStationName`, and passes `{ kind: "followed_until", toStationId }` to both its slip calls.
```

**Behaviour:**
- `printCorrectionSlips`: station printers exactly as today, except that its early return when no
  station printer is mapped (`:711`) now also needs no watcher printer. Then, unless there are no watcher
  printers (`readWatcherPrinters`, one read), the order's current zone (`orderWatchZones`, once — not
  needed for `followed_in`, which is handed its zones); for each item, the watchers the rule accepts —
  `follows`: `watcherSees(f, { stationId: item.stationId, zoneId })`; `followed_in`: `watcherSees`
  with the item's station and ANY of the given zones; `followed_until`: `watcherSees` at
  `item.stationId` and not at `toStationId` — get the same slip bytes (`formatCorrectionSlip`, headed
  with the maker station's name as today), one build per layout among those watchers' printers. A
  watcher's printer gets a slip whether or not the station had a printer (it is the watcher's paper
  that listed the dish).
- `readSentWork` and `readPartiesSentWork` read each bill's zone with `orderWatchZones` BEFORE the
  move — but only when the venue has a watcher printer (`readWatcherPrinters` first, one read;
  none → `zoneId: null` and no zone read, so a venue with no watcher printer pays a few cheap reads
  per move — this one, and `printCorrectionSlips`' own `readWatcherPrinters` when the table label
  changed — and no call through the venue-service seat; every caller reads and writes in one `tx`,
  so no watcher printer can appear between the check and the slips) (the callers already read `SentWork` before moving: `bill-actions.ts:191`, `:222`,
  `move-bill.ts:96`, `table-actions.ts:82`, `:125`, `:142`, `:262`); `notifyMoved` passes
  `{ kind: "followed_in", zoneIds: [before.zoneId, <the destination's zone now>] }`, reading the
  destination's zone once, and only when there are watcher printers.
- 3c-3's manual move (`moveDishesToStation`): step 6's `enqueueStationMoved` passes the destination's
  id; step 9's new-station tickets pass `watchers: { newSince: <the old station id> }` to
  `enqueueKitchenTickets` (one call per old station already, so one `newSince` each) — a watcher that
  followed the dish at its old station gets nothing new; one that did not, a copy with "From Bar"
  (and the HOLD header when the dish is held on a printed HOLD ticket).
- 3c-3's release re-route (`finishRelease` after 3c-3, P10): both of its `enqueueKitchenTickets` parts
  pass `watchers: "none"`; then ONE `enqueueWatcherCopies(tx, cfg, orderId, <printable>, { mark,
  rerouted })`, where `<printable>` is, in the landed code, the variable `finishRelease` passes to
  `enqueueKitchenTickets` (today `fired`, `working-order.ts:1572`) — the two station parts together,
  each item at its final station: the released records, plus the split-off extras 3c-2 inserts for
  released no-preparation dishes (3c-2 Task 4). It holds no made-here record: none is ever held
  (3c-1's T12), and a release reads only records with no fire time (P10).
  `rerouted` is 3c-3's map from `rerouteHeldAtRelease`. `rerouteHeldAtRelease` step 5's
  `enqueueStationMoved` passes the new station's id, so a watcher that followed a re-routed dish only
  at its old station gets HOLD CANCELLED there.
- **A made-here record never reaches a watcher, whatever a caller hands in (defence in its own right;
  Review Focus 14).** No path that builds a watcher copy or slip is expected to hand one in: a
  made-here record is always fired and `ready` (3c-1's T12), so releases and 3c-3's re-route (which
  read records with no fire time) never meet one, a move of one is refused `ticket.made_here` (3c-3's
  P13), and the correction slips' callers drop them first (3c-1's `withoutMadeHere`). 3d does not rely
  on any of that. In `printCorrectionSlips`' watcher branch and in
  `planKitchenTickets`' watcher copies, drop every item whose kitchen record is made here before
  choosing watchers — one read of `ticket_items.made_here` by line id for the call's items, the shape
  of 3c-1's `withoutMadeHere`, and only when there are watcher printers. Station paper is left to the
  callers, as 3c-1 left it.
- Nothing here touches drawer or receipt jobs (W27).

- [ ] **Step 1: Write the failing tests** (in `kitchen-print.watchers.test.ts`, unless the case needs
  3c-3's fixtures, then in `station-move.test.ts`):
  - **Review Focus 9, the VOID:** a watcher following Grill and Bar printed a steak (Grill) and a beer
    (Bar) on one copy; voiding the beer (`removeFromLine`, through the adjustments route as the
    existing VOID cases do) gives its printer a VOID slip naming the beer. Control: a watcher
    following Grill alone gets the steak's VOID and nothing for the beer.
  - RECALLED (`recallLines`), HOLD CHANGED and HOLD CANCELLED (a held group whose HOLD copy reached
    the watcher, then its quantity changed and then it was removed through the order edit route),
    and EXTRA CANCELLED (an extra taken off a dish the watcher follows) each reach the watcher's
    printer.
  - **MOVED (table):** Terrace runner and an indoor runner, each with a printer; a Terrace party with a
    fired burger moves to an indoor table (`moveGuests`): both runners' printers get the MOVED slip; a
    runner of a third zone gets nothing.
  - **Review Focus 9, a station move (3c-3):** a burger moved from Grill to Downstairs grill
    (`moveDishesToStation`): Terrace runner's printer (every station) gets nothing; a watcher following
    Grill and Downstairs grill gets nothing; a Grill-only watcher gets the "MOVED TO DOWNSTAIRS GRILL"
    slip; a Downstairs-grill-only watcher gets a copy with "From Grill".
  - **P10, a release re-route (3c-3):** a held mojito on a printed HOLD copy at Upstairs bar, Upstairs
    bar closed with Downstairs bar as its fallback, and a burger at Grill in the same held group; the
    group fired: a watcher following every station (every zone) gets ONE copy with `*** FIRE ***`
    listing the mojito under Downstairs bar and the burger under Grill; an Upstairs-bar-only watcher
    gets HOLD CANCELLED and no copy; a Downstairs-bar-only watcher gets one copy with "From Upstairs
    bar", no FIRE header, and the mojito.
  - **Review Focus 14, a made-here lager in a send that holds the rest:** the bar till (its made-here
    list names Downstairs bar) sends, in one request, a lager routed to Downstairs bar explicitly
    (3a's `routeProductTo` — in 3c-3's fixture Upstairs bar claims Drinks, so a lager left in Drinks
    would go to Upstairs bar, not be made here, and print) together with the held mojito and burger
    of the case above, in a held group. At the send: the lager's record is made here, fired and
    `ready` (3c-1's T12), and no watcher printer — a watcher following every station included — gets
    a copy naming it (the HOLD copies list the mojito and burger only). Then Upstairs bar closes and
    the group fires as above: still no watcher copy or slip anywhere names the lager. A move of the
    lager by hand (`moveDishesToStation`) is refused `ticket.made_here` (3c-3's P13; assert the code)
    and queues no watcher job.
  - **3d's own filter, directly:** call `enqueueStationMoved` with a made-here item (as a
    `HOLD CANCELLED` item carrying a group) and `enqueueKitchenTickets(…, { watchers: { newSince } })`
    and `enqueueWatcherCopies(…, { rerouted })` each with a made-here item: no watcher printer gets a
    job. Each case's watcher must otherwise get the job, or the case proves nothing: for
    `enqueueStationMoved`, a watcher following the item's old station and not `toStationId`; for
    `{ newSince }`, one following the item's station and NOT `newSince`; for `rerouted`, one following
    the item's final station. Proof by deletion, each filter in turn: remove the made-here drop from
    `printCorrectionSlips`' watcher branch and confirm the `enqueueStationMoved` case fails (and only
    it); restore; remove the drop from `planKitchenTickets`' watcher copies and confirm the
    `{ newSince }` and `rerouted` cases fail; restore.
  - **Review Focus 12 (W27):** a watcher printer with `has_cash_drawer` set: after a send, a VOID, a
    reprint and a move, every job it has is kind `document`; no `drawer` job exists for it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/kitchen-print.watchers.test.ts src/station-move.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, and
  `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts src/order-groups.test.ts src/party-move-bill.test.ts src/party-table-actions.test.ts src/adjustments-extra-cancel.test.ts src/working-order.test.ts src/split-bill.test.ts`,
  then `pnpm --filter @waitron/server typecheck`. Expected: PASS. Proof by deletion: make
  `followed_until` behave as `follows` and confirm the "Grill and Downstairs grill" case fails on
  "gets nothing"; restore.
- [ ] **Step 5: Commit** — "Kitchen paper: a watcher's printer gets every correction slip about a dish on its paper, and nothing when a dish only changes station between stations it follows".

---

### Task 10: The till's pass screen lists the watchers, shows one, and marks its own Done

**Files:**
- Modify: `apps/till/src/api/client.ts` — beside `ExpoOrder` (`:1364`): `WatcherSummary`
  (`{ id; name; runsPass }`), `WatcherCourse`, `WatcherGroup`, `WatcherOrder`, `WatcherBoard`,
  mirroring Task 6's server types; methods beside `getExpoQueue` (`:2104`): `listWatchers()` →
  `GET /api/watchers`, `getWatcherQueue(id, options: ReadOptions = {})` →
  `GET /api/watchers/:id/queue`, `markWatcherDone(id, ticketItemIds, done)` →
  `POST /api/watchers/:id/done`
- Modify: `apps/till/src/navigation.ts` — the keys under `tillPath.children["*"]` (`:6`) gain
  `"till-watcher": "watcher"`
- Modify: `apps/till/src/till-app.ts` — every write that clears `"till-station"` clears
  `"till-watcher"` too: `#setActiveTab` (`:1327`) and the drill writes (`:5365`, `:5374`), so a tab
  change or a new drill never leaves a stale watcher in the address. `#restoreDestination` (`:1347`,
  run at boot, `:1526`, and on history moves, `:3028`) writes `"till-station"` as it does today and
  `"till-watcher"` the same way: kept when the restored destination is `expo`, cleared otherwise — so
  reloading a watcher board keeps its watcher. (The fifth `till-station` write, `:2504`, opens the
  station screen and leaves the watcher key alone.)
- Test: `apps/till/src/till-app.test.ts` — a tab change clears `till-watcher`; a reload of an
  address whose `till-view` is `expo` and whose `till-watcher` names a watcher restores that
  watcher's board; a reload on another destination
  clears it
- Modify: `apps/till/src/screens/till-expo-screen.ts`
- Modify: `apps/till/src/i18n/strings.ts` (beside `expo.*`, English `:174-183`, Spanish `:986-995`),
  `apps/till/src/i18n/codes.ts` (`watcher.not_found`)
- Test: `apps/till/src/screens/till-expo-screen.test.ts`, `till-expo-screen.a11y.test.ts`,
  `apps/till/src/api/client.test.ts`

**What the screen does (the tests pin each):**
- **Where the chooser appears (W14, P15), decided from the code:** only on the screen the shell's
  Expo button opens — `till-app.ts`'s `expo` drill (`:5682-5687`), which renders
  `<till-expo-screen>` WITHOUT `embedded`. The `expo` canvas card (`card-grid.ts:283-288`) renders it
  WITH `embedded`, and an embedded screen shows "All stations" exactly as today, reads no
  `listWatchers()`, and shows no list (P15): W14 is about the button, and a card asking a question
  every time its tab loads would take today's card away.
- **The chooser (W14, P8).** On connect, not embedded and outside device mode (Task 11), it reads
  `listWatchers()`.
  None → it shows "All stations" at once, exactly as today. One or more → a list: "All stations",
  then each watcher by name, as `wt-button`s; choosing one writes `till-watcher` (`"all"` or the
  watcher's id) through a `UrlStateController` the way `till-station-screen.ts:175-200` owns
  `till-station` — only when not `embedded` and while the till's view is `expo` — and shows that
  board; a stored `till-watcher` naming a watcher that is no longer listed falls back to the list. The
  board's header shows what it is ("All stations" or the watcher's name) and a "Change" button back to
  the list. A failed `listWatchers()` shows "All stations" (nothing a venue used disappears).
- **"All stations"** is today's board, unchanged, except that it now asks again every 15 seconds (P7).
- **A watcher's board** reads `getWatcherQueue(id)`. Each item shows what an "All stations" item shows
  (`#item`, `:648-673` before this task), through `#item` with a new watcher-board flag that changes
  only sent-out dishes on a watcher's board (below; "All stations" calls it without the flag and
  renders exactly as today), and a "Done" `wt-button` whose accessible
  name names the dish ("Done: BURG"); each order card ends with "All done", which sends every item the
  card shows. Done calls `markWatcherDone(id, ids, true)`, then reads the board again. After a Done,
  one `role="status"` line reads "BURG marked done." with an "Undo" button for 10 seconds (P6); Undo
  sends the same ids with `done: false` and reads again. No kitchen notice is shown (W12).
- **A watcher's board never hides a section for being away** (W4, W11; Review Focus 13). Today's
  `#visibleCourses` / `#visibleGroups` (`till-expo-screen.ts:553-563`) drop a fully-away course or
  group; they stay for "All stations" only. On a watcher's board every section the server sends is
  shown, and on a watcher's board a dish whose `awayAt` is set reads "Sent out" / "Despachado"
  beside its state (`expo.sent_out`, P12), until it is marked done or served. **On a watcher's board
  only (P19), a sent-out dish has no lateness colour and no "Forgotten" flag, and the order's colour
  and the overdue count are worked out from its other dishes** — per dish, narrower than today's
  `#orderBand` (`:773-780`), which leaves out only sections that are wholly away. "All stations"
  keeps today's `#item`, `#orderBand` and `#overdueOrderCount`: a section there with some dishes away
  is shown today (`working-order.ts:5587` rolls `away` up only when every item is away) and its away
  dishes keep their colour and flag.
- **Levers (W6, P4).** Only on a watcher that runs the pass (`runsPass`), opened at a signed-in
  till: the course and group levers exactly as on "All stations" (`#lever`, `#groupLever`) — Fire
  only when `fireControl === "expo"`, Ready and Away whatever the fire control — with "ready" decided
  by the section's `allReady` from the server (the board shows only the watcher's items, so the
  screen cannot tell from them). A section whose `away` is true shows NO lever: its dishes are already
  sent out, and both Away verbs stamp only dishes not yet away (`markCourseAway`,
  `apps/server/src/working-order.ts:1796`; `markGroupAway`, `order-groups.ts:295`), so an Away there
  would change nothing — a group's would only bump the party's revision (`order-groups.ts:332`), a
  course's nothing at all — and P5 would then mark the section Done under the label Away. A watcher without the switch shows Done and All done only.
  After Away succeeds on a watcher, the screen sends Done for that section's shown items (P5).
- **Reprint** stays on each card, on both boards, as today (W26).
- **Refresh (W13, P7).** Every 15 seconds, each read cancelled after 25 seconds, with the same
  "No updates since …" line (`stale-since`, and the `station.stale*` strings) the station screen shows
  when a read fails (`till-station-screen.ts:34-40`, `:205-236`, `:557`). Reads after the screen's own
  actions stay. A failed lever is swallowed as today; a failed Done shows its message (`codeMessage`)
  in the screen's error line, because a Done that silently fails leaves a dish on the pass.
- No colour or size that is not a `--wt-*` token.

**Strings** (English / Spanish; `t()` does not interpolate — fill `{dish}` with a replacer function, as
`station.notice.moved_to` is filled): `expo.choose` "What should this screen show?" / "¿Qué debe
mostrar esta pantalla?"; `expo.all_stations` "All stations" / "Todas las estaciones"; `expo.change`
"Change" / "Cambiar"; `expo.done` "Done" / "Hecho"; `expo.done_dish` "Done: {dish}" / "Hecho: {dish}";
`expo.all_done` "All done" / "Todo hecho"; `expo.sent_out` "Sent out" / "Despachado"; `expo.marked_done` "{dish} marked done." / "{dish} marcado
como hecho."; `expo.undo` "Undo" / "Deshacer"; `expo.watcher_empty` "Nothing waiting here" / "Nada
pendiente aquí"; `expo.watcher_removed` "This screen's watcher was removed. Ask a manager to set this
screen up again." / "Se ha eliminado el punto de seguimiento de esta pantalla. Pide a un encargado
que vuelva a configurarla." Codes: `watcher.not_found` "That watcher no longer exists." / "Ese punto
de seguimiento ya no existe."

- [ ] **Step 1: Write the failing tests** (`till-expo-screen.test.ts`, the file's stub `api`, `:179`):
  - no watchers: the board is "All stations" and `getExpoQueue` was called, no list;
  - two watchers: the list shows "All stations", "Pass", "Terrace runner"; choosing Pass calls
    `getWatcherQueue(pass)` and writes `till-watcher`; "Change" shows the list again; a stored
    `till-watcher` of an unlisted id shows the list;
  - Done calls `markWatcherDone(pass, [item], true)` then reads again; "All done" sends every shown id
    of the card; the Undo line appears and Undo sends `done: false`; the line is gone after 10 seconds
    (the file uses no fake timers today; copy the station screen test's set-up,
    `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] })`,
    `apps/till/src/screens/till-station-screen.test.ts:1185`);
  - **P15:** an `embedded` screen with two watchers listed calls
    `getExpoQueue`, never `listWatchers`, and renders no list;
  - **Review Focus 13 (screen side):** a watcher board whose section has `away: true` and items with
    `awayAt` set, and no mark, renders those items with "Sent out", and that section shows no lever
    even on a watcher that runs the pass. Proof by deletion: filter the watcher board through
    `#visibleCourses` / `#visibleGroups` and confirm the "Sent out" case fails;
  - **P19, both boards, one section with `away: false`:** an old sent-out dish (its `awayAt` set and
    `queuedAt` past its forgotten threshold) and a fresh dish not yet away in the SAME section. On a
    watcher board: the old dish shows "Sent out" and no `[data-forgotten]`, the card has no age colour
    and the overdue count is 0. On "All stations", the same order: the old dish shows
    `[data-forgotten]` and no "Sent out", and the card is coloured forgotten, as today. Proof by
    deletion: drop the watcher-board flag from `#item` and confirm the watcher case fails on
    `[data-forgotten]`;
  - **Review Focus 5 (screen side):** a watcher with `runsPass: false` shows no lever at all; with
    `true` and `fireControl: "expo"`, a held course shows Fire; with `fireControl: "kitchen"`, no Fire
    but Ready/Away; Ready shows while `allReady` is false and Away once it is true, whatever the shown
    items' states; Away then Done for the section's shown items (P5);
  - a 15-second tick reads again (advance fake time by 15 000 ms: a second `getWatcherQueue`, and on
    "All stations" a second `getExpoQueue`); a failed read shows the stale line;
  - the existing cases keep passing unchanged: they run on real timers and finish far inside 15
    seconds, so `:710`'s "connect + after fire" count of two stays true.
  - a11y (`till-expo-screen.a11y.test.ts`): the list, a watcher board with Done buttons, the Undo line,
    and the removed notice, in both themes.
- [ ] **Step 2: Run** — check memory first —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.test.ts src/screens/till-expo-screen.a11y.test.ts src/api/client.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `pnpm --filter @waitron/till typecheck`. Expected: PASS. Then LOOK:
  `wa-wt demo <worktree-name>`, enrol the browser at `localhost:5190` with the code `DEMO`, sign in,
  open Pass from the shell, choose the demo's Pass watcher (Task 14 seeds it; until then make one
  through the route), send dishes from a table, mark one done, undo it — in both themes, at handheld
  width and at desktop width.
- [ ] **Step 5: Commit** — "Till: the pass button lists All stations and each watcher; a watcher's board shows its dishes, refreshes every 15 seconds, and marks its own Done".

---

### Task 11: An always-on watcher screen boots into its watcher

**Files:**
- Modify: `apps/till/src/api/client.ts` — `DeviceIdentity` (`:1232-1241`) gains `watcherId?: string | null`;
  `getDeviceWatcher(options)` → `GET /api/device/watcher`, answering a `WatcherBoard`; `markDeviceWatcherDone(ids, done)` →
  `POST /api/device/watcher/done`
- Modify: `apps/till/src/till-app.ts` — the kitchen-screen boot (`:1469-1474`) and every place it
  hands `initialDeviceStation` on (`:5578`, `:5680`)
- Modify: `apps/till/src/widgets/card-grid.ts` — the `kds-board` card (`:284-294`)
- Modify: `apps/till/src/screens/till-expo-screen.ts` — device mode
- Test: `apps/till/src/till-app-boot-and-counter.test.ts` (the kitchen-screen boot cases live in the
  `till-app*.test.ts` files that stub `getDeviceStation`: `grep -rln 'getDeviceStation' apps/till/src/*.test.ts`),
  `apps/till/src/widgets/card-grid.test.ts`, `apps/till/src/screens/till-expo-screen.test.ts`

**Behaviour:**
- At boot, a `kds_station` whose identity has a `watcherId` reads `getDeviceWatcher()` instead of
  `getDeviceStation()` (which answers `device.unauthorized` for it, `apps/server/src/device-api.ts:204`
  — calling it would send the screen to the join screen), keeps the answer as `initialDeviceWatcher`,
  and enters device mode as a station's screen does. Wherever a kitchen screen is given its station
  board (`till-station-screen` with `deviceMode` and `initialDeviceStation`, in `till-app.ts` and the
  `kds-board` card), a watcher's screen is given `till-expo-screen` with `deviceMode` and the watcher
  board instead.
- In device mode `till-expo-screen` shows that watcher only: no list, no "Change", no Back, no levers,
  no Reprint (W7: those routes need a signed-in session). Done, All done and Undo call the device
  routes. It reads every 15 seconds as in Task 10. A board answering `active: false` shows
  `expo.watcher_removed` and nothing else (P3).
- A station's kitchen screen boots exactly as today.

- **The test stubs.** The `till-app*.test.ts` files that stub `getDeviceStation`
  (`grep -rln getDeviceStation apps/till/src/*.test.ts` lists eight) build their stub as an object
  cast `as unknown as TillApi` (for example `till-app-boot-and-counter.test.ts:194`), so the two new
  client methods break no typecheck there; only the new boot case stubs `getDeviceWatcher`. A suite
  whose boot answers an identity with a `watcherId` must stub it.
- [ ] **Step 1: Write the failing tests:** boot with an identity carrying `watcherId` calls
  `getDeviceWatcher` and never `getDeviceStation`, and renders `till-expo-screen` in device mode; with
  `stationId` it renders the station screen as today; the device-mode board shows no lever, no
  Reprint, no "Change", and its Done calls `markDeviceWatcherDone`; the removed notice; a11y of the
  device-mode board in both themes.
- [ ] **Step 2: Run** — check memory first — `pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/widgets/card-grid.test.ts src/screens/till-expo-screen.test.ts src/screens/till-expo-screen.a11y.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `pnpm --filter @waitron/till typecheck`. Expected: PASS. Then LOOK:
  in the dev stack's device chooser (`?dev`), pick the demo's watcher screen (Task 14's "Pantalla
  Pase"; until then enrol one with Task 7's route), send a dish from another tab, watch it arrive
  within 15 seconds, mark it done — both themes, at the kitchen screen's landscape width and at phone
  width.
- [ ] **Step 5: Commit** — "Till: a kitchen screen bound to a watcher opens that watcher's board, where it can only mark its own Done".

---

### Task 12: The Devices screen joins a kitchen screen to a station or a watcher

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts` — the join picker (`#renderBindingPicker`,
  `:680-703`), `#bindingReady` (`:339-347`), `#accept` (`:353-375`), the `updated()` reconciliation
  (`:205-217`), and the device row (`#renderDevice`, `:531-560`); it watches `listWatchers` (Task 3)
  beside `listStations` (`:237-240`)
- Modify: `apps/dashboard/src/api/client.ts` — `DeviceRow` (`:436-445`) gains `watcherId: string | null`;
  `acceptDeviceJoinRequest`'s input (`:2147`) gains `watcherId?: string`
- Modify: `apps/dashboard/src/api/live-queries.ts` — `listDevices` (`:157`) gains `"watchers"`
- Modify: `apps/dashboard/src/i18n/strings.ts` (both languages)
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`, `devices-screen.a11y.test.ts`,
  `apps/dashboard/src/api/client.test.ts`

**Behaviour:**
- For a kitchen-screen profile, the picker's label becomes "Shows" / "Muestra", and its `<select>`
  (now `name="binding"`) lists the switched-on stations under an `<optgroup>` "Stations" /
  "Estaciones" and the switched-on watchers under "Watchers" / "Puntos de seguimiento"; each option's
  value is `station:<id>` or `watcher:<id>`. Accept sends `stationId` or `watcherId` accordingly, never
  both. The empty first option reads "Choose what it shows" / "Elige qué muestra". The chosen option is
  restored after a render the way the file's `updated()` already restores `join-station`.
- A device row says what it shows: the station's name as today, or the watcher's name, prefixed
  "Watcher: " / "Punto de seguimiento: " so a cook's screen and a pass screen read apart.
- `watcher.not_found` (a watcher removed meanwhile) shows at the bottom of the dialog's body, in both
  languages, through the codes table (Task 4 added the words).
- No colour or size that is not a `--wt-*` token.

- [ ] **Step 1: Write the failing tests:** the picker lists stations and watchers in two groups;
  choosing a watcher and accepting sends `watcherId` and no `stationId`; a station still sends
  `stationId`; a device row bound to Pass reads "Watcher: Pass"; a `watcher.not_found` refusal shows at
  the bottom of the dialog; a11y of the dialog with both groups, in both themes.
- [ ] **Step 2: Run** — check memory first —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts src/screens/devices-screen.a11y.test.ts src/api/client.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, `pnpm exec vitest run scripts/live-subscriptions.test.ts` and
  `pnpm --filter @waitron/dashboard typecheck`. Expected: PASS. Then LOOK: in the dev stack, knock
  from a fresh browser profile with a kitchen-screen profile, accept it as the Pass watcher's screen,
  and see the row — both themes, desktop and phone width.
- [ ] **Step 5: Commit** — "Devices: a kitchen screen joins as a station's screen or a watcher's screen".

---

### Task 13: Prep Stations — watchers are set up beside the stations, and the tester names them

**Files:**
- Create: `packages/venue-service/src/dashboard/watcher-form.ts` + `.test.ts` — the form body shown in
  a `wt-modal`
- Create: `packages/venue-service/src/dashboard/watchers-seen.ts` + `.test.ts` — pure:

```ts
/** The shape `GET /management-api/watchers` answers (Task 3), as the screen reads it. */
export interface WatcherView {
  id: string; name: string; everyStation: boolean; stationIds: string[];
  everyZone: boolean; zoneIds: string[]; runsPass: boolean; printerIds: string[];
}
/** Which watchers see a dish made at `stationId` for an order in `zoneId` (null: no zone) — the rule
 *  `watcherSees` applies on the server (`apps/server/src/watchers.ts`), restated here because a
 *  module's dashboard cannot import core's server code. */
export function watchersSeeing(watchers: readonly WatcherView[], stationId: string, zoneId: string | null): WatcherView[];
/** The watchers that follow `stationId` in any zone, for a station card's "Watched by". */
export function watchersOfStation(watchers: readonly WatcherView[], stationId: string): WatcherView[];
```

- Modify: 3a's `packages/venue-service/src/dashboard/routing-client.ts` — `PrepStationsApi.load()`
  also reads `GET /management-api/watchers`; new `createWatcher`, `updateWatcher`, `removeWatcher`
  calling Task 3's routes; the devices and printers it already reads now carry `watcherId` (Tasks 7, 4)
- Modify: 3a's `packages/venue-service/src/dashboard/prep-stations-screen.ts`, its `.test.ts` and
  `.a11y.test.ts`
- Modify: 3a's `packages/venue-service/src/dashboard/live-queries.ts` — the `routing` entry gains
  `"watchers"`, `"watcher_stations"`, `"watcher_zones"`, `"watcher_printers"`
- Modify: `packages/venue-service/src/dashboard/strings.ts` (both languages)

**What the screen shows (the tests pin each):**
- A **Watchers** card group after the stations (W1, W17), one card per switched-on watcher in display
  order: its name; "Follows: Grill, Fryer, Cold" or "Follows: every station"; "For: Terrace" or "For:
  every service zone"; "Runs the pass" when its switch is on; its screens (devices
  whose `watcherId` is it), read-only, linked to `/manage/devices`; its printers, read-only, linked to
  `/manage/printing-rules` (they are attached there, Task 4, as a station's printers are, 3a R7);
  Edit and Remove. "New watcher" in the group's header opens the empty form.
- **The form** (`watcher-form`, in a `wt-modal`), following `docs/developers/design-system.md` →
  Forms and CLAUDE.md §3: three fields marked required — **Name** (`name="name"`); **Stations**
  (at least one, or every station): "Every station" (`name="everyStation"`) and one checkbox per
  switched-on station (`name="stationIds"`, disabled while "Every station" is ticked); **Service
  zones** (at least one, or every zone): "Every service zone" (`name="everyZone"`) and one per
  switched-on zone (`name="zoneIds"`) — and a `wt-switch` "Runs the pass" (`name="runsPass"`) with
  the line under it "Shows Fire (when the pass fires held work), Ready and Away for whole courses and
  groups." (P4). An invalid submission explains itself beside every bad field — an empty name under
  Name; no station and not every station under Stations ("Choose at least one station, or every
  station"); the same for zones — AND in one localized message on its own line at the bottom of the
  form ("Fix the fields marked above." / "Corrige los campos marcados arriba."), above the buttons; no
  summary at the top. From the server: `watcher.name_taken` under Name; `management.request_invalid`
  naming `stationIds` or `zoneIds`, and `station.not_found` / `zone.not_found`, under that group;
  any other refusal at the bottom of the form, on its own line. The save button stays disabled until
  the fields are fixed. A station switched off since keeps no box (the
  form saves from the boxes it shows, as 3c-1's made-here boxes do).
- **Remove** asks first: "Remove Pass? Its screens will say it was removed, and its printers stop
  printing its copies." Confirm calls `removeWatcher`; a refusal shows at the end of that dialog's body.
- **Each station card** gains "Watched by: Pass, Terrace runner" (`watchersOfStation`), left out when
  no watcher follows it (P13).
- **The tester** (3a's "Where is this made?"; 3b gave it a time, 3c-2 the extras): under the answer,
  "Watched by: Pass, Terrace runner" (`watchersSeeing` with the made-at station and the chosen service
  zone, `null` for "No service zone"), or "No watcher follows it."; nothing when the answer is "No
  preparation" (W9) or when nothing can make it.
- No colour or size that is not a `--wt-*` token.

**Strings** (English / Spanish): `watchers.title` "Watchers" / "Puntos de seguimiento";
`watchers.new` "New watcher" / "Nuevo punto de seguimiento"; `watchers.follows` "Follows: {list}" /
"Sigue: {list}"; `watchers.every_station` "every station" / "todas las estaciones"; `watchers.for`
"For: {list}" / "Para: {list}"; `watchers.every_zone` "every service zone" / "todas las zonas de
servicio"; `watchers.runs_pass` "Runs the pass" / "Lleva el pase"; `watchers.runs_pass_hint`
"Shows Fire (when the pass fires held work), Ready and Away for whole courses and groups." /
"Muestra Marchar (cuando el pase marcha el trabajo retenido), Listo y En camino para cursos y grupos
enteros."; `watchers.fix_fields` "Fix the fields marked above." / "Corrige los campos marcados
arriba."; `watchers.screens`, `watchers.printers`;
`watchers.remove_confirm` as above; `watchers.need_station` "Choose at least one station, or every
station" / "Elige al menos una estación, o todas"; `watchers.need_zone` "Choose at least one service
zone, or every service zone" / "Elige al menos una zona de servicio, o todas"; `watchers.watched_by`
"Watched by: {list}" / "Lo siguen: {list}"; `watchers.none_follow` "No watcher follows it." /
"Ningún punto de seguimiento lo sigue."; and the messages for `watcher.name_taken` and
`watcher.not_found`.

- [ ] **Step 1: Write the failing tests.** `watchers-seen.test.ts`: the same cases as Task 3's
  `watcherSees` test (the pass in any zone and with no zone; the runner only in its zone, never with
  no zone), written a second time here. Nothing ties the two tables together: a change to the
  server's rule leaves this test green, so a change to either rule must change both files (Task 15's
  backlog entry records the duplicate); `watchersOfStation` for an
  every-station watcher and a listed one. `watcher-form.test.ts`: the three client checks beside
  their fields and the one message at the bottom of the form; the three groups marked required; "Every station" disables the station boxes; the body sent; each server refusal in its
  place; Save disabled until fixed. `prep-stations-screen.test.ts` (3a's stub `PrepStationsApi`): the
  Watchers group with each card's lines, screens and printers; New, Edit and Remove call the client;
  a station card's "Watched by"; the tester's "Watched by", "No watcher follows it." and nothing for
  no preparation. The a11y test adds the group, the form with a refusal, and the remove dialog, in both
  themes.
- [ ] **Step 2: Run** — check memory first —
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/dashboard/watchers-seen.test.ts src/dashboard/routing-client.test.ts`
  and `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/watcher-form.test.ts src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.a11y.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** The screen imports nothing from `apps/server`; it reaches core only over
  HTTP, as 3a's station writes do.
- [ ] **Step 4: Run** the same, `pnpm exec vitest run scripts/live-subscriptions.test.ts` and
  `pnpm --filter @waitron/venue-service typecheck`. Expected: PASS. Then LOOK: Prep Stations in the
  dev stack, create "Terrace runner" (every station, Terrace), edit Pass, try a duplicate name, remove
  one, use the tester on a burger for the Terrace — both themes, desktop and phone width.
- [ ] **Step 5: Commit** — "Prep stations: watchers are set up beside the stations, each station says who watches it, and the tester names the watchers".

---

### Task 14: The demo has a Pass watcher, and dev-setup a screen for it (W19)

**Files:**
- Create: `apps/server/scripts/demo-seed/seed-watchers.ts` + `seed-watchers.test.ts`
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` — `seedCatalogues` (`:84`) also returns
  the station ids it already resolves (`resolveStationIds`, `:45-80`, answering `{ kitchen, bar,
  upstairsBar, deli }`) as `stationIds`, beside `productsByImage` and `menuIds` (`:205-209`)
- Modify: `apps/server/scripts/demo-seed/seed.ts` — take `stationIds` from `seedCatalogues` (`:45`)
  and call `seedWatchers(tx, { locationId, locale, stationIds })` after `seedFloor` (`:50`), in the
  same transaction
- Modify: `apps/server/scripts/dev-setup.ts` — `seedDemoDevices` (`:269-335`) enrols a fourth device
- Test: `apps/server/scripts/dev-setup.test.ts` ("enrols a till, handheld and kitchen display via the
  real enrol path", `:288-321`), `apps/server/scripts/demo-seed/seed.test.ts` (if it counts what the
  seed writes)

**Behaviour:** `seedWatchers` inserts, through the table definitions (seed scripts have no management
session, as `seed-catalogue.ts:56-58` says of its stations), one watcher named "Pass" (English seed)
or "Pase" (Spanish), following the demo's two food stations by the ids `seedCatalogues` hands it,
`stationIds.kitchen` and `stationIds.deli` (no lookup by name: the seed renames "Cocina" to "Kitchen",
`seed-catalogue.ts:45-56`, and a later slice may rename again), every zone, running the pass (P4),
display order 1. If 3a's landed seed changed `resolveStationIds`' answer, take the kitchen and deli
ids from whatever it returns now. `seedDemoDevices` reads the location's one switched-on watcher
(the demo seeds exactly one) and enrols "Pantalla Pase" with the `kds` profile and that watcher's id
(`enrolDeviceForTest(…, { watcherId })`, Task 7), after the kitchen display. The device chooser lists
it (`?dev`), and choosing it boots the watcher board (Task 11).

- [ ] **Step 1: Write the failing tests:** `seed-watchers.test.ts` — after seeding, one switched-on
  watcher follows exactly Kitchen and Deli counter, every zone, running the pass, named by the seed
  locale;
  `dev-setup.test.ts` — the device list gains `{ label: "Pantalla Pase", form_factor: "kds",
  register_name: null, station_name: null }`, and that device's `watcher_id` names the seeded watcher
  (extend the query with a `left join watchers`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-watchers.test.ts scripts/dev-setup.test.ts`
  (or the paths the server's vitest config gives those suites). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same and `scripts/demo-seed/seed.test.ts`. Expected: PASS. Then
  `wa-wt reset demo <worktree-name>` and open the chooser: "Pantalla Pase" is listed and boots into the
  Pass board.
- [ ] **Step 5: Commit** — "Demo: a Pass watcher follows the kitchen stations, and dev-setup enrols a screen for it".

---

### Task 15: The documents catch up, and the claims this slice retires go

**Files:**
- Modify: `docs/backlog.md`:
  - the slice 3 design entry (`:222-226`, "3d, watchers. **Next action:** … the 3d plan is written
    next"): name this plan ("3d, watchers: the pass and runners on screen and paper, and the
    whole-order printer becomes a watcher's printer ([plan](superpowers/plans/2026-10-01-watchers-slice-3d.md))"),
    and "built (#PR)" when it lands. Another slice-3 change may have edited the same sentence: merge,
    do not overwrite;
  - NEW entries, each with its reason: "The table plan does not show how many dishes are being made"
    (W16: one more count in `listTablesWithState`); "The floor does not refresh on its own" (W16: it
    re-reads only on events — `till-floor-screen.ts` and `till-app.ts`'s `floor-refresh` handling;
    a timer would read `listTablesWithState` every few seconds on every till); "Drop
    `printers.ticket_scope` at the next reset" (W20: unread since 3d; the drop rebuilds `printers`,
    which a venue that has printed refuses); "A failed watcher copy is cleared only by printing or a
    resend, not by a Reprint" (P9); "A canvas card that shows one watcher" (P15); "Alert when a
    watcher's screens go dark" (P17); "Move an enrolled kitchen screen to another station or watcher
    without joining again" (P18); "`watcher_item_marks` cascades from `ticket_items`, so a rebuild of
    `ticket_items` empties it" (CLAUDE.md §3's rebuild rule); "The watcher rule is written twice"
    (`watcherSees`, `apps/server/src/watchers.ts`, and `watchersSeeing`,
    `packages/venue-service/src/dashboard/watchers-seen.ts`, each with its own hand-copied test
    table; nothing ties them together);
  - the printing-problem entries that describe a pass printer's failed ticket shown at every station
    it covered (`:3820-3823`, and the mentions at `:3903` and `:3925-3926`): a dated note each —
    "_2026-10-01 (slice 3d): the whole-order printer is gone; a watcher's copy is linked to no station
    and shows no printing problem (W23)._"
- Modify: the design, `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md`:
  - at §8's second bullet ("What the whole-order printer becomes"): "_2026-10-01 (slice 3d, owner):
    it becomes a watcher's printer. A watcher is a named thing set up on Prep Stations, following
    stations and service zones (both must match); its printers print one copy per send, headed by its
    name, and every correction slip about a dish on that paper; the "one ticket per order" setting is
    gone, its column left unread until the next reset. [Plan](../plans/2026-10-01-watchers-slice-3d.md)._";
  - at §8's first bullet (the table plan): "_2026-10-01 (slice 3d): left as it is; a "being made"
    count and a refresh are in the backlog._";
  - at §5.1's two bullets "A kitchen screen device is bound to one station" and "A printer can print
    one ticket per station, or one per whole order" (`:253-255`): "_2026-10-01 (slice 3d): a kitchen
    screen binds a station or a watcher; the whole-order setting is gone._";
  - at §5.9: "_2026-10-01 (slice 3d): a watcher is its own thing, not a station (W2); both what it
    follows must match; it marks its own Done, and today's Away stays one shared mark (owner); Fire is
    a switch on the watcher (owner)._";
  - at §5.12's "what the station watches, if it is a watcher": "_2026-10-01 (slice 3d): watchers are a
    separate group on Prep Stations; a station card says which watchers follow it._"
- Modify: `docs/developers/products.md` — the surfaces table (`:152-165`): the kitchen display and
  expediter row (`:157`) names `listWatcherQueue` (`apps/server/src/watcher-board.ts`) beside
  `listExpoQueue`; the kitchen ticket row says a watcher's copy reads the same names through
  `buildTicketItems`.
- Modify: `docs/developers/conventions-ui.md` — only if the sweep below finds a printing or pass rule
  there (read 2026-10-01: `grep -n -i 'kitchen ticket\|pass printer\|expo' docs/developers/conventions-ui.md`
  found none).

**The sweep** (CLAUDE.md §1: a behaviour change retires every receipt about the old behaviour,
wherever it lives — the PATH SET matters):

```sh
grep -rn -i "one ticket per order\|un ticket por pedido\|PASE\b\|order scope\|order-scope\|ticket_scope\|ticketScope\|orderScopeAlsoAt\|pass printer\|pass copy\|group printer\|consolidated ticket\|bound to one station\|binds a station and no register\|binds a kitchen station and no\|one per whole order" \
  CLAUDE.md README.md docs/developers docs/superpowers/specs docs/backlog.md apps packages scripts \
  --include='*.ts' --include='*.md' --include='*.mjs' | grep -v node_modules | grep -v '/dist/'
```

and a second pass for phrases wrapped across lines, as 3c-2 Task 13 ran its own (`[\s*/]+` between
words, so a comment's line break and its `*` do not hide a phrase):

```sh
git ls-files -- CLAUDE.md docs/developers docs/superpowers/specs apps packages | grep -E '\.(ts|md)$' \
  | xargs perl -0777 -ne 'my $w = qr{[\s*/]+}; while (/(one${w}ticket${w}per${w}(?:whole${w})?order|bound${w}to${w}one${w}station|pass${w}(?:printer|copy)|order${w}scope)/gi) { my $l = 1 + (substr($_,0,$-[0]) =~ tr/\n//); (my $m=$1) =~ s/\s+/ /g; print "$ARGV:$l: $m\n" }'
```

Each hit is fixed, or left with its reason in the commit message: the schema column and its doc
(Task 4's wording), the migrations (never edited), historical plans and specs (a dated pointer, never
a rewrite), and the backlog's dated history. Known hits to expect: `packages/db/src/schema/devices.ts:7-11`
(Task 2 rewrote it), `apps/server/src/kitchen-ticket.ts:4-5` (Task 8), `packages/db/src/schema/kitchen-print-jobs.ts`
(Task 8), the `print-problems.test.ts` names (Task 8), `apps/server/src/errors.ts:669-675`'s
`device.till_required` ("In practice a `kds_station`") — still true. And read, whole, every file this
branch changed for a sentence the patterns miss (`git diff --name-only origin/main...HEAD`). Cut
comments that only restate the code while touching these files (owner, 2026-09-23); prefer deleting
to rewording.

- [ ] **Step 1:** the sweep; fix each hit.
- [ ] **Step 2:** the backlog, design and products edits.
- [ ] **Step 3:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (it checks only that a
  backticked path exists). `docs/` is ignored by prettier, so `prettier --check` over it proves
  nothing (CLAUDE.md §2); read the rendered tables instead.
- [ ] **Step 4: Commit** — "Documents: watchers in the backlog, the design and the product-names guide, and the sentences about the whole-order printer and a kitchen screen bound to one station retired".

---

## Landing

Lands when green (the review wave clean and required CI passing). No venue reset is expected: Task 2's
generated migration adds tables and one column, and its custom migration re-creates two triggers. If
the generated SQL rebuilds a table (`__new_devices`, or any other), that is a STOP and the landing
rule becomes needs-owner-review. The PR body's first lines say P14 (a "one ticket per order" printer
becomes a station printer of its stations) and that a watcher's printers are attached on Printing
rules.

## Self-review notes

- Design coverage: §5.2 and §5.9 — watchers on screen (Tasks 2, 3, 5, 6, 7, 10, 11) and on paper
  (Tasks 4, 8, 9); "follows stations, delivery areas, or both" (W3: both must match, Tasks 3, 6);
  "marks its own copy done" (Tasks 6, 7, 10, 11); "Fire on the expediter's watcher screen" (W6,
  Tasks 7, 10). §5.11's last sentence (watchers do not see made-here items): Tasks 6, 8. §5.12's
  "what the station watches" and the tester's watchers: Task 13. §8's whole-order printer: Tasks 4, 8,
  9, 15; §8's table plan: W16, Task 15's backlog entries.
- W1 Tasks 3, 4, 7, 13; W2 Tasks 2, 7 (a watcher's screen leaves `devices.station_id` null, so no
  station reader meets it), 13; W3 Tasks 3, 6, 8; W4 Task 6 (Review Focus 4); W5 Tasks 6, 10; W6
  Tasks 7, 10; W7 Tasks 7, 11; W8 Tasks 5, 6; W9 Tasks 6, 13; W10 Tasks 6, 8; W11 Tasks 1, 6; W12
  Tasks 10, 11 (no notices rendered); W13 Tasks 10, 11; W14 Task 10; W15 Tasks 2, 7, 12; W16 Task
  15; W17 Task 3; W18 Task 6; W19 Task 14; W20 Tasks 4, 8, 15; W21 Task 4; W22 Task 8; W23 Task 8;
  W24 Task 8; W25 Task 9; W26 Task 8; W27 Task 9.
- Interfaces changed: `devices.watcher_id`; five new core tables; `DeviceBinding.watcherId`;
  `/api/device/me`'s `watcherId`; `resolveDeviceBinding`, `acceptDeviceJoinRequest` and
  `enrolDeviceForTest` take `watcherId`; `VenueServiceContribution.findOrderZones`; `PrinterRow` and
  the dashboard's `Printer` trade `ticketScope` for `watcherId`; `UpdatePrinterInput` loses
  `ticketScope`; `KitchenTicket`'s `order` variant becomes `watcher`; `routeKitchenTickets`,
  `ReprintPart` and `planKitchenTickets` lose `orderScopeAlsoAt`; `enqueueKitchenTickets` gains
  `watchers`; new `enqueueWatcherCopies` (with 3c-3's `rerouted` map); `watchers.runs_pass` (P4,
  the owner's Fire switch widened); `seedCatalogues` returns its `stationIds`; `printCorrectionSlips` gains a watcher rule; `SentWork`
  gains `zoneId`; 3c-3's `enqueueStationMoved` gains `toStationId`; `listExpoQueue` keeps its answer
  over a shared `readPassBoard`; the trigger refusal strings for the device binding.
- Codes: new `watcher.not_found`, `watcher.name_taken`, `printer.makes_and_watches`. Reused
  `management.request_invalid`, `station.not_found`, `zone.not_found`, `printer.not_found`,
  `device.station_required` (its description widened), `device.unauthorized`, `session.required`.
  No alert code is added (W23: the printer's `printer.jobs_waiting` covers a failed copy).
- Migrations: one generated core migration (tables and a column, measured) and one custom (two
  triggers, measured). No venue-service migration (the seat method reads an existing table).
- Size: fifteen tasks. If the plan is split, the cut is after the screen side — Tasks 1-3, 5-7 and
  10-14 as one plan (watchers on screens, with the storage and Prep Stations), and Tasks 4, 8 and 9
  as a second (watchers on paper), whose Task 15 sweep then runs in the second plan; the
  `watcher_printers` table is created by Task 2 either way.

## Review 1 applied (2026-10-01)

A fresh-context review (`plan-3d-review.md`: 4 Important, 9 Minor; it re-ran the binding trigger and
the partial name index on `node:sqlite` and found them as the plan says) and the coordinator's six
rulings were applied in place. **I1 / ruling 1:** a watcher's board never hides a section for being
away; Task 6 states there is no `away_at` condition and adds the Terrace-runner-after-Away case with a
proof by deletion; Task 10 keeps the pass's away filter on "All stations" only, shows "En route", and
adds the screen case; new Review Focus 13. **I2 / ruling 2:** the release's watcher copies are built
from the same made-here-free list `finishRelease` hands its station parts, named in Task 9, with a
made-here lager in the release case and a proof by deletion; new Review Focus 14 _(amended
2026-10-01, owner: no made-here record is ever held; see the note at the end)_. **I3 / ruling 3:**
P4 is now one switch, "Runs the pass" / "Lleva el pase" (column `runs_pass`, field `runsPass`),
flagged for the owner as a widening of W6's switch with the reason; W6 points at it; Tasks 2, 10, 13
and 14 follow it. **I4 / ruling 4:** only the shell's Expo drill (not `embedded`) shows the chooser;
the `expo` canvas card renders `embedded` (`card-grid.ts:283-288`) and stays "All stations" (P15),
with a test. **Ruling 5:** P7 kept. **Minors:** M1 P10 and Task 9 give a re-routed dish new to a
watcher a "From" copy with no FIRE header (W25 holds), through `enqueueWatcherCopies`' `rerouted`;
M2 the address key sits under `children["*"]` and every write clearing `till-station` clears
`till-watcher`; M3 the duplicated rule is called duplicated, with a backlog entry; M4 the code is
`printer.makes_and_watches { id }`, as `printer.not_found { id }` names a printer; M5 the form marks
all three groups required and adds the bottom-of-form line; M6 the move paths read zones only when a
watcher printer exists; M7 the till stubs are `as unknown as TillApi` casts, stated; M8
`seedCatalogues` returns its station ids and `seedWatchers` takes them; M9 the device route returns
the board unwrapped, Task 1's second case has a control, and Review Focus 5 is marked as pinning
behaviour that already holds. Line numbers touched were re-read on `main` at `107746610`.

## Review 2 applied (2026-10-01)

A narrow re-check of Review 1's corrections (`plan-3d-recheck.md`: 1 Important, 9 Minor and a nit)
and the coordinator's ruling were applied in place. **I-1:** a held made-here record is `queued`, so
3c-3's re-route and move could carry one onto paper; the 3c-3 plan is being amended in parallel (a
held made-here record is never re-routed, a move refuses it), and 3d now also drops made-here
records itself in `printCorrectionSlips`' watcher branch and in `planKitchenTickets`' watcher copies,
with Review Focus 14 widened to a made-here lager held at a station that closes, a move attempt, and
direct calls that hand the watcher code a made-here item. _(Amended 2026-10-01, owner, after
approval: no made-here record is ever held — see the note at the end; Review Focus 14's held-lager
cases are replaced by a made-here lager in a send that holds the rest.)_ **Minors:** M-1 no lever on a section
already away, and the sent-out label is "Sent out" / "Enviado" (`expo.sent_out`), so the Spanish no
longer reads "En camino" twice on one card; M-2 `#restoreDestination` (`till-app.ts:1347`) keeps
`till-watcher` for an `expo` destination and clears it otherwise, with reload and tab-change cases in
`till-app.test.ts`; M-3 the removed watcher's board is written in Task 6's shape; M-4 `<printable>`
points at the landed variable and names 3c-2's inserted extras; M-5 `rerouted` is listed among
`planKitchenTickets`' options; M-6 Task 1's second control changes `issueWhenFullyPaid`, not the
test; M-7 the move paths' cost is "a few cheap reads", and why no printer can appear in between;
M-8 decided: a sent-out dish neither colours its order nor counts as overdue, on the server's
`worstBand` and on the screen; M-9 the release case routes its lager to Downstairs bar explicitly.
Nit: the header says which line numbers were re-read at `107746610`.

## Review 3 applied (2026-10-01)

The last narrow re-check (`plan-3d-recheck2.md`: 1 Important, 5 Minor, 3 nits) and the coordinator's
rulings were applied in place. **I-1:** `#item` takes a watcher-board flag; only on a watcher's board
does a sent-out dish read "Sent out" and lose its lateness colour and "Forgotten" flag; "All stations"
keeps today's `#item`, with a screen case on each board. **Lateness:** now P19, flagged for the
owner — "on a watcher board, a sent-out dish no longer colours its order" — per dish, stated as
narrower than today's pass rather than "as today's"; W18 points at it; the screen case puts the old
sent-out dish and the fresh dish in the same section. The server's `worstBand` rule is KEPT and
TESTED, though the screen does not read the field, because the API still answers it. **Spanish
label:** "Despachado" ("Enviado" already means "sent to the kitchen" on the till). **M-5:** the
proof by deletion removes each of the two made-here filters in turn and names the cases each must
fail, with each case's watcher chosen so it would otherwise get the job. **Nits:** the header names
B24's two moved files and A156; `listExpoQueue` `:5405`, `cancelPlacedOrder` `:4663`, `markCollected`
`:4730`; the 3c-3 amendment is cited as its P13 and the move case asserts `ticket.made_here`; the
no-lever reason distinguishes the group verb (bumps the party's revision) from the course verb
(changes nothing).

## Amended 2026-10-01 (owner, after approval)

The owner corrected slice 3c-1 after this plan was approved: a made-here item is never held — it is
made at the moment it is sent, so `fireLines` records it fired and `ready` whatever would have held
it (3c-1's T12, and its "Amended 2026-10-01" note; 3c-1's Task 10 release-time filter is gone). This
plan's text that assumed a held made-here record is corrected: P10 now says the release list is
free of made-here records because none is ever held or released (releases read only records with no
fire time, `working-order.ts:1532`, `:1624`), not because of a 3c-1 filter; Task 9's `<printable>`
and its made-here defence bullet say the same; Review Focus 14 and Task 9's tests use a case that can
exist — a made-here lager sent from the bar till in a send that holds the rest of the order, on no
watcher copy at the send or at the later release, and refused on a move (3c-3's P13). 3d's own
made-here drops in `printCorrectionSlips`' watcher branch and `planKitchenTickets`' watcher copies
stay, as a defence that no current path needs, with their direct tests and proofs by deletion. The
earlier review notes are left as they were written, with a dated pointer here. Citations added here
were read on `main` at `e5ba24d55`.
