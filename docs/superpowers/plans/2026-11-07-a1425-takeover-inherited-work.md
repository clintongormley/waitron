# A1425 part 1: the box that takes over can finish what it inherited — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** after a controlled or emergency takeover, the selling box can change and pay inherited
tables, numbers orders on past every number already given out, cancels and corrects old sales on its
own chain, and shows the old box's sales, AEAT reconciliation and certificate as its own.

**Architecture:** one helper in `@waitron/db` lists "this box and every box it took over from"
(today's `readTakenOverFrom` walk, moved down). Each reader that filters by box is sorted into one
of three kinds (spec §2; the full list is below): no box filter, this box plus the boxes it took over
from, or this box only. New records always go on the selling box's chain, and only the box the held
chart names as the serving primary appends to a chain.

**Tech stack:** TypeScript, drizzle on `node:sqlite`, Vitest (`useVenueDb` for database suites).

**Spec:** `docs/superpowers/specs/2026-11-07-restore-takes-new-identity-design.md` (approved
2026-11-07). This plan is its §8 part 1 only. Part 3 (a restore as a takeover) waits for Cloud.

## Global constraints

- Risk triggers: fiscal invariants and a by-id read. The branch takes the FULL ceremony: per-task
  reviews and the full `/finish-branch` wave, with the two side-by-side Codex run-it reviews.
- No history row is rewritten to the new box's id (spec anti-goal). Readers learn the list instead.
- No record is added to a chain whose box handed over (spec §3, owner 2026-11-07).
- A cancellation of an old box's sale is chained and numbered on the selling box, citing the old
  sale's invoice (`IDFacturaAnulada`) exactly as today (owner 2026-11-07). That a cancellation, or a
  corrected resubmission, may come from another installation than the one that issued the invoice
  is settled: `docs/compliance/verifactu-findings.md` §13, as cited by
  `docs/compliance/asesor-questions.md` Q39.
- Order numbers never repeat within a venue (spec anti-goal).
- Coverage `98/98/98/95` in every package touched; `db`'s mutation floor of 90 covers
  `packages/db/src/history-nodes.ts`. Rejected writes assert the domain error code.
- Vitest does not typecheck: every task runs the touched packages' `pnpm --filter <pkg> typecheck`.
- Every commit `git commit -s`. Focused tests while working; CI runs the package suites.

## Plan decisions (mine)

1. **The list lives in `@waitron/db`** and is read where it is needed. `handover_activations` is a
   `@waitron/db` table and every reader's package depends on `@waitron/db`. A promotion restarts the
   box (`apps/server/src/boot.ts:3692-3693`), so a reader built once at start may read it once.
2. **One order-number sequence for the venue** (spec §9 allows it): the next number is one above the
   highest counter of any box, written to this box's counter row. It needs no list and does not
   repeat after a box takes back (M1 1-5, M2 6-7, M1 takes back → 8).
3. **A cancellation's original is found by its invoice, not its chain.** Drop `original.sif_id =
   r.sif_id` (and its `prior_original`, `-held` and `heldRecords` twins). The invoice key plus "not
   replaced" already names one row: `registros_identidad_uq` (`packages/fiscal-verifactu/src/schema/registros.ts:123-125`).
   **As built (2026-11-08):** one exception. An original that is held (`detenido`) holds back its
   cancellation only when both are on the same chain: the outbox keeps `original.sif_id = r.sif_id`
   (and its `prior_original` twin) on the `detenido` branch only (`originalSettled` in `packages/fiscal-verifactu/src/drain.ts`),
   and `heldRecords` keeps its original-to-case map per chain (`packages/fiscal-verifactu/src/filing-cases.ts:274-285`),
   not across chains as Task 5c below says.
4. **The append guard reads the held chart, not clocks.** `handover_activations.activated_at` comes
   from two boxes' clocks (`apps/server/src/handover-activation.ts:124`), so "newest activation"
   could refuse a box that took back. Instead `appendToChain` refuses when the held chart
   (`readNodeMembership`, `packages/db/src/node-membership.ts:27`) exists and does not name the
   chain's box `serving-primary`. With no chart held there is no refusal. Charts move
   by term, so a take-back names M1 again.
   **As built (2026-11-08):** the same check also runs in the Veri\*Factu backend's
   `refuseNewIssuance`, so a sale or bill payment is refused before money moves; refunds call a new
   `refuseNewRefund`, which checks only for an active conflict, so a box the chart no longer names
   main still gives refunds. `fiscal.chain_handed_over` answers 409 on the till, payments and remedy
   routes. The owner confirmed the refusal before money moves on 2026-11-08 (`docs/backlog/fiscal.md`,
   Decisions and deliberate limits); the refund split, the 409 answers and the wording are controller
   rulings.
5. **The recorded daily close is left alone**; A1325 replaces it. Nothing outside
   `packages/reporting` calls `recordDailyClose` (plan review, grep). The daily-close REPORT reads the
   list like every other report. This replaces the spec's "if part 1 lands before A1325" call; Task 9
   adds a dated line to the spec.

## Every reader, by kind (spec §2)

| Reader | Kind | Task |
| --- | --- | --- |
| `working-order.ts:1490, 4569, 4647, 4678`, `invoice-selection.ts:94` | no box filter | 3 |
| `allocateOrderNumber` (`working-order.ts:1711`) | venue-wide | 3 |
| `overdue-orders.ts:61` | no box filter | 4a |
| reporting inputs, `report-api.ts` per-box routes, daily-close report | this box + taken over | 4a, 4b |
| `recordVoid` chain, SIF, clock, integrity check | this box only (the issuing box) | 5a |
| `drain.ts:661, 682, 914` cancellation's original | any box (by invoice) | 5b |
| `record-remedy-held.ts:83-84`, `filing-cases.ts:275-296` `heldRecords` | any box (by invoice) | 5c |
| remedy target checks `record-remedy-http.ts:52`, `-held.ts:41`, `-absent.ts:50`, `-corrective.ts:54`, `-brake.ts:39` | this box + taken over | 5c |
| `appendToChain` | serving primary only | 6 |
| reconcile rows, candidate months, `reconcile-series.ts:45`, `known_huellas` (`reconcile.ts:297-304`), installation check (`:436-446`) | this box + taken over | 7 |
| `latestInstall` (`certificate-record.ts:7`), `certificate-reminders.ts:68-118` | this box + taken over | 8 |
| `readTakenOverFrom` (card payments) | this box + taken over (already) | 2 |
| `receipt-print.ts:632` refund drawer | this box only: the refund row is written by this box | none |
| live series (`reconcile-series.ts:16-17`), `verify.ts:52`, daily-close chain, pay-period closures, `backend.ts:712` `pendingCount` (no running caller) | this box only | none |

## Review focus

1. **A box that handed over and later took back** (M1 → M2 → M1): M1 appends to its own chain
   again, and its order numbers carry on. Tests in Tasks 3 and 6.
2. **Two handovers back** (M1 → M2 → M3): M3's reports, reconciliation and certificate include M1.
   Tests in Tasks 2, 4b and 8.
3. **A cancellation of an old sale whose original is still waiting to be sent**: the selling box
   does not send it first (AEAT would answer 3002). Test in Task 5b.
4. **A cancellation of an old sale whose original AEAT refused**: set aside, then releasable once
   the original is accepted. Tests in Tasks 5b and 5c.
5. **AEAT reporting either installation for a cross-box original and cancellation**: no false
   conflict, so selling is never stopped by it. Test in Task 7, for both answers, since what AEAT's
   lookup reports for a cancelled invoice has no receipt in `docs/compliance`.

---

### Task 1: the measurement becomes the branch's test

**Files:** Modify `apps/server/src/handover-controlled.e2e.test.ts` (from commit `feba7de8b4`).

**Interfaces:** Produces the cases below; later tasks flip each from `it.fails` to `it`.

- [ ] **Step 1:** create the worktree
  (`python3 ~/workspace/tools/worktree.py new waitron feat/a1425-takeover-inherited-work --headless`)
  and `git cherry-pick feba7de8b4`. Keep its single AEAT stand-in for the whole run.
- [ ] **Step 2:** inside the inherited-work stage, before M2 is shut down for the cancellation, add
  two steps: a cash refund of an M1 sale OTHER than the one cancelled
  (`POST /api/transactions/:saleId/refunds`, `apps/server/src/tender-refund-api.ts:146`), and a
  credit of an M1 order through `/api/working-orders/:id/cancel` (`apps/server/src/cancel-credit.ts`).
  If the file's M1 sales include no order that route can credit, record that in the report and
  leave the credit out.
- [ ] **Step 3:** rename the cases and mark today's failures `it.fails`, each with a one-line comment
  naming the task that flips it:
  - `it("M2 adds a dish to the table it took over")`
  - `it.fails("M2 takes cash for that table, on a sale in its own series")` — Task 3
  - `it.fails("M2's next order number is above every number given out, and none repeats")` — Task 3
  - `it.fails("M2 cancels one of M1's filed sales on its own chain, and files it")` — Task 5b.
    Assert the cancellation's `node_id`, `sif_id` and `numeroInstalacion` are M2's, its
    `IDFacturaAnulada` is the M1 sale's, and AEAT's answer is `aceptado`.
  - `it.fails("the day's cash-up on M2 includes M1's sales")` — Task 4b
  - the refund and credit cases, as `it` or `it.fails` by what they do today, with the refusal's
    `file:line` in the report for any that fail.
  - `it("the inherited-work stage ran to its end")`, asserting the stage's last step ran, so an
    `it.fails` case cannot pass on a broken setup.
- [ ] **Step 4:** run `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/handover-controlled.e2e.test.ts`;
  every case behaves as marked; read the `Tests` line.
- [ ] **Step 5:** if the refund or the credit fails today, stop and report: the plan needs a task.
  Otherwise commit.

### Task 2: "this box and the boxes it took over from", in `@waitron/db`

**Files:** Create `packages/db/src/history-nodes.ts` and its test; modify `packages/db/src/index.ts`,
`apps/server/src/handover-collection.ts`.

**Interfaces:** Produces
`readHistoryNodes(db: Database | Transaction, nodeId: NodeId): Promise<readonly NodeId[]>` — `nodeId`
first, then each box it took over from, then each box those took over from, each once, never
`nodeId` again. `readTakenOverFrom(db, nodeId)` keeps its meaning and returns `.slice(1)` of it.

- [ ] **Step 1: failing tests** (`useVenueDb`, rows written into `handover_activations`):
  `"a box that took over from nobody lists itself only"` → `[m1]`;
  `"two handovers back are both listed, nearest first"` M1→M2, M2→M3 → `[m3, m2, m1]`;
  `"a box that handed over and took back is listed once"` M1→M2, M2→M1 → for M1 `[m1, m2]`.
- [ ] **Step 2:** run `pnpm --filter @waitron/db exec vitest run src/history-nodes.test.ts`; FAIL.
- [ ] **Step 3:** move the walk; query `handoverActivations` directly (no `@waitron/handover`
  import: `scripts/workspace-cycles.test.ts`).
- [ ] **Step 4:** run the new tests, `apps/server`'s `src/handover-collection*.test.ts` and
  `src/pending-card*.test.ts`, and both packages' `typecheck`; PASS.
- [ ] **Step 5:** commit.

### Task 3: orders belong to the venue, and order numbers are one sequence

**Files:** Modify `apps/server/src/working-order.ts:1490, 4569, 4647, 4678`,
`apps/server/src/invoice-selection.ts:94`, `packages/db/src/allocate-order-number.ts`. Tests:
`packages/db/src/allocate-order-number.test.ts`, `apps/server/src/working-order.test.ts`.

**Interfaces:** `allocateOrderNumber(tx: Transaction, nodeId: string): Promise<number>` keeps its
signature; it returns one above the highest `next_number` of any row, and stores it in `nodeId`'s row.

- [ ] **Step 1: failing tests:**
  - db `"a box's first number follows the highest of any box"`: M1=5 → M2 gets 6, then 7.
  - db `"a box that took back carries on above every number"`: M1=5, M2=7 → M1 gets 8.
  - db: rewrite `"numbers each node independently"` (`allocate-order-number.test.ts:42-48`) as
    `"numbers never repeat across boxes"`. This is an intended behaviour change; say so in the commit.
  - server `"an open order stamped with another box is paid and changed here"`: cash payment and a
    receipt-language change on an order whose `node_id` is another box both succeed (today
    `working_order.not_open`).
- [ ] **Step 2:** run them; FAIL.
- [ ] **Step 3:** drop the five box filters; make the counter one
  `insert … values (nodeId, (select coalesce(max(next_number), 0) + 1 from working_order_counters))
  on conflict do update set next_number = (select max(next_number) from working_order_counters) + 1
  returning next_number` statement, and update its doc comment.
- [ ] **Step 4:** run the tests above and the existing `allocate-order-number`, `working-order*`,
  `bill-payments*`, `invoice-selection*` suites and both `typecheck`s; PASS.
- [ ] **Step 5:** flip Task 1's payment and order-number cases to `it`; run the e2e file; PASS.
- [ ] **Step 6:** commit.

### Task 4a: reporting takes a list of boxes

**Files:** Modify `packages/reporting/src/business-day.ts:245-252`, `types.ts`, `cash-up.ts`,
`counts.ts`, `vat-summary.ts`, `category-sales.ts`, `top-sellers.ts`, `daily-close.ts`,
`overdue-orders.ts`, `record-daily-close.ts` (the call only), and the callers in
`apps/server/src/report-api.ts` (~190, 303, 415) as a mechanical `nodeIds: [nodeId]`.

**Interfaces:**

- `nodeScopeClause(nodeIds?: readonly NodeId[], column?: SQL): SQL` — omitted: whole venue, as
  today; a list: `and <column> in (…)`; an empty list throws `Error("reporting: empty box list")`.
- Every input's `nodeId?: NodeId` becomes `nodeIds?: readonly NodeId[]`.
- `computeDailyClose` sets `DailyClose.nodeId` to `input.nodeIds?.[0]` (this box comes first in
  `readHistoryNodes`). `recordDailyClose` passes `nodeIds: [input.nodeId]`, so a recorded close and
  its hash are unchanged; existing hash-pinning tests must still pass untouched.
- `overdue-orders.ts` drops its box filter: orders belong to the venue.

- [ ] **Step 1: failing tests:** `"a report for two boxes counts both boxes' sales"` in
  `cash-up.test.ts` and `vat-summary.test.ts`; reverse `overdue-orders.test.ts:452` to
  `"another box's overdue order is listed"` (intended behaviour change; say so in the commit);
  `"an empty box list is refused"`.
- [ ] **Step 2:** run `pnpm --filter @waitron/reporting exec vitest run`; the new cases FAIL.
- [ ] **Step 3:** change the clause, the types and every caller; existing tests pass `nodeIds: [x]`
  with their assertions unchanged.
- [ ] **Step 4:** run the reporting suite, `apps/server`'s `src/report-api*.test.ts`, and both
  `typecheck`s; PASS.
- [ ] **Step 5:** commit.

### Task 4b: the server's reports read the list

**Files:** Modify `apps/server/src/report-api.ts:174-185` (`buildReportContext`). Test:
`apps/server/src/report-api.test.ts`.

**Interfaces:** Consumes `readHistoryNodes` (Task 2). `buildReportContext` returns
`nodeIds: await readHistoryNodes(tx, nodeId)`; every per-box route passes it, the daily-close report
included.

- [ ] **Step 1: failing test:** `"a box's reports include the boxes it took over from, two handovers
  back"`, covering the daily-close, period, category and top-sellers routes.
- [ ] **Step 2:** run it; FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the report suites and `typecheck`; PASS.
- [ ] **Step 5:** flip Task 1's cash-up case to `it`; run the e2e file; PASS.
- [ ] **Step 6:** commit.

### Task 5a: a cancellation is issued by the selling box

**Files:** Modify `packages/fiscal/src/backend.ts:498`, `packages/fiscal/src/testing/fake-backend.ts:184`,
`packages/fiscal-none/src/backend.ts:59`, `packages/fiscal-verifactu/src/backend.ts:415-470`,
`packages/fiscal-verifactu/src/void-issue-clock.ts`, `packages/core/src/record-void.ts`, and every
caller (about 35 test and helper calls: find them with
`grep -rn 'recordVoid(' apps packages --include='*.ts'`, including the probe's call in
`handover-controlled.e2e.test.ts`, `apps/server/src/testing/order-venue.ts:222-230`,
`fiscal-none`'s e2e, `zone-core-capabilities`, `adjustments-report` and `fiscal-remedy.staff-refund`).

**Interfaces:**

- `FiscalBackend.recordVoid(tx, saleId, reason, issuingNodeId: NodeId): Promise<FiscalRecordRef>`
- core `recordVoid(tx, backend, saleId, reason, authz, issuingNodeId: NodeId)`; its
  `checkIntegrity` runs on `issuingNodeId`'s chain (`record-void.ts:47`).
- `prepareFiscalVoidClock(tx, saleId, source, issuingNodeId: NodeId)` keeps its check that the sale
  and its alta name the same box, and prepares the clock on `issuingNodeId`.
- Verifactu: `refuseNewIssuance`, `currentSif`, the chain and `appendToChain` use `issuingNodeId`;
  the anulación's invoice fields and `origin` still come from the original. Callers pass the box
  they run as (`cfg.nodeId`, `venue.cfg.nodeId`).

- [ ] **Step 1: failing test** `"a cancellation of another box's sale is chained on the issuing box,
  citing the original"`: sale under M1, `recordVoid(…, m2)` → record `node_id` m2, M2's `sif_id` and
  next `secuencia`, invoice fields equal to M1's alta.
- [ ] **Step 2:** run it; FAIL.
- [ ] **Step 3:** thread `issuingNodeId` through every backend and caller.
- [ ] **Step 4:** run the core, fiscal, fiscal-none and fiscal-verifactu void suites, the callers'
  suites, and every touched package's `typecheck`; PASS.
- [ ] **Step 5:** commit.

### Task 5b: the outbox finds a cancellation's original on any chain

**Files:** Modify `packages/fiscal-verifactu/src/drain.ts:661, 682, 914`. Test: the drain suite.

- [ ] **Step 1: failing tests:**
  - `"a cancellation on another chain waits until its original is accepted"`: M1's alta
    `pendiente`, M2's anulación `pendiente` → one pass sends only the alta; after `aceptado` the
    next sends the anulación.
  - `"a cancellation on another chain whose original was refused is set aside"`: M1's alta
    `rechazado` → the anulación becomes `retenido` with `fiscal.anulacion_retenida`.
  - control: the same-chain cases already in the suite pass unchanged.
- [ ] **Step 2:** run; FAIL.
- [ ] **Step 3:** drop the three chain equalities (plan decision 3).
- [ ] **Step 4:** run the drain and outbox suites; PASS.
- [ ] **Step 5:** flip Task 1's cancellation case to `it`; run the e2e file; PASS.
- [ ] **Step 6:** commit.

### Task 5c: remedies reach the records of the boxes this one took over from

**Files:** Modify `packages/fiscal-verifactu/src/record-remedy-held.ts:41, 83-84`,
`record-remedy-http.ts:52`, `record-remedy-absent.ts:50`, `record-remedy-corrective.ts:54`,
`record-remedy-brake.ts:39`, `filing-cases.ts:275-296`. Tests: their sibling suites.

**Interfaces:** Consumes `readHistoryNodes`. A remedy's target may be on any box in
`readHistoryNodes(tx, generation.nodeId)`; whatever record the remedy appends goes on
`generation.nodeId`'s chain, as today. `-held.ts:83-84` drops the node and chain equalities;
`heldRecords` keys its original-to-case map across chains.

- [ ] **Step 1: failing tests:** `"a set-aside cancellation on another chain is released once its
  original is accepted"`; `"a refused record of the box this one took over from can be remedied
  here"` (one case per handler); `"a halted cancellation on another chain joins its original's case"`;
  `"a record of an unrelated box is still refused"` (the refusal code each handler uses today).
- [ ] **Step 2:** run; FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the remedy and filing-case suites; PASS.
- [ ] **Step 5:** commit.

### Task 6: only the serving primary appends to a chain

**Files:** Modify `packages/fiscal-verifactu/src/chain.ts:312`, `packages/fiscal-verifactu/src/errors.ts`.
Test: `packages/fiscal-verifactu/src/chain.handed-over.test.ts`.

**Interfaces:** error code `fiscal.chain_handed_over` (params `{ nodeId }`), thrown by
`appendToChain` before its first attempt when the held chart exists and does not name `nodeId`
`serving-primary` (plan decision 4).

- [ ] **Step 1: failing tests:**
  - `"a box the chart does not name primary appends nothing"` → `fiscal.chain_handed_over`, no row.
  - `"the box the chart names primary appends"`.
  - `"a box that took back appends again"`: a later-term chart naming M1 primary → succeeds.
  - `"with no chart held, a box appends"`.
- [ ] **Step 2:** run; FAIL.
- [ ] **Step 3:** implement; register the code.
- [ ] **Step 4:** run the chain, backend, drain and remedy suites and `apps/server`'s
  `src/handover-controlled.e2e.test.ts` (M2's first sale after its switch-on must still append);
  PASS. If any existing suite appends without its box named primary in a held chart, report it
  rather than loosening the rule.
- [ ] **Step 5:** commit.

### Task 7: reconciliation covers the boxes this one took over from

**Files:** Modify `packages/fiscal-verifactu/src/reconcile.ts:37-41, 270-304, 436-446`,
`reconcile-sweep.ts:46-60`, `reconcile-series.ts:45`, `reconcile-runtime.ts:31-36`. Tests:
`reconcile.period.test.ts`, `reconcile-sweep.test.ts`, `reconcile.test.ts`.

**Interfaces:** `ReconcileScope` gains `historyNodeIds: readonly string[]` (this box first), read
once when the sweep is built. Stored rows, candidate months and `reconcile-series.ts:45` read
`node_id in historyNodeIds`. `known_huellas` takes every record of the same sale and invoice on any
box in the list, and the installation check accepts either record's installation. Live series stay
this box's own.

- [ ] **Step 1: failing tests:** `"a period's check includes the records of the box this one took
  over from"`; `"a month only the old box filed in is still a candidate"`; `"a cross-box original
  and cancellation raise no conflict whichever installation AEAT reports"` (two cases, one per
  installation), each also asserting that `refuseNewIssuance` on the selling box still passes.
- [ ] **Step 2:** run; FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the reconcile suites; PASS.
- [ ] **Step 5:** commit.

### Task 8: the certificate is found on the box that took over

**Files:** Modify `packages/fiscal-verifactu/src/certificate-record.ts:7-15`,
`certificate-reminders.ts:68-118`. Tests: their sibling suites.

**Interfaces:** `latestInstall(tx: Transaction | Database, nodeId: string)` keeps its signature
(nine calls in six files unchanged) and returns the newest install among
`readHistoryNodes(tx, nodeId)`. The reminders' lookup reads the same list, so a reminder M1 failed
to send is retried on M2.

- [ ] **Step 1: failing tests:** `"the newest install of the box this one took over from is found"`;
  `"this box's own newer install wins"`; `"a reminder the old box failed to send is retried here"`.
- [ ] **Step 2:** run; FAIL.
- [ ] **Step 3:** implement with `inArray`.
- [ ] **Step 4:** run the certificate suites; flip the e2e file's
  `it.fails("M2's certificate card shows that certificate")` to `it` and delete its comment; run the
  e2e file; PASS with no `it.fails` left from this plan.
- [ ] **Step 5:** commit.

### Task 9: the record

**Files:** Modify `docs/backlog.md` (A1425), the spec.

- [ ] **Step 1:** spec: a dated line under §2's cash-close paragraph: the recorded daily close is left
  for A1325, and the daily-close report reads the list (plan decision 5); a dated line under §8:
  part 1 built, with the PR number.
- [ ] **Step 2:** backlog: mark part 1 done in A1425 and leave part 3 waiting for Cloud. Spec §8
  item 2: if an entry needs a staff route to cancel a sale before go-live, add one line to it saying
  a cancellation now goes on the selling box's chain.
- [ ] **Step 3:** grep `docs/` for "node filter", "one node cannot edit", `readTakenOverFrom` and
  "per-node counter"; fix stale prose.
- [ ] **Step 4:** commit.
