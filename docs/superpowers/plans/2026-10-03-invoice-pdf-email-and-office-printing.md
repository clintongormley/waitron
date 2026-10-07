# A231d implementation plan: full invoices by email as a PDF, and on an office printer

**Status, amended 2026-10-07:** A231p is authorised for autonomous execution. Decisions 1–10 are approved, including drawing pages on the server rather than adding CUPS. A231 landed as #1256, merge `2d972685530676fbe7c182760f0d96f461214e47`. Public F1 issuance remains disabled. Finish this build at `needs-owner-review`.

**Dated owner override.** Read the [historical A231d design](../specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md), but apply the 2026-10-07 answers in [backlog A231d](../../backlog.md) and [asesor Q44](../../compliance/asesor-questions.md#q44-sending-a-full-invoice-as-a-pdf-by-email-or-on-a4--the-owners-interim-answers-added-2026-10-07) wherever they differ. These are interim product decisions awaiting the tax adviser's confirmation, not a claim of legal compliance. Preserve the historical spec. Refer to the existing [Q45 receipts and questions](../../compliance/asesor-questions.md#q45-when-does-structured-business-invoicing-reach-a-restaurants-full-invoices-added-2026-10-07) for the structured business regime; do not infer an enablement date or add legal conclusions here.

**One build, both deliveries.** Keep one build branch, coherent task commits signed off with `git commit -s`, and one final PR containing email and A4. Tasks 4 and 5 may be implemented in either order; neither lands separately. Task 6 needs both. Execution needs no design reapproval; final full-branch review and owner review still apply.

## 0. Reconcile the starting point

1. **Owner and asesor answers.** The five 2026-10-07 answers replace the design's conflicting proposals throughout this plan:
   - Paper original then emailed PDF, or emailed original then paper: the later delivery is marked «duplicado».
   - Staff ask the customer, then tick consent. No customer signature or email confirmation. Preserve statement version, language, time and staff member in the consent snapshot.
   - Keep the database invoice record, as for printed invoices. Store no PDF bytes, `invoice_documents` table, document hash, document-id foreign key or retained invoice raster bytes.
   - Before the structured business regime applies, build an unsigned PDF original for B2B with the same QR and legend as paper, under the owner's interim decision. This does not enable public F1 or settle Q45.
   - A retry after `failed` OR `unknown` remains ORIGINAL. A completed original makes later deliveries duplicates. SMTP acceptance is completion for email; a later complaint of non-receipt does not undo acceptance.

   Read the latest `CLAUDE.md`, `docs/developers/writing-claims.md` and the topic files its §3 and §4 point to before implementation. Revise this plan wherever a later owner answer differs; do not reopen the approved design as a prerequisite.
2. **What A231 actually built, read 2026-10-07.** Start from landed code, not A231's old plan:
   - `packages/db/src/schema/sales.ts`: `sales` holds counterparty identity/address, taxpayer domicile, operation date and VAT breakdown; `sale_lines` holds net unit price/base/rate, price quantity, gross and list gross. `packages/db/src/schema/orders.ts` holds the bill's invoice choice, recipient and revision.
   - `packages/core/src/record-sale.ts`: existing issuance snapshots recipient/domicile/date and files once. Read it; do not change it. `apps/server/src/invoice-selection.ts` selects the saved recipient and full series; `apps/server/src/working-order.ts` owns revision-checked invoice choice and public F1 refusals.
   - `apps/server/src/till-sale.ts` (`readSettledTicket`) reconstructs invoice facts through `apps/server/src/receipt-order.ts`, `receipt-lines.ts`, `receipt-adjustments.ts` and `receipt-issuer.ts`. Trace those readers, including persisted discounts, saved names, issue offset, filed issuer and QR, before extracting their projection.
   - `apps/server/src/receipt-ticket.ts` (`formatReceipt`) draws receipts directly into ESC/POS printer commands. `FormatReceiptInput` and `TillSaleResult` are inputs, not a generic page-layout model. Task 1 extracts one while preserving roll bytes.
   - `apps/server/src/receipt-print.ts` owns original enqueue, `readOriginalReceiptPrint`, `confirmReceiptHandover` and copies; `apps/server/src/orders-reprint.ts` audits dashboard copies. `packages/db/src/schema/print-jobs.ts` already carries `saleId`, `receiptCopy`, `resendOf` and `receiptHandover`; `packages/printing/src/outbox.ts` resends the same original bytes.
   - `apps/server/src/till-api.ts:1960` starts the original status/handover/retry routes. Despite `/api/sales/:id`, their `id` is a working-order id, resolved to `sales.id`. `apps/server/src/invoice-lookup-api.ts` also returns working-order ids. Keep that distinction in delivery routes and clients.
   - `apps/till/src/screens/till-ticket-view.ts` shows print status separately from staff handover; `apps/till/src/till-app.ts:4021` owns refresh/handover/retry. Reuse these actions and the existing original jobs; do not create a second receipt-original queue or handover record.

   No delivery table was found by `rg -n 'invoice_deliveries|invoice_documents' packages/db/src packages/migrations apps/server/src` (exit 1). Task 2 introduces delivery metadata. Audit `packages/printing/src/runtime.ts`, `apps/server/src/print-api.ts` and `print-job-trouble.ts` as well: current receipt claims use agent id, not a per-attempt token, and a lease may reprint. Invoice integration must address stale reports without replacing ordinary kitchen/drawer delivery.
3. **SMTP and withdrawal contact, read-only audit 2026-10-07.** `rg -n 'email\.smtp|SMTP|smtp' apps/setup/src apps/dashboard/src apps/server/src/setup-api.ts apps/server/src/setup-operation.ts apps/server/src/email-delivery.ts packages/credentials/src apps/server/README.md` found the resolver, credential and inbox/status screen, but no SMTP settings form in those paths. Task 3 adds the approved setup/dashboard settings using existing `email.smtp` (`url`, `from`), retaining `waitron-credentials set --purpose email.smtp --file /secure/path/smtp.json` (`apps/server/README.md:308`) as an alternative. Recheck if the base changes.

   **Reuse W111:** withdrawal contact is the venue-wide `tenant_receipts.receipt.email`, with its optional `phone`, read through `getReceipt` in `packages/layouts/src/receipt-store.ts` and edited by `apps/dashboard/src/screens/receipts-screen.ts`. Add no second location contact field. Missing/blank email makes invoice email unavailable; validate again at the server boundary and preserve the contact shown with the consent snapshot so later settings changes do not rewrite it.
4. **The fiscal core stays untouched:** no changes to the hash/chain, allocator, immutable fiscal rows, alta builders, `registerSif`, `restoreFiscal` or `packages/core/src/record-sale.ts`. Task 4 may thread delivery metadata around existing issuance, never implement a new issue path. Public F1 refusals in `working-order.ts` and `till-sale.ts` remain closed. Exercise delivery with synthetic F1s created through the existing core in test fixtures, not by bypassing a public gate in production. The golden huella suite `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass UNEDITED.
5. **Focused baseline, before edits.** Run `pnpm --filter @waitron/server test src/receipt-ticket.test.ts src/receipt-lines.test.ts src/receipt-adjustments.test.ts src/receipt-print.test.ts src/orders-reprint.test.ts src/till-api.receipt.test.ts src/invoice-selection.test.ts src/collect-by-invoice.test.ts`, then the relevant F1/public-refusal cases in `src/till-sale-integrated.db.test.ts`, `src/simplified-limit.test.ts`, `src/bill-payments.test.ts` and `src/bill-payments-api.test.ts`. Run the unedited golden/immutability suites with `pnpm --filter @waitron/fiscal-verifactu test src/write-path.e2e.test.ts src/inmutabilidad.test.ts`, and the existing ticket-view and invoice-recipient dialog behavioural/a11y/unsaved suites before UI edits. Read the reported test counts; these are implementation instructions, not checks run by this documentation amendment.

**Starting-point uncertainties.** The renderer/font bundle and independent raster readback still need Task 1's experiments; SMTP survival across restore paths still needs Task 3's tests; the wider raw HP reply and physical outcomes remain uncaptured here. Box memory/time measurements and real HP prints require owner presence or arrangement. Authorisation to build is not authorisation to print real paper. Keep these pending in the final handoff if unavailable, rather than claiming them verified.

**Every task below:**

- Write a focused behavioural test first, run it and keep the expected failure, then implement only enough to pass.
- Run the golden huella and immutability suites named in Task 0 UNEDITED in each implementation task.
- Database suites use `useVenueDb`.
- A refused write asserts the domain error code.
- Prove each new guard by deletion, and add a case showing that the legitimate path is still served.
- No customer email, tax ID, name or address goes in any log line, error parameter or alert. A failure reason is stored as a code, never as a mail server's or printer's own text. No SMTP password, complete credential URL or raw transport detail goes in a log line, error parameter or response body. The authenticated settings read may return the server and "from" address required by Task 3, never the password, URL credentials or customer details.

## 1. A shared F1 layout model, the PDF renderer and the page drawn as dots

**Inspect/change:** `apps/server/src/receipt-ticket.ts`, `receipt-lines.ts`, `receipt-adjustments.ts`, `receipt-issuer.ts`, `till-sale.ts` (readers only), `apps/server/src/qr-matrix.ts`, new server modules for the shared layout, PDF and raster pages, `apps/server/package.json`, `scripts/bundle-node.mjs`, `deploy/Dockerfile`, `deploy/third-party/`.

- **Extract the layout model from the current receipt renderer.** `formatReceipt` draws straight into printer commands. Extract a format-neutral F1 document (sections, rows, totals, QR text, legend, a `duplicate` flag, the practice flag) built from the stored F1 facts through the readers in Task 0. Keep the paper output byte-identical: before the change, capture the paper F1's bytes for a mixed-rate, discounted, long-address fixture; after it, assert the same bytes. Preserve existing behavioural assertions, including F2, rather than replacing them with assertions that mirror the new model.
- **Red first, a PDF of that fixture:**
  - It is one A4 page, or several with the QR on the first page only.
  - The QR is at the top, centred, 35 mm square (99.2 PDF points) and level M. Assert its drawn size, and decode the drawn matrix back to the filed QR text.
  - The «VERI*FACTU» legend is in the body's type size.
  - Every figure in the paper F1 appears in the PDF's extracted text: issuer, customer, series and number, dates, lines, per-rate summary and total.
  - The per-rate summary matches the sale's stored VAT breakdown to the cent.
  - A long name and address wrap and are never cut.
  - A duplicate carries «duplicado».
  - An original PDF is unsigned and carries the same filed QR/legend as paper. It is an interim owner choice, not a legal-compliance assertion.
  - A practice-mode sale carries the practice warning, and a live one does not.
  - Two renders of the same input give the same bytes, or the PR says which field differs (a creation time in the PDF's metadata, for example) and fixes it.
- **Red first, the same fixture as raster pages** (for printers that take no PDF, design → "What office printers accept"):
  - It draws the layout as an SVG with every letter as its outline from the bundled font, and `sharp` turns it into a one-channel grey page at the requested resolution: 2480 × 3508 dots for A4 at 300 per inch, and 4960 × 7016 at 600, the only Apple Raster resolution the measured HP offers.
  - The QR is 35 mm at either resolution (413 dots at 300 per inch, 827 at 600), and the drawn matrix decodes back to the filed QR text.
  - The page's text is legible: run text recognition (OCR) over it, or compare it against the PDF turned into dots at the same resolution, and say in the PR which was used. A blank or all-black page fails.
  - The PWG Raster encoder's output is read back by an independent reader — CUPS's raster library (`cups/raster-stream.c`, Apache 2.0) through a small test harness, or `ippeveprinter` on a developer Mac — and gives back the same dots and page header values (size, resolution, colour space). The same for the Apple Raster encoder, written with CUPS's `CUPS_RASTER_WRITE_APPLE` mode as the reference, because Apple publishes no specification for it. If any CUPS code is copied or ported, ship its Apache 2.0 notice in `/app/third-party/` and extend `scripts/deploy-image-env.test.ts`'s third-party blocks.
  - A test pins that the encoder in the suite is the one the server uses, not a copy.
- **Library: `pdfkit` (owner-approved, decision 5).** Before relying on it:
  - (a) Build the server bundle with `scripts/bundle-node.mjs`, and render a PDF and a raster page from the bundled server inside the built image. A library reading its own data files at run time is the `sharp` trap in CLAUDE.md §2.
  - (b) Choose the font. The dashboard's `apps/dashboard/src/assets/google-sans-medium-latin.woff2` is one weight with Latin characters only, and `deploy/third-party/google-sans/` holds only its licence. Check whether `pdfkit` can embed it, whether its glyph outlines can be read for the raster drawing, and whether it covers every receipt language. Otherwise add an open-licence font and its notice in `/app/third-party/`, and extend `scripts/deploy-image-env.test.ts`'s third-party blocks.
  - (c) Record the PDF size of the long fixture.
  - (d) With owner presence or arrangement, on the box itself in the built image, time one raster page at 300 and at 600 dots per inch and record the server's peak memory while drawing each. The historical design's Mac shapes-only measurement is not a box/text measurement. If drawing outlines through `sharp` does not work there, switch to the printing package's bitmap font drawn at twice its size (`packages/printing/src/raster-text.ts`), and say so in the PR. If box access is unavailable, record the measurement as pending for owner review.
- **Coverage.** The renderers and encoders are ordinary source and hold the server's 98/98/98/95 coverage bar.

**2026-10-07 bundle checkpoint:** the owner approved the `__waitronCreateRequire` alias and
the two pinned banner expectation changes. A new real bundle-load case failed before the
fix with the duplicate import and passed after it, exercising the entry's own import and
the CommonJS shim. Focused bundler/image/scope/timeout guards passed 431 cases; all four
shared-bundler consumers built, and Node syntax checks passed for their 12 output bundles.
The standalone invoice renderer bundle generated a 12,353-byte PDF and 300/600 dpi PNGs
byte-identical to the existing source-rendered fixtures, with both QRs decoded to the filed
link. This closes the banner-name issue; bundled-server rendering inside the built image,
box measurements and physical printer checks remain open.

## 2. Record delivery metadata, retaining no document bytes

**Inspect/change:** new `packages/db/src/schema/invoice-deliveries.ts` and its generated core migration, `packages/db/src/index.ts` and `classification.ts`, the bill's staged delivery choice in `packages/db/src/schema/orders.ts`, and new server delivery/attempt helpers. Read `sales.ts` without changing the immutable invoice snapshot. The receipt adapter uses `receipt-print.ts`, `print-api.ts`, and the existing outbox/runtime.

- **Red first:**
  - `invoice_deliveries` stores metadata only: sale, medium (`email`, `a4`, `receipt`), `original`/`duplicate`, status (`queued`, `sending`, `sent`, `failed`, `unknown`), attempts, canonical timestamps, next-attempt time, sanitised failure code, staff attribution and claim identity. Email additionally stores recipient and the immutable consent snapshot; A4 names a page printer; receipt metadata correlates to the existing print-job/resend chain. There is no document table, hash, document-id FK, PDF or invoice-raster payload column or file cache.
  - The durable queue survives restart using only this metadata and the existing stored invoice facts. After the enqueue/claim commits, read a consistent invoice projection, close its transaction, then generate PDF/raster bytes transiently and discard them after transport. No rendering, SMTP or IPP call holds a database transaction. A new process can regenerate the same figures with no document file available.
  - Paper original followed by email, and email followed by paper, are duplicates marked «duplicado» after the original completes. Both `failed` and `unknown` allow an explicit retry as ORIGINAL, including a corrected email address or another medium. Failure certainty does not decide original versus duplicate. Do not add a `sent OR unknown` gate.
  - At most one logical attempt for a sale is active (`queued` or `sending`), including across media. A scheduled automatic retry remains `queued` with a due time, reserving that slot; its prior attempt's failure is history. In one transaction, concurrent/replayed requests reuse the existing active delivery for the same request key or refuse a conflicting request with a named code. A retry after completion cannot enqueue another original; it produces a duplicate or refuses the original-only action. Check existing receipt jobs before reserving a new attempt, so older A231 originals are not treated as undelivered merely because they lack new metadata.
  - Claims carry a fresh unpredictable per-attempt token, generation and holder, with a 60-second lease. Before expiry a second worker/agent cannot claim. On timeout or restart, mark an in-flight attempt `unknown` and invalidate its token before offering Retry original; do not silently replay an uncertain send. Retain its attempt identity/outcome metadata for audit. A new explicit retry increments the generation, creates a fresh claim token and remains original unless completion was already recorded.
  - Duplicate reports are idempotent. A report needs the delivery, generation, token and holder, including from the same agent after reclaim. A late report is authenticated against the recorded attempt identity. If an expired attempt is still the latest attempt and no retry has been reserved, its late success resolves `unknown` to `sent`; a late failure keeps `unknown`. Once a retry has been reserved, an older report records only a sanitised historical outcome: it cannot change the current attempt, cancel the retry, consume its attempt count or complete its delivery. Test late success and late failure before retry, during a newer attempt, and after its result. Serialise late completion and retry reservation in one transaction: completion first means a later action is duplicate; retry first preserves its original designation and generation.
  - Reuse A231 receipt-original jobs, retries and handover as the receipt transport. Audit and correlate their claims/reports with invoice attempt tokens at the server/agent boundary before projecting status. `reportPrintJob` refuses correlated invoice jobs and checks only the agent id for ordinary jobs (`packages/printing/src/runtime.ts`); correlated receipts use the token-aware `apps/server/src/invoice-print.ts` adapter. Fence stale F1 reports before updating the job/delivery, and end eligibility for a superseded F1 job before a cross-medium retry, without changing ordinary kitchen/drawer semantics. No parallel receipt delivery loop and no second handover snapshot. Software invalidation cannot recall bytes already sent: `unknown` stays visible, and an explicit original retry can produce another physical print/email under the owner's rule.
- **Schema rules:**
  - Classify delivery/attempt metadata as `state`, with the mutable queue reason; freeze recipient/consent values per recorded attempt rather than updating an earlier snapshot. Add no `invoice_documents` append-only declaration.
  - State in the commit why these rows are in the core set: they deliver existing core invoices across the three media. Follow the module boundary rules; no fiscal-module SQL is added.
  - Declare every key and unique index in the TypeScript schema.
  - Write through every new foreign key: CLAUDE.md §3 says a key whose target lacks a unique index fails only at the first write.
  - `print_jobs` and `print_agents` are currently `state` (`packages/db/src/classification.ts:113,129`); declare receipt-job/agent correlation keys in the schema rather than assuming they are local. Recheck classifications if the base changes; no FK may cross between `local` and `state`/`ledger`.
- **Guard suites.** Run `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`, `scripts/migrations-match-schema.test.ts`, `scripts/migration-upgrade.test.ts` and `inmutabilidad`. Measure and state the upgrade effect in the PR.
- **Error codes.** Name new codes after the domain concept, `invoice_delivery.*`, after checking the registry for siblings. Add the alert code's area claim and its English and Spanish wording (`scripts/alert-codes.test.ts`, `scripts/errors-reachable.test.ts`).

**Implementation checkpoint, 2026-10-07.** Task 2's correlated receipt pull/result boundary now
uses the real print agent/client and the demo printer. Generic local claim/report paths leave
these correlated jobs to the adapter. Its tests cover due-time eligibility, lost claims,
authenticated latest/historical outcomes, same-agent receipt retries, ordinary job controls
and claim rollback. For enrolled receipts, the pull projects confirmed unpairing and
unavailable-Bluetooth endings in the same transaction. Queued receipts become failed;
handed-out receipts become unknown and keep their claim hash for authenticated late results.
The API tests cover printer reactivation without replay, the other-agent printable control,
completed originals and late success before and after a newer attempt. Original/resend
enrollment, bill staging, A4 references and restart/retry workers remain. No Task 2 completion
claim.

## 3. Set up email for a live venue, without a terminal

**Inspect/change:** `apps/setup/src/setup-app.ts` (venue advances to certificate or review at `:807`; `apps/setup/src/screens/cert-screen.ts:276` advances to fiscal test, and `fiscal-test-screen.ts:66` to review), a new Email screen beside those screens, `apps/setup/src/api/client.ts`, `apps/server/src/setup-api.ts` and `setup-operation.ts`, `apps/server/src/email-delivery.ts`, `packages/credentials/src/purposes.ts` (read only: `email.smtp` keeps its `url` and `from` fields), a settings card on `apps/dashboard/src/screens/email-screen.ts` and its server route, the setup and dashboard translations. Keep the existing CLI path in Task 0.

**Red first, server:**

- A live provision carries the email settings beside `aeatCert`; the server seals them as `email.smtp` in the same provisioning step, and `resolveEmailDelivery` then returns `smtp` with that `url` and `from`.
- A live provision without email settings is refused with a named code, field `email` (decision 8). A demo or prepare provision carrying them is refused the way a certificate is today (`setup.request_invalid`). A development server may omit them.
- The setup's test-message route sends one short message to the admin's address through the given settings, and answers accepted, refused (as a code) or no answer within a bound. It writes nothing to the database, and neither its log lines nor its answer carry the SMTP address, user or password. Test against a fake SMTP server in the suite.
- The dashboard's email-settings route needs `system.manage`: one role without it is refused and a manager is allowed. It seals `email.smtp` the way `payments-api.ts` seals a provider credential, and its read answer carries the server and the "from" address, never the password or the whole URL.
- In a demo or a venue preparing to go live, the dashboard route refuses a change with a named code. Setting a prepare venue's mail server stays with the open backlog item (decision 7).
- **Restores.** For each way the wizard and `waitron-restore` rebuild a live venue (from an archive, from the bucket, the cloud recovery), find out by running it whether `email.smtp` survives, on the same machine and on a different one. Where it does not, the restored venue reports invoice email unavailable and the dashboard card asks for the settings again; write the result in the PR.

**Red first, setup and dashboard browser suites:**

- The live path shows the Email step just before review: after the certificate and fiscal-test screens where they apply, straight after the venue details otherwise; demo and prepare do not.
- Its fields follow the forms rules: required fields marked, a mistake explained beside its field, and Continue disabled until the mail server has accepted a test message from the current values. Changing a value after a test needs a new test.
- A refused test shows its reason under the form and keeps the fields.
- Use shared field primitives with semantic names, field errors and one localized summary on its own line above the buttons. A request refusal keeps Test available. The dashboard settings editor registers a draft with `leaveCoordinatorFor` and has a sibling `*.unsaved.test.ts`, including failed test/save and successful-save/failed-refresh cases.
- The dashboard card shows the server and "from" address, or, in a live venue without email, that invoices cannot be emailed until a mail server is set up. In a demo or a venue preparing to go live it offers no change, and says where invoice email goes: in a prepare venue, through the mail server if one is set, otherwise captured on the box; in a demo, always captured on the box.
- Check both themes, phone width, keyboard and focus, and run axe for each new state.

**Look at it.** Open the wizard's Email step and the dashboard card in both themes, at 1280 and 390 px wide, in English and Spanish.

## 4. Email the PDF

**Inspect/change:**

- `apps/server/src/account-email.ts`: the mail message type gains attachments, or a sibling invoice-mail module shares the transport.
- `apps/server/src/email-delivery.ts`: invoice email in a demo resolves to the captured inbox even when `email.smtp` is set; a venue preparing to go live follows account email's rule (SMTP when set, otherwise the captured inbox). `resolveEmailDelivery` takes only a practice-mode flag today, which cannot tell a demo from a prepare venue, so the invoice rule needs the venue's mode.
- `apps/server/src/boot.ts`: start/stop the invoice worker using the existing failed-start cleanup convention; restart recovery invalidates delivery claims, independently of fiscal drain recovery.
- W111's existing `getReceipt` contact in `packages/layouts/src/receipt-store.ts` and `apps/dashboard/src/screens/receipts-screen.ts`; reuse `tenant_receipts.receipt.email` and optional phone, with no new location contact columns.
- `apps/server/src/working-order.ts`, `till-sale.ts`, `bill-payments.ts` and `bill-payments-api.ts`: thread staged delivery choice/consent through existing revision and issuance transactions only. Keep all public F1 gates.
- A231's `apps/till/src/widgets/invoice-recipient-dialog.ts`, `apps/till/src/till-app.ts` and `apps/till/src/api/client.ts`.
- The till and dashboard translations.
- `deploy/compose.yml`, for the capture service's size limit, if the measurement needs it.

**Red first, till browser suite:**

- Mount the F1 dialog directly for these delivery tests while the public full-invoice action stays disabled. The dialog offers Printed receipt (the default), A4 only with an invoice printer set, and Email only when the server says invoice email is available and W111's venue email is nonblank.
- Choosing Email requires an address and consent recorded by staff after asking the customer. There is no customer signature, confirmation link or email-verification step.
- The box is unticked by default and shows the versioned statement in the receipt language.
- Preserve the approved statement: PDF to this address instead of paper, free paper available, withdrawal by telling staff or writing to the displayed venue email. Snapshot that contact as well as statement version/language/time/staff; settings changes do not rewrite past consent.
- Issue stays disabled until both fields are valid, under the forms rules.
- A server refusal stays retryable.
- Keep the dialog's existing `invoice-recipient-dialog.unsaved.test.ts` assertions and add delivery-field/consent drafts; verify close/reopen, failed request and stale refresh do not discard the draft or reuse an earlier customer's consent.
- Check both themes, phone width, keyboard and focus, and run axe (the accessibility checker) for each new dialog state.

**Red first, server suites:**

- **Where invoice email goes.**
  - On a server that is not a development server, a live venue with `email.smtp` set sends through it; a live venue without it reports invoice email unavailable, and an email choice is refused with a named code before issue.
  - A demo sends to the captured inbox, with `email.smtp` set and without it. Delete the demo check and this case fails.
  - A venue preparing to go live sends through `email.smtp` when it is set, and to the captured inbox when it is not; the PDF carries the practice warning either way.
  - A development server sends invoice email to the captured inbox in every mode, with `email.smtp` set and without it.
  - Account email keeps today's behaviour (it prefers SMTP when set): its existing cases pass unedited.
- **Issue.**
  - Stage Email address/consent under the bill's revision check; the existing issuance transaction associates its immutable consent snapshot with `saleId` in delivery metadata, without adding delivery fields to immutable `sales` or fiscal rows. Reject missing, malformed or explicitly null choices with a field-specific domain code.
  - Public requests for F1 continue to answer `sale.full_invoice_unavailable`. Use synthetic fixtures through the existing core to exercise the delivery integration for an issued F1; no production bypass, new issuance pipeline or fiscal changes.
  - The issuing transaction writes only a `queued` delivery and sends/renders no PDF itself. Rollback queues nothing; replay returns the same invoice/delivery without allocating again.
  - With Email or A4 chosen, suppress automatic F1 receipt enqueue. Printed receipt preserves A231's `enqueueSaleReceipt` rule: F1 originals print even with optional receipt printing off; F2 retains the department/zone policy. Keep collection tickets and drawer jobs independent.
- **Sending.**
  - The worker commits its metadata claim, reads the stored invoice projection and closes that transaction, renders/sends transient bytes with no transaction open, and records the result with the matching generation/token in a final transaction. Neither success nor failure retains the PDF/raster or writes a hash/document reference.
  - A sale commits while the stubbed mail server hangs.
  - A stubbed refusal leaves the sale filed.
  - Certain refusals use at most five attempts, with gaps of 5 seconds, 30 seconds, 2 minutes and 10 minutes; persist due times and keep ORIGINAL on every retry. Bound each SMTP attempt to 30 seconds. A final failure marks `failed` and raises the alert; an explicit retry after it is still original.
  - Timeout/no answer or a delivery left `sending` by restart becomes `unknown` with its token invalidated. Keep the uncertainty visible and offer Retry original; do not turn it into a duplicate or silently send again. The retry regenerates bytes from the same invoice facts. Late acceptance/refusal cannot overwrite the newer attempt (Task 2).
  - `sent` means SMTP accepted the message, never that the customer received it; a later send after acceptance is marked «duplicado». Record attempt outcomes as sanitised codes, never raw transport text.
- **Other cases.**
  - Withdrawal before claim switches the queued original to paper atomically, preserving the consent history. Once claimed, invalidate/end that attempt before reserving another; any possible send remains visibly `unknown`. Paper after `failed`/`unknown` stays original; paper after completion is duplicate.
  - Replayed issuance/retry and concurrent two-till requests do not queue a second active attempt. Test same request key, conflicting medium, and a retry racing a current success under the transaction lock.
- **The F1 on the receipt printer.**
  - Keep `/api/sales/:id/receipt/retry` using the existing original job/resend chain and same bytes, without refiling or opening the drawer. Do not impose a blanket ban on retrying F1 original jobs. Route or guard the print-jobs screen's F1 resend through the same attempt checks: exhausted/unknown originals may retry as original, active ones cannot gain a parallel attempt, and completed originals require the invoice's marked copy action.
  - Project delivery status from correlated current jobs, not a second receipt queue: valid `done` maps to `sent`, final failure to `failed`, and lapsed/no-answer to visible `unknown` with original retry allowed. Preserve staff handover independently in the existing `receiptHandover`; it does not turn printer transport completion into customer confirmation.
  - Audit the current lease/reclaim path and the same-agent stale-report case (Task 2). Retain A231's same-byte retry assertions and `resendOf` history, and add cross-medium and stale-token cases. Do not claim exactly-once physical output: lost acknowledgements and original retries can produce another sheet.

**Practice mode.** Send a long invoice into the capture service, then read it back from the inbox API with its attachment. If the 1 MB limit refuses it, raise the limit in `deploy/compose.yml` and say why in the PR.

**The till's sale view** shows the delivery's state ("sending", "sent to …", "not delivered", "may not have been delivered") and not-delivered actions. Both `failed` and `unknown` offer an original retry; completion offers marked duplicates. Preserve the handover/status distinction and the existing view's accessibility tests.

## 5. Office printers for invoices

**Inspect/change:**

- `apps/print-agent/src/ipp-probe.ts`, `network.ts` (mDNS query/announcements), `linux-devices.ts`, and a new IPP print module beside them.
- `packages/print-agent`: `client.ts`, `agent.ts` and `host.ts`. This package imports no other package in this repo, and the `import-x/no-restricted-paths` zone in `eslint.config.js` enforces that (CLAUDE.md §3).
- A new page-printer schema file and its generated migration.
- The location's invoice-printer setting.
- `apps/server/src/print-api.ts`, or a new agent route module beside it.
- `apps/dashboard/src/screens/printers-screen.ts` for registration and the location's Invoice printer (A4) choice. The historical `printing-rules-screen.ts` no longer exists; `apps/dashboard/src/dashboard-app.ts:1669` redirects that old URL to prep-stations. Do not revive it for this setting.

**Keep A4 out of `printers` and `print_jobs`.** Do not broaden receipt-printer enums or store A4 PDF/raster payloads in the receipt outbox. Invoice claim/report integration from Task 2 reuses F1 receipt jobs and leaves ordinary kitchen/drawer semantics intact:

- The current schema has inbound keys from `devices`, `device_profile_printers`, `printer_holders`, `drawer_opens`, `station_printers`, `watcher_printers` and `print_jobs`. Re-list them with `rg -n 'printers\.id|foreignColumns.*printers' packages/db/src/schema --glob '*.ts' --glob '!*.test.ts'` before any rebuild; do not rely on the historical list containing `tills`.
- `print_jobs` has an at-least-once receipt transport; the new A4 queue stores only delivery metadata and generates its bytes after committing.

**Red first, agent:**

- **Finding.** The mDNS query (the local-network announcement lookup) also asks for `_ipp._tcp`, so a printer announcing only IPP is found and probed. The 9100 sweep and the `_pdl-datastream._tcp` query are unchanged, and a receipt printer is still never sent an IPP print job.
  - A printer found this way is a new kind of discovered device carrying its port and the resource path from its announcement's `rp` entry; it is asked at that port and path, not at 631 and `/ipp/print`. Cases: a printer announcing `rp=ipp/printer` on port 8631 is asked there; an announcement with no `rp` is skipped.
  - It is never offered as a receipt printer, even when its question fails or is unanswered. Delete that rule and a case that offers it as a receipt printer fails.
  - A printer found both by IPP and by its raw port appears once.
- **The question.** The Get-Printer-Attributes request names `document-format-supported`, `media-supported`, `urf-supported`, `pwg-raster-document-resolution-supported` and `pwg-raster-document-type-supported`. It stays the only request sent during discovery.
  - First capture the owner's HP reply to the wider question as raw IPP bytes into a fixture in `__fixtures__/`, beside `hp-color-laserjet-m181fw-media-supported.ipp`, which holds only its paper-size answer. The design's 2026-10-03 measurements saved text, not bytes.
- **The format choice**, one case per branch:
  - the HP fixture → `application/pdf`;
  - the HP fixture with `application/pdf` removed → `image/urf` at 600 dots per inch (its only `RS` value), not `image/pwg-raster`, although its device id names `PWG_RASTER`;
  - a reply listing only `image/pwg-raster` and `image/jpeg` → `image/pwg-raster`, at a resolution it lists;
  - a reply listing only `image/jpeg`, PCL and PostScript → not offered, with the named reason;
  - a reply with no A4 or US letter size → not offered.
- **Sending.** A claimed A4 delivery is sent as one IPP Print-Job with `document-format` set to the printer's stored format. Get-Job-Attributes is then polled until `completed`, `aborted` or `canceled`, or a bound passes. Each outcome is reported as a code, with the printer's `job-state-reasons` mapped to codes.
  - A refusal before printing is `failed`; an abort after starting, no answer, or a lapsed claim is `unknown`. Both allow an explicit original retry under Task 2. They differ in what the screen can say about the previous attempt, not in whether its retry is original.
  - Bound Print-Job submission to 30 seconds and polling to 120 seconds, renewing the 60-second metadata lease while the current agent is active. Stop on invalidation. No reconnect loop may resubmit the same IPP job after an uncertain answer. Test renewal, expired claim, duplicate report and same-agent old-token reports using the fake server and controlled time.
  - Test against a fake IPP server in the suite, never against a real printer and never on port 9100. On a developer Mac, also send one PWG Raster and one Apple Raster job to `ippeveprinter -f image/pwg-raster,image/urf -k` (CUPS's software printer, installed with macOS) and check it accepted and kept them; say in the PR that this ran locally, not in CI, and that it checks the job was accepted under its format, not what the pages look like.

**Red first, server and dashboard:**

- In the add-printer dialog, an office printer the agent marked as printable shows "Add as invoice printer"; one with no usable format stays greyed with the reason; a receipt printer's row is unchanged.
- Adding stores the page printer with its chosen format and its reported format list. It never appears in the receipt-printer, kitchen-routing or drawer choices.
- The Printers tab lists it marked "Invoice printer (A4)", with rename, disable and "Print test page"; each needs `printer.manage`.
- A disabled invoice printer found again offers Enable and reactivates the same row, as a receipt printer does (CLAUDE.md §3).
- The receipt-printer and kitchen routes refuse a page printer's id.
- An A4 delivery naming a receipt printer's id is refused.
- The Printers screen sets or clears the location's Invoice printer (A4) choice. Test role denial, another location's printer, disabling the chosen printer and reactivation. Add visual/a11y coverage and a draft scope with `*.unsaved.test.ts` for staged settings/name/address input.
- The agent claims A4 deliveries for its own location only. After the claim commits, the server renders transient PDF or raster bytes in the stored printer format. Byte fetch requires the current delivery generation/token/holder. Outcome reports authenticate against the recorded attempt identity, including historical identities for the late-report rules; this never restores expired byte-fetch or send eligibility. No document id or stored file is fetched.
- A lapsed claim becomes visible `unknown`, invalidates the token, and offers an explicit original retry. A completed current original makes subsequent A4, email or receipt actions duplicates.
- A late success for the latest expired attempt resolves `unknown` to `sent` only if no retry has been reserved. Once superseded, record the sanitised outcome against its historical attempt only, without overwriting a newer attempt. Test completion before retry and an old success arriving after retry has queued, claimed, failed and completed, including when the same agent holds both claims.

**Guard suites.** Run the same suites as task 2 for the new tables.

**Measure on the owner's HP.** This prints real paper, so do it with the owner present or by arrangement:

- a long F1 as PDF through the product, with its QR measured with a ruler and scanned with a phone;
- the same F1 as Apple Raster at 600 dots per inch, sent from the Mac with `ipptool` Print-Job using the server's encoder output, with its QR measured and scanned the same way;
- a test page from the Printers tab;
- what is reported when the tray is empty;
- what is reported when the printer is switched off mid-job.

Write what the printer reported into the PR and `docs/backlog.md`. Use the historical design's HP format receipt to scope this exercise; Repeat the independent reader and `ippeveprinter` checks through the production transport once Task 5 wires it in. Task 1's source-code encoders passed those checks on 2026-10-07; the backlog records their scope. Without owner presence/arrangement and printer access, leave physical output unverified, name the pending checks in the final `needs-owner-review` handoff and do not call the build ready to land. Do not print real paper autonomously.

## 6. Send or print again, from the till and the dashboard

**Inspect/change:** `apps/server/src/till-api.ts`, `orders-api.ts`, `orders-reprint.ts`, `apps/till/src/screens/till-ticket-view.ts`, `apps/dashboard/src/widgets/order-detail-dialog.ts`, the dashboard client and translations.

**Red first:**

- For an F1, the till's sale view and the dashboard's order detail offer print on receipt, print on A4 (with an invoice printer set) and email.
- The dashboard also offers Download PDF. Commit only action metadata (sale, duplicate designation, staff and time), then generate a transient PDF marked «duplicado», with the series-and-number file name. Retain no PDF/raster bytes, document row, hash, document-id FK or durable cache. A download does not complete or replace a pending original delivery.
- On the dashboard, email and download need `report.export` (managers and admins, decision 4), for any order: a supervisor is refused and a manager is allowed. Reprint keeps today's rule (any session for the current business day unless its enrolled device lacks receipt printing, `report.view` for older orders).
- Each action records who did it and when.
- Delivery actions use Task 2's rule: explicit retries after `failed`/`unknown` remain ORIGINAL, including changing medium; actions after a completed original are marked duplicates. Test paper-then-email and email-then-paper, failed/unknown retry, late reports and two concurrent clients. New email recipients require staff-recorded consent; existing consent is reused only for the same recipient and statement, with its snapshot preserved.
- An F2 offers none of the new F1 email/A4/PDF actions; its existing receipt actions remain. Public F1 issuance remains disabled on both till and API throughout this task.
- Apply session, person permission, device action and zone restrictions to every new till route, adding refusing cases to `apps/server/src/till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`. Preserve passive reads, separate read/action errors, and the existing ticket/order-detail draft and accessibility checks; add `*.unsaved.test.ts` for any new staged email dialog.

**Look at it.** Open the till and dashboard screens in both themes, at 1280 and 390 px wide, in English and Spanish.

## 7. Gate and handoff

1. **Tests and CI.**
   - While implementing, run the focused suites.
   - Every changed package keeps `98/98/98/95` coverage, with the existing mutation floors where applicable. Run the golden huella and immutability suites UNEDITED; keep receipt-byte parity, independent encoder readback, bundled-image rendering and shipped font/library licence checks from Tasks 1–2. Do not weaken assertions or hide reachable source to meet coverage.
   - Let the pre-push hook run once on a signed-off commit, and never bypass it.
   - Confirm CI selected every changed package (the server, the till, the dashboard, the setup wizard, `db`, `print-agent` and the print agent app), and that their coverage jobs passed on the current head.
   - CI builds a front end only when an image input changed (CLAUDE.md §2), so build and open the till, dashboard and setup wizard locally.
2. **Prose that goes stale.**
   - Read the base-to-tip prose claims for the retired behaviours: "office printers are not supported", "email is account email only", and "SMTP needs a terminal" (`apps/server/README.md`'s `waitron-credentials set --purpose email.smtp` instructions stay true but are no longer the only way).
   - Read the backlog's A3 entry "Printing A4 invoices on an office printer" and its "virtual PDF printer" line, and the item "A venue preparing to go live sends real email through SMTP", and mark what this build settles. That item stays open (decision 7): this build sends a prepare venue's invoice email through a mail server when one is set, and adds no way to set one there.
   - Update `docs/backlog.md` in the same change.
3. **Final review and handoff.** After both email and A4 are implemented on this one branch, run `finish-branch` for the final full-branch review, one PR and current-head CI. The queue requires the full review path: two run-it reviews through the Claude seat, each in its own throwaway candidate checkout, plus a convention review. Inspect completed findings and fix them in the feature worktree. Reuse completed approvals across later rebases as the runner requires. Finish at `needs-owner-review`, with the PR link, check results and any pending HP/box measurements. Do not merge. Q44/Q45 adviser confirmation and A231's public enablement remain outside this build; do not describe owner interim choices or synthetic F1 tests as compliance approval.
