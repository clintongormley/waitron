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

## A1a. A foreign business customer needs an identifier-type decision

`recordSale` now names a Spanish recipient on a full invoice. A non-Spanish one is refused by name
(`fiscal.foreign_recipient_unsupported`), deliberately: AEAT's `IDOtro` needs an `IDType` — NIF-IVA,
passport, residence certificate and so on, enumerated in
`@waitron/verifactu`'s AEAT XSD (`SuministroInformacion.xsd`) — and choosing wrongly files a record
into an append-only table that can never be unfiled. Whoever wires up business-customer sales makes
that call. A231 adds the saved Spanish-recipient choice around issuance, with public F1 disabled. Foreign
recipient support remains outside that build; `recordSubstitution` still has no HTTP route.

## `packages/fiscal-verifactu` restates rules the validator owns

- **`packages/fiscal-verifactu` restates rules the validator owns** — `venue-fields.ts` its venue-field
  patterns and caps, `backend.ts` its simplified-invoice limit — kept honest by drift guards
  (`record-limits.test.ts` compares the limit and the recipient name cap with the validator's verdict).
  Exporting the patterns from the library instead was DEFERRED on purpose (owner, 2026-09-12) — it
  widens an audited fiscal library's public surface and the drift guard already closes the risk.
  Revisit when something else needs those patterns.

## A1e. Simplified and full invoices use separate series — BUILT, PUBLIC F1 DISABLED (2026-10-06)

A231 [#1256](https://github.com/clintongormley/waitron/pull/1256) adds the `full` purpose beside
`standard` and `rectificative`, provisions its series, and makes core require it for F1 and F3.
Public F1 issuance remains disabled; no route calls `recordSubstitution`. The separate-series
basis is recorded in [verifactu-findings.md §10.1](../compliance/verifactu-findings.md).
**Next action:** complete A231's enablement gates below. Asesor Q5(d) remains open for F3 and R5.

## A231. Full invoices at the till — GATED IMPLEMENTATION LANDED (2026-10-06)

The owner authorised the gated implementation, which landed as
[#1256](https://github.com/clintongormley/waitron/pull/1256), squash `2d972685530676fbe7c182760f0d96f461214e47`.
Existing preproduction venues require a reset for the schema change. Public F1 issuance remains
disabled. The [design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md) and
[implementation plan](../superpowers/plans/2026-10-03-full-invoices-at-till.md) retain the decisions
and dated implementation receipts.

The build covers a Spanish recipient's saved tax ID, name and address, a separate full-invoice
series, taxpayer domicile, filed receipt data and replay, original/duplicate printing, delivery
status and retry, staff handover confirmation, invoice lookup, and reporting. Paper and till
omit the location address when an F1 shows its filed taxpayer domicile; phone/email and the
F2/absent-domicile controls remain. Automatic F1 credit/refund/cancellation is refused.
The operation day is the owner's provisional service-start rule, awaiting asesor confirmation.

The owner approved the historical-export fixture's current artifact
refusal, including its could-not-open operator advice; provenance, HTTP400/domain-error,
unchanged-database and empty-staging checks remain. This is preproduction format rejection,
with no backward-compatibility implementation.

**Next action:** verify physical 58/80 mm paper and QR output, complete A231q's remaining original-delivery
choices, obtain the asesor's manual-remedy approval and settle applicable B2B delivery before
enabling public F1. The enablement change needs its own direct, invoice-first, unpaid-departure,
offline and zero-total public-path acceptance checks. F3 conversion, F1's R1–R4 correction path
and foreign-recipient `IDOtro`/`IDType` remain separate decisions. Follow the campaign's current
queue order; this landing does not start another fiscal item.

## A231d. Full invoices by email as a PDF, and on an office printer — PART 1 LANDED (#1399); PART 2 OPEN

The owner asked, approving A231's design, that an F1 can also be emailed to the customer as a PDF and
printed on an ordinary office printer. The [design](../superpowers/specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md)
and [plan](../superpowers/plans/2026-10-03-invoice-pdf-email-and-office-printing.md) cover the PDF (made
on the server, QR first), email with the customer's express consent from a queue that never makes a
sale wait, office printers kept apart from receipt printers, and resending from the till and the
dashboard. The customer chooses one way to receive the original; anything after it is a «duplicado».

The owner approved the first version's decisions 1–5 (2026-10-03, about 08:45) and changed the
sixth; the amended version builds email and A4 printing together. Any network office printer is
added as an invoice printer through the Printers screen's existing add-printer dialog, and is sent
PDF when it lists PDF, otherwise PWG Raster, otherwise Apple Raster, drawn on the server from the
same layout. No printing standard requires PDF: IPP Everywhere 1.1 requires PWG Raster and only
recommends PDF, and AirPrint and Mopria publish no public list. A live venue sets up its mail server in the
setup wizard's live path, with a test message, and can change it from the dashboard. A venue
preparing to go live sends invoice email through its mail server when one is set, otherwise to the
box's captured inbox; a demo always captures it. Measured 2026-10-03: the owner's HP M181fw takes
PDF and Apple Raster, not PWG Raster.

The owner asked (about 08:55) to weigh Debian's printing system (CUPS) against drawing pages
ourselves, and answered decisions 7–9 (about 10:05). Measured in Debian 13 containers on the owner's
Mac: CUPS, its converters, `ipp-usb` and `cups-browsed` add 52.7 MB (about 50% more) to the print
agent's download and bring Ghostscript (GNU Affero GPL). CUPS converted a PDF for an Apple Raster
printer. Its own driverless setup refused a printer taking only PWG Raster (apparently a mistake in
CUPS 2.4.10 that later versions fix; Debian testing's 2.4.18 accepted it), and that printer did
print through a route CUPS calls deprecated. CUPS held a job while the printer was away and printed
it by itself later; its source code waits 7 days before counting such a job failed. The owner approved drawing pages ourselves (decision 10), and A231 has landed.
**Part 1 landed, 2026-10-08:** [#1399](https://github.com/clintongormley/waitron/pull/1399),
merge `eb6403150efe76b16a15dd63a8486d3636ab50ee`. The stored-fact document, transient
PDF/raster rendering, metadata-only delivery attempts, correlated receipt claims/results,
queued email worker and SMTP settings/test endpoints are on main. Public F1 remains disabled.
A231q still owes the setup/dashboard and delivery screens, provisioning/restore checks,
office-printer discovery/registration/location selection and IPP transport, send-again/download
and withdrawal actions, built-image renderer execution, box measurements and physical output.
Physical checks require owner presence or arrangement; adviser confirmation and public F1
acceptance gates remain separate.

**Next action:** follow the lane's UI priority order, then complete A231q. The following dated
notes preserve earlier candidates and the owner's split decision.

**Owner split, 2026-10-07:** finish the completed foundation as A231p part 1, keeping public F1 issuance disabled, and park its PR `needs-owner-review`. UI work takes priority next. A231q finishes the live email setup/provisioning and dashboard editor, restore checks, office-printer discovery/registration/location selection and IPP transport, delivery and send-again/download screens, withdrawal actions and the remaining integration and gate. Built-image rendering, box measurements and physical printer checks remain; physical printing requires owner presence or arrangement. The [reconciled plan](../superpowers/plans/2026-10-03-invoice-pdf-email-and-office-printing.md) lists the split. The foundation built so far: the shared document content has been extracted from the roll renderer,
with captured mixed-rate discounted F1 bytes preserved on 58/80 mm paper. The A4 PDF and
300/600 dpi glyph-outline page renderers now share a paginated layout. Tests extract the saved
figures, decode the drawn QR, compare raster text with the PDF rendered at 300 dpi, and check
repeatable PDF bytes. Spanish, Catalan, Galician and Basque fixtures preserve their saved names,
localized labels and cent-exact figures in extracted PDF text. At 300 and 600 dpi, each nonblank
text row passes a threshold of 99% of the PDF reference ink present within two dots in the raster;
the bundled font has a glyph for every character in those rendered fixtures. Removing the accented é outline fails the Spanish and Galician row
comparisons while the Catalan and Basque controls pass. The PWG and Apple Raster encoders
now match native CUPS reference files at 300/600 dpi. Native readback compared every decoded pixel and header size, resolution and
colour space for the invoice page and two-page pattern fixtures. A synthetic `ippeveprinter`
completed all four format/resolution jobs; its command decoded both pattern pages unchanged.
These checks ran against source modules. The metadata-only queue now reserves email attempts,
retains the recipient and consent for each request, and distinguishes original retries from
duplicates. Its claim helpers use fresh tokens, keep only their hashes, expire to an unknown
outcome, and authenticate late reports against the recorded attempt. Tests cover late results
before a retry, while it is queued or sending, and after it succeeds or fails. Existing receipt
originals participate in reservation checks. Receipt reservations now correlate to the existing
job through a declared foreign key and unique index, and reject another sale's job, drawer
jobs, non-receipts, reused jobs and an original/copy designation that differs from the saved
job. Receipt claim metadata references the print agent and requires that agent's current
print-job claim. At helper expiry the linked job loses automatic claim eligibility before an
email retry is reserved; a historical report leaves that job unchanged. Current and latest
late reports project the outcome onto the existing job without another handover snapshot.
The focused tests and independent guard deletions cover these helper paths.
The print pull/result routes and demo printer now attach and return the delivery's token and
generation for correlated receipt jobs. The real agent/client integration tests cover successful
and failed sends, malformed claims, another job or holder, expiry without automatic replay,
and old same-agent success/failure reports during each newer receipt-retry state. The generic
local runtime leaves correlated jobs for this adapter, and the generic reporter refuses them.
Nineteen disposable guard deletions each failed the intended assertion beside a valid passing
control. The till's original-retry route and the management print-job resend route now enroll
F1 resends in the same transaction as the new job, attributing them to the authenticated
staff member. They preserve receipt bytes, printer and resend history, refuse an active
cross-medium attempt, and refuse resending original bytes after completion. The till expires
an old claim before checking whether the original can be retried. Synthetic F1 HTTP cases
cover failed and expired retries, concurrent requests, late results, copy resends and rollback
when metadata cannot be written; existing F2 and drawer assertions remain unchanged.
The till's explicit original/copy actions and dashboard copy helper now enroll newly rendered
F1 paper jobs with the requesting staff member, in the same transaction as the job and
copy audit. Synthetic tests cover replayed original requests, paper copies after completed
email, active-email refusal with no job/audit left behind, expiry before a paper original,
and the F2/no-printer controls. Eight independent deletions fail the intended case beside
a valid passing control. The automatic receipt hook now enrolls F1 originals using the
operator recorded on the sale, including when optional receipt printing is off. Synthetic
cases cover replay, cross-medium refusal and rollback, absent printers, and sales with no
recorded operator. Removing the forwarded operator makes the attributed-original test fail
while the unattributed-sale control still passes. The next checkpoint enrolls unattributed
paper originals with a null staff attribution. Synthetic tests cover reservation/replay,
automatic enrollment and token-checked completion without a handover snapshot; email/A4
rows without staff attribution are refused. Generated core migration 0119, schema
conformance and stepwise upgrade checks passed. No whole-Task-2 claim.
The invoice-mail routing helper now captures demo/development mail locally, resolves prepare
mail through configured SMTP or capture, and reports unconfigured live/restored venues.
The standalone sender renders a transient PDF and uses Nodemailer. Local SMTP fixtures cover
readable original/duplicate attachments, recipient and DATA refusals, lost final acknowledgement,
and an unanswered attempt ending at 30 seconds with its socket closed. Implicit TLS tests
cover a refused untrusted certificate and a trusted test connection. The worker pass now
commits a claim, closes a separate projection transaction before transport, and reports with the saved claim identity. Certain email
refusals retain their metadata and reserve another generation, due after 5 seconds,
30 seconds, 2 minutes or 10 minutes, stopping after five attempts. Unknown outcomes are
not automatically replayed. Synthetic database cases cover another sale committing while
the injected sender waits, competing passes, due times, unchanged consent/recipient snapshots,
duplicate markers, late outcomes, rollback and sanitised throws. The routed sender now reads
the current mail settings before each send; a real local SMTP case rotates the saved gateway
and sender address between two sends, then removes it and observes a certain failure with
no further message. The standalone loop checks primary status on each iteration, contains
pass failures and finishes the pending send's report before returning after a stop signal.
Database cases cover idle and in-flight stops, an already-stopped worker, secondary-to-primary
gating and recovery after a pass failure. The stored-document reader now projects sale and
line snapshots, saved receipt grouping/header, adjustments and payments. Eight synthetic
cases cover no-regime and filed invoices, weighted extras, a paid discounted bill and its
operation date, current optional trim, taxpayer changes, no-order settlements, absent line
gross and refused lookups. Trading boot now starts the routed email worker after claim
recovery, checks the singleton role on each pass, and joins the pending send and its report
before normal shutdown or failed-start cleanup closes the store. Real local SMTP cases
exercise a queued duplicate's saved invoice facts, a held acceptance during normal close,
a later failed startup, and queued-email controls on a local secondary and a read-only mirror.
The separate page-printer schema now records IPP endpoints, supported and selected formats,
media and resolution. A new A4 delivery request stores its page-printer reference and refuses a
receipt-printer id, a disabled page printer or one outside the sale node's location. Replayed
reservations retain their row after printer disablement. Configuration transfer preserves the
capabilities, remaps the id/location and imports the page printer disabled with a reconnect
notice. Synthetic database cases cover these paths; core schema conformance and the stepwise
upgrade guard passed with generated migrations 0120/0121. Registration, location selection,
A4 claim/renewal/transport and delivery UI remain open.
The bill's internal invoice-choice writer now stages receipt/email/A4 metadata under its
revision check. Email consent snapshots use server staff/time and preserve the displayed
venue contact; stale edits, malformed choices and unavailable email are refused. A4 staging
requires an active local page printer. The new column is included in the database's
transition restrictions, with focused refusal and valid-revision cases. The HTTP invoice-choice
route now forwards the delivery choice, stamps consent with the authenticated staff member and
server clock, and asks the current invoice-mail resolver whether email is available. Real boot
cases cover demo, prepare, development and live SMTP, with unconfigured live email refused.
Bill reads return a saved delivery draft. Null choices and unavailable A4 destinations are refused
without advancing the bill. The automatic sale-receipt hook now reserves the saved email/A4
original against the issued sale, using the existing caller transaction, and suppresses its
fiscal receipt. Synthetic paid-bill cases check that a rollback removes both the sale and the
reservation, and a replay preserves the reservation. An A4 destination disabled after its
accepted choice does not refuse captured-bill completion; new delivery requests still require
an active destination. Receipt cases keep a prepaid collection ticket separate, retain explicit paper originals and ignore a synthetic F2's stale email draft.
The internal unpaid-issuance function now reserves the saved email/A4 choice in its existing
transaction after the sale is written. Synthetic selection fixtures exercise real core invoice
writes, consent/staff snapshots, rollback, accepted A4 disablement and unchanged paper/F2
controls. Separate cases keep the public F1 refusal ahead of both sale and delivery writes.
The trading server now offers manager-only SMTP settings reads, changes and test messages.
The settings write seals the existing `email.smtp` payload; the read returns the server, port,
encryption choice and sender, without the username, password or URL query. Demo and prepare
changes are refused. The test goes to the authenticated person's own address, sends outside the
database transaction and saves no proposed credential. Real local SMTP cases exercise accepted
mail, refused recipients/data, lost acknowledgement, timeout closure and trusted/untrusted TLS.
The wizard's required live email step, provisioning, dashboard editor and restore checks remain
open, alongside printer registration/transport and the delivery UI; no Task 3 or 4 completion claim.
For enrolled receipts, the real pull now projects
confirmed unpairing and unavailable-Bluetooth endings onto delivery metadata in the same
transaction. Queued receipts become failed; handed-out receipts become unknown and retain
their token hash for authenticated late results. Six API cases cover cross-medium original
retry, printer reactivation without replay, another agent's printable-device control,
completed originals, and late success before and after a newer attempt. Trading boot now
marks inherited receipt and email claims unknown before the pretend printer and print-agent
routes start, separately from fiscal drain recovery. Synthetic real-boot cases cover fresh
claims, ordinary printable jobs, authenticated late email success/failure and a read-only
mirror control. Bill staging, A4 printer registration and location selection, SMTP setup, office
transport, delivery UI and image/box checks remain. It settles A3's open "Printing A4 invoices
on an office printer" work when complete.
Task 1 font/build checks are still open: the standalone PDFKit 0.20.2/fontkit 2.0.4 probe
throws when embedding the current Google Sans WOFF2 for “í”; Noto Sans rendered the same probe
as PDF and glyph outlines. In the pre-alias bundle probe, PDFKit's ESM import collided with
the shared banner's `createRequire` name, and the notices collector required upstream notices
for brotli 1.3.3,
dfa 1.2.0 and fontkit 2.0.4. Their upstream licence declarations and terms are now collected,
including the Apache notice on brotli's Google decompressor. The normal renderer bundle writes
its notices. The owner approved the banner alias on 2026-10-07. With that alias, a new real
bundle-load regression passes with both the entry's own `createRequire` import and the
CommonJS shim exercised. The standalone renderer bundle produces the same 12,353-byte PDF
and byte-identical 300/600 dpi PNGs as the prior source-rendered fixtures; both raster QRs
decode to the filed link. All four shared-bundler consumers build, and Node syntax checks
pass for their 12 JavaScript bundles. Built-image rendering and box measurements remain open.

Renderer receipt, 2026-10-07: the mixed-rate discounted F1 PDF is 12,353 bytes; the six-page
35-line fixture is 17,421 bytes. The 600 dpi SVG QR initially had antialiased module seams and
failed jsQR decoding, including when cropped; hard QR edges make both 300/600 dpi pages decode
the filed link. Source text retains antialiasing. Noto Sans and its licence match the pinned
upstream files byte for byte; the build copy matches the source font. Image/box timings and
physical HP output remain pending.

The wizard's SMTP test endpoint is now mounted in setup mode. A Live request sends a short
message to the submitted administrator's normalised address through the shared bounded sender,
without database dependencies. Its 21 added cases exercise real SMTP acceptance, refusals,
lost acknowledgement and timeout, as well as field validation and secret-free answers/logs;
the related six-file run passed 381 cases. The wizard screen, provisioning requirement and
credential sealing, dashboard editor and restore checks remain open.

**Owner decisions in place of the asesor's answers (2026-10-07, under the plan's Task 0.1), so A231p may be built.** Public F1 stays disabled until A231's own enablement gates are met; the asesor is asked to confirm these as [Q44](../compliance/asesor-questions.md#q44-sending-a-full-invoice-as-a-pdf-by-email-or-on-a4--the-owners-interim-answers-added-2026-10-07):

1. A PDF emailed after a paper original, or paper after an emailed original, is a «duplicado» and is marked so.
2. Consent to email: staff ask the customer and record the answer on the till. The customer does not sign or confirm anything themselves.
3. Keeping: the same as a printed F1 — the invoice's database record. No copy of the PDF file is stored. The reconciled plan drops the proposed delivered-PDF table and keeps delivery metadata only.
4. An unsigned PDF is a valid original for a business customer before the business regime below applies, carrying the same QR and legend as paper. Receipts, each found word for word in the source fetched 2026-10-07: RD 1619/2012 art. 8.4, «se presumirá acreditada cuando se haya expedido utilizando un sistema o programa informático en conformidad con los requisitos»; DGT binding ruling V2891-18 (08/11/2018), an emailed PDF «con independencia de que no haya sido firmada digitalmente por el emisor de la misma, tendrá la calificación de factura electrónica»; AEAT's Veri*Factu FAQ, the QR on a PDF «no tendrá especialidades respecto de la que corresponde a la emisión en papel».
5. A retry after a failed or uncertain send is still the original.

**When the business e-invoicing regime starts.** [Orden HAC/1028/2026](https://www.boe.es/buscar/doc.php?id=BOE-A-2026-20587) (BOE núm. 247, 5 October 2026) «entrará en vigor el día siguiente al de su publicación en el «Boletín Oficial del Estado», dándose inicio al cómputo de los plazos» of [RD 238/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295)'s fourth final provision: «Doce meses después» for businesses whose turnover is over €8 million, and «Veinticuatro meses después, para el resto de los empresarios y profesionales». So from about October 2027, or October 2028 for smaller businesses, an invoice to a Spanish business must be a structured message, and a PDF alone is not enough (the design's register, RD 238/2026 art. 7.1). The exact end day of each period, and whether a restaurant's F1s to businesses fall inside the regime, are asked as [Q45](../compliance/asesor-questions.md#q45-when-does-structured-business-invoicing-reach-a-restaurants-full-invoices-added-2026-10-07). Researched 2026-10-07 in the watcher session; the fetched texts were not kept in the repository.

## A275. Invoice a bill paid later by transfer (full or simplified invoice) — WAITS ON ASESOR Q42 (2026-10-06)

The owner, 2026-10-06: a large bill (their example, €5,000) is rarely paid on the spot; the customer
gets the invoice and pays later, for instance by bank transfer — or, as the owner has seen in Italy,
gets a proforma and the invoice only once the money arrives. [Q42](../compliance/asesor-questions.md#q42-a-bill-paid-later-by-bank-transfer--invoice-now-or-a-proforma-and-the-invoice-on-payment-added-2026-10-06)
asks the asesor whether both are lawful and which is recommended, for full invoices (F1, A231) and
simplified invoices (F2) alike, with non-payment and deposits. **No design or build until the asesor
answers and the owner decides.**

Already built, to reuse: filing an order's invoice with no payment (`issueUnpaidInvoice`,
`apps/server/src/working-order.ts`); the amount due on each issued invoice (`apps/server/src/sale-due.ts`);
collecting a placed order's issued invoice later (`collectOrder`, `apps/server/src/till-sale.ts`);
unpaid departure, which issues an F2 for the full amount and records what it owes (Q28); the Orders
screen's Unpaid filter and Still owed column (`apps/server/src/orders-list.ts`); and a `transfer`
tender method in the schema (`packages/db/src/schema/sales.ts`). Missing: a till action that issues an
invoice for the customer to pay later (today only invoice-first placing and an unpaid departure
issue one before payment); recording a payment by transfer with its reference (collecting
accepts only cash or card, `sale.unsupported_tender`); collecting part of what an issued invoice
owes (`settleSale`, `packages/core/src/settle-sale.ts`, refuses a settlement that does not match what is due, or a second one);
whether the Orders screen is enough as the list of unpaid invoices; how the daily close shows an
invoice still owed; and what happens when the customer never pays. An F1 also needs A231's build.

## W41s. Fiscal prevention and offline recovery — DESIGN AND REVISED PLAN APPROVED (2026-10-04)

**Update, 2026-10-08: paused and not queued.** The owner paused the remaining W41s tasks on
2026-10-06 ("pause the other w41 tasks for now, continue with the non-w41 tasks") and on 2026-10-08
took them off the campaign queues; take them from here when they are un-paused. Left: W41s-1b
(AEAT preproduction probe: records sent after a conflict), W41s-4 (atomic allocation activation),
W41s-5 (transactional active-series selection), W41s-6 (recovery pack and offline administrator
flow), W41s-7 (conditional automatic conflict recovery), W41s-8 (corrective records and held-case
resolution), W41s-9 (fiscal filing and missing-history screen), W41s-10a (reconciliation and device
evidence), W41s-10b (signed stream witnesses and fencing), W41s-11 (complete offline exercise and
operator procedure) and W41s-C (cloud registry handoff), each a task of the revised plan below.
W41s-3d (a chain held by repeated same-code refusals sends its first held record once an hour) is
built and reviewed on draft PR [#1309](https://github.com/clintongormley/waitron/pull/1309), branch
`feat/w41s-brake-hourly-probe`, kept as it was; it needs a rebase before landing.

**Update, 2026-10-04:** the owner requires prevention before conflict recovery, including an
old-backup restore on new hardware with no internet. The
[revised design](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md)
records manual recovery, a paper allocation register in the recovery pack, an optional cloud
registry reachable by phone, emergency random series and an explicit later switch to a fresh
short series. Device evidence is optional. Matching invoice date and amounts no longer excuse
a fingerprint mismatch. Q5(f) and Q33–Q40 in the adviser document are revised, and Q41 covers
issued invoices missing from the backup. The owner approved this design ("lgtm") and selected
queue execution. The [revised implementation plan](../superpowers/plans/2026-10-04-fiscal-prevention-and-offline-recovery.md)
separates development from production-enablement gates: prevention and evidence work can
proceed while adviser answers are pending; disputed remedies retain explicit gates. It includes
an allocation-contract checkpoint, live AEAT probes, offline recovery, corrective workflows and
a separately owned Cloud registry workstream. The owner approved the revised plan on 2026-10-04;
it replaces the 2026-10-03 task list while W41s remains the backlog item. The owner approved
the allocation and recovery contract in §9 and granted W41s-4 a narrow H2 scope exception on
2026-10-05. Task 2 landed as [#1213](https://github.com/clintongormley/waitron/pull/1213).
W41s-1 completed eight synthetic preproduction probes;
[the dated protocol receipt](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#71-protocol-receipt-2026-10-05-w41s-1)
records each outcome and its limits; the library probe PR is
[waitron-io/verifactu#132](https://github.com/waitron-io/verifactu/pull/132) (no release tag was created).
**Update, 2026-10-05 (W41s-1d):** [the asesor questions](../compliance/asesor-questions.md)
Q33–Q41 and [the findings, §16](../compliance/verifactu-findings.md#16-aeat-test-service-observations-for-conflict-recovery-added-2026-10-05-w41s-1)
now carry the test-system receipts and their limits. The legal questions remain open.
W41s-10c landed as [#1264](https://github.com/clintongormley/waitron/pull/1264). A231 #1256 has
landed with public F1 disabled. **Next action:** continue the approved dependent W41s tasks in campaign order,
keeping each task's fiscal and adviser gates.
**Update, 2026-10-06 (W41s-3, landed):** Task 3 landed as
[#1289](https://github.com/clintongormley/waitron/pull/1289), with the owner's approval of its
nine changed filing checks and of the landing. Every line of AEAT's reply is kept (but see W41s-3c
below). A
rejection on its own no longer holds the later records of its chain (D2, on
[§7.1's receipts](../superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md#71-protocol-receipt-2026-10-05-w41s-1));
only rejection code 1161 was tested, and it was triggered artificially. A conflict with AEAT's
copy, or a held cancellation, holds the later records of its chain that have not been sent. A
record sent in the conflict's own envío is not held when the reply is applied; a record of the
conflict's envío that comes after it on the chain and whose outcome is still unknown is held at its
next claim like any later record of that chain, and is not sent again.
A cancellation whose original was rejected or is held is itself held and never sent. When the
lookup that follows a duplicate answer fails, only that record's outcome becomes unknown. Each
record that needs a person's decision gets a filing case, kept in tables whose rows cannot be
changed or deleted; resolving a case releases nothing yet (Tasks 8–9 do that). A new ongoing
alert, `fiscal.filing_cases_open`, counts the cases with no resolution. **Still open:** no probe
has yet shown what AEAT does with a record sent after a 3000 conflict or after a held
cancellation; the owner chose (2026-10-06) to keep holding there, and the live probe of those two
cases is queued as W41s-1b. A refusal that would refuse every later record (one about the
taxpayer's identity, say) opens one case per record until the brake below stops the chain; one
reply can still open up to 1,000 cases first (`MAX_REGISTROS_POR_ENVIO`).
**W41s-3b (landed, #1303, 2026-10-06):** when the three records immediately
before a record on its chain were all rejected with one error code (`SAME_CODE_REFUSAL_LIMIT` in
`packages/fiscal-verifactu/src/drain.ts`), the drain holds that record and the chain's later ones
when they are claimed, between envíos, and only records never sent before. A record still awaiting
AEAT's answer breaks a run: when the record right after a run was sent and its answer is unreadable
or missing, the records added after it are sent with its retry, and a later record is held only
once the refusals immediately before it make a run of three. The ongoing alert
`fiscal.refusals_repeated` names the code and the length of the run. Nothing releases the hold yet.
**Follow-up (W41s Task 8, held-record resolution): release a brake hold (send the held records
again).** Task 8 as planned resolves records that have a case of their own; a record the brake holds
has none. While held, those records are not retried hourly. The owner chose (2026-10-06) to add
an automatic hourly probe that sends the first held record once an hour, an accept restarting the
chain and a same-code refusal adding one case: queued as W41s-3d. The owner also chose to keep the
records added after a run's unanswered successor sent with its retry, as built. It was built so because when the retried record's answer is anything but a refusal with
the run's code, the run is broken and nothing would explain such a hold: the
`fiscal.refusals_repeated` alert would not show, and when that answer is not a refusal at all
`heldRecords` would name no case for the held records.
**Follow-up W41s-3c — DONE ([#1304](https://github.com/clintongormley/waitron/pull/1304), landed
2026-10-07 on the owner's approval):** `resolveLines` in `packages/fiscal-verifactu/src/drain.ts` used to match a
reply line to a claimed record by `RefExterna` alone; a review probe gave invoice B's accepted line
invoice A's reference and the drain marked A `aceptado` though AEAT had rejected it. Now, as the
owner chose (2026-10-06), line N of AEAT's reply is paired with record N of the envío, and is
applied only when it carries that record's reference, names the invoice (issuer NIF, number, date)
the record was sent as, and names no operation (`Operacion.TipoOperacion`) other than the one sent;
a line with no operation is not refused for that. No other line is consulted for that record, so a
copy of record A's line at record B's position leaves B unknown and still applies A's own line,
whatever the copy says. Any record whose line fails becomes unknown at once: it waits for its retry,
its chain's records not yet sent wait behind it, and its `fiscal.estado_desconocido` carries the
operation and invoice sent and the line at its position (`lineaRespuesta`). Before, a record with no
line sat `enviando` until the five-minute recovery or a restart. When the reply holds a different
number of lines than records sent, no line is applied, every record of the envío is unknown with the
reply's line count (`lineasEnRespuesta`) on its alert, and the reply's lines are kept once, in a
warning `fiscal.respuesta_descuadrada` on the sale of the envío's first record, with the envío's
record ids and its CSV. The dashboard's sentence does not show those lines; `readOpenAlerts`
(`apps/server/src/alerts.ts`), behind `GET /management-api/alerts`, returns them in the alert's
params. **Still open:** in AEAT's preproduction environment two runs of shuffled envíos of up to
1,000 records each got their replies back in the order sent (verifactu #138's probe, recorded in
[Q43](../compliance/asesor-questions.md)); production is not measured, and the question stays with the
asesor. A line AEAT moves away from
its record's position is never applied, so that record stays unknown and is retried unless an
earlier record on its chain is on hold, while records whose line is still at their position are
applied as usual. A record whose line AEAT moved in every reply it was sent in would never be
confirmed: Route B's lookup never runs for it, each retry sends it again in the same chain order
while the later records of its chain wait behind it — loud (an alert per record) and never a wrong
acceptance. One option for the owner, not built: after a mismatch, send
each unknown record again in an envío of its own. An incident is not stored while one with the same
code for the same sale is open, so while a `fiscal.respuesta_descuadrada` is open for a sale, a later
mismatched reply to an envío whose first record belongs to the same sale (that record again, or the
sale's cancellation) keeps none of its lines. And no run
against real AEAT has shown that a cancellation's reply line names the cancelled invoice (the schema
types the line's `IDFactura` with the plain field names, and the library's fake echoes the cancelled
invoice there). If AEAT named a different invoice on that line, the cancellation would come back
unknown and be retried with an alert; a line without the plain field names is refused by the
library's parser, which backs off the whole envío; that back-off raises no incident and keeps no
CSV, and every resend would meet the same refusal, so those records would wait until the four-hour
delayed-submission alert (`fiscal.submission_delayed`,
`packages/fiscal-verifactu/src/submission-alerts.ts`).
**Re-examine the hold behind an unknown outcome once the asesor answers — OPEN (waiting on the
asesor; owner 2026-10-06).** `claimBatch` in `packages/fiscal-verifactu/src/drain.ts` does not send a
record while an earlier record of its chain is `enviando` or waits for a retry (W41s-2, #1213,
following the design §4 line "A retry delay must not let a later record overtake an earlier unknown
outcome", written 2026-10-04). The AEAT preproduction probes of 2026-10-05 were not checked against
that line: AEAT accepted records linked to a refused predecessor in the same batch, in a later batch,
and all 999 successors of a 1,000-record batch ([evidence](../superpowers/specs/2026-10-05-aeat-protocol-evidence.json),
runs 37283677375, 37283909983 and 37283910284). Records sent in the same batch as an unknown one
are not held; only unsent ones wait. Not probed: a successor reaching AEAT before its predecessor
arrives. The owner kept the hold for now (it landed with W41s-3c, #1304) and asked to revisit it
when the asesor answers Q37 and its siblings ([questions](../compliance/asesor-questions.md)): drop the
hold, keep it, or add the overtaking case to the W41s-1b probe first.
**For Task 9 (the filing screen):** `listFilingCases` reads every case and event with no filter or
paging, and `heldRecords` reads every `rechazado`/`detenido` row; neither has a production caller
yet, so the screen should add an open-only filter or paging when it calls them.
Public F1 issuance stays disabled pending the physical 58/80 mm paper and QR checks, A231q
and the asesor's approval. The F1 taxpayer-domicile receipt must omit the location address.
Task 3 can use the published receipts; D2 retains its remaining plan gates, and D5 still needs
old-chain evidence and its adviser answer. Independent queue items may proceed under the plan.

## C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b, decided without the asesor) — landed as #1030

- **C126 (cancelling an order whose invoice was issued credits it; owner, 2026-10-02, option b,
  decided without the asesor) — landed as #1030.** `POST /api/working-orders/:id/cancel` (`cancelPlacedOrder`,
  `apps/server/src/working-order.ts`; the credit in `apps/server/src/cancel-credit.ts`) issues
  an R5 corrective invoice, by differences, for the whole invoice. The PIN override is B33
  (#1041). The owner dropped the dashboard Orders screen's "Invoice not credited" mark
  (2026-10-02 ~12:05): such a bill is to show as Cancelled with its credit note. Open:
  - **For the owner, from B33's review: the cancel checks the permission after its payment
    refusals.** A bill holding a payment, or with a card payment in flight, is refused for that
    before `sale.rectify` or an override is looked at — the order C126 built, which B33 kept. So
    someone without the permission is told about the payment rather than "not permitted", and a
    PIN sent with that request is neither checked nor counted. The drawer, refund and
    unpaid-departure routes check the permission first. Moving it earlier changes who gets which
    refusal; not decided.
  - **B32 (the till offers "Cancel and credit"; owner, 2026-10-02 ~12:05) — landed as #1055.**
    The dialog's dismiss button reads "Keep the bill" ("Mantener la cuenta"), not the
    shared "Cancel" beside "Cancel and credit" (owner, 2026-10-02). The owner also kept the
    cancel's answer empty, so the till goes on reading the credit note's number from the bills.
    Open:
    - **The approver list is fetched with no time limit.** After a refusal for lack of
      permission the till asks `GET /api/cancel-credit-authorizers` who can approve, and until
      the answer arrives the dialog stays busy with its buttons disabled (`apps/till/src/till-app.ts`,
      the approvers fetch). The unpaid-departure and refund dialogs fetch theirs the same way and
      predate B32; a time limit belongs on all three together. Raised by B32's review by reading
      only; nobody reproduced a stalled answer.
  - **Done by B34 (#1077, 2026-10-03; owner, 2026-10-02): a counter order invoiced when it was placed and still
    unpaid can be cancelled with a credit note at the till.** The waiting list "is drawn only
    inside the held-orders card" (Task 16, in [till.md](till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)), so a till layout without that card offers no Cancel and
    credit for counter orders either. How it differs from the table's path, and what is left open:
    - **The result does not name the credit note.** The table's dialog reads the credit note's
      number from the party's bills; the waiting list drops a cancelled order, and the cancel's
      answer is empty, so the dialog says "A credit note was issued and the bill is cancelled"
      without a number. Naming it would need the number from somewhere new; not decided.
    - **A cancel that gets no answer is never shown as done.** On the table, the till reads the
      bills again and shows a bill now cancelled as done. On the counter, an order missing from
      the list may have been cancelled, or may have left it another way (paid and handed over,
      say), so the dialog says the cancel may have been made and to check the waiting orders (a
      new sentence, `cancel_credit.unconfirmed_counter`). The dialog shows this first, and then the
      till reads the waiting list again.
    - Unlike the table's button, the counter's does not check for a payment on the order. Two ways
      of giving a placed counter order a bill payment were tried while building B34 and both were
      refused: taking the payment on the placed order (`working_order.not_open`), and placing an
      order already holding one (`bill.payments_received`). Other ways were not looked for. If an
      order does hold one, the cancel refuses it with `bill.payments_received` and the dialog says
      so.
  - **`GET /api/cancel-credit-authorizers` (B33) lists the active holders of `sale.rectify`.**
    Every role holding `sale.rectify` today also holds `sale.refund`, `sale.void` and
    `cash.drawer`, so its cases cannot tell which of those it reads.
  - **Done by C132 (landed as #1060, 2026-10-03): a credit note's line names the invoice line it reverses.**
    `sale_lines.corrects_line_id` (core migration `0070_sale_line_corrects`, a foreign key to
    `sale_lines.id`) holds, on a corrective invoice's line, the original line it reverses or
    adjusts. A partial correction keeps the looser rule: its lines may name a line or not. No
    report reads the link yet. Open, for partial corrections only, which no product code makes yet
    (only tests and demo scripts do): whether a line a correction ADDS (a new charge, not a change
    to an invoice line) stays unlinked, and whether two adjustments may name the same invoice
    line. When a report starts reading the link it will want an index on the column, as
    `sales_corrects_idx` serves `sales.corrects_sale_id`.
  - **A fully credited bill's original invoice can still be reprinted**, from the till and from
    the dashboard; the server allows it. Whether a reprint should say the invoice was credited is
    not decided.
  - **Left in the dashboard Orders plan and spec after #1034 landed beside C126:** their banners
    still say C126 "is to" credit the bill (it is built); the plan's owner-answers row 7 still says
    "Task 2, as written" for the dropped mark; its Task 1 voided-bill case still lists
    `invoiceNotCredited: false` with no pointer to the drop; and #1034 did not write its planned
    test that a cancelled bill with an invoice shows its credit note.
  - **An invoice that already has a correction cannot be cancelled.** One that lowered it leaves
    less than the whole credit takes back, so the cancel is refused
    `sale.correction_exceeds_total`; one that raised it is refused `sale.correction_not_whole`,
    because a whole credit must be the invoice's first correction. Both are cases in
    `apps/server/src/cancel-invoiced-order.test.ts`. No route issues a credit note other than this
    one.
  - **The credit note is not printed** for the customer (asesor Q32 (b)).
  - **A placed order with no invoice is not checked against stored card payments.** Its cancel
    sees a card running at the reader in this process, but not a stored payment its provider has
    not resolved, nor one captured and not yet filed; the cancel had no payment check at all
    before C126.

## "the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it reproduces itself.

- **"the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and it
  reproduces itself.** Two compliance-track documents carry the same shape about tips
  (`docs/compliance/asesor-questions.md:465`, `docs/compliance/verifactu-findings.md:678`); their tip
  claim is TRUE and the legal track is kept separate. **Next action:** whoever next works the
  compliance track widens those two sentences.

## One original per invoice, structurally

- **One original per invoice, structurally.** F2 requests to `POST /api/sales/:id/receipt` still
  have no limit or idempotency; two calls produced three unmarked originals, and art. 14.1 says
  exactly one. A231's branch now retains the existing original job for F1 requests, with a
  no-printer-at-issuance path that queues it later; its F2 control still queues three originals.
  **Remaining:** contain repeated F2 requests per sale, with the invoice number on the slip.

## Decisions and deliberate limits

- **Decided (owner, 2026-10-02): a whole-invoice credit copies the invoice's own VAT split,
  negated** (`recordCorrection`'s `wholeInvoice`, `packages/core/src/record-correction.ts`).
  Worked out from the lines, as a partial correction still is, a 0.55 dish at 21% invoiced
  0.45 + 0.10 reverses to -0.45 - 0.09 (measured 2026-10-02); copied, it is -0.45 - 0.10.
- **Over-limit invoices (A261-2c, #1285; owner decision, 2026-10-06).** Non-fiscal placement
  accepts an over-limit order; collection refuses the over-limit invoice without taking money.
