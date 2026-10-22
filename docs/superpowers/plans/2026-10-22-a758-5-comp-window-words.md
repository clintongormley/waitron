# A758-5 — The till's Comp words: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: LIGHT.** No task changes who may do what: the server's approval rules
(`evaluateComp`, `packages/adjustments/src/policy.ts:142-170`) are not touched, and "Free" on the
bill is sent as the 100% percentage the server already accepts (measured below). No migration, no
fiscal change (a 100% bill percentage could already be typed, `adjustment-dialog.ts:442` refuses
only above 100, and A758-4 already prints it «Descuento 100%» at the bill's foot,
`apps/server/src/receipt-document.test.ts:869-876`), no cross-package contract (the till, plus one
new server test). So no per-task reviewer; the plan is still reviewed once against the design by a
fresh-context reader before any implementer starts, and `/finish-branch` runs its Codex run-it seat.

Implementers are dispatched as `subagent_type: "implementer"`. An implementer that passes about 150
tool calls with its task unfinished stops at a passing or cleanly failing point, commits, and hands
over: what is done, what is left, the files, and each check's state.

**Goal:** the till names its actions as the owner chose (design D10): a counter order's dishes offer
one **Comp…** («Descuento…») that opens the Comp window, as the table already does; no till word
says "Give away" or «Invitar»; "Discount the bill" becomes **Comp the bill**, which offers **Free**
beside % and €.

**Architecture:** the till only. The basket's two line buttons (Give away, Discount) become one that
opens the existing Comp window (`combined` mode of `till-adjustment-dialog`), so a counter order
works as a table's does. The words change in the till's two string files. The bill's window gains a
third choice, Free, which it sends as `discount_percent` at 10000 basis points — the stored shape
design §3.4 names for a free whole bill.

**Tech stack:** TypeScript, Lit, Vitest (the till in real headless Chromium; the server suite on
`node:sqlite`).

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` — D10 (`:63`), §3.2's
"The till" paragraph (`:234-255`), §3.4 (`:323-349`), §9's "The till" line (`:1018-1020`), §9.1
(`:1042-1072`). Parent plan and the outline this replaces:
`docs/superpowers/plans/2026-10-19-a758-reason-rules.md`, "# A758-5" (`:1124-1145`). A773's design
for the Comp window: `docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md` §3.8
(`:314-333`). Backlog: `docs/backlog.md` "A758" (`:2229-2268`), `docs/backlog/till.md` "## A758"
(`:1403-1435`).

Every `file:line` below was read on 2026-10-22 in this worktree (branch
`feat/a758-5-comp-window-words`, `main` at `fdd6e556c`) with `sed -n`/`grep -n`/`git grep -n`,
unless it names a command that was run. A773-1 (#1897) and A758-1 to A758-4 are all in that history.

---

## What the design says, quoted

- **D10** (`:63`): "**Names people see.** The page is "Voids and comps" (Spanish "Cancelaciones y
  descuentos"); the kinds and the till's actions are **Void** and **Comp** (Spanish **Cancelar** and
  **Descuento**). Code names (`cancel`, `comp`, `adjustment`) stay unless renaming one is cheap and
  clean."
- **§3.4** (`:325-327`): "**The till's Comp window** is A773-1's single window for what are today
  Give away and Discount (spec §3.8, there named "Discount…"; under D10 its English name is
  **Comp…** and its Spanish **Descuento…**). It offers Free, % and € as the chosen reason allows."
- **§3.4** (`:345-349`): "**The comp on the whole bill.** Today's "Discount the bill" becomes "Comp
  the bill", with %, €, and 100% for a guest whose whole meal is free. A bill-level row already
  allows a percentage up to 100% … so the free whole bill is a 100% percentage comp, not a new
  stored action."
- **§3.2** (`:241-243`): "The Comp window keeps its approval step and its "Ask for approval" button
  (`adjust.ask_approval` …; picture 04): that is our choice, because D14 covers only the cancel and
  refund dialogs".
- **§9** (`:1018-1020`): "**The till:** the Comp window's name and Free/%/€ from the reason; "Comp
  the bill" with 100%; approval prompts naming the reason or the bill limit; Spanish "Invitar"
  becomes "Descuento"".
- **A773 §3.8** (`:316`): "One window replaces today's Give away and Discount buttons".

## What `main` already has, and what is left

- **The table screen is done.** A sent dish's ⋯ More offers "Comp…" (`comp.title`,
  `apps/till/src/screens/till-table-order-screen.ts:2678`; strings `apps/till/src/i18n/strings.ts:1113`
  "Comp…", `:2815` «Descuento…»), opening the Comp window (`kind: "comp", combined: true`, `:2652`).
  The outline's `till-table-order-screen.adjustments.test.ts:167` and its a11y suite pin no
  "Give away" or «Invitar» on `main` (`git grep -n -i "give away\|invitar" -- apps/till/src/screens`
  finds only a describe name, `till-table-order-screen.adjustments.test.ts:381`); §9.1's list of them
  predates A773-1.
- **The counter's basket is not.** Each stored dish and each extra offers two buttons,
  `LINE_ADJUSTMENTS` (`apps/till/src/state/adjust-target.ts:43-46`): "Give away"
  (`table.comp_line`, `strings.ts:1108`, ES «Invitar» `:2810`) and "Discount"
  (`table.discount_line`, `:1109`, ES «Descuento» `:2811`), drawn at `apps/till/src/widgets/basket.ts:1292-1306`.
  Each opens the dialog's separate give-away or discount mode (`#adjust(kind, …)`, `:1332-1335`, no
  `combined`). **Renaming `table.comp_line` alone, as the outline says, would put two «Descuento»
  buttons side by side on every Spanish dish** — see Decision 1.
- **The dashboard is done.** `git grep -n -i "give away\|invitar" -- packages/adjustments/src` finds
  only comments in `packages/adjustments/src/errors.ts:20-28`.
- **Every «Invitar» left**, `git grep -n -i "invitar" -- apps packages`: `strings.ts:2810`
  (`table.comp_line`), `:2828` (`comp.make_free` «Invitar {n}»), `:2831` (`adjust.comp_title`),
  `:2833` (`adjust.comp_extra_title`), `:2869` (`adjust.do_comp`), and
  `apps/till/src/i18n/codes.ts:611` (`adjustment.weighed_partial`, «…no se puede invitar ni
  descontar…»), with its pins at `codes.test.ts:398` and `widgets/adjustment-dialog.test.ts:212`.
- **Every English "give … away" a person sees** (`git grep -n -i "given away\|give it away\|give away" -- apps packages ':!**/*.test.ts'`):
  `strings.ts:1108`, `:1129` ("Give an item away"), `:1131` ("Give an extra away"), `:1167` ("Give
  it away"), and `codes.ts:610` ("…can't be given away or discounted. Discount the whole line
  instead"). The rest are comments and a test helper's reason name (`apps/server/src/testing/cancel-line.ts:34`).
- **Not about comps, unchanged:** staff invitations in the dashboard (`apps/dashboard/src/i18n/strings.ts:4145-5073`),
  the server's and Spanish guide's `staff.md:14-17`, setup's `finish.ts:134`, the demo seed's
  reason name «Invitación del encargado» (`apps/server/scripts/demo-seed/seed-adjustments.ts:156`),
  A758-4's fiscal test's list of words that must not print (`apps/server/src/full-comp.fiscal-identity.test.ts:300`),
  shift "give-aways" (`apps/server/src/schedule-api.ts:91`, `packages/workforce/src/shift-swaps.ts:13`),
  and test names and comments that say "give-away" for the stored `comp` action (D10: code names stay).
- **The bill today.** "Discount the bill" (`table.discount_bill`, `strings.ts:1110`; ES «Descuento
  en la cuenta» `:2812`), on the table (`till-table-order-screen.ts:2114-2134`) and the basket
  (`basket.ts:1313-1329`), opens the separate discount mode on a target with `lineId: null`: title
  "Discount the whole bill" (`adjust.discount_bill_title`, `:1134`, ES `:2836`), a "Discount by"
  choice of "A percentage" / "An amount" (`adjust.kind`, `kind_percent`, `kind_amount`,
  `:1140-1142`, ES `:2842-2844`, drawn at `adjustment-dialog.ts:902-950`), and "Apply the discount"
  (`adjust.do_discount`, `:1168`). It offers no Free.
- **The server already takes a free whole bill.** Measured 2026-10-22 with a throwaway test (deleted
  after; `git status --short` clean) that POSTed `{ lineId: null, action: "discount_percent",
  percentBp }` to `/api/working-orders/:id/adjustments` under the `House` reason
  (`apps/server/src/testing/adjustment-venue.ts:229-239`) on a Steak + Burger bill, run with
  `pnpm --filter @waitron/server exec vitest run src/zz-probe-bill-100.test.ts`: `percentBp: 10000`
  answered 200 and recorded one row `discount_percent`, `percent_bp` 10000, `before_amount` 3700,
  `after_amount` 0, `reduction` 3700 (whole cents); the control `percentBp: 10001` answered 400
  `management.request_invalid` `{ field: "percentBp" }` and recorded nothing. The bound is
  `isPercentBp` (`packages/adjustments/src/policy.ts:19-22`), checked at
  `apps/server/src/adjustments-apply.ts:345-346`; the stored check allows it
  (`packages/adjustments/src/schema/adjustments.ts:97-101`). Task 3 commits that measurement as a test.
- **"Ask for approval" stays** (§3.2): the Comp window's confirm button reads
  `t("adjust.ask_approval")` whenever the server asks for a PIN (`adjustment-dialog.ts:1046`;
  `strings.ts:1166`, ES «Pedir aprobación» `:2868`). Nothing pins it in the Comp window today
  (`git grep -n ask_approval -- 'apps/till/src/**/*.test.ts'` finds nothing); Task 2 adds the pin.
- **The guides say nothing about comps.** `git grep -n -i -E "comp\b|comp…|discount|give away|descuento|invit|gratis" -- apps/server/src/guide`
  finds only "recorded prices and discounts" (`en/modifiers.md:110`, `es/modifiers.md:122`) and
  staff invitations (`en/staff.md:14-16`, `es/staff.md:14-17`). No guide describes the till's comp
  actions, so no guide changes; writing one is not part of this item.

## Decisions (each a default the driver may overrule)

1. **The basket gets one Comp… per dish and per extra, opening the Comp window** (design §3.4's
   "single window for what are today Give away and Discount"; D10's "the till's actions are Void
   and Comp"; A773 §3.8). Its dish button covers the dish with its extras, as "Give away" did; its
   extra button covers that extra alone, as today. It is not the table screen's shape (where extras
   have no buttons and the dish's window asks "What"): the basket keeps its per-extra Cancel
   (`basket.ts:1229-1249`), so a per-extra Comp… sits with it. *Alternative:* rename only, leaving
   "Comp" and "Discount" in English and «Descuento» twice in Spanish — not recommended.
2. **The dialog's separate give-away and line-discount modes stay in the code this PR**, with no
   opener once Task 1 lands (every `adjust` emitter: `basket.ts:1286`, `:1303`, `:1319`;
   `till-table-order-screen.ts:1970`, `:2123`, `:2652`). Retiring them rewrites most of
   `adjustment-dialog.test.ts` (its `mount` defaults to the separate give-away, `:59-66`) and moves
   `till-app-adjustments.test.ts` off it (its `requestAdjustment` emits `kind` without `combined`,
   `:342-358`, though the table screen sends `combined: true`, `:2652` — both since A773-1,
   `git log -S` → `c9ad7a634`, #1897). That is its own item: Task 5 files it. Their strings are still
   reworded here so no «Invitar» is left (the outline names them).
3. **"Comp the bill" offers Free only under a reason that allows both Free and a percentage.** Free
   on the bill is stored as a 100% percentage (§3.4), so the reason must allow a percentage or the
   server refuses `adjustment.action_not_allowed` (`policy.ts:144-146`); and a reason that does not
   offer Free on an item (§3.1, `:182`, e.g. the starter Staff meal, `:916`) should not give a whole
   bill away. *Alternative:* any reason allowing a percentage.
4. **The bill's window keeps % chosen when it opens**; Free is first in the list (the Comp window's
   order, `adjustment-dialog.ts:589-593`) but never preselected, so a whole free bill is a deliberate
   choice.
5. **The bill's choice reads like the Comp window's:** legend "How much" (`comp.how_much`), options
   "Free" (`comp.free`), "%" and "€" (the Comp window's own labels, `adjustment-dialog.ts:678-686`).
   `adjust.kind`, `adjust.kind_percent` and `adjust.kind_amount` then have no reader and go.
6. **Words** (none drawn by the owner; all listed in the PR):

   | Key | English now → new | Spanish now → new |
   |---|---|---|
   | `table.comp_line`, `table.discount_line` | deleted (no reader after Task 1) | deleted |
   | `adjust.comp_title` | "Give an item away" → "Comp an item" | «Invitar un plato» → «Descuento en un plato» |
   | `adjust.comp_extra_title` | "Give an extra away" → "Comp an extra" | «Invitar un extra» → «Descuento en un extra» |
   | `adjust.do_comp` | "Give it away" → "Make it free" | «Invitar» → «Dejar gratis» |
   | `comp.make_free` | "Make {n} free" (stays) | «Invitar {n}» → «Dejar {n} gratis» |
   | `adjustment.weighed_partial` (`codes.ts`) | "…can't be given away or discounted. Discount the whole line instead" → "…can't be comped. Comp the whole line instead" | «…no se puede invitar ni descontar. Haz…» → «…no se puede descontar. Haz…» (rest unchanged) |
   | `table.discount_bill` | "Discount the bill" → "Comp the bill" | «Descuento en la cuenta» (stays) |
   | `adjust.discount_bill_title` | "Discount the whole bill" → "Comp the whole bill" | «Descuento en toda la cuenta» (stays) |
   | `adjust.do_discount` | "Apply the discount" → "Apply the comp" | «Aplicar el descuento» (stays) |

   `adjust.discount_title` and `adjust.discount_extra_title` stay as they are: only the separate
   line-discount mode reads them (Decision 2), and they say «Descuento» already.

## The files

| File | Tasks |
|---|---|
| `apps/till/src/widgets/basket.ts` (`:1208-1209`, `:1292-1306`, `:1332-1335`) | 1 |
| `apps/till/src/state/adjust-target.ts` (`LINE_ADJUSTMENTS`, `:43-46`) | 1 |
| `apps/till/src/i18n/strings.ts` | 1, 2, 3 |
| `apps/till/src/widgets/basket.adjustments.test.ts`, `basket.a11y.test.ts` | 1 |
| `apps/till/src/till-app-counter-adjustments.test.ts` | 1, 3 |
| `apps/till/src/till-app-counter-move-station.test.ts` (`:375`) | 1 |
| `apps/till/src/i18n/codes.ts` (`:609-612`), `codes.test.ts` (`:394-399`) | 2 |
| `apps/till/src/i18n/strings.test.ts` | 2, 3 |
| `apps/till/src/widgets/adjustment-dialog.ts` | 2 (comment `:40`), 3 |
| `apps/till/src/widgets/adjustment-dialog.test.ts` | 2, 3 |
| `apps/till/src/widgets/adjustment-dialog.combined.test.ts` | 2 |
| `apps/till/src/widgets/adjustment-dialog.a11y.test.ts`, `adjustment-dialog.unsaved.test.ts` | 3 |
| `apps/server/src/adjustments-api.test.ts` | 3 |
| `docs/backlog/mockups/a758-adjustment-reasons/built/` (pictures) | 4 |
| `docs/backlog.md`, `docs/backlog/till.md` | 5 |

**No migration.** No task touches a schema, a migration set or `packages/*/drizzle`.

## Global constraints

- **General code is English only** (CLAUDE.md §3). Spanish appears only in `strings.ts` and
  `codes.ts`. A test that checks a Spanish screen reads its expected text through `t()` /
  `codeMessage()` after `setLocale("es-ES")`, never a Spanish literal; the guards in
  `strings.test.ts` compare catalogue entries with each other, as its siblings do
  (`strings.test.ts:152-181`). Two existing Spanish literals this plan touches are replaced that way
  (checks 9 and 10 below).
- **A test's check changes only where this item's design changes what it checks** (owner,
  2026-10-05). Every change is listed under "Changed test checks" with its old and new value. Any
  other check that turns red is a stop and a report to the driver.
- **Comments:** cut on touch any comment that fails CLAUDE.md §1's test (history such as "(service
  plan Task 11)" at `strings.ts:1107`, `:2809`); reword the three that would go stale:
  `basket.ts:1208-1209`, `adjustment-dialog.ts:40`, and the suite comment `basket.adjustments.test.ts:13-14`.
- Every commit `git commit -s`, staging explicit paths. Every task ends with its focused tests (a
  Vitest run that prints a `Tests` count; unset `AI_AGENT` and `CLAUDECODE` to see console output),
  `pnpm --filter @waitron/till typecheck` (and `@waitron/server` for Task 3), and
  `pnpm exec prettier --check <files changed>`.

## Review Focus

1. **A free bill the server refuses** (`adjustment.no_reduction` on a bill already at €0.00): Free
   has no value field, so the message must show above the action, not under a field that is not
   drawn (`refusalField` maps `no_reduction` to `"value"` for a discount, `adjustment-dialog.ts:79-80`).
   → Task 3, test 3.
2. **Leaving Free on the bill:** to € under a reason that allows no amount clears the reason (the
   existing `pickKind`, `:904-909`); back to % shows an empty value field. → Task 3, test 2.
3. **Spanish basket:** one «Descuento…» per dish, never two buttons with one word. → Task 1 test 1
   (by count) and Task 4 (seen).
4. **Unsaved changes on the bill:** choosing Free is a change (closing asks), choosing % again is
   back at the start (the draft scope compares `#comparable`, `:267-293`). → Task 3, test 5.
5. **Part of a dish from the counter:** "Give away" offered "1 / All" radios; the Comp window offers
   a − n + stepper (`adjustment-dialog.ts:698-717`) and sends `quantity` only when less than all
   (`:505-509`). → Task 1, test 3.

---

## Task 1: the basket's one Comp…

**Files:** modify `apps/till/src/widgets/basket.ts`, `apps/till/src/state/adjust-target.ts`,
`apps/till/src/i18n/strings.ts` (delete `table.comp_line` and `table.discount_line`, `:1108-1109`,
`:2810-2811`); tests `apps/till/src/widgets/basket.adjustments.test.ts`,
`apps/till/src/widgets/basket.a11y.test.ts`, `apps/till/src/till-app-counter-adjustments.test.ts`,
`apps/till/src/till-app-counter-move-station.test.ts`.

**Interfaces:** produces nothing new. The basket's `adjust` event for a comp becomes
`{ kind: "comp", combined: true, counter: true, target }` (`AdjustDetail`,
`till-table-order-screen.ts:323-331`, already has `combined?: true`); the bill's stays
`{ kind: "discount", counter: true, target }`.

- [ ] **Step 1: Write the failing tests.**
  1. `basket.adjustments.test.ts`, the case at `:320` renamed "offers one Comp… on every dish, and
     the bill's comp once": `all(el, "[data-comp-line]")` 3; `all(el, "[data-discount-line]")` 0;
     `[data-discount-bill]` 1 with text `t("table.discount_bill")` (unchanged);
     `within(el, 2, "data-comp-line")` aria-label `` `${t("comp.title")} · Hamburguesa` `` and text
     `t("comp.title")`.
  2. The case at `:335` renamed "comps an extra on its own and whole, naming it with its dish, …":
     `[data-comp-extra]` 1, `[data-discount-extra]` 0, `[data-cancel-extra]` 0; aria-label
     `` `${t("comp.title")} · ${bacon}` ``; one click on `data-comp-extra` hears
     `[{ kind: "comp", combined: true, counter: true, target }]` (the `target` object as now).
  3. The case at `:528` renamed "comps one of a dish with its extras by each unit's share of them":
     one click on `data-comp-line` hears `[["comp", "23.00", "11.50"]]`, and the detail has
     `combined: true`.
  4. `till-app-counter-adjustments.test.ts`, new case "opens the Comp window on a stored dish and
     sends one of two cañas": with the caña listed at quantity `"2.000"` (`listing(4, "2.50", "2.000")`,
     `heldOrder` likewise, `:106-135`), press `[data-comp-line="1"]`; the dialog's `combined` is
     `true` and its `wt-dialog` heading is `t("comp.title")`; choose Complaint, set the
     `adjustQuantity` stepper to 1 (as `adjustment-dialog.combined.test.ts:172` does), Continue;
     `api.previewAdjustment` was called with `("wo-9", { ...ask, quantity: "1" })`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/widgets/basket.adjustments.test.ts src/till-app-counter-adjustments.test.ts`
  — expected: 1–3 fail on the `[data-discount-*]` counts, the label and the missing `combined`;
  4 fails on `combined` (false).
- [ ] **Step 3: Implement.** In `basket.ts`, `#adjustActions` draws one secondary `wt-button`
  (class `line-adjust`, `data-comp-line` on a dish row, `data-comp-extra` on an extra row, text
  `t("comp.title")`, aria-label `` `${t("comp.title")} · ${name}` ``) in place of the
  `LINE_ADJUSTMENTS` map; it dispatches `{ kind: "comp", combined: true, target, counter: true }`
  (extend `#adjust` with an optional `combined`). Delete `LINE_ADJUSTMENTS` and its imports
  (`adjust-target.ts:43-46`; `StringKey`/`AdjustKind` imports there if unused). Delete the two
  strings in both languages. Reword the comment at `basket.ts:1208-1209` ("Cancel on a dish the
  kitchen has, and Comp on every dish, which covers its extras.") and the suite comment at
  `basket.adjustments.test.ts:13-14`.
- [ ] **Step 4: Update the other checks** (rows 1–5 of "Changed test checks"), and the helpers:
  `till-app-counter-adjustments.test.ts`'s `chooseReason` (`:325-331`) matches a reason by the text
  before the first " · " of its label (the Comp window labels a reason "Complaint · Free, % · …",
  `adjustment-dialog.ts:605-627`); its comments `:28`, `:333`, `:1649` say Comp, not Give away.
  `basket.adjustments.test.ts`'s `none` helper (`:566-575`) drops the two removed selectors.
- [ ] **Step 5: Run.**
  `pnpm --filter @waitron/till exec vitest run src/widgets/basket.adjustments.test.ts src/widgets/basket.a11y.test.ts src/till-app-counter-adjustments.test.ts src/till-app-counter-move-station.test.ts src/screens/till-table-order-screen.adjustments.test.ts`
  — all pass. `pnpm --filter @waitron/till typecheck` (catches any reader of the deleted keys).
- [ ] **Step 6: Commit** — "Basket: one Comp… per dish and extra, opening the Comp window (A758-5)".

## Task 2: the words, and a guard on them

**Files:** modify `apps/till/src/i18n/strings.ts`, `apps/till/src/i18n/codes.ts:609-612`,
`apps/till/src/widgets/adjustment-dialog.ts:40` (comment only); tests
`apps/till/src/i18n/strings.test.ts`, `apps/till/src/i18n/codes.test.ts`,
`apps/till/src/widgets/adjustment-dialog.test.ts`, `apps/till/src/widgets/adjustment-dialog.combined.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  1. `strings.test.ts`, new `describe("the till's comp words follow the Comp window's (design D10)")`,
     for each of `en` and `es`, with `word = cat["comp.title"].replace(/…$/, "")` and
     `free = cat["comp.free"].toLowerCase()`:
     - "titles a comp with the Comp window's word": `adjust.comp_title` and `adjust.comp_extra_title`
       start with `word`.
     - "names a free comp with the Free choice's word": `comp.make_free` and `adjust.do_comp`,
       lowercased, contain `free`.
     - "has no Spanish catalogue string that says invitar": no `es` value matches `/invit/i`.
     - "has no English catalogue string that says give … away": no `en` value matches
       `/\bgiv(e|en|ing)\b[^.]*\baway\b/i`.
     A comment says the guard is weaker than its name, as the siblings' do (`:42-45`): it reads the
     catalogue in `strings.ts` only; `codes.ts`'s messages are pinned in `codes.test.ts`.
  2. `codes.test.ts:394-399`: the new English and Spanish `adjustment.weighed_partial` texts of
     Decision 6 (check 6).
  3. `adjustment-dialog.combined.test.ts`, new case "asks for approval when the server needs a PIN":
     at the confirm step with a preview whose `needsApproval` is
     `{ by: "reason", roles: ["manager", "admin"] }`, `[data-adjust-confirm]` reads
     `t("adjust.ask_approval")`. It passes before any change (design §3.2 keeps the button); its
     control: change `adjustment-dialog.ts:1046` to always use `#compLabel(choice)` for the Comp
     window, watch it fail, restore.
- [ ] **Step 2: Run and watch 1 and 2 fail.**
  `pnpm --filter @waitron/till exec vitest run src/i18n/strings.test.ts src/i18n/codes.test.ts src/widgets/adjustment-dialog.combined.test.ts`
  — expected: the four D10 cases fail on «Invitar …», "Give an item away" and the give-away
  English; the codes case fails on both texts; test 3 passes (and fails under its control).
- [ ] **Step 3: Implement.** Set the strings and the code message of Decision 6's rows for
  `adjust.comp_title`, `adjust.comp_extra_title`, `adjust.do_comp`, `comp.make_free` and
  `adjustment.weighed_partial`. Cut "(service plan Task 11)" from the section comments
  (`strings.ts:1107`, `:2809`), which read "Cancelling and comps". Reword the comment at
  `adjustment-dialog.ts:40`: "Sold by weight, which the server refuses to comp in part."
- [ ] **Step 4: Update** `adjustment-dialog.test.ts` checks 7–9 of "Changed test checks".
- [ ] **Step 5: Run.**
  `pnpm --filter @waitron/till exec vitest run src/i18n src/widgets/adjustment-dialog.test.ts src/widgets/adjustment-dialog.combined.test.ts src/widgets/adjustment-dialog.a11y.test.ts`
  — all pass. Then `git grep -n -i "invitar\|give an item away\|give it away" -- apps/till/src`
  prints only test names and comments that name the stored `comp` action, none in a string file.
- [ ] **Step 6: Commit** — "Till: the Comp words in English and Spanish; no «Invitar» left (A758-5)".

## Task 3: "Comp the bill", with Free

**Files:** modify `apps/till/src/widgets/adjustment-dialog.ts`, `apps/till/src/i18n/strings.ts`;
tests `adjustment-dialog.test.ts`, `adjustment-dialog.a11y.test.ts`,
`adjustment-dialog.unsaved.test.ts`, `apps/till/src/till-app-counter-adjustments.test.ts`,
`apps/till/src/i18n/strings.test.ts`, `apps/server/src/adjustments-api.test.ts`.

**Interfaces:** inside the dialog only. The separate discount mode's `discountKind` state widens from
`DiscountKind` to the existing `CompKind` (`"free" | "percent" | "amount"`, `:59-60`). On a bill
target (`target.lineId === null`) Free sends
`{ action: "discount_percent", percentBp: 10000, reasonId, note }`, no `amount`.

- [ ] **Step 1: Write the failing tests** (`adjustment-dialog.test.ts`, a new
  `describe("till-adjustment-dialog: comping the whole bill")`; target
  `{ lineId: null, name: t("adjust.whole_bill"), quantity: null, total: "40.00", unitTotal: null }`,
  `kind: "discount"`, reasons `[complaint, regular, staffMeal]` from `:32-41`):
  1. "offers Free beside % and € under How much, with % chosen": the `discountKind` radios' values
     are `["free", "percent", "amount"]`, their labels `[t("comp.free"), "%", "€"]`, the legend
     `t("comp.how_much")`, and `percent` is checked.
  2. "sends Free as a 100% percentage, asking no value, under the reasons that allow Free and a
     percentage": choose `free`; `wt-input[name="percent"]` and `[name="amount"]` are absent; the
     reasons listed are `["Complaint"]` (Regular allows no Free, Staff meal no percentage); choose
     Complaint, Continue → `adjust-preview` detail
     `{ action: "discount_percent", reasonId: "Complaint", note: null, percentBp: 10000 }`. Then
     choose `percent`: the percent field is shown and empty; choose `amount` with Complaint chosen:
     no reason stays chosen (Complaint allows no amount).
  3. "puts a free bill's refusal above the action": with Free and Complaint chosen and
     `refusal: "adjustment.no_reduction"`, `actions(el).error` contains
     `codeMessage("adjustment.no_reduction")` and no `[data-error-for]` or `wt-input` error holds it.
  4. `adjustment-dialog.a11y.test.ts`, in its themed `describe.each` (`:61`): "has no violations
     comping the whole bill with Free chosen".
  5. `adjustment-dialog.unsaved.test.ts`: "choosing Free on the bill is a change, and % again is
     not" — follow the file's own close-and-ask pattern (`:68-121`).
  6. `till-app-counter-adjustments.test.ts`: "comps the whole stored order free": press
     `[data-discount-bill]`, choose `free`, Complaint, Continue →
     `api.previewAdjustment` called with `("wo-9", { expectedEdit: null, expectedRevision: 4, lineId: null, reasonId: "r-complaint", note: null, action: "discount_percent", percentBp: 10000 })`.
  7. `strings.test.ts`, Task 2's D10 describe gains "titles the bill's comp with the Comp window's
     word": `table.discount_bill` and `adjust.discount_bill_title` start with `word` in both
     languages; and `adjust.kind`, `adjust.kind_percent`, `adjust.kind_amount` are not keys of `en`.
  8. `apps/server/src/adjustments-api.test.ts`, new case beside "the route's own rules" (`:916`):
     "comps a whole bill free as a 100% percentage": `billWith(venue, [{ name: "Steak" }, { name: "Burger" }])`,
     `post(billId, { action: "discount_percent", percentBp: 10000 }, { cookie: venue.cookie.staff })`
     answers 200; `recordedOn(billId)` is one row with `lineId: null`, `action: "discount_percent"`,
     `percentBp: 10000`, `afterAmount: 0`, `reduction` equal to `beforeAmount` and above 0. It passes
     before any change (measured above); its control: change `value <= 10000` to `value < 10000` in
     `packages/adjustments/src/policy.ts:21`, run, see it fail with 400 `percentBp`, restore.
- [ ] **Step 2: Run and watch 1–7 fail.**
  `pnpm --filter @waitron/till exec vitest run src/widgets/adjustment-dialog.test.ts src/widgets/adjustment-dialog.a11y.test.ts src/widgets/adjustment-dialog.unsaved.test.ts src/till-app-counter-adjustments.test.ts src/i18n/strings.test.ts`
  — expected: no `free` radio (1, 2, 3, 5, 6), a11y finds no Free to choose (4), the words (7).
  `pnpm --filter @waitron/server exec vitest run src/adjustments-api.test.ts -t "100% percentage"`
  passes; run the control.
- [ ] **Step 3: Implement** in `adjustment-dialog.ts`:
  `#discountKinds()` (`:362-369`) puts `"free"` first when `this.target?.lineId === null` and some
  reason allows both `comp` and `discount_percent`; `#offered()` (`:371-378`) under Free keeps the
  reasons allowing both; `#action()` (`:351-360`) maps Free to `discount_percent`; `#choice()`
  (`:494-513`) sets `percentBp: 10000` for Free; `#ownErrors()` (`:438-455`) and `#comparable()`
  (`:267-293`) treat Free as having no value; `#refusalField()` (`:459-466`) passes `"comp"` as the
  kind while Free is chosen, so value refusals go above the action; `#discountFields()`
  (`:902-950`) draws the legend `comp.how_much` and the labels `comp.free`, `%`, `€`, and no input
  for Free. The default stays `"percent"` (Decision 4). In `strings.ts` set `table.discount_bill`,
  `adjust.discount_bill_title`, `adjust.do_discount` (English only) and delete `adjust.kind`,
  `adjust.kind_percent`, `adjust.kind_amount` in both languages.
- [ ] **Step 4: Run.**
  `pnpm --filter @waitron/till exec vitest run src/widgets src/till-app-counter-adjustments.test.ts src/till-app-adjustments.test.ts src/screens/till-table-order-screen.adjustments.test.ts src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.panel-footer.a11y.test.ts src/i18n`
  — all pass; `pnpm --filter @waitron/till typecheck`; `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5: Commit** — "Till: Comp the bill, with Free as a 100% percentage (A758-5)".

## Task 4: LOOK

Tests read keys; nobody has seen the new buttons. Method as A758-4's Task 6
(`docs/superpowers/plans/2026-10-21-a758-4-full-comp-receipt.md:591-616`): a throwaway browser test,
`apps/till/src/widgets/comp-words.look.test.ts` (never staged), mounting widgets with
`mountWidget(tag, props, theme)` (`apps/till/src/widgets/test-helpers.ts`); size the frame with
`page.viewport(390, 844)` and `page.viewport(1280, 800)` from `vitest/browser`, never
`commands.setViewportSize`, and save with `page.screenshot({ path: "__screenshots__/look/<name>.png" })`
(`docs/developers/testing-guide.md:1446-1479`); print `window.innerWidth` in each and report it.

- [ ] **Step 1: Draw**, each in light and dark at 390 and 1280, English and Spanish: (a) the basket
  with a stored order (`basket.adjustments.test.ts`'s `storedOrder()` and `stored` fixtures) —
  a sent dish with Cancel and Comp…, a dish with an extra, and "Comp the bill"; (b) the Comp window
  opened on a basket dish of two units (stepper shown) with Complaint chosen; (c) the bill's window
  with Free chosen, and its confirm step asking for approval. Name each
  `a758-5-<scene>-<lang>-<theme>-<width>.png`.
- [ ] **Step 2: Look.** One «Descuento…» per dish, never two words alike; the button row wraps at 390
  without pushing Cancel or the price off; Free, %, € sit on one row in both languages; no value
  field under Free; "Pedir aprobación" on the confirm step. A defect is fixed test-first in the file
  that owns it, and committed.
- [ ] **Step 3:** Copy the pictures to `/Users/clintongormley/waitron-campaign-c/a758-5-shots/` and
  to `docs/backlog/mockups/a758-adjustment-reasons/built/`; delete the harness and its
  `__screenshots__/look/` folder; `git status --short` shows only the pictures. Commit —
  "Pictures of the till's Comp words as built (A758-5)".

## Task 5: backlog

**Files:** `docs/backlog.md` (A758 `:2229-2268`; the new entry after A923 at `:2271`),
`docs/backlog/till.md` (`:1421-1431`).

**Reading of the outline's "Last PR" line.** The outline (`2026-10-19-a758-reason-rules.md:1142-1143`)
says to delete the A758 entry. A758-5 is the last of that plan's five pull requests, but the entry
also holds two slices nobody has built — §3.8 and "collect it at the counter" (design §9,
`:1031-1039`) — and "collect it at the counter" has no entry of its own: A908 is a different thing,
kitchen cancellation on Record unpaid departure (`docs/backlog.md:1926-1930`). A change deletes an
entry only when it finishes it (CLAUDE.md §6), so the entry stays and says only what is left.

- [ ] **A758** (`docs/backlog.md`): after A758-4's sentence add "**A758-5 built the till's words**
  ([plan](superpowers/plans/2026-10-22-a758-5-comp-window-words.md)): a counter order's dishes offer
  one Comp… that opens the Comp window, as a table's do; "Comp the bill" offers Free beside % and €;
  no till word says "Give away" or «Invitar»; A10xx is what it left open." Replace "Left: A758-5
  (the till's Comp words), and the §3.8 and "collect it at the counter" slices." with "Left: the
  §3.8 slice and the "collect it at the counter" slice." Never mark the entry done.
- [ ] **`docs/backlog/till.md` "## A758"**: the same A758-5 sentence after A758-4's (`:1426-1430`);
  "A758-5 and the §3.8 and "collect it at the counter" slices follow." becomes "The §3.8 and
  "collect it at the counter" slices follow."
- [ ] **New entry**, its number read from `~/waitron-campaign-shared/next-item-number` (read, use,
  write back the next one), placed after A923: "**A10xx. The till's adjustment window keeps a
  give-away and a line discount nothing opens (left open by A758-5).** Since A758-5 a dish or extra
  is comped only through the Comp window (`combined`), on the table and at the counter; the window's
  separate `kind: "comp"` mode and its line `kind: "discount"` mode remain, with their titles
  (`adjust.comp_title`, `adjust.comp_extra_title`, `adjust.discount_title`,
  `adjust.discount_extra_title`, `adjust.do_comp`) and most of `adjustment-dialog.test.ts`; and
  `till-app-adjustments.test.ts` drives the table's comps through that separate mode
  (`requestAdjustment` emits no `combined`) though the table screen sends `combined: true` — both
  since A773-1. Retire the two modes, make `kind: "comp"` mean the Comp window, and move those app
  tests onto it."
- [ ] Add the owner points below to the PR description, not the backlog. `pnpm exec prettier
  --file-info docs/backlog.md` prints `"ignored": true`. Commit — "Backlog: A758-5 built the till's
  Comp words; A10xx holds the window's unused modes".

**PR description** (plain English): first line "Review path: light — the till's words and the
basket's Comp button; no rule about who may comp changes, no migration, no filed figure changes."
Then what changed, with the pictures' paths; the server measurement (Task 3 test 8 and its control);
"Changed test checks" below; the owner points below.

---

## Changed test checks

Each changes because D10 / §3.4 changes what the till offers or says.

| # | Task | Where | Old → new |
|---|---|---|---|
| 1 | 1 | `apps/till/src/widgets/basket.adjustments.test.ts:320-332` | name "offers Give away and Discount on every dish, and Discount the bill once" → "offers one Comp… on every dish, and the bill's comp once"; `all(el, "[data-discount-line]")` 3 → 0; aria-label `` `${t("table.comp_line")} · Hamburguesa` `` → `` `${t("comp.title")} · Hamburguesa` `` |
| 2 | 1 | `basket.adjustments.test.ts:335-361` | name "gives away or discounts an extra…" → "comps an extra…"; `[data-discount-extra]` 1 → 0; aria-label `` `${t("table.comp_line")} · ${bacon}` `` → `` `${t("comp.title")} · ${bacon}` ``; the `data-discount-extra` click goes; heard `[{ kind: "comp", counter: true, target }, { kind: "discount", counter: true, target }]` → `[{ kind: "comp", combined: true, counter: true, target }]` |
| 3 | 1 | `basket.adjustments.test.ts:528-541` | name "gives away or discounts one of a dish…" → "comps one of a dish…"; the `data-discount-line` click goes; `[["comp", "23.00", "11.50"], ["discount", "23.00", "11.50"]]` → `[["comp", "23.00", "11.50"]]` |
| 4 | 1 | `apps/till/src/widgets/basket.a11y.test.ts:61` | name only: "…offering Cancel, Give away, Discount and a struck price…" → "…offering Cancel, Comp and a struck price…" |
| 5 | 1 | `apps/till/src/till-app-counter-move-station.test.ts:375` | `querySelector("[data-discount-line]")` → `querySelector("[data-comp-line]")` (the old attribute no longer exists, so the check would pass whatever the basket drew) |
| 6 | 2 | `apps/till/src/i18n/codes.test.ts:394-399` | `adjustment.weighed_partial` English and Spanish → Decision 6's texts |
| 7 | 2 | `apps/till/src/widgets/adjustment-dialog.test.ts:211-213` | the Spanish literal → `codeMessage("adjustment.weighed_partial", "es")` (reads the code file, which check 6 pins) |
| 8 | 2 | `adjustment-dialog.test.ts:223`, `:226` | "Give an extra away" → "Comp an extra"; "Give an item away" → "Comp an item" |
| 9 | 2 | `adjustment-dialog.test.ts:231` | «Invitar un extra» literal → `t("adjust.comp_extra_title")` (locale already `es-ES`, `:230`) |

**Helpers and comments only, no check changes:** `basket.adjustments.test.ts:13-14` and `:566-575`;
`till-app-counter-adjustments.test.ts:28`, `:325-331`, `:333`, `:1649`.

**Unchanged, checked:** `adjustment-dialog.test.ts:510` reads `t("adjust.do_comp")`;
`adjustment-dialog.combined.test.ts:282`, `:292` pin "Make 2 free", which stays;
`till-table-order-screen.adjustments.test.ts:438`, `panel-footer.test.ts:211` and
`panel-footer.a11y.test.ts:54` read `t("table.discount_bill")`. The already vacuous
`[data-comp-line], [data-discount-line]` checks on the table screen
(`till-table-order-screen.adjustments.test.ts:161`, `:279`, `:288`, `:363`;
`drawer-service-retirement.test.ts:178`; `till-app-adjustments.test.ts:4138`) are the table's and
are left as they are. If any other check turns red, stop and report it; it becomes a new row only
with the design point that changes it.

## Owner points (each with the default this PR builds)

1. **The counter's basket has one Comp… per dish and per extra**, opening the same window as the
   table (Decision 1). The other way: keep two buttons, which in Spanish would both read «Descuento».
2. **Free on the whole bill is offered only under a reason that allows Free and a percentage**
   (Decision 3): with the starter reasons, Complaint, On the house and Discount, not Staff meal.
3. **The bill's window opens on %**; Free is a choice, never preselected (Decision 4).
4. **Words no picture drew** (Decision 6): «Dejar {n} gratis» and «Dejar gratis» for a free comp's
   button, «Descuento en un plato» / «Descuento en un extra», the weighed-item message; in English
   "Comp the bill", "Comp the whole bill", "Apply the comp", "Make it free", "Comp an item".
5. **The Comp window keeps "Ask for approval"** (design §3.2, unchanged); now pinned by a test.
