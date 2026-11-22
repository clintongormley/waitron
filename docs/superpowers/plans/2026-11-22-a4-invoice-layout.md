# A4 invoice layout and bank-transfer instructions — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the A4 invoice the layout the owner chose (letterhead header, six-column table, VAT
summary, payment footer), and print bank-transfer instructions on deferred-payment bills on A4 and on
the till receipt, from a new bank-account setting whose changes are emailed to administrators.

**Architecture:** The receipt builder (`apps/server/src/receipt-document.ts`) is split into a
fact-gathering stage and the thermal placement stage; a new A4 layout reads the same facts and places
them in regions. PDF and office-printer rendering keep drawing whatever the layout emits, gaining a
real bold weight, a muted colour and a shaded box. The bank account lives in the core
`settings.venue` document, is edited on the dashboard's Business card behind a fresh sign-in, and a
change queues a `box_alert` email to every `system.manage` holder.

**Tech stack:** TypeScript, PDFKit 0.20.2, fontkit 2.0.4, sharp, Hono (server routes), Lit
(dashboard), Vitest (node and browser modes), drizzle on node:sqlite.

**Spec:** `docs/superpowers/specs/2026-11-22-a4-invoice-layout-design.md` — read it before any task.
Worktree `/Users/clintongormley/workspace/worktrees/waitron-a4-invoice-layout`, branch
`a4-invoice-layout`.

## Global Constraints

- The QR stays first on page 1 only, 35 mm square, level M, decodable to the filed text, «QR
  tributario:» above it and VERI\*FACTU below it, both at body text size.
- Bank details print only when the bill, or the sale it replaces (followed back through replacements
  and substitutions), was closed as a deferred payment; never because something is owed.
- "Pagado" prints only when the sale lists payments and nothing is owed.
- Every A4 "Total con IVA" column adds up to TOTAL exactly; it shows what each row was charged, VAT
  included, never a per-row VAT computation.
- Thermal receipts change only on deferred bills.
- Spanish wording (from the spec): "FORMA DE PAGO"; "Pagado"; "Pago aplazado."; "Pagar por
  transferencia bancaria a la cuenta indicada, con referencia {number}."; "IBAN: {iban}   Banco:
  {bank}" (A4, one line). Thermal 58 mm: "IBAN:" alone, the number on the next line; 80 mm: "IBAN:
  {iban}" then "Banco: {bank}".
- An IBAN is stored without spaces, uppercase, printed in groups of four; masked in emails as first
  four and last four characters (`ES91 •••• •••• •••• •••• 1332`).
- Bank-account changes: `venue.configure` plus a fresh sign-in, an activity entry with `data: {}`, and
  a `box_alert` email per `system.manage` holder that survives a restart.
- English-only code; Spanish and other receipt languages only in
  `packages/country-es/src/receipt-labels.ts` (all five blocks: en-GB, es-ES, ca-ES, gl-ES, eu-ES),
  dashboard strings in `apps/dashboard/src/i18n/strings.ts` (en and es), email wording in
  `apps/server/src/i18n/box-emails.ts`.
- Colours on the A4 page: muted text `#6b6b6b`, table heading fill `#e4e4e8`, customer panel fill
  `#f2f2f4`; these are print colours inside the PDF, not dashboard chrome, so the `--wt-*` token rule
  does not apply.
- Coverage 98/98/98/95 per package; `shared` has a mutation floor of 90.
- Every implementer's verify step includes `pnpm format:check` on the changed files and the package
  typecheck. Focused tests only; no whole-workspace runs. Commit with `git commit -s`.
- Implementers are dispatched as `subagent_type: "implementer"`. An implementer past about 150 calls
  with its task unfinished stops at a passing or cleanly red point, commits, and returns a handover.

## Review Focus

1. A deferred bill later replaced after an AEAT refusal (replacement has no tender row): the
   replacement must still print "Pago aplazado" and the bank instructions — Task 7.
2. A whole-bill discount split across two VAT rates: the "Total con IVA" column must still sum to
   TOTAL to the cent — Task 6 (fact) and Task 9 (column sum asserted on the PDF text).
3. An invoice long enough to take three pages: table heading repeats, VAT summary + TOTAL + footer
   never split, "Factura FF/1 · 2/3" on later pages, QR on page 1 only — Task 9.
4. A venue with no logo and no trading name printed: the legal name heads the letterhead in bold and
   nothing is left blank — Task 8.
5. A reprint after the bank account is cleared: "Pago aplazado." alone, no empty "IBAN:" line — Task 7.

---

### Task 1: IBAN helper in `@waitron/shared`

**Files:**
- Create: `packages/shared/src/iban.ts`, `packages/shared/src/iban.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `normalizeIban(raw: string): string` — removes all whitespace, uppercases.
  - `ibanProblem(iban: string): "format" | "checksum" | undefined` — on a normalized value. Format:
    two letters, two digits, then 11–30 letters or digits; a Spanish IBAN (`ES`) is exactly 24
    characters. Checksum: ISO 7064 mod-97 equals 1.
  - `ibanGroups(iban: string): string[]` — groups of four, the last may be shorter.
  - `maskIban(iban: string): string` — first group, then `••••` for each middle group, then the last
    group, joined by spaces.

- [ ] **Step 1: Write the failing tests** — `iban.test.ts`:
  - `normalizeIban(" es91 2100 0418\t4502 0005 1332 ")` → `"ES9121000418450200051332"`.
  - `ibanProblem("ES9121000418450200051332")` → `undefined`; `"ES9121000418450200051333"` →
    `"checksum"`; `"ES91210004184502000513"` (22 chars) → `"format"`; `"9121000418450200051332"` →
    `"format"`; `"ES9I21000418450200051332"` → `"format"`; a valid German IBAN
    `"DE89370400440532013000"` → `undefined`; a valid 30-character Maltese IBAN
    `"MT84MALT011000012345MTLCAST001S"` → `undefined`.
  - `ibanGroups("ES9121000418450200051332")` → `["ES91","2100","0418","4502","0005","1332"]`;
    `ibanGroups("DE89370400440532013000")` ends with `"00"`.
  - `maskIban("ES9121000418450200051332")` → `"ES91 •••• •••• •••• •••• 1332"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/shared exec vitest run src/iban.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** in `iban.ts`. Mod-97 over a 34-character IBAN overflows a JS number:
  compute it piecewise (fold the rearranged digit string in chunks), or with `BigInt`.
- [ ] **Step 4: Run** the same command — PASS. Then `pnpm --filter @waitron/shared typecheck` and
  `pnpm exec prettier --check packages/shared/src/iban*.ts`.
- [ ] **Step 5: Commit** — `git commit -s -m "Check and format IBANs in the shared package"`.

### Task 2: Bank account setting and its save route

**Files:**
- Modify: `packages/db/src/venue-settings.ts` (add `bankAccount` to `VenueSettings`, default `null`,
  parse it), `packages/db/src/activity-kinds.ts` (new kind), `apps/server/src/venue-settings-api.ts`
  (new route), `apps/server/src/venue-detail-types.ts` and `apps/server/src/venue-details*.ts` reader
  (`readVenueDetails` model gains `bankAccount`), `packages/diagnostics/src/path-patterns.ts` (route),
  `packages/provisioning/src/index.ts` (export)
- Create: `packages/provisioning/src/bank-account.ts`, `packages/provisioning/src/bank-account.db.test.ts`,
  `apps/server/src/venue-bank-account-api.test.ts`

**Interfaces:**
- Consumes: Task 1's `normalizeIban`, `ibanProblem`.
- Produces:
  - `type BankAccount = { iban: string; bankName: string | null }` exported from `@waitron/db`
    beside `VenueSettings`.
  - `saveBankAccount(tx: Transaction, change: { expected: string; iban: string; bankName: string; personId: string }): Promise<{ saved: boolean; activityId?: string; before: BankAccount | null; after: BankAccount | null }>`
    in `packages/provisioning/src/bank-account.ts`. `expected` is the stored IBAN or `""` when none;
    a mismatch returns `saved: false` and writes nothing. An empty `iban` clears the account (bank
    name ignored). A non-empty `iban` is normalized and checked: a problem throws
    `AppError("venue.detail_invalid", { field: "iban", reason })`. `bankName` is NFC-trimmed, empty
    becomes `null`. Saving an identical account throws `venue.detail_invalid { field: "iban", reason: "unchanged" }`.
    On save it records activity kind `"venue.bank_account_changed"` with `data: {}`.
  - `readBankAccount(tx: Transaction): Promise<BankAccount | null>`.
  - Route `PUT /management-api/venue-details/bank-account`, body `{ iban: string; bankName: string; expected: string }`,
    any other key refused as `taxpayerFieldRequest` does; gated by `gated(...)` with `venue.configure`
    and `requireFreshManagementSignIn`; `saved: false` → `venue.detail_changed`; answer
    `{ model: await readVenueDetails(tx, now) }`. `VenueDetailsModel.bankAccount: BankAccount | null`.
    The route keeps the `{ before, after }` for Task 3.

- [ ] **Step 1: Write the failing tests.**
  - `bank-account.db.test.ts` (`useVenueDb`): saves a valid IBAN with spaces as
    `"ES9121000418450200051332"`; refuses a bad checksum with `venue.detail_invalid` reason
    `"checksum"` and saves nothing; `expected` mismatch returns `saved: false` and leaves the old
    account; empty `iban` clears; blank bank name stored as `null`; records one
    `venue.bank_account_changed` activity row whose `data` is `{}` and whose id the function also returns as `activityId`; identical save refused `"unchanged"`.
  - `venue-bank-account-api.test.ts`, modelled on `apps/server/src/venue-legal-name-api.test.ts`:
    refused without `venue.configure`; refused with `management_session.proof_required` when the
    sign-in proof is 15 minutes old; unknown body key refused; success answers the model with
    `bankAccount`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/provisioning exec vitest run src/bank-account.db.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/venue-bank-account-api.test.ts` — FAIL.
- [ ] **Step 3: Implement** the setting, `bank-account.ts`, the activity kind (subject rule like
  `taxpayer.domicile_changed`, subject `"venue"` or the existing venue subject — follow the file's
  header rules), the route and the model field. Saving goes through `saveSettings(tx, VENUE_SETTINGS, …)`
  with `expectedRevision`, like `savePrivacyContact`.
- [ ] **Step 4: Run** both tests — PASS. Also run `packages/db/src/settings.test.ts`,
  `apps/server/src/first-fiscal-setup.e2e.test.ts` (a configuration export must still apply with the
  new key absent from it; add a case asserting a saved bank account does not appear in an export), `scripts/write-path-tables.test.ts` and the path-pattern test in
  `packages/diagnostics`. Typecheck `@waitron/db`, `@waitron/provisioning`, `@waitron/server`; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Store the venue's bank account behind a fresh sign-in"`.

### Task 3: Email administrators when the bank account changes

**Files:**
- Modify: `apps/server/src/box-alert-email.ts` (new code; `transientBoxAlertMail` exempts it as it
  exempts `upgrade.rolled_back`), `apps/server/src/i18n/box-emails.ts` (en/es words),
  `apps/server/src/venue-settings-api.ts` (queue after a successful save, same transaction)
- Create: `apps/server/src/bank-account-mail.ts`, `apps/server/src/bank-account-mail.test.ts`

**Interfaces:**
- Consumes: Task 2's `{ before, after }`, Task 1's `maskIban`.
- Produces: `queueBankAccountChangedMail(tx: Transaction, input: { editorId: string; editorName: string; at: string; offsetMinutes: number; before: BankAccount | null; after: BankAccount | null; venueLanguage: "en" | "es"; activityId: string }): Promise<void>`
  — one `box_alert` per recipient of `readManagerEmailRecipients(tx, venueLanguage)`, `subjectId: null`,
  `dedupeKey: \`bank-account:${activityId}:${personId}\``, `params: { code: "venue.bank_account_changed", wording: JSON.stringify({ editorName, at, offset, before, after }) }`
  where `before`/`after` are masked strings or `null`.

Email words (Spanish; English equivalent in the en block):
- Subject: `Se ha cambiado la cuenta bancaria de {venue}`
- Text: `{editorName} cambió la cuenta bancaria que aparece en las facturas de pago aplazado el {at}.`
  then `Antes: {before}` and `Ahora: {after}` (a missing account reads `ninguna`), then
  `Si no reconoce este cambio, revíselo en Ajustes del local → Datos del local antes de emitir más facturas.`

- [ ] **Step 1: Write the failing tests** in `bank-account-mail.test.ts` (`useVenueDb`): two
  `system.manage` holders with email and one without → two `outgoing_mail` rows of kind `box_alert`;
  composing one through `boxAlertMail(...).claim` + `compose` gives the Spanish subject with the venue
  name and a text containing `ES91 •••• •••• •••• •••• 1332` and never the full IBAN; a row queued
  before a simulated restart (its id seen by the `transientBoxAlertMail()` query in `boot.ts`) is not
  in that query's result; the route test from Task 2 gains a case asserting a save queues the mail
  and a refused save queues none.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bank-account-mail.test.ts src/venue-bank-account-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS, plus `box-alert-mail.test.ts`, `box-alert-email.test.ts`,
  `i18n/email-copy.test.ts`, `scripts/personal-log-params.test.ts`; typecheck; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Email administrators when the bank account changes"`.

### Task 4: Business card row and bank-account dialog on the dashboard

**Files:**
- Create: `apps/dashboard/src/screens/bank-account-dialog.ts` and its `.test.ts`,
  `.unsaved.test.ts`, `.a11y.test.ts`
- Modify: `apps/dashboard/src/screens/venue-details-panel.ts` (row `saved-bankAccount`, button
  `change-bank-account`, dialog mount; extend `TaxpayerField` and `withTaxpayerField`),
  `apps/dashboard/src/api/client.ts` (`saveBankAccount`, model copy gains `bankAccount`),
  `apps/dashboard/src/api/client-routes.test.ts`, `apps/dashboard/src/i18n/strings.ts`,
  `apps/dashboard/src/screens/venue-details-panel.test.ts`

**Interfaces:**
- Consumes: Task 2's route; Task 1's `normalizeIban`, `ibanProblem`, `ibanGroups`.
- Produces: `saveBankAccount(body: { iban: string; bankName: string; expected: string }): Promise<{ model: VenueDetailsModel }>`
  on the dashboard client; `<dashboard-bank-account-dialog>` extending `TaxpayerFieldDialog<{ iban: string; bankName: string }>`.

The dialog follows the Forms contract (`docs/developers/design-system.md` → Forms): two fields, IBAN
(not required: empty clears) and Bank (optional); inline IBAN error under the field for `format` and
`checksum`, shown from the shared check before sending; action disabled until the draft changes; the
server's `venue.detail_invalid { field: "iban" }` lands under the IBAN field. The row shows the IBAN
in groups of four and the bank name, or the existing `venue_details.unset` text. A short note in the
dialog: "Printed on invoices for bills closed as a deferred payment. Administrators are emailed when
it changes." (Spanish in the es block.)

- [ ] **Step 1: Write the failing tests**, modelled on `legal-name-dialog{,.unsaved,.a11y}.test.ts`:
  offered only when editable; prefill from the model; a bad checksum shows the inline error and keeps
  Save disabled; a valid change sends `{ iban: "ES91…" without spaces, bankName, expected }`; changed
  elsewhere shows the stale message; Escape/Keep/Discard; axe in both themes. Panel test: the row
  shows `ES91 2100 0418 4502 0005 1332 · OPENBANK`. Client route test for the PUT path.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/bank-account-dialog src/screens/venue-details-panel.test.ts src/api/client-routes.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; typecheck; format check; `scripts/native-form-fields.test.ts`.
- [ ] **Step 5: Commit** — `git commit -s -m "Edit the bank account on the Business card"`.

### Task 5: Real bold, muted text and shaded boxes on the A4 renderers

**Files:**
- Add: `apps/server/src/assets/invoice-noto-sans-bold.ttf` — the unmodified static `NotoSans-Bold.ttf`
  from a tagged release of `github.com/notofonts/latin-greek-cyrillic` (unhinted TTF); record the
  release URL and SHA-256 in `deploy/third-party/noto-sans/README.md`, whose `OFL.txt` covers it
- Modify: `apps/server/src/invoice-font.ts`, `apps/server/src/invoice-page.ts` (element types only),
  `apps/server/src/invoice-pdf.ts`, `apps/server/src/invoice-raster.ts`,
  `scripts/deploy-image-env.test.ts` (the noto-sans block names both files), the image copy step if
  it lists asset files by name (`deploy/Dockerfile`)
- Test: `apps/server/src/invoice-pdf.test.ts`, `apps/server/src/invoice-raster.test.ts`

**Interfaces:**
- Produces: `invoiceBoldFontBytes: Buffer`, `invoiceBoldFont: Font` from `invoice-font.ts`.
  `PageText` gains `weight: "regular" | "bold"` and `tone: "ink" | "muted"` (replacing `bold:
  boolean`); new element `PageBox = { kind: "box"; x: number; y: number; width: number; height: number; fill: "heading" | "panel" }`.
  `invoiceTextWidth(text, size, weight?)` measures with the matching font. The PDF registers the bold
  face under its own name; the raster draws bold glyph outlines without the old stroke.

- [ ] **Step 1: Write the failing tests:** a PDF containing one bold text element embeds a font whose
  name contains `Bold` (read the font list with pdfjs); the regular text's font does not; a muted
  element's text is drawn in `#6b6b6b`; a `box` element draws a filled rectangle of the given colour
  (sample the rendered canvas pixel); the raster's bold "TOTAL" covers more ink than the regular one
  and the box pixel reads the greyscale value of `#e4e4e8`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/invoice-pdf.test.ts src/invoice-raster.test.ts` — the new cases FAIL.
- [ ] **Step 3: Implement.** Existing layout code maps its old `bold: true` to `weight: "bold"`.
- [ ] **Step 4: Run** both files and `scripts/deploy-image-env.test.ts` — PASS; typecheck; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Draw invoice pages with a real bold face, muted text and shaded boxes"`.

### Task 6: Split the receipt builder into facts and thermal placement

No behaviour change for any surface. The existing receipt, receipt-print, till-preview and A4 suites
are the guard and must pass unedited.

**Files:**
- Create: `apps/server/src/receipt-facts.ts`, `apps/server/src/receipt-facts.test.ts`
- Modify: `apps/server/src/receipt-document.ts` (`buildReceiptDocument` = `thermalPlacement(receiptFacts(input), input)`)

**Interfaces:**
- Produces: `receiptFacts(input: ReceiptDocumentInput): ReceiptFacts` with, at least:
  - `practice: { warning: string; noRealCharge?: string } | undefined`
  - `qr: { text: string; caption?: string; legend?: string } | undefined`
  - `letterhead: { tradingName?: string; headerSubtitle?: string; legalName: string; nifLine: string; contact: string[]; domicile?: string }`
  - `band: { title: string; corrective: boolean; duplicate?: string; number: string; date: { label: string; value: string }; saleDate?: { label: string; value: string }; orderLabel?: string; order?: { label: string; value: string }; takeAway?: string }`
  - `corrects?: { line: string; number: string; date: string; rectification?: { label: string; amount: string } }`
  - `customer?: { heading: string; name: string; idLine: string; address: string; country: string }`
  - `rows: FactRow[]` where `FactRow = { units: string; item: string; indent: number; unitPrice: string; amountExVat: string; rate: string; chargedWithVat: string; kind: "line" | "option" | "answer" | "discount" | "advance" }`
    (`chargedWithVat` is the row's VAT-included charge: a line's `gross`, a discount's VAT-included
    amount, a whole-bill discount's share at that rate; an answer row has empty amounts)
  - `vat: { rate: string; base: string; tax: string; total: string }[]`, `total: string`
  - `payment: PaymentFacts` — `{ paid: boolean; lines: string[]; owed?: string; deferred?: { account: BankAccount | null } }` (deferred stays `undefined` in this task; Task 7 fills it)
  - `guests?: string`, `footerMessage?: string`, `labels: ReceiptLabels`, `simplified: boolean`

- [ ] **Step 1: Write the failing tests** in `receipt-facts.test.ts` on `FULL_INVOICE_DOCUMENT_FIXTURE`:
  rows' `chargedWithVat` are `12,10 €`, `−1,21 €`, `8,80 €`, their sum equals `total`; `vat` has the
  21 % and 10 % rows with totals `10,89 €` and `8,80 €`; `payment.paid` is true and `lines` contain
  the cash and change; and a whole-bill discount split across 21 % and 10 % (build it inline from the
  fixture with a `billAdjustments` entry) still sums to `total`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/receipt-facts.test.ts` — FAIL.
- [ ] **Step 3: Implement** by moving the computations out of `buildReceiptDocument`, keeping its
  output identical. Where a whole-bill discount's VAT-included share is not stored, derive it from the
  split `invoiceDiscounts` produces so that the shares add up to the discount's VAT-included amount;
  put any rounding cent on the largest share.
- [ ] **Step 4: Run** `receipt-facts.test.ts` and, unedited, `receipt-ticket.test.ts`,
  `receipt-print.test.ts`, `receipt-language.test.ts`, `till-receipt-preview*.test.ts`,
  `invoice-pdf.test.ts`, `invoice-raster.test.ts` — PASS; typecheck; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Gather a receipt's facts once, before placing them"`.

### Task 7: Deferred-payment instructions on the till receipt

**Files:**
- Create: `apps/server/src/receipt-deferred-payment.ts`, `apps/server/src/receipt-deferred-payment.test.ts`
- Modify: `packages/country/src/country.ts` and `packages/country-es/src/receipt-labels.ts` (new keys,
  all five languages), `apps/server/src/receipt-document.ts` (input field; thermal placement),
  `apps/server/src/receipt-facts.ts`, `apps/server/src/invoice-document.ts` (`readDocument`),
  `apps/server/src/receipt-print.ts` (`readPrintedVenue` / `buildReceiptBytes`),
  `apps/server/src/receipt-presentation.ts` (`readReceiptPresentation`), `apps/server/src/till-receipt-preview.ts`

**Interfaces:**
- Consumes: Task 2's `readBankAccount`; Task 6's `PaymentFacts`.
- Produces:
  - `readDeferredPayment(tx: Transaction, saleId: string): Promise<{ account: BankAccount | null } | undefined>`
    — defined when this sale or a sale it replaces (recursive walk over `sales.corrects_sale_id`
    where `replaces_original`, and `sale_substitutions`, like `readSimulatedCardPayment`, but not
    through corrections by differences) has a `tenders` row with `method = 'deferred'`.
  - `ReceiptDocumentInput.deferredPayment?: { account: BankAccount | null }`, set at the three
    assembly points; `PaymentFacts.deferred` comes from it.
  - Labels: `paymentMethodHeading` ("FORMA DE PAGO"), `paid` ("Pagado"), `transferInstruction`
    ("Pagar por transferencia bancaria a la cuenta indicada, con referencia {number}."), `iban`
    ("IBAN"), `bankName` ("Banco"). English: "PAYMENT", "Paid", "Pay by bank transfer to the account
    below, quoting {number}.", "IBAN", "Bank". The Catalan, Galician and Basque values are written in
    those languages.

- [ ] **Step 1: Write the failing tests.**
  - `receipt-deferred-payment.test.ts` (`useVenueDb`): a deferred close → defined with the account;
    a replacement of it (no tender row) → defined; a substitution of it → defined; a correction by
    differences of it → `undefined`; a cash sale → `undefined`; no account saved → `{ account: null }`.
  - `receipt-ticket.test.ts` additions: 58 mm deferred receipt lines include `FORMA DE PAGO`,
    `Pago aplazado. Pagar por`, `IBAN:` alone, then `ES91 2100 0418 4502 0005 1332`, then
    `Banco: OPENBANK`; 80 mm has `IBAN: ES91 2100 0418 4502 0005 1332` on one line; deferred with
    `account: null` prints `Pago aplazado.` and no `IBAN`; a cash receipt's bytes are identical to
    before (compare against `apps/server/src/testing/full-invoice-58mm.bin` / `-80mm.bin` fixtures
    where those cover it).
  - Till preview: the deferred preview contains the same lines.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them plus `packages/country-es/src/spain.test.ts` — PASS; typecheck; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Print bank-transfer instructions on deferred bills' receipts"`.

### Task 8: A4 layout — page 1 header, band and customer

**Files:**
- Create: `apps/server/src/invoice-layout.ts`, `apps/server/src/invoice-layout.test.ts`

**Interfaces:**
- Consumes: Task 5's element types and `invoiceTextWidth`; Task 6's `ReceiptFacts`.
- Produces: `layoutInvoiceHeader(facts: ReceiptFacts, logo: ReceiptLogoRaster | null | undefined): { elements: InvoicePageElement[]; bottom: number }`
  — page 1's practice box (when present), QR block top-left (x = 36, 35 mm square, caption above,
  legend below, body size), letterhead right-aligned to the right margin (logo, trading name bold
  18 pt, subtitle, "legal name · NIF" line, wrapped domicile, contact), a 1.5 pt rule, the band
  (title bold 17 pt left; labelled pairs right: date, sale date, order label, order, take-away,
  duplicate tag), a 0.75 pt rule, the corrective line(s), and the customer panel (`box` fill
  `panel`, ~60 % width, muted heading, semibold name, id line, address · country). Body text 9 pt,
  labels 8 pt muted. A simplified invoice has no customer panel and its letterhead shows no
  domicile. With no trading name printed, the legal name takes the trading name's place and size.

- [ ] **Step 1: Write the failing tests** on element lists (no PDF needed): the QR element sits at
  x = 36 with size 99.2 and its caption above and legend below at the body size; with no logo and
  no trading name the first letterhead text is the legal name, bold, 18 pt, right-aligned; the band's
  title reads `Factura FF/1` (es) / the English label (en) and its pairs include the date; a corrective
  invoice's band title is the corrective heading and the line below names the corrected number and
  date; a long customer name wraps inside the panel and the panel's height grows with it; a
  simplified fixture has no `panel` box.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/invoice-layout.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; typecheck; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Lay out an A4 invoice's letterhead, band and customer"`.

### Task 9: A4 layout — table, summary, payment footer and pages

**Files:**
- Modify: `apps/server/src/invoice-layout.ts`, `apps/server/src/invoice-layout.test.ts`
- Labels: `packages/country-es/src/receipt-labels.ts` and `packages/country/src/country.ts` gain
  `descriptionColumn` ("Descripción"), `quantityColumn` ("Cant."), `unitPriceExVatColumn` ("Precio
  unit. sin IVA"), `totalExVatColumn` ("Total sin IVA"), `vatColumn` ("IVA"), `totalWithVatColumn`
  ("Total con IVA"), `continuedPage` ("{title} · {page}/{pages}"), all five languages

**Interfaces:**
- Produces: `layoutA4Invoice(input: ReceiptDocumentInput): InvoicePage[]` — the whole document:
  header (Task 8) on page 1; the table with a `heading`-filled heading row repeated on every page it
  reaches, a light rule under each row, indented muted discount/option/answer rows; full-invoice
  columns as the spec lists, simplified columns Descripción · Cant. · Precio · Importe (VAT
  included); the VAT summary table (Tipo · Base imponible · Cuota IVA · Total) right half, TOTAL bold
  18 pt under a 1.5 pt rule; guests line under TOTAL; the payment footer (`FORMA DE PAGO`; `Pagado ·
  …` when `payment.paid`; payment lines; owed in bold; deferred: `Pago aplazado. ` + instruction, then
  `IBAN: … Banco: …` on one line, or `Pago aplazado.` alone) above the department footer message at
  the foot of the last page; summary + TOTAL + footer move to a new page whole; pages after the first
  open with a muted `continuedPage` line.

- [ ] **Step 1: Write the failing tests** (element lists, plus one rendered PDF through
  `renderInvoicePdf` using `invoice-pdf.test.ts`'s `rendered()` approach): the fixture's
  "Total con IVA" cells read `12,10 €`, `−1,21 €`, `8,80 €` and sum to `19,69 €`; the whole-bill
  discount case from Task 6 sums to TOTAL; the paid footer reads `Pagado · Efectivo 20,00 € · Cambio 0,31 €`;
  an owed invoice's footer has no `Pagado` and a bold `Pendiente`; a deferred invoice's footer has the
  instruction and `IBAN: ES91 2100 0418 4502 0005 1332   Banco: OPENBANK` on one line; a deferred
  invoice with `account: null` has no `IBAN`; a 120-line invoice takes three pages, every page's
  table opens with the heading row, the QR appears once, pages 2 and 3 start with `Factura FF/1 · 2/3`
  and `· 3/3`, and TOTAL and `FORMA DE PAGO` are on the same page; no text element's right edge passes
  the right margin.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/invoice-layout.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS, plus `packages/country-es/src/spain.test.ts`; typecheck; format check.
- [ ] **Step 5: Commit** — `git commit -s -m "Lay out an A4 invoice's table, totals, payment and pages"`.

### Task 10: Switch the A4 page to the new layout

**Files:**
- Modify: `apps/server/src/invoice-page.ts` (`layoutInvoicePages` returns `layoutA4Invoice(input)`;
  delete the old walker and its helpers that nothing else uses), `apps/server/src/invoice-pdf.test.ts`,
  `apps/server/src/invoice-raster.test.ts`, and every suite that reads A4 text: `invoice-language.test.ts`,
  `invoice-document.test.ts`, `page-print-api.test.ts`, `invoice-delivery.test.ts`,
  `boot.invoice-delivery.test.ts`, `invoice-customer-data.pdfs.test.ts`,
  `invoice-customer-data-api.export.test.ts`, `scripts/receipt-look.test.ts`

Rewrite only assertions about the old placement (centred QR, single column, rules between sections,
"Precios sin IVA" note). Keep every behavioural assertion: QR size, level and decoding; QR on page 1
only; long names wrap and never truncate; table heading repeats across pages; the tax summary moves
whole; output is deterministic; each receipt language renders its own labels; the raster places text
where the PDF does. Name in the commit message each assertion rewritten and what replaced it.

- [ ] **Step 1: Switch** `layoutInvoicePages` and run `pnpm --filter @waitron/server exec vitest run src/invoice-pdf.test.ts src/invoice-raster.test.ts` — expect the placement assertions to FAIL.
- [ ] **Step 2: Rewrite** those assertions to the new placement; run — PASS.
- [ ] **Step 3: Run** the other listed suites; fix their text expectations; run — PASS.
- [ ] **Step 4: Typecheck**, format check, and confirm `rg -n "layoutInvoicePages|invoiceTextWidth" apps/server/src` shows no dead helper.
- [ ] **Step 5: Commit** — `git commit -s -m "Draw A4 invoices with the new layout"`.

### Task 11: Guides, decisions, and looking at the pages

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md` and `es` (Business card: the bank account;
  `{#deferred-payment}`: what the customer's invoice and receipt now say), `apps/server/src/guide/{en,es}/invoices.md`
  (one short paragraph on the A4 layout only if a staff action depends on it, else nothing),
  `apps/server/src/guide/{en,es}/staff.md` (the fresh-sign-in list gains the bank account),
  `docs/backlog/printers.md` → Decisions (owner, 2026-11-22: the A4 title and the venue's name are
  printed larger than the VERI\*FACTU caption), `docs/backlog/payments.md` beside A275 (deferred bills
  print bank-transfer instructions from the Business card's account; never on paid or merely owed
  invoices)

- [ ] **Step 1:** Write the guide and decision text; run `apps/server/src/guide-content.test.ts`,
  `guide-pages.test.ts`, `guide-markdown.test.ts`, `scripts/guide-links.test.ts` — PASS.
- [ ] **Step 2:** Render with `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts <scratch dir>`:
  the fixture invoice (paid), a deferred one with an account, a deferred one without, a corrective
  one, a simplified one, a three-page one, and a 58 mm and 80 mm deferred receipt. Open every PDF and
  PNG and look; compare against the mock-up the owner approved. Fix anything misplaced.
- [ ] **Step 3: Commit** — `git commit -s -m "Describe the bank account and deferred-payment instructions in the guides"`.
  Send the rendered pages to the owner.
