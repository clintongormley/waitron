# A802 slice 3: read an invoice's correction history and whether it may be corrected

**Status: Approved by the owner 2026-11-10 14:33 ("approve all, no old invoices exist"), all four choices below.** Slice 1 (the amount calculator,
`packages/core/src/correction-allocation.ts`) landed as #2653; slice 2 (the writer files the exact
split it is given, `packages/core/src/partial-correction-breakdown.ts`) landed as #2671
(`8f6ba75dca`).

## Authority

- **Owner, 2026-10-22 ~11:50** (lane E `archive/questions-to-2026-10-23.md`, heading "OWNER ANSWER —
  A802: the protected-writer scope is APPROVED"): approves "the read-only
  `FiscalBackend.correctionAdmissionFor` with its delegated regime reader", besides slice 2's writer
  field. "No edit to the builder/append bodies, hash, number allocator, stored records or existing
  fiscal assertions."
- **Owner, 2026-10-21 ~02:30** (design approval, recorded in the
  [design](../specs/2026-10-20-a802-partial-paid-invoice-correction-design.md)): an original whose
  filing is queued, sending, accepted or accepted with errors may be corrected; one that is refused,
  stopped or held, or whose history cannot be read, may not.
- **Owner, 2026-11-09 16:45** (lane E `questions.md`): cash first; each slice about 1,000 written
  lines including tests, naming its next capability; tests at most about twice the code.
- Slice 1's plan names this slice as successor (2): "provide reconciled original facts and `consumed`
  allocations from the old plan's Task 5 history reader, including missing-gross reconstruction and
  the minimum cash history storage it needs. Never substitute an empty history or guess allocations
  for older corrections." This plan drops the reconstruction and needs no storage; see "For the
  watcher", point 1.

## What it delivers

Staff get nothing they can use yet. After this slice the server can answer two questions about a
paid simplified invoice from what is stored, with no caller supplying amounts: **does its filing
allow a correction** (settlement and the chain's integrity are slice 4's checks), and **exactly what
would a correction of €X over these lines file**, as the lines and split `recordCorrection` takes. The end-to-end test
proves the three slices fit: the history this slice reads feeds slice 1's calculator, whose split
slice 2's writer accepts and files, three times in a row on one invoice, until the last cent.

Example: a €12.10 dish at 21% (base 10.00, VAT 2.10). Asking for €6.05, then €6.02, then €0.03 gives
base 5.00 + VAT 1.05, base 4.98 + VAT 1.04, base 0.02 + VAT 0.01, each read from the invoice and the
corrections already filed; a fourth ask for €0.01 is refused because nothing is left. Today nothing in
the product can produce those figures from a real invoice.

**What is left after this slice, so staff can use it (cash only):** slice 4, the cash acceptance —
a route the till calls with a submission id, permission and PIN checks, one transaction that files
the correction and records the cash refund, a replay record, the drawer job, and the AEAT
preproduction run of the final-cent shape (watcher 2026-11-09 19:42) before it lands; slice 5, the
till screen, the corrective paper and the guide.

## Part A — the history reader (core)

Create `packages/core/src/correction-history.ts` with
`readCorrectionAmountHistory(tx: Transaction, saleId: SaleId): Promise<CorrectionAmountHistory>`,
returning slice 1's `CorrectionAmountHistory` type unchanged:

- `lines`: every `sale_lines` row of the invoice, extras included: `id`, `lineNo`, `rate` (basis
  points to a two-place rate), `gross` (`line_gross`), `base` (`line_total`).
- `vatBreakdown`: the invoice's stored `sales.vat_breakdown`, as stored.
- `consumed`: every line of every sale whose `corrects_sale_id` is the invoice, whatever its filing
  state (the old plan's Task 2: "Earlier corrections consume budgets even if refused/held"):
  `saleLineId` = `corrects_line_id`, `rate`, `gross` = −`line_gross`, `base` = −`line_total`,
  `tax` = gross − base. A whole-invoice credit names every line (`apps/server/src/cancel-credit.ts`,
  `correctsLineId: row.id`), so it consumes everything and the calculator refuses any further amount.

Refusals, in this order: no such sale → `sale.not_found` (the code `recordCorrection` throws,
`record-correction.ts:146`); the sale is itself a corrective invoice → `sale.correction_history_unusable`;
an invoice line or an earlier correction's line with no `line_gross`, or an earlier correction line
naming no invoice line → `sale.correction_history_unusable`; and an earlier correction whose lines,
summed per rate, differ from its own stored `vat_breakdown` (gross from base plus tax, and base) →
the same code. The calculator reconciles the invoice and `consumed` (`correction-allocation.ts:146`)
but never sees earlier corrections' stored splits, which slice 2's writer checks against
(`record-correction.ts:275–280`); without this check a preview could succeed that the writer then
refuses with `sale.correction_breakdown_invalid`. Whole credits and slice 2 corrections agree by
construction; corrections filed by the legacy derived path may not.

**No missing-gross reconstruction (watcher point 1).** The design (line 136) and slice 1's plan ask
for an absent line gross to be rebuilt from the rate remainder. Every till filing path stores one:
`bill-payments.ts:749`, `till-sale.ts:1011`, `:1744`, `:1899` and `working-order.ts:7388` file
`withReceiptListPrices(priced.lines, …)`, whose `lineGross` is set at
`packages/catalogue/src/pricing.ts:162` (read 2026-11-10; confirmed by the plan review). The other
callers `git grep -n "recordSale(" -- ':!*.test.ts'` finds set no `lineGross`, and none is a
production path: the demo seeder (`apps/server/scripts/demo-seed/seed-sales.ts:300`, which refuses
production at `seed-sales.ts:173`), `apps/server/scripts/testing/sale.ts`, the fixtures in
`apps/server/src/testing/` (`backup-verification-fixture.ts`, `invoice-customer-fixture.ts`,
`order-venue.ts`, `staged-hour-crash.ts`, `synthetic-invoice.ts`) and `apps/server/test/`
(`held-setup-database.ts`, `hour-recovery-host.ts`), and
`packages/fiscal-verifactu/test/live-conflict-fixture.ts`. The one filing without it is the setup
readiness test sale (`packages/provisioning/src/fiscal-readiness-runner.ts:112`), which no one
corrects. Until go-live no data is carried forward (root CLAUDE.md §3), so such history is refused,
not rebuilt. Step 1 re-runs this search on the build base before relying on it.

Slice 2's writer keeps its own reads and checks (`record-correction.ts:236–290`): it re-checks
whatever a caller hands it, so it does not take this reader's word.

## Part B — admission (the regime decides)

As the old plan's [Task 4](2026-10-22-a802-partial-paid-invoice-correction.md#task-4-let-the-regime-decide-admission-without-teaching-core-its-tables),
the approved interface:

- `packages/fiscal/src/backend.ts`: optional
  `correctionAdmissionFor?(tx: Transaction, saleId: SaleId, issuingNodeId: NodeId): Promise<CorrectionAdmission>`
  (`issuingNodeId`: the box that would issue the correction),
  with `CorrectionAdmission` =
  `{ eligible: true; filing: "queued" | "sending" | "accepted" | "accepted_with_issues"; original: { number: string; issuedAt: string } }`
  or `{ eligible: false; reason: "unsupported" | "missing" | "wrong_node" | "voided" | "not_simplified" | "filing_refused" | "filing_versions_unusable" }`.
  A backend without the member counts as `unsupported`. Exported from the fiscal barrel.
- Create `packages/fiscal-verifactu/src/correction-admission.ts`, delegated from `VerifactuBackend`.
  It reads the sale's records in `registros_facturacion` by `sale_id`. A refused filing that was fixed
  (subsanación) leaves two altas for one sale, the second pointing at the first
  (`chain.ts:235–268`, `record-remedy-http.ts:168`), and the writer already files against the latest
  (`fiscal-verifactu/backend.ts:510–518`); admission does the same: it judges the **latest alta
  version** and **that version's** `envios.estado`. Eligible only for an F2 (simplified) alta filed by
  this node, with no cancellation (anulación) carrying the sale's `sale_id`, whose latest submission
  is `pendiente`/`enviando`/`aceptado`/`aceptado_con_errores` (the four `filing` values).
  `rechazado`, `detenido`, `retenido` → `filing_refused`; no alta or no submission → `missing`;
  another node's → `wrong_node`; F1, F3 or an R type → `not_simplified`; a cancellation → `voided`
  (it covers core voids, written in the same transaction, `record-void.ts:88,103`, and the remedy
  path's cancellation, which writes no `sale_voids` row, `record-remedy-absent.ts:134`;
  `recordCorrection`'s `sale_voids` check, `record-correction.ts:150`, stays the writer's backstop);
  versions that do not form one line of fixes → `filing_versions_unusable`. A zero-total invoice is not
  admission's concern: the calculator refuses an amount when nothing has value.
- **Substitution is read in core, not the regime.** The regime stores it only inside the F3's
  `facturas_sustituidas`, which no index covers (the plan review's EXPLAIN: a scan of every record),
  while core's `sale_substitutions` has a unique index on `substituted_sale_id`. `recordCorrection`
  does not check substitution, so Part C refuses a substituted invoice (`reason: "replaced"`) from
  that table before asking the regime.
- `packages/fiscal-none/src/backend.ts` returns `unsupported`; the fake backend in
  `packages/fiscal/src/testing/fake-backend.ts` returns a result the test sets, eligible by default.
- No change to `recordCorrection`, the record builders, chain append, hash, numbering or any stored
  row. `checkIntegrity` and settlement are not admission's: slice 4's service checks them, as the old
  plan's Tasks 4 and 7 say.

## Part C — one entry point, and the proof the slices fit

In `correction-history.ts`, `previewCorrectionAmounts(tx, backend, saleId, issuingNodeId, selection)`:
the substitution check, then admission (an ineligible result, or a substituted invoice, throws
`sale.correction_not_admitted` with `{ reason }`, a new code beside slice 1's), then the reader, then
slice 1's `allocateCorrectionAmounts`. It returns the calculator's `CorrectionAmountPreview`, the
admission's `filing` and `original`, and the correction's `lines: RecordSaleLine[]` ready for
`recordCorrection`: one per allocation, copying the invoice line's frozen name, descriptions, unit,
`priceQuantity`, variant and option snapshots, `unitPrice` and rate; `quantity` the negated invoice
line's quantity (an amount correction's quantity is the scope shown, never units returned, as
slice 2's plan says); `lineTotal` −base, `lineGross` −gross, `correctsLineId` the invoice line. The
end-to-end test and slice 4 both file exactly these, so neither invents its own. Export it and
`CorrectionPreview` from `packages/core/src/index.ts` (the admission type is exported by
`@waitron/fiscal`): slice 4's server service is its production
consumer and the end-to-end test in `fiscal-verifactu` needs it (slice 1 kept the index unchanged
until a consumer existed; this is the point where one does).

## Files and size

Create `packages/core/src/correction-history.ts` and its `.test.ts`;
`packages/fiscal-verifactu/src/correction-admission.ts` and its `.test.ts`;
`packages/fiscal-verifactu/src/correction-history.e2e.test.ts`. Modify `packages/fiscal/src/backend.ts`
(+ barrel), `packages/fiscal-verifactu/src/backend.ts` (one delegating member),
`packages/fiscal-none/src/backend.ts`, the fake backend, `packages/core/src/errors.ts` (one code),
`packages/core/src/index.ts`. No schema, no migration, no generated files.

**Budget: about 380 code lines, about 700 test lines, about 1,100 total** (raised after the plan
review added fixed originals, the core substitution check, the earlier-split check and the line
builder). Stop for an outside opinion past 1,400 written lines or tests past twice the code. If Part B alone passes about 450 lines, split
it into its own PR at the `CorrectionAdmission` interface and say so in questions.md first.

## Steps (test first; implementer dispatches at medium)

1. **Re-check the premises on the build base.** Re-run the `recordSale(` caller search above and the
   `lineGross` source; confirm no production caller files a line without it besides the readiness
   test sale. Run the golden pair and slice 1–2 suites unedited as the baseline.
2. **Reader, failing first** (`correction-history.test.ts`, `useVenueDb`, real core writers): an
   invoice with two rates and an extra line; read with no corrections (empty `consumed`), after a
   slice 2 exact correction (its lines consumed per invoice line, exact cents), after a whole-invoice
   credit (all consumed). Table refusals, each a one-field change to a history the same test reads:
   unknown id, a corrective invoice's id, an invoice line with null gross, an earlier correction line
   with null gross, one naming no line, an earlier correction whose lines disagree with its own stored
   split at one rate. The line builder: frozen facts copied, signs, quantity, `correctsLineId`, an
   extras line keeping its rate. One case per property; the calculator's reconciliation is not
   re-tested here.
3. **Admission, failing first** (`correction-admission.test.ts`, real Verifactu backend and
   migrations): an F2 in each of the seven submission states (four eligible with their `filing`, three
   `filing_refused`); a refused F2 fixed by a subsanación whose new version is queued (judged on the
   new version); cancelled by a core void and by the remedy path's cancellation; F1; an R5; another
   node's; no record. In core, a substituted invoice refused before the regime is asked. (As built,
   the remedy-path cancellation case was cut under the owner's 2026-11-09 test rule: the core-void
   case covers the branch, and `record-remedy-absent.test.ts` asserts the sale's id on that
   cancellation.) Each
   refusal beside an eligible control that differs in one fact. fiscal-none and the fake: one case
   each. Guards: `scripts/module-seams.test.ts`, `packages/fiscal/src/no-regime-vocabulary.test.ts`.
4. **End to end, failing first** (`correction-history.e2e.test.ts`, real core writers, real Verifactu
   backend, the library's `validate`): the €12.10 invoice above, three rounds of
   `previewCorrectionAmounts` then `recordCorrection` with the preview's own lines and split; assert each stored and filed
   figure exactly, then the €0.01 refusal. Ten €1.20 coffees at 21%, each on its own line (base 9.90, VAT 2.10; one line of quantity 10 would store base 9.92): €11.98 then
   €0.02, the last filing base 0.00, VAT −0.02. A refused original (`rechazado`) is refused by the
   preview before any read of history. The original sale, lines and record are unchanged throughout.
5. **Nothing else moves.** Golden huella and `inmutabilidad` unedited
   (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
   `… inmutabilidad`); slice 1's `correction-allocation.test.ts`, slice 2's
   `partial-correction-breakdown.test.ts` and `partial-correction-gross.e2e.test.ts`,
   `record-correction.test.ts`, `correction-path.e2e.test.ts`, `correction-amount.huella.test.ts`
   unedited; `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts`; typecheck core,
   fiscal, fiscal-verifactu, fiscal-none and apps/server (the backend interface widens).
6. **Plans of the new reads.** EXPLAIN each new query on a migrated database with no planner
   statistics; only one that does not use the index its `where` names gets `indexed by` and a plan
   test, as #2704 did (root CLAUDE.md §3, A1469). The plan review found every by-sale record read
   already picks `registros_sale_idx`, so none is expected. This slice does not depend on #2711.

## Left out

No route, screen, paper, refund, drawer, replay record or permission check (slice 4–5). No
reservation of capacity: cash acceptance files and refunds in one transaction, so nothing waits
between preview and filing. No Items mode, A758 link, card refund or historical gross rebuild. No
change to slice 2's writer or slice 1's calculator.

Demo-seeded sales and the server test fixtures above store no line gross, so the reader refuses
them. Slice 4 gives the fixtures its tests use a line gross (a fixture gaining a missing field). The
demo seeder also splits VAT per rate from summed bases, and its golden file
(`seed-sales.golden.test.ts`) forbids re-recording, so making demo sales correctable is a question
for the owner when slice 5's screen is planned.

## For the watcher

1. **No missing-gross reconstruction.** Slice 1's plan and the design (line 136) require it, and the
   lane rejected the refuse-instead alternative on 2026-11-09 for that reason (lane E `questions.md`
   line 210). I recommend reversing that: every till filing path stores the gross (receipts in Part A),
   so the rebuild could only ever run on the setup readiness test sale or on data from before a venue
   reset, and root CLAUDE.md §3 forbids carrying such data forward before go-live; after go-live every
   invoice has one. Such history is refused with `sale.correction_history_unusable`. The design gets a
   dated pointer. The alternative is to build the receipt reader's remainder rule
   (`apps/server/src/transaction-receipt.ts:40–65`) into core here, about 60 more lines.
2. **A fixed original.** A refused filing fixed by a subsanación is judged by its newest version: if
   that is queued, sending or accepted, it may be corrected. I recommend this (it is what the writer
   already files against); the alternative is to refuse any invoice ever refused.
3. **Admission in this slice.** The queue names this slice "read an invoice's history"; I have added
   the approved admission reader because slice 4 needs both, the end-to-end proof calls both, the owner
   asked for slices of about 1,000 lines rather than many small PRs, and both are read-only. The
   alternative is the reader and Part C without admission (about 550 lines) and admission inside
   slice 4. I recommend this plan as written.
4. **Landing.** Like slices 1 and 2, staff cannot use this slice. The owner's 18:06 permission to land
   a foundation on its own named slice 1, and the 19:57 one slice 2. I recommend this one lands on its
   own too, owner-landed; the alternative is to hold it open until slice 4.

**Plan review, 2026-11-10 (fresh-context Opus, lane L).** It read the design, the old plan, both
landed slice plans and the code, and ran slice 1's calculator on every figure above: all match. Its
three high findings (fixed originals refused, the dropped reconstruction hidden in a quote, an
unindexed substitution lookup) and four medium ones (cancellation mapping, earlier corrections'
stored splits, a dependency on unlanded #2711, the line builder) are written into this revision.
