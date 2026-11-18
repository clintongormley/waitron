# R5-TICKET-SERIES: number ticket correctives in the ticket series — implementation plan

_2026-11-18: the owner's answer, the adviser still to confirm the details — see question 8 of the [19 November sheet](../../compliance/2026-11-19-adviser-meeting.md): "always use a separate series for correctives"._

> **Not built (2026-11-15).** The owner reversed this at ~12:02: ticket correctives stay in the corrective series, and the question goes to the adviser ([meeting sheet](../../compliance/2026-11-19-adviser-meeting.md), question 4).

> **For agentic workers:** `superpowers:subagent-driven-development`, each task dispatched as
> `subagent_type: "implementer"`, test-first (write the named check, watch it fail for the stated
> reason, then the smallest change). Fiscal: full review path; the owner lands the PR.

**Status:** plan only, 2026-11-15, lane L, branch `docs/r5-ticket-series-plan` on `main` at
`29bf70e9f9`. **(run)** = run in this session; **(read)** = only read. Fresh Claude read 2026-11-15
folded in.

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

**Sources pointing the other way.** DGT V1665-22, V0902-22, V1924-23 and V2611-24 say a corrective
for a wrong issue date «deberá constar en serie específica de factura»
(`docs/compliance/research/2026-11-06-adviser-clock.md:297-306`), and the R5 "S" replacing a ticket
AEAT refused as dated in the future (`1112`) is that case. We take V2884-16 to govern a ticket's
corrective because it is the ruling about that document: it states the same «serie específica» rule
and then makes the exception, «No obstante lo anterior, las facturas simplificadas rectificativa
podrán incluirse dentro de la misma serie con el resto de facturas simplificadas»
(research `2026-10-09-vat-and-corrections.md:345-346`), matching art. 7.1.a's optional wording. Our
reading: the research does not say whether the four wrong-date rulings concerned simplified
invoices, and I did not read the rulings themselves. S14 asks the adviser by name (Task 4).

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

## STOP before dispatch: five pinned literals change, carrying three fingerprints

`write-path.e2e.test.ts` and `inmutabilidad.test.ts` stay unedited and pass with the change applied
**(run: throwaway edit, reverted)**. But two other files pin R5s numbered `R/1`; under the change the
R5 is `A/2`, a fingerprint (huella) input, so five literals move **(run)**:
`packages/fiscal-verifactu/src/correction-form.test.ts:141,199` (the fingerprint input,
`NumSerieFactura=R/1` → `A/2`) and `:150,208` (the envelope: that number and the huella), and
`correction-amount.huella.test.ts:181` (the huella). The three huellas, old → new:

| Case | Pinned now | New, from `shasum -a 256` of the input string (run) | New, the reader's own `shasum` | New, from the code (run) |
| --- | --- | --- | --- | --- |
| correction-form, 1 March | `A55D8FDC…` | `E4F6784574BA2CA5AC69BCC85AB9F0261E9F40EFD861C5963FEC57D15E8EEB1C` | the same | not printed |
| correction-form, 5 March | `23FF6F9B…` | `987982CDB871B8974E7F90F9A1CB0B6CD80A2F98B9EAE249C239CEB71979772F` | the same | not printed |
| correction-amount | `76247AD4…` | not computed | `E3C5BDBDD5C77FA06D5647E632E519CE970AAC19290AD0C1642802919B05AAF2` | `E3C5BDBD…` (the same) |

Control: the same `shasum` over today's `R/1` strings reproduces `A55D8FDC…` and `23FF6F9B…`
**(run)**. The setups change too, not only the re-pins: each file inserts and passes its own
corrective series (`correction-form.test.ts:36-40,74`; `correction-amount.huella.test.ts:39-43,82`),
which must become the ticket series. `computeHuella` is not touched. **The owner decides before
Task 1.** Default: re-pin to the independently computed values above. Rejected: seeding a second live
ticket series to keep `R/1` (a state the code calls corrupt, `reserved-identity.ts:101-103`).

## Tasks (one PR, `feat/r5-ticket-series`)

**The branch is green only after Task 3** **(run)**: with the core check alone, fixtures in
fiscal-verifactu (51 cases) and the server (42) still hand an R5 the corrective series and are
refused, so moving lines between tasks cannot make Tasks 1 and 2 green on their own. Each task runs
its own package's focused tests; Task 3 ends with all three packages' focused files green.

- [ ] **Task 1 — core and the three series choices.** Rename `requireCorrectiveSeries` to
  `requireLiveSeries(tx, seriesId, nodeId, purpose)` (file `live-series.ts`), since it now checks the
  ticket series too. `recordCorrection` demands `standard`; `recordReplacement` demands `standard`
  when the original names no customer and `rectificative` when it does. Customer rather than the
  original's own series: the two agree for every original a replacement accepts (`recordSale`
  numbers a sale with a customer from `full`, one without from `standard`, `record-sale.ts:244-251`;
  an F3 is `full`, `record-substitution.ts:159-163`; a replacement refuses a corrective,
  `record-replacement.ts:93`), the row is already read (`:60`), and the backend's R4 test
  (`backend.ts:538`) and printing (`invoice-typing.ts:56-60`) use the same one. The three series
  choices move here: `apps/server/src/cancel-credit.ts:55` and `invoice-corrections.ts:367` read
  `"standard"`; `record-remedy-replacement.ts:79` reads `rectificative` for an F1 target, `standard`
  otherwise. Failing first, flipped:
  `record-correction.test.ts:316-322` (before: refuses `standard`, expected `rectificative`; after:
  refuses `rectificative`, expected `standard`); `:467-480` (before: number 1 from the corrective
  series; after: the original is A/1, the R5 A/2, the next ticket A/3); `:356` and
  `record-replacement.test.ts:435` (another node's ticket series); `record-replacement.test.ts:420-431`
  split in two (simplified refuses `rectificative`; full refuses `standard`); `:1155-1161` passes the
  corrective series. Then each core file's correction helper defaults to the ticket series (probe:
  143 cases in 7 files fail on `sale.series_wrong_purpose`, assertions unchanged **(run)**). Update
  the docs at `errors.ts:47-49`, `record-correction.ts:57`, `record-replacement.ts:31,43-44`,
  `test/fixtures.ts:54`, `cancel-credit.ts:39-41`, and `packages/db/src/errors.ts:42-43` ("a
  corrective of a full invoice").
- [ ] **Task 2 — fiscal-verifactu.** `series.no_standard_for_node` joins `REMEDY_REFUSALS` (409) and
  `put-right-words.ts` with a new EN/ES `fiscal_filing.refused.no_ticket_series`. Flip
  `record-remedy-replacement.test.ts:510` (retire the ticket series → 409 `series.no_standard_for_node`)
  and add its F1 twin (switch on, corrective series retired → `series.no_rectificative_for_node`);
  `:205` asserts the R5 "S" takes the ticket series' next number; `:349-383` keeps R4 in the corrective
  series. Re-pin the STOP literals as decided, with their setups. `correction-path.e2e.test.ts`
  calls the backend directly (it passed the probe) but still numbers its R5 `R/1` and states the old
  premise: its comment (`:32-34`), series (`:45,65-66,120`) and `:207` (`"R/1"` → the ticket
  series' next number) move to the ticket series. Fixture-only (probe **(run)**): `correction-history.e2e`,
  `fingerprint-refusal`, `partial-correction-gross.e2e`, `record-remedy-corrective(-http)`. Drop S14
  from `put-right.ts:13-15`.
- [ ] **Task 3 — server, till, setup.** `till-api.ts:509` maps `series.no_standard_for_node` to 409
  in place of `series.no_rectificative_for_node`. This also changes the ordinary sale path, which
  raises that code when a node has no live ticket series (`invoice-selection.ts:121`): today an
  unmapped `AppError` answers 400 with its code (`packages/server-kit/src/error-boundary.ts:48`,
  read), so a refused sale goes 400 → 409 and the till shows the new words in place of its generic
  fallback (`apps/till/src/i18n/codes.ts:977`). `invoice-selection.test.ts:102` checks only the code and stays; add one till-route case
  pinning 409 for a sale with the ticket series retired. The till's
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
  invoices.
- [ ] **Task 4 — docs (driver).** S14's second half, replacing the old "may R5 and R1–R4 share one?"
  (first half, F1/F3, unchanged). EN (`docs/compliance/asesor-questions.md:392-393`): "Waitron now
  numbers a corrective of a simplified invoice (R5) in the ticket series, as V2884-16 allows, and keeps
  a corrective series for R1–R4, as art. 6.1.a requires. V1665-22, V0902-22, V1924-23 and V2611-24 say a
  corrective for a wrong issue date «deberá constar en serie específica de factura». For an R5,
  including the R5 "S" that replaces a ticket AEAT refused as dated in the future: which are allowed —
  (a) the ticket series, as now; (b) a series for R5 alone, like AEAT's developer FAQ example
  «RS-0001»; (c) the corrective series shared with R1–R4 — and which is better?" ES (`:519-521`):
  «Waitron numera ahora las rectificativas de facturas simplificadas (R5) en la serie de las
  simplificadas, como permite la V2884-16, y reserva una serie específica para las rectificativas de
  facturas completas (R1 a R4), como exige el art. 6.1.a). Las consultas V1665-22, V0902-22, V1924-23
  y V2611-24 dicen que la rectificativa por una fecha de expedición errónea «deberá constar en serie
  específica de factura». Para una R5, incluida la R5 por sustitución («S») de una simplificada que la
  AEAT rechazó por tener fecha futura, ¿cuáles de estas opciones son admisibles: (a) la serie de las
  simplificadas, como ahora; (b) una serie solo para las R5, como el ejemplo «RS-0001» de las FAQ para
  desarrolladores de la AEAT; (c) la serie de rectificativas compartida con las R1 a R4? ¿Cuál es
  preferible?» The `RS-0001` example: FAQs-Desarrolladores, 4 Dec 2025, pp. 49–50, per the watcher's
  read (`desk/done/20261115-0743-L-land-3301.md:26`). Same file: status row `:315`, and a dated
  pointer at Q5(d)(ii) (`:1235-1237`). A dated note on T7 in `docs/compliance/2026-11-06-adviser-questions.md:156`
  (Waitron numbers that R5 in the ticket series; S14 asks). Backlog: `docs/backlog.md:378-380` and
  `:1708` lose the S14 gate (the R4 "S" probe stays); `:2482` (S14 now asks where R5 goes);
  `docs/backlog/self-service-refusals.md:233` (switched off until the probe only);
  `docs/backlog/fiscal.md:1068` "corrective" → "ticket"; `:1160-1161` drops S14; a new
  `### R5-TICKET-SERIES` under its Decisions (`:1033`) quoting the owner. One dated pointer in the A1407
  plan (which states the old gate at `:57`, `:295`, `:424`, `:575`, `:590`) and one in research §4.3 d.
  No staff guide names the corrective series **(run: grep)**.

**Not changed:** `computeHuella`, the chain, `registros_facturacion` and its triggers; the three
series kinds and setup's corrective series code (R4 needs it); `FULL_INVOICE_REPLACEMENT_ON` stays
`false` for the R4 "S" probe; earlier R5s stay where they were numbered.

## Open questions (default in bold)

1. Re-pin the five literals (three fingerprints)? **Yes, to the independently computed values**
   (STOP above).
2. Should core pick the series itself instead of checking the caller's? **No: check only**, smaller.
3. A cross-node R5 joins the issuing node's ticket series, under the reading still open with the
   adviser (`record-correction.ts:46-55`). **No change.**

**Not established:** the full `apps/server` and `apps/till` suites were not run under the probe
(55 server files chosen by grep were); the till's and dashboard's new refusal words are not drafted.
