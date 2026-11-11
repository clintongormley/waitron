# A802 slice 3: read an invoice's correction history and whether it may be corrected

**Status: R1–R5 cleared by the watcher 2026-11-10 16:23 with four changes, and the owner's three
questions answered 16:26–16:28; both are written into the
[revision](#clearance-and-answers-2026-11-10-1623-1628). Slice 3b is cleared to build after this slice.**
Parts B and C were built before the runner read the owner's instruction: the watcher wrote its note
at 15:43; the runner, in a firing that started at 15:00, did not read it until 15:48; Part B
(15:15), Part C (15:22) and the review-fix round (15:47) were committed in that window. The
owner approved the first version 2026-11-10 14:33 ("approve all, no old invoices exist"), all
four choices below; the
[revision at the end](#revision-2026-11-10-second-review-and-the-owners-1543-instruction) changes
Parts B and C, adds slice 3b, and asks the owner two questions. Slice 1 (the amount calculator,
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

**What is left after this slice, so staff can use it (cash only):** slice 3b (revision, section D):
a correction of an invoice whose fix changed its figures, filed at the fix's figures, which needs
the owner's approval of a change to the protected writer; and the top-sellers report counting an
amount correction as money, not dishes. Then slice 4, the cash acceptance —
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
the same code. The calculator reconciles the invoice and `consumed` (`correction-allocation.ts:165–232`)
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
  (`fiscal-verifactu/backend.ts:520–529`); admission does the same: it judges the **latest alta
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
- **(Superseded by the clearance's point 1: a separate `filedFiguresFor`; admission unchanged.)**
  **Revised 2026-11-10 (finding 1).** The eligible answer also carries `filed: { total: Decimal;
  vatBreakdown: VatBreakdownLine[] }`, the judged version's total and split read from the same row
  (`desglose`, `importe_total`, `cuota_total`), the same figures for the latest version of each
  earlier corrective invoice core names, and a new refusal reason `filed_figures_unreadable`.
  Rules in the revision, section A.
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
`recordCorrection`: one per allocation, copying every field the whole-invoice credit copies
(`apps/server/src/cancel-credit.ts:83–117`, checked by `satisfies Required<RecordSaleLine>`), so the
category, reporting classification, product, parent product, menu and kitchen name are kept
(finding 2, built in Part C's first build); `quantity` the negated invoice
line's quantity (an amount correction's quantity is the scope shown, never units returned, as
slice 2's plan says); `lineTotal` −base, `lineGross` −gross, `listGross` null (a part of a line has
no list gross), `correctsLineId` the invoice line. **Revised 2026-11-10:** after admission, the
preview compares the filed figures with the stored ones, for the invoice and for each earlier
corrective invoice of it; when any differ it refuses with
`sale.correction_not_admitted { reason: "filed_figures_changed" }` until slice 3b files such a
correction at the fix's figures (revision, section A). The
end-to-end test and slice 4 both file exactly these, so neither invents its own. Export it and
`CorrectionPreview` from `packages/core/src/index.ts` (the admission type is exported by
`@waitron/fiscal`): slice 4's server service is its production
consumer and the end-to-end test in `fiscal-verifactu` needs it (slice 1 kept the index unchanged
until a consumer existed; this is the point where one does).

## Files and size

Create `packages/core/src/correction-history.ts` and its `.test.ts`;
`packages/fiscal-verifactu/src/correction-admission.ts` and its `.test.ts`;
`packages/fiscal-verifactu/src/filed-figures.ts` (tested in `correction-admission.test.ts`);
`packages/fiscal-verifactu/src/correction-history.e2e.test.ts`. Modify `packages/fiscal/src/backend.ts`
(+ barrel), `packages/fiscal-verifactu/src/backend.ts` (one delegating member),
`packages/fiscal-none/src/backend.ts`, the fake backend, `packages/core/src/errors.ts` (one code),
`packages/core/src/index.ts`. No schema, no migration, no generated files.

**Revised 2026-11-10:** built so far, 347 code lines and 877 test lines (`git diff --numstat
origin/main...HEAD`, plan excluded); the revision adds about 65 code and 150 test lines (section D),
about 1,440 in all, past the 1,400-line stop unless step R4's cuts land (section D says what moves).
Tests are already about 2.5 times the code, past the owner's "at most about twice"; the lane cuts
cases another test covers before landing and, if it cannot reach about twice, says so in the PR.

**Budget: about 380 code lines, about 700 test lines, about 1,100 total** (raised after the plan
review added fixed originals, the core substitution check, the earlier-split check and the line
builder). Stop for an outside opinion past 1,400 written lines or tests past twice the code. If Part B alone passes about 450 lines, split
it into its own PR at the `CorrectionAdmission` interface and say so in questions.md first.

**2026-11-10 (watcher, 18:35):** the stop is now about 2,100 written lines, plan excluded.

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
   **Revised 2026-11-10:** the filed figures and their refusal (revision, section D, step R1).
3a. **The preview, Part C, failing first** (in `correction-history.test.ts`, the fake backend):
   an admitted preview returns the admission's `filing`, `original` and the built lines; no regime
   member answers `unsupported`; a substituted invoice is refused before the regime is asked
   (all built in Part C's first build). **Revised 2026-11-10:** filed figures that differ from the
   stored ones are refused (section D, step R2).
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
change to slice 2's writer or slice 1's calculator in this slice; slice 3b asks to change the
writer (revision, section A).

Demo-seeded sales and the server test fixtures above store no line gross, so the reader refuses
them. Slice 4 gives the fixtures its tests use a line gross (a fixture gaining a missing field). The
demo seeder also splits VAT per rate from summed bases, and its golden file
(`seed-sales.golden.test.ts`) forbids re-recording, so making demo sales correctable is a question
for the owner when slice 5's screen is planned.

## For the watcher

1. **No missing-gross reconstruction.** Slice 1's plan and the design (line 136) require it, and the
   lane rejected the refuse-instead alternative on 2026-11-09 for that reason (lane E `questions.md`
   line 116: "its nullable-gross refusal alternative is not adopted because the design requires
   reconciled reconstruction in the later history slice"). I recommend reversing that: every till filing path stores the gross (receipts in Part A),
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

## Revision 2026-11-10 (second review and the owner's 15:43 instruction)

**Inputs.** The second review, `~/waitron-campaign-l/receipts/a802-slice3-fable-review.md`
(findings 1–8, read against Part A's first build only). The owner's instruction,
`~/waitron-campaign-shared/desk/done/20261110-1543-a802-slice3-fable-review.md` and lane L
`questions.md` "WATCHER 2026-11-10 15:43". The owner's words: "I'm not sure what you mean here.
what would you be refusing, because we need to be able to do the refund, albeit with the right VAT
figures", then "y" to: every correction is measured against the latest version the tax agency
accepted; where a fix changed the split or total, the amounts and rates at each VAT rate come from
that fix, not the frozen sale rows; a full refund then nets every rate at the agency to zero. A
fresh-context review of this revision's first draft found one critical and three
important gaps; they are written in below.

### Clearance and answers (2026-11-10 16:23–16:28)

Lane L `questions.md`, "WATCHER 2026-11-10 16:23" (a watcher decision for slice 3) and the owner's
answers relayed at 16:26, 16:27 and 16:28 (`~/waitron-campaign-shared/desk/done/20261110-1623-L-a802-q1-fixed-invoice-refund.md`,
`…-q2-returned-dishes-vat.md`, `…-q3-refund-before-aeat-answers.md`). They override anything below
that disagrees.

1. **One read of the filed figures, `filedFiguresFor`, built in R1** and shared by the preview
   (slice 3) and the writer (slice 3b). `correctionAdmissionFor` is not widened: it keeps its
   current answer. Shape, in `@waitron/fiscal` beside `CorrectionAdmission`, in neutral terms:
   `filedFiguresFor?(tx, saleIds: readonly SaleId[]): Promise<ReadonlyMap<SaleId, FiledFigures>>`,
   where `FiledFigures` is `{ readable: true; newest: FiledVersionFigures; newestAnswered:
   FiledVersionFigures | null } | { readable: false }` and `FiledVersionFigures` is `{ total:
   Decimal; vatBreakdown: VatBreakdownLine[] }`. **Newest** is the version admission judges (the
   one alta of the sale no other alta names in `corrects_registro_id`); **newest answered** is the
   newest version in that line of fixes whose submission is accepted or accepted with errors, or
   null. A sale with no alta is absent from the map. `readable: false` when the sale's altas do not
   form one line of fixes, or when either version's `desglose` is not the shape `toDetalleDesglose`
   writes (`fiscal-verifactu/src/backend.ts:146–154`): a detail with an exemption, a not-subject
   amount, an equivalence surcharge, another tax or regime, or a missing rate or VAT amount; two
   details at one rate; or details whose bases plus VAT do not equal `importe_total`, or whose VAT
   does not equal `cuota_total`. One query for all ids, through `registros_sale_idx`. fiscal-none
   leaves it out (admission already answers `unsupported` there); the fake backend answers from the
   stored `sales.total` and `sales.vat_breakdown` for both versions, with a setter to override one
   sale. (As built: one query per 1,000 sale ids, and the fake backend answers from its own filed
   records; see [As built](#as-built-2026-11-10).)
2. **Option C is dropped** from question 1, and with it design point 3's "slice 4 … ships with this
   refusal": the owner rejected refusing ("we need to be able to do the refund"). The refusal of a
   moved invoice is slice 3's only, until slice 3b.
3. **Slice 3b's tests**: end to end, only the replay (21% filed, refused, fixed to 10%, full refund,
   every rate zero) and one part refund. The queued-fix refusal, the part amount refused when the
   fix changed the total, and the control where the fix kept the figures are tested ONCE each, in
   core, with the fake backend (the owner's 9 November test rule).
4. **Owner's answers.** Q1 **A**: the protected writer reads the figures AEAT accepted, through
   `filedFiguresFor` (the protected-writer approval for slice 3b; cite the Q1 file in its PR). Q2:
   **keep the running split**; no change (cite the Q2 file in the PR). Q3: **allow** a correction
   while the invoice's filing is queued or sending, as the 21 October design says, moved or not,
   measured against the newest version; a moved invoice whose newest version is a fix not yet
   answered is still refused in slice 3b (point 3's queued-fix case), because nothing has yet been
   accepted to measure against. The limit, in one line: **a refund filed before AEAT refuses the
   sale, whose fix then changes its VAT split, stays out of balance at AEAT and nothing repairs
   it.**

   **The same harm the other way round, a gate on switching the fix screens on** (second read,
   2026-11-11, finding 1; older than slice 3b; the watcher took option (b) and the owner is asked
   whether it is right). An order cancelled after AEAT refused its invoice but before a fix is
   accepted files a credit at the old split: with nothing accepted the cancellation measures
   against the stored figures, and a refused newest version does not wait. A fix accepted later
   then leaves both rates wrong at AEAT (measured by the second reader on the real backend: 10%
   +11.00/+1.10, 21% −10.00/−2.10). Refunds are protected, because the preview asks whether the
   invoice may be corrected and a refused filing answers no; the cancellation never asks. Dormant
   until the fix screens are switched on (`ENABLED_REMEDIES` is empty). Before they are, one of:
   the till refuses such a cancellation, or the fix screen warns that a cancellation credit at the
   old split exists.

**Slice 3 after this clearance.** `previewCorrectionAmounts`: substitution check → admission (as
built) → read the earlier correctives' ids → `filedFiguresFor` for the invoice and each corrective
→ any id absent or `readable: false` refuses `sale.correction_not_admitted { reason:
"filed_figures_unreadable" }`; any whose **newest** figures differ from its stored ones (rates, base
and VAT at each rate to the cent, total) refuses `{ reason: "filed_figures_changed" }` → the
calculator as built. `newestAnswered` is unused until slice 3b.

**Words used.** The **split** is the base (price before VAT) and the VAT at each VAT rate. A
**corrective invoice** is the new negative invoice that takes value off an earlier one (type R5).
A **fix** is a second version of a filing the agency refused (or accepted with errors), sent again
with corrected contents (in Spanish, a subsanación). **Admission** is the tax regime's answer to
"may this invoice be corrected?" (Part B). The **stored figures** are Waitron's own
`sales.vat_breakdown`, `sales.total` and `sale_lines` for a sale, written once and never changed.
The **filed figures** are the total and split of a sale's latest filed version. A sale is **moved**
when its filed figures differ from its stored ones. An **answered** version is one the agency has
accepted, with or without errors. The **writer** is slice 2's `recordCorrection`; the
**calculator** is slice 1's `allocateCorrectionAmounts`.

### A. Finding 1: every correction is measured against the filed figures

**What I ran** (temporary tests in `packages/core`, deleted; `git status` clean after each):

- The writer's two split checks on a €12.10 dish stored at 21% and fixed to 10%. Lines at 10% with
  a 10% split: `checkPartialCorrectionBreakdown` accepts, then `checkPartialCorrectionHistory`
  refuses with `sale.correction_breakdown_invalid` (a line's rate must be its invoice line's,
  `partial-correction-breakdown.ts:146`). Lines at the stored 21% with a 10% split:
  `checkPartialCorrectionBreakdown` refuses with the same code (lines must sum to the split at each
  rate, `:81–103`). Had the writer accepted the fix's rate, either would have printed "passed".
- The calculator given the stored 21% line and the fix's 10% split refuses with
  `sale.correction_history_unusable` (`correction-allocation.ts:190–206`). Given instead one
  stand-in line per filed rate (10%: base 11.00, VAT 1.10; 21%: base 10.00, VAT 2.10), it took
  €5.00, €7.77 and €11.43 as `[10%: 2.27/0.23, 21%: 2.07/0.43]`, `[3.54/0.35, 3.20/0.68]`,
  `[5.19/0.52, 4.73/0.99]`, ending at exactly 11.00/1.10 and 10.00/2.10, and refused one more cent
  (`sale.correction_amount_invalid`). The landed calculator needs no change to work per rate
  against a fix's split.
- The reviewer's gap in the writer, re-run: `checkPartialCorrectionHistory` with the invoice split
  10% 11.00/1.10, an earlier correction at 21% (−5.00/−1.05) and a new 10% correction
  (−5.50/−0.55) **passes**; the control with the 10% budget already used refuses
  `sale.correction_breakdown_invalid`. Its per-rate loop runs only over the new split's rates
  (`partial-correction-breakdown.ts:163–181`), so an earlier correction at another rate is never
  compared.
- The older derived path's VAT working, re-run: `deriveVatBreakdown("-6.05", [one 10% line, base
  −5.50])` gives `[10.00, −5.50, −0.55]`, and `deriveVatBreakdown("-12.00", [one 10% line, base
  −11.00, gross −12.10])` returns a split summing to −12.10 with no refusal
  (`record-sale.ts:148–158`, from `e56323007c`, #982, 2026-10-01). The reviewer ran the whole
  unchanged writer on that path (I did not): two €6.05 corrections of a 21% invoice, lines naming
  its line, each stored `[10.00, −5.50, −0.55]`, netting a fix's 11.00/1.10 exactly; one more cent
  refused with `sale.correction_exceeds_total`; and a corrective of total −12.00 with lines summing
  −12.10 accepted.

**Where the fix's figures live.** The fix route accepts any filed invoice record (`alta`) of this
box's history, corrective invoices included (`fiscal-verifactu/src/record-remedy-http.ts:56–62`),
builds the new version's `Desglose` (the split as the agency receives it), `CuotaTotal` (VAT total)
and `ImporteTotal` (invoice total) from the administrator's facts, falling back to the earlier
version's (`:129–131`), and links it to the version it replaces (`:168`; chain check
`chain.ts:235–268`). They are stored on that row of `registros_facturacion` (`desglose`,
`cuota_total`, `importe_total`, `schema/registros.ts:83, :90–91`). Nothing changes `sales` or
`sale_lines` (the review's run: the stored split stayed `[21.00, 10.00, 2.10]` after the fix). The
regime already turns a stored `Desglose` back into the neutral `VatBreakdownLine` (rate, base, tax)
for receipts (`fiscal-verifactu/src/backend.ts:408–416`, the inverse of `toDetalleDesglose`,
`:146–154`), for the FIRST version only (`:396–397`).

**A fix of an earlier corrective invoice (the review's critical finding).** What earlier corrections
took is read from each corrective's stored split, by the reader (`readHistory` in
`correction-history.ts`) and by the writer (`record-correction.ts:275–280`), never from what was
filed. A part corrective refused by the agency (plausible for the final-cent shape, base 0.00 with
VAT only) and fixed with
different figures is then counted at its old figures, and a full refund leaves rates off zero. So
every check below covers the invoice AND each earlier corrective of it.

**Design.**

1. **(Superseded by the clearance's point 1: a separate `filedFiguresFor`, admission unchanged.)**
   **The regime returns filed figures with admission** (slice 3). Core first reads the ids of the
   invoice's earlier corrective invoices (it already reads them, in `readStored`;
   the read moves before admission) and passes them to `correctionAdmissionFor`. Admission already
   reads the invoice's rows and picks its latest version (`correction-admission.ts:28–52`); it now
   also reads that row's `desglose`, `cuota_total` and `importe_total`, and the same for the latest
   version of each named corrective (each by its indexed `sale_id`, so the regime never reads core's
   correction column), and returns them on an eligible answer as `filed: { total, vatBreakdown }`
   and `filedCorrections: { saleId, total, vatBreakdown }[]`, in the neutral `VatBreakdownLine`
   type `@waitron/fiscal` already exports (`packages/fiscal/src/vat-breakdown.ts:5`). No Veri*Factu
   word reaches core; `scripts/module-seams.test.ts` and
   `packages/fiscal/src/no-regime-vocabulary.test.ts` stay as they are. A version whose split
   Waitron cannot express is refused with the new reason `filed_figures_unreadable`: any detail
   other than the shape `toDetalleDesglose` writes (an exemption, a not-subject line, equivalence
   surcharge, another tax or tax regime, a missing rate or VAT amount), two details at one rate, or
   details that do not sum to `ImporteTotal` and `CuotaTotal`. This stays inside the owner's
   2026-10-22 approval of a read-only admission member with its regime reader (Authority, first
   bullet); the watcher should say if it reads otherwise.
2. **Core compares** (slice 3, in `previewCorrectionAmounts`): for the invoice and each earlier
   corrective, the same rates, at each rate the same base and VAT to the cent, and the same total.
   When nothing is moved (every sale never fixed, and every fix that kept the figures) the path
   already built runs, unchanged: the writer's checks against stored splits are then checks against
   filed ones.
3. **Anything moved is refused in slice 3** (`sale.correction_not_admitted`, reason
   `filed_figures_changed`). No member of staff meets this refusal before slice 4 (nothing files a
   correction from the till until then), and slice 3b, which the owner chose, lifts it first.
4. **Slice 3b, design A (recommended): file at the fix's figures through a changed writer.**
   - **When.** A moved invoice is admitted only once its fix has the agency's answer (accepted, or
     accepted with errors). Measuring against a fix still queued is not harmless: if the agency
     then refuses the fix, it holds the earlier version or nothing, and a corrective filed at the
     fix's figures leaves rates unbalanced with no repair. An invoice never moved stays correctable
     while queued or sending, as the approved design says. Moved correctives are counted at their
     answered version's figures the same way.
   - **The split** comes from the filed figures. The calculator runs over one stand-in line per
     filed rate (the probe above); what earlier corrections took at each rate is read from their
     filed figures, not their stored splits.
   - **The lines** stay Waitron's own record of what goes back for which dish: the calculator's
     allocation over the stored invoice lines for the same amount, at those lines' stored rates,
     with finding 2's field set. The agency never sees lines (the corrective's `Desglose` is built
     from its split alone, `backend.ts:545`); receipts and reports read them. The corrective's
     lines and split then disagree rate by rate, as the fixed invoice's own lines disagree with its
     accepted version. Both ledgers reach zero together: the agency's at every rate, Waitron's on
     every line, so the category and top-sellers reports net to zero on a full refund.
   - **Capability cuts** (both depart from the owner's 18 October scope, "Select wrong lines and
     quantities, or enter an amount"; the owner's question below asks about them): on a moved
     invoice staff cannot choose dishes, because the fix's split does not say which dish went to
     which rate (only an amount, spread over the rates in proportion to what is left at each, or the
     full refund; a request naming lines is refused with `sale.correction_scope_invalid { reason:
     "filed_figures_changed" }`); and when the fix changed the total, only the full refund is
     offered (for example a fix to 10%, base 10.00, VAT 1.00, total €11.00 on a sale stored and paid
     at €12.10: the corrective files −10.00/−1.00, total −€11.00, and takes all −€12.10 of the stored
     lines; a part amount is refused, since no rule says how much of each ledger a part takes). The
     cash handed back is the corrective's total; whether it may differ from what the customer paid
     is slice 4's settlement question, put to the owner in its plan.
   - **What "consumed" means.** Two budgets: at each rate, what earlier correctives took by their
     filed figures; on each invoice line, the sum of earlier correction lines' gross
     (`partial-correction-breakdown.ts:128–141`). Not moved, they agree (the reader's check in
     `readHistory`). Moved, they are kept separately and the reader skips that
     agreement check. An earlier correction at a rate the filed split lacks (filed before a fix
     that moved the split) is refused with `sale.correction_history_unusable`: the calculator finds
     no stand-in line for its rate (`correction-allocation.ts:207–217`, the test at `:210`), and the
     writer must refuse it too (scope point 4b; today it does not, as the run above shows). The
     agency's figures are then already out of balance; the administrator's fix screen is where that
     is repaired. Rare, and nothing wrong is filed.
5. **Slice 3b, design B (no protected change): full refund only, through the older derived path.**
   Core builds one line per filed rate at that rate, its base the rate's remaining filed base,
   naming an invoice line, and passes no split; the unchanged writer works out each rate's VAT by
   rounding its base (`record-sale.ts:126–138`). Core refuses when the fix's remaining VAT is not
   what that rounding gives (the final-cent shape, base 0.00 with VAT only, never is) or when the
   total moved. Cost: no part amounts and no dish choice on a moved invoice; Waitron's lines put
   all the money on the named dish; and that path re-checks almost nothing, as the runs above show
   (a −12.00 corrective with −12.10 of lines was accepted; that weakness is from `e56323007c`,
   #982, 2026-10-01, and this branch does not touch it).

**Why design A changes the writer.** The writer's three paths cannot file a split other than the
stored one with its exactness checks: the part path refuses (the runs above); the whole-invoice path
files the stored split negated (`record-correction.ts:138, :454–458`, read, not run); the derived
path works out VAT by rounding and checks nothing against the invoice (design B lives with that).

**Reports and reprints (outside A802).** The modelo 303 VAT return reads the filed per-rate sum
"over the filed `sales.vat_breakdown`" (`packages/reporting/src/vat-return.ts:14–16`, through
`vat-summary.ts:54, :64`, since `4cd53ebb21`, 2026-09-25), so it shows a fixed invoice's first
version, not the accepted one; a reprinted receipt does too (`backend.ts:396–397`, since
`fe080412c5`, 2026-11-02). Both predate this branch. After slice 3b, a full refund of a moved
invoice nets to zero at the agency, but the VAT return shows the original at its old rate and the
corrective at the new one. Not A802's to fix (a wrong VAT return could cost a filing): the watcher
queued it at 16:26 as its own item, A1481, in lane L after slice 3b, its backlog entry to come with
its first pull request; `docs/backlog.md` does not name it yet. The derived path's weakness joins
the A802 bundle in `docs/backlog/fiscal.md` ("Nothing in the product can issue a corrective
invoice…") when slice 3b lands.

**The tests.**

- Slice 3 (step R5, in `correction-history.e2e.test.ts`): the real fix route moves a sold
  invoice's split to 10%, then the preview refuses with `filed_figures_changed`.
- Slice 3b (`packages/fiscal-verifactu/src/correction-filed-figures.e2e.test.ts`: real core
  writers, the real Veri*Factu backend, the real fix route as `record-remedy-http.test.ts` drives
  it, the library's `validate`), design A:
  - The review's experiment replayed: a €12.10 dish filed at 21%, refused, fixed to 10% (base
    11.00, VAT 1.10, total unchanged), the fix accepted; then a full refund. The corrective's split
    is `[10.00, −11.00, −1.10]` with no 21% line; `validate` finds nothing; summing the accepted
    version and every corrective at each rate, every rate ends at exactly zero. The invoice line
    ends at zero gross; one more cent is refused.
  - A part correction of the same invoice: €6.05 then €6.05, each 10% −5.50/−0.55, every rate zero
    at the end; a request naming a line is refused.
  - The same invoice with its fix still queued: refused until the fix is accepted.
  - The fix changed the total (10%, 10.00/1.00, €11.00): a part amount is refused; the full refund
    files −10.00/−1.00, total −€11.00, its lines −€12.10; every rate at the agency zero.
  - A part corrective refused and fixed to different figures: the next preview and the writer
    count the fix's figures, and a final full refund leaves every rate at zero.
  - Control: a fix that kept the figures takes the ordinary path, choosing dishes allowed.
  - With scope point 5 approved: cancelling an order whose moved invoice was issued files the fix's
    split.

**Size.** Slice 3: about 65 code and 150 test lines added (section D). Slice 3b, finding 1's part
(design A): about 150 code (writer and checkers about 60, the regime member about 20, core's moved
path about 60, the answered-version rule about 10) and 400 test lines (the end-to-end file about
230, writer and checker cases about 110, core about 60).

### The owner's questions

**Question 1: how may a correction of a fixed invoice whose figures changed be filed?**

- **A (recommended): change the protected writer** as listed below; part amounts and full refunds
  at the fix's figures, every rate exact.
- **B: no protected change**; full refund only, at the fix's figures, through the older derived
  path, refused when rounding cannot give the fix's figures or the total changed; that path's
  weak checks (above) stay.
(Option C, keeping such invoices refused, was dropped by the watcher at 16:23; the owner chose A.)

Under A or B, two cuts from the owner's 18 October scope ("Select wrong lines and quantities, or
enter an amount"): no choosing dishes on a moved invoice, and only the full refund when the fix
changed the total. And slice 3b's tests come to about three times its code (about 400 against 150
under A), past the owner's "at most about twice", because the replay the owner asked for is about
230 lines on its own: may 3b exceed it, or should the replay drop its control and queued cases?

**The exact writer change under A, and nothing else** (no change to the record builders, chain
append, hash, numbering, stored rows or the corrective's filing shape):

1. **(Superseded by the clearance's point 1 and [As built](#as-built-2026-11-10): built in slice 3,
   answering the newest and the newest answered version.)** A new optional, read-only fiscal
   backend member, `filedFiguresFor(tx, saleIds)`, returning for
   each sale the figures of its newest **answered** version, or nothing when no version is
   answered; the regime answers it with admission's reader. The writer cannot use admission: the
   existing administrator path files corrective invoices against refused filings on purpose
   (`fiscal-verifactu/src/record-remedy-corrective.ts:118–134`), which admission would refuse.
2. In `recordCorrection`, when the invoice is moved, use its filed total in place of `sales.total`
   for the "more than is left" check (`record-correction.ts:211–226`) and its filed split in place
   of `sales.vat_breakdown` as the split the part check measures against (`:272`); and for every
   earlier corrective, use its filed split in place of its stored one (`:275–280`). This also
   changes the administrator path, which calls `recordCorrection`
   (`record-remedy-corrective.ts:134`): a sale with no answered version gives nothing, so a
   corrective against a never-accepted invoice keeps today's stored figures; one whose fix was
   answered is measured against the fix.
3. Move the per-rate agreement of lines and split out of `checkPartialCorrectionBreakdown`
   (`partial-correction-breakdown.ts:81–103`) into the history check, which knows whether the
   invoice is moved; for a moved invoice it no longer applies. `checkPartialCorrectionBreakdown`
   runs before any database read (`record-correction.ts:117–125`), so a corrective whose lines and
   split disagree is refused later than today, after the sale, series, permission and
   line-on-invoice checks; the documented refusal order (`:94–110`) changes with it. Each side
   still holds on its own: the split's signs and its sum equal to the total; every line naming a
   different invoice line at that line's own rate, within what is left of it.
4. In `checkPartialCorrectionHistory`: (a) where the filed and stored totals agree, the lines'
   gross must equal the total; where they differ, the correction must empty both the filed split
   and the stored lines (this needs the history, so it lives here, not in the check of point 3);
   (b) compare every rate any earlier corrective used, not only the new split's rates
   (`:163–181`), refusing a rate the invoice's split lacks. This relaxes and changes existing
   fiscal checks, which the 2026-10-22 approval ("no edit to … existing fiscal assertions") does
   not cover; hence this question.
5. Optional, recommended: the whole-invoice credit (`record-correction.ts:435–488`), used when an
   order whose invoice was issued is cancelled (`apps/server/src/cancel-credit.ts:68–79`), files the
   filed split negated for a moved invoice and skips its line-against-split check at each rate; its
   lines still reverse the invoice line for line (`:266–268`). Without it, cancelling such an order
   files the old figures, finding 1's defect in a feature outside A802 (read, not run). About 10
   more code lines.

**Question 2 (finding 5): when staff return whole dishes, should the corrective give back those
dishes' own stored VAT, or the running split at each rate (what is built)?**

Ten €1.20 coffees at 21%, each stored at base €0.99 and VAT €0.21 (invoice: base €9.90, VAT €2.10).
Staff return five whole coffees, €6.00.

- **Running split (built, slice 1; the approved design, lines 150–156):** files base −€4.96, VAT
  −€1.04; one coffee's correction line holds base −€1.00 against its €0.99. Fifty €0.04 sweets
  (each €0.03 + €0.01): returning half, €1.00, files −€0.83/−€0.17 where those 25 were charged
  €0.75/€0.25; if the rest is never returned, the venue has declared €0.08 more VAT on them than
  their receipt lines show. Every rate still ends exact when everything is returned, and both
  figures are valid 21% splits at the agency. Cost: nothing.
- **Dishes' own figures:** files −€4.95/−€1.05, matching what those coffees were charged. Cost: it
  breaks what follows. I ran the built calculator after such a return: one more cent is refused
  (`sale.correction_history_unusable`, because the running rule then works out a base larger than
  the cent), and the next whole coffee files €1.00/€0.20, so the cent of difference comes back one
  step later. Doing it properly means a different rule for every later correction (measured from
  each line's own figures), a change to slice 1's landed calculator, and another protected change
  to the writer's base check (`partial-correction-breakdown.ts:170–180`): about 60 code and 120 test
  lines.

**Recommendation: keep the running split.** The difference is a few cents on a part-returned bill,
every rate ends exact, the agency accepts both, and the alternative reopens two landed slices.

### B. Findings 2–8

| Finding | Response | Where | Status |
| --- | --- | --- | --- |
| 2. Correction lines lost category, product and menu | The builder copies the whole-invoice credit's field set, checked by `satisfies Required<RecordSaleLine>` (`correctionLinesFor`); its test in `correction-history.test.ts` asserts every field. `listGross` stays null on purpose: only the receipt reads it, to print comps and discounts beside a full invoice's lines (`apps/server/src/receipt-adjustments.ts:51–82`); no report reads it (`git grep` of `packages/reporting`); a negated whole-line list price on a part correction would overstate. `listUnitPriceGross`, a frozen unit price, is copied. One gap remains: an extra corrected without its dish gets no parent (`correctionLinesFor`'s `parentLineNo`), so when the category report folds extras into their dishes it files that extra under its own category (`packages/reporting/src/category-sales.ts:226–231`). Slice 3b step S5 has the report fall back through the corrected invoice line to its dish. That the report now places the money under the dish's category is read, not run; S5's test asserts it. | Part C; slice 3b S5 | Done, one gap planned |
| 3. Amount corrections take whole quantities off top sellers | Only the top-sellers report reads correction quantities (`packages/reporting/src/top-sellers.ts:18–19, :46`). The other readers of `sale_lines.quantity` are the order list, which lists no corrective invoice (`apps/server/src/orders-list.ts:192, :684, :875`), and the writer's own check (`record-correction.ts:244`); the category report reads money and category only (`category-sales.ts:202–207`). Rule: per corrected invoice line, the correction whose running sum of gross completes that line's money counts as its dishes returned (minus the line's quantity); every other correction line changes money, never dishes. So €6.05, €6.02 and €0.03 off one steak return the steak with the third. A line with no stored gross (a whole-invoice credit of an invoice whose lines have none) counts when its line total completes the line's, so such a credit still counts its dishes as returned. Lines naming no invoice line (older administrator corrections) count as today. Stored facts are enough (`corrects_line_id`, `line_gross`, `line_total`, `quantity`): no schema change, which the A1308 table hold would block. A future mode choosing dishes and quantities would store which units went back and replace this rule. About 20 code and 70 test lines, with a category assertion. Slice 3b, not slice 3 (slice 3 is already at its stop). | Slice 3b, step S5 | Planned |
| 4. Demo sales store no line gross | Checked: `apps/server/scripts/demo-seed/seed-sales.ts:255–278` files lines with no gross and works out each rate's VAT from its summed base (`:136–145`), so every demo invoice is refused with `sale.correction_history_unusable`. The golden test forbids re-recording to make it pass (`seed-sales.golden.test.ts:6–8`). Options: (a) leave demo sales uncorrectable, free, but the first thing anyone trying the screen on demo data meets is a refusal; (b) the seeder stores each line's gross and takes each rate's VAT as gross minus base, as the till does, and the golden copy is re-recorded deliberately with the owner's say-so: about 15 lines plus a regenerated golden file, and demo venues reset; (c) seed through the till's pricing, larger. Recommend (b). The owner decides when slice 5's plan (the screen) is cleared, before anyone can try it. The plan's false sentence about callers was corrected in the review-fix round (Part A's caller list). | "Left out"; slice 5 plan | Owner, at slice 5 |
| 5. Returning whole dishes does not give back their own VAT | Not decided here: the owner's question 2. | Question 2 | Owner |
| 6. Four reader branches untested | Ran each change against today's tests. M1 (each earlier correction checked against all corrections' lines): the reader tests still pass (17), the end-to-end three-round case fails, so it is caught. M2 (no refusal of an earlier line without gross): still passes (17); the split check refuses the same history with the same code (a missing gross counts as zero there). M3 (no base comparison) and M4 (no refusal of an unmatched rate): each fails one test, the rows the review-fix round added. M2: the implementer reshapes that row so only the missing-gross check can refuse it, or deletes the check if no storable history reaches it, showing which by deleting the branch. | Section D, step R3 | M1, M3, M4 done; M2 planned |
| 7. A cancelled correction still uses up value | Core has no mark of it: the administrator's cancellation appends a cancellation record with the corrective's sale id and writes no `sale_voids` row (`fiscal-verifactu/src/record-remedy-absent.ts:54–58, :102–111, :125–140`). Cost: slice 4 hands the cash back in the same step as filing, so if a refused corrective is then cancelled, the agency holds no correction, the venue's declared revenue stays too high by that amount, and Waitron gives no way to file it again. Excluding it would not repair that alone: it needs the regime to list cancelled correctives, the reader to drop them, and the protected writer to drop them from its three reads (`record-correction.ts:139–140, :275–289`): about 30 code and 60 test lines plus another protected change. Recommend counting it as used (Waitron refuses, never credits twice) and telling administrators that the remedy for a refused corrective is a fix of it. A fix that keeps the corrective's figures keeps its share and files correctly; one that changes them is the critical case in section A, refused in slice 3 and measured at its filed figures in slice 3b. The design gets: "a cancelled correction keeps its share, as a refused or held one does." | Design pointer at landing | Recommendation |
| 8. Small points | Part C now has its own step (3a). The double read was removed in the review-fix round: one read of the invoice lines in `readHistory` feeds both the calculator and the line builder. The lane E pointer now reads line 116, where the quoted text is. The reconciliation pointer now reads `correction-allocation.ts:165–232`; the writer's latest-version read is cited at `fiscal-verifactu/src/backend.ts:520–529`. The first line is replaced by the revised status. | Plan body | Done |

### C. Parts B and C as built

**(Superseded by the clearance's point 1: what was built is in [As built](#as-built-2026-11-10).)**

- **Part B** (its first build and the review-fix round): kept. Changed by step R1: admission takes
  the earlier correctives' ids, returns the filed figures of the invoice and of each, and refuses
  `filed_figures_unreadable`. The fake backend's default eligible answer returns the stored figures;
  fiscal-none is unchanged (`unsupported`).
- **Part C** (its first build and the review-fix round): kept. The line builder already answers
  finding 2. Changed by step R2: the correctives' ids are read before admission, and anything moved
  is refused. The end-to-end file keeps its three cases and gains step R5's.

### D. What remains

**Slice 3 (this branch), after clearance:**

- **R1. `filedFiguresFor`, failing first** (`fiscal-verifactu/src/correction-admission.test.ts`, where the separate file was merged, the
  clearance's point 1): an unfixed invoice and a corrective answer their own figures for both
  versions; a fixed version's figures are the fix's (a fix row at 10% beside a refused first
  version at 21%), `newestAnswered` null while the fix is queued and the fix's once accepted; a
  table of `readable: false` rows (an exempt detail, a surcharge, two details at one rate, details
  not summing to the total, two lines of fixes); a sale with no alta absent. Fake backend: one case.
- **R2. Moved refused, failing first** (`correction-history.test.ts`, fake backend): the invoice's
  newest figures differing at one rate, differing only in total, and an earlier corrective's
  differing, each refused with `filed_figures_changed`; one `readable: false` row refused with
  `filed_figures_unreadable`; equal figures preview as today (the existing case).
- **R3. Finding 6's M2 row.**
- **R4. Trim** test cases another test covers: at least 60 lines.
- **R5. End to end:** the real fix route, then the preview's refusal (section A).
- Then steps 5 and 6 as written, and `/finish-branch`.

Revised size: about 410 code and 1,030 test lines, about 1,440 in all with no plan, past the
1,400-line stop. R4's cuts bring it to about 1,380. If R4 cannot cut 60 lines, the
`filed_figures_unreadable` table keeps one row and its other rows move to slice 3b (about 25
lines), and the lane says so to the watcher before passing 1,400. Tests about 2.5 times the code.

**Slice 3b (new, before slice 4), after the owner's answer to question 1 (design A shown):**

- **S1.** **(Superseded: built in slice 3; see [As built](#as-built-2026-11-10).)** The backend
  member `filedFiguresFor` (interface; Veri*Factu sharing admission's reader; fiscal-none absent;
  fake).
- **S2.** The writer and checker change, points 2–4 (and 5 if approved), failing first in
  `partial-correction-breakdown.test.ts` and `record-correction.test.ts`, including the reviewer's
  other-rate case and the new refusal order; the golden huella, `inmutabilidad`, and slice 1–2
  suites unedited except where point 3 moves a refusal, each such edit named in the PR.
- **S3.** Core's moved path: the answered-version rule; the split from stand-in lines per filed
  rate with consumption from filed figures; the lines from the stored lines; the full-refund-only
  rule when the total moved; the scope refusal; the reader skipping its line-against-split check
  for a moved invoice.
- **S4.** The end-to-end file in section A.
- **S5.** Top sellers (finding 3) and the extras fallback in the category report (finding 2), with
  a category assertion after a part correction.

Size under A: about 180 code and 540 test lines, about 720 in all; tests about three times the code
(question 1 asks; the clearance's point 3 trims the tests to about twice the code). Under B: about
90 code and 330 test lines.

**What is left after slices 3 and 3b, so staff can use it (cash only):** slice 4, the cash
acceptance (route, permission and PIN checks, one transaction filing the correction and recording
the cash refund, replay record, drawer job, the agency's test-system run of the final-cent shape),
which also answers whether the cash handed back may differ from what was paid when a fix changed
the total; slice 5, the till screen, the corrective paper (it prints the corrective's split, not
sums of its lines) and the guide, with the owner's demo-seed choice (finding 4).

**Settled.** The queued-invoice reading went to the owner as question 3 and was answered
"allow" (the clearance, point 4): the one-line limit written there stands in place of this
paragraph's earlier text.

### As built (2026-11-10)

**The preview's order.** `previewCorrectionAmounts` (`packages/core/src/correction-history.ts`)
refuses an invoice a full invoice replaced (`sale.correction_not_admitted`, reason `replaced`);
asks the regime's `correctionAdmissionFor`, whose answers are unchanged; reads the stored sale and its earlier correctives' ids (refusing `sale.not_found`, or
`sale.correction_history_unusable` when the sale is itself a correction); refuses a named-customer
invoice with `sale.correction_unsupported`, through the writer's own `requireSupportedCorrection`;
asks `filedFiguresFor` for the invoice and each corrective, refusing `filed_figures_unreadable` (a
sale absent from the answer, unreadable figures, or a backend with no `filedFiguresFor`) or
`filed_figures_changed` (newest filed figures differ from the stored ones); reads the history; runs
slice 1's calculator; then builds the lines from its allocations.

**`filedFiguresFor` as built.** It answers `newest` and `newestAnswered`; `newestAnswered` is unused
until slice 3b. The Veri*Factu reader (`packages/fiscal-verifactu/src/filed-figures.ts`) reads
through `registros_sale_idx`, one query per 1,000 sale ids. The fake backend answers from its own
filed records, so a sale it never filed is absent, with a setter to override one filed sale.

**Size** (`git diff --numstat bb313893b4 -- packages/`): production 543 lines added; test support
(`fake-backend.ts`) 58 added and 5 removed; tests 1,112 added and 1 removed; 1,713 added in all.

**Test cases cut** under the owner's 2026-11-09 test rule and the watcher's 2026-11-10 18:35
decision, one line each with what still covers it:

- End to end, "refuses a refused original before reading its history": R5's case fails when
  admission moves after the history read.
- Filed figures, "answers an unfixed invoice's and a corrective's own figures": each check it held
  fails a remaining case (a fixed-filing row, the no-alta case or the end-to-end cases).
- The exempt-detail row: only the unknown-key check refuses it, and the surcharge row fails without
  that check.
- "Reads a whole-invoice credit": core's happy path files its earlier correction as two lines, and
  fails when the reader keeps only the last line at a rate instead of their sum.
- The "invoice filed at another rate" row: the base-and-VAT-moved and corrective rows fail without
  the per-rate comparison.
- The detenido and retenido rows: the rechazado rows fail when an unknown filing state is admitted.
- The ten-coffees end-to-end case: the calculator test refunds those bills cent by cent, and
  `partial-correction-gross.e2e.test.ts` files the same zero-base correction through the real
  backend.
- The separate `filed-figures.test.ts`, merged into `correction-admission.test.ts`: both filed the
  same records through the chain writer, so they share one setup.
- The eligible answer repeated before each admission refusal: the submission-state table owns it.
- Core's two reader happy paths, two line-builder cases and two "regime lacks a member" cases,
  each merged into one case or table.
- The fake backend's filed-figures case files one sale and one correction, not two sales.
- From the earlier fix round: the remedy-path cancellation (the core-void case and
  `record-remedy-absent.test.ts` cover it), the exact partial read (the derived-path case and the
  end-to-end rounds) and the regime refusal passed through (the end-to-end refused original).

**Corrections found while building.**

- The chain writer cannot write a filing with a missing VAT rate or VAT amount, so that
  unreadable-figures check in `filed-figures.ts` has no test.
- The reverse-charged (S2) row files an F1 invoice at rate 0.00 with no VAT, because the chain
  writer refuses S2 on any other invoice type or with tax charged.

## Slice 3b build steps (2026-11-10)

**Size: about 170 production and 285 test lines, about 455 in all; tests about 1.7 times the code**
(per step below). Under the 900-line stop and the owner's "at most about twice".

### What it delivers, and what it does not

After this slice, an invoice whose VAT figures were fixed at the tax agency (AEAT) can be refunded
in full or in part, and the corrective invoice files the figures AEAT accepted, so that every VAT
rate at AEAT ends at exactly zero after a full refund. Waitron's own record of what went back for
which dish (the correction's lines) stays on the dishes as sold, so the reports also net to zero.
The writer (`recordCorrection`) reads the accepted figures itself, as the owner chose (Q1 A; cite
`~/waitron-campaign-shared/desk/done/20261110-1623-L-a802-q1-fixed-invoice-refund.md` in the PR); the
running split stays as built (Q2; cite `…-q2-returned-dishes-vat.md`). The top-sellers report counts
a dish as returned only once its money is all back, and the category report places a corrected extra
under its dish. Staff still cannot use any of it: slice 4 adds the cash refund route, slice 5 the
till screen.

**Words.** For one sale (the invoice, or an earlier corrective of it), **N** is `filedFiguresFor`'s
`newest` and **A** its `newestAnswered` (built in slice 3, `packages/fiscal/src/backend.ts:63–77`).
The **measured figures** of a sale are A when A is not null, else the stored figures (`sales.total`,
`sales.vat_breakdown`). This is the clearance's point 4 and the writer change's point 2 ("a sale with
no answered version gives nothing, so a corrective against a never-accepted invoice keeps today's
stored figures"). The invoice's history is **moved** when the measured figures of the invoice or of
any earlier corrective differ from its stored ones (same comparison as slice 3's: total, and base
and VAT at each rate, to the cent, `packages/core/src/correction-history.ts:130–143`). It is moved
**in total** when the measured remaining (measured invoice total plus every corrective's measured
total) differs from what the invoice's lines have left (their stored gross minus every earlier
correction line's gross); otherwise moved **in split**. The lines, not the stored totals: after a
full refund at a changed total the corrective's own total (−€11.00) is not its lines' gross
(−€12.10), so stored totals would still show €1.10 left (worked through, not run).

**The answered-version rule (Q3), in the preview only.** The preview refuses
`sale.correction_not_admitted { reason: "filed_figures_unanswered" }` when, for the invoice or any
earlier corrective, N differs from the measured figures. Cases (read, not run): an invoice never
fixed and still queued has A null and N equal to the stored figures, so it is allowed (Q3 "allow");
a moved fix still queued has N different from both A and the stored figures, so it is refused (Q3's
refused case); a fix that kept the figures has N equal to the stored figures, so it is allowed; an
answered moved fix has N equal to A, so it takes the moved path. My experiment (a temporary copy of
slice 3's end-to-end case, deleted; `git status` clean): after the real fix route moved a €12.10
invoice to 10%, `filedFiguresFor` answered `newestAnswered: null`; after `envios.estado` of the fix
was set to `aceptado`, it answered the fix's figures, `[10.00, 11.00, 1.10]`.

**Why the writer does not apply that rule.** The administrator's corrective-invoice remedy calls the
writer for a sale whose filing AEAT refused or accepted with errors, with no fix after it
(`packages/fiscal-verifactu/src/record-remedy-corrective.ts:118–134`, read, not run). If the refused
version is a moved fix, N is unanswered by definition, and the right figures to measure against are
A's (what AEAT holds) or, with nothing accepted, today's stored ones. So the writer measures against
the measured figures and never refuses for N. Slice 4's route must run the preview and the writer in
one transaction, as Part C's single entry point already plans.

**Which writer path changes.** Only the exact-split path (`partialVatBreakdown`). The whole-invoice
credit stays on the stored split (the writer change's point 5 is left out, below), and the older
derived path stays as it is (design B's weakness, recorded in the backlog in S6). So the cancel
credit (`apps/server/src/cancel-credit.ts:68–79`) and every existing administrator request that does
not send `partialVatBreakdown` file exactly what they file today.
_Superseded 2026-11-10 21:10: the owner chose point 5, so the whole-invoice credit and the
cancellation change too; see "As built (3b)"._

### S2. The writer and its checks (core) — about 100 production, 75 test lines

Files: new `packages/core/src/filed-figures.ts`; `record-correction.ts`;
`partial-correction-breakdown.ts`; `errors.ts`; tests in `partial-correction-breakdown.test.ts`.

1. **`measuredFigures(tx, backend, stored)`** in the new `filed-figures.ts`, shared by the writer and
   (S3) the preview. Input: the invoice's and its correctives' stored `{ id, total, vatBreakdown }`.
   One `backend.filedFiguresFor` call for all ids. Per id it answers `unreadable` (no
   `filedFiguresFor`, the id absent from the answer, or `readable: false`) or `{ measured, newest,
   differs: boolean }`, where `measured` is `{ total: cents, vatBreakdown }` (A, else stored),
   `differs` is "N is not the measured figures". The comparison moves here from `refuseMovedFigures`
   (`correction-history.ts:130–143`) as `sameFigures(a, b)`; it is the only comparison. Plus
   `moved` (any measured figures differ from the stored ones) and `measuredRemaining` (cents). Split
   or total is decided where the lines are read: the history check (below) and the preview (S3).
2. **`recordCorrection`, exact-split path only** (`partial !== undefined`). After
   `requireSupportedCorrection` (`record-correction.ts:207`) and before the remaining check
   (`:211–226`): read the correctives' `{ id, total, vatBreakdown }` (this replaces the
   `earlierBreakdowns` read at `:275–280`, which moves up) and call `measuredFigures`. Any
   `unreadable` refuses `sale.correction_history_unusable` (no new code or reason). The remaining
   check then uses the measured remaining in place of `original.total` plus `original.corrections`.
   The history check receives the measured invoice split as `invoiceBreakdown`, the correctives'
   measured splits as `earlierBreakdowns`, and the new fields `moved: boolean` and
   `measuredRemaining`; it works out the lines' remaining from `invoiceLines` and `earlierLines`
   (already passed) and so whether the history is moved in split or in total.
   **A deliberate departure from "when the backend has it":** a backend with no `filedFiguresFor`
   is refused on this path, not measured against the stored figures. Only the preview reaches this
   path, and it refuses the same backend (`correction-history.test.ts:437–451`); a silent fallback
   would be the wrong filing this slice exists to stop, and a branch no test reaches.
3. **`checkPartialCorrectionBreakdown`** (`partial-correction-breakdown.ts:44–111`) keeps every check
   on the split alone and the lines alone: the line field checks (`:54–80`), each group's signs, the
   rate's range, the sum equal to the total (`:99–103`). It gains an explicit refusal of a rate given
   twice and of a group whose base and VAT are both zero (today both are refused only through the
   lines agreement, `:87–96`). The per-rate agreement of lines and split (`:77–79`, `:87–96`,
   `:100`) moves out, unchanged, as a private `linesMatchSplit(lines, split)`.
4. **`checkPartialCorrectionHistory`** (`:123–182`), in this order:
   - Not moved: `linesMatchSplit` first (so a disagreeing split is refused with
     `sale.correction_breakdown_invalid` before any history check can refuse it as unusable).
   - Moved: any invoice line with no gross, or earlier correction line with no gross or naming no
     invoice line, refuses `sale.correction_history_unusable` (the lines' remaining cannot be
     counted, so split cannot be told from total); then, moved in split, the lines' gross sum must
     equal the split's gross sum, else `sale.correction_breakdown_invalid`.
   - The per-line loop (`:142–150`), unchanged: each line takes from an invoice line at that line's
     own stored rate, within its quantity and what is left of its gross.
   - The per-rate loop runs over every rate in the new split **and every rate an earlier corrective's
     measured split used** (today only the new split's, `:163`). A rate without exactly one group in
     the measured invoice split refuses `sale.correction_history_unusable`; this is the reviewer's
     other-rate case. For the new split's rates the base rule and the gross budget run as today
     (`:167–180`); the unnamed-line check (`:166`) stays, for those rates only and only when
     not moved, so the passing case at `partial-correction-breakdown.test.ts:361–367` still
     passes.
   - Moved in total: the correction must empty both ledgers: at every rate of the measured invoice
     split, earlier plus this gross equals the rate's base plus VAT; and every invoice line's
     earlier plus this gross equals its stored gross. Else `sale.correction_breakdown_invalid`.
5. **`errors.ts`** (`:14`, `:17–22`): `sale.correction_not_admitted` reasons lose
   `filed_figures_changed` and gain `filed_figures_unanswered`; `sale.correction_scope_invalid`
   reasons gain `filed_figures_changed` and `filed_total_changed` (both used in S3). No new code.
6. Rewrite the refusal-order paragraph (`record-correction.ts:94–110`) and the field's comment
   (`:77–82`) to say: a split that disagrees with its own total is refused first; the measured
   figures are read after the permission and named-customer checks and before
   `sale.correction_exceeds_total`; a split whose lines disagree with it at a rate is refused after
   `sale.correction_line_not_on_invoice`, and not at all when the history is moved. Cut the rest of
   that paragraph's history rather than reword it.

**Failing first**, one table in `partial-correction-breakdown.test.ts`, on a sold €12.10 steak
(`sell("12.10", [["21.00", "1", "10.00", "12.10"]])`) with `backend.setFiledFigures` (the fake's
setter, `packages/fiscal/src/testing/fake-backend.ts:348–351`). "Answered at X" means N and A both X.

| Row | Figures | Earlier | Draft (total; line base/gross; split) | Expected |
| --- | --- | --- | --- | --- |
| 1 | answered at 10% 11.00/1.10, total 12.10 | none | −6.05; 21% −5.00/−6.05; 10% −5.50/−0.55 | files split `[10.00, −5.50, −0.55]` |
| 2 | N at 10% as row 1, A null | none | as row 1 | `sale.correction_breakdown_invalid` (measured at the stored 21%) |
| 3 | `{ readable: false }` | none | as row 1 | `sale.correction_history_unusable` |
| 4 | as row 1, set after the earlier one | €6.05 at 21% (−5.00/−6.05; 21% −5.00/−1.05) | as row 1 | `sale.correction_history_unusable` (the reviewer's case) |
| 5 | as row 1 | none | −6.05; line gross −6.04; 10% −5.50/−0.55 | `sale.correction_breakdown_invalid` |
| 6 | answered at 21% 11.00/2.31, total 13.31 | none | −13.31; 21% −10.00/−12.10; 21% −11.00/−2.31 | files split `[21.00, −11.00, −2.31]` |
| 7 | as row 6 | none | −6.05; 21% −5.00/−6.05; 21% −5.00/−1.05 | `sale.correction_breakdown_invalid` (a changed total must empty both) |

What each row catches (read, not run): row 1 fails today (`checkPartialCorrectionBreakdown` refuses
lines at 21% with a 10% split, section A's first run); row 2 fails a writer that reads N instead of
A; row 3 fails a fallback to stored figures; row 4 fails today's per-rate loop over the new split
only (section A's third run); row 5 fails a moved path that drops the lines-against-total check; row
6 fails a remaining check on the stored total (`sale.correction_exceeds_total`: €12.10 left against
€13.31); row 7 fails a moved path with no empty-both rule.

Commands:
`pnpm --filter @waitron/core exec vitest run src/partial-correction-breakdown.test.ts src/record-correction.test.ts src/record-correction.management.test.ts src/correction-history.test.ts src/correction-allocation.test.ts`,
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/partial-correction-gross.e2e.test.ts src/correction-path.e2e.test.ts src/correction-history.e2e.test.ts src/correction-amount.huella.test.ts`,
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` and
`pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`, the last two UNEDITED. Prove
the moved agreement by deletion: with `linesMatchSplit` removed, the rows at
`partial-correction-breakdown.test.ts:293` and `:294` must fail.

### S3. The preview's moved path (core) — about 45 production, 55 test lines

File: `packages/core/src/correction-history.ts`; tests in `correction-history.test.ts`.

1. `previewCorrectionAmounts` (`:39–70`) replaces `refuseMovedFigures` (`:117–147`) with
   `measuredFigures`: any `unreadable` refuses `filed_figures_unreadable` as built; any `differs`
   refuses `filed_figures_unanswered`. Not moved runs the path as built, unchanged.
2. Moved: a request naming lines (`selection.lineIds` given) refuses `sale.correction_scope_invalid
   { reason: "filed_figures_changed" }` (the fix's split does not say which dish went to which rate).
   After the history read (point 3), moved in total (the measured remaining is not the lines'
   remaining, `history.lines` gross minus `history.consumed` gross): an amount other than the whole
   measured remaining refuses
   `sale.correction_scope_invalid { reason: "filed_total_changed" }`.
3. `readHistory(tx, saleId, stored, { moved: true })` skips the check that each earlier corrective's
   lines agree with its stored split (`:178–201`): on the moved path a corrective's lines are at the
   dishes' stored rates and its split at the fix's. Its refusals of missing gross and unnamed lines
   (`:174–177`) stay. `readCorrectionAmountHistory` keeps the check.
4. **The split**: slice 1's calculator over one stand-in line per rate of the measured invoice split
   (`id` `rate:<basis points>`, gross base plus VAT, base the rate's base), with `consumed` from each
   corrective's measured split negated, and `lineIds` naming every stand-in (without them the
   calculator refuses two rates as `required`, `correction-allocation.ts:61–66`). A corrective at a
   rate the measured split lacks is then refused `sale.correction_history_unusable` by the calculator
   (`:207–217`). Section A's run of this shape took €5.00, €7.77 and €11.43 to exactly 11.00/1.10 and
   10.00/2.10 and refused one more cent.
5. **The lines**: the calculator over the stored history, as today, for the selected amount (or, moved
   in total, the lines' whole remaining), with `lineIds` naming every invoice line; then
   `correctionLinesFor` as built.
6. The answer: `gross` and `vatBreakdown` from the split's run; `allocations` and `lines` from the
   lines' run. Moved in total, the allocations' gross (the lines' remaining) differs from `gross`; the
   corrective's total, and so the cash, is `gross` (slice 4's settlement question). Rewrite the
   function's comment (`:31–38`) to name the new refusals.

**Failing first** (fake backend), in `correction-history.test.ts`:

- Change the existing table's reason (below): its rows have A null and N moved, so they are Q3's
  queued-fix refusal, tested once, here.
- One table on the sold steak, `preview` given a selection (today it is fixed at €6.05,
  `:394–398`): (a) N at the stored figures, A null (a fix that kept the figures, still queued), with
  `lineIds` naming the steak: previews €6.05 as 21% 5.00/1.05, lines `[−5.00/−6.05]` (the control);
  (b) answered at 10% 11.00/1.10, with `lineIds`: `scope_invalid` `filed_figures_changed`; (c) an
  earlier €1.05 corrective answered at 21% −0.88/−0.17, with `lineIds`: the same (moved through a
  corrective alone); (d) answered at 10% 10.00/1.00, total 11.00, €6.05: `scope_invalid`
  `filed_total_changed`.
- One case on (d)'s figures: the €11.00 preview gives `vatBreakdown [10.00, 10.00, 1.00]` and lines
  `[21.00, −10.00/−12.10]`; filing exactly that through `recordCorrection` succeeds; a €0.01 preview
  then refuses `sale.correction_amount_invalid`.

Commands: the S2 core and fiscal-verifactu commands, the golden and `inmutabilidad` runs unedited.

### S4. End to end with the real backend and the real fix route — about 80 test lines

File: `packages/fiscal-verifactu/src/correction-history.e2e.test.ts` (it already drives the real fix
route through `mountRecordRemedies`, `:199–253`). Move that route setup into a helper
`fixAt10(registroId)`, used by the existing case and the new ones; the existing case keeps `sell(null)`
and its order checks. A helper `soldThenFixedAt10()` sells €12.10 at 21% with gross, marks the first
version `rechazado`, fixes it to 10% (base 11.00, VAT 1.10, total 12.10) and marks the fix's `envios`
row `aceptado`. A helper `agencyRates(saleId)` sums, per `TipoImpositivo` in cents, the `desglose` of
the invoice's accepted version and of every corrective's alta.

- **The replay**: a full refund of €12.10 through the existing `correct` helper (preview, then the
  writer with exactly its lines and split; `validate` clean and the huella recomputed, `:146–149`)
  returns `["accepted", [["10.00", "-11.00", "-1.10"]], [[-1000, -1210]], "-12.10", [["-11.00",
  "-1.10"]]]`: the corrective's split at 10% with no 21% detail, its one line at the dish's 21%
  taking its whole gross, so the invoice line ends at zero. `agencyRates` is `{ "10.00": 0 }`. A
  €0.01 preview refuses `sale.correction_amount_invalid`.
- **One part refund**: €6.05, then €6.05: each returns stored split `[["10.00", "-5.50", "-0.55"]]`
  and lines `[[-500, -605]]`; `agencyRates` is then `{ "10.00": 0 }`.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/correction-history.e2e.test.ts`,
then the golden and `inmutabilidad` runs unedited.

### S5. Reports (reporting) — about 25 production, 75 test lines

Files: `packages/reporting/src/top-sellers.ts`, `category-sales.ts`, their tests, and the fixtures
(`packages/reporting/test/fixtures.ts` gains a line's `correctsLineId`;
`test/category-fixtures.ts`'s `LineSpec` passes it through).

1. **Top sellers** (`top-sellers.ts:45–58`, the issued branch only; voids unchanged): a correction
   line naming an invoice line (`corrects_line_id`) counts that invoice line's quantity, negated, when
   it is the correction at which the running sum, over every correction of that line whatever its
   date, ordered by `issued_at` then `sales.id`, first reaches the line's money; any other line
   naming an invoice line counts quantity zero and its money as today. The money is gross when the
   invoice line stores one (a correction line with none adds nothing), else line total (so a
   whole-invoice credit of an invoice without gross still counts its dishes). A line naming no invoice
   line counts as today. The running sum reaches the other corrections through `sales.corrects_sale_id`
   (`sales_corrects_idx`, `packages/db/src/schema/sales.ts:130`) and `sale_lines_sale_idx` (`:241`),
   named with `indexed by` (the root rule on planner statistics): `corrects_line_id` has a foreign key
   but no index (`:231–235`). Rewrite the comment at `:18–19`.
2. **Category report** (`category-sales.ts:201–230`): with `extrasIntoDish`, a correction line whose
   own `parent_line_id` is null but whose corrected invoice line has a parent takes that dish's
   product, category and classification (one more left join by primary key to the corrected line and
   its parent; the void branch unchanged).

**Failing first**: top sellers, a €12.10 steak (quantity 1) and corrections of €6.05, €6.02 and €0.03
naming its line, each with quantity −1: after the first two, quantity `1.000` and total net of both;
after the third, `0.000` (today −2.000 after all three). And a whole-invoice credit of a line with no
gross, quantity −2 of 2, counts `0.000` (a control: today's count is the same, so it guards the
no-gross branch, not the change). Category: a dish (Food > Burgers, 10.00/11.00) with an extra
(Extras, 1.00/1.10), then a correction line naming the extra alone, −0.50/−0.55; with
`extrasIntoDish` the tree reads `Food > Burgers: 11.55/10.50` and has no Extras row (today Extras
−0.55). The existing correction cases (`top-sellers.test.ts:419–466`, `:737–770`;
`category-sales.test.ts:541–571`) name no invoice line and must pass unedited.

Commands: `pnpm --filter @waitron/reporting exec vitest run src/top-sellers.test.ts src/category-sales.test.ts src/category-sales-current.test.ts`.

### S6. Records — no code

In the same pull request: this plan's "As built" for 3b; the A802 bundle in `docs/backlog/fiscal.md`
("Nothing in the product can issue a corrective invoice…", `:912`) gains one line for the derived
path's weak checks (section A) and one for point 5 left out; the PR description cites the Q1 and Q2
files and lists the assertion changes below.

### Existing assertions this slice changes

1. `packages/core/src/correction-history.test.ts:480`, the constant behind rows `:483–486`:
   `"filed_figures_changed"` → `"filed_figures_unanswered"`. The rows set A null
   (`filed()`, `:467–478`) and a moved N; slice 3b admits a moved invoice once A equals N, so these
   become Q3's refusal under its own reason. The refusal itself is unchanged.
2. `packages/fiscal-verifactu/src/correction-history.e2e.test.ts:261`: the same rename (the fix is
   still queued there: my experiment above shows A null). Its title (`:183`) changes from "as moved"
   to "until the fix is answered".

**The refusal-order change pins no assertion** (read, not run; S2's run confirms). The rows of
`partial-correction-breakdown.test.ts` that disagree with their lines at a rate (`:292`, `:293`,
`:294`, `:297`) are refused with the same `sale.correction_breakdown_invalid`, now from the history
check after the database reads; `expectRefused` (`:222–229`) asserts the code, no filing and no
number taken, never the order, and each row runs with a permitted session on a real invoice line, so
no earlier check refuses first. `:295` (a rate twice) and `:296` (a rate with no lines, 0.00/0.00)
stay early under S2's explicit checks. The one order test, `:508–514`, changes the total alone, which
the sum check still refuses before the sale is read.

**Not covered by an owner answer, so said plainly:** the rename in point 1 and 2 is my choice (Q3
covers the refusal, not its name); keeping `filed_figures_changed` as the reason would leave both
assertions unedited, at the cost of one name meaning "moved" in slice 3 and "fix unanswered" here.
The writer's refusal of a backend with no `filedFiguresFor` on the exact-split path (S2 point 2) is
a tightening Q1 does not name; no existing test reaches it. The new zero-group and duplicate-rate
refusals in `checkPartialCorrectionBreakdown` refuse nothing the writer accepts today.

### Left out

Nothing: point 5, the whole-invoice credit filing a fixed invoice's accepted split when an issued
order is cancelled, is built (owner, 2026-11-10 21:10, "1").

### Size per step

| Step | Production | Tests |
| --- | --- | --- |
| S2 writer and checks | ~100 (helper ~40, writer ~25, checks ~32, errors ~3) | ~75 |
| S3 preview's moved path | ~45 | ~55 |
| S4 end to end | 0 | ~80 (net, after moving the route setup into a helper) |
| S5 reports | ~25 | ~75 (fixtures ~5) |
| S6 records | 0 | 0 |
| **In all** | **~170** | **~285** |

### Plan review (2026-11-10) — changes that override the steps above

A fresh-context review of these steps (no critical findings) ran the per-rate move: core 224 of 224
and the four fiscal-verifactu correction suites 17 of 17 passed with the check moved; with it
deleted, `partial-correction-breakdown.test.ts:293`, `:294` and `:297` failed. Changes:

1. **S2 table, two more rows (rate given twice, all-zero group).** On a moved invoice the
   lines-against-split check does not run, and the per-rate loop checks each group alone, so a split
   with one rate twice could pass each group's budget and file double at that rate. Add one moved row
   with a rate given twice and one with a 0.00/0.00 group, each `sale.correction_breakdown_invalid`;
   deleting each explicit refusal in `checkPartialCorrectionBreakdown` fails its row.
2. **An earlier corrective counted at its fixed figures (spec section A's critical case).** S2 gains
   a row: the invoice unmoved (21% 10.00/2.10); an earlier €6.05 corrective stored at 21%
   −5.00/−1.05 and answered at 21% −5.01/−1.04; then the remaining €6.05 at 21% −4.99/−1.06 with the
   line −5.00/−6.05 files that split (counting the corrective's stored split, the base rule expects
   −5.00 and refuses). S3 gains one amount preview on the same figures: €6.05 previews
   `[21.00, 4.99, 1.06]`. Either fails if the writer or the preview reads the corrective's stored split.
3. **The writer refuses an unanswered fix itself.** On the exact-split path, any `differs` (newest
   filed version is not the measured one) refuses `sale.correction_not_admitted { reason:
   "filed_figures_unanswered" }`, as the preview does (Q3). The administrator's corrective route never
   sends `partialVatBreakdown` (`packages/fiscal-verifactu/src/record-remedy-corrective-http.ts:80`
   allows only `seriesId, total, operationDescription, wholeInvoice, lines`), so this does not touch
   that path, and slice 4 no longer depends on running the preview in the same transaction. S2 row 2
   now expects `sale.correction_not_admitted` `filed_figures_unanswered`.
4. **Reason name.** The scope refusal for naming dishes on a moved invoice is
   `sale.correction_scope_invalid { reason: "filed_split_changed" }`, not `filed_figures_changed`, so
   no reason string means two things.
5. S2's deletion proof names `:293`, `:294` and `:297`.
6. **Point 5** (cancelling an issued order whose invoice was fixed still files the stored split) is
   put to the owner as a question; this slice does not build it unless the owner says so.

Size after these: about 175 production and 320 test lines.

### As built (3b, 2026-11-10)

**What was built.**

- `measuredFigures` (`packages/core/src/filed-figures.ts`) reads the filed figures of the invoice
  and its earlier correctives in one `filedFiguresFor` call; the preview and the writer share it.
- The writer's exact-split path (`partialVatBreakdown`) checks against those figures. It refuses
  `sale.correction_history_unusable` when they cannot be read, a backend with no `filedFiguresFor`
  included, and `sale.correction_not_admitted` (`filed_figures_unanswered`) while a filed fix waits
  for its answer. Its per-rate check also covers every rate an earlier corrective used, and refuses
  `sale.correction_history_unusable` when earlier corrections at a rate already took more base or
  gross than the accepted figures hold there (the review's €23.10 case: a fix that moved €6.05
  from 21% to 10% after the steak's €12.10 was refunded at 21%). A changed total must be emptied at
  every rate and on every invoice line.
- The whole-invoice credit (the cancellation) files the accepted split negated when a fix moved it,
  and the stored split otherwise or when the backend reads no filed figures. It refuses
  `sale.correction_history_unusable` when the figures cannot be read or a fix changed the total,
  and `sale.correction_not_admitted` (`filed_figures_unanswered`) while a fix waits for its answer.
  The administrator's corrective-invoice remedy for a refused original files what it filed before:
  a refused version is answered, so nothing waits (`record-remedy-corrective-http.test.ts`, the
  refused original and the refused fix of it both pass).
- "Waits for its answer" means the newest filed version's submission is queued, being sent or held
  behind its chain (`detenido`), or has no submission row; accepted,
  accepted with errors and refused are answered (`newestAwaitingAnswer` in
  `packages/fiscal/src/backend.ts`, set by `packages/fiscal-verifactu/src/filed-figures.ts`).
- The preview's moved path: naming dishes refuses `sale.correction_scope_invalid`
  (`filed_split_changed`), a part of a changed total refuses it (`filed_total_changed`); the split
  comes from the accepted figures and the lines from the stored history.
- Reports: top sellers count a dish as returned once its corrections reach its money (gross where
  the line stored one), leaving out a correction voided at or before that point; a void gives back
  the dishes its correction was counted as returning. The category report puts a corrected extra,
  and its void, under its dish.
- The till API answers both refusals with 409 (`apps/server/src/till-api.ts`); the till words both
  (`apps/till/src/i18n/codes.ts`, owner 22:04).

**Decisions.**

- The reason for an unanswered fix is `filed_figures_unanswered`, not slice 3's
  `filed_figures_changed`, so no reason string means two things (Q3 covers the refusal, not its
  name).
- The writer refuses a backend with no filed-figures read on the exact-split path rather than
  falling back to the stored figures.
- A cancellation of a fixed invoice whose total changed, or whose figures cannot be read, is
  refused: its lines reverse the stored total.
- A cancellation is refused while a fix waiting for its answer carries figures other than the
  measured ones, the same rule as the preview and the exact-split path; a waiting fix that kept
  them is allowed.

**Size** (`git diff --numstat 0b7f37048f`, TypeScript only): production 533 lines added and 170
removed; tests, test fixtures and the fake backend 1,122 added and 49 removed. The plan review
estimated about 175 and 320, before point 5, the till wording and the reviews' fixes were added.
