# Backlog — what is in flight, what is next, and why

**Last reprioritised 2026-08-15; tidied 2026-08-16.** This file is the answer to "what should I work on?". It is
committed rather than held in a session's memory so that it can be diffed, reviewed, and checked
against the tree — memory notes drift, and several currently point at pull request numbers that no
longer exist (the repository was recreated for the licence change and numbering restarted at #1).

Two companion documents, deliberately not duplicated here:

- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal and administrative track:
  certificates, company formation, the declaración responsable. **The deli must be filing by
  1 January 2027.**
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects. That table is the strategy and does not change often.
  This file is the current state and changes constantly.

**Docs land direct to `main` (2026-08-02):** the `main protection` ruleset grants the Repository-admin
role a bypass (mode "always"), so a docs-only change can be pushed straight to `main` — no PR, no CI
wait. Branch, `commit -s`, fast-forward `main`, push. Reserve it for docs; feature/code still goes
through a PR (where CI + Copilot run). The other rules (no force-push, no deletion) still apply.

## Current direction

**Nothing in flight (2026-08-16).** The last active work — the two parallel tracks #83 (shift-planning
authoring) and #84 (sync transport) plus their follow-ons — has landed. Where things stand:

- **The fiscal sequence is complete** (settlement #39, rectificativas #46, F3 canje #51,
  invoice-first #55) and the **SIF topology is settled** (#33, `node_id` re-key #54). The unrepairable
  fiscal core — hash-chained records, never-reused invoice numbers — is done.
- **The Counter POS is operable end to end** — walk-up cash #60, park/retrieve #61, manual card #62,
  prepare & collect #63, integrated Stripe #64, layout/receipt editors #81.
- **The management dashboard slice-1 auth floor is COMPLETE** (identity #67 → passkeys #71) with staff
  admin, catalogue authoring #78, and the staff self-service portal #92.
- **An autonomous campaign** ran 2026-08-09 → 14 while the owner was away, landing #74–#82 (plus
  #72/#73) off a pre-specced queue; its plan and guardrails are in
  [superpowers/specs/2026-08-08-autonomous-campaign-plan.md](superpowers/specs/2026-08-08-autonomous-campaign-plan.md).
- **Since:** recipes/BOM allergen inheritance #89, the workforce request/approval halves #87/#90, the
  sync fast lane #85, purchase invoices + modelo 303 deducible #91, and the purchase-invoice authoring
  UI #93.

**Prioritisation is by soundness, not the calendar** (decided 2026-08-02): Waitron will be finished
before the deli must trade, so the 1-Jan-2027 deadline is not a reason to rank one piece above
another — order by dependency, correctness, and de-risking the most-reused / most-uncertain
foundations first. **Never autonomously land anything touching the unrepairable fiscal core (H2).**

**Next candidates** are the owner's call — detailed under *Not started*, *Debt and odd jobs*, and *SIF
topology follow-ups*. The largest unbuilt threads: **recipes/BOM's next slices** (nested sub-recipes,
plate costing, stock depletion — the linchpin; the recipe-authoring UI landed as #94), the **reporting** remainder
(rectificativas, prorrata, intra-community/import boxes; quarterly/annual periods + the DR303 download route landed as #98), the **sync
transport-2** pieces (cloud-mirror peer, dead-subscriber cleanup, multi-tenant transport, node-token
rotation) and the separate **fiscal-lane / hash-chain sync (H2)**, and the greenfield **inventory /
procurement** (sub-project 20) downstream of recipes.

---

## Recently shipped

One line per landed PR, newest first. The git log, the linked designs/plans, and the
[architecture design](superpowers/specs/2026-07-18-pos-architecture-design.md) §2 table hold the
detail — **this file is not a history** (see *How to keep this file honest*). Open follow-ups from
these live under *Debt and odd jobs*; their designs/plans stay in `docs/superpowers/`.

- **#126** CI — shard the CPU-bound test **jobs** across more free 4-vCPU runners (follow-on to the shared-container rollout #112–#123, which made each real-PG *package* fast; this splits the *jobs*). The suites are v8-coverage CPU-bound, so a shard's floor is **total-work ÷ the runner's 4 cores**, not its biggest package — the lever is more free runners (two give 8 cores for $0; larger runners are billed even on a public repo). Built and **measured iteratively**, each step its own CI run: **(1) apps/server → `test-server`** (multi-fork) — it was **341.7s of test-light's 358s**; on a dedicated runner it drops `singleFork`, safe because apps/server is **TERMINAL** in the workspace graph (so `pnpm -r` runs it alone) and the only `--no-sort` shards (the two light ones) exclude it — it never runs multi-fork under contention (single- vs multi-fork branch coverage measured **identical, 98.9%**); **341s → 150s**. **(2) test-light → `test-light-a`/`test-light-b`** — two duration-balanced bins (`LIGHT_A_PACKAGES`/`LIGHT_B_PACKAGES` in `scripts/changed-scope.mjs`), each subtracting its bin's **complement** (own-shards ∪ the other bin) so the subtraction **intersects** with PR scope where an include list would union; **391s → 158s/151s**. **(3) fiscal-verifactu → `test-fiscal-verifactu`** + rebalance — it's a `maxForks:4` suite (like db & apps/server) that oversubscribed its bin-mates (219s inside test-light-a's 270s); isolating it evened the shards; **128s**. **Net ~414s → ~306s overall (~26%)**; the critical-path JOB moved from test-light (383s) to **`test-heavy` (db, 275s)** — the light-shard bottleneck is gone (next lever under *Debt*). Six single-package own-shards + two balanced bins; `scripts/ci-workflow.test.mjs`'s real-`pnpm ls` partition test proves all shards cover every test package **exactly once**. finish-branch simplify (a `lightGate` factory, a stale "six of the seven"→"eight of the ten" count, a missing test-coverage row) + two reviewers found **no correctness bugs** but caught **§1 claim overclaims** — a false "*the only* maxForks:4 suite" (three carry it, incl. the apps/server one this branch created) and a false "single-fork apart from core" (seven light packages multi-fork) — all corrected, and apps/server's multi-fork receipt re-grounded on the grep-checkable terminal-graph argument rather than the isolated run. CLAUDE.md §2 shard descriptions updated (§7). One `test-dashboard` Chromium flake (unrelated code, re-run green); local Docker-VM contention flaked two full-workspace pre-pushes (payments passed isolated in 16s; final pushes ran the hook clean). **Copilot did not post** (not auto-configured; the two reviewers covered that lens). **CI wiring only, non-fiscal (H2 clean).** [PR #126]
- **#115** CI — shard the weekly `mutation-db` job so it fits GitHub's 6h limit (resolves the *Debt* → *mutation-db* item, now removed): Stryker over `@waitron/db` had **never** completed — the 5-min dry-run timeout, then (after #114's `dryRunTimeoutMinutes: 20` + `ignoreStatic: true`) **~10h at the 6h wall** for 749 db-backed mutants on one 2-vCPU runner. Mutation cost is mutants ÷ concurrency, so the fix is **parallelism**: `scripts/mutation-shard.mjs` (TDD'd) bin-packs the source files into one `--mutate` slice per matrix job (`strategy.job-total` fixes N in one place). **N=10** from data — an N=6 dispatch ran 53min→4h50 because widely-covered core-table schema mutants (`orders`/`tenants`/`sales`, `global-setup`) are far pricier than leaf-file ones; N=10 isolates each in its own shard (confirmed on run 32384997149: all 10 green, nine ≤90min). The lone outlier `schema/sales.ts` (**186min**, the most-covered fiscal table) is split with Stryker's **mutation-range** syntax (`file.ts:start-end`) into 3 ranges spread across 3 distinct shards (`HEAVY_FILES` + a rename guard). **The split run 32416530799 is its own receipt: all 10 shards green, max 129min** (2.8× under the wall) — a real improvement on the pre-split 186min, but NOT the ~90min first projected and NOT clean isolation: heavy-weighting the sales ranges pushed the *other* expensive files into fewer shards, clustering `daily-closes`+`orders`+`global-setup` into the 129min shard, and the line-based sales split is uneven (`sales:1-120` 64min vs `121-359` ~123min, cost ≠ line count). A per-file COST weight (not byte size) that isolates every expensive file, and a cost-aware sales split, would cut it toward ~90min — a possible follow-up; 129min is comfortable as-is. (The earlier "splitting only lowers the max" reasoning was wrong: the split redistributes every file, so it needed its own receipt, which is 32416530799.) Also: eslint now ignores `.stryker-tmp` (a killed mutation run's `@ts-nocheck`'d sandbox otherwise breaks `pnpm lint`, mirroring vitest's exclude). `assignShards`/`splitRanges`/CLI all TDD'd (balance, partition, contiguous ranges, 3-distinct-shards, bad/empty-input guards). **Copilot**: 2 findings (CLI + workflow empty-slice guards), fixed + resolved on-thread. Landed in a clean window after re-rebasing past the shared-container rollout. **No migration, non-fiscal (H2 clean).**
- **#124** Table service **TS-4** — transfer items (sub-project 10, #119 fast-follow): move SELECTED items between two open tabs — whole-line or **partial-quantity split** — reusing TS-3's `moveTabLines` subset primitive, **no new schema**. `transferLines(tx, cfg, fromTabId, toTabId, transfers)` with `transfers: { lineNo, quantity? }[]`; whole-line (or `quantity == line.quantity`, no zero remnant) delegates to `moveTabLines`, **partial** SPLITS (reduce source, insert destination inheriting every per-unit value — **never re-fetched from the catalogue**). New codes `tab.transfer_self`/`tab.transfer_quantity_invalid`/`tab.transfer_duplicate_line` (all 400); `POST /api/tabs/:id/transfer`. **Invariants proven, not asserted:** quantity conserved (exact decimal `subtractDecimal`), never re-priced (catalogue price change between ring and transfer changes neither line — mutation-proven), `line_total` byte-consistent with an add-time line (`grossLineTotal` == the `priceRows` gross composition, both `numeric(12,2)`), weighed (decimal-qty) lines split identically. **Fiscal (H2):** pre-fiscal, core untouched; each tab files its own one sale on pay (real-PG one-`registro`-per-tab). **Concurrency:** locks `working_orders` ONLY (`lockOpenTab`; ascending-id `[from,to].sort()`) → not in the mergeTabs-vs-pay lock class; transfer-vs-transfer serialisation proven by a real-PG `.sort()`-deletion control. **The finish-branch two-reviewer phase earned its keep again**: BOTH reviewers independently **reproduced a duplicate-`line_no` quantity-invention bug** the whole SDD chain (7 tasks + whole-branch review) missed — a batch naming one line twice inflated the destination (two `quantity:"1"` on a line of 3 → 4 items), breaking conservation; **fixed** with an up-front duplicate-`line_no` guard (`tab.transfer_duplicate_line`) + conservation tests proven by deletion. Subagent-driven TDD (7 tasks + 1 fix round + whole-branch review + simplify + the finish-branch fix); **Copilot did not post** within the window (best-effort; the two finish-branch reviewers already gave deeper coverage). 827 tests, coverage 99.65/98.9/99.05/99.65; rebased clean, squash-merged in a CLEAN window (the shared-container rollout completed, so `main` stopped racing). Deferred follow-ups under *Debt* → table service TS-4. [spec](superpowers/specs/2026-08-17-table-service-ts4-transfer-items-design.md) · [plan](superpowers/plans/2026-08-17-table-service-ts4-transfer-items.md).
- **#119** Table service **TS-3** — move / join / merge (sub-project 10, #103 fast-follow): the three party verbs on TS-1's `dining_tables.tab_id` back-pointer + existing `working_order_lines`, **no new schema/migration**. **`moveTab`** (relocate a tab to a free table — source freed + its manual status cleared; the target is turned over too, so its `status_id` clears, **openTab parity — owner decision 2026-08-20**), **`joinTable`** (extend coverage to a free table; both tables point at one tab; no line-move; status kept), **`mergeTabs`** (combine two tabs onto one bill; `freeSourceTable` frees the source (2+2 consolidate) or keeps it joined (4+4)), all over the shared **`moveTabLines`** subset-capable primitive (**TS-4 transfer reuses it**). New codes `table.occupied` (409) / `tab.merge_self` (400); `POST /api/tabs/:id/{move,join,merge}` (session-gated, UUID-screened). **Fiscal safety (H2):** core byte-unchanged (no `recordSale`/alta/`registros` edit); a merged-then-paid tab files **exactly one** sale + registro, the abandoned source none (real-PG `registroCount`=1/0, `filedSaleTotal`=3.50 — a line-drop would leave 1.50). Subagent-driven TDD (7 tasks + whole-branch review + fix waves), every guard / lock / the re-point-before-abandon ordering **proven by deletion**. **finish-branch caught the one that mattered**: a fresh-context wide-lens reviewer **container-proved a deadlock** the whole SDD chain missed — `mergeTabs` locked `dining_tables`→`working_orders`, the inverse of the pay/settle/abandon path, so `mergeTabs(into=X)` racing `payWorkingOrder(X)` → **40P01** → opaque 500 aborting a sale (§5); **fixed** by reordering `mergeTabs` to `working_orders`→`dining_tables` (a clean two-phase order, structurally deadlock-free), guarded by a real-PG merge-vs-pay race (proven by deletion). Also fixed in review: a `moveTabLines` self-transfer data-loss footgun (`fromTabId===toTabId` guard), stale `orders.ts:NN` citations → symbols, a cross-tenant merge test (FORCE RLS). Simplify extracted `assertTabOpen`/`assertTableAvailable`/`freeTablesCoveredBy`. **Copilot:** 1 finding (the `tab.merge_self` docstring undercounted its throwers after the self-transfer guard — generalised, resolved). 799 tests, coverage 99.64/98.87/99.04/99.64; **rebased onto `main` (`c43a0fe`) at land, clean (apps/server-only, zero overlap with the shared-container rollout)**, squash-merged. Deferred follow-ups under *Debt* → table service TS-3. [spec](superpowers/specs/2026-08-17-table-service-ts3-move-and-merge-design.md) · [plan](superpowers/plans/2026-08-17-table-service-ts3-move-and-merge.md).
- **#123** CI test-tier speedup, **phase 9 (FINAL BATCH of 7) — rollout COMPLETE** — converts the last 7 small real-PG packages onto the shared-container harness in one PR: **scheduler** (`core_scheduler`, role `scheduler_rls_probe`, singleFork), **recipes** (`core`, ONE `rls_probe` **shared** by both suites, multi-fork), **catalogue** (`core`, `rls_probe`, multi-fork), **credentials** (`core_credentials`, `credentials_rls_probe`, singleFork), **purchasing** (`core`, `rls_probe`, multi-fork), **layouts** (`core_identity`, **NO roles**/`asAppUser`, multi-fork, inlined its migrate so nothing deleted, kept `startManagementSession`, **NO PGlite suites** so its hookTimeout comment is a harmless ceiling not a WASM claim), **workforce-es** (`core_identity_workforce_es` — the full `[CORE,IDENTITY,WORKFORCE,WORKFORCE_ES]` stack, `convenio_es_rls_probe`, singleFork). Multi-fork packages get **no `maxForks`** (1-2 light real-PG files, anchored on pre-existing main history per §2). All 7 green (scheduler 9/87 99.53/97.16/100/99.53; rest 100/100/100/100); prove-by-deletion for every role incl. recipes' shared `rls_probe` failing BOTH files. finish-branch simplify (2 nits fixed — workforce-es key renamed `core_workforce_es`→`core_identity_workforce_es` for sibling consistency; a recipes comment trim) + two reviewers (**no correctness defect**). **This COMPLETES the shared-container conversion of every real-PG package.** **Test wiring only.** [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#122** CI test-tier speedup, **phase 8 (BATCH of 3)** — converts **`@waitron/reporting`**, **`@waitron/payments-stripe`** and **`@waitron/core`** onto the shared-container harness in one PR (small-package batching, user OK'd). **reporting**: `core` template ([CORE]), **NO roles** (its 4 RLS suites use `asAppUser`/SET ROLE, not a probe LOGIN role), keeps `singleFork` — 20 files/188, 100/100/100/100. **payments-stripe**: `core_payments` template ([CORE, PAYMENTS]), 4 probe roles (`rls_probe_device/hosted/reconcile` + `rls_probe`), keeps `singleFork` (undocumented since #22 → comment asserts only the connection-budget consequence, no v8 reason) — 18/101, 99.4/97.93/100/99.4. **core**: `core_identity` template ([CORE, IDENTITY]), **NO roles** (asAppUser; settle-sale opens 2 `pg.connect()` backends), **STAYS MULTI-FORK, no `maxForks`** — core had no `poolOptions` before (already multi-fork on main), only 3 real-PG files, worst-case ~8 backends « 100 — 9/142, 100/99.38/100/100. **Reusable lesson: `asAppUser`-based RLS suites need no cluster roles** (SET ROLE uses the CORE `app_user` group role, copied by CREATE DATABASE … TEMPLATE). finish-branch simplify + two reviewers (one quantified core's multi-fork connection budget) — **no correctness defect**; fixed reporting's stale coverage-exclude comment + reporting/payments-stripe's stale "container cold pull" timeout parenthetical (the boot moved to globalSetup, which vitest does NOT bound by hookTimeout — verified empirically), and anchored core's multi-fork justification on its pre-existing main history (§2). **Test wiring only.** [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#121** CI test-tier speedup, **phase 7** — converts **`@waitron/identity`**'s 5 real-PG suites (4 RLS + 1 concurrency) onto the shared-container harness: one **`core_identity`** template (`[CORE, IDENTITY]`; same key apps/server uses for its own CORE+IDENTITY template — not a collision, handles are per-package scoped) + **4 distinct RLS probe roles** (`identity_webauthn_probe`, `identity_rls_probe`, `identity_sessions_probe`, `identity_mgmt_sessions_probe`, each `inRole app_user`). **Keeps `singleFork`** — but the comment now records the **measured** truth: identity does NOT reproduce the coverage-v8 branch-merge artifact (100/100/100/100 under both fork modes), so singleFork isn't demonstrably load-bearing here — kept as a conservative, near-free guard (identity is `test-light`, not the CI critical path). identity **has** 6 PGlite suites, so its `hookTimeout` comment truthfully covers their WASM boot (the sync §1 lesson applied — the subagent grepped before asserting). Full suite **18 files / 138 tests**, coverage 100/100/100/100; `passkey.concurrency`'s `55P03` lock race stays genuine; roles proven load-bearing by deletion (with a green control suite). finish-branch simplify (4 clean) + two reviewers (one ran the suites end-to-end) — **no correctness defect**; two minor §1 nits on the singleFork note (unmeasured "essentially free" + a slight over-generalization) tightened. **Landed BEHIND** — a concurrent docs commit for the parallel #119 table-service track advanced main during CI, so the branch was rebased + force-pushed before merge (no identity overlap). **Test wiring only.** [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#120** CI test-tier speedup, **phase 6** — converts **`@waitron/sync`**'s 7 real-PG "gate" suites onto the shared-container harness: one **`manifest`** template (the FULL manifest via the bare `runMigrationSets(migrationOptionsFor(manifestSets(), null))` path — NOT apps/server's advisory-locked `applyMigrations`; sync's existing bare path preserved) + the **5-role union** the gate suites' per-file `setup`/`probeRole` created, now once/idempotently: `app_login` (`inRole app_user`), `sync_applier` (`inRole ["app_user","sync_tailer"]` — array reproduces `in role app_user` + `grant sync_tailer`), `sync_reader`/`tailer_login` (`inRole sync_tailer`), `sync_pruner` (`inRole sync_retention`). **Keeps `singleFork`** (coverage-v8), so no `maxForks`. Full suite **12 files / 119 tests**, coverage 100/100/100/100; **role-membership equivalence verified empirically on PostgreSQL 18.6** (`sync_applier`'s create+grant is byte-identical in `pg_auth_members` to the `inRole` array); roles proven load-bearing by deletion. finish-branch simplify + two reviewers (one ran the suites + verified memberships on a real container) — **most-caught phase so far**: all 4 review agents converged on `capture.gate` still hand-rolling `tailer_login` inline (a redundant `create` + a **destructive `DROP` on the now-shared cluster role**) → converted to use the globalSetup role like `retention.gate`; the diff-focused reviewer caught 3 §1 comment claims copied from payments/db that are FALSE for sync (it has **no PGlite suites**) → reworded. **No correctness defect. Test wiring only.** [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#118** CI test-tier speedup, **phase 5** — converts **`@waitron/workforce`**'s 7 real-PG suites (RLS + concurrency + immutability) onto the shared-container harness: one **`core_identity_workforce`** template (`[CORE, IDENTITY, WORKFORCE]` — IDENTITY is a genuine FK dependency, workforce FKs target identity's `persons`) + **3 non-superuser probe roles** created once/idempotently (`workforce_planning_rls_probe`; `workforce_clock_probe`, which drives the `clocking.concurrency` TOCTOU suite — non-superuser there proves the app role is *permitted* its `FOR NO KEY UPDATE` lock, not that FORCE RLS applies; and `workforce_rls_probe` **shared by `scheduling.rls` + `rls`**). **Keeps `singleFork`** (reason-(a) coverage-v8, same finding as payments/scheduler/credentials) — no `maxForks` even with concurrency suites, since one file runs at a time. Full suite **23 files / 312 tests**, coverage 99.89/99.43/100/99.89; concurrency backends verified distinct (20/2/6 `pg_backend_pid`s), `immutability.test.ts` REVOKE/append-only/TRUNCATE/FORCE-RLS assertions all pass; roles **proven load-bearing by deletion** (control suite stays green). finish-branch simplify (4 clean) + two reviewers (**no correctness defect**; one ran the suites end-to-end, the other caught a §1 comment over-generalization — "RLS probe roles" mislabelled the concurrency-suite role — fixed) + **Copilot** (one §1 catch — the timeout comment still said the boot was "paid in a beforeAll" after it moved to globalSetup; reworded, resolved). **Fiscal-adjacent (registro de jornada) but TEST WIRING ONLY** — no product/migration/grant change. [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#117** CI test-tier speedup, **phase 4** — converts **`@waitron/fiscal-verifactu`**'s 11 real-PG suites (RLS + concurrency + e2e) onto the shared-container harness: one **`core_fiscal`** template (`[CORE, FISCAL]`) + **4 RLS probe roles** created once/idempotently — `reconcile_rls_probe`, `acks_rls_probe`, `drain_probe`, and **`rls_probe` SHARED by 3 suites** (rectificativa-columns/pending-count/canje-columns, the apps/server `rls_probe` pattern, created once + `connectAs`'d by all three). **`maxForks: 4`** — the reason-(b) **connection-budget** lever (like #114 db, the second package to use it), NOT `singleFork`/coverage-v8 which this package dilutes below the gate: its 2 heavy concurrency suites each open `WRITERS=20` pools that eager-probe a backend each (`client.ts:118`) + admin fan-out, conservative peak ~70-80 under the ~97 effective budget (100 − `superuser_reserved_connections`), load-bearing proof empirical (the unfiltered `main` run). The PGlite `inmutabilidad.test.ts` FORCE-RLS guard stays untouched and **verified green** (it now needs Docker, like every file, since globalSetup precedes every worker). `registro-sif.ts` had one stale doc-comment receipt corrected (comment only). Full suite **33 files / 264 tests**, coverage 99.71/96.83/100/99.71; concurrency backends stay distinct (20-writer hash-chain races genuine); roles **proven load-bearing by deletion** (removing the shared `rls_probe` fails all 3 of its suites). finish-branch simplify (4 agents — reuse/simplification clean; efficiency+altitude sharpened the `maxForks` peak comment ~45→~68→~70-80, applied) + two reviewers (**no correctness defect** — distinct backends / role wiring / template parity / `inmutabilidad` / **fiscal invariants untouched** all verified) + **Copilot** (no findings). **Fiscal package but TEST WIRING ONLY** — no change to fiscal logic, migrations, `registros_facturacion`, or hash chains (H2: no fiscal behaviour change). [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#116** CI test-tier speedup, **phase 3** — converts **`@waitron/payments`**'s 8 real-PG suites (3 RLS + 5 concurrency) off per-file containers onto the shared-container harness: a package `globalSetup` migrates one **`core_payments`** template (`[CORE, PAYMENTS]`) and creates the 3 RLS probe roles (`rls_probe`/`rls_probe_policy`/`reconcile_rls_probe`, each `inRole app_user`) once/idempotently, in place of the per-file `probeRole`; each suite clones via `useTemplateDb({ template: "core_payments" })` (~26ms vs ~1.5s boot+migrate). **Keeps `singleFork`** — the `@vitest/coverage-v8` branch-merge reason (reason (a): store.ts 100%→83.78% multi-fork), NOT the connection budget; the consequence is one file runs at a time, so the shared cluster's 100-conn budget needs no `maxForks` cap (unlike #114's db, which is the reason-(b) reference). Establishes the **`core_<schema>` template-key convention** (matches apps/server's `core_identity`, self-describing about what's migrated) for the ~13 remaining rollout packages. Full suite **27 files / 371 tests**, coverage 99.9/99/100/99.9; concurrency backends stay distinct (`cloneTemplate`'s fresh-`Pool`-per-`connect()`), the 3 roles **proven load-bearing by deletion** (removing one fails its RLS suite with `password authentication failed`). finish-branch simplify (4 agents — reuse/efficiency clean; 2 comment-dedup + the naming convention applied) + two reviewers (**no correctness defect** — isolation / distinct-backend / role wiring / template+migration parity / clone lifecycle / Docker broadening all verified) + **Copilot** (one §1 over-claim — the docblock over-cited §4 for "every machine has Docker"; rewritten to lead with the verifiable reason — the RLS/concurrency suites need Docker regardless — and cite §4 only for the local Docker/RYUK requirement it records; resolved). **Docker now required for the whole package** (globalSetup precedes every worker), like db/apps-server; `testing/postgres.ts` (`startRealPostgres`) deleted, no other importers; all 8 real-PG files convert (no special cases). **No migration, non-fiscal (H2 clean).** [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#114** CI test-tier speedup, **phase 2** — converts **`@waitron/db`** (the biggest remaining real-PG shard) off per-file/per-test containers. The linchpin: **`describeEachTarget`** (16 files) booted a container PER SUITE and migrated CORE PER TEST — it now reads the shared container a new package `globalSetup` provides and clones a pre-migrated `core` template per test (~26ms vs ~387ms), tracking clones and dropping them in `teardown()`; the **12 `useRealPostgres` suites** → `useTemplateDb({ template: "core" })`, their 3 provisioner roles moved to the globalSetup. **`cloneTemplate` exported** from lifecycle.ts and reused by `describeEachTarget` (the fresh-DB-per-test need one clone-per-file `useTemplateDb` can't express — the reuse the #113 review predicted), now **validating its identifiers at its own §3 choke point** (exported ⇒ two callers, so safety is a property of the code not the callers) with two guard tests. A single **`nextCloneName()`** owns the clone-name counter for both helpers (two per-module counters would collide if a file mixed them). **`maxForks: 4`** (bounded multi-fork), NOT `singleFork`: this shard runs alone and passed coverage multi-fork, so not the coverage-v8 reason — it's the shared cluster's one 100-connection budget vs the contention suites' ~20/~10/~10 backends; a cap of 4 keeps worst-case ~46-50 (no `max_connections` change), matches CI's 2-4 vCPU count, and recovers most of the 2.65x the efficiency reviewer **measured** `singleFork` was costing (137s→50s local). `useRealPostgres` gains a direct home-file test (the converted suites no longer cover it; it stays a live export for the not-yet-converted packages). **Docker is now required for the whole package** (like apps/server — its RLS/provisioner suites needed it regardless; `resolveTargets`' degrade-to-PGlite stays a pure, unit-tested function). Special cases stay per-container/PGlite by design: `client`/`migrate`/`testing/postgres` (container+migrator primitives) and `provisioner-role.migration` (PGlite, needs a clean cluster). Full suite **39 files / 533 tests**, coverage 100/98.7/100/100; **test-heavy 4m30s on CI** (from the plan's ~357s baseline). finish-branch simplify (4 agents) + two reviewers (**no correctness defect** — connection math / clone-name collision / clone lifecycle / role parity / TEMPLATE parity all verified) + **Copilot** (robust `allSettled` teardown + a `nextCloneName` doc fix; both resolved). **Also carries the `mutation-db` stryker fix** (`ignoreStatic` + `dryRunTimeoutMinutes`) — see *Recently shipped* → #115 (the sharded job that made it complete). **No migration, non-fiscal (H2 clean).** [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#113** CI test-tier speedup, **phase 1b** — converts the **9 remaining `apps/server` real-PG suites** #112 left on per-file containers to the shared-container harness: the `manifest` template for `boot` / `pass` / `till-api` / `till-sale-integrated` / `webhook` / `sync-api` / `sync-e2e`, a `core` (CORE-only) template for `clear-table-status`, and a `core_identity` (CORE+IDENTITY) template for `service-statuses` — each ~1.5–2.4s per-file boot+migrate → a ~26ms clone. The shared model grew two things, both **generalising an existing mechanism rather than adding a special case**: (1) **`ProbeRole.inRole` widened to `string | readonly string[]`** (emits `in role a, b`, the syntax already used in `provisioner-role.rls.test.ts`) so `sync_applier`'s dual `app_user`+`sync_tailer` membership is a plain `roles` entry — a `setup`-hook escape hatch was first built + TDD'd, then **deleted** in favour of this by the finish-branch simplify pass; (2) apps/server's `globalSetup` migrates all three templates + creates the **8 cluster roles once/idempotently**, in place of the per-file `probeRole`/`setup` role creation that would collide on one shared cluster. `sync-e2e`'s two databases both come from `useTemplateDb` (a second clone), not a hand-rolled create+migrate+drop. Full apps/server suite **57 files / 762 tests**, coverage 99.66/98.88/99/99.66 (unchanged); pre-push ran `test:coverage` across **21 of 27 packages** (`@waitron/db` + dependents) green, so the `ProbeRole` widening breaks no consumer. Two finish-branch reviewers (**no correctness defect** — LIFO teardown safety + all six shared-cluster hazards verified) + **Copilot** (no findings); the reviewers caught 3 stale comments (§1 class), fixed. `dev-setup` (bare) + the raw-container primitive tests stay per-container by design. **Keeps `singleFork`.** **No migration, non-fiscal (H2 clean).** Remaining rollout (P2..Pn) under *Debt* → CI test-tier. [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#111** CI — drop `--with-deps` from the Playwright browser shards (resolves the former *Debt* → *CI Playwright apt slowness* item): `test-ui`, `test-till`, `test-dashboard` (+ `mutation.yml`'s weekly `@waitron/ui` job) restored the `~/.cache/ms-playwright` browser-binary cache then ran `playwright install --with-deps chromium` — the cache covers the binary but never the OS libraries `--with-deps` apt-installs on the clean-VM-per-run, so that apt step ran **every** run. It was the shard long pole (12–17s cache-warm, up to **601s** tail on run 32277880914) and it **hung twice landing #110**; the browser download itself is untouched. Dropped to plain `playwright install chromium`: `ubuntu-latest` already ships Chromium's libs, so it's a **~1s** binary check on a cache hit / a download on a miss and **no apt at all**. **Proven, not asserted** — a `.github/` change resolves to global scope, so run 32357687333 (the rebased head that landed) ran all three browser shards, each **launched Chromium and passed** with the flag gone, install step **1s** each (from 12–13s); `mutation.yml` proven the same way on dispatch run 32304224136 (install 1s, `mutation` job green). Rejected `--with-deps`-on-cache-miss (browser cache and VM apt state are independent → a missing lib still breaks every cache-*hit* run, and would pass on the version-bump PR that misses the cache then fail everything after it), caching the apt layer, and `--only-shell` (changes the browser binary the suites run against). Step comments carry the receipt + the restore path if a future image/Playwright bump drops a lib. **Copilot**: no findings. **No migration, non-fiscal (H2 clean).** Surfaced a pre-existing `mutation-db` failure — see *Recently shipped* → #115.
- **#112** CI test-tier speedup, **phase 1** — shared-container + template-DB clone harness: every real-PG test *file* booted its own container + migrated it (measured 2026-08-19 on `postgres:18-alpine`: **1118ms boot + 387ms migration ≈ 1.5s/file**, ~130 files), which is why `test-light` — dominated by **apps/server at 458s** — is CI's critical path and `packages/db` is ~406s; a `CREATE DATABASE … TEMPLATE` clone is **~26ms**. New `@waitron/db` harness: `startSharedContainer` (a package vitest `globalSetup` boots ONE container, migrates a named template per migration-set, creates cluster roles once/idempotently, optional `dockerRequired` message) + `useTemplateDb` (per-suite clone, same `{pg, admin}` shape as `useRealPostgres`, force-drops the clone) + a **vitest-free** `identifiers.ts` (so a globalSetup importing the harness doesn't transitively pull `vitest`, which throws at globalSetup module-load — found the hard way). apps/server gets a globalSetup migrating a `manifest` template + **14 of 24** real-PG suites (manifest + `asAppUser`-only) converted; **apps/server 458s → 424s on CI** (~34s from 14 files; ~2.4s/file on CI vs ~1.1s local — proof the lever works, the bulk is still ahead). **Keeps `singleFork`** (see *Debt* → CI test-tier: it is load-bearing, not stale). TDD, guards by deletion; two finish-branch reviewers (no correctness defect — isolation / GUC-leak / clone-collision / teardown / TEMPLATE-precondition / vitest-free-graph all verified) + **Copilot** (`resolveSharedHandle` now throws an actionable unwired-globalSetup error) all resolved. **No migration, non-fiscal (H2 clean).** Remaining rollout under *Debt* → CI test-tier. [plan](superpowers/plans/2026-08-19-shared-test-container.md).
- **#110** Counter POS 7a — server-unreachable boot as a banner, not an unhandled rejection (campaign pool **P8**): `till-app.ts`'s `#boot` (fired `void this.#boot()` from `firstUpdated`) `await`ed `this.api.getTill()` with **no** `try/catch`, so a server unreachable at start-up escaped as an **unhandled promise rejection** and the till just sat on the lock screen with no explanation. `#boot`'s body is now wrapped in a `catch` surfacing a new `boot.error` banner — mirroring the `errorKey` pattern every other handler uses (`#onConfirmPayment`, `#onCollectCard`, `#onPlaceOrder`, …), the lock screen still rendered beneath it; copy honest that recovery is a **page reload** ("Could not reach the till, reload to try again" / es "No se pudo conectar con la caja, recarga para reintentar"), because `#boot` runs once from `firstUpdated` and there is no in-UI retry (unlike the retryable action errors that say "try again"). TDD in **real headless Chromium** (Playwright, so `unhandledrejection` fires reliably and `rejections === []` is a genuine assertion), proven by deletion (remove the try/catch → the banner is gone *and* the rejection escapes → the test fails on both counts); mirrors the sibling `listStaff`-degradation test. `getTill()` reads the till's *public* config and files nothing — no `computeHuella` / hash-chain / invoice-number / `registros_facturacion` contact. `till-app.ts` 100%; full till suite 447 pass. **No migration, non-fiscal (H2 clean).** Rebased onto current `main` (`3175cb7`) at land time (clean; main's 3 intervening commits don't touch `apps/till`), CI green on the rebased head (the `test-till` Playwright shard's `--with-deps` apt step hung twice → cancelled + re-run; passed on attempt 3 — now fixed, see *Recently shipped* → #111). **Copilot** broadened the boot-failure comment + copy to also cover a non-2xx `{ code }` error (`getTill` can reject with a server-side code, not only "unreachable"), both threads resolved. One deferred follow-up recorded (owner design call) — see *Debt* → Counter POS 7a.
- **#109** Counter POS 7b — node-scope the by-id held-order lookups (campaign pool **P7**): `getHeldOrder` / `updateHeldOrder` / `abandonHeldOrder` filtered a held order by id + status only — RLS confined them to the tenant but NOT the node, so a same-tenant order parked on **another node** could be retrieved/edited/abandoned by id (only `listHeldOrders` was node-scoped). All three now carry `eq(workingOrders.nodeId, cfg.nodeId)` in their WHERE / FOR-UPDATE / conditional-UPDATE predicate, matching the held list; a foreign-node id fails closed (`working_order.not_found` for get, `working_order.not_open` for update/abandon), the same shape an absent id gets. Node scope keys on `node_id`, not `till_id`, so **cross-till retrieval on the same node** (the held-order sharing model) is unaffected — verified against the existing cross-till end-to-end test. TDD: 3 PGlite deletion-proofs (without the filter each function *acts on* the foreign-node order) + 1 real-PG RLS test (same state, opposite answers, no side effect). The §1 receipt-retirement extended past the three docstrings to `updateHeldOrder`'s opening enumeration, the `errors.ts` `working_order.not_found`/`not_open` registry notes (the brittle "all three" count dropped), and the three `/api/working-orders/:id` route comments. **No migration, no fiscal-core change (H2 clean)**; both finish-branch reviewers + **Copilot** (5/5 files): no findings. Wide-lens review surfaced a deferred follow-up — the fiscal-filing by-id paths still lock by id alone (see *Debt* → Counter POS 7b).
- **#106** Dashboard — reconcile native `<select>` value in `updated()` (campaign pool **P2**): the login-screen roster picker and the person-form create-person role picker bound `.value` in the Lit template, which on a native `<select>` commits **before** the `<option>` children exist — a preset that is not the first option falls back to the first. Both rendered right today only because their default equals the first option (login `roster[0]`, create `"staff"`), the latent picker bug #73 already fixed in the edit dialog. Both now hold a `createRef<HTMLSelectElement>()` and reconcile its live `.value` to state in `updated()` (template binding `${ref(...)}`, not `.value=`); the selects are rendered **unconditionally** so the ref is always populated → reconciled branchlessly via `this.#x.value!.value = state` (the `recipe-editor.ts` non-null-assert idiom; no dead branch, both files 100% cov). TDD, both new tests proven by deletion **under Chromium** (a non-first preset — `manager`/`p3` — falls back to the first option without the reconcile); 19 pre-existing tests preserved. **No migration, non-fiscal (H2 clean)**; both finish-branch reviewers + Copilot: no findings. **Sibling follow-up recorded** (both reviewers flagged, out of P2's scope) — see *Debt* → dashboard minors.
- **#103** Table service **TS-2** — configurable service statuses (sub-project 10, #97 fast-follow): layers a venue-configured **manual** status (e.g. "Bill requested", "Needs cleaning") on top of TS-1's derived occupancy. **Schema (migrations 0047–0050):** a tenant-scoped `table_service_statuses` config table (FORCE RLS + policy + SELECT/INSERT/UPDATE grants, **no DELETE** — statuses *deactivate*), a nullable `dining_tables.status_id` composite FK, and a **reset-on-turnover trigger** on `working_orders`. **Verbs (`apps/server`):** config CRUD (`createStatus`/`listStatuses`/`updateStatus`/`deactivateStatus`, gated on the existing #81 `till.configure`/`authorizeManager` — **no new permission**) + a `validateStatusColor` helper; `setTableStatus` (operator-session-gated); the status folded into `listTablesWithState` as a LEFT JOIN. **Reset-on-turnover:** an AFTER-UPDATE trigger clears `status_id` on every table a settling/abandoning tab covered (keyed on TS-1's `tab_id` back-pointer) + an `openTab` status-clear — both **non-fiscal**. Dashboard config editor (happy-dom + axe a11y); till `POST /api/tables/:id/status` + four `/management-api/service-statuses` routes. **Fiscal safety (H2):** the fiscal core is byte-unchanged (`payWorkingOrder`/`recordSale`/`computeHuella`/alta untouched — the reset is a *trigger*, not a pay-path edit; no migration touches a fiscal table; the reset sets `status_id = NULL`, same-tenant / RLS-permitted / FK-safe; there is no other trigger on `dining_tables`, so it cannot roll back a settle), and the `inmutabilidad` guard stays green. Subagent-driven TDD (8 tasks + whole-branch review + fix wave + the full finish-branch: a `simplify` pass — 3 DRY helpers, `setTableStatus` 3→2 round trips — and wide/narrow reviews, which added the trigger `WHEN` broadening + a `parseDisplayOrder` type check); every guard/trigger/RLS proof by deletion. **Rebased onto `main` (`decf9fc`) at land time** — 14 commits, zero conflicts (git auto-merged the 4 overlapping `apps/server/src` files across distinct regions), re-verified: workspace typecheck + db/server/dashboard `test:coverage` + fiscal `inmutabilidad` all green, both merge intents (#109 node-scoping, this branch's status-clear) present. **Copilot** (all threads resolved): a `parseDisplayOrder` int4-range gap **fixed** (`09a6cac`); a null-body→500 on the status route and a hex-only colour picker **deferred**. Four deferred follow-ups + a TS-3 cross-slice caveat under *Debt* → table service TS-2. [spec](superpowers/specs/2026-08-17-table-service-ts2-configurable-statuses-design.md) · [plan](superpowers/plans/2026-08-17-table-service-ts2-configurable-statuses.md).
- **#101** Counter POS 7b — park idempotency (#9) + re-hold routing (P6): a re-sent `POST /api/working-orders` (a lost-response retry with the same client-minted id) PK-collided on `working_orders.id` → a raw `23505` that `till-api.ts`'s `run` catch turned into an opaque 500, even though the first park committed. `parkOrder` now catches the unique violation (`isUniqueViolation`) and **replays** the existing OPEN order's `{ id, orderNumber }` in a fresh transaction — mirroring `payWorkingOrder`'s 23505 backstop, filing and inserting nothing; a colliding id whose row is no longer `open` (abandoned/settled/placed) re-throws the raw 23505 unchanged. Making park idempotent introduced a **client** regression the two finish-branch reviewers both caught: `#onParkOrder` re-parked a RETRIEVED order unconditionally, so `retrieve → edit → re-hold` flipped from a loud `held.park_error` into a SILENT edit-discard-with-false-success. So the pending **P6** item is folded in here — `#onParkOrder` now mirrors `#onPlaceOrder`/`#onConfirmPayment`: a persisted (retrieved) order re-syncs via the tested `#syncIfDirty` (`updateWorkingOrder`, saving the edit; no-op if unedited), only a fresh walk-up parks. A **third** bug surfaced by this branch's own P6 review: the Hold field opens blank, so a persisted re-hold would send `label: undefined` and the server's `label ?? null` would WIPE the retrieved order's name — fixed with a `label ?? this.#store.label` fallback + a guard test. TDD throughout, every new test proven by deletion: server PGlite (sequential replay, differing-basket replay, not-open re-throw), server real-PG (**concurrent** double-park → one order, both replay the same number), till (retrieve→edit→Hold re-syncs, unedited no-op, blank-label preserved, update-failure → `held.park_error` basket intact). `working-order.ts` 100/99.21/100/100, `till-api.ts` + `till-app.ts` 100%. **No migration, no fiscal-core change (H2 clean)**; **Copilot** reviewed all 7 files with no comments. One MINOR deferred (see *Debt* → Counter POS 7b): a Hold of an order settled/placed on another till clears with no banner (the `not_open` swallow).
- **#100** Local dev run stack (developer experience): `wa-wt` (the worktree dev-server switcher) ran `pnpm dev`, but there was no root `dev` script and the server can't boot without a real Postgres + migrations + a provisioned fiscal venue — so no worktree could actually run the app. Adds `docker-compose.yml` (throwaway `postgres:18-alpine`, mounted at `/var/lib/postgresql` — the `/data` path makes PG18 `exit(1)`), an idempotent `dev-setup.ts` (migrate → provision one **preproduction** venue + SIF → seed catalogue + cashier PIN 5555 / admin 1234 → write a gitignored `apps/server/.env`), a `dev-server.mjs` launcher (assembles `WAITRON_MIGRATIONS_DIR` for the from-source boot, `tsx watch`), and root/server `dev` / `dev:setup` / `dev:reset` scripts (till :5190, dashboard :5191, server :8080). **Fiscal safety (§5):** re-registering a till starts a new hash chain, so `dev-setup` provisions **only** into a database that holds no venue — it reuses when the `.env` names a tenant the DB still holds and **refuses** (fail loud → `pnpm dev:reset`) when the DB holds a venue the `.env` can't account for (a lost/stale `.env` against a live volume); both reuse and refusal proven by deletion against real Postgres. TDD, coverage thresholds met, run live end-to-end (`/health` 200, seeded roster, reuse, refuse, reset). **No migration, non-fiscal (H2 clean).** Landed **out of number order** — opened before #101–#109, rebased onto current `main` (`d05efe4`) at land time (clean, zero file overlap with the 16 intervening commits; `apps/server` 52 files / 725 tests green post-rebase). **Copilot**: one finding (a claimed `string !== undefined` TS2367 that would break `pnpm --filter @waitron/server typecheck`) verified a **false positive** — that exact command passes on the code, a `--strict` repro compiles, and the `!== undefined` teardown guard is the repo's *required* pattern (`scripts/guarded-teardowns.test.ts`, same shape as `deployment-guard.test.ts`'s `let db: Database` + `if (db !== undefined) await db.close()`); replied with the receipts + resolved. Two follow-ups deferred (see *Debt* → local dev run stack). [spec](superpowers/specs/2026-08-18-local-dev-run-stack-design.md).
- **#99** Counter POS 7b — malformed working-order id → 4xx across the till surface: a client-supplied working-order id reaching a `uuid` column raised `22P02` → an opaque `server.internal` 500. All six remaining till working-order-id entry points now screen it at the HTTP boundary: `GET`/`PUT`/`DELETE /api/working-orders/:id` via the existing `requireUuidId` (its code union widened with `working_order.not_found` so a malformed retrieve id is the same 404 an absent order gets; edit/abandon stay `working_order.not_open` 409), and the `POST /api/sales` `workingOrderId` + `POST /api/pay` `id` + `POST /api/working-orders` (park) `id` **body** ids via the reused shared `requireUuidParam` → `shared.invalid_id` 400 (`kind: "WorkingOrderId"`). `/api/pay` and park were **not** in the original 7b bullet — the finish-branch altitude + fresh-context reviews surfaced them as un-screened siblings with the identical malformed-id→500 exposure (pay via `payWorkingOrderIntegrated`'s lock read, park via `createOpenOrder`'s PK INSERT), screened too rather than ship a divergent partial fix. Park's malformed-id screen is orthogonal to the still-open 23505 re-park idempotency follow-up (that is a *valid* id colliding; this is a *malformed* one refused before the INSERT). `request-screens.ts`'s module + function docs corrected (the code split is branded-id-vs-generic-field, not by position; `catalogue-api.ts` keeps its own local copy). TDD: six malformed-id tests, each shown an opaque 500 in RED then screened (the `/api/pay` one via a stub provider so the id genuinely reaches the lock-read `22P02`). **No migration, no fiscal-core change (H2 clean)**; `till-api.ts` 100% covered. **Copilot** caught a braces-style inconsistency + a doc over-claim (that the shared screens are adopted by *every* surface — `catalogue-api.ts` is not), both fixed.
- **#98** Reporting — modelo 303 DR303 download route + quarterly/annual periods (sub-project 8): generalised the liquidation period from month-only to a `LiquidationPeriod` union (month/quarter/year) threaded through `computeVatReturn`/`computeInputVat`/`mapModelo303`/`toDr303Record` — a quarter/year is the exact `addDecimal`-sum of its constituent months (exactness inherited, never re-rounded; proven by a "Q2 == Apr+May+Jun" property test with difference-method cuotas and by deletion of the quarter bound) — plus a new authenticated `GET /management-api/reports/modelo-303?year&period&declarationType` route returning the ISO-8859-1 DR303 file (2944 bytes, attachment, `no-store`), a faithful `purchasing-api.ts` gate clone (`withTenant`+`asAppUser`+`authorizeManager`), gated on a **new `report.export` permission** (manager+admin). Annual is **refused at two layers** (the request screen + `toDr303Record`) — there is no annual modelo 303 file (annual = modelo 390). Read-only over the filed record: **no migration, no fiscal-core write (H2 clean)**, isolation double-guarded (explicit `tenant_id` predicate + RLS, proven by deletion in a real-PG differential). The whole-branch review caught a `requireYear` leading-zero year (`0999`) → 500, fixed to a clean 400 screen; **Copilot** caught two fail-fast gaps (exhaustive `LiquidationPeriod` switch guards; a 2dp guard on the DR303 test oracle). Owner-review flags (spec §7) still open: the `report.export` seam, the `declarationType` allowed set, the no-annual-file decision, and the two #91 pre-filing caveats. [spec](superpowers/specs/2026-08-16-reporting-modelo303-download-and-periods-design.md) · [plan](superpowers/plans/2026-08-16-reporting-modelo303-download-and-periods.md).
- **#94** Dashboard — recipe-authoring UI (sub-project 18, #89 fast-follow): a `recipe.manage`-gated ingredient CRUD + product-recipe get/set surface (`mountRecipeApi`) over #89's `@waitron/recipes`, a dashboard recipe screen (ingredient list/form + product-recipe editor), `manual_allergens` exposed on the catalogue product read, and the product-form allergen picker reseeded from the **manual overlay** so recipe-derived allergens are never double-counted; no migration. The finish-branch two-lens review caught a **sync-origin gap** — a recipe write transitively UPDATEs the sync-enrolled `products` table (via `applyRecipeDerivation`), but `mountRecipeApi` threaded no `nodeId`, so those writes captured the all-zero origin; fixed to thread `cfg.nodeId` like `catalogue-api`, the false "nothing to attribute" comment corrected with a receipt, guarded in `sync-origin.rls.test.ts` by deletion — plus a malformed-`ingredientId` → opaque-500 screened to a 400. **Copilot** caught a recipe-editor **loading-window data-loss** path (a Save during an in-flight `getProductRecipe` cleared the recipe) + a stale-load overwrite — both fixed with a `recipeLoading` gate + a superseded-load guard (proven by deletion) — and `egg`→`eggs` fixture codes. Owner-review flags (spec §8) still open: the `recipe.manage` name, manager-only authoring, allergen-state copy. [spec](superpowers/specs/2026-08-16-recipe-authoring-ui-design.md) · [plan](superpowers/plans/2026-08-16-recipe-authoring-ui.md).
- **#93** Dashboard — purchase-invoice authoring UI (sub-project 8, #91 fast-follow): a `purchase.manage`-gated create/edit/list surface (header + VAT-desglose sub-editor) over #91's `@waitron/purchasing`; no migration; rebased onto #92. [plan](superpowers/plans/2026-08-16-purchase-invoice-authoring-ui.md).
- **#92** Dashboard — staff self-service portal (sub-project 16, #90 fast-follow): a `staff`-role person logs into the role-blind dashboard for a self-service view (own roster + swap/absence requests), reusing #90's verbs via a `/management-api/me/*` group; no migration. [plan](superpowers/plans/2026-08-16-staff-dashboard-portal.md).
- **#91** Reporting — purchase invoices + modelo 303 IVA deducible → DR303 file (sub-project 8): new `@waitron/purchasing` (received-invoice capture, FORCE-RLS tables, 0041/0042), `computeInputVat` + net `computeVatReturn`, `mapModelo303`, and a byte-exact DR303 writer generated from the official `DR303e26.xlsx`. Two pre-filing caveats under *Debt*. [spec](superpowers/specs/2026-08-16-purchase-invoices-and-modelo-303-deducible-design.md) · [plan](superpowers/plans/2026-08-16-purchase-invoices-modelo-303-deducible.md).
- **#90** Workforce — staff-facing swap & absence request path (sub-project 16): the till-PIN-gated *request* half (requester identity from the session, never the body), surface-agnostic for the staff portal; no migration. [plan](superpowers/plans/2026-08-16-workforce-staff-request-path.md).
- **#89** Recipes/BOM slice 1 — allergen inheritance (sub-project 18): new optional `@waitron/recipes` derives a product's EU-1169 allergens from its ingredients (add-only, PENDING contagious); two FORCE-RLS tables (0038/0039 + a 0040 index). [spec](superpowers/specs/2026-08-15-recipes-bom-allergen-inheritance-design.md) · [plan](superpowers/plans/2026-08-15-recipes-allergen-inheritance.md).
- **#88** De-flake the `fiscal-verifactu` `drain — 1001-split` CI timeout: the drain's batch cap becomes an injectable defaulted param so the split tests use a ~4-row fixture (~30s → ~90ms); production unchanged.
- **#87** Workforce roster management slice 2 (sub-project 16): split-shift (*jornada partida*) authoring, manager approve/reject of swaps + absences (`decideSwap`/`setAbsenceStatus`, migration 0010 decider columns), and a planned-vs-actual view — the manager-approval half. Parallel with #85.
- **#85** Sync transport slice 3 — payments fast lane (#33 §14): a tighter cadence carrying `payments`/`payment_refunds` on an independent per-`(subscriber, origin, lane)` cursor (`sync_cursor.lane` + a `?lane=` param). Dead-subscriber cleanup trimmed to a future slice. Parallel with #87.
- **#84** Sync transport slice 1 (#33 §14): the `@waitron/sync` transport moving `sync_log` batches between servers (NDJSON wire, `syncPullOnce`/`runSyncPull`, node-token `mountSyncApi`) + migration 0037 gating the state-dependent business triggers on `app.sync_apply`. Parallel with #83.
- **#83** Shift-planning authoring slice 1 (sub-project 16): a dashboard surface for the #50 engine — author a draft weekly roster on a person×day grid, view `RosterBreach[]`, publish (`mountWorkforceApi` + `schedule.manage` + `<dashboard-roster-screen>`); no migration.
- **#82** Dashboard i18n layer: an `apps/dashboard/src/i18n/` layer (mirrors `apps/till`) translating at the render edge; raw codes / inline Spanish gone from every screen and widget.
- **#81** Counter POS layout & receipt editors (sub-project 7): owner-authorable till layout + non-fiscal receipt trim — new `@waitron/layouts` + a `till_layouts` FORCE-RLS table (0035/0036) + management-api + dashboard editors; the fiscal invoice core stays unconditional.
- **#80** `errors.reachability` real fix: replaced 13 drifted per-package copies (only 7 tested reachability) with one discovering root guard `scripts/errors-reachable.test.ts`, proven by deletion; CLAUDE.md §4 rewritten.
- **#79** otplib v12 → v13 + `totp.ts` rewrite: v13 was a breaking redesign (the `authenticator` export gone); rewrote to the functional API preserving the public contract, every fail-closed receipt re-probed against otplib@13.4.1.
- **#78** Catalogue / menu management UI slice 1: `products.image` (0034), `media.ts` byte-sniffing + `mountMedia` serve + `mountCatalogueApi` write group (server-generated `<sha256>.<ext>` names), dashboard widgets/screen.
- **#77** Hoist `percentOf` into `@waitron/shared`: consolidated four drifted copies of `base × rate ÷ 100`; behaviour-preserving (huella input unchanged).
- **#76** Reporting — date-range VAT summary + modelo 303 output-VAT aggregate (sub-project 8): `computeVatSummaryForPeriod` + `computeVatReturn` over the filed `sales.vat_breakdown`, one shared `aggregateVatByRate`, civil-date bucketing; no migration.
- **#75** Shared `createErrorBoundary`: extracted the byte-identical `run` boundary from till-api/management-api into `apps/server/src/error-boundary.ts`.
- **#74** Sync slice 1 — commercial-lane outbox (#33 §14): new `@waitron/sync` — a `sync_log` outbox fed by a `sync_capture` trigger on all 14 commercial tables, an idempotent seq-ordered apply loop, bounded retention/lag, origin attribution; migrations 0000/0001. Fiscal-lane sync stays separate (H2).
- **#73** Dashboard slice 1c — staff row-edit actions — wires the staff list's per-row "Editar" (a live-but-unheard `edit-person` seam since #70) to the four existing slice-1b mutations via a new `<dashboard-person-edit>` dialog: role change, suspend/reactivate, reset-PIN, set-password, each committed **independently** (a role change never forces a PIN retype). The screen turns each bubbling/composed domain event into the matching `DashboardApi` call, reloads, and re-resolves the open dialog's person from the fresh list; a shared single-flight guard drops a re-fired action; secrets are masked (`type=password`) and reset on close. **Browser-only** — `@waitron/identity`/`apps/server` unchanged. The role `<select>` is reconciled to state in `updated()`: a `.value` bound before its options fails a non-default preset (the backlog's latent-picker bug) and a `?selected` attribute keeps a dirtied pick after a revert-on-close+reopen — **both failure modes proven by deletion**. The finish-branch two-lens review (fresh-context reviewer verified findings empirically vs real Lit 3 in Chromium) caught the select reopen-desync + an error banner rendered **behind** the modal backdrop (now surfaced inside the dialog's own top layer) + plaintext secret fields (now masked) + a false "Escape/backdrop" comment (`wt-dialog` has no backdrop light-dismiss). **Copilot** caught three more, all the same stale-claim class the `?selected`→`updated()` swap introduced (`editingPerson` not cleared on close → invariant false + latent stale-id; a stale preset-test comment) — all fixed, replied on-thread, resolved. Dashboard suite 100 tests @ **100/98.9/100/100**, axe clean both themes. **Campaign queue item #10**, landed this session (subagents used for the two reviews; build inline). Deferred edges under *Debt* below.
- **#72** First venue admin's initial dashboard password — `waitron-provision venue` now seeds the first admin's dashboard **password** (`persons.password_hash`) alongside the till PIN, closing the bootstrap deadlock where a first management-dashboard login was impossible (every credential path except the provisioning seed — `setPassword`, passkey enrollment — is gated on an already-authenticated session). The password is read from `WAITRON_ADMIN_PASSWORD` (env or echo-off prompt, never argv), validated `assertPasswordLength` ≥8, and hashed at the CLI boundary; threaded `VenueRequest.admin` → `seed-admin` action → the `applyVenue` insert, mirroring the PIN. **No schema migration** (the nullable `persons.password_hash` column already existed) and **no grant change** (`applyVenue` runs as the table owner). A gap-closing e2e proves `loginManager` succeeds after `venue` under `app_user`+RLS (and by deletion). Both runbooks corrected (document `WAITRON_ADMIN_PASSWORD`, list all five secrets, fix the stale worked example that omitted `--admin-name`/the PIN env var). Making the field required broke 10 `apps/server` `VenueRequest` consumers (4 demos + 6 tests) — caught by the pre-push gate (the plan enumerated the provisioning fixtures but missed the cross-package ones), all fixed. Copilot: run the e2e login under the app role. Owner decisions: password required; no force-change-on-first-login. (SDD executed inline — the account's weekly limit blocked subagents mid-run.)
- **#71** Dashboard slice 1d — passkeys (WebAuthn) — the final auth-floor sub-slice: passkeys as the phishing-resistant primary management-dashboard login, plugged into the slice-1a verifier seam. `@waitron/identity` gains two tenant-scoped **FORCE-RLS** tables (`webauthn_credentials`/`webauthn_challenges`; 0007 tables / 0008 hand-written RLS) and the `@simplewebauthn/server` v13 ceremonies (register + auth; auth ends in `startManagementSession` and gates on `person.suspended` like `loginManager`); `apps/server` gains config (`WAITRON_MANAGEMENT_RP_ID`/`_ORIGIN`) + four `/management-api/passkey/*` routes (**register GATED, auth UNGATED**, auth/verify sets the cookie); `apps/dashboard` gains four client methods + `@simplewebauthn/browser` v13 ("Entrar con passkey" / "Añadir passkey"). Only the public key + counter are stored (never a private key); challenges are single-use + `CHALLENGE_TTL_MS`-bounded. Whole-branch review twin-caught a suspended-person auth gap + an unauthenticated-500 behind a false "library maps codes" comment; the finish-branch two-lens review caught three §1 comment overstatements (incl. a "swept" claim the simplify pass left in the sibling migration); **Copilot caught two real concurrency findings** — challenge single-use under concurrency (fixed with a consume-first locking `DELETE … RETURNING` + a deterministic real-PG lock-timeout test) and a counter that could REGRESS under concurrent logins (fixed with a monotonic `counter < newCounter` guard, weakening clone detection). identity 125 tests @ 100%. The crypto is verify-mocked in unit/route tests — a real-ceremony virtual-authenticator test is a follow-up (below).
- **#70** Dashboard slice 1c — dashboard app — `apps/dashboard`, a browser management console (Lit 3 + Vite 6 + Vitest browser-mode/Playwright-Chromium) consuming slice-1b's `/management-api/*`: a `DashboardApi` client (browser-local types, paths/verbs matched exactly to the routes), a boot session probe → login screen (roster + password + optional TOTP → `logged-in`) / staff screen (list + create dialog → `createPerson` → reload) + logout, all wrapped so no async path is an unhandled rejection; built on `@waitron/ui` primitives + `var(--wt-*)` tokens with an axe `.a11y.test.ts` per screen in both themes; its own `test-dashboard` Chromium CI shard (wired into the `ci` aggregate). All source files 100% coverage. Whole-branch review caught a create-dialog reopen bug; the finish-branch two-lens review twin-caught a create-form-not-reset bug (duplicate/reused-PIN hazard) + added a create single-flight guard. Headless server backend is 1b; UI actions for row-edit are a fast-follow (see below).
- **#69** Dashboard slice 1b — server management API — the slice-1a identity auth exposed over HTTP as a `/management-api/*` Hono route group on `apps/server` mirroring `mountTillApi`: a `waitron_management_session` cookie (httpOnly / SameSite=Strict / Secure-iff-TLS), login/logout, and `person.manage`-gated staff CRUD (list/create/patch/reset-pin/set-password), plus `setPassword` in `@waitron/identity` (an admin grants dashboard access). New `management.request_invalid` body-shape code; every handler scoped to the one venue tenant via `withTenant` + `asAppUser`. Real-PG e2e incl. a **differential** cross-tenant isolation proof (fails if `asAppUser` is dropped) + refusal proofs (unauth 401, wrong-password 401 + no cookie, staff-role 403). Finish-branch fixed a null/non-object-body → 500 class (now the routes' own 4xx), the PATCH type-screening gap (`role`/`status` now 400 not pgEnum-500) + its false errors.ts doc, and three overstating comments; a Copilot NIF-collision flag was verified a **false positive** (one PG container per file → isolated DBs). Headless — the UI is 1c.
- **#68** Frozen *cierre Z* (sub-project 8, slice 8b) — immutable numbered `daily_closes` (0033, the immutability recipe: `REVOKE ALL` + `GRANT SELECT,INSERT` + append-only/anti-TRUNCATE triggers + FORCE RLS + tenant policy) freezing a snapshot of the derived close, a per-node `daily_close_chain` head that `recordDailyClose` advances in the **same transaction** as the close (single-active-writer `FOR UPDATE`, `UNIQUE(scope, sequence_no)` backstop), per-till counted-cash vs expected reconciliation → `cash_variance` (*descuadre*), and `verifyDailyCloseChain` which re-walks a `(tenant, node)` chain reporting the first break (`sequence`/`genesis`/`broken_link`/`hash_mismatch`/`tail_truncation`/`missing_head`). Headless; English schema tokens (`daily_closes`/`cash_variance`/`entry_hash`), Spanish *cierre Z*/*descuadre* UI-only. Copilot caught a tamper-detection gap in review — a deleted chain head with surviving closes read as `ok:true`; now caught as `missing_head`, proven by deletion in a real-PG test.
- **#66** VAT-exact daily close (sub-project 8, slice 8a) — `sales.vat_breakdown jsonb NOT NULL` (0032) written from the *same* variable each sale-creating backend files (one source, cannot diverge from the huella); `computeVatSummary` reads it (`cross join lateral`, rate normalised as `numeric(5,2)::text`) so the daily close is exact per-rate for catalogue difference-method sales. No `computeHuella` change. Prerequisite for the frozen cierre Z (8b).
- **#65** Menu & allergens (sub-project 18, slice 1) — EU-14 allergen declaration end-to-end: taxonomy + `validateAllergens` + `allergen.*` codes (`@waitron/catalogue`), a nullable `products.allergens jsonb` (0031), catalogue-ops threading, `/api/products` + `TillProduct` exposure, en/es names, a till **allergen screen** (matrix + operator lookup + print) with the `null`=PENDING-never-allergen-free invariant, and a demo. Legal basis (RD 126/2015 Art. 6.5) verified on primary source. Deferred: a `@media print` stylesheet so Print isolates the allergen sheet (convenience-only). Further sub-project-18 scope (recipes/BOM, variants, customer-facing browse) not started then — recipes/BOM allergen-inheritance backend since landed as #89.
- **#64** Counter POS — integrated card terminal (Stripe Terminal / Tap-to-Pay): split-transaction pay (collect outside the fiscal tx), working-order-derived capture idempotency + lost-response recovery, `POST /api/pay`.
- **#63** Counter POS 7c — prepare & collect: line-add price-snapshot lock, placing, per-location pay-timing (prepay / invoice-first / ticket-then-pay), amendment log, prep surface.
- **#62** Counter POS — manual (*datáfono*) card tender + captured `payments` row.
- **#61** Counter POS 7b — park & retrieve across registers + sale idempotency.
- **#60** Counter POS 7a — walk-up cash sale; new `@waitron/till` + the server till API.
- **#59** Catalogue — priced products (gross-inclusive, difference-method VAT).
- **#58** Identity — headless first slice (persons/sessions, PIN login, `authorize()`).
- **#57** Locations — provision a sellable venue (country/territory fiscal identity, `waitron-provision venue`).
- **#56** Reporting — daily-close first slice (`computeDailyClose`).
- **#55** Invoice-first settlement — headless remainder (settle a corrected invoice-first sale).
- **#54** `node_id` re-key — SIF / chain / series keyed to `nodes`, not `till_id`.
- **#52** Workforce floor — four review-fix corrections (UTC render, tamper-chain gaps, clock TOCTOU).
- **#51** F3 canje — "can I have a proper invoice?" (`recordSubstitution`).
- **#50** Workforce D2 — scheduling (rosters, guardrails, planned-vs-actual).
- **#49** Payments — Mode 3 inbound Stripe webhook (security half).
- **#47** Workforce — *registro de jornada* legal floor.
- **#46** Rectificativas — R5 corrective invoices.
- **#39** Sale settlement model — tip/amount off the frozen sale, `settleSale`.
- **#37** Fiscal Q13/Q15 closed on primary source.
- **#33** Local server as SIF, active-active + failover (topology only; buildable pieces under *SIF topology follow-ups*).
- **#31** Scoped pre-push hook · **#27 / #25** Scoped CI · **#23** Pre-push skips deletions · **#32** CI scope fail-open fix.
- **#22 / #19** Cloud storage model · **#21** This backlog · **#20** Sale settlement design.
- Plus provisioning / CI / docs PRs (e.g. #11, #16, #35, #44) — the git log is the full record.

**The fiscal sequence is complete** — its four pieces (#39 settlement, #46 rectificativas, #51 F3
canje, #55 invoice-first) are all above. They were sequenced rather than parallelised
because each adds a `packages/db` migration and `packages/db/drizzle/meta/_journal.json` conflicts on
every concurrent branch touching that package (the collision is per-package; five packages carry their
own `drizzle/`). Designs and sources:
[settlement](superpowers/specs/2026-07-31-sale-settlement-model-design.md) §8,
[verifactu-findings](compliance/verifactu-findings.md) §§7-10,
[invoice-first](superpowers/specs/2026-08-03-invoice-first-settlement-design.md).

---

## SIF topology follow-ups (from #33)

The [server-as-SIF + failover design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
decided the **topology only**; its §14 defers the buildable pieces, each to its own spec:

- **The sync / replication protocol** between the two local servers and the cloud mirror — the
  largest unbuilt piece. **Designed and reviewed**
  ([spec](superpowers/specs/2026-08-02-app-level-sync-design.md)); the mechanism is decided:
  cross-replication is **application-level** (an outbox — `sync_log` + a generic capture trigger,
  apply as the app role under `withTenant`), **not** native Postgres logical replication, which
  categorically refuses to write into an RLS-enabled table under a non-BYPASSRLS role (proven on real
  Postgres — [findings](superpowers/specs/2026-08-02-replication-force-rls-prototype-findings.md)).
  Its **9 container gates RAN 2026-08-06 — all pass, outbox validated with no new privilege**
  ([findings](superpowers/specs/2026-08-06-sync-container-gates-findings.md)). Owner decisions:
  explicit `server_id` on the commercial tables, **true active-active** for the deli, a **payments
  fast lane** — with `envios`/`acks` ordered-lane-only (no monotonic column). The `node_id` re-key it
  depended on landed (#54), so the columns already exist. **Slice 1 — the commercial-lane outbox
  (capture triggers + idempotent seq-ordered apply + bounded retention/lag + origin attribution) —
  LANDED as #74** (2026-08-11, `@waitron/sync`), and **Slice 2 — the transport/network layer (symmetric
  HTTP pull + redelivery + node-token auth + the `0037` trigger-gating) — LANDED as #84** (2026-08-15):
  the two constraints slice 1 flagged were both closed — the three state-dependent business BEFORE
  triggers are gated on `app.sync_apply`, and `nodeId` is threaded through every enrolled writer (a
  re-audit found three the design had missed), and **Slice 3 — the payments fast lane — LANDED as #85**
  (2026-08-15): a second, tighter cadence carrying `payments`/`payment_refunds` on an independent
  per-`(subscriber, origin, lane)` cursor (`sync_cursor.lane` + a 3-col PK repivot, a lane-filtered
  source read + a `?lane=` wire param, two boot cadences), with the cross-lane FK order absorbed by the
  pre-existing `23503` park (no new correctness machinery). **Dead-subscriber cleanup was TRIMMED out
  of #85 by owner decision** (it needs retention actually scheduled in boot + cross-node cursor
  visibility — a future retention-ops slice, not a capability shipped two layers ahead). What NOW
  remains: the **cloud-mirror** peer, **dead-subscriber** cleanup (releasing the
  retained log), **multi-tenant** transport (a whole-log reader role), node-token **rotation**, and the
  **fiscal-lane sync** (the `registros`/hash-chain lane, a separate owner-reviewed slice — H2,
  deliberately excluded).
- **Promotion + fencing tooling and the till-side failover list** — boot-time role resolution,
  continuous conflict-detection, the "one primary" invariant.
- **The submitter as a relocatable role** — one venue submitter, certificate resolved from wherever
  it runs.
- **Till UX for the timed-out card case** (retry / alternative tender / wait).

Also left open by that design:

- **`CLAUDE.md` §5's "nothing blocks a sale" invariant must be rewritten** — but *in the change that
  implements server-as-SIF*, not before, because the current code still honours the old wording.
  Deferred deliberately; recorded here so it is not lost.
- **A new asesor question** — a cloud server that *issues* invoices (cloud-primary or standalone)
  operates the SIF from a cloud location, a stronger form of the §8a hosting question (RD 1619/2012
  arts. 22.2 / 19.4). See the design's §13, and the advisor gap below.
- The **reconcile remediation UI** and the **orphan-drift hold** (both already under *Debt and odd
  jobs*) are the backstop for the design's double-charge-across-failover path (§10) — no new work, but
  now they have a second caller.

**2026-08-15 — the distribution & client-topology design landed (#86,
[spec](superpowers/specs/2026-08-15-distribution-and-client-topology-design.md)),** the packaging /
install / client-routing layer beneath this topology (the deferred deployment sub-project #9 plus the
client side of the failover list above). A captured brainstorm, items labelled decided/lean/open.
What it adds here:

- **The till-side failover list** (bullet above) now has concrete reroute mechanics: the till reaches
  *any* live server (selling is active-active), keeping a **stable local origin** in front — a
  service-worker interim vs an on-device agent, decided by the auth model.
- **A new dependency, not previously tracked — identity-config flow-down** (its own spec). Verified
  against the code: `sessions` and the whole `identity` package are outside the sync set, so a failover
  logs the user out today. Identity *config* (persons + credentials) must flow down to a secondary
  read-only, the way catalogue already does; the *session* must **not** replicate (write-amplification
  + single-writer conflict). Session re-establishment: PIN-re-prompt v1 → portable signed token later.
- **Direction:** cloud-hosted is a **first-class mode** — the zero-hardware trial on-ramp (buildable
  now, preproduction, shared demo tenant); production-cloud-primary is **gated on the asesor question
  already noted above**. And **production uses Postgres everywhere** (PGlite demoted to dev/test/demo,
  revising architecture §4).
- **Recommended first build:** the **cloud trial on-ramp** — cheapest and least new code (today's
  same-origin PWA pointed at a cloud instance).

  Still unbuilt from that design: the on-device agent (own spec/spike), identity-config flow-down, the
  appliance image + AP-mode onboarding, and the reroute itself.

---

## The advisor gap

**No fiscal advisor is engaged.** The four open questions in
[compliance/asesor-questions.md](compliance/asesor-questions.md) therefore have nowhere to go, which
makes "blocked on the asesor" a wish rather than a queue.

Two of the four are not idle curiosity — they check assumptions **already built into the code**:

| Q | Assumption already in the tree | If the answer is no |
| --- | --- | --- |
| **Q13** *(CLOSED #37)* | Tips are outside the VAT base and appear on no invoice — the tip lives on `tenders.tip_amount` (moved off the sale by #39), and `record-sale.ts` / `settle-sale.ts` hand the fiscal backend only the sale `total` (never the tip), so it never reaches the huella — a structural absence, not a dedicated test | Confirmed (findings §11): the tip does **not** enter the hash |
| **Q5(a)** | One invoice series per till | The numbering scheme's foundation moves — and #33 already reshapes it (a series belongs to the server-SIF; two concurrent SIFs need disjoint series), see the SIF follow-ups above |
| Q14 | A printed pre-bill obliges an amendment log | Changes the till design, not existing code. **Still open** — no primary text names the *precuenta* (findings §8) |
| Q15 *(core CLOSED #37)* | Short payment accepted before issuance is a discount | Confirmed (findings §12): a *descuento* agreed at/before the operation is outside the base (LIVA art. 78.Tres.2º) |

**Engaging someone is itself a task, and it has a lead time.**
[compliance/who-to-ask.md](compliance/who-to-ask.md) is blunt about the market: *"No Spanish advisory
firm with demonstrated technical depth on encadenamiento or RRSIF architecture was verified — every
candidate turned out to be a marketing page. Assume you will be educating whoever you hire."*

### Read this before engaging anyone: some questions are premised on an architecture we abandoned

[#19](https://github.com/clintongormley/waitron/pull/19) (*"The cloud is a sync root, not a shared
system of record"*, merged 2026-07-31) put a banner at the top of `asesor-questions.md` warning that
several questions assume **Waitron hosts the client's fiscal system**. Under the design it
establishes, the cloud never holds the key ring, the certificate stays on the client's own local
server, and that server always submits. Q11 and Q12 are named as affected, and its instruction is
blunt: *«re-read every question against the new architecture before paying for answers»* — a question
built on the old premise buys an answer to a situation that will not exist.

**So the advisor task is not just "engage someone".** It is: re-read the whole list against the
current architecture, drop or rewrite what the cloud design invalidated, add the replacement
questions that design raises, *then* engage.

**Which replacement questions, corrected 2026-07-31.** An earlier version of this paragraph named
one: *"does the RRSIF reach a backup archive that is not itself a SIF?"* **Do not ask that.**
[#22](https://github.com/clintongormley/waitron/pull/22) retired it — the RRSIF governs invoicing
*systems*, and an archive issues nothing, so the cloud spec had already answered its own question.
Worse, it pointed at the regulation least likely to apply. The rules that do govern records once they
exist are in the **ROF** (RD 1619/2012), and the three real questions are written out in
[the cloud storage design](superpowers/specs/2026-07-31-cloud-storage-model-design.md) §8a: whether we
count as a *tercero* holding records on the client's behalf, whether that puts a prior-notification
duty on every client whose records we keep outside Spain, and whether the online-access requirement
binds us or only them.

**One of those may decide where the cloud is allowed to run**, which makes it worth answering before
anything is built rather than after — see the same spec's §10.

Q13, Q14 and Q15 post-date that design and do not depend on hosting, so they are unaffected.

**A second architectural shift, 2026-08-01 (#33).** The
[server-as-SIF design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md) makes
**Q1** moot (the server is the SIF, so a till need not qualify as one) and leaves the closed **Q2**
(relayed submission) non-load-bearing. It **reshapes Q5(a)**: a series now belongs to the
*server*-SIF, and the two concurrent SIFs must issue under **disjoint** series or their records
collide on the identity triple. And it **raises a new hosting question** — a cloud server that
*issues* invoices (cloud-primary / standalone) operates the SIF abroad, a stronger form of the §8a
question above. `asesor-questions.md` carries a dated note; the full re-read this section calls for now
has two designs to read against, not one.

### Q13 and Q15 closed on primary source (done 2026-08-01, #37); Q14 still open

Closed following the Q5(b) precedent — primary/official source rather than waiting on an advisor. Q13
(tips) and Q15's core are recorded in [verifactu-findings.md](compliance/verifactu-findings.md) §§11–12
and marked closed in `asesor-questions.md`. In short: a voluntary tip is not *contraprestación*, so it
is outside the VAT base whether paid in cash or on the same card capture (the test is *voluntariedad*,
not payment method); a short payment agreed as payment-in-full before the factura issues is a
*descuento* outside the base (LIVA art. 78.Tres.2º).

- **Q14 (precuenta) stays open** — a bounded search found no primary text naming the restaurant
  *precuenta*, only the general prefactura doctrine (findings §8). Whether AEAT's
  *albaranes / proformas / prefacturas* list is exhaustive is the interpretive hinge; it is one for
  the advisor.
- **New non-fiscal duty surfaced by Q13's card-present analysis:** a tip collected through the card
  terminal (unlike cash handed straight to a waiter) is business income — *ingreso* for the Impuesto
  sobre Sociedades and *rendimiento del trabajo* with retención for the employee. It does **not** touch
  the factura or the huella; it is an accounting/payroll matter, recorded under *Not started* below.
- **Provenance caveat** (carried in the findings): PETETE was unreachable (TLS), so the DGT consultas
  were read via faithful legal-database reproductions; art. 78.Tres.2º was read at an official AEAT
  source. Confirm the consulta wording on PETETE if an advisor engages. Correction landed in #37: DGT
  **2174-03 is a *general* consulta, not vinculante** — the binding restatements are V3095-17 / V1808-22.

---

## Not started

Most of the till track now has code — see *Recently shipped* (sub-projects 5 Identity, 6 Locations,
7 Counter POS, 8 Reporting, 16 Workforce, 18 Menu & allergens all have landed slices). What remains
genuinely unstarted is below. The two 2026-08-07 reprioritised slices have both landed their first cut
(allergens #65; *cierre Z* 8a #66 + 8b #68); the **management dashboard** slice-1 auth floor is
**COMPLETE** (1a #67 → 1b #69 → 1c #70 → 1d passkeys #71), and the **autonomous campaign** is now the
active work (see *Now* / *Current direction*).

| Sub-project | Note |
| --- | --- |
| **7 — Counter POS** | **Operable counter POS complete** — 7a walk-up cash (#60), 7b park/retrieve + idempotency (#61), manual card (#62), 7c prepare & collect (#63), integrated Stripe card (#64); the **layout & receipt editors DONE (#81)** — owner-authorable till layout arrangement + non-fiscal receipt trim, `@waitron/layouts` + `till_layouts` + dashboard editors; all in *Recently shipped*. **Remaining:** a **SumUp** card provider (a future vendor beside Stripe). Deferred edges under *Debt and odd jobs* → **Counter POS follow-ups** (7a / 7b / 7c / integrated card / layout-receipt) |
| **5 — Identity** | **Headless first slice merged (#58, 2026-08-05).** `@waitron/identity` owns `persons` + `sessions` (FORCE-RLS tenant isolation, now also scanned by fiscal-verifactu's `inmutabilidad` guard), salted-PIN hashing, a role/permission catalog, `authorize()` (operator session + supervisor `{personId, pin}` override), `loginWithPin` / `endSession`, and a `person.manage`-gated staff API. `recordVoid` / `recordCorrection` now require `sale.void` / `sale.rectify` authorization; `sales.authorized_by` / `sales.operator_id` + `payment_refunds.authorized_by` seams and a `waitron-provision venue` admin seed are in place. Remaining sub-project 5 scope (mid-shift-suspension enforcement, the discount gate, till-refund enforcement, the workforce-gate consolidation, branded ids) is under *Debt and odd jobs* → **Identity follow-ups**. The human-facing call sites (must-be-logged-in to ring, till refunds must be authorized) land with the counter POS (#7) |
| **6 — Locations** | **Provision-a-sellable-venue slice merged (#57)** (2026-08-04; see *Now*) — the foundational till-track unblocker. Country/territory-driven fiscal identity, `resolveFiscalModules` (común → Veri\*Factu + IVA, others refused), `planVenue` / `applyVenue` and the `waitron-provision venue` CLI stand up tenant → location → till → node → SIF → series so `recordSale` can chain a sale; the stale `bootstrap-tenant.sql` was **deleted**. Remaining sub-project 6 scope (multiple locations, editing/deactivation, the #33 SIF-topology deferrals) is under *Debt and odd jobs* → **Locations follow-ups** |
| **8 — Reporting** | **Daily-close first slice done (#56)** — `@waitron/reporting`'s `computeDailyClose`. ***Cierre Z* (frozen/signed daily close) DONE** — 8a VAT-exact close (#66, `sales.vat_breakdown`), 8b immutable numbered `daily_closes` + per-node hash chain + per-till *descuadre* (#68). **Date-range VAT summary (`computeVatSummaryForPeriod`) + *modelo 303* output-VAT month aggregate (`computeVatReturn`) DONE (#76)** — pure reads over the filed desglose, one shared `aggregateVatByRate` core, civil-date bucketing, real-PG cross-tenant RLS proof; all in *Recently shipped*. **IVA deducible/soportado (input-VAT) side + AEAT casilla mapping + submittable DR303 file DONE (#91)** — the `@waitron/purchasing` module (purchase-invoice capture), `computeInputVat` + net `computeVatReturn`, `mapModelo303`, and the byte-exact DR303 writer (layout from the committed official `DR303e26.xlsx`); see *Recently shipped*. **Quarterly/annual periods + the DR303 download route DONE (#98)** — a `LiquidationPeriod` union (month/quarter/year; quarter/year = exact `addDecimal`-sum of months, proven by deletion), a period-aware `toDr303Record` (annual refused — that's modelo 390), and an authenticated `GET /management-api/reports/modelo-303` route gated on a new `report.export` permission; read-only, no migration; see *Recently shipped*. Further unstarted slices: **rectificativas** (40/41), the **prorrata rule** (44), **intra-community/import boxes** (32–39) — plus the two #91 **pre-filing caveats** (real-sede validation; asesor prorrata confirmation). **The purchase-invoice authoring UI LANDED (#93)** — a `purchase.manage`-gated dashboard create/edit/list surface (header + VAT-desglose sub-editor), see *Recently shipped*. Reporting follow-ups are under *Debt* |
| **16 — Workforce** | *Registro de jornada* legal floor **DONE (#47)**; **D2 scheduling DONE (#50)** — `convenio_config` surface (overtime de-hard-coded, single-sourced), shifts + `roster_versions` + `publishRoster`, absences/availability/shift_templates/shift_swaps, an **advisory** guardrail engine (`validateRoster` → `RosterBreach[]`; publish surfaces breaches but proceeds — owner chose warn+override) + a planned-vs-actual read model, and supersede-on-republish (partial unique index, one published roster per `(location, period)`). The overtime *rule* the both-model projection computes stays convenio-driven — an **asesor-laboral** call, not code. Remaining: **D3 payroll export** (integrate-not-build), plus the workforce follow-ups under *Debt and odd jobs*. Deferred edges from the floor: the registro export doesn't yet surface overtime (belongs to the payslip/D3); the correction period-fetch is a ±1-day window (a >1-day-relocation correction is out of the floor's scope, chained but maybe missed by the period fetch). A post-#47 `/finish-branch` review (landed as #52) corrected four floor defects: the registro export rendered UTC instead of local wall-clock; the tamper chain omitted a correction's reason/actor and the capturing till; correction precedence tie-broke on the unhashed `ingest_seq` (a floor-bypasser could reorder corrections undetected) — now on the hashed `sequence_no`; and a `clockIn`/`clockOut` TOCTOU (an unlocked state read before the chain-head lock let two concurrent same-person clock-ins append a double-`in` that undercounts worked time) — now serialized per person with a `persons` row lock proven by a real-PG concurrency test. **Authoring UI (dashboard) LANDED (#83, 2026-08-15)** — author a draft weekly roster on a person×day grid → view breaches → publish (`mountWorkforceApi` + `schedule.manage` + `<dashboard-roster-screen>`, no migration). **Roster-management slice 2 LANDED (#87, 2026-08-15)** — split-shift (*jornada partida*) authoring, manager approve/reject of swaps + absences (`decideSwap`/`setAbsenceStatus` + `swap.approve`/`absence.decide` + migration 0010 decider columns + approvals screen), and the planned-vs-actual view (`getPlannedVsActual`, published-roster only) — the **manager-approval half**; the **staff-facing request path** for swaps/absences **LANDED (#90, 2026-08-16)** — a till-PIN-session-gated surface (request a give-away/cover, accept an offered swap, request an absence), built surface-agnostic for the staff dashboard portal — **which LANDED (#92, 2026-08-16)**: a role-aware dashboard where a `staff`-role person logs in and sees a self-service view (own roster + request/accept swaps + request absences), reusing #90's verbs via a management-session `/management-api/me/*` group (no migration). D3 payroll export remains. See *Recently shipped* → #87/#90/#92 for the deferred follow-ups |
| **18 — Menu and allergens** | **Slice 1 (EU-14 allergen declaration) DONE (#65)** — taxonomy + `validateAllergens` + `allergen.*` codes (`@waitron/catalogue`), `products.allergens jsonb` (0031), `/api/products` + `TillProduct` exposure, en/es names, a till allergen screen (matrix + operator lookup + print), a demo; in *Recently shipped*. Allergen declaration is a **launch-day legal duty** (EU 1169/2011, RD 126/2015). **Recipes/BOM allergen-inheritance backend DONE (#89)** — `@waitron/recipes` derives a product's allergens from its ingredients (add-only, PENDING contagious). **Recipe-authoring UI DONE (#94)** — a `recipe.manage`-gated dashboard surface (ingredient CRUD + product-recipe editor), the allergen picker reseeded from `manual_allergens`. **Remaining:** **nested sub-recipes**, plate costing + stock (greenfield, sub-project 20), variants, customer-facing browse; the allergen list stays a food-safety-advisor call. Deferred `@media print` sheet-isolation edge under *Debt* |
| 10-15, 17, 19, 20 | Tabs, floor plan, KDS, tip payroll, bookings, online ordering, accounting export, opening hours, procurement |

**#18 (allergens) is a launch-day legal duty** — not fiscal, not optional — which is why its first
slice was picked next and landed (#65). The registro de jornada, the other launch-day legal floor,
already landed (#47).

**Card-collected tips are business income (new, 2026-08-01, #37).** A tip taken through the card
terminal — unlike cash handed straight to a waiter — is *ingreso* for the Impuesto sobre Sociedades and
*rendimiento del trabajo* with retención for the employee (IRPF / nómina). It does **not** touch the
factura or the huella (the fiscal path is unchanged and correct — findings §11), but it is a real
accounting/payroll duty for the **tip-payroll (13)** and **workforce (16)** tracks — integrate-not-build,
and it needs the tip attributed to the payer (which the sale-settlement model, piece 1, now does by
putting the tip on `tenders`).

**Owner-flagged remaining UI work (2026-08-08).** A "what UI is left?" review named four surfaces to
keep on the radar. The split that matters is backend-vs-greenfield — only the first is a "build the UI"
task today:

- **Shift-planning dashboard UI** (sub-project 16) — **authoring slice LANDED (#83, 2026-08-15):** a
  manager authors a draft weekly roster on a person × day grid, views the advisory `RosterBreach[]`, and
  publishes. **Still open here:** the manager **approve/reject-swaps** flow (the `accepted → approved/rejected`
  transitions + a `swap.approve` permission are unbuilt), **absence approval**, the **planned-vs-actual**
  view, and — flagged for an early fast-follow — **split-shift (*jornada partida*) authoring** (a
  person/day that already has a shift opens edit-only; the backend supports a second shift, the UI does
  not yet).
- **Recipes / BOM** (sub-project 18) — **the linchpin**. **Allergen-inheritance backend LANDED (#89,
  2026-08-16)** — `@waitron/recipes` (ingredient master + recipe composition) derives a product's
  allergens from its ingredients. **Recipe-authoring UI LANDED (#94, 2026-08-18)** — a `recipe.manage`-gated
  dashboard surface (ingredient CRUD + product-recipe editor), the allergen picker reseeded from
  `manual_allergens`. Still open on this linchpin: **nested sub-recipes**, and its other two
  consumers, still greenfield — **plate costing** and **stock depletion per sale** ("150 g ham used").
- **Stock-taking / inventory** (sub-project 20) — greenfield; downstream of recipes (a sale only becomes
  "150 g ham used" through the recipe).
- **Supplies ordering / procurement** (sub-project 20) — greenfield; sits on inventory. **AI-assisted
  reorder is explicitly deferred.**

**Table-service track — planned 2026-08-16 (SUPERVISED; spec 2026-08-17).** The owner chose to build
table service and its dependent surfaces. Unlike the autonomous campaign's five extension-items, these
are greenfield and product-heavy, so they are **specced with the owner and run supervised** (from
2026-08-17, owner in the loop) — **NOT landed unattended**. Owner-scoped first slices (decided
2026-08-16):

- **Table service (foundation, sub-project 10 — *tabs*)** — the *tables* primitive the other three
  need: table identity + live state tied to orders (the counter POS #60–64 is walk-up only, so this is a
  real ordering-model addition, not a UI). **DESIGNED + PLANNED 2026-08-17** — decomposed into five core
  slices, each with a committed spec + TDD plan on the `dining_tables.tab_id` **back-pointer** model
  (build order, each depending on the prior): **TS-1** tables + tabs (append-only rounds; one-tab-per-table
  via a per-table lock; pay reuses `recordSale` unchanged) → **TS-2** configurable service statuses
  (venue-defined set + a reset trigger) → **TS-3** move / join / merge (a tab can cover several tables) →
  **TS-4** transfer items (whole/partial, never re-priced) → **TS-5** split-bill (item-split — the one
  fiscal slice; each check files its own sale + `registro`; dedicated fiscal review). In
  `docs/superpowers/{specs,plans}/2026-08-17-table-service-ts*`. **TS-1 LANDED (#97, 2026-08-18)** —
  `dining_tables` (FORCE RLS, migrations 0043–0046) + `openTab` (per-table `FOR UPDATE` lock) + `addTabRound`
  (per-tab `line_no` lock) + `voidTabLine` + pay-closes-tab + counter delivery-to-table (`delivery_table_id`) +
  `listTablesWithState` occupancy read-model + till routes with `isUuid`/range guards; both concurrency races +
  RLS proven by deletion on real Postgres; **fiscal core untouched** (`recordSale` byte-unchanged; an empirical
  huella-independence proof that neither the `tab_id` back-pointer nor the `delivery_table_id` column enters the
  huella). Built subagent-driven TDD (10 tasks + whole-branch review + fix wave). **TS-2 LANDED (#103, 2026-08-19)** —
  configurable service statuses (see the *Recently shipped* row); **TS-3 LANDED (#119, 2026-08-20)** — move / join /
  merge (see the *Recently shipped* row); **TS-4 LANDED (#124, 2026-08-20)** — transfer items (see the *Recently
  shipped* row). **TS-5 (split-bill) is the next TS-chain slice but is FISCAL** (each check files its own sale +
  `registro`) — SUPERVISED / owner-gated, NOT built autonomously; **FP-1 (floor plan) is the next non-fiscal
  buildable slice**, and KDS-1 / bookings-integration also unblock. **#97 follow-ups:**
  - **Sync — HARD GATE for the sync-enrollment slice.** `delivery_table_id` replicates (its table
    `working_orders` is sync-enrolled) but FK-references `dining_tables`, which is **not** enrolled.
    `sync/apply` parks a `23503` **and holds the cursor below it** (`apply.ts:93-96`), so once a
    counter-delivery order (non-null `delivery_table_id`) is applied on a subscriber it can **stall the ordered
    lane indefinitely**. Latent today (cloud-mirror *apply* is deferred; the counter-delivery write path is not
    UI-wired). The sync-enrollment slice **must enroll `dining_tables`** (correct `fkRank`) before activating
    the `working_orders` subscriber, or exclude the column. Copilot corroborated on #97.
  - **Location-scope the by-id verb family (Copilot #97).** `updateTable`/`deactivateTable`/`openTab` address
    by (tenant-via-RLS) + id, matching the established held-order by-id family (`getHeldOrder`/`updateHeldOrder`/
    `abandonHeldOrder`); only *list* verbs scope by location. **Unreachable today** (single-location tenants).
    When multi-location (sub-project 6) lands, location-scope the **whole by-id family together** (per
    `updateHeldOrder`'s own note that it should move as one), not just the table verbs.
  - **TS-2 caveat — folded into #103's follow-ups.** The `status='open'` stale-pointer / occupancy predicate
    (openTab overwrite, `addTabRound`, `voidTabLine`, `listTablesWithState`) assumes a tab never reaches `placed`.
    TS-2 (#103) kept the tab live-state unchanged (statuses are a separate `status_id` overlay, so the predicate
    held) and hardened the reset trigger to fire on `placed`-→-terminal too; the underlying
    `placeOrder(tabId)`-has-no-tab-guard reachability — a live placed tab still reads *free* to
    `openTab`/`listTablesWithState` — remains, now tracked under *Debt* → table service TS-2.
  - Minor: `listTablesWithState` cross-tenant read is PGlite-only (rests on explicit tenant predicates + RLS,
    not a two-tenant test); the counter-delivery bad-id pre-check is existence-only (a sale can be tagged for a
    *deactivated* table — benign, non-fiscal); a `"W1"` (`WAITRON_ID_SISTEMA`) literal is inlined in a test.
- **Floor plan (sub-project 11)** — a layout editor **with live occupancy** (table state tied to
  orders), not a standalone layout. **FP-1 DESIGNED + PLANNED 2026-08-17** — brainstormed with the
  owner (visual companion), decomposed **operable-first into two slices**: **FP-1** (this) makes table
  service usable front-of-house — `floor_zones` config, a per-line `served_at` delivery ack, occupancy
  read extended with zone + `pendingToServe`, a till **live-floor screen** (occupancy-coloured cards
  grouped by zone) + a **table-ordering screen** (full-width grid + current-round bar + badged pull-out
  tab drawer), and a dashboard **Sala** config editor; the live floor renders as **cards, not a spatial
  map**. **FP-2 DESIGNED + PLANNED 2026-08-17** adds the **spatial canvas + drag-drop edit mode** —
  nullable placement columns on `dining_tables` (`pos_x/pos_y` per-mille, a `floor_table_shape` enum,
  `rotation`; size derived from plazas), a shared `@waitron/ui` `wt-floor-canvas`, a till **map/list
  toggle** + unplaced tray, and edit mode in **both** the dashboard and an on-till "Editar plano" toggle
  — the latter **manager-on-till** (the operator's own `till.configure` role, the first till route to
  call `authorize()`; supervisor-PIN override deferred). Both FP slices are non-fiscal (pay path
  unchanged; neither `served_at` nor any placement field enters the huella). Specs + plans in
  `docs/superpowers/{specs,plans}/2026-08-17-floor-plan-fp{1,2}*`. **TS-1 + TS-2 have now landed (#97, #103), so
  FP-1 is unblocked** (FP-1 is their UI; FP-2 builds on FP-1) — FP-1 before FP-2.
- **KDS (sub-project 12)** — **multi-station routing** (per-station displays, route each line to its
  station, course firing) — a station/routing model, not merely an extension of #63's prep surface.
  **KDS-1 DESIGNED + PLANNED 2026-08-17** — brainstormed with the owner (visual companion), full scope
  chosen then sliced **KDS-1 → KDS-2 → KDS-3**. **KDS-1** (this) = `kitchen_stations` config (one
  default) + routing (`category.station_id` default, `product.station_id` override, snapshotted at fire
  time) + the big rework: **`order_prep` (one-row-per-order) is replaced by per-line/per-station
  `ticket_items`** (`queued→preparing→ready`), so tab rounds and multi-station orders finally reach the
  kitchen; a **session-gated** till station-display (kanban ⇄ rail, per-line bump, whole-ticket
  configurable); and the **ready→floor** loop (a `ready` ticket → FP-1's "N listos", distinct from
  `served_at`). **KDS-2 DESIGNED + PLANNED 2026-08-17** — venue-configured `kitchen_courses`, a
  product-default course (`products.course_id`) + per-line override, and **hold-and-fire**: the first
  course auto-fires, later courses hold (greyed on the station display) until fired; **`fire_control`**
  is a venue setting (`waiter` default / `kitchen`, both built; `expo` reserved for KDS-3). `fired_at` +
  `course_id` on `ticket_items`; held items can't advance (`ticket.item_held`). Non-fiscal; blocked on
  KDS-1. Spec + plan in `docs/superpowers/{specs,plans}/2026-08-17-kds-2*`. **KDS-3 DESIGNED + PLANNED
  2026-08-17** — a **dedicated expo/pass display** aggregating every open order across all stations by
  course, with the pass's levers: **fire** the next course (KDS-2's `expo` `fire_control` value), one-tap
  **bump-course-ready** across stations, and **away** (`ticket_items.away_at` — plated & dispatched,
  feeding the floor an "en camino" hint between kitchen-`ready` and waiter-`served`). Session-gated (an
  `expo` device kind follows device-identity). Non-fiscal; blocked on KDS-1 + KDS-2. Spec + plan in
  `docs/superpowers/{specs,plans}/2026-08-17-kds-3*`. **So the KDS track's DESIGN is complete** (KDS-1
  core, KDS-2 courses, KDS-3 expo, + the always-on device identity). **Kitchen printers (owner requirement
  2026-08-17)** grew into a **printing subsystem** (there is *no* printing in the tree today; the
  deli-hardware spec specifies but never built an ESC/POS-over-TCP:9100 server-driven `ReceiptPrinter`),
  split into two slices: **Printing subsystem — DESIGNED + PLANNED 2026-08-17** (a new infra sub-project) —
  central-managed `printers` + **print agents** (local processes that enrol/revoke centrally via a
  pairing code reusing the device-identity crypto, **pull** jobs from a central `print_jobs` **outbox**,
  **push** to the physical printer, **report** status), a **transport abstraction** (`usb` +
  `network_tcp` built, `cloud_poll`/CloudPRNT a fast-follow), an ESC/POS builder, and central dashboard
  management — so config is central while execution is distributed on whatever box holds the printer, and
  a job enqueued on **any node (local or cloud)** is delivered by the right agent. **Printing never blocks
  a fire/sale** (outbox). Largely independent of the table-service track; security review before build.
  Spec + plan in `docs/superpowers/{specs,plans}/2026-08-17-printing-subsystem*`. **KDS-4 — kitchen
  printing (Slice B) DESIGNED + PLANNED 2026-08-17** — a `station_printers` many-to-many + **print-on-fire**
  (extends KDS-1's `fireLines`/KDS-2's `fireCourse` to `enqueuePrintJob` — an outbox INSERT, never blocking)
  + a kitchen-ticket ESC/POS formatter; a group printer (`ticket_scope='order'`) gets **one deduped
  consolidated ticket per fire**. Thin layer on the printing subsystem + KDS-1; non-fiscal. Spec + plan in
  `docs/superpowers/{specs,plans}/2026-08-17-kds-4-kitchen-printing*`. The
  **always-on device identity** is **now specced + planned** (see its own row below).
  Non-fiscal (pay/collect unchanged). Spec + plan in
  `docs/superpowers/{specs,plans}/2026-08-17-kds-1*`. **Reworks shipped #63** (`order_prep` + its
  verbs/widget) and **build-blocked on TS-1 + FP-1** (tab firing + the floor read) — execute after both
  land.
- **Bookings (sub-project 17)** — **staff-entered reservations** (date / time / party size / contact,
  optional table assignment) from the dashboard; **no** public/online surface in slice 1. **Bookings-1
  DESIGNED + PLANNED 2026-08-17** — a `bookings` entity (tenant+location, **local date+time** wall-clock
  — a booking is an appointment, not an instant, so it sidesteps the #52 store-as-UTC bug), CRUD + a
  `booked→seated→completed/no_show/cancelled` lifecycle, a `booking.manage`-gated `booking-api.ts`
  (mirroring `purchase.manage` — **no front-of-house role exists**), and a dashboard **day-list** screen.
  Two chosen integrations: **seat opens a TS-1 tab** on the assigned table (links booking↔tab), and
  **reserved-on-floor** ("Reservada HH:MM" via an FP-1 floor-read extension). Contact is **free-text**
  (no customer/CRM entity); no online/QR/availability/reminders (all future). Non-fiscal. Spec + plan in
  `docs/superpowers/{specs,plans}/2026-08-17-bookings-1*`. **Core is buildable independently**; the seat
  + floor features are **build-blocked on TS-1 + FP-1**.
- **Device identity (KDS spin-off, sub-project 12)** — **DESIGNED + PLANNED 2026-08-17**. The **first**
  client device-auth in the tree (today none exists — till boot is unauthenticated, the only wire-token is
  the server-to-server sync Bearer). Lets an **always-on** kitchen screen enrol once (an admin-minted
  **pairing code**, modelled on the WebAuthn-challenge single-use/TTL pattern) and authenticate itself via
  an **httpOnly device cookie** (a scrypt-hashed token, reusing `hashSecret`/`verifySecret` — no new
  crypto), scoped so a device may **only read + bump its bound `kitchen_station`** (no login, no selling).
  A `devices` entity (general `kind`; only `kds_station` wired), a `requireDevice` guard, and a dashboard
  **Devices** screen (generate code · revoke = instant). `device.manage`-gated; **security review before
  build**. Non-fiscal. Spec + plan in `docs/superpowers/{specs,plans}/2026-08-17-device-identity-1*`.
  **Build-blocked on KDS-1** (it binds to a station + drives its display). Other `device_kind`s (trusting
  the till device), auto-rotation, remote wipe = future.

Build order: the **table-service core (TS-1 → TS-5) is specced + planned** (2026-08-17), and **the whole
floor-plan surface (FP-1 operable live floor + FP-2 spatial canvas/editor) is now specced + planned**
too (2026-08-17); TS-1/TS-2 have now landed (#97/#103) so FP-1 is buildable (FP-1 before FP-2). **KDS-1** (stations + routing + the
per-line ticket rework + station display + ready→floor) is **now specced + planned** too (2026-08-17),
build-blocked on TS-1 + FP-1 and reworking shipped #63. **Bookings-1** (staff reservations + seat-opens-a-tab
+ reserved-on-floor) is **now specced + planned** too (2026-08-17); its core is independent, the seat/floor
features build-blocked on TS-1 + FP-1. So **all three surfaces the owner set out to design — floor plan,
KDS, bookings — now have a first slice specced + planned**, plus the **always-on device identity** (a KDS
spin-off) specced + planned too, build-blocked on KDS-1. **KDS-2** (courses + fire control) and **KDS-3**
(expo/pass) are **now specced + planned** too (2026-08-17), build-blocked on KDS-1(/KDS-2). So **the KDS
track's design is complete** (KDS-1/2/3 + device identity). The **kitchen-printers** requirement grew into
a **printing subsystem** (central printers + print agents + a transport-pluggable outbox) plus **KDS-4
kitchen printing** (station→printer routing + print-on-fire) on top, **both now specced + planned**
(2026-08-17); the subsystem is largely independent of the table-service track. Its **customer-receipt +
cash-drawer** consumer is **now specced + planned** too (2026-08-17) — a per-till `receipt_printer_id`, a
per-location `receipt_print_mode` (auto default), an ESC/POS `qr()` addition, a faithful `formatReceipt`
(reproduces every art. 7.1 / arts. 20–21 element — the fiscal record is untouched; it re-renders the filed
receipt), server-side print-on-sale + a cash-drawer kick + an audited manual open; spec + plan in
`docs/superpowers/{specs,plans}/2026-08-17-counter-receipt-drawer-printing*`. The printing **cloud_poll
transport (Star CloudPRNT)** is **now specced + planned** too (2026-08-17) — a poll→fetch→ack endpoint
group served from the central outbox, token-authed, so a NAT'd printer prints jobs enqueued on any node
with no agent (the exact Star contract pinned against the vendor spec at build); `docs/superpowers/{specs,plans}/2026-08-17-printing-cloud-poll-transport*`.
The KDS **expo device kind** (an `expo_pass` device so the pass screen runs always-on, joining KDS-3 to
device-identity) is **now specced + planned** too (2026-08-17;
`docs/superpowers/{specs,plans}/2026-08-17-expo-device-kind*`) — completing the always-on story for both
KDS displays. **Epson Server Direct Print** (the second cloud-poll vendor, mirroring the Star slice behind
a `cloud_poll_vendor` discriminator + shared claim/ack) is **now specced + planned** too (2026-08-17;
`docs/superpowers/{specs,plans}/2026-08-17-printing-epson-server-direct-print*`), completing cloud-poll
vendor coverage. The **`cash.drawer` authorization** slice is **now specced + planned** too (2026-08-17;
`docs/superpowers/{specs,plans}/2026-08-17-cash-drawer-authorization*`) — a configurable per-location
`drawer_open_policy` (`gated` default / `open`) and, crucially, the **first till-side
`authorize()`-with-supervisor-override path** + a **reusable supervisor-override dialog** (which on-till
config — device-identity manager-on-till, FP-2 "Editar plano" — and future till void/refund reuse). **So
the ENTIRE table-service + kitchen + printing surface is now specced + planned, with nothing left to
design.** **TS-1 + TS-2 LANDED (#97 2026-08-18, #103 2026-08-19)** — the table-service foundation (tables +
tabs), configurable service statuses, move / join / merge, and transfer items are built; **TS-3 + TS-4 LANDED
(#119, #124, 2026-08-20)** so **FP-1 (floor plan) is the next non-fiscal buildable slice** (**TS-5 split-bill is
FISCAL — supervised/owner-gated, not autonomous**),
and FP-1 / KDS-1 / the booking integrations now unblock (see the TS-1 row above for the #97 follow-ups and
*Debt* → table service TS-2 for #103's). The printing subsystem can still build independently of the TS
chain. The owner **may be reachable by laptop** during the 2026-08-19 → 25 trip, so this track can also
progress remotely.

---

## Debt and odd jobs

Carried from finished work. None of it blocks anything; all of it makes later work cheaper.

- **CI job-sharding — next lever (from #126).** The `test-light` bottleneck is resolved: #126 split it
  into `test-light-a`/`test-light-b` and pulled `apps/server` (`test-server`) and `packages/fiscal-verifactu`
  (`test-fiscal-verifactu`) into their own multi-fork shards. The critical-path JOBS are now
  **`test-heavy` (`packages/db`, ~275s)** and **`mutation-verifactu` (~218s)** — both CPU-bound on one free
  4-vCPU runner, so the lever is more free runners / sub-sharding, not a bigger (billed) box. To go below
  ~250s: shard/parallelise db's suite, or split `mutation-verifactu`. The two light bins
  (`LIGHT_A_PACKAGES`/`LIGHT_B_PACKAGES` in `scripts/changed-scope.mjs`) are balanced by MEASURED wall-clock,
  which drifts as suites grow — **rebalance when a run shows one shard dominating** (the partition tests
  police coverage, never balance). Minor skipped cleanup: memoise `selects()` in
  `scripts/ci-workflow.test.mjs` (~6-12s on the ungated lint job; pre-existing shape).
- **CI test-tier speedup — shared-container rollout COMPLETE (#112–#123).** DONE: every real-PG package
  now boots ONE shared container per package run (a vitest `globalSetup`) and clones a pre-migrated
  template per suite (`CREATE DATABASE … TEMPLATE`, ~26ms) in place of a per-file container boot+migrate
  (~1.5s). Landed: apps/server (#112/#113), db (#114), payments (#116), fiscal-verifactu (#117),
  workforce (#118), sync (#120), identity (#121), reporting+payments-stripe+core (#122), and the final
  seven — scheduler/recipes/catalogue/credentials/purchasing/layouts/workforce-es (#123). Plan + per-phase steps:
  `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
  - **Adding a NEW real-PG test package? The pattern (don't reinvent):**
    `ProbeRole.inRole` takes `string | readonly string[]` (a multi-membership role like `sync_applier`
    is a plain `roles` entry, no `setup` hook); `cloneTemplate` is **exported** from `lifecycle.ts` and
    validates its own identifiers (§3), so a package that needs a **fresh DB per test** (a
    `describeEachTarget`-style seam) reuses it — `packages/db`'s `harness.ts` `postgresTarget` is the
    reference implementation (clone per test, track, drop all in `teardown()` via `allSettled`);
    `nextCloneName()` mints the shared clone-name; `useTemplateDb` covers the one-clone-per-file case.
    **Template-key naming: `core_<schema>`** (`core_identity` in apps/server, `core_payments` in #116),
    self-describing about what the template migrates — NOT the package name; follow it for the rest.
  - **Fork mode is a per-package call, not a default.** Two distinct reasons force fewer forks, and
    they are NOT the same: (a) the `@vitest/coverage-v8` cross-fork branch-merge bug (below) needs
    `singleFork` where a package runs under `pnpm -r` oversubscription; (b) a shared container is ONE
    cluster on the default 100-connection budget, so a package whose suites open many backends needs
    the concurrency bounded. `packages/db` (#114) hit (b) not (a) — it runs alone and passed coverage
    multi-fork — so it uses `maxForks: 4` (worst-case ~46-50 conns, keeps most of multi-fork's speed)
    rather than serializing; `packages/fiscal-verifactu` (#117) is the SECOND reason-(b) reference — no
    fork config before, multi-fork, dilutes the v8 artifact, so it too caps at `maxForks: 4` for its
    20-writer concurrency suites (worst case ~70-80 under the ~97 effective budget). `packages/payments`
    (#116) is the reason-(a) reference — it kept `singleFork` for the coverage-v8 artifact, and under
    one fork the connection budget is a non-issue (one file at a time), so no `maxForks`. Pick per
    package; document which reason applies.
  - **DONE (#125): stale timeout comments fixed.** #116/#117 `vitest.config.ts` no longer credit
    `hookTimeout` with "a container cold pull paid in a beforeAll" — reworded to the #118 framing (the
    boot is in `globalSetup`, which vitest does not bound by `hookTimeout`; the per-suite `beforeAll` is
    a PGlite WASM boot or a ~26ms clone).
  - **Roles vs `asAppUser`, and what stays per-container.** RLS suites that `connectAs` a probe LOGIN
    role list it in `roles` (a `ProbeRole`; `inRole` takes `string | readonly string[]`; a role shared
    by several suites is created once — the `rls_probe` pattern). Suites that use `asAppUser` (SET ROLE
    to the CORE `app_user` group, copied by `CREATE DATABASE … TEMPLATE`) need NO `roles` at all
    (reporting, core, layouts). Full-manifest packages (sync) use the `manifest` template via the bare
    `runMigrationSets(migrationOptionsFor(manifestSets(), null))` path. Fresh-DB-per-test seams
    (`describeEachTarget`) reuse the exported `cloneTemplate` + `nextCloneName`. **Staying
    per-container/PGlite by design** (never converted): `db` `client`/`migrate`/`testing/postgres` and
    `provisioner-role.migration`, `migrations` `apply.concurrency`, the 3 `provisioning` `*.rls`,
    apps/server `dev-setup`.
  - **DONE (#125): `CLAUDE.md` §3 db-`exports` list fixed** — now lists all entries (`.`,
    `./testing/postgres.js`, `./testing/seed.js`, `./testing/lifecycle.js`,
    `./testing/shared-container.js`) with the reason the last two were added, and NO hardcoded count
    (the count is exactly what went stale).
  - **CI-win MEASURED (2026-08-20, run 32417600304 — the first completed unfiltered post-rollout `main`
    run).** Against the 2026-08-18 pre-rollout baseline (run 32177773446): **`test-heavy` (packages/db)
    406s → 254s, −152s / −37%**; **`test-light` (everything else) 509s → 383s, −126s / −24%**. The
    `test-light` figure is a conservative NET floor — the parallel table-service track (#119/#124) ADDED
    apps/server tests in the same window, offsetting part of the conversion win, plus CI-runner variance;
    `test-heavy` is cleaner (db untouched by that track). Cause is the mechanism: per-file ~1.5s
    boot+migrate → ~26ms `CREATE DATABASE … TEMPLATE` clone.
  - **BONUS (#125): fixed a CI concurrency bug the measurement surfaced.** `ci.yml`'s
    `cancel-in-progress` was unconditionally `true`, so the `docs(backlog)` commit landed to `main`
    after every merge cancelled the code merge's UNFILTERED `main` run mid-`test-light` every time —
    §2's safety net never completed (#123's `6b97612` was cancelled 3m30s in). Now
    `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` (never cancels `main`); still supersedes
    feature-branch/PR runs. Run 32417600304 completing (not cancelled) is the proof.
  - **Do NOT drop `singleFork` where it exists to speed CI — it is load-bearing, not stale.** The
    `@vitest/coverage-v8` cross-fork branch-merge bug is NOT fixed on vitest 3.2.7: it under-merges
    coverage under `pnpm -r` oversubscription (payments **82% branches** in the whole-workspace run,
    100% isolated; the pre-push hook caught it 2026-08-19). An isolated per-package multi-fork run
    passes and proves *nothing* about the concurrent case — the dead end this speedup started from.
    (`packages/db`'s `maxForks: 4` is the *other* lever — connection budget, reason (b) above — and is
    safe there only because that shard runs alone; it is not a licence to drop `singleFork` elsewhere.)
- **Dashboard slice 1a follow-ups (#67, identity auth foundation). None blocking; each deferred with a
  reason during the SDD build / finish-branch / Copilot review chain.**
  - **`totp_secret` is stored PLAINTEXT and `app_user` holds SELECT on `persons`.** A TOTP secret must
    be recoverable to verify (can't be hashed like the PIN/password), so a `persons` leak would expose
    every enrolled second factor. Latent — nothing writes `totp_secret` in 1a. **The enrollment slice
    must encrypt `totp_secret` at rest via the credentials vault (AES-256-GCM), decrypting on the box
    before `verifyTotp`** (keeps the offline-verifiable property). A comment on the column records it.
  - **Deferred (untouched by 1b, which was the HTTP-API layer only — these touch the session internals /
    `authorize.ts`):** stamp `ended_at` when a management session expires (today the idle timeout is
    enforced at read time — matters once a `(tenant_id, person_id) WHERE ended_at IS NULL` open-session
    lookup is added); fold `resolveManagementSession`'s SELECT-then-UPDATE into one `UPDATE … RETURNING`
    (a low-frequency dashboard path, correctness-sensitive — its own TDD'd optimisation); extract a shared
    `assertPermission(role, permission)` and dedup the `not_found→suspended` lookup against the till's
    `verifyPersonCredential` (both touch `authorize.ts`, which 1a/1b deliberately left untouched); add a
    NEGATIVE `WITH CHECK` test (cross-tenant INSERT refusal) to `management-sessions.rls.test.ts` (the
    sibling `sessions.rls` doesn't test it either).
- **Dashboard slice 1b follow-ups (#69, server management API). None blocking; each deferred with a
  reason during the SDD build / simplify / finish-branch / Copilot review chain.**
  - **PATCH `/staff/:id` re-runs authz per field + double-`UPDATE`.** A combined `{role, status}` PATCH
    calls `authorizeManager` (→ `resolveManagementSession` SELECT+UPDATE) twice and issues two
    `UPDATE persons`; authorize once up front + one combined `UPDATE`. Low-frequency admin path — the
    direct analogue of the till-api "consolidate the two per-request transactions" item.
  - **Enum-membership validation gap (by-design typeof-only).** create + PATCH `typeof`-screen `role`/`status`
    but NOT enum membership, so a valid-typed-but-invalid `role:"chef"` reaches the `person_role` pgEnum →
    opaque 500 (and `status:"frozen"` → silent 204). Safe (pgEnum rejects, no corruption/leak) and
    consistent across both routes. A stricter 400 belongs with the validation/tax-module layer, not a
    one-off here.
  - **Malformed (UNPARSEABLE) JSON body → 500 (cross-cutting).** A body that fails `c.req.json()` throws a
    SyntaxError → opaque `server.internal` 500 via `run`, shared verbatim with till-api's `run`. Whether it
    should be 400 is a decision to make across BOTH `run` copies. (The parseable-but-`null`/non-object case
    WAS fixed in #69 → the routes' own 4xx.)
  - **Minors (non-blocking):** the `setPassword` negative test's "password_hash unchanged" re-read runs
    after a rolled-back tx so it can't catch a hypothetical write-before-reject — the load-bearing proof is
    the thrown code + a gate-deletion proof (`setPassword` authorizes before it writes), and the four sibling
    negative tests share the pattern (Copilot, held); `run`'s `?? 400` unmapped-code fallback is honestly
    uncovered (every code a route throws is in `STATUS`) until a future route throws an unmapped one.
- **Dashboard slice 1c follow-ups (#70, dashboard app). None blocking; each deferred with a reason
  during the SDD build / simplify / finish-branch / Copilot review chain.**
  - **Row-edit ACTIONS — DONE (#73).** The staff list's "Editar" now opens a `<dashboard-person-edit>`
    dialog wired to `updatePerson`/`resetPin`/`setPassword` (role / suspend / reactivate / reset-PIN /
    set-password, each committed independently). What #73 deliberately left, all small:
    - **Single-flight silently drops a *different* second action.** The shared `#editing` guard
      serialises all four edit actions, so clicking e.g. "Guardar rol" then "Restablecer PIN" within
      one round-trip drops the second with no feedback (deliberate "one edit mutation at a time"; no
      corruption — the operator just retries). Per-action guarding, or a queued/toast signal, would
      close it.
    - **Secrets linger in the open dialog until close.** PIN/password fields are masked and reset on
      close, but a *successful* action keeps the dialog open (unlike create, which closes on success),
      so the just-set secret stays in its field until the operator closes. Clear-secret-field-on-success
      needs the screen (which knows success) to signal the widget.
    - **Self-lockout is not guarded.** Neither the UI nor the server stops an admin suspending or
      demoting *themselves*; `resolveManagementSession` re-checks status, so they'd be logged out next
      request (recoverable via provisioning, nothing deployed). A UI guard needs the screen to know the
      logged-in `personId`, which it doesn't track yet.
  - **i18n layer DONE (#82).** The dashboard now renders localised copy through
    `apps/dashboard/src/i18n` (mirrors `apps/till/src/i18n`); raw error codes and inline Spanish
    literals are gone from every screen and widget. **Still open, deferred by #82:**
    - a session that expires mid-use surfaces the raw `management_session.required` key with no
      re-login flow — the shell never re-probes (server enforcement is intact; this is UX). This was
      #82's optional stretch, deferred because it touches the shell session state machine.
    - the 14 EU allergen names in `domain.ts` are duplicated verbatim from `apps/till/src/i18n/allergen-names.ts`
      (a deliberate bundle-decoupling mirror — the dashboard can't import `@waitron/catalogue`, and no
      shared browser-safe copy module exists). These are **regulated** names (EU 1169/2011 Annex II),
      so either hoist them to a shared browser-safe module both apps import, or add a drift-guard test
      pinning the two tables equal so a corrected spelling can't diverge unnoticed.
    - `t()` resolves the full locale tag via the `catalogues` alias map (`"es-ES"` → `es`) while
      `codeMessage`/`domain` region-strip by regex; identical for `es-ES` today, but any other `es-*`
      region would render chrome in English and codes/tokens in Spanish. Unreachable until a locale
      switcher calls `setLocale` (never called today); unify the two strategies before one lands.
    - `layout-screen`'s `widgetName` uses an `as StringKey` cast, so a future 7th `WidgetType` added
      without a `widget.*` string key would render an empty label rather than fail typecheck; add a
      parity guard pinning `WidgetType` ↔ `widget.*` keys.
  - **Double `listStaff()` on cold load.** The shell's session probe and the staff screen each fetch the
    roster on a logged-in cold load (the probe discards its result). Thread the probed list down (an
    initial-people property, or lift `people` into the shell) to drop one `/management-api/staff` round
    trip. Real but low-cost for a small admin app.
  - **Create-error renders behind the modal — DONE (#105, 2026-08-19; campaign queue P1).** Mirrored
    #73's edit-dialog fix onto the create form: `person-form` gains a parent-owned `error` property
    rendered in the dialog's own top layer via `codeMessage`, the staff screen passes
    `.error=${formOpen ? errorKey : null}` down, and the page-banner suppression guard tightened from
    `errorKey && !editOpen` to `errorKey && !editOpen && !formOpen`. The stale "known limitation"
    receipts in `staff-screen.ts` and `person-edit.ts` were retired in the same change (§1). TDD, both
    new tests proven by deletion; no migration, non-fiscal (H2 clean); dashboard `test:coverage` green
    (`person-form.ts` & `staff-screen.ts` 100% stmt/line/func). Both finish-branch reviewers + Copilot:
    no findings. The `<select>.value`-before-options picker minor (next bullet) is a SEPARATE item
    (pool P2), untouched here — **now DONE (#106).**
  - **`<select>.value`-before-`<option>`-children picker — DONE (#106, 2026-08-19; campaign pool P2).**
    `login-screen`/`person-form` bound `.value` in-template (rendered right only because the default
    equals the first option — the latent EDIT-a-non-default bug **#73's edit picker avoided** via an
    `updated()` `.value` reconcile); both now mirror #73 (ref + `updated()` reconcile, branchless
    `.value!` since the selects are unconditional), TDD proven by deletion under Chromium. **Sibling
    follow-up** (both finish-branch reviewers flagged, deliberately OUT of P2's "1c minors" scope — a
    separate sweep, not folded in): the same latent `.value`-bound native-`<select>` pattern remains in
    `my-schedule-screen.ts` and `allergen-picker.ts`; and a **different** `.selected=${}` content-attribute
    variant (the approach #73's class doc rejects as unreliable once the select is dirtied) in
    `product-form.ts`/`purchase-form.ts`/`layout-screen.ts`. All pre-existing, separate components,
    likely also latent (each depends on its default equalling the first option — not verified per-site);
    Group A (`my-schedule`/`allergen-picker`) is a straight #73-pattern mirror, Group B (`.selected=`)
    needs the ref+`updated()` conversion + its own tests.
  - **Minors:** no top-level `<main>` landmark in the shell (consistent with `apps/till`; axe
    passes); `staff-list`'s `people` prop-doc still says "the app owns" (harmless imprecision); and
    `apps/dashboard` declared an unused `@waitron/shared` dependency (browser-local by design, never
    imported) — **dropped in #95 (2026-08-18).**
- **Dashboard slice 1d follow-ups (#71, passkeys). None blocking; each deferred with a reason during
  the SDD build / simplify / finish-branch / Copilot review chain.**
  - **Real-ceremony integration test — the biggest gap.** Unit/route tests MOCK `@simplewebauthn`'s
    `verify*`, so they prove OUR wiring (RLS, gating, single-use, counter, suspension) but never the
    crypto. The true end-to-end proof is a Playwright **virtual authenticator** (CDP
    `addVirtualAuthenticator`) driving `@simplewebauthn/browser` against the real
    `@simplewebauthn/server` verify — belongs with the dashboard's browser shard (`test-dashboard`).
  - **`transports` column populated — DONE (#102, 2026-08-18; campaign queue #11).** `finishPasskeyRegistration`
    now stores `credential.transports` (JSON array string via `serializeTransports`, `Array.isArray`-guarded so a
    non-array from the untrusted client → null, proven by deletion), and `beginPasskeyRegistration` feeds it back
    into each `excludeCredentials` descriptor (`parseTransports`) — populate resolved toward populate + consume.
    Auth side left discoverable (no `allowCredentials`). **Deferred follow-up:** the column is `text` + a hand-rolled
    JSON codec; the repo convention for a structured array is `jsonb().$type<T>()` (e.g. `sales.vatBreakdown`), which
    would delete both helpers. Not taken in #102 because it changes the column type → a **new migration** (a
    migration-free Drizzle `customType`-over-`text` variant exists too, cf. `credentials`' `bytea` customType). Do it
    in a slice that can add/regenerate a migration cleanly.
  - **RP-ID / origin required at boot in production — DONE (#107, 2026-08-19; campaign small-item-pool P3).**
    `WAITRON_MANAGEMENT_RP_ID`/`_ORIGIN` defaulted to `localhost` / `http://localhost:5191`
    UNCONDITIONALLY — even in production — so a deploy that forgot them silently bound every passkey
    ceremony to loopback → an opaque 401 at login rather than a loud boot failure. New
    `requiredInProduction(env, variable, environment, devDefault)` helper in `apps/server/src/config.ts`:
    in production an unset OR empty value throws `server.config_missing` (reusing `required`/`isUnset`,
    no new error code); preproduction/dev keeps the loopback default. `environment` resolved once (after
    the DATABASE_URL + TLS checks, so this file's prior boot-fault ordering is preserved). TDD, guard
    proven by deletion; `boot.test.ts`'s 5 production boots carry the vars via `KEY_ENV` (same home as
    the credentials key + till identity). Both finish-branch reviewers clean (2 minors applied:
    ordering-preservation + a §1 comment vocabulary fix); Copilot's one finding (the `it.each` `%o`
    title printed the override object, not the missing var) fixed on both the new and the sibling TLS
    `it.each`, thread resolved. Non-migration, non-fiscal (H2 clean); config.ts 100% cov.
  - **`userVerification` policy pinned — DONE (#104, 2026-08-18; campaign queue #12).** `generate*Options`
    now pin `userVerification: "required"` (registration inside `authenticatorSelection`, keeping the
    library's `residentKey: "preferred"` default — which supplying `authenticatorSelection` at all otherwise
    drops, verified at runtime; authentication via the top-level option), and both `verify*` calls pin
    `requireUserVerification: true` explicitly. So UV is mandatory and signalled up front on a
    phishing-resistant PRIMARY login, not merely the fail-closed verify default
    (@simplewebauthn/server@13.3.2: generate defaults `"preferred"` per generateRegistrationOptions.js:39-40 /
    generateAuthenticationOptions.js:16; verify defaults `true` per verify*.js). Four deletion-proven tests —
    the registration-options one also asserts the `residentKey` re-spec, guarding the discoverable-credential
    regression the finish-branch wide-lens review surfaced. No migration, no fiscal-core touch; the dashboard
    login/staff screens forward the options JSON opaquely, so no client contract change.
  - **Duplicate `credential_id` on the gated register route → 409 — DONE (#108, 2026-08-19; campaign
    small-item-pool P4).** A second registration of the same `(tenant_id, credential_id)` raised `23505`
    → `server.internal` 500. `finishPasskeyRegistration` now catches `isUniqueViolation` (`@waitron/db`)
    on the insert and throws the new `passkey.already_registered` code (domain concept, not the column
    — §3; sibling to `passkey.not_registered`), which `management-api.ts`'s STATUS maps to **409** (the
    house convention for an "already exists" collision — `table.label_taken`, `tab.already_open`,
    `roster.already_published`, `purchase.duplicate` all → 409). The `try/catch` is scoped to the insert;
    the only unique key it can violate is the composite one (`id` is a random-uuid PK), so a bare
    `isUniqueViolation` suffices (no constraint-name check), matching `tables.ts`/`settle-sale.ts`.
    Near-unreachable (route session-gated + `excludeCredentials`), but a non-compliant client can still
    POST one. TDD: PGlite duplicate test + a `23503`-FK negative control (rethrow untranslated) + a
    real-PG RLS route test asserting 409, all proven by deletion. Non-migration, non-fiscal (H2 clean);
    identity 100% cov. Both finish-branch reviewers + Copilot: no findings.
  - **Residual harmless double-session (out of scope, documented).** Two DISTINCT concurrent auth
    ceremonies (different challenge handles) for the same person can each mint a session — both belong to
    the legitimately-authenticated owner, the same race as `loginManager`, no trust boundary crossed. The
    single-use fix (#71) closes the SAME-handle race; this different-handle case is left as harmless.
- **Counter POS follow-ups (sub-project 7, slice 1 / 7a — the walk-up cash sale). None blocking; each
  is a deliberate slice-1 boundary or a small review Minor, deferred rather than dropped.**
  - **TLS termination, LAN binding and serving the built bundle are deployment (#9).** In dev the till
    is served by Vite on loopback over plain HTTP, and the session cookie's `Secure` attribute tracks
    whether the server has TLS configured (`secureCookies: config.tls !== undefined`, `boot.ts`). The
    process is already TLS-**capable** (`tls.ts`, `WAITRON_TLS_*`); what #9 owns is production HTTPS
    with a local-CA trust root, binding to the LAN rather than `127.0.0.1`, and serving the built
    `apps/till` assets (dev runs the Vite server, not a bundle).
  - **Card / Terminal tender.** **Manual (unintegrated) card DONE — landed as #62** (the *datáfono*
    case: card run on a separate terminal, recorded on the till as a `card` tender + a captured
    `payments` row). What remains is the **INTEGRATED** terminal: driving a real reader (Stripe
    Terminal / SumUp) with network capture, the **timed-out-card UX** (retry / alternative tender /
    wait — already noted under the #33 SIF follow-ups), and **tips-on-card** wiring. A separate slice;
    the hardware choice (SumUp Solo vs Stripe Terminal) is itself open, and `packages/payments-stripe`
    already carries the provider adapters.
  - **Bank datáfono (Redsys / TPV-PC) — a SECOND topology, not "the same shape" as the cloud readers
    (investigation, 2026-08-06).** A bank-branded datáfono in Spain almost always routes through
    **Redsys** (the network the major Spanish banks share), so a single Redsys adapter would in
    principle integrate terminals across many banks at once — the strategic upside, and why a bank's
    own terminal is reachable at all. Two caveats to "support Redsys → every bank datáfono works":
    **most, not all** Spanish acquiring runs on Redsys (Comercia/Worldline, Adyen and bank-specific
    stacks exist — an *inference*, not source-confirmed here), and each venue's terminal only
    integrates once its **acquiring bank enables the integrated mode and issues the merchant
    credentials** (merchant code + terminal id + merchant key), so it is contracted per merchant, not
    a blanket unlock. **The engineering catch the deli-hardware design understates:** the integrated
    Redsys product is **"TPV-PC" (TPVpc)**, a **USB-cable-attached local device** — the till software
    talks to a terminal plugged into the counter and the *terminal* holds the line to Redsys. That is
    the OPPOSITE topology to Stripe/SumUp/Square, which our `PaymentProvider` / `provider.collect` seam
    assumes: our *server* makes an HTTPS call out to the processor's *cloud*, which relays to the
    reader. So [the deli-hardware design](superpowers/specs/2026-07-30-deli-hardware-design.md) §8's
    "Adyen or **Redsys** later on the same shape" is optimistic for the USB case — the
    `PaymentProvider` **interface** (collect → outcome-as-data) can stay, but the **implementation** is
    a local-device driver that must run **till-side** (where the cable is), not on `apps/server`, a
    local agent/bridge no cloud adapter needs. And unlike Stripe/SumUp, TPV-PC's integration spec is
    obtained **from the acquiring bank on request** (not openly published); real integrations go
    through prebuilt connectors (Odoo/Sage/QFgest each ship a TPVpc module). Integrated datáfonos *can*
    also connect over the **local network (ethernet/wifi)**; the classic Redsys TPV-PC these sources
    describe is **USB**, matching an in-person sighting of one wired to a till. **Not scoped** — its
    own investigation/spec if pursued, *after* the Stripe integrated slice; the Stripe/SumUp cloud
    readers stay the first vendors. Sources (read 2026-08-06): TPV-PC connects by USB, amount pushed
    automatically, results/refunds return to the POS —
    [Odoo `edyma_pos_dataphone`](https://apps.odoo.com/apps/modules/18.0/edyma_pos_dataphone) and
    [tpvnorte "cómo conectar el datáfono al TPV"](https://tpvnorte.com/tpv/como-conectar-el-datafono-al-tpv/)
    (cable USB/serial vs. local-network vs. software-integrated); module integration —
    [QFgest TPV-PC](https://www.qfgest.net/product/modulo-de-integracion-con-tpv-pc-de-redsys/) and
    [Sage 50 TPVpc](https://communityhub.sage.com/es/sage-50/f/discusion-general/225898/configurar-tpvpc-redsys-pinpads);
    Redsys network / Android POS / TPV-Virtual —
    [redsys.es products](https://redsys.es/en/products-and-services).
  - **Offline-first store-and-forward.** The till needs the server reachable; there is no local queue
    that rings while disconnected and forwards later. It belongs with the app-level sync subsystem
    (the `sync_log` design), not the till alone.
  - **Scale + printer hardware.** No electronic-scale weight capture (the weighed quantity is typed),
    no receipt-printer or cash-drawer drivers. When the printed ticket lands, its print stylesheet
    must size the **Veri\*Factu QR at 30–40 mm** per **art. 21.1** — recorded here so the print slice
    does not rediscover the size rule (confirm the exact instrument/article against primary source
    before it ships).
  - **Refunds / voids / corrections UI.** The fiscal backends exist (`recordVoid` / `recordCorrection`,
    authorization-gated by Identity #58), but the till has no operator surface to trigger a refund,
    void or R5 rectificativa. Lands with Identity's human-facing call sites (see *Identity follow-ups*).
  - **The layout & receipt editors + per-widget config.** The counter screen is layout-driven from a
    `LayoutDef` and every placed widget already carries a `config: Record<string, unknown>` bag
    (`apps/till/src/layout.ts`), but slice 1 ships a fixed layout with **empty** config bags and
    nothing reads them — the editor that authors layouts and the per-widget config it would write are
    a later slice. The seam is present but unread.
  - **One till per server.** `boot.ts` resolves a single `WAITRON_TILL_*` identity; multiple tills
    served by one server (and the roster/session model that implies) is later.
  - **Small review Minors (none blocking):**
    - **Normalize the real-Postgres test filename.** `apps/server/src/till-api.realpg.test.ts` uses a
      one-off `.realpg.test.ts` suffix where the package's other container suites are `*.rls.test.ts`
      (`pass.rls`, `webhook.rls`); rename for consistency (it is not a `.preprod` suite, which
      `vitest.config.ts` excludes).
    - **`#boot` has no `catch` → unhandled rejection — DONE (#110, 2026-08-19; campaign small-item-pool P8).**
      `till-app.ts`'s `firstUpdated` fired `void this.#boot()`, and `#boot` `await`ed `this.api.getTill()`
      with no `try/catch`, so a server unreachable at boot surfaced as an unhandled promise rejection and the
      till sat on the lock screen with no explanation. `#boot`'s body is now wrapped in a `catch` surfacing a
      new `boot.error` banner (the `errorKey` pattern every other handler uses), copy honest that recovery is
      a page reload since `#boot` runs once with no in-UI retry; TDD in real headless Chromium, proven by
      deletion. Copilot broadened the comment + copy to cover a non-2xx `{ code }` error. **Deferred follow-up
      (owner design call):** if the server is down at boot and then *recovers* before login, `#onLoggedIn`
      clears the banner and shows the counter on **default** config (`orderFlow: "prepay"`, blank issuer,
      es-ES receipt) — display/flow only, the server still files the correct fiscal record regardless of the
      client's display config; `#onLoggedIn`'s own unguarded `listProducts()` await is a sibling of the same
      class. Gating login on a failed boot until a reload would be the enhancement.
    - **Basket remove control is below the touch target.** The per-line remove button renders at
      `size="sm"` (`apps/till/src/widgets/basket.ts:101`), under the 44 px minimum a touch POS wants —
      bump it for finger use.
    - **Add a basket drift-guard regression test for a rounding-sensitive weighed line.** The store's
      running-total / drift guard lacks a regression test pinning a weighed line whose gross rounds in
      a way that could drift the displayed total from the authoritative re-price.
  - **Whole-branch review deferrals (surfaced by the pre-merge review; none blocking):**
    - **Return priced lines from `POST /api/sales` so the receipt is server-authoritative.** The ticket
      computes each per-line gross CLIENT-side from the login-time `TillProduct.unitPrice` (`lineGross`),
      because the sale response carries only `total` + `vatBreakdown`, no per-line amounts. In slice 1
      the catalogue is fixed at provisioning and cannot change mid-session, so Σ(line grosses) equals the
      server `total`; a future mid-session price edit would break that identity. Have `recordTillSale`
      return priced lines and render those instead (see the LINE-GROSS SOURCE note in
      `till-ticket-view.ts`). **Partly addressed in 7b (#61):** the idempotent-**replay** ticket is now
      server-authoritative — `FiscalBackend.filedReceiptFor` returns the filed QR + difference-method
      breakdown read back from the registro; the **first-file** ticket still computes per-line gross
      client-side, so this remains for the normal path.
    - **Consolidate the two per-request transactions** on `GET /api/products` and `POST /api/sales`.
      Each currently runs the `requireSession` session lookup in one `withTenant` transaction and the
      work in a second (`recordTillSale` opens its own), so a request pays two round-trips where one
      would do. Efficiency only (flagged in simplify); the `POST /api/sales` half needs `recordTillSale`'s
      transaction boundary reshaped so the caller can supply the already-open tx.
    - **Operator-UI money/locale is hardcoded es-ES.** `formatMoney` in the operator widgets formats in
      es-ES unconditionally — correct for slice 1's single-locale deli, but it must follow the operator
      UI locale once a locale switcher exists. (The RECEIPT is already locale-correct: it formats in the
      independent `invoiceLocale` from `GET /api/till`.)
- **Counter POS follow-ups (sub-project 7, slice 2 / 7b — park & retrieve, merged #61). None blocking;
  surfaced by the 14-task / whole-branch / simplify / two-lens / Copilot review chain and left
  deliberately.**
  - **Park idempotency + re-hold routing — DONE (#101).** Two coupled fixes landed together: (1) `parkOrder`
    now catches the valid-id `23505` and **replays** the existing open order's `{ id, orderNumber }` (mirroring
    `payWorkingOrder`'s backstop) instead of an opaque 500; (2) making park idempotent turned the
    retrieve → edit → **re-hold** path from a loud `held.park_error` into SILENT edit-discard (both
    finish-branch reviewers flagged it), so the Hold handler (`#onParkOrder`) now routes a persisted
    (retrieved) order through `#syncIfDirty`/`updateWorkingOrder` — the pending **P6** re-hold item, landed
    here because #9 is what made it urgent. A blank Hold field preserves the stored label (a P6-review catch).
    No migration, no fiscal-core change (H2 clean); see *Recently shipped* → #101.
  - **Hold on an order settled/placed on ANOTHER till clears with no banner (MINOR, deferred from #101).**
    `#syncIfDirty` swallows `working_order.not_open`, so a retrieved-and-edited order that another till
    settled/placed makes the re-hold clear the basket with no notice (the held list self-corrects via
    `#refreshHeldOrders`; matches the pay/place swallow, loses no recoverable data). A distinct `held.stale`
    notice for parity with the place path's `place.error` is a possible follow-up.
  - **The by-id held-order lookups are node-scoped — DONE (#109, 2026-08-19; campaign small-item-pool P7).**
    `getHeldOrder` / `updateHeldOrder` / `abandonHeldOrder` filtered by id + tenant only (RLS), not
    `node_id` — only `listHeldOrders` was node-scoped. All three now add `eq(workingOrders.nodeId,
    cfg.nodeId)` to their WHERE / FOR-UPDATE / conditional-UPDATE predicate, so a same-tenant order on
    another node fails closed (`working_order.not_found` for get, `working_order.not_open` for
    update/abandon), matching the held list; cross-till on the SAME node is unaffected (node scope keys on
    `node_id`, not `till_id`). TDD: 3 PGlite deletion-proofs + 1 real-PG RLS test; the stale "not
    node-scoped" receipts retired across the three docstrings, the `errors.ts` not_found/not_open notes,
    and the three route comments (§1). No migration, no fiscal-core change (H2 clean). See *Recently
    shipped* → #109.
  - **The fiscal-filing by-id order paths still lock by id alone (deferred follow-up, surfaced by #109's wide-lens review).**
    `placeOrder` / `payWorkingOrder` / `collectOrder` / `cancelPlacedOrder` / `sendToPrep` / `advancePrep`
    lock by `eq(workingOrders.id, id)` with no `node_id` predicate. Pre-existing and NOT reachable via the
    current node-scoped APIs (a client cannot obtain a foreign-node id — both the list and the by-id get
    are node-scoped, and RLS confines to the tenant). Node-scoping the Mode-I `placeOrder` touches the
    **fiscal core** (it files a deferred `recordSale` at placing) → an OWNER call for a future replicated /
    multi-node world, not autonomous work. (Distinct from the parked, owner-flagged **P5** placeOrder
    idempotent-replay question in the campaign's `questions.md`.)
  - **A non-UUID working-order id → opaque 500 instead of 4xx — DONE (#99).** The `:id` routes, `POST
    /api/sales`'s `workingOrderId`, and (surfaced by the #99 reviews as identical-exposure siblings)
    `POST /api/pay`'s `id` and `POST /api/working-orders` (park)'s `id` all passed a client string into a
    `uuid` column → `22P02` → 500. All six now screen with `isUuid()` at the boundary (`requireUuidId` for
    the `:id` routes; the reused shared `requireUuidParam` → `shared.invalid_id` 400 for the body ids). No
    migration, no fiscal-core change; see *Recently shipped* → #99.
  - **Small tidies:** the walk-up concurrency test omits the `Set(pids).size===2` distinct-backend
    assertion the parked test carries; `till-api.ts` re-declares the park/update request-body shapes inline
    instead of reusing the exported `ParkOrderRequest` / `UpdateHeldOrderRequest`; `client.ts`'s
    `parkOrder` return type is an inline anonymous object rather than a named interface.
  - **Operator-UI money/locale still hardcoded es-ES** (carried from 7a, unchanged by 7b — the operator
    widgets' `formatMoney` is es-ES; the receipt is already locale-correct via `invoiceLocale`).
- **Counter POS follow-ups (sub-project 7, slice 7c — prepare & collect + line-add snapshot, merged #63). None
  blocking; surfaced by the 11-task / whole-branch / fix-wave / 4-lens-simplify / final-fresh-context review chain
  and left deliberately.**
  - **`ticket_then_pay` / `invoice_first` send-to-prep + cancel-placed have NO till UI control.** `sendToPrep` /
    `advancePrep` / `cancelPlacedOrder` and their `/api/working-orders/:id/...` routes are built, tested and
    spec'd, but no counter-screen button *sends* a placed order to prep or cancels it outside the prep-queue
    widget's own advance flow. Wire the placed-order controls. Surfaced by the whole-branch review
    (built-but-uncalled server verbs).
  - **The receipt shows a weighed line's filed quantity without its unit of measure** — `0.32`, not `0.320 kg`.
    The filed `sale_lines.quantity` is correct; only the till's receipt rendering drops the `pricing_unit`. Carry
    the unit through to the receipt line. Surfaced by the fresh-context review.
  - **`placeOrder` is not idempotent-replay-symmetric with `payWorkingOrder`.** A re-sent place on an
    already-`placed` order throws `order.not_open` (caught and swallowed only on the edited-retrieved-basket
    re-sync path), where `payWorkingOrder` replays a settled order cleanly. No fiscal effect (placing files
    nothing in `ticket_then_pay`/`invoice_first`, and prepay issuance is guarded by the sale-idempotency UNIQUE),
    but the asymmetry is a latent 500 on a lost-response place retry. Make place catch its own `not_open` and
    replay the existing placed order.
  - **DRY / efficiency defers (from the 4-lens simplify, judged out-of-scope for the merge; all cosmetic, none
    change behaviour):** `appendOrderAmendment` re-locks the order where a `lock-already-held` skip flag would
    avoid a redundant `SELECT … FOR UPDATE` inside `placeOrder`; `collectOrder` reads the sale row twice (branch
    on flow, then build the receipt); the `lockOrderExpecting(state)` guard is inlined at three call sites and
    wants extracting; the till's tender-pay button + `lineName`/`productName` rendering duplicate across
    cash/card/place; `trimQuantity` is copy-pasted rather than shared; the prep-queue widget CSS duplicates the
    basket widget's; and `#layoutFor` reallocates its layout object per render.
- **Counter POS follow-ups (sub-project 7, the integrated card terminal, merged #64). None blocking; all
  fiscally safe; surfaced by the 10-task / whole-branch / 4-lens-simplify / Copilot review chain and left
  deliberately.**
  - **Normalise the P3 lock order (a fiscally-safe recover-vs-collect deadlock).** In a narrow lost-T2 retry
    window a retry routes to `finalizeRecovery`/`finalizeSettleRecovery` (which take `working_orders FOR UPDATE`
    then the chain-head lock) while the original is still in `finalizeCapture`/`finalizeSettle` (chain-head lock
    first, `working_orders` last) — a lock-order inversion that can `40P01` deadlock. **Fiscally safe**: the
    deadlock aborts one tx atomically; `40P01` is neither a unique nor an `already_settled` violation so it maps to
    `server.internal` 500, the till retries, P1 sees `settled` and replays cleanly — no double-charge (Stripe
    `wo_` key), no double-file (`sales_working_order_id_key`), no orphan. UNVERIFIED (reasoned from the lock
    acquisition order, not reproduced in a container). Fix: normalise all four P3 paths to `SELECT working_orders
    FOR UPDATE` first + a settled-recheck-replay (matching `finalizeRecovery`/`collectOrder`); this also lets the
    `finalizeCapture` "only serialisation" comment drop its caveat.
  - **Void pre-check before the network collect (invoice-first).** `readOutstandingSaleForOrder` does not exclude a
    *voided* sale (mirrors the pre-existing `collectOrder` non-exclusion), so a voided-while-`placed` invoice-first
    order routes to `settle` → **P2 charges the card** → `finalizeSettle`'s `settleSale` throws `sale.voided` → an
    orphaned captured payment (reconcile's class; no wrong fiscal record). Fails safe, but — unlike `collectOrder`,
    which never networks — the integrated path takes the money *before* refusing. Fix: a void pre-check in P1
    **before** P2 `collect`. (Shared with `collectOrder`'s own non-exclusion.)
  - **Unify the four `finalize*` functions.** `finalizeCapture`/`finalizeRecovery`/`finalizeSettle`/
    `finalizeSettleRecovery` duplicate the record/settle + associate + transition + ticket-readback shape
    near-verbatim (and duplicate `fileImmediateSale` + `collectOrder`'s invoice-first block). Deferred from the
    4-lens simplify **deliberately** — it is the unrecoverable fiscal core, so it wants a dedicated TDD'd +
    reviewed refactor, not a finish-branch edit. Deeper form: two shared helpers ("file a new sale" / "settle an
    existing sale") parameterised on the tender + the payment-linking strategy.
  - **DRY / test-coverage defers (cosmetic / non-blocking, from simplify + the whole-branch review):** merge P1's
    two sequential SELECTs (`readOutstandingSaleForOrder` + `findCapturedPaymentForWorkingOrder`, different tables,
    same key) into one round trip on the park/place-and-pay path; factor `tender-pay`'s `#renderIdleCollect`/
    `#renderIdlePay` shared fragment (pre-existing 7c, deepened); add a `stripe_on_device`
    different-WO→different-key test (task-1 minor); add a WT002/aborted-tx interleaving test for `finalizeSettle`'s
    outside-catch (F2); add a corrected-invoice-first (`corrections > 0`) `amountDue` test (F3 — the arithmetic is
    correct-by-construction, only the coverage is missing).
- **Counter POS follow-ups (sub-project 7, the layout & receipt editors, merged #81). None blocking; all
  fiscally safe; surfaced by the finish-branch simplify + 2-lens review + Copilot chain and left deliberately.**
  - **Malformed-JSON body → 500 across the whole management-api surface (Copilot, verified pre-existing).**
    Every management-api write route reads `(await c.req.json<…>()) ?? {}` with no catch for a *parse*
    failure — login (`:169`, from #71), person set-password/create/update, reset-pin, set-password, passkey
    enrol, and the two new layout/receipt routes all share it — so an **empty or malformed JSON body** throws
    before `?? {}` and the error boundary maps the non-`AppError` to `server.internal` (500) rather than
    `400 management.request_invalid`. **Not introduced by #81** (the two new routes follow the file's
    convention); low severity (only a hostile/broken client sends malformed JSON — the dashboard editors
    always send well-formed bodies; no data or security impact). Proper fix is **one shared catch**
    (boundary-level, or a `readJsonBody` helper) applied across the whole surface (management-api + till-api),
    not a partial fix to two routes that would make them diverge from their siblings — hence out of #81's scope.
  - **`isDefaultLayout` compares by `JSON.stringify` (Copilot; not a defect today, but brittle).** The
    till classifies a received layout as "the built-in default" (→ apply the Mode-P prep-queue drop) by
    serialised equality against `LAYOUT_A`. A genuine default never round-trips through jsonb (`getLayout`
    returns the JS constant `DEFAULT_LAYOUT` for a no-row tenant, `store.ts:43-44`), so it always compares
    equal; the only jsonb-sourced values are *authored* rows, which render verbatim by design regardless of
    value — the residual authored-equal-to-default case costs only the cosmetic prep-queue drop, never a
    fiscal element (documented `till-app.ts:52-64`). The brittleness is the cross-package literal coupling
    (`LAYOUT_A` vs `DEFAULT_LAYOUT` must stay byte-identical). Deeper form (if the editor grows): have the
    server send an explicit `authored: boolean` on the till boot payload so the till stops re-deriving it by
    value — a `/api/till` wire-contract change, deferred out of slice 1.
  - **Quality defers from the 4-lens simplify (cosmetic, non-blocking):** ~~hoist a single `codeOf(error)`
    helper~~ **DONE (#96, 2026-08-18)** — `codeOf(error, fallback?)` now lives in `i18n/codes.ts` beside
    `codeMessage` (single-sourcing the code→i18n seam), replacing 4 local copies + 21 inline sites; make the
    `WIDGET_CONFIG` entry a *descriptor* (`{kind, min, max, label}`) so
    the dashboard editor is driven from the registry instead of hardcoding `columns` in ~4 parallel spots —
    right-altitude only once a **second** config key exists (today it's one key); drop the derivable `region`
    field from the layout editor's in-memory rows (it is re-stamped from the column on save) once an
    editor-only row type is worth introducing.
- **Catalogue follow-ups (sub-project 7/18 seed, `feat/catalogue-model`). None blocking; deferred by
  the slice's headless YAGNI boundary (design §9) or surfaced by its whole-branch review.**
  - **`products.catalogue_id`/`category_id` are single-column FKs**, so a product could reference
    *another tenant's* catalogue — the referenced tenant is not RLS-checked at FK validation (the
    product's own `tenant_id` is). Brief-specified, and RLS + the app only ever supplying own-tenant
    ids is the primary defence, so **no wrong fiscal filing is reachable** (the sale is filed under the
    operating tenant; `listAvailableProducts` joins stay within RLS scope). But it **deviates from the
    codebase's own convention** — `sale_lines`/`working_order_lines` use composite `(tenant_id, id)`
    FKs precisely so a line cannot point at another tenant's row independently of RLS. Cheap
    belt-and-suspenders in pre-production: a `UNIQUE(tenant_id, id)` on `catalogues`/`categories` +
    composite FKs from `products`. Flagged by the base-to-tip review; non-blocking.
  - **Difference-method rounding — AEAT acceptance CLOSED on primary source (FAQ §20, 4 Dec 2025);
    one residual + configurability remain.** The AEAT developer FAQ documents the only `ImporteTotal`
    validation: `ImporteTotal == Σ(BaseImponible + CuotaRepercutida + CuotaRecargoEquivalencia)` with a
    **±10.00 € tolerance** and a **warning, not a rejection** (= `verifactu/src/validate.ts`'s
    `TOTAL_TOLERANCE = 10`). The difference method makes that identity hold **exactly**, and the FAQ
    itself describes no `CuotaRepercutida == base×rate` check. **Now fully CLOSED on primary source:**
    the companion `Validaciones_Errores_Veri-Factu.pdf` (v1.2.2 §15.7) *does* validate per-line
    `CuotaRepercutida = base × rate`, but with a **±10,00 € tolerance**, *aviso not rechazo* (§16/§17
    likewise). The difference-method deviation is *céntimos* — three orders of magnitude inside a
    ten-euro tolerance — so it passes all three validations trivially, and the rounding *locus* is
    **fiscally irrelevant for acceptance**. No asesor needed; recorded in
    `docs/compliance/verifactu-faq-notes.md` §20. (§15.8 also caps an F2 ticket at Σ(base+cuota) ≤
    3.000 € — a till/#7 concern.) **Remaining is only configurability:** price basis, rounding *locus*
    (line-item vs tax-group), and precision are a
    **tax-module property** — the #57 `resolveFiscalModules`/`nodes.tax_module` seam — so a non-ES
    regime (IGIC/IPSI, other country) carries its own rules; this slice hardcodes ES-común/IVA as the
    first piece of that module. The rounding *mode* (half-away-from-zero = *redondeo al alza*) stays
    fixed in `@waitron/shared` until an authority needs banker's (YAGNI). Spec §8 records both.
  - **RLS test hardening (finish-branch review, low risk).** `operations.rls.test.ts` proves
    cross-tenant isolation by deletion on `catalogues` and `products` but not `categories` (the 0027
    policy is byte-identical), and `assignCatalogueToLocation` is exercised only under PGlite
    (superuser) — safe because `app_user` holds UPDATE on `locations` (0001), but not proven under the
    non-superuser probe. Add a `categories` isolation assertion and a real-PG `assignCatalogueToLocation`.
  - **Category analytics splits on rename.** The sale line snapshots the category *name*, so renaming
    a category splits one analytics bucket across the rename in roll-ups (inherent to snapshotting a
    label; a stable snapshotted code/id would avoid it). A design-acknowledged tradeoff, surfaces only
    when category-based reports land (deferred with reporting).
  - **Deferred by design (§9), each attaches when its consumer exists:** the management **HTTP +
    dashboard UI LANDED (#78)** — the write API + authoring screens (a management **CLI** is still
    unbuilt); catalogue **sync** — the `catalogues.version` column is the seam, present but not
    bumped — and per-location price/availability overrides (→ sync slice); allergens/variants/recipes
    (→ #18); scale hardware, weight-entry UI, barcode (→ a later till slice); category-based **reports**
    (the snapshot lands now; GROUP-BY comes with reporting); the `catalogue.manage` **permission
    enforcement** — #78 gates every catalogue write on `person.manage` through ONE named constant
    `CATALOGUE_WRITE_PERMISSION`, so realising `catalogue.manage` is now a one-constant swap (→ with the
    till's call sites, like the discount seam).
  - **#78 catalogue-management-UI Slice-2 + review follow-ups (none blocking; deferred by design §8 or
    surfaced by the whole-branch review).**
    - **Richer editing (Slice 2):** catalogue/category **rename + deactivate** UX, product
      deactivate/reactivate polish, and **multi-locale description seeding** from the tenant's
      configured locales (the form defaults to `["es"]`; the dashboard has no venue-locale fetch yet).
    - **`catalogue.not_found`/`category.not_found` pre-checks + cross-tenant-FK hardening.** A
      well-formed-but-foreign/absent `catalogueId`/`categoryId` on `POST /management-api/products`
      currently reaches the single-column FK and raises PG `23503` → an **opaque 500** (a recorded
      design decision, §4 — the dashboard only posts ids it just listed). Adding the domain codes +
      the composite-FK hardening above closes it as a clean 400.
    - **Orphaned-image GC.** Slice 1 never deletes image files (consistent with "products are
      deactivated, never deleted"), so a replaced/removed product's `<sha256>.<ext>` file lingers on
      disk. Refcounted cleanup is a later concern; the disk-growth tradeoff is on record (design §5b).
    - **Till-side image rendering.** #78 deliberately did NOT add `image` to `AvailableProduct` /
      `listAvailableProducts` (the implementer found `till-api.test.ts` pins that shape with
      `toEqual`); exposing the field + rendering the photo at the till is its own slice.
    - **Single-source the accepted image-extension set.** `{jpg,png,webp}` is expressed independently
      in `packages/catalogue/src/media.ts` (the mint side — `sniffImageType` decides the stored ext)
      and in `apps/server/src/media-api.ts` (`MEDIA_FILENAME` regex + the `CONTENT_TYPE` map, the serve
      side), with no shared constant. Adding a format to the sniffer without updating the serve regex
      would let an upload succeed and then **404 forever on serve** — a latent, one-directional drift.
      Fix: a shared `{ext→mime}` source both consume, or a guard test pinning them equal. (Surfaced by
      the finish-branch altitude review; guarded today only by the two lists coinciding.)
    - **Browser-safe shared allergen-code constant.** The dashboard redefines `ALLERGEN_DISPLAY_ORDER`
      locally (it has **zero** `@waitron/catalogue` coupling by design — stricter than the till, which
      type-imports `AllergenCode`), so unlike the till it has no compile/test guard pinning it to the
      canonical EU-14 list. A browser-safe shared allergen-code const (importable without dragging the
      `@waitron/catalogue` barrel + `@waitron/db` into the bundle) would let both apps pin their local
      display order. (Declined in-slice to avoid adding the coupling; EU-14 is legally fixed and a typo
      is caught server-side by `validateAllergens`, so low-urgency.)
- **Locations follow-ups (sub-project 6, merged as #57, 2026-08-04). None
  blocking; all deferred by the slice's YAGNI boundary (design §8) or inherited from #33.**
  - **The #33 SIF-topology deferrals stand.** The slice is single-node-per-location, one `venue`
    invocation per shop. Still deferred: **active-active, failover, two concurrent SIFs + disjoint
    series, and the relocatable submitter**; **update / rename / deactivate** of any entity (tenant,
    location, till, node, series — the flow only inserts-and-reuses); and **multiple locations created in
    one invocation**.
  - **A full IGIC/IPSI tax module is unbuilt.** común is IVA, so only `{ filing: "verifactu", tax: "iva" }`
    is wired; `resolveFiscalModules` refuses every other territory (`fiscal.regime_not_implemented`) and
    the `nodes.tax_module` column + the `tax` seam are there for a later module, but no IGIC/IPSI tax
    computation exists.
  - **Cross-country establishments are out of scope.** The slice assumes a location sits in the tenant's
    country; a location registered in a different country than the tenant (design §8) is unbuilt.
  - **`WAITRON_ID_SISTEMA = "W1"` is a PLACEHOLDER** (`packages/provisioning/src/fiscal-modules.ts:46`).
    It is Waitron's own AEAT-registered software identifier (≤ 2 chars, FAQ §4) and reaches every filed
    registro via `registro_sif.id_sistema_informatico`; the real registered value **must be set before
    any live filing**. `"W1"` compiles and is length-valid, so nothing fails until a real filing — it
    will not surface on its own.
  - **The `id_sistema` length rule and its error code are duplicated across two packages — converge
    before drift.** The ≤ 2-char check lives in three places: `packages/verifactu`'s `validate` rule
    `ID_SISTEMA_LENGTH` (no production caller), `apps/server/src/provision-till.ts`'s
    `ID_SISTEMA_MAX_LENGTH = 2` + `assertUsableIdSistema` (throwing `sif.id_sistema_invalid`), and
    `@waitron/provisioning`'s `assertUsableIdSistema` (throwing `provisioning.id_sistema_invalid`). The
    two error codes are a **deliberate** duplication today — `apps/server` cannot import
    `@waitron/provisioning`'s registry, so it re-declares the code with the identical
    `{ value, maxLength }` shape (`packages/provisioning/src/errors.ts` documents why). Now that both the
    standalone `provisionNode` path (`provision-till.ts`) and the `venue` CLI register a node's SIF, the
    two length rules and the two codes should converge onto one home — folded in when `provision-till.ts`
    is renamed to the deferred first-class `provision node` subcommand. Non-blocking, but error codes are
    **never renamed once shipped** (`CLAUDE.md` §3), so settle it before a real filing exists.
  - **Three code-quality cleanups surfaced by the #57 finish-branch review, none applied (all
    non-blocking).** (1) `applyVenue`'s `registerSifForNode` re-reads the tenant's `tax_id` with a
    `SELECT` although the value is already in scope from the `ensure-tenant` action — kept
    **deliberately** as the "read the obligado's NIF from the authoritative tenant row, never an
    argument" fiscal-safety pattern `provisionNode` uses; dropping the read is an optional
    micro-optimisation, not a bug. (2) The plan-summary + confirm block is duplicated between
    `instance()` and `venue()` in `packages/provisioning/src/cli.ts` — a `printPlanAndConfirm` helper
    would dedup it, deferred to avoid churning the pre-existing, separately-tested `instance` command.
    (3) The identical `VenueRequest` is hand-built across four `packages/provisioning/src/*.test.ts`
    files — a shared `venueRequest()` builder in `packages/provisioning/src/testing/` would dedup it.
- **Identity follow-ups (sub-project 5, headless first slice merged as #58). None blocking;
  all deferred by the slice's headless boundary (spec §13) or surfaced by its reviews.**
  - **Mid-shift operator suspension is not enforced on the operator path.** `authorize()`'s
    operator-holds branch (`packages/identity/src/authorize.ts:39-49`) grants on the session
    person's **role alone** and never re-reads `persons.status`, so a manager suspended mid-shift
    while holding an OPEN session can still self-authorize voids/refunds. Spec-faithful (§13 defers
    session lifecycle to #7; suspension today means "refuse login", enforced on `loginWithPin` and on
    the override path — `authorize.ts:60`) and not exploitable in the headless slice, which has no
    long-lived till sessions yet. Revisit with #7's session-lifecycle / mid-shift-revocation policy.
  - **PIN-only supervisor override** (type a PIN, resolve the person) is a #7 UX nicety. The override
    currently takes `{ personId, pin }` because a salted PIN cannot be uniquely looked up by value.
  - **The discount gate** has no write path yet: `sale.discount` is in the permission catalog
    (`packages/identity/src/permissions.ts:10`) but nothing applies a discount until #7 builds
    sale-entry. It attaches when that call site exists.
  - **Enforcement of `sales.operator_id` / `payment_refunds.authorized_by`** (must-be-logged-in to
    ring; till refunds must be authorized) is seams only — the columns and the optional attribution
    exist, but no human call site gates on them yet. Lands with #7's call sites.
  - **Consolidate workforce's `approveCorrection` gate onto `authorize()`.** It still throws the
    shipped `correction.not_permitted` code (`packages/workforce/src/clocking.ts:255`) — **never
    renamed once shipped** (`CLAUDE.md` §3) — so fold it in only when a `workforce.correction.approve`
    permission can be added **beside** the old code, not in place of it.
  - **Branded `PersonId` / `SessionId` in `@waitron/shared`.** This slice uses plain `string` for both;
    branding them is optional consistency with the repo's other branded ids.
  - **`seed-admin` provisioning edges (surfaced by the finish-branch reviews; both non-blocking).**
    (1) A tenant whose sole seeded admin is later **suspended** cannot be re-seeded by re-running
    `waitron-provision venue` — the `where not exists (… role='admin')` idempotency counts a suspended
    admin as present, and no active session could `person.manage` to reactivate it, so recovery is a
    privileged DB action. Inherent to suspend-not-delete + one-seeded-admin. (2) Two concurrent
    `applyVenue` runs for the same tenant could each pass `where not exists` under READ COMMITTED and
    insert two admins (no unique constraint enforces one) — realistic risk ~nil (provisioning is a
    serial operator CLI action), consequence a spare non-fiscal admin row.
- **Purchase invoices / modelo 303 deducible follow-ups (#91).** **⚠️ TWO PRE-FILING CAVEATS a human
  must clear before the first LIVE 303 filing (operational, not code):** (a) **validate the generated
  DR303 file once against the real AEAT sede "por fichero" uploader** — Waitron emits común + página 1 +
  página 3 and OMITS página 2 (régimen simplificado, out of scope), and we cannot verify from here that
  the uploader accepts a página-2-omitted file (documented in `dr303.ts`'s header); (b) **an
  asesor-fiscal must confirm the prorrata treatment** — `computeInputVat` emits the deducible *base* in
  full and scales only the *cuota* by `deductible_proportion`; confirm AEAT expects the base unscaled
  (spec §9 seam). **Deferred build slices** (each its own): **rectificativas de facturas recibidas**
  (casilla 40/41 — the schema needs a `corrects_purchase_invoice_id` self-FK, and `validateLines` +
  the app-layer non-negative check must relax to allow credit-note negatives; NO DB CHECK forbids them,
  by design); **bienes-de-inversión regularización** (43); the **prorrata rule** that sets
  `deducible_proportion` (44) — asesor-driven; **intra-community/import boxes**
  (32–39); *(the purchase-invoice **authoring UI LANDED #93** — a `purchase.manage`-gated dashboard
  create/edit/list surface with a VAT-desglose sub-editor, so the module is no longer headless-only)*;
  *(**quarterly/annual periods + the DR303 download route LANDED #98** — a `LiquidationPeriod` union,
  a period-aware `toDr303Record` (annual refused = modelo 390), and a `report.export`-gated
  `GET /management-api/reports/modelo-303` route; the quarterly período stays cross-check-exempt by
  design because the route derives the token and the period from one `parsePeriodToken` source)*; and
  the **duplicate-invoice key** decision
  (`(tenant_id, supplier_tax_id, supplier_invoice_number)` is unique-forever today — asesor to confirm
  per-year vs forever). Also open: a libro-registro / **Pre303** export (the owner chose the raw DR303
  file as the primary output; Pre303 is a possible later addition).
- **Reporting follow-ups (#56), surfaced by the finish-branch review.**
  (1) **Lift `percentOf` into `@waitron/shared` — LANDED (#77).** The formula
  `divideDecimal(multiplyDecimal(base, rate), "100", MONEY_SCALE)` had drifted into **four** copies —
  `packages/core/src/vat.ts`, both `apps/server/scripts/{record-one-sale,settle-invoice-first}.ts`, and
  `packages/reporting/test/fixtures.ts` (this entry previously said "third copy" and missed
  `settle-invoice-first.ts`; scoped against the tree, not the note). All now import the single
  `@waitron/shared` `percentOf`; values byte-identical (huella input unchanged, both reviewers +
  fiscal suites confirmed). **Deferred test-quality follow-up (Copilot, suppressed/non-blocking, no
  owner needed):** the `percentOf` float-exactness test (`packages/shared/src/percent-of.test.ts:53`,
  inherited verbatim from the retired `core/vat.test.ts`) asserts `30.00 × 10% = "3.00"` — inputs
  exactly float-representable, so it passes even under a `Number` implementation and does not guard the
  BigInt property its name claims. Swap for a midpoint that diverges under float (one producing an
  `x.xx5` that IEEE-754 stores just below, e.g. via a two-place rate), so the test fails if the codec
  regresses. (2) **A sargable
  business-day filter.** `businessDayClause` wraps the column in `(col AT TIME ZONE tz - cutover)::date`,
  which cannot use the `(tenant_id, issued_at)` index, so the aggregates scan the tenant slice. The
  rewrite to half-open UTC bounds (`col >= start AND col < end`) is index-usable, but has a DST subtlety
  (`start + interval '1 day'` is wrong on a transition day — compute `end` from the next day's local
  cutover) and only the VAT query has a matching index anyway (cash-up/voids would also need new
  indexes). **Gated on scale**, consistent with the 'sargable reconcile period filter' entry below.
- **The pre-push hook's shell is largely untested (unclaimed).** The classifier
  `scripts/changed-packages.mjs` and the sign-off check are tested; the deletion guard and the range
  computation are backed only by running the real hook against crafted stdin. Before writing a suite:
  the root Vitest project doesn't typecheck, and husky runs the hook under `sh -e` where an unguarded
  `x=$(false)` kills it mid-gate. Also note a green hook ≠ a green CI — it runs neither **mutation
  testing** nor the **`bundle-smoke`** builds (CI-only), and a `global` push runs `pnpm -r
  test:coverage` over the whole workspace (~116s). Full receipts in `CLAUDE.md` §2/§6. Non-blocking.
- **`packages/ui` can hang the `test-light` shard — watch `test-ui`.** It hung the whole-workspace
  shard twice on 2026-08-01 (a wedged `chrome-headless-shell` under Testcontainers contention,
  plausible-not-proven); mitigated by giving `packages/ui` its own `test-ui` shard so a hang can no
  longer take twelve other packages down with it. **Still open** — the cause is unconfirmed; if it
  hangs in `test-ui` too, the cause is inside the suite and the next move is a per-test timeout + a
  Playwright trace. Guarded by `scripts/ci-workflow.test.mjs` (the three shards cover every
  `test:coverage` member exactly once).
- **`test-light` reports `success` without naming what it ran.** The skip-empty-scope half is done;
  what remains is the *reporting* — a shard that ran two packages and one that ran the whole workspace
  both report `success`, and only the step log tells them apart. Make the job name the packages it
  selected. Non-blocking.
- **`packages/db`'s test suite is 189s**, mostly one Testcontainers Postgres per suite. It is now its
  own CI shard (`test-heavy`), which stops it blocking the other packages but does not make it any
  shorter. Sharing a container across suites beats every CI-config change combined, but it means
  changing `useRealPostgres` / `describeEachTarget` — the harness that guarantees RLS and lock
  contention are observed under a non-superuser role, which PGlite cannot show. A test-correctness
  change wearing a performance change's clothes; its own branch, its own review
- **Payments follow-ups** — the Mode 3 inbound Stripe webhook endpoint's **security half is DONE
  (#49)**: `POST /webhooks/stripe/:tenantId`, per-tenant signature verification, tenant resolution,
  settle. What remains on it is the **`recordSale` sale-chaining hand-off**, deferred because it
  needs the till / working-orders model before a settled webhook can chain a sale (the `server_id`/node
  rekey it also needed **landed as #54**). Also still open: the pre-existing `forward` retry backoff and the reconcile remediation UI
- **Workforce follow-ups (D2, #50)** — none blocking. (1) **Swap-workflow hardening — CLOSED (#90,
  2026-08-16):** `acceptSwap` now guards `status='requested'` (new `swap.not_acceptable`) and
  `requestSwap` verifies the return shift is owned by `toPerson`, both proven by deletion. **New #90
  deferrals:** the **staff dashboard portal LANDED (#92)** (reused #90's surface-agnostic verbs via a
  management-session `/management-api/me/*` group + a role-aware shell — no migration); still open — the
  **two-sided swap UI** (offer to take a colleague's specific
  return shift — needs cross-person shift visibility; the verb+route already defend it, only the UI is
  deferred); `requestSwap`'s **`toPersonId` FK→500** on a give-away to a non-existent person
  (hostile/non-UI-client-only, the FK backstops integrity — needs a deliberate error-code choice);
  staff **cancel/withdraw** of a pending swap/absence request; and widening the fixed **14-day**
  my-shifts window / pagination. (2) **Guardrail advisory notes:** `break_owed` /
  `night_work` breaches surface obligations on ordinary shifts (callers filter by `kind`), and
  `weekly_rest` under-reports at roster edges **by design** (documented safe — judging edge weeks
  needs the roster period boundaries passed in). (3) **Supersede** self-join could be a single
  `UPDATE … RETURNING` (deferred — concurrency-critical; the partial unique index is the real
  serialiser, pinned by the concurrency test)
- **An open product question** — the orphan drift gate holds a customer's money pending a human, and
  the hold is unbounded today because nothing re-sweeps a closed period. Defensible before
  production; deserves a decision before it
- **A second open product question** — `waitron-provision instance` now applies any pending database
  migrations every time it runs ([#16](https://github.com/clintongormley/waitron/pull/16)), and
  `status` tells operators to re-run it. Against a shop that is trading, that can lock tables until
  the migration finishes. Whether it should be gated — a flag, a refusal, a louder confirmation —
  is undecided. **Smaller than it first looked:** the cloud design (#19) gives every venue its own
  database and its own server, so the blast radius is one shop rather than every customer at once,
  which is what an earlier framing of this question assumed
- **A deferred design question from the sale-settlement model (#39)** — the €0, tenderless "fully
  comped sale" path is built and settles at the settlement instant (`new Date()`), deliberately NOT
  backdated to the invoice's `issued_at` (which in invoice-first mode is when the invoice printed, not
  when the comp was finalised). What is unresolved is a till-UX question, not a fiscal one: is a comp
  ever *finalised long after the invoice printed* — the invoice-first case — a real flow a server would
  perform, or only a theoretical one? It bears on piece 4 (invoice-first mode) and sub-project 7 (the
  till); nothing needs deciding until the till is designed. Recorded so it is not lost
- **Fiscal follow-ups** — a partial index on `acks`, a sargable reconcile period filter. Both gated
  on scale that does not exist yet
- **Provisioning and credentials follow-ups** — test-infra duplication, `bin.ts` connect-before-
  validate ordering, `rotate` coupled to `PURPOSES`. A sibling of that last one, still undecided:
  the credential READ path (`getCredential` / `tryGetCredential`,
  `packages/credentials/src/store.ts`) runs the shape guard (object, non-null, non-array) but not
  `validatePayload`, so a row sealed under an older `PURPOSES` field-list is returned with a missing
  field as `undefined` rather than rejected — a fail-loudly-vs-keep-serving design call worth
  settling before the first consumer relies on it (migrated from a since-deleted memory note,
  2026-08-02). Four more carried from
  [#11](https://github.com/clintongormley/waitron/pull/11), none claimed: password redaction in
  `applyInstance` is enforced by listing the statements that carry a secret rather than structurally,
  so the next statement added is unsafe by default; `bin.ts`'s `ask()` is real logic on the
  coverage-excluded side and has already shipped one bug; `ApplyDeps.database` and the action list are
  two sources of truth for the same database name; and an order-tracking test fixture is duplicated in
  two suites
- **The `tenant` command is unplanned**, and its design carries a known defect: the
  [provisioning tool design](superpowers/specs/2026-07-29-provisioning-tool-design.md) §4 gives its
  idempotency check as "look up `tenants` by NIF", which cannot work — the row-level security policy
  hides a tenant from a connection that has not already said which tenant it is, which a lookup
  *preceding* that knowledge cannot do. Attempt the insert and catch the unique-violation instead.
  The spec carries a dated note; the mechanism still needs replacing
- **Stripe is unprovisioned for the deli.** The payments code is complete and verified against a live
  sandbox, but no real account exists for the venue that has to be trading by January
- **Four SumUp questions are unverified, and one of them can invalidate a design already on `main`.**
  They are listed in
  [the SumUp provider design](superpowers/specs/2026-07-30-sumup-card-present-provider-design.md) §7
  under *"do not build on these without checking"*, so nothing is lost — but nothing points at them
  from here either, and they want answering **before** the SumUp provider is built rather than during.
  The load-bearing one is whether the card reader still works standalone and offline once it has been
  paired to SumUp's cloud service. If it does not, the outage path in
  [the deli hardware design](superpowers/specs/2026-07-30-deli-hardware-design.md) §5 has to be
  rewritten — that document assumes a card can still be taken when the internet is down, which is the
  whole reason the hardware was chosen. The other three: whether we may *supply* the idempotency key
  rather than only read it back, whether reader webhooks are signed the same way online ones are, and
  whether `void` maps onto the refund endpoint. Both specs carry provenance tables; **this entry
  deliberately restates no external fact of its own** — including the comparison with Square's API and
  the card rates, which are sourced in the hardware design (§7 and its provenance table) and are the
  kind of vendor claim that goes stale silently if copied into a second place. Read them there. The
  rates in particular are already flagged there as needing confirmation against an actual contract,
  not a pricing page
- **The three alta builders in `packages/fiscal-verifactu/src/backend.ts` are now triplicated.**
  `recordSale`, `recordCorrection` and `recordSubstitution` (the last added by the F3 canje branch) each
  repeat the same alta-assembly **head** — `currentSif` / `legalNameFor`, the `desglose` map with
  `CalificacionOperacion: "S1"`, and `cuotaTotal = sumDecimals(vatBreakdown.map(tax))` — and the same
  **tail** — `appendToChain(… { tipo: "alta", saleId, entorno, input }, sif)` → `tx.insert(envios)` →
  the `FiscalRecordRef` return. Deferred, not skipped: these are UNREPAIRABLE-record builders (CLAUDE.md
  §5), so a de-dup refactor needs its own review and a huella-invariance re-run across all three
  (CLAUDE.md §4) rather than riding in on a feature branch. The safe seam if done later is a helper
  taking the already-assembled `Omit<AltaInput, "Encadenamiento">` and running the shared tail (zero
  huella risk — nothing about what is hashed moves), plus a small `buildDesglose(vatBreakdown)` for the
  head. The per-method bodies (`TipoFactura`, the rectificativa vs `FacturasSustituidas`/`Destinatarios`
  fields, positive vs negative totals) stay where they are. **Two more duplications the F3 branch
  surfaced, deferred with the same triplet:** the `fechaFromStoredDay` offset-cancellation algebra
  (recovering the fiscal date from a stored day) is now identical across all three builders, and
  `recordSubstitution`'s substituted-ticket loop reads each F2 ticket one query at a time — an N+1 a
  single `sale_id = ANY(...)` collapses. All of it lands together, behind the same review and
  huella-invariance re-runs across the three builders
- **F3 canje open questions (#51) — asesor / XSD.** Four, none blocking a build: the piece is done
  and its `Destinatarios` shape was verified against the committed AEAT schema, but confirm each
  before a real F3 is filed. (1) The foreign `IDOtro` recipient path is typed but **refused at the
  backend** pending the asesor's `IDType` shape. (2) Whether a **separate F3 series is mandatory** is
  unconfirmed — `recordSubstitution` reuses the `standard` series today. (3) Cross-SIF F3 (a canje
  against a ticket issued by another SIF) is a sound **inference**, not confirmed. (4) An asesor / XSD
  confirmation of the `Destinatarios` shape is still wanted before the first real filing
- **A concurrent-corrective race in settlement is untranslated.** If a rectificativa commits between
  `settleSale`'s opening read and its `sale_settlements` INSERT, the coverage trigger recomputes the
  net and raises a raw Postgres `P0001` (the trigger's `RAISE EXCEPTION` carries no dedicated
  SQLSTATE), which `settleSale` does not translate to a clean `sale.*` code — it catches only WT002
  and the `sale_settlements` unique violation. **Fail-closed** (the settlement rolls back; nothing
  wrong is written) and **unreachable in the headless slice** — it needs same-sale correction and
  settlement interleaving, which only the till UI (sub-project 7) makes possible. The fix, when it
  becomes reachable: give the coverage `RAISE EXCEPTION` a dedicated SQLSTATE, the same way
  `tenders_reject_post_settlement` got WT002, and translate it in `settleSale`
- **Collapse the per-module drizzle migration chains into per-module baselines (pre-production
  cleanup, not now).** Migrations are already **per-module** — 8 independent sets in
  `packages/migrations/migrations.manifest.json`, each package with its own `drizzle/` dir, numbered
  sequence and `__drizzle_migrations_*` tracking table, replayed in manifest order by
  `packages/migrations/src/apply.ts`. The debt is the **length** of each chain: 78 source SQL files
  across the eight sets, 30 in `packages/db` alone (`0000`–`0029` as of 2026-08-06), a real fraction
  of them pure development churn — `0016_add_node_id.sql` is `ADD COLUMN`/`ADD CONSTRAINT` retrofitting
  `node_id` onto tables that in a fresh build could be born with it, and the payments/fiscal
  `add_node_id`+`rekey` pairs are the same shape. CLAUDE.md §3 makes a collapse legitimate: nothing is
  deployed, schema drops and recreates, CI builds fresh, so **nothing depends on the history — only the
  end state**. This is a build refactor, not a fiscal operation.
  - **Not a `drizzle-kit generate` one-liner.** The valuable migrations are hand-written custom SQL —
    `FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, GRANTs, the immutability triggers — that Drizzle does
    **not** emit (`packages/db/drizzle/0017_nodes_rls.sql`'s header says so in as many words). A naive
    "delete all, regenerate" gives the `CREATE TABLE`s and **silently drops every FORCE RLS, policy and
    grant** — the §1 "reading is not verification" trap, invisible to eyeballing and catastrophic. Each
    baseline is a careful hand-fold: generated final DDL **plus** the interleaved custom SQL, arriving
    at the same end state, plus regenerated `meta/_journal.json` + snapshots so the next
    `drizzle-kit generate` diffs against a real baseline rather than a stale one. The migrations also
    double as documentation (the `0017` header is an essay on why a grant is SELECT-only, with a dated
    re-audit) — the collapse must carry that commentary forward, not just the DDL.
  - **Verification is the actual work, and the safety net already exists.** A collapse touches every
    package, so per §4 it must be proven against the **whole unfiltered suite**, not scoped shards. The
    fiscal `inmutabilidad` guard scans every `tenant_id`-bearing table for FORCE RLS + policy; the
    RLS-isolation, `english-only` and reachability guards back it. A dropped clause turns a guard
    **red** (recoverable) rather than corrupting a chain (not) — which is exactly why this is safe to
    do here and would not be in production.
  - **Timing: once, late in the pre-production window — not a priority now.** The churn is cosmetic: a
    fresh build applies all 78 in seconds, and the only real cost is cognitive (replaying the chain to
    see the actual schema). The right trigger is *after the last foundational reshape lands*. The
    `node_id` re-key (#54) was one such reshape and left the corrective migrations above; replication
    is still-pending shared infra (single-writer-per-row groundwork) that may touch many tables, so
    collapsing now risks paying the fold-and-verify cost twice. Collapse **once**, near the end of
    pre-production.
  - **Unit:** per-module baselines (a single `0000_baseline.sql` per set), matching the manifest — not
    one repo-wide file, which would fight the per-set tracking tables. **Cheaper middle option** if
    relief is wanted sooner: squash only the corrective churn (fold the `add_node_id`/`rekey` sequences
    back into their originating table migrations) and leave the custom RLS migrations as separate
    readable units.
- **Table service TS-2 follow-ups (#103). None blocking; surfaced by the finish-branch reviews + Copilot.**
  - **`placeOrder` has no tab-guard.** `placeOrder(tabId)` → pay (`open→placed→settled`) is *structurally
    reachable* today; #103 hardened the reset trigger (its `WHEN` fires on `open`- **and** `placed`-→-terminal,
    a no-op for non-tab placed orders) so a stale `status_id` is cleared regardless, but the deeper fix is a
    guard in `placeOrder` refusing a tab's order (a TS-1 / counter-POS follow-up). This is the #97 *TS-2 caveat*
    made concrete: a live placed tab still reads *free* to `openTab` / `listTablesWithState` and could be
    overwritten or shown free on the floor.
  - **`till-api.ts` null-body → 500** on `POST /api/tables/:id/status` (reads `c.req.json()` without `?? {}`).
    **Pre-existing, till-surface-wide** — every till route does this, not a TS-2 regression; whether it should be
    400 is a decision across all till routes (the direct analogue of the management-api `run` null-body item).
  - **Empty PATCH returns 204 before the `till.configure` authorize gate** (authorize lives inside the verb,
    which the no-op branch short-circuits). Harmless today (no write, no data) and consistent with the staff-PATCH
    sibling; a latent trap if that branch ever gains a side effect.
  - **Dashboard colour picker is hex-only** (`<wt-input type="color">`) while `validateStatusColor` also accepts
    short design tokens (design §2a, e.g. `amber`). Tokens are only authorable via the API; the editor renders one
    as `#000000`. Cosmetic (new statuses default `#ef4444`).
  - **TS-3 cross-slice caveat.** The reset trigger clears `WHERE tab_id = NEW.id` (future-proofed for a tab
    covering several tables); TS-3 (move / join / merge) must preserve the `dining_tables.tab_id` back-pointer
    semantics the trigger and `listTablesWithState` rely on. **TS-3 LANDED (#119) preserving them** — its verbs
    only re-point `tab_id` and clear/keep `status_id` per turnover; the caveat holds.
- **Table service TS-3 follow-ups (#119). None blocking; surfaced by the finish-branch reviews + Copilot.**
  - **`freeSourceTable` unvalidated on `POST /api/tabs/:id/merge`.** The route `isUuid`-screens `fromTabId` but
    passes `body.freeSourceTable` straight to `mergeTabs`; a missing/non-boolean value is falsy → silently the
    **join** branch (source kept) rather than a 4xx. Benign/non-fiscal/recoverable, and it matches the till-surface-wide
    untyped-`c.req.json<T>()` pattern (the same class as the #103 null-body→500 item above). The "right" fix needs a
    **permanent till-surface request-shape error code** (§3, never renamed) — an owner/error-code decision, so deferred
    rather than minted autonomously.
  - **`mergeTabs`/`moveTabLines` gate on `status='open'`, not on being an actual TAB.** So `.../merge` accepts a
    **parked** order (open, no `dining_tables` back-pointer) as `fromTabId` — moves its lines onto the target and
    abandons it. Non-corrupting (no double-file; the parked order just abandons empty), but broader than "tabs" — a
    design-scope question: should merge require a real back-pointer, or is merging a counter order into a table tab a
    feature? Owner call.
  - **`moveTabLines` source-not-open branch has no direct test.** The `from` open-check throw is unexercised (the
    PGlite test abandons the *destination*; `mergeTabs` validates both tabs before calling). The DB
    `require_open_parent` trigger backstops it (worst case a 500, not data loss). STILL OPEN after **TS-4**: transfer
    reuses `moveTabLines` but pre-validates both tabs via `lockOpenTab`, so the `from`-not-open branch stays
    unreachable-and-untested; add the direct test when a future caller can reach it.
- **Table service TS-4 follow-ups (#124). None blocking; surfaced by the finish-branch two-reviewer phase.**
  - **Route request-shape validation — bundle with TS-3's `freeSourceTable`.** `POST /api/tabs/:id/transfer` screens
    `:id`/`toTabId` as UUIDs but passes `body.transfers` through unchecked: a missing/non-array `transfers` →
    `transfers.map(undefined)` → an opaque `till.failed` **500**, not a clean 4xx. Same class as the TS-3
    `freeSourceTable` item above and the #103 null-body→500 — the coherent fix is **one till-surface request-shape
    error-code decision** (§3, permanent) covering all of them, an owner call, so deferred rather than minted piecemeal.
    (An empty `transfers: []` is a harmless locks-both-tabs no-op, untested — fold a one-line assertion in with the guard.)
  - **Unify the tab-pair lock into a shared `lockTabPair(tx, [idA, idB])` across `mergeTabs`/`moveTabLines`/`transferLines`.**
    `transferLines` locks its two `working_orders` rows with two ascending-id `lockOpenTab` calls (acquisition order
    GUARANTEED, proven by deletion); `mergeTabs`/`moveTabLines` use a single `id IN (a,b) ORDER BY id FOR UPDATE`, whose
    lock-acquisition order Postgres does NOT guarantee (ORDER BY sorts output, not lock order). Routing all three through
    the loop-based primitive would make **transfer-vs-merge provably deadlock-safe** (today the docstring honestly scopes
    it as reasoned-safe-but-not-proven) and remove the JS-`.sort()`-vs-uuid-byte-order justification. Non-fiscal,
    retryable if it ever fired; a self-contained refactor of the (landed) TS-3 locking.
- **Local dev run stack follow-ups (#100). None blocking; both surfaced by review, out of scope for
  the run-stack itself.**
  - **Let `boot.ts` / `config.ts` accept a native `null` from-source migrations root.**
    `migrationOptionsFor` already accepts `null`; threading it through boot/config would let
    `dev-server.mjs` drop the `WAITRON_MIGRATIONS_DIR` assembly it does today, shrinking the launcher.
  - **Extract the shared venue+seed fixture** that `dev-setup` / `till-demo` / other demos each inline —
    worth doing once a second consumer makes the duplication concrete.

---

## How to keep this file honest

Update it in the change that makes it stale, the same rule `CLAUDE.md` §7 applies to itself. In
particular:

- When a piece lands, move it out of **Next** rather than leaving it to be discovered.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. This is not a history; the git log is.
