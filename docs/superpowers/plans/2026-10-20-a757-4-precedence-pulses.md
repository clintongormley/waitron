# A757 slice 4 — The precedence order, two pulses and the calm card: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (driver ruling, 2026-10-20, overriding design §11 item 4's LIGHT and this
plan's first ruling): `apps/till` now consumes a new `@waitron/ui` export (`floor-ring.ts`:
`floorRingStyles`, `renderFloorRing`, `FloorRing`) and three new `packages/ui-core` tokens, and
`wt-table-token` changes what it draws — a cross-package contract. So **every task gets its
per-task review**, and `/finish-branch` runs the full wave, including the Codex run-it seat (two
angles on a risk-trigger branch). The changes stay additive: no type in `packages/shared`
(`TableSignal`, `packages/shared/src/table-signals.ts:7-26`, is untouched), and no public property
or event of a `packages/ui` component — `wt-table-token` keeps `table`, `labels`, `locale` and
`reducedMotion` (`packages/ui/src/components/wt-table-token.ts:238-246`), and `FloorTable`,
`FloorChip` and `FloorChipTone` (`packages/ui/src/floor.ts:16-47`) keep their shape.
`wt-table-token`'s only consumer is `apps/till` (`git grep -n "wt-table-token\|toFloorTable\b\|FloorTable\b" -- apps
packages ':!*.test.ts'` names only `apps/till/src/screens/till-floor-screen.ts` outside the package).
**If a task finds it must change `FloorTable`, `FloorChip`, `TableSignal` or a component's
properties, it stops and reports**: that is a contract change this plan does not make (Open point
6 puts the token's full order in slice 5). **No migration**: no task touches `packages/db`, a schema or a `drizzle` folder (the
file lists below). **Nothing fiscal.** **One pull request for the whole slice.** Branch
`feat/a757-4-precedence-pulses`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-4-precedence-pulses`, from `main` at
`e18f619cd`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** when a table needs several things at once, its list card says the most urgent first and
draws only that one's outline; Overdue and Time to fire pulse slowly and Forgotten fast, with a
still look under reduced motion; Waiting's outline is amber; Reserved is the map's pale amber; and a
seated table that needs nothing looks calm — a soft left edge and "✓ Nothing needed".

**Architecture:** one till function, `tableStates`, lists the §4 states a table is in, most urgent
first, from the same facts the card already draws its marks from. The card takes its outline (a
ring) and its calm look from the first of them, and sorts every mark it draws by the same order.
`@waitron/ui` gains `floor-ring.ts` — the one keyframe set, a slow and a fast speed reading two new
tokens, and the ring the card and the unplaced token both draw. The kitchen screen and the pass keep
their own flash and only read the fast token.

**Tech stack:** TypeScript, Lit, Vitest in real Chromium (`apps/till`, `packages/ui`,
`packages/ui-core`).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` — "Decided" (Q17, Q18,
Q20, Q32, Q33, Q34), §4 (lines 235-281), §5.1, §5.2 (333-364), §5.4 (382-389), §9 (514-530), §11
item 4 (564-566). Pictures `docs/backlog/mockups/a757-table-states/04-pulse-speeds.png`,
`06-chips.png`, `07-precedence.png`, `11-calm.png` and the `-dark` variants of 04, 07 and 11.

## What the pictures show (read 2026-10-20, quoted from the images)

- **04, "Two pulse speeds".** Caption: "Waiting (5 min) does not pulse; its outline turns amber.
  Overdue (10 min) pulses slowly, every 2 s. Forgotten (15 min) pulses fast, every 1 s. Only a ring
  around the card or table moves: never the fill, never the words." Cards: "Overdue · slow, a
  2-second cycle" drawn as "0 s and 2 s: bright" (a thick red outline with a paler red halo outside
  it) and "1 s: dim" (only a pale pink outline); "Forgotten · fast, a 1-second cycle", "0 s and 1 s:
  bright" and "0.5 s: dim", with a filled red "⏱ Forgotten" badge. Every card keeps its blue left
  edge. "Waiting · no pulse": an amber outline (dark amber in light, light amber in dark) and a "⏱
  Waiting" chip with an amber border; "Outline amber, matching its chip (today it is blue)."
  "Reduced motion · nothing moves": T3 Overdue with a thick red outline all round and its blue left
  edge; T5 Forgotten with a wide red left edge in place of the blue one, a thin red outline and its
  filled badge; "Overdue: thick red outline. Forgotten: red edge, and its filled badge."
- **06, "Q20 · Reserved and Take order — decided: A".** "Both were a chip with a blue border.
  Reserved takes the map's pale amber; Take order is now a service step and looks like every step."
  Decided: T8, green left edge, "Free", then "Reserved 21:00" on a pale amber fill with dark text and
  no visible border.
- **07, "One order of precedence".** "When a table needs several things, the highest one in this
  list decides the table's colour on the map, its card's outline and first chip, and the zone tab.
  The card still lists every chip. The symbols stand in for the till's own icons." The Card column:
  1 "⏱ Forgotten" filled red; 2 "⏱ Overdue" red border; 3 "⊘ Unavailable: Lubina" red border; 4 "▶
  Time to fire" filled amber; 5 "🙋 Waiter called" filled purple; 6 "€ Bill requested" filled
  purple; 7 "🍽 Grill: 2 ready" green border; 8 "🛎 Dessert? | Done"; 9 "✎ Ana: not sent" dashed
  amber; 10 "⏱ Waiting" amber border; 11 "Mark cleared"; 12 "⏸ Held 2 · fire in 4 min" grey border;
  13 "✓ Nothing needed" in muted text with no border or fill; 14 "Reserved 21:00" pale amber fill;
  15 "Free" in muted text. Moves: "fast (1 s)" for 1, "slow (2 s)" for 2 and 4, "no (Q33)" for 7,
  "no" elsewhere. Reduced motion: 1 "red fill; card red edge", 2 "thick red outline", 4 "amber fill;
  card thick amber outline".
- **11, "Nothing needed: its own look".** "A seated table with nothing to do — no step, no late
  order, nothing due, ready or requested — looks calm: a pale tint of the seated blue and “✓”. Solid
  seated blue now means “go to this table” (a step, or an order not sent). Free stays pale green."
  Cards: T12 "Free" with a green left edge; T9 "€64.10 · 7 items" and "✓ Nothing needed" in muted
  text, with a pale blue left edge; T8 "⏸ Held 2 · fire in 4 min", also with the pale blue left
  edge; T6 "🛎 Dessert? | Done" with the solid blue left edge. In the dark picture the calm edges are
  a dark navy and T6's a bright blue.

## Global constraints

- **Words.** English `Nothing needed`, Spanish `Nada pendiente` (§9 line 520-521). The ✓ is an icon
  drawn with `wt-icon`, not text (spec lines 11-15). No other new words: every other mark keeps its
  string.
- **English in code.** Spanish only in `apps/till/src/i18n/strings.ts`; a test of Spanish reads its
  expected text from that file's `es` dictionary.
- **Every colour, spacing, duration and opacity reads a `--wt-*` token** (CLAUDE.md §3). The floor
  card's 2px outline literal (`till-floor-screen.ts:410-417`) goes: the ring is `--wt-space-1`
  thick, as the token's accent already is (`wt-table-token.ts:73-82`).
- **Coverage 98/98/98/95** in `apps/till`, `packages/ui` and `packages/ui-core`. `packages/ui` and
  `packages/ui-core` are mutation-tested (each has `"mutation": "stryker run"` in its
  `package.json`): every new style, branch and map entry in `packages/ui` gets an assertion that
  fails without it (slice 3's practice).
- **No new `wt-*` primitive.** The ring is a span inside existing components.
- **Changing an existing test assertion is a stop** unless this plan lists it under "Assertions
  changed" in its task. Anything else that turns red is a stop and a report, not an edit. Each
  listed edit checks at least as much as before, and the pull request's description lists every one
  with the spec line that changes what it pins.
- Every commit `git commit -s`. Every task ends with its focused tests (read the `Tests` count — a
  run that prints none proves nothing; unset `AI_AGENT` and `CLAUDECODE` to see console output),
  `pnpm --filter <pkg> typecheck` for each package it touched, and `pnpm exec prettier --check
  <changed files>`. Every package here runs in real Chromium: check free memory first
  (`memory_pressure | grep free`). An implementer past about 150 tool calls with the task unfinished
  stops at a passing or cleanly red point, commits, and returns a handover (done, left, files, each
  check's state).

## Decisions (with receipts)

1. **The ranking lives in the till**, `apps/till/src/state/table-precedence.ts`, over the till's own
   `TableState` (`apps/till/src/api/client.ts:2187-2221`). The map (slice 5), the zone tabs (slice
   5) and the card all read the till's table; putting it in `packages/ui` would need a new shared
   type that slice 5 owns.
2. **The states that exist today, and the facts each reads.** The rule is: the rank reads the same
   facts the card already draws its marks from, so a mark and the rank never disagree.

   | §4 row | Kind | In it when | The card's mark today |
   |---|---|---|---|
   | 1 | `forgotten` | `lateBand(table) === "forgotten"` | Forgotten badge (`till-floor-screen.ts:2405-2407`) |
   | 2 | `overdue` | `lateBand(table) === "overdue"` | long-wait chip (`signal-chips.ts:39-43`) |
   | 3 | `unavailable` | a `held_unavailable` signal | chip (`signal-chips.ts:44-51`) |
   | 4 | `fire` | `table.party !== null` and `reminderDueAt(table.party.reminder) <= now` | Time to fire badge, from the same test (`#fireDue`, `till-floor-screen.ts:798-800`) |
   | 5 | — | Waiter called (A508) is not built: no kind | — |
   | 6 | `bill` | a `bill_requested` signal | chip (`signal-chips.ts:52-55`) |
   | 7 | `ready` | a `ready` signal, or `readyToServe > 0`, or `enRoute > 0` | station chips, or `#hint`'s ready / en route badge (`till-floor-screen.ts:2489-2507`) |
   | 8 | `step` | a `take_order` signal — today's only step; §3 (lines 213-220) and §5.4 make Take order a service step | chip (`signal-chips.ts:28-29`) |
   | 9 | `not-sent` | `table.party?.unsentDrafts` not empty — the server sends `unsent_draft` exactly then (`apps/server/src/table-signals.ts:225-230`) | unsent badges (`#unsent`, `till-floor-screen.ts:2469-2475`) |
   | 10 | `waiting` | `lateBand(table) === "warm"` | long-wait chip |
   | 11 | `clearing` | `table.condition === "needs_clearing"` | its own card (`#waitingCard`) |
   | 12 | `held` | a `held` signal and not `fire` | held chip, which `heldChip` drops once due (`signal-chips.ts:69-84`) |
   | 13 | `nothing-needed` | `table.party !== null` and none of rows 1–12 | new (Task 7) |
   | 14 | `reserved` | `table.nextReservation !== null` | Reserved badge (`till-floor-screen.ts:2397-2403`) |
   | 15 | `free` | `table.state === "free"` and `table.condition === "free"` | "Free" (`#occupancy`) |

   Requested (A773-2) and service steps beyond Take order (slice 8) are not built and get no kind.
   They slot in by inserting a name into the ordered list: Waiter called between `fire` and `bill`;
   slice 8's step signal maps to `step`. A table §4 does not cover — a counter delivery waiting at a
   table no party holds (`state: "delivery-pending"`) — has no kind but `reserved` when booked; its
   card keeps its red left edge (`till-floor-screen.ts:392-394`). A table that needs moving today
   (`needsMovingToday`) draws its own waiting card before `#card` ranks anything
   (`till-floor-screen.ts:2386-2387`), so it gets no ring and no calm look. Nobody is meant to be
   seated there until it is marked moved (`apps/till/src/state/floor-today.ts:286-287`; `openTab`
   refuses it, `apps/server/src/working-order.ts:1632-1634`), so `tableStates` reads only its other
   facts, such as a booking, while today's map fills it as clearing
   (`apps/till/src/state/floor-map.ts:19`). Open point 9.
3. **"Nothing needed", precisely:** a table with a party (`party !== null`) that is in none of rows
   1–12 — no late or waiting dish by either reckoning (Decision 4), no unavailable held dish, no
   reminder due, no bill request, nothing ready or en route, no Take order, no unsent draft, and
   nothing held. A held course still counting down (row 12) is calm too (§9 lines 521-522) but shows
   its held chip, not the ✓. Paid parties: Decision 9.
4. **The waiting band is the worse of the card's two reckonings.** `lateBand(table) =
   worstBand([table.timingBand, long_wait band or "fresh"])` (`worstBand`,
   `packages/shared/src/timing.ts`). The card's outline and Forgotten badge read `timingBand` today;
   its chips read the `long_wait` signal. By reading, both count the same lines — unserved, fired,
   not made at the till (`apps/server/src/working-order.ts:8234,8242` against
   `apps/server/src/table-signals.ts:74-76`) — and differ in one thing: `timingBand` floors each
   age to whole minutes (`minutesSince`, `working-order.ts:7108-7110`, used at `:8280`) while the
   signal uses the exact age (`table-signals.ts:123`), so `timingBand` can lag by under a minute.
   Not measured. Reading the worse keeps a "Waiting" chip from sitting beside "✓ Nothing needed"
   or under no outline. The Forgotten badge, the forgotten chip's suppression (`tableChips`,
   `till-floor-screen.ts:139-144`) and the `timingBand` handed to the unplaced token
   (`#toFloorTable`, `:1987-2015`) read `lateBand` too. **Out:** the map's dot and the order
   screen's pin keep reading `timingBand` (slice 5, Decision 5).
5. **The order screen's status pin is slice 5's.** `statusPin` returns the map's `FloorMapFill` and
   `FloorMapDot` (`apps/till/src/state/floor-map.ts:111-119`), both worked out by `fillOf` and
   `dotOf` (`:17-28`) for the map, and slice 5 replaces those with one state per table (§11 item 5).
   Changing the pin now would mean drawing it twice.
6. **The card: the highest state decides the outline; there is one outline at most.** It is a
   ring, a `<span data-ring>` laid over the card's edge (`position: absolute; inset: 0`, an inset
   `box-shadow` `--wt-space-1` thick), drawn only for these tops:

   | Top | Ring colour | Moves (motion allowed) | Reduced motion |
   |---|---|---|---|
   | `forgotten` | `--wt-color-danger` | fast | steady ring, and the card's left edge turns `--wt-color-danger` at `--wt-space-3` wide; its badge stays |
   | `overdue` | `--wt-color-danger` | slow | steady ring (the thick red outline) |
   | `fire` | `--wt-color-warning` | slow | steady ring (the thick amber outline) |
   | `waiting` | `--wt-color-warning` (was `--wt-color-primary`, `till-floor-screen.ts:410-412`) | no | steady ring |

   Any other top draws no ring — so a table whose bill is requested while a dish waits shows no
   amber outline (§4 line 240, "the highest one … decides the card's outline"; Open point 2). The
   ring moves by its opacity, from 1 to `--wt-opacity-pulse-dim` (0.3) and back, ease in and out
   (§5.2 lines 345-348); the fill and the words never move. Picture 04's paler halo outside the
   bright frame is not drawn (Open point 4). The motion test is the screen's own
   `#prefersReducedMotion()` (`till-floor-screen.ts:2229-2231`), so an injected `reducedMotion`
   decides it; `floor-ring.ts` adds a `prefers-reduced-motion` media rule as a second line, as
   today's flash has (`:435-439`).
7. **The card's marks are sorted by the same order; every mark stays.** Today's `.badges` order is
   `#hint`, Reserved, Forgotten, Time to fire, then the signal chips in the server's order, then the
   held chip (`till-floor-screen.ts:2395-2417`), and the unsent badges sit above it in their own
   column (`:2394`, `:2469-2475`). After: one list, stably sorted by Decision 2's order — Forgotten
   badge, Overdue chip, Unavailable chips, Time to fire badge, Bill requested chip, ready chips or
   the ready / en route badge, Take order chip, unsent badges (moved into `.badges`), Waiting chip,
   held chip, "✓ Nothing needed", Reserved badge — then the one mark that is not a state, "N to
   serve", last. Marks of one kind keep their order (two stations' ready chips; two unsent drafts).
   `tableChips` sorts the chips the same way, so the unplaced token's chips follow it too. The
   other callers of `signalChips` — the table details sheet (`table-details-sheet.ts:211`), held
   orders (`held-orders.ts:243`) and the order screen (`till-table-order-screen.ts:4039`) — are not
   the card and keep the server's order. The details sheet opens from the map
   (`wt-table-details`, `till-floor-screen.ts:2179`) and from the order screen's status pin
   (`table-status.ts:157`), both slice 5's, so slice 5 decides it (Task 10 puts it on slice 5's
   list).
8. **The calm look:** when the top is `held` or `nothing-needed`, the card's left edge is
   `--wt-color-primary-disabled` (`#8fb7f5` light, `#28344a` dark, `packages/ui-core/src/tokens/colors.css:21,143`)
   instead of `--wt-color-primary`. Picture 11 draws a pale blue edge (light) and a dark navy one
   (dark); this is the nearest existing token, and the map's own pale blue is a new token slice 5
   adds (§6 lines 413-416), so this slice adds none (Open point 1). "✓ Nothing needed" is muted
   text: `--wt-color-text-muted`, `--wt-font-size-sm`, `--wt-font-weight-bold`, no border or fill,
   the icon `floor-check` at `size="sm"` with `flex: none` and `color: inherit` (slice 3 found an
   icon that shrinks or takes the page's colour without them, #1914).
9. **A paid party still seated** whose top is `nothing-needed` keeps today's "Paid"
   (`#occupancy`, `till-floor-screen.ts:2511-2521`; `partyPaid`,
   `apps/till/src/widgets/table-details-sheet.ts:24-28`) and gets the soft edge, but no "✓ Nothing
   needed" line: §9 line 522, "A paid party still seated shows “Paid”, as today" (Open point 3).
10. **Reserved takes the map's colours** on the card and on the token: background and border
    `--wt-color-table-reserved`, text `--wt-color-on-table-reserved` (`colors.css:119-120,236-237`),
    replacing the primary border on a neutral chip (`till-floor-screen.ts:524-528`,
    `wt-table-token.ts:203-207`). §5.4 lines 384-385; picture 06.
11. **The unplaced token** (`wt-table-token`) draws the same ring, worked out from the two fields it
    already has, in §4's order among them: `timingBand` forgotten, then overdue, then `fireDue`, then
    warm. It does not learn the full order, which would need a new `FloorTable` field — a contract
    change slice 5 makes with the map's one state per table (Open point 6). Its reduced-motion Forgotten edge is the card's;
    its triangle marker stays (`wt-table-token.ts:106-124,259-265`). The floor screen hands the tray
    token its `reducedMotion` (`#trayItem`, `till-floor-screen.ts:2196-2214`, passes none today).
    The token gets no calm look (§9 names the map and the card).
12. **The kitchen screen and the pass move to the fast token, in this slice**: one line each
    (`apps/till/src/widgets/station-queue.ts:447-450`, `apps/till/src/screens/till-expo-screen.ts:209-211`)
    from `1s` to `var(--wt-duration-pulse-fast)`, keeping their own `age-forgotten-flash` keyframes,
    which fade a left border to transparent — the shared ring keyframe would change what they look
    like, which §5.2 line 359 rules out ("with no visible change").
13. **A third token, `--wt-opacity-pulse-dim: 0.3`,** beside `--wt-opacity-disabled` and
    `--wt-opacity-hover` (`packages/ui-core/src/tokens/structure.css:40-41`), which are tokens too.
    The design names only the two durations (§5.2 lines 354-355) and the 30% in words (line 345).
    Open point 5.
14. **One keyframe set, in `packages/ui/src/floor-ring.ts`:** `@keyframes wt-pulse { 50% { opacity:
    var(--wt-opacity-pulse-dim); } }`, classes `.wt-pulse-slow` and `.wt-pulse-fast` running it over
    `--wt-duration-pulse-slow` / `-fast`, `ease-in-out`, `infinite`. The classes sit on the element
    that moves, not on a `::after`, so slice 5 can put them on a map table's SVG ring. Removed:
    the card's and the token's own `age-forgotten-flash` (`till-floor-screen.ts:425-439`,
    `wt-table-token.ts:90-104`).
15. **No icons on the other chips yet.** Picture 07's card column puts ⏱, ⊘, €, 🍽 and ✎ before the
    chips' words; §11 item 4 does not list them, and the map's cue (slice 5) needs the same icons.
    Open point 7. The ✓ is in, because §9 names it as the calm look.
16. **No user guide changes.** The guides are `content-and-images.md`, `modifiers.md` and
    `products.md` in each of `apps/server/src/guide/en` and `/es` (`ls`), and
    `git grep -n -i "outline\|forgotten\|overdue\|reserved\|floor\|pulse\|flash" -- apps/server/src/guide`
    finds nothing.

### Measured in plan writing (2026-10-20)

In this worktree at `e18f619cd`, a throwaway test in `packages/ui/src/` (deleted after; `git status`
clean): a Lit element whose styles held `@keyframes probe-pulse { 50% { opacity: var(--probe-dim); } }`
and `animation: probe-pulse var(--probe-dur) ease-in-out infinite`, mounted with `mount` from
`packages/ui/src/test-helpers.ts`, the host given `--probe-dim: 0.3` and `--probe-dur: 2000ms`.
`pnpm --filter @waitron/ui exec vitest run src/zz-pulse-probe.test.ts` printed `Tests 1 passed (1)`
and logged: computed `animationDuration` `2s`, `getAnimations()` length 1; paused, `currentTime =
1000` → computed opacity `0.3`, `0` → `1`, `500` → `0.65`; the host's `--probe-dur` set to 3000ms →
`3s`. Had `var()` not resolved inside the keyframe, the half-way reading would have been `1`, the
element's own opacity. So a custom property can carry both the speed and the dim value, and a test
can sample the ring at half a cycle. Not measured: any existing `apps/till` or `packages/ui` suite
against the changes below; the assertions listed are found by `git grep` and reading, and any other
red case is a stop.

## Review focus

1. **Precedence picks one outline:** Forgotten with Time to fire draws one red, fast ring; Bill
   requested with Waiting draws none — Task 5.
2. **The two reckonings:** a `long_wait` signal with `timingBand: "fresh"` outlines the card and
   keeps it from reading calm — Tasks 4, 5 and 7.
3. **Reduced motion:** nothing animates; Forgotten's left edge is red and wide and its badge stays —
   Tasks 3 and 5.
4. **No mark lost:** a card with every kind at once still shows every mark, in §4's order, with "N
   to serve" last — Task 6.
5. **The kitchen screen and the pass look the same:** still 1 s by default — Task 8.

---

### Task 1: the pulse tokens

**Files:**
- Modify: `packages/ui-core/src/tokens/structure.css:40-47` — after `--wt-opacity-hover`:
  `--wt-opacity-pulse-dim: 0.3;`; after `--wt-duration-disclosure`: a one-line comment ("How long one
  pulse of a floor ring takes: slow for Overdue and Time to fire, fast for Forgotten.") and
  `--wt-duration-pulse-slow: 2000ms;`, `--wt-duration-pulse-fast: 1000ms;`
- Test: `packages/ui-core/src/tokens/structure.test.ts`

- [ ] **Step 1: Write the failing tests.** Add the three names to the list in "defines the
  structural contract" (`:22-74`) — this extends an existing assertion's input, listed below. New:
  `test("a slow pulse is 2 s and a fast one 1 s, twice as quick", …)` — `token(el,
  "--wt-duration-pulse-slow")` is `2000ms`, `-fast` is `1000ms`; `test("a pulse dims its ring to
  30%, still visible", …)` — `Number(token(el, "--wt-opacity-pulse-dim"))` is `0.3`, and between 0
  and 1 exclusive.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens/structure.test.ts`
- [ ] **Step 3: Add the tokens.**
- [ ] **Step 4: Run** the same command — PASS. Then `pnpm exec vitest run scripts/style-token-names.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/ui-core`; prettier; commit —
  `"Two pulse speeds and a dim level for the floor's rings (A757 slice 4)"`.

**Assertions changed:** `structure.test.ts:22-74`, "defines the structural contract": its list
gains `--wt-opacity-pulse-dim`, `--wt-duration-pulse-slow` and `--wt-duration-pulse-fast` (§5.2
lines 354-355). Every name already there stays.

### Task 2: one keyframe set, the ring, and the check icon

**Files:**
- Create: `packages/ui/src/floor-ring.ts`
- Modify: `packages/ui/src/index.ts:9` (export beside `floorChipStyles`)
- Modify: `packages/ui/src/floor-chips.ts:5-8` (register `floor-check`)
- Create: `packages/ui/src/floor-ring.test.ts`

**Interfaces — produces:**
- `export type FloorRing = "forgotten" | "overdue" | "fire" | "waiting";`
- `export const floorRingStyles: CSSResult` — `.ring { position: absolute; inset: 0;
  border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 var(--wt-space-1)
  currentColor; }`, `.ring-forgotten, .ring-overdue { color: var(--wt-color-danger); }`,
  `.ring-fire, .ring-waiting { color: var(--wt-color-warning); }`, Decision 14's keyframe and two
  classes, and `@media (prefers-reduced-motion: reduce) { .wt-pulse-slow, .wt-pulse-fast {
  animation: none; } }`. The host element must be `position: relative`.
- `export function renderFloorRing(ring: FloorRing | null, moving: boolean): TemplateResult | typeof nothing`
  — `nothing` for `null`; otherwise `<span class="ring ring-${ring} …" data-ring=${ring}
  aria-hidden="true"></span>`, with `wt-pulse-fast` for `forgotten`, `wt-pulse-slow` for `overdue`
  and `fire`, none for `waiting`, and none at all when `moving` is false. The speeds live in one
  `Record<FloorRing, "slow" | "fast" | null>`.
- Icon `floor-check`, a 16×16 tick, for example `M2 8.6l1.4-1.4 3 3L12.6 4 14 5.4l-7.6 7.6z`.

- [ ] **Step 1: Write the failing tests** in `floor-ring.test.ts`, on a test-only Lit element that
  includes `floorRingStyles`, renders `renderFloorRing(ring, moving)` inside a `position: relative`
  box, and is mounted with `mount` (`packages/ui/src/test-helpers.ts`):
  - `"draws no ring for no state"` — `null` → no `[data-ring]`.
  - `it.each` over the four rings with motion: the `[data-ring]` value; `aria-hidden="true"`; the
    pulse class (`wt-pulse-fast`, `wt-pulse-slow`, `wt-pulse-slow`, none).
  - `"moves nothing when motion is off"` — each ring with `moving: false` has no `wt-pulse-*` class
    and computed `animationName` `none`.
  - `"paints the ring from the danger and warning tokens"` — host `--wt-color-danger: rgb(1, 2, 3)`,
    `--wt-color-warning: rgb(4, 5, 6)`; the forgotten and overdue rings' computed `boxShadow`
    contains `rgb(1, 2, 3)`, the fire and waiting rings' `rgb(4, 5, 6)`; with `--wt-space-1: 7px`,
    the shadow contains `7px` and `inset`.
  - `"lies over its box, under nothing it could catch"` — computed `position` `absolute`, `top`,
    `left`, `right` and `bottom` `0px`, `pointerEvents` `none`, and its border radius equals the
    box's (give the box `border-radius: var(--wt-radius-md)` and set that token to `9px`).
  - `"pulses at each speed's token"` — host `--wt-duration-pulse-slow: 5000ms`,
    `--wt-duration-pulse-fast: 3000ms` → overdue's `animationDuration` `5s`, forgotten's `3s`; both
    `animationName` `wt-pulse`, `animationTimingFunction` `ease-in-out`,
    `animationIterationCount` `infinite`.
  - `"dims to the dim token half-way and is whole at the ends"` — host `--wt-opacity-pulse-dim:
    0.4`; `const [a] = ring.getAnimations(); a.pause(); a.currentTime = <half the duration>` →
    computed `opacity` `0.4`; `currentTime = 0` → `1` (the probe above).
  - `"registers the check icon"` — a `<wt-icon name="floor-check">` mounted after importing
    `./floor-chips.js` draws an `svg path` whose `d` attribute is not empty.
- [ ] **Step 2: Run and watch them fail.** `pnpm --filter @waitron/ui exec vitest run src/floor-ring.test.ts`
- [ ] **Step 3: Implement**, and export `floorRingStyles`, `renderFloorRing` and `type FloorRing`
  from `packages/ui/src/index.ts`.
- [ ] **Step 4: Run** the same command, plus `pnpm exec vitest run scripts/style-token-names.test.ts`
  — PASS. (`src/no-hardcoded-chrome.test.ts` reads only the styles of the constructors exported
  from `./components/*.ts`, `no-hardcoded-chrome.test.ts:6-25`, so it first sees
  `floorRingStyles` in Task 3, once `wt-table-token` includes them; write no literal colour, no
  `px` over 1 and no `rem` or `em` in `floor-ring.ts`.)
- [ ] **Step 5:** typecheck `@waitron/ui`; prettier; commit —
  `"One pulse and one ring for the floor, at two speeds (A757 slice 4)"`.

**Assertions changed:** none.

### Task 3: the unplaced token pulses, turns Waiting amber and paints Reserved pale amber

**Files:**
- Modify: `packages/ui/src/components/wt-table-token.ts` — styles: include `floorRingStyles`;
  remove `.card.age-warm`, `.card.age-overdue, .card.age-forgotten`, `.card.age-forgotten.flash`,
  `@keyframes age-forgotten-flash` and its media block (`:66-104`) and their comment; add
  `.card.edge-forgotten { border-left-color: var(--wt-color-danger); border-left-width:
  var(--wt-space-3); }` after the `.state-*` rules (`:54-64`); `.badge.reserved` (`:200-207`)
  background and border `--wt-color-table-reserved`, colour `--wt-color-on-table-reserved`.
  Render: `#timingAccentClass` (`:252-256`) becomes `#ring(t): FloorRing | null` (Decision 11's
  order); the card (`:271`) drops the `age-*`/`flash` classes, gains ` edge-forgotten` when the
  ring is `forgotten` and motion is reduced, and its first child is
  `renderFloorRing(this.#ring(t), !this.#prefersReducedMotion())`.
- Test: `packages/ui/src/components/wt-table-token.test.ts`, `wt-table-token.a11y.test.ts`

**Interfaces — consumes:** `floorRingStyles`, `renderFloorRing`, `FloorRing` (Task 2).

- [ ] **Step 1: Write the failing tests** (new cases in the describe at `:508`, renamed "the outline
  ring"):
  - `"rings a table whose reminder is due in amber, slowly"` — `fireDue: true`, motion allowed →
    `[data-ring="fire"]` with `wt-pulse-slow`; with `reducedMotion: true` the `fire` ring is still
    drawn, with no `wt-pulse-*` class and no `edge-forgotten` (§5.2 line 350, "Time to fire keeps a
    thick amber outline").
  - `"draws one ring, the most urgent"` — `timingBand: "forgotten", fireDue: true` → one
    `[data-ring]`, `forgotten`; `timingBand: "warm", fireDue: true` → `fire`; `timingBand:
    "overdue", fireDue: true` → `overdue`.
  - `"under reduced motion a forgotten table's left edge is wide and red"` — host
    `--wt-color-danger: rgb(1, 2, 3)`, `--wt-space-3: 9px`; card computed `borderLeftColor`
    `rgb(1, 2, 3)`, `borderLeftWidth` `9px`; with motion allowed, neither (the occupancy colour and
    `--wt-space-1`'s width).
  - `"paints Reserved on the map's reserved tokens"` — host `--wt-color-table-reserved: rgb(7, 8,
    9)`, `--wt-color-on-table-reserved: rgb(10, 11, 12)`, `--wt-color-surface-raised` and
    `--wt-color-text` set to two other values → `.badge.reserved` `backgroundColor` and
    `borderTopColor` `rgb(7, 8, 9)`, `color` `rgb(10, 11, 12)`.
  In `wt-table-token.a11y.test.ts`, two cases in its themes loop: an overdue token with motion
  allowed, and a forgotten one under reduced motion; each first asserts its `[data-ring]` is drawn.
- [ ] **Step 2: Edit the assertions listed below; run and watch the new cases and the edited ones
  fail.**
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-table-token.test.ts src/components/wt-table-token.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, plus `src/no-hardcoded-chrome.test.ts` and
  `src/floor-ring.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/ui` and `@waitron/till`; prettier; commit —
  `"The unplaced table pulses at two speeds, and Reserved takes the map's colour (A757 slice 4)"`.

**Assertions changed** (`wt-table-token.test.ts`, the describe "order-timing accent (timingBand)",
`:508-601`; §5.2 lines 337-352 change what each pins). Each `age-<band>` class check becomes a
`[data-ring="<ring>"]` check (warm → `waiting`), and each `flash` check becomes a check of the
ring's pulse class:
- `:509-515` fresh — `some(c => c.startsWith("age-"))` false → no `[data-ring]`; marker check kept.
- `:517-523` warm — `[data-ring="waiting"]`, no `wt-pulse-*` class; marker check kept. Renamed
  "renders a steady amber ring for a warm table, no pulse, no marker".
- `:525-531` overdue — `[data-ring="overdue"]`, and now `wt-pulse-slow` (§5.2 line 340); renamed
  "pulses slowly in red for an overdue table, no marker". It mounts with no `reducedMotion` today;
  because it now asserts a pulse, its mount passes `false` as `mountToken`'s third argument, as
  `:533-539` does, so it does not rest on the browser's own setting (see Task 5's note).
- `:533-539` forgotten, motion — `[data-ring="forgotten"]` with `wt-pulse-fast`; marker kept.
- `:541-548` forgotten, reduced — `[data-ring="forgotten"]` with no `wt-pulse-*`; the card has
  `edge-forgotten`; marker kept.
- `:550-555` "reduced motion never applies flash to a merely-overdue table" (it mounts with
  `reducedMotion` **false**) — renamed "an overdue table pulses slowly, never fast"; asserts
  `wt-pulse-slow` and not `wt-pulse-fast`; a second mount with `reducedMotion: true` asserts no
  `wt-pulse-*` and no `edge-forgotten`.
- `:557-562` coexists — `state-open-tab` kept; `age-forgotten` → `[data-ring="forgotten"]`.
- `:580-586` fresh — as `:509`; plus no `wt-pulse-*` anywhere in the shadow root.
- `:588-600` "with nothing injected, the flash follows the browser's own reduced-motion setting"
  — reads whether the ring has `wt-pulse-fast` instead of whether the card has `flash`; same two
  expectations.
The a11y cases at `wt-table-token.a11y.test.ts:68-76` (warm, forgotten) keep their axe checks
unchanged.

### Task 4: the order of precedence

**Files:**
- Create: `apps/till/src/state/table-precedence.ts`, `apps/till/src/state/table-precedence.test.ts`
- Modify: `apps/till/src/widgets/signal-chips.ts` (new `chipState`), `signal-chips.test.ts`

**Interfaces — produces:**
- `export const PRECEDENCE = ["forgotten", "overdue", "unavailable", "fire", "bill", "ready",
  "step", "not-sent", "waiting", "clearing", "held", "nothing-needed", "reserved", "free"] as const;`
  with a doc comment: "A757 §4's order, most urgent first, for the states that exist today; Waiter
  called (row 5, A508) goes between `fire` and `bill` when it is built."
  `export type TableStateKind = (typeof PRECEDENCE)[number];`
- `export function lateBand(table: TableState): TimingBand` — Decision 4.
- `export function tableStates(table: TableState, now: number): TableStateKind[]` — every kind
  Decision 2's table puts the table in, in `PRECEDENCE` order.
- `export function topState(table: TableState, now: number): TableStateKind | undefined` — the first.
- `export function byPrecedence<T>(items: readonly T[], kindOf: (item: T) => TableStateKind | undefined): T[]`
  — a stable sort by `PRECEDENCE` index, an `undefined` kind after every kind.
- `export function chipState(chip: FloorChip, signals: readonly TableSignal[]): TableStateKind | undefined`
  (in `signal-chips.ts`, which owns the chip keys) — `long-wait` → the `long_wait` signal's own band
  (`warm` → `waiting`, else the band's name); `held-unavailable` → `unavailable`; `bill-requested`
  → `bill`; `ready` → `ready`; `take-order` → `step`; `held` → `held`; any other key → `undefined`.

- [ ] **Step 1: Write the failing tests.** `table-precedence.test.ts`, with a `table()` fixture
  shaped like `till-floor-screen.signals.test.ts:51-72` (a seated party, no signals) and
  `now = Date.parse("2026-09-30T20:00:00.000Z")`:
  - one case per row of Decision 2's table: the fact alone → `tableStates` is that kind alone
    (with `nothing-needed` absent), e.g. `{ signals: [{ kind: "held_unavailable", groupId: "g2",
    lineNames: ["Flan"] }] }` → `["unavailable"]`; `party: null, state: "free", condition: "free"`
    → `["free"]`; with `nextReservation: { time: "21:00" }` → `["reserved", "free"]`; a seated party
    with nothing → `["nothing-needed"]`; `condition: "needs_clearing", party: null, state: "free"`
    → `["clearing"]`; `state: "delivery-pending", party: null, condition: "free"` → `[]`.
  - `"ready counts a ready signal, a ready count or an en route count"` — each alone → `["ready"]`.
  - `"held is calm while it counts down and gives way to Time to fire when due"` — `held` signal,
    reminder due in 4 min → `["held"]`; due now → `["fire"]`.
  - `"a reminder with no time, or none, is not due"` — `{ groupId: "g2", dueAt: null }` and `null` → no `fire`.
  - `"reads the worse of the two waiting reckonings"` — `timingBand: "fresh"` with a `long_wait`
    `overdue` signal → `lateBand` `overdue`; `timingBand: "forgotten"` with `warm` → `forgotten`;
    neither → `fresh`.
  - `"lists every state at once in §4's order"` — a seated table with a forgotten wait, an
    unavailable held dish, held dishes due to fire, a bill request, a ready signal, Take order, an
    unsent draft and a reservation → `["forgotten", "unavailable", "fire", "bill", "ready", "step",
    "not-sent", "reserved"]` (one waiting band at a time; held gives way to `fire`; a seated table
    is neither calm nor free); `topState` is `forgotten`.
  - `"orders T4 as the owner's Q34 example does"` — ready, bill requested and Take order →
    `["bill", "ready", "step"]` (§ "Open questions" Q34, spec lines 625-627).
  - `byPrecedence` keeps the order of equal kinds and puts `undefined` last.
  `signal-chips.test.ts`: `chipState` for every chip `signalChips` gives (the Spanish case's
  signals, `till-floor-screen.signals.test.ts:207-214`, give five kinds) and for the held chip; a
  `long-wait` chip reads `waiting` from a `warm` signal; an unknown key → `undefined`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/state/table-precedence.test.ts src/widgets/signal-chips.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"One order of precedence for a table's states (A757 slice 4)"`.

**Assertions changed:** none.

### Task 5: the card's ring

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — styles: include `floorRingStyles`
  (`:250-256`); `.card` (`:366-382`) gains `position: relative`; remove `.card.age-warm`,
  `.card.age-overdue, .card.age-forgotten`, the flash rule, `@keyframes age-forgotten-flash`, the
  media block and both comments (`:401-439`); add `.card.edge-forgotten` as the token's (Task 3)
  after `.card.clearing` (`:396-399`). Logic: `#timingAccentClass` (`:2233-2238`) goes; `#card`
  (`:2385-2419`) works out `top = topState(table, this.#drawnAt)`, renders
  `renderFloorRing(RING_OF[top] ?? null, !this.#prefersReducedMotion())` first inside the button,
  sets `data-top=${top ?? nothing}`, and adds ` edge-forgotten` when `top === "forgotten"` under
  reduced motion; the Forgotten badge shows when `lateBand(table) === "forgotten"` (was
  `table.timingBand`, `:2405`); `tableChips` (`:139-144`) passes `forgottenShown: lateBand(table) ===
  "forgotten"`; `#toFloorTable` (`:1987-2015`) hands the token `timingBand: lateBand(table)`;
  `#trayItem` (`:2202-2213`) passes `.reducedMotion=${this.reducedMotion}`. `RING_OF` maps
  `forgotten`, `overdue`, `fire` and `waiting` to their rings. Drop the `TimingBand` import (`:16`)
  if nothing else reads it.
- Create: `apps/till/src/screens/till-floor-screen.precedence.test.ts` (fixtures as
  `till-floor-screen.signals.test.ts:12-118`)
- Modify: `apps/till/src/screens/till-floor-screen.test.ts:345-413`,
  `apps/till/src/screens/till-floor-screen.a11y.test.ts` (one case in the themes loop, `:296`)

**Interfaces — consumes:** `topState`, `lateBand` (Task 4); `floorRingStyles`, `renderFloorRing`
(Task 2).

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.precedence.test.ts`. Every case
  that asserts a `wt-pulse-*` class, or its absence, passes `reducedMotion` explicitly (see the
  note under "Assertions changed"):
  - `"rings an overdue card in red, pulsing slowly at the slow token"` — `timingBand: "overdue"`,
    `reducedMotion: false`; host `--wt-duration-pulse-slow: 5000ms` → `[data-ring="overdue"]`,
    `wt-pulse-slow`, `animationDuration` `5s`; the card's `data-top` is `overdue`.
  - `"rings a forgotten card fast, keeps its badge, and dims the ring to the token half-way"` —
    `[data-ring="forgotten"]`, `wt-pulse-fast`, `[data-forgotten]` present; host
    `--wt-opacity-pulse-dim: 0.4` and the animation paused at half its duration → opacity `0.4`.
  - `"rings a card whose reminder is due in amber, pulsing slowly"` — reminder `dueAt` a minute past
    → `[data-ring="fire"]`, `wt-pulse-slow`; host `--wt-color-warning: rgb(4, 5, 6)` → the ring's
    `boxShadow` contains it.
  - `"rings a waiting card in steady amber, not blue"` — `long_wait` `warm` → `[data-ring="waiting"]`,
    no `wt-pulse-*`; host `--wt-color-warning: rgb(4, 5, 6)`, `--wt-color-primary: rgb(1, 2, 3)` →
    `boxShadow` contains `rgb(4, 5, 6)` and not `rgb(1, 2, 3)`.
  - `"draws only the most urgent state's ring"` — forgotten with a reminder due →
    `querySelectorAll("[data-ring]")` length 1, `forgotten`; a bill request with a `warm` wait → no
    `[data-ring]`, `data-top` `bill`.
  - `"outlines a card from its wait chip when the floored band has not caught up"` — `timingBand:
    "fresh"`, `long_wait` `overdue` → `[data-ring="overdue"]`; `long_wait` `forgotten` → the
    Forgotten badge, no `[data-chip="long-wait"]`.
  - `"moves nothing under reduced motion: a forgotten card's left edge turns wide and red"` —
    `reducedMotion: true`, forgotten → no `wt-pulse-*`, card `edge-forgotten`, host
    `--wt-color-danger: rgb(1, 2, 3)` and `--wt-space-3: 9px` → `borderLeftColor` `rgb(1, 2, 3)`,
    `borderLeftWidth` `9px`; the badge stays; overdue and fire rings are present and still.
  - `"hands its reduced motion to the unplaced token"` — a placed table plus an unplaced forgotten
    one, `reducedMotion: true` → the tray token's `[data-ring="forgotten"]` has no `wt-pulse-*`;
    `reducedMotion: false` → `wt-pulse-fast`.
  In `till-floor-screen.a11y.test.ts`: `"has no violations with an overdue, a forgotten and a due
  card ringed, on the list"` — first asserts three `[data-ring]`.
- [ ] **Step 2: Edit the assertions listed below; run and watch the new and edited cases fail.**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.precedence.test.ts src/screens/till-floor-screen.test.ts src/screens/till-floor-screen.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every floor-screen file (`pnpm --filter @waitron/till exec vitest run
  src/screens/till-floor-screen` — check free memory first) — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The floor card rings its most urgent state, pulsing at two speeds (A757 slice 4)"`.

**Assertions changed** (`till-floor-screen.test.ts`, the describe "order-timing accent
(timingBand)", `:345-413`; §5.2 lines 337-352 and §4 line 240 change what each pins), in the same
mapping as Task 3's:
- `:346-352` fresh — `state-free` kept; `some(c => c.startsWith("age-"))` false → no `[data-ring]`;
  badge check kept.
- `:354-360` warm — `[data-ring="waiting"]`, no `wt-pulse-*`; renamed "rings a warm table in
  steady amber, no pulse, no badge".
- `:362-368` overdue — `[data-ring="overdue"]` with `wt-pulse-slow`; renamed "pulses slowly in red
  for an overdue table, no badge". Its mount gains `reducedMotion: false`, as `:370-381` and
  `:394-402` already pass, because the case now asserts a pulse. Measured 2026-10-20 in this
  worktree: a throwaway `apps/till` test (deleted) printed
  `window.matchMedia("(prefers-reduced-motion: reduce)").matches` as `false` when run alone — but
  three till files switch the page to `reduce` with `commands.emulateReducedMotion`
  (`till-counter-cleanup.layout.test.ts:323`, `till-counter-cleanup.look.test.ts:98`,
  `till-shell.counter-cleanup.test.ts:143`), and whether that reaches another file in the same run
  was not measured, so no edited case rests on the default.
- `:370-381` forgotten, motion — `[data-ring="forgotten"]` with `wt-pulse-fast`; badge checks kept.
- `:383-392` forgotten, reduced — `[data-ring="forgotten"]`, no `wt-pulse-*`, card
  `edge-forgotten`; badge kept.
- `:394-402` "reduced motion never applies flash to a merely-overdue table" (mounts with
  `reducedMotion: false`) — renamed "an overdue table pulses slowly, never fast": `wt-pulse-slow`,
  not `wt-pulse-fast`, no `edge-forgotten`.
- `:404-412` coexists — `state-open-tab` kept; `age-forgotten` → `[data-ring="forgotten"]`.

### Task 6: the card's marks in the order of precedence

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — `tableChips` (`:139-144`) returns
  `byPrecedence(chips, (chip) => chipState(chip, table.signals))`; `#card` (`:2394-2417`) builds one
  list of `{ kind, mark }` — Forgotten badge (`forgotten`), Time to fire badge (`fire`), the
  `#hint` badge (en route and ready → `ready`, "N to serve" → `undefined`), each unsent badge
  (`not-sent`), Reserved (`reserved`), and each chip of `tableChips` (`chipState`) rendered one at
  a time with `renderFloorChips([chip])` — sorted with `byPrecedence` and drawn inside `.badges`;
  `#unsent` and its `.unsent` wrapper (`:2469-2475`, styles `:560-566`) go, the `.badge.unsent`
  rule (`:568-574`) stays, and `.badges` (`:500-504`) gains `max-width: 100%`. `#hint`
  (`:2489-2507`) returns its kind beside its mark.
- Test: `apps/till/src/screens/till-floor-screen.precedence.test.ts`,
  `apps/till/src/screens/till-floor-screen.signals.test.ts`

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.precedence.test.ts`, reading the
  `.badges` children's order by `data-*` names:
  - `"lists every mark, most urgent first, with N to serve last"` — a table with a forgotten wait,
    an unavailable held dish, a reminder due, a bill request, ready drinks, Take order, an unsent
    draft, a reservation, `readyToServe: 2` and `pendingToServe: 3` → `[data-forgotten]`, `[data-chip="held-unavailable"]`,
    `[data-fire-due]`, `[data-chip="bill-requested"]`, `[data-chip="ready"]`,
    `[data-chip="take-order"]`, `[data-unsent]`, `[data-reserved]`, then nothing after
    (`#hint` draws no badge while the stations' ready chips stand for the ready count,
    `till-floor-screen.ts:2486-2507`).
  - `"puts N to serve after the held chip"` — a held count with a due time ahead and
    `pendingToServe: 2` → `[data-chip="held"]`, then `[data-to-serve]`.
  - `"puts the overdue chip before the bill and the waiting chip after the unsent order"` — two
    tables.
  - `"keeps two unsent orders in their own order, inside the card at 390 px"` — reuses
    `till-floor-screen.parties.test.ts:524-554`'s long names with `page.viewport(390, 900)`.
  - `"orders the unplaced token's chips the same way"` — `mesa2` of `signals.test.ts:84-92` in the
    tray → `["Bill requested", "Bar: 3 ready"]`.
- [ ] **Step 2: Edit the assertions listed below; run and watch the new and edited cases fail.**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.precedence.test.ts src/screens/till-floor-screen.signals.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every floor-screen file — PASS. The unsent cases (the describe "a table's unsent orders",
  `till-floor-screen.parties.test.ts:328` on) read `[data-unsent]` inside the card and keep passing
  with the wrapper gone; a red one there is a stop.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The floor card lists its marks most urgent first (A757 slice 4)"`.

**Assertions changed** (`till-floor-screen.signals.test.ts`; §4 line 240, "which chip comes first",
and picture 07, "its card's outline and first chip"):
- `:133` `["Bar: 3 ready", "Bill requested"]` → `["Bill requested", "Bar: 3 ready"]` (row 6 before
  row 7); `:134` unchanged.
- `:144` (the tray token) — the same change.
- `:204-225` (Spanish) — the order becomes rows 2, 3, 6, 7, 7, 8: overdue, unavailable, bill,
  the two stations' ready chips, Take order. The edited lines may not carry Spanish (CLAUDE.md §3,
  English only; the guard skips `apps/*`, so review greps the diff), so the fixture's names become
  English (`"Bar"`, `"Kitchen"`, `"Steak"`) and the expected list is read from `es`
  (`import { en, es } from "../i18n/strings.js"`; `till-floor-screen.held.test.ts:4` imports
  `es` from the same path):
  `[es["signal.wait_overdue"], es["signal.unavailable"].replace("{items}", "Steak"),
  es["signal.bill_requested"], es["signal.ready_at"].replace("{station}", "Bar").replace("{n}",
  "3"), es["signal.ready_at_one"].replace("{station}", "Kitchen"), es["signal.take_order"]]`, with
  a check that each `es` value differs from its `en` one so the case still proves Spanish. Every
  chip is still there.

### Task 7: the calm look and Reserved's colour on the card

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — styles: `.card.calm { border-left-color:
  var(--wt-color-primary-disabled); }` after `.card.state-open-tab` (`:388-390`); `.calm-line`
  (Decision 8's text, `display: inline-flex; align-items: center; gap: var(--wt-space-1)`), with
  `.calm-line wt-icon { flex: none; color: inherit; }`; `.badge.reserved` (`:521-528`) as Decision
  10, its comment cut to one line or none. `#card`: the class ` calm` when `top` is `held` or
  `nothing-needed`; when `top === "nothing-needed"` and not `partyPaid(table)`, the mark `<span
  class="calm-line" data-nothing-needed><wt-icon name="floor-check" size="sm"></wt-icon>${t("floor.nothing_needed")}</span>`
  with kind `nothing-needed` in Task 6's list.
- Modify: `apps/till/src/i18n/strings.ts` — `"floor.nothing_needed": "Nothing needed"` beside
  `floor.paid` (`:953`), `"floor.nothing_needed": "Nada pendiente"` beside its Spanish (`:2570`).
- Test: `apps/till/src/screens/till-floor-screen.precedence.test.ts`,
  `apps/till/src/screens/till-floor-screen.a11y.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"says Nothing needed, muted, with a check, on a seated table that needs nothing"` —
    `[data-nothing-needed]` text `Nothing needed`, holding `wt-icon[name=floor-check]` whose shadow
    root draws an `svg path`; host `--wt-color-text-muted: rgb(1, 2, 3)` and `--wt-color-text: rgb(4,
    5, 6)` → its `color` `rgb(1, 2, 3)` and the icon's svg `fill` `rgb(1, 2, 3)`; the card has
    `calm`, and with `--wt-color-primary-disabled: rgb(7, 8, 9)` and `--wt-color-primary: rgb(10,
    11, 12)` its `borderLeftColor` is `rgb(7, 8, 9)`.
  - `"keeps the solid edge, and no check, once anything is needed"` — one table per kind of rows
    1–10 (a long wait, an unavailable dish, a reminder due, a bill, a ready count, Take order, an
    unsent draft, a `long_wait` signal with `timingBand: "fresh"`) → no `[data-nothing-needed]`, no
    `calm`, `borderLeftColor` the primary value.
  - `"a held course counting down is calm and shows its held chip, not the check"` — no
    `[data-nothing-needed]`, `calm` present, `[data-chip="held"]` present.
  - `"a paid party needing nothing shows Paid, with no check"` — `hasOpenTab: false`,
    `outstanding: "0.00"` → `[data-paid]`, no `[data-nothing-needed]`, `calm` present.
  - `"a free table is not calm and says Free"` — no `calm`, no `[data-nothing-needed]`.
  - `"says it in Spanish"` — `setLocale("es")` → the text is `es["floor.nothing_needed"]`; restore
    the locale after (CLAUDE.md §4).
  - `"paints Reserved on the map's reserved tokens"` — as Task 3's token case, on the card's
    `[data-reserved]`.
  In `till-floor-screen.a11y.test.ts`: `"has no violations with a calm table, a held one and a
  reserved one, on the list"` — first asserts `[data-nothing-needed]` and `[data-reserved]` drawn.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.precedence.test.ts src/screens/till-floor-screen.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every floor-screen file, plus `src/i18n` (the strings' own tests) — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"A seated table that needs nothing looks calm, and Reserved takes the map's pale amber (A757 slice 4)"`.

**Assertions changed:** none expected (no existing case reads the reserved badge's colours —
`git grep -n -i "reserved" -- 'apps/till/src/screens/*.test.ts' 'packages/ui/src/components/wt-table-token*.test.ts'`
piped to `grep -i "color\|primary\|border\|background"` prints nothing; cases that read a card's
whole text use `toContain`, e.g. `till-floor-screen.parties.test.ts:182-185`). Any red case
outside the new tests is a stop.

### Task 8: the kitchen screen and the pass read the fast token

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts:449` and `apps/till/src/screens/till-expo-screen.ts:210`
  — `1s` → `var(--wt-duration-pulse-fast)`.
- Test: `apps/till/src/widgets/station-queue.test.ts` (beside `:1097-1108`),
  `apps/till/src/screens/till-expo-screen.test.ts` (beside `:2057-2067`)

- [ ] **Step 1: Write the failing tests** — `"flashes a forgotten ticket at the fast pulse token,
  1 s by default"`: with motion allowed, the forgotten ticket's (and a forgotten `.cell`'s, in its
  own view) computed `animationDuration` is `1s` and `animationName` `age-forgotten-flash`; with the
  host's `--wt-duration-pulse-fast` set to `3000ms`, `3s`. The same for the pass's forgotten order
  card.
- [ ] **Step 2: Run and watch the token half fail** (the default `1s` passes before the change).
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/screens/till-expo-screen.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The kitchen screen and the pass flash at the shared fast pulse speed (A757 slice 4)"`.

**Assertions changed:** none.

### Task 9: docs

**Files:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`,
`docs/developers/design-system.md`.

- [ ] **Step 1: The spec.** Status line (`:3`): slice 4 joins the built slices ("slices 1, 2, 3, 4
  and 7 built …; slices 5, 6 and 8 left (§11)" — check `git log --oneline origin/main | grep A757`
  for what has landed by then). After §4's last paragraph (`:279-281`), after §5.2's last paragraph
  (`:362-364`), after §5.4 (`:389`) and after §9 (`:529-530`), each a dated line, the §5.2 one being:
  "**2026-10-2x:** built by slice 4 (plan `docs/superpowers/plans/2026-10-20-a757-4-precedence-pulses.md`):
  `--wt-duration-pulse-slow`, `--wt-duration-pulse-fast` and `--wt-opacity-pulse-dim` in
  `structure.css`, one keyframe set in `packages/ui/src/floor-ring.ts`; the list card and the
  unplaced token ring Overdue and Time to fire slowly, Forgotten fast and Waiting in steady amber;
  the kitchen screen and the pass read the fast token. The map, its dot and the zone tabs are slice
  5's." §4's: the till ranks a table's states with `tableStates`
  (`apps/till/src/state/table-precedence.ts`), and the card's outline and mark order follow it; the
  map, the zone tabs and the order screen's pin are slice 5's. §5.4's: Reserved is pale amber on the
  card and the token; Take order's step look is slice 8's. §9's: the card's calm look, with
  `--wt-color-primary-disabled` as its edge until slice 5 adds the map's pale blue.
- [ ] **Step 2: `design-system.md`.** The token list (`:475-476`) gains `--wt-opacity-pulse-dim`,
  `--wt-duration-pulse-slow`, `--wt-duration-pulse-fast`; after `--wt-duration-disclosure`'s
  sentence (`:501`): "`--wt-duration-pulse-slow` (2 s) and `--wt-duration-pulse-fast` (1 s) are one
  cycle of a floor ring's pulse, which dims it to `--wt-opacity-pulse-dim` (0.3) half-way;
  `packages/ui/src/floor-ring.ts` holds the one keyframe set. The kitchen screen's and the pass's
  forgotten flash read the fast one." In the floor paragraph (`:840-843`), change "`@waitron/ui`'s `floor-chips.ts` registers both
  icons" (`:843`) to say it registers the held, fire and check icons (`floor-check` is new), and after the held chip's
  sentence: "A table's states are ranked in A757 §4's order (`tableStates`,
  `apps/till/src/state/table-precedence.ts`). On the list card the most urgent decides the one
  outline — Forgotten red, pulsing fast; Overdue red and Time to fire amber, pulsing slowly; Waiting
  steady amber; no other state draws one — and every mark is listed in that order, “N to serve”
  last. Under reduced motion nothing moves and Forgotten's left edge turns wide and red. A seated
  table that needs nothing, or only waits on a held course, has a soft left edge; the first also
  says “✓ Nothing needed”. Reserved is pale amber on the card and the token. The unplaced token
  rings by its own timing band and due reminder only."
- [ ] **Step 3: Check for missed claims.**
  `git grep -n -i -E "age-warm|age-forgotten|flash|pulse|nothing needed|reserved colour|timing accent" -- docs/developers docs/backlog.md docs/backlog apps/server/src/guide`
  — every hit is true after this slice, or is about the map (slice 5) or history in a dated plan or
  spec. `design-system.md:924-925` (the map's dot "flashes once a second") stays: the map is slice
  5's. `pnpm exec prettier --file-info <file>` on each changed doc (`docs/` is ignored whole).
- [ ] **Step 4: Commit** — `"Docs: A757 slice 4, the precedence order, two pulses and the calm card, is built"`.

### Task 10: the backlog

Read `docs/backlog.md` → "How to keep this file honest" (`:6945` on) first.

- [ ] **Step 1: `docs/backlog.md`.** A757 (`:2177-2193`): slice 4 joins the landed slices with this
  plan's path; "slices 4–6 and 8 are left" → "slices 5, 6 and 8 are left". A893 (`:2195-2198`):
  "(slices 4–6 and 8 are left)" → "(slices 5, 6 and 8 are left)". Each open point below that the
  owner should see at A893 goes into A893's detail, not a new entry, unless it is work: Open points
  1, 6, 7 and 9 are slice 5's and go into a new list, in A757's detail in `docs/backlog/till.md`,
  of what slice 5 must do (the detail has no such list yet), with
  Decision 4's out-of-scope readers (the map's dot and the order screen's pin keep `timingBand`),
  Decision 5 (the status pin) and Decision 7's note that the table details sheet keeps the server's
  chip order.
- [ ] **Step 2: `docs/backlog/till.md`.** A757's landed-slices sentence (`:1272-1281`) gains slice 4
  with this plan and `docs/backlog/mockups/a757-table-states/built-4/`. A893 (`:1330-1360`) gains
  one bullet: "the choices slice 4 made where the pictures are silent (its plan's Open points 1–5,
  8 and 11)". The Task 10 bullet "Decided by A757 …; built in A757's slice 4" (`:2495-2498`): the
  Reserved half is built — it becomes "Decided by A757 (owner, 2026-10-17): Reserved takes the map's
  reserved colour (built by A757 slice 4); Take order becomes a service step (A757 slice 8)" with
  the rest of the bullet kept.
- [ ] **Step 3:** `pnpm exec prettier --file-info` on each; commit —
  `"Backlog: A757 slice 4 landed; slices 5, 6 and 8 left"`.

### Task 11: LOOK — the card and the token in real Chromium

**Files:** a throwaway test `apps/till/src/screens/till-floor-screen.precedence-look.test.ts`
(deleted, never committed); pictures saved under `__screenshots__/a757-4/` (a path Vite allows,
`docs/developers/testing-guide.md:1321-1334`), then copied to
`docs/backlog/mockups/a757-table-states/built-4/` and committed; notes in
`/Users/clintongormley/waitron-campaign-c/a757-4-look-report.md`.

- [ ] **Step 1:** Mount `till-floor-screen` with an injected `now` and the theme argument of
  `mountWidget`, as the viewport cases of `till-floor-screen.a11y.test.ts:243-292` do
  (`page.viewport`, `window.innerWidth` read and recorded, the incoming size restored in
  `finally`). One zone, list view, after pictures 04, 07 and 11 (party "T3", 4 seats, €38.40): one
  card per §4 row that exists (Forgotten, Overdue, Unavailable, Time to fire, Bill requested,
  Ready, Take order, Not sent, Waiting, Needs clearing, Held counting down, Nothing needed, Paid
  with nothing needed, Reserved, Free), and one card carrying five states at once. Light and dark,
  390 px and 1280 px, motion allowed with every animation paused at `currentTime = 0` (bright) and
  again at half its duration (dim), then `reducedMotion: true` —
  `precedence-<motion>-<frame>-<width>-<theme>.png`; one Spanish picture at 390 in each theme; a
  map view with an unplaced overdue and an unplaced due table in the tray, both themes.
- [ ] **Step 2:** Look at every picture beside 04, 06, 07 and 11 and their `-dark`. Check: each
  ring reads at its dim frame (30%) in both themes and is gone from no frame; Waiting's amber against
  Time to fire's amber (the ring of one is steady, the other's moves, and only Time to fire has the
  filled chip); the calm edge (`--wt-color-primary-disabled`) beside the solid blue in both themes
  (Open point 1); "✓ Nothing needed" muted but readable, its icon full size on the text's line;
  Reserved's pale amber readable in dark; the reduced-motion Forgotten edge; marks wrapping inside
  a card at 390 with `document.documentElement.scrollWidth` equal to the viewport. Write per-picture
  notes and any concern into the report. A defect found is fixed with a failing test first, in the
  file that owns it, and committed.
- [ ] **Step 3:** Delete the throwaway test and the `__screenshots__/a757-4/` copies; `git status`
  shows neither; commit the pictures — `"Pictures of the precedence order, the pulses and the calm card as built (A757 slice 4)"`.

---

## Open points for the owner (each with the default this plan builds)

1. **The calm left edge's colour** is `--wt-color-primary-disabled`, the nearest existing pale
   blue to picture 11's (Decision 8). Slice 5 adds the map's own pale blue token; it should then
   decide whether the card's edge moves to it.
2. **Only the most urgent state draws an outline** (Decision 6): a table with the bill requested and
   a dish waiting shows no amber outline, only the "Waiting" chip, because Bill requested ranks
   higher and has no outline of its own. The owner may prefer the Waiting outline kept beneath a
   state that draws none.
3. **A paid party still seated** shows "Paid" and the soft edge, without "✓ Nothing needed"
   (Decision 9).
4. **The ring is the card's own outline, dimming to 30%**; picture 04's paler halo outside the
   bright frame is not drawn (Decision 6). The LOOK compares.
5. **A third token, `--wt-opacity-pulse-dim`** (Decision 13), rather than the 30% written in.
6. **The unplaced token rings from its own two fields** (Decision 11), so a tray table with the bill
   requested and a dish waiting is outlined amber while its list card is not. Giving the token the
   full order needs a new `FloorTable` field, which fits slice 5's change to the map's contract.
7. **No icons yet on the wait, unavailable, bill, ready and unsent chips** (Decision 15); picture
   07 draws them. Slice 5 registers the map's cue icons, and the chips can take them then.
8. **"N to serve" now comes last** on the card, after every state (Decision 7); before, it came
   first when present.
9. **A table with a counter delivery waiting and no party** has no state in §4 (Decision 2): the
   rank gives it none, and slice 5 decides how the map draws it (today's map draws it seated,
   `apps/till/src/state/floor-map.ts:21`). Nor has **a table that needs moving today**: its card
   is unchanged, but the rank reads only its other facts, while today's map fills it as clearing
   (`floor-map.ts:19`); slice 5 decides.
10. **Review weight: FULL**, by the driver's ruling (header), because `apps/till` now reads a new
    `@waitron/ui` export; the design said LIGHT. Settled — listed so the owner sees the change.
11. **Take order** keeps its blue-bordered chip until slice 8 gives steps their look; it ranks as a
    step (row 8) now.
