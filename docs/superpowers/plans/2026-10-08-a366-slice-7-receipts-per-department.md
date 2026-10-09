# Receipts per department, slice 7 — implementation plan (A366)

> **Revision 2026-10-09, A366-7A STEP 0.** This is a plan, not an implementation report.
> The owner's answers 1–16 under **2026-10-08 ~22:30 OWNER going through the A366-7p decisions
> IN DETAIL** in `/Users/clintongormley/waitron-campaign-b/questions.md:2143` govern every task.
> They replace the earlier plan defaults and mock-up wherever those disagree.
>
> **Driver and checkpoints.** Implement routine work inline with `superpowers:executing-plans`.
> Each A1–A13 task is one coherent green checkpoint: write meaningful failing behavioural tests,
> run them and see the expected failure, implement, then run focused tests and affected types.
> Do not turn each task into a whole-package coverage run or a separate review ceremony.
> Keep receipts for changed assertions and complete each task's applicable LOOK once at its end.
>
> **Build gate.** Documentation overlap is explicitly waived for this revision. BUILD is separate:
> wait for same-lane **A366-3A to land, then A366-6A, before A366-7A**. Do not generate migrations
> alongside parked 3A. Re-ground this plan on those landings before implementation.
>
> **Base inspected:** `main` **`7e4277dc4848ebdfbd7f6c7db84e0cb545141c74`**.
> Slice 1 actually landed as **`685a6074b152eeb904a66cfac9f83e8f432196ab`** (#1460), rather than
> the old inspected branch commit **`1ed9857ca9dd6589dd280b5ac3df35cce27f5fc1`**.
> All current source pointers below refer to this main tree. They are read inventories or stated
> inferences; no product tests, migrations, rendering or fault probes were run during STEP 0.

**Goal:** you can give each department its own logo, phone, email, subtitle and footer. Subtitle
and footer are written per receipt language. Every receipt surface uses the sale's recorded
department and its current authored fields; the trading name and its switch remain the sale's
snapshot. A sale with a null department or no header prints **no department authored fields**.
The legal identity and tax number remain, and the **current venue address** is governed by one
**global Print the address switch**. Neither that switch nor the address moves to a department.

**Architecture:** add `department_receipts` to venue-service, one row per department, reached
through `VenueServiceContribution` seats. Keep `tenant_receipts` as the existing singleton storage
for the global address switch, with readers/writers narrowed to that setting; remove its authored
field APIs and consumers in A13. Do not copy old authored fields into departments. Validation and
receipt layout stay in layouts; browser-safe receipt types and text resolution live in shared.
The dashboard imports those pure shared exports, not layouts' database-bearing index. Part A
keeps a working department picker/editor in Venue settings → Receipts. Part B moves that editor
into slice 6's Department → Receipt tab and leaves global settings in Venue settings.

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md),
§2's dated receipt note, §6's print policy, §9.1, §11, §12 and §13 item 7. The revised §11 is the
receipt contract. The old screen-4 mock-up is illustrative: its English choice, language tabs,
address placement and any earlier plan fallback are superseded by the owner's answers.

**Two PRs, FULL path:** Part A is A1–A13; Part B is B1–B3 after slice 6. Both follow the two
run-it review path below. Part B's dependency remains even though the lane now also waits for
6A before building Part A. A smaller Part B is acceptable if landed 6A already provides its host;
re-read that host before choosing exact files.

**Optional reset statement for Part A:** “Optional venue reset: old authored receipt fields are
not carried over; each department starts empty. The existing global Print the address setting
persists without a reset.” No automatic reset is planned. No backfill, compatibility reader or data conversion
is authorised. This plan retains the global table so a table-drop migration is not needed for
that setting. Actual new SQL, upgrades and foreign-key writes still need the implementation
probes in A2/A13; source reading is not evidence that they will succeed. Part B says “no venue
reset needed” unless its eventual change establishes otherwise.

## Current source inventory and re-grounding

### Slice 1: compare the inspected branch with the landing

STEP 0 ran `git rev-parse 685a6074b 1ed9857ca` and read this comparison:

```sh
git diff 1ed9857ca9dd6589dd280b5ac3df35cce27f5fc1 685a6074b152eeb904a66cfac9f83e8f432196ab -- packages/module/src/module.ts packages/venue-service/src/classification.ts packages/venue-service/src/configuration-transfer.ts packages/venue-service/src/index.ts apps/server/src/till-api.ts apps/till/src/till-app.ts apps/till/src/api/client.ts apps/server/src/till-api.receipt.test.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts
```

In that listed path set only `till-api.receipt.test.ts` and `till-app.ts` differ. The test gained
recorded-name/content-translation cases: retain those behavioural assertions when moving its
receipt fixtures. The till changes concern its icon and backlog pointers. A separate diff of
`apps/server/src/sale-till-source.receipt.test.ts` and `packages/venue-service/drizzle` returned
no changes between those two commits. These are Git comparisons, not runtime verification.
Re-read current functions after the mandatory 3A/6A landings; regenerate new migrations from
that tree, never hand-renumber snapshots or edit shipped SQL.

### Current receipt and consent call paths (source reads)

| Path | Current pointer and what was read | Planned boundary |
| --- | --- | --- |
| Department recorded at issuance | `packages/venue-service/src/operations.ts:614` records a null department for a null zone; `:628` reads the saved department and trading-name snapshot; `packages/module/src/module.ts:467` already exposes `departmentId` | Use this saved id for rendering; no default-department print lookup |
| Department list | `operations.ts:50` declares `Department`; `:58` explicitly selects fields and orders by `isDefault`, but does not return it; `packages/venue-service/src/routes.ts:594` serves the list | Add `isDefault` to projection/contracts for editor selection and consent lookup, not a new schema column |
| Current authored store | `packages/layouts/src/receipt-store.ts:95` explicitly says a failed read still throws; `:101` selects the printed config; `:114` reuses stored rasters; `:133` writes a validated pair | Move authored storage; preserve defensive field/picture handling and implement bounded optional-read containment |
| Thermal preparation | `apps/server/src/receipt-print.ts:145` builds bytes, `:162` reads live authored fields, `:163` reads address, `:164` reads saved header | Resolve department trim separately from the current global address |
| Automatic/original/copy jobs | `receipt-print.ts:202` automatic enqueue; `:257` reprint; `:271` copy; `:341` original status; `:392` explicit original also enrols invoice delivery | Keep policy, printer/profile, original/copy and delivery semantics; contain optional receipt failures |
| Shared top block | `apps/server/src/receipt-document.ts:149` logo, `:150` trading name, `:154` legal name, `:155` subtitle, `:156` address; `:164` full-invoice filed domicile | Move subtitle before legal name; preserve the separate mandatory F1 domicile |
| Exact thermal assertion | `apps/server/src/receipt-ticket.test.ts:2586`, exact list at `:2630`, both paper widths | Deliberately reverse legal-name/subtitle positions, keeping QR, centring and every other assertion |
| A4 data/layout/PDF | `apps/server/src/invoice-document.ts:91` reads live receipt; `invoice-page.ts:20` permits text/QR only and `:80` skips logo; `invoice-pdf.ts:20` renders text/QR | Department trim plus bounded logo rendering on A4, sharing top-block order |
| Consent check | `apps/server/src/invoice-choice-delivery.ts:30` checks staged delivery; `:78` uses `getReceipt`, `:85` compares email and phone; `:105` reserves the staged choice | Resolve the order's contact with its own default rule; preserve the recorded consent payload |
| Consent caller/gates | `apps/server/src/working-order.ts:3468` is the checked-delivery call; `till-api.ts:1717` gates invoice choice, `:1736` obtains provider availability; `boot.ts:1430` supplies it | Pass authoritative order context, never a caller-supplied department; share contact selection with any offer |
| Sale/replay answers | `apps/server/src/till-sale.ts:203` result shape; `:626` settled replay; new-ticket constructors `:829`, `:1364`, `:1514` | Every answer with an invoice carries freshly resolved trim and global address presentation |
| Bill payment answers | `apps/server/src/bill-payments.ts:741` makes its own ticket; `:922` uses it or `readSettledTicket` | Cover both branches, including a previously issued invoice |
| Till boot/view | `apps/server/src/till-api.ts:1182` reads boot receipt; `:1234` returns it; till `till-app.ts:2281` saves it, `:8612` passes it; `screens/till-ticket-view.ts:530` renders its logo and `:545` legal name before subtitle | No department authored fields from boot; view uses the current answer's presentation |
| Address | `apps/server/src/venue-address.ts:31` applies `printAddress`; `:37` reads current address; `:46` reads it unconditionally | Global setting separate from trim; no new sale address snapshot |
| Management/preview | `management-api.ts:1229` / `:1245` current GET/PUT; `:1268` reuses pictures; `receipt-preview-api.ts:191` preview, inactive-department check `:215` | New department routes and separately validated global settings; identical preview semantics |
| Dashboard drafts | `apps/dashboard/src/screens/receipts-screen.ts:220`, `:237`, `:257` draft scopes; `:274` save state; `:371` connect, `:379` dispose/reset | Carry A331 to every new scope and cover reconnect (#1422) |
| Browser queries/types | `apps/dashboard/src/api/client.ts:2585`, `:2605`, `:2612`, `:2626`; live query `api/live-queries.ts:326`; till client `:123`, `:837` | Replace authored venue read/query; retain a distinct global-settings query |
| Media | `packages/media/src/images.ts:91` usage type, `:230` tenant usage, `:659` count; `module.ts:30` dependencies; dashboard `image-library.ts:32`, `:44`, `live-queries.ts:11` | Read department rows; each use names/links its department |
| Existing global row/guard | `packages/db/src/schema/tenant-receipts.ts:18` plain JSON/singleton; core transfer `configuration-transfer.ts:63`; `scripts/schema-constraints.test.ts:628` | Retain the table, classification, transfer and singleton assertion for the global switch |

The source search for `invoiceEmailAvailable`, `checkedInvoiceChoiceDelivery`, `contactEmail`,
`contactPhone` and `emailAvailable` in non-test server/till files found the staged check and
provider callback, but no current till contact-offer UI. That is an inventory, not proof about
all runtime consumers. A5 supplies one shared contact resolver to the check and the offer
contract without building A231's later F1 customer UI or changing its rollout gates.

### Read-only overlap audit: slices 2/3/5

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
The docs waiver permits this revision; it does not permit concurrent BUILD. After 3A then 6A
land, inspect every changed shared path (and any landed 2/4/5 work), integrate their contracts,
and generate against the landed journal. Part B requires the actual slice 6 department host.

## Decisions 1–20 (owner answers applied)

1. **Two PRs.** Part A builds the standalone department editor; Part B integrates the Department
   Receipt tab. Neither part may bypass the 3A → 6A → 7A BUILD order. Part B depends on slice 6.
2. **Data ownership.** `department_receipts` belongs to venue-service: `department_id` primary
   key/FK to `departments.id`, `receipt` plain JSON, `logo_rasters` nullable JSON, `updated_at`.
   Use the shared column vocabulary, classify it `state`, export it in that module's configuration
   transfer with a declared id reference. No row means empty authored fields. Its JSON holds
   only logo/phone/email/subtitle/footer, never `printAddress`, trading name or legal identity.
   The existing core singleton holds only the global switch in the new API/read contract.
3. **Current authored fields on reprints.** Read the recorded department's current row for every
   print, copy, reprint, A4 and on-screen answer. Keep the recorded trading name and
   `printTradingName`. Do not snapshot new authored fields or rewrite filed facts. Preparing a
   new reprint/copy differs from retrying transport of an existing failed job: the latter keeps
   that job's bytes/history (`receipt-print.ts:406`), rather than rewriting the queued document.
4. **No-department rendering.** A null `departmentId` or absent sale header resolves to `{}` and
   no logo. Never query a default department on this rendering path. Legal identity/NIF still
   print; the current address prints according to the global switch. A non-null recorded
   department may be disabled: its current row still applies. Missing/invalid optional data
   yields empty fields, not another department's brand. A null-department header must not show
   a trading name either, even if inconsistent imported header data contains one; leave the
   recorded row unchanged and render venue identity only in that block.
5. **Media ownership.** Media reads `department_receipts` directly, adds the workspace dependency
   and descriptor `requires` for venue-service, and names each department in usage results.
   Re-run the workspace-cycle/module dependency guards during implementation; this plan makes
   no executed claim that the proposed dependency is acyclic. Count disabled departments too,
   because their receipts remain live on reprints. Part A links to its picker; Part B links to
   the Department Receipt tab.
6. **Allowed languages.** Installed pack receipt choices plus the current venue receipt language,
   deduplicated with that language first. Spain: `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`
   (`packages/country-es/src/spain.ts:293`, `apps/server/src/venue-locale.ts:80`). No automatic
   English or content-language list. Unknown keys are refused without echoing arbitrary keys.
7. **Text resolution has exactly two candidates.** For each field separately: nonblank text in
   the printed language → nonblank text in the **CURRENT venue receipt language** → nothing.
   Whitespace-only means unwritten. Never take text from a third language. Originals/reprints
   retain the filed `sales.locale`; that differs from the current fallback language after a
   venue change. If neither candidate has a footer, another language's footer stays unprinted.
8. **Warning per language.** Put ⚠ beside a language heading when that language lacks a subtitle
   or footer another language has. Include the current receipt language. No warning when all
   optional texts are empty. This warning does not make translations mandatory.
9. **Mock language labels.** Label the current language “(receipts)” and others “(copies)”. Use
   decision 6's choices; the mock's English is not an added language.
10. **Exact top order.** Logo → recorded trading name (if enabled) → subtitle → legal name →
    current address (global switch) → phone → email → DUPLICADO (when applicable) → NIF.
    Omit absent optional elements without reordering the rest. Thermal, A4, preview and till
    match. The fiscal QR/VERI*FACTU prefix and filed F1 recipient/issuer particulars remain
    separately mandated; the global switch never suppresses a mandatory filed domicile. Apply
    the optional current-address block to F1 too, rather than retaining the current suppression
    at `receipt-document.ts:156`; keep the filed domicile separately even if its text matches.
11. **One global address switch.** `VenueReceiptSettings = { printAddress?: boolean }`; absent
    means show the current address, `false` hides the optional venue address. Keep it in Venue
    settings and the existing global row. Explicit null, numbers, strings and department-level
    `printAddress` are refused. Only logo, phone, email, subtitle and footer move.
12. **Subtitle wording.** “Subtitle” / “Subtítulo”, with a placeholder explaining that it prints
    under the trading name, above the legal name. Use shared field primitives and semantic names.
13. **Permission.** Department receipt reads/writes/previews require `layout.configure`, wherever
    mounted. Accept an explicit disabled department of this location for maintenance/reprints;
    refuse unknown/other-location ids. The Department page keeps its existing management gate;
    its Receipt tab also requires this permission. Global switch edits use the same permission.
14. **Part A picker.** “Department” selects both edit and preview context, above department fields;
    global switch, receipt language and sales description are below. Normally list active
    departments; select the active default, else the first active. Do not add a disabled default
    solely for missing-sale fallback. An explicit disabled-department URL/media link remains
    editable with a disabled label; that maintenance reason is separate. A department read/list
    failure does not disable loaded global settings. Changing departments negotiates only that
    department's draft; preserve global drafts and isolate late saves/reads.
15. **Independent preview language.** Starts at the current receipt language; changing it changes
    neither the saved receipt language nor an authored draft. Preview gets that printed language
    and the current fallback language explicitly. Use POST with the bounded draft payload (A6),
    rather than making URL size an unmeasured guarantee about GET. Preview includes the unsaved
    global switch and matches the renderer.
16. **Stacked translations.** All languages visible one after another; no language tabs. Each
    heading names the language and its warning; explain the warning once. Names stay
    `headerSubtitle-<tag>` / `footerMessage-<tag>`. A refusal naming field+language appears
    under that exact field, scrolls it into view and adds the localized bottom summary above
    the buttons. It does not open/switch a language tab.
17. **Separate consent contact resolver.** Determine the order's department from authoritative
    venue-service order/zone context; for a completed-sale offer use its saved department.
    Missing department uses the location's `isDefault` department **for consent only**.
    Watcher default retained: missing/invalid department email also tries that default; if the
    default lacks a valid email, no email offer and `invoice_delivery.email_unavailable` on
    attempted selection. Take optional valid phone from the SAME selected contact, never mix
    departments. A disabled default remains eligible as the designated contact; it need not be
    an automatic editor choice. Provider availability is an additional gate. Check the same
    chosen email/phone as the offer, and store the accepted consent snapshot. Later text edits
    do not rewrite recorded consent; stale echoed contact is refused for a new selection.
18. **Each till answer carries its own presentation.** No boot-authored department fields.
    Fresh sale, replay, invoice-first and bill-payment answers with an invoice carry
    `receiptTrim` plus separate current address/global setting. The switch is not in trim.
    Read current trim on replay; retain filed language/identity/trading-name facts. Empty
    trim clears the previous department's logo/text. Do not fill a missing invoice from boot.
19. **Defensive, bounded reads and failure containment.** Imported optional rows can be malformed;
    bad fields/maps/entries/rasters are dropped, preserving good fields where possible.
    Optional authored read failures are contained at the receipt-read boundary and return
    empty trim/no picture with a bounded diagnostic. This is not a promise that every database
    read, failed transaction or commit can succeed under engine failure. Follow the explicit
    boundaries/probes below so a recoverable optional print failure does not undo the sale.
20. **Existing picture rules.** Unchanged logo reuses its stored valid 58/80 mm pair. A new logo
    is written only with both valid pictures. Clearing logo clears pictures. Decode only bounded
    dimensions/base64 lengths as today's store does; render a changed image outside the write
    transaction. Bad pictures do not cause an imported row to throw during optional rendering.

## Types, validation and failure boundaries

These are target interfaces, not code already present. Shared owns browser-safe types/resolution;
layouts owns validation and printing; venue-service owns plain-JSON persistence and its seats.
The module contract uses pure shared types, not an import from layouts or a database table type.
The dashboard does not import layouts' index. No new dependency loop is assumed safe.

```ts
// Pure shared contracts (new); no printAddress in either authored shape.
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
interface VenueReceiptSettings { printAddress?: boolean }
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
arrays and prototype-shaped keys. The global validator allows only `printAddress?: boolean`.
Stored legacy authored keys are ignored by the new global reader, never offered as department data.

Seats beside `readSaleReceiptHeader`:

- `readDepartmentReceipt(tx, cfg, departmentId)` → authored JSON, no rasters.
- `readPrintedDepartmentReceipt(tx, cfg, departmentId, paperWidth)` → sanitized authored fields
  and a valid picture or null. A disabled recorded department remains readable.
- `readDepartmentLogoRasters(tx, cfg, departmentId)` → validated pair for unchanged-logo reuse.
- `writeDepartmentReceipt(tx, cfg, departmentId, receipt, rasters)` → scoped write; validation
  and authorisation errors remain refusals, not successful empty writes.
- `receiptDepartmentForSale(tx, cfg, saleId)` → saved id or null, **no default lookup**.
- `receiptDepartmentForOrder(tx, cfg, orderId)` → authoritative order department or null,
  **no default lookup**. A separate default/contact operation implements decision 17.

**Bounds to implement and measure:** authored JSON returned for parsing is capped at 64 KiB;
only approved language entries are retained. Query/projection must enforce the byte bound
before a huge imported payload is materialized in JS. Select a single department row, not a
full-table scan; select only the requested bounded picture for printing. For picture reuse,
read the two bounded pictures. Reuse printing's current width/height/encoded-length limits.
The global reader projects only `printAddress` from the existing singleton; it does not load
old embedded logo pictures or apply the department payload cap to that old JSON and thereby
lose a valid global `false`. Test that projection with a large legacy logo payload and malformed
JSON through the actual engine; do not assume JSON expressions cannot refuse a bad row.
No filesystem access, sharp work, retries or per-line receipt reads in a sale's write
transaction. Await queries in turn. A null-sale render does zero department/default reads;
consent takes at most the selected contact and one default lookup, with no duplicate read
when they are the same department. Demonstrate these query/payload bounds in tests.
These are size/count bounds, not a strict wall-clock deadline for synchronous engine calls.

**Containment to implement, not an asserted engine guarantee:**

- Sanitizing and optional receipt SELECT/projection/parse errors return empty trim/no logo;
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
| A3 | server management API/logo routes/tests; new global settings store/helpers/tests in layouts; dashboard API contracts are added alongside old ones |
| A4 | server receipt-print/document/ticket/tests, sample helpers and safe optional enqueue boundary; current receipt-address helper |
| A5 | server invoice-document/page/pdf/tests, invoice-choice-delivery/tests, working-order invoice-choice call, relevant till API/offer contract tests |
| A6 | server receipt-preview-api/sample-receipt/tests; dashboard preview API method and its route tests |
| A7 | server till-sale, bill-payments, till-api and receipt/source/bill/replay tests; till layout/client/app/ticket view and tests |
| A8 | media images/tests, descriptor/package manifest, dashboard usage types/library/live queries/strings/tests; lockfile if dependency install changes it |
| A9–A12 | dashboard receipts screen and its sibling tests, API/live queries, app navigation/unsaved/permission tests, EN/ES strings/codes; shared UI only if a needed primitive lacks the contract |
| A13 | old layouts authored store/defaults/exports/tests, server old management imports/routes/fixtures, dashboard old API/query/stubs, till boot fixtures; root guards as warranted, design-system and dated historical spec pointers, A366 backlog |
| B1–B3 | landed slice 6 host and its tests, dashboard-kit contract/app host if needed, reusable receipt editor/tests, media links, venue-service strings, Venue settings global panel |

`tenant_receipts`, its core schema/export/classification/transfer and singleton guard remain.
Do not remove them or generate a core table-drop migration. The narrowed store may replace
`receipt-store.ts` with a global-settings store; keeping a filename is not keeping old semantics.
Audit the retained schema's old authored-store/DEFAULT_RECEIPT comments at
`packages/db/src/schema/tenant-receipts.ts:10` and narrow or delete stale prose; changing a
comment does not authorise changing the table's SQL shape.
Old authored fields present in imported JSON must be ignored without copying/backfilling them.
Audit configuration export/import so the *new* global contract carries the switch only; historical
fixtures are not rewritten as if they had originally been authored with the new shape.

**Retired behaviour:** the venue-wide authored row APIs (`getReceipt`, `getPrintedReceipt`,
`putReceipt`, old GET/PUT `/management-api/receipt`), one-string subtitle/footer in all languages,
boot-authored till trim, preview-only department picker, “Every location”/“Slogan” labels,
implicit preview-language coupling, inactive-preview refusal, media receipt use without a
department and venue-wide email consent. Retain separately the global row/switch/current address.
The previous plan's default-department print fallback, per-department switch, any-language third
fallback and language tabs were planned defaults, not claims about existing implemented code;
remove them everywhere in the implementation artefacts.

**Changed test checks — PR inventory required**, with precise final `file:line`, old assertion,
new assertion and owner answer. A checkpoint can add focused failing tests before later
retirement, but no untouched behavioural assertion is weakened just to make a refactor pass.

| Existing assertion/area | Intentional change; assertions to retain |
| --- | --- |
| `apps/server/src/receipt-ticket.test.ts:2630` exact ordered list | Answer 7 moves subtitle before legal name on both 58/80 mm; retain QR prefix, centring, every remaining line and fiscal facts |
| Receipt-print current trim/reprint cases (`receipt-print.test.ts`, including current-trim case near `:2162`) | Move fixtures from tenant authored row to department row; retain reprint-live-text and snapshot-trading-name assertions, add null/absent-header controls |
| `till-api.receipt.test.ts`, `sale-till-source.receipt.test.ts` | Per-answer trim/global address replaces boot-authored trim; retain slice 1's recorded names/translations and fiscal/content snapshots |
| Layouts validation/store tests | Department maps replace strings; department address key is refused, global boolean validator keeps false/absent behavior; preserve logo safety and authorization assertions |
| Management receipt / preview tests | Department routes plus separate global route; inactive explicit preview now allowed, independent preview language; preserve permission/location and malformed-input checks |
| Dashboard receipt/save/a11y/unsaved tests | Picker edits as well as previews; stacked translations and correct refusal scroll; Save requires a changed draft; global switch has its own draft; keep all leave/save/reconnect behavior |
| `dashboard-app.venue-settings-unsaved.test.ts` departmentId navigation (near `:409`) | Page negotiates department draft; global draft survives; app does not double-prompt; retain cross-panel unsaved checks |
| Till boot/client/bill/replay tests | Remove only authored boot data checks; assert every invoice answer has its own empty-or-resolved trim and current global address presentation |
| Invoice page/PDF/consent tests | Add A4 logo/order and optional current address before phone on F1 (current suppression at `receipt-document.ts:156` goes); retain separately filed domicile, recipient and fiscal facts. Check selected department/default consent contact with separate null-sale print control; retain consent version/time/person, availability and delivery idempotency assertions |
| Media library/usage tests | Name/count each department rather than one anonymous tenant use; retain in-use deletion refusal |
| Core schema guard `scripts/schema-constraints.test.ts:628` | **Keep** `tenant_receipts_singleton_ck`; add the department FK/key checks without retiring the global invariant |
| Historical configuration fixture/current import tests | Old authored fields no longer render; current switch persists. Preserve unrelated transfer/id/reference checks |

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

Each PR takes **two FULL run-it reviews** using the project's direct-driver review workflow in
throwaway checkouts with the complete candidate tree and dependencies installed. Read completed
findings, not a successful wrapper exit. The first reviews the complete branch against this
contract and changed-check inventory. The second puts the checklist aside and exercises the
feature as a person would, per review item below, looking for missed behavior and false claims.
Do not substitute two static reads for two run-it reviews. Triage findings in the feature
worktree, keep focused receipts for fixes, and follow `finish-branch`'s exact-head approval rules.
No product reviewer, tests or implementation runs are part of STEP 0.

| Review item (both reviews; second explores without the checklist) | Required observation in implementation |
| --- | --- |
| Language resolution | Distinct subtitle/footer maps; exact language, current-language fallback, then no text despite another-language value; change current language after sale |
| Two departments and null-sale | Same printer, distinct logos/text; null and absent header never borrow default fields, yet legal/NIF/current address/global switch remain |
| Reprint/copy/A4/till order | Rename/disable after sale; current authored text, recorded trading name; subtitle above legal name, A4 logo, duplicate and QR/mandatory fields preserved |
| Optional failures | Corrupt imported rows, read/format/job failures with retained operation evidence; sale commits once and optional partial writes do not survive recoverable failure |
| Consent separation | Null/invalid-email department uses default only for contact; invalid default suppresses email; same selected phone/email; stale contact refusal and accepted snapshot unchanged |
| Editor | Stacked headings/warnings; locale refusal scroll+inline+bottom summary; picker, Keep/Discard, global draft, late save, passive reads and #1422 reconnect |
| Media/transfer | Shared logo counted twice (including disabled); correct links/refusal; imported remapped department receipt and preserved global switch |
| Presentation | EN/ES UI, receipt languages, both themes, desktop/390 px; thermal 58/80, A4 and preview legible with long fields and no logo |

## Part A — department authored fields and the standalone editor

### Task A1: Pure shapes, validators and two-candidate text resolution

**Files:** shared receipt contracts/resolver and exports/tests; layouts types/validate/errors and
exports/tests. Keep legacy authored functions until their consumers move in A13.

- [ ] Write and run failing tests for exact-language text, blank → current language, blank in
  both → undefined **even with a populated third language**, independent subtitle/footer and
  changed current language. Warnings include the current language, omit all-empty maps.
- [ ] Add validation cases: allowed maps, 201-character known-language text identifies field and
  language; unknown language refuses without echo; null/array/non-string/prototype-shaped keys;
  phone/email/logo existing rules; department `printAddress` refused; global false accepted and
  explicit null/unknown keys refused. Observe the expected failures before implementing.
- [ ] Implement shared pure shapes and resolver; validators stay pure in layouts. Preserve
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
  location and both-picture requirements. No new core table or authored carryover.
- [ ] Only after the BUILD gate, generate SQL against the landed venue-service journal. Inspect
  actual SQL for table rebuilds and incoming foreign keys. Apply the upgrade from a populated
  predecessor with installed triggers, try real valid/invalid FK writes and record outcome.
  This plan does not assume a generated migration is additive or succeeds with rows.
- [ ] Export/import between different department ids, including pictures and the unchanged global
  false address setting. Invalid imported optional data must not bypass read bounds.
- [ ] Focused store/list/transfer tests and types; run the relevant root guard set once for this
  checkpoint: schema-constraints, classification-complete, column-vocabulary,
  two-file-foreign-keys, id-columns-are-references, module-graph-honesty,
  migrations-match-schema, journal-monotonic, migration-upgrade, append-only-triggers and
  behavioural-triggers. Run fiscal `inmutabilidad` unedited if required by the actual generated
  migration/rebase. Retain SQL/upgrade/FK receipts; do not claim outcomes before running.

### Task A3: Scoped department routes and a separately validated global settings API

**Files:** server management-api/receipt-logo/tests; layouts global-settings store/tests;
dashboard API types/methods/tests (additive until A13).

- [ ] Failing route cases: missing row, map round-trip, known-language refusal, unknown language
  without echoed key, department address key refusal, unknown/other-location id, permission
  refusal, explicit inactive department accepted; global false/absent and null refusal.
- [ ] Add GET/PUT `/management-api/departments/:id/receipt` with `layout.configure` and location
  scope. GET returns authored config, allowed languages, warning languages and current address;
  PUT body `{ receipt }` validates server-derived languages. Do not accept trading/legal fields.
- [ ] Add GET/PUT `/management-api/receipt-settings` with `{ settings }` holding the global
  switch only. Read the existing singleton's `printAddress`; ignore old authored keys. New
  writes replace it with the narrowed settings shape. Retain legacy endpoints only while their
  remaining consumers are moved; retire them in A13, not as a compatibility promise.
  Test global `false` beside a large old logo payload: the narrowed projection preserves the
  switch without reading/carrying over those authored fields.
- [ ] Keep filename existence checks; reuse unchanged valid pair without drawing (spy/control),
  render changed image outside transaction, clear pictures on removal. Assert every paper width
  before writing. Scope raster reuse to department+logo so another department's saved picture
  cannot satisfy a stale save. Re-check the read/write race and current asset before writing.
- [ ] Run focused route/store tests, affected types and error registry guards; record checkpoint.

### Task A4: Thermal print/reprint/copy, exact order and optional failure containment

**Files:** server receipt-print/document/ticket tests, address/sample helpers and the chosen
optional document enqueue boundary. Keep drawer and fiscal paths separately intact.

- [ ] Reproduce changed behavior with failing tests: two departments on one printer; null id and
  absent header with a richly authored default still show NO department fields; disabled recorded
  department/current edited fields; current address changed after issuance with global true/false;
  each language candidate and no-third-language control. Preserve the snapshot trading-name cases.
  Include a null-id header containing an inconsistent trading name: it still shows no brand.
- [ ] Change the exact top-order pin at `receipt-ticket.test.ts:2630` to subtitle before legal
  name for both widths; preserve every other ordered line/centering/QR assertion. Record this
  changed check with owner answer 7. Test absent trading name and duplicate optional elements.
- [ ] Resolve using saved department only; read current receipt language separately from filed
  language; apply global address setting independently. Use existing bounded bitmap decoder.
  Route automatic, explicit original, reprint and translated copy through that presentation.
- [ ] Implement decision 19's recoverable optional failure boundary after investigating the real
  transaction/savepoint API. First observe injected read/format/partial-job failures in focused
  tests; then contain them. Run an actual refusal/savepoint probe: optional partial rows roll
  back, sale/tender/header/numbering commit once, replay adds no sale. Do not catch fiscal or
  drawer writes. A failure invalidating the whole engine transaction is a stated limit.
- [ ] Preserve original-versus-copy status and explicit delivery enrolment. Test failed enqueue
  never records successful delivery and later retry remains possible; already-issued manual
  print failure does not rewrite fiscal facts. Run focused thermal/print/sale integration cases
  and affected types. LOOK once at task end for thermal 58/80 and retain bytes/screens/evidence.

### Task A5: A4 logo/order and invoice-delivery consent contact

**Files:** server invoice-document/page/pdf and tests; invoice-choice-delivery/tests;
working-order invoice-choice call; till API offer/check contract and tests as needed.

- [ ] Failing A4 cases cover the same null/disabled/current-language/current-address rules,
  subtitle before legal name and a visible logo. Current `invoice-page.ts:80` skips the logo;
  adding the department store alone would not satisfy owner answer 7.
- [ ] Read the recorded department/current config in invoice-document, including bounded stored
  picture. Add a page-logo element and render it in PDF with existing facilities, centered and
  proportionate within the page's content bounds. Keep QR size/location rules, page breaks,
  filed issuer domicile/recipient and mandated F1 fields. Assert the current optional address
  before phone under the global switch even on F1, and the filed domicile separately unchanged.
  Do image conversion outside the write
  transaction; no new stored A4 raster or unreviewed dependency is required by this plan.
- [ ] Failing consent matrix: valid department email selects its own email/phone; missing
  department uses default; missing/invalid email falls back to default; invalid default gives
  no offer/refusal; no phone borrowed from another contact; disabled designated default accepted;
  invalid phone dropped from imported contact; stale email or phone echo refused. Pair the
  no-department consent test with a receipt test proving no default-authored fields print.
- [ ] Introduce one resolver for contact selection (order context before issuance, recorded id
  for an issued-sale offer) and use it in `checkedInvoiceChoiceDelivery`. Pass `orderId` and
  authoritative location/context from `setOrderInvoiceChoice`, not an untrusted request id.
  Preserve provider availability, current consent language checks and stored version/time/person.
  Do not refresh an already accepted staged/reserved consent snapshot from later receipt edits.
- [ ] Make the same resolver available to the delivery offer. At this base no offer UI was found;
  expose an authenticated order-scoped offer read only if the landed delivery interface needs
  it, with the same session/action/zone gates as invoice choice and passive-read semantics.
  It returns no offer when provider or contact is unavailable. Do not implement the later F1
  customer screen or expand F1 rollout permissions. Cite the final offer consumer/interface in
  the checkpoint; absence of a UI is not evidence that the check may use a different contact.
- [ ] Run focused A4/PDF and actual invoice-choice route cases, types; LOOK at A4 once at task end
  with/without logo, long content, duplicate and another receipt language. Preserve delivery
  idempotency/accepted-consent assertions and untouched fiscal fixtures.

### Task A6: Preview uses a department draft, global draft switch and independent language

**Files:** server receipt-preview-api/sample-receipt/tests; dashboard API preview method/tests.

- [ ] Failing preview cases: picked department draft maps, independent preview language and
  current-language fallback, third language not used; unsaved global switch; explicit inactive
  department; unknown/other-location/permission/malformed request refusals. Null department
  explicitly previews venue-only trim, not default authored text.
- [ ] Add POST `/management-api/receipt-preview` with bounded JSON `{ departmentId, receipt,
  settings, language, paperWidth }`, where departmentId may be null for a venue-only preview.
  Derive current receipt language/allowed keys at the server, validate both config and settings.
  Use the same renderer, address helper and top order as printing, without storing the draft.
  Bound payload/body parser and any image work; measure request handling during implementation.
- [ ] GET stays only until callers migrate, then retires in A13. Do not call a compressed/single
  resolved GET payload proof of arbitrary-language validation or header-size safety.
- [ ] Use existing preview-safe sample fiscal data. Run focused real-route preview/API tests and
  types. Inspect preview once at task end at both thermal widths; no sale/config writes occur.

### Task A7: Fresh sale, replay, invoice-first and bill answers drive the till view

**Files:** server till-sale/bill-payments/till-api and relevant receipt/source tests;
till layout/API/client/app/ticket-view/tests.

- [ ] Failing wire/view cases for every ticket constructor and `readSettledTicket`, direct bill
  ticket plus `resultOf`'s replay branch. Distinct departments, a later text/address/global-switch
  edit, null/absent header and an empty trim after a rich previous receipt expose wrong caching.
  Keep original transaction values, drawer side-effect gating, recorded names and replays.
- [ ] Add `ReceiptPresentation` to each invoice answer: `receiptTrim`, current `venueAddress`
  and separate `venueReceiptSettings`. Reuse one assembly helper at all constructors so
  settlement/invoice-first/card/bill branches cannot silently omit it. Optional authored read
  failure yields empty trim under decision 19; required facts are not replaced with defaults.
- [ ] Remove authored `receipt` from boot and the till's boot-owned authored state; retain global
  boot settings only where used for venue UI. Render each answer's presentation in ticket-view;
  apply global switch, current address, subtitle-before-legal order and existing filed F1 domicile
  rules. Do not take department trim from device profile, current zone, another answer or boot.
- [ ] Assert a receipt-only replay resolves current authored text but returns original fiscal,
  tender/change and trading facts and performs no repeat drawer/filing action. Run focused
  server wire + till client/view/app cases and types; LOOK once at task end on phone/desktop,
  both themes, with two departments and an empty/null-sale receipt.

### Task A8: Media logo usage belongs to each department

**Files:** media images/tests, module/package manifest; dashboard usage types/library/live
queries/strings/tests; lockfile only as required by normal installation.

- [ ] Failing tests: one logo used by two departments counts two, including a disabled one;
  both uses name/link the right department, clearing one leaves the other, deletion refused
  while in use, unreferenced asset still deletable. Old tenant-authored logo is not a current use.
- [ ] Replace tenant logo queries/counts with department rows; include department identity and
  location scoping, defend against malformed imported JSON without unbounded parsing. Add
  workspace dependency and module `requires`; retire anonymous usage labeling.
- [ ] Update live-query resources from tenant-authored receipt to `department_receipts` and
  `departments`; keep any separately used global settings resource. Part A link opens explicit
  department id (including disabled maintenance case); Part B updates only the host destination.
- [ ] Run focused media/client/library tests, affected types, workspace-cycles and module seams/
  graph/composition guards as applicable. Do not infer a safe package cycle from source imports.

### Task A9: Standalone department editor with a separate global section

**Files:** dashboard receipts-screen, API/live queries/types, strings/codes and focused sibling
screen/client/a11y/save-state tests.

- [ ] Failing user-action tests: picker edits and previews the same department; active default
  selection/first-active alternative, explicit disabled maintenance URL, no active department,
  department load refusal while global fields remain usable; department address key never sent.
- [ ] Load department config through scoped query, global switch via its own query, and receipt
  language/description via their existing venue APIs. Department heading replaces “Every
  location”; “Subtitle” uses the under-trading-name placeholder. Global Print the address,
  receipt language and description sit below the department section. No authored default fallback.
- [ ] Carry A331 immediately, not as a later polish step: separate `draftScopeFor` identities for
  selected department and global switch plus existing language/description scopes;
  `saveActionState` makes each Save quiet/disabled until changed, then active, and each save
  handler returns early when that scope cannot submit. Submit only that scope's changed body.
  Clearing/adding logo changes the department draft; preview/picker language does not.
- [ ] Include `*.unsaved.test.ts` and save-state tests using real controls: pristine disabled,
  changed enabled, reverted disabled, double/unchanged action sends no request, rejected save
  keeps the draft, field refusal inline plus localized bottom summary, successful write closes/
  commits before separately reporting refresh failure. A refusal alone never disables the action.
- [ ] Passive subscription callbacks assign snapshots and never reset dirty drafts or rerun a
  loader. Track read/action errors separately and retain a newer subscription snapshot over
  an older reload. Run focused client/screen/a11y/save tests and types; inspect changed fields
  once at task end at 390 px/desktop in EN/ES and both themes.

### Task A10: Department switches, late work and reconnect keep drafts accountable

**Files:** dashboard receipts-screen unsaved/switch/save tests and dashboard-app venue-settings
navigation/unsaved tests. Apply the same rules later in B2's host.

- [ ] Failing real-control journeys: dirty department+global switch/language/description, switch
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
  label; headings warn only per decision 8; all-empty optional fields show none; note once.
  Typing one locale changes only that map entry, and clearing it sends the intended empty change.
- [ ] Render two shared fields per heading with semantic names `headerSubtitle-<tag>` and
  `footerMessage-<tag>`. Use shared tokens/primitives; keep user-visible hints as placeholders.
  No forced translations or English choice. Ensure draft equality is by map values, not key order.
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
- [ ] Preview POST sends selected department's unsaved maps and global switch, not a resolved
  string masquerading as validated maps. Handle stale response generations and passive reads.
  Preview selection uses decision 6's languages; it is separate from the stacked editor fields.
- [ ] Focused preview/API/types. Once at task end, do the complete LOOK: EN/ES UI, all receipt
  choices, both themes, desktop/390 px, short/long/empty fields, logo/no logo, two departments,
  null-sale venue-only sample, 58/80 thermal, A4, independent language and inline refusal scroll.
  Use the managed dev stack (`wa-wt demo <worktree-name>`), record screenshots/bytes/PDF and
  actual observations. This run complements, rather than repeats, earlier task-end LOOK evidence.

### Task A13: Retire old authored consumers, audit claims and finish Part A

**Files:** layouts legacy store/defaults/exports/tests; server management imports/routes/preview
GET/fixtures and configuration tests; dashboard API/live-query/stubs/app tests; till boot
fixtures; current documentation and dated historical pointers; root guards only as warranted.

- [ ] Trace all consumers with identifier **and prose** searches for `tenant_receipts`,
  `getReceipt`, `getPrintedReceipt`, `putReceipt`, `ReceiptConfig`, `printAddress`,
  `headerSubtitle`, `footerMessage`, receipt routes, “Slogan”, “Every location”, “Preview for”,
  default-department print fallback, “first written”/any-language fallback and language tabs.
  Check READMEs/runbooks/specs and the whole base-to-tip prose path set, not only edited lines.
- [ ] Retire old authored GET/PUT `/management-api/receipt`, legacy preview GET and associated
  authored store/default/query/client methods only after their consumers move. Keep the narrowed
  global settings store/API and singleton table/classification/transfer/export/constraint guard.
  Current global writers serialize only the switch; imports/exports do not carry old authored
  fields into new department config. No core drop/rebuild or backcompat adapter by assumption.
- [ ] Prove with focused tests: old authored tenant values never appear in null or department
  renders; global false survives normal startup/config round-trip without reset; department
  config starts empty; unrelated imported data and fiscal invariants remain unchanged. Run
  actual generated SQL/populated upgrade/FK probes from A2 after any migration change/rebase.
- [ ] Update current A366 spec/developer design-system and backlog accurately. Earlier historical
  specs/plans get dated supersession pointers, not silent rewrites: A261 venue-operations receipt
  §5, the dated W111/current-address claims in
  `docs/superpowers/plans/2026-10-05-venue-details.md`, and the invoice-email
  design's “Owner decisions, 2026-10-03” / “Email it” contact wording in
  `2026-10-03-invoice-pdf-email-and-office-printing-design.md`. Audit the reconciled delivery
  plan `docs/superpowers/plans/2026-10-03-invoice-pdf-email-and-office-printing.md` too, where
  `getReceipt`/venue-wide contact claims appear, plus
  `docs/superpowers/plans/2026-10-03-full-invoices-at-till.md` where its receipt contact is
  cited. Point superseded receipt/contact claims to A366 §11; retain unrelated dated receipts.
  This STEP 0 edits only this plan, the A366 spec and a narrow backlog status; broader historical
  pointers are an implementation retirement requirement, not authorised STEP 0 scope.
- [ ] Run remaining focused integration and applicable root guards: schema/upgrade, module seats/
  dependency/cycles, live-subscriptions, errors-reachable, style-token/native-fields and
  claude-md-pointers for changed claims/paths. Keep receipt singleton guard and fiscal golden/
  inmutabilidad checks unedited. Inventory changed assertions in the PR with final line pointers.
- [ ] Take both FULL run-it reviews, triage/verify findings, normal pre-push local gate once, and
  current-head CI package suites/coverage. Do not add full local package runs per task. Update
  backlog to distinguish Part A/Part B still open; announce readiness for `finish-branch` or
  continue it if already requested. Never merge without the owner's landing instruction.

## Part B — Department → Receipt host (second PR, after slice 6)

This remains an outline until the actual slice 6 host is read. Re-ground file pointers on its
landing, keep Part A's renderer/editor/contact rules, and use the same focused checkpoints,
A331 contract, changed-check inventory and two FULL run-it reviews for this PR.

### Task B1: Host contract and permission

- [ ] Read landed Department page/tabs/routing and dashboard-kit hosting/leave contract. Test
  first: Receipt tab available only with `layout.configure`, still under the page's management
  permission; direct URL cannot bypass it; selected department id is authoritative.
- [ ] Add the smallest host/seat required for the reusable editor. Generic dashboard-kit code
  receives a host contract, not knowledge of venue-service table/layouts internals. Keep explicit
  disabled-department maintenance access without a disabled-default fallback in the picker.
- [ ] Focused host/permission/routes/types; record checkpoint and changed paths, not guessed
  slice 6 filenames. Check dependency cycles if a new dependency is actually introduced.

### Task B2: Receipt tab with complete form and preview behaviour

- [ ] Mount Part A's department editor for the page's department. Global settings stay in Venue
  settings; no per-department address switch. Show the existing print policy and zone differences
  through slice 6's service-setting contracts; do not duplicate policy storage in receipt JSON.
  Keep trading name/print switch in their existing department policy ownership.
- [ ] Test first and implement A331 scopes, `saveActionState`, early return, `*.unsaved.test.ts`,
  #1422 reconnect, late-save isolation, passive reads, Keep/Discard and tab/page leave handling.
  Avoid nested duplicate scopes/prompts if the host already owns the same draft.
- [ ] Stack all locale fields/headings/warnings; exact inline refusal+scroll+bottom summary;
  independent preview language, global-switch-aware/current-address preview and exact top order.
  If the tab combines service policy and authored edits under one Save, one server transaction
  owns the logical write and returned baseline; never quietly submit the global switch too.
- [ ] Focused hosted editor/policy/unsaved/a11y/type checks; full task-end LOOK once across theme,
  width/language/locale-refusal states. Preserve all behavioural assertions moved with the editor.

### Task B3: Venue settings keeps globals; links and retirement follow the host

- [ ] Remove the standalone department picker/editor from Venue settings only once Department
  Receipt tab is usable. Keep global Print the address, receipt language and sales description
  with their A331 scopes/save guards/early returns/reconnect/unsaved suites. Describe the current
  address as venue-wide; link to the department editor for authored fields.
- [ ] Update media usage and department preview links to the actual host, preserve explicit id and
  permission checks, retire Part A's old route/host prose via dated pointers where historical.
  Update backlog: delete completed receipt work and keep only actual remaining A366 work.
- [ ] Focused global-panel/link/navigation/types; task-end LOOK once, complete changed-check
  inventory, both FULL run-it reviews, normal pre-push gate once, current-head CI suites/coverage.
  Announce/continue `finish-branch`; do not merge automatically.
