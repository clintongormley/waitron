# A757 slice 6 — Item counts by state: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (design §11 item 6: "a till read path"). Two more reasons the full wave is
right here: Task 3 puts a fact about a tab's contents on a route whose rows the source department
keeps seeing after another department accepted the tab, and after the tab moved to a zone the
viewer may not work in — two visibility boundaries (`apps/server/src/department-transfer-api.ts:189`;
`/sent` applies no zone filter, `packages/venue-service/src/department-transfers.ts:612-648`); and
the wire shape of two till lists changes. So every task gets its per-task review, and
`/finish-branch` runs the full wave with two Codex angles. **No migration**: no task touches
`packages/db`, a schema or a `drizzle` folder. **Nothing fiscal.** **No `packages/*` change**: the
counts are read in `apps/server` and drawn in `apps/till`; a task that finds it needs a package
change stops and reports. **One pull request.** Branch `feat/a757-6-item-counts-by-state`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-6-item-counts-by-state`, from `main`
at `67584cff1`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** a row in the counter's Parked orders (Held orders), its Waiting orders, and the Transfers
dialog says what the order holds and where it stands: "#12 T4 — 6 items · 2 held · 2 ready ·
€58.20", in place of today's unlabelled line count "5 · €58.20".

**Architecture:** one new server reader, `readOrderStateCounts(tx, orderIds)`
(`apps/server/src/order-state-counts.ts`), reads every line of every listed order in one statement
and every dish of the listed bills' open saved drafts in a second, and sorts each dish's units into
not sent, held, waiting and ready; whatever is left is served. `listHeldOrders` and
`listCounterWaiting` send its result as `counts`, replacing the held list's `itemCount`; the three
Transfers routes add it to the rows whose tab the viewer may look at. The till draws the counts as
a line of chips with one shared helper, `apps/till/src/widgets/order-counts.ts`.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Lit, Vitest (Node for `apps/server`, real
Chromium for `apps/till`).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` — "Decided" Q19 (lines
50-51), §1.2 and §1.3 (the dish signals and A773-2's Requested), §4 row 9 (`:255`), §5.3 (lines
400-414), §11 item 6 (lines 639-641). Picture `docs/backlog/mockups/a757-table-states/05-order-rows.png`.
Backlog detail `docs/backlog/till.md:1354-1357`.

## Driver rulings (plan review)

- **C1:** a line counts as one unless it is sold by the unit in `takesExtras`'s sense
  (`apps/server/src/working-order.ts:455-458`), the line's frozen `unit_precision` preferred over
  the unit's; the deferred grams backlog entry goes, and a new one records the floor's chips.
- **I1:** a sent or per-tab Transfers row carries counts only when the department matches AND the
  tab's zone is in the viewer's zones, read once for all rows on the route's own transaction;
  incoming rows stay as planned.
- **I3:** follow the design's own word — Not sent is a saved draft not yet sent (§1.2 `:130`, §4
  row 9 `:255`), so a bill's saved New order panel dishes count as unsent and in `ordered`; the
  row's money total stays the bill's own lines.
- **I4:** a made-here dish in a held group stays ready (the plan's default); owner point 10 names
  the floor's "Held 1" disagreement.
- **Task 5 fixtures:** the server always sends `counts`, so the till adds no fallback for a row
  without it; Task 5 runs every till test file that mounts the counter or its lists, so a fixture
  lacking `counts` fails loudly.
- **Naming:** the wire field is `counts.ordered`, not `counts.items` (the row already has `items:
  OrderPreviewItem[]`); the text still reads "6 items".
- Every other finding of the plan review was applied as the review wrote it.

## Sources the plan answers to (quoted)

- §5.3: "**Items** = what was ordered: a counted dish by its quantity, a weighed dish as one, extras
  not counted." "Then each state with at least one item, in the order a dish moves: not sent, held
  (including requested), waiting (in the kitchen), ready. Served items are the rest and are not
  listed." "In **Held orders**, **Waiting** and **Transfers**. Not on the **Pass** … and not in the
  **payment panel**." "A765 adds the table's name to the same rows and builds to this."
- §1.2 (`:130`): "`unsent_draft` | a draft not sent yet". §4 row 9 (`:255`): "**Not sent** (a draft
  not sent)".
- §11 item 6: "the server sends each order's counts by state with the held-orders summary and the
  Waiting and Transfers lists; the till rows show them."
- Picture 05, "Decided · Held orders" (read 2026-10-21): row one "#12 T4" with "€58.20" at the
  right, then chips "6 items" (plain border), "2 held" (grey border), "2 ready" (green border); row
  two "#14 Barra", "€9.80", chips "3 items", "3 waiting" (amber border). The "Today" side's
  "Cocina: 2 ready" chip is not on the decided rows. No icons on the count chips.

## What the code does today (each read 2026-10-21 at `67584cff1`)

**The three lists, end to end.**

| List (till words) | Server function | Route | Wire type in the till | Widget drawing the row |
|---|---|---|---|---|
| Parked orders (`held.title`, `apps/till/src/i18n/strings.ts:500`) — the design's "Held orders" | `listHeldOrders`, `apps/server/src/working-order.ts:4775-4834` | `GET /api/working-orders`, `apps/server/src/till-api.ts:1863-1869`, filtered by `visibleOrders` (`apps/server/src/zone-access.ts:109-122`) | `HeldOrderSummary`, `apps/till/src/api/client.ts:1315-1337` | `till-held-orders`, `apps/till/src/widgets/held-orders.ts:231-305`; mounted by `apps/till/src/screens/till-counter-screen.ts:357-361` |
| Waiting orders (`waiting.title`, `strings.ts:505`; the bar tab `shell.waiting`, `strings.ts:310`) | `listCounterWaiting`, `working-order.ts:6920-7038` (counter orders, no party, `placed`, or `settled` with a kitchen item and not handed over) | `GET /api/orders/counter-waiting`, `till-api.ts:2223-2229`, same `visibleOrders` filter | `CounterWaitingOrder`, `client.ts:1284-1308` | `till-counter-waiting`, `apps/till/src/widgets/counter-waiting.ts:130-221`; mounted by `till-counter-screen.ts:364-368` |
| Transfers (`department_transfer.short`, `strings.ts:261`) | rows from `listIncomingDepartmentTransfers` / `listDepartmentSentTransfers` / `listSentDepartmentTransfers` in `packages/venue-service/src/department-transfers.ts`, each passed through `summarizeTransfers` (`:504-561`) | `GET /api/department-transfers/incoming` (`apps/server/src/department-transfer-api.ts:162-177`), `GET /api/working-orders/:id/department-transfers` (`:178-194`), `GET /api/department-transfers/sent` (`:195-206`); the till polls every 15 s (`apps/till/src/state/department-transfer-monitor.ts:84`) | `DepartmentTransfer`, `client.ts:2408-2429` | `till-department-transfers`, `#summary`, `apps/till/src/widgets/department-transfers.ts:465-485`, drawn for incoming rows at `:711` and sent rows at `:731`; mounted by `apps/till/src/till-app.ts:18352` |

Today Parked orders' row reads `${order.itemCount} · total` (`held-orders.ts:232`), where
`itemCount` is `count(working_order_lines.id)` over every line, extras' child lines included
(`working-order.ts:4788`). Waiting's row shows its state word and its total, no count
(`counter-waiting.ts:148-149`). A Transfers row shows the status, "Tab {number} — label", the two
departments, the time and the reason, and no count and no total (`department-transfers.ts:470-484`).

**Who may see a Transfers row's tab.** The per-tab route refuses `service_zone.not_allowed` when
the tab is in the viewer's department but outside its zones (`checkZones`,
`department-transfer-api.ts:187-188`; pinned at `department-transfer-api.test.ts:989-999`, which
retargets the tab to `f.hidden`, a zone of the source's department its profile does not list,
`:112`, `:123-127`). `/sent` applies no zone filter: the route calls
`listDepartmentSentTransfers` (`department-transfer-api.ts:195-206`), which selects by source
department and status only (`department-transfers.ts:612-648`). The helpers are `readZoneScope`
(`zone-access.ts:81-89`), `inScope` (`:91-94`, a zone-less order is in scope) and
`VENUE_SERVICE.findOrderZones`, which `visibleOrders` calls once for a whole list (`:109-122`).

**How a dish's state is known today.** A dish is a `working_order_lines` row with
`parent_line_id` null; an extra is a child row pointing at it
(`packages/db/src/schema/orders.ts:199-200`). Each line has at most one kitchen item:
`ticket_items` is unique on `working_order_line_id` (`packages/db/src/schema/ticket-items.ts:82`).

| State | What says so in the code today |
|---|---|
| Not sent | no kitchen item and no `sent_at` (`unsentDishLines`, `working-order.ts:1859-1878`); a dish recalled into a draft is "no longer sent work" (`isRecalledDish`, `apps/server/src/draft-source.ts:33-46`); a dish saved in a bill's New order panel is an `order_draft_lines` row of an `order_drafts` row in state `open` (below) |
| Held | its group is `held`, or its kitchen item has `fired_at` null ("NULL = HELD", `ticket-items.ts:64-65`; `isReleased`, `working-order.ts:3388-3400`); a dish whose separately routed extra still has `fired_at` null is held too, even when the dish itself is made here — `released` is `isReleased(line) && !heldExtras.has(line.id)` (`heldExtras`, `apps/server/src/order-groups.ts:1763-1770`, used at `:1857`) |
| Requested | **not stored on `main`.** #1944's commit (`509e8d42a`) says it leaves "requested-state storage and pass-release work to the later A773-2 slices"; `git grep -n requested -- apps/server/src/order-groups.ts apps/server/src/table-signals.ts packages/db/src/schema/` finds only bills, refunds, drawer opens, invoice downloads and reprints. A773-2's plan stores it as `ticket_items.requested_at` with `fired_at` still null: "Held has both timestamps null; Requested has request time and null fired time" (`docs/superpowers/plans/2026-10-19-a773-2-firing-and-pass.md:88`) |
| Waiting | fired (`fired_at` set), not made here, `state` `queued` or `preparing` (`ticketState`, `ticket-items.ts:24`; the floor's kitchen lines, `apps/server/src/table-signals.ts:75-82`) |
| Ready | `state = 'ready'`; a made-here item is "fired and `ready` from the moment it is recorded: it is never held" (`ticket-items.ts:28-31`); a dish is ready only when every kitchen part of it is (`readyAt`, `order-groups.ts:1839-1842`) |
| Served | `served_at` set "only once the whole line is served; `served_quantity` counts a part served before that" (`orders.ts:193-195`); food cancelled while its charge stays is `line_service_cancellations.quantity` (`serviceQuantities`, `apps/server/src/line-service-state.ts:20-31`) |

**Saved drafts (A773-1).** A bill's New order panel is saved as an `order_drafts` row (`party_id`
not null, `bill_id`, `state` `open` / `submitted` / `discarded`; `packages/db/src/schema/order-drafts.ts:24-56`)
whose new dishes are `order_draft_lines` rows: `menu_item_id`, `variant_id`, `quantity` in
thousandths, extras as JSON, no unit (`:58-114`). A recalled dish is not an `order_draft_lines`
row: recalling inserts only an `order_draft_recalled_lines` row naming the bill's own line
(`apps/server/src/order-drafts.ts:406`), which stays on the bill and is found by `isRecalledDish`.
The floor's Not sent signal counts both kinds per bill (`readUnsentDrafts`,
`order-drafts.ts:1242-1283`, its `lineCount` at `:1259` counting rows, not units) and raises
`unsent_draft` (`table-signals.ts:234-239`). A counter order has no party, so it has no draft.

**How a line's unit is known.** A line freezes its unit's printed name and its decimal places,
`unit_name` and `unit_precision` (`orders.ts:176-177`; written from `item.product.unit.precision`,
`packages/catalogue/src/pricing.ts:224`) — not whether the unit weighs or measures. The unit itself
is `product_units` → `units` (`packages/catalogue/src/schema/units.ts:5-27,40-61`), joined with
`unitOwnerJoin` so a variant reads its parent's unit, and "A product with no row reads as Each"
(`packages/catalogue/src/variant-fallback.ts:124-131`; Each is precision 0, no hardware unit,
`packages/catalogue/src/units.ts:28-36`). `working_line_contexts` also freezes a unit id, places and
hardware unit, but no `measure` (`packages/venue-service/src/schema/service.ts:245-266`), and
`apps/server` reaches that table only through `VENUE_SERVICE` (`working-order.ts:217`, `:1028`).
New venues are seeded with `g` (0 places, scale `g`, measure), `kg` (3, `kg`, measure), `mg` (0,
`mg`, measure), `ml` (0, no scale, measure) and `l` (3, no scale, measure)
(`packages/catalogue/src/provisioning.ts:96-146`). Two rules say "sold by the unit":
`takesExtras` — "no scale, no decimal places, and not a measure"
(`apps/server/src/working-order.ts:455-458`) — and the till's `soldByTheUnit`, which does not read
`measure` (`apps/till/src/widgets/product-name.ts:85-88`).

Existing per-dish counters: the floor's ready chip counts a dish as one when its frozen
`unit_precision` is above 0, else by its fired units left to serve (`table-signals.ts:96-103`); slice 3's held count counts a dish as one when `unitPrecision`
is above 0, else `active / 1000` (`readHeldCounts`, `order-groups.ts:1536-1571`, counting at
`:1565-1569`). Neither reads the unit's scale or `measure`, so a 150 g dish (precision 0) counts
150 in both. The till's draft count says "A weighed or fractional line counts once"
(`apps/till/src/state/draft-groups.ts:14-17`) and decides it with `soldByTheUnit`
(`countsWholeUnits`, `apps/till/src/screens/till-table-order-screen.ts:214-216`).

**Quantities and fractions.** `quantity` counts thousandths (`orders.ts:178`;
`packages/shared/src/scales.ts`). Tried with a fraction: a dish of a unit with 0 decimal places
cannot hold 1.5 — pricing checks the dish quantity against its unit's places
(`packages/catalogue/src/pricing.ts:214`, `:299`), and `assertQuantityPrecision` refuses
`quantity.invalid` `{ reason: "precision" }` when the fraction has more places than allowed
(`packages/catalogue/src/unit-validation.ts:42-45`). A unit with places (`unit_precision` 1–3,
`orders.ts:254-257`) can hold 1.5, and a line whose `unit_precision` is null is checked against 3
places wherever it is changed (`working-order.ts:3239`, `:3464`). So a fraction is reachable; the
rule below counts a line whose quantity is not whole as one.

**When the lists are read again.** Parked and Waiting are read when the counter's lists are shown
(`apps/till/src/till-app.ts:4998-5010`) and after this till's own actions (`#refreshHeldOrders`,
`#refreshWaiting`, `:5029-5040`, called from `:7908`, `:8073` and others); `grep -n setInterval
apps/till/src/till-app.ts` names no timer for them. Transfers are read every 15 s and on each
transfer event (`department-transfer-monitor.ts:84`, `:155-161`). A row the till has just requested
is drawn from the request's reply until a read lists it
(`apps/till/src/widgets/department-transfers.ts:154-159`, set at `:310`). `git blame` dates
`till-app.ts:4998-5010`, `department-transfers.ts:154-159` and `department-transfer-monitor.ts:84`
to 2026-10-02 or 2026-10-07, before this branch.

## Global constraints

- **Words.** New strings, all in `apps/till/src/i18n/strings.ts`, each with its `_one` sibling as
  the file does plurals (`floor.held` / `floor.held_one`, `strings.ts:916-917`; filled by
  `countText`, `apps/till/src/i18n/t.ts:30-34`). English: `{n} items` / `1 item`, `{n} unsent` /
  `1 unsent`, `{n} held` / `1 held`, `{n} waiting` / `1 waiting`, `{n} ready` / `1 ready`. Spanish,
  each taken from a word the till already uses for the same thing: «{n} artículos» / «1 artículo»
  (`floor.unsent`, `strings.ts:2612-2613`), «{n} sin enviar» / «1 sin enviar» (`floor.unsent_mark`,
  `:2616`), «{n} en espera» / «1 en espera» (held is «en espera» everywhere, owner 2026-10-20,
  `apps/till/src/i18n/strings.test.ts:114`; `floor.held`, `strings.ts:2607-2608`), «{n} esperando» /
  «1 esperando» (`signal.wait_warm` «Esperando», `:2707`, the owner's answer on #1920), «{n} listos»
  / «1 listo» (`table.flash_ready`, `:2965-2966`). Changed help texts: `help.counter.parked_orders`,
  `help.counter.waiting_orders` and `help.more.transfers`, English and Spanish
  (`apps/till/src/i18n/help-strings.ts:13-16,39-40,57-60,83-84`). No other new words.
- **English in code.** Spanish only in `strings.ts` and `help-strings.ts`; a test of the Spanish
  screen reads `es[...]` or `helpEs[...]`, never a Spanish literal. `scripts/english-only.test.ts`
  skips `apps/*`, so review greps the diff.
- **Every colour, spacing and size reads a `--wt-*` token** (CLAUDE.md §3). Guard:
  `pnpm exec vitest run scripts/style-token-names.test.ts`.
- **Two reads for all the listed orders.** `readOrderStateCounts` runs one statement over the
  orders' lines and one over their open drafts' lines, whatever the number of orders, none for an
  empty list, each awaited in turn on the caller's transaction — never inside a loop over orders or
  lines, never in a `Promise.all` (CLAUDE.md §3). The Transfers routes read the viewer's zones and
  the tabs' zones once each for all rows.
- **Coverage 98/98/98/95** in `apps/server` and `apps/till` (CI's `test:coverage` and shard merges
  enforce it; run `pnpm --filter <pkg> test:coverage` locally only when chasing a failure).
- **Changing an existing test assertion is a stop** unless it is in "Changed checks" below. Setup
  that only follows the type — a fixture's `itemCount: 2` becoming `counts: {…}`, or a fixture
  gaining `counts` — is not an assertion change. A whole-shape assertion (`toEqual` of a row) may
  gain the `counts` key with every existing value unchanged; the pull request names each one. Each
  listed edit checks at least as much as before, and the pull request lists every one with the
  spec line that changes what it pins (owner rule 2026-10-05). Anything else that turns red is a
  stop and a report.
- **Find a bill is out of scope.** It has its own `itemCount` (`apps/server/src/find-bill-types.ts:42`,
  `apps/server/src/find-bill-bills.ts:162`, `apps/till/src/api/find-bill-types.ts:42`, drawn at
  `apps/till/src/screens/till-find-bill-screen.ts:375`); no task touches it.
- **Read the `Tests` count, never the exit status.** A Vitest run that prints no `Tests` line, or
  whose count shows the new cases skipped, proves nothing (CLAUDE.md §4). A `-t` filter selects by
  test name: every new server test in Tasks 1a–3 has "counts" in its name. Measured 2026-10-21:
  `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/counter-handover.test.ts -t "listHeldOrders|counts"`
  printed `Tests  5 passed | 290 skipped (295)` and `Test Files  1 passed | 1 skipped` —
  nothing in `counter-handover.test.ts` is selected today.
- Every commit `git commit -s`. Every task ends with its focused tests (unset `AI_AGENT` and
  `CLAUDECODE` to see console output), `pnpm --filter <pkg> typecheck` for each package it touched,
  and `pnpm exec prettier --check <changed files>` (`pnpm exec prettier --file-info <file>` for
  anything under `docs/`, which is ignored). `apps/till` runs in real Chromium: check
  `memory_pressure | grep free` first and size concurrency to it. An implementer past about 150
  tool calls with the task unfinished stops at a passing or cleanly red point, commits, and returns
  a handover (done, left, files, each check's state).

## Decisions (with receipts)

1. **The rule, one dish line at a time** (`parent_line_id` null). With `Q` its quantity, `C` its
   cancelled quantity (`line_service_cancellations.quantity`, 0 when none), `S` its served quantity:
   `active = max(0, Q − C)`; `served = active` when `served_at` is set, else `min(S, active)`;
   `left = active − served` (`serviceQuantities`, `line-service-state.ts:20-31`, plus `served_at`
   per `orders.ts:193`).
   - **Sold by the unit** is `takesExtras`'s rule (`working-order.ts:455-458`): no hardware unit, 0
     decimal places, and not a measure. Places are the line's frozen `unit_precision` when it is
     not null, else its unit's; the hardware unit and `measure` come from the unit, reached as
     `products` (on the line's `product_id`) → `product_units` (`unitOwnerJoin`) → `units`; a line
     with no product, or a product with no unit row, is Each — sold by the unit.
   - **Ordered:** 0 when `active` is 0; **1** when the line is not sold by the unit, or
     `active % 1000 ≠ 0`; else `active / 1000`. Its units still to serve: 0 when `left` is 0; 1
     for a line counted as one; else `ceil(left / 1000)`, never above its ordered count. Extras
     (child lines) add nothing.
   - **The state of the units left**, first match wins:
     1. **not sent** — the dish is recalled (`isRecalledDish`), or it has no kitchen item, no group
        and no `sent_at` (`unsentDishLines`' filter, `working-order.ts:1866-1869`, and
        `isReleased`'s last branch, `:3397-3399`);
     2. **held** — either (a) one of its extras has a kitchen item with `fired_at` null, whatever
        the dish's own item is (`heldExtras`, `order-groups.ts:1763-1770`, which overrides a
        made-here dish at `:1856-1857`); or (b) the dish's own kitchen item is not made here
        (made-here is released "even in a held group", `working-order.ts:3384-3394`) and its group
        is `held` or its own kitchen item has `fired_at` null (`isReleased`, `:3395-3398`). This is
        where Requested lands once A773-2 stores it, because Requested keeps `fired_at` null
        (A773-2 plan `:88`);
     3. **waiting** — the dish or one of its extras has a kitchen item that is not made here, has
        `fired_at` set, and is `queued` or `preparing`;
     4. **ready** — everything else: every kitchen part ready (`order-groups.ts:1839-1842`), a
        made-here dish, or a sent dish with no kitchen work at all.
   - **A saved draft's dish** (an `order_draft_lines` row of an `open` draft whose `bill_id` is the
     order): ordered and not sent, counted as above with `C`, `S` 0 and no frozen places, its unit
     reached through its menu item (`menu_items.product_id` → `products` → `unitOwnerJoin` →
     `units`; a variant reads its parent's unit, `variant-fallback.ts:124-127`). Its extras are
     JSON on the row and add nothing. A draft with no `bill_id` is on no row.
   - **A handed-over order** (`working_orders.collected_at` set; handover is "an ORDER-level fact",
     `ticket-items.ts:20-23`, and handing over writes only `collected_at`,
     `working-order.ts:6863-6865`): every unit left counts as served, so its row lists only ordered.
   The rule is written out rather than calling `isReleased`, because A773-2 says serving Requested
   "needs a separate initiation predicate" (`a773-2` plan `:69`): `isReleased`'s meaning may move
   with serving, and the count must keep Requested under held. The task's test names
   `isReleased`, `unsentDishLines` and `takesExtras` as the rules it mirrors.
2. **Not slice 3's `readHeldCounts`, but its reckoning, with one difference.** `readHeldCounts` is
   keyed by party, reads only `order_groups.state = 'held'` and only open parties
   (`order-groups.ts:1543-1564`); a bill's row needs a count per bill, including a dish held by its
   kitchen item outside any held group. The new reader keeps its arithmetic — active quantity less
   cancellations, extras not counted, recalled dishes not held (`:1559-1569`) — but decides "one"
   by the unit (Decision 1), where `readHeldCounts` reads only `unitPrecision` (`:1567`). Task 1b
   pins that for one bill holding a party's only held group, of a counted dish and a kg dish, the
   two agree; for a gram dish they differ, and Task 7 records that in the backlog.
3. **Two statements.** (a) All lines of the listed orders, parents and children, with left joins to
   `ticket_items` (on the line), `order_groups` (on `group_id`), `line_service_cancellations` (on
   the line), `products` (on `product_id`), `product_units` (`unitOwnerJoin`) and `units`, an
   inner join to `working_orders` for `collected_at`, and `isRecalledDish(tx)` selected as a
   column, as `readCurrentOrders` selects it (`order-groups.ts:1720`). (b) The dish rows of the
   listed orders' `open` drafts, with left joins to `menu_items`, `products`, `product_units` and
   `units`. `unitOwnerJoin`, `units`, `productUnits` and `menuItems` come from `@waitron/catalogue`
   (`packages/catalogue/src/index.ts:63`, `:146`), which 52 non-test `apps/server` files already
   import from (`git grep -ln 'from "@waitron/catalogue"' -- 'apps/server/src/*.ts' ':!*.test.ts'`).
   Sorting happens in TypeScript. Proved by the statement-count pattern of
   `table-signals.test.ts:686-699` and `:768-817`.
4. **The wire: `counts` replaces `itemCount`** on `HeldOrderSummary`, server and till, and is added to
   `CounterWaitingOrder`: `counts: { ordered: number; unsent: number; held: number; waiting: number;
   ready: number }`, every order present, zeros for a lineless one. `ordered`, not `items`, because
   the row already carries `items: OrderPreviewItem[]` (`working-order.ts:4676`). Replacing, not
   adding beside, because the field's meaning changes from lines to dishes. Outside test files,
   `git grep -n itemCount -- apps packages scripts` names find-bill (above), the till's draft
   helper (`apps/till/src/state/draft-groups.ts:15`, read by
   `apps/till/src/screens/till-table-order-screen.ts:2951`), a per-course count of kitchen items
   inside one function (`working-order.ts:2015,2023,2038`), and the held list:
   `working-order.ts:4687,4788,4822`, `client.ts:1321`, and the one reader `held-orders.ts:232`.
   Only the held list's hits change; test fixtures and assertions are listed under "Changed
   checks". The interface is declared twice, as `HeldOrderSummary` already is
   (`working-order.ts:4676`, `client.ts:1315`), as `OrderStateCounts` in
   `apps/server/src/order-state-counts.ts` and in `apps/till/src/api/client.ts`.
5. **Transfers: `counts` on the row, not in `summary`, and only where the viewer may see the tab.**
   The source keeps seeing a resolved row after another department accepted the tab, and that row
   "exposes no tab contents" (`department-transfer-api.ts:189`); the test pins it with
   `not.toHaveProperty("lines")` (`apps/server/src/department-transfer-api.test.ts:1881`) and a 403
   on the tab's lines. So `counts?: OrderStateCounts` is a top-level, optional field of a row:
   present on every incoming row (the receiving desk may already open the tab's lines, `:207-275`),
   and on a sent or per-tab row only while (a) the tab's current department is the viewer's
   (`currentDepartmentId`, set by `summarizeTransfers`,
   `packages/venue-service/src/department-transfers.ts:511,549`, against `sender.departmentId`) and
   (b) the tab's zone is one the viewer's profile may work in, or none: `readZoneScope(tx, cfg,
   session.device.deviceProfileId)` once, then — only when the scope is not null, as
   `visibleOrders` does (`zone-access.ts:115-121`) — `VENUE_SERVICE.findOrderZones(tx, cfg,
   tabIds)` once, and `inScope(scope, zones.get(tabId))` per row. On the per-tab route (b) already
   holds whenever (a) does, because the route refuses otherwise (`department-transfer-api.ts:187-188`);
   the one helper applies both anyway. Attached in the three routes, inside each route's own
   `withTransaction`, after the module's list returns — so no module type changes and `summary`'s
   `toEqual` pins (`department-transfer-api.test.ts:1859-1880`) hold unchanged. The request,
   withdraw, accept and decline replies (`:282`, `:296`, `:309`, `:330`) carry no counts.
6. **Held orders loses its per-station ready chip.** Picture 05's decided rows carry the counts
   and no "Cocina: 2 ready" chip, which the "Today" side draws; "2 ready" says the same count but
   not where. The long-wait chip (`signalChips`, `apps/till/src/widgets/signal-chips.ts:41-45`)
   stays, because no count says a dish is late. (Owner point 1.)
7. **The chips.** One helper, `orderCounts(counts)` in `apps/till/src/widgets/order-counts.ts`,
   draws `<span class="counts">` holding one `<span class="chip" data-count="…">` per shown count,
   `data-count` being the field's name (`ordered`, `unsent`, `held`, `waiting`, `ready`), in that
   order, a state shown only when above 0. The count chips carry no `data-chip` attribute, so a
   `[data-chip]` query still finds only the signal chips `renderFloorChips` draws
   (`packages/ui/src/floor-chips.ts:90-96`). It reuses `floorChipStyles`
   (`packages/ui/src/floor-chips.ts:43-87`) for the chip's box and adds till-local classes: ordered
   plain (the chip's own `--wt-color-border`), unsent a dashed `--wt-color-warning` border (as the
   card's unsent badge, `apps/till/src/screens/till-floor-screen.ts:696`), held
   `--wt-color-text-muted` (as the floor's held chip's `muted` tone, `signal-chips.ts:91`), waiting
   `--wt-color-warning`, ready `--wt-color-success`. No icons (picture 05 draws none). It is not
   built on `renderFloorChips`, which always writes a tone class (`floor-chips.ts:90-96`) and has no
   plain tone (`packages/ui/src/floor.ts:16-17`); a plain tone would be a `packages/ui` change.
   `orderCounts` has no fallback for a missing `counts`: the server always sends it (driver ruling).
8. **No user guide describes these rows.** `git grep -n -i "parked order\|waiting order\|transfer"
   -- apps/server/src/guide/en` finds only `modifiers.md:102-161` and `products.md:260`, about menu
   edits and parked orders, not the list rows; the Spanish twins match. So no guide page changes;
   the till's help-mode texts for the three lists do (Task 6).
9. **Requested needs nothing now.** It is not stored (table above). The rule's held branch reads
   `fired_at` null, which A773-2 keeps for Requested (plan `:88`); Task 7 writes that into the
   design and asks A773-2's Task 4 to keep a case for it.

## Changed checks

Each edit below changes what an existing assertion pins because §5.3 changes what the row counts.

| File:line | Today | After | Why |
|---|---|---|---|
| `apps/server/src/working-order.test.ts:1337-1400` | title "with itemCount…"; `itemCount: 1` (A) and `itemCount: 2` (B) in a whole-row `toEqual` | title "with item counts…"; `counts` for A and B with the units the fixture parks (A: one Coffee × 2; B: Coffee × 1, Water × 3), every other value unchanged | §5.3 "a counted dish by its quantity". Task 2 runs it first and reads the actual values |
| `apps/server/src/working-order.test.ts:2628` | `afterSummary!.itemCount).toBe(2)` | `afterSummary!.counts.ordered` equal to the sum of `newLines`' quantities | as above |
| `apps/server/src/working-order.pay-and-dispatch.test.ts:547-561,1139-1146` | `draftAggregate` returns `itemCount: rows.length`, matched against the summary | `draftAggregate` returns `ordered`, the dish lines' summed quantities read in JS; the summary's `counts.ordered` must equal it | the cross-check keeps checking the SQL against an independent JS read |
| `apps/server/src/party-move-bill.test.ts:872` | `toMatchObject({ label: "Ana", itemCount: 1 })` | `toMatchObject({ label: "Ana", counts: expect.objectContaining({ ordered: <the moved dish's quantity> }) })` | as above |
| `apps/server/src/order-preview.test.ts:141-145` | `itemCount: 0` on a lineless order | `counts: { ordered: 0, unsent: 0, held: 0, waiting: 0, ready: 0 }` | as above |
| `apps/server/src/till-api.test.ts:2833-2837` | `objectContaining({ …, itemCount: 1, … })` and its local type | `counts: expect.objectContaining({ ordered: <its quantity> })` | as above |
| `apps/server/src/counter-handover.test.ts:812-827` | whole-row `toEqual` | gains `counts`, every existing value unchanged | new key (owner rule) |
| `apps/till/src/widgets/held-orders.test.ts:98-106` | `textContent` contains "2" (the line count) | the row's `[data-count]` texts equal `[countText(…ordered…), …]` for the fixture's counts | the count is now worded |
| `apps/till/src/widgets/held-orders.test.ts:131-150` | `chips(row)` equals `["Bar: 2 ready", "Kitchen: 1 ready", "Overdue"]` | `["Overdue"]`, and a new assertion that the row's `[data-count="ready"]` reads `t("order_counts.ready")` filled with the fixture's ready count | Decision 6, picture 05 |
| `apps/till/src/widgets/held-orders.a11y.test.ts:76` | `[data-chip]` has length 3 (one "Bar" ready chip and two long-wait chips) | `[data-chip]` has length 2, and the signalled rows' `[data-count]` chips are present (the fixtures gain `counts` with at least one state above 0) | Decision 6 drops the ready chip |

Any further whole-row `toEqual` over these lists that a run turns red with only the new `counts` key
missing is fixed by adding the key with the run's value and named in the pull request; any other
red is a stop.

## Tasks

### Task 1a: the counting rule and the lines statement

**Files:**
- Create: `apps/server/src/order-state-counts.ts` — `export interface OrderStateCounts { ordered;
  unsent; held; waiting; ready }` (all `number`); `export async function readOrderStateCounts(tx:
  Transaction, orderIds: readonly string[]): Promise<Map<string, OrderStateCounts>>` (every id in
  the map, zeros when it has no dish), reading Decision 3's statement (a) only; a pure, exported
  `dishCounts(dish, extras, collected)` doing all of Decision 1 for a bill's line, so every branch
  is tested without a database too. One doc comment stating the rule's order, that held includes
  every unfired kitchen part (Requested once stored), and that "sold by the unit" is
  `takesExtras`'s rule; no other comments.
- Create: `apps/server/src/order-state-counts.test.ts` — `useVenueDb`; counter-order fixtures as
  `working-order.test.ts`'s `listHeldOrders` describe builds them (`:1337-1400`); a gram unit as
  `apps/server/src/order-groups.test.ts:4203-4225` inserts one (`units`, precision 0,
  `hardwareUnit: "g"`), a millilitre unit as `working-order.test.ts:7467-7480` makes one
  (`createUnit` with `measure: true`, then `assignProductUnit`).

- [ ] **Step 1: Write the failing tests** — each test name contains "counts" and names the count it
  expects:
  - `dishCounts` unit cases for every branch of Decision 1: not sent; held by its group; held by
    its own unfired item; held by an unfired extra while the dish is made here; made-here in a held
    group → ready; waiting needs `fired_at` set (a `queued` item with `fired_at` null is held);
    waiting by an extra though the dish is ready; ready; no kitchen work but sent → ready;
    handed over → ordered only; `ceil` of a part-served line counted by quantity; the cap at
    ordered; a line not sold by the unit counted as one; a fractional quantity counted as one;
  - a parked counter order, Coffee × 2 and Water × 3: `ordered 5, unsent 5`;
  - **weighed and measured:** a parked counter order of one 150 g dish (gram unit, quantity 150):
    `ordered 1`; one 330 ml dish (millilitre unit, `measure: true`, quantity 330): `ordered 1`;
    one 0.450 kg dish: `ordered 1`;
  - **fractions:** a dish of a unit with 1 decimal place at quantity 1.5: `ordered 1`; a line whose
    `unit_precision` is null at 1.5 (set by a direct update in the test, as such a row can exist):
    `ordered 1`; a unit with 0 places refuses 1.5 with `quantity.invalid` (assert the code, CLAUDE.md
    §4) — the case that makes "a counted dish by its quantity" safe to divide;
  - a `ticket_then_pay` counter order, sent and handed over (`placed("ticket_then_pay", …)`, `apps/server/src/counter-handover.test.ts:105`; handing over refuses a placed order otherwise, `working-order.ts:6841-6860`, `:6872-6881`): only `ordered`;
  - an order with no lines: all zeros;
  - **one read:** for three orders the reader prepares the same number of statements as for one,
    and none for `[]` (the `prepare` spy of `table-signals.test.ts:686-699`).
- [ ] **Step 2: Run, watch them fail** (module missing), and read the `Tests` count:
  `pnpm --filter @waitron/server exec vitest run src/order-state-counts.test.ts`
- [ ] **Step 3: Implement** Decision 1 in `dishCounts` and Decision 3 (a) in the reader.
- [ ] **Step 4: Run** the file — PASS, reading the `Tests` count — and prove two branches by
  deletion: drop the `measure` check from "sold by the unit" and see the 330 ml case fail; drop
  the `collected_at` branch and see the handover case fail. Restore both. Record both in the
  commit message.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`; prettier; commit —
  `"A reader that counts each order's dishes as not sent, held, waiting and ready (A757 slice 6)"`.

### Task 1b: party bills, saved drafts and the kitchen, read from the database

**Files:**
- Modify: `apps/server/src/order-state-counts.ts` — add Decision 3's statement (b), the open
  drafts' dish rows, summed into each bill's `ordered` and `unsent`.
- Modify: `apps/server/src/order-state-counts.test.ts` — fixtures with the helpers
  `apps/server/src/table-signals.test.ts:1-75` imports (`addTabRound`, `placeGroups`, `fireGroup`,
  `serveLine`, `routeProductTo`, `createStation`). There is no made-here fixture: set it by a
  direct `ticket_items` update, as `table-signals.test.ts:207-221` does. The recall fixture is
  the one `table-signals.test.ts:637-668` uses. A saved draft is written with `saveDraftForTest` (`apps/server/src/testing/draft-command-fixture.ts:24`), as `table-signals.test.ts:2` imports it (as `saveDraft`) and calls it with `billId` and `draftLine(v, "Burger")` (`:240-247`); `saveDraft` requires a bill id (`order-drafts.ts:476`).

- [ ] **Step 1: Write the failing tests** — each name contains "counts":
  - a party bill with a held group (a counted dish × 2 carrying an extra, and a 0.450 kg dish — a weighed dish refuses an extra, `extras.unsupported_product`, `working-order.ts:825-834`): `ordered 3, held 3`; the extra adds nothing; `readHeldCounts` for the party also says 3;
  - fired to a station, `queued` then `preparing`: waiting; marked ready: ready; two of three
    served with `serveLine`: `ordered 3, ready 1`; all served: `ordered 3`, nothing else;
  - a dish fired with its extra routed to another station: waiting while the extra is `queued`
    though the dish is ready; ready once both are; the extra held while the dish is fired: held;
  - a made-here dish in a held group: ready (the pin for owner point 10);
  - a sent dish routed to no preparation, which "is stamped sent and gets no kitchen item"
    (`apps/server/src/testing/adjustment-venue.ts:190`): ready;
  - a recalled dish: unsent;
  - **a saved draft:** a party bill with one sent, ready dish and a saved, unsent draft holding one
    dish reads `ordered 2, unsent 1, ready 1`; the same bill's `listHeldOrders` total is unchanged
    by the draft (the draft dish is in no `working_order_lines` row); a draft holding a 150 g dish
    adds 1; a discarded draft adds nothing;
  - a dish with 1 of 3 cancelled: `ordered 2`; a weighed dish cancelled whole: `ordered 0`;
  - **one read:** the statement-count case from Task 1a still holds with drafts on two of the
    three orders.
- [ ] **Step 2: Run, watch the new cases fail** (`-t "counts"`), reading the `Tests` count:
  `pnpm --filter @waitron/server exec vitest run src/order-state-counts.test.ts -t "counts"`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file — PASS, reading the `Tests` count — and prove two more by deletion:
  drop the extras' unfired check and see the held-extra case fail; drop statement (b) and see the
  saved-draft case fail. Restore both; record both in the commit message.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`; prettier; commit —
  `"Item counts read a bill's saved, unsent dishes and its kitchen states (A757 slice 6)"`.

### Task 2: Parked and Waiting orders send their counts

**Files:**
- Modify: `apps/server/src/working-order.ts` — `HeldOrderSummary` (`:4676-4701`): `itemCount`
  goes, `counts: OrderStateCounts` comes; `listHeldOrders` drops the `itemCount` column (`:4788`)
  and its mapping (`:4822`) and calls `readOrderStateCounts(tx, ids)` once beside
  `readOrderPreviewItems` (`:4814`); `CounterWaitingOrder` (`:6889-6914`) gains `counts`;
  `listCounterWaiting` calls the reader once beside its `readOrderPreviewItems` (`:7000-7003`) and
  sets it in `waiting.push` (`:7020`).
- Modify: the tests in "Changed checks" (server rows only).

- [ ] **Step 1: Write the failing tests** (each name contains "counts"): in `working-order.test.ts`'s
  `listHeldOrders` describe, a party bill with one held, one waiting and one ready dish reads
  `counts` `{ ordered: 3, unsent: 0, held: 1, waiting: 1, ready: 1 }` and has no `itemCount` key;
  in `counter-handover.test.ts`, a settled counter order whose dish is `queued` reads `waiting: 1`
  and, once ready, `ready: 1`. Then make the listed assertion edits.
- [ ] **Step 2: Run, watch them fail**, and read the `Tests` count — it must show the new cases
  in both files run, not skipped:
  `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/counter-handover.test.ts -t "listHeldOrders|counts"`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every server file that reads these lists or routes — PASS, reading the
  `Tests` count. Re-run the grep first and add any file it names that is missing below:
  `git grep -l "listHeldOrders\|listCounterWaiting\|/api/working-orders\"\|counter-waiting" -- 'apps/server/src/*.test.ts'`.
  On 2026-10-21 it named these 35, run with `src/order-state-counts.test.ts`:
  `pnpm --filter @waitron/server exec vitest run src/order-state-counts.test.ts src/attendance-order-routes.test.ts src/cancel-invoiced-order.test.ts src/counter-handover.test.ts src/course-retention.test.ts src/former-numbers.test.ts src/location-settings-api.orders-open.test.ts src/made-here.routes.test.ts src/order-kitchen-note.paths.test.ts src/order-preview.test.ts src/order-table-names.test.ts src/party-move-bill.test.ts src/placed-order-one-payment.test.ts src/simplified-limit.test.ts src/table-signals.test.ts src/till-api.courses.test.ts src/till-api.fiscal-sale-paths.test.ts src/till-api.groups.test.ts src/till-api.keep-open.test.ts src/till-api.move-bill.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-api.reprint.test.ts src/till-api.seasons.test.ts src/till-api.sell-published.test.ts src/till-api.service-periods.test.ts src/till-api.split-bill.test.ts src/till-api.station-move.test.ts src/till-api.test.ts src/till-api.unroutable-dish.test.ts src/till-api.zone-closed.test.ts src/till-api.zone-required.test.ts src/till-reroute-e2e.test.ts src/till-sale.disk-full.test.ts src/working-order.pay-and-dispatch.test.ts src/working-order.test.ts`
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit —
  `"Parked and waiting orders carry their item counts in place of the line count (A757 slice 6)"`.

### Task 3: the Transfers rows carry counts where the tab may be seen

**Files:**
- Modify: `apps/server/src/department-transfer-api.ts` — a local `withCounts(tx, rows, viewer,
  scope)` that reads `readOrderStateCounts(tx, rows' tabIds)` once and sets `counts` per Decision
  5: every row on `/incoming` (`:162-177`); on `/api/working-orders/:id/department-transfers`
  (`:178-194`) and `/sent` (`:195-206`) only rows whose `currentDepartmentId` is the viewer's AND
  whose tab is in scope, the zones read once for all rows with `readZoneScope` and
  `VENUE_SERVICE.findOrderZones` and tested with `inScope` (`zone-access.ts:81-94`) — no await
  inside a loop over rows. All inside each route's existing `withTransaction`.
- Modify: `apps/server/src/department-transfer-api.test.ts` — new cases in the
  "human transfer identities" describe (`:1847`).

- [ ] **Step 1: Write the failing tests** (each name contains "counts"):
  - the receiving desk's incoming row carries `counts` for the tab's dishes (one held, one ready:
    `{ ordered: 2, unsent: 0, held: 1, waiting: 0, ready: 1 }`);
  - the source's `/sent` and per-tab rows carry the same while the transfer is pending, and after
    a decline;
  - **refusing case, department:** after acceptance the source's `/sent` and per-tab rows have no
    `counts` key (beside the existing `not.toHaveProperty("lines")`, `:1881`); the destination lists no row for an accepted transfer on any of the three routes (incoming lists only pending ones, `department-transfers.ts:248-264`; the other two select by the source department, `:590-596`, `:612-648`);
  - **refusing case, zone:** with the transfer pending, the source's `/sent` row has `counts`;
    after `retargetOrderServiceContext(tx, v.cfg, f.tab, f.hidden)` (as `:989-999` does) the
    same `/sent` row is still listed and has no `counts` key;
  - **one read:** each of the three routes prepares the same number of statements for two rows as
    for one (the `prepare` spy).
- [ ] **Step 2: Run, watch them fail**, reading the `Tests` count:
  `pnpm --filter @waitron/server exec vitest run src/department-transfer-api.test.ts -t "counts"`
- [ ] **Step 3: Implement.** The existing `summary` pins (`:1859-1880`) must pass unchanged.
- [ ] **Step 4: Run** `src/department-transfer-api.test.ts src/service-delete.history.test.ts
  src/till-api.transfer.test.ts` and `pnpm --filter @waitron/venue-service exec vitest run
  src/department-transfers.test.ts` (unchanged code; it proves the module's rows did not move) —
  PASS, reading each `Tests` count.
- [ ] **Step 5:** typecheck `@waitron/server`; prettier; commit —
  `"Transfer rows say what the tab holds, for the department and zones that may see it (A757 slice 6)"`.

### Task 4: the words and the chip helper in the till

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` — the ten keys of Global constraints, named
  `order_counts.items`, `order_counts.items_one`, `order_counts.unsent`, `…_one`,
  `order_counts.held`, `…_one`, `order_counts.waiting`, `…_one`, `order_counts.ready`, `…_one`,
  placed after `waiting.*` in `en` (`:505-511`) and in `es` (`:2211-…`). (The key says "items",
  the word shown; the wire field is `ordered`.)
- Modify: `apps/till/src/api/client.ts` — `export interface OrderStateCounts` (`ordered`, `unsent`,
  `held`, `waiting`, `ready`) beside `OrderPreviewItem` (`:1273`); no list type changes yet.
- Create: `apps/till/src/widgets/order-counts.ts` — `orderCounts(counts: OrderStateCounts):
  TemplateResult` and `orderCountStyles` (Decision 7); `countText` from `../i18n/t.js`.
- Create: `apps/till/src/widgets/order-counts.test.ts`, `order-counts.a11y.test.ts`.
- Modify: `apps/till/src/i18n/strings.test.ts` — beside the held-word cases (`:113-139`).

- [ ] **Step 1: Write the failing tests:**
  - `orderCounts({ ordered: 6, unsent: 0, held: 2, waiting: 0, ready: 2 })` draws three chips, in
    order, reading `countText(6, "order_counts.items", "order_counts.items_one")` and so on; a state
    at 0 draws nothing; `{ ordered: 1, … }` reads the `_one` text; `{ ordered: 0, … }` reads "0
    items"; all five at once come in the order ordered, unsent, held, waiting, ready, with
    `data-count` equal to the field names; no chip carries `data-chip`;
  - each chip's computed `border-color` (and `border-style` dashed for unsent) equals the token it
    reads, set to a test value on the host — the token-painting check;
  - in Spanish (`setLocale("es")`, restored after), the texts read `es[...]`;
  - `strings.test.ts`: `es["order_counts.held"]` is `{n} ${es["table.group_held"].toLowerCase()}`
    and its `_one` is `1 …` (the owner's «en espera» rule); `es["order_counts.waiting"]` holds
    `es["signal.wait_warm"].toLowerCase()` and not held's word; every new key has both forms in both
    languages;
  - a11y: axe over all five chips in light and dark (`order-counts.a11y.test.ts`, following
    `apps/till/src/widgets/held-orders.a11y.test.ts`).
- [ ] **Step 2: Run, watch them fail**, reading the `Tests` count:
  `pnpm --filter @waitron/till exec vitest run src/widgets/order-counts.test.ts src/widgets/order-counts.a11y.test.ts src/i18n/strings.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, plus `pnpm exec vitest run scripts/style-token-names.test.ts
  scripts/primary-coloured-text.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The till's words and chips for an order's item counts (A757 slice 6)"`.

### The till test files that draw the counter's lists (for Tasks 5a and 5b)

Some of these return untyped mock JSON, which typecheck does not hold to the type — for example
`apps/till/src/till-app-boot-and-counter.test.ts:4372-4385`'s `held` row with `itemCount: 1` — so
only running them finds a fixture lacking `counts`, and it fails loudly because `orderCounts` has
no fallback. `git grep -ln "listWorkingOrders\|listCounterWaiting\|till-held-orders\|till-counter-waiting\|till-counter-screen" -- 'apps/till/src/*.test.ts' 'apps/till/src/**/*.test.ts'`
named these 48 on 2026-10-21 (re-run it; add any new name):
`src/api/client.test.ts src/screens/device-screens.phone-margin.test.ts src/screens/keep-open-order-screens.a11y.test.ts src/screens/keep-open-order-screens.test.ts src/screens/service-periods.a11y.test.ts src/screens/till-counter-cleanup.layout.test.ts src/screens/till-counter-cleanup.look.test.ts src/screens/till-counter-screen.a11y.test.ts src/screens/till-counter-screen.fixed.test.ts src/screens/till-counter-screen.help-clip.test.ts src/screens/till-counter-screen.help.a11y.test.ts src/screens/till-counter-screen.help.test.ts src/screens/till-counter-screen.kitchen-note.test.ts src/screens/till-counter-screen.layout.test.ts src/screens/till-counter-screen.menu.test.ts src/screens/till-counter-screen.test.ts src/screens/zone-keep-open-screens.a11y.test.ts src/screens/zone-keep-open-screens.test.ts src/till-app-adjustments.test.ts src/till-app-allergy.move.test.ts src/till-app-bill-payments.test.ts src/till-app-boot-and-counter.test.ts src/till-app-counter-adjustments.test.ts src/till-app-counter-cancel-credit.test.ts src/till-app-counter-move-station.test.ts src/till-app-device-zones.test.ts src/till-app-drafts.test.ts src/till-app-floor-layout.test.ts src/till-app-kitchen-note.test.ts src/till-app-menu-refresh.test.ts src/till-app-menu-timetable.test.ts src/till-app-open-table.test.ts src/till-app-parties.test.ts src/till-app-setup-refresh.test.ts src/till-app-table-service.test.ts src/till-app.a11y.test.ts src/till-app.help-mode.test.ts src/till-app.nfc.test.ts src/till-app.test.ts src/till-app.theme.test.ts src/widgets/basket.line-details.test.ts src/widgets/counter-waiting.a11y.test.ts src/widgets/counter-waiting.test.ts src/widgets/guide-sheet.test.ts src/widgets/held-orders.a11y.test.ts src/widgets/held-orders.test.ts src/widgets/order-preview.look.test.ts src/widgets/order-table-names.test.ts`.
The shared app fixtures under `apps/till/test/` (`allergy-app-fixture.ts:228-229`,
`bill-pay-app.ts:308-309`, `clock-app.ts:162-163`, `equipment-app.ts:80-81`) answer both lists
with `[]`, so they draw no row and need no change. A fixture whose `itemCount` sits on a find-bill
row (`apps/till/test/find-bill-fixtures.ts:15`, `find-bill-client.test.ts:127`) stays as it is.

### Task 5a: Parked orders rows show the counts

**Files:**
- Modify: `apps/till/src/api/client.ts` — `HeldOrderSummary` (`:1315-1337`): `itemCount` →
  `counts: OrderStateCounts`.
- Modify: `apps/till/src/widgets/held-orders.ts` — `#meta` (`:231-240`) keeps the total and the
  still-to-pay part only; the row (`:260-263`) draws `orderCounts(order.counts)` after `.meta`;
  `#signals` (`:242-247`) leaves out the chips keyed `ready` (Decision 6); add `orderCountStyles`.
- Modify: `held-orders.test.ts` and `held-orders.a11y.test.ts` per "Changed checks"; every
  `HeldOrderSummary` fixture typecheck names or a run turns red (setup only).

- [ ] **Step 1: Write the failing tests:**
  - a row with `counts { ordered: 6, held: 2, ready: 2, … }` shows those three chips under its
    total, and its `.meta` holds the money and no count; the changed checks above;
  - at 333 px the existing one-line `.meta` case (`held-orders.test.ts:216-230`) still holds, and a
    new case: the counts line wraps inside the row and never past its right edge
    (`getBoundingClientRect().right` ≤ the host's) at 320 px;
  - a11y fixtures carry every count above 0, light and dark.
- [ ] **Step 2: Run, watch them fail**, reading the `Tests` count:
  `pnpm --filter @waitron/till exec vitest run src/widgets/held-orders.test.ts src/widgets/held-orders.a11y.test.ts`
- [ ] **Step 3: Implement**, then update the fixtures until `pnpm --filter @waitron/till typecheck`
  passes.
- [ ] **Step 4: Run** the 48 files listed above (check `memory_pressure | grep free` and split the
  run if headroom is short), reading each `Tests` count. A red file whose only cause is a held row
  lacking `counts` gets `counts` in its fixture (setup); any other red is a stop.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"Parked orders show how many items, and how many are unsent, held, waiting or ready (A757 slice 6)"`.

### Task 5b: Waiting orders rows show the counts

**Files:**
- Modify: `apps/till/src/api/client.ts` — `CounterWaitingOrder` (`:1284-1308`) gains `counts`.
- Modify: `apps/till/src/widgets/counter-waiting.ts` — after the state and total (`:148-149`) draw
  `orderCounts(order.counts)`; add `orderCountStyles`.
- Modify: `counter-waiting.test.ts`, `counter-waiting.a11y.test.ts`; every `CounterWaitingOrder`
  fixture typecheck names or a run turns red (setup only).

- [ ] **Step 1: Write the failing tests:**
  - a row with `{ ordered: 3, waiting: 3 }` shows "3 items" and "3 waiting" beside its state word;
    a handed-over row's `{ ordered: 3 }` shows only "3 items";
  - the counts line wraps inside the row and never past its right edge at 320 px;
  - a11y fixtures carry every count above 0, light and dark.
- [ ] **Step 2: Run, watch them fail**, reading the `Tests` count:
  `pnpm --filter @waitron/till exec vitest run src/widgets/counter-waiting.test.ts src/widgets/counter-waiting.a11y.test.ts`
- [ ] **Step 3: Implement**, then update the fixtures until `pnpm --filter @waitron/till typecheck`
  passes.
- [ ] **Step 4: Run** the 48 files listed above, as in Task 5a Step 4.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"Waiting orders show their item counts (A757 slice 6)"`.

### Task 6: the Transfers rows, and the help texts

**Files:**
- Modify: `apps/till/src/api/client.ts` — `DepartmentTransfer` (`:2408-2429`) gains
  `counts?: OrderStateCounts`.
- Modify: `apps/till/src/widgets/department-transfers.ts` — `#summary` (`:465-485`) draws
  `orderCounts(row.counts)` after the "Tab {number} — label" line when `row.counts` is present.
- Modify: `apps/till/src/i18n/help-strings.ts` — one added sentence each, English and Spanish:
  `help.counter.parked_orders` and `help.counter.waiting_orders` — "Each order shows how many items
  it has, then how many are unsent, held, waiting or ready." («Cada pedido muestra cuántos artículos
  tiene y cuántos están sin enviar, en espera, esperando o listos.»); `help.more.transfers` — "A tab
  your department holds shows the same counts." («Una cuenta de tu departamento muestra los mismos
  recuentos.»). Shortest wording whose meaning can be inferred (owner); the help-strings tests
  (`apps/till/src/i18n/help-strings.test.ts:39-62`) must still pass.
- Modify: `apps/till/src/widgets/department-transfers.summaries.test.ts`.

- [ ] **Step 1: Write the failing tests:** an incoming row with `counts` shows its chips; a sent
  row without `counts` shows none and no empty `.counts` element; in Spanish the texts read `es[…]`;
  each of the two counter help texts (`help.counter.parked_orders`, `help.counter.waiting_orders`),
  in each language, contains the five words — read from `strings.ts` (the `order_counts.*` texts
  less their `{n} `), never spelled; `help.more.transfers` is checked only for the added sentence.
- [ ] **Step 2: Run, watch them fail**, reading the `Tests` count:
  `pnpm --filter @waitron/till exec vitest run src/widgets/department-transfers.summaries.test.ts src/i18n/help-strings.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus every `src/widgets/department-transfers.*.test.ts` file
  (`department-transfers.a11y`, `.actions`, `.actions.a11y`, `.sender`, `.sender.a11y`,
  `.sender.unsaved`, `.unsaved`), and the files that draw the changed help keys:
  `src/screens/till-counter-screen.help.test.ts` (it names both counter keys, `:113`, `:122`),
  `src/screens/till-counter-screen.help-clip.test.ts` (the counter's help badges drawn whole,
  `:141`) and `src/till-app.help-mode.test.ts` (help mode across the counter, `:200`) — PASS,
  reading each `Tests` count.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"Transfer rows show the tab's item counts, and the help says what they mean (A757 slice 6)"`.

### Task 7: docs and backlog

**Files:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`, `docs/backlog.md`,
`docs/backlog/till.md`.

- [ ] **Step 1: The design.** Status line (`:3`): slice 6 built 2026-10-2x (check `git log
  --oneline origin/main | grep A757` for what else has landed); "slice 8 left". Under §5.3 (after
  `:414`) a dated note: built by slice 6 (this plan); `itemCount` (`:403` cites `:4414`, now gone)
  replaced by `counts`; a dish not sold by the unit (weighed, measured, or with decimal places)
  counts as one; a bill's saved, unsent dishes count as unsent; Requested counts as held through
  `fired_at` null, which A773-2's plan (`:88`) keeps; Transfers rows show counts without a total
  and only for the department holding the tab, in its viewer's zones; Held orders' per-station
  ready chip went. §11 item 6: "(built)".
- [ ] **Step 2: `docs/backlog.md`.** A757 (`:2132-2144`): slice 6 joins the landed slices, with
  this plan's path; "slice 8 is left". A893 (`:2146-2149`): "slice 8 is left".
- [ ] **Step 3: `docs/backlog/till.md`.** A757's "Item counts by state" bullet (`:1354-1357`): it
  says the row reads "4 · €24.50" counting LINES — rewrite it to what is built, in one sentence
  with this plan's path (a behaviour change retires its receipt). A893's list (`:1359-1437`): add
  "the choices slice 6 made where the pictures are silent: its plan's Owner points
  (`docs/superpowers/plans/2026-10-21-a757-6-item-counts-by-state.md`), each built with the default
  named there."
- [ ] **Step 4: New short backlog entries** (in `docs/backlog.md`'s till area, detail in
  `docs/backlog/till.md`), each "left open by A757 slice 6", using the next numbers from
  `~/waitron-campaign-shared/next-item-number` (read, use, write back):
  - **The floor's ready and held chips count a gram or millilitre dish by its quantity.** As read
    on 2026-10-21: the ready chip counts a dish as one only when its frozen `unit_precision` is
    above 0 (`apps/server/src/table-signals.ts:96-103`) and the held chip the same
    (`readHeldCounts`, `apps/server/src/order-groups.ts:1567`), and new venues get `g`, `mg` and
    `ml` at 0 places (`packages/catalogue/src/provisioning.ts:96-146`), so 150 g of a dish reads as
    150 there while slice 6's rows read 1 item. The till's own draft count decides "whole units"
    with `soldByTheUnit`, which does not read `measure`
    (`apps/till/src/screens/till-table-order-screen.ts:214-216`,
    `apps/till/src/widgets/product-name.ts:85-88`), so it adds 330 for a 330 ml dish. Fix: the
    `takesExtras` rule (`apps/server/src/working-order.ts:455-458`) in all three.
  - **Find a bill still counts lines** (`find-bill-bills.ts:162`), so its Items column and the
    Parked orders row can disagree for one bill.
- [ ] **Step 5: Stale receipts.** `git grep -n -i "4 · €\|number of lines\|itemCount" -- docs
  apps/till/src apps/server/src ':!*.test.ts'` — every hit describing the held list's count is
  updated or, in a historical doc, left with a dated pointer; record the grep's output in the
  commit message. Today's hits outside this slice's files: `docs/backlog/catalogue.md:849` (the
  till's draft helper, unrelated), `docs/superpowers/plans/2026-10-15-a737-find-bill-page.md:114,129`
  (find-bill, historical, unchanged).
- [ ] **Step 6:** `pnpm exec prettier --file-info` on each file (docs are ignored); commit —
  `"Docs: A757 slice 6, item counts by state, is built"`.

### Task 8: LOOK — the three lists in real Chromium

**Files:** a throwaway test `apps/till/src/widgets/order-counts.look-shots.test.ts` (deleted, never
committed), pictures under `__screenshots__/a757-6/` (a path Vite allows,
`docs/developers/testing-guide.md:1478-1479`), copied to
`/Users/clintongormley/waitron-campaign-c/a757-6-shots/` and to
`docs/backlog/mockups/a757-table-states/built-6/` (committed); notes in
`/Users/clintongormley/waitron-campaign-c/a757-6-look-report.md`, following
`/Users/clintongormley/waitron-campaign-c/a757-5-look-report.md`. Method as slice 5's Task 13
(`docs/superpowers/plans/2026-10-20-a757-5-map-zone-tabs.md:1033-1066`): mount the widgets with
fixtures, viewport 720 high, size, theme and language restored in `finally`. The widgets, not the
running till: `wa-wt demo <worktree-name>` (`docs/developers/workflow-guide.md`) needs orders in
every state on one venue, which no seed provides; if the driver wants the running till as well,
it is an extra step, not a substitute.

- [ ] **Step 1: Draw.** (a) Parked orders: picture 05's two rows (#12 T4 6 items · 2 held · 2
  ready · €58.20; #14 Barra 3 items · 3 waiting · €9.80), a row with all five chips and a long wait,
  a partly paid row ("to pay"), a lineless "0 items" row, and a 40-character label; (b) Waiting
  orders: sent-not-paid with 2 waiting, paid-not-handed-over with 1 ready, handed-over with items
  only; (c) Transfers: an incoming row with counts, a sent pending row with counts, an accepted
  sent row without. Each in light and dark at 390 and 1280 px; (a) and (c) also in Spanish at 390
  in both themes. Name each `<list>-<scene>-<width>-<theme>.png`.
- [ ] **Step 2: Measure and look.** Record each chip's computed border colour and style, and
  `document.documentElement.scrollWidth` equal to the viewport. Look beside picture 05: chip order,
  the total's place, the chips' wrap at 390 beside the Retrieve/Move/Discard buttons, Spanish
  lengths («3 sin enviar», «2 esperando») not overflowing, the dashed unsent border in both themes.
  A defect is fixed with a failing test first, in the file that owns it, and committed.
- [ ] **Step 3:** Copy the pictures to both places, delete the throwaway test and the
  `__screenshots__/a757-6/` copies, `git status` clean but for the pictures; commit — `"Pictures of
  the order lists' item counts as built (A757 slice 6)"`.

---

## Owner points (each with the default this plan builds; the owner is away until 2 Nov)

1. **Parked orders drops the per-station ready chip** ("Bar: 2 ready"), as picture 05's decided rows
   do; the long-wait chip stays. What is lost: "2 ready" no longer says which station to collect
   from. The server still sends the `ready` station signals with the row (`readBillSignals`,
   `apps/server/src/table-signals.ts:138-145`, sent at `working-order.ts:4829`), and nothing draws
   them on that row. Default: dropped. The other way keeps both, saying ready twice.
2. **Transfers rows get the counts but no total**: they show none today
   (`department-transfers.ts:470-484`), though Q19's sentence ends "€58.20". Default: no total.
3. **Transfers counts are shown only to the department holding the tab, in the zones its profile
   works in**, and to the desk it is offered to; an accepted transfer's row in the sender's history
   shows none, as it shows no lines today, and neither does a row whose tab moved to a zone the
   viewer's profile does not list. Default: as described.
4. **A lineless order says "0 items".** Default: shown. The other way shows no count at all.
5. **"Not sent" reads "unsent"** («sin enviar»), the map's word for it (`floor.unsent_mark`).
6. **Waiting reads "waiting" («esperando»)** — the floor's Waiting chip's word, beside held's «en
   espera». The collision: the bar's Waiting tab is already called «En espera»
   (`shell.waiting`, `apps/till/src/i18n/strings.ts:2028`), so in Spanish a Waiting row may read
   «1 en espera · 2 esperando» under a tab called «En espera». The alternative «en cocina» names the
   kitchen, though a bar's drinks count too.
7. **Singulars:** "1 item", "1 unsent", "1 held", "1 waiting", "1 ready"; «1 artículo», «1 sin
   enviar», «1 en espera», «1 esperando», «1 listo».
8. **A part-served dish** lists only what is left to serve: 3 croquetas with 1 served read "3 items ·
   2 ready". A dish counted as one, part-served, still counts its one in its state.
9. **Cancelled food is not an item**: 3 ordered, 1 cancelled while the charge stays, reads "2 items".
10. **A dish with no kitchen work, once sent, counts as ready**, and so does a made-here dish — so a
    bill's "2 ready" can be more than the floor's ready chip, which leaves made-here out
    (`apps/server/src/table-signals.ts:81`). A made-here dish in a held group reads ready on the row
    while the floor's held chip counts it, "Held 1" (`readHeldCounts` reads no kitchen item,
    `order-groups.ts:1543-1564`; drawn by `signal-chips.ts:86`). Default: ready.
11. **A handed-over counter order lists only its items**: the customer has it, whatever the kitchen
    marked.
12. **A recalled dish counts as unsent**, since it is back in the New order panel.
13. **Dishes saved in a bill's New order panel and not sent count as unsent, and in its items** —
    the design's Not sent is "a draft not sent" (§4 row 9). The row's total stays the bill's own
    lines (`working-order.ts:4790`), so a row can say "1 unsent" for a dish its total does not
    include yet. Default: counted. The other way counts only the bill's own lines.
14. **A dish waits until its separately routed extras are ready, and an unfired extra holds it**, as
    the order screen already reads a dish (`order-groups.ts:1763-1770,1839-1842,1857`).
15. **A dish not sold by the unit counts as one item**: 150 g of ham, 330 ml of wine, 0.450 kg of
    fish and a dish sold in halves at 1.5 each read "1 item". "Sold by the unit" is the server's
    rule for taking extras: no scale, no decimal places, not a measure. A line keeps its unit's
    decimal places from when it was ordered, but whether the unit weighs or measures is read from
    the product's unit now, so a product moved to another unit after it was ordered is read by the
    new one.
16. **The chips' colours:** items plain, unsent dashed amber, held grey, waiting amber, ready green;
    no icons, as picture 05 draws them.
17. **Requested** counts as held with no change once A773-2 stores it (Decision 9).
18. **Counts can be out of date between reads**, as every other fact on these rows is: Parked and
    Waiting are read when shown and after this till's actions, Transfers every 15 s or on a
    transfer event, and a just-requested Transfers row shows no counts until the next read lists it
    ("When the lists are read again", above). Default: unchanged.

## What contradicted the brief or the design

- The brief says #1944 (A773-2 PR A) added Requested dishes. It did not: its commit message
  (`509e8d42a`) leaves "requested-state storage and pass-release work to the later A773-2 slices",
  and no schema file stores it. Decision 9 covers what that means here.
- The design cites `itemCount` at `apps/server/src/working-order.ts:4414` (§5.3, `:403`); it is
  now `:4788` (select) and `:4687` (type) — drift, not a different meaning.
- The design says "A765 adds the table's name to the same rows and builds to this"; A765 landed
  first (#1908, `8cf43cfba`), so this slice builds on the row as A765 left it.
- Q19 says Transfers rows read "… · €58.20", but Transfers rows carry no total today (Owner
  point 2).
- §5.3 says "a weighed dish as one"; the floor's chips it sits beside count a gram dish by its
  quantity (Task 7's first new entry).
