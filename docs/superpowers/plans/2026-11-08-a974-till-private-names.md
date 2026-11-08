# A974: Till private English names implementation plan

**Goal:** English private test names across all `apps/till/src` subfolders, unchanged behavior, **one implementation PR within three hours**, excluding watcher waits.

**Approval:** Sources: owner request (2026-11-08), Lane J queue A974, watcher 00:02/11:07/13:51 and `~/waitron-campaign-j/RUNNER.md` section 0. Owner request: “The owner authorises finish-branch and land-branch.” Watcher13:51: “write the one-page plan for your next English-cleanup slice: one whole area” and “Send it through PLAN FOR APPROVAL as usual.” **This plan is unapproved:** driver commits with sign-off, obtains Claude `review-branch` (one read, at most one correction re-read), submits `PLAN FOR APPROVAL` with report/rejected findings, then waits for watcher approval before building.

**Inventory:** Base `5c6a642d5bf2a2a2b4341e02c9fce8c9cbec911d`; read-only TypeScript parsing inspected 596 test/support files, 7,814 identifier spellings and local symbol references. **Production code: 0 lines; tests: 823 identifier lines plus 5 comment-reference lines, 853 identifier occurrences, 51 bindings, 39 old spellings, 17 files.** At about 15.6 times +53, the whole area exceeds the suggested 5–10 times; `openMesa` alone has 285 occurrences. No padding. Locations/hashes: `~/waitron-campaign-j/receipts/a974-till-private-20261108/inventory-reviewed.json`. Selected references had no existing name collisions or shorthand/property-name uses; recheck after rebase.

**Files/mappings:** Relative to `apps/till/src/`; `old:new` renames bindings/references; parentheses count distinct affected lines.

- `till-app.test.ts` (377): `cafe:coffee`, `jamon:ham`, `ringCafe:ringCoffee`, `listedCafe:listedCoffee`, `vinoHeld:heldWineProduct`, `vinoLive:liveWineProduct`, `heldVino:heldWineOrder`, `puntoList:donenessList`, `frozenPunto:frozenDoneness`, `bocadillo:sandwich`, `cerveza:beer`, `mesa9:table9`, `mesa7:table7`.
- `till-app-parties.test.ts` (288): `openMesa:openPartyTable`, `seatedMesa9:seatedTable9`.
- `till-app-boot-and-counter.test.ts` (60): `cafe:coffee`, `tostada:toast` (both bindings), `counterWithCafe:counterWithCoffee`, `cafeOffer:coffeeOffer`.
- `till-app-kitchen-note.test.ts` (7): `canaPrice:draughtBeerPrice`, `canaQuantity:draughtBeerQuantity` (both parameter pairs).
- `till-app-handheld-pay.test.ts` (2): `cana:draughtBeer`.
- `till-app-bill-payments.test.ts` (2): `cana:draughtBeer`.
- `till-app-counter-adjustments.test.ts` (2): `jamon:ham`.
- `till-app-table-service.test.ts` (3): `terraza:terrace`.
- `state/split-selection.test.ts` (9): `cañas:fourBeerLines`, `noCañas:withoutBeerLines`.
- `state/portion-selection.test.ts` (13): `croquetas:croquettes` (both bindings), `croqueta:croquette`, `pan:breadRow` (array destructuring), `olivas:oliveRow`.
- `state/working-order.test.ts` (9): `cortado:smallCoffee`, `banquete:banquet`.
- `screens/till-table-order-screen.test.ts` (27): `ringCafe:ringCoffee`, `bocadillo:sandwich`, `veganCerveza:veganBeer` (both bindings).
- `widgets/menu-browser.test.ts` (5): `cortado:smallCoffee`.
- `widgets/station-queue.test.ts` (5): `moscatel:muscatWine`, `tartaBeside:cakeBeside`.
- `widgets/station-queue.a11y.test.ts` (2): `moscatel:muscatWine`.
- `i18n/strings.test.ts` (4): `aplaza:snoozeTermEntries`, `retenido:heldTermEntries`.
- `i18n/help-strings.test.ts` (8): `tiqueWord:ticketWord`, `saysTique:saysTicket`, `saysRetenido:saysHeld`, `saysDel:saysCounterOrder`.

**Exclusions:** Freeze strings/template text, regexes, comments except the five named references below, property keys, fixture/assertion values, descriptions, production code, fiscal data and shared wire shapes; keep accent-search inputs. Assertion references alone may change. Exclude bindings needing changed shorthand semantics or string-key access. Retain shared imports `mesa/paella/chuleton/ensalada` from outside-area `apps/till/test/bill-pay-app.ts`, and string-selected `croquetas` in `widgets/finish-table-dialog.test.ts:71`. Keep proper names and culinary loanwords (including paella, tapas, flan and espresso). Update only stale comment binding references: `till-app.test.ts:7183,8167,15452` cafe→coffee, `:7228` puntoList→donenessList; `till-app-kitchen-note.test.ts:103` canaPrice→draughtBeerPrice. Freeze the rest of each comment. Do not claim everything remaining is English. No new helpers, committed checks, tables, protocols, functionality or permanent audit script.

**Execute inline after approval** with `superpowers:executing-plans`; maintenance preserving behavior, not a feature test rewrite:

- [ ] Revalidate inventory. Before baseline and final runs, inspect `memory_pressure | grep free` and `ps -axo pid,ppid,etime,rss,args`; Chromium requires well above 15% free beside another session, never whole-workspace coverage. Sequentially run each listed file: `node scripts/run-with-deadline.mjs 1200 --diagnostics -- pnpm --filter @waitron/till exec vitest run src/<listed-path> --maxWorkers=1`. Retain logs/statuses and real **Tests** counts for all 17 suites, without name filters. Escalate out-of-scope failures; do not repair them.
- [ ] Rename inventoried declarations/references without shadowing/collisions. For **every changed test**, save the raw rename before formatting; reverse only approved identifier/comment spans and recover baseline bytes exactly. Run Prettier on that raw result; require its output to equal the final file. Compare parsed assertion structure and literal/property values with approved identifier nodes normalised. This permits formatting, not other edits; retain both raw and formatted receipts. Wrap-only growth is within scope, counted separately against the 1.5-times size limit. Keep temporary receipts outside the checkout. If one file cannot qualify, exclude it with its reason, retaining the rest.
- [ ] Update **`docs/backlog.md`** and both A974 paragraphs in **`docs/backlog/architecture.md`**: remove completed sites only; retain shared/property names, comments, fixture text/A976, file names, server/fiscal work and unrelated entries. Repeat all 17 commands after edits, matching Tests counts; run `pnpm --filter @waitron/till typecheck` and `pnpm --filter @waitron/till lint` and `pnpm format:check`. No whole-workspace test.
- [ ] Target 20/35/35/60 minutes for baseline, renames/inverse, final checks and finishing, with 30 minutes contingency (estimates). Run `finish-branch`: initial rebase, Claude run-it whole-branch review in its temporary checkout, signed commits, normal pre-push and required current-head CI. Fix caused/planned defects only; escalate scope/size changes and use RUNNER's over-budget checkpoint at three hours. Land under **H11's owned lock** via `land-branch`, complete cleanup, and record/read exact-merge CI under H12.

**Finish line:** Inventoried private names across the whole till area are English with unchanged behavior/assertions; both backlogs retain residual work; one implementation PR passes review/gates before authorised landing. This plan adds no build work; implementation and tests have not run.
