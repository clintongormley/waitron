# A231d implementation plan: full invoices by email as a PDF, and on an office printer

**Status:** proposed, blocked on the [design's owner decisions](../specs/2026-10-03-invoice-pdf-email-and-office-printing-design.md#what-the-owner-decides) and on the A231 build. Do not start on the strength of this plan alone. Read the design's primary-source register before deciding a legal or delivery detail. Read [A231's design](../specs/2026-10-03-full-invoices-at-till-design.md) and [plan](2026-10-03-full-invoices-at-till.md) too, because every task here reads facts the A231 build stores.

## 0. Reconcile the starting point

1. **Owner and asesor answers.** Confirm the owner approved the design's six decisions. Record the asesor's answers to its five questions, or the owner's decision to go ahead without them for a named question. Read the latest `CLAUDE.md` and the topic files its §3 and §4 point to for each area touched: data, UI, testing, CI.
2. **What A231 actually built.** Confirm A231's build has landed. Read what it built, not what its plan proposed:
   - the F1 snapshot on the sale (customer tax ID, legal name, address);
   - the taxpayer domicile;
   - the net line figures and discounts it projects;
   - its paper F1 layout;
   - its "F1 not delivered" state.

   Name those files in this build's first PR. If any is missing or differs, stop and revise this plan.
3. **SMTP.** Check whether the backlog's "A venue preparing to go live sends real email through SMTP" item has landed a dashboard SMTP setting. Either way this plan does not build one. Email is offered wherever the box can send: SMTP set up, or practice mode capturing. Record which venues that covers.
4. **The fiscal core stays untouched**: the hash and chain, number allocation, the immutable fiscal rows, the alta builders, `registerSif` and `restoreFiscal`. The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` pass unedited in every task. Nothing here files anything: every task reads an already-filed F1.

**Every task below:**

- Write a focused behavioural test first, run it and keep the expected failure, then implement only enough to pass.
- Database suites use `useVenueDb`.
- A refused write asserts the domain error code.
- Prove each new guard by deletion, and add a case showing that the legitimate path is still served.
- No customer email, tax ID, name or address goes in any log line, error parameter or alert. A failure reason is stored as a code, never as a mail server's or printer's own text.

## 1. A shared F1 layout model and the PDF renderer

**Inspect/change:** the A231 F1 layout (expected under `apps/server/src/receipt-ticket.ts` or beside it), `apps/server/src/qr-matrix.ts`, a new server module for the PDF, `apps/server/package.json`, `scripts/bundle-node.mjs`, `deploy/Dockerfile`, `deploy/third-party/`.

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
- **Library: `pdfkit`, if the owner approved it.** Before relying on it:
  - (a) Build the server bundle with `scripts/bundle-node.mjs`, and render a PDF from the bundled server inside the built image. A library reading its own data files at run time is the `sharp` trap in CLAUDE.md §2.
  - (b) Choose the font. The dashboard's `apps/dashboard/src/assets/google-sans-medium-latin.woff2` is one weight with Latin characters only, and `deploy/third-party/google-sans/` holds only its licence. Check whether `pdfkit` can embed it and whether it covers every receipt language. Otherwise add an open-licence font and its notice in `/app/third-party/`, and extend `scripts/deploy-image-env.test.ts`'s third-party blocks.
  - (c) Record the PDF size of the long fixture.
- **Coverage.** The renderer is ordinary source and holds the server's 98/98/98/95 coverage bar.

## 2. Keep every delivered PDF, and record each delivery

**Inspect/change:** a new schema file and generated migration in the set that owns sales (expected `packages/db`), its classification list, the A231 F1 snapshot, and the invoice choice A231 stores on the bill.

- **Red first:**
  - An `invoice_documents` row can be inserted and read: the sale, `original` or `duplicate`, the PDF bytes, the SHA-256, the creation time, and who created it.
  - `invoice_documents` refuses UPDATE, DELETE and INSERT OR REPLACE. Declare it with `appendOnly()`.
  - An `invoice_deliveries` row records the sale and the medium (`email`, `a4` or `receipt`). It records `original` or `duplicate`, the address (for email) or the page printer (for A4), the status, the attempts, a failure code and the document it sent. Its statuses are `queued`, `sending`, `sent`, `failed` and `unknown`.
  - At most one delivery per sale is an original that is `sent` or `unknown`. A second original after either is refused with a named code, so it must be a duplicate.
  - A `failed` original may be retried as the original only when its failure code is one the design calls certain: the mail server refused it, or the printer refused the job before printing.
- **Schema rules:**
  - Classify both tables (`ledger` or `state`) with the reason written at the classification.
  - If the tables go in the core set, state the reason in the commit (CLAUDE.md §3).
  - Declare every key and unique index in the TypeScript schema.
  - Write through every new foreign key: CLAUDE.md §3 says a key whose target lacks a unique index fails only at the first write.
- **Guard suites.** Run `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`, `scripts/migrations-match-schema.test.ts`, `scripts/migration-upgrade.test.ts` and `inmutabilidad`. Measure and state the upgrade effect in the PR.
- **Error codes.** Name new codes after the domain concept, `invoice_delivery.*`, after checking the registry for siblings. Add the alert code's area claim and its English and Spanish wording (`scripts/alert-codes.test.ts`, `scripts/errors-reachable.test.ts`).

## 3. Email the PDF

**Inspect/change:**

- `apps/server/src/account-email.ts`: the mail message type gains attachments, or a sibling invoice-mail module shares the transport.
- `apps/server/src/email-delivery.ts`.
- The server's background work loop.
- The location settings (a contact email and optional phone) and the screen that edits them.
- A231's full-invoice dialog in `apps/till`, and `apps/till/src/api/client.ts`.
- The till and dashboard translations.
- `deploy/compose.yml`, for the capture service's size limit, if the measurement needs it.

**Red first, till browser suite:**

- The F1 dialog offers Printed receipt (the default). It offers A4 only with an invoice printer set, and Email only when the server says the box can send and the location has a contact email.
- Choosing Email requires an address and the consent box.
- The box is unticked by default and shows the versioned statement in the receipt language.
- Issue stays disabled until both fields are valid, under the forms rules.
- A server refusal stays retryable.
- Check both themes, phone width, keyboard and focus, and run axe (the accessibility checker) for each new dialog state.

**Red first, server suites:**

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
  - With email unconfigured, an email choice is refused with a named code before issue.
  - A replayed issuing request does not queue a second delivery.
- **The F1 on the receipt printer.**
  - Its print job refuses the print-jobs screen's resend with a named code; the invoice's own Reprint makes a «duplicado» instead.
  - Its delivery row follows the print job: `done` makes it `sent`, a final failure makes it `failed` or `unknown` by the task 2 rule.
  - The second print after a lapsed claim is not prevented; the PR states it, as the design does.

**Practice mode.** Send a long invoice into the capture service, then read it back from the inbox API with its attachment. If the 1 MB limit refuses it, raise the limit in `deploy/compose.yml` and say why in the PR.

**The till's sale view** shows the delivery's state ("sending", "sent to …", "not delivered", "may not have been delivered") and the not-delivered actions.

## 4. Office printers for invoices

**Inspect/change:**

- `apps/print-agent/src/ipp-probe.ts`, and a new IPP print module beside it.
- `packages/print-agent`: `client.ts` and `agent.ts`. This package imports no other package in this repo, and the `import-x/no-restricted-paths` zone in `eslint.config.js` enforces that (CLAUDE.md §3).
- A new page-printer schema file and its generated migration.
- The location's invoice-printer setting.
- `apps/server/src/print-api.ts`, or a new agent route module beside it.
- `apps/dashboard/src/screens/printers-screen.ts` and `printing-rules-screen.ts`.

**Do not change `printers` or `print_jobs`.** The design keeps page printers and their jobs out of them:

- changing `printers`' fixed lists rebuilds a table that `devices`, `tills`, `drawer_opens`, `station_printers`, `watcher_printers` and `print_jobs` point at;
- `print_jobs` delivers at least once and resends finished jobs.

**Red first, agent:**

- **Registration.** The attribute request asks for `document-format-supported` and `media-supported`. It accepts a printer only with `application/pdf` and A4 or US letter.
  - First capture the owner's HP reply as raw IPP bytes into a fixture in `__fixtures__/`. The design's measurement saved no bytes.
  - An image-only reply is refused with a named reason.
- **Sending.** A claimed A4 delivery is sent as one IPP Print-Job with `document-format = application/pdf`. Get-Job-Attributes is then polled until `completed`, `aborted` or `canceled`, or a bound passes. Each outcome is reported as a code, with the printer's `job-state-reasons` mapped to codes.
  - A refusal before printing is a certain failure.
  - An abort after starting, no answer, or a lapsed claim is `unknown`.
  - Test against a fake IPP server in the suite, never against a real printer and never on port 9100.

**Red first, server and dashboard:**

- A page printer can be added from the Printers screen as an invoice printer. It never appears in the receipt-printer, kitchen-routing or drawer choices.
- The receipt-printer and kitchen routes refuse a page printer's id.
- An A4 delivery naming a receipt printer's id is refused.
- The Printing rules screen sets or clears the location's invoice printer.
- The agent's claim hands over A4 deliveries for its own location only.
- A claim that lapses becomes `unknown` and is not sent again.
- A late report from the agent that held a lapsed claim is recorded: `completed` turns `unknown` into `sent`; any other late report leaves it `unknown`.

**Guard suites.** Run the same suites as task 2 for the new tables.

**Measure on the owner's HP.** This prints real paper, so do it with the owner present or by arrangement:

- a long F1, with its QR measured with a ruler and scanned with a phone;
- what is reported when the tray is empty;
- what is reported when the printer is switched off mid-job.

Write what the printer reported into the PR and `docs/backlog.md`. Without the printer, leave physical output unverified and do not call the task ready to land.

## 5. Send or print again, from the till and the dashboard

**Inspect/change:** `apps/server/src/till-api.ts`, `orders-api.ts`, `orders-reprint.ts`, `apps/till/src/screens/till-ticket-view.ts`, `apps/dashboard/src/widgets/order-detail-dialog.ts`, the dashboard client and translations.

**Red first:**

- For an F1, the till's sale view and the dashboard's order detail offer print on receipt, print on A4 (with an invoice printer set) and email.
- The dashboard also offers Download PDF. It returns a PDF marked «duplicado», with the series-and-number file name, and stores it as a duplicate document.
- Each action is allowed for exactly the roles the owner chose (decision 4): one role outside is refused and one inside is allowed.
- Each action records who did it and when.
- Each action is an original or a duplicate exactly as the task 2 rules say.
- An F2 offers none of these.

**Look at it.** Open the till and dashboard screens in both themes, at 1280 and 390 px wide, in English and Spanish.

## 6. Gate and handoff

1. **Tests and CI.**
   - While implementing, run the focused suites.
   - Let the pre-push hook run once on a signed-off commit, and never bypass it.
   - Confirm CI selected every changed package (the server, the till, the dashboard, `db`, `print-agent` and the print agent app), and that their coverage jobs passed on the current head.
   - CI builds a front end only when an image input changed (CLAUDE.md §2), so build and open the till and dashboard locally.
2. **Prose that goes stale.**
   - Read the base-to-tip prose claims for the retired behaviours: "office printers are not supported", and "email is account email only".
   - Read the backlog's A3 entry "Printing A4 invoices on an office printer" and its "virtual PDF printer" line, and mark what this build settles.
   - Update `docs/backlog.md` in the same change.
3. **Owner review.** Ask the owner to review each PR before landing. It changes how an issued invoice reaches a customer, and task 4 prints real paper.
