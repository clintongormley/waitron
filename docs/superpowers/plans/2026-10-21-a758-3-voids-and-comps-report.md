# A758-3 — The voids and comps report: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: LIGHT** — no per-task reviewer. The plan is reviewed once against the design before
any implementer starts, and `/finish-branch` runs its usual wave, the Codex run-it seat included.
What makes it light: no migration, no fiscal record, no change to who may do what. Both report
routes keep their gate, `gatedBy(VIEW_REPORTS, …)` (`packages/adjustments/src/routes.ts:212-221`
and `:223-240`; `VIEW_REPORTS` is `"report.view"`, `:47`). The one new input, `reasonId`, narrows a
list the same permission already shows whole, so it reaches no row that was not reachable before.
It is an id in a request, though — if the plan reviewer counts that as the "by-id read" risk
trigger, the path becomes FULL and the driver adds per-task reviews to Tasks 3a, 3b-i and 3b-ii only.
**No task changes permissions or authentication.**

Implementers are dispatched as `subagent_type: "implementer"`. An implementer that passes about 150
tool calls with its task unfinished stops at a passing or cleanly failing point, commits, and
hands over: what is done, what is left, the files, and each check's state.

**Goal:** the adjustment report speaks the design's words and answers the design's question about
staff meals. In the totals by action, two rows, Voids and Comps, replace today's four. Each entry
names what was done in the owner's words ("Void", "Comp 100%", "Comp 20%", "Comp €3.00"). The
totals by reason say who asked for each reason and who approved it, with counts. The list of
entries gains a Reason filter, so choosing "Staff meal" lists every staff meal, who gave it and who
approved it.

**Architecture:** all inside `packages/adjustments`. The server keeps `byAction` exactly as it is;
the screen adds the three comp actions into one Comps row (Task 1a). The entries' words are
worked out in the screen from fields every entry already carries (Task 1b). The reason totals gain
three fields, filled in the loop that already sums them (`tallyRow`, `reports.ts:191-201`), and the
screen draws them as the people table already draws "Approved by" (Tasks 2a, 2b). The entries route
takes an optional `reasonId`, `listAdjustmentEntries` filters on it, and the screen gains a Reason
`wt-combobox` above the list (Tasks 3a, 3b-i, 3b-ii).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Hono, Lit, Vitest (a `node` project and a
real-Chromium `browser` project).

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` — §1 D7 and D10
(`:60`, `:63`), §3.6 "Reports" (`:361-411`; its "By kind" and "Each entry" bullets), §3.7 "Who gave
each comp, per reason" (`:413-421`). Parent plan and the outline this plan replaces:
`docs/superpowers/plans/2026-10-19-a758-reason-rules.md`, "# A758-3 — the report" (`:1069-1094`).
Backlog: `docs/backlog.md` "A758" (`:2192-2222`, its "Left:" at `:2217-2219`) and `docs/backlog/till.md` "## A758" (`:1472`).

Every `file:line` below was read on 2026-10-21 in this worktree at `main` `76adaee84` with
`sed -n`/`grep -n`, unless it names a command that was run. A758-1 (#1906, `435482753`), A758-2
(#1909, `33fa13a92`) and A773-1 (#1897, `c9ad7a634`) are all in that history (`git log --oneline`).

---

## The files

| File | Tasks |
|---|---|
| `packages/adjustments/src/dashboard/adjustment-report-screen.ts` (923 lines) | 1a, 1b, 2b, 3b-ii |
| `packages/adjustments/src/dashboard/strings.ts` (419 lines; `en` `:11-167`, `es` `:169-328`, name tables `:354-419`) | 1a, 1b, 2b, 3b-ii |
| `packages/adjustments/src/dashboard/adjustment-report-screen.test.ts` (1241 lines, browser) | 1a, 1b, 2b, 3b-ii |
| `packages/adjustments/src/dashboard/adjustment-report-screen.a11y.test.ts` (browser) | 3b-ii |
| `packages/adjustments/src/dashboard/client.ts` (types `:37-112`, `listEntries` `:199-217`) | 2a, 3b-i |
| `packages/adjustments/src/dashboard/client.test.ts` (browser) | 3b-i |
| `packages/adjustments/test/report-fixtures.ts` (fixture data only) | 2a |
| `packages/adjustments/src/reports.ts` (488 lines) | 2a, 3a |
| `packages/adjustments/src/reports.test.ts` (node, real database) | 2a, 3a |
| `packages/adjustments/src/routes.ts` (entries route `:223-240`) | 3a |
| `packages/adjustments/src/routes.test.ts` (node, real database) | 3a |
| `docs/backlog.md`, `docs/backlog/till.md` | 4 |

Nothing outside `packages/adjustments` and the two backlog files changes. The other readers of
the report were checked: `git grep -ln "computeAdjustmentReport\|listAdjustmentEntries\|adjustments/report" -- apps packages`
lists, besides this package, `apps/server/src/adjustments-report.test.ts`,
`apps/server/src/adjustments-apply.test.ts` and `apps/server/src/business-day-history.test.ts`.
They pin `byAction` and people rows with `toMatchObject`
(`adjustments-report.test.ts:270-276`, `:297-303`, `:333-337`;
`adjustments-apply.test.ts:2795-2810`) or compare one report with another of the same shape
(`adjustments-report.test.ts:316`). New fields on a reason's totals do not reach any of them, and
`byAction` does not change. No `scripts/` guard or `docs/developers` page names the report routes
(`git grep -n "report/entries\|adjustments/report" -- scripts docs/developers` printed nothing).

## Global constraints

- **General code is English only** (CLAUDE.md §3). Every Spanish word goes in
  `packages/adjustments/src/dashboard/strings.ts`. A test that checks Spanish reads the expected
  text from `ADJUSTMENTS_STRINGS.es` or `tf(…, "es")`, as the screen's tests already do
  (`adjustment-report-screen.test.ts:320-336`).
- **Product text as short as the meaning allows.**
- **A test's check changes only where the design changes what it checks.** Each such change is
  listed under "Changed test checks" with its line, old and new value, and the design point behind
  it. Adding missing fields to fixture data is allowed and listed under "Fixtures grown". Any other
  check that turns red is a stop and a report to the driver. No golden or fiscal test is touched.
- **Test first.** Each task starts with a failing test, run with the command given, and its
  expected failure is checked before the code is written.
- **How tests run in this package** (`packages/adjustments/vitest.config.ts`): `src/**/*.test.ts`
  outside `src/dashboard/` runs in the `node` project with one worker; everything under
  `src/dashboard/` runs in the `browser` project, in real headless Chromium. Name the file and
  Vitest picks its project:
  `pnpm --filter @waitron/adjustments exec vitest run <file>`. Before a browser run, check free
  memory (`memory_pressure | grep free`) and do not run beside a whole-workspace coverage run
  (CLAUDE.md §2). Read the `Tests` count on every run; a run that prints none proved nothing
  (CLAUDE.md §4).
- **Coverage stays at 98/98/98/95** (`vitest.config.ts`, `thresholds`). No exclude, no ignore
  comment. A helper the screen stops calling is deleted, not left behind. CI's `test-adjustments`
  job measures coverage (`.github/workflows/ci.yml:1790-1845`); run
  `pnpm --filter @waitron/adjustments test:coverage` locally only to chase a failure CI reports.
- **Not mutation-tested.** `packages/adjustments` has no `stryker.config.json` (the five that exist
  are `db`, `fiscal`, `shared`, `ui-core`, `ui`: `ls packages/*/stryker.config.*`), so CLAUDE.md
  §2's floor of 90 does not apply here.
- **Shared fields only:** a filter is a `wt-combobox` (CLAUDE.md §3, "A screen does not draw its own
  form field"); every colour, gap and size reads a `--wt-*` token; the combobox's `wt-change` is
  stopped inside the screen, as the date fields' already is (`adjustment-report-screen.ts:452-453`,
  pinned by `adjustment-report-screen.test.ts`'s "keeps a day's change inside the screen").
- **Guides:** no user guide describes this report.
  `git grep -n -i "adjustment\|voids\|comps\|informe de ajustes\|give-away" -- apps/server/src/guide`
  matched only the word "avoids" in `kitchen-service.md` and `products.md`. No guide changes.
- **After any change to `strings.ts`:** `pnpm exec vitest run scripts/english-only.test.ts
  scripts/native-form-fields.test.ts scripts/style-token-names.test.ts` from the worktree root.
- Every commit `git commit -s`, staging named paths only, never `git add -A`.

## Where the outline drifted (re-read on `76adaee84`)

1. **The outline's changed checks were four; they are seventeen.** It listed
   `adjustment-report-screen.test.ts:235`, `:260`, `:278`, `:536`. The By action tables are pinned
   whole, four rows each, at `:233-238`, `:258-263` and `:276-281`; the two lists of zero counts
   at `:292` and `:316` count four rows; `:304` picks row `[3]`; the intro at `:152-154` says
   "give-aways"; the entries' words are pinned at `:542` (it was `:536`), `:554`, `:579` and
   `:590`. Adding two columns to By reason changes `:245-249`, `:270-273` and `:283`, and new fields
   on a reason's totals change three `toEqual` pins in `reports.test.ts`. All seventeen are listed
   below.
2. **The entries route moved:** `routes.ts:205-222` in the outline is now `:223-240` (A758-1 and
   A758-2 added code above it).
3. **A malformed `reasonId` answers `shared.invalid_id`, not `management.request_invalid`.** The
   outline asked for the latter. Its sibling, `personId`, is screened by
   `requireUuidParam(personId, "PersonId")` (`routes.ts:150`), which throws `shared.invalid_id`
   (`packages/server-kit/src/request-screens.ts:14-16`), pinned at `routes.test.ts:843-856`; the
   reason routes screen their path id as `requireUuidParam(…, "AdjustmentReasonId")`
   (`routes.ts:264`, `:276`, `:286`). `reasonId` follows them.
4. **The server's own pins of `byAction` moved:** the outline's
   `apps/server/src/adjustments-report.test.ts:248-309` is now `:270-337` and
   `adjustments-apply.test.ts:2726-2731` is now `:2795-2810`. Neither changes (above).
5. **`COMP_ACTIONS` now exists** (`packages/adjustments/src/policy.ts:15`, added by A758-1), but the
   screen cannot import it: `client.ts:5-6` keeps local copies of the route types so the dashboard
   bundle does not pull `@waitron/db`, and `policy.ts:1` imports `@waitron/identity`. The screen
   keeps its own list of the three comp actions beside `ACTIONS`.
6. **The outline's other references still hold:** `reports.ts:45-49` (`ReasonTally`), `:383` (a
   cancel's list value credited to a person's sales), `adjustment-report-screen.ts:31-36`
   (`ACTIONS`) and `:563-572` (the people table's Approved by). `git log --oneline -1 --
   packages/adjustments/src/dashboard/adjustment-report-screen.ts packages/adjustments/src/reports.ts`
   names `c373162e2` (#1563), older than all three pull requests.
7. **The A758-1 words the design lists for the reasons page are already gone.** Design §9.1 names
   `reasons-screen.test.ts:304` ("Give away") and `:372` ("Invitación"). The reasons screen no
   longer calls `actionName`: `git grep -n "actionName\|actionTotalName" -- packages apps` finds it
   only in `adjustment-report-screen.ts:29`, `:599-603` and `:802`. So `ACTION_NAMES` and
   `ACTION_TOTALS` (`strings.ts:355-360`, `:375-380`) serve the report alone, and this PR retires
   them.

## Decisions (with receipts)

1. **The heading stays "By action"; its two rows are "Voids" and "Comps".** Design §3.6 heads the
   bullet "By kind", but D10 (`spec:63`) makes Void and Comp the names of both "the kinds and the
   till's actions", so "By action" over Voids and Comps uses D10's words. Keeping it leaves eight
   heading checks alone (`adjustment-report-screen.test.ts:255`, `:275`, `:289`, `:296`, `:301`,
   `:315`, `:324-336`; `adjustment-report-screen.a11y.test.ts:74-76`, `:84-86`). Owner point 1.
2. **Comps are added together in the screen, not on the server.** The server's `byAction` is pinned
   by the server suites above and by `reports.test.ts`'s whole-shape `toEqual`s; a `byKind` field
   would change every one of those. The screen adds the three comp tallies with `addDecimal` and
   `decimal` from `@waitron/shared`, which the screen already imports from (`formatMoney`,
   `adjustment-report-screen.ts:11`), so the browser bundle gains no new package.
3. **An entry's words.**
   - `cancel` → "Void" («Cancelado»).
   - `comp` → "Comp 100%". A Free comp always takes the whole price.
   - `discount_percent` → "Comp {percent}", the percentage written by the screen's existing
     `percentFormat` (`adjustment-report-screen.ts:84-86`, at most two decimals): "Comp 20%",
     «Descuento 20 %». A 100% percentage reads "Comp 100%" through the same path.
   - `discount_amount` → "Comp 100%" when it took the whole list value (`afterAmount` 0 and
     `beforeAmount` equal to `nominalValue`), else "Comp {amount}" with the amount it took off
     (`reduction`): "Comp €3.00", «Descuento 3,00 €». The parent plan's Open point 3 settles
     this rule; owner point 4 repeats it.
   - **"Void, charged" is deferred by choice, not for want of data.** Design §3.6 "Each entry"
     (`spec:365-367`) gives it to the report, but the parent plan's outline puts it with the §3.8
     slice ("Not here", `2026-10-19-a758-reason-rules.md:1093-1094`), and this plan keeps that
     scope. Until then a cancel that kept the charge reads "Void". The outline's reason ("Nothing
     stored says which cancels kept the charge", its Open point 5, `:1175-1178`) is too wide for
     the wording: A773-1 already writes a still-charge cancel with `beforeAmount` = `afterAmount` =
     the dish's charge and `reduction` 0 (`apps/server/src/line-cancel.ts:331-333`; pinned by the
     cases at `line-cancel.test.ts:319` and `:370`), so `action === "cancel" && afterAmount > 0`
     tells most of them apart on the entry the screen already has, with no migration. The one shape
     it cannot tell apart is a still-charge cancel of a dish already comped to €0.00 (before 0,
     after 0), which looks like a removed one — the fixture's `e2` (`test/report-fixtures.ts:169-184`)
     has that shape and must stay "Void". Task 4 carries this to the §3.8 slice; Owner point 6.
   One template, `"Comp {amount}"` / `"Descuento {amount}"`, carries all three comp forms.
4. **A reason's totals gain `requesters`, `guestRequests` and `approvers`.** `requesters` and
   `approvers` are `(PersonRef & { count: number })[]`, the shape `PersonAdjustments.approvers`
   already has (`reports.ts:72-73`), named after it, and sorted the same way: by name, then by
   count, largest first (`reports.ts:405-408`). A guest's request is not anyone's: the report
   files it under guests, never the staff member recorded as asking (`reports.ts:384-392`), and the
   entries list says "Guest" for it (`adjustment-report-screen.ts:659-660`). So a guest's row adds
   to `guestRequests`, not to `requesters`. `approvers` counts every row with an approver, the
   requester's own approval included, as a person's `approvers` already does (`reports.ts:389-391`;
   pinned at `reports.test.ts:886-891`). Every name these lists need is already looked up:
   `namesOf` reads `people.keys()` (`reports.ts:398`), which holds every non-guest requester
   (`:387`) and every approver (`:387-394`).
5. **The By reason columns are "Requested by" and "Approved by", not "Asked by".** Design §3.7
   writes "Asked by"; the entries list beside it already says "Requested by" («Solicitado por»,
   `strings.ts:161`, `:322`) for the same person, and D22 (`spec:75`) asks for one word per
   meaning. The column reuses the key `adjustment_report.entries.requested_by`. Owner point 2.
6. **The Reason filter is applied by the server.** The entries come a page at a time (200 rows by
   default, 500 at most: `packages/adjustments/src/entry-pages.ts:2-3`, used at
   `reports.ts:448-451`), so a filter applied in the browser, such as `wt-data-table`'s own Filters
   (`docs/developers/design-system.md:1637-1645`), would see only the rows already loaded.
   `reasonId` is matched against `adjustments.reason_id`, the id that groups a reason's rows and
   outlives its deletion (`schema/adjustments.ts:60-62`). A well-formed id that matches nothing
   answers an empty page, not `adjustment_reason.not_found`, because a deleted reason's rows still
   carry its id.
7. **The filter, on the screen.** A `wt-combobox` named `reason`, labelled "Reason" (the existing
   `adjustment_report.column.reason`, «Motivo»), `search="auto"`, under the list's heading. Its
   first option is "All reasons" («Todos los motivos», as the dashboard's content-gaps filter
   already says it: `apps/dashboard/src/i18n/strings.ts:574`, `:3616`) with the value `"all"`, as
   the staff screen's role filter does (`apps/dashboard/src/screens/staff-screen.ts:372-381`);
   reason ids are UUIDs, so `"all"` cannot be one. The other options are every reason the report
   counted over the range (`report.overall.byReason`), by name, then by id. The choice:
   - survives opening another person's list, so "Alex's staff meals" takes two choices;
   - survives a change of range. A reason the new range does not hold stays offered under the name
     it had when chosen, and the list is empty, so the field never changes its value by itself.
     While a reason is chosen, the empty list says `tableNoMatches()` (already imported by the
     screen, `adjustment-report-screen.ts:9`, and used as `noMatchesMessage` at `:868`), not
     `adjustment_report.none` ("No adjustments on these days.", `:867`), which would be false when
     the days hold adjustments under other reasons;
   - goes back to All reasons when the list is closed.
   Owner point 3.
8. **With no reason chosen, the screen calls the client exactly as it does today.** The screen's
   tests pin the call's arguments with `toHaveBeenCalledWith`, three arguments for a first page
   (`adjustment-report-screen.test.ts:532`, `:576`, `:597`, `:647`, `:1038`, `:1233`; and
  `toHaveBeenLastCalledWith` at `:417`) and
   `{ after }` or `{ after, limit }` for later ones (`:700`, `:820`, `:881`, `:972`, `:1041`), and
   the accessibility suite tells a first page from a later one by whether a fourth argument exists
   (`adjustment-report-screen.a11y.test.ts:93-97`). With no reason chosen, the first page passes no
   fourth argument and later pages pass no `reasonId` key, so those checks stand unedited. A chosen
   reason adds `reasonId` to the options. The client adds `reasonId=` to the address after
   `personId`/`guests` and before `after`/`limit`, so the full addresses pinned at
   `client.test.ts:205-207` and `:220-221` stand too.

---

## Task 1a: By action — Voids and Comps

**Files:** `adjustment-report-screen.ts` (`:29`, `:31-36`, `:797-805`), `strings.ts`
(`:108-109`, `:269-270`, `:374-380`, `:413-415`), `adjustment-report-screen.test.ts`.

- [ ] **Failing test first, in two runs.** A named import that `strings.ts` does not export stops
  the whole test file loading (`SyntaxError: … does not provide an export named …`, `Tests no
  tests`), so none of its cases would run. First change only the seven checks listed for Task 1a
  under "Changed test checks" and run
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/adjustment-report-screen.test.ts`.
  Expected: a `Tests` count with the by-action and intro cases failing by name, on
  "Cancellations"/"Give-aways" and four rows.
- [ ] **Then the Spanish case.** Add `kindTotalName` to `strings.ts` as an export that returns `""`
  for now, then add the case: with `setLocale("es-ES")`, the By action rows read
  `[kindTotalName("void", "es"), …]`, `[kindTotalName("comp", "es"), …]` — import the helper from
  `./strings.js`, never a literal. Run the same command. Expected: the file loads and the Spanish
  case fails on its row labels, beside the seven failures above.
- [ ] **The rows.** Replace `ACTIONS` with the two kinds and the actions each adds up:

  ```ts
  const COMP_ACTIONS: readonly AdjustmentAction[] = ["comp", "discount_percent", "discount_amount"];
  const KINDS: readonly { kind: "void" | "comp"; actions: readonly AdjustmentAction[] }[] = [
    { kind: "void", actions: ["cancel"] },
    { kind: "comp", actions: COMP_ACTIONS },
  ];

  /** The tallies of several actions, added together. */
  function sumTallies(tallies: AdjustmentTally[]): AdjustmentTally {
    return tallies.reduce((sum, tally) => ({
      count: sum.count + tally.count,
      reduction: addDecimal(decimal(sum.reduction), decimal(tally.reduction)),
      cancelledNominalValue: addDecimal(
        decimal(sum.cancelledNominalValue),
        decimal(tally.cancelledNominalValue),
      ),
    }));
  }
  ```

  The by-action breakdown maps `KINDS` to `{ label: kindTotalName(kind), tally:
  sumTallies(actions.map((action) => totals.byAction[action])) }`. Check what `addDecimal` returns
  for `"12.00"` plus `"3.00"`: the cell is drawn through `money()` either way, so the check reads
  "€15.00" whatever the scale.
- [ ] **The words.** In `strings.ts`, `ACTION_TOTALS` and `actionTotalName` go; in their place

  ```ts
  /** How a report heads each kind's total. */
  const KIND_TOTALS: NameTable = {
    void: { en: "Voids", es: "Cancelaciones" },
    comp: { en: "Comps", es: "Descuentos" },
  };
  export function kindTotalName(kind: string, locale?: string): string { … }
  ```

  The intro (D10: "give-aways" goes):
  - en: "Counts the voids and comps on the bills opened on these business days. A person's rate is
    what their own adjustments took off, as a share of the sales credited to them at prices before
    any adjustment."
  - es: "Cuenta las cancelaciones y descuentos de las cuentas abiertas en estas jornadas. La tasa de
    cada persona es lo que descontaron sus propios ajustes, en proporción a las ventas que se le
    atribuyen a precios anteriores a cualquier ajuste."
- [ ] Run the screen suite again: every case passes; read the `Tests` count. Then
  `pnpm --filter @waitron/adjustments typecheck` and the strings guards (Global constraints).
- [ ] Commit — "Adjustment report: totals by action as Voids and Comps".

## Task 1b: each entry in the owner's words

**Files:** `adjustment-report-screen.ts` (`:595-604`), `strings.ts` (`:354-360`, `:397-399`, new
keys in `en` and `es`), `adjustment-report-screen.test.ts`.

- [ ] **Failing test first.** Change the four checks listed for Task 1b, then add:
  - one case per form with a fixture entry each: a `discount_amount` that took the whole list value
    (`beforeAmount` "12.00", `afterAmount` "0.00", `nominalValue` "12.00") reads "Comp 100%"; one
    that took what an earlier comp left (`beforeAmount` "6.00", `afterAmount` "0.00",
    `nominalValue` "12.00") reads "Comp €6.00"; a `discount_percent` at `percentBp` 10000 reads
    "Comp 100%";
  - a Spanish case: the four forms read
    `tf("adjustment_report.entry.comp", { amount: "100 %" }, "es")` and so on, with the amount
    written by `Intl.NumberFormat("es", …)`/`formatMoney(…, "es")` in the test, not typed out, and
    the void as `ADJUSTMENTS_STRINGS.es["adjustment_report.entry.void"]`;
  - sorting by the Action column orders by those words.

  Run the screen suite. Expected: the new and changed cases fail on "Give away", "Cancel",
  "Amount discount", "Percentage discount (12.5%)".
- [ ] **The cell.** One function feeds both `cell` and `sortValue` of the `action` column:

  ```ts
  /** What was done, as staff name it: "Void", or "Comp" and how much (design §3.6). */
  function entryWords(entry: AdjustmentEntry, locale: string): string {
    if (entry.action === "cancel") return t("adjustment_report.entry.void");
    const amount =
      entry.action === "comp" || tookWholeValue(entry)
        ? percentFormat(locale).format(1)
        : entry.percentBp !== null
          ? percentFormat(locale).format(entry.percentBp / 10000)
          : money(entry.reduction);
    return tf("adjustment_report.entry.comp", { amount });
  }

  /** An amount comp that took the item's whole list value is a full comp. */
  function tookWholeValue(entry: AdjustmentEntry): boolean {
    return (
      entry.action === "discount_amount" &&
      compareDecimal(decimal(entry.afterAmount), decimal("0")) === 0 &&
      compareDecimal(decimal(entry.beforeAmount), decimal(entry.nominalValue)) === 0
    );
  }
  ```

- [ ] **The words.** New keys: `adjustment_report.entry.void` "Void" / "Cancelado";
  `adjustment_report.entry.comp` "Comp {amount}" / "Descuento {amount}". `ACTION_NAMES` and
  `actionName` go (nothing else calls them: drift 7).
- [ ] Run the screen suite (every case passes; read the count), typecheck, strings guards. Commit —
  "Adjustment report: each entry reads Void or Comp and how much".

## Task 2a: who asked for each reason and who approved it (server)

**Files:** `reports.ts` (`:45-49`, `:155-201`, `:203-223`, `:398-421`), `reports.test.ts`,
`client.ts` (`:46-49`), `test/report-fixtures.ts`.

- [ ] **Failing test first.** In `reports.test.ts`, change the three checks listed for Task 2a, and
  add, under "stages, reasons and guests":
  - **"Staff meal shows who gave each one and who approved it"** (design §3.7): Alex gives two
    staff meals, one approved by Mia; Sam gives one and approves it himself; a guest's request
    under the same reason is approved by Mia; Alex gives one Cold food. Expected for Staff meal in
    `read.overall.byReason`: `requesters` `[{ Alex, count 2 }, { Sam, count 1 }]`, `guestRequests`
    1, `approvers` `[{ Mia, count 2 }, { Sam, count 1 }]`; Cold food: `requesters`
    `[{ Alex, 1 }]`, `guestRequests` 0, `approvers` `[]`. The guest's row is not counted for the
    staff member recorded as asking.
  - The guests' own By reason (`read.guests.byReason`) for Staff meal: `requesters` `[]`,
    `guestRequests` 1. A person's own By reason (`personRow(read, alex).byReason`) names only Alex
    as requester.
  - **The order:** two requesters with the same count are in name order, and a larger count comes
    first — reuse the "the order of the rows" fixture's shape (`reports.test.ts:924-993`) or a
    smaller one.

  Run `pnpm --filter @waitron/adjustments exec vitest run src/reports.test.ts`. Expected: the new
  cases fail on `requesters` being `undefined`, and the three changed pins fail on the missing
  fields.
- [ ] **The sums.** `ReasonTally` gains

  ```ts
  /** Who asked for this reason, and how often; a guest's request is in `guestRequests`. */
  requesters: (PersonRef & { count: number })[];
  guestRequests: number;
  /** Who approved it, and how often, a requester approving their own included. */
  approvers: (PersonRef & { count: number })[];
  ```

  `Tallied` (`reports.ts:155-161`) gains `requestedBy`, `approvedBy` and `byGuest`, which
  `readReportRows` already selects (`:245-248`). `Accumulator.byReason` holds, per reason, the
  tally plus a `Map` of requesters, a `Map` of approvers and the guest count, filled in `tallyRow`.
  `totalsOf` takes the `ref` function `computeAdjustmentReport` builds at `:399` and turns each
  `Map` into the sorted list with the same `byName(...).sort(by count)` as `:405-408`; lift that
  into one helper both use. `totalsOf`'s two other callers, for overall and guests (`:416`, `:421`),
  pass the same `ref`.
- [ ] **The browser's copy.** `client.ts`'s `ReasonTally` gains the same three fields, amounts
  aside. `test/report-fixtures.ts` gives every `byReason` entry its values (see Fixtures grown);
  the screen does not draw them until Task 2b.
- [ ] Run `src/reports.test.ts` and `src/routes.test.ts` (node), the screen suite (browser, to show
  the fixture change broke nothing), and typecheck. Commit — "Adjustment report: each reason's
  requesters and approvers".

## Task 2b: By reason draws Requested by and Approved by

**Files:** `adjustment-report-screen.ts` (`:563-573`, `:685-716`, `:812-824`),
`adjustment-report-screen.test.ts`.

- [ ] **Failing test first.** Change the three checks listed for Task 2b, and add:
  - a reason asked for by a guest reads "Guests (1)" under Requested by, after any people, using
    `t("adjustment_report.guests")`;
  - a person the directory no longer holds reads "Unknown person (1)";
  - in Spanish, the two column headings read
    `ADJUSTMENTS_STRINGS.es["adjustment_report.entries.requested_by"]` and
    `…["adjustment_report.column.approved_by"]`;
  - By action and By stage keep four columns.

  Run the screen suite. Expected: the by-reason rows have four cells, not six.
- [ ] **The table.** `#breakdown` takes extra headings and, per line, extra cells:

  ```ts
  #breakdown(test, heading, first, lines: { label: string; tally: AdjustmentTally; extra?: (TemplateResult | string)[] }[],
             extraHeadings: string[] = [])
  ```

  The by-reason call passes `[t("adjustment_report.entries.requested_by"),
  t("adjustment_report.column.approved_by")]` and, per reason,
  `[peopleCell(reason.requesters, reason.guestRequests), peopleCell(reason.approvers)]`. One
  `peopleCell` draws a list of people with counts — one `<div>Name (n)</div>` each, then
  `Guests (n)` when there are some, `—` when empty — and the people table's Approved by
  (`:567-572`) uses it too, so both read the same.
- [ ] **Width.** Six columns may not fit the third of the page the By reason section gets
  (`.breakdowns section { flex: 1 1 calc(var(--wt-tap-min) * 8) }`, `:173-176`). If Task 5's
  pictures show it squeezed or overflowing, give the by-reason section the whole row (a class on
  that section with `flex-basis: 100%`) — tokens only.
- [ ] Run the screen suite and the a11y suite
  (`pnpm --filter @waitron/adjustments exec vitest run src/dashboard/adjustment-report-screen.a11y.test.ts`),
  typecheck, strings guards. Commit — "Adjustment report: By reason shows who asked and who
  approved".

## Task 3a: the entries' Reason filter (server)

**Files:** `reports.ts` (`:439-467`), `routes.ts` (`:139-151`, `:223-240`), `reports.test.ts`,
`routes.test.ts`.

- [ ] **Failing tests first.**
  - `reports.test.ts`, under "the drill-down, a page at a time": **"Staff meal lists every staff
    meal with who gave it and who approved it"** (design §3.7) — with Staff meal and Cold food rows
    from two people, `page({ reasonId: staffMeal.id })` lists only the Staff meal rows, newest
    first, each with its `requestedBy` and `approvedBy`; with `requester: { personId: alex }` too,
    only Alex's; with `limit: 1` and `after`, the second page keeps the filter and the last says
    `next: null`; an id no row carries answers `{ entries: [], next: null }`. Extend the test's
    `page` helper's options type (`reports.test.ts:193-200`) with `reasonId?: string`.
  - `routes.test.ts`, under "adjustment report routes": the entries route with
    `&reasonId=<id in capitals>` answers only that reason's rows (record one more row, under a
    second reason, inside the test — `reportFixture` stays as it is, because other cases count its
    two rows); `&reasonId=not-a-uuid` answers 400
    `{ error: { code: "shared.invalid_id", params: { kind: "AdjustmentReasonId", value: "not-a-uuid" } } }`;
    `&reasonId=` (empty) answers the same code with `value: ""`; a staff member without
    `report.view` is still refused with `reasonId` given (the existing refusal, one more path).

  Run `pnpm --filter @waitron/adjustments exec vitest run src/reports.test.ts src/routes.test.ts`.
  Expected: the filter cases list every row; the malformed id answers 200.
- [ ] **The query.** `listAdjustmentEntries`'s input gains `reasonId?: string`; when given,
  `conditions.push(eq(adjustments.reasonId, reasonId))`.
- [ ] **The route.**

  ```ts
  /** Every reason's rows when absent; a reason's id groups its rows even after it is deleted. */
  function requireReasonFilter(reasonId: string | undefined): string | undefined {
    return reasonId === undefined
      ? undefined
      : requireUuidParam(reasonId, "AdjustmentReasonId").toLowerCase();
  }
  ```

  and `reasonId: requireReasonFilter(c.req.query("reasonId"))` beside `requester` in the call at
  `:231-236`.
- [ ] Run both suites; read the counts. Typecheck. Commit — "Adjustment entries: filter by reason".

## Task 3b-i: the client asks with a reason

**Files:** `client.ts` (`:199-217`), `client.test.ts`.

- [ ] **Failing test first.** `client.test.ts`: `listEntries(from, to, { personId }, { reasonId })`
  asks `…&personId=…&reasonId=…`, and with `{ reasonId, after, limit }` asks
  `…&guests=true&reasonId=…&after=…&limit=…`. Run
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/client.test.ts`. Expected: the
  new cases ask no `reasonId`.
- [ ] **The client.** `listEntries`'s fourth argument becomes
  `options: { after?: string; limit?: number; reasonId?: string } = {}`; `reasonId` is set on the
  query right after `personId`/`guests` (Decision 8).
- [ ] Run the client suite (read the count) and typecheck. Commit — "Adjustments client: ask the
  entries for one reason".

## Task 3b-ii: the Reason field above the list

**Files:** `adjustment-report-screen.ts` (`:236-250`, `:330-386`, `:427-450`, `:472-478`,
`:828-889`), `strings.ts`, `adjustment-report-screen.test.ts`,
`adjustment-report-screen.a11y.test.ts`.

- [ ] **Failing tests first.**
  - `adjustment-report-screen.test.ts`, a new `describe("the reason filter")`, using
    `chooseOption` from `@waitron/ui/src/test-helpers.js` and the fixture's reasons:
    1. The list shows a `wt-combobox[name="reason"]` labelled "Reason", value `"all"`, options
       "All reasons" then Cold food, Entry error, Staff meal (by name).
    2. **"Staff meal lists every staff meal with who gave it and who approved it"**: choosing
       Staff meal asks `listEntries(from, to, "everyone", { reasonId: "r-staff" })` and shows the
       rows answered, with their Requested by and Approved by.
    3. Show more after a filtered first page asks `{ after: "c1", reasonId: "r-staff" }`; a live
       refresh's further reads carry `reasonId` beside `after` and `limit`.
    4. Choosing All reasons asks `listEntries(from, to, "everyone")` — three arguments.
    5. Opening another person keeps the choice and asks with it; closing the list and opening it
       again starts at All reasons.
    6. A new range whose report holds no Staff meal keeps the choice, still offers Staff meal by
       its name, and asks with it; when the answer is empty, the table's `emptyMessage` is
       `tableNoMatches()`, and with All reasons chosen it is `t("adjustment_report.none")` again.
    7. The choice's `wt-change` does not reach `document`.
    8. In Spanish, the label and the first option read `ADJUSTMENTS_STRINGS.es[…]`.
  - `adjustment-report-screen.a11y.test.ts`: "a list filtered by reason", in both themes (the
    file's `describe.each`).

  Run the screen and a11y suites. Expected: no `wt-combobox[name="reason"]`.
- [ ] **The screen.**
  - State: `@state() private reasonFilter?: { id: string; name: string }`, the chosen reason and the
    name it had when chosen.
  - `#listed` (`:247`) carries `reasonId`, and the query key (`:341`) includes it, so a new choice
    starts a new watch.
  - One helper makes every list request, so a first page with no reason passes no fourth argument
    and no request carries an empty `reasonId` key (Decision 8):

    ```ts
    #ask(api: AdjustmentsApi, listed: Listed, page: { after?: string; limit?: number } = {}) {
      const options = { ...page, ...(listed.reasonId === undefined ? {} : { reasonId: listed.reasonId }) };
      return Object.keys(options).length === 0
        ? api.listEntries(listed.from, listed.to, listed.of)
        : api.listEntries(listed.from, listed.to, listed.of, options);
    }
    ```

    `#readList` (`:366`, `:377`) and `#showMore` (`:435`) call it.
  - The field, under `.entries-head`:

    ```ts
    html`<wt-combobox
      name="reason"
      label=${t("adjustment_report.column.reason")}
      search="auto"
      .options=${this.#reasonOptions(report)}
      .value=${this.reasonFilter?.id ?? ALL_REASONS}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onReasonChange(event, report)}
    ></wt-combobox>`
    ```

    `#reasonOptions` is `[{ value: "all", label: t("adjustment_report.entries.all_reasons") }]`
    followed by `report.overall.byReason` sorted by name then id, plus the chosen reason when the
    report no longer holds it (Decision 7). `#onReasonChange` stops the event, sets or clears
    `reasonFilter`, and calls `#loadEntries(this.entriesOf!)`. `#closeEntries` clears
    `reasonFilter`; `#openEntries` keeps it. The entries table's `.emptyMessage` (`:867`) is
    `tableNoMatches()` while `reasonFilter` is set (Decision 7).
  - `#entriesSection` needs the report for the options: pass it in from `render` (`:913`).
- [ ] **The words.** `adjustment_report.entries.all_reasons`: "All reasons" / "Todos los motivos".
- [ ] Run the screen and a11y suites (read each count), typecheck, strings guards. Commit —
  "Adjustment report: a Reason filter on the list".

## Task 4: backlog

**Files:** `docs/backlog.md` (`:2212-2219`), `docs/backlog/till.md` (`:1491-1493`).

- [ ] In the A758 entry (`docs/backlog.md:2212-2219`) add one sentence after A758-2's: "**A758-3
  built the report** ([plan](superpowers/plans/2026-10-21-a758-3-voids-and-comps-report.md)): Voids
  and Comps in the totals, each entry's words, who asked for and approved each reason, and a Reason
  filter on the list." "Left:" loses "A758-3 (the report),". The entry stays open: A758-4, A758-5
  and the §3.8 and "collect it at the counter" slices remain. Never mark it done.
- [ ] The same sentence in `docs/backlog/till.md` "## A758" after A758-2's (`:1491-1493`), and
  "A758-3 to A758-5" (`:1493`) becomes "A758-4 and A758-5".
- [ ] **Hand "Void, charged" to the §3.8 slice.** The backlog has no entry of its own for that
  slice; it is named in the A758 entry's "Left:" (`docs/backlog.md:2217-2219`) and in
  `docs/backlog/till.md:1493`. In both places, after "the §3.8 … slices", add one sentence: the §3.8
  slice also makes the report's entries read "Void, charged" («Cancelado, cobrado», design §3.6) for
  a cancel that kept the charge, deferred from A758-3; most such rows are already told apart
  without a migration, because A773-1 writes a still-charge cancel with before = after = the
  dish's charge and nothing off (`apps/server/src/line-cancel.ts:331-333`), so `afterAmount > 0`
  marks them — all but a still-charge cancel of a dish already comped to €0.00, which needs the
  slice's stored flag. Re-read both places with `grep -n "Void, charged"` afterwards.
- [ ] For each owner point below that the PR leaves open, a short entry in the till area of
  `docs/backlog.md`, beside A923–A926, numbered from `~/waitron-campaign-shared/next-item-number`
  (read it, use it, write the next number back).
- [ ] Docs are not format-checked (`pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`). Commit — "Backlog: the voids and comps report (A758-3)".

## Task 5: LOOK

The screen is drawn by tests, which read text; nobody has seen it. Open it in real Chromium and
look. The demo stack seeds reasons but writes no adjustment rows (`git grep -ln
"recordAdjustment\|applyAdjustment" -- apps/server/scripts` prints nothing), so the pictures come
from a throwaway browser harness over the fixture data, never committed.

- [ ] Write `packages/adjustments/src/dashboard/adjustment-report-screen.look.test.ts` (do not stage
  it). It mounts the screen as `adjustment-report-screen.a11y.test.ts` does (`mountThemed`, the
  fixture report and entries), registers `DROPDOWN_ICONS` with `registerIcons` from `@waitron/ui`
  (an unregistered icon draws an empty box: `docs/developers/testing-guide.md:1356-1359`), sizes the
  frame with `page.viewport(w, h)` from `vitest/browser` — never `commands.setViewportSize`, which
  leaves the test's frame alone (`testing-guide.md:1316-1323`) — and saves each picture with
  `page.screenshot({ path: "__screenshots__/look/<name>.png" })`, because a path outside the
  workspace is refused (`testing-guide.md:1340-1350`). In each case, read `window.innerWidth`
  and print it: the width measured is what the report states, not the width asked for.
- [ ] Pictures, at 1280 and 390 wide, light and dark, English, plus Spanish at 390 light:
  1. the report with everyone's totals (By action's two rows; By reason with its two new columns);
  2. every adjustment listed, with all four entry forms (add a `discount_percent` 20% and a full
     `discount_amount` entry to the harness's list);
  3. the list filtered to Staff meal, with the Reason field closed;
  4. the Reason field open.
- [ ] Copy them to `/Users/clintongormley/waitron-campaign-c/a758-3-shots/` (create it), delete the
  harness and its `__screenshots__/look/` folder, and check `git status --short` shows neither.
- [ ] Look at each, and record in the PR description what to check:
  - the By action table has two rows, and its numbers equal the four old rows added up;
  - By reason's six columns fit at 1280 and at 390 (Task 2b's width step if not); names with
    counts sit one under another in a cell;
  - each entry's Action cell reads Void, Comp 100%, Comp 20%, Comp €3.00 and their Spanish, the
    percent sign spaced in Spanish;
  - the Reason field sits under the list's heading, as wide as its longest choice (`stable-width`) and never wider than the screen, and its
    open list shows All reasons first;
  - dark theme: the field's box, the open list's hover and the chosen row's tick are visible.
  Fix what is a defect (a failing test first); list what is a judgement call as an owner point.

**PR description:** the review path (LIGHT, and why); what the report now shows, in plain words;
Changed test checks and Fixtures grown below; the pictures' paths and what to check; the owner
points.

---

## Changed test checks

Seventeen checks change. Each is in `packages/adjustments/src/dashboard/adjustment-report-screen.test.ts`
unless named.

| # | Task | Where | Old → new | Why |
|---|---|---|---|---|
| 1 | 1a | `:152-154` (intro) | "Counts the cancellations, give-aways and discounts on the bills…" → "Counts the voids and comps on the bills…" (rest unchanged) | D10: "give-away" goes; Void and Comp are the names people see |
| 2 | 1a | `:233-238` (everyone's By action) | four rows Cancellations 2/€25.00/€37.00, Give-aways 1/€12.00, Percentage discounts 0, Amount discounts 1/€3.00 → two rows `["Voids","2","€25.00","€37.00"]`, `["Comps","2","€15.00","€0.00"]` | §3.6 "two rows, Voids and Comps, replacing today's four" |
| 3 | 1a | `:258-263` (Alex's By action) | four rows → `["Voids","2","€25.00","€37.00"]`, `["Comps","1","€12.00","€0.00"]` | §3.6 |
| 4 | 1a | `:276-281` (Sam's By action) | four rows → `["Voids","0","€0.00","€0.00"]`, `["Comps","1","€3.00","€0.00"]` | §3.6 |
| 5 | 1a | `:292` (guests' counts) | `["0","0","0","0"]` → `["0","0"]` | §3.6 |
| 6 | 1a | `:304` | `breakdown(…)[3]` = `["Amount discounts","1","€3.00","€0.00"]` → `breakdown(…)[1]` = `["Comps","2","€15.00","€0.00"]` | §3.6 |
| 7 | 1a | `:316` (a person with no row) | `["0","0","0","0"]` → `["0","0"]` | §3.6 |
| 8 | 1b | `:542` (Alex's comp, action `comp`) | "Give away" → "Comp 100%" | §3.6 "Each entry", D10 |
| 9 | 1b | `:554` (Alex's cancel) | "Cancel" → "Void" | §3.6, D10 |
| 10 | 1b | `:579` (Sam's €3.00 off a €24.00 bill) | "Amount discount" → "Comp €3.00" | §3.6 |
| 11 | 1b | `:590` (12.5%) | "Percentage discount (12.5%)" → "Comp 12.5%"; the case's name (`:585`) becomes "writes a percentage comp's percentage after Comp" | §3.6 |
| 12 | 2a | `packages/adjustments/src/reports.test.ts:341-344` (Alex's By reason, `toEqual`) | each reason gains `requesters`, `guestRequests`, `approvers`: Mistake `[Alex 2]`, 0, `[]`; Cold food `[Alex 1]`, 0, `[Mia 1]` | §3.7: By reason gains who asked and who approved |
| 13 | 2a | `reports.test.ts:464-468` (overall By reason, `toEqual`) | the same fields: Mistake as above; Cold food as above; Regular `[Sam 1]`, 0, `[]` | §3.7 |
| 14 | 2a | `reports.test.ts:811-813` (a reason named by its newest row, `toEqual`) | gains `requesters: [Alex 2]`, `guestRequests: 0`, `approvers: []` | §3.7 |
| 15 | 2b | `:245-249` (everyone's By reason) | four cells a row → six: Entry error `"Alex (2)"`, `"—"`; Cold food `"Alex (1)"`, `"Mia (1)"`; Staff meal `"Sam (1)"`, `"—"` | §3.7 |
| 16 | 2b | `:270-273` (Alex's By reason) | the same two extra cells for Entry error and Cold food | §3.7 |
| 17 | 2b | `:283` (Sam's By reason) | `["Staff meal","1","€3.00","€0.00"]` → `[…, "Sam (1)", "—"]` | §3.7 |

Unchanged, checked: the By action headings (Decision 1); every `listEntries` call check
(Decision 8); `client.test.ts`'s pinned addresses (Decision 8); the server suites named under "The
files"; `adjustment-report-screen.a11y.test.ts` (one case added, none changed).

## Fixtures grown

- `packages/adjustments/test/report-fixtures.ts`: each `byReason` entry (`:51-52`, `:70`) gains
  `requesters`, `guestRequests` and `approvers`, with the values the fixture day implies (Alex
  asked for Entry error twice and Cold food once, Mia approved the Cold food comp; Sam asked for
  Staff meal once). `fixtureReport`'s overall `byReason` (`:91`) spreads them, so it follows.

## Owner points (each with the default this PR builds)

1. **The totals' heading stays "By action"** («Por acción»), its rows Voids and Comps. Design §3.6
   calls it "By kind"; D10 makes Void and Comp the names of both kinds and actions. The other way:
   "By kind" («Por tipo»), changing eight heading checks (Decision 1).
2. **By reason's column says "Requested by"** («Solicitado por»), the word the entries list beside
   it already uses, where §3.7 wrote "Asked by" (Decision 5). The other way: "Asked by" in both
   places.
3. **How the Reason filter behaves:** it keeps its choice when another person's list is opened or
   the days change, and goes back to All reasons when the list is closed (Decision 7). A deleted
   reason re-added under the same name shows twice in the field, as two reasons, because the report
   groups by id (`reports.ts:204-214`; `reports.test.ts:985-991` pins two "Twin" rows).
4. **"Comp 100%" for an amount comp** means it took the item's whole list value. An amount that
   takes what an earlier comp left reads "Comp €6.00", not "Comp 100%" (the parent plan's Open
   point 3).
5. **Words no picture drew:** Voids / Comps («Cancelaciones» / «Descuentos»), Void («Cancelado»),
   "Comp {amount}" («Descuento {amount}»), All reasons («Todos los motivos»), and the reworded intro
   in both languages.
6. **"Void, charged" is deferred to the §3.8 slice by choice.** Design §3.6 gives it to the report,
   and most of the rows that need it can already be told apart (`afterAmount > 0` on a cancel;
   Decision 3), so it could be built here without a migration. This PR keeps the parent outline's
   scope instead, and until the §3.8 slice a cancel that kept the charge reads "Void" beside €0.00
   taken off. The other way: build it in this PR, leaving only the €0.00-comped case to the slice.
7. **Still not here** (the §3.8 slice, the parent plan's Open point 5): "Refunded …", «En
   preparación», and a €0.00 "still charge" cancel's list value counted in its person's sales
   (`reports.ts:383`).
8. **The Spanish report still says «anulado»** beside the new «Cancelaciones»: the By action
   column «Valor de carta anulado» (`strings.ts:295`) and the summary figure «Valor de carta de lo
   anulado» (`strings.ts:283`). D10 makes Void «Cancelar» and D22 asks for one word per meaning,
   but neither the design nor an owner answer gives these two phrases, so this PR leaves them. The
   other way: «Valor de carta cancelado» / «Valor de carta de lo cancelado» (no test spells them).
