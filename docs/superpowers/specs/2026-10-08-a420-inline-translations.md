# A420 part 2: fill missing translations in place

**Proposed for owner approval, Lane E, 2026-10-08. Part 2 implementation awaits approval.**

You should be able to fill missing customer-facing names for one content language without opening
several editors. Part 1 supplies the language table and a temporary read-only report dialog with
editor links. This design replaces that editing journey; it changes no language settings, prices,
staff or kitchen names, published menu versions or recorded receipt names.

## Existing write paths

Source audit: `be8d7d6ab`. These are source observations, not runtime verification. No route or database probes were run for
this draft. The nine kinds come from `packages/catalogue/src/content-translation-report-types.ts`.
The report lists partial customer-name maps and, outside the default language, absent maps.
Absent extras-list names are omitted; units report names, not abbreviations
(`packages/catalogue/src/content-translation-report.ts:137`). The implementation must exercise
these paths before claiming equivalent validation.

| Report kind | Existing save route and domain writer | Name owner and checks |
| --- | --- | --- |
| `product` | `PUT /management-api/products/:id/editor` (`:1407`) calls `saveProductEditor` (`packages/catalogue/src/product-editor.ts:119`), then `updateProductSkippingNameCheck` (`:193`; `packages/catalogue/src/operations.ts:1113`). | `products.customerName` on the gap's own product id, with no parent. The full editor parses unrelated fields and writes variants and modifiers too (`product-editor.ts:145`, `:193`, `:221`). Non-null customer names require default-language text (`:153`). |
| `variant` | The same product editor route accepts the **variant's own product id**. `saveProductEditor` reads its stored parent and calls `updateProduct` (`product-editor.ts:130`, `:193`; `operations.ts:1103`). A parent editor also writes variants through `writeProductVariantsSkippingNameCheck` (`product-editor.ts:221`). | The variant's own `products.customerName`, not its parent's. Active variants require default text; omitted variants in a parent aggregate become inactive (`packages/catalogue/src/variants.ts:213`, `:258`). The report's parent id is context, never the name target. |
| `option_list` | `PATCH /management-api/modifiers/options/:id`, mounted at `:522`, `:802`, calls `updateOptionList` (`packages/catalogue/src/options.ts:229`). | `option_lists.customerName` on the gap id. The input is a complete list, including labels. All non-null list/label maps require default text (`options.ts:120`); the write replaces list fields and reconciles labels (`:242`). |
| `option_label` | The same **owner-list** PATCH; there is no separate label save in this path. `updateOptionList` calls `writeLabels` (`options.ts:243`). | `option_labels.customerName` on the gap id, checking `listId` against the report's parent. `writeLabels` refuses foreign label ids, deletes omitted labels, and inserts unknown ids (`options.ts:168`, `:184`, `:207`). Never send just the edited labels to this aggregate route. |
| `extra_list` | `PATCH /management-api/modifiers/extras/:id`, mounted at `:522`, `:815`, calls `updateExtraList` (`packages/catalogue/src/extras.ts:360`). | `extra_lists.customerName` on the gap id. Non-null maps require default text (`extras.ts:164`); full input also validates products/portions, deletes all items and reinserts them (`:295`, `:324`, `:375`). Never send a names-only body to this aggregate. |
| `menu` | `PATCH /management-api/catalogues/:id` (`:945`) calls `updateMenuDetails` (`packages/catalogue/src/operations.ts:795`), then `sectionPatchValues` and a root-section update (`:805`, `:818`). | The gap id is a **menu-root section id**; `parent.id` is the catalogue/menu id (`content-translation-report.ts:74`, `:118`). Resolve `menu_details.rootSectionId` and check the pair (`packages/catalogue/src/menu-structure.ts:67`). A root cannot use `updateSection`, which refuses roles other than `section`. |
| `section` | `PATCH /management-api/sections/:id` (`:580`) calls `updateSection` (`packages/catalogue/src/sections.ts:198`). | `sections.names` on the gap id, role `section`, owned by the report's menu. Missing/wrong-role targets are refused (`sections.ts:204`). `sectionPatchValues` replaces the supplied names map; nonempty maps require default text (`:55`, `:68`, `:359`). |
| `included_menu` | `PUT /management-api/sections/:id/members/:memberId/folder` (`:642`) calls `setIncludeFolder` (`packages/catalogue/src/include-folder.ts:70`). | The gap id is **`section_members.id`**, not the included menu/root id. The route's `:id` is the containing section; the report's parent is only the including menu (`content-translation-report.ts:77`). Resolve membership, containing section, owner menu and child root. The writer checks membership/root role, replaces supplied overrides and validates effective default names (`include-folder.ts:77`, `:86`, `:94`). |
| `unit` | `PATCH /management-api/units/:id` (`apps/server/src/units-api.ts:166`) calls `updateUnit` (`packages/catalogue/src/units.ts:136`). | `units.name` on the gap id. Each supplied name/abbreviation map requires default text (`units.ts:70`); the supplied map replaces that column (`:151`). Inline editing supplies only a merged name map, preserving abbreviation, precision, seed and hardware fields. |

## Recommended write design

Use one bounded batch route backed by a translation-only domain command for each kind. Reusing
whole product, option or extras editors can reconcile unrelated variants, labels, items and prices;
the new command must merge named cells into current stored maps and validate through the same
name rules, without calling whole-editor saves. No generic table/column updater.

Proposed API, not shipped names: a paged `GET /management-api/content-translations/:language`
returns target kind/id, context and explicit owner ids, current selected/default cells, eligibility,
and an expected-state token. A `PUT` at the same path accepts 1–100 unique targets with their
baseline tokens and nonblank text. A separate `defaultText` is accepted only where explicitly
required and entered. Reject unknown fields/kinds, duplicates, explicit nulls and excess targets.
Keep the current gap report for part 1 and other consumers.

One route-owned `withTransaction` checks every submitted target, builds the proposed final maps
including root/include dependencies, validates them, then writes. A refusal rolls back the whole
batch. Read content configuration once and bulk-load targets/owners by table in bounded chunks;
never load one editor per line. Await statements in order. Success returns canonical submitted
names; refusals identify target and field/language for display alongside existing domain codes.
Register any new stale/unavailable codes and EN/ES wording rather than inventing codes at the UI.

Recheck the management session and `person.manage`, target roles, owners and current activity.
Never recreate a removed row. An inclusion checks both menus; its report currently checks only
the including menu (`content-translation-report.ts:77`, `:122`). An option label's availability
flag does not by itself exclude it from the report. Units have no activity filter. A moved or
replaced label/include must not redirect a draft.

Shared product, variant, list, option and unit names change their shared definitions. A menu name
changes its root; a section changes its own definition. An included-folder name changes only that
membership's override, retaining other overrides and the folder switch. Explain this scope beside
the row. Follow the existing preview/publication flow, without automatic publishing.

Compare submitted cells, role/activity, ownership, default-name dependencies and enabled/default/
required language settings by values. Merge unrelated concurrent language or field changes; refuse
a changed submitted cell or owner/configuration. A lost-response retry may be a no-op when every
intended cell already equals the request and other preconditions match. Preserve text on a stale
refusal. Review latest shows current values and requires an explicit keep/replace/discard choice
before accepting a new baseline; never overwrite automatically.

Two validation differences need real probes. Name-map validation checks the default language,
while required regional languages constrain the enabled list (`content-languages.ts:34`, `:199`);
starting a non-default name may therefore need an explicit default companion. Visible report rows
also differ from Make default blockers, including inactive/media rows (`catalogue-api.ts:862`,
`:901`), so filling the report must not promise default-change success. Exercise menu-root fallback
with configured and unset settings: `updateMenuDetails` calls `sectionPatchValues` without the
venue fallback used by section/include routes (`operations.ts:806`, `sections.ts:362`). These are
source observations, not demonstrated defects.

## Choices for approval

| Choice | Recommended default and reason |
| --- | --- |
| Language scope | Open only the clicked language, named in the heading. No in-dialog language switch. To switch, close through the unsaved gate and reopen from another row. |
| Default companion | For an entered name whose resulting map lacks the current default, reveal a required, initially blank default-language field beside it. Explain why; use the staff name only as a placeholder. Never silently copy it. This is the sole permitted second-language write, explicit in the payload and UI. Preserve an existing default name. |
| Kind / Why | Retain Kind multi-select, Why single-select and staff/context search. Default to all. Filters change visibility, not drafts or the save set. Explain “Partly translated” and “No customer-facing name”; neither is permission to clear a name. |
| Blank / whitespace | Untouched gaps are omitted. Trim on submission, preserving internal spaces and the cursor while typing. Returning both fields to empty cancels that row's edit. A nonempty companion with an empty selected name, or a selected name lacking its required companion, is invalid. Whitespace-only input is empty. This dialog never deletes translations. |
| Paging / size | Show 50 rows per page with stable kind/id ordering. Keep edits across pages and filters. Save all entered rows, visibly counting hidden edits; offer “Show edited”. At 100 target drafts, keep other rows readable and ask you to save or undo before adding another. The server refuses over-limit batches; it never chunks writes automatically. Bound the proposed request to 256 KiB and each entered name to 4 KiB UTF-8, with matching visible validation. These are new limits requiring approval, not existing domain limits. |
| Live arrivals / departures | Keep the opening row order stable until “Review latest”; show an arrival count without inserting rows under your cursor. Retain edited disappearing rows, text and focus, marking them changed/unavailable. A clean disappearing row may leave. A concurrent fill must not silently adopt or erase an edited value. |
| Batch outcome | One all-or-nothing Save changes, then close on success. For larger work, save up to 100, reopen and continue. No per-kind progress or autosave. |
| Empty / ineligible | A complete language shows a clear empty state and Close, with no enabled save. Ineligible rows explain their status and retain the existing editor link; links leave through the shared unsaved gate. |

For example, with English default and no customer name for staff item “Croquetas”, entering
Spanish “Croquetas de jamón” reveals a blank required English companion. Entering “Ham croquettes”
saves those two explicit cells. The staff name and kitchen shorthand stay unchanged. Leaving a
row untouched does not prevent saving another completed row.

Use shared field primitives inside `wt-modal`, semantic field names, language tags and visible
required markers. Style table cells with `part`/`::part` and declared tokens. Take a `draftScopeFor`
scope; Save follows `saveActionState` with an unchanged/busy/invalid early return. Unchanged opens
quiet and disabled. Invalid submission explains each bad field and gives one localized message
above the buttons, revealing and focusing a hidden invalid row. Request refusals remain retryable.

Protect Cancel, native close/Escape, navigation, locale changes and voluntary logout through the
shared leave coordinator. Dispose/recreate the scope on disconnect/reconnect while retaining the
opening's original baseline and edited text; an old generation cannot change or close a new opening.
Passive live reads update snapshots separately from drafts. Keep read and action errors separate.
After a successful write, commit and close before refreshing the report; a failed refresh is a load
failure. Review added subscriptions and their server dependencies, including menu-root ownership.

## Acceptance for the approved implementation

- TDD with real `useVenueDb` and authenticated routes for all nine kinds, distinct root/menu,
  variant/parent and include/member/section ids. Check default/required/absent names, include
  inheritance and folder-off state, inactive and removed targets, foreign label owners and malformed
  batches; valid-manager controls accompany permission refusals.
- Mixed-kind all-or-nothing failure, same-cell conflict, different-language/price concurrency,
  identical retry and 100/101 boundaries. Read back untouched sibling names, variant activity,
  option order/defaults, extras prices, folder settings and unit abbreviations/precision. Measure
  configuration and target reads for one versus 100 entries.
- Real Chromium unsaved tests for edit/revert, every leave path, dirty-before-reconnect, filters/
  pages hiding drafts, arrivals/departures, retryable errors, late replies and save-then-refresh
  failure. Installed disposable deletion controls for unchanged, ownership, stale, generation and
  draft protection, plus legitimate-success controls.
- Inspect EN/ES, both themes, measured 390/1280 widths, keyboard input, long names and loading,
  empty, invalid and conflict states with axe. Exercise shared-name preview/publication consumers
  and retained recorded snapshots. Fiscal records, sequence, hashes and sale snapshots remain
  unchanged; no fiscal writer or append-only workaround. Focused local checks, normal push hook
  and required current-head CI follow the repository split.

Approve the defaults above before building part 2, particularly the default companion, batch
outcome, new limits and names-only unit scope. This spec introduces no migration or code.
