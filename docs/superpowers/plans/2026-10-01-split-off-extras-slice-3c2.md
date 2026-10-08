# Extras made at their own station, and tickets that name each other (slice 3c-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An extra whose own folder a station claims — chips in Extras › Sides, claimed by the Fryer —
is made at that station: it gets its own kitchen record there, held, fired, recalled, cancelled,
changed and split together with its dish. The dish's ticket and the extra's ticket name each other,
on paper and on screen ("with Chips from Fryer", "for Burger at Grill"). An extra nobody claims stays
on its dish's ticket as today ("+ Cheese").

**Architecture:** A picked extra is already its own `working_order_lines` row, linked to its dish by
`parent_line_id` (`packages/db/src/schema/orders.ts:169-170`). A split-off extra gets a
`ticket_items` row on that child row, at its own station; no new table (X1). Venue-service decides,
through a new seat method that loads the rules once and answers both dishes and extras
(`routingAt`; 3a's `resolveMakers` and a new `resolveExtraMakers` wrap it), whether each extra
follows its dish or is made somewhere else (X2–X6). `fireLines` stays the one place a station is
chosen and recorded: after it has decided each dish, it reads that dish's extras itself and inserts
a record for each that splits off, copying the dish's course and hold — except one whose station
the sending device makes here (3c-1's T12), which is made at the send, never held. One small helper
(`apps/server/src/dish-kitchen.ts`) answers "this dish's kitchen work: its own record plus its
split-off extras' records", and every release, recall, cancel, edit, split and group path uses it.
Printing (`buildTicketItems`) and the kitchen screens (`readQueueSubItems`) leave a split-off extra
out of its dish's "+" lines and print or show the two cross-references instead.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`, Lit web
components (till and venue-service dashboard; their suites run in real headless Chromium), Vitest.

**Branch:** `feat/split-off-extras`, in a worktree made with `python3 ~/workspace/tools/worktree.py new
waitron feat/split-off-extras --headless`. This plan is committed as
`docs/superpowers/plans/2026-10-01-split-off-extras-slice-3c2.md` (decisions sheet, Structure).

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§5.8 (extras) whole, the first bullet of §5.10 (a dish and its split-off extras mention each other),
and §5.12's "the extras chosen" in the tester. The owner split slice 3 into four plans on
2026-10-01, and 3c into three; this is 3c-2. The shared decisions sheet settled X1–X14.
**Not in this plan:** "Show the rest of the order" and "Made here, no ticket" (3c-1); "Make at…" on
any dish, moving a dish after it is sent, and re-routing a held dish at release (3c-3); watchers and
the whole-order printer's future (3d); bundles (design §8: their parts will mention each other the
way a dish and its split-off extras do, which this plan's cross-reference shape should allow, but
nothing here builds them). "Made at" on the products screen and the routing preview stay about dishes
(X9).

**Builds after slices 3a and 3b** (`docs/superpowers/plans/2026-10-01-prep-station-rules-slice-3a.md`,
`docs/superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md`). Neither is on `main` when
this plan is written; start this branch from a `main` that holds both. 3b rewrites `fireLines` (one
clock reading as its first statement, `make_at_station_id` read by line id, `keepStations`, and the
`MakerOutcome` it maps); this plan rewrites it again. **Where this plan says "3a's X" or "3b's X",
read X in the code, not in the plans: the code is what landed.** Line numbers cited for
`apps/server/src/working-order.ts` (below, `WO`) and `apps/server/src/order-groups.ts` are today's
`main` (`ebaa1f6c5`), before 3a and 3b; re-find each by its function name. PR #974 (ticket text as
pictures) is merged: `kitchen-ticket.ts` and `kitchen-print.ts` citations are today's, after #974.

**Slice 2 may land before this branch starts** (`docs/superpowers/plans/2026-09-30-menus-include-menus-slice-2.md`,
queued for lane E; backlog `:207-209`). It drops per-menu extras: an offer's extras become the
product's own extras lists. Build every test fixture's extras the way `main` stores them when this
branch starts — through whatever `addExtras` (`apps/server/src/kitchen-print.test.ts:311`) does on
that `main` — never through a shape slice 2 has removed. Nothing in this plan reads where an extras
list lives: it reads the extra LINES an order already has.

**3c-1 may land before or after this branch** (decisions sheet, Structure). Where the two meet:
- If `main` holds 3c-1 when this branch starts (`grep -n made_here packages/db/src/schema/ticket-items.ts`
  prints a line), Task 3 applies 3c-1's made-here check to each split-off extra's final station (X13)
  and pins it with a test. If it does not, whichever of the two lands second adds that check and
  test on its rebase.
- 3c-1's readers that leave a made-here record out (printing, queues, signals) are untouched by this
  plan except where both edit the same function; a rebase merges the two filters.
- 3c-1's "Also on this order" block will list a split-off extra at another station like any other
  item. That repeats what the cross-reference says; both are true, and nothing here changes it.

## Decisions for the owner (X1–X14)

Settled on 2026-10-01 in the shared decisions sheet; approving the plan approves this wording of
them.

- **X1. A split-off extra gets its own kitchen record, on its own extra line, at its own station.**
  The link to its dish is the line link that already exists. No new table. About 45 places assume
  that only dishes have kitchen records (the research's list A.4); each is handled by a task below
  or marked unaffected with its reason (table at the end of File structure).
- **X2. Which rule decides.** The full rule runs for the extra — exceptions first, then claims — and
  "nothing matched, so the default station" means "follows its dish". The extra splits off only when
  its answer is a different station from the one its dish is going to. So an extra never falls
  through to the default station on its own.
- **X3. An extra in a folder claimed by "No preparation"** (a sachet of sauce) follows its dish and
  stays on the dish's ticket as "+ Sauce", so whoever plates the dish adds it.
- **X4. An extra whose own station is closed:** its station's fallbacks apply first; if none is open,
  it follows its dish, silently. The till never asks about an extra, and a send is never refused
  because of one; 3b's dead-end question stays about dishes.
- **X5. A dish that needs no preparation, with a claimed extra:** the extra gets its own ticket ("for
  the Water, no preparation") and the dish none. An unclaimed extra on such a dish gets nothing.
- **X6. A dish the waiter sent somewhere by hand (3b's Make at):** extras that split off still split
  by their own rule; extras that follow the dish go wherever the dish goes.
- **X7. Held and fired together:** a split-off extra copies its dish's course, group and hold. Firing
  the course or the group fires it; Ready and Away on the course or the group cover it. **One
  exception (owner, 2026-10-01, after approval; 3c-1's T12):** a split-off extra whose final station
  the sending device makes here is never held — it is recorded made here, fired and ready at the
  send, even when its dish is held, and it joins 3c-1's "Make now" list (T13) like any made-here
  item. It still copies its dish's course and group, so the bill and the screens keep it with its
  dish.
- **X8. Whatever happens to the dish happens to the extra's record, with a slip at the extra's own
  station:** cancelling the dish voids the extra there; recalling the dish recalls it; splitting the
  dish splits it; an edit that re-sends the dish re-sends it. **Cancelling only the extra** prints a
  VOID at the extra's station and today's "EXTRA CANCELLED" slip at the dish's station (each station
  hears about its own work).
- **X9. The Prep Stations tester gains "the extras chosen":** each says "follows the dish" or "made at
  Fryer, because Fryer claims Extras › Sides". "Made at" on the products screen stays the dish's
  answer; the routing preview stays about dishes.
- **X10. Wording.** On the dish: "with Chips from Fryer". On the extra: "for Burger at Grill" ("for
  Burger, no preparation" when the dish has no station). Kitchen names. The extra's per-dish count
  appears as on its "+" line today ("Chips x2"). Printed words follow the till's language (Spanish,
  else English); screen words follow the screen's language.
- **X11. Cross-references appear everywhere**, the whole-order "PASE" copy included (redundant there,
  harmless). A reprint shows the order as it stands now. The new item field joins the key that
  decides which ticket lines merge, or two burgers with chips at different stations would print as
  one line.
- **X12. Allergens stay with the plate:** on a kitchen screen the dish's cross-reference line keeps
  the extra's allergen and diet marks, as its "+" line has them today, and the extra's own record
  shows its own.
- **X13. With 3c-1's "made here":** an extra whose final station is made here gets no ticket (3c-1's
  born-ready record); the dish's ticket still says "with Chips from Bar". Like any made-here item it
  is never held (3c-1's T12, owner 2026-10-01, after approval): it is made at the send even when its
  dish is held, and it appears in 3c-1's "Make now" list (T13). **Release routes carry no device**
  (the course verbs, `apps/server/src/till-api.ts:783`, `/groups/:gid/fire`, `:1826`, and send-lines,
  `:2063`, all pass `deps.cfg`), so an extra first decided at a release — one an edit added to a held
  no-preparation dish (Task 4's `finishRelease` call) — is never made here: it gets its station's
  ticket, in line with 3c-1's T8 (no device, no "here"). It is the one case where an extra the
  sending device makes waits for its dish and then prints.
- **X14. Readers that must show the extra once:** the station queue, the pass (expo) screen, printing
  and every slip leave a split-off extra out of its dish's "+" lines and show the cross-reference
  instead. So does 3c-1's "Make now" list (`readMadeHereItems`, `apps/server/src/made-here.ts`, whose
  `extras` are built with `extraLabel` over the dish's children): it leaves out a split-off extra of
  a made-here dish, so it never lists "+ Chips" the Fryer makes (amended 2026-10-01; a split-off extra
  that is itself made here is listed as its own item). Whichever of 3c-1 and this plan lands second
  applies it, with a test: a made-here dish with chips split off to Fryer lists no chips. The bill's
  line read (`readTabLines`) stops being able to promise that an extra line never carries a kitchen
  state; the till and that promise are fixed together (Task 11).

**Further defaults this plan takes (P1–P7).** Not discussed with the owner; approving the plan
approves them.

- **P1. One routing snapshot per send, release or edit, answering dishes and extras.** A new seat
  method, `routingAt(tx, cfg, at)`, reads the venue's moment and loads the rules ONCE and hands back a
  resolver with two questions: where each dish is made (3b's `MakerOutcome`) and whether each extra
  is made elsewhere (`ExtraMakerOutcome`). 3a/3b's `resolveMakers` and the new `resolveExtraMakers`
  become one-line wrappers over it, so their other callers (3b's `findDeadEnds`, 3a Task 13's
  demo-seed test) are unchanged; 3a's preview (`previewRoutingChange`) and products column
  (`describeMakers`) call `chooseMaker` directly and are untouched. `fireLines` (and `placeGroups`,
  which calls it once per group), the release paths and the edit path each open one
  resolver, at their one clock reading, and pass it along — so a dish and its extras are decided
  against the same rules at the same instant, and no step loads the rules twice (review 2, I4: a
  second load is not free — the send runs inside `withTransaction`, which is the venue's write lock,
  `packages/db/src/tenancy.ts:19-35`, so every extra read holds up the next queued sale). The
  extra's comparison with its dish's station stays inside venue-service, beside the rule; core only
  supplies where the dish is finally going (3b's make-at and kept station are core's).
- **P2. A started extra stops what would stop a started dish.** Recalling a dish, or changing or
  removing it through an edit, is refused `ticket.already_started` (the existing code, naming the
  extra's record) while any of its split-off extras has been started, exactly as a started dish
  refuses it today. A cancel (an adjustment) still goes through and marks the VOID as started.
- **P3. 3b's "keep the station" on an edit (`keepStations`, S18) is not extended to extras.** An extra
  is never refused (X4), so an edit that re-sends a dish decides its extras afresh; if the Fryer has
  closed with no replacement since, the re-sent chips follow the dish.
- **P4. On paper a cross-reference prints as an indented `> ` line** after the dish's "+" lines and
  before its note: `  > with CHIPS from Fryer`, `  > for BURG at Grill`. "+" already means "add this
  to the plate", which a cross-reference must not look like.
- **P5. The tester's extras picker lists every product**, not only the chosen dish's extras lists:
  extras are products, and the Prep Stations client already reads the product list (3a Task 7).
- **P6. The till's "Current orders" view keeps showing a dish's own kitchen progress only**; a
  split-off extra's own progress shows on the station and pass screens. A backlog entry records it.
- **P7. One new index**, `working_order_lines_parent_idx` on `working_order_lines(parent_line_id)`
  (Task 2): every new "this dish's extras" read, and two existing ones on the 15-second kitchen-screen
  poll path, look lines up by their dish, and no index covers that column today (read, not run:
  `packages/db/src/schema/orders.ts:190-229` declares indexes on `group_id` and `working_order_id`
  only). Measured 2026-10-01 on the SQL drizzle emits (receipt in Task 2): without it all three
  reads scan `working_order_lines`; with it all three search it by the index.

## Global Constraints

- Every commit: `git commit -s`, message in plain English (owner rule; name files and codes once as
  pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or an ignore
  comment. Mutation-tested packages touched: `db` (Task 2's index only; `ls packages/*/stryker.config.json`
  lists `db`, `fiscal`, `shared`, `ui`, `ui-core`). A thinned test there reddens the weekly mutation
  run.
- Every colour, spacing, radius and font reads a `--wt-*` token.
- Every new string in English AND Spanish: till strings in `apps/till/src/i18n/strings.ts` (English
  `station.*` from `:104`, Spanish from `:908`; `{name}`-style placeholders are filled at
  the call site, `t()` does not interpolate, `:65`), venue-service strings in
  `packages/venue-service/src/dashboard/strings.ts`. Printed words live in
  `apps/server/src/kitchen-ticket.ts` beside `EXTRA_CANCELLED_WORDS` (`:227-236`).
- A kitchen surface reads a line's kitchen name through `kitchenPresentationName`
  (`packages/catalogue/src/product-presentation.ts:90-95`). Every fixture product in this plan's
  tests carries three DIFFERENT names (staff, customer, kitchen), so a surface reading the wrong one
  fails (CLAUDE.md §3).
- No new error code. Reused: `ticket.already_started { ticketItemId }` (`apps/server/src/errors.ts:625`),
  `route.subject_not_found` (3a). Before committing anything that throws, `grep -n '"ticket\.' apps/server/src/errors.ts`.
- Migrations: one, generated, Task 2 — expected to be a single `CREATE INDEX`. Never edit a shipped
  migration file. READ the generated SQL: an `__new_<table>` rebuild is a STOP (CLAUDE.md §3), and
  this plan's landing rule then becomes needs-owner-review. The number in this plan is illustrative:
  3b (`line_make_at_station`) and 3c-1 (an index on `ticket_items`) add core migrations too, and a
  number collision on rebase is fixed by resetting `packages/db/drizzle` to `main`'s state and
  regenerating — never by hand-editing the snapshots or `_journal.json` — then re-running
  `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/migrations-match-schema.test.ts` and
  `inmutabilidad` (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`)
  — the five CLAUDE.md §3 names — plus `scripts/migration-upgrade.test.ts`.
- The one fire point stays `fireLines`. A station is chosen and recorded when the work is sent; a rule
  change alone never moves work already sent (3a and 3b Global Constraints). _2026-10-01:
  [slice 3c-3](2026-10-01-moving-dishes-slice-3c3.md) lets a waiter move a sent dish and checks held
  work against the current rules when its station is not open at release, while preserving a
  hand-chosen station that remains switched on._
- Module boundary: core reaches venue-service only through `VENUE_SERVICE` (`apps/server/src/modules.ts`,
  contract `packages/module/src/module.ts`). The venue-service dashboard imports only TYPES from
  `../routing.js`.
- Tests that need a database use the real one (`useVenueDb`), set up as `apps/server/src/kitchen-print.test.ts:78`
  does. A refused write asserts the domain code, never just `Error`.
- Browser suites (`apps/till`, `packages/venue-service`'s browser project): check
  `memory_pressure | grep free` and the heaviest processes first; never beside a backgrounded
  whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

The inputs likeliest to hurt a venue, each pinned by a test in the task named:

1. **Burger with chips, Fryer claims Extras › Sides.** The burger's record is at the Grill, the chips'
   at the Fryer, each at its own quantity. The Grill ticket reads `1 x BURG` / `  > with CHIPS from
   Fryer`, with no `+ Chips`; the Fryer ticket reads `1 x CHIPS` / `  > for BURG at Grill`. The
   kitchen screens say the same, and the Grill's line keeps the chips' allergens. (Tasks 3, 9, 10)
2. **Extra cheese in an unclaimed folder** gets no record and stays `+ Cheese` on the burger's ticket
   — including when the default station is switched off (it never "falls through"). (Tasks 1, 3, 10)
3. **A held course with a split-off extra, fired by course and by group.** Until fired, the chips'
   record is held at the Fryer with the burger's course and group; firing the course, and firing the
   group, each release it, and the Fryer prints the FIRE ticket. (Task 4)
4. **Cancelling the dish voids the extra at the Fryer.** A VOID slip and a `void` notice at the Fryer
   as well as at the Grill, for the whole or the cancelled part; the chips' record goes with its
   line. (Task 5)
5. **Cancelling only the chips:** one VOID at the Fryer and today's EXTRA CANCELLED slip at the Grill;
   nothing else prints. (Task 5)
6. **A group reads ready only when its extra is ready too.** Burger bumped ready at the Grill, chips
   still frying: the group is not ready. The pass's group Ready bumps both. (Task 8)
7. **Two burgers whose chips go to different stations are not merged on paper.** A reprint of an
   order whose first burger's chips went to the Fryer and second's to the Fryer's fallback prints
   two Grill lines, not `2 x BURG / with CHIPS from Fryer`. (Task 10)
8. **The Fryer closed with no replacement:** the chips follow the burger (`+ Chips` on the Grill
   ticket) and the send is not refused. (Tasks 1, 3)
9. **A dish with no record of its own whose extra has one** — a Water (no preparation) with chips at
   the Fryer (X5). Every path that acts on a dish must act on the chips' record and never assume the
   dish has one: sending, including a send in which no dish gets a record (Task 3); release by course,
   by group and by a named send, and chips added to a course-held Water decided when it is released
   (Task 4); serving refused while the chips are held (Task 4); changing its course refused once the
   chips have fired (Task 4); recall and cancel (Task 5); an edit's change, drop, raise and removal,
   with no error (Task 6); a split and a whole move off the bill (Task 7); a move between held groups
   and a group join (Task 8); the screens and paper ("for AGUA, no preparation", Tasks 9 and 10); the
   till's cancel and "kitchen told" (Task 11).

---

## File structure

**Created**

- `apps/server/src/dish-kitchen.ts` + `dish-kitchen.test.ts` — `dishKitchenItems`,
  `onDishesOrTheirExtras`.
- `apps/server/src/testing/split-extras-venue.ts` — the shared fixture (Task 3).
- `apps/server/src/split-off-extras.send.test.ts`, `.release.test.ts`, `.cancel.test.ts`,
  `.edit.test.ts`, `.split.test.ts`, `.groups.test.ts`, `.queue.test.ts`.
- `packages/db/drizzle/00NN_line_parent_index.sql` (generated).

**Modified (main ones)** — each task lists its own exactly.

- `packages/module/src/module.ts` (the seat), `packages/venue-service/src/{routing,routing-store,
  service,routes}.ts`, `dashboard/{prep-stations-screen,routing-client,strings}.ts`
- `packages/db/src/schema/orders.ts` (the index)
- `apps/server/src/{working-order,order-groups,kitchen-print,kitchen-ticket,table-signals}.ts`
- `apps/till/src/{api/client.ts,widgets/station-queue.ts,screens/till-expo-screen.ts,
  state/adjust-target.ts,screens/till-table-order-screen.ts,i18n/strings.ts}`
- `docs/backlog.md`, `docs/developers/products.md`, the design spec.

**Every reader in the research's list A.4, and what happens to it.** `WO` is
`apps/server/src/working-order.ts`; line numbers are today's `main`.

| Reader | Handled by |
| --- | --- |
| `fireLines` (`WO:1142-1343`; drops children at `:1153-1157`) | Task 3 |
| Callers' inputs (`unsentDishLines` `WO:1115-1129`, `insertTabRound`, `sendToPrep`, `addTabRound`) | Unaffected: `fireLines` reads each dish's extras itself (Task 3), as 3b made it read `make_at_station_id` |
| Course rows in `fireLines` (`WO:1243-1257`) | Unaffected: a split-off extra's record carries its dish's course (Task 3), so counting it changes no course's state |
| `stampSent` (`WO:1352-1378`) | Unaffected: it already stamps a dish's extras with the dish (`:1365-1368`) |
| `heldNoRouteLines` (`WO:1386-1425`) | The function is unaffected: an extra that follows a no-preparation dish has no record and is stamped sent with its dish by `stampSent`; one that splits off has a record and is released by the record paths (Task 4). (The research rated this "breaks"; `stampSent`'s `or(... parentLineId ...)` at `:1365-1368` is why it does not — read, not run.) What it hands on changes: `finishRelease` decides the released no-preparation dishes' undecided extras (Task 4) |
| `finishRelease` (`WO:1552-1567`) | Task 4: it decides and prints the extras of the no-preparation dishes a release stamps sent |
| `fireCourse` (`WO:1473-1486`) | Task 4 (test only: it releases by the record's course, which the extra copies) |
| `fireOrderLines` (`WO:1492-1507`), and through it `releaseGroup` (`order-groups.ts:420-452`) | Task 4 |
| `sendLines` (`WO:1573-1649`) | Task 4 |
| `releasedCourses` (`WO:1652-1665`) | Unaffected: course copied |
| `recallLines` (`WO:1678-1743`) | Task 5 |
| `bumpCourseReady` / `markCourseAway` (`WO:1749-1792`) | Unaffected, course copied; Task 4 pins it |
| `setLineCourse` (`WO:2163-2192`) | Task 4 |
| `advanceTicketItem` / `advanceTicket` (`WO:4783-4841`) | Unaffected: an extra is bumped at its own station like any record |
| `placeOrder` / `sendToPrep` | Unaffected: through `fireLines`. A held no-preparation dish can reach `fireLines` a second time through `unsentDishLines`; Task 3 then releases its extras' held records with it when it fires |
| `markCollected` (`WO:4697-4730`) | Unaffected: it needs any record on the order (`:4717-4724`), so a counter order whose only kitchen work is a split-off extra becomes collectable, which is right |
| `removeFromLine` (`WO:1939-2010`) | Task 5 |
| `tellKitchenOfCancelledExtra` (`WO:2017-2039`) + `readCancelledExtra` (`kitchen-print.ts:616-657`) | Task 5: unchanged code — it already reads the DISH's record and prints at the dish's station, which X8 keeps; the extra's own VOID comes from its own record through `removeFromLine`'s existing `voided` path |
| `rescaleExtras` / `reduceLine` (`WO:2083-2135`) | Task 5 |
| `servableLines` / `isReleased` / `writeServed` (`WO:2213-2337`) | Task 4: a dish with a held split-off extra record is not released work, even when the dish has no record of its own (X5). `isReleased` keeps its shape; `writeServed` is unaffected (serving a dish serves its extras, `:2328-2335`) |
| `readEditableOrder` (`WO:3658-3751`) | Unaffected: it already joins a record onto every line, extras included (`:3690`); `applyLineEdits` reads `parent.children[i].ticket` (Task 6) |
| `applyLineEdits` (`WO:3802-4257`), `planHeldCorrections` (`WO:4266-4304`) | Task 6 |
| `moveOrderLines` (`WO:2525-2601`) | Unaffected: it moves the records of every moved line, extras included (`:2589-2599`) |
| `readTabLines` (`WO:2663-2733`) and the till | Task 11 |
| `carveOffLines` / `splitTicketItem` (`WO:2795-3047`, `:3115-3139`) | Task 7 |
| `apps/server/src/adjustments-apply.ts` (cancel `:796-803`; comp/discount carve `:717-763`) | Cancel through Task 5; carve through Task 7 |
| `apps/server/src/move-bill.ts` `leaveParty` (`:355-382`) | Unaffected: works on dishes and `clearGroups` takes their extras with them |
| `listStationQueue` + `readQueueSubItems` (`WO:5034-5160`, `:4922-4994`) | Task 9 |
| `listExpoQueue` (`WO:5232-5428`) | Task 9 (cross-references); its course and group roll-ups are right once Task 8's group Ready/Away cover extras |
| `listTablesWithState` (`WO:5517`) | Unaffected: a split-off extra is a separate thing to fetch from its own station, so its record counting once in "N ready" and in the waiting band is true; serving the dish serves it |
| `readKitchenLines` (`apps/server/src/table-signals.ts:34-71`) | Task 8 (an extra counts its dish's plates, not its own units) |
| `dishLinesOf`, `bumpGroupReady`, `markGroupAway` (`order-groups.ts:272-346`) | Task 8 |
| `fireHeldGroupsOfCourse` (`order-groups.ts:354-390`) | Unaffected: it finds groups by the dish's course and releases them through `releaseGroup` → `fireOrderLines` (Task 4) |
| `readGroups` (`order-groups.ts:802-877`) | Task 8 (test only: its counts already include every record of the group's lines, `:832-843`) |
| `readCurrentOrders` (`order-groups.ts:1054-1167`) | Its `released` (`:1149`) takes Task 4's held-extra check, so the till never offers a Serve the server refuses; the extra's own kitchen progress is not shown (P6; backlog entry, Task 13) |
| `printHoldTickets` (`order-groups.ts:1175-1209`) | Selection unaffected (it reads the group's held records, extras' included); the double print is fixed in `buildTicketItems` (Task 10) |
| `heldItemsOf` / `moveLinesToGroup` / `correctJoin` (`order-groups.ts:583-715`, `:1268-1308`) | Task 8 |
| `groupArrivingDishes` (`order-groups.ts:1400-1454`) | Unaffected: an extra line takes its dish's group (`:1475-1478`), and records follow lines. It sorts dishes by `isReleased` on the dish's own record or sent stamp (`:1434`); a no-preparation dish whose split-off extra is held is unsent or held by its course, so it sorts as held either way, except after a recall of the dish, which the till does not offer (Recall needs the line's own fired record, `till-table-order-screen.ts:1686-1692`) |
| `packages/reporting/src/overdue-orders.ts` | Unaffected: an extra's record ages until its dish is served, which serves it |
| 3b's `stationsWithWaitingDishes` / `stationScreensDark` | Unaffected, and wanted: a split-off extra waiting at the Fryer is a dish waiting there |
| `apps/server/src/device-api.ts` (device advance checks the record's station) | Unaffected |
| `apps/dashboard/src/api/live-queries.ts` | Unaffected: no new table |
| `packages/venue-service/src/kitchen-notices.ts` (copies any line's names) | Unaffected |
| Printing: `buildTicketItems`, `readReprintParts`, `printCorrectionSlips` (`kitchen-print.ts:139-221`, `:975-1028`, `:701-755`) | Task 10 |
| 3b's dead-end question (`findDeadEnds`) | Unaffected by X4 |
| 3b's `make_at_station_id` | Task 3 (X6) |
| 3b's `keepStations` | Unaffected by P3 |

---

### Task 1: The extra rule, and the seat that answers it

**Files:**
- Modify: `packages/venue-service/src/routing.ts` (3a; 3b gave it moments and fallbacks) and
  `routing.test.ts`
- Modify: `packages/module/src/module.ts` — beside 3b's `MakerOutcome` and 3a's `resolveMakers`
  (today's `VenueServiceContribution` starts at `:286`): `ExtraMakerOutcome`, `MakerResolver`,
  `routingAt`, `resolveExtraMakers`
- Modify: `packages/venue-service/src/routing-store.ts` (3a) and `routing-store.test.ts`;
  `packages/venue-service/src/service.ts` (wire it, as `resolveMakers` is wired; today's object is
  `:32-56`)

**Interfaces:**

```ts
// packages/module/src/module.ts
/** Where an extra pick is made, given where its dish is going. */
export type ExtraMakerOutcome =
  | { readonly kind: "made"; readonly stationId: string }
  | {
      readonly kind: "follows_dish";
      /** no_rule: no exception or claim covers it (X2); no_preparation: what covers it needs no
       *  preparation (X3); no_replacement: its station and every fallback are closed (X4);
       *  same_station: it is made where its dish is. */
      readonly why: "no_rule" | "no_preparation" | "no_replacement" | "same_station";
    };

/** The routing rules and the venue's moment at `at`, loaded once: both questions answer from that
 *  one snapshot, on the transaction it was opened on, and never read the rules again. Use it only
 *  inside that transaction. */
export interface MakerResolver {
  readonly at: Date;
  /** As 3b's `resolveMakers` answers, for an order in `zoneId` (null: no service zone). An unknown
   *  zone throws `service_zone.not_found` before any product error, as 3a's `resolveMakers` does —
   *  `routingAt` takes no zone, so the check lives in each question. */
  makers(zoneId: string | null, productIds: readonly string[]): Promise<ReadonlyMap<string, MakerOutcome>>;
  /** For each extra pick, whether it is made somewhere other than its dish. `dishStationId` is
   *  where its dish is finally going, null when the dish needs no preparation. Keys are the caller's
   *  `key`. An unknown zone throws `service_zone.not_found` and an unknown product
   *  `route.subject_not_found`, as `makers` does. An empty list answers an empty map without
   *  reading anything. */
  extraMakers(
    zoneId: string | null,
    extras: readonly { key: string; productId: string; dishStationId: string | null }[],
  ): Promise<ReadonlyMap<string, ExtraMakerOutcome>>;
}

// VenueServiceContribution GAINS:
/** One `venueMoment` and one rules load, at `at`. Each question then reads only its products'
 *  facts (one read by id). */
routingAt(tx: Transaction, cfg: { locationId: LocationId }, at: Date): Promise<MakerResolver>;
/** `(await routingAt(tx, cfg, at)).extraMakers(zoneId, extras)`. */
resolveExtraMakers(
  tx: Transaction,
  cfg: { locationId: LocationId },
  zoneId: string | null,
  extras: readonly { key: string; productId: string; dishStationId: string | null }[],
  at: Date,
): Promise<ReadonlyMap<string, ExtraMakerOutcome>>;
// 3b's resolveMakers(tx, cfg, zoneId, productIds, at) KEEPS its signature and becomes
// `(await routingAt(tx, cfg, at)).makers(zoneId, productIds)`.
```

**The routing snapshot — the stable contract other plans cite (3c-3 reuses it at release).** Its
name and shape are fixed by this plan:
- the seat method `VENUE_SERVICE.routingAt(tx: Transaction, cfg: { locationId: LocationId }, at:
  Date): Promise<MakerResolver>`, with `MakerResolver = { readonly at: Date; makers(zoneId,
  productIds); extraMakers(zoneId, extras) }` exactly as declared above (`packages/module/src/module.ts`);
- core's lazy opener `routingOnce(tx, cfg, at): RoutingOnce` in `apps/server/src/working-order.ts`,
  `RoutingOnce = (() => Promise<MakerResolver>) & { readonly at: Date }` (Task 3), opened on first
  need and at most once;
- `fireLines`' option `routing?: RoutingOnce` (Task 3), and the optional last parameter `routing` of
  `releaseGroup`, `fireOrderLines` and `releaseHeld` (Task 4).
One snapshot is one clock reading and one rules load, used only inside the transaction that opened
it. A later plan that needs routing on a send, release or edit takes the caller's `RoutingOnce`, or
opens one with `routingOnce` — never a second `routingAt` in the same step.

```ts
// packages/venue-service/src/routing.ts (re-exported from index.ts)
export interface ExtraChoice {
  readonly outcome: ExtraMakerOutcome;
  readonly decidedBy: RoutingDecision | null; // as chooseMaker answered for the extra
  readonly fallbacks: readonly FallbackStep[]; // as chooseMaker answered for the extra
}

export function chooseExtraMaker(
  rules: RoutingRules,
  extra: ProductFacts,
  zoneId: string | null,
  moment: RoutingMoment | null,
  dishStationId: string | null,
): ExtraChoice;
```

**Behaviour** (`chooseExtraMaker` is `chooseMaker` plus one comparison; the tests pin each):
- `choice = chooseMaker(rules, extra, zoneId, moment)`.
- `decidedBy` null or `{ kind: "default" }` → `follows_dish / no_rule` (X2: the default never takes
  an extra on its own — whether or not a default station is switched on).
- `route` is `no_preparation` → `follows_dish / no_preparation` (X3).
- `route` null with `noReplacement` → `follows_dish / no_replacement` (X4).
- `route.stationId === dishStationId` → `follows_dish / same_station`.
- otherwise `made` at `route.stationId` — including when `dishStationId` is null (X5).

`routingAt` in `routing-store.ts` does 3b's `resolveMakers`' loading once — one `venueMoment`, one
`loadRoutingRules` with its business day — and keeps the rules and the moment in the resolver it
returns. `makers` is 3b's `resolveMakers` body after that loading (its product-facts read, its
spelling handling, `chooseMaker` per product, the `MakerOutcome` mapping), moved; `extraMakers`
reads its products' facts the same way and runs `chooseExtraMaker` per extra. `resolveMakers` and
`resolveExtraMakers` become the one-line wrappers above. The resolver holds no cache beyond the
snapshot it was opened with, and no caller keeps it past its transaction.

- [ ] **Step 1: Write the failing tests.** In `routing.test.ts`, beside 3b's cases, give 3a's
  `parentOf` an `extras` folder with `sides`, `toppings` and `sauces` under it, stations `grill` and
  `fryer`, and `claims` `sides → fryer`, `sauces → no_preparation`:

```ts
const chips = { productId: "chips", routedProductId: "chips", categoryId: "sides" };
const cheese = { productId: "cheese", routedProductId: "cheese", categoryId: "toppings" };
const sauce = { productId: "sauce", routedProductId: "sauce", categoryId: "sauces" };

describe("chooseExtraMaker", () => {
  it("splits an extra off when its folder's claim names a station other than its dish's", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, "grill")).toEqual({
      outcome: { kind: "made", stationId: "fryer" },
      decidedBy: { kind: "claim", categoryId: "sides" },
      fallbacks: [],
    });
  });

  it("keeps an unclaimed extra with its dish, never the default, even with no default on", () => {
    expect(chooseExtraMaker(extrasRules, cheese, null, null, "grill").outcome)
      .toEqual({ kind: "follows_dish", why: "no_rule" });
    expect(chooseExtraMaker({ ...extrasRules, defaultStationId: null }, cheese, null, null, "grill").outcome)
      .toEqual({ kind: "follows_dish", why: "no_rule" });
  });

  it("keeps a no-preparation extra with its dish", () => {
    expect(chooseExtraMaker(extrasRules, sauce, null, null, "grill").outcome)
      .toEqual({ kind: "follows_dish", why: "no_preparation" });
  });

  it("keeps an extra with its dish when both are made at one station", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, "fryer").outcome)
      .toEqual({ kind: "follows_dish", why: "same_station" });
  });

  it("lets an exception decide for an extra as for a dish", () => {
    // Everything from the terrace goes to the terrace kitchen: the chips land with the burger.
    const rules = { ...extrasRules, exceptions: [{ id: "t", position: 1, zoneId: "terrace", categoryId: null, productId: null, target: station("terraceKitchen") }] };
    expect(chooseExtraMaker(rules, chips, "terrace", null, "terraceKitchen").outcome)
      .toEqual({ kind: "follows_dish", why: "same_station" });
  });

  it("walks the extra's fallbacks first, and follows the dish when none is open", () => {
    const closedWithFallback = { ...extrasRules, timing: new Map([["fryer", { fallbackId: "kitchen", hours: [], today: "closed" as const }]]) };
    expect(chooseExtraMaker(closedWithFallback, chips, null, at(FRI, "20:00"), "grill").outcome)
      .toEqual({ kind: "made", stationId: "kitchen" });
    const deadEnd = { ...extrasRules, timing: new Map([["fryer", { fallbackId: null, hours: [], today: "closed" as const }]]) };
    expect(chooseExtraMaker(deadEnd, chips, null, at(FRI, "20:00"), "grill")).toEqual({
      outcome: { kind: "follows_dish", why: "no_replacement" },
      decidedBy: { kind: "claim", categoryId: "sides" },
      fallbacks: [{ stationId: "fryer", why: "closed_by_hand" }],
    });
  });

  it("splits a claimed extra off a dish that needs no preparation", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, null).outcome)
      .toEqual({ kind: "made", stationId: "fryer" });
  });
});
```

  (Name the fixtures and the `at`/`FRI` helpers as 3b's tests in the file name them; add `kitchen`,
  `terraceKitchen`, `grill`, `fryer` to `activeStationIds`.) In `routing-store.test.ts`, with 3a's
  setup: claim an Extras › Sides folder for Fryer; `resolveExtraMakers(tx, cfg, null, [{ key: "a",
  productId: chips, dishStationId: grill }, { key: "b", productId: cheese, dishStationId: grill }],
  fixedInstant)` answers `made` at Fryer for `a` and `follows_dish / no_rule` for `b`; an unknown
  product is refused `route.subject_not_found`; an empty list answers an empty map; Fryer closed by
  hand with no fallback (3b's `setStationToday`) answers `follows_dish / no_replacement`. And for
  the resolver:
  - one resolver's `makers` and `extraMakers` answer exactly what the two wrappers answer for the
    same inputs and instant (`toEqual` on the whole maps);
  - both questions refuse an unknown zone with `service_zone.not_found` (review 3, Minor 2; 3b's kept
    `resolveMakers` case pins `makers` through the wrapper, this case pins `extraMakers`);
  - **it loads once, at opening:** open `routingAt`, THEN move the Extras › Sides claim from Fryer to
    Grill (3a's `setClaim`), then ask `extraMakers` for the chips with the dish at Grill: it still
    answers `made` at Fryer, and `makers` for a chips-as-a-dish product still answers Fryer — the
    snapshot. A fresh `routingAt` answers by the new claim. (Fails if either question reloads the
    rules.) 3b's existing `resolveMakers` cases keep passing unchanged, which pins the wrapper.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing.test.ts src/routing-store.test.ts`.
  Expected: FAIL — `chooseExtraMaker`, `routingAt` and `resolveExtraMakers` do not exist.
- [ ] **Step 3: Implement** the types, the pure function, `routingAt` (moving 3b's `resolveMakers`
  body into it), the two wrappers and the wiring in `service.ts`.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @waitron/venue-service typecheck` and
  `pnpm --filter @waitron/server typecheck` (the seat's type changed). Expected: PASS. Read
  `routing.ts`'s row in `pnpm --filter @waitron/venue-service exec vitest run --project node --coverage src/routing.test.ts`:
  100% lines and branches (the run exits non-zero because only one file ran; the row is the
  evidence).
- [ ] **Step 5: Commit** — `git commit -s -m "Prep stations rule: an extra is made at its own station only when an exception or a claim names a station other than its dish's; dishes and extras are answered from one routing snapshot"`

---

### Task 2: One answer to "this dish's kitchen work", and an index for it

**Files:**
- Create: `apps/server/src/dish-kitchen.ts`, `apps/server/src/dish-kitchen.test.ts`
- Modify: `packages/db/src/schema/orders.ts` — in `working_order_lines`' constraint list (`:190-229`),
  `index("working_order_lines_parent_idx").on(t.parentLineId)`
- Create (generated): `packages/db/drizzle/00NN_line_parent_index.sql`

**Interfaces:**

```ts
// apps/server/src/dish-kitchen.ts
import type { TicketState } from "./kitchen-print.js";

/** One kitchen record of a dish's work: the dish's own, or one of its split-off extras'. */
export interface DishKitchenItem {
  ticketItemId: string;
  /** The line the record is on: the dish's, or the extra's. */
  workingOrderLineId: string;
  dishLineId: string;
  extra: boolean;
  workingOrderId: string;
  stationId: string;
  courseId: string | null;
  firedAt: string | null;
  state: TicketState;
  /** Thousandths: what the station was asked for (`firedQuantity`, `kitchen-print.ts:519`). */
  firedQuantity: number;
  /** Thousandths: the line's own stored quantity. */
  lineQuantity: number;
}

/** Each of these dish lines' kitchen records — its own first, if it has one, then each split-off
 *  extra's in line order — keyed by dish line id. A dish with none is absent. One query. */
export async function dishKitchenItems(
  tx: Transaction,
  dishLineIds: readonly string[],
): Promise<Map<string, DishKitchenItem[]>>;

/** A `ticket_items` condition: the record is on one of `lineIds`, or on an extra line whose dish is
 *  one of them. For the `where` of a select or an update over `ticket_items`. */
export function onDishesOrTheirExtras(tx: Transaction, lineIds: readonly string[]): SQL;
```

The query of `dishKitchenItems` reads `ticket_items` joined to `working_order_lines` where the line
is one of the ids OR its `parent_line_id` is.

- [ ] **Step 1: Write the failing tests** (`dish-kitchen.test.ts`, real database migrated with core as
  `kitchen-print.test.ts:78` sets it up). Seed directly: an order with a burger line, its chips child
  and its cheese child, a record for the burger (Grill) and for the chips (Fryer), none for the
  cheese; a second dish with no record and a child with one (X5's shape).
  - `dishKitchenItems([burger, secondDish])` answers the burger's two records, its own first with
    `extra: false`, and the second dish's one extra record; a dish with no records at all is absent;
    `firedQuantity` falls back to the line's quantity when the record's is null.
  - An update `set firedAt` with `where(onDishesOrTheirExtras(tx, [burger]))` changes the burger's
    and the chips' records and not the second dish's.
  - **The query plans.** Build each of three queries as the code builds it — the `dishKitchenItems`
    read (with its `order by` line number, which its "own first, then extras in line order" promise
    needs), an update whose `where` is `onDishesOrTheirExtras`, and `readQueueSubItems`' children read
    (`WO:4946-4957`, run every 15 seconds by the kitchen screens; export a builder for it, or build
    the same chain in the test from the same imports) — take its SQL and parameters with `.toSQL()`,
    and run `explain query plan` on that SQL in the test's database. Never hand-write the SQL: the
    plan depends on its exact shape (review 2 measured that an `order by` changes which table a plan
    without the index scans). Assert only what holds for any shape:
    - **with the index**, each plan contains `USING INDEX working_order_lines_parent_idx`, and the
      first two also contain `MULTI-INDEX OR`;
    - **control, in the same test:** `drop index working_order_lines_parent_idx`, re-run the three,
      and assert each plan no longer names the index and has a line starting `SCAN `.

    So both directions are measured on the SQL the code emits (CLAUDE.md §1). The database has no
    `ANALYZE`; if a plan differs from the receipt below, record what it says — the assertions above
    still hold.

  **Receipt (measured 2026-10-01, Node v26.7.0, `node:sqlite`, `main` at `7958c7b85`, same code as
  `38612da08` for every file cited).** The three queries built with drizzle's `QueryBuilder` over the
  real schema objects (`ticketItems`, `workingOrderLines`, `products` from `packages/db/src`;
  `parentProducts`, `parentJoin`, `effectiveProductColumns` from `packages/catalogue/src/variant-fallback.ts`),
  the children read copied from `WO:4946-4957`, `dishKitchenItems` as this task specifies it, and
  `onDishesOrTheirExtras` as a select's `where` (an update's `where` is the same predicate); SQL from
  `.toSQL()`; every core migration in `packages/db/drizzle/meta/_journal.json` applied to an empty
  in-memory database; `explain query plan` without, then with,
  `create index working_order_lines_parent_idx on working_order_lines(parent_line_id)`. Command, from
  the repository root:
  `AI_AGENT= CLAUDECODE= node_modules/.bin/vitest run --config /private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/a600eccb-31c4-4194-b3f5-a99bc036c1df/scratchpad/qp2/vitest.qp.config.mts --root packages/db`
  (the config and `plans.qp.ts` live in the scratchpad, are not committed, and wrote nothing to the
  repository: `git status --short` was empty after). Output, the emitted SQL then each plan's rows:

  ```text
  == WITHOUT index
    dishKitchenItems
      SQL: select "ticket_items"."id", "working_order_lines"."id" from "ticket_items" inner join "working_order_lines" on "working_order_lines"."id" = "ticket_items"."working_order_line_id" where ("working_order_lines"."id" in (?, ?) or "working_order_lines"."parent_line_id" in (?, ?)) order by "working_order_lines"."line_no"
       SCAN working_order_lines
       SEARCH ticket_items USING INDEX ticket_items_working_order_line_id_key (working_order_line_id=?)
       USE TEMP B-TREE FOR ORDER BY
    onDishesOrTheirExtras
      SQL: select "id" from "ticket_items" where ("ticket_items"."working_order_line_id" in (?, ?) or "ticket_items"."working_order_line_id" in (select "id" from "working_order_lines" where "working_order_lines"."parent_line_id" in (?, ?)))
       MULTI-INDEX OR
       INDEX 1
       SEARCH ticket_items USING INDEX ticket_items_working_order_line_id_key (working_order_line_id=?)
       INDEX 2
       LIST SUBQUERY 1
       SCAN working_order_lines
       SEARCH ticket_items USING INDEX ticket_items_working_order_line_id_key (working_order_line_id=?)
    readQueueSubItemsChildren
      SQL: select "working_order_lines"."parent_line_id", "working_order_lines"."descriptions", coalesce("products"."allergens", "parent"."allergens"), coalesce("products"."dietary_declarations", "parent"."dietary_declarations") from "working_order_lines" left join "products" on "products"."id" = "working_order_lines"."product_id" left join "products" "parent" on "parent"."id" = "products"."parent_id" where "working_order_lines"."parent_line_id" in (?, ?) order by "working_order_lines"."line_no"
       SCAN working_order_lines
       SEARCH products USING INDEX sqlite_autoindex_products_1 (id=?) LEFT-JOIN
       SEARCH parent USING INDEX sqlite_autoindex_products_1 (id=?) LEFT-JOIN
       USE TEMP B-TREE FOR ORDER BY
  == WITH index
    dishKitchenItems
       MULTI-INDEX OR
       INDEX 1
       SEARCH working_order_lines USING INDEX sqlite_autoindex_working_order_lines_1 (id=?)
       INDEX 2
       SEARCH working_order_lines USING INDEX working_order_lines_parent_idx (parent_line_id=?)
       SEARCH ticket_items USING INDEX ticket_items_working_order_line_id_key (working_order_line_id=?)
       USE TEMP B-TREE FOR ORDER BY
    onDishesOrTheirExtras
       MULTI-INDEX OR
       INDEX 1
       SEARCH ticket_items USING INDEX ticket_items_working_order_line_id_key (working_order_line_id=?)
       INDEX 2
       LIST SUBQUERY 1
       SEARCH working_order_lines USING INDEX working_order_lines_parent_idx (parent_line_id=?)
       SEARCH ticket_items USING INDEX ticket_items_working_order_line_id_key (working_order_line_id=?)
    readQueueSubItemsChildren
       SEARCH working_order_lines USING INDEX working_order_lines_parent_idx (parent_line_id=?)
       SEARCH products USING INDEX sqlite_autoindex_products_1 (id=?) LEFT-JOIN
       SEARCH parent USING INDEX sqlite_autoindex_products_1 (id=?) LEFT-JOIN
       USE TEMP B-TREE FOR ORDER BY
  ```

  (The SQL printed WITH the index is the same as without, and is left out above.) An earlier run on
  hand-written SQL with the aliases `ti` and `wol` and no `order by` (review 1's `review-qp.mjs`, 15
  lines) showed the records read scanning `ticket_items` instead; that is why the test reads the
  emitted SQL and asserts only "names the index / scans".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/dish-kitchen.test.ts`.
  Expected: FAIL — module missing.
- [ ] **Step 3: Implement.** Add the index, then
  `pnpm --filter @waitron/db db:generate --name line_parent_index` and READ the file: expected
  exactly one `CREATE INDEX \`working_order_lines_parent_idx\` ON \`working_order_lines\`
  (\`parent_line_id\`);` (read, not run — not measured when this plan was written). Anything else, an
  `__new_working_order_lines` rebuild above all, is a STOP: `working_order_lines` has many child
  tables (CLAUDE.md §3). Then write `dish-kitchen.ts`.
- [ ] **Step 4: Run** the test file, then
  `pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts`.
  Expected: PASS. **Mutation floor of `db`:** change the index's name by hand in
  `packages/db/src/schema/orders.ts`, run `pnpm --filter @waitron/db exec vitest run`, and record
  which test fails. If none does, add a case to the db suite that pins the schema against its
  migrations (`grep -rln 'index_list\|_journal' packages/db/src/*.test.ts`) asserting the index
  exists by name, confirm the hand mutation now fails it, and restore the name (copy the file to the
  scratchpad first and restore from the copy, so its last newline survives).
- [ ] **Step 5: Commit** — `git commit -s -m "Kitchen records: one read answers a dish's own record and its split-off extras', and an index lets lines be looked up by their dish (core migration adds working_order_lines_parent_idx)"`

---

### Task 3: Sending gives a split-off extra its own record

**Files:**
- Modify: `apps/server/src/working-order.ts` — `fireLines` (3b's version; today `:1142-1343`), its doc
  comment (`:1131-1141`) and the inline comment "A CHILD modifier line is part of its parent dish and
  gets no ticket item of its own" (`:1146`)
- Modify: `apps/server/src/order-groups.ts` — `placeGroups` (`:132-223`; its `fireLines` loop at
  `:185-196`)
- Create: `apps/server/src/testing/split-extras-venue.ts`, `apps/server/src/split-off-extras.send.test.ts`

**Interfaces** (internal to `working-order.ts`; Tasks 4 and 6 call them too; `routingOnce` and
`RoutingOnce` are exported for `order-groups.ts`):

```ts
/** A memoised opener of one routing snapshot (Task 1's `routingAt`) at one instant: opened on first
 *  need, at most once, so a step that needs no routing loads nothing. */
type RoutingOnce = (() => Promise<MakerResolver>) & { readonly at: Date };
function routingOnce(tx: Transaction, cfg: TillConfig, at: Date): RoutingOnce;

/** A dish line being sent, or already with the kitchen, as its split-off extras copy it. */
interface DishKitchenPlace {
  dishLineId: string;
  /** Where the dish is finally made; null when it needs no preparation. */
  stationId: string | null;
  courseId: string | null;
  /** Null: held. */
  firedAt: string | null;
}

/**
 * INSERT ONLY. Decide every extra line of `dishes` that holds no record yet (the resolver's
 * `extraMakers`, Task 1) and insert a record for each one made elsewhere: its station, its dish's
 * course and `fired_at`, a null note, and its own line's quantity. An extra line that already holds a
 * record is neither asked about nor touched. It calls `routing()` only when some extra line of
 * `dishes` holds no record, so a call with no such line — an empty `dishes`, a release of dishes with
 * no extras — opens no snapshot. A unique violation is turned into `ticket.already_fired`, as the
 * dish insert's is (`WO:1328-1334`). Answers the inserted rows; it prints nothing — its caller prints
 * them with its own.
 */
async function insertSplitExtras(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  zoneId: string | null,
  dishes: readonly DishKitchenPlace[],
  routing: RoutingOnce,
): Promise<{ workingOrderLineId: string; stationId: string; firedAt: string | null; quantity: number }[]>;

// fireLines' options GAIN `routing?: RoutingOnce`: a caller that has opened one (the edit path,
// Task 6) passes it, and fireLines then takes `routing.at` as its one clock reading instead of
// reading the clock — 3b's one-reading rule holds across the whole edit.
```

**Behaviour:**
- **One clock reading, one routing snapshot.** 3b made `fireLines` read the clock as its first
  statement. It now does `const routing = options.routing ?? routingOnce(tx, cfg, new Date())` as that
  first statement and uses `routing.at` wherever 3b used its reading (the fire time and the routing
  moment). Its dish routing asks `(await routing()).makers(zoneId, productIds)` instead of calling
  `VENUE_SERVICE.resolveMakers`; `insertSplitExtras` asks the same resolver. One `fireLines` call
  loads the rules at most once.
- **One snapshot per request, including `placeGroups` (review 3, I1).** Every non-test caller of
  `fireLines` (`grep -n "fireLines(" apps/server/src/*.ts`, 2026-10-01 at `84ce52a32`) calls it once
  per request — `move-bill.ts:413`, `till-sale.ts:1345`, `WO:1842` (`addTabRound`), `:4227`
  (`applyLineEdits`, Task 6), `:4623` (`placeOrder`), `:4692` (`sendToPrep`) — except `placeGroups`
  (`order-groups.ts:188`), which calls it once per group inside `for (const [i, group] of
  input.groups.entries())` (`:185`). A table's Send reaches it through `submitDraft`, and a
  submission of a fire group and a hold group is one send. So `placeGroups` opens ONE
  `routingOnce(tx, cfg, new Date())` before that loop and passes `{ routing }` to each `fireLines`:
  one clock reading and one rules load for the whole submission. (The test helper
  `testing/serve-line.ts:68` calls it once; it needs nothing.)
- `fireLines` keeps routing dish lines only (its input filter stays). After 3b's outcomes are mapped
  and every refusal has been thrown — so a refused send still writes nothing — it builds one
  `DishKitchenPlace` per dish line it is sending: the station its record goes to, or null for a
  no-preparation dish; the course and fire decision it computed for the dish (`fired ? firedAt :
  null`). A dish set aside by `unroutable: "skip"` is left out, so its extras are set aside with it.
- **The order of operations at the end of `fireLines` (review 2, I1)** — today `:1317-1342`:
  1. `stampSent` (as today);
  2. if any dish got a record (`values` not empty), insert the dish records inside today's `try`
     (`:1320-1334`);
  3. **release with the dish (Minor 1 of review 2: this rule lives HERE and nowhere else):** for each
     dish this call fires now (`fired` true) whose extra lines already hold a HELD record — a dish
     that reaches `fireLines` a second time through `unsentDishLines` (`WO:1115-1129`; for example a
     held no-preparation dish on a bill moved to the counter and placed, or a placed counter order
     then paid) — set those records' `fired_at` to the fire time and collect them for printing,
     because an extra copies its dish's hold (X7). A dish that stays held leaves them held;
  4. `insertSplitExtras` for every dish of the send (it skips extras that already hold a record);
  5. ONE `enqueueKitchenTickets` (`:1337-1341`) over the fired dish records, the released extra
     records of step 3, and the fired extra records of step 4.
  The early return `if (values.length === 0) return unrouted;` (`WO:1318`) is deleted (3b's
  equivalent, wherever it sits, likewise); the function returns `unrouted` at its end. So a send of
  only a Water with chips — no dish record at all — still inserts AND prints the chips' record.
- `insertSplitExtras` reads those dishes' extra lines itself, by `parent_line_id` (callers keep
  passing what they pass today), with the order's zone (`serviceContext?.zoneId ?? null`, as 3a
  passes it to `resolveMakers`).
- **X6:** a dish's `stationId` here is where it is finally going — 3b's stored Make at, or 3b's kept
  station, or the rules' answer — so an extra that follows it follows it there, and one that splits
  off splits by its own rule.
- **X13, only if 3c-1 is on `main`:** after an extra's station is decided, apply 3c-1's made-here
  check exactly as `fireLines` applies it to a dish: its record is born `ready` with 3c-1's made-here
  mark, nothing prints for it, and its line id goes to `cfg.madeHereSink` (3c-1's Task 9b) so the
  till's "Make now" list shows it. **It is never held (3c-1's T12, owner 2026-10-01, after
  approval):** its `fired_at` is the send's one clock reading (`routing.at`) whatever its dish's
  `DishKitchenPlace.firedAt` says — the one place an extra does not copy its dish's hold. The check
  lives in `insertSplitExtras`, not only in `fireLines`, so every path that decides an extra applies
  it: a send (`fireLines`), a release (`finishRelease`, Task 4) and an edit (Task 6); the device
  is the one sending the request (3c-1's T8, read from the same `cfg.sendingDeviceId` 3c-1's
  `fireLines` reads). A release route carries no device (`till-api.ts:783`, `:1826`, `:2063` pass
  `deps.cfg`), so at a release the check finds no "here" and the extra gets its station's ticket
  (X13). Step 3's "release with the dish" never meets a made-here extra: it has no
  held record.
- Rewrite `fireLines`' doc comment so it states the rule (a dish's extras are decided after it,
  against the same routing snapshot, and one made elsewhere gets its own record copying the dish's
  course and hold — or, when the sending device makes its station here, fired and ready at the send,
  never held), and replace the `:1146` comment.

**The fixture** (`testing/split-extras-venue.ts`, used by Tasks 3–10). `setupVenue` (`:96`),
`fireNewOrder` (`:234`) and `addExtras` (`:311`) are local functions of `apps/server/src/kitchen-print.test.ts`,
not exports: MOVE `addExtras` and `fireNewOrder` into the fixture file and import them back into
`kitchen-print.test.ts`, so there is one copy; take what the fixture needs of `setupVenue` the same
way. `apps/server` leaves `src/testing/**` out of coverage (`apps/server/vitest.config.ts:30`), so the
move costs no coverage. Add `apps/server/src/testing/party-venue.ts`'s `setupPartyVenue` and
`orderForParty`, and 3a's `claimFolderFor` / `routeProductTo` (`apps/server/src/testing/zone-offers.ts`);
read them and reuse, never re-derive pricing. Extras are built the way `main` stores them when the
branch starts (slice 2, above). It provides:
- stations Grill, Fryer, Kitchen (the default) and Bar, each with a `station`-scope printer, and one
  `order`-scope ("PASE") printer attached to Grill;
- folders Food › Burgers (claimed by Grill), Extras › Sides (claimed by Fryer), Extras › Toppings
  (unclaimed), Extras › Sauces (claimed by "No preparation"), Drinks › Bottled (claimed by "No
  preparation");
- products, each with three different names — Burger (staff "Burger", customer "Hamburguesa clásica",
  kitchen "BURG"), Chips ("Chips", "Patatas fritas", "CHIPS"), Cheese ("Cheese", "Queso extra",
  "QUESO"), Sauce ("Sauce", "Salsa brava", "SALSA"), Water ("Water", "Agua mineral", "AGUA"), and a
  second product in Extras › Sides, Onion rings ("Onion rings", "Aros de cebolla", "AROS") — and
  allergens on Chips (gluten, so X12's assertion has something to find);
- one extras list on Burger and one on Water, each holding Chips, Onion rings, Cheese and Sauce,
  `maxQuantity: 2`;
- a seated party at a table in a service zone, so the group paths work, and a counter path.

- [ ] **Step 1: Write the failing tests** (`split-off-extras.send.test.ts`). Each says which
  assertion fails if the behaviour is deleted.
  - **Review Focus 1 (records).** Send a burger with chips and cheese on a table round: the burger's
    record is at Grill; the chips line has its own record at Fryer, `course_id` equal to the burger's,
    `fired_at` equal to the burger's, `quantity` equal to the chips line's; the cheese line has none.
    With two burgers and two chips each, the chips' record asks for 4 while the burger's asks for 2,
    so a record written at the dish's quantity fails. (Without the change: the chips line has no
    record.)
  - **X3.** A burger with sauce: no record for the sauce.
  - **Review Focus 8 / X4.** Fryer closed by hand with no fallback (3b's `setStationToday`): the send
    is not refused and the chips have no record; with Kitchen as Fryer's fallback, the chips' record
    is at Kitchen.
  - **X5 / Review Focus 9.** A counter send of ONLY a water with chips — no dish in the send gets a
    record, the case today's early return at `WO:1318` catches: no record for the water, a record for
    the chips at Fryer, fired, AND exactly one Fryer print job whose decoded text names `CHIPS`.
    (Without the change: no chips record. With the record inserted but the early return kept before
    the print: the record exists and the Fryer job count is 0 — the assertion that catches review
    2's I1.) A water with cheese: no record at all. A water with chips in
    a later course: a held chips record carrying the water's course.
  - **X6.** A burger whose line carries 3b's `make_at_station_id` = Bar, with chips and cheese: the
    burger's record is at Bar, the chips' at Fryer; the cheese has no record (it rides on the burger's
    ticket at Bar). A burger made at Fryer by hand: the chips follow it (no record of their own).
  - **Held.** A burger in a later course: both records are held (`fired_at` null) with the same course.
  - **Set aside.** On a payment with the default switched off and the burger unroutable (3a/3b's
    `unroutable: "skip"`): neither the burger nor its chips get a record, and the returned set-aside
    list names the burger only.
  - **Refused.** 3b's dead end on the burger (`station.no_replacement`): nothing is written, the
    chips included (assert `ticket_items` unchanged).
  - **No collision, and released with its dish.** A water with chips held by a later course, so the
    chips' record is held; then call `fireLines` again with `unsentDishLines`' answer for that order
    with `release: true` on the water (the shape a later place or pay takes): no
    `ticket.already_fired`, still one chips record, and its `fired_at` now equals the water's
    `sent_at`, with a Fryer print job. (Without step 3's release rule: `fired_at` stays null.) The
    same call with the water still held leaves the chips' `fired_at` null.
  - **One routing load per send (review 2, I4; review 3, I1).** Do every setup step first, then
    install the spies — `vi.spyOn` on `VENUE_SERVICE.routingAt`, `VENUE_SERVICE.resolveMakers` and
    `VENUE_SERVICE.resolveExtraMakers` (methods of the seat object, `apps/server/src/modules.ts`;
    precedent `working-order.test.ts:743`), or `mockClear` them — immediately before the command
    under test, so the counts hold only that command's calls (review 3, Minor 4). Then:
    - send two burgers with chips and cheese through `addTabRound`: `routingAt` exactly once, the two
      wrappers never;
    - a table submission through `placeGroups` with TWO groups, one `fire` and one `hold`, each
      holding a burger with chips: `routingAt` exactly once, the wrappers never (without the
      `placeGroups` change: 2);
    - the same `addTabRound` send with no extras: `routingAt` once, wrappers never.
    (Fails if `fireLines`, `placeGroups` or `insertSplitExtras` opens a second snapshot or calls a
    wrapper.)
  - **X13** (only if 3c-1 is on `main`): with Bar made here at the sending device and Bar claiming
    Extras › Sides, the chips' record is born ready with the made-here mark and no print job names it.
  - **Made here, never held (only if 3c-1 is on `main`; owner, 2026-10-01, after approval).** The bar
    till makes Bar here and Bar claims Extras › Sides. A burger in a later course (so held), with
    chips, sent from the bar till: the burger's record at Grill is held (`fired_at` null); the chips'
    record is at Bar, made here, `ready`, with `fired_at` equal to the send's instant, and its line id
    is in the request's made-here sink (the response's "Make now" items, 3c-1's Task 9b). The same in
    a held group placed through `placeGroups` with `release: "hold"`. Then `fireCourse` (or
    `fireGroup`) releases the burger and prints at Grill, and touches the chips' record not at all.
    (Without the exception: the chips' `fired_at` is null — the assertion that fails.) The same send
    from a device that makes nothing here: the chips' record at Bar is held with the burger.
  - Keep, re-named, the existing cases that pin an UNCLAIMED extra: `kitchen-print.test.ts:1040`
    ("fires a dish with two extras as ONE ticket_item") and `:1182` ("never station-resolves a child
    line…") — they now pin "an extra no rule covers follows its dish, and never falls to the
    default". Their setup moves to 3a's helpers if 3a did not already move it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.send.test.ts`.
  Expected: FAIL — the chips have no record.
- [ ] **Step 3: Implement** `routingOnce`, `insertSplitExtras` and the `fireLines` change.
- [ ] **Step 4: Run** the new file and `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/kitchen-print.test.ts src/order-groups.test.ts src/till-sale.test.ts src/tabs.test.ts`.
  Expected: PASS. (Between this task and Task 10, a split-off extra prints twice on paper — once as
  its own line and once as "+" on its dish — because `buildTicketItems` still folds every child into
  its dish. No existing test sends a claimed extra, and the branch does not land before Task 10.)
- [ ] **Step 5: Commit** — `git commit -s -m "Sending: an extra whose folder another station claims gets its own kitchen record there, with its dish's course and hold"`

---

### Task 4: Holding and releasing cover the extra

**Files:**
- Modify: `apps/server/src/working-order.ts` — `fireCourse` (`:1473-1486`), `heldNoRouteLines`
  (`:1386-1425`), `releaseHeld` (`:1513-1544`), `fireOrderLines` (`:1492-1507`), `finishRelease`
  (`:1552-1567`), `sendLines` (`:1573-1649`), `setLineCourse` (`:2163-2192`), `servableLines` /
  `refuseUnreleased` (`:2195-2272`)
- Modify: `apps/server/src/order-groups.ts` — `fireGroup` (`:245-265`), `fireHeldGroupsOfCourse`
  (`:354-390`) and `releaseGroup` (`:420-452`) pass the routing opener down; `readCurrentOrders`'
  `released` (`:1149`)
- Create: `apps/server/src/split-off-extras.release.test.ts`

**Behaviour:**
- `fireOrderLines`' record scope becomes `onDishesOrTheirExtras(tx, lineIds)` (Task 2) instead of
  `inArray(ticketItems.workingOrderLineId, lineIds)` (`:1503`). Through it, `releaseGroup`
  (`order-groups.ts:420-452`) — which passes a group's dish lines only (`:428-433`) — releases the
  extras' records too, under the same per-group FIRE mark (`:443`).
- `sendLines` with named lines: the named lines' scope (`:1620`) likewise. (Its "send everything held"
  case excludes the held groups' lines by `notInArray` over a list that already holds extra lines —
  the query at `:1581-1586` has no dish filter — so it needs no change; a test pins it.)
- **Extras of a no-preparation dish released now (review I2; the decisions-round ruling).** A
  no-preparation dish holds no record, so an extra an edit adds to it while it is held by its course
  in no group (`kitchenStateOf` answers `none`, `:3514-3518`) is never decided at the edit, and
  nothing sends it later: the course's release only stamps the dish sent (`heldNoRouteLines` →
  `finishRelease` → `stampSent`). So `finishRelease` (`:1552-1567`) calls `insertSplitExtras` (Task
  3) for the `noRoute` dishes it releases — station null, the dish line's course, `fired_at` the
  release's `at` — and prints what it inserts with the release's `fired` items, under the same mark.
  `insertSplitExtras` is insert-only and never touches an extra that already holds a record, so this
  call neither re-decides nor releases extras decided when the dish was first sent on hold — those
  are released by the record scopes below, and only by them.
- **What `finishRelease` needs, and from where (review 2, Minor 5).** `heldNoRouteLines` returns line
  ids only today (`:1421-1424`). It now returns `{ zoneId, lines: { id, courseId }[] }` — the zone
  from the `findOrderContext` it already calls (`:1403`), the course from its candidate read (add
  `courseId` to the select at `:1406`) — and `releaseHeld` and `sendLines` hand that to
  `finishRelease`, whose `noRoute` parameter takes it in place of the ids.
- **One routing snapshot per release command (review 2, I4).** The outermost release command opens
  one `routingOnce` (Task 3) at its one clock reading and passes it down: `fireCourse` (`:1473-1486`)
  to `fireHeldGroupsOfCourse` → `releaseGroup` → `fireOrderLines` → `releaseHeld`, and to its own
  `releaseHeld`; `fireGroup` (`order-groups.ts:245-265`) to `releaseGroup`; `sendLines` (`:1610`,
  where it already reads the clock once) to `heldNoRouteLines` and `finishRelease`. `releaseGroup`,
  `fireOrderLines` and `releaseHeld` take it as an optional last parameter, open their own only when
  called without one, and use its `at` as their fire time in place of their own `nowIso()`
  (`:1521`, `order-groups.ts:449`). `heldNoRouteLines` asks `(await routing()).makers(…)` in place of
  3a/3b's `VENUE_SERVICE.resolveMakers` call (`:1419-1421` today), and only when it has candidates;
  `finishRelease` passes it to `insertSplitExtras`. A release with no no-preparation candidate opens
  nothing: the opener is lazy. This is the point the reviewer suggested; the code shows no
  better one: every release of a held no-preparation dish (by course, by group through
  `fireOrderLines`, by a named or a whole `sendLines`) ends in `finishRelease` with that dish in
  `noRoute` (`:1531-1543`, `:1631-1648`), and it is the one place that knows the release's time.
- `setLineCourse` (review I5): its fired check (`:2181-2187`) reads the dish's own record AND its
  split-off extras' (`onDishesOrTheirExtras`) and refuses `ticket.already_fired` when any has fired —
  a sent no-preparation Water whose chips are cooking has no record of its own, so today's check
  would let its course change move the chips' record between the pass's course sections. When the
  change is allowed, set the course on the dish's record and its extras' records in one statement
  (`where(onDishesOrTheirExtras(...))`, after `:2190`).
- **Serving (X5).** A dish is released work only when none of its split-off extras' records is held.
  `servableLines` (`:2213-2250`) reads, per dish, whether such a held record exists (an `exists`
  over `ticket_items` joined to the dish's extra lines with `fired_at is null`), and
  `refuseUnreleased` (`:2268-2272`) refuses `group.line_held` when `!isReleased(line) ||
  line.extraHeld`. `isReleased` keeps its shape: `groupArrivingDishes` and the adjustments' stage
  read it as it is. `readCurrentOrders`' `released` (`order-groups.ts:1149`) takes the same check, so
  the till never offers a Serve the server refuses. (Reachable only after a recall of a
  no-preparation dish, which only the server allows — the till's Recall needs the line's own fired
  record, `till-table-order-screen.ts:1686-1692` — but cheap to keep true.)
- `fireCourse` (`:1473-1486`), `bumpCourseReady` and `markCourseAway` (`:1749-1792`) work by the
  record's course, which the extra copies: no change; the tests pin them.

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 3, by course.** A burger with chips in a later course on a table bill: both held;
    `fireCourse` releases both; the Fryer gets a ticket naming the chips. Then `bumpCourseReady` and
    `markCourseAway` set both records ready and away.
  - **Review Focus 3, by group.** The same order placed as a held group (`placeGroups` with
    `release: "hold"`) where the venue prints held work (`readPrintHeldWork` on): the Fryer gets a
    `*** HOLD ***` ticket; `fireGroup` releases both records and the Fryer gets a `*** FIRE ***`
    ticket. Before this task's change the chips stay held — that is the failing assertion.
  - **Named send (review I3).** A burger with two chips held by its later course, added to a party's
    bill by `addTabRound` with no group stamp (`WO:1811-1844`; both records held, no group — a table
    bill always has a party, `assertPartyBillOpen` `:1076-1094`, so "no group" is the shape), released by `sendLines` naming only the burger's line
    number: the chips' `fired_at` is set and the Fryer gets a ticket. (Without the change: the chips'
    `fired_at` stays null and no Fryer job is queued. The earlier "recalled burger" variant could not
    fail before Task 5, because until then a recall leaves the chips fired.)
  - **Course change.** `setLineCourse` on a held burger with chips: both records carry the new course.
    (Without the change: the chips' `course_id` keeps the old course.)
  - **Review Focus 9, course.** A water with chips in a later course: `fireCourse` releases the chips'
    record and the Fryer prints it; the water is stamped sent. (Passes before the change if Task 3
    copied the course — it pins that.)
  - **Review Focus 9, chips added later (review I2).** A water in a later course, added by
    `addTabRound` with no group stamp, with no extras; an edit adds chips (Task 6's free path leaves them undecided, because
    the water's kitchen state is `none`); `fireCourse`: a chips record at Fryer, fired, and a Fryer
    ticket. (Without the `finishRelease` call: no chips record at all.)
  - **Review Focus 9, group.** A water with chips in a held group: `fireGroup` releases the chips'
    record and the Fryer prints it under `*** FIRE ***` when the HOLD ticket was queued. (Without
    `fireOrderLines`' widened scope: the chips stay held — `finishRelease`'s `insertSplitExtras` call
    cannot rescue them, because it is insert-only and skips an extra that already holds a record.
    Delete the widened scope and check this case goes red before trusting it.)
  - **One routing load per release (review 2, I4).** With the same spies as Task 3's case, installed
    after the setup (the setup's sends and edit open snapshots of their own), a
    `fireCourse` that releases a course-held water (whose chips an edit added) and a burger, and
    also fires a held group of that course holding a second water: `routingAt` once,
    `resolveMakers` and `resolveExtraMakers` never. A `fireCourse` releasing only
    a burger (no no-preparation dish): `routingAt` never. (Fails if `heldNoRouteLines` keeps 3b's
    own `resolveMakers` call, or `finishRelease` opens its own.)
  - **Review Focus 9, course change refused (review I5).** A sent water whose chips' record fired:
    `setLineCourse` on the water is refused `ticket.already_fired` and the chips' `course_id` is
    unchanged. (Without the change: accepted, and the chips' course moves.)
  - **Review Focus 9, serving.** A sent water whose chips' record has been recalled to held (through
    `recallLines` after Task 5, or by setting `fired_at` null directly here): `markServed` on the
    water is refused `group.line_held`, and `readCurrentOrders` shows it not released; once the chips
    fire again, serving succeeds. (Without the change: the serve goes through.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.release.test.ts`.
  Expected: FAIL (the group, named-send, course-change, chips-added-later, refused course change and
  serving cases; the plain course cases may already pass, which is their purpose).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `pnpm --filter @waitron/server exec vitest run src/order-groups.test.ts src/working-order.test.ts src/current-orders.test.ts src/served.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Holding and firing: a split-off extra is held and released with its dish, by course, by group and by a named send; a no-preparation dish's extras are decided when it is released, and it is not served or re-coursed while they say otherwise"`

---

### Task 5: Recalling and cancelling a dish tell the extra's station too

**Files:**
- Modify: `apps/server/src/working-order.ts` — `recallLines` (`:1678-1743`), `removeFromLine`
  (`:1939-2010`) and its doc comment (`:1929-1938`, "An extra, which has no kitchen item of its own,
  tells the kitchen about its dish"), `reduceLine` (`:2104-2135`)
- Create: `apps/server/src/split-off-extras.cancel.test.ts`

**Behaviour:**
- **Recall (X8, P2).** `recallLines` reads the named lines' records through `onDishesOrTheirExtras`
  instead of `inArray(... lineIds)` (`:1714`), so: the "changes to sent items" check (`:1715`) and the
  started check (`:1718-1721`, `ticket.already_started` naming the first started record — a started
  extra included) cover the extras; each fired, queued extra record gets a RECALLED notice and slip
  at its own station; the un-fire update (`:1731-1740`) uses the same scope.
- **Cancelling a dish whole** (`removed === null`): besides the dish's VOID (`:1949-1962`), each of
  its split-off extras' FIRED records gets a VOID (whole fired quantity, marked started when started);
  each HELD one whose group's HOLD ticket was queued gets a HOLD CANCELLED at its station
  (`correctHoldTickets`, as `:1963-1981` does for the dish). Read them with `dishKitchenItems` BEFORE
  the delete (`:1986-1993`): the slips re-read the lines, and the delete cascades the records away
  (`ticket-items.ts:42-45`).
- **Cancelling part of a dish** (`removed` thousandths): each extra record's VOID (or HOLD CANCELLED)
  is for `removed × perDish`, where `perDish = perDishOptionQuantity(child, dish)` as `keptExtrasOf`
  computes it (`:2065-2074`). `reduceLine` then sets each kept extra's record quantity to that extra
  line's new quantity (after `rescaleExtras`, `:2127`): a split-off extra's record always asks for
  its whole line.
- **Cancelling only the extra** (X8): no code change expected — the extra's own record arrives as the
  target's (`voidTargetOf`, `adjustments-apply.ts:243-257`), so `removeFromLine` prints its VOID at
  the Fryer through the existing `voided` path, and `tellKitchenOfCancelledExtra` (`:2017-2039`) still
  prints EXTRA CANCELLED at the dish's station from the dish's record (`readCancelledExtra`,
  `kitchen-print.ts:616-657`). The tests pin it. Fix the doc comment so it no longer says an extra
  has no record of its own.
- **A dish with no record of its own (X5, Review Focus 9).** `removeFromLine`'s own VOID and HOLD
  CANCELLED are already conditional on the target's record (`target.firedAt !== null`, `:1950`;
  `target.ticketItemId !== null`, `:1963`), and so is `reduceLine`'s update (`:2129`); the extras'
  corrections above come from `dishKitchenItems` and never touch the dish's record. Keep it so: no
  new `!` on the dish's record anywhere in this task. `recallLines` on such a dish recalls only its
  extras' records (the server allows it; the till does not offer Recall on a line without its own
  fired record, `till-table-order-screen.ts:1686-1692`).

- [ ] **Step 1: Write the failing tests** (through `cancelLine`, `apps/server/src/testing/cancel-line.ts:97`,
  and `recallLines`; count print jobs per printer and decode them with `decodeTicket`):
  - **Review Focus 4.** Cancel a fired burger with chips whole: a VOID slip at Grill and one at Fryer
    (the Fryer's names `CHIPS`), a `void` notice at each (`listStationNotices`), and no records left.
    (Without the change: no Fryer job and no Fryer notice.) Cancel one of two burgers with two chips
    each: the Fryer's VOID asks for 2 (not 1, the dish's part), and the chips' record afterwards asks
    for 2 (not 4). (Without the change: no Fryer VOID, and the chips' record still asks for 4.)
  - **Held.** Cancel a burger with chips in a held group whose HOLD ticket was queued: HOLD CANCELLED
    at Grill and at Fryer. (Without the change: nothing at Fryer.)
  - **Review Focus 5.** Cancel only the chips of a fired burger: exactly one new job at Fryer (VOID,
    `CHIPS`) and one at Grill (the EXTRA CANCELLED slip, `CAMBIADO` / `QUITAR: Chips` with the till in
    Spanish), and nothing else. (Passes before the change; it pins that the extra's own record is
    what makes the Fryer's VOID — remove the record's insert from Task 3 and the Fryer job count is
    0.)
  - **Recall.** Recall a fired burger with chips: both records held again, a RECALLED slip at each
    station. (Without the change: the chips' `fired_at` stays set, no Fryer slip.) With the chips'
    record `preparing`: refused `ticket.already_started` naming the chips' record, and nothing
    changed. (Without the change: the recall goes through.)
  - **Review Focus 9.** A sent water whose chips fired: cancelling the water whole prints one VOID,
    at Fryer, and no error; cancelling one of two waters with two chips each prints a Fryer VOID for
    2 and leaves the chips' record asking for 2; recalling the water (server call) holds the chips'
    record and prints a RECALLED slip at Fryer only. (Without the change: no Fryer job in each.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.cancel.test.ts`.
  Expected: FAIL (the Fryer hears nothing of the dish's cancel or recall).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `pnpm --filter @waitron/server exec vitest run src/adjustments-extra-cancel.test.ts src/adjustments-apply.test.ts src/working-order.test.ts src/tabs.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Cancel and recall: cancelling or recalling a dish voids or recalls its split-off extras at their own station; cancelling only the extra voids it there and tells the dish's station as before"`

---

### Task 6: An edit that changes a dish carries its extras with it

**Files:**
- Modify: `apps/server/src/working-order.ts` — `applyLineEdits` (`:3802-4257`), `planHeldCorrections`
  (`:4266-4304`)
- Create: `apps/server/src/split-off-extras.edit.test.ts`

`readEditableOrder` already gives each edited dish its children with their records
(`parent.children[i].ticket`, from the join at `:3690`); this task reads them there.

**Behaviour:**
- **What the kitchen has** (`kitchenHas`, `:3817-3826`): the dish's own record and each child's.
  The "changes to sent items" refusal applies when the dish was sent and any of them exists; a
  started one (the dish's first, then the extras in line order) is refused `ticket.already_started`
  naming it (P2); the answer "fired" is true when ANY of them has fired (so a no-preparation dish whose
  split-off extra fired counts, X5).
- **No `parent.ticket!` survives (review C1).** Once "fired" can be true for a dish with no record of
  its own, every branch it opens must read the dish's record as optional. Today's code dereferences
  it unconditionally in four places, each of which throws a `TypeError` (a 500 from the route) for a
  sent Water whose chips went to the Fryer: the `recalled` map (`:4074-4081`), the `dropped` VOID and
  the `reduceLine` call (`:4093-4100`, `:4107-4119`), the `change` delete (`:4168-4169`) and the
  `plan.removed` VOID (`:4026-4033`). Each becomes: the dish's own RECALLED, VOID, `reduceLine`
  record update or delete only when `parent.ticket !== null`; the extras' corrections always. Then
  `grep -n 'parent.ticket!' apps/server/src/working-order.ts` must print only lines guarded by such a
  check.
- **A change** (`action === "change"`): RECALLED for the dish's fired record (as today, `:4074-4081`)
  and for each KEPT child's fired record; VOID for each REMOVED child's fired record (it is not coming
  back). Delete the dish's record (as today, `:4168-4169`) and every kept child's record, so the
  re-fire (`fireNow`, `:4170-4178`, then `fireLines` at `:4227`) decides every extra afresh, added
  ones included (Task 3). A removed child's record goes with its row (`:4137-4144`). P3: an extra may
  now land somewhere else than before.
- **A drop** (`:4082-4120`): VOID at each kept child's station for `removed × perDish`, beside the
  dish's; `reduceLine` (Task 5) sets their records' quantities.
- **A raise**: unchanged — the added units are a new line, and `fireLines` decides its extras.
- **One routing snapshot per edit (review 2, I4).** `applyLineEdits` opens one `routingOnce` (Task 3)
  at one clock reading at its start and passes it to its `insertSplitExtras` call (below) and to
  `fireLines` (`:4227`) through the new `routing` option, so one edit loads the rules at most once and
  `fireLines` takes the edit's instant as its fire time.
- **A free edit of a dish the kitchen holds** (held or recalled; `action === "free"`):
  - a kept child's record gets its line's new quantity — in its OWN step, outside today's
    `else if (parent.ticket !== null)` branch (`:4179-4185`) that updates the dish's record, so a
    dish with no record of its own (a held Water whose chips have a held record) still updates its
    chips' record (review 2, I3);
  - a removed child's held record gets a HOLD CANCELLED at its station when its group's HOLD ticket
    was queued, and then goes with its row;
  - an added child: after the rows are written (`:4220-4223`), call `insertSplitExtras` (Task 3) for
    every edited dish the kitchen already has work for — its own record, a split-off extra's record,
    or (a no-preparation dish) a sent stamp — with the dish's stored place: its record's station
    (null for none), its record's course (else the line's), its record's `fired_at`. For a dish with
    no record of its own, it is HELD (`fired_at` null) when its group is held OR any of its extras'
    records is held (review 2, Minor 1: a server recall that put a Water's chips back on hold is not
    undone by an unrelated edit, as a recalled burger keeps its held state), and fired at the edit's
    instant only when it was stamped sent, its group is not held and none of its extras' records is
    held. Print the fired ones (`enqueueKitchenTickets`); for held ones
    in a group whose HOLD ticket was queued, a HOLD CHANGED "added" (`correctJoin`-style, Task 8
    extends `correctJoin` itself). A dish with none of those — never sent, or a no-preparation dish
    held by its course with no decided extra — is left: its extras are decided when it is sent
    (`fireLines`, Task 3) or released (`finishRelease`, Task 4).
- **`planHeldCorrections` decides "held" per RECORD, not per dish (review 2, I3).** Today a dish is
  held when `parent.ticket !== null && parent.ticket.firedAt === null && parent.groupId !== null`
  (`:4272-4273`), and `change()` reads `parent.ticket!` (`:4287`, `:4296`), so a Water (no record)
  whose chips hold a held record in a printed held group is never corrected. Instead: a dish takes
  part when its group is held and ANY of its records — its own, or a split-off extra's from
  `parent.children[i].ticket` — is unfired; and `change()` builds one `HeldChange` per such record,
  with that record's line id, station and quantity:
  - the dish's own record, as today (`taken`/`given` by the dish's quantities);
  - each KEPT child's held record: before = its stored quantity, after = `perDish × the dish's new
    quantity` (`taken` and `given` as the dish's rule picks them, `:4297-4302`);
  - each REMOVED child's held record, and every held record of a removed dish: `cancelled`, whole;
  - an ADDED child's new held record: `given`, printed after `insertSplitExtras` writes it (above).
- **A removed dish** (`plan.removed`, `:4023-4034`): VOID for each of its extras' fired records,
  beside the dish's.

- [ ] **Step 1: Write the failing tests** (through `updateOrderLine` / `updateHeldOrder`, whichever the
  existing edit suites use — `grep -ln 'updateOrderLine\|updateHeldOrder' apps/server/src/*.test.ts`):
  Each names the assertion that fails without the change.
  - Change a fired burger's note: RECALLED at Grill and Fryer, then a new ticket at each; the chips'
    new record at Fryer; their old one gone. (Without: no Fryer RECALLED slip, and the chips keep
    their old record, so Task 3's skip rule prints nothing new at Fryer.)
  - Change a fired burger and remove its chips in the same edit: RECALLED at Grill, VOID at Fryer,
    no chips record left, the Grill's new ticket carries no cross-reference. (Without: no Fryer VOID.)
  - Add chips to a fired burger that had none: the burger is recalled and re-sent (today's behaviour)
    and the chips get a record at Fryer. (Without Task 3: no chips record.)
  - Drop two burgers with two chips each to one: VOID at Grill for 1 and at Fryer for 2; the chips'
    record asks for 2. (Without: no Fryer VOID, and the chips' record still asks for 4.)
  - Add chips to a held burger in a group whose HOLD ticket was queued: a held chips record at Fryer
    and a HOLD CHANGED (added) slip there; no ticket fires. (Without: no chips record.)
  - **Raise (review I4).** Raise a held burger with two chips from 1 to 2: the chips' held record asks
    for 4 (not 2, the dish's quantity), and HOLD CHANGED slips at both stations, the Fryer's for +2.
    (Without: the chips' record still asks for 2 and nothing prints at Fryer.)
  - Remove a held burger with chips: HOLD CANCELLED at both stations. (Without: nothing at Fryer.)
  - With the chips' record `preparing`, changing the burger is refused `ticket.already_started`
    naming the chips' record; nothing changed. (Without: the change goes through.)
  - With Fryer since closed by hand with no fallback, changing the burger re-sends the chips to
    Grill with it (no chips record; `+ Chips` follows the dish) — P3.
  - **Review Focus 9, held (review 2, I3).** A water with two chips in a held group whose HOLD ticket
    was queued (the chips hold a held record at Fryer; the water none): raise the water 1→2 — exactly
    one new Fryer job, a HOLD CHANGED reading `+2` and `CHIPS`, nothing at Grill, and the chips'
    record asks for 4 (without the change: no Fryer job, and the record still asks for 2); remove the
    water — one Fryer job, HOLD CANCELLED naming `CHIPS`, and no records left (without: no Fryer
    job). Change the water's note: HOLD CHANGED −2 then +2 at Fryer.
  - **Held after a server recall (review 2, Minor 1; review 3, I2).** A water with chips, sent
    through `addTabRound` with no group stamp, its chips fired at Fryer; recall the water
    (`recallLines`, Task 5), so the chips' record is held and the water keeps its sent stamp. Note the
    Fryer's print-job count. Then add Onion rings to the water by an edit (they are in Extras › Sides,
    so they split off to Fryer — cheese and sauce would not, which is why the earlier version of this
    test could not fail). Assert: the onion rings' new record is at Fryer with `fired_at` NULL, and the
    Fryer's print-job count is unchanged (the water is in no group, so no HOLD ticket exists to
    correct). **The assertion that fails when the rule is deleted** — firing a dish with no record of
    its own on its sent stamp alone — is the onion rings' `fired_at`: it would be the edit's instant,
    and a new Fryer ticket would be queued. Side assertion: the chips' record is still held.
  - **One routing load per edit (review 2, I4).** With Task 3's spies, installed after the setup
    (sending the two burgers first opens snapshots): an edit that adds chips to a
    held burger AND changes a fired burger's note (so both `insertSplitExtras` and `fireLines` run):
    `routingAt` once, the wrappers never.
  - **Review Focus 9 (review C1).** A sent water whose two chips fired at Fryer: changing its note
    answers success (no error), prints RECALLED and a new ticket at Fryer only, and leaves one new
    chips record; dropping two waters to one prints a Fryer VOID for 2 only; removing it prints a
    Fryer VOID only. (Without the C1 change: each throws a `TypeError` on `parent.ticket!`.) Adding
    chips to a sent water that had none: a chips record at Fryer, fired, and a Fryer ticket. (Without
    the added-child rule: no chips record.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.edit.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and the existing edit suites found in Step 1, plus
  `src/working-order.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Order edits: a changed, reduced, removed or held dish takes its split-off extras' records with it, and an extra added to a held dish is held at its own station"`

---

### Task 7: Splitting a dish splits its extra's record

**Files:**
- Modify: `apps/server/src/working-order.ts` — `carveOffLines`' split loop (`:3021-3041`)
- Create: `apps/server/src/split-off-extras.split.test.ts`

**Behaviour:** In the loop, after each child row is split (`splitRow(child.row, …)`, `:3025-3027`),
when the child row holds a record (`child.row.ticketItemId`, already read by the source select at
`:2833`): `splitTicketItem` it onto the new child row for `child.moved` (as `:3028-3036` does for the
dish), add the pair to `splitFrom`, `copyKitchenJobLines` it, and add the child's id to
`movedLineIds`. Then every caller's MOVED slips (`enqueueMovedSlips`, `kitchen-print.ts:789-802`,
which reads the destination's records and maps split ones through `splitFrom`) reach the Fryer as
well, and `copyKitchenPrintLinks` (`:3044`) links the new bill to the Fryer's tickets. Whole-line
moves already move every line's record (`moveOrderLines`, `:2589-2599`).

**A dish with no record of its own (X5, Review Focus 9).** The child handling above sits OUTSIDE the
`if (line.ticketItemId !== null)` block that splits the dish's record (`:3028-3040`), so a
no-preparation dish's split-off extras split too; and a child's split adds the child's id to
`movedLineIds` whether or not the dish had a record. The held-line refusal (`refuseHeld`,
`:2879-2886`, documented at `:2789-2791`) refuses to carry an unfired record outside a held group to
another bill, but it reads the dish's record only, so a water held by its course (no record) whose
chips' record is held slips past it. Widen it to the same rule for the extras: refuse `tab.split_held_line` when the dish's own record or
any of its split-off extras' records is unfired and the dish's group is not held. (The children's
records are in `sourceRows` already, joined at `:2838`.)

Which callers split a dish with extras: only a comp or discount of part of a dish
(`adjustments-apply.ts:733-739`, `splitExtras: true`); bill splits and transfers refuse a partial
split of a dish with extras (`bill-actions.ts:149-151`, `:223-226`, no `splitExtras`).

- [ ] **Step 1: Write the failing tests:**
  - A comp of one of two burgers with two chips each (`applyAdjustment`, through the fixture): the
    chips now have two records at Fryer, asking 2 and 2, one on each chips row; the total asked at
    Fryer is unchanged (4). (Without: one chips record still asks for 4 and the new chips row has
    none.)
  - Transfer a whole burger with chips to another bill of the party at another table: one MOVED slip
    at Grill and one at Fryer. (Passes before the change; it pins that whole moves carry the record.)
  - **Review Focus 9.** A comp of one of two waters with two chips each: two chips records at Fryer,
    2 and 2. (Without the child handling outside the dish's `if`: no record on the new chips row.) A
    bill split taking whole a water held by its course whose chips' record is held: refused
    `tab.split_held_line`. (Without the widened check: the split goes through.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.split.test.ts`.
  Expected: FAIL (the comp case: one chips record still asks for 4, the new row has none). The
  transfer case may pass already, which is what it pins.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `pnpm --filter @waitron/server exec vitest run src/adjustments-apply.test.ts src/split-bill.test.ts src/transfer-lines.test.ts src/party-bill-actions.test.ts src/working-order.test.ts`
  (there is no `bill-actions.test.ts`; `grep -ln 'carveOffLines\|splitLinesWithinOrder\|transferItems' apps/server/src/*.test.ts`
  lists any others). Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Splits: when part of a dish splits off, its split-off extras' kitchen records split with it, and moved work tells the extras' station"`

---

### Task 8: Groups and table signals count the extra

**Files:**
- Modify: `apps/server/src/order-groups.ts` — `dishLinesOf` (`:340-346`) and its two users
  (`bumpGroupReady` `:272-292`, `markGroupAway` `:295-315`), `moveLinesToGroup`'s HOLD corrections
  (`:640-701`), `heldItemsOf` (`:1268-1280`), `correctJoin` (`:1283-1308`)
- Modify: `apps/server/src/table-signals.ts` — `readKitchenLines` (`:34-71`)
- Create: `apps/server/src/split-off-extras.groups.test.ts`

**Behaviour:**
- `dishLinesOf` becomes `groupLinesOf`: every line of the group, extras included (drop the dish filter
  at `:345`; a following extra has no record, so the update matches nothing for it). Its comment "an
  extras line never has a kitchen item" goes. Group Ready and Away then reach the extras' records,
  and `readGroups`' roll-up (`:832-848`, which already counts every record of the group's lines)
  reads ready and away only when the extras are too.
- `heldItemsOf(lineIds)` answers, per named dish, ALL its held records — its own if it has one, and
  each split-off extra's — through `dishKitchenItems`, instead of one station per line
  (`:1268-1280`). `moveLinesToGroup`'s correction loop (`:683-699`) then emits one `HeldChange` per
  RECORD, not per dish: each with that record's own line id (`workingOrderLineId`: the extra's line
  for an extra), its own station, and its own quantity — for a whole-line move, the record's line's
  quantity (an extra's is dish × per-dish count), not the dish's `line.quantity` (`:691`). The
  `stationId === undefined` skip (`:688`) becomes "skip a dish with no held record at all", so a
  no-preparation dish whose extra's record is held is corrected at the extra's station (X5). Partial
  moves of a dish with extras stay refused (`splitLinesWithinOrder` is called without
  `splitExtras`, `:671`).
- `correctJoin(groupId, lineIds)`: the joined records are the dishes' and their split-off extras'
  (`where(onDishesOrTheirExtras(tx, lineIds))` in place of `inArray(... lineIds)` at `:1300`), so
  joining a held group whose HOLD ticket was queued prints `+N` at the Fryer. Its quantity already
  comes from each record's own line (`quantity: workingOrderLines.quantity`, `:1296`, joined on the
  record's line), so the Fryer's `+N` is the extra line's quantity.
- `readKitchenLines`: drop the dish filter (`:61`); the inner join to `ticket_items` already keeps
  only lines with a record. A split-off extra then shows "ready at Fryer" and counts in the long-wait
  band. Rewrite the interface comment ("A fired dish line…", `:19`) to "a fired line with a record".
  **Units (review Minor 10):** "N ready" counts plates to carry (`units`, `:66-70`: "A weighed dish is
  one plate however much it weighs"), so an extra counts its DISH's units left to serve, not its own
  (two burgers with two chips each read "2 ready at Fryer", not 4): join the extra's dish line (an
  `alias` of `working_order_lines` on `parent_line_id`, left join) and compute `units` from the
  dish's `quantity − served_quantity` and `unit_precision` when the row is an extra.

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 6.** A fired group with a burger and chips: bump the burger ready at Grill
    (`advanceTicketItem`): `listOrderGroups` does not mark the group ready; bump the chips ready at
    Fryer: it does. A fresh order: the pass's `bumpGroupReady` sets both records ready, then
    `markGroupAway` stamps both away, and the group reads away.
    (Without: the group reads ready after the burger alone, and the pass's Ready leaves the chips
    `queued`.)
  - **Review I4.** A held burger with TWO chips moved whole to another held group, both groups' HOLD
    tickets queued: HOLD CHANGED −1 and +1 at Grill, and −2 and +2 at Fryer, each Fryer slip naming
    `CHIPS`. (Without the per-record change: nothing at Fryer; with a per-dish change that only adds
    the Fryer's station, the Fryer's slips read 1, which this fails.)
  - A held group whose HOLD ticket was queued, joined by a burger with two chips (`placeGroups` with
    `joinGroupId`): `+1` at Grill and `+2` at Fryer. (Without: nothing at Fryer.)
  - **Review Focus 9.** A held water with two chips moved whole to another held group, both HOLD
    tickets queued: −2 and +2 at Fryer only, no error. (Without: nothing at Fryer.)
  - Table signals: the chips ready at Fryer make the table's "ready" signal name Fryer
    (`readBillSignals`), and two burgers with two chips each count 2 there. (Without the filter
    change: no Fryer entry; without the units rule: 4.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.groups.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `pnpm --filter @waitron/server exec vitest run src/order-groups.test.ts src/table-signals.test.ts src/current-orders.test.ts`
  (or what `ls apps/server/src/*signals*.test.ts` lists). Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Groups: Ready and Away on a group cover its split-off extras, a group reads ready only when they are, and held-group moves and joins correct the extras' station too"`

---

### Task 9: The kitchen screens show each extra once, and the two cross-references

**Files:**
- Modify: `apps/server/src/working-order.ts` — `QueueModifier` (`:4851-4858`, its doc "never its own
  ticket item"), `StationQueueItem` (`:4874-4899`), `readQueueSubItems` (`:4922-4994`),
  `listStationQueue` (`:5034-5160`), `ExpoItem` (`:5163-5187`), `listExpoQueue` (`:5232-5428`)
- Modify: `apps/till/src/api/client.ts` — `QueueModifier` (`:1066-1077`, the same doc), `StationQueueItem`
  (`:1104-…`), `ExpoItem` (`:1271-…`)
- Modify: `apps/till/src/widgets/station-queue.ts` (`#renderLine` `:954-981`, after `#modifiers`
  `:1017-1034`), `apps/till/src/screens/till-expo-screen.ts` (`#item` `:648-673`, after `#modifiers`
  `:706-720`), `apps/till/src/i18n/strings.ts`
- Create: `apps/server/src/split-off-extras.queue.test.ts`; Modify: `apps/till/src/widgets/station-queue.test.ts`,
  `station-queue.a11y.test.ts`, `apps/till/src/screens/till-expo-screen.test.ts`, `till-expo-screen.a11y.test.ts`

**Interfaces** (server, mirrored in the till client):

```ts
/** A line on another station's ticket that this item goes with. */
export interface QueueCrossRef {
  /** "with": a split-off extra of this dish; "for": the dish this extra goes with. */
  kind: "with" | "for";
  /** The other line's KITCHEN name (`kitchenPresentationName`). */
  name: string;
  /** On "with": how many of the extra go with one dish (shown " x2" when more than one, as paper). */
  perDish?: number;
  /** The station making the other line; null on "for" when the dish needs no preparation. */
  stationName: string | null;
  /** On "with" only: the extra's own allergens and diet, as its "+" line carried them (X12). */
  addAllergens?: ProductAllergens | null;
  suitableFor?: string[] | null;
}
// StationQueueItem and ExpoItem GAIN: crossRefs?: QueueCrossRef[]; // absent when there are none
```

**Behaviour:**
- `readQueueSubItems(tx, lineIds)` takes the queue's line ids — dish lines and split-off extra lines.
  Its children read gains the child's kitchen names, its record's station name (left join
  `ticket_items` → `kitchen_stations`) and its quantity. A child WITH a record becomes a "with"
  cross-reference on its dish (kitchen name, `perDish`, station name, its allergens and diet); a
  child without one stays a `QueueModifier` as today. A second read, for the lines that are extras
  (`parent_line_id` not null), fetches their dish's kitchen names and the dish record's station name
  (null when the dish has none) — the "for" cross-reference. It returns a third map,
  `crossRefsByLine`, which both queues put on the item with `optional("crossRefs", …)`.
- A split-off extra's own queue item already carries its own kitchen name, quantity and allergens
  (it is a record on its own line): nothing else changes for it.
- The station name is read live, so after 3c-3 moves a dish the extra's "for" names the new station
  at once (its M23).
- Till: `#crossRefs(item)` renders after `#modifiers` in both widgets: a `<span class="line-crossrefs">`
  (expo: `item-crossrefs`) holding one `<span class="crossref" data-crossref>` per reference, worded
  by `t("station.crossref_with")` "with {name} from {station}" / "con {name} de {station}",
  `t("station.crossref_for")` "for {name} at {station}" / "para {name} en {station}", and
  `t("station.crossref_for_no_prep")` "for {name}, no preparation" / "para {name}, sin preparación";
  `{name}` gets ` x{perDish}` when `perDish > 1`. A "with" reference carries `extraNutrition(...)` as
  the "+" line does. Style it like `.line-modifiers`, from `--wt-*` tokens only, visually distinct
  from a "+" line (muted, no "+").

- [ ] **Step 1: Write the failing tests.**
  - Server (`split-off-extras.queue.test.ts`): send a burger with chips (two each) and cheese.
    `listStationQueue(Grill)`: the burger's item has one modifier (the cheese) and
    `crossRefs: [{ kind: "with", name: "CHIPS", perDish: 2, stationName: "Fryer", addAllergens: <chips' gluten>, … }]`.
    `listStationQueue(Fryer)`: one item, `name: "CHIPS"`, quantity 2, its own allergens, `crossRefs:
    [{ kind: "for", name: "BURG", stationName: "Grill" }]`. A water with chips: the chips' item says
    `stationName: null`. `listExpoQueue`: the burger's item has the cheese only as a modifier, and the
    chips appear once, as their own item at Fryer. Assert with `toEqual` on the whole `crossRefs`
    array, so a stray key fails (CLAUDE.md §4: `toMatchObject` checks only the keys listed).
  - Till (`station-queue.test.ts`, `till-expo-screen.test.ts`): an item with a "with" reference shows
    "with CHIPS x2 from Fryer" and the chips' allergen chip, and no "+ CHIPS"; a "for" reference shows
    "for BURG at Grill"; the no-preparation wording; Spanish wording with the locale set to Spanish;
    an item with no `crossRefs` renders no `.crossref`. The a11y tests gain each of those states in
    both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-off-extras.queue.test.ts`
  and, after checking memory, `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/screens/till-expo-screen.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those, the two a11y tests, and `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/device-api.test.ts`.
  Expected: PASS. Then look at it: `wa-wt demo <worktree>`. The demo seed creates no extras lists
  (`grep -rni 'extraList\|extras' apps/server/scripts/demo-seed/*.ts` finds nothing outside tests),
  so first create one on a demo dish in the dashboard's product editor, holding a product from a
  folder you then claim for another station on the Prep stations screen; publish the menu; send that
  dish with that extra and with one unclaimed extra; open the station view of both stations and the
  pass, in both themes and at handheld width.
- [ ] **Step 5: Commit** — `git commit -s -m "Kitchen screens: a split-off extra shows once, at its own station, and the dish and the extra each name the other and its station"`

---

### Task 10: Paper shows each extra once, and the two cross-references

**Files:**
- Modify: `apps/server/src/kitchen-ticket.ts` — `KitchenTicketItem` (`:17-28`), `entryKey`
  (`:61-69`), `emitItem` (`:132-150`), a new `crossRefText` beside `extraCancelledWords` (`:227-236`),
  the header comment of `KitchenTicketItem`
- Modify: `apps/server/src/kitchen-print.ts` — `buildTicketItems` (`:139-221`) and its doc comment
  ("`lineIds` are parent dish lines", `:137-138`)
- Test: `apps/server/src/kitchen-ticket.test.ts`, `apps/server/src/kitchen-print.test.ts`

**Interfaces:**

```ts
// kitchen-ticket.ts
export interface KitchenTicketItem {
  // …as today, plus:
  /** Lines on other stations' tickets this item goes with, already worded ({@link crossRefText}),
   *  printed as indented `> ` sub-lines after the modifiers and before the note. */
  crossRefs?: string[];
}

export type KitchenCrossRef =
  | { kind: "with"; name: string; stationName: string }
  | { kind: "for"; name: string; stationName: string | null };

/** The words of a cross-reference in `locale`'s language, Spanish else English:
 *  "with CHIPS from Fryer" / "con CHIPS de Fryer"; "for BURG at Grill" / "para BURG en Grill" (station names are printed as stored);
 *  "for AGUA, no preparation" / "para AGUA, sin preparación". */
export function crossRefText(ref: KitchenCrossRef, locale: string): string;
```

**Behaviour:**
- `entryKey` adds `item.crossRefs ?? []` to the key it already builds from name, unit, note, group
  and modifiers (X11).
- `emitItem` prints each `crossRefs` entry as `  > <text>` (wrapped like a modifier, indent 4) after
  the `+` lines and before the `*` note (P4).
- `buildTicketItems(tx, cfg, lineIds)` accepts dish lines and split-off extra lines (every caller
  passes the line ids of records: fire, release, HOLD tickets, slips, reprints):
  - its children read (`:171-180`) gains the child's id and kitchen names, and a left join to its
    record and that record's station name; a child with a record becomes a `crossRefs` entry on its
    dish — `crossRefText({ kind: "with", name: extraLabel(kitchenPresentationName(child), …),
    stationName }, cfg.locale)` — and is no longer pushed into `modifiersByParent`; a child without one
    stays a `+` line, by its staff name as today;
  - for each given line that is itself an extra (`parent_line_id` set; add it to the line read),
    read its dish's kitchen names and the dish record's station name, and give the extra's entry
    `crossRefs: [crossRefText({ kind: "for", name: kitchenPresentationName(dish), stationName }, cfg.locale)]`;
    its `name` is its own kitchen name, as for any line;
  - the non-null assertion "Every child's parent is in `lineById`" (`:185-189`) stays true for the
    children read (they are read BY parent id), but its comment must say so.
- Nothing else in printing changes: `planKitchenTickets` already groups records by station, so the
  Fryer's ticket carries the chips and the PASE copy lists both stations (X11); reprints
  (`readReprintParts`, `:975-1028`) already read every fired record and every held one of a printed
  held group, extras' included; slips (`printCorrectionSlips`, `:701-755`) re-read through
  `buildTicketItems`.

- [ ] **Step 1: Write the failing tests.**
  - `kitchen-ticket.test.ts`: `crossRefText`'s three wordings in English and in Spanish (`es-ES`),
    and English for an unknown locale; `formatKitchenTicket` of a burger with one modifier, one
    cross-reference and a note prints `+`, then `>`, then `*`, in that order; **Review Focus 7 (unit):**
    `arrangeTicketItems` of two burgers that differ only in `crossRefs` (`["with CHIPS from Fryer"]`
    and `["with CHIPS from Cocina"]`), and of a burger with a cross-reference beside one without,
    returns two entries each time under `combined`; two identical ones still merge.
  - `kitchen-print.test.ts`, in the existing "ordering modifiers on the kitchen ticket" describe
    (`:1039`; re-title it — it no longer is "parent-only ticket_items"), through the fixture:
    - **Review Focus 1 (paper).** A burger with chips and cheese, the till in Spanish: Grill's job
      decodes to `1 x BURG`, `+ Cheese`, `> con CHIPS de Fryer`, and no `+ Chips`; Fryer's to
      `1 x CHIPS` and `> para BURG en Grill`; the PASE job holds both stations' lines with their
      cross-references; no job contains `Patatas fritas` or `Hamburguesa clásica`.
    - **Review Focus 2 (paper).** A burger with cheese only: `+ Cheese`, no `>` line, no Fryer job.
    - **Review Focus 9 (paper).** A water with chips: Fryer's job reads `> para AGUA, sin
      preparación`; no Grill job. (Without the change: no `>` line.)
    - **Review Focus 7 (integration).** Send burger 1 with chips; close the Fryer by hand with Kitchen
      as its fallback (3b); send burger 2 with chips; `reprintOrderTickets`: the Grill's reprint has
      two burger lines, one `> con CHIPS de Fryer` and one `> con CHIPS de Kitchen`. (Without
      `entryKey`'s widening: one `2 x BURG` line under the first cross-reference — the venue's
      grouping defaults to `combined`, `packages/venue-service/src/kitchen-notices.ts:308-315`.)
    - A VOID slip of the burger (Task 5's path) prints its cross-reference; the Fryer's VOID slip of
      the chips prints `> para BURG en Grill`.
    - The HOLD ticket of a held group with a burger and chips prints the chips once at the Fryer and
      not as `+ Chips` at the Grill.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-print.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those and `pnpm --filter @waitron/server exec vitest run src/order-groups.test.ts src/adjustments-extra-cancel.test.ts src/till-api.reprint.test.ts src/print-problems.test.ts src/kitchen-print.concurrency.test.ts`
  and the `split-off-extras.*.test.ts` files. Expected: PASS. Then print one for real if a printer is
  reachable, or decode the bytes of the Review Focus 1 job and read them, and say which you did.
- [ ] **Step 5: Commit** — `git commit -s -m "Kitchen tickets: a split-off extra prints once, at its own station, and the dish's and the extra's lines each name the other's station; lines that name different stations never merge"`

---

### Task 11: The till's bill view no longer assumes an extra has no kitchen state

**Files:**
- Modify: `apps/server/src/working-order.ts` — `TabLine.firedAt`/`state` docs (`:2643-2647`, "Null
  when the line has no ticket item (always, on a child)")
- Modify: `apps/till/src/api/client.ts` — `TabLine.state` doc (`:1652-1656`, "A child modifier line
  never has one")
- Modify: `apps/till/src/state/adjust-target.ts` — `lineAdjustTarget` (`:77-106`)
- Modify: `apps/till/src/screens/till-table-order-screen.ts` — `#canCancel` (`:1695-1706`) and its
  comment "An extra has no ticket item of its own, so it goes as its dish does" (`:1697`)
- Test: `apps/server/src/tabs.test.ts` (beside `:685`, "carries state: null for an extra's child line,
  which has no ticket item of its own"), `apps/till/src/state/adjust-target.test.ts`,
  `apps/till/src/state/held-groups.test.ts`, `apps/till/src/screens/till-table-order-screen.test.ts`

**What actually reads a child's state** (checked by reading every till use of `firedAt`/`state` on a
tab line, `grep -rn 'firedAt\|line\.state' apps/till/src`): `sendsAlone`
(`apps/till/src/state/held-groups.ts:14-24`) is NOT affected — it already requires `parentLineNo` to
be null (`:19`) before it reads `state`; `#canChange`, `#canRecall` and `#lineCourse` leave children
out (`#isChild`); `basket.ts:425`'s "sent" is already true for a sent extra, which its dish's send
stamps. What changes:
- `lineAdjustTarget`: for an extra, `started` is the extra's own when it has a record (more
  truthful: the dialog's "already started" wording, `adjustment-dialog.ts:447-449`, then applies to
  chips already frying); **for a dish (review Minor 11), `started` is the dish's OR any of its
  split-off extras'** — the function already collects the dish's extras (`const extras = …`, `:88`),
  so the cancel dialog warns when only the chips are frying, matching the started VOID the server
  then prints (P2). `kitchenTold` becomes "the dish fired OR this extra's own record fired" (`:104`),
  so a split-off extra of a no-preparation dish (X5) is marked told.
- `#canCancel(child)`: a child WITH a record (`state !== null`) is judged by its own record, as a dish
  is (`:1703-1705`); one without still follows its dish.
- Both docs say: a following extra has no record (state null); a split-off extra carries its own.

- [ ] **Step 1: Write the failing tests:** `tabs.test.ts` — keep `:685`'s case for an unclaimed
  extra, and add: a split-off chips line reads `firedAt` and `state` from its own record.
  `adjust-target.test.ts` — an extra of a no-preparation dish whose own record fired is `kitchenTold`
  (Review Focus 9; without the change: not told); a started split-off extra is `started`; a dish
  whose only started work is its split-off extra is `started` (without the change: `false`). `held-groups.test.ts` — `sendsAlone` answers false for a
  child line with `firedAt: null` and `state: "queued"` (pins that it never offers Send alone on an
  extra). `till-table-order-screen.test.ts` — a split-off extra whose own record is queued offers
  Cancel even when its dish (no preparation, no group) would not.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/tabs.test.ts` and, after
  checking memory, `pnpm --filter @waitron/till exec vitest run src/state/adjust-target.test.ts src/state/held-groups.test.ts src/screens/till-table-order-screen.test.ts`.
  Expected: FAIL (the adjust-target and cancel cases; the `sendsAlone` case passes already, which is
  what it pins).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "Till: an extra made at its own station is cancelled and described by its own kitchen state; the line read no longer promises an extra never has one"`

---

### Task 12: The tester says where each chosen extra is made

**Files:**
- Modify: `packages/venue-service/src/routing-store.ts` — 3a's `explainRoute` (3b gave it `when`)
- Modify: `packages/venue-service/src/routes.ts` — 3a's `GET /management-api/venue-service/routing/explain`
- Modify: `packages/venue-service/src/dashboard/{routing-client,prep-stations-screen,strings}.ts` and
  `prep-stations-screen.test.ts`, `.a11y.test.ts`; `routing-store.test.ts`, `routes.test.ts`

**Interfaces:**

```ts
export interface ExtraExplanation {
  productId: string;
  outcome: ExtraMakerOutcome;
  decidedBy: RoutingDecision | null;
  fallbacks: FallbackStep[];
}
// explainRoute GAINS a last parameter `extraProductIds: readonly string[] = []`, and
// RouteExplanation GAINS `extras: ExtraExplanation[]` (in the order asked), computed with
// chooseExtraMaker against the dish's final station (null when the dish needs no preparation), and
// `extrasWaitOnDish: boolean`. When the dish has no route at all — no replacement (3b) or no
// station (3a) — `extras` is empty and `extrasWaitOnDish` is true: such a send is refused, or the
// dish and its extras are set aside, or the waiter chooses where the dish is made, so the extras'
// answer depends on a station the tester cannot know (review Minor 7). Its `stations` lists every
// station the extras' answers name too.
```

The route accepts repeated `extraId` query parameters (`?productId=…&extraId=a&extraId=b`); an
unknown one is refused as an unknown product is (3a's `route.subject_not_found { subject: "product" }`).

**Screen** (3a's "Where is this made?" card): an **Extras chosen** field — a `wt-combobox` of every
product (P5) that adds the pick as a removable chip — and, under the dish's answer, one line per
extra:
- made: "Chips: made at Fryer, because Fryer claims Extras › Sides" / "… because of the exception
  '<sentence>'" (3a's sentence), with 3b's fallback-step sentences before it when it passed closed
  stations;
- `no_rule`: "Cheese: follows the dish — no exception or claim covers it";
- `no_preparation`: "Sauce: follows the dish — what covers it needs no preparation, so it stays on
  the dish's ticket";
- `no_replacement`: "Chips: follows the dish — Fryer is closed and nothing can replace it";
- `same_station`: "Chips: follows the dish — it is made at Grill, where the dish is";
- `extrasWaitOnDish`: one line, "Extras: decided once the dish has a station to go to".
Spanish for each in `strings.ts`. The folder path is written as 3a's screen writes paths.

- [ ] **Step 1: Write the failing tests.** Store: with Fryer claiming Extras › Sides, `explainRoute`
  for a burger with `[chips, cheese]` gives `made` at Fryer with the claim, and `follows_dish /
  no_rule`; with the burger's claimed station closed by hand with no fallback, `extras` is empty and
  `extrasWaitOnDish` is true (without that rule: chips read `made` at Fryer, as if the burger needed
  no preparation). Route: two `extraId` parameters reach the store; an unknown one → 404 with
  `route.subject_not_found` (or the status 3a's map gives it). Screen: each of the six sentences;
  adding and removing a chip re-asks with the right `extraId`s; both languages.
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts src/routes.test.ts`
  and, after checking memory, `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those and the screen's a11y test (the new states, both themes). Expected: PASS.
  Look at it with the dev stack at desktop and phone width, both themes (the demo needs the extras
  list Task 9's Step 4 created, or one made the same way).
- [ ] **Step 5: Commit** — `git commit -s -m "Prep stations tester: pick the extras chosen, and it says whether each follows the dish or is made elsewhere, and why"`

---

### Task 13: The documents catch up, and the claims this slice retires go

**Files:**
- Modify: `docs/backlog.md` — the design entry (`:207-218`): slice 3c-2 built (its PR number when it
  lands); NEW entries: "The till's Current orders shows no kitchen progress for an extra made at
  another station" (P6, `readCurrentOrders`, `apps/server/src/order-groups.ts`); "On the kitchen
  screen a following extra reads its customer name while paper prints its staff name, and a
  split-off extra's cross-reference reads kitchen names" (below).
- Modify: `docs/developers/products.md` — the surfaces table (`:150-163`): the kitchen ticket row
  (`:156`) and the kitchen display row (`:157`) say what an extra reads — on paper a following extra's
  `+` line reads its frozen STAFF name (`buildTicketItems`, `apps/server/src/kitchen-print.ts`), on the
  screens its frozen CUSTOMER `descriptions` (`readQueueSubItems`, `apps/server/src/working-order.ts`),
  and a cross-reference on either reads KITCHEN names. Then the sentence "A cook sees the same name
  whether the order arrives on paper or on a screen" (`:169-170`) is true of dishes only: narrow it to
  dishes and options answers and point at the extras rows. (Checked by reading: `kitchen-print.ts:176`
  selects the child's `name`; `working-order.ts:4949` selects its `descriptions`.)
- Modify: the design spec — a dated note under §5.8: "_2026-10-01 (slice 3c-2): the full rule runs for
  an extra; matching nothing, or the default, means it follows its dish; 'No preparation' keeps it on
  the dish's ticket; a closed station with no replacement leaves it with its dish, silently; it splits
  off only to a station other than its dish's. [Plan](../plans/2026-10-01-split-off-extras-slice-3c2.md)._"
  and one under §5.10's first bullet for the wording and the `> ` mark.
- Read whole, as the topic file for extras (CLAUDE.md §1, "the PATH SET matters"):
  `docs/developers/modifiers.md` — it states kitchen-surface facts about extras (an extras pick
  "becomes its own CHILD line", `:185-190`; the fields "a CHILD LINE uses on the kitchen and expo
  screens", `:368-375`). Add what a split-off extra changes: it gets its own kitchen record at its
  own station, its "+" line on the dish becomes a cross-reference that keeps its allergen and diet
  marks, and paper prints `> ` lines.
- Modify: whatever the sweep below finds.

**The sweep** (CLAUDE.md §1: a behaviour change retires every receipt about the old behaviour,
wherever it lives — not only beside the code the diff touched):

```sh
grep -rn "never has a kitchen item\|no ticket item of its own\|never its own ticket item\|gets no ticket item\|has no kitchen item of its own\|always, on a child\|line never has one\|parent-only ticket_items\|never station-resolves a child\|extras line never\|an extra follows its dish\|same name whether the order arrives" \
  CLAUDE.md docs/developers docs/superpowers/specs apps packages --include='*.ts' --include='*.md' \
  | grep -v node_modules
```

Then a second sweep for phrases that wrap across lines, which `grep` cannot see (review Minor 9; for
example `removeFromLine`'s "An extra, which has no / kitchen item of its own", `WO:1936-1937`):

```sh
git ls-files -- CLAUDE.md docs/developers docs/superpowers/specs apps packages | grep -E '\.(ts|md)$' \
  | xargs perl -0777 -ne 'my $w = qr{[\s*/]+}; while (/(no${w}(?:kitchen|ticket)${w}item${w}of${w}its${w}own|never${w}(?:has${w}a${w}kitchen|its${w}own${w}ticket)|only${w}dishes${w}have|extras?${w}(?:line|child)${w}never)/g) { my $l = 1 + (substr($_,0,$-[0]) =~ tr/\n//); (my $m=$1) =~ s/\s+/ /g; print "$ARGV:$l: $m\n" }'
```

(`[\s*/]+` lets a phrase run across a comment's line break and its `*`. Run 2026-10-01 on `main`
`38612da08`, it printed nine hits — the eight below at `:340`, `:685`, `:3449`, `:1146`, `:4851`,
`client.ts:1068`, `till-table-order-screen.test.ts:1789`, `till-table-order-screen.ts:1697`, plus
`working-order.ts:1936`, the wrapped one; with `\s+` in place of `[\s*/]+` it missed `:1936`, which
is the control.)

And read, whole, every file this branch changed for a sentence the two patterns miss
(`git diff --name-only origin/main...HEAD`): a pattern finds only the wordings someone thought of.

Known hits on today's `main` (re-run it; 3a and 3b may have moved some): `apps/server/src/order-groups.ts:340`
(Task 8), `apps/server/src/working-order.ts:1146` (Task 3), `:4851` (Task 9), `:2646` (Task 11),
`apps/server/src/tabs.test.ts:685` and `apps/server/src/working-order.test.ts:3449` (true for an
unclaimed extra: reword to say so), `apps/till/src/api/client.ts:1068` (Task 9), `:1654` (Task 11),
`apps/till/src/screens/till-table-order-screen.ts:1697` (Task 11),
`apps/till/src/screens/till-table-order-screen.test.ts:1789` (reword as for `tabs.test.ts`), and,
from the first sweep only, `apps/server/src/adjustments-apply.ts:223` ("an extra follows its dish",
about quantities: still true, leave it), `apps/server/src/kitchen-print.test.ts:1039` and `:1182`
(Tasks 3 and 10 re-title them) and `docs/developers/products.md:169` (this task). The list is not
exhaustive: the sweeps are. Each
hit is either fixed or, where it describes an extra that follows its dish, narrowed to say so. Cut
comments that only restate the code while touching these files (owner decision 2026-09-23), and
prefer deleting to rewording.

- [ ] **Step 1:** Run the sweep; fix each hit.
- [ ] **Step 2:** The backlog, products and design edits.
- [ ] **Step 3:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (it checks only that a
  backticked path exists, not that a sentence is true). Expected: PASS. `docs/` is ignored by
  prettier, so `prettier --check` over it proves nothing (CLAUDE.md §2); read the rendered tables
  instead.
- [ ] **Step 4: Commit** — `git commit -s -m "Documents: extras made at their own station — the backlog, the names each kitchen surface reads, the design's dated notes, and the comments that said an extra never has a kitchen record"`

---

## Landing

Lands when green (the review wave clean and required CI passing), like 3b. No venue reset is
expected: the one migration adds an index. If the generated SQL rebuilds a table (Task 2, Step 3),
that is a STOP and the landing rule becomes needs-owner-review.

## Self-review notes

- Spec coverage: §5.8 — X1/X2 (Tasks 1, 3), X3, X4, X5, X6 (Tasks 1, 3), "a split-off extra stays
  linked to its dish" (the line link, Tasks 3–8), "plain options follow the dish" (unchanged: options
  are on the dish line, not rows). §5.10 first bullet — Tasks 9, 10 (X10–X12, X14). §5.12 "the extras
  chosen" — Task 12 (X9). X7 — Tasks 4, 8. X8 — Tasks 5, 6, 7. X13 — Task 3, conditional on 3c-1.
  X14 — Tasks 9, 10, 11.
- Every row of the research's list A.4 is in the table under File structure, with a task or a reason.
  Three ratings there differ from the research: `heldNoRouteLines` (research "breaks"; unaffected,
  because `stampSent` stamps a dish's extras with it), `listTablesWithState` (research "stale";
  unaffected, the extra is a separate thing to fetch), and `sendsAlone` (research "breaks (till)";
  unaffected, it checks `parentLineNo` first, `held-groups.ts:19`). Each is read, not run; Task 11
  pins `sendsAlone` with a test.
- The seat change (P1) keeps 3b's `MakerOutcome` and `resolveMakers`' signature: `resolveMakers` and
  `resolveExtraMakers` are wrappers over `routingAt`, so 3a's and 3b's other callers do not change;
  only `fireLines`, the release commands and the edit path open a snapshot themselves.
- 3c-3 builds on this: its M23 ("a dish with split-off extras moves alone; the extra's
  cross-reference names the dish's new station at once") holds because Tasks 9 and 10 read the
  dish's station live, never a copy.
- Codes: none new.
- Packages touched: `module` (types), `venue-service`, `db` (one index, mutation-tested), `server`,
  `till`. Browser suites: `till`, `venue-service`'s browser project.
- Measured: the three query plans, on the SQL drizzle emits from the real schema objects, with and
  without the index (Task 2's receipt), and the multi-line sweep with its control (Task 13). Not
  measured: the index's generated SQL, and the interplay with 3a's, 3b's and 3c-1's code, which is
  read from their plans. "One routing load per send, release and edit" is pinned by tests (Tasks 3,
  4, 6), not timed.
- The no-preparation class (a dish with no record of its own whose extra has one) was walked path by
  path after review 1: send (Task 3), release by course, group and named send plus the release-time
  decision and serving and the course change (Task 4), recall and cancel (Task 5), every edit branch
  (Task 6), split and a whole move off the bill (Task 7), group moves and joins (Task 8), screens and
  paper (Tasks 9, 10), the till (Task 11), the tester (Task 12, which never treats a dish with no
  route as one needing no preparation). Review Focus 9 lists the tests.

## Review 1 applied (2026-10-01)

Every finding of `plan-3c2-review.md` was applied; none was rejected.

- **C1** — Task 6: no unguarded `parent.ticket!` in the change, drop, `reduceLine` and removed branches;
  X5 tests for change, drop, remove and add.
- **I1** — Task 2: the control asserts what the engine does (no index named, and a `SCAN` of
  `ticket_items` for the records read, of `working_order_lines` for the other two), re-measured and
  recorded as a receipt; P7 cites it.
- **I2** — Task 4: `finishRelease` decides the released no-preparation dishes' extras (the reviewer's
  option b; why no better point exists is stated there), with a course-held Water test; Task 6's
  added-child rule now names what it leaves to the release.
- **I3** — Task 4's named-send test uses a course-held burger in no group, and says what fails without
  the change.
- **I4** — Task 8: one `HeldChange` per record, with the extra's line and quantity; Task 6's raise and
  Task 8's move and join tests use two chips per burger.
- **I5** — Task 4: `setLineCourse`'s fired check covers the extras; X5 test.
- **Ruling 1** — the no-preparation class walk (above), Review Focus 9, and the new rows for
  `finishRelease`, serving, `markCollected` and `groupArrivingDishes`; Task 3 releases a held extra
  record when its dish fires on a second pass (Minor 2), and Task 7 widens the held-line refusal.
- **Minor 1** — Task 3 places the call before the early return at `WO:1318`. **2** — Task 3's
  second-pass test asserts the chips' `fired_at` and the rule chosen. **3** — Tasks 9 and 12: create an
  extras list in the demo first. **4** — slice 2 paragraph. **5** — the fixture moves `addExtras` and
  `fireNewOrder` out of `kitchen-print.test.ts`. **6** — Task 7 names `split-bill.test.ts`,
  `transfer-lines.test.ts`, `party-bill-actions.test.ts`. **7** — Task 12's `extrasWaitOnDish`.
  **8** — Task 3 kept the second rules read with a measurement and a stop bound (superseded by review
  2: one snapshot, P1). **9** — Task 13 reads `modifiers.md` whole and adds a measured multi-line sweep. **10** —
  Task 8 counts an extra by its dish's plates. **11** — Task 11's `started` for a dish includes its
  extras. **12** — Global Constraints: regenerate on a migration number collision. **13** — branch and
  committed path; the `markCollected` row. **14** — no change asked.
- Every changed or added test now says which assertion fails if the behaviour is deleted, or says it
  passes already and what it pins.


## Review 2 applied (2026-10-01)

Every finding of `plan-3c2-recheck.md` was applied; none was rejected.

- **I1** — Task 3 spells out the end of `fireLines`: stamp, insert dish records (if any) in the `try`,
  release held extras of dishes fired now, `insertSplitExtras`, then ONE print over all three; the
  early return at `WO:1318` is deleted. The Water-only send asserts the record AND one Fryer print
  job naming `CHIPS`.
- **I2** — Task 2's test takes each query's SQL from `.toSQL()` of the query as the code builds it,
  never hand-written SQL, and asserts only "with the index: names it (and `MULTI-INDEX OR` for the
  first two); without: does not name it and has a `SCAN ` line". Re-measured on drizzle-emitted SQL
  from the real schema objects (command and output in the receipt): with the `order by` the records
  read scans `working_order_lines`, not `ticket_items`. P7 corrected.
- **I3** — Task 6: `planHeldCorrections` decides "held" per record and corrects each record at its own
  station and quantity; the kept child's record update sits outside the dish-record branch; tests for
  a held Water with two chips in a printed held group (raise: +2 at Fryer and a record of 4; remove:
  HOLD CANCELLED at Fryer; note change: −2/+2).
- **I4 (ruling 1)** — P1 rewritten: one seat method `routingAt(tx, cfg, at)` loads the moment and the
  rules once and answers dishes (`makers`) and extras (`extraMakers`); `resolveMakers` and
  `resolveExtraMakers` are wrappers. `fireLines`, every release command (passed down through
  `fireHeldGroupsOfCourse`, `releaseGroup`, `fireOrderLines`, `releaseHeld`, `heldNoRouteLines`,
  `finishRelease`) and `applyLineEdits` open one lazy snapshot at their one clock reading. The
  invented 5 ms stop and the false "adds no lock wait" are gone. Pinned by spy tests counting
  `routingAt` (once) and the wrappers (never) per send, release and edit (Tasks 3, 4, 6), and a
  venue-service test that a resolver answers from the snapshot it opened with (Task 1).
- **Minor 1** — `insertSplitExtras` is insert-only; "release the extra with its dish" lives in
  `fireLines` alone (Task 3, step 3); Task 4's Water group test now fails when `fireOrderLines`'
  widened scope is deleted, and says why; Task 6 treats a dish with no record of its own as held when
  any of its extras' records is held, with a test after a server recall.
- **Minor 2** — line numbers fixed: `setupVenue` `:96`, `fireNewOrder` `:234`, `addExtras` `:311`.
- **Minor 3** — `inmutabilidad` restored to the migration-collision list beside the upgrade test.
- **Minor 4** — the old script's line count (15) is stated with the old receipt it belongs to.
- **Minor 5** — `heldNoRouteLines` returns `{ zoneId, lines: { id, courseId }[] }` for
  `finishRelease`.
- **Minor 6** — Task 13's known-hits list adds the four the first sweep also prints, and says the
  sweeps, not the list, are exhaustive.


## Review 3 applied (2026-10-01)

Every finding of `plan-3c2-recheck2.md` was applied; none was rejected.

- **I1** — `placeGroups` (`order-groups.ts:185-196`) is the one non-test caller that calls `fireLines`
  in a loop (every caller listed, Task 3); it opens one `routingOnce` before the loop and passes it to
  each call. Task 3's Files gain `placeGroups`; its spy test gains a two-group (fire + hold) table
  submission expecting one `routingAt`. P1 and Task 3 now say "per request", with the list.
- **I2** — the fixture gains Onion rings (Extras › Sides, three names, on Water's list); the recall
  test adds them and names the failing assertion: their new record's `fired_at` (and no new Fryer
  job).
- **Minor 1** — P1's caller list: `findDeadEnds` and 3a's demo-seed test use the wrapper; the preview
  and products column call `chooseMaker` directly.
- **Minor 2** — both questions refuse an unknown zone (`service_zone.not_found`); a Task 1 case pins
  `extraMakers`.
- **Minor 3** — `insertSplitExtras` calls the opener only when some extra line holds no record.
- **Minor 4** — every spy case installs (or clears) its spies after the setup.
- **The snapshot's contract is stated once, in Task 1** ("The routing snapshot — the stable contract
  other plans cite"), for 3c-3 to cite: `VENUE_SERVICE.routingAt(tx, cfg, at): Promise<MakerResolver>`,
  core's `routingOnce(tx, cfg, at): RoutingOnce`, `fireLines`' `routing` option, and the release
  functions' optional `routing` parameter.


## Amended 2026-10-01 (owner, after approval)

The owner corrected 3c-1 after approval: a made-here item is never held — it is made at the moment
it is sent, and the till lists it in "Make now" (3c-1's T12 and T13, and its own "Amended
2026-10-01" note, in `docs/superpowers/plans/2026-10-01-rest-of-order-made-here-slice-3c1.md`).
This plan copies a dish's hold to its split-off extras (X7), so it gains the same exception: a
split-off extra whose final station the sending device makes here is recorded made here, fired and
`ready` at the send's one clock reading, even when its dish is held, and it joins "Make now" like
any made-here item. Changed: the Architecture paragraph, X7, X13, Task 3's X13 bullet (the check
lives in `insertSplitExtras`, so a send, a release and an edit all apply it, and it fills 3c-1's
`cfg.madeHereSink`), Task 3's doc-comment bullet, and a new Task 3 test (a held burger with chips
the bar till makes here: chips made at the send, burger held, the later release touching only the
burger). The other places that copy or act on an extra's hold need no change, because they act
only on held records and a made-here extra never has one: Task 3's step 3 (release with the dish),
Task 4's releases (they stamp records with no fire time), Task 6's per-record held corrections
(they correct unfired records only), and Task 8's group Ready and Away (Ready bumps only fired
records not yet `ready`, `order-groups.ts:287-288`, so a made-here record, born `ready`, is untouched; Away stamps it like any
ready record). 3c-1 does NOT change `readGroups` after all (its latest amendment), so a made-here
record counts there as a ready dish; Task 8 relies only on that unchanged count
(`order-groups.ts:832-848`). Added after
the cross-plan check (`made-here-amend-check.md`, M5): X14 names 3c-1's "Make now" read,
`readMadeHereItems`, among the readers that leave a split-off extra out of its dish's extras
(whichever plan lands second applies it, with a test); and X13 and Task 3 say release routes carry
no device (`apps/server/src/till-api.ts:783`, `:1826`, `:2063`, read at `dcc6a3adc`), so an extra
first decided at a release is never made here and gets its station's ticket, as 3c-1's T8 rules.
3c-1's T12 and T13 were read in the amended 3c-1 plan in the
main checkout on 2026-10-01 (at `e5ba24d55` with that file modified, not yet committed).


2026-10-08: A333 seeds optional sides on Pollo asado. The demo-extras limitation stated above
is superseded; see [products.md](../../products.md) for the current example.
