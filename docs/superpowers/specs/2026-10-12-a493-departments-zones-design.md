# A493: Departments and zones, with dialog editors

2026-10-12. Lane D, Codex driver. This is the implementation contract for the parent driver, not a plan-only deliverable. The owner has authorised unattended implementation, finish and landing; there is no further design confirmation gate. This delegate only read local sources and wrote the spec and plan. All implementation behavior below still requires execution evidence. The private canvas is **UNVERIFIED**: no website or computer access was used.

## Owner text, preserved verbatim

The following is the complete A493 entry, including its last two lines beyond the requested line 139, from `docs/backlog/service-periods.md:85`.

```markdown
## A493. Departments and zones as one list, edited in dialogs

**A493 (owner, 2026-10-11) — OPEN (lane D).** A435 step 6 replaces a zone's and a department's
Disable with permanent Delete in the same screens
([plan](../superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md)). The owner's
mockup is the private canvas https://claude.ai/artifact/Tya5FcmK39ESBkQ2hTaA7s, which has four
boards: the list, Edit department, Edit zone and Edit receipt.

**The list.** "Departments and zones" becomes one list. Each department is a row, and its zones are
indented beneath it. The columns are name, service style (how orders start), counter service (when
counter service is used) and print receipt. The row menu is the last column, keyed `actions` and
`pinned: "end"`:
- a department's menu: Edit, Add a zone, Edit receipt, Delete;
- a zone's menu: Edit, Add floor plan (Edit floor plan once it has one), Delete.

Clicking a row opens its edit dialog, as products do. The department page and its Settings, Zones
and Receipt tabs go away. With them goes a fault the owner hit: the menu link "Departments and
zones" reopened the last department instead of the list, and showed "This department no longer
exists." when that department was gone. The cause is that the shell reads the department from the
page address (`packages/venue-service/src/dashboard/venue-departments-shell.ts`, `#restore` and
`#content`).

**Zones.** A zone can set its own service settings (`zone_sale_policies`,
`packages/venue-service/src/schema/service.ts`). In the list, a value the zone takes from its
department is shown in grey italic, and a value it sets itself in normal text. The zone dialog
offers "Same as department (…)" as a choice for each setting. Each zone row has a drag handle, and
dropping a zone on another department moves it there, replacing today's "Move to department". The
row being dragged must stay visible while it moves: it follows the house rule for a dragged row
(design-system.md, the `--wt-color-surface-lifted` paragraph).

**Edit department dialog.** Department name, then trading name (moved up from "On the receipt"),
how orders start, when counter service is used, and the collection-ticket switch. "Print a receipt"
and "Print the trading name above the legal name" move to the receipt dialog. The "On the receipt"
heading and the "Edit the receipt" link go.

**Edit receipt dialog.** A wide dialog with the form beside the printed preview. It holds:
- print a receipt;
- the trading-name switch;
- print the venue's address;
- logo, phone and email;
- the description sent to the tax agency (today the venue-wide "Sent to the tax agency (not
  printed)" field on `apps/dashboard/src/screens/receipts-screen.ts`);
- subtitle and footer per language.

Each fiscal record carries its own description, but how a sale picks today's venue-wide value has
not been traced: trace it before moving the field. The languages listed are the venue's content
languages that have receipt wording (Spanish, Catalan, Galician and Basque today,
`packages/country-es/src/receipt-labels.ts`), plus the venue's receipt language, which comes first.
Headings carry the language name alone, with one line saying the others print as copies on request.
That replaces "Catalan (receipts)" and "Spanish (copies)"
(`apps/dashboard/src/screens/department-receipt-editor.ts`). The language rule is A497's.

**The venue receipt page goes.** There are no venue-wide receipt defaults any more
(`apps/dashboard/src/screens/venue-receipt-defaults-editor.ts`). Each department holds its own
logo, subtitle, footer, address switch and tax-agency description. A new department starts with an
empty receipt. The venue's receipt language moves to Venue settings. Nothing is live, so stored
venue defaults may be dropped rather than carried over (CLAUDE.md §3, last rule).
```

## Result and driver choices

You open Departments and zones to one list, with every live department followed by its live zones. Clicking either row opens its editor. A department menu offers Edit, Add a zone, Edit receipt, Delete; a zone menu offers Edit, Add/Edit floor plan, Delete. Delete reuses A435-6's impact/refusal flow, landed in `ea98838b4b688b9b19c6381374664831a9959aea`; it never becomes an availability switch.

Driver choices, not additional owner decisions:

- Keep departments in the supplied order and zones in their supplied order; no manual department or zone reordering. All department branches stay open. Preserve readiness notices, unassigned-zone assignment, department transfers, the zone's closed-times summary and its read-only floor-plan preview inside the relevant dialog. The owner did not ask to remove those functions.
- A new department's authored receipt is `{}`: no logo, phone, email, subtitle, footer, address permission or operation description. Absent `printAddress` means **false** for department receipts. A missing/blank tax-agency description makes the department unready to issue invoices until you fill it in. Preserve today's nonblank rule (`apps/server/src/location-settings-api.ts:271`); never substitute the venue value. The receipt editor marks this field required, and the list shows the missing setup. Mandatory issuer identity, fiscal totals and QR wording remain independent of optional receipt decoration.
- A fiscal contribution without `venueFields` offers no description field. Boot sets `TillConfig.operationDescriptionRequired` from that contribution; `false` selects an explicit empty string without reading a department or location description. An absent flag conservatively keeps the authored-description requirement for direct product callers. The installed no-field trading-boot and direct cash/card checks exercise this boundary.
- Keep existing service-policy creation defaults: `orderStart: "counter"`, `paidWhen: "prepay"`, `collectionNumber: "none"`, `receiptPrintMode: "auto"`, `printTradingName: true`. “Empty receipt” describes authored optional content, not disabling the mandatory document or changing these policy defaults. These defaults are declared at `packages/venue-service/src/schema/service.ts:90` and applied by creation at `packages/venue-service/src/operations.ts:196`.
- Preserve the current per-department text fallback: requested print language, then current venue receipt language, then nothing. No third language or venue text fallback. Clearing a logo leaves no logo; clearing contacts leaves no contacts.
- Receipt language becomes an independent card in Venue settings → Venue details, using the existing language route and gate. Remove the Receipts tab/page, not the language's regional constraints or open-order refusal.
- Use a responsive wide receipt dialog: form and preview side by side where they fit, form above preview at 390 px. A drag starts at the zone grip; the full visible zone row follows the pointer, held inside the list and above covered rows, with `--wt-color-surface-lifted`. Keep its original space; a label-only ghost is insufficient. Follow the displacement/release animation and reduced-motion rule at `docs/developers/design-system.md:145`. Keyboard users can pick up the grip with Space, choose a live department with arrows, Enter to move, Escape to cancel; there is no separate Move menu item. This is an accessibility choice.
- Keep the existing physical `tenant_receipts` table and generic low-level layout-store/pure-composition contracts untouched, but remove **every live product default consumer, editor, HTTP endpoint and transfer entry**. This avoids a table-removal migration and changes to schema guards (the singleton is pinned at `scripts/schema-constraints.test.ts:702`). No runtime compatibility branch, data copy, or migration of its values is introduced. Reset pre-live venues with stale rows rather than carrying them forward.
- Keep `locations.operationDescription` as the existing generic provisioning/core input, with its existing standalone tests. It is never a department receipt fallback. The setup wizard stops presenting it as the venue's sales description and supplies the installed regime's bootstrap value internally; a seeded or newly created department remains empty. CLI/direct core callers keep their explicit generic location contract. This is a boundary choice, not a compatibility shim.

## Exact boundaries to implement

These are proposed interfaces, not assertions that they already exist.

| Boundary | Contract |
| --- | --- |
| Shared receipt model | Extend `DepartmentReceiptConfig` with `printAddress?: boolean` and `operationDescription?: string`. Keep logo/contact/text map fields. Add `DepartmentReceiptPolicy = { receiptPrintMode: "auto" \| "on_request"; printTradingName: boolean }` and `DepartmentReceiptWrite = { receipt: DepartmentReceiptConfig; policy: DepartmentReceiptPolicy }`. No duplicated policy storage in JSON. |
| Department editor draft | `DepartmentEditInput = Pick<DepartmentSettingsInput, "name" \| "tradingName" \| "orderStart" \| "paidWhen" \| "collectionNumber" \| "transfers">`. Change the current `/departments/:departmentId/settings` PUT to that exact shape. It does not write receipt policy fields and cannot overwrite a concurrent receipt edit. |
| Zone editor draft | `ZoneEditInput = { name: string } & ZoneServiceSettingsInput`. Add `PUT /management-api/venue-service/zones/:zoneId/settings` and `VenueServiceApi.saveZoneSettings(id: string, input: ZoneEditInput): Promise<void>`. Name and all four nullable policy overrides save in one transaction. Preserve `venue_service.manage`; require `venue.configure` too when changing the name, matching the existing zone rename gate. Keep the policy-only service-settings operation for its other callers. |
| Receipt persistence/module seat | Keep `department_receipts.receipt` JSON, rasters and retained reads. Add `readDepartmentReceiptPolicy(tx: Transaction, cfg: VenueScope, departmentId: string): Promise<DepartmentReceiptPolicy>` and `saveDepartmentReceiptSettings(tx: Transaction, cfg: DepartmentReceiptScope, departmentId: string, input: DepartmentReceiptWrite, rasters?: ReceiptLogoRasters): Promise<void>` to the venue-service service seat, implementation and exports. Save JSON and the two department policy columns in the caller's single write transaction. |
| Receipt HTTP | GET `/management-api/venue-service/departments/:id/receipt` returns `{ receipt, policy, receiptLanguage, languages, warningLanguages, venueAddress }`, with no `venueDefaults`. PUT accepts exactly `DepartmentReceiptWrite`, returns 204. Require `layout.configure` for receipt fields; require `venue_service.manage` additionally if either service-policy value changes, retaining the prior policy-write permission. UI permits decoration editing without policy-write permission and keeps those switches read-only. Recheck permission, active department, language and image in the final write transaction; image decoding remains outside it. |
| Fiscal field validation | Pass `validateOperationDescription?: (description: string) => void` from the installed fiscal contribution through management mounting into the receipt API. Call it for the submitted string (including `""`), remap its `setup.request_invalid` to `management.request_invalid` with `field: "operationDescription"`. Layout validation checks shape; it must not import fiscal-verifactu. |
| Language selection | Add server helper `departmentReceiptLanguages(tx: Transaction, cfg: { locationId: LocationId }): Promise<{ receiptLanguage: string; languages: string[]; storageLanguages: string[] }>`: `languages` is current receipt locale first, then installed receipt-label locales whose `contentLanguageCode(locale)` occurs in saved content languages, without duplicates. `storageLanguages` contains all installed labelled locales plus current receipt locale, and is private read/validation metadata, not another UI list. Read authored maps with that full set, so disabling a content language never erases its value before an edit/save. Accept a hidden existing key only unchanged or cleared; new/changed translations must be offered. Use exact labelled locale keys, not content-language codes, in maps. Historical printing loads requested/current stored keys independently of content-language filtering. |
| Draft preview | POST `/management-api/receipt-preview` accepts `{ departmentId: string; receipt: DepartmentReceiptConfig; policy: DepartmentReceiptPolicy; language?: string; paperWidth?: "58mm" \| "80mm"; passive?: boolean }`. No nullable venue-only subject and no `settings`. Draft policy, address, logo and texts affect preview; description never prints. Authorisation and language validation match save. No database writes or print jobs. Keep existing width selection, QR/sample, marks, byte bound, passive option and stale-result protection. |
| Receipt presentation | Replace the misleading `ReceiptPresentation.venueReceiptSettings` with `receiptSettings: { printAddress: boolean }`; update till wire types/rendering together. Trim resolves from the retained department only, by calling the existing pure resolver with `{}` as its venue argument. Null/missing/unreadable department means no optional trim/logo/address. A4 retains its existing omission of optional current venue address. |
| Fiscal core input | Add `operationDescription?: string` to `RecordSaleInput`, `RecordCorrectionInput`, `RecordSubstitutionInput`. Extend the **same** `operationDescriptionFor(tx, origin, nodeId, supplied?: string): Promise<string>` resolver: supplied string wins, including `""`; only `undefined` takes its existing device/node location path. All three core entrypoints pass their new input to that resolver. No module import into core. |
| Server selection | Add `readSaleOperationDescription(tx: Transaction, cfg: { locationId: LocationId }, source: { kind: "order"; orderId: string } \| { kind: "sale"; saleId: string }): Promise<string>`. For fresh order issuance, obtain the order zone, resolve its current department exactly as `recordSaleReceiptHeader` does, read department receipt, return its nonblank authored value or refuse `department.operation_description_required` before fiscal issuance. For corrections, resolve the original sale's retained header department and its current nonblank authored description (or the same refusal). Always pass an explicit string from product sale callers. No default department substitution for a missing receipt context. |

Core's generic optional input lets existing standalone callers continue to function without knowing departments; the product server always resolves the department first. This does not change `SaleForFiscalRecord`, builders, record rows or invoice allocation. For any future department-aware substitution caller, supply its chosen department description through the same core input/resolver; do not invent a substitution UI in A493.

## Source trace and required consumer changes

Reading receipts below establish source placement only; no command in this planning task verified runtime behavior.

| Concern | Read receipt and implementation consequence |
| --- | --- |
| Fiscal placement | `packages/core/src/sale-location.ts:18` and `:23` select `locations.operationDescription`; `:34` returns it. **`packages/core/src/record-sale.ts:358` resolves it and `:362` passes it to the fiscal backend as `descriptionOfOperation` (`:371`).** Correction `packages/core/src/record-correction.ts:310` and substitution `packages/core/src/record-substitution.ts:246` use the same resolver. The backend consumes the existing field at `packages/fiscal/src/backend.ts:55`; fiscal-verifactu forwards it at `packages/fiscal-verifactu/src/backend.ts:230`, `:442`, `:562`. Change selection/input plumbing only, never those backend lines. |
| Description readiness | A fresh receipt may be `{}` but a product issuance cannot use a blank description. The current management route rejects blank at `apps/server/src/location-settings-api.ts:271`; preserve that behavior as a department setup requirement. The installed validator and XSD length bounds alone are not proof of remote acceptance. New tests must refuse missing/blank values before number allocation, fiscal writes, payment dispatch or drawer work, while a populated department remains usable. Generic explicit core inputs retain their existing separation from department policy. |
| Issuance paths | Ordinary till `apps/server/src/till-sale.ts:826`, capture `:1374`, recovery `:1526`, unpaid issuance `apps/server/src/working-order.ts:5687`, funded bill `apps/server/src/bill-payments.ts:686` all call core. Header capture follows at `till-sale.ts:855`, `:1394`, `:1543`, `working-order.ts:5701`, `bill-payments.ts:700`. Resolve once before each call and keep header selection consistent inside the same transaction. Correction call: `apps/server/src/cancel-credit.ts:59`. Generic readiness sale: `apps/server/src/fiscal-readiness-runner.ts:105`; demo/scripts/direct callers need no department dependency. |
| Context and recorded header | `packages/venue-service/src/operations.ts:535` resolves current zone policy, using nullish override semantics at `:573`; `:581` records department/trading-name/switch on the sale, and `:596` reads them. `packages/venue-service/src/schema/service.ts:131` declares that snapshot. Do not repoint old snapshots when dragging zones or editing names. Receipt contacts resolve order/sale context at `packages/venue-service/src/department-receipts.ts:247`, `:259`; default-department identity at `:275` is a service identity, not venue receipt defaults. |
| Authored/retained reads | `packages/shared/src/receipt-text.ts:4` is the shared JSON type; `packages/venue-service/src/schema/department-receipts.ts:10` already stores it. Projection/parser at `packages/venue-service/src/department-receipts.ts:63` and `:90` currently omit address/description: extend both. Public active read `:144`, retained read `:158`, optional print read `:172`, raster read `:201`, write `:223`: preserve bounded decoding, diagnostics, image ownership and deleted-department retention. No schema migration is needed for additional JSON members (design choice). |
| Policy split | Department policy columns/defaults are `packages/venue-service/src/schema/service.ts:86`; zone nullable overrides `:109`. Model/raw/effective types are `packages/venue-service/src/dashboard/client.ts:26` and `:34`; model arrays `:80`. Current settings write updates both receipt policies at `packages/venue-service/src/operations.ts:714` and `:730`, and route requires them at `packages/venue-service/src/routes.ts:623`. Split those writes so department and receipt drafts cannot overwrite each other. Save order start via the existing update path at `packages/venue-service/src/operations.ts:228`. |
| Drag side effects | `VenueServiceApi.configureZone` sends `{ departmentId }` at `packages/venue-service/src/dashboard/client.ts:298`; route `packages/venue-service/src/routes.ts:861` checks a live scoped zone. `configureZone` at `packages/venue-service/src/operations.ts:343` changes assignment, clears routing periods belonging to another department at `:391`, and preserves explicit zone policies on the existing-assignment branch at `:406`. Reuse this request, not a new bulk move/reorder. Null overrides follow the destination; equal explicit values remain explicit. No old order/line/sale snapshots are rewritten. |
| Navigation/dialog host | Current shell restores department/view/zone at `packages/venue-service/src/dashboard/venue-departments-shell.ts:203` and renders the department page at `:236`; remove that page/tab state. Existing form drafts/save paths: `dashboard/department-settings.ts:234`, `:409`; `dashboard/department-zones.ts:203`, `:313` (both under `packages/venue-service/src`). Host receipt content through the existing `DashboardPanelRenderer` signature at `packages/dashboard-kit/src/contract.ts:20`, currently wired at `apps/dashboard/src/dashboard-app.ts:1234`. No package→app imports. Canonical list is `/manage/venue-operations`; optional `/department/:id/view/receipt` becomes a current receipt-dialog deep link for media, never a retained sidebar destination. A missing target closes the dialog and leaves the list visible. |
| Table and drag primitives | `packages/ui/src/components/wt-data-table.ts:809` has `rowParent`; `:816` can keep branches always open; `:829` handles clickable rows; `:865` accepts row controls. Use union rows `{kind:"department",department}` / `{kind:"zone",zone}` with distinct keys and parent keys. Existing pointer helpers at `apps/dashboard/src/widgets/pointer-drag.ts:2` and tree helpers at `apps/dashboard/src/widgets/tree-drag.ts:14`, `:71`, `:126`, `:132`, `:175` implement ghost, cell parts and click suppression; they are app-owned, so extract reusable helpers into dashboard-kit with app re-exports if used by venue-service. Use `DragEdgeScroll.start/update/stop` at `packages/ui/src/drag-edge-scroll.ts:23`. No native HTML draggable transfer; use pointer capture and a 5 px threshold. Style table children with `part`/`::part`, including pinned cells. |
| Delete reuse | `packages/venue-service/src/dashboard/department-dialogs.ts:174` handles current-impact identity/watch; `:237` handles refusal and deletion, `:277` closes after success. Retain `wt-delete-dialog`, `service-delete-copy`, passive reads, target/generation checks, refusal refresh and focus return. Existing server deletion retains receipt JSON: policy cleanup at `packages/venue-service/src/service-delete-settings.ts:395` removes sale policies, not department receipts. |
| Printing/fallback | Global print reads occur at `apps/server/src/receipt-print.ts:165`, `receipt-presentation.ts:27`, `invoice-document.ts:99`. Global logo/text/contact composition is `packages/shared/src/receipt-text.ts:52` and `:61`. Remove global reads from these three consumers; use department rasters and address switch only. Address gate is `apps/server/src/venue-address.ts:31`. Till display reads the global-named switch at `apps/till/src/screens/till-ticket-view.ts:545`; update its presentation/type replacement semantics too. |
| Drafts/previews | Department hints inherit global values at `apps/dashboard/src/screens/department-receipt-editor.ts:294`; language headings append receipt/copy labels at `:434`. Remove global hints. Preview input shape is `apps/dashboard/src/api/client.ts:2809`; server shape enforcement `apps/server/src/receipt-preview-api.ts:174`, composition `:267`, stored global contacts/raster `:263` and `:295`, address `:307`. Retire all those defaults; preview supplied policy switches rather than saved policy, and ignore description when rendering. |
| Language consumers | Current receipt locale writes `locations.invoiceLocales` at `apps/server/src/location-settings-api.ts:330`; fixed/open-order refusals at `:317`, `:326` stay. Receipt-label inventory is country-owned (`packages/country-es/src/receipt-labels.ts:7`); installed pack lookup and fallback are `packages/country-packs/src/registry.ts:146`, `:154`. Content settings read `packages/catalogue/src/content-languages.ts:151`; normalisation `packages/shared/src/content-languages.ts:65`. Do not use `receiptLabelsFor`'s fallback as proof a language has its own labels. Department route currently offers all regional choices at `apps/server/src/department-receipt-api.ts:76`; use the new offered-language helper for editing only. Keep till copy choices at `apps/server/src/till-api.ts:1303` and recorded receipt locale/list unchanged. Content-language screen's receipt warning remains at `apps/dashboard/src/screens/content-languages-screen.ts:244`. |
| Global API/UI retirement | Remove `/management-api/receipt` GET/PUT at `apps/server/src/management-api.ts:1262`, `:1278`; `/receipt-settings` at `apps/server/src/department-receipt-api.ts:144`; `/location-settings` receipt-description routes at `apps/server/src/location-settings-api.ts:248`. Retire client methods at `apps/dashboard/src/api/client.ts:2741`, `:2750`, `:2779`, `:2793`. Remove default editor and the global branch of receipts-screen. Venue settings currently installs that page at `apps/dashboard/src/dashboard-app.ts:270` and declares its tab at `apps/dashboard/src/screens/venue-settings-screen.ts:13`. Live-query map currently names `tenant_receipts` at `apps/dashboard/src/api/live-queries.ts:471`; replace dependencies with department receipt/policy, locations and content-language sources. |
| Contact and media | Keep order/sale email contact and its default-department fallback in `apps/server/src/invoice-email-contact.ts:13` and `:35`; that fallback uses a department's own contacts. Retire the separate global consent contact read at `apps/server/src/invoice-choice-delivery.ts:79`: revalidate against `resolveInvoiceEmailContact` for the same order/sale, preserving consent checks. Its product caller at `apps/server/src/working-order.ts:3491` must pass `{ kind: "order", orderId }` with the scoped location. Media global logo usages/counts are `packages/media/src/images.ts:241`, `:574`; remove those global references and keep retained department usages at `:245`, `:580`. Update active department receipt links at `packages/media/src/dashboard/image-library.ts:32`; deleted departments keep unlinked names (`:380`). Remove global media query dependency at `packages/media/src/dashboard/live-queries.ts:11`. |
| Setup/configuration | Setup currently requires location description at `apps/server/src/setup-api.ts:420`, validates through the fiscal seat at `:492`, and exposes bootstrap defaults at `:547`. Location storage/provision comparison/write are `packages/provisioning/src/venue-apply.ts:141`, `:178`, `:199`; preserve that generic contract and SIF calls. Wizard field/review consumers are `apps/setup/src/screens/venue-screen.ts:837`, `apps/setup/src/screens/review-screen.ts:186`, wire type `apps/setup/src/api/client.ts:44`. Department seed creates identity/policy at `packages/venue-service/src/provisioning.ts:53`, `:68`, without receipt JSON. Core transfer includes tenant receipts at `packages/db/src/configuration-transfer.ts:71`: remove that live transfer entry; do not change physical table/guards. Department receipts already transfer at `packages/venue-service/src/configuration-transfer.ts:485`, but its validator only checks department references at `:400`; add new JSON/boolean/description validation and image/raster/language checks at the host boundary. The exported location description at `apps/server/src/configuration-transfer.ts:91` stays generic bootstrap data, never copied into receipts. |

## Assertions and deliberate limits

- Preserve **all** existing `packages/core` receipt/sale assertions. In particular standalone location selection at `packages/core/src/record-sale.test.ts:214`, `:228`, snapshot locale list at `:342`, stored names/quantities/prices/tax, settlement, issuer identity and replay facts. Add explicit department-input cases; there are **zero authorised core assertion substitutions**.
- Preserve generic pure receipt-text and layout-store assertions too; product callers stop supplying global defaults. Their continued unit contracts do not authorise a live venue-default route. Precisely authorised product-test substitutions are: global API success → route absent; venue-only preview → department preview; global empty-department/logo/text fallback → empty trim/no raster/no address; implicit address on → address off; page/tabs/departments picker → list/dialog; headings “(receipts)/(copies)” → bare language name plus one explanation; venue-only consent lookup → same order/sale department contact; global logo usage/transfer → no global usage/entry; settings PUT fields → the separated draft shapes. Preserve every unrelated assertion when moving these cases.
- Receipt optional decoration remains current department configuration; recorded issuer, trading-name header, line data, locale list and fiscal description remain recorded facts. Current text fallback and retained deleted-department printing are not rewritten into immutable trim snapshots. Replay performs no extra sale, number allocation, chain append, drawer action or original-print enqueue.
- H2 prohibits edits to fiscal-verifactu builders/hash/records/invoice allocation, `registerSif` and `restoreFiscal`; golden huella and inmutabilidad files/fixtures remain byte-for-byte unchanged. No migration/backwards-compatibility code pre-live. Guards are never edited, except new upgrade `CANDIDATES` entries if a later justified schema change requires them; this JSON-based design expects none.
- No CodeQL actions. Full finish review means one Claude run-it review in a single independent installed candidate checkout, not per-task delegate pairs. No intermediate partial PRs or publishing: task boundaries are local coherent checkpoints on this one branch.
- At the end of each task that changes visible behavior and at final acceptance, LOOK at the affected flow in EN/ES × light/dark × 390/1280, including empty/filled receipts, validation/refusal, delete loading/refusal, menu pinning, drag visibility and preview. Record actual iframe `window.innerWidth`, screenshots and what was inspected. Required source rule: `docs/developers/testing-guide.md:992`; token/form/close contracts: `docs/developers/design-system.md:1776`, `:2167`, `:3780`, `:3810`.
- Final cleanup deletes A493 in both backlog files (`docs/backlog.md:1295`, `docs/backlog/service-periods.md:85`). Audit whole touched-path prose and dated earlier specs/plans for stale page/tab/global-default claims; historical artifacts get a dated supersession pointer, not rewritten history. Keep A497's wider scope and A435-6's retained-history decisions.

No confirmed implementation blocker was found by source inspection. Description-readiness refusals, permission combinations, native drag behavior and current-head checks remain **unverified until the parent executes the plan**. A failure requiring an H2 edit is a contradiction to report, not permission to weaken the requirement.

## Task 3 interface qualification (2026-10-12)

The department GET model also carries `operationDescriptionRequired`, derived from the installed
management description validator. The dialog reads that flag so a fiscal contribution without the
field does not acquire a required empty control. This extends the proposed response table without
naming a fiscal module in the browser. Preview permits an absent or blank nonprinted description;
the save path keeps its existing required-description check. Both combinations have real route
cases in `department-receipt-settings-api.test.ts` and `department-receipt-preview-api.test.ts`.
Retained modal reconnect keeps its draft and original baseline, matching the old department
editors. Removing the native dialog from the document and retaining its `open` property can leave
it outside the browser's modal layer; the receipt host binds its native opening to its connection.
Offered receipt text is trimmed for comparison and submission, while hidden map entries keep their
exact stored values. These qualifications do not authorise deleting unrelated legacy assertions.


## Task 3 retirement qualification (2026-10-12)

The visible department receipt language list uses `readOfferedReceiptLanguages`, the same
installed-country/content selection the till uses. Private storage metadata still keeps all
labelled locales plus the current receipt language, so historical text remains readable. The
Spanish API and language fixtures now include a taxpayer with country `ES`; missing/unknown
country cases offer only the stored receipt language.

Live receipt updates adopt untouched scalar fields and each untouched translation while keeping
typed values against their original saved baseline. An unchanged snapshot commits no baseline,
so it leaves an unanswered receipt/language leave choice current. The old dashboard receipt
page and editors, their client/query methods and the unused old department API mount are
retired. Task 3 still awaits the legacy server preview retirement and full managed product look;
Tasks 4–5 remain.

The original quoted copies-only explanation predates A497. The current A493 backlog wording
names languages staff can choose for the receipt itself; the dialog now says “Available at the
till” rather than describing every other language as a requested copy. The selection paths use
`readOfferedReceiptLanguages` in `working-order.ts`, `till-sale.ts` and `till-api.ts`.


## Task 4 retirement qualification (2026-10-12)

The historical consumer table above names the retired department page and zone panel. Current
subjects open protected editors over `departments-list`; Rename and Move dialog kinds no longer
exist. Creation, unassigned assignment and permanent Delete remain. The internal writer now takes
`DepartmentEditInput` directly, without the old receipt-policy fields. The policy-only zone
operation and its public client remain for the independent route contract specified above.
The live loader, inherited-policy flow, geometry and deleted-editor assertions are ported to
these owners; complete branch acceptance and review remain pending.


## Owner ruling: every new order has a zone (2026-10-12)

Every new order records its service context at creation. An explicit zone (including the
delivery table's zone) wins; otherwise use the device profile's starting zone, then the
location's counter-default zone through `resolveNewOrderZone`. With neither, refuse
`service_zone.default_missing` before allocating an order number. An empty order follows
the same rule. A party bill uses its party's zone; a split copies the source's recorded
zone, department and payment flow instead of selecting current defaults or reopening service.
A damaged split source with no context is refused `order.service_context_missing`.

An order whose context has been removed is damaged data. Payment refuses it before
money, filing, invoice numbers, drawer or kitchen changes; no default department supplies
a description. The owner explicitly retires the contextless payment-success expectation in
`till-api.unroutable-dish.test.ts` and approves equally strict refusal/unchanged-state checks.
This replaces the proposed default-department option in the earlier parked checkpoint.


The damaged-order rule also applies to a fiscal contribution with no description field.
That path validates the order context and refuses `order.service_context_missing` if it
is missing; valid context still yields an explicit empty description without reading a
department receipt or location description. Existing bills can split after their zone
stops taking new orders; splitting does not start a new service.
