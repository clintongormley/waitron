# Fiscal records, invoices and the asesor — detail

The open entries are listed in [the backlog](../backlog.md), under "Fiscal records, invoices and the asesor". This file holds
their full text.

## No sale over €3,010 can be made at all

- **No sale over €3,010 can be made at all**: Waitron issues only simplified invoices and no screen
  accepts a customer's tax ID, so a full invoice is not offered. Spain's legal ceiling for a
  simplified invoice in hospitality is €3,000 (RD 1619/2012 art. 4.2, quoted in
  [verifactu-findings.md](../compliance/verifactu-findings.md) and the
  [full-invoices design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md)); the
  branch refuses over €3,010, the limit `@waitron/verifactu`'s validator applies (3,000 plus its
  10.00 tolerance), as the owner asked.

## Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale

- Found by #601 (`packages/reporting`). **Owner decision 2026-09-24: a void counts on the day it
  is made, not the day of the sale** (built in #605 for the daily close's VAT, the period VAT
  summary and top sellers). The quarterly _modelo 303_ keeps its old behaviour, pinned by a test in
  `vat-return.test.ts`, until the asesor answers `docs/compliance/asesor-questions.md` Q25 (which
  VAT period a later annulment lands in). No till screen or server route calls `recordVoid` yet.
  `stableStringify` (`src/daily-close-hash.ts`) throws on a `null`, and a key holding `undefined`
  hashes differently from the row the database stores (the column drops the key); its comment now
  states the precondition, and nothing enforces it for callers. Not fixable in a comments-only
  change: test titles still say "jsonb" (`verify-daily-close-chain.test.ts:70`), "tenant"
  (`top-sellers.test.ts:501`, `overdue-orders.test.ts:252`, `vat-summary.test.ts:233`,
  `vat-summary-period.test.ts:128`), "design §3" (`overdue-orders.test.ts:194`), "spec §12"
  (`top-sellers.test.ts:307`) and "DrizzleQueryError-style" (`record-daily-close.test.ts:342`, not
  checked). `toDr303Record` (`src/dr303.ts`) does not cross-check a monthly total against a
  quarterly period code such as "4T"; a test pins that and the one route that builds the file
  takes both from the same code, so it looks deliberate — worth the owner's eye because it is a
  tax file. The top-sellers fixtures give most lines no kitchen name, where CLAUDE.md §3 asks all
  three names to differ (top-sellers never reads that name).
  `record-daily-close.concurrency.test.ts:60` says "nothing but the write queue keeps the second
  out"; a reviewer, reading only, thinks the one-close-per-day unique constraint refuses it — not
  checked. `packages/core/src/errors.ts` names `scripts/errors-reachable.test.ts` without the hedge
  #601 gave reporting's (the guard matches text).

## Test titles still carry claims the comments no longer make (#598)

- Found by #598 (`packages/core`), not fixable in a comments-only change. Test titles still
  carry claims the comments no longer make: `incidents.test.ts:463` says orphan raises de-dup
  "via NULLS NOT DISTINCT" (PostgreSQL wording); `record-void.test.ts:340` and
  `record-correction.test.ts:443` say an ordering "never leaks an authz error", which #598's
  review did not bear out (Codex ran both orders: with the lookup first, an unauthorised caller
  tells a missing sale from an existing one by the error); and `record-sale.test.ts:888`, `:964`
  and `:1029` carry history ("legacy path unchanged", "additive, no behaviour change"). No test
  reaches `settleSale`'s catch that turns a `sale_settlements` unique-key refusal into
  `sale.already_settled` (`packages/core/src/settle-sale.ts`); #598 measured the earlier check
  stopping both concurrent-settlement tests first. `sale.number_reused` is registered in
  `packages/core/src/errors.ts` and `git grep number_reused -- apps packages` finds no thrower
  (see _Decide whether to implement `sale.number_reused`_). Outside core,
  `docs/developers/conventions-data.md` says the stored breakdown holds "the literals a fiscal
  record hashes" (#598 found the hash covers the totals, not the breakdown).

## Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts` are code, not comments

- Found by #592 (`packages/fiscal`), not fixable in a comments-only change or outside the
  package. Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts`
  are code, not comments: one points at `packages/fiscal/src/backend.ts:72` for `total: Decimal`
  (it is at line 50) and names "Task 14", and one says the breakdown column is NULL only for a
  void, while the fake's corrections and substitutions leave it NULL too.
  `FiscalBackend.pendingCount` has no caller outside the backends and their tests, yet
  `packages/db/src/schema/sales.ts:29` says it is how the count is read.
  `packages/fiscal-verifactu/src/slot.ts:51`
  says `validate` runs BEFORE `provisionVenue`, which #592 narrowed in `contribution.ts` to an
  instruction to the caller, because `apps/server/scripts/cloud-integration-fixture.ts` calls
  `provisionVenue` without it. `packages/fiscal-verifactu/src/no-regime-scope.test.ts:7` says
  `packages/fiscal`'s guard forbids ENGLISH regime terms; its list is half Spanish.
  `no-hardcoded-margin.test.ts` scans only the files directly in `packages/fiscal/src`, not
  `src/testing/`, and does not say so.

## `packages/fiscal-verifactu` code

- `packages/fiscal-verifactu` code, found by #562; not changed unless marked:
  - **`drain.ts`'s Route B lookup (`client.consultar`) — PARTLY DONE (W21, #1130).**
    - **Open:** a failed lookup, when the save reaches its line, still backs the whole batch off,
      discarding every line's outcome and the reply's receipt code (the CSV, one per
      submission), which AEAT does not send again.
  - The inner try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead: with it
    removed, the "LOGGER fails" case still passed, because `Promise.allSettled` absorbs the
    rejection.
  - Removing `appendToChain`'s nested `tx.transaction` makes no test fail (`chain.test.ts`'s
    header says so); the protection it gives a losing attempt has no test holding it.
  - `write-path.e2e.test.ts` (lines 414 and 418) points at `test/fixtures.ts:249-256` for a
    receipt of one basket hashing differently filed 16th and filed standalone, and at
    `test/write-path-fixtures.ts:37-44` for `steadyClock`. The receipt is now at
    `test/fixtures.ts:285-289` and `steadyClock` at `test/write-path-fixtures.ts:27-39`. Correct
    them only in a change allowed to touch that file.

## Reporting — the fiscal remainder (parked)

Two pre-filing caveats a human must clear before the first
LIVE 303 filing: validate the DR303 file once against the real AEAT "por fichero" uploader (we
omit página 2, régimen simplificado); and an asesor must confirm the **prorrata** treatment
(`computeInputVat` scales only the cuota by `deductible_proportion`). Deferred build slices:
rectificativas de facturas recibidas (casilla 40/41, needs a `corrects_purchase_invoice_id`
self-FK); bienes-de-inversión regularización (43); the prorrata rule (44, asesor-driven);
intra-community and import boxes (32–39); a libro-registro / Pre303 export.
