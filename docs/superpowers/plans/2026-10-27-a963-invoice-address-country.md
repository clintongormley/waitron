> **2026-10-28:** The [foreign-recipient rework plan](2026-10-28-a963-foreign-recipient-rework.md) supersedes the ES-only target below; the owner approved its accepted-identifier and recipient-builder scope on 2026-10-28. Completed tasks below are historical.

# A963 Invoice Address and Country Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task. Steps use checkbox (`- [ ]`) syntax. Lane E's driver implements after reading this artifact; unattended execution is already authorised. This author changes documentation only.

**Goal:** Store a complete recipient address without a country suffix, keep `countryCode: "ES"` separately, and print Spain's name in the receipt language.

**Architecture:** Spain owns address completeness and its translated country names through optional country-pack contracts. Selection validates new input; the shared receipt document adds presentation text without changing recorded address text. Thermal receipts, A4 raster and PDF share that document.

**Tech Stack:** TypeScript, country packs, Lit, Vitest/Chromium, SQLite via `useVenueDb`, ESC/POS, PDFKit and pdfjs.

**Spec:** Owner-accepted A963 in [backlog](../../backlog.md) and [architecture detail](../../backlog/architecture.md#a913s-fix-items-general-code-english-only), plus the Lane E planning instruction of 2026-10-27. No separate spec or approval loop.

## Global constraints

- Printed full-invoice text changes; no filed field changes. The eventual fiscal PR parks green for owner landing; never merge automatically.
- No migrations, backfill, compatibility parser, broader country support, fiscal writer changes or protected fiscal test/assertion edits. Leave taxpayer domicile, numbering, hashes, clock checks, payment and delivery decisions intact.
- A696's overlap waiver covers only unrelated timezone hunks in `country.ts`, `spain.ts` and `receipt-document.ts`; preserve both changes during integration. Respect A739's reserved paths; tracing a caller does not authorise editing it. Report an actual collision to the runner, without reopening general approval.
- General code and affected fixture data are English. Translated expected words come from pack values; Spanish receipts use `es-ES`, `ca-ES`, `gl-ES` or `eu-ES`, never English. English remains available for screens.
- Before code or test edits, read the TDD skill. Each task gets a focused failing behavioral test, observed expected failure, minimal implementation and observed pass. Record commands, exit statuses and nonzero test counts; reading source is not runtime evidence.
- Read `CLAUDE.md`, relevant developer topics (data, UI, Forms, testing, claims, workflow and gates). Keep form errors, draft scope, quiet unchanged Save, refusal recovery and delivery behavior.

## Source map and boundaries (read at `b83667f66`, not executed)

| Path | Observed responsibility / planned treatment |
| --- | --- |
| `packages/country/src/country.ts:122`; `packages/country-es/src/spain.ts` | Add the two optional contracts below; Spain supplies them beside `taxIdentifier`. Non-Spain packs need no edits. |
| `apps/server/src/invoice-selection.ts:20` | Replace the local suffix validator with Spain's pack contract; keep tax ID/name checks, country-code normalization and refusal codes. |
| `apps/server/src/working-order.ts:1561,1638,4219,4252` | Placement and `setOrderInvoiceChoice` validate then persist address/code separately. Exercise through existing entry points; no production changes planned here. |
| `apps/server/src/invoice-selection.ts:128`; `till-sale.ts`; `bill-payments.ts` | Stored F1 selection revalidates before issuance and passes `recipientAddress` separately from counterparty. Preserve pre-numbering refusal and all sale/payment gates. |
| `packages/core/src/record-sale.ts:260,323`; `counterparty.ts:33` | Core requires nonblank address and snapshots it verbatim; do not edit. Fiscal backend's `buildDestinatarios` (`backend.ts:709` in fiscal-verifactu) files name/NIF, refuses foreign recipients and does not consume address. |
| `apps/server/src/receipt-issuer.ts:7`; `transaction-receipt.ts:126,157` | Receipt/replay readers reconstruct recipient from sale snapshots, including address and code. Keep raw values. |
| `apps/server/src/invoice-document.ts:129–145` | Already builds `ReceiptDocumentInput` with saved locale, country code and `counterpartyAddress`; no second country formatter needed here. |
| `apps/server/src/receipt-document.ts:233`; `receipt-ticket.ts:66` | Shared customer block feeds thermal drawing. Add country presentation here, preserving snapshot text. |
| `apps/server/src/invoice-page.ts:113`; `invoice-pdf.ts:7`; `invoice-raster.ts` | A4 layout calls the same builder; PDF and raster consume its elements. Orders download, page-print, invoice email and customer-data export use these paths. |
| `apps/server/src/parties.ts:539`; `orders-list.ts:797,854`; `invoice-customer-data.ts:62` | Working-order summaries, management invoice detail and personal-data exports carry raw address/code. Do not append or rewrite here. |
| `apps/till/src/api/client.ts`; `till-app.ts:7392`; `screens/till-ticket-view.ts:766`; `apps/dashboard/src/widgets/order-detail-dialog.ts:389` | Wire types, pending-choice identity and screen displays retain the raw address. Wire types and identity comparisons need no changes; both address displays must show the separately resolved country so it does not disappear. |
| `apps/till/src/widgets/invoice-recipient-dialog.ts:252,279,477` | Uses five-digit regex, appends a literal country, displays a translated disabled country field. Change validation/composition and read country display from pack. |

Before changing field meaning, repeat `rg -n 'recipientAddress|counterpartyAddress|recipient_address|counterparty_address' apps packages --glob '*.ts' --glob '!**/drizzle/**'` and follow recipient-object address readers too. This map includes callers read during planning, not proof of their runtime outcomes.

## Exact contracts and decisions

- In `CountryPack`, add `readonly postalAddress?: { isComplete(address: string): boolean }` and `readonly countryNames?: Readonly<Record<string, string>>`. No mandatory additions or new dependencies.
- Move `completeSpanishPostalAddress(address: string): boolean` into `packages/country-es/src/spain.ts`; expose it through `SPAIN.postalAddress.isComplete`. Retain the function's responsibility, changing its input shape to country-free text.
- New shape: split on commas and trim segments; last segment is nonblank province, penultimate matches `/^\d{5}\s+\S/u`, all preceding street segments are nonblank, and at least one street segment exists. Trim only outer whitespace on selection; preserve internal text/commas. Example: `Main Street, 2, 28013 Madrid, Madrid`.
- Explicit postcode choice: server completeness remains five digits, including `00000` and `99999`; do not call Spain's stricter `postalCode.validate` there or add province membership/matching. Till field validation **does** use `SPAIN.postalCode.validate`, rejecting those two values and preserving its existing inline-error flow. Test this deliberate difference.
- `checkedInvoiceRecipient` continues to use the ES pack, not the request's arbitrary country. Keep current validation precedence, normalized NIF, name-length counting, `management.request_invalid` for malformed code and `fiscal.foreign_recipient_unsupported` for a well-formed non-ES code with otherwise valid input. No old-format selection support.
- Spain's `countryNames` also provides the existing screen aliases `en` and `es`. Its canonical map: `en-GB: "Spain"`, `es-ES: "España"`, `ca-ES: "Espanya"`, `gl-ES: "España"`, `eu-ES: "Espainia"`. Till uses `currentLocale()` with `en-GB` fallback, matching `t()`'s screen fallback; avoid duplicate new country literals in general code.
- Receipt country resolution uses the requested locale only if it belongs to the recipient pack's `invoiceLocales`; otherwise use that pack's `defaultLocale`. Missing translation falls back to the default entry; absent pack/contract/name falls back to the country code. For Spain, unknown, bare `es` and `en-GB` therefore use `es-ES`, consistent with the currently read `receiptLabelsFor` fallback. Do not add English to Spain's receipt choices or change sibling receipt-label behavior.
- Render `result.recipient.address` exactly as stored, then a separate country element resolved from its country code, regardless of address shape. No old-format detector or stored rewrite. Existing arbitrary/suffixed snapshot text remains raw; it also gains the separate country line. The shared thermal presentation captures (`full-invoice-58mm.bin`, `full-invoice-80mm.bin`) change for that added line, with their exact comparisons retained. These are printer presentation baselines; protected fiscal hash/chain golden data and assertions remain untouched.
- Add registry helpers `countryNameFor(countryCode: string, locale: string): string` for screens (exact locale, English screen fallback, pack default, then code) and `receiptCountryNameFor(countryCode: string, locale: string): string` (restrict locale to pack invoiceLocales before resolving the name). Unknown or unlabelled packs show their code. Test all fallbacks. Till ticket uses receipt language; dashboard detail uses screen language.

## Review focus

Street commas/empty segments; selection versus arbitrary recorded text; ES-only tax/country refusals; screen versus receipt fallback; stored-order issuance and all rendering surfaces. The tests below cover each, including positive controls.

### Task 1: Move completeness into Spain and keep selection boundaries

**Files:** Modify the two country files and `apps/server/src/invoice-selection.ts`; extend `packages/country-es/src/spain.test.ts`, `apps/server/src/invoice-selection.test.ts`, `bill-payments-api.test.ts`, `till-sale-integrated.db.test.ts`. Existing `country`/`country-packs` tests check optional-pack consumers. The dashboard adds its declared browser-safe country-packs dependency and regenerated lockfile.
**Interfaces:** Produce the two optional pack fields above; `checkedInvoiceRecipient` keeps its existing signature and returns the same object keys with country-free address.

- [x] RED: Add `accepts country-free complete addresses` and `rejects incomplete country-free addresses`: assert true for `Main Street 2, 28013 Madrid, Madrid` and `Main Street, 2, 28013 Madrid, Madrid`; false for blank, street only, missing province, postcode without locality, 4/6 digits, blank street segment and blank province. Assert five-digit `00000`/`99999` remain server-complete and old suffixed input is refused at selection.
- [x] RED: Add stored-order cases to `invoice-selection.test.ts`: country-free recipient selected verbatim, ES retained, full series selected, series counters unchanged. Keep/add lowercase `es`, invalid NIF checksum, missing/malformed code, FR refusal, name cap and address refusal assertions, with unchanged domain codes and no numbering on refusal.
- [x] Run `pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts --reporter=dot` and `pnpm --filter @waitron/server exec vitest run src/invoice-selection.test.ts --reporter=dot` separately. Expect new completeness API absent / country-free address refused, not fixture setup failures.
- [x] Implement only the pack contracts, moved completeness function and delegation. Update affected request/working-order fixtures and authorized assertions from the inventory below to country-free English data.
- [x] GREEN: Repeat both commands, then `pnpm --filter @waitron/server exec vitest run src/bill-payments-api.test.ts src/till-sale-integrated.db.test.ts --reporter=dot`. Exercise placement and invoice-choice writes plus subsequent stored selection; assert raw address and ES persist, missing province/empty street still refuse without revision changes. Keep money/fiscal record assertions.
- [x] Driver records RED/GREEN evidence and makes a signed-off commit with `git commit -s`; never bypass hooks.

### Task 2: Compose the till recipient without a country suffix

**Files:** Modify `apps/till/src/widgets/invoice-recipient-dialog.ts`; extend its `.test.ts` and `.unsaved.test.ts`; run existing `.save-state.test.ts` and `.a11y.test.ts`.
**Interfaces:** Consume pack names/postcode validator; emit the unchanged `InvoiceRecipientDetail` shape with `address: "Main Street 1, 28013 Madrid, Madrid"`, `countryCode: "ES"` and normalized tax ID.

- [x] RED: In EN/ES, assert identical emitted country-free address and ES, pack-derived disabled country display, correct trimming and preservation of a comma within street. Assert `00000`, `99999` and four digits show `t("invoice.postal_code_invalid")`, bottom correction message and disabled Save after an attempt; `28013` recovers and sends once. Restore screen locale after each case.
- [x] Run `pnpm --filter @waitron/till exec vitest run src/widgets/invoice-recipient-dialog.test.ts src/widgets/invoice-recipient-dialog.unsaved.test.ts --reporter=dot`; observe suffix/validator failures.
- [x] Remove suffix from composition, use pack postcode validation and pack country display. Preserve tax checks, field names, draft comparison, completion handling and delivery choice. No changes to `till-app.ts` or payment widgets. Add separate country text in till-ticket-view and dashboard order-detail-dialog, with tests for English/Spanish screens and differing receipt language.
- [x] GREEN: Repeat the command, adding `src/widgets/invoice-recipient-dialog.save-state.test.ts src/widgets/invoice-recipient-dialog.a11y.test.ts`; retain newer-edit/commit, cancel, refusal and delivery assertions. Driver commits with `git commit -s`.

### Task 3: Render the country once through the shared document

**Files:** Modify `apps/server/src/receipt-document.ts`; extend `receipt-document.test.ts`, `receipt-ticket.test.ts`, `invoice-pdf.test.ts`, `invoice-document.test.ts`. No second formatter in PDF, raster or raw readers. Update the two captured printer presentation binaries only for the deliberate added country line; retain exact byte comparisons.
**Interfaces:** Consume recipient code, raw address and `invoiceLocale` already in `ReceiptDocumentInput`; add one country text element independently of address shape.

- [x] RED: Add `country-free recipient country follows receipt language`, parameterized over all four Spain receipt locales, plus unknown/bare/English fallback. Use English address/name fixtures and `getCountryPack("ES")!.countryNames` for translated expectations. Assert one country element after unchanged address, F2 unaffected and input deeply unchanged.
- [x] RED: Add arbitrary snapshot, old-suffixed snapshot, unknown country and pack-without-optional-contract controls; assert address text unchanged and a separately appended country. Keep `readInvoiceDocument`'s `Saved customer address` assertion and add saved valid-shape/code/locale round trip, independent of current venue data.
- [x] RED: Thermal tests decode actual `formatReceipt` output for 58/80 mm and four receipt locales. PDF tests call real `renderInvoicePdf` and extract text with existing pdfjs helper for the same locales plus stored English fallback; assert address then one pack country, no English country on Spanish receipts, and raw-snapshot controls. A4 layout assertion covers raster's shared input; retain wrapping, totals, QR and duplicate checks.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/receipt-document.test.ts src/receipt-ticket.test.ts src/invoice-pdf.test.ts src/invoice-document.test.ts --reporter=dot`; expect missing country in new tests before implementation.
- [x] Implement unconditional country presentation and locale fallback. GREEN: repeat that command. Use dedicated English fixtures for new cases; leave existing shared golden fixture/binary baselines untouched unless actually affected, in which case inventory every changed check before changing it. Driver commits with `git commit -s`.

## Original assertion inventory (owner 2026-10-05 authorisation)

Record each actual before/after check in the PR's **Changed test checks**. Change only the address representation/affected English fixture text; never weaken a behavioral check or replace exact equality with partial matching.

| Existing check | Required change and preserved assertion |
| --- | --- |
| `invoice-selection.test.ts:149–160`; `till-sale-integrated.db.test.ts:617–624` | Full-series selection and saved F1 equality: remove country suffix, use English customer/street; retain ES, normalized tax ID, counters, no money and no filing. |
| `bill-payments-api.test.ts:2534,2565–2569,2573–2625` | Stored/canonical address equality and comma-street acceptance become country-free English. The old rejection case `Calle Mayor 2, 28013 Madrid, Madrid` becomes a positive control; replace missing-country refusal with missing-province refusal, retaining status/code and unchanged revision/F2 assertions. Retain all other incomplete-shape classes in the new representation. |
| Till `invoice-recipient-dialog.test.ts:33,107,151–156,210`; `.unsaved.test.ts:149–158` | Display expectation reads pack name; emitted/submitted address loses suffix and affected personal/street fixture text becomes English. Preserve tax normalization, ES, save counts, draft/close and delivery equality. |
| `invoice-document.test.ts:277,921` | Request fixtures become country-free English; raw snapshot return assertions, especially `:147` (`Saved customer address`), stay raw. |
| Remaining incoming/stored-choice fixtures | In server tests `bill-payments`, `bill-payments-api`, `bill-payments.issue-clock`, `boot.invoice-delivery`, `counter-handover`, `invoice-choice-delivery`, `receipt-adjustments`, `simplified-limit`, `till-api.profile-zones`, `unpaid-departure`, `unpaid-invoice-delivery`: update only affected recipient fixtures and paired equalities; retain money, date, numbering, refusal and rollback assertions. These names have `.test.ts` suffixes. |
| Recorded-only fixtures | `orders-api.test.ts:288,333`, `invoice-lookup-api.test.ts:44`, shared full-invoice address fixture stays raw; the two printer presentation binaries gain the separate country line. Keep recorded arbitrary/suffixed text raw; if an affected fixture is edited, make its data English and record paired textual assertions without changing its behavioral purpose. |

### Task 4: Finish validation, documentation and park

- [x] Run every affected fixture suite from the inventory, using `pnpm --filter @waitron/server exec vitest run <explicit changed test paths> --reporter=dot`; investigate failures rather than broadening input acceptance. Run country/country-packs consumer suites with `pnpm --filter @waitron/country test` and `pnpm --filter @waitron/country-packs test` separately.
- [x] Run unedited fiscal gates: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts --reporter=dot`. Require nonzero passing counts; do not edit protected writers, these suites, their fixtures or fiscal assertions to get green.
- [x] Once final code is stable, inspect the recipient dialog visually once across EN/ES × light/dark × 390/1280 widths. Use the existing real-browser widget harness; if a dev stack is needed start only through `wa-wt demo <registered-A963-worktree-name>`; use the workspace/browser workflow, record screenshots and inspect focus/errors/disabled country/Save. Inspect thermal and A4/PDF outputs for wrapping and country placement. Check browser headroom before tests; stop only owned PIDs.
- [x] Update `apps/server/src/guide/en/table-service.md` and its Spanish twin under the existing `{#full-invoice}` heading: address fields, Spain-only choice and country printed in receipt language. Audit prose consumers across the full branch diff; historical documents receive dated pointers, not rewritten history. No legal-sufficiency claim or web research.
- [x] Only after built and verified, remove A963's own paragraph from `docs/backlog.md`; move its completed architecture-detail decision under that area's **Decisions and deliberate limits** if still needed. Leave A964–A977 and other paragraphs alone. Do not remove A963 during plan authorship.
- [x] Announce readiness for `finish-branch`, then the authorised driver runs it: initial rebase/integration preserving A696 hunks; one Claude run-it whole-branch review via `claude-seat.sh review-run` in a throwaway complete checkout with dependencies installed; read completed findings and fix verified issues. One review is not repeated solely for a later rebase.
- [ ] Signed-off commits, normal pre-push hook once, scoped current-head CI package coverage/merge checks and required checks all green; no blanket local workspace run and no hook bypass. Check CI selects affected consumers. Park the PR for the owner with printed-text/no-filed-field scope, changed checks, executed evidence and any genuine remaining blocker. Do not land it.
