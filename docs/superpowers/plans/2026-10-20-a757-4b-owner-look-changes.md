# A757 slice 4b — the owner's four look changes and the Spanish word for held dishes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** `floorRingStyles`, a `@waitron/ui` export that `apps/till` reads
(`apps/till/src/screens/till-floor-screen.ts:20,275`), changes what it draws — Waiting's outline
turns thin and every pulsing ring dims to a colour token instead of fading its opacity — and
`packages/ui-core` loses one token (`--wt-opacity-pulse-dim`) and gains three, which `apps/till`'s
till bar also reads (its Waiting tab dims to the new amber dim colour, driver ruling D1). Both are
cross-package contracts, so every task gets its per-task review and `/finish-branch` runs the full
wave (two Codex angles). No `FloorTable`, `FloorChip`, `TableSignal` or component property changes;
a task that finds it must change one stops and reports. **No migration, nothing fiscal, one pull
request.** Branch `feat/a757-4b-owner-look-changes`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a757-4b-owner-look-changes`, from `main` at
`0f2788281`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** the five owner answers of 2026-10-20 on the list card and the unplaced token, before slice
5 (the map and zone tabs) builds on them, plus the driver's three rulings below.

**Architecture:** the card's outline comes from the most urgent state that draws one, not from the
most urgent state; `floor-ring.ts` draws Waiting half as thick and dims a pulsing ring to a per-theme
colour token; the calm edge reads a new token; a paid calm party also says "✓ Nothing needed"; the
Spanish held chip says «en espera».

**Tech stack:** TypeScript, Lit, Vitest in real Chromium (`apps/till`, `apps/dashboard`,
`packages/ui`, `packages/ui-core`).

**Spec:** `docs/superpowers/specs/2026-10-17-a757-table-states-design.md` §4, §5.1, §5.2, §9; slice 4's
plan `docs/superpowers/plans/2026-10-20-a757-4-precedence-pulses.md` (Decisions 6, 8, 9, 13, 14 and
Open points 1–3, which these answers settle). Pictures: `docs/backlog/mockups/a757-table-states/4b-owner-changes.png`
and `4b-owner-changes-dark.png` (drawn with this plan), beside `04-pulse-speeds*.png`, `07-precedence*.png`,
`11-calm*.png` and slice 4's look report `/Users/clintongormley/waitron-campaign-c/a757-4-look-report.md`.

## The owner's answers (verbatim, campaign `questions.md`)

> "## OWNER ANSWERS — #1918 (A757-4) points: change all four (2026-10-20 ~15:15, via the watcher's picker)
> The owner was shown #1918's built defaults and chose to CHANGE all four of these (the other points in the PR stay as built):
> 1. **Keep the waiting outline** beneath a higher state that draws none — e.g. a table with the bill requested AND a dish waiting keeps the amber waiting outline, not just the "Waiting" chip.
> 2. **Fix the dark theme** — the calm table's pale left edge must stay clearly visible, and the dimmed pulsing outline must not turn brownish.
> 3. **Tell Waiting from Time to fire apart** — today both share one amber outline, so only the chip separates them on a still screen; give them visibly different outlines. Design the difference (picture both themes) and show it to the owner with the slice's other look results; no separate question needed unless the choice is not obvious.
> 4. **A paid party still seated also says "✓ Nothing needed"** beside "Paid".
> Fold them into slice 5 (which changes the map and its colours) or a small follow-up before it, whichever keeps slices clean; say in the PR which you did."

> "**OWNER ANSWER — #1914 R4, the Spanish word for held dishes (2026-10-20 ~13:35): «En espera» EVERYWHERE** — the floor chip changes from «retenidos» / «1 retenido» to «en espera» (e.g. «5 en espera · marchar en 4 min»), matching the order screen, station and find page. Queue it as a small follow-up (with the Spanish guide text if it names the word); English stays "Held"."

The driver's ruling: all five go in this small pull request, before slice 5. The PR says so ("a
small follow-up before slice 5").

The driver's further rulings (2026-10-20, plan review):

- **D1.** The till bar's Waiting tab, which today fades its amber border to `transparent` half-way
  (`apps/till/src/widgets/till-shell.ts:209-216`) and so passes through brown in dark, dims to the
  same `--wt-color-warning-pulse-dim` as the floor rings. In scope (Decision 7, Task 2).
- **D2.** The dashboard's «Retenido hasta marchar» follows «en espera» (Decision 6). Settled, not an
  open point.
- **D3.** The Waiting chip already says «En espera»; build as the owner decided and ask the owner
  after (Open point 1).

## Global constraints

- **Every colour, spacing, duration and opacity reads a `--wt-*` token** (CLAUDE.md §3). No hex in
  any component; `packages/ui`'s `no-hardcoded-chrome.test.ts` also refuses `color-mix(` and any
  px over 1 (`packages/ui/src/no-hardcoded-chrome.test.ts:39-56`), so the dim colours are tokens,
  not a mix computed in CSS.
- **English in code.** Spanish only in `strings.ts` / `help-strings.ts`; a test of Spanish reads
  its expected text from those files (`es`, `helpEs`), never a Spanish literal.
- **Words.** English unchanged everywhere ("Held 2", "Held 2 · fire in 4 min", "Nothing needed",
  "Paid"). Spanish held chip: `{n} en espera`, `1 en espera`, `{n} en espera · marchar en {m} min`,
  `1 en espera · marchar en {m} min` (lower-case, as the owner's example).
- **Coverage 98/98/98/95** in each package touched; `packages/ui` and `packages/ui-core` are
  mutation-tested — every new style value and branch gets an assertion that fails without it.
- **Changing an existing assertion is a stop** unless it is in "Changed test checks" below. Each
  listed edit checks at least as much as before; the PR description lists every one with the owner
  answer that changes it (owner rule 2026-10-05).
- Every commit `git commit -s`. Every task ends with its focused tests (read the `Tests` count; a run
  that prints none proves nothing; unset `AI_AGENT` and `CLAUDECODE` to see console output),
  `pnpm --filter <pkg> typecheck` for each package touched, and `pnpm exec prettier --check
  <changed files>` (`pnpm exec prettier --file-info <file>` for anything under `docs/`). Browser
  packages run in real Chromium: check `memory_pressure | grep free` first. An implementer past about
  150 tool calls with the task unfinished stops at a passing or cleanly red point, commits, and
  returns a handover (done, left, files, each check's state).

## Decisions (with receipts)

1. **Point 1 — one outline, from the most urgent state that draws one.** Today `#card` takes
   `top = topState(...)` and draws `RING_OF[top]` (`till-floor-screen.ts:2373-2374`), so a top
   with no ring draws none. Which states draw one: `RING_OF` (`:146-151`) holds `forgotten`,
   `overdue`, `fire` and `waiting`. Every other kind ranked above `waiting` in `PRECEDENCE`
   (`apps/till/src/state/table-precedence.ts:8-23`) — **`unavailable`, `bill`, `ready`, `step` and
   `not-sent`** — draws none; `clearing` never reaches `#card` (`:2371`), and the kinds below
   `waiting` cannot sit above it. The new rule: the ring is the first kind in `tableStates(table,
   now)` that has a `RING_OF` entry. So two outlines never coexist: a higher state that draws none
   leaves the card to Waiting's thin amber outline; `forgotten` and `overdue` exclude `waiting`
   (one `lateBand`, `table-precedence.ts:26-29`, `:39-41`); `fire` with `waiting` draws only
   Time to fire's thick ring (owner: "beneath a higher state that draws **none**"). `data-top` keeps
   the top state; the Forgotten edge under reduced motion keeps reading `top === "forgotten"`
   (Forgotten is always the top when present). By reading, the card's ring now matches the unplaced
   token's for every table: the token rings forgotten, overdue, `fireDue`, warm in that order
   (`packages/ui/src/components/wt-table-token.ts:216-222`) from `timingBand: lateBand(table)` and
   `fireDue: this.#fireDue(table)` (`till-floor-screen.ts:1995,2003`), the same facts
   `tableStates` reads — for every table the list draws as an ordinary card (a table needing
   clearing or moving gets `#waitingCard`, which draws no ring, while its token still rings by
   band; that is unchanged and slice 5's). Task 3 pins the bill-and-waiting case on both. **On the map** the same rule
   is slice 5's (Task 6 adds it to slice 5's list).
2. **Point 3 — Waiting's outline is thin, the others thick.** Waiting: an inset ring
   `calc(var(--wt-space-1) / 2)` wide (2 px), steady. Time to fire, Overdue and Forgotten keep
   `var(--wt-space-1)` (4 px). Why thickness, not colour or dashes: §4 already says "thick red
   outline" for Overdue and plain "amber outline" for Waiting, and picture 04 draws Waiting's
   outline thinner than Overdue's; amber stays Waiting's colour, matching its amber-bordered chip;
   dashes are taken (Needs clearing on the map, §4; the unsent badge on the card). The rule reads
   "thin = a warning, nothing to do yet; thick = act now". It holds under reduced motion (nothing
   moves; thickness still differs) and at Time to fire's dimmest frame (thick, faded). Pictured in
   `4b-owner-changes*.png` panel 1. On the map (§4) Time to fire is a whole amber table and Waiting
   an outline, so they already differ there.
3. **Point 2, the dim ring — the cause, measured.** The ring dims by animating its `opacity` to
   `--wt-opacity-pulse-dim` (0.3) (`packages/ui/src/floor-ring.ts:31-35`), which composites the
   ring over the dark card (`--wt-color-surface` `#191c22`): red `#ff7f73` at 30% gives `#5e3a3a`
   and amber `#f2b24c` gives `#5a492f` — CIELAB lightness 28.7 and 32.1 against 67.8 and 76.8 at full
   strength. A warm colour made that much darker is maroon and brown. In light it fades toward white
   (`#e8bebc`, `#dccbb3`, lightness 80–83), which reads as pale. Computed 2026-10-20 with a node
   script (sRGB blend, WCAG luminance, CIELAB as `colors.test.ts:590-604`), and seen in slice 4's
   `precedence-motion-dim-390-dark-part1.png`. **Fix:** the ring's `color` animates to a per-theme
   dim colour; its opacity stays 1. Two tokens, `--wt-color-danger-pulse-dim` and
   `--wt-color-warning-pulse-dim`: light `#e8bebc` and `#dccbb3` (exactly today's 30%-over-white, so
   light looks the same), dark `#bd9ba0` and `#b9aa94` (each 30% of the ring colour mixed with the dark
   muted grey `#a1a7b3`: lightness 67.1 and 70.3, so the colour drains without darkening). The keyframe
   reads a per-ring custom property, `--ring-dim` (local to `floor-ring.ts`, not a token).
   `--wt-opacity-pulse-dim` is then read by nothing and is deleted. **Probe, 2026-10-20**, Playwright
   1.64.1's Chromium 156, a plain page (`/tmp`, not committed): `@keyframes wt-pulse { 50% { color:
   var(--ring-dim) } }` on a ring with `color: var(--wt-color-warning); --ring-dim:
   var(--wt-color-warning-pulse-dim)`, paused at 0 / 1000 / 2000 ms of 2000 → computed `color`
   `rgb(242, 178, 76)` / `rgb(185, 170, 148)` / `rgb(242, 178, 76)`, `box-shadow` followed it, opacity
   `1` throughout; a `calc(var(--wt-space-1) / 2)` ring with `--wt-space-1: 4px` computed `2px`.
   Control, re-run in plan review (same browser): a ring whose `--ring-dim` is unset went half-way
   to `rgb(0, 0, 0)`, the colour it inherits (an unresolved `var()` in `color` falls back to
   `inherit`), not to the dim colour — so a ring class that forgets `--ring-dim` dims to the
   text colour, and Task 2's per-ring test is what catches it. The same probe animated a border
   from `#f2b24c` with `50% { border-color: transparent }` (today's till bar) to `rgba(242, 178, 76,
   0.5)` at a quarter and `rgba(0, 0, 0, 0)` half-way, and with `50% { border-color:
   var(--wt-color-warning-pulse-dim) }` to `rgb(185, 170, 148)` half-way (D1). Pictured in `4b-owner-changes-dark.png` panel 3 (before and after). The
   pulse in dark now changes colour more than brightness: CIEDE2000 18.1 / 18.5 between full and dim,
   against 40.4 / 39.4 in light (Open point 2).
4. **Point 2, the calm edge — measured.** `.card.calm` reads `--wt-color-primary-disabled`
   (`till-floor-screen.ts:415-417`), `#28344a` in dark: 1.37:1 against the card's `#191c22` and 1.08:1
   against its own border `#333945` — darker than the card's border, so the edge vanishes. Changing
   that token would change every disabled primary button (`colors.test.ts:334-351` pins it near the
   surface on purpose). New token **`--wt-color-table-calm-edge`**: light `#8fb7f5` (today's value,
   2.05:1 on white — the owner found light clear), dark `#4d6aa6` (3.19:1 on the card, 2.17:1 on the
   border, CIEDE2000 16.1 from the seated blue `#4c8dff`). Chosen among six dark candidates drawn side
   by side (`#3a5280` 2.19:1 to `#5a78b0` 3.86:1); it is the first at 3:1 or more that still reads as
   softer than the seated blue. Slice 5's map fill for Nothing needed is a fill, not a line, and gets
   its own token there (§6); this one is the card's line only.
5. **Point 4.** `#marks` drops `!partyPaid(table)` from the "✓ Nothing needed" condition
   (`till-floor-screen.ts:2395`); `#occupancy` keeps "Paid" (`:2536-2537`). Slice 4's Decision 9
   (§9 "A paid party still seated shows Paid, as today") is superseded by the owner.
6. **The Spanish held word.** Change `floor.held`, `floor.held_one`, `floor.held_fire_in`,
   `floor.held_fire_in_one` in `apps/till/src/i18n/strings.ts:2515-2518`. "With the Spanish guide text
   if it names the word": the guides under `apps/server/src/guide/es/` do not (`git grep -n -i retenid
   -- apps/server/src/guide` prints nothing; `es/products.md:109` already says «en espera»); the till's
   help does — `helpEs["help.order.send"]` says «cada Grupo llega a cocina retenido hasta que se
   marcha» (`apps/till/src/i18n/help-strings.ts:76`) — so it becomes «… llega a cocina en espera
   hasta que se marcha». "EVERYWHERE" also reaches the dashboard's course setting,
   `courses.held_until_fired` «Retenido hasta marchar» (`apps/dashboard/src/i18n/strings.ts:4334`),
   the same meaning (a course held until fired): it becomes «En espera hasta marchar» (driver
   ruling D2). Every other
   «retenid…» in the tree is fiscal (AEAT `retenido`), a held card payment
   (`payments.held.heading`, `payment.hold_not_found`), a printer holding a job, or test fixture
   names — not held dishes — and stays (`git grep -n -i retenid -- ':!packages/fiscal-verifactu'
   ':!docs'`, read 2026-10-20).
7. **The till bar's Waiting tab (D1).** Its `waiting-attention` keyframe
   (`apps/till/src/widgets/till-shell.ts:213-217`) changes from `50% { border-color: transparent }` to
   `50% { border-color: var(--wt-color-warning-pulse-dim) }`; name, duration token and the
   reduced-motion rule unchanged. In dark it now drains toward grey instead of passing through brown.
   **In light it changes too:** half-way the border no longer vanishes but is the pale amber
   `#dccbb3` (1.59:1 on white) — the light floor ring's dimmest colour; the LOOK pictures it. Nothing
   pins today's `transparent` (`git grep -n "waiting-attention" -- apps` finds only the keyframe and
   the name check at `till-shell.counter-cleanup.test.ts:165`).
8. **What this does not touch:** the kitchen screen and the pass keep their own forgotten flash
   (slice 4 Decision 12); the Spanish Waiting chip `signal.wait_warm` stays «En espera» (D3, Open
   point 1). No `FloorTable` change: the token draws the thin Waiting ring and the new dim colours
   through `floorRingStyles` with no change of its own.

## Review focus

1. **A higher state that draws none, over a wait** — unavailable, bill, ready, Take order and not
   sent each with a warm wait draw one thin steady amber ring and keep `data-top` as the higher
   state — Task 3.
2. **Time to fire over a wait** — one ring, thick and `fire`, pulsing slowly; no second thin ring —
   Task 3.
3. **No double dimming** — at half a pulse the ring's computed opacity is still `1` and its colour
   is the dim token; a leftover opacity animation would fade a grey ring further — Task 2.
4. **The card and the unplaced token agree** — the same bill-and-waiting table rings `waiting` as a
   list card and as a tray token — Task 3.
5. **Spanish, a wait and a held course on one card** — both chips now say «en espera»; the LOOK
   pictures it for the owner (Open point 1) — Task 7.

## Changed test checks

Each is allowed because an owner answer changes the behaviour it pins; the PR lists them.

| File and case | Change | Owner answer |
|---|---|---|
| `packages/ui-core/src/tokens/structure.test.ts:47` (list in "defines the structural contract") | drop `--wt-opacity-pulse-dim` | point 2 (the dim is a colour now) |
| `structure.test.ts:85-91` "a pulse dims its ring to 30%, still visible" | deleted; its 30% is kept by Task 1's "in light, each dim colour is its full colour at 30% over the surface" | point 2 |
| `packages/ui/src/floor-ring.test.ts:98-115` "paints the ring from the danger and warning tokens" | the `waiting` row expects `3.5px` (half of `7px`), the other three keep `7px` | point 3 |
| `floor-ring.test.ts:148-161` "dims to the dim token half-way and is whole at the ends" | sets `--wt-color-danger-pulse-dim: rgb(9, 8, 7)` instead of `--wt-opacity-pulse-dim`; half-way the ring's `color` is `rgb(9, 8, 7)` and `opacity` `1`; at 0 the `color` is the danger value | point 2 |
| `apps/till/src/screens/till-floor-screen.precedence.test.ts:136-149` "rings a forgotten card fast, keeps its badge, and dims the ring to the token half-way" | sets `--wt-color-danger-pulse-dim` instead of `--wt-opacity-pulse-dim`; half-way `color` is that value, `opacity` `1` | point 2 |
| `precedence.test.ts:151-157` "rings a card whose reminder is due in amber, pulsing slowly" | before reading `boxShadow`, pause the ring's animation at `currentTime = 0`; the `rgb(4, 5, 6)` assertion unchanged | point 2 (the ring's colour now moves, so an unpaused read is only right while the animation is still pending) |
| `packages/ui/src/components/wt-table-token.test.ts:614-620` "rings a table whose reminder is due in amber, slowly" | the same pause at `0` before the `color` read; assertion unchanged | point 2 |
| `precedence.test.ts:172-191` "draws only the most urgent state's ring" | t3 (bill + warm wait): was no ring; now one `[data-ring="waiting"]`, no `wt-pulse-*`, `data-top` still `bill`; t2's single forgotten ring kept | point 1 |
| `precedence.test.ts:418-436` "says Nothing needed, muted, with a check…" and `:438-463` "keeps the solid edge…" | `--wt-color-primary-disabled` → `--wt-color-table-calm-edge` (set both; the edge equals the calm-edge value, not the disabled one) | point 2 |
| `precedence.test.ts:477-484` "a paid party needing nothing shows Paid, with no check" | renamed "a paid party needing nothing shows Paid and Nothing needed"; `[data-nothing-needed]` present; `[data-paid]` and `calm` kept | point 4 |

No other existing assertion should change: the held-chip cases read `es[...]`
(`till-floor-screen.held.test.ts:212-213`, `signal-chips.test.ts:107-109`); the help case reads
`text["help.order.send"]` (`till-table-order-screen.help.test.ts:89`); the dashboard reads
`t("courses.held_until_fired")` (`course-list.test.ts:1235`, `courses-screen.test.ts:134`);
`wt-table-token` tests assert ring kinds and pulse classes, not widths or opacity, except the colour
read listed above; the till bar's tests check the animation's name and duration, not its colours.
Any other red case is a stop.

Why the two pauses: probed 2026-10-20 (plan review) in Chromium 156 — a ring with the new colour
keyframe read synchronously after insertion gave the exact start colour (animation `pending`,
`currentTime` 0), still exact one frame later, `rgb(20, 21, 22)` instead of `rgb(19, 20, 21)` after
~67 ms and `rgb(54, 51, 48)` after ~317 ms. Today both reads happen before the first frame, so they
probably pass unpaused; the pause makes them independent of that.

---

### Task 1: the three colour tokens

**Files:**
- Modify: `packages/ui-core/src/tokens/colors.css` — after `--wt-color-on-table-reserved` in each of
  the four blocks (`:120`, `:237`, `:354`, `:470`): `--wt-color-table-calm-edge`,
  `--wt-color-danger-pulse-dim`, `--wt-color-warning-pulse-dim`, with Decision 3's and 4's values
  (light blocks `:1` and `:243`; dark blocks `:125` and `:359`), and one comment line above them: "The
  list card's calm left edge, and the colour a pulsing floor ring dims to half-way."
- Test: `packages/ui-core/src/tokens/colors.test.ts` (a new `describe.each(["light", "dark"])` after
  the table fills, using its `ratio`, `lab` and `deltaE2000`)

**Interfaces — produces:** `--wt-color-table-calm-edge`, `--wt-color-danger-pulse-dim`,
`--wt-color-warning-pulse-dim`, declared in every theme block.

- [ ] **Step 1: Write the failing tests**, `describe.each(["light", "dark"])("floor ring and calm edge colours (%s)")`:
  - `"the calm edge stands 2:1 or more from the surface and its border"` — `ratio(edge, surface) >= 2`
    (light 2.05, dark 3.19; today's dark 1.37 fails) and `ratio(edge, border) >= 1.4`.
  - `"the calm edge reads as a different blue from the seated edge"` — `deltaE2000(edge,
    --wt-color-primary) >= 15`.
  - `"a pulsing ring's dimmest colour is never much darker than its full colour"` — for
    danger/warning, `lab(dim)[0] >= lab(full)[0] - 10` (the brown control: dark `#5e3a3a` is 39 below).
  - `"a pulsing ring's dimmest colour is visibly different from its full colour"` —
    `deltaE2000(dim, full) >= 15`.
  - `"the OS preference gives them the same values as the explicit theme"` — the existing pattern
    (`colors.test.ts:500-510`) over the three names.
  - Light only: `"in light, each dim colour is its full colour at 30% over the surface"` — per
    channel, `|dim - round(0.3·full + 0.7·surface)| <= 1`.
- [ ] **Step 2: Run, watch them fail** (undeclared tokens read `""`).
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts`
- [ ] **Step 3: Add the tokens.**
- [ ] **Step 4: Run** the same command — PASS; then `pnpm exec vitest run scripts/style-token-names.test.ts`.
- [ ] **Step 5:** typecheck `@waitron/ui-core`; prettier; commit —
  `"Tokens for the calm card edge and a floor ring's dimmest colour, in both themes (A757 slice 4b)"`.

### Task 2: the ring — thin for Waiting, dimming to a colour

**Files:**
- Modify: `packages/ui/src/floor-ring.ts` (styles only; `renderFloorRing`, `FloorRing` and the
  `PULSE` map unchanged)
- Modify: `packages/ui-core/src/tokens/structure.css:42` (delete `--wt-opacity-pulse-dim`),
  `packages/ui-core/src/tokens/structure.test.ts` (as listed)
- Modify: `apps/till/src/widgets/till-shell.ts:213-217` — the `waiting-attention` keyframe's 50%
  border colour (Decision 7, D1)
- Test: `packages/ui/src/floor-ring.test.ts`, `apps/till/src/widgets/till-shell.counter-cleanup.test.ts`;
  edit `apps/till/src/screens/till-floor-screen.precedence.test.ts:136-157` and
  `packages/ui/src/components/wt-table-token.test.ts:614-620` (listed) in this task, so no suite goes
  red between tasks

**Interfaces — consumes:** Task 1's tokens. **Produces:** `floorRingStyles` where
`.ring-forgotten, .ring-overdue { color: var(--wt-color-danger); --ring-dim: var(--wt-color-danger-pulse-dim); }`,
`.ring-fire, .ring-waiting { color: var(--wt-color-warning); --ring-dim: var(--wt-color-warning-pulse-dim); }`,
`.ring-waiting { box-shadow: inset 0 0 0 calc(var(--wt-space-1) / 2) currentColor; }`, and
`@keyframes wt-pulse { 50% { color: var(--ring-dim); } }` (name, classes, timing and the
reduced-motion rule unchanged). One comment at `--ring-dim`: it is set per ring, not a token. Keep
colour words out of that comment: `wt-table-token`'s styles include `floorRingStyles`, and
`no-hardcoded-chrome.test.ts:46-48` refuses `grey`, `brown`, `red` and nine other colour names
anywhere in the CSS text, comments included.

- [ ] **Step 1: Write the failing tests** in `floor-ring.test.ts`, and edit the two listed cases:
  - `"draws Waiting's outline half as thick as the others"` — `--wt-space-1: 8px` → waiting's
    `boxShadow` contains `4px`, each other ring's `8px`.
  - `"dims each colour to its own theme token, at full opacity"` — host
    `--wt-color-danger-pulse-dim: rgb(9, 8, 7)`, `--wt-color-warning-pulse-dim: rgb(6, 5, 4)`; the
    `overdue` and `fire` rings paused at half their duration: `color` is `rgb(9, 8, 7)` and
    `rgb(6, 5, 4)`, `boxShadow` contains it, `opacity` `"1"`.
  - The edited `floor-ring.test.ts:148-161` case sets `--wt-color-danger: rgb(1, 2, 3)` as well,
    so "at 0 the `color` is the danger value" reads `rgb(1, 2, 3)`, not a theme value.
  - `structure.test.ts`: drop the name and delete the 30% case (listed).
  - `till-floor-screen.precedence.test.ts:136-149`: the dim token swap (listed); `:151-157` and
    `wt-table-token.test.ts:614-620`: pause at 0 before the colour read (listed).
  - `till-shell.counter-cleanup.test.ts`, new case `"A738 Waiting dims its border to the amber dim
    colour half-way, never to transparent"` — `waitingCount: 2`, motion allowed; on the host set
    `--wt-color-warning: rgb(4, 5, 6)`, `--wt-color-warning-pulse-dim: rgb(7, 8, 9)` and
    `--wt-duration-pulse-slow: 2000ms`; pause the button's animation: at 1000 its
    `borderTopColor` is `rgb(7, 8, 9)` (today `rgba(0, 0, 0, 0)`), at 0 `rgb(4, 5, 6)`.
- [ ] **Step 2: Run, watch the new and edited cases fail.**
  `pnpm --filter @waitron/ui exec vitest run src/floor-ring.test.ts`,
  `pnpm --filter @waitron/till exec vitest run src/widgets/till-shell.counter-cleanup.test.ts` and
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens/structure.test.ts` (the last only
  loses a name and a case, so it stays green)
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both commands, plus
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-table-token.test.ts src/components/wt-table-token.a11y.test.ts src/no-hardcoded-chrome.test.ts src/base-styles.test.ts`
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.precedence.test.ts src/widgets/till-shell`
  and `pnpm exec vitest run scripts/style-token-names.test.ts` — PASS; `git grep -n
  "opacity-pulse-dim" -- apps packages scripts` prints nothing.
- [ ] **Step 5:** typecheck `@waitron/ui`, `@waitron/ui-core` and `@waitron/till`; prettier; commit —
  `"Waiting's outline is thin, and a pulsing ring and the Waiting tab dim to a colour instead of fading (A757 slice 4b)"`.

### Task 3: the card keeps the waiting outline under a state that draws none

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — `#card` (`:2370-2391`): `ring` becomes the
  first `RING_OF` entry over `tableStates(table, this.#drawnAt)` (import `tableStates` beside
  `topState`, `:106-111`); `top`, `data-top`, the edge and calm classes unchanged.
- Test: `apps/till/src/screens/till-floor-screen.precedence.test.ts`,
  `apps/till/src/screens/till-floor-screen.a11y.test.ts`

**Interfaces — consumes:** `tableStates` (`table-precedence.ts:32`).

- [ ] **Step 1: Write the failing tests** (`reducedMotion: false` on every mount that asserts a
  pulse class or its absence):
  - `it.each` over the five states that draw none — a `held_unavailable` signal, `bill_requested`,
    `readyToServe: 1`, `take_order`, an unsent draft — each with `longWait("warm")`:
    `"keeps the thin waiting outline under %s"` → one `[data-ring]`, `waiting`, no `wt-pulse-*`,
    `data-top` the higher kind (`unavailable`, `bill`, `ready`, `step`, `not-sent`).
  - `"Time to fire over a wait draws only its own ring"` — reminder due a minute past plus a warm
    wait → one ring, `fire`, `wt-pulse-slow`. This one passes today (top is already `fire`); it
    guards the new rule against picking `waiting` (the last ring) instead of the first. Check it by
    deletion: reverse the search order and watch it fail.
  - `"rings a bill-and-waiting table the same on the card and in the tray"` — list view: card ring
    `waiting`; map view with that table unplaced: the tray token's `[data-ring="waiting"]`.
  - Edit `:172-191` as listed.
  - In `till-floor-screen.a11y.test.ts`'s themes loop: `"has no violations with a bill-requested
    card outlined as waiting, on the list"` — first asserts its `[data-ring="waiting"]`.
- [ ] **Step 2: Run, watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.precedence.test.ts src/screens/till-floor-screen.a11y.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every floor-screen file (`pnpm --filter @waitron/till exec vitest run
  src/screens/till-floor-screen`) — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"A waiting table keeps its amber outline under a state that draws none (A757 slice 4b)"`.

### Task 4: the calm edge's own token, and Nothing needed beside Paid

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` — `.card.calm` (`:415-417`) reads
  `--wt-color-table-calm-edge`; `#marks` (`:2395`) drops `&& !partyPaid(table)` (keep the import if
  `#occupancy` still uses it, `:2536`).
- Test: `till-floor-screen.precedence.test.ts`, `till-floor-screen.a11y.test.ts`

- [ ] **Step 1: Write the failing tests / edit the listed cases:** `:418-436` and `:438-463` set
  `--wt-color-table-calm-edge: rgb(7, 8, 9)` and `--wt-color-primary-disabled: rgb(13, 14, 15)` —
  the calm card's edge is `rgb(7, 8, 9)`, the others' the primary value; `:477-484` as listed, plus
  the line's order: `[data-nothing-needed]` is the first mark in `.badges`. In the a11y themes loop:
  `"has no violations with a paid table that needs nothing, on the list"` — first asserts
  `[data-paid]` and `[data-nothing-needed]` both drawn.
- [ ] **Step 2: Run, watch them fail** (the Task 3 command).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every floor-screen file — PASS.
- [ ] **Step 5:** typecheck `@waitron/till`; prettier; commit —
  `"The calm edge stays visible in dark, and a paid party says Nothing needed too (A757 slice 4b)"`.

### Task 5: held dishes are «en espera» in Spanish

**Files:**
- Modify: `apps/till/src/i18n/strings.ts:2515-2518`, `apps/till/src/i18n/help-strings.ts:76`,
  `apps/dashboard/src/i18n/strings.ts:4334` (Decision 6 and Global constraints' words).
- Test: `apps/till/src/i18n/strings.test.ts`, `apps/till/src/i18n/help-strings.test.ts`

- [ ] **Step 1: Write the failing tests**, reading every word from the catalogues:
  - `strings.test.ts`, `"the floor's held chip says held with the order screen's word"` — with
    `const held = es["table.group_held"].toLowerCase()`: `es["floor.held"].replace("{n}", "2")` is
    `` `2 ${held}` ``, `es["floor.held_one"]` is `` `1 ${held}` ``, `es["floor.held_fire_in"]`
    starts with `` `{n} ${held} · ` `` and `es["floor.held_fire_in_one"]` with `` `1 ${held} · ` ``,
    and the two share the same tail after « · », which contains `{m}`. No Spanish literal in the
    test (the countdown wording itself stays as it is today, «marchar en {m} min»; Step 4's held
    and signal-chip suites, which read `es[...]`, cover the substitution).
  - `help-strings.test.ts`, `"the order screen's Send help calls a held group by the same word"` —
    `helpEs["help.order.send"]` contains `es["table.group_held"].toLowerCase()`.
- [ ] **Step 2: Run, watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/i18n/strings.test.ts src/i18n/help-strings.test.ts`
- [ ] **Step 3: Change the five Spanish values and the dashboard's one.** The dashboard label has
  no test of its own words (no Spanish literal may pin it): verify with
  `git grep -n -i "retenid" -- apps/till/src/i18n apps/dashboard/src/i18n/strings.ts`, which must
  print only `payments.held.heading` and the printer/payment messages.
- [ ] **Step 4: Run** the Step 2 command plus
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.held.test.ts src/widgets/signal-chips.test.ts src/screens/till-table-order-screen.help.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/widgets/course-list.test.ts src/screens/courses-screen.test.ts` — PASS.
- [ ] **Step 5:** typecheck `@waitron/till` and `@waitron/dashboard`; prettier; commit —
  `"Held dishes are «en espera» in Spanish everywhere (A757 slice 4b)"`.

### Task 6: docs and backlog

**Files:** `docs/developers/design-system.md`, `docs/superpowers/specs/2026-10-17-a757-table-states-design.md`,
`docs/backlog.md`, `docs/backlog/till.md`. Read `docs/backlog.md` → "How to keep this file honest" first.

- [ ] **Step 1: `design-system.md`.** Colour list (under "### Colour", `:130-141`): add `--wt-color-table-calm-edge` and
  the two `-pulse-dim` tokens (a short clause: the list card's calm edge; the colour a floor ring
  dims to). Structure list (`:475`): drop `--wt-opacity-pulse-dim`. `:503-504`: the ring "dims it
  to `--wt-color-danger-pulse-dim` or `--wt-color-warning-pulse-dim` half-way, at full opacity — in
  dark, a fade to grey, not to the card"; `:506-507`: the till bar's Waiting tab "keeps its own
  keyframe, reads the slow duration and dims its border to `--wt-color-warning-pulse-dim`". The
  floor paragraph (`:849`): "the most urgent state that
  draws an outline decides it — Forgotten red, pulsing fast; Overdue red and Time to fire amber,
  pulsing slowly, all thick; Waiting a thin steady amber, kept under a state that draws none";
  the calm edge reads `--wt-color-table-calm-edge`; delete ", unless its party has paid".
- [ ] **Step 2: the spec.** A dated line (`**2026-10-2x:**`, the landing date, naming this plan)
  after each of the slice-4 dated paragraphs: §4's (`:283`) — the outline rule (Decision 1); §5.2's
  (`:373`) — Waiting thin, the dim colour tokens, `--wt-opacity-pulse-dim` retired, and A738's
  Waiting tab dims its border to the amber dim colour instead of to transparent (D1); §9's (`:550`) —
  the calm edge token, and a paid party also says ✓ Nothing needed (owner, 2026-10-20). After §5.1's
  slice-3 paragraph (`:335`; §5.1 names «2 retenidos» at `:297`): the Spanish held chip is «2 en
  espera · marchar en 4 min» (owner, 2026-10-20).
- [ ] **Step 3: `docs/backlog/till.md`.** A757's landed-slices sentence (`:1278-1291`) gains this
  follow-up, its plan and pictures. "What slice 5 … must also do" (`:1294-1311`): the calm-edge
  bullet becomes "decide the map's own Nothing needed fill; the card's edge keeps
  `--wt-color-table-calm-edge`, a line colour"; **delete** the unplaced-token bullet (its reason,
  card and tray disagreeing on a bill-and-waiting table, is gone — Decision 1); add "on the map, keep
  the Waiting outline under a state that draws none (owner, 2026-10-20, point 1)". A893
  (`:1360` on): delete the two dark-theme clauses (calm edge, brown dim) — now fixed — and keep the
  1280 px one; "Open points 1–5, 8 and 11" becomes "Open points 4, 8 and 11"; add one bullet: this
  plan's Open points.
- [ ] **Step 4: `docs/backlog.md`.** A757 (`:2143-2161`): the landed list gains "a follow-up to
  slice 4, the owner's look changes and the Spanish word for held dishes" with this plan's path.
- [ ] **Step 5: check for missed claims.**
  `git grep -n -i -E "opacity-pulse-dim|primary-disabled.*calm|calm.*primary-disabled|unless its party has paid|retenid|one outline|draws one|waiting-attention|Waiting tab" -- docs/developers docs/backlog.md docs/backlog apps/server/src/guide`
  — every hit is true after this change, fiscal, or history in a dated plan. `pnpm exec prettier
  --file-info` on each file. Commit — `"Docs: A757 slice 4b, the owner's look changes"`.

### Task 7: LOOK — both themes, 390 and 1280

**Files:** a throwaway test `apps/till/src/screens/till-floor-screen.owner-look.test.ts` (deleted,
never committed); pictures to `/Users/clintongormley/waitron-campaign-c/a757-4b-shots/`; report to
`/Users/clintongormley/waitron-campaign-c/a757-4b-look-report.md`. Method as slice 4's look report
(viewport 720 high, tall pages in overlapping parts, every animation paused at 0 (bright) and half
its duration (dim), `reducedMotion` set explicitly, size and language restored in `finally`).

- [ ] **Step 1:** One zone, list view, party "T3", after `4b-owner-changes*.png`: Waiting; Time to
  fire; Overdue; Forgotten; Bill requested + waiting; Ready + waiting; Time to fire + waiting;
  Nothing needed; Held counting down; Paid + nothing needed; Take order. Light and dark, 390 and
  1280, bright, dim and reduced motion. Spanish at 390 in both themes, with one card holding a warm
  wait and a held course counting down. A map view with an unplaced bill-and-waiting table and an
  unplaced due table in the tray, both themes. The till bar with its Waiting tab holding an order,
  both themes, at 0 and half its pulse (D1: dark drains toward grey; light now stays a pale amber
  instead of vanishing).
- [ ] **Step 2: Measure and look.** Record per picture: ring kind and `boxShadow` width (Waiting 2 px,
  others 4 px); computed ring `color` and `opacity` at the dim frame (dark `rgb(189, 155, 160)` /
  `rgb(185, 170, 148)`, opacity 1); the Waiting tab's `borderTopColor` at its dim frame
  (`rgb(185, 170, 148)` dark, `rgb(220, 203, 179)` light); calm edge `rgb(77, 106, 166)` in dark; `scrollWidth` equal to the
  viewport; every mark inside its card. Compare beside `4b-owner-changes*.png` and slice 4's
  `built-4/` dark pictures. Note in the report whether the dark pulse still reads as a pulse (Open
  point 2). A defect is fixed test-first in the file that owns it and committed.
- [ ] **Step 3:** Copy the pictures to `docs/backlog/mockups/a757-table-states/built-4b/` and commit
  them; delete the throwaway test and any `__screenshots__` it left; `git status` clean —
  `"Pictures of slice 4b as built (A757)"`.

---

## Open points for the owner (each with the default this plan builds)

1. **Spanish «En espera» now names two things on one card** (driver ruling D3: built as decided,
   asked after). The Waiting chip (a fired dish waiting
   5 minutes) already says «En espera» (`signal.wait_warm`, `strings.ts:2615`), and so does the till
   bar's Waiting tab (`shell.waiting`). With the held chip changed as decided, a table with a wait and
   a held course shows «⏱ En espera» and «⏸ 2 en espera · marchar en 4 min»
   (`4b-owner-changes*.png` panel 5). Default: built as the owner decided; the Waiting chip is
   unchanged. For the owner: keep both, or give the Waiting chip another word (for example
   «Esperando»).
2. **In dark, the pulse is now mostly a change of colour, not brightness** (Decision 3: CIEDE2000
   about 18 between bright and dim, against about 40 in light). Default: as drawn. The LOOK says
   whether it still reads as moving.
3. **Listed so the owner sees them, not questions** (driver rulings): the dashboard's course
   setting «Retenido hasta marchar» becomes «En espera hasta marchar» (D2, Decision 6); the till
   bar's Waiting tab dims its border to the amber dim colour like the floor rings (D1, Decision 7),
   which in light means its border no longer vanishes half-way but turns pale amber.
