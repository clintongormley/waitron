# A963 Foreign Recipient Address Rework Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Only Tasks 1–3 are executable before the owner gate below; no agents. This author changes documentation only and runs no tests.

**Goal:** Accept full-invoice addresses from any country, with optional tax number and Spanish NIF/address rules only for ES, once the unresolved fiscal-identity decision permits integration.
**Architecture:** Separate structured postal-address validation/composition and localized country presentation from fiscal identity. Keep saved address text and country code separate; never derive an identifier, issuing country or AEAT IDType from the address country.
**Tech Stack:** TypeScript, country packs, Intl.DisplayNames, Lit field primitives, Vitest/Chromium, ESC/POS and PDFKit/pdfjs.
**Spec:** Owner's 2026-10-28 Lane E instruction and [historical plan](2026-10-27-a963-invoice-address-country.md). The old completed tasks remain historical; this plan supersedes their ES-only target, subject to the gate.

## Constraints and evidence

- Work only in the registered A963 worktree. Driver reports main `d23fe04a1` already integrated; planning read HEAD `a4f800767`. Preserve combined registry suites and both backlog decisions on subsequent rebases.
- Respect owner-held A696 and F/A739. The existing narrow waiver covers country contracts/registry and timezone-independent receipt-document work; it grants no edits to `till-app.ts`, payment widgets or fiscal writers. Trace those consumers read-only; hold any actual collision.
- A965 is separately owner-held and changes receipt-label fallback. Do not edit its worktree, merge its work or change `receiptLabelsFor`; future integration must preserve both changes.
- Before any implementation/test edits, read the TDD skill, CLAUDE.md and developer topics for data, UI/Forms, testing, claims and workflow/gates. Each behavioral increment requires an observed expected RED, minimal implementation, then GREEN; retain commands, exit statuses and nonzero test counts.
- No identity optionality, foreign tax normalization, backend recipient-builder changes, migrations or fiscal-writer work before the answer. RUNNER H2 still forbids alta-builder changes. Protected fiscal suites, fixtures and assertions remain unchanged throughout.
- Keep the unfinished branch unpublished and owner-held, including after independent tasks pass. Do not advertise a working foreign F1 path, relax server refusals or offer foreign submission while the backend rejects it. Silence never opens the gate.

Source provenance supplied by the driver, fetched **2026-10-28**; this author has not re-fetched it. These are documentary constraints, not a live AEAT acceptance probe.

| Source | Short quotation / elements | Constraint and limit |
| --- | --- | --- |
| [AEAT validation 1.2.2, §13, pp. 9–10](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf) | “pero es obligatorio que se cumplimente uno de los dos” | F1 requires recipients and exactly one of NIF/IDOtro; optional tax number cannot mean no identifier. |
| [UN M49](https://unstats.un.org/unsd/methodology/m49/overview/) and the AEAT schema below | “ISO-alpha2 Code”; `TW` | Postal membership is the UN table plus Taiwan's TW from the schema. This is independent of AEAT's identifier-country enumeration, which omits some postal territories and adds special identity codes. |
| [AEAT SuministroInformacion.xsd](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd) | `PersonaFisicaJuridicaType`: `choice`, `NIF`, `IDOtro`; `IDOtroType`: `CodigoPais`, `IDType`, `ID` | Use the actual identifier type and country rules; ID element is required with maximum 20 characters; no minimum length is declared, and an empty ID passes the driver's schema probe. Live AEAT acceptance of that empty ID is untested. Address country alone supplies none of that identity. |
| [BOE RD 1619/2012, art. 6.1(d)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a6) | “Asimismo, será obligatoria la consignación del Número de Identificación Fiscal del destinatario en los siguientes casos” | Domestic restaurant applicability appears to require identification; applying that provision here is an inference, not a settled legal conclusion. |

## Consumer map and assertion inventory

Re-run `rg -n 'recipientAddress|counterpartyAddress|recipient_address|counterparty_address|countryNameFor|receiptCountryNameFor|checkedInvoiceRecipient|InvoiceRecipientDetail' apps packages --glob '*.ts' --glob '!**/drizzle/**'`; follow nested recipient fields, type aliases, NIF normalization and country gates before changing their meaning. This map records source reads, not runtime verification.

| Paths | Responsibility / boundary |
| --- | --- |
| `packages/country/src/country.ts`; `packages/country-es/src/spain.ts`, `invoice-address.test.ts`; `packages/country-packs/src/registry.ts`, `index.ts`, `registry.test.ts` | Existing postal contract and ES policy; existing naming helpers know only ES names. Extend generic helpers without requiring a country pack for every recipient country. |
| `apps/till/src/widgets/invoice-recipient-dialog.ts`; its `.test.ts`, `.unsaved.test.ts`, `.save-state.test.ts`, `.a11y.test.ts`; `apps/till/src/api/client.ts` | Country currently fixed to ES; draft omits country; NIF is required and normalized. Whole dialog integration is gated. |
| `apps/server/src/invoice-selection.ts:20`; `working-order.ts`; `till-sale.ts`; `bill-payments.ts`; `packages/core/src/counterparty.ts`, `record-sale.ts`; `packages/fiscal-verifactu/src/backend.ts:709` | Selection, storage, revalidation, sale snapshot and fiscal recipient builder. Current selection validates Spanish NIF/address and refuses foreign country; builder separately refuses it. Read-only before gate. |
| `apps/server/src/receipt-issuer.ts`, `transaction-receipt.ts`, `invoice-document.ts`, `parties.ts`, `orders-list.ts`, `invoice-customer-data.ts` | Saved/raw address and code flow to replay, documents, management and export. Preserve snapshot text; no parsing, backfill or country suffix in storage. |
| `apps/server/src/receipt-document.ts`, `receipt-ticket.ts`, `invoice-page.ts`, `invoice-pdf.ts`, `invoice-raster.ts`; `apps/till/src/screens/till-ticket-view.ts`; `apps/dashboard/src/widgets/order-detail-dialog.ts` | Shared thermal/A4/PDF/raster country rendering; till ticket uses saved receipt language, dashboard uses screen language. Existing callers already invoke country helpers. |
| `apps/till/src/till-app.ts`; payment widgets; delivery/completion callers | Trace pending-choice comparisons, stale completions and refusal recovery, but do not edit reserved files. Needed changes there require a new explicit scope release. |

Carry forward the old plan's **Original assertion inventory**. Before changing any existing check, record its path, assertion, before/after value and the declared behavior change; preserve exact equality and all money, numbering, revision, clock, rollback, delivery and refusal assertions. Pre-gate changes may replace GB's code-fallback expectation with its localized name; invalid/unassigned-code fallback remains. Do not change tax-required or foreign-refusal checks before approval.

## Review focus

Countries without installed packs and nonassigned codes (Task 1); receipt language independent of recipient country (Task 3); foreign missing postcode/province and street commas (Task 2); raw historical snapshots (Task 3); country changes during saves, delivery refreshes and late completion (gated Task 4).

Execute the RED steps of Tasks 1 and 3 together before implementing the shared naming helpers, then complete their GREEN steps. Task 2 is independent of presentation.

### Task 1: Generic country names and valid selectable codes — executable

**Files/interfaces:** Create `packages/country-packs/src/recipient-countries.ts` and `recipient-countries.test.ts`; export from `index.ts`. Produce `RECIPIENT_COUNTRY_CODES: readonly string[]`, `normalizeRecipientCountryCode(value: unknown): string | undefined` and `localizedRecipientCountryName(countryCode: string, locale: string, fallbackLocale: string): string`. Existing registry wrappers stay unchanged until Task 3, giving renderer integration its own RED.

- [x] RED: Assert FR/GB/IE/HK names in EN/ES and all four Spain receipt languages without requiring a pack; use explicit Intl region-name expectations. Invalid locales use the explicitly supplied fallback; malformed/unassigned saved codes display raw and never throw. Membership accepts lowercase `fr` as FR and rejects empty/null/arrays, ESP, XX, ZZ and EU.
- [x] Run `pnpm --filter @waitron/country-packs exec vitest run src/recipient-countries.test.ts --reporter=dot`; require missing names/membership API RED, not setup failures.
- [x] Implement a pinned postal-country membership list from the [UN M49 ISO-alpha2 column](https://unstats.un.org/unsd/methodology/m49/overview/) plus TW from the AEAT schema (both fetched 2026-10-28); neither regex shape nor Intl recognition nor installed packs establishes membership. Keep this postal list separate from future AEAT identity-code mapping. Use Intl.DisplayNames for assigned codes, requested locale then explicit fallback locale then raw code. GREEN: repeat the command.

### Task 2: Structured address helpers without identity — executable

**Files/interfaces:** Create `packages/country-packs/src/recipient-address.ts` and `recipient-address.test.ts`; export from `index.ts`. Define `RecipientAddressDraft` with string fields `countryCode`, `streetAddress`, `postalCode`, `locality`, `province`; expose `recipientAddressErrors(draft): Partial<Record<keyof RecipientAddressDraft, "required" | "invalid">>` and `composeRecipientAddress(draft): string`. No tax or fiscal fields enter these APIs.

- [x] RED: Every country requires nonblank street/locality and assigned country; FR/IE/HK accept absent postcode/province and arbitrary nonblank foreign postcode text. ES additionally requires province and Spain's strict till postcode validation, including refusal of 00000/99999. Assert switching country recomputes rules without erasing values. Compose FR as `2 Main Street, Paris`, optional postcode as `2 Main Street, 75001 Paris`, optional province last; trim outer field whitespace, preserve street commas and omit empty separators/country suffix. Keep ES composition byte-for-byte equivalent.
- [x] Run `pnpm --filter @waitron/country-packs exec vitest run src/recipient-address.test.ts --reporter=dot`; observe missing helper/behavior RED. Implement only those pure helpers, delegating ES rules to its pack and using Task 1 membership. GREEN: repeat; then run `pnpm --filter @waitron/country-es exec vitest run src/invoice-address.test.ts --reporter=dot` unchanged.
- [x] Leave server `checkedInvoiceRecipient`, fiscal identity and production dialog unwired. Preserve the existing server's five-digit ES completeness policy, including 00000/99999; this task's strict policy is for structured till fields only. Helpers can complete while the entire dialog task remains blocked.

### Task 3: Render any recorded country — RED with Task 1, then GREEN

**Files/interfaces:** Extend `packages/country-packs/src/registry.ts`, `registry.test.ts`; server `receipt-document.test.ts`, `receipt-ticket.test.ts`, `invoice-pdf.test.ts`, `invoice-document.test.ts`; till `screens/till-ticket-view.test.ts`; dashboard `widgets/order-detail-dialog.test.ts`. Keep signatures `countryNameFor(countryCode: string, locale: string): string` and `receiptCountryNameFor(countryCode: string, locale: string): string`. Existing renderer callers need no new formatter; any receipt-document change stays within the timezone-independent waiver.

- [x] RED: Add registry and foreign snapshot cases: raw address plus exactly one separate translated country element; thermal 58/80 mm decoded output in Catalan, real PDF text extraction in Catalan and till ticket use saved invoice language even when screen/recipient country differs. Dashboard uses screen language. Country-helper tests cover FR/GB without packs/names, all four Spain receipt locales and invalid-code fallback. Shared document tests retain arbitrary/suffixed raw-address and F2 controls, add FR for four receipt locales plus unsupported-locale fallback, and assert input deeply unchanged. These presentation fixtures do not claim a foreign sale can be issued.
- [x] Run `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts --reporter=dot` and `pnpm --filter @waitron/server exec vitest run src/receipt-document.test.ts src/receipt-ticket.test.ts src/invoice-pdf.test.ts src/invoice-document.test.ts --reporter=dot`; separately run `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts --reporter=dot` and `pnpm --filter @waitron/dashboard exec vitest run src/widgets/order-detail-dialog.test.ts --reporter=dot`. Observe country-code output causing RED before changing wrappers.
- [x] Wire wrappers to Task 1 names, preferring explicit pack names. Screen locale falls back to English; receipt locale is the supplied invoice locale when existing receipt labels support it, otherwise `FALLBACK_RECEIPT_LOCALE`, independently of recipient pack invoiceLocales. Preserve current ES/bare/unknown/English receipt assertions and unrelated registry suites; leave `receiptLabelsFor` unchanged and preserve A965's later label changes. GREEN: repeat all four commands. Never rewrite recorded data.
- [x] Retain exact printer-presentation baseline comparisons, totals, wrapping, QR, duplicate and snapshot assertions. Inventory any deliberately changed presentation bytes before updating them; leave fiscal golden data untouched. Look at thermal/PDF output and ticket in both themes at phone/desktop width; check browser headroom and stop only owned PIDs.

## Implementation ruling, 2026-10-28

The Node/Chromium probe found Chromium156 reports no DisplayNames support for Galician/Basque and resolves both to English. Two real till cases failed on that English country text. Task1 therefore includes pinned Unicode CLDR Galician/Basque country translations in `packages/country-es/src/receipt-country-names.ts`, the home for Spain's regional receipt words, with the upstream licence shipped through the existing `deploy/third-party/` copy. Use those translations before Intl, preserving Spain's explicit pack names. [CLDR source](https://github.com/unicode-org/cldr-json/tree/7d2b9cb11cec08f4d333ad73209deb3df0711c3b) is the exact generation input; no new npm dependency or language-support claim outside those measured locales.

## OWNER GATE — pending; do not cross on silence

The driver has already posted **one** question: may F1 require an accepted identifier, so tax number may be absent when passport/another accepted ID is supplied, **and** may the protected backend `buildDestinatarios` be extended? Record the explicit answer to both parts before any dependent work. Do not ask a duplicate question or interpret the address instruction as backend permission. An explicit yes covering the named builder releases that specific H2 restriction without a second approval loop. It does not approve migrations or wider fiscal work; amend the plan with the approved identity scope first.

### Task 4: Country-selectable dialog and request integration — BLOCKED as a whole

**Files after scope release:** `apps/till/src/widgets/invoice-recipient-dialog.ts` and its four suites above, till EN/ES translation files, and server selection/request suites identified by the consumer map. Identity wiring and protected backend work require a separate explicit approved scope; no executable fiscal implementation is specified here.

- [ ] Once approved identity support is implemented and verified end-to-end, add RED cases for an all-country `wt-combobox`, `countryCode` in draft/current/baseline/submitted/restore/comparison, ES default and country changes dirtying Save. Use Task 2 fields/rules, mark foreign postcode/province optional, and preserve their values when switching countries. Require an assigned code; validate Spanish NIF only when ES, with optional tax number governed by the approved accepted-identifier flow, never invented identity.
- [ ] Preserve original unsaved, cancel/discard, quiet unchanged Save, refusal/field-edit recovery, email/A4/saved delivery and late/newer-edit completion assertions. Add country-only edit, failed save, delivery-option refresh and old completion after a country edit controls; no foreign confirmation may reach a backend that still refuses it. If this needs reserved callers, keep the whole task blocked for that scope release.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/widgets/invoice-recipient-dialog.test.ts src/widgets/invoice-recipient-dialog.unsaved.test.ts src/widgets/invoice-recipient-dialog.save-state.test.ts src/widgets/invoice-recipient-dialog.a11y.test.ts --reporter=dot` for RED then GREEN; use real request/recording tests to prove selected/stored/replayed identity and address, unchanged refusal codes/side effects and no numbering/money on rejected input. Amend this task with exact approved server test paths before executing it.

## Final validation and review — later, after the gate and complete integration

- [ ] Run all explicitly affected suites from the consumer/assertion inventory, then unedited fiscal suites with `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts --reporter=dot`; preserve protected tests and read nonzero passing counts. No whole-workspace run solely to finish.
- [ ] Inspect dialog EN/ES × light/dark × 390/1280 widths and actual rendered documents. Update both `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md` under `{#full-invoice}` only when the path works; audit prose across the full branch diff and keep remaining backlog work explicit. Historical documents receive dated pointers only.
- [ ] Retain the prior **268-second Claude approval for original code**; do not repeat that review. The changed foreign integration receives **one new scoped substantial-work Claude run-it review** through `claude-seat.sh review-run` in a complete throwaway checkout with dependencies, after integration/rebase; read completed findings, fix verified issues and run focused checks. A later rebase alone does not repeat review.
- [ ] Only when complete, announce readiness for `finish-branch`; use signed-off commits, the normal pre-push hook and current-head scoped CI coverage/required checks later. Keep held/unpublished until the owner gate and scope are resolved; any eventual fiscal PR is owner-held for landing, never automatically merged.
