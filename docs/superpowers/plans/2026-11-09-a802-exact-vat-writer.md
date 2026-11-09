# A802 slice 2: the correction writer files the exact VAT split it is given

**Plan for watcher approval; no code until approved.** Lane L, 2026-11-09. Slice 1 (the pure amount
calculator, `packages/core/src/correction-allocation.ts`) landed as #2653 (`604fdde31a`).

## Authority

- **Owner, 2026-10-22 ~11:50** (lane E `archive/questions-to-2026-10-23.md`, heading "OWNER ANSWER —
  A802: the protected-writer scope is APPROVED"): "the optional `partialVatBreakdown` on
  `RecordCorrectionInput` (`packages/core/src/record-correction.ts`) validated in new
  `packages/core/src/partial-correction-breakdown.ts`, used only by the new opt-in partial path … No
  edit to the builder/append bodies, hash, number allocator, stored records or existing fiscal
  assertions. The plan's qualification gate stands: if the real €0.03 path needs a protected builder
  change, stop and ask." This slice is exactly that scope and nothing more.
- **Owner, 2026-11-09 16:45** (lane E `questions.md`): cash-first route, each slice "about 1,000
  written lines including tests, each naming its next capability", tests at most about twice the code
  or the plan says why. Slice 1's plan named this slice as successor (1): "carry exact partial VAT
  through the existing `recordCorrection` … and prove the actual fiscal validator accepts the cents".

## What it delivers

Staff get nothing they can use from this slice. It is the foundation for the cash correction: today
`recordCorrection` works out a partial correction's VAT itself (`deriveVatBreakdown`: VAT = rounded
base × rate), so a run of partial corrections files records whose base plus VAT is not their own
total. Example: a €12.10 dish at 21% (base 10.00, VAT 2.10) refunded as €6.05, €6.02 and then €0.03.
Slice 1's calculator gives base 5.00 + VAT 1.05, base 4.98 + VAT 1.04, then base 0.02 + VAT 0.01 (run
on main). Today's path, run by the plan review through the real Verifactu backend, filed VAT −1.05
for the €6.02 (base plus VAT −6.03) and VAT 0.00 for the €0.03 (base plus VAT −0.02), and the
library's `validate` reported no issue on either. After this slice, a caller may hand the writer the
split slice 1's calculator produces; the writer re-checks it against the invoice and every earlier
correction, refuses anything else, and files what it accepted unchanged. The next slice (3) reads an
invoice's history — its original lines and what earlier corrections took from each — so the
calculator can be fed real data.

**Why the writer must check the VAT itself.** For a correction "por diferencias" (type I) the
library's `validate` skips its VAT-formula and sign checks altogether (`formulaExempt`, `dist/validate.js:950`
in `@waitron/verifactu` 0.2.1, read), and its totals checks allow €10 of difference (`:1125–1136`). So
`validate` passing proves the record's shape, never its cents. The cents are proved only by this
slice's own refusals and by asserting stored and filed figures exactly.

## Files and size

- Create `packages/core/src/partial-correction-breakdown.ts` (checks the supplied split) and its
  `.test.ts`.
- Move the per-rate rule out of `allocateCorrectionAmounts` into one exported function in
  `packages/core/src/correction-allocation.ts` (cumulative base = cumulative gross ÷ (1 + rate),
  rounded, kept between "cumulative gross minus the invoice's VAT" and the invoice's base for that
  rate), called by both the calculator and the writer, so the two cannot drift. Slice 1's tests
  pass unedited.
- Modify `packages/core/src/record-correction.ts`, opt-in path only: the optional input field; when
  present, use the checked split instead of `deriveVatBreakdown`; read the invoice's stored
  `vat_breakdown`, the earlier corrections' stored `vat_breakdown`s, each named original line's
  `vatRate`, `quantity` and `lineGross`, and the earlier corrections' `line_gross` per
  `corrects_line_id`. Then refuse unless, at each rate, this correction's base equals the rule given
  everything corrected before at that rate, and the running gross stays within the rate's original
  gross; and unless each line's running gross stays within its original line's. Summed in JavaScript
  at money scale. One added clause in the function's doc comment saying where the new refusal falls
  in the refusal order; nothing else in it.
- Modify `packages/core/src/errors.ts`: one code, `sale.correction_breakdown_invalid` (empty
  params), following slice 1's `sale.correction_*` naming. HTTP status and English/Spanish wording
  come with the first route that can return it.
- Create `packages/fiscal-verifactu/src/partial-correction-gross.e2e.test.ts`: the real core writer
  plus the real Verifactu backend, real migrations and the library's own `validate`.
- Source of the code: private branch commit `414102aa6d` (Task 3 of the old plan), rebuilt on
  current main with the history checks above added, its error renamed, its repeated setup folded
  into one seeding helper.

**Budget: about 200 code lines, about 400 test lines, 600 total.** Stop for an outside opinion past
750 written lines, or if tests pass about twice the code. The private commit measured 150 code and
747 test lines; the cut comes from one shared seed in the end-to-end file and table-driven refusal
cases in the core test, not from dropping any case below.

## Steps (test first)

1. **Real backend, failing first.** In the new end-to-end file, record a real original (one €12.10
   line at 21%) and correct it by €6.05, €6.02 and €0.03. Assert the stored and filed figures
   exactly for each (base −5.00/VAT −1.05, −4.98/−1.04, −0.02/−0.01; each total equal to its base
   plus VAT; running VAT −2.10). Run it through today's path first: it must fail on the €6.02's VAT
   (−1.05 filed), not on setup. Then switch the case to the new field and see it pass. For each
   stored correction also rebuild the record from its row, run `validate` (no issues) and recompute
   its hash. Check the original sale, its lines and its fiscal record are unchanged.
2. **A real final-cent shape.** Ten €1.20 coffees at 21%, each on its own line, are stored as base
   9.90, VAT 2.10 (each line's base rounds to 0.99, `packages/catalogue/src/pricing.ts:82–86`).
   Slice 1's calculator (run on main) corrects €11.98 as base 9.90, VAT 2.08, so the final €0.02 is
   base 0.00, VAT 0.02. File both corrections and assert them exactly. Also file slice 1's mixed-rate split (€2 over €11 at 10%
   and €12.10 at 21%: gross .95/1.05, base before VAT .86/.87, VAT .09/.18).
3. **Refusals, core test, failing first.** Table cases, each a one-field change to a split the same
   test shows passing: amounts past the cent, zero or positive; a rate outside 0–100 or past two
   places; total not equal to the sum of bases and VAT; a rate group not equal to its lines; a rate
   given twice or with no lines; a line with no original line, the same original twice, a duplicate
   line number, no gross, a negative unit price or a non-positive price quantity; a quantity of
   zero, positive, past three places or larger than the original line's; a line's rate not its
   original's; an original line with no stored gross; a base that differs from the rule by one
   cent either way; running gross past a rate's original gross or a line's original gross after
   an earlier correction; the field together with `wholeInvoice`. Each asserts the code, and, through
   a spy, that the fiscal backend's `recordCorrection` was never called.
4. **Nothing else moves.** Without the field, every existing caller keeps today's path:
   `record-correction.test.ts` passes unedited, as do slice 1's `correction-allocation.test.ts`,
   `correction-path.e2e.test.ts`, `correction-amount.huella.test.ts` (its pinned hash) and the
   golden pair (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`
   and `… vitest run inmutabilidad`). Guards: `scripts/errors-reachable.test.ts`,
   `scripts/alert-codes.test.ts`, `scripts/module-seams.test.ts`. Core typecheck.

**What a line's quantity means.** The writer only checks a correction line's quantity is negative,
whole thousandths, and no larger than its original line's. For an amount correction it is the
selected scope shown on the document, not units returned; reports must never read it as returns
(old plan Task 3). A running cap on quantity would wrongly refuse a second amount correction of the
same line, so there is none.

## Left out

No change to the Verifactu record builder, chain append, hash, numbering, `registros_facturacion`,
`deriveVatBreakdown`, ordinary sales, substitution or the whole-invoice credit. No per-line history
of earlier amount corrections beyond what `sale_lines` already stores (slice 3), no admission check
on the original's filing state (old plan Task 4), no refund, route, screen, paper or report. No
export from `packages/core/src/index.ts` beyond what the writer's input type already carries. The
legacy partial path (field absent) keeps filing the cent-out records shown above; its only callers
are tests (the one production caller, `apps/server/src/cancel-credit.ts:68`, passes
`wholeInvoice`). Retiring it is a separate question for the PR thread, not this slice.

## Two points for the watcher

1. **Landing.** The owner's 16:45 rule is "The first slice to land must be usable by staff"; the
   18:06 answer let "A802's arithmetic slice" land on its own and names no other. This slice is a
   second foundation staff cannot use. I recommend landing it on its own as well (small, opt-in, no
   caller, easier for the owner to check than inside a larger PR); the alternative is to hold its
   PR open until slice 3 is ready. I will build it meanwhile and not open the PR until the answer.
2. **AEAT itself.** The proof here is the library's checks plus exact assertions, not AEAT. I
   recommend one AEAT preproduction run of the final-cent shape (a type I correction with a base
   0.00, VAT −0.02 group) through the `waitron-io/verifactu` live-AEAT workflow (which filed a
   double correction on 2026-11-02, `docs/superpowers/specs/2026-11-02-aeat-double-correction-evidence.json`)
   as a prerequisite of the slice that lets staff file it, not of this one, because nothing files a
   partial split in production until then.
