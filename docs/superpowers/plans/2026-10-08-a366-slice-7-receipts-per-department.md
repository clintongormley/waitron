# Receipts per department, slice 7 — implementation plan (A366)

> 2026-10-10, Part B: department receipt links now open
> `/manage/venue-operations/department/:id/view/receipt`. Venue settings is global-only;
> Part A's picker and same-page department navigation below describe its intermediate host.


> **Owner overrides, 2026-10-10 (A366-7A STEP 0).** The completed later answers in
> `/Users/clintongormley/waitron-campaign-e/questions.md:1976–1985` override the earlier
> answers in `/Users/clintongormley/waitron-campaign-b/questions.md:2143–2164`: keep venue
> subtitle/footer/logo as live defaults; omit the optional current address on A4; no consent
> step for emailed receipts. This is a documentation revision, not an implementation report.
>
> **Driver and checkpoints.** Implement routine work inline with `superpowers:executing-plans`.
> Each A1–A13 task starts with an observed meaningful failing behavioural test, then minimal
> implementation, focused green tests and affected types. Retain changed-check receipts and
> each task's applicable LOOK. Both code PRs require two complete Claude run-it reviews below.
>
> **Build base:** `main` **`06772ee256dc58cc1de5af2074870cef7d0b9f87`** (#1488).
> Slice 3A landed at `87b46b024fcac68a6240949964768b9fbc7d4972` (#1469), and 6A at this base.
> Their dependency gate is satisfied. Generate against the current journal; re-read overlapping
> landed work before building. Part B remains a separate PR. No product tests, migration,
> rendering or runtime fault probes ran during this documentation revision.

**Goal:** you can give each department its own receipt logo, phone, email and translated
subtitle/footer. An empty logo or unresolved department text inherits the live venue default.
Phone/email do not inherit. Each surface uses the recorded department's current fields and the
sale's trading-name snapshot. With a null department or absent header, print only venue fields,
including live venue logo/subtitle/footer; never borrow a default department or trading name.
The current address follows the venue-wide switch on thermal/till, but never appears as an
optional block on A4. Mandatory filed domicile stays on full invoices.

**Architecture:** add `department_receipts` to venue-service through `VenueServiceContribution`
seats. Retain `tenant_receipts`, its existing string subtitle/footer, logo/rasters, address switch
and global authored APIs. Compose sanitized venue defaults with the recorded department at the
server; pure shared resolution keeps editor hints, preview, thermal, A4 and till consistent.
Layouts retains global persistence/validation; venue-service owns department maps and pictures.
The dashboard imports pure shared exports, not layouts' database-bearing index. Part A keeps
both editors in Venue settings → Receipts; Part B moves only the department editor to the
Department → Receipt tab. Global drafts remain independent of the selected department.

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md),
§2's dated receipt note, §6's print policy, §9.1, §11, §12 and §13 item 7. The revised §11 is the
receipt contract. The old screen-4 mock-up is illustrative: its English choice, language tabs,
address placement and any earlier plan fallback are superseded by the owner's answers.

**Two PRs, FULL path:** Part A is A1–A13; Part B is B1–B3. Slice 6A's host has landed;
Part B adds its Receipt tab without taking slice 6 Parts B/C. Each PR must work independently.

**No reset/copy for venue defaults.** Department rows start empty and inherit live. Preserve
existing global strings and rasters in place, including during configuration transfer. No
backfill, conversion, reset or compatibility schema is part of inheritance. Existing global
phone/email remain available to the current delivery checker until the separate consent-removal
work; they are not inherited into department receipts. Run actual SQL/upgrade/FK probes in A2/A13
before describing migration outcomes.

## Current source inventory and re-grounding

### Dated 2026-10-09 slice 1 comparison (historical source audit)

STEP 0 ran `git rev-parse 685a6074b 1ed9857ca` and read this comparison:

```sh
git diff 1ed9857ca9dd6589dd280b5ac3df35cce27f5fc1 685a6074b152eeb904a66cfac9f83e8f432196ab -- packages/module/src/module.ts packages/venue-service/src/classification.ts packages/venue-service/src/configuration-transfer.ts packages/venue-service/src/index.ts apps/server/src/till-api.ts apps/till/src/till-app.ts apps/till/src/api/client.ts apps/server/src/till-api.receipt.test.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts
```

In that listed path set only `till-api.receipt.test.ts` and `till-app.ts` differ. The test gained
recorded-name/content-translation cases: retain those behavioural assertions when moving its
receipt fixtures. The till changes concern its icon and backlog pointers. A separate diff of
`apps/server/src/sale-till-source.receipt.test.ts` and `packages/venue-service/drizzle` returned
no changes between those two commits. These are Git comparisons, not runtime verification.
The 2026-10-10 revision now reads the landed 3A/6A tree named above. Regenerate new
migrations from that tree, never hand-renumber snapshots or edit shipped SQL.

### Current receipt and delivery call paths (read on main 06772ee25)

| Path | Current source pointer | Target in this slice |
| --- | --- | --- |
| Recorded department/header | `packages/venue-service/src/operations.ts:695`, `:710`; `packages/module/src/module.ts:621`, `:627` | Saved department only; null never reads default for printing |
| Department list | `operations.ts:58`, `:65` explicitly omits `isDefault` despite ordering by it | Add the projection for picker/contact selection; no schema column |
| Global authored data | `packages/layouts/src/types.ts:7`; `receipt-store.ts:43`, `:97`, `:116`, `:133`; exports `index.ts:96` | Keep strings, APIs, rasters and legacy contact; bound optional reads |
| Thermal | `apps/server/src/receipt-print.ts:162–164`; shared top block `receipt-document.ts:149–165` | Compose current defaults+department, reorder subtitle; thermal address follows switch |
| A4 | `invoice-document.ts:91–106`; `invoice-page.ts:80`; `invoice-pdf.ts:20` | Visible logo; no optional current address even without filed domicile; filed domicile remains |
| Consent check and staging | `invoice-choice-delivery.ts:63–100`, `:105–136`; `working-order.ts:3478`, `:3488`, `:5689` | Leave the checker/stored consent unchanged; no sharing with the new contact selector |
| Invoice-choice route/client | `till-api.ts:1747–1787`; `apps/till/src/api/client.ts:2441` | Existing route accepts delivery; client currently sends invoice type/recipient only. No F1 rollout in slice 7 |
| Delivery/provider | `invoice-delivery.ts:22`, `:147`, `:350`; `invoice-email-worker.ts:64–109`; `invoice-email.ts:22–54`; `boot.ts:1431`, `:1473` | Preserve reservation, retries, provider configuration and existing evidence; future consent removal is one backlog item |
| Boot/management | `till-api.ts:1213`; `management-api.ts:1216`, `:1232`, `:1255` | Till answers resolve current fields; retained GET/PUT receipt APIs edit global authored data |
| Preview/address | `receipt-preview-api.ts:191`; `venue-address.ts:37` | POST draft preview; global address independent of brand; thermal/till switch, A4 suppression |
| Media | `packages/media/src/images.ts:91`, `:230`, `:662` | Keep venue logo use and add explicit department logo uses |
| Landed department host | `packages/venue-service/src/dashboard/department-page.ts:61`, `:99`; shell/client siblings | Existing Settings/Zones host; B1 adds Receipt, B/C summaries/floor plan stay separate |

Search identifiers **and prose** as A13 specifies. The complete consent inventory and future
failing cases are in [Remove the consent step from emailed receipts](../../backlog/printers.md#remove-the-consent-step-from-emailed-receipts).
These pointers are source reads, not executed runtime evidence. No new contact-offer UI was
found in the searched current till source; the new selector supplies a tested integration
contract, not a public email send path or fabricated consent.

### Dated 2026-10-09 overlap audit: slices 2/3/5 (historical)

Input: `/Users/clintongormley/waitron-campaign-e/receipts/a366-7a-step0/orientation.json`.
Read-only `git rev-parse HEAD`, `git status --short` and diff hunks against the inspected main
were also read in the three named worktrees. Do not edit, reset, install or run tests there.

| Slice/worktree | Head read in STEP 0 | Relevant overlaps from orientation and current diff |
| --- | --- | --- |
| `waitron-feat-service-periods-slice-2` | `30056a2ccf6f1b2779b31a7141b43c6f91c11d19` | `module.ts`, venue-service classification/transfer/exports/routes/operations/service/schema/journal/migration tests, server till API/working-order, till client/app, schema guard, backlog/design-system. Current working tree has additional edits, including transfer/routes/exports. Diff hunks read include zone/service pricing and journal `0035_tough_prodigy` |
| `waitron-feat-service-periods-slice-3-station-controls` | `8a381614961aac1912177c49127d214c38723976` | Module seats, venue-service classification/exports/routes/operations/service/schema/journal/migration tests, server till API/working-order, till client/app, schema guard, backlog/design-system. Journal names `0035_station_destinations_and_period_extensions` and `0036_station_destination_not_self` |
| `waitron-feat-service-periods-slice-5-monitors` | `0d3b07d919dbe6e4b8b3e6a07793bd69de219c90` | Module seats, venue-service classification/transfer/exports/service/schema/journal/migration tests, core classification/schema, server management/till API/working-order/receipt-print test, till layout/client/app, dashboard live queries/strings/codes, upgrade/schema guards. Receipt-print test removes a device's old station binding; preserve its drawer assertions |

The complete shared-path sets are in the STEP 0 writer report. Different inspected hunks suggest
integration work, not a guarantee of conflict-free rebasing. The migration journals overlap.
3A and 6A have now landed. Before BUILD inspect current overlapping work, integrate landed
contracts and generate against the current journal. The table above is a dated inventory, not
a statement that these worktrees are still active. Part B uses the landed slice 6 host.

## Decisions 1–20 (owner answers applied)

1. **Two PRs.** Part A builds the standalone department editor; Part B integrates the Department
   Receipt tab. The 3A/6A dependency is satisfied at the inspected base. Part B uses the landed
   slice 6 host.
2. **Data ownership.** `department_receipts` belongs to venue-service: `department_id` primary
   key/FK to `departments.id`, `receipt` plain JSON, `logo_rasters` nullable JSON, `updated_at`.
   Use the shared column vocabulary, classify it `state`, export it in that module's configuration
   transfer with a declared id reference. No row means empty authored fields. Its JSON holds
   only logo/phone/email/subtitle/footer, never `printAddress`, trading name or legal identity.
   The existing core singleton retains global authored defaults, rasters and switch. Department
   JSON never copies inherited values; global strings do not become maps. Preserve valid global strings verbatim, including their
   existing empty/whitespace rendering; only department map candidates use blank detection.
3. **Current authored fields on reprints.** Read the recorded department's current row for every
   print, copy, reprint, A4 and on-screen answer. Keep the recorded trading name and
   `printTradingName`. Do not snapshot new authored fields or rewrite filed facts. Preparing a
   new reprint/copy differs from retrying transport of an existing failed job: the latter keeps
   that job's bytes/history (`receipt-print.ts:406`), rather than rewriting the queued document.
4. **No-department rendering (interpretation for parent FYI).** A null `departmentId` or absent
   header uses only sanitized venue fields, including live venue logo/subtitle/footer and the
   existing venue phone/email. No department/default-department fields or trading name print.
   Thermal/till current address follows the global switch; A4 omits that optional block.
   This reads “only venue fields” consistently with keeping live venue defaults. A disabled
   recorded department still supplies its own fields. Missing/bad optional department data
   behaves as empty and inherits only logo/subtitle/footer; it never borrows another department.

5. **Media ownership.** Media reads `department_receipts` directly, adds the workspace dependency
   and descriptor `requires` for venue-service, and names each department in usage results. Keep the global venue-logo usage/count/link;
   an inherited logo is one global reference, not an extra stored use per inheriting department.
   Re-run the workspace-cycle/module dependency guards during implementation; this plan makes
   no executed claim that the proposed dependency is acyclic. Count disabled departments too,
   because their receipts remain live on reprints. Part A links to its picker; Part B links to
   the Department Receipt tab.
6. **Allowed languages.** Installed pack receipt choices plus the current venue receipt language,
   deduplicated with that language first. Spain: `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`
   (`packages/country-es/src/spain.ts:293`, `apps/server/src/venue-locale.ts:80`). No automatic
   English or content-language list. Unknown keys are refused without echoing arbitrary keys.
7. **Department maps have exactly two language candidates.** For each field separately:
   printed language → CURRENT saved receipt language → no department value.
   Whitespace-only means unwritten. Never take text from a third language. Originals/reprints
   retain the filed `sales.locale`; that differs from the current fallback language after a
   venue change. If neither candidate supplies that field, use the one-string live venue default,
   else nothing.
   Resolve BOTH department candidates before inheritance, so a venue string cannot mask a valid
   department fallback. Never convert global strings into language maps; they keep printing in
   every language as today. For an empty locale input, its placeholder is only the effective
   fallback value from this same resolver (current-language department text if available, else
   venue string), with no “Inherited” prefix or explanatory hint. This precedence/hint reading
   is an interpretation for parent FYI. Non-empty input has no inherited placeholder. Clearing
   the last candidate restores live inheritance; it cannot request suppression of a venue default.
8. **Warning per language.** Put ⚠ beside a language heading when that language lacks a subtitle
   or footer another language has. Include the current receipt language. No warning when all
   optional texts are empty. This warning does not make translations mandatory.
9. **Mock language labels.** Label the current language “(receipts)” and others “(copies)”. Use
   decision 6's choices; the mock's English is not an added language.
10. **Exact top order.** Logo → recorded trading name (if enabled) → subtitle → legal name →
    current address (thermal/till only, global switch) → phone → email → DUPLICADO → NIF.
    A4 has the same visible logo/subtitle order with **no optional current-address block**,
    even if the filed domicile is missing or differs. Keep mandatory filed F1 domicile,
    recipient and QR particulars. Pass an explicit surface to the shared document builder;
    do not infer A4 from invoice type, because thermal F1 still follows the global switch.
11. **One global address switch and live defaults.** `VenueReceiptSettings` contains logo,
    one-string subtitle/footer and `printAddress?: boolean`. Absent switch shows the current
    thermal/till address; false hides that optional block. Global contact stays in the existing
    authored store/API for null-department rendering and the current delivery checker, but is
    not inherited into departments. Refuse department `printAddress` and explicit null switch.
    Clearing a department logo removes its own filename/pair and immediately uses the current
    global pair. Clearing the GLOBAL logo removes that default/pair; explicit department logos
    remain. No empty sentinel disables inheritance and no new raster is copied/generated for it.

12. **Subtitle wording.** “Subtitle” / “Subtítulo”, under the trading name, above the legal name. Empty
    department inputs show only decision 7's inherited value, never a position explanation. Use
    shared field primitives and semantic names.
13. **Permission.** Department receipt reads/writes/previews require `layout.configure`, wherever
    mounted. Accept an explicit disabled department of this location for maintenance/reprints;
    refuse unknown/other-location ids. The Department page keeps its existing management gate;
    its Receipt tab also requires this permission. Global defaults/switch edits use the same permission.
14. **Part A picker.** “Department” selects both edit and preview context, above department fields;
    global logo/subtitle/footer/switch, receipt language and sales description are below. Normally
    list active
    departments; select the active default, else the first active. Do not add a disabled default
    solely for missing-sale fallback. An explicit disabled-department URL/media link remains
    editable with a disabled label; that maintenance reason is separate. A department read/list
    failure does not disable loaded global settings. Changing departments negotiates only that
    department's draft; preserve global drafts and isolate late saves/reads.
15. **Independent preview language.** Starts at the current receipt language; changing it changes
    neither the saved receipt language nor an authored draft. Preview gets that printed language
    and the current fallback language explicitly. Use POST with the bounded draft payload (A6),
    rather than making URL size an unmeasured guarantee about GET. Preview includes the unsaved
    global defaults/switch without making them department values, and matches the renderer.
16. **Stacked translations.** All languages visible one after another; no language tabs. Each
    heading names the language and its warning; explain the warning once. Names stay
    `headerSubtitle-<tag>` / `footerMessage-<tag>`. A refusal naming field+language appears
    under that exact field, scrolls it into view and adds the localized bottom summary above
    the buttons. It does not open/switch a language tab.
17. **Delivery contact selection, without a consent step.** Determine an order's department from
    authoritative order/zone context; for an issued sale use its recorded department. Missing
    department or missing/invalid department email tries the location's designated default.
    No valid default email means no offer; optional valid phone comes from that SAME contact.
    A disabled designated default remains eligible. Do not inherit venue phone/email here.
    Provider availability stays an additional gate. Build `resolveInvoiceEmailContact` for
    offer/contact integration and test its authoritative lookups; do not connect it to
    `checkedInvoiceChoiceDelivery` or add consent UI, contact echo checks or accepted snapshots.
    The existing checker still requires the legacy stored consent and global contact. Retain
    its APIs/fixtures until the separately inventoried core rewrite; never synthesize consent,
    bypass checks, or change delivery schema/client/F1 rollout to make this slice appear complete.

18. **Each till answer carries its own presentation.** No boot-authored department fields.
    Fresh sale, replay, invoice-first and bill-payment answers with an invoice carry
    `receiptTrim` plus separate current address/global setting. The switch is not in trim.
    Read current trim on replay; retain filed language/identity/trading-name facts. Empty
    trim clears the previous department's logo/text. Do not fill a missing invoice from boot.
19. **Defensive, bounded reads and failure containment.** Imported optional rows can be malformed;
    bad fields/maps/entries/rasters are dropped, preserving good fields where possible.
    Optional read failures are contained separately for global and department data; a failed
    department read can still inherit a valid global default. A failed global read leaves valid
    department fields, with a bounded diagnostic. Both failures yield empty optional trim. This is
    not a promise that every database
    read, failed transaction or commit can succeed under engine failure. Follow the explicit
    boundaries/probes below so a recoverable optional print failure does not undo the sale.
20. **Existing picture rules.** Unchanged logo reuses its stored valid 58/80 mm pair. A new logo
    is written only with both valid pictures. Clearing a department logo clears its own pictures and
    inherits the global pair; clearing
    the global logo clears only its default pictures. Decode only bounded
    dimensions/base64 lengths as today's store does; render a changed image outside the write
    transaction. Bad pictures do not cause an imported row to throw during optional rendering.

## Types, validation and failure boundaries

These are target interfaces, not code already present. Shared owns browser-safe types/resolution;
layouts owns validation and printing; venue-service owns plain-JSON persistence and its seats.
The module contract uses pure shared types, not an import from layouts or a database table type.
The dashboard does not import layouts' index. No new dependency loop is assumed safe.

```ts
// Pure shared contracts (new); no printAddress in department config or printed trim.
type ReceiptText = Readonly<Record<string, string>>;
interface DepartmentReceiptConfig {
  logo?: string;
  phone?: string;
  email?: string;
  headerSubtitle?: ReceiptText;
  footerMessage?: ReceiptText;
}
interface PrintedReceiptTrim {
  logo?: string;
  phone?: string;
  email?: string;
  headerSubtitle?: string;
  footerMessage?: string;
}
interface VenueReceiptSettings {
  logo?: string;
  headerSubtitle?: string;
  footerMessage?: string;
  printAddress?: boolean;
}
interface VenueReceiptConfig extends VenueReceiptSettings { phone?: string; email?: string }
// Existing layouts ReceiptConfig remains structurally equivalent, with unchanged string semantics.
resolveReceiptTrim(department: DepartmentReceiptConfig | null,
  venue: VenueReceiptConfig, printedLanguage: string, currentReceiptLanguage: string): PrintedReceiptTrim;
// null means venue-only, {} means department with inheritable fields empty.
// Logo raster source follows the chosen filename's owner, never filename equality alone.
// Current address plus the global switch, independently of department trim.
interface ReceiptPresentation {
  receiptTrim: PrintedReceiptTrim;
  venueAddress: readonly string[];
  venueReceiptSettings: VenueReceiptSettings;
}
resolveReceiptText(text: ReceiptText | undefined, printedLanguage: string,
  currentReceiptLanguage: string): string | undefined;
untranslatedLanguages(texts: readonly (ReceiptText | undefined)[],
  languages: readonly string[]): string[];
```

`validateDepartmentReceipt(value, languages)` rejects wrong shapes, unknown fields, nulls,
non-string map entries, unknown language keys and entries over the current 200-character bound.
Blank optional text may be dropped. Keep current logo filename, 30-character phone and
254-character email rules from `packages/layouts/src/validate.ts:18`; preserve normalization
semantics rather than silently coercing input. Add typed `receipt.invalid` field/language/reason
params and localized wording. An invalid known language entry can name its allowed language;
an unknown key must not become a param or an object property written to storage. Test own keys,
arrays and prototype-shaped keys. The defaults validator allows only `VenueReceiptSettings` fields with today's string/logo bounds;
no global maps are introduced. The full existing global `ReceiptConfig` validator/API stays.
The defaults writer patches those fields server-side while preserving stored phone/email; a
missing submitted optional default clears that default, not unrelated global contact. Address
and logo-raster validation retain their own rules. Nothing writes inherited values to a department.

The server helper `resolveInvoiceEmailContact(tx: Transaction, cfg: VenueScope,
source: { orderId: string } | { saleId: string }): Promise<{ email: string; phone?: string } | null>`
belongs in A5's server contact module, not shared/browser exports. Add a pure
`receiptLogoSource(department, venue): "department" | "venue" | null` alongside the trim resolver
so the server selects the chosen owner's raster. An explicit valid filename with a corrupt
picture yields no picture, not a different venue logo; an invalid filename is dropped as empty.
A4/thermal/preview pass `surface: "a4" | "thermal"` to `ReceiptDocumentInput`; the till view applies
the thermal address rule. This is a minimal output-layout change, never a fiscal fact.

Seats beside `readSaleReceiptHeader`:

- `readDepartmentReceipt(tx, cfg, departmentId)` → authored JSON, no rasters.
- `readPrintedDepartmentReceipt(tx, cfg, departmentId, paperWidth)` → sanitized authored fields
  and a valid picture or null. A disabled recorded department remains readable.
- `readDepartmentLogoRasters(tx, cfg, departmentId)` → validated pair for unchanged-logo reuse.
- `writeDepartmentReceipt(tx, cfg, departmentId, receipt, rasters)` → scoped write; validation
  and authorisation errors remain refusals, not successful empty writes.
- `receiptDepartmentForSale(tx, cfg, saleId)` → saved id or null, **no default lookup**.
- `receiptDepartmentForOrder(tx, cfg, orderId)` → authoritative order department or null,
  **no default lookup**. `receiptDefaultDepartment(tx, cfg)` returns the designated default id or null for
  contact selection, including a disabled default. It never runs on the rendering path.

**Bounds to implement and measure:** authored JSON returned for parsing is capped at 64 KiB;
only approved language entries are retained. Query/projection must enforce the byte bound
before a huge imported payload is materialized in JS. Select a single department row, not a
full-table scan; select only the requested bounded picture for printing. For picture reuse,
read the two bounded pictures. Reuse printing's current width/height/encoded-length limits.
Apply these bounds to the global optional trim too, preserving good bounded fields beside
an oversized/corrupt field. Project each allowed string and printAddress separately, with an
engine-side length/type guard before returning it; a large embedded legacy raster must not
hide valid global `false`, subtitle or footer. Select only the chosen owner's requested bounded
picture; read two only for reuse. Test malformed JSON and oversized global pictures through the
actual engine. Preserve valid old global rasters without copying or redrawing during inheritance.
No filesystem/sharp/retries/per-line receipt reads in sale transactions; await queries in turn.
A null-sale render reads global defaults once and zero department/default rows. A department
render reads at most its row and the global row once each; contact selection reads at most the
selected department and designated default, without a duplicate when they match. Demonstrate
bounds/query counts in tests; these are not wall-clock deadlines for synchronous engine calls.

**Containment to implement, not an asserted engine guarantee:**

- Sanitizing and optional SELECT/projection/parse errors drop that source's bad fields/picture,
  then compose surviving global/department fields under decisions 4/7/11;
  diagnostic records operation/id/code, not imported JSON, contact values or secrets. Query
  errors in ordinary management saves/authorisation do not become successful responses.
- A missing/malformed optional authored row still allows legal/fiscal document content. If
  required issuer/header/address preparation cannot be completed, skip that automatic receipt
  rather than inventing identity/address. Do not swallow the sale's fiscal writes, tender writes,
  invoice numbering, mandatory drawer work or transaction/commit failures.
- Put automatic optional document preparation/formatting and its document-job/delivery writes
  behind a scoped failure boundary. Preparation failure queues no partial job. If optional
  enqueue/reservation can partially write, use a savepoint enclosing ONLY those optional writes;
  a savepoint is a rollback point inside the same transaction. Roll that work back on a
  recoverable refusal and keep the sale transaction usable. Do not
  open a second sale transaction or catch around the whole sale. Inspect the actual store API
  and run the savepoint/refusal probe before choosing the exact implementation.
- Explicit print/reprint/copy/A4 requests may return a print failure; they must not alter an
  already-issued sale. Preserve original-print status/retry and idempotency semantics. Never
  silently declare an email/A4 delivery reserved after it failed.
- Inject optional row-read, logo-decode, formatting and enqueue/reservation failures through the
  real relevant paths. Assert one committed invoice/tender/header, unchanged invoice number on
  replay, correct absence/rollback of partial document/delivery rows and appropriate failure
  reporting. For an engine fault that invalidates the transaction itself, report that limit;
  no universal “reads never throw” or “printing can never undo a sale” claim is authorised.

## Scope, retired behaviour and changed checks

Implementation paths are an inventory; re-read siblings and consumers when the base changes.

| Task | Main path set |
| --- | --- |
| A1 | `packages/shared/src/receipt-text.ts`/types/tests/exports; layouts types/validate/errors/exports/tests |
| A2 | venue-service schema/receipts, department-receipts/store/tests, classification, configuration-transfer, operations/list type, routes list projection, service/index, module contract; generated venue-service SQL/journal/snapshot; focused migration/schema/transfer guards |
| A3 | server management API/logo routes/tests; retained global store plus defaults subset helpers/tests in layouts; dashboard API contracts are added alongside old ones |
| A4 | server receipt-print/document/ticket/tests, sample helpers and safe optional enqueue boundary; current receipt-address helper |
| A5 | server invoice-document/page/pdf/tests, new invoice-email-contact helper/tests and venue-service authoritative lookup seats; existing delivery tests remain controls, checker/schema/client unchanged |
| A6 | server receipt-preview-api/sample-receipt/tests; dashboard preview API method and its route tests |
| A7 | server till-sale, bill-payments, till-api and receipt/source/bill/replay tests; till layout/client/app/ticket view and tests |
| A8 | media images/tests, descriptor/package manifest, dashboard usage types/library/live queries/strings/tests; lockfile if dependency install changes it |
| A9–A12 | dashboard receipts screen and its sibling tests, API/live queries, app navigation/unsaved/permission tests, EN/ES strings/codes; shared UI only if a needed primitive lacks the contract |
| A13 | retained global store/API/tests, obsolete preview GET and till boot consumers/fixtures, dashboard queries/stubs; root guards as warranted, current docs and dated historical pointers, A366 backlog and one consent-removal backlog entry |
| B1–B3 | landed slice 6 host and its tests, dashboard-kit contract/app host if needed, reusable receipt editor/tests, media links, venue-service strings, Venue settings global panel |

`tenant_receipts`, core schema/export/classification/transfer/singleton guard, `ReceiptConfig`,
`DEFAULT_RECEIPT`, `getReceipt`, `getPrintedReceipt`, `getStoredLogoRasters`, `putReceipt` and
GET/PUT `/management-api/receipt` remain global authored contracts. Global defaults queries and
media usage remain live. Harden bounded reads without retiring these consumers. Keep global
phone/email for existing APIs/checker and venue-only receipts; stop inheriting them into departments.
Transfers preserve global strings/pictures and remap only explicit department references.

**Retired behaviour:** boot-owned receipt presentation, preview-only department picker,
“Every location” department heading, “Slogan”, implicit preview-language coupling, inactive
explicit-preview refusal and the obsolete preview GET after callers move. Global media usage
gets a venue label alongside department labels. Global one-string subtitle/footer and APIs
are NOT retired. The default-department print fallback, third-language fallback, per-department
address switch and tabs were superseded planned defaults. Slice 7's planned consent-check
sharing/contact-echo/snapshot work is withdrawn; removing current core consent is separate.

**Changed test checks — PR inventory required**, with precise final `file:line`, old assertion,
new assertion and owner answer. A checkpoint can add focused failing tests before later
retirement, but no untouched behavioural assertion is weakened just to make a refactor pass.

| Existing assertion/area | Intentional change; assertions to retain |
| --- | --- |
| `apps/server/src/receipt-ticket.test.ts:2630` exact ordered list | Answer 7 moves subtitle before legal name on both 58/80 mm; retain QR prefix, centring, every remaining line and fiscal facts |
| Receipt-print current trim/reprint cases (`receipt-print.test.ts`, including current-trim case near `:2162`) | Add department fixtures beside retained tenant default fixtures; retain reprint-live-text and snapshot-trading-name assertions, add null/absent-header controls |
| `till-api.receipt.test.ts`, `sale-till-source.receipt.test.ts` | Per-answer trim/global address replaces boot-authored trim; retain slice 1's recorded names/translations and fiscal/content snapshots |
| Layouts validation/store tests | Department maps are added alongside retained global strings; department address key is refused, global boolean validator keeps false/absent behavior; preserve logo safety and authorization assertions |
| Management receipt / preview tests | Department routes plus separate global route; inactive explicit preview now allowed, independent preview language; preserve permission/location and malformed-input checks |
| Dashboard receipt/save/a11y/unsaved tests | Picker edits as well as previews; stacked translations and correct refusal scroll; Save requires a changed draft; global defaults/switch have their own draft; keep all leave/save/reconnect behavior |
| `dashboard-app.venue-settings-unsaved.test.ts` departmentId navigation (near `:409`) | Page negotiates department draft; global draft survives; app does not double-prompt; retain cross-panel unsaved checks |
| Till boot/client/bill/replay tests | Remove only authored boot data checks; assert every invoice answer has its own empty-or-resolved trim and current global address presentation |
| Receipt-document/till-ticket-view F1 address checks | Replace the current F1-with-domicile suppression (`receipt-document.ts:156`, `till-ticket-view.ts:552`) with explicit thermal/till switch handling; A4 always suppresses optional current address. Keep separate filed domicile and recipient assertions |
| Invoice page/PDF/contact tests | Visible A4 logo/subtitle order, NO optional current-address block regardless of switch/domicile; thermal/till switch still applies. Retain filed domicile/recipient/fiscal facts. Add independent department/default contact tests; existing consent checks/evidence are unchanged controls until the backlog rewrite |
| Media library/usage tests | Keep/name the venue use and add/count explicit department uses including disabled; inheritance creates no extra reference. Retain in-use deletion refusal |
| Core schema guard `scripts/schema-constraints.test.ts:672` | **Keep** `tenant_receipts_singleton_ck`; add the department FK/key checks without retiring the global invariant |
| Historical configuration fixture/current import tests | Existing global strings/rasters/switch still render and transfer unchanged; empty departments inherit live. Preserve unrelated transfer/id/reference checks |

Golden huella fixtures, `inmutabilidad` and fiscal filing assertions are untouched. Run relevant
required guard/fiscal checks unedited when migration/schema work requires them; if an unchanged
fiscal test fails, stop that code checkpoint and diagnose. Never rewrite it to fit this slice.
The historical engine-grants inventory `packages/fiscal-verifactu/src/privileges.expected.ts`
also stays unchanged; it is not a current receipt-storage consumer to retire.

## Validation and FULL review path

For each task choose focused behavioural files/cases and the types affected by that task. A
focused command must print a Tests count and exercise the intended path; a zero selection or
skipped suite is not a passing receipt. Use `pnpm --filter <package> exec vitest run <file>` and
`pnpm --filter <package> typecheck`; database tests use `useVenueDb` with real migrations and
append-only setup. Run browser tests with measured memory headroom and a deadline. Do not run
whole-workspace tests or each package's full coverage suite after every task. Task-end evidence
contains the expected red, focused green, types, changed assertions and the applicable LOOK;
do not repeat an unchanged LOOK for each edit.

At each PR's end, run its remaining focused integration/root checks, then let the normal
pre-push hook run local checks once. Never bypass it. Required package suites and coverage are
CI's broad validation; read change selection and wait for required **current-head SHA** checks.
A broad local run is for an actual cross-package concern/failure, not the finishing ritual.
Use `git commit -s` for implementation commits; never edit shipped migrations or commit to main.

Each PR takes **two FULL Claude run-it reviews** using the project's direct-driver review workflow in
throwaway checkouts with the complete candidate tree and dependencies installed. Read completed
findings, not a successful wrapper exit. The first reviews the complete branch against this
contract and changed-check inventory. The second puts the checklist aside and exercises the
feature as a person would, per review item below, looking for missed behavior and false claims.
Do not substitute two static reads for two run-it reviews. Triage findings in the feature
worktree, keep focused receipts for fixes, and follow `finish-branch`'s exact-head approval rules.
No product reviewer, tests or implementation runs are part of STEP 0.

| Review item (both reviews; second explores without the checklist) | Required observation in implementation |
| --- | --- |
| Language resolution | Distinct subtitle/footer maps; exact language, current-language fallback, then live venue string or nothing; a third department language never supplies text; change current language after sale |
| Two departments and null-sale | Same printer, distinct logos/text; null/absent header use live venue fields and never default-department fields; thermal/till address switch remains |
| Reprint/copy/A4/till order | Rename/disable after sale; current authored text, recorded trading name; subtitle above legal name, A4 logo, duplicate and QR/mandatory fields preserved |
| Optional failures | Corrupt imported rows, read/format/job failures with retained operation evidence; sale commits once and optional partial writes do not survive recoverable failure |
| Delivery boundary | Null/invalid-email department uses default only for contact; invalid default suppresses offer; same selected phone/email. No new consent step/evidence; existing checker stays until separate rewrite |
| Editor | Stacked headings/warnings; locale refusal scroll+inline+bottom summary; picker, Keep/Discard, global draft, late save, passive reads and #1422 reconnect |
| Media/transfer | Global plus explicit department logo references (including disabled), inheritance not multiplied; links/refusal, remapped transfer and retained global strings/pair/switch |
| Presentation | EN/ES UI, receipt languages, both themes, desktop/390 px; thermal 58/80, A4 and preview legible with long fields and no logo |

## Part A — department authored fields and the standalone editor

### Task A1: Pure shapes, validators and two-candidate text resolution

**Files:** shared receipt contracts/resolver and exports/tests; layouts types/validate/errors and
exports/tests. Retain global authored functions and one-string storage/render semantics through A13.

- [ ] Write and run failing tests for exact-language text, blank → current language, blank in
  both → no department value **even with a populated third language**, then live global string
  or nothing. Pin field independence, department fallback winning over venue default, later
  global edits, clearing a department override, null venue-only trim, no phone/email inheritance
  for a department, and identical effective values in empty-field hints/preview/printing. Warnings
  include the current language, omit all-empty maps.
- [ ] Add validation cases: allowed maps, 201-character known-language text identifies field and
  language; unknown language refuses without echo; null/array/non-string/prototype-shaped keys;
  phone/email/logo existing rules; department `printAddress` refused; retained verbatim global strings/whitespace,
  defaults false accepted and explicit null/unknown keys refused. Observe the expected failures
  before implementing.
- [ ] Implement shared pure shapes, map resolver and `resolveReceiptTrim`; validators stay pure in layouts. Preserve
  existing receipt error vocabulary, add typed locale params/EN/ES wording, check siblings.
- [ ] Run focused shared/layouts tests, affected types and error reachability guard when changed.
  Use deletion controls for the exact/current-language choices and warning detection, restoring
  the implementation afterward. Do not mandate full shared mutation/coverage for this task.
- [ ] Record one green checkpoint and its changed-check receipts; sign off any commit.

### Task A2: Department table, bounded store, seats and distinct department lookups

**Files:** venue-service schema/store/classification/transfer/service/index/operations/routes-list
and tests; module seats; generated venue-service migration; relevant root schema/migration guards.

- [ ] Test first through `useVenueDb`: no row → empty; maps/pictures round-trip; keyed replacement;
  another-location refusal; inactive recorded department read; missing/null sale header → null
  with **no default lookup**; authoritative order context lookup; separate designated default
  lookup; list response includes `isDefault`. Observe expected failure.
- [ ] Test malformed JSON/field/map/entry/picture/oversized payloads through the real store;
  preserve each good field, bound returned payload and query count. Inject an optional SELECT
  failure and check empty rendering result plus a bounded diagnostic, not a successful save.
- [ ] Declare table/FK/key in TypeScript, `state` classification and remapped transfer reference;
  add plain-JSON store/seats and explicit list `isDefault` projection. Do not import layouts'
  runtime index into venue-service. Validate at the server boundary before writes; store enforces
  location and both-picture requirements. No new core table, copied defaults or converted global
  strings. Contact seats use
  `receiptDefaultDepartment(tx, cfg): Promise<string | null>` for the designated default id.
- [ ] Only after the BUILD gate, generate SQL against the landed venue-service journal. Inspect
  actual SQL for table rebuilds and incoming foreign keys. Apply the upgrade from a populated
  predecessor with installed triggers, try real valid/invalid FK writes and record outcome.
  This plan does not assume a generated migration is additive or succeeds with rows.
- [ ] Export/import between different department ids, including explicit department pictures and
unchanged global
  strings/pair/false address setting. Empty departments still inherit after import. Invalid imported
  optional data must not bypass read bounds.
- [ ] Focused store/list/transfer tests and types; run the relevant root guard set once for this
  checkpoint: schema-constraints, classification-complete, column-vocabulary,
  two-file-foreign-keys, id-columns-are-references, module-graph-honesty,
  migrations-match-schema, journal-monotonic, migration-upgrade, append-only-triggers and
  behavioural-triggers. Run fiscal `inmutabilidad` unedited if required by the actual generated
  migration/rebase. Retain SQL/upgrade/FK receipts; do not claim outcomes before running.

### Task A3: Department routes and retained global authored defaults

**Files:** server management-api/receipt-logo/tests; layouts retained receipt-store/tests;
dashboard API methods/types/tests.

- [ ] Failing routes: missing row/maps, known/unknown language refusal, department address-key
  refusal, unknown/other-location id, permission, explicit disabled department, global strings/
  false/absent/null. Department GET returns `{ receipt, venueDefaults, languages, warningLanguages,
  venueAddress }`; venueDefaults is the validated `VenueReceiptSettings` subset, never merged
  into the authored receipt. PUT `{ receipt }` writes only that department with server languages.
- [ ] Keep GET/PUT `/management-api/receipt` and their full existing global string/contact
  semantics. Add GET/PUT `/management-api/receipt-settings` with `{ settings }` for the defaults
  subset. The server patches logo/subtitle/footer/printAddress into the current global config,
  preserving legacy phone/email and independently deriving/reusing global rasters. Require
  `layout.configure`; do not let a department save overwrite any global fields. Test dirty
  global+department saves in either order and global contact preservation.
- [ ] Keep filename checks and valid-pair reuse spies/controls for both stores. An inherited
  global logo reuses its OLD global pair with no redraw/copy/backfill. Saving an unchanged
  explicit department logo reuses only its own pair; a filename match cannot cross owners. Pin an explicit valid filename with corrupt raster:
  omit its picture, never substitute a different global logo; invalid filename is empty.
  Draw changed explicit logos outside the transaction, re-check source/image before writing,
  and require both valid widths. Clearing a department logo clears only its pair and restores
  inheritance; clearing a global logo clears its pair without clearing department logos.
- [ ] Harden global optional projections under the bounds above. Test malformed global JSON,
  one oversized string, one oversized raster beside valid strings/false, optional SELECT failure
  for each source separately and together. Preserve good fields; management saves still refuse
  errors. Run focused routes/store/types/registry checks and record checkpoint.

### Task A4: Thermal print/reprint/copy, exact order and optional failure containment

**Files:** server receipt-print/document/ticket tests, address/sample helpers and the chosen
optional document enqueue boundary. Keep drawer and fiscal paths separately intact.

- [x] Reproduce changed behavior with failing tests: two departments on one printer; null id and
  absent header with distinct venue/default-department fields show only venue fields; disabled recorded
  department/current edited fields; current address changed after issuance with global true/false;
  each language candidate and no-third-language control. Preserve the snapshot trading-name cases.
  Include a null-id header containing an inconsistent trading name: omit it but keep venue
  logo/subtitle/footer. Empty department fields inherit live; phone/email do not inherit.
- [x] Change the exact top-order pin at `receipt-ticket.test.ts:2630` to subtitle before legal
  name for both widths; preserve every other ordered line/centering/QR assertion. Record this
  changed check with earlier owner answer 7 (top order); record the later answer 4 for
  A4 suppression and the thermal/till F1 address-check changes separately. Test absent trading name
  and duplicate optional elements.
- [x] Resolve using saved department only; read current receipt language separately from filed
  language; apply global address setting independently. Use existing bounded bitmap decoder.
  Route automatic, explicit original, reprint and translated copy through that presentation.
  Pass surface `thermal`; even thermal F1 with a filed domicile follows the optional address
  switch. Keep filed domicile unchanged and separately pin A4 suppression in A5.
- [x] Implement decision 19's recoverable optional failure boundary after investigating the real
  transaction/savepoint API. First observe injected read/format/partial-job failures in focused
  tests; then contain them. Run an actual refusal/savepoint probe: optional partial rows roll
  back, sale/tender/header/numbering commit once, replay adds no sale. Do not catch fiscal or
  drawer writes. A failure invalidating the whole engine transaction is a stated limit.
- [x] Preserve original-versus-copy status and explicit delivery enrolment. Test failed enqueue
  never records successful delivery and later retry remains possible; already-issued manual
  print failure does not rewrite fiscal facts. Run focused thermal/print/sale integration cases
  and affected types. LOOK once at task end for thermal 58/80 and retain bytes/screens/evidence.

### Task A5: A4 logo/order and independent delivery contact selection

**Files:** server invoice-document/page/pdf/tests; new `invoice-email-contact.ts`/tests and
venue-service authoritative order/sale/default lookup seats. Existing invoice-choice/delivery
suites are boundary controls, not a consent rewrite.

- [ ] Observe failing A4 tests: visible department or inherited venue logo, subtitle above legal
  name, null/disabled department, language candidates then venue string. Give current address
  and filed domicile different text. A4 never shows the optional current address with switch
  true, false or absent, with/without domicile; mandatory filed domicile remains unchanged.
- [ ] Compose current fields in invoice-document; select the chosen owner's bounded stored
  picture. Add page-logo rendering centered/proportionate with existing PDF facilities.
  Pass surface `a4` explicitly to the shared builder to suppress only the optional address,
  including email PDFs/page printing. A4 projection supplies an empty optional venueAddress
  and skips that current-address read; filed issuer domicile still comes from its filed facts.
  Keep QR, page breaks, recipient and mandated F1 fields.
  Image conversion stays outside write transactions; no new stored A4 raster is planned.
- [ ] Failing contact matrix: valid department email/its optional phone; null/missing department
  or missing/invalid email tries designated default; invalid default gives null; disabled
  designated default accepted; invalid imported phone dropped; no mixing or global contact
  inheritance. Pair null-contact fallback with a venue-only printed-receipt control. Tests
  resolve both authoritative order context and saved sale department, never caller-supplied ids.
- [ ] Implement `resolveInvoiceEmailContact(tx, cfg, source)` under decision 17. Keep provider
  availability at the eventual offer boundary; no offer if provider or selected contact is absent.
  Expose the helper for receipt/contact integration with real store tests. No new offer endpoint
  or client rollout is needed at this audited base; wire a real landed offer consumer only if
  one exists when executing, with its existing session/action/zone/passive-read gates.
- [ ] Do NOT pass this selector to `checkedInvoiceChoiceDelivery`, create consent snapshots,
  alter `InvoiceEmailConsent`/`StagedInvoiceDelivery`, drop the email CHECK, or add an acceptance
  control. Current staging/reservation still uses genuinely supplied legacy consent/global
  contact and is not the new offer contract. Retain its checks/fixtures unchanged; no invented
  statement version/time/person/contact or schema workaround. The single backlog item owns
  completing consent-free core delivery and reconciling the future F1 rollout.
- [ ] Run focused A4/PDF/contact plus existing invoice-choice/delivery route controls and types.
  LOOK once at task end: A4 logo/no logo, long content, duplicate and another language. Retain
  delivery idempotency/provider gates and untouched fiscal fixtures; report the core limitation.

### Task A6: Preview composes department and global drafts with independent language

**Files:** server receipt-preview-api/sample-receipt/tests; dashboard API preview method/tests.

- [ ] Failing preview cases: picked department draft maps, independent preview language and
  current-language fallback, third language not used before venue inheritance; unsaved global
  defaults/switch; explicit inactive
  department; unknown/other-location/permission/malformed request refusals. Null department
  explicitly previews current venue fields, never default-department text.
- [ ] Add POST `/management-api/receipt-preview` with bounded JSON `{ departmentId, receipt,
  settings, language, paperWidth }`, where departmentId may be null for a venue-only preview.
  Derive current receipt language/allowed keys at the server; validate department maps and
  global strings. For departmentId null ignore/reject nonempty department config, never use it
  as a default. Compose both drafts without persisting inherited fields.
  Use the same renderer, address helper and top order as printing, without storing the draft.
  Bound payload/body parser and any image work; measure request handling during implementation.
- [ ] GET stays only until callers migrate, then retires in A13. Do not call a compressed/single
  resolved GET payload proof of arbitrary-language validation or header-size safety.
- [ ] Use existing preview-safe sample fiscal data. Run focused real-route preview/API tests and
  types. Inspect preview once at task end at both thermal widths; no sale/config writes occur.

### Task A7: Fresh sale, replay, invoice-first and bill answers drive the till view

**Files:** server till-sale/bill-payments/till-api and relevant receipt/source tests;
till layout/API/client/app/ticket-view/tests.

- [x] Failing wire/view cases for every ticket constructor and `readSettledTicket`, direct bill
  ticket plus `resultOf`'s replay branch. Distinct departments, a later text/address/global-switch
  edit, null/absent header and cleared global defaults after a rich previous receipt expose wrong
  caching. Pin inherited
  current defaults and no department phone/email inheritance on each constructor.
  Keep original transaction values, drawer side-effect gating, recorded names and replays.
- [x] Add `ReceiptPresentation` to each invoice answer: `receiptTrim`, current `venueAddress`
  and separate `venueReceiptSettings`. Reuse one assembly helper at all constructors so
  settlement/invoice-first/card/bill branches cannot silently omit it. Optional source failures
  compose surviving fields under decision 19; required facts are not replaced with defaults.
- [x] Remove authored `receipt` from boot and the till's boot-owned authored state; retain global
  boot settings only where used for venue UI. Render each answer's presentation in ticket-view;
  apply global switch, current address, subtitle-before-legal order and existing filed F1 domicile
  rules. Do not take department trim from device profile, current zone, another answer or boot.
- [x] Assert a receipt-only replay resolves current authored text but returns original fiscal,
  tender/change and trading facts and performs no repeat drawer/filing action. Run focused
  server wire + till client/view/app cases and types; LOOK once at task end on phone/desktop,
  both themes, with two departments and a null-sale venue-only receipt.

### Task A8: Media counts global and explicit department logos

**Files:** media images/tests/descriptor/package manifest; dashboard usage types/library/live
queries/strings/tests; lockfile only if normal installation changes it.

- [ ] Failing tests: same file globally and in two departments counts THREE stored uses, including
  a disabled department. Inheriting empty departments add zero uses. Clearing one explicit
  reference leaves the others; deletion remains refused until all explicit/global references
  clear. A global-only file is in use; an unreferenced file is deletable.
- [ ] Retain tenant logo query/count, add department rows and venue/department usage labels/links.
  Bound malformed imported JSON handling. Add venue-service dependency and descriptor requires;
  verify cycles/seams. Include `tenant_receipts`, `department_receipts` and `departments` in
  relevant live queries; neither the global resource nor its usage consumer retires.
- [ ] Venue use links to global defaults; Part A department use opens explicit picker id (disabled
  maintenance included); Part B updates department links to its actual Receipt tab. Run focused
  media/client/library/types and workspace/module/composition guards; record checkpoint.

### Task A9: Standalone department editor with a separate global section

**Files:** dashboard receipts-screen, API/live queries/types, strings/codes and focused sibling
screen/client/a11y/save-state tests.

- [x] Failing user-action tests: picker edits and previews the same department; active default
  selection/first-active alternative, explicit disabled maintenance URL, no active department,
  department load refusal while global fields remain usable; department address key never sent.
- [x] Load department config through scoped query, global defaults/switch via their own query, and receipt
  language/description via their existing venue APIs. Department heading replaces “Every
  location”; “Subtitle” names the field. Empty department fields show ONLY their effective inherited value;
  empty logo shows the inherited logo thumbnail without adding it to the draft. Global logo,
  one-string subtitle/footer, Print the address, receipt language and description stay below.
  Global phone/email remain stored/API-readable for current delivery and venue-only rendering;
  the new defaults form does not edit, delete or inherit them into departments.
- [x] Carry A331 immediately, not as a later polish step: separate `draftScopeFor` identities for
  selected department and global defaults/switch plus existing language/description scopes;
  `saveActionState` makes each Save quiet/disabled until changed, then active, and each save
  handler returns early when that scope cannot submit. Submit only that scope's changed body.
  Clearing/adding an explicit logo changes the department draft; live inherited hints/thumbnails,
  preview/picker language and global-default refresh do not. A global save changes effective
  preview/hints without creating a department override or adopting a dirty draft as its baseline.
- [x] Include `*.unsaved.test.ts` and save-state tests using real controls: pristine disabled,
  changed enabled, reverted disabled, double/unchanged action sends no request, rejected save
  keeps the draft, field refusal inline plus localized bottom summary, successful write closes/
  commits before separately reporting refresh failure. A refusal alone never disables the action.
- [x] Passive subscription callbacks assign snapshots and never reset dirty drafts or rerun a
  loader. Track read/action errors separately and retain a newer subscription snapshot over
  an older reload. Run focused client/screen/a11y/save tests and types; inspect changed fields
  once at task end at 390 px/desktop in EN/ES and both themes.

### Task A10: Department switches, late work and reconnect keep drafts accountable

**Files:** dashboard receipts-screen unsaved/switch/save tests and dashboard-app venue-settings
navigation/unsaved tests. Apply the same rules later in B2's host.

- [ ] Failing real-control journeys: dirty department+global defaults/switch/language/description, switch
  department, Keep preserves all; Discard switches only department and retains global drafts;
  clean switch is immediate. DepartmentId-only navigation gets one page-level negotiation,
  never a second app prompt. Cross-panel navigation negotiates all outstanding scopes.
- [ ] Isolate fetch, preview, error and save generations by submitted department id. Late success
  commits the submitted baseline, never another department's draft; late failure stays attached
  to the submitting context, not the selected department. Out-of-order snapshot/read cannot
  restore old config or erase a newer action refusal. Unsubscribe on switch/disconnect.
- [ ] Explicit #1422 reconnect test: type, detach and reattach the same element; either preserved
  typed input remains dirty with a registered scope, or a deliberate discard makes it clean and
  visibly resets it. Choose preservation for this editor; recreate scope registration without
  adopting dirty values as the saved baseline. Global and department drafts both remain guarded.
  Current `disconnectedCallback` resets scopes/fields: follow the whole lifecycle, not its name.
- [ ] Run focused unsaved/reconnect/navigation cases and types. Record changed navigation
  assertions. LOOK once at task end for Keep/Discard and a reconnect with a visible dirty field.

### Task A11: Stacked language fields, warnings and exact locale refusal placement

**Files:** receipts-screen translation/render/refusal/a11y tests, strings/codes.

- [ ] Failing tests: all allowed languages stacked, no tabs; receipt language first with correct
  label; headings warn only per decision 8; all-empty department maps show no warning even with
  global defaults; note once.
  Typing one locale changes only that map entry, and clearing it sends the intended empty change.
- [ ] Render two shared fields per heading with semantic names `headerSubtitle-<tag>` and
  `footerMessage-<tag>`. Use shared tokens/primitives; keep user-visible hints as placeholders.
  Empty placeholders contain only effective inherited values under decision 7, and remain
  draft-free on live global changes. No forced translations or English choice. Compare map
  values, not key order; never count inherited values as authored translations/warning inputs.
- [ ] A refused known field+language attaches under that field and scrolls the field into view
  after rendering, plus the localized bottom summary on its own line above buttons. Unknown
  language refusal is safely summarized without creating arbitrary DOM ids/fields. Editing the
  refused field clears only its own relevant message; no language tabs to select.
- [ ] Run focused locale/refusal/map/save/a11y cases, affected types. LOOK once at task end in
  EN/ES and both themes at 390 px and desktop, including a refusal in the last stacked language.

### Task A12: Independent preview language and complete Part A presentation pass

**Files:** receipts-screen preview/API tests and relevant strings; server preview render tests
only if new findings require them.

- [ ] Failing tests: initial preview current language; changing preview language changes no saved
  draft, changing receipt-language draft does not silently change independent preview selection;
  fallback uses server's CURRENT saved receipt language until a language save succeeds. A successful
  receipt-language save refreshes that current fallback while retaining an explicit preview choice.
- [ ] Preview POST sends selected department's authored draft maps and global defaults/switch draft,
  not a resolved string masquerading as validated maps. Handle stale response generations and passive reads.
  Preview selection uses decision 6's languages; it is separate from the stacked editor fields.
  Automatic preview POSTs send the preview-specific Boolean `passive: true`; the route authenticates
  without touching session activity. Explicit previews omit it. The generic background client
  continues to mark only GETs passive.
- [ ] Focused preview/API/types. Once at task end, do the complete LOOK: EN/ES UI, all receipt
  choices, both themes, desktop/390 px, short/long/empty fields, logo/no logo, two departments,
  null-sale venue-only sample, 58/80 thermal, A4, independent language and inline refusal scroll.
  Use the managed dev stack (`wa-wt demo <worktree-name>`), record screenshots/bytes/PDF and
  actual observations. This run complements, rather than repeats, earlier task-end LOOK evidence.

### Task A13: Retire superseded presentation, audit retained defaults and finish Part A

**Files:** retained layouts store/defaults/exports/tests; obsolete preview GET/fixtures, dashboard
queries/stubs/app tests and till boot fixtures; current documentation and dated historical
pointers; relevant root guards. No consent schema/client/core rewrite in this task.

- [ ] Search identifiers AND prose: `tenant_receipts`, `getReceipt`, `getPrintedReceipt`,
  `getStoredLogoRasters`, `putReceipt`, `ReceiptConfig`, `headerSubtitle`, `footerMessage`,
  `printAddress`, receipt routes, “Slogan”/“Every location”/“Preview for”, language tabs, copied
  defaults, reset/backfill, address on A4, consent/contact claims. Read full base-to-tip prose
  paths and READMEs/runbooks, not only diff context. Mark retained consumers explicitly.
- [ ] Keep global table/schema/classification/transfer/singleton guard, global authored APIs and
  full `ReceiptConfig` strings/contact, global query/editor/defaults/pictures/media counts.
  Retire obsolete preview GET and boot-owned presentation only after callers move. Never narrow
  the global row to the switch, ignore old valid defaults, or use schema changes as a consent
  compatibility workaround. Defaults saves patch their subset, preserving legacy contact.
- [ ] Focused proofs: old global strings/pictures/switch survive startup and export/import without
  reset; empty departments inherit current values, clearing overrides restores inheritance,
  null/absent headers use venue-only fields, no default-department print or department contact
  inheritance; query/payload/read-failure controls for both sources. A4 omits optional current
  address while thermal/till follow the switch. Preserve filed domicile/recipient and fiscal
  invariants. Re-run actual generated SQL/populated-upgrade/FK probes after migration/rebase changes.
- [ ] Re-audit EVERY current consent reader/writer and identifier/prose path against the inventory
  in [the single consent-removal backlog item](../../backlog/printers.md#remove-the-consent-step-from-emailed-receipts).
  Preserve current checker/staging/reservation/retry/schema/client behavior and existing tests
  as boundary controls; no new consent step, accepted snapshot or fabricated evidence. Keep the
  independent A448 entry verbatim. State that consent-free email delivery is future core work,
  whereas department/default contact integration is in A5. Do not claim a legal conclusion.
- [ ] Update current A366/design-system/backlog claims. Add dated supersession pointers to A261
  receipt §5, W111/current-address claims in `2026-10-05-venue-details.md`, and receipt/contact
  claims in `2026-10-03-invoice-pdf-email-and-office-printing-design.md`, its reconciled plan,
  and `2026-10-03-full-invoices-at-till.md`. Keep unrelated historical receipts; direct future
  consent-flow work to the one backlog item rather than implementing it. This documentation
  revision edits only its allowlisted docs; those broader pointers are BUILD work.
- [ ] Run remaining focused integration and relevant root schema/upgrade/module/cycles/live-query/
  error/style/native-field/pointer guards. Keep singleton guard, fiscal golden/huella and
  inmutabilidad tests UNEDITED. List every deliberately changed assertion with final file:line
  and owner answer; no weakening unchanged behavioral assertions for a refactor.
- [ ] Complete both FULL Claude run-it reviews, verify accepted fixes, normal pre-push gate once,
  and required current-head CI suites/coverage. Keep receipt Parts A/B open until actually built;
  keep slice 6 B/C separate. Announce/continue `finish-branch`; parent handles review/landing
  for this docs-only revision. Never merge without the applicable owner landing instruction.

## Part B — Department → Receipt host (second PR, after slice 6)

The slice 6 host is now `packages/venue-service/src/dashboard/department-page.ts`,
`venue-departments-shell.ts` and their client/tests. Read their current hosting/leave contracts;
keep Part A's renderer/editor/contact rules, and use the same focused checkpoints,
A331 contract, changed-check inventory and two FULL run-it reviews for this PR.

### Task B1: Host contract and permission

- [ ] Read landed Department page/tabs/routing and dashboard-kit hosting/leave contract. Test
  first: Receipt tab available only with `layout.configure`, still under the page's management
  permission; direct URL cannot bypass it; selected department id is authoritative.
- [ ] Add the smallest host/seat required for the reusable editor. Generic dashboard-kit code
  receives a host contract, not knowledge of venue-service table/layouts internals. Keep explicit
  disabled-department maintenance access without a disabled-default fallback in the picker.
- [ ] Focused host/permission/routes/types; record checkpoint and actual host paths. Check
  dependency cycles if a new dependency is actually introduced.

### Task B2: Receipt tab with complete form and preview behaviour

- [ ] Mount Part A's department editor for the page's department. Global settings stay in Venue
  settings; no per-department address switch. Show the existing print policy and zone differences
  through slice 6's service-setting contracts; do not duplicate policy storage in receipt JSON.
  Keep trading name/print switch in their existing department policy ownership.
- [ ] Test first and implement A331 scopes, `saveActionState`, early return, `*.unsaved.test.ts`,
  #1422 reconnect, late-save isolation, passive reads, Keep/Discard and tab/page leave handling.
  Avoid nested duplicate scopes/prompts if the host already owns the same draft.
- [ ] Stack all locale fields/headings/warnings; exact inline refusal+scroll+bottom summary;
  independent preview language, live defaults/hints, thermal global-switch-aware address and
  exact top order; A4 still omits optional address.
  If the tab combines service policy and authored edits under one Save, one server transaction
  owns the logical write and returned baseline; never quietly submit the global switch too.
- [ ] Focused hosted editor/policy/unsaved/a11y/type checks; full task-end LOOK once across theme,
  width/language/locale-refusal states. Preserve all behavioural assertions moved with the editor.

### Task B3: Venue settings keeps globals; links and retirement follow the host

- [ ] Remove the standalone department picker/editor from Venue settings only once Department
  Receipt tab is usable. Keep global logo, one-string subtitle/footer, Print the address, receipt
  language and sales description
  with their A331 scopes/save guards/early returns/reconnect/unsaved suites. Describe the current
  address and defaults as venue-wide; link to department overrides. Preserve global stored contact
  for its existing consumers until the consent backlog item; no silent phone/email inheritance.
- [ ] Update media usage and department preview links to the actual host, preserve explicit id and
  permission checks, retire Part A's old route/host prose via dated pointers where historical.
  Update backlog: delete completed receipt work and keep only actual remaining A366 work.
- [ ] Focused global-panel/link/navigation/types; task-end LOOK once, complete changed-check
  inventory, both FULL run-it reviews, normal pre-push gate once, current-head CI suites/coverage.
  Announce/continue `finish-branch`; do not merge automatically.
