# A757 slice 3 — Held mark and countdown: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (driver ruling, 2026-10-20, overriding design §11 item 3's LIGHT): Task 2
adds a kind to `TableSignal` (`packages/shared`) and Task 3 adds an optional field and a tone to
`FloorChip` and restyles a `packages/ui` chip — a cross-package contract. So every task gets its
per-task review, and `/finish-branch` runs the full wave. Both changes are additive, and their only
consumers are `apps/server` and `apps/till` (`git grep -n "TableSignal\b" -- apps packages
':!*.test.ts'` and `git grep -ln "renderFloorChips\|FloorChipTone\|wt-table-token" -- apps packages`
name nothing in `apps/dashboard`). **No migration.** **One pull request for the whole slice.** Branch
`feat/a757-3-held-mark-countdown`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-3-held-mark-countdown`, from `main` at
`33fa13a92`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** a table holding dishes says so on the floor — "⏸ Held 2", counting down "⏸ Held 2 · fire
in 4 min" once its reminder has a time, and turning into a filled amber "▶ Time to fire" when due —
on the list card and on the unplaced table's token; and a held dish no longer makes a card say
"Forgotten".

**Architecture:** the server's floor read gains a `held` signal carrying the party's held-dish
count, read in one query for the whole floor beside the release reminders, and `timingBand` stops
counting dishes that were never fired. The till builds one quiet chip from that signal and the
party's existing reminder, using the screen's clock, and redraws itself at each minute the
countdown changes. `@waitron/ui`'s floor chips learn to draw an icon, and gain a quiet tone; the
"Time to fire" badge on the card and the token becomes filled amber with an icon.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Lit, Vitest (Node for `apps/server`, real
Chromium for `apps/till` and `packages/ui`).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` — "Decided" (Q17), §4 rows
4 and 12, §5.1 in full, §5.2, §6, §11 item 3. Picture
`docs/backlog/mockups/a757-table-states/03-held-countdown.png` (and `-dark.png`).

## Global constraints

- **Words, from the design and picture 03.** English: `Held {n}`, `Held {n} · fire in {m} min`
  (§5.1), the due chip keeps `Time to fire` (`apps/till/src/i18n/strings.ts:860`). Spanish:
  `{n} retenidos · marchar en {m} min` (§5.1), so `{n} retenidos`; the due chip keeps `Hora de
  marchar` (`strings.ts:2445`). The singular `1 retenido` / `1 retenido · marchar en {m} min` is
  derived, not drawn (open point 1). The symbols ⏸ and ▶ are icons drawn with `wt-icon`, not text
  (spec lines 11-15).
- **The countdown:** `m` is the time left rounded **up** to whole minutes, so the last minute reads
  "fire in 1 min" (§5.1); a snoozed group counts down to the snooze (the server already sends the
  snooze as the due time, `releaseReminder`, `apps/server/src/order-groups.ts:1487`).
- **No time yet, or reminders off:** `Held {n}` with no countdown; with reminders off it never turns
  into Time to fire (§5.1 "So:" list).
- **Requested dishes are not counted.** A773-2, which stores them, has not landed; §11 item 3 counts
  them "once A773-2 stores them". Nothing in this slice reads or anticipates them.
- **English in code.** Spanish only in `apps/till/src/i18n/strings.ts`; a test of Spanish reads its
  expected text from that file's `es` dictionary (as `till-floor-screen.a11y.test.ts:3` imports it).
- Every colour, spacing and size reads a `--wt-*` token (CLAUDE.md §3).
- Coverage bars 98/98/98/95 hold in `apps/server`, `apps/till` and `packages/ui`; `packages/ui` is
  mutation-tested, so each new style and the icon branch needs an assertion that fails without it.
- **Changing an existing test assertion is a stop** unless this plan lists it under "Assertions
  changed" in its task. Anything else that turns red is a stop and a report, not an edit. Each
  listed edit checks at least as much as before (no key, style or case dropped), and the pull
  request's description lists every one of them — the five in Task 2 and the one in Task 3 — with
  the spec line that changes what it pins.
- Every commit `git commit -s`. Every task ends with its focused tests (read the `Tests` count — a
  run that prints none proves nothing), `pnpm --filter <pkg> typecheck` for each package it touched,
  and `pnpm exec prettier --check <changed files>`. Browser runs (`apps/till`, `packages/ui`): check
  free memory first (`memory_pressure | grep free`). An implementer past about 150 tool calls with
  the task unfinished stops at a passing or cleanly red point, commits, and returns a handover
  (done, left, files, each check's state).

## Decisions (with receipts)

1. **The held count travels as a floor signal**, `{ kind: "held"; count: number }` in `TableSignal`
   (`packages/shared/src/table-signals.ts:7-21`), placed after `long_wait` and before
   `release_due`, not as a field on `TableParty`. Receipts: `git grep -c "reminder: null\|reminder: {"`
   over `apps/till` test files counts 142 party fixtures in 67 files, which a required `TableParty`
   field would all have to grow, while those fixtures carry `signals: []`; slice 4's ranking reads
   a table's signals (§11 item 4). Measured cost, below: five assertions in one server file.
2. **What "held" counts.** The party's own groups with `order_groups.state = 'held'`, the party open,
   their dish lines only (`parent_line_id` null, so extras are not counted), on bills that are not
   abandoned (`onShownBill`, `order-groups.ts:1657`), not recalled (`isRecalledDish`,
   `apps/server/src/draft-source.ts:34`), less what was cancelled (`serviceQuantities(...).active`,
   `apps/server/src/line-service-state.ts:20-31`) — exactly the filters `readReleaseReminders`
   applies (`order-groups.ts:1500-1569`), so a party with a reminder always has a held count. A
   counted dish counts its active quantity; a weighed dish (a non-zero `unit_precision`) counts one,
   as the ready count does (`apps/server/src/table-signals.ts:89-94`) and §5.3 defines an item —
   but only while its active quantity is above 0: a weighed dish cancelled whole counts nothing,
   as `readReleaseReminders` skips a group whose lines are all cancelled (`fullyCancelled`,
   `order-groups.ts:1476,1562`), or the floor would say "Held 1" for nothing. The
   party's own groups, not its family's: drafts, held groups and the bill request are the party's own
   (`packages/shared/src/table-signals.ts:3-5`). Counted whatever the reminder setting —
   `readReleaseReminders` returns nothing at all with reminders off (`order-groups.ts:1507-1508`),
   which is why the count is its own read.
3. **`timingBand` counts fired dishes only**: the floor read's `unserved_lines` filter
   `wol.served_at is null and ti.id is not null` (`apps/server/src/working-order.ts:8121`) becomes
   `… and ti.fired_at is not null`, matching the long-wait signal (`table-signals.ts:74`). Firing
   resets a dish's `queued_at` to the fire time (`working-order.ts:2496`), so a released course
   starts fresh. Every consumer of `timingBand`, traced (`git grep -n timingBand -- apps packages`,
   tests aside): the card's outline and Forgotten badge and the Forgotten chip's suppression
   (`apps/till/src/screens/till-floor-screen.ts:140,2353,2369`), the unplaced token's outline and
   marker through `toFloorTable` (`packages/ui/src/floor.ts:100`, `wt-table-token.ts:255,266`), the
   map's corner dot (`apps/till/src/state/floor-map.ts:26`) and the order screen's status pin words
   (`apps/till/src/widgets/table-status.ts:28`). All of them stop marking a table whose only old
   dishes are held — the map dot included, which §6 calls wrong today. That is the server fix's
   effect, not the map's new look (slice 5). The server's only producer is `listTablesWithState`,
   read by `/api/tables` (`apps/server/src/till-api.ts:2679`).
4. **In this slice: the card's chip, its countdown and the filled amber due chip; the unplaced
   token the same.** §11 item 3 names "the chip and its countdown on the card and the unplaced
   token"; §5.1 says "the chip becomes the filled amber ▶ Time to fire". **Out: the card outline's
   pulse** ("and the card's outline pulses slowly (section 5.2)") and the motion tokens and
   keyframes — §11 item 4 lists "the two motion tokens and keyframes". **Out: the map** — placed
   tables get no "⏸ 4′" / "▶ Fire" cue and no amber fill (§5.1 "On the map…", §6, and §11 item 5
   "`wt-floor-map` takes one state per table").
5. **The held chip goes last among the card's chips.** Ranking the chips is slice 4's (§4 "which chip
   comes first", §11 item 4); held is §4's row 12, the lowest of the things a seated table can show.
6. **The due chip keeps its own mark.** The card's `[data-fire-due]` badge (`till-floor-screen.ts:2373-2377`)
   and the token's (`wt-table-token.ts:312-318`) stay where they are, restyled filled
   (`--wt-color-warning` / `--wt-color-on-warning`, both declared in
   `packages/ui-core/src/tokens/colors.css:26-27,148-149`) with a ▶ icon. The held chip goes through
   the existing `FloorChip` list, so the card and the token get it from one function.
7. **Icons are registered by `packages/ui/src/floor-chips.ts` when it loads**, as
   `packages/ui/src/components/wt-data-table.ts:23` registers its own, under the names `held` and
   `fire`. A harness mounting one widget never loads an app's `main.ts`, so an app-registered icon
   draws an empty box there (`docs/developers/testing-guide.md`, "A screenshot is saved only to a
   path…", last paragraphs).
8. **The quiet chip's border is `--wt-color-text-muted`** (a new tone, `muted`, named for its
   border so it is not confused with the "neutral chip tokens" every tone paints on): picture 03 draws
   the held chip with a dark grey border, unlike the coloured tones. The LOOK task compares it.
9. **The minute redraw is one timer**, at the next moment any table's shown minutes change, worked
   out again from the screen's clock on every draw (`#watchReminders`, `till-floor-screen.ts:785-796`,
   which today waits only for the next due time). Only a table with a `held` signal and a due time
   ahead counts down. It runs whether the list or the map is showing: the tray's token shows the
   countdown, and slice 5's map cue will need it too.
10. **Unchanged in this slice:** the table details sheet's "Time to fire" line
    (`apps/till/src/widgets/table-details-sheet.ts:195`, reached from the map; §11 item 3 does not
    name it); the card's "N to serve" badge, which still counts held dishes (`pending_to_serve`,
    `working-order.ts:8090`; §5.3's counts by state are slice 6); the counter's Held
    orders rows and the order screen, whose `signalChips` calls (`held-orders.ts:237`,
    `till-table-order-screen.ts:3956`) get no chip for the new signal.
11. **No user guide changes.** The guides are `content-and-images.md`, `modifiers.md` and
    `products.md` in each of `apps/server/src/guide/en` and `/es` (`ls`); none describes the floor
    (`git grep -n -i "time to fire\|forgotten" -- apps/server/src/guide` finds nothing).
    `design-system.md`'s floor-screen paragraph gains a sentence (Task 6).

### Measured in plan writing (2026-10-20)

In a scratch copy of this worktree (`cp -c -R`, its `.git` pointer removed, deleted after), with
Decision 3's one-word change and a probe test — a party with a fired Caña and a held Burger, the
held ticket item's `queued_at` set 16 minutes back: `timingBand` read `fresh`; then every ticket
item 16 minutes back: `forgotten`. Control: without the change the same test failed `expected
'forgotten' to be 'fresh'`. The 60 `apps/server` test files that name `floorRow`,
`listTablesWithState`, `getTablesState`, `/api/tables`, `readPartySignals`, `tableSignals` or
`timingBand` then printed `Test Files 60 passed (60)`, `Tests 2845 passed (2845)` — no existing
assertion depends on held dishes counting.

Then, with a throwaway `held` signal implemented as Decision 2 says: the same 60 files printed
`Tests 4 failed | 2841 passed`, all four in `table-signals.test.ts`; with the five assertion edits
listed in Task 2, that file printed `Tests 19 passed (19)`, including "reads every kind of fact
once for the whole floor, not once per table" — so the count adds no per-table statement.
`pnpm --filter @waitron/server typecheck` passed; `pnpm --filter @waitron/till typecheck` failed
only at `src/widgets/signal-chips.ts(24,36)`, the exhaustive switch Task 2 extends. Not measured:
`apps/till` and `packages/ui` test runs.

Re-run by the plan review (2026-10-20), in a second scratch copy made the same way: Task 1's
probe failed `expected 'forgotten' to be 'fresh'` before the change and passed after it; then a
throwaway `readHeldCounts` and `held` push left the same 60 files at `Tests 4 failed | 2841 passed
(2845)`, the four the five edits in Task 2 cover; `@waitron/till` typecheck failed only at
`src/widgets/signal-chips.ts(24,36)` and `@waitron/dashboard` typecheck passed.

## Review focus

1. **Reminders off:** the chip reads "Held 2" and never counts down or falls due — tests in Tasks 2
   and 5.
2. **A minute boundary:** 4 min 0.001 s left reads "fire in 5 min"; exactly 4 min reads "fire in 4
   min"; 1 ms reads "fire in 1 min" — tests in Task 4, and the redraw landing on those moments in
   Task 5.
3. **Coming back to the page minutes later:** the countdown reads the time left now, without a
   floor read — test in Task 5.
4. **A held dish partly cancelled, weighed, or with an extra:** counted as what is left, as one, and
   without the extra — test in Task 2.
5. **A reminder time that cannot be read:** "Held 2", no countdown, and no timer kept running — test
   in Task 5.

---

### Task 1: `timingBand` counts fired dishes only

**Files:**
- Modify: `apps/server/src/working-order.ts:8121` (the filter), `:8107-8111` (the SQL comment, which
  says "a HELD one included"), `:8020` (`TableState.timingBand`'s doc comment: "over those unserved
  lines" → "over those unserved lines that were fired")
- Modify: `apps/till/src/api/client.ts:2192-2199` (the doc comment: "held ones included" → "fired
  ones only: a held dish does not age here")
- Test: `apps/server/src/table-signals.test.ts` (one case, beside "does not count a held dish as
  waiting, however long ago it was taken", `:421-430`)

**Interfaces:** produces no new name. `TableState.timingBand` keeps its type; it now reflects fired
dishes only.

- [ ] **Step 1: Write the failing test** — `"does not let an old held dish turn the table's band, while an old fired one does"`:
  `setupPartyVenue`; seat Mesa 2; `order(v, tabId, "Caña")`; `holdGroup(v, partyId, "Burger")`;
  set `queued_at` 16 minutes back on the ticket items with `fired_at` null only
  (`tx.update(ticketItems).set({ queuedAt }).where(isNull(ticketItems.firedAt))`) →
  `expect((await floorRow(v, mesa2)).timingBand).toBe("fresh")`; then `queuedAgo(v, tabId, 16)` →
  `toBe("forgotten")`.
- [ ] **Step 2: Run it and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts -t "old held dish"`
  Expected: FAIL, `expected 'forgotten' to be 'fresh'`.
- [ ] **Step 3: Change the filter and the three comments.**
- [ ] **Step 4: Run the file, then the floor-read tests.**
  `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts src/tables.test.ts src/kitchen-timing-consumers.test.ts src/working-order-reads.sqlite.test.ts`
  Expected: every file passes.
- [ ] **Step 5:** typecheck `@waitron/server` and `@waitron/till`; prettier; commit —
  `"A held dish no longer makes a table read late on the floor (A757 slice 3)"`.

**Assertions changed:** none (measured, above).

### Task 2: the floor read carries each party's held count

**Files:**
- Modify: `packages/shared/src/table-signals.ts:14-17` (the new kind, with its doc comment)
- Modify: `apps/server/src/order-groups.ts` (new `readHeldCounts`, after `readReleaseReminders`,
  which ends at `:1569`)
- Modify: `apps/server/src/table-signals.ts:166-249` (`readPartySignals` reads the counts once and
  pushes the signal before `release_due`, `:234`)
- Modify: `apps/till/src/widgets/signal-chips.ts:54-57` (`case "held":` joins the cases that give no
  chip; the doc comment at `:15-19` names it: the floor draws it with its countdown)
- Test: `apps/server/src/table-signals.test.ts`, `apps/till/src/widgets/signal-chips.test.ts`

**Interfaces — produces:**
- `TableSignal` gains `| { kind: "held"; count: number }`, doc comment: "Dishes waiting in the
  party's held groups, counted as items: a counted dish by its quantity, a weighed dish as one,
  extras not at all."
- `readHeldCounts(tx: Transaction, partyIds: readonly string[]): Promise<Map<string, number>>` —
  keyed by party, only parties holding at least one dish; one select (lines → `order_groups` →
  `parties` → `working_orders`, left join `line_service_cancellations`), filters as Decision 2.
  An empty list answers an empty map without a query.
- `readPartySignals` pushes `{ kind: "held", count }` when the count is above 0.

- [ ] **Step 1: Write the failing tests** in `table-signals.test.ts` (its `holdGroup`, `:120-133`,
  takes dish names, one each):
  - `"marks a table holding dishes with how many, with reminders off"` —
    `writeReleaseReminderMinutes(tx, null)`; `holdGroup(v, partyId, "Burger", "Burger", "Paella")`
    → signals `toEqual([{ kind: "held", count: 3 }])` (no `release_due`).
  - `"counts each party's own held dishes, and stops once the group is fired"` — Mesa 2 holds two,
    Mesa 3 one → `{ kind: "held", count: 2 }` and `count: 1`; `fireGroup` Mesa 2's group → Mesa 2's
    signals hold no `held` (`not.toContainEqual(expect.objectContaining({ kind: "held" }))`).
  - `"counts a held dish by what is left after a cancellation, a weighed dish as one, and no extra"` —
    hold Burger and Paella with quantity 2 each (place with `placeGroups` directly, `quantity: "2"`);
    insert a `line_service_cancellations` row for the Burger line with `quantity: 1000` (as
    `line-service-operations.test.ts:65-71` does) → count 3; set the Paella line's
    `unit_precision = 3, quantity = 350` → count 2; insert an extra line on the Burger
    (`parent_line_id` = the Burger line, same `group_id`, the columns
    `working-order-reads.sqlite.test.ts:196-207` fills) → still 2; cancel the Burger's last unit
    (UPDATE its cancellation row to `quantity: 2000` — `line_id` is that table's primary key,
    `packages/db/src/schema/line-service-cancellations.ts:9`, so a second insert is refused) →
    count 1; insert a cancellation of the whole weighed Paella (`quantity: 350`) → no `held`
    signal at all (a weighed dish counts one only while some of it is left, Decision 2).
  - `"readHeldCounts answers an empty list without reading"` — `readHeldCounts(tx, [])` →
    `toEqual(new Map())`.
  In `signal-chips.test.ts`, add `{ kind: "held", count: 2 }` to a new case
  `"gives no chip for held dishes, which the floor draws with their countdown"` → `toEqual([])`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts`
  Expected: the new cases FAIL (no `held` signal; no `readHeldCounts` export). Then
  `pnpm --filter @waitron/till exec vitest run src/widgets/signal-chips.test.ts`: the new case
  FAILS (with no `case "held":` the switch returns `undefined`, which `flatMap` keeps as an entry).
- [ ] **Step 3: Implement** the kind, `readHeldCounts`, the push, and the till's `case "held":`.
- [ ] **Step 4: Edit the five assertions listed below, then run.**
  `pnpm --filter @waitron/server exec vitest run src/table-signals.test.ts src/tables.test.ts src/kitchen-timing-consumers.test.ts src/till-api.groups.test.ts src/current-orders.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/widgets/signal-chips.test.ts`.
  Expected: PASS. Any other red case is a stop.
- [ ] **Step 5:** typecheck `@waitron/shared`, `@waitron/server`, `@waitron/till`; prettier; commit —
  `"The floor read says how many dishes each party has held (A757 slice 3)"`.

**Assertions changed** (each is an expected list of a party that holds dishes, which the spec now
marks: §5.1 "Every table with held dishes … shows a quiet chip"; all measured, above), in
`apps/server/src/table-signals.test.ts`:
- `:276-280` — gains `{ kind: "held", count: 1 }` between the `ready` and `release_due` entries.
- `:429` — `toEqual([])` becomes `toEqual([{ kind: "held", count: 1 }])`; the case's point, no
  `long_wait` for a held dish, still holds.
- `:445-447` — gains `{ kind: "held", count: 2 }` before `held_unavailable`.
- `:463` — `toEqual([])` becomes `toEqual([{ kind: "held", count: 2 }])`.
- `:569-573` — the kinds list gains `"held"` after `"ready"`.

### Task 3: floor chips draw an icon and a quiet tone; the due chip is filled amber

**Files:**
- Modify: `packages/ui/src/floor.ts:14-23` (`FloorChipTone` gains `"muted"`; `FloorChip` gains
  `icon?: string`)
- Modify: `packages/ui/src/floor-chips.ts` (import `./components/wt-icon.js` and register `held`
  and `fire`; `.chip` gains `gap: var(--wt-space-1)`; `.chip.tone-muted` border
  `var(--wt-color-text-muted)`; `renderFloorChips` draws
  `<wt-icon name=${chip.icon} size="sm"></wt-icon>` before the text when `icon` is set)
- Modify: `packages/ui/src/components/wt-table-token.ts:209-213` (`.badge.fire-due`: background
  `--wt-color-warning`, colour `--wt-color-on-warning`, border `--wt-color-warning`) and `:312-318`
  (both variants of the chip draw `<wt-icon name="fire" size="sm"></wt-icon>` first)
- Test: `packages/ui/src/components/wt-table-token.test.ts`, `wt-table-token.a11y.test.ts`

**Interfaces — produces:** `FloorChip { key; text; tone; icon?: string }` — `icon` names a
registered `wt-icon`; `FloorChipTone` adds `"muted"`; icons `held` (path
`M4 3h3v10H4zM9 3h3v10H9z`) and `fire` (path `M5 3v10l8-5z`) registered whenever
`@waitron/ui`'s floor chips load.

- [ ] **Step 1: Write the failing tests** in `wt-table-token.test.ts`:
  - in "the signal chips": `"draws a chip's icon before its words, and none for a chip without one"`
    — chips `[{ key: "held", text: "Held 2", tone: "muted", icon: "held" }, { key: "ready", text: "Bar: 1 ready", tone: "success" }]`
    → the held chip's first element child is `wt-icon[name=held]`, whose shadow root holds an
    `svg path`; the ready chip holds no `wt-icon`; the held chip's `textContent.trim()` is `Held 2`;
    with `--wt-space-1` set on the host to `7px`, the held chip's computed `columnGap` is `7px`
    (the new `gap`: `packages/ui` is mutation-tested, so a style with no assertion is a surviving
    mutant).
  - `"a muted chip paints its words on the neutral chip tokens with --wt-color-text-muted as its border"`
    — the shape of the tone cases at `:224-245`, with `--wt-color-text-muted`.
  - in "the fire-due chip": `"draws the fire icon before its words, labelled or not"` — in both
    variants the chip's first element child is `wt-icon[name=fire]` whose shadow root holds an
    `svg path` (so an empty registered path fails it), and the labelled one's text is still its
    label.
  In `wt-table-token.a11y.test.ts`: `"a token with a held chip and its icon is accessible"` and
  `"a token with the filled due chip is accessible"`, each in both themes, as the file's cases are;
  each first asserts its icon's `svg path` is drawn, so neither passes before Task 3's change.
- [ ] **Step 2: Edit the one assertion listed below**, then run and watch the new cases and it fail.
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-table-token.test.ts src/components/wt-table-token.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, plus `pnpm --filter @waitron/ui exec vitest run src/floor.test.ts src/no-hardcoded-chrome.test.ts`
  and `pnpm exec vitest run scripts/style-token-names.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/ui` and `@waitron/till`; prettier; commit —
  `"Floor chips can carry an icon; Time to fire is a filled amber chip (A757 slice 3)"`.

**Assertions changed:** `wt-table-token.test.ts:180-193`, "paints its words on the neutral chip
tokens with the warning token as its border": renamed `"paints its words on the warning and
on-warning tokens"`; it sets `--wt-color-warning` and `--wt-color-on-warning` to two distinct
values, keeps setting `--wt-color-surface-raised` and `--wt-color-text` to two more (so the old
paint fails it), and expects `backgroundColor` and `borderTopColor` to be the warning value,
`borderTopStyle` still `solid`, and `color` the on-warning value — four checks, as before
(the spec changes what it checks: §5.1 "the filled amber ▶ Time to fire"). Not measured; any other
red case is a stop. The existing "a token carrying a chip of every tone is accessible" (`a11y:124-140`)
is left as it is; the muted tone gets its own case.

### Task 4: the held chip's words and the countdown's arithmetic

**Files:**
- Modify: `apps/till/src/state/release-reminder.ts` (two functions)
- Modify: `apps/till/src/widgets/signal-chips.ts` (new `heldChip`)
- Modify: `apps/till/src/i18n/strings.ts` (four keys beside `floor.fire_due`, `:860` and `:2445`)
- Test: `apps/till/src/state/release-reminder.test.ts`, `apps/till/src/widgets/signal-chips.test.ts`

**Interfaces:**
- Consumes: `FloorChip` with `icon` and tone `"muted"` (Task 3); the `held` signal (Task 2).
- Produces:
  - `minutesToFire(dueAt: number, now: number): number` — `Math.ceil((dueAt - now) / 60_000)`;
    for `dueAt > now` only.
  - `nextCountdownChange(dueAt: number, now: number): number` — the moment the shown minutes next
    change: `dueAt - (minutesToFire(dueAt, now) - 1) * 60_000` (equals `dueAt` in the last minute).
  - `heldChip(signals: readonly TableSignal[], dueAt: number, now: number): FloorChip | null` —
    `null` with no `held` signal, or when `dueAt <= now` (the Time to fire mark shows instead);
    otherwise `{ key: "held", text, tone: "muted", icon: "held" }`, `text` from
    `countText(count, "floor.held", "floor.held_one")` when `dueAt` is `Infinity`, else from
    `countText(count, "floor.held_fire_in", "floor.held_fire_in_one")` with `{m}` replaced by
    `minutesToFire(dueAt, now)`. `dueAt` is `reminderDueAt(party?.reminder)` (`release-reminder.ts:7-10`),
    `Infinity` for no reminder, no time, or an unreadable one.
  - Strings — EN: `"floor.held": "Held {n}"`, `"floor.held_one": "Held 1"`,
    `"floor.held_fire_in": "Held {n} · fire in {m} min"`, `"floor.held_fire_in_one": "Held 1 · fire in {m} min"`;
    ES: `"{n} retenidos"`, `"1 retenido"`, `"{n} retenidos · marchar en {m} min"`,
    `"1 retenido · marchar en {m} min"`.

- [ ] **Step 1: Write the failing tests.**
  `release-reminder.test.ts`: `minutesToFire` with `dueAt = D`: `D - 240_000` → 4, `D - 240_001` →
  5, `D - 241_000` → 5, `D - 239_999` → 4, `D - 60_000` → 1, `D - 1` → 1. `nextCountdownChange`:
  from `D - 240_001` → `D - 240_000`; from `D - 240_000` → `D - 180_000`; from `D - 30_000` → `D`.
  `signal-chips.test.ts` (`setLocale("en")`, as the file's `beforeEach` does): no `held` signal →
  `null`; held 2, `dueAt = now` → `null`; held 2, `dueAt = now - 60_000` (past due) → `null`;
  held 2, `Infinity` →
  `toEqual({ key: "held", text: "Held 2", tone: "muted", icon: "held" })`; held 2, 4 min ahead →
  text `Held 2 · fire in 4 min`; held 1, 1 ms ahead → `Held 1 · fire in 1 min`; in Spanish
  (`setLocale("es")`), held 2, 4 min ahead → `es["floor.held_fire_in"]` with `{n}` 2 and `{m}` 4,
  and held 1 with no time → `es["floor.held_one"]`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/state/release-reminder.test.ts src/widgets/signal-chips.test.ts`
- [ ] **Step 3: Implement** the two functions, `heldChip` and the eight strings.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The held chip's words and its countdown, in English and Spanish (A757 slice 3)"`.

**Assertions changed:** none.

### Task 5: the floor shows the held chip, counts it down, and fills Time to fire

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — `tableChips` (`:138-141`) takes `now` and
  appends `heldChip(table.signals, reminderDueAt(table.party?.reminder), now)` when not null; its
  two callers (`#toFloorTable`, `:1990`, and `#card`, `:2378`) pass `this.#drawnAt`;
  `.badge.fire-due` (`:536-541`) filled as the token's (Task 3) and the badge at `:2373-2377` draws
  `<wt-icon name="fire" size="sm"></wt-icon>` before its words; `#watchReminders` (`:785-796`)
  takes, for a table with a `held` signal and a due time ahead, `nextCountdownChange(dueAt, this.#drawnAt)`
  instead of `dueAt`, and its doc comment says it also redraws each minute a countdown changes;
  the `now` property's doc comment (`:621-622`, "redraws the floor when the next reminder falls
  due") says the same.
- Create: `apps/till/src/screens/till-floor-screen.held.test.ts` (fixtures and `mountAt` as
  `till-floor-screen.parties.test.ts:10-80,568-595` build them)
- Modify: `apps/till/src/screens/till-floor-screen.a11y.test.ts` (one new case in the
  `describe.each` of themes, `:296`)

**Interfaces — consumes:** `heldChip`, `nextCountdownChange` (Task 4); icon `fire` (Task 3).

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.held.test.ts`; a held table is
  `seated({ signals: [{ kind: "held", count: 2 }] }, { reminder })`, the clock injected (`now`)
  unless the case says otherwise:
  - `"shows Held 2 on the card while the reminder has no time, and with reminders off"` — reminder
    `{ groupId: "g2", dueAt: null }` and `null` → `[data-chip="held"]` text `Held 2`, a
    `wt-icon[name=held]` inside it, no `[data-fire-due]`.
  - `"counts down on the card: Held 2 · fire in 4 min"` — due `at(240_000)`; and `at(1)` →
    `Held 2 · fire in 1 min`.
  - `"turns into the filled Time to fire when due, and drops the held chip"` — due `at(0)` →
    `[data-fire-due]` text `Time to fire` holding `wt-icon[name=fire]`, no `[data-chip="held"]`;
    with `--wt-color-warning` and `--wt-color-on-warning` set on the host to distinct values, the
    badge's `backgroundColor` and `borderTopColor` read the warning value and its `color` the
    on-warning one.
  - `"shows the held chip and its countdown on an unplaced table's token"` — as
    `parties.test.ts:628-635` mounts the tray → the token's `[data-chip="held"]` text
    `Held 2 · fire in 4 min`.
  - `"says it in Spanish"` — `setLocale("es")` → the text from the `es` dictionary (restore the
    locale after, CLAUDE.md §4).
  - On the screen's own clock (`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })`,
    `vi.setSystemTime(now)`, `vi.useRealTimers()` in `afterEach`, as `parties.test.ts:637-660` does —
    no animation frame is faked). These cases mount with `mountAt(tables, "real")`, leaving `now`
    unset: `#watchReminders` starts no timer at all while `now` is injected (`if (this.now !==
    undefined || !this.isConnected) return;`, `till-floor-screen.ts:788`), so an injected clock
    would make every one of them pass or fail for the wrong reason:
    - `"redraws each minute the countdown changes, with no new floor read"` — due `at(150_000)` →
      `fire in 3 min`; advance 30 000 ms → `fire in 2 min`; advance 60 000 → `fire in 1 min`;
      advance 60 000 → the due chip.
    - `"keeps no timer for a held table with no time or an unreadable one"` — reminders
      `{ dueAt: null }` and `{ dueAt: "not a time" }`; `vi.spyOn(el, "requestUpdate")`; advance
      120 000 ms → not called; the chip reads `Held 2`.
    - `"reads the time left now on coming back to the page"` — due `at(300_000)`; remove the
      element, advance 120 000, put it back, `await vi.advanceTimersByTimeAsync(0)` (reconnecting
      sets a timer already past due, which fires on the next turn) → `fire in 3 min`.
  In `till-floor-screen.a11y.test.ts`: `"has no violations with held dishes counting down and a reminder due, on the list"`
  — it first asserts the `[data-chip="held"]` chip and the `[data-fire-due]` badge's
  `wt-icon[name=fire]` are drawn, so it cannot pass on a list that shows neither.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.held.test.ts src/screens/till-floor-screen.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and every floor-screen file
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen` — check free memory
  first) — PASS. `[data-fire-due]` keeps its words for the existing cases
  (`till-floor-screen.parties.test.ts:596-660`, `signals.test.ts:134`): `wt-icon` has no light-DOM
  text.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The floor counts down to Time to fire for a table holding dishes (A757 slice 3)"`.

**Assertions changed:** none expected (not measured). Any red case outside the new tests is a stop.

### Task 6: docs

**Files:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`, `docs/backlog.md`,
`docs/backlog/till.md`, `docs/developers/design-system.md`.

- [ ] **Step 1: The spec.** Status line (`:3`): slice 3 joins the built slices ("slices 1, 2, 3 and
  7 built …; slices 4–6 and 8 left (§11)" — check `git log --oneline origin/main | grep A757` for
  what has landed by then). After §5.1's last paragraph, a dated line: "**2026-10-2x:** built by
  slice 3 (plan `docs/superpowers/plans/2026-10-20-a757-3-held-mark-countdown.md`): the floor read
  carries a `held` signal with the count; the list card and the unplaced token show the held chip,
  its countdown and the filled Time to fire chip; `timingBand` counts fired dishes only. The pulse is
  slice 4's, the map's cue slice 5's; requested dishes wait for A773-2." After §1.2's "Not shown
  today" paragraph, one dated line pointing at it.
- [ ] **Step 2: `docs/backlog.md`.** A757 (`:2167-2182`): slice 3 joins the landed slices with this
  plan's path; "slices 3–6 and 8 are left" → "slices 4–6 and 8 are left". A893 (`:2184-2187`):
  "(slices 3–6 and 8 are left)" → "(slices 4–6 and 8 are left)". Delete the finished bullet "The
  floor's older waiting band (`timingBand`) still counts HELD dishes…" (`:2934-2936`) from "Loose
  ends left by service Task 10"; its other two bullets stay.
- [ ] **Step 3: `docs/backlog/till.md`.** In A757's section, the sentence listing landed slices
  (`:1272-1277`) gains slice 3; delete the finished bullet "**Items held in the kitchen.** …"
  (`:1319-1321`). In "Task 10 (#908…)" (`:2455-2461`) the `timingBand` half is finished, and the
  spec cites it (§5.1 "This settles Task 10's open point"), so it moves, not goes: take the
  `timingBand` sentences out of that bullet (leaving "Decided by A757 …; built in A757's slice 4:"
  and the Take order / Bill requested part), and add under `## Decisions and deliberate limits`
  (`:1484`) a `###` entry: "**`timingBand` counts only dishes sent (A757 Q17, owner 2026-10-17;
  built by A757 slice 3).** A held dish does not turn a card's outline, its Forgotten badge, the
  map's dot or the order screen's pin, however long it is held; firing restarts its age."
- [ ] **Step 4: `design-system.md`** — in the floor screen paragraph (`:840-843`, "On the till's floor
  screen…"), after "Bill requested chips share the map's purple tokens.": "A table holding dishes
  shows a quiet chip with a pause icon, “Held 2”, which counts down, “Held 2 · fire in 4 min”, once
  its reminder has a time; when that time comes the filled amber “Time to fire” chip, with a play
  icon, takes its place, on the list card and the unplaced token alike. `@waitron/ui`'s
  `floor-chips.ts` registers both icons."
- [ ] **Step 5: Check for missed claims.**
  `git grep -n -i -E "timingBand|held dish|time to fire|counts held" -- docs/backlog.md docs/backlog docs/developers apps/server/src/guide`
  — every hit is true after this slice, or is history inside a dated plan or spec (left alone).
  `pnpm exec prettier --file-info <file>` on each changed doc (`docs/` is ignored whole).
- [ ] **Step 6: Commit** — `"Docs: A757 slice 3, the held mark and its countdown, is built"`.

### Task 7: LOOK — the held chip in real Chromium

**Files:** a throwaway test `apps/till/src/screens/till-floor-screen.held-look.test.ts` (deleted,
never committed); pictures saved under `__screenshots__/a757-3/` (a path Vite allows,
testing-guide.md "A screenshot is saved only to a path Vite's `server.fs` configuration allows"),
then copied to `/Users/clintongormley/waitron-campaign-c/a757-3-shots/`; notes in
`/Users/clintongormley/waitron-campaign-c/a757-3-look-report.md`, following
`/Users/clintongormley/waitron-campaign-c/a757-2-look-report.md`.

- [ ] **Step 1:** Mount `till-floor-screen` with an injected `now` and the theme argument of
  `mountWidget`, as the A669 case does (`till-floor-screen.a11y.test.ts:243-292`: `page.viewport`,
  `window.innerWidth` read and recorded, the incoming size restored in `finally`). One zone with a
  plan. Tables, after picture 03's T7 (party "T7", 4 seats, €38.40): held 2 with no time; held 2
  due in 4 min; held 2 due now; and an unplaced table held 2 due in 4 min (no `today` placement), in
  the tray. List view and map view (the toggle), light and dark, `page.viewport(390, 844)` and
  `(1280, 900)` — `held-<view>-<width>-<theme>.png`, plus one Spanish list picture at 390 in each
  theme.
- [ ] **Step 2:** Look at every picture beside picture 03 (and `-dark`). Check: the held chip's
  border reads quiet beside the coloured chips, in both themes (Decision 8); the icons draw (not
  empty boxes) and sit on the text's line; the filled due chip's words are readable in both themes;
  "Held 2 · fire in 4 min" and the Spanish wording wrap inside a card at 390 with
  `document.documentElement.scrollWidth` equal to the viewport; the tray token shows the same chip.
  Note how the card's "N to serve" badge reads beside the held chip (Decision 10) for the owner.
  Write per-picture notes and any concern into the report. A defect found is fixed with a failing
  test first, in the component's own test file, and committed.
- [ ] **Step 3:** Delete the throwaway test and the `__screenshots__/a757-3/` copies; `git status`
  shows neither.

---

## Open points (each with the default this plan builds)

1. **The Spanish singular** `1 retenido` / `1 retenido · marchar en {m} min`: the design gives only
   the plural. Default as written; a candidate owner question for the watcher to batch, since
   changing a string later costs one line.
2. **The quiet chip's border colour** (`--wt-color-text-muted`, Decision 8) is read from picture 03,
   which draws it, rather than named in the design. The LOOK task compares; the owner sees it in A893.
3. **The table details sheet** keeps only its "Time to fire" line (Decision 10). If the owner wants
   the held count there too, it is a one-line addition in slice 5, which owns the map and its
   details.
4. **Review weight:** settled — FULL, by the driver's ruling (header).
