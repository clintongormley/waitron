# A4 invoice layout and bank-transfer instructions — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the A4 invoice the layout the owner chose (letterhead header, six-column table, VAT
summary, payment footer), and print bank-transfer instructions on deferred-payment bills on A4 and on
the till receipt, from a new bank-account setting whose changes are emailed to administrators.

**Architecture:** The receipt builder (`apps/server/src/receipt-document.ts`) is split into a
fact-gathering stage, holding raw values, and the thermal placement stage, which formats; a new A4
layout reads the same facts and places them in regions. PDF and office-printer rendering keep drawing
whatever the layout emits, gaining a real bold face, a muted colour and a shaded box. The bank account
lives in the core `settings.venue` document, is edited on the dashboard's Business card behind a fresh
sign-in, and a change queues a `box_alert` email to every `system.manage` holder.

**Tech stack:** TypeScript, PDFKit 0.20.2, fontkit 2.0.4, sharp, Hono (server routes), Lit
(dashboard), Vitest (node and browser modes), drizzle on node:sqlite.

**Spec:** `docs/superpowers/specs/2026-11-22-a4-invoice-layout-design.md` — read it before any task.
Worktree `/Users/clintongormley/workspace/worktrees/waitron-a4-invoice-layout`, branch
`a4-invoice-layout`. Plan reviewed once by a fresh-context reviewer on 2026-11-22; its findings are
folded in below.

## Global Constraints

- The QR stays first on page 1 only, 35 mm square, level M, decodable to the filed text, «QR
  tributario:» above it and VERI\*FACTU below it, both at body text size, with its four-module quiet
  zone clear of every other element.
- Bank details print only when the bill, or the sale it replaces (followed back through replacements
  and substitutions, not corrections by differences), was closed as a deferred payment. Deferred wins:
  such an invoice shows the instructions and neither "Pagado" nor an owed amount.
- "Pagado" prints only when the sale has a payment of its own (a `payments` list or a cash/card
  `tender`) and nothing is owed. With no payment of its own and not deferred, the footer lists only
  refunds, and is left out when it would be empty.
- Every A4 "Total con IVA" column adds up to TOTAL exactly, by construction (Task 6a's definition).
- Thermal receipts change only on deferred bills, and stay byte-identical otherwise.
- Wording comes from the spec. Tests never spell Spanish words: they read expected text from
  `receiptLabelsFor(locale)`, the email word tables and the dashboard strings, as
  `apps/server/src/deferred-close.test.ts:266` does. `scripts/english-only.test.ts` runs in every task
  that adds tests.
- An IBAN is stored without spaces, uppercase, printed in groups of four; masked as its first four
  and last four characters with every other character `•`, then grouped in fours.
- Bank-account changes: `venue.configure` plus a fresh sign-in, an activity entry with `data: {}`, and
  a `box_alert` email per `system.manage` holder with an email, which survives a restart.
- Language files: receipt words in `packages/country-es/src/receipt-labels.ts` (five blocks: en-GB,
  es-ES, ca-ES, gl-ES, eu-ES); dashboard strings in `apps/dashboard/src/i18n/strings.ts` (en, es);
  email words in `apps/server/src/i18n/box-emails.ts` (en, es).
- PDF colours: ink `#000000`, muted text `#6b6b6b`, table heading fill `#e4e4e8`, customer panel fill
  `#f2f2f4`. These are print colours inside the PDF, not dashboard chrome. PDFKit carries a fill colour
  over to later drawing, so **every drawn element sets its own colour**.
- Coverage 98/98/98/95 per package; `shared` has a mutation floor of 90.
- Every implementer's verify step includes `pnpm exec prettier --check` on the changed files and the
  touched packages' typecheck. Focused tests only; no whole-workspace runs. Commit with
  `git commit -s`; a commit message rewriting an existing test assertion names it and what replaced it.
- Implementers are dispatched as `subagent_type: "implementer"`. An implementer past about 150 calls
  with its task unfinished stops at a passing or cleanly red point, commits, and returns a handover.

## Review Focus

1. A deferred bill later replaced after an AEAT refusal (no tender row, possibly `owed` set): the
   replacement's A4 page and receipt show the instructions and no "Pagado"/owed — Task 7's
   end-to-end tests through `readDocument` and `buildReceiptBytes`.
2. "Total con IVA" across discounts over extras at another rate, a full comp, advances, unfiled
   dishes and a bill discount split over two rates — Task 6a sums over the existing builder cases.
3. A three-page invoice whose totals block is forced onto a new page — Task 9.
4. A venue with no logo and no trading name printed — Task 8.
5. A reprint after the bank account is cleared, and an account with no bank name — Tasks 7 and 9.

---

### Task 1: IBAN helper, and record the owner's decisions

**Files:**
- Create: `packages/shared/src/iban.ts`, `packages/shared/src/iban.test.ts`
- Modify: `packages/shared/src/index.ts` (export); `docs/backlog/printers.md` → Decisions and
  deliberate limits (owner, 2026-11-22: the A4 invoice's title and the venue's name are printed larger
  than the VERI\*FACTU caption, beside the 2026-10-14 TOTAL entry); `docs/backlog/payments.md` beside
  A275's entry (deferred bills print bank-transfer instructions from the Business card's account,
  never on paid or merely owed invoices; changes need a fresh sign-in and email administrators)

**Interfaces:**
- Produces:
  - `normalizeIban(raw: string): string` — removes all whitespace, uppercases.
  - `ibanProblem(iban: string): "format" | "checksum" | undefined` — on a normalized value. Format:
    two letters, two digits, then 11–30 letters or digits (15–34 in all); `ES` exactly 24. Checksum:
    ISO 7064 mod-97 equals 1 (use `BigInt` or chunked folding; a 34-character IBAN overflows a number).
  - `ibanGroups(iban: string): string[]` — groups of four; the last may be shorter.
  - `maskIban(iban: string): string`.

- [ ] **Step 1: Write the failing tests:** `normalizeIban(" es91 2100 0418\t4502 0005 1332 ")` →
  `"ES9121000418450200051332"`; `ibanProblem` gives `undefined` for that and for
  `"DE89370400440532013000"` and the 31-character `"MT84MALT011000012345MTLCAST001S"`, `"checksum"`
  for `"ES9121000418450200051333"`, `"format"` for a 22-character ES value, for
  `"9121000418450200051332"` and for `"ES9I21000418450200051332"`; `ibanGroups` of the ES value is
  `["ES91","2100","0418","4502","0005","1332"]`; `maskIban` gives `"ES91 •••• •••• •••• •••• 1332"`
  and `"DE89 •••• •••• •••• ••30 00"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/shared exec vitest run src/iban.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Write the two decision entries.
- [ ] **Step 4: Run** it — PASS; `pnpm --filter @waitron/shared typecheck`; prettier on the two
  source files; `pnpm --filter @waitron/shared mutation` if run time allows, else note it for CI.
- [ ] **Step 5: Commit** — `git commit -s -m "Check and format IBANs; record the owner's invoice decisions"`.

### Task 2: Bank account setting and its save route

**Files:**
- Modify: `packages/db/src/venue-settings.ts` (`bankAccount: BankAccount | null`, default `null`,
  parsed), `packages/db/src/venue-settings.test.ts`, `packages/db/src/activity-kinds.ts`,
  `apps/server/src/venue-settings-api.ts`, `apps/server/src/venue-detail-types.ts` and the
  `readVenueDetails` reader, `packages/diagnostics/src/path-patterns.ts`,
  `packages/provisioning/src/index.ts`, dashboard test fixtures typed `VenueDetailsModel` (add
  `bankAccount: null`)
- Create: `packages/provisioning/src/bank-account.ts`, `packages/provisioning/src/bank-account.db.test.ts`,
  `apps/server/src/venue-bank-account-api.test.ts`

**Interfaces:**
- Consumes: Task 1's `normalizeIban`, `ibanProblem`.
- Produces:
  - `type BankAccount = { iban: string; bankName: string | null }` exported from `@waitron/db`.
  - `saveBankAccount(tx: Transaction, change: { expected: { iban: string; bankName: string }; iban: string; bankName: string; personId: string }): Promise<{ saved: boolean; activityId?: string; before: BankAccount | null; after: BankAccount | null }>`
    — `expected` holds the stored values (`""` for none); a mismatch on either returns `saved: false`
    and writes nothing. Empty `iban` clears the account. A non-empty `iban` is normalized and checked:
    a problem throws `AppError("venue.detail_invalid", { field: "iban", reason })`. `bankName` is
    NFC-trimmed, empty → `null`; a bank name with no IBAN is refused `{ field: "iban", reason: "required" }`.
    An identical save throws `{ field: "iban", reason: "unchanged" }`. Saves through `saveSettings`
    with `expectedRevision` (which writes its own `settings.saved` entry) and records
    `"venue.bank_account_changed"` with subject `settings` and `data: {}`, returning its id.
  - `readBankAccount(tx: Transaction): Promise<BankAccount | null>`.
  - `PUT /management-api/venue-details/bank-account`, body `{ iban: string; bankName: string; expected: { iban: string; bankName: string } }`,
    other keys refused as `taxpayerFieldRequest` refuses them; `gated(...)` with `venue.configure`
    then `requireFreshManagementSignIn`; `saved: false` → `venue.detail_changed`; answer
    `{ model: await readVenueDetails(tx, now) }` with `bankAccount: BankAccount | null`.

- [ ] **Step 1: Write the failing tests.** `bank-account.db.test.ts` (`useVenueDb`): a spaced IBAN is
  stored normalized; a bad checksum is refused with reason `"checksum"` and nothing saved; an
  `expected` mismatch on the bank name alone returns `saved: false`; empty IBAN clears; blank bank
  name stored as `null`; a bank name without IBAN refused; one `venue.bank_account_changed` row with
  `data` `{}`; identical save refused `"unchanged"`. `venue-bank-account-api.test.ts`, modelled on
  `venue-legal-name-api.test.ts`: refused without `venue.configure`; `management_session.proof_required`
  when the proof is 15 minutes old; unknown body key refused; success answers the model.
- [ ] **Step 2: Run** `pnpm --filter @waitron/provisioning exec vitest run src/bank-account.db.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/venue-bank-account-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both — PASS; then `packages/db/src/venue-settings.test.ts`,
  `packages/db/src/settings.test.ts`, `apps/server/src/first-fiscal-setup.e2e.test.ts` (add a case: a
  saved bank account is not in a configuration export), `scripts/write-path-tables.test.ts`,
  `scripts/english-only.test.ts`, the diagnostics path-pattern test; typecheck db, provisioning,
  server, dashboard; prettier.
- [ ] **Step 5: Commit** — `git commit -s -m "Store the venue's bank account behind a fresh sign-in"`.

### Task 3: Email administrators when the bank account changes

**Files:**
- Modify: `apps/server/src/box-alert-email.ts` (code `"venue.bank_account_changed"` in `BoxAlertCode`;
  a `wordsFor` branch; `transientBoxAlertMail` exempts it as it exempts `upgrade.rolled_back`),
  `apps/server/src/i18n/box-emails.ts`, `apps/server/src/box-alert-mail.ts` (resolve the editor's name
  at claim), `apps/server/src/venue-settings-api.ts` (queue after a successful save, same transaction),
  `apps/server/src/boot.ts` (pass `venueLanguage` into `mountVenueSettingsApi`'s deps)
- Create: `apps/server/src/bank-account-mail.ts`, `apps/server/src/bank-account-mail.test.ts`

**Interfaces:**
- Consumes: Task 2's result, Task 1's `maskIban`.
- Produces: `queueBankAccountChangedMail(tx: Transaction, input: { editorId: string; at: string; offsetMinutes: number; before: BankAccount | null; after: BankAccount | null; venueLanguage: "en" | "es"; activityId: string; now: Date }): Promise<void>`
  — per recipient of `readManagerEmailRecipients(tx, venueLanguage)`: `enqueueMail` kind `box_alert`,
  `subjectId: null`, `dedupeKey: bank-account:${activityId}:${personId}`, `notAfter` from
  `MAIL_LIFETIME_MS.box_alert`, `params: { code, wording: JSON.stringify({ editorId, changedAt, changedAtOffset, previousAccount, newAccount }) }`
  with masked accounts or `null`. (Not `before`/`after`: those names are time placeholders in
  `TIME_PLACEHOLDERS`.)

Email words (Spanish; English in the en block): subject `Se ha cambiado la cuenta bancaria de
{venue}`; text `{editorName} cambió la cuenta bancaria que aparece en las facturas de pago aplazado
el {changedAt}.`, `Antes: {previousAccount}`, `Ahora: {newAccount}` (no account: `ninguna`), `Si no
reconoce este cambio, revíselo en Ajustes del local → Datos del local antes de emitir más facturas.`

- [ ] **Step 1: Write the failing tests** (`useVenueDb`): two `system.manage` holders with email and
  one without → two `box_alert` rows; claim + compose of one gives the subject with the venue name and
  a text containing the masked new account and never the full IBAN, and the editor's name; the
  `transientBoxAlertMail()` query does not return the row; the route test gains: a save queues the
  mail, a refused save queues none. Expected words read from the word table.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bank-account-mail.test.ts src/venue-bank-account-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; plus `box-alert-mail.test.ts`, `box-alert-email.test.ts`,
  `i18n/email-copy.test.ts`, `boot.box-emails.test.ts`, `scripts/personal-log-params.test.ts`,
  `scripts/english-only.test.ts`; typecheck; prettier.
- [ ] **Step 5: Commit** — `git commit -s -m "Email administrators when the bank account changes"`.

### Task 4: Business card row and bank-account dialog

**Files:**
- Modify: `apps/dashboard/src/screens/taxpayer-field-dialog.ts` (generic over the sent value: `TaxpayerFieldSettings<V = string>`
  with `send(api, value: V, expected: V)`; `field` widened; the empty-is-required check moves into the
  overridable `fieldErrors`, legal name and domicile keeping their behaviour),
  `apps/dashboard/src/screens/venue-details-panel.ts` (row `saved-bankAccount`, button
  `change-bank-account`, dialog mount, `TaxpayerField` and `withTaxpayerField`),
  `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client-routes.test.ts`,
  `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/venue-details-panel.test.ts`
- Create: `apps/dashboard/src/screens/bank-account-dialog.ts` and `.test.ts`, `.unsaved.test.ts`,
  `.a11y.test.ts`

**Interfaces:**
- Consumes: Task 2's route; Task 1's helpers.
- Produces: client `saveBankAccount(body: { iban: string; bankName: string; expected: { iban: string; bankName: string } }): Promise<{ model: VenueDetailsModel }>`;
  `<dashboard-bank-account-dialog>` with value type `{ iban: string; bankName: string }`.

Forms contract (`docs/developers/design-system.md` → Forms): IBAN (empty clears) and Bank (optional);
inline IBAN error for `format`/`checksum` from the shared check; Save disabled until the draft changes
or while invalid; the server's `venue.detail_invalid { field: "iban" }` lands under the IBAN field.
The row shows the IBAN in groups and the bank name, or `venue_details.unset`. Dialog note (en):
"Printed on invoices for bills closed as a deferred payment. Administrators with an email address
are told about every change." (es in the es block.)

- [ ] **Step 1: Write the failing tests**, modelled on `legal-name-dialog{,.unsaved,.a11y}.test.ts`:
  offered only when editable; prefill; a bad checksum shows the inline error and Save stays disabled;
  a valid change sends the IBAN without spaces, the bank name and both expected values; clearing the
  IBAN sends `""`; changed elsewhere shows the stale message; Escape/Keep/Discard; axe in both themes.
  Panel row reads the grouped IBAN and the bank. Client route test. Legal-name and registered-address
  dialog suites pass unedited.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/bank-account-dialog src/screens/legal-name-dialog src/screens/registered-address-dialog src/screens/venue-details-panel.test.ts src/api/client-routes.test.ts` — the new cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; typecheck; prettier; `scripts/native-form-fields.test.ts`, `scripts/english-only.test.ts`.
- [ ] **Step 5: Commit** — `git commit -s -m "Edit the bank account on the Business card"`.

### Task 5: Real bold, muted text and shaded boxes on the A4 renderers

**Files:**
- Add: `apps/server/src/assets/invoice-noto-sans-bold.ttf` — unmodified static `NotoSans-Bold.ttf`,
  version 2.015 (the regular face's version), from the `notofonts/latin-greek-cyrillic` release that
  ships it (unhinted TTF). Record the URL and SHA-256 in `deploy/third-party/noto-sans/README.md` and
  the Noto Sans section of `deploy/third-party/README.md`; the existing `OFL.txt` covers it.
- Modify: `apps/server/src/invoice-font.ts`, `apps/server/src/invoice-page.ts` (element types),
  `apps/server/src/invoice-pdf.ts`, `apps/server/src/invoice-raster.ts`,
  `scripts/deploy-image-env.test.ts`, `.github/workflows/image-smoke.yml` (the font check),
  `apps/server/src/testing/built-server.test.ts` (asset list). `deploy/Dockerfile` copies the whole
  assets folder and needs no change.
- Test: `apps/server/src/invoice-pdf.test.ts`, `invoice-raster.test.ts`; update `receipt-styles.test.ts`
  (asserts `bold:` and the stroke operators `0.35 w` / `2 Tr`) and `invoice-document.test.ts:1283,1312`.

**Interfaces:**
- Produces: `invoiceBoldFontBytes: Buffer`, `invoiceBoldFont: Font`. `PageText` gains
  `weight: "regular" | "bold"` and `tone: "ink" | "muted"` (replacing `bold: boolean`); new
  `PageBox = { kind: "box"; x: number; y: number; width: number; height: number; fill: "heading" | "panel" }`.
  `invoiceTextWidth(text, size, weight = "regular")`. The PDF registers the bold face under its own
  name; the raster draws bold outlines with no stroke. Every element sets its own fill colour.

- [ ] **Step 1: Write the failing tests:** a bold element embeds a font named with `Bold`, a regular
  one does not; a muted element is drawn `#6b6b6b`; a box draws its fill (sample the rendered pixel);
  **a QR, a rule, a logo and ink text drawn after a box and after a muted label are pure black**; in
  the raster, bold text covers more ink than regular and the box reads the grey of its fill.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/invoice-pdf.test.ts src/invoice-raster.test.ts` — the new cases FAIL.
- [ ] **Step 3: Implement.** The current walker maps its old `bold: true` to `weight: "bold"`.
- [ ] **Step 4: Run** them, `receipt-styles.test.ts`, `invoice-document.test.ts`,
  `apps/server/src/testing/built-server.test.ts`, `scripts/deploy-image-env.test.ts`,
  `scripts/ci-workflow.test.mjs` — PASS; typecheck; prettier.
- [ ] **Step 5: Commit** — `git commit -s -m "Draw invoice pages with a real bold face, muted text and shaded boxes"`.

### Task 6a: Gather a receipt's table, VAT and total figures as raw values

No behaviour change: every receipt surface stays byte-identical. The guard suites run **unedited**:
`receipt-document.test.ts`, `receipt-ticket.test.ts`, `receipt-print.test.ts`,
`receipt-language.test.ts`, `receipt-adjustments.test.ts`, `receipt-advances.test.ts`,
`adjustments-apply.test.ts`, `full-comp.fiscal-identity.test.ts`, `order-portions.adjustments.test.ts`,
`till-sale.test.ts`, `transaction-receipt-api.test.ts`, `receipt-styles.test.ts`,
`order-kitchen-note.receipts.test.ts`, `full-invoice-creation-date.test.ts`, `till-receipt-preview*.test.ts`,
`invoice-pdf.test.ts`, `invoice-raster.test.ts` (all under `apps/server/src`).

**Files:**
- Create: `apps/server/src/receipt-facts.ts`, `apps/server/src/receipt-facts.test.ts`
- Modify: `apps/server/src/receipt-document.ts` (the table, VAT and total sections read the facts)

**Interfaces:**
- Produces: `receiptFigures(input: ReceiptDocumentInput): ReceiptFigures` where
  - `ReceiptFigures = { simplified: boolean; sections: FigureSection[]; vat: { rate: Decimal; base: Decimal; tax: Decimal }[]; total: Decimal }`
  - `FigureSection` is either `{ kind: "filed"; rows: FiledFigureRow[] }` (one per printed table) or
    `{ kind: "withVat"; group: WithVatFigures }` (today's `withVatGroup` output for a simplified
    invoice or an unfiled dish: quantity text, name, VAT-included amount, rate letter, per-unit
    line, answers, options, adjustments), in today's print order, advances last.
  - `FiledFigureRow = { kind: "line" | "option" | "answer" | "discount" | "advance"; units: string; item: string; indent: number; unitPrice?: Decimal; amountExVat?: Decimal; rate?: Decimal; chargedWithVat?: Decimal }`
  - **`chargedWithVat`, exact by construction, per dish family and rate:** a line or option is
    `listGross ?? gross`; a discount row is the VAT-included amount of the adjustments it stands for;
    a whole-bill discount's share at a rate is what remains of Σ(`listGross ?? gross` − `gross`) at
    that rate after the rows' own discounts; an advance row is its line's `gross`. So the column sums to
    Σ `gross` = TOTAL.
  - Formatting stays in placement: the thermal table keeps `formatAmount`, money rows `formatMoney`.

- [ ] **Step 1: Write the failing tests** in `receipt-facts.test.ts`: on `FULL_INVOICE_DOCUMENT_FIXTURE`
  the `chargedWithVat` values are 12.10, −1.21, 8.80 and sum to `total`; and **a sum check over the
  existing builder cases**: import the inputs `receipt-document.test.ts` builds for a dish discount
  over extras at another rate, a full comp, advances taken off, records that could not be placed, an
  unfiled dish, `burgerAndBread` and a bill discount split over two rates (move those inputs into an
  exported `apps/server/src/testing/receipt-cases.ts` if they are local to the test), and assert for
  each that the filed rows' `chargedWithVat` plus the with-VAT sections' amounts sum exactly to `total`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/receipt-facts.test.ts` — FAIL.
- [ ] **Step 3: Implement**, moving computation out of `buildReceiptDocument` without changing output.
- [ ] **Step 4: Run** it and every guard suite above, unedited — PASS; typecheck; prettier;
  `scripts/english-only.test.ts`.
- [ ] **Step 5: Commit** — `git commit -s -m "Gather a receipt's figures as raw values before placing them"`.

### Task 6b: Gather the header, band, customer and payment facts

Same rule and the same unedited guard suites as 6a.

**Files:** Modify `apps/server/src/receipt-facts.ts`, `receipt-facts.test.ts`, `receipt-document.ts`.

**Interfaces:**
- Produces: `receiptFacts(input: ReceiptDocumentInput): ReceiptFacts = ReceiptFigures & {`
  - `labels: ReceiptLabels; locale: string; practice?: { noRealCharge: boolean }; testPage?: { printer: string }`
  - `qr?: { text: string; caption?: string; legend?: string }`
  - `letterhead: { tradingName?: string; headerSubtitle?: string; legalName: string; nif: string; domicile?: string; venueAddress: string[]; phone?: string; email?: string }` (raw parts; placement builds the lines)
  - `band: { invoiceNumber: string; issuedAt: string; issuedOffsetMinutes?: number; saleDay?: string; orderLabel: string | null; orderNumber: number; takeAway: boolean; duplicate: boolean }`
  - `corrects?: { invoiceNumber: string; issuedAt: string; issuedOffsetMinutes?: number; inFull: boolean }`
  - `customer?: { legalName: string; taxId: string; identifierType?: string; address: string; countryCode: string }`
  - `payment: { payments?: BillTenderLine[]; tender: TenderBlock; owed?: Decimal; deferred?: { account: BankAccount | null } }` (`deferred` stays undefined until Task 7)
  - `guests?: number; footerMessage?: string }`

- [ ] **Step 1: Write the failing tests:** facts of the fixture carry the customer, the band's number
  and order, the cash tender; a duplicate, a take-away, a sale day and a corrective input carry their
  facts.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**, thermal placement reading the facts. **Step 4:
  Run** it and every guard suite, unedited — PASS; typecheck; prettier; english-only guard.
- [ ] **Step 5: Commit** — `git commit -s -m "Gather a receipt's header, band and payment facts"`.

### Task 7: Deferred-payment instructions on the till receipt, wired for A4 too

**Files:**
- Create: `apps/server/src/receipt-deferred-payment.ts`, `receipt-deferred-payment.test.ts`
- Modify: `packages/country/src/country.ts` and `packages/country-es/src/receipt-labels.ts` (new keys,
  five languages), `apps/server/src/receipt-document.ts` (input field, thermal placement),
  `receipt-facts.ts`, `invoice-document.ts` (`readDocument`), `receipt-print.ts` (`buildReceiptBytes`,
  which has the sale id; `readPrintedVenue` does not), `receipt-presentation.ts`
  (`readReceiptPresentation`), `till-receipt-preview.ts`

**Interfaces:**
- Consumes: Task 2's `readBankAccount`, Task 6b's facts.
- Produces:
  - `readDeferredPayment(tx: Transaction, saleId: string): Promise<{ account: BankAccount | null } | undefined>`
    — defined when this sale or one it replaces (recursive walk over `sales.corrects_sale_id` where
    `replaces_original`, and over `sale_substitutions`) has a `tenders` row with `method = 'deferred'`.
  - `ReceiptDocumentInput.deferredPayment?: { account: BankAccount | null }`, set at the three assembly
    points; facts' `payment.deferred` comes from it.
  - Labels: `paymentMethodHeading`, `paid`, `transferInstruction` (with `{number}`), `iban`,
    `bankName`. Values per the spec: es "FORMA DE PAGO", "Pagado", "Pagar por transferencia bancaria a
    la cuenta indicada, con referencia {number}.", "IBAN", "Banco"; en "PAYMENT", "Paid", "Pay by bank
    transfer to the account below, quoting {number}.", "IBAN", "Bank"; ca, gl, eu written in those
    languages (the owner checks them on the rendered pages in Task 11).
  - Thermal, deferred only: heading, `{deferredPayment}. {transferInstruction}` wrapped, then on 58 mm
    `IBAN:` alone and the grouped number next, on 80 mm `IBAN: {number}`; then `Banco: {bank}` when a
    bank name is set. No account: `{deferredPayment}.` alone. Deferred wins over owed.

- [ ] **Step 1: Write the failing tests.** `receipt-deferred-payment.test.ts` (`useVenueDb`, using
  `testing/deferred-close-fixture.ts` and `testing/replacement-fixture.ts`): deferred close → defined
  with the account; its replacement → defined; its substitution → defined; a correction by
  differences → undefined; cash sale → undefined; no account → `{ account: null }`. **End to end:**
  `readDocument` for the replacement yields `deferredPayment` and its rendered A4 text has the
  transfer instruction and no `paid`/`owed` label; `buildReceiptBytes` for the deferred sale on 58 mm
  and 80 mm prints the lines above (expected text from `receiptLabelsFor`); deferred with no account
  prints no `IBAN`; a cash receipt's bytes equal `testing/full-invoice-58mm.bin` / `-80mm.bin`. Till
  preview of the deferred sale contains the same lines.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** them, `packages/country-es/src/spain.test.ts`, Task 6a's guard suites,
  `scripts/english-only.test.ts` — PASS; typecheck; prettier.
- [ ] **Step 5: Commit** — `git commit -s -m "Print bank-transfer instructions on deferred bills' receipts"`.

### Task 8: A4 layout — page 1 header, band and customer

**Files:** Create `apps/server/src/invoice-layout.ts`, `apps/server/src/invoice-layout.test.ts`.

**Interfaces:**
- Consumes: Task 5's elements and `invoiceTextWidth`; Task 6b's `ReceiptFacts`.
- Produces: `layoutInvoiceHeader(facts: ReceiptFacts, logo: ReceiptLogoRaster | null | undefined): { elements: InvoicePageElement[]; bottom: number }`:
  practice box at the top when `practice` is set (bordered, ink text); QR block top-left at x = 36,
  99.2 pt square, caption above and legend below at body size, quiet zone of four modules clear;
  letterhead right-aligned to x = 559.28: logo, trading name bold 18 pt (or the legal name there when
  no trading name prints), subtitle, `legal name · NIF` line, domicile wrapped (full invoices only),
  phone · email; a 1.5 pt rule; the band — title bold 17 pt (`invoiceHeading`/`correctiveInvoice` +
  number), muted 8 pt labels over 10 pt values for date, sale date, take-away, duplicate, and the
  order label as stored with `order` + number; a 0.75 pt rule; the corrective lines; the customer
  panel (`box` `panel`, about 60 % width, muted `customer` heading, bold name, id line, `address ·
  country`). Body 9 pt.

- [ ] **Step 1: Write the failing tests** on element lists, expected text from the labels: QR at
  x = 36, 99.2 pt, caption above, legend below, both body size, and no other element inside its quiet
  zone; no logo and no trading name → the first letterhead text is the legal name, bold, 18 pt,
  right edge at 559.28; band title is `invoiceHeading` + number; a corrective input's title uses
  `correctiveInvoice` and the line below names the corrected number; duplicate, take-away and sale-day
  inputs each add their pair; a long customer name wraps inside the panel and the panel grows; a
  simplified input has no panel and no domicile; a practice input puts its box above the QR.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/invoice-layout.test.ts` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** — PASS; typecheck; prettier; english-only guard.
- [ ] **Step 5: Commit** — `git commit -s -m "Lay out an A4 invoice's letterhead, band and customer"`.

### Task 9: A4 layout — table, summary, payment footer and pages

**Files:** Modify `apps/server/src/invoice-layout.ts`, `invoice-layout.test.ts`,
`packages/country/src/country.ts`, `packages/country-es/src/receipt-labels.ts` (new keys
`descriptionColumn`, `quantityColumn`, `unitPriceExVatColumn`, `totalExVatColumn`, `vatColumn`,
`totalWithVatColumn`, `continuedPage` "{title} · {page}/{pages}"; the VAT summary reuses
`taxRateColumn`, `taxBaseColumn`, `taxAmountColumn`, `taxTotalColumn`).

**Interfaces:**
- Produces: `layoutA4Invoice(input: ReceiptDocumentInput): InvoicePage[]` — page 1 header (Task 8);
  the table: `heading`-filled heading row repeated on each page it reaches, a light rule under each
  row, indented muted discount/option/answer rows; full-invoice columns as the spec lists (from
  `FiledFigureRow`), with-VAT sections as Descripción · Cant. · Precio · Importe (VAT included); the
  VAT summary right half, TOTAL bold 18 pt under a 1.5 pt rule; guests line under TOTAL; payment
  footer: heading; deferred → instructions, with `IBAN: … Banco: …` on one line or `IBAN: …` alone
  when no bank name, or `{deferredPayment}.` alone when no account; else `paid` + ` · ` + payment
  lines when the sale has a payment of its own and nothing owed; owed → payment lines and the owed
  amount bold; no payment of its own → refunds only, or no footer; then the department footer message,
  at the foot of the last page. Summary + TOTAL + footer move to a new page whole; pages after the
  first open with a muted `continuedPage` line.

- [ ] **Step 1: Write the failing tests** (elements, plus one PDF through `renderInvoicePdf` read with
  pdfjs as `invoice-pdf.test.ts`'s `rendered()` does): the fixture's "Total con IVA" cells read
  12,10 €, −1,21 €, 8,80 € and TOTAL 19,69 €; paid footer is `paid` + cash and change; owed has no
  `paid` and a bold owed row; deferred with account has the instruction and IBAN + bank on one line;
  deferred with no bank name has `IBAN:` and no bank label; deferred with no account has no `IBAN`; a
  full comp has no `paid`; a sale with no payment of its own and no refunds has no footer heading; a
  three-page invoice **whose row count is chosen so the last row ends less than the summary block's
  height above the page foot**: the summary, TOTAL and footer start the last page together, every page
  opens its table with the heading row, the QR appears once, pages 2 and 3 open with `continuedPage`;
  no element's right edge passes 559.28.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `spain.test.ts`; typecheck; prettier; english-only guard.
- [ ] **Step 5: Commit** — `git commit -s -m "Lay out an A4 invoice's table, totals, payment and pages"`.

### Task 9b: Move the A4 page's behavioural checks onto the new layout

**Files:** Modify `apps/server/src/invoice-layout.test.ts` (and `invoice-raster.test.ts` where it
renders through the layout).

Port, as tests of `layoutA4Invoice` / `renderInvoicePdf(layoutA4Invoice…)`, every behavioural check in
`invoice-pdf.test.ts` and `invoice-raster.test.ts` that does not depend on the old placement: QR
drawn size, level M and decoding to the filed text; QR on page 1 only; long names and contact parts
wrap and never truncate; table heading repeats; tax summary moves whole; output deterministic; the
width-memo bound (`INVOICE_TEXT_WIDTH_MEMO_LIMIT`); each receipt language renders its own labels; the
raster places text where the PDF does; logo drawn. List in the commit message each ported check and
its old test name.

- [ ] **Step 1: Port**; run `pnpm --filter @waitron/server exec vitest run src/invoice-layout.test.ts src/invoice-raster.test.ts` — PASS (the new layout already satisfies them; a failure is a Task 8/9 defect to fix here).
- [ ] **Step 2: Typecheck**, prettier, english-only guard. **Step 3: Commit** — `git commit -s -m "Check the new A4 layout for everything the old page was checked for"`.

### Task 10: Switch the A4 page to the new layout

**Files:**
- Modify: `apps/server/src/invoice-page.ts` (`layoutInvoicePages` returns `layoutA4Invoice(input)`;
  delete the old walker and helpers nothing else uses); `invoice-pdf.test.ts` (delete the old walker's
  placement tests now ported in 9b); and fix A4 text expectations in `invoice-raster.test.ts`,
  `invoice-language.test.ts`, `invoice-document.test.ts`, `page-print-api.test.ts`,
  `invoice-delivery.test.ts`, `boot.invoice-delivery.test.ts`, `invoice-customer-data.pdfs.test.ts`,
  `invoice-customer-data-api.export.test.ts`, `orders-invoice-pdf.test.ts`,
  `order-kitchen-note.receipts.test.ts`, `receipt-styles.test.ts` (it injects builder elements the A4
  page no longer reads: re-aim at `layoutA4Invoice` or the thermal surface), `page-test-page.test.ts`,
  `first-fiscal-document-download.e2e.test.ts`, `invoice-email.test.ts`, `page-print-agent-e2e.test.ts`
  (all `apps/server/src`), and `apps/server/scripts/receipt-look.test.ts`.

- [ ] **Step 1: Switch**, then run the listed suites; expect text-placement failures only.
- [ ] **Step 2: Fix** each expectation to the new layout; keep every behavioural assertion; run — PASS.
- [ ] **Step 3: Typecheck**, prettier; `rg -n "layoutInvoicePages|invoiceTextWidth" apps/server/src` shows no dead helper.
- [ ] **Step 4: Commit** — `git commit -s -m "Draw A4 invoices with the new layout"`, naming each rewritten assertion.

### Task 11: Guides, and looking at the pages

**Files:** `apps/server/src/guide/{en,es}/table-service.md` (the Business card's bank account; under
`{#deferred-payment}`, what the customer's invoice and receipt now say),
`apps/server/src/guide/{en,es}/staff.md` (the fresh-sign-in list gains the bank account).

- [ ] **Step 1:** Write the guide text (a sentence earns its place by changing what staff do); run
  `guide-content.test.ts`, `guide-pages.test.ts`, `guide-markdown.test.ts`, `scripts/guide-links.test.ts` — PASS.
- [ ] **Step 2:** Extend `apps/server/scripts/receipt-look.ts` to render: the fixture invoice (paid),
  deferred with account, deferred without, corrective, simplified, three-page, no-logo, and 58 mm and
  80 mm deferred receipts in es, en, ca, gl and eu. Run
  `pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts <scratch dir>`, open every PDF and
  PNG and look; compare with the approved mock-up; fix anything misplaced.
- [ ] **Step 3: Commit** — `git commit -s -m "Describe the bank account and deferred-payment instructions in the guides"`.
  The driver sends the rendered pages to the owner, asking them to check the ca/gl/eu wording.
