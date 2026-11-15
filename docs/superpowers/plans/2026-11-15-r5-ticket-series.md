# R5-TICKET-SERIES: number ticket correctives in the ticket series — implementation plan

> **For agentic workers:** `superpowers:subagent-driven-development`, each task dispatched as
> `subagent_type: "implementer"`, test-first (write the named check, watch it fail for the stated
> reason, then the smallest change). Fiscal: full review path; the owner lands the PR.

**Status:** plan only, 2026-11-15, lane L, branch `docs/r5-ticket-series-plan` on `main` at
`29bf70e9f9`. **(run)** = run in this session; **(read)** = only read.

**Goal.** Every R5 (a corrective of a simplified invoice) takes its number from the issuing node's
ticket series; the corrective series holds only R1–R4 (today only the switched-off R4 "S"). No
schema change, no migration, no venue reset (pre-live, owner 2026-10-03).

**The decision.** Owner, 2026-11-15 09:40, verbatim: "Land it, with R5 in the same series as
tickets. R1-r4 but must be in the corrective series. Then leave a question for the assessor about
whether it's be better to put R5 in the corrective series or leave it in the ticket series"
(`~/waitron-campaign-shared/desk/done/20261115-0743-L-land-3301.md`). Law: RD 1619/2012 art. 6.1.a
makes a corrective series obligatory for full invoices; art. 7.1.a only permits one for tickets;
DGT V2884-16: «las facturas simplificadas rectificativa podrán incluirse dentro de la misma serie con
el resto de facturas simplificadas»; AEAT's FAQ gives R1–R4 «con serie específica» and no series rule
for R5 (`docs/compliance/research/2026-10-09-vat-and-corrections.md` §4.3; the watcher's FAQ read).

**Today (read).** Every corrective is numbered from the node's live `rectificative` series:
`requireCorrectiveSeries` refuses any other purpose (`packages/core/src/corrective-series.ts:38-43`),
called by `recordCorrection` (`record-correction.ts:165`) and `recordReplacement`
(`record-replacement.ts:97`); callers pick it with `readLiveSeriesIdTx(…, "rectificative")` at
`apps/server/src/cancel-credit.ts:55`, `apps/server/src/invoice-corrections.ts:367` and
`packages/fiscal-verifactu/src/record-remedy-replacement.ts:79`; the switched-off operator remedy
takes `seriesId` from its body (`record-remedy-corrective-http.ts:87`). `recordCorrection` only ever
files an R5 (it refuses a customer, `correction-eligibility.ts:5-9`; the backend types
`TipoFactura` R5 unless a refused F1 is replaced, `packages/fiscal-verifactu/src/backend.ts:579`).
Nothing reads a series' purpose to decide a document's type: paper, screens and the accountant
export type it from `corrects_sale_id`/`replaces_original` and the customer
(`apps/server/src/invoice-typing.ts:56-60`, `accountant-export.ts:234-236`) and print only the code
(`git grep` for purpose readers **(run)**); `packages/reporting/src` reads no series **(run)**.

**Which ticket series an R5 joins: the issuing node's one live `standard` series at the moment it
is issued** (`readLiveSeriesIdTx(tx, nodeId, "standard")`, `packages/db/src/reserved-identity.ts:77-105`,
the same call that numbers the node's next ticket, `apps/server/src/invoice-selection.ts:121`), not
necessarily the original's. Why: a series belongs to one node and a till owns none (CLAUDE.md §5;
`sale.series_wrong_node`, `corrective-series.ts:31-37`); a restore or promotion retires the node's
series and opens new ones, and a retired series may never number again
(`packages/db/src/schema/series.ts:31-34`, `corrective-series.ts:45-50`), so an R5 of a ticket
issued before a restore joins the new ticket series; a node never has two live ones
(`reserved-identity.ts:101-103`). V2884-16 asks for "the same series as the rest of the simplified
invoices", which is the one tickets are being numbered in now. Numbers stay unique and never reused
(`packages/db/src/allocate-number.ts:30-44`; UNIQUE (series_id, invoice_number)).

## STOP before dispatch: three golden literals change

`write-path.e2e.test.ts` and `inmutabilidad.test.ts` stay unedited and pass with the change applied
**(run: throwaway edit, reverted)**. But two other files pin huellas of R5s numbered `R/1`; under the
change the R5 is `A/2`, a huella input, so the pinned values move **(run)**:
`packages/fiscal-verifactu/src/correction-form.test.ts:141,150,199,208` (QR input and envelope:
`NumSerieFactura=R/1` → `A/2`, huellas `A55D8F…`, `23FF6F…` change) and
`correction-amount.huella.test.ts:181` (`76247AD4…` → `E3C5BDBD…`). `computeHuella` itself is not
touched. **The owner decides before Task 1.** Default: re-pin them, each new value first recomputed
outside Waitron (the AEAT chain string built by hand, `printf … | shasum -a 256`), not copied from
the failing run. Rejected: seeding a second live ticket series to keep `R/1` (a state the code calls
corrupt, `reserved-identity.ts:101-103`).

## Tasks (one PR, `feat/r5-ticket-series`)

- [ ] **Task 1 — core.** `requireCorrectiveSeries(tx, seriesId, nodeId, purpose)`; `recordCorrection`
  demands `standard`; `recordReplacement` demands `standard` when the original names no customer,
  `rectificative` when it does (the backend's R4 test, `backend.ts:538`). Failing first, flipped:
  `record-correction.test.ts:316-322` (before: refuses `standard`, expected `rectificative`; after:
  refuses `rectificative`, expected `standard`); `:467-480` (before: number 1 from the corrective
  series; after: the original is A/1, the R5 A/2, the next ticket A/3); `:356` and
  `record-replacement.test.ts:435` (another node's ticket series); `record-replacement.test.ts:420-431`
  split in two (simplified refuses `rectificative`; full refuses `standard`); `:1155-1161` passes the
  corrective series. Then each core file's correction helper defaults to the ticket series (probe:
  143 cases in 7 files fail on `sale.series_wrong_purpose`, assertions unchanged **(run)**). Update
  the docs at `errors.ts:47-49`, `record-correction.ts:57`, `record-replacement.ts:31,43-44`,
  `test/fixtures.ts:54`.
- [ ] **Task 2 — fiscal-verifactu.** `record-remedy-replacement.ts:79` picks `rectificative` for an
  F1 target, `standard` otherwise; `series.no_standard_for_node` joins `REMEDY_REFUSALS` (409) and
  `put-right-words.ts` with a new EN/ES `fiscal_filing.refused.no_ticket_series`. Flip
  `record-remedy-replacement.test.ts:510` (retire the ticket series → 409 `series.no_standard_for_node`)
  and add its F1 twin (switch on, corrective series retired → `series.no_rectificative_for_node`);
  `:205` asserts the R5 "S" takes the ticket series' next number; `:349-383` keeps R4 in the corrective
  series. Re-pin the STOP literals as decided. Fixture-only (probe **(run)**): `correction-history.e2e`,
  `fingerprint-refusal`, `partial-correction-gross.e2e`, `record-remedy-corrective(-http)`. Drop S14
  from `put-right.ts:13-15`.
- [ ] **Task 3 — server, till, setup.** `cancel-credit.ts:55`, `invoice-corrections.ts:367` read
  `"standard"`; `till-api.ts:509` maps `series.no_standard_for_node` 409; the till's
  `codes.ts:360-363` entry is re-keyed to it, worded as the dashboard's (Waitron's own fault, no
  "Tell a manager"), with `codes.test.ts:497` and `cancel-credit-dialog.test.ts:157,173-180`.
  Flipped: `cancel-invoiced-order.test.ts:396-466` (credit in the ticket series), `:811` (no live
  ticket series → `series.no_standard_for_node`), `:992` (two live ticket series → 500), `:1208`;
  `orders-list.test.ts:163,186,265,315` (`/^R\/\d+$/` → the ticket code); `deferred-payment-export.test.ts:136,317`
  (`R/1` → `A/2`). Fixture-only: `testing/order-venue.ts:206`, `testing/replacement-fixture.ts:23-30`,
  and card-capture-mismatch, collect-by-invoice, counter-handover, deferred-close-refusal,
  fiscal-none.e2e, invoice-correction-api, receipt-language, reporting-write-workflows,
  till-sale-integrated.db, till-sales.disk-full, unpaid-departure, zone-core-capabilities (probe:
  40 + 2 cases in 55 files run **(run)**). Setup help EN/ES (`apps/setup/src/i18n/strings/venue.ts:137-142,397-402`):
  ordinary = simplified invoices and their corrections; correction series = corrections of full
  invoices. `cancel-credit.ts:39-41` doc.
- [ ] **Task 4 — docs (driver).** S14's second half, EN (`docs/compliance/asesor-questions.md:392-393`)
  and ES (`:519-521`): "Waitron now numbers ticket correctives (R5) in the ticket series, as V2884-16
  allows, and keeps the corrective series for R1–R4, as art. 6.1.a requires. Would it be better to put
  R5 in the corrective series instead?" (first half, F1/F3, unchanged). Backlog: `docs/backlog.md:378-380`
  and `:1708` lose the S14 gate (the R4 "S" probe stays); `docs/backlog/fiscal.md:1068` "corrective"
  → "ticket"; `:1160-1161` drops S14; a new `### R5-TICKET-SERIES` under its Decisions (`:1033`)
  quoting the owner. Dated pointers in the A1407 plan (Still open 1, `:575`) and research §4.3 d.
  No staff guide names the corrective series **(run: grep)**.

**Not changed:** `computeHuella`, the chain, `registros_facturacion` and its triggers; the three
series kinds and setup's corrective series code (R4 needs it); `FULL_INVOICE_REPLACEMENT_ON` stays
`false` for the R4 "S" probe; earlier R5s stay where they were numbered.

## Open questions (default in bold)

1. Re-pin the three golden literals? **Yes, after independent recomputation** (STOP above).
2. Should core pick the series itself instead of checking the caller's? **No: check only**, smaller.
3. A cross-node R5 joins the issuing node's ticket series, under the reading still open with the
   adviser (`record-correction.ts:46-55`). **No change.**

**Not established:** the full `apps/server` and `apps/till` suites were not run under the probe
(55 server files chosen by grep were); the till's and dashboard's new refusal words are not drafted.
