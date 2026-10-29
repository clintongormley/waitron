# A1208 Counter orders as portions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution: INLINE, deliberately.** The owner's inline-coding trial (watcher note of 2026-10-27,
> `~/waitron-campaign-c/queue.md:12`, "runs until 2026-11-03") marks A1208 `trial: inline`
> (`queue.md:488`): the lead session writes each task itself, test first, ticking these boxes. This
> overrides the general preference for implementer dispatches for this item only; each task is still
> sized for one sitting of well under 100 tool calls.

**Goal:** Counter orders (walk-up sales, parked and placed counter orders, `openTab` with lines, and
new lines saved onto an open counter order) store every dish as its own portion, as table orders
have since A803 slice 1, while the invoice's rows, totals, VAT, invoice numbers and filed records stay
exactly what they are today; the counter basket still shows identical dishes as one row.

**Architecture:** The one counter writer, `createOpenOrder`, splits its priced rows with slice 1's
`expandPortionRows` and binds them with `registerPortions`, exactly as `placeGroups` does for tables;
the walk-up still files from the gross lines it priced, with each row's portion ids attached so
`linkSalePortions` links the sale. `applyLineEdits` writes new lines as portions on every order, not
only on a party's. On the till, the counter basket folds a retrieved order's identical portions into
one row (slice 1's `tabLinePortionKey`), turns that row back into one wire line per portion only
where it saves, and re-reads the order after a save that changed which stored lines it holds.

**Tech Stack:** TypeScript, Hono server, node:sqlite through drizzle, Lit till, Vitest (server: node;
till: browser mode).

**Spec:** [A803 design](../specs/2026-10-18-a803-bills-and-tables-design.md) §3.1 ("Every order line
holds one portion of one dish … '2 × Hamburguesa' is two lines"; no counter exception), read with
[slice 1's plan](2026-10-27-a803-1-portions.md) (finding 1 and D1, which this item reverses; D3–D12,
D14, D26, D30, D31 and D35, which it keeps) and the queue item text (`~/waitron-campaign-c/queue.md`,
A1208).

**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a1208-counter-portions`,
branch `feat/a1208-counter-portions`, planned from main `09d13e7fd`. Ends **needs-owner-review at
land** (queue item), even with green CI.

## Global Constraints

- The fiscal core is untouched: `computeHuella`, the chain, invoice-number allocation,
  `registros_facturacion`, `recordSale`, `recordCorrection`, `recordSubstitution`,
  `packages/catalogue/src/pricing.ts`. **H2** must pass byte-unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
  Any task that finds it must touch the core stops and writes a decision request.
- A test edited to pass is a stop, except: the owner-approved protected tests (kind P below), a
  fixture gaining what it lacks, a whole-shape pin gaining a key, and the kinds A, T, B, K, X listed
  under "Test-change inventory", each recorded old → new in `~/waitron-campaign-c/a1208-changed-checks.md`
  as it is made. Any money value, VAT figure, filed row, receipt amount, refund cap, invoice number or
  approval verdict that would change is kind C: stop, keep the failing output, revert the task's
  uncommitted change, write a decision request.
- No migration. The change writes rows into the four tables slice 1 created (`order_portions`,
  `working_line_portions`, `sale_line_portions`, `order_portion_events`,
  `packages/db/src/schema/order-portions.ts:13, 29, 54, 85`) and edits no schema file. If a task finds
  it needs one, the drizzle-kit generator assigns the number and the S guards run.
- No venue reset: an unbound line is still priced as its own row (`groupedByPortion`,
  `apps/server/src/working-order.ts:1364-1384`), so counter orders written before the release still
  pay. The PR says so.
- General code is English only. No new till string; the existing `tab.portions_too_many` wording
  (`apps/till/src/i18n/codes.ts:32-34`) is used. Guide Spanish ships only with the owner's approval at
  land (slice 1's D22).
- Every command's exit status is checked; a Vitest run is evidence only when it prints a nonzero
  `Tests` count.
- Focused runs: `pnpm --filter @waitron/server exec vitest run <file>`;
  `pnpm --filter @waitron/till exec vitest run <file>`. Before any till browser run check
  `memory_pressure | grep free` (well above 15% beside another session).
- **F** (fiscal paths): `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts`.
  **G** (guides): `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- The flip probe patch, `~/waitron-campaign-c/a1208-probe/flip.patch`, applies to main `09d13e7fd`.
  "Both ways" in a task means: run the named files plainly, then with `git apply` of the patch, then
  `git checkout -- apps/server/src/working-order.ts` (record both counts in the ledger). Never commit
  it; never `git stash` (shared stash list).

## Decisions

- **D1 — one writer, no flag.** Every counter order goes through `createOpenOrder`
  (`working-order.ts:1600-1748`): walk-ups cash and manual card (`till-sale.ts:742`), integrated card
  (`till-sale.ts:1281`), parked (`parkOrder`, `working-order.ts:1762`), and `openTab` with lines
  (`:1849`, whose only line-passing caller is the test helper `openPartyTab`, slice 1 finding 1). All
  expand. The three product callers that pass no lines (`parties.ts:178`, `bill-actions.ts:183`,
  `order-drafts.ts:198`) write nothing new. `addTabRound` stays a grouped test writer (slice 1 D26).
  Why `openTab` expands too: the owner's approved protected tests `split-bill.fiscal.test.ts` and
  `bill-payments.test.ts` reach it through `openPartyTab`, so the owner's approval already assumes it.
- **D2 — where expansion sits.** In `createOpenOrder`, after the simplified-ceiling refusal
  (`:1702`) and before the order number is allocated: `expandPortionRows(pricedLines.lineRows,
  pricedLines.lineContexts, pricedLines.portionable, 1)` (`order-portions.ts:45-115`), insert its
  rows and contexts, then `registerPortions(tx, expanded.portions)` after the line insert (`:1737`)
  and contexts (`:1744`). The ceiling refusal stays first: `till-sale-integrated.db.test.ts:812-829`
  ("still refuses an omitted invoice choice above the simplified ceiling", 2001 coffees) passed under
  the flip probe only because the probe kept that order. The cap (`refuseTooManyPortions`,
  `order-portions.ts:34-37`) is therefore met after the ceiling and before any write.
- **D3 — the walk-up files exactly what it files today.** `createOpenOrder` keeps returning the
  `gross` that `priceOrderLines` priced from the request (`:1701`), unchanged, so `recordSale`
  receives the same lines as today. Only `identities` change: each row gains `lineIds` and
  `portionIds` in the convention `projectPortionSale` uses (`portion-sale-projection.ts:118-151`: a
  dish row lists its portions' dish lines and portions; an extra row lists that extra's copy under
  each portion and the dish's portions), so `linkSalePortions` (`till-sale.ts:1029, 1651, 1826`,
  `order-portions.ts:327-344`) links every filed row. They are built in memory from the expansion
  (new pure `portionIdentities`, Task 2), not by reading the order back: one read fewer per walk-up.
  **Probe receipt:** the flip probe re-read every expanded counter order with `readStoredOrder` and
  threw `A1208 PROBE: grouped readback differs` if its gross (quantities compared as numbers, keys
  sorted) or its identities' `[id, productId, classification]` differed from the request's. Over F
  and the whole server suite the message appeared 0 times (`grep -c 'A1208 PROBE'` on
  `~/waitron-campaign-c/a1208-probe/F-flip.txt` and `server-flip.json`: 0, 0). Its first two
  versions did print it, for key order and `"2"` against `"2.000"`, so the check could fire.
- **D4 — new lines on any open order are portions.** `applyLineEdits`' default for fresh lines,
  `expand: order.partyId !== null` (`working-order.ts:5860`), becomes `expand: true`. Rises already
  follow the line (slice 1 D30: a bound line rises by copies, `risesByCopies`,
  `order-portions.ts:204`, read at `working-order.ts:5931-5936`), so a retrieved counter
  order's bound dishes rise by copies without further change. Slice 1's test "a new line on a counter
  order stays one line" (`order-portions.filing.test.ts`, describe "A803 portions: raising a dish")
  reverses (kind A).
- **D5 — the 99-a-dish cap applies at the counter.** A walk-up, park or save that adds more than
  `PORTIONS_AT_ONCE` (99, `packages/shared/src/quantity.ts:2`) of one dish in one line is refused
  `tab.portions_too_many`, as at tables. The till already shows that code's words on the counter
  (`ACTIONABLE_REFUSALS`, `apps/till/src/till-app.ts:898-899`, read by `counterError` `:970-979` on
  cash `:6455`, card `:6642`, park `:8625` and place `:7500`), and a retrieved order's save is pinned
  in `till-app-boot-and-counter.test.ts:3502-3525`. **Owner question Q1** (recommended default: this
  rule). Reason for the cap: slice 1's reviewer found 5000 portions crash `insertTabRound` with
  "Maximum call stack size exceeded" (`~/waitron-campaign-c/item-a803-1-ledger.md:44`).
- **D6 — `registerPortions` writes in two statements, not two per portion.** Today it inserts one
  registry row and one binding per portion in a loop (`order-portions.ts:117-143`). The flip probe
  made `issuance-pass.test.ts:790-820` ("reads the classification once when lines are added, however
  many lines … the basket has") fail with 48 statements for five lines against 40 for one; that test
  is a performance pin, so the fix is in product code (Task 1), and the test stays unedited. The same
  saving reaches table rounds.
- **D7 — the counter basket groups on the till, by the listing.** `#loadIntoBasket`
  (`till-app.ts:8716-8798`) builds one `OrderLine` per stored dish from `getHeldOrder`
  (`working-order.ts:5135`, one entry per dish line) and keeps the stored listing as `counterLines`
  (`:8796`). A new pure module folds lines whose listed dish has the same non-null
  `tabLinePortionKey` (`apps/till/src/state/portion-groups.ts:70-92`; null unless the line is a bound
  whole portion, `wholePortion` `:36-44`) into one line of that count, keeping every member's id. No
  grouping when the listing is unknown (`listed === null`) or the order holds money
  (`paidInPart` over the held list, as `#basketPaidInPart` reads it, `:6696-6705`): a paid portion
  then stays a row of its own, as on the table screen, where a part-paid line stands alone
  (`till-table-order-screen.ts:2564-2578`). The same fold reaches a table's bill retrieved at the
  counter, which slice 1's LOOK saw as one row per portion. Grouping on
  the server instead (in `getHeldOrder`) was rejected: the till already owns the "what is one row"
  key, and only it knows what it drew as one row (slice 1 D31).
- **D8 — a grouped row is sent as its members only where it is saved.** `#currentSaleLines`
  (`till-app.ts:6726-6740`) stays one wire line per basket row, because one reader maps answers back
  by position: `#askCounterDeadEnds` (`:6756-6800`) sends it, the server keys each line
  `String(index)` (`apps/server/src/till-api.ts:1714`), and the till applies the answer with
  `setLineMakeAt(Number(key), …)` and `removeLine(index)` (`till-app.ts:6793-6798`). Expanding there
  would send a row of 3 cañas as three keys and shift every later row's key. The expansion happens in
  one place, `#syncIfDirty` (`:7326-7356`), the only caller of `updateWorkingOrder` (`:7337`; `rg -n
  'updateWorkingOrder\(' apps/till/src/till-app.ts` finds no other). No other send can carry a folded
  row: a folded row exists only on a persisted order, and the server ignores `lines` when it pays a
  persisted order (the walk-up branch, `till-sale.ts:737-756`, runs only when `locked === undefined`;
  the till's own comment at `till-app.ts:6396`). **Audit of position mappings** (`rg -n
  'Number\(key\)|removeLine\(|lateSendAsked|refusedLines' apps/till/src/till-app.ts
  apps/till/src/state/late-send.ts`): the dead-end answer above is the only one; a late-send refusal
  is matched by menu item id, never position (`state/late-send.ts:73-84`). The rule for a row of `k`
  members at quantity `q`: members 1…min(k, q) at `"1"` each, in line order, except that when `q > k`
  the last member is sent at `q − k + 1` (it rises by copies on the server, slice 1 D6, so the cohort
  and the filed row stay one); members after `q` are left out, which removes them (`updateHeldOrder`,
  `working-order.ts:6754-6830`, removes every stored line a basket omits). Each member carries the
  row's extras, options, note and making station. Lowering takes the **last** members, as slice 1's
  D32 takes the last portions of a row.
- **D12 — after a save that moved stored ids, the basket re-reads them.** Today a successful
  `#syncIfDirty` only records the new revision (`markSaved`, `apps/till/src/state/working-order.ts:417-419`)
  and resets the unsaved baseline (`#commitBasket`, `till-app.ts:2397-2400`); the store stays dirty
  (`#dirty` is cleared only by `markPersisted` `:413`, `clear` `:912` and `loadFrom` `:951`) and
  `counterLines` stays the listing read at load (`:8796`). Flows that keep the basket after such a
  save: a card or cash pay, place or park that fails after its save (each catch path, e.g.
  `:6424-6455`), and `#onCounterBillPay` (`:17331-17386`), which saves and then opens Pay with
  `payLines(this.counterLines…)` (`:17382`). On main a second save resends the same ids and
  quantities, a no-op for stored lines. On portions a row raised from 3 to 4 still lists 3 members, so
  a second save would omit the 4th portion and add a copy back (a cancel and a new dish if it was sent
  meanwhile). So `#syncIfDirty`, after a successful save of rows that included a folded row or a row
  with no stored id, re-reads the order and its listing (`retrieveWorkingOrder` + `getTabLines`, the
  reads `#loadHeldOrder` makes, `:8703-8708`), re-folds, and adopts the result through a new store
  method that does **not** bump `loadGeneration` — every caller compares `basketVisit` with
  `loadGeneration` right after `#syncIfDirty` returns (`:6400`, `:6561`, `:8582`, `:17348`), and a
  reload through `#reloadCounterOrder` (`:8837`) would end each of them. If the re-read fails the
  basket is held with the existing `held.reread_failed` words, so no further save goes from stale
  members.
- **D9 — row actions on the counter name the row, and its extras.** The basket's Comp/Void/discount
  and Move station on a grouped row send every member, through the same `rowAdjustTarget`
  (`apps/till/src/state/adjust-target.ts:109-143`) and `DishMove.lineIds` (`till-app.ts:1341`) the
  table screen uses; the shared `#onAdjust` (`till-app.ts:13800`) and `#onCancelItem`
  (`:13424-13474`) already forward `lineIds`. An action on one **extra** of a grouped row
  (`#extraActions`, `basket.ts:1273-1291`, today `lineAdjustTarget(listedExtra, …)` on the first
  member's extra only) takes the matching entry of `rowAdjustTarget(...).extras` (`adjust-target.ts:124-134`:
  one target per extra product, its `lineIds` naming that extra under every member), so Comp on the
  cheese of a 3 × burger row comps three cheeses, as today's one line of 3 does. The server checks
  them as slice 1 D31 and D34 state.
- **D10 — what reverses from slice 1, and what does not.** Reverses: D1 and finding 1 (counter
  writers stay grouped), D30's last clause ("on a counter order they do not [expand]"), the
  table-service guide's counter paragraph (`apps/server/src/guide/en/table-service.md:189-190` and its
  Spanish twin), design-system's "(a counter order's)" exception
  (`docs/developers/design-system.md:5657-5658`) and its opening sentence "A table's order stores each
  dish as its own portion" (`:5647`), backlog A1190, and the comments that justify a grouped fixture by
  counter orders: `rg -c 'counter order moved to a table keeps' apps/server/src` finds 38 in 12 files
  ("Grouped, as a counter order moved to a table keeps it (plan D1)"), plus the `billWith` doc
  comment (`testing/adjustment-venue.ts:541-543`, "as `createOpenOrder` stores a counter order's")
  and the `expand` field comment (`working-order.ts:5851-5852`, "or a new line on a party bill").
  Not reversed: the test name "an unbound counter line still rises in place"
  (`order-portions.filing.test.ts:1520`), which builds its bill `{ bound: false }` (`:1521`) and pins
  D30's unbound case, still true for counter lines written before the release. Kept: the partial-quantity paths
  (D12) for measured lines and lines written before the release; their tests that reach them through a
  counter writer build a grouped order directly (kind B).
- **D11 — now, before slices 2–4.** See "Now or after slices 2–4".

## Now or after slices 2–4

**Answer: build it now.** It is sound before them and cheaper than after.

- **Sound:** no slice 2–4 task names a function this item changes. `grep -n 'createOpenOrder\|applyLineEdits\|loadIntoBasket\|currentSaleLines\|basket.ts\|till-sale.ts' docs/superpowers/plans/2026-10-19-a803-bills-and-tables.md`
  finds two lines, both in the "Current code map" table (`:59, :61`), none in a slice. Slices 2–4
  change bill identities, the table screen's switcher and menu, `move-bill.ts`, `parties.ts`,
  `order-drafts.ts`, `bill-actions.ts` and a new portion picker (master plan `:206-352`); this item
  changes `createOpenOrder`, one default in `applyLineEdits`, `registerPortions`, and the counter
  basket's load and save.
- **Cheaper now:** (1) slice 4 moves portions between bills; with counter orders grouped, a counter
  order moved to a table still arrives with lines of several (`moveBill` to a free table,
  `move-bill.ts:264-285`, re-points the whole bill through `takeIntoParty` and leaves its lines as
  they are), so slice 4
  would have to keep and test the grouped arrival path (slice 1 D23's split help, `carveLines`'
  refusal `working-order.ts:4632, 4673, 4694`). After this item only lines written before the release and
  measured lines arrive that way. (2) A1196 (retire the partial-quantity paths) waits on A1190
  (`docs/backlog.md:2010-2013`); this item is A1190. (3) Slices 2+ wait on another lane's A773-2
  reservation (`~/waitron-campaign-c/item-a1208-ledger.md`, "A803 slices 2+ wait on A773-2's
  reservation"), so "after" is an open-ended wait while the test inventory below goes stale.
- **Costs of now:** lane F's open #2235 changes `split-bill.test.ts`,
  `working-order.pay-and-dispatch.test.ts` and `kitchen-print.test.ts` (Tasks 4 and 6b), both
  `kitchen-service.md` guides (Task 9) and `kitchen-print.ts` (`gh pr view 2235 --json files --jq
  '.files[].path'`): rebase whichever lands second. **Counter Pay items becomes one row per portion**
  (backlog A1191): the counter's pay-by-item list is `payLines(this.counterLines…)`
  (`till-app.ts:7684`, `:17382`), one row per stored dish line (`state/bill-payment.ts:345-360`), so
  a counter order of 12 cañas paid by item shows 12 rows, as a table's already does; it cannot be
  grouped while A739 holds `state/bill-payment.ts` and `widgets/bill-pay-dialog.ts` (slice 1 D15).
  Owner question Q5. Lane F's blocked A739 Cut B lists `till-app.ts`,
  `state/working-order.ts`, `till-sale.ts` and `working-order.ts` for its counter payment bridge
  (`docs/superpowers/plans/2026-10-27-a739-approved-payment-flow.md:42-45, 78`); Task 0 compares
  functions, as slice 1 did.

## Current code map (main `09d13e7fd`)

| Boundary | Where | Today |
| --- | --- | --- |
| Counter writer | `apps/server/src/working-order.ts:1600-1748` `createOpenOrder` | Prices request lines (`:1690-1701`), refuses over the ceiling (`:1702`), inserts grouped rows (`:1737`), records contexts (`:1744`), returns request `gross` + `identities` (`:1747`) |
| Callers | `till-sale.ts:742` (cash/manual card walk-up), `:1281` (integrated card walk-up); `working-order.ts:1762` (`parkOrder`), `:1849` (`openTab`); `parties.ts:178`, `bill-actions.ts:183`, `order-drafts.ts:198` (no lines) | |
| Walk-up filing | `till-sale.ts:969-1060` `fileImmediateSale`; `issuancePass` `issuance-pass.ts:17-35` (contexts by `identities[i].id`, lengths must match `:24-28`); `linkSalePortions` `till-sale.ts:1029, 1651, 1826` | Links nothing today: no identity carries `portionIds` (`order-portions.ts:332`) |
| Table expansion to copy | `apps/server/src/order-groups.ts:337-374` | `expandPortionRows` from the round's first line number, `registerPortions` after `insertTabRound` |
| Expansion and cap | `order-portions.ts:34-37` `refuseTooManyPortions`, `:45-115` `expandPortionRows`, `:117-143` `registerPortions` (per-portion inserts `:132`, `:139`) | |
| Stored readers | `working-order.ts:1311-1384` `readLockedLines`, `readLockedLinesForIssuance`, `groupedByPortion`; `portion-sale-projection.ts:76-154` | Group bound portions by cohort for parked/placed/table payment |
| Held-order edits | `working-order.ts:5857-5861` fresh-line default; `:5931-5936` rises; `:6754-6830` `updateHeldOrder` | Fresh lines expand only on a party bill |
| Held-order read | `working-order.ts:5135-5300` `getHeldOrder`/`readBasketOrder` | One wire line per dish line |
| Till basket load | `apps/till/src/till-app.ts:8700-8798` `#loadHeldOrder`, `#loadIntoBasket` | One `OrderLine` per wire line; `counterLines = listed` `:8796` |
| Till basket save | `till-app.ts:6726-6740` `#currentSaleLines`; `:2346-2366` `#basketPayload`; `:7326-7356` `#syncIfDirty` (the only `updateWorkingOrder`, `:7337`) | One wire line per `OrderLine`; no re-read after a save |
| Dead-end question | `till-app.ts:6756-6800` `#askCounterDeadEnds`; server key `till-api.ts:1714` | Answers keyed by wire-line position |
| Counter Pay items | `till-app.ts:7684`, `:17382` `payLines(this.counterLines…)`; `state/bill-payment.ts:345-360` | One row per stored dish line |
| Refund value | `apps/server/src/cancellation-refund-value.ts:15`, by position while no line is bound (`:61`, `:77`), by portion once one is (`:78-85`), none when a share is not whole cents (`:144`) | Counter lines unbound today, so by position |
| Receipt lines | `receipt-adjustments.ts:28` `receiptLines(…, identities, …)`, called at `till-sale.ts:1075, 1707, 1885` | Reads the identities D3 changes |
| Card recovery | `till-sale.ts:1740` `finalizeRecovery` files from `priceStoredOrderForIssuance` (`:1765`), not from the request | The grouped readback |
| Basket actions | `apps/till/src/widgets/basket.ts:503-521` `#lineStationMove`, `:1252-1272` `#lineActions`, `:1273-1291` `#extraActions`, `:1222-1226` `#listed` | Name one line |
| Row helpers (slice 1) | `apps/till/src/state/portion-groups.ts:10-30, 70-92`; `state/adjust-target.ts:109` `rowAdjustTarget` | Used by the table screen only |

## Probes run during planning (all reverted; tree clean, `git status --short` empty)

1. **Flip probe**, `~/waitron-campaign-c/a1208-probe/flip.patch`: D2's expansion in `createOpenOrder`
   with `registerPortions`, D3's readback check, and D4's `expand: true`. `tsc --noEmit` exit 0.
2. **F with the flip:** 7 failed, 257 passed (264). Failing: `bill-payments.test.ts` "refuses
   splitting off more of a line than is unpaid" (`management.request_invalid` from `itemsDue`,
   `bill-payments.ts:869`); `split-bill.fiscal.test.ts` ×2 (`tab.line_not_found` from `carveLines`);
   `till-api.fiscal-sale-paths.test.ts` "a cash/card payment sends its dish once" ×2
   (`{ items: 2, fired: 2 }` against `{ items: 1, fired: 1 }`, `:903`), "files an extras pick and an
   options answer…" (4 working lines against 2, `:2842`; the filed `sale_lines` check `:2817-2831`,
   rows `2000`/`4000`, **passed**), and "Mode T: place files no fiscal doc…" (two queue items of
   `1.000` against one of `2.000`, `:1823`). The failing case for each fiscal check (a total, a VAT
   band, an invoice number, a registro count) would have printed an `AssertionError` at those lines;
   none did. Output: `~/waitron-campaign-c/a1208-probe/F-flip.txt`.
3. **H2 with the flip:** 20 passed (2 files). H2 does not reach `apps/server`, so this shows the core
   is unedited, not that the counter files identically; probe 4 and Task 10 do that.
4. **Whole server suite with the flip** (`vitest run --maxWorkers=10 --reporter=json`, 64–67% memory
   free): 26226 tests, 108 failed in 30 files, 25 skipped. Summary:
   `~/waitron-campaign-c/a1208-probe/server-flip-summary.md`; raw `server-flip.json`.
5. **Control:** the same 30 files without the flip: 1943 passed, 0 failed (`control.json`). So all
   108 failures are the flip's.

## Test-change inventory

Kinds: **P** owner-approved protected fiscal test, rewritten to the portion shape and at least as
strict; **A** the test pins a counter or `openTab` order's stored shape (working lines, ticket items,
queue items, held-order lines, tab lines) → the portion shape (spec §3.1); **T** a request names
"line n at quantity q" in the grouped shape → it names the portions standing for the same dishes
(slice 1's `todayLine`/`todayLineNos`, `apps/server/src/testing/adjustment-venue.ts:679, 790`),
assertions unchanged; **B** the test exercises a partial-quantity path through a counter writer → it
builds a grouped counter order directly (Task 4's fixture), assertions unchanged — not in money files
without listing it for the owner (slice 1 D35's rule); **K** a fixture deletes a bound line → it
unbinds first (`deletePortionBindings`); **X** a fixture orders more than 99 of one dish in one line →
the same dishes in request lines of at most 99, every asserted amount unchanged; **R** fixed by
product code, test unedited; **C** stop.

Predicted from the probe's failure messages; each task confirms the kind at its red run and records
old → new.

**Green under the flip, but read anyway.** `apps/server/src/testing/split-extras-venue.ts`'s
`createOfferedOrder` (`:245-255`) writes a counter order with lines through `createOpenOrder`, so
from Task 6a-1 it writes portions. `rg -l 'split-extras-venue' apps/server/src` lists 15 files (the
helper and 14 users); only `kitchen-print.test.ts` and `working-order.test.ts` among them failed under
the flip. A user that stayed green may still carry a name or comment promising "a line of several"
while it now tests portions: Task 4 reads each one's names and comments, and either renames the case
to what it now tests (listed, kind A) or adds a grouped sibling where the partial path it named has no
other test (Task 10's coverage comparison is the check).

| File (failures) | Kind | What fails under the flip | Task |
| --- | --- | --- | --- |
| `till-api.fiscal-sale-paths.test.ts` (4) | P ×3, A ×1 | parked `{items:1,fired:1}` ×2 (cash, card); walk-up extras' 2 working lines; Mode T queue (not named by the owner, **Q2**) | 6a-2 |
| `split-bill.fiscal.test.ts` (2) | P | `agua × 3` split by line number | 6a-2 |
| `bill-payments.test.ts` (1) | P | pays `{lineNo:1, quantity:"2"}` of `caña × 3` | 6a-2 |
| `issuance-pass.test.ts` (1) | R | 48 statements for five lines against 40 for one | 1 |
| `till-sale-integrated.db.test.ts` (4) | X | 2001 coffees in one line (`:600`, `:1451-1453`) | 3 |
| `till-api.receipt.test.ts` (2) | X | walk-up of 1000 (`:2325`) | 3 |
| `till-api.sell-published.test.ts` (1) | X | 250 ml of lemonade in a unit without the Measure switch (`:700`; Q1) | 3 |
| `bill-refunds.card.test.ts` (1) | K | raw `delete … line_no = 2` (`:1896`) | 3 |
| `transfer-lines.test.ts` (17) | B (and A where a check reads whole-line moves) | partial transfers and quantity guards on a tab from `createOpenOrder` (`:614`); slice 1 listed it as unchanged by D1 | 4 |
| `split-bill.test.ts` (5) | B / A | partial splits; rows of a split; also in lane F's #2235 | 4 |
| `till-api.transfer.test.ts` (2) | B / A | "splits part of a line"; "moves a whole line" | 4 |
| `till-api.unroutable-dish.test.ts` (1) | B | split dish → `tab.merge_self` (`carveLines` → `moveOrderLines`) | 4 |
| `working-order.test.ts` (32) | A mostly; T for held-order edits; B for "a cancel's extras cascade splits a 50 g child" (`tab.merge_self`) | parked lines per portion; `getHeldOrder` lines; edits naming line 1 at 2 (e.g. `:2123` gets `extras.invalid`: "edit 2" now removes portion 2 and raises portion 1) | 4 (B), 5 (T), 6b (A) |
| `bill-payments-api.test.ts` (5) | T ×4, A ×1 (money file) | line edits that leave the bill paid; part of a line split off; rows `['35.00','3.00','3.00','3.00']` | 5 |
| `clock-behind-stop.records.test.ts` (2) | T | line edits | 5 |
| `receipt-language.test.ts` (4) | T ×2, A ×2 (money file) | `PUT …/lines/2` lowering; stored order goods (the `sale` half passed) | 5, 6b |
| `till-api.service-periods.test.ts` (2) | A / T | a raise now adds a portion beside the line | 5 |
| `attendance-orders.test.ts` (1) | A / T | credit rows `[1000, …]` against `[2000, …]` | 5 |
| `simplified-limit.test.ts` (3) | A | stored lines `['2:1000','3:1000']` against `['2:2000']` | 6b |
| `order-portions.filing.test.ts` (1) | A (D4 reverses it) | "a new line on a counter order stays one line" | 6a-1 |
| `order-portions.lifecycle.test.ts` (1) | A (D10 reverses it) | "a counter order moved to a table keeps its grouped lines, and a partial move of its dish with extras is still refused" | 6a-1 |
| `kitchen-print.test.ts` (2) | A | station queue's per-dish extras; `('pan','separate')` prints `1.000 ud x Pan` twice against `2.000 ud x Pan` (**Q3**) | 6b |
| `counter-release.test.ts`, `tabs.test.ts`, `testing-zone-offers.test.ts`, `till-api.test.ts` (2), `till-sale.test.ts` (6), `working-order.customer-fallback.test.ts`, `working-order.pay-and-dispatch.test.ts`, `scripts/demo-seed/seed.integration.test.ts` | A | working lines, ticket items, tab lines, held-order lines per portion; every `sale_lines` check in these files passed (e.g. `till-sale.test.ts:1420-1422`) | 6b |

The protected rewrites (P), each at least as strict as today:

- `till-api.fiscal-sale-paths.test.ts:852-912` (cash and card): `{ items: 1, fired: 1 }` → `{ items: 2,
  fired: 2 }` after pay and after the replay, **plus** both ticket items name the two dish lines bound
  to one cohort's portions 1 and 2; the registro count (1) and `settled` checks unchanged.
- `till-api.fiscal-sale-paths.test.ts:2836-2842`: working lines `[{answer}, {}]` → four lines, dish /
  Queso / dish / Queso, each dish `1000` with the frozen answer, each Queso `2000` under its own dish;
  **plus** the two dishes hold portions 1 and 2 of one cohort and both filed rows link to both portions
  (`sale_line_portions`); the filed rows check (`:2817-2831`), the VAT breakdown (`:2796-2799`) and
  the reprint/replay checks unchanged.
Each rewritten protected case whose old version reached a partial-quantity path (slice 1 D12) keeps
that path tested through a **new grouped sibling case** in the same file (an added case, no edit to an
old one): `split-bill.fiscal.test.ts` gains "on a tab written before portions, a part of the agua line
still files on its own check", today's `splitIntoThreeChecks` on a grouped bill (Task 4's fixture
through `placeGrouped`) with today's assertions; `bill-payments.test.ts` gains the same case on a
grouped `caña × 3` with today's assertions, and the portion case "a split naming one paid and one
unpaid portion is refused and moves nothing" (`bill.line_paid`; both lines still on the bill).

- `split-bill.fiscal.test.ts:190-235`: splits `{lineNo:1, quantity:"1"}, {lineNo:2}` /
  `{lineNo:1, quantity:"1"}` / `{lineNo:1}` → `{lineNo:1}, {lineNo:4}` / `{lineNo:2}` / `{lineNo:3}`
  (agua portions are lines 1–3, jamón line 4), **plus** each check's agua row links to exactly one
  portion and the three are distinct; every total, VAT band, contiguity, conservation and partition
  assertion (`:258-353`) unchanged. `:355-397` (2 × agua, split `{lineNo:1, quantity:"1"}`) passed
  under the flip and stays as it is.
- `bill-payments.test.ts:605-629`: pay `{lineNo:1, quantity:"2"}` → pay lines 1 and 2; splitting
  line 1 → `bill.line_paid` (was quantity 2 of line 1), splitting line 3 succeeds (was quantity 1);
  the line left `2000` → two lines of `1000`, **plus** they are exactly the two paid portions' lines.
- `till-api.fiscal-sale-paths.test.ts:1823-1913` Mode T (A, Q2): one queue item of `"2.000"` → two
  identical items of `"1.000"`; the advance loop advances both; both read `ready`; total `3.00`,
  change, QR and the one registro unchanged.

## Review Focus

1. A walk-up whose basket holds the same dish on two request lines (two taps that did not merge, a
   dish with and without extras): each request line is its own cohort and files as its own row, as
   today. Task 6a-1 pins it (case b).
2. Lowering a retrieved row of three to two on the counter after one portion was paid by item from a
   table: D7 keeps paid baskets ungrouped, so the paid portion is never the one left out. Task 7a pins
   it.
3. A retrieved row raised on the counter after it was sent (fired): the last member goes as
   `q − k + 1`, and the server's `"raise"` prices the added dishes apart (`working-order.ts:5965-5986`)
   as it does for today's one line of `k` raised. Task 7a pins the request; the basket offers no `−` on
   a dish the kitchen has (`basket.ts` `#lineReadOnly`, `:494-501`), so only raising is reachable.
4. A counter order moved to a table, then one burger with its cheese split off: it now just works
   (spec §3.1). Task 6a-1 pins it (case e); the old refusal `tab.transfer_modifier_line` stays for lines written
   before the release.
5. Over the cap on a walk-up: refused before any row, order number or payment is written, and the
   till shows the code's words in both languages on cash, card and park (Task 8).
6. A retrieved order with a folded row and a new dish that no station can make: the dead-end window
   lists the caña once and the new dish's choice lands on the new dish (D8; Task 7a pins it).
7. A save that keeps the basket open (a declined card after the save, or the counter's bill Pay):
   the next save names every stored portion, including those the first save added (D12; Task 7b).

---

### Task 0: Preflight, reservations and the "before" dump (no commit)

**Files:** ledger `docs/handoffs/2026-10-29-a1208-counter-portions.md` (gitignored, `.gitignore:49`);
`~/waitron-campaign-c/a1208-compare/` (outside the repo).

- [ ] `git status --short` empty; `git log -1` is `09d13e7fd` or a rebase of it. If main moved,
      rebase, re-resolve every `file:line` in the code map a task touches, and re-apply-check the
      flip patch (`git apply --check`).
- [ ] Reservations: `rg -n 'A739|A773-2|A738|A796' ~/waitron-campaign*/queue.md | rg -n 'in-progress'`
      and `gh pr list --state open --json number,title,files`. Record per task whether an active
      item or open PR changes the same functions (`createOpenOrder`, `applyLineEdits`,
      `registerPortions`, `#loadIntoBasket`, `#syncIfDirty`, `#onCounterBillPay`, `#basketPayload`,
      basket `#lineActions`/`#extraActions`/`#lineStationMove`, `WorkingOrderStore`). A "yes" waits.
      Lane F's #2235 is a known overlap (see "Costs of now").
- [ ] Baseline counts: run F, H2 and `pnpm --filter @waitron/server exec vitest run src/order-portions.test.ts src/order-portions.filing.test.ts src/order-portions.lifecycle.test.ts`; record each `Tests` count.
- [ ] Write the dump test `~/waitron-campaign-c/a1208-compare/counter-filing-dump.test.ts`. It uses
      only functions present on both main and the branch (`payWorkingOrder`,
      `payWorkingOrderIntegratedOrchestration`, `parkOrder`, `updateHeldOrder`, `placeOrder`,
      `openPartyTab`, `splitPartyBill`, `moveBill`), names dishes the same way in both shapes (a
      helper that reads the order's lines and sends one line on a grouped order, the members per D8
      on portions), and writes `$A1208_DUMP` as JSON: for every sale in invoice-number order, the
      invoice number and type, total, VAT breakdown, every `sale_lines` row by line number (name,
      quantity, unit price, gross, base, VAT rate, list price, parent line number, product **name**),
      the sale's `registros_facturacion` row's `secuencia`, `tipo_registro`, `num_serie_factura`,
      `tipo_factura`, `desglose`, `cuota_total`, `importe_total`, `destinatarios`, `primer_registro`,
      `anterior_num_serie_factura`; the ticket the sale call answered (its `lines`, `total` and
      `vatBreakdown`) and the same ticket read again through the replay (`readSettledTicket`, by
      re-sending the same request); and, where a scenario cancels after paying, the refund value
      `cancellationRefundValue` (`cancellation-refund-value.ts:15`) answers for each cancelled dish and
      the correction record the refund files. Excluded as run-dependent: ids, timestamps, huellas.
      **What can differ.** Scenarios 1–4 and 9 file the request's own priced lines on both shapes
      (D3), so their filed rows cannot differ; they are there for the ticket lines and the reprint,
      which read the identities D3 changes (`receiptLines`, `receipt-adjustments.ts:28`, called at
      `till-sale.ts:1075, 1885`). The scenarios whose filed rows can differ are 5–8 and 10–13.
      Scenarios: (1) walk-up cash 2 × burger with 2 × cheese each, 1 × agua (21% and 10%);
      (2) walk-up 3 × €3.33 croqueta + 1 × €2.00 water; (3) manual card walk-up of (1); (4) integrated
      card walk-up of (2); (5) park 2 × caña, raise to 4 unsent, add a new tarta, remove the agua, pay
      cash; (6) Mode T park + place + collect of 2 × agua; (7) `openPartyTab` 3 × agua + 0.300 kg
      jamón, split one agua and the jamón, pay both; (8) park 2 × burger with cheese, move to a table,
      split one burger off (main can only move the whole line; recorded as the one expected
      difference), pay both; (9) F1 walk-up with a recipient; (10) 10% discount on the row of 3
      croquetas of a parked order (slice 1 D31 row target on portions, line target on main), then
      pay; (11) scenario 10's bill, then cancel one croqueta with a refund after paying: dump its
      refund value and the correction; (12) walk-up 3 × croqueta paid, then cancel one with a
      refund: dump the value and the correction; (13) an integrated-card walk-up whose capture is
      filed by recovery (`finalizeRecovery`, `till-sale.ts:1740`, which files from the stored order,
      `:1765`), driven as `order-portions.filing.test.ts:389` drives it.
- [ ] Run it on the branch base (= main) **twice**: copy into `apps/server/src/`, then
      `A1208_DUMP=~/waitron-campaign-c/a1208-compare/before.json pnpm --filter @waitron/server exec vitest run src/counter-filing-dump.test.ts`
      and again with `before-2.json`; delete the copy; `git status --short` empty. Nonzero `Tests`
      each time. `diff <(jq -S . before.json) <(jq -S . before-2.json)` prints nothing: the dump is
      repeatable, so a difference in Task 10 is the change's. If it prints anything, a run-dependent
      field leaked into the dump: exclude it and repeat.
- [ ] Coverage baseline for the partial-quantity paths (I4): `pnpm --filter @waitron/server exec vitest run --coverage --coverage.reporter=json --coverage.reportsDirectory=$HOME/waitron-campaign-c/a1208-compare/coverage-before`
      (outside the package, CLAUDE.md §4; concurrency by measured headroom). Record the uncovered lines
      inside `carveLines` (`working-order.ts:4545`), `splitUnitsWithinOrder` (`:4921`),
      `removeFromLine` (`:3089`) and `itemsDue` (`bill-payments.ts:830`).
- [ ] Ledger: `Status: in progress`, the counts, the reservation table, the dump path.

### Task 1: `registerPortions` writes in two statements (D6)

**Files:** Modify `apps/server/src/order-portions.ts:117-143`. Test `apps/server/src/order-portions.test.ts`.

**Interfaces:** `registerPortions(tx: Transaction, portions: readonly PortionRef[]): Promise<void>` —
unchanged signature and refusals.

- [ ] **Failing test** "A1208 registerPortions: five portions cost the statements one does" in
      `order-portions.test.ts`: spy on the database's prepared statements as
      `issuance-pass.test.ts:790-820` does, register 1 then 5 fresh portions, expect equal statement
      counts; keep the existing "already holds portion" refusal case green.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/order-portions.test.ts`; expect FAIL with
      counts 3 against 11 (one read, then two inserts per portion).
- [ ] Implement: one read (as now), skip portions already held, refuse a line holding another
      (as now), then one `insert(orderPortions).values([...])` and one
      `insert(workingLinePortions).values([...])`, each only when non-empty.
- [ ] Run the file, `src/order-portions.filing.test.ts`, `src/order-portions.lifecycle.test.ts`,
      `src/issuance-pass.test.ts`: PASS. Then `issuance-pass.test.ts` both ways: with the flip patch
      it now passes unedited (was 48 against 40).
- [ ] Commit `git commit -s -m "Record a round's portions in two writes, however many dishes it has"`.

### Task 2: `portionIdentities` (D3)

**Files:** Modify `apps/server/src/order-portions.ts`. Test `apps/server/src/order-portions.test.ts`.

**Interfaces:**
- Consumes: `expandPortionRows`'s result `{ rows, portions, requestOfRow }`.
- Produces: `portionIdentities(identities: readonly OrderLineIdentity[], requestRows: readonly Row[], expanded: { rows: readonly Row[]; portions: readonly PortionRef[] }): OrderLineIdentity[]` —
  same length and order as `identities`; row `i` keeps its fields and gains `lineIds` (its id first)
  and `portionIds` as D3 states.

- [ ] **Failing tests** (pure, no database): a dish ×2 with two different extras and one dish ×1 →
      dish row 1 `lineIds` = both portions' dish lines, `portionIds` = both portions; each extra row
      `lineIds` = that extra's copy under each portion, `portionIds` = the dish's portions; dish ×1
      lists itself and its portion; a measured dish lists its one measured portion.
- [ ] **Failing database test** "A1208 portionIdentities matches the stored readers": price the lines
      with `priceOrderLines` (`working-order.ts:601`), which returns `identities` beside `lineRows`,
      `portionable` and `lineContexts` (`:1080`; `priceTabRound` does not return identities,
      `:3029-3047`); expand, insert with `insertTabRound` and `registerPortions` (as
      `testing/portion-bill.ts:17-43` does), and expect `portionIdentities(...)` to `toEqual`
      `readStoredOrder(tx, id).identities`.
- [ ] First add `portionIdentities` as a stub that returns `identities` unchanged, so the red is an
      assertion. Run `pnpm --filter @waitron/server exec vitest run src/order-portions.test.ts`: FAIL
      with the expected `lineIds`/`portionIds` missing from the received identities.
- [ ] Implement in `order-portions.ts`: group `expanded.rows` by request (the k-th dish row of each
      request is portion k; its children in order are the request's extras in order).
- [ ] Run: PASS. Commit `git commit -s -m "Name the portions each priced counter row stands for"`.

### Task 3: Fixtures over the cap, and a raw delete, pass on both shapes (X, K)

**Files:** Modify `apps/server/src/till-sale-integrated.db.test.ts`, `till-api.receipt.test.ts`,
`till-api.sell-published.test.ts`, `bill-refunds.card.test.ts`; the changed-checks file.

- [ ] Run the four files both ways; record the failing names (expected 4 + 2 + 1 + 1, inventory).
- [ ] X: replace each single over-99 line with request lines of at most 99 of the same offer and
      extras (2001 coffees → twenty lines of 99 and one of 21; 1000 → ten of 99 and one of 10;
      250 ml of lemonade → 99, 99, 52 ml each with its lemon, which models three pours where the test
      meant one; the test is about the unit's Measure switch, so its comment says so; Q1). Every
      asserted amount stays (`"3001.50"`,
      `"1500.00"`, `"875.00"`). A check that pins the number of filed rows of such a sale, if one
      exists, is kind C on main's shape and must be read at red: stop if it changes.
- [ ] K: before the raw delete at `bill-refunds.card.test.ts:1896`, delete the line's binding
      (`deletePortionBindings` from `./order-portions.js`, a no-op on an unbound line).
- [ ] Both ways: all four files PASS plainly and with the flip patch. Record old → new per check.
- [ ] Commit `git commit -s -m "Tests that order more than 99 of a dish, or delete a line by hand, work with portions too"`.

### Task 4: A grouped counter order for the tests of the partial-quantity paths (B)

**Files:** Create `apps/server/src/testing/grouped-counter-order.ts`. Modify
`transfer-lines.test.ts`, `split-bill.test.ts`, `till-api.transfer.test.ts`,
`till-api.unroutable-dish.test.ts`, `working-order.test.ts` (the "a cancel's extras cascade" case at
`:6685`), and any other kind-B case Task 4's red run finds.

**Interfaces:** Produces `openGroupedCounterOrder(tx: Transaction, cfg: OriginConfig, id: string, lines: TabRoundLine[], placement?: Parameters<typeof createOpenOrder>[5]): Promise<{ orderNumber: number }>`
— `createOpenOrder(tx, cfg, id, [], null, placement)`, then `priceTabRound(tx, cfg, id, lines, "checked")`
and `insertTabRound` of its rows with no expansion (as `placeGrouped`,
`testing/adjustment-venue.ts:581`, does for party bills). Doc comment: "Grouped, as a counter order
written before portions; for the partial-quantity paths slice 1's D12 keeps."

- [ ] Run the five files both ways; list the kind-B failures (partial transfer, partial split,
      quantity guards, split dish). A failure that is a whole-line layout check is kind A: leave it
      for Task 6b.
- [ ] Point each kind-B case's bill at `openGroupedCounterOrder` (or, for a party tab, `placeGrouped`)
      with a one-line comment naming the path it guards. No assertion changes.
- [ ] A kind-B case in a money file (`bill-payments-api`, `bill-payments*`, `receipt-language`,
      `tender-refund-links`, `adjustments-*`, `receipt-adjustments`, `invoice-document`): do not move
      it; record it for the owner's list and treat it in Task 5 as T if a target change expresses it.
- [ ] Read the 14 green users of `testing/split-extras-venue.ts` (list above): for each case whose
      name or comment promises a line of several, a part of a line or a split of extras, either
      rename it to what it now tests (kind A, listed) or point it at `openGroupedCounterOrder`
      (kind B). Record each decision.
- [ ] Both ways: the moved cases PASS plainly and with the flip. Commit
      `git commit -s -m "Tests of part-line moves build a counter order of several directly"`.

### Task 5: Requests name the portions for today's line (T)

**Files:** Modify `bill-payments-api.test.ts`, `clock-behind-stop.records.test.ts`,
`receipt-language.test.ts`, `till-api.service-periods.test.ts`, `attendance-orders.test.ts`,
`working-order.test.ts` (held-order edit cases, e.g. `:2123-2153`).

**Interfaces:** Consumes `todayLine`, `todayLineNos` (`testing/adjustment-venue.ts:679, 790`).

- [ ] Run the files both ways; classify each failure as T (the request means "these dishes at this
      count" in the grouped shape) or A (it pins the stored shape after the action).
- [ ] T: express the same intent on both shapes. A held-order save names every portion of the row
      (D8's rule); "lower line n to q" on portions removes the last portions (a held-order save
      omitting them, or the cancel route where the test is about a cancel); "raise line n" raises
      the last portion. Assertions unchanged.
- [ ] A money-file T whose only expression would change an amount or verdict is C: stop.
- [ ] Both ways: T cases PASS. Commit `git commit -s -m "Tests name the dishes they edit the same way on one line or on portions"`.

### Task 6a-1: The counter writes portions (D1–D4)

**Files:** Modify `apps/server/src/working-order.ts:1700-1747` and `:5860` (and its comment
`:5851-5852`); tests `apps/server/src/order-portions.counter.test.ts` (new),
`order-portions.filing.test.ts`, `order-portions.lifecycle.test.ts`.

**Interfaces:** `createOpenOrder`'s signature and return type unchanged; its `identities` now carry
`lineIds`/`portionIds` (`portionIdentities`, Task 2); its `lineRows` are the expanded rows.

- [ ] **Failing tests** in `order-portions.counter.test.ts`, each through the real route or writer:
      (a) "A1208 a walk-up of 2 × burger with cheese stores two portions of one cohort, each with its
      own cheese, and files one row of 2 linked to both" — working lines, bindings, cohort, ordinals
      1 and 2, `sale_lines` rows `2000`/`2000` (dish, cheese) with literal gross, base and VAT, the
      ticket's VAT breakdown, two link rows each; (b) "A1208 the same dish on two request lines
      files two rows, as today"; (c) "A1208 a parked order's two portions pay as one row"
      (`parkOrder` then `payWorkingOrder`); (d) "A1208 a new line saved onto a parked order is
      portions" (`updateHeldOrder` fresh line ×3); (e) "A1208 a counter order moved to a table lets
      one burger leave with its cheese" (`parkOrder`, `moveBill` to a table, `splitPartyBill` naming
      one portion → new bill holds one burger and one cheese; no `tab.transfer_modifier_line`);
      (f) "A1208 100 of one dish in one walk-up line is refused before anything is written"
      (`tab.portions_too_many` with `limit: 99`; no `working_orders` row; the next order gets the
      number it would have); (g) "A1208 the ceiling refusal still comes first" (2001 coffees, no
      invoice choice → `sale.total_exceeds_simplified_limit`); (h) "A1208 `openTab` with lines
      writes portions".
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/order-portions.counter.test.ts`: FAIL
      (one working line of `2000`; no binding; no link).
- [ ] Implement D2–D4 in `createOpenOrder` and `applyLineEdits` (`:5860`); the field comment at
      `:5851-5852` drops "or a new line on a party bill" for "or any new line". No other product file.
- [ ] Run the new file: PASS.
- [ ] Reverse the two slice-1 counter cases (kind A): "a new line on a counter order stays one line"
      → "… is written as portions"; the lifecycle case → the counter order moved to a table splits
      one portion with its extras. PASS.
- [ ] Run H2: PASS unedited. Run `git diff --stat main -- packages/fiscal-verifactu packages/core packages/catalogue/src/pricing.ts`: empty.
- [ ] Run F: expect exactly probe 2's seven failures (the P cases, Task 6a-2), nothing else.
- [ ] Commit `git commit -s -m "Counter orders store each dish as its own portion, and file as before"`;
      the ledger records the known red list (the seven F cases and Task 6b's kind-A files): an
      unpushed, cleanly red point.

### Task 6a-2: The protected tests read portions, and prove they still catch the regression

**Files:** `apps/server/src/till-api.fiscal-sale-paths.test.ts`, `split-bill.fiscal.test.ts`,
`bill-payments.test.ts`; the changed-checks file.

- [ ] Rewrite the P cases and Mode T (Q2) as "Test-change inventory → protected rewrites" states;
      add the grouped sibling cases and the paid-plus-unpaid portion case listed there. Run F: PASS,
      and record its new `Tests` count with each added case named.
- [ ] **Mutation control 1** (scratch, never committed): in `createOpenOrder` return
      `grossLockedLines` of the *expanded* rows instead of the request's `gross`, with identities
      to match (one filed row per portion). Run F and `src/order-portions.counter.test.ts`. Expect
      the rewritten walk-up extras case (`:2817-2831` filed rows, `:2796-2799` VAT) and new case (a)
      to fail on filed lines or the VAT breakdown; record the failing assertions. If none fails, the
      rewrites do not guard the filing: stop and strengthen them. Revert (`git checkout --` the file).
- [ ] **Mutation control 2** (scratch): return `identities` without `lineIds`/`portionIds`. Expect
      the link checks in the rewritten walk-up case, the split-bill case and new case (a) to fail.
      Record; revert; `git status --short` shows only the intended test edits.
- [ ] Commit `git commit -s -m "Protected fiscal tests check the portion shape, as strictly as before"`.

### Task 6b: The stored-shape checks read portions (A)

**Files:** the kind-A files left red by Task 6a-1 (inventory rows marked A, 6b).

- [ ] For each failing check: confirm it reads working lines, ticket items, queue items, tab lines
      or held-order lines (not `sale_lines`, receipts, totals or registros); rewrite it to the
      portion shape, naming each portion's line and quantity rather than only a count. Record old →
      new.
- [ ] `kitchen-print.test.ts` `('pan','separate')`: before editing, run the same input on a table
      bill (`addPortionRound`) and record what slice 1 prints there; the counter must print the
      same. If tables print `2.000 ud x Pan`, this is a defect, not kind A: stop and decide.
- [ ] Whole server suite: PASS. Commit `git commit -s -m "Stored-line checks read a counter order's portions"`.
      About 60 checks in about 15 files: if the task nears 100 tool calls, commit the files done so
      far (still cleanly red on the rest), record the remainder in the ledger and hand over.

### Task 7a: The counter basket shows one row and saves its portions (D7, D8)

**Files:** Create `apps/till/src/state/counter-portion-rows.ts` and `.test.ts`. Modify
`apps/till/src/state/working-order.ts` (`OrderLine`), `apps/till/src/till-app.ts` (`#loadIntoBasket`,
`#syncIfDirty`, `#basketPayload`). Test `apps/till/src/till-app-boot-and-counter.test.ts`.

**Interfaces:**
- `OrderLine.portionLineIds?: string[]` — every member's stored dish line, by line number,
  `workingOrderLineId` first; absent on a line of one. Never sent.
- `foldRetrievedPortions(lines: readonly OrderLine[], listed: StoredLines | null, holdsMoney: boolean): OrderLine[]`
  — groups by `portionGroups(lines, keyOf, lineNoOf)` with `keyOf` = `tabLinePortionKey(listedDish,
  listed.lines)` for a line whose `workingOrderLineId` is listed, else null; a group of k becomes its
  first line with `quantity: String(k)` and `portionLineIds`. Identity when `listed === null` or
  `holdsMoney`.
- `portionWireLines(line: OrderLine, wire: SaleLine): SaleLine[]` — D8's rule; `[wire]` for a line
  without `portionLineIds`.

- [ ] **Failing pure tests** (`counter-portion-rows.test.ts`): three bound identical portions → one
      line of 3 with three ids in line order; a portion with another note, extras, state or price
      stays apart; an unbound line stays alone; `listed === null` and `holdsMoney` return the lines
      as given; `portionWireLines` at q = 3 → three lines of "1"; q = 5 → "1", "1", "3" with the third
      member's id; q = 1 → one line naming the first member; each wire line carries the row's extras,
      options, note and making station.
- [ ] **Failing app tests** in `till-app-boot-and-counter.test.ts` (stub `retrieveWorkingOrder` with
      three dish lines and `getTabLines` with three `portion: true` lines): the basket shows one
      "3 ×" row; pressing + then Park sends `updateWorkingOrder` lines `[{id1,"1"},{id2,"1"},{id3,"2"}]`;
      pressing − sends `[{id1,"1"},{id2,"1"}]`; a retrieved order the held list marks paid in part
      shows three rows; an unchanged retrieved row reports no unsaved change (`#basketPayload`);
      **dead ends (C1):** a retrieved 3 × caña row plus a new dish no station can make, then Pay —
      `askSaleDeadEnds` receives two lines (the row at `"3"`, the dish), the window lists the caña
      once, choosing a station for key `"1"` sets the new dish's `makeAt` and removing key `"1"`
      removes the new dish, never the caña.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/state/counter-portion-rows.test.ts src/till-app-boot-and-counter.test.ts`: FAIL.
- [ ] Implement: `#loadIntoBasket` passes its built lines through `foldRetrievedPortions(lines,
      listed, holdsMoney)` before `loadFrom` (`:8778`), where `holdsMoney` is
      `this.heldOrders.some((held) => held.id === order.id && paidInPart(held))` (`paidInPart` from
      `state/bill-state.js`, as `#basketPaidInPart` uses it at `:6696-6705`; that getter reads the
      store's current id, which is not yet the loaded order's). Placed counter orders load through the
      same method (`#loadPlacedCounterOrder`, `:8809-8821`), so they fold too. `#currentSaleLines`
      stays one wire line per row. `#syncIfDirty` takes the rows its caller captured (each caller
      already snapshots `[...this.#store.lines]` beside its lines, e.g. `:6383-6384`; place captures
      at `:7387`) and sends `rows.flatMap((row, i) => portionWireLines(row, wire[i]))` to
      `updateWorkingOrder`. `#basketPayload` includes `portionLineIds`.
- [ ] Run: PASS. Run the counter suites unchanged: `src/till-app-counter-adjustments.test.ts
      src/till-app-counter-move-station.test.ts src/till-app-counter-cancel-credit.test.ts
      src/till-app-kitchen-note.test.ts src/till-app-late-send.test.ts src/widgets/basket.test.ts`
      (no counter test stubs `portion: true` today: `rg -ln 'portion: true' apps/till/src --glob '*.test.ts'`
      lists table-screen and state files only, so these are expected to pass unedited).
- [ ] Commit `git commit -s -m "The counter shows a retrieved order's identical dishes as one row"`.

### Task 7b: A save that keeps the basket re-reads its portions (D12)

**Files:** Modify `apps/till/src/state/working-order.ts` (new method), `apps/till/src/till-app.ts`
(`#syncIfDirty`). Tests `apps/till/src/state/working-order.test.ts`,
`apps/till/src/till-app-boot-and-counter.test.ts`, `apps/till/src/till-app-bill-payments.test.ts`.

**Interfaces:** `WorkingOrderStore.adoptSaved(lines: OrderLine[], revision: number): void` — replaces
the lines and revision, clears `dirty`, keeps `persisted`, the id and `loadGeneration`; emits
`"changed"`.

- [ ] **Failing store test:** `adoptSaved` keeps `loadGeneration` and `persisted`, clears `dirty`,
      replaces the lines.
- [ ] **Failing app tests:** (1) a retrieved row of 3, + to 4, a card pay whose save succeeds and whose
      charge is declined, then + and Park → `updateWorkingOrder`'s second call names the 4 stored
      portions (the stub's re-read answers four) with the last at `"2"`; (2) the same through the
      counter's bill Pay (`#onCounterBillPay`): Pay items list four rows after the save; (3) the
      re-read fails → the basket is held with `held.reread_failed` and the next Park sends nothing;
      (4) a save of rows with no folded row and no new row makes no re-read (`retrieveWorkingOrder`
      called once).
- [ ] Run the three files: FAIL.
- [ ] Implement D12 in `#syncIfDirty`: after `markSaved`, when the saved rows held a folded row or a
      row with no `workingOrderLineId`, read `retrieveWorkingOrder(id)` and `getTabLines(id)`, build
      the lines as `#loadIntoBasket` does (extract its line-building into a helper both call), fold,
      `adoptSaved`, set `counterLines`, `#commitBasket(this.#basketPayload())`.
- [ ] Run: PASS; then the counter suites listed in Task 7a: PASS (a case that expects a second save
      to resend lines is read at red and listed).
- [ ] Commit `git commit -s -m "After a save the counter re-reads which dishes the order holds"`.

### Task 8: Row actions and the cap on the counter (D5, D9)

**Files:** Modify `apps/till/src/widgets/basket.ts` (`#lineActions`, `#extraActions`, `#lineStationMove`). Tests
`apps/till/src/till-app-counter-adjustments.test.ts`, `till-app-counter-move-station.test.ts`,
`till-app-boot-and-counter.test.ts`.

- [ ] **Failing tests:** on a retrieved grouped row of 3, Comp opens the dialog with the row target
      (`lineIds` = the three ids, quantity "3") and sends `lineIds`; Void likewise through
      `cancelItem`; Move station sends `lineIds`; **Comp and Void on the row's cheese** open with the
      extras target (`lineIds` = the three cheeses, quantity their sum) and send it. A row of one
      sends `lineId` alone, as today.
- [ ] Run the two counter files: FAIL (target names one line).
- [ ] Implement: when the line has `portionLineIds`, `#lineActions` builds `rowAdjustTarget(members,
      listing.lines, name)` from the listed members, `#extraActions` takes the matching entry of its
      `extras` (paired by `extraOrder`, `adjust-target.ts:146-150`), and `#lineStationMove` adds
      `lineIds`.
- [ ] Cap tests (`it.each(["en-GB","es-ES"])`): a walk-up cash pay (`recordSale` rejecting
      `{code:"tab.portions_too_many", status:400, limit:99}`), a card pay and a park (`parkOrder`
      rejecting) each show `codeMessage("tab.portions_too_many", locale)`. These pass on arrival
      (D5's receipts); prove each by deleting the code from `ACTIONABLE_REFUSALS` and seeing it
      fail with the generic sale or park error, then restore.
- [ ] Run the three files: PASS. Commit `git commit -s -m "Counter row actions take every dish in the row; the 99 limit is explained at the counter"`.

### Task 9: Guides, design system and backlog

**Files:** `apps/server/src/guide/en/table-service.md` (`{#portions}`, `:174-190`), `es/table-service.md`
(`:181-199`), `en/kitchen-service.md` (`{#identical-dishes}`, `:169-176`), `es/kitchen-service.md`
(`:193-200`); `docs/developers/design-system.md:5645-5660`; `docs/backlog.md`, `docs/backlog/till.md`.

- [ ] Guides: delete the counter paragraph ("An order taken at the counter keeps 2 × Burger as one
      line …", EN `:189-190`, ES twin); say the section holds at the counter too and that a retrieved
      counter order shows one row; "On a table's bill you can add up to 99 …" → at a table or the
      counter; kitchen "A table's order of 2 × Burger" → "An order of 2 × Burger, from a table or the
      counter,". Spanish as a proposal for the owner (D22). Keep each `{#id}`.
- [ ] Run G: PASS.
- [ ] Design system: the "Identical portions share one row" section opens "An order, at a table or
      the counter, stores each dish …" (`:5647`), names the counter basket (`counter-portion-rows.ts`)
      among the screens, and drops "(a counter order's)" (`:5657-5658`).
- [ ] Stale comments (D10): every match of `rg -n 'counter order moved to a table keeps' apps/server/src`
      (38 in 12 files when planned) and the `billWith` doc comment (`testing/adjustment-venue.ts:541-543`)
      say instead what the grouped fixture stands for now: an order written before portions. Prefer
      the shortest true wording; `node scripts/comments-only.mjs <base>` on this commit shows it
      changed comments only. `rg` then finds none.
- [ ] Backlog: delete A1190 (`docs/backlog.md:1985-1988`) and its detail (`docs/backlog/till.md:2701-2712`),
      **except** its separate leftover — "the counter also kept two separate adds of the same dish
      with extras as two lines of one, where a table's draft merges them" (`docs/backlog/till.md:2709-2711`)
      — which becomes its own short entry under the same area, numbered from
      `~/waitron-campaign-shared/next-item-number` (read, use, write back). A1191 says it now
      reaches the counter's Pay items too (`till-app.ts:7684`, `:17382`). A803's "A1190–A1202" →
      "A1191–A1202" (`:1968`) plus the new entry's number; A1196 drops "grouped counter lines" and
      "A1190 and" (`:2010-2013`). `rg -n 'A1190'` outside `docs/superpowers/` then finds nothing.
- [ ] Commit `git commit -s -m "Guides and backlog: counter orders keep each dish as its own portion"`.

### Task 10: Fiscal before/after comparison

- [ ] Copy the dump test into `apps/server/src/`, run it on the branch with
      `A1208_DUMP=~/waitron-campaign-c/a1208-compare/after.json`, delete the copy.
- [ ] `diff <(jq -S 'del(.scenarios["8"])' before.json) <(jq -S 'del(.scenarios["8"])' after.json)`:
      expect no output. A failing comparison prints each differing field as a `diff` pair, for example
      `<       "base": "2.48",` / `>       "base": "2.47",` under a sale's line, or a refund value
      `<     "refund": { "quantity": "1", "gross": "3.00" }` / `>     "refund": null` for scenario 11
      or 12. Any such line is kind C: stop. Scenario 8 is the one expected difference (main moves the
      whole line; the branch moves one burger): compare its two bills' rows with the hand-computed
      split instead, and state it in the PR. Prediction, to be measured not assumed: scenario 11's
      refund value matches, because slice 1 D32 gives each discounted portion a whole-cent price and
      the filed rows split by portion in whole cents (`cancellation-refund-value.ts:144` refuses only
      a share that is not whole cents).
- [ ] Control: change one scenario's quantity in a scratch copy on one side only and confirm the diff
      is non-empty; restore.
- [ ] Coverage after: the same command as Task 0's, into `coverage-after`. Every line inside
      `carveLines`, `splitUnitsWithinOrder`, `removeFromLine` and `itemsDue` that was covered before
      and is not now needs a grouped-order test (Task 4's fixture) before the PR; list each.
- [ ] Run F (expect Task 0's count plus the cases Task 6a-2 added — two grouped siblings and the
      paid-plus-unpaid portion case — each named, all passing) and H2 unedited; run
      `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/migrations-match-schema.test.ts`
      (expect unchanged: no schema change).
- [ ] Record before/after counts and the diff result in the ledger and the changed-checks file.

### Task 11: LOOK

- [ ] `wa-wt demo waitron-feat-a1208-counter-portions`. Check `lsof` on the venue folder and port
      8080 before any `wa-wt reset`.
- [ ] Screenshots, both themes, 390 and 1280 px, en and es, to `~/waitron-campaign-c/a1208-shots/`:
      a walk-up of 2 × burger with cheese and its receipt (one row of 2); park 3 × caña, Parked
      orders → retrieve → one "3 × Caña" row; + to 4 and park, retrieve again → one row of 4; Comp on
      the row offers a count; move the parked order to a table, Split by item one burger with its
      cheese; the station ticket and kitchen screen show "2 ×"; 100 × caña at the counter shows the
      99 message; the dead-end window on a retrieved grouped order beside a new dish no station makes
      (the caña listed once); Comp on the cheese of a 2 × burger row (offers the row's cheeses);
      counter Pay items on a part-paid counter order (one row per portion, Q5); the dashboard's order
      detail for a counter sale (one row of 2).
- [ ] Record what each shot shows in the ledger; a mismatch with this plan is a finding, not a
      caption.

### Task 12: PR text and park

- [ ] PR body (plain English): what changed; "No venue reset"; "No migration"; **Changed test
      checks** from `~/waitron-campaign-c/a1208-changed-checks.md`, every P with before/after first,
      then A, T, B, K, X by file; the F/H2 before/after counts and Task 10's diff result; the owner
      questions Q1–Q5 with their defaults.
- [ ] Ledger `Status: done` for the build; queue item parked `needs-owner-review`.

## Owner questions (each with the default the plan builds)

- **Q1 — the 99 cap at the counter.** Today a walk-up of 150 × caña in one line sells; after this
  change it is refused with "At most 99 of one dish can be added at a time. Lower it to 99, then add
  the rest." On the counter "add the rest" means a second sale, or parking and adding to the
  retrieved order (the basket merges a second add into the first line, `mergeTarget`,
  `apps/till/src/state/working-order.ts:173-183`, so a second line in one basket is not possible).
  **Units count too.** What splits is decided by the dish's unit (`takesExtras`,
  `working-order.ts:485-487`, read at `:961`): a unit with no hardware scale, no decimals and the
  Measure switch off splits one line per unit. A millilitre or gram unit that has not been switched to
  Measure therefore splits per millilitre at the counter, as it already does at a table: 90 ml of
  lemonade is 90 stored lines and 250 ml is refused (`till-api.sell-published.test.ts:670-700` sells
  250 of such a unit before its Measure switch is published). **Default: keep 99 at the counter as at
  tables, and leave the unit rule as slice 1 made it**; a venue selling by the millilitre switches the
  unit to Measure, which makes each pour one measured portion. Alternatives: a higher counter limit
  (each portion is a stored row); the till starting a new line past 99, which files two rows where
  today files one and can move a cent of VAT, so it needs its own fiscal comparison (measured at
  Task 3's review: the 1000-coffee walk-up in `till-api.receipt.test.ts`, sent as eleven lines of at
  most 99, files 11 rows where one line filed 1, and its VAT is 260.30 on a base of 1239.70 where one
  line filed 260.33 on 1239.67; the total, 1500.00, is the same — so any venue that splits a big
  order by hand under the cap files that way too); or treating
  any unit with an abbreviation like `ml`/`g` as measured, which is a catalogue rule change beyond
  this item.
- **Q2 — a fourth check in the protected file.** `till-api.fiscal-sale-paths.test.ts`' Mode T case
  pins the station queue's one item of 2; it becomes two items of 1. Its fiscal checks are unchanged.
  **Default: change it as listed.**
- **Q3 — kitchen paper in "one per portion" mode.** A counter order's 2 × bread whose unit prints
  ("ud") printed `2.000 ud x Pan` in the `separate` mode; on portions it prints the line twice, as a
  table's does if Task 6b confirms it. **Default: match tables.**
- **Q4 — the guides' Spanish** (slice 1 D22): shipped only with approval at land.
- **Q5 — counter Pay items lists one row per portion.** A part-paid counter order of 12 cañas shows
  12 rows in Pay items (`payLines`, `apps/till/src/state/bill-payment.ts:345-360`, fed from
  `till-app.ts:7684` and `:17382`), as tables have since slice 1. Grouping it waits for A739 to release
  the payment files (backlog A1191). **Default: accept until then**, and say so in A1191.
