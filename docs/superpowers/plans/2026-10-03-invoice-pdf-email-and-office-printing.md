# A231d implementation plan: full invoices by email as a PDF, and on an office printer

**Status:** proposed, blocked on the [design's three open owner decisions](../specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md#what-the-owner-decides) (7–9; decisions 1–6 were answered on 2026-10-03) and on the A231 build. Do not start on the strength of this plan alone. Read the design's two registers before deciding a legal, delivery or printing detail. Read [A231's design](../specs/2026-10-03-full-invoices-at-till-design.md) and [plan](2026-10-03-full-invoices-at-till.md) too, because every task here reads facts the A231 build stores.

**One build, both deliveries (owner, 2026-10-03).** Email and A4 printing are built together. Tasks 4 (email) and 5 (office printers) may land in either order, each leaving `main` working, and the build is not finished until both have landed. Task 6 needs both.

## 0. Reconcile the starting point

1. **Owner and asesor answers.** The design records the owner's answers to decisions 1–6. Confirm decisions 7–9 are answered, and change this plan where an answer differs from the design's proposal. Record the asesor's answers to the design's five questions, or the owner's decision to go ahead without them for a named question. Read the latest `CLAUDE.md` and the topic files its §3 and §4 point to for each area touched: data, UI, testing, CI.
2. **What A231 actually built.** Confirm A231's build has landed. Read what it built, not what its plan proposed:
   - the F1 snapshot on the sale (customer tax ID, legal name, address);
   - the taxpayer domicile;
   - the net line figures and discounts it projects;
   - its paper F1 layout;
   - its "F1 not delivered" state.

   Name those files in this build's first PR. If any is missing or differs, stop and revise this plan.
3. **SMTP.** Check whether anything has landed a dashboard or setup-wizard SMTP setting since 2026-10-03. Task 3 builds one; if one exists, task 3 reuses it and this plan is revised first.
4. **The fiscal core stays untouched**: the hash and chain, number allocation, the immutable fiscal rows, the alta builders, `registerSif` and `restoreFiscal`. The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` pass unedited in every task. Nothing here files anything: every task reads an already-filed F1.

**Every task below:**

- Write a focused behavioural test first, run it and keep the expected failure, then implement only enough to pass.
- Database suites use `useVenueDb`.
- A refused write asserts the domain error code.
- Prove each new guard by deletion, and add a case showing that the legitimate path is still served.
- No customer email, tax ID, name or address goes in any log line, error parameter or alert. A failure reason is stored as a code, never as a mail server's or printer's own text. No SMTP password or SMTP address goes in a log line, error parameter or response body either.

## 1. A shared F1 layout model, the PDF renderer and the page drawn as dots

**Inspect/change:** the A231 F1 layout (expected under `apps/server/src/receipt-ticket.ts` or beside it), `apps/server/src/qr-matrix.ts`, new server modules for the PDF and for raster pages, `apps/server/package.json`, `scripts/bundle-node.mjs`, `deploy/Dockerfile`, `deploy/third-party/`.

- **Extract a layout model if A231 has none.** If A231 drew the paper F1 straight into printer commands, first extract a format-neutral F1 document (sections, rows, totals, QR text, legend, a `duplicate` flag, the practice flag) built from the stored F1 facts. Keep the paper output byte-identical: before the change, capture the paper F1's bytes for a mixed-rate, discounted, long-address fixture; after it, assert the same bytes.
- **Red first, a PDF of that fixture:**
  - It is one A4 page, or several with the QR on the first page only.
  - The QR is at the top, centred, 35 mm square (99.2 PDF points) and level M. Assert its drawn size, and decode the drawn matrix back to the filed QR text.
  - The «VERI*FACTU» legend is in the body's type size.
  - Every figure in the paper F1 appears in the PDF's extracted text: issuer, customer, series and number, dates, lines, per-rate summary and total.
  - The per-rate summary matches the sale's stored VAT breakdown to the cent.
  - A long name and address wrap and are never cut.
  - A duplicate carries «duplicado».
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
  - (d) On the box itself, in the built image, time one raster page at 300 and at 600 dots per inch and record the server's peak memory while drawing each (on the owner's Mac a page of shapes took 29 and 107 ms, with the whole Node process, `sharp` loaded, peaking at 151 and 227 MB). If drawing outlines through `sharp` does not work there, switch to the printing package's bitmap font drawn at twice its size (`packages/printing/src/raster-text.ts`), and say so in the PR.
- **Coverage.** The renderers and encoders are ordinary source and hold the server's 98/98/98/95 coverage bar.

## 2. Keep every delivered PDF, and record each delivery

**Inspect/change:** a new schema file and generated migration in the set that owns sales (expected `packages/db`), its classification list, the A231 F1 snapshot, and the invoice choice A231 stores on the bill.

- **Red first:**
  - An `invoice_documents` row can be inserted and read: the sale, `original` or `duplicate`, the PDF bytes, the SHA-256, the creation time, and who created it.
  - `invoice_documents` refuses UPDATE, DELETE and INSERT OR REPLACE. Declare it with `appendOnly()`.
  - An `invoice_deliveries` row records the sale and the medium (`email`, `a4` or `receipt`). It records `original` or `duplicate`, the address (for email) or the page printer (for A4), the status, the attempts, a failure code and the document it sent. Its statuses are `queued`, `sending`, `sent`, `failed` and `unknown`.
  - At most one delivery per sale is an original that is `sent` or `unknown`. A second original after either is refused with a named code, so it must be a duplicate.
  - A `failed` original may be retried as the original only when its failure code is one the design calls certain: the mail server refused it, or the printer refused the job before printing.
  - An A4 delivery sent as raster pages stores the PDF of the same layout as its document, not the raster bytes.
- **Schema rules:**
  - Classify both tables (`ledger` or `state`) with the reason written at the classification.
  - If the tables go in the core set, state the reason in the commit (CLAUDE.md §3).
  - Declare every key and unique index in the TypeScript schema.
  - Write through every new foreign key: CLAUDE.md §3 says a key whose target lacks a unique index fails only at the first write.
- **Guard suites.** Run `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`, `scripts/migrations-match-schema.test.ts`, `scripts/migration-upgrade.test.ts` and `inmutabilidad`. Measure and state the upgrade effect in the PR.
- **Error codes.** Name new codes after the domain concept, `invoice_delivery.*`, after checking the registry for siblings. Add the alert code's area claim and its English and Spanish wording (`scripts/alert-codes.test.ts`, `scripts/errors-reachable.test.ts`).

## 3. Set up email for a live venue, without a terminal

**Inspect/change:** `apps/setup/src/setup-app.ts` (the live path's screen order, today venue → certificate and fiscal test where they apply → review: `setup-app.ts:637-642`, `cert-screen.ts:179`, `fiscal-test-screen.ts:60`) and a new screen beside `apps/setup/src/screens/cert-screen.ts`, `apps/setup/src/api/client.ts`, `apps/server/src/setup-api.ts` and `setup-operation.ts`, `apps/server/src/email-delivery.ts`, `packages/credentials/src/purposes.ts` (read only: `email.smtp` keeps its `url` and `from` fields), a new dashboard card and its server route, the setup and dashboard translations.

**Red first, server:**

- A live provision carries the email settings beside `aeatCert`; the server seals them as `email.smtp` in the same provisioning step, and `resolveEmailDelivery` then returns `smtp` with that `url` and `from`.
- A live provision without email settings is refused with a named code, field `email` (decision 8). A demo or prepare provision carrying them is refused the way a certificate is today (`setup.request_invalid`). A development server may omit them.
- The setup's test-message route sends one short message to the admin's address through the given settings, and answers accepted, refused (as a code) or no answer within a bound. It writes nothing to the database, and neither its log lines nor its answer carry the SMTP address, user or password. Test against a fake SMTP server in the suite.
- The dashboard's email-settings route needs `system.manage`: one role without it is refused and a manager is allowed. It seals `email.smtp` the way `payments-api.ts` seals a provider credential, and its read answer carries the server and the "from" address, never the password or the whole URL.
- In practice mode the dashboard route refuses a change with a named code.
- **Restores.** For each way the wizard and `waitron-restore` rebuild a live venue (from an archive, from the bucket, the cloud recovery), find out by running it whether `email.smtp` survives, on the same machine and on a different one. Where it does not, the restored venue reports invoice email unavailable and the dashboard card asks for the settings again; write the result in the PR.

**Red first, setup and dashboard browser suites:**

- The live path shows the Email step just before review: after the certificate and fiscal-test screens where they apply, straight after the venue details otherwise; demo and prepare do not.
- Its fields follow the forms rules: required fields marked, a mistake explained beside its field, and Continue disabled until the mail server has accepted a test message from the current values. Changing a value after a test needs a new test.
- A refused test shows its reason under the form and keeps the fields.
- The dashboard card shows the server and "from" address, or, in a live venue without email, that invoices cannot be emailed until a mail server is set up; in a practice venue, that mail is captured on the box.
- Check both themes, phone width, keyboard and focus, and run axe for each new state.

**Look at it.** Open the wizard's Email step and the dashboard card in both themes, at 1280 and 390 px wide, in English and Spanish.

## 4. Email the PDF

**Inspect/change:**

- `apps/server/src/account-email.ts`: the mail message type gains attachments, or a sibling invoice-mail module shares the transport.
- `apps/server/src/email-delivery.ts`: invoice email in practice mode resolves to the captured inbox even when `email.smtp` is set.
- The server's background work loop.
- The location settings (a contact email and optional phone) and the screen that edits them.
- A231's full-invoice dialog in `apps/till`, and `apps/till/src/api/client.ts`.
- The till and dashboard translations.
- `deploy/compose.yml`, for the capture service's size limit, if the measurement needs it.

**Red first, till browser suite:**

- The F1 dialog offers Printed receipt (the default). It offers A4 only with an invoice printer set, and Email only when the server says invoice email can be sent and the location has a contact email.
- Choosing Email requires an address and the consent box.
- The box is unticked by default and shows the versioned statement in the receipt language.
- Issue stays disabled until both fields are valid, under the forms rules.
- A server refusal stays retryable.
- Check both themes, phone width, keyboard and focus, and run axe (the accessibility checker) for each new dialog state.

**Red first, server suites:**

- **Where invoice email goes.**
  - On a server that is not a development server, a live venue with `email.smtp` set sends through it; a live venue without it reports invoice email unavailable, and an email choice is refused with a named code before issue.
  - A demo or prepare venue sends to the captured inbox, with `email.smtp` set and without it. Delete the practice-mode check and this case fails.
  - A development server sends invoice email to the captured inbox in every mode, with `email.smtp` set and without it.
  - Account email keeps today's behaviour (it prefers SMTP when set): its existing cases pass unedited.
- **Issue.**
  - Issuing with Email records the address and the consent (statement version and language, time, staff member) under the bill's revision check, and snapshots them on the sale.
  - The issuing transaction writes a `queued` delivery and sends nothing itself.
  - With Email or A4 chosen, no automatic receipt job prints the F1, whatever the location's receipt setting. With Printed receipt chosen, the receipt setting applies as before.
- **Sending.**
  - The worker claims a delivery in one transaction, renders, stores and sends with no transaction open, and records the result in a second transaction.
  - A sale commits while the stubbed mail server hangs.
  - A stubbed refusal leaves the sale filed.
  - A refusal retries up to the bound with growing gaps; a final failure marks the delivery `failed` and raises the alert.
  - A delivery left `sending` by a restart becomes `unknown`, and every later send of that invoice is a duplicate whose PDF says «duplicado».
- **Other cases.**
  - Withdrawal before sending switches the delivery to paper.
  - A replayed issuing request does not queue a second delivery.
- **The F1 on the receipt printer.**
  - Its print job refuses the print-jobs screen's resend with a named code; the invoice's own Reprint makes a «duplicado» instead.
  - Its delivery row follows the print job: `done` makes it `sent`, a final failure makes it `failed` or `unknown` by the task 2 rule.
  - The second print after a lapsed claim is not prevented; the PR states it, as the design does.

**Practice mode.** Send a long invoice into the capture service, then read it back from the inbox API with its attachment. If the 1 MB limit refuses it, raise the limit in `deploy/compose.yml` and say why in the PR.

**The till's sale view** shows the delivery's state ("sending", "sent to …", "not delivered", "may not have been delivered") and the not-delivered actions.

## 5. Office printers for invoices

**Inspect/change:**

- `apps/print-agent/src/ipp-probe.ts`, `apps/print-agent/src/linux-devices.ts` (the mDNS query), and a new IPP print module beside them.
- `packages/print-agent`: `client.ts`, `agent.ts` and `host.ts`. This package imports no other package in this repo, and the `import-x/no-restricted-paths` zone in `eslint.config.js` enforces that (CLAUDE.md §3).
- A new page-printer schema file and its generated migration.
- The location's invoice-printer setting.
- `apps/server/src/print-api.ts`, or a new agent route module beside it.
- `apps/dashboard/src/screens/printers-screen.ts` and `printing-rules-screen.ts`.

**Do not change `printers` or `print_jobs`.** The design keeps page printers and their jobs out of them:

- changing `printers`' fixed lists rebuilds a table that `devices`, `tills`, `drawer_opens`, `station_printers`, `watcher_printers` and `print_jobs` point at;
- `print_jobs` delivers at least once and resends finished jobs.

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
  - A refusal before printing is a certain failure.
  - An abort after starting, no answer, or a lapsed claim is `unknown`.
  - Test against a fake IPP server in the suite, never against a real printer and never on port 9100. On a developer Mac, also send one PWG Raster and one Apple Raster job to `ippeveprinter -f image/pwg-raster,image/urf -k` (CUPS's software printer, installed with macOS) and check it accepted and kept them; say in the PR that this ran locally, not in CI, and that it checks the job was accepted under its format, not what the pages look like.

**Red first, server and dashboard:**

- In the add-printer dialog, an office printer the agent marked as printable shows "Add as invoice printer"; one with no usable format stays greyed with the reason; a receipt printer's row is unchanged.
- Adding stores the page printer with its chosen format and its reported format list. It never appears in the receipt-printer, kitchen-routing or drawer choices.
- The Printers tab lists it marked "Invoice printer (A4)", with rename, disable and "Print test page"; each needs `printer.manage`.
- A disabled invoice printer found again is offered "Add again" and reactivates the same row, as a receipt printer does (CLAUDE.md §3).
- The receipt-printer and kitchen routes refuse a page printer's id.
- An A4 delivery naming a receipt printer's id is refused.
- The Printing rules screen sets or clears the location's invoice printer.
- The agent's claim hands over A4 deliveries for its own location only, with the document in the printer's format.
- A claim that lapses becomes `unknown` and is not sent again.
- A late report from the agent that held a lapsed claim is recorded: `completed` turns `unknown` into `sent`; any other late report leaves it `unknown`.

**Guard suites.** Run the same suites as task 2 for the new tables.

**Measure on the owner's HP.** This prints real paper, so do it with the owner present or by arrangement:

- a long F1 as PDF through the product, with its QR measured with a ruler and scanned with a phone;
- the same F1 as Apple Raster at 600 dots per inch, sent from the Mac with `ipptool` Print-Job using the server's encoder output, with its QR measured and scanned the same way;
- a test page from the Printers tab;
- what is reported when the tray is empty;
- what is reported when the printer is switched off mid-job.

Write what the printer reported into the PR and `docs/backlog.md`. PWG Raster cannot be proven on this printer (it does not list it); say so, and that its proof is the independent reader and `ippeveprinter`. Without the printer, leave physical output unverified and do not call the task ready to land.

## 6. Send or print again, from the till and the dashboard

**Inspect/change:** `apps/server/src/till-api.ts`, `orders-api.ts`, `orders-reprint.ts`, `apps/till/src/screens/till-ticket-view.ts`, `apps/dashboard/src/widgets/order-detail-dialog.ts`, the dashboard client and translations.

**Red first:**

- For an F1, the till's sale view and the dashboard's order detail offer print on receipt, print on A4 (with an invoice printer set) and email.
- The dashboard also offers Download PDF. It returns a PDF marked «duplicado», with the series-and-number file name, and stores it as a duplicate document.
- On the dashboard, email and download need `report.export` (managers and admins, decision 4), for any order: a supervisor is refused and a manager is allowed. Reprint keeps today's rule (any session for the current business day unless its enrolled device lacks receipt printing, `report.view` for older orders).
- Each action records who did it and when.
- Each action is an original or a duplicate exactly as the task 2 rules say.
- An F2 offers none of these.

**Look at it.** Open the till and dashboard screens in both themes, at 1280 and 390 px wide, in English and Spanish.

## 7. Gate and handoff

1. **Tests and CI.**
   - While implementing, run the focused suites.
   - Let the pre-push hook run once on a signed-off commit, and never bypass it.
   - Confirm CI selected every changed package (the server, the till, the dashboard, the setup wizard, `db`, `print-agent` and the print agent app), and that their coverage jobs passed on the current head.
   - CI builds a front end only when an image input changed (CLAUDE.md §2), so build and open the till, dashboard and setup wizard locally.
2. **Prose that goes stale.**
   - Read the base-to-tip prose claims for the retired behaviours: "office printers are not supported", "email is account email only", and "SMTP needs a terminal" (`apps/server/README.md`'s `waitron-credentials set --purpose email.smtp` instructions stay true but are no longer the only way).
   - Read the backlog's A3 entry "Printing A4 invoices on an office printer" and its "virtual PDF printer" line, and the item "A venue preparing to go live sends real email through SMTP", and mark what this build settles.
   - Update `docs/backlog.md` in the same change.
3. **Owner review.** Ask the owner to review each PR before landing. It changes how an issued invoice reaches a customer, task 3 changes going live, and task 5 prints real paper.
