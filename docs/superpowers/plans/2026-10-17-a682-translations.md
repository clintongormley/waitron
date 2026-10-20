# A682 Translations Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan inline, task by task. Read `superpowers:test-driven-development` before writing implementation or tests. Do not dispatch subagents. Steps use checkbox syntax. Execution, finishing and landing are already authorized; reservation handoffs and the H2 boundary below still apply.

**Goal:** Let you leave every customer translation blank, find every missing value and review all languages, Translate all and Use fix in one editor, delivered in one complete production PR.

**Architecture:** Keep stored translations separate from display fallbacks. Resolve bounded pages and individual cells from the catalogue, retain drafts by item/language/field, and submit one optimistic batch in one transaction. Add the approved unit staff pair and apply fallback while preparing future presentation snapshots, leaving historical readers and fiscal writers alone.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Hono, Lit, existing `wt-*` fields and draft coordinator, Vitest with real Chromium. No new dependency or Cloud implementation.

**Spec:** [A682 design and dated closure](../specs/2026-10-17-a682-translations-design.md). Read the full proposal, reconciliation and final closure. The closure supersedes pending-decision language in the historical bodies.

## Global constraints

- Owner decisions, 2026-10-17: **16:25 unit A**, required language-independent staff name and abbreviation; all translations optional, no automatic copying. **16:40 Spanish A**, Save succeeds with Spanish customer text blank; Spanish stays enabled everywhere in Spain, whatever the province, and its gaps remain.
- Nine kinds: `product`, `variant`, `option_list`, `option_label`, `extra_list`, `menu`, `section`, `included_menu`, `unit`. Units have two translated fields but count once per language. Translate all suggests unit names only.
- One PR implements all five A682 points and Use fix. Intermediate signed commits are implementation checkpoints, not independently publishable partial features.
- At most **200 enabled languages**, **50 rows per editor page**, **100 suggestions per suggestion page**, **100 changed cells per Save**, **262144 UTF-8 bytes in the entire Save body**, **4096 UTF-8 bytes per non-null translated value**. Do not silently truncate, split Save into requests or impose a smaller language cap.
- Keep regional required-enabled/default/notice/receipt rules except the approved Spanish-enabled extension. Optional text does not change an image write's own validation, sales availability, boot readiness or fiscal jurisdiction support.
- H2 prohibits changes to fiscal writers, `computeHuella`, fiscal hashes/numbering, `registros_facturacion`, alta builders, `registerSif`, `restoreFiscal`, fiscal fixtures/golden values and fiscal tests. Read and run existing fiscal tests unchanged. An actual need to edit any protected path parks that task for the owner; do not bypass it through another file or relax an assertion.
- Do not change shared `resolveSnapshotText`, historical snapshot readers or old orders, sales, publications, documents, queued print jobs and their hashes. New fallback is for new presentation production. Preserve receipt-language keys and the default-language wording policy.
- Keep the primary-only recorded-operation fake-Cloud runner and existing provider boundary. No provider credential on the box. Cloud's documented 20-language refusal remains separate from the editor's 200 languages. D71 and A689-21 are not prerequisites. No claims here verify Cloud's retention or implementation.
- No shipped migration edits, compatibility reader, backfill or automatic promotion of translated text into staff values. A760's squash **plan** is approved; its execution is **not cleared**. Do not run it.
- Read `CLAUDE.md`, the six design-area guides named by the owner, and the workflow/CI guides before their areas. Follow shared fields, tokens, draft/save/leave behavior and audience-specific product naming. Use distinct staff/customer/kitchen strings in fixtures.
- This planning invocation changes documentation only. Every command and assertion below is for the future implementer; none was executed as a product check while writing this plan.

## Review focus

These conditions have explicit cases in the owning tasks:

1. Clear an include override and change its root in the same batch, in either edit order; expose the final inherited text and recognize an exact whole-batch retry (Tasks 5–6).
2. A personal intentional blank survives a late suggestion, a hidden page and a disabled-language refresh; it remains reviewable without being silently filled (Tasks 9–11).
3. A fix targets a complete row or inherited value, while an unrelated language was added; reveal its exact field and recheck `wrong`, ownership and eligibility before staging `right` (Tasks 8, 11).
4. A 200-language row is edited while its focused column moves out of the window; retain the native control, caret and all staged values without mounting 200 fields (Task 10).
5. A new default lacks product, unit and contributed-image text; switching succeeds, image writes retain their own refusal, and future snapshots use staff fallback without changing old rows or receipt keys (Tasks 1, 4, 12).

## Current facts and source-to-task coverage

These are source readings at base `8ddcab3b22525a825474a3a0c35c95800409b231`, not runtime experiments. Everything under **Proposed contracts** and the tasks is proposed implementation behavior.

| Current source receipt                                                                                                                                                                                                                     | What changes, and where it is owned                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/catalogue/src/content-languages.ts:34`, `:187`: strict completeness helper and default-switch gap gate; `packages/media/src/images.ts:150` uses the strict helper                                                                | Task 1 adds a separate optional validator; Task 4 removes the switch gate without weakening media writes                                 |
| `packages/country-es/src/spain.ts:254` exempts Basque/Navarre; `packages/country/src/country.ts:242` returns no required languages for an unknown area                                                                                     | Task 1 supplies a country-wide Spanish-enabled floor while keeping other area rules                                                      |
| `packages/catalogue/src/product-editor.ts:152`, `variants.ts:209`, `options.ts:120`, `extras.ts:164`, `sections.ts:68`, `include-folder.ts:98`; `apps/server/src/catalogue-api.ts:1569`                                                    | Task 4 replaces catalogue completeness checks in all these writers, including direct product writes                                      |
| `packages/catalogue/src/schema/units.ts:10`, `units.ts:60`, `product-types.ts:31` have maps only; `provisioning.ts:111` seeds units; `configuration-transfer.ts:138` transfers them                                                        | Tasks 2–3 add staff columns, explicit seeds, DTOs, transfer validation and every projection/display                                      |
| `packages/catalogue/src/content-translation-kinds.ts:4`, `content-translation-report.ts:48`, `content-translation-targets.ts:108` omit absent default/extras names; targets `:88` and `:285` distinguish discovery from direct eligibility | Task 5 shares nine-kind gap predicates, counts both unit fields once, preserves archived direct edits and bounds discovery               |
| `packages/catalogue/src/content-translation-types.ts:55`, `content-translations.ts:173`, `:262`, `content-translation-writes.ts:13`                                                                                                        | Task 6 replaces item/single-language edits and companion requirements with cell batches and one final projection                         |
| `apps/server/src/content-translations-api.ts:85`, `:117`; `apps/dashboard/src/api/client.ts:2391`, `:2419`; `api/live-queries.ts:86`                                                                                                       | Task 7 changes route/client contracts and live dependencies, retaining gates and streamed byte enforcement                               |
| `packages/catalogue/src/content-suggestion-store.ts:68`, `:158`, `:260`, `:274`, `:351`; `schema/suggestions.ts:112`; `content-suggestion-collect.ts:59`, `:97`                                                                            | Task 8 records fix evidence in existing nullable `expected`, pages all languages and keeps live-only collection/cleanup                  |
| `apps/dashboard/src/widgets/content-translations-model.ts:16`, `:179`, `:284`; dialog `:286`, `:392`, `:660`, `:865`                                                                                                                       | Tasks 9–11 retain cell drafts, replace full scans with bounded pages/windows and add explicit Use fix/review                             |
| `apps/dashboard/src/screens/content-languages-screen.ts:53`, `:313`; `packages/ui/src/components/wt-data-table.ts:986`                                                                                                                     | Tasks 5, 10 wrap regional notes through parts and `wrap-to-fit`, retaining pinned Actions                                                |
| `packages/catalogue/src/product-presentation.ts:50`, `default-language-text.ts:7`, `customer-menu-presentation.ts:43`, `offered-modifiers.ts:136`, `pricing.ts:221`, `:308`                                                                | Task 12 resolves future customer presentation before staff values disappear; pricing continues copying prepared presentation values      |
| `apps/server/src/working-order.ts:345`, `:704`, `:811`; `modifier-selection.ts:53`; `apps/till/src/state/working-order.ts:114`, `state/held-options.ts:14`                                                                                 | Task 12 updates new-line/answer preparation, preserving retained-line paths and their original names                                     |
| `packages/catalogue/src/menu-document.ts:333`, `:1105`; `packages/module/src/module.ts:178`, `:227`, `:1145`; `packages/venue-service/src/operations.ts:1359`                                                                              | Tasks 3, 12 carry staff unit facts into future publication/context projections and change comparison; never rewrite an old document/hash |
| `packages/shared/src/content-languages.ts` → `resolveSnapshotText`; catalogue `joinCustomerPresentationText` and `option-snapshot-labels.ts`; server receipt/invoice/kitchen renderers; till `screens/till-ticket-view.ts`                 | Read-only audit and unchanged-reader acceptance in Task 12. No new live catalogue lookup for a reprint                                   |

Read the complete touched functions again after the reservation handoffs; these line numbers locate the base, not a promise about the later tree.

## Reservation and migration entry conditions

Evidence: `/Users/clintongormley/waitron-campaign-f/receipts/a682-plan-20261017/worktree-diffs.json`. Its committed, unstaged and staged hunks were read, including the functions below. A path shared by unrelated functions is not automatically a conflict; a shared function remains reserved. Planning documentation may proceed now.

| Implementation task                                                                                  | Exact wait and handoff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 3, unit offer/client/context projections; Task 12, new-line preparation                         | **G/A773-1** changes `apps/server/src/working-order.ts` → `priceOrderLines` (including its selection immediately before `customerPresentationText`), retained/recalled extras and line-context reconstruction; `apps/till/src/state/working-order.ts`, `api/client.ts`, `till-app.ts`; `packages/module/src/module.ts` contracts. Wait for G's release/landing and rebase before editing these functions or their fixtures. Retained/recalled source descriptions must stay frozen                         |
| Tasks 3, 7 and 12 where they reach till setup/serving                                                | **C/A768** changes `apps/server/src/till-api.ts`, `working-order.ts` → `priceOrderLines` empty offers; `apps/till/src/api/client.ts`, `state/working-order.ts`, `till-app.ts`; catalogue `menu-document.ts` → `readLiveState`/`applyLiveFields`; module `ZoneOffers`/`ZoneMenuState`; venue-service `listZoneOffers`/`menuState`. Keep its `liveFields`/`setupRevision` behavior. No parallel edit of the same function; Task 12 may change `freezeOffer` only after the shared publication review handoff |
| Task 4 removing obsolete contributed-gap wiring; Tasks 2–3 if import/provision contracts reach setup | **E/A679** owns `boot.ts` → `bootServer`, `setup-api.ts` → `mountSetup`, setup/module-operation and provisioning contracts. Wait for release/landing before removing `contentTranslationGaps` wiring in boot or changing a shared contract. Test catalogue transfer through its module seam; do not rewrite first-fiscal setup                                                                                                                                                                             |
| Tasks 2 and 12                                                                                       | Recheck manual **H2** reservations before schema generation and snapshot integration. `receipt-lines.ts` is also touched by G; it is a historical reader and stays unedited here. A fiscal-writer need parks the affected task, even if a reservation was otherwise released                                                                                                                                                                                                                               |
| All tasks                                                                                            | Shared backlog and translation files with different keys have the owner's waiver. That does not waive same-function reservations. Do not copy, cherry-pick or overwrite foreign dirty files; driver records handoffs and rebases                                                                                                                                                                                                                                                                           |

Schema assessment is part of Task 2, not a squash authorization. Proposed `staff_name` and `staff_abbreviation` are required text columns with **no SQL or JS fallback default**. Fresh seeds/imports provide explicit values. An existing populated unit table has no owner-approved source for that pair; design for a pre-live reset, not a translation-copy/backfill. The exact generated SQL and its behavior on empty/populated scratch databases are still unmeasured. Record the generated result and reset roster before release; do not call it a safe in-place upgrade.

The base schema's incoming unit key is `product_units.unit_id` (`schema/units.ts:50`, `drizzle/0000_baseline.sql:61`, `ON DELETE RESTRICT`). At generation, list **all** incoming keys again from declarations, SQL and `pragma_foreign_key_list`; list triggers naming the table as well. Prefer additive generation. If generation rebuilds a table, assess every incoming key and compare child rows before/after on a scratch venue. Do not hand-edit snapshots or journals. Use separate generations for add-column and rebuild/CHECK changes, and separate expression-index generation where applicable. Stop at a refused/populated path and use the recorded reset procedure, not a shipped-migration edit.

## Proposed contracts

### Identity, optional maps and expected facts

All wire types live in the browser-safe leaf `packages/catalogue/src/content-translation-types.ts`; keep `TranslationGapKind` in its existing report-types leaf. Use one identity everywhere, including errors, DOM keys, suggestions and drafts:

```ts
type TranslationField = "name" | "abbreviation"; // abbreviation only for unit
interface TranslationRef {
  kind: TranslationGapKind;
  id: string;
}
interface TranslationCellRef extends TranslationRef {
  language: string;
  field: TranslationField;
}
type TranslationCellKey = string;
function translationCellKey(cell: TranslationCellRef): TranslationCellKey;
// JSON.stringify([kind, id, canonicalLanguage, field]); never concatenate display names.
interface TranslationCell extends TranslationCellRef {
  owners: TranslationOwners | null;
  text: string | null;
  inheritedText: string | null;
  effectiveText: string | null;
  defaultText: string | null;
  inheritedDefaultText: string | null;
  effectiveDefaultText: string | null;
  expected: string;
  staffText: string | null; // display-only fallback for this field; never a stored translation
  eligible: boolean;
  unavailableReason: "missing" | "inactive" | "ownership" | "role" | "language_disabled" | null;
}
interface TranslationItem extends TranslationRef {
  name: string;
  parent?: { id: string; name: string };
  owners: TranslationOwners | null;
  cells: TranslationCell[];
}
interface TranslationEdit extends TranslationCellRef {
  expected: string;
  text: string | null;
}
interface TranslationBatch {
  edits: TranslationEdit[];
}
interface TranslationSaved {
  saved: TranslationCell[];
}
```

`name` means the customer-name map for the eight other kinds, `units.name` for units; `abbreviation` means `units.abbreviation`. A menu id in a translation ref is its **root section id**, not `catalogues.id`. An included-menu id is the **membership id**, not the child section or included menu id. Preserve existing `TranslationOwners` and `TranslationStructure` variants and their owner/role/activity facts. Both page and direct-cell reads include `staffText`: the unit staff abbreviation for an abbreviation cell, the unit staff name for its name cell, and the target's own staff name for other name cells. A missing target has null `staffText`. Placeholders try effective requested text, effective default text, then this field's staff text. Keep this display-only value outside expected baselines and saved translation maps.

For a cell batch, omitted cell = untouched; required `text: null` = remove that language key; nonblank string = trim and store; `""` or whitespace string = invalid wire edit (the editor converts a deliberate blank to null). Reject omitted `text`, wrong types, unknown keys, duplicate four-part identities, noncanonical/disabled languages, `abbreviation` on another kind and values over 4096 UTF-8 bytes. Explicit JSON `undefined` has no wire meaning. An absent optional catalogue map, a null map and `{}` all display blank; normalize nullable customer columns to null when empty, required map columns to `{}`. Never save a fallback/placeholder as a translation.

For existing full-editor map fields, retain their whole-field request shape: omitted field preserves it; a supplied map replaces **enabled-language entries**; null clears enabled entries only where that field is nullable, and `{}` clears enabled entries on required-map fields. Preserve stored disabled-language entries in either case. Submitted disabled entries may repeat the stored value but may not change it; refuse an attempted change. This full-field replacement is distinct from cell omission in a batch. Creates may carry canonical stored keys, including disabled ones, but never infer a missing translation. Unit staff fields reject absent/null/blank on create and null/blank when patched; omitted staff patch fields preserve values.

New `optional-translations.ts` owns:

```ts
function validateOptionalTranslations(value: unknown): Record<string, string>;
function mergeOptionalTranslations(
  stored: Readonly<Record<string, string>> | null,
  supplied: Readonly<Record<string, string>> | null,
  config: ContentLanguages,
): Record<string, string> | null;
```

The validator accepts only a plain map of canonical language keys and text values, trims values, drops blanks, and checks each nonblank value's 4096-byte bound. It does not demand default/Spanish text or filter by enabled languages. Call sites decide nullability before it runs. `mergeOptionalTranslations` implements the full-field replacement/preservation rule, returning null when empty. Unknown/null/nontext map values are refused, rather than coerced. Retain `validateContentTranslations`/`assertContentTranslations` as strict media validators; do not globally redefine them.

`expected` remains transparent canonical JSON, not an authorization token. Add `field` to the baseline and retain ref/language, owners, structure, stored selected/default values, effective selected/default values, inherited selected/default values, sorted full enabled-language configuration/default and sorted required-enabled languages. Parse and validate every property before comparison. Compare objects by values, not JSON insertion order. A default change, disabled edited language, replaced owner, activity/role change or changed selected/default/inherited fact requires review. An unrelated saved language value does not change this cell's facts; adding an enabled language changes the save baseline and requires rebasing the draft through review.

```ts
interface TranslationBaseline {
  ref: TranslationRef;
  language: string;
  field: TranslationField;
  owners: TranslationOwners;
  structure: TranslationStructure;
  selectedText: string | null;
  defaultText: string | null;
  effectiveSelectedText: string | null;
  effectiveDefaultText: string | null;
  inheritedSelectedText: string | null;
  inheritedDefaultText: string | null;
  config: ContentLanguages;
  required: string[];
}
```

### Bounded queries and routes

```ts
type MissingIn = { mode: "any" } | { mode: "language"; language: string } | { mode: "all" };
type TranslationQuery =
  | { languages: string[]; targets: TranslationRef[] }
  | {
      languages: string[]; // 1..8 unique canonical enabled codes, projection only
      missing: MissingIn;
      kind?: TranslationGapKind;
      search?: string;
      after?: string;
      waitingFixes?: true; // discovery only, mode all, complete rows included
    }; // direct targets: 1..50; no after/filter fields
interface TranslationPage {
  config: ContentLanguages;
  required: string[];
  configuration: string;
  rows: TranslationItem[];
  total: number;
  next: string | null;
}
interface TranslationCellPage {
  config: ContentLanguages;
  required: string[];
  configuration: string;
  cells: TranslationCell[];
}
interface LanguageTranslationGapCount {
  language: string;
  count: number;
}
function listTranslationTargets(
  tx: Transaction,
  query: TranslationQuery,
  context: TranslationContext,
): Promise<TranslationPage>;
function resolveTranslationCells(
  tx: Transaction,
  cells: readonly TranslationCellRef[],
  context: TranslationContext,
): Promise<TranslationCellPage>; // 1..100 unique cells
function listTranslationGapCounts(
  tx: Transaction,
  config: ContentLanguages,
): Promise<LanguageTranslationGapCount[]>;
function saveContentTranslations(
  tx: Transaction,
  batch: TranslationBatch,
  context: TranslationContext,
): Promise<TranslationSaved>;
```

Use `GET /management-api/content-translations` for a page; repeated `language=`, `missing=any|all|language`, `missingLanguage=<code>` only in language mode, optional `kind`, `search` (trimmed, max 200 characters), `after`, `target=<kind>:<id>` and `waitingFixes=1`. A direct `target` read accepts only `target` and `language`. `waitingFixes=1` requires `missing=all`, and filters to items with stored fix/placeholder notes. Default page order is existing kind order then id; search matches staff/parent names and entered text in the projected languages, case-insensitively, with bound SQL parameters. Missing-in checks the selected enabled language or **any enabled language**, independent of projected columns. Unit matches when either name or abbreviation is blank. All names removes only the gap restriction, never discovery eligibility. Targets may directly resolve archived product/variant rows as today.

Configuration is canonical JSON of default, sorted enabled languages and sorted required languages. The opaque JSON cursor contains that configuration, normalized filter (including projected languages) and last `{kind,id}`. Reject mismatched/unknown cursor fields; a changed configuration returns `content.translation_stale` with `scope: "configuration"`. Query `limit 51`, return at most 50 and a cursor only when another row exists. Returned cursors advance in kind/id order. One page request does not fetch other pages.

Use `GET /management-api/content-translations/cells?cell=<JSON tuple>` for direct retained/fix cells, at most 100; tuple order is kind,id,language,field. Return disabled-language cells as unavailable instead of dropping the draft or throwing away the entire read. GETs use passive reads. They accept only the documented parameters and reject duplicate/unknown parameters other than the explicitly repeated ones.

Use `PUT /management-api/content-translations` for one batch. Retire the old `/:language` GET/PUT and update every in-tree caller/fixture in the same PR; no compatibility alias. `GET /management-api/content-translation-gaps` returns count summaries, at most 200, using `listTranslationGapCounts`. Keep `listTranslationGapReport` as the full catalogue report for internal callers/tests, sharing the exact predicates and unit deduplication; the screen no longer fetches every gap to display counts.

`DashboardApi` methods have these exact shapes:

```ts
getContentTranslationTargets(query: TranslationQuery): Promise<TranslationPage>;
getContentTranslationCells(cells: readonly TranslationCellRef[]): Promise<TranslationCellPage>;
getContentTranslationGaps(): Promise<LanguageTranslationGapCount[]>;
saveContentTranslations(batch: TranslationBatch): Promise<TranslationSaved>;
getContentSuggestions(query: ContentSuggestionQuery): Promise<ContentSuggestionRead>;
```

Preserve management-session authorization, `catalogue.manage`, same-origin write protection and one gated transaction per request. Keep streamed counting rather than trusting Content-Length; accept exactly 262144 body bytes and refuse 262145, including chunked bodies. The catalogue also checks serialized batch bytes so a non-HTTP caller has the same limit. Preserve existing invalid-batch codes; use `content.translation_refused` for a field validation refusal and 409 for stale/unavailable.

Example Save and response (the real expected strings come from the cell read):

```json
{
  "edits": [
    {
      "kind": "product",
      "id": "dish-1",
      "language": "es",
      "field": "name",
      "expected": "<baseline>",
      "text": null
    },
    {
      "kind": "unit",
      "id": "unit-1",
      "language": "en",
      "field": "abbreviation",
      "expected": "<baseline>",
      "text": "kg"
    }
  ]
}
```

```json
{
  "saved": [
    {
      "kind": "product",
      "id": "dish-1",
      "language": "es",
      "field": "name",
      "owners": { "kind": "product", "parentId": null },
      "text": null,
      "inheritedText": null,
      "effectiveText": null,
      "defaultText": "Potatoes",
      "inheritedDefaultText": null,
      "effectiveDefaultText": "Potatoes",
      "expected": "<new baseline>",
      "staffText": "Patatas",
      "eligible": true,
      "unavailableReason": null
    }
  ]
}
```

The displayed response is abbreviated to one saved cell; production returns one for **every** submitted cell, in submitted order, including clears and exact retries. A precise refusal is:

```json
{
  "error": {
    "code": "content.translation_stale",
    "params": { "kind": "product", "id": "dish-1", "language": "es", "field": "name" }
  }
}
```

Batch shape/byte faults carry no invented field. A field refusal carries all four identity members plus `causeCode`/`causeParams` when wrapping a domain refusal. A configuration-only conflict carries `scope: "configuration"` and goes in the bottom message. No old `defaultText` companion edit or error-field alias survives.

### Atomic save and dependency projection

1. Validate body, 1..100 changed-cell identities, bytes and all baseline shapes before writes. Resolve current settings, items and dependencies once in the transaction, awaiting queries in turn. Group cells by `(kind,id,field)` and merge against complete stored maps, preserving unsubmitted and disabled keys.
2. Resolve included roots by **section id**, independently of edit order. Build one final map per group, then use the final root map as inheritance for every edited include. Clearing an override deletes a key and exposes final inheritance. Preserve image/colour/other folder overrides.
3. Produce a projected baseline from each submitted old baseline plus **all** peer edits affecting that cell's selected/default/inherited facts. In particular, a submitted default-language cell updates another language's default facts; root edits update include inheritance even when that include language was not changed at the root.
4. Accept only if **every current baseline equals its submitted old baseline**, or **every current baseline equals its projected final baseline**. A mix is a conflict, even if each cell individually matches old or final. Equal old/final cells do not turn a genuinely mixed batch into an accepted retry. Reject unavailable targets before writing. A retry with changed configuration/owners is still a conflict.
5. Validate every merged final map and target before the first write. Completeness is no longer a refusal. Write each item field once (unit name/abbreviation can share one row update); the writer takes final maps and must not merge old entries back over a clear.
6. Delete only saved name-field suggestions for matching `(kind,item,language)` in the same transaction, including their staged language fix. Saving a unit abbreviation does not delete its name suggestion. Do not remove unrelated languages, placeholders/internal notes or rows from a partial/failed batch. Exact retries perform the same scoped cleanup and return projected cells.

New `content-translation-baseline.ts` owns `parseTranslationBaseline(edit: TranslationEdit): TranslationBaseline`, `sameTranslationBaseline(a: TranslationBaseline, b: TranslationBaseline): boolean` and `projectTranslationBaselines(bases: readonly TranslationBaseline[], edits: readonly TranslationEdit[]): TranslationBaseline[]`. Export `TranslationBaseline` there with the exact facts defined above. `content-translation-writes.ts` exposes `writeTranslationMaps(tx: Transaction, item: TranslationItem, maps: Partial<Record<TranslationField, Record<string,string>>>): Promise<void>`; maps are final replacements, not patches. `content-translations.ts` owns orchestration and suggestion cleanup.

### Suggestions and draft ownership

Keep Cloud's `SuggestionItem`, `SuggestionResult`, corrections `{field,wrong,right}` and recorded job body unchanged. A correction's language string is mapped to cell field `name`; `internal` has no cell. Unit abbreviations are manual.

```ts
interface ContentSuggestionQuery {
  after?: string;
  configuration?: string;
  fixesOnly?: true;
}
// Evolve existing ContentSuggestionPage: replace language with config, required, configuration;
// retain run, suggestions, next; add waitingFixes: number at page level, even when run is null.
// ContentSuggestionRead retains service and cloudOrigin.
// Add to ContentSuggestionView:
// cell: TranslationCellRef | null; expected: string | null;
// existing id/kind/itemId/language/text/placeholder/fix/stale remain.
function listContentSuggestions(
  tx: Transaction,
  query: ContentSuggestionQuery,
  context: TranslationContext,
): Promise<ContentSuggestionPage>;
function deleteSavedSuggestions(tx: Transaction, edits: readonly TranslationEdit[]): Promise<void>;
function suggestionStale(stored: string, current: string): boolean;
```

`GET /management-api/content-suggestions` pages across all enabled languages plus item notes; no single-language filter. `after` is the last examined stored id, with a strict greater-than query; disappearing/ineligible rows may yield an empty page with an advancing cursor. Cap examined rows at 100. `configuration` on later requests must match current configuration. `fixesOnly=1` includes language fixes and internal/placeholder notes. Counts include waiting fix rows even on otherwise complete items. Expose a `waitingFixes: number` beside the existing run waiting count; do not redefine existing translation-text waiting totals. Update the bar to use it for its new waiting-fixes action while retaining existing job states/notices.

At collection, resolve each correction's exact live target. Only store a language fix's `expected` when effective entered text equals `wrong` exactly and it is eligible, properly owned and in an enabled, nonmissing language. Mismatching evidence leaves a note with null expected; do not manufacture a baseline from Cloud's words. `internal` remains a note/editor link. Existing nullable `expected` and fix columns suffice for this proposed behavior; do not add a suggestions schema constraint or a migration merely for fixes. Retain rejection of unsolicited refs/nonmissing translations, nonenabled replacements, oversized/blank output and placeholder-with-no-text behavior.

Listing rechecks evidence and activity, owners, role and selected/effective/inherited facts. Compare suggestion freshness without full config/default facts so adding an unrelated language alone does not stale it. Still require its own language enabled and the exact target live. The Save token sent by the editor is always the **latest resolved cell token**, never the stored collection token. A stale or evidence-free fix cannot be staged; it remains visible as an out-of-date note. For inherited text, Use fix creates an override on this membership, never an implicit root edit.

The model in `content-translations-model.ts` exposes:

```ts
type ReviewChoice = "keep" | "replace" | "discard";
type DraftOrigin = "personal" | "suggested" | "fix";
interface FieldFault {
  cell: TranslationCellRef;
  message: string;
}
class TranslationDrafts {
  constructor(config: ContentLanguages, cells: readonly TranslationCell[]);
  value(cell: TranslationCellRef): string;
  current(cell: TranslationCellRef): TranslationCell | undefined;
  origin(cell: TranslationCellRef): DraftOrigin | null;
  changed(cell: TranslationCellRef): boolean;
  staged(): readonly TranslationCellRef[];
  readonly suggestedCount: number;
  edit(cell: TranslationCellRef, text: string): void;
  receive(page: TranslationCellPage): void;
  suggest(views: readonly ContentSuggestionView[]): void;
  useFix(view: ContentSuggestionView, current: TranslationCell): "staged" | "stale" | "full";
  review(
    current: readonly TranslationCell[],
    choices: ReadonlyMap<TranslationCellKey, ReviewChoice>,
  ): void;
  unstage(cell: TranslationCellRef): void;
  discardSuggestion(id: string): void;
  submission(): TranslationBatch;
  personalSubmission(): TranslationBatch;
  validate(): FieldFault[];
  commit(submitted: TranslationBatch, saved: readonly TranslationCell[]): void;
}
```

Keep values, baselines, origins and intentional-blank suppression by four-part key, outside the mounted fields. `edit(…, "")` records personal intent even when its wire value would equal an already empty baseline; it suppresses later autofill until explicit unstage/reset. A no-op blank is not a changed cell or a leave prompt; clearing saved text **is** a changed null cell and is guarded. Touching a suggestion promotes it to personal ownership even if you return to the suggested text. A staged fix is personal for leave purposes. `submission` contains selected changed cells; `personalSubmission` contains only personal/fix changed cells. Untouched suggestions alone may make Save ready but never create a close prompt.

Staging capacity is explicit: preserve existing personal/fix changes, unstage untouched suggestion fills first if personal input needs room, and leave overflow suggestions waiting. Refuse the 101st personal/fix cell with a visible capacity message, not a silent ignored keystroke. Retain unsaved text in the focused field until you can choose a batch or revert it; Save is blocked until selected changed cells are <=100. Byte overflow similarly requires deliberate unstage/batch selection. Never auto-send several batches. Every staged cell, including off-page ones and suggested fills, appears in the visible count and Show staged.

## Implementation tasks

Each task follows RED → expected failure → minimal implementation → GREEN → signed commit. Add the named assertions, run the listed focused command and read its `Tests` count. A compile/import failure can establish an added interface is absent; behavior cases must then fail at the intended assertion before the implementation. Keep existing behavioral assertions unless the approved spec changes their behavior, and replace those with equally strict assertions. Do not run these steps during docs planning.

### Task 1: Separate optional maps and the Spanish-enabled floor

**Files:** Create `packages/catalogue/src/optional-translations.ts` and `optional-translations.test.ts`. Modify `packages/country/src/country.ts`, `country.test.ts`; `packages/country-es/src/spain.ts`, `spain.test.ts`; `packages/country-packs/src/registry.test.ts`. Read registry callers in setup, provisioning and boot; don't edit E's reserved functions.

**Interfaces:** Produce the two optional-map functions above. Add `CountryPack.requiredContentLocales?: readonly string[]`. In `contentLanguageRules(pack, areaValue): ContentLocaleRules`, required is the deduplicated union of pack and area's required locales. Set Spain's pack floor to `['es-ES']`; remove Basque/Navarre's now-superseded required-language exception while retaining their existing default-content choice behavior. Keep registry canonicalization unchanged.

- [ ] Write cases for null/array/nontext/malformed/noncanonical keys, `{}`, partial maps and clears; verify disabled entries survive a full-field replacement and an attempted disabled change refuses. Check 4096 vs 4097 UTF-8 bytes with multibyte text. Add Spain unknown/null/unrecognized province and `01/20/48/31` Spanish-required cases; retain Catalonia, Valencia, Balearics, Galicia, foreign notices, English-start-enabled and receipt/fiscal choices.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/optional-translations.test.ts`, then `pnpm --filter @waitron/country exec vitest run src/country.test.ts`, `pnpm --filter @waitron/country-es exec vitest run src/spain.test.ts`, `pnpm --filter @waitron/country-packs exec vitest run src/registry.test.ts`, separately recording each result. Expected RED: missing helper/country floor, not changed fiscal support.
- [ ] Implement the contracts. Keep `validateContentTranslations` untouched. An `ES` venue with unknown province gets Spanish required-enabled; a non-Spanish pack with no floor gets no invented requirement.
- [ ] Rerun those commands. Assert `resolveInstalledContentLanguageRules({country:'ES',area:null}).required` equals `['es']`, while Catalonia still contains both `ca` and `es`. All named cases pass.
- [ ] Stage only this task's paths; `git commit -s -m "feat: separate optional catalogue text and required enabled languages"`.

### Task 2: Give units explicit staff identity, seeds and transfer values

**Files:** Modify catalogue `src/schema/units.ts`, `src/product-types.ts`, `src/units.ts`, `src/errors.ts`, `src/provisioning.ts`, `src/configuration-transfer.ts`, `src/index.ts`; `src/units.test.ts`, `src/units.db.test.ts`, `src/provisioning.test.ts`, `src/configuration-transfer.test.ts`; server `src/units-api.ts`, `src/units-api.test.ts`, `src/testing/seed-units.ts`, `apps/server/scripts/demo-seed/seed-catalogue.ts`. Add dashboard `src/i18n/codes.ts` wording for `unit.invalid` and field routing in the unit form task. Generate **new** catalogue Drizzle artifacts after the migration entry conditions. Read A760's plan only. Wait for E if a shared provisioning/import contract needs a change.

**Interfaces:** `Unit` gains required `staffName: string; staffAbbreviation: string`. Keep `name`, `abbreviation`, precision and `SellableUnit.hardwareUnit`. `CreateUnitInput` requires the staff pair, precision and both maps; `UpdateUnitInput` makes each optional. Keep existing `createUnit(tx,input,fallbackLanguage): Promise<Unit>` and `updateUnit(tx,id,patch,fallbackLanguage): Promise<Unit>` signatures, with fallback language used for preservation/configuration, not completeness. Add `staff_name`/`staff_abbreviation` through the existing `label` vocabulary, not direct SQLite builders.

- [ ] Add RED cases: create with staff `Kilogramo`/`kg` and both `{}` succeeds; clear the last translations and staff values remain exact; absent/null/blank/nontext or over-4096-byte staff is refused with new `unit.invalid` and `{field:'staffName'}` or `{field:'staffAbbreviation'}` (register this exact field union in catalogue `errors.ts`, map HTTP 400). Precision still rejects fractions and outside 0..3. Check PATCH omission, nullable-map refusal for unit maps and disabled-key preservation. API authenticates and preserves existing precision-usage decisions. Register English and Spanish wording for the new code, preserve exact field identity, and run unchanged `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts` after adding it.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/units.test.ts src/units.db.test.ts src/provisioning.test.ts src/configuration-transfer.test.ts` and `pnpm --filter @waitron/server exec vitest run src/units-api.test.ts`. Watch expected RED before implementation.
- [ ] Implement staff fields and explicit seed constants: `Gram/g`, `Kilogram/kg`, `Milligram/mg`, `Millilitre/ml`, `Litre/l`. These are authored seed values, not a computed translation promotion. Implicit Each gets `Each/ea`, retains `EACH_UNIT_ID`, precision 0 and null hardware; existing translated maps and the seed marker remain. Demo unit authors supply explicit staff pairs in their data flow. No user form pre-fills staff from a translation.
- [ ] Validate configuration rows' `staff_name`/`staff_abbreviation`, maps and precision. Export/import round-trips both maps, disabled keys, staff pair, ids, seed keys and hardware mappings exactly. A bundle lacking the pair is refused as `setup.request_invalid` at `units.staff_name` or `units.staff_abbreviation`; no legacy upgrade path. Audit direct `insert(units)` and `createUnit` callers with `rg`; add explicit fixture staff pairs without changing unrelated assertions.
- [ ] Generate using `pnpm --filter @waitron/catalogue db:generate --name unit_staff_identity`. Read generated SQL and journal, inventory incoming keys/triggers, run empty/populated scratch experiments via `useVenueDb` with the real migration sets, and record rows/errors/reset implications. Do not run A760, reset somebody's live venue or edit shipped SQL. A reset requiring operator coordination is a driver release condition, not permission to invent values.
- [ ] Run the focused commands again, plus `pnpm --filter @waitron/catalogue exec vitest run src/schema/schema-conformance.test.ts`. For every generated migration, additive or rebuild, run unchanged `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`. If a rebuild is generated, also run unchanged fiscal `inmutabilidad.test.ts` with its package command and inspect actual child-row preservation. An upgrade refusal requires the generated SQL, exact error and relevant fixture/reset-list path as receipts; identify any already-authorized fixture-only route, otherwise park that conflict for the owner. Do not edit a guard or add a reset-list exemption automatically. Package success alone cannot advance the migration into finish-branch. Record generated artifact names in the commit receipt.
- [ ] Stage task files plus only its new migration artifacts; `git commit -s -m "feat: add explicit staff names and abbreviations to units"`.

### Task 3: Carry unit fields through offers and the unit form

**Files:** Catalogue `src/operations.ts`, `src/extra-projection.ts`, `src/menu-types.ts`, `src/pricing.ts` (type only if needed), `src/operations.test.ts`, `src/units.operations.test.ts`; module `src/module.ts`; venue-service `src/operations.ts`, `src/operations.test.ts`. Dashboard `src/api/client.ts`, `widgets/product-editor-model.ts`, `widgets/unit-form.ts`, `screens/units-screen.ts`, `widgets/product-editor.ts`, `product-details.ts`, `product-list.ts`, `extra-list-form.ts`, `device-home-preview.ts`. Till `src/api/client.ts`, `widgets/product-name.ts`, `widgets/modifier-picker.ts`. Create catalogue `src/unit-presentation.ts`, `unit-presentation.test.ts`. Update their existing unit/form/picker suites, especially `unit-form.save-state.test.ts`, `unit-form.a11y.test.ts`, `unit-owners.unsaved.test.ts`. **Waits G/C** on reserved projections/contracts.

**Interfaces:** Produce browser-safe `unitPresentation(unit: Pick<Unit,'name'|'abbreviation'|'staffName'|'staffAbbreviation'>, language: string, config: ContentLanguages): { name: string; abbreviation: string }`. Each field resolves requested enabled, default, then its own staff value. Add the pair to catalogue and module offer/extra unit shapes, dashboard `Unit/UnitInput/UnitPatch/UnitChoice`, till product/extra unit shapes and pricing `UnitSnapshot`. Keep precision/hardware decisions by ids/seedKey/hardwareUnit, never text.

- [ ] Write RED tests with all four unit strings distinct, partial requested/default maps and `{}` maps; verify requested/default/staff per field, including a disabled-only translation ignored by live fallback. Assert assignments, extras and implicit Each project the staff pair. Renaming every abbreviation to `kg` cannot make Each a weighed unit; renaming weight text cannot remove its hardware mapping.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/unit-presentation.test.ts src/units.operations.test.ts src/operations.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run src/widgets/unit-form.test.ts src/widgets/unit-form.save-state.test.ts src/screens/units-screen.test.ts src/screens/unit-owners.unsaved.test.ts`. Expect missing staff projection/form behavior.
- [ ] Implement every unit select/mapping, including both product queries and extras query, `sellableUnit`, `toSellableUnit`, module offer contracts and venue-service input context projection. `unitPresentation` supplies list/search/sort/picker/preview/price labels consistently. Historical `workingLineContexts.unitName` remains a frozen map; do not add a live unit join to repair it. Task 12 prepares new context names.
- [ ] Add visibly required staff inputs to `unit-form`, translated fields optional with placeholders, semantic names, proper bottom/field refusals, quiet unchanged Save, draft equality and submitted-snapshot commit. Related-unit draft commits before the product adopts its id. Switching languages and reopening retain disabled keys and deliberate clears.
- [ ] Rerun focused suites, plus `pnpm --filter @waitron/dashboard exec vitest run src/widgets/unit-form.a11y.test.ts` and `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts`; add exact name/abbreviation assertions to existing till `product-name`/modifier-picker suites and run those actual files. Run scoped typechecks for catalogue/module/venue-service/dashboard/till/server to find DTO omissions. No mandatory fields fabricated from translations to make fixtures compile.
- [ ] Stage named task paths; `git commit -s -m "feat: retain unit staff fallback across editors and offers"`.

### Task 4: Make catalogue translations optional and default choice free

**Files:** Catalogue `src/content-languages.ts`, `product-editor.ts`, `variants.ts`, `options.ts`, `extras.ts`, `sections.ts`, `include-folder.ts` and input parsers `product-editor-input.ts`, `option-contract.ts`, `extra-contract.ts` where null/type normalization occurs. Server `src/catalogue-api.ts`, `src/boot.ts` only after E's handoff. Tests: catalogue `content-languages.test.ts`, `product-editor.test.ts`, `variants.test.ts`, `options.test.ts`, `extras.test.ts`, `sections.test.ts`, `sections.db.test.ts`, `include-folder.db.test.ts`; server `catalogue-api.test.ts`; unchanged media `images.test.ts`. Audit dashboard `widgets/product-editor.ts`, `variant-form.ts`, `option-list-form.ts`, `option-label-form.ts`, `extra-list-form.ts`, `section-details-form.ts`, `include-folder-form.ts` and their existing suites for required-default markers; remove only obsolete customer-translation requirements.

**Interfaces:** Consume optional helpers/Unit from Tasks 1–2. Replace `writeContentLanguages` with `writeContentLanguages(tx: Transaction, config: ContentLanguages, requiredLanguages: readonly string[] = []): Promise<void>`. Remove `CatalogueApiDeps.contentTranslationGaps` and its boot callback after handoff. Keep contributed module gap reporters available to their own consumers; no module contract removal merely because default-switch stops calling them. Remove `requireDefaultLanguageName` after tracing all callers; use shape-only optional validation at sections/includes instead.

- [ ] Add RED tables for each kind's normal editor/create/patch path, including active variants, Spanish blank with staff `Patatas`, kitchen `PAPAS`, English `Potatoes`, default entirely blank, last-entry clear and stored disabled text. Assert saved map content exactly; no copy from staff/default. Include folder clear reveals inheritance and keeps image/color/showAsFolder.
- [ ] Add default-switch cases with all nine kinds incomplete plus a real contributed image gap. Assert success, exact new config, unchanged translation/publication/order rows; canonicality/duplicate/default-membership/201-language/missing-required-enabled cases still refuse. Add the **separate** media write control: after switching default, an image metadata write lacking its required default text still refuses `image.translation_required`. Never fix this by loosening strict helpers.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/content-languages.test.ts src/product-editor.test.ts src/variants.test.ts src/options.test.ts src/extras.test.ts src/sections.test.ts src/sections.db.test.ts src/include-folder.db.test.ts` and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`; run `pnpm --filter @waitron/media exec vitest run src/images.test.ts`. Record the old completeness refusals as expected RED. Run changed dashboard form suites from this task's file list as a separate browser command, retaining their shared save/leave assertions.
- [ ] Implement optional-map validation/preservation at all named paths and remove only the default-switch completeness branch. Canonical required codes still gate configuration; no missing text enters boot/sale gates. Update affected demo/caller signatures in this same task. Remove UI default-companion validation from ordinary customer forms where obsolete, retaining staff/kitchen/audience behavior.
- [ ] Rerun the same focused commands. Update tests that expected the superseded refusal to assert success **and exact blank/partial stored maps**, retaining bad-shape, authorization, archive, ownership, nutrition and other unrelated refusal assertions.
- [ ] Stage task paths; `git commit -s -m "feat: allow optional catalogue translations and free default choice"`.

### Task 5: Share complete gap rules and bounded multilingual reads

**Files:** Catalogue `src/content-translation-report-types.ts`, `content-translation-report.ts`, `content-translation-targets.ts`, `content-translation-types.ts`, `content-translation-kinds.ts` (keep kind order), `content-languages.ts` candidate-report helpers, `index.ts`; `content-translation-report.test.ts`, `content-translation-targets.test.ts`; create `content-translation-cells.test.ts`.

**Interfaces:** Produce `TranslationCell*`, `TranslationItem`, `TranslationQuery/Page`, count types and list/resolve/count signatures above. Retain single-language row resolution internally for suggestion collection until Task 8 adapts it; it must use the same predicates, not keep an old definition of a gap. Add field-aware cell resolution without duplicating ownership SQL.

- [ ] Write RED fixture tables for all nine kinds: null/empty/whitespace/default missing/disabled-only maps; absent extras list; unit name-only gap, abbreviation-only gap, both missing counted once; include with no name override represented by root; include override `{en:…}` plus inherited `es` complete in Spanish; clear reveals root. Inactive owners/wrong roles are absent from discovery. Direct archived product/variant cells resolve and save eligibility stays as today.
- [ ] Add paging cases: 51 items yield 50 + advancing next then 1; Any language differs from All names; selected missing language can be outside projected columns; complete rows appear in All names/waiting fixes. Test 200 enabled codes with projection at languages 1, 100 and 200, max eight requested, no browser payload containing every map. Direct retained reads include disabled/missing targets with exact unavailable facts. For a unit with staff name `Kilogramo`, staff abbreviation `kg` and both maps `{}`, assert page and off-page direct cells return distinct `staffText` values and no manufactured translation; missing targets return null. Cursor/filter/config mismatches refuse.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/content-translation-report.test.ts src/content-translation-targets.test.ts src/content-translation-cells.test.ts`; inspect intended RED.
- [ ] Implement shared SQL ownership/liveness and gap predicates, projected JSON values and bounded keyset queries. Bind search/JSON paths; no editor graph/per-row database reads. Define `blankTranslationSql(value: SQL): SQL` in targets using `trim(coalesce(value,''), <bound trim characters>) = ''`. Match JavaScript trim's character set: U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000, U+FEFF. Test spaces, tabs and nonbreaking space in stored/imported values. Full report and count-only queries use exactly the same candidate predicate and item/language deduplication. Keep the collector's unbounded job-building read internal; editor reads never call it to scan all pages.
- [ ] Rerun focused files and assert count-only HTTP-facing shape has counts without full gaps. Update full-report tests with equally strict nine-kind/owner assertions rather than replacing them by counts alone.
- [ ] Stage task paths; `git commit -s -m "feat: report all translation gaps with bounded cell projections"`.

### Task 6: Save multilingual cells atomically, including clears and retries

**Files:** Create catalogue `src/content-translation-baseline.ts`, `content-translation-baseline.test.ts`. Modify `src/content-translations.ts`, `content-translation-writes.ts`, `errors.ts`, `content-translations.test.ts`, `content-translation-writes.test.ts`. Adapt `deleteSavedSuggestions` call and implementation in `content-suggestion-store.ts` without touching job/runner behavior.

**Interfaces:** Produce baseline parser/comparison/projection, final-map writer and `saveContentTranslations` above; consume Task 5 cell resolution. Unit name/abbreviation grouped writes are explicit final replacements. Delete suggestions by exact saved name cells only. Update the catalogue error registry: stale params are `TranslationCellRef | {scope:'configuration'}`; unavailable params are `TranslationCellRef`; refused params are `TranslationCellRef & {causeCode:string; causeParams:Record<string,unknown>}`. Keep invalid-batch params empty; import the registry at every throw site.

- [ ] Write RED assertions for two languages on one item, two unit fields, removal of last key, preserved disabled/untouched keys, malformed/duplicate identities, invalid expected ref/field, byte/cell limits and an unavailable member rolling back **every** map and suggestion deletion. Use `useVenueDb`; catch refusals outside `withTransaction`, assert their domain code and four-part field identity.
- [ ] Add root/include peer cases in both orders with root default changed and include override cleared. Assert returned effective text and all tokens describe final state. Repeat the identical submitted batch: `expect(retried).toEqual(firstReply)` after canonical tokens; maps unchanged, cleanup scoped. Add all-old, all-final and mixed-old/final baselines including a root peer changing an untouched default fact; only the first two succeed. Reject owner/default/language/activity races without writes.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/content-translation-baseline.test.ts src/content-translations.test.ts src/content-translation-writes.test.ts`. Require assertion failures that expose item count, lost clears and peer projection before implementation.
- [ ] Implement the six-step transaction algorithm above. Resolve groups once and await SQL serially; validate the entire projected batch before writes. Writers never re-merge deleted keys. An exact retry returns cells even after their suggestions were deleted. Validate the entire byte/cell batch before accepting a retry.
- [ ] Rerun those commands. Check unchanged old single-language safety cases survive as equally strict cell cases, especially whole-batch mixed retry refusal and archived direct product/variant edits versus discovery.
- [ ] Stage task paths; `git commit -s -m "feat: save multilingual translation cells in one atomic batch"`.

### Task 7: Wire bounded HTTP reads, saves and passive live updates

**Files:** Server `src/content-translations-api.ts`, `content-translations-api.test.ts`, `catalogue-api.ts`; dashboard `src/api/client.ts`, `client.test.ts`, `live-queries.ts`; `src/screens/content-languages-screen.ts` and its tests. **Wait G** if editing a currently reserved client function; the receipt's unrelated course keys alone do not reserve the new translation functions. **Wait E** for any remaining boot shared function.

**Interfaces:** Produce the exact route/client methods above. Register `getContentTranslationCells` with target-read dependencies. Add `menu_details` to count dependencies, `content_suggestions` to target dependencies for waiting-fix filtering, and target/catalogue dependencies to suggestion reads (their freshness now depends on catalogue/configuration as well as suggestion tables). Use existing registered resource names; do not alter root guards to permit a new name.

- [ ] Write RED route tests with real authorized requests and direct DTO assertions. Cover invalid query combinations, target/cell limits, canonical languages, cursor config conflict, permissions, origin, 100 vs 101 cells, 262144 vs 262145 bytes in multibyte/chunked bodies, lies/absence in Content-Length, and exact error identity/status. Catalogue-only caller byte tests stay in Task 6.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/content-translations-api.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/screens/content-languages-screen.test.ts`. Watch route/client contract failures first.
- [ ] Implement query decoders, count response and client encoding; route all writes through the existing gate's single transaction. Retire old in-tree single-language URLs. Preserve body reader cancellation/release and normal write activity; use background/passive GET methods for page, retained cells, suggestions and counts.
- [ ] Rerun focused suites. Live tests change each dependency's row and verify fresh cells/counts/fix state; automatic refresh must not prolong the management session. A count load failure remains a load error independent of an action refusal.
- [ ] Stage task paths; `git commit -s -m "feat: expose bounded multilingual translation reads and save"`.

### Task 8: Preserve correction evidence and page waiting suggestions

**Files:** Catalogue `src/content-suggestion-types.ts`, `content-suggestion-store.ts`, `content-suggestion-collect.ts`, `content-suggestion-store.test.ts`, `content-suggestion-store.list.test.ts`, `content-suggestion-collect.test.ts`; server `src/content-suggestions-api.ts`, `content-suggestions-api.test.ts`. Schema `src/schema/suggestions.ts` is read-only unless an actual separate need is established; existing nullable expected is used. Read `content-suggestion-jobs.ts` and runner, do not redesign them.

**Interfaces:** Produce all-language suggestion paging, `cell/expected`, `waitingFixes`, freshness and exact-cell cleanup contracts above. The suggestions run view retains progress/done/failed/waiting unchanged; add `waitingFixes` at page level as an independent count. Preserve submit/collect/release inputs.

- [ ] Add RED cases: fresh `fix.field='es'`, effective saved `wrong` equals exactly, `right` staged nowhere yet, expected present; mismatch or internal correction has null expected and is note-only. Change owner/inherited text/activity/target/language and freshness fails; add an unrelated enabled language and freshness stays valid. Include complete rows, inherited overrides, multiple language fixes and unit names, with no abbreviation suggestion.
- [ ] Add 101 stored rows paging 100 + 1; last-examined cursor advances even when every row is filtered. Config changes between pages refuse; `fixesOnly` returns complete-row fixes/internal notes. Retain unsolicited/nonmissing-result rejection and placeholder-without-text assertions. Saving abbreviation leaves unit name suggestion; rollback leaves every suggestion; saved name removes only matching language.
- [ ] Run `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-store.test.ts src/content-suggestion-store.list.test.ts src/content-suggestion-collect.test.ts` and `pnpm --filter @waitron/server exec vitest run src/content-suggestions-api.test.ts`. Watch intended RED.
- [ ] Implement evidence capture and list-time re-resolution with shared cell identity and live-only `isLiveTarget`. The collection baseline is evidence, never the latest Save token. Avoid a full config comparison in `suggestionStale`; explicitly check field/owners/structure/selected/effective/inherited and target-language enabled status.
- [ ] Rerun the focused files and existing `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts src/translation-cloud-fixture.test.ts`. Keep the runner primary-only, same recorded operation/body on retry, storing before release; service links, consent/cap/provider refusals, progress and notices retain their assertions. Use fake Cloud only, no provider/network call or A760 execution.
- [ ] Stage task paths; `git commit -s -m "feat: retain fresh language fix evidence and bounded suggestion pages"`.

### Task 9: Retain personal cell drafts and explicit batch capacity

**Files:** Dashboard `src/widgets/content-translations-model.ts`, `content-translations-model.test.ts`. Add `content-translations-model.multilingual.test.ts` for cell/limit/review cases. Reuse shared draft comparison utilities; no second leave coordinator.

**Interfaces:** Produce `TranslationDrafts`, identity helper use, origins and faults above. The retained cell store has a maximum 100 selected changed cells plus one over-capacity personal input awaiting a batch choice. Saved/display page cache is separate and bounded in Task 10. `commit` consumes the exact submitted batch, not the latest mutable draft.

- [ ] Write RED cases for personal text and intentional clears across receive/filter/page/language changes; untouched suggestion fill into only empty saved+draft cells; personal touching a suggestion, `right` fixes and explicit blanks resist later arrivals. `personalSubmission().edits` is empty for suggestions alone and includes a clear as `text:null`. A no-op intentional blank suppresses autofill without a dirty prompt.
- [ ] Assert 100 selected cells accepted, 101st personal field retained visibly but Save blocked, suggestions freed before personal input is blocked, overflow remains waiting, unit fields count separately, bytes use UTF-8 of the actual request. Explicit unstage removes just selected suggestions/edits; re-render never silently chooses the first 100. Staged counts include hidden fields.
- [ ] Add stale-review cases for owner/default/disabled/deleted facts; Keep preserves entered value only with an eligible same-owner latest token; Replace adopts latest saved value; Discard removes personal edit/suppression as explicitly chosen. Keep never accepts a removed/reowned target. A late successful Save commits only its submitted snapshot and keeps newer input dirty.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-model.test.ts src/widgets/content-translations-model.multilingual.test.ts`. Observe intended assertion failures, implement the model and rerun. Do not treat `if (!text) return false` as valid clear detection.
- [ ] Stage model/tests; `git commit -s -m "feat: retain multilingual drafts clears and deliberate save batches"`.

### Task 10: Render bounded pages and windowed language fields

**Files:** Dashboard `src/widgets/content-translations-dialog.ts`, `content-translations-dialog.test.ts`, `content-translations-dialog.drafts.test.ts`, `content-translations-dialog.unsaved.test.ts`, `content-translations-dialog.a11y.test.ts`; `src/screens/content-languages-screen.ts`, its tests; `src/i18n/strings.ts`, `codes.ts`. Create app-owned `src/widgets/content-translations-window.ts`, `content-translations-window.test.ts`, `content-translations-dialog.window.test.ts`. Reuse existing primitives, including searchable `wt-combobox` and `wt-input`; no new shared primitive is planned.

**Interfaces:** `languageWindow(languages: readonly string[], anchor: string, width: 'phone'|'desktop', focused: string|null): string[]` returns four visible languages on desktop or one on phone, plus at most one neighbor each side and focused language if outside, at most seven. Rows expose both unit fields; their placeholder uses each cell's display-only `staffText` after effective requested/default text. `getContentTranslationTargets` fetches only that projection; `getContentTranslationCells` refreshes staged/fix refs, at most 100 per read. Initial language-row choice initializes Missing in and jump anchor, not editor identity.

- [ ] Write RED Chromium cases with 200 valid canonical enabled languages and >50 rows. Opening issues one page and one suggestion page, never a cursor-draining loop. Page navigation fetches one page. Jump/search reaches languages 1, 100, 200; native focused field is the same node with the same caret after moving the language window. At most 50 item rows and seven language fields per ordinary row (14 for units) mount; phone stacks visible fields. Language 200 edits survive page/filter/jump return. Empty unit name/abbreviation fields show the distinct staff placeholders from page and retained-cell responses, keep native input values empty and save no translation until entered.
- [ ] Add Kind/Search/Missing in Any/one/All names, Show staged, hidden-count, unit dual-field and byte/capacity controls. Page/filter changes replace read caches, not drafts. Cache at most current page, previous page navigation cursor metadata and the retained <=100 changed cells plus the pending input; no all-row snapshot in the model. Show staged pages <=50 distinct items from retained cells; resolve only their requested windows. Retain the focused row while a pending edit/filter change resolves, then transfer focus deliberately before removing it.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-window.test.ts src/widgets/content-translations-dialog.window.test.ts src/widgets/content-translations-dialog.drafts.test.ts src/widgets/content-translations-dialog.unsaved.test.ts src/screens/content-languages-screen.test.ts`. Watch intended full-scan/focus/draft failures.
- [ ] Replace `#scan`/`#readSuggestions` cursor-draining behavior with one-page requests and explicit Next/load-more actions. Associate each answer with opening generation, filter/page/window sequence and configuration. Reject repeated/backward cursors; apply no result from a closed/reopened editor or superseded filter. Refresh retained cells separately without overwriting personal values. Suggestions may fill new fields only as bounded pages arrive.
- [ ] Use stable keyed Lit field nodes by four-part identity; keep focus outside eviction. Give inputs semantic names (for example `translation-product-<id>-es-name`), visible language labels and `lang`; requested/default/staff fallback appears only as placeholder. Remove Why and required-default companion UI. Wrap regional notes through `::part(language-meta)` and `wrap-to-fit`; Actions stays `key:'actions', pinned:'end'`.
- [ ] Wire draftScopeFor personal submissions, saveActionState with suggested-ready state, stable beforeClose and submitted-snapshot commit before refresh. Save/Cancel/native Escape/backdrop/navigation respect personal/fix drafts; untouched suggestions close without prompting. Successful Save closes/commits, then count reload failure reports a load error. An uncertain Save retains the exact serialized submitted request for explicit whole-batch retry; disable editing that submitted batch until success or explicit conflict review, never rebuild its expected tokens behind Retry.
- [ ] Rerun focused files plus dialog standard/a11y suites. For every late response case, await the pending API operation and its rendered update before asserting no effect. Separate read/action errors; a recovered read never clears a later action refusal. No test relies on a one-second sleep or an undispatched key event.
- [ ] Stage task paths; `git commit -s -m "feat: window translation languages while retaining staged edits"`.

### Task 11: Add Use fix, waiting-fix discovery and stale review

**Files:** Dashboard `src/widgets/content-translations-dialog.ts`, `content-suggestions-bar.ts`, `content-translations-dialog.translate-all.test.ts`, `content-translations-dialog.unsaved.test.ts`, `content-suggestions-bar.test.ts`, `content-suggestions-bar.a11y.test.ts`; create `content-translations-dialog.fixes.test.ts`; `src/i18n/strings.ts`, `codes.ts`.

**Interfaces:** Consume `useFix`, fresh cell reads and `waitingFixes`. Waiting fixes explicitly sets Missing in to All names and `waitingFixes=1`, tells you that the filter changed, and pages complete rows as well as incomplete ones. An internal/placeholder note still links to its existing editor; no staff mutation action.

- [ ] Write RED cases: a complete Spanish cell holding `wrong` exposes Use fix despite initial Missing in English; click fetches its exact latest cell, stages **exactly `fix.right`** in Spanish/name and makes no write. A manual/deliberate-clear draft wins; mismatching current text, ownership, inherited facts, activity or disabled language shows out of date. An unrelated language addition refreshes the Save token without invalidating otherwise fresh fix evidence. Capacity leaves the fix waiting.
- [ ] Assert inherited `wrong` stages only this inclusion's override; root stays unchanged until Save and after Save. Internal fix remains note-only. Fresh suggestions do not prompt close; Use fix and personal edits do. Discard removes that stored suggestion and only its still-untouched borrowed draft, preserving later personal changes and late replacement ids.
- [ ] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.fixes.test.ts src/widgets/content-translations-dialog.translate-all.test.ts src/widgets/content-translations-dialog.unsaved.test.ts src/widgets/content-suggestions-bar.test.ts`. Watch missing action/freshness failures.
- [ ] Implement exact latest-cell recheck and explicit action, serialized opening/read/action generation checks and four-part refusal routing. Reveal an off-page/off-window erroneous cell before focusing it. Old/current/draft review is field-specific, with localized Keep/Replace/Discard. After review, another race still refuses at Save.
- [ ] Rerun commands and bar a11y suite. Retain run progress, availability links, service notices, start/discard error states, placeholders and consent/cap/provider refusal copy. No automatic provider call on Use fix or cell editing.
- [ ] Stage task paths; `git commit -s -m "feat: review and deliberately stage fresh translation fixes"`.

### Task 12: Resolve future presentation before freezing, preserve historical data

**Files:** Catalogue `src/product-presentation.ts`, `default-language-text.ts`, `offered-modifiers.ts`, `menu-types.ts`, `menu-document.ts`, `menu-document-types.ts`; add `src/new-customer-text.ts`, `new-customer-text.test.ts`. Tests `product-presentation.test.ts`, `default-language-text.test.ts`, `customer-menu-presentation.test.ts`, `menu-publication.test.ts`, `menu-document.test.ts`, `pricing.test.ts`. Server `src/working-order.ts`, `modifier-selection.ts`, `modifier-selection.test.ts`, `working-order.test.ts`, existing `till-api.receipt.test.ts`. Till `src/state/working-order.ts`, `held-options.ts`, `api/client.ts` and their tests for new presentation DTOs. Module `src/module.ts` and venue-service `src/operations.ts` only for new context input projection after handoffs. **Waits G/C/E as listed; H2 applies throughout.**

**Interfaces:** New browser-safe helper `newCustomerText(map: Readonly<Record<string,string>>|null, staff: string, requested: string, config: ContentLanguages): string` delegates to existing `resolveMenuText` customer semantics: enabled requested, default, staff. Keep `resolveMenuText`'s locale matching; never arbitrary third-language selection. Change `customerPresentationText(p: ProductPresentation, defaultLanguage: string, languages: readonly string[] = [defaultLanguage])` to return the existing product/variant-map shape with every requested enabled output key resolved independently and the default resolved to staff if missing. Preserve other source map keys in that projection; consumers still resolve only enabled requested/default values. Pass full enabled languages on live presentation paths. These are presentation projections, never written back to translation columns.

Add `presentation: ProductPresentation` to catalogue `OfferedExtraItem` in `menu-types.ts` and the module's offered extras item contract (use a browser-safe structural type there, without a module-to-catalogue dependency). It freezes the original parent's and relative variant's staff/customer/kitchen facts, separately, on new publications; no variant uses its parent's staff fallback. `readExtraProducts` returns this pair alongside the existing composed display fields. Change server `offerModifiers(offer: ZoneMenuOffer, config: ContentLanguages): OfferModifiers` and all its callers to resolve from the frozen pair before composing future child descriptions. The till carries the pair through its imported offer type; its `SelectedExtra` remains staff-name/price/quantity data and gains no new customer snapshot builder. Add browser-safe `newCustomerPresentation(p: ProductPresentation, requested: string, config: ContentLanguages): string`, composing the two independently resolved halves as `Parent (Variant)`. Use it for newly composed extra presentation instead of historical `joinCustomerPresentationText`, which stays unchanged for recorded names. Include the source facts in normal new publication comparison. This keeps independent fallback facts when a default changes after publication without consulting today's catalogue.

Extend `defaultLanguageDescriptions(text: Readonly<Record<string,string>>, keys: readonly string[], defaultLanguage: string, staffName: string): Record<string,string>` and `defaultLanguageText(text: Readonly<Record<string,string>>|null, defaultLanguage: string, staffName: string): Record<string,string>` to use `newCustomerText` with default as requested, not shared historical snapshot resolution. Update all call sites; options receive list/label staff separately. Add browser-safe `prepareUnitSnapshot(unit: UnitSnapshot, config: ContentLanguages): UnitSnapshot` in `unit-presentation.ts`: return a copy whose abbreviation is exactly `{[config.defaultLanguage]: unitPresentation(unit, config.defaultLanguage, config).abbreviation}`. Keep the unit's raw name map and staff pair on the copy for new context preparation. Use this at server parent and till `toPriceable` preparation. Extras prepare the same single-key abbreviation before returning `ExtraChild.unitName`. Remove the redundant post-pricing unit `defaultLanguageText` conversion; do not guess staff from an id or re-resolve a retained unit map. `UnitSnapshot` carries staff fields; arithmetic still copies the prepared presentation values unchanged.

- [x] Write RED cases with default English, requested Spanish, only French stored and distinct staff text. Future customer text uses staff where both requested/default missing, default where requested missing, requested where present; product and variant resolve independently. Options list and label do too. Unit `{}`/`{}` freezes staff abbreviation, never staff full name or an arbitrary translation. `priceBasket`/`grossBasketWithOptions` retain identical quantities/prices/VAT with prepared text.
- [x] Add publication/context cases: staff unit rename and translated clear show Unpublished changes, including extras comparison; the old published document/hash remains byte-for-byte unchanged before explicit publish. New publication carries unit staff pair. New lines freeze published unit/customer facts; no live read patches an old offer. Receipt maps keep exactly `invoiceLocales` keys and every key gets the same default-resolved wording; option/unit maps keep the existing single default-language key. Till preview and server new snapshots agree.
- [x] Add retained/held/recalled source cases after G integration: unchanged options/extras/descriptions/unit context remain exactly old values despite current-language/config changes; only newly added/replaced answers/lines take new fallback. In G's `priceOrderLines` recalled-source branch, carry its stored maps unchanged and exclude them from new fallback/re-keying, including its discarded carrier of newly priced extras. Keep existing FROZEN_OPTIONS/FROZEN_EXTRAS paths. Snapshot readers with receipt-only keys stay unchanged. Extend nonfiscal acceptance to compare complete stored order/sale/line/fiscal/series/publication rows around translation Save and reprint. This uses existing writers as fixtures, not edits to a fiscal writer/test.
- [x] Run `pnpm --filter @waitron/catalogue exec vitest run src/new-customer-text.test.ts src/product-presentation.test.ts src/default-language-text.test.ts src/customer-menu-presentation.test.ts src/menu-document.test.ts src/menu-publication.test.ts src/pricing.test.ts`; server `pnpm --filter @waitron/server exec vitest run src/modifier-selection.test.ts src/working-order.test.ts src/till-api.receipt.test.ts`; till `pnpm --filter @waitron/till exec vitest run src/state/working-order.test.ts src/state/held-options.test.ts`. Watch intended third-language/staff fallback failures first.
- [x] Implement preparation only. Update `freezeOffer` unit projection and unit change comparison, including extra-unit staff abbreviation changes, without editing `menuDocumentHash` or canonical hashing. Keep raw customer maps/source pairs for publication and resolve when consuming them. `recordLineContexts` receives a prepared new full-unit-name map (default name or staffName, never the receipt abbreviation); reads/copies of stored contexts remain unchanged. Keep its existing input shape `{id,name,precision,hardwareUnit}` and pass a prepared map for new parent and child lines; no context schema addition or live repair join. No edit to core `sale-line-rows.ts`, fiscal/alta builders, hashes/numbering or historical receipt readers. Park an actual H2 need with its exact call chain.
- [x] Rerun focused commands. **Immediately beside this snapshot work**, run unchanged `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`; require unchanged `GOLDEN` assertion (`write-path.e2e.test.ts:697`) and immutability assertions, no fixture/golden edits. Also run unchanged `pnpm --filter @waitron/shared exec vitest run src/content-languages.test.ts` for receipt-only snapshot keys. Any fiscal mismatch is a finding to investigate/park, never new expected hash text.
- [x] Stage permitted preparation/tests; `git commit -s -m "feat: resolve fallback while preparing future customer snapshots"`.

### Task 13: Complete visual acceptance and update the explanations

**Files:** Future product PR may update `docs/developers/products.md`, `design-system.md`, `docs/content-and-images.md`, the A682/Use fix backlog blocks and the completed plan checklist. Historical Translate all proposal/plan bodies get a dated pointer, not rewritten history. Update any affected current README/runbook claims found by a whole-range prose audit; no root instruction/guard edits in A682.

**Interfaces:** No new runtime contract. Explain optional/disabled text, unit staff pair, gaps, free default choice, one bounded Save, waiting fixes, personal drafts, future publication and recorded names in second person. Keep Cloud's 20-language limitation open and avoid a product completion claim until branch gates pass.

- [x] Extend real Chromium acceptance for EN/ES × light/dark × **390/1280 px** using existing dialog/screen browser suites. Cover empty/filled/suggested/fix/stale/review/error/100-cell/byte-cap states, 200-language jump and focus, unit pair, full regional notes and pinned Actions. Assert rendered native field state and layout, not only host properties. Run the named suites and inspect all eight visual combinations.
- [x] Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/content-translations-dialog.test.ts src/widgets/content-translations-dialog.window.test.ts src/widgets/content-translations-dialog.fixes.test.ts src/widgets/content-translations-dialog.a11y.test.ts src/screens/content-languages-screen.test.ts src/screens/content-languages-screen.a11y.test.ts src/widgets/unit-form.a11y.test.ts`. Restore global locale/theme after each case; use actual dispatched/user clicks and await operation completion.
- [x] Use only declared `--wt-*` tokens and `part`/`::part` for table content. If implementation actually adds a shared primitive instead of the planned app-owned window helper, add its token-painting test and sibling axe test across distinct states in both themes; do not waive those checks. Keep shared form/save/leave contract assertions.
- [x] Audit prose over the whole base-to-tip path set with `git diff --name-only 8ddcab3b22525a825474a3a0c35c95800409b231...HEAD` and `rg` for old required-default/Why/companion/unit/Spanish/fallback claims in docs and READMEs. Check current explanations against the complete new call chain. Keep historical checkpoints with dated closure pointers. Remove A682/Use fix entries only when this complete production change is delivered; retain decisions in the area's Decisions section and keep unrelated open points.
- [x] Stage explanations and any acceptance corrections; `git commit -s -m "docs: explain optional translations review and future fallback"`.

### Task 14: Validate and finish the one production branch, then serialize landing

**Files:** No new product/config/guard changes are planned here. Read current `docs/developers/ci-and-gates.md`, `workflow-guide.md`, `finish-branch` and `land-branch` skills when executing. The owner already authorized inline implementation/finish/land; the driver retains reservation and publication control.

- [ ] Review the entire diff against this plan/spec. Keep a **Changed test checks** receipt: for each changed existing assertion, record old behavior, approved requirement that changes it, replacement assertion and focused command/result. Missing-text refusal → success with exact stored partial/empty maps is authorized; weakening ownership/archive/atomic retry/audience/price/VAT/fiscal/root-guard assertions is not. Retain all unrelated behavioral assertions. No coverage excludes, ignores or deleted tests to manufacture green.
- [ ] Run focused tests for the latest implementation fixes, normal scoped typechecks and migration checks indicated above. Do not repeat all focused commands just for ceremony once unchanged passing evidence exists. Let the normal pre-push hook run its install/format/lint/root-coverage/scoped-types gate once, without `--no-verify`; no whole-workspace local tests merely to finish. Current-head CI supplies mandatory package coverage. Country/module/catalogue changes affect dependents: inspect actual selected scope, including media, provisioning/setup, venue-service, server, dashboard and till. Root/fiscal guards stay unchanged.
- [ ] Announce ready for `finish-branch`, then continue it because it is authorized. After initial rebase use **one final Claude whole-branch run-it review** in an installed throwaway checkout of the complete candidate. Driver arranges that review; don't spawn routine task reviewers. Read completed findings, fix supported findings inline with RED/GREEN and signed commits, then focused verification. Approval survives later unrelated rebases; no repeated whole review solely for a rebase.
- [ ] Open/update the one production PR, describe reset implications and snapshot/fiscal boundary precisely, and wait for required current-head CI/coverage and resolved conversations. Check SHA with `gh pr view --json headRefOid,statusCheckRollup` and `gh run list --json databaseId,headSha,status,conclusion`. A passing filtered selection is not evidence a package test ran; read job/merge coverage results. No Cloud push/full-suite exception is invoked since this PR changes Waitron only.
- [ ] Under **H11**, driver serializes main landing with other lanes. Refresh reservations/main, rebase only for actual conflicts/shared code changes per house rules, install after rebase, preserve G/C/E integration, use the normal hook and current-head CI. Land under the already granted authorization through `land-branch`; install in main after pull. Remove only this branch/worktree/managed resources, verify remote feature branch is gone, and stop only processes this implementation started (recorded pids), never names or another lane's resources.
- [ ] Under **H12**, capture the **exact merge SHA**, find its own main CI run with matching `headSha`, and wait for its required results. A neighboring lane's green main run is not the merge's receipt. Do not report completed production delivery until these results and the reset/operator conditions are satisfied.

## Plan self-review and driver handoff

Planning self-review, 2026-10-17: the five design points map to Tasks 1–7/9–10; Translate all and Use fix to 8–11; units to 2–3/12; future snapshots/publication and unchanged fiscal evidence to 12; visual/docs/finish/landing to 13–14. The five Review focus cases each name their asserting task. Route DTOs, model keys, baseline fields, suggestion language-to-name mapping and unit field counts share the identities above. Full-editor map replacement, cell omission and null clears are deliberately distinct and stated at their boundaries. Generation behavior is an experiment to run, not an asserted upgrade result.

No product test, service, schema generation, A760 execution, commit or push was run during planning. The driver arranges a fresh-context plan-versus-spec read and docs-only publication **before implementation**. A682 and Use fix remain OPEN. There is no remaining unit/Spanish product question; reservation releases, generated reset evidence and any actual H2 encounter are execution conditions, not permission to reopen those closed decisions.

## Driver review corrections, 2026-10-17

A fresh-context plan-versus-spec read found two omissions, now incorporated: field-specific staff fallback in both bounded page and retained-cell DTOs, with empty-map/off-page assertions; and the unchanged populated upgrade guard for additive migrations as well as rebuilds. An actual guard conflict retains its SQL/error/fixture receipts and parks unless an existing authorization covers a fixture-only correction. The driver also read the author's later explicit baseline/query/Unicode-blank/live-dependency and future-snapshot contract refinements; these retain the closed decisions and unchanged historical/fiscal boundary. Required new-code registry wording and guards are explicit. This is plan verification only; product acceptance remains unrun.

## 2026-10-20 implementation audit

Task 13 is locally complete. The multilingual acceptance suites cover the planned states and
the eight English/Spanish, light/dark, phone/desktop views were inspected. Current documentation
now distinguishes optional text, enabled-language rules, future preparation and recorded reads.
The historical Translate all and inline-translation documents retain their bodies with dated
pointers. Completed A682 and Use fix backlog entries are removed; decisions and the independent
Cloud language and release limitations remain.

The English-only audit renames scenario data without changing numeric, VAT, permission or
fiscal expectations; Spanish UI checks read their translation catalogue. A canonical variant
fixture key and required staff-field setup are corrected without changing existing assertions.
The complete receipts and changed-check inventory are retained by Lane F. Task 14 still requires
the final Claude review, normal hook, current-head CI and serialized landing.
